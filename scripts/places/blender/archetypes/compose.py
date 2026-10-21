"""compose: builds one PlaceModelV2 spec (docs/agent-plans/unique-places/PLACE-MODEL.md) into LOD0/1/2 geometry.

    build(spec, style, rng, detail, facts=None) -> [building, building-site] mesh objects      (the worker calls it for spec jobs)

`spec.parts` is a list. `{"type": "mass", ...}` entries are built by this module (footprint rect | polygon | osm | kind, walls with a
facade per side, roof incl. the curved and wave shells); every other `type` is looked up in the parts registry
(scripts/places/blender/parts, `python3 .../parts/list.py`) and placed with `at` (x, y, z) and `rotDeg`. `site` adds ground, forecourt,
trees. Unknown part types or parameters, odd numbers and bad colours are reported (module attribute `last_warnings`, merged into the
job report by the worker), never raised. Deterministic: the only randomness is `rng`.

Frame: metres, +x right, +y away from the camera (the main facade faces -y), z up, ground z = 0.
A mass `at` is its centre; `"on": "<mass id>"` on another part makes its `at` relative to that mass (z = the mass's roof level).

mass keys: id, footprint, at [x, y], rotDeg, z0 (base height), height (to the eaves), storeys,
  wall {material, colour, windows, windowRatio, faces {front|back|left|right: window kind or "plain"}, bands (#hex | {colour, height}),
        plinth (m), bay (m), cornice (bool), parapet (m), glassColour, groundKind, groundHeight}
  roof {form, colour, material, pitch (deg), rise (m), overhang (m), parapet (m), + form extras: axis, profile, drum, lantern, finial,
        tiers, teeth, rows, cols, high, curve (arch|sweep|wave), waves, thickness, infill (wall|glass|none)}
  wall.pattern (object or list): floors | bands | fins | louvres | panels | arcade | pilotis | balconies (lib/patterns.py has every key);
  wall.windowShape rect|arched|pointed|round (windows kinds also accept rect, pointed, round; faces.<side> likewise)
Parts: `array` of masses ({"type": "array", "params": {"of": {"type": "mass", ...}, "mode": "line|arc|grid", ...}}) expands into masses.
footprint: {"rect": [w, d]} | {"polygon": [[x, y], ...]} | {"osm": true, "scale": 1, "rotDeg": 0, "fit": maxSideMetres, "simplify": metres}
           | {"kind": "L|U|T|H|cross|ring|oval|round|irregular", "size": [w, d]}
"""
import copy
import hashlib
import math
import random
import re
import sys
import traceback
from pathlib import Path

import lib
from lib.patterns import normalise as _norm_patterns
from lib.facade import GROUND_COL, GROUND_SLOT, ROOF_SLOT, WALL_SLOT

HERE = Path(__file__).resolve().parent.parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import parts  # noqa: E402
from parts._xform import Xform  # noqa: E402

last_warnings = []
HEX = re.compile(r'^#[0-9a-fA-F]{6}$')
MAX_PARTS = 120
MAX_MASSES = 40
MAX_SIDE = 118.0
ROOF_FORMS = {'flat', 'gable', 'hip', 'shed', 'barrel', 'dome', 'multi-dome', 'tensile', 'sawtooth', 'pyramidal', 'mansard', 'stepped',
              'curved', 'wave', 'none'}
WINDOW_KINDS = {'curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre', 'none', 'plain', 'round', 'rect', 'pointed'}
SHAPE_KIND = {'rect': 'punched', 'arched': 'arched', 'pointed': 'pointed-arch', 'round': 'round'}
ALIAS_KIND = {'rect': 'punched', 'pointed': 'pointed-arch'}
ROOF_KEYS = {'form', 'colour', 'material', 'pitch', 'rise', 'overhang', 'parapet', 'axis', 'profile', 'drum', 'lantern', 'finial', 'tiers', 'teeth',
             'rows', 'cols', 'high', 'curve', 'waves', 'thickness', 'infill', 'ribs'}
WALL_KEYS = {'material', 'colour', 'windows', 'windowRatio', 'faces', 'bands', 'plinth', 'bay', 'cornice', 'parapet', 'glassColour', 'groundKind',
             'groundHeight', 'accent', 'accentColour', 'trimColour', 'pattern', 'windowShape'}
MASS_KEYS = {'type', 'id', 'footprint', 'at', 'rotDeg', 'z0', 'height', 'storeys', 'wall', 'roof', 'note', 'notes'}


class Ctx:
    def __init__(self):
        self.warn = []

    def w(self, msg):
        if msg not in self.warn:
            self.warn.append(msg)


def _num(c, where, v, default, lo, hi):
    try:
        x = float(v)
        if x != x or x in (float('inf'), float('-inf')):
            raise ValueError
    except (TypeError, ValueError):
        if v is not None:
            c.w(f'{where}: {v!r} is not a number, using {default}')
        return float(default)
    if x < lo or x > hi:
        c.w(f'{where}: {x:g} clamped to [{lo:g}, {hi:g}]')
        return max(lo, min(hi, x))
    return x


