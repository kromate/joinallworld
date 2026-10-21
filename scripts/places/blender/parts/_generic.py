"""Generic shape parts (prism, revolve, loft, sweep-path, array, surface, stand), registered through parts/core.py.

Underscore file: not a parts module itself. Every part is `fn(b, look, rng, detail, at, rot, **params)` like the other core parts; geometry
lives in lib/generic.py and lib/patterns.py. Parts report mistakes with `_warn` (merged into the job report), never raise for bad input.
Local frame: origin at `at` on the ground (or where the part stands), +Y away from the camera, front towards -Y, yaw `rot`.
"""
import copy
import functools
import math
import re

import lib
from lib import generic as G
from lib.facade import ROOF_SLOT, WALL_SLOT
from lib.patterns import normalise as _norm_patterns

from ._xform import Xform

HEX = re.compile(r'^#[0-9a-fA-F]{6}$')
SHAPE_KIND = {'rect': 'punched', 'arched': 'arched', 'pointed': 'pointed-arch', 'round': 'round'}
ALIAS_KIND = {'rect': 'punched', 'pointed': 'pointed-arch'}
WINDOW_KINDS = {'curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre', 'none', 'plain', 'round', 'rect', 'pointed'}


# ---------------------------------------------------------------------------------------------------------------- helpers
def _at3(at):
    at = tuple(at or (0.0, 0.0, 0.0))
    return tuple(float(v) for v in at) + (0.0,) * (3 - len(at))


def placed(fn):
    @functools.wraps(fn)
    def wrapper(b, look, rng, detail, at=(0.0, 0.0, 0.0), rot=0.0, **params):
        return fn(Xform.make(b, _at3(at), rot), look, rng, detail, **params)
    return wrapper


def _root(b):
    while hasattr(b, 'inner'):
        b = b.inner
    return b


def _warn(b, msg):
    r = _root(b)
    lst = getattr(r, 'part_warnings', None)
    if lst is None:
        lst = []
        r.part_warnings = lst
    if msg not in lst:
        lst.append(msg)


def _num(v, default, lo=None, hi=None):
    try:
        v = float(v)
    except (TypeError, ValueError):
        v = float(default)
    if v != v or v in (float('inf'), float('-inf')):
        v = float(default)
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


def _col(b, name, v, default):
    if v is None:
        return default
    if isinstance(v, str) and HEX.match(v):
        return v
    _warn(b, f'{name}: {v!r} is not a #rrggbb colour, ignored')
    return default


def _paint(b, look, colour=None, material=None, slot=None, roof=False, cname='colour'):
    """-> (slot, colour): defaults from the look (wall or roof), overridden by colour / material / slot."""
    sl = look.roof_slot if roof else look.wall_slot
    col = look.roof_col if roof else look.wall_col
    if material:
        sl = (ROOF_SLOT.get(material) or WALL_SLOT.get(material)) or (material if material in lib.slots()['slots'] else sl)
        if material not in ROOF_SLOT and material not in WALL_SLOT and material not in lib.slots()['slots']:
            _warn(b, f'material {material!r} unknown; using the default')
    if slot:
        if slot in lib.slots()['slots']:
            sl = slot
        else:
            _warn(b, f'slot {slot!r} is not an atlas slot ({", ".join(lib.slots()["slots"])}); ignored')
    return sl, _col(b, cname, colour, col)


def _pts2(b, name, v, min_n=3, limit=400):
    out = []
    if not isinstance(v, (list, tuple)):
        _warn(b, f'{name} must be a list of [x, y] points')
        return out
    for p in v[:limit]:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            x, y = _num(p[0], 0, -400, 400), _num(p[1], 0, -400, 400)
            out.append((x, y))
        else:
            _warn(b, f'{name}: {p!r} is not an [x, y] point, skipped')
    if len(out) < min_n:
        _warn(b, f'{name} needs at least {min_n} points')
        return []
    return out


def _pts3(b, name, v, min_n=2, limit=400):
    out = []
    if not isinstance(v, (list, tuple)):
        _warn(b, f'{name} must be a list of [x, y, z] points')
        return out
    for p in v[:limit]:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            out.append((_num(p[0], 0, -400, 400), _num(p[1], 0, -400, 400), _num(p[2], 0, -60, 300) if len(p) > 2 else 0.0))
        else:
            _warn(b, f'{name}: {p!r} is not an [x, y, z] point, skipped')
    if len(out) < min_n:
        _warn(b, f'{name} needs at least {min_n} points')
        return []
    return out


def _kind(k, shape):
    k = ALIAS_KIND.get(k, k)
    if shape and k in ('punched', 'arched', 'pointed-arch', 'round'):
        k = SHAPE_KIND[shape]
    return k


def _lod(detail, a, b_, c):
    return (a, b_, c)[min(2, max(0, detail))]


