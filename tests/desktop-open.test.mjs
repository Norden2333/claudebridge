import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {desktopOpenCommand,requestDesktopOpen} from '../companion/desktop-open.mjs';

test('Windows reveal selects the validated file and does not hide Explorer; spaces and Chinese remain one argument',()=>{
 const target='E:\\claude\\猫腻 稿件\\正文 十章.md',directory='E:\\claude\\猫腻 稿件';
 const spec=desktopOpenCommand(target,directory,{platform:'win32',reveal:true});
 assert.deepEqual(spec.args,['/select,',target]);assert.equal(spec.options.shell,false);assert.equal(spec.options.windowsHide,false);
 assert.deepEqual(desktopOpenCommand(directory,directory,{platform:'win32',reveal:true,isDirectory:true}).args,[directory]);
 assert.deepEqual(desktopOpenCommand(target,directory,{platform:'darwin',reveal:true}).args,['-R',target]);
});

test('desktop launch reports a request rather than claiming a visible window and propagates launch errors',async()=>{
 const launched=[];const mock=(command,args,options)=>{launched.push({command,args,options});const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};
 const result=await requestDesktopOpen('E:/claude/file.md','E:/claude',{platform:'win32',reveal:true},mock);
 assert.equal(result.requested,true);assert.equal(result.opened,null);assert.equal(launched.length,1);
 const failed=()=>{const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('error',Object.assign(new Error('launch failed'),{code:'ENOENT'})));return child;};
 await assert.rejects(requestDesktopOpen('x','y',{},failed),/launch failed/);
});

test('workspace groups completed history by full path without hiding pending items or recovery records',async()=>{
 const code=await fs.readFile(new URL('../extension/workspace.js',import.meta.url),'utf8');const ctx=vm.createContext({globalThis:{}});vm.runInContext(code.slice(0,code.indexOf('(function(){')),ctx);
 const rows=[{operationId:'pending',status:'needs_choice',result:{path:'a/note.md'}},{operationId:'new',status:'completed',result:{path:'a/note.md'}},{operationId:'different',status:'completed',result:{path:'b/note.md'}},{operationId:'old',status:'completed',result:{path:'a/note.md'}}];
 const groups=ctx.CFB_groupWorkspaceReceipts(rows);assert.equal(groups.length,3);assert.equal(groups[0].row.operationId,'pending');assert.equal(groups[1].row.operationId,'new');assert.equal(groups[1].previous[0].operationId,'old');assert.equal(groups[2].row.operationId,'different');assert.equal(rows.length,4);
 assert.match(code,/查看恢复选项（可选）/);assert.match(code,/操作已结束，无需处理/);assert.match(code,/result\?\.requested/);
});
