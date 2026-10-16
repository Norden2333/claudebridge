import {assetSafeSuffix} from './sensitive-paths.mjs';
import {pauseOtherAssetBindings} from './asset-index.mjs';
import {scopeId} from './activity.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {folderLock} from './folder-lock.mjs';import {fingerprint,copyVerified} from './safe-io.mjs';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const idOK=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(id);
export function assetFileName(name){
 if(typeof name!=='string'||name.length>10000)throw Object.assign(new Error('成果文件名无效。'),{code:'CFB_ASSET_NAME'});
 const symbols={'\\':'＼','/':'／',':':'：','*':'＊','?':'？','"':'＂','<':'＜','>':'＞','|':'｜'};
 let safe=name.replace(/[\x00-\x1f\x7f]/g,'').replace(/[\\/:*?"<>|]/g,x=>symbols[x]).replace(/[. ]+$/g,'')||'claude-output';
 if(/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(safe)||safe.startsWith('.cfb-')||safe==='.claude-file-operation.json')safe='_'+safe;
 const ext=path.extname(safe),extension=Array.from(ext).slice(0,32).join('');let stem=Array.from(ext?safe.slice(0,-ext.length):safe).slice(0,200).join('');
 while(stem.length+extension.length>230)stem=Array.from(stem).slice(0,-1).join('');return assetSafeSuffix(stem+extension);
}
function fileName(name){return assetFileName(name);}
async function jsonRead(p){try{return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomicJSON(p,value){await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});const t=p+'.'+crypto.randomUUID()+'.tmp';try{const h=await fs.open(t,'wx',0o600);try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}await fs.rename(t,p);}finally{await fs.rm(t,{force:true});}}
// Ordered decisions shared with preflight; none of the noop cases mutates the local file.
export function decideAssetSave({saved,current,sha,ignored=[]}){
 // Older cards and explicit historical keep-local decisions must not replay.
 if(ignored.includes(sha)||saved?.dismissedSha256?.includes(sha))return {kind:'noop',skipped:true,dismissed:true,ignoredArtifact:true};
 if(saved?.priorSha256?.includes(sha))return {kind:'noop',skipped:true,olderVersionIgnored:true};
 if(saved?.paused)return {kind:'conflict',reason:'这个文件的成果关联已停止，请在设置中检查目标文件夹。'};
 if(current?.sha256===sha)return saved?.sha256===sha?{kind:'noop',unchanged:true,unchangedArtifact:true,skipped:false}:{kind:'bind'};
 return {kind:'write'};
}
export class AssetTransfers{
 constructor(root,getExecutor){this.root=root;this.getExecutor=getExecutor;this.sessions=new Map();this.chains=new Map();}
 async dispatch(action,v){const id=v.operationId;this.paths(id);const prior=this.chains.get(id)||Promise.resolve();const current=prior.catch(()=>{}).then(()=>this[action](v));this.chains.set(id,current);try{return await current;}finally{if(this.chains.get(id)===current)this.chains.delete(id);}}
 paths(id){if(!idOK(id))throw new Error('成果操作编号无效。');return {data:path.join(this.root,'incoming',id+'.bin'),meta:path.join(this.root,'incoming',id+'.json')};}
 async executor(scope){const ex=await this.getExecutor(scope);if(!ex.config.folder||!ex.config.allowWrites)throw new Error('成果自动保存需要当前目录修改权限。');await ex.assertActive();return ex;}
 mapPath(ex,key){if(!/^[a-f0-9]{64}$/.test(key||''))throw new Error('成果身份记录无效。');return path.join(this.root,'assets',hash(ex.config.folder)+'-'+key+'.json');}
 ignoredPath(ex,key){this.mapPath(ex,key);return path.join(this.root,'ignored-assets',hash(ex.config.folder)+'-'+key+'.json');}
 async precheck(v){
  fileName(v.name);
  if(!/^[a-f0-9]{64}$/.test(v.sha256||'')||!Number.isSafeInteger(v.bytes)||v.bytes<0||v.bytes>4*1024**3)throw Object.assign(new Error('成果预检查参数无效。'),{code:'CFB_ASSET_LIMIT'});
  const ex=await this.executor(v.scope),saved=await jsonRead(this.mapPath(ex,v.assetKey)),ignored=await jsonRead(this.ignoredPath(ex,v.assetKey));
  const dismissed=ignored?.hashes?.includes(v.sha256)||saved?.dismissedSha256?.includes(v.sha256);
  const older=saved?.priorSha256?.includes(v.sha256);
  if(dismissed||older)return {upload:false,reason:dismissed?'kept_local':'older_version',unchangedArtifact:true,localPreserved:true,localVerificationPerformed:false,applied:false,changed:false,...(saved?.path?{path:saved.path}:{}),artifactSha256:v.sha256};
  // A known cloud version alone does not prove that the local file is unchanged.
  // Recheck the actual scoped destination before skipping its transfer.
  if(saved?.sha256===v.sha256&&saved.bytes===v.bytes&&!saved.paused){
   try{const current=await fingerprint(await ex.target(saved.path,true));if(current.sha256===v.sha256&&current.bytes===v.bytes)return {upload:false,reason:'known_version',unchangedArtifact:true,alreadySaved:true,localVerificationPerformed:true,verified:true,applied:false,changed:false,path:saved.path,sha256:v.sha256,bytes:v.bytes};}
   catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return {upload:true,reason:'new_or_changed_local_version'};
 }
 async begin(v){
  v={...v,name:fileName(v.name),nameAdjusted:fileName(v.name)!==v.name};const files=this.paths(v.operationId);if(this.sessions.has(v.operationId))throw new Error('成果传输已开始，不重复启动。');
  if(this.sessions.size>=4)throw Object.assign(new Error('正在保存其他成果，请稍后。'),{code:'CFB_ASSET_BUSY'});
  if(!/^[a-f0-9]{64}$/.test(v.assetKey||''))throw new Error('成果身份无效。');fileName(v.name);
  if(v.expectedBytes!==undefined&&(!Number.isSafeInteger(v.expectedBytes)||v.expectedBytes<0||v.expectedBytes>4*1024**3))throw Object.assign(new Error('成果大小无效或超过4GiB。'),{code:'CFB_ASSET_LIMIT'});
  const ex=await this.executor(v.scope);let initialPath=v.name;
  if(ex.config.preserveOutputDirs&&v.relativeDir){if(typeof v.relativeDir!=='string'||v.relativeDir.length>2000||v.relativeDir.startsWith('/')||v.relativeDir.includes('\\'))throw Object.assign(new Error('成果子目录无效。'),{code:'CFB_ASSET_NAME'});const parts=v.relativeDir.split('/');if(parts.length>16||parts.some(x=>!x||x==='.'||x==='..'))throw Object.assign(new Error('成果子目录无效。'),{code:'CFB_ASSET_NAME'});initialPath=path.join(...parts.map(fileName),v.name);}
  await ex.target(initialPath);if((await ex.journal.status(ex.config.folder,v.operationId)).status!=='not_found')throw new Error('成果编号已有操作记录，不重复接收。');
  await fs.mkdir(path.dirname(files.data),{recursive:true,mode:0o700});if(await jsonRead(files.meta))throw new Error('该成果传输已有记录，请先核对。');
  const handle=await fs.open(files.data,'wx',0o600);const s={...files,id:v.operationId,scope:v.scope,folder:ex.config.folder,name:v.name,initialPath,nameAdjusted:v.nameAdjusted,key:v.assetKey,expectedBytes:v.expectedBytes,handle,bytes:0,next:0,digest:crypto.createHash('sha256'),deadline:Date.now()+20*60*1000,phase:'receiving'};
  try{await atomicJSON(s.meta,{id:s.id,scope:s.scope,folderHash:hash(s.folder),phase:'receiving',name:s.name});}catch(e){await handle.close();await fs.rm(s.data,{force:true});throw e;}
  this.sessions.set(s.id,s);this.emit(s,ex,'running');return {operationId:s.id,status:'receiving',applied:false};
 }
 emit(s,ex,state,result={}){try{ex?.onActivity?.({id:s.id,operationId:s.id,scope:scopeId(s.folder),kind:'import_download',channel:'download',paths:[result.path||s.targetPath||s.name],state,time:Date.now(),receivedBytes:s.bytes,...(Number.isSafeInteger(s.expectedBytes)?{totalBytes:s.expectedBytes}:{}),...(result.verified?{verified:true}:{}),...(result.backupWarning?{backupWarning:true}:{}),...(result.skipped?{skipped:true}:{}),...(result.alreadySaved?{alreadySaved:true}:{}),...(state==='running'&&s.phase==='finalizing'?{committing:true}:{})});}catch{}}
 async checked(id,scope){const s=this.sessions.get(id);if(!s||s.scope!==scope||s.phase!=='receiving')throw new Error('成果传输不可继续，请先查询原编号。');const ex=await this.executor(s.scope);if(ex.config.folder!==s.folder||Date.now()>s.deadline)throw new Error('目录权限已变化或传输超时，原文件保留。');return {s,ex};}
 async chunk(v){const {s,ex}=await this.checked(v.operationId,v.scope);if(v.sequence!==s.next||typeof v.data!=='string'||v.data.length>350000||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.data))throw new Error('成果数据顺序或编码无效，原文件保留。');const b=Buffer.from(v.data,'base64');if(b.length>256*1024||!b.length||s.bytes+b.length>4*1024**3||s.expectedBytes!==undefined&&s.bytes+b.length>s.expectedBytes)throw new Error('成果数据超过声明大小，原文件保留。');if(typeof v.sha256!=='string'||hash(b)!==v.sha256)throw new Error('成果传输块校验失败，原文件保留。');await s.handle.writeFile(b);s.digest.update(b);s.bytes+=b.length;s.next++;if(Date.now()-(s.lastActivity||0)>=1000||s.bytes===s.expectedBytes){s.lastActivity=Date.now();this.emit(s,ex,'running');}return {operationId:s.id,receivedBytes:s.bytes,nextSequence:s.next,applied:false};}
 // Only recent verified local-write receipts are candidates. Never scan user
 // folders or guess a target from a basename alone; ambiguous matches do not bind.
 async existingLocalWrite(ex,s,sha256){
  const receipts=await ex.journal.recent(s.folder);if(receipts.corruptCount)return null;
  const writes=new Set(['write_file','edit_block','edit_blocks','edit_office_text','copy_file','move_file']),candidates=new Map();
  const normalized=value=>process.platform==='win32'?value.toLowerCase():value;
  const visit=(tool,result,id,depth=0)=>{
   if(!result||depth>2)return;
   if(tool==='batch_operations'){for(const item of (result.results||[]).slice(0,64))visit(item.tool,item.result,id,depth+1);return;}
   if(!writes.has(tool)||result.verified!==true||result.sha256!==sha256)return;
   const relative=result.destination||result.path;
   if(typeof relative!=='string'||normalized(path.basename(relative))!==normalized(s.name))return;
   candidates.set(normalized(relative),{relative,operationId:id});
  };
  for(const r of receipts)if(r.status==='completed')visit(r.tool,r.result,r.operationId);
  if(candidates.size>16||s.bytes*candidates.size>256*1024*1024)return null;
  const matches=[];
  for(const candidate of candidates.values()){
   try{const target=await ex.target(candidate.relative,true),stat=await fs.stat(target);if(!stat.isFile()||stat.size!==s.bytes)continue;const current=await fingerprint(target);if(current.sha256===sha256&&current.bytes===s.bytes)matches.push({...candidate,current});}
   catch(e){if(['ENOENT','CFB_SCOPE_PATH','CFB_SENSITIVE_PATH','CFB_INTERNAL_PATH','CFB_HARDLINK'].includes(e.code))continue;throw e;}
  }
  return matches.length===1?matches[0]:null;
 }
 async finish(v){
  const {s,ex}=await this.checked(v.operationId,v.scope);if(s.expectedBytes!==undefined&&s.bytes!==s.expectedBytes)throw new Error('成果尚未完整接收，原文件保留。');
  try{await s.handle.sync();await s.handle.close();s.handle=null;s.phase='finalizing';this.emit(s,ex,'running');const sha256=s.digest.digest('hex');
  await atomicJSON(s.meta,{id:s.id,scope:s.scope,folderHash:hash(s.folder),phase:'finalizing',name:s.name,key:s.key,bytes:s.bytes,sha256});
  const result=await folderLock(s.folder,ex.lockRoot,async()=>{await this.executor(s.scope);return ex.journal.execute(s.folder,s.id,'asset_save',{assetKey:s.key,name:s.name,sha256,bytes:s.bytes},async()=>{
   const mapFile=this.mapPath(ex,s.key),saved=await jsonRead(mapFile),ignored=await jsonRead(this.ignoredPath(ex,s.key));
   const ignoreVersion=ignored?.hashes?.includes(sha256)||saved?.dismissedSha256?.includes(sha256)||saved?.priorSha256?.includes(sha256);
   const existing=!saved&&!ignoreVersion?await this.existingLocalWrite(ex,s,sha256):null;
   const relative=existing?.relative||saved?.path||s.initialPath||s.name,target=await ex.target(relative);await ex.checkProtection('write_file',{path:relative});s.targetPath=relative;
   let current;try{current=await fingerprint(target);}catch(e){if(e.code!=='ENOENT')throw e;}
   const decision=decideAssetSave({saved,current,sha:sha256,ignored:ignored?.hashes||[]});
   if(decision.kind==='noop'){const {kind,...flags}=decision;return {path:relative,...flags,changed:false,applied:false,localPreserved:true,localRemoved:flags.localMissing,artifactSha256:sha256,...(!flags.skipped?{verified:true,alreadySaved:true,sha256,bytes:s.bytes}:{})};}
   if(decision.kind==='conflict')return this.conflict(s,relative,current,decision.reason);
   let actual=current;
   if(!current&&path.dirname(target)!==s.folder){const dir=path.dirname(target);await ex.target(ex.label(dir),true);await ex.checkProtection('create_directory',{path:ex.label(dir)});await fs.mkdir(dir,{recursive:true});}
   if(!current||current.sha256!==sha256){
    if(current){const temp=await ex.target(ex.label(path.join(path.dirname(target),'.cfb-'+crypto.randomUUID()+'.tmp')));try{const copied=await copyVerified(s.data,temp,{expectedSha256:sha256}),staged=await fs.stat(temp);if((await fingerprint(target)).sha256!==current.sha256)throw new Error('保存前本机文件变化，未覆盖。');await ex.target(relative);await fs.rename(temp,target);const published=await fs.stat(await ex.target(relative));if(published.size!==staged.size||published.mtimeMs!==staged.mtimeMs)throw new Error('成果发布后元数据变化，校验未确认；请核对原编号。');actual=published.ino===staged.ino?copied:await fingerprint(target);}finally{await fs.rm(temp,{force:true});}}
    else actual=await copyVerified(s.data,target,{expectedSha256:sha256,validateTarget:()=>ex.target(relative)});
   }
   if(actual.sha256!==sha256||actual.bytes!==s.bytes)throw new Error('成果落盘校验失败，不要重复覆盖。');
   await atomicJSON(mapFile,{path:relative,sha256,priorSha256:[...new Set([...(saved?.priorSha256||[]),...(saved&&saved.sha256!==sha256?[saved.sha256]:[])])].slice(-2000),bytes:s.bytes,operationId:s.id,updatedAt:new Date().toISOString()});
   return {path:relative,...(decision.kind==='bind'?{bound:true,alreadySaved:true,...(existing?{localWriteOperationId:existing.operationId}:{}),verification:'existing local file SHA256 and byte size; no file write or backup'}:{verification:'working-directory stage disk SHA256; published identity and byte size'}),created:!current,changed:!current||current.sha256!==sha256,verified:true,applied:decision.kind!=='bind',sha256,bytes:s.bytes,sameFileUpdated:!!current&&decision.kind!=='bind',...(s.nameAdjusted?{nameAdjusted:true,nameNotice:'成果名称已转换为Windows可保存名称，原字节保留'}:{}),...(s.name.endsWith('.txt')&&assetSafeSuffix(s.name.slice(0,-4))===s.name?{renamedForSafety:true,nameNotice:'启动或可执行入口后缀已追加.txt，原字节保留'}:{})};
  });});this.emit(s,ex,result.conflict?'conflict':'completed',result);return result;}catch(e){this.emit(s,ex,'unknown');throw e;}finally{this.sessions.delete(s.id);await s.handle?.close().catch(()=>{});s.handle=null;if(s.phase!=='conflict'){await fs.rm(s.data,{force:true});await fs.rm(s.meta,{force:true});}}
 }
 async conflict(s,relative,current,reason){
  const meta=await jsonRead(s.meta);
  // Coalesce the same unresolved cloud/local pair without creating another
  // candidate or another needs-choice receipt. The original remains selectable.
  let conflictCount=0;
  for(const entry of await fs.readdir(path.dirname(s.meta))){
   if(!entry.endsWith('.json')||entry===path.basename(s.meta)||!idOK(entry.slice(0,-5)))continue;
   let prior;try{prior=await jsonRead(path.join(path.dirname(s.meta),entry));}catch{continue;}
   if(prior?.phase==='conflict')conflictCount++;
   if(prior?.phase!=='conflict'||prior.id!==entry.slice(0,-5)||prior.scope!==s.scope||prior.folderHash!==hash(s.folder)||prior.key!==s.key||prior.path!==relative||prior.sha256!==meta.sha256||prior.bytes!==meta.bytes)continue;
   const old=this.paths(prior.id);let stat;try{stat=await fs.lstat(old.data);}catch{continue;}
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==meta.bytes)continue;
   return {path:relative,skipped:true,changed:false,applied:false,localPreserved:true,pendingConflictId:prior.id,reason:'同一版本的冲突已经保留，请处理原冲突；未再次暂存。'};
  }
  if(conflictCount>=64)return {path:relative,conflict:true,staged:false,changed:false,applied:false,choices:[],reason:'待处理冲突过多，本次未暂存；请先在工作台处理。'};
  await atomicJSON(s.meta,{...meta,phase:'conflict',path:relative,baselineSha256:current?.sha256||null});s.phase='conflict';
  return {path:relative,conflict:true,changed:false,applied:false,destination_sha256:current?.sha256||null,choices:['replace','skip','keep_both'],reason,staged:true};
 }
 async resolve(v){
  if(!['replace','skip','keep_both'].includes(v.choice))throw new Error('请选择保留本机版本、使用成果版本或保留两份。');
  const ex=await this.executor(v.scope);this.paths(v.originalId);this.paths(v.operationId);
  return folderLock(ex.config.folder,ex.lockRoot,async()=>{
   const record=await ex.journal.status(ex.config.folder,v.originalId);
   if(record.resolvedBy){const done=await ex.journal.status(ex.config.folder,record.resolvedBy);if(done.status==='completed')return {...done.result,replayed:true};throw new Error('冲突处理已开始或结果不明，请核对原处理编号，不重做。');}
   if(record.status!=='completed'||record.tool!=='asset_save'||!record.result?.conflict)throw new Error('成果冲突记录无效。');
   const files=this.paths(v.originalId),meta=await jsonRead(files.meta);
   if(!meta||meta.phase!=='conflict'||meta.scope!==v.scope||meta.folderHash!==hash(ex.config.folder)||meta.path!==record.result.path)throw new Error('暂存成果与当前文件夹不匹配，原件保留。');
   if(await ex.journal.read(ex.config.folder,v.operationId))throw new Error('处理编号已有记录，请先核对。');
   const target=await ex.target(meta.path);await ex.checkProtection('write_file',{path:meta.path});
   let current;try{current=await fingerprint(target);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(v.choice==='replace'&&(current?.sha256||null)!==meta.baselineSha256)throw new Error('冲突出现后本机文件又有变化，停止替换；两边内容仍保留。');
   if((await fingerprint(files.data)).sha256!==meta.sha256)throw new Error('暂存成果校验失败，未覆盖。');
   await ex.journal.save(ex.journal.key(ex.config.folder,v.originalId),{...record,resolvedBy:v.operationId});
   const result=await ex.journal.execute(ex.config.folder,v.operationId,'asset_conflict',{originalId:v.originalId,choice:v.choice},async()=>{
    if(v.choice==='skip'){
     const decision=this.ignoredPath(ex,meta.key),previous=await jsonRead(decision);
     const hashes=[...new Set([...(Array.isArray(previous?.hashes)?previous.hashes.filter(x=>/^[a-f0-9]{64}$/.test(x)):[]),meta.sha256])].slice(-64);
     await atomicJSON(decision,{hashes,updatedAt:new Date().toISOString()});
     return {path:meta.path,skipped:true,applied:false,localPreserved:true,ignoredArtifactSha256:meta.sha256};
    }
    await ex.assertActive();
    if(v.choice==='keep_both'){
     const target=await ex.unusedDestination(await ex.target(meta.path)),relative=ex.label(target);
     await ex.checkProtection('write_file',{path:relative});await copyVerified(files.data,target,{expectedSha256:meta.sha256,validateTarget:()=>ex.target(relative)});
     const actual=await fingerprint(await ex.target(relative));if(actual.sha256!==meta.sha256||actual.bytes!==meta.bytes)throw new Error('另存校验失败，请核对原编号。');
     const prior=await jsonRead(this.mapPath(ex,meta.key));await atomicJSON(this.mapPath(ex,meta.key),{path:relative,sha256:meta.sha256,priorSha256:[...new Set([...(prior?.priorSha256||[]),...(prior&&prior.sha256!==meta.sha256?[prior.sha256]:[])])].slice(-2000),bytes:meta.bytes,operationId:v.operationId,updatedAt:new Date().toISOString()});
     return {path:relative,originalPath:meta.path,created:true,verified:true,applied:true,localPreserved:true,sameFileUpdated:false,keptBoth:true,sha256:meta.sha256,bytes:meta.bytes};
    }
    if(current&&current.sha256!==meta.sha256){
     const temp=await ex.target(ex.label(path.join(path.dirname(target),'.cfb-'+crypto.randomUUID()+'.tmp')));
     try{await copyVerified(files.data,temp,{expectedSha256:meta.sha256});if((await fingerprint(target)).sha256!==current.sha256)throw new Error('确认后本机文件变化，未覆盖。');await ex.target(meta.path);await fs.rename(temp,target);}finally{await fs.rm(temp,{force:true});}
    }else if(!current)await copyVerified(files.data,target,{expectedSha256:meta.sha256,validateTarget:()=>ex.target(meta.path)});
    const actual=await fingerprint(await ex.target(meta.path));if(actual.sha256!==meta.sha256||actual.bytes!==meta.bytes)throw new Error('成果落盘校验失败，请核对原编号，不重试覆盖。');
    await pauseOtherAssetBindings(path.join(this.root,'assets'),ex.config.folder,meta.path,meta.key);
    const priorMap=await jsonRead(this.mapPath(ex,meta.key));
    await atomicJSON(this.mapPath(ex,meta.key),{path:meta.path,sha256:meta.sha256,priorSha256:[...new Set([...(priorMap?.priorSha256||[]),...(priorMap&&priorMap.sha256!==meta.sha256?[priorMap.sha256]:[])])].slice(-2000),bytes:meta.bytes,operationId:v.operationId,updatedAt:new Date().toISOString()});
    return {path:meta.path,verified:true,applied:true,sameFileUpdated:!!current,sha256:meta.sha256,bytes:meta.bytes};
   });
   await fs.rm(files.data,{force:true});await fs.rm(files.meta,{force:true});return result;
  });
 }
 async status(v){const ex=await this.getExecutor(v.scope);const record=await ex.journal.status(ex.config.folder,v.operationId);if(record.status!=='not_found')return ['asset_save','asset_conflict'].includes(record.tool)?record:{operationId:v.operationId,status:'not_found',retryAllowed:false};const s=this.sessions.get(v.operationId);if(s&&s.scope===v.scope)return {operationId:s.id,status:s.phase,receivedBytes:s.bytes,applied:false};const p=this.paths(v.operationId),meta=await jsonRead(p.meta);if(meta&&meta.folderHash===hash(ex.config.folder))return {operationId:v.operationId,status:meta.phase==='receiving'?'staged_not_applied':'unknown',applied:meta.phase==='receiving'?false:null,retryAllowed:false};return record;}
 async abort(v){const s=this.sessions.get(v.operationId);if(!s||s.scope!==v.scope)return {aborted:false};let ex;try{ex=await this.getExecutor(s.scope);}catch{}if(s.phase!=='receiving')throw new Error('成果已进入提交阶段，请先核对结果。');await s.handle?.close();const p=this.paths(s.id);await fs.rm(p.data,{force:true});await fs.rm(p.meta,{force:true});this.sessions.delete(s.id);this.emit(s,ex,'failed');return {aborted:true,applied:false};}
 async recover(){
  if(this.sessions.size)throw new Error('活动成果传输期间不能清理暂存。');
  const incoming=path.join(this.root,'incoming');let entries;try{entries=await fs.readdir(incoming,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return {recovered:0};throw e;}
  let recovered=0;
  for(const entry of entries){
   if(!entry.isFile()||!entry.name.endsWith('.json')||!idOK(entry.name.slice(0,-5)))continue;
   const id=entry.name.slice(0,-5),files=this.paths(id);let meta;
   try{meta=await jsonRead(files.meta);}catch{continue;}
   if(meta?.id!==id)continue;
   if(meta.phase==='receiving'){await fs.rm(files.data,{force:true});await fs.rm(files.meta,{force:true});recovered++;}
   else if(meta.phase==='finalizing'&&/^[a-f0-9]{64}$/.test(meta.folderHash||'')){
    const recordPath=path.join(this.root,'operations',meta.folderHash+'-'+id,'receipt.json');let receipt,receiptCorrupt=false;
    try{receipt=await jsonRead(recordPath);}catch{receiptCorrupt=true;}
    if(receipt?.status==='completed'){await fs.rm(files.data,{force:true});await fs.rm(files.meta,{force:true});}
    else{
     // This receiver is only constructed by the exclusive native host. Its old
     // finalizing session cannot still be active. Never replay the commit.
     if(!receiptCorrupt&&(!receipt||receipt.tool==='asset_save'))await atomicJSON(recordPath,{...receipt,operationId:id,tool:'asset_save',status:'interrupted',retryAllowed:false,endedAt:new Date().toISOString(),error:'成果提交期间程序被中断，请核对目标文件；不会自动重做。'});
     await atomicJSON(files.meta,{...meta,phase:'interrupted'});await fs.rm(files.data,{force:true});
    }
    recovered++;
   }
  }
  for(const entry of entries){if(!entry.isFile()||!entry.name.endsWith('.bin')||!idOK(entry.name.slice(0,-4)))continue;const files=this.paths(entry.name.slice(0,-4));try{await fs.lstat(files.meta);}catch(e){if(e.code!=='ENOENT')throw e;await fs.rm(files.data,{force:true});recovered++;}}
  return {recovered};
 }
 async close(){for(const s of this.sessions.values())if(s.phase==='receiving'){await s.handle?.close();const p=this.paths(s.id);await fs.rm(p.data,{force:true});await fs.rm(p.meta,{force:true});this.sessions.delete(s.id);}}
}
