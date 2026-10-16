import test,{beforeEach} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {MCPDevice,requiresDeviceAuthorization} from '../vendor/remote-device/device.js';
// Vendor startup logs are not test evidence and must not enter the runner protocol.
beforeEach(t=>{for(const method of ['log','warn','error','debug'])t.mock.method(console,method,()=>{});});
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',session={access_token:'synthetic-access',refresh_token:'synthetic-refresh'},sealed={protection:'synthetic-test-only',ciphertext:'not-a-real-login'};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-identity-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const d=Object.create(MCPDevice.prototype);Object.assign(d,{configPath:path.join(root,'device.json'),persistSession:true,deviceId:id,configWriteChain:Promise.resolve(),remoteChannel:{getSession:async()=>({data:{session}})}});return d;}
test('fresh installation is absent, while corrupt, unreadable and unsupported protected state never silently creates a new identity',async t=>{
 const d=await fixture(t);assert.equal(await d.loadPersistedConfig(),null);
 for(const raw of ['{broken',JSON.stringify({deviceId:'bad',session:sealed}),JSON.stringify({deviceId:id,session:{access_token:'plaintext',refresh_token:'plaintext'}})]){
  await fs.writeFile(d.configPath,raw);await assert.rejects(d.loadPersistedConfig(),{code:'CFB_DEVICE_STATE_INVALID'});assert.equal(await fs.readFile(d.configPath,'utf8'),raw);
 }
 await fs.rm(d.configPath);await fs.mkdir(d.configPath);await assert.rejects(d.loadPersistedConfig(),{code:'CFB_DEVICE_STATE_INVALID'});assert.equal((await fs.stat(d.configPath)).isDirectory(),true);
});
test('protected load and rotation retain the same identity across restarts without plaintext or empty session replacement',async t=>{
 const d=await fixture(t);await fs.writeFile(d.configPath,JSON.stringify({deviceId:id,session:sealed}));const decrypt=async value=>{assert.deepEqual(value,sealed);return session;};
 assert.deepEqual(await d.loadPersistedConfig(decrypt),session);assert.equal(d.deviceId,id);
 const original=await fs.readFile(d.configPath);await assert.rejects(d.loadPersistedConfig(async()=>null),{code:'CFB_DEVICE_STATE_INVALID'});assert.deepEqual(await fs.readFile(d.configPath),original);
 await d.writePersistedConfig(session,async value=>{assert.deepEqual(value,session);return sealed;});const saved=JSON.parse(await fs.readFile(d.configPath,'utf8'));assert.equal(saved.deviceId,id);assert.deepEqual(saved.session,sealed);assert.ok(!JSON.stringify(saved).includes(session.refresh_token));
 d.deviceId=undefined;assert.deepEqual(await d.loadPersistedConfig(decrypt),session);assert.equal(d.deviceId,id);
});
test('failed OS protection, missing refresh, missing identity or blocked atomic publish leave original device record unchanged',async t=>{
 const d=await fixture(t);const old=JSON.stringify({deviceId:id,session:sealed});await fs.writeFile(d.configPath,old);
 for(const encrypt of [async()=>null,async()=>{throw Error('OS locked');}]){await assert.rejects(d.writePersistedConfig(session,encrypt),{code:'CFB_DEVICE_STATE_WRITE_FAILED'});assert.equal(await fs.readFile(d.configPath,'utf8'),old);}
 await assert.rejects(d.writePersistedConfig({...session,refresh_token:null},async()=>sealed),{code:'CFB_DEVICE_STATE_WRITE_FAILED'});
 d.deviceId=undefined;await assert.rejects(d.writePersistedConfig(session,async()=>sealed),{code:'CFB_DEVICE_STATE_WRITE_FAILED'});d.deviceId=id;
 const temporary=d.configPath+'.'+process.pid+'.tmp';await fs.mkdir(temporary);await assert.rejects(d.writePersistedConfig(session,async()=>sealed),{code:'CFB_DEVICE_STATE_WRITE_FAILED'});assert.equal(await fs.readFile(d.configPath,'utf8'),old);
});
test('transient lookup failures propagate instead of clearing identity or pretending the device was revoked',async t=>{
 const d=await fixture(t);let calls=0;const error=Error('synthetic offline');d.remoteChannel.findDevice=async()=>{calls++;throw error;};
 await assert.rejects(d.findPersistedDeviceWithRetry(id),e=>e===error);assert.equal(calls,3);assert.equal(d.deviceId,id);
 d.remoteChannel.findDevice=async()=>({id});assert.deepEqual(await d.findPersistedDeviceWithRetry(id),{id});
});
test('invalid persisted identity aborts startup before authentication or registration and propagates the actionable error',async t=>{
 const d=await fixture(t);await fs.writeFile(d.configPath,'{broken');let initialized=0,registered=0,shutdown=0;
 d.desktop={initialize:async()=>{initialized++;},onDisconnect:()=>{}};d.fetchSupabaseConfig=async()=>({supabaseUrl:'https://example.invalid',anonKey:'synthetic'});
 d.remoteChannel.initialize=()=>{};d.remoteChannel.registerDevice=async()=>{registered++;};d.shutdown=async()=>{shutdown++;};
 await assert.rejects(d.start(),{code:'CFB_DEVICE_STATE_INVALID'});assert.equal(initialized,1);assert.equal(registered,0);assert.equal(shutdown,1);assert.equal(await fs.readFile(d.configPath,'utf8'),'{broken');
});

