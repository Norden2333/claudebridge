import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile),moduleUrl=new URL('../companion/settings.mjs',import.meta.url).href;
for(const mode of ['corrupt-active-list','staging-failure','sync-failure','commit-failure'])test('atomic settings failure preserves the single permission record: '+mode,async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-settings-atomic-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const a=path.join(base,'a'),b=path.join(base,'b');await fs.mkdir(a);await fs.mkdir(b);
 const code=`import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import {saveSettings,stateRoot,loadSettings} from ${JSON.stringify(moduleUrl)};
 const a=${JSON.stringify(a)},b=${JSON.stringify(b)},mode=${JSON.stringify(mode)},file=path.join(stateRoot,'settings.json');
 await saveSettings({folder:a,allowWrites:false,relayEnabled:false,proxy:''});
 if(mode==='corrupt-active-list'){const bad=JSON.parse(await fs.readFile(file));bad.authorizedFolders='broken';await fs.writeFile(file,JSON.stringify(bad));}
 const before=await fs.readFile(file),open=fs.open,rename=fs.rename;
 fs.open=async(p,flags,...args)=>{const fd=await open(p,flags,...args);if(flags==='wx'&&path.basename(String(p)).startsWith('settings-')){if(mode==='staging-failure')fd.writeFile=async()=>{throw new Error('simulated storage full');};if(mode==='sync-failure')fd.sync=async()=>{throw new Error('simulated sync failure');};}return fd;};
 if(mode==='commit-failure')fs.rename=async(from,to)=>{if(String(to)===file)throw new Error('simulated denied commit');return rename(from,to);};
 try{await assert.rejects(saveSettings({folder:b,allowWrites:true,relayEnabled:false,proxy:''}));}finally{fs.open=open;fs.rename=rename;}
 assert.deepEqual(await fs.readFile(file),before);assert.ok((await fs.readdir(stateRoot)).every(n=>!n.endsWith('.tmp')));
 if(mode==='corrupt-active-list')await assert.rejects(loadSettings());else assert.equal((await loadSettings()).allowWrites,false);`;
 await exec(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CFB_STATE_DIR:path.join(base,'state')},windowsHide:true,timeout:15000});
});
