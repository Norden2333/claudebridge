import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {AssetTransfers} from '../companion/asset-transfers.mjs';import {FileExecutor} from '../companion/files.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-assets-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'work'),state=path.join(root,'state');await fs.mkdir(folder);const ex=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(state,'operations'),internalRoots:[state]});const receiver=new AssetTransfers(state,async()=>ex);t.after(()=>receiver.close());return {folder,state,ex,receiver};}
async function send(f,content,id,asset='a'.repeat(64),name='same.txt'){const b=Buffer.from(content);await f.receiver.begin({scope:'scope',operationId:id,assetKey:asset,name,expectedBytes:b.length});if(b.length)await f.receiver.chunk({scope:'scope',operationId:id,sequence:0,data:b.toString('base64'),sha256:hash(b)});return f.receiver.finish({scope:'scope',operationId:id});}
test('streamed artifacts create once, update the same path, locally verify without any recovery copies',async t=>{const f=await fixture(t);const first=await send(f,'first','asset-first');assert.equal(first.verified,true);const next=await send(f,'changed','asset-next');assert.equal(next.sameFileUpdated,true);assert.equal(next.backupId,undefined);assert.equal((await f.ex.history.recent(f.folder)).length,0);assert.deepEqual(await fs.readdir(f.folder),['same.txt']);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'changed');const noOp=await send(f,'changed','asset-noop');assert.equal(noOp.changed,false);});
test('external edits and deleted destinations are directly updated without a backup or version choice',async t=>{
 const f=await fixture(t);f.ex.history.saveBinary=async()=>{throw new Error('automatic backup must not run');};
 await send(f,'first','asset-origin');await fs.writeFile(path.join(f.folder,'same.txt'),'external');
 const next=await send(f,'new','asset-direct');assert.equal(next.conflict,undefined);assert.equal(next.backupId,undefined);assert.equal(next.sameFileUpdated,true);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'new');
 await fs.rm(path.join(f.folder,'same.txt'));const recreated=await send(f,'new','asset-recreated');assert.equal(recreated.created,true);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'new');
 const unrelated=await send(f,'different card','asset-new-key','b'.repeat(64));assert.equal(unrelated.conflict,undefined);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'different card');assert.deepEqual(await fs.readdir(f.folder),['same.txt']);
});

test('bad chunks, path escapes, rights revocation and incomplete transfers preserve original files',async t=>{const f=await fixture(t);f.ex.config.preserveOutputDirs=true;await assert.rejects(f.receiver.begin({scope:'scope',operationId:'asset-escape',assetKey:'a'.repeat(64),name:'safe.txt',relativeDir:'../outside'}));await f.receiver.begin({scope:'scope',operationId:'asset-partial',assetKey:'a'.repeat(64),name:'new.txt',expectedBytes:3});await assert.rejects(f.receiver.chunk({scope:'scope',operationId:'asset-partial',sequence:1,data:'YWJj',sha256:hash('abc')}));await assert.rejects(f.receiver.finish({scope:'scope',operationId:'asset-partial'}),/完整/);f.ex.config.allowWrites=false;await assert.rejects(f.receiver.chunk({scope:'scope',operationId:'asset-partial',sequence:0,data:'YWJj',sha256:hash('abc')}),/权限/);await f.receiver.close();assert.deepEqual(await fs.readdir(f.folder),[]);});
test('binary assets preserve every byte and empty assets are valid',async t=>{const f=await fixture(t);const bytes=crypto.randomBytes(200000);await send(f,bytes,'asset-binary','c'.repeat(64),'image.bin');assert.deepEqual(await fs.readFile(path.join(f.folder,'image.bin')),bytes);await send(f,Buffer.alloc(0),'asset-empty','d'.repeat(64),'empty.txt');assert.equal((await fs.stat(path.join(f.folder,'empty.txt'))).size,0);});

test('a different folder scope cannot append, commit or cancel another transfer',async t=>{
 const f=await fixture(t),operationId='scope-isolation';await f.receiver.begin({scope:'scope',operationId,assetKey:'e'.repeat(64),name:'scope.txt',expectedBytes:3});
 await assert.rejects(f.receiver.chunk({scope:'other',operationId,sequence:0,data:'YWJj',sha256:hash('abc')}));
 await assert.rejects(f.receiver.finish({scope:'other',operationId}));
 assert.equal((await f.receiver.abort({scope:'other',operationId})).aborted,false);
 assert.equal(f.receiver.sessions.has(operationId),true);
 await f.receiver.chunk({scope:'scope',operationId,sequence:0,data:'YWJj',sha256:hash('abc')});await f.receiver.finish({scope:'scope',operationId});
 assert.equal(await fs.readFile(path.join(f.folder,'scope.txt'),'utf8'),'abc');
});
test('failed disk sync closes and removes staging without creating a result file',async t=>{
 const f=await fixture(t),operationId='failed-sync-test';await f.receiver.begin({scope:'scope',operationId,assetKey:'f'.repeat(64),name:'never.txt',expectedBytes:0});
 const s=f.receiver.sessions.get(operationId);s.handle.sync=async()=>{throw new Error('synthetic disk sync failure');};
 await assert.rejects(f.receiver.finish({scope:'scope',operationId}),/synthetic disk sync failure/);
 assert.equal(f.receiver.sessions.has(operationId),false);assert.deepEqual(await fs.readdir(f.folder),[]);assert.deepEqual(await fs.readdir(path.join(f.state,'incoming')),[]);
});


