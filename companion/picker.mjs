import {windowsCommand,systemEnvironment} from './system-tools.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function pickFolder(signal) {
  const options = { timeout: 120000, maxBuffer: 16384, windowsHide: true, env:systemEnvironment(), signal };
  let output;
  if (process.platform === 'win32') {
    const script = '$OutputEncoding=[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $picker=New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description="Select a working folder for Claude"; if($picker.ShowDialog() -eq "OK"){[Console]::Write($picker.SelectedPath)}; $picker.Dispose()';
    output = await execute(windowsCommand('powershell.exe'), ['-NoProfile', '-STA', '-Command', script], options);
  } else if (process.platform === 'darwin') {
    output = await execute('/usr/bin/osascript', ['-e', 'POSIX path of (choose folder with prompt "Select a working folder for Claude")'], options);
  } else {
    try { output = await execute('/usr/bin/zenity', ['--file-selection', '--directory', '--title=Select a working folder for Claude'], options); }
    catch (e) { if (e.code !== 'ENOENT') throw e; output = await execute('/usr/bin/kdialog', ['--getexistingdirectory', '.', '--title', 'Select a working folder for Claude'], options); }
  }
  return output.stdout.trim() || null;
}
