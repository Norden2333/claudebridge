import {connectionRecord} from './connection-journal.mjs';
// Export an explicit allowlist, never redact a raw status/error object by guessing.
const choice=(value,allowed)=>allowed.includes(value)?value:'unknown';
const version=value=>typeof value==='string'&&/^v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,40})?$/.test(value)?value:'unknown';
export function buildDiagnostics({hostVersion,nodeVersion,platform,arch,config={},relay={},connectionHistory,paused=false,operations=[],operationsAvailable=false}={}){
 const counts={completed:0,pending:0,unknown:0,failed_or_unknown:0,interrupted:0,rejected:0};
 for(const record of Array.isArray(operations)?operations.slice(0,50):[])if(record&&Object.hasOwn(counts,record.status))counts[record.status]++;
 return {schema:'claude-folder-diagnostics/v1',generatedAt:new Date().toISOString(),hostVersion:version(hostVersion),runtime:{node:version(nodeVersion),platform:choice(platform,['win32','darwin','linux']),arch:choice(arch,['x64','arm64','ia32'])},
  connection:{folderConfigured:typeof config.folder==='string'&&config.folder.length>0,allowWrites:config.allowWrites===true,paused:paused===true,coworkEnabled:config.relayEnabled===true,networkMode:choice(config.networkMode??'proxy',['auto','proxy','system']),proxyConfigured:typeof config.proxy==='string'&&config.proxy.length>0,relayStatus:choice(relay.status,['idle','starting','online','reconnecting','blocked','auth_required','error'])},
  ...(connectionHistory?{connectionHistory:{available:connectionHistory.available===true,limit:120,entries:(Array.isArray(connectionHistory.entries)?connectionHistory.entries:[]).slice(-120).filter(e=>Number.isSafeInteger(e?.time)&&e.time>0&&e.time<=Date.now()&&e.time>=Date.now()-7*86400000).map(e=>connectionRecord(e,e.time)).filter(Boolean)}}:{}),
  recentOperations:{available:operationsAvailable===true,limit:50,counts},privacy:{fileBodiesIncluded:false,fileNamesIncluded:false,pathsIncluded:false,credentialsIncluded:false,automaticUpload:false}};
}
