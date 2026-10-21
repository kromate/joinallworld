"""Shared helpers for the commerce archetypes (market-open, market-hall, mall, shophouse, restaurant).

Everything here is deterministic geometry built with the places lib. `Frame` lets any part (a lock-up row, a terrace, a canopy) be
placed at any position and yaw: local x runs along the part, local y is depth, the part's front faces local -Y, local +Z is up.
"""
import math
import os

import lib

LIMITS = {0: 19200, 1: 3850, 2: 480}
DENSITY = [1.0]     # global density governor: build() retries with lower density until the triangle budget fits


def governed(build_once, detail, steps=(1.0, 0.8, 0.62, 0.46, 0.32, 0.2)):
    """Run build_once() at decreasing density until the Builder fits the budget for this LOD (deterministic)."""
    out = None
    for d in steps:
        DENSITY[0] = d
        out = build_once()
        if os.environ.get('PLACES_DEBUG'):
            print('[gov] detail', detail, 'density', d, 'tris', lib.Builder.last.tris, dict(lib.Builder.last.by_label), flush=True)
        if lib.Builder.last is not None and lib.Builder.last.tris <= LIMITS[detail]:
            break
    DENSITY[0] = 1.0
    return out


def bay(v):
    """Window bay width widened by the density governor."""
    return v / max(0.3, DENSITY[0]) ** 0.5


DARK = '#2b2926'
STEEL = '#8c9298'
PAINTS = ['#d9a441', '#3f7fa6', '#b5483a', '#4f8a5b', '#e8e1cf', '#8a5fa0', '#d6704a', '#2f6f73']
UMB = ['#c4452f', '#2f6fb0', '#e0b030', '#3b8a4e', '#d8d2c2', '#7a4a9a', '#e07a30', '#2a8a8a']


# ------------------------------------------------------------------------------------------------------------------ brief
def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def num(v, d):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def feats(brief):
    out = {}
    for f in brief.get('features') or []:
        if isinstance(f, dict):
            if f.get('id'):
                out[f['id']] = f
        elif f:
            out[f] = {'id': f, 'count': 1}
    return out


def fcount(fs, fid, default=0):
    f = fs.get(fid)
    if f is None:
        return default
    return int(num(f.get('count', 1), 1)) or 1


def text(brief):
    form = brief.get('form') or {}
    parts = [brief.get(k, '') for k in ('name', 'subject', 'notes', 'style', 'era', 'venueId')]
    parts.append(form.get('variant', ''))
    for f in brief.get('features') or []:
        if isinstance(f, dict):
            parts.append(f.get('note', ''))
    return ' '.join(str(p) for p in parts if p).lower()


def has(txt, *words):
    return any(w in txt for w in words)


def form(brief):
    f = brief.get('form') or {}
    return {
        'fp': f.get('footprint') or 'rect', 'W': num(f.get('width_m'), 40.0), 'D': num(f.get('depth_m'), 25.0),
        'S': int(clamp(num(f.get('storeys'), 1), 1, 8)), 'H': num(f.get('height_m'), 0.0), 'roof': f.get('roof') or 'flat',
        'wings': int(num(f.get('wings'), 0)), 'variant': str(f.get('variant') or '').lower(),
    }


def palette(brief, style, lk, srng, n=6):
    """Hex colours for painted fronts, shutters and signs: the brief's own colours, then the city's wall colours, then defaults."""
    out = []
    for c in (brief.get('facade') or {}).get('colours') or []:
        out.append(c)
    for c in (style or {}).get('wallColours') or []:
        if c not in out:
            out.append(c)
    for c in PAINTS:
        if len(out) >= n + 3:
            break
        out.append(c)
    return out


def accent_cols(brief, style, srng):
    """Saturated colours for shutters/awnings/umbrellas: brief colours first, then bright defaults, shuffled deterministically."""
    base = list((brief.get('facade') or {}).get('colours') or [])[:3]
    base += ['#c4452f', '#2f6fb0', '#e0b030', '#3b8a4e', '#7a4a9a', '#e07a30', '#2a8a8a']
    srng.shuffle(base)
    return base


def sat(hexc, amount=0.35):
    """Push a colour away from grey (more saturated)."""
    r, g, bl = lib.rgb(hexc)
    m = (r + g + bl) / 3
    f = lambda v: max(0.0, min(1.0, m + (v - m) * (1 + amount)))
    return lib.to_hex((f(r), f(g), f(bl)))


# ------------------------------------------------------------------------------------------------------------------ frame
class Frame:
    """Local coordinates: x along the part, y depth (front at y = 0 facing -Y), z up. Placed at (cx, cy) rotated by yaw radians."""

    def __init__(self, cx=0.0, cy=0.0, yaw=0.0):
        self.cx, self.cy, self.yaw = cx, cy, yaw
        self.c, self.s = math.cos(yaw), math.sin(yaw)

    def p(self, x, y, z=0.0):
        return (self.cx + self.c * x - self.s * y, self.cy + self.s * x + self.c * y, z)

    def xy(self, x, y):
        return (self.cx + self.c * x - self.s * y, self.cy + self.s * x + self.c * y)

    def h(self, v):
        return (self.c * v[0] - self.s * v[1], self.s * v[0] + self.c * v[1], v[2])

    def sub(self, x, y, dyaw=0.0):
        q = self.xy(x, y)
        return Frame(q[0], q[1], self.yaw + dyaw)

    def face(self, b, pts, hint, slot, col, **kw):
        b.facing([self.p(*q) for q in pts], self.h(hint), slot, col, **kw)

    def seg(self, x0, y0, x1, y1):
        a, c = self.xy(x0, y0), self.xy(x1, y1)
        return lib.Seg(a, c)

    def box(self, b, x0, y0, z0, x1, y1, z1, slot='plain-render', col='#d8d8d8', top_slot=None, top_col=None, skip=('bottom',), scale=None):
        cx, cy = self.xy((x0 + x1) / 2, (y0 + y1) / 2)
        if scale is None:   # big boxes would be cut at every texture tile: coarsen the tiling
            big = max(x1 - x0, y1 - y0, z1 - z0)
            scale = 1.0 if big < 12 else (2.0 if big < 30 else 3.5)
            if b.detail:
                scale *= 2.0
        lib.obox(b, cx, cy, z0, x1 - x0, y1 - y0, z1 - z0, self.yaw, slot, col, top_slot, top_col, skip, scale)

    def cyl(self, b, x, y, z0, z1, r, n=8, slot='plain', col='#999999', r_top=None, top=True, smooth=True):
        q = self.xy(x, y)
        lib.cylinder(b, q[0], q[1], z0, z1, r, n=n, slot=slot, col=col, r_top=r_top, top=top, smooth=smooth)

    def ground_quad(self, b, x0, y0, x1, y1, z, slot, col, scale=1.0):
        with b.site():
            if b.detail >= 2:
                return
            b.facing([self.p(x0, y0, z), self.p(x1, y0, z), self.p(x1, y1, z), self.p(x0, y1, z)], (0, 0, 1), slot, col, scale=scale * (2 if b.detail else 1))

    def walls(self, b, x0, y0, x1, y1, z0, z1, storeys, lk, rng, front='punched', right=None, back=None, left=None, ratio=None, bay=None,
              wall_slot=None, wall_col=None, front_args=None, skip=(), rear_reduced=True):
        """Four walls of the local rectangle through lib.facade (openings cut at LOD0). `skip` is any of front/right/back/left."""
        sides = {'front': (self.seg(x0, y0, x1, y0), front), 'right': (self.seg(x1, y0, x1, y1), right or front),
                 'back': (self.seg(x1, y1, x0, y1), back or 'none'), 'left': (self.seg(x0, y1, x0, y0), left or right or front)}
        for nm, (sg, kind) in sides.items():
            if nm in skip:
                continue
            kw = dict(front_args or {}) if nm == 'front' else {}
            lib.facade(b, sg, z0, z1, storeys, lk, kind, ratio, rng, bay, reduced=(nm == 'back' and rear_reduced and kind != 'none'),
                       wall_slot=wall_slot, wall_col=wall_col, **kw)

    def roof(self, b, form_, x0, y0, x1, y1, z, rise, ov=0.3, slot='corrugated', col='#8a8f94', wall_slot='plain-render', wall_col='#d8d8d8',
             th=0.1, high='back', ridge='x', ov_front=None, parapet=0.35, par_col=None, hip_ratio=0.5, infill=True):
        """Roof over the local rect with its eave line at z. form_: flat | shed | gable | hip | pyramidal | none. Draws the wall infill
        above z (gable ends, shed back wall) when `infill`. For ridge='y' the roof is built in a frame turned 90 degrees."""
        if form_ in (None, 'none'):
            return
        if ridge == 'y' and form_ in ('gable', 'hip', 'pyramidal', 'shed'):
            cxl, cyl = (x0 + x1) / 2, (y0 + y1) / 2
            w, d = x1 - x0, y1 - y0
            hh = {'back': 'right', 'front': 'left'}.get(high, 'right')  # shed: only back/front are used by the callers
            F2 = self.sub(cxl, cyl, math.pi / 2)
            F2.roof(b, form_, -d / 2, -w / 2, d / 2, w / 2, z, rise, ov, slot, col, wall_slot, wall_col, th, 'back' if high == 'back' else 'front', 'x', ov_front, parapet, par_col, hip_ratio, infill)
            return
        det = b.detail
        W = x1 - x0
        area = (x1 - x0) * (y1 - y0)
        rsc = (1.0 if area < 150 else (2.5 if area < 900 else 4.0)) * (2.0 if det == 1 else 1.0)
        if form_ == 'flat':
            self.face(b, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], (0, 0, 1), 'roof-flat', col, scale=2.0 * rsc)
            if ov > 0 and det < 2:  # slab edge
                self.box(b, x0 - ov, y0 - ov, z - 0.25, x1 + ov, y1 + ov, z, wall_slot, par_col or wall_col, 'roof-flat', col, skip=('bottom',))
            if parapet > 0 and det < 2:
                pc = par_col or wall_col
                t = 0.22
                if det == 0:
                    self.box(b, x0, y0, z, x1, y0 + t, z + parapet, wall_slot, pc, wall_slot, pc, skip=('bottom', 'back'))
                    self.box(b, x0, y1 - t, z, x1, y1, z + parapet, wall_slot, pc, wall_slot, pc, skip=('bottom', 'front'))
                    self.box(b, x0, y0 + t, z, x0 + t, y1 - t, z + parapet, wall_slot, pc, wall_slot, pc, skip=('bottom', 'right'))
                    self.box(b, x1 - t, y0 + t, z, x1, y1 - t, z + parapet, wall_slot, pc, wall_slot, pc, skip=('bottom', 'left'))
                else:
                    self.box(b, x0, y0, z, x1, y1, z + parapet, wall_slot, pc, 'roof-flat', col, skip=('bottom',))
            return
        of = ov if ov_front is None else ov_front
        under = shade_(col, 0.55)

        def plane(pts):
            b.facing(pts, (0, 0, 1), slot, col, scale=rsc)
            if det == 0 and th > 0:
                b.facing([(q[0], q[1], q[2] - th) for q in pts], (0, 0, -1), 'plain-render', under)
        if form_ == 'shed':
            sgn = 1 if high == 'back' else -1
            ylo, yhi = (y0, y1) if sgn == 1 else (y1, y0)
            slope = rise / max(abs(yhi - ylo), 0.1)
            dlo = of * slope
            ylo_o, yhi_o = ylo - sgn * of, yhi + sgn * ov
            plane_pts = [self.p(x0 - ov, ylo_o, z - dlo), self.p(x1 + ov, ylo_o, z - dlo), self.p(x1 + ov, yhi_o, z + rise + ov * slope), self.p(x0 - ov, yhi_o, z + rise + ov * slope)]
            plane(plane_pts)
            if infill:
                ws, wc = wall_slot, wall_col
                self.face(b, [(x0, ylo, z), (x0, yhi, z), (x0, yhi, z + rise)], (-1, 0, 0), ws, wc)
                self.face(b, [(x1, ylo, z), (x1, yhi, z), (x1, yhi, z + rise)], (1, 0, 0), ws, wc)
                self.face(b, [(x0, yhi, z), (x1, yhi, z), (x1, yhi, z + rise), (x0, yhi, z + rise)], (0, sgn, 0), ws, wc)
            return
        ym = (y0 + y1) / 2
        half = (y1 - y0) / 2
        if form_ == 'gable':
            slope = rise / max(half, 0.1)
            dr = ov * slope
            for s_, (ya, yr) in enumerate(((y0 - of, y0), (y1 + ov, y1))):
                yy = y0 - of if s_ == 0 else y1 + ov
                pts = [(x0 - ov, yy, z - (of if s_ == 0 else ov) * slope), (x1 + ov, yy, z - (of if s_ == 0 else ov) * slope), (x1 + ov, ym, z + rise), (x0 - ov, ym, z + rise)]
                if s_ == 1:
                    pts = pts[::-1]
                plane([self.p(*q) for q in pts])
            if infill:
                self.face(b, [(x0, y0, z), (x0, y1, z), (x0, ym, z + rise)], (-1, 0, 0), wall_slot, wall_col)
                self.face(b, [(x1, y0, z), (x1, y1, z), (x1, ym, z + rise)], (1, 0, 0), wall_slot, wall_col)
            return
        # hip / pyramidal
        run = half
        slope = rise / max(run, 0.1)
        rl = max(0.0, W - 2 * run * (1.0 if form_ == 'pyramidal' else 1.0))
        if form_ == 'pyramidal':
            rl = max(0.0, W - (y1 - y0))
        rx0, rx1 = (x0 + x1) / 2 - rl / 2, (x0 + x1) / 2 + rl / 2
        e = ov
        zl = z - e * slope
        a = [(x0 - e, y0 - e, zl), (x1 + e, y0 - e, zl), (x1 + e, y1 + e, zl), (x0 - e, y1 + e, zl)]
        top = z + rise
        # front, right, back, left planes
        quads = [[a[0], a[1], (rx1, ym, top), (rx0, ym, top)], [a[1], a[2], (rx1, ym, top)], [a[2], a[3], (rx0, ym, top), (rx1, ym, top)], [a[3], a[0], (rx0, ym, top)]]
        for qd in quads:
            plane([self.p(*q) for q in qd])


