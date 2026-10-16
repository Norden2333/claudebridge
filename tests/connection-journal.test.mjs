import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openConnectionJournal,connectionRecord,relayConnectionState} from '../companion/connection-journal.mjs';
import {buildDiagnostics} from '../companion/diagnostics.mjs';
async function temporary(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-connection-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('journal persists bounded allowlisted transitions across host sessions',async t=>{
 const root=await temporary(t);let now=1000000000;const journal=await openConnectionJournal(root,{now:()=>now});
 for(let i=0;i<180;i++){now++;journal.record({event:'state',status:'reconnecting',phase:'retry_wait',reason:'service_unreachable',attempt:i,retryAt:now+1000,content:'PRIVATE_BODY',path:'PRIVATE_PATH',token:'PRIVATE_TOKEN'});}
 await journal.flush();const raw=await fs.readFile(path.join(root,'connection-history.json'),'utf8');assert.ok(Buffer.byteLength(raw)<128*1024);assert.ok(!raw.includes('PRIVATE_'));
 const restored=await openConnectionJournal(root,{now:()=>now});assert.equal(restored.snapshot().entries.length,120);assert.equal(restored.snapshot().entries.at(-1).attempt,179);
 now+=8*86400000;assert.equal(restored.snapshot().entries.length,0);
});
test('journal rejects arbitrary fields from old records and corrupt or oversized input',async t=>{
 const root=await temporary(t),file=path.join(root,'connection-history.json');const time=Date.now();
 await fs.writeFile(file,JSON.stringify({entries:[{event:'state',time,status:'online',reason:'PRIVATE_REASON',secret:'PRIVATE_TOKEN'},{event:'PRIVATE_EVENT',time}]}));
 let journal=await openConnectionJournal(root);assert.equal(journal.snapshot().entries.length,1);assert.ok(!JSON.stringify(journal.snapshot()).includes('PRIVATE_'));
 await fs.writeFile(file,'x'.repeat(128*1024+1));journal=await openConnectionJournal(root);assert.equal(journal.snapshot().available,false);journal.record({event:'session_start'});await journal.flush();assert.equal(journal.snapshot().available,true);
});
test('failed persistence does not throw or prevent recovery and a later change retries',async t=>{
 const root=await temporary(t);let fail=true;const journal=await openConnectionJournal(root,{write:async()=>{if(fail)throw new Error('disk unavailable');}});
 assert.doesNotThrow(()=>journal.record({event:'retire_start',phase:'retiring'}));await journal.flush();assert.equal(journal.snapshot().available,false);
 fail=false;journal.record({event:'retire_end',elapsedMs:1234});await journal.flush();assert.equal(journal.snapshot().available,true);assert.equal(journal.snapshot().entries.at(-1).elapsedMs,1234);
});
test('coalescing writer keeps one write in flight without losing the final transition',async t=>{
 const root=await temporary(t);let release,writes=0,active=0,max=0,last;const journal=await openConnectionJournal(root,{write:async(_file,value)=>{writes++;active++;max=Math.max(max,active);if(writes===1)await new Promise(r=>release=r);last=value;active--;}});
 journal.record({event:'session_start'});for(let i=0;i<500;i++)journal.record({event:'state',attempt:i});release();await journal.flush();assert.equal(max,1);assert.equal(writes,2);assert.equal(last.entries.at(-1).attempt,499);
});
test('diagnostic export sanitizes history again and drops secrets and invalid events',()=>{
 const time=Date.now(),d=buildDiagnostics({connectionHistory:{available:true,secret:'PRIVATE_TOKEN',entries:[{event:'state',time,status:'online',secret:'PRIVATE_TOKEN'},{event:'PRIVATE_EVENT',time}]}});
 assert.equal(d.connectionHistory.entries.length,1);assert.ok(!JSON.stringify(d).includes('PRIVATE_'));assert.equal(connectionRecord({event:'bad'}),null);
});

test('retirement takes priority over retry countdown without changing recovery scheduling',()=>{
 const recovery={attempt:4,nextAt:17000};const relay={status:'reconnecting',reason:'channel_timeout'};
 let value=relayConnectionState(relay,recovery,true,1000);assert.equal(value.phase,'retiring');assert.equal(value.retryAt,0);
 value=relayConnectionState(relay,recovery,false,1001);assert.equal(value.phase,'retry_wait');assert.equal(value.retryInSeconds,16);
 value=relayConnectionState(relay,recovery,false,17000);assert.equal(value.phase,'connecting');assert.equal(value.retryInSeconds,0);
 assert.deepEqual(recovery,{attempt:4,nextAt:17000});assert.equal(relayConnectionState({status:'online'},recovery,false,1000).phase,'online');assert.equal(relayConnectionState({status:'auth_required'},recovery,false,1000).phase,'attention');
});
