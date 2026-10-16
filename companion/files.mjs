import {AsyncLocalStorage} from 'node:async_hooks';
const operationRoots=new AsyncLocalStorage();
import {COWORK_BUDGET_MS,COWORK_LOCK_WAIT_MS} from './connection-timing.mjs';
import {assertNewName,sensitivePaths} from './sensitive-paths.mjs';
import {moveExclusive,publishExclusive} from './publish.mjs';
import {processingBudget} from './budget.mjs';
import {readJsonRecord} from './record-io.mjs';
import {PreconditionError} from './precondition.mjs';
import {relocateAssetBindings} from './asset-index.mjs';
import {directoryPage} from './directory-page.mjs';
import fs from 'node:fs/promises';
import {treeSignature} from './undo.mjs';
import {checkProtection,protectedPaths} from './protection.mjs';
import {explainError} from './errors.mjs';
import {assertActive} from './pause.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { moveToTrash } from './trash.mjs';
import { OperationJournal } from './journal.mjs';
import { FileHistory } from './history.mjs';
import { legacyReadOnlyText,fileFormat } from './file-formats.mjs';
import { readBounded, fingerprint, copyVerified, textExcerpt, assertSingleLink } from './safe-io.mjs';
import { parseXml } from './office.mjs';
import { folderLock } from './folder-lock.mjs';
import {processingDeadline} from './budget.mjs';
import { mediaTask } from './media-task.mjs';
import { activitySummary, activityOutcome, scopeId } from './activity.mjs';

export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_BYTES = 64 * 1024 * 1024;
const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const unique=(text,needle)=>{if(!needle)return false;const at=text.indexOf(needle);return at>=0&&text.indexOf(needle,at+needle.length)===-1;};
const file = { path: str };
const conflict={on_conflict:{type:'string',enum:['ask','keep_both','replace','skip']},expected_destination_sha256:str};
const deletion = { ...file, permanent: { type: 'boolean', default: false }, confirmPermanentDelete: { type: 'boolean', default: false } };
const globMatch=(name,pattern,ignoreCase=false)=>{ if(pattern.length>256) throw new Error('文件筛选条件过长。'); if(ignoreCase){name=name.toLowerCase();pattern=pattern.toLowerCase();} pattern=pattern.replace(/^\*\*\//,''); if(/[\\/]/.test(pattern)) throw new Error('请用*.md等文件名筛选，目录通过path指定。'); let i=0,j=0,star=-1,match=0; while(i<name.length){if(pattern[j]==='?' || pattern[j]===name[i]){i++;j++;}else if(pattern[j]==='*'){star=j++;match=i;}else if(star>=0){j=star+1;i=++match;}else return false;} while(pattern[j]==='*')j++;return j===pattern.length;};
export const definitions = [
  ['get_config', 'Report scope and efficient batch protocol once per task; no system paths or secrets.', {}, []],
  ['get_saved_file_status', 'Read the last verified automatic-save receipt for one scoped path; no file body or current checksum. Path-indexed verified receipts; not_found is unknown, not proof of failed saving.', { ...file }, ['path']],
  ['get_operation_status', 'Query a previous operationId after timeout/disconnect; never blindly replay pending or unknown operations.', { operationId: str }, ['operationId']],
  ['list_directory', 'List bounded names; default depth1 and100 items. depth2-20 shows relative nested names; paginate nextOffset.', { ...file, depth:{type:'integer'}, offset: { type: 'integer' }, length: { type: 'integer' } }, []],
  ['read_file', 'Read bounded UTF-8 excerpts up to1 GiB, image preview, or Office part text; structure_only=true lists Office sections without body; never dump a whole folder. PNG/JPEG <=64 MiB auto-preview, image_region selects pixel detail. if_sha256 skips unchanged content. PDF/legacy Office via attachment.', { ...file, structure_only:{type:'boolean'}, offset: { type: 'integer' }, length: { type: 'integer' }, max_chars: { type: 'integer' }, char_offset: { type: 'integer' }, part: str, page: {type:'integer'}, sheet: str, if_sha256: str, max_dimension: {type:'integer'}, image_region: schema({x:{type:'integer'},y:{type:'integer'},width:{type:'integer'},height:{type:'integer'}},['x','y','width','height']), isUrl: { type: 'boolean', default: false } }, ['path']],
  ['read_multiple_files', 'Read excerpts of up to8 UTF-8 files; total text <=16000 chars and source <=64 MiB. Do not request a whole folder.', { paths: { type: 'array', items: str, maxItems: 8 } }, ['paths']],
  ['describe_files','Inspect metadata and support for up to32 selected files without reading their bodies or hashing.',{paths:{type:'array',items:str,maxItems:32}},['paths']],
  ['get_file_info', 'Metadata without content; checksum=true streams a file baseline without a size cap; history=true lists recent text backups.', { ...file, checksum: { type: 'boolean' }, history: { type:'boolean' } }, ['path']],
  ['write_file', 'Chat append without operation_id deduplicates identical arguments for10 minutes within the same page; to append identical text again intentionally, supply a different operation_id. Write complete UTF-8 text in one call up to 4 MiB; no 30-line chunking. Returns cumulative bytes, total_lines, modified and locally verified checksum; do not read back merely to verify. expected_sha256 guards the old file; expected_output_sha256/expected_bytes check the final UTF-8 result before writing. Read existing files first or pass expected_sha256. The reserved .claude-file-operation.json path accepts the deletion protocol from get_config; it never creates a control file.', { ...file, content: str, mode: { type: 'string', enum: ['rewrite', 'append'], default: 'rewrite' }, expected_sha256: str, expected_output_sha256: str, expected_bytes: {type:'integer'} }, ['path', 'content']],
  ['edit_block', 'Replace one exact unique text block. Read the file before editing. Returns replacements count and locally verified receipt, not file body. No fuzzy matching.', { file_path: str, old_string: str, new_string: str, expected_sha256: str }, ['file_path', 'old_string', 'new_string']],
  ['edit_blocks', 'Apply up to 128 exact nonoverlapping text replacements atomically. All checks precede writing; local verification and recovery backup, no full readback.', { ...file, edits: { type: 'array', items: schema({ old_string: str, new_string: str }, ['old_string','new_string']), minItems: 1, maxItems: 128 }, expected_sha256: str }, ['path','edits']],
  ['edit_office_text', 'Word/PPT: change exact text runs in the same file by default; optional output_path explicitly saves a separate copy. Preserve package members; backup and on-disk verification. No layout/pixel/chart editing.', { ...file, output_path: str, expected_sha256: str, edits: { type: 'array', maxItems: 128, items: schema({ part: str, index: { type:'integer' }, old_text: str, new_text: str }, ['part','index','old_text','new_text']) } }, ['path','expected_sha256','edits']],
  ['copy_file', 'Stream-copy regular files of any size. Existing target returns conflict choices; keep_both/skip, or replace with expected_destination_sha256 and local backup. Preserve source bytes, locally verified. Large files may hit processing time budget.', { source: str, destination: str, expected_sha256: str,...conflict }, ['source','destination']],
  ['restore_file', 'Restore a text modification by its backupId. Refuses if the current file changed since that edit; backs up current content for redo.', { ...file, backupId: str }, ['path','backupId']],
  ['create_directory', 'Create directories inside the authorized folder.', file, ['path']],
  ['move_file', 'Move a file or folder inside the authorized folder with explicit same-name choices; replacement needs destination checksum and recovery backup. For files, provide expected_sha256 or establish an unchanged baseline with get_file_info; no full-content read is required for metadata-only movement. Directories cannot contain links.', { source: str, destination: str, expected_sha256: str,...conflict }, ['source', 'destination']],
  ['delete_file', 'Move a regular file to system Trash by default. Permanent deletion requires explicit user intent and both permanent=true and confirmPermanentDelete=true. Trash failure never becomes permanent deletion.', deletion, ['path']],
  ['delete_directory', 'Move a directory to system Trash by default; nonempty directories require recursive=true. Root and links are refused. Permanent deletion requires explicit user intent and both permanent=true and confirmPermanentDelete=true.', { ...deletion, recursive: { type: 'boolean', default: false } }, ['path']],
  ['batch_operations', 'Execute 1-64 mutations or metadata checks in order. Stops on first failure; completed items stay applied. Do not retry the whole batch. Total arguments <=4 MiB; no nested batches. Read text separately with excerpts or read_multiple_files.', {on_conflict:conflict.on_conflict, operations: { type: 'array', minItems: 1, maxItems: 64, items: schema({ tool: str, args: { type: 'object' } }, ['tool', 'args']) } }, ['operations']],
  ['search_files', 'Find names by keyword; filePattern supports * and ?, ignoreCase is optional. Bounded matches, no links.', { ...file, pattern: str, filePattern: str, ignoreCase:{type:'boolean'} }, ['pattern']],
  ['grep_files', 'Search text or one file by keyword; filePattern narrows types and ignoreCase matches casing variants. Bounded snippets, no links.', { ...file, pattern: str, filePattern: str, ignoreCase:{type:'boolean'} }, ['pattern']]
].map(([name, description, properties, required]) => ({ name, description, inputSchema: schema(properties, required) }));
export const mutations = new Set(['write_file', 'edit_block', 'edit_blocks', 'edit_office_text', 'copy_file', 'restore_file', 'create_directory', 'move_file', 'delete_file', 'delete_directory', 'batch_operations']);
for (const def of definitions) if (mutations.has(def.name)) def.inputSchema.properties.operation_id = str;
function textReceipt(content, info) { let lines=content.length?1:0,at=-1; while((at=content.indexOf('\n',at+1))!==-1)lines++; return {bytes:Buffer.byteLength(content),total_lines:lines,modified:info.mtime.toISOString()}; }
export const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const contains = (root, target) => { const r = path.relative(root, target); return !r || (!path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep)); };

export async function validateFolder(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || folder.includes('\0')) throw new Error('请选择一个完整的本机文件夹路径。');
  const canonical = await fs.realpath(folder);
  if (!(await fs.stat(canonical)).isDirectory() || canonical === path.parse(canonical).root) throw new Error('请选择工作文件夹，不能选择整个磁盘。');
  return canonical;
}

