"""Shared helpers for the sacred-building archetypes (mosque-domed, mosque-sahelian, temple-asian, shrine-small).

Private module: not an archetype. Archetype modules put their own directory on sys.path and `import _mosque_domed_util as U`.
Everything here is deterministic and takes the rng explicitly. Metres, +Z up, main facade towards -Y.
"""
import importlib
import math
import random
import re

import lib
from lib import mix, shade

TAU = math.tau
_F = importlib.import_module('lib.facade')  # `lib.facade` the attribute is the function; the module is only reachable this way


# --------------------------------------------------------------------------------------------------------------- brief parsing
def feats(brief):
    """{feature id: {'count': total count over duplicate entries, 'note': joined notes}}"""
    out = {}
    for f in (brief.get('features') or []):
        if isinstance(f, dict):
            fid, cnt, note = f.get('id'), f.get('count', 1), str(f.get('note') or '')
        else:
            fid, cnt, note = f, 1, ''
        if not fid:
            continue
        try:
            cnt = int(cnt)
        except Exception:
            cnt = 1
        e = out.setdefault(fid, {'count': 0, 'note': ''})
        e['count'] += max(0, cnt)
        e['note'] = (e['note'] + ' ' + note).strip()
    return out


def text(brief, style=None, extra=()):
    parts = [brief.get('name', ''), brief.get('subject', ''), brief.get('notes', ''), brief.get('style', ''), brief.get('era', ''),
             (brief.get('form') or {}).get('variant', '')]
    parts += [e['note'] for e in feats(brief).values()]
    if style:
        parts += [style.get('city', '')]
    parts += list(extra)
    return ' '.join(str(p) for p in parts if p).lower()


def has_word(txt, *words):
    return any(re.search(r'\b' + w, txt) for w in words)


def era_year(brief):
    m = re.search(r'(1[0-9]{3}|20[0-9]{2})', str(brief.get('era', '')))
    return int(m.group(1)) if m else None


def last_metres(note, lo=3.0, hi=200.0):
    """The last 'NN m' in a note (e.g. 'about 80 m'), or None."""
    found = [float(x) for x in re.findall(r'(\d+(?:\.\d+)?)\s*(?:m\b|metre|meter)', note or '')]
    found = [v for v in found if lo <= v <= hi]
    return found[-1] if found else None


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def num(v, default):
    try:
        return float(v)
    except Exception:
        return default


def form_of(brief):
    f = brief.get('form') or {}
    return {
        'w': num(f.get('width_m'), 30.0), 'd': num(f.get('depth_m'), 24.0), 'h': num(f.get('height_m'), 0.0),
        'storeys': int(num(f.get('storeys'), 1)), 'roof': f.get('roof') or 'flat', 'fp': f.get('footprint') or 'rect',
        'variant': str(f.get('variant') or '').lower(), 'wings': int(num(f.get('wings'), 0)),
    }


def goldish(hexstr):
    r, g, b = lib.rgb(hexstr)
    return r > 0.62 and 0.45 < g < 0.85 and b < 0.5 and r > g > b


def greenish(hexstr):
    r, g, b = lib.rgb(hexstr)
    return g > r * 1.1 and g > b * 1.05


def luma(hexstr):
    r, g, b = lib.rgb(hexstr)
    return 0.3 * r + 0.59 * g + 0.11 * b


def nn(b, n0):
    """Segment count by detail."""
    return {0: n0, 1: max(6, int(n0 * 0.5)), 2: max(4, int(n0 * 0.3))}[b.detail]


def sub(rng):
    return random.Random(rng.getrandbits(64))


def pick_w_r(x, options):
    """Weighted pick from options = [(value, weight)] using a uniform number x in [0, 1)."""
    tot = sum(w for _, w in options)
    x *= tot
    for v, w in options:
        x -= w
        if x <= 0:
            return v
    return options[-1][0]


def pick_w(r, options):
    """Weighted pick; options = [(value, weight)]."""
    tot = sum(w for _, w in options)
    x = r.random() * tot
    for v, w in options:
        x -= w
        if x <= 0:
            return v
    return options[-1][0]


