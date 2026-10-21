"""Generic geometry for any shape a modeller can describe: ring skins (prism / loft / sweep), lathe, arcades cut into a cylinder, shell
surfaces from height functions, raked stands, profile extrusion along a path, and the placements of an array.

Everything is in metres, local frame, +Z up. Functions take the Builder `b` (or an Xform proxy) and add faces; none of them creates a
Blender object. Orientation (which side a face is visible from) is worked out here, callers never think about winding.

  skin(b, rings, ...)                 closed rings (lists of 3D points, same count) -> side wall + end caps
  ring_*, resample, align_rings       2D/3D ring helpers for lofts
  prism_solid(b, poly, z0, z1, ...)   extrude a polygon, optional scale/offset at the top
  loft(b, sections, ...)              skin between sections (rect | circle | ellipse | polygon) at heights
  sweep_path(b, section, path, ...)   a 2D section swept along a 3D polyline
  revolve(b, profile, ...)            lathe of an (r, z) profile, optional arcade openings
  surface_grid / shell                height-function roofs and shells with thickness and underside
  extrude_profile(b, stations, profile, ...)   closed (d, z) profile along stations (stands, canopies, beams)
  path_points, array_placements       sampling helpers
"""
import math

from .core import _cross, _dot, _norm, _sub, newell, shade
from .shapes import cap


# ---------------------------------------------------------------------------------------------------------------- vectors
def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def _len(a):
    return math.sqrt(_dot(a, a))


def centroid(pts):
    n = len(pts)
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n, sum(p[2] for p in pts) / n)


def area2(poly):
    """Signed area of a 2D polygon (positive = counter-clockwise)."""
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def ccw2(poly):
    poly = [(float(p[0]), float(p[1])) for p in poly]
    return poly if area2(poly) >= 0 else poly[::-1]


def centroid2(poly):
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


# ---------------------------------------------------------------------------------------------------------------- skin
def skin(b, rings, slot='plain-render', col='#d8d8d8', smooth=False, cap_first=True, cap_last=True, cap_slot=None, cap_col=None,
         scale=1.0, closed_path=False):
    """Side wall (and end caps) between consecutive closed rings. Rings are lists of 3D points, all the same length; any winding.
    The side faces point away from the path axis whichever way the rings were listed. closed_path=True skips the caps (the caller
    has repeated the first ring at the end to close a loop). smooth=True shares vertices so the shading is averaged (round forms)."""
    rings = [list(r) for r in rings]
    k = len(rings)
    if k < 2 or len(rings[0]) < 3:
        return
    m = len(rings[0])
    if any(len(r) != m for r in rings):
        raise ValueError('skin: every ring needs the same number of points')
    cs = [centroid(r) for r in rings]
    norms = [newell(r) for r in rings]
    j = max(range(k), key=lambda i: _len(norms[i]))
    D = _sub(cs[min(j + 1, k - 1)], cs[max(j - 1, 0)])
    if _len(D) < 1e-9:
        D = (0.0, 0.0, 1.0)
    if _dot(norms[j], D) < 0:
        rings = [r[::-1] for r in rings]
        norms = [newell(r) for r in rings]
    grid = [[rings[jj][i % m] for jj in range(k)] for i in range(m + 1)]
    b.shared_grid(grid, slot, col, smooth=smooth, wrap=True, scale=scale)
    if closed_path:
        return
    cs_, cc_ = cap_slot or slot, cap_col or col
    for ring, nrm, flag, sgn in ((rings[0], norms[0], cap_first, -1), (rings[-1], norms[-1], cap_last, 1)):
        if not flag or _len(nrm) < 1e-9:
            continue
        ext = max(max(p[q] for p in ring) - min(p[q] for p in ring) for q in range(3))
        big = ext > 8.0 and b.detail < 2
        b.facing(ring, _mul(nrm, sgn), 'plain' if big else cs_, cc_, scale=scale, **({'mode': 'fit'} if big else {}))


# ---------------------------------------------------------------------------------------------------------------- rings
def subdivide_ring(ring, n):
    """Add points (splitting the longest edge each time) until the ring has n points. Corners are kept."""
    ring = list(ring)
    while len(ring) < n:
        i = max(range(len(ring)), key=lambda q: math.dist(ring[q], ring[(q + 1) % len(ring)]))
        a, c = ring[i], ring[(i + 1) % len(ring)]
        ring.insert(i + 1, tuple((x + y) / 2 for x, y in zip(a, c)))
    return ring


def align_rings(ref, ring):
    """Rotate `ring` (2D points, same length as ref) so index 0 is nearest the reference start (centred comparison)."""
    n = len(ring)
    rc, cc = centroid2(ref), centroid2(ring)
    best, bi = None, 0
    for s in range(n):
        d = 0.0
        for i in range(n):
            p = ring[(i + s) % n]
            q = ref[i]
            d += (p[0] - cc[0] - q[0] + rc[0]) ** 2 + (p[1] - cc[1] - q[1] + rc[1]) ** 2
        if best is None or d < best:
            best, bi = d, s
    return ring[bi:] + ring[:bi]


