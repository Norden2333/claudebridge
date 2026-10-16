// AGPL-3.0-only. Local metadata presentation; no hooks, network or model requests.
(function () {
  const messages={idle:'文件连接已就绪',working:'正在处理文件',happy:'文件操作完成',sleeping:'已连接，暂无文件操作',error:'需要检查文件连接',waiting:'等待文件连接',attention:'文件结果需要处理'};
  function select(snapshot,now,lastActivity){
    const s=snapshot.state||{}, entries=snapshot.entries||[];
    if(snapshot.alert?.active)return {name:'error',text:snapshot.alert.message||'连接已断开，正在重连'};
    if(s.paused)return entries.some(e=>e.state==='running')?{name:'working',text:'已暂停新操作，当前操作收尾中'}:{name:'sleeping',text:'文件操作已暂停'};
    if(s.local!=='ready')return {name:'waiting',text:s.local==='unconfigured'?'先选择工作文件夹':'正在等待本机连接'};
    if(s.relayEnabled&&s.relay==='reconnecting')return {name:'waiting',text:'Cowork 正在自动重连，无需操作'};
    if(s.relayEnabled&&['error','blocked','auth_required'].includes(s.relay))return {name:'error',text:s.relay==='auth_required'?'Cowork 等待设备验证':s.relay==='blocked'?'Cowork 需要检查网络':'Cowork 正在重新连接'};
    if(entries.some(e=>['unknown','partial','conflict','interrupted'].includes(e.state)||e.autoSaveBlocked===true)||entries[0]?.state==='failed')return {name:'attention',text:'有文件结果待核对，请展开小窗'};
    if(entries.some(e=>['queued','running'].includes(e.state)))return {name:'working',text:'正在处理文件'};
    const newest=entries[0];
    if(newest?.state==='completed'&&now-newest.time>=0&&now-newest.time<4000)return {name:'happy',text:newest.verified?'文件已保存并校验':'文件操作完成'};
    return now-lastActivity>=60000?{name:'sleeping',text:messages.sleeping}:{name:'idle',text:messages.idle};
  }
  self.CFB_PET={select,create({doc=document,win=window,onToggle=()=>{}}={}){
    const button=doc.createElement('button');button.className='pet';button.type='button';
    const stage=doc.createElement('div');stage.className='pet-stage';stage.setAttribute('aria-hidden','true');button.append(stage);
    const shadow=stage.attachShadow({mode:'closed'}),label=doc.createElement('span');label.className='pet-label';button.append(label);
    let snapshot={state:{},entries:[]},enabled=true,motion=true,disposed=false,timer=null,lastActivity=Date.now(),signature='',asset='',currentName='waiting';
    const media=win.matchMedia('(prefers-reduced-motion: reduce)');
    function render(){
      if(disposed)return;win.clearTimeout(timer);timer=null;button.hidden=!enabled;
      const now=Date.now(),state=select(snapshot,now,lastActivity);currentName=state.name;
      const key=state.name==='attention'||state.name==='waiting'?'error':state.name;
      if(asset!==key){asset=key;shadow.innerHTML='<style>:host{display:block;width:100%;height:100%}svg{display:block;width:100%;height:100%;overflow:visible;transform:scale(1.35);transform-origin:center}:host(.paused) *{animation-play-state:paused!important}</style>'+self.CFB_PET_ASSETS[key];}
      stage.classList.toggle('paused',!enabled||!motion||doc.hidden||media.matches);button.dataset.state=state.name;label.textContent=globalThis.CFB_I18N?.t(state.text)||state.text;
      button.title=state.text+'；点击展开或收起文件小窗';button.setAttribute('aria-label',button.title);
      if(!enabled||doc.hidden)return;
      if(state.name==='happy')timer=win.setTimeout(render,Math.max(1,4000-(now-snapshot.entries[0].time)));
      else if(state.name==='idle')timer=win.setTimeout(render,Math.max(1,60000-(now-lastActivity)));
    }
    button.onclick=()=>onToggle();doc.addEventListener('visibilitychange',render);media.addEventListener('change',render);
    render();
    return {host:button,update(value,prefs={}){snapshot=value;enabled=prefs.petEnabled!==false;motion=prefs.motion!==false;
      const next=(value.entries||[]).map(e=>String(e.id||e.operationId||'')+':'+e.state+':'+e.time).join('|');
      if(next!==signature){lastActivity=Date.now();signature=next;}render();
    },state(){return currentName;},dispose(){disposed=true;win.clearTimeout(timer);doc.removeEventListener('visibilitychange',render);media.removeEventListener('change',render);button.remove();}};
  }};
})();
