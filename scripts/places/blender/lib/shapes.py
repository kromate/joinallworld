"""Footprints, wall segments and plain solids (boxes, prisms, cylinders, profile sweeps, steps)."""
import math

from mathutils import Vector
from mathutils.geometry import tessellate_polygon

from .core import _cross, _dot, _norm


# ------------------------------------------------------------------------------------------------------------- footprints
def _ccw(poly):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if a > 0 else poly[::-1]


def _cw(poly):
    return _ccw(poly)[::-1]


class Seg:
    """One straight wall edge. u runs to the viewer's right when looking at the wall from outside; n points outwards.
    P(u, z, d) = point at distance u along the wall, height z, d metres INTO the building (d<0 stands proud)."""

    def __init__(self, p0, p1):
        self.p0, self.p1 = p0, p1
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        self.length = math.hypot(dx, dy)
        self.u = (dx / self.length, dy / self.length)
        self.n = (self.u[1], -self.u[0])
        self.front = self.n[1] < -0.5
        self.rear = self.n[1] > 0.5

    def P(self, u, z, d=0.0):
        return (self.p0[0] + self.u[0] * u - self.n[0] * d, self.p0[1] + self.u[1] * u - self.n[1] * d, z)

    def N3(self):
        return (self.n[0], self.n[1], 0.0)


class Footprint:
    """Outline of a building mass: polys[0] outer (counter-clockwise), the rest holes (clockwise), centred on (0, 0).
    `rects` decomposes the solid into axis-aligned rectangles (x0, y0, x1, y1): roofs are built per rect."""

    def __init__(self, polys, rects):
        self.polys = polys
        self.rects = rects

    @property
    def bbox(self):
        xs = [p[0] for p in self.polys[0]]
        ys = [p[1] for p in self.polys[0]]
        return (min(xs), min(ys), max(xs), max(ys))

    @property
    def size(self):
        b = self.bbox
        return (b[2] - b[0], b[3] - b[1])

    def edges(self, min_len=0.2):
        for poly in self.polys:
            for i, p in enumerate(poly):
                q = poly[(i + 1) % len(poly)]
                if math.hypot(q[0] - p[0], q[1] - p[1]) >= min_len:
                    yield Seg(p, q)

    def moved(self, dx, dy):
        mv = lambda pl: [(x + dx, y + dy) for x, y in pl]
        return Footprint([mv(p) for p in self.polys], [(a + dx, b + dy, c + dx, d + dy) for a, b, c, d in self.rects])


def _centre(polys, rects):
    xs = [p[0] for p in polys[0]]
    ys = [p[1] for p in polys[0]]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return Footprint([[(x - cx, y - cy) for x, y in pl] for pl in polys], [(a - cx, b - cy, c - cx, d - cy) for a, b, c, d in rects])


def fp_rect(w, d, cx=0.0, cy=0.0):
    r = (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)
    return Footprint([[(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3])]], [r])


def fp_L(w, d, wing_w, wing_d, side='right'):
    """Main block w x d (front) with a wing wing_w wide extending wing_d further back at one end."""
    s = 1 if side == 'right' else -1
    x0, x1 = -w / 2, w / 2
    y0 = 0.0
    wx0, wx1 = (x1 - wing_w, x1) if s == 1 else (x0, x0 + wing_w)
    pts = [(x0, y0), (x1, y0)]
    if s == 1:
        pts += [(x1, y0 + d + wing_d), (wx0, y0 + d + wing_d), (wx0, y0 + d), (x0, y0 + d)]
    else:
        pts += [(x1, y0 + d), (wx1, y0 + d), (wx1, y0 + d + wing_d), (x0, y0 + d + wing_d)]
    return _centre([_ccw(pts)], [(x0, y0, x1, y0 + d), (wx0, y0 + d, wx1, y0 + d + wing_d)])


