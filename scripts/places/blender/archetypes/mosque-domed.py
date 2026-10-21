"""mosque-domed: domed mosques in six typologies chosen from the brief (style, era, size, wording, features):

  ottoman  square prayer hall under one great pointed dome on a windowed drum, four semi-domes, corner domes, domed cloister round a
           fountain court, slender pencil minarets (Sultanahmet, Ghana National Mosque)
  gulf     the modern Arab/Nigerian type: wide hall on a podium, big central dome (gold, green or white) plus smaller domes, a projecting
           pointed-arch portal or arcaded porch, tall minarets at the corners, optional arcaded court (Abuja, Lagos, Kano, Kaduna)
  arab     traditional Arab / North African: low hypostyle hall with parapet and a mid dome, arcaded sahn, one tall square minaret
  south    South Asian / Mughal: red-sandstone or white hall, big pishtaq portal, three onion domes, corner chhatris, chhatri minarets
  persian  tall iwan with two minarets above it, a turquoise bulbous dome on a high drum, arcaded court
  compact  small community / urban mosque: a cube hall with one dome on a drum, attached minaret, optional brick (London, Lome, Lokoja)

Layout (metres): front (portal, court gate, forecourt) towards -Y; the prayer hall is at the back (+Y); x = 0 on the axis.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib  # noqa: E402
import _mosque_domed_util as U  # noqa: E402
from lib import mix, shade  # noqa: E402

FEATURES = {'dome', 'onion-dome', 'minaret', 'arches', 'arcade', 'courtyard', 'fence-wall', 'gate', 'steps', 'relief-pattern', 'mosaic',
            'stained-glass', 'fountain', 'pinnacles', 'crenellation', 'colonnade', 'flags'}

def bx(b, *a, **kw):
    """lib.box with coarse texture tiles at LOD1/LOD2 (long walls would otherwise be cut into many tiles)."""
    if b.detail >= 1:
        kw.setdefault('scale', 6.0)
    lib.box(b, *a, **kw)


def bxc(b, *a, **kw):
    if b.detail >= 1:
        kw.setdefault('scale', 6.0)
    lib.box_c(b, *a, **kw)


HR = {'hemi': 1.0, 'pointed': 1.15, 'shallow': 0.62, 'onion': 1.35, 'bulb': 1.25, 'ogee': 1.2}


# ================================================================================================================ design
def warnings(brief, style):
    w = []
    ft = U.feats(brief)
    if not ft:
        w.append('no features listed: defaults chosen from style and size')
    return w


def _slots(brief, lk):
    f = brief.get('facade') or {}
    rm = f.get('roofMaterial')
    col = lk.roof_col
    if U.goldish(col) or rm in ('gold-leaf', 'copper', 'metal-sheet', 'corrugated'):
        slot = 'metal-roof'
    elif rm == 'clay-tile':
        slot = 'clay-tile'
    else:
        slot = 'roof-flat'
    return slot, col


def solve_heights(H, rc, kind, drum_ratio, wh_lo_frac=0.34, wh_min=4.0):
    hr = HR.get(kind, 1.0)
    for _ in range(3):
        dh, hd = rc * drum_ratio, rc * hr
        wh = H - hd - dh
        lo = max(wh_min, wh_lo_frac * H)
        if wh >= lo:
            break
        rc = (H - lo) / (hr + drum_ratio)
    rc = max(rc, 1.6)
    dh, hd = rc * drum_ratio, rc * hr
    return rc, hd, dh, max(H - hd - dh, 2.8)


def design(brief, style, rng, lk):
    F = U.form_of(brief)
    ft = U.feats(brief)
    txt = U.text(brief, style)
    st = brief.get('style') or ''
    yr = U.era_year(brief)
    r = [rng.random() for _ in range(40)]
    W, Dp, H = F['w'], F['d'], F['h']
    storeys = max(1, F['storeys'])
    if H <= 0:
        H = 7.0 + 3.5 * storeys + W / 12
    variant = F['variant']
    typ = None
    for key, t in (('ottoman', 'ottoman'), ('persian', 'persian'), ('mughal', 'south'), ('south', 'south'), ('compact', 'compact'), ('gulf', 'gulf'),
                   ('arab', 'arab'), ('maghreb', 'arab')):
        if key in variant:
            typ = t
            break
    if typ is None:
        if st == 'ottoman' or U.has_word(txt, 'ottoman', 'blue mosque', 'sultanahmet', 'turkish', 'selimiye'):
            typ = 'ottoman'
        elif st == 'persian' or U.has_word(txt, 'persian', 'iranian', 'safavid', 'isfahan', 'shiraz'):
            typ = 'persian'
        elif st in ('mughal', 'south-asian') or U.has_word(txt, 'mughal', 'pakistan', 'lahore', 'badshahi', 'bangladesh', 'dhaka'):
            typ = 'south'
        elif W <= 34 or W * Dp <= 950:
            typ = 'compact'
        elif U.has_word(txt, 'maghreb', 'morocc', 'tunis', 'algeri', 'andalus', 'cordob', 'egypt', 'mamluk', 'cairo', 'marrakech', 'kairouan', 'hypostyle') \
                or (yr is not None and yr < 1850):
            typ = 'arab'
        else:
            typ = 'gulf'
    D = {'F_roof': F['roof'], 'type': typ, 'r': r, 'ft': ft, 'txt': txt, 'H': H, 'storeys': storeys, 'yr': yr}
    # ---- counts
    nd = ft.get('dome', {}).get('count', 0) + ft.get('onion-dome', {}).get('count', 0)
    if nd == 0 and F['roof'] in ('dome', 'multi-dome') or (not ft and nd == 0):
        nd = 1
    if F['roof'] == 'multi-dome' and nd <= 1:
        nd = {'ottoman': 9, 'gulf': 1 + 2 + int(r[0] * 3) * 2, 'arab': 5, 'south': 3, 'persian': 3, 'compact': 3}[typ]
    D['nsec'] = int(U.clamp(max(0, nd - 1), 0, 12))
    D['nd'] = nd
    if 'minaret' in ft:
        nm = ft['minaret']['count'] or 1
    else:
        nm = 1 if not ft else 0
    D['nmin'] = int(U.clamp(nm, 0, 6))
    D['min_note'] = ft.get('minaret', {}).get('note', '')
    D['onion'] = 'onion-dome' in ft or typ == 'south'
    # ---- fit
    court_default = typ in ('ottoman', 'persian', 'arab') and W >= 38
    D['court'] = ('courtyard' in ft) or court_default or (typ == 'gulf' and 'arcade' in ft and W >= 48)
    D['fence'] = 'fence-wall' in ft or 'gate' in ft
    D['gate'] = 'gate' in ft
    D['steps'] = 'steps' in ft
    D['arcade'] = 'arcade' in ft or 'colonnade' in ft
    D['arches'] = 'arches' in ft
    D['mosaic'] = 'mosaic' in ft
    D['relief'] = 'relief-pattern' in ft
    D['stained'] = 'stained-glass' in ft
    D['fountain'] = 'fountain' in ft or typ == 'ottoman'
    D['pinnacles'] = 'pinnacles' in ft
    D['cren'] = 'crenellation' in ft
    D['flags'] = 'flags' in ft
    marg = 2.8 if D['fence'] else 0.0
    sc = U.fit_scale(W + 2 * marg, Dp + 2 * marg)
    W, Dp = W * sc, Dp * sc
    D['sc'] = sc
    D['W'], D['D'] = W, Dp
    D['marg'] = marg
    D['bay'] = U.clamp(math.sqrt(W * Dp) / 13.0, 3.8, 7.5)
    # ---- palette
    D['slot'], D['dcol'] = _slots(brief, lk)
    D['wall'], D['wslot'] = lk.wall_col, lk.wall_slot
    D['trim'] = lk.trim_col
    D['accent'] = lk.accent_col
    kind = lk.windows if lk.windows in ('arched', 'pointed-arch', 'punched') else 'arched'
    D['wkind'] = kind
    D['pointed'] = kind == 'pointed-arch' or (kind == 'arched' and r[1] < 0.55)
    D['gold'] = U.goldish(D['dcol'])
    return D


# ================================================================================================================ pieces
def dn(b, R, D=None):
    """(segments, rings) for a dome of radius R at this LOD."""
    lean = D['lean'] if D else 0
    if b.detail == 0:
        n, rg = (28, 8) if R > 8 else ((24, 8) if R > 4 else (16, 5))
        if lean >= 3:
            n, rg = int(n * 0.7), max(4, rg - 3)
        return n, rg
    if b.detail == 1:
        return (12, 4) if R > 4 else (8, 3)
    return (8, 3) if R > 5 else (6, 2)


def _dome_cap(b, D):
    cap = 12
    if D['lean'] >= 1:
        cap = 8
    if D['lean'] >= 2:
        cap = 5
    if D['lean'] >= 3:
        cap = 3
    if b.detail == 2:
        cap = min(cap, 6 if D['lean'] == 0 else (4 if D['lean'] == 1 else 2))
    return cap


def dome_unit(b, lk, D, cx, cy, z, R, hd, dh, kind, windows=0, flute=None, drum_col=None, finial_h=None, ring=True, n=None):
    """Drum (optionally windowed) + dome + finial. Returns the apex z."""
    n, rings = dn(b, R, D)
    if b.detail == 2 and R <= 5:
        dh = 0.0
        finial_h = 0.0
    dcol = D['dcol']
    wc = drum_col or D['wall']
    zt = z
    if dh > 0.05:
        zt = U.drum(b, cx, cy, z, dh, R * 1.0, n, D['wslot'], wc, window_col=('#6f93c0' if D['stained'] else '#e8eef2'), windows=windows if b.detail == 0 else 0,
                    win_w=min(1.5, R * 0.3), ring=ring, trim=D['trim'])
    U.dome(b, cx, cy, zt, R * 1.0, hd, kind, D['slot'], dcol, n=n, rings=rings, flute=flute, base_ring=ring and R > 3)
    top = zt + hd * (0.6 if kind == 'shallow' else 1.0)
    fh = finial_h if finial_h is not None else max(0.8, min(3.2, R * 0.28))
    if b.detail == 2 and R <= 5:
        fh = 0.0
    if fh > 0.01 and (b.detail < 2 and R > 1.6 or b.detail == 2 and R > 4):
        U.finial(b, cx, cy, top - 0.05, fh, D['gold_fin'] if 'gold_fin' in D else ('#d4a82f' if not D['gold'] else shade(D['dcol'], 1.1)), balls=3 if R > 5 else 2, r=max(0.18, R * 0.04))
    return top + fh


def hall_walls(b, lk, D, rect, z0, z1, rows, front_kind=None, side_full=True, bay=None, ratio=None, front=True):
    x0, y0, x1, y1 = rect
    segs = [('front', lib.Seg((x0, y0), (x1, y0))), ('right', lib.Seg((x1, y0), (x1, y1))), ('back', lib.Seg((x1, y1), (x0, y1))),
            ('left', lib.Seg((x0, y1), (x0, y0)))]
    small = (x1 - x0) + (y1 - y0) < 80
    for name, seg in segs:
        kind = (front_kind or D['wkind']) if name == 'front' else D['wkind']
        red = (name == 'back') or (name in ('left', 'right') and (not side_full or D['lean'] >= 1))
        if b.detail == 1 and ((name != 'front' and not small) or D['lean'] >= 2):
            kind = 'none'
        lib.facade(b, seg, z0, z1, rows if (b.detail == 0 and D['lean'] == 0) else 1, lk, kind, ratio if ratio is not None else max(lk.ratio, 0.22), None, bay or D['bay'], reduced=red,
                   wall_slot=D['wslot'], wall_col=D['wall'])
    if b.detail == 0:
        fp = lib.fp_rect(x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2)
        lib.sweep(b, fp, z0, [(0.07, 0), (0.07, 0.55), (0, 0.55)], D['wslot'], shade(D['wall'], 0.8))
        lib.cornice(b, fp, z1 - 0.38, 0.35, 0.38, lk, D['trim'])
        if D['lean'] == 0 and D['r'][30] < 0.75:
            for name, seg in segs:
                if name == 'back' or (name != 'front' and not small):
                    continue
                m = max(2, round(seg.length / ((bay or D['bay']) * 2)))
                for k in range(1, m):
                    u = seg.length * k / m
                    lib.seg_box(b, seg, u - 0.3, u + 0.3, z0 + 0.55, z1 - 0.4, 0.2, D['trim'], 'plain-render')


def frieze(b, lk, D, rect, z, h=0.9, col=None, relief=False):
    """Accent band round a rectangle (mosaic) with raised squares (relief-pattern)."""
    if b.detail >= 2:
        return
    x0, y0, x1, y1 = rect
    col = col or D['accent']
    sides = [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
    for i, (p, q) in enumerate(sides):
        if b.detail == 1 and i in (2, 3):
            continue
        seg = lib.Seg(p, q)
        lib.seg_box(b, seg, 0, seg.length, z, z + h, 0.06, col, 'plain-render')
        if relief and b.detail == 0 and i in (0, 1):
            n = int(seg.length / 1.4)
            for k in range(n):
                u = (k + 0.5) * seg.length / n
                lib.seg_box(b, seg, u - 0.32, u + 0.32, z + 0.18, z + h - 0.18, 0.14, shade(col, 1.25), 'plain-render')


def roof_deck(b, lk, D, rect, z, parapet=0.9, cren=False, pinn=False):
    x0, y0, x1, y1 = rect
    fp = lib.fp_rect(x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2)
    r = D['r']
    deck = mix(D['wall'], '#8c8c88', 0.55) if r[34] < 0.6 else (mix(D['wall'], '#a0583c', 0.55) if r[34] < 0.8 else mix(D['wall'], '#b8b4aa', 0.45))
    lib.cap(b, fp.polys, z, True, 'roof-flat', deck, scale=4.0)
    if parapet > 0:
        lib.parapet(b, fp, z, parapet, 0.3, lk, D['wslot'], D['trim'])
    if cren:
        U.crenellate(b, x0 + 0.15, y0 + 0.15, x1 - 0.15, y1 - 0.15, z + parapet + 0.06, D['trim'], h=0.55)
    if pinn and b.detail < 2:
        for sx in (x0 + 0.35, x1 - 0.35):
            for sy in (y0 + 0.35, y1 - 0.35):
                U.pinnacle(b, sx, sy, z + parapet, 0.34, 1.5, D['trim'], n=6, slot='plain-render', base=0.5)
    # rooftop furniture: stair head and a water tank on legs
    if b.detail < 2 and (x1 - x0) > 10 and (y1 - y0) > 8:
        if r[31] < 0.55:
            sx_ = x1 - 2.2 if r[33] < 0.5 else x0 + 2.2
            bxc(b, sx_, y1 - 2.2, z, 2.4, 2.4, 2.4, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'], skip=('bottom',))
            if b.detail == 0:
                b.face([(sx_ - 0.5, y1 - 2.2 - 1.23, z), (sx_ + 0.5, y1 - 2.2 - 1.23, z), (sx_ + 0.5, y1 - 2.2 - 1.23, z + 1.8), (sx_ - 0.5, y1 - 2.2 - 1.23, z + 1.8)], 'glass-punched', '#e0e4e6')
        if r[32] < 0.4 and b.detail == 0:
            tx = x0 + 2.4 if r[33] < 0.5 else x1 - 2.4
            for dx, dy in ((-0.6, -0.6), (0.6, -0.6), (-0.6, 0.6), (0.6, 0.6)):
                lib.box_c(b, tx + dx, y0 + 3.0 + dy, z, 0.12, 0.12, 0.8, 'plain', '#6a6e72', skip=('bottom', 'top'))
            lib.cylinder(b, tx, y0 + 3.0, z + 0.8, z + 2.2, 0.95, n=10, slot='plain', col='#2f3a44', top=True)


def secondary_positions(k, cx, cy, hx, hy, rs, rc):
    """Positions of k smaller domes around the central one on a hall of half-size (hx, hy)."""
    pats = {
        1: [(0, -0.75)],
        2: [(-0.62, 0), (0.62, 0)],
        3: [(-0.62, 0), (0.62, 0), (0, -0.75)],
        4: [(-0.68, -0.68), (0.68, -0.68), (-0.68, 0.68), (0.68, 0.68)],
        5: [(-0.68, -0.68), (0.68, -0.68), (-0.68, 0.68), (0.68, 0.68), (0, -0.78)],
        6: [(-0.68, -0.68), (0.68, -0.68), (-0.68, 0.68), (0.68, 0.68), (-0.8, 0), (0.8, 0)],
        7: [(-0.68, -0.68), (0.68, -0.68), (-0.68, 0.68), (0.68, 0.68), (-0.8, 0), (0.8, 0), (0, -0.78)],
        8: [(-0.68, -0.68), (0.68, -0.68), (-0.68, 0.68), (0.68, 0.68), (-0.8, 0), (0.8, 0), (0, -0.78), (0, 0.78)],
    }
    if k <= 0:
        return []
    pat = pats.get(min(k, 8), pats[8])
    if k > 8:
        pat = pat + [(-0.34, -0.8), (0.34, -0.8), (-0.34, 0.8), (0.34, 0.8)][:k - 8]
    ax, ay = hx - rs - 0.5, hy - rs - 0.5
    out = []
    for fx, fy in pat:
        x, y = fx * ax, fy * ay
        if abs(fy) < 0.2 and abs(x) < rc + rs + 0.4:
            x = math.copysign(rc + rs + 0.4, fx)
        if abs(fx) < 0.2 and abs(y) < rc + rs + 0.4:
            y = math.copysign(rc + rs + 0.4, fy)
        if abs(x) > hx - rs * 0.7 or abs(y) > hy - rs * 0.7:
            continue
        if math.hypot(x, y) < rc + rs * 0.75:
            continue
        out.append((cx + x, cy + y))
    return out


def portal(b, lk, D, cx, y_face, z0, w, h, depth, pointed=True, dome_top=False, stepped=True):
    """Projecting iwan: a block with a tall pointed-arch recess, a cornice and (optionally) a small dome or twin finials."""
    x0, x1 = cx - w / 2, cx + w / 2
    ys = y_face - depth
    wc, ws = D['wall'], D['wslot']
    # side and top faces
    bx(b, x0, ys, z0, x1, y_face, z0 + h, ws, wc, skip=('bottom', 'front', 'back'), top_slot='roof-flat', top_col=D['trim'])
    seg = lib.Seg((x0, ys), (x1, ys))
    ow = w * 0.58
    arch_h = h * 0.78
    U.arch_openings(b, seg, lk, z0, z0 + h, 1, 'pointed' if pointed else 'arch', ow=ow, oh=arch_h, depth=min(1.4, depth + 0.5), col=wc, slot=ws, sill=0.0,
                    crown_gap=0.8)
    if b.detail == 0:
        # cornice slab and framing pilasters
        bx(b, x0 - 0.3, ys - 0.3, z0 + h, x1 + 0.3, y_face, z0 + h + 0.4, 'plain-render', D['trim'])
        lib.seg_box(b, seg, 0.0, 0.5, z0, z0 + h, 0.25, D['trim'], 'plain-render')
        lib.seg_box(b, seg, w - 0.5, w, z0, z0 + h, 0.25, D['trim'], 'plain-render')
    top = z0 + h + (0.4 if b.detail == 0 else 0)
    if dome_top:
        U.dome(b, cx, (ys + y_face) / 2, top, min(w, depth * 2) * 0.28 + 0.4, w * 0.2, 'hemi', D['slot'], D['dcol'], n=U.nn(b, 14), rings=3 if b.detail == 0 else 2)
    elif b.detail < 2:
        for sx in (x0 + 0.5, x1 - 0.5):
            U.pinnacle(b, sx, ys + 0.5, top, 0.28, 1.3, D['trim'], n=6, slot='plain-render', base=0.4)
    return top


def porch(b, lk, D, x0, x1, y_face, z0, h, depth, n, pointed=True):
    """A full-width arcaded porch (riwaq) on the hall front with a flat roof."""
    ys = y_face - depth
    ws, wc = D['wslot'], D['wall']
    bx(b, x0, ys, z0, x1, y_face, z0 + h, ws, wc, skip=('bottom', 'front', 'back'), top_slot='roof-flat', top_col=shade(wc, 0.9))
    seg = lib.Seg((x0, ys), (x1, ys))
    U.arch_openings(b, seg, lk, z0, z0 + h, n, 'pointed' if pointed else 'arch', ow=(x1 - x0) / n * 0.62, oh=h * 0.72, depth=min(1.6, depth * 0.55), col=wc, slot=ws,
                    sill=0.0, crown_gap=0.55)
    if b.detail == 0:
        fp = lib.fp_rect(x1 - x0, depth, (x0 + x1) / 2, (ys + y_face) / 2)
        lib.parapet(b, fp, z0 + h, 0.7, 0.28, lk, ws, D['trim'])
        lib.cornice(b, fp, z0 + h - 0.42, 0.3, 0.42, lk, D['trim'])


# ------------------------------------------------------------------------------------------------------------- minarets
def _minaret_lo(b, lk, D, cx, cy, z0, H, kind, bw):
    """LOD1/LOD2 minaret: base block, tapering shaft, one gallery, upper shaft and a cone/pyramid cap."""
    wc, ws, tc = D['wall'], D['wslot'], D['trim']
    d = b.detail
    if kind == 'square':
        hb, w1 = H * 0.74, bw * 0.8
        U.frustum(b, cx, cy, z0, z0 + hb, bw, bw, w1, w1, ws, wc, top=False)
        if d == 2:
            bxc(b, cx, cy, z0 + hb, w1 * 0.7, w1 * 0.7, H * 0.2, ws, wc, skip=('bottom', 'top'))
            U.frustum(b, cx, cy, z0 + hb + H * 0.2, z0 + H, w1 * 0.72, w1 * 0.72, 0.05, 0.05, D['slot'], D['dcol'], top=False)
            return
        bxc(b, cx, cy, z0 + hb, w1 * 1.25, w1 * 1.25, 0.6, ws, tc, top_slot='roof-flat', top_col=tc)
        w2 = w1 * 0.62
        bxc(b, cx, cy, z0 + hb + 0.6, w2, w2, H * 0.15, ws, wc, top=False) if False else bxc(b, cx, cy, z0 + hb + 0.6, w2, w2, H * 0.15, ws, wc)
        zt = z0 + hb + 0.6 + H * 0.15
        U.frustum(b, cx, cy, zt, H + z0, w2 * 1.05, w2 * 1.05, 0.05, 0.05, D['slot'], D['dcol'], top=False)
        return
    if d == 2:
        r0 = bw * 0.38
        bxc(b, cx, cy, z0, bw, bw, H * 0.15, ws, wc, skip=('bottom', 'top'))
        lib.cylinder(b, cx, cy, z0 + H * 0.15, z0 + H * 0.88, r0, n=5, slot='plain', col=wc, r_top=r0 * 0.7, top=False, smooth=False)
        lib.cylinder(b, cx, cy, z0 + H * 0.88, z0 + H, r0 * 1.0, n=5, slot='plain', col=D['dcol'], r_top=0.0, top=False, smooth=False)
        return
    n = 8 if d == 1 else 6
    hb = H * 0.17
    bxc(b, cx, cy, z0, bw, bw, hb, ws, wc)
    r0 = bw * 0.38
    g1 = z0 + H * 0.64
    U.revolve(b, cx, cy, z0 + hb, [(r0, 0), (r0 * 0.88, g1 - z0 - hb)], n, 'plain-render', wc, smooth=False, cap=False)
    lib.cylinder(b, cx, cy, g1 - 0.2, g1 + 0.6, r0 * 1.6, n=n, slot='plain-render', col=tc, top=True, smooth=False)
    g2 = z0 + H * 0.88
    U.revolve(b, cx, cy, g1 + 0.6, [(r0 * 0.72, 0), (r0 * 0.66, g2 - g1 - 0.6)], n, 'plain-render', wc, smooth=False, cap=False)
    lib.cylinder(b, cx, cy, g2, z0 + H, r0 * 1.1, n=n, slot=D['slot'], col=D['dcol'], r_top=0.0, top=False, smooth=False)


def minaret(b, lk, D, cx, cy, z0, H, kind, bw):
    if b.detail >= 1 or D['lean'] >= 3:
        return _minaret_lo(b, lk, D, cx, cy, z0, H, kind, bw)
    wc, ws = D['wall'], D['wslot']
    tc = D['trim']
    ac = D['accent']
    cap_col = D['dcol']
    cap_slot = D['slot']
    d = b.detail
    gal = lambda z, r, hh, col: _gallery(b, cx, cy, z, r, hh, col, ws, tc)
    if kind == 'square':
        hb = H * 0.74
        w1 = bw * 0.8
        U.frustum(b, cx, cy, z0, z0 + hb, bw, bw, w1, w1, ws, wc, top=False)
        if d == 0:
            for k in range(1, 6):          # horizontal bands
                zz = z0 + hb * k / 6.0
                ww = bw + (w1 - bw) * k / 6.0
                bxc(b, cx, cy, zz - 0.12, ww + 0.22, ww + 0.22, 0.24, 'plain-render', tc)
            # dark slit windows on the front face
            for k in range(3):
                zz = z0 + hb * (0.18 + 0.2 * k)
                ww = bw + (w1 - bw) * (0.18 + 0.2 * k)
                bxc(b, cx, cy - ww / 2 - 0.01, zz, ww * 0.22, 0.04, hb * 0.09, 'glass-punched', '#3a3f45', skip=('bottom', 'back', 'top', 'left', 'right')) if False else \
                    b.face([(cx - ww * 0.11, cy - ww / 2 - 0.03, zz), (cx + ww * 0.11, cy - ww / 2 - 0.03, zz), (cx + ww * 0.11, cy - ww / 2 - 0.03, zz + hb * 0.09),
                            (cx - ww * 0.11, cy - ww / 2 - 0.03, zz + hb * 0.09)], 'glass-punched', '#e8eef2')
        gz = z0 + hb
        bxc(b, cx, cy, gz, w1 * 1.3, w1 * 1.3, H * 0.03 + 0.3, ws, tc, top_slot='roof-flat', top_col=shade(tc, 0.9))
        gz += H * 0.03 + 0.3
        if d == 0:
            U.crenellate(b, cx - w1 * 0.62, cy - w1 * 0.62, cx + w1 * 0.62, cy + w1 * 0.62, gz, tc, h=0.45, w=0.4, pitch=0.85)
        w2 = w1 * 0.62
        h2 = H * 0.16
        bxc(b, cx, cy, gz, w2, w2, h2, ws, wc, top_slot='roof-flat', top_col=tc)
        if d == 0:
            for sx, sy, hint in ((0, -1, 0), (1, 0, 1)):
                b.face([(cx - w2 * 0.2 + sx * w2 / 2 * 1.0 * (1 if sx else 0), 0, 0)] * 0) if False else None
            b.face([(cx - w2 * 0.2, cy - w2 / 2 - 0.03, gz + h2 * 0.25), (cx + w2 * 0.2, cy - w2 / 2 - 0.03, gz + h2 * 0.25), (cx + w2 * 0.2, cy - w2 / 2 - 0.03, gz + h2 * 0.8),
                    (cx - w2 * 0.2, cy - w2 / 2 - 0.03, gz + h2 * 0.8)], 'glass-punched', '#e8eef2')
        zt = gz + h2
        rise = H - zt
        if D['type'] == 'arab' and not D['gold']:
            lib.hip(b, (cx - w2 / 2, cy - w2 / 2, cx + w2 / 2, cy + w2 / 2), zt, rise * 0.55, lib, ov=0.15, ) if False else None
        U.frustum(b, cx, cy, zt, zt + rise * 0.45, w2 * 1.05, w2 * 1.05, 0.05, 0.05, cap_slot, cap_col, top=False)
        U.finial(b, cx, cy, zt + rise * 0.42, rise * 0.55, tc, balls=2, r=0.25)
        return
    # round / polygonal shafts
    n = U.nn(b, 12 if kind in ('pencil', 'persian') else 16)
    hb = H * (0.17 if kind != 'chhatri' else 0.15)
    bxc(b, cx, cy, z0, bw, bw, hb, ws, wc, top_slot='roof-flat', top_col=tc)
    if d == 0:
        bxc(b, cx, cy, z0 + hb - 0.25, bw + 0.3, bw + 0.3, 0.25, 'plain-render', tc)
        for sy in (-1, 1):
            for sx in (-1, 1):
                pass
    r0 = bw * (0.36 if kind in ('pencil', 'persian') else 0.4)
    if kind == 'gulf':
        n = U.nn(b, 8)
    zc = z0 + hb
    # lower shaft
    g1 = z0 + H * 0.62
    r1 = r0 * 0.9
    U.revolve(b, cx, cy, zc, [(r0 * 1.08, 0), (r0, 0.3), (r1, g1 - zc)], n, 'plain-render', wc, smooth=False, cap=False)
    if d == 0 and kind in ('gulf', 'persian', 'chhatri'):
        for k in range(1, 4):
            zz = zc + (g1 - zc) * k / 4.0
            lib.cylinder(b, cx, cy, zz - 0.14, zz + 0.14, r0 * (1.0 - 0.1 * k / 4) + 0.08, n=n, slot='plain-render', col=ac if kind != 'gulf' else tc, top=False, smooth=False)
    gal(g1, r1, 0.95, ac if kind == 'persian' else wc)
    z2 = g1 + 0.95
    r2 = r1 * 0.82
    g2 = z0 + H * (0.84 if kind != 'chhatri' else 0.8)
    U.revolve(b, cx, cy, z2, [(r2, 0), (r2 * 0.95, g2 - z2)], n, 'plain-render', wc, smooth=False, cap=False)
    if kind in ('pencil', 'persian', 'chhatri') or d == 0:
        gal(g2, r2 * 0.95, 0.9, wc)
        z3 = g2 + 0.9
    else:
        z3 = g2
    r3 = r2 * 0.74
    if kind == 'chhatri':
        h3 = H * 0.065
        U.revolve(b, cx, cy, z3, [(r3, 0), (r3, h3)], n, 'plain-render', wc, smooth=False, cap=False)
        z4 = z3 + h3
        pn = 6 if d < 2 else 4
        if d < 2:
            for k in range(pn):
                a = U.TAU * k / pn
                lib.cylinder(b, cx + r3 * 1.15 * math.cos(a), cy + r3 * 1.15 * math.sin(a), z4, z4 + H * 0.045, 0.1, n=5, slot='plain-render', col=tc, top=False)
        lib.cylinder(b, cx, cy, z4 + H * 0.045, z4 + H * 0.045 + 0.25, r3 * 1.5, n=n, slot='plain-render', col=tc, top=True)
        U.dome(b, cx, cy, z4 + H * 0.045 + 0.25, r3 * 1.5, r3 * 2.0, 'onion', cap_slot, cap_col, n=U.nn(b, 12), rings=4 if d == 0 else 3)
        U.finial(b, cx, cy, z4 + H * 0.045 + 0.25 + r3 * 2.0 - 0.1, H * 0.04, tc, balls=2, r=0.2)
        return
    h3 = H * 0.07
    U.revolve(b, cx, cy, z3, [(r3, 0), (r3, h3)], n, 'plain-render', wc, smooth=False, cap=False)
    z4 = z3 + h3
    if kind == 'gulf':
        lib.cylinder(b, cx, cy, z4, z4 + 0.3, r3 * 1.4, n=n, slot='plain-render', col=tc, top=True)
        U.dome(b, cx, cy, z4 + 0.3, r3 * 1.4, r3 * 1.7, 'onion' if D['onion'] or D['r'][5] < 0.4 else 'hemi', cap_slot, cap_col, n=U.nn(b, 12), rings=4 if d == 0 else 3)
        U.finial(b, cx, cy, z4 + 0.3 + r3 * 1.5, H * 0.045, tc, balls=2, r=0.2)
    elif kind == 'persian':
        U.dome(b, cx, cy, z4, r3 * 1.5, r3 * 2.4, 'bulb', cap_slot, ac if not D['gold'] else cap_col, n=U.nn(b, 12), rings=5 if d == 0 else 3)
        U.finial(b, cx, cy, z4 + r3 * 2.2, H * 0.05, tc, balls=2, r=0.2)
    else:   # pencil
        rise = H - z4 + z0
        cone_h = rise * 0.82
        U.revolve(b, cx, cy, z4, [(r3 * 1.15, 0), (r3 * 1.15, 0.18)], n, 'plain-render', tc, smooth=False, cap=False)
        U.revolve(b, cx, cy, z4 + 0.18, [(r3 * 1.12, 0), (r3 * 0.9, cone_h * 0.5), (r3 * 0.4, cone_h * 0.88), (0, cone_h)], n, cap_slot, cap_col, smooth=True, cap=False)
        U.finial(b, cx, cy, z4 + 0.18 + cone_h - 0.1, rise * 0.14, tc if not D['gold'] else '#d4a82f', balls=1, r=0.2)


def _gallery(b, cx, cy, z, r, hh, col, ws, tc):
    """A minaret balcony: flared corbel, floor, and a parapet ring."""
    d = b.detail
    n = U.nn(b, 12)
    rr = r * 1.7
    if d == 2:
        lib.cylinder(b, cx, cy, z, z + hh, rr, n=n, slot='plain', col=col, top=True)
        return
    lib.cylinder(b, cx, cy, z - 0.55, z, r * 1.02, n=n, slot='plain-render', col=shade(col, 0.88), r_top=rr, top=False, smooth=False)
    lib.cylinder(b, cx, cy, z, z + 0.12, rr, n=n, slot='plain-render', col=shade(col, 0.82), top=True)
    lib.cylinder(b, cx, cy, z + 0.12, z + hh, rr * 0.97, n=n, slot='plain-render', col=tc if d == 0 else col, top=False, smooth=False)
    if d == 0:
        lib.cylinder(b, cx, cy, z + hh, z + hh + 0.1, rr * 1.04, n=n, slot='plain-render', col=shade(tc, 1.1), top=True)


def minaret_spots(D, hx0, hx1, hy0, hy1, bw, court=None):
    """Where the minarets stand: list of (x, y). 1: front corner of the hall; 2: both front corners; 3: + one at the back;
    4: all hall corners; 5-6: + the court's front corners."""
    n = D['nmin']
    r = D['r']
    off = bw * 0.52
    fl, fr = (hx0 - off, hy0 + 0.1), (hx1 + off, hy0 + 0.1)
    bl, br = (hx0 - off, hy1 - 0.2), (hx1 + off, hy1 - 0.2)
    side = fl if r[6] < 0.5 else fr
    if n <= 0:
        return []
    if n == 1:
        return [side]
    if n == 2:
        return [fl, fr]
    if n == 3:
        return [fl, fr, br if r[6] < 0.5 else bl]
    pts = [fl, fr, bl, br]
    if n >= 5 and court:
        cx0, cy0, cx1, cy1 = court
        pts += [(cx0 + 0.5, cy0 + 0.8), (cx1 - 0.5, cy0 + 0.8)]
    return pts[:n]


