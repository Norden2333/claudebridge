(function(){
 const bridge=self.ClaudefsCore.bridge;delete self.ClaudefsCore;let busy=false,versionCounter=0,activeController=null;const versions=new WeakMap(),delayedDownloads=new Map();
 const browserAnchorClick=HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click=function(){const until=delayedDownloads.get(this.download);if(until&&until>Date.now()){delayedDownloads.delete(this.download);bridge.send('asset-download-notice',{name:this.download});return;}if(until)delayedDownloads.delete(this.download);return browserAnchorClick.call(this);};
 function metadata(card){
  if(!card?.matches('[data-sheet-kind]')||!card.closest('.font-claude-response,.font-claude-message'))return null;
  const cowork=/^\/cowork\/cse_[A-Za-z0-9]+$/.test(location.pathname);
  const button=[...card.querySelectorAll('button')].find(b=>/^(下载|下載|Download|ダウンロード|다운로드|Descargar|Télécharger|Herunterladen)$/i.test((b.textContent||'').trim())||cowork&&b.getAttribute('data-testid')==='file-card-open');if(!button||button.disabled||button.getAttribute('aria-disabled')==='true')return null;
  const key=Object.keys(button).find(k=>k.startsWith('__reactFiber$'));let fiber=key?button[key]:null;
  for(let n=0;n<20&&fiber;n++,fiber=fiber.return){const props=fiber.memoizedProps;if(props?.isStreaming===true||props?.textStreaming===true)return null;const file=props?.file;if(file&&typeof file.name==='string'&&typeof file.path==='string'&&/^\/mnt\//.test(file.path))return {button,file,card,cowork};}
  return null;
 }
 const unsupportedSince=new WeakMap(),unsupportedWarned=new WeakSet();
 function unsupportedReadyCard(card){
  if(!card?.matches('[data-sheet-kind]')||!card.closest('.font-claude-response,.font-claude-message'))return false;const buttons=[...card.querySelectorAll('button')];if(!buttons.some(b=>!b.disabled&&b.getAttribute('aria-disabled')!=='true'))return false;
  for(const button of buttons){const key=Object.keys(button).find(k=>k.startsWith('__reactFiber$'));let fiber=key?button[key]:null;for(let n=0;n<20&&fiber;n++,fiber=fiber.return)if(fiber.memoizedProps?.isStreaming===true||fiber.memoizedProps?.textStreaming===true)return false;}
  return true;
 }
 const pending=new Map();
 bridge.onMessage('asset-transfer-result',m=>{const job=pending.get(m?.requestId);if(!job)return;pending.delete(m.requestId);clearTimeout(job.timer);m.ok?job.resolve(m.result):job.reject(Object.assign(new Error(m.error||'成果保存没有完成'),{code:m.errorCode||null}));});
 function request(action,values){return new Promise((resolve,reject)=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(requestId);reject(Object.assign(new Error('成果保存超时，先核对原编号，不重复覆盖'),{code:'CFB_TIMEOUT'}));},action==='asset_finish'?1320000:120000);pending.set(requestId,{resolve,reject,timer});bridge.send('asset-transfer-request',{requestId,action,...values});});}
 const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
 async function coworkExport(meta,signal){
  const match=location.pathname.match(/^\/cowork\/(cse_[A-Za-z0-9]+)$/);if(!match)throw new Error('Cowork 页面已变化，未读取成果');
  const url=new URL('/v1/code/sessions/'+match[1]+'/file',location.href);url.searchParams.set('path',meta.file.path);
  const response=await fetch(url,{credentials:'same-origin',redirect:'error',signal,headers:{'anthropic-version':'2023-06-01','anthropic-beta':'ccr-byoc-2025-07-29'}});if(!response.ok)throw new Error('Cowork 成果获取失败（HTTP '+response.status+'），未保存');
  // This verified Cowork endpoint returns base64 JSON, not a raw stream. Bound its memory separately.
  const max=96*1024*1024,advertised=Number(response.headers.get('content-length'));
  if(advertised>max){await response.body?.cancel();throw new Error('Cowork JSON 导出过大，未保存；请使用原始文件传输');}
  const reader=response.body.getReader(),decoder=new TextDecoder(),parts=[];let received=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;received+=value.byteLength;if(received>max)throw new Error('Cowork JSON 导出超过安全接收范围，未保存');parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const payload=JSON.parse(parts.join(''));const encoded=payload.content;
  if(typeof encoded!=='string'||encoded.length>Math.ceil(64*1024*1024/3)*4||encoded.length%4!==0||/[^A-Za-z0-9+/=]/.test(encoded)||encoded.includes('=')&&!/^[^=]*={1,2}$/.test(encoded)||encoded.endsWith('==')&&encoded.length<4)throw new Error('Cowork 成果字节格式无效或超过64MiB，未保存');
  const chunks=[];for(let i=0;i<encoded.length;i+=256*1024){if(signal.aborted)throw new Error('页面已关闭，停止接收成果');const text=atob(encoded.slice(i,i+256*1024));const bytes=new Uint8Array(text.length);for(let j=0;j<text.length;j++)bytes[j]=text.charCodeAt(j);chunks.push(bytes);}
  const blob=new Blob(chunks);return {body:blob.stream(),size:blob.size,blob};
 }
 async function exported(meta,signal){
  if(meta.cowork)return coworkExport(meta,signal);
  for(const [name,until]of delayedDownloads)if(until<=Date.now())delayedDownloads.delete(name);
  if(delayedDownloads.size>=128&&!delayedDownloads.has(meta.file.name))throw new Error('慢导出较多，请重新打开页面后核对成果；本次未触发下载');
  const originalClick=HTMLAnchorElement.prototype.click,originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;const blobs=new Map(),deferred=new Set();let timer,restore,settled=false,onAbort,captured=false;
  try{const result=await new Promise((resolve,reject)=>{
   const click=function(){if(this.download!==meta.file.name)return originalClick.call(this);if(settled)return;settled=true;const url=this.href,blob=blobs.get(url);if(!blob&&!(url.startsWith('blob:https://claude.ai/')||new URL(url,location.href).origin==='https://claude.ai')){reject(new Error('不支持的成果来源，未下载或保存'));return;}const response=blob?Promise.resolve({body:blob.stream(),size:blob.size,blob}):fetch(url,{credentials:'same-origin',redirect:'error',signal}).then(r=>{if(!r.ok)throw new Error('成果获取失败');return {body:r.body,size:r.headers.get('content-length')!==null&&/^\d+$/.test(r.headers.get('content-length'))?Number(r.headers.get('content-length')):undefined};});response.then(resolve,reject);};
   const create=function(value){const url=originalCreate.call(URL,value);if(value instanceof Blob&&blobs.size<64)blobs.set(url,value);return url;};
   const revoke=function(url){if(blobs.has(url))deferred.add(url);else originalRevoke.call(URL,url);};
   HTMLAnchorElement.prototype.click=click;URL.createObjectURL=create;URL.revokeObjectURL=revoke;
   restore=()=>{if(HTMLAnchorElement.prototype.click===click)HTMLAnchorElement.prototype.click=originalClick;if(URL.createObjectURL===create)URL.createObjectURL=originalCreate;if(URL.revokeObjectURL===revoke)URL.revokeObjectURL=originalRevoke;};
   onAbort=()=>{settled=true;reject(new Error('页面已切换或关闭，停止保存；原文件保留'));};signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted){onAbort();return;}timer=setTimeout(()=>{settled=true;reject(new Error('网页未提供支持的成果导出，未保存'));},30000);meta.button.click();
  });captured=true;delayedDownloads.delete(meta.file.name);return result;}finally{if(!captured)delayedDownloads.set(meta.file.name,Date.now()+120000);clearTimeout(timer);signal.removeEventListener('abort',onAbort);restore?.();for(const url of deferred)originalRevoke.call(URL,url);}
 }
 let slots=new Map();
 bridge.onMessage('asset-list-request',()=>{
  slots=new Map();const items=[];
  for(const card of [...document.querySelectorAll('[data-sheet-kind]')].slice(-100)){const meta=metadata(card);if(!meta){if(unsupportedReadyCard(card)){const since=unsupportedSince.get(card)??Date.now();unsupportedSince.set(card,since);if(Date.now()-since>=30000&&!unsupportedWarned.has(card)){unsupportedWarned.add(card);bridge.send('asset-detection-notice',{name:(card.getAttribute?.('data-filename')||card.getAttribute?.('title')||'').slice(0,160)});}}else unsupportedSince.delete(card);continue;}unsupportedSince.delete(card);if(!versions.has(meta.file))versions.set(meta.file,++versionCounter);const slot=crypto.randomUUID();meta.version=versions.get(meta.file);meta.route=location.pathname;slots.set(slot,meta);items.push({slot,name:meta.file.name,logicalPath:meta.file.path,version:meta.version,route:location.pathname});}
  bridge.send('asset-list-result',{items});
 });
 bridge.onMessage('asset-export-request',async v=>{
  const meta=slots.get(v?.slot);if(!meta||busy){bridge.send('asset-export-state',{slot:v?.slot,phase:'error',error:'成果已变化或正在保存，请核对状态'});return;}slots.delete(v.slot);busy=true;const operationId=crypto.randomUUID(),controller=new AbortController();activeController=controller;let began=false,beginRequested=false,committing=false;const guard=()=>{if(controller.signal.aborted||location.pathname!==meta.route)throw new Error('页面已切换或关闭，停止保存；请核对操作编号');};
  try{guard();const current=metadata(meta.card||meta.button.closest('[data-sheet-kind]'));if(!current||current.file.name!==meta.file.name||current.file.path!==meta.file.path)throw new Error('成果卡片已变化，未保存');const payload=await exported(current,controller.signal);guard();const assetKey=await sha(new TextEncoder().encode(meta.route+'\n'+meta.file.path));if(payload.blob&&payload.size<=256*1024*1024){const digest=await sha(await payload.blob.arrayBuffer());guard();const check=await request('asset_precheck',{operationId,assetKey,name:meta.file.name,sha256:digest,bytes:payload.size});guard();if(check.upload===false){await payload.body.cancel().catch(()=>{});bridge.send('asset-export-state',{slot:v.slot,name:meta.file.name,phase:'saved',result:check});return;}}beginRequested=true;await request('asset_begin',{operationId,assetKey,name:meta.file.name,...(meta.file.path.startsWith('/mnt/user-data/outputs/')&&meta.file.path.slice(23).includes('/')?{relativeDir:meta.file.path.slice(23).split('/').slice(0,-1).join('/')}:{}) ,...(Number.isSafeInteger(payload.size)&&payload.size>=0?{expectedBytes:payload.size}:{})});began=true;const reader=payload.body.getReader();let sequence=0;try{while(true){guard();const {value,done}=await reader.read();guard();if(done)break;for(let i=0;i<value.length;i+=256*1024){guard();const bytes=value.subarray(i,i+256*1024);await request('asset_chunk',{operationId,sequence:sequence++,data:base64(bytes),sha256:await sha(bytes)});}}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}guard();committing=true;const result=await request('asset_finish',{operationId});bridge.send('asset-export-state',{slot:v.slot,name:meta.file.name,operationId,phase:result.conflict?'conflict':'saved',result});
  }catch(e){if(beginRequested&&!committing)await request('asset_abort',{operationId}).catch(()=>{});if(committing){try{const receipt=await request('asset_status',{operationId});if(receipt.status==='completed'&&receipt.result){bridge.send('asset-export-state',{slot:v.slot,name:meta.file.name,operationId,phase:receipt.result.conflict?'conflict':'saved',result:receipt.result});return;}}catch{}}bridge.send('asset-export-state',{slot:v.slot,name:meta.file.name,operationId,phase:'error',execution:beginRequested?'unknown':'not_started',error:e.message,errorCode:e.code||null});}finally{busy=false;if(activeController===controller)activeController=null;}
 });
 document.addEventListener?.('click',event=>{if(!event.isTrusted)return;const button=event.target?.closest?.('button'),meta=metadata(button?.closest('[data-sheet-kind]'));if(meta?.button===button)delayedDownloads.delete(meta.file.name);},true);
 bridge.onMessage('asset-export-cancel',()=>activeController?.abort());
 window.addEventListener('pagehide',()=>activeController?.abort());
})();
