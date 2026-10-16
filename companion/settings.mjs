import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {broadFolder} from './sensitive-paths.mjs';
import {scopeId} from './activity.mjs';
import { validateFolder } from './files.mjs';

export const HOST = 'local.claude_folder_bridge';
export const stateRoot = process.env.CFB_STATE_DIR || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ClaudeFolderBridge') : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeFolderBridge') : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'claude-folder-bridge'));
export function validateProxy(value) {
  const u = new URL(value);if(u.hostname.toLowerCase()==='localhost')u.hostname='127.0.0.1';
  if (!['http:','https:','socks5:','socks5h:'].includes(u.protocol) || !['127.0.0.1', '[::1]'].includes(u.hostname) || !u.port || u.username || u.password || u.search || u.hash || !['','/'].includes(u.pathname)) throw new Error('代理须为无账号的本机 HTTP、HTTPS 或 SOCKS5 地址。');
  return ['socks5:','socks5h:'].includes(u.protocol)?u.protocol+'//'+u.host:u.origin;
}
export async function normalizeSettings(input, {verifyFolder=true}={}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['folder', 'proxy', 'allowWrites', 'relayEnabled', 'networkMode', 'systemNetworkAccepted','broadFolderAccepted','preserveOutputDirs','archiveRetentionDays'].includes(k))) throw new Error('设置无效。');
  if (typeof input.allowWrites !== 'boolean' || typeof input.relayEnabled !== 'boolean') throw new Error('权限设置无效。');
  const networkMode = input.networkMode ?? 'proxy';
  if (!['auto', 'proxy', 'system'].includes(networkMode)) throw new Error('连接方式无效。');
  const systemNetworkAccepted = input.systemNetworkAccepted ?? false;
  if (typeof systemNetworkAccepted !== 'boolean') throw new Error('网络确认无效。');
  if (networkMode === 'system' && input.relayEnabled && !systemNetworkAccepted) throw new Error('请先确认 VPN/TUN 路由及断线保护；系统网络可能直接联网。');
  const proxy = networkMode === 'proxy' && (input.proxy || input.relayEnabled) ? validateProxy(input.proxy) : '';
  let folder=null;
  if(input.folder){
    if(typeof input.folder!=='string'||!path.isAbsolute(input.folder)||input.folder.includes('\0')||path.resolve(input.folder)===path.parse(path.resolve(input.folder)).root)throw new Error('请选择工作文件夹，不能选择整个磁盘。');
    if(verifyFolder&&broadFolder(input.folder)&&input.broadFolderAccepted!==true)throw Object.assign(new Error('此位置包含系统和程序数据，需额外确认授权。'),{code:'CFB_BROAD_FOLDER'});
    folder=verifyFolder?await validateFolder(input.folder):path.normalize(input.folder);
  }
  if(input.archiveRetentionDays!==undefined&&input.archiveRetentionDays!==null&&(!Number.isInteger(input.archiveRetentionDays)||input.archiveRetentionDays<7||input.archiveRetentionDays>3650))throw new Error('归档保留期须为7至3650天，或关闭自动回收。');
  if(input.preserveOutputDirs!==undefined&&typeof input.preserveOutputDirs!=='boolean')throw new Error('成果子目录设置无效。');
  const broadFolderAccepted=input.broadFolderAccepted??false;if(typeof broadFolderAccepted!=='boolean')throw new Error('目录确认无效。');
  if(verifyFolder&&folder&&broadFolder(folder)&&!broadFolderAccepted)throw Object.assign(new Error('此位置包含系统和程序数据，需额外确认授权；敏感位置仍受保护。'),{code:'CFB_BROAD_FOLDER'});
  return { networkMode, systemNetworkAccepted,...(input.archiveRetentionDays!==undefined?{archiveRetentionDays:input.archiveRetentionDays}:{}),...(input.preserveOutputDirs!==undefined?{preserveOutputDirs:input.preserveOutputDirs}:{}), ...(input.broadFolderAccepted!==undefined?{broadFolderAccepted}:{}), folder, proxy, allowWrites: input.allowWrites, relayEnabled: input.relayEnabled };
}
// Version 2 has one authoritative record for current scope and all authorizations.
async function diskBytes(file){try{return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const sameBytes=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
function profiles(value){
 if(!Array.isArray(value)||value.length>10||value.some(x=>!x||typeof x.folder!=='string'||!x.folder||x.scope!==scopeId(x.folder)||typeof x.allowWrites!=='boolean')||new Set(value.map(x=>x.scope)).size!==value.length)throw new Error('文件夹授权记录无效，未开放访问。');
 return value.map(({folder,scope,allowWrites})=>({folder,scope,allowWrites}));
}
async function stored(){
 const raw=await diskBytes(path.join(stateRoot,'settings.json'));if(raw===null)return {raw,config:{folder:null,networkMode:'auto',systemNetworkAccepted:false,proxy:'',allowWrites:false,relayEnabled:false},profiles:null};
 const value=JSON.parse(raw);if(value?.storageVersion!==undefined){
  if(value.storageVersion!==2)throw new Error('本机设置格式不兼容，未开放文件访问。');
  const {storageVersion,authorizedFolders,...config}=value,list=profiles(authorizedFolders),normalized=await normalizeSettings(config,{verifyFolder:false});
  if(normalized.folder&&!list.some(p=>p.scope===scopeId(normalized.folder)&&p.allowWrites===normalized.allowWrites))throw new Error('当前目录与授权权限不一致，未开放文件访问。');
  return {raw,config:normalized,profiles:list};
 }
 return {raw,config:await normalizeSettings(value,{verifyFolder:false}),profiles:null};
}
async function legacyProfiles(){const raw=await diskBytes(path.join(stateRoot,'folders.json'));return raw===null?[]:profiles(JSON.parse(raw));}
export async function loadSettings(){return (await stored()).config;}
export async function recentFolders(){const current=await stored();return current.profiles??await legacyProfiles();}
let saveChain=Promise.resolve();
function serialized(action){const next=saveChain.then(action);saveChain=next.catch(()=>{});return next;}
export function saveSettings(input){return serialized(()=>saveSettingsNow(input));}
export function revokeFolder(scope){return serialized(async()=>{
 if(typeof scope!=='string'||!/^[a-f0-9]{64}$/.test(scope))throw new Error('授权目录编号无效。');
 const current=await stored(),list=current.profiles??await legacyProfiles(),active=current.config.folder&&scopeId(current.config.folder)===scope;
 const config=active?{...current.config,folder:null,allowWrites:false,relayEnabled:false}:current.config;
 return saveSettingsNow(config,scope);
});}
async function durableWrite(file,data,onCreated=()=>{}){
 const fd=await fs.open(file,'wx',0o600);onCreated();try{await fd.writeFile(data);await fd.sync();}finally{await fd.close();}
}
async function saveSettingsNow(input,removeScope){
 const current=await stored(),config=await normalizeSettings(input,{verifyFolder:!input?.folder||input.folder!==current.config.folder});let list=current.profiles??await legacyProfiles();
 if(removeScope)list=list.filter(p=>p.scope!==removeScope);
 if(config.folder){const scope=scopeId(config.folder);list=[{scope,folder:config.folder,allowWrites:config.allowWrites},...list.filter(p=>p.scope!==scope)].slice(0,10);}
 const data=Buffer.from(JSON.stringify({...config,storageVersion:2,authorizedFolders:list})),file=path.join(stateRoot,'settings.json'),temp=path.join(stateRoot,'settings-'+crypto.randomUUID()+'.tmp');
 await fs.mkdir(stateRoot,{recursive:true,mode:0o700});let created=false,published=false;
 try{
  await durableWrite(temp,data,()=>{created=true;});
  if(!sameBytes(await diskBytes(temp),data))throw new Error('设置暂存校验失败，未发布。');
  if(!sameBytes(await diskBytes(file),current.raw))throw new Error('保存期间设置被其他程序修改，未覆盖。');
  await fs.rename(temp,file);created=false;published=true;
  if(!sameBytes(await diskBytes(file),data))throw new Error('设置写后校验失败。');return config;
 }catch(error){
  if(published){
   if(!sameBytes(await diskBytes(file),data))throw new Error('设置保存结果需要核对，当前记录有额外变化，未覆盖。');
   if(current.raw===null)await fs.unlink(file);
   else{const restore=path.join(stateRoot,'restore-settings-'+crypto.randomUUID()+'.tmp');let made=false;try{await durableWrite(restore,current.raw,()=>{made=true;});await fs.rename(restore,file);made=false;}finally{if(made)await fs.rm(restore,{force:true});}}
   if(!sameBytes(await diskBytes(file),current.raw))throw new Error('设置恢复校验失败，请核对本机设置。');
  }
  throw error;
 }finally{if(created)await fs.rm(temp,{force:true});}
}
