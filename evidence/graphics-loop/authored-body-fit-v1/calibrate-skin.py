"""Measure a skin-colour reference from the pinned authored atlas, in linear RGB."""
import hashlib
import json
from pathlib import Path
from PIL import Image

root = Path('evidence/graphics-loop/authored-head-spike-v1/generated')
source = root / 'vit_face_bc.jpg'
image = Image.open(source).convert('RGB')
# Known clean cheek regions of this exact 1024px atlas; exclude eyes, lips and ears.
rectangles = [(210, 500, 290, 610), (740, 500, 820, 610)]
def linear(value):
    value /= 255
    return value / 12.92 if value <= .04045 else ((value + .055) / 1.055) ** 2.4
values = [tuple(linear(c) for c in pixel) for rectangle in rectangles for pixel in image.crop(rectangle).getdata()]
reference = [sum(pixel[channel] for pixel in values) / len(values) for channel in range(3)]
assert len(values) == 17600 and all(.01 < value < .8 for value in reference)
report = {'linearRgb': reference, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'rectangles': rectangles, 'samples': len(values), 'note': 'Pinned clean cheek samples. Material multiplier is desired linear skin RGB divided by this reference. Rendered neck/body colour continuity still requires visual review.'}
(root / 'skin-reference.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
