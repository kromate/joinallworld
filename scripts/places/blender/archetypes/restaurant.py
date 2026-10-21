"""restaurant: bukas, roadside eateries, cafes, restaurants, bars, clubs, tea houses, mountain refuges, beach shelters, town-house cafes.
Typologies chosen from the brief (style, storeys, roof, footprint, features, wording of subject/notes, city climate):

  buka       open-fronted roadside eatery (Nigerian buka, suya spot, amala joint): closed kitchen block at the back with a serving hatch,
             a big covered terrace in front on posts under one corrugated mono-pitch roof, half walls, plastic tables and chairs, blank
             fascia board, parasols, bunting, drums and crates.
  fastfood   chain-style glazed box: curtain front with coloured brand band, parapet sign, pylon sign, drive-through canopy and lane,
             outdoor seating, bin enclosure, car park (flat or pitched roof variants).
  cafe       villa / colonial restaurant: hip roof with deep eaves, veranda colonnade with balustrade, terrace dining, steps, garden,
             optional upper balcony, L plan wing, neon-lit lounge bar variant.
  club       two-storey dark night club: black cladding with coloured neon strips, projecting canopy, queue posts and rope, sign tower,
             fence and gate, VIP terrace.
  diner      long low modernist / art-deco roadside cafe: ribbon glazing, deep flat canopy over a forecourt, blade sign, parked bikes.
  chalet     mountain hut or Nordic timber restaurant: stone ground floor and timber upper floor (or all timber), steep gable roof with
             wide eaves, balcony, chimney, firewood stack, terrace tables.
  pavilion   open thatched or tiled pavilion on a timber deck (beach bar, waterfront terrace) with a pier into the water.
  teahouse   East-Asian tea house: raised platform, timber frame, lattice walls, double-eaved tile roof, lanterns, small garden.
  townhouse  cafe or restaurant in an urban building of 2-7 storeys: Georgian, Victorian, baroque, neoclassical, gothic-revival, art-deco,
             Stalinist, Ottoman or Nordic fronts over a glazed ground floor with awning and pavement terrace; terraces of narrow gabled houses.
Layout: centred on x = 0, main frontage towards -Y, street / forecourt in front (site layer).
"""
import copy
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _market_open_util as U  # noqa: E402

import lib  # noqa: E402

FEATURES = {'signage-board', 'awning', 'terrace', 'umbrellas', 'kiosk', 'shopfront', 'pier', 'sheds', 'car-park', 'neon-strip', 'balcony-bands', 'roof-terrace', 'gate',
            'fence-wall', 'pavilion', 'chimney', 'painted-mural', 'flat-canopy', 'steps', 'arcade', 'arches', 'pinnacles', 'stained-glass', 'pediment', 'relief-pattern',
            'crenellation', 'atrium-glass', 'flags'}

CH = U.CHAIRS


def infer(brief, fm, fs, txt, style):
    st = str(brief.get('style') or '')
    core = ' '.join(str(brief.get(k, '')) for k in ('name', 'subject', 'venueId')).lower()
    S = fm['S']
    climate = str((style or {}).get('climate') or '')
    if U.has(core, 'refuge', 'refugi', 'chalet', 'mountain hut', 'ski-area', 'alpine', 'mountain restaurant', 'stone and timber'):
        return 'chalet'
    if st == 'east-asian' or U.has(core, 'tea house', 'teahouse', 'tea-house'):
        return 'teahouse'
    if 'pavilion' in fs or fm['roof'] == 'pyramidal' or U.has(core, 'thatched', 'beachside', 'beach bar', 'palm-thatched', 'open pavilion'):
        return 'pavilion'
    if U.has(core, 'nightclub', 'night club', ' club') or (S >= 2 and 'neon-strip' in fs and st in ('contemporary', 'modernist')):
        return 'club'
    if S >= 3 or st in ('georgian', 'victorian', 'baroque', 'neoclassical', 'gothic-revival', 'art-deco', 'soviet', 'ottoman') or \
            U.has(core, 'ground floor of', 'townhouse', 'terraced', 'apartment block', 'corner building'):
        if not (st in ('art-deco',) and S == 1):
            return 'townhouse'
    if st == 'nordic':
        return 'chalet'
    if st in ('modernist', 'international', 'high-tech') and fm['W'] >= 28 and S <= 2:
        return 'diner'
    if S >= 2 and st in ('vernacular', 'colonial') and climate in ('temperate', 'cold', 'highland') and fm['roof'] == 'gable':
        return 'chalet' if U.has(core, 'timber', 'stone', 'hut', 'mountain') else 'townhouse'
    if st in ('vernacular', 'sahelian', 'swahili', 'yoruba', 'hausa-arewa') and S == 1:
        return 'buka'
    if st == 'contemporary' and S <= 2 and not (fm['roof'] == 'hip' and ('terrace' in fs or U.has(core, 'bar', 'lounge', 'brasserie'))):
        return 'fastfood'
    if st in ('modernist', 'postmodern', 'international') and fm['roof'] in ('flat', 'shed') and S <= 2:
        return 'fastfood'
    if st == 'colonial' or fm['roof'] in ('hip', 'gable', 'pyramidal') or S >= 2:
        return 'cafe'
    return 'buka' if st == 'vernacular' else 'fastfood'


# ------------------------------------------------------------------------------------------------------------------ props
def tables(b, F, x0, y0, x1, y1, srng, n, tcol='#f2f2ee', chairs=4, pitch=2.5):
    """Grid of round tables with chairs inside the local rect, up to n sets."""
    if b.detail >= 2:
        return
    nx, ny = max(1, int((x1 - x0) / pitch)), max(1, int((y1 - y0) / pitch))
    cells = [(i, j) for i in range(nx) for j in range(ny)]
    srng.shuffle(cells)
    n = int(n * U.DENSITY[0])
    if b.detail == 1:
        n = max(1, n // 3)
    cc = srng.choice(CH)
    for (i, j) in cells[:n]:
        x = x0 + (i + 0.5) * (x1 - x0) / nx
        y = y0 + (j + 0.5) * (y1 - y0) / ny
        q = F.xy(x, y)
        U.dining_set(b, q[0], q[1], srng, tcol, [cc], chairs=chairs)


def bunting(b, F, x0, x1, y, z, srng, cols, drop=0.45):
    """A string of small triangular flags between two points (local frame)."""
    if b.detail >= 1:
        return
    n = max(4, int((x1 - x0) / 0.6))
    for k in range(n):
        t = (k + 0.5) / n
        x = x0 + (x1 - x0) * t
        zz = z - 0.35 * math.sin(math.pi * t)
        c = cols[k % len(cols)]
        pts = [F.p(x - 0.17, y, zz), F.p(x + 0.17, y, zz), F.p(x, y, zz - drop)]
        b.face(pts, 'plain', c)
        b.face(pts[::-1], 'plain', lib.shade(c, 0.85))


def barrel_drum(b, x, y, col='#2f4f6f', h=0.9, r=0.3):
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, 0, h, r, n=8 if b.detail == 0 else 5, slot='metal-cladding', col=col, top=True, smooth=True)


def crates(b, F, x, y, srng, n=3):
    if b.detail >= 1:
        return
    for k in range(n):
        F.box(b, x + k * 0.55, y, 0, x + k * 0.55 + 0.5, y + 0.4, 0.3 + 0.3 * (k % 2), 'timber', '#8a6a45', 'timber', '#a58559')


def slab(b, F, x0, y0, x1, y1, h=0.15, col='#b9b4aa', z=0.0):
    if b.detail < 2:
        F.box(b, x0, y0, z, x1, y1, z + h, 'paving', col, 'paving', lib.shade(col, 1.06), skip=('bottom',))


def parking_front(b, lk, srng, x0, x1, y0, y1, density=1.0):
    lib.forecourt(b, 'parking', x0, y0, x1, y1, lk, srng, density=density * U.DENSITY[0])


def post(b, F, x, y, z0, z1, col='#8a6a45', r=0.07):
    if b.detail >= 2:
        return
    F.cyl(b, x, y, z0, z1, r, n=4 if b.detail == 0 else 3, slot='timber', col=col, top=False, smooth=False)


def hip_or_gable(b, F, form, x0, y0, x1, y1, z, rise, ov, slot, col, ws, wc, ridge='auto', ov_front=None):
    if ridge == 'auto':
        ridge = 'x' if (x1 - x0) >= (y1 - y0) else 'y'
    F.roof(b, form, x0, y0, x1, y1, z, rise, ov, slot, col, ws, wc, ridge=ridge, ov_front=ov_front, th=0.1)