def _col(c, where, v, default=None):
    if v is None:
        return default
    if isinstance(v, str) and HEX.match(v):
        return v
    c.w(f'{where}: {v!r} is not a #rrggbb colour, ignored')
    return default


def _xy(c, where, v, default=(0.0, 0.0)):
    if not isinstance(v, (list, tuple)) or len(v) < 2:
        if v is not None:
            c.w(f'{where}: expected [x, y], got {v!r}')
        return tuple(default) + (0.0,)
    x = _num(c, where + '[0]', v[0], 0, -400, 400)
    y = _num(c, where + '[1]', v[1], 0, -400, 400)
    z = _num(c, where + '[2]', v[2], 0, -50, 200) if len(v) > 2 else 0.0
    return (x, y, z)


def _seed(base, idx):
    return random.Random((base * 1000003 + idx * 7919 + 17) & 0xFFFFFFFFFFFFFFFF)


# ------------------------------------------------------------------------------------------------------------------ geometry
def _dp(points, tol):
    """Douglas-Peucker on a closed ring (points list, no repeated end)."""
    if tol <= 0 or len(points) < 5:
        return points

    def rec(pts):
        if len(pts) < 3:
            return pts
        (x0, y0), (x1, y1) = pts[0], pts[-1]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, 0
        for i in range(1, len(pts) - 1):
            d = abs((pts[i][0] - x0) * dy - (pts[i][1] - y0) * dx) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            return rec(pts[:bi + 1])[:-1] + rec(pts[bi:])
        return [pts[0], pts[-1]]

    n = len(points)
    # split the ring at the two points farthest apart so neither end is arbitrary
    a = 0
    b = max(range(n), key=lambda i: math.hypot(points[i][0] - points[a][0], points[i][1] - points[a][1]))
    p1 = points[a:b + 1] if a <= b else points[a:] + points[:b + 1]
    p2 = (points[b:] + points[:a + 1])
    return rec(p1)[:-1] + rec(p2)[:-1]


