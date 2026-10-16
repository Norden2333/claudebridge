// Local, bounded metadata feed. No file bodies, account data or model requests.
(function () {
  let state={local:'missing',folder:'',allowWrites:false,relay:'idle',relayEnabled:false}, scope='', entries=[], alert=null, sequence=0, localWasReady=false, remoteWasReady=false;
  const clean=value=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,160):'';
  const others=new Map();let saveQueue=Promise.resolve(), changed=()=>{};
  const persist=()=>{ const value={scope,entries,sequence,localWasReady,remoteWasReady,alert,others:[...others].slice(-10)}; saveQueue=saveQueue.then(()=>chrome.storage.session.set({cfbMonitor:value})).catch(()=>{}); };
  let notice=null;const snapshot=()=>({notice:notice&&(!notice.scope||notice.scope===scope)&&Date.now()<notice.until?{message:notice.message}:null,state:{...state},entries:entries.map(e=>({...e,paths:[...e.paths]})),alert:alert?{...alert}:null});
  const update=()=>{changed(snapshot());persist();};
  function observe(s) {
    const before=JSON.stringify({state,scope,alert});
    if(s.scope && scope && s.scope!==scope){others.set(scope,entries);entries=others.get(s.scope)||[];others.delete(s.scope);while(others.size>10)others.delete(others.keys().next().value);alert=null;localWasReady=false;remoteWasReady=false;}
    if(s.scope)scope=s.scope;
    state={sessionId:s.sessionId||'',paused:!!s.paused,local:s.local||'missing',folder:s.config?.folder?clean(s.config.folder.split(/[\\/]/).filter(Boolean).pop()):state.folder,allowWrites:s.config?!!s.config.allowWrites:state.allowWrites,relay:s.relay?.status||'idle',relayPhase:['idle','connecting','online','retry_wait','retiring','attention'].includes(s.relay?.phase)?s.relay.phase:'idle',retryInSeconds:Number.isSafeInteger(s.relay?.retryInSeconds)?Math.max(0,Math.min(300,s.relay.retryInSeconds)):0,relayReason:['identity_unavailable','no_proxy_found','proxy_unreachable','service_unreachable','auth_timeout','auth_denied','channel_timeout','connection_lost','previous_device_still_running','folder_unavailable'].includes(s.relay?.reason)?s.relay.reason:'',relayRoute:s.relay?.route?.kind==='proxy'&&typeof s.relay.route.proxy==='string'&&/^https?:\/\/(127\.0\.0\.1|\[::1\]):[0-9]+$|^socks5h?:\/\/(127\.0\.0\.1|\[::1\]):[0-9]+$/.test(s.relay.route.proxy)?{kind:'proxy',proxy:s.relay.route.proxy,source:s.relay.route.source}:s.relay?.route?.kind==='system'?{kind:'system'}:null,pendingResults:Number.isInteger(s.relay?.resultDelivery?.pending)?Math.max(0,Math.min(32,s.relay.resultDelivery.pending)):0,resultDeliveryUnconfirmed:s.relay?.resultDelivery?.unconfirmed===true,relayEnabled:s.config?!!s.config.relayEnabled:state.relayEnabled};
    const localLost=!['previous_closing','host_busy'].includes(state.local)&&(state.local==='unavailable'||localWasReady && !['ready','idle'].includes(state.local));
    const remoteLost=remoteWasReady && state.relayEnabled && state.relay!=='online';
    if(!state.relayEnabled)remoteWasReady=false;
    if(localLost || remoteLost) {
      const kind=localLost?'local':'cowork';
      const message=kind==='local'?(state.local==='unavailable'?'工作文件夹目前不可用，请重新选择或接回原磁盘':'本机连接已断开，正在尝试恢复'):state.relay==='auth_required'?'Cowork 需要重新验证设备，请打开连接设置':state.relay==='blocked'?(state.relayReason==='identity_unavailable'?'Cowork 登录记录需要检查，原设备记录已保留':'Cowork 网络设置需要处理，请打开连接设置'):'Cowork 已断连，正在自动重连';
      if(!alert?.active || (kind==='local' && alert.kind!=='local'))alert={id:++sequence,kind,active:true,time:Date.now(),message};else alert.message=message;
    } else if(alert?.active && ((alert.kind==='local'&&state.local==='ready') || (alert.kind==='cowork'&&(state.relay==='online'||!state.relayEnabled)))) alert={...alert,active:false,message:'连接已恢复',time:Date.now()};
    if(state.local==='ready')localWasReady=true;
    if(state.relay==='online')remoteWasReady=true;
    if(state.local==='idle'){localWasReady=false;remoteWasReady=false;alert=null;}
    if(before!==JSON.stringify({state,scope,alert}))update();
  }
  function record(e,notify=true) {
    if(!e || typeof e.id!=='string' || e.id.length>100 || typeof e.scope!=='string' || e.scope.length>100 || !['queued','running','completed','replayed','partial','failed','unknown','conflict','paused','interrupted','rejected'].includes(e.state))return;
    if(!scope && e.scope)scope=e.scope;
    const item={id:e.id,operationId:clean(e.operationId).slice(0,100),kind:clean(e.kind),channel:['chat','cowork','download'].includes(e.channel)?e.channel:'chat',paths:Array.isArray(e.paths)?e.paths.filter(p=>typeof p==='string'&&!/^(?:[a-z]:|\/|\\|\.\.(?:\/|\\|$))/i.test(p)).slice(0,3).map(clean):[],state:e.state,time:Number.isFinite(e.time)?e.time:Date.now(),elapsed:Number.isFinite(e.elapsed)?e.elapsed:0,...(Number.isInteger(e.count)?{count:Math.min(64,e.count)}:{}),...(Number.isInteger(e.completed)?{completed:e.completed}:{}),...(e.permanent?{permanent:true}:{}),...(e.recycled?{recycled:true}:{}),...(e.verified?{verified:true}:{}),...(e.backupWarning===true?{backupWarning:true}:{}),...(e.skipped===true?{skipped:true}:{}),...(e.alreadySaved===true?{alreadySaved:true}:{}),...(Number.isSafeInteger(e.receivedBytes)&&e.receivedBytes>=0&&e.receivedBytes<=4*1024**3?{receivedBytes:e.receivedBytes}:{}),...(Number.isSafeInteger(e.totalBytes)&&e.totalBytes>=0&&e.totalBytes<=4*1024**3?{totalBytes:e.totalBytes}:{}),...(e.committing===true?{committing:true}:{}),...(e.autoSaveBlocked===true?{autoSaveBlocked:true,autoSaveReason:clean(e.autoSaveReason)}:{})};
    const list=e.scope===scope?entries:(others.get(e.scope)||[]);const index=list.findIndex(x=>x.id===item.id);if(index>=0){if(list[index].time>item.time)return;list[index]=item;}else list.unshift(item);if(e.scope===scope)entries=list.slice(0,30);else{others.set(e.scope,list.slice(0,30));while(others.size>10)others.delete(others.keys().next().value);}if(notify)update();
  }
  function unknown(channel) {let any=false;entries=entries.map(e=>{if(['running','queued'].includes(e.state)&&(!channel||e.channel===channel)){any=true;return {...e,state:'unknown',time:Date.now()};}return e;});for(const [key,list] of others)others.set(key,list.map(e=>{if(['running','queued'].includes(e.state)&&(!channel||e.channel===channel)){any=true;return {...e,state:'unknown',time:Date.now()};}return e;}));if(any)update();}
  function reconcile(selected,items){
    if(typeof selected!=='string'||!Array.isArray(items))return;
    const outcomes=new Map(items.filter(r=>r&&typeof r.operationId==='string').map(r=>[r.operationId,r]));let changedAny=false;
    const list=selected===scope?entries:others.get(selected)||[];
    const next=list.map(e=>{const r=outcomes.get(e.operationId||e.id);if(!r||!['completed','rejected'].includes(r.status))return e;
      if(['queued','running'].includes(e.state))return e;
      const result=r.result||{};if(result.conflict||result.failedIndex!==undefined)return e;
      const updated={...e,state:r.status==='completed'?'completed':'rejected',verified:result.verified===true,skipped:result.skipped===true,alreadySaved:result.alreadySaved===true,autoSaveBlocked:false};
      if(JSON.stringify(updated)!==JSON.stringify(e))changedAny=true;return updated;
    });
    if(changedAny){if(selected===scope)entries=next;else others.set(selected,next);update();}
  }
  self.CFB_MONITOR={notice(message,selected){notice={message:clean(message),scope:selected||scope,until:Date.now()+120000};update();},observe,record,unknown,reconcile,snapshot,snapshotFor(selected){const value=snapshot();value.notice=notice&&notice.scope===(selected||scope)&&Date.now()<notice.until?{message:notice.message}:null;if(selected&&selected!==scope)value.entries=(others.get(selected)||[]).map(e=>({...e,paths:[...e.paths]}));return value;},clear(selected){if(selected&&selected!==scope)others.delete(selected);else entries=[];update();},subscribe(fn){changed=fn;}};
  // Session storage is extension-private by default; it is not shared with page scripts.
  void chrome.storage.session.get('cfbMonitor').then(saved=>{
    const value=saved.cfbMonitor;if(!value || !Array.isArray(value.entries) || (scope && scope!==value.scope))return;
    scope=value.scope||'';localWasReady ||=value.localWasReady===true;remoteWasReady ||=value.remoteWasReady===true;if(!alert&&value.alert?.active&&Number.isInteger(value.alert.id))alert={id:value.alert.id,active:true,kind:value.alert.kind==='cowork'?'cowork':'local',time:Number.isSafeInteger(value.alert.time)&&value.alert.time>0&&value.alert.time<=Date.now()?value.alert.time:Date.now(),message:clean(value.alert.message)};if(Array.isArray(value.others))for(const [key,list] of value.others.slice(-10)){if(typeof key!=='string'||!Array.isArray(list)||key===scope)continue;for(const entry of list.slice(0,30).reverse())record({...entry,scope:key,state:['queued','running'].includes(entry.state)?'unknown':entry.state},false);}
    sequence=Math.max(sequence,Number.isInteger(value.sequence)?value.sequence:0);
    for(const entry of value.entries.slice(0,30).reverse()){if(entries.some(e=>e.id===entry.id))continue;record({...entry,scope,state:['queued','running'].includes(entry.state)?'unknown':entry.state},false);}
    entries.sort((a,b)=>b.time-a.time);entries=entries.slice(0,30);update();
  }).catch(()=>{});
})();