def minaret_kind(D):
    t = D['type']
    r = D['r']
    return {'ottoman': 'pencil', 'persian': 'persian', 'south': 'chhatri', 'arab': 'square' if r[7] < 0.8 else 'gulf'}.get(
        t, U.pick_w_r(r[7], [('gulf', 0.5), ('pencil', 0.2), ('square', 0.15), ('chhatri', 0.15)]))


# ------------------------------------------------------------------------------------------------------------- courts
def cloister(b, lk, D, x0, y0, x1, y1, ct, ch, gate_x, gate_w, sides=('front', 'left', 'right'), domed=False, srng=None, nbay=None):
    """Arcaded strips round a court (x0..x1, y0..y1 outer): inner faces carry pointed arches, roofs are flat with a parapet (and small
    domes when `domed`). The front strip has a gate bay in the middle."""
    ws, wc = D['wslot'], D['wall']
    pointed = D['pointed']
    bay = nbay or 3.6
    depth = min(1.3, ct * 0.4)
    ix0, ix1, iy0 = x0 + ct, x1 - ct, y0 + ct
    pieces = []
    if 'left' in sides:
        pieces.append(('L', (x0, y0, x0 + ct, y1)))
    if 'right' in sides:
        pieces.append(('R', (x1 - ct, y0, x1, y1)))
    if 'front' in sides:
        if gate_w > 0:
            pieces.append(('F', (x0 + ct, y0, gate_x - gate_w / 2, y0 + ct)))
            pieces.append(('F', (gate_x + gate_w / 2, y0, x1 - ct, y0 + ct)))
        else:
            pieces.append(('F', (x0 + ct, y0, x1 - ct, y0 + ct)))
    roof_z = ch
    for kind, (ax0, ay0, ax1, ay1) in pieces:
        if ax1 - ax0 < 0.5 or ay1 - ay0 < 0.5:
            continue
        if b.detail == 2 or (b.detail == 1 and D['lean'] >= 2):
            bx(b, ax0, ay0, 0, ax1, ay1, ch, ws, wc, skip=('bottom',))
            continue
        if kind == 'L':
            bx(b, ax0, ay0, 0, ax1, ay1, ch, ws, wc, skip=('bottom', 'right', 'top'))
            seg = lib.Seg((ax1, ay0), (ax1, ay1))
        elif kind == 'R':
            bx(b, ax0, ay0, 0, ax1, ay1, ch, ws, wc, skip=('bottom', 'left', 'top'))
            seg = lib.Seg((ax0, ay1), (ax0, ay0))
        else:
            bx(b, ax0, ay0, 0, ax1, ay1, ch, ws, wc, skip=('bottom', 'back', 'top'))
            seg = lib.Seg((ax1, ay1), (ax0, ay1))
        n = max(1, round(seg.length / bay))
        U.arch_openings(b, seg, lk, 0, ch, n, 'pointed' if pointed else 'arch', ow=seg.length / n * 0.6, oh=ch * 0.74, depth=depth, col=wc, slot=ws, sill=0.0, crown_gap=0.5)
        lib.cap(b, [[(ax0, ay0), (ax1, ay0), (ax1, ay1), (ax0, ay1)]], ch, True, 'roof-flat', shade(wc, 0.92), scale=3.5)
        if b.detail == 0:
            fp = lib.fp_rect(ax1 - ax0, ay1 - ay0, (ax0 + ax1) / 2, (ay0 + ay1) / 2)
            lib.parapet(b, fp, ch, 0.55, 0.25, lk, ws, D['trim'])
        if domed and b.detail == 0 and D['lean'] < 2:
            along_x = kind == 'F'
            L = (ax1 - ax0) if along_x else (ay1 - ay0)
            m = max(1, round(L / bay))
            for k in range(m):
                t = (k + 0.5) * L / m
                px, py = ((ax0 + t, (ay0 + ay1) / 2) if along_x else ((ax0 + ax1) / 2, ay0 + t))
                rr = min(ct * 0.36, L / m * 0.4)
                U.dome(b, px, py, ch + 0.05, rr, rr * 0.85, 'hemi', D['slot'], D['dcol'], n=U.nn(b, 12), rings=3 if b.detail == 0 else 2)
    # the back of the court: handled by the hall
    return (ix0, iy0, ix1)


