import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
const ctx=vm.createContext({self:{}});
const fsSource=await fs.readFile(new URL('../extension/pet.js',import.meta.url),'utf8');
vm.runInContext(fsSource,ctx);
const select=ctx.self.CFB_PET.select;
const ready={local:'ready',relay:'online',relayEnabled:true};
test('pet pauses hidden/reduced-motion/disabled views, owns at most one timer and disposes listeners',()=>{
 const listeners={},mediaListeners={},timers=new Map();let timerId=0,now=100000;
 class Element{constructor(){this.children=[];this.dataset={};this.classes=new Set();this.classList={toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k)};this.attributes={};}append(x){this.children.push(x);}setAttribute(k,v){this.attributes[k]=v;}attachShadow(){return this.shadow={innerHTML:''};}remove(){this.removed=true;}}
 const doc={hidden:false,createElement:()=>new Element(),addEventListener:(k,f)=>listeners[k]=f,removeEventListener:k=>delete listeners[k]};
 const media={matches:false,addEventListener:(k,f)=>mediaListeners[k]=f,removeEventListener:k=>delete mediaListeners[k]};
 const win={matchMedia:()=>media,setTimeout:(f,ms)=>{timers.set(++timerId,{f,ms});return timerId},clearTimeout:id=>timers.delete(id)};
 const fake=vm.createContext({self:{CFB_PET_ASSETS:{idle:'<svg/>',working:'<svg/>',error:'<svg/>',happy:'<svg/>',sleeping:'<svg/>'}},Date:{now:()=>now}});
 vm.runInContext(fsSource,fake);let toggles=0;
 const pet=fake.self.CFB_PET.create({doc,win,onToggle:()=>toggles++});
 pet.update({state:ready,entries:[]},{});assert.equal(timers.size,1);
 pet.update({state:ready,entries:[]},{});assert.equal(timers.size,1);
 const stage=pet.host.children[0],html=stage.shadow.innerHTML;
 doc.hidden=true;listeners.visibilitychange();assert.equal(timers.size,0);assert.ok(stage.classes.has('paused'));
 doc.hidden=false;listeners.visibilitychange();assert.equal(timers.size,1);assert.ok(!stage.classes.has('paused'));
 media.matches=true;mediaListeners.change();assert.ok(stage.classes.has('paused'));
 media.matches=false;pet.update({state:ready,entries:[]},{motion:false});assert.ok(stage.classes.has('paused'));assert.equal(stage.shadow.innerHTML,html);
 pet.update({state:ready,entries:[]},{petEnabled:false});assert.equal(pet.host.hidden,true);assert.equal(timers.size,0);
 pet.host.onclick();assert.equal(toggles,1);pet.dispose();assert.equal(timers.size,0);assert.deepEqual(Object.keys(listeners),[]);assert.deepEqual(Object.keys(mediaListeners),[]);
});
test('pet uses actual local file states, distinguishes attention from completed task and does not celebrate a replay',()=>{
 const now=100000,entry=(state,time=now-100)=>({state,time});
 assert.equal(select({state:ready,entries:[entry('running')]},now,now).name,'working');
 assert.equal(select({state:ready,entries:[entry('completed'),entry('unknown')]},now,now).name,'attention');
 assert.equal(select({state:ready,entries:[entry('completed'),entry('queued')]},now,now).name,'working');
 assert.equal(select({state:ready,entries:[entry('completed')]},now,now).name,'happy');
 assert.equal(select({state:ready,entries:[entry('replayed')]},now,now).name,'idle');
 assert.equal(select({state:ready,entries:[entry('completed',now-6000)]},now,now-61000).name,'sleeping');
 assert.equal(select({state:ready,entries:[entry('completed',now-6000)],alert:{active:true,message:'离线'}},now,now).text,'离线');
 assert.equal(select({state:{...ready,relay:'auth_required'},entries:[]},now,now).name,'error');
 assert.equal(select({state:{local:'unconfigured'},entries:[]},now,now).name,'waiting');
});
test('bundled pet assets match pinned source; no scripts/external resources or extra extension permissions',async()=>{
 const upstream=JSON.parse(await fs.readFile(new URL('../UPSTREAM.json',import.meta.url),'utf8'));
 assert.equal(upstream.clawd.license,'AGPL-3.0-only');assert.match(upstream.clawd.commit,/^[a-f0-9]{40}$/);
 for(const file of upstream.clawd.files.filter(f=>f.path.endsWith('.svg'))){
  const bytes=await fs.readFile(new URL('../extension/pet-assets/'+file.path.split('/').at(-1),import.meta.url));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);
  const text=bytes.toString('utf8');assert.doesNotMatch(text,/<(?:script|foreignObject|image|animate)\b|@import|url\(/i);
  for(const match of text.matchAll(/href="([^"]*)"/g))assert.ok(match[1].startsWith('#'));
 }
 const manifest=JSON.parse(await fs.readFile(new URL('../extension/manifest.json',import.meta.url),'utf8'));
 assert.deepEqual(manifest.permissions,['nativeMessaging','alarms','downloads','storage']);
 const scripts=manifest.content_scripts.find(x=>x.world==='ISOLATED').js;
 assert.ok(scripts.indexOf('pet.js')>scripts.indexOf('pet-assets.js'));
 assert.ok(scripts.indexOf('pet.js')<scripts.indexOf('content-isolated.js'));
});