def _area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def _obb(pts):
    """Smallest-area oriented rectangle: (cx, cy, w, d, angle_deg) with the rectangle axis-aligned after rotating by -angle."""
    best = None
    n = len(pts)
    for i in range(n):
        dx, dy = pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        ca, sa = dx / L, dy / L
        us = [p[0] * ca + p[1] * sa for p in pts]
        vs = [-p[0] * sa + p[1] * ca for p in pts]
        w, d = max(us) - min(us), max(vs) - min(vs)
        if best is None or w * d < best[0] - 1e-6:
            best = (w * d, (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2, w, d, math.atan2(sa, ca))
    _, cu, cv, w, d, a = best
    ca, sa = math.cos(a), math.sin(a)
    cx, cy = cu * ca - cv * sa, cu * sa + cv * ca
    ang = math.degrees(a)
    # keep the long side along x and the angle within (-45, 45] so ridges and fronts read naturally
    if d > w:
        w, d = d, w
        ang += 90
    while ang > 90:
        ang -= 180
    while ang <= -90:
        ang += 180
    return cx, cy, w, d, ang


def _footprint(c, m, mid, facts, detail, rng):
    """-> (Footprint, kind) with the outline in the mass's local frame (centred on its `at`)."""
    f = m.get('footprint')
    if not isinstance(f, dict):
        c.w(f'mass {mid}: missing footprint, using a 20 x 12 m rectangle')
        return lib.fp_rect(20, 12), 'rect'
    pts = None
    if f.get('osm'):
        osm = (facts or {}).get('osm') or {}
        ring = osm.get('footprint')
        if not ring or len(ring) < 3:
            c.w(f'mass {mid}: footprint.osm requested but the job carries no facts.osm.footprint; using the {osm.get("widthM", 30)} x {osm.get("depthM", 20)} m box if known')
            w = _num(c, 'osm width', osm.get('widthM', 30), 30, 3, 118)
            d = _num(c, 'osm depth', osm.get('depthM', 20), 20, 3, 118)
            return lib.fp_rect(w, d), 'rect'
        pts = [(float(p[0]), float(p[1])) for p in ring]
        tol = _num(c, f'mass {mid} footprint.simplify', f.get('simplify', 0), 0, 0, 20)
        if tol > 0:
            pts = _dp(pts, tol)
    elif isinstance(f.get('polygon'), list):
        pts = []
        for p in f['polygon']:
            if isinstance(p, (list, tuple)) and len(p) >= 2:
                pts.append((float(p[0]), float(p[1])))
        if len(pts) < 3:
            c.w(f'mass {mid}: polygon needs at least 3 points')
            return lib.fp_rect(20, 12), 'rect'
    if pts is not None:
        sc = _num(c, f'mass {mid} footprint.scale', f.get('scale', 1.0), 1.0, 0.02, 20)
        rot = _num(c, f'mass {mid} footprint.rotDeg', f.get('rotDeg', 0.0), 0, -360, 360)
        ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        pts = [((x * ca - y * sa) * sc, (x * sa + y * ca) * sc) for x, y in pts]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        side = max(max(xs) - min(xs), max(ys) - min(ys))
        fit = f.get('fit')
        target = _num(c, f'mass {mid} footprint.fit', fit, MAX_SIDE, 3, MAX_SIDE) if fit is not None else MAX_SIDE
        if side > target + 1e-6:
            k = target / side
            pts = [(x * k, y * k) for x, y in pts]
            c.w(f'mass {mid}: outline is {side:.0f} m across, scaled by {k:.2f} to fit {target:.0f} m (set footprint.fit/scale to choose)')
        if abs(_area(pts)) < 1.0:
            c.w(f'mass {mid}: outline has no area, using a 20 x 12 m rectangle')
            return lib.fp_rect(20, 12), 'rect'
        fp = lib.fp_polygon(pts)
        return fp, 'polygon'
    if isinstance(f.get('rect'), (list, tuple)) and len(f['rect']) >= 2:
        w = _num(c, f'mass {mid} footprint.rect[0]', f['rect'][0], 20, 0.5, 400)
        d = _num(c, f'mass {mid} footprint.rect[1]', f['rect'][1], 12, 0.5, 400)
        side = max(w, d)
        if side > MAX_SIDE:
            k = MAX_SIDE / side
            c.w(f'mass {mid}: {side:.0f} m wide, scaled by {k:.2f} to the {MAX_SIDE:.0f} m clamp (show the recognisable portion instead)')
            w, d = w * k, d * k
        return lib.fp_rect(w, d), 'rect'
    if f.get('kind'):
        size = f.get('size') or [30, 20]
        w = _num(c, f'mass {mid} footprint.size[0]', size[0], 30, 2, MAX_SIDE)
        d = _num(c, f'mass {mid} footprint.size[1]', size[1], 20, 2, MAX_SIDE)
        if f['kind'] not in ('rect', 'L', 'U', 'T', 'H', 'ring', 'oval', 'round', 'cross', 'irregular'):
            c.w(f'mass {mid}: unknown footprint kind {f["kind"]!r}, using rect')
        return lib.footprint(f['kind'], w, d, rng, detail), 'kind'
    c.w(f'mass {mid}: footprint needs rect, polygon, osm or kind; using 20 x 12 m')
    return lib.fp_rect(20, 12), 'rect'


def _kind(k, shape):
    """Normalise a window kind (rect->punched, pointed->pointed-arch) and apply a wall-wide windowShape to the punched family."""
    k = ALIAS_KIND.get(k, k)
    if shape and k in ('punched', 'arched', 'pointed-arch', 'round'):
        k = SHAPE_KIND[shape]
    return k


def _side(seg):
    nx, ny = seg.n
    if abs(ny) >= abs(nx):
        return 'front' if ny < 0 else 'back'
    return 'right' if nx > 0 else 'left'


# ------------------------------------------------------------------------------------------------------------------ roofs
def _curved_roof(c, mb, mid, rect, z, lk, roof, detail, rng, glass_col):
    """Curved / wave shell over the axis-aligned rect (cx, cy, W, D) whose wall tops are at z."""
    cx, cy, W, D = rect
    form = roof.get('form')
    rise = _num(c, f'mass {mid} roof.rise', roof.get('rise', D * 0.22 if form == 'curved' else 5.0), 4, 0.3, 60)
    ov = _num(c, f'mass {mid} roof.overhang', roof.get('overhang', 1.0), 1.0, 0, 20)
    thick = _num(c, f'mass {mid} roof.thickness', roof.get('thickness', 0.6), 0.6, 0.1, 3)
    curve = roof.get('curve') or ('wave' if form == 'wave' else 'arch')
    if curve not in ('arch', 'sweep', 'wave'):
        c.w(f'mass {mid}: roof.curve {curve!r} unknown (arch|sweep|wave), using arch')
        curve = 'arch'
    waves = _num(c, f'mass {mid} roof.waves', roof.get('waves', max(1, round(W / 24.0))), 1, 0.5, 20)
    phase = rng.uniform(0, 1) * 0.0   # deterministic wave: starts at a trough on the left edge
    nx = {0: int(min(96, max(40, waves * 14))), 1: int(min(40, max(16, waves * 6))), 2: 8}[detail]
    ny = {0: 14, 1: 8, 2: 4}[detail]

    def h(u, v):
        if curve == 'arch':
            return max(-0.12 * rise, rise * (1 - v * v))
        if curve == 'sweep':
            t = (v + 1) / 2
            droop = 1 - 0.22 * min(1.0, abs(u)) ** 3
            return max(-0.1 * rise, rise * (0.12 + 0.88 * max(t, 0) ** 1.5) * droop - (0.0 if t >= 0 else 0.0))
        s = 0.5 - 0.5 * math.cos(math.pi * waves * (u + 1) + phase)
        return max(-0.1 * rise, rise * (0.12 + 0.88 * s) * (1 - 0.3 * min(1.5, v * v)))

    ux = W / 2 + ov
    vy = D / 2 + ov
    top = []
    for i in range(nx + 1):
        x = -ux + 2 * ux * i / nx
        u = x / (W / 2)
        row = []
        for j in range(ny + 1):
            y = -vy + 2 * vy * j / ny
            v = y / (D / 2)
            row.append((cx + x, cy + y, z + thick + h(u, v)))
        top.append(row)
    lib.roof_shell(mb, top, thick, lk, slot=lk.roof_slot, col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.55), edge_col=lib.shade(lk.roof_col, 0.82))
    infill = roof.get('infill', 'wall')
    if infill not in ('wall', 'glass', 'none'):
        c.w(f'mass {mid}: roof.infill {infill!r} unknown (wall|glass|none)')
        infill = 'wall'
    if infill == 'none':
        return
    slot, col = ('glass-ribbon', glass_col) if infill == 'glass' else (lk.wall_slot, lk.wall_col)
    n = {0: 28, 1: 14, 2: 6}[detail]
    for sign in (-1, 1):   # the two end walls (x = +-W/2), outward normal +-x
        pts = [(cx + sign * W / 2, cy + (-D / 2 + D * k / n), z) for k in range(n + 1)]
        pts += [(cx + sign * W / 2, cy + (D / 2 - D * k / n), z + h(sign, (D / 2 - D * k / n) / (D / 2))) for k in range(n + 1)]
        if any(p[2] > z + 0.08 for p in pts):
            mb.facing(pts, (sign, 0, 0), slot, col, mode='fit') if slot.startswith('glass') else mb.facing(pts, (sign, 0, 0), slot, col)
    for sign in (-1, 1):   # the long walls (y = +-D/2), outward normal +-y
        pts = [(cx + (-W / 2 + W * k / nx), cy + sign * D / 2, z) for k in range(nx + 1)]
        pts += [(cx + (W / 2 - W * k / nx), cy + sign * D / 2, z + h((W / 2 - W * k / nx) / (W / 2), sign)) for k in range(nx + 1)]
        if any(p[2] > z + 0.08 for p in pts):
            mb.facing(pts, (0, sign, 0), slot, col, mode='fit') if slot.startswith('glass') else mb.facing(pts, (0, sign, 0), slot, col)