# ------------------------------------------------------------------------------------------------------------------ buka
def build_buka(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 10, 26)
    D = U.clamp(D, 7.5, 15)
    wc, ws = lk.wall_col, lk.wall_slot
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    kd = D * 0.42
    yk = y1 - kd
    roof_form = fm['roof'] if fm['roof'] in ('shed', 'gable', 'flat', 'hip') else 'shed'
    ze = 2.75                              # roof edge height at the front posts
    rise = U.clamp(D * 0.17, 1.0, 2.2)
    zr = lambda y: ze + rise * (y - y0) / D if roof_form == 'shed' else ze + rise * 0.0
    rc = lk.roof_col
    b.section('slab')
    slab(b, F, x0 - 0.6, y0 - 1.2, x1 + 0.6, y1, 0.14, '#bdb8ae')
    b.section('kitchen')
    kh = zr(yk) if roof_form == 'shed' else 3.4
    hb = zr(y1) if roof_form == 'shed' else 3.4
    # kitchen walls: front (with hatch + door), back (tall), ends
    fr = F.seg(x0, yk, x1, yk)
    if det >= 2:
        F.box(b, x0, yk, 0, x1, y1, max(kh, hb), ws, wc, skip=('bottom', 'top'))
    else:
        b.face([fr.P(0, 0), fr.P(W, 0), fr.P(W, kh), fr.P(0, kh)], ws, wc, scale=1.0)
        # hatch: dark opening with counter and a menu board (blank) beside the door
        hx0 = W * srng.uniform(0.12, 0.3)
        hw = W * 0.34
        b.face([fr.P(hx0, 1.0, -0.03), fr.P(hx0 + hw, 1.0, -0.03), fr.P(hx0 + hw, 2.15, -0.03), fr.P(hx0, 2.15, -0.03)], 'glass-punched', '#3a332e', mode='fit')
        if det == 0:
            lib.seg_box(b, fr, hx0 - 0.1, hx0 + hw + 0.1, 0.0, 1.0, 0.45, lib.shade(wc, 0.8), ws, inset=0.0)
            lib.seg_box(b, fr, hx0 - 0.15, hx0 + hw + 0.15, 1.0, 1.08, 0.55, '#c9c4b8', 'plain', inset=0.0)
            lib.seg_box(b, fr, hx0 - 0.1, hx0 + hw + 0.1, 2.15, 2.28, 0.1, lib.shade(wc, 0.7), 'plain', inset=0.0)
        dx0 = hx0 + hw + W * 0.07
        b.face([fr.P(dx0, 0, -0.04), fr.P(dx0 + 0.95, 0, -0.04), fr.P(dx0 + 0.95, 2.1, -0.04), fr.P(dx0, 2.1, -0.04)], 'metal-cladding', srng.choice(acc[:3]), mode='fit')
        mb = fr.P(dx0 + 1.5, 0)
        if dx0 + 1.5 + 1.2 < W - 0.2:
            b.face([fr.P(dx0 + 1.5, 1.2, -0.03), fr.P(dx0 + 2.7, 1.2, -0.03), fr.P(dx0 + 2.7, 2.2, -0.03), fr.P(dx0 + 1.5, 2.2, -0.03)], 'plain', srng.choice(['#2b3b2f', '#3a2c2c', '#2b3342']))
        # back + ends (ends are trapezoids following the roof line)
        F.face(b, [(x1, y1, 0), (x0, y1, 0), (x0, y1, hb), (x1, y1, hb)], (0, 1, 0), ws, wc, scale=2.0)
        for sx, hint in ((x0, (-1, 0, 0)), (x1, (1, 0, 0))):
            pts = [(sx, y1, 0), (sx, yk, 0), (sx, yk, kh), (sx, y1, hb)]
            b.facing([F.p(*q) for q in pts], F.h(hint), ws, wc, scale=2.0)
    # roof over everything
    b.section('roof')
    if roof_form == 'shed':
        F.roof(b, 'shed', x0, y0, x1, y1, ze, rise, 0.5, 'corrugated', rc, ws, wc, high='back', ov_front=0.9, infill=False)
    elif roof_form == 'gable':
        F.roof(b, 'gable', x0, y0, x1, y1, ze, D * 0.2, 0.5, 'corrugated', rc, ws, wc, ov_front=0.9, infill=False)
    elif roof_form == 'hip':
        F.roof(b, 'hip', x0, y0, x1, y1, ze, D * 0.2, 0.7, 'corrugated', rc, ws, wc, ov_front=0.9)
    else:
        F.roof(b, 'flat', x0 - 0.3, y0 - 0.3, x1 + 0.3, y1, ze, 0, 0.1, 'roof-flat', rc, ws, wc, parapet=0.0)
    # fascia board along the front roof edge (blank)
    b.section('sign')
    sc = srng.choice(acc[:3])
    zf = ze + (0.0 if roof_form != 'shed' else 0.0)
    if det < 2:
        F.box(b, x0 - 0.2, y0 - 0.95, ze - 0.05, x1 + 0.2, y0 - 0.7, ze + 0.85, 'plain', sc, 'plain', lib.shade(sc, 0.85), skip=('bottom',))
    # posts, half walls and furniture on the terrace
    b.section('terrace')
    npost = max(3, int(W / 3.6) + 1)
    for k in range(npost):
        px = x0 + 0.3 + (W - 0.6) * k / (npost - 1)
        post(b, F, px, y0 + 0.25, 0.14, ze - 0.05, '#7a5a3a', 0.08)
    if det < 2:
        hw_col = lib.shade(wc, 0.95)
        F.box(b, x0, y0, 0.14, x0 + 0.2, yk, 1.05, ws, hw_col, ws, lib.shade(hw_col, 1.1), skip=('bottom',))
        F.box(b, x1 - 0.2, y0, 0.14, x1, yk, 1.05, ws, hw_col, ws, lib.shade(hw_col, 1.1), skip=('bottom',))
        # a short front half-wall on one side
        side = srng.choice([-1, 1])
        if side > 0:
            F.box(b, x1 - W * 0.22, y0, 0.14, x1, y0 + 0.2, 1.05, ws, hw_col, ws, lib.shade(hw_col, 1.1), skip=('bottom',))
        else:
            F.box(b, x0, y0, 0.14, x0 + W * 0.22, y0 + 0.2, 1.05, ws, hw_col, ws, lib.shade(hw_col, 1.1), skip=('bottom',))
    nt = int(U.clamp(W * (yk - y0) / 7.0, 3, 14))
    tables(b, F, x0 + 1.0, y0 + 1.0, x1 - 1.0, yk - 0.9, srng, nt, '#f2f2ee', 4, 2.4)
    if det == 0:
        bunting(b, F, x0 + 0.3, x1 - 0.3, y0 - 0.1, ze - 0.2, srng, [srng.choice(U.UMB) for _ in range(4)])
        crates(b, F, x1 - 2.2, yk + 0.3, srng, 3)
        barrel_drum(b, x0 + 0.6, yk + 0.6, '#2f4f6f')
        barrel_drum(b, x0 + 1.3, yk + 0.55, '#8a3a2a')
    b.section('extras')
    if det < 2:
        if 'umbrellas' in fs or srng.random() < 0.5:
            for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 2), 1, 3))):
                q = F.xy(x0 + (k + 0.5) * W / 3, y0 - 2.8)
                U.chair_set(b, F, x0 + (k + 0.5) * W / 3, y0 - 3.2, srng, 2)
        if 'kiosk' in fs or srng.random() < 0.3:
            U.container_kiosk(b, F, x1 + 2.9, y0 + 2.0, 3.2, 2.2, srng.choice(acc[:4]))
        if 'sheds' in fs:
            F.box(b, x0 - 3.2, y1 - 3.0, 0, x0 - 0.4, y1, 2.3, 'timber', '#8a6a45', skip=('bottom', 'top'))
            F.roof(b, 'shed', x0 - 3.2, y1 - 3.0, x0 - 0.4, y1, 2.3, 0.3, 0.2, 'corrugated', rc, 'timber', '#8a6a45')
        if 'signage-board' in fs:
            U.sign_pole(b, F, x0 - 1.4, y0 - 2.0, 5.2, 1.6, srng.choice(acc[:4]))
        if srng.random() < 0.7:
            U.poly_tank(b, *F.xy(x1 - 1.2, y1 - 1.2), (zr(y1) if roof_form == 'shed' else ze) + 0.0)
    return {'front': y0 - 2.0, 'back': y1, 'wide': W + 12}


