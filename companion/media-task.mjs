import {Worker} from 'node:worker_threads';
import {processingDeadline} from './budget.mjs';
// Parsing is isolated from the connection loop; an oversized or malformed document cannot block its heartbeat.
export function mediaTask(task,path,kind,args={}) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./media-worker.mjs',import.meta.url),{workerData:{task,path,kind,args},resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:32}});
    let settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(result);};
    const timer=setTimeout(()=>finish(new Error('文档处理超过60秒或任务时间预算，已停止解析，原文件未改动。可缩小范围或用原应用处理。')),Math.max(1,Math.min(60000,processingDeadline()-Date.now())));
    worker.once('message',m=>finish(m.ok?null:new Error(m.error),m.result));
    worker.once('error',()=>finish(new Error('文档解析超出资源预算或格式异常，原文件未改动，连接仍可继续使用。')));
    worker.once('exit',code=>{if(!settled)finish(new Error('文档解析已停止（'+code+'），原文件未改动。'));});
  });
}