def section_ring(sec, nround=16):
    """2D points (CCW, centred on 0,0 before cx, cy) of a loft section dict: rect [w, d] | circle r | ellipse [rx, ry] | poly [[x, y]...]
    with optional scale, rotDeg, cx, cy. Returns (points, was_round)."""
    rnd = False
    if sec.get('poly'):
        pts = [(float(p[0]), float(p[1])) for p in sec['poly']]
        rnd = len(pts) >= 12
        cxm, cym = 0.0, 0.0
    elif sec.get('rect') is not None:
        w, d = sec['rect'][0], sec['rect'][1]
        pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    elif sec.get('circle') is not None or sec.get('ellipse') is not None:
        rx, ry = (sec['circle'], sec['circle']) if sec.get('circle') is not None else (sec['ellipse'][0], sec['ellipse'][1])
        n = int(sec.get('n') or nround)
        pts = [(rx * math.cos(2 * math.pi * i / n), ry * math.sin(2 * math.pi * i / n)) for i in range(n)]
        rnd = True
    else:
        raise ValueError('loft section needs rect, circle, ellipse or poly')
    sc = float(sec.get('scale', 1.0))
    rot = math.radians(float(sec.get('rotDeg', 0.0)))
    ca, sa = math.cos(rot), math.sin(rot)
    cx, cy = float(sec.get('cx', 0.0)), float(sec.get('cy', 0.0))
    pts = [((x * ca - y * sa) * sc + cx, (x * sa + y * ca) * sc + cy) for x, y in pts]
    return ccw2(pts), rnd


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return tuple(0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3)
                 for i in range(len(p1)))


def loft(b, sections, slot='plain-render', col='#d8d8d8', top_col=None, smooth=None, smooth_profile=False, steps=4, cap_bottom=False, cap_top=True,
         nround=16, scale=1.0, cols=None):
    """Skin between sections [{z, rect|circle|ellipse|poly, cx, cy, rotDeg, scale, colour?}...] ordered by height. All sections are
    resampled to the same point count (corners kept, starts aligned). smooth_profile=True bends the skin through the sections
    (Catmull-Rom) with `steps` rings between each pair. Section 'colour' tints the band ABOVE that section."""
    rings2, rnds, zs = [], [], []
    for s in sections:
        pts, rnd = section_ring(s, nround)
        rings2.append(pts)
        rnds.append(rnd)
        zs.append(float(s.get('z', 0.0)))
    n = max(len(r) for r in rings2)
    rings2 = [subdivide_ring(r, n) if len(r) < n else r for r in rings2]
    ref = rings2[0]
    rings2 = [ref] + [align_rings(ref, r) for r in rings2[1:]]
    rings3 = [[(p[0], p[1], z) for p in r] for r, z in zip(rings2, zs)]
    sm = (all(rnds) if smooth is None else bool(smooth))
    per_col = [s.get('colour') for s in sections]
    if smooth_profile and len(rings3) > 2 and steps > 1:
        out = []
        k = len(rings3)
        for i in range(k - 1):
            a0, a1, a2, a3 = rings3[max(i - 1, 0)], rings3[i], rings3[i + 1], rings3[min(i + 2, k - 1)]
            for st in range(steps):
                t = st / steps
                out.append([catmull(a0[q], a1[q], a2[q], a3[q], t) for q in range(n)])
        out.append(rings3[-1])
        rings3 = out
        per_col = [None] * len(rings3)
    if any(per_col):
        for i in range(len(rings3) - 1):
            c = per_col[i] or col
            skin(b, [rings3[i], rings3[i + 1]], slot, c, smooth=sm, cap_first=cap_bottom and i == 0, cap_last=cap_top and i == len(rings3) - 2,
                 cap_col=top_col or c, scale=scale)
        return
    skin(b, rings3, slot, col, smooth=sm, cap_first=cap_bottom, cap_last=cap_top, cap_col=top_col or col, scale=scale)


def prism_solid(b, poly, z0, z1, slot='plain-render', col='#d8d8d8', top_scale=1.0, top_offset=(0.0, 0.0), top=True, bottom=False,
                top_col=None, top_slot=None, scale=1.0):
    """Extrude a 2D polygon from z0 to z1. top_scale shrinks/grows the top ring about the polygon centre, top_offset leans it."""
    poly = ccw2(poly)
    scale = scale * (2.5 if b.detail >= 1 else 1.0)
    if (not isinstance(top_scale, (list, tuple))) and abs(top_scale - 1.0) < 1e-6 and not any(top_offset):
        for i, p in enumerate(poly):
            q = poly[(i + 1) % len(poly)]
            if math.dist(p, q) < 1e-4:
                continue
            b.face([(p[0], p[1], z0), (q[0], q[1], z0), (q[0], q[1], z1), (p[0], p[1], z1)], slot, col, scale=scale)
        if top:
            cap(b, [poly], z1, True, top_slot or slot, top_col or col, scale)
        if bottom:
            cap(b, [poly], z0, False, slot, col, scale)
        return
    cx, cy = centroid2(poly)
    sx, sy = (top_scale, top_scale) if not isinstance(top_scale, (list, tuple)) else (top_scale[0], top_scale[1])
    top_ring = [(cx + (x - cx) * sx + top_offset[0], cy + (y - cy) * sy + top_offset[1], z1) for x, y in poly]
    skin(b, [[(x, y, z0) for x, y in poly], top_ring], slot, col, smooth=False, cap_first=bottom, cap_last=top, cap_col=top_col or col, scale=scale)