def shade_(c, f):
    return lib.shade(c, f)


# ------------------------------------------------------------------------------------------------------------------ small props
def umbrella(b, x, y, r, z_top, col, pole=True):
    """Market umbrella: a flat cone on a pole."""
    if b.detail >= 2:
        return
    n = 8 if b.detail == 0 else 5
    lib.cylinder(b, x, y, z_top - 0.42, z_top, r, n=n, slot='plain', col=col, r_top=0.0, top=False, smooth=False)
    if b.detail == 0 and pole:
        lib.cylinder(b, x, y, 0, z_top - 0.4, 0.03, n=4, slot='frame', col='#6b6e72', top=False, smooth=False)


def pile(b, x, y, z, r, h, col, n=6):
    """A heap of goods (cone)."""
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, z, z + h, r, n=n if b.detail == 0 else 4, slot='plain', col=col, r_top=r * 0.25, top=True, smooth=False)


def table(b, F, x, y, w, d, h, col, top_col=None):
    F.box(b, x - w / 2, y - d / 2, 0.0, x + w / 2, y + d / 2, h, 'timber', col, 'timber', top_col or lib.shade(col, 1.12), skip=('bottom',))


def stall_goods(b, F, x, y, w, d, h, srng, cols):
    """Heaps of goods on a table of w x d at height h."""
    if b.detail >= 2:
        return
    k = 2 if b.detail == 0 else 1
    for i in range(k):
        px = x + (i - (k - 1) / 2) * w * 0.4
        q = F.xy(px, y)
        pile(b, q[0], q[1], h, min(w, d) * 0.28, srng.uniform(0.18, 0.4), srng.choice(cols))


def umbrella_stall(b, F, x, y, srng, cols, goods_cols, size=1.0):
    """Trading table with goods under an umbrella; returns nothing. (x, y) local, table ~1.6 x 0.9 m."""
    w, d = 1.6 * size, 0.9 * size
    if b.detail == 1:
        srng.random(); srng.random()
        q = F.xy(x, y)
        umbrella(b, q[0], q[1], 1.55 * size, 2.35, srng.choice(cols))
        return
    tcol = srng.choice(['#8a6a45', '#9a7a52', '#6f5238', '#b09a78'])
    table(b, F, x, y, w, d, 0.82, tcol)
    stall_goods(b, F, x, y, w, d, 0.82, srng, goods_cols)
    q = F.xy(x, y + 0.2)
    umbrella(b, q[0], q[1], 1.55 * size, 2.35, srng.choice(cols))


def tarp_stall(b, F, x, y, srng, cols, goods_cols, w=2.4, d=1.8):
    """A four-post stall with a sloping tarp roof."""
    col = srng.choice(cols)
    hf, hb = 2.0, 2.45
    if b.detail < 2:
        if b.detail == 0:
            for (px, py, ph) in ((x - w / 2, y - d / 2, hf), (x + w / 2, y - d / 2, hf), (x - w / 2, y + d / 2, hb), (x + w / 2, y + d / 2, hb)):
                F.cyl(b, px, py, 0, ph, 0.04, n=4, slot='timber', col='#7a5a3a', top=False, smooth=False)
        F.face(b, [(x - w / 2 - 0.15, y - d / 2 - 0.2, hf), (x + w / 2 + 0.15, y - d / 2 - 0.2, hf), (x + w / 2 + 0.15, y + d / 2 + 0.15, hb), (x - w / 2 - 0.15, y + d / 2 + 0.15, hb)], (0, 0, 1), 'plain', col)
        if b.detail == 0:
            F.face(b, [(x - w / 2 - 0.15, y - d / 2 - 0.2, hf - 0.02), (x - w / 2 - 0.15, y + d / 2 + 0.15, hb - 0.02), (x + w / 2 + 0.15, y + d / 2 + 0.15, hb - 0.02), (x + w / 2 + 0.15, y - d / 2 - 0.2, hf - 0.02)], (0, 0, -1), 'plain', lib.shade(col, 0.6))
    if b.detail == 1:
        return
    table(b, F, x, y + 0.1, w * 0.85, d * 0.5, 0.8, '#8a6a45')
    stall_goods(b, F, x, y + 0.1, w * 0.85, d * 0.5, 0.8, srng, goods_cols)


def chair(b, x, y, yaw, col):
    """A plastic chair as simple shapes."""
    if b.detail >= 2:
        return
    lib.obox(b, x, y, 0.0, 0.42, 0.42, 0.45, yaw, 'plain', col, skip=('bottom',)) if b.detail == 1 else None
    if b.detail == 0:
        lib.obox(b, x, y, 0.0, 0.1, 0.1, 0.4, yaw, 'plain', lib.shade(col, 0.7))
        lib.obox(b, x, y, 0.4, 0.44, 0.44, 0.06, yaw, 'plain', col, skip=('bottom',))
        c, s = math.cos(yaw), math.sin(yaw)
        lib.obox(b, x + c * 0.0 + s * 0.2, y + s * 0.0 - c * 0.2, 0.46, 0.44, 0.05, 0.36, yaw, 'plain', col, skip=('bottom',))


def round_table(b, x, y, r, col, h=0.74):
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, 0.0, h - 0.04, 0.07, n=4, slot='plain', col=lib.shade(col, 0.7), top=False, smooth=False)
    lib.cylinder(b, x, y, h - 0.04, h, r, n=8 if b.detail == 0 else 5, slot='plain', col=col, top=True, smooth=False)


def dining_set(b, x, y, srng, tcol, ccols, chairs=4, r=0.42):
    """A table with chairs round it."""
    round_table(b, x, y, r, tcol)
    n = chairs if b.detail == 0 else min(chairs, 2)
    cc = srng.choice(ccols)
    for k in range(n):
        a = 2 * math.pi * k / chairs + 0.4
        dx, dy = math.cos(a) * (r + 0.32), math.sin(a) * (r + 0.32)
        chair(b, x + dx, y + dy, a + math.pi / 2, cc)


