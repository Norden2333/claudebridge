import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fingerprint,copyVerified} from './safe-io.mjs';
import {folderLock} from './folder-lock.mjs';
import {processingDeadline} from './budget.mjs';
export async function treeSignature(ex,dir,budget={count:0,deadline:processingDeadline()},base=dir){
 if(Date.now()>budget.deadline)throw new Error('目录核对超出任务时间预算，未移动或撤销。');
 if(path.relative(base,dir).split(path.sep).length>64)throw new Error('目录超过64层，未移动或撤销。');const hash=crypto.createHash('sha256');
 for(const e of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(Date.now()>budget.deadline)throw new Error('目录核对超出任务时间预算，未移动或撤销。');if(++budget.count>100000)throw new Error('目录条目过多，请逐项核对。');const file=await ex.target(ex.label(path.join(dir,e.name)));const st=await fs.lstat(file);if(st.isSymbolicLink())throw new Error('目录内含链接，未执行撤销。');hash.update(JSON.stringify([path.relative(base,file),st.isDirectory()?'directory':'file',st.isFile()?st.size:0,st.isFile()?st.mtimeMs:0,st.isFile()?st.ctimeMs:0]));if(st.isDirectory())hash.update(await treeSignature(ex,file,budget,base));}
 return hash.digest('hex');
}
async function description(ex,tool,r){
 const base={path:r.destination||r.path||'',tool};if(r.alreadyInFolder||r.skipped||r.conflict||r.changed===false)return {...base,action:null,reason:'没有应用文件变更。'};
 if(r.deleted)return {...base,action:null,reason:r.recycled?'请从系统回收站恢复对应文件；没有自动猜测回收站条目。':'永久删除没有可用的自动撤销。'};
 let backup; if(r.backupId){try{backup=await ex.history.metadata(ex.config.folder,r.backupId);}catch{return {...base,action:null,reason:'恢复副本不可用，可能已归档、清理或损坏；请先在备份管理核对并恢复该副本。'};}}
 if(r.moved){if(!r.sha256&&!r.treeSignature)return {...base,action:null,reason:'旧记录缺少移动后的基线。'};return {...base,action:r.replaced?'reverse_replace':'reverse_move',source:r.source,destination:r.destination,expected:r.sha256,treeSignature:r.treeSignature,backupId:r.backupId};}
 if(r.backupId){const record=backup;return {...base,action:'restore',path:record.path,expected:record.afterSha256,before:record.beforeSha256,backupId:r.backupId};}
 if(r.sha256&&(r.created||r.copied||tool==='edit_office_text'||tool==='import_download'))return {...base,action:'remove_created',expected:r.sha256};
 if(tool==='create_directory'&&r.createdPaths?.length)return {...base,action:'remove_directories',createdPaths:r.createdPaths};
 return {...base,action:null,reason:'此记录没有足够的撤销信息，未猜测原始状态。'};
}
async function sourceRecord(ex,id){const record=await ex.journal.status(ex.config.folder,id);if(record.status!=='completed')throw new Error('原操作结果尚未确认，不自动撤销。');return record;}
async function build(ex,id){
 const record=await sourceRecord(ex,id),rows=record.result?.results||[{index:0,tool:record.tool,result:record.result}],items=[],virtual=new Map();
 const current=async p=>{if(virtual.has(p))return virtual.get(p);const target=await ex.target(p);let value;try{const st=await fs.lstat(target);value={exists:true,directory:st.isDirectory(),sha256:st.isFile()?(await fingerprint(target)).sha256:null,dependencies:[]};}catch(e){if(e.code!=='ENOENT')throw e;value={exists:false,dependencies:[]};}virtual.set(p,value);return value;};
 for(const row of [...rows].reverse()){
  const item={index:row.index,...await description(ex,row.tool,row.result||{}),dependencies:[],canUndo:false};const previous=record.undoSteps?.[row.index];
  if(previous){const done=await ex.journal.status(ex.config.folder,previous);item.reason=done.status==='completed'?'已经撤销，不重复执行。':'此前撤销结果待核对，不自动重做。';item.alreadyUndone=done.status==='completed';items.push(item);continue;}
  if(item.action){
   const value=await current(item.path);item.dependencies.push(...value.dependencies);
   if(item.action==='restore'||item.action==='remove_created'){item.canUndo=value.exists&&!value.directory&&value.sha256===item.expected;if(item.canUndo)virtual.set(item.path,{exists:item.action==='restore',sha256:item.before,dependencies:[...item.dependencies,item.index]});}
   if(item.action==='reverse_move'||item.action==='reverse_replace'){const source=await current(item.source);item.dependencies.push(...source.dependencies);item.canUndo=value.exists&&!source.exists&&(item.treeSignature?value.directory&&await treeSignature(ex,await ex.target(item.destination))===item.treeSignature:!value.directory&&value.sha256===item.expected);if(item.canUndo){virtual.set(item.source,{...value,dependencies:[...item.dependencies,item.index]});virtual.set(item.destination,{exists:item.action==='reverse_replace',sha256:item.action==='reverse_replace'?(await ex.history.metadata(ex.config.folder,item.backupId)).beforeSha256:null,dependencies:[...item.dependencies,item.index]});}}
   if(item.action==='remove_directories'){item.canUndo=value.exists&&value.directory;for(const child of item.canUndo?await fs.readdir(await ex.target(item.path)):[]){const p=item.path+'/'+child,v=virtual.get(p);if(!v||v.exists){item.canUndo=false;break;}item.dependencies.push(...v.dependencies);}if(item.canUndo)for(const p of item.createdPaths)virtual.set(p,{exists:false,dependencies:[...item.dependencies,item.index]});}
   if(!item.canUndo)item.reason='文件已变化、原位置被占用或目录仍有未选内容；未强行覆盖。';
  }
  item.dependencies=[...new Set(item.dependencies)];items.push(item);
 }
 return {record,items:items.sort((a,b)=>a.index-b.index)};
}
async function apply(ex,item){
 await ex.assertActive();if(!ex.config.allowWrites)throw new Error('需要允许修改才能撤销。');
 if(item.action==='restore')return ex.run('restore_file',{path:item.path,backupId:item.backupId});
 if(item.action==='remove_created'){const target=await ex.target(item.path);if((await fingerprint(target)).sha256!==item.expected)throw new Error('新建文件后来被修改，未回收。');return ex.run('delete_file',{path:item.path});}
 if(item.action==='remove_directories'){const removed=[];for(const p of item.createdPaths){const target=await ex.target(p);if((await fs.readdir(target)).length)throw new Error('新建目录现在仍有内容，停止撤销。');await ex.run('delete_directory',{path:p,recursive:false});removed.push(p);}return {removed};}
 if(item.action==='reverse_move'||item.action==='reverse_replace'){
  const dst=await ex.target(item.destination);if(item.treeSignature&&await treeSignature(ex,dst)!==item.treeSignature)throw new Error('目录内容或修改时间已变化，未移回。');
  let temp;
  try{
   if(item.action==='reverse_replace'){await ex.checkProtection('write_file',{path:item.destination});const record=await ex.history.metadata(ex.config.folder,item.backupId);temp=await ex.target(ex.label(path.join(path.dirname(dst),'.cfb-'+crypto.randomUUID()+'.tmp')));await copyVerified(path.join(ex.history.root,item.backupId+'.bin'),temp,{expectedSha256:record.beforeSha256});}
   const moved=await ex.run('move_file',{source:item.destination,destination:item.source,...(item.expected?{expected_sha256:item.expected}:{})});if(moved.conflict||moved.skipped)throw new Error('原位置已被占用，未覆盖。');
   if(temp){const record=await ex.history.metadata(ex.config.folder,item.backupId);await copyVerified(temp,dst,{expectedSha256:record.beforeSha256,validateTarget:()=>ex.target(item.destination)});}
   return {movedBack:true,source:item.source,restoredReplacedTarget:!!temp};
  }finally{if(temp)await fs.rm(temp,{force:true});}
 }
 throw new Error('这项没有安全的自动撤销方式。');
}
export async function undoAction(ex,action,v){return folderLock(ex.config.folder,ex.lockRoot,async()=>{
 const plan=await build(ex,v.originalId);
 if(action==='workspace_undo_plan')return {operationId:v.originalId,items:plan.items,guidance:'按倒序重新核对后撤销，仅选中项；新建文件进回收站。已改变/未知项不强行覆盖。'};
 if(v.confirm!==true||!Array.isArray(v.indices)||!v.indices.length||v.indices.length>64||v.indices.some(x=>!Number.isInteger(x))||new Set(v.indices).size!==v.indices.length)throw new Error('请选择具体撤销项并明确确认。');
 const selected=new Set(v.indices);for(const index of selected){const item=plan.items.find(x=>x.index===index);if(!item||!item.canUndo&&!item.alreadyUndone||item.dependencies.some(x=>!selected.has(x)&&!plan.items.find(y=>y.index===x)?.alreadyUndone))throw new Error('选中项已变化或还依赖同批后续改动，请刷新撤销清单。');}
 if(!ex.config.allowWrites)throw new Error('需要允许修改才能撤销。');if(!/^[a-zA-Z0-9_-]{8,90}$/.test(v.operationId||''))throw new Error('撤销编号无效。');ex.journal.key(ex.config.folder,v.operationId);const result=[];
 for(const item of plan.items.filter(x=>selected.has(x.index)).reverse()){
  if(item.alreadyUndone){result.push({index:item.index,alreadyUndone:true});continue;}
  try{
   await ex.assertActive();if(item.action==='reverse_move'||item.action==='reverse_replace')await ex.checkProtection('move_file',{source:item.destination,destination:item.source});else await ex.checkProtection(item.action==='remove_directories'?'delete_directory':'write_file',{path:item.path});const id=v.operationId+'-'+item.index;plan.record.undoSteps||={};plan.record.undoSteps[item.index]=id;await ex.journal.save(ex.journal.key(ex.config.folder,v.originalId),plan.record);
   const receipt=await ex.journal.execute(ex.config.folder,id,'undo_step',{originalId:v.originalId,index:item.index},()=>apply(ex,item));result.push({index:item.index,result:receipt});
  }catch(e){return {completed:result.length,results:result,stoppedAt:item.index,error:e.message,unknown:true,retryWholeBatch:false};}
 }
 return {completed:result.length,results:result};
});}
