import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {normalizeSettings} from './settings.mjs';import {scopeId} from './activity.mjs';
const sha=raw=>raw===null?null:crypto.createHash('sha256').update(raw).digest('hex');
async function bytes(file){try{return await fs.readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function validProfiles(list){if(!Array.isArray(list)||list.length>10||list.some(x=>!x||typeof x.folder!=='string'||!x.folder||x.scope!==scopeId(x.folder)||typeof x.allowWrites!=='boolean')||new Set(list.map(x=>x.scope)).size!==list.length)throw new Error('现有授权列表损坏，未执行升级。');}
export async function migrationSnapshot(state){
 const file=path.join(state,'settings.json');
 for(const p of [file,path.join(state,'folders.json')])try{if((await fs.lstat(p)).isSymbolicLink())throw new Error('设置含链接，未执行升级。');}catch(e){if(e.code!=='ENOENT')throw e;}
 const settings=await bytes(file),folders=await bytes(path.join(state,'folders.json'));
 if(settings!==null){const value=JSON.parse(settings);if(value.storageVersion!==undefined){if(value.storageVersion!==2)throw new Error('现有设置格式不支持迁移。');const {storageVersion,authorizedFolders,...config}=value;const normalized=await normalizeSettings(config);validProfiles(authorizedFolders);if(normalized.folder&&!authorizedFolders.some(x=>x.scope===scopeId(normalized.folder)&&x.allowWrites===normalized.allowWrites))throw new Error('当前目录授权不一致，未升级。');}
 else{await normalizeSettings(value);if(folders!==null)validProfiles(JSON.parse(folders));}}
 else if(folders!==null)validProfiles(JSON.parse(folders));
 return {settingsSha256:sha(settings),foldersSha256:sha(folders)};
}
export async function assertDowngradeSafe(state,record){
 if((record.fromStateSchema??1)>=(record.toStateSchema??1))return;
 const raw=await bytes(path.join(state,'settings.json'));if(raw===null)return;
 const value=JSON.parse(raw);if((value.storageVersion??1)>(record.fromStateSchema??1))throw new Error('授权设置已升级，不能直接切回不支持它的旧程序。新设置和撤销记录保留，请使用兼容版本。');
}
