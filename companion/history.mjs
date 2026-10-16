import {withBackupLock,readBackupUsage,writeBackupUsage,invalidateBackupUsage} from './backup-usage.mjs';
import {readJsonRecord,durableRecord,validBackup} from './record-io.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fingerprint,copyVerified} from './safe-io.mjs';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
export class FileHistory {
  constructor(root=null,{maxCount=2000,maxBytes=4*1024**3,archiveBytes=16*1024**3}={}){this.root=root;this.memory=new Map();this.limits={maxCount,maxBytes,archiveBytes};}
  async binaryPath(id){const active=path.join(this.root,id+'.bin');try{await fs.access(active);return active;}catch(e){if(e.code!=='ENOENT')throw e;return path.join(this.root,'archive',id+'.bin');}}
  async ensureCapacity(incoming,folder){
    const cached=await readBackupUsage(this.root);if(cached.activeCount+1<=this.limits.maxCount*0.8&&cached.activeBytes+incoming<=this.limits.maxBytes*0.8)return cached;
    const archive=path.join(this.root,'archive'),records=[],all=[],active=[];let activeBytes=0,archiveBytes=0,archiveCount=0;
    for(const directory of [this.root,archive]){let names=[];try{names=await fs.readdir(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
      for(const name of names.filter(name=>/^[0-9a-f-]{36}\.bin$/.test(name))){const stat=await fs.lstat(path.join(directory,name));if(!stat.isFile()||stat.isSymbolicLink())continue;const item={id:name.slice(0,-4),bytes:stat.size};if(directory===this.root){active.push(item);activeBytes+=stat.size;}else {archiveBytes+=stat.size;archiveCount++;}}
      for(const name of names.filter(name=>/^[0-9a-f-]{36}\.json$/.test(name))){const loaded=await readJsonRecord(path.join(directory,name),validBackup);if(loaded.ok){all.push(loaded.value);if(directory===this.root)records.push(loaded.value);}}
    }
    if(active.length<this.limits.maxCount&&activeBytes+incoming<=this.limits.maxBytes)return writeBackupUsage(this.root,{activeBytes,activeCount:active.length,archiveBytes,archiveCount});
    let cap=this.limits.archiveBytes;try{const space=await fs.statfs(this.root);cap=Math.min(cap,space.bavail*space.bsize*0.1);}catch{}
    await fs.mkdir(archive,{recursive:true,mode:0o700});
    for(const record of records.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){
      if(active.length<this.limits.maxCount&&activeBytes+incoming<=this.limits.maxBytes)return writeBackupUsage(this.root,{activeBytes,activeCount:active.length,archiveBytes,archiveCount});
      const item=active.find(item=>item.id===record.backupId);if(!item)continue;
      const newer=all.filter(r=>r.folderHash===record.folderHash&&r.path===record.path&&r.createdAt>record.createdAt).length;
      let missingOld=false;if(path.isAbsolute(folder||'')&&record.folderHash===hash(folder)&&Date.now()-Date.parse(record.createdAt)>30*86400000){try{await fs.lstat(path.join(folder,record.path));}catch(e){missingOld=e.code==='ENOENT';}}
      if(newer<5&&!missingOld)continue; // Archive only eligible backups; never delete their bytes.
      if(archiveBytes+item.bytes>cap)break;
      const oldBin=path.join(this.root,item.id+'.bin'),oldMeta=path.join(this.root,item.id+'.json'),newBin=path.join(archive,item.id+'.bin'),newMeta=path.join(archive,item.id+'.json');
      let exists=false;for(const file of [newBin,newMeta])try{await fs.lstat(file);exists=true;}catch(e){if(e.code!=='ENOENT')throw e;}if(exists)continue;
      await fs.rename(oldBin,newBin);try{await fs.rename(oldMeta,newMeta);}catch(e){await fs.rename(newBin,oldBin);throw e;}
      active.splice(active.indexOf(item),1);activeBytes-=item.bytes;archiveBytes+=item.bytes;archiveCount++;
    }
    await writeBackupUsage(this.root,{activeBytes,activeCount:active.length,archiveBytes,archiveCount});
    if(active.length>=this.limits.maxCount||activeBytes+incoming>this.limits.maxBytes)throw new Error('备份空间已满，本次未修改文件。可自动归档的旧版本不足或归档空间达到上限，请在工作台整理备份；没有永久删除副本。');
    return readBackupUsage(this.root);
  }
  async save(folder, relative, data, afterSha256) {
    const id = crypto.randomUUID(), record = { backupId: id, folderHash: hash(folder), path: relative, beforeSha256: hash(data), afterSha256, bytes: data.length, createdAt: new Date().toISOString() };
    if (!this.root) { this.memory.set(id,{ record, data: Buffer.from(data) }); return record; }
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    return withBackupLock(this.root,async()=>{const usage=await this.ensureCapacity(data.length,folder);
    await invalidateBackupUsage(this.root);const handle=await fs.open(path.join(this.root,id+'.bin'),'wx',0o600);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
    try{await durableRecord(path.join(this.root,id+'.json'),record);await writeBackupUsage(this.root,{...usage,activeBytes:usage.activeBytes+record.bytes,activeCount:usage.activeCount+1});if(usage.activeCount+1>=this.limits.maxCount*0.8||usage.activeBytes+record.bytes>=this.limits.maxBytes*0.8)record.backupWarning=true;return record;}catch(e){await invalidateBackupUsage(this.root).catch(()=>{});throw e;}
    });
  }
  async load(folder, relative, id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('恢复编号无效。');
    const stored = this.root ? { record:await this.metadata(folder,id), data:await fs.readFile(await this.binaryPath(id)) } : this.memory.get(id);
    if (!stored || stored.record.folderHash !== hash(folder) || stored.record.path !== relative || hash(stored.data) !== stored.record.beforeSha256) throw new Error('恢复副本不匹配或损坏，未改动文件。'); return stored;
  }
  async metadata(folder,id) {
    if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw new Error('恢复编号无效。');
    let result=this.root?await readJsonRecord(path.join(this.root,id+'.json'),r=>validBackup(r)&&r.backupId===id):null;if(result?.missing)result=await readJsonRecord(path.join(this.root,'archive',id+'.json'),r=>validBackup(r)&&r.backupId===id);
    if(result&&!result.ok)throw new Error('这个恢复记录已损坏或不可读取，无法使用；原文件未修改。');
    const record=this.root?result.value:this.memory.get(id)?.record;
    if(!record||record.folderHash!==hash(folder))throw new Error('恢复副本不属于当前文件夹。');
    return record;
  }
  async recent(folder) {
    const records=[];
    if(!this.root)return [...this.memory.values()].map(x=>x.record).filter(x=>x.folderHash===hash(folder)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);
    let names;try{names=await fs.readdir(this.root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
    let corruptCount=0;for(const name of names.filter(n=>/^[0-9a-f-]{36}\.json$/.test(n)).slice(0,2000)){const result=await readJsonRecord(path.join(this.root,name),r=>validBackup(r)&&r.backupId===name.slice(0,-5));if(!result.ok){if(result.corrupt)corruptCount++;continue;}if(result.value.folderHash===hash(folder))records.push(result.value);}
    const recent=records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,50);recent.corruptCount=corruptCount;return recent;
  }
  async saveBinary(folder,relative,source,afterSha256) {
    if(!this.root)throw new Error('二进制替换需要已配置本机恢复目录。');
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    return withBackupLock(this.root,async()=>{const baseline=await fingerprint(source),usage=await this.ensureCapacity(baseline.bytes,folder);
    const backupId=crypto.randomUUID(),record={backupId,folderHash:hash(folder),path:relative,beforeSha256:baseline.sha256,afterSha256,bytes:baseline.bytes,createdAt:new Date().toISOString(),binary:true};
    await invalidateBackupUsage(this.root);await copyVerified(source,path.join(this.root,backupId+'.bin'),{expectedSha256:baseline.sha256});
    try{await durableRecord(path.join(this.root,backupId+'.json'),record);await writeBackupUsage(this.root,{...usage,activeBytes:usage.activeBytes+record.bytes,activeCount:usage.activeCount+1});if(usage.activeCount+1>=this.limits.maxCount*0.8||usage.activeBytes+record.bytes>=this.limits.maxBytes*0.8)record.backupWarning=true;return record;}catch(e){await invalidateBackupUsage(this.root).catch(()=>{});throw e;}
    });
  }
  async list(folder, relative) {
    let records;
    if (!this.root) records = [...this.memory.values()].map(item => item.record);
    else {
      let names; try { names = await fs.readdir(this.root); } catch(e) { if(e.code==='ENOENT') return []; throw e; }
      records = [];
      for (const name of names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).slice(0,2000)) { const result=await readJsonRecord(path.join(this.root,name),r=>validBackup(r)&&r.backupId===name.slice(0,-5));if(result.ok)records.push(result.value); }
    }
    return records.filter(r=>r.folderHash===hash(folder) && r.path===relative).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,5).map(({backupId,createdAt,bytes,afterSha256})=>({backupId,createdAt,bytes,afterSha256}));
  }
}