# ------------------------------------------------------------------------------------------------------------------ fastfood
def build_fastfood(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 11, 34)
    D = U.clamp(D, 8, 22)
    S = int(U.clamp(fm['S'], 1, 2))
    roof_form = fm['roof'] if fm['roof'] in ('flat', 'hip', 'gable', 'shed') else 'flat'
    wc, ws = lk.wall_col, lk.wall_slot
    band = srng.choice(acc[:3])
    gh = 3.6
    H = gh if S == 1 else gh + 3.0
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    b.section('walls')
    front = F.seg(x0, y0, x1, y0)
    pitched = roof_form in ('hip', 'gable')
    # front: mostly glass with a solid end bay; upper floor ribbon
    gl_w = W * (0.7 if not pitched else 0.58)
    gx0 = (x0 + 0.8) if srng.random() < 0.5 else (x1 - 0.8 - gl_w)
    F.walls(b, x0, y0, x1, y1, 0, H, S, lk, srng, front='none', right='ribbon' if S > 1 else 'punched', back='none', left='ribbon' if S > 1 else 'punched', ratio=0.3, bay=3.6, wall_slot=ws, wall_col=wc, skip=('front',), rear_reduced=True)
    if det >= 2:
        F.box(b, x0, y0, 0, x1, y0 + 0.05, H, ws, wc, skip=('bottom', 'top', 'back'))
    else:
        u0, u1 = gx0 - x0, gx0 + gl_w - x0
        for (ua, ub) in ((0, u0), (u1, W)):
            if ub - ua > 0.05:
                b.face([front.P(ua, 0), front.P(ub, 0), front.P(ub, H), front.P(ua, H)], ws, wc, mode='fit' if ub - ua < 5 else None)
        gz1 = gh - 0.2
        b.face([front.P(u0, 0, -0.04), front.P(u1, 0, -0.04), front.P(u1, gz1, -0.04), front.P(u0, gz1, -0.04)], 'glass-curtain', '#dfe9ef', mode='fit', scale=1.0)
        if det == 0:
            nm = max(2, int(gl_w / 2.4))
            for k in range(nm + 1):
                u = u0 + gl_w * k / nm
                lib.seg_box(b, front, u - 0.05, u + 0.05, 0, gz1, 0.1, lk.frame_col, 'frame', inset=0.0)
            lib.seg_box(b, front, u0, u1, 0, 0.45, 0.06, lib.shade(wc, 0.7), ws, inset=0.0)
            # door
            dc = (u0 + u1) / 2 + gl_w * 0.18
            lib.seg_box(b, front, dc - 0.05, dc + 0.05, 0, gz1, 0.14, '#2a2a2a', 'frame', inset=0.0)
        if S > 1:
            b.face([front.P(u0, gh, -0.04), front.P(u1, gh, -0.04), front.P(u1, H - 0.4, -0.04), front.P(u0, H - 0.4, -0.04)], 'glass-ribbon', '#dfe9ef', mode='fit')
    # brand colour band across the front, above the glazing
    b.section('band')
    if det < 2:
        F.box(b, x0 - 0.05, y0 - 0.3, gh - 0.1, x1 + 0.05, y0, gh + 0.9, 'plain', band, 'plain', lib.shade(band, 0.85), skip=('bottom',))
    b.section('roof')
    if roof_form == 'flat':
        F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.25, 'roof-flat', lk.roof_col, ws, wc, parapet=0.9 if S == 1 else 0.7, par_col=lib.shade(wc, 1.05))
        if det < 2:
            U.roof_extras(b, F, x0 + 1.5, y0 + 1.5, x1 - 1.5, y1 - 1.5, H, srng, lk, cores=0, tanks=0, plant=3, rebar=False)
            if det == 0:
                lib.cylinder(b, *F.xy(x1 - 2.2, y1 - 2.0), H, H + 2.2, 0.35, n=8, slot='metal-cladding', col='#8c9298', top=True)
            # roof sign: blank box on posts above the front parapet
            F.box(b, x0 + W * 0.2, y0 + 0.5, H + 0.9, x1 - W * 0.2, y0 + 0.8, H + 2.5, 'plain', band, skip=('bottom',))
    else:
        hip_or_gable(b, F, roof_form if roof_form != 'shed' else 'hip', x0, y0, x1, y1, H, D * 0.24, 0.8, lk.roof_slot, lk.roof_col, ws, wc, ridge='x' if W >= D else 'y', ov_front=1.1)
        if det < 2:
            F.box(b, x0 + W * 0.25, y0 - 0.6, 2.7, x1 - W * 0.25, y0 - 0.2, 3.3, 'plain', band, skip=('bottom',))
    if 'roof-terrace' in fs and roof_form == 'flat' and det < 2:
        U.roof_lounge(b, F, x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.3, H + 0.1, srng, lk, acc, tables_n=2, pergola_=False, bar=False)
    if 'flat-canopy' in fs and det < 2:
        U.flat_canopy_at(b, F, srng.uniform(-W * 0.2, W * 0.2), y0 - 0.1, min(W * 0.45, 10.0), 2.8, gh - 0.1, lk)
    # drive-through canopy on the side
    b.section('drive')
    side = srng.choice([-1, 1]) if W < 22 else 1
    if det < 2 and (W > 14):
        cx = x1 if side > 0 else x0
        Fd = U.Frame(cx, 0, 0)
        sgn = side
        F.box(b, cx + (0.0 if sgn > 0 else -2.6), y0 + 1.2, 2.55, cx + (2.6 if sgn > 0 else 0.0), y0 + D * 0.62, 2.85, 'plain', lk.trim_col, 'roof-flat', lk.roof_col, skip=('bottom',))
        if det == 0:
            for py in (y0 + 1.4, y0 + D * 0.6):
                F.cyl(b, cx + sgn * 2.4, py, 0, 2.55, 0.1, n=4, slot='frame', col='#8d9298', top=False, smooth=False)
            b.facing([F.p(cx + sgn * 0.03, y0 + D * 0.22, 1.0), F.p(cx + sgn * 0.03, y0 + D * 0.22 + 1.1, 1.0), F.p(cx + sgn * 0.03, y0 + D * 0.22 + 1.1, 1.9), F.p(cx + sgn * 0.03, y0 + D * 0.22, 1.9)], F.h((sgn, 0, 0)), 'glass-punched', '#3a4852', mode='fit')
            # menu boards (blank) on posts at the start of the lane
            for k in range(2):
                F.box(b, cx + sgn * 3.0 - 0.1, y0 - 3.0 + 0.0 + k * 1.8, 0, cx + sgn * 3.0 + 0.1, y0 - 2.8 + k * 1.8, 2.0, 'plain', '#2a2d33', skip=('bottom',))
        # drive-through lane (asphalt strip) round the front corner
        ln_x0, ln_x1 = (cx + 3.4, cx + 6.2) if sgn > 0 else (cx - 6.2, cx - 3.4)
        F.ground_quad(b, ln_x0, y0 - 9.0, ln_x1, y1 + 2.0, 0.06, 'asphalt', '#4c4e52', 1.0)
        F.ground_quad(b, ln_x0 - 0.25, y0 - 9.0, ln_x0, y1 + 2.0, 0.09, 'plain', '#e6e0cf', 1.0) if det == 0 else None
    b.section('extras')
    if det < 2:
        # pylon sign
        U.sign_pole(b, F, (x0 - 3.2) if side > 0 else (x1 + 3.2), y0 - 4.5, 7.5, 2.4, band)
        # outdoor seating with umbrellas
        sx0 = gx0 if side > 0 else gx0
        for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 2), 1, 3))):
            U.chair_set(b, F, gx0 + gl_w * (k + 0.5) / 3, y0 - 2.6, srng, 2)
        # bin enclosure behind
        if det == 0:
            for (xa, ya, xb, yb) in ((x0 + 1.0, y1 + 0.3, x0 + 3.2, y1 + 0.5), (x0 + 1.0, y1 + 0.3, x0 + 1.2, y1 + 2.0), (x0 + 3.0, y1 + 0.3, x0 + 3.2, y1 + 2.0)):
                F.box(b, xa, ya, 0, xb, yb, 1.7, ws, lib.shade(wc, 0.85), 'plain', '#7d8286', skip=('bottom',))
            F.box(b, x0 + 1.4, y1 + 0.6, 0, x0 + 2.8, y1 + 1.5, 1.1, 'metal-cladding', '#2f6f4a', 'plain', '#2a5a3c', skip=('bottom',))
        if 'awning' in fs and not pitched:
            U.awning_seg(b, front, 0.3, W - 0.3, gh - 0.1, 1.3, 0.45, [band, '#f1ece0'], proud=0.32)
    return {'front': y0 - 2.0, 'back': y1 + 2.5, 'wide': W + 14, 'park': True}


