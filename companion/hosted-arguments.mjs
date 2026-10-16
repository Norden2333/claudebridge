// Translate only documented hosted metadata/defaults; never drop arbitrary fields.
export function hostedArguments(name,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('托管工具参数必须是对象，操作未开始。');
 const clean={...args};
 if(Object.hasOwn(clean,'origin')){
  if(!['ui','llm'].includes(clean.origin))throw new Error('托管 origin 参数无效，操作未开始。');
  delete clean.origin;
 }
 if(name==='edit_block'&&Object.hasOwn(clean,'expected_replacements')){
  if(clean.expected_replacements!==1)throw new Error('只支持一次精确替换；多个改动请用 edit_blocks 或 get_config 的批量协议，操作未开始。');
  delete clean.expected_replacements;
 }
 return clean;
}