# ---------------------------------------------------------------------------------------------------------------- prism
@placed
def prism(b, look, rng, detail, points=None, rect=None, radius=None, n=6, z0=0.0, height=10.0, topScale=1.0, topOffset=None, colour=None, material=None,
          slot=None, topColour=None, top=True, bottom=False, windows='none', windowShape=None, windowRatio=0.4, faces=None, edgeKinds=None, storeys=None,
          bay=None, pattern=None, glassColour=None, trimColour=None, plinth=0.0, groundKind=None, groundHeight=None):
    if points is not None:
        poly = _pts2(b, 'prism.points', points)
    elif rect is not None and isinstance(rect, (list, tuple)) and len(rect) >= 2:
        w, d = _num(rect[0], 10, 0.1, 300), _num(rect[1], 10, 0.1, 300)
        poly = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    elif radius is not None:
        r, k = _num(radius, 5, 0.1, 200), int(_num(n, 6, 3, 48))
        poly = [(r * math.cos(2 * math.pi * i / k + math.pi / k), r * math.sin(2 * math.pi * i / k + math.pi / k)) for i in range(k)]
    else:
        _warn(b, 'prism needs points, rect or radius')
        return
    if len(poly) < 3:
        return
    poly = G.ccw2(poly)
    zb = _num(z0, 0, -5, 200)
    H = _num(height, 10, 0.1, 140)
    zt = zb + H
    sl, col = _paint(b, look, colour, material, slot)
    tcol = _col(b, 'topColour', topColour, col)
    b.section('prism')
    ts = topScale
    if isinstance(ts, (list, tuple)) and len(ts) >= 2:
        ts = (_num(ts[0], 1, 0.0, 10), _num(ts[1], 1, 0.0, 10))
    else:
        ts = _num(ts, 1.0, 0.0, 10)
    off = (_num(topOffset[0], 0, -100, 100), _num(topOffset[1], 0, -100, 100)) if isinstance(topOffset, (list, tuple)) and len(topOffset) >= 2 else (0.0, 0.0)
    straight = (ts == 1.0 or ts == (1.0, 1.0)) and not any(off)
    wall_cmd = (windows not in (None, 'none', 'plain')) or pattern is not None or faces or edgeKinds
    if not straight or not wall_cmd:
        if wall_cmd and not straight:
            _warn(b, 'prism: windows/pattern need a straight prism (topScale 1, no topOffset); drawn as a plain wall')
        G.prism_solid(b, poly, zb, zt, sl, col, top_scale=ts, top_offset=off, top=bool(top), bottom=bool(bottom), top_col=tcol)
        return
    # walls with windows and patterns, like a mass
    fp = lib.fp_polygon(poly)
    lk = copy.copy(look)
    lk.wall_slot, lk.wall_col = sl, col
    lk.trim_col = _col(b, 'trimColour', trimColour, lib.shade(col, 1.08))
    lk.glass_col = _col(b, 'glassColour', glassColour, lk.glass_col)
    shape = windowShape if windowShape in SHAPE_KIND else None
    base_kind = _kind(windows if windows in WINDOW_KINDS else 'none', shape)
    ratio = _num(windowRatio, 0.4, 0, 0.92)
    lk.windows, lk.ratio = ('none' if base_kind == 'plain' else base_kind), ratio
    ns = int(_num(storeys if storeys is not None else max(1, round(H / 3.4)), 1, 1, 60))
    segs = list(fp.edges(min_len=0.0))
    faces = faces if isinstance(faces, dict) else {}
    kinds = {}
    for i, sg in enumerate(segs):
        side = lib.patterns.side_of(sg)
        k = None
        if isinstance(edgeKinds, list) and i < len(edgeKinds) and edgeKinds[i] in WINDOW_KINDS:
            k = _kind(edgeKinds[i], None)
        elif side in faces and faces[side] in WINDOW_KINDS:
            k = _kind(faces[side], None)
        else:
            k = base_kind
        kinds[id(sg)] = 'none' if k == 'plain' else k
    pats = _norm_patterns(pattern, lambda m: _warn(b, f'prism: {m}')) if pattern is not None else []
    gk = _kind(groundKind, None) if groundKind in WINDOW_KINDS else None
    gh = _num(groundHeight, 0, 0, 12) or None
    bs = _num(bay, 0, 0, 20) or None
    if pats:
        lib.build_walls(b, segs, zb, H, ns, lk, rng, lambda sg: kinds[id(sg)], ratio, bs, (lambda sg: gk), gh, pats)
    else:
        for sg in segs:
            lib.facade(b, sg, zb, zt, ns, lk, kinds[id(sg)], ratio, rng, bs, ground_kind=gk, ground_h=gh)
    if _num(plinth, 0, 0, 4) > 0 and detail == 0:
        lib.sweep(b, fp, zb, [(0.06, 0), (0.06, plinth), (0, plinth)], sl, lib.shade(col, 0.78))
    if top:
        lib.cap(b, [poly], zt, True, sl, tcol)
    if bottom:
        lib.cap(b, [poly], zb, False, sl, col)


