import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {fingerprint} from './safe-io.mjs';
import {folderLock} from './folder-lock.mjs';
import {explainError} from './errors.mjs';
export async function setupStatus(ex,version){let folder={configured:!!ex.config.folder,path:ex.config.folder||'',readable:false};if(ex.config.folder){try{await ex.target('.',true);await fs.readdir(ex.config.folder);folder.readable=true;}catch(e){folder.message=explainError(e);}}return {version,nodeVersion:process.versions.node,nodeSupported:Number(process.versions.node.split('.')[0])>=22,folder,allowWrites:!!ex.config.allowWrites,relayEnabled:!!ex.config.relayEnabled};}
export async function setupCheck(ex,write=false){return folderLock(ex.config.folder,ex.lockRoot,async()=>{
 const root=await ex.target('.',true);if(!write)return {readable:true,items:(await fs.readdir(root)).length,contentsRead:false};
 await ex.assertActive();if(!ex.config.allowWrites)throw new Error('验证读写前请在设置中开启允许修改。');const relative='__claude_setup_check_'+crypto.randomUUID()+'.txt',target=await ex.target(relative),text='local-check-'+crypto.randomUUID();await ex.checkProtection('write_file',{path:relative});const expected=crypto.createHash('sha256').update(text).digest('hex');let created=false;
 try{await fs.writeFile(target,text,{flag:'wx',mode:0o600});created=true;if((await fingerprint(target)).sha256!==expected)throw new Error('验证文件被修改，未自动删除。');return {readable:true,writable:true,verified:true,contentsRead:false,testFile:relative,cleaned:true};}
 finally{if(created){const current=await fingerprint(target);if(current.sha256!==expected)throw new Error('测试文件后来被改变，已保留，请在目录中核对：'+relative);await ex.target(relative);await fs.unlink(target);}}
});}
