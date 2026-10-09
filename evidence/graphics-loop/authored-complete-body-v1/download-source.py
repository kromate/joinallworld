"""Fetch exact CC0 source model for the complete character experiment."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

root = Path('evidence/graphics-loop/authored-character-spike-v1')
root.mkdir(parents=True, exist_ok=True)
commit = 'ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd'
url = f'https://raw.githubusercontent.com/nirholas/three.ws/{commit}/public/avatars/parametric-base.glb'
target = root / 'parametric-base.glb'
temporary = target.with_suffix('.part')
digest = hashlib.sha256()
size = 0
try:
    with urlopen(url, timeout=30) as response, temporary.open('wb') as output:
        while block := response.read(131072):
            size += len(block)
            if size > 6806984:
                raise ValueError('Pinned source exceeds expected length')
            digest.update(block)
            output.write(block)
    assert size == 6806984
    assert digest.hexdigest() == '6627588660aa6c754aaa2edb181bc01a8ca60c3b4c534efa3e87f636ce5cda18'
    temporary.replace(target)
finally:
    temporary.unlink(missing_ok=True)
print({'commit': commit, 'bytes': size, 'sha256': digest.hexdigest()})
