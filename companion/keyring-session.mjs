import {spawn} from 'node:child_process';import crypto from 'node:crypto';
const service='claude-folder-bridge';
export const keyringReference=root=>crypto.createHash('sha256').update(root).digest('hex');
export function keyringPlan(platform,reference,encoded){
 if(!/^[a-f0-9]{64}$/.test(reference))throw new Error('Invalid credential namespace');
 if(encoded!==undefined&&(typeof encoded!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)||encoded.length>349528))throw new Error('Invalid credential encoding');
 if(platform==='darwin'){
  const input=encoded===undefined?null:`add-generic-password -U -s ${service} -a ${reference} -w ${encoded}\n`;
  if(input&&Buffer.byteLength(input)>=4000)throw new Error('Credential exceeds safe Keychain input size');
  return {command:'/usr/bin/security',args:input?['-i','-q']:['find-generic-password','-s',service,'-a',reference,'-w'],input};
 }
 if(platform==='linux')return {command:'/usr/bin/secret-tool',args:encoded===undefined?['lookup','application',service,'namespace',reference]:['store','--label=Claude Folder Bridge','application',service,'namespace',reference],input:encoded??null};
 throw new Error('Platform credential service not supported');
}
export function runKeyring(plan){return new Promise((resolve,reject)=>{
 const child=spawn(plan.command,plan.args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='',bytes=0,settled=false;
 const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(new Error('OS credential service unavailable; no plaintext fallback')):resolve(result);};
 const timer=setTimeout(()=>{child.kill();done(true);},30000);
 child.on('error',()=>done(true));child.stdin.on('error',()=>done(true));child.stderr.resume();
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1048576){child.kill();done(true);}else output+=chunk.toString('utf8');});
 child.on('close',code=>done(code!==0,output.trim()));child.stdin.end(plan.input||'','utf8');
});}
export async function protectKeyring(session,{platform,root,run=runKeyring}){
 if(typeof session?.access_token!=='string'||typeof session?.refresh_token!=='string')throw new Error('Invalid session');
 const reference=keyringReference(root),encoded=Buffer.from(JSON.stringify(session)).toString('base64');
 try{await run(keyringPlan(platform,reference,encoded));const check=await run(keyringPlan(platform,reference));if(check!==encoded)throw new Error('Keyring write verification failed');return {protection:'cfb-session/'+(platform==='darwin'?'keychain':'secret-service')+'-v1',keyReference:reference};}
 catch{return null;} // Keep authorization in memory if the OS service is unavailable.
}
export async function unprotectKeyring(stored,{platform,root,run=runKeyring}){
 const expected='cfb-session/'+(platform==='darwin'?'keychain':'secret-service')+'-v1';if(stored?.protection!==expected||stored.keyReference!==keyringReference(root))return null;
 try{const encoded=await run(keyringPlan(platform,stored.keyReference));if(!encoded||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('Bad stored credential');const decoded=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));if(typeof decoded.access_token!=='string'||typeof decoded.refresh_token!=='string')throw new Error('Bad stored session');return decoded;}
 catch{return null;} // A locked/missing keyring requires fresh authorization, never a disk secret.
}