def neon(b, p0, p1, z, col, th=0.07, w=0.07):
    """A thin glowing strip (a bright box) between two 2D points at height z."""
    if b.detail >= 2:
        return
    lib.beam(b, p0, p1, z, z + th, w, 'plain', col, skip=())


def awning_seg(b, seg, u0, u1, z, depth, drop, cols, stripe=0.75, valance=0.22, proud=0.0):
    """Sloping fabric awning on a wall: top edge at height z at the wall, front edge `drop` lower and `depth` out. `cols` striped."""
    if b.detail >= 2:
        return
    L = u1 - u0
    n = max(1, int(L / stripe)) if b.detail == 0 else max(1, int(L / (stripe * 3)))
    w = L / n
    for k in range(n):
        c = cols[k % len(cols)]
        a, bb = u0 + k * w, u0 + (k + 1) * w
        pts = [seg.P(a, z, -proud), seg.P(bb, z, -proud), seg.P(bb, z - drop, -proud - depth), seg.P(a, z - drop, -proud - depth)]
        b.facing(pts, (0, 0, 1), 'plain', c)
        if b.detail == 0:
            b.facing([seg.P(a, z - drop, -proud - depth), seg.P(bb, z - drop, -proud - depth), seg.P(bb, z - drop - valance, -proud - depth), seg.P(a, z - drop - valance, -proud - depth)], seg.N3(), 'plain', c)
    if b.detail == 0:
        # one underside quad so the awning is not see-through from the street
        b.facing([seg.P(u0, z, -proud), seg.P(u1, z, -proud), seg.P(u1, z - drop, -proud - depth), seg.P(u0, z - drop, -proud - depth)], (0, 0, -1), 'plain', lib.shade(cols[0], 0.55))


def arch_door(b, seg, uc, w, h, z, col, depth=0.0):
    """An arched dark doorway face on a wall (flat, proud by `depth`)."""
    if b.detail >= 2:
        return
    n = 5 if b.detail == 0 else 3
    pts = [seg.P(uc - w / 2, z, -depth), seg.P(uc + w / 2, z, -depth)]
    hs = h - w / 2
    for k in range(n + 1):
        a = math.pi * k / n
        pts.append(seg.P(uc + math.cos(a) * w / 2, z + hs + math.sin(a) * w / 2, -depth))
    b.face(pts, 'glass-punched', col, mode='fit')


# ------------------------------------------------------------------------------------------------------------------ site props
def fence_wall(b, pts, h, th, lk, col=None, slot=None, crenel=False, cap=True, closed=False):
    """Free-standing wall along a polyline of 2D points."""
    col = col or lk.wall_col
    slot = slot or lk.wall_slot
    segs = list(zip(pts[:-1], pts[1:]))
    if closed:
        segs.append((pts[-1], pts[0]))
    for p0, p1 in segs:
        if math.dist(p0, p1) < 0.3:
            continue
        lib.beam(b, p0, p1, 0, h, th, slot, col)
        if cap and b.detail == 0:
            lib.beam(b, p0, p1, h, h + 0.12, th + 0.14, 'plain-render', lib.shade(col, 1.1))
        if crenel and b.detail == 0:
            L = math.dist(p0, p1)
            n = int(L / 1.4)
            for k in range(n):
                t = (k + 0.5) / n
                q = (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)
                lib.obox(b, q[0], q[1], h + 0.12, 0.5, th, 0.45, math.atan2(p1[1] - p0[1], p1[0] - p0[0]), slot, col)


def gate(b, F, x, w, h, lk, col=None, board=None, arch=False):
    """Gate piers (with caps) and a blank lintel board at local x (centre), spanning w."""
    col = col or lk.trim_col
    if b.detail >= 2:
        for sx in (-1, 1):
            F.box(b, x + sx * w / 2 - 0.6, -0.6, 0, x + sx * w / 2 + 0.6, 0.6, h, 'plain-render', col, skip=('bottom',))
        return
    for sx in (-1, 1):
        px = x + sx * w / 2
        F.box(b, px - 0.55, -0.55, 0, px + 0.55, 0.55, h, 'plain-render', col, skip=('bottom',))
        if b.detail == 0:
            F.box(b, px - 0.7, -0.7, h, px + 0.7, 0.7, h + 0.35, 'plain-render', lib.shade(col, 1.08), skip=('bottom',))
    F.box(b, x - w / 2 + 0.3, -0.3, h - 1.0, x + w / 2 - 0.3, 0.3, h, 'plain', board or lib.shade(col, 0.8), skip=('bottom',))


def water_tank(b, x, y, z, srng, col='#2f4f6f', r=1.1, h=1.7):
    if b.detail >= 2:
        return
    if b.detail == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.box_c(b, x + sx * r * 0.7, y + sy * r * 0.7, z, 0.18, 0.18, 1.2, 'plain', '#7d8286')
    lib.cylinder(b, x, y, z + 1.2, z + 1.2 + h, r, n=10 if b.detail == 0 else 6, slot='plain', col=col, r_top=r * 0.95, top=True)


def roof_clutter(b, F, x0, y0, x1, y1, z, srng, lk, count=4):
    """Plant boxes and a water tank on a flat roof (local rect)."""
    if b.detail >= 1:
        return
    for _ in range(count):
        w, d, h = srng.uniform(1.2, 2.6), srng.uniform(1.0, 2.0), srng.uniform(0.8, 1.6)
        cx = srng.uniform(x0 + w, x1 - w)
        cy = srng.uniform(y0 + d, y1 - d)
        F.box(b, cx - w / 2, cy - d / 2, z, cx + w / 2, cy + d / 2, z + h, 'metal-cladding', lib.shade(lk.metal_col, srng.uniform(0.85, 1.05)), 'roof-flat', '#8a8f92')


def sign_pylon(b, x, y, h, w, col, srng=None, yaw=0.0):
    """Blank pylon sign on a pole."""
    if b.detail >= 2:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h - w * 0.5, 0.12, n=5, slot='frame', col='#7d8286', top=False)
        lib.obox(b, x, y, h - w * 1.0, w, 0.25, w * 1.0, yaw, 'plain', col, skip=('bottom',))


def bollard(b, x, y, col='#d8d4c8'):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, 0.8, 0.09, n=5, slot='plain', col=col, top=True)


def mural_panel(b, seg, u0, u1, z0, z1, cols, srng, proud=0.03):
    """A painted mural: a few large colour blocks on a wall (flat quads)."""
    if b.detail >= 2:
        return
    L, H = u1 - u0, z1 - z0
    n = 4 if b.detail == 0 else 2
    b.face([seg.P(u0, z0, -proud), seg.P(u1, z0, -proud), seg.P(u1, z1, -proud), seg.P(u0, z1, -proud)], 'plain', cols[0])
    if b.detail == 0:
        for k in range(n):
            cu = u0 + L * srng.uniform(0.15, 0.85)
            cz = z0 + H * srng.uniform(0.2, 0.8)
            ww, hh = L * srng.uniform(0.1, 0.25), H * srng.uniform(0.15, 0.35)
            c = cols[1 + k % (len(cols) - 1)]
            b.face([seg.P(cu - ww, cz - hh, -proud - 0.01), seg.P(cu + ww, cz - hh, -proud - 0.01), seg.P(cu + ww, cz + hh, -proud - 0.01), seg.P(cu - ww, cz + hh, -proud - 0.01)], 'plain', c)


def statue(b, x, y, srng, col='#5a5148', h=2.4):
    """A figure on a plinth."""
    if b.detail >= 2:
        return
    lib.box_c(b, x, y, 0, 1.4, 1.4, 0.9, 'stone-blocks', '#bdb7ab')
    lib.cylinder(b, x, y, 0.9, 0.9 + h * 0.55, 0.28, n=6, slot='plain', col=col, r_top=0.2, top=True)
    lib.blob(b, x, y, 0.9 + h * 0.55 + 0.25, 0.2, 0.2, 0.25, col, n=6, rings=3)
    if b.detail == 0:
        lib.beam(b, (x - 0.55, y), (x + 0.55, y), 0.9 + h * 0.4, 0.9 + h * 0.4 + 0.1, 0.12, 'plain', col)


def mosque_small(b, F, x, y, srng, lk, w=9.0, d=7.0, h=3.6, minaret_h=11.0):
    """A small prayer hall with a low dome and one minaret (local frame, front at y)."""
    wc = '#e8e0d0'
    F.box(b, x - w / 2, y, 0, x + w / 2, y + d, h, 'plain-render', wc, 'roof-flat', '#cfc9bc', skip=('bottom',))
    q = F.xy(x, y + d / 2)
    if b.detail < 2:
        lib.dome(b, q[0], q[1], h, min(w, d) * 0.34, lk, profile='hemi', col='#d8d2c4', slot='plain-render', drum=0.5 if b.detail == 0 else 0, drum_col=wc, finial=0.8 if b.detail == 0 else 0)
    mx, my = x + w / 2 + 1.4, y + 0.8
    qm = F.xy(mx, my)
    n = 8 if b.detail == 0 else 5
    lib.cylinder(b, qm[0], qm[1], 0, minaret_h, 0.95, n=n, slot='plain-render', col=wc, r_top=0.7, top=False, smooth=False)
    if b.detail < 2:
        lib.cylinder(b, qm[0], qm[1], minaret_h, minaret_h + 0.3, 1.25, n=n, slot='plain-render', col='#d8d2c4', top=True, smooth=False)
        lib.cylinder(b, qm[0], qm[1], minaret_h + 0.3, minaret_h + 1.8, 0.6, n=n, slot='plain-render', col=wc, r_top=0.5, top=False, smooth=False)
        lib.cylinder(b, qm[0], qm[1], minaret_h + 1.8, minaret_h + 3.1, 0.62, n=n, slot='plain-render', col='#d8d2c4', r_top=0.0, top=False, smooth=False)


