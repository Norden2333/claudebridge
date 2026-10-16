import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const code=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');
test('fresh browser profile blocks page data and activation; explicit settings consent enables; withdrawal stops',async()=>{
 const callbacks={},sent=[],timers=new Set();let incoming;let store={};
 const event=n=>({addListener:f=>callbacks[n]=f});
 const chrome={storage:{local:{get:async()=>store,set:async v=>store={...store,...v}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onStartup:event('start'),onInstalled:event('installed'),onConnect:event('port'),onMessage:event('message'),connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:event('disconnect'),postMessage:m=>{sent.push(m);queueMicrotask(()=>incoming({id:m.id,ok:true,result:{local:'ready',config:{folder:'PRIVATE'},relay:{status:'idle'}}}));},disconnect(){}})},tabs:{query:async()=>[{id:1}],onUpdated:event('update'),onRemoved:event('remove')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 const self={};const tick=()=>new Promise(r=>setTimeout(r,15));
 const ask=(m,s)=>new Promise(resolve=>callbacks.message(m,s,resolve));
 const page={id:'test',url:'https://claude.ai/chat/1',tab:{id:1}},ui={id:'test',url:'chrome-extension://test/options.html'};
 try{
 vm.runInContext(code,vm.createContext({chrome,self,importScripts(){},crypto,URL,Map,Set,setTimeout:(f,ms)=>{const t=setTimeout(f,ms);timers.add(t);return t;},clearTimeout}));await tick();
 assert.ok(!sent.some(x=>x.action==='active'&&x.value));
 const status=await ask({action:'status'},page);assert.equal(status.result.folder,'');
 assert.equal((await ask({action:'consent_update',accepted:true},page)).ok,false);
 assert.equal((await ask({action:'tool',name:'read_file',args:{path:'x'}},page)).ok,false);
 await assert.rejects(self.CFB_NATIVE_REQUEST('import_download',{}),/同意/);
 assert.ok(!sent.some(x=>['tool','import_download'].includes(x.action)));
 assert.equal((await ask({action:'consent_update',accepted:true},ui)).ok,true);await tick();
 assert.ok(sent.some(x=>x.action==='active'&&x.value));
 await self.CFB_NATIVE_REQUEST('tool',{name:'read_file',args:{path:'x'}});assert.ok(sent.some(x=>x.action==='tool'));
 assert.equal((await ask({action:'consent_update',accepted:false},ui)).ok,true);await tick();
 assert.equal(store.cfbDataConsent.accepted,false);
 await assert.rejects(self.CFB_NATIVE_REQUEST('tool',{name:'delete_file'}),/同意/);
 assert.ok(sent.some(x=>x.action==='active'&&x.value===false));
 }finally{for(const t of timers)clearTimeout(t);}
});

test('Cowork remains active with no Claude tabs only while consent and background option are enabled',async()=>{
 const callbacks={},sent=[],timers=new Set();let incoming,disconnected=0,store={cfbDataConsent:{version:1,accepted:true}};
 const event=n=>({addListener:f=>callbacks[n]=f}),ui={id:'test',url:'chrome-extension://test/options.html'};
 const chrome={storage:{local:{get:async()=>store,set:async v=>store={...store,...v}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onStartup:event('start'),onInstalled:event('installed'),onConnect:event('port'),onMessage:event('message'),connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:event('disconnect'),postMessage:m=>{sent.push(m);queueMicrotask(()=>incoming({id:m.id,ok:true,result:{local:'ready',config:{folder:'FAKE',relayEnabled:true},relay:{status:'online'}}}));},disconnect(){disconnected++;}})},tabs:{query:async()=>[],onUpdated:event('update'),onRemoved:event('remove')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}}};
 try{
 vm.runInContext(code,vm.createContext({chrome,self:{},importScripts(){},crypto,URL,Map,Set,setTimeout:(f,ms)=>{const t=setTimeout(f,ms);timers.add(t);return t;},clearTimeout}));await new Promise(r=>setTimeout(r,30));
 assert.ok(sent.some(x=>x.action==='active'&&x.value===true));assert.equal(disconnected,0);
 const ask=m=>new Promise(resolve=>callbacks.message(m,ui,resolve));assert.equal((await ask({action:'cowork_background_set',enabled:false})).ok,true);await new Promise(r=>setTimeout(r,20));assert.equal(disconnected,1);assert.equal(store.cfbKeepCoworkOnline,false);
 }finally{for(const t of timers)clearTimeout(t);}
});

test('unified settings save restores extension snapshot on failure and reports that native settings were saved',async()=>{
 const callbacks={},sent=[],timers=new Set();let incoming,failNext=false,store={cfbDataConsent:{version:1,accepted:true},cfbAutoSave:false,cfbKeepCoworkOnline:true};
 const event=n=>({addListener:f=>callbacks[n]=f}),ui={id:'test',url:'chrome-extension://test/options.html'},page={id:'test',url:'https://claude.ai/chat/1',tab:{id:1}};
 const chrome={storage:{local:{get:async()=>structuredClone(store),set:async v=>{if(failNext&&v.cfbAutoSave!==undefined){failNext=false;store.cfbAutoSave=true;throw new Error('synthetic storage fault');}Object.assign(store,structuredClone(v));},remove:async keys=>{for(const k of keys)delete store[k];}}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onStartup:event('start'),onInstalled:event('installed'),onConnect:event('port'),onMessage:event('message'),connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:event('disconnect'),postMessage:m=>{sent.push(m);queueMicrotask(()=>incoming({id:m.id,ok:true,result:{local:'ready',config:m.config||{folder:'FAKE',relayEnabled:false},relay:{status:'idle'}}}));},disconnect(){}})},tabs:{query:async()=>[{id:1}],onUpdated:event('update'),onRemoved:event('remove')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 try{
 vm.runInContext(code,vm.createContext({chrome,self:{},importScripts(){},crypto,URL,Map,Set,setTimeout:(f,ms)=>{const t=setTimeout(f,ms);timers.add(t);return t;},clearTimeout}));await new Promise(r=>setTimeout(r,20));const ask=(m,s=ui)=>new Promise(resolve=>callbacks.message(m,s,resolve));const payload={action:'save_settings',accepted:true,autoSave:true,keepCoworkOnline:false,config:{folder:'NEW_FAKE',relayEnabled:false}};
 assert.equal((await ask(payload,page)).ok,false);const before=structuredClone(store);failNext=true;const failed=await ask(payload);assert.equal(failed.ok,false);assert.equal(failed.hostSettingsSaved,true);assert.deepEqual(store,before);assert.equal(failed.result.config.folder,'NEW_FAKE');assert.equal(failed.result.autoSaveEnabled,false);
 const success=await ask(payload);assert.equal(success.ok,true);assert.equal(store.cfbAutoSave,true);assert.equal(store.cfbKeepCoworkOnline,false);assert.equal(sent.filter(x=>x.action==='configure').length,2);
 }finally{for(const t of timers)clearTimeout(t);}
});
