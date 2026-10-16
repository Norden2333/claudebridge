import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const observerCode=await fs.readFile(new URL('../extension/asset-observer.js',import.meta.url),'utf8');
const exporterCode=await fs.readFile(new URL('../extension/asset-export.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function observerFixture(now=()=>Date.now()){
 const handlers={},events={},messages=[],timers=new Map(),intervals=new Map(),doc={documentElement:{},hidden:false},location={pathname:'/chat/one'};let serial=0,enabled=false,fail=false,observed=0,disconnected=0,runtimeMessage;
 const bridge={onMessage:(n,f)=>handlers[n]=f,send:(n,v)=>messages.push({n,v})};
 const chrome={runtime:{sendMessage:async m=>{if(fail)throw new Error('disconnected');return {ok:true,result:{enabled}};},onMessage:{addListener:f=>runtimeMessage=f}}};
 class MutationObserver{observe(){observed++;}disconnect(){disconnected++;}}
 vm.runInNewContext(observerCode,{self:{ClaudefsCore:{bridge}},Date:{now},chrome,location,document:doc,MutationObserver,window:{setInterval:f=>{const id=++serial;intervals.set(id,f);return id;},clearInterval:id=>intervals.delete(id),navigation:{addEventListener:(n,f)=>events[n]=f},addEventListener:(n,f)=>events[n]=f},setTimeout:f=>{const id=++serial;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)});
 return {intervalCount:()=>intervals.size,pulse:()=>{for(const f of intervals.values())f();},hide:value=>doc.hidden=value,timerIds:()=>[...timers.keys()],handlers,events,messages,location,enable:()=>enabled=true,fail:()=>fail=true,change:()=>runtimeMessage({action:'asset_settings_changed'}),observed:()=>observed,disconnected:()=>disconnected,async tick(){const jobs=[...timers.values()];timers.clear();for(const f of jobs)await f();await flush();}};
}
test('auto-save wakes on settings, resumes BFCache and tolerates disconnected runtime',async()=>{
 const f=observerFixture();await f.tick();assert.equal(f.messages.length,0);f.enable();f.change();await f.tick();assert.equal(f.messages.at(-1).n,'asset-list-request');
 f.events.pagehide();assert.equal(f.disconnected(),1);f.change();await f.tick();assert.equal(f.messages.at(-1).n,'asset-export-cancel');
 f.events.pageshow({persisted:true});await f.tick();assert.equal(f.observed(),2);assert.equal(f.messages.at(-1).n,'asset-list-request');
 f.fail();f.change();await f.tick();assert.equal(f.messages.at(-1).n,'asset-list-request');
});
test('logical filenames in different chats do not suppress each other or accept stale lists',async()=>{
 const f=observerFixture();f.enable();await f.tick();const item={slot:'one',logicalPath:'/mnt/result.txt',version:1,route:'/chat/one'};
 f.handlers['asset-list-result']({items:[item]});assert.equal(f.messages.at(-1).n,'asset-export-request');
 f.handlers['asset-export-state']({slot:'one',phase:'saved'});await f.tick();f.handlers['asset-list-result']({items:[item]});assert.notEqual(f.messages.at(-1).n,'asset-export-request');
 f.location.pathname='/chat/two';f.events.navigatesuccess();await f.tick();f.handlers['asset-list-result']({items:[item]});assert.equal(f.messages.at(-1).n,'asset-list-request');
 f.handlers['asset-list-result']({items:[{...item,slot:'two',route:'/chat/two'}]});assert.equal(f.messages.at(-1).v.slot,'two');
});
function exportFixture({knownBlob=false,now=()=>Date.now(),unsupported=false,streaming=false}={}){
 const handlers={},events={},sent=[],timers=new Map(),location={pathname:'/chat/one',href:'https://claude.ai/chat/one'};let serial=0,capturedBegin,changeRoute=false,rejectFinish=false,fetchSignal,delayed=false;
 class Anchor{constructor(){this.download='file.txt';this.href='blob:https://claude.ai/fake';}click(){throw new Error('Unexpected real download');}}
 const card={matches:()=>true,closest:()=>({}),querySelectorAll:()=>[button]};
 const button={textContent:unsupported?'Unknown Export':'下载',disabled:false,getAttribute:()=>null,closest:()=>card,__reactFiber$test:{memoizedProps:{isStreaming:streaming,file:{name:'file.txt',path:'/mnt/file.txt'}}},click(){if(!delayed){const anchor=new Anchor();if(knownBlob)anchor.href=LocalURL.createObjectURL(new Blob(['known bytes']));anchor.click();}}};
 const bridge={onMessage:(n,f)=>handlers[n]=f,send(n,v){sent.push({n,v});if(n==='asset-transfer-request'){if(v.action==='asset_begin')capturedBegin=v;if(v.action==='asset_finish'&&rejectFinish){handlers['asset-transfer-result']({requestId:v.requestId,ok:false,error:'unknown commit'});return;}handlers['asset-transfer-result']({requestId:v.requestId,ok:true,result:v.action==='asset_precheck'?{upload:false,localVerificationPerformed:false}:{verified:true}});}}};
 class LocalURL extends URL{};LocalURL.createObjectURL=()=>'';LocalURL.revokeObjectURL=()=>{};
 vm.runInNewContext(exporterCode,{self:{ClaudefsCore:{bridge}},window:{addEventListener:(n,f)=>events[n]=f},document:{querySelectorAll:()=>[card]},location,Date:{now},crypto:webcrypto,TextEncoder,Uint8Array,Blob,URL:LocalURL,HTMLAnchorElement:Anchor,AbortController,btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout:(f,ms)=>{const id=++serial;timers.set(id,{f,ms});return id;},clearTimeout:id=>timers.delete(id),fetch:async(u,o)=>{fetchSignal=o.signal;if(changeRoute)location.pathname='/chat/two';return {ok:true,headers:{get:()=>null},body:new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.close();}})};}});
 return {delay:()=>delayed=true,fireLate:()=>new Anchor().click(),expire:()=>{for(const {f,ms} of [...timers.values()])if(ms===30000)f();},sent,handlers,events,begin:()=>capturedBegin,signal:()=>fetchSignal,changeRoute:()=>changeRoute=true,rejectFinish:()=>rejectFinish=true,async run(){handlers['asset-list-request']();const slot=sent.at(-1).v.items[0].slot;await handlers['asset-export-request']({slot});}};
}
test('export without Content-Length streams unknown size instead of claiming zero bytes',async()=>{
 const f=exportFixture();await f.run();assert.equal(Object.hasOwn(f.begin(),'expectedBytes'),false);assert.ok(f.signal());assert.equal(f.sent.at(-1).v.phase,'saved');assert.equal(f.sent.filter(x=>x.v.action==='asset_chunk').length,1);
});
test('navigation during export prevents begin and uncertain commit never triggers abort or replay',async()=>{
 const switched=exportFixture();switched.changeRoute();await switched.run();assert.equal(switched.begin(),undefined);assert.equal(switched.sent.at(-1).v.phase,'error');
 const committing=exportFixture();committing.rejectFinish();await committing.run();assert.equal(committing.sent.at(-1).v.phase,'error');assert.equal(committing.sent.filter(x=>x.v.action==='asset_abort').length,0);assert.equal(committing.sent.filter(x=>x.v.action==='asset_finish').length,1);
});