# ------------------------------------------------------------------------------------------------------------------ cafe
def build_cafe(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 11, 34)
    D = U.clamp(D, 8, 22)
    S = int(U.clamp(fm['S'], 1, 3))
    wc, ws = lk.wall_col, lk.wall_slot
    F = U.Frame(0, 0, 0)
    vd = 2.6
    fh = 3.3
    H = fm['H'] if fm['H'] > 3.5 else fh * S + 0.4
    H = U.clamp(H, 3.4, 11)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2 + vd, D / 2     # main block starts behind the veranda
    roof_form = fm['roof'] if fm['roof'] in ('hip', 'gable', 'flat', 'shed') else 'hip'
    b.section('walls')
    wk = lk.windows if lk.windows in ('punched', 'arched', 'louvre', 'ribbon') else 'punched'
    F.walls(b, x0, y0, x1, y1, 0, H, S, lk, srng, front='arched' if wk in ('arched', 'punched') and srng.random() < 0.4 else wk, right=wk, back='none', left=wk, ratio=max(0.28, lk.ratio), bay=3.4, wall_slot=ws, wall_col=wc,
            rear_reduced=True)
    # L wing at the back for L footprints
    wing = fm['fp'] in ('L', 'irregular', 'U')
    if wing:
        wx0, wx1 = x1 - W * 0.32, x1
        wy0, wy1 = y1, y1 + D * 0.45
        F.walls(b, wx0, wy0, wx1, wy1, 0, H, S, lk, srng, front='none', right=wk, back='none', left=wk, ratio=0.25, bay=3.4, wall_slot=ws, wall_col=wc, skip=('front',), rear_reduced=True)
    b.section('roof')
    rise = min(D, W) * (0.2 if roof_form == 'hip' else 0.22)
    if roof_form in ('hip', 'gable'):
        hip_or_gable(b, F, roof_form, x0, y0, x1, y1, H, rise, 1.3, lk.roof_slot, lk.roof_col, ws, wc, ridge='x' if W >= (y1 - y0) else 'y', ov_front=1.4)
        if wing:
            hip_or_gable(b, F, roof_form, x1 - W * 0.32 - 0.0, y1 - 1.0, x1, y1 + D * 0.45, H, rise * 0.8, 1.0, lk.roof_slot, lk.roof_col, ws, wc, ridge='y', ov_front=1.0)
        if det == 0 and ('chimney' in fs or srng.random() < 0.4):
            F.box(b, x0 + W * 0.3, (y0 + y1) / 2 - 0.4, H + rise * 0.6, x0 + W * 0.3 + 0.8, (y0 + y1) / 2 + 0.4, H + rise + 1.4, 'brick', '#9b5a43', 'plain', '#4a4540')
    elif roof_form == 'shed':
        F.roof(b, 'shed', x0, y0, x1, y1, H, rise * 0.7, 0.9, lk.roof_slot, lk.roof_col, ws, wc, high='back', ov_front=1.2)
    else:
        F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.3, 'roof-flat', lk.roof_col, ws, wc, parapet=0.7, par_col=lib.shade(wc, 1.05))
    # front door and shutters via the facade; veranda colonnade
    b.section('veranda')
    vz = 3.0 if S == 1 else fh
    F.box(b, x0 - 0.3, y0 - vd, 0, x1 + 0.3, y0, 0.35, 'paving', '#bdb8ae', 'paving', '#c9c4b8', skip=('bottom',)) if det < 2 else None
    npost = int(W / 3.0) + 1
    if det < 2:
        for k in range(npost):
            px = x0 + (W) * k / (npost - 1)
            F.box(b, px - 0.12, y0 - vd + 0.2, 0.35, px + 0.12, y0 - vd + 0.44, vz + 0.0, 'plain-render', lib.shade(wc, 1.08), skip=('bottom', 'top'))
        # veranda roof: lean-to for 1 storey, balcony slab + railing for upper floors
        F.roof(b, 'shed', x0 - 0.3, y0 - vd - 0.3, x1 + 0.3, y0, vz, 0.5, 0.2, lk.roof_slot if S == 1 else 'roof-flat', lk.roof_col, ws, wc, high='back', ov_front=0.4, infill=False) if S == 1 else None
        if S > 1:
            F.box(b, x0 - 0.3, y0 - vd - 0.2, vz, x1 + 0.3, y0, vz + 0.25, ws, lib.shade(wc, 1.0), 'roof-flat', lk.roof_col, skip=('bottom',))
            if det == 0:
                U.railing_ring(b, F, x0 - 0.2, y0 - vd - 0.1, x1 + 0.2, y0 - 0.1, vz + 0.25, 1.0, col=lib.shade(wc, 0.8))
        # balustrade between the posts on the ground floor
        if det == 0:
            for k in range(npost - 1):
                px0 = x0 + (W) * k / (npost - 1) + 0.12
                px1 = x0 + (W) * (k + 1) / (npost - 1) - 0.12
                if k == (npost - 1) // 2:
                    continue
                F.box(b, px0, y0 - vd + 0.25, 0.35, px1, y0 - vd + 0.35, 0.95, 'plain-render', lib.shade(wc, 1.05), 'plain-render', lib.shade(wc, 1.15), skip=('bottom',))
        # steps at the centre
        F.box(b, -1.4, y0 - vd - 0.5, 0, 1.4, y0 - vd + 0.1, 0.17, 'paving', '#b7b2a8', 'paving', '#c4bfb3')
        F.box(b, -1.4, y0 - vd - 0.2, 0, 1.4, y0 - vd + 0.1, 0.35, 'paving', '#b7b2a8', 'paving', '#c4bfb3')
    b.section('dining')
    tables(b, F, x0 + 1.0, y0 - vd + 0.9, x1 - 1.0, y0 - 0.4, srng, int(U.clamp(W / 2.6, 2, 8)), '#f2f2ee', 4, 2.3)
    if 'umbrellas' in fs and det < 2:
        for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 2), 1, 4))):
            U.chair_set(b, F, x0 + W * (k + 0.5) / 4 + (W / 8), y0 - vd - 3.2, srng, 2)
    if 'roof-terrace' in fs and roof_form == 'flat' and det < 2:
        U.roof_lounge(b, F, x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.3, H + 0.1, srng, lk, acc, tables_n=2, pergola_=False, bar=False)
    if 'neon-strip' in fs and det < 2:
        U.neon(b, F.xy(x0 + 0.5, y0 - vd + 0.3), F.xy(x1 - 0.5, y0 - vd + 0.3), vz - 0.35, srng.choice(['#ff5fd0', '#7fe0ff', '#ffb040']))
    if 'signage-board' in fs and det < 2:
        F.box(b, -W * 0.18, y0 - vd - 0.05, vz + 0.2, W * 0.18, y0 - vd + 0.1, vz + 1.2, 'plain', srng.choice(acc[:3]), skip=('bottom',)) if S == 1 else \
            U.sign_pole(b, F, x0 - 1.5, y0 - vd - 2.0, 5.0, 1.5, srng.choice(acc[:4]))
    if det < 2:
        # garden: hedges and planters
        for k in range(3 if det == 0 else 1):
            q = F.xy(x0 - 1.4 if k == 0 else x1 + 1.4, y0 - vd + 1.5 + k * 3.0)
            lib.blob(b, q[0], q[1], 0.6, 0.9, 0.9, 0.6, '#4f7d3b', n=6, rings=3)
        if 'kiosk' in fs:
            U.container_kiosk(b, F, x1 + 3.2, y0 + 1.0, 3.2, 2.2, srng.choice(acc[:4]))
        if 'fence-wall' in fs:
            pts = [(x0 - 4, y0 - vd - 3), (x0 - 4, y1 + 2), (x1 + 4, y1 + 2), (x1 + 4, y0 - vd - 3)]
            U.fence_wall(b, pts, 1.4, 0.3, lk, lib.shade(wc, 0.95), ws)
    return {'front': y0 - vd - 3.0, 'back': y1 + (D * 0.45 if wing else 0.0), 'wide': W + 14}


# ------------------------------------------------------------------------------------------------------------------ club
def build_club(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 16, 44)
    D = U.clamp(D, 12, 28)
    S = int(U.clamp(fm['S'], 2, 3))
    H = U.clamp(fm['H'] if fm['H'] > 6 else 4.4 + 3.4 * (S - 1), 7, 13)
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    dark = '#26262e' if lk.wall_col in ('#e8e1cf', '#ffffff') else lib.shade(lk.wall_col, 0.55)
    neons = ['#ff4fd8', '#46e0ff', '#ffb43a', '#8f6bff']
    srng.shuffle(neons)
    wk = 'screen' if lk.windows in ('screen', 'louvre', 'none') else lk.windows
    b.section('walls')
    F.walls(b, x0, y0, x1, y1, 0, H, S, lk, srng, front='screen', right='ribbon', back='none', left='ribbon', ratio=0.3, bay=3.4, wall_slot='metal-cladding', wall_col=dark, rear_reduced=True)
    b.section('roof')
    F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.2, 'roof-flat', lib.shade(lk.roof_col, 0.7), 'metal-cladding', dark, parapet=1.0, par_col=lib.shade(dark, 1.2))
    if det < 2:
        U.roof_extras(b, F, x0 + 2, y0 + 2, x1 - 2, y1 - 2, H, srng, lk, cores=0, tanks=0, plant=3, rebar=False)
    b.section('neon')
    if det < 2:
        for k, zz in enumerate((H * 0.38, H * 0.7, H - 0.6)):
            U.neon(b, F.xy(x0 + 0.3, y0 - 0.12), F.xy(x1 - 0.3, y0 - 0.12), zz, neons[k % len(neons)], th=0.1, w=0.1)
        for sx in (x0 + 0.15, x1 - 0.15):
            U.neon(b, F.xy(sx, y0 - 0.15), F.xy(sx, y0 - 0.15 + 0.01), 0.4, neons[3], th=H - 0.8, w=0.12)
    # entrance canopy with columns, queue posts and rope
    b.section('entrance')
    cw = U.clamp(W * 0.34, 8, 14)
    if det < 2:
        F.box(b, -cw / 2, y0 - 5.0, 3.5, cw / 2, y0, 3.9, 'plain', lib.shade(dark, 1.3), 'roof-flat', lib.shade(lk.roof_col, 0.6), skip=('bottom',))
        U.neon(b, F.xy(-cw / 2, y0 - 5.0), F.xy(cw / 2, y0 - 5.0), 3.55, neons[0], th=0.1, w=0.1)
        if det == 0:
            for sx in (-cw / 2 + 0.3, cw / 2 - 0.3):
                F.cyl(b, sx, y0 - 4.7, 0, 3.5, 0.18, n=6, slot='metal-cladding', col='#9aa0a6', top=False)
            # door
            b.facing([F.p(-1.2, y0 - 0.03, 0), F.p(1.2, y0 - 0.03, 0), F.p(1.2, y0 - 0.03, 2.6), F.p(-1.2, y0 - 0.03, 2.6)], (0, -1, 0), 'glass-punched', '#2a1f33', mode='fit')
            # red carpet + queue posts
            F.box(b, -1.1, y0 - 7.5, 0.0, 1.1, y0, 0.03, 'plain', '#8a1f2a')
            for k in range(5):
                for sx in (-1.5, 1.5):
                    q = F.xy(sx, y0 - 1.0 - k * 1.6)
                    lib.cylinder(b, q[0], q[1], 0, 0.95, 0.04, n=4, slot='frame', col='#c9a85a', top=True, smooth=False)
            for sx in (-1.5, 1.5):
                U.neon(b, F.xy(sx, y0 - 1.0), F.xy(sx, y0 - 1.0 - 6.4), 0.85, '#8a1f2a', th=0.04, w=0.04)
    b.section('sign')
    if det < 2:
        # sign tower with a blank panel
        tx = x1 + 2.5
        F.box(b, tx - 1.0, y0 + 0.5, 0, tx + 1.0, y0 + 2.4, H + 3.0, 'metal-cladding', lib.shade(dark, 1.15), 'plain', neons[1], skip=('bottom',))
        F.box(b, tx - 1.05, y0 + 0.4, H - 1.5, tx + 1.05, y0 + 0.5, H + 2.2, 'plain', neons[2], skip=('bottom',))
    # VIP terrace on the side with parasols, fence and gate along the front
    if det < 2:
        tx0 = x0 - 6.0
        slab(b, F, tx0, y0 + 1.0, x0, y0 + D * 0.55, 0.3, '#3a3a40')
        for k in range(2 if det == 0 else 1):
            U.chair_set(b, F, tx0 + 3.0, y0 + 3.0 + k * 3.8, srng, 2)
        if det < 2:
            pw = W + 12
            U.fence_wall(b, [(-pw / 2, y0 - 8.0), (-3.5, y0 - 8.0)], 1.6, 0.3, lk, lib.shade(dark, 1.4), 'metal-cladding') if det < 2 else None
            U.fence_wall(b, [(3.5, y0 - 8.0), (pw / 2, y0 - 8.0)], 1.6, 0.3, lk, lib.shade(dark, 1.4), 'metal-cladding') if det < 2 else None
            U.gate(b, U.Frame(0, y0 - 8.0, 0), 0.0, 7.0, 2.4, lk, col=lib.shade(dark, 1.5), board=neons[0])
    return {'front': y0 - 8.5, 'back': y1 + 2, 'wide': W + 14, 'park': True}


