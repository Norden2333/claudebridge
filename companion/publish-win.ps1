$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ClaudeFolderPublish {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
 [return:MarshalAs(UnmanagedType.Bool)]
 static extern bool MoveFileEx(string source,string destination,uint flags);
 static string Extended(string value){
  if(value.StartsWith(@"\\?\"))return value;
  return value.StartsWith(@"\\")?@"\\?\UNC\"+value.Substring(2):@"\\?\"+value;
 }
 public static int Publish(string source,string destination){
  if(String.IsNullOrWhiteSpace(source)||String.IsNullOrWhiteSpace(destination))return 87;
  return MoveFileEx(Extended(source),Extended(destination),0)?0:Marshal.GetLastWin32Error();
 }
}
'@
$result = [ClaudeFolderPublish]::Publish($env:CFB_PUBLISH_SOURCE,$env:CFB_PUBLISH_TARGET)
[Console]::Write(('{"published":'+($result -eq 0).ToString().ToLowerInvariant()+',"error":'+$result+'}'))
if ($result -ne 0) { exit 1 }
