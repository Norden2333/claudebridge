import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { FileExecutor, validateFolder, digest } from '../companion/files.mjs';
import { OfficeZip } from '../companion/office-zip.mjs';
import { parseXml } from '../companion/office.mjs';
import { mcpResult } from '../companion/mcp-result.mjs';
const fixture = name => fs.readFile(new URL('./fixtures/' + name, import.meta.url));
async function environment(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'cfb-media-')), folder = path.join(temp,'selected'); await fs.mkdir(folder);
  t.after(() => fs.rm(temp,{recursive:true,force:true}));
  const config = {folder:await validateFolder(folder),allowWrites:true}, journalRoot = path.join(temp,'state','operations');
  return {folder, config, journalRoot, engine:new FileExecutor(config,{journalRoot})};
}
test('large UTF-8 excerpts and long single lines stay bounded, paginate exactly, skip unchanged content and retain BOM', async t => {
  const {engine,folder} = await environment(t);
  const content = '\uFEFF' + '长文'.repeat(100000) + '\r\nlast'; await fs.writeFile(path.join(folder,'large.md'),content);
  const first = await engine.execute('read_file',{path:'large.md'}); assert.equal(first.content.length,12000); assert.equal(first.truncated,true); assert.ok(first.nextCharOffset);
  const next = await engine.execute('read_file',{path:'large.md',offset:first.nextOffset,char_offset:first.nextCharOffset}); assert.equal(next.content,content.slice(12000,24000));
  const unchanged = await engine.execute('read_file',{path:'large.md',if_sha256:first.sha256}); assert.equal(unchanged.unchanged,true); assert.equal(unchanged.content,undefined);
  const edit = await engine.execute('edit_block',{file_path:'large.md',old_string:'last',new_string:'changed'}); assert.ok(edit.backupId); assert.equal(await fs.readFile(path.join(folder,'large.md'),'utf8'),content.replace('last','changed'));
  assert.equal((await engine.execute('read_file',{path:'large.md',if_sha256:first.sha256})).unchanged,undefined);
});
test('multi-edit is atomic on mismatches/overlap, avoids unchanged writes, retains persistent recovery and refuses undo after intervening edit', async t => {
  const {engine,folder,config,journalRoot} = await environment(t);
  await fs.writeFile(path.join(folder,'note.md'),'one two three'); await engine.execute('read_file',{path:'note.md'});
  await assert.rejects(engine.execute('edit_blocks',{path:'note.md',edits:[{old_string:'one',new_string:'ONE'},{old_string:'absent',new_string:'X'}]}),/唯一/); assert.equal(await fs.readFile(path.join(folder,'note.md'),'utf8'),'one two three');
  await assert.rejects(engine.execute('edit_blocks',{path:'note.md',edits:[{old_string:'one two',new_string:'X'},{old_string:'two',new_string:'Y'}]}),/重叠/);
  const edit = await engine.execute('edit_blocks',{path:'note.md',edits:[{old_string:'one',new_string:'ONE'},{old_string:'three',new_string:'THREE'}]}); assert.equal(await fs.readFile(path.join(folder,'note.md'),'utf8'),'ONE two THREE');
  const restart = new FileExecutor(config,{journalRoot}); const undo = await restart.execute('restore_file',{path:'note.md',backupId:edit.backupId}); assert.equal(undo.restored,true); assert.equal(await fs.readFile(path.join(folder,'note.md'),'utf8'),'one two three');
  const history = await restart.execute('get_file_info',{path:'note.md',history:true}); assert.ok(history.recoverableEdits.some(r=>r.backupId===edit.backupId)); assert.equal(JSON.stringify(history).includes('one two three'),false);
  await restart.execute('restore_file',{path:'note.md',backupId:undo.backupId}); assert.equal(await fs.readFile(path.join(folder,'note.md'),'utf8'),'ONE two THREE');
  await fs.writeFile(path.join(folder,'note.md'),'new external change'); await assert.rejects(restart.execute('restore_file',{path:'note.md',backupId:edit.backupId}),/变化|修改/); assert.equal(await fs.readFile(path.join(folder,'note.md'),'utf8'),'new external change');
});
test('binary image travels as MCP image in both adapters; arbitrary formats copy and move without decoding or overwriting', async t => {
  const {engine,folder} = await environment(t), png = await fixture('pixel.png'); await fs.writeFile(path.join(folder,'pixel.png'),png);
  const raw = await engine.execute('read_file',{path:'pixel.png'}), result = mcpResult(raw); assert.equal(result.content[0].type,'image'); assert.equal(result.content[0].mimeType,'image/png'); assert.ok(!result.content[1].text.includes(png.toString('base64')));
  let handler, request; const ctx = vm.createContext({self:{CFB_TOOL_DEFINITIONS:[{name:'read_file'}],ClaudefsCore:{bridge:{onMessage:(_name,fn)=>handler=fn,send:(_name,m)=>request=m}}}, crypto,setTimeout,clearTimeout}); vm.runInContext(await fs.readFile(new URL('../extension/dispatch.js',import.meta.url),'utf8'),ctx);
  const pending = ctx.self.ClaudefsCore.dispatch.callTool('read_file',{path:'pixel.png'}); handler({id:request.id,ok:true,result:raw}); const native = await pending; assert.equal(native.content[0].type,'image'); assert.equal(native.content[1].text,result.content[1].text);
  const first = ctx.self.ClaudefsCore.dispatch.callTool('read_file',{path:'pixel.png',operation_id:'same-operation'}), firstId = request.id; const second = ctx.self.ClaudefsCore.dispatch.callTool('read_file',{path:'pixel.png',operation_id:'same-operation'}), secondId = request.id; assert.notEqual(firstId,secondId); handler({id:firstId,ok:true,result:raw}); handler({id:secondId,ok:true,result:raw}); await Promise.all([first,second]);
  await assert.rejects(engine.execute('write_file',{path:'pixel.png',content:'clobber'}),/不能|文本/); assert.ok((await fs.readFile(path.join(folder,'pixel.png'))).equals(png));
  const copy = await engine.execute('copy_file',{source:'pixel.png',destination:'copy.png'}); assert.equal(copy.verified,true); assert.equal((await engine.execute('copy_file',{source:'pixel.png',destination:'copy.png'})).conflict,true);
  const info = await engine.execute('get_file_info',{path:'copy.png',checksum:true}); await engine.execute('move_file',{source:'copy.png',destination:'renamed.png',expected_sha256:info.sha256}); assert.ok((await fs.readFile(path.join(folder,'renamed.png'))).equals(png));
});
test('Word and PPT selective text edits preserve original and every unmodified package member, including chart/image/workbook bytes; actual slide order is respected', async t => {
  const {engine,folder} = await environment(t);
  for (const kind of ['docx','pptx']) {
    const data = await fixture('sample.'+kind); await fs.writeFile(path.join(folder,'sample.'+kind),data);
    const read = await engine.execute('read_file',{path:'sample.'+kind}); assert.equal(read.kind,kind); if(kind==='pptx') assert.equal(read.part,'ppt/slides/slide2.xml');
    const item = read.items[0], output = 'edited.'+kind;
    const args = {path:'sample.'+kind,output_path:output,expected_sha256:read.sha256,edits:[{part:read.part,index:item.index,old_text:item.text,new_text:'Updated heading & text'}]};
    const edit = await engine.execute('edit_office_text',args); assert.equal(edit.sourcePreserved,true); assert.equal(edit.verified,true); assert.ok((await fs.readFile(path.join(folder,'sample.'+kind))).equals(data));
    const changedData = await fs.readFile(path.join(folder,output)), original = new OfficeZip(data), changed = new OfficeZip(changedData);
    for(const [name,entry] of original.entries) if(name!==read.part) assert.ok(entry.raw.equals(changed.entries.get(name).raw),name);
    const again = await engine.execute('read_file',{path:output}); assert.equal(again.items[item.index].text,'Updated heading & text'); await assert.rejects(engine.execute('edit_office_text',args),/EEXIST/);
    await assert.rejects(engine.execute('write_file',{path:output,content:'oops'}),/不能/);
    await assert.rejects(engine.execute('edit_office_text',{...args,output_path:'bad.'+kind,edits:[{...args.edits[0],old_text:'wrong'}]}),/文字已变化/); await assert.rejects(fs.access(path.join(folder,'bad.'+kind)),{code:'ENOENT'});
  }
});
test('Excel values/formula cache are read-only; PDF/legacy binary and readonly protocol never become text or a file mutation', async t => {
  const {engine,folder,config} = await environment(t), data = await fixture('sample.xlsx'); await fs.writeFile(path.join(folder,'sample.xlsx'),data);
  const read = await engine.execute('read_file',{path:'sample.xlsx'}); assert.equal(read.sections[0].label,'Sales'); assert.ok(read.items.some(item=>item.formula==='SUM(B2:B3)' && item.valueIsCached));
  await assert.rejects(engine.execute('edit_office_text',{path:'sample.xlsx',output_path:'edited.xlsx',expected_sha256:read.sha256,edits:[]}),/只支持/);
  await fs.writeFile(path.join(folder,'report.pdf'),'%PDF-1.7\nopaque'); const pdf = await engine.execute('read_file',{path:'report.pdf'}); assert.equal(pdf.readable,false); assert.equal(pdf.content,undefined);
  const readonly = new FileExecutor({...config,allowWrites:false}); const protocol = await readonly.execute('write_file',{path:'.claude-file-operation.json',mode:'rewrite',content:JSON.stringify({protocol:'claude-folder-operation/v1',operation:'read',tool:'read_file',args:{path:'sample.xlsx',length:1}})}); assert.equal(protocol.items.length,1); await assert.rejects(fs.access(path.join(folder,'.claude-file-operation.json')),{code:'ENOENT'});
});
test('malformed/encrypted or expansive ZIP and dangerous XML fail before output; no-change edits and invalid JSON do not rewrite originals', async t => {
  const {engine,folder} = await environment(t), data = await fixture('sample.docx'), zip = new OfficeZip(data);
  const damaged = Buffer.from(data); const entry = zip.entries.get('word/document.xml'); damaged[entry.dataStart] ^= 255; assert.throws(()=>new OfficeZip(damaged).read('word/document.xml'));
  const damagedImage = Buffer.from(data), image = [...zip.entries.values()].find(e=>e.name.startsWith('word/media/')); damagedImage[image.dataStart] ^= 255; assert.throws(()=>new OfficeZip(damagedImage).rewrite(new Map([['word/document.xml',zip.read('word/document.xml')]])));
  const encrypted = Buffer.from(data); encrypted.writeUInt16LE(encrypted.readUInt16LE(entry.offset+6)|1,entry.offset+6); assert.throws(()=>new OfficeZip(encrypted));
  const huge = Buffer.from(data); const centralStart = huge.indexOf(entry.central); huge.writeUInt32LE(0xffffffff,centralStart+24); assert.throws(()=>new OfficeZip(huge));
  assert.throws(()=>parseXml(Buffer.from('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///private">]><x>&e;</x>')),/实体/);
  await fs.writeFile(path.join(folder,'data.json'),'{}'); await engine.execute('read_file',{path:'data.json'}); await assert.rejects(engine.execute('edit_block',{file_path:'data.json',old_string:'{}',new_string:'broken'}),/JSON语法/); assert.equal(await fs.readFile(path.join(folder,'data.json'),'utf8'),'{}');
  const before = await fs.stat(path.join(folder,'data.json')); const same = await engine.execute('edit_block',{file_path:'data.json',old_string:'{}',new_string:'{}'}); const after = await fs.stat(path.join(folder,'data.json')); assert.equal(same.changed,false); assert.equal(before.mtimeMs,after.mtimeMs);
});

