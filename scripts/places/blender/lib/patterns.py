"""Facade patterns for mass walls and prisms: `wall.pattern` = one object or a list of objects, each `{"type": ..., "faces": [...], ...}`.

  floors     colours=[a, b, ...] (wall colour per storey, cycling), offset=0
  bands      colours / colour, height=0.6, proud=0.08, at=0 (0 floor line .. 1 top of the storey), floors=all|upper|[idx], skipGround
  fins       width=0.25, depth=0.45, spacing=1.8, colour / colours (alternate), from=0, to=last storey, margin=0.4, skipGround=false
  louvres    colour, backColour, pitch=0.3, depth=0.22, band=0.55 (fraction of a storey), at=0.2, floors, margin=0.5
  panels     size=[1.2, 0.9] (or cols/rows), colours=[2-3], mode=random|checker|stripes-h|stripes-v, gap=0, proud=0.03,
             slits={fraction, colour, width, height}, floors, weights   (cladding; use windows "none" on that face, or slits)
  arcade     shape=arch|pointed|rect, bay=4.2, opening=0.62 (fraction of the bay), height=0.86 (crown, fraction of the storey), depth=0.6, storeys=1
  pilotis    inset=3, spacing=5, width=0.9, kind=square|round, colour, backColour, storeys=1   (recessed ground floor on columns)
  balconies  depth=1.5, rail=1.05, width=2.6, every=3.6, slab=0.2, railKind=glass|solid, colour, railColour, floors=upper|all|[idx], continuous
`faces`: any of front, back, left, right (default all). Walls shorter than `minWall` (2 m) are left plain. Cost control: LOD1 draws flat
colour quads (bands, fins, louvre backing, coarse panels, simple balconies), LOD2 keeps only per-storey colours (floors/average panel colour).
"""
import math
import re

from .core import mix, shade
from .facade import _punched_bay, _wall, facade, seg_box
from .shapes import cylinder

HEX = re.compile(r'^#[0-9a-fA-F]{6}$')
TYPES = {
    'floors': {'colours', 'offset'},
    'bands': {'colours', 'colour', 'height', 'proud', 'at', 'floors', 'skipGround'},
    'fins': {'width', 'depth', 'spacing', 'colour', 'colours', 'from', 'to', 'margin', 'skipGround'},
    'louvres': {'colour', 'backColour', 'pitch', 'depth', 'band', 'at', 'floors', 'margin'},
    'panels': {'size', 'cols', 'rows', 'colours', 'mode', 'gap', 'proud', 'slits', 'floors', 'weights', 'seed', 'skipGround'},
    'arcade': {'shape', 'bay', 'opening', 'height', 'depth', 'storeys', 'colour', 'pierColour'},
    'pilotis': {'inset', 'spacing', 'width', 'kind', 'colour', 'backColour', 'storeys'},
    'balconies': {'depth', 'rail', 'width', 'every', 'slab', 'railKind', 'colour', 'railColour', 'floors', 'continuous'},
}
COMMON = {'type', 'faces', 'minWall'}
SIDES = ('front', 'back', 'left', 'right')


def normalise(patterns, warn):
    """-> list of cleaned pattern dicts (unknown types / keys / bad colours reported through warn, never raised)."""
    if patterns is None:
        return []
    if isinstance(patterns, dict):
        patterns = [patterns]
    if not isinstance(patterns, list):
        warn('wall.pattern must be an object or a list of objects')
        return []
    out = []
    for i, p in enumerate(patterns[:8]):
        if not isinstance(p, dict) or p.get('type') not in TYPES:
            warn(f'wall.pattern[{i}]: type must be one of {", ".join(TYPES)}')
            continue
        t = p['type']
        q = {}
        for k, v in p.items():
            if k not in TYPES[t] and k not in COMMON:
                warn(f'wall.pattern[{i}] ({t}): unknown key {k!r} ignored')
                continue
            if k in ('colour', 'backColour', 'railColour', 'pierColour') and not (isinstance(v, str) and HEX.match(v)):
                warn(f'wall.pattern[{i}].{k}: {v!r} is not a #rrggbb colour, ignored')
                continue
            if k == 'colours':
                if not isinstance(v, list) or not v or not all(isinstance(c, str) and HEX.match(c) for c in v):
                    warn(f'wall.pattern[{i}].colours: needs a list of #rrggbb colours, ignored')
                    continue
            if k == 'faces':
                v = [f for f in (v if isinstance(v, list) else [v]) if f in SIDES or f in ('sides', 'all')]
            q[k] = v
        out.append(q)
    return out


