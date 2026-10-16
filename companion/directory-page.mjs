import fs from 'node:fs/promises';import path from 'node:path';import {processingDeadline} from './budget.mjs';
export async function directoryPage(ex,args){
 const depth=args.depth??1,offset=args.offset??0,length=args.length??100;
 if(!Number.isInteger(depth)||depth<1||depth>20||!Number.isInteger(offset)||offset<0||offset>20000||!Number.isInteger(length)||length<1||length>200)throw new Error('目录范围无效：深度1至20，分页长度1至200。');
 const root=await ex.target(args.path||'.',true),entries=[];let count=0,visited=0,budget=12000,stopped=false,bounded=false,pageFull=false;
 const deadline=processingDeadline();
 async function walk(dir,level){
  await ex.target(ex.label(dir),true);
  const list=[];let truncatedHere=false;const handle=await fs.opendir(dir);
  try{for await(const item of handle){if(++visited>20000||Date.now()>deadline){bounded=truncatedHere=true;break;}list.push(item);}}finally{await handle.close().catch(()=>{});}
  list.sort((a,b)=>a.name.localeCompare(b.name));
  for(const item of list){
   if(stopped)return;
   if(Date.now()>deadline){stopped=bounded=true;return;}
   let candidate;
   try{candidate=ex.childTarget?await ex.childTarget(dir,item.name):await ex.target(ex.label(path.join(dir,item.name)),true);}catch(e){if(['CFB_INTERNAL_PATH','CFB_HARDLINK','CFB_SENSITIVE_PATH'].includes(e.code))continue;if(item.isSymbolicLink())continue;throw e;}
   const row={name:path.relative(root,candidate).split(path.sep).join('/'),type:item.isDirectory()?'directory':'file'};
   if(count++>=offset){const size=JSON.stringify(row).length;if(entries.length>=length||size>budget)pageFull=true;else{entries.push(row);budget-=size;}}
   if(item.isDirectory()&&level<depth&&!bounded)await walk(candidate,level+1);
  }
  if(truncatedHere)stopped=true;
 }
 await walk(root,1);
 return {entries,depth,hasMore:pageFull||bounded,nextOffset:offset+entries.length,...(!bounded?{total:count}:{truncated:true}),...(bounded?{limitReached:true}:{}),namesRelativeToRequestedDirectory:true};
}