# ------------------------------------------------------------------------------------------------------------------ masses
def _mass(c, b, lk0, m, idx, base, facts, detail, info):
    mid = str(m.get('id') or f'mass{idx}')
    for k in m:
        if k not in MASS_KEYS:
            c.w(f'mass {mid}: unknown key {k!r} ignored')
    rng = _seed(base, idx)
    ax, ay, _ = _xy(c, f'mass {mid}.at', m.get('at'))
    rot = _num(c, f'mass {mid}.rotDeg', m.get('rotDeg', 0.0), 0, -360, 360)
    z0 = _num(c, f'mass {mid}.z0', m.get('z0', 0.0), 0, -5, 120)
    H = _num(c, f'mass {mid}.height', m.get('height', 8.0), 8, 0.5, 138)
    storeys = int(_num(c, f'mass {mid}.storeys', m.get('storeys', max(1, round(H / 3.4))), 1, 1, 60))
    fp, fkind = _footprint(c, m, mid, (facts or {}), detail, rng)
    mb = Xform.make(b, (ax, ay, 0.0), rot)

    wall = m.get('wall') if isinstance(m.get('wall'), dict) else {}
    if m.get('wall') is not None and not isinstance(m.get('wall'), dict):
        c.w(f'mass {mid}: wall must be an object')
    roof = m.get('roof') if isinstance(m.get('roof'), dict) else {}
    for k in wall:
        if k not in WALL_KEYS:
            c.w(f'mass {mid}.wall: unknown key {k!r} ignored')
    for k in roof:
        if k not in ROOF_KEYS:
            c.w(f'mass {mid}.roof: unknown key {k!r} ignored')

    lk = copy.copy(lk0)
    mat = wall.get('material')
    if mat is not None:
        if mat not in WALL_SLOT:
            c.w(f'mass {mid}.wall.material {mat!r} is not a contract material; using render')
            mat = 'render'
        lk.wall_material = mat
        lk.wall_slot = WALL_SLOT[mat]
    colour = _col(c, f'mass {mid}.wall.colour', wall.get('colour'), lk.wall_col)
    lk.wall_col = colour
    lk.trim_col = _col(c, f'mass {mid}.wall.trimColour', wall.get('trimColour'), lib.shade(colour, 1.08))
    acc = _col(c, f'mass {mid}.wall.accentColour', wall.get('accentColour'), None)
    if acc:
        lk.accent_col = acc
    lk.glass_col = _col(c, f'mass {mid}.wall.glassColour', wall.get('glassColour'), lk.glass_col)
    wshape = wall.get('windowShape')
    if wshape is not None and wshape not in SHAPE_KIND:
        c.w(f'mass {mid}.wall.windowShape {wshape!r} unknown (rect|arched|pointed|round)')
        wshape = None
    wkind = wall.get('windows', lk.windows if lk.windows else 'punched')
    if wkind not in WINDOW_KINDS:
        c.w(f'mass {mid}.wall.windows {wkind!r} unknown; using punched')
        wkind = 'punched'
    wkind = _kind(wkind, wshape)
    default_ratio = 0.65 if wkind == 'curtain' else 0.4
    ratio = _num(c, f'mass {mid}.wall.windowRatio', wall.get('windowRatio', default_ratio), default_ratio, 0.0, 0.92)
    lk.windows, lk.ratio = ('none' if wkind == 'plain' else wkind), ratio
    rmat = roof.get('material')
    if rmat is not None:
        if rmat not in ROOF_SLOT:
            c.w(f'mass {mid}.roof.material {rmat!r} is not a contract roof material; using metal-sheet')
            rmat = 'metal-sheet'
        lk.roof_slot = ROOF_SLOT[rmat]
    lk.roof_col = _col(c, f'mass {mid}.roof.colour', roof.get('colour'), lk.roof_col)

    faces = wall.get('faces') if isinstance(wall.get('faces'), dict) else {}
    groups = {}
    seg_kind = {}
    all_segs = []
    for seg in fp.edges():
        all_segs.append(seg)
        s = _side(seg)
        k = faces.get(s, wkind)
        if k not in WINDOW_KINDS:
            c.w(f'mass {mid}.wall.faces.{s} {k!r} unknown; using {wkind}')
            k = wkind
        k = _kind(k, None if s in faces else wshape)
        groups.setdefault('none' if k == 'plain' else k, []).append(seg)
        seg_kind[id(seg)] = 'none' if k == 'plain' else k
    b.section(f'mass:{mid}')
    bay = _num(c, f'mass {mid}.wall.bay', wall.get('bay', 0) or 0, 0, 0, 20) or None
    gk = wall.get('groundKind')
    gh = _num(c, f'mass {mid}.wall.groundHeight', wall.get('groundHeight', 0) or 0, 0, 0, 12) or None
    pats = _norm_patterns(wall.get('pattern'), lambda msg: c.w(f'mass {mid}: {msg}')) if wall.get('pattern') is not None else []
    if pats:
        gkind = _kind(gk, None) if gk in WINDOW_KINDS else None
        lib.build_walls(mb, all_segs, z0, H, storeys, lk, rng, lambda sg: seg_kind[id(sg)], ratio, bay,
                        (lambda sg: None if sg.rear else gkind), gh, pats)
    else:
        for k, segs in groups.items():
            lib.walls(mb, fp, z0, z0 + H, storeys, lk, rng, kind=k, ratio=ratio, rear='same', plinth=0, bay=bay, edges=segs,
                      ground_kind=_kind(gk, None) if gk in WINDOW_KINDS else None, ground_h=gh)
    plinth = _num(c, f'mass {mid}.wall.plinth', wall.get('plinth', 0.35), 0.35, 0, 4)
    if plinth > 0 and detail == 0:
        lib.sweep(mb, fp, z0, [(0.06, 0), (0.06, plinth), (0, plinth)], lk.wall_slot, lib.shade(lk.wall_col, 0.78))
    bands = wall.get('bands')
    if bands and detail == 0 and storeys > 1:
        bcol = bands if isinstance(bands, str) else (bands.get('colour') if isinstance(bands, dict) else None)
        bh = _num(c, f'mass {mid}.wall.bands.height', bands.get('height', 0.5) if isinstance(bands, dict) else 0.5, 0.5, 0.1, 2)
        bcol = _col(c, f'mass {mid}.wall.bands', bcol, lk.trim_col)
        for seg in fp.edges():
            for s in range(1, storeys):
                zz = z0 + H * s / storeys
                lib.seg_box(mb, seg, 0, seg.length, zz - bh / 2, zz + bh / 2, 0.08, bcol, lk.wall_slot)
    zt = z0 + H
    if wall.get('cornice') and detail == 0:
        lib.cornice(mb, fp, zt - 0.35, 0.5, 0.35, lk)

    # ---- roof
    form = roof.get('form', 'flat')
    if form not in ROOF_FORMS:
        c.w(f'mass {mid}.roof.form {form!r} unknown; using flat')
        form = 'flat'
    ov = _num(c, f'mass {mid}.roof.overhang', roof.get('overhang', 0.5 if form not in ('flat', 'curved', 'wave') else 0.0), 0.5, 0, 20)
    pitch = _num(c, f'mass {mid}.roof.pitch', roof.get('pitch', 28), 28, 3, 80)
    rise = roof.get('rise')
    rise = _num(c, f'mass {mid}.roof.rise', rise, 3, 0.2, 80) if rise is not None else None
    extra = {}
    for k in ('axis', 'profile', 'drum', 'lantern', 'finial', 'tiers', 'teeth', 'rows', 'cols', 'high', 'ribs'):
        if k in roof:
            extra[k] = roof[k]
    b.section(f'roof:{mid}')
    if form == 'none':
        pass
    elif form == 'flat':
        ph = _num(c, f'mass {mid}.roof.parapet', roof.get('parapet', 0.0), 0, 0, 3)
        lib.roof(mb, 'flat', fp, zt, lk, parapet_h=ph, ov=ov, slab=0.3 if ov > 0 else 0.0)
    else:
        rect_roof = fkind == 'rect' or (fkind == 'kind' and len(fp.rects) > 0 and len(fp.polys[0]) <= 12)
        rb, rect = mb, None
        if rect_roof:
            r = max(fp.rects, key=lambda q: (q[2] - q[0]) * (q[3] - q[1]))
            if form in ('curved', 'wave'):
                rect = ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, r[2] - r[0], r[3] - r[1])
        else:
            pts = fp.polys[0]
            cx, cy, w, d, ang = _obb(pts)
            fill = abs(_area(pts)) / max(1.0, w * d)
            if fill < 0.7:
                c.w(f'mass {mid}: roof {form} is fitted to the bounding rectangle of an irregular outline ({fill:.0%} filled)')
            rb = Xform(mb, (cx, cy, 0.0), ang)
            rect = (0.0, 0.0, w, d)
        if form in ('curved', 'wave'):
            if rect is None:
                r = fp.bbox
                rect = ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, r[2] - r[0], r[3] - r[1])
            _curved_roof(c, rb, mid, rect, zt, lk, dict(roof, form=form), detail, rng, lk.glass_col)
        else:
            fp2 = fp if rect_roof else lib.fp_rect(rect[2], rect[3])
            try:
                lib.roof(rb, form, fp2, zt, lk, rise=rise, pitch=pitch, ov=ov, **extra)
            except TypeError as exc:
                c.w(f'mass {mid}: roof {form} rejected an option ({exc}); built without extras')
                lib.roof(rb, form, fp2, zt, lk, rise=rise, pitch=pitch, ov=ov)
    if wall.get('parapet') and form != 'flat':
        lib.parapet(mb, fp, zt, _num(c, f'mass {mid}.wall.parapet', wall['parapet'], 0.8, 0.2, 3), 0.3, lk)

    xs = [p[0] for p in fp.polys[0]]
    ys = [p[1] for p in fp.polys[0]]
    ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    wp = [(ax + x * ca - y * sa, ay + x * sa + y * ca) for x in (min(xs), max(xs)) for y in (min(ys), max(ys))]
    info['masses'][mid] = {'at': (ax, ay), 'top': zt, 'bbox': (min(p[0] for p in wp), min(p[1] for p in wp), max(p[0] for p in wp), max(p[1] for p in wp))}
    info['lk'] = info.get('lk') or lk


