import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {AssetTransfers,decideAssetSave,assetFileName} from '../companion/asset-transfers.mjs';
import {FileExecutor} from '../companion/files.mjs';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-asset-guide-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'folder'),state=path.join(root,'state');await fs.mkdir(folder);const ex=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(state,'operations')});return {folder,state,ex,receiver:new AssetTransfers(state,async()=>ex)};}
async function send(f,body,id,key=hash('same-asset')){const bytes=Buffer.from(body);await f.receiver.begin({scope:'test',assetKey:key,operationId:id,name:'same.txt',expectedBytes:bytes.length});if(bytes.length)await f.receiver.chunk({scope:'test',operationId:id,sequence:0,data:bytes.toString('base64'),sha256:hash(bytes)});return f.receiver.finish({scope:'test',operationId:id});}
test('ordered save decisions cover all eight guide rows without mutating inputs',()=>{
 const cases=[
  [{saved:{sha256:'a'},current:{sha256:'a'},sha:'a'},'noop','unchanged'],
  [{saved:{sha256:'a'},current:{sha256:'local'},sha:'a'},'write'],
  [{saved:{sha256:'a'},sha:'a'},'write'],
  [{saved:{sha256:'a',paused:true},current:{sha256:'a'},sha:'a'},'conflict'],
  [{saved:{sha256:null,dismissedSha256:['a']},sha:'a'},'noop','dismissed'],
  [{saved:{sha256:'b',priorSha256:['a']},current:{sha256:'local'},sha:'a'},'noop','olderVersionIgnored'],
  [{saved:{sha256:'a'},current:{sha256:'local'},sha:'new'},'write'],
  [{saved:{sha256:'a',priorSha256:Array(2000).fill('old')},current:{sha256:'a'},sha:'new'},'write'],
  [{current:{sha256:'a'},sha:'a'},'bind'],
  [{current:{sha256:'local'},sha:'a'},'write'],
  [{sha:'a'},'write']
 ];
 for(const [args,kind,flag] of cases){const before=structuredClone(args),decision=decideAssetSave(args);assert.equal(decision.kind,kind);if(flag)assert.equal(decision[flag],true);assert.deepEqual(args,before);}
});
test('previously saved cloud versions are ignored, and identical existing files bind without replacement',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.folder,'same.txt'),'one');
 const bound=await send(f,'one','bind-identical');assert.equal(bound.bound,true);assert.equal(bound.changed,false);
 await send(f,'two','next-version');await fs.writeFile(path.join(f.folder,'same.txt'),'local edit');
 const old=await send(f,'one','old-version-seen');assert.equal(old.olderVersionIgnored,true);assert.equal(old.conflict,undefined);
 assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'local edit');assert.deepEqual(await fs.readdir(path.join(f.state,'incoming')),[]);
});
test('old pending conflicts do not block ordinary direct updates or create new staged choices',async t=>{
 const f=await fixture(t),incoming=path.join(f.state,'incoming');await fs.mkdir(incoming,{recursive:true});
 for(let i=0;i<64;i++){const id='fake-conflict-'+i;await fs.writeFile(path.join(incoming,id+'.json'),JSON.stringify({id,phase:'conflict'}));await fs.writeFile(path.join(incoming,id+'.bin'),'fictional');}
 await send(f,'first','quota-normal-save');await fs.writeFile(path.join(f.folder,'same.txt'),'local edit');
 const saved=await send(f,'new cloud','quota-direct-save');assert.equal(saved.conflict,undefined);assert.equal(saved.verified,true);assert.equal(saved.backupId,undefined);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'new cloud');assert.equal((await fs.readdir(incoming)).length,128);
});

test('startup recovery cleans abandoned receiving/orphan data, preserves conflicts, and never replays interrupted finalization',async t=>{
 const f=await fixture(t),incoming=path.join(f.state,'incoming');await fs.mkdir(incoming,{recursive:true});
 const folderHash=hash(f.folder);
 for(const [id,phase] of [['stale-receiving','receiving'],['stale-finalizing','finalizing'],['keep-conflict','conflict']]){
  await fs.writeFile(path.join(incoming,id+'.json'),JSON.stringify({id,phase,folderHash,scope:'test',name:'same.txt'}));await fs.writeFile(path.join(incoming,id+'.bin'),'fictional');
 }
 await fs.writeFile(path.join(incoming,'orphan-buffer.bin'),'orphan');
 await f.receiver.recover();
 assert.deepEqual((await fs.readdir(incoming)).sort(),['keep-conflict.bin','keep-conflict.json','stale-finalizing.json']);
 const receipt=await f.ex.journal.status(f.folder,'stale-finalizing');assert.equal(receipt.status,'interrupted');assert.equal(receipt.retryAllowed,false);
 assert.equal(JSON.parse(await fs.readFile(path.join(incoming,'stale-finalizing.json'),'utf8')).phase,'interrupted');
 assert.deepEqual(await fs.readdir(f.folder),[]);
 await assert.rejects(send(f,'must not replay','stale-finalizing'),/已有操作记录/);
 await f.receiver.recover();assert.deepEqual(await fs.readdir(f.folder),[]);
});
test('recovery removes completed finalization only, keeps damaged receipt evidence, and refuses active session cleanup',async t=>{
 const f=await fixture(t),folderHash=hash(f.folder),incoming=path.join(f.state,'incoming');await fs.mkdir(incoming,{recursive:true});
 for(const id of ['already-completed','damaged-receipt']){
  const files=f.receiver.paths(id);await fs.writeFile(files.meta,JSON.stringify({id,phase:'finalizing',folderHash,scope:'test',name:'same.txt'}));await fs.writeFile(files.data,'fictional');
  const dir=path.join(f.state,'operations',f.ex.journal.key(f.folder,id));await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'receipt.json'),id==='already-completed'?JSON.stringify({operationId:id,tool:'asset_save',status:'completed',result:{verified:true}}):'{damaged');
 }
 await f.receiver.recover();await assert.rejects(fs.stat(f.receiver.paths('already-completed').meta),{code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(f.state,'operations',f.ex.journal.key(f.folder,'damaged-receipt'),'receipt.json'),'utf8'),'{damaged');
 await f.receiver.begin({scope:'test',assetKey:hash('active'),operationId:'active-session',name:'same.txt',expectedBytes:0});
 await assert.rejects(f.receiver.recover(),/活动成果/);await f.receiver.abort({scope:'test',operationId:'active-session'});
});