def fp_U(w, d, arm_w, arm_d, open_to='back'):
    """Base block w x d plus two arms arm_w wide, arm_d long; the courtyard faces back (+y) or front (-y)."""
    x0, x1 = -w / 2, w / 2
    if open_to == 'back':
        pts = [(x0, 0), (x1, 0), (x1, d + arm_d), (x1 - arm_w, d + arm_d), (x1 - arm_w, d), (x0 + arm_w, d), (x0 + arm_w, d + arm_d), (x0, d + arm_d)]
        rects = [(x0, 0, x1, d), (x0, d, x0 + arm_w, d + arm_d), (x1 - arm_w, d, x1, d + arm_d)]
    else:
        pts = [(x0, -arm_d), (x0 + arm_w, -arm_d), (x0 + arm_w, 0), (x1 - arm_w, 0), (x1 - arm_w, -arm_d), (x1, -arm_d), (x1, d), (x0, d)]
        rects = [(x0, 0, x1, d), (x0, -arm_d, x0 + arm_w, 0), (x1 - arm_w, -arm_d, x1, 0)]
    return _centre([_ccw(pts)], rects)


def fp_T(w, d, stem_w, stem_d):
    """Bar w x d (front) with a centred stem stem_w x stem_d behind it."""
    x0, x1, sx0, sx1 = -w / 2, w / 2, -stem_w / 2, stem_w / 2
    pts = [(x0, 0), (x1, 0), (x1, d), (sx1, d), (sx1, d + stem_d), (sx0, d + stem_d), (sx0, d), (x0, d)]
    return _centre([_ccw(pts)], [(x0, 0, x1, d), (sx0, d, sx1, d + stem_d)])


def fp_H(w, d, bar_d, arm_w):
    """Two arms (arm_w wide, d deep) joined by a centre bar bar_d deep, total width w."""
    x0, x1 = -w / 2, w / 2
    by0, by1 = (d - bar_d) / 2, (d + bar_d) / 2
    pts = [(x0, 0), (x0 + arm_w, 0), (x0 + arm_w, by0), (x1 - arm_w, by0), (x1 - arm_w, 0), (x1, 0), (x1, d),
           (x1 - arm_w, d), (x1 - arm_w, by1), (x0 + arm_w, by1), (x0 + arm_w, d), (x0, d)]
    return _centre([_ccw(pts)], [(x0, 0, x0 + arm_w, d), (x1 - arm_w, 0, x1, d), (x0 + arm_w, by0, x1 - arm_w, by1)])


def fp_cross(w, d, arm_w, arm_d):
    """Plus shape: nave w x arm_d (along x) crossed by transept arm_w x d (along y)."""
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2, d / 2
    ax0, ax1, ay0, ay1 = -arm_w / 2, arm_w / 2, -arm_d / 2, arm_d / 2
    pts = [(ax0, y0), (ax1, y0), (ax1, ay0), (x1, ay0), (x1, ay1), (ax1, ay1), (ax1, y1), (ax0, y1), (ax0, ay1), (x0, ay1), (x0, ay0), (ax0, ay0)]
    return _centre([_ccw(pts)], [(x0, ay0, x1, ay1), (ax0, y0, ax1, y1)])


def fp_ring(w, d, court_w, court_d):
    """Rectangular block round a courtyard (hole)."""
    ow, od = w / 2, d / 2
    iw, idd = court_w / 2, court_d / 2
    outer = [(-ow, -od), (ow, -od), (ow, od), (-ow, od)]
    inner = [(-iw, -idd), (-iw, idd), (iw, idd), (iw, -idd)]  # clockwise
    rects = [(-ow, -od, ow, -idd), (-ow, idd, ow, od), (-ow, -idd, -iw, idd), (iw, -idd, ow, idd)]
    return Footprint([outer, inner], rects)


