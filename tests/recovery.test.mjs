import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { RelayRecovery } from '../companion/recovery.mjs';

test('retry backs off, caps wait and resets only after a stable minute', () => {
  let time = 0; const recovery = new RelayRecovery({ now: () => time, random: () => 0.5 });
  for (const delay of [1000,2000,5000,10000,30000,60000,120000,120000]) {
    assert.equal(recovery.failed(), time + delay); assert.equal(recovery.canStart(), false);
    time += delay; assert.equal(recovery.canStart(), true);
  }
  recovery.observe('online'); time += 30000; recovery.observe('online'); assert.equal(recovery.attempt, 8);
  recovery.observe('reconnecting'); time += 100; recovery.observe('online'); time += 60000; recovery.observe('online');
  assert.equal(recovery.attempt, 0); assert.equal(recovery.failed(), time + 1000);
});

test('stuck channels restart, human verification and blocked settings never watchdog-loop', () => {
  let time = 0; const r = new RelayRecovery({ now: () => time });
  r.observe('starting'); time = 119999; r.observe('starting'); assert.equal(r.stalled(), false);
  time++; assert.equal(r.stalled(), true); r.observe('auth_required'); time += 3600000;
  assert.equal(r.stalled(), false); r.observe('blocked'); assert.equal(r.canStart(), false);
  r.reset(); assert.equal(r.canStart(), true); r.observe('reconnecting'); time += 120000; assert.equal(r.stalled(), true);
});

test('healthy recovery clears timeout and jitter stays bounded', () => {
  let time = 0; const r = new RelayRecovery({ now: () => time, random: () => 1 });
  r.observe('starting'); time = 100000; r.observe('online'); time += 90000;
  assert.equal(r.stalled(), false); assert.equal(r.failed() - time, 1200);
  for (let i=0;i<12;i++) assert.ok(r.failed() - time <= 120000);
});

test('real host retries an unavailable local proxy and stops without authentication or file replay', { timeout: 25000 }, async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb-recovery-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const state = path.join(temp,'state'), folder = path.join(temp,'folder'); await fs.mkdir(state); await fs.mkdir(folder);
  await fs.writeFile(path.join(folder,'preserve.txt'),'original');
  await fs.writeFile(path.join(state,'settings.json'),JSON.stringify({ folder, allowWrites:true, relayEnabled:true, proxy:'http://127.0.0.1:1' }));
  const identity = JSON.parse(await fs.readFile(new URL('../identity.json',import.meta.url),'utf8'));
  const proc = spawn(process.execPath,[fileURLToPath(new URL('../companion/host.mjs',import.meta.url)),`chrome-extension://${identity.extensionId}/`],{env:{...process.env,CFB_STATE_DIR:state}, windowsHide:true});
  t.after(() => { if(proc.exitCode===null)proc.kill(); });
  let data=Buffer.alloc(0), failures=[], starts=0, readReply;
  const read = new Promise(resolve => { readReply=resolve; });
  const seen = new Promise((resolve,reject) => {
    const timer=setTimeout(()=>reject(new Error('No automatic retry observed')),18000); t.after(()=>clearTimeout(timer));
    proc.stdout.on('data', chunk => {
      data=Buffer.concat([data,chunk]);
      while(data.length>=4){const size=data.readUInt32LE();if(data.length<size+4)break;const m=JSON.parse(data.subarray(4,size+4));data=data.subarray(size+4);
        if(m.id==='read-local-test')readReply(m);
        if(m.event==='status'&&m.relay.status==='starting')starts++;
        // Countdown/status updates can repeat one scheduled retry; observe two distinct deadlines.
        if(m.event==='status'&&m.relay.retryAt&&m.relay.retryAt!==failures.at(-1)){ failures.push(m.relay.retryAt);if(failures.length===2){clearTimeout(timer);resolve();} }
      }
    });
  });
  const clientVersion=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')).version;
  const body=Buffer.from(JSON.stringify({clientVersion,nativeProtocol:1,id:'activate-test',action:'active',value:true})),header=Buffer.alloc(4);header.writeUInt32LE(body.length);proc.stdin.write(Buffer.concat([header,body]));
  await seen; assert.equal(starts,1); assert.ok(failures[1]>failures[0]);
  const readBody=Buffer.from(JSON.stringify({clientVersion,nativeProtocol:1,id:'read-local-test',action:'tool',name:'read_file',args:{path:'preserve.txt'}})),readHeader=Buffer.alloc(4);
  readHeader.writeUInt32LE(readBody.length);proc.stdin.write(Buffer.concat([readHeader,readBody]));
  assert.equal((await read).result.content,'original');
  const exit=once(proc,'exit');proc.stdin.end();assert.equal((await exit)[0],0);
  assert.equal(await fs.readFile(path.join(folder,'preserve.txt'),'utf8'),'original');
  assert.deepEqual(await fs.readdir(folder),['preserve.txt']);
  await assert.rejects(fs.access(path.join(state,'device/device.json')),{code:'ENOENT'});
  await assert.rejects(fs.access(path.join(state,'host.lock')),{code:'ENOENT'});
});

test('established channel has a shorter loss grace without interrupting initial setup or authentication', () => {
  let time=0; const r=new RelayRecovery({now:()=>time,random:()=>0.5});
  r.observe('starting'); time=30000; assert.equal(r.stalled(),false);
  r.observe('online'); r.observe('reconnecting'); time+=14999; assert.equal(r.stalled(),false);
  time++; assert.equal(r.stalled(),true); r.observe('auth_required'); time+=3600000; assert.equal(r.stalled(),false);
  r.reset(); r.observe('starting'); time+=30000; assert.equal(r.stalled(),false);
});

test('missing proxies block after three failures and probe only after five minutes; terminal authorization never auto-starts',()=>{
 let time=0;const r=new RelayRecovery({now:()=>time,random:()=>0.5});for(let i=0;i<3;i++){r.observe('reconnecting','no_proxy_found');const next=r.failed();if(i<2)time=next;}
 assert.equal(r.state,'blocked');assert.equal(r.canStart(),false);time=r.nextAt-1;assert.equal(r.canStart(),false);time++;assert.equal(r.canStart(),true);r.observe('auth_required','auth_timeout');time+=3600000;assert.equal(r.canStart(),false);r.reset();assert.equal(r.canStart(),true);
});
