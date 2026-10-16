const readable=new Set(['status','diagnostics','setup_status','profile_status','recent_folders','operation_status','asset_status','asset_abort']);
export function recoveryRequest(message){return readable.has(message.action)||(message.action==='active'&&message.value===false);}
export function assertClient(message,version){
 if(recoveryRequest(message))return;
 if(message.clientVersion!==version||message.nativeProtocol!==1){const e=new Error('插件与本机程序版本不匹配，操作未开始。请将两者更新到同一版本，再重新加载扩展。状态和诊断仍可查看。');e.code='CFB_VERSION_MISMATCH';throw e;}
}
