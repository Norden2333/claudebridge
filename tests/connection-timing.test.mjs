import test from 'node:test';import assert from 'node:assert/strict';
import {RemoteChannel} from '../vendor/remote-device/remote-channel.js';
import {TRANSPORT_HEARTBEAT_MS,CONFIRMED_HEARTBEAT_STALE_MS} from '../companion/connection-timing.mjs';
test('bundled realtime SDK actually receives the quicker transport timing without model calls or a network probe',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('No network permitted in timing fixture');};
 const channel=new RemoteChannel();try{channel.initialize('https://synthetic.invalid','synthetic-key');assert.equal(channel.client.realtime.heartbeatIntervalMs,TRANSPORT_HEARTBEAT_MS);assert.equal(CONFIRMED_HEARTBEAT_STALE_MS,4*TRANSPORT_HEARTBEAT_MS);assert.equal(channel.isReachable(),false);await channel.client.auth.stopAutoRefresh();assert.equal(calls,0);}finally{await channel.client?.removeAllChannels();globalThis.fetch=original;}
});