test('local tool update equal to cloud bytes rebinds instead of conflicting or backing up twice',async t=>{
 const f=await fixture(t);await send(f,'v1','local-first-001');
 const written=await f.ex.execute('write_file',{path:'same.txt',content:'v2',expected_sha256:hash('v1')},{operationId:'local-write-002'});
 const before=await fs.stat(path.join(f.folder,'same.txt')),backups=(await f.ex.history.recent(f.folder)).length;
 const result=await send(f,'v2','local-export-002');
 assert.equal(result.conflict,undefined);assert.equal(result.alreadySaved,true);assert.equal(result.bound,true);assert.equal(result.applied,false);assert.equal(result.changed,false);assert.equal(result.backupId,undefined);assert.equal(result.path,'same.txt');
 assert.equal((await fs.stat(path.join(f.folder,'same.txt'))).mtimeMs,before.mtimeMs);assert.equal((await f.ex.history.recent(f.folder)).length,backups);
 const repeat=await send(f,'v2','local-export-003');assert.equal(repeat.alreadySaved,true);assert.equal(repeat.skipped,false);
});

test('verified tool-written nested file is bound by exact bytes without a duplicate root file',async t=>{
 const f=await fixture(t);await f.ex.execute('create_directory',{path:'story'});
 await f.ex.execute('write_file',{path:'story/same.txt',content:'written locally'},{operationId:'nested-write-001'});
 const result=await send(f,'written locally','nested-export-01');
 assert.equal(result.path,'story/same.txt');assert.equal(result.alreadySaved,true);assert.equal(result.changed,false);assert.equal(result.backupId,undefined);assert.equal((await f.ex.history.recent(f.folder)).length,0);
 await assert.rejects(fs.stat(path.join(f.folder,'same.txt')),{code:'ENOENT'});
 await f.ex.execute('write_file',{path:'story/same.txt',content:'local v2',expected_sha256:hash('written locally')},{operationId:'nested-write-002'});
 const next=await send(f,'local v2','nested-export-02');assert.equal(next.alreadySaved,true);assert.equal(next.path,'story/same.txt');
});

test('batch write receipts bind locally while ambiguous names, changed bytes and unrelated read receipts do not',async t=>{
 const f=await fixture(t);await f.ex.execute('batch_operations',{operations:[{tool:'create_directory',args:{path:'batch'}},{tool:'write_file',args:{path:'batch/report.md',content:'batch body'}}]},{operationId:'batch-local-001'});
 const result=await send(f,'batch body','batch-export-001','b'.repeat(64),'report.md');assert.equal(result.path,'batch/report.md');assert.equal(result.alreadySaved,true);
 await f.ex.execute('create_directory',{path:'other'});await f.ex.execute('write_file',{path:'other/report.md',content:'batch body'});
 await fs.writeFile(path.join(f.folder,'report.md'),'unrelated');
 const ambiguous=await send(f,'batch body','batch-ambiguous','c'.repeat(64),'report.md');assert.equal(ambiguous.path,'report.md');assert.equal(ambiguous.conflict,undefined);assert.equal(await fs.readFile(path.join(f.folder,'report.md'),'utf8'),'batch body');
 await fs.writeFile(path.join(f.folder,'batch/report.md'),'external edit');
 const changed=await send(f,'batch body','batch-changed-01');assert.notEqual(changed.path,'batch/report.md');
});

test('same local bytes with a stale asset binding produce no new file, backup, or conflict',async t=>{
 const f=await fixture(t);await send(f,'old','equal-start-001');await fs.writeFile(path.join(f.folder,'same.txt'),'cloud new');
 const count=(await f.ex.history.recent(f.folder)).length;const result=await send(f,'cloud new','equal-final-001');
 assert.equal(result.bound,true);assert.equal(result.changed,false);assert.equal(result.applied,false);assert.equal(result.alreadySaved,true);assert.equal(result.conflict,undefined);assert.equal((await f.ex.history.recent(f.folder)).length,count);
});


test('known nested association keeps updating its original path without backups or choices',async t=>{
 const f=await fixture(t);await f.ex.execute('create_directory',{path:'local'});await f.ex.execute('write_file',{path:'local/same.txt',content:'already here'});
 assert.equal((await send(f,'already here','inferred-bind-001')).alreadySaved,true);
 const next=await send(f,'cloud-only change','inferred-new-001');assert.equal(next.conflict,undefined);assert.equal(next.path,'local/same.txt');assert.equal(next.backupId,undefined);assert.equal(await fs.readFile(path.join(f.folder,'local/same.txt'),'utf8'),'cloud-only change');
});
