import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {FileExecutor,digest} from '../companion/files.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-index-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'work');await fs.mkdir(folder);return {folder,ex:new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(root,'operations')})};}
test('path save lookup survives more than50 unrelated receipts; lost/corrupt index rebuilds',async t=>{
 const {folder,ex}=await fixture(t);await fs.writeFile(path.join(folder,'old.txt'),'fictional');const sha=digest(Buffer.from('fictional'));
 await ex.journal.execute(folder,'oldest-save','asset_save',{},async()=>({path:'old.txt',verified:true,sha256:sha,bytes:9}));
 await ex.journal.recent(folder);
 for(let n=0;n<60;n++)await ex.journal.execute(folder,'other-operation-'+n,'write_file',{},async()=>({path:'other-'+n+'.txt',verified:true}));
 const result=await ex.execute('get_saved_file_status',{path:'old.txt'});assert.equal(result.status,'last_verified_save');assert.equal(result.lastSuccessfulSave.operationId,'oldest-save');assert.equal(result.historyWindow,null);
 await fs.unlink(ex.journal.indexFile(folder));assert.equal((await ex.journal.recent(folder)).length,50);
 await fs.writeFile(ex.journal.indexFile(folder),'{bad');assert.equal((await ex.journal.recent(folder)).length,50);
});
test('retention preserves unresolved, referenced, recent and newest records without touching user files',async t=>{
 const {folder,ex}=await fixture(t),old='2000-01-01T00:00:00Z';await fs.writeFile(path.join(folder,'keep.txt'),'user fixture');
 for(let n=0;n<10;n++){const id='old-record-'+n;await ex.journal.save(ex.journal.key(folder,id),{operationId:id,tool:'write_file',status:'completed',startedAt:old,result:{path:'keep.txt'}});}
 for(const [id,status,result] of [['keep-unknown','unknown',{}],['keep-interrupted','interrupted',{}],['keep-conflict','completed',{conflict:true}]])await ex.journal.save(ex.journal.key(folder,id),{operationId:id,status,tool:'asset_save',startedAt:old,result});
 await ex.journal.save(ex.journal.key(folder,'recent-reference'),{operationId:'recent-reference',status:'completed',tool:'asset_conflict',startedAt:new Date().toISOString(),resolvedBy:'old-record-9',result:{}});
 const summary=await ex.journal.maintain(folder,{keep:3});assert.ok(summary.removed>0);
 for(const id of ['keep-unknown','keep-interrupted','keep-conflict','old-record-9','recent-reference'])assert.notEqual((await ex.journal.status(folder,id)).status,'not_found');
 assert.equal(await fs.readFile(path.join(folder,'keep.txt'),'utf8'),'user fixture');
});
