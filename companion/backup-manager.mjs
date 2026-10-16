import {withBackupLock,invalidateBackupUsage,writeBackupUsage} from './backup-usage.mjs';
import {readJsonRecord,durableRecord,validBackup} from './record-io.mjs';
import fs from 'node:fs/promises';
import {moveToTrash} from './trash.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {copyVerified} from './safe-io.mjs';
import {processingDeadline} from './budget.mjs';
import {folderLock} from './folder-lock.mjs';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export async function backupAction(executor,action,v={}){const history=executor.history,root=history.root;
 if(!root)throw new Error('没有持久化恢复目录。');await fs.mkdir(root,{recursive:true,mode:0o700});
 return folderLock(executor.config.folder,executor.lockRoot,()=>withBackupLock(root,async()=>{
  const deadline=processingDeadline();const archived=path.join(root,'archive');
  if(action==='workspace_backups'){
   const records=[],archives=[];let activeBytes=0,archiveBytes=0,count=0,corruptCount=0,archiveCount=0;
   for(const base of [root,archived]){let names=[];try{names=await fs.readdir(base);}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const n of names.filter(x=>/^[0-9a-f-]{36}\.bin$/.test(x))){const info=await fs.lstat(path.join(base,n));if(!info.isFile())continue;if(base===root){activeBytes+=info.size;count++;}else{archiveBytes+=info.size;archiveCount++;}}
    for(const n of names.filter(x=>/^[0-9a-f-]{36}\.json$/.test(x))){if(Date.now()>deadline)throw new Error('备份索引超时，未修改任何文件。');const read=await readJsonRecord(path.join(base,n),v=>validBackup(v)&&v.backupId===n.slice(0,-5));if(!read.ok){if(read.corrupt)corruptCount++;continue;}const r=read.value;if(r.folderHash===hash(executor.config.folder))(base===root?records:archives).push(r);}
   }
   for(const n of (await fs.readdir(root)).filter(x=>/^removed-backup-[0-9a-f-]{36}$/.test(x))){const id=n.slice(15);try{const r=JSON.parse(await fs.readFile(path.join(root,n,id+'.json'),'utf8'));if(r.folderHash===hash(executor.config.folder)){archives.push({...r,recoveredFromTrash:true});archiveBytes+=(await fs.stat(path.join(root,n,id+'.bin'))).size;archiveCount++;}}catch{}}
   await writeBackupUsage(root,{activeBytes,activeCount:count,archiveBytes,archiveCount});const offset=v.offset??0,filter=v.filter??'';if(!Number.isInteger(offset)||offset<0||offset>1000000||typeof filter!=='string'||filter.length>256)throw new Error('备份筛选或页码无效。');const ordered=list=>list.filter(x=>x.path.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),active=ordered(records),old=ordered(archives),total=Math.max(active.length,old.length);return {activeBytes,archiveBytes,count,corruptCount,limitBytes:history.limits.maxBytes,limitCount:history.limits.maxCount,activeMatches:active.length,archiveMatches:old.length,offset,nextOffset:offset+50<total?offset+50:null,records:active.slice(offset,offset+50),archives:old.slice(offset,offset+50)};
  }
  if(action!=='workspace_backup_export')await invalidateBackupUsage(root);
  if(!/^[0-9a-f-]{36}$/.test(v.backupId||''))throw new Error('恢复编号无效。');
  const from=action==='workspace_backup_unarchive'||v.fromArchive===true?(v.recoveredFromTrash===true?path.join(root,'removed-backup-'+v.backupId):archived):root;
  const loaded=await readJsonRecord(path.join(from,v.backupId+'.json'),r=>validBackup(r)&&r.backupId===v.backupId);if(!loaded.ok)throw new Error('这个恢复记录已损坏或不可读取，无法使用；未整理或删除副本。');const record=loaded.value;
  if(record.folderHash!==hash(executor.config.folder))throw new Error('恢复副本不属于当前文件夹。');
  const source=path.join(from,v.backupId+'.bin');if(!(await fs.lstat(source)).isFile())throw new Error('恢复副本类型无效。');
  if(action==='workspace_backup_export'){
   if(!executor.config.allowWrites)throw new Error('导出到工作文件夹需要开启修改权限。');await executor.assertActive();const directory=await executor.target('.claude-backup-exports',true);
   const name=path.parse(record.path),target=await executor.target('.claude-backup-exports/'+[...name.name].slice(0,80).join('')+'-恢复-'+v.backupId+name.ext);
   await executor.checkProtection('create_directory',{path:executor.label(directory)});await executor.checkProtection('write_file',{path:executor.label(target)});await fs.mkdir(directory,{recursive:true});return {path:executor.label(target),...await copyVerified(source,target,{expectedSha256:record.beforeSha256,validateTarget:()=>executor.target(executor.label(target))})};
  }
  if(action==='workspace_backup_trash'){if(v.confirm!==true)throw new Error('请明确确认把此备份移入系统回收站。');const payload=path.join(root,'removed-backup-'+v.backupId);await fs.mkdir(payload,{mode:0o700});await fs.rename(source,path.join(payload,v.backupId+'.bin'));try{await fs.rename(path.join(from,v.backupId+'.json'),path.join(payload,v.backupId+'.json'));await moveToTrash(payload);}catch(e){for(const ext of ['.bin','.json']){const part=path.join(payload,v.backupId+ext);try{await fs.rename(part,path.join(from,v.backupId+ext));}catch{}}try{await fs.rmdir(payload);}catch{}throw e;}return {recycled:true,backupId:v.backupId,guidance:'恢复时在系统回收站还原这个目录，再刷新备份管理并点击撤销整理。'};}
  if(!['workspace_backup_archive','workspace_backup_unarchive'].includes(action)||v.confirm!==true)throw new Error('请明确确认备份整理范围。');
  const to=action==='workspace_backup_archive'?archived:root;await fs.mkdir(to,{recursive:true,mode:0o700});
  if(to===root){const usage=await fs.readdir(root);let bytes=0;for(const n of usage.filter(x=>x.endsWith('.bin')))bytes+=(await fs.stat(path.join(root,n))).size;if(usage.filter(x=>x.endsWith('.bin')).length>=2000||bytes+record.bytes>4*1024**3)throw new Error('活跃备份空间不足，未恢复归档。');}
  for(const ext of ['.json','.bin']){try{await fs.access(path.join(to,v.backupId+ext));throw new Error('目标恢复编号已存在。');}catch(e){if(e.code!=='ENOENT')throw e;}}
  await fs.rename(source,path.join(to,v.backupId+'.bin'));
  try{await fs.rename(path.join(from,v.backupId+'.json'),path.join(to,v.backupId+'.json'));}catch(e){await fs.rename(path.join(to,v.backupId+'.bin'),source);throw e;}
  if(from.startsWith(path.join(root,'removed-backup-')))await fs.rmdir(from).catch(()=>{});
  return {archived:to===archived,backupId:v.backupId,path:record.path,recoverable:true};
 }));
}

