#!/bin/bash
# Frees disk after packing. For every PACKED venue report: delete its raw GLBs and render PNGs, and turn its comparison image
# out/cmp-<city>-<venue>.png into a 1000 px JPEG in out/cmp/. Packed GLBs and reports stay (manifest.ts reads them).
# Venues still being modelled are untouched.
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)/out"
python3 - <<'PY'
import json, glob, os, subprocess
n = 0
for rep in glob.glob('*/*.json'):
    city, name = rep.split('/')
    if city == 'store':
        continue
    try:
        r = json.load(open(rep))
    except Exception:
        continue
    if r.get('status') != 'packed':
        continue
    v = name[:-5]
    for f in glob.glob(f'{city}/{v}.lod*.raw.glb') + glob.glob(f'{city}/{v}*.png'):
        os.remove(f); n += 1
    c = f'cmp-{city}-{v}.png'
    if os.path.exists(c):
        os.makedirs('cmp', exist_ok=True)
        ok = subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '1000', c,
                             '--out', f'cmp/{c[:-4]}.jpg'], capture_output=True).returncode == 0
        if ok:
            os.remove(c); n += 1
print('removed', n, 'files')
PY
du -sh .
