import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {FileExecutor,digest,definitions} from '../companion/files.mjs';
import {DesktopCommanderIntegration} from '../vendor/remote-device/desktop-commander-integration.js';
async function fixture(t){const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cfb-receipt-')));t.after(()=>fs.rm(folder,{recursive:true,force:true}));return {folder,engine:new FileExecutor({folder,allowWrites:true})};}
test('compact write receipts cover UTF8 totals, append, no-op and replacements; target checks precede any writing',async t=>{
 const {folder,engine}=await fixture(t),first='中文\nfirst',sum=first+'\nlast';
 const r=await engine.execute('write_file',{path:'a.md',content:first,expected_bytes:Buffer.byteLength(first),expected_output_sha256:digest(Buffer.from(first))});
 assert.equal(r.bytes,Buffer.byteLength(first));assert.equal(r.total_lines,2);assert.ok(Date.parse(r.modified));assert.ok(r.operationId);assert.equal(r.content,undefined);
 const appended=await engine.execute('write_file',{path:'a.md',mode:'append',content:'\nlast',expected_bytes:Buffer.byteLength(sum),expected_output_sha256:digest(Buffer.from(sum)).toUpperCase()});assert.equal(appended.bytes,Buffer.byteLength(sum));assert.equal(appended.total_lines,3);
 const same=await engine.execute('write_file',{path:'a.md',content:sum});assert.equal(same.changed,false);assert.equal(same.bytes,appended.bytes);assert.equal(same.modified,appended.modified);
 await assert.rejects(engine.execute('write_file',{path:'a.md',content:'bad',expected_bytes:100}),/未写入/);assert.equal(await fs.readFile(path.join(folder,'a.md'),'utf8'),sum);
 await assert.rejects(engine.execute('write_file',{path:'absent.md',content:'bad',expected_output_sha256:'0'.repeat(64)}),/未写入/);await assert.rejects(fs.access(path.join(folder,'absent.md')),{code:'ENOENT'});
 const edit=await engine.execute('edit_block',{file_path:'a.md',old_string:'first',new_string:'second'});assert.equal(edit.replacements,1);assert.equal(edit.total_lines,3);assert.equal(edit.content,undefined);assert.equal(edit.before_sha256,appended.sha256);assert.notEqual(edit.sha256,edit.before_sha256);
 const unchanged=await engine.execute('edit_block',{file_path:'a.md',old_string:'second',new_string:'second'});assert.equal(unchanged.replacements,0);assert.equal(unchanged.changed,false);assert.equal(unchanged.before_sha256,edit.sha256);assert.equal(unchanged.sha256,edit.sha256);
 const multi=await engine.execute('edit_blocks',{path:'a.md',edits:[{old_string:'second',new_string:'third'},{old_string:'last',new_string:'last'}]});assert.equal(multi.replacements,1);assert.equal(multi.before_sha256,edit.sha256);
 const empty=await engine.execute('write_file',{path:'empty.txt',content:''});assert.equal(empty.total_lines,0);assert.equal(empty.bytes,0);
 const ending=await engine.execute('write_file',{path:'ending.txt',content:'one\n'});assert.equal(ending.total_lines,2);
});
test('single-file search returns titles and marks bounded result and long-line truncation without inventing total',async t=>{
 const {folder,engine}=await fixture(t);await fs.writeFile(path.join(folder,'headings.md'),Array.from({length:107},(_,i)=>'## Chapter '+i).join('\n'));
 const r=await engine.execute('grep_files',{path:'headings.md',pattern:'## '});assert.equal(r.matches.length,100);assert.equal(r.truncated,true);assert.equal(r.matches[1].text,'## Chapter 1');assert.equal(r.total_matches,undefined);
 await fs.writeFile(path.join(folder,'long.md'),'needle '+ 'x'.repeat(600));const line=await engine.execute('grep_files',{path:'long.md',pattern:'needle'});assert.equal(line.matches[0].text.length,500);assert.equal(line.matches[0].textTruncated,true);
});
test('Cowork adapter has complete edit schema and sends capability hint once rather than on every file response',async t=>{
 const {engine}=await fixture(t),adapter=new DesktopCommanderIntegration();adapter.executor=engine;adapter.ready=true;
 const tools=await adapter.listClientTools();assert.deepEqual(tools.tools,definitions);assert.deepEqual(tools.tools.find(d=>d.name==='edit_block').inputSchema.required,['file_path','old_string','new_string']);
 const write=await adapter.callClientTool('write_file',{path:'a.md',content:'one'});assert.equal(write.content.length,1);assert.equal(JSON.parse(write.content[0].text).verified,true);
 const first=await adapter.callClientTool('read_file',{path:'a.md'}),again=await adapter.callClientTool('get_file_info',{path:'a.md'});assert.equal(first.content.length,2);assert.equal(again.content.length,1);
 const edit=await adapter.callClientTool('edit_block',{file_path:'a.md',old_string:'one',new_string:'two'});const r=JSON.parse(edit.content[0].text);assert.equal(r.replacements,1);assert.ok(r.operationId);assert.equal(r.content,undefined);assert.equal(edit.content.length,1);
});

test('small searches inline complete bounded matches; large searches preserve pagination',async t=>{
 const {folder,engine}=await fixture(t);await fs.writeFile(path.join(folder,'a.md'),'状态：已完成');
 const small=await engine.execute('start_search',{path:'.',pattern:'已完成',searchType:'content'});
 assert.equal(small.resultsInline,true);assert.equal(small.hasMore,false);assert.equal(small.matches[0].text,'状态：已完成');assert.equal(small.resultCount,1);
 assert.deepEqual((await engine.execute('get_more_search_results',{sessionId:small.sessionId})).matches,small.matches);
 const empty=await engine.execute('start_search',{path:'.',pattern:'absent'});assert.equal(empty.resultsInline,true);assert.deepEqual(empty.matches,[]);
 await fs.writeFile(path.join(folder,'many.md'),Array.from({length:21},()=> 'needle').join('\n'));
 const large=await engine.execute('start_search',{path:'.',pattern:'needle',searchType:'content'});assert.equal(large.resultsInline,false);assert.equal(large.matches,undefined);assert.equal(large.nextOffset,0);
 assert.equal((await engine.execute('get_more_search_results',{sessionId:large.sessionId,length:20})).hasMore,true);
 assert.equal((await engine.execute('get_more_search_results',{sessionId:large.sessionId,offset:20})).matches.length,1);
 await fs.writeFile(path.join(folder,'wide.md'),Array.from({length:20},()=> '宽'.repeat(499)+'needle').join('\n'));
 const bounded=await engine.execute('start_search',{path:'wide.md',pattern:'needle',searchType:'content'});assert.equal(bounded.resultsInline,false);assert.equal(bounded.matches,undefined);
});
test('operation help exposes valid IDs, hosted receipt recovery and executable batch example',async t=>{
 const {engine}=await fixture(t),help=(await engine.execute('get_config',{})).fileOperationProtocol;
 assert.deepEqual((await engine.execute('get_config',{})).toolArgumentHelp.edit_block_schema,definitions.find(d=>d.name==='edit_block').inputSchema);
 assert.match(help.operationIds,/8-100/);assert.match(help.operationIds,/call_id/);
 assert.match(help.batchExample.operationId,/^[a-zA-Z0-9_-]{8,100}$/);
 const args={path:help.path,mode:'rewrite',content:JSON.stringify(help.batchExample)};
 const receipt=await engine.execute('write_file',args);assert.equal(receipt.completed,2);
 const status=await engine.execute('write_file',{path:help.path,content:JSON.stringify({...help.operationStatus,operationId:help.batchExample.operationId})});assert.equal(status.status,'completed');
 assert.equal((await engine.execute('write_file',args)).replayed,true);
 assert.match(help.operationIds,/actual operationId/);assert.match(help.operationIds,/not forward operation_id/);
 const edit=await engine.execute('write_file',{path:help.path,mode:'rewrite',content:JSON.stringify(help.hostedEditExample)});
 assert.equal(edit.operationId,help.hostedEditExample.operationId);assert.equal(edit.completed,1);
 const restored=await engine.execute('write_file',{path:help.path,content:JSON.stringify({...help.operationStatus,operationId:edit.operationId})});
 assert.equal(restored.status,'completed');assert.deepEqual(restored.result,edit);
});

test('hosted move receipt can be recovered by call_id without replaying the mutation',async t=>{
 const {folder,engine}=await fixture(t),adapter=new DesktopCommanderIntegration();adapter.executor=engine;adapter.ready=true;
 await engine.execute('write_file',{path:'original.txt',content:'preserved'});
 const callId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
 const move=JSON.parse((await adapter.callClientTool('move_file',{source:'original.txt',destination:'renamed.txt'},{operationId:callId})).content[0].text);
 assert.equal(move.verified,true);assert.equal(move.operationId,callId);
 const query={path:'.claude-file-operation.json',mode:'rewrite',content:JSON.stringify({protocol:'claude-folder-operation/v1',operation:'status',operationId:callId})};
 const status=JSON.parse((await adapter.callClientTool('write_file',query)).content[0].text);
 assert.equal(status.status,'completed');assert.deepEqual(status.result,move);assert.equal(status.result.sha256,digest(Buffer.from('preserved')));
 await assert.rejects(fs.access(path.join(folder,'original.txt')),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(folder,'renamed.txt'),'utf8'),'preserved');
 await assert.rejects(fs.access(path.join(folder,'.claude-file-operation.json')),{code:'ENOENT'});
});

