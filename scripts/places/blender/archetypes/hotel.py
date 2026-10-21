"""hotel: hotels and resorts. Typologies chosen from the brief (storeys, footprint, style, wording):

  tower     tall slab on a podium (porte-cochere, ballroom block with roof terrace and pool, balcony bands, rooftop sign boxes, helipad)
  block     mid-rise block (3-8 storeys), balcony pods, glazed lobby, porte-cochere, pool terrace behind
  resort    low wings round a courtyard pool: hip roofs (tile or thatch), thatched bar pavilion, chalets, palms
  colonial  verandah hotel: two-level colonnaded gallery, hip roof, shuttered windows, portico and steps

Layout: front (entrance, drive) towards -Y; pool terrace and gardens behind or in the courtyard.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _office_tower_util as U  # noqa: E402

FEATURES = {'podium', 'crown', 'mast', 'helipad', 'atrium-glass', 'balcony-bands', 'brise-soleil', 'louvres', 'pilotis', 'colonnade',
            'arcade', 'portico', 'flat-canopy', 'curved-canopy', 'car-park', 'flags', 'signage-board', 'courtyard', 'pavilion',
            'umbrellas', 'fountain', 'terrace', 'roof-terrace', 'water-tank', 'solar-panels', 'fence-wall', 'gate', 'steps', 'statue',
            'awning', 'neon-strip', 'kiosk', 'dome', 'bell-tower', 'clock-tower', 'pier', 'sheds', 'stalls', 'relief-pattern', 'arches', 'chimney'}


def has(t, *w):
    return any(x in t for x in w)


def plan(brief, style, lk, S):
    form = U.form_of(brief)
    feats = U.feat(brief)
    txt = U.text(brief)
    sty = U.style_of(brief)
    yr = U.year_of(brief, 2000)
    storeys = int(U.clamp(U.fnum(form.get('storeys'), 4), 1, 40))
    W = U.clamp(U.fnum(form.get('width_m'), 40), 12, 100)
    D = U.clamp(U.fnum(form.get('depth_m'), 20), 10, 60)
    H = U.clamp(U.fnum(form.get('height_m'), storeys * 3.4 + 0.5), 4, 110)
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    if storeys >= 9 or H >= 32:
        typ = 'tower'
    elif sty in ('colonial', 'georgian', 'victorian', 'neoclassical', 'tudor') or yr < 1955 or 'colonial' in txt or 'verandah' in txt or 'veranda' in txt:
        typ = 'colonial' if storeys <= 4 else 'block'
    elif has(txt, 'resort', 'lodge', 'chalet', 'bungalow', 'beach', 'golf') or (fpk in ('U', 'ring') and storeys <= 3) or 'thatch' in txt:
        typ = 'resort'
    else:
        typ = 'block'
    return {'typ': typ, 'W': W, 'D': D, 'H': H, 'storeys': storeys, 'fpk': fpk, 'roof': roof, 'feats': feats, 'txt': txt, 'sty': sty, 'yr': yr,
            'setting': brief.get('setting') or {}}


def acc_of(lk):
    a = lk.accent_col
    return lib.mix(lk.wall_col, '#7a5a3a', 0.5) if a == lib.shade(lk.wall_col, 0.8) else a


def wkind(lk, P, front=True):
    k = lk.windows
    if k in ('none', None):
        return 'punched'
    if k in ('screen', 'louvre'):
        return 'ribbon'
    if k == 'pointed-arch':
        return 'arched'
    if 'arches' in P['feats'] and k in ('punched',):
        return 'arched'
    return k


def skin_walls(b, lk, P, fp, z0, z1, floors, kind, S, bay=3.6, **kw):
    ratio = U.clamp(lk.ratio, 0.3, 0.6)
    for seg in fp.edges():
        U.skin(b, seg, z0, z1, floors, kind, lk, ratio=ratio, ws=lk.wall_slot, wc=lk.wall_col, gc=lk.glass_col, group=2, bay=bay,
               reduced=seg.rear and b.detail == 0, **kw)


def walls_any(b, lk, P, fp, z1, floors, S, kind, front_kind=None, ground_kind=None, ground_h=None, band=None, bay=None):
    """Cut windows (lib.walls) for small buildings, cheap skin for big ones."""
    per = sum(s.length for s in fp.edges())
    n_win = per / 3.6 * floors
    if n_win > (150 if b.detail == 0 else 90):
        for seg in fp.edges():
            k = front_kind if seg.front and front_kind else kind
            U.skin(b, seg, 0, z1, floors, k if k not in ('arched', 'pointed-arch') else 'punched', lk, ratio=U.clamp(lk.ratio, 0.3, 0.6), ws=lk.wall_slot, wc=lk.wall_col, gc=lk.glass_col, group=2 if n_win < 250 else 3,
                   bay=3.6, reduced=seg.rear and b.detail == 0)
            if seg.front and ground_kind and b.detail < 2:
                pass
        return
    lib.walls(b, fp, 0, z1, floors, lk, S.get('walls'), kind=kind, ratio=U.clamp(lk.ratio, 0.3, 0.6), front_kind=front_kind or kind, ground_kind=ground_kind, ground_h=ground_h,
              plinth=0.35, band=band, bay=bay)


def main_rect(fp):
    return max(fp.rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))


def roof_over(b, lk, P, fp, z, S, force=None):
    roof = force or P['roof']
    if roof in ('hip', 'gable', 'pyramidal', 'mansard', 'multi-dome'):
        lib.roof(b, 'gable' if roof == 'gable' else 'hip', fp, z, lk, pitch=22, ov=0.9 if b.detail < 2 else 0.4)
        return True
    lib.flat_roof(b, fp, z, lk, parapet_h=1.0 if b.detail < 2 else 0.5, ov=0.0, slab=0.0)
    return False


def porte_cochere(b, lk, P, cx, y_front, w, d=7.5, h=4.6):
    if b.detail >= 2:
        return
    acc = acc_of(lk)
    lib.canopy_flat(b, cx - w / 2, y_front - d, cx + w / 2, y_front, h, lk, th=0.6, columns=[(cx - w / 2 + 0.6, y_front - d + 0.6), (cx + w / 2 - 0.6, y_front - d + 0.6),
                                                                                       (cx, y_front - d + 0.6)] if w > 12 else [(cx - w / 2 + 0.6, y_front - d + 0.6), (cx + w / 2 - 0.6, y_front - d + 0.6)],
                    col=lk.roof_col, edge_col=acc, r=0.3)
    with b.site():
        if b.detail == 0:
            b.face([(cx - w / 2 - 3, y_front - d - 5, 0.06), (cx + w / 2 + 3, y_front - d - 5, 0.06), (cx + w / 2 + 3, y_front, 0.06), (cx - w / 2 - 3, y_front, 0.06)], 'asphalt', '#55575a')
    if b.detail == 0:
        lib.steps(b, cx - 3.5, cx + 3.5, y_front - 0.1, 0.45, 1.0, 2)


def roof_signs(b, lk, P, fp_rect, z, feats):
    if 'signage-board' not in feats or b.detail >= 2:
        return
    x0, y0, x1, y1 = fp_rect
    cx = (x0 + x1) / 2
    acc = acc_of(lk)
    w = U.clamp((x1 - x0) * 0.35, 6, 14)
    U.sign_box(b, cx, y0 + 0.6, z + 0.6, w, 2.2, acc)
    if b.detail == 0:
        U.box_c(b, cx, y0 + 0.9, z, w - 1, 0.5, 0.7, 'plain', '#55595d', skip=('bottom',))


def roof_clutter(b, lk, P, rect, z, S, solar=True):
    if b.detail >= 1:
        return
    x0, y0, x1, y1 = rect
    w, d = x1 - x0, y1 - y0
    rs = S.get('clutter')
    U.plant_box(b, lk, x0 + w * rs.uniform(0.3, 0.7), y1 - d * 0.28, z, U.clamp(w * 0.15, 2.5, 6), U.clamp(d * 0.2, 2, 5), 2.8, lib.shade(lk.metal_col, 0.95))
    if 'water-tank' in P['feats']:
        U.water_tank(b, x0 + w * 0.2, y1 - d * 0.25, z, 1.4, 2.2)
    if 'solar-panels' in P['feats'] and solar:
        for r in range(2):
            yy = y0 + d * (0.4 + 0.2 * r)
            pts = [(x0 + w * 0.55, yy - 0.8, z + 0.3), (x1 - 2, yy - 0.8, z + 0.3), (x1 - 2, yy + 0.8, z + 1.1), (x0 + w * 0.55, yy + 0.8, z + 1.1)]
            b.facing(pts, (0, -0.5, 1), 'glass-ribbon', '#8fa3b5', mode='tile')


# --------------------------------------------------------------------------------------------------------------------- tower hotel
def build_tower(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    fh = H / st
    tw = U.clamp(W * 0.8, 20, 60)
    td = U.clamp(D, 14, 30)
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'T', 'H', 'U') else 'rect'
    fp = lib.footprint(fpk, tw, td, S.get('fp'), b.detail)
    acc = acc_of(lk)
    pz = fh * 2 + 1.5
    pw = U.clamp(tw + 20, tw + 12, 82)
    pdf = U.clamp(td * 0.55, 10, 18)
    bb = fp.bbox
    px0, px1 = -pw / 2, pw / 2
    py0, py1 = bb[1] - pdf, bb[3] + 3.0
    b.section('podium')
    pfp = lib.fp_rect(pw, py1 - py0, 0, (py0 + py1) / 2)
    for seg in pfp.edges():
        red = seg.rear and b.detail == 0
        U.skin(b, seg, 0, min(5.0, pz * 0.6), 1, 'curtain', lk, gc=lk.glass_col, group=1, reduced=red)
        U.skin(b, seg, min(5.0, pz * 0.6), pz, 1, 'ribbon', lk, ratio=0.5, ws=lk.wall_slot, wc=lib.mix(lk.wall_col, lk.trim_col, 0.4), group=2, reduced=red)
    lib.flat_roof(b, pfp, pz, lk, parapet_h=1.0, ov=0.0, slab=0.0)
    if 'colonnade' in feats and b.detail < 2:
        pass
    # pool terrace on the podium roof (roof-terrace / courtyard)
    if b.detail < 2 and ('roof-terrace' in feats or 'courtyard' in feats or 'umbrellas' in feats or 'terrace' in feats):
        qx0, qx1 = bb[0] - 2, px1 - 4
        U_pool_roof(b, lk, bb, pz, S, pw, py0)
    b.section('shaft')
    kind = wkind(lk, P)
    floors = max(1, st - 2)
    kw = {}
    if lk.wall_material == 'glass-curtain' and kind in ('ribbon', 'punched'):
        pass
    for seg in fp.edges():
        red = seg.rear and b.detail == 0
        kk = kind
        if 'balcony-bands' in feats or kind == 'ribbon':
            band = (0.35, lk.trim_col, 0.9) if ('balcony-bands' in feats and seg.front) else None
        else:
            band = None
        U.skin(b, seg, pz, H, floors, kk, lk, ratio=U.clamp(lk.ratio, 0.3, 0.6), ws=lk.wall_slot, wc=lk.wall_col, gc=lk.glass_col, group=2, bay=3.6,
               reduced=red, bands=band, fins=2.8 if ('brise-soleil' in feats and seg.front and kk in ('curtain', 'ribbon')) else 0.0, fin_col=lk.trim_col, deep=0.9 if (band and kk == 'ribbon') else False)
        if 'balcony-bands' in feats and seg.front and kind == 'punched':
            U.balcony_pods(b, seg, pz, floors, (H - pz) / floors, every=2, col=lk.trim_col)
    # parapet + crown features
    b.section('roof')
    rect = (bb[0], bb[1], bb[2], bb[3])
    zt = H
    if P['roof'] in ('hip', 'pyramidal', 'mansard'):
        lib.roof(b, 'hip', fp, H, lk, pitch=26, ov=0.8)
    else:
        lib.flat_roof(b, fp, H, lk, parapet_h=1.0 if b.detail < 2 else 0.5, ov=0.0, slab=0.0)
        if 'crown' in feats and b.detail < 2:
            cw, cd = (bb[2] - bb[0]) * 0.55, (bb[3] - bb[1]) * 0.5
            cfp = lib.fp_rect(cw, cd, (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)
            for seg in cfp.edges():
                U.skin(b, seg, H, H + fh * 1.8, 2, 'curtain', lk, group=1)
            lib.roof_profile(b, (cfp.bbox[0], cfp.bbox[1], cfp.bbox[2], cfp.bbox[3]), H + fh * 1.8, [(-0.4, -0.1), (0, 0), (cw * 0.2, cw * 0.12)], lk, roof_slot='metal-roof', roof_col=lk.trim_col)
            zt = H + fh * 1.8 + cw * 0.12
        else:
            roof_clutter(b, lk, P, rect, H, S)
    roof_signs(b, lk, P, rect, H if 'crown' not in feats else H, feats)
    if 'helipad' in feats:
        hr = U.clamp(min(bb[2] - bb[0], bb[3] - bb[1]) * 0.28, 4.5, 7.5)
        U.helipad(b, bb[2] - hr - 1.0, (bb[1] + bb[3]) / 2, H + 0.2, hr)
    if 'mast' in feats:
        U.mast(b, bb[0] + 3.0, (bb[1] + bb[3]) / 2, zt, 11.0)
    b.section('entrance')
    ew = U.clamp(pw * 0.3, 12, 22)
    porte_cochere(b, lk, P, 0.0, py0, ew)
    info = {'bx0': px0, 'bx1': px1, 'yf': py0 - 7.5, 'yb': py1}
    return fp, info


def U_pool_roof(b, lk, bb, pz, S, pw, py0):
    # a pool deck on the podium roof in front of the tower
    x0, x1 = -pw / 2 + 5, pw / 2 - 5
    y1_ = bb[1] - 1.6
    y0_ = py0 + 3.0
    if y1_ - y0_ < 5:
        return
    with b.site():
        pass
    if b.detail < 2:
        b.face([(x0 + 4, y0_, pz + 0.05), (x1 - 4, y0_, pz + 0.05), (x1 - 4, y1_, pz + 0.05), (x0 + 4, y1_, pz + 0.05)][::-1], 'paving', '#cbc6bb')
        pw_ = min(14.0, (x1 - x0) * 0.35)
        cxp = (x0 + x1) / 2
        b.face([(cxp - pw_ / 2, y0_ + 1.6, pz + 0.1), (cxp + pw_ / 2, y0_ + 1.6, pz + 0.1), (cxp + pw_ / 2, y1_ - 1.6, pz + 0.1), (cxp - pw_ / 2, y1_ - 1.6, pz + 0.1)], 'plain', '#3fa7c7', mode='fit')


# --------------------------------------------------------------------------------------------------------------------- block hotel
def build_block(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'U', 'H', 'T', 'irregular') else 'rect'
    fp = lib.footprint(fpk, W, D, S.get('fp'), b.detail)
    acc = acc_of(lk)
    kind = wkind(lk, P)
    gh = min(4.8, H * 0.35) if st > 1 else None
    band = (0.3, lk.trim_col) if 'balcony-bands' in feats and st > 1 else None
    fk = kind
    gk = 'curtain' if ('atrium-glass' in feats or lk.wall_material == 'glass-curtain') and st > 1 else None
    walls_any(b, lk, P, fp, H, st, S, kind, front_kind=fk, ground_kind=gk, ground_h=gh, band=band)
    hipped = roof_over(b, lk, P, fp, H, S)
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    cx = (x0 + x1) / 2
    b.section('details')
    if 'balcony-bands' in feats and b.detail == 0:
        for seg in fp.edges():
            if seg.front and seg.length > 6 and st > 1:
                U.balcony_pods(b, seg, 0, st, H / st, every=2, col=lk.trim_col)
    if 'brise-soleil' in feats and b.detail == 0:
        for seg in fp.edges():
            if seg.front and seg.length > 8:
                n = int(seg.length / 2.2)
                for k in range(n + 1):
                    u = k * seg.length / n
                    U.sbox(b, seg, u - 0.08, u + 0.08, 1.0, H - 0.2, 0.45, lib.mix(lk.trim_col, lk.wall_col, 0.3), skip_ends=True)
    front_y = y0
    if 'portico' in feats and b.detail < 2:
        lib.portico(b, cx, y0, 0.8, U.clamp((x1 - x0) * 0.3, 7, 14), 4.5, max(3.5, min(H * 0.8, 8.0)), lk, cols=4, pediment=True, steps_n=3)
        front_y = y0 - 5.0
    else:
        cw = U.clamp((x1 - x0) * 0.32, 9, 20)
        porte_cochere(b, lk, P, cx, y0, cw)
        front_y = y0 - 7.5
    if 'atrium-glass' in feats and b.detail < 2:
        gw = U.clamp((x1 - x0) * 0.26, 7, 14)
        gfp = lib.fp_rect(gw, 3.0, cx, y0 - 1.5)
        for seg in gfp.edges():
            if not seg.rear:
                U.skin(b, seg, 0, min(H, 9.0), 2, 'curtain', lk, group=1)
        pts = [(cx - gw / 2, y0 - 3.0, min(H, 9.0)), (cx + gw / 2, y0 - 3.0, min(H, 9.0)), (cx + gw / 2, y0, min(H, 9.0) + 1.5), (cx - gw / 2, y0, min(H, 9.0) + 1.5)]
        b.facing(pts, (0, -0.3, 1), 'glass-ribbon', lk.glass_col, mode='tile')
    if ('roof-terrace' in feats) and not hipped and b.detail < 2:
        U.roof_terrace(b, lk, lib.fp_rect(x1 - x0 - 1.0, y1 - y0 - 1.0, cx, (y0 + y1) / 2), H + 0.2, S)
    if not hipped:
        roof_clutter(b, lk, P, (x0, y0, x1, y1), H, S)
        roof_signs(b, lk, P, (x0, y0, x1, y1), H, feats)
    elif 'signage-board' in feats and b.detail < 2:
        U.sign_box(b, cx, y0 + 0.3, H + 1.0, 7.0, 1.6, acc)
    # pool terrace behind or beside
    bbx = fp.bbox
    py_back = bbx[3]
    if b.detail < 2 and ('courtyard' in feats or 'umbrellas' in feats or 'terrace' in feats):
        pw_ = U.clamp((x1 - x0) * 0.3, 8, 16)
        U.pool(b, cx - pw_ / 2, py_back + 4, cx + pw_ / 2, py_back + 4 + 6, S, umbrellas=3)
        py_back += 14
    info = {'bx0': bbx[0], 'bx1': bbx[2], 'yf': front_y, 'yb': py_back + 2}
    return fp, info


# --------------------------------------------------------------------------------------------------------------------- resort
def build_resort(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    W = U.clamp(W, 36, 100)
    D = U.clamp(D, 28, 60)
    arm_w = U.clamp(W * 0.2, 11, 15)
    base_d = U.clamp(D * 0.38, 12, 16)
    arm_d = U.clamp(D - base_d, 14, 40)
    fp = lib.fp_U(W, base_d, arm_w, arm_d, 'front')
    st = int(U.clamp(st, 1, 3))
    Hs = U.clamp(H, 4.0, 11.0)
    kind = wkind(lk, P)
    if kind == 'curtain':
        kind = 'punched'
    thatch = has(P['txt'], 'thatch', 'palapa') or lk.roof_slot == 'timber'
    walls_any(b, lk, P, fp, Hs, st, S, kind, front_kind=kind, band=(0.25, lk.trim_col) if st > 1 else None)
    # main roof: hips (tile) over the U footprint
    roof_form = P['roof'] if P['roof'] in ('hip', 'gable') else 'hip'
    if P['roof'] == 'flat':
        lib.flat_roof(b, fp, Hs, lk, parapet_h=0.9, ov=0.3, slab=0.0)
    else:
        lib.roof(b, roof_form, fp, Hs, lk, pitch=24, ov=1.2 if b.detail < 2 else 0.5)
    bb = fp.bbox
    cx = 0.0
    b.section('details')
    # arcade/colonnade on the courtyard side of the base block
    yb_front = bb[1] + arm_d
    if ('colonnade' in feats or 'arcade' in feats) and b.detail < 2:
        n = max(3, int((W - 2 * arm_w) / 3.2))
        U.veranda(b, lk, bb[0] + arm_w + 0.5, bb[2] - arm_w - 0.5, yb_front, min(3.4, Hs * 0.5 + 0.8), 2.8, n, kind='arch' if 'arcade' in feats else 'round')
    # lobby porte-cochere in the middle of the base block's rear? entrance at the courtyard end
    # courtyard pool + pavilion + palms
    b.section('courtyard')
    cx0, cx1 = bb[0] + arm_w, bb[2] - arm_w
    cy0, cy1 = bb[1], yb_front
    if b.detail < 2:
        # paved courtyard floor
        with b.site():
            b.face([(cx0 + 0.3, cy0, 0.07), (cx1 - 0.3, cy0, 0.07), (cx1 - 0.3, cy1 - 3.4 if ('colonnade' in feats or 'arcade' in feats) else cy1, 0.07), (cx0 + 0.3, cy1 - 3.4 if ('colonnade' in feats or 'arcade' in feats) else cy1, 0.07)], 'paving', '#d9d4c8', scale=1.0) if b.detail == 0 else None
        pwid = U.clamp((cx1 - cx0) * 0.5, 6, 16)
        plen = U.clamp((cy1 - cy0) * 0.5, 7, 18)
        pcy = cy0 + (cy1 - cy0) * 0.45
        U.pool(b, cx - pwid / 2, pcy - plen / 2, cx + pwid / 2, pcy + plen / 2, S, umbrellas=4)
        if 'pavilion' in feats or thatch or True:
            U.thatched_pavilion(b, lk, cx0 + 4.5, cy0 + 4.0, 3.2, thatch=thatch)
        if lk.tree not in (None, 'none'):
            for k, (tx, ty) in enumerate(((cx0 + 2.0, cy1 - 6.0), (cx1 - 2.0, cy1 - 6.0), (cx1 - 2.5, cy0 + 4.0), (cx0 + 2.0, pcy))):
                if b.detail == 1 and k % 2:
                    continue
                lib.tree(b, 'palm' if lk.tree in ('palm', 'broadleaf') else lk.tree, tx, ty, S.get('rt%d' % k).uniform(6.5, 9.5), S.get('rtt%d' % k), lk)
    # chalets
    b.section('chalets')
    nch = 3 if P['W'] < 60 else 5
    if b.detail < 2:
        ry = bb[3] + 8.0
        for k in range(nch):
            x = bb[0] + 6 + (bb[2] - bb[0] - 12) * (k + 0.5) / nch
            if b.detail == 1 and k % 2:
                continue
            U.chalet(b, lk, x, ry + S.get('ch%d' % k).uniform(-1, 1), yaw=0.0, thatch=thatch, wall_col=lib.jitter(lk.wall_col, S.get('chc%d' % k), 0.05))
    # entrance: porte-cochere on the base block rear is awkward; put a flat canopy at the arm tips
    if 'flat-canopy' in feats or 'portico' in feats:
        pass
    info = {'bx0': bb[0], 'bx1': bb[2], 'yf': bb[1], 'yb': bb[3] + (13.0 if b.detail < 2 else 0.0)}
    return fp, info


# --------------------------------------------------------------------------------------------------------------------- colonial
def build_colonial(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    st = int(U.clamp(st, 1, 4))
    W = U.clamp(W, 18, 80)
    D = U.clamp(D, 10, 24)
    wing = 'L' if P['fpk'] in ('L', 'U', 'H') else 'rect'
    fp = lib.footprint('L' if wing == 'L' else 'rect', W, D, S.get('fp'), b.detail)
    kind = 'punched' if lk.windows not in ('arched',) else 'arched'
    Hs = U.clamp(H, 5.0, 16.0)
    lib.walls(b, fp, 0, Hs, st, lk, S.get('walls'), kind=kind, ratio=0.4, front_kind=kind, plinth=0.5, band=(0.22, lk.trim_col) if st > 1 else None, bay=3.2)
    roof = 'hip' if P['roof'] in ('hip', 'flat', 'pyramidal', 'mansard') else P['roof']
    lib.roof(b, roof, fp, Hs, lk, pitch=24, ov=1.4 if b.detail < 2 else 0.5)
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    cx = (x0 + x1) / 2
    b.section('galleries')
    n = max(4, int((x1 - x0) / 3.0))
    gh = Hs / st
    if b.detail < 2:
        # two-level front gallery
        U.gallery(b, lk, x0 + 1.0, x1 - 1.0, y0, 2.6, 0.3, gh, n, rail=True, slab=st > 1)
        if st > 1:
            U.gallery(b, lk, x0 + 1.0, x1 - 1.0, y0, 2.6, gh, Hs - 0.35, n, rail=False, slab=False)
            U.box(b, x0 + 0.9, y0 - 2.7, Hs - 0.5, x1 - 0.9, y0 - 2.5, Hs - 0.1, 'plain-render', lib.shade(lk.trim_col, 0.95), skip=())
    if 'portico' in feats and b.detail < 2:
        lib.portico(b, cx, y0 - 2.6, 0.5, U.clamp((x1 - x0) * 0.25, 6, 11), 3.0, max(3.5, Hs * 0.8), lk, cols=4, pediment=True, steps_n=3)
    if ('clock-tower' in feats or 'bell-tower' in feats) and b.detail < 2:
        tw_ = 4.0
        lib.tower(b, cx, (y0 + y1) / 2, Hs - 0.3, tw_, tw_, 5.0, lk, storeys=1, windows='punched', cap='hip', cap_rise=3.0, ratio=0.5)
    if 'steps' in feats and b.detail == 0 and 'portico' not in feats:
        lib.steps(b, cx - 2.5, cx + 2.5, y0 - 2.6, 0.5, 1.4, 3)
    if 'roof-terrace' in feats or 'water-tank' in feats:
        U.water_tank(b, x1 - 4.0, y1 - 3.0, Hs + 1.0 if False else 0.0, 1.3, 2.2) if b.detail < 2 and 'water-tank' in feats else None
    info = {'bx0': fp.bbox[0], 'bx1': fp.bbox[2], 'yf': y0 - 3.0, 'yb': fp.bbox[3] + 2.0}
    if 'courtyard' in feats or 'umbrellas' in feats or 'terrace' in feats:
        pw_ = U.clamp((x1 - x0) * 0.25, 6, 12)
        U.pool(b, cx - pw_ / 2, fp.bbox[3] + 4, cx + pw_ / 2, fp.bbox[3] + 10, S, umbrellas=2)
        info['yb'] = fp.bbox[3] + 13
    return fp, info


def build(brief, style, rng, detail):
    b = lib.Builder('hotel', detail)
    S = U.Streams(rng)
    brief = U.sane(brief)
    style = style if isinstance(style, dict) else {}
    lk = lib.look(brief, style, S.get('look'))
    P = plan(brief, style, lk, S)
    typ = P['typ']
    fn = {'tower': build_tower, 'block': build_block, 'resort': build_resort, 'colonial': build_colonial}[typ]
    fp, info = fn(b, lk, P, S)
    feats = P['feats']
    flags = 3 if 'flags' in feats else 0
    sign = (6.5, 2.2, acc_of(lk)) if ('signage-board' in feats and typ in ('resort', 'colonial')) else None
    fore = 26.0 if typ in ('tower', 'block') else 18.0
    if typ == 'resort':
        fore = 20.0
    U.plot_site(b, lk, S, feats, P['setting'], info['bx0'], info['bx1'], info['yf'], info['yb'], fore=fore, flags=flags, sign=sign,
                trees=6, side=12.0, fence_default=False)
    return b.objects()
