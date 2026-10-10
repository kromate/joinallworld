from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

source = Path(sys.argv[1])
helper = Path('scripts/world/check-playable-africa-rollout.py')
receipt_path = Path('world/playable-africa-rollout/receipts/cairo.json')
asset_directory = Path('src/game/cities/cairo')

def update_receipt(root, change):
    p = root / receipt_path
    value = json.loads(p.read_text())
    change(value)
    p.write_text(json.dumps(value))

def replace_with_link(root, relative):
    p = root / relative
    backup = root / 'link-target'
    p.rename(backup)
    p.symlink_to(backup)

cases = [
    ('missing-receipt', lambda r: (r / receipt_path).unlink(), ['cairo']),
    ('missing-asset', lambda r: (r / asset_directory / 'geometry.ts').unlink(), ['cairo']),
    ('hash-mismatch', lambda r: update_receipt(r, lambda d: d['assets']['geometry.ts'].update(sha256='0' * 64)), ['cairo']),
    ('byte-mismatch', lambda r: update_receipt(r, lambda d: d['assets']['geometry.ts'].update(bytes=1)), ['cairo']),
    ('boolean-byte-pin', lambda r: update_receipt(r, lambda d: d['assets']['geometry.ts'].update(bytes=True)), ['cairo']),
    ('oversized-byte-pin', lambda r: update_receipt(r, lambda d: d['assets']['geometry.ts'].update(bytes=8388609)), ['cairo']),
    ('missing-identity', lambda r: update_receipt(r, lambda d: d.pop('generationIdentity')), ['cairo']),
    ('wrong-country', lambda r: update_receipt(r, lambda d: d.update(countryIso2='RW')), ['cairo']),
    ('wrong-state', lambda r: update_receipt(r, lambda d: d['generationIdentity'].update(stateId='wrong')), ['cairo']),
    ('extra-asset-key', lambda r: update_receipt(r, lambda d: d['assets'].update(extra={'bytes':1,'sha256':'0'*64})), ['cairo']),
    ('asset-symlink', lambda r: replace_with_link(r, asset_directory / 'geometry.ts'), ['cairo']),
    ('receipt-symlink', lambda r: replace_with_link(r, receipt_path), ['cairo']),
    ('parent-symlink', lambda r: replace_with_link(r, asset_directory), ['cairo']),
    ('duplicate-city-ids', lambda r: None, ['cairo', 'cairo']),
    ('path-traversal', lambda r: None, ['../cairo']),
    ('nonregular-asset', lambda r: ((r / asset_directory / 'geometry.ts').unlink(), os.mkfifo(r / asset_directory / 'geometry.ts')), ['cairo']),
]

for label, change, arguments in cases:
    with tempfile.TemporaryDirectory(prefix='allworld-offline-negative-') as directory:
        root = Path(directory)
        (root / helper).parent.mkdir(parents=True)
        shutil.copyfile(source / helper, root / helper)
        (root / receipt_path).parent.mkdir(parents=True)
        shutil.copyfile(source / receipt_path, root / receipt_path)
        shutil.copytree(source / asset_directory, root / asset_directory)
        change(root)
        result = subprocess.run([sys.executable, str(root / helper), *arguments], capture_output=True, text=True, timeout=5)
        assert result.returncode != 0 and not result.stdout.strip(), (label, result.returncode, result.stdout, result.stderr)
        print(json.dumps({'case': label, 'exit_status': result.returncode, 'successful_rows': 0, 'stderr': result.stderr.strip()}), flush=True)
print(json.dumps({'status':'pass','negative_cases':len(cases),'helper_sha256':hashlib.sha256((source/helper).read_bytes()).hexdigest()}))
