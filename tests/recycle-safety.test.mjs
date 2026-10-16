import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {moveToTrash} from '../companion/trash.mjs';
import {explainError} from '../companion/errors.mjs';
import {windowsCommand} from '../companion/system-tools.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-recycle-safety-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('unsupported Windows locations are rejected without running deletion',async()=>{
 let calls=0;
 await assert.rejects(moveToTrash('\\\\server\\share\\fake.txt',{platform:'win32',runner:async()=>{calls++;}}),{code:'CFB_RECYCLE_UNSUPPORTED'});
 assert.equal(calls,0);
});
test('actual Windows callback guard cancels destructive flags and distinguishes failed and permanent outcomes',{skip:process.platform!=='win32'},async t=>{
 const root=await fixture(t),helper=await fs.readFile(new URL('../companion/recycle-item.ps1',import.meta.url),'utf8');
 const type=helper.match(/Add-Type -TypeDefinition @'([\s\S]*?)'@/)[1];
 const script=path.join(root,'callback-test.ps1');
 await fs.writeFile(script,"$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'"+type+"'@\n"+
  "$a=New-Object ClaudeFolderRecycle.RecycleOnlySink\nif($a.PreDeleteItem(0,$null) -ge 0 -or -not $a.WillNuke){throw 'destructive flags accepted'}\n"+
  "$b=New-Object ClaudeFolderRecycle.RecycleOnlySink\nif($b.PreDeleteItem(128,$null) -ne 0){throw 'recycle flags rejected'}\n"+
  "$null=$b.PostDeleteItem(128,$null,-1,$null)\nif(-not $b.Failed -or $b.Nuked){throw 'failed callback misclassified'}\n"+
  "$c=New-Object ClaudeFolderRecycle.RecycleOnlySink\n$null=$c.PostDeleteItem(128,$null,0,$null)\nif(-not $c.Nuked -or $c.Confirmed -ne 0){throw 'permanent callback misclassified'}\n[Console]::Write('callback-ok')");
 const response=await promisify(execFile)(windowsCommand('powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,timeout:20000});
 assert.equal(response.stdout,'callback-ok');
});
test('actual Windows Shell confirms recycling of a disposable file and empty folder',{skip:process.platform!=='win32'||process.env.CFB_WINDOWS_REAL!=='1'},async t=>{
 const root=await fixture(t),file=path.join(root,'fake-recycle.txt'),folder=path.join(root,'fake-empty-folder');
 await fs.writeFile(file,'fictional recycle test');await fs.mkdir(folder);
 for(const target of [file,folder]){
  const receipt=await moveToTrash(target);assert.equal(receipt.recycled,true);assert.equal(receipt.recoverable,true);
  await assert.rejects(fs.lstat(target),{code:'ENOENT'});
 }
});
test('Windows nonzero helper replies distinguish refusal from permanent deletion',async t=>{
 const root=await fixture(t),target=path.join(root,'fake.txt');await fs.writeFile(target,'fake');
 for(const [reply,code] of [[{recycled:false,reason:'not_recyclable'},'CFB_RECYCLE_UNSUPPORTED'],[{recycled:false,permanentlyDeleted:true},'CFB_PERMANENTLY_DELETED']]){
  await assert.rejects(moveToTrash(target,{platform:'win32',runner:async()=>{throw Object.assign(new Error('helper rejected'),{code:3,stdout:JSON.stringify(reply)});}}),e=>e.code===code&&!explainError(e).includes('系统文件操作失败'));
 }
 assert.equal(await fs.readFile(target,'utf8'),'fake');
});
test('recycle confirmation requires a recycled item receipt and absent source',async t=>{
 const root=await fixture(t),target=path.join(root,'fake.txt');await fs.writeFile(target,'fake');
 await assert.rejects(moveToTrash(target,{platform:'win32',runner:async()=>({stdout:'{"recycled":true}'})}),{code:'CFB_RESULT_UNKNOWN'});
 const result=await moveToTrash(target,{platform:'win32',runner:async()=>{await fs.unlink(target);return {stdout:'{"recycled":true,"confirmedItem":true}'};}});
 assert.equal(result.recycled,true);assert.equal(result.recoverable,true);
});
test('recycle time budget scales with inspected entries; timeout never claims nothing happened',async t=>{
 const root=await fixture(t),target=path.join(root,'tree');await fs.mkdir(target);await fs.writeFile(path.join(target,'one'),'one');await fs.writeFile(path.join(target,'two'),'two');
 for(const scenario of ['present','partial','absent']){
  let timeout;
  await assert.rejects(moveToTrash(target,{entries:100000,platform:'win32',runner:async(_cmd,_args,options)=>{
   timeout=options.timeout;
   if(scenario==='partial')await fs.unlink(path.join(target,'one'));
   if(scenario==='absent')await fs.rm(target,{recursive:true});
   throw Object.assign(new Error('timeout'),{killed:true});
  }}),e=>e.code==='CFB_RESULT_UNKNOWN'&&e.sourceState===(scenario==='absent'?'missing':'present')&&explainError(e).includes('不要直接重做'));
  assert.equal(timeout,530000);
 }
});
