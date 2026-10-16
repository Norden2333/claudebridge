import test from 'node:test';import assert from 'node:assert/strict';import {windowsCommand,systemEnvironment} from '../companion/system-tools.mjs';import {trashCommand} from '../companion/trash.mjs';
test('fixed Windows helpers ignore writable PATH and reject unknown executable names',()=>{
 const env={SystemRoot:'D:\\Windows',PATH:'C:\\user-writable-bin'};
 assert.equal(windowsCommand('powershell.exe',env),'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.equal(windowsCommand('explorer.exe',env),'D:\\Windows\\explorer.exe');
 assert.throws(()=>windowsCommand('attacker.exe',env));assert.throws(()=>windowsCommand('reg.exe',{SystemRoot:'relative-path'}));
 if(process.platform==='win32')assert.equal(systemEnvironment(env).PSModulePath,'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
 assert.equal(env.PATH,'C:\\user-writable-bin');
});
test('trash uses fixed system executables and passes the destination as data',()=>{
 assert.equal(trashCommand('/tmp/file','linux').command,'/usr/bin/gio');
 assert.equal(trashCommand('/tmp/file','darwin').command,'/usr/bin/osascript');
 const win=trashCommand('C:\\test\\file','win32');assert.ok(/^[A-Za-z]:\\/.test(win.command));assert.equal(win.env.CLAUDE_RECYCLE_TARGET,'C:\\test\\file');
});
