import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
const source=await fs.readFile(new URL('../extension/experience.js',import.meta.url),'utf8'),ctx=vm.createContext({});vm.runInContext(source,ctx);const ui=ctx.CFB_EXPERIENCE;
test('setup gates the first real file check on host, matching version, consent and readable folder',()=>{
 const good={version:'0.6.0',dataConsentGranted:true,folder:{readable:true}};
 assert.match(ui.prerequisites(null,'0.6.0'),/安装/);assert.match(ui.prerequisites(good,'0.5.6'),/版本/);assert.match(ui.prerequisites({...good,dataConsentGranted:false},'0.6.0'),/同意/);assert.match(ui.prerequisites({...good,folder:{readable:false}},'0.6.0'),/文件夹/);assert.equal(ui.prerequisites(good,'0.6.0'),'');
});
test('connection explanations separate device readiness, conversation proof, reconnection and one-minute guidance',()=>{
 const ready={local:'ready',dataConsentGranted:true,config:{relayEnabled:true},relay:{status:'online'}};
 assert.match(ui.connection(ready),/当前对话/);assert.match(ui.connection({...ready,relay:{status:'reconnecting'}}),/无需反复/);assert.match(ui.connection({...ready,relay:{status:'reconnecting'}},61000),/一分钟/);assert.match(ui.connection({local:'missing'},61000),/一分钟/);assert.match(ui.connection({...ready,local:'incompatible'}),/尚未开始/);assert.match(ui.connection({...ready,dataConsentGranted:false}),/同意/);
});
test('file counts use full paths and never equate repeated operation receipts to duplicate files',()=>{
 assert.equal(ui.uniquePaths([{result:{path:'a/draft.md'}},{result:{path:'a'+String.fromCharCode(92)+'draft.md'}},{result:{destination:'b/draft.md'}},{result:{}}]),2);
});
test('native installation paths stay in trusted setup responses, not diagnostic/public content status',async()=>{
 const host=await fs.readFile(new URL('../companion/host.mjs',import.meta.url),'utf8');assert.match(host,/case 'setup_status'.*installationRoot/);assert.ok(!host.slice(host.indexOf('function status()'),host.indexOf('function status()')+500).includes('installationRoot'));
 const background=await fs.readFile(new URL('../extension/background.js',import.meta.url),'utf8');assert.ok(!background.slice(background.indexOf('const publicStatus'),background.indexOf('let assetReadinessKey')).includes('installationRoot'));
});
test('duplicate file failure notices are coalesced until a completed operation clears the issue',async()=>{
 let now=200000;const sent=[],chrome={storage:{session:{get:async()=>({}),set:async()=>{}},local:{get:async()=>({cfbNotices:{enabled:true}})}},permissions:{contains:async()=>true},notifications:{create:async(id,v)=>sent.push({id,...v}),onClicked:{addListener(){}}}};const c=vm.createContext({chrome,self:{},Date:{now:()=>now},setTimeout,clearTimeout});vm.runInContext(await fs.readFile(new URL('../extension/notices.js',import.meta.url),'utf8'),c);const entry={id:'one',scope:'scope',kind:'asset_save',paths:['draft.md'],state:'failed'};c.self.CFB_NOTICES.record(entry);await new Promise(r=>setTimeout(r,0));now+=130000;c.self.CFB_NOTICES.record({...entry,id:'two'});await new Promise(r=>setTimeout(r,0));assert.equal(sent.length,1);c.self.CFB_NOTICES.record({...entry,id:'done',state:'completed'});now+=130000;c.self.CFB_NOTICES.record({...entry,id:'three'});await new Promise(r=>setTimeout(r,0));assert.equal(sent.length,2);
});
test('0.6 keeps its predecessor extension identity, explicit support boundary and installer language keys',async()=>{
 const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8')),m=JSON.parse(await fs.readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));assert.equal(pkg.version,'0.6.0');assert.equal(m.version,pkg.version);assert.deepEqual(m.permissions,['nativeMessaging','alarms','downloads','storage']);const ps=await fs.readFile(new URL('../Windows安装向导.ps1',import.meta.url),'utf8');assert.match(ps,/Step 1: The local program is installed/);assert.match(ps,/load the extension folder/i);
});