# ------------------------------------------------------------------------------------------------------------------ lock-ups
def lockup_block(b, F, L, d, h, lk, srng, *, roof='shed', vd=1.1, unit_w=2.5, wall_slot=None, wall_col=None, roof_slot='corrugated',
                 roof_col=None, shut_cols=None, open_p=0.18, arch=False, fascia_col=None, rise=None, posts=True, goods=None, relief=False, awn=None):
    """A row of lock-up shops: front wall (y = 0) split into units, each with a roll-up shutter (or open with goods) under a fascia board,
    a mono-pitch or gabled corrugated roof with a veranda on posts over the walkway. Local x runs -L/2..L/2."""
    wall_slot = wall_slot or lk.wall_slot
    wall_col = wall_col or lk.wall_col
    roof_col = roof_col or lk.roof_col
    shut_cols = shut_cols or ['#3f7fa6', '#4f8a5b', '#b5483a']
    x0, x1 = -L / 2, L / 2
    d = max(d, 2.0)
    rs = rise if rise is not None else max(0.5, d * (0.2 if roof == 'shed' else 0.26))
    det = b.detail
    # walls: back + ends (shape follows the roof), front handled per unit
    if roof in ('shed', 'gable', 'hip', 'pyramidal', 'none'):
        pass
    if det >= 2:
        F.box(b, x0, 0, 0, x1, d, h, wall_slot, wall_col, skip=('bottom', 'top'))
        F.roof(b, roof, x0, 0, x1, d, h, rs, 0.2, 'plain', roof_col, wall_slot, wall_col, ov_front=vd * 0.6, infill=True)
        return
    F.face(b, [(x1, d, 0), (x0, d, 0), (x0, d, h), (x1, d, h)], (0, 1, 0), wall_slot, wall_col)
    F.face(b, [(x0, d, 0), (x0, 0, 0), (x0, 0, h), (x0, d, h)], (-1, 0, 0), wall_slot, wall_col)
    F.face(b, [(x1, 0, 0), (x1, d, 0), (x1, d, h), (x1, 0, h)], (1, 0, 0), wall_slot, wall_col)
    if det == 1:
        unit_w *= 2.6
    unit_w /= max(0.3, DENSITY[0]) ** 0.5
    n = max(1, int(round(L / unit_w)))
    uw = L / n
    dh = min(2.5, h - 0.75)
    fc = fascia_col or lib.shade(wall_col, 0.9)
    for k in range(n):
        a, c = x0 + k * uw, x0 + (k + 1) * uw
        sc = shut_cols[(k + int(srng.random() * 2)) % len(shut_cols)] if det == 0 else shut_cols[k % len(shut_cols)]
        is_open = det == 0 and srng.random() < open_p
        # fascia above, wall strip below sill handled by shutter slab
        F.face(b, [(a, 0, dh), (c, 0, dh), (c, 0, h), (a, 0, h)], (0, -1, 0), wall_slot, fc if k % 2 == 0 else lib.shade(fc, 1.07), mode='fit')
        if det == 0 and relief:
            F.face(b, [(a + 0.3, -0.02, h - 0.35), (c - 0.3, -0.02, h - 0.35), (c - 0.3, -0.02, h - 0.12), (a + 0.3, -0.02, h - 0.12)], (0, -1, 0), 'plain', lib.shade(wall_col, 0.7))
        if is_open:
            F.face(b, [(a + 0.1, -0.04, 0), (c - 0.1, -0.04, 0), (c - 0.1, -0.04, dh), (a + 0.1, -0.04, dh)], (0, -1, 0), 'glass-punched', '#46403a', mode='fit')
            if goods:
                F.box(b, a + 0.25, -0.7, 0, c - 0.25, -0.15, 0.85, 'timber', '#8a6a45', 'timber', '#a58559')
                pq = F.xy((a + c) / 2, -0.45)
                pile(b, pq[0], pq[1], 0.85, uw * 0.2, 0.3, srng.choice(goods))
        elif arch and det == 0:
            F.face(b, [(a, 0, 0), (c, 0, 0), (c, 0, dh), (a, 0, dh)], (0, -1, 0), wall_slot, wall_col, mode='fit')
            sg = F.seg(a, 0, c, 0)
            arch_door(b, sg, uw / 2, uw * 0.62, dh * 0.92, 0.0, sc, depth=0.03)
        else:
            F.face(b, [(a + 0.08, -0.05, 0.0), (c - 0.08, -0.05, 0.0), (c - 0.08, -0.05, dh), (a + 0.08, -0.05, dh)], (0, -1, 0), 'metal-cladding', sc, mode='fit')
        if det == 0:
            F.box(b, a - 0.1, -0.12, 0, a + 0.1, 0.0, h, wall_slot, lib.shade(wall_col, 1.06), skip=('bottom', 'back'))
    if det == 0:
        F.box(b, x1 - 0.1, -0.12, 0, x1 + 0.1, 0.0, h, wall_slot, lib.shade(wall_col, 1.06), skip=('bottom', 'back'))
        # lower strip of the wall between the shutters and the ground (plinth)
    F.roof(b, roof, x0, 0, x1, d, h, rs, 0.25, roof_slot, roof_col, wall_slot, wall_col, ov_front=vd + 0.1 if posts else 0.3, th=0.1)
    if awn and det == 0:
        for k in range(0, n, 3):
            sgk = F.seg(x0 + k * uw, 0, x0 + min(n, k + 2) * uw, 0)
            awning_seg(b, sgk, 0.1, sgk.length - 0.1, dh + 0.15, vd * 0.9, 0.5, awn, proud=0.05)
    if posts and det == 0 and vd > 0.4:
        pn = max(2, int(L / (uw * 2)) + 1)
        for k in range(pn):
            px = x0 + 0.3 + (L - 0.6) * k / (pn - 1)
            F.cyl(b, px, -vd, 0, h - 0.1, 0.05, n=4, slot='timber', col='#7a5a3a', top=False, smooth=False)


def shed_over_goods(b, F, L, d, h, lk, srng, *, roof='gable', roof_col=None, post_pitch=5.0, wall_col=None, rise=None, clad=None, goods=None, goods_kind='sacks', stacks=True):
    """Open-sided warehouse shed: posts + trusses carrying a corrugated roof, with stacked goods inside. Local x -L/2..L/2, y 0..d."""
    det = b.detail
    roof_col = roof_col or lk.roof_col
    x0, x1 = -L / 2, L / 2
    rs = rise if rise is not None else max(1.2, d * 0.17)
    if det >= 2:
        F.box(b, x0, 0, 0, x1, d, h - 0.2, 'plain', lib.shade(wall_col or lk.wall_col, 0.9), skip=('bottom', 'top'))
        F.roof(b, roof, x0, 0, x1, d, h, rs, 0.4, 'plain', roof_col, 'plain-render', wall_col or lk.wall_col, ov_front=0.4, infill=False)
        return
    pn = max(2, int(L / post_pitch) + 1)
    if clad:  # back wall and end walls (steel-clad warehouse)
        F.face(b, [(x1, d, 0), (x0, d, 0), (x0, d, h), (x1, d, h)], (0, 1, 0), 'metal-cladding', clad)
        F.face(b, [(x0, d, 0), (x0, 0, 0), (x0, 0, h), (x0, d, h)], (-1, 0, 0), 'metal-cladding', clad)
    for k in range(pn):
        px = x0 + 0.2 + (L - 0.4) * k / (pn - 1)
        for py in (0.2, d - 0.2):
            if det == 0:
                F.box(b, px - 0.12, py - 0.12, 0, px + 0.12, py + 0.12, h, 'plain', '#6f7378', skip=('bottom', 'top'))
            elif k % 3 == 0 or k == pn - 1:
                F.box(b, px - 0.15, py - 0.15, 0, px + 0.15, py + 0.15, h, 'plain', '#6f7378', skip=('bottom', 'top'))
    F.roof(b, roof, x0, 0, x1, d, h, rs, 0.5, 'corrugated', roof_col, 'plain-render', wall_col or lk.wall_col, th=0.12, ov_front=0.5, infill=False)
    if roof == 'gable' and det == 0:
        pass
    # stacked goods
    gc = goods or ['#cfc3a0', '#bda878', '#a89268']
    nstack = (int(L / 3.4) if det == 0 else max(2, int(L / 12))) if stacks else 0
    for k in range(nstack):
        gx = x0 + 1.6 + (L - 3.2) * (k + srng.uniform(0.0, 0.6)) / max(1, nstack)
        gw = srng.uniform(1.4, 2.4)
        gd = srng.uniform(1.2, 2.0)
        gy = srng.uniform(1.0, max(1.2, d - gd - 0.6))
        gh = srng.uniform(0.8, 1.8)
        if goods_kind == 'timber':
            F.box(b, gx - gw / 2, gy, 0.0, gx + gw / 2, gy + gd * 1.3, gh * 0.9, 'timber', srng.choice(['#a9825a', '#b8946a', '#8f6c48']), 'timber', '#c4a37a')
        elif goods_kind == 'yam':
            F.box(b, gx - gw / 2, gy, 0.0, gx + gw / 2, gy + gd, gh * 0.8, 'timber', '#8a6a45', 'plain', '#c9a76a')
        else:
            F.box(b, gx - gw / 2, gy, 0.0, gx + gw / 2, gy + gd, gh, 'plain', srng.choice(gc), 'plain', lib.shade(gc[0], 1.1))
        if det == 0 and goods_kind != 'timber':
            F.box(b, gx - gw * 0.3, gy + 0.1, gh, gx + gw * 0.3, gy + gd - 0.1, gh + 0.55, 'plain', srng.choice(gc))