def court_floor(b, lk, D, x0, y0, x1, y1, fountain, kind='octa'):
    if b.detail >= 2:
        return
    col = mix(lk.stone_col, '#ffffff', 0.25)
    b.face([(x0, y0, 0.06), (x1, y0, 0.06), (x1, y1, 0.06), (x0, y1, 0.06)], 'paving', col, scale=4.0)
    if b.detail == 0:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        m = 0.8
        for (a0, b0, a1, b1) in ((x0, y0, x1, y0 + m), (x0, y1 - m, x1, y1), (x0, y0, x0 + m, y1), (x1 - m, y0, x1, y1)):
            b.face([(a0, b0, 0.075), (a1, b0, 0.075), (a1, b1, 0.075), (a0, b1, 0.075)], 'paving', shade(lk.stone_col, 0.8))
        if fountain:
            r = min(x1 - x0, y1 - y0) * 0.11 + 0.8
            pts = U.poly_ring(cx, cy, r, 8, 0.06)
            lib.prism(b, [(p[0], p[1]) for p in pts], 0.06, 0.7, 'plain-render', D['trim'], top=False)
            wp = U.poly_ring(cx, cy, r * 0.82, 8, 0.58)
            b.face(wp, 'plain', '#6fa3b8')
            if D['type'] in ('ottoman', 'persian'):
                kio_r = r * 0.9
                kh = 3.6 + r * 0.5
                for k in range(8):
                    a = U.TAU * k / 8
                    lib.cylinder(b, cx + kio_r * math.cos(a), cy + kio_r * math.sin(a), 0.7, kh, 0.14 + r * 0.02, n=5, slot='plain-render', col=D['trim'], top=False)
                lib.cylinder(b, cx, cy, kh, kh + 0.3, r * 1.12, n=8, slot='plain-render', col=D['trim'], top=True)
                U.dome(b, cx, cy, kh + 0.3, r * 1.1, r * 0.9, 'hemi', D['slot'], D['dcol'], n=10, rings=3)
                U.finial(b, cx, cy, kh + 0.3 + r * 0.88, 1.4, D['trim'], balls=1, r=0.15)
            else:
                lib.cylinder(b, cx, cy, 0.7, 1.4, 0.18, n=6, slot='plain-render', col=D['trim'], r_top=0.1)


