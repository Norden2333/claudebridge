import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';
import {folderLock} from '../companion/folder-lock.mjs';
test('lease-owner write failure removes only the newly created lease and never starts file work',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-lock-audit-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const folder=path.join(base,'folder'),root=path.join(base,'locks');await fs.mkdir(folder);let ran=false;const original=fs.open;
 fs.open=async(file,...args)=>{const handle=await original(file,...args);if(path.basename(String(file))==='owner.json'&&String(file).startsWith(root+path.sep)){const write=handle.writeFile.bind(handle);handle.writeFile=async(...values)=>{await write('partial owner');throw Object.assign(new Error('simulated disk full'),{code:'ENOSPC'});};}return handle;};
 try{await assert.rejects(folderLock(folder,root,async()=>{ran=true;}),{code:'ENOSPC'});}finally{fs.open=original;}
 assert.equal(ran,false);assert.deepEqual(await fs.readdir(root),[]);assert.equal(await folderLock(folder,root,async()=>42),42);
});
test('worker recreation labels interrupted batch copy as unknown, preserves ID and queries receipt without repeating import',async()=>{
 const store={cfbBatchDownload:{status:'finished',scope:'scope',folder:'/selected',items:[{id:1,status:'copying',operationId:'original-copy-id'}]}},calls=[],self={CFB_NATIVE_REQUEST:async(action,args)=>{calls.push({action,args});assert.equal(action,'operation_status');assert.equal(args.operationId,'original-copy-id');return {status:'completed',result:{path:'saved.md',verified:true}};}};
 const chrome={storage:{session:{get:async()=>structuredClone(store),set:async x=>Object.assign(store,structuredClone(x))}},downloads:{onCreated:{addListener(){}},onChanged:{addListener(){}},search:async()=>[]}};
 vm.runInContext(await fs.readFile(new URL('../extension/batch-downloads.js',import.meta.url),'utf8'),vm.createContext({self,chrome,Date,URL,crypto}));await new Promise(r=>setTimeout(r,10));const before=await self.CFB_BATCH_DOWNLOADS.status();assert.equal(before.items[0].status,'unknown');assert.equal(before.items[0].operationId,'original-copy-id');assert.equal(calls.length,0);await self.CFB_BATCH_DOWNLOADS.check();assert.equal((await self.CFB_BATCH_DOWNLOADS.status()).items[0].status,'saved');assert.equal(calls.length,1);
});
