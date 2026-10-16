import test from 'node:test';import assert from 'node:assert/strict';import {buildDiagnostics} from '../companion/diagnostics.mjs';
test('support report allowlist excludes credentials, bodies, all names, paths and operation IDs',()=>{
 const secret='PRIVATE_DO_NOT_EXPORT',r=buildDiagnostics({hostVersion:'0.3.7',nodeVersion:'24.19.0',platform:'win32',arch:'x64',config:{folder:secret,allowWrites:true,relayEnabled:true,proxy:secret,networkMode:'proxy',token:secret},relay:{status:'auth_required',verificationUrl:secret,userCode:secret,error:secret},operations:[{status:'completed',operationId:secret,path:secret,content:secret,error:secret},{status:'__proto__'},{status:'failed_or_unknown'}],operationsAvailable:true});
 assert.ok(!JSON.stringify(r).includes(secret));assert.equal(r.recentOperations.counts.completed,1);assert.equal(r.recentOperations.counts.failed_or_unknown,1);assert.equal(r.connection.folderConfigured,true);assert.equal(r.privacy.automaticUpload,false);
});
test('invalid diagnostic fields cannot become free-text export or claim successful operation history',()=>{
 const r=buildDiagnostics({hostVersion:'token=secret',nodeVersion:'secret',platform:'secret',arch:'secret',relay:{status:'secret'},config:{networkMode:'secret'},operations:[{status:'unknown'}]});assert.ok(!JSON.stringify(r).includes('secret'));assert.equal(r.recentOperations.available,false);assert.equal(r.hostVersion,'unknown');
});
