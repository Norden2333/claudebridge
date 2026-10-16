from pathlib import Path
import argparse, hashlib, json, os, re, shutil, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--runtime-dir', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parents[1]
runtime = Path(args.runtime_dir).resolve()
output = Path(args.output).resolve()
if os.name != 'nt' or output.exists() or output == source or source in output.parents or output in source.parents:
    raise SystemExit('Build on Windows into a new independent output directory')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
node_hash = '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'
if sha(runtime/'node.exe') != node_hash or not (runtime/'LICENSE.txt').is_file():
    raise SystemExit('Official runtime hash or full license missing')
windows = Path(os.environ.get('WINDIR', r'C:\Windows'))
pshome = windows/'System32/WindowsPowerShell/v1.0'
env = {**os.environ, 'PSModulePath': str(pshome/'Modules'), 'CFB_VALIDATE_NODE': str(runtime/'node.exe')}
check = subprocess.run([str(pshome/'powershell.exe'), '-NoProfile', '-NonInteractive', '-Command', "$s=Get-AuthenticodeSignature -LiteralPath $env:CFB_VALIDATE_NODE;if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'CN=OpenJS Foundation'){exit 1}"], env=env, capture_output=True)
if check.returncode:
    raise SystemExit('Runtime signature validation failed')
private = {'native-host.json','native-launcher.cmd','native-launcher','settings.json','device.json','host.lock'}
dirs = {'.github','extension','companion','vendor','node_modules','licenses','tests','tools'}
roots = {'CONTRIBUTORS.md','CONTRIBUTING.md','PRIVACY.md','SECURITY.md','SUPPORT.md','STORE_SUBMISSION.md','RELEASE.md','README.md','文件使用指南.md','快速开始.md','VALIDATION.md','NOTICE.md','LICENSE','identity.json','package.json','package-lock.json','DEPENDENCIES.json','UPSTREAM.json','.gitignore','.gitattributes','安装-Windows.ps1','卸载-Windows.ps1','安装-Windows.cmd','安装-macOS.command','install-macos-linux.sh','uninstall-macos-linux.sh','更新与切回-Windows.ps1','更新与切回-Windows.cmd','更新与切回-macOS.command','update-or-rollback.sh','Windows安装向导.ps1'}
inputs = []
for p in sorted(source.rglob('*')):
    if p.is_symlink() or getattr(p, 'is_junction', lambda:False)():
        raise SystemExit('Linked source found')
    if not p.is_file():
        continue
    rel = p.relative_to(source)
    if rel.as_posix() == 'MANIFEST.sha256':
        continue
    if p.name in private or 'state' in rel.parts or any(x.startswith('.cfb-') for x in rel.parts):
        raise SystemExit('Private runtime state found')
    if len(rel.parts)==1 and rel.name not in roots or len(rel.parts)>1 and rel.parts[0] not in dirs:
        raise SystemExit('Unexpected source file: '+str(rel))
    inputs.append((p,rel,sha(p)))
output.mkdir(parents=True)
for p,rel,digest in inputs:
    dest=output/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,dest)
    if sha(dest)!=digest:
        raise SystemExit('Copy readback mismatch')
(output/'runtime').mkdir()
for name in ['node.exe','LICENSE.txt']:
    shutil.copy2(runtime/name,output/'runtime'/name)
meta={'version':'24.19.0','platform':'win-x64','source':'https://nodejs.org/dist/v24.19.0/win-x64/node.exe','sha256':node_hash,'signature':'Valid OpenJS Foundation','globalNodeChanged':False}
(output/'runtime/SOURCE.json').write_bytes(json.dumps(meta,indent=2).encode())
cs=output/'tools/windows-launcher.cs'
text,count=re.subn(r'if\(actual!="[0-9a-f]{64}"\)', 'if(actual!="'+sha(output/'Windows安装向导.ps1')+'")', cs.read_text('utf-8-sig'))
if count!=1:
    raise SystemExit('Launcher pin missing or ambiguous')
cs.write_bytes(text.encode('utf-8-sig'))
csc=windows/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
subprocess.run([str(csc),'/nologo','/target:winexe','/platform:anycpu','/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Core.dll','/out:'+str(output/'安装Claude文件连接.exe'),str(cs)],check=True)
files=[p for p in sorted(output.rglob('*')) if p.is_file() and p.name!='MANIFEST.sha256']
manifest=''.join(sha(p)+'  '+p.relative_to(output).as_posix()+'\n' for p in files)
(output/'MANIFEST.sha256').write_bytes(manifest.encode())
for line in manifest.splitlines():
    digest,name=line.split('  ',1)
    if sha(output/name)!=digest:
        raise SystemExit('Final package mismatch')
for p,rel,digest in inputs:
    if sha(p)!=digest:
        raise SystemExit('Development source changed during build')
print(json.dumps({'version':json.loads((output/'package.json').read_text('utf-8'))['version'],'files':len(files)+1,'runtimeVerified':True,'scriptPinned':True,'installerSigned':False,'installed':False,'output':str(output)},ensure_ascii=False))
