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
    static FileStream Open(string path, FileMode mode, SecurityIdentifier sid) {
      if(mode==FileMode.Open) CheckAcl(path,false,sid);
      var stream=new FileStream(path,mode,FileAccess.ReadWrite,FileShare.None,4096,FileOptions.WriteThrough);
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
    static byte[] RecoverAndRead(string root,string anchorRoot,string binding,SecurityIdentifier sid,out ulong revision) {
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
          Replace(pendingAnchor,anchorPath,sid);anchor=nextAnchor;
        }
        ulong selected;CheckPair(candidate,anchor,binding,out selected);
        var old=Unseal(state,binding,"state");
        try {Require(old.Revision<ulong.MaxValue && selected==old.Revision+1);} finally {Array.Clear(old.Payload,0,old.Payload.Length);}
        Replace(pendingState,statePath,sid);state=candidate;
      }
      Require(!File.Exists(pendingAnchor));CheckPair(state,anchor,binding,out revision);return state;
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
          using(var gate=Open(Path.Combine(anchorRoot,"lock.protected"),FileMode.Open,sid)) {
            byte[] state=Seal(payload,1,binding,"state"),anchor=Seal(Hash(state),1,binding,"anchor");
            WriteNew(Path.Combine(root,StateName),state,sid);WriteNew(Path.Combine(anchorRoot,StateName),anchor,sid);
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
          Replace(Path.Combine(anchorRoot,PendingName),Path.Combine(anchorRoot,StateName),sid);
          Replace(Path.Combine(root,PendingName),Path.Combine(root,StateName),sid);
          return new Dictionary<string,object>{{"revision",next.ToString(System.Globalization.CultureInfo.InvariantCulture)}};
        }
      } finally {if(payload!=null)Array.Clear(payload,0,payload.Length);}
    }
  }
}