test('Cowork reserved read-only status query has its own recoverable call receipt without replaying file work',async t=>{
 const {engine}=await fixture(t);const original=await engine.execute('write_file',{path:'status.txt',content:'once',operation_id:'status-original-0001'});
 const query={path:'.claude-file-operation.json',content:JSON.stringify({protocol:'claude-folder-operation/v1',operation:'status',operationId:original.operationId})};
 const first=await engine.execute('write_file',query,{channel:'cowork',operationId:'status-query-call-0001'});
 const recovery=await engine.execute('write_file',{path:query.path,content:JSON.stringify({protocol:'claude-folder-operation/v1',operation:'status',operationId:'status-query-call-0001'})},{channel:'cowork',operationId:'status-recovery-call-0001'});
 assert.equal(recovery.status,'completed');assert.equal(recovery.historicalRead,true);assert.deepEqual(recovery.result,first);assert.equal(first.result.sha256,original.sha256);
});
test('Cowork read and directory replies are recoverable as original snapshots without another read or writes',async t=>{
 const {folder,engine}=await fixture(t);engine.config.allowWrites=false;await fs.writeFile(path.join(folder,'read.txt'),'original');const id='cowork-read-0001';await engine.execute('read_file',{path:'read.txt'},{channel:'cowork',operationId:id});await fs.writeFile(path.join(folder,'read.txt'),'later');
 const r=await engine.execute('write_file',{path:'.claude-file-operation.json',content:JSON.stringify({protocol:'claude-folder-operation/v1',operation:'status',operationId:id})},{channel:'cowork'});assert.equal(r.status,'completed');assert.equal(r.historicalRead,true);assert.equal(r.result.content,'original');assert.equal(r.retryAllowed,false);assert.ok(Date.parse(r.capturedAt));
 await engine.execute('list_directory',{path:'.'},{channel:'cowork',operationId:'cowork-list-0001'});const list=await engine.execute('get_operation_status',{operationId:'cowork-list-0001'});assert.equal(list.status,'completed');assert.equal(list.tool,'list_directory');assert.ok(JSON.stringify(list.result).includes('read.txt'));assert.equal(await fs.readFile(path.join(folder,'read.txt'),'utf8'),'later');assert.deepEqual(await fs.readdir(folder),['read.txt']);
});
test('read receipt cache is bounded, isolated and expires honestly; large reads are not persisted',async t=>{
 const {engine,folder}=await fixture(t);for(let i=0;i<70;i++)engine.rememberReadReceipt('get_file_info','bounded-'+i,{size:i},folder);assert.equal(engine.readReceipts.size,64);assert.equal((await engine.operationStatus('bounded-0')).status,'not_found');assert.equal((await engine.operationStatus('bounded-69')).result.size,69);
 engine.readReceipts.get('bounded-69').expiresAt=0;assert.equal((await engine.operationStatus('bounded-69')).status,'not_found');engine.rememberReadReceipt('read_file','too-large-0001',{content:'x'.repeat(8*1024*1024)},folder);assert.equal((await engine.operationStatus('too-large-0001')).status,'not_found');engine.config.folder=folder+'-different';assert.equal((await engine.operationStatus('bounded-68')).status,'not_found');
});

test('expired read snapshots are released without another call, and adapter shutdown clears cached bodies',async t=>{
 const {engine,folder}=await fixture(t);t.after(()=>engine.clearReadReceipts());engine.rememberReadReceipt('read_file','short-lived-read',{content:'fictional-body'},folder);engine.readReceipts.get('short-lived-read').expiresAt=performance.now()+5;engine.scheduleReadReceiptExpiry();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(engine.readReceipts.size,0);
 engine.rememberReadReceipt('read_file','shutdown-read-0001',{content:'fictional-body'},folder);const adapter=new DesktopCommanderIntegration();adapter.executor=engine;adapter.ready=true;await adapter.shutdown();assert.equal(engine.readReceipts.size,0);assert.equal(engine.readReceiptTimer,null);
});
