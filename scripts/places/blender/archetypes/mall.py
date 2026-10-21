"""mall: shopping malls and retail centres. Typologies chosen from the brief (style, windows/material, storeys, roof, footprint, features):

  glass     glass-curtain or curtain-glazed mall (Gulf / Asian high-end look, Accra Mall, Cap Nord): fully glazed upper floors, glass
            atrium roof strip, a glazed drum or gabled glass entrance, fins and blank sign panels.
  box       the big painted retail box (Palms, Marina, Playce): glazed ground-floor shop strip, ribbon or screen upper floors, coloured
            panels, flat canopy entrance with a signage tower or a glazed drum, rooftop plant, big car park.
  pomo      postmodern / Mediterranean shopping centre (Polygone, London retail): pitched hip roofs, arched upper windows, arcaded
            ground floor, pediment over the entrance, L or rect plan.
  stack     compact vertical centre (4+ storeys, narrow plan): two-floor podium with a glazed tower slab above.
Common: entrance forms (drum / glass gable / canopy + tower / curved corner), roof terrace, car park with bays, trees, flags, fountain
plaza, kiosk, blank sign pylons, neon strips.
Layout: centred on x = 0, main frontage towards -Y, car park in front (site layer).
"""
import copy
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _market_open_util as U  # noqa: E402

import lib  # noqa: E402

FEATURES = {'car-park', 'signage-board', 'awning', 'flags', 'atrium-glass', 'roof-terrace', 'flat-canopy', 'arcade', 'umbrellas', 'neon-strip',
            'shopfront', 'balcony-bands', 'fountain', 'kiosk', 'steps', 'solar-panels', 'brise-soleil', 'curved-canopy', 'colonnade', 'pediment',
            'water-tank', 'floodlights', 'mast', 'podium', 'louvres', 'clock-tower'}


def infer(brief, fm, fs, txt, lk):
    st = str(brief.get('style') or '')
    if fm['S'] >= 4 and fm['W'] <= 90:
        return 'stack'
    if st in ('postmodern', 'georgian', 'victorian', 'neoclassical', 'art-deco', 'tudor') or fm['roof'] in ('hip', 'gable', 'mansard') or fm['fp'] in ('L', 'U'):
        return 'pomo'
    if lk.wall_material == 'glass-curtain' or lk.windows == 'curtain' or st in ('high-tech', 'international') or 'atrium-glass' in fs and lk.windows != 'ribbon':
        return 'glass'
    return 'box'


def upper_kind(lk, typ, fs):
    k = lk.windows
    if typ == 'glass':
        return 'curtain'
    if typ == 'pomo':
        return 'arched' if k in ('none', 'arched', 'pointed-arch') else 'punched'
    if 'louvres' in fs or k == 'louvre':
        return 'louvre'
    if k in ('none', None):
        return 'screen'
    if k in ('ribbon', 'punched', 'screen', 'curtain', 'arched'):
        return k
    return 'ribbon'


def drum_entrance(b, lk, srng, cx, cy, r, h, glass, cap_col, frame_col):
    """A glazed cylinder with a flat disc cap, mullion rings and a canopy ring at the foot."""
    n = 18 if b.detail == 0 else 10
    lib.cylinder(b, cx, cy, 0, h, r, n=n, slot='glass-curtain', col=glass, top=False, smooth=False)
    if b.detail < 2:
        lib.cylinder(b, cx, cy, h, h + 0.8, r + 0.5, n=n, slot='plain-render', col=cap_col, r_top=r + 0.3, top=True, smooth=False)
        if b.detail == 0:
            for k in range(0, n, 2):
                a = 2 * math.pi * k / n
                lib.cylinder(b, cx + math.cos(a) * (r + 0.05), cy + math.sin(a) * (r + 0.05), 0, h, 0.1, n=3, slot='frame', col=frame_col, top=False, smooth=False)
            lib.cylinder(b, cx, cy, 4.6, 4.9, r + 2.2, n=n, slot='plain-render', col=lib.shade(cap_col, 0.9), r_top=r + 2.2, top=True, smooth=False)


