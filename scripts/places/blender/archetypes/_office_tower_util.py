"""Private helpers shared by the office-tower, office-low, hotel, industrial, transport-station and manor archetypes.

Everything here is deterministic and LOD-aware (b.detail 0/1/2). Random numbers come from `Streams` (one sub-stream per named part), so a
decision made for one part never shifts the draws of another and every LOD sees identical choices.
"""
import math
import random
import re
import zlib

import lib


# ---------------------------------------------------------------------------------------------------------------- brief helpers
class Streams:
    """Named, order-independent random sub-streams derived from the job rng (call once at the top of build())."""

    def __init__(self, rng):
        self.base = rng.getrandbits(64)

    def get(self, key):
        return random.Random(self.base ^ zlib.crc32(key.encode()))


def feat(brief):
    out = {}
    for f in brief.get('features') or []:
        if isinstance(f, dict):
            out[f.get('id')] = f
        elif isinstance(f, str):
            out[f] = {'id': f, 'count': 1}
    return out


def fcount(feats, fid, default=1):
    f = feats.get(fid)
    if not f:
        return 0
    try:
        return int(f.get('count') or default)
    except (TypeError, ValueError):
        return default


def text(brief):
    return ' '.join(str(brief.get(k, '')) for k in ('subject', 'notes', 'name', 'era')).lower() + ' ' + ' '.join(
        str(f.get('note', '')) for f in (brief.get('features') or []) if isinstance(f, dict)).lower()


