import path from 'node:path';
const commands={
 'powershell.exe':'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
 'reg.exe':'System32\\reg.exe',
 'icacls.exe':'System32\\icacls.exe',
 'explorer.exe':'explorer.exe'
};
export function windowsCommand(name,env=process.env){
 if(!Object.hasOwn(commands,name))throw new Error('Unknown fixed Windows helper');
 const root=env.SystemRoot||env.WINDIR||'C:\\Windows';
 if(!/^[a-zA-Z]:[\\/]/.test(root)||/[\x00-\x1f"<>|]/.test(root))throw new Error('Windows system directory is invalid');
 return path.win32.join(root,commands[name]);
}
export function systemEnvironment(env=process.env){
 if(process.platform!=='win32')return {...env};
 return {...env,PSModulePath:path.win32.join(path.win32.dirname(windowsCommand('powershell.exe',env)),'Modules')};
}
