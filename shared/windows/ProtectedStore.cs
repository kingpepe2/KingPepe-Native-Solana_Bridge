// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// Original Windows DPAPI/ACL glue. No upstream implementation copied.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace KingPepe.LocalProtection {
  public static class ProtectedStore {
    const int MaxPayload = 1048576;
    const int MaxEnvelope = MaxPayload + 16384;
    const string StateName = "state.protected";
    const string PendingName = "candidate.protected";
    static readonly byte[] Magic = Encoding.ASCII.GetBytes("KPS2");

    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
      public int Length; public IntPtr Descriptor; public int Inherit;
    }
    [StructLayout(LayoutKind.Sequential)] struct FileInformation {
      public uint Attributes; public uint CreationLow; public uint CreationHigh;
      public uint AccessLow; public uint AccessHigh; public uint WriteLow; public uint WriteHigh;
      public uint Volume; public uint SizeHigh; public uint SizeLow; public uint Links;
      public uint IndexHigh; public uint IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateDirectory(string path, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);

    static void Require(bool value, string reason="POLICY") {
      if (!value) { var error=new InvalidOperationException("PROTECTED_STORE_REJECTED");
        error.Data["ProtectedBuildReason"]=reason; throw error; }
    }
    static string Text(IDictionary<string, object> r, string key) {
      object value; Require(r.TryGetValue(key, out value) && value is string); return (string)value;
    }
    public static string Identity() { return WindowsIdentity.GetCurrent().User.Value; }
    static byte[] Hash(byte[] value) { using (var h=SHA256.Create()) return h.ComputeHash(value); }
    static bool Equal(byte[] a, byte[] b) {
      if (a.Length != b.Length) return false; int d=0;
      for(int i=0;i<a.Length;i++) d |= a[i]^b[i]; return d==0;
    }
    static bool ContainsPath(string parent, string child) {
      return child.Equals(parent, StringComparison.OrdinalIgnoreCase) ||
        child.StartsWith(parent.TrimEnd('\\')+"\\", StringComparison.OrdinalIgnoreCase);
    }
    static string Root(string path, string source) {
      Require(path.Length > 3 && path.Length < 240 && path[1]==':' && path[2]=='\\');
      Require(!path.StartsWith("\\") && path.IndexOf(':',2)<0 && path.IndexOfAny(new[]{'\r','\n','\0'})<0);
      string full=Path.GetFullPath(path).TrimEnd('\\');
      Require(full.Equals(path.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase),"ROOT_CANONICAL");
      // A drive letter alone does not prove local storage (for example SMB mappings).
      Require(new DriveInfo(Path.GetPathRoot(full)).DriveType==DriveType.Fixed,"ROOT_FIXED_DRIVE");
      Require(!ContainsPath(source,full) && !ContainsPath(full,source),"ROOT_SOURCE_BOUNDARY");
      for(string p=full;p!=null;p=Path.GetDirectoryName(p)) {
        if(Directory.Exists(p)||File.Exists(p)) Require((File.GetAttributes(p)&FileAttributes.ReparsePoint)==0,"ROOT_REPARSE");
      }
      return full;
    }
    static DirectorySecurity DirectoryAcl(SecurityIdentifier sid) {
      var acl=new DirectorySecurity(); acl.SetOwner(sid); acl.SetAccessRuleProtection(true,false);
      acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,
        InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      return acl;
    }
    static void CreatePrivateDirectory(string root, SecurityIdentifier sid) {
      // Atomic CREATE_NEW directory semantics with its final DACL, never chmod an existing directory.
      Require(Directory.Exists(Path.GetDirectoryName(root)),"DIRECTORY_PARENT");
      var bytes=DirectoryAcl(sid).GetSecurityDescriptorBinaryForm(); IntPtr descriptor=Marshal.AllocHGlobal(bytes.Length);
      try {
        Marshal.Copy(bytes,0,descriptor,bytes.Length);
        var attributes=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=descriptor,Inherit=0};
        if(!CreateDirectory(root,ref attributes)) Require(false,"DIRECTORY_CREATE_"+Marshal.GetLastWin32Error());
      } finally { Marshal.FreeHGlobal(descriptor); }
      CheckAcl(root,true,sid);
    }
    static void CheckAcl(string path, bool directory, SecurityIdentifier sid) {
      Require((File.GetAttributes(path)&FileAttributes.ReparsePoint)==0);
      FileSystemSecurity acl=directory?(FileSystemSecurity)Directory.GetAccessControl(path):File.GetAccessControl(path);
      Require(acl.GetOwner(typeof(SecurityIdentifier)).Equals(sid),"ACL_PRINCIPAL");
      if(directory) Require(acl.AreAccessRulesProtected,"ACL_INHERITANCE");
      var rules=acl.GetAccessRules(true,true,typeof(SecurityIdentifier)); Require(rules.Count==1,"ACL_RULE_COUNT");
      foreach(FileSystemAccessRule rule in rules) Require(rule.IdentityReference.Equals(sid) &&
        rule.AccessControlType==AccessControlType.Allow && rule.FileSystemRights==FileSystemRights.FullControl,"ACL_ACCESS");
    }
    // Source-built executable cache only: never a share, key or state enrollment.
    // CREATE_NEW and the final single-principal DACL are applied atomically.
    public static void CreateExecutableDirectory(string root,string source) {
      var sid=WindowsIdentity.GetCurrent().User;
      CreatePrivateDirectory(Root(root,Path.GetFullPath(source)),sid);
    }
    public static void CheckExecutableDirectory(string executable,string source) {
      var sid=WindowsIdentity.GetCurrent().User;
      string root=Root(Path.GetDirectoryName(executable),Path.GetFullPath(source));
      CheckAcl(root,true,sid);
      CheckAcl(executable,false,sid);
      // A loaded executable is read-only, unlike mutable protected state.
      using(var stream=new FileStream(executable,FileMode.Open,FileAccess.Read,FileShare.Read)) {
        FileInformation info; Require(GetFileInformationByHandle(stream.SafeFileHandle,out info));
        Require(info.Links==1 && (info.Attributes&(uint)FileAttributes.ReparsePoint)==0);
        Require(stream.Length>0 && stream.Length<=1048576);
      }
    }
    // Only called immediately after compiling into a newly created private
    // directory. Elevated Windows tokens can assign a generated file to their
    // default token principal; explicitly bind this new file to the service.
    // Existing cached helpers and protected state are never repaired this way.
    public static void SealCompiledExecutable(string executable,string source) {
      var sid=WindowsIdentity.GetCurrent().User;
      string root=Root(Path.GetDirectoryName(executable),Path.GetFullPath(source));
      Require(Path.GetFileName(executable)=="protected-store.exe"); CheckAcl(root,true,sid);
      Require((File.GetAttributes(executable)&FileAttributes.ReparsePoint)==0);
      using(var stream=new FileStream(executable,FileMode.Open,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.None)) {
        FileInformation info; Require(GetFileInformationByHandle(stream.SafeFileHandle,out info));
        Require(info.Links==1 && (info.Attributes&(uint)FileAttributes.ReparsePoint)==0 && stream.Length>0 && stream.Length<=1048576);
        var acl=new FileSecurity(); acl.SetOwner(sid); acl.SetAccessRuleProtection(true,false);
        acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,AccessControlType.Allow));
        stream.SetAccessControl(acl);
      }
      CheckExecutableDirectory(executable,source);
    }
    static FileStream Open(string path, FileMode mode, SecurityIdentifier sid) {
      if(mode==FileMode.Open) CheckAcl(path,false,sid);
      FileStream stream;
      if(mode==FileMode.CreateNew) {
        var acl=new FileSecurity();acl.SetOwner(sid);acl.SetAccessRuleProtection(true,false);
        acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,AccessControlType.Allow));
        stream=new FileStream(path,mode,FileSystemRights.FullControl,FileShare.None,4096,FileOptions.WriteThrough,acl);
      } else stream=new FileStream(path,mode,FileAccess.ReadWrite,FileShare.None,4096,FileOptions.WriteThrough);
      try {
        FileInformation info; Require(GetFileInformationByHandle(stream.SafeFileHandle,out info));
        Require(info.Links==1 && (info.Attributes&(uint)FileAttributes.ReparsePoint)==0);
        CheckAcl(path,false,sid); return stream;
      } catch { stream.Dispose(); throw; }
    }
    static byte[] Read(string path, SecurityIdentifier sid) {
      using(var stream=Open(path,FileMode.Open,sid)) {
        Require(stream.Length>0 && stream.Length<=MaxEnvelope);
        var bytes=new byte[(int)stream.Length]; int at=0;
        while(at<bytes.Length) {int count=stream.Read(bytes,at,bytes.Length-at);Require(count>0);at+=count;}
        return bytes;
      }
    }
    static void WriteNew(string path, byte[] bytes, SecurityIdentifier sid) {
      using(var stream=Open(path,FileMode.CreateNew,sid)) { stream.Write(bytes,0,bytes.Length); stream.Flush(true); }
    }
    static byte[] Entropy(string binding, string kind) {return Hash(Encoding.UTF8.GetBytes("KINGPEPE_DPAPI_V1\n"+kind+"\n"+binding));}
    static byte[] Seal(byte[] payload, ulong revision, string binding, string kind) {
      Require(payload.Length<=MaxPayload); byte[] plain;
      using(var buffer=new MemoryStream()) using(var writer=new BinaryWriter(buffer)) {
        writer.Write(Magic);writer.Write(revision);writer.Write(payload.Length);writer.Write(payload);plain=buffer.ToArray();
      }
      try { return ProtectedData.Protect(plain,Entropy(binding,kind),DataProtectionScope.CurrentUser); }
      finally { Array.Clear(plain,0,plain.Length); }
    }
    sealed class Envelope { public byte[] Payload; public ulong Revision; }
    static Envelope Unseal(byte[] sealedBytes,string binding,string kind) {
      byte[] plain=ProtectedData.Unprotect(sealedBytes,Entropy(binding,kind),DataProtectionScope.CurrentUser);
      try {
        using(var reader=new BinaryReader(new MemoryStream(plain))) {
          Require(Equal(reader.ReadBytes(4),Magic)); ulong revision=reader.ReadUInt64(); int length=reader.ReadInt32();
          Require(revision>0 && length>=0 && length<=MaxPayload && plain.Length==16+length);
          return new Envelope {Revision=revision,Payload=reader.ReadBytes(length)};
        }
      } finally {Array.Clear(plain,0,plain.Length);}
    }
    static void Replace(string source,string target,SecurityIdentifier sid) {
      CheckAcl(source,false,sid);CheckAcl(target,false,sid);File.Replace(source,target,null);
      using(var stream=Open(target,FileMode.Open,sid))stream.Flush(true);
    }
    // One authenticated file and one atomic replacement. No registry witness,
    // secondary anchor, clone detector or claimed full-host rollback protection.
    static byte[] RecoverAndRead(string root,string binding,SecurityIdentifier sid,out ulong revision) {
      string statePath=Path.Combine(root,StateName), pending=Path.Combine(root,PendingName);
      byte[] state=Read(statePath,sid); var current=Unseal(state,binding,"state");
      try {
        revision=current.Revision;
        if(File.Exists(pending)) {
          byte[] candidate=Read(pending,sid);var next=Unseal(candidate,binding,"state");
          try {
            Require(revision<ulong.MaxValue && next.Revision==revision+1);
            Replace(pending,statePath,sid);state=candidate;revision=next.Revision;
          } finally {Array.Clear(next.Payload,0,next.Payload.Length);}
        }
        return state;
      } finally {Array.Clear(current.Payload,0,current.Payload.Length);}
    }
    public static IDictionary<string,object> Execute(IDictionary<string,object> request,string sourceRoot) {
      string op=Text(request,"operation");
      if(op=="identity") {Require(request.Count==1);return new Dictionary<string,object>{{"sid",Identity()}};}
      Require(op=="create"||op=="read"||op=="write");
      Require(request.Count==(op=="write"?7:op=="create"?6:5));
      Require(Text(request,"protocol")=="KINGPEPE_WINDOWS_PROTECTED_STORE_V2");
      string identity=Text(request,"serviceSid");Require(identity==Identity());var sid=new SecurityIdentifier(identity);
      string root=Root(Text(request,"root"),sourceRoot),context=Text(request,"contextDigest");
      Require(context.Length==64);
      foreach(char c in context)Require((c>='0'&&c<='9')||(c>='a'&&c<='f'));
      string binding=context+"\n"+identity+"\n"+root.ToUpperInvariant();
      byte[] payload=null;
      try {
        if(op!="read") {payload=Convert.FromBase64String(Text(request,"payload"));Require(payload.Length<=MaxPayload);}
        if(op=="create") {
          Require(!Directory.Exists(root)&&!File.Exists(root));
          CreatePrivateDirectory(root,sid);
          WriteNew(Path.Combine(root,"lock.protected"),new byte[0],sid);
          WriteNew(Path.Combine(root,"lease.protected"),new byte[0],sid);
          using(var gate=Open(Path.Combine(root,"lock.protected"),FileMode.Open,sid))
            WriteNew(Path.Combine(root,StateName),Seal(payload,1,binding,"state"),sid);
          return new Dictionary<string,object>{{"revision","1"}};
        }
        CheckAcl(root,true,sid);
        using(var gate=Open(Path.Combine(root,"lock.protected"),FileMode.Open,sid)) {
          ulong revision;byte[] current=RecoverAndRead(root,binding,sid,out revision);
          if(op=="read") {
            var value=Unseal(current,binding,"state");
            try {return new Dictionary<string,object>{{"revision",revision.ToString(System.Globalization.CultureInfo.InvariantCulture)},{"payload",Convert.ToBase64String(value.Payload)}};}
            finally {Array.Clear(value.Payload,0,value.Payload.Length);}
          }
          Require(revision.ToString(System.Globalization.CultureInfo.InvariantCulture)==Text(request,"expectedRevision") && revision<ulong.MaxValue);
          ulong next=revision+1;byte[] nextState=Seal(payload,next,binding,"state");
          WriteNew(Path.Combine(root,PendingName),nextState,sid);
          Replace(Path.Combine(root,PendingName),Path.Combine(root,StateName),sid);
          return new Dictionary<string,object>{{"revision",next.ToString(System.Globalization.CultureInfo.InvariantCulture)}};
        }
      } finally {if(payload!=null)Array.Clear(payload,0,payload.Length);}
    }
    // The kernel handle prevents concurrent cooperating processes at this root.
    // It releases on exit; it is deliberately not a persistent clone/fence epoch.
    public static IDisposable AcquireLease(IDictionary<string,object> request,string sourceRoot) {
      Require(request.Count==4 && Text(request,"protocol")=="KINGPEPE_WINDOWS_PROTECTED_STORE_V2");
      string identity=Text(request,"serviceSid");Require(identity==Identity());var sid=new SecurityIdentifier(identity);
      string root=Root(Text(request,"root"),sourceRoot);CheckAcl(root,true,sid);
      return Open(Path.Combine(root,"lease.protected"),FileMode.Open,sid);
    }
  }
}
