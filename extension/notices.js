(function(){
  let timer=null,outage=null,notified=new Set(),lastOperationNotice=0;const issues=new Set();
  void chrome.storage.session?.get('cfbNoticeIds').then(v=>{for(const id of (v.cfbNoticeIds||[]).slice(-100))notified.add(id);}).catch(()=>{});
  const persist=()=>void chrome.storage.session?.set({cfbNoticeIds:[...notified].slice(-100)}).catch(()=>{});
  async function enabled(){const prefs=(await chrome.storage.local.get('cfbNotices')).cfbNotices||{};return prefs.enabled&&await chrome.permissions.contains({permissions:['notifications']});}
  self.CFB_NOTICES={record(entry){
    if(!entry)return;const key=JSON.stringify([entry.scope,entry.kind,entry.paths||[]]);if(entry.state==='completed'){issues.delete(key);return;}if(issues.has(key))return;
    if(!['failed','unknown','partial','conflict'].includes(entry.state)||notified.has('operation:'+entry.id))return;
    issues.add(key);if(issues.size>100)issues.delete(issues.values().next().value);notified.add('operation:'+entry.id);persist();if(notified.size>100)notified.delete(notified.values().next().value);
    if(Date.now()-lastOperationNotice<120000)return;
    lastOperationNotice=Date.now();void enabled().then(ok=>{if(ok)return chrome.notifications.create('cfb-file-result',{type:'basic',iconUrl:'icon.png',title:'文件操作需要核对',message:'有文件操作失败、部分完成、结果未确认或同名冲突。打开文件工作台查看，未自动重做。',priority:1});}).catch(()=>{});
  },observe(snapshot){const a=snapshot.alert;
    if(!a?.active){clearTimeout(timer);timer=null;outage=null;return;}
    if(outage===a.id||notified.has(a.id))return;clearTimeout(timer);outage=a.id;
    timer=setTimeout(async()=>{timer=null;if(outage!==a.id||notified.has(a.id)||!await enabled())return;notified.add(a.id);persist();if(notified.size>100)notified.delete(notified.values().next().value);await chrome.notifications.create('cfb-connection',{type:'basic',iconUrl:'icon.png',title:'Claude 文件连接需要处理',message:a.message+'。未自动重做文件操作。',priority:1}).catch(()=>{});},30000);
  }};
  chrome.notifications?.onClicked.addListener(()=>void chrome.tabs.create({url:chrome.runtime.getURL('workspace.html')}));
})();
