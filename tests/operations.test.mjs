import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileExecutor } from '../companion/files.mjs';
import { trashCommand } from '../companion/trash.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb-ops-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, engine: new FileExecutor({ folder: await fs.realpath(root), allowWrites: true }) };
}
test('hosted write modes, line ranges, folder moves, search sessions and deletion discovery', async t => {
  const { root, engine } = await fixture(t);
  await engine.execute('create_directory', { path: 'folder' });
  assert.equal((await engine.execute('get_file_info', { path: '.' })).type, 'directory');
  await engine.execute('write_file', { path: 'folder/a.txt', content: 'first\nsecond', mode: 'rewrite' });
  await engine.execute('read_file', { path: 'folder/a.txt', offset: 1, length: 1, isUrl: false });
  await engine.execute('write_file', { path: 'folder/a.txt', content: '\nthird', mode: 'append' });
  assert.equal(await fs.readFile(path.join(root, 'folder/a.txt'), 'utf8'), 'first\nsecond\nthird');
  assert.equal((await engine.execute('read_file', { path: 'folder/a.txt', offset: -1, length: 1 })).content, 'third');
  await assert.rejects(engine.execute('read_file', { path: 'folder/a.txt', isUrl: true }), /URL/);
  await engine.execute('move_file', { source: 'folder', destination: 'renamed' });
  assert.equal((await engine.execute('read_file', { path: 'renamed/a.txt' })).content, 'first\nsecond\nthird');
  const search = await engine.execute('start_search', { path: '.', pattern: 'second', searchType: 'content', literalSearch: true });
  const page = await engine.execute('get_more_search_results', { sessionId: search.sessionId, offset: 0, length: 10 });
  assert.equal(page.matches[0].path, 'renamed/a.txt');
  assert.equal((await engine.execute('list_searches', {})).sessions.length, 1);
  await engine.execute('stop_search', { sessionId: search.sessionId });
  await assert.rejects(engine.execute('get_more_search_results', { sessionId: search.sessionId }), /不存在/);
  assert.equal((await engine.execute('get_config', {})).fileOperationProtocol.permanentFallback, false);
});
test('deletion protocol refuses unknown fields, outside/root/links, implicit recursion and unconfirmed permanent deletion', async t => {
  const { root, engine } = await fixture(t);
  await engine.execute('create_directory', { path: 'folder' });
  await engine.execute('write_file', { path: 'folder/file.txt', content: 'keep' });
  const request = fields => engine.execute('write_file', { path: '.claude-file-operation.json', content: JSON.stringify({ protocol: 'claude-folder-operation/v1', operation: 'delete_directory', path: 'folder', confirmDelete: true, ...fields }), mode: 'rewrite' });
  await assert.rejects(request({}), /recursive/);
  await assert.rejects(request({ path: '.', recursive: true }), /只允许/);
  await assert.rejects(request({ path: '../outside', recursive: true }), /只允许/);
  await assert.rejects(request({ recursive: true, permanent: true }), /confirmPermanentDelete/);
  await assert.rejects(request({ recursive: true, command: 'ignored' }), /无效/);
  const readonly = new FileExecutor({ folder: root, allowWrites: false });
  await assert.rejects(readonly.execute('delete_file', { path: 'folder/file.txt' }), /修改权限/);
  await engine.execute('delete_file', { path: 'folder/file.txt', permanent: true, confirmPermanentDelete: true });
  await engine.execute('delete_directory', { path: 'folder', permanent: true, confirmPermanentDelete: true });
  await assert.rejects(fs.access(path.join(root, '.claude-file-operation.json')), { code: 'ENOENT' });
});
test('three platform trash adapters pass paths as data without an executable command string', () => {
  const sample = '/tmp/quote\' & $(not-executed)/file';
  const linux = trashCommand(sample, 'linux'); assert.deepEqual(linux.args, ['trash', '--', sample]);
  const mac = trashCommand(sample, 'darwin'); assert.equal(mac.command, '/usr/bin/osascript'); assert.equal(mac.args.at(-1), sample); assert.ok(mac.args[2].endsWith('trash-macos.js'));
  const win = trashCommand('C:\\test & %name%\\file.txt', 'win32'); assert.equal(win.env.CLAUDE_RECYCLE_TARGET, 'C:\\test & %name%\\file.txt'); assert.ok(!win.args.join(' ').includes('%name%'));
});
test('Windows real system Recycle Bin contains deleted file and directory payloads', { skip: process.platform !== 'win32'||process.env.CFB_WINDOWS_REAL!=='1' }, async t => {
  const { root, engine } = await fixture(t);
  await engine.execute('write_file', { path: 'test.txt', content: 'real-trash-test' });
  await engine.execute('create_directory', { path: 'folder' });
  await engine.execute('write_file', { path: 'folder/child.txt', content: 'folder-trash-test' });
  const op = { protocol: 'claude-folder-operation/v1', operation: 'batch', operations: [{ tool: 'delete_file', args: { path: 'test.txt' } }, { tool: 'delete_directory', args: { path: 'folder', recursive: true } }] };
  const receipt = await engine.execute('write_file', { path: '.claude-file-operation.json', content: JSON.stringify(op) });
  assert.equal(receipt.completed, 2); assert.ok(receipt.results.every(item => item.result.recycled));
  const script = "$s=New-Object -ComObject Shell.Application; $result=@(); foreach($i in $s.NameSpace(10).Items()){if($i.ExtendedProperty('System.Recycle.DeletedFrom') -eq $env:CFB_TEST_PARENT){$result+=@{name=$i.Name;path=$i.Path}}}; ConvertTo-Json -InputObject @($result) -Compress";
  const reply = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, CFB_TEST_PARENT: root } });
  const items = JSON.parse(reply.stdout); assert.equal(items.length, 2);
  assert.equal(await fs.readFile(items.find(i => i.name === 'test.txt').path, 'utf8'), 'real-trash-test');
  assert.equal(await fs.readFile(path.join(items.find(i => i.name === 'folder').path, 'child.txt'), 'utf8'), 'folder-trash-test');
  // Restore exactly these two test objects through the standard Shell verb.
  const restore = "$s=New-Object -ComObject Shell.Application; foreach($i in @($s.NameSpace(10).Items())){if($i.ExtendedProperty('System.Recycle.DeletedFrom') -eq $env:CFB_TEST_PARENT){$i.InvokeVerb('undelete')}}";
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', restore], { windowsHide: true, env: { ...process.env, CFB_TEST_PARENT: root } });
  for (let i=0;i<30;i++){try{await fs.access(path.join(root,'folder/child.txt'));await fs.access(path.join(root,'test.txt'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.equal(await fs.readFile(path.join(root,'test.txt'),'utf8'),'real-trash-test');
});