export async function expireArchivedBackups(executor,days,{recycle=moveToTrash}={}){
 if(days==null)return {enabled:false,recycled:0};if(!Number.isInteger(days)||days<7||days>3650)throw new Error('归档保留期须为7至3650天。');const root=executor.history.root;if(!root)return {enabled:true,recycled:0};
 return folderLock(executor.config.folder,executor.lockRoot,()=>withBackupLock(root,async()=>{
  const archive=path.join(root,'archive');let names;try{const directory=await fs.lstat(archive);if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('归档目录含链接或类型无效，未自动回收。');names=await fs.readdir(archive);}catch(e){if(e.code==='ENOENT')return {enabled:true,recycled:0};throw e;}let recycled=0,blocked=0,permanentlyDeleted=0;
  for(const name of names.filter(x=>/^[0-9a-f-]{36}\.json$/.test(x))){if(recycled+blocked>=20)break;const id=name.slice(0,-5),meta=path.join(archive,name),loaded=await readJsonRecord(meta,r=>validBackup(r)&&r.backupId===id);if(!loaded.ok||loaded.value.folderHash!==hash(executor.config.folder)||loaded.value.autoRecycleAttempted||Date.now()-Date.parse(loaded.value.createdAt)<days*86400000)continue;
   const data=path.join(archive,id+'.bin');let stat;try{stat=await fs.lstat(data);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(!stat.isFile()||stat.isSymbolicLink())continue;
   // Durable before any recycle request: an interrupted/unknown attempt is never repeated automatically.
   await durableRecord(meta,{...loaded.value,autoRecycleAttempted:true});await invalidateBackupUsage(root);const payload=path.join(root,'removed-backup-'+id);let made=false;
   try{await fs.mkdir(payload,{mode:0o700});made=true;await fs.rename(data,path.join(payload,id+'.bin'));await fs.rename(meta,path.join(payload,id+'.json'));const receipt=await recycle(payload);if(receipt?.recycled!==true||receipt.permanent===true)throw new Error('系统回收结果未确认。');recycled++;}
   catch(error){blocked++;if(error.permanentlyDeleted||error.code==='CFB_PERMANENTLY_DELETED')permanentlyDeleted++;if(made){for(const ext of ['.bin','.json'])try{await fs.rename(path.join(payload,id+ext),path.join(archive,id+ext));}catch{}await fs.rmdir(payload).catch(()=>{});}}
  }
  return {enabled:true,recycled,blocked,permanent:permanentlyDeleted>0,permanentlyDeleted,unknownNotRetried:true};
 }));
}
