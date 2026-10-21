"""market-open: open-air markets. Typologies chosen from the brief (style, material, roof, features, subject/notes wording):

  lockup   rows of lock-up shop blocks with roll-up shutters under corrugated verandas, lanes of umbrella stalls and tarp stalls,
           perimeter blocks facing inward, front yard with gate (Wuse, Kurmi, Balogun, Oba, Ibadan ...). Mud-render with arched doors
           and crenellated wall for Hausa/Arewa; painted shops with shutters for the south; multi-storey ring blocks when storeys > 1.
  ring     one stern multi-level concrete hall ringed by a dense carpet of low stalls and raised platforms (Dantokpa).
  street   a pedestrianised street: two terraces (brick/stucco, shophouse or painted blocks) with a double row of awninged stalls.
  shedyard long open warehouse sheds over stacked goods (yam, timber, rice sacks), trucks, silos, chimney.
  yard     livestock yard: rail pens, animals, shade sheds, kiosks, perimeter wall.
  pits     dye pits: rows of round vats in mud rims, indigo cloth on lines, small dyers' sheds, the old city wall behind.
Layout (metres): centred on x = 0; main frontage towards -Y; the front strip (gate, road, parking) is in the site layer.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _market_open_util as U  # noqa: E402

import lib  # noqa: E402

FEATURES = {'stalls', 'sheds', 'umbrellas', 'kiosk', 'gate', 'fence-wall', 'signage-board', 'awning', 'painted-mural', 'arcade', 'car-park',
            'bus-bays', 'pier', 'chimney', 'storage-tanks', 'water-tank', 'ramparts', 'minaret', 'flags', 'floodlights', 'balcony-bands',
            'platform-canopy', 'lock-ups', 'neon-strip', 'crenellation', 'statue', 'flat-canopy'}

RUST = ['#8d5a3b', '#9a5f3f', '#7f8387', '#a9aeb2', '#6d7f8c', '#8a6a4a']


def infer(brief, fm, fs, txt, lk):
    style = str(brief.get('style') or '')
    core = ' '.join(str(brief.get(k, '')) for k in ('name', 'subject', 'venueId')).lower()
    if U.has(txt, 'dye pit', 'dye-pit', 'dyeing vat', 'dye vat') or (U.has(txt, 'pits') and U.has(txt, 'indigo')):
        return 'pits'
    if U.has(core, 'cattle', 'livestock', 'camel', 'goat market', 'animal market'):
        return 'yard'
    if (fm['S'] >= 3 and fm['roof'] == 'flat' and U.has(txt, 'hall', 'multi-level', 'multilevel')) or U.has(txt, 'multi-level main hall'):
        return 'ring'
    if U.has(core, 'yam', 'timber yard', 'timber market', 'timber-market', 'rice', 'warehouse', 'produce', 'grain', 'lumber', 'sawn', 'plank', 'firewood', 'fish market'):
        return 'shedyard'
    if style in ('victorian', 'georgian', 'tudor', 'neoclassical', 'nordic', 'southeast-asian', 'east-asian', 'baroque', 'art-deco') or \
            U.has(txt, 'high street', 'pedestrianised', 'night market', 'wet market', 'street market') or (fm['W'] >= 3 * fm['D'] and fm['D'] <= 36):
        return 'street'
    return 'lockup'


# ------------------------------------------------------------------------------------------------------------------ pieces
def roof_col_for(lk, srng, base=None):
    r = srng.random()
    if r < 0.5:
        return lib.jitter(base or lk.roof_col, srng, 0.12)
    return lib.jitter(srng.choice(RUST), srng, 0.08)


def stall_cols(brief, style, srng):
    cols = U.accent_cols(brief, style, srng)
    return [U.sat(c, 0.2) for c in cols] + U.UMB[:4]


GOODS = ['#d9a441', '#c4452f', '#4f8a3a', '#e07a30', '#8a5fa0', '#e8e1cf', '#9a6a3a']


def stall_field(b, F, x0, y0, x1, y1, srng, cols, n, size=1.0, kinds=('umbrella', 'umbrella', 'tarp'), pitch=(3.0, 3.0), jitter=0.5):
    """About n umbrella / tarp stalls on a loose grid inside the local rect."""
    px, py = pitch
    nx = max(1, int((x1 - x0) / px))
    ny = max(1, int((y1 - y0) / py))
    cells = [(i, j) for i in range(nx) for j in range(ny)]
    srng.shuffle(cells)
    if b.detail == 1:
        n = (n + 1) // 2
    n = int(n * U.DENSITY[0])
    for (i, j) in cells[:n]:
        x = x0 + (i + 0.5) * (x1 - x0) / nx + srng.uniform(-jitter, jitter)
        y = y0 + (j + 0.5) * (y1 - y0) / ny + srng.uniform(-jitter, jitter)
        k = srng.choice(kinds)
        if k == 'umbrella':
            U.umbrella_stall(b, F.sub(0, 0), x, y, srng, cols, GOODS, size)
        else:
            U.tarp_stall(b, F.sub(0, 0), x, y, srng, cols, GOODS)


def trample(b, F, x0, y0, x1, y1, col, z=0.03):
    F.ground_quad(b, x0, y0, x1, y1, z, 'plain', col)


def front_yard(b, lk, fs, srng, W, D, y_front, pad_x, road, brief, cols, fp_kind='x'):
    """Road, parking/bus bays, trees and furniture in front of the market (site layer)."""
    fc = (brief.get('setting') or {}).get('forecourt') or 'road'
    ry1 = y_front - 1.0
    ry0 = ry1 - 9.0
    if fc in ('road', 'parking', 'none', 'plaza', 'garden', None) or road:
        lib.forecourt(b, 'road', -pad_x + 1, ry0, pad_x - 1, ry1, lk, srng)
    if 'car-park' in fs or fc == 'parking':
        lib.forecourt(b, 'parking', -pad_x + 6, ry0 - 15, pad_x * 0.55, ry0 - 1.5, lk, srng, density=1.0)
    if 'bus-bays' in fs and b.detail < 2:
        with b.site():
            for k in range(3):
                bx = -pad_x * 0.3 + k * 11
                lib.box_c(b, bx, ry0 - 4, 0.0, 9.0, 2.5, 2.9, 'metal-cladding', srng.choice(['#d6b030', '#c9ccd0', '#3b6f9f']), top_slot='roof-flat', top_col='#d8d8d8', skip=('bottom',))
                if b.detail == 0:
                    lib.box_c(b, bx, ry0 - 4 - 1.26, 0.9, 8.4, 0.05, 1.0, 'glass-ribbon', '#2d3a46', skip=())


def trees_around(b, lk, srng, x0, x1, y, n):
    if lk.tree in (None, 'none') or b.detail >= 2:
        return
    for k in range(n):
        t = (k + 0.5) / n
        lib.tree(b, lk.tree, x0 + (x1 - x0) * t + srng.uniform(-2, 2), y + srng.uniform(-1.5, 1.5), srng.uniform(6.5, 9.5), srng, lk)


def flag_pole(b, x, y, h, col):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.06, n=5, slot='frame', col='#b8bcc0', r_top=0.04, top=True)
        b.facing([(x + 0.05, y, h - 1.5), (x + 2.0, y, h - 1.4), (x + 2.0, y, h - 0.2), (x + 0.05, y, h)], (0, -1, 0), 'plain', col)


def board_on_wall(b, F, x, y, z, w, h, col):
    """Blank board on two posts (local frame)."""
    if b.detail >= 2:
        return
    F.box(b, x - w / 2, y, z, x + w / 2, y + 0.2, z + h, 'plain', col, skip=('bottom',))
    if b.detail == 0:
        for sx in (-w * 0.4, w * 0.4):
            F.cyl(b, x + sx, y + 0.1, 0, z, 0.07, n=4, slot='frame', col='#8d9298', top=False, smooth=False)


def kiosk_box(b, F, x, y, srng, cols, w=2.4, d=2.2, h=2.5):
    """A small trading kiosk with a shutter window and a sloping roof (local frame; centre x, front y)."""
    c = srng.choice(cols)
    F.box(b, x - w / 2, y, 0, x + w / 2, y + d, h, 'plain-render', c, skip=('bottom', 'top'))
    F.roof(b, 'shed', x - w / 2, y, x + w / 2, y + d, h, 0.35, 0.2, 'corrugated', '#8a8f94', 'plain-render', c, ov_front=0.5)
    if b.detail == 0:
        F.face(b, [(x - w * 0.35, -0.02 + y, 0.9), (x + w * 0.35, -0.02 + y, 0.9), (x + w * 0.35, -0.02 + y, 1.9), (x - w * 0.35, -0.02 + y, 1.9)], (0, -1, 0), 'glass-punched', '#46403a', mode='fit')
        F.box(b, x - w * 0.4, y - 0.4, 0.88, x + w * 0.4, y, 0.95, 'timber', '#8a6a45')


# ------------------------------------------------------------------------------------------------------------------ lockup
def layout_lockup(b, brief, style, lk, fm, fs, txt, srng, rng, W, D, vern, cols):
    det = b.detail
    storeys = fm['S']
    y_back = D / 2
    sx0, sx1 = -W / 2, W / 2
    dr = 3.3                        # lock-up row depth
    vd = 2.3 if 'arcade' in fs else 1.2   # veranda (deeper colonnaded arcade when the brief asks for it)
    lane = srng.uniform(3.8, 4.8)
    irregular = fm['fp'] in ('irregular', 'L', 'U', 'T', 'cross') or fm['fp'] == 'H'
    roof_form = fm['roof'] if fm['roof'] in ('shed', 'gable', 'hip', 'flat', 'pyramidal') else 'shed'
    if roof_form == 'pyramidal':
        roof_form = 'hip'
    wall_slot = lk.wall_slot
    wall_col = lk.wall_col
    h = U.clamp(fm['H'] if fm['S'] == 1 and fm['H'] > 0 else 3.3, 2.7, 4.2)
    if vern:
        h = min(h, 3.1)
    shut = [U.sat(c, 0.15) for c in U.accent_cols(brief, style, srng)[:4]]
    if vern:
        shut = ['#4a3a2c', '#5b4636', '#3f5f7f', '#4a3a2c']
    goods = GOODS
    skew = srng.uniform(0.06, 0.14) * srng.choice([-1, 1]) if (irregular or vern) else 0.0
    unit_w = 2.3 if vern else srng.uniform(2.4, 3.0)
    roof_c = lib.shade(lk.roof_col, 1.0)
    b.section('perimeter')
    rowh = lambda: roof_col_for(lk, srng, roof_c)
    # perimeter blocks: back row facing -Y, side rows facing inward
    notch = None
    if irregular and not vern:
        notch = srng.choice(['left', 'right'])
    side_y0 = -D / 2 + 8.0
    side_len = (y_back - dr) - side_y0
    if storeys >= 2:
        # multi-storey painted shop blocks along the back and sides (Lagos, Ibadan, Enugu, Dantokpa ring)
        fh = 3.3
        ph = fm['H'] if fm['H'] > 6 else 3.6 + fh * (storeys - 1)
        bd = 8.0
        FB = U.Frame(0, y_back - bd, 0)
        U.terrace_row(b, FB, W - 2 * bd - 2, bd, storeys, lk, srng, 'naija', U.palette(brief, style, lk, srng), shut, gh=3.6, fh=fh, balcony=True,
                      tank='water-tank' in fs, awn_p=0.5, ratio=0.3, windows=lk.windows if lk.windows in ('punched', 'ribbon', 'arched') else 'punched')
        for sgn in (-1, 1):
            FS = U.Frame(sgn * (W / 2 - bd), (side_y0 + y_back - bd) / 2 - 2, -sgn * math.pi / 2)
            U.terrace_row(b, FS, (y_back - bd) - side_y0 - 4, bd, max(2, storeys - 1), lk, srng, 'naija', U.palette(brief, style, lk, srng), shut, gh=3.6, fh=fh, awn_p=0.4, ratio=0.3)
        inner_x0, inner_x1 = sx0 + bd + 2, sx1 - bd - 2
        back_y = y_back - bd - 2
    else:
        FB = U.Frame(0, y_back - dr - vd, 0)
        # back row, possibly split by a gap
        gaps = [(-3.0, 3.0)] if W > 60 and srng.random() < 0.6 else []
        segs = [(-W / 2 + 1, W / 2 - 1)]
        if gaps:
            g0, g1 = gaps[0]
            segs = [(-W / 2 + 1, g0), (g1, W / 2 - 1)]
        for (a, c) in segs:
            L = c - a
            lockup_dispatch(b, U.Frame((a + c) / 2, y_back - dr, 0), L, dr, h, lk, srng, roof_form, vd, unit_w, wall_slot, wall_col, rowh(), shut, vern, goods, notch=None, fs=fs)
        for sgn in (-1, 1):
            if notch and ((notch == 'left' and sgn < 0) or (notch == 'right' and sgn > 0)):
                continue
            b.section('perimeter-blocks')
            sl = side_len - 2
            FS = U.Frame(sgn * (W / 2 - dr), side_y0 + side_len / 2, sgn * math.pi / 2)
            lockup_dispatch(b, FS, sl, dr, h, lk, srng, roof_form, vd, unit_w, wall_slot, wall_col, rowh(), shut, vern, goods, fs=fs)
        inner_x0, inner_x1 = sx0 + dr + vd + lane * 0.7, sx1 - dr - vd - lane * 0.7
        back_y = y_back - dr - vd - lane * 0.7
    # interior rows
    b.section('rows')
    ix0, ix1 = inner_x0 + abs(math.sin(skew)) * 12, inner_x1 - abs(math.sin(skew)) * 12
    pitch = dr + vd + lane
    y_start = side_y0 + 3.5
    nrows = int((back_y - y_start) // pitch)
    nrows = max(1, min(nrows, 6))
    stall_target = U.fcount(fs, 'stalls', 24)
    stall_target = int(U.clamp(stall_target * (0.55 if W * D < 5000 else 0.7), 10, 70))
    umb_target = int(U.clamp(U.fcount(fs, 'umbrellas', 0), 0, 36))
    n_sheds = int(U.clamp(U.fcount(fs, 'sheds', 2) // 3, 0, 3))
    row_types = []
    for r in range(nrows):
        row_types.append('lockup')
    # a few rows become open stall fields or roofed sheds
    cand = list(range(nrows))
    srng.shuffle(cand)
    for k, r in enumerate(cand):
        if k < max(1, nrows // 3):
            row_types[r] = 'field'
        elif k < max(1, nrows // 3) + n_sheds:
            row_types[r] = 'shed'
    FI = U.Frame(0, (y_start + back_y) / 2, skew)
    base_y = -(nrows * pitch) / 2 + (vd) + 0.0
    stall_budget = stall_target
    cols_u = stall_cols(brief, style, srng)
    for r in range(nrows):
        yloc = -nrows * pitch / 2 + r * pitch + lane * 0.5
        kind = row_types[r]
        x_a, x_b = ix0 - 0.0, ix1
        span = x_b - x_a
        if kind == 'lockup':
            b.section('lockups')
            # segments with cross lanes
            pos = x_a
            while pos < x_b - 8:
                sl = min(srng.uniform(14, 28), x_b - pos)
                if x_b - pos - sl < 8:
                    sl = x_b - pos
                lockup_dispatch(b, FI.sub((pos + pos + sl) / 2, yloc + vd), sl, dr, h, lk, srng, roof_form, vd, unit_w, wall_slot, wall_col, rowh(), shut, vern, goods, fs=fs)
                pos += sl + srng.uniform(2.6, 3.6)
            # umbrella line in the lane in front of this row
            b.section('stalls')
            if det < 2:
                n_here = min(stall_budget, int(span / 3.4)) + umb_target // max(1, nrows)
                stall_budget -= n_here
                stall_field(b, FI, x_a + 1, yloc - lane + 0.4, x_b - 1, yloc - 1.4, srng, cols_u, n_here, 1.0, ('umbrella', 'umbrella', 'tarp'), (3.4, max(2.6, lane - 1.8)))
        elif kind == 'field':
            b.section('stalls')
            if det < 2:
                n_here = min(stall_budget + 14, int(span / 2.6 * 2))
                stall_budget = max(0, stall_budget - n_here)
                stall_field(b, FI, x_a + 1, yloc - lane * 0.4, x_b - 1, yloc + pitch * 0.55, srng, cols_u, n_here, 1.0, ('umbrella', 'umbrella', 'tarp', 'tarp'), (2.9, 2.7))
        else:  # roofed shed over stalls (open-sided)
            b.section('sheds')
            ln = min(span * 0.6, 40)
            sx = srng.uniform(x_a + ln / 2, x_b - ln / 2)
            F2 = FI.sub(sx, yloc - lane * 0.2)
            U.shed_over_goods(b, F2, ln, 7.0, 3.6, lk, srng, roof='gable', roof_col=rowh(), post_pitch=5.5, wall_col=wall_col, rise=1.1, goods=GOODS)
            if det < 2:
                for xx in range(int(ln / 3.2) if det == 0 else 0):
                    U.table(b, F2, -ln / 2 + 1.8 + xx * 3.2, 3.2, 1.8, 0.8, 0.8, '#8a6a45')
    return {'front': -D / 2, 'inner': (inner_x0, inner_x1), 'back_y': back_y, 'h': h}


def lockup_dispatch(b, F, L, d, h, lk, srng, roof_form, vd, unit_w, wall_slot, wall_col, roof_col, shut, vern, goods, notch=None, fs=None):
    arch = vern
    ws = 'mud-render' if vern else wall_slot
    wc = lib.jitter(wall_col, srng, 0.06)
    U.lockup_block(b, F, L, d, h, lk, srng, roof=roof_form, vd=vd, unit_w=unit_w, wall_slot=ws, wall_col=wc, roof_slot='corrugated', roof_col=roof_col,
                   shut_cols=shut, arch=arch, goods=goods, relief=vern, fascia_col=lib.shade(wc, 0.92 if not vern else 0.85),
                   awn=([shut[0], '#efeae0'] if (fs and 'awning' in fs) else None))


def front_perimeter(b, F0, lk, fs, srng, W, D, vern, gate_w, y):
    """Low wall along the front (-Y) edge with a gate in the middle; returns nothing. In the building layer."""
    if 'fence-wall' not in fs and 'gate' not in fs and not vern:
        return
    wh = 1.9 if vern else 1.6
    wc = lk.wall_col if not vern else lib.shade(lk.wall_col, 1.0)
    ws = 'mud-render' if vern else lk.wall_slot
    xs = -W / 2
    xe = W / 2
    g = gate_w / 2
    cren = vern or 'crenellation' in fs
    U.fence_wall(b, [(xs, y), (-g, y)], wh, 0.45, lk, wc, ws, crenel=cren)
    U.fence_wall(b, [(g, y), (xe, y)], wh, 0.45, lk, wc, ws, crenel=cren)
    if 'gate' in fs or vern:
        U.gate(b, U.Frame(0, y, 0), 0.0, gate_w, 3.6, lk, col=lib.shade(wc, 1.05), board=lk.accent_col)


def build_lockup(b, brief, style, lk, fm, fs, txt, srng, rng, W, D):
    det = b.detail
    vern = lk.wall_slot == 'mud-render' or str(brief.get('style')) in ('hausa-arewa', 'sahelian')
    cols = U.accent_cols(brief, style, srng)
    info = layout_lockup(b, brief, style, lk, fm, fs, txt, srng, rng, W, D, vern, cols)
    b.section('perimeter')
    y_front = -D / 2
    gate_w = 9.0
    front_perimeter(b, None, lk, fs, srng, W, D, vern, gate_w, y_front)
    # mosque / minaret
    if 'minaret' in fs or U.has(txt, 'mosque'):
        U.mosque_small(b, U.Frame(-W / 2 + 14, y_front + 6, 0), 0, 0, srng, lk)
    if 'neon-strip' in fs and det < 2:
        U.neon(b, (-W / 2 + 2, D / 2 - 3.3 - 0.1), (W / 2 - 2, D / 2 - 3.3 - 0.1), info['h'] - 0.45, '#ff5fd0')
    if 'flat-canopy' in fs:
        U.flat_canopy_at(b, U.Frame(0, y_front, 0), 0, 0, 14.0, 5.0, 3.9, lk)
    if 'statue' in fs and det < 2:
        U.statue(b, 0, y_front - 6.0, srng)
    # ramparts (old city wall behind the market)
    if 'ramparts' in fs:
        U.fence_wall(b, [(-W / 2 - 5, D / 2 + 6), (W / 2 + 5, D / 2 + 6)], 7.5, 2.2, lk, lib.shade(lk.wall_col, 0.92), 'mud-render', crenel=True)
    # kiosks
    b.section('kiosks')
    nk = int(U.clamp(U.fcount(fs, 'kiosk', 0) + (1 if 'signage-board' in fs else 0), 0, 4))
    kc = U.accent_cols(brief, style, srng)
    for k in range(nk):
        kx = -W * 0.38 + k * W * 0.2 + srng.uniform(-2, 2)
        kiosk_box(b, U.Frame(kx, y_front + 4.0, 0), 0, 0, srng, kc)
    # signage boards (blank)
    if 'signage-board' in fs and det < 2:
        board_on_wall(b, U.Frame(W * 0.3, y_front - 0.0, 0), 0, 0, 3.2, 6.0, 1.6, lk.accent_col)
    if 'painted-mural' in fs and det < 2:
        # a mural on the outer face of the right-hand perimeter block
        sg = lib.Seg((W / 2 + 0.04, y_front + 12.0), (W / 2 + 0.04, D / 2 - 6.0))
        U.mural_panel(b, sg, 0, sg.length, 0.5, max(2.2, info['h'] - 0.6), [srng.choice(kc[:3]), '#f1ece0', '#2f6fb0', '#e0b030'], srng)
    if 'floodlights' in fs and det < 1:
        with b.site():
            for sx in (-1, 1):
                lib.cylinder(b, sx * (W / 2 + 4), D / 2 - 6, 0, 14, 0.22, n=6, slot='frame', col='#8d9298', r_top=0.14)
                lib.box_c(b, sx * (W / 2 + 4), D / 2 - 6, 14, 3.0, 0.5, 1.2, 'plain', '#3d4146')
    # platform canopy (raised platform)
    if 'platform-canopy' in fs and det < 2:
        F = U.Frame(W * 0.25, y_front + 11, 0)
        F.box(b, -9, -4, 0, 9, 4, 0.55, 'timber', '#8a6a45', 'timber', '#a58559', skip=('bottom',))
        if det == 0:
            for sx in (-8, 8):
                for sy in (-3.4, 3.4):
                    F.cyl(b, sx, sy, 0.55, 3.2, 0.07, n=4, slot='timber', col='#7a5a3a', top=False, smooth=False)
        F.roof(b, 'shed', -9.5, -4.2, 9.5, 4.2, 3.2, 0.8, 0.2, 'corrugated', lk.roof_col, 'plain-render', lk.wall_col, th=0.08, ov_front=0.3)
    return info



# ------------------------------------------------------------------------------------------------------------------ ring (Dantokpa)
def build_ring(b, brief, style, lk, fm, fs, txt, srng, rng, W, D):
    det = b.detail
    S = max(2, fm['S'])
    hw = U.clamp(W * 0.42, 30, 46)
    hd = U.clamp(D * 0.34, 22, 30)
    fh = 4.0
    Hh = U.clamp(fm['H'] if fm['H'] > 8 else fh * S, 8, 18)
    hall = lib.fp_rect(hw, hd, 0, 0)
    FH = U.Frame(0, 0, 0)
    ws = lk.wall_slot
    b.section('hall')
    lib.walls(b, hall, 0, Hh, S, lk, srng, kind='ribbon' if lk.windows in ('none', 'ribbon', 'screen', 'louvre') else lk.windows, front_kind=None, rear='same', ratio=0.3, bay=4.0,
              plinth=0.5)
    if det == 0:
        for s in range(1, S):
            for seg in hall.edges():
                lib.seg_box(b, seg, 0, seg.length, Hh * s / S - 0.3, Hh * s / S + 0.25, 0.9, lk.accent_col, ws)
    lib.roof(b, 'flat', hall, Hh, lk, parapet_h=0.8, ov=0.3, slab=0.3)
    U.roof_clutter(b, FH, -hw / 2 + 2, -hd / 2 + 2, hw / 2 - 2, hd / 2 - 2, Hh, srng, lk, 4)
    if 'water-tank' in fs:
        U.water_tank(b, hw / 4, 0, Hh, srng)
    # ring of stalls
    b.section('stalls')
    cols_u = stall_cols(brief, style, srng)
    n = int(U.clamp(U.fcount(fs, 'stalls', 40), 20, 90))
    rx0, rx1, ry0, ry1 = -W / 2, W / 2, -D / 2, D / 2
    cells = []
    for i in range(int((rx1 - rx0) / 3.4)):
        for j in range(int((ry1 - ry0) / 3.4)):
            x = rx0 + 1.7 + i * 3.4
            y = ry0 + 1.7 + j * 3.4
            if abs(x) < hw / 2 + 3.5 and abs(y) < hd / 2 + 3.5:
                continue
            cells.append((x, y))
    srng.shuffle(cells)
    F0 = U.Frame(0, 0, 0)
    for (x, y) in cells[:max(n, 50)]:
        x += srng.uniform(-0.5, 0.5)
        y += srng.uniform(-0.5, 0.5)
        if det == 2:
            continue
        if srng.random() < 0.6:
            U.tarp_stall(b, F0, x, y, srng, cols_u, GOODS, w=2.6, d=2.0)
        else:
            U.umbrella_stall(b, F0, x, y, srng, cols_u, GOODS)
    if 'platform-canopy' in fs and det < 2:
        F = U.Frame(hw / 2 + 8, -hd / 2 - 6, 0)
        F.box(b, -6, -3, 0, 6, 3, 0.8, 'timber', '#8a6a45', 'timber', '#a58559')
        F.roof(b, 'shed', -6.4, -3.2, 6.4, 3.2, 3.2, 0.8, 0.2, 'corrugated', lk.roof_col, 'plain-render', lk.wall_col, th=0.08, ov_front=0.3)
        if det == 0:
            for sx in (-5.6, 5.6):
                for sy in (-2.6, 2.6):
                    F.cyl(b, sx, sy, 0.8, 3.2, 0.07, n=4, slot='timber', col='#7a5a3a', top=False, smooth=False)
    return {'front': -D / 2}


# ------------------------------------------------------------------------------------------------------------------ street
def build_street(b, brief, style, lk, fm, fs, txt, srng, rng, W, D):
    det = b.detail
    st = str(brief.get('style') or '')
    asia = st in ('southeast-asian', 'east-asian') or U.has(txt, 'night market', 'shophouse')
    kind = 'asia' if asia else 'euro'
    Wl = U.clamp(W, 70, 100)
    Dt = U.clamp(D, 24, 44)
    sw = U.clamp(Dt * 0.46, 10.0, 17.0)
    td = (Dt - sw) / 2
    S = fm['S']
    pal = U.palette(brief, style, lk, srng)
    acc = U.accent_cols(brief, style, srng)
    b.section('terraces')
    # north terrace (facing the camera across the street); south terrace is lower and broken by side streets
    FN = U.Frame(0, sw / 2, 0)
    U.terrace_row(b, FN, Wl, td, max(2, S), lk, srng, kind, pal, acc, fh=3.2 if kind == 'euro' else 3.0, awn_p=0.6, ratio=0.36, windows=lk.windows if lk.windows in ('punched', 'arched') else 'punched')
    S2 = 1
    spans = [(-Wl / 2, -Wl / 2 + 20.0), (Wl / 2 - 20.0, Wl / 2)]
    for (a, c) in spans:
        if c - a < 8:
            continue
        FS = U.Frame((a + c) / 2, -sw / 2, math.pi)
        U.terrace_row(b, FS, c - a, td, S2, lk, srng, kind, pal, acc, fh=3.2 if kind == 'euro' else 3.0, awn_p=0.7, ratio=0.34, windows='punched', reduced=True, back_kind='punched')
    # street furniture + stalls
    b.section('stalls')
    cols_u = stall_cols(brief, style, srng) if not asia else [U.sat(c, 0.5) for c in acc] + ['#d93a3a', '#e8b030']
    n = int(U.clamp(U.fcount(fs, 'stalls', 40), 20, 70))
    FSt = U.Frame(0, 0, 0)
    pitch = 3.0
    cnt = int(Wl / pitch) - 2
    stalls_total = 0
    for row_y in (-sw * 0.28, sw * 0.28):
        for k in range(cnt if det < 2 else 0):
            if stalls_total >= n * 2 or srng.random() < 0.08:
                continue
            x = -Wl / 2 + 3 + k * pitch + srng.uniform(-0.25, 0.25)
            col = srng.choice(cols_u)
            stall_gable(b, FSt, x, row_y, srng, col, asia)
            stalls_total += 1
    if 'neon-strip' in fs and det < 2:
        U.neon(b, (-Wl / 2 + 1, sw / 2 - 0.35), (Wl / 2 - 1, sw / 2 - 0.35), 3.5 if kind == 'euro' else 3.3, '#ff5fd0')
    if det < 2 and 'umbrellas' in fs:
        for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 6), 0, 16))):
            x = srng.uniform(-Wl / 2 + 4, Wl / 2 - 4)
            U.umbrella_stall(b, FSt, x, srng.choice([-0.5, 0.5]), srng, cols_u, GOODS)
    if 'kiosk' in fs and det < 2:
        for sx in (-Wl * 0.3, Wl * 0.3):
            kiosk_box(b, U.Frame(sx, -sw * 0.05, 0), 0, 0, srng, acc, 3.0, 2.4)
    if asia and det == 0:
        # string lights between the two stall rows
        U.string_lights(b, FSt, -Wl / 2 + 2, Wl / 2 - 2, -sw * 0.28, sw * 0.28, 3.5, int(Wl / 2.6), '#ffd27a')
    # ground
    b.section('ground')
    return {'front': -Dt / 2, 'sw': sw, 'Wl': Wl, 'Dt': Dt, 'street': True}


def stall_gable(b, F, x, y, srng, col, asia=False):
    """A market-stall frame with a striped canvas gable roof, counter and goods (ridge along x)."""
    det = b.detail
    w, d, hh = 2.5, 1.9, 2.25
    if det < 2:
        if det == 0:
            for (px, py) in ((-w / 2, -d / 2), (w / 2, -d / 2), (-w / 2, d / 2), (w / 2, d / 2)):
                F.cyl(b, x + px, y + py, 0, hh, 0.04, n=3, slot='frame', col='#7d8286', top=False, smooth=False)
        F.roof(b, 'gable', x - w / 2, y - d / 2, x + w / 2, y + d / 2, hh, 0.55, 0.12, 'plain', col, 'plain', col, th=0.0, infill=False)
        if det == 0:
            U.table(b, F, x, y - d * 0.12, w * 0.9, 0.75, 0.82, '#8a6a45')
            for k in range(1):
                px = x + (k - 0.5) * 0.9 + 0.45
                q = F.xy(px, y - d * 0.12)
                U.pile(b, q[0], q[1], 0.82, 0.27, srng.uniform(0.2, 0.4), srng.choice(GOODS))
    else:
        F.box(b, x - w / 2, y - d / 2, 0, x + w / 2, y + d / 2, hh, 'plain', col, 'plain', col)


# ------------------------------------------------------------------------------------------------------------------ shedyard
def truck(b, x, y, yaw, col):
    if b.detail >= 2:
        return
    with b.site():
        lib.obox(b, x, y, 0.5, 6.0, 2.3, 2.3, yaw, 'plain', col, skip=('bottom',))
        c, s = math.cos(yaw), math.sin(yaw)
        lib.obox(b, x + c * 3.7, y + s * 3.7, 0.5, 1.7, 2.2, 1.9, yaw, 'plain', '#d8d4c8', skip=('bottom',))
        if b.detail == 0:
            lib.obox(b, x + c * 0.2, y + s * 0.2, 0.0, 5.4, 2.0, 0.5, yaw, 'plain', '#1e1e20')


def silo(b, x, y, r, h, col):
    lib.cylinder(b, x, y, 0, h, r, n=12 if b.detail == 0 else 7, slot='metal-cladding', col=col, top=False, smooth=True)
    if b.detail < 2:
        lib.cylinder(b, x, y, h, h + r * 0.7, r, n=12 if b.detail == 0 else 7, slot='metal-cladding', col=lib.shade(col, 0.85), r_top=0.0, top=False, smooth=True)


def build_shedyard(b, brief, style, lk, fm, fs, txt, srng, rng, W, D):
    det = b.detail
    goods_kind = 'timber' if U.has(txt, 'timber', 'lumber', 'plank', 'wood') else ('yam' if U.has(txt, 'yam') else 'sacks')
    clad = '#9aa0a5' if (lk.wall_material in ('metal-cladding',) or U.has(txt, 'steel', 'warehouse')) else None
    roofm = fm['roof'] if fm['roof'] in ('gable', 'shed', 'hip') else 'gable'
    nrows = 2 if D < 50 else 3
    sd = U.clamp((D - 12) / nrows - 6, 9, 16)
    shed_h = 5.5 if roofm == 'gable' else 4.2
    if fm['H'] > 6 and clad:
        shed_h = U.clamp(fm['H'] * 0.62, 5.5, 8.0)
    gap = 5.0
    total = nrows * sd + (nrows - 1) * gap
    y0 = -total / 2 + 4
    gc = ['#d6c9a6', '#c9b98a', '#b8a77a'] if goods_kind != 'timber' else ['#a9825a']
    cols_u = stall_cols(brief, style, srng)
    b.section('sheds')
    for r in range(nrows):
        L = U.clamp(W * srng.uniform(0.55, 0.85), 30, 78)
        cx = srng.uniform(-(W - L) / 2, (W - L) / 2) * 0.6
        F = U.Frame(cx, y0 + r * (sd + gap), 0)
        U.shed_over_goods(b, F, L, sd, shed_h, lk, srng, roof=roofm, roof_col=roof_col_for(lk, srng), post_pitch=6.0, wall_col=lk.wall_col, clad=clad,
                          goods=gc, goods_kind=goods_kind, rise=sd * 0.16 if roofm == 'gable' else sd * 0.1)
    b.section('yard')
    F0 = U.Frame(0, 0, 0)
    if det < 2:
        n = int(U.clamp(U.fcount(fs, 'stalls', 8), 4, 24))
        stall_field(b, F0, -W / 2 + 2, -D / 2 + 2, W / 2 - 2, y0 - 2, srng, cols_u, n, 1.0, ('umbrella', 'tarp'), (4.0, 3.0))
        for k in range(2 if det == 0 else 1):
            truck(b, srng.uniform(-W / 2 + 8, W / 2 - 8), y0 - 7 - k * 3.0, srng.uniform(-0.12, 0.12) + (math.pi if k % 2 else 0), srng.choice(['#3f7fa6', '#b5483a', '#d8d2c2', '#4f8a5b']))
    if 'storage-tanks' in fs:
        for k in range(int(U.clamp(U.fcount(fs, 'storage-tanks', 2), 1, 4))):
            silo(b, W / 2 - 6 - k * 6.0, y0 + total + 5, 2.4, 9.5, '#b9bec3')
    if 'chimney' in fs:
        lib.cylinder(b, -W / 2 + 6, y0 + total + 6, 0, 22, 1.0, n=8 if det == 0 else 5, slot='brick', col='#9b5a43', r_top=0.65, top=True)
    return {'front': -D / 2}


# ------------------------------------------------------------------------------------------------------------------ yard (cattle)
def cow(b, x, y, yaw, col, scale=1.0):
    if b.detail >= 2:
        return
    s = scale
    c, sn = math.cos(yaw), math.sin(yaw)
    lib.obox(b, x, y, 0.55 * s, 1.9 * s, 0.7 * s, 0.75 * s, yaw, 'plain', col, skip=('bottom',))
    if b.detail == 0:
        lib.obox(b, x + c * 1.15 * s, y + sn * 1.15 * s, 0.9 * s, 0.6 * s, 0.38 * s, 0.38 * s, yaw, 'plain', lib.shade(col, 0.9), skip=('bottom',))
        for dx in (-0.7, 0.7):
            for dy in (-0.22, 0.22):
                px, py = x + (c * dx - sn * dy) * s, y + (sn * dx + c * dy) * s
                lib.cylinder(b, px, py, 0, 0.58 * s, 0.07 * s, n=4, slot='plain', col=lib.shade(col, 0.7), top=False, smooth=False)
        lib.obox(b, x + c * 0.75 * s, y + sn * 0.75 * s, 1.25 * s, 0.35 * s, 0.4 * s, 0.22 * s, yaw, 'plain', lib.shade(col, 0.85), skip=('bottom',))


def build_yard(b, brief, style, lk, fm, fs, txt, srng, rng, W, D):
    det = b.detail
    wall_slot = 'mud-render'
    b.section('wall')
    wh = 2.0
    pts = [(-W / 2, -D / 2), (-W / 2, D / 2), (W / 2, D / 2), (W / 2, -D / 2)]
    wc = lib.shade(lk.wall_col, 0.95)
    gate_w = 9.0
    U.fence_wall(b, pts, wh, 0.5, lk, wc, wall_slot, crenel=False, closed=False)
    U.fence_wall(b, [(-W / 2, -D / 2), (-gate_w / 2, -D / 2)], wh, 0.5, lk, wc, wall_slot)
    U.fence_wall(b, [(gate_w / 2, -D / 2), (W / 2, -D / 2)], wh, 0.5, lk, wc, wall_slot)
    U.gate(b, U.Frame(0, -D / 2, 0), 0.0, gate_w, 3.4, lk, col=wc, board=lk.accent_col)
    b.section('pens')
    n = U.fcount(fs, 'fence-wall', 4)
    cols_c = ['#e8e1cf', '#8a5a3a', '#2f2a26', '#b8a07a', '#d9d0bc']
    px0, px1 = -W / 2 + 6, W / 2 - 6
    cols_pen = int(U.clamp(W / 20, 3, 5))
    rows_pen = int(U.clamp(D / 18, 2, 3))
    pw = (px1 - px0) / cols_pen
    pdp = 13.0
    y_first = -D / 2 + 12.0
    for i in range(cols_pen):
        for j in range(rows_pen):
            x0 = px0 + i * pw + 1.2
            x1 = px0 + (i + 1) * pw - 1.2
            y0 = y_first + j * (pdp + 4.0)
            y1 = y0 + pdp
            rail(b, x0, y0, x1, y1)
            if det < 2:
                for k in range(3 if det == 0 else 2):
                    cow(b, srng.uniform(x0 + 2, x1 - 2), srng.uniform(y0 + 2, y1 - 2), srng.uniform(0, 2 * math.pi), srng.choice(cols_c), srng.uniform(0.9, 1.15))
    b.section('sheds')
    cols_u = stall_cols(brief, style, srng)
    F0 = U.Frame(0, 0, 0)
    for k in range(int(U.clamp(U.fcount(fs, 'sheds', 2), 1, 3))):
        sx = -W / 2 + 12 + k * (W - 24) / 2
        U.shed_over_goods(b, U.Frame(sx, D / 2 - 11, 0), 14, 7, 3.4, lk, srng, roof='shed', roof_col=roof_col_for(lk, srng), post_pitch=4.5, wall_col=lk.wall_col, goods=['#cfc3a0'], rise=1.0)
    for k in range(int(U.clamp(U.fcount(fs, 'kiosk', 2), 1, 4))):
        kiosk_box(b, U.Frame(-W / 2 + 7 + k * 9, -D / 2 + 3.5, 0), 0, 0, srng, cols_u)
    if det < 2:
        for k in range(int(U.clamp(U.fcount(fs, 'umbrellas', 4), 2, 8))):
            U.umbrella_stall(b, F0, srng.uniform(-W / 2 + 8, W / 2 - 8), srng.uniform(-D / 2 + 6, -D / 2 + 9), srng, cols_u, GOODS)
    return {'front': -D / 2, 'yard': True}


def rail(b, x0, y0, x1, y1):
    """Rail pen: posts and two slat bands round a rectangle (timber); bands are two-sided quads, posts triangular prisms."""
    if b.detail >= 2:
        return
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    for p0, p1 in zip(pts[:-1], pts[1:]):
        L = math.dist(p0, p1)
        zs = ((0.5, 0.68), (1.05, 1.23)) if b.detail == 0 else ((0.45, 1.25),)
        for (za, zb) in zs:
            q = [(p0[0], p0[1], za), (p1[0], p1[1], za), (p1[0], p1[1], zb), (p0[0], p0[1], zb)]
            b.face(q, 'timber', '#8a6a45', mode='fit')
            b.face(q[::-1], 'timber', '#7a5c3c', mode='fit')
        if b.detail == 0:
            n = int(L / 4.0) + 1
            for k in range(n):
                t = k / n
                lib.cylinder(b, p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, 0, 1.4, 0.08, n=3, slot='timber', col='#6f5238', top=False, smooth=False)


# ------------------------------------------------------------------------------------------------------------------ pits (dye)
def build_pits(b, brief, style, lk, fm, fs, txt, srng, rng, W, D):
    det = b.detail
    b.section('rampart')
    wc = lib.shade(lk.wall_col, 0.95)
    U.fence_wall(b, [(-W / 2 - 4, D / 2 + 2), (W / 2 + 4, D / 2 + 2)], 8.0, 2.4, lk, wc, 'mud-render', crenel=True)
    wh = 1.0
    b.section('wall')
    U.fence_wall(b, [(-W / 2, -D / 2 + 2), (-W / 2, D / 2 - 2)], wh, 0.5, lk, wc, 'mud-render')
    U.fence_wall(b, [(W / 2, -D / 2 + 2), (W / 2, D / 2 - 2)], wh, 0.5, lk, wc, 'mud-render')
    b.section('pits')
    cols = 9 if W > 60 else 6
    rows = 4 if D > 40 else 3
    px = (W - 14) / cols
    py = (D - 24) / rows
    indigo = ['#2f3f6b', '#26365e', '#3a4a7a', '#1f2c52']
    sx0 = -W / 2 + 8
    sy0 = -D / 2 + 12
    for i in range(cols):
        for j in range(rows):
            if srng.random() < 0.12:
                continue
            x = sx0 + (i + 0.5) * px + (0.0 if j % 2 == 0 else px * 0.2)
            y = sy0 + (j + 0.5) * py
            r = srng.uniform(0.85, 1.1)
            n = 12 if det == 0 else 7
            if det == 2:
                continue
            if det < 2:
                lib.cylinder(b, x, y, 0, 0.35, r + 0.45, n=n, slot='mud-render', col=lib.jitter(lk.wall_col, srng, 0.08), top=False, smooth=True)
                # rim top ring and the dark liquid
                b.facing([(x + (r + 0.45) * math.cos(2 * math.pi * k / n), y + (r + 0.45) * math.sin(2 * math.pi * k / n), 0.35) for k in range(n)], (0, 0, 1), 'mud-render', lib.shade(lk.wall_col, 0.9))
                b.facing([(x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n), 0.37) for k in range(n)], (0, 0, 1), 'plain', srng.choice(indigo))
            else:
                lib.cylinder(b, x, y, 0, 0.35, r + 0.45, n=6, slot='plain', col=srng.choice(indigo), top=True, smooth=False)
    # drying lines with indigo cloth
    b.section('cloth')
    if det < 2:
        for k in range(3):
            y = -D / 2 + 5 + k * 3.2
            x0 = -W / 2 + 10
            x1 = W / 2 - 10
            for sx in (x0, x1):
                lib.cylinder(b, sx, y, 0, 3.2, 0.07, n=4, slot='timber', col='#6f5238', top=False, smooth=False)
            m = int((x1 - x0) / 3.4)
            for q in range(m):
                xa = x0 + 1 + q * (x1 - x0 - 2) / m
                col = srng.choice(indigo + ['#3a5a9a', '#e8e1cf'])
                z1 = 3.0
                zl = srng.uniform(1.0, 1.8)
                pts = [(xa, y, z1), (xa + 2.2, y, z1), (xa + 2.2, y, zl), (xa, y, zl)]
                b.facing(pts, (0, -1, 0), 'plain', col)
                b.facing(pts[::-1], (0, 1, 0), 'plain', lib.shade(col, 0.8))
    b.section('sheds')
    cols_u = stall_cols(brief, style, srng)
    for k in range(int(U.clamp(U.fcount(fs, 'sheds', 3), 2, 4))):
        sx = -W / 2 + 12 + k * (W - 24) / 3
        F = U.Frame(sx, D / 2 - 9, 0)
        lockup_dispatch(b, F, 8.0, 3.6, 2.9, lk, srng, 'shed', 0.8, 2.6, 'mud-render', lk.wall_col, roof_col_for(lk, srng), ['#4a3a2c', '#5b4636'], True, GOODS)
    for k in range(int(U.clamp(U.fcount(fs, 'kiosk', 1), 0, 2))):
        kiosk_box(b, U.Frame(W / 2 - 8, -D / 2 + 4, 0), 0, 0, srng, cols_u)
    return {'front': -D / 2, 'pits': True}


# ------------------------------------------------------------------------------------------------------------------ build
def build(brief, style, rng, detail):
    seed = rng.getrandbits(64)
    return U.governed(lambda: _build(brief, style, random.Random(seed), detail), detail)


def _build(brief, style, rng, detail):
    b = lib.Builder('market-open', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    fm = U.form(brief)
    fs = U.feats(brief)
    txt = U.text(brief)
    typ = infer(brief, fm, fs, txt, lk)
    W = U.clamp(fm['W'], 40, 96)
    D = U.clamp(fm['D'], 26, 72)
    if typ == 'yard':
        W, D = U.clamp(fm['W'], 60, 92), U.clamp(fm['D'], 46, 70)
    if typ == 'pits':
        W, D = U.clamp(fm['W'], 50, 80), U.clamp(fm['D'], 36, 56)
    if typ == 'shedyard':
        W, D = U.clamp(fm['W'], 50, 92), U.clamp(fm['D'], 36, 66)
    if typ == 'street':
        W, D = U.clamp(fm['W'], 70, 100), U.clamp(fm['D'], 24, 44)
    fn = {'lockup': build_lockup, 'ring': build_ring, 'street': build_street, 'shedyard': build_shedyard, 'yard': build_yard, 'pits': build_pits}[typ]
    info = fn(b, brief, style, lk, fm, fs, txt, srng, rng, W, D)
    # ground, road, trees
    b.section('ground')
    padx = W / 2 + 6
    y_front = info.get('front', -D / 2)
    y0 = y_front - (14 if typ not in ('street',) else 12) - (14 if ('car-park' in fs) else 0)
    y1 = D / 2 + 5 if typ != 'street' else info.get('Dt', D) / 2 + 3
    if typ == 'street':
        padx = info['Wl'] / 2 + 3
        # street paving between the terraces, with kerbs
        sw = info['sw']
        with b.site():
            lib.ground(b, -padx, -info['Dt'] / 2 - 3, padx, info['Dt'] / 2 + 3, lk, 'paving', '#b6b0a6', z=0.0)
            if detail == 0:
                U.Frame(0, 0, 0).ground_quad(b, -info['Wl'] / 2, -sw / 2, info['Wl'] / 2, sw / 2, 0.03, 'paving', '#a8a299', 1.0)
        lib.forecourt(b, 'road', -padx + 1, -info['Dt'] / 2 - 13, padx - 1, -info['Dt'] / 2 - 3, lk, srng)
        trees_around(b, lk, srng, -padx + 6, padx - 6, -info['Dt'] / 2 - 2.0, 5)
    else:
        lib.ground(b, -padx, y0, padx, y1, lk, z=0.0)
        if detail < 2:
            F0 = U.Frame(0, 0, 0)
            # packed-earth lanes: slightly darker bands
            gc = lib.shade(lk.ground_col, 0.9)
            if typ in ('lockup',):
                for k in range(3):
                    yy = -D / 2 + 15 + k * 14
                    F0.ground_quad(b, -W / 2 + 6, yy, W / 2 - 6, yy + 4.0, 0.03, lk.ground_slot, gc, 1.0)
        front_yard(b, lk, fs, srng, W, D, y_front - 1.0, padx, True, brief, [])
        trees_around(b, lk, srng, -padx + 5, padx - 5, y_front - 3.0, 5)
        if 'flags' in fs:
            for k in range(3):
                flag_pole(b, -6 + 6 * k, y_front - 2.5, 9, ['#0b7a43', '#f2f2f2', '#b6323a'][k])
    # extras visible in all typologies
    if 'pier' in fs and detail < 2:
        # a strip of water beside the market with a timber jetty reaching into it
        with b.site():
            F = U.Frame(padx + 6.0, y_front + 2.0, 0)
            F.ground_quad(b, -6.0, -2.0, 10.0, D - 4.0, 0.04, 'plain', '#5f98b3', 1.0)
            F.box(b, -7.0, 8.0, 0.55, 5.0, 10.0, 0.75, 'timber', '#8a6a45', 'timber', '#a58559', skip=('bottom',))
            if detail == 0:
                for k in range(6):
                    F.cyl(b, -6.6 + k * 2.0, 8.2, 0.0, 0.55, 0.1, n=4, slot='timber', col='#6f5238', top=False, smooth=False)
                    F.cyl(b, -6.6 + k * 2.0, 9.8, 0.0, 0.55, 0.1, n=4, slot='timber', col='#6f5238', top=False, smooth=False)
    return b.objects()