export class FileExecutor {
  constructor(config, options = {}) {this.sensitiveRoots=new Set(sensitivePaths(options.sensitiveHome)); this.internalRoots=(options.internalRoots||[]).map(p=>path.resolve(p));this.reservedCanonical=new Set(this.internalRoots); this.assetRoot=options.assetRoot||(options.journalRoot?path.join(path.dirname(options.journalRoot),'assets'):null);this.onActivity = options.onActivity; this.journal = new OperationJournal(options.journalRoot); this.history = new FileHistory(options.historyRoot || (options.journalRoot ? path.join(path.dirname(options.journalRoot),'backups') : null)); this.lockRoot = options.journalRoot ? path.join(path.dirname(options.journalRoot),'folder-locks') : null; this.config = {...config}; this.reads = new Map();this.metadataReads=new Map(); this.readReceipts = new Map(); this.readReceiptTimer=null; this.chain = Promise.resolve(); this.searches = new Map(); }
  rememberReadReceipt(name, operationId, result, folder) {
    // Short-lived memory only: never persist file bodies just to recover a reply.
    const now=performance.now();
    for(const [id,r] of this.readReceipts)if(r.expiresAt<=now||r.folder!==folder)this.readReceipts.delete(id);
    if(!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId))return;
    try{
      const encoded=JSON.stringify(result),bytes=Buffer.byteLength(encoded);
      if(bytes>8*1024*1024)return;
      while(this.readReceipts.size>=64||[...this.readReceipts.values()].reduce((n,r)=>n+r.bytes,0)+bytes>32*1024*1024)this.readReceipts.delete(this.readReceipts.keys().next().value);
      this.readReceipts.set(operationId,{folder,bytes,expiresAt:now+600000,receipt:{operationId,status:'completed',tool:name,retryAllowed:false,capturedAt:new Date().toISOString(),historicalRead:true,result:JSON.parse(encoded)}});
      this.scheduleReadReceiptExpiry();
    }catch{ /* Receipt caching must never turn a successful read into failure. */ }
  }
  clearReadReceipts(){clearTimeout(this.readReceiptTimer);this.readReceiptTimer=null;this.readReceipts.clear();}
  scheduleReadReceiptExpiry(){
    clearTimeout(this.readReceiptTimer);this.readReceiptTimer=null;
    if(!this.readReceipts.size)return;
    const delay=Math.max(1,Math.min(...[...this.readReceipts.values()].map(r=>r.expiresAt))-performance.now());
    this.readReceiptTimer=setTimeout(()=>{
      const now=performance.now();for(const [id,r] of this.readReceipts)if(r.expiresAt<=now)this.readReceipts.delete(id);
      this.scheduleReadReceiptExpiry();
    },delay);
    this.readReceiptTimer.unref?.();
  }
  async operationStatus(operationId) {
    const cached=this.readReceipts.get(operationId);
    if(cached&&cached.folder===this.config.folder&&cached.expiresAt>performance.now())return structuredClone(cached.receipt);
    this.readReceipts.delete(operationId);
    const status=await this.journal.status(this.config.folder,operationId);return status.status==='not_found'?{...status,reason:'relay_restarted_or_expired_or_not_cached',guidance:'读取快照可能已过期或连接已重启；需要时重新读取，读取不会修改文件。'}:status;
  }
  async reservedRoots(){
    if(this.reservedCheckedAt!==undefined&&performance.now()-this.reservedCheckedAt<60000)return [...this.reservedCanonical];
    this.reservedCheckedAt=performance.now();
    for(const root of this.internalRoots)try{this.reservedCanonical.add(await fs.realpath(root));}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const root of [...this.sensitiveRoots])try{this.sensitiveRoots.add(await fs.realpath(root));}catch(e){if(e.code!=='ENOENT'&&e.code!=='EACCES'&&e.code!=='EPERM')throw e;}
    if(this.reservedCanonical.size>256)throw new Error('连接程序内部路径变化过多，请重新核对安装。');return [...this.reservedCanonical];
  }
  async assertInternalTarget(target,tree=false){
    for(const root of await this.reservedRoots())if(contains(root,target)||tree&&contains(target,root)){const e=new Error('连接程序自己的代码、运行环境和私有设置始终受保护，未开放读取或修改。');e.code='CFB_INTERNAL_PATH';throw e;}
    for(const root of this.sensitiveRoots)if(contains(root,target)||tree&&contains(target,root))throw Object.assign(new Error('敏感凭据和自动启动配置受保护，不通过文件工具读取或修改。'),{code:'CFB_SENSITIVE_PATH'});
  }
  checkProtection(name,args){return checkProtection(this,name,args);}
  assertActive(){return assertActive(this.journal.root?path.dirname(this.journal.root):null);}
  execute(name, args = {}, context = {}) {
    if(name==='write_file'&&typeof args?.content==='string'&&Buffer.byteLength(args.content)>MAX_BYTES)return this.journal.execute(this.config.folder,args.operation_id||context.operationId||crypto.randomUUID(),name,{rejectedInput:'content_over_4MiB'},async()=>{throw new PreconditionError('单次新文字或控制请求上限为4 MiB，未开始文件操作。');});
    const eventId = crypto.randomUUID(), started = Date.now();
    let operationId = args?.operation_id || context.operationId || crypto.randomUUID();
    if(name === 'write_file' && typeof args?.content === 'string') { try { const p=JSON.parse(args.content); if(p.protocol==='claude-folder-operation/v1' && p.operationId) operationId=p.operationId; } catch {} }
    const emit = (state,result) => { if(typeof this.onActivity!=='function') return; try { this.onActivity({id:eventId,operationId:typeof operationId==='string'?operationId.slice(0,100):'',scope:scopeId(this.config.folder),channel:context.channel==='cowork'?'cowork':'chat',...activitySummary(this.config.folder,name,args),state,time:Date.now(),elapsed:Date.now()-started,...(Number.isInteger(result?.completed)?{completed:result.completed}:{}),...(result?.recycled?{recycled:true}:{}),...(result?.verified?{verified:true}:{}),...(result?.backupWarning?{backupWarning:true}:{})}); } catch {} };
    emit('queued');
    // Serialize local callers, including configuration changes handled by the host.
    const parallelRead=['get_config','get_operation_status','list_directory','get_file_info','describe_files','get_saved_file_status'].includes(name);
    const cowork=context.channel==='cowork',deadline=started+(cowork?COWORK_BUDGET_MS:1260000);
    const perform=async()=>{
      if(cowork&&Date.now()>=deadline)throw new PreconditionError('超过 Cowork 单次时限，本次尚未开始；请拆分操作。');
      if(!mutations.has(name)&&!['get_config','get_operation_status'].includes(name))await this.assertActive();
      emit('running');
      if (!mutations.has(name)) {
        const result=await this.run(name,args);
        if(context.channel==='cowork'&&context.operationId&&name!=='get_operation_status')this.rememberReadReceipt(name,operationId,result,this.config.folder);
        return result;
      }
      if (name === 'write_file' && typeof args?.content === 'string') { try { const p = JSON.parse(args.content); if (p.protocol === 'claude-folder-operation/v1' && ['status','read'].includes(p.operation) && await this.target(args.path) === path.join(this.config.folder, '.claude-file-operation.json')) { this.validateArguments(definitions.find(d => d.name === 'write_file'), args); const result=await this.fileOperation(args); if(context.channel==='cowork'&&context.operationId)this.rememberReadReceipt('file_operation_'+p.operation,context.operationId,result,this.config.folder); return result; } } catch (e) { if (!(e instanceof SyntaxError)) throw e; } }
      const id = operationId;
      const clean = { ...args }; delete clean.operation_id;
      return this.journal.execute(this.config.folder, id, name, clean, async()=>{try{await this.assertActive();if(name!=='batch_operations'&&!(name==='write_file'&&args.path?.endsWith('.claude-file-operation.json')))await this.checkProtection(name,clean);}catch(e){e.precondition=true;throw e;}return this.run(name,clean);});
    };
    const action=()=>operationRoots.run(new Map(),()=>processingBudget(perform,cowork?Math.max(1,deadline-Date.now()):600000));
    const operation=parallelRead?processingBudget(action,cowork?Math.max(1,deadline-Date.now()):600000):this.chain.then(()=>folderLock(this.config.folder,this.lockRoot,action,{waitMs:cowork?Math.max(0,Math.min(COWORK_LOCK_WAIT_MS,deadline-Date.now())):660000,budgetMs:cowork?Math.max(1,deadline-Date.now()):600000}));
    if(!parallelRead)this.chain=operation.catch(()=>{});
    return operation.then(result => { emit(activityOutcome(result),result); return result; }, error=>{if(cowork&&Date.now()>=deadline&&!error.precondition)error.code='CFB_COWORK_LIMIT';if(error.code)error.message=explainError(error);emit(error.precondition?'rejected':/已暂停/.test(error.message)?'paused':mutations.has(name) && /结果不确定|操作已经开始|操作结果未知|操作编号/.test(error.message) ? 'unknown':'failed'); throw error; });
  }
  async target(value, allowRoot = false) {
    const root = this.config.folder;
    if (!root) throw new Error('请先在扩展设置中选择工作文件夹。');
    if (typeof value !== 'string' || !value.length || value.includes('\0')) throw new Error('文件路径无效。');
    const target = path.resolve(root, value);
    if (!contains(root, target) || (!allowRoot && target === root)) throw new Error('只允许访问所选文件夹内的文件。');
    await this.assertInternalTarget(target);
    if (process.platform === 'win32' && (target.slice(2).includes(':') || value.split(/[\\/]/).some(part => (part !== '.' && part !== '..' && /[. ]$/.test(part)) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))) throw new Error('不允许特殊 Windows 文件路径。');
    try{const roots=operationRoots.getStore();let checked=roots?.get(root);if(!checked){checked=fs.realpath(root);roots?.set(root,checked);}if(await checked!==root)throw new Error('folder changed');}catch{throw Object.assign(new Error('工作文件夹当前不可用（可能已改名、移动或磁盘未连接），未执行文件操作。'),{code:'CFB_FOLDER_UNAVAILABLE'});}
    let ancestor=target;const missing=[];let canonical;
    for(;;){try{canonical=path.join(ancestor===root&&operationRoots.getStore()?.has(root)?await operationRoots.getStore().get(root):await fs.realpath(ancestor),...missing);break;}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(ancestor);if(parent===ancestor)throw e;missing.unshift(path.basename(ancestor));ancestor=parent;}}
    if(!contains(root,canonical))throw Object.assign(new Error('实际路径不在授权文件夹内，未执行操作。'),{code:'CFB_SCOPE_PATH'});
    await this.assertInternalTarget(canonical);
    let walk = root;
    for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
      walk = path.join(walk, segment);
      try { if ((await fs.lstat(walk)).isSymbolicLink()) throw new Error('不允许通过符号链接或目录联接访问文件。'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    try { assertSingleLink(await fs.lstat(target)); } catch(e) { if(e.code!=='ENOENT')throw e; }
    return target;
  }
  label(target) { return path.relative(this.config.folder, target).split(path.sep).join('/') || '.'; }
  async childTarget(parent,name){
    const root=this.config.folder;if(typeof name!=='string'||!name||name==='.'||name==='..'||/[\\/\0]/.test(name)||!contains(root,parent))throw new Error('目录子项路径无效。');
    const candidate=path.join(parent,name);await this.assertInternalTarget(candidate);
    if(process.platform==='win32'&&(/[:]/.test(name)||/[. ]$/.test(name)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)))throw new Error('不允许特殊Windows文件路径。');
    // Real filesystem entry names, not caller aliases. Recheck every parent link,
    // retaining the scope/link boundary while avoiding per-child realpath work.
    let current=root;for(const segment of ['',...path.relative(root,candidate).split(path.sep).filter(Boolean)]){if(segment)current=path.join(current,segment);const stat=await fs.lstat(current);if(stat.isSymbolicLink())throw Object.assign(new Error('不允许通过符号链接或目录联接遍历。'),{code:'CFB_SCOPE_PATH'});if(current!==candidate&&!stat.isDirectory())throw new Error('目录在遍历期间变化。');if(current===candidate)assertSingleLink(stat);}
    return candidate;
  }
  async read(target,{legacy=false}={}) {
    const info = await fs.stat(target); if (!info.isFile() || info.size > MAX_TEXT_BYTES) throw new Error('只支持不超过 64 MiB 的普通文本文件。');
    const data = await readBounded(target, MAX_TEXT_BYTES);
    const decoded=legacyReadOnlyText(target,data);if(decoded){if(!legacy)throw new PreconditionError('非UTF-8文件只读；如需编辑请明确另存UTF-8，原文件未改动。');const sha256=digest(data);this.reads.set(target,sha256);return {path:this.label(target),sha256,bytes:data.length,...decoded};}
    if (!fileFormat(target,data.subarray(0,4096)).textEditable || data.includes(0)) throw new Error('文件不是可编辑的 UTF-8 文本；不能用文字覆盖图片、Office或PDF。');
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); }
      catch { throw new Error('文件不是 UTF-8 文本。'); }
      const sha256 = digest(data); this.reads.set(target, sha256);
      return { path: this.label(target), content, sha256 };
  }
  async format(target) { const handle = await fs.open(target,constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); try { assertSingleLink(await handle.stat());const header = Buffer.alloc(4096), r = await handle.read(header,0,header.length,0); assertSingleLink(await handle.stat());return fileFormat(target,header.subarray(0,r.bytesRead)); } finally { await handle.close(); } }
  async binaryBaseline(target,expected){return this.preflight(async()=>{const result=await fingerprint(target),hash=expected||this.reads.get(target);if(hash){if(result.sha256!==hash)throw new PreconditionError('文件已被其他程序修改，请重新核对后再移动。');return result;}const prior=this.metadataReads.get(target),stat=await fs.lstat(target,{bigint:true});if(!prior||['ino','dev','size','mtimeNs','ctimeNs'].some(key=>String(stat[key])!==prior[key]))throw new PreconditionError('文件未先读取或元数据已变化，请查看文件信息或校验值后再移动。');return result;});}
  excerpt(result, args = {}) {
    const offset=args.offset??0,length=args.length??200,max=args.max_chars??12000,character=args.char_offset??0;
    if(!Number.isInteger(offset)||!Number.isInteger(length)||length<1||length>10000||!Number.isInteger(max)||max<256||max>64000||!Number.isInteger(character)||character<0)throw new Error('读取范围无效。');
    const text=result.content;let totalLines=1,at=-1;
    while((at=text.indexOf('\n',at+1))!==-1)totalLines++;
    const start=offset<0?Math.max(0,totalLines+offset):offset;let line=0,begin=0,end=text.length;
    while(line<start){at=text.indexOf('\n',begin);if(at<0){begin=text.length;break;}begin=at+1;line++;}
    at=begin;for(let n=0;n<length;n++){const next=text.indexOf('\n',at);if(next<0){end=text.length;break;}if(n===length-1){end=next;break;}at=next+1;}
    if(start>=totalLines)begin=end=text.length;
    const selected=Math.max(0,end-begin),content=text.slice(Math.min(end,begin+character),Math.min(end,begin+character+max)),cut=character+content.length<selected;
    return {...result,content,totalLines,startLine:start+1,hasMore:cut||start+length<totalLines,truncated:cut,...(cut?{nextOffset:start,nextCharOffset:character+content.length}:{nextOffset:start+length})};
  }
  async checkBaseline(target, expected) {
    const current = await this.readWithoutTracking(target);
    if (!(expected || this.reads.get(target)) || current.sha256 !== (expected || this.reads.get(target))) throw new PreconditionError('文件未先读取或已被其他程序修改，请重新读取后再编辑。');
    return current;
  }
  async readWithoutTracking(target,options) {
    const before = this.reads.get(target);
    const result = await this.read(target,options);
    if (before === undefined) this.reads.delete(target); else this.reads.set(target, before);
    return result;
  }
  validateArguments(def, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new PreconditionError('工具参数无效。');
    for (const key of Object.keys(args)) {
      const type = def.inputSchema.properties[key]?.type;
      if (!type || (type === 'array' ? !Array.isArray(args[key]) : type === 'integer' ? !Number.isInteger(args[key]) : typeof args[key] !== type)) throw new PreconditionError('工具参数类型无效：'+(/^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/.test(key)?key:'非标准字段')+'；'+(type?'应为'+type:'本机工具不支持这个字段')+'。');
      const choices = def.inputSchema.properties[key].enum;
      if (choices && !choices.includes(args[key])) throw new PreconditionError('工具参数取值无效。');
    }
    for (const key of def.inputSchema.required) if (!(key in args)) throw new PreconditionError('缺少工具参数。');
  }
  async batch(operations,onConflict) {
    if (!this.config.allowWrites) throw new Error('请先开启文件修改权限。');
    if(onConflict!==undefined&&!['ask','keep_both','replace','skip'].includes(onConflict))throw new Error('批量同名处理方式无效，未开始。');
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 64 || Buffer.byteLength(JSON.stringify(operations)) > MAX_BYTES) throw new Error('批量操作只支持1至64项，参数总量不超过4 MiB。');
    for (const item of operations) {
      if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['tool', 'args'].includes(k)) || ![...mutations].filter(n => n !== 'batch_operations').concat('get_file_info').includes(item.tool)) throw new Error('批量操作类型无效；不允许嵌套或读取全文。');
      this.validateArguments(definitions.find(d => d.name === item.tool), item.args);
      if (item.tool === 'write_file' && await this.target(item.args.path) === path.join(this.config.folder, '.claude-file-operation.json')) throw new Error('批量操作不能写入保留协议路径。');
      for (const key of ['path', 'file_path', 'source', 'destination','output_path']) if (key in item.args) await this.target(item.args[key], item.tool === 'get_file_info');
    }
    const results=[],deadline=processingDeadline();
    for (const [index, item] of operations.entries()) {
      if (Date.now() > deadline) return { completed: results.length, results, failedIndex: index, error: "批量时间预算已用完，剩余项目未执行。", remainingSkipped: operations.length - index, retryWholeBatch: false };
      try { await this.assertActive();results.push({ index, tool:item.tool, result: await this.run(item.tool, {...item.args,...(['copy_file','move_file'].includes(item.tool)&&!item.args.on_conflict&&onConflict?{on_conflict:onConflict}:{})}) }); }
      catch (e) {if(!results.length&&e.precondition)throw e;return { completed: results.length, results, failedIndex: index, error: e.code || e.message, paused:/已暂停/.test(e.message), remainingSkipped: operations.length - index - (/已暂停/.test(e.message)?0:1), retryWholeBatch: false }; }
      if(results.at(-1)?.result?.conflict)return {completed:results.length-1,results,failedIndex:index,error:'同名目标需要选择处理方式。',remainingSkipped:operations.length-index-1,retryWholeBatch:false};
    }
    return { completed: results.length, results };
  }
  async run(name, args) {
    // Translate the hosted service's fixed search schema to our bounded executor.
    if (['get_more_search_results', 'stop_search', 'list_searches'].includes(name)) return this.searchSession(name, args);
    if (name === 'start_search') return this.startSearch(args);
    const def = definitions.find(t => t.name === name);
    if (!def) throw new Error('工具不被允许；远程命令和系统配置工具已禁用。');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数无效。');
    this.validateArguments(def, args);
    if (name === 'get_operation_status') return this.operationStatus(args.operationId);
    if (name !== 'get_config' && !this.config.folder) throw new Error('请先选择工作文件夹。');
    if (mutations.has(name) && !this.config.allowWrites) throw new PreconditionError('请先在扩展设置中开启文件修改权限。');
    if (name === 'get_config') return { protectedPaths:(await protectedPaths(this)).slice(0,20), folder: path.basename(this.config.folder || ''), allowedDirectories: ['.'], recoveryHelp:{verified:'Successful writes re-read the final on-disk bytes and compare SHA256; not only an in-memory check.',backups:'Private local recovery copies; no automatic time expiry. Limit4GiB/2000; manage and restore in workspace or restore_file(path,backupId).',deleted:'Use the operating-system Recycle Bin/Trash to restore deletions; permanent deletion cannot be restored.',office:'Text runs only; same-file default. Explicit output_path creates a separate copy.'},toolArgumentHelp:{edit_block_schema:definitions.find(d=>d.name==='edit_block').inputSchema,edit_block:'file_path:string, old_string:string, new_string:string; exact unique replacement',hostedDefaults:'origin ui/llm is metadata; expected_replacements must be1; list_directory depth1-20',hostedSchemaNote:'Hosted tool catalog may omit schemas; reserved write_file protocol uses these same scoped tools.'}, fileOperationsOnly: true, remoteCommandsEnabled: false, allowWrites: !!this.config.allowWrites, fileOperationProtocol: this.operationHelp() };
    if (name === 'write_file' && path.relative(path.join(this.config.folder, '.claude-file-operation.json'), await this.target(args.path)) === '') return this.fileOperation(args);
    if(mutations.has(name)&&name!=='batch_operations')await this.checkProtection(name,args);
    if (name === 'batch_operations') return this.batch(args.operations,args.on_conflict);
    if (name === 'delete_file' || name === 'delete_directory') return this.deleteItem(name, args);
    if(name==='get_saved_file_status'){
      const target=await this.target(args.path),label=this.label(target);
      const prefix=digest(Buffer.from(this.config.folder))+'-';let maps=[];
      if(this.assetRoot){let names=[];try{names=await fs.readdir(this.assetRoot);}catch(e){if(e.code!=='ENOENT')throw e;}
       for(const name of names.filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{64}\.json$/.test(name.slice(prefix.length)))){
        const record=await readJsonRecord(path.join(this.assetRoot,name));if(record.ok&&!record.value?.paused&&typeof record.value?.path==='string'&&record.value.path.replaceAll('\\','/')===label&&/^[a-zA-Z0-9_-]{8,100}$/.test(record.value.operationId||''))maps.push(record.value);
       }
      }
      let receipt;
      for(const map of maps.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))){const saved=await this.journal.status(this.config.folder,map.operationId);if(saved.status==='completed'&&saved.result?.verified&&saved.result.sha256===map.sha256){receipt=saved;break;}}
      if(!receipt){const rows=this.journal.root?await this.journal.scan(this.config.folder):(await this.journal.recent(this.config.folder)).map(record=>({record}));receipt=rows.map(row=>row.record).find(r=>['asset_save','asset_conflict'].includes(r.tool)&&r.status==='completed'&&r.result?.verified===true&&r.result.path?.replaceAll('\\','/')===label);}
      let currentFile;
      try{const stat=await fs.stat(target);currentFile={exists:true,type:stat.isFile()?'file':'directory',bytes:stat.size,modified:stat.mtime.toISOString()};}catch(e){if(e.code!=='ENOENT')throw e;currentFile={exists:false};}
      return {path:label,status:receipt?'last_verified_save':'not_found',historyWindow:null,pathIndexed:true,currentContentRechecked:false,allOperationsSettled:false,currentFile,...(receipt?{lastSuccessfulSave:{operationId:receipt.operationId,savedAt:receipt.endedAt,bytes:receipt.result.bytes,sha256:receipt.result.sha256,verified:true,sameFileUpdated:!!receipt.result.sameFileUpdated}}:{meaning:'No matching retained receipt for this path; saving outcome is unknown.'})};
    }
    if(name==='describe_files'){if(args.paths.length<1||args.paths.length>32)throw new Error('一次查看1至32个文件。');const items=[];for(const value of args.paths){const target=await this.target(value,true),stat=await fs.stat(target);items.push({path:this.label(target),type:stat.isDirectory()?'directory':'file',bytes:stat.size,...(stat.isFile()?{format:await this.format(target)}:{})});}return {items};}
    if (name === 'read_multiple_files') {
      if (!args.paths.length || args.paths.length > 8) throw new Error('一次只能读取 1 至 8 个文件。');
      const targets = await Promise.all(args.paths.map(p => this.target(p)));
      const sizes = await Promise.all(targets.map(p => fs.stat(p)));
      if (sizes.reduce((sum, item) => sum + item.size, 0) > MAX_TEXT_BYTES) throw new Error('文件总大小超过 64 MiB。');
      const results = await Promise.all(targets.map(p => this.read(p)));
      return results.map(result => this.excerpt(result,{ length:100, max_chars:Math.floor(16000/results.length) }));
    }
    if (name === 'copy_file') return this.transfer(name,args);
    if (name === 'edit_office_text') {
      const src = await this.target(args.path), dst = await this.target(args.output_path||args.path), format = await this.format(src);
      if(path.extname(src).toLowerCase()!==path.extname(dst).toLowerCase())throw new PreconditionError('另存目标需保持文档格式。');
      if ((await fingerprint(src)).sha256 !== args.expected_sha256) throw new PreconditionError('文档已变化，请重新读取相关部分。');
      const edited = await this.preflight(()=>mediaTask('patch',src,format.kind,args));if(edited.data)edited.data=Buffer.from(edited.data.buffer,edited.data.byteOffset,edited.data.byteLength);
      if (!edited.changed) return { path:this.label(src), changed:false, sourcePreserved:true, verified:true };
      // Recheck the source after transformation, before committing a separate copy.
      if ((await fingerprint(src)).sha256 !== args.expected_sha256) throw new Error('处理期间原件已变化，没有保存修改。');
      if(src===dst){const result=await this.replaceBinary(dst,edited.data,args.expected_sha256);return {...result,changed:edited.changed,preservedParts:edited.preservedParts,sourcePreserved:false,sameFileUpdated:true,verification:'on-disk SHA256; preserved container members; visual layout not rendered'};}
      await this.saveNewBinary(dst,edited.data); return { path:this.label(dst), source:this.label(src), sourcePreserved:true, changed:edited.changed, preservedParts:edited.preservedParts, verified:true, sha256:digest(edited.data), bytes:edited.data.length, verification:'container and content checks; visual layout not rendered' };
    }
    if (name === 'move_file') return this.transfer(name,args);
    const target = await this.target(args.file_path ?? args.path ?? '.', ['list_directory', 'get_file_info', 'search_files', 'grep_files'].includes(name));
    if (name === 'list_directory') return directoryPage(this,args);
    if (name === 'get_file_info') { const s = await fs.stat(target); const result = { path: this.label(target), type: s.isDirectory() ? 'directory' : 'file', size: s.size, modified: s.mtime.toISOString() }; if(s.isFile()){result.format=await this.format(target);const metadata=await fs.lstat(target,{bigint:true});if(Number(metadata.size)!==s.size)throw new Error('查询期间文件变化，请重新核对。');this.metadataReads.set(target,Object.fromEntries(['ino','dev','size','mtimeNs','ctimeNs'].map(key=>[key,String(metadata[key])])));result.metadataBaselineRecorded=true;} if (args.checksum) { result.sha256 = (await fingerprint(target)).sha256; this.reads.set(target,result.sha256); } if(args.history) result.recoverableEdits = await this.history.list(this.config.folder,this.label(target)); return result; }
    if (name === 'read_file') {
      if (args.isUrl) throw new Error('只允许本机工作文件夹，不能读取 URL。');
      const format = await this.format(target);
      if (args.if_sha256) { const current = (await fingerprint(target)).sha256; this.reads.set(target,current); const newSelection=['offset','length','char_offset','part','page','sheet','image_region','max_dimension','max_chars','structure_only'].some(k=>args[k]!==undefined); if (current === args.if_sha256 && !newSelection) return { path:this.label(target), sha256:current, unchanged:true }; }
      if (format.office) { const sha256=(await fingerprint(target)).sha256; const result=await mediaTask('office',target,format.kind,args); if((await fingerprint(target)).sha256!==sha256)throw new Error('解析期间文档变化，请重新读取。');this.reads.set(target,sha256);return {path:this.label(target),sha256,...result}; }
      if (format.image) {
        if (args.part || args.char_offset || args.offset || args.length) throw new Error('图片不支持文字分页，请选择需要看的像素区域。');
        const baseline=await fingerprint(target),sha256=baseline.sha256,preview=await mediaTask('image',target,format.kind,args);if((await fingerprint(target)).sha256!==sha256)throw new Error('预览期间图片变化，请重新读取。');this.reads.set(target,sha256);
        if(preview.unsupported) return {path:this.label(target),format,readable:false,sourcePreserved:true,guidance:preview.guidance};
        const {data:encoded,mimeType,...details}=preview;
        return {path:this.label(target),sha256,bytes:baseline.bytes,sourcePreserved:true,...details,__image:{mimeType,data:Buffer.from(encoded).toString('base64')},guidance:'Preview only, original unchanged. Fine text/chart details may need image_region or original attachment. No OCR or pixel edit saved.'};
      }
      if(!format.textEditable){if((await fs.stat(target)).size<=MAX_TEXT_BYTES&&['.txt','.csv','.tsv','.md','.log','.ini'].includes(path.extname(target).toLowerCase())){const data=await readBounded(target,MAX_TEXT_BYTES),decoded=legacyReadOnlyText(target,data);if(decoded){const sha256=digest(data);this.reads.set(target,sha256);return this.excerpt({path:this.label(target),sha256,bytes:data.length,...decoded},args);}}return {path:this.label(target),format,readable:false,sourcePreserved:true};}
      if (args.part || args.page!==undefined || args.sheet!==undefined) throw new Error('普通文本不支持Office部分名。');
      if((await fs.stat(target)).size>MAX_TEXT_BYTES){const result=await textExcerpt(target,args);this.reads.set(target,result.sha256);return {path:this.label(target),...result,editingGuidance:'Large text preview; local text edits support64 MiB. Read only relevant ranges.'};}
      return this.excerpt(await this.read(target),args);
    }
    if (name === 'create_directory') {const createdPaths=[];let current=target;while(current!==this.config.folder){try{await fs.lstat(current);break;}catch(e){if(e.code!=='ENOENT')throw e;createdPaths.push(this.label(current));current=path.dirname(current);}}await fs.mkdir(target,{recursive:true});return {path:this.label(target),created:createdPaths.length>0,createdPaths};}
    if (name === 'search_files' || name === 'grep_files') {
      if (!args.pattern) throw new Error('搜索内容不能为空。');
      if(args.filePattern) globMatch('',args.filePattern,args.ignoreCase);
      const result = []; let visited = 0, truncated = false, scannedBytes = 0, budget = 16000; const deadline=Date.now()+20000;
      const matches=text=>(args.ignoreCase ? text.toLowerCase() : text).includes(args.ignoreCase ? args.pattern.toLowerCase() : args.pattern);
      const add=item=>{const size=JSON.stringify(item).length;if(size>budget || result.length>=100){truncated=true;return;} result.push(item);budget-=size;};
      const examine=async candidate=>{
        if(args.filePattern && !globMatch(path.basename(candidate),args.filePattern,args.ignoreCase)) return;
        try { const size=(await fs.stat(candidate)).size;if(size>MAX_TEXT_BYTES) return;if(scannedBytes+size>64*1024*1024){truncated=true;return;}scannedBytes+=size;const read=await this.readWithoutTracking(candidate,{legacy:true}),content=read.content;
          let begin=0,index=0;while(begin<=content.length){const next=content.indexOf('\n',begin),end=next<0?content.length:next,line=content.slice(begin,end);if(matches(line)){add({path:this.label(candidate),line:index+1,...(read.encoding?{encoding:read.encoding,editable:false}:{}),text:line.slice(0,500),...(line.length>500?{textTruncated:true}:{})});if(result.length>=100)truncated=true;if(truncated)break;}if(next<0)break;begin=next+1;index++;}
        }catch(e){if(!['EACCES','ENOENT'].includes(e.code) && !/64 MiB|UTF-8/.test(e.message))throw e;}
      };
      const scan = async dir => {
        await this.target(this.label(dir),true);
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
          if (++visited > 20000 || result.length >= 100 || Date.now()>deadline) { truncated = true; return; }
          if (item.isSymbolicLink()) continue;
          if(item.isFile() && args.filePattern && !globMatch(item.name,args.filePattern,args.ignoreCase)) continue;
          if(item.isFile() && name==='search_files' && !matches(item.name)) continue;
          let candidate;try{candidate=await this.childTarget(dir,item.name);}catch(e){if(['CFB_INTERNAL_PATH','CFB_HARDLINK','CFB_SENSITIVE_PATH'].includes(e.code))continue;throw e;}
          if (name === 'search_files' && matches(item.name) && (!args.filePattern || item.isFile())) add({ path: this.label(candidate) });
          if (item.isDirectory() && !['.git', 'node_modules'].includes(item.name)) await scan(candidate);
          else if (name === 'grep_files' && item.isFile()) await examine(candidate);
          if (truncated || result.length >= 100) { truncated = true; return; }
        }
      };
      if((await fs.stat(target)).isFile()) {if(name==='grep_files') await examine(target);else if(matches(path.basename(target))) add({path:this.label(target)});} else await scan(target);
      return { matches: result, truncated };
    }
    let content = args.content, previous, restoring;
    if(name==='restore_file' && (await this.history.metadata(this.config.folder,args.backupId)).binary)return this.restoreBinary(target,args.backupId);
    if (!fileFormat(target,Buffer.alloc(0)).textEditable) throw new PreconditionError('不能用文本写入覆盖图片、Office或PDF；请另存正确格式的新文件。');
    if (name === 'restore_file') restoring = await this.preflight(()=>this.history.load(this.config.folder,this.label(target),args.backupId));
    try { await fs.lstat(target); previous = await this.checkBaseline(target, args.expected_sha256 || restoring?.record.afterSha256); }
    catch (e) { if (e.code !== 'ENOENT' || ['edit_block','edit_blocks','restore_file'].includes(name)) throw e; if(args.expected_sha256 || this.reads.has(target)) throw new Error('先前读取的文件已不存在，未重新创建；请核对移动或删除情况。'); }
    if (name === 'edit_block') {
      if(Buffer.byteLength(args.old_string)+Buffer.byteLength(args.new_string)>MAX_BYTES)throw new PreconditionError('单次文字替换参数上限4 MiB，未改动。');
      if (!args.old_string || !unique(previous.content,args.old_string)) throw new PreconditionError('原文必须在文件中恰好出现一次。');
      content = previous.content.replace(args.old_string, () => args.new_string);
    }
    if (name === 'edit_blocks') {
      if (!args.edits.length || args.edits.length > 128 || Buffer.byteLength(JSON.stringify(args.edits)) > MAX_BYTES) throw new PreconditionError('一次支持1至128个文字替换。');
      const changes = args.edits.map(edit => {
        if (!edit || Object.keys(edit).some(k => !['old_string','new_string'].includes(k)) || typeof edit.old_string !== 'string' || !edit.old_string || typeof edit.new_string !== 'string' || !unique(previous.content,edit.old_string)) throw new PreconditionError('每个原文片段必须唯一且参数完整；没有改动。');
        const start = previous.content.indexOf(edit.old_string); return { start, end:start+edit.old_string.length, replacement:edit.new_string };
      }).sort((a,b) => a.start-b.start);
      if (changes.some((item,i) => i && item.start < changes[i-1].end)) throw new PreconditionError('替换片段不能重叠；没有改动。');
      content = previous.content; for (const change of changes.reverse()) content = content.slice(0,change.start) + change.replacement + content.slice(change.end);
    }
    if (name === 'restore_file') { if (previous.sha256 !== restoring.record.afterSha256) throw new PreconditionError('恢复前文件又有修改，不能自动覆盖；请先保留当前文件。'); content = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(restoring.data); }
    if (name === 'write_file' && args.mode === 'append' && previous) content = previous.content + content;
    if (name === 'write_file' && (typeof args.content !== 'string' || Buffer.byteLength(args.content) > MAX_BYTES)) throw new PreconditionError('单次新文字写入上限为4 MiB。');
    if (typeof content !== 'string' || Buffer.byteLength(content) > (previous ? MAX_TEXT_BYTES : MAX_BYTES) || content.includes('\0')) throw new PreconditionError('文本结果超过大小限制或含无效内容。');
    if(name==='write_file'&&!previous)assertNewName(target);
    if (name === 'write_file') {
      if (args.expected_bytes !== undefined && (args.expected_bytes < 0 || args.expected_bytes !== Buffer.byteLength(content))) throw new PreconditionError('目标文件字节数不符，未写入。');
      if (args.expected_output_sha256 !== undefined && (!/^[a-fA-F0-9]{64}$/.test(args.expected_output_sha256) || digest(Buffer.from(content)) !== args.expected_output_sha256.toLowerCase())) throw new PreconditionError('目标内容校验值不符，未写入。');
    }
    if (previous && content === previous.content) return { path:this.label(target), changed:false, verified:true, sha256:previous.sha256, ...textReceipt(content,await fs.stat(target)), ...(['edit_block','edit_blocks'].includes(name)?{replacements:0,before_sha256:previous.sha256}:{}) };
    if (path.extname(target).toLowerCase() === '.json') { try { JSON.parse(content); } catch { throw new PreconditionError('JSON语法无效，文件未写入。'); } }
    if(path.extname(target).toLowerCase()==='.svg')await this.preflight(async()=>{if(parseXml(Buffer.from(content)).documentElement.localName!=='svg')throw new PreconditionError('SVG结构无效，文件未写入。');});
    let backup;
    if (!previous) {
      const temporary = path.join(path.dirname(target), '.cfb-' + crypto.randomUUID() + '.tmp');
      let created = true;
      try {
        try { await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); }
        catch (error) { if(error.code==='EEXIST')created=false;throw error; }
        const handle=await fs.open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}
        if ((await fingerprint(temporary)).sha256 !== digest(Buffer.from(content))) throw new Error('临时文件校验失败，未发布目标文件。');
        await this.target(args.path);
        // Exclusive publish: never overwrite a concurrently created destination.
        await publishExclusive(temporary,target);
      } finally { if(created)await fs.rm(temporary,{force:true}); }
    } else {
      const temp = path.join(path.dirname(target), '.cfb-' + crypto.randomUUID() + '.tmp');
      try {
        const info = await fs.stat(target);
        await fs.writeFile(temp, content, { flag: 'wx', mode: info.mode & 0o777 });
        await this.target(args.file_path ?? args.path);
        await this.checkBaseline(target, previous.sha256);
        backup = await this.history.save(this.config.folder,this.label(target),Buffer.from(previous.content),digest(Buffer.from(content)));
        await this.checkBaseline(target, previous.sha256);
        await fs.rename(temp, target);
      } finally { await fs.rm(temp, { force: true }); }
    }
    const expected = digest(Buffer.from(content));
    const actual = await this.readWithoutTracking(await this.target(args.file_path ?? args.path));
    if (actual.sha256 !== expected) throw new Error('写入后的本机校验失败，文件可能被其他程序修改；请勿直接重试覆盖。');
    this.reads.set(target, expected);
    return { path: this.label(target), created:!previous,written: true, verified: true, ...textReceipt(content,await fs.stat(target)), sha256: expected, ...(['edit_block','edit_blocks'].includes(name)?{before_sha256:previous.sha256,replacements:name==='edit_block'?1:args.edits.filter(e=>e.old_string!==e.new_string).length}:{}), ...(backup ? { backupId:backup.backupId, recoverable:true,...(backup.backupWarning?{backupWarning:true}:{}) } : {}), ...(restoring ? { restored:true } : {}) };
  }
  invalidateReads(...targets){const normal=v=>process.platform==='win32'?v.toLowerCase():v;for(const table of [this.reads,this.metadataReads])for(const key of table.keys())if(targets.some(target=>normal(key)===normal(target)||normal(key).startsWith(normal(target)+path.sep)))table.delete(key);}
  async preflight(action){try{return await action();}catch(error){error.precondition=true;throw error;}}
  async transfer(name,args) {
    let src,dst,source,destination,sourceLabel;
    await this.preflight(async()=>{src=await this.target(args.source);dst=await this.target(args.destination);source=await fs.lstat(src);if(source.isFile())assertNewName(dst);try{destination=await fs.lstat(dst);}catch(e){if(e.code!=='ENOENT')throw e;}if(src===dst)throw new PreconditionError('源和目标是同一个文件，未改动。');sourceLabel=this.label(await fs.realpath(src));});
    if(destination){
      const [a,b]=await Promise.all([fs.lstat(src,{bigint:true}),fs.lstat(dst,{bigint:true})]);
      const samePhysicalFile=a.ino!==0n&&a.dev===b.dev&&a.ino===b.ino;
      if(samePhysicalFile||(process.platform==='win32'&&src.toLowerCase()===dst.toLowerCase())){
        if(samePhysicalFile&&name==='move_file'&&source.isFile()&&process.platform==='win32'&&src.toLowerCase()===dst.toLowerCase()){
          const before=await fingerprint(src);if(args.expected_sha256&&args.expected_sha256!==before.sha256||args.expected_destination_sha256&&args.expected_destination_sha256!==before.sha256)throw new PreconditionError('源或目标文件已变化，未改名。');if(!args.expected_sha256)await this.binaryBaseline(src);
          await this.checkProtection(name,args);await fs.rename(src,dst);const after=await fingerprint(dst);if(after.sha256!==before.sha256)throw new Error('改名期间文件变化，请核对；原内容没有主动改写。');await relocateAssetBindings(this.assetRoot,this.config.folder,sourceLabel,this.label(dst));this.invalidateReads(src,dst);return {source:sourceLabel,destination:this.label(dst),moved:true,verified:true,caseOnly:true,sha256:after.sha256};
        }
        throw new PreconditionError('源和目标指向同一个实际文件，未复制、覆盖或删除。');
      }
    }

    if(source.isDirectory()) {
      if(name!=='move_file')throw new PreconditionError('文件夹复制暂不支持，请逐项复制文件。');
      if(contains(src,dst))throw new PreconditionError('不能把文件夹移到自身内部。');
      if(destination){if(args.on_conflict==='skip')return {skipped:true,path:this.label(dst)};if(args.on_conflict==='keep_both')dst=await this.unusedDestination(dst);else return {conflict:true,source:this.label(src),destination:this.label(dst),directory:true,choices:['keep_both','skip']};}
      await this.checkProtection(name,{...args,destination:this.label(dst)});await this.preflight(()=>this.inspectTree(src));const signature=await this.preflight(()=>treeSignature(this,src));await fs.rename(src,dst);await relocateAssetBindings(this.assetRoot,this.config.folder,sourceLabel,this.label(dst),true);this.invalidateReads(src,dst);return {source:this.label(src),destination:this.label(dst),moved:true,directory:true,treeSignature:signature};
    }
    if(!source.isFile())throw new PreconditionError('只能处理普通文件。');
    const baseline=await this.preflight(()=>fingerprint(src));if(args.expected_sha256&&baseline.sha256!==args.expected_sha256)throw new PreconditionError('源文件已变化，未开始。');
    if(name==='move_file'&&!args.expected_sha256)await this.binaryBaseline(src);
    if(destination) {
      if(!destination.isFile())throw new PreconditionError('目标是文件夹，不能用文件替换。');
      if(args.on_conflict==='skip')return {skipped:true,source:this.label(src),destination:this.label(dst)};
      if(args.on_conflict==='keep_both')dst=await this.unusedDestination(dst);
      else {
        const old=await fingerprint(dst);
        if(args.on_conflict!=='replace')return {conflict:true,source:this.label(src),destination:this.label(dst),source_sha256:baseline.sha256,destination_sha256:old.sha256,choices:['keep_both','replace','skip']};
        if(args.expected_destination_sha256!==old.sha256)throw new PreconditionError('替换目标需要确认它的当前校验值；本次未改动。');
        const temp=await this.target(this.label(path.join(path.dirname(dst),'.cfb-'+crypto.randomUUID()+'.tmp')));
        try{
          await copyVerified(src,temp,{expectedSha256:baseline.sha256,validateTarget:()=>this.target(this.label(temp))});
          const backup=await this.history.saveBinary(this.config.folder,this.label(dst),dst,baseline.sha256);
          if((await fingerprint(dst)).sha256!==old.sha256||(await fingerprint(src)).sha256!==baseline.sha256)throw new Error('替换前文件变化，没有覆盖。');
          await this.target(this.label(dst));await fs.rename(temp,dst);
          if((await fingerprint(dst)).sha256!==baseline.sha256)throw new Error('目标校验失败，先核对结果。');
          if(name==='move_file') {if((await fingerprint(src)).sha256!==baseline.sha256)throw new Error('源文件变化，保留源文件。');await fs.unlink(src);await relocateAssetBindings(this.assetRoot,this.config.folder,sourceLabel,this.label(dst));}
          this.invalidateReads(src,dst);return {source:this.label(src),destination:this.label(dst),verified:true,replaced:true,sha256:baseline.sha256,backupId:backup.backupId,recoverable:true,...(name==='move_file'?{moved:true}:{copied:true,sourcePreserved:true})};
        }finally{await fs.rm(temp,{force:true});}
      }
    }
    await this.checkProtection(name,{...args,destination:this.label(dst)});
    if(name==='move_file'){
      const before=await fs.lstat(src);if(before.size!==source.size||before.mtimeMs!==source.mtimeMs)throw new PreconditionError('源文件在移动前变化，未开始移动。');await this.target(this.label(src));await this.target(this.label(dst));
      try{await moveExclusive(src,dst);const after=await fs.lstat(await this.target(this.label(dst)));if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw new Error('移动后文件元数据变化，请核对原编号，不重做。');if(before.ino&&after.ino!==before.ino){const actual=await fingerprint(dst);if(actual.sha256!==baseline.sha256)throw new Error('移动后文件校验失败，请核对原编号。');}await relocateAssetBindings(this.assetRoot,this.config.folder,sourceLabel,this.label(dst));this.invalidateReads(src,dst);return {source:sourceLabel,destination:this.label(dst),moved:true,sourcePreserved:false,verified:true,sha256:baseline.sha256,bytes:after.size,sameFileMoved:true,verification:'same-file identity, byte size and modification time'};}catch(e){if(e.code!=='EXDEV')throw e;}
    }
    const result=await copyVerified(src,dst,{expectedSha256:baseline.sha256,validateTarget:()=>this.target(this.label(dst))});
    if(name==='move_file'){if((await fingerprint(src)).sha256!==baseline.sha256)throw new Error('源文件变化，保留源文件。');await fs.unlink(src);await relocateAssetBindings(this.assetRoot,this.config.folder,sourceLabel,this.label(dst));this.invalidateReads(src,dst);}
    return {source:this.label(src),destination:this.label(dst),...result,...(name==='move_file'?{moved:true,sourcePreserved:false}:{copied:true})};
  }
  async unusedDestination(target) {
    const parsed=path.parse(target);
    for(let n=1;n<10000;n++){const next=await this.target(this.label(path.join(parsed.dir,parsed.name+' ('+n+')'+parsed.ext)));try{await fs.lstat(next);}catch(e){if(e.code==='ENOENT')return next;throw e;}}
    throw new PreconditionError('同名文件过多，请整理后再试。');
  }
  async restoreBinary(target,id) {
    const record=await this.history.metadata(this.config.folder,id);
    if(record.path!==this.label(target))throw new Error('恢复文件不匹配。');
    if((await fingerprint(target)).sha256!==record.afterSha256)throw new Error('当前文件已有新修改，请先保留当前版本，未覆盖。');
    const source=await this.history.binaryPath(id),temp=path.join(path.dirname(target),'.cfb-'+crypto.randomUUID()+'.tmp');
    try{
      await copyVerified(source,temp,{expectedSha256:record.beforeSha256});
      const redo=await this.history.saveBinary(this.config.folder,this.label(target),target,record.beforeSha256);
      if((await fingerprint(target)).sha256!==record.afterSha256)throw new Error('恢复前文件变化，没有覆盖。');
      await this.target(this.label(target));await fs.rename(temp,target);this.reads.clear();
      if((await fingerprint(await this.target(this.label(target)))).sha256!==record.beforeSha256)throw new Error('恢复写后校验失败，当前文件可能被其他程序修改；恢复副本保留，请先核对结果，不要直接重试覆盖。');
      return {path:this.label(target),restored:true,verified:true,sha256:record.beforeSha256,backupId:redo.backupId,recoverable:true};
    }finally{await fs.rm(temp,{force:true});}
  }
  async replaceBinary(target,data,expectedSha256){
    await this.checkProtection('write_file',{path:this.label(target)});await this.target(this.label(target));
    if((await fingerprint(target)).sha256!==expectedSha256)throw new Error('原文件已变化，未覆盖。');
    const temp=path.join(path.dirname(target),'.cfb-'+crypto.randomUUID()+'.tmp');
    try{await this.saveNewBinary(temp,data);const finalSha=digest(data);const backup=await this.history.saveBinary(this.config.folder,this.label(target),target,finalSha);if((await fingerprint(target)).sha256!==expectedSha256)throw new Error('提交前原文件变化，未覆盖。');await this.target(this.label(target));await fs.rename(temp,target);const actual=await fingerprint(await this.target(this.label(target)));if(actual.sha256!==finalSha||actual.bytes!==data.length)throw new Error('修改落盘校验失败，请核对而不是重试覆盖。');this.reads.set(target,finalSha);return {path:this.label(target),sha256:finalSha,bytes:data.length,verified:true,backupId:backup.backupId,recoverable:true};}finally{await fs.rm(temp,{force:true});}
  }
  async saveNewBinary(target, data) {
    const temporary=path.join(path.dirname(target),'.cfb-'+crypto.randomUUID()+'.tmp');let created=false,output;
    try {
      await this.target(this.label(target));output=await fs.open(temporary,'wx',0o600);created=true;
      await output.writeFile(data);await output.sync();await output.close();output=null;
      const expected=digest(data),stored=await fingerprint(temporary);
      if(stored.sha256!==expected||stored.bytes!==data.length)throw new Error('保存暂存校验失败，未发布目标文件。');
      await this.target(this.label(target));await fs.link(temporary,target);await fs.unlink(temporary);created=false;
      if((await fingerprint(await this.target(this.label(target)))).sha256!==expected)throw new Error('保存写后校验失败，请检查目标，不能盲目重试。');
    } finally {if(output)await output.close();if(created)await fs.rm(temporary,{force:true});}
  }
  operationHelp() {
    return { method: 'write_file', path: '.claude-file-operation.json', mode: 'rewrite', createsFile: false, defaultDeleteBehavior: 'system Trash / Recycle Bin', permanentFallback: false,
      operationStatus: { protocol: 'claude-folder-operation/v1', operation: 'status', operationId: 'previous-operation-id' },
      readExample: { protocol:'claude-folder-operation/v1', operation:'read', tool:'read_file', args:{ path:'report.pptx', part:'ppt/slides/slide1.xml', offset:0, length:20 } },
      readReceiptRecovery: 'Cowork read/list/search and reserved read-only status/read replies are cached only in this process memory for10 minutes, up to64 receipts/32 MiB total/8 MiB each. Use operation=status with original call_id; historicalRead means original snapshot, not a fresh read. If a status query itself returns running/completed without body, recover its original query call_id, at most2 recovery hops; then stop and inspect the local workbench, never create an unlimited query chain. After process restart/expiry/over-limit, not_found is unknown; no claim of operation failure.',
      automaticSaveReceipt: {protocol:'claude-folder-operation/v1',operation:'read',tool:'get_saved_file_status',args:{path:'relative/output.txt'}},
      automaticSaveReceiptHelp: 'Query only when a local save confirmation is needed; lastSuccessfulSave is the verified historical receipt, not a current-content check. No matching recent receipt means unknown, never infer not saved. No chat injection or file transcription.',
      deviceSelection: 'At task start or after connection changes list devices, choose the intended currently online device, then get_config to verify folder before mutations. Never silently substitute another computer when the cached ID is offline or names are ambiguous.',
      operationIds: 'Supply a unique operation_id (native tools) or operationId (reserved JSON protocol): 8-100 ASCII letters, digits, hyphens or underscores; example feedback-task-0001. The hosted catalog may omit or not forward operation_id. For a caller-chosen stable ID in Cowork use reserved operation=batch, including a single edit. Always query the actual operationId returned in the receipt; never assume a supplied ID survived the hosted service. With no receipt use original Cowork call_id. Use the same ID with identical arguments to retrieve a completed receipt without replay. After timeout query get_operation_status or operation=status. Unknown/pending must never be replayed.',
      hostedEditExample: {protocol:'claude-folder-operation/v1',operation:'batch',operationId:'feedback-edit-0001',operations:[{tool:'edit_block',args:{file_path:'results/note.txt',old_string:'example',new_string:'updated'}}]},
      batchExample: { protocol: 'claude-folder-operation/v1', operation: 'batch', operationId: 'feedback-batch-0001', operations: [{ tool: 'create_directory', args: { path: 'results' } }, { tool: 'write_file', args: { path: 'results/note.txt', content: 'example', mode: 'rewrite' } }] },
      efficiency: 'Batch up to64 mutations/info calls via operation=batch; no full-batch retry. edit_blocks atomically changes several text snippets. Read only excerpts; nextOffset/nextCharOffset and if_sha256 avoid repetition. Images use image blocks; Office text by part/index; PDF/legacy via attachment. copy_file/move_file preserve bytes. edit_office_text updates Word/PPT text in the original; output_path means explicit Save As. describe_files returns metadata without bodies/hashes; structure_only gives Office sections. copy_file/move_file on_conflict: ask (default), keep_both, skip, or replace with expected_destination_sha256 and recovery backup. batch on_conflict applies one non-replacing policy to remaining collisions; replace still needs every destination baseline. Text edits return backupId for restore_file; get_file_info(history=true) lists recent backups. Successful writes locally verified: no readback just to verify, no base64 as text, no repeated generated-file transcription.',
      instructions: 'The hosted service has a fixed tool list. Use write_file with this reserved path and JSON content to delete. Ordinary deletion uses system Trash. Only an explicit user request for permanent deletion permits both permanent=true and confirmPermanentDelete=true. Nonempty directories require recursive=true. No shell commands. Native search is exposed through start_search/get_more_search_results. start_search inlines up to20 matches within12000 UTF-8 bytes; if resultsInline=true no follow-up is needed unless truncated=true. Native batch_operations is available; the hosted equivalent is the batchExample above.',
      fileExample: { protocol: 'claude-folder-operation/v1', operation: 'delete_file', path: 'relative/file.txt', confirmDelete: true },
      directoryExample: { protocol: 'claude-folder-operation/v1', operation: 'delete_directory', path: 'relative/folder', recursive: true, confirmDelete: true } };
  }
  async fileOperation(args) {
    let payload;
    try { payload = JSON.parse(args.content); } catch { throw new PreconditionError('保留路径只接受文件操作协议 JSON，不会写入文件。'); }
    if (payload?.protocol === 'claude-folder-operation/v1' && payload.operation === 'read' && ['read_file','get_file_info','list_directory','describe_files','get_saved_file_status'].includes(payload.tool) && Object.keys(payload).every(k => ['protocol','operation','tool','args'].includes(k)) && args.mode !== 'append') return this.run(payload.tool,payload.args);
    if (payload?.protocol === 'claude-folder-operation/v1' && payload.operation === 'status' && Object.keys(payload).every(k => ['protocol', 'operation', 'operationId'].includes(k)) && args.mode !== 'append') return this.operationStatus(payload.operationId);
    if (payload?.protocol === 'claude-folder-operation/v1' && payload.operation === 'batch' && args.mode !== 'append' && Object.keys(payload).every(k => ['protocol', 'operation', 'operations', 'operationId','on_conflict'].includes(k))) return this.batch(payload.operations,payload.on_conflict);
    if (args.mode === 'append' || !payload || typeof payload !== 'object' || Array.isArray(payload) || payload.protocol !== 'claude-folder-operation/v1' || payload.confirmDelete !== true || !['delete_file', 'delete_directory'].includes(payload.operation) || Object.keys(payload).some(k => !['protocol', 'operation', 'path', 'recursive', 'confirmDelete', 'permanent', 'confirmPermanentDelete', 'operationId'].includes(k))) throw new PreconditionError('删除协议无效，没有改动任何文件。');
    const { protocol, operation, confirmDelete, operationId, ...options } = payload;
    for (const k of ['recursive', 'permanent', 'confirmPermanentDelete']) if (options[k] !== undefined && typeof options[k] !== 'boolean') throw new PreconditionError('删除参数必须是布尔值。');
    return this.deleteItem(operation, options);
  }
  async inspectTree(dir,budget={count:0,deadline:processingDeadline()},depth=0) {
    if(Date.now()>budget.deadline)throw new Error('文件夹检查超出任务时间预算，未移动或删除。');
    if(depth>64)throw new Error('文件夹层级超过64层，未移动或删除。');
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if(++budget.count>100000||Date.now()>budget.deadline)throw new Error('文件夹检查超出100000项或10分钟预算，未移动或删除。');
      const candidate = await this.target(this.label(path.join(dir, entry.name)));
      if (entry.isSymbolicLink()) throw new Error('文件夹内含有链接，操作已拒绝。');
      if (entry.isDirectory()) await this.inspectTree(candidate,budget,depth+1);
    }
  }
  async deleteItem(name,args){let target,info,entries=1;
    await this.preflight(async()=>{await this.checkProtection(name,args);
      if(args.permanent===true&&args.confirmPermanentDelete!==true)throw new PreconditionError('永久删除必须明确指定，并同时提供 confirmPermanentDelete=true。');
      target=await this.target(args.path);info=await fs.lstat(target);
      if(name==='delete_file'){if(!info.isFile()||args.recursive!==undefined)throw new PreconditionError('只能删除普通文件，不能递归删文件。');}
      else{if(!info.isDirectory())throw new PreconditionError('目标不是文件夹。');if((await fs.readdir(target)).length&&args.recursive!==true)throw new PreconditionError('非空文件夹需明确指定 recursive=true。');const budget={count:0,deadline:processingDeadline()};await this.inspectTree(target,budget);entries=budget.count;}
    });
    if (args.permanent === true) {
      if (info.isFile()) await fs.unlink(target); else if (args.recursive === true) await fs.rm(target, { recursive: true, force: false }); else await fs.rmdir(target);
    } else await moveToTrash(target,{entries});
    this.invalidateReads(target);
    return { deleted: true, path: this.label(target), recycled: args.permanent !== true, permanent: args.permanent === true, recoverable: args.permanent !== true };
  }
  async startSearch(args) {
    if (!args || typeof args.pattern !== 'string' || !args.pattern || (args.searchType && !['files', 'content'].includes(args.searchType))) throw new Error('搜索参数无效；仅支持字面搜索。');
    // Complex glob/regex options are refused rather than silently misapplied.
    if (args.literalSearch === false) throw new Error('搜索支持关键词和文件名通配筛选，暂不支持正则表达式。');
    const result = await this.run(args.searchType === 'content' ? 'grep_files' : 'search_files', { path: args.path || '.', pattern: args.pattern, ...(args.filePattern ? {filePattern:args.filePattern} : {}), ...(args.ignoreCase!==undefined ? {ignoreCase:args.ignoreCase} : {}) });
    const sessionId = crypto.randomUUID();
    if (this.searches.size >= 20) this.searches.delete(this.searches.keys().next().value);
    this.searches.set(sessionId, result);
    const resultsInline = result.matches.length <= 20 && Buffer.byteLength(JSON.stringify(result.matches)) <= 12000;
    return { sessionId, status: 'completed', resultCount: result.matches.length, truncated: result.truncated, resultsInline, ...(resultsInline ? {matches:result.matches,hasMore:false} : {nextOffset:0}) };
  }
  searchSession(name, args) {
    if (name === 'list_searches') return { sessions: [...this.searches.keys()] };
    const result = this.searches.get(args?.sessionId); if (!result) throw new Error('搜索会话不存在或已结束。');
    if (name === 'stop_search') { this.searches.delete(args.sessionId); return { stopped: true }; }
    const offset = args.offset ?? 0, length = args.length ?? 100;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length) || length < 1 || length > 100) throw new Error('搜索分页参数无效。');
    return { matches: result.matches.slice(offset, offset + length), truncated: result.truncated, hasMore: offset + length < result.matches.length };
  }
}
