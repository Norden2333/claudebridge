import {durableRecord} from './record-io.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const key=folder=>crypto.createHash('sha256').update(folder||'').digest('hex');
export async function protectedPaths(executor){
 if(!executor.journal.root)return executor.protectedMemory||[];
 try{const values=JSON.parse(await fs.readFile(path.join(path.dirname(executor.journal.root),'protected',key(executor.config.folder)+'.json'),'utf8'));if(!Array.isArray(values)||values.length>200||values.some(x=>typeof x!=='string'||x.length>4096))throw new Error('参考保护设置不可读取，未开始修改。');return values;}catch(e){if(e.code==='ENOENT')return [];throw Object.assign(new Error('参考保护设置损坏或不可读取，未开始修改；请在工作台核对并重新保存保护列表。'),{code:'CFB_PROTECTION_INVALID'});}
}
export async function setProtectedPaths(executor,values){
 if(!Array.isArray(values)||values.length>200)throw new Error('一次最多保护200个文件或子文件夹。');
 const names=[];for(const value of values){const target=await executor.target(value);const name=executor.label(target);if(!names.includes(name))names.push(name);}
 if(!executor.journal.root){executor.protectedMemory=names;return {paths:names};}
 const directory=path.join(path.dirname(executor.journal.root),'protected');await fs.mkdir(directory,{recursive:true,mode:0o700});const file=path.join(directory,key(executor.config.folder)+'.json');await durableRecord(file,names);return {paths:names};
}
export async function checkProtection(executor,name,args){
 const rules=await protectedPaths(executor);
 const tree=['move_file','delete_directory'].includes(name);
 const values=name==='copy_file'?[args.destination]:name==='move_file'?[args.source,args.destination]:name==='edit_office_text'?[args.output_path]:[args.file_path??args.path];
 const normal=value=>process.platform==='win32'?value.toLowerCase():value;
 for(const value of values){if(typeof value!=='string')continue;const target=await executor.target(value);await executor.assertInternalTarget?.(target,tree);const current=normal(executor.label(target));for(const rule of rules){const p=normal(rule);if(current===p||current.startsWith(p+'/')||tree&&p.startsWith(current+'/'))throw new Error('“'+rule+'”已设为仅供参考，可读取或复制另存，不能修改、移动或删除；请在本机工作台解除保护后再操作。');}}
}
