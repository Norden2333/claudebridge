import {publishExclusive} from './publish.mjs';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {processingDeadline} from './budget.mjs';
export function assertSingleLink(info) {
  if(info.isFile() && info.nlink !== 1) {const e=new Error('文件是多重硬链接，不能确认只属于授权目录；请通过文件管理器另存普通副本后再使用。');e.code='CFB_HARDLINK';throw e;}
}
export const sha = data => crypto.createHash('sha256').update(data).digest('hex');
export async function readBounded(target, limit) {
  const deadline=processingDeadline();
  const handle = await fs.open(target,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat(); assertSingleLink(before); if (!before.isFile() || before.size > limit) throw new Error('文件过大或不是普通文件；读取上限为' + limit + '字节。');
    const buffer = Buffer.alloc(Math.min(before.size + 1,limit + 1)); let count = 0;
    while (count < buffer.length) {if(Date.now()>deadline)throw new Error('文件处理超过时间预算，未改动源文件。'); const r = await handle.read(buffer,count,buffer.length-count,count); if (!r.bytesRead) break; count += r.bytesRead; }
    const after = await handle.stat(); assertSingleLink(after);
    if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error('读取期间文件发生变化，请重新读取。');
    return buffer.subarray(0,count);
  } finally { await handle.close(); }
}
const sameStat = (a,b) => a.size===b.size && a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs && a.ino===b.ino;
async function walk(handle,before,onChunk,deadline) {
  assertSingleLink(before);
  const buffer=Buffer.alloc(1024*1024), hash=crypto.createHash('sha256'); let position=0;
  if(!before.isFile() || !Number.isSafeInteger(before.size)) throw new Error('不是支持的普通文件。');
  while(position<before.size) {
    if(Date.now()>deadline) throw new Error('文件处理用时过长，源文件保留。请先核对目标和操作结果。');
    const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-position),position);
    if(!bytesRead) throw new Error('处理期间源文件变短，操作停止。');
    const chunk=buffer.subarray(0,bytesRead); hash.update(chunk); if(onChunk) await onChunk(chunk); position+=bytesRead;
  }
  const after=await handle.stat();assertSingleLink(after);
  if(!sameStat(before,after)) throw new Error('处理期间源文件变化，未验证为成功。');
  return {bytes:position,sha256:hash.digest('hex')};
}
export async function fingerprint(target,deadline=processingDeadline()) {
  const handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try { return await walk(handle,await handle.stat(),null,deadline); } finally { await handle.close(); }
}
export async function copyVerified(source,target,{expectedSha256,validateTarget=async()=>{},deadline=processingDeadline()}={}) {
  const input=await fs.open(source,constants.O_RDONLY|(constants.O_NOFOLLOW||0)); let output;
  const temporary=path.join(path.dirname(target),'.cfb-'+crypto.randomUUID()+'.tmp');let created=false;
  try {
    const before=await input.stat(); if(!before.isFile()) throw new Error('只能复制普通文件。');
    await validateTarget();try{await fs.lstat(target);const e=new Error('目标已存在，未覆盖。');e.code='EEXIST';throw e;}catch(e){if(e.code!=='ENOENT')throw e;}
    output=await fs.open(temporary,'wx',0o600);created=true;
    const copied=await walk(input,before,chunk=>output.writeFile(chunk),deadline); await output.sync();await output.utimes(before.atime,before.mtime);await output.sync(); await output.close(); output=null;
    if(expectedSha256 && copied.sha256!==expectedSha256) throw new Error('源文件复制期间变化，请核对目标。');
    await validateTarget(); const stored=await fingerprint(temporary,deadline);
    if(stored.sha256!==copied.sha256 || stored.bytes!==copied.bytes) throw new Error('复制后校验失败，请检查目标，不要盲目重试。');
    const staged=await fs.stat(temporary),publication=await publishExclusive(temporary,target);await fs.rm(temporary,{force:true});created=false;await validateTarget();
    const published=await fs.stat(target);
    if(publication.method==='windows_move'){const actual=await fingerprint(target,deadline);if(actual.sha256!==copied.sha256||actual.bytes!==copied.bytes)throw new Error('文件发布校验未通过，请核对原编号。');}
    else if(published.size!==staged.size||published.ino!==staged.ino||published.mtimeMs!==staged.mtimeMs)throw new Error('发布期间目标变化，校验未通过，源文件保留；请核对原编号，不要重做。');
    return {...copied,verified:true,sourcePreserved:true};
  } finally { await input.close(); if(output) await output.close(); if(created)await fs.rm(temporary,{force:true}); }
}
export async function textExcerpt(target,args={}) {
  const offset=args.offset??0,length=args.length??200,max=args.max_chars??12000,startChar=args.char_offset??0;
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(length)||length<1||length>10000||!Number.isInteger(max)||max<256||max>64000||!Number.isInteger(startChar)||startChar<0)throw new Error('大文本读取范围无效，请使用非负行号和分页。');
  const handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const before=await handle.stat();assertSingleLink(before);if(!before.isFile()||before.size>1024*1024*1024)throw new Error('文字预览支持最多1 GiB，原文件仍可复制、移动或保存下载。');
    const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),hash=crypto.createHash('sha256'),chunk=Buffer.alloc(256*1024),deadline=processingDeadline();
    let position=0,line=0,selected=0,content='';
    const take=text=>{
      let start=0;
      for(let i=0;i<=text.length;i++)if(i===text.length||text[i]==='\n'){
        if(line>=offset&&line<offset+length){const fragment=text.slice(start,i)+(i<text.length&&line<offset+length-1?'\n':'');const from=Math.max(0,startChar-selected),room=max-content.length;if(room>0&&from<fragment.length)content+=fragment.slice(from,from+room);selected+=fragment.length;}
        if(i<text.length)line++;start=i+1;
      }
    };
    while(position<before.size){if(Date.now()>deadline)throw new Error('文本读取用时过长，未改动文件。');const {bytesRead}=await handle.read(chunk,0,Math.min(chunk.length,before.size-position),position);if(!bytesRead)throw new Error('读取期间文件变化。');const bytes=chunk.subarray(0,bytesRead);if(bytes.includes(0))throw new Error('文件不是UTF-8文本。');hash.update(bytes);take(decoder.decode(bytes,{stream:true}));position+=bytesRead;}
    take(decoder.decode());const after=await handle.stat();assertSingleLink(after);if(!sameStat(before,after))throw new Error('读取期间文件变化，请重新读取。');
    const cut=startChar+content.length<selected;
    return {content,sha256:hash.digest('hex'),totalLines:line+1,startLine:offset+1,truncated:cut,hasMore:cut||offset+length<line+1,...(cut?{nextOffset:offset,nextCharOffset:startChar+content.length}:{nextOffset:offset+length})};
  } finally {await handle.close();}
}
