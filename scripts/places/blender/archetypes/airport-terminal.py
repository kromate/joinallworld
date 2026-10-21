"""airport-terminal: four terminal typologies (wave | linear | pier | regional) x control tower variants, jet bridges, aircraft, canopies,
forecourt with parking. Everything is derived from the brief (form, facade, features, notes) and the city style, plus the seeded rng.

Layout (metres): terminal centred on x = 0, landside (forecourt) towards -Y, airside (apron, aircraft) towards +Y.
"""
import math
import random

import lib

FEATURES = {'control-tower', 'jet-bridge', 'curved-canopy', 'flat-canopy', 'car-park', 'flags', 'signage-board', 'solar-panels',
            'mast', 'atrium-glass', 'brise-soleil', 'floodlights', 'colonnade', 'balcony-bands', 'louvres'}

W_MAX = 112.0


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _feat(brief):
    out = {}
    for f in brief.get('features') or []:
        if isinstance(f, dict):
            out[f.get('id')] = f
        else:
            out[f] = {'id': f, 'count': 1}
    return out


def _text(brief):
    return ' '.join(str(brief.get(k, '')) for k in ('subject', 'notes', 'style', 'era')).lower()


def infer(brief, rng):
    """Typology and roof character from the brief. Returns (type, roof_style, tower_kind)."""
    form = brief.get('form', {})
    txt = _text(brief)
    feats = _feat(brief)
    w = float(form.get('width_m', 80))
    fp = form.get('footprint', 'rect')
    roof = form.get('roof', 'flat')
    if 'regional' in txt or 'airstrip' in txt or 'small' in txt.split() or w < 62:
        typ = 'regional'
    elif fp in ('T', 'H', 'cross') or 'pier' in txt or 'finger' in txt or 'satellite' in txt:
        typ = 'pier'
    elif roof in ('barrel',) or 'curved' in txt or 'sweeping' in txt or 'wave' in txt or 'sail' in txt or 'curved-canopy' in feats and roof != 'flat':
        typ = 'wave'
    else:
        typ = 'linear'
    if 'wave' in txt:
        rs = 'undulate'
    elif 'sweep' in txt or 'swoop' in txt or 'sail' in txt or 'wing' in txt:
        rs = 'sweep'
    elif roof == 'barrel':
        rs = 'vault'
    else:
        rs = rng.choice(['sweep', 'undulate', 'vault'])
    era = str(brief.get('era', '2000s'))
    old = any(era.startswith(p) for p in ('195', '196', '197', '198'))
    tk = 'round' if old else rng.choice(['faceted', 'round', 'square'])
    if 'faceted' in txt or 'angular' in txt:
        tk = 'faceted'
    return typ, rs, tk


# ------------------------------------------------------------------------------------------------------------- aircraft
def airliner(b, x, y, yaw, scale, col, tail_col, rng):
    """Low-poly twin-engine airliner (about 38 m x 34 m x 12 m at scale 1), nose pointing along `yaw` (0 = nose to +Y)."""
    if b.detail >= 2:
        return
    with b.site():
        c, s = math.cos(yaw), math.sin(yaw)

        def T(lx, ly, lz):  # local: +ly = forward (nose), lx = right wing
            return (x + (lx * c - ly * s) * scale, y + (lx * s + ly * c) * scale, lz * scale)

        n = 10 if b.detail == 0 else 5
        stations = [(-17.5, 0.35), (-14, 1.0), (-8, 1.9), (-2, 2.0), (8, 2.0), (14, 1.9), (17, 1.4), (18.7, 0.9), (19.2, 0.0)]
        if b.detail == 1:
            stations = [stations[0], stations[2], stations[4], stations[6], stations[8]]
        # fuselage: rows round, cols along length
        grid = []
        for k in range(n + 1):
            a = 2 * math.pi * k / n
            grid.append([T(r * math.cos(a), ly, 2.6 + r * math.sin(a) * 0.95) for ly, r in stations])
        b.shared_grid(grid, 'plain', col, smooth=True, wrap=True)
        # wings (thin double-sided swept panels)
        for sx in (-1, 1):
            root_f, root_b = 5.5, -1.5
            tip_f, tip_b = -4.0, -7.0
            span = 16.5
            pts = [T(sx * 1.6, root_f, 2.2), T(sx * span, tip_f, 2.6), T(sx * span, tip_b, 2.6), T(sx * 1.6, root_b, 2.2)]
            b.facing(pts, (0, 0, 1), 'plain', shade_(col, 0.95))
            b.facing(pts, (0, 0, -1), 'plain', shade_(col, 0.7))
            ex, ey = sx * 6.2, 2.5
            if b.detail == 0:
                _engine(b, T, ex, ey, scale, col)
        # tail fin + stabilisers
        fin = [T(0.0, -12.5, 4.0), T(0.0, -18.6, 4.0), T(0.0, -19.2, 10.5), T(0.0, -15.6, 10.5)]
        b.facing(fin, (1, 0, 0), 'plain', tail_col)
        b.facing(fin, (-1, 0, 0), 'plain', tail_col)
        for sx in (-1, 1):
            st = [T(0.0, -15.5, 4.6), T(sx * 6.0, -19.0, 4.8), T(sx * 6.0, -20.2, 4.8), T(0.0, -19.2, 4.6)]
            b.facing(st, (0, 0, 1), 'plain', shade_(col, 0.9))
            b.facing(st, (0, 0, -1), 'plain', shade_(col, 0.7))
        # landing gear: nose + two mains (without them the belly floats)
        for (gx, gy) in ((0.0, 13.0), (-2.7, -1.2), (2.7, -1.2)):
            gp = T(gx, gy, 0)
            lib.cylinder(b, gp[0], gp[1], 0.0, 1.9 * scale, 0.22 * scale if b.detail == 0 else 0.3 * scale, n=4, slot='plain', col='#2b2d30', top=False, smooth=False)
        # cockpit glass hint
        if b.detail == 0:
            ck = [T(-0.9, 16.2, 3.9), T(0.9, 16.2, 3.9), T(0.7, 17.4, 3.5), T(-0.7, 17.4, 3.5)]
            b.facing(ck, (0, 0, 1), 'plain', '#1b232b')