def fp_oval(w, d, n=32):
    pts = [(w / 2 * math.cos(2 * math.pi * i / n), d / 2 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return Footprint([pts], [(-w / 2, -d / 2, w / 2, d / 2)])


def fp_round(r, n=24):
    return fp_oval(2 * r, 2 * r, n)


def fp_polygon(points):
    """Arbitrary simple polygon (any winding). rects falls back to the bounding box."""
    pl = _ccw([(float(x), float(y)) for x, y in points])
    xs, ys = [p[0] for p in pl], [p[1] for p in pl]
    return Footprint([pl], [(min(xs), min(ys), max(xs), max(ys))])


def footprint(kind, w, d, rng=None, detail=0, **kw):
    """Brief `form.footprint` + width/depth -> Footprint. Proportions of wings/arms are derived from w and d unless overridden.
    kinds: rect L U T H ring oval round cross irregular (irregular = rect with one notch)."""
    n = {0: 32, 1: 20, 2: 12}.get(detail, 32)
    r = rng.uniform(0.3, 0.38) if rng else 0.34
    if kind == 'L':
        return fp_L(w, d * (1 - r), w * kw.get('wing', r), d * r, kw.get('side', 'right'))
    if kind == 'U':
        return fp_U(w, d * 0.45, w * 0.28, d * 0.55, kw.get('open_to', 'back'))
    if kind == 'T':
        return fp_T(w, d * 0.45, w * 0.3, d * 0.55)
    if kind == 'H':
        return fp_H(w, d, d * 0.35, w * 0.28)
    if kind == 'cross':
        return fp_cross(w, d, w * 0.3, d * 0.3)
    if kind == 'ring':
        return fp_ring(w, d, w * 0.5, d * 0.5)
    if kind == 'oval':
        return fp_oval(w, d, n)
    if kind == 'round':
        return fp_round(min(w, d) / 2, n)
    if kind == 'irregular':
        return fp_L(w, d * 0.62, w * 0.4, d * 0.38, 'right' if (rng.random() < 0.5 if rng else True) else 'left')
    return fp_rect(w, d)


# -------------------------------------------------------------------------------------------------------- solids
def cap(b, polys, z, up=True, slot='roof-flat', col='#8a8a8a', scale=1.0, hole_polys=None):
    """A horizontal polygon-with-holes at height z (tessellated). up=True faces +Z (roof/floor), False faces down."""
    rings = [[Vector((x, y, 0.0)) for x, y in pl] for pl in polys]
    tris = tessellate_polygon(rings)
    flat = [p for pl in polys for p in pl]
    for t in tris:
        pts = [(flat[i][0], flat[i][1], z) for i in t]
        b.facing(pts, (0, 0, 1 if up else -1), slot, col, scale=scale)


def box(b, x0, y0, z0, x1, y1, z1, slot='plain-render', col='#d8d8d8', top_slot=None, top_col=None, skip=('bottom',), scale=1.0, smooth=False):
    """Axis-aligned box. skip: any of 'front','back','left','right','top','bottom' (front = -Y face)."""
    ts, tc = top_slot or slot, top_col or col
    f = [
        ('front', [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0), slot, col),
        ('right', [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0), slot, col),
        ('back', [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], (0, 1, 0), slot, col),
        ('left', [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], (-1, 0, 0), slot, col),
        ('top', [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1), ts, tc),
        ('bottom', [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 0, -1), slot, col),
    ]
    for name, pts, hint, s, c in f:
        if name not in skip:
            b.facing(pts, hint, s, c, scale=scale)


def box_c(b, cx, cy, z0, w, d, h, slot='plain-render', col='#d8d8d8', **kw):
    """Box by centre (cx, cy), base z0, width w (x), depth d (y), height h."""
    box(b, cx - w / 2, cy - d / 2, z0, cx + w / 2, cy + d / 2, z0 + h, slot, col, **kw)


def prism(b, poly, z0, z1, slot='plain-render', col='#d8d8d8', top=True, top_slot=None, top_col=None, bottom=False, scale=1.0):
    """Vertical extrusion of a counter-clockwise polygon (or Footprint) between z0 and z1."""
    polys = poly.polys if isinstance(poly, Footprint) else [poly]
    for pl in polys:
        for i, p in enumerate(pl):
            q = pl[(i + 1) % len(pl)]
            if math.dist(p, q) < 1e-4:
                continue
            b.face([(p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1), (p[0], p[1], z1)], slot, col, scale=scale)
    if top:
        cap(b, polys, z1, True, top_slot or slot, top_col or col, scale)
    if bottom:
        cap(b, polys, z0, False, slot, col, scale)


def cylinder(b, cx, cy, z0, z1, r, n=12, slot='plain-render', col='#d8d8d8', r_top=None, top=True, top_slot=None, top_col=None, smooth=True, scale=1.0, bottom=False):
    """Vertical cylinder/cone frustum (r_top=0 gives a cone). n sides; smooth shading when `smooth`."""
    rt = r if r_top is None else r_top
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    grid = [[(cx + r * math.cos(a), cy + r * math.sin(a), z0), (cx + rt * math.cos(a), cy + rt * math.sin(a), z1)] for a in angs]
    b.shared_grid(grid, slot, col, smooth=smooth, wrap=True, scale=scale)
    if top and rt > 1e-6:
        pts = [(cx + rt * math.cos(a), cy + rt * math.sin(a), z1) for a in angs[:-1]]
        b.facing(pts, (0, 0, 1), top_slot or slot, top_col or col, scale=scale)
    if bottom:
        pts = [(cx + r * math.cos(a), cy + r * math.sin(a), z0) for a in angs[:-1]]
        b.facing(pts, (0, 0, -1), slot, col, scale=scale)


def _miter(poly, d):
    """Offset a closed polygon outwards (to the right of travel) by d with mitred corners."""
    out = []
    m = len(poly)
    for i in range(m):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % m]
        e1 = (p1[0] - p0[0], p1[1] - p0[1])
        e2 = (p2[0] - p1[0], p2[1] - p1[1])
        l1, l2 = math.hypot(*e1) or 1, math.hypot(*e2) or 1
        n1 = (e1[1] / l1, -e1[0] / l1)
        n2 = (e2[1] / l2, -e2[0] / l2)
        k = 1 + n1[0] * n2[0] + n1[1] * n2[1]
        k = max(k, 0.25)
        out.append((p1[0] + (n1[0] + n2[0]) / k * d, p1[1] + (n1[1] + n2[1]) / k * d))
    return out


def sweep(b, fp, z, profile, slot='plain-render', col='#d8d8d8', scale=1.0, close=True):
    """Sweep a 2D profile round every polygon of a Footprint (or a list of polygons).

    profile = [(d, dz), ...]: d = metres OUTWARDS from the wall line, dz = metres above z. Trace it from the bottom of the wall
    face upwards over the outside: e.g. a parapet is [(0,0),(0,0.9),(-0.3,0.9),(-0.3,0)], a cornice [(0,0),(0.35,0),(0.35,0.2),(0,0.3)],
    a plinth [(0.06,0),(0.06,0.5),(0,0.5)]. Mitred corners. `slot`/`col` may be lists (one per profile segment)."""
    polys = fp.polys if isinstance(fp, Footprint) else fp
    for pl in polys:
        rings = [[(x, y, z + dz) for x, y in _miter(pl, d)] for d, dz in profile]
        for k in range(len(profile) - 1):
            s = slot[k] if isinstance(slot, (list, tuple)) else slot
            c = col[k] if isinstance(col, (list, tuple)) else col
            m = len(pl)
            for i in range(m):
                j = (i + 1) % m
                b.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]], s, c, scale=scale)


def steps(b, x0, x1, y_face, z_top, depth, n, slot='paving', col='#c8c4bc', side='front', slab_slot=None):
    """A flight of n steps against a wall at y = y_face, spanning x0..x1, rising to z_top; `depth` is the total run.
    side='front' climbs towards +Y (steps stand in front, -Y side, of the wall); 'back' mirrors it."""
    s = -1 if side == 'front' else 1
    for k in range(n):
        h = z_top * (k + 1) / n
        run = depth * (n - k) / n
        ya, yb = (y_face + s * run, y_face) if s == -1 else (y_face, y_face + run)
        box(b, x0, ya, 0, x1, yb, h, slot, col, skip=('bottom', 'back') if s == -1 else ('bottom', 'front'))


def stair_box(b, x0, y0, x1, y1, z, h, slot='paving', col='#c8c4bc'):
    box(b, x0, y0, z, x1, y1, z + h, slot, col)