test('Chat append retries share one bounded id, stable argument order, expiry and explicit ids allow new appends',async()=>{
 let time=0,handler;const requests=[],applied=new Set();const context=vm.createContext({self:{CFB_TOOL_DEFINITIONS:[{name:'write_file'}],ClaudefsCore:{bridge:{onMessage:(_n,fn)=>handler=fn,send:(_n,m)=>{requests.push(m);const replayed=applied.has(m.operationId);applied.add(m.operationId);handler({id:m.id,ok:true,result:{replayed}});}}}},crypto,TextEncoder,Uint8Array,Date:{now:()=>time},location:{pathname:'/chat/test'},setTimeout,clearTimeout});vm.runInContext(await fs.readFile(new URL('../extension/dispatch.js',import.meta.url),'utf8'),context);const call=context.self.ClaudefsCore.dispatch.callTool;
 await call('write_file',{path:'note.txt',mode:'append',content:'same'});const second=await call('write_file',{content:'same',mode:'append',path:'note.txt'});assert.equal(requests[0].operationId,requests[1].operationId);assert.equal(JSON.parse(second.content[0].text).replayed,true);
 time=600001;await call('write_file',{path:'note.txt',mode:'append',content:'same'});assert.notEqual(requests[2].operationId,requests[0].operationId);await call('write_file',{path:'note.txt',mode:'append',content:'same',operation_id:'explicit-append-2'});assert.equal(requests.at(-1).operationId,'explicit-append-2');assert.equal(applied.size,3);
});