def _engine(b, T, ex, ey, scale, col):
    n = 6
    pts = []
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        pts.append([T(ex + 1.0 * math.cos(a), ey + ly, 1.3 + 1.0 * math.sin(a)) for ly in (0.0, 3.2)])
    b.shared_grid(pts, 'plain', shade_(col, 0.78), smooth=True, wrap=True)


def shade_(c, f):
    return lib.shade(c, f)


# ------------------------------------------------------------------------------------------------------------ jet bridge
def jet_bridge(b, x, y_wall, z, length, col, yaw=0.0, wall_dir=(0.0, 1.0)):
    """Telescoping passenger bridge leaving a wall at (x, y_wall) in direction wall_dir, at floor height z. A glazed-looking tube on
    a wheeled support, with a rotunda at the terminal end and a cab at the aircraft end."""
    if b.detail >= 2:
        return
    with b.site():
        dx, dy = wall_dir
        yw = math.atan2(dy, dx)
        L = length
        cx, cy = x + dx * L / 2, y_wall + dy * L / 2
        lib.obox(b, cx, cy, z, L, 2.7, 2.7, yw, 'plain', col, top_col=lib.shade(col, 1.08))
        if b.detail == 0:
            # window band along both long sides
            for sgn in (-1, 1):
                ox, oy = -dy * 1.356 * sgn, dx * 1.356 * sgn
                a0 = (x + dx * 3 + ox, y_wall + dy * 3 + oy)
                a1 = (x + dx * (L - 2) + ox, y_wall + dy * (L - 2) + oy)
                pts = [(a0[0], a0[1], z + 1.0), (a1[0], a1[1], z + 1.0), (a1[0], a1[1], z + 2.1), (a0[0], a0[1], z + 2.1)]
                b.facing(pts, (ox, oy, 0), 'glass-ribbon', '#cfd8dd', mode='tile')
            lib.cylinder(b, x + dx * 1.2, y_wall + dy * 1.2, z - 0.2, z + 3.0, 2.0, n=10, slot='plain', col=lib.shade(col, 0.9))
            lib.cylinder(b, x + dx * (L - 0.6), y_wall + dy * (L - 0.6), z - 0.1, z + 2.9, 1.7, n=8, slot='plain', col=lib.shade(col, 0.85))
        # support column + wheel bogie
        sx_, sy_ = x + dx * (L - 3.0), y_wall + dy * (L - 3.0)
        lib.cylinder(b, sx_, sy_, 0.35, z, 0.25, n=5, slot='plain', col='#6e7378', top=False)
        lib.obox(b, sx_, sy_, 0.0, 1.6, 0.9, 0.4, yw, 'plain', '#3a3d41')


