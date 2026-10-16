import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { FileExecutor } from '../companion/files.mjs';
import { activitySummary, scopeId } from '../companion/activity.mjs';
import { DesktopCommanderIntegration } from '../vendor/remote-device/desktop-commander-integration.js';
const source=await fs.readFile(new URL('../extension/monitor.js',import.meta.url),'utf8');
const ready={local:'ready',scope:'scope-a',config:{folder:'/private/person/work',allowWrites:true,relayEnabled:true},relay:{status:'online'}};
function monitor(saved, delayed){let writes=[],updates=[];const ctx=vm.createContext({self:{},chrome:{storage:{session:{get:()=>delayed||Promise.resolve({cfbMonitor:saved}),set:async v=>writes.push(v)}}},Date,Number,JSON,Array});vm.runInContext(source,ctx);ctx.self.CFB_MONITOR.subscribe(s=>updates.push(s));return {api:ctx.self.CFB_MONITOR,writes,updates};}
test('skipped local-preserving asset result remains a boolean outcome without carrying content',()=>{
 const m=monitor();m.api.observe(ready);m.api.record({id:'skip-outcome',scope:'scope-a',state:'completed',kind:'import_download',skipped:true,content:'PRIVATE_BODY'});const entry=m.api.snapshot().entries[0];assert.equal(entry.skipped,true);assert.equal(entry.content,undefined);
});

test('actual local requests emit truthful bounded metadata; content never enters feed and callback failure cannot break files', async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-feed-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const folder=path.join(temp,'folder');await fs.mkdir(folder);const events=[];
  const executor=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(temp,'ops'),onActivity:e=>events.push(e)});
  const args={path:'note.md',content:'PRIVATE_BODY_MARKER'};
  await executor.execute('write_file',args,{operationId:'write-once-feed'});await executor.execute('write_file',args,{operationId:'write-once-feed'});
  assert.deepEqual(events.map(e=>e.state),['queued','running','completed','queued','running','replayed']);
  assert.equal(events[2].verified,true);assert.deepEqual(events[2].paths,['note.md']);assert.equal(events[0].scope,scopeId(folder));
  await executor.execute('read_file',{path:'note.md'});await assert.rejects(executor.execute('read_file',{path:'../secret.txt'}));
  assert.equal(events.at(-1).state,'failed');assert.deepEqual(events.at(-1).paths,['未授权路径']);
  const encoded=JSON.stringify(events);assert.ok(!encoded.includes('PRIVATE_BODY_MARKER'));assert.ok(!encoded.includes(folder));assert.ok(!encoded.includes(temp));
  executor.onActivity=()=>{throw new Error('Broken UI');};await executor.execute('write_file',{path:'second.md',content:'still works'});
  assert.equal(await fs.readFile(path.join(folder,'second.md'),'utf8'),'still works');
  const deletion=activitySummary(folder,'write_file',{path:'.claude-file-operation.json',content:JSON.stringify({protocol:'claude-folder-operation/v1',operation:'delete_file',path:'note.md',confirmDelete:true})});
  assert.equal(deletion.kind,'delete_file');assert.deepEqual(deletion.paths,['note.md']);
  assert.deepEqual(activitySummary(folder,'read_file',{path:'https://example.test/?secret=DO_NOT_RECORD'}).paths,['不支持网址']);
});

test('Cowork executor reports actual IPC events without adding metadata to model results', async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-cowork-feed-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const folder=path.join(temp,'folder');await fs.mkdir(folder);const messages=[],old=process.send;process.send=m=>messages.push(m);t.after(()=>{process.send=old;});
  const integration=new DesktopCommanderIntegration();integration.ready=true;
  integration.executor=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(temp,'ops'),onActivity:e=>process.send({event:'activity',activity:e})});
  const result=await integration.callClientTool('write_file',{path:'cowork.txt',content:'COWORK_PRIVATE'},{operationId:'cowork-feed-check'});
  assert.ok(messages.every(m=>m.activity.channel==='cowork'));assert.equal(messages.at(-1).activity.state,'completed');
  assert.ok(!JSON.stringify(messages).includes('COWORK_PRIVATE'));assert.ok(!JSON.stringify(result).includes('activity'));await integration.shutdown();
});