# ------------------------------------------------------------------------------------------------------------------ shop fronts
def shopfront(b, seg, u0, u1, z0, gh, lk, srng, kind='shutter', col=None, sign_col=None, awn=None, wall_slot=None, wall_col=None, sign_h=0.9,
              proud=0.0, door=True):
    """Ground-floor shop unit on a wall: riser, shutter or glazing, blank fascia board and optional awning (colour list)."""
    ws = wall_slot or lk.wall_slot
    wc = wall_col or lk.wall_col
    det = b.detail
    w = u1 - u0
    sc = col or '#3f7fa6'
    sg = sign_col or lib.shade(sc, 0.8)
    top = gh - sign_h
    if det >= 2:
        return
    if kind == 'shutter':
        b.face([seg.P(u0 + 0.12, z0, -0.04 - proud), seg.P(u1 - 0.12, z0, -0.04 - proud), seg.P(u1 - 0.12, z0 + top, -0.04 - proud), seg.P(u0 + 0.12, z0 + top, -0.04 - proud)], 'metal-cladding', sc, mode='fit')
    elif kind == 'open':
        b.face([seg.P(u0 + 0.12, z0, -0.03 - proud), seg.P(u1 - 0.12, z0, -0.03 - proud), seg.P(u1 - 0.12, z0 + top, -0.03 - proud), seg.P(u0 + 0.12, z0 + top, -0.03 - proud)], 'glass-punched', '#4a443e', mode='fit')
    else:  # glazed
        rz = 0.55
        b.face([seg.P(u0, z0, -proud), seg.P(u1, z0, -proud), seg.P(u1, z0 + rz, -proud), seg.P(u0, z0 + rz, -proud)], ws, lib.shade(wc, 0.85), mode='fit')
        b.face([seg.P(u0 + 0.08, z0 + rz, -0.05 - proud), seg.P(u1 - 0.08, z0 + rz, -0.05 - proud), seg.P(u1 - 0.08, z0 + top, -0.05 - proud), seg.P(u0 + 0.08, z0 + top, -0.05 - proud)], 'glass-shopfront', '#dfe9ef', mode='fit')
        if det == 0 and door and w > 2.2:
            dc = u0 + w * 0.5
            seg_box_ = lib.seg_box
            seg_box_(b, seg, dc - 0.04, dc + 0.04, z0 + rz, z0 + top, 0.1 + proud, lk.frame_col, 'frame', inset=0.0)
    if det == 0:
        # side jambs / piers
        lib.seg_box(b, seg, u0, u0 + 0.12, z0, z0 + gh, 0.1 + proud, lib.shade(wc, 1.05), ws)
        lib.seg_box(b, seg, u1 - 0.12, u1, z0, z0 + gh, 0.1 + proud, lib.shade(wc, 1.05), ws)
    # fascia sign board (blank)
    lib.seg_box(b, seg, u0, u1, z0 + top, z0 + gh, 0.14 + proud, sg, 'plain', inset=0.0) if det == 0 else b.face(
        [seg.P(u0, z0 + top, -0.1 - proud), seg.P(u1, z0 + top, -0.1 - proud), seg.P(u1, z0 + gh, -0.1 - proud), seg.P(u0, z0 + gh, -0.1 - proud)], 'plain', sg)
    if awn:
        awning_seg(b, seg, u0 + 0.1, u1 - 0.1, z0 + top - 0.05, 1.1, 0.5, awn, proud=0.1 + proud)


# ------------------------------------------------------------------------------------------------------------------ terraces
def terrace_row(b, F, L, depth, storeys, lk, srng, kind='euro', cols=None, accents=None, *, gh=None, fh=3.2, roof=None, unit_w=None,
                wall_slot=None, roof_col=None, roof_slot=None, awn_p=0.5, balcony=False, chimneys=True, sf_kind=None, windows='punched',
                ratio=0.34, arcade=False, tank=False, signs=True, ends=True, back=True, reduced=False, back_kind=None):
    """A continuous row of narrow party-wall buildings along local x (-L/2 .. L/2), front at y = 0 facing -Y, depth `depth`.
    kind: euro (brick/stucco, sash windows, pitched roof along the row, chimneys) | asia (shophouse units with five-foot-way arcade,
    shutters, alternating tile roofs and stepped parapets) | naija (flat painted blocks with shutter shops, balcony bands, parapet).
    Returns the roof-top z."""
    det = b.detail
    cols = cols or PAINTS
    accents = accents or UMB
    gh = gh or (3.7 if kind != 'asia' else 3.5)
    ws = wall_slot or lk.wall_slot
    H = gh + fh * (storeys - 1)
    uw0 = unit_w or {'euro': 5.6, 'asia': 4.2, 'naija': 6.0}.get(kind, 5.5)
    if det == 1:
        uw0 *= 1.8
        windows = 'ribbon' if windows in ('punched', 'arched', 'pointed-arch') else windows
        awn_p = awn_p * 0.5
    uw0 /= max(0.3, DENSITY[0]) ** 0.5
    x0 = -L / 2
    widths = []
    acc = 0.0
    while acc < L - 0.5:
        w = uw0 * srng.uniform(0.82, 1.22)
        if L - acc - w < uw0 * 0.6:
            w = L - acc
        widths.append(w)
        acc += w
    # roofs and shared end walls first (cheap)
    zt = H
    roof_col = roof_col or lk.roof_col
    rslot = roof_slot or lk.roof_slot
    if kind == 'euro':
        pitch_rise = max(1.2, depth / 2 * math.tan(math.radians(32)))
        wcol0 = lk.wall_col
        if det == 2:
            F.box(b, x0, 0, 0, x0 + L, depth, H, ws, lk.wall_col, skip=('bottom', 'top'))
        F.roof(b, roof or 'gable', x0, 0, x0 + L, depth, H, pitch_rise, 0.3, rslot, roof_col, ws, lk.wall_col, ov_front=0.3, th=0.12)
        top = H + pitch_rise
    elif kind == 'naija' or roof == 'flat':
        if det == 2:
            F.box(b, x0, 0, 0, x0 + L, depth, H, ws, lk.wall_col, skip=('bottom', 'top'))
        F.roof(b, 'flat', x0, 0, x0 + L, depth, H, 0, 0.15, rslot, lk.roof_col, ws, lk.wall_col, parapet=0.55)
        top = H + 0.55
    else:
        top = H + 1.8
        if det == 2:
            F.box(b, x0, 0, 0, x0 + L, depth, H, ws, lk.wall_col, skip=('bottom', 'top'))
            F.roof(b, 'gable', x0, 0, x0 + L, depth, H, 1.6, 0.3, rslot, roof_col, ws, lk.wall_col, ridge='x')
    if det == 2:
        return top
    ex = x0
    for i, w in enumerate(widths):
        a, c = ex, ex + w
        ex = c
        wc = cols[i % len(cols)] if kind != 'euro' else lib.jitter(cols[(i * 3) % len(cols)], srng, 0.05)
        if kind == 'euro' and lk.wall_slot == 'brick' and i % 3 != 1:
            wc = lib.jitter(lk.wall_col, srng, 0.1)
        sg = F.seg(a, 0, c, 0)
        b.section('t-ground')
        zrec = 0.0
        if kind == 'asia':
            # five-foot-way: ground storey set back 1.6 m behind columns; upper storeys cantilever over it
            zrec = 1.6
            sgr = F.seg(a, zrec, c, zrec)
            b.face([sgr.P(0, 0), sgr.P(w, 0), sgr.P(w, gh), sgr.P(0, gh)], ws, lib.shade(wc, 0.9), mode='fit')
            sfk = sf_kind or srng.choice(['shutter', 'glass'])
            shopfront(b, sgr, 0, w, 0, gh, lk, srng, sfk, srng.choice(accents), None, None, ws, wc, sign_h=0.8)
            if det == 0:
                for ux in (0.0, w):
                    F.box(b, a + ux - 0.16, -0.16, 0, a + ux + 0.16, 0.16, gh, ws, lib.shade(wc, 1.08), skip=('bottom', 'top'))
                F.box(b, a, -0.2, gh - 0.3, c, 0.0, gh, ws, lib.shade(wc, 1.0))
        else:
            b.face([sg.P(0, 0), sg.P(w, 0), sg.P(w, gh), sg.P(0, gh)], ws, wc, mode='fit')
            sfk = sf_kind or ('glass' if kind == 'euro' else srng.choice(['shutter', 'shutter', 'glass', 'open']))
            awn = None
            if srng.random() < awn_p and det < 2:
                ac = srng.choice(accents)
                awn = [ac, '#efeae0'] if kind == 'euro' else [ac, lib.shade(ac, 1.25)]
            shopfront(b, sg, 0, w, 0, gh, lk, srng, sfk, srng.choice(accents), lib.shade(srng.choice(accents), 0.75) if signs else wc, awn, ws, wc)
        # upper storeys
        b.section('t-upper')
        if storeys > 1:
            seg_up = sg
            if kind == 'asia':
                # first floor sits on the arcade beam, flush with the column line
                pass
            bay_ = (3.0 if kind == 'asia' else (3.4 if kind == 'euro' else 3.2)) * (1.25 if not reduced and kind == 'euro' else 1.0)
            if storeys - 1 >= 2 and not reduced and det == 0:
                lib.facade(b, seg_up, gh, gh + fh, 1, lk, windows, ratio, srng, bay_, wall_slot=ws, wall_col=wc)
                lib.facade(b, seg_up, gh + fh, H, storeys - 2, lk, windows, ratio, srng, bay_, reduced=True, wall_slot=ws, wall_col=wc)
            else:
                lib.facade(b, seg_up, gh, H, storeys - 1, lk, windows, ratio, srng, bay_, reduced=reduced, wall_slot=ws, wall_col=wc)
            if det == 0:
                if kind == 'euro':
                    lib.seg_box(b, sg, 0, w, gh - 0.18, gh + 0.1, 0.12, lib.shade(wc, 1.12), 'plain-render')
                    lib.seg_box(b, sg, -0.02, w + 0.02, H - 0.45, H, 0.3, lib.shade(wc, 1.1), 'plain-render')
                if kind in ('naija', 'asia') and (balcony or kind == 'asia'):
                    for s in range(1, storeys):
                        zb = gh + fh * (s - 1)
                        lib.seg_box(b, sg, 0.15, w - 0.15, zb - 0.1, zb + 0.08, 0.8, lib.shade(wc, 0.9), 'plain-render')
                        lib.seg_box(b, sg, 0.15, w - 0.15, zb + 0.08, zb + 0.95, 0.78, lib.shade(wc, 1.05), 'frame', inset=0.74) if kind == 'naija' else None
                if kind == 'naija':
                    lib.seg_box(b, sg, -0.02, w + 0.02, H - 0.5, H, 0.18, lib.shade(wc, 0.9), 'plain-render')
        # per-unit roof / parapet decoration
        b.section('t-roof')
        if kind == 'asia':
            hh = 1.5 + 0.5 * (i % 2)
            F.roof(b, 'gable', a, 0.0, c, depth, H, hh, 0.35, rslot, roof_col, ws, wc, ridge='y', ov_front=0.9, th=0.1) if i % 3 else \
                F.roof(b, 'hip', a, 0.0, c, depth, H, hh, 0.3, rslot, roof_col, ws, wc, ov_front=0.9, th=0.1)
            if det == 0:
                F.box(b, a + w * 0.2, -0.05, H, c - w * 0.2, 0.2, H + 0.7, 'plain-render', lib.shade(wc, 1.08))
                F.box(b, a + w * 0.34, -0.05, H + 0.7, c - w * 0.34, 0.2, H + 1.15, 'plain-render', lib.shade(wc, 1.14))
        elif kind == 'euro' and chimneys and det == 0 and i % 2 == 0:
            cx = c
            F.box(b, cx - 0.5, depth / 2 - 0.35, H + pitch_rise - 0.6, cx + 0.5, depth / 2 + 0.35, H + pitch_rise + 1.4, 'brick', '#9b5a43', 'plain', '#4a4540')
    # party walls where the row steps and the ends
    if back and back_kind and det == 0:
        lib.facade(b, F.seg(x0 + L, depth, x0, depth), 0, H, storeys, lk, back_kind, ratio, srng, 3.4, reduced=True, wall_slot=ws, wall_col=lk.wall_col)
    elif back:
        F.face(b, [(x0 + L, depth, 0), (x0, depth, 0), (x0, depth, H), (x0 + L, depth, H)], (0, 1, 0), ws, lk.wall_col, scale=4.0 if det else 2.0)
    if ends:
        for sx, hint in ((x0, (-1, 0, 0)), (x0 + L, (1, 0, 0))):
            F.face(b, [(sx, 0, 0), (sx, depth, 0), (sx, depth, H), (sx, 0, H)] if sx > 0 else [(sx, depth, 0), (sx, 0, 0), (sx, 0, H), (sx, depth, H)], hint, ws, lk.wall_col, scale=3.0)
    if tank and det == 0:
        water_tank(b, *F.xy(x0 + L * 0.7, depth * 0.6), H + (0.5 if kind != 'euro' else 0), srng)
    return top