# ------------------------------------------------------------------------------------------------------------------ parts
def _part(c, b, lk, p, idx, base, detail, info):
    pid = p.get('type')
    if isinstance(p.get('lod'), list) and detail not in p['lod']:
        return   # `lod`: [0, 1] draws this part only at those levels of detail
    fn = parts.REGISTRY.get(pid)
    if fn is None:
        c.w(f'unknown part type {pid!r} skipped (see parts/list.py)')
        return
    at = list(_xy(c, f'{pid}#{idx}.at', p.get('at')))
    rot = _num(c, f'{pid}#{idx}.rotDeg', p.get('rotDeg', 0.0), 0, -360, 360)
    on = p.get('on')
    if on is not None:
        mi = info['masses'].get(on)
        if mi is None:
            c.w(f'{pid}#{idx}: on={on!r} is not a mass id; ignored')
        else:
            at = [at[0] + mi['at'][0], at[1] + mi['at'][1], at[2] + mi['top']]
    params = p.get('params') if isinstance(p.get('params'), dict) else {}
    if p.get('params') is not None and not isinstance(p.get('params'), dict):
        c.w(f'{pid}#{idx}: params must be an object')
    for k in p:
        if k not in ('type', 'id', 'at', 'rotDeg', 'params', 'on', 'note', 'notes', 'lod'):
            c.w(f'{pid}#{idx}: unknown key {k!r} ignored (put part options inside "params")')
    known = parts.declared_params(pid)
    clean = {}
    for k, v in params.items():
        if k in parts.STD_ARGS:
            c.w(f'{pid}#{idx}: param {k!r} is reserved, ignored')
            continue
        if known and k not in known:
            c.w(f'{pid}#{idx}: {k!r} is not a parameter of {pid} (known: {", ".join(known)})')
        clean[k] = v
    b.section(f'{pid}#{idx}')
    before = b.tris
    try:
        fn(b, copy.copy(lk), _seed(base, 1000 + idx), detail, at=tuple(at), rot=rot, **clean)
    except Exception as exc:  # noqa: BLE001 - a bad part must not lose the building
        tb = traceback.extract_tb(exc.__traceback__)[-1]
        c.w(f'part {pid}#{idx} failed: {type(exc).__name__}: {exc} ({Path(tb.filename).name}:{tb.lineno})')
        return
    for w in getattr(b, 'part_warnings', []) or []:
        c.w(f'{pid}#{idx}: {w}')
    if hasattr(b, 'part_warnings'):
        b.part_warnings = []
    if detail == 0 and b.tris - before > 9000:
        c.w(f'part {pid}#{idx} costs {b.tris - before} triangles at LOD0')


