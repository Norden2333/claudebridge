import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { windowsLauncher } from '../companion/install-policy.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identity = JSON.parse(await fs.readFile(path.join(root, 'identity.json'), 'utf8'));
const clientVersion=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const origin = `chrome-extension://${identity.extensionId}/`;
function client(process) {
  let buffer = Buffer.alloc(0), latest = null; const pending = new Map(), activity=[];
  process.stdout.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 4) {
      const len = buffer.readUInt32LE(); if (buffer.length < len + 4) return;
      const message = JSON.parse(buffer.subarray(4, len + 4).toString('utf8')); buffer = buffer.subarray(len + 4);
      if (message.event === 'status') latest = message;
      if (message.event === 'activity') activity.push(message.activity);
      if (pending.has(message.id)) { const job = pending.get(message.id); clearTimeout(job.timer); pending.delete(message.id); job.resolve(message); }
    }
  });
  return { activity, status: () => latest, async send(action, values = {}, fragmented = false) {
    const id = crypto.randomUUID(), body = Buffer.from(JSON.stringify({clientVersion,nativeProtocol:1,id,action,...values}));
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    const result = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Host timeout')), 10000); pending.set(id, { resolve, reject, timer }); });
    if (fragmented) { process.stdin.write(header.subarray(0, 2)); process.stdin.write(Buffer.concat([header.subarray(2), body])); } else process.stdin.write(Buffer.concat([header, body]));
    return result;
  } };
}
test('native binary frames, persistent settings, Unicode Windows launcher, scope change, EOF shutdown', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb-host-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const folder = path.join(temp, '文件夹'); await fs.mkdir(folder);
  const second = path.join(temp, 'other'); await fs.mkdir(second);
  const environment = { ...process.env, CFB_STATE_DIR: path.join(temp, 'state') };
  let proc;
  if (process.platform === 'win32') {
    const launcher = path.join(temp, '原生连接.cmd');
    await fs.writeFile(launcher, windowsLauncher(process.execPath, path.join(root, 'companion/host.mjs')));
    proc = spawn('cmd.exe', ['/d', '/s', '/c', `""${launcher}" "${origin}""`], { env: environment, windowsHide: true, windowsVerbatimArguments: true });
  } else proc = spawn(process.execPath, [path.join(root, 'companion/host.mjs'), origin], { env: environment });
  t.after(() => { if (proc.exitCode === null) proc.kill(); });
  const channel = client(proc);
  const initial = await channel.send('status', {}, true); assert.equal(initial.result.local, 'unconfigured');
  const configured = await channel.send('configure', { config: { folder, proxy: 'http://127.0.0.1:1', allowWrites: true, relayEnabled: false } }); assert.equal(configured.result.local, 'ready');
  assert.equal((await channel.send('tool', { name: 'write_file', args: { path: 'check.txt', content: 'native-ok' } })).ok, true);
  assert.equal((await channel.send('tool', { name: 'read_file', args: { path: 'check.txt' } })).result.content, 'native-ok');
  assert.ok(channel.activity.some(e=>e.kind==='write_file'&&e.state==='completed'&&e.paths[0]==='check.txt'));
  assert.ok(!JSON.stringify(channel.activity).includes('native-ok'));assert.ok(!JSON.stringify(channel.activity).includes(folder));
  const illegal = await channel.send('tool', { name: 'read_file', args: { path: '../outside.txt' } }); assert.equal(illegal.ok, false);
  assert.equal((await channel.send('configure', { config: { folder: second, proxy: 'http://127.0.0.1:1', allowWrites: false, relayEnabled: false } })).ok, true);
  assert.deepEqual((await channel.send('tool', { name: 'list_directory', args: {} })).result.entries, []);
  const recent=await channel.send('recent_folders');assert.equal(recent.result.length,2);
  const pinned=await channel.send('tool',{scope:configured.result.scope,name:'read_file',args:{path:'check.txt'}});assert.equal(pinned.result.content,'native-ok');
  assert.equal((await channel.send('tool',{scope:'unselected-folder',name:'list_directory',args:{}})).ok,false);
  const {folderLock}=await import('../companion/folder-lock.mjs');let waiting;await folderLock(second,path.join(environment.CFB_STATE_DIR,'folder-locks'),async()=>{waiting=channel.send('tool',{name:'read_file',args:{path:'missing.txt'}});await new Promise(r=>setTimeout(r,200));const snapshot=await channel.send('status');assert.equal(snapshot.ok,true);assert.equal(snapshot.result.config.folder,await fs.realpath(second));});assert.equal((await waiting).ok,false);
  assert.equal((await channel.send('active', { value: true })).result.relay.status, 'idle');
  const diagnostic=await channel.send('diagnostics');assert.equal(diagnostic.ok,true);assert.ok(diagnostic.result.connectionHistory.entries.some(e=>e.event==='session_start'));assert.ok(!JSON.stringify(diagnostic.result).includes(folder));assert.equal((await channel.send('status')).result.relay.phase,'idle');
  const ended = once(proc, 'exit'); proc.stdin.end(); const [code] = await ended; assert.equal(code, 0);
  const connectionLog=JSON.parse(await fs.readFile(path.join(environment.CFB_STATE_DIR,'connection-history.json'),'utf8'));assert.ok(connectionLog.entries.some(e=>e.event==='session_start'));assert.ok(!JSON.stringify(connectionLog).includes('native-ok'));assert.ok(!JSON.stringify(connectionLog).includes(folder));
  const saved = JSON.parse(await fs.readFile(path.join(environment.CFB_STATE_DIR, 'settings.json'), 'utf8')); assert.equal(saved.folder, await fs.realpath(second));
  await assert.rejects(fs.access(path.join(environment.CFB_STATE_DIR, 'host.lock')), { code: 'ENOENT' });
});
test('missing saved folder keeps native settings available, blocks file access and allows reselect or revoke',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-host-missing-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
 const folder=path.join(temp,'old'),moved=path.join(temp,'moved'),replacement=path.join(temp,'new');await fs.mkdir(folder);await fs.mkdir(replacement);
 const env={...process.env,CFB_STATE_DIR:path.join(temp,'state')};let proc;
 const launch=()=>{proc=spawn(process.execPath,[path.join(root,'companion/host.mjs'),origin],{env,windowsHide:true});proc.stderr.resume();return client(proc)};
 const stop=async()=>{const ended=once(proc,'exit');proc.stdin.end();assert.equal((await ended)[0],0)};
 t.after(()=>{if(proc?.exitCode===null)proc.kill()});let channel=launch();assert.equal((await channel.send('configure',{config:{folder,networkMode:'auto',proxy:'',allowWrites:true,relayEnabled:false}})).ok,true);await stop();await fs.rename(folder,moved);
 channel=launch();const unavailable=await channel.send('status');assert.equal(unavailable.ok,true);assert.equal(unavailable.result.local,'unavailable');assert.equal(unavailable.result.config.allowWrites,true);assert.match(unavailable.result.folderMessage,/文件夹/);
 const profiles=await channel.send('recent_folders');assert.equal(profiles.ok,true);assert.equal(profiles.result.length,1);
 const blocked=await channel.send('tool',{name:'write_file',args:{path:'blocked.txt',content:'no'}});assert.equal(blocked.ok,false);assert.equal(blocked.errorCode,'CFB_FOLDER_UNAVAILABLE');assert.deepEqual(await fs.readdir(moved),[]);
 assert.equal((await channel.send('configure',{config:{folder,networkMode:'auto',proxy:'',allowWrites:true,relayEnabled:false}})).ok,true);
 await fs.rename(moved,folder);await new Promise(resolve=>setTimeout(resolve,2250));assert.equal((await channel.send('status')).result.local,'ready');
 await fs.rename(folder,moved);
 const configured=await channel.send('configure',{config:{folder:replacement,networkMode:'auto',proxy:'',allowWrites:true,relayEnabled:false}});assert.equal(configured.ok,true);assert.equal(configured.result.local,'ready');assert.equal((await channel.send('tool',{name:'write_file',args:{path:'ok.txt',content:'yes'}})).ok,true);assert.equal(await fs.readFile(path.join(replacement,'ok.txt'),'utf8'),'yes');await stop();
 await fs.rename(replacement,path.join(temp,'new-moved'));channel=launch();const old=await channel.send('status');assert.equal(old.result.local,'unavailable');const revoked=await channel.send('revoke_folder',{scope:old.result.scope,confirm:true});assert.equal(revoked.ok,true);assert.equal(revoked.result.local,'unconfigured');await stop();
});
test('untrusted extension is rejected before state or filesystem access', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb-reject-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const state = path.join(temp, 'must-not-exist');
  const proc = spawn(process.execPath, [path.join(root, 'companion/host.mjs'), 'chrome-extension://untrusted/'], { env: { ...process.env, CFB_STATE_DIR: state }, windowsHide: true });
  const [code] = await once(proc, 'exit'); assert.equal(code, 3); await assert.rejects(fs.access(state), { code: 'ENOENT' });
});

