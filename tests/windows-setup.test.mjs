import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {windowsInstallPlan,installWindowsPackage} from '../companion/windows-setup.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-windows-setup-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const source=path.join(base,'source'),target=path.join(base,'installed'),state=path.join(base,'state');await fs.mkdir(path.join(source,'extension'),{recursive:true});
 const files={'package.json':JSON.stringify({name:'claude-folder-bridge',version:'0.4.0'}),'extension/manifest.json':JSON.stringify({version:'0.4.0'}),'note.txt':'original'};
 for(const [name,data]of Object.entries(files))await fs.writeFile(path.join(source,name),data);
 await fs.writeFile(path.join(source,'MANIFEST.sha256'),Object.entries(files).map(([name,data])=>hash(data)+'  '+name+'\n').join(''));
 return {base,source,target,state};
}
test('setup plans are read-only and reject occupied targets, nesting and corrupt packages',async t=>{
 const f=await fixture(t);assert.equal((await windowsInstallPlan(f.source,f.target,{verifyRuntime:false})).changesApplied,false);
 await assert.rejects(fs.access(f.target));await assert.rejects(fs.access(f.state));
 await assert.rejects(windowsInstallPlan(f.source,path.join(f.source,'inside'),{verifyRuntime:false}),/安装目录/);
 await fs.mkdir(f.target);await fs.writeFile(path.join(f.target,'keep.txt'),'keep');await assert.rejects(windowsInstallPlan(f.source,f.target,{verifyRuntime:false}),/已存在/);
 assert.equal(await fs.readFile(path.join(f.target,'keep.txt'),'utf8'),'keep');await fs.writeFile(path.join(f.source,'note.txt'),'corrupt');
 await assert.rejects(windowsInstallPlan(f.source,path.join(f.base,'another'),{verifyRuntime:false}),/校验失败/);
});
test('setup verifies files before injected registration and keeps the source',async t=>{
 const f=await fixture(t);let calls=0;
 const result=await installWindowsPackage(f.source,f.target,f.state,{verifyRuntime:false,register:async root=>{calls++;assert.equal(await fs.readFile(path.join(root,'note.txt'),'utf8'),'original');}});
 assert.equal(result.installed,true);assert.equal(calls,1);assert.equal(await fs.readFile(path.join(f.source,'note.txt'),'utf8'),'original');
});
test('registration failure rolls back owned files without real registry access',async t=>{
 const f=await fixture(t);let undone=false;
 await assert.rejects(installWindowsPackage(f.source,f.target,f.state,{verifyRuntime:false,register:async()=>{throw new Error('simulated failure');},unregister:async()=>{undone=true;}}),/回退/);
 assert.equal(undone,true);await assert.rejects(fs.access(f.target),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(f.source,'note.txt'),'utf8'),'original');
});
test('failed setup preserves concurrent changed and extra files',async t=>{
 const f=await fixture(t);
 await assert.rejects(installWindowsPackage(f.source,f.target,f.state,{verifyRuntime:false,register:async root=>{await fs.writeFile(path.join(root,'note.txt'),'external');await fs.writeFile(path.join(root,'user.txt'),'keep');throw new Error('simulated failure');},unregister:async()=>{}}),/回退/);
 assert.equal(await fs.readFile(path.join(f.target,'note.txt'),'utf8'),'external');assert.equal(await fs.readFile(path.join(f.target,'user.txt'),'utf8'),'keep');
});
test('failed unregister retains files for recovery',async t=>{
 const f=await fixture(t);
 await assert.rejects(installWindowsPackage(f.source,f.target,f.state,{verifyRuntime:false,register:async()=>{throw new Error('register failed');},unregister:async()=>{throw new Error('unregister failed');}}),/保留安装目录/);
 assert.equal(await fs.readFile(path.join(f.target,'note.txt'),'utf8'),'original');
});