# ------------------------------------------------------------------------------------------------------------------ diner
def bike(b, x, y, yaw, col):
    if b.detail >= 1:
        return
    with b.site():
        lib.obox(b, x, y, 0.28, 1.8, 0.35, 0.3, yaw, 'plain', col, skip=('bottom',))
        lib.obox(b, x, y, 0.0, 1.7, 0.12, 0.3, yaw, 'plain', '#1e1e20', skip=('bottom',))
        c, s = math.cos(yaw), math.sin(yaw)
        lib.obox(b, x + c * 0.5, y + s * 0.5, 0.58, 0.5, 0.5, 0.25, yaw, 'plain', lib.shade(col, 0.8), skip=('bottom',))


def build_diner(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 24, 64)
    D = U.clamp(D, 10, 24)
    S = int(U.clamp(fm['S'], 1, 2))
    H = U.clamp(fm['H'] if fm['H'] > 3.5 else 4.5 * S + 1.0, 4.0, 9.0)
    wc, ws = lk.wall_col, lk.wall_slot
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    accent = lk.accent_col if lk.accent_col != lk.wall_col else acc[0]
    b.section('walls')
    F.walls(b, x0, y0, x1, y1, 0, H, S, lk, srng, front='ribbon', right='punched', back='none', left='punched', ratio=0.5, bay=4.0, wall_slot=ws, wall_col=wc, rear_reduced=True)
    if det == 0:
        # brick or contrast plinth band along the front
        lib.seg_box(b, F.seg(x0, y0, x1, y0), 0, W, 0.0, 0.9, 0.08, lib.shade(accent, 0.9), 'brick')
    b.section('roof')
    F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.3, 'roof-flat', lk.roof_col, ws, wc, parapet=0.5, par_col=lib.shade(wc, 1.0))
    # taller entrance block with a stepped/curved look: a box at the front centre
    ew = W * 0.2
    F.box(b, -ew / 2, y0 - 1.2, 0, ew / 2, y0 + 3.5, H + 1.6, ws, lib.shade(wc, 1.06), 'roof-flat', lk.roof_col, skip=('bottom',))
    if det < 2:
        b.facing([F.p(-ew / 2 + 0.7, y0 - 1.23, 0), F.p(ew / 2 - 0.7, y0 - 1.23, 0), F.p(ew / 2 - 0.7, y0 - 1.23, 3.0), F.p(-ew / 2 + 0.7, y0 - 1.23, 3.0)], (0, -1, 0), 'glass-shopfront', '#dfe9ef', mode='fit')
        F.box(b, -ew / 2 - 0.1, y0 - 1.4, H + 0.2, ew / 2 + 0.1, y0 - 1.15, H + 1.4, 'plain', accent, skip=('bottom',))
    # deep flat canopy over the forecourt, on slim columns
    b.section('canopy')
    cd = 4.5
    if det < 2:
        F.box(b, x0 + W * 0.04, y0 - cd - 1.2, 3.8, x1 - W * 0.04, y0 - 1.2 + 0.3, 4.2, 'plain', lib.shade(wc, 0.95), 'roof-flat', lk.roof_col, skip=('bottom',))
        if det == 0:
            n = int(W / 7)
            for k in range(n + 1):
                x = x0 + W * 0.04 + (W * 0.92) * k / n
                F.cyl(b, x, y0 - cd - 0.9, 0, 3.8, 0.12, n=6, slot='frame', col='#c9ccd0', top=False)
            U.neon(b, F.xy(x0 + W * 0.04, y0 - cd - 1.25), F.xy(x1 - W * 0.04, y0 - cd - 1.25), 3.85, srng.choice(['#ff5a4f', '#46e0ff']), th=0.1, w=0.1)
    b.section('sign')
    if det < 2:
        # blade sign tower and a flag pole
        F.box(b, x1 - 3.0, y0 - 5.2, 0, x1 - 2.2, y0 - 4.4, 8.0, 'plain', lib.shade(accent, 0.8), skip=('bottom',))
        F.box(b, x1 - 3.2, y0 - 5.0, 6.0, x1 - 2.0, y0 - 4.6, 9.2, 'plain', '#d8d2c2', skip=('bottom',))
        q = F.xy(x0 + 3.0, y0 - 5.2)
        lib.cylinder(b, q[0], q[1], 0, 9.0, 0.08, n=5, slot='frame', col='#b8bcc0', r_top=0.05, top=True)
    b.section('forecourt')
    # forecourt full of parked motorbikes and a few cars
    if det < 2:
        rows = 3
        for r in range(rows):
            for k in range(int((W * 0.8) / 1.5)):
                if srng.random() < 0.55 * U.DENSITY[0]:
                    q = F.xy(x0 + W * 0.1 + k * 1.5, y0 - 8.0 - r * 2.4)
                    bike(b, q[0], q[1], math.pi / 2 + srng.uniform(-0.1, 0.1) + F.yaw, srng.choice(['#c9ccd0', '#2a2d33', '#8a1f1f', '#e6e6e6', '#27456e', '#6b6e72']))
    if 'chimney' in fs and det < 2:
        lib.cylinder(b, *F.xy(x0 + 3, y1 - 2), H, H + 3.0, 0.5, n=6, slot='brick', col='#9b5a43', top=True)
    return {'front': y0 - 14.0, 'back': y1 + 2, 'wide': W + 12, 'park': True, 'no_road': False}


# ------------------------------------------------------------------------------------------------------------------ chalet
def build_chalet(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 10, 40)
    D = U.clamp(D, 8, 26)
    S = int(U.clamp(fm['S'], 1, 3))
    core = ' '.join(str(brief.get(k, '')) for k in ('name', 'subject', 'notes')).lower()
    stone_base = U.has(core, 'stone', 'refug', 'hut') or lk.wall_material in ('stone', 'sandstone', 'granite', 'limestone', 'flint')
    cold = str((style or {}).get('climate') or '') in ('cold', 'highland') or U.has(core, 'ski', 'snow')
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    gh = 3.0
    fh = 2.9
    H = gh + fh * (S - 1) if S > 1 else gh + 0.4
    timber_col = lk.wall_col if lk.wall_slot == 'timber' else srng.choice(['#8a5a3c', '#a5522f', '#7a4a2e', '#b6523a'])
    if str(brief.get('style')) == 'nordic' and not stone_base:
        timber_col = lk.wall_col
    stone_col = '#9a948a' if stone_base else timber_col
    b.section('walls')
    gslot = 'stone-blocks' if stone_base else 'timber'
    if S == 1 and stone_base:
        F.walls(b, x0, y0, x1, y1, 0, H, 1, lk, srng, front='punched', right='punched', back='none', left='punched', ratio=0.22, bay=3.4, wall_slot='stone-blocks', wall_col=stone_col, rear_reduced=True)
    else:
        F.walls(b, x0, y0, x1, y1, 0, gh, 1, lk, srng, front='punched', right='punched', back='none', left='punched', ratio=0.3, bay=3.2, wall_slot=gslot, wall_col=stone_col, rear_reduced=True)
        if S > 1:
            F.walls(b, x0, y0, x1, y1, gh, H, S - 1, lk, srng, front='punched', right='punched', back='none', left='punched', ratio=0.34, bay=3.0, wall_slot='timber', wall_col=timber_col, rear_reduced=True)
    # timber balcony round the front and right side
    b.section('balcony')
    if S > 1 and det < 2:
        bz = gh
        F.box(b, x0 - 0.2, y0 - 1.3, bz - 0.15, x1 + 0.2, y0, bz + 0.05, 'timber', lib.shade(timber_col, 0.8), 'timber', lib.shade(timber_col, 1.0), skip=('bottom',))
        U.railing_ring(b, F, x0 - 0.15, y0 - 1.25, x1 + 0.15, y0 - 0.05, bz + 0.05, 1.0, col=lib.shade(timber_col, 0.7))
        if det == 0:
            for k in range(int(W / 3.5) + 1):
                px = x0 + (W) * k / max(1, int(W / 3.5))
                F.box(b, px - 0.1, y0 - 1.25, 0, px + 0.1, y0 - 1.05, bz, 'timber', lib.shade(timber_col, 0.75), skip=('bottom', 'top'))
    b.section('roof')
    roof_col = '#e8edf0' if cold and srng.random() < 0.6 else lk.roof_col
    rise = D * 0.36
    ridge = 'x' if W >= D * 0.9 else 'y'
    slot = 'slate' if lk.roof_slot == 'slate' or stone_base else lk.roof_slot
    F.roof(b, 'gable', x0, y0, x1, y1, H, rise, 1.6, slot, roof_col, 'timber' if S > 1 else 'stone-blocks', timber_col if S > 1 else stone_col, ridge=ridge, ov_front=1.7, th=0.12)
    if det == 0:
        F.box(b, x1 - 3.4, (y0 + y1) / 2 - 0.5, H + rise * 0.3, x1 - 2.4, (y0 + y1) / 2 + 0.5, H + rise + 1.3, 'stone-blocks', '#8a847a', 'plain', '#3a3836')
        # wooden dormer on the front slope
        dx = srng.choice([-1, 1]) * W * 0.22
        F.box(b, dx - 0.8, y0 + 0.4, H + 0.2, dx + 0.8, y0 + 1.6, H + 1.6, 'timber', timber_col, 'plain', roof_col)
    b.section('dining')
    if det < 2:
        # firewood stack and a terrace with benches
        F.box(b, x1 + 0.4, y0 + 0.6, 0, x1 + 2.4, y0 + 1.3, 1.1, 'timber', '#a98a5a', 'timber', '#c4a37a', skip=('bottom',))
        slab(b, F, x0 - 0.5, y0 - 5.5, x1 + 0.5, y0 - 1.3 if S > 1 else y0, 0.18, '#a8a398')
        tables(b, F, x0 + 1.0, y0 - 5.0, x1 - 1.0, y0 - 1.6 if S > 1 else y0 - 0.8, srng, int(U.clamp(W / 3.5, 2, 7)), '#8a6a45', 4, 2.4)
        if 'umbrellas' in fs:
            for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 2), 1, 3))):
                U.chair_set(b, F, x0 + W * (k + 0.5) / 3, y0 - 6.0, srng, 2)
        if 'fence-wall' in fs:
            pts = [(x0 - 3, y0 - 7.5), (x0 - 3, y1 + 2), (x1 + 3, y1 + 2), (x1 + 3, y0 - 7.5)]
            U.fence_wall(b, pts, 1.0, 0.25, lk, '#9a948a', 'stone-blocks')
        if 'flags' in fs:
            for k in range(2):
                U.flag_pole(b, x0 + 1.0 + k * 1.8, y0 - 8.0, 8.0, srng.choice(['#b6323a', '#2f5d8a', '#f1ece0']))
    return {'front': y0 - 8.5, 'back': y1 + 2, 'wide': W + 12, 'cold': cold}


