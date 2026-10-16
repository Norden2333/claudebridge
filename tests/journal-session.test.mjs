import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {OperationJournal} from '../companion/journal.mjs';import {processIdentity} from '../companion/lease.mjs';
test('abandoned sessions become interrupted, live pending remains pending, and neither is replayed',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-journal-session-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const journal=new OperationJournal(path.join(root,'operations')),folder='fictional-folder';
 const id='abandoned-call',key=journal.key(folder,id);await journal.save(key,{operationId:id,tool:'write_file',status:'pending',session:crypto.randomUUID(),startedAt:'2000-01-01T00:00:00Z'});
 assert.equal((await journal.status(folder,id)).status,'interrupted');let ran=false;await assert.rejects(journal.execute(folder,id,'write_file',{},async()=>{ran=true;}));assert.equal(ran,false);
 let release;const waiting=new Promise(r=>release=r);const work=journal.execute(folder,'live-operation','write_file',{},async()=>{await waiting;return {applied:true};});
 for(let n=0;n<30;n++){if((await journal.status(folder,'live-operation')).status==='pending')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal((await journal.status(folder,'live-operation')).status,'pending');release();await work;assert.equal((await journal.status(folder,'live-operation')).status,'completed');
 await journal.save(journal.key(folder,'legacy-pending'),{operationId:'legacy-pending',tool:'write_file',status:'pending',startedAt:'2000-01-01T00:00:00Z'});assert.equal((await journal.status(folder,'legacy-pending')).status,'interrupted');
 const owner=await processIdentity(),foreignSession=crypto.randomUUID();await fs.mkdir(path.join(journal.root,'.sessions'),{recursive:true});await fs.writeFile(path.join(journal.root,'.sessions',foreignSession+'.json'),JSON.stringify(owner));await journal.save(journal.key(folder,'foreign-live'),{operationId:'foreign-live',status:'pending',session:foreignSession});assert.equal((await journal.status(folder,'foreign-live')).status,'pending');
});
