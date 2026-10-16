const CFB_ui_t=text=>globalThis.CFB_I18N?CFB_I18N.t(text):text;
const CFB_ui_tpl=(strings,...values)=>globalThis.CFB_I18N?CFB_I18N.tpl(strings,...values):strings.reduce((s,x,i)=>s+x+(i<values.length?values[i]:''),'');
// Shared presentation only. Network and file permissions remain in the host.
const CFB_UI = {
  create(doc) {
    const $ = id => doc.getElementById(id);
    let connection = {}, download = { status: 'idle' }, busy = false, polling = false, actionBusy = false, revision = 0,phaseKey='',phaseSince=Date.now();
    setInterval(()=>{const hint=doc.getElementById('connectionHelp');if(hint&&!doc.hidden)hint.textContent=CFB_EXPERIENCE.connection(connection,Date.now()-phaseSince);},1000);
    const activeDownload = () => ['armed', 'tracking', 'copying', 'unknown'].includes(download.status);
    function controls() {
      $('armDownload').disabled = busy || actionBusy || connection.local !== 'ready' || !connection.config?.allowWrites || activeDownload();
      $('cancelDownload').hidden = !activeDownload(); $('cancelDownload').disabled = busy || actionBusy || download.status === 'copying';
      $('retryDownload').hidden = download.status !== 'unknown'; $('retryDownload').disabled = busy || actionBusy;
    }
    function renderDownload(state) {
      download = state;
      const labels = { idle: CFB_ui_t('备用下载保存尚未开启，不影响自动保存'), armed: CFB_ui_t('请在 5 分钟内点击 Claude 的下载按钮'), tracking: CFB_ui_t('正在下载，完成后自动保存'), copying: CFB_ui_t('正在保存到工作文件夹…'), saved: CFB_ui_t('已保存并校验'), unknown: CFB_ui_t('保存结果尚未确认'), error: CFB_ui_t('这次没有保存完成'), expired: CFB_ui_t('等待已过期，可重新启用') };
      $('downloadStatus').textContent = (labels[state.status] || CFB_ui_t('正在检查…')) + (state.result?.path ? '：' + state.result.path : '') + (state.message ? '。' + state.message : '');
      $('downloadHelp').textContent = !connection.config?.folder ? CFB_ui_t('请先在设置中选择工作文件夹。') : !connection.config?.allowWrites ? CFB_ui_t('当前为只读。保存下载文件前，请在设置中开启“允许修改文件”。') : state.status === 'unknown' ? CFB_ui_t('先检查保存结果，避免重复保存。结束跟踪不会撤销已经保存的文件。') : state.status === 'armed' ? CFB_ui_t('只处理下一次能识别为 Claude 来源的下载；其他网站的下载不受影响。') : CFB_ui_t('先点上面的按钮，再在 Claude 网页下载。原下载保留，同名另存。');
      $('downloadDetails').hidden = !state.operationId; $('downloadOperation').textContent = state.operationId || ''; controls();
    }
    return {
      connection(state) {
        connection = state;const key=state.local+'|'+state.relay?.status;if(key!==phaseKey){phaseKey=key;phaseSince=Date.now();}const hint=doc.getElementById('connectionHelp');if(hint)hint.textContent=CFB_EXPERIENCE.connection(state,Date.now()-phaseSince);
        const auto=doc.getElementById('autoStatus');if(auto)auto.textContent=state.local==='unavailable'?CFB_ui_t('工作文件夹不可用，请重新选择或接回原磁盘；自动保存已暂停。'):!state.autoSaveEnabled?CFB_ui_t('自动保存未开启，可在文件夹与设置中开启。'):!state.config?.allowWrites?CFB_ui_t('自动保存已选择，开启文件修改权限后生效。'):state.local!=='ready'?CFB_ui_t('自动保存等待本机连接恢复；不会重复覆盖结果不明的操作。'):CFB_ui_t('自动保存已开启：直接更新原文件，不备份、不另存；相同内容跳过。');
        const localLabels = { previous_closing:CFB_ui_t('上一次连接正在收尾，等待接续；不强制结束'),host_busy:CFB_ui_t('连接锁仍被占用，请核对其他窗口或稍后重试'), unavailable:CFB_ui_t('工作文件夹目前不可用，请在设置中重新选择；原设置保留'), incompatible:CFB_ui_t('插件与本机程序版本不匹配，请更新后重新加载扩展'), ready: CFB_ui_t('本机文件连接已就绪'), unconfigured: CFB_ui_t('请选择并保存工作文件夹'), missing: CFB_ui_t('本机程序未连接，请检查安装'), idle: CFB_ui_t('等待打开 Claude 或连接设置') };
        $('local').textContent = localLabels[state.local] || CFB_ui_t('正在连接本机程序…');
        const remoteLabels = { starting: CFB_ui_t('Cowork 正在连接…'), reconnecting: CFB_ui_t('Cowork 连接暂时中断，正在自动重连…'), online: CFB_ui_t('Cowork 设备在线'), auth_required: CFB_ui_t('Cowork 需要设备验证，请打开设置'), blocked: state.relay?.reason==='identity_unavailable'?CFB_ui_t('Cowork 登录记录需检查；原记录保留，请打开设置'):CFB_ui_t('Cowork 网络设置未通过检查，请打开设置'), error: CFB_ui_t('Cowork 连接异常，请打开设置') };
        const reasons={no_proxy_found:CFB_ui_t('没有找到本机代理；纯VPN/TUN请选择系统网络，代理软件请开启系统代理或填写端口'),proxy_unreachable:CFB_ui_t('本机代理无响应，请检查代理软件和端口'),service_unreachable:CFB_ui_t('无法连接Cowork服务，请检查节点或稍后重试'),auth_timeout:CFB_ui_t('验证码已过期，请点击重新获取验证码'),auth_denied:CFB_ui_t('设备验证被拒绝，请明确重新获取验证码')};if(reasons[state.relay?.reason])remoteLabels[state.relay?.status]=reasons[state.relay.reason];
        if(state.relay?.phase==='retiring')remoteLabels[state.relay.status]=CFB_ui_t('Cowork 等待旧连接收尾');else if(state.relay?.phase==='retry_wait')remoteLabels[state.relay.status]=CFB_ui_t('Cowork 将在 ')+Math.max(0,Math.min(300,Number.isSafeInteger(state.relay.retryInSeconds)?state.relay.retryInSeconds:0))+CFB_ui_t(' 秒后重试');
        $('remote').textContent = state.config?.relayEnabled ? remoteLabels[state.relay?.status] || CFB_ui_t('Cowork 等待 Claude 网页打开') : CFB_ui_t('Cowork 尚未开启，可在设置中配置'); renderDownload(download);
      },
      busy(value) { busy = value; controls(); },
      downloadControls(chromeApi) {
        async function perform(action, userAction) {
          if (userAction && (busy || actionBusy)) return;
          if (userAction) { actionBusy = true; revision++; controls(); }
          const started = revision;
          try { const r = await chromeApi.runtime.sendMessage({ action }); if (!r?.ok) throw new Error(r?.error || CFB_ui_t('无法检查保存状态。')); if (userAction || (started === revision && !actionBusy)) renderDownload(r.result); if (userAction) $('message').textContent = ''; }
          catch (e) { if (userAction) $('message').textContent = CFB_ui_t(e.message); }
          finally { if (userAction) { actionBusy = false; controls(); } }
        }
        $('armDownload').onclick = () => void perform('arm_download', true);
        $('cancelDownload').onclick = () => void perform('cancel_download', true);
        $('retryDownload').onclick = () => void perform('retry_download', true);
        async function poll() { if (polling || actionBusy || doc.hidden) return; polling = true; try { await perform('download_status', false); } finally { polling = false; } }
        void poll(); setInterval(() => void poll(), 3000);
        doc.addEventListener('visibilitychange', () => { if (!doc.hidden) void poll(); }); controls();
      }
    };
  }
};
