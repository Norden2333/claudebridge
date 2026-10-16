import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {FileExecutor} from '../companion/files.mjs';import {hostedArguments} from '../companion/hosted-arguments.mjs';
import {DesktopCommanderIntegration} from '../vendor/remote-device/desktop-commander-integration.js';
async function fixture(t){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-hosted-args-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));await fs.mkdir(path.join(folder,'sub'));await fs.writeFile(path.join(folder,'sub/a.txt'),'before');return {folder,ex:new FileExecutor({folder,allowWrites:true})};}
test('hosted default directory depth is honored with bounded relative pagination',async t=>{
 const {ex}=await fixture(t);const r=await ex.execute('list_directory',hostedArguments('list_directory',{path:'.',depth:2,origin:'llm'}));assert.ok(r.entries.some(x=>x.name==='sub/a.txt'));assert.equal(r.depth,2);
 const one=await ex.execute('list_directory',{path:'.',depth:2,length:1});assert.equal(one.entries.length,1);assert.equal(one.hasMore,true);const next=await ex.execute('list_directory',{path:'.',depth:2,offset:one.nextOffset,length:1});assert.equal(next.entries[0].name,'sub/a.txt');
 const ordinary=await ex.execute('list_directory',{path:'.'});assert.equal(ordinary.depth,1);assert.equal(ordinary.namesRelativeToRequestedDirectory,true);assert.ok(!ordinary.entries.some(x=>x.name==='sub/a.txt'));
 await assert.rejects(ex.execute('list_directory',{path:'.',depth:0}));await assert.rejects(ex.execute('list_directory',{path:'.',depth:21}));
});
test('hosted edit defaults work without weakening exact replacement or scope protections',async t=>{
 const {folder,ex}=await fixture(t);await ex.execute('read_file',hostedArguments('read_file',{path:'sub/a.txt',origin:'ui'}));const r=await ex.execute('edit_block',hostedArguments('edit_block',{file_path:'sub/a.txt',old_string:'before',new_string:'after',expected_replacements:1,origin:'llm'}));assert.equal(r.replacements,1);assert.equal(r.verified,true);assert.equal(await fs.readFile(path.join(folder,'sub/a.txt'),'utf8'),'after');
 assert.throws(()=>hostedArguments('edit_block',{expected_replacements:2}));assert.throws(()=>hostedArguments('write_file',{origin:'other'}));
 await assert.rejects(ex.execute('write_file',hostedArguments('write_file',{path:'../escaped.txt',content:'never',origin:'llm'})),/所选文件夹/);
 await assert.rejects(ex.execute('list_directory',hostedArguments('list_directory',{path:'.',unrecognized:1})),/参数/);
});
test('depth traversal cannot reveal protected state or follow hardlink aliases',async t=>{
 const {folder}=await fixture(t);const state=path.join(folder,'private');await fs.mkdir(state);await fs.writeFile(path.join(state,'secret.txt'),'FAKE_SECRET');await fs.link(path.join(state,'secret.txt'),path.join(folder,'alias.txt'));const ex=new FileExecutor({folder,allowWrites:true},{internalRoots:[state]});const r=await ex.execute('list_directory',{path:'.',depth:2});assert.ok(!JSON.stringify(r).includes('secret'));assert.ok(!r.entries.some(x=>x.name==='private'||x.name==='alias.txt'));
});
test('real Cowork integration normalizes hosted defaults before strict native execution',async t=>{
 const {folder,ex}=await fixture(t);const bridge=new DesktopCommanderIntegration();bridge.executor=ex;bridge.ready=true;
 const listed=await bridge.callClientTool('list_directory',{path:'.',depth:2,origin:'llm'});assert.ok(JSON.parse(listed.content[0].text).entries.some(e=>e.name==='sub/a.txt'));
 await bridge.callClientTool('read_file',{path:'sub/a.txt',origin:'llm'});
 const edited=await bridge.callClientTool('edit_block',{file_path:'sub/a.txt',old_string:'before',new_string:'after',expected_replacements:1,origin:'llm'},{operationId:'hosted-edit-check'});assert.equal(JSON.parse(edited.content[0].text).replacements,1);
 assert.equal(await fs.readFile(path.join(folder,'sub/a.txt'),'utf8'),'after');
 const bad=await bridge.callClientTool('write_file',{path:'../outside.txt',content:'never',origin:'llm'},{operationId:'hosted-escape-check'});assert.equal(bad.isError,true);
});

test('Cowork errors retain Chinese recovery guidance and operation ID without raw system paths',async()=>{
 const integration=new DesktopCommanderIntegration();integration.ready=true;integration.executor={execute:async()=>{throw Object.assign(new Error('EACCES: private absolute path; 操作编号：recover-call-123'),{code:'EACCES'});}};
 const result=await integration.callClientTool('read_file',{path:'a.txt'});assert.equal(result.isError,true);assert.match(result.content[0].text,/访问权限/);assert.match(result.content[0].text,/recover-call-123/);assert.ok(!result.content[0].text.includes('private absolute path'));
});