test('disconnect alerts once per outage, restore distinctly, intentional disable and initial setup do not alarm',()=>{
  const m=monitor();m.api.observe({local:'unconfigured',config:{folder:''},relay:{status:'idle'}});assert.equal(m.api.snapshot().alert,null);
  m.api.observe(ready);m.api.observe({...ready,relay:{status:'reconnecting'}});const alert=m.api.snapshot().alert;assert.equal(alert.active,true);
  const updates=m.updates.length;for(let i=0;i<10;i++)m.api.observe({...ready,relay:{status:'reconnecting'}});
  assert.equal(m.api.snapshot().alert.id,alert.id);assert.equal(m.updates.length,updates);
  m.api.observe({...ready,relay:{status:'auth_required'}});assert.match(m.api.snapshot().alert.message,/验证设备/);
  m.api.observe(ready);assert.equal(m.api.snapshot().alert.active,false);
  m.api.observe({...ready,local:'missing'});assert.ok(m.api.snapshot().alert.id> alert.id);assert.equal(m.api.snapshot().alert.kind,'local');
  m.api.observe(ready);m.api.observe({...ready,config:{...ready.config,relayEnabled:false},relay:{status:'idle'}});assert.equal(m.api.snapshot().alert.active,false);
});

test('feed retains 30 operations, isolates scope, marks interrupted work unknown and clears display only',()=>{
  const m=monitor();m.api.observe(ready);
  for(let i=0;i<40;i++)m.api.record({id:'operation-'+i,scope:'scope-a',kind:'write_file',paths:['file.md'],state:'running',channel:'cowork',time:i});
  assert.equal(m.api.snapshot().entries.length,30);m.api.unknown('cowork');assert.ok(m.api.snapshot().entries.every(e=>e.state==='unknown'));
  m.api.record({id:'evil',scope:'scope-b',state:'completed',paths:['../secret']});assert.equal(m.api.snapshot().entries.length,30);
  m.api.record({id:'safe',scope:'scope-a',kind:'read_file',state:'completed',time:100,paths:['/absolute/private','C:\\Users\\Private','relative.md'],content:'NEVER_STORE'});
  assert.deepEqual(Array.from(m.api.snapshot().entries[0].paths),['relative.md']);assert.ok(!JSON.stringify(m.api.snapshot()).includes('NEVER_STORE'));
  m.api.clear();assert.equal(m.api.snapshot().entries.length,0);assert.equal(m.api.snapshot().state.local,'ready');
  m.api.record({id:'previous',scope:'scope-a',state:'completed'});m.api.observe({...ready,scope:'scope-b'});assert.equal(m.api.snapshot().entries.length,1);assert.deepEqual(Array.from(m.api.snapshot().entries[0].paths),[]);assert.equal(m.api.snapshotFor('scope-a').entries[0].id,'previous');
  assert.ok(!JSON.stringify(m.api.snapshot()).includes('/private/person'));
});

test('late session restore merges matching scope without overwriting newer events; other folders are excluded',async()=>{
  let release;const delayed=new Promise(r=>release=r);const m=monitor(null,delayed);m.api.observe(ready);
  m.api.record({id:'current',scope:'scope-a',kind:'read_file',paths:['current'],state:'completed',time:100});
  release({cfbMonitor:{scope:'scope-a',sequence:2,entries:[{id:'older',kind:'write_file',paths:['old'],state:'running',time:50},{id:'current',kind:'read_file',paths:['wrong'],state:'running',time:10}]}});
  await new Promise(r=>setTimeout(r,0));assert.equal(m.api.snapshot().entries.length,2);assert.equal(m.api.snapshot().entries[0].state,'completed');assert.equal(m.api.snapshot().entries[1].state,'unknown');
  const n=monitor({scope:'scope-b',entries:[{id:'not-this-folder',state:'completed'}]});n.api.observe(ready);await new Promise(r=>setTimeout(r,0));assert.equal(n.api.snapshot().entries.length,0);
});
test('credential-state failure is distinguished from VPN failure and does not masquerade as automatic network recovery',()=>{
 const {api}=monitor();api.observe(ready);api.observe({...ready,relay:{status:'blocked',reason:'identity_unavailable'}});
 const view=api.snapshot();assert.equal(view.state.local,'ready');assert.equal(view.state.relayReason,'identity_unavailable');assert.match(view.alert.message,/登录记录/);assert.doesNotMatch(view.alert.message,/网络/);
 api.observe(ready);assert.equal(api.snapshot().alert.active,false);
});