# ----------------------------------------------------------------------------------------------------------- control tower
def control_tower(b, x, y, kind, height, look, rng, shaft_col=None):
    """Free-standing or terminal-attached control tower. kind: round (tapered concrete drum, wide cab) | faceted (hexagonal shaft,
    sloping glass cab) | square (box shaft with slit windows, boxy cab). `height` is to the top of the cab roof (mast excluded)."""
    sc = shaft_col or look.stone_col
    n = {0: 16, 1: 10, 2: 6}[b.detail]
    cab_h = _clamp(height * 0.09, 3.6, 5.2)
    tech_h = 2.4
    shaft_h = height - cab_h - tech_h
    base_r = _clamp(height * 0.062, 2.6, 4.2)
    top_r = base_r * (0.72 if kind == 'round' else (0.6 if kind == 'faceted' else 0.82))
    glass = look.glass_col
    if kind == 'square':
        w0, w1 = base_r * 1.7, base_r * 1.45
        grid_slabs = 4 if b.detail == 0 else 1
        zz = 0
        for k in range(grid_slabs):
            h0, h1 = shaft_h * k / grid_slabs, shaft_h * (k + 1) / grid_slabs
            wa = w0 + (w1 - w0) * k / grid_slabs
            wb = w0 + (w1 - w0) * (k + 1) / grid_slabs
            _frustum_sq(b, x, y, h0, h1, wa, wb, 'rough-concrete', sc)
        if b.detail == 0:
            for sgn in (-1, 1):  # slit windows on the front/back faces
                for k in range(5):
                    zb = shaft_h * (0.12 + 0.17 * k)
                    ww = w0 * 0.12
                    b.face([(x - ww, y - w0 / 2 - 0.02, zb), (x + ww, y - w0 / 2 - 0.02, zb), (x + ww, y - w0 / 2 - 0.02, zb + 1.8), (x - ww, y - w0 / 2 - 0.02, zb + 1.8)], 'glass-punched', glass)
                break
        _frustum_sq(b, x, y, shaft_h, shaft_h + tech_h, w1, w1 * 1.2, 'rough-concrete', lib.shade(sc, 0.85))
        cw0, cw1 = w1 * 1.2, w1 * 2.0
        zc = shaft_h + tech_h
        _frustum_sq(b, x, y, zc, zc + cab_h, cw0, cw1, 'glass-ribbon', glass, tile=True)
        lib.box_c(b, x, y, zc + cab_h, cw1 + 0.8, cw1 + 0.8, 0.5, 'plain-render', lib.shade(sc, 0.9), skip=())
        top = zc + cab_h + 0.5
    else:
        sides = n if kind == 'round' else (6 if b.detail < 2 else 6)
        fn = max(6, sides)
        angs = [2 * math.pi * k / fn for k in range(fn + 1)]
        sm = kind == 'round'
        # shaft in 3 tapered stages
        zs = [0.0, shaft_h * 0.55, shaft_h]
        rs = [base_r, base_r * 0.86, top_r]
        for a_, b_ in ((0, 1), (1, 2)):
            if b.detail >= 2 and a_ == 1:
                break
            lib.cylinder(b, x, y, zs[a_], zs[b_], rs[a_], n=fn, slot='rough-concrete', col=sc, r_top=rs[b_], top=False, smooth=sm)
        if b.detail >= 2:
            lib.cylinder(b, x, y, 0, shaft_h, base_r, n=fn, slot='plain', col=sc, r_top=top_r, top=False, smooth=sm)
        if b.detail == 0:
            # base podium with entrance
            lib.cylinder(b, x, y, 0, 3.2, base_r * 1.35, n=fn, slot='rough-concrete', col=lib.shade(sc, 0.92), r_top=base_r * 1.25, top=True, smooth=sm)
            # window slits on the front
            for k in range(6):
                zb = shaft_h * (0.14 + 0.13 * k)
                r_ = base_r + (top_r - base_r) * (zb / shaft_h) * 0.8
                ww = 0.35
                b.facing([(x - ww, y - r_ - 0.03, zb), (x + ww, y - r_ - 0.03, zb), (x + ww, y - r_ - 0.03, zb + 1.4), (x - ww, y - r_ - 0.03, zb + 1.4)], (0, -1, 0), 'glass-punched', glass)
        zt = shaft_h
        # technical floor, flaring out
        cab_r0 = top_r * 1.15 if kind == 'round' else top_r * 1.05
        cab_r1 = cab_r0 * (1.95 if kind == 'round' else 2.7)
        if kind != 'round':
            cab_h *= 1.2
        lib.cylinder(b, x, y, zt, zt + tech_h, top_r, n=fn, slot='rough-concrete', col=lib.shade(sc, 0.82), r_top=cab_r0 * 1.35 if kind == 'round' else cab_r0 * 1.2, top=True, smooth=sm)
        zc = zt + tech_h
        # glazed cab, widening upwards (the signature tower silhouette)
        grid = [[(x + math.cos(a) * cab_r0 * 1.35, y + math.sin(a) * cab_r0 * 1.35, zc), (x + math.cos(a) * cab_r1, y + math.sin(a) * cab_r1, zc + cab_h)] for a in angs]
        b.shared_grid(grid, 'glass-ribbon', glass, smooth=False, wrap=True)
        # cab roof: thick disc + equipment
        lib.cylinder(b, x, y, zc + cab_h, zc + cab_h + 0.55, cab_r1 * 1.08, n=fn, slot='plain-render', col=lib.shade(sc, 0.9), r_top=cab_r1 * 1.02, top=True, smooth=False)
        top = zc + cab_h + 0.55
        if kind == 'faceted' and b.detail < 2:
            lib.cylinder(b, x, y, top, top + 1.8, cab_r1 * 0.5, n=fn, slot='plain-render', col=lib.shade(sc, 0.8), r_top=0.0, smooth=False)
            top += 1.8
        if b.detail < 2:
            lib.cylinder(b, x, y, zc, zc + 0.3, cab_r0 * 1.4, n=fn, slot='plain', col='#4a4e52', top=False, smooth=False)
    if b.detail < 2:
        lib.cylinder(b, x, y, top, top + height * 0.16, 0.12, n=5, slot='frame', col='#5a5f64', r_top=0.04, top=True)
        lib.box_c(b, x + 1.0, y + 0.3, top, 1.4, 0.9, 1.0, 'plain', '#7d8286')
        if b.detail == 0:
            lib.cylinder(b, x - 1.2, y, top, top + 1.4, 0.45, n=8, slot='plain', col='#cfd3d6', r_top=0.45, top=True)


def _frustum_sq(b, x, y, z0, z1, w0, w1, slot, col, tile=False):
    c = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i in range(4):
        a, bq = c[i], c[(i + 1) % 4]
        pts = [(x + a[0] * w0 / 2, y + a[1] * w0 / 2, z0), (x + bq[0] * w0 / 2, y + bq[1] * w0 / 2, z0),
               (x + bq[0] * w1 / 2, y + bq[1] * w1 / 2, z1), (x + a[0] * w1 / 2, y + a[1] * w1 / 2, z1)]
        b.face(pts, slot, col, mode='tile' if tile else None)


# ---------------------------------------------------------------------------------------------------------------- helpers
def front_entrance(b, lk, x0, x1, y_front, z_top, depth, rng, kind='flat', col=None, columns=True):
    """Canopy over the main entrance, standing in front of y_front, with blank sign fascia."""
    d = depth
    cpad = col or lk.roof_col
    if kind == 'curved':
        cols = [(x0 + 1.0 + (x1 - x0 - 2) * k / 4, y_front - d + 1.0) for k in range(5)] if columns else None
        lib.canopy_curved(b, x0, y_front - d, x1, y_front, z_top, 2.2, lk, th=0.35, axis='x', columns=cols, col=cpad)
    else:
        n = max(2, int((x1 - x0) / 7)) if columns else 0
        lib.canopy_flat(b, x0, y_front - d, x1, y_front, z_top, lk, th=0.55, columns=n if n else None, col=cpad, edge_col=lib.shade(lk.trim_col, 0.95), r=0.26)


