import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import {PNG} from 'pngjs';
import {FileExecutor,validateFolder} from '../companion/files.mjs';
import {fingerprint} from '../companion/safe-io.mjs';
import {imagePreview,MAX_IMAGE_REPLY} from '../companion/images.mjs';
import {importDownload} from '../companion/download-import.mjs';
async function setup(t) {const parent=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-daily-')),folder=path.join(parent,'folder');await fs.mkdir(folder);t.after(()=>fs.rm(parent,{recursive:true,force:true}));return {folder,parent,engine:new FileExecutor({folder:await validateFolder(folder),allowWrites:true})};}
function photo() { const width=900,height=700,data=Buffer.alloc(width*height*4);let seed=12345;for(let p=0;p<data.length;p+=4){for(let c=0;c<3;c++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[p+c]=seed>>>24;}data[p+3]=255;}return {width,height,data}; }
test('common PNG/JPEG larger than old 512KiB limit auto-preview; pixel-detail crop and resolution checks preserve originals',async t=>{
  const {engine,folder}=await setup(t),frame=photo();
  for(const [name,data] of [['large.png',PNG.sync.write(frame)],['large.jpg',jpeg.encode(frame,100).data]]) {
    assert.ok(data.length>512*1024);await fs.writeFile(path.join(folder,name),data);
    const preview=await engine.execute('read_file',{path:name});assert.equal(preview.preview,true);assert.equal(preview.sourcePreserved,true);assert.ok(Buffer.from(preview.__image.data,'base64').length<=MAX_IMAGE_REPLY);assert.equal(preview.originalWidth,900);assert.ok((await fs.readFile(path.join(folder,name))).equals(data));
    const detail=await engine.execute('read_file',{path:name,if_sha256:preview.sha256,image_region:{x:10,y:20,width:200,height:100}});assert.equal(detail.width,200);assert.equal(detail.height,100);assert.equal(detail.region.x,10);
    await assert.rejects(engine.execute('read_file',{path:name,image_region:{x:800,y:20,width:200,height:100}}),/超出/);
  }
  const huge=Buffer.from(PNG.sync.write({width:1,height:1,data:Buffer.from([0,0,0,255])}));huge.writeUInt32BE(60000,16);huge.writeUInt32BE(60000,20);assert.throws(()=>imagePreview(huge,'png'),/分辨率/);
});
test('streamed copy/download/hash and move handle files beyond 64MiB without overwrite or content transfer',async t=>{
  const {engine,folder,parent}=await setup(t),source=path.join(folder,'large.bin'),size=65*1024*1024+17,fd=await fs.open(source,'wx');
  await fd.truncate(size);await fd.write(Buffer.from('begin'),0,5,0);await fd.write(Buffer.from('finish'),0,6,size-6);await fd.close();
  const info=await engine.execute('get_file_info',{path:'large.bin',checksum:true});const copy=await engine.execute('copy_file',{source:'large.bin',destination:'copy.bin',expected_sha256:info.sha256});assert.equal(copy.bytes,size);assert.equal(copy.sha256,info.sha256);assert.equal(copy.verified,true);
  assert.equal((await engine.execute('copy_file',{source:'large.bin',destination:'copy.bin'})).conflict,true);await engine.execute('move_file',{source:'copy.bin',destination:'moved.bin',expected_sha256:copy.sha256});assert.equal((await fingerprint(path.join(folder,'moved.bin'))).sha256,info.sha256);
  const outside=path.join(parent,'large.bin');await fs.copyFile(source,outside);const download=await importDownload(engine,outside,'download-beyond-64-mib');assert.equal(download.bytes,size);assert.equal(download.sha256,info.sha256);assert.equal(download.path,'large (1).bin');assert.ok(await fs.stat(outside));
});
test('longer drafts edit by excerpt; single new text >256KiB and large source still yield compact responses',async t=>{
  const {engine,folder}=await setup(t);const written=await engine.execute('write_file',{path:'generated.md',content:'A'.repeat(600000)});assert.equal(written.bytes,600000);assert.ok(JSON.stringify(written).length<500);
  const text='长文'.repeat(1500000)+'\nending';await fs.writeFile(path.join(folder,'draft.md'),text);const preview=await engine.execute('read_file',{path:'draft.md'});assert.ok(preview.content.length<=12000);const result=await engine.execute('edit_block',{file_path:'draft.md',old_string:'ending',new_string:'changed'});assert.equal(result.verified,true);assert.ok(result.backupId);assert.ok((await fs.readFile(path.join(folder,'draft.md'),'utf8')).endsWith('changed'));
});
test('large folders remain pageable; search supports simple filters, casing variants and a single file',async t=>{
  const {engine,folder}=await setup(t);for(let start=0;start<2100;start+=100) await Promise.all(Array.from({length:Math.min(100,2100-start)},(_,n)=>fs.mkdir(path.join(folder,'empty-'+(start+n)))));
  const page=await engine.execute('list_directory',{});assert.equal(page.total,2100);assert.equal(page.entries.length,100);assert.equal(page.hasMore,true);
  await fs.writeFile(path.join(folder,'NOTES.MD'),'Needle here\nother');await fs.writeFile(path.join(folder,'notes.csv'),'Needle irrelevant');
  const direct=await engine.execute('grep_files',{path:'NOTES.MD',pattern:'needle',ignoreCase:true});assert.equal(direct.matches.length,1);
  const result=await engine.execute('grep_files',{pattern:'needle',filePattern:'**/*.md',ignoreCase:true});assert.equal(result.matches.length,1);assert.equal(result.matches[0].path,'NOTES.MD');
  const remote=await engine.execute('start_search',{searchType:'files',pattern:'notes',filePattern:'*.md',ignoreCase:true});assert.equal(remote.resultCount,1);
});
test('PPT pages and Excel sheet names address the intended content without exposing package paths; expanded batch stays atomic per file',async t=>{
  const {engine,folder}=await setup(t);
  for(const kind of ['pptx','xlsx'])await fs.copyFile(new URL('./fixtures/sample.'+kind,import.meta.url),path.join(folder,'sample.'+kind));
  const first=await engine.execute('read_file',{path:'sample.pptx',page:1});assert.equal(first.part,'ppt/slides/slide2.xml');assert.equal(first.page,1);
  const second=await engine.execute('read_file',{path:'sample.pptx',page:2,if_sha256:first.sha256});assert.equal(second.part,'ppt/slides/slide1.xml');assert.equal(second.page,2);
  const sheet=await engine.execute('read_file',{path:'sample.xlsx',sheet:'sales'});assert.equal(sheet.sheet,'Sales');
  await assert.rejects(engine.execute('read_file',{path:'sample.pptx',page:3}),/部分不存在/);
  const result=await engine.execute('batch_operations',{operations:Array.from({length:40},(_,i)=>({tool:'write_file',args:{path:'note-'+i+'.md',content:'item-'+i}}))});assert.equal(result.completed,40);
});
