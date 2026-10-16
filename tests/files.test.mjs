import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileExecutor, validateFolder, MAX_BYTES, MAX_TEXT_BYTES } from '../companion/files.mjs';
import { validateProxy } from '../companion/settings.mjs';
import { registrationDirectory, windowsLauncher } from '../companion/install-policy.mjs';

async function fixture(t, writes = true) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb-test-'));
  const folder = path.join(parent, '工作目录'), outside = path.join(parent, 'outside');
  await fs.mkdir(folder); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'private.txt'), 'PRIVATE');
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const engine = new FileExecutor({ folder: await validateFolder(folder), allowWrites: writes });
  return { engine, folder, outside, parent };
}
test('create, read, unique edit, conflict refusal, and no overwrite move', async t => {
  const { engine, folder } = await fixture(t);
  await engine.execute('write_file', { path: 'a.md', content: '第一段\nsecond' });
  let initial = await engine.execute('read_file', { path: 'a.md' }); assert.match(initial.sha256, /^[a-f0-9]{64}$/);
  await engine.execute('edit_block', { file_path: 'a.md', old_string: 'second', new_string: '已修改' });
  assert.equal((await fs.readFile(path.join(folder, 'a.md'), 'utf8')), '第一段\n已修改');
  await fs.writeFile(path.join(folder, 'a.md'), 'external-change');
  await assert.rejects(engine.execute('write_file', { path: 'a.md', content: 'clobber' }), /其他程序修改/);
  assert.equal(await fs.readFile(path.join(folder, 'a.md'), 'utf8'), 'external-change');
  initial = await engine.execute('read_file', { path: 'a.md' });
  await engine.execute('write_file', { path: 'b.md', content: 'destination' });
  assert.equal((await engine.execute('move_file', { source: 'a.md', destination: 'b.md', expected_sha256: initial.sha256 })).conflict,true);assert.equal(await fs.readFile(path.join(folder,'b.md'),'utf8'),'destination');
  await engine.execute('move_file', { source: 'a.md', destination: 'c.md', expected_sha256: initial.sha256 });
  assert.equal(await fs.readFile(path.join(folder, 'c.md'), 'utf8'), 'external-change');
  await assert.rejects(fs.access(path.join(folder, 'a.md')), { code: 'ENOENT' });
});
test('fresh executor cannot blindly overwrite, read-only blocks all mutations, queued edits conflict', async t => {
  const { engine, folder } = await fixture(t);
  await fs.writeFile(path.join(folder, 'a.txt'), 'baseline');
  await assert.rejects(engine.execute('write_file', { path: 'a.txt', content: 'blind' }), /未先读取/);
  const read = await engine.execute('read_file', { path: 'a.txt' });
  const results = await Promise.allSettled([
    engine.execute('write_file', { path: 'a.txt', content: 'first', expected_sha256: read.sha256 }),
    engine.execute('write_file', { path: 'a.txt', content: 'second', expected_sha256: read.sha256 })
  ]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  const readonly = new FileExecutor({ folder: engine.config.folder, allowWrites: false });
  assert.equal((await readonly.execute('read_file', { path: 'a.txt' })).content, 'first');
  for (const [name, args] of [['write_file', { path: 'new', content: 'x' }], ['edit_block', { file_path: 'a.txt', old_string: 'first', new_string: 'x' }], ['create_directory', { path: 'dir' }], ['move_file', { source: 'a.txt', destination: 'new', expected_sha256: read.sha256 }]]) await assert.rejects(readonly.execute(name, args), /修改权限/);
});
test('escapes, absolute external paths, links, link traversal in search, unlisted tools', async t => {
  const { engine, folder, outside } = await fixture(t);
  for (const file of ['../outside/private.txt', path.join(outside, 'private.txt')]) await assert.rejects(engine.execute('read_file', { path: file }), /只允许/);
  await assert.rejects(engine.execute('read_multiple_files', { paths: ['../outside/private.txt'] }), /只允许/);
  await assert.rejects(engine.execute('start_process', { command: 'anything' }), /禁用/);
  await fs.symlink(outside, path.join(folder, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(engine.execute('read_file', { path: 'link/private.txt' }), /符号链接/);
  await assert.rejects(engine.execute('write_file', { path: 'link/new.txt', content: 'x' }), /符号链接/);
  assert.equal((await engine.execute('search_files', { pattern: 'private' })).matches.length, 0);
  assert.equal((await engine.execute('grep_files', { pattern: 'PRIVATE' })).matches.length, 0);
  if (process.platform === 'win32') await assert.rejects(engine.execute('read_file', { path: 'a.txt:secret' }), /特殊 Windows/);
  if (process.platform === 'win32') for (const value of ['.. /outside/private.txt', 'link. /private.txt', 'NUL', 'sub/COM1.txt']) await assert.rejects(engine.execute('read_file', { path: value }), /特殊 Windows/);
});
test('bounded text, binary rejection, directory metadata, searches, argument validation', async t => {
  const { engine, folder } = await fixture(t);
  await engine.execute('create_directory', { path: 'sub' });
  await engine.execute('write_file', { path: 'sub/example.txt', content: 'match\nother\nmatch' });
  assert.equal((await engine.execute('get_file_info', { path: 'sub' })).type, 'directory');
  assert.equal((await engine.execute('search_files', { pattern: 'example' })).matches[0].path, 'sub/example.txt');
  assert.deepEqual((await engine.execute('grep_files', { pattern: 'match' })).matches.map(i => i.line), [1, 3]);
  await fs.writeFile(path.join(folder, 'binary'), Buffer.from([1, 0, 2]));
  const huge=await fs.open(path.join(folder,'oversize'),'wx');await huge.truncate(1024*1024*1024+1);await huge.write(Buffer.alloc(4096,65),0,4096,0);await huge.close();
  assert.equal((await engine.execute('read_file', { path: 'binary' })).readable,false);
  await assert.rejects(engine.execute('read_file',{path:'oversize'}),/1 GiB/);
  await assert.rejects(engine.execute('write_file', { path: 'large', content: 'a'.repeat(MAX_BYTES + 1) }), /4 MiB/);
  await assert.rejects(engine.execute('write_file', { path: 'wrong', content: {} }), /类型/);
  await assert.rejects(engine.execute('list_directory', { command: 'anything' }), /类型/);
  const cfg = JSON.stringify(await engine.execute('get_config', {}));
  assert.ok(!cfg.includes(folder)); assert.ok(!cfg.includes(os.homedir()));
});
test('proxy rejects external or credentialed endpoints and installation paths cover macOS/Linux', () => {
  assert.equal(validateProxy('http://127.0.0.1:7897'), 'http://127.0.0.1:7897');
  assert.equal(validateProxy('http://[::1]:7897'), 'http://[::1]:7897');
  for (const u of ['http://example.com:8080', 'socks5://remote.example:7897', 'http://127.0.0.1', 'http://user:pass@127.0.0.1:7897', 'http://127.0.0.1:7897/path']) assert.throws(() => validateProxy(u));
  assert.equal(registrationDirectory('darwin', '/Users/example'), '/Users/example/Library/Application Support/Google/Chrome/NativeMessagingHosts');
  assert.equal(registrationDirectory('linux', '/home/example'), '/home/example/.config/google-chrome/NativeMessagingHosts');
  assert.equal(registrationDirectory('linux', '/home/example', { XDG_CONFIG_HOME: '/data/custom' }), '/data/custom/google-chrome/NativeMessagingHosts');
  const launcher = windowsLauncher('C:\\Program Files\\node.exe', 'C:\\测试&100%\\host.mjs');
  assert.ok(launcher.includes('100%%')); assert.ok(launcher.includes('DisableDelayedExpansion'));
  assert.throws(() => windowsLauncher('C:\\bad"name', 'host'));
});

test('GBK and BOM UTF16 text read and search retain original hashes while edits remain UTF8-only',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-legacy-text-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const gbk=Buffer.from([0xd6,0xd0,0xce,0xc4,0x0a]),utf16=Buffer.concat([Buffer.from([255,254]),Buffer.from('中文\n','utf16le')]);
 await fs.writeFile(path.join(folder,'legacy.csv'),gbk);await fs.writeFile(path.join(folder,'utf16.txt'),utf16);const ex=new FileExecutor({folder,allowWrites:true});
 for(const [name,encoding,bytes] of [['legacy.csv','gb18030',gbk],['utf16.txt','utf-16le',utf16]]){const read=await ex.execute('read_file',{path:name});assert.equal(read.encoding,encoding);assert.equal(read.editable,false);assert.equal(read.content.trim(),'中文');await assert.rejects(ex.execute('edit_block',{file_path:name,old_string:'中文',new_string:'修改'}),/UTF-8/);assert.deepEqual(await fs.readFile(path.join(folder,name)),bytes);}
 const search=await ex.execute('grep_files',{path:'.',pattern:'中文'});assert.equal(search.matches.length,2);assert.ok(search.matches.every(x=>x.encoding&&x.editable===false));
});

test('directory tool resolves its authorization root once per invocation and rechecks on next call',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-root-per-call-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));for(let i=0;i<5;i++)await fs.writeFile(path.join(folder,'file'+i+'.txt'),'synthetic');const ex=new FileExecutor({folder,allowWrites:false}),realpath=fs.realpath;let roots=0;t.mock.method(fs,'realpath',async name=>{if(String(name)===folder)roots++;return realpath(name);});
 assert.equal((await ex.execute('list_directory',{path:'.'})).entries.length,5);assert.equal(roots,1);await ex.execute('list_directory',{path:'.'});assert.equal(roots,2);
});

test('directory traversal avoids child realpath probes while retaining root rechecks and hardlink exclusions',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-child-target-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));for(let i=0;i<5;i++)await fs.writeFile(path.join(folder,'f'+i+'.txt'),'synthetic');await fs.link(path.join(folder,'f0.txt'),path.join(folder,'alias.txt'));const ex=new FileExecutor({folder,allowWrites:false}),realpath=fs.realpath;let children=0;t.mock.method(fs,'realpath',async name=>{if(String(name).startsWith(folder+path.sep))children++;return realpath(name);});const result=await ex.execute('list_directory',{path:'.'});assert.equal(children,0);assert.ok(!result.entries.some(e=>e.name==='f0.txt'||e.name==='alias.txt'));assert.equal(result.entries.length,4);
});
