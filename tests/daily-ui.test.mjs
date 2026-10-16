import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const tick=()=>new Promise(r=>setTimeout(r,10));
async function script(name,context){vm.runInContext(await fs.readFile(new URL('../extension/'+name,import.meta.url),'utf8'),vm.createContext(context));}
test('explicit workspace download scope remains the selected authorised profile rather than the current Cowork folder',async()=>{
 const store={},callbacks={},items=new Map(),imports=[];let current='/current-device';
 const chrome={storage:{session:{get:async()=>structuredClone(store),set:async x=>Object.assign(store,structuredClone(x))}},downloads:{search:async({id})=>[items.get(id)],onCreated:{addListener:f=>callbacks.created=f},onChanged:{addListener:f=>callbacks.changed=f}}};
 const self={CFB_NATIVE_REQUEST:async(action,args)=>{if(action==='status')return {local:'ready',scope:'current',config:{folder:current,allowWrites:true}};if(action==='profile_status'){assert.equal(args.scope,'bound');return {scope:'bound',folder:'bound-folder',allowWrites:true};}if(action==='workspace_validate_directory'){assert.equal(args.scope,'bound');return {valid:true};}if(action==='import_download'){imports.push(args);return {path:'report.md',verified:true};}}};
 await script('batch-downloads.js',{self,chrome,Date,URL,crypto});await self.CFB_BATCH_DOWNLOADS.arm({scope:'bound'});current='/another-device';
 const item={id:1,startTime:new Date().toISOString(),url:'https://claude.ai/generated',filename:'/downloads/report.md',state:'complete',danger:'safe',exists:true};items.set(1,item);callbacks.created(item);
 for(let n=0;n<40&&!imports.length;n++)await tick();assert.equal(imports[0].scope,'bound');assert.equal((await self.CFB_BATCH_DOWNLOADS.status()).items[0].status,'saved');
});
test('task download capture accepts multiple new Claude downloads, rejects unrelated/unsafe data, fixes subfolder and Finish preserves an in-flight result',async()=>{
 const store={},callbacks={},items=new Map(),imports=[];let release;
 const chrome={storage:{session:{get:async()=>structuredClone(store),set:async x=>Object.assign(store,structuredClone(x))}},downloads:{search:async({id})=>[items.get(id)],onCreated:{addListener:f=>callbacks.created=f},onChanged:{addListener:f=>callbacks.changed=f}}};
 const self={CFB_NATIVE_REQUEST:async(action,args)=>{if(action==='status')return {local:'ready',scope:'scope',config:{folder:'/selected',allowWrites:true}};if(action==='workspace_validate_directory')return {valid:true};if(action==='import_download'){imports.push(args);if(args.source.endsWith('wait.bin'))await new Promise(r=>release=r);return {path:'results/'+args.source.split('/').pop(),verified:true};}if(action==='operation_status')return {status:'pending'};}};
 await script('batch-downloads.js',{self,chrome,Date,URL,crypto});await self.CFB_BATCH_DOWNLOADS.arm({subdirectory:'results'});
 const make=(id,name,url='https://claude.ai/generated')=>({id,startTime:new Date().toISOString(),url,filename:'/downloads/'+name,state:'complete',danger:'safe',exists:true});
 callbacks.created(make(1,'other.bin','https://other.example/'));await tick();assert.equal(imports.length,0);
 for(const [id,name] of [[2,'first.pptx'],[3,'second.png']]){const i=make(id,name);items.set(id,i);callbacks.created(i);}for(let n=0;n<40&&imports.length<2;n++)await tick();assert.equal(imports.length,2);assert.ok(imports.every(x=>x.subdirectory==='results'&&x.scope==='scope'));
 const unsafe={...make(4,'unsafe.bin'),danger:'dangerous'};items.set(4,unsafe);callbacks.created(unsafe);await tick();assert.equal(imports.length,2);
 const waiting=make(5,'wait.bin');items.set(5,waiting);callbacks.created(waiting);for(let n=0;n<40&&!release;n++)await tick();await self.CFB_BATCH_DOWNLOADS.finish();release();await tick();const state=await self.CFB_BATCH_DOWNLOADS.status();assert.equal(state.status,'finished');assert.equal(state.items.find(x=>x.id===5).status,'saved');
 const late=make(6,'late.bin');items.set(6,late);callbacks.created(late);await tick();assert.equal(imports.length,3);callbacks.changed({id:5,state:{current:'complete'}});await tick();assert.equal(imports.length,3);
});
test('Chat conversation scope remains fixed across selected-folder changes; explicit rebind updates it; new conversations inherit current selection',async()=>{
 const local={},session={};const storage=store=>({get:async()=>structuredClone(store),set:async x=>Object.assign(store,structuredClone(x))});const self={},chrome={storage:{local:storage(local),session:storage(session)}};
 await script('bindings.js',{self,chrome,URL,Date});const sender={url:'https://claude.ai/chat/one',tab:{id:1}},first={scope:'folder-a',config:{folder:'/a'}};
 assert.equal(await self.CFB_BINDINGS.scope(sender,first),'folder-a');const second={scope:'folder-b',config:{folder:'/b'}};assert.equal(await self.CFB_BINDINGS.scope(sender,second),'folder-a');assert.equal((await self.CFB_BINDINGS.info(sender,second)).folder,'a');
 assert.equal(await self.CFB_BINDINGS.scope({...sender,url:'https://claude.ai/chat/two'},second),'folder-b');assert.equal(await self.CFB_BINDINGS.scope(sender,second,true),'folder-b');assert.equal(local.cfbBindings['/chat/one'].scope,'folder-b');
 const cowork={url:'https://claude.ai/cowork/cse_test123',tab:{id:9}};assert.equal(await self.CFB_BINDINGS.scope(cowork,first),'folder-a');assert.equal(await self.CFB_BINDINGS.scope(cowork,second),'folder-a');assert.equal(local.cfbBindings['/cowork/cse_test123'].scope,'folder-a');
 const draft={url:'https://claude.ai/new',tab:{id:5}};assert.equal(await self.CFB_BINDINGS.scope(draft,first),'folder-a');assert.equal(await self.CFB_BINDINGS.scope({...draft,url:'https://claude.ai/chat/new-id'},second),'folder-a');await self.CFB_BINDINGS.navigation(5,'https://claude.ai/new');assert.equal(await self.CFB_BINDINGS.scope(draft,second),'folder-b');
});
test('system notices are opt-in, delayed and once per outage; recovered transient outage cancels notification without tool calls',async()=>{
 let timer,cleared=false;const notifications=[],self={};const chrome={storage:{local:{get:async()=>({cfbNotices:{enabled:true}})}},permissions:{contains:async()=>true},notifications:{create:async(id,notice)=>notifications.push(notice),onClicked:{addListener(){}}},tabs:{create:async()=>{}},runtime:{getURL:x=>x}};
 await script('notices.js',{self,chrome,Set,setTimeout:(fn,ms)=>{assert.equal(ms,30000);timer=fn;return 1;},clearTimeout:()=>cleared=true});
 self.CFB_NOTICES.observe({alert:{active:true,id:1,message:'已断连'}});self.CFB_NOTICES.observe({alert:{active:false,id:1}});assert.equal(cleared,true);await timer();assert.equal(notifications.length,0);
 self.CFB_NOTICES.observe({alert:{active:true,id:2,message:'自动重连中'}});await timer();assert.equal(notifications.length,1);self.CFB_NOTICES.observe({alert:{active:true,id:2,message:'自动重连中'}});await timer();assert.equal(notifications.length,1);
});
