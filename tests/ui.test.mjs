import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = file => fs.readFile(new URL('../extension/' + file, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function page(name, send) {
  const html = await source(name + '.html'), elements = {};
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements[match[1]] = { value: '', checked: false, hidden: false, disabled: false, textContent: '', removeAttribute(attribute) { delete this[attribute]; }, focus() { this.focused = true; } };
  elements.networkMode && (elements.networkMode.value = 'proxy');
  const events = {}, timers = [], calls = []; let receive;
  const doc = { getElementById: id => { assert.ok(elements[id], 'Missing element ' + id); return elements[id]; }, hidden: false, addEventListener: (name, fn) => events[name] = fn };
  const chrome = { runtime: { connect: () => ({ onMessage: { addListener: fn => receive = fn }, onDisconnect: { addListener() {} } }), sendMessage: async message => { calls.push(message); return send(message); }, openOptionsPage: async () => {} }, tabs: { create: async () => {} } };
  const ctx = vm.createContext({ document: doc, chrome, URL, window: { addEventListener: (name, fn) => events[name] = fn }, setInterval: fn => timers.push(fn) });
  vm.runInContext(await source('experience.js'), ctx); vm.runInContext(await source('ui.js'), ctx); vm.runInContext(await source(name + '.js'), ctx); await tick();
  return { elements, events, timers, calls, receive: s => receive(s), doc };
}
const ready = { dataConsentGranted:true, local: 'ready', config: { folder: '/work', proxy: '', networkMode: 'proxy', allowWrites: true, relayEnabled: false, systemNetworkAccepted: false }, relay: { status: 'idle' } };
test('an unavailable saved directory explains how to reselect and does not disable the settings form',async()=>{
 const p=await page('options',async()=>({ok:true,result:ready}));p.receive({...ready,local:'unavailable',autoSaveEnabled:true});
 assert.match(p.elements.local.textContent,/工作文件夹.*不可用/);assert.match(p.elements.autoStatus.textContent,/重新选择/);assert.equal(p.elements.choose.disabled,false);p.elements.folder.value='/new';p.elements.settingsForm.oninput();assert.equal(p.elements.save.disabled,false);
});

test('failure after native configure is visible instead of silently reporting or implying a saved setting',async()=>{
 const p=await page('options',async m=>m.action==='save_settings'?{ok:false,error:'本机已保存；扩展偏好保存失败，已恢复原值。',hostSettingsSaved:true,result:{...ready,autoSaveEnabled:false}}:{ok:true,result:{...ready,autoSaveEnabled:false}});
 p.elements.autoSave.checked=true;p.elements.settingsForm.oninput();p.elements.settingsForm.onsubmit({preventDefault(){}});await tick();await tick();
 assert.match(p.elements.message.textContent,/扩展偏好保存失败/);assert.equal(p.elements.saveState.textContent,'部分设置已保存，请核对');
});

test('reconnecting Cowork remains distinct from ready local files and pending verification', async () => {
  const p = await page('popup',async m=>({ok:true,result:m.action==='download_status'?{status:'idle'}:ready}));
  p.receive({...ready,config:{...ready.config,relayEnabled:true},relay:{status:'reconnecting'}});
  assert.match(p.elements.remote.textContent,/自动重连/);assert.equal(p.elements.armDownload.disabled,false);
  p.receive({...ready,config:{...ready.config,relayEnabled:true},relay:{status:'auth_required'}});
  assert.match(p.elements.remote.textContent,/设备验证/);
});

test('settings preserves unsaved folder during status updates, validates visible fields, saves normalized values and warns only while dirty', async () => {
  const p = await page('options', async m => ({ ok: true, result: m.action === 'download_status' ? { status: 'idle' } : m.action === 'save_settings' ? { ...ready,autoSaveEnabled:m.autoSave,keepCoworkOnline:m.keepCoworkOnline, config: { ...m.config, folder: '/normalized' } } : ready }));
  const e = p.elements;
  assert.equal(e.save.disabled, true); assert.equal(e.coworkSettings.open, false);
  e.folder.value = '/draft'; e.settingsForm.oninput(); p.receive(ready); assert.equal(e.folder.value, '/draft'); assert.equal(e.save.disabled, false);
  let warned = false; p.events.beforeunload({ preventDefault() { warned = true; } }); assert.equal(warned, true);
  e.relay.checked = true; e.settingsForm.oninput(); e.settingsForm.onsubmit({ preventDefault() {} }); await tick();
  assert.equal(e.proxy.focused, true); assert.equal(p.calls.filter(c => c.action === 'save_settings').length, 0);
  e.proxy.value = 'http://127.0.0.1:8080'; e.settingsForm.oninput(); e.settingsForm.onsubmit({ preventDefault() {} }); await tick();
  assert.equal(e.folder.value, '/normalized'); assert.equal(e.save.disabled, true); warned = false; p.events.beforeunload({ preventDefault() { warned = true; } }); assert.equal(warned, false);
  e.folder.value = ''; e.settingsForm.oninput(); e.settingsForm.onsubmit({ preventDefault() {} }); assert.equal(e.folder.focused, true); assert.equal(p.calls.filter(c => c.action === 'save_settings').length, 1);
});

test('missing host and read-only state show next action without enabling save/download; recovery controls only appear when relevant', async () => {
  let state = { local: 'missing' }, download = { status: 'idle' };
  const p = await page('options', async m => ({ ok: true, result: m.action === 'download_status' ? download : state }));
  const e = p.elements; assert.equal(e.save.disabled, true); assert.equal(e.choose.disabled, true); assert.equal(e.installHelp.hidden, false); assert.equal(e.armDownload.disabled, true);
  state = { ...ready, config: { ...ready.config, allowWrites: false } }; p.receive(state); assert.equal(e.installHelp.hidden, true); assert.equal(e.armDownload.disabled, true); assert.match(e.downloadHelp.textContent, /只读/);
  p.receive(ready); download = { status: 'unknown', operationId: 'test-operation' }; p.timers.forEach(fn=>fn()); await tick();
  assert.equal(e.armDownload.disabled, true); assert.equal(e.retryDownload.hidden, false); assert.equal(e.cancelDownload.hidden, false); assert.equal(e.downloadDetails.hidden, false);
});

test('popup arms download in one click, ignores stale poll response and background polling never disables settings actions', async () => {
  let finishPoll, calls = 0;
  const p = await page('popup', async m => m.action === 'status' ? { ok: true, result: ready } : m.action === 'arm_download' ? { ok: true, result: { status: 'armed' } } : ++calls === 1 ? new Promise(resolve => finishPoll = resolve) : { ok: true, result: { status: 'armed' } });
  assert.equal(p.elements.folderName.textContent, 'work'); assert.equal(p.elements.armDownload.disabled, false);
  p.elements.armDownload.onclick(); await tick(); assert.match(p.elements.downloadStatus.textContent, /5 分钟/);
  finishPoll({ ok: true, result: { status: 'idle' } }); await tick(); assert.match(p.elements.downloadStatus.textContent, /5 分钟/); assert.equal(p.elements.armDownload.disabled, true);
  assert.equal(p.elements.settings.disabled, false); assert.equal(p.elements.cancelDownload.hidden, false);
});

test('verification only accepts official HTTPS links; status updates cannot overwrite draft or introduce a foreign verification link', async () => {
  const p = await page('options', async m => ({ ok: true, result: m.action === 'download_status' ? { status: 'idle' } : ready }));
  p.receive({ ...ready, relay: { status: 'auth_required', verificationUrl: 'https://evil.example/verify', userCode: 'code' } }); assert.equal(p.elements.verification.hidden, true);
  p.receive({ ...ready, relay: { status: 'auth_required', verificationUrl: 'https://mcp.desktopcommander.app/verify', userCode: '1234' } }); assert.equal(p.elements.verification.hidden, false); assert.match(p.elements.code.textContent, /1234/);
  p.receive(ready); assert.equal(p.elements.verification.hidden, true); assert.equal(p.elements.verify.href, undefined);
});

test('first-use empty folder is not labelled saved and auto network needs no proxy field',async()=>{
 const initial={...ready,local:'unconfigured',dataConsentGranted:false,autoSaveEnabled:false,config:{folder:'',proxy:'',networkMode:'auto',allowWrites:false,relayEnabled:false,systemNetworkAccepted:false}};const p=await page('options',async m=>({ok:true,result:m.action==='download_status'?{status:'idle'}:initial}));assert.equal(p.elements.saveState.textContent,'请先选择工作文件夹');assert.equal(p.elements.save.disabled,true);assert.equal(p.elements.choose.disabled,false);p.elements.relay.checked=true;p.elements.settingsForm.oninput();assert.equal(p.elements.proxySection.hidden,true);assert.equal(p.elements.networkMode.value,'auto');
});
test('visible version on all packaged extension pages matches manifest',async()=>{
 const version=JSON.parse(await source('manifest.json')).version;for(const name of ['options','popup','workspace']){const html=await source(name+'.html');assert.ok(html.includes('· '+version),name+' visible version differs');}
});


test('popup and settings show retry seconds and retirement without guessing a network cause',async()=>{
 for(const name of ['popup','options']){
  const state={...ready,config:{...ready.config,relayEnabled:true},relay:{status:'reconnecting',phase:'retry_wait',retryInSeconds:12,reason:'service_unreachable'}};
  const p=await page(name,async()=>({ok:true,result:state}));p.receive(state);assert.equal(p.elements.remote.textContent,'Cowork 将在 12 秒后重试');
  p.receive({...state,relay:{...state.relay,phase:'retiring'}});assert.equal(p.elements.remote.textContent,'Cowork 等待旧连接收尾');
  p.receive({...state,relay:{status:'reconnecting',phase:'connecting'}});assert.match(p.elements.remote.textContent,/连接暂时中断/);assert.ok(!p.elements.remote.textContent.includes('网络暂时断开'));
 }
});
