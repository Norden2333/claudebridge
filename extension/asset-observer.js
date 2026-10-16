(function(){
 const bridge=self.ClaudefsCore.bridge;
 let busy=false,enabled=false,scheduled=null,suspended=false,current=null,route=location.pathname,sweep=null;
 const seen=new Map(),blocked=new Map();
 const key=item=>item.route+'\n'+item.logicalPath;
 async function controls(){
  try{const r=await chrome.runtime.sendMessage({action:'asset_auto_status'});enabled=r?.ok===true&&r.result?.enabled===true;}catch{enabled=false;}
  return enabled;
 }
 bridge.onMessage('asset-detection-notice',m=>{if(enabled)void chrome.runtime.sendMessage({action:'asset_detection_notice',name:typeof m?.name==='string'?m.name.slice(0,160):''}).catch(()=>{});});
 bridge.onMessage('asset-download-notice',m=>{if(typeof m?.name==='string')void chrome.runtime.sendMessage({action:'asset_download_notice',name:m.name.slice(0,160)}).catch(()=>{});});
 bridge.onMessage('asset-transfer-request',async m=>{
  if(!m||typeof m.requestId!=='string'||!['asset_begin','asset_chunk','asset_finish','asset_status','asset_abort','asset_precheck'].includes(m.action))return;
  const message={};for(const field of ['requestId','action','operationId','assetKey','name','expectedBytes','sequence','data','sha256','bytes','relativeDir'])if(m[field]!==undefined)message[field]=m[field];
  try{const r=await chrome.runtime.sendMessage(message);bridge.send('asset-transfer-result',{requestId:m.requestId,...r});}
  catch{bridge.send('asset-transfer-result',{requestId:m.requestId,ok:false,error:'连接中断，请核对成果操作编号；未自动重复保存',errorCode:'CFB_DISCONNECTED'});}
 });
 bridge.onMessage('asset-list-result',m=>{
  if(suspended||busy||!enabled)return;
  const newest=new Map();
  for(const item of Array.isArray(m?.items)?m.items:[])if(typeof item.logicalPath==='string'&&item.route===location.pathname)newest.set(key(item),item);
  const item=[...newest.values()].find(i=>Number.isInteger(i.version)&&i.version>(seen.get(key(i))||0)&&(!blocked.has(key(i))||blocked.get(key(i)).execution!=='unknown'&&i.version>blocked.get(key(i)).version||Date.now()>=(blocked.get(key(i)).nextAt||Infinity)));
  if(!item)return;
  busy=true;current=item;bridge.send('asset-export-request',{slot:item.slot,route:item.route});
 });
 bridge.onMessage('asset-export-state',m=>{
  if(!current||m?.slot!==current.slot||!['saved','error','conflict'].includes(m.phase))return;
  busy=false;
  if(m.phase==='saved')seen.set(key(current),current.version);
  else{const old=blocked.get(key(current)),previous=old?.version===current.version?old:null,attempts=m.errorCode==='CFB_PAUSED'?(previous?.attempts||0):(previous?.attempts||0)+1,permanent=m.execution==='unknown'||m.phase==='conflict'||['CFB_ASSET_NAME','CFB_ASSET_LIMIT','CFB_ASSET_DISABLED'].includes(m.errorCode),delay=[5000,15000,60000,300000][Math.min(attempts-1,3)];blocked.set(key(current),{operationId:m.operationId,version:current.version,execution:m.execution,attempts,nextAt:permanent||m.errorCode==='CFB_PAUSED'||attempts>=5?Infinity:Date.now()+delay,errorCode:m.errorCode});}
  void chrome.runtime.sendMessage({action:'asset_ui_result',summary:{phase:m.phase,name:m.name,operationId:m.operationId,result:m.result,errorCode:m.errorCode,autoSaveBlocked:blocked.get(key(current))?.nextAt===Infinity,execution:m.execution}}).catch(()=>{});
  current=null;schedule();
 });
 function schedule(){
  if(suspended||scheduled!==null)return;
  scheduled=setTimeout(async()=>{
   scheduled=null;
   if(suspended||busy||!await controls()||suspended||busy)return;
   bridge.send('asset-list-request',{});
  },1500);
 }
 function navigation(){if(route===location.pathname)return;route=location.pathname;bridge.send('asset-export-cancel',{});schedule();}
 const observer=new MutationObserver(schedule);
 function observe(){observer.observe(document.documentElement,{childList:true,subtree:true});if(sweep===null&&window.setInterval)sweep=window.setInterval(()=>{if(enabled&&!document.hidden)schedule();},5000);schedule();}
 chrome.runtime.onMessage.addListener(m=>{if(m?.action==='asset_settings_changed'){for(const [key,failure]of blocked)if(failure.nextAt!==Infinity||['CFB_PAUSED','CFB_ASSET_DISABLED'].includes(failure.errorCode))blocked.delete(key);schedule();}if(m?.action==='asset_conflict_resolved'){for(const [k,value] of blocked)if(value.operationId===m.operationId)blocked.delete(k);schedule();}});
 window.navigation?.addEventListener('navigatesuccess',navigation);
 window.addEventListener('popstate',navigation);
 document.addEventListener?.('visibilitychange',()=>{if(!document.hidden)schedule();});
 window.addEventListener('pagehide',()=>{suspended=true;enabled=false;observer.disconnect();clearTimeout(scheduled);scheduled=null;if(sweep!==null){window.clearInterval(sweep);sweep=null;}bridge.send('asset-export-cancel',{});});
 window.addEventListener('pageshow',e=>{if(e.persisted){suspended=false;route=location.pathname;observe();}});
 observe();
})();
