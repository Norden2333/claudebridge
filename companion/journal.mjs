import {folderLock,ownsFolderLock} from './folder-lock.mjs';
import {beginJournalSession,endJournalSession,journalInterrupted} from './journal-session.mjs';
import {readJsonRecord,durableRecord} from './record-io.mjs';
import {explainError} from './errors.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const stable = value => value && typeof value === 'object' ? (Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]))) : value;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export class OperationJournal {
  constructor(root = null) { this.root = root; this.memory = new Map(); }
  key(folder, id) { if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('操作编号须为8至100个字母、数字、横线或下划线。'); return hash(folder || '') + '-' + id; }
  async read(folder, id) {
    const key = this.key(folder, id);
    if (!this.root) return this.memory.get(key) || null;
    const record=await readJsonRecord(path.join(this.root,key,'receipt.json'),v=>v&&typeof v==='object'&&!Array.isArray(v)&&v.operationId===id&&['pending','completed','failed_or_unknown','unknown','interrupted','rejected'].includes(v.status)&&['startedAt','endedAt'].every(name=>v[name]===undefined||typeof v[name]==='string'&&Number.isFinite(Date.parse(v[name]))));
    if(record.ok){if(await journalInterrupted(this.root,key,folder,record.value))return {...record.value,status:'interrupted',retryAllowed:false,guidance:'操作执行期间程序已中断，请核对当前文件；不会自动重做。'};return record.value;}
    if(record.corrupt)return {operationId:id,status:'unknown',corrupt:true,retryAllowed:false};
    try{await fs.access(path.join(this.root,key));return {operationId:id,status:'unknown',retryAllowed:false};}catch(e){if(e.code==='ENOENT')return null;return {operationId:id,status:'unknown',retryAllowed:false};}
  }
  async save(key, value) {
    if (!this.root) { this.memory.set(key, value); return; }
    await durableRecord(path.join(this.root,key,'receipt.json'),value);
    const index=path.join(this.root,'index-'+key.slice(0,64)+'.jsonl');let handle;try{handle=await fs.open(index,'r+');const row=JSON.stringify({id:value.operationId,status:value.status,tool:value.tool,time:value.endedAt||value.startedAt||new Date().toISOString()})+'\n';const before=await handle.stat();await handle.write(row,before.size,'utf8');if(before.size>5*1024*1024){const size=(await handle.stat()).size,b=Buffer.alloc(65536);await handle.read(b,0,b.length,size-b.length);const text=b.toString('utf8'),tail=text.slice(text.indexOf('\n')+1);await handle.truncate(0);await handle.write(tail,0,'utf8');}await handle.sync();}catch(e){if(e.code!=='ENOENT')await fs.rm(index,{force:true}).catch(()=>{});}finally{await handle?.close();}
  }
  async status(folder, id) { return await this.read(folder, id) || { operationId: id, status: 'not_found', retryAllowed: false }; }
  indexFile(folder){return path.join(this.root,'index-'+hash(folder||'')+'.jsonl');}
  async indexRows(folder){
    const file=this.indexFile(folder);let handle;
    try{handle=await fs.open(file,'r');const stat=await handle.stat(),length=Math.min(stat.size,65536),buffer=Buffer.alloc(length);await handle.read(buffer,0,length,stat.size-length);let text=buffer.toString('utf8');if(stat.size>length)text=text.slice(text.indexOf('\n')+1);const rows=text.split('\n').filter(Boolean).map(line=>JSON.parse(line));if(rows.some(row=>!row||typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(row.id)||typeof row.time!=='string'||!Number.isFinite(Date.parse(row.time))))throw Error('bad index');return rows;}catch(e){return null;}finally{await handle?.close();}
  }
  async scan(folder){
    let entries;try{entries=await fs.readdir(this.root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const prefix=hash(folder||'')+'-',rows=[];
    for(const entry of entries){if(!entry.isDirectory()||!entry.name.startsWith(prefix)||!/^[a-zA-Z0-9_-]{8,100}$/.test(entry.name.slice(prefix.length)))continue;const id=entry.name.slice(prefix.length),record=await this.read(folder,id);if(record){let time=record.endedAt||record.startedAt;try{time||=(await fs.stat(path.join(this.root,entry.name))).mtime.toISOString();}catch{time=new Date().toISOString();}rows.push({id,record,time});}}
    return rows.sort((a,b)=>b.time.localeCompare(a.time));
  }
  async writeIndex(folder,rows){
    const file=this.indexFile(folder),temp=file+'.'+crypto.randomUUID()+'.tmp';await fs.mkdir(this.root,{recursive:true,mode:0o700});
    try{const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(rows.slice(0,2000).reverse().map(row=>JSON.stringify({id:row.id,status:row.record?.status||row.status,time:row.time,tool:row.record?.tool||row.tool})).join('\n')+'\n');await handle.sync();}finally{await handle.close();}await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
  }
  async rebuildIndex(folder){const build=async()=>{const rows=await this.scan(folder);await this.writeIndex(folder,rows);return rows;};return ownsFolderLock(folder)?build():folderLock(folder,path.join(path.dirname(this.root),'folder-locks'),build);}
  async recent(folder){
    if(!this.root)return [...this.memory.entries()].filter(([key])=>key.startsWith(hash(folder||'')+'-')).map(([,r])=>r).sort((a,b)=>(b.startedAt||'').localeCompare(a.startedAt||'')).slice(0,50);
    let rows=await this.indexRows(folder);if(rows===null){await this.rebuildIndex(folder);rows=await this.indexRows(folder)||[];}
    const seen=new Set(),records=[];let corruptCount=0;
    for(const row of rows.reverse()){if(seen.has(row.id))continue;seen.add(row.id);const record=await this.read(folder,row.id);if(record?.corrupt){corruptCount++;continue;}if(record)records.push(record);if(records.length>=50)break;}
    records.corruptCount=corruptCount;return records;
  }
  async maintain(folder,{keep=5000,days=90,now=Date.now()}={}){
    if(!this.root)return {removed:0};const action=async()=>{
      const rows=await this.scan(folder),referenced=new Set(),visit=(value,self)=>{if(!value||typeof value!=='object')return;for(const [name,child]of Object.entries(value)){if(['operationId','originalId','resolvedBy'].includes(name)&&typeof child==='string'&&child!==self)referenced.add(child);if(child&&typeof child==='object')visit(child,self);}};
      for(const row of rows)visit(row.record,row.id);
      const assetRoot=path.join(path.dirname(this.root),'assets'),prefix=hash(folder||'')+'-';let assets=[];try{assets=await fs.readdir(assetRoot);}catch(e){if(e.code!=='ENOENT')throw e;}
      for(const name of assets.filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{64}\.json$/.test(name.slice(prefix.length)))){const map=await readJsonRecord(path.join(assetRoot,name));if(!map.ok)return {removed:0,skipped:true,reason:'成果关联损坏，保留全部操作记录。'};if(map.value?.operationId)referenced.add(map.value.operationId);}
      let removed=0;const retained=[];
      for(const [index,row]of rows.entries()){
        const r=row.record,protectedRecord=!['completed','rejected'].includes(r.status)||r.corrupt||r.result?.conflict&&!r.resolvedBy||r.result?.failedIndex!==undefined||referenced.has(row.id);
        if(index<keep||Date.parse(row.time)>=now-days*86400000||protectedRecord){retained.push(row);continue;}
        const directory=path.join(this.root,this.key(folder,row.id)),files=await fs.readdir(directory,{withFileTypes:true});
        if(files.some(file=>!file.isFile()||file.name!=='receipt.json'&&!/\.tmp$/.test(file.name))){retained.push(row);continue;}
        const current=await this.read(folder,row.id);if(JSON.stringify(current)!==JSON.stringify(r)){retained.push(row);continue;}
        await fs.rm(directory,{recursive:true,force:false});removed++;
      }
      await this.writeIndex(folder,retained);return {removed,retained:retained.length,warning:retained.length>=200000};
    };return ownsFolderLock(folder)?action():folderLock(folder,path.join(path.dirname(this.root),'folder-locks'),action);
  }
  async execute(folder, id, name, args, action) {
    const key = this.key(folder, id), fingerprint = hash(JSON.stringify(stable({ name, args })));
    let existing = await this.read(folder, id);
    if (this.root && !existing) {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      try {
        await fs.mkdir(path.join(this.root, key), { mode: 0o700 });
      } catch (e) { if (e.code !== 'EEXIST') throw e; existing = await this.read(folder, id); }
    }
    const correctableProposal=existing?.status==='completed'&&existing.result?.conflict===true&&['copy_file','move_file'].includes(existing.tool)&&existing.tool===name&&!existing.resolvedBy&&existing.fingerprint!==fingerprint;
    if (existing&&existing.status!=='rejected'&&!correctableProposal) {
      if (existing.fingerprint && existing.fingerprint !== fingerprint) throw new Error('操作编号已被不同参数使用，本次未执行。');
      if (existing.status === 'completed') return { ...existing.result, operationId: id, replayed: true };
      throw new Error('该操作已经开始或结果不确定，不会重复执行；请查询操作编号 ' + id + '。');
    }
    const owner=await beginJournalSession(this.root,key);
    const receipt = {session:owner.session,operationId: id, fingerprint, tool: name, status: 'pending', retryAllowed: false, startedAt: new Date().toISOString() };
    try {await this.save(key, receipt);
      const result = { ...await action(), operationId: id };if(result.conflict&&['copy_file','move_file'].includes(name)){result.proposalOnly=true;result.applied=false;result.changed=false;result.retryAllowed=true;}
      await this.save(key, { ...receipt, status: 'completed', endedAt: new Date().toISOString(), result });
      return result;
    } catch (e) {
      // A failed call might have applied part of a mutation: never automatically replay.
      try { await this.save(key, { ...receipt, status:e.precondition?'rejected':'failed_or_unknown',retryAllowed:e.precondition===true,endedAt: new Date().toISOString(), error:e.code||e.message,...(e.code==='CFB_RESULT_UNKNOWN'?{sourceState:e.sourceState,remainingEntries:e.remainingEntries,remainingCountTruncated:e.remainingCountTruncated}:{}),...(e.code==='CFB_PERMANENTLY_DELETED'?{permanentlyDeleted:true,recoverable:false}:{}) }); } catch {}
      const failure = new Error(explainError(e) + '；操作编号：' + id + (e.precondition?'。未执行修改，修正后可以沿用同一编号重试。':'。先查询结果，不要盲目重试。'), {cause:e}); failure.code = e.code;failure.precondition=e.precondition===true;for(const key of ['sourceState','remainingEntries','remainingCountTruncated','permanentlyDeleted','recoverable'])if(e[key]!==undefined)failure[key]=e[key];throw failure;
    }finally{endJournalSession(key);}
  }
}
