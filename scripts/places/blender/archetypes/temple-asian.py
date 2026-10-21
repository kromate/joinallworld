"""temple-asian: Hindu, Buddhist, Sikh, Chinese and Japanese sacred buildings in eight typologies chosen from the brief:

  hall      Chinese / Japanese / Korean temple hall: stone platform, red or timber columns, door and lattice bays, a curved hip roof with
            upturned eaves (single, double eave, or irimoya-like), ridge ornaments, stairs, gate (pailou / sanmon), courtyard with side halls
  shinto    a small Japanese shrine: torii gate, stone-flagged approach, haiden hall with a wide gabled roof, chigi and katsuogi on the ridge
  pagoda    3-9 storey tiered pagoda (square/hexagonal/octagonal plan) with upturned eaves or dense brick eaves, base platform, finial mast
  stupa     hemispherical Sanchi/Sri Lankan stupa (harmika, umbrellas, railing, toranas) or a gilded bell-shaped Burmese/Thai zedi on terraces
  wat       Thai/Lao/Khmer temple: ubosot with 2-3 overlapping steep gables, chofa finials, columned porch, plus a gilded chedi and sala
  shikhara  North Indian Hindu temple: plinth, mandapa with stepped pidha roof, curvilinear shikhara with amalaka and kalasha, optional
            subsidiary spires, dhvaja pole
  gopuram   South Indian Dravidian gateway tower of 5-9 diminishing tiers with niche rows and a barrel-vault crown, compound wall, vimana
  gurdwara  Sikh temple: white block with a gilded or white lotus dome, corner and parapet chhatris, arched portico, Nishan Sahib pole, sarovar

Layout (metres): main facade towards -Y; the temple stands at the back of its compound; x = 0 on the axis.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib  # noqa: E402
import _mosque_domed_util as U  # noqa: E402
from lib import mix, shade  # noqa: E402

FEATURES = {'pagoda-roof', 'stupa', 'dome', 'onion-dome', 'spire', 'gate', 'steps', 'courtyard', 'fence-wall', 'statue', 'flags', 'fountain',
            'arcade', 'colonnade', 'relief-pattern', 'pinnacles', 'mosaic', 'bell-tower', 'terrace', 'podium', 'arches', 'pavilion', 'minaret'}

TAU = math.tau
RED = '#a5322a'
GOLD = '#d4a82f'


def bx(b, *a, **kw):
    if b.detail >= 1:
        kw.setdefault('scale', 6.0)
    lib.box(b, *a, **kw)


def bxc(b, *a, **kw):
    if b.detail >= 1:
        kw.setdefault('scale', 6.0)
    lib.box_c(b, *a, **kw)


def warnings(brief, style):
    w = []
    for f in (brief.get('features') or []):
        fid = f.get('id') if isinstance(f, dict) else f
        if fid == 'minaret':
            w.append('minaret ignored in a temple')
    return w


# ================================================================================================================ design
def design(brief, style, rng, lk):
    F = U.form_of(brief)
    ft = U.feats(brief)
    txt = U.text(brief, style)
    st = brief.get('style') or ''
    r = [rng.random() for _ in range(40)]
    W, Dp, H = F['w'], F['d'], F['h']
    if H <= 0:
        H = 9.0
    variant = F['variant']
    typ = None
    for key in ('shinto', 'pagoda', 'stupa', 'wat', 'shikhara', 'gopuram', 'gurdwara', 'hall', 'lotus', 'yurt', 'pura', 'octhall', 'chorten'):
        if key in variant:
            typ = {'chorten': 'stupa'}.get(key, key)
            break
    hw = lambda *w: U.has_word(txt, *w)
    round_fp = F['fp'] in ('round', 'oval')
    if typ is None:
        if hw('gurdwara', 'sikh', 'harmandir', 'nishan'):
            typ = 'gurdwara'
        elif hw('lotus') and round_fp or 'lotus' in variant:
            typ = 'lotus'
        elif hw('yurt', 'ger-shaped', 'ger shaped', 'gher'):
            typ = 'yurt'
        elif hw('balinese', 'pura ', 'candi bentar', 'meru'):
            typ = 'pura'
        elif hw('shinto', 'torii', 'jinja', 'kami', 'taisha', 'inari'):
            typ = 'shinto'
        elif hw('gopuram', 'dravidian', 'tamil', 'south indian', 'kovil', 'vimana', 'meenakshi', 'murugan', 'madurai'):
            typ = 'gopuram'
        elif hw('chorten', 'tibetan-style white stupa'):
            typ = 'stupa'
        elif (hw('stupa', 'chedi', 'zedi', 'dagoba', 'dagaba', 'shwedagon', 'sanchi', 'borobudur') or ('stupa' in ft and not ('pagoda-roof' in ft)))\
                and not hw('ubosot', 'wat ', 'wat,', 'gable', 'vihara', 'ordination'):
            typ = 'stupa'
        elif hw('wat ', 'wat,', 'ubosot', 'thai', 'lao', 'khmer', 'cambodia', 'laos', 'thailand', 'angkor', 'sim ') or (st == 'southeast-asian' and not hw('stupa')):
            typ = 'wat'
        elif hw('newar', 'kasthamandap', 'nepal', 'kathmandu') and (ft.get('pagoda-roof', {}).get('count', 0) >= 2 or hw('pagoda')):
            typ = 'pagoda'
        elif (hw('pagoda') and not hw('hall', 'temple', 'monastery', 'vihara', 'chua', 'ordination')) or \
                (ft.get('pagoda-roof', {}).get('count', 0) >= 3 and H / max(min(W, Dp), 1) >= 1.3) or (H / max(min(W, Dp), 1) > 1.8 and st == 'east-asian'):
            typ = 'pagoda'
        elif round_fp and (st in ('mughal', 'south-asian')) and (ft.get('dome') or hw('octagonal')):
            typ = 'octhall'
        elif hw('shikhara', 'shikhar', 'nagara', 'mandir', 'hindu', 'iskcon', 'swaminarayan', 'akshardham', 'jain', 'shiva', 'vishnu', 'krishna', 'hanuman',
                'ganesh', 'durga', 'lakshmi') or st == 'south-asian':
            typ = 'shikhara'
        else:
            typ = 'hall'
    D = {'type': typ, 'r': r, 'ft': ft, 'txt': txt, 'H': H, 'F': F, 'st': st}
    D['japan'] = U.has_word(txt, 'japan', 'kyoto', 'nara', 'tokyo', 'shinto', 'jinja', 'dera', 'kamakura', 'osaka') or 'zen' in txt.split()
    D['korea'] = U.has_word(txt, 'korea', 'seoul')
    D['gate'] = 'gate' in ft
    D['court'] = 'courtyard' in ft or 'fence-wall' in ft
    D['fence'] = 'fence-wall' in ft or 'courtyard' in ft or 'gate' in ft
    D['steps'] = 'steps' in ft
    D['statue'] = 'statue' in ft
    D['flags'] = 'flags' in ft
    D['relief'] = 'relief-pattern' in ft or 'mosaic' in ft
    D['pinn'] = 'pinnacles' in ft
    D['tiers'] = int(ft.get('pagoda-roof', {}).get('count', 0) or 0)
    D['nstupa'] = ft.get('stupa', {}).get('count', 0)
    D['spire'] = 'spire' in ft
    D['dome'] = 'dome' in ft or 'onion-dome' in ft
    D['ndome'] = ft.get('dome', {}).get('count', 0) + ft.get('onion-dome', {}).get('count', 0)
    D['chorten'] = hw('chorten') or hw('tibetan') or hw('bhutan')
    D['conf'] = brief.get('confidence', 'low')
    marg = 3.0 if D['fence'] else 0.0
    sc = U.fit_scale(W + 2 * marg, Dp + 2 * marg)
    D['sc'] = sc
    D['W'], D['D'] = W * sc, Dp * sc
    D['marg'] = marg
    D['wall'], D['wslot'] = lk.wall_col, lk.wall_slot
    D['accent'], D['trim'] = lk.accent_col, lk.trim_col
    D['roofc'] = lk.roof_col
    f = brief.get('facade') or {}
    rm = f.get('roofMaterial')
    if U.goldish(lk.roof_col) or rm in ('gold-leaf', 'copper', 'metal-sheet', 'corrugated'):
        D['rslot'] = 'metal-roof'
    elif rm == 'slate':
        D['rslot'] = 'slate'
    elif rm in ('concrete', 'membrane'):
        D['rslot'] = 'roof-flat'
    else:
        D['rslot'] = 'clay-tile'
    D['gold'] = U.goldish(lk.roof_col)
    D['lean'] = 0
    return D


# ================================================================================================================ primitives
def rect_pts(cx, cy, hw, hd):
    return [(cx - hw, cy - hd), (cx + hw, cy - hd), (cx + hw, cy + hd), (cx - hw, cy + hd)]


def curved_hip(b, D, cx, cy, z, w, d, rise, ov, up, slot, col, fascia_col=None, p=1.55, ridge=True, fascia=0.3, ridge_col=None):
    """Chinese/Japanese hip roof: concave slopes, eaves swept up at the corners. Eave rectangle is (w + 2 ov) x (d + 2 ov) at height z,
    the ridge is `rise` above. Returns the top z."""
    m = {0: 8, 1: 4, 2: 1}[b.detail] if b.detail < 2 else 1
    rings = {0: 6, 1: 3, 2: 1}[b.detail]
    hwe, hde = w / 2 + ov, d / 2 + ov
    rlx, rly = max(0.0, (w - d) / 2), max(0.0, (d - w) / 2)
    grid = []
    # perimeter points (CCW from the front-left corner), each side has m points (corner included, end excluded)
    per = []
    for side in range(4):
        for i in range(m):
            per.append((side, i / m))
    for (side, f) in per:
        col_pts = []
        for k in range(rings + 1):
            t = k / rings
            hw = hwe * (1 - t) + rlx * t
            hd = hde * (1 - t) + rly * t
            if side == 0:
                x, y, s = -hw + 2 * hw * f, -hd, abs(2 * f - 1)
            elif side == 1:
                x, y, s = hw, -hd + 2 * hd * f, abs(2 * f - 1)
            elif side == 2:
                x, y, s = hw - 2 * hw * f, hd, abs(2 * f - 1)
            else:
                x, y, s = -hw, hd - 2 * hd * f, abs(2 * f - 1)
            zz = z + rise * (t ** p) + up * (s ** 3) * ((1 - t) ** 1.6)
            col_pts.append((cx + x, cy + y, zz))
        grid.append(col_pts)
    grid.append(grid[0])
    b.shared_grid(grid, slot, col, smooth=False, wrap=True, scale=1.2)
    top = z + rise
    if b.detail < 2 and fascia > 0:
        outer = [g[0] for g in grid[:-1]]
        low = [(p_[0], p_[1], p_[2] - fascia) for p_ in outer]
        fascia_loft(b, [low, outer], D['wslot'], fascia_col or D['trim'])
    if ridge and rlx > 0.6 and b.detail < 2:
        rl = rlx
        lib.box(b, cx - rl, cy - 0.28, top - 0.05, cx + rl, cy + 0.28, top + 0.42, 'plain-render', ridge_col or shade(col, 0.8))
        if b.detail == 0:
            for sx in (-1, 1):   # raised ridge-end ornaments (chiwen)
                lib.box(b, cx + sx * rl - (0.2 if sx > 0 else 0.0) - (0.0 if sx > 0 else 0.0), cy - 0.2, top + 0.4, cx + sx * (rl + 0.35) + (0.0), cy + 0.2, top + 1.1,
                        'plain-render', ridge_col or shade(col, 0.8))
    elif ridge and rlx <= 0.6 and rly <= 0.6 and b.detail < 2:
        # a pyramidal top: finial
        U.cone(b, cx, cy, top, top + 0.9, 0.35, 6, 'plain-render', ridge_col or shade(col, 0.8), smooth=False)
    return top


def fascia_loft(b, rings, slot, col):
    """Quads between two rings given as perimeter point lists (counter-clockwise from above), ring[0] lower."""
    a, c = rings
    n = len(a)
    for i in range(n):
        j = (i + 1) % n
        b.face([a[i], a[j], c[j], c[i]], slot, col)


def columns_ring(b, D, cx, cy, z0, z1, hw, hd, pitch, r, col, skip_front_mid=0.0):
    """Posts round a rectangle (hw, hd half-sizes) plus an architrave beam ring on top."""
    d = b.detail
    if d >= 2:
        return
    nx = max(2, int(round(2 * hw / pitch)))
    ny = max(1, int(round(2 * hd / pitch)))
    pts = []
    for i in range(nx + 1):
        x = cx - hw + 2 * hw * i / nx
        pts.append((x, cy - hd))
        pts.append((x, cy + hd))
    for j in range(1, ny):
        y = cy - hd + 2 * hd * j / ny
        pts.append((cx - hw, y))
        pts.append((cx + hw, y))
    for (x, y) in pts:
        if d == 0:
            lib.cylinder(b, x, y, z0, z1, r, n=6, slot='timber', col=col, top=False, smooth=False)
        else:
            bxc(b, x, y, z0, r * 1.7, r * 1.7, z1 - z0, 'timber', col, skip=('bottom', 'top'))
    bh = 0.45
    for (x0, y0, x1, y1) in ((cx - hw, cy - hd, cx + hw, cy - hd), (cx - hw, cy + hd, cx + hw, cy + hd), (cx - hw, cy - hd, cx - hw, cy + hd), (cx + hw, cy - hd, cx + hw, cy + hd)):
        lib.beam(b, (x0, y0), (x1, y1), z1 - bh, z1, 0.42, 'timber', shade(col, 0.85))


def platform(b, D, cx, cy, w, d, hs, col, tiers=2, slot='stone-blocks', inset=0.7):
    """Stepped stone platform, tiers each `hs/tiers` tall and `inset` narrower; returns (top z, top half-w, top half-d)."""
    z = 0.0
    hw, hd = w / 2, d / 2
    ht = hs / tiers
    for k in range(tiers):
        bx(b, cx - hw, cy - hd, z, cx + hw, cy + hd, z + ht, slot, shade(col, 1.0 - 0.05 * k), top_slot=slot, top_col=shade(col, 1.08), skip=('bottom',), scale=1.0 if b.detail == 0 else 5.0)
        z += ht
        hw -= inset
        hd -= inset
    return z, hw + inset, hd + inset


def stair_front(b, D, cx, y_face, width, z_top, depth, col, rails=True):
    n = max(3, int(z_top / 0.22)) if b.detail == 0 else 3
    n = min(n, 9)
    if z_top < 0.1:
        return
    lib.steps(b, cx - width / 2, cx + width / 2, y_face, z_top, depth, n, 'paving', col)
    if rails and b.detail == 0 and z_top > 0.5:
        for sx in (-1, 1):
            U.railing(b, (cx + sx * (width / 2 + 0.1), y_face), (cx + sx * (width / 2 + 0.1), y_face - depth), z_top, 0.7, col)


def gable_end_fill(b, D, x, y0, y1, z, rise, col, slot='plain-render'):
    pass


def finial_mast(b, D, cx, cy, z, h, col, rings=9):
    """Pagoda sorin: pole with stacked discs, a water-flame and a point."""
    d = b.detail
    if d >= 2:
        lib.cylinder(b, cx, cy, z, z + h, 0.2, n=4, slot='plain', col=col, r_top=0.0, top=False, smooth=False)
        return
    lib.cylinder(b, cx, cy, z, z + h, 0.1, n=5, slot='frame', col=shade(col, 0.8), top=False)
    nr = rings if d == 0 else 3
    for k in range(nr):
        zz = z + h * (0.12 + 0.52 * k / max(1, nr - 1))
        rr = 0.55 - 0.28 * k / max(1, nr - 1)
        lib.cylinder(b, cx, cy, zz, zz + 0.12, rr * (h / 6.0 if h > 6 else 1.0) * 0.9, n=8 if d == 0 else 6, slot='plain-render', col=col, top=True)
    U.revolve(b, cx, cy, z + h * 0.72, [(0.35, 0), (0.5, h * 0.06), (0.3, h * 0.14), (0.0, h * 0.26)], 6, 'plain-render', col, smooth=True, cap=False)


def lantern_stone(b, D, x, y, s=1.0):
    if b.detail >= 1:
        return
    c = '#9a9a94'
    lib.cylinder(b, x, y, 0, 0.9 * s, 0.14 * s, n=5, slot='stone-blocks', col=c, top=True)
    bxc(b, x, y, 0.9 * s, 0.55 * s, 0.55 * s, 0.45 * s, 'stone-blocks', shade(c, 0.85))
    lib.hip(b, (x - 0.45 * s, y - 0.45 * s, x + 0.45 * s, y + 0.45 * s), 1.35 * s, 0.35 * s, lib.look({}, {}), ov=0.0, slot='stone-blocks', col=c) if False else \
        U.cone(b, x, y, 1.35 * s, 1.75 * s, 0.5 * s, 4, 'stone-blocks', c, smooth=False)


def wall_ring(b, D, x0, y0, x1, y1, h, gate_w, col, tile_col, slot, cap_h=0.35, pitch_col=None):
    """Enclosure wall (x0..x1, y0..y1) with a tile cap; the front wall (y0) has a gap of gate_w at x = 0."""
    sc = 1.0 if b.detail == 0 else 6.0
    t = 0.45
    segs = []
    if gate_w > 0:
        segs += [(x0, y0, -gate_w / 2, y0 + t), (gate_w / 2, y0, x1, y0 + t)]
    else:
        segs += [(x0, y0, x1, y0 + t)]
    segs += [(x0, y1 - t, x1, y1), (x0, y0, x0 + t, y1), (x1 - t, y0, x1, y1)]
    for (a0, b0, a1, b1) in segs:
        if a1 - a0 < 0.1 or b1 - b0 < 0.1:
            continue
        lib.box(b, a0, b0, 0, a1, b1, h, slot, col, top_slot='roof-flat', top_col=tile_col, skip=('bottom',), scale=sc)
        if b.detail == 0:
            lib.box(b, a0 - 0.12, b0 - 0.12, h, a1 + 0.12, b1 + 0.12, h + cap_h, 'clay-tile', tile_col, skip=('bottom',))


# ================================================================================================================ hall / shinto
def hall_palette(D, lk):
    """Colours for a Chinese/Japanese/Korean hall from the brief with typology fallbacks."""
    if D['japan']:
        return {'body': lk.wall_col, 'col': '#5b3a29' if luma_dark(lk.accent_col) is False else lk.accent_col, 'platform': '#8f8c85'}
    return {'body': lk.wall_col, 'col': lk.accent_col, 'platform': '#bdb6a8'}


def luma_dark(h):
    return U.luma(h) < 0.35


def door_bay(b, D, cx, y, z0, w, h, col):
    """Dark double door with a frame on a wall at y facing -Y."""
    if b.detail >= 2:
        return
    b.face([(cx - w / 2, y - 0.03, z0), (cx + w / 2, y - 0.03, z0), (cx + w / 2, y - 0.03, z0 + h), (cx - w / 2, y - 0.03, z0 + h)], 'glass-punched', '#e0e4e6')
    if b.detail == 0:
        for sx in (-1, 1):
            b.face([(cx + sx * w / 2, y - 0.06, z0), (cx + sx * (w / 2 - 0.12), y - 0.06, z0), (cx + sx * (w / 2 - 0.12), y - 0.06, z0 + h), (cx + sx * w / 2, y - 0.06, z0 + h)][::sx], 'timber', col)
        b.face([(cx - w / 2, y - 0.06, z0 + h - 0.12), (cx + w / 2, y - 0.06, z0 + h - 0.12), (cx + w / 2, y - 0.06, z0 + h), (cx - w / 2, y - 0.06, z0 + h)], 'timber', col)


def build_hall(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    pal = hall_palette(D, lk)
    japan = D['japan']
    court = D['court']
    # main hall footprint
    hw = U.clamp(W * (0.55 if court else 0.78), 7, 40)
    hd = U.clamp(Dp * (0.42 if court else 0.7), 6, 30)
    hw = min(hw, W - 2.0)
    hd = min(hd, Dp - 4.0)
    if hw < hd:
        hw, hd = hd, hw
    plat_h = 1.0 if not japan else 0.9
    ptop, phw, phd = platform(b, D, 0.0, 0.0, hw + 3.0, hd + 3.0, plat_h, pal['platform'], tiers=2 if hw > 14 else 1, inset=0.6)
    # place the hall so its back is at +Dp/2
    cy = Dp / 2 - hd / 2 - 2.2
    # shift everything built so far? the platform is built at origin -> rebuild at cy: simply translate via a new builder pass
    return None


def build_hall_impl(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    pal = hall_palette(D, lk)
    japan = D['japan']
    court = D['court']
    hw = U.clamp(W * (0.5 if court else 0.78), 7, 40)
    hd = U.clamp(Dp * (0.38 if court else 0.7), 6, 30)
    hw = min(hw, W - 2.0)
    hd = min(hd, Dp - 6.0 if court else Dp - 2.0)
    if hw < hd * 1.05:
        hw = hd * 1.25 + 1.0
    cy = Dp / 2 - hd / 2 - 2.4
    plat_h = 1.0 if not japan else 0.8
    b.section('platform')
    ptop = _platform_at(b, D, 0.0, cy, hw + 4.0, hd + 4.0, plat_h, pal['platform'], tiers=2 if hw > 14 else 1)
    # body
    b.section('body')
    tiers = max(1, min(3, D['tiers'] or (2 if (D['F']['storeys'] >= 2 or H > 14) else 1)))
    total_h = H
    body_h = U.clamp(total_h * (0.34 if tiers == 1 else 0.28), 3.4, 10.0)
    z0 = ptop
    bw, bd = hw - 1.4, hd - 1.4
    # inner wall block
    wall_col = pal['body']
    ws = D['wslot']
    bx(b, -bw / 2, cy - bd / 2, z0, bw / 2, cy + bd / 2, z0 + body_h, ws, wall_col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
    # front bays: door in the middle, lattice windows
    fy = cy - bd / 2
    if b.detail < 2:
        nb = max(3, int(bw / 3.2)) | 1
        bwid = bw / nb
        for k in range(nb):
            xc = -bw / 2 + bwid * (k + 0.5)
            if k == nb // 2:
                door_bay(b, D, xc, fy, z0, bwid * 0.72, body_h * 0.78, pal['col'])
            elif b.detail == 0:
                b.face([(xc - bwid * 0.3, fy - 0.03, z0 + body_h * 0.18), (xc + bwid * 0.3, fy - 0.03, z0 + body_h * 0.18), (xc + bwid * 0.3, fy - 0.03, z0 + body_h * 0.72), (xc - bwid * 0.3, fy - 0.03, z0 + body_h * 0.72)],
                       'glass-punched', '#d6dade')
    columns_ring(b, D, 0.0, cy, z0, z0 + body_h, bw / 2 + 0.7, bd / 2 + 0.7, 3.4 if not japan else 3.0, 0.24, pal['col'])
    # deck of the verandah
    zr = z0 + body_h
    # roofs
    b.section('roof')
    rcol = D['roofc']
    rs = D['rslot']
    ov = 1.8 if not japan else 2.4
    up = 0.9 if not japan else 0.35
    if tiers == 1:
        rise = U.clamp((total_h - plat_h - body_h), 2.0, 12.0)
        top = curved_hip(b, D, 0.0, cy, zr, bw + 1.4, bd + 1.4, rise, ov, up, rs, rcol, pal['col'])
        if japan and D['F']['roof'] == 'gable':
            pass
    else:
        # lower skirt roof, a short clerestory block, then the upper roof
        low_rise = U.clamp(body_h * 0.45, 1.4, 3.6)
        curved_hip(b, D, 0.0, cy, zr, bw + 1.4, bd + 1.4, low_rise, ov, up, rs, rcol, pal['col'], ridge=False)
        zc = zr + low_rise * 0.8
        cw, cd = bw * 0.7, bd * 0.7
        ch = U.clamp(body_h * 0.55, 2.2, 5.0)
        bx(b, -cw / 2, cy - cd / 2, zc, cw / 2, cy + cd / 2, zc + ch, ws, wall_col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        if b.detail < 2:
            nb = max(2, int(cw / 3.0))
            for k in range(nb):
                xc = -cw / 2 + cw / nb * (k + 0.5)
                b.face([(xc - 0.45, cy - cd / 2 - 0.03, zc + ch * 0.2), (xc + 0.45, cy - cd / 2 - 0.03, zc + ch * 0.2), (xc + 0.45, cy - cd / 2 - 0.03, zc + ch * 0.75), (xc - 0.45, cy - cd / 2 - 0.03, zc + ch * 0.75)],
                       'glass-punched', '#d6dade')
        zr2 = zc + ch
        rise = U.clamp(total_h - plat_h - body_h - low_rise * 0.8 - ch, 2.0, 10.0)
        top = curved_hip(b, D, 0.0, cy, zr2, cw + 0.8, cd + 0.8, rise, ov * 0.7, up, rs, rcol, pal['col'])
        if tiers == 3:
            pass
    if D['gold'] or True:
        pass
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    # stair
    stair_front(b, D, 0.0, cy - hd / 2 - 2.0, U.clamp(bw * 0.28, 3.0, 8.0), ptop, 2.4 if ptop < 1.2 else 3.0, shade(pal['platform'], 1.05))
    # incense burner and lanterns in the court
    b.section('court')
    if court:
        gate_w = 4.6
        x0, x1 = -W / 2 + 0.3, W / 2 - 0.3
        y0 = -Dp / 2 + 0.3
        y1 = Dp / 2 - 0.3
        wall_ring(b, D, x0, y0, x1, y1, 2.6, gate_w, shade(D['wall'], 0.95), rcol, ws)
        # side halls
        if W > 28 and b.detail < 2:
            sw = 5.0
            for sx in (-1, 1):
                sxc = sx * (W / 2 - 3.4)
                sy0 = cy - hd * 0.1
                sd = hd * 0.9 + 2.0
                bx(b, sxc - sw / 2, sy0 - sd / 2, 0, sxc + sw / 2, sy0 + sd / 2, 3.0, ws, wall_col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
                curved_hip(b, D, sxc, sy0, 3.0, sw + 0.6, sd + 0.6, 2.2, 1.0, 0.45, rs, rcol, pal['col'])
        if b.detail == 0:
            cyb = cy - hd / 2 - 7.0
            lib.cylinder(b, 0.0, cyb, 0, 0.8, 0.9, n=8, slot='stone-blocks', col='#6a6862', top=True)
            lib.cylinder(b, 0.0, cyb, 0.8, 1.7, 0.6, n=8, slot='stone-blocks', col='#7a7872', top=True)
            for sx in (-1, 1):
                lantern_stone(b, sx * 4.0, cyb + 2.0, 1.0)
        # gate: pailou / sanmon in the front wall
        gh = 5.0
        _gate_hall(b, D, 0.0, y0 + 0.2, gate_w + 2.0, gh, pal, rs, rcol, japan)
    ext = [-W / 2, -Dp / 2 if court else cy - hd / 2 - 4.0, W / 2, Dp / 2]
    if D['statue'] and b.detail == 0:
        bxc(b, 0.0, cy - hd / 2 - 5.0, 0, 1.4, 1.4, 1.0, 'stone-blocks', '#8a8780')
        lib.cylinder(b, 0.0, cy - hd / 2 - 5.0, 1.0, 3.2, 0.45, n=6, slot='plain-render', col=GOLD, r_top=0.3)
    return tuple(ext)


def _platform_at(b, D, cx, cy, w, d, hs, col, tiers=2):
    z = 0.0
    hw, hd = w / 2, d / 2
    ht = hs / tiers
    for k in range(tiers):
        bx(b, cx - hw, cy - hd, z, cx + hw, cy + hd, z + ht, 'stone-blocks', shade(col, 1.0 - 0.05 * k), top_slot='paving', top_col=shade(col, 1.08), skip=('bottom',),
           scale=1.0 if b.detail == 0 else 5.0)
        z += ht
        hw -= 0.7
        hd -= 0.7
    return z


def _gate_hall(b, D, cx, y, w, h, pal, rs, rcol, japan):
    """Three-bay gate: two posts each side, lintels and a small curved roof over the middle (paifang / sanmon)."""
    col = pal['col']
    d = b.detail
    for sx in (-1, 1):
        for off in (0.0, 1.0):
            x = cx + sx * (w / 2 - off * 1.0)
            if d == 0:
                lib.cylinder(b, x, y, 0, h, 0.28, n=6, slot='timber', col=col, top=False, smooth=False)
            else:
                bxc(b, x, y, 0, 0.55, 0.55, h, 'timber', col, skip=('bottom',))
    lib.beam(b, (cx - w / 2, y), (cx + w / 2, y), h - 0.6, h, 0.5, 'timber', shade(col, 0.9))
    curved_hip(b, D, cx, y, h, w - 0.4, 1.8, 1.4, 0.9, 0.5, rs, rcol, col, fascia=0.25)
    if d < 2:
        for sx in (-1, 1):
            curved_hip(b, D, cx + sx * (w / 2 - 0.5), y, h - 1.2, 1.8, 1.4, 0.8, 0.6, 0.3, rs, rcol, col, ridge=False, fascia=0.2)


def build_shinto(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    pal = {'body': '#e8e0cc' if U.luma(lk.wall_col) < 0.5 else lk.wall_col, 'col': '#b5342a', 'platform': '#8f8c85'}
    hw = U.clamp(W * 0.5, 6, 22)
    hd = U.clamp(Dp * 0.38, 5, 14)
    cy = Dp / 2 - hd / 2 - 2.0
    b.section('platform')
    ptop = _platform_at(b, D, 0.0, cy, hw + 2.4, hd + 2.4, 1.4, '#9a8f7e', tiers=2)
    # raised wooden floor, walls, pillars
    b.section('body')
    z0 = ptop + 0.35
    bxc(b, 0.0, cy, ptop, hw, hd, 0.35, 'timber', '#6b4a30', skip=('bottom',))
    bh = U.clamp(H * 0.38, 2.8, 5.5)
    bxc(b, 0.0, cy, z0, hw - 1.2, hd - 1.2, bh, D['wslot'], pal['body'], skip=('bottom', 'top'))
    columns_ring(b, D, 0.0, cy, z0, z0 + bh, hw / 2 - 0.2, hd / 2 - 0.2, 2.6, 0.22, '#6b4a30')
    if b.detail < 2:
        door_bay(b, D, 0.0, cy - (hd - 1.2) / 2, z0, 1.6, bh * 0.75, '#6b4a30')
    # wide gabled roof (kirizuma / irimoya-like): curved hip with a long ridge and crossed chigi
    b.section('roof')
    rise = U.clamp(H - ptop - bh, 2.4, 7.0)
    top = curved_hip(b, D, 0.0, cy, z0 + bh, hw + 1.0, hd + 1.0, rise, 2.2, 0.3, 'roof-flat' if D['rslot'] == 'clay-tile' else D['rslot'], D['roofc'], '#6b4a30')
    if b.detail < 2:
        rl = (hw - hd) / 2 if hw > hd else 0.4
        for sx in (-1, 1):
            xe = sx * (rl + 0.4)
            for sgn in (-1, 1):
                lib.beam(b, (xe, cy - 0.15), (xe + sx * 0.6 * sgn, cy + 0.15 * sgn), top + 0.1, top + 1.3, 0.12, 'timber', '#d8d2c2') if False else None
            lib.box(b, xe - 0.1, cy - 0.5, top + 0.2, xe + 0.1, cy + 0.5, top + 1.7, 'timber', '#d8d2c2', skip=('bottom',))
        for k in range(3):
            xk = (k - 1) * 1.6
            lib.cylinder(b, xk, cy, top + 0.3, top + 0.75, 0.2, n=5, slot='timber', col='#d8d2c2', top=True) if b.detail == 0 else None
    stair_front(b, D, 0.0, cy - hd / 2 - 1.5, 2.8, ptop, 2.0, '#9a8f7e', rails=False)
    # torii gate on the approach
    b.section('torii')
    ty = cy - hd / 2 - 9.0
    _torii(b, D, 0.0, ty, 5.4, 4.6, '#b5342a')
    if b.detail == 0:
        for k, sx in enumerate((-1, 1)):
            lantern_stone(b, sx * 2.8, cy - hd / 2 - 4.5, 1.1)
        lib.box(b, -0.9, ty - 0.1, 0.01, 0.9, cy - hd / 2 - 3.2, 0.1, 'paving', '#b8b4aa', skip=('bottom',), scale=2.0) if False else None
    ext = (-W / 2, ty - 3.0, W / 2, Dp / 2)
    if D['fence']:
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 1.6, 8.0, '#d8d2c2', '#3d3d3b', D['wslot'])
        ext = (-W / 2, -Dp / 2, W / 2, Dp / 2)
    return ext


def _torii(b, D, cx, y, w, h, col):
    d = b.detail
    r = 0.26
    for sx in (-1, 1):
        x = cx + sx * (w / 2 - 0.4)
        lib.cylinder(b, x, y, 0, h, r, n=6 if d == 0 else 4, slot='timber', col=col, r_top=r * 0.88, top=False, smooth=False)
    lib.beam(b, (cx - w / 2 + 0.1, y), (cx + w / 2 - 0.1, y), h - 1.0, h - 0.75, 0.3, 'timber', col)
    # kasagi: slightly upturned top beam, with black cap
    for sgn in (0,):
        lib.box(b, cx - w / 2 - 0.6, y - 0.3, h - 0.3, cx + w / 2 + 0.6, y + 0.3, h + 0.1, 'timber', '#2a2a2a', skip=('bottom',))
        lib.box(b, cx - w / 2 - 0.5, y - 0.25, h - 0.55, cx + w / 2 + 0.5, y + 0.25, h - 0.3, 'timber', col, skip=('bottom',))


# ================================================================================================================ pagoda
def build_pagoda(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    n = D['tiers'] if D['tiers'] >= 3 else (D['F']['storeys'] if D['F']['storeys'] >= 3 else (5 if r[2] < 0.6 else (7 if r[2] < 0.85 else 3)))
    n = int(U.clamp(n, 2 if U.has_word(D['txt'], 'newar', 'kathmandu', 'nepal') else 3, 9))
    brick = lk.wall_material in ('brick', 'red-brick', 'stone', 'sandstone', 'limestone', 'granite', 'marble') and not D['japan']
    sides = 8 if (brick and r[3] < 0.6) or U.has_word(D['txt'], 'octagon') else (6 if U.has_word(D['txt'], 'hexagon') else 4)
    base_w = U.clamp(min(W, Dp) * 0.5, 5, 24)
    pal_col = lk.accent_col if not brick else shade(lk.wall_col, 0.85)
    body_col = lk.wall_col
    # platform
    plat_h = 1.4
    ptop = _platform_at(b, D, 0.0, 0.0, base_w + 8.0, base_w + 8.0, plat_h, '#a39d90', tiers=2)
    b.section('storeys')
    # storey heights shrink gently going up
    total = H - plat_h - 0.1
    mast_h = total * 0.14
    shaft_h = total - mast_h
    ws_ = [1.0 - 0.07 * k for k in range(n)]
    sh = [1.0 - 0.05 * k for k in range(n)]
    norm = sum(sh)
    z = ptop
    rs = D['rslot']
    rc = D['roofc']
    gold = U.goldish(rc)
    for k in range(n):
        wk = base_w * (1.0 - 0.58 * (k / max(1, n - 1)) * (1.0 if n > 1 else 0))
        hk = shaft_h * sh[k] / norm
        body_h = hk * (0.62 if not brick else 0.7)
        roof_rise = hk * (0.38 if not brick else 0.28)
        if sides == 4:
            bxc(b, 0.0, 0.0, z, wk * 0.78, wk * 0.78, body_h, D['wslot'], body_col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
            if b.detail < 2:
                # a door/window on each visible face
                for (px, py, pyaw) in ((0.0, -wk * 0.39, 0),):
                    door_bay(b, D, 0.0, -wk * 0.39, z, wk * 0.22, body_h * 0.7, pal_col) if k == 0 else b.face([(-wk * 0.1, -wk * 0.39 - 0.03, z + body_h * 0.2), (wk * 0.1, -wk * 0.39 - 0.03, z + body_h * 0.2), (wk * 0.1, -wk * 0.39 - 0.03, z + body_h * 0.75), (-wk * 0.1, -wk * 0.39 - 0.03, z + body_h * 0.75)], 'glass-punched', '#d6dade')
            if b.detail == 0:
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        lib.cylinder(b, sx * wk * 0.39, sy * wk * 0.39, z, z + body_h, 0.2, n=5, slot='timber', col=pal_col, top=False, smooth=False)
        else:
            R_ = wk * 0.42
            lib.cylinder(b, 0.0, 0.0, z, z + body_h, R_, n=sides if b.detail < 2 else min(sides, 6), slot=D['wslot'], col=body_col, top=False, smooth=False)
        zt = z + body_h
        # eaves
        ov = wk * (0.34 if not brick else 0.2)
        if sides == 4:
            curved_hip(b, D, 0.0, 0.0, zt, wk * 0.9, wk * 0.9, roof_rise, ov * 0.8, 0.5 * (1 + 0.1 * (n - k) / n) * (0.6 if D['japan'] else 1.0), rs, rc, pal_col, ridge=(k == n - 1), fascia=0.25)
        else:
            _poly_eave(b, D, 0.0, 0.0, zt, wk * 0.42 + ov * 0.8, wk * 0.38, roof_rise, sides, rs, rc, pal_col)
        z = zt + roof_rise * 0.88
        if b.detail < 2 and not brick and k < n - 1 and b.detail == 0:
            pass
    # finial mast
    finial_mast(b, D, 0.0, 0.0, z - 0.1, mast_h + 0.1, GOLD if not U.luma(rc) > 0.7 else '#8a7a52', rings=9 if n > 4 else 7)
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    ext = [-(base_w / 2 + 6), -(base_w / 2 + 6), base_w / 2 + 6, base_w / 2 + 6]
    stair_front(b, D, 0.0, -(base_w + 8.0) / 2, 3.2, plat_h, 2.0, '#a39d90', rails=False)
    if D['fence']:
        s = max(W, Dp) / 2
        ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 2.2, 4.6, shade(D['wall'], 0.9), rc, D['wslot'])
    if b.detail == 0:
        for sx in (-1, 1):
            lantern_stone(b, sx * 3.2, -(base_w + 8.0) / 2 - 3.0, 1.0)
    return tuple(ext)


def _poly_eave(b, D, cx, cy, z, R, r_top, rise, n, slot, col, trim):
    """Polygonal (hexagonal/octagonal) pagoda eave: a swept cone with a slightly concave profile."""
    rings = {0: 4, 1: 2, 2: 1}[b.detail]
    pts = []
    m = n
    grid = []
    for i in range(m + 1):
        a = TAU * (i % m) / m + TAU / (2 * m)
        col_pts = []
        for k in range(rings + 1):
            t = k / rings
            rr = R * (1 - t) + 0.25 * t
            up = 0.5 * ((1 - t) ** 1.5)
            col_pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a), z + rise * (t ** 1.5) + up))
        grid.append(col_pts)
    b.shared_grid(grid, slot, col, smooth=False, wrap=True, scale=1.2)
    if b.detail < 2:
        outer = [g[0] for g in grid[:-1]]
        low = [(p[0], p[1], p[2] - 0.25) for p in outer]
        fascia_loft(b, [low, outer], D['wslot'], trim)


# ================================================================================================================ stupa
def build_chorten(b, lk, D, srng):
    """Tibetan / Bhutanese chorten: stepped square base, a vase-shaped dome, a square harmika and a gilded stack of thirteen rings."""
    W, Dp, H = D['W'], D['D'], D['H']
    col = lk.wall_col
    gold = GOLD
    base = U.clamp(min(W, Dp) * 0.8, 5, 30)
    z = 0.0
    th = H * 0.05
    w = base
    for k in range(3):
        bxc(b, 0.0, 0.0, z, w, w, th, 'stone-blocks', shade('#e8e2d4', 1.0 - 0.04 * k), top_slot='paving', top_col='#efe9dc', skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
        z += th
        w *= 0.84
    R0 = w * 0.42
    hv = H * 0.36
    vase = [(R0 * 0.7, 0), (R0 * 0.92, hv * 0.12), (R0 * 1.0, hv * 0.34), (R0 * 0.96, hv * 0.62), (R0 * 0.78, hv * 0.88), (R0 * 0.55, hv)]
    if b.detail == 2:
        vase = [vase[0], vase[2], vase[5]]
    U.revolve(b, 0.0, 0.0, z, vase, 16 if b.detail == 0 else 8, 'plain-render', col, smooth=True, scale=2.0, cap=True)
    z += hv
    hh = H * 0.1
    bxc(b, 0.0, 0.0, z, R0 * 1.2, R0 * 1.2, hh, 'plain-render', shade(col, 0.96), top_slot='plain-render', top_col=col, skip=('bottom',))
    if b.detail == 0:
        for sx, sy, face in ((0, -1, 'front'), (1, 0, 'right')):
            if sy:
                b.face([(-R0 * 0.3, -R0 * 0.6 - 0.03, z + hh * 0.35), (R0 * 0.3, -R0 * 0.6 - 0.03, z + hh * 0.35), (R0 * 0.3, -R0 * 0.6 - 0.03, z + hh * 0.7), (-R0 * 0.3, -R0 * 0.6 - 0.03, z + hh * 0.7)], 'plain', '#2f6b9a')
    z += hh
    ring_h = H - z - H * 0.06
    prof = []
    nr = 13 if b.detail == 0 else 6
    for k in range(nr):
        t = k / nr
        rr = R0 * 0.52 * (1 - t) ** 0.9
        prof += [(rr * 1.0, z + ring_h * t), (rr * 1.12, z + ring_h * (t + 0.35 / nr)), (rr * 0.9, z + ring_h * (t + 0.7 / nr))]
    prof.append((0.1, z + ring_h))
    U.revolve(b, 0.0, 0.0, 0.0, prof, 10 if b.detail == 0 else 6, 'metal-roof', gold, smooth=False, cap=False)
    if b.detail < 2:
        U.finial(b, 0.0, 0.0, z + ring_h - 0.05, H * 0.06, gold, balls=2, r=max(0.2, R0 * 0.08))
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    lib.steps(b, -base * 0.15, base * 0.15, -base / 2, th * 1.5, 1.6, 3, 'paving', '#d8d2c6') if b.detail < 2 else None
    if D['fence']:
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 1.8, 4.0, '#efe9dc', '#a5322a', D['wslot'])
    return tuple(ext)


def build_stupa(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    if D['chorten']:
        return build_chorten(b, lk, D, srng)
    bell = D['st'] == 'southeast-asian' or U.has_word(D['txt'], 'zedi', 'chedi', 'shwedagon', 'thai', 'myanmar', 'burma', 'lao', 'cambodia') or U.goldish(lk.roof_col)
    base = U.clamp(min(W, Dp) * 0.7, 6, 50)
    col = lk.wall_col
    gold = lk.roof_col if U.goldish(lk.roof_col) else GOLD
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    b.section('stupa')
    if bell:
        # three square terraces, an octagonal base, a bell, a spire of rings and a hti umbrella
        z = 0.0
        tw = base
        th = H * 0.05
        for k in range(3):
            bxc(b, 0.0, 0.0, z, tw, tw, th, 'stone-blocks', shade('#cfc7b4', 1.0 - 0.04 * k), top_slot='paving', top_col='#d8d0bc', skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
            z += th
            tw *= 0.84
        stair_front(b, D, 0.0, -base / 2, 3.6, th * 1.5, 2.6, '#d8d0bc', rails=False)
        R0 = tw * 0.46
        hb = H - z
        hbell = min(hb * 0.5, R0 * 1.9)
        bellp = [(R0 * 1.0, 0.0), (R0 * 1.0, hbell * 0.08), (R0 * 0.9, hbell * 0.14), (R0 * 1.0, hbell * 0.22), (R0 * 0.84, hbell * 0.34), (R0 * 0.68, hbell * 0.48),
                 (R0 * 0.5, hbell * 0.64), (R0 * 0.36, hbell * 0.82), (R0 * 0.3, hbell)]
        spire = []
        ns = 14
        for k in range(1, ns + 1):
            t = k / ns
            rr = R0 * 0.3 * (1 - t) ** 1.25 * (1.0 + (0.16 if k % 2 == 1 else 0.0))
            spire.append((rr, hbell + (hb - hbell) * t))
        spire[-1] = (0.02, hb)
        bell = bellp + spire
        for_n = 20 if b.detail == 0 else (12 if b.detail == 1 else 8)
        if b.detail == 1:
            bell = bellp[::2] + spire[::2]
        if b.detail == 2:
            bell = [bellp[0], bellp[3], bellp[6], bellp[8], spire[6], spire[-1]]
        U.revolve(b, 0.0, 0.0, z, bell, for_n, 'metal-roof', gold, smooth=True, scale=2.0, cap=False, flute=(8, 0.008) if b.detail == 0 else None)
        # hti: umbrella at the top
        if b.detail < 2:
            lib.cylinder(b, 0.0, 0.0, z + hb - 0.5, z + hb + hb * 0.04, 0.9, n=10, slot='plain-render', col=shade(gold, 0.9), r_top=0.3)
        # corner stupas
        sr = R0 * 0.22
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = sx * tw * 0.5, sy * tw * 0.5
                small = [(sr, 0.0), (sr * 1.0, sr * 0.7), (sr * 0.6, sr * 1.6), (sr * 0.3, sr * 2.6), (0.02, sr * 4.0)]
                U.revolve(b, x, y, z - th * 1.0, small, 8 if b.detail < 2 else 5, 'metal-roof', gold, smooth=True, cap=False)
        ext = [-base / 2 - 4, -base / 2 - 4, base / 2 + 4, base / 2 + 4]
    else:
        # Sanchi: drum, hemisphere, harmika railing, mast with umbrellas, railing and gates
        dh = H * 0.1
        R = base * 0.5 * 0.82
        lib.cylinder(b, 0.0, 0.0, 0.0, dh, R * 1.12, n=nn_(b, 24), slot='stone-blocks', col=shade(col, 0.9), top=True)
        dome_h = H * 0.42
        prof = [(R * math.cos(t * math.pi / 2), dome_h * math.sin(t * math.pi / 2)) for t in [k / (8 if b.detail == 0 else 4) for k in range(9 if b.detail == 0 else 5)]]
        if b.detail == 2:
            prof = [prof[0], prof[2], prof[3], prof[4]]
        U.revolve(b, 0.0, 0.0, dh, prof, nn_(b, 28), 'plain-render', col, smooth=True, scale=2.0, cap=True)
        zt = dh + dome_h
        # harmika: square railed box
        hs_ = R * 0.34
        bxc(b, 0.0, 0.0, zt - 0.2, hs_, hs_, 1.0, 'stone-blocks', shade(col, 0.95), top_slot='plain-render', top_col=col, skip=('bottom',))
        zt += 0.8
        mast = H - zt
        lib.cylinder(b, 0.0, 0.0, zt, zt + mast, 0.14, n=5, slot='frame', col='#8a7a60', top=False)
        for k in range(3):
            zz = zt + mast * (0.4 + 0.2 * k)
            if b.detail < 2:
                lib.cylinder(b, 0.0, 0.0, zz, zz + 0.2, hs_ * (1.5 - 0.35 * k), n=10, slot='plain-render', col=shade(col, 0.9), r_top=hs_ * (1.35 - 0.35 * k) * 0.2) if b.detail == 0 else \
                    U.cone(b, 0.0, 0.0, zz, zz + 0.5, hs_ * (1.4 - 0.3 * k), 6, 'plain-render', shade(col, 0.9), smooth=False)
        # railing ring and four gates
        if b.detail < 2:
            Rr = R * 1.6
            for k in range(16 if b.detail == 0 else 8):
                a = TAU * (k + 0.5) / (16 if b.detail == 0 else 8)
                if min(abs(math.cos(a)), abs(math.sin(a))) < 0.18 and False:
                    continue
                lib.cylinder(b, Rr * math.cos(a), Rr * math.sin(a), 0, 1.7, 0.18, n=5, slot='stone-blocks', col=shade(col, 0.9), top=True)
            for (gx, gy, ax_) in ((0.0, -Rr, 'x'), (0.0, Rr, 'x'), (-Rr, 0.0, 'y'), (Rr, 0.0, 'y')):
                _torana(b, D, gx, gy, ax_, col)
        ext = [-R * 2.2 - 3, -R * 2.2 - 3, R * 2.2 + 3, R * 2.2 + 3]
    if D['fence']:
        ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 2.0, 5.0, shade(D['wall'], 0.9), D['roofc'], D['wslot'])
    return tuple(ext)


def nn_(b, n0):
    return {0: n0, 1: max(8, n0 // 2), 2: max(6, n0 // 3)}[b.detail]


def _torana(b, D, x, y, axis, col):
    """Sanchi gateway: two posts and three stacked lintels with curled ends."""
    w = 4.2
    c = shade(col, 0.88)
    px = (lambda s: (x + s, y)) if axis == 'x' else (lambda s: (x, y + s))
    for sgn in (-1, 1):
        a = px(sgn * w / 2 * 0.8)
        bxc(b, a[0], a[1], 0, 0.6, 0.6, 5.0, 'stone-blocks', c, skip=('bottom',))
    for k in range(3):
        z = 3.2 + k * 0.95
        ww = w + 0.8 - 0.2 * k
        if axis == 'x':
            lib.box(b, x - ww / 2, y - 0.25, z, x + ww / 2, y + 0.25, z + 0.38, 'stone-blocks', c, skip=('bottom',))
        else:
            lib.box(b, x - 0.25, y - ww / 2, z, x + 0.25, y + ww / 2, z + 0.38, 'stone-blocks', c, skip=('bottom',))


# ================================================================================================================ wat
def build_wat(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    wall_col = lk.wall_col
    roofs = [D['roofc'], lk.accent_col, shade(D['roofc'], 0.9)]
    # ubosot: long axis along Y, entrance on the gable end (-Y), at the back-left of the compound
    uw = U.clamp(min(W * 0.28, Dp * 0.3), 7.0, 14.0)
    ud = U.clamp(uw * (1.9 + 0.4 * r[1]), 14.0, min(30.0, Dp * 0.6))
    ux = -W * 0.12
    uy = Dp / 2 - ud / 2 - 4.0
    b.section('base')
    ptop = _platform_at(b, D, ux, uy, uw + 5.0, ud + 5.0, 1.3, '#cbc3b0', tiers=2)
    b.section('hall')
    bh = U.clamp(H * 0.32, 3.8, 7.0)
    z0 = ptop
    wx0, wx1, wy0, wy1 = ux - uw / 2 + 0.4, ux + uw / 2 - 0.4, uy - ud / 2 + 0.4, uy + ud / 2 - 0.4
    bx(b, wx0, wy0, z0, wx1, wy1, z0 + bh, D['wslot'], wall_col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
    if b.detail < 2:
        door_bay(b, D, ux, wy0, z0, uw * 0.3, bh * 0.82, GOLD)
        if b.detail == 0:
            # tall slit windows with gold frames down both long sides
            nwin = max(3, int(ud / 3.0))
            for sx_, hint in ((wx1, 1), (wx0, -1)):
                for k in range(nwin):
                    yy = wy0 + (wy1 - wy0) * (k + 0.5) / nwin
                    pts = [(sx_ + hint * 0.03, yy - 0.35, z0 + bh * 0.28), (sx_ + hint * 0.03, yy + 0.35, z0 + bh * 0.28), (sx_ + hint * 0.03, yy + 0.35, z0 + bh * 0.82), (sx_ + hint * 0.03, yy - 0.35, z0 + bh * 0.82)]
                    b.facing(pts, (hint, 0, 0), 'glass-punched', '#d6dade')
                    b.facing([(sx_ + hint * 0.05, yy - 0.5, z0 + bh * 0.26), (sx_ + hint * 0.05, yy + 0.5, z0 + bh * 0.26), (sx_ + hint * 0.05, yy + 0.5, z0 + bh * 0.28), (sx_ + hint * 0.05, yy - 0.5, z0 + bh * 0.28)], (hint, 0, 0), 'plain', GOLD)
        # colonnade across the front gable end
        for k in range(4):
            x = ux - uw / 2 + 0.9 + (uw - 1.8) * k / 3
            lib.cylinder(b, x, wy0 - 0.9, z0, z0 + bh, 0.28, n=6 if b.detail == 0 else 4, slot='plain-render', col=shade(wall_col, 1.04), top=False, smooth=False)
        lib.beam(b, (ux - uw / 2 + 0.6, wy0 - 0.9), (ux + uw / 2 - 0.6, wy0 - 0.9), z0 + bh - 0.45, z0 + bh, 0.5, 'plain-render', lk.accent_col)
    # tiered overlapping gables, ridge along Y
    b.section('roof')
    ntier = 3 if (D['tiers'] >= 3 or r[2] < 0.55) else 2
    rw = uw + 2.6
    rl = ud + 3.0
    zk = z0 + bh
    for k in range(ntier):
        wk = rw * (1.0 - 0.17 * k)
        lk_ = rl * (1.0 - 0.13 * k)
        rise = wk / 2 * 0.95
        _thai_gable(b, D, ux, uy, zk, wk, lk_, rise, roofs[k % 2], roofs[1 - (k % 2)], wall_col)
        zk += rise * 0.42
    # porch roof in front (a lower gable stepping out)
    if b.detail < 2:
        pw_ = uw * 0.72
        _thai_gable(b, D, ux, wy0 - 1.2, z0 + bh * 0.82, pw_ + 1.0, 3.4, pw_ / 2 * 0.9, roofs[0], roofs[1], wall_col)
    # chedi
    b.section('chedi')
    cr = U.clamp(min(W, Dp) * 0.15, 2.8, 7.5)
    cx = W * 0.28
    cy = Dp * 0.12
    ch = U.clamp(H * 1.25, 9, 28)
    if D['nstupa'] or r[3] < 0.75:
        _chedi(b, D, cx, cy, cr, ch, GOLD)
    if W > 30 and b.detail < 2:
        _sala(b, D, -W * 0.3, -Dp * 0.08, 6.0, 4.4, roofs[0], lk)
    lib.steps(b, ux - 2.4, ux + 2.4, wy0 - 2.0, ptop, 2.2, 5 if b.detail == 0 else 3, 'paving', '#d8d0bc')
    if D['fence']:
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 2.2, 5.0, '#efe9dc', roofs[0], D['wslot'])
        _tier_gate(b, D, 0.0, -Dp / 2 + 0.6, 6.0, roofs)
    return tuple(ext)


def _thai_gable(b, D, cx, cy, z, w, l, rise, col, edge_col, wall_col):
    """Steep gable roof, ridge along Y (gable ends front and back): coloured edge band along the eaves and rakes, a patterned gable end
    in the accent colour and horn-like chofa at the ridge ends."""
    hw, hl = w / 2, l / 2
    for sgn in (-1, 1):
        pts = [(cx + sgn * hw, cy - hl, z), (cx + sgn * hw, cy + hl, z), (cx, cy + hl, z + rise), (cx, cy - hl, z + rise)]
        b.facing(pts, (sgn * rise, 0, hw), D['rslot'], col, scale=1.5)
        if b.detail == 0:
            e = [(cx + sgn * hw, cy - hl, z - 0.25), (cx + sgn * hw, cy + hl, z - 0.25), (cx + sgn * hw, cy + hl, z + 0.05), (cx + sgn * hw, cy - hl, z + 0.05)]
            b.facing(e, (sgn, 0, 0), 'plain-render', edge_col)
    for sy in (-1, 1):
        y = cy + sy * hl
        tri = [(cx - hw, y, z), (cx + hw, y, z), (cx, y, z + rise)]
        b.facing(tri, (0, sy, 0), D['wslot'], D['accent'] if b.detail < 2 else wall_col)
        if b.detail == 0:
            # inner gable panel in the wall colour and bargeboards along both rakes
            f = 0.62
            b.facing([(cx - hw * f, y + sy * 0.03, z + rise * 0.1), (cx + hw * f, y + sy * 0.03, z + rise * 0.1), (cx, y + sy * 0.03, z + rise * 0.78)], (0, sy, 0), 'plain-render', shade(wall_col, 0.98))
            for sgn in (-1, 1):
                p0, p1 = (cx + sgn * hw, y, z), (cx, y, z + rise)
                q = [p0, p1, (p1[0], p1[1] + sy * 0.35, p1[2]), (p0[0], p0[1] + sy * 0.35, p0[2])]
                b.facing(q, (sgn * rise, 0, hw), 'plain-render', edge_col)
            U.revolve(b, cx, y + sy * 0.25, z + rise - 0.1, [(0.26, 0), (0.15, rise * 0.14), (0.07, rise * 0.28), (0.0, rise * 0.42)], 5, 'plain-render', GOLD, smooth=False, cap=False)
        elif b.detail == 1:
            U.cone(b, cx, y, z + rise - 0.1, z + rise + rise * 0.28, 0.2, 4, 'plain', GOLD, smooth=False)
    if b.detail < 2:
        lib.box(b, cx - 0.2, cy - hl, z + rise - 0.05, cx + 0.2, cy + hl, z + rise + 0.25, 'plain-render', GOLD, skip=('bottom',))


def _chedi(b, D, x, y, r0, h, col):
    """Gilded bell stupa on a square base: bell with moulded shoulders, ringed spire, hti."""
    bw = r0 * 3.6
    bxc(b, x, y, 0, bw, bw, h * 0.04, 'stone-blocks', '#d0c8b4', skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
    bxc(b, x, y, h * 0.04, bw * 0.86, bw * 0.86, h * 0.04, 'stone-blocks', '#d8d0bc', skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
    z = h * 0.08
    R = r0 * 1.5
    hb = h - z
    hbell = min(hb * 0.5, R * 1.6)
    bellp = [(R, 0), (R * 1.0, hbell * 0.08), (R * 0.88, hbell * 0.14), (R * 0.98, hbell * 0.22), (R * 0.82, hbell * 0.36), (R * 0.64, hbell * 0.52),
             (R * 0.46, hbell * 0.7), (R * 0.34, hbell * 0.86), (R * 0.3, hbell)]
    spire = []
    for k in range(1, 13):
        t = k / 12
        spire.append((R * 0.3 * (1 - t) ** 1.2 * (1.0 + (0.18 if k % 2 else 0.0)), hbell + (hb - hbell) * t))
    spire[-1] = (0.02, hb)
    prof = bellp + spire
    if b.detail == 1:
        prof = bellp[::2] + spire[::2]
    if b.detail == 2:
        prof = [bellp[0], bellp[3], bellp[6], bellp[8], spire[5], spire[-1]]
    U.revolve(b, x, y, z, prof, 12 if b.detail == 0 else 6, 'metal-roof', col, smooth=True, scale=2.0, cap=False)


def _sala(b, D, x, y, w, d, rcol, lk):
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.cylinder(b, x + sx * (w / 2 - 0.3), y + sy * (d / 2 - 0.3), 0, 3.0, 0.2, n=5, slot='timber', col='#8a6a48', top=False)
    bx(b, x - w / 2, y - d / 2, 0, x + w / 2, y + d / 2, 0.5, 'timber', '#8a6a48', skip=('bottom',))
    _thai_gable(b, D, x, y, 3.0, d + 1.0, w + 1.0, 1.9, rcol, lk.accent_col, lk.wall_col)


def _tier_gate(b, D, x, y, w, roofs):
    for sx in (-1, 1):
        bxc(b, x + sx * (w / 2 - 0.5), y, 0, 1.0, 1.0, 3.4, D['wslot'], '#efe9dc', skip=('bottom',))
    bx(b, x - w / 2, y - 0.5, 3.4, x + w / 2, y + 0.5, 4.0, 'plain-render', '#efe9dc', skip=('bottom',))
    _thai_gable(b, D, x, y, 4.0, 2.4, w + 1.2, 1.6, roofs[0], roofs[1], '#efe9dc')


# ================================================================================================================ shikhara
def nagara_ring(cx, cy, a, z, p=0.14, wc=0.3):
    pts = []
    for side in range(4):
        ang = side * math.pi / 2
        c, s = math.cos(ang), math.sin(ang)
        for (uu, vv) in ((-1.0, 0.0), (-wc, 0.0), (-wc, p), (wc, p), (wc, 0.0)):
            lx, ly = uu * a, -(a + vv * a)
            pts.append((cx + c * lx - s * ly, cy + s * lx + c * ly, z))
    return pts


def build_shikhara(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    col = lk.wall_col
    acc = lk.accent_col
    ws = D['wslot']
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    # plinth
    b.section('plinth')
    pw = U.clamp(W * 0.8, 9, 60)
    pd = U.clamp(Dp * 0.78, 9, 50)
    ptop = _platform_at(b, D, 0.0, Dp * 0.06, pw, pd, 1.4, shade(col, 0.88), tiers=2)
    cy0 = Dp * 0.06
    # sanctum (garbhagriha) at the back, mandapa in front
    sw = U.clamp(min(pw, pd) * 0.46, 5, 18)
    sy = cy0 + pd / 2 - sw / 2 - 1.8
    mw = U.clamp(sw * 1.25, 6, 24)
    md = U.clamp(sw * 1.1, 5, 20)
    my = sy - sw / 2 - md / 2 + 0.6
    b.section('sanctum')
    wall_h = U.clamp(H * 0.2, 3.5, 9.0)
    bxc(b, 0.0, sy, ptop, sw, sw, wall_h, ws, col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
    if b.detail == 0:
        # moulded base and cornice
        bxc(b, 0.0, sy, ptop, sw + 0.5, sw + 0.5, 0.7, 'plain-render', shade(col, 0.85))
        bxc(b, 0.0, sy, ptop + wall_h - 0.4, sw + 0.4, sw + 0.4, 0.4, 'plain-render', shade(col, 1.08))
    # shikhara tower
    b.section('tower')
    zt0 = ptop + wall_h
    th = H - (zt0) - H * 0.07
    th = max(th, 4.0)
    a0 = sw / 2
    N = {0: 22, 1: 10, 2: 4}[b.detail]
    rings = []
    for i in range(N + 1):
        t = i / N
        a = a0 * (1 - 0.72 * (t ** 1.7))
        if b.detail == 0 and i % 2 == 1:
            a *= 0.955
        if b.detail == 2:
            rings.append(U.rect_ring(0.0, sy, 2 * a * 1.06, 2 * a * 1.06, zt0 + th * t))
        else:
            rings.append(nagara_ring(0.0, sy, a, zt0 + th * t, p=0.16 - 0.06 * t, wc=0.3))
    U.ring_loft(b, rings, ws, col, scale=3.0 if b.detail else 1.4)
    b.facing(rings[-1], (0, 0, 1), ws, col)
    # amalaka and kalasha
    ztop = zt0 + th
    ar = a0 * 0.32
    U.revolve(b, 0.0, sy, ztop, [(ar * 0.9, 0), (ar * 1.0, ar * 0.2), (ar * 1.12, ar * 0.42), (ar * 0.95, ar * 0.62), (ar * 0.55, ar * 0.72)], 16 if b.detail == 0 else 8, 'plain-render',
              shade(col, 0.95), smooth=True, cap=True, flute=(16, 0.06) if b.detail == 0 else None)
    zk = ztop + ar * 0.7
    U.revolve(b, 0.0, sy, zk, [(ar * 0.3, 0), (ar * 0.5, ar * 0.25), (ar * 0.44, ar * 0.6), (ar * 0.2, ar * 0.85), (ar * 0.14, ar * 1.05), (0.02, ar * 1.7)], 8 if b.detail < 2 else 5,
              'metal-roof', GOLD, smooth=True, cap=False)
    # subsidiary spires stepping down towards the mandapa
    if (r[4] < 0.55 or D['relief']) and b.detail < 2:
        b.section('spires')
        for k, (dx, dyy, f) in enumerate(((-1, 0.0, 0.42), (1, 0.0, 0.42))):
            sx_ = dx * (sw / 2 + sw * 0.18 * 0 + sw * 0.26)
            sa = a0 * 0.46
            sh_ = th * 0.55
            rr_ = []
            for i in range(N // 2 + 1):
                t = i / (N // 2)
                aa = sa * (1 - 0.7 * (t ** 1.6))
                rr_.append(nagara_ring(sx_, sy - sw * 0.24, aa, zt0 + wall_h * 0.0 + sh_ * t, p=0.15, wc=0.3))
            U.ring_loft(b, rr_, ws, col, scale=3.0 if b.detail else 1.4)
            if b.detail < 2:
                b.facing(rr_[-1], (0, 0, 1), ws, col)
                U.revolve(b, sx_, sy - sw * 0.24, zt0 + sh_, [(sa * 0.3, 0), (sa * 0.34, sa * 0.2), (sa * 0.1, sa * 0.5)], 8, 'metal-roof', GOLD, smooth=True, cap=False)
    # mandapa: walls + pillars + stepped pyramidal pidha roof
    b.section('mandapa')
    mh = wall_h * 0.82
    bxc(b, 0.0, my, ptop, mw, md, mh, ws, col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
    if b.detail < 2:
        # open entrance with a dark opening and two columns
        door_bay(b, D, 0.0, my - md / 2, ptop, mw * 0.3, mh * 0.75, acc)
        if b.detail == 0:
            for sx in (-1, 1):
                lib.cylinder(b, sx * mw * 0.22, my - md / 2 - 0.9, ptop, ptop + mh, 0.3, n=8, slot='plain-render', col=shade(col, 1.05), top=False)
            lib.beam(b, (-mw * 0.28, my - md / 2 - 0.9), (mw * 0.28, my - md / 2 - 0.9), ptop + mh - 0.4, ptop + mh, 0.6, 'plain-render', shade(col, 1.05))
    zz = ptop + mh
    wk, dk = mw, md
    if D['ndome'] >= 3:
        # samvarana: a flat roof carrying a row of small domes round a larger central one
        lib.cap(b, [[(-mw / 2, my - md / 2), (mw / 2, my - md / 2), (mw / 2, my + md / 2), (-mw / 2, my + md / 2)]], zz, True, 'roof-flat', shade(col, 0.92), scale=4.0)
        nd = int(U.clamp(D['ndome'], 3, 9))
        k = max(1, (nd - 1) // 2)
        rr = min(mw / (2 * (k + 1)) * 0.85, md * 0.3)
        for q in range(-k, k + 1):
            x = q * rr * 2.0
            rad = rr * (1.3 if q == 0 else 0.85)
            if abs(x) > mw / 2 - rad:
                continue
            if b.detail < 2:
                lib.cylinder(b, x, my, zz, zz + 0.6, rad, n=U.nn(b, 12), slot='plain-render', col=shade(col, 1.04), top=False)
            U.dome(b, x, my, zz + (0.6 if b.detail < 2 else 0), rad, rad * 1.2, 'ogee', 'plain-render', shade(col, 0.97), n=U.nn(b, 14), rings=5 if b.detail == 0 else 3)
            if b.detail < 2:
                U.finial(b, x, my, zz + 0.6 + rad * 1.18, rad * 0.5, GOLD, balls=1, r=0.18)
        zz += 0.0
    else:
        tiers = 4 if mw > 8 else 3
        for k in range(tiers):
            outer = U.rect_ring(0.0, my, wk + 1.0, dk + 1.0, zz - 0.0)
            inner = U.rect_ring(0.0, my, wk, dk, zz + 0.6)
            up = U.rect_ring(0.0, my, wk * 0.84, dk * 0.84, zz + 1.1)
            U.ring_loft(b, [outer, inner, up], 'plain-render', shade(col, 0.92) if k % 2 == 0 else shade(col, 1.04), scale=3.0)
            zz += 1.1
            wk, dk = wk * 0.84, dk * 0.84
        b.facing(U.rect_ring(0.0, my, wk, dk, zz), (0, 0, 1), 'plain-render', col)
    if b.detail < 2 and D['ndome'] < 3:
        U.revolve(b, 0.0, my, zz, [(0.5, 0), (0.55, 0.3), (0.3, 0.7), (0.05, 1.2)], 8, 'metal-roof', GOLD, smooth=True, cap=False)
    stair_front(b, D, 0.0, my - md / 2 - 1.6, U.clamp(mw * 0.4, 3.0, 8.0), ptop, 3.0, shade(col, 0.88))
    # flag pole (dhvaja) and gate
    b.section('site')
    if b.detail < 2:
        fx = pw / 2 + 2.0
        lib.cylinder(b, fx, -pd * 0.1 + cy0, 0, H * 0.9, 0.12, n=5, slot='frame', col='#8a7a60', top=False)
        b.facing([(fx, -pd * 0.1 + cy0, H * 0.9), (fx + 0.1, -pd * 0.1 + cy0, H * 0.9 - 0.8), (fx + 0.1, -pd * 0.1 + cy0 + 1.6, H * 0.9 - 0.4)], (0, -1, 0), 'plain', '#d9772a') if False else None
        flag = [(fx, cy0 - pd * 0.1, H * 0.9), (fx, cy0 - pd * 0.1, H * 0.9 - 0.9), (fx + 1.8, cy0 - pd * 0.1, H * 0.9 - 0.45)]
        b.facing(flag, (0, -1, 0), 'plain', '#e0742a')
        b.facing(flag, (0, 1, 0), 'plain', '#e0742a')
    if D['fence']:
        ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 2.2, 5.0, shade(col, 0.95), acc, ws)
    return tuple(ext)


# ================================================================================================================ gopuram
def build_gopuram(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    col = lk.wall_col
    acc = lk.accent_col
    ws = D['wslot']
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    # the gateway tower at the front of the compound
    gw = U.clamp(min(W * 0.55, H * 0.9), 8, 34)
    gd = U.clamp(gw * 0.58, 5, 22)
    gy = -Dp / 2 + gd / 2 + 1.5
    ntiers = int(U.clamp(round(H / 3.2), 5, 9)) if D['tiers'] == 0 else int(U.clamp(D['tiers'], 3, 9))
    base_h = U.clamp(H * 0.2, 4.0, 9.0)
    b.section('gateway')
    bx(b, -gw / 2, gy - gd / 2, 0, gw / 2, gy + gd / 2, base_h, ws, shade(col, 0.96), skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
    if b.detail < 2:
        seg = lib.Seg((-gw / 2, gy - gd / 2), (gw / 2, gy - gd / 2))
        U.arch_openings(b, seg, lk, 0, base_h, 1, 'rect', ow=min(gw * 0.26, 5.0), oh=base_h * 0.78, depth=1.2, col=shade(col, 0.96), slot=ws, sill=0.0, crown_gap=0.4)
    # pilasters and cornice on the base
    if b.detail == 0:
        for k in range(1, 6):
            u = gw * k / 6
            if abs(u - gw / 2) < 2.0:
                continue
            lib.seg_box(b, lib.Seg((-gw / 2, gy - gd / 2), (gw / 2, gy - gd / 2)), u - 0.3, u + 0.3, 0.2, base_h - 0.4, 0.2, shade(acc, 1.0), 'plain-render')
        bx(b, -gw / 2 - 0.3, gy - gd / 2 - 0.3, base_h - 0.5, gw / 2 + 0.3, gy + gd / 2 + 0.3, base_h, 'plain-render', shade(acc, 0.9), skip=('bottom',))
    z = base_h
    th = (H - base_h) / (ntiers + 0.9)
    wk, dk = gw, gd
    palette = [col, acc, shade(col, 0.92), shade(acc, 1.1)]
    b.section('tiers')
    for k in range(ntiers):
        f0 = 1 - 0.56 * (k / ntiers)
        f1 = 1 - 0.56 * ((k + 1) / ntiers)
        w0_, d0_ = gw * f0 * 0.94, gd * (1 - 0.72 * k / ntiers) * 0.94
        w1_, d1_ = gw * f1 * 0.94, gd * (1 - 0.72 * (k + 1) / ntiers) * 0.94
        c = palette[k % len(palette)]
        U.frustum(b, 0.0, gy, z, z + th, w0_, d0_, w1_ * 1.02, d1_ * 1.02, ws, c, top=False, scale=1.0 if b.detail == 0 else 5.0)
        if b.detail < 2:
            # projecting cornice at the top of the tier
            cw, cdp = w1_ * 1.06 + 0.5, d1_ * 1.06 + 0.5
            if b.detail == 0:
                bxc(b, 0.0, gy, z + th - 0.22, cw, cdp, 0.3, 'plain-render', shade(palette[(k + 1) % len(palette)], 0.9), skip=('bottom',))
            # niche / figure row on the front face
            if b.detail == 0:
                n = max(3, int(w0_ / 1.5))
                yf = gy - (d0_ + d1_) / 4
                for q in range(n):
                    x = -w0_ / 2 * 0.86 + (w0_ * 0.86) * (q + 0.5) / n
                    if abs(x) < 0.5 and False:
                        continue
                    nz = z + th * 0.2
                    lib.box(b, x - 0.28, yf - 0.28, nz, x + 0.28, yf + 0.02, nz + th * 0.55, 'plain-render', palette[(k + 2 + q) % len(palette)], skip=('bottom', 'back'))
        z += th
        wk, dk = w1_, d1_
    # barrel-vault crown (shala) with end gables and a row of kalasa
    b.section('crown')
    ch = th * 0.9
    cw, cdp = wk * 1.0, dk * 1.0
    # vault: a half cylinder along x
    n = {0: 10, 1: 6, 2: 4}[b.detail]
    prof = [(cdp / 2 * math.cos(math.pi * k / n), ch * math.sin(math.pi * k / n)) for k in range(n + 1)]
    grid = [[(x, gy + py, z + pz) for (py, pz) in prof] for x in (-cw / 2, cw / 2)]
    b.shared_grid(grid, 'plain-render', acc, smooth=True)
    if b.detail < 2:
        for sx_, hint in ((-cw / 2, (-1, 0, 0)), (cw / 2, (1, 0, 0))):
            b.facing([(sx_, gy + py, z + pz) for (py, pz) in prof], hint, ws, col)
        kn = max(3, int(cw / 1.8)) if b.detail == 0 else 3
        for q in range(kn):
            x = -cw / 2 + cw * (q + 0.5) / kn
            U.revolve(b, x, gy, z + ch - 0.05, [(0.25, 0), (0.4, 0.35), (0.3, 0.8), (0.08, 1.2), (0.0, 1.6)], 6, 'metal-roof', GOLD, smooth=True, cap=False)
    # compound walls to either side and the inner shrine (vimana) at the back
    b.section('compound')
    wall_h = U.clamp(H * 0.12, 3.0, 6.0)
    x0, x1 = -W / 2 + 0.4, W / 2 - 0.4
    y0, y1 = -Dp / 2 + 0.4, Dp / 2 - 0.4
    side_front = [(x0, y0, -gw / 2, y0 + 0.6), (gw / 2, y0, x1, y0 + 0.6)]
    for (a0, b0, a1, b1) in side_front:
        if a1 - a0 > 0.5:
            bx(b, a0, b0, 0, a1, b1, wall_h, ws, shade(col, 0.95), skip=('bottom',), top_slot='roof-flat', top_col=acc, scale=1.0 if b.detail == 0 else 6.0)
    for (a0, b0, a1, b1) in ((x0, y0, x0 + 0.6, y1), (x1 - 0.6, y0, x1, y1), (x0, y1 - 0.6, x1, y1)):
        bx(b, a0, b0, 0, a1, b1, wall_h, ws, shade(col, 0.95), skip=('bottom',), top_slot='roof-flat', top_col=acc, scale=1.0 if b.detail == 0 else 6.0)
    if b.detail == 0:
        # repeating corner kalasa along the top of the wall
        n = int((x1 - x0) / 2.6)
        for q in range(1, n):
            x = x0 + (x1 - x0) * q / n
            if abs(x) > gw / 2 + 0.6:
                U.revolve(b, x, y0 + 0.3, wall_h, [(0.2, 0), (0.28, 0.2), (0.22, 0.5), (0.0, 0.8)], 5, 'plain-render', acc, smooth=True, cap=False)
    vw = U.clamp(min(W, Dp) * 0.22, 5, 14)
    vy = Dp * 0.12
    vh = H * 0.34
    bxc(b, 0.0, vy, 0, vw, vw, vh * 0.55, ws, col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
    zz = vh * 0.55
    wk2 = vw
    for k in range(4):
        outer = U.rect_ring(0.0, vy, wk2 + 0.9, wk2 + 0.9, zz)
        inner = U.rect_ring(0.0, vy, wk2, wk2, zz + 0.7)
        up = U.rect_ring(0.0, vy, wk2 * 0.8, wk2 * 0.8, zz + 1.4)
        U.ring_loft(b, [outer, inner, up], 'metal-roof' if k > 1 else 'plain-render', GOLD if k > 1 else shade(acc, 1.0), scale=3.0)
        zz += 1.4
        wk2 *= 0.8
    U.revolve(b, 0.0, vy, zz, [(0.5, 0), (0.7, 0.4), (0.5, 1.0), (0.1, 1.6), (0.0, 2.0)], 6, 'metal-roof', GOLD, smooth=True, cap=False)
    return tuple(ext)


# ================================================================================================================ gurdwara
def build_gurdwara(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    col = lk.wall_col
    ws = D['wslot']
    acc = lk.accent_col
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    bw = U.clamp(W * 0.68, 12, 60)
    bd = U.clamp(Dp * 0.5, 10, 40)
    by = Dp / 2 - bd / 2 - 3.0
    storeys = max(2, D['F']['storeys'])
    wh = U.clamp(H * 0.55, 7, 20)
    b.section('block')
    pod = 0.6
    bx(b, -bw / 2 - 1.5, by - bd / 2 - 2.0, 0, bw / 2 + 1.5, by + bd / 2 + 1.0, pod, 'paving', '#d0cbc0', skip=('bottom',), scale=5.0)
    z0 = pod
    rect = (-bw / 2, by - bd / 2, bw / 2, by + bd / 2)
    segs = [lib.Seg((rect[0], rect[1]), (rect[2], rect[1])), lib.Seg((rect[2], rect[1]), (rect[2], rect[3])), lib.Seg((rect[2], rect[3]), (rect[0], rect[3])), lib.Seg((rect[0], rect[3]), (rect[0], rect[1]))]
    for i, seg in enumerate(segs):
        kind = 'arched' if i != 2 else 'none'
        lib.facade(b, seg, z0, z0 + wh, storeys if b.detail == 0 else 1, lk, kind, 0.3, None, 3.6 + (1.5 * D['lean']), reduced=(i in (2,)), wall_slot=ws, wall_col=col)
    fp = lib.fp_rect(bw, bd, 0, by)
    if b.detail == 0:
        lib.cornice(b, fp, z0 + wh - 0.4, 0.45, 0.4, lk, D['trim'])
        lib.sweep(b, fp, z0, [(0.07, 0), (0.07, 0.6), (0, 0.6)], ws, shade(col, 0.85))
    lib.cap(b, fp.polys, z0 + wh, True, 'roof-flat', mix(col, '#9a9a96', 0.5), scale=4.0)
    lib.parapet(b, fp, z0 + wh, 1.0, 0.3, lk, ws, D['trim'])
    # central lotus dome on an octagonal drum
    b.section('dome')
    R = U.clamp(min(bw, bd) * 0.27, 3.0, 12.0)
    dh = R * 0.55
    dhgt = max(R * 1.25, H - z0 - wh - dh)
    dcol = D['roofc'] if (D['gold'] or True) else col
    dr_top = U.drum(b, 0.0, by, z0 + wh, dh, R * 0.98, 16 if b.detail == 0 else 8, ws, shade(col, 1.0), window_col='#e8eef2', windows=0, ring=True, trim=D['trim'])
    nlot = 24 if b.detail == 0 else (14 if b.detail == 1 else 8)
    U.dome(b, 0.0, by, dr_top, R, dhgt, 'lotus', 'metal-roof' if D['gold'] else D['rslot'], dcol, n=nlot, rings=8 if b.detail == 0 else 5, flute=(12, 0.035) if b.detail == 0 else None)
    topz = dr_top + dhgt
    U.finial(b, 0.0, by, topz - 0.1, max(1.2, R * 0.4), GOLD, balls=2, r=max(0.25, R * 0.05))
    # chhatris on the roof corners and along the front parapet
    b.section('chhatris')
    cr = max(1.0, min(R * 0.3, 2.4))
    for sx in (-1, 1):
        for sy in (-1, 1):
            _chhatri(b, D, sx * (bw / 2 - cr * 1.4), by + sy * (bd / 2 - cr * 1.4), z0 + wh + 1.0, cr, 3.4, dcol)
    nf = max(1, int(bw / 7.0)) if b.detail < 2 else 1
    for k in range(nf):
        x = -bw / 2 + bw * (k + 0.5) / nf
        if abs(x) < R * 1.0 and False:
            continue
        _chhatri(b, D, x, by - bd / 2 + cr, z0 + wh + 1.0, cr * 0.75, 2.8, dcol)
    # entrance portico
    b.section('entrance')
    pw = U.clamp(bw * 0.4, 5, 16)
    ph = min(wh * 0.62, 5.5)
    bx(b, -pw / 2, by - bd / 2 - 2.6, z0, pw / 2, by - bd / 2, z0 + ph, ws, col, skip=('bottom', 'back', 'front'), top_slot='roof-flat', top_col=D['trim'])
    seg = lib.Seg((-pw / 2, by - bd / 2 - 2.6), (pw / 2, by - bd / 2 - 2.6))
    U.arch_openings(b, seg, lk, z0, z0 + ph, 3, 'arch', ow=pw / 3 * 0.62, oh=ph * 0.72, depth=1.2, col=col, slot=ws, sill=0.0, crown_gap=0.5)
    _chhatri(b, D, 0.0, by - bd / 2 - 1.3, z0 + ph, 1.5, 3.2, dcol)
    lib.steps(b, -pw / 2 - 0.5, pw / 2 + 0.5, by - bd / 2 - 2.6, pod, 2.4, 3, 'paving', '#d8d2c6')
    # Nishan Sahib: tall pole with a triangular saffron flag
    b.section('nishan')
    px, py = bw / 2 + 4.0, by - bd / 2 - 3.0
    pole = U.clamp(H * 1.1, 10, 22)
    bxc(b, px, py, 0, 2.2, 2.2, 0.8, 'paving', '#d8d2c6', skip=('bottom',))
    if b.detail < 2:
        lib.cylinder(b, px, py, 0.8, pole, 0.22, n=6, slot='frame', col='#c9a84a', r_top=0.14, top=False)
        U.finial(b, px, py, pole - 0.1, 1.4, GOLD, balls=1, r=0.3)
        fl = [(px, py, pole - 0.4), (px, py, pole - 4.8), (px + 2.2, py, pole - 4.8)]
        b.facing([(px, py - 0.02, pole - 0.5), (px + 0.0, py - 0.02, pole - 5.4), (px + 0.0, py - 0.02, pole - 5.4)], (0, -1, 0), 'plain', '#e8932a') if False else None
        tri = [(px + 0.2, py, pole - 0.6), (px + 0.2, py, pole - 5.6), (px + 3.0, py, pole - 0.6)]
        b.facing(tri, (0, -1, 0), 'plain', '#e8932a')
        b.facing(tri, (0, 1, 0), 'plain', '#e8932a')
    # sarovar (pool) in front of the building
    if b.detail < 2 and (Dp > 36):
        sw = U.clamp(bw * 0.5, 8, 24)
        sy0 = by - bd / 2 - 6.0 - 8.0
        with b.site():
            b.face([(-sw / 2, sy0 - 4.0, 0.08), (sw / 2, sy0 - 4.0, 0.08), (sw / 2, sy0 + 4.0, 0.08), (-sw / 2, sy0 + 4.0, 0.08)], 'plain', '#5f98b3')
    if D['fence']:
        ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 2.0, 6.0, '#efe9dc', D['trim'], ws)
    return tuple(ext)


def _chhatri(b, D, cx, cy, z, r, h, dcol):
    col = shade(D['wall'], 1.05)
    d = b.detail
    if d >= 2:
        U.dome(b, cx, cy, z + h * 0.5, r, r * 1.0, 'hemi', 'metal-roof', dcol, n=6, rings=2)
        return
    ph = h * 0.5
    if d == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                bxc(b, cx + sx * r * 0.7, cy + sy * r * 0.7, z, r * 0.22, r * 0.22, ph, 'plain-render', col, skip=('bottom', 'top'))
        bxc(b, cx, cy, z + ph, r * 2.0, r * 2.0, 0.2, 'plain-render', D['trim'])
    else:
        bxc(b, cx, cy, z, r * 1.5, r * 1.5, ph + 0.2, 'plain-render', col)
    U.dome(b, cx, cy, z + ph + 0.2, r * 0.95, r * 1.2, 'ogee' if d == 0 else 'hemi', 'metal-roof', dcol, n=nn_(b, 12), rings=4 if d == 0 else 3)
    if d == 0:
        U.finial(b, cx, cy, z + ph + 0.2 + r * 1.15, r * 0.7, GOLD, balls=1, r=0.12)


# ================================================================================================================ lotus / yurt / pura / octhall
def build_lotus(b, lk, D, srng):
    """Lotus-flower temple: three tiers of free-standing petal shells round a central hall on a round podium (nine per tier by default)."""
    W, Dp, H = D['W'], D['D'], D['H']
    R = min(W, Dp) / 2 * 0.92
    n = 9
    m = U.has_word(D['txt'], '27')
    col = lk.wall_col
    ws = D['wslot']
    b.section('podium')
    lib.cylinder(b, 0.0, 0.0, 0.0, 0.8, R * 1.05, n=U.nn(b, 36), slot='stone-blocks', col=shade(col, 0.9), top=True, top_slot='paving', top_col=lk.stone_col, smooth=True)
    z0 = 0.8
    b.section('petals')
    tiers = [  # (angle offset, base radius, apex radius, height, base half-angle factor)
        (0.5, 0.90 * R, 0.60 * R, 0.46 * H, 1.0),
        (0.0, 0.72 * R, 0.34 * R, 0.80 * H, 1.0),
        (0.5, 0.52 * R, 0.14 * R, 1.00 * H, 1.0),
    ]
    nu = {0: 4, 1: 3, 2: 2}[b.detail]
    nv = {0: 6, 1: 4, 2: 2}[b.detail]
    for ti, (off, rb, ra, hh, hf) in enumerate(tiers):
        for i in range(n):
            a = TAU * (i + off) / n
            ca, sa = math.cos(a), math.sin(a)
            tx, ty = -sa, ca
            half = math.pi / n * hf * rb
            grid = []
            for iu in range(nu + 1):
                u = -1 + 2 * iu / nu
                row = []
                for iv in range(nv + 1):
                    v = iv / nv
                    rad = rb + (ra - rb) * (v ** 1.15) + 0.13 * R * math.sin(math.pi * v) * (1 - ti * 0.15)
                    wv = half * (1 - v ** 1.7) * (1 - 0.18 * (u * u))
                    h_ = z0 + hh * (v ** 0.85)
                    # the petal narrows to the apex and bows slightly outward in the middle
                    row.append((ca * rad + tx * u * wv, sa * rad + ty * u * wv, h_))
                grid.append(row)
            b.shared_grid(grid, 'plain-render' if b.detail else ws, shade(col, 1.0 - 0.03 * ti), smooth=True, scale=2.0)
    # pools round the podium
    if b.detail < 2:
        with b.site():
            for i in range(n):
                a = TAU * (i + 0.0) / n
                px, py = math.cos(a) * R * 1.35, math.sin(a) * R * 1.35
                pts = [(px + R * 0.2 * math.cos(TAU * k / 12), py + R * 0.2 * math.sin(TAU * k / 12), 0.06) for k in range(12)]
                b.face(pts, 'plain', '#5f98b3')
    steps_n = 3
    lib.steps(b, -R * 0.12, R * 0.12, -R * 1.05, 0.8, R * 0.2, steps_n, 'paving', lk.stone_col)
    e = R * 1.6
    return (-e, -e, e, e)


def build_yurt(b, lk, D, srng):
    W, Dp, H = D['W'], D['D'], D['H']
    R = max(3.0, min(W, Dp) / 2 * 0.9)
    col, ws = lk.wall_col, D['wslot']
    wh = U.clamp(H * 0.42, 2.4, 6)
    cy = Dp * 0.08
    b.section('yurt')
    plat = 0.5
    lib.cylinder(b, 0.0, cy, 0, plat, R + 1.2, n=U.nn(b, 20), slot='stone-blocks', col='#a8a39a', top=True, top_slot='paving', top_col='#b8b4aa')
    lib.cylinder(b, 0.0, cy, plat, plat + wh, R, n=U.nn(b, 20), slot=ws, col=col, top=False, smooth=False)
    if b.detail < 2:
        door_bay(b, D, 0.0, cy - R, plat, 2.0, wh * 0.78, '#a5322a')
        if b.detail == 0:
            for k in range(6):
                a = math.pi * (1.25 + 0.5 * k / 5)
                for sgn in (0,):
                    pass
            for k in range(8):
                a = TAU * (k + 0.5) / 8
                if abs(a - 1.5 * math.pi) < 0.3:
                    continue
                ca, sa = math.cos(a), math.sin(a)
                rr = R * math.cos(math.pi / 20) + 0.03
                pts = [(rr * ca - 0.4 * sa, cy + rr * sa + 0.4 * ca, plat + wh * 0.3), (rr * ca + 0.4 * sa, cy + rr * sa - 0.4 * ca, plat + wh * 0.3),
                       (rr * ca + 0.4 * sa, cy + rr * sa - 0.4 * ca, plat + wh * 0.72), (rr * ca - 0.4 * sa, cy + rr * sa + 0.4 * ca, plat + wh * 0.72)]
                b.face(pts, 'glass-punched', '#d6dade')
    rise = max(2.0, H - wh - plat)
    z = plat + wh
    cone_prof = [(R + 0.9, -0.15), (R * 0.62, rise * 0.55), (R * 0.2, rise * 0.9), (R * 0.12, rise)]
    U.revolve(b, 0.0, cy, z, cone_prof, U.nn(b, 20), D['rslot'], D['roofc'], smooth=False, cap=False, scale=1.5)
    if b.detail < 2:
        lib.cylinder(b, 0.0, cy, z + rise - 0.1, z + rise + 0.9, 0.5, n=8 if b.detail == 0 else 5, slot='plain-render', col=lk.accent_col, r_top=0.3)
        U.finial(b, 0.0, cy, z + rise + 0.8, 1.6, GOLD, balls=2, r=0.3)
        if b.detail == 0:
            lib.cylinder(b, 0.0, cy, z + 0.1, z + 0.5, R + 0.6, n=20, slot='plain-render', col=lk.accent_col, top=False)
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    if D['fence']:
        wall_ring(b, D, -W / 2 + 0.4, -Dp / 2 + 0.4, W / 2 - 0.4, Dp / 2 - 0.4, 2.0, 4.0, '#efe9dc', D['roofc'], ws)
    return tuple(ext)


def _meru(b, D, cx, cy, tiers, base_w, th, col, wall_col):
    """Balinese meru: a stone base and stacked tapering square thatched roofs."""
    ws = D['wslot']
    bxc(b, cx, cy, 0, base_w + 1.0, base_w + 1.0, 1.2, 'stone-blocks', '#8a867c', skip=('bottom',), top_slot='paving', top_col='#a8a39a', scale=1.0 if b.detail == 0 else 5.0)
    z = 1.2
    w = base_w
    for k in range(tiers):
        hk = th * (0.9 - 0.04 * k)
        # post block, then a hip roof
        bxc(b, cx, cy, z, w * 0.7, w * 0.7, hk * 0.38, ws, wall_col, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        U.frustum(b, cx, cy, z + hk * 0.38, z + hk * 0.38 + hk * 0.55, w * 1.3, w * 1.3, w * 0.34, w * 0.34, 'timber', col, top=False)
        z += hk * 0.93
        w *= 0.78
    U.cone(b, cx, cy, z, z + th * 0.8, w * 0.7, 4, 'timber', col, smooth=False)
    if b.detail < 2:
        U.finial(b, cx, cy, z + th * 0.75, 1.2, GOLD, balls=1, r=0.2)


def build_pura(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    ws, wc = D['wslot'], lk.wall_col
    thatch = '#3a2f26'
    stone = shade(wc, 0.9)
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    b.section('walls')
    x0, x1, y0, y1 = -W / 2 + 0.6, W / 2 - 0.6, -Dp / 2 + 0.6, Dp / 2 - 0.6
    wall_h = 2.2
    gap = 3.0
    wall_ring(b, D, x0, y0, x1, y1, wall_h, 2 * gap + 3.0, stone, '#6a625a', ws)
    # split gate: two stepped halves either side of the gap
    b.section('gate')
    for sx in (-1, 1):
        zc = 0.0
        w = 3.6
        gx = sx * (gap + w / 2)
        for k in range(4):
            hk = 1.6 + 0.2 * k
            U.frustum(b, gx, y0 + 0.25, zc, zc + hk, w * (1 - 0.1 * k), 2.4 * (1 - 0.06 * k), w * (1 - 0.1 * (k + 1)) * 0.97, 2.4 * (1 - 0.06 * (k + 1)) * 0.97, ws, stone, top=False,
                      scale=1.0 if b.detail == 0 else 5.0)
            zc += hk
        bxc(b, gx, y0 + 0.25, zc, w * 0.55, 1.4, 0.4, 'plain-render', shade(stone, 1.1), skip=('bottom',))
    # shrines along the court
    b.section('shrines')
    k = int(U.clamp(W / 20, 1, 5))
    tiers_n = [D['tiers'] or 3, 5, 3, 7, 3]
    for i in range(k):
        x = -W / 2 + W * (i + 0.5) / k
        yy = Dp * 0.18
        if i % 2 == 0 or k == 1:
            t = int(U.clamp(tiers_n[i % len(tiers_n)], 1, 11))
            bw_ = U.clamp(W / k * 0.2, 3.4, 8.0)
            _meru(b, D, x, yy, t, bw_, U.clamp(bw_ * 0.7, 2.0, 5.0), thatch, wc)
        else:
            # open pavilion (bale)
            bwid, bd = 7.0, 4.0
            for sx in (-1, 1):
                for sy in (-1, 1):
                    lib.cylinder(b, x + sx * bwid * 0.42, yy + sy * bd * 0.4, 0.6, 3.0, 0.2, n=5, slot='timber', col='#6a4a30', top=False)
            bxc(b, x, yy, 0, bwid, bd, 0.6, 'stone-blocks', '#a8a39a', skip=('bottom',))
            lib.hip(b, (x - bwid / 2 - 0.5, yy - bd / 2 - 0.5, x + bwid / 2 + 0.5, yy + bd / 2 + 0.5), 3.0, 1.6, lk, ov=0.3, roof_slot='timber', roof_col=thatch)
    return tuple(ext)


def build_octhall(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    R = min(W, Dp) / 2 * 0.86
    col, ws = lk.wall_col, D['wslot']
    wh = U.clamp(H * 0.58, 4, 14)
    b.section('plinth')
    pts = [(R * 1.12 * math.cos(TAU * i / 8 + math.pi / 8 + math.pi / 2), R * 1.12 * math.sin(TAU * i / 8 + math.pi / 8 + math.pi / 2)) for i in range(8)]
    lib.prism(b, pts, 0, 0.9, 'stone-blocks', shade(col, 0.88), top=True, top_slot='paving', top_col=lk.stone_col, scale=1.0 if b.detail == 0 else 5.0)
    z0 = 0.9
    b.section('hall')
    pts = [(R * math.cos(TAU * i / 8 + math.pi / 8 + math.pi / 2), R * math.sin(TAU * i / 8 + math.pi / 8 + math.pi / 2)) for i in range(8)]
    fp = lib.fp_polygon(pts)
    for seg in fp.edges():
        lib.facade(b, seg, z0, z0 + wh, 2 if (wh > 8 and b.detail == 0) else 1, lk, 'arched' if b.detail < 2 else 'none', 0.28, None, 3.4, reduced=(b.detail >= 1), wall_slot=ws, wall_col=col)
    if b.detail == 0:
        lib.cornice(b, fp, z0 + wh - 0.45, 0.45, 0.45, lk, D['trim'])
        lib.cornice(b, fp, z0 + wh * 0.5, 0.35, 0.3, lk, D['trim'])
    lib.cap(b, fp.polys, z0 + wh, True, 'roof-flat', shade(col, 0.92), scale=4.0)
    lib.parapet(b, fp, z0 + wh, 0.8, 0.3, lk, ws, D['trim'])
    b.section('domes')
    rc = R * 0.55
    dh = rc * 0.4
    drum_top = U.drum(b, 0.0, 0.0, z0 + wh, dh, rc, 16 if b.detail == 0 else 8, ws, col, window_col='#e8eef2', windows=8 if b.detail == 0 else 0, ring=True, trim=D['trim'])
    U.dome(b, 0.0, 0.0, drum_top, rc, rc * 1.1, 'onion' if D['onion'] else 'hemi', 'metal-roof' if D['gold'] else D['rslot'], D['roofc'], n=U.nn(b, 24), rings=7 if b.detail == 0 else 3)
    U.finial(b, 0.0, 0.0, drum_top + rc * 1.05, max(1.0, rc * 0.3), GOLD, balls=2, r=0.3)
    for i in range(8):
        if i % 2:
            continue
        a = TAU * i / 8 + math.pi / 2 + math.pi / 8 + math.pi / 8
        px, py = (R - 1.6) * math.cos(a), (R - 1.6) * math.sin(a)
        if b.detail < 2:
            lib.cylinder(b, px, py, z0 + wh + 0.8, z0 + wh + 2.4, 0.9, n=8 if b.detail == 0 else 6, slot=ws, col=col, top=False)
            U.dome(b, px, py, z0 + wh + 2.4, 1.0, 1.2, 'hemi', D['rslot'], D['roofc'], n=U.nn(b, 12), rings=4 if b.detail == 0 else 2)
    lib.steps(b, -2.4, 2.4, -R * 1.12, 0.9, 2.0, 3, 'paving', lk.stone_col)
    e = R * 1.2 + 1.0
    return (-e, -e, e, e)


# ================================================================================================================ build
def build(brief, style, rng, detail):
    limit = {0: 18500, 1: 3700, 2: 470}[detail]
    state = rng.getstate()
    for lean in range(0, 5):
        rng.setstate(state)
        b = lib.Builder('temple', detail)
        lk = lib.look(brief, style, rng)
        D = design(brief, style, rng, lk)
        D['lean'] = lean
        srng = U.sub(rng)
        fn = {'hall': build_hall_impl, 'shinto': build_shinto, 'pagoda': build_pagoda, 'stupa': build_stupa, 'wat': build_wat, 'shikhara': build_shikhara,
              'gopuram': build_gopuram, 'gurdwara': build_gurdwara, 'lotus': build_lotus, 'yurt': build_yurt, 'pura': build_pura,
              'octhall': build_octhall}[D['type']]
        ext = fn(b, lk, D, srng)
        _site(b, lk, D, srng, ext, brief)
        if b.tris <= limit:
            break
    return b.objects()


def _site(b, lk, D, srng, ext, brief):
    b.section('site')
    x0, y0, x1, y1 = ext
    m = 0.5 if D['fence'] else 1.5
    fx0, fy0, fx1, fy1 = x0 - m, y0 - m, x1 + m, y1 + m
    fc = (brief.get('setting') or {}).get('forecourt') or 'plaza'
    front = 14.0 if fc in ('road', 'parking') else 11.0
    pad = (fx0 - 5, fy0 - front, fx1 + 5, fy1 + 5)
    lib.ground(b, *pad, lk, scale=5.0)
    if D['lean'] >= 2 and fc == 'parking':
        fc = 'plaza'
    U.front_apron(b, lk, srng, fc, pad[0] + 1, pad[2] - 1, fy0 - 0.3, pad[1], lk.tree)
    n = max(2, 6 + int(srng.random() * 3) - 2 * D['lean'])
    U.trees_ring(b, lk, srng, lk.tree, (fx0, fy0, fx1, fy1), pad, n, h=7.0, avoid=[])