def roof_plant(b, lk, rect, z, rng, count=5):
    if b.detail >= 1:
        return
    x0, y0, x1, y1 = rect
    for _ in range(count):
        w, d, h = rng.uniform(2.5, 6), rng.uniform(2, 4), rng.uniform(1.2, 2.4)
        cx = rng.uniform(x0 + w, x1 - w)
        cy = rng.uniform(y0 + d, y1 - d)
        lib.box_c(b, cx, cy, z, w, d, h, 'metal-cladding', lib.shade(lk.metal_col, rng.uniform(0.85, 1.05)), top_slot='roof-flat', skip=('bottom',))


def solar(b, lk, rect, z, rng, rows=3):
    if b.detail >= 1:
        return
    x0, y0, x1, y1 = rect
    for r in range(rows):
        y = y0 + (y1 - y0) * (r + 1) / (rows + 1)
        pts = [(x0 + 3, y - 1.1, z + 0.3), (x1 - 3, y - 1.1, z + 0.3), (x1 - 3, y + 1.1, z + 1.1), (x0 + 3, y + 1.1, z + 1.1)]
        lib.Builder.facing(b, pts, (0, -0.4, 1), 'glass-ribbon', '#8fa3b5', mode='tile')


def floodlight(b, x, y, h=24):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.25, n=6, slot='frame', col='#8d9298', r_top=0.14, top=True)
        lib.box_c(b, x, y, h, 3.2, 0.5, 1.4, 'plain', '#3d4146')


def flag(b, x, y, h, col):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.07, n=5, slot='frame', col='#b8bcc0', r_top=0.05, top=True)
        b.facing([(x + 0.05, y, h - 1.6), (x + 2.2, y, h - 1.5), (x + 2.2, y, h - 0.2), (x + 0.05, y, h)], (0, -1, 0), 'plain', col)
        b.facing([(x + 0.05, y, h - 1.6), (x + 2.2, y, h - 1.5), (x + 2.2, y, h - 0.2), (x + 0.05, y, h)][::-1], (0, 1, 0), 'plain', lib.shade(col, 0.85))


def vegetation(b, lk, rng, x0, x1, y_front, w_pad):
    if b.detail >= 2 or lk.tree in (None, 'none'):
        return
    n = 7 if b.detail == 0 else 3
    for k in range(n):
        tx = x0 + (x1 - x0) * (k + 0.5) / n + rng.uniform(-2, 2)
        lib.tree(b, lk.tree, tx, y_front - rng.uniform(2.0, 4.0), rng.uniform(7, 10), rng, lk)


# ------------------------------------------------------------------------------------------------------ roofs for 'wave' type
def wave_roof(b, lk, style, W, D, z_wall, rng, overhang_front, overhang_side, rise, thick):
    """Sweeping/undulating/vaulted roof shell over a W x D box whose walls end at z_wall. Returns underside min z at the wall lines."""
    nx = {0: 56, 1: 20, 2: 8}[b.detail]
    ny = {0: 14, 1: 7, 2: 4}[b.detail]
    xs = [-W / 2 - overhang_side + (W + 2 * overhang_side) * i / nx for i in range(nx + 1)]
    yf, yb = -D / 2 - overhang_front, D / 2 + 2.5
    phase = rng.uniform(0, 2 * math.pi)
    grid = []
    for x in xs:
        u = x / (W / 2 + overhang_side)       # -1..1
        row = []
        for j in range(ny + 1):
            t = j / ny
            y = yf + (yb - yf) * t
            if style == 'sweep':
                # asymmetric swoop: front edge lowest and flicked up at the lip, crown towards the back; arches along x and
                # droops at the ends; the front edge bows outward in plan so the roof reads as one curved sail
                crown = rise * (0.62 + 0.38 * math.cos(math.pi * u * 0.5) ** 1.5)
                core = t ** 1.55
                lip = rise * 0.2 * math.exp(-(t / 0.08) ** 2)
                z = z_wall + 0.9 + crown * core + lip
                y = y - overhang_front * 0.55 * (1 - u * u) * (1 - t) ** 1.5
                z -= rise * 0.28 * (abs(u) ** 2.5) * t
            elif style == 'undulate':
                z = z_wall + 1.2 + rise * 0.42 * (0.5 + 0.5 * math.sin(2 * math.pi * x / (W / 2.0) + phase)) + rise * 0.22 * (1 - ((t - 0.5) * 2) ** 2)
            else:  # vault: series of barrel vaults across the width
                k = max(1, int(W / 26))
                seg = (W + 2 * overhang_side) / k
                local = ((x + W / 2 + overhang_side) % seg) / seg
                z = z_wall + 1.0 + rise * 0.55 * math.sin(math.pi * local) ** 0.7 + rise * 0.45 * (1 - ((t - 0.5) * 2) ** 2) * 0.6
            row.append((x, y, z))
        grid.append(row)
    return grid