# ------------------------------------------------------------------------------------------------------------------ shop facade
def shop_facade(b, seg, z0, storeys, gh, fh, lk, srng, *, kind='shutter', cols=None, accents=None, unit_w=3.6, wall_slot=None, wall_col=None,
                windows='punched', ratio=0.3, gallery=False, awn_p=0.0, signs=True, arcade=False, reduced=False, band=True, bay=3.4,
                ground_shops=True, accent_band=None):
    """A multi-storey shop wall on any Seg: ground-floor units (shutter / glass / open) under blank fascia boards, optional arcade
    (recessed shops behind columns), upper floors through lib.facade, floor bands, gallery slabs with solid balustrades, awnings."""
    det = b.detail
    bay = globals()['bay'](bay)
    ws = wall_slot or lk.wall_slot
    wc = wall_col or lk.wall_col
    cols = cols or PAINTS
    accents = accents or UMB
    L = seg.length
    H = z0 + gh + fh * (storeys - 1)
    if ws in ('brick', 'timber') and L * (H - z0) > 450:
        ws = 'plain-render'      # small-tile textures would be cut into thousands of faces on a big wall
    if det >= 2:
        b.face([seg.P(0, z0), seg.P(L, z0), seg.P(L, H), seg.P(0, H)], ws, wc)
        return
    uw0 = unit_w * (2.2 if det == 1 else 1.0) / max(0.3, DENSITY[0]) ** 0.5
    n = max(1, int(round(L / uw0)))
    uw = L / n
    rd = 2.4 if arcade else 0.0
    sgr = lib.Seg(seg.P(0, 0, rd)[:2], seg.P(L, 0, rd)[:2]) if arcade else seg
    ground_slots = ws
    if ground_shops:
        for k in range(n):
            a, c = k * uw, (k + 1) * uw
            b.face([sgr.P(a, z0), sgr.P(c, z0), sgr.P(c, z0 + gh), sgr.P(a, z0 + gh)], ground_slots, lib.shade(wc, 0.92), mode='fit')
            sfk = kind if kind != 'mixed' else srng.choice(['shutter', 'shutter', 'glass', 'open'])
            ac = accents[(k * 7 + int(srng.random() * 3)) % len(accents)]
            awn = None
            if awn_p > 0 and srng.random() < awn_p:
                awn = [ac, '#efeae0']
            shopfront(b, sgr, a, c, z0, gh, lk, srng, sfk, ac, lib.shade(ac, 0.8) if signs else wc, awn, ws, wc)
    else:
        b.face([seg.P(0, z0), seg.P(L, z0), seg.P(L, z0 + gh), seg.P(0, z0 + gh)], ws, wc, scale=2.0 if det == 0 else 4.0)
    if arcade and det == 0:
        for k in range(n + 1):
            u = k * uw
            lib.seg_box(b, seg, max(0.0, u - 0.25), min(L, u + 0.25), z0, z0 + gh - 0.5, 0.0, lib.shade(wc, 1.05), ws, inset=0.5)
        lib.seg_box(b, seg, 0, L, z0 + gh - 0.5, z0 + gh, 0.0, lib.shade(wc, 1.1), ws, inset=rd)
    elif arcade:
        lib.seg_box(b, seg, 0, L, z0 + gh - 0.5, z0 + gh, 0.0, lib.shade(wc, 1.1), ws, inset=rd)
    if storeys > 1:
        zs = z0 + gh
        if kind == 'louvre-all':
            pass
        if det == 0 and storeys - 1 >= 3 and not reduced:
            lib.facade(b, seg, zs, zs + fh, 1, lk, windows, ratio, srng, bay, wall_slot=ws, wall_col=wc)
            lib.facade(b, seg, zs + fh, H, storeys - 2, lk, windows, ratio, srng, bay, reduced=True, wall_slot=ws, wall_col=wc)
        else:
            lib.facade(b, seg, zs, H, storeys - 1, lk, windows if det == 0 else ('ribbon' if windows in ('punched', 'arched') else windows), ratio, srng, bay, reduced=reduced, wall_slot=ws, wall_col=wc)
    if det == 0:
        if band and storeys > 1:
            for s in range(1, storeys):
                zf = z0 + gh + fh * (s - 1)
                lib.seg_box(b, seg, -0.05, L + 0.05, zf - 0.14, zf + 0.12, 0.1, lib.shade(wc, 1.1) if not accent_band else accent_band, ws)
        if gallery and storeys > 1:
            for s in range(1, storeys):
                zf = z0 + gh + fh * (s - 1)
                lib.seg_box(b, seg, 0.0, L, zf - 0.2, zf + 0.04, 1.3, lib.shade(wc, 0.85), ws, inset=0.0)
                lib.seg_box(b, seg, 0.0, L, zf + 0.04, zf + 1.0, 1.3, lib.shade(wc, 1.0) if not accent_band else accent_band, ws, inset=1.2)
        lib.seg_box(b, seg, -0.05, L + 0.05, H - 0.4, H, 0.22, lib.shade(wc, 1.12), ws)
    return H


def entrance_bay(b, seg, uc, w, z0, H, proud, lk, srng, col=None, sign_col=None, arch=True, sign=True):
    """A projecting entrance block on a wall: taller than the wall, with a dark arched/rectangular opening and a blank sign board."""
    det = b.detail
    col = col or lk.trim_col
    u0, u1 = uc - w / 2, uc + w / 2
    top = H + 1.6
    lib.seg_box(b, seg, u0, u1, z0, top, proud, col, lk.wall_slot, inset=0.0)
    if det >= 2:
        return
    ow = w * 0.55
    oh = (H - z0) * 0.62
    if arch:
        arch_door(b, seg, uc, ow, oh, z0, '#3c3a38', depth=proud + 0.04)
    else:
        b.face([seg.P(uc - ow / 2, z0, -proud - 0.04), seg.P(uc + ow / 2, z0, -proud - 0.04), seg.P(uc + ow / 2, z0 + oh, -proud - 0.04), seg.P(uc - ow / 2, z0 + oh, -proud - 0.04)], 'glass-punched', '#46403a', mode='fit')
    if sign and det < 2:
        sc = sign_col or lib.shade(lk.accent_col, 0.9)
        lib.seg_box(b, seg, u0 + 0.5, u1 - 0.5, z0 + oh + 0.8, z0 + oh + 0.8 + min(2.0, (top - z0 - oh) * 0.5), proud + 0.12, sc, 'plain', inset=0.0)


# ------------------------------------------------------------------------------------------------------------------ site
def flag_pole(b, x, y, h, col):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.06, n=5, slot='frame', col='#b8bcc0', r_top=0.04, top=True)
        b.facing([(x + 0.05, y, h - 1.5), (x + 2.0, y, h - 1.4), (x + 2.0, y, h - 0.2), (x + 0.05, y, h)], (0, -1, 0), 'plain', col)


def trees_row(b, lk, srng, x0, x1, y, n, hmin=6.5, hmax=9.5):
    if lk.tree in (None, 'none') or b.detail >= 2:
        return
    for k in range(n):
        t = (k + 0.5) / n
        lib.tree(b, lk.tree, x0 + (x1 - x0) * t + srng.uniform(-1.5, 1.5), y + srng.uniform(-1.2, 1.2), srng.uniform(hmin, hmax), srng, lk)


