import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {acquireLease} from '../companion/lease.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-lease-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return path.join(root,'lock');}
const age=async file=>{const old=new Date(Date.now()-180000);await fs.utimes(file,old,old);};
test('missing or corrupt aged owner recovers without running simultaneous actions',async t=>{
 const file=await fixture(t);await fs.mkdir(file);await age(file);let active=0,max=0;
 await Promise.all([1,2].map(async()=>{const lease=await acquireLease(file,{directory:true,waitMs:3000});try{active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,80));active--;}finally{await lease.release();}}));assert.equal(max,1);
 await fs.mkdir(file);await fs.writeFile(path.join(file,'owner.json'),'{broken');await age(path.join(file,'owner.json'));const lease=await acquireLease(file,{directory:true});await lease.release();
});
test('fresh lease cannot be stolen; delayed heartbeat of matching live process cannot be stolen either',async t=>{
 const file=await fixture(t),held=await acquireLease(file,{heartbeatMs:60000});
 try{await assert.rejects(acquireLease(file,{waitMs:60}),{code:'CFB_LEASE_BUSY'});await age(file);await assert.rejects(acquireLease(file,{waitMs:60,staleMs:1}),{code:'CFB_LEASE_BUSY'});await held.assertOwned();}finally{await held.release();}
});
test('reused PID with a different process-start identity recovers; release cannot delete a replacement owner',async t=>{
 const file=await fixture(t);await fs.writeFile(file,JSON.stringify({pid:process.pid,processBirth:'different-start',session:'old',token:'old'}));await age(file);
 const lease=await acquireLease(file,{staleMs:1});await lease.assertOwned();const replacement={pid:process.pid,token:'replacement'};await fs.writeFile(file,JSON.stringify(replacement));await lease.release();assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),replacement);
});
test('heartbeat refreshes lease while held and release cleans the gate too',async t=>{
 const file=await fixture(t),lease=await acquireLease(file,{heartbeatMs:20});await age(file);await new Promise(r=>setTimeout(r,70));assert.ok(Date.now()-(await fs.stat(file)).mtimeMs<1000);await lease.release();await assert.rejects(fs.stat(file),{code:'ENOENT'});await assert.rejects(fs.stat(file+'.gate'),{code:'ENOENT'});
});
