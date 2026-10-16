using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Windows.Forms;
[assembly:System.Reflection.AssemblyTitle("Claude 文件连接安装向导")]
[assembly:System.Reflection.AssemblyVersion("0.6.0.0")]
class SetupLauncher {
 [STAThread] static int Main(string[] args) {
  bool selfTest=args.Length==1 && args[0]=="--self-test";
  if(args.Length>0&&!selfTest)return 2;
  try {
   string script=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Windows安装向导.ps1");
   string actual;
   using(var input=File.OpenRead(script))using(var sha=SHA256.Create())actual=BitConverter.ToString(sha.ComputeHash(input)).Replace("-","").ToLowerInvariant();
   if(actual!="ea5ce1b945ff9b59b58e336ebd2aaf168abca3df7c9dd2ae04bde77a7fa6694c")throw new Exception("安装向导校验失败，请重新获取完整安装包。");
   var info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),@"WindowsPowerShell\v1.0\powershell.exe"));
   string escapedScript=script.Replace("'","''");
   info.Arguments="-NoProfile -STA -ExecutionPolicy Bypass -Command \"$env:PSModulePath=[IO.Path]::Combine($env:WINDIR,'System32','WindowsPowerShell','v1.0','Modules'); & '"+escapedScript+"'"+(selfTest?" -SelfTest":"")+"\"";
   info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardOutput=true;info.RedirectStandardError=true;info.StandardOutputEncoding=Encoding.UTF8;info.StandardErrorEncoding=Encoding.UTF8;
   using(var child=Process.Start(info)) {
    var output=child.StandardOutput.ReadToEndAsync();var error=child.StandardError.ReadToEndAsync();child.WaitForExit();
    if(child.ExitCode!=0){if(selfTest)Console.Error.Write(error.Result);if(!selfTest)MessageBox.Show("安装向导没有完成：\n"+error.Result,"Claude 文件连接",MessageBoxButtons.OK,MessageBoxIcon.Information);return child.ExitCode;}
    if(selfTest)Console.Write(output.Result);return 0;
   }
  } catch(Exception error){if(selfTest)Console.Error.Write(error.Message);if(!selfTest)MessageBox.Show(error.Message,"Claude 文件连接",MessageBoxButtons.OK,MessageBoxIcon.Information);return 1;}
 }
}
