import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { fetch } from 'undici';
import { normalizeSettings } from '../companion/settings.mjs';
import { createNetworkDispatcher } from '../companion/network.mjs';
const base = { folder: null, proxy: '', allowWrites: false, relayEnabled: false };
test('legacy config preserves explicit proxy; empty default works without relay', async () => {
  assert.equal((await normalizeSettings(base)).networkMode, 'proxy');
  assert.equal((await normalizeSettings({ ...base, proxy: 'http://127.0.0.1:8080' })).proxy, 'http://127.0.0.1:8080');
  await assert.rejects(normalizeSettings({ ...base, relayEnabled: true }));
  await assert.rejects(normalizeSettings({ ...base, networkMode: 'automatic' }));
});
test('system route requires explicit acknowledgment; modes never silently switch', async () => {
  await assert.rejects(normalizeSettings({ ...base, relayEnabled: true, networkMode: 'system' }), /确认/);
  const config = await normalizeSettings({ ...base, relayEnabled: true, networkMode: 'system', systemNetworkAccepted: true });
  assert.equal(config.proxy, '');
  assert.throws(() => createNetworkDispatcher({ ...config, systemNetworkAccepted: false }));
  assert.throws(() => createNetworkDispatcher({ ...config, networkMode: 'proxy' }));
});
test('selected proxy carries actual HTTP request via CONNECT; system route uses OS sockets', async t => {
  let connections = 0;
  const sockets = new Set();
  const target = http.createServer((req, res) => res.end('route-ok'));
  const proxy = http.createServer();
  proxy.on('connect', (req, client, head) => {
    connections++;
    const u = new URL('http://' + req.url);
    const upstream = net.connect(Number(u.port), u.hostname, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
    for (const socket of [client, upstream]) { sockets.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => sockets.delete(socket)); }
  });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); target.closeAllConnections(); proxy.closeAllConnections(); await Promise.all([new Promise(r => target.close(r)), new Promise(r => proxy.close(r))]); });
  const url = `http://127.0.0.1:${target.address().port}`;
  const explicit = createNetworkDispatcher({ networkMode: 'proxy', proxy: `http://127.0.0.1:${proxy.address().port}` });
  try { assert.equal(await (await fetch(url, { dispatcher: explicit })).text(), 'route-ok'); assert.equal(connections, 1); } finally { await explicit.close(); }
  const system = createNetworkDispatcher({ networkMode: 'system', systemNetworkAccepted: true });
  try { assert.equal(await (await fetch(url, { dispatcher: system })).text(), 'route-ok'); assert.equal(connections, 1); } finally { await system.close(); }
  const unavailable = createNetworkDispatcher({ networkMode: 'proxy', proxy: 'http://127.0.0.1:1' });
  try { await assert.rejects(fetch(url, { dispatcher: unavailable })); } finally { await unavailable.close(); }
});

test('failure classification separates proxy, service and terminal authorization without exporting raw errors',async()=>{
 const {networkFailureReason,validatedRoute}=await import('../companion/network.mjs');
 for(const [code,reason] of [['NO_PROXY_CANDIDATES','no_proxy_found'],['PROXY_UNREACHABLE','proxy_unreachable'],['AUTH_TIMEOUT','auth_timeout'],['AUTH_DENIED','auth_denied']])assert.equal(networkFailureReason({cause:{code}}),reason);
 assert.equal(networkFailureReason({cause:{code:'ECONNREFUSED',address:'127.0.0.1'}}),'proxy_unreachable');assert.equal(networkFailureReason({code:'TLS_FAILURE'}),'service_unreachable');
 assert.equal(validatedRoute({kind:'proxy',source:'env',proxy:'http://secret:password@127.0.0.1:1234'}),null);assert.equal(validatedRoute({kind:'proxy',source:'env',proxy:'http://remote.example:1234'}),null);
 assert.deepEqual(validatedRoute({kind:'proxy',source:'system',proxy:'http://127.0.0.1:1234',extra:'secret'}),{kind:'proxy',source:'system',proxy:'http://127.0.0.1:1234'});
});

test('authorization expired or denied is terminal and preserves machine-readable reason',async()=>{
 const {DeviceAuthenticator}=await import('../vendor/remote-device/device-authenticator.js');
 for(const [error,code] of [['expired_token','AUTH_TIMEOUT'],['access_denied','AUTH_DENIED']]){const a=new DeviceAuthenticator('https://example.invalid',{fetch:async()=>({ok:false,status:400,headers:{get:()=>null},json:async()=>({error})}),capture:async()=>{},monotonicNow:()=>0});a.sleep=async()=>{};await assert.rejects(a.pollForAuthorization({expires_in:1,interval:1,device_code:'synthetic'},'synthetic'),{code});}
 const expired=new DeviceAuthenticator('https://example.invalid',{capture:async()=>{}});await assert.rejects(expired.pollForAuthorization({expires_in:0},'synthetic'),{code:'AUTH_TIMEOUT'});
});
