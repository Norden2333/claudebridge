import {spawn} from 'node:child_process';
import {windowsCommand} from './system-tools.mjs';

// Input paths must first be checked by the scoped executor. A launch request
// cannot prove that the OS displayed a window, so do not return opened:true.
export function desktopOpenCommand(target,directory,{platform=process.platform,reveal=false,isDirectory=false}={}){
 if(platform==='win32')return {command:windowsCommand('explorer.exe'),args:reveal&&!isDirectory?['/select,',target]:[reveal?directory:target],options:{shell:false,windowsHide:false,stdio:'ignore'}};
 if(platform==='darwin')return {command:'/usr/bin/open',args:reveal&&!isDirectory?['-R',target]:[reveal?directory:target],options:{shell:false,stdio:'ignore'}};
 return {command:'/usr/bin/xdg-open',args:[reveal?directory:target],options:{shell:false,stdio:'ignore'}};
}
export async function requestDesktopOpen(target,directory,options={},launch=spawn){
 const spec=desktopOpenCommand(target,directory,options),child=launch(spec.command,spec.args,spec.options);
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
 return {requested:true,opened:null};
}
