import crypto from 'node:crypto';
import {socksDispatcher} from './socks-proxy.mjs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fetch,ProxyAgent} from 'undici';
import {validateProxy} from './settings.mjs';
const run=promisify(execFile);
const routing=new WeakMap(),selectedRoutes=new WeakMap();export const automaticSelectedRoute=dispatcher=>selectedRoutes.get(dispatcher)||null;const routeHash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const probeUrl='https://mcp.desktopcommander.app/api/mcp-info';
export function localProxyCandidates({env={},systemProxy=''}={}){
 const results=[];
 const add=value=>{try{const u=validateProxy(value);if(!results.includes(u))results.push(u);}catch{}};
 for(const key of ['HTTPS_PROXY','https_proxy','HTTP_PROXY','http_proxy','ALL_PROXY','all_proxy'])if(typeof env[key]==='string')add(env[key]);
 if(typeof systemProxy==='string'&&systemProxy.length<=4096){
  if(!systemProxy.includes('='))add(systemProxy.includes('://')?systemProxy:'http://'+systemProxy.trim());
  else for(const token of systemProxy.split(';')){const match=token.trim().match(/^(https?|socks|all)=(.+)$/i);if(match)add(match[2].includes('://')?match[2]:(match[1].toLowerCase()==='socks'?'socks5h://':'http://')+match[2]);}
 }
 return results.slice(0,8);
}
export async function systemProxyValue({platform=process.platform,env=process.env}={}){
 // Read only the current user's configured local endpoint; never enumerate VPN subscriptions.
 if(platform!=='win32')return '';
 const windows=env.SystemRoot||'C:\\Windows';
 if(!path.win32.isAbsolute(windows))return '';
 try{
  const {stdout}=await run(path.win32.join(windows,'System32','reg.exe'),['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings','/v','ProxyServer'],{windowsHide:true,timeout:3000,maxBuffer:8192});
  return stdout.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim()||'';
 }catch{return '';}
}
export async function discoverProxyDispatcher({env=process.env,readSystem=()=>systemProxyValue(),testUrl=probeUrl,timeoutMs=6000}={}){
 let serviceAnswered=false;const systemProxy=await readSystem(),candidates=localProxyCandidates({env,systemProxy});
 for(const proxy of candidates){
  const dispatcher=proxy.startsWith('socks5')?socksDispatcher(proxy):new ProxyAgent(proxy);let accepted=false;
  try{
   // Public, credential-free service reachability only. No public-IP lookup and no direct fallback.
   const response=await fetch(testUrl,{dispatcher,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
   accepted=response.ok;if(!accepted)serviceAnswered=true;await response.body?.cancel();if(accepted){routing.set(dispatcher,routeHash(candidates));selectedRoutes.set(dispatcher,{kind:'proxy',proxy,source:localProxyCandidates({env}).includes(proxy)?'env':'system'});return dispatcher;}
  }catch{}finally{if(!accepted)await dispatcher.destroy().catch(()=>{});}
 }
 throw Object.assign(new Error('未找到可用的本机代理，未尝试直连。'),{code:!candidates.length?'NO_PROXY_CANDIDATES':serviceAnswered?'SERVICE_UNREACHABLE':'PROXY_UNREACHABLE'});
}

export async function automaticRouteChanged(dispatcher,{env=process.env,readSystem=()=>systemProxyValue()}={}){
 const before=routing.get(dispatcher);if(!before)return false;
 return before!==routeHash(localProxyCandidates({env,systemProxy:await readSystem()}));
}

export function automaticRouteCheckDue(last,reachable,now=performance.now()){return last===null||now-last>=(reachable?30000:5000);}

export async function automaticRouteSignature({env=process.env,readSystem=()=>systemProxyValue()}={}){return routeHash(localProxyCandidates({env,systemProxy:await readSystem()}));}
