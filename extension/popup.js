const CFB_popup_t=text=>globalThis.CFB_I18N?CFB_I18N.t(text):text;
const CFB_popup_tpl=(strings,...values)=>globalThis.CFB_I18N?CFB_I18N.tpl(strings,...values):strings.reduce((s,x,i)=>s+x+(i<values.length?values[i]:''),'');
const $ = id => document.getElementById(id);
const ui = CFB_UI.create(document);
function render(s) {
  const folder = s.config?.folder || '';
  $('folderName').textContent = folder ? folder.split(/[\\/]/).filter(Boolean).pop() || folder : CFB_popup_t('尚未选择文件夹');
  $('folderPath').textContent = folder; $('permission').textContent = folder ? (s.config.allowWrites ? CFB_popup_t('允许读取和修改 · 删除默认进回收站') : CFB_popup_t('只读 · 修改需在设置中开启')) : CFB_popup_t('首次使用，请打开“文件夹与设置”。');
  ui.connection(s); if (s.error) $('message').textContent = s.error;
}
$('settings').onclick = () => void chrome.runtime.openOptionsPage();
$('openClaude').onclick = () => void chrome.tabs.create({ url: 'https://claude.ai/' });
const port = chrome.runtime.connect({ name: 'settings' }); port.onMessage.addListener(render);
port.onDisconnect.addListener(() => { $('message').textContent = CFB_popup_t('扩展连接已断开，请重新打开弹窗。'); });
void chrome.runtime.sendMessage({ action: 'status' }).then(r => { if (r?.ok) render(r.result); }).catch(() => {});
ui.downloadControls(chrome);
