import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {acquireLease} from './lease.mjs';
import {processingBudget} from './budget.mjs';
const chains = new Map(),held=new AsyncLocalStorage();
export const ownsFolderLock=folder=>held.getStore()===crypto.createHash('sha256').update(folder||'').digest('hex');
// Both native Chat and remote Cowork processes share this lease. No live lease is stolen.
export function folderLock(folder, root, action, {waitMs=660000,budgetMs=600000}={}) {
  const key = crypto.createHash('sha256').update(folder || '').digest('hex');
  const previous = chains.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    if (!root || !folder) return held.run(key,()=>processingBudget(action,budgetMs));
    await fs.mkdir(root,{recursive:true,mode:0o700});
    const lock=await acquireLease(path.join(root,key),{directory:true,waitMs,staleMs:120000,heartbeatMs:10000});
    try{await lock.assertOwned();return await held.run(key,()=>processingBudget(async()=>{const result=await action();await lock.assertOwned();return result;},budgetMs));}
    finally{await lock.release();}
  });
  chains.set(key,operation);
  void operation.finally(()=>{if(chains.get(key)===operation)chains.delete(key);}).catch(()=>{});
  return operation;
}
