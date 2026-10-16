import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
const code = await fs.readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const identity = JSON.parse(await fs.readFile(new URL('../identity.json', import.meta.url), 'utf8'));
const { definitions } = await import('../companion/files.mjs');
test('extension identity, main-world resources, native schemas and no unnecessary permissions', async () => {
  const calculated = [...crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  assert.equal(calculated, identity.extensionId);
  const project = JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')); assert.equal(manifest.version,project.version);
  assert.deepEqual(manifest.permissions, ['nativeMessaging', 'alarms', 'downloads', 'storage']);
  for (const block of manifest.content_scripts) for (const file of block.js) { const source = await fs.readFile(new URL('../extension/' + file, import.meta.url), 'utf8'); new vm.Script(source); }
  const ctx = vm.createContext({ self: {} }); vm.runInContext(await fs.readFile(new URL('../extension/tools.js', import.meta.url), 'utf8'), ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.self.CFB_TOOL_DEFINITIONS)), definitions);
});
test('background refuses configuration from pages, redacts status and starts/stops on tabs', async () => {
  const events = {};
  const event = name => ({ addListener: callback => { events[name] = callback; } });
  let tabs = [{}], connections = 0, disconnects = 0, sent = [], incoming, statusValue;
  const chrome = {
    runtime: { id: identity.extensionId, getURL: p => `chrome-extension://${identity.extensionId}/${p}`, openOptionsPage: async () => {},
      onStartup: event('startup'), onInstalled: event('installed'), onConnect: event('uiconnect'), onMessage: event('message'),
      connectNative: () => { connections++; return { onMessage: { addListener: f => incoming = f }, onDisconnect: event('disconnect'), postMessage: m => { sent.push(m); queueMicrotask(() => incoming({ id: m.id, ok: true, result: {} })); }, disconnect: () => { disconnects++; } }; }
    },
    tabs: { query: async () => tabs, onUpdated: event('updated'), onRemoved: event('removed') },
    alarms: { create: () => {}, onAlarm: event('alarm') },
    action: { setBadgeText: async s => statusValue = s, setBadgeBackgroundColor: async () => {} }
  };
  const delays=[];const ctx = vm.createContext({ importScripts: () => {}, self: {}, chrome, crypto, URL, setTimeout:(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms);}, clearTimeout, Map, Set }); chrome.storage ??={};chrome.storage.local={get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}; vm.runInContext(code, ctx);
  const tick = () => new Promise(resolve => setTimeout(resolve, 20)); await tick(); assert.equal(connections, 1);
  incoming({ event: 'status', local: 'ready', config: { folder: '/Users/private-user/work', allowWrites: true }, relay: { status: 'auth_required', verificationUrl: 'https://mcp.desktopcommander.app/verify?secret=transient', userCode: 'PRIVATE' } });
  const page = { id: identity.extensionId, url: 'https://claude.ai/chat/example', tab: { id: 1 } };
  let reply;
  events.message({ action: 'configure', config: { folder: '/etc' } }, page, r => reply = r); assert.equal(reply.ok, false);
  const diagnosticRequests=sent.filter(m=>m.action==='diagnostics').length;events.message({action:'diagnostics'},page,r=>reply=r);assert.equal(reply.ok,false);events.message({action:'revoke_folder',scope:'a'.repeat(64),confirm:true},page,r=>reply=r);assert.equal(reply.ok,false);assert.equal(sent.filter(m=>m.action==='revoke_folder').length,0);assert.equal(sent.filter(m=>m.action==='diagnostics').length,diagnosticRequests);
  events.message({ action: 'status' }, page, r => reply = r); assert.equal(reply.result.folder, 'work');
  assert.ok(!JSON.stringify(reply).includes('private-user')); assert.ok(!JSON.stringify(reply).includes('PRIVATE')); assert.ok(!JSON.stringify(reply).includes('verificationUrl'));
  const initial = sent.length; assert.equal(events.message({ action: 'tool', name: 'read_file', args: { path: 'a' } }, { ...page, url: 'https://evil.example/' }, () => {}), false); assert.equal(sent.length, initial);
  const ui = { id: identity.extensionId, url: chrome.runtime.getURL('options.html') };
  events.message({ action: 'status' }, ui, r => reply = r); assert.equal(reply.result.config.folder, '/Users/private-user/work');
  events.message({action:'diagnostics'},ui,r=>reply=r);await tick();assert.equal(reply.ok,true);assert.equal(reply.result.schema,'claude-folder-support/v1');assert.ok(sent.some(m=>m.action==='diagnostics'));assert.ok(!JSON.stringify(reply).includes('PRIVATE'));
  events.message({action:'revoke_folder',scope:'a'.repeat(64),confirm:true},ui,r=>reply=r);await tick();assert.equal(reply.ok,true);assert.ok(delays.includes(1500000));
  tabs = []; events.removed(); await tick(); assert.equal(disconnects, 1);
  tabs = [{}]; events.updated(); await tick(); assert.equal(connections, 2); assert.ok(sent.some(m => m.action === 'active' && m.value));
});

