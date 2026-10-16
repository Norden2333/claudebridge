import {stateRoot} from './settings.mjs';
import {protectKeyring,unprotectKeyring} from './keyring-session.mjs';
import {spawn} from 'node:child_process';
import {windowsCommand,systemEnvironment} from './system-tools.mjs';
const marker='cfb-session/dpapi-v1';
async function transform(value,decrypt=false){
 if(process.platform!=='win32')throw new Error('Persistent remote login requires an OS credential protector on this platform.');
 const input=JSON.stringify(value);if(Buffer.byteLength(input)>262144)throw new Error('Login state is too large');
 const script=`$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=${decrypt?"[Convert]::FromBase64String($v)":"[Text.Encoding]::UTF8.GetBytes($v)"};$r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write(${decrypt?"[Text.Encoding]::UTF8.GetString($r)":"[Convert]::ToBase64String($r)"});`;
 return new Promise((resolve,reject)=>{
  const child=spawn(windowsCommand('powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:systemEnvironment(),stdio:['pipe','pipe','pipe']});
  let output='',size=0,settled=false;const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(new Error('OS login protection failed; no plaintext fallback.')):resolve(result);};
  const timer=setTimeout(()=>{child.kill();done(true);},30000);
  child.on('error',()=>done(true));child.stdin.on('error',()=>done(true));
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>1048576){child.kill();done(true);}else output+=chunk.toString('utf8');});child.stderr.resume();
  child.on('close',code=>done(code!==0,output));
  child.stdin.end(decrypt?value:input,'utf8');
 });
}
export async function protectSession(session){
 if(!session)return null;
 if(process.platform!=='win32')return ['darwin','linux'].includes(process.platform)?protectKeyring(session,{platform:process.platform,root:stateRoot}):null;
 return {protection:marker,ciphertext:await transform(session)};
}
export async function unprotectSession(stored){
 if(!stored)return null;
 if(process.platform!=='win32')return ['darwin','linux'].includes(process.platform)?unprotectKeyring(stored,{platform:process.platform,root:stateRoot}):null;
 if(stored.protection!==marker||typeof stored.ciphertext!=='string')return null; // Old plaintext requires fresh authorization.
 const decoded=JSON.parse(await transform(stored.ciphertext,true));
 if(typeof decoded.access_token!=='string'||typeof decoded.refresh_token!=='string')throw new Error('Invalid protected session');
 return decoded;
}
