import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileExecutor,digest} from '../companion/files.mjs';
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-save-status-')),folder=await fs.realpath(root);t.after(()=>fs.rm(root,{recursive:true,force:true}));return {folder,ex:new FileExecutor({folder,allowWrites:false})};}
test('automatic-save receipt query is scoped, body-free and explicitly historical',async t=>{
 const {folder,ex}=await setup(t),sum=digest(Buffer.from('v1'));await fs.writeFile(path.join(folder,'result.txt'),'v1');
 await ex.journal.execute(folder,'save-status-0001','asset_save',{},async()=>({path:'result.txt',bytes:2,sha256:sum,verified:true,sameFileUpdated:false}));
 let r=await ex.execute('get_saved_file_status',{path:'result.txt'});assert.equal(r.lastSuccessfulSave.sha256,sum);assert.equal(r.status,'last_verified_save');assert.equal(r.currentContentRechecked,false);assert.equal(r.allOperationsSettled,false);assert.equal(JSON.stringify(r).includes('content'),false);
 await fs.writeFile(path.join(folder,'result.txt'),'external');r=await ex.execute('get_saved_file_status',{path:'result.txt'});assert.equal(r.lastSuccessfulSave.sha256,sum);assert.equal(r.currentFile.bytes,8);assert.equal(r.currentContentRechecked,false);
 await fs.rm(path.join(folder,'result.txt'));r=await ex.execute('get_saved_file_status',{path:'result.txt'});assert.equal(r.currentFile.exists,false);assert.equal(r.status,'last_verified_save');
 await assert.rejects(ex.execute('get_saved_file_status',{path:'../outside.txt'}),/所选文件夹/);
 const other=new FileExecutor({folder:folder+'-other',allowWrites:false});other.journal=ex.journal;assert.deepEqual(await other.journal.recent(other.config.folder),[]);
});
test('reserved read protocol queries receipts without writes or a control file; unknown is not unsaved',async t=>{
 const {folder,ex}=await setup(t),request={protocol:'claude-folder-operation/v1',operation:'read',tool:'get_saved_file_status',args:{path:'missing.txt'}};
 let r=await ex.execute('write_file',{path:'.claude-file-operation.json',content:JSON.stringify(request)});assert.equal(r.status,'not_found');assert.equal(r.lastSuccessfulSave,undefined);assert.match(r.meaning,/unknown/);assert.deepEqual(await fs.readdir(folder),[]);
 await ex.journal.execute(folder,'conflict-save-0001','asset_conflict',{},async()=>({path:'missing.txt',bytes:2,sha256:'a'.repeat(64),verified:true,sameFileUpdated:true}));
 r=await ex.execute('write_file',{path:'.claude-file-operation.json',content:JSON.stringify(request)});assert.equal(r.lastSuccessfulSave.sameFileUpdated,true);assert.equal(r.lastSuccessfulSave.operationId,'conflict-save-0001');assert.deepEqual(await fs.readdir(folder),[]);
});