def fnum(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def year_of(brief, default=2005):
    m = re.search(r'(1[5-9]\d\d|20\d\d)', str(brief.get('era', '')))
    return int(m.group(1)) if m else default


def form_of(brief):
    return brief.get('form') or {}


def style_of(brief):
    return str(brief.get('style') or 'contemporary').lower()


def has_word(txt, *words):
    return any(w in txt for w in words)


# ---------------------------------------------------------------------------------------------------------------- flat quads
def flatq(b, pts, col, hint=None, slot='plain'):
    """One flat-coloured quad/polygon (no tile cutting). hint = outward direction when the winding is unknown."""
    if hint is not None:
        b.facing(pts, hint, slot, col, mode='fit')
    else:
        b.face(pts, slot, col, mode='fit')


def plain(b, seg, u0, u1, z0, z1, slot, col, d=0.0, scale=None):
    """A wall quad textured with a wall slot at a coarse scale (large walls stay cheap)."""
    if u1 - u0 < 1e-3 or z1 - z0 < 1e-3:
        return
    sc = scale
    if sc is None:
        sc = {'brick': 2.0, 'stone-blocks': 2.0, 'timber': 2.0, 'corrugated': 2.0, 'clay-tile': 2.0, 'slate': 2.0}.get(slot, 3.0)
        if b.detail >= 1:
            sc *= 2
    b.face([seg.P(u0, z0, d), seg.P(u1, z0, d), seg.P(u1, z1, d), seg.P(u0, z1, d)], slot, col, scale=sc)


def tiles(b, seg, u0, u1, z0, z1, slot, col, tu, tv, zb=None, d=0.0, ub=0.0):
    """A wall quad whose texture tile is exactly tu x tv metres (origin at the wall start / z = zb)."""
    if u1 - u0 < 1e-3 or z1 - z0 < 1e-3:
        return
    zb = z0 if zb is None else zb
    pts = [seg.P(u0, z0, d), seg.P(u1, z0, d), seg.P(u1, z1, d), seg.P(u0, z1, d)]
    uvs = [((u0 - ub) / tu, (z0 - zb) / tv), ((u1 - ub) / tu, (z0 - zb) / tv), ((u1 - ub) / tu, (z1 - zb) / tv), ((u0 - ub) / tu, (z1 - zb) / tv)]
    b.face(pts, slot, col, mode='tile', uvs=uvs)


def sbox(b, seg, u0, u1, z0, z1, proud, col, skip_ends=False, top_col=None):
    """A flat-coloured box standing `proud` metres out of a wall (front, top, bottom, ends): fins, slab edges, canopies."""
    if u1 - u0 < 1e-3 or z1 - z0 < 1e-3:
        return
    d0 = -proud
    b.face([seg.P(u0, z0, d0), seg.P(u1, z0, d0), seg.P(u1, z1, d0), seg.P(u0, z1, d0)], 'plain', col, mode='fit')
    b.facing([seg.P(u0, z1, d0), seg.P(u1, z1, d0), seg.P(u1, z1, 0), seg.P(u0, z1, 0)], (0, 0, 1), 'plain', top_col or lib.shade(col, 1.08), mode='fit')
    if b.detail == 0:
        b.facing([seg.P(u0, z0, d0), seg.P(u1, z0, d0), seg.P(u1, z0, 0), seg.P(u0, z0, 0)], (0, 0, -1), 'plain', lib.shade(col, 0.72), mode='fit')
        if not skip_ends:
            b.facing([seg.P(u0, z0, d0), seg.P(u0, z1, d0), seg.P(u0, z1, 0), seg.P(u0, z0, 0)], (-seg.u[0], -seg.u[1], 0), 'plain', lib.shade(col, 0.88), mode='fit')
            b.facing([seg.P(u1, z0, d0), seg.P(u1, z1, d0), seg.P(u1, z1, 0), seg.P(u1, z0, 0)], (seg.u[0], seg.u[1], 0), 'plain', lib.shade(col, 0.88), mode='fit')


# ---------------------------------------------------------------------------------------------------------------- tower skins
def skin(b, seg, z0, z1, floors, kind, lk, ratio=0.5, ws=None, wc=None, gc=None, group=1, mult=1.0, fins=0.0, deep=False, bands=None,
         bay=3.4, reduced=False, fin_col=None, corner=0.5):
    """One wall of a multi-storey mass. kind: curtain | ribbon | punched | screen | none. Costs a few triangles per storey per bay at
    LOD0; LOD1 (and `reduced` walls) group `group` storeys into one tile."""
    L = seg.length
    H = z1 - z0
    floors = max(1, int(floors))
    fh = H / floors
    ws = ws or lk.wall_slot
    wc = wc or lk.wall_col
    gc = gc or lk.glass_col
    d = b.detail
    if L < 0.3:
        return
    if d >= 2 or kind in (None, 'none'):
        plain(b, seg, 0, L, z0, z1, ws, wc)
        return
    g = group if (d == 1 or reduced) else 1
    g = max(1, min(g, floors))
    fin_col = fin_col or wc
    if kind in ('curtain', 'screen'):
        tv = fh * g
        nu = max(1, round(L / (3.0 * (tv / 3.6) * mult)))
        tiles(b, seg, 0, L, z0, z1, lk.glass_slot, gc, L / nu, tv, z0)
        if d == 0 and not reduced:
            pitch = fins if fins > 0 else (1.8 if kind == 'screen' else 0.0)
            if pitch > 0:
                n = max(1, int(L / pitch))
                for k in range(n + 1):
                    u = min(max(k * L / n, 0.12), L - 0.12)
                    sbox(b, seg, u - 0.1, u + 0.1, z0, z1, 0.32 if kind == 'screen' else 0.38, fin_col, skip_ends=True)
            if bands:
                for f in range(1, floors):
                    za = z0 + f * fh
                    sbox(b, seg, 0, L, za - bands[0] / 2, za + bands[0] / 2, bands[2] if len(bands) > 2 else 0.12, bands[1], skip_ends=True)
        return
    if kind == 'ribbon':
        plain(b, seg, 0, L, z0, z1, ws, wc)
        u0, u1 = (corner, L - corner) if L > 4 * corner else (0.0, L)
        for f in range(0, floors, g):
            za = z0 + f * fh
            zb_ = min(z1, za + g * fh)
            hh = zb_ - za
            bh = hh * clamp(ratio, 0.28, 0.72)
            sill = za + (hh - bh) * 0.5
            nu = max(1, round((u1 - u0) / (4.0 * (bh / 1.2) * mult)))
            tiles(b, seg, u0, u1, sill, sill + bh, 'glass-ribbon', gc, (u1 - u0) / nu, bh, sill, d=-0.04, ub=u0)
            if d == 0 and not reduced and deep:
                sbox(b, seg, 0, L, za - 0.12, za + (hh - bh) * 0.5, 0.55 if deep is True else deep, bands[1] if bands else wc, skip_ends=True)
            elif d == 0 and not reduced and f > 0:
                sbox(b, seg, 0, L, za - 0.16, za + 0.16, 0.14, bands[1] if bands else lk.trim_col, skip_ends=True)
        _piers(b, seg, z0, z1, L, fins, fin_col, d, reduced)
        return
    # punched windows (default)
    plain(b, seg, 0, L, z0, z1, ws, wc)
    bw = bay * (1.0 if (d == 0 and not reduced) else 1.0) * mult
    nb = max(1, round(L / bw))
    bw = L / nb
    if d == 0 and not reduced:
        oh = min(fh * 0.58, 2.2)
        ow = clamp(ratio * bw * fh / oh, 0.8, bw - 0.9)
        for f in range(floors):
            sill = z0 + f * fh + (fh - oh) * 0.42
            if deep and floors * nb <= 100:
                for k in range(nb):
                    c = (k + 0.5) * bw
                    b.face([seg.P(c - ow / 2, sill, -0.04), seg.P(c + ow / 2, sill, -0.04), seg.P(c + ow / 2, sill + oh, -0.04), seg.P(c - ow / 2, sill + oh, -0.04)], 'glass-punched', gc, mode='fit')
                    sbox(b, seg, c - ow / 2 - 0.14, c + ow / 2 + 0.14, sill - 0.16, sill, 0.3, lib.shade(wc, 0.8), skip_ends=True)
                    sbox(b, seg, c - ow / 2 - 0.14, c + ow / 2 + 0.14, sill + oh, sill + oh + 0.24, 0.3, lib.shade(wc, 0.78), skip_ends=True)
            else:
                for k in range(nb):
                    c = (k + 0.5) * bw
                    b.face([seg.P(c - ow / 2, sill, -0.04), seg.P(c + ow / 2, sill, -0.04), seg.P(c + ow / 2, sill + oh, -0.04), seg.P(c - ow / 2, sill + oh, -0.04)],
                           'glass-punched', gc, mode='fit')
                    if f == 0 or floors * nb <= 200:
                        sbox(b, seg, c - ow / 2 - 0.08, c + ow / 2 + 0.08, sill - 0.1, sill, 0.1, lk.trim_col, skip_ends=True)
    else:
        tv = fh * g
        nu = max(1, round(L / (bw * g)))
        tiles(b, seg, 0, L, z0, z1, 'glass-punched', lib.mix(wc, '#9aa4ac', 0.25), L / nu, tv, z0, d=-0.02)
    _piers(b, seg, z0, z1, L, fins, fin_col, d, reduced, between=bw)


def _piers(b, seg, z0, z1, L, fins, col, d, reduced, between=None):
    if fins <= 0 or d > 0 or reduced:
        return
    pitch = between or fins
    n = max(1, round(L / pitch))
    for k in range(n + 1):
        u = min(max(k * L / n, 0.15), L - 0.15)
        sbox(b, seg, u - 0.15, u + 0.15, z0, z1, 0.3, col, skip_ends=True)


def seg_window(b, seg, u0, u1, zb, zt, lk, depth, gc, wc):
    """A recessed window: four reveal faces and a glass pane at `depth`."""
    dark = lib.shade(wc, 0.72)
    d = depth
    b.facing([seg.P(u0, zb), seg.P(u0, zt), seg.P(u0, zt, d), seg.P(u0, zb, d)], (seg.u[0], seg.u[1], 0), 'plain', dark, mode='fit')
    b.facing([seg.P(u1, zb), seg.P(u1, zt), seg.P(u1, zt, d), seg.P(u1, zb, d)], (-seg.u[0], -seg.u[1], 0), 'plain', dark, mode='fit')
    b.facing([seg.P(u0, zb), seg.P(u1, zb), seg.P(u1, zb, d), seg.P(u0, zb, d)], (0, 0, 1), 'plain', lib.shade(wc, 0.9), mode='fit')
    b.facing([seg.P(u0, zt), seg.P(u1, zt), seg.P(u1, zt, d), seg.P(u0, zt, d)], (0, 0, -1), 'plain', dark, mode='fit')
    b.face([seg.P(u0, zb, d), seg.P(u1, zb, d), seg.P(u1, zt, d), seg.P(u0, zt, d)], 'glass-punched', gc, mode='fit')


def mass_walls(b, fp, z0, z1, floors, kind, lk, front_kind=None, **kw):
    """Skin every wall of a footprint with `skin`. Rear walls (facing +Y) are reduced at LOD0."""
    kw.setdefault('group', 2)
    for seg in fp.edges():
        k = front_kind if (seg.front and front_kind) else kind
        skin(b, seg, z0, z1, floors, k, lk, reduced=(seg.rear and b.detail == 0), **kw)


def ring_poly(cx, cy, rx, ry, n, rot=0.0):
    return [(cx + rx * math.cos(rot + 2 * math.pi * i / n), cy + ry * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


def loft(b, rings, zs, slot, col, tile_w, tile_h, hint_up=False):
    """Skin between successive rings (CCW polygons with the same vertex count) at heights zs; texture tile = tile_w x tile_h metres."""
    n = len(rings[0])
    for k in range(len(rings) - 1):
        for i in range(n):
            j = (i + 1) % n
            p0, p1, q1, q0 = rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]
            ul = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            nu = max(1, round(ul / tile_w))
            v0, v1 = (zs[k] - zs[0]) / tile_h, (zs[k + 1] - zs[0]) / tile_h
            pts = [(p0[0], p0[1], zs[k]), (p1[0], p1[1], zs[k]), (q1[0], q1[1], zs[k + 1]), (q0[0], q0[1], zs[k + 1])]
            if slot.startswith('glass') and not b.flat:
                b.face(pts, slot, col, mode='tile', uvs=[(0, v0), (nu, v0), (nu, v1), (0, v1)])
            else:
                b.face(pts, slot, col, scale=3.0)


# ---------------------------------------------------------------------------------------------------------------- roof furniture
def plant_box(b, lk, cx, cy, z, w, d, h, col=None, slot='metal-cladding'):
    box_c(b, cx, cy, z, w, d, h, slot, col or lk.metal_col, top_slot='roof-flat', top_col=lib.shade(col or lk.metal_col, 0.9), skip=('bottom',))


def water_tank(b, x, y, z, r=1.4, h=2.4, col='#3f5f7a'):
    """A roof/yard water tank: a cylinder on four legs with a domed lid."""
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, z + 1.0, z + 1.0 + h, r, n=10 if b.detail == 0 else 6, slot='plain', col=col, r_top=r * 0.98, top=False, smooth=True)
    lib.cylinder(b, x, y, z + 1.0 + h, z + 1.0 + h + 0.5, r * 0.98, n=10 if b.detail == 0 else 6, slot='plain', col=lib.shade(col, 1.15), r_top=r * 0.35, top=True, smooth=False)
    if b.detail == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.cylinder(b, x + sx * r * 0.7, y + sy * r * 0.7, z, z + 1.0, 0.08, n=4, slot='frame', col='#6e7378', top=False)
        lib.cylinder(b, x, y, z + 0.9, z + 1.0, r * 1.05, n=10, slot='plain', col='#5a5f64', r_top=r * 1.05, top=True, smooth=False)


def mast(b, x, y, z, h, r=0.25, col='#c9ced2', banded=True):
    """A slim lattice-style mast: tapered pole, cross arms at three heights, red/white obstruction bands."""
    if b.detail >= 2:
        lib.cylinder(b, x, y, z, z + h, r, n=4, slot='plain', col=col, r_top=r * 0.3, top=False, smooth=False)
        return
    segs = 4 if banded else 1
    for k in range(segs):
        a, c = z + h * k / segs, z + h * (k + 1) / segs
        rr0, rr1 = r * (1 - 0.7 * k / segs), r * (1 - 0.7 * (k + 1) / segs)
        colk = '#c8362f' if (banded and k % 2 == 0) else col
        lib.cylinder(b, x, y, a, c, rr0, n=6 if b.detail == 0 else 4, slot='frame', col=colk, r_top=rr1, top=False, smooth=False)
    if b.detail == 0:
        for f in (0.45, 0.7, 0.9):
            zz = z + h * f
            box_c(b, x, y, zz, r * 9 * (1.1 - f * 0.6), 0.07, 0.07, 'plain', '#8d9298', skip=())
            box_c(b, x, y, zz + 0.2, 0.07, r * 9 * (1.1 - f * 0.6), 0.07, 'plain', '#8d9298', skip=())


def helipad(b, x, y, z, r=7.0, col='#6a6e72'):
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, z, z + 0.35, r, n=16 if b.detail == 0 else 8, slot='plain', col=col, r_top=r, top=True, smooth=False)
    if b.detail == 0:
        lib.cylinder(b, x, y, z + 0.36, z + 0.37, r * 0.82, n=16, slot='plain', col='#f1eee4', r_top=r * 0.82, top=True, smooth=False)
        lib.cylinder(b, x, y, z + 0.371, z + 0.38, r * 0.74, n=16, slot='plain', col=col, r_top=r * 0.74, top=True, smooth=False)
        for sx in (-1, 1):
            b.face([(x + sx * 1.2 - 0.25, y - 1.8, z + 0.39), (x + sx * 1.2 + 0.25, y - 1.8, z + 0.39), (x + sx * 1.2 + 0.25, y + 1.8, z + 0.39), (x + sx * 1.2 - 0.25, y + 1.8, z + 0.39)][::-1], 'plain', '#f1eee4', mode='fit')
        b.face([(x - 1.2, y - 0.25, z + 0.39), (x + 1.2, y - 0.25, z + 0.39), (x + 1.2, y + 0.25, z + 0.39), (x - 1.2, y + 0.25, z + 0.39)][::-1], 'plain', '#f1eee4', mode='fit')


