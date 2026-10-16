import {assetSafeSuffix} from './sensitive-paths.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fingerprint, copyVerified } from './safe-io.mjs';
import crypto from 'node:crypto';
import { folderLock } from './folder-lock.mjs';
import { scopeId, activityOutcome } from './activity.mjs';
export async function importDownload(executor, source, operationId, {subdirectory=''}={}) {
  if (!executor.config.allowWrites || !executor.config.folder) throw new Error('请先选择工作文件夹并开启文件修改权限。');
  if (typeof source !== 'string' || !path.isAbsolute(source) || source.includes('\0')) throw new Error('下载文件路径无效。');
  const eventId=crypto.randomUUID(), started=Date.now();
  const emit=(state,result)=>{ try { executor.onActivity?.({id:eventId,operationId,scope:scopeId(executor.config.folder),kind:'import_download',channel:'download',paths:result?.path?[result.path.slice(0,160)]:[],state,time:Date.now(),elapsed:Date.now()-started,...(result?.verified?{verified:true}:{})}); } catch {} };
  emit('queued');
  const operation = folderLock(executor.config.folder,executor.lockRoot,async()=>{await executor.assertActive();emit('running');return executor.journal.execute(executor.config.folder, operationId, 'import_download', { source, ...(subdirectory?{subdirectory}:{}) }, async () => {
    const resolved = await fs.realpath(source);
    if (resolved !== path.resolve(source)) throw new Error('不允许导入符号链接路径。');
    const directory=await executor.target(subdirectory||'.',true);if(!(await fs.stat(directory)).isDirectory())throw new Error('保存子文件夹不存在，请先创建或选择已有文件夹。');
    const filename = assetSafeSuffix(path.basename(resolved)), parsed = path.parse(filename);
    if (filename === '.claude-file-operation.json') throw new Error('不能用下载覆盖保留协议路径。');
    for (let n = 0; n < 10000; n++) {
      const name = n ? `${parsed.name} (${n})${parsed.ext}` : filename;
      const target = await executor.target(executor.label(path.join(directory,name)));
      await executor.checkProtection('write_file',{path:executor.label(target)});
      if (target === resolved) return {path:executor.label(target),...await fingerprint(target),verified:true,alreadyInFolder:true,changed:false};
      try { return {...(filename!==path.basename(resolved)?{renamedForSafety:true,nameNotice:'启动或可执行入口后缀已追加.txt，原字节保留'}:{}),path:executor.label(target),...await copyVerified(resolved,target,{validateTarget:()=>executor.target(executor.label(path.join(directory,name)))})}; }
      catch(e) {if(e.code==='EEXIST') continue; throw e;}
    }
    throw new Error('同名文件过多，请先整理目标文件夹。');
  });});
  return operation.then(result=>{emit(activityOutcome(result),result);return result;},error=>{emit(/已暂停/.test(error.message)?'paused':'unknown');throw error;});
}