# ------------------------------------------------------------------------------------------------------------------ pavilion
def build_pavilion(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 10, 30)
    D = U.clamp(D, 8, 20)
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    water = (brief.get('setting') or {}).get('forecourt') == 'water' or 'pier' in fs
    dz = 0.7
    thatch = lk.roof_slot in ('timber',) or fm['roof'] == 'pyramidal' or U.has(U.text(brief), 'thatch', 'palm-thatched')
    rc = '#b8a064' if thatch else lk.roof_col
    rslot = 'timber' if thatch else lk.roof_slot
    b.section('deck')
    # timber deck on posts
    F.box(b, x0 - 1.0, y0 - 1.5, dz - 0.15, x1 + 1.0, y1 + 1.0, dz, 'timber', '#7a5a3a', 'timber', '#a58559', skip=('bottom',))
    if det == 0:
        for k in range(int(W / 2.5) + 1):
            px = x0 - 0.8 + (W + 1.6) * k / max(1, int(W / 2.5))
            for py in (y0 - 1.3, y1 + 0.8):
                F.cyl(b, px, py, 0, dz - 0.15, 0.1, n=4, slot='timber', col='#6f5238', top=False, smooth=False)
    b.section('roof')
    # posts and a big pyramid / hip roof
    pw, pd = W * 0.8, D * 0.8
    zp = 3.0
    if det < 2:
        for sx in (-1, 1):
            for sy in (-1, 1):
                F.box(b, sx * pw / 2 - 0.12, sy * pd / 2 - 0.12, dz, sx * pw / 2 + 0.12, sy * pd / 2 + 0.12, zp, 'timber', '#6f5238', skip=('bottom', 'top'))
        if det == 0:
            for sx in (-pw / 4, pw / 4):
                F.box(b, sx - 0.1, -pd / 2 - 0.1, dz, sx + 0.1, -pd / 2 + 0.1, zp, 'timber', '#6f5238', skip=('bottom', 'top'))
    form = 'pyramidal' if abs(W - D) < W * 0.35 or fm['roof'] == 'pyramidal' else 'hip'
    F.roof(b, form, -pw / 2 - 0.4, -pd / 2 - 0.4, pw / 2 + 0.4, pd / 2 + 0.4, zp + dz, max(2.0, min(pw, pd) * 0.42), 1.4, rslot, rc, 'timber', '#6f5238', ov_front=1.4, th=0.15)
    b.section('furniture')
    if det < 2:
        # bar counter, tables
        F.box(b, -pw / 2 + 0.4, pd / 2 - 1.4, dz, -pw / 2 + 0.4 + pw * 0.4, pd / 2 - 0.5, dz + 1.1, 'timber', '#6f5238', 'timber', '#a58559', skip=('bottom',))
        for k in range(int(U.clamp(W / 3.0, 3, 8)) if det == 0 else 2):
            tx = -pw / 2 + 1.2 + (pw - 2.4) * ((k % 4) + 0.5) / 4
            ty = -pd / 2 + 1.2 + (k // 4) * 2.4
            q = F.xy(tx, ty)
            U.dining_set(b, q[0], q[1], srng, '#8a6a45', [srng.choice(CH)], chairs=4 if det == 0 else 2)
        # lanterns / string lights under the roof
        U.string_lights(b, F, -pw / 2 + 0.3, pw / 2 - 0.3, -pd / 2 + 0.3, pd / 2 - 0.3, zp + dz - 0.5, 12)
    b.section('pier')
    if det < 2 and (water or 'pier' in fs):
        L = 12.0
        F.box(b, -1.1, y0 - 1.5 - L, dz - 0.15, 1.1, y0 - 1.4, dz, 'timber', '#7a5a3a', 'timber', '#a58559', skip=('bottom',))
        if det == 0:
            for k in range(5):
                for sx in (-1.0, 1.0):
                    F.cyl(b, sx, y0 - 1.8 - k * 2.4, 0, dz - 0.15, 0.09, n=4, slot='timber', col='#6f5238', top=False, smooth=False)
    if 'kiosk' in fs and det < 2:
        U.container_kiosk(b, F, x1 + 4.0, y0 + 1.0, 3.2, 2.2, srng.choice(acc[:4]))
    if det < 2 and ('umbrellas' in fs):
        for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 2), 1, 3))):
            U.chair_set(b, F, x1 + 3.0 + k * 0.0, y0 - 2.5 - k * 3.2, srng, 2)
    return {'front': y0 - 14.0 if (water or 'pier' in fs) else y0 - 5.0, 'back': y1 + 3, 'wide': W + 16, 'water': water}


