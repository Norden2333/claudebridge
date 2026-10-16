import {requestDesktopOpen} from './desktop-open.mjs';
import fs from 'node:fs/promises';
import {undoAction} from './undo.mjs';
import {protectedPaths,setProtectedPaths} from './protection.mjs';
import {backupAction} from './backup-manager.mjs';
import path from 'node:path';
import {fingerprint,readBounded} from './safe-io.mjs';
import {folderLock} from './folder-lock.mjs';
import {scopeId} from './activity.mjs';
export async function workspaceAction(executor,action,values={}) {
  if(['workspace_undo_plan','workspace_undo_apply'].includes(action))return undoAction(executor,action,values);
  if(action==='workspace_protection'){try{return {paths:await protectedPaths(executor)};}catch(e){if(e.code!=='CFB_PROTECTION_INVALID')throw e;return {paths:[],corrupt:true,warning:e.message};}}
  if(action==='workspace_protection_set')return folderLock(executor.config.folder,executor.lockRoot,()=>setProtectedPaths(executor,values.paths));
  if(['workspace_backups','workspace_backup_export','workspace_backup_archive','workspace_backup_unarchive','workspace_backup_trash'].includes(action))return backupAction(executor,action,values);
  if(action==='workspace_recent') {
    const receipts=await executor.journal.recent(executor.config.folder),backups=await executor.history.recent(executor.config.folder);
    return {receipts,backups,corruptCount:(receipts.corruptCount||0)+(backups.corruptCount||0),backupNote:'文本改写和文件替换有恢复副本；删除在系统回收站恢复。新建、移动和永久删除不自动撤销。'};
  }
  if(action==='workspace_check') {
    const receipts=await executor.journal.recent(executor.config.folder),items=[];
    // Unresolved staged conflicts must remain actionable even after they leave
    // the recent-history window. Only this authorized folder is included.
    const incoming=path.join(path.dirname(executor.journal.root||''),'incoming');
    if(executor.journal.root){let names=[];try{names=await fs.readdir(incoming);}catch(e){if(e.code!=='ENOENT')throw e;}
      for(const name of names.filter(name=>/^[a-zA-Z0-9_-]{8,100}\.json$/.test(name))){let meta;try{meta=JSON.parse(await fs.readFile(path.join(incoming,name),'utf8'));}catch{continue;}if(meta?.phase!=='conflict'||meta.folderHash!==scopeId(executor.config.folder)||typeof meta.id!=='string'||meta.id!==name.slice(0,-5)||receipts.some(r=>r.operationId===meta.id))continue;const receipt=await executor.journal.status(executor.config.folder,meta.id);if(receipt.status==='completed'&&receipt.result?.conflict&&!receipt.resolvedBy)receipts.push(receipt);}
    }
    for(const r of receipts){if(r.resolvedBy){const resolved=await executor.journal.status(executor.config.folder,r.resolvedBy);items.push({operationId:r.operationId,status:resolved.status==='completed'?(r.tool==='batch_operations'?'partial':'completed'):'unknown',tool:r.tool,result:r.tool==='batch_operations'?{...r.result,resolvedConflict:resolved.result}:resolved.result,resolvedBy:r.resolvedBy});}else if(r.status==='completed'){items.push({operationId:r.operationId,status:r.result?.conflict?'needs_choice':r.result?.failedIndex!==undefined?'partial':'completed',tool:r.tool,result:r.result});}else items.push({operationId:r.operationId,status:['interrupted','rejected'].includes(r.status)?r.status:'unknown',tool:r.tool,retryAllowed:r.status==='rejected'});}
    return {items,corruptCount:receipts.corruptCount||0,summary:{completed:items.filter(x=>x.status==='completed').length,partial:items.filter(x=>x.status==='partial').length,needsChoice:items.filter(x=>x.status==='needs_choice').length,unknown:items.filter(x=>['unknown','interrupted'].includes(x.status)).length,rejected:items.filter(x=>x.status==='rejected').length},guidance:'只核对本机收到的最近50个操作。记录完成不代表文件后来没有被外部程序修改；未知项不能自动重做。'};
  }
  if(action==='workspace_diff')return folderLock(executor.config.folder,executor.lockRoot,async()=>{
    const record=await executor.history.metadata(executor.config.folder,values.backupId),target=await executor.target(record.path),current=await fingerprint(target);
    if(record.binary)return {path:record.path,binary:true,canRestore:current.sha256===record.afterSha256,beforeBytes:record.bytes,currentBytes:current.bytes,guidance:'二进制文件不转换成文字预览。'};
    const old=await executor.history.load(executor.config.folder,record.path,values.backupId),now=await readBounded(target,64*1024*1024);
    const before=new TextDecoder('utf-8',{fatal:true}).decode(old.data),after=new TextDecoder('utf-8',{fatal:true}).decode(now);let at=0;while(at<before.length&&at<after.length&&before[at]===after[at])at++;
    const start=Math.max(0,at-400);return {path:record.path,canRestore:current.sha256===record.afterSha256,before:before.slice(start,start+3000),after:after.slice(start,start+3000),excerpt:true,firstChangeCharacter:at};
  });
  if(action==='workspace_restore'){const record=await executor.history.metadata(executor.config.folder,values.backupId);return executor.execute('restore_file',{path:record.path,backupId:values.backupId},{operationId:values.operationId});}
  if(action==='workspace_conflict') return folderLock(executor.config.folder,executor.lockRoot,async()=>{
    await executor.assertActive();
    const record=await executor.journal.status(executor.config.folder,values.originalId);const failed=record.tool==='batch_operations'?record.result?.results?.find(x=>x.index===record.result.failedIndex):null;const r=failed?.result||record.result,tool=failed?.tool||record.tool;
    if(record.resolvedBy){const resolved=await executor.journal.status(executor.config.folder,record.resolvedBy);if(resolved.status==='completed')return {...resolved.result,replayed:true};throw new Error('这个冲突已开始处理，结果仍待核对，不会再次执行。');}
    if(record.status!=='completed'||!r?.conflict||!['copy_file','move_file'].includes(tool)||!['keep_both','replace','skip'].includes(values.choice))throw new Error('冲突记录或处理方式无效。');
    if(!executor.config.allowWrites)throw new Error('请先开启文件修改权限。');
    executor.journal.key(executor.config.folder,values.operationId);if(await executor.journal.read(executor.config.folder,values.operationId))throw new Error('处理编号已存在，请先核对结果。');
    const args={source:r.source,destination:r.destination,...(r.source_sha256?{expected_sha256:r.source_sha256}:{}),...(r.destination_sha256?{expected_destination_sha256:r.destination_sha256}:{}),on_conflict:values.choice};
    await executor.journal.save(executor.journal.key(executor.config.folder,values.originalId),{...record,resolvedBy:values.operationId});
    const activity={id:values.operationId,operationId:values.operationId,scope:scopeId(executor.config.folder),kind:tool,channel:'chat',paths:[r.source,r.destination]};const emit=state=>{try{executor.onActivity?.({...activity,state,time:Date.now()});}catch{}};emit('running');
    try{const result=await executor.journal.execute(executor.config.folder,values.operationId,tool,args,()=>executor.run(tool,args));emit('completed');return result;}catch(e){emit('unknown');throw e;}
  });
  if(action==='workspace_open'||action==='workspace_reveal') {
    const target=await executor.target(values.path||'.',true),stat=await fs.stat(target),directory=stat.isDirectory()?target:path.dirname(target);
    if(action==='workspace_open'&&(!stat.isFile()||!/^\.(md|txt|csv|tsv|pdf|png|jpe?g|webp|gif|docx|pptx|xlsx)$/i.test(path.extname(target))))throw new Error('此类型请在文件夹中自行打开。');
    const result=await requestDesktopOpen(target,directory,{reveal:action==='workspace_reveal',isDirectory:stat.isDirectory()});return {...result,path:executor.label(target),directory:executor.label(directory)};
  }
  throw new Error('不支持的工作台操作。');
}
