"""Create independently verified source, Windows and Chrome draft archives."""
from pathlib import Path
import argparse, hashlib, json, zipfile, os
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--windows',required=True);p.add_argument('--output',required=True);a=p.parse_args()
source=Path(a.source).resolve();windows=Path(a.windows).resolve();output=Path(a.output).resolve()
if output.exists() or any(output==x or x in output.parents or output in x.parents for x in [source,windows]):raise SystemExit('Use a new independent output directory')
version=json.loads((source/'package.json').read_text('utf-8'))['version']
private={'native-host.json','native-launcher.cmd','native-launcher','settings.json','device.json','host.lock','.env'}
def files(root):
 result=[]
 for f in sorted(root.rglob('*')):
  if f.is_symlink() or getattr(f,'is_junction',lambda:False)():raise RuntimeError('Linked file')
  if not f.is_file():continue
  rel=f.relative_to(root)
  if f.name in private or 'state' in rel.parts or '.git' in rel.parts or '__pycache__' in rel.parts or any(x.startswith('.cfb-') for x in rel.parts):raise RuntimeError('Private or generated state found')
  result.append((f,rel.as_posix()))
 return result
def sha(data):return hashlib.sha256(data).hexdigest()
def check_inventory(root):
 for line in (root/'MANIFEST.sha256').read_text().splitlines():
  digest,name=line.split('  ',1)
  f=(root/name).resolve()
  if root not in f.parents or sha(f.read_bytes())!=digest:raise RuntimeError('Inventory mismatch')
check_inventory(windows)
payload=[(f,name) for f,name in files(source) if name!='MANIFEST.sha256']
for f,name in payload:
 if name in {'MANIFEST.sha256','tools/windows-launcher.cs'}:continue
 counterpart=windows/name
 if not counterpart.is_file() or sha(counterpart.read_bytes())!=sha(f.read_bytes()):raise RuntimeError('Windows package differs from release source: '+name)
for f,name in payload:
 if f.suffix in {'.js','.mjs','.json','.md','.ps1','.cs','.html','.yml','.sh','.cmd','.command'} and 'node_modules/' not in name:
  text=f.read_text('utf-8-sig')
  username=os.environ.get('USERNAME','')
  private_markers=('Documents/Codex','Documents\\Codex','AppData/Local/Temp','AppData\\Local\\Temp','codex-clipboard')
  if (username and len(username)>2 and username in text) or any(marker in text for marker in private_markers):raise RuntimeError('Personal development path: '+name)
output.mkdir(parents=True)
reports=[]
def archive(name,items,prefix='',generated=None):
 generated=generated or {}
 if set(generated)&{rel for _,rel in items}:raise RuntimeError('Generated archive item collision')
 target=output/name
 with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for f,rel in items:
   info=zipfile.ZipInfo(prefix+rel,(2026,10,10,0,0,0));info.create_system=3;info.external_attr=(0o100755 if f.suffix in {'.sh','.command'} else 0o100644)<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,f.read_bytes())
  for rel,data in sorted(generated.items()):
   info=zipfile.ZipInfo(prefix+rel,(2026,10,10,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
 with zipfile.ZipFile(target) as z:
  if z.testzip() is not None:raise RuntimeError('ZIP CRC mismatch')
  if len(z.infolist())!=len(items)+len(generated):raise RuntimeError('ZIP item mismatch')
  for f,rel in items:
   if z.read(prefix+rel)!=f.read_bytes():raise RuntimeError('ZIP readback mismatch')
  for rel,data in generated.items():
   if z.read(prefix+rel)!=data:raise RuntimeError('Generated ZIP readback mismatch')
 reports.append({'file':name,'bytes':target.stat().st_size,'sha256':sha(target.read_bytes()),'files':len(items)+len(generated),'verified':True})
archive('ClaudeBridge-'+version+'-Chrome-draft.zip',files(source/'extension'))
source_inventory=''.join(sha(f.read_bytes())+'  '+name+'\n' for f,name in payload).encode()
archive('ClaudeBridge-'+version+'-GitHub-source.zip',payload,'claudebridge/',{'MANIFEST.sha256':source_inventory})
archive('ClaudeBridge-'+version+'-Windows-x64.zip',files(windows),'claudebridge/')
report={'version':version,'releaseStage':'public-beta-submission-draft','published':False,'archives':reports}
(output/'CHECKSUMS.sha256').write_bytes(''.join(x['sha256']+'  '+x['file']+'\n' for x in reports).encode())
(output/'release-integrity.json').write_bytes(json.dumps(report,ensure_ascii=False,indent=2).encode())
print(json.dumps(report,ensure_ascii=False))
