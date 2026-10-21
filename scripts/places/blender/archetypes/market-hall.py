"""market-hall: covered markets and trading complexes. Typologies chosen from the brief (style, storeys, roof, footprint, wording):

  complex   multi-storey trading complex / plaza (Kantin Kwari, Gbagi, Kaneshie, Mile One, Oba market): ring/U/L/rect block, ground-floor
            lock-up shops with roll shutters and fascia boards, upper floors of punched windows, louvres or ribbon, gallery balconies,
            optional arcade, entrance bay, rooftop tanks/clutter, courtyard with stalls.
  shedhall  one big covered hall (modern market): basilica section with low aisles, clerestory glazing and a gabled / vaulted / sawtooth /
            mono-pitch / flat roof, shop-front aisle walls, gate ends (Damaturu, Yola barrel hall, Jos sawtooth, Libreville gable).
  ironhall  colonial / Victorian market hall: masonry front block with arched windows, central pavilion (pediment or clock tower), corner
            pavilions with pyramid roofs, behind it a ridge-and-furrow glazed roof on arcaded walls.
  souk      vaulted bazaar (Arab / Ottoman / Persian / Swahili): parallel barrel vaults with lantern domes, pointed-arch walls, portal gate,
            optional minaret, courtyard khan.
Layout: centred on x = 0, main frontage towards -Y.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _market_open_util as U  # noqa: E402

import lib  # noqa: E402

FEATURES = {'stalls', 'awning', 'umbrellas', 'signage-board', 'louvres', 'lock-ups', 'balcony-bands', 'arcade', 'arches', 'courtyard', 'gate',
            'minaret', 'car-park', 'solar-panels', 'neon-strip', 'colonnade', 'water-tank', 'shopfront', 'bus-bays', 'fence-wall', 'dome',
            'clock-tower', 'atrium-glass', 'flags', 'kiosk', 'sheds', 'floodlights', 'pediment', 'statue'}

GOODS = ['#d9a441', '#c4452f', '#4f8a3a', '#e07a30', '#8a5fa0', '#e8e1cf', '#9a6a3a']


def infer(brief, fm, fs, txt):
    st = str(brief.get('style') or '')
    core = ' '.join(str(brief.get(k, '')) for k in ('name', 'subject', 'venueId')).lower()
    if st in ('arab-islamic', 'ottoman', 'persian', 'mughal', 'swahili') or (U.has(core, 'souk', 'souq', 'bazaar', 'khan ') and fm['roof'] != 'flat'):
        return 'souk'
    if st in ('victorian', 'gothic-revival', 'neoclassical', 'georgian', 'baroque', 'art-deco', 'tudor') or U.has(txt, 'victorian', 'iron hall', 'market hall') or \
            (st == 'colonial' and fm['S'] <= 1):
        return 'ironhall'
    if fm['S'] <= 1 and fm['roof'] in ('gable', 'barrel', 'sawtooth', 'shed', 'flat', 'hip') and fm['W'] >= 50:
        return 'shedhall'
    if fm['S'] <= 1:
        return 'shedhall'
    return 'complex'


def facade_kind(lk, fs):
    k = lk.windows
    if 'louvres' in fs or k == 'louvre':
        return 'louvre'
    if 'arches' in fs and k in ('none', None, 'punched'):
        return 'arched'
    if k in ('none', None):
        return 'punched'
    if k in ('curtain', 'ribbon', 'punched', 'arched', 'screen', 'pointed-arch'):
        return k
    return 'punched'


def stall_cols(brief, style, srng):
    return [U.sat(c, 0.2) for c in U.accent_cols(brief, style, srng)] + U.UMB[:4]


def stalls_in(b, F, x0, y0, x1, y1, srng, cols, n, pitch=(3.0, 2.8)):
    if b.detail >= 2:
        return
    px, py = pitch
    nx, ny = max(1, int((x1 - x0) / px)), max(1, int((y1 - y0) / py))
    cells = [(i, j) for i in range(nx) for j in range(ny)]
    srng.shuffle(cells)
    n = int(n * U.DENSITY[0]) // (2 if b.detail == 1 else 1)
    for (i, j) in cells[:n]:
        x = x0 + (i + 0.5) * (x1 - x0) / nx + srng.uniform(-0.4, 0.4)
        y = y0 + (j + 0.5) * (y1 - y0) / ny + srng.uniform(-0.4, 0.4)
        if srng.random() < 0.6:
            U.umbrella_stall(b, F, x, y, srng, cols, GOODS)
        else:
            U.tarp_stall(b, F, x, y, srng, cols, GOODS)


def sign_on_roof(b, F, x, y, z, w, h, col):
    """Blank board on a frame standing on a roof at local (x, y)."""
    if b.detail >= 2:
        return
    F.box(b, x - w / 2, y, z + 0.8, x + w / 2, y + 0.25, z + 0.8 + h, 'plain', col, skip=('bottom',))
    if b.detail == 0:
        for sx in (-w * 0.4, w * 0.4):
            F.box(b, x + sx - 0.1, y, z, x + sx + 0.1, y + 0.25, z + 0.8, 'frame', '#7d8286', skip=('bottom',))


def mosque_beside(b, lk, srng, x, y):
    U.mosque_small(b, U.Frame(x, y, 0), 0, 0, srng, lk)


# ------------------------------------------------------------------------------------------------------------------ complex
def build_complex(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    S = int(U.clamp(fm['S'], 2, 5))
    gh, fh = 4.3, 3.6
    H = gh + fh * (S - 1)
    kind = fm['fp'] if fm['fp'] in ('rect', 'L', 'U', 'ring', 'T', 'H', 'cross') else ('L' if fm['fp'] == 'irregular' else 'rect')
    if kind in ('T', 'H', 'cross'):
        kind = 'U'
    fp = lib.footprint(kind, W, D, srng, det)
    arcade = 'arcade' in fs
    gallery = 'balcony-bands' in fs or (str(brief.get('style')) in ('vernacular', 'modernist') and srng.random() < 0.7)
    wk = facade_kind(lk, fs)
    pal = U.palette(brief, style, lk, srng)
    acc = U.accent_cols(brief, style, srng)
    awn_p = 0.55 if 'awning' in fs else 0.12
    shop_kind = 'mixed'
    wc = lk.wall_col
    b.section('walls')
    front_segs = []
    for pi, poly in enumerate(fp.polys):
        m = len(poly)
        for i, p in enumerate(poly):
            q = poly[(i + 1) % m]
            if math.dist(p, q) < 0.5:
                continue
            seg = lib.Seg(p, q)
            hole = pi > 0
            rear = seg.rear and not hole
            kw = dict(kind=shop_kind, cols=pal, accents=acc, unit_w=3.4, wall_slot=lk.wall_slot, wall_col=wc, windows=wk, ratio=max(0.2, lk.ratio) if lk.ratio < 0.5 else 0.36,
                      gallery=gallery and (seg.front or hole), awn_p=awn_p if (seg.front or hole) else 0.0, arcade=arcade and seg.front, reduced=(not seg.front and not hole))
            U.shop_facade(b, seg, 0, S, gh, fh, lk, srng, ground_shops=not rear, **kw)
            if seg.front and not hole:
                front_segs.append(seg)
    # roof
    b.section('roof')
    x0, y0, x1, y1 = fp.bbox
    roof_form = fm['roof'] if (fm['roof'] in ('gable', 'shed', 'hip') and kind == 'rect' and S <= 2) else 'flat'
    if roof_form == 'flat':
        lib.roof(b, 'flat', fp, H, lk, parapet_h=0.9, ov=0.0, slab=0.0)
        lib.cornice(b, fp, H - 0.2, 0.45, 0.35, lk)
        for r in fp.rects:
            U.roof_extras(b, U.Frame(0, 0, 0), r[0] + 2, r[1] + 2, r[2] - 2, r[3] - 2, H, srng, lk, cores=1 if (r[2] - r[0]) * (r[3] - r[1]) < 1500 else 2, tanks=2, plant=2)
    else:
        x0_, y0_, x1_, y1_ = fp.bbox
        F00 = U.Frame(0, 0, 0)
        if roof_form == 'gable':
            F00.roof(b, 'gable', x0_, y0_, x1_, y1_, H, (y1_ - y0_) / 2 * 0.3, 1.0, lk.roof_slot, lk.roof_col, lk.wall_slot, lk.wall_col, ov_front=1.0)
        elif roof_form == 'hip':
            F00.roof(b, 'hip', x0_, y0_, x1_, y1_, H, (y1_ - y0_) / 2 * 0.3, 1.0, lk.roof_slot, lk.roof_col, lk.wall_slot, lk.wall_col, ov_front=1.0)
        else:
            F00.roof(b, 'shed', x0_, y0_, x1_, y1_, H, D * 0.12, 0.8, lk.roof_slot, lk.roof_col, lk.wall_slot, lk.wall_col, high='back', ov_front=1.0)
    F0 = U.Frame(0, 0, 0)
    if 'atrium-glass' in fs and roof_form == 'flat' and kind in ('rect', 'L', 'U') and det < 3:
        aw = min(W * 0.55, 56)
        rect = (-aw / 2, y0 + D * 0.3, aw / 2, y1 - D * 0.3)
        if rect[3] - rect[1] > 6:
            lib.barrel(b, rect, H + 0.2, 2.0, lk, axis='x', ov=0.0, slot='glass-ribbon', col='#cfdde4', end_slot='glass-curtain', end_col='#dfe9ef')
    if 'water-tank' in fs or srng.random() < 0.7:
        U.water_tank(b, x0 + W * 0.3, y1 - 5, H if roof_form == 'flat' else H + 2, srng)
    if 'solar-panels' in fs and det == 0 and roof_form == 'flat':
        for r in range(3):
            yy = y0 + (y1 - y0) * (r + 1) / 5
            b.facing([(x0 + W * 0.2, yy - 1.1, H + 1.0), (x1 - W * 0.2, yy - 1.1, H + 1.0), (x1 - W * 0.2, yy + 1.1, H + 1.9), (x0 + W * 0.2, yy + 1.1, H + 1.9)], (0, -0.4, 1), 'glass-ribbon', '#8fa3b5', mode='tile')
    # entrance bay on the widest front segment
    b.section('entrance')
    if front_segs:
        fs0 = max(front_segs, key=lambda s: s.length)
        ew = min(12.0, fs0.length * 0.3)
        if 'gate' in fs or srng.random() < 0.75:
            U.entrance_bay(b, fs0, fs0.length * srng.uniform(0.4, 0.6), ew, 0, H, 1.6, lk, srng, col=lib.shade(wc, 1.08), sign_col=lib.shade(srng.choice(acc), 0.8), arch=(lk.windows in ('arched', 'punched', 'none')))
        if 'signage-board' in fs and det < 2:
            for k in range(int(U.clamp(U.fcount(fs, 'signage-board', 1), 1, 3))):
                sc = srng.choice(acc)
                sign_on_roof(b, F0, x0 + W * (0.2 + 0.3 * k), y0 + 0.5, H, 7.0, 2.2, lib.shade(sc, 0.85))
    if 'neon-strip' in fs and det < 2:
        for seg in front_segs[:1]:
            U.neon(b, seg.P(1.0, 0, -0.3)[:2], seg.P(seg.length - 1.0, 0, -0.3)[:2], H - 0.65, '#ff5fd0')
    # courtyard stalls, front stalls
    b.section('stalls')
    cols_u = stall_cols(brief, style, srng)
    nst = int(U.clamp(U.fcount(fs, 'stalls', 14), 6, 40))
    if kind in ('ring', 'U') and det < 2:
        if kind == 'ring':
            cw, cd = W * 0.5, D * 0.5
            stalls_in(b, F0, -cw / 2 + 2, -cd / 2 + 2, cw / 2 - 2, cd / 2 - 2, srng, cols_u, nst)
        else:
            stalls_in(b, F0, x0 + W * 0.3, y1 - D * 0.5, x1 - W * 0.3, y1 - 2, srng, cols_u, nst)
    elif det < 2:
        stalls_in(b, F0, x0 + 4, y0 - 7.5, x1 - 4, y0 - 2.0, srng, cols_u, int(nst * 0.6), pitch=(3.4, 3.0))
    if 'minaret' in fs or U.has(txt, 'mosque'):
        mosque_beside(b, lk, srng, x1 + 9, y0 + 3)
    return {'front': y0, 'back': y1, 'wx': W}


# ------------------------------------------------------------------------------------------------------------------ shedhall
def build_shedhall(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    roof_form = fm['roof'] if fm['roof'] in ('gable', 'barrel', 'sawtooth', 'shed', 'flat', 'hip') else 'gable'
    hw = U.clamp(fm['H'] * 0.45 if fm['H'] > 0 else 5.0, 4.4, 6.5)
    nave_w = D * 0.54
    aw = (D - nave_w) / 2
    z_hi = hw + 1.5
    z_cl = z_hi + 2.0
    rise = nave_w * 0.2
    F = U.Frame(0, 0, 0)
    pal = U.palette(brief, style, lk, srng)
    acc = U.accent_cols(brief, style, srng)
    wc = lk.wall_col
    ws = lk.wall_slot
    roof_col = lk.roof_col
    cols_u = stall_cols(brief, style, srng)
    b.section('walls')
    # front wall: shops + entrance
    front = lib.Seg((-W / 2, -D / 2), (W / 2, -D / 2))
    U.shop_facade(b, front, 0, 1, hw, hw, lk, srng, kind='mixed', cols=pal, accents=acc, unit_w=4.2, wall_slot=ws, wall_col=wc, awn_p=0.3 if 'awning' in fs else 0.0, arcade='arcade' in fs)
    U.entrance_bay(b, front, W * srng.uniform(0.35, 0.65), min(14.0, W * 0.2), 0, hw, 1.4, lk, srng, col=lib.shade(wc, 1.08), sign_col=lib.shade(srng.choice(acc), 0.8), arch=False)
    # rear wall: windows, reduced
    lib.facade(b, lib.Seg((W / 2, D / 2), (-W / 2, D / 2)), 0, hw, 1, lk, 'arched' if lk.windows in ('arched', 'punched', 'none') else lk.windows, 0.3, srng, U.bay(4.8), reduced=True, wall_slot=ws, wall_col=wc)
    # gable end walls (profile in y,z), with a big gate and blank sign board
    prof = [(-D / 2, 0), (D / 2, 0), (D / 2, hw)]
    if roof_form in ('gable', 'barrel', 'hip', 'flat'):
        prof += [(nave_w / 2, z_hi), (nave_w / 2, z_cl)]
        top_pts = {'gable': [(0, z_cl + rise)], 'hip': [(0, z_cl + rise * 0.8)], 'barrel': [(nave_w * 0.25, z_cl + rise * 0.7), (0, z_cl + rise), (-nave_w * 0.25, z_cl + rise * 0.7)], 'flat': [(nave_w / 2, z_cl + 0.4), (-nave_w / 2, z_cl + 0.4)]}[roof_form]
        prof += top_pts
        prof += [(-nave_w / 2, z_cl), (-nave_w / 2, z_hi), (-D / 2, hw)]
    elif roof_form == 'shed':
        rr = D * 0.16
        prof = [(-D / 2, 0), (D / 2, 0), (D / 2, hw + rr), (-D / 2, hw)]
    else:  # sawtooth: flat-topped end wall
        prof = [(-D / 2, 0), (D / 2, 0), (D / 2, hw), (-D / 2, hw)]
    for sx, hint in ((-W / 2, (-1, 0, 0)), (W / 2, (1, 0, 0))):
        pts = [(sx, y, z) for (y, z) in prof]
        b.facing(pts, hint, ws, lib.shade(wc, 0.97), scale=3.0 if det else 2.0)
        if det < 2:
            sgn = -1 if sx < 0 else 1
            # gate: big dark opening and a blank board above
            gw, gz = nave_w * 0.55, hw * 0.78
            b.facing([(sx + sgn * 0.03, -gw / 2, 0), (sx + sgn * 0.03, gw / 2, 0), (sx + sgn * 0.03, gw / 2, gz), (sx + sgn * 0.03, -gw / 2, gz)], (sgn, 0, 0), 'glass-punched', '#3c3a38', mode='fit')
            if det == 0:
                b.facing([(sx + sgn * 0.05, -gw * 0.45, gz + 0.5), (sx + sgn * 0.05, gw * 0.45, gz + 0.5), (sx + sgn * 0.05, gw * 0.45, gz + 1.7), (sx + sgn * 0.05, -gw * 0.45, gz + 1.7)], (sgn, 0, 0), 'plain', lib.shade(srng.choice(acc), 0.8))
    # roofs
    b.section('roof')
    ov = 0.8
    if roof_form in ('gable', 'hip', 'flat', 'barrel'):
        for sgn in (-1, 1):
            # aisle lean-to rising towards the nave
            ya, yb = (-D / 2, -nave_w / 2) if sgn < 0 else (nave_w / 2, D / 2)
            F.roof(b, 'shed', -W / 2, ya, W / 2, yb, hw, z_hi - hw, ov, 'metal-roof' if lk.roof_slot != 'corrugated' else 'corrugated', roof_col, ws, wc, high='back' if sgn < 0 else 'front', infill=False, ov_front=ov)
            # clerestory glazing on the nave wall
            ycl = sgn * nave_w / 2
            b.facing([(-W / 2, ycl, z_hi), (W / 2, ycl, z_hi), (W / 2, ycl, z_cl), (-W / 2, ycl, z_cl)], (0, sgn, 0), 'glass-ribbon', '#cfd8dd', mode='tile', scale=3.0) if det < 2 else \
                b.facing([(-W / 2, ycl, z_hi), (W / 2, ycl, z_hi), (W / 2, ycl, z_cl), (-W / 2, ycl, z_cl)], (0, sgn, 0), 'plain', lib.shade(wc, 0.6))
        nr = (-W / 2 - 0.4, -nave_w / 2, W / 2 + 0.4, nave_w / 2)
        if roof_form == 'gable':
            F.roof(b, 'gable', *nr, z_cl, rise, 0.5, 'metal-roof', roof_col, ws, wc, ov_front=0.6, th=0.12, infill=False)
        elif roof_form == 'hip':
            F.roof(b, 'hip', *nr, z_cl, rise * 0.8, 0.5, 'metal-roof', roof_col, ws, wc, ov_front=0.6)
        elif roof_form == 'barrel':
            lib.barrel(b, nr, z_cl, rise, lk, axis='x', ov=0.0, slot='metal-roof', col=roof_col)
        else:
            F.roof(b, 'flat', nr[0], nr[1], nr[2], nr[3], z_cl, 0, 0.6, 'metal-roof', roof_col, ws, wc, parapet=0.5)
    elif roof_form == 'shed':
        rr = D * 0.16
        F.roof(b, 'shed', -W / 2, -D / 2, W / 2, D / 2, hw, rr, 0.8, 'metal-roof', roof_col, ws, wc, high='back', ov_front=1.2, infill=False)
    else:
        teeth = int(U.clamp(W / 11, 4, 9))
        lib.sawtooth(b, (-W / 2, -D / 2, W / 2, D / 2), hw, 2.8, lk, teeth=teeth, axis='x', glaze='back', slot='metal-roof', col=roof_col)
    # side lean-to fascia posts (colonnade on the long side walls)
    # exterior stalls in front and loading bays
    b.section('stalls')
    nst = int(U.clamp(U.fcount(fs, 'stalls', 14), 6, 30))
    stalls_in(b, F, -W / 2 + 4, -D / 2 - 9.0, W / 2 - 4, -D / 2 - 3.0, srng, cols_u, nst, pitch=(3.6, 3.0))
    if 'solar-panels' in fs and det == 0 and roof_form in ('gable',):
        for sgn in (-1,):
            b.facing([(-W * 0.3, -nave_w / 2 + 0.5, z_cl + 0.3), (W * 0.3, -nave_w / 2 + 0.5, z_cl + 0.3), (W * 0.3, -0.5, z_cl + rise - 0.3), (-W * 0.3, -0.5, z_cl + rise - 0.3)], (0, -0.5, 1), 'glass-ribbon', '#8fa3b5', mode='tile')
    if 'minaret' in fs or U.has(txt, 'mosque'):
        mosque_beside(b, lk, srng, W / 2 + 9, -D / 2 + 3)
    return {'front': -D / 2, 'back': D / 2}


# ------------------------------------------------------------------------------------------------------------------ ironhall
def build_ironhall(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    st = str(brief.get('style') or '')
    small = fm['S'] <= 1 or W < 62
    fdep = 9.0 if not small else 7.0
    fH = 11.5 if not small else 6.8
    fS = 2 if not small else 1
    hall_d = D - fdep
    hall_h = 8.0 if not small else 5.6
    wc = lk.wall_col
    ws = lk.wall_slot
    F = U.Frame(0, 0, 0)
    acc = U.accent_cols(brief, style, srng)
    glass_col = '#a9c0cb'
    # front block
    b.section('front')
    fy0, fy1 = -D / 2, -D / 2 + fdep
    fp = lib.fp_rect(W, fdep, 0, (fy0 + fy1) / 2)
    lib.walls(b, fp, 0, fH, fS, lk, srng, kind='arched' if (not small or lk.windows == 'arched') else 'punched', front_kind='arched', rear='same', ratio=0.5, bay=U.bay(4.6), plinth=0.7, wall_slot=ws, wall_col=wc)
    lib.cornice(b, fp, fH - 0.35, 0.6, 0.5, lk, col=lib.shade(wc, 1.12))
    # corner pavilions (pyramid roofs) and central pavilion
    pw = 11.0 if not small else 8.0
    for sx in (-1, 1):
        cx = sx * (W / 2 - pw / 2)
        pr = (cx - pw / 2, fy0 - 0.5, cx + pw / 2, fy1)
        U.Frame(0, 0, 0).box(b, pr[0], pr[1], 0, pr[2], pr[1] + 0.6, fH + 1.2, ws, lib.shade(wc, 1.08), ws, lib.shade(wc, 1.08), skip=('bottom', 'top', 'back')) if det < 2 else None
        lib.hip(b, (pr[0] - 0.4, pr[1] - 0.4, pr[2] + 0.4, pr[3]), fH + (1.2 if det < 2 else 0), 3.8 if not small else 2.4, lk, ov=0.0)
    # main entrance pavilion
    ew = W * (0.22 if not small else 0.26)
    ew = U.clamp(ew, 12, 22)
    eh = fH + (4.0 if not small else 2.6)
    F.box(b, -ew / 2, fy0 - 2.2, 0, ew / 2, fy1, eh, ws, lib.shade(wc, 1.06), skip=('bottom', 'top'))
    if det < 2:
        sg = lib.Seg((-ew / 2, fy0 - 2.2), (ew / 2, fy0 - 2.2))
        U.arch_door(b, sg, ew / 2, ew * 0.5, eh * 0.62, 0.0, '#3c3a38', depth=0.04)
        if det == 0:
            lib.seg_box(b, sg, ew * 0.2, ew * 0.8, eh * 0.62 + 1.0, eh * 0.62 + 2.4, 0.1, lib.shade(srng.choice(acc), 0.8), 'plain', inset=0.0)
            lib.seg_box(b, sg, -0.05, ew + 0.05, eh - 0.5, eh, 0.35, lib.shade(wc, 1.14), ws)
    if 'clock-tower' in fs:
        lib.tower(b, 0, fy0 + fdep * 0.45, eh, 5.0, 5.0, 8.0, lk, windows='arched', cap='hip', cap_rise=5.5, ratio=0.4, wall_slot=ws, wall_col=lib.shade(wc, 1.06))
        if det == 0:
            for sgn in (-1, 1):
                b.facing([(-1.1, fy0 + fdep * 0.45 + sgn * 2.55, eh + 5.3), (1.1, fy0 + fdep * 0.45 + sgn * 2.55, eh + 5.3), (1.1, fy0 + fdep * 0.45 + sgn * 2.55, eh + 7.2), (-1.1, fy0 + fdep * 0.45 + sgn * 2.55, eh + 7.2)], (0, sgn, 0), 'plain', '#f1ede0')
    elif det < 2:
        lib.roof(b, 'gable', (-ew / 2 - 0.2, fy0 - 2.2, ew / 2 + 0.2, fy1), eh, lk, rise=ew * 0.22, ov=0.4, axis='y', gable_slot=ws, gable_col=lib.shade(wc, 1.14))
    else:
        lib.roof(b, 'gable', (-ew / 2, fy0 - 2.2, ew / 2, fy1), eh, lk, rise=ew * 0.22, ov=0.2, axis='y')
    # main block roof (between the pavilions)
    lib.roof(b, 'hip' if small else 'gable', (-W / 2 + pw, fy0, W / 2 - pw, fy1), fH, lk, rise=2.6 if small else 3.0, ov=0.4, **({} if small else {'axis': 'x'}))
    # hall behind
    b.section('hall')
    hy0, hy1 = fy1, D / 2
    hfp = lib.fp_rect(W, hy1 - hy0, 0, (hy0 + hy1) / 2)
    lib.walls(b, hfp, 0, hall_h, 1, lk, srng, kind='arched', front_kind='arched', rear='same', ratio=0.55, bay=U.bay(5.2), plinth=0.5, wall_slot=ws, wall_col=lib.shade(wc, 0.97), edges=[s for s in hfp.edges() if not s.front])
    nb = int(U.clamp(round(W / 17), 2, 6)) if not small else int(U.clamp(round(W / 22), 2, 3))
    bw = W / nb
    for i in range(nb):
        xa, xb = -W / 2 + i * bw, -W / 2 + (i + 1) * bw
        rise = bw * 0.28
        F.roof(b, 'gable', xa, hy0, xb, hy1, hall_h, rise, 0.0 if i not in (0, nb - 1) else 0.4, 'glass-ribbon', glass_col, ws, wc, ridge='y', ov_front=0.4, th=0.0, infill=False)
        if det == 0:
            # iron ribs along the ridge and valleys
            lib.beam(b, (xa + bw / 2, hy0), (xa + bw / 2, hy1), hall_h + rise, hall_h + rise + 0.18, 0.2, 'plain', '#4a4f54', skip=('bottom',))
        # gable ends facing front (hidden by the front block) and rear: fill rear end triangles
        F.face(b, [(xa, hy1, hall_h), (xb, hy1, hall_h), ((xa + xb) / 2, hy1, hall_h + rise)], (0, 1, 0), ws, lib.shade(wc, 0.97))
    if 'colonnade' in fs or 'arcade' in fs or small:
        # verandah colonnade along the long sides / front
        n = int(W / 5.0)
        if det < 2:
            for k in range(n + 1):
                x = -W / 2 + W * k / n
                lib.column(b, x, -D / 2 - 2.6, 0, 3.8 if small else 4.2, 0.22, lk, 'square', False, slot=ws, col=lib.shade(wc, 1.05))
            vz = 3.8 if small else 4.2
            F.box(b, -W / 2, -D / 2 - 2.9, vz, W / 2, -D / 2, vz + 0.4, ws, lib.shade(wc, 1.1), 'roof-flat', lk.roof_col, skip=('bottom',))
    # stalls out front
    b.section('stalls')
    cols_u = stall_cols(brief, style, srng)
    stalls_in(b, F, -W / 2 + 6, -D / 2 - 11.0, W / 2 - 6, -D / 2 - 4.0, srng, cols_u, int(U.clamp(U.fcount(fs, 'stalls', 10), 4, 20)), pitch=(3.6, 3.0))
    if 'statue' in fs and det < 2:
        U.statue(b, 0, -D / 2 - 7, srng)
    if 'fountain' in fs and det < 2:
        pass
    if 'minaret' in fs:
        mosque_beside(b, lk, srng, W / 2 + 9, -D / 2 + 3)
    return {'front': -D / 2 - 2.5, 'back': D / 2}


# ------------------------------------------------------------------------------------------------------------------ souk
def build_souk(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    ring = fm['fp'] == 'ring' or 'courtyard' in fs
    h = U.clamp(fm['H'] * 0.7 if fm['H'] > 0 else 6.0, 5.0, 8.0)
    wc = lk.wall_col
    ws = lk.wall_slot if lk.wall_slot not in ('metal-cladding', 'timber') else 'plain-render'
    F = U.Frame(0, 0, 0)
    fp = lib.fp_ring(W, D, W * 0.46, D * 0.4) if ring else lib.fp_rect(W, D)
    b.section('walls')
    for pi, poly in enumerate(fp.polys):
        m = len(poly)
        for i, p in enumerate(poly):
            q = poly[(i + 1) % m]
            if math.dist(p, q) < 0.5:
                continue
            sg = lib.Seg(p, q)
            lib.facade(b, sg, 0, h, 1, lk, 'pointed-arch' if lk.windows == 'pointed-arch' or str(brief.get('style')) in ('ottoman', 'persian', 'mughal') else 'arched', 0.5, srng, U.bay(4.2),
                       reduced=(sg.rear and pi == 0), wall_slot=ws, wall_col=wc)
    lib.cornice(b, fp, h - 0.3, 0.5, 0.35, lk, col=lib.shade(wc, 1.1))
    # vaulted roofs
    b.section('roof')
    rcol = lk.roof_col
    rslot = lk.roof_slot if lk.roof_slot != 'corrugated' else 'plain-render'
    if ring:
        # four vaulted ranges round the courtyard
        cw, cd = W * 0.46, D * 0.4
        rects = [(-W / 2, -D / 2, W / 2, -cd / 2), (-W / 2, cd / 2, W / 2, D / 2), (-W / 2, -cd / 2, -cw / 2, cd / 2), (cw / 2, -cd / 2, W / 2, cd / 2)]
        axes = ['x', 'x', 'y', 'y']
    else:
        nv = int(U.clamp(round(D / 9.0), 2, 6))
        vd = D / nv
        rects = [(-W / 2, -D / 2 + i * vd, W / 2, -D / 2 + (i + 1) * vd) for i in range(nv)]
        axes = ['x'] * nv
    for rc, ax in zip(rects, axes):
        lib.barrel(b, rc, h, 3.0, lk, axis=ax, ov=0.0, slot=rslot, col=lib.jitter(rcol, srng, 0.05), end_slot=ws, end_col=wc, pointed=False)
        if det < 2:
            # lantern domes along each vault
            L = (rc[2] - rc[0]) if ax == 'x' else (rc[3] - rc[1])
            n = int(L / 15.0)
            for k in range(n):
                t = (k + 0.5) / n
                cx = rc[0] + (rc[2] - rc[0]) * t if ax == 'x' else (rc[0] + rc[2]) / 2
                cy = (rc[1] + rc[3]) / 2 if ax == 'x' else rc[1] + (rc[3] - rc[1]) * t
                lib.dome(b, cx, cy, h + 2.4, 1.7, lk, profile='hemi', slot=rslot, col=lib.shade(rcol, 1.08), drum=0.9 if det == 0 else 0.0, drum_col=lib.shade(wc, 1.05), lantern=0.0, finial=0.0, n=10 if det == 0 else 6, rings=3 if det == 0 else 2)
    # central domed hall for large souks
    if ('dome' in fs or W > 60) and not ring and det < 3:
        r = U.clamp(min(W, D) * 0.1, 3.5, 7.0)
        lib.dome(b, 0, 0, h + 3.0, r, lk, profile='pointed' if str(brief.get('style')) in ('persian', 'mughal', 'ottoman') else 'hemi', slot=rslot, col=lib.shade(rcol, 1.1),
                 drum=2.0 if det < 2 else 0.0, drum_r=r * 1.02, drum_col=lib.shade(wc, 1.05), lantern=1.2 if det == 0 else 0.0, finial=1.2 if det == 0 else 0.0)
    # portal gate on the front
    b.section('portal')
    pwid = U.clamp(W * 0.16, 8.0, 14.0)
    ph = h + 4.5
    sg = lib.Seg((-W / 2, -D / 2), (W / 2, -D / 2))
    lib.seg_box(b, sg, W / 2 - pwid / 2, W / 2 + pwid / 2, 0, ph, 1.4, lib.shade(wc, 1.08), ws, inset=0.0)
    if det < 2:
        U.arch_door(b, sg, W / 2, pwid * 0.58, ph * 0.62, 0.0, '#3a3836', depth=1.44)
        if det == 0:
            lib.seg_box(b, sg, W / 2 - pwid / 2 - 0.1, W / 2 + pwid / 2 + 0.1, ph - 0.5, ph, 1.7, lib.shade(wc, 1.16), ws)
            for sx in (-1, 1):   # slender turrets flanking the portal
                lib.cylinder(b, W / 2 + sx * (pwid / 2 + 0.2), -D / 2 - 0.6, ph - 0.5, ph + 3.0, 0.45, n=8, slot=ws, col=lib.shade(wc, 1.1), r_top=0.0, top=False, smooth=False)
    if 'minaret' in fs or U.has(txt, 'mosque', 'minaret'):
        mx, my = -W / 2 - 3.5, -D / 2 + 3
        n = 10 if det == 0 else 6
        lib.cylinder(b, mx, my, 0, 19.0, 1.1, n=n, slot=ws, col=lib.shade(wc, 1.08), r_top=0.85, top=False, smooth=False)
        if det < 2:
            lib.cylinder(b, mx, my, 19.0, 19.4, 1.6, n=n, slot=ws, col=lib.shade(wc, 1.0), top=True, smooth=False)
            lib.cylinder(b, mx, my, 19.4, 22.0, 0.8, n=n, slot=ws, col=lib.shade(wc, 1.08), r_top=0.7, top=False, smooth=False)
            lib.cylinder(b, mx, my, 22.0, 25.5, 0.85, n=n, slot=rslot, col=lib.shade(rcol, 1.05), r_top=0.0, top=False, smooth=False)
    if ring and det < 2:
        cols_u = stall_cols(brief, style, srng)
        stalls_in(b, F, -W * 0.46 / 2 + 2, -D * 0.4 / 2 + 2, W * 0.46 / 2 - 2, D * 0.4 / 2 - 2, srng, cols_u, int(U.clamp(U.fcount(fs, 'stalls', 10), 4, 18)))
    b.section('stalls')
    cols_u = stall_cols(brief, style, srng)
    stalls_in(b, F, -W / 2 + 4, -D / 2 - 9.0, W / 2 - 4, -D / 2 - 3.0, srng, cols_u, int(U.clamp(U.fcount(fs, 'stalls', 10), 4, 20)), pitch=(3.6, 3.0))
    return {'front': -D / 2, 'back': D / 2}


# ------------------------------------------------------------------------------------------------------------------ build
def build(brief, style, rng, detail):
    seed = rng.getrandbits(64)
    return U.governed(lambda: _build(brief, style, random.Random(seed), detail), detail)


def _build(brief, style, rng, detail):
    b = lib.Builder('market-hall', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    fm = U.form(brief)
    fs = U.feats(brief)
    txt = U.text(brief)
    typ = infer(brief, fm, fs, txt)
    W = U.clamp(fm['W'], 36, 100)
    D = U.clamp(fm['D'], 24, 72)
    if typ == 'shedhall':
        W, D = U.clamp(fm['W'], 50, 100), U.clamp(fm['D'], 30, 70)
    if typ == 'ironhall':
        W, D = U.clamp(fm['W'], 44, 92), U.clamp(fm['D'], 32, 64)
    if typ == 'souk':
        W, D = U.clamp(fm['W'], 40, 90), U.clamp(fm['D'], 28, 60)
    fn = {'complex': build_complex, 'shedhall': build_shedhall, 'ironhall': build_ironhall, 'souk': build_souk}[typ]
    info = fn(b, brief, style, lk, fm, fs, txt, srng, W, D)
    b.section('ground')
    fy = info['front']
    x1 = W / 2 + 14 if ('minaret' in fs or U.has(txt, 'mosque')) else W / 2 + 6
    U.commerce_site(b, lk, srng, fs, brief, -(W / 2 + 6), x1, fy, info['back'] + 5, trees=5, depth_front=21.0 if typ != 'complex' else 20.0)
    if 'sheds' in fs and detail < 2:
        for k in range(2):
            U.shed_over_goods(b, U.Frame(-W * 0.25 + k * W * 0.5, fy - 13.0, 0), 12, 5.5, 3.2, lk, srng, roof='shed', roof_col=lk.roof_col, post_pitch=4.0, wall_col=lk.wall_col,
                              goods=['#cfc3a0'], rise=0.9)
    if 'fence-wall' in fs:
        px = W / 2 + 4.0
        U.fence_wall(b, [(-px, fy - 17.0), (-px, info['back'] + 3.0), (px, info['back'] + 3.0), (px, fy - 17.0)], 1.8, 0.35, lk, lib.shade(lk.wall_col, 0.95), lk.wall_slot if lk.wall_slot not in ('brick', 'timber') else 'plain-render')
    if 'kiosk' in fs and detail < 2:
        cols = U.accent_cols(brief, style, srng)
        for sx in (-W * 0.34,):
            c = srng.choice(cols)
            with b.site():
                F = U.Frame(sx, fy - 11.5, 0)
                F.box(b, -1.2, 0, 0, 1.2, 2.2, 2.5, 'plain-render', c, 'roof-flat', '#8a8f94', skip=('bottom',))
    return b.objects()
