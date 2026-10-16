importScripts('downloads.js', 'batch-downloads.js', 'monitor.js', 'bindings.js', 'notices.js');
const EXTENSION_BUILD_VERSION='0.6.0';
let settingsSaveChain=Promise.resolve();let dataConsent=false,consentLoaded=false,autoSaveEnabled=false,keepCoworkOnline=true,backgroundCowork=false;const assetOwners=new Map(),assetResults=new Map();
const consentReady=Promise.resolve().then(async()=>{try{const r=await chrome.storage.local.get(['cfbDataConsent','cfbAutoSave','cfbKeepCoworkOnline','cfbSettingsSavePending']);autoSaveEnabled=r.cfbAutoSave===true;keepCoworkOnline=r.cfbKeepCoworkOnline!==false;dataConsent=r.cfbDataConsent?.version===1&&r.cfbDataConsent?.accepted===true;if(r.cfbSettingsSavePending===true){dataConsent=false;autoSaveEnabled=false;keepCoworkOnline=false;}}catch{dataConsent=false;}consentLoaded=true;});
const assetQueues=new Map();let assetOwnerSave=Promise.resolve(),assetOwnerError=null;
const assetOwnerReady=Promise.resolve().then(async()=>{
 if(!chrome.storage.session)return;
 const saved=(await chrome.storage.session.get('cfbAssetOwners')).cfbAssetOwners;
 if(!Array.isArray(saved))return;
 for(const entry of saved.slice(-200)){if(!Array.isArray(entry)||entry.length!==2)continue;const [id,o]=entry;if(typeof id==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(id)&&o&&Number.isInteger(o.tabId)&&typeof o.route==='string'&&typeof o.scope==='string'&&typeof o.documentId==='string')assetOwners.set(id,o);}
}).catch(()=>{assetOwnerError='成果记录无法读取，停止自动保存；请先核对之前的操作。';});
const saveAssetOwners=()=>{const next=assetOwnerSave.catch(()=>{}).then(()=>chrome.storage.session?.set({cfbAssetOwners:[...assetOwners]})||Promise.resolve());assetOwnerSave=next;return next;};
const assetRoute=sender=>new URL(sender.url).pathname;
const consentError='请先打开扩展设置，阅读数据说明并勾选同意；文件操作尚未开始。';
const consentAllows=(action,values)=>dataConsent||['status','diagnostics','setup_status','configure','pick_folder','revoke_folder','profile_status','recent_folders','asset_abort'].includes(action)||(action==='active'&&values.value===false);
const uiStatus=()=>({...latest,dataConsentGranted:dataConsent,autoSaveEnabled,keepCoworkOnline,backgroundCowork,extensionBuildVersion:EXTENSION_BUILD_VERSION});
const safeMonitor=()=>({state:{local:'consent_required',relay:'idle'},entries:[],alert:{id:'consent-required',active:true,message:consentError}});
const HOST = 'local.claude_folder_bridge';
let hostDescriptor=null;
let native = null, latest = { local: 'missing', relay: { status: 'idle' } }, active = false;
const waiting = new Map(), clients = new Set(), monitors = new Set();
let operation = Promise.resolve(),handoffChain=Promise.resolve(),generation=0;
let reconnectTimer = null, reconnectAttempt = 0, reconnectAt = 0, connectedAt = null;
function clearReconnect() { if (reconnectTimer !== null) clearTimeout(reconnectTimer); reconnectTimer = null; }
function retryConnection() {
  if ((!active && !clients.size) || reconnectTimer !== null) return;
  const delay = [1000, 2000, 5000, 10000, 30000, 60000][Math.min(reconnectAttempt++, 5)];
  reconnectAt = Date.now() + delay;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; schedule(); }, delay);
  reconnectTimer?.unref?.();
}
const isUI = sender => {try{const u=new URL(sender.url);return sender.id===chrome.runtime.id&&u.protocol==='chrome-extension:'&&u.hostname===chrome.runtime.id&&['/options.html','/popup.html','/workspace.html','/onboarding.html'].includes(u.pathname);}catch{return false;}};
const isClaude = sender => { try { const u = new URL(sender.url); return sender.id === chrome.runtime.id && u.origin === 'https://claude.ai' && !!sender.tab; } catch { return false; } };
const publicStatus = () => !dataConsent ? {local:'consent_required',relay:'idle',folder:'',allowWrites:false} : ({ paused:!!latest.paused,local: latest.local, folder: latest.config?.folder?.split(/[\\/]/).pop() || '', allowWrites: !!latest.config?.allowWrites, relay: latest.relay?.status || 'idle' });
let assetReadinessKey=null;
function broadcast() {
  const nextAssetKey=JSON.stringify([dataConsent,autoSaveEnabled,latest.local,latest.paused,latest.scope,latest.config?.allowWrites]);
  if(nextAssetKey!==assetReadinessKey){assetReadinessKey=nextAssetKey;void chrome.tabs.query({url:'https://claude.ai/*'}).then(tabs=>{if(typeof chrome.tabs.sendMessage!=='function')return;for(const t of tabs)void chrome.tabs.sendMessage(t.id,{action:'asset_settings_changed'}).catch(()=>{});}).catch(()=>{});}
  self.CFB_MONITOR?.observe(latest);
  for (const c of clients) try { c.postMessage(uiStatus()); } catch {}
  const ready = dataConsent && latest.local === 'ready';
  void chrome.action.setBadgeText({ text: ready ? (latest.relay?.status === 'online' ? 'ON' : 'FS') : '!' });
  if(chrome.action.setTitle)void chrome.action.setTitle({title:backgroundCowork?'Claude 文件连接 · Cowork 后台'+(latest.relay?.status==='online'?'在线':'连接中'):'Claude 文件连接'});
  void chrome.action.setBadgeBackgroundColor({ color: ready ? '#31785a' : '#a75b30' });
}
const monitorBroadcast = snapshot => { self.CFB_NOTICES?.observe(snapshot); for(const port of monitors){if(!dataConsent){try{port.postMessage(safeMonitor());}catch{}continue;}void Promise.resolve(self.CFB_BINDINGS?.info(port.sender,latest)).then(binding=>{try{port.postMessage(dataConsent?(self.CFB_MONITOR?.snapshotFor(binding?.scope)||snapshot):safeMonitor());}catch{}}).catch(()=>{});} };
self.CFB_MONITOR?.subscribe(monitorBroadcast);
function connect() {
  if (native) return native;
  clearReconnect();
  const port = chrome.runtime.connectNative(HOST); native = port; hostDescriptor=null; connectedAt = null;
  port.onMessage.addListener(message => {
    if (native !== port) return;
    if(message.event==='activity'){self.CFB_NOTICES?.record(message.activity);self.CFB_MONITOR?.record(message.activity);return;}
    if(message.event==='activity_channel_closed'){self.CFB_MONITOR?.unknown(message.channel);return;}
    if (message.event === 'status') { connectedAt ??= Date.now(); hostDescriptor=message; latest = message;const v=chrome.runtime.getManifest?.().version;if(v&&(message.version!==v||message.nativeProtocol!==1))latest={...message,local:'incompatible',error:'插件与本机程序版本不匹配，操作未开始。请更新后重新加载扩展。'};broadcast(); }
    if (message.id && waiting.has(message.id)) {
      const job = waiting.get(message.id); waiting.delete(message.id); clearTimeout(job.timer);
      if(message.ok&&job.action==='status')hostDescriptor=message.result;
      if (message.ok) job.resolve(message.result); else job.reject(Object.assign(new Error(message.error||'本机操作失败。'),{code:message.errorCode||null}));
    }
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message;
    if (native !== port) return;
    self.CFB_MONITOR?.unknown();
    if (connectedAt !== null && Date.now() - connectedAt >= 60000) reconnectAttempt = 0;
    connectedAt = null;
    generation++;native = null; const busy=latest.local==='host_busy';latest = { local: busy?'host_busy':'missing', relay: { status: 'idle' }, error:busy?'连接锁仍被占用，请核对其他测试窗口或稍后重试；未强制结束原连接。':error?'本机连接程序不可用，请检查安装；原因尚未确定。':'连接已停止。' };
    for (const job of waiting.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(['tool','import_download'].includes(job.action) ? `连接中断，操作结果未知。操作编号：${job.operationId}。恢复后先查询结果，不要重复写入或删除。` : latest.error));
    }
    waiting.clear(); broadcast(); retryConnection();
  });
  return port;
}
function rejectPending(message) {
  for (const job of waiting.values()) { clearTimeout(job.timer); job.reject(Object.assign(new Error(message),{code:'CFB_DISCONNECTED'})); }
  waiting.clear();
}
function operationIdentifier(action, values, fallback) {
  let id=values.args?.operation_id || values.operationId || fallback;
  if(action==='tool' && values.name==='write_file' && typeof values.args?.content==='string')try{const p=JSON.parse(values.args.content);if(p.protocol==='claude-folder-operation/v1'&&p.operationId)id=p.operationId;}catch{}
  return id;
}
function request(action, values = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID(), operationId = operationIdentifier(action,values,id);
    const timer = setTimeout(() => { waiting.delete(id); reject(Object.assign(new Error('本机操作超时，结果未知；操作编号：'+operationId+'。先查询目标状态，不要直接重试写入或整批操作。'),{code:'CFB_TIMEOUT'})); }, ['status','active'].includes(action) ? 75000 : action === 'pick_folder' ? 125000 : ['configure','revoke_folder','relay_reauthorize','relay_reregister','privacy_purge'].includes(action) ? 1500000 : ['asset_finish','tool','import_download','workspace_restore','workspace_conflict','workspace_diff','workspace_backup_export','workspace_backup_archive','workspace_backup_unarchive','workspace_backup_trash','workspace_backups','workspace_undo_plan','workspace_undo_apply','workspace_protection_set','setup_check'].includes(action) ? 1320000 : 30000);
    waiting.set(id, { resolve, reject, timer, action, operationId });
    let port;try{port=connect();}catch(e){clearTimeout(timer);waiting.delete(id);reject(e);return;}
    Promise.resolve().then(async()=>{
      await consentReady;
      if(!consentAllows(action,values))throw new Error(consentError);
      const clientVersion=chrome.runtime.getManifest?.().version||'';
      const recovery=['status','diagnostics','setup_status','profile_status','recent_folders','operation_status','asset_status','asset_abort'].includes(action)||(action==='active'&&values.value===false);
      if(clientVersion&&!recovery){
        const descriptor=hostDescriptor||await request('status');
        if(descriptor?.version!==clientVersion||descriptor?.nativeProtocol!==1){
          latest={...latest,local:'incompatible',error:'插件与本机程序版本不匹配，操作未开始。请更新到同一版本，再重新加载扩展。'};broadcast();
          throw new Error(latest.error);
        }
      }
      if(native!==port||!waiting.has(id))throw new Error('连接已改变，操作未发送。请重新核对状态。');
      if(!consentAllows(action,values))throw new Error(consentError);
      port.postMessage({...values,id,action,operationId,clientVersion,nativeProtocol:1});
    }).catch(e=>{clearTimeout(timer);waiting.delete(id);reject(e);});
  });
}
async function reconcile() {
  const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  await consentReady;
  if(dataConsent&&keepCoworkOnline&&!tabs.length&&!hostDescriptor&&Date.now()>=reconnectAt)try{latest={...latest,...await request('status')};}catch{retryConnection();return;}
  backgroundCowork=dataConsent&&keepCoworkOnline&&!tabs.length&&latest.config?.relayEnabled===true;
  active = dataConsent && (tabs.length > 0 || backgroundCowork);
  if (!active && !clients.size) {
    clearReconnect(); reconnectAt = 0; reconnectAttempt = 0; connectedAt = null;
    void self.CFB_BATCH_DOWNLOADS?.finish();
    if (native) { const old = native; native = null; old.disconnect(); }
    rejectPending('Claude 标签页已关闭，连接已停止。');
    latest = { local: 'idle', relay: { status: 'idle' } }; broadcast(); return;
  }
  if (!native && Date.now() < reconnectAt) return;
  try { await request('active', { value: active }); } catch {if(latest.local==='incompatible')clearReconnect();else retryConnection();}
}
self.CFB_NATIVE_REQUEST = request;
const schedule = () => { operation = operation.then(reconcile).catch(() => {}); };
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change?.url)void self.CFB_BINDINGS?.navigation(tabId,change.url).catch(()=>{});schedule();});
chrome.tabs.onRemoved.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.runtime.onInstalled.addListener(details=>{schedule();if(details?.reason==='install')void chrome.tabs.create({url:chrome.runtime.getURL('onboarding.html')});});
chrome.alarms.create('connection-retry', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(schedule);
chrome.runtime.onConnect.addListener(port => {
  if(port.name==='monitor' && isClaude(port.sender)){monitors.add(port);port.postMessage(dataConsent?(self.CFB_MONITOR?.snapshot()||{state:publicStatus(),entries:[],alert:null}):safeMonitor());port.onDisconnect.addListener(()=>{monitors.delete(port);});return;}
  if (port.name !== 'settings' || !isUI(port.sender)) return;
  clients.add(port); port.postMessage(uiStatus()); schedule();
  port.onDisconnect.addListener(() => { clients.delete(port); schedule(); });
});
function handleMessage(message, sender, reply) {
  const ui = isUI(sender), page = isClaude(sender);
  if ((!ui && !page) || !message || typeof message.action !== 'string') return false;
  if(['privacy_usage','privacy_purge'].includes(message.action)){
    const path=new URL(sender.url).pathname;if(!ui||!['/workspace.html','/options.html'].includes(path)||message.action==='privacy_purge'&&message.confirm!==true){reply({ok:false,error:'仅工作台或设置页明确确认后可清除私有数据。'});return false;}
    request(message.action,message.action==='privacy_purge'?{categories:message.categories,confirm:true}:{}).then(result=>reply({ok:true,result}),e=>reply({ok:false,error:e.message,errorCode:e.code||null}));return true;
  }
  if(message.action==='save_settings'){
    if(!ui||!sender.url.endsWith('/options.html')||message.accepted!==true||typeof message.autoSave!=='boolean'||typeof message.keepCoworkOnline!=='boolean'){reply({ok:false,error:'仅设置页可完整保存设置并确认数据说明。'});return false;}
    const save=async()=>{
      await consentReady;const keys=['cfbDataConsent','cfbAutoSave','cfbKeepCoworkOnline','cfbSettingsSavePending'];const previous=await chrome.storage.local.get(keys);const old={dataConsent,autoSaveEnabled,keepCoworkOnline};
      await chrome.storage.local.set({cfbSettingsSavePending:true});let host;
      try{host=await request('configure',{config:message.config});}catch(e){if(e.code==='CFB_BROAD_FOLDER')await chrome.storage.local.remove('cfbSettingsSavePending');else{dataConsent=false;autoSaveEnabled=false;keepCoworkOnline=false;await request('active',{value:false}).catch(()=>{});broadcast();}throw e;}latest={...latest,...host};
      try{await chrome.storage.local.set({cfbDataConsent:{version:1,accepted:true},cfbAutoSave:message.autoSave,cfbKeepCoworkOnline:message.keepCoworkOnline,cfbSettingsSavePending:null});}
      catch(error){
        let restored=false;try{const present={};for(const key of keys)if(previous[key]!==undefined)present[key]=previous[key];await chrome.storage.local.set(present);const absent=keys.filter(key=>previous[key]===undefined);if(absent.length)await chrome.storage.local.remove(absent);const actual=await chrome.storage.local.get(keys);restored=keys.every(key=>JSON.stringify(actual[key])===JSON.stringify(previous[key]));}catch{}
        dataConsent=restored?old.dataConsent:false;autoSaveEnabled=restored?old.autoSaveEnabled:false;keepCoworkOnline=restored?old.keepCoworkOnline:false;
        if(!restored)await request('active',{value:false}).catch(()=>{});broadcast();schedule();
        reply({ok:false,error:restored?'本机文件夹和权限已保存；扩展偏好保存失败，已恢复原扩展偏好。请核对后再保存。':'本机文件夹和权限已保存；扩展偏好恢复未确认，已暂停新操作。请核对设置，不要当作全部保存成功。',errorCode:'CFB_EXTENSION_SETTINGS_FAILED',hostSettingsSaved:true,result:uiStatus()});return;
      }
      dataConsent=true;autoSaveEnabled=message.autoSave;keepCoworkOnline=message.keepCoworkOnline;broadcast();schedule();reply({ok:true,result:uiStatus()});
    };
    const job=settingsSaveChain.catch(()=>{}).then(save);settingsSaveChain=job;void job.catch(e=>reply({ok:false,error:e.message,errorCode:e.code||null}));return true;
  }
  if(message.action==='consent_update'){
    if(!ui||!sender.url.endsWith('/options.html')||typeof message.accepted!=='boolean'){reply({ok:false,error:'仅设置页可以确认数据说明。'});return false;}
    consentReady.then(async()=>{await chrome.storage.local.set({cfbDataConsent:{version:1,accepted:message.accepted}});dataConsent=message.accepted;if(!dataConsent){void self.CFB_DOWNLOADS?.cancel();void self.CFB_BATCH_DOWNLOADS?.finish();await request('active',{value:false});}broadcast();schedule();reply({ok:true,result:uiStatus()});}).catch(e=>reply({ok:false,error:e.message}));return true;
  }
  if(page&&!['status','open_settings','asset_abort'].includes(message.action)&&!dataConsent){reply({ok:false,error:consentError});return false;}
  if(ui&&['arm_download','retry_download','batch_arm','batch_check'].includes(message.action)&&!dataConsent){reply({ok:false,error:consentError});return false;}
  if(['relay_reauthorize','relay_reregister'].includes(message.action)){
    if(!ui||!sender.url.endsWith('/options.html')||message.confirm!==true){reply({ok:false,error:'仅设置页明确确认后可恢复设备。'});return false;}
    request(message.action,{confirm:true}).then(result=>{schedule();reply({ok:true,result});},e=>reply({ok:false,error:e.message}));return true;
  }
  if(ui&&message.action==='cowork_background_set'){
    if(!sender.url.endsWith('/options.html')||typeof message.enabled!=='boolean'){reply({ok:false,error:'请在设置页选择 Cowork 后台在线。'});return false;}
    chrome.storage.local.set({cfbKeepCoworkOnline:message.enabled}).then(()=>{keepCoworkOnline=message.enabled;schedule();broadcast();reply({ok:true,result:uiStatus()});}).catch(e=>reply({ok:false,error:e.message}));return true;
  }
  if(ui&&message.action==='asset_auto_set'){
    if(!sender.url.endsWith('/options.html')||typeof message.enabled!=='boolean'){reply({ok:false,error:'请在设置页选择自动保存。'});return false;}
    chrome.storage.local.set({cfbAutoSave:message.enabled}).then(()=>{autoSaveEnabled=message.enabled;broadcast();reply({ok:true,result:uiStatus()});}).catch(e=>reply({ok:false,error:e.message}));return true;
  }
  if(page&&message.action==='asset_auto_status'){
    Promise.resolve().then(async()=>{const binding=await self.CFB_BINDINGS?.info(sender,latest);const profile=binding?.scope&&binding.scope!==latest.scope?await request('profile_status',{scope:binding.scope}):latest.config;return {enabled:dataConsent&&autoSaveEnabled&&latest.local==='ready'&&!latest.paused&&profile?.allowWrites===true};}).then(result=>reply({ok:true,result}),()=>reply({ok:true,result:{enabled:false}}));return true;
  }
  if(page&&['asset_begin','asset_chunk','asset_finish','asset_abort','asset_status','asset_precheck'].includes(message.action)){
    const recovery=['asset_status','asset_abort'].includes(message.action);
    if((!dataConsent&&message.action!=='asset_abort')||(!autoSaveEnabled&&!recovery)){reply({ok:false,error:'自动保存未启用。',errorCode:'CFB_ASSET_DISABLED'});return false;}
    const id=message.operationId;if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(id)){reply({ok:false,error:'成果编号无效。'});return false;}
    const perform=async()=>{
      await assetOwnerReady;
      if(!recovery&&(!dataConsent||!autoSaveEnabled))throw new Error('自动保存已关闭，未继续写入。');
      if(assetOwnerError)throw new Error(assetOwnerError);
      if(sender.frameId!==undefined&&sender.frameId!==0)throw new Error('仅当前对话主页面可以保存成果。');
      if(message.action==='asset_precheck'){
        const scope=await self.CFB_BINDINGS?.scope?.(sender,latest);
        if(!scope)throw new Error('当前对话文件夹未确认');
        return request('asset_precheck',{scope,assetKey:message.assetKey,name:message.name,sha256:message.sha256,bytes:message.bytes});
      }
      let owner=assetOwners.get(id);
      if(message.action==='asset_begin'){
        if(owner)throw new Error('成果编号已有记录，请先查询，不重复保存。');
        if(assetOwners.size>=200){for(const [key,value] of assetOwners)if(value.completed)assetOwners.delete(key);}
        if(assetOwners.size>=200)throw new Error('未核对的成果记录较多，请先在工作台核对。');
        const savedScope=await self.CFB_BINDINGS?.scope?.(sender,latest);
        const binding=savedScope?{scope:savedScope}:await self.CFB_BINDINGS?.info(sender,latest);
        owner={tabId:sender.tab.id,route:assetRoute(sender),documentId:sender.documentId||'',scope:binding?.scope||latest.scope,completed:false};
        if(!owner.scope)throw new Error('当前对话文件夹未确认');
        assetOwners.set(id,owner);
        try{await saveAssetOwners();}catch(e){assetOwners.delete(id);throw e;}
      }
      if(!owner||owner.tabId!==sender.tab.id||owner.route!==assetRoute(sender)||(!recovery&&owner.documentId!==(sender.documentId||'')))throw new Error('成果传输不属于此页面；只允许原对话核对结果。');
      const allowed=message.action==='asset_begin'?{name:message.name,assetKey:message.assetKey,...(message.relativeDir!==undefined?{relativeDir:message.relativeDir}:{}),...(message.expectedBytes!==undefined?{expectedBytes:message.expectedBytes}:{})}:message.action==='asset_chunk'?{sequence:message.sequence,data:message.data,sha256:message.sha256}:{};
      const result=await request(message.action,{...allowed,operationId:id,scope:owner.scope});
      if(message.action==='asset_finish'||message.action==='asset_status'&&result.status==='completed'){
        const receipt=message.action==='asset_status'?result.result:result;
        assetResults.set(id,{tabId:owner.tabId,scope:owner.scope,result:receipt});if(assetResults.size>100)assetResults.delete(assetResults.keys().next().value);
        owner.completed=true;await saveAssetOwners();
      }
      if(message.action==='asset_abort'&&result.aborted){assetOwners.delete(id);await saveAssetOwners();}
      return result;
    };
    const queue=message.action==='asset_status'||message.action==='asset_abort'?perform():(assetQueues.get(id)||Promise.resolve()).catch(()=>{}).then(perform);
    if(!recovery)assetQueues.set(id,queue);void queue.finally(()=>{if(assetQueues.get(id)===queue)assetQueues.delete(id);}).catch(()=>{});
    queue.then(result=>reply({ok:true,result}),e=>reply({ok:false,error:e.message,errorCode:e.code||null}));return true;
  }
  if(page&&message.action==='asset_detection_notice'){if(dataConsent&&autoSaveEnabled)self.CFB_MONITOR?.notice((typeof message.name==='string'?message.name.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,100)+'：':'')+'有一个文件卡片未自动保存，当前页面可能不兼容。请使用原下载按钮，或打开“更多”中的备用下载保存。');reply({ok:true});return false;}
  if(page&&message.action==='asset_download_notice'){if(typeof message.name==='string'&&!/[:\\/\x00-\x1f]/.test(message.name))self.CFB_MONITOR?.notice('已拦截一次延迟下载：'+message.name.slice(0,100)+'。如需原下载，请再点一次。');reply({ok:true});return false;}
  if(page&&message.action==='asset_ui_result'){
    const summary=message.summary||{},trusted=assetResults.get(summary.operationId);if(trusted&&trusted.tabId===sender.tab.id){const r=trusted.result;self.CFB_MONITOR?.record({id:summary.operationId,operationId:summary.operationId,scope:trusted.scope,kind:'import_download',channel:'download',paths:[r.path||''],state:r.conflict?'conflict':'completed',time:Date.now(),verified:r.verified===true,skipped:r.skipped===true,alreadySaved:r.alreadySaved===true});assetResults.delete(summary.operationId);}else if(summary.phase==='error'){self.CFB_MONITOR?.record({id:summary.operationId,operationId:summary.operationId,scope:latest.scope,kind:'import_download',channel:'download',paths:typeof summary.name==='string'&&!/[:\\/]/.test(summary.name)?[summary.name.slice(0,160)]:[],state:summary.execution==='not_started'&&!assetOwners.has(summary.operationId)?'failed':'unknown',autoSaveBlocked:summary.autoSaveBlocked===true,autoSaveReason:({CFB_ASSET_NAME:'文件名需要处理',CFB_ASSET_LIMIT:'超过接收上限',CFB_ASSET_DISABLED:'自动保存或修改权限已关闭',CFB_PAUSED:'文件操作已暂停',CFB_DISCONNECTED:'连接中断',CFB_TIMEOUT:'等待超时'})[summary.errorCode]||'导出或连接未完成，请核对原编号',time:Date.now()});}reply({ok:true});return false;
  }
  if(ui&&message.action==='diagnostics'){
    const v=chrome.runtime.getManifest?.().version;
    const extensionVersion=typeof v==='string'&&/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(v)?v:'unknown';
    request('diagnostics').then(host=>reply({ok:true,result:{schema:'claude-folder-support/v1',extensionVersion,host}}),()=>reply({ok:true,result:{schema:'claude-folder-support/v1',extensionVersion,host:null,hostAvailable:false}}));return true;
  }
  if(ui&&['setup_status','setup_check'].includes(message.action)){const {action,...values}=message;request(action,values).then(result=>reply({ok:true,result:action==='setup_status'?{...result,dataConsentGranted:dataConsent,autoSaveEnabled}:result}),e=>reply({ok:false,error:e.message}));return true;}
  if(page&&message.action==='handoff'){handoffChain=handoffChain.catch(()=>{}).then(async()=>{const binding=await self.CFB_BINDINGS?.info(sender,latest),seen=(await chrome.storage.session.get('cfbHandoffSeen')).cfbHandoffSeen||[],key=(latest.sessionId||'starting')+':'+(binding?.scope||'')+(message.wake?':wake:'+Math.floor(Date.now()/90000):'');if(seen.includes(key))return null;const result=await request('workspace_check',{scope:binding?.scope});self.CFB_MONITOR?.reconcile(binding?.scope||latest.scope,result.items);await chrome.storage.session.set({cfbHandoffSeen:[...seen,key].slice(-100)});return result.items.length?{summary:result.summary,count:result.items.length}:null;});handoffChain.then(result=>reply({ok:true,result}),e=>reply({ok:false,error:e.message}));return true;}
  if(page && message.action==='panel_action'){
    const allowed=['workspace_reveal','workspace_open','retry','pause_files'];if(!allowed.includes(message.name)){reply({ok:false,error:'这个入口只能执行明确的小窗动作。'});return false;}
    Promise.resolve(self.CFB_BINDINGS?.info(sender,latest)).then(binding=>request(message.name,{scope:binding?.scope,...(message.name==='pause_files'?{paused:message.paused}:message.name==='retry'?{}:{path:message.path||'.'})})).then(result=>reply({ok:true,result:['pause_files','retry'].includes(message.name)?publicStatus():result}),e=>reply({ok:false,error:e.message}));return true;
  }
  if(page && message.action==='open_workspace'){Promise.resolve(self.CFB_BINDINGS?.info(sender,latest)).then(binding=>chrome.tabs.create({url:chrome.runtime.getURL('workspace.html')+(binding?.scope?'?scope='+encodeURIComponent(binding.scope):'')})).then(()=>reply({ok:true}),e=>reply({ok:false,error:e.message}));return true;}
  if(page && ['binding_info','bind_conversation'].includes(message.action)){Promise.resolve(message.action==='bind_conversation'?self.CFB_BINDINGS?.scope(sender,latest,true):self.CFB_BINDINGS?.info(sender,latest)).then(async result=>{if(message.action==='binding_info'&&result?.scope){if(result.scope===latest.scope)result={...result,allowWrites:!!latest.config?.allowWrites};else result={...result,...await request('profile_status',{scope:result.scope})};}if(message.action==='binding_info'&&result?.scope)result={...result,currentFolder:latest.config?.folder?.split(/[\\/]/).filter(Boolean).pop()||'',differsFromCurrent:result.scope!==latest.scope,cowork:/^\/cowork\//.test(new URL(sender.url).pathname)};reply({ok:true,result});},e=>reply({ok:false,error:e.message})).catch(e=>reply({ok:false,error:e.message}));return true;}
  if(ui && ['batch_arm','batch_status','batch_finish','batch_check'].includes(message.action)){const method={batch_arm:'arm',batch_status:'status',batch_finish:'finish',batch_check:'check'}[message.action];Promise.resolve(self.CFB_BATCH_DOWNLOADS[method](message.options||{})).then(result=>reply({ok:true,result}),e=>reply({ok:false,error:e.message}));return true;}
  if(ui && ['workspace_recent','workspace_check','workspace_diff','workspace_restore','workspace_conflict','workspace_reveal','recent_folders','select_recent','revoke_folder','workspace_open','workspace_backups','workspace_backup_export','workspace_backup_archive','workspace_backup_unarchive','workspace_backup_trash','pause_files','profile_status','workspace_undo_plan','workspace_undo_apply','workspace_protection','workspace_protection_set','setup_check'].includes(message.action)){const {action,...values}=message;request(action,values).then(async result=>{if(action==='workspace_check')self.CFB_MONITOR?.reconcile(values.scope||latest.scope,result.items);reply({ok:true,result});if(action==='workspace_conflict'&&(['replace','keep_both'].includes(values.choice)&&result.verified||values.choice==='skip'&&result.skipped)){for(const tab of await chrome.tabs.query({url:'https://claude.ai/*'}))void chrome.tabs.sendMessage(tab.id,{action:'asset_conflict_resolved',operationId:values.originalId}).catch(()=>{});}},e=>reply({ok:false,error:e.message}));return true;}
  if(page && message.action==='monitor_clear'){if(self.CFB_BINDINGS){self.CFB_BINDINGS.info(sender,latest).then(binding=>{self.CFB_MONITOR?.clear(binding.scope);reply({ok:true});},e=>reply({ok:false,error:e.message}));return true;}self.CFB_MONITOR?.clear();reply({ok:true});return false;}
  if (message.action === 'status') { reply({ ok: true, result: ui ? uiStatus() : publicStatus() }); return false; }
  if (page && message.action === 'open_settings') { void chrome.runtime.openOptionsPage(); reply({ ok: true }); return false; }
  if (ui && ['arm_download','download_status','cancel_download','retry_download'].includes(message.action)) { const method = { arm_download: 'arm', download_status: 'status', cancel_download: 'cancel', retry_download: 'retry' }[message.action]; self.CFB_DOWNLOADS[method](method==='arm'?{scope:message.scope}:undefined).then(result => reply({ ok: true, result }), e => reply({ ok: false, error: e.message })); return true; }
  if (page && message.action !== 'tool') { reply({ ok: false, error: '网页不能更改连接设置。' }); return false; }
  if (!['tool', 'configure', 'pick_folder', 'retry'].includes(message.action) || (ui && message.action === 'tool')) { reply({ ok: false, error: '不允许的操作。' }); return false; }
  const values = message.action === 'tool' ? { name: message.name, args: message.args, operationId: message.operationId } : message.action === 'configure' ? { config: message.config } : {};
  if(message.action==='tool')values.operationId=operationIdentifier('tool',values,message.operationId || crypto.randomUUID());
  const startedGeneration=generation;
  Promise.resolve(message.action==='tool'?self.CFB_BINDINGS?.scope(sender,latest):undefined).then(scope=>{if(message.action==='tool'&&startedGeneration!==generation)throw new Error('连接中断，请核对后重试。操作编号：'+(values.operationId||''));return request(message.action,{...values,...(scope?{scope}:{})});}).then(result => reply({ ok: true, result }), e => reply({ ok: false, error: e.message }));
  return true;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(consentLoaded||message?.action==='status'||message?.action==='open_settings')return handleMessage(message,sender,reply);if(!isUI(sender)&&!isClaude(sender))return false;consentReady.then(()=>handleMessage(message,sender,reply)).catch(()=>reply({ok:false,error:consentError}));return true;});
consentReady.then(()=>{broadcast();schedule();});

chrome.commands?.onCommand.addListener(async name=>{if(name!=='toggle-monitor')return;const tabs=await chrome.tabs.query({active:true,currentWindow:true});const t=tabs[0];if(t?.id&&t.url?.startsWith('https://claude.ai/'))void chrome.tabs.sendMessage(t.id,{action:'toggle_monitor'}).catch(()=>{});});