def glass_gable_entrance(b, lk, srng, cx, y_front, w, d, h, rise, glass, frame_col, roof_col):
    """A gable-ended glass hall projecting from the front wall: two sloping glazed planes and a glazed front triangle."""
    x0, x1 = cx - w / 2, cx + w / 2
    ym = y_front - d
    pts_front = [(x0, ym, 0), (x1, ym, 0), (x1, ym, h), (cx, ym, h + rise), (x0, ym, h)]
    b.facing(pts_front, (0, -1, 0), 'glass-curtain', glass, mode='fit')
    # roof planes along y: ridge on the axis x = cx? no: ridge runs front to back, so the two planes slope left and right
    for s_, (xa, hint) in enumerate(((x0, (-0.4, 0, 1)), (x1, (0.4, 0, 1)))):
        pl = [(xa, ym, h), (cx, ym, h + rise), (cx, y_front, h + rise), (xa, y_front, h)]
        b.facing(pl, hint, 'glass-curtain', glass, mode='fit')
    for sx, hint in ((x0, (-1, 0, 0)), (x1, (1, 0, 0))):
        b.facing([(sx, ym, 0), (sx, y_front, 0), (sx, y_front, h), (sx, ym, h)], hint, 'glass-curtain', glass, mode='fit')
    if b.detail == 0:
        for k in range(5):
            x = x0 + w * k / 4
            lib.box_c(b, x, ym - 0.06, 0, 0.18, 0.14, h + rise * (1 - abs(2 * k / 4 - 1)), 'frame', frame_col)
        lib.beam(b, (x0, ym - 0.05), (x1, ym - 0.05), h - 0.2, h + 0.05, 0.22, 'plain', roof_col)


def flat_canopy_tower(b, lk, srng, cx, y_front, w, d, z, sign_col, tower_x, tower_h):
    lib.canopy_flat(b, cx - w / 2, y_front - d, cx + w / 2, y_front, z, lk, th=0.6, columns=int(max(3, w / 7)), col=lk.roof_col, edge_col=lib.shade(lk.accent_col, 1.0), r=0.3)
    # sign tower beside the entrance with a blank panel
    lib.box_c(b, tower_x, y_front - 1.2, 0, 3.6, 3.0, tower_h, lk.wall_slot, lib.shade(lk.trim_col, 1.0), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    if b.detail < 2:
        lib.box_c(b, tower_x, y_front - 2.8, tower_h * 0.55, 3.0, 0.2, tower_h * 0.38, 'plain', sign_col, skip=('bottom',))


def fountain(b, x, y, r=3.8):
    if b.detail >= 2:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, 0.55, r, n=14 if b.detail == 0 else 8, slot='stone-blocks', col='#c8c4ba', top=False, smooth=False)
        b.facing([(x + r * math.cos(2 * math.pi * k / (14 if b.detail == 0 else 8)), y + r * math.sin(2 * math.pi * k / (14 if b.detail == 0 else 8)), 0.55) for k in range(14 if b.detail == 0 else 8)], (0, 0, 1), 'stone-blocks', '#c8c4ba')
        lib.cylinder(b, x, y, 0.15, 0.5, r - 0.35, n=14 if b.detail == 0 else 8, slot='plain', col='#5f98b3', top=True, smooth=False)
        if b.detail == 0:
            lib.cylinder(b, x, y, 0.5, 2.2, 0.35, n=6, slot='stone-blocks', col='#c8c4ba', r_top=0.2, top=True)
            lib.cylinder(b, x, y, 2.2, 3.2, 0.5, n=8, slot='plain', col='#dff0f7', r_top=0.04, top=False, smooth=False)


