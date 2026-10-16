import {socksDispatcher} from './socks-proxy.mjs';
import { Agent, ProxyAgent } from 'undici';
import { validateProxy } from './settings.mjs';
export function createNetworkDispatcher(config) {
  const mode = config.networkMode ?? 'proxy';
  if (mode === 'proxy') {const proxy=validateProxy(config.proxy);return proxy.startsWith('socks5')?socksDispatcher(proxy):new ProxyAgent(proxy);}
  if (mode !== 'system' || config.systemNetworkAccepted !== true) throw new Error('系统网络尚未确认。');
  // Ordinary sockets follow OS routing (including VPN/TUN), not browser PAC settings.
  // Only the user's VPN kill switch can prevent direct routing when the VPN stops.
  return new Agent();
}

export async function prepareNetworkDispatcher(config){
 if(config.networkMode==='auto'){const {discoverProxyDispatcher}=await import('./network-discovery.mjs');return discoverProxyDispatcher();}
 return createNetworkDispatcher(config);
}

export function networkFailureReason(error){
 const seen=new Set();for(let e=error;e&&!seen.has(e);e=e.cause){seen.add(e);if(e.code==='NO_PROXY_CANDIDATES')return 'no_proxy_found';if(e.code==='PROXY_UNREACHABLE')return 'proxy_unreachable';if(e.code==='AUTH_TIMEOUT')return 'auth_timeout';if(e.code==='AUTH_DENIED')return 'auth_denied';if(e.code==='ECONNREFUSED'&&['127.0.0.1','::1','localhost'].includes(e.address))return 'proxy_unreachable';}
 return 'service_unreachable';
}
export function validatedRoute(route){
 if(route?.kind==='system')return {kind:'system',source:'system'};
 if(route?.kind!=='proxy'||!['env','system','manual'].includes(route.source))return null;
 try{return {kind:'proxy',proxy:validateProxy(route.proxy),source:route.source};}catch{return null;}
}
