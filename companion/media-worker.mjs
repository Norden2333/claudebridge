import {parentPort,workerData} from 'node:worker_threads';
import {readBounded} from './safe-io.mjs';
import {readOffice,patchOffice} from './office.mjs';
import {imagePreview,MAX_IMAGE_SOURCE} from './images.mjs';
import {MAX_BINARY} from './office-zip.mjs';
try {
  const data=await readBounded(workerData.path,workerData.task==='image'?MAX_IMAGE_SOURCE:MAX_BINARY);
  const result=workerData.task==='image'?imagePreview(data,workerData.kind,workerData.args):workerData.task==='office'?readOffice(data,workerData.kind,workerData.args):patchOffice(data,workerData.kind,workerData.args.edits);
  if(result.data?.byteLength>8192 && result.data.buffer.byteLength===result.data.byteLength)parentPort.postMessage({ok:true,result},[result.data.buffer]);else parentPort.postMessage({ok:true,result});
}catch(error){parentPort.postMessage({ok:false,error:error.message});}