test('result-delivery queue is metadata only and does not turn an online device into an offline or saved-to-model claim',()=>{
 const m=monitor();m.api.observe({...ready,relay:{status:'online',resultDelivery:{pending:2,unconfirmed:true,callId:'private-call',body:'private-content'}}});let s=m.api.snapshot();assert.equal(s.state.relay,'online');assert.equal(s.state.pendingResults,2);assert.equal(s.state.resultDeliveryUnconfirmed,true);assert.ok(!JSON.stringify(s).includes('private-call'));assert.ok(!JSON.stringify(s).includes('private-content'));m.api.observe(ready);s=m.api.snapshot();assert.equal(s.state.pendingResults,0);assert.equal(s.state.resultDeliveryUnconfirmed,false);
});


test('journal reconciliation clears only matched resolved attention and preserves unrelated pending items and scopes',()=>{
 const {api}=monitor();api.observe(ready);
 api.record({id:'resolved-one',operationId:'resolved-one',scope:'scope-a',state:'conflict',paths:['note.md'],kind:'import_download'});
 api.record({id:'still-pending',operationId:'still-pending',scope:'scope-a',state:'unknown',paths:['pending.md'],kind:'write_file'});
 api.record({id:'other-scope',operationId:'other-scope',scope:'scope-b',state:'conflict',paths:['other.md'],kind:'import_download'});
 api.reconcile('scope-a',[{operationId:'resolved-one',status:'completed',result:{path:'note.md',verified:true,alreadySaved:true}}]);
 const rows=api.snapshot().entries;assert.equal(rows.find(x=>x.id==='resolved-one').state,'completed');assert.equal(rows.find(x=>x.id==='resolved-one').alreadySaved,true);assert.equal(rows.find(x=>x.id==='still-pending').state,'unknown');assert.equal(api.snapshotFor('scope-b').entries[0].state,'conflict');
 api.reconcile('scope-a',[{operationId:'still-pending',status:'completed',result:{conflict:true}}]);assert.equal(api.snapshot().entries.find(x=>x.id==='still-pending').state,'unknown');
});


test('monitor carries bounded retry phase metadata but no arbitrary connection payload',()=>{
 const m=monitor();m.api.observe({...ready,relay:{status:'reconnecting',phase:'retiring',retryInSeconds:900,reason:'channel_timeout',secret:'PRIVATE_STAGE'}});
 const s=m.api.snapshot().state;assert.equal(s.relayPhase,'retiring');assert.equal(s.retryInSeconds,300);assert.equal(s.relayReason,'channel_timeout');assert.ok(!JSON.stringify(s).includes('PRIVATE_STAGE'));
 m.api.observe({...ready,relay:{status:'reconnecting',phase:'invalid',retryInSeconds:-8}});assert.equal(m.api.snapshot().state.relayPhase,'idle');assert.equal(m.api.snapshot().state.retryInSeconds,0);
});

test('restoring an active outage preserves its original timestamp',async()=>{
 const time=Date.now()-120000;const m=monitor({scope:'scope-a',entries:[],alert:{id:1,active:true,kind:'cowork',time,message:'断开'}});
 await new Promise(r=>setImmediate(r));assert.equal(m.api.snapshot().alert.time,time);
});
