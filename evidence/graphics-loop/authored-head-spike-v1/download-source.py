import hashlib,json,urllib.request
from pathlib import Path
root=Path(__file__).parent
manifest=json.loads((root/'source-assets.json').read_text())
for item in manifest['files']:
 file=root/item['path']
 if not file.exists():
  url='https://raw.githubusercontent.com/'+manifest['repository']+'/'+manifest['commit']+'/godot_project/'+item['path']
  with urllib.request.urlopen(url,timeout=30) as response,file.open('wb') as out:
   while chunk:=response.read(128*1024):out.write(chunk)
 digest=hashlib.sha256()
 with file.open('rb') as stream:
  while chunk:=stream.read(128*1024):digest.update(chunk)
 if file.stat().st_size!=item['bytes'] or digest.hexdigest()!=item['sha256']:raise ValueError('Source pin mismatch: '+item['path'])
 print('Verified '+item['path'])
