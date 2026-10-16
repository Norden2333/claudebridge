import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {FileExecutor} from '../companion/files.mjs';
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-internal-boundary-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const state=path.join(base,'group/state'),program=path.join(base,'program');await fs.mkdir(state,{recursive:true});await fs.mkdir(program);
 await fs.writeFile(path.join(state,'secret.txt'),'PRIVATE_FAKE_TOKEN');await fs.writeFile(path.join(program,'code.txt'),'protected code');await fs.writeFile(path.join(base,'normal.txt'),'normal');
 const ex=new FileExecutor({folder:base,allowWrites:true},{internalRoots:[state,program]});return {base,state,program,ex};
}
test('broad folder grants cannot read or rewrite connection code and private state',async t=>{
 const f=await fixture(t);await assert.rejects(f.ex.execute('read_file',{path:'group/state/secret.txt'}),/连接程序/);
 await assert.rejects(f.ex.execute('write_file',{path:'program/new.txt',content:'replacement'}),/连接程序/);
 assert.equal(await fs.readFile(path.join(f.state,'secret.txt'),'utf8'),'PRIVATE_FAKE_TOKEN');await assert.rejects(fs.access(path.join(f.program,'new.txt')),{code:'ENOENT'});
 assert.equal((await f.ex.execute('read_file',{path:'normal.txt'})).content,'normal');
});
test('ancestor deletion and moves cannot remove internal state through a parent folder',async t=>{
 const f=await fixture(t);await assert.rejects(f.ex.execute('delete_directory',{path:'group',recursive:true,permanent:true,confirmPermanentDelete:true}),/连接程序/);
 await assert.rejects(f.ex.execute('move_file',{source:'group',destination:'moved'}),/连接程序/);
 assert.equal(await fs.readFile(path.join(f.state,'secret.txt'),'utf8'),'PRIVATE_FAKE_TOKEN');
});
test('listing and search omit protected internals while retaining ordinary folder results',async t=>{
 const f=await fixture(t);const rows=await f.ex.execute('list_directory',{path:'.'});assert.ok(!rows.entries.some(x=>x.name==='program'));
 const found=await f.ex.execute('grep_files',{path:'.',pattern:'PRIVATE_FAKE_TOKEN'});assert.equal(found.matches.length,0);
 assert.equal((await f.ex.execute('search_files',{path:'.',pattern:'normal'})).matches.length,1);
});
