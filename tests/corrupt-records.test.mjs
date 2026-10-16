import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
import {FileExecutor} from '../companion/files.mjs';import {workspaceAction} from '../companion/workspace.mjs';
test('one corrupt receipt or backup cannot break remaining records and cannot authorize replay or restore',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-corrupt-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'work');await fs.mkdir(folder);const ex=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(root,'operations')});
 const done=await ex.execute('write_file',{path:'same.txt',content:'first'},{operationId:'good-operation'});await ex.execute('read_file',{path:'same.txt'});await ex.execute('write_file',{path:'same.txt',content:'second'},{operationId:'next-operation'});
 const bad='damaged-operation',dir=path.join(ex.journal.root,ex.journal.key(folder,bad));await fs.mkdir(dir);await fs.writeFile(path.join(dir,'receipt.json'),'');
 const status=await ex.journal.status(folder,bad);assert.equal(status.status,'unknown');assert.equal(status.corrupt,true);assert.equal(status.retryAllowed,false);
 let ran=false;await assert.rejects(ex.journal.execute(folder,bad,'write_file',{},async()=>{ran=true;}));assert.equal(ran,false);
 const id=crypto.randomUUID();await fs.writeFile(path.join(ex.history.root,id+'.json'),'{broken');await fs.writeFile(path.join(ex.history.root,id+'.bin'),'fictional');
 const recent=await workspaceAction(ex,'workspace_recent');assert.equal(recent.receipts.some(r=>r.operationId===done.operationId),true);assert.equal(recent.backups.length,1);assert.equal(recent.corruptCount,2);
 const manager=await workspaceAction(ex,'workspace_backups');assert.equal(manager.records.length,1);assert.equal(manager.corruptCount,1);
 await assert.rejects(ex.history.metadata(folder,id),/损坏/);await assert.rejects(ex.history.load(folder,'same.txt',id),/损坏/);
 assert.equal(await fs.readFile(path.join(dir,'receipt.json'),'utf8'),'');assert.equal(await fs.readFile(path.join(folder,'same.txt'),'utf8'),'second');
});
test('damaged protection remains fail-closed while privileged workbench can explicitly repair it',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-protection-repair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'work');await fs.mkdir(folder);const ex=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(root,'operations')});
 const protectedDir=path.join(root,'protected');await fs.mkdir(protectedDir);const file=path.join(protectedDir,crypto.createHash('sha256').update(folder).digest('hex')+'.json');await fs.writeFile(file,'{broken');
 const shown=await workspaceAction(ex,'workspace_protection');assert.equal(shown.corrupt,true);
 await assert.rejects(ex.execute('write_file',{path:'blocked.txt',content:'must not write'}),{code:'CFB_PROTECTION_INVALID'});assert.deepEqual(await fs.readdir(folder),[]);
 await workspaceAction(ex,'workspace_protection_set',{paths:['reference.txt']});assert.deepEqual((await workspaceAction(ex,'workspace_protection')).paths,['reference.txt']);
 await assert.rejects(ex.execute('write_file',{path:'reference.txt',content:'must not write'}),/仅供参考/);await ex.execute('write_file',{path:'allowed.txt',content:'fictional'});assert.equal(await fs.readFile(path.join(folder,'allowed.txt'),'utf8'),'fictional');
});
