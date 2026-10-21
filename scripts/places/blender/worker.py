"""Long-running headless worker: builds LOD0/1/2 for every job line, exports raw GLBs, renders a preview and a silhouette mask.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/places/blender/worker.py -- \\
        --jobs jobs.jsonl --out scripts/places/out [--only venueId[,venueId]] [--no-render]

Job line: {"city": "abuja", "venueId": "airport", "brief": {PlaceBriefV1}, "style": {CityStyleV1}}
Outputs per job: <out>/<city>/<venueId>.lod{0,1,2}.raw.glb, .png (512 preview), .mask.png (128 silhouette), .json (report).
One bad job never stops the loop: it writes an error report and the worker moves on.
"""
import argparse
import hashlib
import importlib.util
import json
import random
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import lib  # noqa: E402

LIMITS = {0: 20000, 1: 4000, 2: 500}
MAX_SIDE_M = 120.0  # contract clamp for the largest horizontal side at LOD0 (a little slack for yard, canopies, trees)
MAX_SIDE_HARD = 170.0
MAX_HEIGHT_M = 140.0


def seed_for(city, venue_id):
    return int(hashlib.sha256(f'{city}/{venue_id}'.encode()).hexdigest()[:16], 16)


def digest(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


_modules = {}


def archetype(name):
    if name not in _modules:
        path = HERE / 'archetypes' / f'{name}.py'
        if not path.exists():
            raise FileNotFoundError(f'no archetype module {path.name}')
        spec = importlib.util.spec_from_file_location(f'archetype_{name.replace("-", "_")}', path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _modules[name] = mod
    return _modules[name]


def build_lod(mod, brief, style, seed, detail, spec=None, facts=None):
    lib.reset()
    rng = random.Random(seed)
    if spec is not None:   # PlaceModelV2 spec job: archetypes/compose.py builds it
        objs = mod.build(spec, style, rng, detail, facts=facts)
    else:
        objs = mod.build(brief, style, rng, detail)
    if not isinstance(objs, (list, tuple)) or not objs:
        raise ValueError('build() returned no objects')
    return list(objs)


def check_scene(objs):
    """Only meshes, one material 'trim', no cameras/lights/empties, finite bounds."""
    import bpy
    for o in bpy.context.scene.objects:
        if o.type != 'MESH':
            raise ValueError(f'object {o.name} is a {o.type}; only meshes are allowed')
    for o in objs:
        for m in o.data.materials:
            if m is None or m.name != 'trim':
                raise ValueError(f'object {o.name} uses material {m.name if m else None}; only "trim" is allowed')
        if len(o.data.vertices) == 0:
            raise ValueError(f'object {o.name} is empty')


def run_job(job, out_dir, render=True, views=()):
    city, vid = job['city'], job['venueId']
    brief, style = job.get('brief') or {}, job.get('style') or {}
    spec, facts = job.get('spec'), job.get('facts')
    is_spec = spec is not None
    if is_spec:
        brief = {'archetype': 'compose'}
    t0 = time.time()
    folder = out_dir / city
    folder.mkdir(parents=True, exist_ok=True)
    base = folder / vid
    report = {'city': city, 'venueId': vid, 'archetype': brief.get('archetype'), 'briefDigest': digest(spec if is_spec else brief), 'styleDigest': digest(style),
              'status': 'ok', 'warnings': [], 'triangles': {}, 'rawBytes': {}, 'errors': []}
    if is_spec:
        report['mode'] = 'spec'
        report['verified'] = spec.get('verified')
        report['images'] = []
    try:
        name = brief.get('archetype')
        mod = archetype(name)
        seed = seed_for(city, vid)
        supported = getattr(mod, 'FEATURES', None)
        for f in ([] if is_spec else brief.get('features', []) or []):
            fid = f.get('id') if isinstance(f, dict) else f
            if fid not in lib.ALL_FEATURES:
                report['warnings'].append(f'unknown feature id "{fid}" ignored')
            elif supported is not None and fid not in supported:
                report['warnings'].append(f'feature "{fid}" is not supported by archetype {name}')
        if hasattr(mod, 'warnings'):
            report['warnings'].extend(mod.warnings(brief, style))
        last = None
        for detail in (2, 1, 0):
            objs = build_lod(mod, brief, style, seed, detail, spec, facts)
            for w in getattr(mod, 'last_warnings', []) if is_spec else []:
                if w not in report['warnings']:
                    report['warnings'].append(w)
            check_scene(objs)
            tris = lib.count_triangles(objs)
            report['triangles'][f'lod{detail}'] = tris
            if lib.Builder.last is not None:
                report.setdefault('breakdown', {})[f'lod{detail}'] = dict(lib.Builder.last.by_label)
            if detail > 0 and f'lod{detail}' in views and render:
                lib.preview(f'{base}.lod{detail}.png', objs, ground_hex='#9aa08c')
            if tris > LIMITS[detail]:
                report['errors'].append(f'LOD{detail} has {tris} triangles, over the {LIMITS[detail]} budget')
            lo, hi = lib.bounds([o for o in objs if not o.name.endswith('-site')] or objs)
            if detail == 0:
                size = [hi[k] - lo[k] for k in range(3)]
                report['bounds'] = {'min': [round(v, 3) for v in lo], 'max': [round(v, 3) for v in hi], 'size': [round(v, 3) for v in size]}
                if max(size[0], size[1]) > MAX_SIDE_HARD:
                    report['errors'].append(f'largest horizontal side {max(size[0], size[1]):.1f} m is over {MAX_SIDE_HARD} m')
                elif max(size[0], size[1]) > MAX_SIDE_M * 1.12:
                    report['warnings'].append(f'largest horizontal side {max(size[0], size[1]):.1f} m is over the {MAX_SIDE_M:.0f} m clamp (ground pad included)')
                if size[2] > MAX_HEIGHT_M or size[2] < 1.0:
                    report['errors'].append(f'height {size[2]:.1f} m is not sane')
                if lo[2] < -0.5 or lo[2] > 0.5:
                    report['warnings'].append(f'model does not sit on z=0 (min z {lo[2]:.2f})')
            if not report['errors']:
                path = Path(f'{base}.lod{detail}.raw.glb')
                lib.export_glb(path, objs)
                report['rawBytes'][f'lod{detail}'] = path.stat().st_size
            last = objs
        # `last` is the LOD0 scene: render it
        if render and last:
            ground = (brief.get('setting') or {}).get('ground') or style.get('ground') or 'paving'
            lib.silhouette(f'{base}.mask.png', [o for o in last if not o.name.endswith('-site')] or last)
            if 'close' in views:
                lib.preview(f'{base}.close.png', [o for o in last if not o.name.endswith('-site')] or last, size=1024, azimuth=22, elevation=12, ground_hex='#9aa08c')
            if is_spec:
                ground = (spec.get('site') or {}).get('ground') or style.get('ground') or 'paving'
            gh = lib.mix({'grass': '#8a9a6a', 'laterite': '#a98066', 'sand': '#cdb98f', 'asphalt': '#808387', 'snow': '#e6eaf0', 'cobble': '#9a968c'}.get(ground, '#9aa08c'), '#9ca09a', 0.45)
            lib.preview(f'{base}.png', last, ground_hex=gh)
            if is_spec:
                report['images'].append(f'{base}.png')
                if isinstance(spec.get('camera'), dict):
                    import photo  # blender/photo.py: the render that matches the photo's viewpoint
                    photo.render(f'{base}.photo.png', last, spec['camera'], gh, report['warnings'])
                    report['images'].append(f'{base}.photo.png')
                for v in ('close', 'lod1', 'lod2'):
                    if v in views and Path(f'{base}.{v}.png').exists():
                        report['images'].append(f'{base}.{v}.png')
    except Exception as exc:  # noqa: BLE001 - one bad job must not stop the loop
        report['status'] = 'error'
        report['errors'].append(f'{type(exc).__name__}: {exc}')
        report['traceback'] = traceback.format_exc()
        print(traceback.format_exc(), file=sys.stderr)
    if report['errors'] and report['status'] == 'ok':
        report['status'] = 'rejected'
    report['seconds'] = round(time.time() - t0, 2)
    Path(f'{base}.json').write_text(json.dumps(report, indent=1) + '\n')
    return report


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--views', default='', help='extra debug renders: lod1,lod2,close')
    a = ap.parse_args(argv)
    only = set(filter(None, a.only.split(',')))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    jobs = [json.loads(line) for line in Path(a.jobs).read_text().splitlines() if line.strip()]
    for job in jobs:
        if only and job.get('venueId') not in only and f"{job.get('city')}/{job.get('venueId')}" not in only:
            continue
        r = run_job(job, out, render=not a.no_render, views=set(filter(None, a.views.split(','))))
        print(f"[worker] {r['city']}/{r['venueId']} {r['status']} tris={r['triangles']} {r['seconds']}s" + (f" errors={r['errors']}" if r['errors'] else ''), flush=True)


if __name__ == '__main__':   # importable by render-queue/server.py (which reuses run_job); a plain `blender --python worker.py` still runs main()
    main()
