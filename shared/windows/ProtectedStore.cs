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
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace KingPepe.LocalProtection {
  public sealed class ProtectedWitnessRollbackException : InvalidOperationException {
    public ProtectedWitnessRollbackException() : base("PROTECTED_WITNESS_ROLLBACK") {}
  }
  public static class ProtectedStore {
    const int MaxPayload = 1048576;
    const int MaxEnvelope = MaxPayload + 16384;
    const string StateName = "state.protected";
    const string PendingName = "candidate.protected";
    static readonly byte[] Magic = Encoding.ASCII.GetBytes("KPS1");

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
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern int RegCreateKeyEx(SafeRegistryHandle parent,string name,uint reserved,string keyClass,uint options,
      int desiredAccess,ref SecurityAttributes attributes,out SafeRegistryHandle key,out uint disposition);

    static void Require(bool value) { if (!value) throw new InvalidOperationException("PROTECTED_STORE_REJECTED"); }
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
      Require(full.Equals(path.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase));
      // A drive letter alone does not prove local storage (for example SMB mappings).
      Require(new DriveInfo(Path.GetPathRoot(full)).DriveType==DriveType.Fixed);
      Require(!ContainsPath(source,full) && !ContainsPath(full,source));
      for(string p=full;p!=null;p=Path.GetDirectoryName(p)) {
        if(Directory.Exists(p)||File.Exists(p)) Require((File.GetAttributes(p)&FileAttributes.ReparsePoint)==0);
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
      Require(Directory.Exists(Path.GetDirectoryName(root)));
      var bytes=DirectoryAcl(sid).GetSecurityDescriptorBinaryForm(); IntPtr descriptor=Marshal.AllocHGlobal(bytes.Length);
      try {
        Marshal.Copy(bytes,0,descriptor,bytes.Length);
        var attributes=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=descriptor,Inherit=0};
        Require(CreateDirectory(root,ref attributes));
      } finally { Marshal.FreeHGlobal(descriptor); }
      CheckAcl(root,true,sid);
    }
    static void CheckAcl(string path, bool directory, SecurityIdentifier sid) {
      Require((File.GetAttributes(path)&FileAttributes.ReparsePoint)==0);
      FileSystemSecurity acl=directory?(FileSystemSecurity)Directory.GetAccessControl(path):File.GetAccessControl(path);
      Require(acl.GetOwner(typeof(SecurityIdentifier)).Equals(sid));
      if(directory) Require(acl.AreAccessRulesProtected);
      var rules=acl.GetAccessRules(true,true,typeof(SecurityIdentifier)); Require(rules.Count==1);
      foreach(FileSystemAccessRule rule in rules) Require(rule.IdentityReference.Equals(sid) &&
        rule.AccessControlType==AccessControlType.Allow && rule.FileSystemRights==FileSystemRights.FullControl);
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
    static void CheckPair(byte[] state,byte[] anchor,string binding,out ulong revision) {
      var a=Unseal(anchor,binding,"anchor");
      try { Require(Equal(a.Payload,Hash(state))); var s=Unseal(state,binding,"state");
        try {Require(s.Revision==a.Revision);revision=s.Revision;} finally {Array.Clear(s.Payload,0,s.Payload.Length);}
      } finally {Array.Clear(a.Payload,0,a.Payload.Length);}
    }
    // A separately retained service-profile witness survives restoration of the
    // ordinary state/anchor/fence backup files. It is NOT hardware monotonic:
    // co-restoring the service profile/registry and files can evade this check.
    const string WitnessParent = "Software\\KingPepe\\ProtectedWitnessV1\\";
    static string WitnessName(string binding) {
      return WitnessParent+BitConverter.ToString(Hash(Encoding.UTF8.GetBytes(binding))).Replace("-", "").ToLowerInvariant();
    }
    static void CheckWitnessAcl(RegistryKey key,SecurityIdentifier sid) {
      Require(key!=null && key.SubKeyCount==0);
      var acl=key.GetAccessControl();Require(acl.AreAccessRulesProtected && acl.GetOwner(typeof(SecurityIdentifier)).Equals(sid));
      var rules=acl.GetAccessRules(true,true,typeof(SecurityIdentifier));Require(rules.Count==1);
      foreach(RegistryAccessRule rule in rules)Require(rule.IdentityReference.Equals(sid) &&
        rule.AccessControlType==AccessControlType.Allow && rule.RegistryRights==RegistryRights.FullControl);
    }
    static RegistryKey OpenWitness(string binding,SecurityIdentifier sid,bool create) {
      // An impersonating helper must not accidentally use the process's profile.
      Require(WindowsIdentity.GetCurrent().ImpersonationLevel==TokenImpersonationLevel.None);
      using(var user=RegistryKey.OpenBaseKey(RegistryHive.CurrentUser,RegistryView.Registry64)) {
        RegistryKey key;
        if(create) {
          var acl=new RegistrySecurity();acl.SetOwner(sid);acl.SetAccessRuleProtection(true,false);
          acl.AddAccessRule(new RegistryAccessRule(sid,RegistryRights.FullControl,InheritanceFlags.None,PropagationFlags.None,AccessControlType.Allow));
          var bytes=acl.GetSecurityDescriptorBinaryForm();IntPtr descriptor=Marshal.AllocHGlobal(bytes.Length);
          try {
            Marshal.Copy(bytes,0,descriptor,bytes.Length);
            var attributes=new SecurityAttributes {Length=Marshal.SizeOf(typeof(SecurityAttributes)),Descriptor=descriptor,Inherit=0};
            SafeRegistryHandle handle;uint disposition;
            int error=RegCreateKeyEx(user.Handle,WitnessName(binding),0,null,0,0xF003F|0x0100,ref attributes,out handle,out disposition);
            if(error!=0 || disposition!=1) { if(handle!=null)handle.Dispose();Require(false); }
            key=RegistryKey.FromHandle(handle,RegistryView.Registry64);
          } finally {Marshal.FreeHGlobal(descriptor);}
        } else key=user.OpenSubKey(WitnessName(binding),RegistryKeyPermissionCheck.ReadWriteSubTree,RegistryRights.FullControl);
        try {CheckWitnessAcl(key,sid);return key;} catch {if(key!=null)key.Dispose();throw;}
      }
    }
    static Envelope ReadWitness(RegistryKey key,string binding) {
      Require(key.ValueCount==1 && key.GetValueNames()[0]=="state" && key.GetValueKind("state")==RegistryValueKind.Binary);
      var bytes=key.GetValue("state",null,RegistryValueOptions.DoNotExpandEnvironmentNames) as byte[];
      Require(bytes!=null && bytes.Length>0 && bytes.Length<=16384);
      var value=Unseal(bytes,binding,"registry-witness");Require(value.Payload.Length==32);return value;
    }
    static void WriteWitness(RegistryKey key,string binding,ulong revision,byte[] stateHash) {
      var bytes=Seal(stateHash,revision,binding,"registry-witness");
      key.SetValue("state",bytes,RegistryValueKind.Binary);key.Flush();
      var check=ReadWitness(key,binding);Require(check.Revision==revision && Equal(check.Payload,stateHash));
    }
    static void MatchWitness(RegistryKey key,string binding,ulong revision,byte[] state) {
      var check=ReadWitness(key,binding);
      if(check.Revision!=revision || !Equal(check.Payload,Hash(state)))throw new ProtectedWitnessRollbackException();
    }
    static void AdvanceWitness(RegistryKey key,string binding,ulong previous,byte[] state,ulong next,byte[] candidate) {
      Require(previous<ulong.MaxValue && next==previous+1);
      var check=ReadWitness(key,binding);
      // Idempotent recovery accepts exactly the already witnessed next image,
      // never a lower generation, arbitrary new hash or a missing enrollment.
      if(check.Revision==next) {if(!Equal(check.Payload,Hash(candidate)))throw new ProtectedWitnessRollbackException();return;}
      if(check.Revision!=previous || !Equal(check.Payload,Hash(state)))throw new ProtectedWitnessRollbackException();
      WriteWitness(key,binding,next,Hash(candidate));
    }
    static byte[] RecoverAndRead(string root,string anchorRoot,string binding,SecurityIdentifier sid,out ulong revision) {
      using(var witness=OpenWitness(binding,sid,false)) {
      string statePath=Path.Combine(root,StateName), anchorPath=Path.Combine(anchorRoot,StateName);
      string pendingState=Path.Combine(root,PendingName), pendingAnchor=Path.Combine(anchorRoot,PendingName);
      byte[] state=Read(statePath,sid), anchor=Read(anchorPath,sid);
      if(File.Exists(pendingState)) {
        byte[] candidate=Read(pendingState,sid);
        if(File.Exists(pendingAnchor)) {
          // Complete only a fully authenticated, exact next-revision prepared commit.
          ulong previous,next; CheckPair(state,anchor,binding,out previous);
          byte[] nextAnchor=Read(pendingAnchor,sid);CheckPair(candidate,nextAnchor,binding,out next);
          Require(previous<ulong.MaxValue && next==previous+1);
          AdvanceWitness(witness,binding,previous,state,next,candidate);
          Replace(pendingAnchor,anchorPath,sid);anchor=nextAnchor;
        }
        ulong selected;CheckPair(candidate,anchor,binding,out selected);
        var old=Unseal(state,binding,"state");
        try {Require(old.Revision<ulong.MaxValue && selected==old.Revision+1);} finally {Array.Clear(old.Payload,0,old.Payload.Length);}
        MatchWitness(witness,binding,selected,candidate);
        Replace(pendingState,statePath,sid);state=candidate;
      }
      Require(!File.Exists(pendingAnchor));CheckPair(state,anchor,binding,out revision);
      MatchWitness(witness,binding,revision,state);return state;
      }
    }
    public static IDictionary<string,object> Execute(IDictionary<string,object> request,string sourceRoot) {
      string op=Text(request,"operation");
      if(op=="identity") {Require(request.Count==1);return new Dictionary<string,object>{{"sid",Identity()}};}
      Require(op=="create"||op=="read"||op=="write");
      Require(request.Count==(op=="write"?8:op=="create"?7:6));
      Require(Text(request,"protocol")=="KINGPEPE_WINDOWS_PROTECTED_STORE_V1");
      string identity=Text(request,"serviceSid");Require(identity==Identity());var sid=new SecurityIdentifier(identity);
      string root=Root(Text(request,"root"),sourceRoot),anchorRoot=Root(Text(request,"anchorRoot"),sourceRoot);
      Require(!ContainsPath(root,anchorRoot)&&!ContainsPath(anchorRoot,root));
      string context=Text(request,"contextDigest");Require(context.Length==64);
      foreach(char c in context)Require((c>='0'&&c<='9')||(c>='a'&&c<='f'));
      // Copying envelopes to another root/context must not silently preserve authority.
      string binding=context+"\n"+identity+"\n"+root.ToUpperInvariant()+"\n"+anchorRoot.ToUpperInvariant();
      byte[] payload=null;
      try {
        if(op!="read") {payload=Convert.FromBase64String(Text(request,"payload"));Require(payload.Length<=MaxPayload);}
        if(op=="create") {
          Require(!Directory.Exists(root)&&!Directory.Exists(anchorRoot)&&!File.Exists(root)&&!File.Exists(anchorRoot));
          CreatePrivateDirectory(root,sid);CreatePrivateDirectory(anchorRoot,sid);
          WriteNew(Path.Combine(anchorRoot,"lock.protected"),new byte[0],sid);
          WriteNew(Path.Combine(anchorRoot,"lifetime.protected"),new byte[0],sid);
          using(var gate=Open(Path.Combine(anchorRoot,"lock.protected"),FileMode.Open,sid)) {
            byte[] state=Seal(payload,1,binding,"state"),anchor=Seal(Hash(state),1,binding,"anchor");
            WriteNew(Path.Combine(root,StateName),state,sid);WriteNew(Path.Combine(anchorRoot,StateName),anchor,sid);
            using(var witness=OpenWitness(binding,sid,true))WriteWitness(witness,binding,1,Hash(state));
          }
          return new Dictionary<string,object>{{"revision","1"}};
        }
        CheckAcl(root,true,sid);CheckAcl(anchorRoot,true,sid);
        using(var gate=Open(Path.Combine(anchorRoot,"lock.protected"),FileMode.Open,sid)) {
          ulong revision;byte[] current=RecoverAndRead(root,anchorRoot,binding,sid,out revision);
          if(op=="read") {
            var value=Unseal(current,binding,"state");
            try {return new Dictionary<string,object>{{"revision",revision.ToString(System.Globalization.CultureInfo.InvariantCulture)},{"payload",Convert.ToBase64String(value.Payload)}};}
            finally {Array.Clear(value.Payload,0,value.Payload.Length);}
          }
          string expected=Text(request,"expectedRevision");
          Require(revision.ToString(System.Globalization.CultureInfo.InvariantCulture)==expected && revision<ulong.MaxValue);
          ulong next=revision+1;byte[] nextState=Seal(payload,next,binding,"state");
          byte[] nextAnchor=Seal(Hash(nextState),next,binding,"anchor");
          WriteNew(Path.Combine(root,PendingName),nextState,sid);
          WriteNew(Path.Combine(anchorRoot,PendingName),nextAnchor,sid);
          using(var witness=OpenWitness(binding,sid,false))AdvanceWitness(witness,binding,revision,current,next,nextState);
          Replace(Path.Combine(anchorRoot,PendingName),Path.Combine(anchorRoot,StateName),sid);
          Replace(Path.Combine(root,PendingName),Path.Combine(root,StateName),sid);
          return new Dictionary<string,object>{{"revision",next.ToString(System.Globalization.CultureInfo.InvariantCulture)}};
        }
      } finally {if(payload!=null)Array.Clear(payload,0,payload.Length);}
    }

    public static IDisposable AcquireLifetimeLease(IDictionary<string,object> request,string sourceRoot) {
      Require(request.Count==5 && Text(request,"protocol")=="KINGPEPE_WINDOWS_PROTECTED_STORE_V1");
      string identity=Text(request,"serviceSid");Require(identity==Identity());var sid=new SecurityIdentifier(identity);
      string root=Root(Text(request,"root"),sourceRoot),anchor=Root(Text(request,"anchorRoot"),sourceRoot);
      Require(!ContainsPath(root,anchor)&&!ContainsPath(anchor,root));CheckAcl(root,true,sid);CheckAcl(anchor,true,sid);
      // This file must have been explicitly provisioned with the protected store.
      // Never create/adopt an absent lease on ordinary open/restart.
      return Open(Path.Combine(anchor,"lifetime.protected"),FileMode.Open,sid);
    }
  }
}