# ------------------------------------------------------------------------------------------------------------------ teahouse
def build_teahouse(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    W = U.clamp(W, 9, 26)
    D = U.clamp(D, 8, 18)
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    wood = '#6f3a2a'
    plaster = '#efe9dc'
    b.section('platform')
    F.box(b, x0 - 1.0, y0 - 1.2, 0, x1 + 1.0, y1 + 0.6, 0.6, 'stone-blocks', '#9a948a', 'timber', '#8a5a3c', skip=('bottom',))
    H = 3.3
    z0 = 0.6
    b.section('walls')
    # timber frame: corner and intermediate columns, plaster panels, lattice windows (screen) on the front
    F.walls(b, x0 + 0.5, y0 + 0.5, x1 - 0.5, y1 - 0.5, z0, z0 + H, 1, lk, srng, front='screen', right='screen', back='none', left='screen', ratio=0.6, bay=2.6, wall_slot='plain-render', wall_col=plaster, rear_reduced=True)
    if det < 2:
        n = max(3, int(W / 2.6))
        for k in range(n + 1):
            x = x0 + 0.5 + (W - 1.0) * k / n
            F.box(b, x - 0.1, y0 + 0.3, z0, x + 0.1, y0 + 0.5, z0 + H, 'timber', wood, skip=('bottom', 'top'))
        F.box(b, x0 + 0.3, y0 + 0.3, z0 + H - 0.25, x1 - 0.3, y0 + 0.55, z0 + H, 'timber', lib.shade(wood, 0.8), skip=('bottom',))
    b.section('roof')
    tile = '#4a4f57' if lk.roof_col in ('#8a8f94',) else lk.roof_col
    zr = z0 + H
    # lower skirt roof (wide, shallow), a plastered upper wall band, then the smaller steeper upper hip roof: the double-eaved silhouette
    tslot = 'clay-tile' if lk.roof_slot != 'slate' else 'slate'
    F.roof(b, 'hip', x0 - 0.8, y0 - 0.9, x1 + 0.8, y1 + 0.5, zr, 0.9, 0.6, tslot, tile, 'plain-render', plaster, th=0.12, ov_front=0.6)
    ux0, ux1, uy0, uy1 = x0 + 2.0, x1 - 2.0, y0 + 1.6, y1 - 1.8
    zu = zr + 0.9
    if det < 3:
        F.box(b, ux0, uy0, zu - 0.25, ux1, uy1, zu + 1.5, 'plain-render', plaster, skip=('bottom', 'top'))
        if det == 0:
            for k in range(int((ux1 - ux0) / 1.6) + 1):
                x = ux0 + (ux1 - ux0) * k / max(1, int((ux1 - ux0) / 1.6))
                F.box(b, x - 0.07, uy0 - 0.05, zu - 0.25, x + 0.07, uy0 + 0.05, zu + 1.5, 'timber', wood, skip=('bottom', 'top'))
    F.roof(b, 'hip', ux0 - 0.7, uy0 - 0.7, ux1 + 0.7, uy1 + 0.7, zu + 1.5, min(ux1 - ux0, uy1 - uy0) * 0.3, 0.5, tslot, lib.shade(tile, 1.05), 'plain-render', plaster, th=0.12, ov_front=0.7)
    if det == 0:
        # upturned eave corner tips
        for sx in (-1, 1):
            for sy in (-1, 1):
                q = F.xy(sx * (W / 2 + 0.6), sy * (D / 2 - 0.2) + (-0.4 if sy < 0 else 0.0))
                lib.cylinder(b, q[0], q[1], zr - 0.05, zr + 0.45, 0.18, n=4, slot='plain', col=lib.shade(tile, 1.15), r_top=0.0, top=False, smooth=False)
    b.section('garden')
    if det < 2:
        # lanterns under the front eave
        for k in range(3 if det == 0 else 0):
            q = F.xy(x0 + 1.5 + (W - 3.0) * k / 2, y0 - 0.5)
            lib.blob(b, q[0], q[1], zr - 0.9, 0.22, 0.22, 0.3, '#c8342a', n=6, rings=3)
        # stepping stones and a pine
        for k in range(5):
            F.box(b, -0.6, y0 - 1.6 - k * 1.0, 0, 0.6, y0 - 1.2 - k * 1.0, 0.06, 'stone-blocks', '#a8a39a', skip=('bottom',))
        if lk.tree not in (None, 'none'):
            lib.tree(b, 'conifer', *F.xy(x1 + 3.5, y0 + 1.0), 6.0, srng, lk)
    return {'front': y0 - 8.0, 'back': y1 + 2, 'wide': W + 12}


# ------------------------------------------------------------------------------------------------------------------ townhouse
def build_townhouse(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    st = str(brief.get('style') or '')
    acc = U.accent_cols(brief, style, srng)
    pal = U.palette(brief, style, lk, srng)
    S = int(U.clamp(fm['S'], 2, 7))
    W = U.clamp(W, 7, 64)
    D = U.clamp(D, 6, 34)
    gh = 4.0
    fh = 3.6 if st in ('neoclassical', 'baroque', 'soviet') else 3.2
    if fm['H'] > 6:
        fh = U.clamp((fm['H'] - gh) / max(1, S - 1), 2.8, 4.2)
    H = gh + fh * (S - 1)
    wc, ws = lk.wall_col, lk.wall_slot
    lkr = copy.copy(lk)
    if ws in ('brick', 'timber') and W * H > 250:
        lkr.wall_slot = 'plain-render'
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    rowmode = W >= 15 and D <= 16 and S >= 2 and st in ('georgian', 'victorian', 'baroque', 'vernacular', 'nordic', 'gothic-revival', 'colonial')
    windows = 'arched' if st in ('baroque', 'ottoman', 'neoclassical') and S <= 5 and lk.windows in ('arched', 'none') else ('punched' if lk.windows in ('none', 'curtain', 'screen', 'louvre') else lk.windows)
    if st in ('art-deco', 'modernist') and lk.windows in ('ribbon', 'curtain'):
        windows = 'ribbon'
    if st == 'soviet':
        windows = 'punched'
    if 'arches' in fs and windows == 'punched':
        windows = 'arched'
    roof_form = fm['roof'] if fm['roof'] in ('gable', 'hip', 'mansard', 'flat') else 'hip'
    cols_awn = [srng.choice(acc[:4]), '#f1ece0']
    b.section('walls')
    if rowmode:
        pitch_rise = max(1.2, D / 2 * math.tan(math.radians(30)))
        FR = U.Frame(0, y0, 0)
        U.terrace_row(b, FR, W, D, S, lk, srng, 'euro', pal, acc, gh=gh, fh=fh, awn_p=0.7 if 'awning' in fs else 0.4, ratio=0.34, windows=windows if windows != 'ribbon' else 'punched', chimneys=True)
        top = H + pitch_rise
    else:
        front = F.seg(x0, y0, x1, y0)
        arcade = 'arcade' in fs
        gall = 'balcony-bands' in fs
        U.shop_facade(b, front, 0, S, gh, fh, lk, srng, kind='glass', cols=pal, accents=acc, unit_w=max(3.4, min(W, 6.0)), wall_slot=ws, wall_col=wc, windows=windows,
                      ratio=max(0.28, min(0.5, lk.ratio)), gallery=gall, awn_p=0.9 if 'awning' in fs else 0.25, arcade=arcade, bay=3.1 if st != 'soviet' else 3.6,
                      accent_band=lib.shade(srng.choice(acc[:3]), 0.9) if st in ('victorian', 'art-deco') else None, signs=True)
        for sg, kind in ((F.seg(x1, y0, x1, y1), windows if W < 30 else 'punched'), (F.seg(x1, y1, x0, y1), 'punched'), (F.seg(x0, y1, x0, y0), windows if W < 30 else 'punched')):
            lib.facade(b, sg, 0, H, S, lk, kind if kind != 'ribbon' else 'ribbon', 0.3, srng, 3.4, reduced=True, wall_slot=ws, wall_col=wc)
        top = H
        # style flavours
        b.section('style')
        if det < 2:
            if st in ('baroque', 'neoclassical', 'georgian', 'victorian'):
                # string courses and a heavy cornice
                lib.cornice(b, lib.fp_rect(W, D), H - 0.35, 0.7, 0.55, lkr, col=lib.shade(wc, 1.12))
            if st == 'ottoman' and det == 0:
                # timber upper floors jettied out on brackets
                lib.seg_box(b, front, -0.3, W + 0.3, gh - 0.25, gh + 0.05, 0.7, lib.shade('#7a4a2e', 1.0), 'timber')
            if st == 'soviet' or 'relief-pattern' in fs:
                relief_top = lib.shade(wc, 0.75)
                U.relief_band(b, front, 1.0, W - 1.0, H - 3.2, H - 0.8, relief_top, lib.shade(wc, 1.15)) if det == 0 else None
            if st == 'art-deco' and det == 0:
                for k in range(int(W / 4)):
                    lib.seg_box(b, front, 2.0 + k * 4.0, 2.25 + k * 4.0, gh, H, 0.4, lib.shade(wc, 1.1), 'plain-render')
    b.section('roof')
    if rowmode:
        pass
    elif roof_form == 'mansard' or (st in ('victorian', 'baroque') and roof_form == 'hip' and S >= 4 and srng.random() < 0.5):
        lib.roof(b, 'mansard', (x0, y0, x1, y1), H, lkr, rise=min(5.0, D * 0.3), ov=0.4)
        if det == 0:
            nd = int(U.clamp(W / 4.5, 1, 8))
            for k in range(nd):
                dx = x0 + W * (k + 0.5) / nd
                F.box(b, dx - 0.65, y0 + 0.5, H + 0.2, dx + 0.65, y0 + 1.4, H + 1.7, ws, lib.shade(wc, 1.1), 'plain', lk.roof_col, skip=('bottom',))
    elif roof_form == 'gable' or st in ('gothic-revival', 'nordic'):
        rise = D / 2 * math.tan(math.radians(34 if st != 'gothic-revival' else 48))
        ridge = 'y' if ((W < 14 and D > W) or st == 'gothic-revival') else 'x'
        # gabled front: ridge perpendicular to the street for narrow houses
        F.roof(b, 'gable', x0, y0, x1, y1, H, (W if ridge == 'y' else D) / 2 * math.tan(math.radians(40 if st != 'gothic-revival' else 52)), 0.5, lk.roof_slot, lk.roof_col, lkr.wall_slot, wc, ridge=ridge, ov_front=0.5, th=0.1)
        if st == 'gothic-revival' and det < 2:
            for sx in (x0, x1):
                lib.cylinder(b, *F.xy(sx, y0), H, H + 3.2, 0.35, n=6, slot=lkr.wall_slot, col=lib.shade(wc, 1.1), r_top=0.0, top=False, smooth=False)
            lib.cylinder(b, *F.xy(0, y0), H + 2.0, H + 5.0, 0.3, n=6, slot=lkr.wall_slot, col=lib.shade(wc, 1.1), r_top=0.0, top=False, smooth=False)
    elif roof_form == 'flat':
        F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.25, 'roof-flat', lk.roof_col, lkr.wall_slot, wc, parapet=0.9 if st != 'soviet' else 0.6, par_col=lib.shade(wc, 1.08))
        U.roof_extras(b, F, x0 + 1.5, y0 + 1.5, x1 - 1.5, y1 - 1.5, H, srng, lk, cores=1 if W > 20 else 0, tanks=0, plant=2, rebar=False) if det < 2 else None
    else:
        hip_or_gable(b, F, 'hip', x0, y0, x1, y1, H, min(W, D) / 2 * (0.45 if st != 'soviet' else 0.3), 0.7, lk.roof_slot, lk.roof_col, lkr.wall_slot, wc, ridge='x' if W >= D else 'y', ov_front=0.9)
    if (st in ('georgian', 'victorian', 'baroque') or 'chimney' in fs) and not rowmode and det == 0 and roof_form in ('hip', 'gable'):
        for k in range(int(U.clamp(W / 7, 1, 4))):
            cx = x0 + W * (k + 0.5) / int(U.clamp(W / 7, 1, 4))
            F.box(b, cx - 0.4, (y0 + y1) / 2 - 0.4, H + 1.2, cx + 0.4, (y0 + y1) / 2 + 0.4, H + 3.4, 'brick', '#9b5a43', 'plain', '#4a4540')
    b.section('features')
    if det < 2:
        topz = H + (0.9 if roof_form == 'flat' else 0.0)
        if 'roof-terrace' in fs and roof_form == 'flat' and not rowmode:
            U.roof_lounge(b, F, x0 + 0.4, y0 + 0.4, x1 - 0.4, y1 - 0.4, H + 0.1, srng, lk, acc, tables_n=2 if W < 18 else 4, pergola_=W > 14, bar=W > 10)
        elif 'atrium-glass' in fs and roof_form == 'flat' and not rowmode:
            U.roof_skylight(b, F, -W * 0.22, -D * 0.2, W * 0.22, D * 0.2, H, lk)
        if 'crenellation' in fs and not rowmode:
            U.merlons(b, F, x0, y0, x1, y1, topz, lib.shade(wc, 1.05))
        if 'flat-canopy' in fs and not rowmode:
            U.flat_canopy_at(b, F, srng.uniform(-W * 0.15, W * 0.15), y0 - 0.1, min(W * 0.5, 12.0), 2.6, gh - 0.2, lk)
        if 'pediment' in fs and not rowmode:
            ew = U.clamp(W * 0.3, 5.0, 12.0)
            fsg = F.seg(x0, y0, x1, y0)
            U.entrance_bay(b, fsg, W / 2, ew, 0, H, 1.0, lk, srng, col=lib.shade(wc, 1.08), sign_col=lib.shade(srng.choice(acc[:3]), 0.8), arch=windows == 'arched', sign=False)
            lib.roof(b, 'gable', (W / 2 * 0 - ew / 2 - 0.2, y0 - 1.0, ew / 2 + 0.2, y0 + 0.3), H + 1.6, lkr, rise=ew * 0.14, ov=0.15, axis='x', gable_slot=lkr.wall_slot, gable_col=lib.shade(wc, 1.15))
        if 'stained-glass' in fs and st == 'gothic-revival' and det == 0:
            for k, c in enumerate(('#2f6fb0', '#c4452f', '#e0b030', '#3b8a4e', '#7a4a9a')):
                gx = (k - 2) * 1.1
                b.face([F.p(gx - 0.45, y0 - 0.06, H * 0.45), F.p(gx + 0.45, y0 - 0.06, H * 0.45), F.p(gx + 0.45, y0 - 0.06, H * 0.45 + 2.6), F.p(gx, y0 - 0.06, H * 0.45 + 3.1), F.p(gx - 0.45, y0 - 0.06, H * 0.45 + 2.6)], 'plain', c)
    # steps + railings (georgian), pavement terrace with tables and awnings
    b.section('street')
    if det < 2:
        if st in ('georgian', 'victorian') or 'steps' in fs:
            sw = min(3.0, W * 0.4)
            xs = srng.choice([-1, 1]) * (W / 2 - sw / 2 - 0.4) if W > 7 else 0.0
            F.box(b, xs - sw / 2, y0 - 1.0, 0, xs + sw / 2, y0, 0.22, 'paving', '#b3aea4', 'paving', '#c2bdb2', skip=('bottom',))
            F.box(b, xs - sw / 2, y0 - 0.55, 0, xs + sw / 2, y0, 0.45, 'paving', '#b3aea4', 'paving', '#c2bdb2', skip=('bottom',))
            if det == 0:
                for sx in (xs - sw / 2, xs + sw / 2):
                    lib.beam(b, F.xy(sx, y0 - 1.0), F.xy(sx, y0), 0.9, 0.96, 0.05, 'frame', '#2b2b2b', skip=('bottom',))
        # pavement terrace: barrier rail and tables
        nt = int(U.clamp(W / 2.6, 1, 8))
        if det < 2:
            tables(b, F, x0 + 0.6, y0 - 3.2, x1 - 0.6, y0 - 0.5, srng, nt, '#f2f2ee', 2 if W < 12 else 4, 2.1)
            if 'umbrellas' in fs or 'terrace' in fs:
                for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 2), 1, 4))):
                    q = F.xy(x0 + W * (k + 0.5) / max(2, int(U.clamp(U.fcount(fs, 'umbrellas', 2), 1, 4))), y0 - 2.0)
                    U.umbrella(b, q[0], q[1], 1.5, 2.5, srng.choice(U.UMB))
        if 'signage-board' in fs and not rowmode:
            F.box(b, W * 0.1 - W / 2, y0 - 0.2, gh + 0.3, W * 0.35 - W / 2, y0, gh + 1.0, 'plain', srng.choice(acc[:3]), skip=('bottom',))
        if 'painted-mural' in fs and not rowmode:
            sd = F.seg(x1, y0, x1, y1)
            U.mural_panel(b, sd, 0.5, D - 0.5, gh + 0.4, H - 1.0, [srng.choice(acc[:3]), '#f1ece0', '#2f6fb0', '#e0b030'], srng)
        if 'courtyard' in fs and det == 0:
            pass
    return {'front': y0 - 4.5, 'back': y1 + 2, 'wide': W + 8, 'street': True}


