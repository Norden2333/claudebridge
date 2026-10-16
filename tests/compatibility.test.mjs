import test from 'node:test';import assert from 'node:assert/strict';import {assertClient} from '../companion/compatibility.mjs';
test('wrong, missing or unsupported client versions cannot activate devices or mutate files and permissions',()=>{
 for(const action of ['active','configure','revoke_folder','tool','import_download','workspace_restore','workspace_protection_set','setup_check','retry'])for(const fields of [{},{clientVersion:'0.0.0',nativeProtocol:1},{clientVersion:'0.3.7',nativeProtocol:2}])assert.throws(()=>assertClient({action,value:true,...fields},'0.3.7'),{code:'CFB_VERSION_MISMATCH'});
 assert.doesNotThrow(()=>assertClient({action:'tool',clientVersion:'0.3.7',nativeProtocol:1},'0.3.7'));
});
test('mismatched clients can diagnose and stop a device without increasing permissions',()=>{
 for(const action of ['status','diagnostics','setup_status','operation_status','recent_folders','profile_status'])assert.doesNotThrow(()=>assertClient({action},'0.3.7'));
 assert.doesNotThrow(()=>assertClient({action:'active',value:false},'0.3.7'));
});