test('native port recovery reconnects channel only, never resends an interrupted write', async () => {
  const events = {}, event = name => ({addListener:f=>events[name]=f});
  let tabs=[{}], incoming, disconnected, connections=0; const sent=[];
  const chrome={runtime:{id:identity.extensionId,getURL:p=>`chrome-extension://${identity.extensionId}/${p}`,
    onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('ui'),onMessage:event('message'),
    connectNative:()=>{connections++;return {onMessage:{addListener:f=>incoming=f},onDisconnect:{addListener:f=>disconnected=f},
      postMessage:m=>{sent.push(m);if(m.action!=='tool')queueMicrotask(()=>incoming({id:m.id,ok:true,result:{}}));},disconnect:()=>{}};}},
    tabs:{query:async()=>tabs,onUpdated:event('updated'),onRemoved:event('removed')},alarms:{create:()=>{},onAlarm:event('alarm')},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
  chrome.storage ??={};chrome.storage.local={get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}; vm.runInContext(code,vm.createContext({importScripts:()=>{},self:{},chrome,crypto,URL,setTimeout,clearTimeout,Map,Set}));
  const tick=()=>new Promise(r=>setTimeout(r,20));await tick();
  let reply;events.message({action:'tool',name:'write_file',args:{path:'a.txt',content:'once'},operationId:'once-write-test'},
    {id:identity.extensionId,url:'https://claude.ai/chat/test',tab:{id:1}},r=>reply=r);
  await tick();disconnected();await tick();assert.equal(reply.ok,false);assert.match(reply.error,/once-write-test/);assert.equal(connections,1);events.alarm();await tick();assert.equal(connections,1);const deadline=Date.now()+3000;while(connections===1&&Date.now()<deadline)await tick();await tick();
  assert.equal(connections,2);assert.equal(sent.filter(m=>m.action==='tool').length,1);
  assert.equal(sent.filter(m=>m.action==='active').length,2);
  tabs=[];events.removed();await tick();events.alarm();await tick();assert.equal(connections,2);
});

test('monitor ports only serve Claude tabs, redact private state and mark lost operations unknown without tool polling',async()=>{
  const events={},event=name=>({addListener:f=>events[name]=f});let incoming,disconnected;const sent=[],updates=[];
  const chrome={runtime:{id:identity.extensionId,getURL:p=>`chrome-extension://${identity.extensionId}/${p}`,
    onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('connect'),onMessage:event('message'),
    connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:{addListener:f=>disconnected=f},postMessage:m=>{sent.push(m);queueMicrotask(()=>incoming({id:m.id,ok:true,result:{}}));},disconnect:()=>{}})},
    tabs:{query:async()=>[{}],onUpdated:event('updated'),onRemoved:event('removed')},alarms:{create:()=>{},onAlarm:event('alarm')},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},storage:{session:{get:async()=>({}),set:async()=>{}}}};
  const ctx=vm.createContext({self:{},chrome,crypto,URL,setTimeout,clearTimeout,Map,Set});
  ctx.importScripts=()=>{};vm.runInContext(await fs.readFile(new URL('../extension/monitor.js',import.meta.url),'utf8'),ctx);chrome.storage ??={};chrome.storage.local={get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}; vm.runInContext(code,ctx);await new Promise(r=>setTimeout(r,20));
  const makePort=url=>({name:'monitor',sender:{id:identity.extensionId,url,tab:{id:1}},postMessage:m=>updates.push(m),onDisconnect:{addListener(){}}});
  events.connect(makePort('https://evil.example/'));assert.equal(updates.length,0);events.connect(makePort('https://claude.ai/cowork/example'));
  incoming({event:'status',local:'ready',scope:'scope-a',config:{folder:'/private/person/work',allowWrites:true,relayEnabled:true,proxy:'PRIVATE_PROXY'},relay:{status:'online',userCode:'SECRET_AUTH'}});
  incoming({event:'activity',activity:{id:'request-a',operationId:'saved-request-a',scope:'scope-a',kind:'write_file',channel:'chat',state:'running',paths:['note.txt'],content:'SECRET_BODY',time:1}});
  disconnected();await new Promise(r=>setTimeout(r,0));assert.equal(updates.at(-1).alert.kind,'local');assert.equal(updates.at(-1).entries[0].state,'unknown');
  assert.ok(!JSON.stringify(updates).includes('SECRET'));assert.ok(!JSON.stringify(updates).includes('/private/person'));assert.ok(!JSON.stringify(updates).includes('PRIVATE_PROXY'));
  const count=sent.length;let reply;events.message({action:'monitor_clear'},{id:identity.extensionId,url:'https://claude.ai/chat/example',tab:{id:1}},r=>reply=r);
  await new Promise(r=>setTimeout(r,0));assert.equal(reply.ok,true);assert.equal(updates.at(-1).entries.length,0);assert.equal(sent.length,count);assert.ok(sent.every(m=>m.action==='active'));
});

