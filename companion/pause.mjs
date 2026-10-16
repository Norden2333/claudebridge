import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export async function isPaused(root){if(!root)return false;try{return JSON.parse(await fs.readFile(path.join(root,'file-pause.json'),'utf8')).paused===true;}catch(e){if(e.code==='ENOENT')return false;throw new Error('暂停状态不可读取，文件操作未开始。');}}
export async function setPaused(root,paused){if(typeof paused!=='boolean')throw new Error('暂停参数无效。');await fs.mkdir(root,{recursive:true,mode:0o700});const temp=path.join(root,'.pause-'+crypto.randomUUID());await fs.writeFile(temp,JSON.stringify({paused}),{flag:'wx',mode:0o600});await fs.rename(temp,path.join(root,'file-pause.json'));return {paused};}
export async function assertActive(root){if(await isPaused(root))throw Object.assign(new Error('文件操作已暂停，本次未开始；请在小窗恢复。'),{code:'CFB_PAUSED'});}