def flagpole(b, x, y, h, col, face=-1.0):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.07, n=5, slot='frame', col='#b8bcc0', r_top=0.05, top=True)
        pts = [(x + 0.05, y, h - 1.6), (x + 2.0, y, h - 1.5), (x + 2.0, y, h - 0.2), (x + 0.05, y, h)]
        b.facing(pts, (0, -1, 0), 'plain', col)
        b.facing(pts, (0, 1, 0), 'plain', lib.shade(col, 0.85))


def floodlight(b, x, y, h=16):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.2, n=6, slot='frame', col='#8d9298', r_top=0.12, top=True)
        box_c(b, x, y, h, 3.0, 0.5, 1.3, 'plain', '#3d4146')


# ---------------------------------------------------------------------------------------------------------------- site: fences, vehicles
def fence(b, lk, pts, h=2.2, col=None, pillar_every=5.0, closed=False, rail_col='#3a3d41', gate=None, solid=0.7):
    """A boundary wall of `solid` m of masonry topped with railings, with pillars. pts: polyline of (x, y). gate = (index of the segment,
    centre fraction 0..1, width) leaves an opening with two taller gate piers. Site geometry (skipped at LOD2)."""
    if b.detail >= 2:
        return
    col = col or lk.wall_col
    with b.site():
        n = len(pts) if closed else len(pts) - 1
        for i in range(n):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            if L < 0.5:
                continue
            ux, uy = (q[0] - p[0]) / L, (q[1] - p[1]) / L
            ranges = [(0.0, L)]
            if gate and gate[0] == i:
                c, w = gate[1] * L, gate[2]
                ranges = [(0.0, max(0.0, c - w / 2)), (min(L, c + w / 2), L)]
                for gc_ in (c - w / 2, c + w / 2):
                    gx, gy = p[0] + ux * gc_, p[1] + uy * gc_
                    box_c(b, gx, gy, 0, 0.7, 0.7, h + 0.7, 'plain-render', lib.shade(col, 1.05), top_col=lib.shade(col, 0.85))
            for (a, c) in ranges:
                if c - a < 0.3:
                    continue
                cx, cy = p[0] + ux * (a + c) / 2, p[1] + uy * (a + c) / 2
                yaw = math.atan2(uy, ux)
                if b.detail == 0:
                    obox(b, cx, cy, 0, c - a, 0.3, solid, yaw, 'plain-render', col, top_col=lib.shade(col, 0.9), scale=2.0)
                else:
                    obox(b, cx, cy, 0, c - a, 0.3, solid + 1.4, yaw, 'plain', col, top_col=lib.shade(col, 0.9))
                if b.detail == 0 and h > solid:
                    obox(b, cx, cy, solid, c - a, 0.06, h - solid, yaw, 'plain', rail_col, skip=('bottom', 'top'))
                    npil = int((c - a) / pillar_every) + 1
                    for k in range(npil + 1):
                        t = a + (c - a) * k / max(1, npil)
                        box_c(b, p[0] + ux * t, p[1] + uy * t, 0, 0.4, 0.4, h, 'plain-render', lib.shade(col, 1.04), top_col=lib.shade(col, 0.85))


