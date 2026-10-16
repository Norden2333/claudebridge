import path from 'node:path';
export function fileFormat(name, header) {
  const ext = path.extname(name).toLowerCase();
  let detected;
  if (header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) detected = 'png';
  else if (header[0] === 255 && header[1] === 216 && header[2] === 255) detected = 'jpeg';
  else if (header.toString('ascii',0,4) === 'RIFF' && header.toString('ascii',8,12) === 'WEBP') detected = 'webp';
  else if (header.toString('ascii',0,4) === '%PDF') detected = 'pdf';
  else if (header.length >= 4 && header.readUInt32LE(0) === 0x04034b50) detected = 'zip';
  else if (header.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]))) detected = 'legacy-office';
  else if (header.includes(0)) detected = 'binary';
  else { try { new TextDecoder('utf-8',{fatal:true}).decode(header,{stream:true}); detected = 'text'; } catch { detected = 'binary'; } }
  const office = ['.docx','.pptx','.xlsx'].includes(ext);
  const protectedExtension = office || ['.doc','.ppt','.xls','.docm','.pptm','.xlsm','.pdf','.png','.jpg','.jpeg','.webp','.gif','.bmp','.tif','.tiff','.zip','.mp4','.mp3','.exe'].includes(ext);
  const kind = detected === 'zip' && office ? ext.slice(1) : protectedExtension && detected === 'text' ? 'unsupported' : detected;
  return { kind, extension: ext, textEditable: kind === 'text' && !protectedExtension, image: ['png','jpeg','webp'].includes(kind), office: ['docx','pptx','xlsx'].includes(kind), guidance: kind === 'pdf' || kind === 'legacy-office' || kind === 'unsupported' ? '可查询、复制、移动和回收；内容和版式修改请用原应用或Claude附件。不要用文本写入覆盖。' : office && detected === 'zip' ? '按文档部分读取文字；图片、图表和版式未渲染。Word/PPT的单个文字片段默认修改原文件，output_path可另存；Excel只读。' : ['png','jpeg','webp'].includes(kind) ? '需要看图时读取一次图片；替换图片请生成新文件并另存，不用文本工具覆盖。' : kind === 'text' ? '只读取相关片段，优先局部编辑或一次提交多个替换。' : '不作为文本编辑；保持原始字节复制、移动或回收。' };
}

export function legacyReadOnlyText(name,data){
 if(!['.txt','.csv','.tsv','.md','.log','.ini'].includes(path.extname(name).toLowerCase()))return null;
 let encoding;if(data[0]===255&&data[1]===254)encoding='utf-16le';else if(data[0]===254&&data[1]===255)encoding='utf-16be';
 else{if(data.includes(0))return null;try{new TextDecoder('utf-8',{fatal:true}).decode(data);return null;}catch{}encoding='gb18030';}
 try{return {content:new TextDecoder(encoding,{fatal:true}).decode(data),encoding,editable:false,editingGuidance:'非UTF-8文件只读；如需编辑请明确另存为UTF-8，原字节保留。'};}catch{return null;}
}
