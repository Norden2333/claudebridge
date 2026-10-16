import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileExecutor, digest } from '../companion/files.mjs';
async function fixture(t) { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cfb-efficiency-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); return { folder, engine: new FileExecutor({ folder: await fs.realpath(folder), allowWrites: true }) }; }
test('whole long text written once; locally verified compact result and excerpt edits', async t => {
  const { folder, engine } = await fixture(t);
  const text = Array.from({ length: 600 }, (_, i) => 'line-' + i).join('\n');
  const saved = await engine.execute('write_file', { path: 'long.md', content: text });
  assert.equal(saved.verified, true); assert.equal(saved.sha256, digest(Buffer.from(await fs.readFile(path.join(folder, 'long.md'))))); assert.ok(JSON.stringify(saved).length < 320);
  const read = await engine.execute('read_file', { path: 'long.md' }); assert.equal(read.content.split('\n').length, 200); assert.equal(read.hasMore, true); assert.equal(read.totalLines, 600);
  const excerpt = await engine.execute('read_file', { path: 'long.md', offset: 490, length: 10 }); assert.equal(excerpt.content.split('\n').length, 10);
  await engine.execute('edit_block', { file_path: 'long.md', old_string: 'line-499\n', new_string: 'edited-499\n' });
  assert.match(await fs.readFile(path.join(folder, 'long.md'), 'utf8'), /edited-499/);
});
test('batch creates, writes, edits and moves with concise receipt; fixed hosted protocol works', async t => {
  const { folder, engine } = await fixture(t);
  const operations = [{ tool: 'create_directory', args: { path: 'result' } }, { tool: 'write_file', args: { path: 'result/a', content: 'before' } }, { tool: 'edit_block', args: { file_path: 'result/a', old_string: 'before', new_string: 'after' } }, { tool: 'move_file', args: { source: 'result/a', destination: 'result/b' } }];
  const result = await engine.execute('write_file', { path: '.claude-file-operation.json', mode: 'rewrite', content: JSON.stringify({ protocol: 'claude-folder-operation/v1', operation: 'batch', operations }) });
  assert.equal(result.completed, 4); assert.equal(await fs.readFile(path.join(folder, 'result/b'), 'utf8'), 'after'); await assert.rejects(fs.access(path.join(folder, '.claude-file-operation.json')));
});
test('batch fails safely with exact partial receipt and preflights escapes and invalid types', async t => {
  const { folder, engine } = await fixture(t);
  const write = { tool: 'write_file', args: { path: 'first', content: 'one' } };
  await assert.rejects(engine.execute('batch_operations', { operations: [write, { tool: 'delete_file', args: { path: '../outside' } }] })); await assert.rejects(fs.access(path.join(folder, 'first')));
  await assert.rejects(engine.execute('batch_operations', { operations: [write, { tool: 'batch_operations', args: { operations: [] } }] }));
  await assert.rejects(engine.execute('batch_operations', { operations: [write, { tool: 'write_file', args: { path: 'bad', content: 2 } }] }));
  const result = await engine.execute('batch_operations', { operations: [write, { tool: 'edit_block', args: { file_path: 'first', old_string: 'missing', new_string: 'two' } }, { tool: 'write_file', args: { path: 'last', content: 'skip' } }] });
  assert.equal(result.completed, 1); assert.equal(result.failedIndex, 1); assert.equal(result.remainingSkipped, 1); assert.equal(result.retryWholeBatch, false); assert.equal(await fs.readFile(path.join(folder, 'first'), 'utf8'), 'one'); await assert.rejects(fs.access(path.join(folder, 'last')));
  const readonly = new FileExecutor({ folder, allowWrites: false }); await assert.rejects(readonly.execute('batch_operations', { operations: [write] }), /修改权限/);
});
test('checksum metadata avoids full read response while preserving conflict protection', async t => {
  const { folder, engine } = await fixture(t); await fs.writeFile(path.join(folder, 'existing'), 'before');
  const info = await engine.execute('get_file_info', { path: 'existing', checksum: true }); assert.ok(info.sha256); assert.equal(info.content, undefined);
  await fs.writeFile(path.join(folder, 'existing'), 'external'); await assert.rejects(engine.execute('write_file', { path: 'existing', content: 'clobber', expected_sha256: info.sha256 }), /其他程序修改/);
});

test('moving one tracked file never invalidates an unrelated batch source baseline',async t=>{
 const {folder,engine}=await fixture(t);await fs.writeFile(path.join(folder,'first.txt'),'first');await fs.writeFile(path.join(folder,'second.txt'),'second');await engine.execute('read_multiple_files',{paths:['first.txt','second.txt']});
 const result=await engine.execute('batch_operations',{operations:[{tool:'move_file',args:{source:'first.txt',destination:'moved-first.txt'}},{tool:'move_file',args:{source:'second.txt',destination:'moved-second.txt'}}]});assert.equal(result.completed,2);assert.equal(result.failedIndex,undefined);assert.equal(await fs.readFile(path.join(folder,'moved-second.txt'),'utf8'),'second');
});
