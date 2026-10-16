import fs from 'node:fs/promises';import path from 'node:path';import {readJsonRecord,durableRecord} from './record-io.mjs';import {folderLock} from './folder-lock.mjs';
export const withBackupLock=(root,action)=>folderLock('private-backups:'+path.resolve(root),path.join(path.dirname(root),'backup-locks'),action,{waitMs:60000});
const valid=v=>v?.version===1&&['activeBytes','activeCount','archiveBytes','archiveCount','checkedAt'].every(k=>Number.isSafeInteger(v[k])&&v[k]>=0);
export async function writeBackupUsage(root,value){const record={version:1,activeBytes:value.activeBytes,activeCount:value.activeCount,archiveBytes:value.archiveBytes,archiveCount:value.archiveCount,checkedAt:Date.now()};if(!valid(record))throw new Error('备份用量记录无效。');await durableRecord(path.join(root,'usage.json'),record);return record;}
export async function invalidateBackupUsage(root){await fs.rm(path.join(root,'usage.json'),{force:true});}
export async function readBackupUsage(root,{force=false}={}){
 if(!force){const read=await readJsonRecord(path.join(root,'usage.json'),valid);if(read.ok&&Date.now()-read.value.checkedAt>=0&&Date.now()-read.value.checkedAt<30000)return read.value;}
 const usage={activeBytes:0,activeCount:0,archiveBytes:0,archiveCount:0};for(const [dir,kind]of [[root,'active'],[path.join(root,'archive'),'archive']]){let names;try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')continue;throw e;}for(const name of names.filter(v=>/^[0-9a-f-]{36}\.bin$/.test(v))){const stat=await fs.lstat(path.join(dir,name));if(stat.isFile()&&!stat.isSymbolicLink()){usage[kind+'Bytes']+=stat.size;usage[kind+'Count']++;}}}return writeBackupUsage(root,usage);
}
