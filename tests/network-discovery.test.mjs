import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import net from 'node:net';
import {localProxyCandidates,discoverProxyDispatcher,automaticRouteChanged,automaticRouteCheckDue} from '../companion/network-discovery.mjs';
import {normalizeSettings} from '../companion/settings.mjs';
import {fetch} from 'undici';
test('discovery only accepts explicit loopback proxy endpoints, never remote proxies, passwords or subscriptions',()=>{
 assert.deepEqual(localProxyCandidates({env:{HTTPS_PROXY:'http://127.0.0.1:2345',HTTP_PROXY:'http://127.0.0.1:2345',ALL_PROXY:'socks5://127.0.0.1:6666'},systemProxy:'http=127.0.0.1:2345;https=127.0.0.1:3456;socks=127.0.0.1:6666'}),['http://127.0.0.1:2345','socks5://127.0.0.1:6666','http://127.0.0.1:3456','socks5h://127.0.0.1:6666']);
 assert.deepEqual(localProxyCandidates({env:{HTTPS_PROXY:'https://remote.example:8888',HTTP_PROXY:'http://secret:password@127.0.0.1:9000'},systemProxy:'https://subscription.example/list?token=secret'}),[]);
});
test('auto mode saves without a port, and unavailable routes never silently use system network',async()=>{
 const c=await normalizeSettings({folder:null,allowWrites:false,relayEnabled:true,networkMode:'auto',proxy:'',systemNetworkAccepted:false});assert.equal(c.networkMode,'auto');
 await assert.rejects(discoverProxyDispatcher({env:{},readSystem:async()=>'',testUrl:'http://127.0.0.1:1'}),/未尝试直连/);
});
test('an unusable first candidate is skipped and changed local ports are rediscovered through CONNECT',async t=>{
 let connections=0;const sockets=new Set();const target=http.createServer((req,res)=>res.end('auto-route-ok'));const proxy=http.createServer();
 proxy.on('connect',(req,client,head)=>{connections++;const u=new URL('http://'+req.url);const upstream=net.connect(Number(u.port),u.hostname,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});for(const socket of [client,upstream]){sockets.add(socket);socket.on('error',()=>socket.destroy());socket.on('close',()=>sockets.delete(socket));}});
 await new Promise(r=>target.listen(0,'127.0.0.1',r));await new Promise(r=>proxy.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();target.closeAllConnections();proxy.closeAllConnections();await Promise.all([new Promise(r=>target.close(r)),new Promise(r=>proxy.close(r))]);});
 const testUrl='http://127.0.0.1:'+target.address().port,endpoint='http://127.0.0.1:'+proxy.address().port;
 for(const env of [{HTTP_PROXY:'http://127.0.0.1:1'},{HTTP_PROXY:endpoint}]){
  const dispatcher=await discoverProxyDispatcher({env,readSystem:async()=>endpoint,testUrl,timeoutMs:500});try{assert.equal(await (await fetch(testUrl,{dispatcher})).text(),'auto-route-ok');assert.equal(await automaticRouteChanged(dispatcher,{env,readSystem:async()=>endpoint}),false);assert.equal(await automaticRouteChanged(dispatcher,{env,readSystem:async()=>endpoint.replace(/:\d+$/,':2')}),true);}finally{await dispatcher.close();}
 }
 assert.ok(connections>=2);
});

test('healthy automatic route detection waits30 seconds while unavailable connections check in5 seconds',()=>{
 assert.equal(automaticRouteCheckDue(null,true,0),true);assert.equal(automaticRouteCheckDue(0,true,5000),false);assert.equal(automaticRouteCheckDue(0,true,30000),true);assert.equal(automaticRouteCheckDue(0,false,4999),false);assert.equal(automaticRouteCheckDue(0,false,5000),true);
});

test('no candidate and unreachable configured candidate have distinct codes without direct fallback',async()=>{
 await assert.rejects(discoverProxyDispatcher({env:{},readSystem:async()=>''}),{code:'NO_PROXY_CANDIDATES'});
 await assert.rejects(discoverProxyDispatcher({env:{HTTPS_PROXY:'http://127.0.0.1:1'},readSystem:async()=>'',testUrl:'http://127.0.0.1:1',timeoutMs:100}),{code:'PROXY_UNREACHABLE'});
});
