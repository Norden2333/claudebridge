import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {definitions} from '../companion/files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const roots=['extension','companion','vendor','tests','tools'];
const files=[];
async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const target=path.join(dir,item.name);if(item.isDirectory())await walk(target);else if(/\.(?:m?js)$/.test(item.name))files.push(target);}}
for(const name of roots)await walk(path.join(root,name));
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr||result.stdout);process.exit(result.status||1);}}
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'extension','manifest.json'),'utf8'));
const protocol=await fs.readFile(path.join(root,'extension','protocol.js'),'utf8');
const launcher=await fs.readFile(path.join(root,'tools','windows-launcher.cs'),'utf8');
if(pkg.version!==manifest.version||!protocol.includes(`SERVER_VERSION = '${pkg.version}'`)||!launcher.includes(`AssemblyVersion("${pkg.version}.0")`))throw new Error('package、manifest、MCP 与 Windows 启动器版本不一致。');
for(const name of ['options','popup','workspace']){const html=await fs.readFile(path.join(root,'extension',name+'.html'),'utf8');if(!html.includes('Claude 文件连接 · '+pkg.version)&&!html.includes('ClaudeBridge · '+pkg.version))throw new Error(name+' 页面显示版本与发行版本不同。');}
for(const name of ['安装-Windows.ps1','卸载-Windows.ps1','更新与切回-Windows.ps1','Windows安装向导.ps1']){
 const bytes=await fs.readFile(path.join(root,name));
 if(bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)throw new Error(`${name} 含 UTF-8 BOM，Windows PowerShell 可能把首行 param 误当成命令。`);
}
const toolText=await fs.readFile(path.join(root,'extension','tools.js'),'utf8');
if(toolText!=='self.CFB_TOOL_DEFINITIONS = '+JSON.stringify(definitions,null,2)+';\n')throw new Error('extension/tools.js 与本机工具定义不同；请运行 tools/sync-tools.mjs。');
const channel=await fs.readFile(path.join(root,'vendor','remote-device','remote-channel.js'),'utf8');
if(channel.includes('blocking-offline-update.js')||/spawn(?:Sync)?\s*\([\s\S]{0,1200}(?:access_token|refresh_token)/.test(channel))throw new Error('离线状态更新不得启动携带登录令牌的子进程。');
console.log(`source check passed: ${files.length} scripts, version ${pkg.version}`);
