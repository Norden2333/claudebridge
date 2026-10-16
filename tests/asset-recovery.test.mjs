import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import crypto from 'node:crypto';
const code=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');
function worker(t,state){
 const callbacks={},sent=[],wake=[],timers=new Set();let incoming;
 const event=n=>({addListener:f=>callbacks[n]=f});
 const area=k=>({get:async()=>state[k],set:async value=>{state[k]={...state[k],...structuredClone(value)};}});
 const status={version:'0.4.3',nativeProtocol:1,local:'ready',scope:'a'.repeat(64),config:{folder:'C:/synthetic',allowWrites:true},relay:{status:'idle'}};
 const chrome={storage:{local:area('local'),session:area('session')},runtime:{id:'test',getManifest:()=>({version:'0.4.3'}),getURL:p=>'chrome-extension://test/'+p,onStartup:event('start'),onInstalled:event('installed'),onConnect:event('port'),onMessage:event('message'),connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:event('disconnect'),postMessage:m=>{sent.push(m);queueMicrotask(()=>{incoming({event:'status',...status});let result=status;if(m.action==='asset_begin')assert.ok(state.session.cfbAssetOwners.some(([id])=>id===m.operationId));if(m.action==='asset_status')result={status:'completed',result:{verified:true,path:'same.txt'}};if(m.action==='asset_finish')result={verified:true,path:'same.txt'};if(m.action==='asset_abort')result={aborted:true,applied:false};incoming({id:m.id,ok:true,result});});},disconnect(){}})},tabs:{query:async()=>[{id:1}],sendMessage:async(id,m)=>{wake.push(m);},onUpdated:event('update'),onRemoved:event('remove')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 vm.runInNewContext(code,{chrome,self:{},importScripts(){},crypto,URL,Map,Set,setTimeout:(f,ms)=>{const timer=setTimeout(f,ms);timers.add(timer);return timer;},clearTimeout});t.after(()=>{for(const timer of timers)clearTimeout(timer);});
 return {sent,wake,async ready(){await new Promise(r=>setTimeout(r,10));},ask:(message,sender)=>new Promise(resolve=>callbacks.message(message,sender,resolve))};
}
const page={id:'test',url:'https://claude.ai/chat/one',tab:{id:1},documentId:'document-one'};
const settings={id:'test',url:'chrome-extension://test/options.html'};
const initial=()=>({local:{cfbDataConsent:{version:1,accepted:true},cfbAutoSave:true},session:{}});
test('worker restart retains operation ownership and permits only reconciliation from reloaded conversation',async t=>{
 const state=initial(),first=worker(t,state);await first.ready();const operationId='restart-operation';
 assert.equal((await first.ask({action:'asset_begin',operationId,name:'same.txt',assetKey:'b'.repeat(64)},page)).ok,true);
 const second=worker(t,state);await second.ready();const reloaded={...page,documentId:'document-two'};
 assert.equal((await second.ask({action:'asset_chunk',operationId,sequence:0,data:'YWJj',sha256:'c'.repeat(64)},reloaded)).ok,false);
 assert.equal((await second.ask({action:'asset_status',operationId},reloaded)).result.status,'completed');
 assert.equal((await second.ask({action:'asset_status',operationId},{...reloaded,url:'https://claude.ai/chat/other'})).ok,false);
 assert.equal((await second.ask({action:'asset_status',operationId},{...reloaded,tab:{id:2}})).ok,false);
 assert.equal((await second.ask({action:'asset_begin',operationId,name:'same.txt',assetKey:'b'.repeat(64)},page)).ok,false);
 assert.equal(second.sent.filter(m=>m.action==='asset_begin'||m.action==='asset_chunk').length,0);
});
test('disabling auto-save still allows original status and cleanup, never new writes',async t=>{
 const state=initial(),f=worker(t,state);await f.ready();const operationId='disable-operation';
 assert.equal((await f.ask({action:'asset_begin',operationId,name:'same.txt',assetKey:'b'.repeat(64)},page)).ok,true);
 assert.equal((await f.ask({action:'asset_auto_set',enabled:false},settings)).ok,true);
 assert.equal((await f.ask({action:'asset_finish',operationId},page)).ok,false);
 assert.equal((await f.ask({action:'asset_status',operationId},page)).ok,true);
 assert.equal((await f.ask({action:'asset_abort',operationId},page)).result.aborted,true);
 assert.equal(state.session.cfbAssetOwners.length,0);
});
test('unchanged native heartbeat status does not endlessly postpone automatic-save detection',async t=>{
 const f=worker(t,initial());await f.ready();const operationId='wake-operation';await f.ask({action:'asset_begin',operationId,name:'same.txt',assetKey:'b'.repeat(64)},page);await f.ready();const count=f.wake.length;
 for(let i=0;i<10;i++)await f.ask({action:'asset_status',operationId},page);await f.ready();assert.equal(f.wake.length,count);
 await f.ask({action:'asset_auto_set',enabled:false},settings);await f.ready();assert.equal(f.wake.length,count+1);
});
