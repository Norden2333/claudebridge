import fs from 'node:fs/promises';import path from 'node:path';import {folderLock} from './folder-lock.mjs';
const groups={backups:['backups'],staging:['incoming'],operations:['operations','updates'],assets:['assets','ignored-assets'],login:['device']};
export const privateCategories=Object.keys(groups);
async function measure(target,context){
 if(++context.entries>200000||Date.now()>context.deadline)throw Object.assign(new Error('私有数据较多，统计未完成，未开始清除。'),{code:'CFB_PRIVACY_LIMIT'});
 let stat;try{stat=await fs.lstat(target);}catch(e){if(e.code==='ENOENT')return 0;throw e;}if(stat.isSymbolicLink())throw Object.assign(new Error('私有数据包含链接，停止自动清除。'),{code:'CFB_PRIVACY_PATH'});if(stat.isFile())return stat.size;if(!stat.isDirectory())throw new Error('私有目录包含特殊文件，未清除。');let bytes=0;for(const name of await fs.readdir(target))bytes+=await measure(path.join(target,name),context);return bytes;
}
export async function privateUsage(root){const real=await fs.realpath(root);if(real===path.parse(real).root)throw new Error('私有根目录无效。');const context={entries:0,deadline:Date.now()+15000},items=[];for(const [category,names]of Object.entries(groups)){let bytes=0;for(const name of names)bytes+=await measure(path.join(real,name),context);items.push({category,bytes});}return {items,totalBytes:items.reduce((a,b)=>a+b.bytes,0),backupsPlaintext:true,settingsPreserved:true};}
export async function purgePrivate(root,categories,{confirm=false,folders=[]}={}){
 if(confirm!==true||!Array.isArray(categories)||!categories.length||categories.length>5||new Set(categories).size!==categories.length||categories.some(x=>!privateCategories.includes(x)))throw new Error('清除私有数据需要明确选择及永久删除确认。');
 const real=await fs.realpath(root);if(real===path.parse(real).root)throw new Error('私有根目录无效。');const ordered=[...new Set(folders)].sort(),locks=path.join(real,'folder-locks');
 const work=async index=>{if(index<ordered.length)return folderLock(ordered[index],locks,()=>work(index+1),{waitMs:60000});
  const context={entries:0,deadline:Date.now()+15000},plan=[];for(const category of categories)for(const name of groups[category]){const target=path.join(real,name);if(path.dirname(target)!==real)throw new Error('清理路径不在私有目录内。');plan.push({category,target,bytes:await measure(target,context)});}
  const items=[];let deletedBytes=0;for(const entry of plan){try{await fs.rm(entry.target,{recursive:true,force:true});try{await fs.lstat(entry.target);throw new Error('清理后目录再次出现，结果需核对。');}catch(e){if(e.code!=='ENOENT')throw e;}deletedBytes+=entry.bytes;items.push({category:entry.category,deleted:true,bytes:entry.bytes});}catch{return {purged:false,partial:true,permanent:true,deletedBytes,items,failedCategory:entry.category,settingsPreserved:true,guidance:'部分私有数据清除未确认，未自动重试；请核对后明确处理。'};}}
  return {purged:true,permanent:true,deletedBytes,items,settingsPreserved:true,serverDeviceRevoked:false};};return work(0);
}
