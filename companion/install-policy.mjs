import path from 'node:path';
export function registrationDirectory(platform, home, env = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  if (platform === 'linux') return p.join(env.XDG_CONFIG_HOME || p.join(home, '.config'), 'google-chrome', 'NativeMessagingHosts');
  throw new Error('Unsupported platform');
}
export function windowsLauncher(node, host) {
  const literal = value => { if (/["\r\n]/.test(value)) throw new Error('启动路径无效。'); return value.replaceAll('%', '%%'); };
  // The first two ASCII lines change decoding before any UTF-8 path is read.
  // Delayed expansion stays off, and literal percent signs are escaped.
  return '@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\n"' + literal(node) + '" "' + literal(host) + '" "%~1"\r\n';
}