def rect_pts(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def van(b, x, y, yaw, col, length=5.2, width=1.9, height=2.3, stripe=None, roof_rack=False):
    """A minibus / danfo-style van (about 5 x 1.9 x 2.3 m): body, glazed band, roof, dark chassis."""
    if b.detail >= 2:
        return
    with b.site():
        c, s = math.cos(yaw), math.sin(yaw)
        obox(b, x, y, 0.38, length, width, height * 0.62, yaw, 'plain', col, top_col=lib.shade(col, 1.05))
        obox(b, x - c * 0.05, y - s * 0.05, 0.38 + height * 0.62, length * 0.94, width * 0.98, height * 0.34 - 0.0, yaw, 'plain', '#26313a', top_col=lib.shade(col, 1.02))
        if b.detail == 0:
            obox(b, x, y, 0.1, length * 0.95, width * 0.9, 0.35, yaw, 'plain', '#1d1e20')
            if stripe:
                obox(b, x, y, 0.38 + height * 0.2, length * 1.002, width * 1.002, height * 0.12, yaw, 'plain', stripe, skip=('bottom', 'top'))
            obox(b, x + c * 0.3, y + s * 0.3, 0.38 + height * 0.62 + height * 0.34 - 0.02, length * 0.9, width * 0.96, 0.1, yaw, 'plain', lib.shade(col, 0.92))


def coach(b, x, y, yaw, col, length=11.5, width=2.55, height=3.4, stripe='#c8362f'):
    """An intercity coach (about 11.5 x 2.55 x 3.4 m)."""
    if b.detail >= 2:
        return
    with b.site():
        obox(b, x, y, 0.45, length, width, height * 0.5, yaw, 'plain', col, top_col=lib.shade(col, 1.04))
        obox(b, x, y, 0.45 + height * 0.5, length * 0.985, width * 0.985, height * 0.34, yaw, 'plain', '#26313a', top_col=lib.shade(col, 1.04))
        obox(b, x, y, 0.45 + height * 0.5 + height * 0.34, length * 0.98, width * 0.97, 0.18, yaw, 'plain', lib.shade(col, 0.95))
        if b.detail == 0:
            obox(b, x, y, 0.12, length * 0.94, width * 0.88, 0.4, yaw, 'plain', '#1d1e20')
            if stripe:
                obox(b, x, y, 0.45 + height * 0.18, length * 1.002, width * 1.002, height * 0.1, yaw, 'plain', stripe, skip=('bottom', 'top'))


def truck(b, x, y, yaw, col, cab_col='#c9ccd0', length=8.0):
    if b.detail >= 2:
        return
    with b.site():
        c, s = math.cos(yaw), math.sin(yaw)
        obox(b, x - c * 1.0, y - s * 1.0, 0.6, length - 2.2, 2.5, 2.6, yaw, 'plain', col, top_col=lib.shade(col, 1.06))
        obox(b, x + c * (length / 2 - 0.9), y + s * (length / 2 - 0.9), 0.55, 1.9, 2.4, 2.1, yaw, 'plain', cab_col)
        if b.detail == 0:
            obox(b, x, y, 0.2, length * 0.95, 1.9, 0.4, yaw, 'plain', '#1d1e20')


def boat(b, x, y, yaw, col, length=9.0, width=2.6):
    """A small passenger launch / pirogue-style boat: tapered hull, cabin and canopy."""
    if b.detail >= 2:
        return
    with b.site():
        c, s = math.cos(yaw), math.sin(yaw)
        P = lambda lx, ly, z: (x + c * lx - s * ly, y + s * lx + c * ly, z)
        hw = width / 2
        L2 = length / 2
        deck = 0.9
        # hull as a prism: bow points along +local x
        top = [P(-L2, -hw, deck), P(L2 * 0.55, -hw, deck), P(L2, 0, deck), P(L2 * 0.55, hw, deck), P(-L2, hw, deck)]
        bot = [P(-L2 * 0.9, -hw * 0.6, 0.0), P(L2 * 0.5, -hw * 0.6, 0.0), P(L2 * 0.92, 0, 0.1), P(L2 * 0.5, hw * 0.6, 0.0), P(-L2 * 0.9, hw * 0.6, 0.0)]
        n = len(top)
        for i in range(n):
            j = (i + 1) % n
            b.facing([bot[i], bot[j], top[j], top[i]], (math.cos(0) * 0 + (top[i][0] + top[j][0]) / 2 - x, (top[i][1] + top[j][1]) / 2 - y, 0), 'plain', col)
        b.facing(top, (0, 0, 1), 'plain', lib.shade(col, 1.2))
        obox(b, x - c * 0.6, y - s * 0.6, deck, length * 0.45, width * 0.7, 1.5, yaw, 'plain', '#e9ecef', top_col='#d8dcdf')
        if b.detail == 0:
            obox(b, x + c * 0.9, y + s * 0.9, deck + 1.55, length * 0.2, width * 0.9, 0.12, yaw, 'plain', '#3d6a8f')


def row_of(b, fn, x0, y0, x1, y1, n, **kw):
    for k in range(n):
        t = k / max(1, n - 1)
        fn(b, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, **kw)


def trees_along(b, lk, S, x0, x1, y, n, hmin=6.0, hmax=9.0, kind=None, jitter_y=1.5):
    """A row of trees from x0 to x1 at y (site geometry; LOD1 gets half of them, LOD2 none)."""
    kind = kind or lk.tree
    if kind in (None, 'none') or b.detail >= 2:
        return
    rs = S.get('trees')
    items = []
    for k in range(n):
        items.append((x0 + (x1 - x0) * (k + 0.5) / n + rs.uniform(-1.5, 1.5), y + rs.uniform(-jitter_y, jitter_y), rs.uniform(hmin, hmax)))
    for k, (tx, ty, th) in enumerate(items):
        if b.detail == 1 and k % 2:
            continue
        lib.tree(b, kind, tx, ty, th, S.get('tree%d' % k), lk)


def parked_cars(b, lk, S, x0, x1, y, n, yaw=math.pi / 2, key='cars'):
    if b.detail >= 2:
        return
    rs = S.get(key)
    cols = ['#c9ccd0', '#2a2d33', '#8a1f1f', '#e6e6e6', '#27456e', '#6b6e72', '#e0c25a', '#3c6b49']
    for k in range(n):
        cx = x0 + (x1 - x0) * (k + 0.5) / n
        col = rs.choice(cols)
        if b.detail == 1 and k % 2:
            continue
        lib.car(b, cx, y, yaw + rs.uniform(-0.03, 0.03), col, rs)


def ground_pad(b, lk, x0, y0, x1, y1, slot=None, col=None):
    lib.ground(b, x0, y0, x1, y1, lk, slot, col)


def front_road(b, lk, S, x0, x1, y_kerb, width=9.0):
    """An asphalt road strip with kerb line in front of the plot (y_kerb is the plot-side edge, road lies at lower y)."""
    lib.forecourt(b, 'road', x0, y_kerb - width, x1, y_kerb, lk, S.get('road'))


def street_lamps(b, lk, x0, x1, y, n):
    if b.detail >= 1:
        return
    for k in range(n):
        lib.lamp(b, x0 + (x1 - x0) * (k + 0.5) / n, y, 7.5, lk)


# ---------------------------------------------------------------------------------------------------------------- low-rise parts
def awning(b, x0, x1, y_wall, z, depth=2.2, cols=('#d8d2c4', '#8a2f2a'), drop=0.9, stripes=None):
    """Sloping striped fabric awning projecting towards -Y from a wall at y_wall (top edge at z)."""
    if b.detail >= 2:
        return
    n = stripes or max(2, int((x1 - x0) / 0.9))
    if b.detail == 1:
        n = min(n, 4)
    for k in range(n):
        xa, xb = x0 + (x1 - x0) * k / n, x0 + (x1 - x0) * (k + 1) / n
        pts = [(xa, y_wall, z), (xb, y_wall, z), (xb, y_wall - depth, z - drop), (xa, y_wall - depth, z - drop)]
        b.facing(pts, (0, -1, 1), 'plain', cols[k % 2], mode='fit')
    if b.detail == 0:
        pts = [(x0, y_wall - depth, z - drop), (x1, y_wall - depth, z - drop), (x1, y_wall - depth, z - drop - 0.25), (x0, y_wall - depth, z - drop - 0.25)]
        b.facing(pts, (0, -1, 0), 'plain', lib.shade(cols[1], 0.9), mode='fit')


def booth(b, x, y, w, d, h, col, glass_col='#cfd8dd', sign_col=None):
    """A small ATM / guard booth: box with a glazed front and a blank sign band."""
    box_c(b, x, y, 0, w, d, h, 'plain-render', col, top_slot='roof-flat', top_col=lib.shade(col, 0.85), skip=('bottom',))
    if b.detail == 0:
        b.face([(x - w * 0.36, y - d / 2 - 0.03, 0.6), (x + w * 0.36, y - d / 2 - 0.03, 0.6), (x + w * 0.36, y - d / 2 - 0.03, h - 0.5), (x - w * 0.36, y - d / 2 - 0.03, h - 0.5)],
               'glass-shopfront', glass_col)
        if sign_col:
            box_c(b, x, y - d / 2 - 0.05, h - 0.45, w * 0.9, 0.12, 0.38, 'plain', sign_col, skip=('bottom',))


def sign_box(b, cx, y, z, w, h, col='#2f5f8a'):
    """A blank rooftop / wall sign box (no lettering)."""
    box_c(b, cx, y, z, w, 0.35, h, 'plain', col, top_col=lib.shade(col, 1.1), skip=('bottom',))


def pylon_sign(b, x, y, h=7.0, w=2.0, col='#2f5f8a'):
    if b.detail >= 2:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.2, n=6, slot='frame', col='#7d8286', r_top=0.2, top=False)
        box_c(b, x, y, h - 2.6, w, 0.3, 2.6, 'plain', col, top_col=lib.shade(col, 1.1), skip=('bottom',))


