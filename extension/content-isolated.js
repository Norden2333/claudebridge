(function () {
  self.ClaudefsCore.bridge.onMessage('cfb-tool-request', async message => {
    if (!message || typeof message.id !== 'string' || message.id.length > 100) return;
    try {
      const requestPage=location.pathname;const response = await chrome.runtime.sendMessage({ action: 'tool', name: message.name, args: message.args, operationId: message.operationId || message.args?.operation_id || message.id });
      if(response?.ok&&location.pathname===requestPage)viewer?.toolUsed();
      self.ClaudefsCore.bridge.send('cfb-tool-result', { id: message.id, ...response, ...(response?.ok === false ? { error: response.error + '；操作编号：' + (message.operationId || message.args?.operation_id || message.id) } : {}) });
    } catch { self.ClaudefsCore.bridge.send('cfb-tool-result', { id: message.id, ok: false, error: '扩展连接已断开，操作结果未知；请刷新后查询操作编号：'+(message.operationId || message.args?.operation_id || message.id) }); }
  });
  let viewer=null, port=null,lastSeen=Date.now(),lastSession=null;
  function connectMonitor(){if(port || !viewer)return;try{
    const next=chrome.runtime.connect({name:'monitor'});port=next;
    next.onMessage.addListener(s=>{if(port===next){const wake=Date.now()-lastSeen>90000,session=s.state?.sessionId;viewer.update(s);if(session&&(session!==lastSession||wake)){lastSession=session;void chrome.runtime.sendMessage({action:'handoff',wake}).then(r=>{if(r?.ok)viewer?.handoff(r.result);}).catch(()=>{});}lastSeen=Date.now();refreshBinding();}});
    next.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(port===next){port=null;viewer.update({state:{local:'missing'},entries:[],alert:{id:'monitor-disconnected',active:true,message:'状态通道已断开，请稍候；扩展更新后需刷新页面'}});}});
  }catch{}}
  function refreshBinding(){void chrome.runtime.sendMessage({action:'binding_info'}).then(r=>{if(r?.ok)viewer?.binding(r.result);}).catch(()=>{});}
  async function localAction(name,values={}){if(name==='retry')self.ClaudefsCore.bridge.send('mcp-handshake-retry',{reason:'user'});const r=await chrome.runtime.sendMessage({action:'panel_action',name,...values});if(!r?.ok)throw new Error(r?.error||'操作未完成');return r.result;}
  chrome.runtime.onMessage.addListener((m,s)=>{if(s.id===chrome.runtime.id&&!s.tab&&m?.action==='toggle_monitor')viewer?.toggleHidden();});
  function mountViewer(){if(viewer)return;viewer=self.CFB_PANEL.create({onAction:localAction,onFolders:()=>void chrome.runtime.sendMessage({action:'open_workspace'}),onSettings:()=>void chrome.runtime.sendMessage({action:'open_settings'}),onClear:()=>void chrome.runtime.sendMessage({action:'monitor_clear'}),onWorkspace:()=>void chrome.runtime.sendMessage({action:'open_workspace'}),onBind:()=>{if(confirm('将当前对话的文件与自动保存成果改用设备当前选定的文件夹？Cowork 文件工具仍使用设备当前目录。'))void chrome.runtime.sendMessage({action:'bind_conversation'}).then(()=>refreshBinding());}});connectMonitor();}
  mountViewer();
  self.ClaudefsCore.bridge.onMessage('mcp-handshake-status',payload=>viewer?.handshake(payload?.status||'pending'));
  let timer=setInterval(connectMonitor,5000);
  window.addEventListener('pagehide',()=>{clearInterval(timer);port?.disconnect();port=null;viewer?.dispose();viewer=null;});
  window.addEventListener('pageshow',event=>{if(event.persisted){mountViewer();timer=setInterval(connectMonitor,5000);}});
})();
