import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=await fs.readFile(new URL('../extension/asset-export.js',import.meta.url),'utf8');
function fixture({content='feedback-v1',status=200,bad=false,streaming=false,oversized=false}={}){
 const handlers={},sent=[],requests=[],timers=new Map();let serial=0,clicked=false;
 const file={name:'file.txt',path:'/mnt/user-data/outputs/file.txt'};
 const button={textContent:'',disabled:false,getAttribute:n=>n==='data-testid'?'file-card-open':null,__reactFiber$test:{memoizedProps:{isStreaming:streaming},return:{memoizedProps:{file}}},click(){clicked=true;throw new Error('Must not open or download');}};
 const card={matches:()=>true,closest:()=>({}),querySelectorAll:()=>[button]};
 const bridge={onMessage:(n,f)=>handlers[n]=f,send(n,v){sent.push({n,v});if(n==='asset-transfer-request')handlers['asset-transfer-result']({requestId:v.requestId,ok:true,result:{verified:true}});}};
 class Anchor{click(){throw new Error('Must not download');}}
 class LocalURL extends URL{};LocalURL.createObjectURL=()=>'';LocalURL.revokeObjectURL=()=>{};
 const location={pathname:'/cowork/cse_ValidSession',href:'https://claude.ai/cowork/cse_ValidSession'};
 const context={self:{ClaudefsCore:{bridge}},document:{querySelectorAll:()=>[card]},location,window:{addEventListener(){}},HTMLAnchorElement:Anchor,URL:LocalURL,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Blob,AbortController,atob:s=>Buffer.from(s,'base64').toString('binary'),btoa:s=>Buffer.from(s,'binary').toString('base64'),setTimeout:f=>{timers.set(++serial,f);return serial;},clearTimeout:n=>timers.delete(n),fetch:async(url,options)=>{requests.push({url:String(url),options});const value=JSON.stringify({content:bad?'invalid!':Buffer.from(content).toString('base64'),content_type:'text/plain'});const r=new Response(value,{status});if(oversized)r.headers.set('content-length',String(97*1024*1024));return r;}};
 vm.runInNewContext(source,context);
 return {sent,requests,clicked:()=>clicked,async run(){handlers['asset-list-request']();const item=sent.at(-1).v.items[0];if(item)await handlers['asset-export-request']({slot:item.slot});}};
}
test('Cowork preview-only cards save original bytes without opening preview or browser download',async()=>{
 const f=fixture();await f.run();assert.equal(f.clicked(),false);assert.equal(f.requests.length,1);const u=new URL(f.requests[0].url);assert.equal(u.origin,'https://claude.ai');assert.equal(u.pathname,'/v1/code/sessions/cse_ValidSession/file');assert.equal(u.searchParams.get('path'),'/mnt/user-data/outputs/file.txt');assert.equal(f.requests[0].options.credentials,'same-origin');assert.equal(f.sent.at(-1).v.phase,'saved');const chunks=f.sent.filter(x=>x.v.action==='asset_chunk');assert.equal(Buffer.from(chunks[0].v.data,'base64').toString(),'feedback-v1');assert.equal(f.sent.find(x=>x.v.action==='asset_begin').v.expectedBytes,11);
});
test('Cowork error, invalid base64 and advertised oversized JSON never begin a file mutation',async()=>{
 for(const config of [{status:403},{bad:true},{oversized:true}]){const f=fixture(config);await f.run();assert.equal(f.sent.at(-1).v.phase,'error');assert.equal(f.sent.some(x=>x.v.action==='asset_begin'),false);}
 const empty=fixture({content:''});await empty.run();assert.equal(empty.sent.at(-1).v.phase,'saved');assert.equal(empty.sent.find(x=>x.v.action==='asset_begin').v.expectedBytes,0);
});
test('Cowork streaming cards are not exported prematurely',async()=>{const f=fixture({streaming:true});await f.run();assert.equal(f.requests.length,0);});