def commerce_site(b, lk, srng, fs, brief, x0, x1, y_front, y_back, *, park=None, road=True, trees=5, bays=True, depth_front=14.0, flags=True, lamps=0,
                  road_w=8.5, tree_h=(6.5, 9.5), tree_pos='row'):
    """Ground pad, road in front, optional car park and bus bays, trees, flags. `y_front` is the building's front line (negative)."""
    fc = (brief.get('setting') or {}).get('forecourt') or 'road'
    want_park = park if park is not None else ('car-park' in fs or fc == 'parking')
    extra = 15.0 if want_park else 0.0
    y0 = y_front - depth_front - extra
    lib.ground(b, x0, y0, x1, y_back, lk, z=0.0, scale=4.0)
    ry1 = y_front - 1.5
    ry0 = ry1 - road_w
    if road:
        lib.forecourt(b, 'road', x0 + 1, ry0, x1 - 1, ry1, lk, srng)
    if want_park and b.detail < 2:
        lib.forecourt(b, 'parking', x0 + 5, ry0 - 15.0, x1 - 5, ry0 - 1.5, lk, srng, density=DENSITY[0])
    elif fc in ('plaza', 'garden') and b.detail < 2 and not road:
        lib.forecourt(b, fc, x0 + 3, y_front - depth_front + 1, x1 - 3, y_front - 1.0, lk, srng)
    if 'bus-bays' in fs and b.detail < 2:
        with b.site():
            for k in range(3):
                bx = x0 + (x1 - x0) * (0.3 + 0.17 * k)
                lib.box_c(b, bx, ry0 - 3.2, 0.0, 9.0, 2.5, 2.9, 'metal-cladding', srng.choice(['#d6b030', '#c9ccd0', '#3b6f9f']), top_slot='roof-flat', top_col='#d8d8d8', skip=('bottom',))
    if lamps and b.detail == 0:
        for k in range(lamps):
            lib.lamp(b, x0 + (x1 - x0) * (k + 0.5) / lamps, ry1 + 0.8, 6.5)
    if tree_pos == 'ends':
        if lk.tree not in (None, 'none') and b.detail < 2:
            for k in range(min(trees, 4)):
                sx = (x0 + 2.5 + k // 2 * 3.5) if k % 2 == 0 else (x1 - 2.5 - k // 2 * 3.5)
                lib.tree(b, lk.tree, sx, y_front - 0.5 + srng.uniform(-0.4, 0.4), srng.uniform(*tree_h), srng, lk)
    else:
        trees_row(b, lk, srng, x0 + 5, x1 - 5, y_front - 2.2, trees, tree_h[0], tree_h[1])
    if 'flags' in fs and flags:
        for k in range(3):
            flag_pole(b, -6 + 6 * k, y_front - 3.0, 10, ['#0b7a43', '#f2f2f2', '#b6323a'][k])
    if 'floodlights' in fs and b.detail == 0:
        with b.site():
            for sx in (-1, 1):
                lib.cylinder(b, sx * (x1 - 5), y_back - 6, 0, 14, 0.22, n=6, slot='frame', col='#8d9298', r_top=0.14)
                lib.box_c(b, sx * (x1 - 5), y_back - 6, 14, 3.0, 0.5, 1.2, 'plain', '#3d4146')
    return y0


def roof_extras(b, F, x0, y0, x1, y1, z, srng, lk, cores=1, tanks=2, plant=3, rebar=True):
    """Typical flat-roof extras (local rect): stair/lift cores with sloping roofs, water tanks, plant boxes, rebar stubs."""
    det = b.detail
    if det >= 2:
        return
    for _ in range(cores):
        w, d, h = srng.uniform(3.4, 4.6), srng.uniform(3.0, 4.0), 3.0
        cx = srng.uniform(x0 + w, x1 - w)
        cy = srng.uniform(y0 + d, y1 - d)
        F.box(b, cx - w / 2, cy - d / 2, z, cx + w / 2, cy + d / 2, z + h, lk.wall_slot, lib.shade(lk.wall_col, 0.95), skip=('bottom', 'top'))
        F.roof(b, 'shed', cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2, z + h, 0.4, 0.2, 'roof-flat', lk.roof_col, lk.wall_slot, lib.shade(lk.wall_col, 0.95), ov_front=0.3)
    if det > 0:
        return
    for _ in range(tanks):
        water_tank(b, *F.xy(srng.uniform(x0 + 2, x1 - 2), srng.uniform(y0 + 2, y1 - 2)), z, srng, col=srng.choice(['#2f4f6f', '#3a3a3a', '#6f7f8f']))
    for _ in range(plant):
        w, d, h = srng.uniform(1.2, 2.6), srng.uniform(1.0, 2.0), srng.uniform(0.8, 1.6)
        cx = srng.uniform(x0 + w, x1 - w)
        cy = srng.uniform(y0 + d, y1 - d)
        F.box(b, cx - w / 2, cy - d / 2, z, cx + w / 2, cy + d / 2, z + h, 'metal-cladding', lib.shade(lk.metal_col, srng.uniform(0.85, 1.05)), 'roof-flat', '#8a8f92')
    if rebar:
        for sx in (x0 + 1.0, x1 - 1.0):
            for sy in (y0 + 1.0, y1 - 1.0):
                if srng.random() < 0.6:
                    q = F.xy(sx, sy)
                    lib.cylinder(b, q[0], q[1], z, z + srng.uniform(1.8, 3.6), 0.08, n=3, slot='frame', col='#8a5a44', top=False, smooth=False)


def roof_over_rects(b, F, rects, form, z, rise_fn, lk, ov=0.8, slot=None, col=None, wall_slot=None, wall_col=None):
    """A hip or gable roof over each wing rectangle of a footprint (wings are extended into the main mass so the roofs intersect).
    rise_fn(w, d) gives the rise for a rect of that size."""
    main = max(rects, key=lambda q: (q[2] - q[0]) * (q[3] - q[1]))
    for rc in rects:
        x0, y0, x1, y1 = rc
        if rc is not main:
            span = min(main[2] - main[0], main[3] - main[1]) / 2
            if abs(y0 - main[3]) < 1e-3:
                y0 -= span
            elif abs(y1 - main[1]) < 1e-3:
                y1 += span
            elif abs(x0 - main[2]) < 1e-3:
                x0 -= span
            elif abs(x1 - main[0]) < 1e-3:
                x1 += span
        w, d = x1 - x0, y1 - y0
        ridge = 'x' if w >= d else 'y'
        F.roof(b, form, x0, y0, x1, y1, z, rise_fn(w, d), ov, slot or lk.roof_slot, col or lk.roof_col, wall_slot or lk.wall_slot, wall_col or lk.wall_col,
               ridge=ridge, ov_front=ov)


# ------------------------------------------------------------------------------------------------------------------ shared props (shophouse, restaurant)
CHAIRS = ['#c4452f', '#2f6fb0', '#e0b030', '#3b8a4e', '#f2f2ee', '#7a4a9a']

def fascia(b, F, x0, x1, z0, z1, y, col, proud=0.3):
    """Blank sign fascia box in front of local y (towards -Y)."""
    F.box(b, x0, y - proud, z0, x1, y, z1, 'plain', col, 'plain', lib.shade(col, 0.85), skip=('bottom',))


def ac_unit(b, F, x, y, z):
    if b.detail >= 1:
        return
    F.box(b, x - 0.45, y - 0.32, z, x + 0.45, y, z + 0.55, 'plain', '#e6e6e2', 'plain', '#cfcfca', skip=('bottom', 'back'))
    F.box(b, x - 0.3, y - 0.34, z + 0.1, x + 0.3, y - 0.32, z + 0.45, 'frame', '#7d8286', skip=('bottom', 'back'))


def container_kiosk(b, F, x, y, w, d, col, door_col='#3b3a38'):
    """A trading container: ribbed box with a shutter window and a small awning."""
    h = 2.6
    F.box(b, x - w / 2, y - d / 2, 0.15, x + w / 2, y + d / 2, h + 0.15, 'metal-cladding', col, 'metal-cladding', lib.shade(col, 0.9), skip=('bottom',))
    if b.detail < 2:
        F.face(b, [(x - w * 0.34, y - d / 2 - 0.03, 0.95), (x + w * 0.34, y - d / 2 - 0.03, 0.95), (x + w * 0.34, y - d / 2 - 0.03, 2.0), (x - w * 0.34, y - d / 2 - 0.03, 2.0)], (0, -1, 0), 'glass-punched', door_col, mode='fit')
    if b.detail == 0:
        F.box(b, x - w * 0.4, y - d / 2 - 0.5, 2.05, x + w * 0.4, y - d / 2, 2.15, 'plain', lib.shade(col, 1.2), skip=('bottom',))
        F.box(b, x - w * 0.4, y - d / 2 - 0.6, 0.0, x + w * 0.4, y - d / 2, 0.15, 'paving', '#bdb8ae')


def poly_tank(b, x, y, z, col='#2f4f6f'):
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, z, z + 1.5, 0.75, n=10 if b.detail == 0 else 6, slot='plain', col=col, r_top=0.7, top=True)
    if b.detail == 0:
        lib.cylinder(b, x, y, z + 1.5, z + 1.7, 0.2, n=5, slot='plain', col=lib.shade(col, 0.7), top=True)


def chair_set(b, F, x, y, srng, n=2, with_umbrella=True):
    """Umbrella, round table and plastic chairs on the pavement in front of a shop (local frame)."""
    q = F.xy(x, y)
    if with_umbrella:
        umbrella(b, q[0], q[1], 1.7, 2.5, srng.choice(UMB))
    ccol = srng.choice(CHAIRS)
    dining_set(b, q[0], q[1], srng, '#f2f2ee', [ccol], chairs=n * 2 if b.detail == 0 else 2)


def external_stair(b, F, x, y0, y1, z_top, srng, col):
    """A concrete external staircase along a side wall, rising towards +y, with a landing and a solid balustrade."""
    run = y1 - y0
    w = 1.1
    n = 14 if b.detail == 0 else 1
    if b.detail >= 2:
        return
    pts = [(y0, 0.0), (y1 - 1.4, z_top - 0.2), (y1 - 1.4, z_top - 0.45), (y0, -0.0)]
    # stringer side faces and the sloped treads as one sloped slab; landing slab
    F.box(b, x - w / 2, y1 - 1.4, z_top - 0.3, x + w / 2 + 0.4, y1, z_top, 'rough-concrete', col, 'rough-concrete', lib.shade(col, 1.05), skip=('bottom',))
    for sx, hint in ((x - w / 2, (-1, 0, 0)), (x + w / 2, (1, 0, 0))):
        F.face(b, [(sx, y0, 0.0), (sx, y1 - 1.4, z_top - 0.3), (sx, y1 - 1.4, z_top + 0.9), (sx, y0, 0.9)], hint, 'rough-concrete', lib.shade(col, 0.95), scale=2.0)
    F.face(b, [(x - w / 2, y0, 0.9), (x + w / 2, y0, 0.9), (x + w / 2, y1 - 1.4, z_top + 0.9), (x - w / 2, y1 - 1.4, z_top + 0.9)], (0, 0, 1), 'plain', lib.shade(col, 1.1))
    if b.detail == 0:
        for k in range(n):
            t = k / n
            yy = y0 + (y1 - 1.4 - y0) * t
            zz = 0.0 + (z_top - 0.3) * t
        F.face(b, [(x - w / 2 + 0.05, y0, 0.02), (x + w / 2 - 0.05, y0, 0.02), (x + w / 2 - 0.05, y1 - 1.4, z_top - 0.28), (x - w / 2 + 0.05, y1 - 1.4, z_top - 0.28)], (0, 0, 1), 'paving', lib.shade(col, 1.2), scale=0.7)