# ------------------------------------------------------------------------------------------------------------------ site
def _site(c, b, lk, site, info, base, detail):
    if not isinstance(site, dict):
        site = {}
    ms = list(info['masses'].values())
    if ms:
        bx0, by0 = min(m['bbox'][0] for m in ms), min(m['bbox'][1] for m in ms)
        bx1, by1 = max(m['bbox'][2] for m in ms), max(m['bbox'][3] for m in ms)
    else:
        bx0 = by0 = -10.0
        bx1 = by1 = 10.0
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    ext = site.get('extent')
    if isinstance(ext, (list, tuple)) and len(ext) >= 2:
        ew, ed = _num(c, 'site.extent[0]', ext[0], 100, 10, 160), _num(c, 'site.extent[1]', ext[1], 80, 10, 160)
    else:
        ew, ed = min(160.0, (bx1 - bx0) + 36), min(160.0, (by1 - by0) + 40)
    gx0, gx1, gy0, gy1 = cx - ew / 2, cx + ew / 2, cy - ed / 2, cy + ed / 2
    srng = random.Random(base ^ 0x5173)
    ground = site.get('ground')
    if ground is not None and ground not in GROUND_SLOT:
        c.w(f'site.ground {ground!r} unknown; using the city style ground')
        ground = None
    if ground:
        lk.ground_slot, lk.ground_col = GROUND_SLOT[ground], GROUND_COL[ground]
    gcol = _col(c, 'site.groundColour', site.get('groundColour'), lk.ground_col)
    b.section('site')
    lib.ground(b, gx0, gy0, gx1, gy1, lk, lk.ground_slot, gcol, z=-0.02)
    fc = site.get('forecourt', 'none')
    if fc not in ('parking', 'plaza', 'garden', 'road', 'water', 'none'):
        c.w(f'site.forecourt {fc!r} unknown')
        fc = 'none'
    if fc != 'none':
        depth = _num(c, 'site.forecourtDepth', site.get('forecourtDepth', 16), 16, 4, 60)
        fy1 = by0 - 0.5
        fy0 = max(gy0 + 1, fy1 - depth)
        lib.forecourt(b, fc, max(gx0 + 1, bx0 - 6), fy0, min(gx1 - 1, bx1 + 6), fy1, lk, srng, density=float(site.get('density', 1.0) or 1.0))
    trees = site.get('trees', 0)
    kind_default = lk.tree if lk.tree not in (None, 'none') else 'broadleaf'
    items = []
    if isinstance(trees, int):
        n = int(_num(c, 'site.trees', trees, 0, 0, 60, ))
        tk = site.get('treeKind') or kind_default
        for k in range(n):
            for _ in range(20):
                x, y = srng.uniform(gx0 + 2, gx1 - 2), srng.uniform(gy0 + 2, gy1 - 2)
                if not (bx0 - 3 < x < bx1 + 3 and by0 - 3 < y < by1 + 3):
                    break
            items.append({'kind': tk, 'at': [x, y]})
    elif isinstance(trees, list):
        items = [t for t in trees if isinstance(t, dict)][:80]
    for t in items:
        x, y, _ = _xy(c, 'site.trees[].at', t.get('at'))
        kind = t.get('kind') or kind_default
        if kind not in ('palm', 'broadleaf', 'acacia', 'conifer', 'none'):
            c.w(f'site.trees: unknown kind {kind!r}')
            continue
        h = _num(c, 'site.trees[].height', t.get('height', 7 + srng.random() * 3), 8, 2, 40)
        lib.tree(b, kind, x, y, h, srng, lk)
    for ci, car in enumerate(site.get('cars') or []):
        if isinstance(car, dict) and detail < 2:
            x, y, _ = _xy(c, 'site.cars[].at', car.get('at'))
            lib.car(b, x, y, math.radians(_num(c, 'site.cars[].yawDeg', car.get('yawDeg', 0), 0, -360, 360)), _col(c, 'site.cars[].colour', car.get('colour'), '#b8bcc2'), srng)


