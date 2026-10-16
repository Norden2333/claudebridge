import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import net from 'node:net';import {fetch} from 'undici';
import {createNetworkDispatcher} from '../companion/network.mjs';import {validateProxy} from '../companion/settings.mjs';
async function fixture(t,{deny=false,partial=false}={}){
 const sockets=new Set(),destinations=[];let targetCalls=0;
 const target=http.createServer((req,res)=>{targetCalls++;res.end('socks-route-ok');});await new Promise(r=>target.listen(0,'127.0.0.1',r));
 const proxy=net.createServer(client=>{sockets.add(client);client.on('error',()=>client.destroy());client.on('close',()=>sockets.delete(client));let stage=0,buffer=Buffer.alloc(0);
  const receive=data=>{buffer=Buffer.concat([buffer,data]);if(stage===0){if(buffer.length<3)return;assert.deepEqual([...buffer.subarray(0,3)],[5,1,0]);buffer=buffer.subarray(3);stage=1;if(deny){client.end(Buffer.from([5,255]));return;}client.write(Buffer.from([5,0]));}
   if(stage===1){if(buffer.length<5)return;const size=buffer[3]===1?10:buffer[3]===3?7+buffer[4]:22;if(buffer.length<size)return;destinations.push({type:buffer[3],host:buffer[3]===3?buffer.subarray(5,5+buffer[4]).toString():null});const port=buffer.readUInt16BE(size-2),head=buffer.subarray(size);stage=2;client.removeListener('data',receive);const upstream=net.connect(port,'127.0.0.1',()=>{const response=Buffer.from([5,0,0,1,127,0,0,1,0,0]);if(partial){client.write(response.subarray(0,3));setTimeout(()=>{client.write(response.subarray(3));client.pipe(upstream);upstream.pipe(client);if(head.length)upstream.write(head);},5);}else{client.write(response);client.pipe(upstream);upstream.pipe(client);if(head.length)upstream.write(head);}});sockets.add(upstream);upstream.on('error',()=>client.destroy());upstream.on('close',()=>sockets.delete(upstream));}
  };client.on('data',receive);
 });await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();target.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>target.close(r))]);});
 return {port:target.address().port,proxy:'socks5h://127.0.0.1:'+proxy.address().port,destinations,calls:()=>targetCalls};
}
test('SOCKS5 streams actual HTTP and sends destination domains to the proxy without local target DNS',async t=>{
 const f=await fixture(t,{partial:true});const dispatcher=createNetworkDispatcher({networkMode:'proxy',proxy:f.proxy});t.after(()=>dispatcher.destroy());
 assert.equal(await (await fetch('http://synthetic.invalid:'+f.port,{dispatcher})).text(),'socks-route-ok');assert.deepEqual(f.destinations,[{type:3,host:'synthetic.invalid'}]);assert.equal(f.calls(),1);
 assert.equal(await (await fetch('http://[::1]:'+f.port,{dispatcher})).text(),'socks-route-ok');assert.equal(f.destinations.at(-1).type,4);
});
test('SOCKS5 refusal never falls back to a reachable direct destination',async t=>{
 const f=await fixture(t,{deny:true}),dispatcher=createNetworkDispatcher({networkMode:'proxy',proxy:f.proxy});t.after(()=>dispatcher.destroy());await assert.rejects(fetch('http://127.0.0.1:'+f.port,{dispatcher}));assert.equal(f.calls(),0);
});
test('SOCKS configuration requires local endpoints, no credentials and no hidden default direct route',()=>{
 assert.equal(validateProxy('socks5://127.0.0.1:4444'),'socks5://127.0.0.1:4444');assert.equal(validateProxy('socks5h://[::1]:4444'),'socks5h://[::1]:4444');assert.throws(()=>validateProxy('socks5://remote.example:4444'));assert.throws(()=>validateProxy('socks5://user:password@127.0.0.1:4444'));assert.throws(()=>validateProxy('socks4://127.0.0.1:4444'));
});
