import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {copyVerified,sha} from '../companion/safe-io.mjs';
test('Windows non-hardlink publication verifies original bytes and never replaces an existing destination',{skip:process.platform!=='win32'},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-publish-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'source.txt'),target=path.join(root,'target.txt'),body=Buffer.from('fictional original bytes');await fs.writeFile(source,body);
 const original=fs.link;fs.link=async()=>{throw Object.assign(new Error('simulated filesystem without hardlinks'),{code:'ENOTSUP'});};
 try{const result=await copyVerified(source,target,{expectedSha256:sha(body)});assert.equal(result.verified,true);assert.deepEqual(await fs.readFile(target),body);await assert.rejects(copyVerified(source,target),{code:'EEXIST'});assert.deepEqual(await fs.readFile(target),body);}finally{fs.link=original;}
 assert.deepEqual(await fs.readFile(source),body);
});
