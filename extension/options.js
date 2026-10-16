const CFB_options_t=text=>globalThis.CFB_I18N?CFB_I18N.t(text):text;
const CFB_options_tpl=(strings,...values)=>globalThis.CFB_I18N?CFB_I18N.tpl(strings,...values):strings.reduce((s,x,i)=>s+x+(i<values.length?values[i]:''),'');
const $ = id => document.getElementById(id);
let settingsPartial=false;let initialized = false, savedForm = '', savedConsent=false,savedAuto=false,savedKeep=true,acceptedBroadFolder='', busy = false;
let currentRoute=null;const ui = CFB_UI.create(document);
const config = () => ({ archiveRetentionDays:$('expireBackups').checked?Number($('backupDays').value):null,preserveOutputDirs:$('preserveOutputDirs').checked,broadFolderAccepted:!!acceptedBroadFolder&&acceptedBroadFolder===$('folder').value.trim(),folder: $('folder').value.trim(), networkMode: $('networkMode').value, systemNetworkAccepted: $('networkAccepted').checked, proxy: $('proxy').value.trim(), allowWrites: $('writes').checked, relayEnabled: $('relay').checked });
function updateForm() {
  const system = $('networkMode').value === 'system';
  $('proxySection').hidden = $('networkMode').value !== 'proxy'; $('systemSection').hidden = !system; $('relayFields').hidden = !$('relay').checked; $('backupDays').disabled=busy||!$('expireBackups').checked;
  const dirty = initialized && (JSON.stringify(config()) !== savedForm || $('dataConsent').checked!==savedConsent || $('autoSave').checked!==savedAuto || $('keepCoworkOnline').checked!==savedKeep);
  $('save').disabled = busy || !initialized || !dirty; $('choose').disabled = busy || !initialized;
  $('saveState').textContent = !initialized ? CFB_options_t('等待本机程序连接') : settingsPartial?CFB_options_t('部分设置已保存，请核对'):dirty ? CFB_options_t('有更改尚未保存') : !config().folder ? CFB_options_t('请先选择工作文件夹') : CFB_options_t('设置已保存'); return dirty;
}
function render(s) {
  const expectedVersion=chrome.runtime.getManifest?.().version;const stale=!!expectedVersion&&s.extensionBuildVersion!==expectedVersion;$('reloadExtension').hidden=!stale;if(stale)$('message').textContent=CFB_options_t('扩展后台仍是旧代码。先核对当前操作，再重新加载插件；只重开浏览器不一定会更新后台。');
  currentRoute=s.relay?.route||null;$('fixRoute').hidden=currentRoute?.kind!=='proxy';$('currentRoute').textContent=currentRoute?.kind==='proxy'?CFB_options_t('Cowork 当前经本机代理 ')+currentRoute.proxy+CFB_options_t('（来源：')+({env:CFB_options_t('环境变量'),system:CFB_options_t('系统代理'),manual:CFB_options_t('手动固定')})[currentRoute.source]+'）':currentRoute?.kind==='system'?CFB_options_t('Cowork 当前经系统网络（VPN/TUN）'):CFB_options_t('尚未选定可用网络；不会自动直连。');
  ui.connection(s); $('installHelp').hidden = s.local !== 'missing';
  if (s.config && !initialized) {
    $('expireBackups').checked=s.config.archiveRetentionDays!=null;$('backupDays').value=s.config.archiveRetentionDays??90;$('preserveOutputDirs').checked=s.config.preserveOutputDirs===true;$('folder').value = s.config.folder || '';acceptedBroadFolder=s.config.broadFolderAccepted?$('folder').value:''; $('proxy').value = s.config.proxy || ''; $('networkMode').value = s.config.networkMode || 'auto';
    $('networkAccepted').checked = s.config.systemNetworkAccepted === true; $('writes').checked = !!s.config.allowWrites; $('relay').checked = !!s.config.relayEnabled;
    $('coworkSettings').open = !!s.config.relayEnabled; $('dataConsent').checked=s.dataConsentGranted===true;savedConsent=$('dataConsent').checked;$('autoSave').checked=s.autoSaveEnabled===true;savedAuto=$('autoSave').checked;$('keepCoworkOnline').checked=s.keepCoworkOnline!==false;savedKeep=$('keepCoworkOnline').checked;$('usageMode').value=s.config.relayEnabled?'cowork':'chat'; initialized = true; savedForm = JSON.stringify(config());
  }
  $('effectiveFolder').textContent=CFB_options_t('当前已保存目录：')+(s.config?.folder||CFB_options_t('尚未选择'))+(s.config?.folder?CFB_options_t('（仅此目录及其子目录）'):'');updateForm(); $('verify').hidden = true; $('verify').removeAttribute('href'); $('code').textContent = ''; $('verification').hidden = true;
  if (s.relay?.status === 'auth_required') {
    try { const u = new URL(s.relay.verificationUrl); if (u.protocol === 'https:' && ['mcp.desktopcommander.app', 'auth.desktopcommander.app'].includes(u.hostname) && !u.username && !u.password) {
      $('verification').hidden = false; $('verify').href = u.href; $('verify').hidden = false; $('code').textContent = CFB_options_t('请核对验证码：') + (s.relay.userCode || '');
    } } catch {}
  }
  if (s.relay?.reason === 'identity_unavailable') $('message').textContent = CFB_options_t('设备登录记录无法读取或安全保存。原记录已保留，本机文件功能仍可用；请先检查系统凭据权限或恢复记录，不要反复注册新设备。');
  if (s.error) $('message').textContent = s.error;
}
const port = chrome.runtime.connect({ name: 'settings' }); port.onMessage.addListener(render);
port.onDisconnect.addListener(() => { $('message').textContent = CFB_options_t('扩展连接已断开，请重新打开此页面。'); });
async function run(action, payload = {}) {
  if (busy) return; busy = true; $('settingsFields').disabled = true; $('retry').disabled = true; updateForm(); ui.busy(true);
  try { const r = await chrome.runtime.sendMessage({ action, ...payload }); if (!r?.ok) throw Object.assign(new Error(r?.error || CFB_options_t('本机连接不可用。')),{code:r?.errorCode,hostSettingsSaved:r?.hostSettingsSaved,partialResult:r?.result}); return r.result; }
  catch (e) { $('message').textContent = CFB_options_t(e.message); throw e; }
  finally { busy = false; $('settingsFields').disabled = false; $('retry').disabled = false; updateForm(); ui.busy(false); }
}
$('settingsForm').oninput = () => { updateForm(); $('message').textContent = ''; };
$('choose').onclick = () => { void run('pick_folder').then(result => { if (result?.folder) { $('folder').value = result.folder; updateForm(); } }).catch(() => {}); };
$('settingsForm').onsubmit = event => {
  event.preventDefault(); if (!initialized || busy || !updateForm()) return;
  if (!$('dataConsent').checked) { $('message').textContent=CFB_options_t('请先阅读并同意文件数据处理说明。');$('dataConsent').focus();return; }
  if (!config().folder) { $('message').textContent = CFB_options_t('请先选择工作文件夹。'); $('folder').focus(); return; }
  if (config().relayEnabled && config().networkMode === 'proxy' && !config().proxy) { $('coworkSettings').open = true; $('message').textContent = CFB_options_t('请填写代理软件提供的 HTTP 或混合代理地址。'); $('proxy').focus(); return; }
  if (config().relayEnabled && config().networkMode === 'system' && !config().systemNetworkAccepted) { $('coworkSettings').open = true; $('message').textContent = CFB_options_t('请先确认 VPN 路由和断线保护。'); $('networkAccepted').focus(); return; }
  void run('save_settings',{config:config(),accepted:true,autoSave:$('autoSave').checked,keepCoworkOnline:$('keepCoworkOnline').checked}).then(s=>{if(!s)return;settingsPartial=false;initialized=false;render(s);$('message').textContent=CFB_options_t('已保存。打开或刷新 Claude 页面即可使用；无需每次唤醒。');}).catch(e=>{if(e.code==='CFB_BROAD_FOLDER'&&confirm(CFB_options_t('此位置包含系统和程序数据，不建议授权。仍要选择此目录？敏感位置仍受保护。'))){acceptedBroadFolder=$('folder').value.trim();$('settingsForm').requestSubmit();return;}if(e.hostSettingsSaved&&e.partialResult){settingsPartial=true;initialized=false;render(e.partialResult);}$('message').textContent=CFB_options_t('保存未完成；未确认的设置不要视为已生效。')+' '+CFB_options_t(e.message);});
};
$('retry').onclick = () => { void run('retry').then(s => { if (s) render(s); }).catch(() => {}); };
window.addEventListener('beforeunload', event => { if (updateForm()) { event.preventDefault(); event.returnValue = ''; } });
void chrome.runtime.sendMessage({ action: 'status' }).then(r => { if (r?.ok) render(r.result); }).catch(() => {});
ui.downloadControls(chrome);

