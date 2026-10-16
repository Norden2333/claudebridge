import {validateFolder} from './files.mjs';
import {CONFIRMED_HEARTBEAT_STALE_MS} from './connection-timing.mjs';
import {automaticRouteChanged,automaticRouteCheckDue} from './network-discovery.mjs';
import path from 'node:path';
import { setGlobalDispatcher, WebSocket } from 'undici';
import { networkFailureReason,prepareNetworkDispatcher } from './network.mjs';
import { stateRoot, loadSettings } from './settings.mjs';
const config = await loadSettings();
if (!config.folder || !config.relayEnabled) process.exit(2);
try{if(await validateFolder(config.folder)!==config.folder)throw new Error('folder changed');}catch{process.send?.({status:'blocked',reason:'folder_unavailable'});process.exit(2);}
// Fetch and WebSockets share the explicitly selected route; never fall back between modes.
let dispatcher;
try { dispatcher = await prepareNetworkDispatcher(config); }
catch(error) { process.send?.({status:'reconnecting',reason:networkFailureReason(error)});process.exit(2); }
const route=config.networkMode==='auto'?(await import('./network-discovery.mjs')).automaticSelectedRoute(dispatcher):config.networkMode==='proxy'?{kind:'proxy',proxy:config.proxy,source:'manual'}:{kind:'system',source:'system'};
setGlobalDispatcher(dispatcher);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options = {}) => originalFetch(input, { ...options, dispatcher, signal: options.signal || AbortSignal.timeout(20000) });
globalThis.WebSocket = class extends WebSocket { constructor(url, protocols = []) { super(url, { protocols, dispatcher }); } };
process.env.DESKTOP_COMMANDER_CONFIG_DIR = path.join(stateRoot, 'device');
delete process.env.MCP_SERVER_URL;
process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';
let lastAnnouncement=null,lastAnnouncementAt=-Infinity;
const announce=(status,reason,resultDelivery)=>{const value={status,route,...(reason?{reason}:{}),...(resultDelivery?{resultDelivery}:{})},key=JSON.stringify(value),now=performance.now();if(key===lastAnnouncement&&now-lastAnnouncementAt<30000)return;lastAnnouncement=key;lastAnnouncementAt=now;process.send?.(value);};
let device, stopping = false, complete = false;
// Do not forward vendor logs (which may contain paths, account or device identifiers).
console.debug = () => {}; console.error = () => {}; console.warn = () => {};
console.log = (...values) => { if (values[0] === '✅ Device ready:') announce('online'); };
async function stop() {
  if (stopping) return; stopping = true;
  clearInterval(monitor);clearInterval(routeMonitor);
  try {
    // Reject new file work, then drain current work before network teardown.
    await device?.desktop?.shutdown(); await device?.shutdown();
  } finally { await dispatcher.close(); process.exit(0); }
}
process.on('message', message => { if (message?.action === 'shutdown') void stop(); });
process.once('disconnect', () => void stop());
const monitor = setInterval(() => {
  if (!complete || stopping) return;
  if (device.persistenceError) { announce('blocked','identity_unavailable'); void stop(); return; }
  const channel = device.remoteChannel;
  const fresh = channel.lastHeartbeatOkAt !== null && performance.now() - channel.lastHeartbeatOkAt < CONFIRMED_HEARTBEAT_STALE_MS;
  announce(channel.isReachable() && fresh ? 'online' : 'reconnecting', undefined, {pending:channel.resultDeliveries.size,unconfirmed:!!channel.deliveryError});
}, 3000);
let routeChecking=false,lastRouteCheck=null;
const routeMonitor=setInterval(()=>{if(config.networkMode!=='auto'||!complete||stopping||routeChecking||!automaticRouteCheckDue(lastRouteCheck,device?.remoteChannel?.isReachable()===true))return;lastRouteCheck=performance.now();routeChecking=true;void automaticRouteChanged(dispatcher).then(changed=>{if(changed&&!stopping){announce('reconnecting','network_unavailable');void stop();}}).catch(()=>{}).finally(()=>{routeChecking=false;});},5000);
try {
  const response = await fetch('https://mcp.desktopcommander.app/api/mcp-info');
  if (!response.ok) throw new Error('Proxy check failed');
  await response.body.cancel();
  const { MCPDevice } = await import('../vendor/remote-device/device.js');
  device = new MCPDevice({ persistSession: true });
  await device.start(); complete = true;
} catch (error) { const identityFailure = ['CFB_DEVICE_STATE_INVALID','CFB_DEVICE_STATE_WRITE_FAILED'].includes(error?.code); const reason=identityFailure?'identity_unavailable':networkFailureReason(error);announce(identityFailure?'blocked':['auth_timeout','auth_denied'].includes(reason)?'auth_required':'reconnecting',reason); await stop(); }
