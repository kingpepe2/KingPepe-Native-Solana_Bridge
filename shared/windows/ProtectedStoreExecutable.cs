// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
// The same reviewed DPAPI/ACL/CAS implementation, without recompiling it for
// every protected read/write. No daemon, plaintext cache or new storage format.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;

namespace KingPepe.LocalProtection {
  public static class ProtectedStoreExecutable {
    public static int Main(string[] arguments) {
      try {
        if(arguments.Length!=1 || !Console.IsInputRedirected || !Console.IsOutputRedirected)
          throw new InvalidOperationException();
        // Validate the cache's actual DACL and executable before reading the
        // anonymous input pipe. Node also pins the freshly compiled file hash.
        ProtectedStore.CheckExecutableDirectory(Assembly.GetExecutingAssembly().Location,arguments[0]);
        var input=new StringBuilder(); var buffer=new char[4096]; int count;
        try {
          while((count=Console.In.Read(buffer,0,buffer.Length))>0) {
            if(input.Length+count>1500000)throw new InvalidOperationException();
            input.Append(buffer,0,count);
          }
          var serializer=new JavaScriptSerializer(); serializer.MaxJsonLength=1500000;
          var request=serializer.DeserializeObject(input.ToString()) as IDictionary<string,object>;
          if(request==null)throw new InvalidOperationException();
          Console.Out.Write(serializer.Serialize(ProtectedStore.Execute(request,arguments[0])));
          return 0;
        } finally { Array.Clear(buffer,0,buffer.Length); input.Clear(); }
      } catch {
        // No source paths, principal names, request values or exception text.
        Console.Error.Write("WINDOWS_PROTECTED_STORE_REJECTED"); return 1;
      }
    }
  }
}