# --------------------------------------------------------------------------------------------------------------- surfaces of revolution
def revolve(b, cx, cy, z0, prof, n, slot, col, smooth=True, scale=1.0, cap=True, cap_col=None, flute=None, ry=1.0, a0=0.0, a1=TAU):
    """Surface of revolution through prof = [(r, dz), ...] listed from the bottom up. Faces outward. flute=(m, amp) ripples the
    radius with m lobes (melon / lotus domes). ry scales the y radius (elliptical plans). a0..a1 sweeps part of the circle (half domes);
    a partial sweep is not wrapped and has no cap."""
    full = abs((a1 - a0) - TAU) < 1e-6
    angs = [a0 + (a1 - a0) * k / n for k in range(n + 1)]
    m, amp = flute if flute else (0, 0.0)
    grid = []
    for a in angs:
        ca, sa = math.cos(a), math.sin(a)
        f = 1.0 + amp * math.cos(m * a) if m else 1.0
        grid.append([(cx + r * f * ca, cy + r * ry * f * sa, z0 + h) for (r, h) in prof])
    b.shared_grid(grid, slot, col, smooth=smooth, wrap=full, scale=scale)
    if cap and full and prof[-1][0] > 1e-6:
        r, h = prof[-1]
        pts = [(cx + r * math.cos(a), cy + r * ry * math.sin(a), z0 + h) for a in angs[:-1]]
        b.facing(pts, (0, 0, 1), slot, cap_col or col, scale=scale)


def ring_loft(b, rings, slot, col, smooth=False, scale=1.0, cols=None, close_top=False, top_col=None):
    """Quads between consecutive rings (lists of 3D points, counter-clockwise from above, equal length)."""
    for k in range(len(rings) - 1):
        a, c = rings[k], rings[k + 1]
        m = len(a)
        cl = cols[k] if cols else col
        for i in range(m):
            j = (i + 1) % m
            b.face([a[i], a[j], c[j], c[i]], slot, cl, scale=scale, smooth=smooth)
    if close_top:
        b.facing(rings[-1], (0, 0, 1), slot, top_col or col)


def rect_ring(cx, cy, w, d, z, rot=0.0):
    c, s = math.cos(rot), math.sin(rot)
    return [(cx + c * x - s * y, cy + s * x + c * y, z) for (x, y) in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]


def poly_ring(cx, cy, r, n, z, rot=0.0, ry=None):
    ry = r if ry is None else ry
    return [(cx + r * math.cos(rot + TAU * k / n), cy + ry * math.sin(rot + TAU * k / n), z) for k in range(n)]


def frustum(b, cx, cy, z0, z1, w0, d0, w1, d1, slot, col, top=True, top_slot=None, top_col=None, rot=0.0, scale=1.0, smooth=False):
    """Square/rectangular tapering block (a mud tower, a stage of a pagoda base...)."""
    ring0, ring1 = rect_ring(cx, cy, w0, d0, z0, rot), rect_ring(cx, cy, w1, d1, z1, rot)
    ring_loft(b, [ring0, ring1], slot, col, scale=scale, smooth=smooth)
    if top and w1 > 1e-6:
        b.facing(ring1, (0, 0, 1), top_slot or slot, top_col or col, scale=scale)


def cone(b, cx, cy, z0, z1, r, n, slot, col, smooth=True):
    lib.cylinder(b, cx, cy, z0, z1, r, n=n, slot=slot, col=col, r_top=0.0, top=False, smooth=smooth)


def pinnacle(b, x, y, z, r, h, col, n=6, slot='mud-render', base=0.0, ball=False):
    """A cone (optionally on a short plinth) used for horn-like Hausa pinnacles, finials and merlons."""
    if base > 0:
        lib.cylinder(b, x, y, z, z + base, r * 1.0, n=n, slot=slot, col=col, top=False)
    if b.detail >= 2:
        n = 4
    lib.cylinder(b, x, y, z + base, z + base + h, r, n=n, slot=slot, col=col, r_top=0.0 if not ball else r * 0.3, top=False, smooth=False)
    if ball and b.detail == 0:
        revolve(b, x, y, z + base + h - 0.05, [(r * 0.35, 0), (r * 0.45, r * 0.3), (r * 0.3, r * 0.7), (0, r * 0.9)], 6, slot, col, smooth=True)


