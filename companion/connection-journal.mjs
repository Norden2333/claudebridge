import path from 'node:path';
import {readBounded} from './safe-io.mjs';
import {durableRecord} from './record-io.mjs';
const EVENTS=['session_start','state','retire_start','retire_end'];
const STATES=['idle','starting','online','reconnecting','blocked','auth_required','error'];
const PHASES=['idle','connecting','online','retry_wait','retiring','attention'];
const REASONS=['network_unavailable','settings_invalid','identity_unavailable','folder_unavailable','no_proxy_found','proxy_unreachable','service_unreachable','auth_timeout','auth_denied','channel_timeout','connection_lost','previous_device_still_running'];
const LIMIT=120,AGE=7*86400000;
const integer=(v,max)=>Number.isSafeInteger(v)&&v>=0?Math.min(v,max):0;
export function connectionRecord(value={},now=Date.now()) {
 if(!EVENTS.includes(value.event))return null;
 return {time:now,event:value.event,status:STATES.includes(value.status)?value.status:'idle',phase:PHASES.includes(value.phase)?value.phase:'idle',reason:REASONS.includes(value.reason)?value.reason:'',attempt:integer(value.attempt,1000000),retryAt:integer(value.retryAt,8640000000000000),elapsedMs:integer(value.elapsedMs,86400000),pending:integer(value.pending,32)};
}
// One coalescing writer; fixed allowlist, count, age and read-size limits.
// Persistence failure never blocks connection recovery or file execution.
export async function openConnectionJournal(root,{now=Date.now,write=durableRecord}={}) {
 const file=path.join(root,'connection-history.json');let entries=[],available=true,dirty=false,writing=null;
 try{const saved=JSON.parse((await readBounded(file,128*1024)).toString('utf8'));if(Array.isArray(saved.entries))entries=saved.entries.slice(-LIMIT).filter(e=>Number.isSafeInteger(e?.time)&&e.time<=now()&&e.time>=now()-AGE).map(e=>connectionRecord(e,e.time)).filter(Boolean);}catch(e){if(e.code!=='ENOENT')available=false;}
 const drain=()=>{if(writing)return writing;writing=(async()=>{while(dirty){dirty=false;try{await write(file,{schema:'claude-folder-connection/v1',entries:[...entries]});available=true;}catch{available=false;dirty=false;}}})().finally(()=>{writing=null;});return writing;};
 return {record(value){const e=connectionRecord(value,now());if(!e)return;entries=entries.filter(x=>x.time>=now()-AGE).concat(e).slice(-LIMIT);dirty=true;void drain();},snapshot(){return {available,limit:LIMIT,entries:entries.filter(x=>x.time>=now()-AGE).map(e=>({...e}))};},async flush(){while(dirty||writing)await (writing||drain());}};
}

export function relayConnectionState(relay,recovery,retiring,now=Date.now()) {
 const phase=retiring?'retiring':relay.status==='online'?'online':['blocked','auth_required','error'].includes(relay.status)?'attention':recovery.nextAt>now?'retry_wait':['starting','reconnecting'].includes(relay.status)?'connecting':'idle';
 return {...relay,phase,attempt:recovery.attempt,retryAt:phase==='retry_wait'?recovery.nextAt:0,retryInSeconds:phase==='retry_wait'?Math.max(0,Math.ceil((recovery.nextAt-now)/1000)):0};
}