test('waiting artifact commit does not block native status or another artifact reception',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-parallel-assets-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const folder=path.join(temp,'work'),state=path.join(temp,'state');await fs.mkdir(folder);
 const proc=spawn(process.execPath,[path.join(root,'companion/host.mjs'),origin],{env:{...process.env,CFB_STATE_DIR:state},windowsHide:true});proc.stderr.resume();t.after(()=>{if(proc.exitCode===null)proc.kill();});const channel=client(proc);
 const configured=await channel.send('configure',{config:{folder,networkMode:'auto',proxy:'',allowWrites:true,relayEnabled:false}});assert.equal(configured.ok,true);const scope=configured.result.scope;
 assert.equal((await channel.send('asset_begin',{operationId:'parallel-first',scope,assetKey:'a'.repeat(64),name:'first.txt',expectedBytes:0})).ok,true);
 const {folderLock}=await import('../companion/folder-lock.mjs');let commit;
 await folderLock(folder,path.join(state,'folder-locks'),async()=>{
  commit=channel.send('asset_finish',{operationId:'parallel-first',scope});await new Promise(r=>setTimeout(r,100));
  const status=await channel.send('status');assert.equal(status.ok,true);
  assert.equal((await channel.send('asset_begin',{operationId:'parallel-second',scope,assetKey:'b'.repeat(64),name:'second.txt',expectedBytes:0})).ok,true);
 });
 assert.equal((await commit).ok,true);assert.equal((await channel.send('asset_finish',{operationId:'parallel-second',scope})).ok,true);assert.equal((await fs.stat(path.join(folder,'first.txt'))).size,0);assert.equal((await fs.stat(path.join(folder,'second.txt'))).size,0);
 const ended=once(proc,'exit');proc.stdin.end();assert.equal((await ended)[0],0);
});
test('unavailable proxy requests recovery without device authentication or direct fallback', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb-proxy-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const folder = path.join(temp, 'folder'); const state = path.join(temp, 'state'); await fs.mkdir(folder); await fs.mkdir(state);
  await fs.writeFile(path.join(state, 'settings.json'), JSON.stringify({ folder, proxy: 'http://127.0.0.1:1', allowWrites: true, relayEnabled: true }));
  const proc = spawn(process.execPath, [path.join(root, 'companion/relay.mjs')], { env: { ...process.env, CFB_STATE_DIR: state }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(() => { if (proc.exitCode === null) proc.kill(); });
  let status; proc.on('message', m => { status = m.status; });
  const [code] = await once(proc, 'exit'); assert.equal(code, 0); assert.equal(status, 'reconnecting');
  await assert.rejects(fs.access(path.join(state, 'device/device.json')), { code: 'ENOENT' });
});

test('native broad-folder scope cannot read its own state or select the protected program root',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-native-private-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const state=path.join(temp,'state');await fs.mkdir(state);await fs.writeFile(path.join(state,'credential.txt'),'PRIVATE_FAKE_TOKEN');
 const proc=spawn(process.execPath,[path.join(root,'companion/host.mjs'),origin],{env:{...process.env,CFB_STATE_DIR:state},windowsHide:true});t.after(()=>{if(proc.exitCode===null)proc.kill();});const channel=client(proc);
 assert.equal((await channel.send('configure',{config:{folder:temp,allowWrites:true,relayEnabled:false,proxy:''}})).ok,true);
 const denied=await channel.send('tool',{name:'read_file',args:{path:'state/credential.txt'}});assert.equal(denied.ok,false);assert.equal(denied.errorCode,'CFB_INTERNAL_PATH');assert.ok(!JSON.stringify(denied).includes('PRIVATE_FAKE_TOKEN'));
 const listed=await channel.send('tool',{name:'list_directory',args:{path:'.'}});assert.ok(!listed.result.entries.some(x=>x.name==='state'));
 assert.equal((await channel.send('configure',{config:{folder:root,allowWrites:true,relayEnabled:false,proxy:''}})).errorCode,'CFB_INTERNAL_PATH');assert.equal((await channel.send('status')).result.config.folder,await fs.realpath(temp));
 const ended=once(proc,'exit');proc.stdin.end();assert.equal((await ended)[0],0);assert.equal(await fs.readFile(path.join(state,'credential.txt'),'utf8'),'PRIVATE_FAKE_TOKEN');
});