def veranda(b, lk, x0, x1, y_wall, z_top, depth, count, kind='posts', roof_col=None, roof_slot=None, col=None, ground_z=0.0):
    """A verandah along the front of a wall at y_wall: columns or arches carrying a sloping roof. `z_top` is the eave height at the
    outer edge; the roof meets the wall about 1 m higher."""
    col = col or lk.trim_col
    n = max(2, count)
    r = 0.22
    if b.detail >= 1:
        n = max(2, n // 2)
    xs = [x0 + 0.3 + (x1 - x0 - 0.6) * k / (n - 1) for k in range(n)]
    yo = y_wall - depth
    for x in xs:
        if kind == 'square':
            lib.column(b, x, yo + 0.3, ground_z, z_top - 0.35, 0.22, lk, 'square', capital=False, slot='plain-render', col=col)
        else:
            lib.column(b, x, yo + 0.3, ground_z, z_top - 0.35, r, lk, 'round', capital=b.detail == 0, slot='plain-render', col=col)
    if kind == 'arch' and b.detail < 1:
        for k in range(n - 1):
            xa, xb = xs[k], xs[k + 1]
            cx_ = (xa + xb) / 2
            rr = (xb - xa) / 2
            pts = [(cx_ + math.cos(math.pi * (1 - j / 6)) * rr, yo + 0.3, z_top - 0.35 - rr * 0.6 + math.sin(math.pi * (1 - j / 6)) * rr * 0.6) for j in range(7)]
            top = [(xb, yo + 0.3, z_top - 0.35), (xa, yo + 0.3, z_top - 0.35)]
            b.facing(pts + top, (0, -1, 0), 'plain-render', col, mode='fit')
    # beam + roof
    box(b, x0, yo, z_top - 0.4, x1, yo + 0.4, z_top, 'plain-render', lib.shade(col, 0.95), skip=())
    z_hi = z_top + 1.1
    rc = roof_col or lk.roof_col
    pts = [(x0 - 0.2, yo - 0.3, z_top - 0.05), (x1 + 0.2, yo - 0.3, z_top - 0.05), (x1 + 0.2, y_wall, z_hi), (x0 - 0.2, y_wall, z_hi)]
    b.facing(pts, (0, -1, 3), roof_slot or lk.roof_slot, rc)
    if b.detail == 0:
        b.facing([(x0 - 0.2, yo - 0.3, z_top - 0.2), (x1 + 0.2, yo - 0.3, z_top - 0.2), (x1 + 0.2, y_wall, z_hi - 0.15), (x0 - 0.2, y_wall, z_hi - 0.15)], (0, 1, -3), 'plain-render', lib.shade(col, 0.7), mode='fit')
        for sx in (x0 - 0.2, x1 + 0.2):
            b.facing([(sx, yo - 0.3, z_top - 0.2), (sx, yo - 0.3, z_top - 0.05), (sx, y_wall, z_hi), (sx, y_wall, z_hi - 0.15)], (math.copysign(1, sx - (x0 + x1) / 2), 0, 0), 'plain-render', lib.shade(col, 0.8), mode='fit')


def relief_band(b, seg, z0, z1, col, n=None, d=0.05, kind='diamond'):
    """A band of geometric relief (diamonds / triangles / zig-zag) on a wall: Hausa-Arewa and Sahelian parapets."""
    if b.detail >= 2:
        return
    L = seg.length
    n = n or max(2, int(L / (z1 - z0) / 1.0))
    if b.detail == 1:
        n = max(2, n // 2)
    w = L / n
    hm = (z0 + z1) / 2
    for k in range(n):
        ua, ub = k * w, (k + 1) * w
        um = (ua + ub) / 2
        if kind == 'diamond':
            b.face([seg.P(ua + w * 0.05, hm, -d), seg.P(um, z0, -d), seg.P(ub - w * 0.05, hm, -d), seg.P(um, z1, -d)], 'plain', col, mode='fit')
        else:  # zig-zag triangles pointing up
            b.face([seg.P(ua, z0, -d), seg.P(ub, z0, -d), seg.P(um, z1, -d)], 'plain', col, mode='fit')


def pinnacle(b, lk, x, y, z, h, w, col=None, n=4):
    """A Hausa-style tapering corner pinnacle (square frustum with a stepped cap)."""
    col = col or lk.wall_col
    lib.cylinder(b, x, y, z, z + h * 0.8, w * 0.7, n=n, slot=lk.wall_slot, col=col, r_top=w * 0.38, top=False, smooth=False)
    if b.detail < 2:
        lib.cylinder(b, x, y, z + h * 0.8, z + h, w * 0.45, n=n, slot=lk.wall_slot, col=lib.shade(col, 0.92), r_top=w * 0.05, top=True, smooth=False)


def crenellate(b, lk, fp, z, h=0.9, w=0.9, gap=0.8, col=None, skip_rear=False):
    """Merlons along every edge of a footprint at roof level z."""
    if b.detail >= 1:
        return
    col = col or lk.trim_col
    for seg in fp.edges():
        if skip_rear and seg.rear:
            continue
        pitch = w + gap
        n = max(1, int(seg.length / pitch))
        for k in range(n):
            u = (k + 0.5) * seg.length / n
            p = seg.P(u, z, 0.15)
            yaw = math.atan2(seg.u[1], seg.u[0])
            obox(b, p[0], p[1], z, w, 0.3, h, yaw, 'plain-render', col, top_col=lib.shade(col, 0.9), skip=('bottom',))


def railing(b, p0, p1, z, h=1.0, col='#3a3d41'):
    """A thin balustrade between two points (a flat dark panel, both sides)."""
    if b.detail >= 1:
        return
    pts = [(p0[0], p0[1], z), (p1[0], p1[1], z), (p1[0], p1[1], z + h), (p0[0], p0[1], z + h)]
    b.face(pts, 'plain', col, mode='fit')
    b.face(pts[::-1], 'plain', col, mode='fit')


def roof_terrace(b, lk, fp, z, S, umbrellas=2):
    """Railings round a flat roof and a few umbrellas/tables (roof-terrace)."""
    if b.detail >= 1:
        return
    for seg in fp.edges():
        p, q = seg.p0, seg.p1
        pp = (p[0] - seg.n[0] * 0.4, p[1] - seg.n[1] * 0.4)
        qq = (q[0] - seg.n[0] * 0.4, q[1] - seg.n[1] * 0.4)
        railing(b, pp, qq, z, 1.0)
    x0, y0, x1, y1 = fp.bbox
    rs = S.get('terrace')
    for k in range(umbrellas):
        ux, uy = rs.uniform(x0 + 2, x1 - 2), rs.uniform(y0 + 2, y1 - 2)
        lib.cylinder(b, ux, uy, z, z + 2.2, 0.04, n=4, slot='frame', col='#8d9298', top=False)
        lib.cylinder(b, ux, uy, z + 2.2, z + 2.6, 1.3, n=8, slot='plain', col=rs.choice(['#c0392b', '#e0b43a', '#2f7d5b', '#2f5f8a']), r_top=0.05, top=False, smooth=False)


def plot_site(b, lk, S, feats, setting, bx0, bx1, y_front, y_back, side=12.0, fore=24.0, aft=8.0, road_w=8.0, gate_w=7.0, flags=0, sign=None,
              trees=5, max_w=112.0, forecourt=None, car_density=1.0, fence_default=False, flag_cols=('#0b7a43', '#f2f2f2', '#0b7a43')):
    """Ground pad, street, forecourt (parking | garden | plaza), perimeter fence with a gate, flags, trees, lamps. All site geometry.
    bx0/bx1 = building extent in x, y_front/y_back = building extent in y. Returns the pad rectangle (x0, y0, x1, y1)."""
    if b.detail >= 2:
        return (bx0 - side, y_front - fore, bx1 + side, y_back + aft)
    x0p, x1p = max(bx0 - side, -max_w / 2), min(bx1 + side, max_w / 2)
    y0p, y1p = y_front - fore, y_back + aft
    if y1p - y0p > max_w:
        y0p = y1p - max_w
    setting = setting or {}
    b.section('ground')
    lib.ground(b, x0p, y0p, x1p, y1p, lk)
    road_y0, road_y1 = y0p + 0.5, y0p + 0.5 + road_w
    b.section('forecourt')
    lib.forecourt(b, 'road', x0p + 0.3, road_y0, x1p - 0.3, road_y1, lk, S.get('road'))
    kind = forecourt or setting.get('forecourt') or 'plaza'
    if 'car-park' in feats:
        kind = 'parking'
    if kind not in ('parking', 'garden', 'plaza'):
        kind = 'plaza'
    iy0, iy1 = road_y1 + 1.0, y_front - 1.0
    fence_on = 'fence-wall' in feats or fence_default
    if iy1 - iy0 > 3.5:
        lib.forecourt(b, kind, x0p + 2.5, iy0, x1p - 2.5, iy1, lk, S.get('court'), density=car_density * (1.0 if (x1p - x0p) < 60 else 0.45))
    # entrance path from gate to door
    if b.detail == 0 and kind != 'plaza' and iy1 - iy0 > 3.5:
        cxp = (bx0 + bx1) / 2
        b.face([(cxp - 1.6, iy0, 0.07), (cxp + 1.6, iy0, 0.07), (cxp + 1.6, y_front, 0.07), (cxp - 1.6, y_front, 0.07)], 'paving', '#cbc6bb')
    if fence_on:
        b.section('fence')
        yf = road_y1 + 0.8
        pts = [(x0p + 1.0, yf), (x1p - 1.0, yf)]
        gx = ((bx0 + bx1) / 2 - (x0p + 1.0)) / max(1.0, (x1p - x0p - 2.0))
        U_fence(b, lk, [(x0p + 1.0, y1p - 1.0), (x0p + 1.0, yf), (x1p - 1.0, yf), (x1p - 1.0, y1p - 1.0)], gate=(1, gx, gate_w))
    b.section('trees')
    rs = S.get('plot-trees')
    if lk.tree not in (None, 'none') and trees:
        for k in range(trees if b.detail == 0 else max(1, trees // 2)):
            side_ = -1 if k % 2 == 0 else 1
            tx = (x0p + 5 + rs.uniform(0, 5)) if side_ < 0 else (x1p - 5 - rs.uniform(0, 5))
            ty = rs.uniform(max(iy0 + 3, y_front - 4), y_back + aft - 3)
            lib.tree(b, lk.tree, tx, ty, rs.uniform(6, 9), S.get('pt%d' % k), lk)
    b.section('furniture')
    street_lamps(b, lk, x0p + 6, x1p - 6, road_y1 + 0.2, 3)
    for k in range(flags):
        flagpole(b, (bx0 + bx1) / 2 - (flags - 1) * 2.5 + 5 * k, y_front - 7.0, 10.0, flag_cols[k % len(flag_cols)])
    if sign:
        pylon_sign(b, x1p - 8, road_y1 + 3.0, *sign)
    return (x0p, y0p, x1p, y1p)


def U_fence(b, lk, pts, **kw):
    fence(b, lk, pts, h=2.2, col=lib.shade(lk.wall_col, 1.02), **kw)


# ---------------------------------------------------------------------------------------------------------------- hotel / resort parts
def pool(b, x0, y0, x1, y1, S, umbrellas=3, coping='#d9d4c8', water='#3fa7c7', deck=True):
    """A swimming pool (coping ring, water) with loungers and umbrellas around it (site geometry)."""
    if b.detail >= 2:
        return
    with b.site():
        if b.detail == 0:
            b.face([(x0 - 1.2, y0 - 1.2, 0.09), (x1 + 1.2, y0 - 1.2, 0.09), (x1 + 1.2, y1 + 1.2, 0.09), (x0 - 1.2, y1 + 1.2, 0.09)], 'paving', coping)
        b.face([(x0, y0, 0.12), (x1, y0, 0.12), (x1, y1, 0.12), (x0, y1, 0.12)], 'plain', water, mode='fit')
        rs = S.get('pool')
        for k in range(umbrellas if b.detail == 0 else 0):
            ux = x0 + (x1 - x0) * (k + 0.5) / umbrellas
            uy = y0 - 0.5 if k % 2 == 0 else y1 + 0.5
            lib.cylinder(b, ux, uy, 0.1, 2.3, 0.04, n=4, slot='frame', col='#8d9298', top=False)
            lib.cylinder(b, ux, uy, 2.3, 2.7, 1.4, n=8, slot='plain', col=rs.choice(['#f1ece0', '#d9553a', '#e8b23a', '#2f7d6b']), r_top=0.06, top=False, smooth=False)
            obox(b, ux + 1.4, uy, 0.1, 1.9, 0.7, 0.35, 0.0, 'plain', '#f1ece0')


def gallery(b, lk, x0, x1, y_wall, depth, z0, z1, n, col=None, rail=True, slab=True):
    """A colonnaded gallery on the front of a wall: posts from z0 to z1, a floor slab at z1 (balcony deck) with a balustrade."""
    col = col or lk.trim_col
    yo = y_wall - depth
    xs = [x0 + 0.25 + (x1 - x0 - 0.5) * k / (n - 1) for k in range(n)]
    for x in xs:
        lib.column(b, x, yo + 0.25, z0, z1, 0.2, lk, 'square', capital=False, slot='plain-render', col=col)
    if slab and b.detail < 2:
        box(b, x0 - 0.1, yo, z1 - 0.3, x1 + 0.1, y_wall, z1, 'plain-render', lib.shade(col, 0.95), skip=())
    if rail and b.detail == 0:
        for k in range(len(xs) - 1):
            pts = [(xs[k], yo + 0.2, z1), (xs[k + 1], yo + 0.2, z1), (xs[k + 1], yo + 0.2, z1 + 0.95), (xs[k], yo + 0.2, z1 + 0.95)]
            b.face(pts, 'plain', lib.shade(col, 0.85), mode='fit')
            b.face(pts[::-1], 'plain', lib.shade(col, 0.85), mode='fit')


def balcony_pods(b, seg, z0, floors, fh, every=2, depth=1.3, col='#d8d2c4', rail_col='#3a3d41', skip_ground=True, gap_u=1.0):
    """Individual projecting balconies (slab + railing) on a wall, every `every` bays of 3.4 m, on each storey above the ground floor."""
    if b.detail >= 1:
        return
    L = seg.length
    bw = 3.4
    nb = max(1, round(L / bw))
    bw = L / nb
    pod = bw * every
    for f in range(1 if skip_ground else 0, floors):
        zf = z0 + f * fh
        u = gap_u
        while u + pod <= L - gap_u + 1e-6:
            ua, ub = u, u + pod - 0.4
            U_slab(b, seg, ua, ub, zf - 0.02, zf + 0.18, depth, col)
            pts = [seg.P(ua, zf + 0.18, -depth), seg.P(ub, zf + 0.18, -depth), seg.P(ub, zf + 1.08, -depth), seg.P(ua, zf + 1.08, -depth)]
            b.face(pts, 'plain', rail_col, mode='fit')
            u += pod


def U_slab(b, seg, u0, u1, z0, z1, proud, col):
    sbox(b, seg, u0, u1, z0, z1, proud, col, skip_ends=False)


def chalet(b, lk, x, y, yaw=0.0, w=5.5, d=6.5, h=3.0, roof_slot=None, roof_col=None, wall_col=None, thatch=False):
    """A small hip-roofed chalet / bungalow with a porch step."""
    if b.detail >= 2:
        obox(b, x, y, 0, w, d, h + 1.2, yaw, 'plain', wall_col or lk.wall_col)
        return
    wc = wall_col or lk.wall_col
    c, s = math.cos(yaw), math.sin(yaw)
    obox(b, x, y, 0, w, d, h, yaw, lk.wall_slot, wc, skip=('bottom', 'top'))
    # hip roof built from rotated rect (8 tris + eaves)
    ov = 0.6
    hw, hd = w / 2 + ov, d / 2 + ov
    rise = min(hw, hd) * 0.75
    P = lambda lx, ly, z: (x + c * lx - s * ly, y + s * lx + c * ly, z)
    rs = roof_slot or ('timber' if thatch else lk.roof_slot)
    rc = roof_col or ('#b69a5e' if thatch else lk.roof_col)
    ridge = max(0.0, hd - hw)
    base = [P(-hw, -hd, h - 0.1), P(hw, -hd, h - 0.1), P(hw, hd, h - 0.1), P(-hw, hd, h - 0.1)]
    top = [P(0, -ridge, h + rise), P(0, ridge, h + rise)]
    faces = [[base[0], base[1], top[0]], [base[1], base[2], top[1], top[0]], [base[2], base[3], top[1]], [base[3], base[0], top[0], top[1]]]
    cen = P(0, 0, h)
    for f_ in faces:
        mx = sum(p[0] for p in f_) / len(f_) - cen[0]
        my = sum(p[1] for p in f_) / len(f_) - cen[1]
        b.facing(f_, (mx, my, 0.8), rs, rc, scale=1.5)
    if b.detail == 0:
        px, py, _ = P(0, -d / 2 - 0.5, 0)
        obox(b, px, py, 0, 2.2, 1.0, 0.25, yaw, 'paving', '#cbc6bb')
        pts = [P(-0.6, -d / 2 - 0.03, 0.2), P(0.6, -d / 2 - 0.03, 0.2), P(0.6, -d / 2 - 0.03, 2.2), P(-0.6, -d / 2 - 0.03, 2.2)]
        b.facing(pts, (s, -c, 0), 'glass-punched', '#cfd8dd', mode='fit')


def thatched_pavilion(b, lk, x, y, r=3.4, h=2.6, thatch=True):
    """An open round pavilion / bar: posts under a conical thatch roof."""
    if b.detail >= 2:
        lib.cylinder(b, x, y, 0, h + 2.4, r, n=6, slot='plain', col='#b69a5e', r_top=0.2, top=False, smooth=False)
        return
    n = 8 if b.detail == 0 else 5
    for k in range(n):
        a = 2 * math.pi * k / n
        lib.cylinder(b, x + (r - 0.3) * math.cos(a), y + (r - 0.3) * math.sin(a), 0, h, 0.12, n=4, slot='timber', col='#7a5a3a', top=False)
    lib.cylinder(b, x, y, 0, 0.3, r + 0.2, n=n * 2, slot='paving', col='#cbc6bb', r_top=r + 0.2, top=True, smooth=False)
    lib.cylinder(b, x, y, h, h + 2.4, r + 0.8, n=n * 2, slot='timber' if thatch else lk.roof_slot, col='#b69a5e' if thatch else lk.roof_col, r_top=0.15, top=False, smooth=False, scale=1.5)


# ---------------------------------------------------------------------------------------------------------------- flat-coloured solids
# lib.box with a trim slot ('plain', 'frame') cuts every face at each metre (trim strips tile along u). These wrappers draw flat-colour
# boxes as single quads (mode='fit') and delegate everything else to the library.
_FLAT = ('plain', 'frame', 'cornice')


def box(b, x0, y0, z0, x1, y1, z1, slot='plain-render', col='#d8d8d8', top_slot=None, top_col=None, skip=('bottom',), scale=1.0, smooth=False):
    ts, tc = top_slot or slot, top_col or col
    if slot not in _FLAT and ts not in _FLAT:
        return lib.box(b, x0, y0, z0, x1, y1, z1, slot, col, top_slot, top_col, skip, scale, smooth)
    f = [
        ('front', [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0), slot, col),
        ('right', [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0), slot, col),
        ('back', [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], (0, 1, 0), slot, col),
        ('left', [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], (-1, 0, 0), slot, col),
        ('top', [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1), ts, tc),
        ('bottom', [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 0, -1), slot, col),
    ]
    for name, pts, hint, s_, c_ in f:
        if name in skip:
            continue
        if s_ in _FLAT:
            b.facing(pts, hint, s_, c_, mode='fit')
        else:
            b.facing(pts, hint, s_, c_, scale=scale)


def box_c(b, cx, cy, z0, w, d, h, slot='plain-render', col='#d8d8d8', **kw):
    box(b, cx - w / 2, cy - d / 2, z0, cx + w / 2, cy + d / 2, z0 + h, slot, col, **kw)


def obox(b, cx, cy, z0, sx, sy, h, yaw=0.0, slot='plain-render', col='#d8d8d8', top_slot=None, top_col=None, skip=('bottom',), scale=1.0):
    ts, tc = top_slot or slot, top_col or col
    if slot not in _FLAT and ts not in _FLAT:
        return lib.obox(b, cx, cy, z0, sx, sy, h, yaw, slot, col, top_slot, top_col, skip, scale)
    c, s = math.cos(yaw), math.sin(yaw)
    P = lambda lx, ly, z: (cx + c * lx - s * ly, cy + s * lx + c * ly, z)
    hx, hy, z1 = sx / 2, sy / 2, z0 + h
    f = [
        ('front', [P(-hx, -hy, z0), P(hx, -hy, z0), P(hx, -hy, z1), P(-hx, -hy, z1)], (s, -c, 0), slot, col),
        ('right', [P(hx, -hy, z0), P(hx, hy, z0), P(hx, hy, z1), P(hx, -hy, z1)], (c, s, 0), slot, col),
        ('back', [P(hx, hy, z0), P(-hx, hy, z0), P(-hx, hy, z1), P(hx, hy, z1)], (-s, c, 0), slot, col),
        ('left', [P(-hx, hy, z0), P(-hx, -hy, z0), P(-hx, -hy, z1), P(-hx, hy, z1)], (-c, -s, 0), slot, col),
        ('top', [P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1)], (0, 0, 1), ts, tc),
        ('bottom', [P(-hx, -hy, z0), P(-hx, hy, z0), P(hx, hy, z0), P(hx, -hy, z0)], (0, 0, -1), slot, col),
    ]
    for name, pts, hint, s_, c_ in f:
        if name in skip:
            continue
        if s_ in _FLAT:
            b.facing(pts, hint, s_, c_, mode='fit')
        else:
            b.facing(pts, hint, s_, c_, scale=scale)


def walls_b(b, lk, fp, z0, z1, floors, rng=None, kind='punched', front_kind=None, ground_kind=None, ground_h=None, band=None, bay=None, ratio=None,
            wall_slot=None, wall_col=None, plinth=0.35, rear='flat', limit=None):
    """lib.walls (really cut windows) for small buildings; for big ones (many windows) the cheap `skin` path keeps the model in budget."""
    per = sum(s.length for s in fp.edges())
    bw = bay or 3.6
    n_win = per / bw * max(1, floors)
    lim = limit or (150 if b.detail == 0 else 80)
    ratio = lk.ratio if ratio is None else ratio
    if n_win <= lim:
        lib.walls(b, fp, z0, z1, floors, lk, rng, kind=kind, ratio=ratio, front_kind=front_kind, rear=rear, ground_kind=ground_kind, ground_h=ground_h,
                  plinth=plinth, band=band, wall_slot=wall_slot, wall_col=wall_col, bay=bay)
        return
    ws = wall_slot or lk.wall_slot
    wc = wall_col or lk.wall_col
    grp = 2 if n_win < 3 * lim else 3
    ratio = clamp(ratio, 0.3, 0.6)
    for seg in fp.edges():
        k = front_kind if (seg.front and front_kind) else kind
        if k in ('arched', 'pointed-arch'):
            k = 'punched'
        if k in ('screen', 'louvre'):
            k = 'ribbon'
        red = b.detail == 0 and (seg.rear or (n_win > 3 * lim and not seg.front))
        if seg.front and ground_kind and floors > 1:
            gh = ground_h or (z1 - z0) / floors
            skin(b, seg, z0, z0 + gh, 1, ground_kind, lk, ratio=ratio, ws=ws, wc=wc, group=1, reduced=red, bay=bw)
            skin(b, seg, z0 + gh, z1, floors - 1, k, lk, ratio=ratio, ws=ws, wc=wc, group=grp, reduced=red, bay=bw)
        else:
            skin(b, seg, z0, z1, floors, k, lk, ratio=ratio, ws=ws, wc=wc, group=grp, reduced=red, bay=bw)
    if plinth and b.detail == 0:
        lib.sweep(b, fp, z0, [(0.06, 0), (0.06, plinth), (0, plinth)], lk.wall_slot, lib.shade(wc, 0.78))


def sane(brief):
    """A defensive copy of a brief: numeric fields coerced, colours validated, so odd values never crash lib.look (which does float())."""
    import copy
    import re as _re
    b = copy.deepcopy(brief or {})
    f = b.get('facade')
    if not isinstance(f, dict):
        f = {}
    b['facade'] = f
    try:
        f['windowRatio'] = clamp(float(f.get('windowRatio', 0.4)), 0.0, 1.0)
    except (TypeError, ValueError):
        f['windowRatio'] = 0.4
    cols = [c for c in (f.get('colours') or []) if isinstance(c, str) and _re.fullmatch(r'#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})', c)]
    f['colours'] = cols
    if not (isinstance(f.get('roofColour'), str) and _re.fullmatch(r'#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})', f['roofColour'])):
        f.pop('roofColour', None)
    if not isinstance(b.get('form'), dict):
        b['form'] = {}
    if not isinstance(b.get('setting'), dict):
        b['setting'] = {}
    if not isinstance(b.get('features'), list):
        b['features'] = []
    return b
