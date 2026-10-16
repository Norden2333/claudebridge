import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FileExecutor} from '../companion/files.mjs';
import {treeSignature} from '../companion/undo.mjs';
import {processingBudget} from '../companion/budget.mjs';
for(const kind of ['inspection','signature'])test('directory '+kind+' inherits the operation deadline',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'cfb-budget-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 await fs.writeFile(path.join(base,'sample.txt'),'unchanged');
 const ex=new FileExecutor({folder:base,allowWrites:true}),now=Date.now;let clock=now();Date.now=()=>clock;
 try{await processingBudget(async()=>{clock+=600001;await assert.rejects(kind==='inspection'?ex.inspectTree(base):treeSignature(ex,base),/预算/);});}finally{Date.now=now;}
 assert.equal(await fs.readFile(path.join(base,'sample.txt'),'utf8'),'unchanged');
});
