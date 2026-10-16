import {openConnectionJournal,relayConnectionState} from './connection-journal.mjs';
import {readUiLanguage} from './ui-language.mjs';
import {expireArchivedBackups} from './backup-manager.mjs';
import {privateCategories,privateUsage,purgePrivate} from './privacy.mjs';
import {automaticRouteSignature} from './network-discovery.mjs';
import {durableRecord} from './record-io.mjs';
import {acquireLease} from './lease.mjs';
import {AssetTransfers} from './asset-transfers.mjs';
import {assertClient} from './compatibility.mjs';
import {buildDiagnostics} from './diagnostics.mjs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {setupStatus,setupCheck} from './setup.mjs';
import {explainError} from './errors.mjs';
import {isPaused,setPaused} from './pause.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { FileExecutor, validateFolder } from './files.mjs';
import {validatedRoute} from './network.mjs';
import { stateRoot, loadSettings, saveSettings, recentFolders, revokeFolder } from './settings.mjs';
import { importDownload } from './download-import.mjs';
import { pickFolder } from './picker.mjs';
import { RelayRecovery } from './recovery.mjs';
import { workspaceAction } from './workspace.mjs';
import { scopeId } from './activity.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageVersion=JSON.parse(await fs.readFile(path.join(here,'../package.json'),'utf8')).version;const sessionId=crypto.randomUUID();
const identity = JSON.parse(await fs.readFile(path.join(here, '../identity.json'), 'utf8'));
try {
  const u = new URL(process.argv[2]);
  if (u.protocol !== 'chrome-extension:' || u.host !== identity.extensionId || u.username || u.password || u.search || u.hash || !['', '/'].includes(u.pathname)) process.exit(3);
} catch { process.exit(3); }
await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
const lockFile = path.join(stateRoot, 'host.lock');
let hostLease;
let waitAnnounced=false;
try{hostLease=await acquireLease(lockFile,{waitMs:60000,staleMs:20000,heartbeatMs:5000,onWait:()=>{if(waitAnnounced)return;waitAnnounced=true;send({event:'status',version:packageVersion,nativeProtocol:1,local:'previous_closing',relay:{status:'idle'},error:'上一次连接仍在收尾或已有连接占用，正在等待；不会强制结束它。'});}});}catch{send({event:'status',version:packageVersion,nativeProtocol:1,local:'host_busy',relay:{status:'idle'},error:'等待连接锁超时，原连接仍被占用；请核对测试窗口或稍后重试，未开始文件操作。'});process.exit(4);}
let config;
try { config = await loadSettings(); } catch { await hostLease.release(); process.exit(5); }
const fileOptions = { internalRoots:[stateRoot,path.dirname(here),process.execPath], journalRoot:path.join(stateRoot,'operations'), onActivity:activity => { if(!closing) send({event:'activity',activity}); } };
let executor = new FileExecutor(config, fileOptions), child = null, active = false, closing = false;
let folderRecoveryReady=false,folderAvailable=false,folderMessage='',folderCheckedAt=0,folderCheckedPath=null;
async function refreshFolderState(force=false){
  const folder=config.folder;
  if(!force&&folder===folderCheckedPath&&performance.now()-folderCheckedAt<2000)return;
  folderCheckedPath=folder;folderCheckedAt=performance.now();
  if(!folder){folderAvailable=false;folderMessage='';return;}
  let timer;
  try{
    const usable=await Promise.race([
      validateFolder(folder).then(canonical=>canonical===folder).catch(()=>false),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(false),1000);})
    ]);
    if(config.folder!==folder)return;
    if(usable&&!folderAvailable&&folderRecoveryReady)resetFolderRecovery();
    folderAvailable=usable;folderMessage=usable?'':'工作文件夹目前不可用，请重新选择或接回原磁盘；设置和授权记录保留。';
  }finally{clearTimeout(timer);}
}
await refreshFolderState(true);
let paused=await isPaused(stateRoot);
let relay = { status: 'idle' }, input = Buffer.alloc(0), queue = Promise.resolve();
const pickers = new Set(), jobs = new Set(), scopedExecutors=new Map();
const recovery = new RelayRecovery();
folderRecoveryReady=true;
function resetFolderRecovery(){if(relay?.reason==='folder_unavailable')recovery.reset();}
const assetTransfers=new AssetTransfers(stateRoot,scopedExecutor);
let journalMaintenance=null;
function maintainJournal(){if(journalMaintenance||!config.folder||closing)return;const selected=executor;const job=selected.journal.maintain(selected.config.folder).catch(()=>({skipped:true}));journalMaintenance=job;jobs.add(job);void job.finally(()=>{jobs.delete(job);if(journalMaintenance===job)journalMaintenance=null;});}
const maintenanceTimer=setInterval(maintainJournal,86400000);maintenanceTimer.unref();
let expiryJob=null;function expireBackups(){if(expiryJob||paused||configurationPending||closing||!config.folder||config.archiveRetentionDays==null)return;const selected=executor;const days=config.archiveRetentionDays;const job=(async()=>{const profiles=await recentFolders(),folders=[...new Set([selected.config.folder,...profiles.map(p=>p.folder)])].sort();const results=[];for(const folder of folders)results.push(await expireArchivedBackups({config:{folder},history:selected.history,lockRoot:selected.lockRoot},days));return results;})().catch(()=>({blocked:1}));expiryJob=job;jobs.add(job);void job.finally(()=>{jobs.delete(job);if(expiryJob===job)expiryJob=null;});}

