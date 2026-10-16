import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {FileHistory} from '../companion/history.mjs';
test('eligible old backups auto-archive without deleting bytes and remain recoverable by original ID',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-history-archive-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const history=new FileHistory(path.join(root,'backups'),{maxCount:6,maxBytes:10000,archiveBytes:10000}),saved=[];
 for(let n=0;n<7;n++){saved.push(await history.save('fictional-folder','same.txt',Buffer.from('version-'+n),'a'.repeat(64)));await new Promise(r=>setTimeout(r,2));}
 assert.equal((await fs.readdir(history.root)).filter(n=>n.endsWith('.bin')).length,6);assert.equal((await fs.readdir(path.join(history.root,'archive'))).filter(n=>n.endsWith('.bin')).length,1);
 const oldest=await history.load('fictional-folder','same.txt',saved[0].backupId);assert.equal(oldest.data.toString(),'version-0');assert.equal((await history.metadata('fictional-folder',saved[0].backupId)).backupId,saved[0].backupId);
});

test('backup usage is updated incrementally, serialized across folders, and rebuilt if its cache disappears',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-usage-index-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const {readBackupUsage}=await import('../companion/backup-usage.mjs'),history=new FileHistory(path.join(root,'backups'));const digest='a'.repeat(64);
 await history.save(root,'one.txt',Buffer.from('1234'),digest);await Promise.all([history.save(root,'two.txt',Buffer.from('abc'),digest),history.save(root+'-other','three.txt',Buffer.from('12'),digest)]);
 const cached=await readBackupUsage(history.root);assert.equal(cached.activeCount,3);assert.equal(cached.activeBytes,9);await fs.rm(path.join(history.root,'usage.json'));const rebuilt=await readBackupUsage(history.root);assert.equal(rebuilt.activeBytes,cached.activeBytes);assert.equal(rebuilt.activeCount,cached.activeCount);
});

test('archive expiry is disabled by default, uses recycle only and never automatically repeats an unknown attempt',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-expiry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const history=new FileHistory(path.join(root,'backups'),{maxCount:6,maxBytes:10000,archiveBytes:10000});const ids=[];for(let i=0;i<8;i++){ids.push((await history.save(root,'same.txt',Buffer.from('data-'+i),'a'.repeat(64))).backupId);await new Promise(r=>setTimeout(r,2));}
 const archive=path.join(history.root,'archive');for(const name of await fs.readdir(archive))if(name.endsWith('.json')){const file=path.join(archive,name),record=JSON.parse(await fs.readFile(file,'utf8'));record.createdAt='2000-01-01T00:00:00Z';await fs.writeFile(file,JSON.stringify(record));}
 const {expireArchivedBackups}=await import('../companion/backup-manager.mjs');const ex={config:{folder:root},history,lockRoot:path.join(root,'locks')};let calls=0;assert.equal((await expireArchivedBackups(ex,null,{recycle:async()=>{calls++;}})).enabled,false);assert.equal(calls,0);
 const unknown=await expireArchivedBackups(ex,90,{recycle:async()=>{calls++;throw new Error('synthetic unknown');}});assert.ok(unknown.blocked>0);const old=calls;assert.equal((await expireArchivedBackups(ex,90,{recycle:async()=>{calls++;return {recycled:true,permanent:false};}})).recycled,0);assert.equal(calls,old);assert.equal((await fs.readdir(archive)).filter(x=>x.endsWith('.bin')).length,2);
});