def tubs(prof_pairs):
    return prof_pairs


# --------------------------------------------------------------------------------------------------------------- domes
def _prof(kind, rings):
    """Dome outline as [(r/R, h/H)] from base to apex (R base radius, H height)."""
    ts = [j / rings for j in range(rings + 1)]
    if kind == 'hemi':
        return [(math.cos(t * math.pi / 2), math.sin(t * math.pi / 2)) for t in ts]
    if kind == 'shallow':
        return [(math.cos(t * math.pi / 2), math.sin(t * math.pi / 2)) for t in ts]
    if kind == 'pointed':   # Ottoman lead dome, slightly stilted and pointed
        return [(math.cos(t * math.pi / 2) ** 0.9, math.sin(t * math.pi / 2) ** 1.25) for t in ts]
    if kind == 'bulb':      # Persian / Timurid: swells beyond its base then closes to a point
        out = []
        for t in ts:
            a = t * math.pi * 0.98
            rr = (1.0 + 0.16 * math.sin(a * 0.9)) * (1 - t ** 2.2) ** 0.6
            out.append((rr, t ** 0.85))
        return out
    if kind == 'onion':     # Mughal / South Asian
        pts = [(1.0, 0.0), (1.12, 0.12), (1.16, 0.27), (1.02, 0.43), (0.7, 0.6), (0.36, 0.77), (0.13, 0.9), (0.04, 0.97), (0.0, 1.0)]
        return pts
    if kind == 'ogee':
        return [(1.0, 0.0), (1.04, 0.18), (0.86, 0.38), (0.52, 0.55), (0.24, 0.7), (0.12, 0.85), (0.0, 1.0)]
    if kind == 'lotus':     # Sikh fluted dome on an inverted lotus
        return [(0.92, 0.0), (1.0, 0.09), (1.05, 0.22), (1.0, 0.4), (0.82, 0.58), (0.55, 0.74), (0.26, 0.88), (0.1, 0.96), (0.0, 1.0)]
    return [(math.cos(t * math.pi / 2), math.sin(t * math.pi / 2)) for t in ts]


def dome(b, cx, cy, z, r, h, kind, slot, col, n=None, rings=None, flute=None, base_ring=False, base_col=None):
    """A smooth dome of base radius r and height h. kind: hemi|shallow|pointed|bulb|onion|ogee|lotus."""
    n = n or nn(b, 24)
    rings = rings or {0: 8, 1: 4, 2: 3}[b.detail]
    if kind == 'shallow':
        h = h * 0.6
    pp = _prof(kind, rings)
    if len(pp) > rings + 3:
        pp = [pp[int(round(i * (len(pp) - 1) / rings))] for i in range(rings + 1)]
    prof = [(r * rf, h * hf) for rf, hf in pp]
    revolve(b, cx, cy, z, prof, n, slot, col, smooth=True, scale=1.5, flute=flute if b.detail == 0 else None)
    if base_ring and b.detail == 0:
        lib.cylinder(b, cx, cy, z - 0.05, z + 0.18, r * 1.04, n=n, slot='plain-render', col=base_col or shade(col, 1.2), top=False)


