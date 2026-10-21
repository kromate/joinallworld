"""Roof builders for every roof form in the contract. All take a rect (x0, y0, x1, y1) in metres and the wall-top height z.

`roof(b, form, fp_or_rect, z, look, ...)` is the dispatcher (handles multi-wing footprints); the individual builders are public too.
Roof planes carry a thin underside at detail 0 so eaves are not see-through."""
import math

from .core import shade
from .shapes import Footprint, cap, cylinder, sweep, _miter

DEG = math.pi / 180


class _Rot:
    """Builds in a canonical frame (ridge/axis along +x, high side +y) and rotates by k*90 degrees about the rect centre."""

    def __init__(self, b, cx, cy, k):
        self.b, self.cx, self.cy, self.k = b, cx, cy, k % 4
        self.detail, self.flat = b.detail, b.flat

    def p(self, q):
        x, y = q[0], q[1]
        for _ in range(self.k):
            x, y = -y, x
        return (x + self.cx, y + self.cy, q[2])

    def h(self, v):
        x, y = v[0], v[1]
        for _ in range(self.k):
            x, y = -y, x
        return (x, y, v[2])

    def facing(self, pts, hint, slot, col, **kw):
        self.b.facing([self.p(q) for q in pts], self.h(hint), slot, col, **kw)

    def grid(self, grid, slot, col, **kw):
        self.b.shared_grid([[self.p(q) for q in row] for row in grid], slot, col, **kw)


