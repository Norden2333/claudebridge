import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FileExecutor} from '../companion/files.mjs';
import {setPaused} from '../companion/pause.mjs';
import {workspaceAction} from '../companion/workspace.mjs';
import {importDownload} from '../companion/download-import.mjs';
import {activityOutcome} from '../companion/activity.mjs';
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-usable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'folder'),state=path.join(root,'state');await fs.mkdir(folder);const ex=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(state,'operations')});return {root,folder,state,ex};}
test('many backup versions are paged and filtered without returning every record or hiding actual space usage',async t=>{
 const {ex}=await setup(t);await ex.execute('write_file',{path:'base.md',content:'before'});await ex.execute('write_file',{path:'base.md',content:'after'});
 const record=(await workspaceAction(ex,'workspace_backups')).records[0];
 for(let i=0;i<60;i++){const id=crypto.randomUUID();await fs.writeFile(path.join(ex.history.root,id+'.bin'),'before');await fs.writeFile(path.join(ex.history.root,id+'.json'),JSON.stringify({...record,backupId:id,path:'version-'+i+'.md'}));}
 const first=await workspaceAction(ex,'workspace_backups');assert.equal(first.count,61);assert.equal(first.records.length,50);assert.equal(first.nextOffset,50);
 const second=await workspaceAction(ex,'workspace_backups',{offset:50});assert.equal(second.records.length,11);assert.equal(second.nextOffset,null);
 const match=await workspaceAction(ex,'workspace_backups',{filter:'version-59'});assert.equal(match.records.length,1);assert.equal(match.count,61);assert.equal(match.activeBytes,366);
});
test('Windows backup cleanup preserves paired payload in system Recycle Bin and re-imports the restored version', {skip:process.platform!=='win32'||process.env.CFB_WINDOWS_REAL!=='1'},async t=>{
 const {folder,ex}=await setup(t);await ex.execute('write_file',{path:'draft.md',content:'before'});await ex.execute('write_file',{path:'draft.md',content:'after'});
 const record=(await workspaceAction(ex,'workspace_backups')).records[0],run=promisify(execFile),env={...process.env,CFB_TEST_PARENT:ex.history.root};
 await workspaceAction(ex,'workspace_backup_trash',{backupId:record.backupId,confirm:true});
 const inspect="$s=New-Object -ComObject Shell.Application;$r=@();foreach($i in $s.NameSpace(10).Items()){if($i.ExtendedProperty('System.Recycle.DeletedFrom') -eq $env:CFB_TEST_PARENT){$r+=@{name=$i.Name;path=$i.Path}}};ConvertTo-Json -InputObject @($r) -Compress";
 const items=JSON.parse((await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',inspect],{windowsHide:true,env})).stdout),payload=items.find(x=>x.name==='removed-backup-'+record.backupId);
 assert.ok(payload);assert.equal(await fs.readFile(path.join(payload.path,record.backupId+'.bin'),'utf8'),'before');
 const restore="$s=New-Object -ComObject Shell.Application;foreach($i in @($s.NameSpace(10).Items())){if($i.ExtendedProperty('System.Recycle.DeletedFrom') -eq $env:CFB_TEST_PARENT){$i.InvokeVerb('undelete')}}";
 await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',restore],{windowsHide:true,env});
 for(let i=0;i<30;i++){try{await fs.access(path.join(ex.history.root,'removed-backup-'+record.backupId,record.backupId+'.json'));break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.equal((await workspaceAction(ex,'workspace_backups')).archives[0].recoveredFromTrash,true);
 await workspaceAction(ex,'workspace_backup_unarchive',{backupId:record.backupId,recoveredFromTrash:true,confirm:true});
 assert.equal((await workspaceAction(ex,'workspace_backups')).count,1);assert.equal(await fs.readFile(path.join(folder,'draft.md'),'utf8'),'after');
});
test('pause between batch items stops before the next file and reusing the batch receipt does not continue skipped items',async t=>{
 const {folder,state,ex}=await setup(t),run=ex.run.bind(ex);
 ex.run=async(name,args)=>{const result=await run(name,args);if(name==='write_file'&&args.path==='one.md')await setPaused(state,true);return result;};
 const args={operations:['one.md','two.md','three.md'].map(path=>({tool:'write_file',args:{path,content:'once'}}))};
 const result=await ex.execute('batch_operations',args,{operationId:'pause-batch-test'});assert.equal(result.completed,1);assert.equal(result.paused,true);assert.equal(result.remainingSkipped,2);
 await setPaused(state,false);assert.equal((await ex.execute('batch_operations',args,{operationId:'pause-batch-test'})).replayed,true);
 await assert.rejects(fs.access(path.join(folder,'two.md')));assert.equal(await fs.readFile(path.join(folder,'one.md'),'utf8'),'once');
});
test('persistent pause drains started writes, records unexecuted local/Cowork calls and blocks downloads, never replays on resume',async t=>{
 const {root,folder,state,ex}=await setup(t);let release,started;const entered=new Promise(r=>started=r),gate=new Promise(r=>release=r),original=ex.run.bind(ex);
 ex.run=async(name,args)=>{if(args.path==='first.txt'){started();await gate;}return original(name,args);};
 const first=ex.execute('write_file',{path:'first.txt',content:'first'},{operationId:'first-operation'});await entered;await setPaused(state,true);release();await first;
 const other=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(state,'operations')});
 await assert.rejects(other.execute('write_file',{path:'next.txt',content:'no'},{operationId:'next-operation',channel:'cowork'}),/已暂停/);
 const rejected=await other.journal.status(folder,'next-operation');assert.equal(rejected.status,'rejected');assert.equal(rejected.retryAllowed,true);
 const source=path.join(root,'download.txt');await fs.writeFile(source,'keep');await assert.rejects(importDownload(other,source,'download-operation'),/已暂停/);
 assert.equal((await other.journal.status(folder,'download-operation')).status,'not_found');await setPaused(state,false);
 assert.equal(await fs.readFile(path.join(folder,'first.txt'),'utf8'),'first');await assert.rejects(fs.access(path.join(folder,'next.txt')));
 await other.execute('write_file',{path:'new.txt',content:'explicit new'},{operationId:'new-operation'});
});
test('backup usage/export/recoverable cleanup isolate folders, keep original content and refuse unconfirmed or readonly exports',async t=>{
 const {folder,ex}=await setup(t);await ex.execute('write_file',{path:'draft.md',content:'before'});await ex.execute('write_file',{path:'draft.md',content:'after'});
 const view=await workspaceAction(ex,'workspace_backups'),record=view.records[0];assert.equal(view.count,1);assert.equal(view.activeBytes,6);
 const exported=await workspaceAction(ex,'workspace_backup_export',{backupId:record.backupId});assert.equal(await fs.readFile(path.join(folder,exported.path),'utf8'),'before');
 await assert.rejects(workspaceAction(ex,'workspace_backup_archive',{backupId:record.backupId}),/确认/);
 await workspaceAction(ex,'workspace_backup_archive',{backupId:record.backupId,confirm:true});const archived=await workspaceAction(ex,'workspace_backups');assert.equal(archived.count,0);assert.equal(archived.archiveBytes,6);assert.equal(archived.archives.length,1);
 await workspaceAction(ex,'workspace_backup_unarchive',{backupId:record.backupId,confirm:true});assert.equal((await workspaceAction(ex,'workspace_backups')).count,1);
 await assert.rejects(workspaceAction(ex,'workspace_backup_trash',{backupId:record.backupId}),/确认/);
 const recovered=path.join(ex.history.root,'removed-backup-'+record.backupId);await fs.mkdir(recovered);
 for(const ext of ['.bin','.json'])await fs.rename(path.join(ex.history.root,record.backupId+ext),path.join(recovered,record.backupId+ext));
 const returned=await workspaceAction(ex,'workspace_backups');assert.equal(returned.archives[0].recoveredFromTrash,true);
 await workspaceAction(ex,'workspace_backup_unarchive',{backupId:record.backupId,recoveredFromTrash:true,confirm:true});assert.equal((await workspaceAction(ex,'workspace_backups')).count,1);
 assert.equal(await fs.readFile(path.join(folder,'draft.md'),'utf8'),'after');
 ex.config.allowWrites=false;await assert.rejects(workspaceAction(ex,'workspace_backup_export',{backupId:record.backupId}),/修改权限/);
 await fs.writeFile(path.join(folder,'unsafe.exe'),'not executable');await assert.rejects(workspaceAction(ex,'workspace_open',{path:'unsafe.exe'}),/此类型/);
 await assert.rejects(workspaceAction(ex,'workspace_open',{path:'../outside.txt'}),/只允许/);
});
test('display groups only consecutive completed operations; failures and unknowns remain separate',async()=>{
 assert.equal(activityOutcome({replayed:true,completed:1,failedIndex:1,paused:true}),'partial');
 assert.equal(activityOutcome({completed:0,failedIndex:0,paused:true}),'paused');
 const ctx=vm.createContext({self:{}});vm.runInContext(await fs.readFile(new URL('../extension/panel.js',import.meta.url),'utf8'),ctx);
 const entries=['completed','completed','unknown','unknown','completed'].map((state,i)=>({id:i,state,kind:'import_download',channel:'download',paths:['file'+i],time:100000-i*1000}));
 const groups=ctx.self.CFB_PANEL.group(entries);assert.equal(groups.length,4);assert.equal(groups[0].grouped.length,2);assert.equal(groups[1].state,'unknown');assert.equal(groups[2].state,'unknown');
});
