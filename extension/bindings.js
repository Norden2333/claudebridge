(function(){
  const keyFor=sender=>{const u=new URL(sender.url);return /^\/chat\/[^/]+$/.test(u.pathname)||/^\/cowork\/cse_[a-zA-Z0-9_-]+$/.test(u.pathname)?u.pathname:'tab:'+sender.tab.id;};
  let queue=Promise.resolve();const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;};
  self.CFB_BINDINGS={
    navigation(tabId,url){if(!Number.isInteger(tabId)||typeof url!=='string')return Promise.resolve();return serial(async()=>{const u=new URL(url);if(u.origin!=='https://claude.ai'||!['/new','/','/cowork','/cowork/new'].includes(u.pathname))return;const store=chrome.storage.session,bindings=(await store.get('cfbBindings')).cfbBindings||{};delete bindings['tab:'+tabId];await store.set({cfbBindings:bindings});});},
    scope(sender,status,rebind=false){return serial(async()=>{
      if(!status.scope||!chrome.storage?.local)return status.scope;
      const key=keyFor(sender),store=key.startsWith('tab:')?chrome.storage.session:chrome.storage.local;
      const bindings=(await store.get('cfbBindings')).cfbBindings||{};
      if(!key.startsWith('tab:')&&!bindings[key]){const temporary=(await chrome.storage.session.get('cfbBindings')).cfbBindings||{},pending=temporary['tab:'+sender.tab.id];if(pending&&!rebind){bindings[key]=pending;delete temporary['tab:'+sender.tab.id];await chrome.storage.session.set({cfbBindings:temporary});await store.set({cfbBindings:bindings});}}
      if(rebind||!bindings[key]){bindings[key]={scope:status.scope,folder:status.config?.folder?.split(/[\\/]/).pop()||'',time:Date.now()};const keys=Object.keys(bindings).sort((a,b)=>bindings[b].time-bindings[a].time);for(const old of keys.slice(1000))delete bindings[old];await store.set({cfbBindings:bindings});}
      return bindings[key].scope;
    });},
    async info(sender,status){const key=keyFor(sender),store=key.startsWith('tab:')?chrome.storage.session:chrome.storage.local;const bindings=(await store.get('cfbBindings')).cfbBindings||{};return bindings[key]||{scope:status.scope,folder:status.config?.folder?.split(/[\\/]/).pop()||''};}
  };
})();
