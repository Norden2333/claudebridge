import test from 'node:test';import assert from 'node:assert/strict';
import {keyringPlan,keyringReference,protectKeyring,unprotectKeyring} from '../companion/keyring-session.mjs';
const session={access_token:'synthetic-access',refresh_token:'synthetic-refresh'};
for(const platform of ['darwin','linux'])test(platform+' OS vault adapter uses stdin, private namespaced references and exact readback without process-argument secrets',async()=>{
 const plans=[];let value;const root='synthetic-'+platform,run=async plan=>{plans.push(plan);if(plan.input){value=platform==='darwin'?plan.input.match(/-w ([A-Za-z0-9+/=]+)\n$/)[1]:plan.input;return '';}return value;};
 const stored=await protectKeyring(session,{platform,root,run});assert.ok(stored);assert.ok(!JSON.stringify(stored).includes('synthetic-access'));assert.deepEqual(await unprotectKeyring(stored,{platform,root,run}),session);
 for(const plan of plans){assert.ok(!plan.args.join(' ').includes('synthetic-access'));assert.ok(!plan.args.join(' ').includes(value));assert.ok(plan.command.startsWith('/usr/bin/'));}
 let called=false;assert.equal(await unprotectKeyring({...stored,keyReference:keyringReference('other')},{platform,root,run:async()=>{called=true;}}),null);assert.equal(called,false);
});
test('missing, locked or misbehaving OS stores never produce a plaintext persisted session',async()=>{
 for(const platform of ['darwin','linux']){
  assert.equal(await protectKeyring(session,{platform,root:'synthetic',run:async()=>{throw new Error('vault unavailable');}}),null);
  assert.equal(await protectKeyring(session,{platform,root:'synthetic',run:async()=>''}),null);
 }
 assert.throws(()=>keyringPlan('darwin',keyringReference('synthetic'),'a'.repeat(5000)),/size/);
 assert.throws(()=>keyringPlan('linux','invalid-reference','AAAA'));
 assert.throws(()=>keyringPlan('linux',keyringReference('synthetic'),'AAAA\nadd-generic-password'));
});
