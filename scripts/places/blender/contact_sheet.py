"""Tile preview PNGs side by side (or in a grid) into one contact sheet. Run through Blender (it ships numpy and PNG I/O):

    Blender -b --factory-startup --python scripts/places/blender/contact_sheet.py -- --out sheet.png a.png b.png c.png [--cols 3]
"""
import argparse
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--cols', type=int, default=0)
ap.add_argument('images', nargs='+')
a = ap.parse_args(argv)

tiles = []
for path in a.images:
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    tiles.append(px.reshape(h, w, 4))
cols = a.cols or len(tiles)
rows = (len(tiles) + cols - 1) // cols
th, tw = max(t.shape[0] for t in tiles), max(t.shape[1] for t in tiles)
sheet = np.ones((rows * th, cols * tw, 4), dtype=np.float32)
for i, t in enumerate(tiles):
    r, c = divmod(i, cols)
    # Blender rows run bottom-up: put the first row of tiles at the top
    y0 = (rows - 1 - r) * th
    sheet[y0:y0 + t.shape[0], c * tw:c * tw + t.shape[1]] = t
out = bpy.data.images.new('sheet', width=cols * tw, height=rows * th, alpha=False)
out.pixels.foreach_set(sheet.ravel())
out.filepath_raw = a.out
out.file_format = 'PNG'
out.save()
print('wrote', a.out, file=sys.stderr)