def drum(b, cx, cy, z0, h, r, n, slot, col, window_col=None, windows=0, win_w=None, win_h=None, ring=True, trim=None):
    """A cylindrical drum with optional pointed windows round it and a cornice ring. Returns the drum top z."""
    n = max(8, n // 2 * 2) if b.detail < 2 else 8
    lib.cylinder(b, cx, cy, z0, z0 + h, r, n=n, slot=slot, col=col, top=False)
    if b.detail == 0:
        if windows:
            ww = win_w or min(1.4, TAU * r / windows * 0.45)
            wh = win_h or h * 0.55
            rr = r * math.cos(math.pi / n) + 0.03
            for k in range(windows):
                a = TAU * (k + 0.5) / windows
                ca, sa = math.cos(a), math.sin(a)
                tx, ty = -sa, ca
                zb = z0 + (h - wh) * 0.45
                pts = [(cx + rr * ca - tx * ww / 2, cy + rr * sa - ty * ww / 2, zb), (cx + rr * ca + tx * ww / 2, cy + rr * sa + ty * ww / 2, zb),
                       (cx + rr * ca + tx * ww / 2, cy + rr * sa + ty * ww / 2, zb + wh * 0.78), (cx + rr * ca, cy + rr * sa, zb + wh),
                       (cx + rr * ca - tx * ww / 2, cy + rr * sa - ty * ww / 2, zb + wh * 0.78)]
                b.face(pts, 'glass-punched', window_col or '#e8eef2')
        if ring:
            lib.cylinder(b, cx, cy, z0 + h - 0.22, z0 + h, r * 1.07, n=n, slot='plain-render', col=trim or shade(col, 1.12), top=False)
            lib.cylinder(b, cx, cy, z0 + h, z0 + h + 0.12, r * 1.1, n=n, slot='plain-render', col=trim or shade(col, 1.12), top=False)
    return z0 + h


def finial(b, cx, cy, z, h, col, balls=3, r=0.3):
    """Spike with stacked balls (and a thin tip)."""
    if b.detail >= 1:
        lib.cylinder(b, cx, cy, z, z + h, max(0.12, r * 0.5), n=4, slot='plain', col=col, r_top=0.0, top=False, smooth=False)
        return
    lib.cylinder(b, cx, cy, z, z + h, max(0.05, r * 0.2), n=5, slot='frame', col=col, r_top=0.02, top=False)
    for k in range(balls):
        rr = r * (1.0 - 0.22 * k)
        zz = z + h * (0.18 + 0.2 * k)
        revolve(b, cx, cy, zz - rr, [(0.0, 0.0), (rr * 0.8, rr * 0.3), (rr, rr), (rr * 0.8, rr * 1.7), (0.0, rr * 2.0)], 6 if b.detail else 8,
                'plain', col, smooth=True, cap=False)


# --------------------------------------------------------------------------------------------------------------- walls and openings
def wall_seg(x0, y0, x1, y1):
    """lib.Seg for a wall going from (x0, y0) to (x1, y1); its outside is on the RIGHT of travel."""
    return lib.Seg((x0, y0), (x1, y1))


def arch_openings(b, seg, lk, z0, z1, n, shape='pointed', ow=None, oh=None, depth=0.5, col=None, slot=None, glass_col=None, sill=None, crown_gap=0.5,
                  glass_slot='glass-punched'):
    """A wall panel (z0..z1) with n evenly spaced arched openings (real reveals at LOD0, flat glazing at LOD1, plain at LOD2).
    shape pointed|arch|rect. sill = bottom of the openings (default: z0 + 0.0 for arcade, or pass a height)."""
    col = col or lk.wall_col
    slot = slot or lk.wall_slot
    L = seg.length
    if b.detail >= 2 or n <= 0:
        _F._wall(b, seg, 0, L, z0, z1, slot, col)
        return
    if b.detail == 1:
        n = max(1, (n + 1) // 2)
    bw = L / n
    oh = oh or (z1 - z0) * 0.62
    sl = z0 + (z0 * 0 if sill is None else sill)
    top = min(z1 - crown_gap, sl + oh)
    ow = ow or bw * 0.55
    rf = 0.866 if shape == 'pointed' else (0.5 if shape == 'arch' else 0.0)
    if rf:
        ow = max(0.6, min(ow, (top - sl - 0.35) / rf))
    cut = b.detail == 0
    gc = glass_col or lk.glass_col
    for k in range(n):
        u0, u1 = k * bw, (k + 1) * bw
        c = (u0 + u1) / 2
        ou0, ou1 = c - ow / 2, c + ow / 2
        _F._punched_bay(b, seg, lk, u0, u1, z0, z1, ou0, ou1, sl, top, shape, depth, cut, glass_slot, slot, col, arch_n=4, frame=False)
        if not cut:
            pass


def plain_wall(b, seg, z0, z1, lk, slot=None, col=None, scale=1.0):
    _F._wall(b, seg, 0, seg.length, z0, z1, slot or lk.wall_slot, col or lk.wall_col, scale=scale)


def crenellate(b, x0, y0, x1, y1, z, col, h=0.6, w=0.5, pitch=1.1, thick=0.35, slot='plain-render', skip_front=False, step_n=None):
    """Merlons along a rectangle's perimeter standing on a parapet whose top is z."""
    if b.detail >= 1:
        return
    sides = [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
    for si, (p, q) in enumerate(sides):
        if skip_front and si == 0:
            pass
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        n = max(1, int(L / pitch))
        ux, uy = (q[0] - p[0]) / L, (q[1] - p[1]) / L
        for k in range(n):
            u = (k + 0.5) * L / n
            cx, cy = p[0] + ux * u, p[1] + uy * u
            lib.obox(b, cx, cy, z, w, thick, h, math.atan2(uy, ux), slot, col, skip=('bottom', 'front', 'back') if False else ('bottom',))


def railing(b, p0, p1, z, h, col, post=0.12, pitch=0.9, rail=0.1):
    """A simple balustrade along p0 -> p1 (posts and a top rail), LOD0 only; LOD1 a thin box."""
    if b.detail >= 2:
        return
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    if L < 0.1:
        return
    if b.detail == 1:
        lib.beam(b, p0, p1, z, z + h, 0.12, 'plain-render', col)
        return
    n = max(1, int(L / pitch))
    ux, uy = (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L
    for k in range(n + 1):
        t = k * L / n
        lib.box_c(b, p0[0] + ux * t, p0[1] + uy * t, z, post, post, h, 'plain-render', col, skip=('bottom',))
    lib.beam(b, p0, p1, z + h - rail, z + h, rail * 1.4, 'plain-render', col)


# --------------------------------------------------------------------------------------------------------------- site
def compound_wall(b, lk, x0, y0, x1, y1, col, h=2.0, t=0.35, gate=None, gate_w=4.0, pier_col=None, front_open=False, slot='plain-render',
                  pinnacles=None):
    """Boundary wall round (x0..x1, y0..y1). gate = x of a gateway gap in the FRONT (-Y) wall (None: no gap). Piers beside the gate."""
    with b.site():
        return _compound_wall(b, lk, x0, y0, x1, y1, col, h, t, gate, gate_w, pier_col, front_open, slot)


def _compound_wall(b, lk, x0, y0, x1, y1, col, h, t, gate, gate_w, pier_col, front_open, slot):
    pc = pier_col or shade(col, 1.08)
    cap = pc
    segs = []
    # front wall (y0): split around the gate
    if front_open:
        pass
    elif gate is None:
        segs.append(('x', y0, x0, x1))
    else:
        segs.append(('x', y0, x0, gate - gate_w / 2))
        segs.append(('x', y0, gate + gate_w / 2, x1))
    segs.append(('x', y1, x0, x1))
    segs.append(('y', x0, y0, y1))
    segs.append(('y', x1, y0, y1))
    for kind, c, a, bb in segs:
        if bb - a < 0.2:
            continue
        if kind == 'x':
            lib.box(b, a, c - t / 2, 0, bb, c + t / 2, h, slot, col, top_slot='roof-flat', top_col=cap, skip=('bottom', 'top') if False else ('bottom',))
        else:
            lib.box(b, c - t / 2, a, 0, c + t / 2, bb, h, slot, col, top_slot='roof-flat', top_col=cap, skip=('bottom',))
    if gate is not None and not front_open:
        for sx in (-1, 1):
            px = gate + sx * (gate_w / 2 + 0.2)
            lib.box_c(b, px, y0, 0, 0.9, 0.9, h + 0.9, slot, pc)
            if b.detail == 0:
                lib.box_c(b, px, y0, h + 0.9, 1.1, 1.1, 0.18, slot, shade(pc, 1.1))
                pinnacle(b, px, y0, h + 1.08, 0.38, 0.7, pc, n=6, slot=slot)


def site_pad(b, lk, x0, y0, x1, y1):
    lib.ground(b, x0, y0, x1, y1, lk)


def front_apron(b, lk, srng, kind, x0, x1, y_building, y_pad, tree_kind, tree_h=7.0, density=1.0):
    """The strip in front of the building from y_pad (outer) to y_building: forecourt kind from the brief."""
    kind = kind if kind in ('parking', 'plaza', 'garden', 'road', 'water') else 'plaza'
    depth = y_building - y_pad
    if depth < 3:
        return
    if kind == 'road':
        road_d = min(8.0, depth * 0.5)
        lib.forecourt(b, 'road', x0, y_pad, x1, y_pad + road_d, lk, srng)
        if depth - road_d > 2:
            lib.forecourt(b, 'plaza', x0, y_pad + road_d + 0.5, x1, y_building, lk, srng)
    else:
        lib.forecourt(b, kind, x0, y_pad, x1, y_building, lk, srng, density=density, tree_h=tree_h)


def trees_ring(b, lk, srng, kind, rect_in, rect_out, count, h=7.0, avoid=()):
    """Scatter `count` trees between the inner and outer rectangles (deterministic; always draws the same random numbers)."""
    ix0, iy0, ix1, iy1 = rect_in
    ox0, oy0, ox1, oy1 = rect_out
    for k in range(count):
        a, c, d = srng.random(), srng.random(), srng.random()
        side = k % 4
        if side == 0:
            x, y = ox0 + (ox1 - ox0) * a, iy1 + 1.5 + (oy1 - iy1 - 3.0) * c
        elif side == 1:
            x, y = ox0 + 1.5 + (ix0 - ox0 - 3.0) * a, oy0 + (oy1 - oy0) * c
        elif side == 2:
            x, y = ix1 + 1.5 + (ox1 - ix1 - 3.0) * a, oy0 + (oy1 - oy0) * c
        else:
            x, y = ox0 + (ox1 - ox0) * a, oy0 + (iy0 - oy0) * c
        if any(ax0 <= x <= ax1 and ay0 <= y <= ay1 for (ax0, ay0, ax1, ay1) in avoid):
            continue
        if kind and kind != 'none':
            lib.tree(b, kind, x, y, h * (0.8 + 0.4 * d), srng, lk)


def fit_scale(w, d, front=14.0, back=6.0, side=6.0, limit=118.0):
    """Horizontal scale (<=1) so that extent + site margins stay inside the contract clamp."""
    sw = (limit - 2 * side) / max(w, 1e-6)
    sd = (limit - front - back) / max(d, 1e-6)
    return min(1.0, sw, sd)


def steps_front(b, x0, x1, y_face, z_top, n, depth, col, slot='paving'):
    if z_top < 0.05:
        return
    lib.steps(b, x0, x1, y_face, z_top, depth, n, slot, col)


def hexagram(b, cx, y, cz, r, col):
    """A flat six-pointed star (two triangles) on a wall at y facing -Y."""
    if b.detail >= 2:
        return
    for sgn in (1, -1):
        pts = [(cx + r * math.cos(math.pi / 2 * sgn + TAU * k / 3), y, cz + r * math.sin(math.pi / 2 * sgn + TAU * k / 3)) for k in range(3)]
        b.facing(pts, (0, -1, 0), 'plain', col)


def gable_y(b, x0, y0, x1, y1, z, rise, slot, col, gslot, gcol, scale=3.0, ov=0.0):
    """Gable roof with the ridge along Y (over x0..x1), coarse tiling so long roofs stay cheap; gable ends filled."""
    xm = (x0 + x1) / 2
    for (xa, hint) in ((x0, (-rise, 0, (x1 - x0) / 2)), (x1, (rise, 0, (x1 - x0) / 2))):
        eave = z - ov * rise / max((x1 - x0) / 2, 0.1)
        b.facing([(xa + (-ov if xa == x0 else ov), y0 - ov, eave), (xa + (-ov if xa == x0 else ov), y1 + ov, eave), (xm, y1 + ov, z + rise), (xm, y0 - ov, z + rise)], hint, slot, col, scale=scale)
    b.facing([(x0, y0, z), (x1, y0, z), (xm, y0, z + rise)], (0, -1, 0), gslot, gcol)
    b.facing([(x0, y1, z), (x1, y1, z), (xm, y1, z + rise)], (0, 1, 0), gslot, gcol)


# ---------------------------------------------------------------------------------------------------------------- shared roof kit (from temple-asian)
TAU = math.tau
def rect_pts(cx, cy, hw, hd):
    return [(cx - hw, cy - hd), (cx + hw, cy - hd), (cx + hw, cy + hd), (cx - hw, cy + hd)]


def curved_hip(b, D, cx, cy, z, w, d, rise, ov, up, slot, col, fascia_col=None, p=1.55, ridge=True, fascia=0.3, ridge_col=None):
    """Chinese/Japanese hip roof: concave slopes, eaves swept up at the corners. Eave rectangle is (w + 2 ov) x (d + 2 ov) at height z,
    the ridge is `rise` above. Returns the top z."""
    m = {0: 8, 1: 4, 2: 1}[b.detail] if b.detail < 2 else 1
    rings = {0: 6, 1: 3, 2: 1}[b.detail]
    hwe, hde = w / 2 + ov, d / 2 + ov
    rlx, rly = max(0.0, (w - d) / 2), max(0.0, (d - w) / 2)
    grid = []
    # perimeter points (CCW from the front-left corner), each side has m points (corner included, end excluded)
    per = []
    for side in range(4):
        for i in range(m):
            per.append((side, i / m))
    for (side, f) in per:
        col_pts = []
        for k in range(rings + 1):
            t = k / rings
            hw = hwe * (1 - t) + rlx * t
            hd = hde * (1 - t) + rly * t
            if side == 0:
                x, y, s = -hw + 2 * hw * f, -hd, abs(2 * f - 1)
            elif side == 1:
                x, y, s = hw, -hd + 2 * hd * f, abs(2 * f - 1)
            elif side == 2:
                x, y, s = hw - 2 * hw * f, hd, abs(2 * f - 1)
            else:
                x, y, s = -hw, hd - 2 * hd * f, abs(2 * f - 1)
            zz = z + rise * (t ** p) + up * (s ** 3) * ((1 - t) ** 1.6)
            col_pts.append((cx + x, cy + y, zz))
        grid.append(col_pts)
    grid.append(grid[0])
    b.shared_grid(grid, slot, col, smooth=False, wrap=True, scale=1.2)
    top = z + rise
    if b.detail < 2 and fascia > 0:
        outer = [g[0] for g in grid[:-1]]
        low = [(p_[0], p_[1], p_[2] - fascia) for p_ in outer]
        fascia_loft(b, [low, outer], D['wslot'], fascia_col or D['trim'])
    if ridge and rlx > 0.6 and b.detail < 2:
        rl = rlx
        lib.box(b, cx - rl, cy - 0.28, top - 0.05, cx + rl, cy + 0.28, top + 0.42, 'plain-render', ridge_col or shade(col, 0.8))
        if b.detail == 0:
            for sx in (-1, 1):   # raised ridge-end ornaments (chiwen)
                lib.box(b, cx + sx * rl - (0.2 if sx > 0 else 0.0) - (0.0 if sx > 0 else 0.0), cy - 0.2, top + 0.4, cx + sx * (rl + 0.35) + (0.0), cy + 0.2, top + 1.1,
                        'plain-render', ridge_col or shade(col, 0.8))
    elif ridge and rlx <= 0.6 and rly <= 0.6 and b.detail < 2:
        # a pyramidal top: finial
        cone(b, cx, cy, top, top + 0.9, 0.35, 6, 'plain-render', ridge_col or shade(col, 0.8), smooth=False)
    return top


def fascia_loft(b, rings, slot, col):
    """Quads between two rings given as perimeter point lists (counter-clockwise from above), ring[0] lower."""
    a, c = rings
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        b.face([a[i], a[j], c[j], c[i]], slot, col)




def nagara_ring(cx, cy, a, z, p=0.14, wc=0.3):
    pts = []
    for side in range(4):
        ang = side * math.pi / 2
        c, s = math.cos(ang), math.sin(ang)
        for (uu, vv) in ((-1.0, 0.0), (-wc, 0.0), (-wc, p), (wc, p), (wc, 0.0)):
            lx, ly = uu * a, -(a + vv * a)
            pts.append((cx + c * lx - s * ly, cy + s * lx + c * ly, z))
    return pts


