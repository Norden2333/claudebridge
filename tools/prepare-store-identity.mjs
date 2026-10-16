import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';import {publicIdentity} from '../companion/extension-identity.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const keyAt=process.argv.indexOf('--public-key'),outAt=process.argv.indexOf('--output');
if(keyAt<0||outAt<0||!process.argv[keyAt+1]||!process.argv[outAt+1])throw new Error('需要 --public-key 文件路径和 --output 新目录。');
const file=path.resolve(process.argv[keyAt+1]);if((await fs.stat(file)).size>16384)throw new Error('公钥文件过大。');
const identity=publicIdentity(await fs.readFile(file,'utf8')),output=path.resolve(process.argv[outAt+1]);
const inside=(a,b)=>{const r=path.relative(a,b);return !r||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
if(inside(source,output)||inside(output,source))throw new Error('输出目录必须与源码分开。');
try{await fs.lstat(output);throw new Error('输出目录已存在，不覆盖。');}catch(e){if(e.code!=='ENOENT')throw e;}
const privateNames=new Set(['native-host.json','native-launcher.cmd','native-launcher','settings.json','device.json','host.lock']);
async function check(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink()||privateNames.has(e.name)||e.name==='state'||e.name.startsWith('.cfb-'))throw new Error('源码含链接或私有状态，未复制。');const p=path.join(dir,e.name);if(e.isDirectory())await check(p);}}
await check(source);await fs.cp(source,output,{recursive:true,errorOnExist:true,force:false});
const manifestFile=path.join(output,'extension/manifest.json'),manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));manifest.key=identity.publicKey;
for(const [p,value]of [[manifestFile,manifest],[path.join(output,'identity.json'),identity]]){const text=JSON.stringify(value,null,2);await fs.writeFile(p,text);if(await fs.readFile(p,'utf8')!==text)throw new Error('身份写后校验失败。');}
// The old source inventory no longer describes this identity. Rebuild before installation.
await fs.rm(path.join(output,'MANIFEST.sha256'),{force:true});
process.stdout.write(JSON.stringify({extensionId:identity.extensionId,sourceChanged:false,registered:false,published:false,nextStep:'Compare this ID with the dashboard item ID; rebuild matching Windows helper and extension archives.'}));
