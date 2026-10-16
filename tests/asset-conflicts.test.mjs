import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {AssetTransfers} from '../companion/asset-transfers.mjs';import {FileExecutor} from '../companion/files.mjs';import {workspaceAction} from '../companion/workspace.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-conflict-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'work'),state=path.join(root,'state');await fs.mkdir(folder);const ex=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(state,'operations'),internalRoots:[state]});const receiver=new AssetTransfers(state,async()=>ex);t.after(()=>receiver.close());return {folder,state,ex,receiver};}
async function send(f,content,id){const b=Buffer.from(content);await f.receiver.begin({scope:'scope',operationId:id,assetKey:'a'.repeat(64),name:'same.txt',expectedBytes:b.length});await f.receiver.chunk({scope:'scope',operationId:id,sequence:0,data:b.toString('base64'),sha256:hash(b)});return f.receiver.finish({scope:'scope',operationId:id});}
// Seed records in the old on-disk schema: new auto-saves no longer create
// local-edit conflicts. Compatibility must still allow an explicit old choice.
async function legacy(f,content,id){
 const b=Buffer.from(content),files=f.receiver.paths(id);await fs.mkdir(path.dirname(files.data),{recursive:true});await fs.writeFile(files.data,b);
 let baseline=null;try{baseline=hash(await fs.readFile(path.join(f.folder,'same.txt')));}catch(e){if(e.code!=='ENOENT')throw e;}
 await fs.writeFile(files.meta,JSON.stringify({id,phase:'conflict',scope:'scope',folderHash:hash(f.folder),path:'same.txt',name:'same.txt',key:'a'.repeat(64),sha256:hash(b),bytes:b.length,baselineSha256:baseline}));
 return f.ex.journal.execute(f.folder,id,'asset_save',{},async()=>({path:'same.txt',conflict:true,staged:true,changed:false,applied:false,choices:['replace','skip','keep_both']}));
}
test('legacy conflicts retain both versions across host restart; explicit replacement creates no backup and resumes same path updates',async t=>{
 const f=await fixture(t);await send(f,'first','original-save');await fs.writeFile(path.join(f.folder,'same.txt'),'local edit');const conflict=await legacy(f,'cloud edit','conflict-save');assert.equal(conflict.staged,true);assert.equal(await fs.readFile(f.receiver.paths('conflict-save').data,'utf8'),'cloud edit');assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'local edit');
 const restarted=new AssetTransfers(f.state,async()=>f.ex);const resolved=await restarted.resolve({scope:'scope',originalId:'conflict-save',choice:'replace',operationId:'resolve-save'});assert.equal(resolved.verified,true);assert.equal(resolved.backupId,undefined);assert.equal((await f.ex.history.recent(f.folder)).length,0);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'cloud edit');assert.deepEqual(await fs.readdir(f.folder),['same.txt']);
 assert.equal((await workspaceAction(f.ex,'workspace_check')).items.find(x=>x.operationId==='conflict-save').status,'completed');
 assert.equal((await restarted.resolve({scope:'scope',originalId:'conflict-save',choice:'replace',operationId:'another-save'})).replayed,true);
 await send(f,'next cloud edit','following-save');assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'next cloud edit');
});
test('another external change after conflict refuses replacement and preserves both candidates',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.folder,'same.txt'),'existing');await legacy(f,'cloud edit','changed-conflict');await fs.writeFile(path.join(f.folder,'same.txt'),'new local edit');
 await assert.rejects(f.receiver.resolve({scope:'scope',originalId:'changed-conflict',choice:'replace',operationId:'changed-resolution'}),/又有变化/);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'new local edit');assert.equal(await fs.readFile(f.receiver.paths('changed-conflict').data,'utf8'),'cloud edit');
 assert.equal((await f.receiver.resolve({scope:'scope',originalId:'changed-conflict',choice:'skip',operationId:'skip-resolution'})).localPreserved,true);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'new local edit');
});
test('foreign scope and damaged staging cannot replace a conflict target',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.folder,'same.txt'),'local');await legacy(f,'cloud','damaged-conflict');
 await assert.rejects(f.receiver.resolve({scope:'other',originalId:'damaged-conflict',choice:'replace',operationId:'foreign-resolution'}),/不匹配/);
 await fs.writeFile(f.receiver.paths('damaged-conflict').data,'damaged');await assert.rejects(f.receiver.resolve({scope:'scope',originalId:'damaged-conflict',choice:'replace',operationId:'damaged-resolution'}),/校验/);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'local');
});
test('reopening an older artifact cannot silently roll back the latest saved version',async t=>{
 const f=await fixture(t);await send(f,'version one','version-one');await send(f,'version two','version-two');
 const old=await send(f,'version one','old-visible-card');assert.equal(old.olderVersionIgnored,true);assert.equal(old.conflict,undefined);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'version two');assert.deepEqual(await fs.readdir(path.join(f.state,'incoming')),[]);
 const latest=await f.ex.history.recent(f.folder);assert.equal(latest.length,0,'auto-save must not create backups');
});
test('same cloud content repairs a locally edited or deleted destination on the next save without backup',async t=>{
 const f=await fixture(t);await send(f,'cloud first','unchanged-first');await fs.writeFile(path.join(f.folder,'same.txt'),'local edit');
 const same=await send(f,'cloud first','unchanged-repeat');assert.equal(same.verified,true);assert.equal(same.conflict,undefined);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'cloud first');
 await fs.unlink(path.join(f.folder,'same.txt'));const deleted=await send(f,'cloud first','unchanged-deleted');assert.equal(deleted.created,true);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'cloud first');assert.equal((await f.ex.history.recent(f.folder)).length,0);
});

test('keep-local choice survives receiver restart and suppresses only the same cloud version',async t=>{
 const f=await fixture(t);await send(f,'cloud first','skip-first');await fs.writeFile(path.join(f.folder,'same.txt'),'local edit');await legacy(f,'cloud next','skip-conflict');
 await f.receiver.resolve({scope:'scope',originalId:'skip-conflict',choice:'skip',operationId:'skip-decided'});f.receiver=new AssetTransfers(f.state,async()=>f.ex);
 const again=await send(f,'cloud next','skip-repeat');assert.equal(again.skipped,true);assert.equal(again.localPreserved,true);assert.deepEqual(await fs.readdir(path.join(f.state,'incoming')),[]);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'local edit');assert.equal((await send(f,'cloud newer','skip-new-version')).verified,true);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'cloud newer');
});
test('ordinary same-name updates never create a pending version-choice item',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.folder,'same.txt'),'local');await send(f,'incoming cloud','dedup-first');const again=await send(f,'incoming cloud','dedup-second');
 assert.equal(again.alreadySaved,true);assert.equal((await fs.readdir(path.join(f.state,'incoming'))).length,0);assert.equal((await workspaceAction(f.ex,'workspace_check')).summary.needsChoice,0);assert.equal((await f.ex.history.recent(f.folder)).length,0);
});

test('keep-both preserves the local file and binds subsequent cloud updates to the separate result',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.folder,'same.txt'),'local');await legacy(f,'cloud first','both-conflict');const saved=await f.receiver.resolve({scope:'scope',originalId:'both-conflict',choice:'keep_both',operationId:'both-resolution'});
 assert.equal(saved.verified,true);assert.notEqual(saved.path,'same.txt');assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'local');assert.equal(await fs.readFile(path.join(f.folder,saved.path),'utf8'),'cloud first');
 const next=await send(f,'cloud next','both-next');assert.equal(next.path,saved.path);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'local');assert.equal(await fs.readFile(path.join(f.folder,saved.path),'utf8'),'cloud next');
});
