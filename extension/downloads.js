// One-shot user-armed capture. No history scan, model content or URL fetch.
(function () {
  const key = 'cfbDownload'; let queue = Promise.resolve();
  const serial = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const claude = value => { try { return new URL(value).origin === 'https://claude.ai'; } catch { return false; } };
  const safe = item => ['safe', 'deepScannedSafe'].includes(item.danger) && item.state === 'complete' && item.exists !== false;
  const store = async data => chrome.storage.session.set({ [key]: data });
  const load = async () => (await chrome.storage.session.get(key))[key] || { status: 'idle' };
  async function boundState(state) {
    if(typeof state.scope==='string'&&state.scope)return state;
    const current=await self.CFB_NATIVE_REQUEST('status');
    if(current.config?.folder!==state.folder||typeof current.scope!=='string'||!current.scope)throw new Error('旧下载记录缺少固定文件夹，请先切回原文件夹核对；未向其他目录查询或复制。');
    const bound={...state,scope:current.scope};await store(bound);return bound;
  }
  async function complete(state) {
    let current;try{state=await boundState(state);current=await self.CFB_NATIVE_REQUEST('status');}catch{await store({...state,status:'error',message:'本机连接或原文件夹无法确认，保存未开始，源下载保留。'});return;}if(current.paused){await store({status:'error',message:'文件操作已暂停，保存未开始，源下载保留。'});return;}
    if (current.config?.folder !== state.folder || !current.config?.allowWrites) { await store({ status: 'error', message: '工作文件夹或写入权限已改变，未复制。' }); return; }
    const items = await chrome.downloads.search({ id: state.downloadId });
    const item = items[0];
    if (!item || item.state !== 'complete') return;
    if (!safe(item)) { await store({ status: 'error', message: '下载未通过浏览器安全检查，未复制。' }); return; }
    await store({ ...state, status: 'copying' });
    try {
      const result = await self.CFB_NATIVE_REQUEST('import_download', { scope: state.scope, source: item.filename, operationId: state.operationId });
      await store({ status: 'saved', result });
    } catch(error) { await store(/已暂停/.test(error.message)?{status:'error',message:'文件操作已暂停，保存未开始，源下载保留。'}:{ ...state, status: 'unknown', message: '保存失败或结果未知。可重试查询同一操作编号；不会重复保存。' }); }
  }
  const methods = {
    async arm({scope}={}) {
      const batch=await self.CFB_BATCH_DOWNLOADS?.status();if(batch?.status==='armed'||batch?.items?.some(x=>['tracking','copying'].includes(x.status)))throw new Error('本次任务的批量保存仍在进行，请先结束。');
      const previous = await load();
      if (['tracking','copying','unknown'].includes(previous.status)) throw new Error('已有下载尚未完成，请先查询结果或取消等待。');
      let status = await self.CFB_NATIVE_REQUEST('status');if(scope&&scope!==status.scope){const profile=await self.CFB_NATIVE_REQUEST('profile_status',{scope});status={...status,scope:profile.scope,config:{...status.config,folder:profile.folder,allowWrites:profile.allowWrites}};}
      if(status.paused)throw new Error('文件操作已暂停。');
      if (status.local !== 'ready' || !status.config?.allowWrites) throw new Error('请先选择工作文件夹并开启文件修改权限。');
      if(typeof status.scope!=='string'||!status.scope)throw new Error('本机连接缺少文件夹编号，请检查扩展与本机程序版本。');
      await store({ status: 'armed', scope:status.scope, armedAt: Date.now(), expiresAt: Date.now() + 5 * 60 * 1000, folder: status.config.folder });
      return { status: 'armed' };
    },
    async status() { const state = await load(); if (state.status === 'armed' && Date.now() > state.expiresAt) { await store({ status: 'expired' }); return { status: 'expired' }; } const { folder, scope, ...publicState } = state; return publicState; },
    async cancel() { const state = await load(); if (state.status === 'copying') throw new Error('操作可能已开始，请先查询结果。'); await store({ status: 'idle' }); return { status: 'idle' }; },
    async retry() { let state = await load(); if (!['tracking','unknown','copying'].includes(state.status)) return methods.status(); state=await boundState(state);const receipt = await self.CFB_NATIVE_REQUEST('operation_status', { scope:state.scope, operationId: state.operationId });
      if (receipt.status === 'completed') await store({ status: 'saved', result: receipt.result });
      else if (receipt.status === 'not_found') await complete(state);
      else await store({ ...state, status: 'unknown', message: '操作已开始但结果不确定，不会重复执行。请核对目标目录；结束跟踪不会撤销已保存文件。' });
      return methods.status(); }
  };
  self.CFB_DOWNLOADS = Object.fromEntries(Object.keys(methods).map(name => [name, () => serial(() => methods[name]())]));
  chrome.downloads.onCreated.addListener(item => { void serial(async () => {
    const state = await load();
    if (state.status !== 'armed' || Date.now() > state.expiresAt || !Number.isFinite(Date.parse(item.startTime)) || Date.parse(item.startTime) < state.armedAt || item.incognito || item.byExtensionId || !(claude(item.referrer) || claude(item.url))) return;
    // Bind scope now; a later scope change cancels copying to a different folder.
    const next = { ...state, status: 'tracking', downloadId: item.id, operationId: crypto.randomUUID() };
    await store(next); if (item.state === 'complete') await complete(next);
  }).catch(() => {}); });
  chrome.downloads.onChanged.addListener(change => { void serial(async () => {
    const state = await load();
    if (state.downloadId !== change.id || !['tracking','copying'].includes(state.status)) return;
    if (change.state?.current === 'interrupted') { await store({ status: 'error', message: '下载中断，未复制；可重新启用保存。' }); return; }
    if (change.state?.current === 'complete') {
      await complete(state);
    }
  }).catch(() => {}); });
})();
