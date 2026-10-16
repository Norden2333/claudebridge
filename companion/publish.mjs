import {processingDeadline} from './budget.mjs';
import fs from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {windowsCommand,systemEnvironment} from './system-tools.mjs';
const run=promisify(execFile);
export async function publishExclusive(source,target){
 if(Date.now()>processingDeadline())throw new Error('文件处理时间预算已耗尽，未发布目标文件。');
 try{await fs.link(source,target);return {method:'hardlink'};}catch(e){if(process.platform!=='win32'||!['EPERM','ENOTSUP','EOPNOTSUPP','ENOSYS'].includes(e.code))throw e;}
 return windowsMoveExclusive(source,target);
}
export async function moveExclusive(source,target){
 if(Date.now()>processingDeadline())throw new Error('文件处理时间预算已耗尽，未移动。');
 if(process.platform==='win32')return windowsMoveExclusive(source,target);
 await fs.link(source,target);await fs.unlink(source);return {method:'same_volume_link_move'};
}
async function windowsMoveExclusive(source,target){
 let response,error;try{response=await run(windowsCommand('powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./publish-win.ps1',import.meta.url))],{windowsHide:true,timeout:20000,maxBuffer:4096,env:{...systemEnvironment(),CFB_PUBLISH_SOURCE:source,CFB_PUBLISH_TARGET:target}});}catch(e){error=e;}
 let result;try{result=JSON.parse(response?.stdout||error?.stdout||'');}catch{}
 if(result?.published===true)return {method:'windows_move'};
 if(result?.error===17)throw Object.assign(new Error('跨文件系统移动需要复制。'),{code:'EXDEV'});
 if([80,183].includes(result?.error))throw Object.assign(new Error('目标名称已存在，没有覆盖。'),{code:'EEXIST'});
 throw Object.assign(new Error('文件发布结果未确认，请核对原编号；没有重试或覆盖目标。'),{code:'CFB_PUBLISH_UNKNOWN'});
}