# ---------------------------------------------------------------------------------------------------------------- revolve
@placed
def revolve(b, look, rng, detail, profile=None, segments=24, colour=None, material=None, slot=None, openTop=False, bottomCap=False, smooth=True,
            arcade=None, phase=0.0, crease=35.0, topColour=None):
    if not isinstance(profile, (list, tuple)) or len(profile) < 2:
        _warn(b, 'revolve needs a profile [[r, z], ...] with at least 2 points')
        return
    pts = []
    for p in profile[:120]:
        if isinstance(p, dict):
            p = [p.get('r'), p.get('z'), p.get('colour'), p.get('slot')]
        if not isinstance(p, (list, tuple)) or len(p) < 2:
            _warn(b, f'revolve.profile: {p!r} is not [r, z]')
            continue
        c = p[2] if len(p) > 2 and isinstance(p[2], str) and HEX.match(p[2]) else None
        s = p[3] if len(p) > 3 and p[3] in lib.slots()['slots'] else None
        pts.append((_num(p[0], 1, 0, 120), _num(p[1], 0, -20, 250), c, s))
    if len(pts) < 2:
        return
    sl, col = _paint(b, look, colour, material, slot)
    n0 = int(_num(segments, 24, 5, 64))
    n = _lod(detail, n0, max(8, n0 // 2), max(6, min(8, n0 // 3)))
    arcs = []
    if isinstance(arcade, dict):
        arcs = [arcade]
    elif isinstance(arcade, list):
        arcs = [a for a in arcade if isinstance(a, dict)][:6]
    clean = []
    for a in arcs:
        q = dict(a)
        for k in ('count', 'width', 'height', 'sill', 'depth', 'from', 'to', 'phase'):
            if k in q:
                q[k] = _num(q[k], 0, -250, 250)
        if 'count' in q:
            q['count'] = int(max(3, min(48, q['count'])))
        q['shape'] = q.get('shape', 'arch') if q.get('shape', 'arch') in ('arch', 'pointed', 'rect') else 'arch'
        for ck in ('innerColour', 'pierColour'):
            if ck in q:
                q[ck] = _col(b, f'arcade.{ck}', q[ck], None)
        clean.append(q)
    b.section('revolve')
    G.revolve(b, pts, n=n, slot=sl, col=col, smooth=bool(smooth), close_top=not openTop, bottom_cap=bool(bottomCap), arcades=clean,
              crease=_num(crease, 35, 5, 120), cap_col=_col(b, 'topColour', topColour, None), phase=math.radians(_num(phase, 0, -360, 360)),
              warn=lambda m: _warn(b, m))


# ---------------------------------------------------------------------------------------------------------------- loft
@placed
def loft(b, look, rng, detail, sections=None, colour=None, material=None, slot=None, topColour=None, smooth=None, curve=False, steps=4, capBottom=False,
         capTop=True, round=16):
    if not isinstance(sections, (list, tuple)) or len(sections) < 2:
        _warn(b, 'loft needs sections [{z, rect|circle|ellipse|poly}, ...] (at least 2)')
        return
    secs = []
    nr = int(_num(round, 16, 6, 48))
    nr = _lod(detail, nr, max(8, nr // 2), 6)
    for i, s in enumerate(sections[:24]):
        if not isinstance(s, dict):
            _warn(b, f'loft.sections[{i}] must be an object')
            continue
        q = {'z': _num(s.get('z', 0), 0, -20, 250)}
        for k in ('cx', 'cy', 'rotDeg', 'scale'):
            if k in s:
                q[k] = _num(s[k], 0 if k != 'scale' else 1, -400, 400)
        if isinstance(s.get('rect'), (list, tuple)) and len(s['rect']) >= 2:
            q['rect'] = [_num(s['rect'][0], 1, 0.0, 300), _num(s['rect'][1], 1, 0.0, 300)]
        elif s.get('circle') is not None:
            q['circle'] = _num(s['circle'], 1, 0.0, 200)
        elif isinstance(s.get('ellipse'), (list, tuple)) and len(s['ellipse']) >= 2:
            q['ellipse'] = [_num(s['ellipse'][0], 1, 0.0, 200), _num(s['ellipse'][1], 1, 0.0, 200)]
        elif isinstance(s.get('poly'), (list, tuple)):
            pp = _pts2(b, f'loft.sections[{i}].poly', s['poly'])
            if not pp:
                continue
            q['poly'] = pp
        else:
            _warn(b, f'loft.sections[{i}] needs rect, circle, ellipse or poly')
            continue
        # a zero-size end becomes a tiny ring so the skin closes to a point
        for k in ('rect', 'ellipse'):
            if k in q:
                q[k] = [max(0.002, q[k][0]), max(0.002, q[k][1])]
        if 'circle' in q:
            q['circle'] = max(0.002, q['circle'])
        q['n'] = int(s['n']) if s.get('n') else nr
        c = s.get('colour')
        if isinstance(c, str) and HEX.match(c):
            q['colour'] = c
        secs.append(q)
    if len(secs) < 2:
        return
    sl, col = _paint(b, look, colour, material, slot)
    b.section('loft')
    st = int(_num(steps, 4, 1, 10))
    st = _lod(detail, st, max(1, st // 2), 1)
    G.loft(b, secs, sl, col, top_col=_col(b, 'topColour', topColour, None), smooth=smooth, smooth_profile=bool(curve), steps=st,
           cap_bottom=bool(capBottom), cap_top=bool(capTop), nround=nr)


# ---------------------------------------------------------------------------------------------------------------- sweep-path
@placed
def sweep_path(b, look, rng, detail, section=None, width=None, height=None, radius=None, points=None, arc=None, curve=False, steps=6, sag=0.0, bulge=0.0,
               bulgeShape='parabola', closed=False, up=None, roll=0.0, twist=0.0, taper=None, caps=True, n=6, colour=None, material=None, slot=None):
    sec = None
    if isinstance(section, dict):
        sec = {}
        for k in ('rect', 'ellipse'):
            if isinstance(section.get(k), (list, tuple)) and len(section[k]) >= 2:
                sec[k] = [_num(section[k][0], 0.3, 0.005, 100), _num(section[k][1], 0.3, 0.005, 100)]
        if section.get('circle') is not None:
            sec['circle'] = _num(section['circle'], 0.2, 0.005, 60)
        if isinstance(section.get('poly'), (list, tuple)):
            sec['poly'] = _pts2(b, 'sweep-path.section.poly', section['poly'])
    elif radius is not None:
        sec = {'circle': _num(radius, 0.2, 0.005, 60)}
    elif width is not None or height is not None:
        sec = {'rect': [_num(width, 0.3, 0.005, 100), _num(height, width if width is not None else 0.3, 0.005, 100)]}
    if not sec:
        _warn(b, 'sweep-path needs a section {rect|circle|ellipse|poly} (or width/height or radius)')
        return
    size = max(max(sec.get('rect', [0, 0])), 2 * sec.get('circle', 0), max(sec.get('ellipse', [0, 0])) * 2,
               max((max(abs(p[0]), abs(p[1])) * 2 for p in sec.get('poly', [(0, 0)])), default=0))
    if detail >= 2 and size < 0.45:
        return
    k = _lod(detail, 1, 2, 4)
    stp = max(1, int(_num(steps, 6, 1, 40)) // k)
    if isinstance(arc, dict):
        a = dict(arc)
        sweep = abs(_num(a.get('endDeg', 180), 180, -720, 720) - _num(a.get('startDeg', 0), 0, -720, 720))
        a['radius'] = _num(a.get('radius', 10), 10, 0.1, 300)
        if a.get('radiusY') is not None:
            a['radiusY'] = _num(a['radiusY'], a['radius'], 0.1, 300)
        a['rise'] = _num(a.get('rise', 0), 0, -100, 200)
        a['centre'] = list(_at3(a.get('centre')))
        a['steps'] = int(a['steps']) if a.get('steps') else max(3, math.ceil(sweep / _lod(detail, 7.5, 15.0, 40.0)))
        pts = G.path_points(arc=a, sag=_num(sag, 0, -100, 100), bulge=_num(bulge, 0, -100, 100), bulge_shape=bulgeShape, steps=stp)
    else:
        p3 = _pts3(b, 'sweep-path.points', points)
        if not p3:
            return
        pts = G.path_points(points=p3, curve=bool(curve), steps=stp, sag=_num(sag, 0, -100, 100), bulge=_num(bulge, 0, -100, 100), bulge_shape=bulgeShape)
    if len(pts) < 2:
        return
    upv = (0.0, 0.0, 1.0)
    if isinstance(up, (list, tuple)) and len(up) >= 3:
        upv = (_num(up[0], 0, -1, 1), _num(up[1], 0, -1, 1), _num(up[2], 1, -1, 1))
    tp = (1.0, 1.0)
    if isinstance(taper, (list, tuple)) and len(taper) >= 2:
        tp = (_num(taper[0], 1, 0.01, 20), _num(taper[1], 1, 0.01, 20))
    sl, col = _paint(b, look, colour, material, slot)
    nn = int(_num(n, 6, 3, 24))
    b.section('sweep-path')
    G.sweep_path(b, sec, pts, sl, col, up=upv, roll=_num(roll, 0, -360, 360), twist=_num(twist, 0, -720, 720), taper=tp, closed=bool(closed),
                 caps=bool(caps), nround=_lod(detail, nn, min(nn, 6), 4))


# ---------------------------------------------------------------------------------------------------------------- array
def placements_from_params(params, warn, detail=0):
    """-> (placements [(x, y, z, yaw, t, i)], skip set, vary {name: (v0, v1)}) for an array's params; LOD steps already applied."""
    mode = params.get('mode', 'line')
    if mode == 'circle':
        mode = 'arc'
    if mode not in ('line', 'arc', 'grid'):
        warn(f'array.mode {mode!r} unknown (line|arc|grid), using line')
        mode = 'line'
    count = int(_num(params.get('count', 5), 5, 1, 300))
    kw = dict(mode=mode, count=count, align=params.get('align', 'none'), facing=params.get('facing', 'none'),
              radius=_num(params.get('radius', 10), 10, 0.1, 400), start_deg=_num(params.get('startDeg', 0), 0, -720, 720),
              end_deg=_num(params.get('endDeg', 360), 360, -720, 720), dz=_num(params.get('dz', 0), 0, -100, 200),
              cols=int(_num(params.get('cols', 3), 3, 1, 100)), rows=int(_num(params.get('rows', 2), 2, 1, 100)),
              dx=_num(params.get('dx', 3), 3, -200, 200), dy=_num(params.get('dy', 3), 3, -200, 200), centred=bool(params.get('centred', True)),
              stagger=_num(params.get('stagger', 0), 0, 0, 1), yaw=_num(params.get('yaw', 0), 0, -360, 360))
    if params.get('radiusY') is not None:
        kw['radius_y'] = _num(params['radiusY'], kw['radius'], 0.1, 400)
    if params.get('radiusEnd') is not None:
        kw['radius_end'] = _num(params['radiusEnd'], kw['radius'], 0.1, 400)
    for src, dst in (('start', 'start'), ('end', 'end'), ('step', 'step'), ('centre', 'centre')):
        v = params.get(src)
        if isinstance(v, (list, tuple)) and len(v) >= 2:
            kw[dst] = tuple(_num(x, 0, -400, 400) for x in (list(v) + [0, 0, 0])[:3])
    plc = G.array_placements(**kw)
    skip = {int(i) for i in (params.get('skip') or []) if isinstance(i, (int, float))}
    step = int(_num(params.get('lod1Step', 1) if detail == 1 else (params.get('lod2Step', 1) if detail >= 2 else 1), 1, 1, 20))
    if step > 1:
        plc = [p for p in plc if p[5] % step == 0]
    vary = {}
    if isinstance(params.get('vary'), dict):
        for k, v in params['vary'].items():
            if isinstance(v, (list, tuple)) and len(v) >= 2:
                vary[k] = (_num(v[0], 0, -1e4, 1e4), _num(v[1], 0, -1e4, 1e4))
    return plc, skip, vary


@placed
def array(b, look, rng, detail, of=None, mode='line', count=5, start=None, end=None, step=None, align='none', facing='none', centre=None, radius=10.0,
          radiusY=None, radiusEnd=None, startDeg=0.0, endDeg=360.0, dz=0.0, cols=3, rows=2, dx=3.0, dy=3.0, centred=True, stagger=0.0, yaw=0.0, skip=None,
          vary=None, maxTris=12000, lod1Step=1, lod2Step=1):
    from . import REGISTRY, declared_params   # the registry, at call time (it is still loading while this file is imported)
    items = of if isinstance(of, list) else [of]
    items = [it for it in items if isinstance(it, dict)]
    if not items:
        _warn(b, 'array needs `of`: {"type": <part id>, "params": {...}} (or a list of them)')
        return
    params = {k: v for k, v in dict(mode=mode, count=count, start=start, end=end, step=step, align=align, facing=facing, centre=centre, radius=radius,
                                    radiusY=radiusY, radiusEnd=radiusEnd, startDeg=startDeg, endDeg=endDeg, dz=dz, cols=cols, rows=rows, dx=dx, dy=dy,
                                    centred=centred, stagger=stagger, yaw=yaw, skip=skip, vary=vary, lod1Step=lod1Step, lod2Step=lod2Step).items()
              if v is not None}
    plc, skipset, varyd = placements_from_params(params, lambda m: _warn(b, m), detail)
    t0 = b.tris
    cap = _num(maxTris, 12000, 100, 40000)
    for (x, y, z, ang, t, i) in plc:
        if i in skipset:
            continue
        ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        for it in items:
            pid = it.get('type')
            if isinstance(it.get('lod'), list) and detail not in it['lod']:
                continue
            fn = REGISTRY.get(pid)
            if fn is None or pid == 'mass':
                _warn(b, f'array item type {pid!r} is not a part (masses are only repeated by a top-level array part)')
                continue
            ip = dict(it.get('params') if isinstance(it.get('params'), dict) else {})
            known = declared_params(pid)
            for k, (v0, v1) in varyd.items():
                if k in ip or k in known:
                    ip[k] = v0 + (v1 - v0) * t
            if known:
                for k in [k for k in ip if k not in known]:
                    _warn(b, f'array item {pid}: {k!r} is not a parameter (known: {", ".join(known)})')
                    del ip[k]
            ia = it.get('at') if isinstance(it.get('at'), (list, tuple)) else [0, 0, 0]
            ia = _at3(ia)
            at = (x + ca * ia[0] - sa * ia[1], y + sa * ia[0] + ca * ia[1], z + ia[2])
            try:
                fn(b, copy.copy(look), rng, detail, at=at, rot=ang + _num(it.get('rotDeg', 0), 0, -360, 360), **ip)
            except Exception as exc:   # noqa: BLE001 - one bad copy must not lose the others
                _warn(b, f'array item {pid} failed: {type(exc).__name__}: {exc}')
                return
        if detail == 0 and b.tris - t0 > cap:
            _warn(b, f'array stopped at copy {i + 1} of {len(plc)}: over {int(cap)} triangles (raise maxTris, use fewer or simpler copies)')
            break


# ---------------------------------------------------------------------------------------------------------------- surface
@placed
def surface(b, look, rng, detail, kind='folded', width=20.0, depth=12.0, rise=3.0, thickness=0.4, folds=3, section=None, waves=2.0, phase=0.0, slopeX=0.0,
            slopeY=0.0, vCurve='flat', vRise=0.0, profile='spherical', circle=False, points=None, heights=None, startDeg=-60.0, endDeg=60.0, r0=0.0,
            foldDepth=None, foldAxis='y', z=0.0, colour=None, material=None, slot=None, edgeColour=None, underColour=None, underside=True, smooth=None,
            res=None):
    kinds = ('folded', 'hypar', 'wave', 'dome-cap', 'conoid', 'fan', 'flat', 'heights', 'points')
    if kind not in kinds:
        _warn(b, f'surface.kind {kind!r} unknown ({"|".join(kinds)}), using folded')
        kind = 'folded'
    w, d = _num(width, 20, 0.5, 300), _num(depth, 12, 0.5, 300)
    rs = _num(rise, 3, -60, 100)
    sl, col = _paint(b, look, colour, material, slot, roof=True)
    sec = None
    if section is not None:
        if isinstance(section, list) and len(section) >= 2 and all(isinstance(p, (list, tuple)) and len(p) >= 2 for p in section):
            sec = [(_num(p[0], 0, 0, 1), _num(p[1], 0, -2, 2)) for p in section[:24]]
        else:
            _warn(b, 'surface.section must be [[u, z], ...] over one fold (u 0..1, z 0..1)')
    pg = None
    if kind == 'points':
        if isinstance(points, list) and len(points) >= 2 and all(isinstance(r, list) and len(r) >= 2 for r in points):
            pg = [[tuple(_num(c, 0, -400, 400) for c in (list(p) + [0, 0, 0])[:3]) for p in r[:80]] for r in points[:80]]
            if len({len(r) for r in pg}) != 1:
                _warn(b, 'surface.points rows must all have the same length')
                return
        else:
            _warn(b, 'surface kind points needs points: [[ [x, y, z], ... ], ...] (rows along +x, columns along +y)')
            return
    hg = None
    if kind == 'heights':
        if isinstance(heights, list) and len(heights) >= 2 and all(isinstance(r, list) and len(r) >= 2 for r in heights):
            hg = [[_num(v, 0, -60, 100) for v in r[:80]] for r in heights[:80]]
            if len({len(r) for r in hg}) != 1:
                _warn(b, 'surface.heights rows must all have the same length')
                return
        else:
            _warn(b, 'surface kind heights needs heights: [[z, ...], ...] over width x depth (rows along +x)')
            return
    nu = int(_num(res, 0, 0, 40)) or _lod(detail, 14, 7, 3)
    nv = max(2, nu if kind in ('hypar', 'dome-cap') else _lod(detail, 8, 4, 2))
    if kind == 'wave':
        nu = int(max(8, _num(waves, 2, 0.5, 20) * _lod(detail, 12, 6, 3)))
    grid, polar = G.surface_grid(kind, w, d, rs, nu=nu, nv=nv, folds=int(_num(folds, 3, 1, 24)), section=sec, waves=_num(waves, 2, 0.5, 20),
                                 phase=_num(phase, 0, -20, 20), slope_x=_num(slopeX, 0, -60, 60), slope_y=_num(slopeY, 0, -60, 60),
                                 v_curve=vCurve if vCurve in ('flat', 'arch', 'sag') else 'flat', v_rise=_num(vRise, 0, -40, 40),
                                 profile=profile if profile in ('spherical', 'parabolic') else 'spherical', circle=bool(circle), points=pg, heights=hg,
                                 r0=_num(r0, 0, 0, 300), start_deg=_num(startDeg, -60, -720, 720), end_deg=_num(endDeg, 60, -720, 720),
                                 foldDepth=_num(foldDepth, 0, -40, 40) if foldDepth is not None else None, fold_axis='x' if foldAxis == 'x' else 'y',
                                 base=_num(z, 0, -20, 250))
    sm = (kind in ('wave', 'hypar', 'dome-cap', 'conoid', 'heights', 'points')) if smooth is None else bool(smooth)
    b.section('surface')
    G.shell(b, grid, _num(thickness, 0.4, 0.02, 4), sl, col, under_col=_col(b, 'underColour', underColour, None), edge_col=_col(b, 'edgeColour', edgeColour, None),
            smooth=sm, underside=bool(underside))


# ---------------------------------------------------------------------------------------------------------------- stand
def _station_at(stations, t):
    """Position (x, y), outward (ox, oy) at fraction t of the station polyline (by index)."""
    n = len(stations) - 1
    f = max(0.0, min(1.0, t)) * n
    i = min(int(f), n - 1)
    u = f - i
    (p0, o0), (p1, o1) = stations[i], stations[i + 1]
    ox, oy = o0[0] + (o1[0] - o0[0]) * u, o0[1] + (o1[1] - o0[1]) * u
    ol = math.hypot(ox, oy) or 1.0
    return (p0[0] + (p1[0] - p0[0]) * u, p0[1] + (p1[1] - p0[1]) * u), (ox / ol, oy / ol)


@placed
def stand(b, look, rng, detail, start=None, end=None, centre=None, radius=30.0, radiusY=None, startDeg=0.0, endDeg=90.0, flip=False, rows=20, rise=0.45,
          run=0.8, firstHeight=0.9, offset=0.0, tiers=None, under='open', slab=0.7, stepped=False, backWall=0.0, bay=6.0, canopy=None, seatColour=None, seatColours=None,
          blocks=1, concreteColour=None, underColour=None, closeEnds=True, facetDeg=6.0):
    conc = _col(b, 'concreteColour', concreteColour, look.stone_col)
    seat = _col(b, 'seatColour', seatColour, '#a8483a')
    ucol = _col(b, 'underColour', underColour, lib.shade(conc, 0.5))
    scols = [c for c in (seatColours if isinstance(seatColours, list) else []) if isinstance(c, str) and HEX.match(c)] or [seat]
    nblocks = int(_num(blocks, 1, 1, 24)) if len(scols) > 1 or blocks != 1 else 1
    if detail >= 2:
        nblocks = 1
    # stations
    if centre is not None:
        c = _at3(centre)
        rx = _num(radius, 30, 1, 300)
        ry = _num(radiusY, rx, 1, 300) if radiusY is not None else rx
        a0, a1 = _num(startDeg, 0, -720, 720), _num(endDeg, 90, -720, 720)
        fd_ = _num(facetDeg, 6.0, 2.0, 45.0)
        per = max(1, math.ceil(abs(a1 - a0) / nblocks / _lod(detail, fd_, fd_ * 2, fd_ * 5)))
        stations = G.stations_arc((c[0], c[1]), rx, ry, a0, a1, per * nblocks, bool(flip))
        length = math.radians(abs(a1 - a0)) * (rx + ry) / 2
    elif start is not None and end is not None and len(start) >= 2 and len(end) >= 2:
        p0, p1 = (_num(start[0], 0, -400, 400), _num(start[1], 0, -400, 400)), (_num(end[0], 0, -400, 400), _num(end[1], 0, -400, 400))
        stations = G.stations_line(p0, p1, nblocks, bool(flip))
        per = 1
        length = math.dist(p0, p1)
    else:
        _warn(b, 'stand needs start + end (a straight stand; outward is to the right of travel, field on the left) or centre + radius + startDeg/endDeg (an arc)')
        return
    if length < 0.5:
        return
    # tiers -> top polyline
    tl = []
    if isinstance(tiers, list) and tiers:
        for t in tiers[:4]:
            if isinstance(t, dict):
                tl.append({'rows': int(_num(t.get('rows', 12), 12, 1, 60)), 'rise': _num(t.get('rise', rise), rise, 0.05, 2), 'run': _num(t.get('run', run), run, 0.2, 3),
                           'gap': _num(t.get('gap', 0), 0, 0, 30), 'lift': _num(t.get('lift', 0), 0, 0, 30)})
    if not tl:
        tl = [{'rows': int(_num(rows, 20, 1, 80)), 'rise': _num(rise, 0.45, 0.05, 2), 'run': _num(run, 0.8, 0.2, 3), 'gap': 0.0, 'lift': 0.0}]
    d = _num(offset, 0, -50, 100)
    zc = _num(firstHeight, 0.9, 0.0, 40)
    T, kinds_ = [(d, zc)], []     # kinds_: 's' seat tread, 'r' riser, 'c' concrete walkway
    for ti, t in enumerate(tl):
        if t['gap'] > 0:
            d += t['gap']
            T.append((d, zc))
            kinds_.append('c')
        if t['lift'] > 0:
            zc += t['lift']
            T.append((d, zc))
            kinds_.append('r')
        if detail >= 1:   # one ramp per tier
            d2, z2 = d + t['rows'] * t['run'], zc + (t['rows'] - 1) * t['rise']
            T.append((d2, z2))
            kinds_.append('s')
            d, zc = d2, z2
        else:
            for k in range(t['rows']):
                d += t['run']
                T.append((d, zc))
                kinds_.append('s')
                if k < t['rows'] - 1:
                    zc += t['rise']
                    T.append((d, zc))
                    kinds_.append('r')
    d_end, z_end = d, zc
    d0, z_f = T[0]
    bw = _num(backWall, 0, 0, 20)
    wall_t = 0.35
    prof = list(T)
    ekinds = list(kinds_)
    zs_soff_f = max(0.15, z_f - _num(slab, 0.7, 0.2, 3))
    sl_ = _num(slab, 0.7, 0.2, 3)
    if under == 'solid':
        if bw > 0:
            prof += [(d_end, z_end + bw), (d_end + wall_t, z_end + bw), (d_end + wall_t, 0.0), (d0, 0.0)]
            ekinds += ['b', 'b', 'b', 'f']
        else:
            prof += [(d_end, 0.0), (d0, 0.0)]
            ekinds += ['b', 'f']
        # (the closing edge (d0, 0) -> T[0] is the front face)
        ekinds.append('f')
    else:
        if bw > 0:
            prof += [(d_end, z_end + bw), (d_end + wall_t, z_end + bw), (d_end + wall_t, z_end - sl_)]
            ekinds += ['b', 'b', 'b']
        else:
            prof += [(d_end, z_end - sl_)]
            ekinds += ['b']
        if stepped and detail == 0 and len(T) > 2:
            low = [(dd, max(0.1, zz - sl_)) for (dd, zz) in reversed(T)]
            low = low[1:] if bw == 0 else low[1:]   # the first point repeats the back-bottom corner
            prof += low
            ekinds += ['u'] * len(low)
        else:
            prof += [(d0, zs_soff_f)]
            ekinds += ['u']
        ekinds.append('f')
    seat_slot = 'stadium-seating' if 'stadium-seating' in lib.slots()['slots'] else 'plain'
    cmap = {'r': conc, 'c': lib.shade(conc, 1.05), 'b': lib.shade(conc, 0.92), 'f': lib.shade(conc, 0.8), 'u': ucol}
    b.section('stand')

    def edge_cols(seat_c):
        return [seat_c if k == 's' else cmap[k] for k in ekinds]

    ns = len(stations) - 1
    per_block = max(1, ns // nblocks)
    for bi in range(nblocks):
        sub = stations[bi * per_block: (bi + 1) * per_block + 1] if nblocks > 1 else stations
        if len(sub) < 2:
            continue
        G.extrude_profile(b, sub, prof, cols=edge_cols(scols[bi % len(scols)]), slots=[seat_slot if k == 's' else 'plain' for k in ekinds], scale=2.0, caps=bool(closeEnds), cap_col=conc,
                          close_first=(bi == 0), close_last=(bi == nblocks - 1))
    # structure under an open stand (LOD0): raking beams and columns
    if under != 'solid' and detail == 0:
        nb = max(2, int(length / _num(bay, 6, 2, 30)) + 1)
        for k in range(nb):
            (pp, oo) = _station_at(stations, k / (nb - 1))
            tx, ty = -oo[1], oo[0]
            hw = 0.22
            st = [((pp[0] - tx * hw, pp[1] - ty * hw), oo), ((pp[0] + tx * hw, pp[1] + ty * hw), oo)]
            drop = _num(rise, 0.45, 0.05, 2) if stepped else 0.0
            beam = [(d0, zs_soff_f - drop), (d_end, z_end - sl_ - drop), (d_end, z_end - sl_ - drop - 0.55), (d0, max(0.0, zs_soff_f - drop - 0.55))]
            G.extrude_profile(b, st, beam, cols=[ucol, ucol, ucol, ucol], caps=True, cap_col=ucol)
            yaw = math.atan2(oo[1], oo[0])
            for dd, zt_ in ((d0 + 0.5, zs_soff_f - drop - 0.5), (d_end - 0.5, z_end - sl_ - drop - 0.55)):
                if zt_ > 0.3:
                    lib.obox(b, pp[0] + oo[0] * dd, pp[1] + oo[1] * dd, 0, 0.5, 0.5, zt_, yaw, 'rough-concrete', conc)
    # canopy
    if isinstance(canopy, dict):
        ch = _num(canopy.get('height', 7.0), 7.0, 1.5, 40)
        cd = _num(canopy.get('depth', 8.0), 8.0, 1, 40)
        ct = _num(canopy.get('thickness', 0.5), 0.5, 0.1, 3)
        ext = _num(canopy.get('overhangBack', 1.0), 1.0, 0, 12)
        sl_deg = _num(canopy.get('slopeDeg', 0.0), 0.0, -40, 40)
        roofc = _col(b, 'canopy.colour', canopy.get('colour'), look.roof_col)
        edgec = _col(b, 'canopy.edgeColour', canopy.get('edgeColour'), lib.shade(roofc, 0.85))
        d_back = d_end + ext
        d_front = d_back - cd - ext
        zb_ = z_end + ch
        zf_ = zb_ + math.tan(math.radians(sl_deg)) * (d_back - d_front)
        poly = [(d_back, zb_), (d_front, zf_), (d_front, zf_ + ct), (d_back, zb_ + ct)]
        G.extrude_profile(b, stations, poly, cols=[lib.shade(roofc, 0.55), edgec, roofc, edgec], slots=['plain-render', 'plain-render', look.roof_slot, 'plain-render'],
                          caps=bool(closeEnds), cap_col=edgec)
        ns_ = int(_num(canopy.get('supports', 0), 0, 0, 40))
        if ns_ > 0 and detail < 2:
            for k in range(ns_):
                (pp, oo) = _station_at(stations, (k + 0.5) / ns_ if ns_ > 1 else 0.5)
                yaw = math.atan2(oo[1], oo[0])
                lib.obox(b, pp[0] + oo[0] * (d_back - 0.6), pp[1] + oo[1] * (d_back - 0.6), 0, 0.7, 0.7, zb_, yaw, 'rough-concrete', conc)


# ---------------------------------------------------------------------------------------------------------------- registry
PARTS = {'prism': prism, 'revolve': revolve, 'loft': loft, 'sweep-path': sweep_path, 'array': array, 'surface': surface, 'stand': stand}

PART_DOC = {
    'prism': {'doc': 'Extrude any 2D polygon (local metres) from z0 to z0+height. Optional topScale (number or [sx, sy]) / topOffset [dx, dy] taper the top; '
                     'with a straight prism you can add mass-style walls: windows (kind), windowShape rect|arched|pointed|round, faces {front,back,left,right}, '
                     'edgeKinds (per polygon edge, counter-clockwise), storeys, bay, pattern (see wall patterns), glassColour, plinth. Points: points, or rect [w, d], or radius + n.',
              'params': {'points': None, 'rect': None, 'radius': None, 'n': 6, 'z0': 0.0, 'height': 10.0, 'topScale': 1.0, 'topOffset': None, 'colour': None,
                         'material': None, 'slot': None, 'topColour': None, 'top': True, 'bottom': False, 'windows': 'none', 'windowShape': None,
                         'windowRatio': 0.4, 'faces': None, 'edgeKinds': None, 'storeys': None, 'bay': None, 'pattern': None, 'glassColour': None,
                         'trimColour': None, 'plinth': 0.0, 'groundKind': None, 'groundHeight': None}},
    'revolve': {'doc': 'Lathe a profile [[r, z], [r, z, "#colour"], ...] round the vertical axis (segments sides): domes of any profile, drums, bulbous minaret tops, '
                       'water towers, tiered stupas, whole minarets. Trace the profile from the bottom up the outside and over the top; the colour of a point colours the '
                       'segment ending there. arcade {from, to, count, width, height, sill, shape arch|pointed|rect, depth, innerColour, phase} (or a list) cuts '
                       'arched openings into a vertical stretch of the profile (balcony drums). openTop leaves the top uncapped, bottomCap closes the base.',
                'params': {'profile': None, 'segments': 24, 'colour': None, 'material': None, 'slot': None, 'openTop': False, 'bottomCap': False, 'smooth': True,
                           'arcade': None, 'phase': 0.0, 'crease': 35.0, 'topColour': None}},
    'loft': {'doc': 'Skin between sections at heights: sections [{z, rect [w, d] | circle r | ellipse [rx, ry] | poly [[x, y]...], cx, cy, rotDeg, scale, colour}] '
                    '(colour tints the band above). Tapering towers, flared legs, V-fins, twisted forms. curve=true bends the skin smoothly through the sections '
                    '(steps rings between pairs). Different point counts are matched automatically. capBottom/capTop close the ends.',
             'params': {'sections': None, 'colour': None, 'material': None, 'slot': None, 'topColour': None, 'smooth': None, 'curve': False, 'steps': 4,
                        'capBottom': False, 'capTop': True, 'round': 16}},
    'sweep-path': {'doc': 'Sweep a 2D section {rect [w, h] | circle r | ellipse | poly [[u, v]...]} (or width/height, or radius) along a 3D path: points [[x, y, z]...] '
                          '(curve=true smooths) or arc {centre, radius, radiusY, startDeg, endDeg, rise}. sag / bulge (m) bend the path down/up (cables, arches, canopy '
                          'edges), closed=true makes a ring beam, taper [s0, s1], twist, roll, up. Cables, curved beams, arches, handrails.',
                   'params': {'section': None, 'width': None, 'height': None, 'radius': None, 'points': None, 'arc': None, 'curve': False, 'steps': 6, 'sag': 0.0,
                              'bulge': 0.0, 'bulgeShape': 'parabola', 'closed': False, 'up': None, 'roll': 0.0, 'twist': 0.0, 'taper': None, 'caps': True, 'n': 6,
                              'colour': None, 'material': None, 'slot': None}},
    'array': {'doc': 'Repeat a part (of = {type, params, at, rotDeg} or a list) along a line (start + end, or start + step, count), an arc/circle (centre, radius, '
                     'radiusY, radiusEnd, startDeg, endDeg, count, facing centre|outward|none, dz) or a grid (cols, rows, dx, dy, stagger). vary {param: [from, to]} '
                     'interpolates numeric params over the copies; an item may carry lod [0, 1] to draw only at those LODs; skip [indices]; lod1Step / lod2Step thin the copies at LOD1/LOD2; maxTris guards the budget. '
                     'A top-level array whose `of` is a mass repeats masses.',
              'params': {'of': None, 'mode': 'line', 'count': 5, 'start': None, 'end': None, 'step': None, 'align': 'none', 'facing': 'none', 'centre': None,
                         'radius': 10.0, 'radiusY': None, 'radiusEnd': None, 'startDeg': 0.0, 'endDeg': 360.0, 'dz': 0.0, 'cols': 3, 'rows': 2, 'dx': 3.0, 'dy': 3.0,
                         'centred': True, 'stagger': 0.0, 'yaw': 0.0, 'skip': None, 'vary': None, 'maxTris': 12000, 'lod1Step': 1, 'lod2Step': 1}},
    'surface': {'doc': 'A roof/shell from a height function over width x depth centred on `at` (z is the base height): kind folded (folds, optional section '
                       '[[u, z]...] of one fold, foldAxis x|y), hypar (hyperbolic paraboloid), wave (waves), dome-cap (spherical/parabolic cap, circle=true for a round plan), '
                       'conoid, fan (radial folded plates: startDeg, endDeg, r0, foldDepth), flat, heights (explicit z grid), points (explicit 3D grid, rows along +x). '
                       'rise is the height range; slopeX/slopeY tilt the base; vCurve arch|sag + vRise bends across. thickness gives a shell with underside (LOD0) and fascia.',
                'params': {'kind': 'folded', 'width': 20.0, 'depth': 12.0, 'rise': 3.0, 'thickness': 0.4, 'folds': 3, 'section': None, 'waves': 2.0, 'phase': 0.0,
                           'slopeX': 0.0, 'slopeY': 0.0, 'vCurve': 'flat', 'vRise': 0.0, 'profile': 'spherical', 'circle': False, 'points': None, 'heights': None,
                           'startDeg': -60.0, 'endDeg': 60.0, 'r0': 0.0, 'foldDepth': None, 'foldAxis': 'y', 'z': 0.0, 'colour': None, 'material': None, 'slot': None,
                           'edgeColour': None, 'underColour': None, 'underside': True, 'smooth': None, 'res': None}},
    'stand': {'doc': 'Raked seating tiers seen from outside, along a straight line (start + end: outward is to the RIGHT of travel, the field on the left; flip reverses) '
                     'or an arc (centre, radius, radiusY, startDeg, endDeg, counter-clockwise, outward is radial). rows, rise and run per row, firstHeight, offset from the '
                     'pitch edge; tiers [{rows, rise, run, gap, lift}] for several tiers; under open (raking beams and columns every `bay` m; stepped=true gives a stepped soffit that follows the rows) | solid; backWall m above the '
                     'top row; canopy {height, depth, thickness, slopeDeg, colour, overhangBack, supports}; seatColour(s) with blocks for coloured sections; facetDeg is the arc step (cost grows with rows x edges / facetDeg). LOD1: one ramp '
                     'per tier; LOD2 coarse.',
              'params': {'start': None, 'end': None, 'centre': None, 'radius': 30.0, 'radiusY': None, 'startDeg': 0.0, 'endDeg': 90.0, 'flip': False, 'rows': 20,
                         'rise': 0.45, 'run': 0.8, 'firstHeight': 0.9, 'offset': 0.0, 'tiers': None, 'under': 'open', 'slab': 0.7, 'stepped': False, 'backWall': 0.0, 'bay': 6.0,
                         'canopy': None, 'seatColour': None, 'seatColours': None, 'blocks': 1, 'concreteColour': None, 'underColour': None, 'closeEnds': True,
                         'facetDeg': 6.0}},
}
