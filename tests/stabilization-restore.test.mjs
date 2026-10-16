import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {FileExecutor} from '../companion/files.mjs';import {fingerprint} from '../companion/safe-io.mjs';
test('binary restore rejects corruption after publication and keeps recovery copies',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-restore-verify-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const folder=path.join(base,'files');await fs.mkdir(folder);
 const target=path.join(folder,'sample.bin');await fs.writeFile(target,Buffer.from([0,1,2,3]));const ex=new FileExecutor({folder,allowWrites:true},{journalRoot:path.join(base,'state/operations')});const before=await fingerprint(target),after=Buffer.from([0,4,5,6]);
 const record=await ex.history.saveBinary(folder,'sample.bin',target,(await import('../companion/safe-io.mjs')).sha(after));await fs.writeFile(target,after);
 const rename=fs.rename;fs.rename=async(from,to)=>{await rename(from,to);if(String(to)===target)await fs.writeFile(target,Buffer.from([0,9,9,9]));};
 try{await assert.rejects(ex.restoreBinary(target,record.backupId),/校验/);}finally{fs.rename=rename;}
 assert.equal((await fingerprint(path.join(ex.history.root,record.backupId+'.bin'))).sha256,before.sha256);
 assert.equal((await ex.history.list(folder,'sample.bin')).length,2);
});
