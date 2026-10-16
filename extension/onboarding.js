const CFB_onboarding_t=s=>globalThis.CFB_I18N?CFB_I18N.t(s):s;
(function(){
 const $=id=>document.getElementById(id),t=CFB_onboarding_t;let busy=false,info=null,problem=t('正在检查连接…'),requestBusy=false;
 async function request(action,values={}){const r=await chrome.runtime.sendMessage({action,...values});if(!r?.ok)throw new Error(r?.error||t('本机连接不可用'));return r.result;}
 function controls(){const blocked=busy||!!problem;$('read').disabled=blocked;$('write').disabled=blocked||!info?.allowWrites;$('refresh').disabled=busy||requestBusy;$('checkHelp').textContent=problem||(!info?.allowWrites?t('当前只读；要验证写入，请在设置开启允许修改并保存。'):t('设置已完成，可以验证目录或读写。'));}
 function row(text,done){const li=document.createElement('li');li.textContent=(done?'✓ ':'○ ')+text;li.dataset.done=String(!!done);$('steps').append(li);}
 async function check(){if(requestBusy)return;requestBusy=true;controls();const manifest=chrome.runtime.getManifest();$('steps').replaceChildren();row(t('浏览器扩展已加载：')+manifest.name+' '+manifest.version,true);
  try{info=await request('setup_status');problem=CFB_EXPERIENCE.prerequisites(info,manifest.version);row(t('本机程序已连接：')+info.version,true);row(t('扩展与本机程序版本一致'),info.version===manifest.version);row(t('数据说明已同意并保存'),info.dataConsentGranted);row(t('工作文件夹可读取：')+(info.folder?.path||''),info.folder?.readable);$('message').textContent=problem||t('本机准备好了。最后在自己的 Claude 对话里验证一次文件工具。');CFB_EXPERIENCE.environment(document,info,manifest,chrome.runtime.id);}
  catch(e){info=null;problem=t('本机尚未连接。先检查安装入口和扩展加载位置，不必反复重装。');$('message').textContent=problem+' '+t(e.message);}
  finally{requestBusy=false;controls();}
 }
 async function run(write){if(busy||problem||write&&!info?.allowWrites)return;busy=true;controls();$('checkResult').textContent=t('正在验证，请稍等…');try{const r=await request('setup_check',{write});$('checkResult').textContent=write?t('本机读写和校验通过；自己的临时测试文件已清理。'):t('目录读取通过，共 ')+r.items+t(' 个条目，未读取正文。');}catch(e){$('checkResult').textContent=t(e.message);}finally{busy=false;controls();}}
 $('refresh').onclick=()=>void check();$('read').onclick=()=>void run(false);$('write').onclick=()=>void run(true);$('settings').onclick=()=>void chrome.runtime.openOptionsPage();$('claude').onclick=()=>void chrome.tabs.create({url:'https://claude.ai/'});$('extensionsPage').onclick=()=>void chrome.tabs.create({url:'chrome://extensions/?id='+chrome.runtime.id});
 const port=chrome.runtime.connect({name:'settings'});port.onDisconnect.addListener(()=>{problem=t('连接已断开，正在恢复。恢复后点“重新检查”；不用重复安装。');controls();$('message').textContent=problem;});void check();
})();
