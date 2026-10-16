import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const ctx=vm.createContext({self:{}});
vm.runInContext(await fs.readFile(new URL('../extension/panel.js',import.meta.url),'utf8'),ctx);
const summarize=ctx.self.CFB_PANEL.summarize;
test('preserving a local version is labelled skipped, never saved',()=>{
 const item={kind:'import_download',state:'completed',skipped:true,paths:['same.txt']};assert.equal(summarize({state:{local:'ready'},entries:[item]}).result,'已跳过，保留本机版本');
});
test('rectangle sizing supports square/landscape/portrait, clamps to viewport and handles smaller screens without overflow',()=>{
 const d=ctx.self.CFB_PANEL.dimensions;
 assert.equal(d(300,300,1440,900,true).width,300);assert.equal(d(300,300,1440,900,true).height,300);
 assert.equal(d(500,180,1440,900,true).width,500);assert.equal(d(230,500,1440,900,true).height,500);
 const small=d(500,500,240,320,true);assert.equal(small.width,216);assert.equal(small.height,226);
 const tooBig=d(9000,9000,1024,768,true);assert.equal(tooBig.width,1000);assert.equal(tooBig.height,674);
 assert.equal(d(200,100,1440,900,false).width,220);assert.equal(d(200,100,1440,900,false).height,140);
});
test('compact summary distinguishes local readiness from Cowork reconnecting and keeps unresolved results visible',()=>{
 const state={local:'ready',relayEnabled:true,relay:'reconnecting',folder:'项目'};
 const pending={kind:'write_file',state:'unknown',paths:['旧结果.md']};
 const done={kind:'write_file',state:'completed',verified:true,paths:['新结果.md']};
 const s=summarize({state,entries:[done,pending]});assert.equal(s.local,'本机就绪');assert.equal(s.remote,'Cowork 重连中');assert.equal(s.result,'已保存');assert.equal(s.path,'新结果.md');assert.match(s.warning,/未确认/);
 assert.match(summarize({state,entries:[done],alert:{active:true,message:'Cowork 已断连'}}).warning,/已断连/);
 assert.equal(summarize({state:{...state,relay:'online'},entries:[done]}).warning,'');
 assert.match(summarize({state:{...state,relay:'auth_required'},entries:[]}).warning,/验证/);
 const deleted=summarize({state,entries:[{kind:'delete_file',state:'completed',recycled:true,paths:['旧结果.md']}]});assert.equal(deleted.result,'已移入回收站');
 assert.equal(summarize({state:{local:'unconfigured'},entries:[]}).local,'尚未配置');
});
test('receiving progress remains distinct from atomic commit and verified saved result',()=>{
 const entry={kind:'import_download',state:'running',paths:['report.pptx'],receivedBytes:512,totalBytes:1024};
 assert.equal(summarize({entries:[entry]}).result,'接收 50%');assert.equal(summarize({entries:[{...entry,committing:true}]}).result,'正在校验并保存');assert.equal(summarize({entries:[{...entry,state:'completed',verified:true}]}).result,'已保存');
});

test('historic failed attempts remain in history without claiming unresolved file results after success',()=>{const state={local:'ready',relayEnabled:true,relay:'online'},done={state:'completed',verified:true},failed={state:'failed'};assert.equal(summarize({state,entries:[done,failed]}).warning,'');assert.match(summarize({state,entries:[failed,done]}).warning,/未确认/);assert.match(summarize({state,entries:[done,{state:'unknown'}]}).warning,/未确认/);});

test('local save and model receipt delivery are distinct, automatic transport recovery needs no extra file action',()=>{
 const state={local:'ready',relayEnabled:true,relay:'online',pendingResults:1,resultDeliveryUnconfirmed:true},entries=[{kind:'move_file',channel:'cowork',state:'completed',verified:true,paths:['same.txt']}];let s=summarize({state,entries});assert.equal(s.result,'已保存');assert.equal(s.remote,'Cowork 在线');assert.match(s.warning,/自动发送回执/);s=summarize({state:{...state,pendingResults:0},entries});assert.match(s.warning,/尚未确认/);s=summarize({state:{...state,pendingResults:0,resultDeliveryUnconfirmed:false},entries});assert.equal(s.warning,'');
});

test('compact attention count includes interrupted and blocked autosave without counting ordinary finished history',()=>{
 const r=summarize({state:{local:'ready'},entries:[{state:'completed'},{state:'unknown'},{state:'interrupted'},{state:'conflict'},{state:'partial'},{state:'failed',autoSaveBlocked:true},{state:'failed'}]});assert.equal(r.attentionCount,5);
});

test('four resize corners independently change width/height and anchor the opposite edges',()=>{
 const resize=ctx.self.CFB_PANEL.resizeRect,rect={left:200,top:150,width:300,height:240};
 for(const corner of ['nw','ne','sw','se']){
  const r=resize(rect,corner,30,20,1440,900,true),west=corner.includes('w'),north=corner.includes('n');
  assert.equal(r.width,west?270:330);assert.equal(r.height,north?220:260);assert.equal(r.left,west?230:200);assert.equal(r.top,north?170:150);
  if(west)assert.equal(r.left+r.width,rect.left+rect.width);if(north)assert.equal(r.top+r.height,rect.top+rect.height);
 }
 const edge=resize(rect,'nw',-9000,-9000,1440,900,true);assert.equal(edge.left,12);assert.equal(edge.top,12);
 const se=resize(rect,'se',9000,9000,1440,900,true);assert.equal(se.left+se.width,1428);assert.equal(se.top+se.height+70,888);
});

test('reading a file is completed, never mislabeled as saved; old interrupted paths remain visible',()=>{assert.equal(summarize({entries:[{kind:'read_file',state:'completed',verified:true}]}).result,'完成');assert.match(summarize({entries:[{kind:'write_file',state:'completed',verified:true},{state:'interrupted',paths:['project/old.md']}]}).warning,/project\/old.md/);});


test('connection phases distinguish retirement, retry countdown and unknown interruption',()=>{
 const state={local:'ready',relayEnabled:true,relay:'reconnecting',relayPhase:'retiring',retryInSeconds:99};
 assert.equal(summarize({state}).remote,'Cowork 等待旧连接收尾');
 assert.equal(summarize({state:{...state,relayPhase:'retry_wait',retryInSeconds:17}}).remote,'Cowork 将在 17 秒后重试');
 assert.equal(summarize({state:{...state,relayPhase:'connecting'}}).remote,'Cowork 重连中');
 assert.equal(summarize({state:{...state,relayEnabled:false}}).remote,'Cowork 未开启');
 assert.equal(summarize({state:{...state,relayPhase:'attention',relay:'blocked',relayReason:'identity_unavailable'}}).remote,'登录记录需检查');
});


test('English phase labels use the real bilingual catalog',async()=>{
 const c=vm.createContext({self:{}});vm.runInContext(await fs.readFile(new URL('../extension/i18n-catalog.js',import.meta.url),'utf8'),c);c.CFB_I18N={t:text=>c.CFB_EN_MESSAGES[text]||text};
 vm.runInContext(await fs.readFile(new URL('../extension/panel.js',import.meta.url),'utf8'),c);
 const state={relayEnabled:true,relay:'reconnecting',relayPhase:'retry_wait',retryInSeconds:12};assert.equal(c.self.CFB_PANEL.summarize({state}).remote,'Cowork will retry in 12 seconds');
 assert.equal(c.self.CFB_PANEL.summarize({state:{...state,relayPhase:'retiring'}}).remote,'Cowork is waiting for the previous connection to finish');
});
