import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readBounded} from './safe-io.mjs';
export async function readJsonRecord(file,valid=()=>true){
 try{const value=JSON.parse((await readBounded(file,32*1024**2)).toString('utf8'));return valid(value)?{ok:true,value}:{ok:false,corrupt:true};}
 catch(error){if(error.code==='ENOENT')return {ok:false,missing:true};return {ok:false,corrupt:true};}
}
export async function durableRecord(file,value){
 const temp=file+'.record-'+crypto.randomUUID()+'.tmp';await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 try{const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}await fs.rename(temp,file);}
 finally{await fs.rm(temp,{force:true});}
}
export function validBackup(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&/^[0-9a-f-]{36}$/.test(value.backupId||'')&&/^[a-f0-9]{64}$/.test(value.folderHash||'')&&typeof value.path==='string'&&!!value.path&&!path.isAbsolute(value.path)&&!value.path.split(/[\\/]/).includes('..')&&/^[a-f0-9]{64}$/.test(value.beforeSha256||'')&&/^[a-f0-9]{64}$/.test(value.afterSha256||'')&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt));}
