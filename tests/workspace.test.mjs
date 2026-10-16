import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {FileExecutor,MAX_TEXT_BYTES} from '../companion/files.mjs';
import {fingerprint,copyVerified,textExcerpt} from '../companion/safe-io.mjs';
import {workspaceAction} from '../companion/workspace.mjs';
import {folderLock} from '../companion/folder-lock.mjs';
import {importDownload} from '../companion/download-import.mjs';
import {processingBudget} from '../companion/budget.mjs';
async function setup(t){const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-workspace-')),folder=path.join(parent,'folder');await fs.mkdir(folder);t.after(()=>fs.rm(parent,{recursive:true,force:true}));return {folder,parent,engine:new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(parent,'state','operations')})};}
test('same-name files ask without mutation; keep-both and skip work; binary replace/undo/redo preserve originals and refuse stale destination',async t=>{
 const {engine,folder}=await setup(t);await fs.writeFile(path.join(folder,'source.bin'),Buffer.from([0,1,2,3]));await fs.writeFile(path.join(folder,'target.bin'),Buffer.from([4,5,6]));
 const conflict=await engine.execute('copy_file',{source:'source.bin',destination:'target.bin'}, {operationId:'conflict-copy-001'});assert.equal(conflict.conflict,true);assert.deepEqual([...await fs.readFile(path.join(folder,'target.bin'))],[4,5,6]);
 const copy=await engine.execute('copy_file',{source:'source.bin',destination:'target.bin',on_conflict:'keep_both'});assert.equal(copy.destination,'target (1).bin');
 const skip=await engine.execute('copy_file',{source:'source.bin',destination:'target.bin',on_conflict:'skip'});assert.equal(skip.skipped,true);
 const replace=await workspaceAction(engine,'workspace_conflict',{originalId:'conflict-copy-001',choice:'replace',operationId:'replace-copy-001'});assert.ok(replace.backupId);assert.deepEqual([...await fs.readFile(path.join(folder,'target.bin'))],[0,1,2,3]);
 const diff=await workspaceAction(engine,'workspace_diff',{backupId:replace.backupId});assert.equal(diff.binary,true);assert.equal(diff.canRestore,true);
 const restored=await workspaceAction(engine,'workspace_restore',{backupId:replace.backupId,operationId:'restore-copy-001'});assert.deepEqual([...await fs.readFile(path.join(folder,'target.bin'))],[4,5,6]);
 await workspaceAction(engine,'workspace_restore',{backupId:restored.backupId,operationId:'redo-copy-0001'});assert.deepEqual([...await fs.readFile(path.join(folder,'target.bin'))],[0,1,2,3]);
 const replay=await workspaceAction(engine,'workspace_conflict',{originalId:'conflict-copy-001',choice:'replace',operationId:'double-click-001'});assert.equal(replay.replayed,true);
 await engine.execute('copy_file',{source:'source.bin',destination:'target.bin'},{operationId:'new-conflict-001'});await fs.writeFile(path.join(folder,'target.bin'),'external');await assert.rejects(workspaceAction(engine,'workspace_conflict',{originalId:'new-conflict-001',choice:'replace',operationId:'stale-copy-001'}),/目标|校验值/);assert.equal(await fs.readFile(path.join(folder,'target.bin'),'utf8'),'external');
});
test('local recovery UI exposes bounded difference; journal reconciliation reports partial and pending without repeating writes',async t=>{
 const {engine,folder}=await setup(t);await fs.writeFile(path.join(folder,'note.md'),'before');const base=await engine.execute('read_file',{path:'note.md'});const edited=await engine.execute('write_file',{path:'note.md',content:'after',expected_sha256:base.sha256});
 const preview=await workspaceAction(engine,'workspace_diff',{backupId:edited.backupId});assert.equal(preview.before,'before');assert.equal(preview.after,'after');assert.equal(preview.canRestore,true);
 await engine.execute('batch_operations',{operations:[{tool:'create_directory',args:{path:'exists'}},{tool:'edit_block',args:{file_path:'missing.md',old_string:'x',new_string:'y'}}]},{operationId:'partial-test-001'});
 const key=engine.journal.key(folder,'pending-test-001');await fs.mkdir(path.join(engine.journal.root,key));await engine.journal.save(key,{operationId:'pending-test-001',status:'pending',tool:'write_file',startedAt:new Date().toISOString()});
 const check=await workspaceAction(engine,'workspace_check');assert.equal(check.summary.partial,1);assert.equal(check.summary.unknown,1);assert.equal(await fs.readFile(path.join(folder,'note.md'),'utf8'),'after');assert.ok((await workspaceAction(engine,'workspace_recent')).backups.length);
});
test('cross-process folder lease serializes concurrent Chat/Cowork edits and stale baselines are rejected',async t=>{
 const {engine,folder,parent}=await setup(t);await fs.writeFile(path.join(folder,'a.md'),'baseline');const read=await engine.execute('read_file',{path:'a.md'});
 const url=new URL('../companion/files.mjs',import.meta.url).href,root=engine.journal.root;
 const code=`import {FileExecutor} from ${JSON.stringify(url)}; const e=new FileExecutor({folder:${JSON.stringify(folder)},allowWrites:true},{journalRoot:${JSON.stringify(root)}});try{await e.execute('write_file',{path:'a.md',content:'from-child',expected_sha256:${JSON.stringify(read.sha256)}});process.exitCode=0;}catch{process.exitCode=7;}`;
 let child;
 await folderLock(folder,engine.lockRoot,async()=>{child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:'ignore'});await new Promise(r=>setTimeout(r,200));assert.equal(child.exitCode,null);await engine.run('write_file',{path:'a.md',content:'from-parent',expected_sha256:read.sha256});});
 const [exit]=await once(child,'exit');assert.equal(exit,7);assert.equal(await fs.readFile(path.join(folder,'a.md'),'utf8'),'from-parent');assert.deepEqual(await fs.readdir(path.join(parent,'state','folder-locks')),[]);
});
test('large UTF-8 text preview streams beyond edit limit, preserves multibyte paging and rejects a file above1GiB before reading',async t=>{
 const {engine,folder}=await setup(t),file=path.join(folder,'large.md'),handle=await fs.open(file,'wx');const chunk=Buffer.from('a'.repeat(1024*1024));for(let n=0;n<65;n++)await handle.writeFile(chunk);await handle.writeFile('\n结尾😀\n');await handle.close();
 assert.ok((await fs.stat(file)).size>MAX_TEXT_BYTES);const result=await engine.execute('read_file',{path:'large.md',offset:1,length:1});assert.equal(result.content,'结尾😀');assert.equal(result.totalLines,3);assert.equal(result.sha256,(await fingerprint(file)).sha256);
 const clipped=await textExcerpt(file,{char_offset:1024*1024-2,max_chars:256,length:1});assert.equal(clipped.content.length,256);assert.equal(clipped.nextCharOffset,1024*1024-2+256);
 const oversize=await fs.open(path.join(folder,'too-large.md'),'wx');await oversize.truncate(1024*1024*1024+1);await oversize.close();await assert.rejects(textExcerpt(path.join(folder,'too-large.md')),/1 GiB/);assert.equal((await engine.execute('read_file',{path:'too-large.md'})).readable,false);
});
test('failed streamed copy does not publish a partial target; subfolder downloads preserve originals and reject traversal',async t=>{
 const {engine,folder,parent}=await setup(t);const source=path.join(parent,'report.bin');await fs.writeFile(source,Buffer.alloc(2*1024*1024,7));await assert.rejects(copyVerified(source,path.join(folder,'failed.bin'),{deadline:Date.now()-1}),/用时过长/);await assert.rejects(fs.access(path.join(folder,'failed.bin')),{code:'ENOENT'});assert.equal((await fs.readdir(folder)).length,0);
 await fs.mkdir(path.join(folder,'results'));const saved=await importDownload(engine,source,'subfolder-download-001',{subdirectory:'results'});assert.equal(saved.path,'results/report.bin');assert.ok((await fs.stat(source)).isFile());await assert.rejects(importDownload(engine,source,'traversal-download-01',{subdirectory:'../outside'}),/只允许/);
});
test('metadata/Office structure avoid body transfer; parser failure leaves connection and source usable',async t=>{
 const {engine,folder}=await setup(t);await fs.copyFile(new URL('./fixtures/sample.pptx',import.meta.url),path.join(folder,'sample.pptx'));const metadata=await engine.execute('describe_files',{paths:['sample.pptx']});assert.equal(metadata.items[0].format.kind,'pptx');assert.equal(metadata.items[0].content,undefined);
 const structure=await engine.execute('read_file',{path:'sample.pptx',structure_only:true});assert.equal(structure.structureOnly,true);assert.equal(structure.items,undefined);
 const bad=path.join(folder,'bad.pptx');await fs.writeFile(bad,Buffer.concat([Buffer.from([80,75,3,4]),Buffer.alloc(100,120)]));await assert.rejects(engine.execute('read_file',{path:'bad.pptx'}));assert.equal((await engine.execute('list_directory',{})).total,2);
});
test('dense newlines/repeated text stay bounded and batch collision policy applies once; unresolved conflict never silently continues',async t=>{
 const {engine,folder}=await setup(t);await fs.writeFile(path.join(folder,'dense.md'),'a\n'.repeat(1000000));const result=await engine.execute('read_file',{path:'dense.md',offset:-2});assert.equal(result.totalLines,1000001);assert.equal(result.content,'a\n');
 await assert.rejects(engine.execute('edit_block',{file_path:'dense.md',old_string:'a',new_string:'x'}),/恰好出现一次/);assert.equal((await fs.stat(path.join(folder,'dense.md'))).size,2000000);
 await fs.writeFile(path.join(folder,'source.bin'),'source');await fs.writeFile(path.join(folder,'target.bin'),'target');
 const batch=await engine.execute('batch_operations',{on_conflict:'keep_both',operations:[{tool:'copy_file',args:{source:'source.bin',destination:'target.bin'}},{tool:'copy_file',args:{source:'source.bin',destination:'target.bin'}}]});assert.equal(batch.completed,2);assert.equal(batch.results[0].result.destination,'target (1).bin');assert.equal(batch.results[1].result.destination,'target (2).bin');
 const partial=await engine.execute('batch_operations',{operations:[{tool:'copy_file',args:{source:'source.bin',destination:'target.bin'}},{tool:'write_file',args:{path:'must-not-exist.md',content:'no'}}]},{operationId:'batch-conflict-01'});assert.equal(partial.failedIndex,0);await assert.rejects(fs.access(path.join(folder,'must-not-exist.md')),{code:'ENOENT'});
 await workspaceAction(engine,'workspace_conflict',{originalId:'batch-conflict-01',choice:'keep_both',operationId:'batch-resolved-01'});const receipt=(await workspaceAction(engine,'workspace_check')).items.find(x=>x.operationId==='batch-conflict-01');assert.equal(receipt.status,'partial');assert.ok(receipt.result.resolvedConflict);await assert.rejects(fs.access(path.join(folder,'must-not-exist.md')),{code:'ENOENT'});
});
test('copy verification stages share one processing deadline rather than resetting a large-file budget',async t=>{
 const {folder}=await setup(t),source=path.join(folder,'source.bin'),target=path.join(folder,'destination.bin');await fs.writeFile(source,'preserved');const clock=Date.now;let now=clock();Date.now=()=>now;
 try {await processingBudget(async()=>{await fingerprint(source);now+=600001;await assert.rejects(copyVerified(source,target),/用时过长/);});}finally{Date.now=clock;}
 assert.equal(await fs.readFile(source,'utf8'),'preserved');await assert.rejects(fs.access(target),{code:'ENOENT'});assert.deepEqual(await fs.readdir(folder),['source.bin']);
});