# ------------------------------------------------------------------------------------------------------------------ arrays of masses
def _expand_arrays(c, plist):
    """`array` parts whose `of` holds masses become copies of those masses (placement as in the array part); other items stay."""
    from parts import _generic as pg
    out = []
    for p in plist:
        if not (isinstance(p, dict) and p.get('type') == 'array' and isinstance(p.get('params'), dict)):
            out.append(p)
            continue
        params = p['params']
        items = params.get('of')
        items = items if isinstance(items, list) else [items]
        mass_items = [it for it in items if isinstance(it, dict) and it.get('type') == 'mass']
        if not mass_items:
            out.append(p)
            continue
        rest = [it for it in items if not (isinstance(it, dict) and it.get('type') == 'mass')]
        if rest:
            q = copy.deepcopy(p)
            q['params']['of'] = rest
            out.append(q)
        ax, ay, az = _xy(c, 'array.at', p.get('at'))
        rota = _num(c, 'array.rotDeg', p.get('rotDeg', 0.0), 0, -360, 360)
        ca, sa = math.cos(math.radians(rota)), math.sin(math.radians(rota))
        plc, skip, vary = pg.placements_from_params(params, c.w, 0)
        for (x, y, z, yaw, t, i) in plc:
            if i in skip:
                continue
            cy_, sy_ = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
            for item in mass_items:
                m = copy.deepcopy(item)
                at = item.get('at') if isinstance(item.get('at'), (list, tuple)) and len(item['at']) >= 2 else [0, 0]
                lx = x + cy_ * float(at[0]) - sy_ * float(at[1])
                ly = y + sy_ * float(at[0]) + cy_ * float(at[1])
                m['at'] = [ax + ca * lx - sa * ly, ay + sa * lx + ca * ly]
                m['rotDeg'] = rota + yaw + float(item.get('rotDeg', 0.0) or 0.0)
                m['z0'] = float(item.get('z0', 0.0) or 0.0) + az + z
                m['id'] = f"{item.get('id') or 'arr'}-{i}"
                for k, (v0, v1) in vary.items():
                    if k in ('height', 'z0', 'storeys'):
                        m[k] = v0 + (v1 - v0) * t
                out.append(m)
    return out