test('precheck rechecks actual local bytes: identical skips, edits/deletion upload, older cards stay ignored',async t=>{
 const f=await fixture(t),key=hash('same-asset'),check=body=>f.receiver.precheck({scope:'test',assetKey:key,name:'same.txt',sha256:hash(body),bytes:Buffer.byteLength(body)});
 assert.equal((await check('one')).upload,true);await send(f,'one','precheck-save-one');await send(f,'two','precheck-save-two');
 const identical=await check('two');assert.equal(identical.upload,false);assert.equal(identical.localVerificationPerformed,true);assert.equal(identical.alreadySaved,true);
 await fs.writeFile(path.join(f.folder,'same.txt'),'locally edited');assert.equal((await check('two')).upload,true);
 await fs.rm(path.join(f.folder,'same.txt'));assert.equal((await check('two')).upload,true);
 const older=await check('one');assert.equal(older.upload,false);assert.equal(older.localVerificationPerformed,false);assert.equal(older.verified,undefined);
 await fs.mkdir(path.dirname(f.receiver.ignoredPath(f.ex,key)),{recursive:true});await fs.writeFile(f.receiver.ignoredPath(f.ex,key),JSON.stringify({hashes:[hash('ignored')]}));assert.equal((await check('ignored')).upload,false);
 assert.equal(f.receiver.sessions.size,0);await assert.rejects(f.receiver.precheck({scope:'test',assetKey:key,name:'same.txt',sha256:hash('one'),bytes:-1}),{code:'CFB_ASSET_LIMIT'});
});

test('Windows artifact names sanitize invalid characters and reserved entries while preserving safe extensions',()=>{
 assert.equal(assetFileName('bad:name?.txt'),'bad：name？.txt');assert.equal(assetFileName('CON.txt'),'_CON.txt');assert.equal(assetFileName('.cfb-private'),'_.cfb-private');assert.equal(assetFileName('...'),'claude-output');assert.equal(assetFileName('danger.exe'),'danger.exe.txt');assert.ok(assetFileName('长'.repeat(300)+'.txt').length<=240);assert.ok(assetFileName('😀'.repeat(300)+'.txt').length<=240);
});
test('optional artifact directory structure is scoped and changes only new mappings',async t=>{
 const f=await fixture(t);f.ex.config.preserveOutputDirs=true;const key=hash('nested-artifact');
 const upload=async(body,id)=>{const bytes=Buffer.from(body);await f.receiver.begin({scope:'test',assetKey:key,operationId:id,name:'bad:name.txt',relativeDir:'reports/season:one',expectedBytes:bytes.length});await f.receiver.chunk({scope:'test',operationId:id,sequence:0,data:bytes.toString('base64'),sha256:hash(bytes)});return f.receiver.finish({scope:'test',operationId:id});};
 const first=await upload('v1','nested-output-first');assert.equal(first.nameAdjusted,true);const filename=path.join(f.folder,'reports','season：one','bad：name.txt');assert.equal(await fs.readFile(filename,'utf8'),'v1');
 f.ex.config.preserveOutputDirs=false;await upload('v2','nested-output-second');assert.equal(await fs.readFile(filename,'utf8'),'v2');assert.deepEqual(await fs.readdir(f.folder),['reports']);
 f.ex.config.preserveOutputDirs=true;await assert.rejects(f.receiver.begin({scope:'test',assetKey:hash('bad-dir'),operationId:'nested-invalid-dir',name:'x.txt',relativeDir:'../escape'}),{code:'CFB_ASSET_NAME'});
});

test('new artifact publication reads received source once and working-stage bytes once, preserving disk verification',async t=>{
 const f=await fixture(t),open=fs.open;let incomingReads=0,stageReads=0,finalReads=0;
 t.mock.method(fs,'open',async(file,flags,...rest)=>{if(typeof flags==='number'){if(String(file).startsWith(path.join(f.state,'incoming')))incomingReads++;else if(path.basename(String(file)).startsWith('.cfb-'))stageReads++;else if(String(file)===path.join(f.folder,'same.txt'))finalReads++;}return open(file,flags,...rest);});
 const result=await send(f,'counted original bytes','asset-counted-io');assert.equal(result.verified,true);assert.equal(incomingReads,1);assert.equal(stageReads,1);assert.ok(finalReads<=1);assert.equal(await fs.readFile(path.join(f.folder,'same.txt'),'utf8'),'counted original bytes');
});