# ------------------------------------------------------------------------------------------------------------------ build
def build(brief, style, rng, detail):
    seed = rng.getrandbits(64)
    return U.governed(lambda: _build(brief, style, random.Random(seed), detail), detail)


def _build(brief, style, rng, detail):
    b = lib.Builder('restaurant', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    fm = U.form(brief)
    fs = U.feats(brief)
    txt = U.text(brief)
    typ = infer(brief, fm, fs, txt, style)
    W, D = fm['W'], fm['D']
    fn = {'buka': build_buka, 'fastfood': build_fastfood, 'cafe': build_cafe, 'club': build_club, 'diner': build_diner, 'chalet': build_chalet, 'pavilion': build_pavilion,
          'teahouse': build_teahouse, 'townhouse': build_townhouse}[typ]
    if typ == 'chalet' or typ == 'pavilion':
        pass
    info = fn(b, brief, style, lk, fm, fs, txt, srng, W, D)
    if 'gate' in fs and typ in ('fastfood', 'cafe', 'buka', 'townhouse', 'diner') and detail < 3:
        yw = info['front'] + 0.8
        wc = lib.shade(lk.wall_col, 0.95)
        pw = info['wide'] / 2 - 2.0
        U.fence_wall(b, [(-pw, yw), (-2.6, yw)], 1.6, 0.3, lk, wc, lk.wall_slot if lk.wall_slot not in ('brick', 'timber') else 'plain-render')
        U.fence_wall(b, [(2.6, yw), (pw, yw)], 1.6, 0.3, lk, wc, lk.wall_slot if lk.wall_slot not in ('brick', 'timber') else 'plain-render')
        U.gate(b, U.Frame(0, yw, 0), 0.0, 5.2, 2.4, lk, col=lk.trim_col, board=U.accent_cols(brief, style, srng)[0])
    b.section('ground')
    wide = info['wide']
    yf = info['front']
    yb = info['back'] + 4.0
    fc = (brief.get('setting') or {}).get('forecourt') or 'road'
    park = (info.get('park', False) and fc in ('parking', 'road', 'none')) or 'car-park' in fs or fc == 'parking'
    if fc == 'water' and typ not in ('pavilion',) and detail < 2:
        with b.site():
            F0 = U.Frame(0, 0, 0)
            F0.ground_quad(b, -wide / 2 - 3, yf - 22.0, wide / 2 + 3, yf - 9.0, 0.02, 'plain', '#5f98b3', 1.0)
    if typ in ('pavilion',) and info.get('water'):
        lib.ground(b, -wide / 2, yf + 14.0, wide / 2, yb, lk, z=0.0)
        if detail < 2:
            with b.site():
                F0 = U.Frame(0, 0, 0)
                F0.ground_quad(b, -wide / 2 - 4, yf - 8, wide / 2 + 4, yf + 14.0, 0.02, 'plain', '#5f98b3', 1.0)
        U.trees_row(b, lk, srng, -wide / 2 + 3, wide / 2 - 3, yb - 2, 3)
        return b.objects()
    if typ in ('chalet', 'teahouse', 'pavilion') and fc in ('none', 'garden') and not park:
        lib.ground(b, -wide / 2, yf, wide / 2, yb, lk, z=0.0, scale=4.0)
        if lk.ground_slot == 'plain-render' or info.get('cold'):
            pass
        U.trees_row(b, lk, srng, -wide / 2 + 3, wide / 2 - 3, yb - 3, 4, 5.0, 8.0) if typ != 'pavilion' else None
        if typ == 'chalet' and lk.tree in (None, 'none') and detail < 2:
            for k in range(3):
                lib.tree(b, 'conifer', -wide / 2 + 3 + k * (wide - 6) / 2, yb - 3 + srng.uniform(-1, 1), srng.uniform(6, 9), srng, lk)
        return b.objects()
    road = fc in ('road', 'parking', 'plaza') or typ in ('townhouse', 'club', 'diner', 'fastfood', 'buka', 'cafe')
    U.commerce_site(b, lk, srng, fs, brief, -wide / 2, wide / 2, yf, yb, park=park, road=road, trees=3 if lk.tree != 'none' else 0, depth_front=3.0 if not park else 6.0, flags=False,
                    lamps=int(U.clamp(wide / 16, 1, 3)), road_w=6.5, tree_h=(4.5, 7.0), tree_pos='ends')
    if fc == 'garden' and detail < 2 and typ in ('cafe', 'townhouse'):
        with b.site():
            F0 = U.Frame(0, 0, 0)
            F0.ground_quad(b, -wide / 2 + 1, yf, wide / 2 - 1, yf + 3.0, 0.03, 'grass', '#6d9a4f', 1.0)
    return b.objects()
