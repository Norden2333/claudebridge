import fs from 'node:fs/promises';
import path from 'node:path';
import {durableRecord} from './record-io.mjs';
export function validUiLanguage(value){return value==='zh-CN'||value==='en';}
export async function readUiLanguage(root){try{const file=path.join(root,'ui-language.json'),st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1024)return 'zh-CN';const record=JSON.parse(await fs.readFile(file,'utf8'));return validUiLanguage(record.language)?record.language:'zh-CN';}catch{return 'zh-CN';}}
export async function writeUiLanguage(root,language){if(!validUiLanguage(language))throw new Error('Unsupported interface language.');await fs.mkdir(root,{recursive:true,mode:0o700});const file=path.join(root,'ui-language.json');try{if((await fs.lstat(file)).isSymbolicLink())throw new Error('Interface language file cannot be a link.');}catch(e){if(e.code!=='ENOENT')throw e;}await durableRecord(file,{version:1,language});if(await readUiLanguage(root)!==language)throw new Error('Interface language was not saved.');return {uiLanguage:language};}