const stagingRecovery=await assetTransfers.recover().catch(()=>({failed:1,warning:'暂存恢复未完成，原成果未重做；请核对工作台。'}));
function send(message) {
  let body = Buffer.from(JSON.stringify(message));
  if (body.length > 900000) body = Buffer.from(JSON.stringify({ id: message.id, ok: false, error: '结果过大，请缩小请求范围。' }));
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length); process.stdout.write(Buffer.concat([header, body]));
}
const connectionJournal=await openConnectionJournal(stateRoot);
connectionJournal.record({event:'session_start'});
let lastConnectionKey=null,retirementStartedAt=null;
function connectionState(){return relayConnectionState(relay,recovery,!!retiringRelay);}
const uiLanguage=await readUiLanguage(stateRoot);
function status() { return {uiLanguage,version:packageVersion,nativeProtocol:1,stateSchema:2,sessionId,paused,stagingRecovery,local: config.folder ? folderAvailable?'ready':'unavailable' : 'unconfigured',folderMessage, scope:scopeId(config.folder), config, relay:connectionState() }; }
let lastPublishedStatus=null;
function publish(){if(closing)return;const value=status(),connection=value.relay,connectionKey=JSON.stringify([connection.status,connection.phase,connection.reason,connection.attempt,connection.retryAt,connection.resultDelivery?.pending]);if(connectionKey!==lastConnectionKey){lastConnectionKey=connectionKey;connectionJournal.record({event:'state',...connection,pending:connection.resultDelivery?.pending});}const key=JSON.stringify(value);if(key===lastPublishedStatus)return;lastPublishedStatus=key;send({event:'status',...value});}
let retiringRelay=null;
async function stopRelay({background=false}={}){
  if(retiringRelay){if(!background)await retiringRelay;return;}
  const old=child;if(!old)return;child=null;
  const alive=()=>old.exitCode===null&&old.signalCode===null;
  const done=alive()?new Promise(resolve=>old.once('exit',resolve)):Promise.resolve();
  const job=(async()=>{
    let grace;
    try{
      if(old.connected)try{old.send({action:'shutdown'});}catch{}
      await Promise.race([done,new Promise(resolve=>{grace=setTimeout(resolve,1325000);})]);
      clearTimeout(grace);
      if(alive()){old.kill();await Promise.race([done,new Promise(resolve=>setTimeout(resolve,2000))]);if(alive()){child=old;throw new Error('旧连接尚未停止，未切换文件夹。');}}
      if(!closing){relay={status:'idle'};send({event:'activity_channel_closed',channel:'cowork'});publish();}
    }finally{clearTimeout(grace);}
  })();
  retiringRelay=job;retirementStartedAt=Date.now();connectionJournal.record({event:'retire_start',status:relay.status,phase:'retiring',attempt:recovery.attempt});publish();jobs.add(job);
  void job.then(()=>{},()=>{if(!closing){relay={status:'blocked',reason:'previous_device_still_running'};recovery.observe('blocked');publish();}}).finally(()=>{jobs.delete(job);if(retiringRelay===job){connectionJournal.record({event:'retire_end',status:relay.status,elapsedMs:Date.now()-retirementStartedAt});retiringRelay=null;retirementStartedAt=null;publish();}});
  if(!background)await job;
}
let blockedProxySignature=null,lastBlockedProxyInspect=0;let configurationBarrier=Promise.resolve(),configurationPending=0;
const expiryTimer=setInterval(expireBackups,3600000);expiryTimer.unref();
async function reconcileRelay() {
  await refreshFolderState();
  if(configurationPending)return;
  if (!active || !config.folder || !folderAvailable || !config.relayEnabled || closing) { await stopRelay({background:true}); recovery.reset();if(config.folder&&!folderAvailable)relay={status:'blocked',reason:'folder_unavailable'};publish(); return; }
  if (child && recovery.stalled()) {
    await stopRelay({background:true}); relay = { status: 'reconnecting', reason: 'channel_timeout', retryAt: recovery.failed() }; publish();
  }
  if(!child&&relay.status==='blocked'&&relay.reason==='no_proxy_found'&&Date.now()-lastBlockedProxyInspect>=30000){lastBlockedProxyInspect=Date.now();const signature=await automaticRouteSignature();if(blockedProxySignature&&signature!==blockedProxySignature)recovery.reset();blockedProxySignature=signature;}
  if(child||retiringRelay||!recovery.canStart())return;
  relay = { status: recovery.attempt ? 'reconnecting' : 'starting' }; recovery.observe(relay.status); publish();
  const next = fork(path.join(here, 'relay.mjs'), [], { windowsHide: true, silent: true,
    env: { ...process.env, CFB_STATE_DIR: stateRoot, DESKTOP_COMMANDER_CONFIG_DIR: path.join(stateRoot, 'device'), DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', DEBUG_MODE: 'false' } });
  child = next;
  next.stdout.resume(); next.stderr.resume();
  next.on('message', message => {
    if(child === next && message?.event === 'activity') { if(!closing) send({event:'activity',activity:message.activity}); return; }
    if (child !== next || !message || !['online', 'starting', 'reconnecting', 'blocked', 'auth_required', 'error'].includes(message.status)) return;
    relay = { status: message.status };
    if(message.resultDelivery && Number.isInteger(message.resultDelivery.pending) && message.resultDelivery.pending>=0 && message.resultDelivery.pending<=32)relay.resultDelivery={pending:message.resultDelivery.pending,unconfirmed:message.resultDelivery.unconfirmed===true};
    if (['network_unavailable','settings_invalid','identity_unavailable','folder_unavailable','no_proxy_found','proxy_unreachable','service_unreachable','auth_timeout','auth_denied'].includes(message.reason)) relay.reason = message.reason;
    const route=validatedRoute(message.route);if(route)relay.route=route;
    if (message.status === 'auth_required'&&!['auth_timeout','auth_denied'].includes(message.reason)) {
      try {
        const u = new URL(message.verificationUrl);
        if (u.protocol !== 'https:' || !['mcp.desktopcommander.app', 'auth.desktopcommander.app'].includes(u.hostname) || u.username || u.password) return;
        relay.verificationUrl = u.href;
        if (typeof message.userCode === 'string' && message.userCode.length < 100) relay.userCode = message.userCode;
      } catch { return; }
    }
    recovery.observe(message.status,message.reason); publish();
  });
  const failed = () => { if (child === next) { child = null; if(!closing) send({event:'activity_channel_closed',channel:'cowork'}); if (!['blocked','auth_required'].includes(relay.status)){const retryAt=recovery.failed();relay={...relay,status:recovery.state==='blocked'?'blocked':'reconnecting',reason:relay.reason||'connection_lost',retryAt};} publish(); } };
  next.once('exit', failed); next.once('error', failed);
}
async function handle(message, signal, drainJobs=[]) {
  if (!message || typeof message.id !== 'string' || message.id.length > 100) throw new Error('消息无效。');
  assertClient(message,packageVersion);
  switch (message.action) {
    case 'status': await refreshFolderState();return status();
    case 'diagnostics': {let operations=[],operationsAvailable=false;try{operations=await executor.journal.recent(config.folder);operationsAvailable=true;}catch{}return buildDiagnostics({hostVersion:packageVersion,nodeVersion:process.versions.node,platform:process.platform,arch:process.arch,config,relay:connectionState(),connectionHistory:connectionJournal.snapshot(),paused,operations,operationsAvailable});}
    case 'setup_status': return {...await setupStatus(await scopedExecutor(message.scope),packageVersion),installationRoot:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),relay};
    case 'setup_check': return setupCheck(await scopedExecutor(message.scope),message.write===true);
    case 'pause_files': await setPaused(stateRoot,message.paused);paused=message.paused;publish();return status();
    case 'active': active = message.value === true; await reconcileRelay(); return status();
    case 'pick_folder': return { folder: await pickFolder(signal) };
    case 'revoke_folder': {
      if(message.confirm!==true)throw new Error('撤销目录授权需要明确确认。');
      await stopRelay();recovery.reset();await Promise.allSettled(drainJobs);await executor.chain;
      config=await revokeFolder(message.scope);scopedExecutors.clear();executor=new FileExecutor(config,fileOptions);await reconcileRelay();return status();
    }
    case 'configure': {
      // Validate first, then retire the old executor and device before changing scope.
      const { normalizeSettings } = await import('./settings.mjs');
      const sameFolder=!!message.config?.folder&&message.config.folder===config.folder;
      const updated = await normalizeSettings(message.config,{verifyFolder:!sameFolder});
      if(updated.folder&&(!sameFolder||folderAvailable))await new FileExecutor(updated,fileOptions).target('.',true);
      await stopRelay(); recovery.reset(); await Promise.allSettled(drainJobs);await executor.chain; config = await saveSettings(updated);
      scopedExecutors.clear();executor = new FileExecutor(config, fileOptions);maintainJournal();await reconcileRelay();return status();
    }
    case 'workspace_validate_directory': {const selected=await scopedExecutor(message.scope);const target=await selected.target(message.path||'.',true);if(!(await fs.stat(target)).isDirectory())throw new Error('请选择已有的子文件夹。');return {valid:true};}
    case 'profile_status': {const selected=await scopedExecutor(message.scope);return {scope:scopeId(selected.config.folder),folder:path.basename(selected.config.folder||''),allowWrites:!!selected.config.allowWrites};}
    case 'recent_folders': return recentFolders();
    case 'select_recent': {const profile=(await recentFolders()).find(x=>x.scope===message.scope);if(!profile)throw new Error('文件夹不在已授权列表中。');return handle({...message,action:'configure',config:{...config,folder:profile.folder,allowWrites:profile.allowWrites}},signal,drainJobs);}
    case 'operation_status': {const selected=await scopedExecutor(message.scope);return selected.journal.status(selected.config.folder,message.operationId);}
    case 'asset_precheck':return assetTransfers.precheck(message);
    case 'asset_begin':return assetTransfers.dispatch('begin',message);
    case 'asset_chunk':return assetTransfers.dispatch('chunk',message);
    case 'asset_finish':return assetTransfers.dispatch('finish',message);
    case 'asset_abort':return assetTransfers.dispatch('abort',message);
    case 'asset_status':return assetTransfers.status(message);
    case 'workspace_conflict':{const ex=await scopedExecutor(message.scope);const r=await ex.journal.status(ex.config.folder,message.originalId);return r.tool==='asset_save'?assetTransfers.resolve(message):workspaceAction(ex,message.action,message);}
    case 'import_download': {const selected=await scopedExecutor(message.scope);return importDownload(selected,message.source,message.operationId||message.id,{subdirectory:message.subdirectory||''});}
    case 'tool': return await (await scopedExecutor(message.scope)).execute(message.name,message.args,{operationId:message.operationId||message.id});
    case 'workspace_recent': case 'workspace_check': case 'workspace_diff': case 'workspace_restore': case 'workspace_reveal': case 'workspace_open': case 'workspace_backups': case 'workspace_backup_export': case 'workspace_backup_archive': case 'workspace_backup_unarchive': case 'workspace_backup_trash': case 'workspace_undo_plan': case 'workspace_undo_apply': case 'workspace_protection': case 'workspace_protection_set': return workspaceAction(await scopedExecutor(message.scope),message.action,message);
    case 'relay_reauthorize': case 'relay_reregister': {
      if(message.confirm!==true)throw new Error('设备恢复需要设置页明确确认。');
      await stopRelay();await Promise.allSettled(drainJobs);await executor.chain;
      await durableRecord(path.join(stateRoot,'device','reauth.json'),{mode:message.action==='relay_reauthorize'?'reauthorize':'reregister'});recovery.reset();relay={status:'starting'};publish();return status();
    }
    case 'privacy_usage':return privateUsage(stateRoot);
    case 'privacy_purge':{
      if(message.confirm!==true||!Array.isArray(message.categories)||!message.categories.length||message.categories.length>5||new Set(message.categories).size!==message.categories.length||message.categories.some(x=>!privateCategories.includes(x)))throw new Error('永久清除需要明确选择及确认。');if(assetTransfers.sessions.size&&!message.categories?.includes('staging'))throw new Error('成果正在接收，请先完成或明确选择清除暂存；未清除其他数据。');await stopRelay();await Promise.allSettled(drainJobs);await executor.chain;if(message.categories?.includes('staging'))await assetTransfers.close();
      if(message.categories.includes('operations')){await setPaused(stateRoot,true);paused=true;}const profiles=await recentFolders(),folders=[...profiles.map(p=>p.folder),...(config.folder?[config.folder]:[])];const result=await purgePrivate(stateRoot,message.categories,{confirm:true,folders});scopedExecutors.clear();executor=new FileExecutor(config,fileOptions);
      if(message.categories?.includes('login')){relay={status:'auth_required',reason:'identity_cleared'};recovery.observe('auth_required');}else recovery.reset();publish();return result;
    }
    case 'retry': await stopRelay(); recovery.reset(); await reconcileRelay(); return status();
    default: throw new Error('不允许的本机操作。');
  }
}
async function scopedExecutor(scope){if(!scope||scope===scopeId(config.folder))return executor;const profile=(await recentFolders()).find(x=>x.scope===scope);if(!profile)throw new Error('绑定文件夹已失效，请重新选择。');const {validateFolder}=await import('./files.mjs');const folder=await validateFolder(profile.folder);if(scopeId(folder)!==scope)throw new Error('绑定文件夹已变化。');if(!scopedExecutors.has(scope))scopedExecutors.set(scope,new FileExecutor({...config,folder,allowWrites:profile.allowWrites},fileOptions));return scopedExecutors.get(scope);}
process.stdin.on('data', data => {
  input = Buffer.concat([input, data]);
  while (input.length >= 4) {
    const size = input.readUInt32LE();
    if (!size || size > 32 * 1024 * 1024) { void shutdown(); return; }
    if (input.length < size + 4) return;
    let message;
    try { message = JSON.parse(input.subarray(4, size + 4).toString('utf8')); } catch { void shutdown(); return; }
    input = input.subarray(size + 4);
    if (message?.action === 'pick_folder') {
      // A system folder dialog must not block tab-close/disconnect messages.
      const controller = new AbortController(); pickers.add(controller);
      void handle(message, controller.signal).then(result => { if (!closing) send({ id: message.id, ok: true, result }); }, () => { if (!closing) send({ id: message?.id, ok: false, error: '未选择文件夹；也可手动填写完整路径。' }); }).finally(() => pickers.delete(controller));
      continue;
    }
    if(['configure','revoke_folder','select_recent','retry','relay_reauthorize','relay_reregister','privacy_purge'].includes(message.action)){
      // Capture only preceding work; future jobs wait for this barrier, never vice versa.
      const precedingQueue=queue,precedingControl=configurationBarrier,draining=[...jobs];configurationPending++;
      const transaction=Promise.all([precedingQueue,precedingControl]).then(()=>handle(message,undefined,draining));
      configurationBarrier=transaction.catch(()=>{}).finally(()=>{configurationPending--;if(!configurationPending)expireBackups();});
      void transaction.then(result=>{if(!closing)send({id:message.id,ok:true,result});},error=>{if(!closing)send({id:message.id,ok:false,error:explainError(error),errorCode:error.code||null});});
      continue;
    }
    if(['asset_finish','tool','import_download','workspace_restore','workspace_conflict','workspace_diff','workspace_backup_export','workspace_backup_archive','workspace_backup_unarchive','workspace_backup_trash','workspace_backups','workspace_undo_plan','workspace_undo_apply','workspace_protection_set','setup_check'].includes(message.action)){
      const barrier=configurationBarrier;const job=Promise.all([queue,barrier]).then(()=>{if(closing)throw new Error('连接正在关闭。');return handle(message);}).then(result=>{if(!closing)send({id:message.id,ok:true,result});},error=>{if(!closing)send({id:message.id,ok:false,error:explainError(error),errorCode:error.code||null});});jobs.add(job);void job.finally(()=>jobs.delete(job));continue;
    }
    const barrier=configurationBarrier;const readOnly=['status','diagnostics','setup_status','profile_status','recent_folders','operation_status','asset_status'].includes(message.action);
    queue = queue.then(async () => {
      if(!readOnly)await barrier;
      if (closing) return;
      try { send({ id: message.id, ok: true, result: await handle(message) }); }
      catch (error) { send({ id: message?.id, ok: false, error:explainError(error),errorCode:error.code||null }); }
    });
  }
});
async function shutdown() {
  if (closing) return; closing = true;
  for (const picker of pickers) picker.abort();
  clearInterval(heartbeat);clearInterval(maintenanceTimer);clearInterval(expiryTimer); await queue;await configurationBarrier;await Promise.allSettled([...jobs]); await stopRelay(); await executor.chain;await assetTransfers.close();
  await Promise.race([connectionJournal.flush(),new Promise(resolve=>setTimeout(resolve,500))]);await hostLease.release(); process.exit(0);
}
process.stdin.once('end', () => void shutdown());
process.stdin.once('error', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
// Also supervises reconnection after a proxy failure, without direct fallback.
let heartbeatQueued = false;
const heartbeat = setInterval(() => {
  if (heartbeatQueued || closing || (!child && !config.folder)) return;
  heartbeatQueued = true;
  queue = queue.then(async()=>{await reconcileRelay();publish();}).catch(() => {}).finally(() => { heartbeatQueued = false; });
}, 1000);
publish();
maintainJournal();
expireBackups();