def parking_deck(b, lk, srng, x0, x1, y0, y1, levels=3):
    """An open multi-storey car park: floor slabs, edge balustrade bands and corner cores."""
    if b.detail >= 2:
        lib.box_c(b, (x0 + x1) / 2, (y0 + y1) / 2, 0, x1 - x0, y1 - y0, levels * 3.0, 'plain', '#b8b6b0', top_slot='plain', top_col='#a8a6a0', skip=('bottom',))
        return
    F = U.Frame((x0 + x1) / 2, (y0 + y1) / 2, 0)
    w, d = x1 - x0, y1 - y0
    for k in range(levels):
        z = k * 3.0
        F.box(b, -w / 2, -d / 2, z, w / 2, d / 2, z + 0.35, 'rough-concrete', '#bdbab2', 'rough-concrete', '#a5a29a', skip=('bottom',))
        if b.detail == 0:
            F.box(b, -w / 2, -d / 2, z + 0.35, w / 2, -d / 2 + 0.2, z + 1.3, 'rough-concrete', '#c8c5bd', skip=('bottom', 'back'))
            F.box(b, -w / 2, d / 2 - 0.2, z + 0.35, w / 2, d / 2, z + 1.3, 'rough-concrete', '#c8c5bd', skip=('bottom', 'front'))
            for sx in (-w / 2, w / 2 - 0.5):
                for t in range(int(d / 8) + 1):
                    F.box(b, sx, -d / 2 + t * 8.0, z + 0.35, sx + 0.5, -d / 2 + t * 8.0 + 0.5, z + 3.0, 'rough-concrete', '#b0ada5', skip=('bottom',))
    F.box(b, -w / 2, -d / 2, levels * 3.0, w / 2, d / 2, levels * 3.0 + 0.3, 'rough-concrete', '#a5a29a', skip=('bottom',))


def build(brief, style, rng, detail):
    seed = rng.getrandbits(64)
    return U.governed(lambda: _build(brief, style, random.Random(seed), detail), detail)


