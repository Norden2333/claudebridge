import {windowsCommand,systemEnvironment} from './system-tools.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
const run = promisify(execFile);
// These fixed helpers accept a single path as data, never executable code.
export function trashCommand(target, platform = process.platform) {
  if (platform === 'win32') return { command: windowsCommand('powershell.exe'), args: ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./recycle-item.ps1', import.meta.url))], env: { CLAUDE_RECYCLE_TARGET: target } };
  if (platform === 'darwin') return { command: '/usr/bin/osascript', args: ['-l', 'JavaScript', fileURLToPath(new URL('./trash-macos.js', import.meta.url)), target], env: {} };
  if (platform === 'linux') return { command: '/usr/bin/gio', args: ['trash', '--', target], env: {} };
  throw new Error('此系统的回收站尚不支持；不会改成永久删除。');
}
function recycleError(code,message,extra={}){return Object.assign(new Error(message),{code,...extra});}
async function sourceSummary(target){
 try{
  const info=await fs.lstat(target);
  if(!info.isDirectory())return {sourceState:'present',remainingEntries:1};
  let count=0;const queue=[target],deadline=Date.now()+1000;
  while(queue.length&&count<100000&&Date.now()<deadline){
   const dir=queue.pop();for(const entry of await fs.readdir(dir,{withFileTypes:true})){count++;if(entry.isDirectory()&&!entry.isSymbolicLink())queue.push(dir+'/'+entry.name);if(count>=100000||Date.now()>=deadline)break;}
  }
  return {sourceState:'present',remainingEntries:count,remainingCountTruncated:queue.length>0||count>=100000||Date.now()>=deadline};
 }catch(e){return {sourceState:e.code==='ENOENT'?'missing':'unknown'};}
}
export async function moveToTrash(target,{entries=1,platform=process.platform,runner=run}={}) {
 if(platform==='win32'&&/^[\\/]{2}/.test(target))throw recycleError('CFB_RECYCLE_UNSUPPORTED','该位置不支持系统回收站，未删除。');
 const plan=trashCommand(target,platform),timeout=Math.min(600000,30000+Math.max(0,Math.min(100000,Number.isSafeInteger(entries)?entries:1))*5);
 let response,failure;
 try{response=await runner(plan.command,plan.args,{windowsHide:true,timeout,maxBuffer:16384,env:{...systemEnvironment(),...plan.env}});}catch(e){failure=e;}
 let receipt;
 if(platform==='win32'){try{receipt=JSON.parse(response?.stdout||failure?.stdout||'');}catch{}}
 if(receipt?.permanentlyDeleted===true)throw recycleError('CFB_PERMANENTLY_DELETED','系统报告该项已永久删除，无法从回收站恢复。',{permanentlyDeleted:true,recoverable:false});
 if(receipt?.reason==='not_recyclable')throw recycleError('CFB_RECYCLE_UNSUPPORTED','该位置不支持系统回收站，未删除。');
 if(failure||platform==='win32'&&(receipt?.recycled!==true||receipt?.confirmedItem!==true)){
  const summary=await sourceSummary(target);
  throw recycleError('CFB_RESULT_UNKNOWN','回收结果未知，请在回收站和原位置核对，不要直接重做。',summary);
 }
 const summary=await sourceSummary(target);
 if(summary.sourceState!=='missing')throw recycleError('CFB_RESULT_UNKNOWN','未确认原位置已移除，请在回收站和原位置核对，不要直接重做。',summary);
 return {recycled:true,permanent:false,recoverable:true};
}
