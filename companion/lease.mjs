import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {windowsCommand,systemEnvironment} from './system-tools.mjs';
const run=promisify(execFile),session=crypto.randomUUID(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function processBirth(pid){
 try{
  if(process.platform==='win32'){
   const {stdout}=await run(windowsCommand('powershell.exe'),['-NoProfile','-NonInteractive','-Command',`[Console]::Write((Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks)`],{windowsHide:true,timeout:2000,env:systemEnvironment(),maxBuffer:1024});return stdout.trim()||null;
  }
  if(process.platform==='linux'){const stat=await fs.readFile('/proc/'+pid+'/stat','utf8');return stat.slice(stat.lastIndexOf(')')+2).split(' ')[19]||null;}
  const {stdout}=await run('/bin/ps',['-p',String(pid),'-o','lstart='],{timeout:2000,maxBuffer:1024});return stdout.trim()||null;
 }catch{return null;}
}
const ownBirth=processBirth(process.pid);
export async function processIdentity(){return {pid:process.pid,session,processBirth:await ownBirth};}
export async function ownerIsAlive(owner){
 if(!Number.isInteger(owner?.pid)||owner.pid<1)return null;
 try{process.kill(owner.pid,0);}catch(e){return e.code==='ESRCH'?false:null;}
 if(owner.processBirth){const birth=await processBirth(owner.pid);if(birth)return birth===owner.processBirth;}
 return true;
}
async function snapshot(file){
 try{const stat=await fs.lstat(file);if(stat.isSymbolicLink()||!stat.isFile())return {stat,invalid:true};const raw=await fs.readFile(file,'utf8');let owner;try{owner=JSON.parse(raw);}catch{}
  if(typeof owner==='number')owner={pid:owner,legacy:true};
  return {stat,raw,owner,invalid:!owner||!Number.isInteger(owner.pid)||owner.pid<1};
 }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function abandoned(s,staleMs){
 if(!s)return false;
 const age=Date.now()-s.stat.mtimeMs;
 if(s.invalid)return age>30000;
 try{process.kill(s.owner.pid,0);}catch(e){if(e.code==='ESRCH')return true;if(e.code!=='EPERM')throw e;}
 if(age<=staleMs)return false;
 // A fresh process-start identity proves PID reuse. A live matching owner is
 // never stolen just because a heartbeat was delayed or the machine slept.
 const birth=await processBirth(s.owner.pid);
 if(s.owner.processBirth&&birth)return birth!==s.owner.processBirth;
 if(!s.owner.processBirth&&process.platform==='win32'&&/^\d+$/.test(birth||'')){const born=Number(BigInt(birth)/10000n-62135596800000n);if(born>s.stat.mtimeMs+1000)return true;}
 if(s.owner.pid===process.pid&&s.owner.session&&s.owner.session!==session)return true;
 return false;
}
async function moveStale(file,expected){
 const current=await snapshot(file);if(!current||current.raw!==expected.raw||current.stat.mtimeMs!==expected.stat.mtimeMs)return false;
 const stale=file+'.stale-'+crypto.randomUUID();try{await fs.rename(file,stale);}catch(e){if(['ENOENT','EEXIST','EPERM'].includes(e.code))return false;throw e;}
 await fs.rm(stale,{force:true});return true;
}
// All callers enter this short acquisition gate before examining or replacing
// the actual lease, so competing reclaimers cannot rename a new owner's lease.
async function gated(file,action,deadline){
 const gate=file+'.gate',token=crypto.randomUUID();
 for(;;){
  let handle;
  try{handle=await fs.open(gate,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;const old=await snapshot(gate);if(old&&await abandoned(old,30000))await moveStale(gate,old);if(Date.now()>=deadline)throw new Error('锁状态正在核对，本次未开始。');await sleep(40);continue;}
  let initialized=false;try{await handle.writeFile(JSON.stringify({pid:process.pid,session,token,processBirth:await ownBirth}));await handle.sync();initialized=true;return await action();}
  finally{await handle.close();const current=await snapshot(gate);if(!initialized||current?.owner?.token===token)await fs.unlink(gate);}
 }
}
export async function acquireLease(target,{directory=false,waitMs=0,staleMs=120000,heartbeatMs=10000,inspectOwner=abandoned,onWait}={}){
 await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
 const ownerFile=directory?path.join(target,'owner.json'):target,deadline=Date.now()+waitMs,token=crypto.randomUUID();
 const owner={pid:process.pid,session,token,startedAt:new Date().toISOString(),processBirth:await ownBirth};
 for(;;){
  const acquired=await gated(target,async()=>{
   let existing=await snapshot(ownerFile);
   if(directory&&!existing){try{const stat=await fs.lstat(target);existing={stat,invalid:true};}catch(e){if(e.code!=='ENOENT')throw e;}}
   if(existing){
    if(!await inspectOwner(existing,staleMs))return false;
    // Gate-held recheck avoids replacing an owner whose heartbeat just changed.
    const check=await snapshot(ownerFile);if(check?.raw!==existing.raw||check&&check.stat.mtimeMs!==existing.stat.mtimeMs)return false;
    const stale=target+'.stale-'+crypto.randomUUID();await fs.rename(target,stale);await fs.rm(stale,{recursive:directory,force:true});
   }
   let created=false,createdFile=false;
   try{
    if(directory){await fs.mkdir(target,{mode:0o700});created=true;}
    const handle=await fs.open(ownerFile,'wx',0o600);createdFile=true;try{await handle.writeFile(JSON.stringify(owner));await handle.sync();}finally{await handle.close();}
    return true;
   }catch(e){if(created)await fs.rm(target,{recursive:true,force:true});else if(createdFile)await fs.rm(ownerFile,{force:true});if(e.code==='EEXIST')return false;throw e;}
  },deadline);
  if(acquired)break;
  if(onWait)await onWait({remainingMs:Math.max(0,deadline-Date.now())});
  if(Date.now()>=deadline)throw Object.assign(new Error('其他文件操作仍在进行，本次未开始。请稍后再试。'),{code:'CFB_LEASE_BUSY'});
  await sleep(Math.min(100,Math.max(1,deadline-Date.now())));
 }
 let heartbeat=Promise.resolve(),lost=false,releasing;
 const timer=setInterval(()=>{heartbeat=heartbeat.then(async()=>{const now=await snapshot(ownerFile);if(now?.owner?.token!==token){lost=true;return;}await fs.utimes(ownerFile,new Date(),new Date());}).catch(()=>{lost=true;});},heartbeatMs);timer.unref();
 const assertOwned=async()=>{const current=await snapshot(ownerFile);if(lost||current?.owner?.token!==token)throw new Error('操作锁已失效，请核对结果；不会自动重做。');};
 return {assertOwned,release(){return releasing??=(async()=>{clearInterval(timer);await heartbeat;await gated(target,async()=>{const current=await snapshot(ownerFile);if(current?.owner?.token===token)await fs.rm(target,{recursive:directory,force:true});},Date.now()+3000);})();}};
}