test('a timed-out automatic export cannot later escape into a normal browser download',async()=>{
 const f=exportFixture();f.delay();const running=f.run();await flush();f.expire();await running;assert.equal(f.sent.at(-1).v.phase,'error');assert.doesNotThrow(()=>f.fireLate());assert.equal(f.begin(),undefined);
});

test('continuous unrelated mutations do not postpone the pending detection forever',async()=>{const f=observerFixture();f.enable();const first=f.timerIds();for(let i=0;i<100;i++)f.change();assert.deepEqual(f.timerIds(),first);await f.tick();assert.equal(f.messages.filter(x=>x.n==='asset-list-request').length,1);});

test('visible metadata sweep catches late card readiness without repeating unchanged exports and pauses on hidden/closed pages',async()=>{const f=observerFixture();await f.tick();assert.equal(f.intervalCount(),1);f.pulse();await f.tick();assert.equal(f.messages.length,0);f.enable();f.change();await f.tick();const item={slot:'sweep',logicalPath:'/mnt/test.txt',version:1,route:'/chat/one'};f.handlers['asset-list-result']({items:[item]});f.handlers['asset-export-state']({slot:'sweep',phase:'saved'});await f.tick();const exports=f.messages.filter(x=>x.n==='asset-export-request').length;f.pulse();await f.tick();f.handlers['asset-list-result']({items:[item]});assert.equal(f.messages.filter(x=>x.n==='asset-export-request').length,exports);const count=f.messages.length;f.hide(true);f.pulse();await f.tick();assert.equal(f.messages.length,count);f.events.pagehide();assert.equal(f.intervalCount(),0);f.events.pageshow({persisted:true});assert.equal(f.intervalCount(),1);});

