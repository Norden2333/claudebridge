import path from 'node:path';import os from 'node:os';
export function sensitivePaths(home=os.homedir()){
 return ['.ssh','.gnupg','.codex/auth.json','.claude/.credentials.json','.aws/credentials','AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup','AppData/Local/Google/Chrome/User Data','AppData/Local/Microsoft/Edge/User Data','AppData/Roaming/Mozilla/Firefox','.config/google-chrome','.config/chromium','.mozilla/firefox','Library/LaunchAgents','.config/autostart','.bashrc','.zshrc','.profile','Documents/WindowsPowerShell','Documents/PowerShell'].map(name=>path.resolve(home,name));
}

const forbidden=new Set('.lnk .url .scr .hta .pif .reg .exe .com .cpl .msi .vbe .jse .wsf .wsh'.split(' '));
export function forbiddenNewName(name){return typeof name==='string'&&forbidden.has(path.extname(name).toLowerCase());}
export function assertNewName(name){if(forbiddenNewName(name))throw Object.assign(new Error('此类可执行或启动入口后缀不允许新建、复制或改名得到。'),{code:'CFB_UNSAFE_SUFFIX',precondition:true});}
export function assetSafeSuffix(name){return forbiddenNewName(name)?name+'.txt':name;}
export function broadFolder(folder,home=os.homedir()){
 const normal=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 const exact=[home,path.dirname(home),process.env.APPDATA,process.env.LOCALAPPDATA,path.join(home,'Library'),process.platform==='win32'?path.parse(home).root+'Users':'/Users','/home'].filter(Boolean).map(normal),target=normal(folder);
 return exact.includes(target)||normal(home).startsWith(target+path.sep);
}
