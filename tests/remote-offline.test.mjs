import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {RemoteChannel} from '../vendor/remote-device/remote-channel.js';

test('offline shutdown uses only the existing SDK transport, acknowledges its row and never reads or spawns session tokens',async()=>{
 const c=new RemoteChannel(),writes=[],filters=[];let requested=0;
 const query={update(v){writes.push(v);return this},eq(k,v){filters.push([k,v]);return this},select(v){assert.equal(v,'id');return this},abortSignal(signal){assert.equal(signal.aborted,false);return this},then(resolve){requested++;return Promise.resolve({data:[{id:'fake-device'}],error:null}).then(resolve)}};
 c.client={auth:{getSession(){throw Error('No token refresh or process arguments permitted')}},from(table){assert.equal(table,'mcp_devices');return query}};
 assert.deepEqual(await c.setOffline('fake-device'),{acknowledged:true});assert.equal(requested,1);assert.equal(writes[0].status,'offline');assert.ok(Date.parse(writes[0].last_seen));assert.deepEqual(filters,[['id','fake-device']]);
 const source=await fs.readFile(new URL('../vendor/remote-device/remote-channel.js',import.meta.url),'utf8');const block=source.slice(source.indexOf('    async setOffline('),source.indexOf('    async unsubscribe('));assert.doesNotMatch(block,/spawnSync|child_process|blocking-offline-update|session\.access_token|session\.refresh_token/);
});
test('offline shutdown never claims an empty or rejected update was delivered',async()=>{
 for(const outcome of [{data:[],error:null},{data:null,error:{message:'synthetic rejected'}}]){
  const c=new RemoteChannel();c.client={from(){return {update(){return this},eq(){return this},select(){return this},abortSignal(){return this},then(resolve){return Promise.resolve(outcome).then(resolve)}}}};
  assert.equal((await c.setOffline('fake-device')).acknowledged,false);
 }
});
test('bundled SDK offline update uses its configured fetch and never an alternate transport',async()=>{
 const {createClient}=await import('@supabase/supabase-js');let requests=0;
 const c=new RemoteChannel();c.client=createClient('http://127.0.0.1:1','synthetic-only-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,options)=>{requests++;const u=new URL(url);assert.equal(u.pathname,'/rest/v1/mcp_devices');assert.equal(u.searchParams.get('id'),'eq.fake-sdk-device');assert.equal(u.searchParams.get('select'),'id');assert.equal(options.method,'PATCH');assert.equal(JSON.parse(options.body).status,'offline');assert.ok(options.signal);return new Response(JSON.stringify([{id:'fake-sdk-device'}]),{headers:{'Content-Type':'application/json'}})}}});
 assert.deepEqual(await c.setOffline('fake-sdk-device'),{acknowledged:true});assert.equal(requests,1);
});
test('offline auth or transport stall is bounded and aborts without claiming delivery',async()=>{
 const c=new RemoteChannel();let signal;
 c.client={from(){return {update(){return this},eq(){return this},select(){return this},abortSignal(v){signal=v;return this},then(){return new Promise(()=>{})}}}};
 const start=performance.now(),reply=await c.setOffline('fake-stall-device');assert.equal(reply.acknowledged,false);assert.equal(reply.reason,'timeout');assert.ok(signal.aborted);assert.ok(performance.now()-start<3500);
});