def _fa(b, pts, slot='plain', col=None, **kw):
    """b.face; the flat-colour `plain` slot is fitted (never cut at 1 m tile borders)."""
    if slot == 'plain' and 'mode' not in kw:
        kw['mode'] = 'fit'
    return b.face(pts, slot, col, **kw)


def _fc(b, pts, hint, slot='plain', col=None, **kw):
    if slot == 'plain' and 'mode' not in kw:
        kw['mode'] = 'fit'
    return b.facing(pts, hint, slot, col, **kw)


def _f(p, key, default, lo=-1e9, hi=1e9):
    try:
        v = float(p.get(key, default))
        if v != v:
            raise ValueError
    except (TypeError, ValueError):
        v = float(default)
    return max(lo, min(hi, v))


def side_of(seg):
    nx, ny = seg.n
    if abs(ny) >= abs(nx):
        return 'front' if ny < 0 else 'back'
    return 'right' if nx > 0 else 'left'


def _applies(p, side):
    f = p.get('faces')
    if not f or 'all' in f:
        return True
    if side in f:
        return True
    return 'sides' in f and side in ('left', 'right')


def _hash(*xs):
    h = 2166136261
    for x in xs:
        h = ((h ^ (int(x) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
        h ^= h >> 15
        h = (h * 2246822519) & 0xFFFFFFFF
    return h


def _pick_floors(p, n):
    f = p.get('floors', 'all')
    if f == 'all':
        return set(range(n))
    if f == 'upper':
        return set(range(1, n))
    if isinstance(f, list):
        return {int(i) for i in f if isinstance(i, (int, float))}
    return set(range(n))


def _quad(b, seg, u0, u1, z0, z1, d, col, slot='plain'):
    if u1 - u0 < 1e-4 or z1 - z0 < 1e-4:
        return
    _fa(b, [seg.P(u0, z0, d), seg.P(u1, z0, d), seg.P(u1, z1, d), seg.P(u0, z1, d)], slot, col)


def _slab(b, seg, u0, u1, z0, z1, proud, col, detail, slot='plain', full=True):
    """A shallow box on the wall: front + top (+ sides when full) at LOD0, front only at LOD1."""
    d = -proud
    _quad(b, seg, u0, u1, z0, z1, d, col, slot)
    if detail >= 1:
        return
    _fc(b, [seg.P(u0, z1, d), seg.P(u1, z1, d), seg.P(u1, z1, 0), seg.P(u0, z1, 0)], (0, 0, 1), slot, shade(col, 1.08))
    if full:
        _fc(b, [seg.P(u0, z0, d), seg.P(u0, z1, d), seg.P(u0, z1, 0), seg.P(u0, z0, 0)], (-seg.u[0], -seg.u[1], 0), slot, shade(col, 0.88))
        _fc(b, [seg.P(u1, z0, d), seg.P(u1, z1, d), seg.P(u1, z1, 0), seg.P(u1, z0, 0)], (seg.u[0], seg.u[1], 0), slot, shade(col, 0.88))


# ------------------------------------------------------------------------------------------------------------------ overlays
def _bands(b, seg, p, zs, look, first=0):
    if b.detail >= 2:
        return
    cols = p.get('colours') or [p.get('colour') or look.trim_col]
    hgt, proud, at = _f(p, 'height', 0.6, 0.05, 6), _f(p, 'proud', 0.08, 0.01, 1.5), _f(p, 'at', 0.0, 0, 1)
    sel = {i for i in _pick_floors(p, len(zs)) if i >= first}
    if p.get('skipGround'):
        sel.discard(0)
    for si, (zb, zt) in enumerate(zs):
        if si not in sel:
            continue
        zc = zb + at * (zt - zb)
        z0, z1 = max(zs[0][0], zc - hgt / 2), min(zs[-1][1], zc + hgt / 2)
        _slab(b, seg, 0, seg.length, z0, z1, proud, cols[si % len(cols)], b.detail, look.wall_slot if b.detail == 0 else 'plain', full=False)


def _fins(b, seg, p, zs, look, first=0):
    if b.detail >= 2:
        return
    w, depth, spacing = _f(p, 'width', 0.25, 0.05, 3), _f(p, 'depth', 0.45, 0.03, 3), _f(p, 'spacing', 1.8, 0.3, 30)
    margin = _f(p, 'margin', 0.4, 0, 20)
    cols = p.get('colours') or [p.get('colour') or look.trim_col]
    i0 = max(first, int(_f(p, 'from', 1 if p.get('skipGround') else 0, 0, 60)))
    i1 = int(_f(p, 'to', len(zs) - 1, 0, 60))
    i0, i1 = min(i0, len(zs) - 1), min(max(i1, i0), len(zs) - 1)
    z0, z1 = zs[i0][0], zs[i1][1]
    L = seg.length
    n = int((L - 2 * margin) / spacing) + 1
    if n < 1 or L - 2 * margin <= 0:
        return
    n = min(n, 140 if b.detail == 0 else 60)
    step = spacing if n * spacing <= L - 2 * margin + spacing else (L - 2 * margin) / max(1, n - 1)
    start = (L - (n - 1) * step) / 2
    for k in range(n):
        u = start + k * step
        c = cols[k % len(cols)]
        u0, u1 = u - w / 2, u + w / 2
        if b.detail >= 1:
            _quad(b, seg, u0, u1, z0, z1, -min(depth, 0.2), c)
            continue
        d = -depth
        _quad(b, seg, u0, u1, z0, z1, d, c)
        _fc(b, [seg.P(u0, z0, d), seg.P(u0, z1, d), seg.P(u0, z1, 0), seg.P(u0, z0, 0)], (-seg.u[0], -seg.u[1], 0), look.wall_slot, shade(c, 0.88))
        _fc(b, [seg.P(u1, z0, d), seg.P(u1, z1, d), seg.P(u1, z1, 0), seg.P(u1, z0, 0)], (seg.u[0], seg.u[1], 0), look.wall_slot, shade(c, 0.88))
        _fc(b, [seg.P(u0, z1, d), seg.P(u1, z1, d), seg.P(u1, z1, 0), seg.P(u0, z1, 0)], (0, 0, 1), look.wall_slot, shade(c, 1.08))


def _louvres(b, seg, p, zs, look, first=0):
    if b.detail >= 2:
        return
    col = p.get('colour') or look.accent_col
    back = p.get('backColour') or '#2b2e33'
    pitch, depth = _f(p, 'pitch', 0.3, 0.1, 2), _f(p, 'depth', 0.22, 0.03, 1.5)
    frac, at = _f(p, 'band', 0.55, 0.1, 1), _f(p, 'at', 0.2, 0, 0.9)
    margin = _f(p, 'margin', 0.5, 0, 20)
    sel = {i for i in _pick_floors(p, len(zs)) if i >= first}
    u0, u1 = margin, seg.length - margin
    if u1 - u0 < 0.5:
        return
    for si, (zb, zt) in enumerate(zs):
        if si not in sel:
            continue
        h = zt - zb
        a, c = zb + at * h, zb + at * h + frac * h
        c = min(c, zt - 0.1)
        if b.detail >= 1:
            _quad(b, seg, u0, u1, a, c, -0.05, mix(col, back, 0.45))
            continue
        _quad(b, seg, u0, u1, a, c, -0.04, back)
        n = max(1, min(40, int((c - a) / pitch)))
        for k in range(n):
            zz = a + (k + 0.5) * (c - a) / n
            th = 0.05
            _fc(b, [seg.P(u0, zz - th, -depth), seg.P(u1, zz - th, -depth), seg.P(u1, zz + th, -depth), seg.P(u0, zz + th, -depth)], seg.N3(), look.wall_slot, col)
            _fc(b, [seg.P(u0, zz + th, -depth), seg.P(u1, zz + th, -depth), seg.P(u1, zz + th, 0), seg.P(u0, zz + th, 0)], (0, 0, 1), look.wall_slot, shade(col, 1.1))


def _panels(b, seg, p, zs, look, first=0):
    if b.detail >= 2:
        return
    cols = p.get('colours') or [look.accent_col, look.trim_col]
    mode = p.get('mode', 'random')
    size = p.get('size') or [1.2, 0.9]
    try:
        pw, ph = float(size[0]), float(size[1])
    except (TypeError, ValueError, IndexError):
        pw, ph = 1.2, 0.9
    pw, ph = max(0.25, pw), max(0.25, ph)
    L = seg.length
    if p.get('cols'):
        pw = L / max(1, int(_f(p, 'cols', 8, 1, 400)))
    gap = _f(p, 'gap', 0.0, 0, 0.5)
    proud = _f(p, 'proud', 0.03, 0.005, 0.5)
    sel = {i for i in _pick_floors(p, len(zs)) if i >= first}
    if p.get('skipGround'):
        sel.discard(0)
    weights = p.get('weights')
    slits = p.get('slits') if isinstance(p.get('slits'), dict) else None
    seed = int(_f(p, 'seed', 0, 0, 1e6)) + int(abs(seg.p0[0]) * 10) * 31 + int(abs(seg.p0[1]) * 10) * 17
    budget = 420 if b.detail == 0 else 110
    rows_total = sum(max(1, round((zt - zb) / ph)) for si, (zb, zt) in enumerate(zs) if si in sel)
    cols_n = max(1, round(L / pw))
    k = math.sqrt(max(1.0, rows_total * cols_n / budget))
    if k > 1:
        cols_n = max(1, round(cols_n / k))
    pw = L / cols_n
    gi = 0
    for si, (zb, zt) in enumerate(zs):
        if si not in sel:
            continue
        rn = max(1, round((zt - zb) / ph / (k if k > 1 else 1)))
        rh = (zt - zb) / rn
        for r in range(rn):
            z0, z1 = zb + r * rh, zb + (r + 1) * rh
            idx = []
            for c in range(cols_n):
                if mode == 'checker':
                    ci = (c + r + si) % len(cols)
                elif mode == 'stripes-h':
                    ci = (r + si) % len(cols)
                elif mode == 'stripes-v':
                    ci = c % len(cols)
                elif weights and len(weights) == len(cols):
                    x = (_hash(seed, c, r, si) % 10000) / 10000.0 * sum(weights)
                    ci, acc = 0, 0.0
                    for q, wq in enumerate(weights):
                        acc += wq
                        if x <= acc:
                            ci = q
                            break
                else:
                    ci = _hash(seed, c, r, si) % len(cols)
                idx.append(ci)
            c = 0
            while c < cols_n:
                e = c
                while gap == 0 and e + 1 < cols_n and idx[e + 1] == idx[c]:
                    e += 1
                _quad(b, seg, c * pw + gap / 2, (e + 1) * pw - gap / 2, z0 + gap / 2, z1 - gap / 2, -proud, cols[idx[c]])
                c = e + 1
            if slits:
                frac = _f(slits, 'fraction', 0.12, 0, 1)
                sc = slits.get('colour') if isinstance(slits.get('colour'), str) and HEX.match(slits.get('colour')) else '#262a30'
                sw, sh = _f(slits, 'width', 0.35, 0.05, 0.9), _f(slits, 'height', 0.8, 0.1, 0.95)
                for c in range(cols_n):
                    if (_hash(seed + 99, c, r, si) % 1000) < frac * 1000:
                        uc, zc = (c + 0.5) * pw, (z0 + z1) / 2
                        _quad(b, seg, uc - sw * pw / 2, uc + sw * pw / 2, zc - sh * rh / 2, zc + sh * rh / 2, -(proud + 0.015), sc, 'glass-punched' if b.detail == 0 else 'plain')
            gi += 1


def _balconies(b, seg, p, zs, look, first=0):
    if b.detail >= 2:
        return
    depth, rail = _f(p, 'depth', 1.5, 0.3, 6), _f(p, 'rail', 1.05, 0.2, 2.5)
    slab = _f(p, 'slab', 0.2, 0.05, 0.6)
    every = _f(p, 'every', 3.6, 1.0, 40)
    width = min(_f(p, 'width', 2.6, 0.8, 40), every - 0.3)
    col = p.get('colour') or look.trim_col
    rcol = p.get('railColour') or shade(col, 0.85)
    kind = p.get('railKind', 'glass')
    sel = set(range(1, len(zs))) if p.get('floors', 'upper') == 'upper' else _pick_floors(p, len(zs))
    sel = {i for i in sel if i >= first}
    L = seg.length
    if p.get('continuous'):
        runs = [(0.3, L - 0.3)]
    else:
        n = max(1, int(L / every))
        runs = [((k + 0.5) * L / n - width / 2, (k + 0.5) * L / n + width / 2) for k in range(n)]
        if len(runs) > 24:
            runs = runs[:24]
    for si, (zb, zt) in enumerate(zs):
        if si not in sel:
            continue
        for u0, u1 in runs:
            if u1 - u0 < 0.5:
                continue
            d = -depth
            # slab: top, front edge, (LOD0) sides
            _fc(b, [seg.P(u0, zb + 0.02, d), seg.P(u1, zb + 0.02, d), seg.P(u1, zb + 0.02, 0), seg.P(u0, zb + 0.02, 0)], (0, 0, 1), look.wall_slot, col)
            _quad(b, seg, u0, u1, zb - slab, zb + 0.02, d, shade(col, 0.9), look.wall_slot if b.detail == 0 else 'plain')
            if b.detail == 0:
                for uu, sgn in ((u0, -1), (u1, 1)):
                    _fc(b, [seg.P(uu, zb - slab, d), seg.P(uu, zb + 0.02, d), seg.P(uu, zb + 0.02, 0), seg.P(uu, zb - slab, 0)], (sgn * seg.u[0], sgn * seg.u[1], 0), look.wall_slot, shade(col, 0.8))
                _fc(b, [seg.P(u0, zb - slab, d), seg.P(u1, zb - slab, d), seg.P(u1, zb - slab, 0), seg.P(u0, zb - slab, 0)], (0, 0, -1), look.wall_slot, shade(col, 0.7))
            # railing
            slot_r = 'glass-ribbon' if (kind == 'glass' and b.detail == 0) else 'plain'
            colr = look.glass_col if (kind == 'glass' and b.detail == 0) else rcol
            _quad(b, seg, u0, u1, zb + 0.02, zb + 0.02 + rail, d + 0.03, colr, slot_r)
            if b.detail == 0:
                for uu, sgn in ((u0, -1), (u1, 1)):
                    _fc(b, [seg.P(uu, zb + 0.02, d + 0.03), seg.P(uu, zb + 0.02 + rail, d + 0.03), seg.P(uu, zb + 0.02 + rail, 0), seg.P(uu, zb + 0.02, 0)], (sgn * seg.u[0], sgn * seg.u[1], 0), 'plain', rcol)
                _fc(b, [seg.P(u0, zb + 0.02 + rail, d + 0.03), seg.P(u1, zb + 0.02 + rail, d + 0.03), seg.P(u1, zb + 0.02 + rail, d), seg.P(u0, zb + 0.02 + rail, d)], (0, 0, 1), 'plain', shade(rcol, 1.1))


# ------------------------------------------------------------------------------------------------------------------ ground storey
def _arcade(b, seg, p, zb, zt, look, wall_col):
    shape = p.get('shape', 'arch')
    shape = {'arch': 'arch', 'arched': 'arch', 'round': 'arch', 'pointed': 'pointed', 'rect': 'rect'}.get(shape, 'arch')
    L, h = seg.length, zt - zb
    bay = _f(p, 'bay', 4.2, 1.2, 30)
    nb = max(1, round(L / bay))
    bw = L / nb
    ow = min(bw - 0.5, bw * _f(p, 'opening', 0.62, 0.2, 0.95))
    top = zb + h * _f(p, 'height', 0.86, 0.4, 0.98)
    if shape != 'rect':
        top = max(top, zb + 1.0 + (ow * (0.5 if shape == 'arch' else 0.866)))
    top = min(top, zt - 0.05)
    depth = _f(p, 'depth', 0.6, 0.1, 3)
    col = p.get('pierColour') or wall_col
    for k in range(nb):
        u0, u1 = k * bw, (k + 1) * bw
        c = (u0 + u1) / 2
        _punched_bay(b, seg, look, u0, u1, zb, zt, c - ow / 2, c + ow / 2, zb, top, shape, depth, b.detail == 0, 'glass-punched', look.wall_slot, col,
                     arch_n=6 if b.detail == 0 else 3, frame=False)


def _pilotis(b, seg, p, zb, zt, look, wall_col):
    L = seg.length
    inset = _f(p, 'inset', 3.0, 0.5, 12)
    spacing = _f(p, 'spacing', 5.0, 1.5, 30)
    cw = _f(p, 'width', 0.9, 0.2, 3)
    colour = p.get('colour') or look.dark_col
    back = p.get('backColour') or look.glass_col
    n = max(1, round(L / spacing))
    step = L / n
    _fa(b, [seg.P(0, zb, inset), seg.P(L, zb, inset), seg.P(L, zt, inset), seg.P(0, zt, inset)], 'glass-shopfront', back)
    _fc(b, [seg.P(0, zt, 0), seg.P(L, zt, 0), seg.P(L, zt, inset), seg.P(0, zt, inset)], (0, 0, -1), 'plain', shade(wall_col, 0.62))
    for k in range(n + 1):
        u = k * step
        uc = min(max(u, cw / 2), L - cw / 2)
        if p.get('kind') == 'round':
            cx, cy, _ = seg.P(uc, 0, cw / 2)
            cylinder(b, cx, cy, zb, zt, cw / 2, n=8 if b.detail == 0 else 5, slot=look.wall_slot, col=colour, smooth=True, top=False)
        else:
            seg_box(b, seg, uc - cw / 2, uc + cw / 2, zb, zt, 0.0, colour, look.wall_slot, inset=cw)


# ------------------------------------------------------------------------------------------------------------------ walls
def storey_bounds(z0, H, storeys, ground_h=None):
    storeys = max(1, int(storeys))
    if ground_h and storeys > 1:
        rest = (H - ground_h) / (storeys - 1)
        hs = [ground_h] + [rest] * (storeys - 1)
    else:
        hs = [H / storeys] * storeys
    out, z = [], z0
    for h in hs:
        out.append((z, z + h))
        z += h
    return out


def build_walls(b, edges, z0, H, storeys, look, rng, kind_of, ratio, bay, ground_kind, ground_h, patterns, base_col=None):
    """Walls for `edges` (Segs of a footprint) with facade patterns. kind_of(seg) -> window kind of that wall."""
    zs = storey_bounds(z0, H, storeys, ground_h)
    ns = len(zs)
    wcol = base_col or look.wall_col
    for seg in edges:
        side = side_of(seg)
        kind = kind_of(seg)
        ground_kind_s = ground_kind(seg) if callable(ground_kind) else ground_kind
        pats = [p for p in patterns if _applies(p, side) and seg.length >= _f(p, 'minWall', 2.0, 0, 50)]
        if not pats:
            facade(b, seg, z0, z0 + H, storeys, look, kind, ratio, rng, bay, ground_kind=ground_kind_s, ground_h=ground_h)
            continue
        floors = next((p for p in pats if p['type'] == 'floors'), None)
        ground = next((p for p in pats if p['type'] in ('arcade', 'pilotis')), None)
        eff = wcol
        panelp = next((p for p in pats if p['type'] == 'panels'), None)
        if panelp and b.detail >= 2:
            cl = panelp.get('colours') or [look.accent_col, look.trim_col]
            eff = cl[0]
            for c in cl[1:]:
                eff = mix(eff, c, 1.0 / (cl.index(c) + 1))
        s0 = 0
        if ground and b.detail < 2:
            s0 = int(min(ns, max(1, _f(ground, 'storeys', 1, 1, 4))))
            if s0 > 0:
                zb, zt = zs[0][0], zs[s0 - 1][1]
                if ground['type'] == 'arcade':
                    _arcade(b, seg, ground, zb, zt, look, wcol)
                else:
                    _pilotis(b, seg, ground, zb, zt, look, wcol)
        off = int(_f(floors, 'offset', 0, 0, 20)) if floors else 0
        fcols = floors.get('colours') if floors else None
        if fcols is None and floors:
            fcols = [wcol]
        si = s0
        while si < ns:
            c = fcols[(si + off) % len(fcols)] if fcols else eff
            if fcols:
                facade(b, seg, zs[si][0], zs[si][1], 1, look, kind, ratio, rng, bay, wall_col=c,
                       ground_kind=ground_kind_s if si == 0 else None, ground_h=None)
                si += 1
            else:
                facade(b, seg, zs[si][0], zs[-1][1], ns - si, look, kind, ratio, rng, bay, wall_col=c,
                       ground_kind=ground_kind_s if si == 0 else None, ground_h=ground_h if si == 0 else None)
                si = ns
        if b.detail >= 2:
            continue
        for p in pats:
            t = p['type']
            if t == 'bands':
                _bands(b, seg, p, zs, look, s0)
            elif t == 'fins':
                _fins(b, seg, p, zs, look, s0)
            elif t == 'louvres':
                _louvres(b, seg, p, zs, look, s0)
            elif t == 'panels':
                _panels(b, seg, p, zs, look, s0)
            elif t == 'balconies':
                _balconies(b, seg, p, zs, look, s0)