let diagnosticText='';
$('exportDiagnostics').onclick=async()=>{
 const button=$('exportDiagnostics');button.disabled=true;diagnosticText='';$('downloadDiagnostics').hidden=true;$('diagnosticPreview').hidden=true;
 try{const r=await chrome.runtime.sendMessage({action:'diagnostics'});if(!r?.ok)throw new Error();diagnosticText=JSON.stringify(r.result,null,2);$('diagnosticPreview').textContent=diagnosticText;$('diagnosticPreview').hidden=false;$('downloadDiagnostics').hidden=false;$('diagnosticStatus').textContent=CFB_options_t('先查看下方内容；没有自动下载或上传。');}
 catch{$('diagnosticStatus').textContent=CFB_options_t('诊断信息暂时不可用，请截图反馈。');}finally{button.disabled=false;}
};
$('downloadDiagnostics').onclick=()=>{if(!diagnosticText)return;const url=URL.createObjectURL(new Blob([diagnosticText],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='claudebridge-diagnostics.json';document.body.append(link);try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}};
$('usagePreset').onchange=()=>{const read=$('usagePreset').value==='read',write=$('usagePreset').value==='write';if(!read&&!write)return;$('writes').checked=write;$('autoSave').checked=write;updateForm();$('message').textContent=CFB_options_t('已填入选项，点击“保存设置”后生效。');};
$('usageMode').onchange=()=>{$('relay').checked=$('usageMode').value==='cowork';$('coworkSettings').open=$('relay').checked;updateForm();};
$('extensionsPage').onclick=()=>void chrome.tabs.create({url:'chrome://extensions/?id='+chrome.runtime.id});
void chrome.runtime.sendMessage({action:'setup_status'}).then(r=>{if(r?.ok)CFB_EXPERIENCE.environment(document,r.result,chrome.runtime.getManifest(),chrome.runtime.id);}).catch(()=>{});

$('dataConsent').onchange=()=>{if(!$('dataConsent').checked&&savedConsent){void chrome.runtime.sendMessage({action:'consent_update',accepted:false}).then(r=>{if(!r?.ok)throw new Error(r?.error||CFB_options_t('停止失败'));savedConsent=false;updateForm();$('message').textContent=CFB_options_t('已停止新文件操作。已开始的操作需核对结果；文件和备份保留。');}).catch(e=>{$('message').textContent=CFB_options_t(e.message);});}};

$('reloadExtension').onclick=()=>{if(confirm(CFB_options_t('重新加载插件？这会关闭设置页。已开始操作先核对结果，重连不会重做写入。')))chrome.runtime.reload();};

$('reauthorize').onclick=()=>{if(confirm(CFB_options_t('重新验证原设备？保留原编号，不修改工作文件。')))void run('relay_reauthorize',{confirm:true}).then(s=>{if(s)render(s);$('message').textContent=CFB_options_t('正在重新验证原设备；请等待验证码。');}).catch(()=>{});};
$('reregister').onclick=()=>{if(confirm(CFB_options_t('作为新设备登记？原记录将改名保留，现有会话需重新选择新设备。'))&&confirm(CFB_options_t('确认不再沿用原设备编号，开始登记新设备？')))void run('relay_reregister',{confirm:true}).then(s=>{if(s)render(s);$('message').textContent=CFB_options_t('正在登记新设备；旧记录已保留。');}).catch(()=>{});};

$('fixRoute').onclick=()=>{if(currentRoute?.kind!=='proxy')return;$('networkMode').value='proxy';$('proxy').value=currentRoute.proxy;updateForm();$('message').textContent=CFB_options_t('正在固定当前代理，不修改VPN。');$('settingsForm').requestSubmit();};
$('newCode').onclick=()=>{void run('retry').then(s=>{if(s)render(s);$('message').textContent=CFB_options_t('正在重新连接；需要时会显示新的设备验证码。');}).catch(()=>{});};