# ---------------------------------------------------------------------------------------------------------------- paths
def path_points(points=None, arc=None, curve=False, steps=6, sag=0.0, bulge=0.0, bulge_shape='parabola', max_points=400):
    """Sample a 3D path: `points` [[x, y, z]...] (curve=True smooths through them, `steps` per span), or arc {centre [x, y, z],
    radius, radiusY, startDeg, endDeg, rise (change along the axis), plane xy|xz|yz, steps}. sag (m, downwards) / bulge (m, upwards) bend the whole
    path in the vertical plane (cables, arches, canopy edges); bulge_shape parabola | sine | circle."""
    if arc:
        cx, cy, cz = (list(arc.get('centre') or [0, 0, 0]) + [0, 0, 0])[:3]
        rx = float(arc.get('radius', 10))
        ry = float(arc.get('radiusY', rx))
        a0, a1 = math.radians(float(arc.get('startDeg', 0))), math.radians(float(arc.get('endDeg', 180)))
        n = max(2, int(arc.get('steps', steps * 4)))
        rise = float(arc.get('rise', 0.0))
        plane = arc.get('plane', 'xy')
        if plane == 'xz':      # a vertical arch in the x-z plane: radius across, radiusY (default radius) up
            pts = [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cy + rise * i / n, cz + ry * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
        elif plane == 'yz':
            pts = [(cx + rise * i / n, cy + rx * math.cos(a0 + (a1 - a0) * i / n), cz + ry * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
        else:
            pts = [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cy + ry * math.sin(a0 + (a1 - a0) * i / n), cz + rise * i / n) for i in range(n + 1)]
    else:
        base = [tuple(float(v) for v in (list(p) + [0.0, 0.0, 0.0])[:3]) for p in (points or [])]
        if len(base) < 2:
            raise ValueError('path needs at least 2 points')
        if curve and len(base) > 2:
            pts = []
            for i in range(len(base) - 1):
                p0, p1, p2, p3 = base[max(i - 1, 0)], base[i], base[i + 1], base[min(i + 2, len(base) - 1)]
                for s in range(steps):
                    pts.append(catmull(p0, p1, p2, p3, s / steps))
            pts.append(base[-1])
        else:
            pts = []
            for i in range(len(base) - 1):
                pieces = max(1, steps if (sag or bulge) else 1)
                for s in range(pieces):
                    t = s / pieces
                    pts.append(tuple(base[i][q] + (base[i + 1][q] - base[i][q]) * t for q in range(3)))
            pts.append(base[-1])
    if sag or bulge:
        amt = float(bulge) - float(sag)
        total = [0.0]
        for i in range(1, len(pts)):
            total.append(total[-1] + math.dist(pts[i], pts[i - 1]))
        L = total[-1] or 1.0
        out = []
        for p, s in zip(pts, total):
            t = s / L
            f = 4 * t * (1 - t) if bulge_shape == 'parabola' else (math.sin(math.pi * t) if bulge_shape == 'sine' else math.sqrt(max(0.0, 1 - (2 * t - 1) ** 2)))
            out.append((p[0], p[1], p[2] + amt * f))
        pts = out
    if len(pts) > max_points:
        k = math.ceil(len(pts) / max_points)
        pts = pts[::k] + ([pts[-1]] if (len(pts) - 1) % k else [])
    return pts


def frames_along(pts, up=(0.0, 0.0, 1.0), closed=False):
    """[(origin, side, vup)] along a polyline: side is horizontal-ish (T x up), vup is `up` made perpendicular to the tangent."""
    n = len(pts)
    out = []
    for i in range(n):
        if closed:
            a, c = pts[(i - 1) % n], pts[(i + 1) % n]
        else:
            a, c = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        T = _norm(_sub(c, a))
        s = _cross(T, up)
        if _len(s) < 1e-6:
            s = _cross(T, (1.0, 0.0, 0.0) if abs(T[0]) < 0.9 else (0.0, 1.0, 0.0))
        s = _norm(s)
        v = _norm(_cross(s, T))
        out.append((pts[i], s, v))
    return out


def section_poly(sec, nround=6):
    """2D (u, v) points of a sweep section: rect [w, h] | circle r | poly [[u, v]...] | ellipse [a, b]. Origin = centre."""
    if sec.get('poly'):
        return [(float(p[0]), float(p[1])) for p in sec['poly']]
    if sec.get('rect') is not None:
        w, h = sec['rect'][0], sec['rect'][1]
        return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    if sec.get('circle') is not None or sec.get('ellipse') is not None:
        a, c = (sec['circle'], sec['circle']) if sec.get('circle') is not None else (sec['ellipse'][0], sec['ellipse'][1])
        n = int(sec.get('n') or nround)
        return [(a * math.cos(2 * math.pi * i / n), c * math.sin(2 * math.pi * i / n)) for i in range(n)]
    raise ValueError('sweep section needs rect, circle, ellipse or poly')


def sweep_path(b, section, pts, slot='plain-render', col='#d8d8d8', up=(0.0, 0.0, 1.0), roll=0.0, twist=0.0, taper=(1.0, 1.0), closed=False,
               caps=True, smooth=None, nround=6, scale=1.0):
    """Sweep a 2D section along the 3D polyline `pts`. taper (s0, s1) scales the section along the path, twist (deg) turns it over the
    path, roll (deg) turns it about the path, closed=True makes a loop (ring beam)."""
    sec = section_poly(section, nround)
    if closed and len(pts) > 2 and math.dist(pts[0], pts[-1]) < 1e-6:
        pts = pts[:-1]
    n = len(pts)
    fr = frames_along(pts, up, closed)
    total = [0.0]
    for i in range(1, n):
        total.append(total[-1] + math.dist(pts[i], pts[i - 1]))
    L = total[-1] or 1.0
    rings = []
    for i, (o, s, v) in enumerate(fr):
        t = total[i] / L
        k = taper[0] + (taper[1] - taper[0]) * t
        ang = math.radians(roll + twist * t)
        ca, sa = math.cos(ang), math.sin(ang)
        ring = []
        for (u0, v0) in sec:
            u, w = (u0 * ca - v0 * sa) * k, (u0 * sa + v0 * ca) * k
            ring.append((o[0] + s[0] * u + v[0] * w, o[1] + s[1] * u + v[1] * w, o[2] + s[2] * u + v[2] * w))
        rings.append(ring)
    if closed:
        rings.append(rings[0])
    sm = (len(sec) > 6) if smooth is None else bool(smooth)
    skin(b, rings, slot, col, smooth=sm, cap_first=caps and not closed, cap_last=caps and not closed, scale=scale, closed_path=closed)


# ---------------------------------------------------------------------------------------------------------------- revolve
def _arch_pts(shape, ou0, ou1, zs, n):
    """Arch head from the left springing to the right springing (u, z); mirrors lib.facade._arch."""
    w = ou1 - ou0
    pts = []
    if shape == 'pointed':
        half = max(2, n // 2)
        for k in range(half + 1):
            a = math.pi - (math.pi / 3) * k / half
            pts.append((ou1 + math.cos(a) * w, zs + math.sin(a) * w))
        for k in range(half - 1, -1, -1):
            a = math.pi - (math.pi / 3) * k / half
            pts.append((ou0 - math.cos(a) * w, zs + math.sin(a) * w))
    elif shape == 'rect':
        pts = [(ou0, zs), (ou1, zs)]
    else:
        cx = (ou0 + ou1) / 2
        for k in range(n + 1):
            a = math.pi * (1 - k / n)
            pts.append((cx + math.cos(a) * w / 2, zs + math.sin(a) * w / 2))
    return pts


def _arcade_band(b, r, zb, zt, spec, cx, cy, slot, col, pier_col, detail, base_phase=0.0):
    """Openings cut into a cylindrical band of radius r between zb and zt. spec: count, width (chord, m), height (opening incl. arch),
    sill (m above zb), shape arch|pointed|rect, depth (reveal), innerColour, phase (deg)."""
    N = max(3, int(spec.get('count', 8)))
    if detail >= 2:
        nf = 8
        for q in range(nf):
            ta, tb = base_phase + 2 * math.pi * q / nf, base_phase + 2 * math.pi * (q + 1) / nf
            b.facing([(cx + r * math.cos(ta), cy + r * math.sin(ta), zb), (cx + r * math.cos(tb), cy + r * math.sin(tb), zb),
                      (cx + r * math.cos(tb), cy + r * math.sin(tb), zt), (cx + r * math.cos(ta), cy + r * math.sin(ta), zt)],
                     (math.cos((ta + tb) / 2), math.sin((ta + tb) / 2), 0.0), slot, col)
        return
    w = float(spec.get('width', 1.0))
    H = zt - zb
    sill = max(0.0, float(spec.get('sill', H * 0.2)))
    oh = float(spec.get('height', H * 0.6))
    top = min(zb + sill + oh, zt - 0.12)
    shape = spec.get('shape', 'arch')
    if shape not in ('arch', 'pointed', 'rect'):
        shape = 'arch'
    depth = max(0.05, min(float(spec.get('depth', 0.35)), r * 0.5))
    inner = spec.get('innerColour') or '#3a2e26'
    dth = 2 * math.pi / N
    hw = min(w / 2, r * dth * 0.42)
    hth = hw / r
    phase = math.radians(float(spec.get('phase', 0.0))) + base_phase
    P = lambda th, z, rr=r: (cx + rr * math.cos(th), cy + rr * math.sin(th), z)
    H3 = lambda th: (math.cos(th), math.sin(th), 0.0)
    zsill = zb + sill
    arch_n = {0: 6, 1: 3}.get(detail, 2)
    if shape == 'rect':
        zs = top
        arch = [(-hw, zs), (hw, zs)]
    else:
        rise = (hw if shape == 'arch' else 0.866 * 2 * hw)
        avail = top - zsill
        k = min(1.0, 0.62 * avail / rise) if rise > 1e-6 else 1.0
        rise_eff = rise * k
        zs = top - rise_eff
        arch = _arch_pts(shape, -hw, hw, zs, arch_n)
        arch = [(u, zs + (z - zs) * k) for u, z in arch]
    outline = [(-hw, zsill), (hw, zsill)] + list(reversed(arch))
    for bay in range(N):
        th = phase + bay * dth
        # pier up to the next opening (a few facets so the band stays round)
        a0, a1 = th + hth, th + dth - hth
        pieces = max(1, math.ceil((a1 - a0) / math.radians(20)))
        for q in range(pieces):
            ta, tb = a0 + (a1 - a0) * q / pieces, a0 + (a1 - a0) * (q + 1) / pieces
            b.facing([P(ta, zb), P(tb, zb), P(tb, zt), P(ta, zt)], H3((ta + tb) / 2), slot, pier_col)
        b.facing([P(th - hth, zb), P(th + hth, zb), P(th + hth, zsill), P(th - hth, zsill)], H3(th), slot, col)
        above = [P(th + u / r, z) for u, z in arch] + [P(th + hth, zt), P(th - hth, zt)]
        b.facing(above, H3(th), slot, col)
        if detail >= 2:
            continue
        if detail == 1:
            b.facing([P(th + u / r, z, r - 0.04) for u, z in outline], H3(th), 'plain', inner, mode='fit')
            continue
        pts_o = [P(th + u / r, z) for u, z in outline]
        pts_i = [P(th + u / r, z, r - depth) for u, z in outline]
        cen = P(th, (zsill + top) / 2, r - depth * 0.5)
        for i in range(len(outline)):
            j = (i + 1) % len(outline)
            mid = tuple((pts_o[i][q] + pts_o[j][q]) / 2 for q in range(3))
            b.facing([pts_o[i], pts_o[j], pts_i[j], pts_i[i]], _sub(cen, mid), slot, shade(col, 0.78))
        b.facing(pts_i, H3(th), 'plain', inner, mode='fit')


def revolve(b, profile, n=24, slot='plain-render', col='#d8d8d8', smooth=True, close_top=True, bottom_cap=False, arcades=None, cx=0.0, cy=0.0,
            crease=35.0, cap_col=None, phase=0.0, scale=1.0, warn=None):
    """Lathe. profile: [(r, z, colour|None, slot|None)...] traced from the BOTTOM up the OUTSIDE (and over the top towards the axis):
    that makes the outside face outwards. A profile that starts higher than it ends is reversed automatically. The colour/slot of a
    point colours the segment that ENDS there. arcades: [{from, to, count, width, height, sill, shape, depth, innerColour, phase}]
    cut openings into a vertical segment (a cylinder band) between z=from and z=to."""
    pts = [(max(0.0, float(p[0])), float(p[1]), (p[2] if len(p) > 2 else None), (p[3] if len(p) > 3 else None)) for p in profile]
    if len(pts) < 2:
        return
    segs = []   # (r0, z0, r1, z1, col, slot)
    cur_c, cur_s = col, slot
    for i in range(1, len(pts)):
        if pts[i][2]:
            cur_c = pts[i][2]
        if pts[i][3]:
            cur_s = pts[i][3]
        segs.append([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], cur_c, cur_s])
    if pts[0][1] > pts[-1][1] + 1e-9:
        segs = [[s[2], s[3], s[0], s[1], s[4], s[5]] for s in reversed(segs)]
    # split vertical segments at the arcade bands
    banded = [a for a in (arcades or []) if isinstance(a, dict)]
    used = set()
    out = []
    for s in segs:
        if abs(s[0] - s[2]) < 1e-6 and banded:
            zlo, zhi = min(s[1], s[3]), max(s[1], s[3])
            hits = []
            for a in banded:
                a0 = max(zlo, float(a.get('from', zlo)))
                a1 = min(zhi, float(a.get('to', zhi)))
                if a1 - a0 > 0.25:
                    hits.append((a0, a1, a))
                    used.add(id(a))
            hits.sort(key=lambda h: h[0])
            if hits:
                z = zlo
                for a0, a1, a in hits:
                    if a0 - z > 1e-4:
                        out.append([s[0], z, s[2], a0, s[4], s[5], None])
                    out.append([s[0], a0, s[2], a1, s[4], s[5], a])
                    z = a1
                if zhi - z > 1e-4:
                    out.append([s[0], z, s[2], zhi, s[4], s[5], None])
                continue
        out.append(s + [None])
    segs = out
    if warn:
        for a in banded:
            if id(a) not in used:
                warn('revolve: an arcade matched no vertical band of the profile (needs a straight vertical stretch at least 0.25 m tall between from and to)')
    # group plain segments into smooth grids
    groups, cur = [], None
    prev_dir = None
    for s in segs:
        if s[6] is not None:
            cur = None
            prev_dir = None
            groups.append(('arcade', s))
            continue
        d = (s[2] - s[0], s[3] - s[1])
        ang = None
        if prev_dir is not None:
            dot = (d[0] * prev_dir[0] + d[1] * prev_dir[1]) / ((math.hypot(*d) * math.hypot(*prev_dir)) or 1.0)
            ang = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
        if cur is not None and cur['col'] == s[4] and cur['slot'] == s[5] and ang is not None and ang <= crease and cur['pts'][-1] == (s[0], s[1]):
            cur['pts'].append((s[2], s[3]))
        else:
            cur = {'col': s[4], 'slot': s[5], 'pts': [(s[0], s[1]), (s[2], s[3])]}
            groups.append(('grid', cur))
        prev_dir = d
    angs = [phase + 2 * math.pi * k / n for k in range(n + 1)]
    for kind, g in groups:
        if kind == 'grid':
            ptsg = g['pts']
            if all(p[0] < 1e-6 for p in ptsg):
                continue
            grid = [[(cx + r * math.cos(a), cy + r * math.sin(a), z) for (r, z) in ptsg] for a in angs]
            b.shared_grid(grid, g['slot'], g['col'], smooth=bool(smooth) and len(ptsg) >= 2, wrap=True, scale=scale)
        else:
            s = g
            _arcade_band(b, s[0], min(s[1], s[3]), max(s[1], s[3]), s[6], cx, cy, s[5], s[4], s[6].get('pierColour') or s[4], b.detail, phase)
    last = segs[-1]
    if close_top and last[2] > 1e-6:
        b.facing([(cx + last[2] * math.cos(a), cy + last[2] * math.sin(a), last[3]) for a in angs[:-1]], (0, 0, 1), last[5], cap_col or last[4], scale=scale)
    first = segs[0]
    if bottom_cap and first[0] > 1e-6:
        b.facing([(cx + first[0] * math.cos(a), cy + first[0] * math.sin(a), first[1]) for a in angs[:-1]], (0, 0, -1), first[5], first[4], scale=scale)


# ---------------------------------------------------------------------------------------------------------------- surface / shell
def _zigzag_cols(w, folds, section, ncols_extra=0):
    """x positions (0..w) and 0..1 profile heights of a folded cross-section repeated `folds` times."""
    sec = [(float(u), float(z)) for u, z in section]
    xs, zs = [], []
    for f in range(int(folds)):
        for (u, z) in sec:
            x = (f + u) * w / folds
            if xs and abs(x - xs[-1]) < 1e-9:
                continue
            xs.append(x)
            zs.append(z)
    return xs, zs


def surface_grid(kind, w, d, rise, nu=8, nv=8, folds=3, section=None, waves=2.0, phase=0.0, slope_x=0.0, slope_y=0.0, v_curve='flat',
                 v_rise=0.0, profile='spherical', circle=False, points=None, heights=None, r0=0.0, start_deg=-60.0, end_deg=60.0, foldDepth=None,
                 fold_axis='y', base=0.0):
    """Top grid of a surface over a w x d rectangle centred on 0,0 (rows run along +x, columns along +y so the top faces up), or a
    polar domain for kind 'fan' and 'dome-cap' with circle=True. kinds: folded | hypar | wave | dome-cap | conoid | fan | flat |
    points (explicit grid [[x,y,z]..] rows along x) | heights (z grid over w x d). Returns (grid, polar)."""
    if kind == 'folded' and fold_axis == 'x':
        g, _ = surface_grid(kind, d, w, rise, nu, nv, folds, section, waves, phase, slope_y, slope_x, v_curve, v_rise, profile, circle, points, heights,
                            r0, start_deg, end_deg, foldDepth, 'y', base)
        return [[(g[i][j][1], g[i][j][0], g[i][j][2]) for i in range(len(g))] for j in range(len(g[0]))], False
    a, c = w / 2.0, d / 2.0
    if kind == 'points':
        g = [[tuple(float(v) for v in p[:3]) for p in row] for row in points]
        return g, False
    if kind == 'fan':
        rr1 = max(w, d) / 2.0
        r0_ = float(r0)
        nf = max(1, int(folds))
        a0, a1 = math.radians(start_deg), math.radians(end_deg)
        fd = float(foldDepth) if foldDepth is not None else rise * 0.18
        rows = []
        for i in range(nf * 2 + 1):   # crease lines: valleys at even, ridges at odd indices
            th = a0 + (a1 - a0) * i / (nf * 2)
            tri = 1.0 if i % 2 else -1.0
            row = []
            for rr in (rr1, r0_):     # outer first so the top faces up
                k = rr / rr1
                row.append((rr * math.cos(th), rr * math.sin(th), base + rise * (1.0 - k) + fd * tri * k))
            rows.append(row)
        return rows, True
    if kind == 'dome-cap' and circle:
        rows = []
        nth = max(8, nu * 3)
        rad = [rr for rr in range(0, nv + 1)]
        for i in range(nth + 1):
            th = 2 * math.pi * i / nth
            row = []
            for kk in range(nv, -1, -1):
                t = kk / nv
                x, y = a * t * math.cos(th), c * t * math.sin(th)
                z = rise * (1 - t * t) if profile == 'parabolic' else _sph(t, rise, a)
                row.append((x, y, base + z))
            rows.append(row)
        return rows, True
    if kind == 'folded':
        sec = section or [[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]]
        xs, zs = _zigzag_cols(a * 2, folds, sec)
        us = [x - a for x in xs]
        zr = list(zs)
        along_x = True
    else:
        us = [-a + 2 * a * i / nu for i in range(nu + 1)]
        zr = None
    if kind == 'heights':
        hz = [[float(v) for v in row] for row in heights]
        R, C = len(hz), len(hz[0])
        g = [[(-a + 2 * a * i / (R - 1), -c + 2 * c * j / (C - 1), base + hz[i][j]) for j in range(C)] for i in range(R)]
        return g, False
    vs = [-c + 2 * c * j / nv for j in range(nv + 1)]
    if kind == 'folded' and v_curve == 'flat':
        vs = [-c, c]
    elif kind == 'folded':
        vs = [-c + 2 * c * j / max(4, nv) for j in range(max(4, nv) + 1)]
    grid = []
    for i, x in enumerate(us):
        row = []
        for y in vs:
            u, v = x / a, y / c
            if kind == 'folded':
                z = rise * zr[i]
            elif kind == 'hypar':
                z = rise * u * v
            elif kind == 'wave':
                z = rise * (0.5 - 0.5 * math.cos(2 * math.pi * waves * (u + 1) / 2 + phase))
            elif kind == 'dome-cap':
                t2 = min(1.0, u * u + v * v)
                z = rise * (1 - t2) if profile == 'parabolic' else _sph(math.sqrt(t2), rise, max(a, c))
            elif kind == 'conoid':
                z = rise * ((u + 1) / 2) * (1 - v * v)
            else:
                z = 0.0
            if v_curve == 'arch':
                z += v_rise * (1 - v * v)
            elif v_curve == 'sag':
                z -= v_rise * (1 - v * v)
            z += math.tan(math.radians(slope_x)) * x + math.tan(math.radians(slope_y)) * y + base
            row.append((x, y, z))
        grid.append(row)
    return grid, False


def _sph(t, rise, a):
    """Spherical cap height at normalised radius t (0 centre, 1 rim) for sagitta `rise` over half-width a."""
    if rise < 1e-6:
        return 0.0
    R = (a * a + rise * rise) / (2 * rise)
    rho = t * a
    return math.sqrt(max(0.0, R * R - rho * rho)) - (R - rise)


def shell(b, top, thickness, slot, col, under_col=None, edge_col=None, smooth=False, underside=True, scale=1.0, under_slot='plain-render'):
    """Skin a grid of top points as a thin shell: top surface (faces up), underside `thickness` below (LOD0), fascia round the edges
    (LOD0/1). Any grid shape: edges are the four boundary lines of the grid."""
    R, C = len(top), len(top[0])
    nz = 0.0
    for i in range(R - 1):
        for j in range(C - 1):
            n = newell([top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]])
            nz += n[2]
    if nz < 0:
        top = top[::-1]
    b.shared_grid(top, slot, col, smooth=smooth, scale=scale)
    if b.detail >= 2:
        return
    if b.detail == 0 and underside:
        under = [[(p[0], p[1], p[2] - thickness) for p in row[::-1]] for row in top]
        b.shared_grid(under, under_slot, under_col or shade(col, 0.6), smooth=False, scale=2.0)
    ec = edge_col or shade(col, 0.85)
    allp = [p for row in top for p in row]
    gc = (sum(p[0] for p in allp) / len(allp), sum(p[1] for p in allp) / len(allp))
    lines = [list(top[0]), list(top[-1]), [row[0] for row in top], [row[-1] for row in top]]
    for ln in lines:
        for p, q in zip(ln[:-1], ln[1:]):
            if math.dist(p, q) < 1e-4:
                continue
            mx, my = (p[0] + q[0]) / 2 - gc[0], (p[1] + q[1]) / 2 - gc[1]
            b.facing([(p[0], p[1], p[2] - thickness), (q[0], q[1], q[2] - thickness), q, p], (mx, my, 0.0), 'plain-render', ec)


# ---------------------------------------------------------------------------------------------------------------- profile extrusion
def extrude_profile(b, stations, profile, cols=None, slots=None, caps=True, cap_col=None, scale=1.0, close_first=True, close_last=True):
    """Extrude a closed (d, z) profile along stations [((x, y), (ox, oy)), ...]: d runs along the unit horizontal vector (ox, oy)
    (outwards), z is up. One quad strip per profile edge; cols/slots are per EDGE (edge i joins profile[i] and profile[i+1]).
    Faces point out of the profile whichever way it was listed."""
    prof = [(float(p[0]), float(p[1])) for p in profile]
    n = len(prof)
    sign = 1.0 if area2(prof) >= 0 else -1.0
    P = lambda st, p: (st[0][0] + st[1][0] * p[0], st[0][1] + st[1][1] * p[0], p[1])
    for i in range(n):
        p, q = prof[i], prof[(i + 1) % n]
        if math.dist(p, q) < 1e-5:
            continue
        ed, ez = q[0] - p[0], q[1] - p[1]
        nd, nzz = ez * sign, -ed * sign
        c = (cols[i] if cols and i < len(cols) and cols[i] else '#c8c8c8')
        sl = (slots[i] if slots and i < len(slots) and slots[i] else 'plain')
        kw = {'mode': 'fit'} if sl == 'plain' else {}
        for k in range(len(stations) - 1):
            s0, s1 = stations[k], stations[k + 1]
            ox, oy = (s0[1][0] + s1[1][0]) / 2, (s0[1][1] + s1[1][1]) / 2
            b.facing([P(s0, p), P(s1, p), P(s1, q), P(s0, q)], (ox * nd, oy * nd, nzz), sl, c, scale=scale, **kw)
    if caps and len(stations) >= 2:
        for (st, other, flag) in ((stations[0], stations[1], close_first), (stations[-1], stations[-2], close_last)):
            if not flag:
                continue
            ring = [P(st, p) for p in prof]
            away = (st[0][0] - other[0][0], st[0][1] - other[0][1], 0.0)
            b.facing(ring, away, 'plain', cap_col or (cols[0] if cols else '#c8c8c8'), scale=scale, mode='fit')


def stations_line(p0, p1, count, flip=False):
    """count+1 stations along p0 -> p1; outward is to the RIGHT of travel (flip: left)."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy) or 1.0
    o = (dy / L, -dx / L)
    if flip:
        o = (-o[0], -o[1])
    return [((p0[0] + dx * i / count, p0[1] + dy * i / count), o) for i in range(count + 1)]


def stations_arc(centre, rx, ry, a0, a1, count, flip=False):
    """count+1 stations along an (elliptical) arc, counter-clockwise from a0 to a1 degrees; outward is radial (flip: inward)."""
    out = []
    for i in range(count + 1):
        t = math.radians(a0 + (a1 - a0) * i / count)
        x, y = centre[0] + rx * math.cos(t), centre[1] + ry * math.sin(t)
        gx, gy = math.cos(t) / max(rx, 1e-6), math.sin(t) / max(ry, 1e-6)
        gl = math.hypot(gx, gy) or 1.0
        o = (gx / gl, gy / gl)
        if flip:
            o = (-o[0], -o[1])
        out.append(((x, y), o))
    return out


# ---------------------------------------------------------------------------------------------------------------- array
def array_placements(mode='line', count=5, start=(0.0, 0.0, 0.0), end=None, step=None, align='none', facing='none', centre=(0.0, 0.0, 0.0),
                     radius=10.0, radius_y=None, radius_end=None, start_deg=0.0, end_deg=360.0, dz=0.0, cols=3, rows=2, dx=3.0, dy=3.0,
                     centred=True, stagger=0.0, yaw=0.0):
    """-> [(x, y, z, yaw_deg, t, index)] placements in the array's local frame. modes: line | arc | grid. Yaw convention: a part's front
    faces -Y at yaw 0. facing (arc): centre = fronts look at the centre, outward = fronts look away, tangent = local x along travel
    (same as outward), none. align (line): 'line' turns the parts so local x runs along the line."""
    out = []
    if mode == 'grid':
        cols, rows = max(1, int(cols)), max(1, int(rows))
        ox = -(cols - 1) * dx / 2 if centred else 0.0
        oy = -(rows - 1) * dy / 2 if centred else 0.0
        s = (list(start) + [0, 0, 0])[:3]
        i = 0
        for r in range(rows):
            for c in range(cols):
                off = stagger * dx if (r % 2 and stagger) else 0.0
                out.append((s[0] + ox + c * dx + off, s[1] + oy + r * dy, s[2], yaw, (i / max(1, cols * rows - 1)), i))
                i += 1
        return out
    n = max(1, int(count))
    if mode in ('arc', 'circle'):
        c = (list(centre) + [0, 0, 0])[:3]
        sweep = float(end_deg) - float(start_deg)
        full = abs(sweep) >= 359.999
        denom = n if full else max(1, n - 1)
        ry = radius if radius_y is None else radius_y
        for i in range(n):
            t = i / denom
            th = math.radians(start_deg + sweep * t)
            rr = radius if radius_end is None else radius + (radius_end - radius) * t
            rry = ry if radius_end is None else ry + (radius_end - ry) * t
            x, y = c[0] + rr * math.cos(th), c[1] + rry * math.sin(th)
            deg = math.degrees(th)
            if abs(rry - rr) > 1e-6:   # ellipse: use the true outward normal
                deg = math.degrees(math.atan2(math.sin(th) / rry, math.cos(th) / rr))
            if facing == 'centre':
                yw = deg - 90.0
            elif facing in ('outward', 'tangent'):
                yw = deg + 90.0
            else:
                yw = 0.0
            out.append((x, y, c[2] + dz * t, yw + yaw, t, i))
        return out
    s = (list(start) + [0, 0, 0])[:3]
    if end is not None:
        e = (list(end) + [0, 0, 0])[:3]
        stp = ((e[0] - s[0]) / max(1, n - 1), (e[1] - s[1]) / max(1, n - 1), (e[2] - s[2]) / max(1, n - 1))
    else:
        stp = (list(step or (3.0, 0.0, 0.0)) + [0, 0, 0])[:3]
    heading = math.degrees(math.atan2(stp[1], stp[0])) if align == 'line' else 0.0
    for i in range(n):
        out.append((s[0] + stp[0] * i, s[1] + stp[1] * i, s[2] + stp[2] * i, heading + yaw, i / max(1, n - 1), i))
    return out
