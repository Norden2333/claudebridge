import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {FileExecutor} from '../companion/files.mjs';import {copyVerified} from '../companion/safe-io.mjs';
test('interrupted new binary write never publishes a partial destination',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-binary-atomic-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const target=path.join(base,'new.pptx'),ex=new FileExecutor({folder:base,allowWrites:true});
 const open=fs.open;fs.open=async(file,flags,...args)=>{const handle=await open(file,flags,...args);if(flags==='wx'){const write=handle.writeFile.bind(handle);handle.writeFile=async data=>{await write(data.subarray(0,2));throw new Error('simulated storage failure');};}return handle;};
 try{await assert.rejects(ex.saveNewBinary(target,Buffer.from([0,1,2,3,4])),/storage failure/);}finally{fs.open=open;}
 await assert.rejects(fs.access(target),{code:'ENOENT'});assert.deepEqual(await fs.readdir(base),[]);
});
test('copy rejects final destination corruption instead of reporting verified',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-copy-final-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const source=path.join(base,'source.bin'),target=path.join(base,'target.bin');await fs.writeFile(source,Buffer.from([0,1,2,3]));
 const link=fs.link;fs.link=async(from,to)=>{await link(from,to);if(String(to)===target)await fs.writeFile(target,Buffer.from([0,9,9,9]));};
 try{await assert.rejects(copyVerified(source,target),/校验/);}finally{fs.link=link;}
 assert.deepEqual(await fs.readFile(source),Buffer.from([0,1,2,3]));
});

test('same-volume Windows file move keeps original identity and modification time; copy preserves source mtime',async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-move-metadata-'));t.after(()=>fs.rm(temp,{recursive:true,force:true}));const folder=path.join(temp,'folder');await fs.mkdir(folder);const source=path.join(folder,'source.txt');await fs.writeFile(source,'synthetic file');const date=new Date('2024-01-02T03:04:05.000Z');await fs.utimes(source,date,date);
 const ex=new FileExecutor({folder,allowWrites:true});const before=await fs.stat(source);await ex.execute('read_file',{path:'source.txt'});const moved=await ex.execute('move_file',{source:'source.txt',destination:'moved.txt'});assert.equal(moved.sameFileMoved,true);const after=await fs.stat(path.join(folder,'moved.txt'));assert.equal(after.ino,before.ino);assert.equal(after.mtimeMs,before.mtimeMs);await assert.rejects(fs.stat(source),{code:'ENOENT'});
 await ex.execute('copy_file',{source:'moved.txt',destination:'copy.txt'});assert.equal((await fs.stat(path.join(folder,'copy.txt'))).mtimeMs,before.mtimeMs);assert.equal(await fs.readFile(path.join(folder,'copy.txt'),'utf8'),'synthetic file');
});
