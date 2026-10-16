import {writeUiLanguage,validUiLanguage} from './ui-language.mjs';
import {windowsCommand,systemEnvironment} from './system-tools.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {folderLock} from './folder-lock.mjs';import {copyVerified} from './safe-io.mjs';import {stateRoot,HOST} from './settings.mjs';
const run=promisify(execFile),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const nodeHash='3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237';
function inside(root,name){if(typeof name!=='string'||/[\x00-\x1f]/.test(name)||name.includes('\\')||name.includes(':'))throw new Error('安装清单路径无效。');const target=path.resolve(root,name),relative=path.relative(root,target);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('安装文件路径越界。');return target;}
async function noLinks(target){let current=path.resolve(target);for(;;){try{if((await fs.lstat(current)).isSymbolicLink())throw new Error('安装路径含链接或目录联接，请选择普通文件夹。');}catch(e){if(e.code!=='ENOENT')throw e;}const parent=path.dirname(current);if(parent===current)break;current=parent;}}
async function missing(target){try{await fs.lstat(target);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
export async function windowsInstallPlan(source,target,{verifyRuntime=true}={}){
 source=await fs.realpath(source);target=path.resolve(target);await noLinks(target);const relative=path.relative(source,target),reverse=path.relative(target,source);
 if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)||!reverse.startsWith('..'+path.sep)&&reverse!=='..'&&!path.isAbsolute(reverse)||target===path.parse(target).root||target.startsWith('\\\\'))throw new Error('安装目录不能是源目录、它的内部、上级目录或磁盘根目录。');
 if(!await missing(target))throw new Error('这个位置已存在，请使用更新入口或选择一个新的安装目录；不会覆盖。');
 const inventory=await fs.readFile(path.join(source,'MANIFEST.sha256'),'utf8'),files=[],seen=new Set();
 for(const line of inventory.trim().split(/\r?\n/)){const match=line.match(/^([a-f0-9]{64})  (.+)$/);if(!match)throw new Error('安装包清单无效。');const name=match[2],key=process.platform==='win32'?name.toLowerCase():name;if(seen.has(key))throw new Error('安装清单有重复文件。');seen.add(key);const file=inside(source,name);await noLinks(file);const bytes=await fs.readFile(file);if(hash(bytes)!==match[1])throw new Error('安装包文件校验失败：'+name);files.push({name,sha256:match[1]});}
 files.push({name:'MANIFEST.sha256',sha256:hash(Buffer.from(inventory))});
 if(verifyRuntime&&!files.some(f=>f.name==='runtime/node.exe'&&f.sha256===nodeHash))throw new Error('包内运行环境缺失或不匹配。');
 const pkg=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8')),manifest=JSON.parse(await fs.readFile(path.join(source,'extension/manifest.json'),'utf8'));
 if(pkg.version!==manifest.version||pkg.name!=='claude-folder-bridge')throw new Error('安装包版本或身份不一致。');return {source,target,version:pkg.version,files,changesApplied:false,globalNodeChanged:false};
}
async function registration(root,state,remove=false){await run(path.join(root,'runtime/node.exe'),[path.join(root,'companion/install.mjs'),...(remove?['--uninstall']:[])],{env:{...systemEnvironment(),CFB_STATE_DIR:state},windowsHide:true,timeout:60000,maxBuffer:32768});}
async function registryFree(){try{await run(windowsCommand('reg.exe'),['query','HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\'+HOST,'/ve'],{windowsHide:true,env:systemEnvironment()});throw new Error('本机已有通用版连接，请从原安装位置更新，不会覆盖注册。');}catch(e){if(e.code!==1)throw e;}}
async function acl(state,restore){const command=restore?'$acl=Get-Acl -LiteralPath $env:CFB_ACL_TARGET; $acl.SetSecurityDescriptorSddlForm($env:CFB_ACL_VALUE); Set-Acl -LiteralPath $env:CFB_ACL_TARGET -AclObject $acl':'if(Test-Path -LiteralPath $env:CFB_ACL_TARGET){(Get-Acl -LiteralPath $env:CFB_ACL_TARGET).Sddl}';const response=await run(windowsCommand('powershell.exe'),['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env:{...systemEnvironment(),CFB_ACL_TARGET:state,...(restore?{CFB_ACL_VALUE:restore}:{})},timeout:30000});return response.stdout.trim();}
export async function installWindowsPackage(source,target,state,{register,unregister,verifyRuntime=true}={}){
 if(!register&&process.platform!=='win32')throw new Error('这个安装器只支持Windows。');
 const plan=await windowsInstallPlan(source,target,{verifyRuntime});state=path.resolve(state);await noLinks(state);if(!register)await registryFree();
 const originalAcl=register?null:await acl(state);return folderLock('installer:'+HOST,path.join(state,'installer-locks'),async()=>{
  if(!register)await registryFree();if(!await missing(plan.target))throw new Error('安装位置刚被其他程序使用，未覆盖。');
  await fs.mkdir(path.dirname(plan.target),{recursive:true});await noLinks(path.dirname(plan.target));const stage=path.join(path.dirname(plan.target),'.cfb-install-'+crypto.randomUUID());await fs.mkdir(stage,{mode:0o700});let published=false,registrationStarted=false;
  try{
   for(const f of plan.files){const output=inside(stage,f.name);await fs.mkdir(path.dirname(output),{recursive:true});await copyVerified(inside(plan.source,f.name),output,{expectedSha256:f.sha256});}
   await noLinks(plan.target);if(!await missing(plan.target))throw new Error('安装位置已被占用，未覆盖。');await fs.rename(stage,plan.target);published=true;
   for(const f of plan.files){const file=inside(plan.target,f.name);await noLinks(file);if(hash(await fs.readFile(file))!==f.sha256)throw new Error('安装目录发布后校验失败，未注册连接。');}
   registrationStarted=true;
   await (register||registration)(plan.target,state);return {installed:true,version:plan.version,target:plan.target,extensionFolder:path.join(plan.target,'extension'),globalNodeChanged:false};
  }catch(error){
   if(registrationStarted){try{await (unregister||((root,s)=>registration(root,s,true)))(plan.target,state);if(originalAcl)await acl(state,originalAcl);}catch{throw new Error('安装未完成，连接或权限需要核对；保留安装目录用于恢复：'+plan.target);}}
   // Remove only verified installer-owned files. Preserve any concurrent extra or changed file.
   const directory=published?plan.target:stage;
   for(const f of [...plan.files].reverse()){const file=inside(directory,f.name);try{await noLinks(file);if(hash(await fs.readFile(file))===f.sha256)await fs.unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}
   async function empty(dir){await noLinks(dir);for(const entry of await fs.readdir(dir,{withFileTypes:true}))if(entry.isDirectory()&&!entry.isSymbolicLink())await empty(path.join(dir,entry.name));try{await fs.rmdir(dir);}catch(e){if(e.code!=='ENOTEMPTY'&&e.code!=='EEXIST')throw e;}}
   await empty(directory);throw new Error('安装未完成，已回退本次可核对的文件；原有文件未覆盖。'+error.message);
  }
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2],source=process.argv[3],target=process.argv[4],uiLanguage=process.argv[5];try{if(!['--plan','--install'].includes(mode)||!source||!target)throw new Error('安装参数无效。');if(uiLanguage!==undefined&&!validUiLanguage(uiLanguage))throw new Error('Unsupported interface language.');const result=mode==='--plan'?await windowsInstallPlan(source,target):await installWindowsPackage(source,target,stateRoot);if(mode==='--install'&&uiLanguage){try{Object.assign(result,await writeUiLanguage(stateRoot,uiLanguage),{languageSaved:true});}catch{Object.assign(result,{languageSaved:false,uiLanguage});}}process.stdout.write(JSON.stringify(result));}catch(e){process.stderr.write(e.message);process.exitCode=1;}
}