test('native reconnect backs off, alarm cannot bypass it, and closing tabs cancels retry', async()=>{
  const events={}, event=name=>({addListener:f=>events[name]=f});let clock=0,tabs=[{}],incoming,disconnected,connections=0,serial=0;const timers=new Map(),sent=[];
  const chrome={runtime:{id:identity.extensionId,getURL:p=>`chrome-extension://${identity.extensionId}/${p}`,onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('ui'),onMessage:event('message'),connectNative:()=>{connections++;return {onMessage:{addListener:f=>incoming=f},onDisconnect:{addListener:f=>disconnected=f},postMessage:m=>{sent.push(m);queueMicrotask(()=>incoming({id:m.id,ok:true,result:{}}));},disconnect(){}};}},tabs:{query:async()=>tabs,onUpdated:event('updated'),onRemoved:event('removed')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
  const FakeDate=class extends Date { static now(){return clock;} };
  const tick=()=>new Promise(r=>setTimeout(r,0));
  const advance=async ms=>{clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}await tick();};
  chrome.storage ??={};chrome.storage.local={get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}; vm.runInContext(code,vm.createContext({importScripts(){},self:{},chrome,crypto,URL,Date:FakeDate,Map,Set,setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id)}));
  await tick();assert.equal(connections,1);disconnected();await tick();events.alarm();await tick();assert.equal(connections,1);
  await advance(999);assert.equal(connections,1);await advance(1);assert.equal(connections,2);
  disconnected();await advance(1000);events.alarm();await tick();assert.equal(connections,2);await advance(1000);assert.equal(connections,3);
  incoming({event:'status',local:'ready',config:{},relay:{status:'online'}});await advance(60000);disconnected();await advance(1000);assert.equal(connections,4);
  disconnected();tabs=[];events.removed();await tick();await advance(120000);assert.equal(connections,4);assert.equal(timers.size,0);assert.ok(sent.every(m=>m.action==='active'));
});


test('workspace check reconciles resolved native receipts into the same scoped monitor feed',async()=>{
 const events={},event=name=>({addListener:f=>events[name]=f});let incoming;const updates=[];
 const chrome={runtime:{id:identity.extensionId,getURL:p=>`chrome-extension://${identity.extensionId}/${p}`,onStartup:event('startup'),onInstalled:event('installed'),onConnect:event('connect'),onMessage:event('message'),connectNative:()=>({onMessage:{addListener:f=>incoming=f},onDisconnect:{addListener(){}},postMessage:m=>{queueMicrotask(()=>incoming({id:m.id,ok:true,result:m.action==='workspace_check'?{items:[{operationId:'resolved-record',status:'completed',result:{verified:true,path:'note.md'}}],summary:{completed:1,partial:0,needsChoice:0,unknown:0}}:{}}));},disconnect(){}})},tabs:{query:async()=>[{}],onUpdated:event('updated'),onRemoved:event('removed')},alarms:{create(){},onAlarm:event('alarm')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},storage:{session:{get:async()=>({}),set:async()=>{}},local:{get:async()=>({cfbDataConsent:{version:1,accepted:true}}),set:async()=>{}}}};
 const ctx=vm.createContext({self:{},importScripts(){},chrome,crypto,URL,setTimeout,clearTimeout,Map,Set});vm.runInContext(await fs.readFile(new URL('../extension/monitor.js',import.meta.url),'utf8'),ctx);vm.runInContext(code,ctx);await new Promise(r=>setTimeout(r,20));
 incoming({event:'status',local:'ready',scope:'scope-a',config:{folder:'E:/work',allowWrites:true,relayEnabled:true},relay:{status:'online'}});
 incoming({event:'activity',activity:{id:'resolved-record',operationId:'resolved-record',scope:'scope-a',kind:'import_download',state:'conflict',paths:['note.md']}});
 assert.equal(ctx.self.CFB_MONITOR.snapshot().entries[0].state,'conflict');
 const result=await new Promise(resolve=>events.message({action:'workspace_check',scope:'scope-a'},{id:identity.extensionId,url:`chrome-extension://${identity.extensionId}/workspace.html`},resolve));
 assert.equal(result.ok,true);assert.equal(ctx.self.CFB_MONITOR.snapshot().entries[0].state,'completed');
});
