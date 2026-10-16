import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {FileExecutor} from '../companion/files.mjs';
async function fixture(t){const folder=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'cfb-bug-audit-')));t.after(()=>fs.rm(folder,{recursive:true,force:true}));return {folder,engine:new FileExecutor({folder,allowWrites:true})};}
test('a previously read file deleted externally is not silently recreated during rewrite or append',async t=>{
 const {folder,engine}=await fixture(t);for(const mode of ['rewrite','append']){await fs.writeFile(path.join(folder,'original.md'),'before');const r=await engine.execute('read_file',{path:'original.md'});await fs.unlink(path.join(folder,'original.md'));await assert.rejects(engine.execute('write_file',{path:'original.md',content:'after',mode,expected_sha256:r.sha256}));await assert.rejects(fs.access(path.join(folder,'original.md')),{code:'ENOENT'});}
});
test('failed new text write does not leave a partial final file or temporary artifacts',async t=>{
 const {folder,engine}=await fixture(t),original=fs.writeFile,marker='disk-failure-fixture';
 fs.writeFile=async(file,data,...rest)=>{if(path.dirname(String(file))===folder&&data===marker){await original(file,marker.slice(0,4),...rest);const e=new Error('simulated disk full');e.code='ENOSPC';throw e;}return original(file,data,...rest);};
 try{await assert.rejects(engine.execute('write_file',{path:'new.md',content:marker}));}finally{fs.writeFile=original;}
 assert.deepEqual(await fs.readdir(folder),[]);
});
test('disconnect and timeout report the actual custom operation ID rather than the transport message ID',async()=>{
 const code=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8'),identity=JSON.parse(await fs.readFile(new URL('../identity.json',import.meta.url),'utf8'));const events={},event=n=>({addListener:f=>events[n]=f});let incoming,disconnected;const sent=[];
 const chrome={runtime:{id:identity.extensionId,getURL:p=>`chrome-extension://${identity.extensionId}/${p}`,onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('ui'),onMessage:event('message'),connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:{addListener:f=>disconnected=f},postMessage:m=>{sent.push(m);if(m.action!=='tool')queueMicrotask(()=>incoming({id:m.id,ok:true,result:{}}));},disconnect(){}})},tabs:{query:async()=>[{}],onUpdated:event('updated'),onRemoved:event('removed')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 chrome.storage={local:{get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}};vm.runInContext(code,vm.createContext({importScripts(){},self:{},chrome,crypto,URL,setTimeout,clearTimeout,Map,Set}));const tick=()=>new Promise(r=>setTimeout(r,10));await tick();let reply;
 events.message({action:'tool',name:'write_file',args:{path:'a.md',content:'one',operation_id:'real-operation-123'},operationId:'transport-operation-456'},{id:identity.extensionId,url:'https://claude.ai/chat/test',tab:{id:1}},r=>reply=r);await tick();disconnected();await tick();assert.equal(reply.ok,false);assert.match(reply.error,/real-operation-123/);assert.ok(!reply.error.includes('transport-operation-456'));
});

test('exclusive new-text publication preserves a concurrently created final file',async t=>{
 const {folder,engine}=await fixture(t),original=fs.link;fs.link=async(source,target)=>{if(target===path.join(folder,'collision.md'))await fs.writeFile(target,'external content',{flag:'wx'});return original(source,target);};
 try{await assert.rejects(engine.execute('write_file',{path:'collision.md',content:'our content'}));}finally{fs.link=original;}
 assert.equal(await fs.readFile(path.join(folder,'collision.md'),'utf8'),'external content');assert.deepEqual(await fs.readdir(folder),['collision.md']);
});
test('timeout keeps reserved-protocol operation ID and user message ID cannot break native correlation',async()=>{
 const code=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8'),identity=JSON.parse(await fs.readFile(new URL('../identity.json',import.meta.url),'utf8'));const events={},event=n=>({addListener:f=>events[n]=f}),timers=new Map();let serial=0,incoming,tabs=[{}];const sent=[];
 const chrome={runtime:{id:identity.extensionId,getURL:p=>`chrome-extension://${identity.extensionId}/${p}`,onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('ui'),onMessage:event('message'),connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:{addListener(){}},postMessage:m=>{sent.push(m);if(m.action!=='tool')queueMicrotask(()=>incoming({id:m.id,ok:true,result:{}}));},disconnect(){}})},tabs:{query:async()=>tabs,onUpdated:event('updated'),onRemoved:event('removed')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 chrome.storage={local:{get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}};vm.runInContext(code,vm.createContext({importScripts(){},self:{},chrome,crypto,URL,Map,Set,setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)}));const tick=()=>new Promise(r=>setTimeout(r,10));await tick();let reply;
 events.message({action:'tool',name:'write_file',args:{path:'.claude-file-operation.json',content:JSON.stringify({protocol:'claude-folder-operation/v1',operation:'delete_file',operationId:'protocol-operation-123',path:'test.md',confirmDelete:true})},operationId:'different-transport-id'}, {id:identity.extensionId,url:'https://claude.ai/chat/test',tab:{id:1}},r=>reply=r);await tick();assert.equal(sent.at(-1).operationId,'protocol-operation-123');const timer=[...timers].find(([,v])=>v.ms===1320000);timers.delete(timer[0]);timer[1].fn();await tick();assert.match(reply.error,/protocol-operation-123/);assert.ok(!reply.error.includes('different-transport-id'));
 let uiReply;events.message({action:'setup_status',id:'user-message-id'}, {id:identity.extensionId,url:chrome.runtime.getURL('onboarding.html')},r=>uiReply=r);await tick();assert.equal(uiReply.ok,true);assert.notEqual(sent.at(-1).id,'user-message-id');tabs=[];events.removed();await tick();assert.equal(timers.size,0);
});
