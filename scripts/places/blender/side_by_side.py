#!/usr/bin/env python3
"""Compose a reference photo and a render into one PNG (photo left, render right, same height) for visual review.

    python3 scripts/places/blender/side_by_side.py --photo /tmp/x.jpg --render scripts/places/out/abuja/airport.photo.png --out cmp.png [--height 576]

With plain python3 there is no image library, so the job is handed to the running render queue (scripts/places/render-queue/run.sh) and
this script waits for it. Run inside Blender (`Blender -b --factory-startup --python side_by_side.py -- --photo ...`) it composes directly;
the queue server does exactly that, so no extra Blender is started.
"""
import argparse
import json
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent


def compose(photo, render, out, height=0, gap=10):
    import bpy
    import numpy as np

    def load(p):
        img = bpy.data.images.load(str(p))
        img.colorspace_settings.name = 'sRGB'
        return img

    ia, ib = load(photo), load(render)
    h = height or max(ia.size[1], ib.size[1])
    h = max(64, min(2000, int(h)))
    arrs = []
    for img in (ia, ib):
        w0, h0 = img.size
        nw = max(1, int(round(w0 * h / h0)))
        img.scale(nw, h)
        a = np.empty(nw * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(h, nw, 4)
        a[:, :, 3] = 1.0
        arrs.append(a)
    bar = np.zeros((h, gap, 4), dtype=np.float32)
    bar[:, :, :3] = 0.08
    bar[:, :, 3] = 1.0
    full = np.concatenate([arrs[0], bar, arrs[1]], axis=1)
    out_img = bpy.data.images.new('cmp', full.shape[1], full.shape[0], alpha=False, float_buffer=False)
    out_img.colorspace_settings.name = 'sRGB'
    out_img.pixels.foreach_set(full.reshape(-1))
    out_img.filepath_raw = str(out)
    out_img.file_format = 'PNG'
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    out_img.save()
    for img in (ia, ib, out_img):
        bpy.data.images.remove(img)
    return out


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--photo', required=True)
    ap.add_argument('--render', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--height', type=int, default=0)
    ap.add_argument('--queue', default=str(HERE.parent / 'render-queue' / 'q'))
    ap.add_argument('--wait', type=int, default=90)
    a = ap.parse_args(argv)
    try:
        import bpy  # noqa: F401
        compose(Path(a.photo).resolve(), Path(a.render).resolve(), Path(a.out).resolve(), a.height)
        print(f'wrote {a.out}')
        return 0
    except ImportError:
        pass
    q = Path(a.queue)
    jid = f'{int(time.time() * 1000)}-cmp-{uuid.uuid4().hex[:6]}'
    (q / 'in').mkdir(parents=True, exist_ok=True)
    tmp = q / f'.{jid}.tmp'
    tmp.write_text(json.dumps({'kind': 'compare', 'photo': str(Path(a.photo).resolve()), 'render': str(Path(a.render).resolve()),
                               'out': str(Path(a.out).resolve()), 'height': a.height}))
    tmp.rename(q / 'in' / f'{jid}.json')
    done = q / 'done' / f'{jid}.json'
    t0 = time.time()
    while time.time() - t0 < a.wait:
        if done.exists():
            r = json.loads(done.read_text())
            print(r.get('out') if r.get('status') == 'ok' else r.get('error'))
            return 0 if r.get('status') == 'ok' else 1
        time.sleep(0.4)
    print('timed out: is the render queue running? (scripts/places/render-queue/run.sh)', file=sys.stderr)
    return 2


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    sys.exit(main(argv))