test('configure drains preceding mutation while status responds and following mutation uses new scope',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-config-barrier-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const old=path.join(temp,'old'),next=path.join(temp,'next'),state=path.join(temp,'state');await fs.mkdir(old);await fs.mkdir(next);
 const proc=spawn(process.execPath,[path.join(root,'companion/host.mjs'),origin],{env:{...process.env,CFB_STATE_DIR:state},windowsHide:true});proc.stderr.resume();t.after(()=>{if(proc.exitCode===null)proc.kill();});const c=client(proc),settings=folder=>({folder,networkMode:'auto',proxy:'',allowWrites:true,relayEnabled:false});await c.send('configure',{config:settings(old)});
 const {folderLock}=await import('../companion/folder-lock.mjs');let writing,changing,following;
 await folderLock(old,path.join(state,'folder-locks'),async()=>{
  writing=c.send('tool',{name:'write_file',args:{path:'old.txt',content:'old'}});await new Promise(r=>setTimeout(r,100));
  changing=c.send('configure',{config:settings(next)});await new Promise(r=>setTimeout(r,100));
  following=c.send('tool',{name:'write_file',args:{path:'new.txt',content:'new'}});
  const status=await c.send('status');assert.equal(status.ok,true);assert.equal(status.result.config.folder,await fs.realpath(old));
 });
 assert.equal((await writing).ok,true);assert.equal((await changing).ok,true);assert.equal((await following).ok,true);
 assert.equal(await fs.readFile(path.join(old,'old.txt'),'utf8'),'old');assert.equal(await fs.readFile(path.join(next,'new.txt'),'utf8'),'new');await assert.rejects(fs.stat(path.join(old,'new.txt')),{code:'ENOENT'});
 const ended=once(proc,'exit');proc.stdin.end();assert.equal((await ended)[0],0);
});

