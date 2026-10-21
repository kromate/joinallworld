"""shophouse: salons, barber shops, kiosks, gyms, small shops, roadside shops, rooftop venues, shophouse terraces. Typologies chosen from the brief:

  shopfront  single-storey roadside shop (Nigerian salon / barber / mini-market): painted block, big glazed or roll-shutter front, a blank
             fascia board wider than the building, cloth awning or corrugated veranda on posts, shed / flat / hip roof, roof tank, AC
             units, container kiosk beside it, umbrella and plastic chairs, mural panels, boundary wall and gate, pole sign.
  twostorey  two- or three-storey painted block (gym, spa, salon above a shop): glazed or shuttered ground floor, balcony band with solid
             balustrade, external side staircase, parapet, tanks and stair core on the roof.
  rooftop    four-storey block topped with a lounge terrace: railing, timber pergola with string lights, bar, umbrellas and tables,
             planters, neon edge strip, entrance awning.
  seasia     narrow terraced shophouse units with five-foot-way arcade, shuttered windows, stepped parapets and tiled roofs.
  row        a street of small shops (1-2 storeys) along x with varied fronts, awnings, shutters and signboards.
Layout: building centred on x = 0, main facade towards -Y; road in front (site layer).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _market_open_util as U  # noqa: E402
from _market_open_util import (CHAIRS, ac_unit, chair_set, container_kiosk, external_stair, fascia, pergola, poly_tank, railing_ring, relief_band, sign_pole, string_lights)  # noqa: E402

import lib  # noqa: E402

FEATURES = {'roof-terrace', 'awning', 'umbrellas', 'neon-strip', 'signage-board', 'kiosk', 'shopfront', 'lock-ups', 'statue', 'painted-mural', 'sheds', 'stalls',
            'fence-wall', 'balcony-bands', 'flat-canopy', 'car-park', 'gate', 'water-tank', 'relief-pattern', 'pediment', 'arcade'}



def trade(txt):
    if U.has(txt, 'gym', 'fitness'):
        return 'gym'
    if U.has(txt, 'salon', 'saloon', 'barb', 'braid', 'beauty', 'hair', 'spa', 'collection'):
        return 'salon'
    if U.has(txt, 'mini-market', 'minimart', 'mini market', 'supermarket', 'store', 'mart', 'provision'):
        return 'market'
    if U.has(txt, 'rooftop', 'lounge', 'bar ', 'terrace'):
        return 'lounge'
    return 'shop'


def infer(brief, fm, fs, txt):
    st = str(brief.get('style') or '')
    if fm['W'] >= 30 and fm['D'] <= 18 and fm['S'] <= 2:
        return 'row'
    if st == 'southeast-asian' or U.has(txt, 'shophouse', 'five-foot'):
        return 'seasia'
    if fm['S'] >= 3 and ('roof-terrace' in fs or U.has(txt, 'rooftop', 'lounge')):
        return 'rooftop'
    if fm['S'] >= 2:
        return 'twostorey'
    return 'shopfront'




















def wall_pad(b, lk, srng, acc, fs, W, D, F, y_front, kind='plain'):
    """Boundary wall with a gate at the front corners of the plot (low fence-wall feature)."""
    if 'fence-wall' not in fs and 'gate' not in fs:
        return
    pw = W + 8
    pd = D + 6
    wc = lib.shade(lk.wall_col, 0.95)
    pts_l = [(-pw / 2, y_front - 3.0), (-pw / 2, D / 2 + 3), (pw / 2, D / 2 + 3), (pw / 2, y_front - 3.0)]
    U.fence_wall(b, pts_l, 1.7, 0.3, lk, wc, lk.wall_slot)
    U.fence_wall(b, [(-pw / 2, y_front - 3.0), (-2.0, y_front - 3.0)], 1.7, 0.3, lk, wc, lk.wall_slot)
    U.fence_wall(b, [(2.0, y_front - 3.0), (pw / 2, y_front - 3.0)], 1.7, 0.3, lk, wc, lk.wall_slot)
    U.gate(b, U.Frame(0, y_front - 3.0, 0), 0.0, 4.4, 2.3, lk, col=lk.trim_col, board=acc[0])


def mural_wall(b, F, x0, x1, y, z0, z1, cols, srng, hint=(0, -1, 0)):
    sg = F.seg(x0, y, x1, y) if hint[1] < 0 else F.seg(x1, y, x0, y)
    U.mural_panel(b, sg, 0, abs(x1 - x0), z0, z1, cols, srng, proud=0.03)


# ------------------------------------------------------------------------------------------------------------------ shopfront
def build_shopfront(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    tr = trade(txt)
    H = U.clamp(fm['H'] if fm['H'] > 2.6 else 3.5, 2.8, 4.6)
    roof = fm['roof'] if fm['roof'] in ('shed', 'flat', 'hip', 'gable') else 'shed'
    acc = U.accent_cols(brief, style, srng)
    pal = U.palette(brief, style, lk, srng)
    wc = lk.wall_col
    ws = lk.wall_slot
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    sc = srng.choice(acc[:3])           # sign colour
    ac2 = lk.accent_col
    b.section('body')
    # walls: back and sides via facade (windows reduced), front built by hand below
    F.walls(b, x0, y0, x1, y1, 0, H, 1, lk, srng, front='none', right='punched', back='none', left='none' if W < 8 else 'punched', ratio=0.2, bay=3.2, wall_slot=ws, wall_col=wc, skip=('front',), rear_reduced=True)
    front = F.seg(x0, y0, x1, y0)
    # front wall: a shop opening of ~65% of the width, offset to one side, and a solid bay with door/window
    sgn = srng.choice([-1, 1])
    ow = W * (0.66 if tr in ('market', 'shop') else 0.52)
    ou0 = (-W / 2 + 0.5) if sgn < 0 else (W / 2 - 0.5 - ow)
    ou1 = ou0 + ow
    dh = H - 1.0      # fascia zone above the opening
    b.face([front.P(0, 0), front.P(W, 0), front.P(W, H), front.P(0, H)], ws, wc, scale=2.0) if det >= 2 else None
    if det < 2:
        u0, u1 = ou0 - x0, ou1 - x0
        # wall pieces round the opening
        for (ua, ub) in ((0, u0), (u1, W)):
            if ub - ua > 0.05:
                b.face([front.P(ua, 0), front.P(ub, 0), front.P(ub, H), front.P(ua, H)], ws, wc, mode='fit' if (ub - ua) < 4 else None, scale=1.0)
        b.face([front.P(u0, dh), front.P(u1, dh), front.P(u1, H), front.P(u0, H)], ws, wc, mode='fit')
        sk = 'glass' if tr == 'salon' else ('shutter' if tr == 'market' else srng.choice(['glass', 'shutter']))
        U.shopfront(b, front, u0, u1, 0, dh, lk, srng, sk, srng.choice(acc[:3]), None, None, ws, wc, sign_h=0.01, proud=0.0)
        # solid bay: a door and a small window on the other side
        a0, a1 = (u1, W) if u0 < 0.1 else (0, u0)
        if a1 - a0 > 1.2:
            dc = (a0 + a1) / 2
            b.face([front.P(dc - 0.5, 0.0, -0.04), front.P(dc + 0.5, 0.0, -0.04), front.P(dc + 0.5, 2.1, -0.04), front.P(dc - 0.5, 2.1, -0.04)], 'metal-cladding', srng.choice(acc[:3]), mode='fit')
            if det == 0:
                lib.seg_box(b, front, dc - 0.62, dc + 0.62, 0, 2.25, 0.08, lk.trim_col, ws, inset=0.0)
                if a1 - a0 > 2.4:
                    wv = min(1.3, (a1 - a0) / 2 - 0.6)
                    b.face([front.P(dc + 0.8 + 0.0, 1.1, -0.04), front.P(dc + 0.8 + wv, 1.1, -0.04), front.P(dc + 0.8 + wv, 2.0, -0.04), front.P(dc + 0.8, 2.0, -0.04)], 'glass-punched', '#3a4852', mode='fit') if dc + 0.8 + wv < a1 - 0.1 else None
        # salon posters: two blank colour panels beside the window
        if tr == 'salon' and det == 0:
            for k in range(2):
                pu = (u0 - 0.1 - 0.6 - k * 0.8) if u0 > 1.7 else (u1 + 0.3 + k * 0.8)
                if 0.3 < pu < W - 1.0:
                    b.face([front.P(pu, 1.2, -0.03), front.P(pu + 0.6, 1.2, -0.03), front.P(pu + 0.6, 2.0, -0.03), front.P(pu, 2.0, -0.03)], 'plain', srng.choice(['#e8a0b4', '#d9a441', '#9a5fa0']))
    # fascia / false-front sign board across the whole front, wider than the building
    b.section('sign')
    fz0, fz1 = H - 0.1, H + 1.1
    fascia(b, F, x0 - 0.3, x1 + 0.3, fz0, fz1, y0, sc, 0.25)
    # roof
    b.section('roof')
    rs = U.clamp(W * 0.11, 0.5, 1.1)
    rc = lk.roof_col
    if roof == 'shed':
        F.roof(b, 'shed', x0, y0, x1, y1, H, rs, 0.4, 'corrugated', rc, ws, wc, high='back', ov_front=0.9)
        # the false-front fascia hides the front edge of the roof
    elif roof == 'flat':
        F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.1, 'roof-flat', rc, ws, wc, parapet=0.5, par_col=lib.shade(wc, 1.05))
    elif roof == 'hip':
        F.roof(b, 'hip', x0, y0, x1, y1, H, min(W, D) * 0.2, 0.6, lk.roof_slot, rc, ws, wc, ov_front=0.6)
    else:
        F.roof(b, 'gable', x0, y0, x1, y1, H, D * 0.22, 0.5, lk.roof_slot, rc, ws, wc, ridge='y' if W < D else 'x', ov_front=0.6)
    # veranda / awning
    b.section('awning')
    if 'flat-canopy' in fs:
        U.flat_canopy_at(b, F, 0, y0 - 0.2, W * 0.8, 2.4, H - 0.4, lk)
    elif 'awning' in fs or srng.random() < 0.55:
        aw_cols = [srng.choice(acc[:4]), '#f1ece0']
        awning_depth = 1.5
        U.awning_seg(b, front, 0.2, W - 0.2, H - 0.25, awning_depth, 0.55, aw_cols, proud=0.28)
        if det == 0:
            for px in (0.5, W - 0.5):
                q = front.P(px, 0, 0.28 + awning_depth - 0.15)
                lib.cylinder(b, q[0], q[1], 0, H - 0.8, 0.04, n=4, slot='frame', col='#7d8286', top=False, smooth=False)
    # slab and steps in front
    F.box(b, x0 - 0.4, y0 - 2.0, 0, x1 + 0.4, y0, 0.12, 'paving', '#b9b4aa', 'paving', '#c4bfb4') if det < 2 else None
    # roof tank, AC units, generator
    b.section('extras')
    if det < 2:
        if srng.random() < 0.8 or 'water-tank' in fs:
            poly_tank(b, *F.xy(srng.uniform(x0 + 1, x1 - 1), y1 - 1.3), H + (rs if roof == 'shed' else 0.0) + 0.0, srng.choice(['#2f4f6f', '#3a3a3a']))
        for k in range(1 if W < 8 else 2):
            ac_unit(b, F, x0 + 1.4 + k * 2.3 if sgn > 0 else x1 - 1.4 - k * 2.3, y0, H - 0.9)
    if 'roof-terrace' in fs and roof == 'flat' and det < 2:
        U.roof_lounge(b, F, x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, H + 0.5, srng, lk, acc, tables_n=2, pergola_=False, bar=False)
    if 'stalls' in fs and det < 2:
        cols_u = [U.sat(c, 0.2) for c in acc] + U.UMB[:3]
        for k in range(3 if det == 0 else 1):
            U.tarp_stall(b, F, x0 + 1.5 + k * 3.4, y0 - 4.2, srng, cols_u, ['#d9a441', '#c4452f', '#4f8a3a'])
    # container kiosk beside
    if 'kiosk' in fs or srng.random() < 0.35:
        container_kiosk(b, F, x1 + 2.6 if sgn > 0 else x0 - 2.6, y0 + 1.6, 3.2, 2.2, srng.choice(acc[:4]))
    # umbrella and chairs
    if det < 2:
        if 'umbrellas' in fs or srng.random() < 0.6:
            chair_set(b, F, (x0 + 1.8) if sgn > 0 else (x1 - 1.8), y0 - 3.0, srng, 2)
    # pole sign
    if 'signage-board' in fs and det < 2:
        sign_pole(b, F, x1 + 1.2 if sgn < 0 else x0 - 1.2, y0 - 2.5, 5.0, 1.4, srng.choice(acc[:4]))
    if 'painted-mural' in fs and det < 2:
        sd = F.seg(x1, y0, x1, y1)
        U.mural_panel(b, sd, 0.5, D - 0.5, 0.6, H - 0.5, [srng.choice(acc[:3]), '#f1ece0', '#2f6fb0', '#e0b030'], srng)
    if 'relief-pattern' in fs and det < 2:
        relief_band(b, front, 0.3, W - 0.3, 0.4, 1.6, lib.shade(wc, 0.75), lib.shade(wc, 1.15))
    if 'statue' in fs and det < 2:
        q = F.xy(x1 + 2.8, y0 - 3.5)
        U.statue(b, q[0], q[1], srng)
    if 'sheds' in fs and det < 2:
        F.box(b, x0 - 3.5, y1 - 3.0, 0, x0 - 0.5, y1, 2.4, 'timber', '#8a6a45', skip=('bottom', 'top'))
        F.roof(b, 'shed', x0 - 3.5, y1 - 3.0, x0 - 0.5, y1, 2.4, 0.3, 0.2, 'corrugated', lk.roof_col, 'timber', '#8a6a45')
    if 'lock-ups' in fs and det < 2:
        pass
    wall_pad(b, lk, srng, acc, fs, W + 4, D, F, y0, 'plain')
    return {'front': y0 - 2.0, 'back': y1, 'wide': W + 10}




# ------------------------------------------------------------------------------------------------------------------ twostorey
def build_twostorey(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    tr = trade(txt)
    S = int(U.clamp(fm['S'], 2, 4))
    gh, fh = 3.7, 3.2
    H = gh + fh * (S - 1) if fm['H'] < 7 else U.clamp(fm['H'], 7, 16)
    fh = (H - gh) / (S - 1)
    acc = U.accent_cols(brief, style, srng)
    wc, ws = lk.wall_col, lk.wall_slot
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    gym = tr == 'gym' or lk.windows == 'curtain'
    b.section('walls')
    front = F.seg(x0, y0, x1, y0)
    wk = 'curtain' if gym else (lk.windows if lk.windows in ('punched', 'ribbon', 'arched', 'screen') else 'punched')
    U.shop_facade(b, front, 0, S, gh, fh, lk, srng, kind='glass' if tr in ('gym', 'salon') else srng.choice(['glass', 'shutter']), cols=U.palette(brief, style, lk, srng), accents=acc,
                  unit_w=max(3.4, W / (2 if W > 9 else 1)), wall_slot=ws, wall_col=wc, windows=wk, ratio=0.55 if gym else max(0.28, lk.ratio), awn_p=0.7 if 'awning' in fs else 0.25,
                  gallery='balcony-bands' in fs or srng.random() < 0.6, bay=3.0, accent_band=lib.shade(srng.choice(acc[:3]), 0.9), signs=True)
    for sg, kind in ((F.seg(x1, y0, x1, y1), 'punched'), (F.seg(x1, y1, x0, y1), 'punched'), (F.seg(x0, y1, x0, y0), 'punched')):
        lib.facade(b, sg, 0, H, S, lk, 'none' if kind == 'none' else kind, 0.18, srng, 3.2, reduced=True, wall_slot=ws, wall_col=wc)
    b.section('roof')
    F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.12, 'roof-flat', lk.roof_col, ws, wc, parapet=0.9, par_col=lib.shade(wc, 1.08))
    if det < 2:
        U.roof_extras(b, F, x0 + 1.5, y0 + 1.5, x1 - 1.5, y1 - 1.5, H, srng, lk, cores=1, tanks=2, plant=1, rebar=srng.random() < 0.5)
    if 'roof-terrace' in fs and det < 2:
        U.roof_lounge(b, F, x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.3, H + 0.1, srng, lk, acc, tables_n=2 if W < 14 else 3, pergola_=W > 11, bar=W > 9)
    if 'stalls' in fs and det < 2:
        for k in range(3 if det == 0 else 1):
            U.tarp_stall(b, F, x0 + 1.5 + k * 3.4, y0 - 4.5, srng, [U.sat(c, 0.2) for c in acc] + U.UMB[:3], ['#d9a441', '#c4452f', '#4f8a3a'])
    # external staircase on the right side wall
    b.section('stair')
    if srng.random() < 0.8:
        external_stair(b, F, x1 + 0.7, y0 + 1.0, y1 - 0.5, gh + 0.2, srng, lib.shade(wc, 0.92))
    # sign board band on the parapet front
    b.section('sign')
    sc = srng.choice(acc[:3])
    if 'signage-board' in fs or tr in ('gym', 'salon'):
        F.box(b, x0 + W * 0.1, y0 - 0.25, H - 1.6, x1 - W * 0.1, y0, H - 0.25, 'plain', sc, skip=('bottom',)) if det < 2 else None
    if 'neon-strip' in fs and det < 2:
        U.neon(b, (x0 + 0.5, y0 - 0.3), (x1 - 0.5, y0 - 0.3), H - 1.9, '#ff5fd0' if tr != 'gym' else '#7fe0ff')
    if 'kiosk' in fs and det < 2:
        container_kiosk(b, F, x0 - 2.8, y0 + 1.6, 3.2, 2.2, srng.choice(acc[:4]))
    if det < 2 and ('umbrellas' in fs or srng.random() < 0.4):
        chair_set(b, F, srng.uniform(x0 + 1.8, x1 - 1.8), y0 - 3.2, srng, 2)
    if 'painted-mural' in fs and det < 2:
        sd = F.seg(x1, y0, x1, y1)
        U.mural_panel(b, sd, 0.5, D - 0.5, gh + 0.4, H - 1.2, [srng.choice(acc[:3]), '#f1ece0', '#2f6fb0', '#e0b030'], srng)
    if 'relief-pattern' in fs and det < 2:
        relief_band(b, front, 0.4, W - 0.4, gh + 0.5, H - 1.0, lib.shade(wc, 0.78), lib.shade(wc, 1.12))
    if ('pediment' in fs or 'arcade' in fs) and det < 2:
        ew = U.clamp(W * 0.3, 6, 12)
        U.entrance_bay(b, front, W / 2, ew, 0, H, 1.2, lk, srng, col=lib.shade(wc, 1.08), sign_col=lib.shade(srng.choice(acc[:3]), 0.8), arch=True, sign=False)
        if 'pediment' in fs:
            lib.roof(b, 'gable', (x0 + W / 2 - ew / 2 - 0.2, y0 - 1.2, x0 + W / 2 + ew / 2 + 0.2, y0 + 0.4), H + 1.6, lk, rise=ew * 0.12, ov=0.15, axis='x', gable_slot=ws, gable_col=lib.shade(wc, 1.15))
    wall_pad(b, lk, srng, acc, fs, W + 4, D, F, y0, 'plain')
    return {'front': y0 - 2.0, 'back': y1, 'wide': W + 12}




# ------------------------------------------------------------------------------------------------------------------ rooftop
def build_rooftop(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    S = int(U.clamp(fm['S'], 3, 6))
    gh, fh = 3.9, 3.1
    H = gh + fh * (S - 1)
    acc = U.accent_cols(brief, style, srng)
    pal = U.palette(brief, style, lk, srng)
    wc, ws = lk.wall_col, lk.wall_slot
    F = U.Frame(0, 0, 0)
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    b.section('walls')
    front = F.seg(x0, y0, x1, y0)
    U.shop_facade(b, front, 0, S, gh, fh, lk, srng, kind='glass', cols=pal, accents=acc, unit_w=max(3.4, W / 2), wall_slot=ws, wall_col=wc, windows='punched' if lk.windows != 'curtain' else 'curtain',
                  ratio=max(0.3, lk.ratio), awn_p=0.9, gallery=True, bay=3.0, accent_band=lib.shade(srng.choice(acc[:3]), 0.9))
    for sg in (F.seg(x1, y0, x1, y1), F.seg(x1, y1, x0, y1), F.seg(x0, y1, x0, y0)):
        lib.facade(b, sg, 0, H, S, lk, 'punched', 0.2, srng, 3.2, reduced=True, wall_slot=ws, wall_col=wc)
    b.section('roof')
    F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.12, 'roof-flat', lk.roof_col, ws, wc, parapet=0.4, par_col=lib.shade(wc, 1.08))
    b.section('lounge')
    # rooftop lounge: glass balustrade, deck, pergola over the back half, bar, tables, umbrellas, planters, lights
    railing_ring(b, F, x0 + 0.25, y0 + 0.25, x1 - 0.25, y1 - 0.25, H + 0.4, 1.0, glass=det > 0 or srng.random() < 0.5)
    if det < 2:
        F.box(b, x0 + 0.5, y0 + 0.5, H, x1 - 0.5, y1 - 0.5, H + 0.12, 'timber', '#a58559', 'timber', '#b8946a', skip=('bottom',))
    pw = W * 0.5
    pergola(b, F, x1 - 0.8 - pw, y1 - 0.8 - D * 0.45, x1 - 0.8, y1 - 0.8, H + 0.1, 2.5)
    if det < 2:
        # bar counter along the back wall
        F.box(b, x0 + 0.8, y1 - 1.7, H + 0.1, x0 + 0.8 + W * 0.28, y1 - 0.9, H + 1.2, 'timber', '#6f5238', 'plain', '#2a2623', skip=('bottom',))
        for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 4), 2, 6)) if det == 0 else 2):
            tx = x0 + 1.4 + (W - 2.8) * (k + 0.5) / max(2, U.fcount(fs, 'umbrellas', 4) if det == 0 else 2)
            ty = y0 + 1.6 + (k % 2) * 1.8
            q = F.xy(tx, ty)
            U.umbrella(b, q[0], q[1], 1.5, H + 2.6, srng.choice(U.UMB)) if det == 0 else None
            U.dining_set(b, q[0], q[1], srng, '#f2f2ee', [srng.choice(CHAIRS)], chairs=3 if det == 0 else 2)
        string_lights(b, F, x0 + 0.6, x1 - 0.6, y0 + 1.0, y1 - 1.0, H + 2.6, 12)
        for px in (x0 + 0.6, x1 - 0.6):
            F.cyl(b, px, y0 + 0.6, H + 0.1, H + 2.7, 0.04, n=3, slot='frame', col='#3a3a3a', top=False, smooth=False) if det == 0 else None
        # planters
        for k in range(3 if det == 0 else 0):
            q = F.xy(x0 + 1.0 + k * (W - 2) / 2, y0 + 0.7)
            lib.blob(b, q[0], q[1], H + 0.55, 0.45, 0.35, 0.35, '#4f7d3b', n=6, rings=3)
        # stair core
        F.box(b, x1 - 3.2, y0 + 0.6, H, x1 - 0.5, y0 + 2.6, H + 2.8, ws, lib.shade(wc, 0.95), 'roof-flat', lk.roof_col, skip=('bottom',))
    if 'neon-strip' in fs and det < 2:
        U.neon(b, (x0 + 0.2, y0 - 0.1), (x1 - 0.2, y0 - 0.1), H + 1.3, srng.choice(['#ff5fd0', '#7fe0ff', '#ffb040']))
    if 'awning' in fs and det < 2:
        pass
    b.section('ground')
    wall_pad(b, lk, srng, acc, fs, W + 4, D, F, y0, 'plain')
    return {'front': y0 - 2.0, 'back': y1, 'wide': W + 12}


# ------------------------------------------------------------------------------------------------------------------ seasia
def build_seasia(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    S = int(U.clamp(fm['S'], 2, 4))
    acc = U.accent_cols(brief, style, srng)
    pal = U.palette(brief, style, lk, srng)
    L = U.clamp(max(W, 12.6), 12.6, 30)
    depth = U.clamp(D, 10, 22)
    F = U.Frame(0, -depth / 2, 0)
    b.section('terrace')
    U.terrace_row(b, F, L, depth, S, lk, srng, 'asia', pal, acc, gh=3.5, fh=3.0, awn_p=0.0, ratio=0.35, windows='punched')
    if 'neon-strip' in fs and det < 2:
        U.neon(b, (-L / 2 + 0.3, -depth / 2 - 0.4), (L / 2 - 0.3, -depth / 2 - 0.4), 3.4, '#ff5fd0')
    if det < 2 and ('umbrellas' in fs or 'stalls' in fs):
        chair_set(b, U.Frame(0, 0, 0), srng.uniform(-L / 3, L / 3), -depth / 2 - 4.0, srng, 2)
    if 'kiosk' in fs and det < 2:
        container_kiosk(b, U.Frame(0, 0, 0), L / 2 + 3.0, -depth / 2 + 1.6, 3.2, 2.2, srng.choice(acc[:4]))
    return {'front': -depth / 2 - 2.5, 'back': depth / 2, 'wide': L + 10}


# ------------------------------------------------------------------------------------------------------------------ row
def build_row(b, brief, style, lk, fm, fs, txt, srng, W, D):
    det = b.detail
    acc = U.accent_cols(brief, style, srng)
    pal = U.palette(brief, style, lk, srng)
    L = U.clamp(W, 36, 96)
    depth = U.clamp(D, 7, 14)
    S = int(U.clamp(fm['S'], 1, 2))
    F = U.Frame(0, -depth / 2, 0)
    b.section('row')
    if S == 1 and fm['roof'] in ('shed', 'gable', 'hip'):
        pos = -L / 2
        i = 0
        while pos < L / 2 - 6:
            seg_len = min(srng.uniform(12, 22), L / 2 - pos)
            if seg_len < 5:
                break
            h = U.clamp(fm['H'] if fm['H'] > 2.6 else 3.4, 3.0, 4.2)
            Fi = U.Frame(pos + seg_len / 2, -depth / 2, 0)
            U.lockup_block(b, Fi, seg_len, depth, h, lk, srng, roof=fm['roof'] if fm['roof'] != 'hip' else 'shed', vd=1.4, unit_w=srng.uniform(3.0, 4.2), wall_slot=lk.wall_slot,
                           wall_col=lib.jitter(srng.choice(pal[:5]), srng, 0.05), roof_slot='corrugated', roof_col=lib.jitter(lk.roof_col, srng, 0.1),
                           shut_cols=[srng.choice(acc[:5]) for _ in range(3)], open_p=0.35, goods=['#d9a441', '#c4452f', '#4f8a3a'])
            pos += seg_len + srng.uniform(1.8, 3.2)
            i += 1
    else:
        U.terrace_row(b, F, L, depth, S, lk, srng, 'naija', pal, acc, gh=3.6, fh=3.2, awn_p=0.6 if 'awning' in fs else 0.3, ratio=0.3, windows='punched', balcony=S > 1)
    b.section('street')
    cols_u = [U.sat(c, 0.2) for c in acc] + U.UMB[:4]
    if det < 2:
        for k in range(int(L / 9) if det == 0 else int(L / 18)):
            x = -L / 2 + 5 + k * 9 + srng.uniform(-1, 1)
            chair_set(b, U.Frame(0, 0, 0), x, -depth - 2.0, srng, 2)
    if 'statue' in fs and det < 2:
        U.statue(b, srng.uniform(-L / 4, L / 4), -depth - 6.5, srng)
    if 'kiosk' in fs and det < 2:
        container_kiosk(b, U.Frame(0, 0, 0), srng.uniform(-L / 3, L / 3), -depth - 4.5, 3.2, 2.2, srng.choice(acc[:4]))
    if 'signage-board' in fs and det < 2:
        sign_pole(b, U.Frame(0, 0, 0), L * 0.3, -depth - 6.0, 5.2, 2.2, srng.choice(acc[:4]))
    return {'front': -depth - 3.0, 'back': 0.5, 'wide': L + 8}


# ------------------------------------------------------------------------------------------------------------------ build
def build(brief, style, rng, detail):
    seed = rng.getrandbits(64)
    return U.governed(lambda: _build(brief, style, random.Random(seed), detail), detail)


def _build(brief, style, rng, detail):
    b = lib.Builder('shophouse', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    fm = U.form(brief)
    fs = U.feats(brief)
    txt = U.text(brief)
    typ = infer(brief, fm, fs, txt)
    W = U.clamp(fm['W'], 5.0, 24.0 if typ in ('shopfront', 'seasia') else 50.0)
    D = U.clamp(fm['D'], 4.5, 20.0)
    if typ == 'row':
        W, D = fm['W'], fm['D']
    fn = {'shopfront': build_shopfront, 'twostorey': build_twostorey, 'rooftop': build_rooftop, 'seasia': build_seasia, 'row': build_row}[typ]
    info = fn(b, brief, style, lk, fm, fs, txt, srng, W, D)
    # site: ground pad, road in front, verge trees, lamp
    b.section('ground')
    wide = info['wide']
    yf = info['front']
    yb = info['back'] + 4.5
    with b.site():
        pass
    U.commerce_site(b, lk, srng, fs, brief, -wide / 2, wide / 2, yf, yb, park=('car-park' in fs), road=True, trees=int(U.clamp(wide / 8, 2, 4)), depth_front=4.5, flags=False, lamps=int(U.clamp(wide / 14, 1, 3)), road_w=6.5, tree_h=(4.5, 6.5), tree_pos='ends')
    return b.objects()
