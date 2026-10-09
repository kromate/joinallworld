#!/usr/bin/env python3
"""Small invocation and partial-receipt preflight; no Chrome/build/server is started."""
import json
import hashlib
import os
import runpy
import subprocess
import sys
import tempfile
from pathlib import Path

runner = Path(__file__).with_name('run-bounded-linux-render-sofa-v5.py')
module = runpy.run_path(str(runner), run_name='recipe_module')
wrong = subprocess.run([sys.executable, str(runner)], capture_output=True, text=True, timeout=3)
assert wrong.returncode != 0 and 'usage:' in wrong.stderr.lower(), (wrong.returncode, wrong.stderr)
valid_shape = [sys.executable, str(runner), 'browser', 'a' * 64, '12345', 'b' * 40, 'sofa-home']
env = os.environ.copy()
env.pop('GITHUB_REF', None)
env.pop('GITHUB_SHA', None)
valid = subprocess.run(valid_shape, capture_output=True, text=True, timeout=3, env=env)
combined = valid.stdout + valid.stderr
assert valid.returncode != 0 and 'usage:' not in combined.lower(), (valid.returncode, combined)
assert ('linux' in combined.lower() or 'review branch' in combined.lower()), combined
with tempfile.TemporaryDirectory(prefix='environment-sofa-v1-partial-receipt-') as temp:
    file = Path(temp) / 'captures-progress.jsonl'
    row1 = {'sequence': 1, 'valid': True}
    row2 = {'sequence': 2, 'valid': False}
    file.write_text(json.dumps(row1) + '\n' + json.dumps(row2)[:9], encoding='utf-8')
    parsed = module['durable_jsonl_rows'](file)
    assert parsed == [row1], parsed
    file.write_text(json.dumps(row1) + '\n' + '{broken}\n', encoding='utf-8')
    try:
        module['durable_jsonl_rows'](file)
    except json.JSONDecodeError:
        pass
    else:
        raise AssertionError('a malformed complete receipt line must fail closed')
    image = Path(temp) / 'scene.png'
    image_bytes = b'captured-pixels'
    image.write_bytes(image_bytes)
    receipt = {'image': {'path': image.name, 'bytes': len(image_bytes), 'sha256': hashlib.sha256(image_bytes).hexdigest()}}
    assert module['verify_image_receipts']([receipt], Path(temp))
    assert not module['verify_image_receipts']([{**receipt, 'image': {**receipt['image'], 'sha256': '0' * 64}}], Path(temp))
    assert not module['verify_image_receipts']([{**receipt, 'image': {**receipt['image'], 'path': '../outside.png'}}], Path(temp))
print('remote render invocation and partial receipt contract: PASS')
