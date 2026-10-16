// Explicit, time-limited task capture. Never watches old or unrelated downloads.
(function(){
  const key='cfbBatchDownload';let chain=Promise.resolve();const serial=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
  const load=async()=> (await chrome.storage.session.get(key))[key]||{status:'idle',items:[]};
  const save=async s=>chrome.storage.session.set({[key]:s});
  const origin=url=>{try{return new URL(url).origin==='https://claude.ai';}catch{return false;}};
  const api={
    async arm({subdirectory='',scope:chosenScope}={}) {
      const single=await self.CFB_DOWNLOADS?.status();if(single&&['armed','tracking','copying','unknown'].includes(single.status))throw new Error('单文件保存尚未结束。');
      const old=await load();if(['armed','copying'].includes(old.status)||old.items.some(x=>['tracking','copying','unknown'].includes(x.status)))throw new Error('先结束或核对上一批下载。');
      const s=await self.CFB_NATIVE_REQUEST('status');if(s.paused)throw new Error('文件操作已暂停。');const profile=chosenScope?await self.CFB_NATIVE_REQUEST('profile_status',{scope:chosenScope}):null;if(!(profile?profile.allowWrites:s.config?.allowWrites)||s.local!=='ready')throw new Error('请先选择文件夹并开启修改权限。');
      if(typeof subdirectory!=='string'||subdirectory.length>240||/^(?:[a-z]:|\/|\\)/i.test(subdirectory)||subdirectory.split(/[\\/]/).includes('..'))throw new Error('请选择工作文件夹内的相对子文件夹。');
      await self.CFB_NATIVE_REQUEST('workspace_validate_directory',{path:subdirectory||'.',...(chosenScope?{scope:chosenScope}:{})});
      const state={status:'armed',folder:profile?.folder||s.config.folder,scope:chosenScope||s.scope,fixedScope:!!chosenScope,subdirectory,startedAt:Date.now(),lastDownloadAt:Date.now(),expiresAt:Date.now()+30*60*1000,items:[]};await save(state);return api.status();
    },
    async status(){const s=await load();if(s.status==='armed'&&(Date.now()>s.expiresAt||Date.now()-s.lastDownloadAt>10*60*1000)){s.status='expired';await save(s);}const {folder,scope,...publicState}=s;return publicState;},
    async finish(){const s=await load();s.status='finished';await save(s);return api.status();},
    async check(){const s=await load();for(const item of s.items.filter(x=>['copying','unknown'].includes(x.status))){const r=await self.CFB_NATIVE_REQUEST('operation_status',{scope:s.scope,operationId:item.operationId});if(r.status==='completed'){item.status='saved';item.path=r.result?.path;}else{item.status='unknown';item.message='结果仍未确认，未重复复制。';}}await save(s);return api.status();}
  };
  async function complete(id){
    const s=await load(),entry=s.items.find(x=>x.id===id);if(!entry||entry.status!=='tracking')return;
    const item=(await chrome.downloads.search({id}))[0];if(!item||item.state!=='complete')return;
    if(!['safe','deepScannedSafe'].includes(item.danger)||item.exists===false){entry.status='failed';entry.message='浏览器安全检查未通过或源文件不存在';await save(s);return;}
    let current,permission;try{current=await self.CFB_NATIVE_REQUEST('status');permission=s.fixedScope?await self.CFB_NATIVE_REQUEST('profile_status',{scope:s.scope}):null;}catch{entry.status='failed';entry.message='本机连接预检查失败，保存未开始，源下载保留';await save(s);return;}if(s.fixedScope?!permission?.allowWrites:current.config?.folder!==s.folder||!current.config?.allowWrites){entry.status='failed';entry.message='工作文件夹或权限已切换，未保存到其他位置';s.status='finished';await save(s);return;}
    entry.status='copying';await save(s);
    try {const result=await self.CFB_NATIVE_REQUEST('import_download',{scope:s.scope,subdirectory:s.subdirectory,source:item.filename,operationId:entry.operationId});entry.status='saved';entry.path=result.path;entry.verified=result.verified;}
    catch(error){entry.status=/已暂停/.test(error.message)?'failed':'unknown';entry.message=entry.status==='failed'?'暂停期间未开始保存，源下载保留':'保存结果待核对，源下载保留';}
    // Preserve a Finish clicked while a copy was in flight.
    const latest=await load();if(latest.status==='finished')s.status='finished';await save(s);
  }
  self.CFB_BATCH_DOWNLOADS={arm:values=>serial(()=>api.arm(values)),status:api.status,finish:api.finish,check:()=>serial(api.check)};
  chrome.downloads.onCreated.addListener(item=>{void serial(async()=>{
    const s=await load();if(s.status!=='armed'||Date.now()>s.expiresAt||Date.now()-s.lastDownloadAt>10*60*1000||s.items.length>=100||item.incognito||item.byExtensionId||!Number.isFinite(Date.parse(item.startTime))||Date.parse(item.startTime)<s.startedAt||!(origin(item.url)||origin(item.referrer))||s.items.some(x=>x.id===item.id))return;
    s.items.push({id:item.id,status:'tracking',operationId:crypto.randomUUID()});s.lastDownloadAt=Date.now();if(s.items.length===100)s.status='finished';await save(s);if(item.state==='complete')await complete(item.id);
  }).catch(()=>{});});
  chrome.downloads.onChanged.addListener(change=>{void serial(async()=>{if(change.state?.current==='complete')await complete(change.id);else if(change.state?.current==='interrupted'){const s=await load(),item=s.items.find(x=>x.id===change.id);if(item?.status==='tracking'){item.status='failed';item.message='下载中断';await save(s);}}}).catch(()=>{});});
  // Worker recreation reconciles only already tracked IDs, never download history.
  void serial(async()=>{const s=await load();let changed=false;for(const item of s.items.filter(x=>x.status==='copying')){item.status='unknown';item.message='浏览器后台重新启动，保存结果待核对；未重复复制';changed=true;}if(changed)await save(s);for(const item of s.items.filter(x=>x.status==='tracking'))await complete(item.id);}).catch(()=>{});
})();
