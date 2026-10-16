import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import crypto from 'node:crypto';
const code=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8'),id='test-extension';
for(const descriptor of [{version:'0.0.0',nativeProtocol:1},{version:'0.3.7'},{version:'0.3.7',nativeProtocol:1}])test('browser transport handshake '+JSON.stringify(descriptor),async()=>{
 const events={},event=n=>({addListener:f=>events[n]=f}),sent=[],timers=new Set();let incoming;
 const timeout=(f,d)=>{const t=setTimeout(()=>{timers.delete(t);f();},d);timers.add(t);return t;},clear=t=>{timers.delete(t);clearTimeout(t);};
 const chrome={runtime:{id,getManifest:()=>({version:'0.3.7'}),onStartup:event('start'),onInstalled:event('install'),onConnect:event('connect'),onMessage:event('message'),getURL:p=>'chrome-extension://'+id+'/'+p,
 connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:event('disconnect'),postMessage:m=>{sent.push(m);queueMicrotask(()=>incoming({id:m.id,ok:true,result:m.action==='status'?{...descriptor,local:'ready',config:{},relay:{status:'idle'}}:{}}));},disconnect(){}})},tabs:{query:async()=>[{id:1}],onUpdated:event('update'),onRemoved:event('remove')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 const self={};try{chrome.storage ??={};chrome.storage.local={get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}; vm.runInContext(code,vm.createContext({chrome,self,importScripts(){},crypto,URL,setTimeout:timeout,clearTimeout:clear,Map,Set}));await new Promise(r=>setTimeout(r,30));
 const compatible=descriptor.version==='0.3.7'&&descriptor.nativeProtocol===1;
 if(compatible){await self.CFB_NATIVE_REQUEST('tool',{name:'write_file',args:{path:'a',content:'once'}});const written=sent.find(x=>x.action==='tool');assert.equal(written.clientVersion,'0.3.7');assert.equal(written.nativeProtocol,1);}
 else{await assert.rejects(self.CFB_NATIVE_REQUEST('tool',{name:'write_file',args:{path:'a',content:'once'}}),/版本不匹配/);assert.ok(!sent.some(x=>x.action==='tool'||x.action==='active'));}
 await self.CFB_NATIVE_REQUEST('diagnostics');assert.ok(sent.some(x=>x.action==='diagnostics'));
 }finally{for(const t of timers)clearTimeout(t);}
});
