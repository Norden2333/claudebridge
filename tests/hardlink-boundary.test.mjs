import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {FileExecutor} from '../companion/files.mjs';import {readBounded,fingerprint,copyVerified,textExcerpt} from '../companion/safe-io.mjs';
async function fixture(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-hardlink-test-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const state=path.join(base,'private'),folder=path.join(base,'work');await fs.mkdir(state);await fs.mkdir(folder);const secret=path.join(state,'fake-secret.txt'),alias=path.join(folder,'alias.txt');await fs.writeFile(secret,'SYNTHETIC_PRIVATE_SENTINEL');await fs.link(secret,alias);return {base,state,folder,secret,alias,ex:new FileExecutor({folder,allowWrites:true},{internalRoots:[state]})};}
const denied=e=>e.code==='CFB_HARDLINK';
test('hardlink aliases cannot read, inspect, mutate, copy or delete reserved content',async t=>{
 const f=await fixture(t);
 for(const [name,args]of [['read_file',{path:'alias.txt'}],['get_file_info',{path:'alias.txt',checksum:true}],['describe_files',{paths:['alias.txt']}],['read_multiple_files',{paths:['alias.txt']}],['write_file',{path:'alias.txt',content:'replace'}],['edit_block',{file_path:'alias.txt',old_string:'SYNTHETIC',new_string:'changed'}],['copy_file',{source:'alias.txt',destination:'copied.txt'}],['move_file',{source:'alias.txt',destination:'moved.txt'}],['delete_file',{path:'alias.txt',permanent:true,confirmPermanentDelete:true}]])await assert.rejects(f.ex.execute(name,args),denied,name);
 assert.equal(await fs.readFile(f.secret,'utf8'),'SYNTHETIC_PRIVATE_SENTINEL');assert.equal((await fs.stat(f.alias)).nlink,2);assert.deepEqual(await fs.readdir(f.folder),['alias.txt']);
});
test('search skips hardlink bodies and folder operations refuse linked children',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.folder,'normal.txt'),'ordinary content');
 assert.equal((await f.ex.execute('grep_files',{path:'.',pattern:'SYNTHETIC_PRIVATE_SENTINEL'})).matches.length,0);
 assert.equal((await f.ex.execute('search_files',{path:'.',pattern:'.txt'})).matches.length,1);
 await fs.mkdir(path.join(f.folder,'sub'));await fs.link(f.secret,path.join(f.folder,'sub/alias.txt'));
 await assert.rejects(f.ex.execute('delete_directory',{path:'sub',recursive:true,permanent:true,confirmPermanentDelete:true}),denied);
 await assert.rejects(f.ex.execute('move_file',{source:'sub',destination:'moved-sub'}),denied);
 assert.equal(await fs.readFile(f.secret,'utf8'),'SYNTHETIC_PRIVATE_SENTINEL');
});
test('descriptor readers reject linked aliases but exclusive text/binary publication remains usable',async t=>{
 const f=await fixture(t);
 for(const run of [()=>readBounded(f.alias,1024),()=>fingerprint(f.alias),()=>textExcerpt(f.alias),()=>copyVerified(f.alias,path.join(f.folder,'copy.txt'))])await assert.rejects(run(),denied);
 await f.ex.execute('write_file',{path:'new.txt',content:'normal'});await f.ex.execute('read_file',{path:'new.txt'});await f.ex.execute('edit_block',{file_path:'new.txt',old_string:'normal',new_string:'edited'});
 const copied=await f.ex.execute('copy_file',{source:'new.txt',destination:'copy.txt'});assert.equal(copied.verified,true);
 await f.ex.saveNewBinary(path.join(f.folder,'new.bin'),Buffer.from([0,1,2,3]));assert.deepEqual(await fs.readFile(path.join(f.folder,'new.bin')),Buffer.from([0,1,2,3]));
 for(const p of ['new.txt','copy.txt','new.bin'])assert.equal((await fs.stat(path.join(f.folder,p))).nlink,1);
});
