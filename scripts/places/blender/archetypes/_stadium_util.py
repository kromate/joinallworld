"""Private helpers shared by the stadium, monument, park-landscape and heritage-fort archetypes (one author).

Everything is in metres, +Z up, ground at z = 0, main facade facing -Y. Nothing here draws randomly: callers pass an rng.
"""
import math

from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib


# ------------------------------------------------------------------------------------------------------------ brief access
def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(x):
    x = clamp(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def num(d, key, default):
    try:
        v = (d or {}).get(key)
        return float(v) if v is not None else float(default)
    except (TypeError, ValueError):
        return float(default)


def feats(brief):
    """{feature id: {'id', 'count', 'note'}} for the brief (strings and dicts both accepted)."""
    out = {}
    for f in (brief or {}).get('features') or []:
        if isinstance(f, dict) and f.get('id'):
            out[f['id']] = {'id': f['id'], 'count': int(f.get('count') or 1), 'note': f.get('note') or ''}
        elif isinstance(f, str):
            out[f] = {'id': f, 'count': 1, 'note': ''}
    return out


def text(brief):
    """Lower-case searchable text: name, subject, notes, variant, style, era and every feature note."""
    br = brief or {}
    parts = [str(br.get(k) or '') for k in ('name', 'subject', 'notes', 'style', 'era')]
    parts.append(str((br.get('form') or {}).get('variant') or ''))
    parts.extend(str(f.get('note') or '') for f in (br.get('features') or []) if isinstance(f, dict))
    return ' '.join(parts).lower()


def has(txt, *words):
    return any(w in txt for w in words)


def era_year(brief):
    """First four-digit year in the era text (0 when absent)."""
    import re
    m = re.search(r'(1[0-9]{3}|20[0-9]{2})', str((brief or {}).get('era') or ''))
    return int(m.group(1)) if m else 0


def centre_xy(objs, centre_x=True, centre_y=False, to_y=None):
    """Translate mesh data so the building bbox is centred on x (and optionally on y, or shifted so its centre is at to_y)."""
    lo, hi = lib.bounds([o for o in objs if not o.name.endswith('-site')] or objs)
    dx = -(lo[0] + hi[0]) / 2 if centre_x else 0.0
    dy = 0.0
    if centre_y:
        dy = -(lo[1] + hi[1]) / 2 + (to_y or 0.0)
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return objs
    m = Matrix.Translation((dx, dy, 0.0))
    for o in objs:
        o.data.transform(m)
        o.data.update()
    return objs


# ---------------------------------------------------------------------------------------------------------------- vectors
def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def unit(a):
    l = math.sqrt(dot(a, a))
    return (a[0] / l, a[1] / l, a[2] / l) if l > 1e-9 else (0.0, 0.0, 1.0)


def sp(c, n):
    """Superellipse helper: signed power."""
    return math.copysign(abs(c) ** (2.0 / n), c)


class Local:
    """A rotated, translated frame: P(u, v, z) -> world. u along the local x axis, v along the local y axis; yaw about +Z."""

    def __init__(self, ox, oy, yaw=0.0):
        self.ox, self.oy, self.yaw = ox, oy, yaw
        self.c, self.s = math.cos(yaw), math.sin(yaw)

    def P(self, u, v, z=0.0):
        return (self.ox + self.c * u - self.s * v, self.oy + self.s * u + self.c * v, z)

    def D(self, du, dv, dz=0.0):
        return (self.c * du - self.s * dv, self.s * du + self.c * dv, dz)


# ------------------------------------------------------------------------------------------------------------------ faces
def poly(b, pts, hint, slot='plain', col='#cccccc', **kw):
    """Any simple (roughly planar) polygon, tessellated so concave outlines work; visible towards `hint`."""
    if len(pts) < 3:
        return
    if len(pts) <= 4 and _convex_ok(pts):
        b.facing(pts, hint, slot, col, **kw)
        return
    n = lib.core.newell(pts)
    ax = max(range(3), key=lambda k: abs(n[k]))
    keep = [k for k in range(3) if k != ax]
    ring = [Vector((p[keep[0]], p[keep[1]], 0.0)) for p in pts]
    for t in tessellate_polygon([ring]):
        b.facing([pts[i] for i in t], hint, slot, col, **kw)


def _convex_ok(pts):
    return True


def strut(b, p0, p1, w, col='#9ea3a8', slot='frame', ends=True):
    """A square-section bar of side w between two 3D points (8 triangles, +2 for the end caps)."""
    d = unit(sub(p1, p0))
    ref = (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = unit(cross(d, ref))
    v = unit(cross(d, u))
    h = w / 2
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    ring0 = [add(p0, add(mul(u, h * a), mul(v, h * c))) for a, c in corners]
    ring1 = [add(p1, add(mul(u, h * a), mul(v, h * c))) for a, c in corners]
    mid = mul(add(p0, p1), 0.5)
    sc = max(1.0, math.dist(p0, p1) / 1.2)
    for i in range(4):
        j = (i + 1) % 4
        q = [ring0[i], ring0[j], ring1[j], ring1[i]]
        cen = mul(add(add(q[0], q[1]), add(q[2], q[3])), 0.25)
        b.facing(q, sub(cen, mid), slot, col, scale=sc)
    if ends:
        b.facing(ring1, d, slot, col)
        b.facing(ring0, mul(d, -1), slot, col)


def cable(b, p0, p1, col='#3d4247', w=0.12):
    """A thin stay / cable (a 2-sided ribbon at LOD0, nothing at LOD2)."""
    if b.detail >= 2:
        return
    if b.detail == 1:
        w *= 1.6
    d = unit(sub(p1, p0))
    side = unit(cross(d, (0.0, 0.0, 1.0))) if abs(d[2]) < 0.95 else (1.0, 0.0, 0.0)
    s = mul(side, w / 2)
    q = [sub(p0, s), add(p0, s), add(p1, s), sub(p1, s)]
    b.face(q, 'plain', col)
    b.face(q[::-1], 'plain', col)


def oriented_grid(b, grid, want, slot, col, smooth_=False, centre=(0.0, 0.0), scale=1.0):
    """shared_grid, but flipped (rows reversed) when its mid-cell normal disagrees with `want`:
    'up' 'down' 'out' (away from `centre`) 'in' (towards it) or a 3-vector."""
    R, C = len(grid), len(grid[0])
    i, j = max(0, R // 2 - 1), max(0, C // 2 - 1)
    a, bb, c = grid[i][j], grid[min(R - 1, i + 1)][j], grid[i][min(C - 1, j + 1)]
    n = cross(sub(bb, a), sub(c, a))
    mid = mul(add(a, c), 0.5)
    if isinstance(want, str):
        rad = (mid[0] - centre[0], mid[1] - centre[1], 0.0)
        w = {'up': (0, 0, 1), 'down': (0, 0, -1), 'out': rad, 'in': mul(rad, -1)}[want]
    else:
        w = want
    if dot(n, w) < 0:
        grid = grid[::-1]
    b.shared_grid(grid, slot, col, smooth=smooth_, scale=scale)


# --------------------------------------------------------------------------------------------------------------- furniture
def flag(b, x, y, h, col, cloth_w=None, yaw=0.0, striped=True, col2=None):
    """A flagpole with a rectangular cloth (two colours as vertical stripes unless striped=False). No emblems."""
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, 0, h, 0.07, n=5 if b.detail == 0 else 4, slot='frame', col='#c8ccd0', r_top=0.05, top=True)
    if b.detail >= 1:
        return
    cw = cloth_w or max(1.4, h * 0.2)
    ch = cw * 0.62
    c, s = math.cos(yaw), math.sin(yaw)
    z1, z0 = h - 0.2, h - 0.2 - ch
    cols = [col, col2 or '#f2f2ee', col] if striped else [col]
    n = len(cols)
    for k, cc in enumerate(cols):
        u0, u1 = cw * k / n, cw * (k + 1) / n
        q = [(x + c * u0, y + s * u0, z0), (x + c * u1, y + s * u1, z0), (x + c * u1, y + s * u1, z1), (x + c * u0, y + s * u0, z1)]
        b.face(q, 'plain', cc)
        b.face(q[::-1], 'plain', cc)


def lattice_mast(b, x, y, h, col='#aeb4ba', head_w=5.0, head_h=2.2, yaw=0.0, base_r=0.9, lamp_col='#f4f1dc'):
    """A floodlight mast: tapering lattice (4 legs + bands at LOD0, a tapering pole at LOD1/2) with a lamp rack on top."""
    if b.detail >= 2:
        lib.cylinder(b, x, y, 0, h, 0.5, n=4, slot='plain', col=col, r_top=0.35, top=False)
        return
    if b.detail == 1:
        lib.cylinder(b, x, y, 0, h, base_r * 0.45, n=5, slot='frame', col=col, r_top=0.2, top=False)
    else:
        n_b = max(3, int(h / 7))
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            strut(b, (x + sx * base_r, y + sy * base_r, 0), (x + sx * 0.22, y + sy * 0.22, h), 0.16, col, ends=False)
        for k in range(1, n_b + 1):
            z = h * k / (n_b + 1)
            r = lerp(base_r, 0.22, z / h)
            pts = [(x - r, y - r, z), (x + r, y - r, z), (x + r, y + r, z), (x - r, y + r, z)]
            for i in range(4):
                strut(b, pts[i], pts[(i + 1) % 4], 0.1, col, ends=False)
    c, s = math.cos(yaw), math.sin(yaw)
    lib.obox(b, x, y, h, head_w, 0.5, head_h, yaw, 'frame', '#4a4f55', skip=())
    rows = 2 if b.detail == 0 else 1
    for rr in range(rows):
        zz = h + 0.35 + rr * (head_h - 0.9) / max(1, rows - 1) if rows > 1 else h + head_h / 2 - 0.25
        for k in range(5 if b.detail == 0 else 3):
            u = (k - (4 if b.detail == 0 else 2) / 2) * head_w / (5 if b.detail == 0 else 3) * 0.95
            lib.obox(b, x + c * u + s * 0.3, y + s * u - c * 0.3, zz, 0.75, 0.12, 0.5, yaw, 'plain', lamp_col, skip=('bottom',))


def railing(b, p0, p1, h=1.1, col='#6f757b', post=2.5):
    """A post-and-rail fence along p0 -> p1 (2D points); LOD0 only (LOD1 a single thin rail, LOD2 none)."""
    if b.detail >= 2:
        return
    L = math.dist(p0, p1)
    if L < 0.3:
        return
    if b.detail == 1:
        strut(b, (p0[0], p0[1], h), (p1[0], p1[1], h), 0.12, col, ends=False)
        return
    n = max(1, int(L / post))
    for k in range(n + 1):
        x = lerp(p0[0], p1[0], k / n)
        y = lerp(p0[1], p1[1], k / n)
        lib.cylinder(b, x, y, 0, h, 0.04, n=4, slot='frame', col=col, top=True)
    for z in (h, h * 0.55):
        strut(b, (p0[0], p0[1], z), (p1[0], p1[1], z), 0.05, col, ends=False)


def wall_run(b, p0, p1, h, thick, slot, col, cap_col=None, pier_every=0.0, pier_h=0.0, pier_w=0.0):
    """A straight freestanding wall between two 2D points, optionally with taller piers every `pier_every` metres."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    if L < 0.2:
        return
    yaw = math.atan2(dy, dx)
    lib.obox(b, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0, L, thick, h, yaw, slot, col, top_col=cap_col or col, skip=('bottom',), scale=2.0 if b.detail == 0 else 10.0)
    if pier_every > 0 and b.detail < 1:
        n = max(1, int(L / pier_every))
        for k in range(n + 1):
            x = lerp(p0[0], p1[0], k / n)
            y = lerp(p0[1], p1[1], k / n)
            lib.obox(b, x, y, 0, pier_w or thick * 1.6, (pier_w or thick * 1.6), pier_h or h * 1.15, yaw, slot, cap_col or col, skip=('bottom',))


def person(b, x, y, z, h, col, yaw=0.0, pose='stand', arm='down', cloth=None, skin='#6a4a3a', hold=None):
    """A very low-poly figure (about 40 triangles): legs, torso, arms (down | up | out | forward), head. Faces -Y at yaw 0."""
    if b.detail >= 2:
        lib.cylinder(b, x, y, z, z + h, h * 0.16, n=4, slot='plain', col=col, r_top=h * 0.1, top=True)
        return
    c, s = math.cos(yaw), math.sin(yaw)
    cl = cloth or col
    L = lambda lx, ly, lz: (x + c * lx - s * ly, y + s * lx + c * ly, z + lz)
    leg_h, torso_h, head_r = h * 0.47, h * 0.33, h * 0.075
    sw = h * 0.1
    n = 5 if b.detail == 0 else 4
    for sx in (-1, 1):
        p = L(sx * sw * 0.55, 0, 0)
        lib.cylinder(b, p[0], p[1], z, z + leg_h, sw * 0.42, n=n, slot='plain', col=cl, r_top=sw * 0.38, top=False, smooth=False)
    tp = L(0, 0, leg_h)
    lib.cylinder(b, tp[0], tp[1], z + leg_h, z + leg_h + torso_h, sw * 1.05, n=n + 1, slot='plain', col=col, r_top=sw * 1.2, top=True, smooth=False)
    shoulder = z + leg_h + torso_h * 0.92
    for sx in (-1, 1):
        sp0 = L(sx * sw * 1.25, 0, shoulder - z)
        if arm == 'up' and sx == 1:
            end = L(sx * sw * 1.9, -sw * 0.2, shoulder - z + h * 0.28)
        elif arm == 'out':
            end = L(sx * (sw * 1.25 + h * 0.3), 0, shoulder - z - h * 0.02)
        elif arm == 'forward':
            end = L(sx * sw * 1.3, -h * 0.24, shoulder - z - h * 0.06)
        else:
            end = L(sx * sw * 1.5, 0, shoulder - z - torso_h * 0.85)
        strut(b, sp0, end, sw * 0.62, col, slot='plain', ends=b.detail == 0)
    hp = L(0, 0, leg_h + torso_h + head_r * 0.9)
    lib.blob(b, hp[0], hp[1], hp[2], head_r, head_r, head_r * 1.15, skin, n=5, rings=3)
    if hold:
        end = L(sw * 1.9, -sw * 0.2, shoulder - z + h * 0.28) if arm == 'up' else L(sw * 1.5, -h * 0.05, shoulder - z - torso_h * 0.6)
        top = (end[0], end[1], end[2] + hold)
        strut(b, (end[0], end[1], end[2] - hold * 0.25), top, sw * 0.28, '#4a4f55', slot='frame', ends=True)


def clip_rect(pts, xmin, xmax, ymin, ymax):
    """Sutherland-Hodgman clip of a 2D polygon against an axis-aligned rectangle."""
    def clip(poly, inside, inter):
        out = []
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            ia, ib = inside(a), inside(b)
            if ia:
                out.append(a)
            if ia != ib:
                out.append(inter(a, b))
        return out
    poly = list(pts)
    def ix(x):
        return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
    def iy(y):
        return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)
    for inside, inter in ((lambda p: p[0] >= xmin, ix(xmin)), (lambda p: p[0] <= xmax, ix(xmax)),
                          (lambda p: p[1] >= ymin, iy(ymin)), (lambda p: p[1] <= ymax, iy(ymax))):
        if not poly:
            break
        poly = clip(poly, inside, inter)
    return poly


def poly_holes(b, rings, hint, slot='plain', col='#cccccc', **kw):
    """A polygon with holes (rings[0] outer, the rest holes), 3D points on one plane, tessellated and visible towards `hint`."""
    n = lib.core.newell(rings[0])
    ax = max(range(3), key=lambda k: abs(n[k]))
    keep = [k for k in range(3) if k != ax]
    flat = [p for r in rings for p in r]
    vr = [[Vector((p[keep[0]], p[keep[1]], 0.0)) for p in r] for r in rings]
    for t in tessellate_polygon(vr):
        b.facing([flat[i] for i in t], hint, slot, col, **kw)


def revolve(b, cx, cy, prof, n, slot='plain-render', col='#d8d8d8', smooth_=True, scale=1.0, z0=0.0, cols=None):
    """Surface of revolution round a vertical axis through (cx, cy). prof = [(r, z), ...] traced UP the outside (then in over the top),
    so normals face outwards / up. Points with r = 0 collapse to the axis. smooth_ shades with averaged normals."""
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    grid = [[(cx + r * math.cos(a), cy + r * math.sin(a), z0 + z) for r, z in prof] for a in angs]
    b.shared_grid(grid, slot, col, smooth=smooth_, wrap=True, scale=scale)


def prism_poly(b, pts2d, z0, z1, slot, col, top=True, bottom=False, top_col=None, scale=1.0, top_slot=None):
    """Extrusion of a simple CCW polygon (2D points) between z0 and z1 (concave allowed for the cap)."""
    m = len(pts2d)
    for i in range(m):
        p, q = pts2d[i], pts2d[(i + 1) % m]
        if math.dist(p, q) < 1e-4:
            continue
        b.face([(p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1), (p[0], p[1], z1)], slot, col, scale=scale)
    if top:
        poly(b, [(p[0], p[1], z1) for p in pts2d], (0, 0, 1), top_slot or slot, top_col or col, scale=scale)
    if bottom:
        poly(b, [(p[0], p[1], z0) for p in pts2d], (0, 0, -1), slot, col, scale=scale)


def star_pts(cx, cy, r, r_in=None, n=5, rot=math.pi / 2):
    r_in = r_in or r * 0.4
    pts = []
    for k in range(2 * n):
        a = rot + math.pi * k / n
        rr = r if k % 2 == 0 else r_in
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return pts


def crenellation(b, p0, p1, z, h, merlon=1.0, gap=0.8, thick=0.6, slot='plain-render', col='#d8d8d8', cap_col=None):
    """Merlons (battlement teeth) along p0 -> p1 standing on a wall top at height z, centred on the wall line (LOD0 only)."""
    if b.detail >= 1:
        return
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    if L < merlon:
        return
    yaw = math.atan2(dy, dx)
    pitch = merlon + gap
    n = max(1, int((L + gap) / pitch))
    start = (L - (n * merlon + (n - 1) * gap)) / 2
    for k in range(n):
        u = start + k * pitch + merlon / 2
        x, y = p0[0] + dx / L * u, p0[1] + dy / L * u
        lib.obox(b, x, y, z, merlon, thick, h, yaw, slot, col, top_col=cap_col or col, skip=('bottom',))


def pinnacle(b, x, y, z, h, w, col='#d8d8d8', slot='plain-render', steps=3):
    """A Hausa 'zankwaye' style horn pinnacle: a stepped, tapering column ending in a point (stacked frusta)."""
    n = 6 if b.detail == 0 else 4
    if b.detail >= 2:
        lib.cylinder(b, x, y, z, z + h, w / 2, n=4, slot='plain', col=col, r_top=0.0, top=False, smooth=False)
        return
    prof = [(w * 0.5, 0.0), (w * 0.5, h * 0.18), (w * 0.38, h * 0.2), (w * 0.34, h * 0.5), (w * 0.2, h * 0.52), (w * 0.17, h * 0.85), (0.0, h)]
    if b.detail == 1:
        prof = [(w * 0.5, 0.0), (w * 0.34, h * 0.5), (0.0, h)]
    revolve(b, x, y, prof, n, slot, col, smooth_=False, z0=z)
