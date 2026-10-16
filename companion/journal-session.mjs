import fs from 'node:fs/promises';
import path from 'node:path';
import {durableRecord,readJsonRecord} from './record-io.mjs';
import {processIdentity,ownerIsAlive} from './lease.mjs';
const startedAt=Date.now(),registered=new Map(),active=new Set();
export async function beginJournalSession(root,key){
 const identity=await processIdentity();active.add(key);
 if(!root)return identity;
 if(!registered.has(root)){
  const file=path.join(root,'.sessions',identity.session+'.json');
  const ready=durableRecord(file,identity).then(()=>{const timer=setInterval(()=>{void fs.utimes(file,new Date(),new Date()).catch(()=>{clearInterval(timer);registered.delete(root);});},10000);timer.unref();});
  registered.set(root,ready);ready.catch(()=>registered.delete(root));
 }
 try{await registered.get(root);return identity;}catch(e){active.delete(key);throw e;}
}
export function endJournalSession(key){active.delete(key);}
export async function journalInterrupted(root,key,folder,receipt){
 if(receipt.status!=='pending')return false;
 const own=await processIdentity();
 if(receipt.session===own.session)return !active.has(key);
 if(receipt.session){
  if(!/^[a-f0-9-]{36}$/.test(receipt.session))return false;
  const file=path.join(root,'.sessions',receipt.session+'.json'),record=await readJsonRecord(file);
  if(record.missing)return true;if(!record.ok)return false;
  return await ownerIsAlive(record.value)===false;
 }
 // Old-format pending receipts are never replayed. Only classify as interrupted
 // after proving no other process currently owns the authorized-folder lease.
 if(!Number.isFinite(Date.parse(receipt.startedAt))||Date.parse(receipt.startedAt)>=startedAt)return false;
 const ownerFile=path.join(path.dirname(root),'folder-locks',key.slice(0,64),'owner.json'),record=await readJsonRecord(ownerFile);
 if(record.missing)return true;if(!record.ok)return false;
 if(record.value.session===own.session)return true;
 return await ownerIsAlive(record.value)===false;
}