def _canon(rect, k):
    x0, y0, x1, y1 = rect
    cx, cy, w, d = (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    if k % 2:
        w, d = d, w
    return cx, cy, w, d


def _plane(r, pts, hint, slot, col, ov, thick=0.14):
    """A roof plane plus (detail 0 with an overhang) its thin underside."""
    r.facing(pts, hint, slot, col)
    if r.detail == 0 and ov > 0:
        h = (-hint[0], -hint[1], -hint[2])
        n = math.sqrt(hint[0] ** 2 + hint[1] ** 2 + hint[2] ** 2) or 1
        lo = [(q[0] + h[0] / n * thick, q[1] + h[1] / n * thick, q[2] + h[2] / n * thick) for q in pts]
        r.facing(lo, h, 'plain-render', shade(col, 0.55))


# ------------------------------------------------------------------------------------------------ ring profile roofs
def _ring(rect, inset, z):
    x0, y0, x1, y1 = rect
    xa, xb = x0 + inset, x1 - inset
    ya, yb = y0 + inset, y1 - inset
    if xb < xa:
        xa = xb = (x0 + x1) / 2
    if yb < ya:
        ya = yb = (y0 + y1) / 2
    return [(xa, ya, z), (xb, ya, z), (xb, yb, z), (xa, yb, z)]


def roof_profile(b, rect, z, profile, look, cap_top=True, roof_slot=None, roof_col=None, wall_slot=None, wall_col=None):
    """Loft a rectangle through [(inset, dz), ...] rings: negative inset grows (eaves). Segments with no inset change are vertical
    (wall slot); others are roof surface. Covers hip, pyramid, mansard, stepped tiers, plinths. Closes the top with a flat cap."""
    rs, rc = roof_slot or look.roof_slot, roof_col or look.roof_col
    ws, wc = wall_slot or look.wall_slot, wall_col or look.wall_col
    rings = [_ring(rect, i, z + dz) for i, dz in profile]
    for k in range(len(profile) - 1):
        vertical = abs(profile[k][0] - profile[k + 1][0]) < 1e-6
        s, c = (ws, wc) if vertical else (rs, rc)
        for e in range(4):
            f = (e + 1) % 4
            b.face([rings[k][e], rings[k][f], rings[k + 1][f], rings[k + 1][e]], s, c)
    if cap_top:
        top = rings[-1]
        b.facing([(p[0], p[1], p[2]) for p in top], (0, 0, 1), rs, rc)


def hip(b, rect, z, rise, look, ov=0.5, **kw):
    x0, y0, x1, y1 = rect
    run = min(x1 - x0, y1 - y0) / 2
    roof_profile(b, rect, z, [(-ov, -rise * ov / run), (run, rise)], look, **kw)


def pyramidal(b, rect, z, rise, look, ov=0.4, **kw):
    hip(b, rect, z, rise, look, ov, **kw)


def mansard(b, rect, z, rise, look, ov=0.3, **kw):
    x0, y0, x1, y1 = rect
    run = min(x1 - x0, y1 - y0) / 2
    s1 = min(run * 0.22, 2.2)
    s2 = min(run * 0.35, 5.0)
    roof_profile(b, rect, z, [(-ov, -0.15), (0, 0), (s1, rise * 0.72), (s1 + s2, rise)], look, **kw)


def stepped(b, rect, z, rise, look, tiers=3, **kw):
    x0, y0, x1, y1 = rect
    run = min(x1 - x0, y1 - y0) / 2
    step = min(run * 0.6 / tiers, 6.0)
    h = rise / tiers
    prof = [(0, 0)]
    for t in range(tiers):
        prof += [(step * t, h * (t + 1)), (step * (t + 1), h * (t + 1))]
    roof_profile(b, rect, z, prof, look, **kw)


def pitch_rise(rect, pitch_deg, axis_along_x=True):
    x0, y0, x1, y1 = rect
    run = (y1 - y0) / 2 if axis_along_x else (x1 - x0) / 2
    return run * math.tan(pitch_deg * DEG)


# --------------------------------------------------------------------------------------------------------------- gable
def gable(b, rect, z, rise, look, axis='auto', ov=0.5, slot=None, col=None, gable_slot=None, gable_col=None, **_):
    """Gable roof. axis: 'x' (ridge parallel to x), 'y', or 'auto' (along the longer side)."""
    x0, y0, x1, y1 = rect
    k = {'x': 0, 'y': 1, 'auto': 0 if (x1 - x0) >= (y1 - y0) else 1}[axis]
    cx, cy, w, d = _canon(rect, k)
    r = _Rot(b, cx, cy, k)
    rs, rc = slot or look.roof_slot, col or look.roof_col
    gs, gc = gable_slot or look.wall_slot, gable_col or look.wall_col
    ax0, ax1, ay0, ay1 = -w / 2, w / 2, -d / 2, d / 2
    drop = ov * rise / (d / 2)
    _plane(r, [(ax0 - ov, ay0 - ov, z - drop), (ax1 + ov, ay0 - ov, z - drop), (ax1 + ov, 0, z + rise), (ax0 - ov, 0, z + rise)], (0, -rise, d / 2), rs, rc, ov)
    _plane(r, [(ax1 + ov, ay1 + ov, z - drop), (ax0 - ov, ay1 + ov, z - drop), (ax0 - ov, 0, z + rise), (ax1 + ov, 0, z + rise)], (0, rise, d / 2), rs, rc, ov)
    r.facing([(ax0, ay0, z), (ax0, ay1, z), (ax0, 0, z + rise)], (-1, 0, 0), gs, gc)
    r.facing([(ax1, ay0, z), (ax1, ay1, z), (ax1, 0, z + rise)], (1, 0, 0), gs, gc)


def shed(b, rect, z, rise, look, high='back', ov=0.4, slot=None, col=None, **_):
    """Single-slope roof rising towards `high` (back=+y, front=-y, left=-x, right=+x); the walls above the eave are filled."""
    x0, y0, x1, y1 = rect
    k = {'back': 0, 'left': 1, 'front': 2, 'right': 3}[high]
    cx, cy, w, d = _canon(rect, k)
    r = _Rot(b, cx, cy, k)
    rs, rc = slot or look.roof_slot, col or look.roof_col
    ax0, ax1, ay0, ay1 = -w / 2, w / 2, -d / 2, d / 2
    drop = ov * rise / d
    _plane(r, [(ax0 - ov, ay0 - ov, z - drop), (ax1 + ov, ay0 - ov, z - drop), (ax1 + ov, ay1 + ov, z + rise + drop), (ax0 - ov, ay1 + ov, z + rise + drop)], (0, -rise, d), rs, rc, ov)
    ws, wc = look.wall_slot, look.wall_col
    r.facing([(ax0, ay0, z), (ax0, ay1, z), (ax0, ay1, z + rise)], (-1, 0, 0), ws, wc)
    r.facing([(ax1, ay0, z), (ax1, ay1, z), (ax1, ay1, z + rise)], (1, 0, 0), ws, wc)
    r.facing([(ax0, ay1, z), (ax1, ay1, z), (ax1, ay1, z + rise), (ax0, ay1, z + rise)], (0, 1, 0), ws, wc)


# --------------------------------------------------------------------------------------------------------------- barrel
def barrel(b, rect, z, rise, look, axis='auto', ov=0.0, segments=None, slot=None, col=None, end_slot=None, end_col=None, pointed=False):
    """Barrel vault (circular segment) spanning the short side, running along the long side; `rise` is the crown height."""
    x0, y0, x1, y1 = rect
    k = {'x': 0, 'y': 1, 'auto': 0 if (x1 - x0) >= (y1 - y0) else 1}[axis]
    cx, cy, w, d = _canon(rect, k)
    r = _Rot(b, cx, cy, k)
    n = segments or {0: 12, 1: 6, 2: 4}[b.detail]
    R = (d * d / 4 + rise * rise) / (2 * rise)
    a0 = math.asin(min(1.0, d / 2 / R))
    arc = []
    for j in range(n + 1):
        t = -a0 + 2 * a0 * j / n
        arc.append((R * math.sin(t), z - (R - rise) + R * math.cos(t) - 0.0))
    ax0, ax1 = -w / 2 - ov, w / 2 + ov
    grid = [[(x, y, zz) for (y, zz) in arc] for x in (ax0, ax1)]
    r.grid(grid, slot or look.roof_slot, col or look.roof_col, smooth=True)
    es, ec = end_slot or look.wall_slot, end_col or look.wall_col
    if b.detail < 2 and not (R - rise) < 0:
        r.facing([(-w / 2, y, zz) for (y, zz) in arc], (-1, 0, 0), es, ec)
        r.facing([(w / 2, y, zz) for (y, zz) in arc], (1, 0, 0), es, ec)


# ---------------------------------------------------------------------------------------------------------------- domes
DOME_PROFILES = {
    'hemi': lambda t: (math.cos(t * math.pi / 2), math.sin(t * math.pi / 2)),
    'shallow': lambda t: (math.cos(t * math.pi / 2), 0.55 * math.sin(t * math.pi / 2)),
    'pointed': lambda t: (math.cos(t * math.pi / 2) ** 0.85, math.sin(t * math.pi / 2) ** 1.15),
    'onion': None,
}
_ONION = [(0.80, 0.0), (0.96, 0.10), (1.0, 0.24), (0.9, 0.40), (0.62, 0.58), (0.30, 0.75), (0.12, 0.88), (0.05, 0.96), (0.0, 1.0)]


def dome(b, cx, cy, z, r, look, height=None, profile='hemi', n=None, rings=None, slot=None, col=None, drum=0.0, drum_r=None,
         drum_slot=None, drum_col=None, lantern=0.0, finial=0.0, ribs=False):
    """Dome of base radius r on an optional drum (drum height metres). profile: hemi|shallow|pointed|onion. A lantern is a small
    drum + cap on top (metres of height); finial a thin spike. Smooth-shaded."""
    n = n or {0: 24, 1: 12, 2: 8}[b.detail]
    rings = rings or {0: 8, 1: 4, 2: 3}[b.detail]
    height = height or r * (1.0 if profile != 'onion' else 1.5)
    rs, rc = slot or look.roof_slot, col or look.roof_col
    zz = z
    if drum > 0:
        dr = drum_r or r
        cylinder(b, cx, cy, zz, zz + drum, dr, n=max(8, n // 2 * 2), slot=drum_slot or look.wall_slot, col=drum_col or look.wall_col, top=False)
        zz += drum
    if profile == 'onion':
        curve = [(r * rf, zz + height * zf) for rf, zf in _ONION]
    else:
        f = DOME_PROFILES.get(profile, DOME_PROFILES['hemi'])
        curve = []
        for j in range(rings + 1):
            c, s = f(j / rings)
            curve.append((r * c, zz + height * s))
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    grid = [[(cx + rr * math.cos(a), cy + rr * math.sin(a), zh) for rr, zh in curve] for a in angs]
    b.shared_grid(grid, rs, rc, smooth=True, wrap=True, scale=1.5)
    top = zz + height
    if lantern > 0 and b.detail < 2:
        lr = max(0.25, r * 0.12)
        cylinder(b, cx, cy, top - 0.05, top + lantern, lr, n=10, slot=look.wall_slot, col=look.trim_col, top=True)
        cylinder(b, cx, cy, top + lantern, top + lantern + lr * 1.6, lr * 1.2, n=10, slot=rs, col=rc, r_top=0.0)
        top += lantern + lr * 1.6
    if finial > 0:
        cylinder(b, cx, cy, top, top + finial, max(0.04, r * 0.015), n=6, slot='frame', col=look.metal_col, r_top=0.0)


def multi_dome(b, rect, z, rows, cols, look, r=None, **kw):
    x0, y0, x1, y1 = rect
    w, d = (x1 - x0) / cols, (y1 - y0) / rows
    rr = r or min(w, d) / 2 * 0.92
    for i in range(cols):
        for j in range(rows):
            dome(b, x0 + w * (i + 0.5), y0 + d * (j + 0.5), z, rr, look, **kw)


# ---------------------------------------------------------------------------------------------------------- tensile/sawtooth
def tensile(b, rect, z, rise, look, bays=(3, 1), slot='plain-render', col='#eeeeee', masts=True, mast_col='#9ea3a8'):
    """Tent-membrane roof: a grid of concave peaks (bays = (nx, ny)); masts at the peaks."""
    x0, y0, x1, y1 = rect
    nx, ny = bays
    w, d = (x1 - x0) / nx, (y1 - y0) / ny
    n = {0: 16, 1: 8, 2: 4}[b.detail]
    for i in range(nx):
        for j in range(ny):
            cx, cy = x0 + w * (i + 0.5), y0 + d * (j + 0.5)
            grid = []
            for k in range(n + 1):
                a = 2 * math.pi * k / n
                ca, sa = math.cos(a), math.sin(a)
                m = 1.0 / max(abs(ca), abs(sa))   # point on the rectangle boundary
                row = []
                for t in (0.0, 0.45, 0.75, 1.0):
                    f = 1 - t
                    row.append((cx + ca * m * (w / 2) * f, cy + sa * m * (d / 2) * f, z + rise * (t ** 2.4)))
                grid.append(row)
            b.shared_grid(grid, slot, col, smooth=True, wrap=True, scale=2.0)
            if masts and b.detail < 2:
                cylinder(b, cx, cy, z, z + rise + 2.5, 0.18, n=8, slot='frame', col=mast_col, r_top=0.1, top=True)


def sawtooth(b, rect, z, rise, look, teeth=4, axis='x', glaze='back', slot=None, col=None):
    """Sawtooth roof: `teeth` sloped planes each ending in a vertical glazed face. axis='x': teeth repeat along x, glazing faces +x."""
    x0, y0, x1, y1 = rect
    k = 0 if axis == 'x' else 1
    cx, cy, w, d = _canon(rect, k)
    if glaze == 'front':
        k += 2
    r = _Rot(b, cx, cy, k)
    rs, rc = slot or look.roof_slot, col or look.roof_col
    pitch = w / teeth
    for t in range(teeth):
        xa = -w / 2 + t * pitch
        xb = xa + pitch
        r.facing([(xa, -d / 2, z), (xb, -d / 2, z + rise), (xb, d / 2, z + rise), (xa, d / 2, z)], (-rise, 0, pitch), rs, rc)
        r.facing([(xb, -d / 2, z), (xb, d / 2, z), (xb, d / 2, z + rise), (xb, -d / 2, z + rise)], (1, 0, 0), look.glass_slot, look.glass_col, mode='fit')
        for side, hint in ((-d / 2, (0, -1, 0)), (d / 2, (0, 1, 0))):
            r.facing([(xa, side, z), (xb, side, z), (xb, side, z + rise)], hint, look.wall_slot, look.wall_col)


# ---------------------------------------------------------------------------------------------------------------- flat
def flat_roof(b, fp, z, look, parapet_h=0.0, ov=0.0, slab=0.3, col=None, slot=None, coping=True):
    """Flat roof over a whole Footprint at height z: roof surface (membrane), optional overhanging slab edge and parapet."""
    rs, rc = slot or 'roof-flat', col or look.roof_col
    cap(b, fp.polys, z, True, rs, rc, scale=2.0)
    if ov > 0 or slab > 0 and b.detail < 2:
        sweep(b, fp, z, [(0, -slab), (ov, -slab), (ov, 0), (0, 0)] if ov > 0 else [(0, -slab * 0.0), (0, 0)], look.wall_slot, look.trim_col)
    if parapet_h > 0:
        from .facade import parapet
        parapet(b, fp, z, parapet_h, 0.3, look)


def cone(b, cx, cy, z, r, rise, look, n=None, ov=0.4, slot=None, col=None):
    """Conical roof over a round/oval plan of radius r (eaves overhang ov)."""
    n = n or {0: 20, 1: 12, 2: 8}[b.detail]
    cylinder(b, cx, cy, z - rise * ov / max(r, 1e-6), z + rise, r + ov, n=n, slot=slot or look.roof_slot, col=col or look.roof_col, r_top=0.0, top=False, smooth=False)


def _extend(rect, main, amount):
    """Grow rect into the neighbouring main rect (which it touches) so cross-gables intersect the main roof."""
    x0, y0, x1, y1 = rect
    mx0, my0, mx1, my1 = main
    eps = 1e-3
    if abs(y0 - my1) < eps:
        y0 -= amount
    elif abs(y1 - my0) < eps:
        y1 += amount
    elif abs(x0 - mx1) < eps:
        x0 -= amount
    elif abs(x1 - mx0) < eps:
        x1 += amount
    return (x0, y0, x1, y1)


def _poly_area(poly):
    return abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2


def _poly_perimeter(poly):
    return sum(math.hypot(poly[(i + 1) % len(poly)][0] - poly[i][0], poly[(i + 1) % len(poly)][1] - poly[i][1]) for i in range(len(poly)))


def _is_round(fp):
    """Round or oval plan: many corners AND circularity 4*pi*A/P^2 above 0.9 (a real OSM outline or an H/U union is not)."""
    poly = fp.polys[0]
    per = _poly_perimeter(poly)
    return len(poly) > 10 and per > 0 and 4 * math.pi * _poly_area(poly) / (per * per) > 0.9


def _rects_cover(fp, tol=0.12):
    """True when fp.rects really decompose the outline (L/U/T/H/cross unions); false for free polygons whose `rects` is only the bbox."""
    if not fp.rects:
        return False
    ra = sum((q[2] - q[0]) * (q[3] - q[1]) for q in fp.rects)
    pa = sum(_poly_area(p) * (1 if i == 0 else -1) for i, p in enumerate(fp.polys))
    return pa > 0 and abs(ra - pa) / pa <= tol


def _obb(pts):
    """Minimum-area oriented rectangle of a polygon: (cx, cy, w, d, angle_deg), w the longer side, angle in (-90, 90]."""
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
    cx, cy = cu * math.cos(a) - cv * math.sin(a), cu * math.sin(a) + cv * math.cos(a)
    ang = math.degrees(a)
    if d > w:
        w, d = d, w
        ang += 90
    while ang > 90:
        ang -= 180
    while ang <= -90:
        ang += 180
    return cx, cy, w, d, ang


class _Place:
    """Builder proxy: everything is rotated `ang` degrees about the origin and moved to (cx, cy) (roofs over rotated rectangles)."""

    def __init__(self, b, cx, cy, ang):
        self.b, self.cx, self.cy = b, cx, cy
        self.c, self.s = math.cos(math.radians(ang)), math.sin(math.radians(ang))

    @property
    def detail(self):
        return self.b.detail

    @property
    def flat(self):
        return self.b.flat

    def T(self, p):
        return (self.cx + self.c * p[0] - self.s * p[1], self.cy + self.s * p[0] + self.c * p[1], p[2])

    def face(self, pts, slot='plain', col=None, **kw):
        return self.b.face([self.T(p) for p in pts], slot, col, **kw)

    def facing(self, pts, hint, slot='plain', col=None, **kw):
        return self.b.facing([self.T(p) for p in pts], (self.c * hint[0] - self.s * hint[1], self.s * hint[0] + self.c * hint[1], hint[2]), slot, col, **kw)

    def shared_grid(self, grid, slot, col, **kw):
        return self.b.shared_grid([[self.T(p) for p in row] for row in grid], slot, col, **kw)

    def site(self):
        return self.b.site()

    def section(self, label):
        return self.b.section(label)

    def __getattr__(self, name):
        return getattr(self.b, name)


def roof(b, form, fp, z, look, rise=None, pitch=28, ov=0.5, **kw):
    """Dispatcher. form: flat|gable|hip|shed|barrel|dome|multi-dome|tensile|sawtooth|pyramidal|mansard|stepped|none.
    fp: a Footprint (each wing rect gets a roof) or a single rect tuple. rise defaults from a `pitch` in degrees (or a sensible
    height for the form). Extra kwargs go to the builder (e.g. axis=, high=, tiers=, parapet_h=)."""
    if form in (None, 'none'):
        return
    rects = fp.rects if isinstance(fp, Footprint) else [fp]
    if isinstance(fp, Footprint) and form not in ('flat', 'dome', 'none') and len(fp.polys[0]) > 10:
        if _is_round(fp):
            # round / oval plan: a rectangle roof would overhang the curve, so use a cone
            x0, y0, x1, y1 = fp.bbox
            if form in ('gable', 'hip', 'pyramidal', 'mansard', 'stepped', 'shed'):
                cone(b, (x0 + x1) / 2, (y0 + y1) / 2, z, min(x1 - x0, y1 - y0) / 2, rise if rise is not None else min(x1 - x0, y1 - y0) / 2 * math.tan(pitch * DEG), look, ov=ov)
            else:
                flat_roof(b, fp, z, look, **kw)
            return
        if not _rects_cover(fp):
            # irregular outline (real OSM footprint): build the roof over its minimum-area rectangle, rotated to fit
            cx, cy, w, d, ang = _obb(fp.polys[0])
            from .shapes import fp_rect
            return roof(_Place(b, cx, cy, ang), form, fp_rect(w, d), z, look, rise=rise, pitch=pitch, ov=ov, **kw)
    elif isinstance(fp, Footprint) and form not in ('flat', 'dome', 'none') and not _rects_cover(fp):
        cx, cy, w, d, ang = _obb(fp.polys[0])
        from .shapes import fp_rect
        return roof(_Place(b, cx, cy, ang), form, fp_rect(w, d), z, look, rise=rise, pitch=pitch, ov=ov, **kw)
    if form == 'flat':
        if isinstance(fp, Footprint):
            flat_roof(b, fp, z, look, **kw)
        else:
            from .shapes import fp_rect
            flat_roof(b, fp_rect(fp[2] - fp[0], fp[3] - fp[1], (fp[0] + fp[2]) / 2, (fp[1] + fp[3]) / 2), z, look, **kw)
        return
    main = max(rects, key=lambda q: (q[2] - q[0]) * (q[3] - q[1]))
    for rc in rects:
        rr = rc
        extra = dict(kw)
        if rc is not main and form in ('gable', 'hip', 'mansard', 'pyramidal'):
            span = min(main[2] - main[0], main[3] - main[1]) / 2
            rr = _extend(rc, main, span)
            if form == 'gable':
                extra['axis'] = 'y' if (rr[3] - rr[1]) > (rr[2] - rr[0]) else 'x'
        w, d = rr[2] - rr[0], rr[3] - rr[1]
        if form == 'gable':
            run = (min(w, d) if extra.get('axis', 'auto') == 'auto' else (d if extra.get('axis') == 'x' else w)) / 2
            gable(b, rr, z, rise if rise is not None else run * math.tan(pitch * DEG), look, ov=ov, **extra)
        elif form in ('hip', 'pyramidal'):
            run = min(w, d) / 2
            (hip if form == 'hip' else pyramidal)(b, rr, z, rise if rise is not None else run * math.tan(pitch * DEG), look, ov=ov, **extra)
        elif form == 'mansard':
            mansard(b, rr, z, rise if rise is not None else min(w, d) * 0.28, look, **extra)
        elif form == 'stepped':
            stepped(b, rr, z, rise if rise is not None else min(w, d) * 0.3, look, **extra)
        elif form == 'shed':
            shed(b, rr, z, rise if rise is not None else min(w, d) * 0.18, look, ov=ov, **extra)
        elif form == 'barrel':
            barrel(b, rr, z, rise if rise is not None else min(w, d) * 0.28, look, **extra)
        elif form == 'dome':
            dome(b, (rr[0] + rr[2]) / 2, (rr[1] + rr[3]) / 2, z, min(w, d) / 2 * 0.95, look, **extra)
        elif form == 'multi-dome':
            multi_dome(b, rr, z, extra.pop('rows', 2), extra.pop('cols', 3), look, **extra)
        elif form == 'tensile':
            tensile(b, rr, z, rise if rise is not None else 5.0, look, **extra)
        elif form == 'sawtooth':
            sawtooth(b, rr, z, rise if rise is not None else 2.5, look, teeth=extra.pop('teeth', 5), **extra)
