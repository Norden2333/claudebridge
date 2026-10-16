import {windowsCommand,systemEnvironment} from './system-tools.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOST, stateRoot } from './settings.mjs';
import { registrationDirectory, windowsLauncher } from './install-policy.mjs';
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.dirname(here);
const uninstall = process.argv.includes('--uninstall');
const dryRun = process.argv.includes('--dry-run');
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) throw new Error('需要 Node.js 22 或更新版本。');
const manifestPath = path.join(here, 'native-host.json');
const windowsKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\' + HOST;
async function existingWindows() {
  try { const r = await exec(windowsCommand('reg.exe'), ['query', windowsKey, '/ve'], {windowsHide:true,env:systemEnvironment()}); const match = r.stdout.match(/REG_SZ\s+(.+)/); return match?.[1]?.trim(); }
  catch (e) { if (e.code === 1) return null; throw e; }
}
const registrationFile = process.platform === 'win32' ? null : path.join(registrationDirectory(process.platform, os.homedir(), process.env), HOST + '.json');
const updating=process.argv.includes('--update'),rollingBack=process.argv.includes('--rollback');
async function installedRoot(){const registered=process.platform==='win32'?await existingWindows():registrationFile;if(!registered)throw new Error('尚未安装这个通用版，不能更新旧辅助插件。');const m=JSON.parse(await fs.readFile(registered,'utf8'));if(m.name!==HOST||!Array.isArray(m.allowed_origins))throw new Error('本机注册身份不同，未更改。');return path.dirname(path.dirname(m.path));}
if(process.argv.includes('--set-ui-language')){const language=process.argv[process.argv.indexOf('--set-ui-language')+1];const {writeUiLanguage}=await import('./ui-language.mjs');console.log(JSON.stringify(await writeUiLanguage(stateRoot,language)));process.exit(0);}
if(process.argv.includes('--purge-private')){
 if(dryRun){console.log(JSON.stringify({action:'purge-private',changesApplied:false}));process.exit(0);}if(!process.argv.includes('--confirm-purge'))throw new Error('永久清除需要明确 --confirm-purge。');
 const {acquireLease}=await import('./lease.mjs'),{purgePrivate,privateCategories}=await import('./privacy.mjs'),{recentFolders}=await import('./settings.mjs');const lease=await acquireLease(path.join(stateRoot,'host.lock'),{waitMs:0});
 try{const folders=(await recentFolders()).map(p=>p.folder),result=await purgePrivate(stateRoot,privateCategories,{confirm:true,folders});console.log(JSON.stringify(result));if(!result.purged)process.exitCode=1;}finally{await lease.release();}process.exit(process.exitCode||0);
}
if(process.argv.includes('--list-updates')){const {listUpdates}=await import('./update.mjs');console.log(JSON.stringify(await listUpdates(stateRoot)));process.exit(0);}
if(updating||rollingBack){const target=await installedRoot();const {updatePlan,applyUpdate,rollbackUpdate}=await import('./update.mjs');
 if(rollingBack){const at=process.argv.indexOf('--backup');const id=at>=0?process.argv[at+1]:null;if(!id)throw new Error('切回需要明确的 --backup 编号。');if(dryRun)console.log(JSON.stringify({action:'rollback',target,backupId:id,changesApplied:false}));else console.log(JSON.stringify(await rollbackUpdate(target,stateRoot,id)));}
 else if(dryRun)console.log(JSON.stringify({...await updatePlan(root,target,{allowStateMigration:process.argv.includes('--migrate-settings')}),changesApplied:false}));else console.log(JSON.stringify(await applyUpdate(root,target,stateRoot,{allowStateMigration:process.argv.includes('--migrate-settings')})));
 process.exit(0);
}
if (dryRun) {
  console.log(JSON.stringify({ version: JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version, platform: process.platform, nodeVersion: process.versions.node, host: HOST, action: uninstall ? 'uninstall' : 'install', registryScope: process.platform === 'win32' ? 'HKCU only' : null, manifestPath: process.platform === 'win32' ? manifestPath : registrationFile, stateRoot, changesApplied: false }));
} else if (uninstall) {
  if (process.platform === 'win32') {
    const current = await existingWindows();
    if (current === manifestPath) await exec(windowsCommand('reg.exe'), ['delete', windowsKey, '/f'], {windowsHide:true,env:systemEnvironment()});
    else if (current) throw new Error('注册指向其他安装目录，未作更改。');
  } else {
    try { const m = JSON.parse(await fs.readFile(registrationFile, 'utf8')); if (m.path !== path.join(here, 'native-launcher')) throw new Error('注册指向其他安装目录，未作更改。'); await fs.unlink(registrationFile); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  console.log('本次安装的 Chrome 连接注册已移除。设备登录和设置保留；在 Chrome 中停用或移除扩展即可。');
} else {
  await fs.access(path.join(root, 'node_modules', 'undici', 'package.json'));
  await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const identity = JSON.parse(await fs.readFile(path.join(root, 'identity.json'), 'utf8'));
  const launcher = path.join(here, process.platform === 'win32' ? 'native-launcher.cmd' : 'native-launcher');
  if (process.platform === 'win32') {
    const previous = await existingWindows();
    if (previous && previous !== manifestPath) throw new Error('已有其他目录的安装，请先从原安装目录卸载。');
    await fs.writeFile(launcher, windowsLauncher(process.execPath, path.join(here, 'host.mjs')), 'utf8');
    const sid = (await exec(windowsCommand('powershell.exe'), ['-NoProfile', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], {windowsHide:true,env:systemEnvironment()})).stdout.trim();
    if (!/^S-1-5-21-(\d+-){3}\d+$/.test(sid)) throw new Error('无法确定当前用户，未注册连接。');
    await exec(windowsCommand('icacls.exe'), [stateRoot, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], {windowsHide:true,env:systemEnvironment()});
  } else {
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    await fs.writeFile(launcher, '#!/bin/sh\nexec ' + quote(process.execPath) + ' ' + quote(path.join(here, 'host.mjs')) + ' "$@"\n', { mode: 0o700 });
    await fs.chmod(launcher, 0o700); await fs.chmod(stateRoot, 0o700);
    try { const m = JSON.parse(await fs.readFile(registrationFile, 'utf8')); if (m.path !== launcher) throw new Error('已有其他目录的安装，请先卸载。'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const manifest = { name: HOST, description: 'Scoped Claude folder connection', type: 'stdio', path: launcher, allowed_origins: [`chrome-extension://${identity.extensionId}/`] };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  if (process.platform === 'win32') await exec(windowsCommand('reg.exe'), ['add', windowsKey, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {windowsHide:true,env:systemEnvironment()});
  else { await fs.mkdir(path.dirname(registrationFile), { recursive: true }); await fs.writeFile(registrationFile, JSON.stringify(manifest, null, 2), { mode: 0o600 }); }
  console.log('Chrome 本机连接已注册。请加载 extension 文件夹，打开扩展设置并选择工作文件夹。安装目录和 Node.js 路径需要保留。');
}