test('network/429/5xx/unknown login errors never authorize another device; explicit rejected credentials alone do',async t=>{
 for(const error of [{name:'AuthRetryableFetchError',status:0},{name:'AuthApiError',status:429,code:'over_request_rate_limit'},{name:'AuthApiError',status:500,code:'unexpected_failure'},{name:'AuthApiError',status:401},{name:'AuthUnknownError',status:400}])assert.equal(requiresDeviceAuthorization(error),false);
 for(const code of ['refresh_token_not_found','refresh_token_already_used','session_not_found','session_expired','bad_jwt','user_not_found'])assert.equal(requiresDeviceAuthorization({name:'AuthApiError',status:400,code}),true);
 const d=await fixture(t);let shutdown=0,registered=0,lookups=0;const error=Object.assign(new Error('synthetic network error'),{name:'AuthRetryableFetchError',status:0});
 d.desktop={initialize:async()=>{},onDisconnect:()=>{}};d.fetchSupabaseConfig=async()=>({supabaseUrl:'https://example.invalid',anonKey:'synthetic'});d.loadPersistedConfig=async()=>session;
 d.remoteChannel.initialize=()=>{};d.remoteChannel.setSession=async()=>({error});d.remoteChannel.registerDevice=async()=>{registered++;};d.findPersistedDeviceWithRetry=async()=>{lookups++;};d.shutdown=async()=>{shutdown++;};
 await assert.rejects(d.start(),e=>e===error);assert.equal(d.deviceId,id);assert.equal(shutdown,1);assert.equal(registered,0);assert.equal(lookups,0);
});

test('valid protected backup recovers corrupt primary without overwriting it, and next save keeps backup',async t=>{
 const d=await fixture(t);await fs.writeFile(d.configPath,JSON.stringify({deviceId:id,session:sealed}));await d.loadPersistedConfig(async()=>session);await d.writePersistedConfig(session,async()=>sealed);
 const backup=await fs.readFile(d.configPath+'.bak','utf8');await fs.writeFile(d.configPath,'{broken-primary');assert.deepEqual(await d.loadPersistedConfig(async()=>session),session);assert.equal(d.configRecoveredFromBackup,true);assert.equal(await fs.readFile(d.configPath,'utf8'),'{broken-primary');
 await d.writePersistedConfig(session,async()=>sealed);assert.equal(await fs.readFile(d.configPath+'.bak','utf8'),backup);assert.equal(JSON.parse(await fs.readFile(d.configPath,'utf8')).deviceId,id);
});
test('recovery requests preserve original id for reauthorization and retain broken files for explicit reregistration',async t=>{
 const d=await fixture(t),marker=path.join(path.dirname(d.configPath),'reauth.json');await fs.writeFile(d.configPath,JSON.stringify({deviceId:id,session:sealed}));await fs.writeFile(marker,JSON.stringify({mode:'reauthorize'}));assert.equal(await d.prepareRecoveryRequest(),true);assert.equal(d.deviceId,id);assert.equal(await fs.readFile(d.configPath,'utf8'),JSON.stringify({deviceId:id,session:sealed}));
 await fs.writeFile(d.configPath+'.bak','{broken-backup');await fs.writeFile(marker,JSON.stringify({mode:'reregister'}));assert.equal(await d.prepareRecoveryRequest(),true);assert.equal(d.deviceId,undefined);await assert.rejects(fs.stat(d.configPath),{code:'ENOENT'});const files=await fs.readdir(path.dirname(marker));assert.equal(files.filter(x=>x.includes('.broken-')).length,2);assert.ok(files.includes('reauth.json'));
});
test('revoked records cannot be silently restored from an old backup',async t=>{
 const d=await fixture(t);await fs.writeFile(d.configPath,JSON.stringify({deviceId:id,session:sealed}));await fs.writeFile(d.configPath+'.bak',JSON.stringify({deviceId:id,session:sealed}));await d.loadPersistedConfig(async()=>session);await d.clearPersistedConfig();assert.equal(await d.loadPersistedConfig(async()=>session),null);assert.equal((await fs.readdir(path.dirname(d.configPath))).filter(x=>x.includes('.revoked-')).length,2);
});