# ------------------------------------------------------------------------------------------------------------------ entry
def build(spec, style, rng, detail, facts=None):
    global last_warnings
    c = Ctx()
    base = rng.getrandbits(64)
    style = style or {}
    last_warnings = c.warn   # same list: whatever was collected survives an exception
    plist = spec.get('parts') if isinstance(spec, dict) else None
    if not isinstance(plist, list) or not plist:
        raise ValueError('spec.parts must be a non-empty list')
    if len(plist) > MAX_PARTS:
        c.w(f'{len(plist)} parts: only the first {MAX_PARTS} are built')
        plist = plist[:MAX_PARTS]
    plist = _expand_arrays(c, plist)
    masses = [p for p in plist if isinstance(p, dict) and p.get('type') == 'mass'][:MAX_MASSES]
    others = [p for p in plist if isinstance(p, dict) and p.get('type') != 'mass']
    if not masses:
        c.w('spec has no mass: only free-standing parts')
    first = masses[0] if masses else {}
    fw, fr = (first.get('wall') or {}), (first.get('roof') or {})
    site = spec.get('site') if isinstance(spec.get('site'), dict) else {}
    brief_like = {'facade': {'material': fw.get('material') if fw.get('material') in WALL_SLOT else None, 'colours': [fw['colour']] if _col(c, 'wall.colour', fw.get('colour')) else [],
                             'roofColour': fr.get('colour') if _col(c, 'roof.colour', fr.get('colour')) else None, 'windows': fw.get('windows') if fw.get('windows') in WINDOW_KINDS else 'punched',
                             'windowRatio': fw.get('windowRatio', 0.4)},
                  'setting': {'ground': site.get('ground') if site.get('ground') in GROUND_SLOT else None, 'forecourt': site.get('forecourt', 'none'),
                              'trees': (site.get('trees')[0].get('kind') if isinstance(site.get('trees'), list) and site.get('trees') and isinstance(site['trees'][0], dict) else site.get('treeKind'))}}
    brief_like['setting'] = {k: v for k, v in brief_like['setting'].items() if v}
    lk = lib.look(brief_like, style, random.Random(base ^ 0xA11))
    b = lib.Builder('place', detail)
    info = {'masses': {}}
    for i, m in enumerate(masses):
        _mass(c, b, lk, m, i, base, facts, detail, info)
    if info.get('lk') is not None:
        lk.wall_col, lk.trim_col, lk.wall_slot = info['lk'].wall_col, info['lk'].trim_col, info['lk'].wall_slot
        lk.roof_col, lk.roof_slot = info['lk'].roof_col, info['lk'].roof_slot
    for i, p in enumerate(others):
        _part(c, b, lk, p, i, base, detail, info)
    _site(c, b, lk, site, info, base, detail)
    if info['masses']:
        xs0 = min(m['bbox'][0] for m in info['masses'].values())
        xs1 = max(m['bbox'][2] for m in info['masses'].values())
        ys0 = min(m['bbox'][1] for m in info['masses'].values())
        ys1 = max(m['bbox'][3] for m in info['masses'].values())
        if max(xs1 - xs0, ys1 - ys0) > 120:
            c.w(f'masses span {max(xs1 - xs0, ys1 - ys0):.0f} m: the contract clamp is 120 m for building and site together')
    lib.Builder.last = b   # parts that use temporary Builders must not hide this one from the worker's triangle breakdown
    return b.objects()
