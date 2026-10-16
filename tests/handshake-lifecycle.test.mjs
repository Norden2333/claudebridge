import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const code=await fs.readFile(new URL('../extension/content-main.js',import.meta.url),'utf8');
test('failed landing handshake retries after navigating into chat, while successful sessions do not duplicate servers',()=>{
 const events={},bridgeHandlers={},timers=new Map(),statuses=[],ports=[];let serial=0;const location={href:'https://claude.ai/new',pathname:'/new'};
 const window={postMessage(){},navigation:{addEventListener:(n,f)=>events[n]=f},addEventListener:(n,f)=>events[n]=f};
 class MessageChannel{constructor(){this.port1={close(){},start(){},onmessage:null};this.port2={};ports.push(this.port1);}}
 const self={ClaudefsCore:{bridge:{send:(n,p)=>{if(n==='mcp-handshake-status')statuses.push(p.status);},onMessage:(n,f)=>bridgeHandlers[n]=f}},ClaudefsClaude:{mcp:{SERVER_NAME:'test',handleMessage(){}}}};
 vm.runInContext(code,vm.createContext({self,window,location,document:{hidden:false,addEventListener:(n,f)=>events[n]=f},console:{log(){}},MessageChannel,setTimeout:(f)=>{const id=++serial;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)}));
 for(let i=0;i<5;i++){const [id,f]=timers.entries().next().value;timers.delete(id);f();}
 assert.equal(statuses.at(-1),'failed');const failedCount=ports.length;bridgeHandlers['mcp-handshake-retry']();assert.equal(statuses.at(-1),'pending');assert.equal(ports.length,failedCount+1);location.pathname='/chat/test';events.navigatesuccess();assert.equal(statuses.at(-1),'pending');const last=ports.at(-1);last.onmessage({data:{method:'initialize'}});assert.equal(statuses.at(-1),'success');const count=ports.length;location.pathname='/chat/other';events.navigatesuccess();assert.equal(ports.length,count);
 events.pagehide();assert.equal(timers.size,0);events.pageshow({persisted:true});assert.equal(statuses.at(-1),'pending');
});