# ------------------------------------------------------------------------------------------------------------------- build
def build(brief, style, rng, detail):
    b = lib.Builder('airport', detail)
    srng = random.Random(rng.getrandbits(64))   # site stream: same colours/choices at every LOD
    lk = lib.look(brief, style, rng)
    form = brief.get('form', {})
    feats = _feat(brief)
    typ, roof_style, tower_kind = infer(brief, rng)
    W = _clamp(float(form.get('width_m', 90)), 34, W_MAX)
    D = _clamp(float(form.get('depth_m', 30)), 14, 50)
    H = _clamp(float(form.get('height_m', 16)), 4.5, 42)
    storeys = int(_clamp(form.get('storeys', 2), 1, 7))
    if typ == 'wave' and 'control-tower' in feats:
        W = min(W, 96.0)   # the detached tower stands beside the terminal: keep the whole scene inside the 120 m clamp
    fc_kind = (brief.get('setting') or {}).get('forecourt') or 'parking'
    if fc_kind == 'none':
        fc_kind = 'parking'
    info = {'x0': -W / 2, 'x1': W / 2, 'front': -D / 2, 'back': D / 2}
    stands = []     # (x, y_wall, z_floor, direction) where a jet bridge can start
    pad_front = 26.0 if typ != 'regional' else 18.0
    apron_back = 36.0 if typ != 'regional' else 22.0

    b.section('walls')
    if typ == 'wave':
        # glass box walls, roof shell above
        z_wall = _clamp(H * 0.62, 5.0, 15.0)
        rise = H - z_wall
        fp = lib.fp_rect(W, D)
        lib.walls(b, fp, 0, z_wall, max(1, storeys - 1) if storeys > 1 else 1, lk, rng, kind='curtain', front_kind='curtain', rear='same', plinth=0.0,
                  wall_slot='plain-render', wall_col=lk.trim_col, bay=3.0 if roof_style != 'undulate' else 3.6)
        ov_f = _clamp(D * 0.28, 6, 12) if roof_style == 'sweep' else 3.0
        ov_s = 2.5 if roof_style != 'sweep' else 4.0
        thick = 0.9 if roof_style == 'sweep' else 1.3
        b.section('roof')
        grid = wave_roof(b, lk, roof_style, W, D, z_wall, rng, ov_f, ov_s, rise, thick)
        slot = 'metal-roof'
        lib.roof_shell(b, grid, thick, lk, slot=slot, col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.55), edge_col=lib.shade(lk.roof_col, 0.82))
        # solid infill from the glass top (z_wall) up to the roof underside on the two ends and the back (clerestory, glazed)
        _infill(b, lk, grid, thick, z_wall, W, D)
        # exposed steel structure at the front (V/Y columns) - the signature of steel-and-glass terminals
        b.section('structure')
        n_cols = max(4, int(W / 12))
        yline = -D / 2 - (ov_f * 0.62)
        for k in range(n_cols + 1):
            x = -W / 2 + W * k / n_cols
            zt = _underside_z(grid, x, yline, thick)
            if detail <= 1:
                _y_column(b, lk, x, yline, zt, detail)
        info['front'] = -D / 2 - ov_f
        roof_rect = (-W / 2, -D / 2, W / 2, D / 2)
        floor_z = 4.8
        for k in range(int(W // 22)):
            stands.append((-W / 2 + 11 + 22 * k + (W % 22) / 2, D / 2, floor_z, (0.0, 1.0)))
    elif typ == 'linear':
        S = max(2, storeys)
        z_wall = H
        main_w = W * (0.72 if int(form.get('wings', 0) or 0) > 0 else 1.0)
        main_x = -(W - main_w) / 2
        fp = lib.fp_rect(main_w, D, main_x, 0)
        old_style = lk.wall_slot in ('rough-concrete',) or 'brutal' in _text(brief) or 'modernist' in _text(brief)
        front_kind = 'ribbon' if old_style else lk.windows if lk.windows != 'none' else 'punched'
        lib.walls(b, fp, 0, z_wall, S, lk, rng, kind='ribbon' if old_style else lk.windows, front_kind=front_kind, ratio=max(lk.ratio, 0.45), rear='flat',
                  plinth=0.5, wall_slot=lk.wall_slot, wall_col=lk.wall_col, bay=4.0, ground_h=None)
        if detail == 0 and old_style:
            # deep projecting floor slabs on the front (the strong horizontal lines of 1970s terminals)
            for seg in fp.edges():
                if seg.front:
                    for s in range(1, S + 1):
                        lib.seg_box(b, seg, 0, seg.length, H * s / S - 0.45, H * s / S + 0.25, 0.9, lk.accent_col if lk.accent_col else lk.trim_col, lk.wall_slot)
        lib.roof(b, 'flat', fp, z_wall, lk, parapet_h=1.1, ov=0.0, slab=0.0)
        lib.cornice(b, fp, z_wall - 0.35, 0.5, 0.35, lk)
        roof_rect = (main_x - main_w / 2, -D / 2, main_x + main_w / 2, D / 2)
        # central entrance block
        eb_w = main_w * 0.34
        eb_d = _clamp(D * 0.28, 5, 9)
        efp = lib.fp_rect(eb_w, eb_d, main_x, -D / 2 - eb_d / 2)
        eh = H * 0.78
        lib.walls(b, efp, 0, eh, max(1, S - 1), lk, rng, kind='curtain', front_kind='curtain', rear='same', plinth=0.0, wall_slot=lk.wall_slot, wall_col=lk.wall_col, bay=3.2,
                  edges=[s for s in efp.edges() if not s.rear])
        lib.roof(b, 'flat', efp, eh, lk, parapet_h=0.0, ov=0.6, slab=0.5)
        info['front'] = -D / 2 - eb_d
        # secondary glass terminal wing (the newer building), as an extension on one side
        wings = int(form.get('wings', 0) or 0)
        for wi in range(min(wings, 1)):
            ww = W - main_w
            wx = main_w / 2 + ww / 2 + main_x
            wd = D * 0.95
            wfp = lib.fp_rect(ww, wd, wx, -D * 0.025)
            wh = H * 0.86
            lib.walls(b, wfp, 0, wh, max(2, S - 1), lk, rng, kind='curtain', rear='same', plinth=0.0, wall_slot='plain-render', wall_col=lk.trim_col, bay=3.0)
            wgrid = _wing_roof(wfp, wh, ww, wd, detail)
            lib.roof_shell(b, wgrid, 0.7, lk, slot='metal-roof', col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.6))
            _infill(b, lk, wgrid, 0.7, wh, ww, wd, cx=wx, cy=-D * 0.025)
            for k in range(int(ww // 22) + 1):
                stands.append((wx - ww / 2 + 8 + 22 * k, -D * 0.025 + wd / 2, 4.6, (0.0, 1.0)))
        for k in range(int(main_w // 24)):
            stands.append((main_x - main_w / 2 + 12 + 24 * k, D / 2, H / S + 0.2 if S > 1 else 4.5, (0.0, 1.0)))
        b.section('tower')
        ct_x = main_x + main_w * 0.3   # the tower rises from the terminal (attached), the Lagos signature
        control_tower(b, ct_x, D * 0.05, tower_kind if tower_kind != 'faceted' else 'round', _clamp(H * 3.4, 42, 66), lk, rng)
    elif typ == 'pier':
        hh_w = _clamp(W * 0.6, 40, 80)
        hh_d = _clamp(D, 18, 30)
        hh_h = _clamp(H, 9, 20)
        S = max(2, storeys)
        hfp = lib.fp_rect(hh_w, hh_d)
        lib.walls(b, hfp, 0, hh_h, S, lk, rng, kind='curtain', front_kind='curtain', rear='same', plinth=0.0, wall_slot='plain-render', wall_col=lk.trim_col, bay=3.2)
        lib.roof(b, 'flat', hfp, hh_h, lk, parapet_h=0.0, ov=2.0, slab=0.6)
        pier_w = 20.0
        pier_l = _clamp(W * 0.55, 34, 58)
        pz = 8.6
        pfp = lib.fp_rect(pier_w, pier_l, 0, hh_d / 2 + pier_l / 2 - 1.0)
        lib.walls(b, pfp, 0, pz, 2, lk, rng, kind='ribbon', ratio=0.55, rear='same', plinth=0.0, wall_slot='metal-cladding', wall_col=lk.wall_col, bay=4.0,
                  edges=[s for s in pfp.edges() if not s.front])
        rg = _pier_roof(pier_w, pier_l, pz, hh_d / 2 - 1.0, detail)
        lib.roof_shell(b, rg, 0.5, lk, slot='metal-roof', col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.6))
        roof_rect = (-hh_w / 2, -hh_d / 2, hh_w / 2, hh_d / 2)
        info['front'] = -hh_d / 2
        D_total = hh_d + pier_l
        for k in range(max(2, int(pier_l // 14))):
            y = hh_d / 2 + 7 + 14 * k
            stands.append((pier_w / 2, y, 5.0, (1.0, 0.0)))
            stands.append((-pier_w / 2, y, 5.0, (-1.0, 0.0)))
        info['back'] = hh_d / 2 + pier_l - 1.0
        if 'control-tower' in feats:
            control_tower(b, -hh_w / 2 - 14, hh_d / 2 + 6, tower_kind, _clamp(H * 3.6, 45, 70), lk, rng)
    else:  # regional
        S = max(1, min(2, storeys))
        Wr = _clamp(W, 30, 64)
        Dr = _clamp(D, 12, 22)
        Hr = _clamp(H, 4.5, 9)
        fp = lib.fp_rect(Wr, Dr)
        lib.walls(b, fp, 0, Hr, S, lk, rng, kind=lk.windows if lk.windows not in ('none', 'curtain') else 'punched', ratio=max(0.3, lk.ratio), rear='same',
                  plinth=0.3, wall_slot=lk.wall_slot, wall_col=lk.wall_col, bay=3.6)
        form_roof = form.get('roof', 'flat')
        if form_roof in ('gable', 'hip', 'shed', 'barrel', 'pyramidal'):
            lib.roof(b, form_roof, fp, Hr, lk, pitch=14, ov=1.2) if form_roof in ('gable', 'hip', 'pyramidal') else lib.roof(b, form_roof, fp, Hr, lk)
        else:
            lib.roof(b, 'flat', fp, Hr, lk, parapet_h=0.7, ov=1.0, slab=0.4)
        roof_rect = (-Wr / 2, -Dr / 2, Wr / 2, Dr / 2)
        info['front'] = -Dr / 2
        D = Dr
        W = Wr
        # small control room block on the roof / a squat tower at one end
        if 'control-tower' in feats or rng.random() < 0.6:
            tx = Wr / 2 - 5
            tfp = lib.fp_rect(6, 6, tx, 0)
            th = Hr + 7.5
            lib.walls(b, tfp, 0, th - 2.4, 2, lk, rng, kind='punched', rear='same', plinth=0.0, wall_slot=lk.wall_slot, wall_col=lk.wall_col, bay=3.0)
            lib.walls(b, lib.fp_rect(8.2, 8.2, tx, 0), th - 2.4, th, 1, lk, rng, kind='ribbon', ratio=0.8, rear='same', plinth=0.0, wall_slot=lk.wall_slot, wall_col=lk.trim_col, bay=8)
            lib.roof(b, 'flat', lib.fp_rect(8.2, 8.2, tx, 0), th, lk, parapet_h=0.0, ov=0.5, slab=0.4)
            lib.cylinder(b, tx, 0, th, th + 4, 0.1, n=5, slot='frame', col='#6a6f74', r_top=0.04)
        stands.append((-Wr / 2 + 14, Dr / 2, 0.0, (0.0, 1.0)))
        stands.append((Wr / 2 - 22, Dr / 2, 0.0, (0.0, 1.0)))

    # ---------------------------------------------------------------- common: entrance canopy, tower, bridges, site
    b.section('canopy')
    if typ in ('wave',):
        # drop-off canopy along the front, in front of the glass line
        if 'flat-canopy' in feats or roof_style == 'vault' or 'curved-canopy' not in feats and typ == 'wave' and roof_style == 'vault':
            front_entrance(b, lk, -min(W * 0.3, 26), min(W * 0.3, 26), -D / 2, 5.2, 7.5, rng, 'flat' if 'flat-canopy' in feats else 'curved')
        if 'control-tower' in feats:
            b.section('tower')
            control_tower(b, -W / 2 - 10 - (6 if tower_kind == 'faceted' else 0), D / 2 + 12, tower_kind, _clamp(H * 3.6, 40, 62), lk, rng)
            info['tower'] = True
    elif typ == 'linear':
        cw = main_w * 0.46
        front_entrance(b, lk, main_x - cw / 2, main_x + cw / 2, info['front'], 4.9, 8.0, rng, 'curved' if 'curved-canopy' in feats else 'flat')
    elif typ == 'pier':
        front_entrance(b, lk, -min(hh_w * 0.3, 24), min(hh_w * 0.3, 24), -hh_d / 2, 5.0, 8.0, rng, 'curved' if 'curved-canopy' in feats else 'flat')
    else:
        front_entrance(b, lk, -min(W * 0.22, 10), min(W * 0.22, 10), -D / 2, 3.8, 5.5, rng, 'flat', columns=True)

    # jet bridges + aircraft
    b.section('bridges+aircraft')
    want_bridges = 'jet-bridge' in feats or typ in ('wave', 'linear', 'pier')
    ac_cols = ['#f0f2f4', '#e9edf0', '#f4f1ea']
    tail_cols = ['#2f5d8a', '#b6323a', '#2c7a5b', '#d2a032', '#5b4a8a']
    nb = 0
    if typ != 'regional' and want_bridges:
        maxb = 3 if detail == 0 else 2
        sel = stands[:maxb] if len(stands) <= maxb else [stands[int(i * (len(stands) - 1) / (maxb - 1))] for i in range(maxb)]
        for (sx, sy, sz, d) in sel:
            blen = 15.0
            jet_bridge(b, sx, sy, sz, blen, '#c9ced2', wall_dir=d)
            ac_x = sx + d[0] * (blen + 2.0)
            ac_y = sy + d[1] * (blen + 2.0)
            # aircraft nose faces the terminal: it sits beyond the bridge end, rotated so the nose points back at the wall
            if d == (0.0, 1.0):
                ax, ay = sx + 1.8, sy + blen + 17.0
                yaw = math.pi
            else:
                ax, ay = sx + d[0] * (blen + 17.0), sy - 1.8
                yaw = math.pi / 2 if d[0] < 0 else -math.pi / 2
            airliner(b, ax, ay, yaw, 1.0, srng.choice(ac_cols), srng.choice(tail_cols), srng)
            nb += 1
    elif typ == 'regional':
        for (sx, sy, sz, d) in stands[:1]:
            airliner(b, sx + 4, sy + 24, math.pi, 0.62, '#eef0f2', srng.choice(tail_cols), srng)
    # ground, forecourt
    b.section('ground')
    pad_w = min(W + 12, 120)
    depth_back = info['back'] if typ == 'pier' else D / 2
    y_front = info['front'] - pad_front
    y_back = depth_back + (apron_back if typ != 'pier' else 12)
    if typ != 'pier' and (y_back - y_front) > 118:
        y_back = y_front + 118
    lib.ground(b, -pad_w / 2, y_front, pad_w / 2, y_back, lk, z=0.0)
    # apron (airside concrete) behind the building
    lib.ground(b, -pad_w / 2, depth_back, pad_w / 2, y_back, lk, 'paving', '#b4b5b2', z=0.03, scale=4.0)
    if detail == 0 and typ != 'pier':
        for k in range(3):
            lx = -pad_w * 0.3 + k * pad_w * 0.3
            with b.site():
                b.face([(lx - 0.1, depth_back + 12, 0.07), (lx + 0.1, depth_back + 12, 0.07), (lx + 0.1, y_back - 1, 0.07), (lx - 0.1, y_back - 1, 0.07)], 'plain', '#e1c24a')
    fc = lib.forecourt
    b.section('forecourt')
    # landside: road next to the kerb, then the car park / garden
    road_y1 = info['front'] - 2.0
    road_y0 = road_y1 - 10.0
    fc(b, 'road', -pad_w / 2 + 1, road_y0, pad_w / 2 - 1, road_y1, lk, srng)
    if y_front + 1 < road_y0 - 1:
        kind = fc_kind if fc_kind in ('parking', 'garden', 'plaza') else 'parking'
        if 'car-park' in feats:
            kind = 'parking'
        fc(b, kind, -pad_w / 2 + 3, y_front + 1, pad_w / 2 - 3, road_y0 - 1, lk, srng, density=1.0)
    b.section('trees')
    vegetation(b, lk, srng, -pad_w / 2 + 6, pad_w / 2 - 6, info['front'] - 1.5, pad_w)
    b.section('furniture')
    if 'floodlights' in feats or typ in ('wave', 'linear', 'pier') and detail == 0:
        floodlight(b, -pad_w / 2 + 6, depth_back + 20)
        floodlight(b, pad_w / 2 - 6, depth_back + 20)
    if 'flags' in feats:
        for k in range(3):
            flag(b, -8 + 8 * k, info['front'] - 12.5, 12, ['#0b7a43', '#f2f2f2', '#0b7a43', '#b6323a'][k % 4])
    if 'signage-board' in feats:
        with b.site():
            lib.sign_board(b, W * 0.32, info['front'] - 13.0, 0.0, 9, 3.2, lk, 0.0, col='#2f5f8a')
    if typ in ('linear', 'pier') and detail == 0:
        roof_plant(b, lk, roof_rect, H if typ == 'linear' else hh_h, rng, count=5)
    if 'solar-panels' in feats and typ in ('linear', 'regional'):
        solar(b, lk, roof_rect, H if typ == 'linear' else Hr, rng)
    return b.objects()


# ---------------------------------------------------------------------------------------------------------------- shared shapes
def _underside_z(grid, x, y, thick):
    """Underside height of a roof grid at (x, y) (nearest sample)."""
    best = None
    for row in grid:
        if best is None or abs(row[0][0] - x) < abs(best[0][0] - x):
            best = row
    pick = min(best, key=lambda p: abs(p[1] - y))
    return pick[2] - thick


def _infill(b, lk, grid, thick, z_wall, W, D, cx=0.0, cy=0.0):
    """Close the gap between the glass top (z_wall) and the roof underside along the walls: back wall and the two ends."""
    R = len(grid)
    # back wall (y = cy + D/2): per section quads from z_wall to underside, using the nearest column to the wall line
    yb = cy + D / 2
    yf = cy - D / 2
    def at(row, y):
        return min(row, key=lambda p: abs(p[1] - y))
    for i in range(R - 1):
        a, c = at(grid[i], yb), at(grid[i + 1], yb)
        xa, xc = a[0], c[0]
        if xa < cx - W / 2 or xc > cx + W / 2:
            continue
        za, zc = max(z_wall, a[2] - thick), max(z_wall, c[2] - thick)
        b.facing([(xa, yb, z_wall), (xc, yb, z_wall), (xc, yb, zc), (xa, yb, za)], (0, 1, 0), lk.glass_slot, lk.glass_col, mode='fit') if b.detail < 2 else \
            b.facing([(xa, yb, z_wall), (xc, yb, z_wall), (xc, yb, zc), (xa, yb, za)], (0, 1, 0), 'plain', lk.glass_col)
        a, c = at(grid[i], yf), at(grid[i + 1], yf)
        za, zc = max(z_wall, a[2] - thick), max(z_wall, c[2] - thick)
        if xa >= cx - W / 2 and xc <= cx + W / 2:
            b.facing([(xa, yf, z_wall), (xc, yf, z_wall), (xc, yf, zc), (xa, yf, za)], (0, -1, 0), lk.glass_slot, lk.glass_col, mode='fit')
    # ends
    for idx, hint, xw in ((0, (-1, 0, 0), cx - W / 2), (R - 1, (1, 0, 0), cx + W / 2)):
        row = grid[min(range(R), key=lambda i: abs(grid[i][0][0] - xw))]
        pts = [(xw, p[1], max(z_wall, p[2] - thick)) for p in row if yf - 0.01 <= p[1] <= yb + 0.01]
        if len(pts) < 2:
            continue
        poly = [(xw, pts[0][1], z_wall)] + [(xw, pts[-1][1], z_wall)] + pts[::-1]
        b.facing(poly, hint, lk.glass_slot, lk.glass_col, mode='fit')


def _y_column(b, lk, x, y, z_top, detail):
    """A slim steel Y column: tapered shaft + two splayed arms up to the roof."""
    col = '#aeb4ba'
    lib.cylinder(b, x, y, 0, z_top * 0.55, 0.28, n=6, slot='frame', col=col, r_top=0.2, top=False)
    if detail == 0:
        for sgn in (-1, 1):
            a = (x, y, z_top * 0.55)
            e = (x + sgn * 2.2, y + 0.0, z_top)
            _strut(b, a, e, 0.14, col)
    else:
        lib.cylinder(b, x, y, z_top * 0.55, z_top, 0.2, n=5, slot='frame', col=col, top=False)


def _strut(b, a, c, r, col):
    dx, dy, dz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    L = math.sqrt(dx * dx + dy * dy + dz * dz)
    # a thin box along the segment, built as two crossed faces per side (cheap)
    nx, ny = -dy / (math.hypot(dx, dy) or 1) * r, dx / (math.hypot(dx, dy) or 1) * r
    if abs(dy) < 1e-6 and abs(dx) > 1e-6:
        nx, ny = 0.0, r
    p = [(a[0] - nx, a[1] - ny, a[2]), (a[0] + nx, a[1] + ny, a[2]), (c[0] + nx, c[1] + ny, c[2]), (c[0] - nx, c[1] - ny, c[2])]
    b.face(p, 'frame', col)
    b.face(p[::-1], 'frame', col)


def _wing_roof(fp, z, w, d, detail):
    """Gently sloped single-pitch roof shell with deep overhang over a glass wing."""
    x0, y0, x1, y1 = fp.bbox
    nx = {0: 8, 1: 4, 2: 3}[detail]
    ny = {0: 6, 1: 3, 2: 2}[detail]
    ov = 2.5
    grid = []
    for i in range(nx + 1):
        row = []
        for j in range(ny + 1):
            t = j / ny
            x = x0 - ov + (x1 - x0 + 2 * ov) * i / nx
            y = y0 - ov + (y1 - y0 + 2 * ov) * t
            row.append((x, y, z + 0.8 + 2.4 * t * t + 0.8 * (1 - ((x - (x0 + x1) / 2) / ((x1 - x0) / 2 + ov)) ** 2)))
        grid.append(row)
    return grid


def _pier_roof(w, l, z, y0, detail):
    """Barrel-ish roof over a pier (long along y): rows along x across the width."""
    nx = {0: 12, 1: 6, 2: 4}[detail]
    ny = {0: 6, 1: 3, 2: 2}[detail]
    grid = []
    for i in range(nx + 1):
        t = i / nx
        x = -w / 2 - 1.2 + (w + 2.4) * t
        row = []
        for j in range(ny + 1):
            y = y0 - 0.5 + (l + 1.0) * j / ny
            row.append((x, y, z + 0.4 + 3.2 * math.sin(math.pi * t) ** 0.8))
        grid.append(row)
    return grid