def pergola(b, F, x0, y0, x1, y1, z, h, col='#8a6a45'):
    """Timber pergola: posts at the corners, cross beams, slat roof."""
    if b.detail >= 2:
        return
    for px in (x0, x1):
        for py in (y0, y1):
            F.box(b, px - 0.1, py - 0.1, z, px + 0.1, py + 0.1, z + h, 'timber', col, skip=('bottom', 'top'))
    nb = max(3, int((x1 - x0) / 0.9)) if b.detail == 0 else 3
    for k in range(nb + 1):
        x = x0 + (x1 - x0) * k / nb
        F.box(b, x - 0.05, y0 - 0.2, z + h, x + 0.05, y1 + 0.2, z + h + 0.1, 'timber', col, skip=('bottom',))
    if b.detail == 0:
        F.box(b, x0 - 0.2, y0 - 0.05, z + h - 0.15, x1 + 0.2, y0 + 0.05, z + h, 'timber', col)
        F.box(b, x0 - 0.2, y1 - 0.05, z + h - 0.15, x1 + 0.2, y1 + 0.05, z + h, 'timber', col)


def string_lights(b, F, x0, x1, y0, y1, z, n=10, col='#ffe9a8'):
    """A zigzag of bright bulbs (small cubes) strung between the rooftop poles."""
    if b.detail >= 1:
        return
    for k in range(n):
        t = k / max(1, n - 1)
        x = x0 + (x1 - x0) * t
        y = y0 + (y1 - y0) * (0.5 + 0.5 * math.sin(t * 9))
        q = F.xy(x, y)
        lib.box_c(b, q[0], q[1], z - 0.08 * math.sin(t * 3.14159 * 4), 0.12, 0.12, 0.12, 'plain', col)


def railing_ring(b, F, x0, y0, x1, y1, z, h=1.0, col='#9ea3a8', glass=False):
    if b.detail >= 2:
        return
    t = 0.05
    if glass:
        for (xa, ya, xb, yb, hint) in ((x0, y0, x1, y0, (0, -1, 0)), (x1, y0, x1, y1, (1, 0, 0)), (x1, y1, x0, y1, (0, 1, 0)), (x0, y1, x0, y0, (-1, 0, 0))):
            F.face(b, [(xa, ya, z), (xb, yb, z), (xb, yb, z + h), (xa, ya, z + h)], hint, 'glass-ribbon', '#cfe0e8', mode='fit')
            F.face(b, [(xb, yb, z), (xa, ya, z), (xa, ya, z + h), (xb, yb, z + h)], (-hint[0], -hint[1], 0), 'glass-ribbon', '#cfe0e8', mode='fit')
        return
    for (xa, ya, xb, yb) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
        p0, p1 = F.xy(xa, ya), F.xy(xb, yb)
        lib.beam(b, p0, p1, z + h - 0.06, z + h, 0.07, 'frame', col, skip=('bottom',))
        if b.detail == 0:
            lib.beam(b, p0, p1, z + h * 0.45, z + h * 0.45 + 0.04, 0.05, 'frame', col, skip=('bottom',))
            n = int(math.dist(p0, p1) / 1.8) + 1
            for k in range(n + 1):
                t_ = k / n
                lib.cylinder(b, p0[0] + (p1[0] - p0[0]) * t_, p0[1] + (p1[1] - p0[1]) * t_, z, z + h, 0.03, n=3, slot='frame', col=col, top=False, smooth=False)


def relief_band(b, seg, u0, u1, z0, z1, col_a, col_b):
    """A band of diamond relief motifs (flat faces) on a wall."""
    L = u1 - u0
    n = max(2, int(L / 0.9))
    w = L / n
    zm = (z0 + z1) / 2
    for k in range(n):
        uc = u0 + (k + 0.5) * w
        c = col_a if k % 2 == 0 else col_b
        b.face([seg.P(uc - w * 0.45, zm, -0.03), seg.P(uc, z0, -0.03), seg.P(uc + w * 0.45, zm, -0.03), seg.P(uc, z1, -0.03)], 'plain', c)


def sign_pole(b, F, x, y, h, w, col):
    if b.detail >= 2:
        return
    q = F.xy(x, y)
    lib.cylinder(b, q[0], q[1], 0, h, 0.1, n=5, slot='frame', col='#7d8286', top=False)
    F.box(b, x - w / 2, y - 0.1, h - 1.4, x + w / 2, y + 0.1, h, 'plain', col, skip=('bottom',))



# ------------------------------------------------------------------------------------------------------------------ roof features
def roof_lounge(b, F, x0, y0, x1, y1, z, srng, lk, acc, tables_n=3, pergola_=True, glass_rail=True, lights=True, bar=True, deck=True):
    """A rooftop terrace on the local rect at height z: timber deck, balustrade, pergola over the back half, bar counter, tables with
    umbrellas, planters, string lights and a stair core."""
    det = b.detail
    if det >= 2:
        return
    W, D = x1 - x0, y1 - y0
    railing_ring(b, F, x0 + 0.25, y0 + 0.25, x1 - 0.25, y1 - 0.25, z + 0.4, 1.0, glass=glass_rail and (det > 0 or srng.random() < 0.5))
    if deck:
        F.box(b, x0 + 0.5, y0 + 0.5, z, x1 - 0.5, y1 - 0.5, z + 0.12, 'timber', '#a58559', 'timber', '#b8946a', skip=('bottom',))
    if pergola_ and D > 6:
        pw = W * 0.5
        pergola(b, F, x1 - 0.8 - pw, y1 - 0.8 - D * 0.45, x1 - 0.8, y1 - 0.8, z + 0.1, 2.5)
    if bar and W > 6:
        F.box(b, x0 + 0.8, y1 - 1.7, z + 0.1, x0 + 0.8 + W * 0.28, y1 - 0.9, z + 1.2, 'timber', '#6f5238', 'plain', '#2a2623', skip=('bottom',))
    n = tables_n if det == 0 else 1
    for k in range(n):
        tx = x0 + 1.4 + (W - 2.8) * (k + 0.5) / max(1, n)
        ty = y0 + 1.6 + (k % 2) * 1.8
        q = F.xy(tx, ty)
        if det == 0:
            umbrella(b, q[0], q[1], 1.5, z + 2.6, srng.choice(UMB))
        dining_set(b, q[0], q[1], srng, '#f2f2ee', [srng.choice(CHAIRS)], chairs=3 if det == 0 else 2)
    if lights and det == 0:
        string_lights(b, F, x0 + 0.6, x1 - 0.6, y0 + 1.0, y1 - 1.0, z + 2.6, 12)
        for px in (x0 + 0.6, x1 - 0.6):
            F.cyl(b, px, y0 + 0.6, z + 0.1, z + 2.7, 0.04, n=3, slot='frame', col='#3a3a3a', top=False, smooth=False)
    if det == 0:
        for k in range(3):
            q = F.xy(x0 + 1.0 + k * (W - 2) / 2, y0 + 0.7)
            lib.blob(b, q[0], q[1], z + 0.55, 0.45, 0.35, 0.35, '#4f7d3b', n=6, rings=3)


def roof_skylight(b, F, x0, y0, x1, y1, z, lk, rise=1.6):
    """A glazed skylight (hipped glass box) on a flat roof."""
    if b.detail >= 2:
        return
    F.box(b, x0, y0, z, x1, y1, z + 0.5, 'plain', lib.shade(lk.trim_col, 0.9), skip=('bottom', 'top'))
    F.roof(b, 'hip', x0, y0, x1, y1, z + 0.5, rise, 0.0, 'glass-ribbon', '#cfdde4', 'plain', lk.trim_col, ov_front=0.0, th=0.0)


def merlons(b, F, x0, y0, x1, y1, z, col, slot='plain-render', pitch=1.5):
    """Crenellation round the local rect at height z (top of parapet): small blocks along the edges."""
    if b.detail >= 1:
        return
    for (xa, ya, xb, yb) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
        L = math.hypot(xb - xa, yb - ya)
        n = max(2, int(L / pitch))
        for k in range(n):
            t = (k + 0.5) / n
            q = F.xy(xa + (xb - xa) * t, ya + (yb - ya) * t)
            lib.obox(b, q[0], q[1], z, 0.5, 0.35, 0.5, F.yaw + math.atan2(yb - ya, xb - xa), slot, col)


def flat_canopy_at(b, F, cx, y, w, d, z, lk, col=None):
    """A flat canopy slab projecting d in front of local y, on two or more columns, with a blank fascia."""
    if b.detail >= 2:
        F.box(b, cx - w / 2, y - d, z - 0.3, cx + w / 2, y, z, 'plain', col or lk.roof_col, skip=('bottom',))
        return
    F.box(b, cx - w / 2, y - d, z - 0.4, cx + w / 2, y, z, 'plain-render', lib.shade(col or lk.trim_col, 0.95), 'roof-flat', lk.roof_col, skip=())
    if b.detail == 0:
        n = max(2, int(w / 4.5) + 1)
        for k in range(n):
            x = cx - w / 2 + 0.4 + (w - 0.8) * k / (n - 1)
            F.cyl(b, x, y - d + 0.35, 0, z - 0.4, 0.14, n=6, slot='frame', col='#aab0b6', top=False)
