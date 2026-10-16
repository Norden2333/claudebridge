import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {readBounded} from './safe-io.mjs';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function store(file,value){const temp=file+'.'+crypto.randomUUID()+'.tmp';try{const h=await fs.open(temp,'wx',0o600);try{await h.writeFile(JSON.stringify(value));await h.sync();}finally{await h.close();}await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
// Called under the same authorized-folder lock as file movement/asset commit.
export async function relocateAssetBindings(root,folder,source,destination,directory=false){
 if(!root)return 0;let entries;try{entries=await fs.readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return 0;throw e;}
 const prefix=hash(folder)+'-',compare=value=>value;
 const from=compare(source),to=compare(destination);let changed=0;
 for(const entry of entries){
  if(!entry.isFile()||!entry.name.startsWith(prefix)||!new RegExp('^'+prefix+'[a-f0-9]{64}\\.json$').test(entry.name))continue;
  const file=path.join(root,entry.name),record=JSON.parse((await readBounded(file,256*1024)).toString('utf8'));if(typeof record.path!=='string')throw new Error('成果关联记录损坏，移动结果需核对。');
  const current=compare(record.path),isSource=current===from||directory&&current.startsWith(from+'/');
  if(isSource){await store(file,{...record,path:destination+record.path.slice(source.length),updatedAt:new Date().toISOString()});changed++;}
  else if(current===to||directory&&current.startsWith(to+'/')){await store(file,{...record,paused:true,replacedByMove:true});changed++;}
 }
 return changed;
}
export async function pauseOtherAssetBindings(root,folder,target,currentKey){
 let entries;try{entries=await fs.readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
 const prefix=hash(folder)+'-';
 for(const entry of entries){if(!entry.isFile()||!new RegExp('^'+prefix+'[a-f0-9]{64}\\.json$').test(entry.name)||entry.name===prefix+currentKey+'.json')continue;const file=path.join(root,entry.name),record=JSON.parse((await readBounded(file,256*1024)).toString('utf8'));if((process.platform==='win32'?record.path?.toLowerCase():record.path)===(process.platform==='win32'?target.toLowerCase():target))await store(file,{...record,paused:true,replacedByDifferentAsset:true});}
}
