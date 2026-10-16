import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {FileExecutor} from '../companion/files.mjs';
test('known credentials and startup locations remain protected while ordinary scripts are editable',async t=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-sensitive-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));await fs.mkdir(path.join(home,'.ssh'));await fs.writeFile(path.join(home,'.ssh','fixture-key'),'synthetic only');
 const ex=new FileExecutor({folder:home,allowWrites:true},{sensitiveHome:home});await assert.rejects(ex.execute('read_file',{path:'.ssh/fixture-key'}),{code:'CFB_SENSITIVE_PATH'});await assert.rejects(ex.execute('write_file',{path:'.ssh/new-key',content:'synthetic only'}),{code:'CFB_SENSITIVE_PATH'});await ex.execute('write_file',{path:'ordinary.ps1',content:'Write-Output "fixture"'});assert.equal(await fs.readFile(path.join(home,'ordinary.ps1'),'utf8'),'Write-Output "fixture"');
});

test('broad folder selection requires explicit confirmation without changing existing optional settings shape',async t=>{
 const {normalizeSettings}=await import('../companion/settings.mjs');const input={folder:os.homedir(),allowWrites:false,relayEnabled:false,networkMode:'auto',proxy:''};await assert.rejects(normalizeSettings(input),{code:'CFB_BROAD_FOLDER'});const fake=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-home-meta-'));t.after(()=>fs.rm(fake,{recursive:true,force:true}));const realpath=fs.realpath;t.mock.method(fs,'realpath',value=>value===os.homedir()?Promise.resolve(fake):realpath(value));assert.equal((await normalizeSettings({...input,broadFolderAccepted:true})).broadFolderAccepted,true);
 // Loading an already saved grant is not a new folder authorization.
 assert.equal((await normalizeSettings(input,{verifyFolder:false})).folder,path.normalize(os.homedir()));
});
test('dangerous new suffixes are rejected while normal scripts remain available; copying or moving cannot bypass',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-new-suffix-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const ex=new FileExecutor({folder,allowWrites:true});
 for(const name of ['test.lnk','test.HTA','test.reg'])await assert.rejects(ex.execute('write_file',{path:name,content:'synthetic'}),{code:'CFB_UNSAFE_SUFFIX'});
 await ex.execute('write_file',{path:'normal.ps1',content:'synthetic'});
 for(const tool of ['copy_file','move_file'])await assert.rejects(ex.execute(tool,{source:'normal.ps1',destination:'new.lnk'}),{code:'CFB_UNSAFE_SUFFIX'});
 assert.equal(await fs.readFile(path.join(folder,'normal.ps1'),'utf8'),'synthetic');assert.deepEqual(await fs.readdir(folder),['normal.ps1']);
 const {assetSafeSuffix}=await import('../companion/sensitive-paths.mjs');assert.equal(assetSafeSuffix('file.exe'),'file.exe.txt');assert.equal(assetSafeSuffix('file.ps1'),'file.ps1');
});