test('transient export errors retry after backoff and paused exports resume without burning retries',async()=>{
 let now=1000;const f=observerFixture(()=>now);f.enable();f.change();await f.tick();const item={slot:'retry-slot',logicalPath:'/mnt/retry.txt',name:'retry.txt',version:1,route:'/chat/one'};const list=()=>f.handlers['asset-list-result']({items:[item]});const count=()=>f.messages.filter(m=>m.n==='asset-export-request').length;
 list();assert.equal(count(),1);f.handlers['asset-export-state']({slot:item.slot,phase:'error',errorCode:'CFB_TIMEOUT',operationId:'retry-op-0001'});list();assert.equal(count(),1);now+=5001;list();assert.equal(count(),2);
 f.handlers['asset-export-state']({slot:item.slot,phase:'error',errorCode:'CFB_PAUSED',operationId:'retry-op-0002'});now+=999999;list();assert.equal(count(),2);f.change();await f.tick();list();assert.equal(count(),3);f.handlers['asset-export-state']({slot:item.slot,phase:'saved'});list();assert.equal(count(),3);
});

test('known Blob version precheck prevents begin, chunks and finish after page refresh',async()=>{
 const f=exportFixture({knownBlob:true});await f.run();
 assert.equal(f.sent.filter(x=>x.v.action==='asset_precheck').length,1);
 assert.equal(f.sent.filter(x=>['asset_begin','asset_chunk','asset_finish'].includes(x.v.action)).length,0);
 assert.equal(f.sent.at(-1).v.phase,'saved');assert.equal(f.sent.at(-1).v.result.localVerificationPerformed,false);
});

test('new version can recover a deterministic export block but an unknown commit cannot be replayed',async()=>{
 const f=observerFixture();f.enable();f.change();await f.tick();const first={slot:'blocked-v1',logicalPath:'/mnt/version.txt',name:'version.txt',version:1,route:'/chat/one'};
 f.handlers['asset-list-result']({items:[first]});f.handlers['asset-export-state']({slot:first.slot,phase:'error',errorCode:'CFB_ASSET_LIMIT',execution:'not_started'});
 f.handlers['asset-list-result']({items:[first]});assert.equal(f.messages.filter(x=>x.n==='asset-export-request').length,1);
 const newer={...first,slot:'blocked-v2',version:2};f.handlers['asset-list-result']({items:[newer]});assert.equal(f.messages.filter(x=>x.n==='asset-export-request').length,2);
 f.handlers['asset-export-state']({slot:newer.slot,phase:'error',execution:'unknown',errorCode:'CFB_TIMEOUT'});
 f.handlers['asset-list-result']({items:[{...newer,slot:'blocked-v3',version:3}]});assert.equal(f.messages.filter(x=>x.n==='asset-export-request').length,2);
});

test('delayed download suppression is one-shot, visible and expires within two minutes',async()=>{
 let now=1000;const f=exportFixture({now:()=>now});f.delay();const running=f.run();await flush();f.expire();await running;assert.doesNotThrow(()=>f.fireLate());assert.ok(f.sent.some(x=>x.n==='asset-download-notice'));assert.throws(()=>f.fireLate(),/Unexpected real download/);
 const expired=exportFixture({now:()=>now});expired.delay();const second=expired.run();await flush();expired.expire();await second;now+=120001;assert.throws(()=>expired.fireLate(),/Unexpected real download/);
});

test('stable unsupported cards report one notice without exporting, while streaming cards remain quiet',()=>{
 let now=1000;const f=exportFixture({unsupported:true,now:()=>now});f.handlers['asset-list-request']();assert.equal(f.sent.at(-1).v.items.length,0);now+=30001;f.handlers['asset-list-request']();f.handlers['asset-list-request']();assert.equal(f.sent.filter(x=>x.n==='asset-detection-notice').length,1);assert.equal(f.sent.filter(x=>x.n==='asset-transfer-request').length,0);
 const streaming=exportFixture({unsupported:true,streaming:true,now:()=>now});streaming.handlers['asset-list-request']();now+=60000;streaming.handlers['asset-list-request']();assert.equal(streaming.sent.filter(x=>x.n==='asset-detection-notice').length,0);
});