test('new native host reports waiting and starts after the live prior lease releases',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-host-wait-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const state=path.join(temp,'state');await fs.mkdir(state);
 const {acquireLease}=await import('../companion/lease.mjs');const held=await acquireLease(path.join(state,'host.lock'),{heartbeatMs:100});t.after(()=>held.release());
 const proc=spawn(process.execPath,[path.join(root,'companion/host.mjs'),origin],{env:{...process.env,CFB_STATE_DIR:state},windowsHide:true});proc.stderr.resume();t.after(()=>{if(proc.exitCode===null)proc.kill();});const channel=client(proc);
 const deadline=Date.now()+5000;while(channel.status()?.local!=='previous_closing'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.equal(channel.status()?.local,'previous_closing');assert.equal(proc.exitCode,null);
 await held.release();assert.equal((await channel.send('status')).result.local,'unconfigured');const ended=once(proc,'exit');proc.stdin.end();assert.equal((await ended)[0],0);
});

test('native private purge leaves working file untouched and pauses old-id replay after clearing receipts',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-native-purge-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const state=path.join(temp,'state'),folder=path.join(temp,'work');await fs.mkdir(folder);const proc=spawn(process.execPath,[path.join(root,'companion/host.mjs'),origin],{env:{...process.env,CFB_STATE_DIR:state},windowsHide:true});proc.stderr.resume();t.after(()=>{if(proc.exitCode===null)proc.kill();});const c=client(proc);await c.send('configure',{config:{folder,allowWrites:true,relayEnabled:false,networkMode:'auto',proxy:''}});assert.equal((await c.send('tool',{name:'write_file',args:{path:'fixture.txt',content:'kept working file'}})).ok,true);
 const purge=await c.send('privacy_purge',{categories:['operations'],confirm:true});assert.equal(purge.ok,true);assert.equal(purge.result.purged,true);assert.equal((await c.send('status')).result.paused,true);assert.equal(await fs.readFile(path.join(folder,'fixture.txt'),'utf8'),'kept working file');assert.equal((await c.send('tool',{name:'write_file',args:{path:'new.txt',content:'not executed'}})).ok,false);await assert.rejects(fs.stat(path.join(folder,'new.txt')),{code:'ENOENT'});
 const ended=once(proc,'exit');proc.stdin.end();assert.equal((await ended)[0],0);
});