def _build(brief, style, rng, detail):
    b = lib.Builder('mall', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    fm = U.form(brief)
    fs = U.feats(brief)
    txt = U.text(brief)
    typ = infer(brief, fm, fs, txt, lk)
    det = detail
    W = U.clamp(fm['W'], 44, 112)
    D = U.clamp(fm['D'], 26, 60)
    S = int(U.clamp(fm['S'], 2, 6))
    gh = 5.4 if typ != 'stack' else 4.6
    fh = max(4.0, (fm['H'] - gh) / (S - 1)) if fm['H'] > 8 else 4.6
    fh = U.clamp(fh, 3.6, 5.0)
    H = gh + fh * (S - 1)
    acc = U.accent_cols(brief, style, srng)
    pal = U.palette(brief, style, lk, srng)
    wc = lk.wall_col
    ws = lk.wall_slot
    if typ == 'glass':
        ws = 'plain-render' if lk.wall_slot == 'metal-cladding' else lk.wall_slot
    glass = '#dfe9ef'
    F0 = U.Frame(0, 0, 0)
    lkr = copy.copy(lk)
    if lk.wall_slot in ('brick', 'timber'):
        lkr.wall_slot = 'plain-render'
    kind = fm['fp'] if fm['fp'] in ('rect', 'L', 'U') else ('L' if fm['fp'] == 'irregular' else 'rect')
    if typ == 'stack':
        kind = 'rect'
    fp = lib.footprint(kind, W, D, srng, det)
    ukind = upper_kind(lk, typ, fs)
    arcade = 'arcade' in fs or 'colonnade' in fs or typ == 'pomo'
    b.section('walls')
    front_segs = []
    podium_S = 2 if typ == 'stack' else S
    for pi, poly in enumerate(fp.polys):
        m = len(poly)
        for i, p in enumerate(poly):
            q = poly[(i + 1) % m]
            if math.dist(p, q) < 0.5:
                continue
            seg = lib.Seg(p, q)
            front = seg.front
            side = abs(seg.n[0]) > 0.5
            shops = front or (side and srng.random() < 0.0)
            kw = dict(kind='glass', cols=pal, accents=acc, unit_w=5.4, wall_slot=ws, wall_col=wc, windows=ukind, ratio=0.5 if typ == 'glass' else max(0.3, lk.ratio),
                      gallery='balcony-bands' in fs and front, awn_p=0.35 if 'awning' in fs else 0.0, arcade=arcade and front, reduced=not front, bay=3.0 if ukind == 'curtain' else 3.6,
                      accent_band=lib.shade(acc[0], 1.0) if typ != 'glass' else None)
            U.shop_facade(b, seg, 0, podium_S, gh, fh if typ != 'stack' else 4.4, lk, srng, ground_shops=front, **kw)
            if front:
                front_segs.append(seg)
    zH = gh + (fh if typ != 'stack' else 4.4) * (podium_S - 1)
    # tower slab for 'stack'
    b.section('roof')
    x0, y0, x1, y1 = fp.bbox
    if typ == 'stack':
        tw, td = W * 0.6, D * 0.72
        tfp = lib.fp_rect(tw, td, -W * 0.08, 0.5)
        th = gh + 4.4 + fh * (S - podium_S)
        lib.roof(b, 'flat', fp, zH, lkr, parapet_h=0.9, ov=0.0, slab=0.0)
        for seg in tfp.edges():
            U.shop_facade(b, seg, zH, S - podium_S, 0.01 + fh, fh, lk, srng, ground_shops=False, wall_slot='plain-render', wall_col=lib.shade(wc, 1.0), windows='curtain', ratio=0.6, bay=3.0, reduced=not seg.front)
        lib.roof(b, 'flat', tfp, zH + fh * (S - podium_S), lkr, parapet_h=1.0, ov=0.0, slab=0.0)
        U.roof_extras(b, F0, -W * 0.08 - tw / 2 + 2, 0.5 - td / 2 + 2, -W * 0.08 + tw / 2 - 2, 0.5 + td / 2 - 2, zH + fh * (S - podium_S), srng, lk, cores=1, tanks=1, plant=2, rebar=False)
        if 'mast' in fs and det < 2:
            lib.cylinder(b, -W * 0.08, 0.5, zH + fh * (S - podium_S), zH + fh * (S - podium_S) + 14, 0.25, n=5, slot='frame', col='#c9ccd0', r_top=0.08, top=True)
        if det < 2 and 'roof-terrace' in fs:
            pass
        H = th
    elif typ == 'pomo':
        rf = fm['roof'] if fm['roof'] in ('hip', 'gable', 'mansard') else 'hip'
        U.roof_over_rects(b, F0, fp.rects, 'hip' if rf != 'gable' else 'gable', H, lambda w, d: min(w, d) / 2 * 0.36, lkr, 1.0, wall_slot='plain-render')
        lib.cornice(b, fp, H - 0.3, 0.6, 0.45, lkr)
    else:
        lib.roof(b, 'flat', fp, H, lkr, parapet_h=1.3, ov=0.0, slab=0.0)
        lib.cornice(b, fp, H - 0.3, 0.5, 0.35, lkr) if det == 0 else None
        for r in fp.rects:
            U.roof_extras(b, F0, r[0] + 3, r[1] + 3, r[2] - 3, r[3] - 3, H, srng, lk, cores=1, tanks=1 if 'water-tank' in fs else 0, plant=4, rebar=False)
        if 'atrium-glass' in fs or typ == 'glass':
            aw = min(W * 0.6, 60)
            rect = (-aw / 2, y0 + D * 0.3, aw / 2, y1 - D * 0.3)
            if rect[3] - rect[1] > 6:
                lib.barrel(b, rect, H + 0.2, 2.2, lk, axis='x', ov=0.0, slot='glass-ribbon', col='#cfdde4', end_slot='glass-curtain', end_col='#dfe9ef')
        if 'solar-panels' in fs and det == 0:
            for r in range(3):
                yy = y0 + (y1 - y0) * (r + 1) / 5
                b.facing([(x0 + W * 0.15, yy - 1.1, H + 1.4), (x1 - W * 0.15, yy - 1.1, H + 1.4), (x1 - W * 0.15, yy + 1.1, H + 2.2), (x0 + W * 0.15, yy + 1.1, H + 2.2)], (0, -0.4, 1), 'glass-ribbon', '#8fa3b5', mode='tile')
    if 'roof-terrace' in fs and det < 2 and typ in ('box', 'glass'):
        # a terrace deck with umbrellas and a pergola at one end of the roof
        tx = x1 - W * 0.18
        F0.box(b, tx - 8, y0 + 3, H, tx + 8, y0 + 12, H + 0.15, 'timber', '#a58559', 'timber', '#b8946a')
        for k in range(3 if det == 0 else 1):
            U.umbrella(b, tx - 4 + k * 4, y0 + 7.5, 1.5, H + 2.3, srng.choice(U.UMB))
    # anchor store: a taller, forward block at one end with a big blank sign panel (box and glass malls)
    b.section('anchor')
    if typ in ('box', 'glass') and W > 60:
        sgn = srng.choice([-1, 1])
        aw = U.clamp(W * 0.2, 14, 26)
        ax = sgn * (W / 2 - aw / 2)
        ah = H + (3.2 if typ == 'box' else 2.2)
        ac = lib.shade(srng.choice(acc), 0.95) if typ == 'box' else lib.shade(wc, 0.9)
        F0.box(b, ax - aw / 2, y0 - 2.5, 0, ax + aw / 2, y0 + D * 0.62, ah, 'plain-render', ac, 'roof-flat', lk.roof_col, skip=('bottom',))
        if det < 2:
            F0.box(b, ax - aw * 0.4, y0 - 2.5 - 0.15, ah - 4.2, ax + aw * 0.4, y0 - 2.5, ah - 1.2, 'plain', lib.shade(srng.choice(acc), 0.8), skip=('bottom',))
            b.facing([(ax - 2.6, y0 - 2.52, 0), (ax + 2.6, y0 - 2.52, 0), (ax + 2.6, y0 - 2.52, 3.4), (ax - 2.6, y0 - 2.52, 3.4)], (0, -1, 0), 'glass-shopfront', '#dfe9ef', mode='fit')
    # brise-soleil fins on glass malls
    if (typ == 'glass' and srng.random() < 0.6 or 'brise-soleil' in fs) and det == 0 and front_segs:
        fsg = max(front_segs, key=lambda s: s.length)
        nfin = int(fsg.length / 3.0)
        for k in range(1, nfin):
            lib.seg_box(b, fsg, k * 3.0 - 0.05, k * 3.0 + 0.05, gh + 0.5, zH - 0.4, 0.9, lib.shade(wc, 0.85), 'plain', inset=0.0)
    # entrance features (front centre, or at the end for L plans)
    b.section('entrance')
    if front_segs:
        fs0 = max(front_segs, key=lambda s: s.length)
        mid = fs0.P(fs0.length * srng.uniform(0.42, 0.58), 0)
        ecx = mid[0]
        yf = mid[1]
        forms = ['drum', 'gable', 'canopy']
        if typ == 'glass':
            ef = srng.choice(['drum', 'gable'])
        elif typ == 'pomo':
            ef = 'pediment'
        elif typ == 'stack':
            ef = 'canopy'
        else:
            ef = 'canopy' if ('flat-canopy' in fs and srng.random() < 0.7) else srng.choice(['drum', 'gable', 'canopy'])
        if ef == 'drum':
            drum_entrance(b, lk, srng, ecx, yf - 3.5, 7.0, zH + 1.6 if typ != 'stack' else gh + 1.5, glass, lib.shade(lk.accent_col, 0.9), lk.frame_col)
        elif ef == 'gable':
            glass_gable_entrance(b, lk, srng, ecx, yf, 18.0, 10.0, gh + 1.5, 4.5, glass, lk.frame_col, lk.roof_col)
        elif ef == 'pediment':
            ew = min(20.0, fs0.length * 0.3)
            lib.seg_box(b, fs0, fs0.length * 0.5 - ew / 2, fs0.length * 0.5 + ew / 2, 0, zH + 1.6, 1.5, lib.shade(wc, 1.08), ws)
            if det < 2:
                U.arch_door(b, fs0, fs0.length * 0.5, ew * 0.5, gh * 0.9, 0.0, '#3c3a38', depth=1.54)
                lib.roof(b, 'gable', (ecx - ew / 2 - 0.2, yf - 1.5, ecx + ew / 2 + 0.2, yf + 0.4), zH + 1.6, lk, rise=ew * 0.14, ov=0.2, axis='x', gable_slot=ws, gable_col=lib.shade(wc, 1.15))
        elif 'curved-canopy' in fs:
            lib.canopy_curved(b, ecx - 12, yf - 9.0, ecx + 12, yf, 5.4, 2.2, lk, th=0.35, axis='x', columns=[(ecx - 11 + 22 * k / 3, yf - 8.0) for k in range(4)], col=lk.roof_col)
            lib.box_c(b, ecx - 17.0, yf - 1.2, 0, 3.6, 3.0, H + 4.0, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
        else:
            flat_canopy_tower(b, lk, srng, ecx, yf, 24.0, 9.0, 5.2, lib.shade(srng.choice(acc), 0.85), ecx - 17.0, H + 4.0)
        if 'neon-strip' in fs and det < 2:
            U.neon(b, (ecx - 14, yf - 0.4), (ecx + 14, yf - 0.4), min(H - 0.8, 7.5), '#7fe0ff')
        if 'signage-board' in fs and det < 2:
            for k in range(int(U.clamp(U.fcount(fs, 'signage-board', 1), 1, 3))):
                sx = x0 + W * (0.18 + 0.64 * k / max(1, U.fcount(fs, 'signage-board', 1) - 0.0))
                lib.box_c(b, sx, y0 - 0.15, H - 2.4, 9.0, 0.3, 2.0, 'plain', lib.shade(srng.choice(acc), 0.82), skip=('bottom',))
        if ('steps' in fs or 'podium' in fs) and det < 2:
            lib.steps(b, ecx - 9, ecx + 9, yf - (6.0 if ef == 'canopy' else 0.0), 1.2, 3.0, 4)
        if 'fountain' in fs:
            fountain(b, ecx + 12, yf - 12.5)
        if 'mast' in fs and typ != 'stack':
            lib.cylinder(b, ecx, yf + 6.0, H, H + 16.0, 0.28, n=5, slot='frame', col='#c9ccd0', r_top=0.08, top=True)
        if 'clock-tower' in fs:
            tx = ecx - 18.0 if ef != 'pediment' else ecx + 18.0
            lib.tower(b, tx, yf + 3.5, 0, 6.0, 6.0, H + 7.0, lk, windows='arched', cap='hip', cap_rise=5.0, ratio=0.3, wall_slot='plain-render', wall_col=lib.shade(wc, 1.06))
            if det == 0:
                for sgn in (-1, 1):
                    b.facing([(tx - 1.2, yf + 3.5 + sgn * 3.05, H + 7.6), (tx + 1.2, yf + 3.5 + sgn * 3.05, H + 7.6), (tx + 1.2, yf + 3.5 + sgn * 3.05, H + 10.0), (tx - 1.2, yf + 3.5 + sgn * 3.05, H + 10.0)], (0, sgn, 0), 'plain', '#f1ede0')
        # plaza apron in front of the entrance
        with b.site():
            F0.ground_quad(b, ecx - 18, yf - 15, ecx + 18, yf, 0.04, 'paving', '#cfc9bd', 1.0)
    b.section('site')
    # car park
    b.section('ground')
    deck = U.has(txt, 'multi-storey car park', 'parking deck', 'car park deck')
    front_y = y0
    padx = W / 2 + 8
    y_bk = y1 + 6
    if deck and det < 3:
        parking_deck(b, lk, srng, W / 2 - 26, W / 2, y1 + 3, y1 + 25, 3)
        y_bk = y1 + 27
    U.commerce_site(b, lk, srng, fs, brief, -padx, padx, front_y, y_bk, park=True, trees=7 if lk.tree != 'none' else 0, depth_front=20.0, lamps=4)
    if 'kiosk' in fs and det < 2:
        with b.site():
            F = U.Frame(-W * 0.3, front_y - 16, 0)
            F.box(b, -1.4, 0, 0, 1.4, 2.4, 2.7, 'plain-render', srng.choice(acc), 'roof-flat', '#8a8f94', skip=('bottom',))
    if 'umbrellas' in fs and det < 2:
        with b.site():
            for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 4), 2, 8))):
                x = srng.uniform(-W * 0.4, W * 0.4)
                U.umbrella(b, x, front_y - srng.uniform(11, 14), 1.5, 2.4, srng.choice(U.UMB))
    return b.objects()
