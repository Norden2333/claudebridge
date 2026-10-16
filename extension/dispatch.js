(function () {
  const core=self.ClaudefsCore,definitions=self.CFB_TOOL_DEFINITIONS;
  const pending = new Map(),appends=new Map();
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  async function appendOperation(args){
    const text=JSON.stringify(stable({route:typeof location==='object'?location.pathname:'',name:'write_file',args}));const key=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const now=Date.now(),old=appends.get(key);if(old&&now-old.at<600000)return old.operationId;
    const operationId='append-'+key.slice(0,32)+'-'+crypto.randomUUID().slice(0,8);appends.set(key,{at:now,operationId});if(appends.size>256)appends.delete(appends.keys().next().value);return operationId;
  }

  core.bridge.onMessage('cfb-tool-result', message => {
    const job = pending.get(message?.id); if (!job) return;
    clearTimeout(job.timer); pending.delete(message.id);
    if (message.ok) {
      const { __image, ...metadata } = message.result || {};
      job.resolve(__image ? { content:[{ type:'image', mimeType:__image.mimeType, data:__image.data },{ type:'text', text:JSON.stringify(metadata) }] } : { content:[{ type:'text', text:JSON.stringify(message.result) }] });
    } else job.reject(new Error(message.error || '本机文件操作失败。'));
  });
  const sendTool=(name,args,suppliedId)=>new Promise((resolve,reject)=>{
      if (!definitions.some(t => t.name === name)) { reject(new Error('工具不可用。')); return; }
      const id = crypto.randomUUID(); let operationId = args?.operation_id || suppliedId || id;
      if(name==='write_file'&&typeof args?.content==='string')try{const p=JSON.parse(args.content);if(p.protocol==='claude-folder-operation/v1'&&p.operationId)operationId=p.operationId;}catch{}
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('本机连接超时，操作结果未知；先查询操作编号：' + operationId + '，不要直接重试写入或整批操作。')); }, 1325000);
      pending.set(id, { resolve, reject, timer });
      core.bridge.send('cfb-tool-request', { id, operationId, name, args: args || {} });
    });
  core.dispatch={listTools:()=>definitions,callTool(name,args){if(name==='write_file'&&args?.mode==='append'&&!args.operation_id){const copy=JSON.parse(JSON.stringify(args));return appendOperation(copy).then(id=>sendTool(name,copy,id));}return sendTool(name,args);}};
})();
