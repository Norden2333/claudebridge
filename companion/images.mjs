import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { inflateSync } from 'node:zlib';
export const MAX_IMAGE_SOURCE = 64 * 1024 * 1024;
export const MAX_IMAGE_REPLY = 512 * 1024;
const MAX_PIXELS = 40 * 1000 * 1000;
function checkPngInflation(data,size) {
  const chunks=[]; let headers=0;
  for(let p=8;p<data.length;) { if(p+12>data.length) throw new Error('PNG结构不完整。'); const length=data.readUInt32BE(p), type=data.toString('ascii',p+4,p+8); if(p+12+length>data.length) throw new Error('PNG内容长度无效。'); if(type==='IHDR' && (++headers!==1 || length!==13)) throw new Error('PNG图片头无效。'); if(type==='IDAT') chunks.push(data.subarray(p+8,p+8+length)); p+=12+length; }
  if(headers!==1 || !chunks.length) throw new Error('PNG缺少图像数据。');
  // pngjs uses unrestricted inflate for interlaced images; bound it before decode.
  inflateSync(Buffer.concat(chunks),{maxOutputLength:size.width*size.height*8+size.height*16+1024*1024});
}
export function dimensions(data, kind) {
  if (kind==='png' && data.length>=24) return {width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
  if (kind==='jpeg') for(let p=2;p+4<data.length;) {
    if(data[p++]!==255) continue; while(data[p]===255) p++; const marker=data[p++]; if(marker===0xda || marker===0xd9) break;
    if(marker===1 || (marker>=0xd0 && marker<=0xd8)) continue;
    if(p+2>data.length) break; const length=data.readUInt16BE(p); if(length<2 || p+length>data.length) break;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=8) return {width:data.readUInt16BE(p+5),height:data.readUInt16BE(p+3)}; p+=length;
  }
  if(kind==='webp' && data.length>=30) {
    const type=data.toString('ascii',12,16);
    if(type==='VP8X') return {width:data.readUIntLE(24,3)+1,height:data.readUIntLE(27,3)+1};
    if(type==='VP8L' && data[20]===0x2f) { const bits=data.readUInt32LE(21); return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1}; }
    if(type==='VP8 ' && data.subarray(23,26).equals(Buffer.from([157,1,42]))) return {width:data.readUInt16LE(26)&0x3fff,height:data.readUInt16LE(28)&0x3fff};
  }
  return null;
}
function resample(decoded, region, max) {
  const ratio=Math.min(1,max/Math.max(region.width,region.height)), width=Math.max(1,Math.round(region.width*ratio)), height=Math.max(1,Math.round(region.height*ratio)), data=Buffer.alloc(width*height*4);
  // Bilinear sampling avoids the harsh aliasing of nearest-neighbour previews.
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const fx=region.x+(width===1 ? 0 : x*(region.width-1)/(width-1)), fy=region.y+(height===1 ? 0 : y*(region.height-1)/(height-1));
    const x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(x0+1,region.x+region.width-1),y1=Math.min(y0+1,region.y+region.height-1),dx=fx-x0,dy=fy-y0, out=(y*width+x)*4;
    for(let c=0;c<4;c++) { const a=decoded.data[(y0*decoded.width+x0)*4+c],b=decoded.data[(y0*decoded.width+x1)*4+c],d=decoded.data[(y1*decoded.width+x0)*4+c],e=decoded.data[(y1*decoded.width+x1)*4+c]; data[out+c]=Math.round((a*(1-dx)+b*dx)*(1-dy)+(d*(1-dx)+e*dx)*dy); }
  }
  return {width,height,data};
}
export function imagePreview(data, kind, args={}) {
  const size=dimensions(data,kind), max=args.max_dimension ?? 1600;
  if(!Number.isInteger(max) || max<320 || max>4096) throw new Error('预览尺寸需为320至4096像素。');
  if(size && (!size.width || !size.height || size.width*size.height>MAX_PIXELS)) throw new Error('图片分辨率超出本机预览预算，请使用附件或先选择较小原图。');
  if(!args.image_region && data.length<=MAX_IMAGE_REPLY && (!size || Math.max(size.width,size.height)<=max)) return {data,mimeType:'image/'+kind,preview:false,...size};
  if(kind==='webp') return {unsupported:true,guidance:'较大的WebP暂需通过Claude附件查看；可正常复制、移动、下载保存，原图不会被改写。'};
  if(!['jpeg','png'].includes(kind) || !size) throw new Error('图片格式无法解析，原图未改动。');
  let region=args.image_region || {x:0,y:0,...size};
  if(Object.keys(region).some(k=>!['x','y','width','height'].includes(k)) || Object.values(region).some(v=>!Number.isInteger(v)) || !['x','y','width','height'].every(k=>k in region) || region.x<0 || region.y<0 || region.width<1 || region.height<1 || region.x+region.width>size.width || region.y+region.height>size.height) throw new Error('图片细节范围超出原图。');
  if(kind==='png') checkPngInflation(data,size);
  const decoded=kind==='png' ? PNG.sync.read(data,{checkCRC:true}) : jpeg.decode(data,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:40,maxMemoryUsageInMB:384});
  let bound=max;
  for(let attempt=0;attempt<6;attempt++) {
    const frame=resample(decoded,region,bound);
    if(kind==='png') { const encoded=PNG.sync.write(frame); if(encoded.length<=MAX_IMAGE_REPLY) return {data:encoded,mimeType:'image/png',preview:true,width:frame.width,height:frame.height,originalWidth:size.width,originalHeight:size.height,region,encodingLossless:true,lossy:frame.width!==region.width || frame.height!==region.height}; }
    let transparent=false; for(let p=0;p<frame.data.length;p+=4) { const alpha=frame.data[p+3]/255; if(alpha<1) transparent=true; for(let c=0;c<3;c++) frame.data[p+c]=Math.round(frame.data[p+c]*alpha+255*(1-alpha)); frame.data[p+3]=255; }
    const encoded=jpeg.encode(frame,90).data;
    if(encoded.length<=MAX_IMAGE_REPLY) return {data:encoded,mimeType:'image/jpeg',preview:true,width:frame.width,height:frame.height,originalWidth:size.width,originalHeight:size.height,region,lossy:true,transparencyFlattened:transparent};
    bound=Math.max(320,Math.floor(bound*.75));
  }
  throw new Error('无法生成大小合适的图片预览；原图保留，请使用附件。');
}
