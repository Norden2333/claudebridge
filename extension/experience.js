// Presentation helpers for extension-owned pages. No file or network authority.
(function(){
 const t=s=>globalThis.CFB_I18N?CFB_I18N.t(s):s;
 function prerequisites(s,version){
  if(!s||!s.version)return t('先安装或连接本机程序，再继续。');
  if(s.version!==version)return t('扩展与本机程序版本不同，请更新后重新加载扩展。');
  if(!s.dataConsentGranted)return t('先在设置中阅读数据说明、勾选同意并保存。');
  if(!s.folder?.readable)return t('先选择可读取的工作文件夹并保存。');
  return '';
 }
 function connection(s,elapsed=0){
  const ready=s.local==='ready',relay=s.relay?.status;
  if(s.local==='incompatible')return t('版本不一致，文件操作尚未开始。请更新并重新加载扩展。');
  if(s.local==='unconfigured')return t('还没有选工作文件夹。打开设置，选择文件夹并保存。');
  if(s.local==='unavailable')return t('工作文件夹暂时无法访问。接回原磁盘或在设置重新选择；原设置保留。');
  if(!ready)return elapsed>=60000?t('本机连接等待超过一分钟。打开首次使用检查安装和版本，不必反复重装。'):t('正在连接本机程序，连接恢复后会自动继续。');
  if(s.dataConsentGranted===false)return t('本机已连接；请先在设置中同意数据说明并保存。');
  if(!s.config?.relayEnabled)return t('本机连接正常。Chat 当前对话能否使用工具，请在对话中验证一次。');
  if(relay==='online')return t('Cowork 设备在线；当前对话仍需启用连接器并验证一次。');
  if(['starting','reconnecting','idle'].includes(relay))return elapsed>=60000?t('Cowork 仍在自动连接。超过一分钟未恢复，可在设置查看具体原因；不要重做文件操作。'):t('Cowork 正在自动连接，无需反复点击。');
  if(relay==='auth_required')return t('需要设备验证。打开设置中的验证页，完成后状态会自动更新。');
  return t('Cowork 暂未连通，本机文件功能不受影响。打开设置查看具体原因。');
 }
 function uniquePaths(items){return new Set((items||[]).flatMap(r=>{const x=r.result||{};return [x.path,x.destination,...(Array.isArray(x.paths)?x.paths:[])].filter(p=>typeof p==='string').map(p=>p.replaceAll('\\','/'));})).size;}
 function environment(doc,info,manifest,id){
  const el=doc.getElementById('versionInfo');if(!el)return;
  el.textContent=t('扩展：')+(manifest.name||'ClaudeBridge')+' '+manifest.version+'\n'+t('扩展编号：')+id+'\n'+t('正在运行的本机程序：')+(info.version||t('尚未连接'))+'\n'+t('实际安装位置：')+(info.installationRoot||t('连接后显示'))+'\n'+t('解压新包不会自动更新正在运行的程序；重新加载旧扩展也不会换成新版。');
 }
 globalThis.CFB_EXPERIENCE={prerequisites,connection,uniquePaths,environment};
})();
