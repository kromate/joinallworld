import hashlib,json,os,sys
from pathlib import Path
p=Path(__file__).parent/'root-source-snapshot-v3.json'
expected=os.environ.get('EXPECTED_SOURCE_SNAPSHOT_SHA256','')
if hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=expected:raise SystemExit('Snapshot manifest pin mismatch')
d=json.loads(p.read_text());root=Path.cwd().resolve();seen=set()
if d.get('schema')!='allworld-environment-v5-root-source-snapshot-v3':raise SystemExit('Wrong snapshot schema')
for e in d['files']:
 f=root/e['path']
 if e['path'] in seen or f.is_symlink() or not f.is_file() or not f.resolve().is_relative_to(root):raise SystemExit('Invalid snapshot path')
 seen.add(e['path'])
 if hashlib.file_digest(f.open('rb'),'sha256').hexdigest()!=e['sha256']:raise SystemExit('Source mismatch: '+e['path'])
print('Verified',len(seen),'exact source files')