# ================================================================================================================ typologies
def build_gulf(b, lk, D, srng):
    """Wide hall + projecting portal/porch + central dome + secondary domes + corner minarets (+ arcaded court)."""
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    court = D['court']
    Wh = W * (0.86 + 0.1 * r[8]) if court else W
    Wh = max(Wh, 12)
    if court:
        Dh = Dp * (0.5 + 0.1 * r[9])
    else:
        Dh = Dp - min(4.5, Dp * 0.2)
    Dh = max(Dh, 10)
    hy1 = Dp / 2
    hy0 = hy1 - Dh
    hx0, hx1 = -Wh / 2, Wh / 2
    pod = 0.9 if D['steps'] else 0.0
    z0 = pod
    kind = U.pick_w_r(r[2], [('hemi', 0.5), ('pointed', 0.22), ('shallow', 0.15), ('onion', 0.13)]) if not D['onion'] else 'onion'
    if D['gold'] and kind == 'shallow':
        kind = 'hemi'
    rc0 = min(Wh, Dh) * (0.27 + 0.13 * r[3])
    if D['nsec'] == 0:
        rc0 *= 1.1
    drum_ratio = 0.3 + 0.25 * r[4]
    Rc, hd, dh, wh = solve_heights(H - pod, rc0, kind, drum_ratio)
    Rc = min(Rc, min(Wh, Dh) * 0.46)
    rows = 2 if wh >= 8.5 and D['storeys'] >= 2 else 1
    # --- podium
    b.section('hall')
    if pod:
        bx(b, hx0 - 1.3, hy0 - 1.6, 0, hx1 + 1.3, hy1 + 0.8, pod, 'paving', lk.stone_col, top_slot='paving', top_col=shade(lk.stone_col, 1.05), skip=('bottom',), scale=6.0)
    rect = (hx0, hy0, hx1, hy1)
    hall_walls(b, lk, D, rect, z0, z0 + wh, rows, side_full=(Wh + Dh < 110))
    if D['mosaic'] or D['relief']:
        frieze(b, lk, D, (hx0, hy0, hx1, hy1), z0 + wh - 1.6, 0.85, relief=D['relief'])
    roof_deck(b, lk, D, rect, z0 + wh, 0.9, D['cren'], D['pinnacles'])
    # --- domes
    b.section('domes')
    cx, cy = 0.0, (hy0 + hy1) / 2 + Dh * 0.05
    ztop = z0 + wh
    zdeck = ztop
    if r[27] < 0.45 and Wh > 24 and Rc > 3:
        pw_ = 2 * Rc + 3.0
        bxc(b, cx, cy, ztop, pw_, pw_, 2.4, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'], skip=('bottom',))
        if b.detail == 0:
            seg = lib.Seg((cx - pw_ / 2, cy - pw_ / 2), (cx + pw_ / 2, cy - pw_ / 2))
            lib.facade(b, seg, ztop + 0.5, ztop + 2.1, 1, lk, 'arched', 0.5, None, 3.0, reduced=True, wall_slot=D['wslot'], wall_col=D['wall'])
        ztop += 2.4
    nwin = 16 if Rc > 4 else 12
    dome_unit(b, lk, D, cx, cy, ztop, Rc, hd, dh, kind, windows=nwin)
    rs = max(1.4, Rc * (0.34 + 0.12 * r[10]))
    rs = min(rs, Rc * 0.62)
    sec = secondary_positions(D['nsec'], 0.0, (hy0 + hy1) / 2, Wh / 2, Dh / 2, rs, Rc)
    sec = sec[:_dome_cap(b, D)]
    for (sx, sy) in sec:
        sk = kind if kind != 'shallow' else 'hemi'
        dome_unit(b, lk, D, sx, sy, zdeck + 0.9, rs, rs * HR.get(sk, 1.0), 0.9 if rs > 1.8 else 0.0, sk, windows=0, finial_h=max(0.6, rs * 0.25), ring=rs > 2.2)
        if b.detail == 0:
            lib.cylinder(b, sx, sy, zdeck, zdeck + 0.9, rs * 1.0, n=12, slot=D['wslot'], col=D['wall'], top=False)
    # --- entrance: portal and/or porch
    b.section('entrance')
    mode = D['porch_mode'] if 'porch_mode' in D else None
    has_porch = D['arcade'] or (not court and r[11] < 0.35)
    has_portal = (D['arches'] or not has_porch or r[12] < 0.5) and Wh > 14
    ph = min(wh * 0.62, 5.6)
    ph = max(ph, 3.4)
    if has_porch:
        pw0 = hx0 if r[13] < 0.6 else hx0 + Wh * 0.15
        pw1 = hx1 if r[13] < 0.6 else hx1 - Wh * 0.15
        porch(b, lk, D, pw0, pw1, hy0, z0, ph, 3.4 if Wh > 30 else 2.6, max(3, round((pw1 - pw0) / 4.2)), D['pointed'])
    if has_portal:
        pw = U.clamp(Wh * (0.22 + 0.1 * r[14]), 5.5, 15)
        pr = wh + 1.2 + 2.2 * r[15]
        pdep = 3.0 if not has_porch else 4.8
        portal(b, lk, D, 0.0, hy0 - (3.4 if has_porch and Wh > 30 else (2.6 if has_porch else 0.0)) + 0.0, z0, pw, pr, pdep, D['pointed'], dome_top=r[16] < 0.4 and not has_porch)
    # steps
    if D['steps']:
        sw = U.clamp(Wh * 0.3, 6, 16)
        U.steps_front(b, -sw / 2, sw / 2, hy0 - (5.8 if has_porch and has_portal else 3.4 if has_portal or has_porch else 0.2), pod, 5, 2.4, lk.stone_col)
    # --- court
    ext = [hx0, hy0, hx1, hy1]
    ctrect = None
    if court:
        b.section('court')
        ct = U.clamp(Wh * 0.06, 3.0, 4.6)
        cx0, cx1 = -W / 2, W / 2
        cy0, cy1 = -Dp / 2, hy0 - 0.2
        ch = min(max(wh * 0.55, 4.2), 5.6)
        gw = U.clamp(Wh * 0.12, 4.0, 8.0)
        cloister(b, lk, D, cx0, cy0, cx1, cy1, ct, ch, 0.0, gw, sides=('front', 'left', 'right'), domed=r[17] < 0.3, nbay=D['bay'])
        # gate house
        gh = ch + 2.6
        bx(b, -gw / 2 - 1.1, cy0, 0, -gw / 2, cy0 + ct, gh, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
        bx(b, gw / 2, cy0, 0, gw / 2 + 1.1, cy0 + ct, gh, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
        bx(b, -gw / 2, cy0, ch + 1.6, gw / 2, cy0 + ct, gh, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
        court_floor(b, lk, D, cx0 + ct, cy0 + ct, cx1 - ct, cy1, D['fountain'])
        ext = [min(ext[0], cx0), cy0, max(ext[2], cx1), ext[3]]
        ctrect = (cx0 + ct, cy0 + ct, cx1 - ct, cy1)
    else:
        ext[1] = hy0 - (3.4 if has_porch else 0) - (3.0 if has_portal else 0)
    # --- minarets
    b.section('minarets')
    mk = minaret_kind(D)
    mh = U.last_metres(D['min_note'], 12, 120)
    hm = mh or (H * 1.5 + 6 if D['nmin'] >= 2 else H * 1.4 + 6)
    hm = U.clamp(hm, H + 4, 95)
    bw = U.clamp(hm * 0.075, 2.2, 5.4)
    spots = minaret_spots(D, hx0, hx1, hy0, hy1, bw, ctrect)
    short = D['nmin'] == 4 and 'two small' in D['min_note'].lower()
    for i, (mx, my) in enumerate(spots):
        hh = hm * (0.62 if short and i < 2 else 1.0)
        minaret(b, lk, D, mx, my, 0.0, hh, mk, bw)
        ext[0], ext[2] = min(ext[0], mx - bw), max(ext[2], mx + bw)
    return tuple(ext), ctrect


def frontispiece(b, lk, D, cx, y, z, w, h, kind, thick=0.5):
    """A raised screen wall above the front parapet (triangular, arched or stepped top)."""
    x0, x1 = cx - w / 2, cx + w / 2
    if kind == 'arch':
        n = 8 if b.detail == 0 else 4
        top = [(cx + math.cos(math.pi * (1 - k / n)) * w / 2, z + h * 0.45 + math.sin(math.pi * (1 - k / n)) * min(w / 2, h * 0.55)) for k in range(n + 1)]
        outline = [(x0, z)] + [(x1, z)] + list(reversed(top))
        outline = [(x0, z), (x1, z)] + top[::-1]
    elif kind == 'stepped':
        outline = [(x0, z), (x1, z), (x1, z + h * 0.35), (cx + w * 0.3, z + h * 0.35), (cx + w * 0.3, z + h * 0.7), (cx + w * 0.12, z + h * 0.7), (cx + w * 0.12, z + h),
                   (cx - w * 0.12, z + h), (cx - w * 0.12, z + h * 0.7), (cx - w * 0.3, z + h * 0.7), (cx - w * 0.3, z + h * 0.35), (x0, z + h * 0.35)]
    else:
        outline = [(x0, z), (x1, z), (x1, z + h * 0.45), (cx, z + h), (x0, z + h * 0.45)]
    ws, wc = D['wslot'], D['wall']
    b.facing([(px, y, pz) for px, pz in outline], (0, -1, 0), ws, wc)
    if b.detail >= 2:
        return
    b.facing([(px, y + thick, pz) for px, pz in outline], (0, 1, 0), ws, wc)
    m = len(outline)
    for k in range(m):
        p, q = outline[k], outline[(k + 1) % m]
        if abs(p[1] - z) < 1e-6 and abs(q[1] - z) < 1e-6:
            continue
        mx, mz = (p[0] + q[0]) / 2 - cx, (p[1] + q[1]) / 2 - (z + h * 0.4)
        b.facing([(p[0], y, p[1]), (q[0], y, q[1]), (q[0], y + thick, q[1]), (p[0], y + thick, p[1])], (mx, 0, mz if abs(q[1] - p[1]) < 1e-6 else mz), ws, D['trim'])
    if b.detail == 0 and kind in ('arch', 'tri', 'stepped'):
        # a dark recessed panel
        pw, ph = w * 0.34, h * 0.42
        b.face([(cx - pw / 2, y - 0.03, z + h * 0.12), (cx + pw / 2, y - 0.03, z + h * 0.12), (cx + pw / 2, y - 0.03, z + h * 0.12 + ph), (cx, y - 0.03, z + h * 0.12 + ph * 1.35),
                (cx - pw / 2, y - 0.03, z + h * 0.12 + ph)], 'glass-punched', '#e8eef2')


def chhatri(b, lk, D, cx, cy, z, r, h, kind='onion', col=None):
    """A small open kiosk: four posts, a slab and a dome (Mughal chhatri)."""
    col = col or D['wall']
    d = b.detail
    if d >= 2 and D['lean'] >= 1:
        return
    if d >= 2:
        U.dome(b, cx, cy, z + h * 0.55, r, r * 0.9, 'hemi', D['slot'], D['dcol'], n=6, rings=2)
        return
    ph = h * 0.55
    if d == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                bxc(b, cx + sx * r * 0.72, cy + sy * r * 0.72, z, r * 0.22, r * 0.22, ph, 'plain-render', col, skip=('bottom', 'top'))
        bxc(b, cx, cy, z + ph, r * 2.0, r * 2.0, 0.22, 'plain-render', D['trim'])
    else:
        bxc(b, cx, cy, z, r * 1.6, r * 1.6, ph + 0.2, 'plain-render', col)
    U.dome(b, cx, cy, z + ph + 0.22, r * 0.95, r * 1.15, kind, D['slot'], D['dcol'], n=U.nn(b, 12), rings=4 if d == 0 else 3)
    if d == 0:
        U.finial(b, cx, cy, z + ph + 0.22 + r * 1.1, r * 0.7, D['trim'], balls=1, r=0.12)


def annex(b, lk, D, side, hx0, hx1, hy0, hy1, wh, z0):
    """A lower wing beside the hall (one side), with its own flat roof and a small dome. Returns its x extent."""
    r = D['r']
    aw = U.clamp((hx1 - hx0) * (0.28 + 0.1 * r[19]), 5.0, 22)
    ad = (hy1 - hy0) * (0.62 + 0.2 * r[20])
    ah = wh * (0.62 + 0.12 * r[21])
    if side < 0:
        ax0, ax1 = hx0 - aw, hx0
    else:
        ax0, ax1 = hx1, hx1 + aw
    ay1 = hy1 - 0.2
    ay0 = ay1 - ad
    rect = (ax0, ay0, ax1, ay1)
    hall_walls(b, lk, D, rect, z0, z0 + ah, 1 if ah < 7.5 else 2, side_full=True)
    roof_deck(b, lk, D, rect, z0 + ah, 0.7, False, False)
    cxa, cya = (ax0 + ax1) / 2, (ay0 + ay1) / 2
    rr = min(aw, ad) * 0.28
    kind = 'hemi' if r[2] < 0.6 else 'pointed'
    dome_unit(b, lk, D, cxa, cya, z0 + ah, rr, rr * HR[kind], rr * 0.3, kind, finial_h=max(0.6, rr * 0.3), ring=rr > 2.2)
    return ax0, ax1, ay0


def build_compact(b, lk, D, srng):
    """Small neighbourhood / urban mosque: a cube-ish hall, one dome on a drum, attached minaret(s), rooflines and porches that vary."""
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    porchd = min(3.2, Dp * 0.18) if (D['arcade'] or D['arches'] or r[11] < 0.5) else 0.0
    wing = (D['ft'].get('dome', {}).get('count', 0) > 0 and r[22] < 0.45 and W >= 20) or D['txt'].count('annex') > 0
    aw_est = U.clamp(W * 0.3, 5, 22) if wing else 0.0
    Wh = W - aw_est * 0.8
    Dh = Dp - porchd
    hy1 = Dp / 2
    hy0 = hy1 - Dh
    wing_side = -1 if r[23] < 0.5 else 1
    hx0, hx1 = -Wh / 2 + (wing_side * -1) * aw_est * 0.4, Wh / 2 + (wing_side * -1) * aw_est * 0.4
    hx0, hx1 = -Wh / 2, Wh / 2
    pod = 0.6 if D['steps'] else 0.0
    kind = U.pick_w_r(r[2], [('hemi', 0.5), ('pointed', 0.2), ('onion', 0.15 if not D['onion'] else 0.9), ('shallow', 0.15)])
    if D['onion']:
        kind = 'onion'
    rc0 = min(Wh, Dh) * (0.27 + 0.12 * r[3])
    clere = r[24] < 0.4 and H >= 9          # raised clerestory block under the dome
    Rc, hd, dh, wh = solve_heights(H - pod - (1.8 if clere else 0.0), rc0, kind, 0.25 + 0.25 * r[4], wh_lo_frac=0.4, wh_min=3.6)
    Rc = min(Rc, min(Wh, Dh) * 0.46 * (0.8 if clere else 1.0))
    rows = 2 if (D['storeys'] >= 2 and wh >= 6.4) else 1
    z0 = pod
    b.section('hall')
    if pod:
        bx(b, hx0 - 1.0, hy0 - porchd - 1.2, 0, hx1 + 1.0, hy1 + 0.5, pod, 'paving', lk.stone_col, skip=('bottom',), scale=4.0)
    rect = (hx0, hy0, hx1, hy1)
    hall_walls(b, lk, D, rect, z0, z0 + wh, rows)
    if D['mosaic'] or D['relief']:
        frieze(b, lk, D, rect, z0 + wh - 1.5, 0.8, relief=D['relief'])
    roof_deck(b, lk, D, rect, z0 + wh, 0.8, D['cren'] or r[25] < 0.18, D['pinnacles'] or r[18] < 0.25)
    cx, cy = 0.0, (hy0 + hy1) / 2
    zr = z0 + wh
    if clere:
        cw = min(Wh, Dh) * 0.62
        bxc(b, cx, cy, zr, cw, cw, 1.8, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
        if b.detail == 0:
            seg = lib.Seg((cx - cw / 2, cy - cw / 2), (cx + cw / 2, cy - cw / 2))
            lib.facade(b, seg, zr + 0.3, zr + 1.6, 1, lk, 'arched', 0.4, None, 3.2, reduced=True, wall_slot=D['wslot'], wall_col=D['wall'])
        zr += 1.8
    b.section('domes')
    dome_unit(b, lk, D, cx, cy, zr, Rc, hd, dh, kind, windows=12 if Rc > 3.2 else 8)
    rs = max(1.2, Rc * 0.38)
    sec = secondary_positions(D['nsec'], 0.0, (hy0 + hy1) / 2, Wh / 2, Dh / 2, rs, Rc)
    for (sx, sy) in sec:
        dome_unit(b, lk, D, sx, sy, z0 + wh, rs, rs * HR.get(kind, 1.0), 0.0, kind, finial_h=max(0.5, rs * 0.3), ring=False)
    # roofline: raised front screen
    if r[26] < 0.4 and Wh > 14:
        fk = ('tri', 'arch', 'stepped')[int(r[27] * 3) % 3]
        frontispiece(b, lk, D, 0.0, hy0 - 0.02, z0 + wh + 0.8, Wh * (0.34 + 0.14 * r[28]), 2.2 + wh * 0.18, fk)
    ext = [hx0, hy0 - porchd, hx1, hy1]
    if wing:
        b.section('annex')
        ax0, ax1, _ = annex(b, lk, D, wing_side, hx0, hx1, hy0, hy1, wh, z0)
        ext[0], ext[2] = min(ext[0], ax0), max(ext[2], ax1)
    if porchd > 0:
        b.section('entrance')
        ph = min(wh * 0.7, 4.6)
        n = max(2, round(Wh * 0.7 / 3.6))
        pw = Wh if r[13] < 0.5 else Wh * 0.6
        porch(b, lk, D, -pw / 2, pw / 2, hy0, z0, ph, porchd, n, D['pointed'])
        if r[29] < 0.4 and b.detail == 0:
            m = max(2, round(pw / 4.0))
            for k in range(m):
                px = -pw / 2 + (k + 0.5) * pw / m
                U.dome(b, px, hy0 - porchd / 2, z0 + ph + 0.1, min(porchd, pw / m) * 0.36, porchd * 0.32, 'hemi', D['slot'], D['dcol'], n=10, rings=3)
        if r[12] < 0.5 and Wh > 14:
            portal(b, lk, D, 0.0, hy0 - porchd, z0, U.clamp(Wh * 0.26, 4.6, 8), ph + 1.8, 1.0, D['pointed'], False)
    if D['steps']:
        sw = U.clamp(Wh * 0.4, 3, 9)
        U.steps_front(b, -sw / 2, sw / 2, hy0 - porchd, pod, 3, 1.5, lk.stone_col)
    b.section('minarets')
    mk = minaret_kind(D)
    mh = U.last_metres(D['min_note'], 8, 120)
    hm = mh or (H * 1.45 + 4)
    hm = U.clamp(hm, H + 3.5, 70)
    bw = U.clamp(hm * 0.1, 1.9, 4.2)
    spots = minaret_spots(D, hx0, hx1, hy0 - porchd * 0.0, hy1, bw)
    for (mx, my) in spots:
        minaret(b, lk, D, mx, my, 0.0, hm, mk, bw)
        ext[0], ext[2] = min(ext[0], mx - bw), max(ext[2], mx + bw)
    return tuple(ext), None


def build_ottoman(b, lk, D, srng):
    """Square hall under a great pointed dome, four semi-domes, corner domes, domed cloister round a fountain court."""
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    court = D['court']
    Dh_avail = Dp * (0.62 if court else 0.92)
    a = min(W * 0.96, Dh_avail) / 4.0               # half the core square = main dome radius
    kind = 'pointed' if r[2] < 0.7 else 'hemi'
    drum_ratio = 0.62
    hr = HR[kind]
    # heights: wh + dh + hd = H; semi-domes sit against the drum
    for _ in range(3):
        dh, hd = a * drum_ratio, a * hr
        wh = H - dh - hd
        lo = max(4.5, 0.3 * H)
        if wh >= lo:
            break
        a = (H - lo) / (drum_ratio + hr)
    a = max(a, 2.2)
    dh, hd = a * drum_ratio, a * hr
    wh = max(H - dh - hd, 3.5)
    S = 4 * a
    hy1 = Dp / 2
    hy0 = hy1 - S
    cy = (hy0 + hy1) / 2
    b.section('hall')
    rect = (-S / 2, hy0, S / 2, hy1)
    rows = 2 if wh >= 9 else 1
    hall_walls(b, lk, D, rect, 0, wh, rows, side_full=True, bay=max(4.6, D['bay']))
    lib.cap(b, [[(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])]], wh, True, 'roof-flat', shade(D['dcol'], 0.9), scale=2.0)
    if b.detail == 0:
        fp = lib.fp_rect(S, S, 0, cy)
        lib.parapet(b, fp, wh, 0.6, 0.28, lk, D['wslot'], D['trim'])
    b.section('domes')
    top = dome_unit(b, lk, D, 0.0, cy, wh, a, hd, dh, kind, windows=20 if a > 5 else 14, n=U.nn(b, 28))
    # four semi-domes: centre at the sides of the core square, radius a, hugging the drum
    hs = a * 0.78
    for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ang = math.atan2(dy, dx)
        scx, scy = dx * a, cy + dy * a
        prof = [(a * math.cos(t * math.pi / 2), hs * math.sin(t * math.pi / 2)) for t in [j / (6 if b.detail == 0 else 3) for j in range(7 if b.detail == 0 else 4)]]
        U.revolve(b, scx, scy, wh, prof, U.nn(b, 14), D['slot'], D['dcol'], smooth=True, scale=1.5, cap=False, a0=ang - math.pi / 2, a1=ang + math.pi / 2)
    # corner domes on short drums
    cr = a * 0.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = sx * (S / 2 - cr * 1.0 - 0.3), cy + sy * (S / 2 - cr * 1.0 - 0.3)
            if b.detail == 0:
                lib.cylinder(b, px, py, wh, wh + cr * 0.45, cr * 1.0, n=14, slot=D['wslot'], col=D['wall'], top=False)
            U.dome(b, px, py, wh + (cr * 0.45 if b.detail == 0 else cr * 0.2), cr, cr * 0.9, 'hemi', D['slot'], D['dcol'], n=U.nn(b, 14), rings=4 if b.detail == 0 else 2)
            U.finial(b, px, py, wh + (cr * 0.45 if b.detail == 0 else cr * 0.2) + cr * 0.88, cr * 0.5, D['trim'], balls=1, r=0.2)
    ext = [-S / 2, hy0, S / 2, hy1]
    ctrect = None
    # minarets at the hall corners (pencil), more at the court front
    b.section('minarets')
    mh = U.last_metres(D['min_note'], 15, 120)
    hm = U.clamp(mh or (H * 1.65 + 6), H + 8, 95)
    bw = U.clamp(hm * 0.07, 2.4, 5.0)
    spots = minaret_spots(D, -S / 2, S / 2, hy0 + S * 0.0, hy1, bw, None)
    if court:
        b.section('court')
        ct = U.clamp(S * 0.15, 3.4, 5.0)
        ch = U.clamp(wh * 0.5, 4.2, 5.8)
        cx0, cx1 = -max(W / 2, S / 2 + 6), max(W / 2, S / 2 + 6)
        cy0, cy1 = -Dp / 2, hy0 - 0.2
        gw = U.clamp(S * 0.22, 4.0, 8.0)
        cloister(b, lk, D, cx0, cy0, cx1, cy1, ct, ch, 0.0, gw, sides=('front', 'left', 'right'), domed=True, srng=srng, nbay=D['bay'])
        gh = ch + 3.2
        for sx in (-1, 1):
            xa = sx * gw / 2
            bx(b, min(xa, xa + sx * 1.2), cy0, 0, max(xa, xa + sx * 1.2), cy0 + ct, gh, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
        bx(b, -gw / 2, cy0, ch + 1.4, gw / 2, cy0 + ct, gh, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
        court_floor(b, lk, D, cx0 + ct, cy0 + ct, cx1 - ct, cy1, True)
        ext = [min(ext[0], cx0), cy0, max(ext[2], cx1), ext[3]]
        ctrect = (cx0 + ct, cy0 + ct, cx1 - ct, cy1)
        if D['nmin'] >= 5:
            spots = minaret_spots(D, -S / 2, S / 2, hy0, hy1, bw, ctrect)
    b.section('minarets')
    for (mx, my) in spots:
        minaret(b, lk, D, mx, my, 0.0, hm, 'pencil', bw)
        ext[0], ext[2] = min(ext[0], mx - bw), max(ext[2], mx + bw)
    return tuple(ext), ctrect


def court_block(b, lk, D, W, Dp, hy0, wh, Wh, domed, gate_w, iwans=False):
    """Arcaded court from the front fence line to the hall; returns (ext x0, y0, x1, court rect)."""
    ct = U.clamp(Wh * 0.06, 3.0, 4.8)
    ch = U.clamp(wh * 0.55, 4.2, 5.8)
    cx0, cx1 = -W / 2, W / 2
    cy0, cy1 = -Dp / 2, hy0 - 0.2
    cloister(b, lk, D, cx0, cy0, cx1, cy1, ct, ch, 0.0, gate_w, sides=('front', 'left', 'right'), domed=domed, nbay=D['bay'])
    gh = ch + 2.8
    for sx in (-1, 1):
        xa = sx * gate_w / 2
        bx(b, min(xa, xa + sx * 1.2), cy0, 0, max(xa, xa + sx * 1.2), cy0 + ct, gh, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
    bx(b, -gate_w / 2, cy0, ch + 1.5, gate_w / 2, cy0 + ct, gh, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'])
    court_floor(b, lk, D, cx0 + ct, cy0 + ct, cx1 - ct, cy1, D['fountain'])
    if iwans:
        # a tall iwan in the middle of each side arcade
        ym = (cy0 + ct + cy1) / 2
        for sx in (-1, 1):
            xs = sx * (W / 2 - ct)
            bx(b, min(xs, xs - sx * 1.6), ym - 3.4, 0, max(xs, xs - sx * 1.6), ym + 3.4, ch + 3.2, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'], skip=('bottom',)) if False else None
    return (cx0, cy0, cx1), (cx0 + ct, cy0 + ct, cx1 - ct, cy1)


def build_arab(b, lk, D, srng):
    """Traditional Arab / North African: low hypostyle hall (tiled naves or flat roof with a mid dome), mihrab bump at the back, arcaded
    sahn with a fountain, one tall square minaret."""
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    court = D['court']
    Wh = W * (0.88 + 0.08 * r[8]) if court else W
    Dh = Dp * (0.5 + 0.1 * r[9]) if court else Dp - 3.0
    hy1 = Dp / 2 - 1.8
    hy0 = hy1 - Dh
    hx0, hx1 = -Wh / 2, Wh / 2
    tiled = D['F_roof'] in ('gable', 'hip', 'pyramidal') or U.has_word(D['txt'], 'maghreb', 'morocc', 'tunis', 'alger', 'andalus', 'cordob', 'kairouan', 'tile')
    wh = U.clamp(H * (0.58 if tiled else 0.7), 4.5, 16)
    z0 = 0.0
    rows = 2 if wh >= 9 else 1
    b.section('hall')
    rect = (hx0, hy0, hx1, hy1)
    hall_walls(b, lk, D, rect, z0, z0 + wh, rows, side_full=(Wh + Dh < 100))
    if D['mosaic'] or D['relief']:
        frieze(b, lk, D, rect, z0 + wh - 1.5, 0.8, relief=D['relief'])
    b.section('roof')
    cx, cy = 0.0, (hy0 + hy1) / 2
    dkind = 'hemi' if r[2] < 0.6 else 'pointed'
    if tiled:
        nn_ = max(2, int(round(Wh / 7.0)))
        rise = (H - wh) * 0.7 + 1.0
        fp = lib.fp_rect(Wh, Dh, 0, cy)
        lib.sweep(b, fp, z0 + wh - 0.4, [(0, 0), (0.4, 0), (0.4, 0.5), (0, 0.5)], D['wslot'], D['trim']) if b.detail == 0 else None
        for k in range(nn_):
            xa = hx0 + Wh * k / nn_
            xb = hx0 + Wh * (k + 1) / nn_
            U.gable_y(b, xa + 0.05, hy0 - 0.4, xb - 0.05, hy1 + 0.2, z0 + wh, rise, 'clay-tile' if D['slot'] != 'metal-roof' else D['slot'], D['dcol'], D['wslot'], D['wall'],
                      scale=3.0 if b.detail == 0 else 6.0)
        # a dome over the mihrab bay at the back centre
        rr = min(Wh / nn_ * 0.55, 4.0)
        top = dome_unit(b, lk, D, cx, hy1 - rr - 0.6, z0 + wh + rise * 0.6, rr, rr * 1.0, rr * 0.5, dkind, windows=8, ring=True)
        top_h = H
    else:
        roof_deck(b, lk, D, rect, z0 + wh, 0.9, True, D['pinnacles'])
        rc0 = min(Wh, Dh) * (0.16 + 0.08 * r[3])
        Rc, hd, dh, _ = solve_heights(max(H - wh, 4.0), rc0, dkind, 0.35, wh_lo_frac=0.0, wh_min=0.0)
        Rc = min(Rc, min(Wh, Dh) * 0.3)
        dome_unit(b, lk, D, cx, cy, z0 + wh, Rc, Rc * HR[dkind], Rc * 0.35, dkind, windows=12)
        rs = Rc * 0.5
        for (sx, sy) in secondary_positions(min(D['nsec'], 4), 0.0, cy, Wh / 2, Dh / 2, rs, Rc)[:6 if b.detail == 2 else 12]:
            dome_unit(b, lk, D, sx, sy, z0 + wh, rs, rs * HR[dkind], 0.0, dkind, ring=False, finial_h=0.6)
    # mihrab projection on the back wall
    b.section('mihrab')
    mw = U.clamp(Wh * 0.12, 3.0, 7.0)
    bx(b, -mw / 2, hy1, 0, mw / 2, hy1 + 1.8, wh * 0.9, D['wslot'], D['wall'], skip=('bottom', 'front'), top_slot='roof-flat', top_col=D['trim'])
    if b.detail < 2:
        U.dome(b, 0.0, hy1 + 0.9, wh * 0.9, mw * 0.4, mw * 0.4, 'hemi', D['slot'], D['dcol'], n=U.nn(b, 10), rings=3)
    ext = [hx0, hy0, hx1, hy1 + 1.8]
    ctrect = None
    if court:
        b.section('court')
        (ex0, ey0, ex1), ctrect = court_block(b, lk, D, W, Dp, hy0, wh, Wh, False, U.clamp(Wh * 0.1, 3.6, 6.0))
        ext = [min(ext[0], ex0), ey0, max(ext[2], ex1), ext[3]]
    else:
        # porch arcade
        porch(b, lk, D, hx0, hx1, hy0, z0, min(wh * 0.7, 4.8), 3.0, max(3, round(Wh / 4.0)), D['pointed'])
        ext[1] = hy0 - 3.0
    b.section('minarets')
    mh = U.last_metres(D['min_note'], 12, 100)
    hm = U.clamp(mh or (H * 1.7 + 8), H + 6, 80)
    mk = 'square' if r[7] < 0.85 else 'gulf'
    bw = U.clamp(hm * (0.17 if mk == 'square' else 0.1), 3.0, 8.0)
    # the minaret stands in the court corner against the hall front (Kairouan) or at the hall corner
    if court and D['nmin'] == 1:
        sgn = -1 if r[6] < 0.5 else 1
        spots = [(sgn * (Wh / 2 - bw * 0.7), hy0 - bw * 0.55)]
    else:
        spots = minaret_spots(D, hx0, hx1, hy0, hy1, bw, ctrect)
    for (mx, my) in spots:
        minaret(b, lk, D, mx, my, 0.0, hm, mk, bw)
        ext[0], ext[2] = min(ext[0], mx - bw), max(ext[2], mx + bw)
    return tuple(ext), ctrect


def build_south(b, lk, D, srng):
    """Mughal / South Asian: broad hall with a tall pishtaq portal, three onion domes, corner chhatris, chhatri minarets."""
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    court = D['court'] or W >= 50
    Wh = W * (0.92 if court else 1.0)
    Dh = Dp * (0.42 if court else 0.85)
    hy1 = Dp / 2
    hy0 = hy1 - Dh
    hx0, hx1 = -Wh / 2, Wh / 2
    wh = U.clamp(H * 0.52, 5.0, 16)
    pod = 1.2
    z0 = pod
    D['onion'] = True
    rows = 2 if wh >= 9 else 1
    b.section('hall')
    bx(b, hx0 - 1.0, hy0 - 4.0, 0, hx1 + 1.0, hy1 + 0.5, pod, 'paving', lk.stone_col, skip=('bottom',), scale=6.0)
    rect = (hx0, hy0, hx1, hy1)
    hall_walls(b, lk, D, rect, z0, z0 + wh, rows, side_full=(Wh + Dh < 100))
    frieze(b, lk, D, rect, z0 + wh - 1.4, 0.7, col=D['accent'], relief=D['relief'])
    roof_deck(b, lk, D, rect, z0 + wh, 1.1, D['cren'], False)
    b.section('domes')
    cy = (hy0 + hy1) / 2
    Rc = U.clamp(min(Wh * 0.14, Dh * 0.3), 2.2, 16)
    hd = Rc * 1.3
    dh = Rc * 0.55
    dome_unit(b, lk, D, 0.0, cy, z0 + wh, Rc, hd, dh, 'onion', windows=0, n=None, ring=True)
    rs = Rc * 0.62
    for sx in (-1, 1):
        px = sx * (Rc + rs + 1.2)
        if abs(px) < Wh / 2 - rs:
            dome_unit(b, lk, D, px, cy, z0 + wh, rs, rs * 1.3, rs * 0.55, 'onion', ring=True)
    # chhatris on the four corners of the roof and over the portal
    for sx in (-1, 1):
        for sy in (-1, 1):
            chhatri(b, lk, D, sx * (Wh / 2 - 1.6), cy + sy * (Dh / 2 - 1.6), z0 + wh + 1.1, 1.3, 3.6)
    b.section('entrance')
    pw = U.clamp(Wh * 0.26, 6, 16)
    ph = wh * 1.28
    portal(b, lk, D, 0.0, hy0, z0, pw, ph, 1.4, True, False)
    for sx in (-1, 1):
        if b.detail < 2:
            chhatri(b, lk, D, sx * (pw / 2 - 0.9), hy0 - 0.7, z0 + ph + 0.4, 0.9, 3.0)
    if D['steps'] or True:
        U.steps_front(b, -pw / 2, pw / 2, hy0 - 1.4, pod, 6, 3.0, lk.stone_col)
    ext = [hx0, hy0 - 1.4, hx1, hy1]
    ctrect = None
    if court:
        b.section('court')
        (ex0, ey0, ex1), ctrect = court_block(b, lk, D, W, Dp, hy0, wh * 0.9, Wh, False, U.clamp(Wh * 0.1, 4.0, 7.0))
        ext = [min(ext[0], ex0), ey0, max(ext[2], ex1), ext[3]]
    b.section('minarets')
    mh = U.last_metres(D['min_note'], 15, 100)
    hm = U.clamp(mh or (H * 1.45 + 8), H + 6, 85)
    bw = U.clamp(hm * 0.07, 2.2, 4.4)
    n = max(D['nmin'], 2)
    D['nmin'] = n
    spots = minaret_spots(D, hx0, hx1, hy0, hy1, bw, ctrect)
    for (mx, my) in spots:
        minaret(b, lk, D, mx, my, 0.0, hm, 'chhatri', bw)
        ext[0], ext[2] = min(ext[0], mx - bw), max(ext[2], mx + bw)
    return tuple(ext), ctrect


def build_persian(b, lk, D, srng):
    """Persian: great iwan portal carrying two small minarets, a tall-drummed turquoise bulbous dome behind it, arcaded court."""
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    court = D['court']
    Wh = W * (0.7 if court else 0.95)
    Dh = Dp * (0.46 if court else 0.85)
    hy1 = Dp / 2
    hy0 = hy1 - Dh
    hx0, hx1 = -Wh / 2, Wh / 2
    wh = U.clamp(H * 0.42, 5.0, 16)
    z0 = 0.0
    if not U.greenish(D['dcol']) and not (lib.rgb(D['dcol'])[2] > lib.rgb(D['dcol'])[0]):
        D['dcol'] = '#2f9aa8'
    D['slot'] = 'roof-flat'
    b.section('hall')
    rect = (hx0, hy0, hx1, hy1)
    hall_walls(b, lk, D, rect, z0, z0 + wh, 2 if wh >= 9 else 1, side_full=(Wh + Dh < 100))
    frieze(b, lk, D, rect, z0 + wh - 1.3, 0.8, col=D['accent'], relief=D['relief'])
    roof_deck(b, lk, D, rect, z0 + wh, 0.9, False, False)
    b.section('domes')
    cy = hy1 - Dh * 0.38
    Rc = U.clamp(min(Wh, Dh) * 0.24, 2.4, 14)
    dh = Rc * 1.1
    hd = Rc * 1.3
    if wh + dh + hd < H:
        dh += (H - wh - dh - hd)
    dome_unit(b, lk, D, 0.0, cy, z0 + wh, Rc, hd, dh, 'bulb', windows=16 if Rc > 4 else 8, flute=(16, 0.012), drum_col=D['accent'])
    b.section('entrance')
    pw = U.clamp(Wh * 0.34, 7, 18)
    ph = wh * 1.75
    portal(b, lk, D, 0.0, hy0, z0, pw, ph, 2.0, True, False)
    mh = U.last_metres(D['min_note'], 12, 90)
    hm = U.clamp((mh or H * 0.9) * 0.55, 6, 40)
    bw = min(2.2, pw * 0.12)
    topz = z0 + ph + (0.4 if b.detail == 0 else 0)
    for sx in (-1, 1):
        minaret(b, lk, D, sx * (pw / 2 - bw * 0.7), hy0 - 1.6, topz, hm, 'persian', bw)
    ext = [hx0, hy0 - 2.0, hx1, hy1]
    ctrect = None
    if court:
        b.section('court')
        (ex0, ey0, ex1), ctrect = court_block(b, lk, D, W, Dp, hy0, wh, Wh, False, U.clamp(Wh * 0.14, 4.0, 7.0))
        ext = [min(ext[0], ex0), ey0, max(ext[2], ex1), ext[3]]
    return tuple(ext), ctrect


# ================================================================================================================ build
def build(brief, style, rng, detail):
    limit = {0: 18500, 1: 3700, 2: 470}[detail]
    state = rng.getstate()
    for lean in range(0, 6):
        rng.setstate(state)
        b = lib.Builder('mosque', detail)
        lk = lib.look(brief, style, rng)
        D = design(brief, style, rng, lk)
        D['lean'] = lean
        D['bay'] *= 1.0 + 0.35 * lean
        srng = U.sub(rng)
        fn = {'gulf': build_gulf, 'compact': build_compact, 'ottoman': build_ottoman, 'arab': build_arab, 'south': build_south,
              'persian': build_persian}.get(D['type'], build_gulf)
        ext, ctrect = fn(b, lk, D, srng)
        _site(b, lk, D, srng, ext, brief)
        if b.tris <= limit:
            break
    return b.objects()


def _site(b, lk, D, srng, ext, brief):
    b.section('site')
    x0, y0, x1, y1 = ext
    m = D['marg']
    fx0, fy0, fx1, fy1 = x0 - m, y0 - m, x1 + m, y1 + m
    fc = (brief.get('setting') or {}).get('forecourt') or 'plaza'
    front = 16.0 if fc == 'road' else 12.0
    pad = (fx0 - 6, fy0 - front, fx1 + 6, fy1 + 6)
    lib.ground(b, *pad, lk, scale=5.0)
    if D['fence']:
        U.compound_wall(b, lk, fx0, fy0, fx1, fy1, shade(D['wall'], 0.96), h=2.1, t=0.35, gate=0.0, gate_w=5.0 if D['type'] != 'compact' else 3.6)
    if D['lean'] >= 2 and fc == 'parking':
        fc = 'plaza'
    U.front_apron(b, lk, srng, fc, pad[0] + 1, pad[2] - 1, fy0 - 0.3, pad[1], lk.tree)
    n = max(2, 6 + int(srng.random() * 3) - 2 * D['lean'])
    U.trees_ring(b, lk, srng, lk.tree, (fx0, fy0, fx1, fy1), pad, n, h=7.5, avoid=[])
