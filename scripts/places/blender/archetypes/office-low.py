"""office-low: low and mid-rise offices. Typologies chosen from the brief:

  branch       bank / microfinance branch: glazed banking hall, brand-colour panel and cap band, canopy or awning, ATM booth, roof sign
  block        agency / ministry / secretariat block: projecting entrance bay, portico or verandah, ribbon or punched windows, flags
  secretariat  wide H / U / L multi-wing state block with a taller core, stair towers, brise-soleil fins
  studio       small studio / hub / workshop: shopfront awning, painted mural, roof terrace, mast, shed roof

The style changes the architecture: colonial (verandah arcade, hip roof), Hausa-Arewa / Sahelian (arched openings, relief band, corner
pinnacles, crenellated parapet), modernist (ribbon windows, slab edges, brise-soleil), contemporary (curtain glazing, composite panels).
Layout: front (-Y) towards the street, building centred on x = 0.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _office_tower_util as U  # noqa: E402

FEATURES = {'signage-board', 'awning', 'car-park', 'flat-canopy', 'fence-wall', 'gate', 'flags', 'water-tank', 'portico', 'colonnade',
            'arcade', 'balcony-bands', 'brise-soleil', 'louvres', 'relief-pattern', 'painted-mural', 'roof-terrace', 'steps', 'mast',
            'atrium-glass', 'solar-panels', 'crenellation', 'pinnacles', 'kiosk', 'curved-canopy', 'courtyard', 'neon-strip', 'terrace'}


def has(txt, *w):
    return any(x in txt for x in w)


def plan(brief, style, lk, S):
    form = U.form_of(brief)
    feats = U.feat(brief)
    txt = U.text(brief)
    sty = U.style_of(brief)
    storeys = int(U.clamp(U.fnum(form.get('storeys'), 2), 1, 8))
    W = U.clamp(U.fnum(form.get('width_m'), 24), 8, 100)
    D = U.clamp(U.fnum(form.get('depth_m'), 16), 7, 50)
    H = U.clamp(U.fnum(form.get('height_m'), storeys * 3.6 + 0.5), 3.4, 36)
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    bank = has(txt, 'bank', 'microfinance', 'savings', 'branch', 'atm')
    if bank and W <= 40 and storeys <= 5:
        typ = 'branch'
    elif fpk in ('H', 'U') or (W >= 58 and storeys >= 3) or 'secretariat' in txt and W >= 40:
        typ = 'secretariat'
    elif has(txt, 'studio', 'hub', 'workshop', 'creative', 'training', 'film', 'design') and W <= 30 or (W <= 18 and storeys <= 2 and not bank):
        typ = 'studio'
    else:
        typ = 'block'
    if sty in ('hausa-arewa', 'sahelian', 'arab-islamic') or lk.windows in ('arched', 'pointed-arch') and sty in ('vernacular', 'hausa-arewa'):
        dress = 'arewa'
    elif sty in ('colonial', 'georgian', 'victorian', 'neoclassical', 'tudor'):
        dress = 'colonial'
    elif sty in ('modernist', 'brutalist', 'international', 'soviet'):
        dress = 'modernist'
    elif sty in ('contemporary', 'postmodern', 'high-tech'):
        dress = 'contemporary'
    else:
        dress = 'vernacular'
    return {'typ': typ, 'dress': dress, 'W': W, 'D': D, 'H': H, 'storeys': storeys, 'fpk': fpk, 'roof': roof, 'feats': feats, 'txt': txt,
            'setting': brief.get('setting') or {}, 'sty': sty}


def window_kind(lk, P, front=True):
    k = lk.windows
    if P['dress'] == 'arewa':
        return 'arched'
    if k in ('none', None):
        return 'punched' if P['dress'] in ('colonial', 'vernacular') else 'ribbon'
    if k in ('screen', 'louvre'):
        return 'ribbon' if not front else 'screen'
    if k == 'pointed-arch':
        return 'arched'
    return k


def accent_of(lk, P):
    a = lk.accent_col
    if a == lib.shade(lk.wall_col, 0.8):
        a = lib.mix(lk.wall_col, '#2f4f6f', 0.5)
    return a


def roof_for(b, lk, P, fp, H, S):
    """Roof over the whole footprint; returns the eave/parapet top height."""
    roof = P['roof']
    if roof in ('hip', 'gable', 'pyramidal', 'mansard'):
        pitch = 20 if P['dress'] != 'colonial' else 24
        lib.roof(b, 'hip' if roof in ('pyramidal', 'mansard') else roof, fp, H, lk, pitch=pitch, ov=0.9 if b.detail < 2 else 0.4)
        return H
    if roof in ('shed',):
        w, d = fp.size
        rise = min(d * 0.18, 2.4)
        lib.roof(b, 'shed', fp.rects[0], H, lk, rise=rise, ov=0.5, high='back')
        return H
    if roof == 'sawtooth' or roof == 'barrel':
        pass
    lib.flat_roof(b, fp, H, lk, parapet_h=1.0 if b.detail < 2 else 0.5, ov=0.0, slab=0.0)
    return H


def build_walls(b, lk, P, fp, S, H, storeys, front_kind=None, kind=None, ground_kind=None, ground_h=None, band=None, bay=None, ratio=None):
    kind = kind or window_kind(lk, P, False)
    front_kind = front_kind or window_kind(lk, P, True)
    U.walls_b(b, lk, fp, 0, H, storeys, S.get('walls'), kind=kind, ratio=ratio if ratio is not None else max(0.3, lk.ratio), front_kind=front_kind,
              ground_kind=ground_kind, ground_h=ground_h, plinth=0.35, band=band, bay=bay)


def main_rect(fp):
    return max(fp.rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))


def entrance_bay(b, lk, P, fp, S, H, storeys, ew, depth, kind, up=0.0):
    mr = main_rect(fp)
    cx = (mr[0] + mr[2]) / 2
    yf = mr[1]
    efp = lib.fp_rect(ew, depth, cx, yf - depth / 2 + 0.02)
    hh = H + up
    es = max(1, storeys)
    sc = [s for s in efp.edges() if not s.rear]
    lib.walls(b, efp, 0, hh, es, lk, S.get('ewalls'), kind=kind, ratio=max(0.4, lk.ratio), front_kind=kind, plinth=0.3, edges=sc, bay=ew / 2.2,
              wall_col=lk.wall_col)
    return efp, cx, yf


def build_branch(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    fp = lib.footprint(P['fpk'] if P['fpk'] in ('rect', 'L') else 'rect', W, D, S.get('fp'), b.detail)
    acc = accent_of(lk, P)
    glazed = lk.windows in ('curtain', 'ribbon', 'screen', 'none') or lk.wall_material == 'glass-curtain'
    gh = None
    if st > 1:
        gh = min(4.6, H * 0.4)
    wk = window_kind(lk, P, True)
    if wk == 'arched' and P['dress'] != 'arewa':
        wk = 'punched'
    build_walls(b, lk, P, fp, S, H, st, front_kind=wk, kind='ribbon' if wk == 'curtain' else wk, ground_kind='curtain' if (glazed or P['dress'] == 'contemporary') and P['dress'] != 'arewa' else None,
                ground_h=gh, band=(0.25, lk.trim_col) if st > 1 else None)
    roof_for(b, lk, P, fp, H, S)
    b.section('branding')
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    front = [s for s in fp.edges() if s.front]
    side = -1 if S.get('layout').random() < 0.5 else 1
    if b.detail < 2 and front:
        seg = max(front, key=lambda s: s.length)
        # brand panel: vertical band at one end and a cap band along the parapet
        L = seg.length
        pw = min(3.4, L * 0.16)
        ua, ub = (0.2, 0.2 + pw) if side < 0 else (L - 0.2 - pw, L - 0.2)
        if b.detail == 0:
            U.sbox(b, seg, ua, ub, 0.0, H + 0.6, 0.38, acc)
            U.sbox(b, seg, 0.0, L, H - 0.1, H + 0.35, 0.22, acc, skip_ends=True)
        else:
            U.sbox(b, seg, ua, ub, 0.0, H + 0.6, 0.3, acc)
    # entrance: canopy / awning / porch
    ecx = (x0 + x1) / 2 + (-side) * W * 0.1
    cw = U.clamp(W * 0.42, 6, 16)
    zc = gh - 0.2 if gh else H - 0.4
    zc = min(zc, 4.3)
    if 'flat-canopy' in feats or 'curved-canopy' in feats or ('awning' not in feats):
        lib.canopy_flat(b, ecx - cw / 2, y0 - 4.2, ecx + cw / 2, y0, zc, lk, th=0.55, columns=2, col=lk.roof_col, edge_col=acc, r=0.2)
        if b.detail == 0:
            lib.steps(b, ecx - cw / 2 + 1.0, ecx + cw / 2 - 1.0, y0 - 3.8, 0.3, 0.8, 2)
    if 'awning' in feats:
        U.awning(b, x0 + 1.0, x1 - 1.0 if W < 22 else x0 + W * 0.6, y0, 3.5 if not gh else min(3.5, gh - 0.6), 1.8, (lk.trim_col, acc))
    # ATM booth beside the entrance
    if W >= 14:
        U.booth(b, ecx + side * (cw / 2 + 2.6) if abs(ecx + side * (cw / 2 + 2.6)) < x1 - 1.5 else x1 - 1.6, y0 - 1.6, 2.4, 2.0, 2.7, lib.mix(acc, '#ffffff', 0.2), sign_col=acc)
    b.section('roof')
    if 'signage-board' in feats and b.detail < 2:
        U.sign_box(b, (x0 + x1) / 2 - side * W * 0.18, y0 + 0.5, H + 0.4 if P['roof'] == 'flat' else H + 2.4, U.clamp(W * 0.3, 4, 9), 1.4, acc)
    roof_clutter(b, lk, P, fp, H, S)
    # generator house + water tank at the back
    if b.detail == 0:
        gx = x1 - 2.0
        U.box_c(b, gx, y1 + 3.2, 0, 3.2, 2.4, 2.4, 'plain-render', lib.shade(lk.wall_col, 0.9), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
        with b.site():
            pass
    info = {'bx0': x0, 'bx1': x1, 'yf': y0 - (4.2 if 'flat-canopy' in feats else 0), 'yb': y1 + 5.5}
    return fp, info


def roof_clutter(b, lk, P, fp, z, S):
    if b.detail >= 1 or P['roof'] in ('hip', 'gable', 'pyramidal', 'shed', 'mansard'):
        return
    x0, y0, x1, y1 = main_rect(fp)
    rs = S.get('clutter')
    w, d = x1 - x0, y1 - y0
    if w < 8:
        return
    U.plant_box(b, lk, x0 + w * rs.uniform(0.3, 0.7), y1 - d * 0.28, z, min(4, w * 0.18), min(3, d * 0.2), 2.2, lib.shade(lk.metal_col, 0.95))
    if 'water-tank' in P['feats']:
        U.water_tank(b, x0 + w * 0.2, y1 - d * 0.25, z, 1.3, 2.0)
    if 'solar-panels' in P['feats']:
        for r in range(2):
            yy = y0 + d * (0.35 + 0.2 * r)
            pts = [(x0 + w * 0.5, yy - 0.8, z + 0.3), (x1 - 2, yy - 0.8, z + 0.3), (x1 - 2, yy + 0.8, z + 1.1), (x0 + w * 0.5, yy + 0.8, z + 1.1)]
            b.facing(pts, (0, -0.5, 1), 'glass-ribbon', '#8fa3b5', mode='tile')
    if 'mast' in P['feats']:
        U.mast(b, x0 + w * 0.8, y1 - d * 0.3, z, 9.0, 0.16, banded=False)


def build_block(b, lk, P, S, secretariat=False):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    dress = P['dress']
    fpk = P['fpk']
    if secretariat and fpk == 'rect':
        fpk = 'H' if W >= 56 else 'U'
    fp = lib.footprint(fpk if fpk in ('rect', 'L', 'U', 'H', 'T', 'irregular') else 'rect', W, D, S.get('fp'), b.detail)
    acc = accent_of(lk, P)
    gk = None
    gh = None
    if 'arcade' in feats and st >= 1 and dress != 'contemporary':
        gk = 'arched'
    ratio = lk.ratio
    band = None
    if 'balcony-bands' in feats:
        band = (0.35, lk.trim_col)
    kind = window_kind(lk, P, False)
    fk = window_kind(lk, P, True)
    if 'louvres' in feats and kind == 'ribbon':
        fk = 'louvre'
    build_walls(b, lk, P, fp, S, H, st, front_kind=fk, kind=kind, ground_kind=gk, ground_h=gh, band=band, ratio=ratio)
    zt = roof_for(b, lk, P, fp, H, S)
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    cx = (x0 + x1) / 2
    b.section('details')
    if dress == 'modernist' and b.detail == 0 and st >= 2:
        for seg in fp.edges():
            if seg.front:
                for s_ in range(1, st):
                    U.sbox(b, seg, 0, seg.length, H * s_ / st - 0.16, H * s_ / st + 0.16, 0.22, lk.trim_col, skip_ends=True)
    if ('brise-soleil' in feats or dress == 'modernist' and secretariat) and b.detail == 0:
        for seg in fp.edges():
            if seg.front and seg.length > 6:
                n = int(seg.length / 2.4)
                for k in range(n + 1):
                    u = k * seg.length / n
                    U.sbox(b, seg, u - 0.1, u + 0.1, 0.4, H - 0.1, 0.5, lib.mix(lk.trim_col, lk.wall_col, 0.3), skip_ends=True)
    ew = U.clamp((x1 - x0) * 0.2, 5.5, 12.0)
    pre_front = y0
    if W >= 20 and typ_has_entrance(P):
        if 'portico' in feats:
            lib.portico(b, cx, y0, 0.9, ew * 1.5, 4.2, max(3.2, H * (0.78 if st > 1 else 0.85)), lk, cols=4 if ew < 9 else 6, pediment=dress in ('colonial', 'arewa') or P['roof'] in ('hip', 'gable'), steps_n=3)
            pre_front = y0 - 4.6
        else:
            kind_e = 'curtain' if dress in ('contemporary', 'modernist') else ('arched' if dress == 'arewa' else 'punched')
            up = 1.2 if P['roof'] == 'flat' else 0.0
            efp, ecx, yf = entrance_bay(b, lk, P, fp, S, H, st, ew, 3.0, kind_e, up=up)
            if P['roof'] == 'flat':
                lib.flat_roof(b, efp, H + up, lk, parapet_h=0.6, ov=0.0, slab=0.0)
            else:
                lib.roof(b, 'gable' if P['roof'] == 'gable' else 'hip', efp, H + up, lk, pitch=26, ov=0.5, axis='x') if P['roof'] == 'gable' else lib.roof(b, 'hip', efp, H + up, lk, pitch=26, ov=0.5)
            pre_front = yf - 3.0
            if 'flat-canopy' in feats and b.detail < 2:
                lib.canopy_flat(b, cx - ew / 2 - 1.5, yf - 6.4, cx + ew / 2 + 1.5, yf - 3.0, 3.6, lk, th=0.45, columns=2, col=lk.roof_col, edge_col=acc, r=0.2)
                pre_front = yf - 6.4
    elif 'flat-canopy' in feats:
        lib.canopy_flat(b, cx - 4, y0 - 4.0, cx + 4, y0, 3.8, lk, th=0.5, columns=2, col=lk.roof_col, edge_col=acc, r=0.2)
        pre_front = y0 - 4.0
    if ('colonnade' in feats or (dress == 'colonial' and st <= 2 and 'portico' not in feats)) and b.detail < 2:
        n = max(3, int((x1 - x0) / 3.2))
        U.veranda(b, lk, x0 + 1.0, x1 - 1.0, y0, min(3.6, H * 0.5 + 1.0), 2.8, n, kind='arch' if 'arcade' in feats else 'round')
        pre_front = min(pre_front, y0 - 3.1)
    if 'steps' in feats and b.detail == 0 and 'portico' not in feats:
        lib.steps(b, cx - 2.5, cx + 2.5, pre_front, 0.6, 1.4, 3)
        pre_front -= 1.4
    # dress: Hausa-Arewa relief + pinnacles + crenellated parapet; roof terrace; mural
    if dress == 'arewa' or 'relief-pattern' in feats or 'pinnacles' in feats:
        for seg in fp.edges():
            if seg.front:
                relief_h = 0.9
                U.relief_band(b, seg, H - 1.1 if P['roof'] == 'flat' else H - 1.4, H - 0.2 if P['roof'] == 'flat' else H - 0.4, lib.shade(lk.wall_col, 0.75) if dress == 'arewa' else acc)
        if (dress == 'arewa' or 'pinnacles' in feats) and P['roof'] == 'flat':
            for sx in (x0 + 0.2, x1 - 0.2):
                U.pinnacle(b, lk, sx, y0 + 0.2, H, 2.6, 0.65)
    if 'crenellation' in feats and P['roof'] == 'flat':
        U.crenellate(b, lk, fp, H + 0.9, skip_rear=True)
    if 'roof-terrace' in feats and P['roof'] == 'flat':
        U.roof_terrace(b, lk, lib.fp_rect(x1 - x0 - 1.0, y1 - y0 - 1.0, cx, (y0 + y1) / 2), H + 0.2, S)
    if secretariat and b.detail < 2:
        # taller central core and stair towers at the ends of the wings
        core = lib.fp_rect(U.clamp((x1 - x0) * 0.16, 6, 14), U.clamp((y1 - y0) * 0.6, 6, 16), cx, (y0 + y1) / 2)
        add = P['H'] / st
        lib.walls(b, core, H, H + add, 1, lk, S.get('core'), kind='ribbon', ratio=0.5, plinth=0, rear='same')
        lib.flat_roof(b, core, H + add, lk, parapet_h=0.5, ov=0.4, slab=0.3)
        for rx in (fp.bbox[0] + 2.4, fp.bbox[2] - 2.4):
            U.box_c(b, rx, fp.bbox[1] + 0.2, 0, 3.0, 2.0, H + 1.2, lk.wall_slot, lib.shade(lk.wall_col, 0.88), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    roof_clutter(b, lk, P, fp, H, S)
    if 'water-tank' in feats and b.detail == 0 and P['roof'] in ('hip', 'gable'):
        U.water_tank(b, x1 + 3.0, y1 - 3.0, 0.0, 1.4, 2.6)
    info = {'bx0': fp.bbox[0], 'bx1': fp.bbox[2], 'yf': pre_front, 'yb': fp.bbox[3] + 1.5}
    return fp, info


def typ_has_entrance(P):
    return True


def build_studio(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    acc = accent_of(lk, P)
    fp = lib.footprint(P['fpk'] if P['fpk'] in ('rect', 'L') else 'rect', W, D, S.get('fp'), b.detail)
    gk = 'curtain' if lk.windows in ('curtain', 'ribbon') or has(P['txt'], 'shopfront', 'shop') or 'awning' in feats else None
    gh = min(3.6, H * 0.55) if (st > 1 and gk) else None
    kind = window_kind(lk, P, False)
    fk = window_kind(lk, P, True)
    build_walls(b, lk, P, fp, S, H, st, front_kind=fk, kind=kind, ground_kind=gk, ground_h=gh, band=(0.3, lk.trim_col) if st > 1 else None)
    roof_for(b, lk, P, fp, H, S)
    x0, y0, x1, y1 = main_rect(fp)
    cx = (x0 + x1) / 2
    front = [s for s in fp.edges() if s.front]
    b.section('details')
    if 'painted-mural' in feats and front and b.detail < 2:
        seg = max(front, key=lambda s: s.length)
        rs = S.get('mural')
        pal = ['#d9553a', '#e8b23a', '#2f7d6b', '#3a6ea5', '#f1ece0', '#8a4f9e']
        zt = H - 0.5
        zb = (gh or H * 0.45) + 0.3
        n = 4
        if b.detail == 0:
            L = seg.length
            for k in range(n):
                ua, ub = L * (0.08 + 0.2 * k), L * (0.08 + 0.2 * k + rs.uniform(0.12, 0.2))
                za, zc_ = zb + rs.uniform(0, 0.5), zt - rs.uniform(0, 0.6)
                if zc_ - za > 0.6:
                    seg_poly = [seg.P(ua, za, -0.04), seg.P(ub, za, -0.04), seg.P(ub, zc_ if k % 2 else zc_ - 0.4, -0.04), seg.P((ua + ub) / 2, zc_ + 0.3, -0.04) if k % 3 == 0 else seg.P(ua, zc_, -0.04)]
                    b.face(seg_poly, 'plain', rs.choice(pal), mode='fit')
    if 'awning' in feats:
        U.awning(b, x0 + 0.8, x1 - 0.8, y0, min(3.2, H * 0.6), 1.7, (lk.trim_col, acc))
    if 'roof-terrace' in feats and P['roof'] == 'flat':
        U.roof_terrace(b, lk, lib.fp_rect(x1 - x0 - 0.8, y1 - y0 - 0.8, cx, (y0 + y1) / 2), H + 0.2, S, umbrellas=3)
        if b.detail < 2:
            U.box_c(b, x1 - 2.0, y1 - 2.0, H, 2.4, 2.4, 2.4, 'plain-render', lib.shade(lk.wall_col, 0.9), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    if 'steps' in feats and b.detail == 0:
        lib.steps(b, cx - 1.5, cx + 1.5, y0, 0.6, 1.2, 3)
    if 'mast' in feats:
        U.mast(b, x1 - 2.0, y1 - 2.5, H + (2.4 if 'roof-terrace' in feats else 0.0), 8.0, 0.14, banded=False)
    if 'atrium-glass' in feats and b.detail < 2:
        gw = U.clamp(W * 0.5, 4, 9)
        gfp = lib.fp_rect(gw, 3.2, cx, y0 - 1.6)
        for seg in gfp.edges():
            if not seg.rear:
                U.skin(b, seg, 0, 3.4, 1, 'curtain', lk, group=1)
        pts = [(cx - gw / 2, y0 - 3.2, 3.4), (cx + gw / 2, y0 - 3.2, 3.4), (cx + gw / 2, y0, 4.2), (cx - gw / 2, y0, 4.2)]
        b.facing(pts, (0, -0.3, 1), 'glass-ribbon', lk.glass_col, mode='tile')
    if 'kiosk' in feats and b.detail < 2:
        U.booth(b, x0 - 2.0, y0 - 1.0, 2.2, 2.0, 2.6, acc, sign_col=lk.trim_col)
    roof_clutter(b, lk, P, fp, H, S)
    info = {'bx0': fp.bbox[0], 'bx1': fp.bbox[2], 'yf': y0 - (1.7 if 'awning' in feats else 0), 'yb': fp.bbox[3] + 1.0}
    return fp, info


def build(brief, style, rng, detail):
    b = lib.Builder('office-low', detail)
    S = U.Streams(rng)
    brief = U.sane(brief)
    style = style if isinstance(style, dict) else {}
    lk = lib.look(brief, style, S.get('look'))
    P = plan(brief, style, lk, S)
    typ = P['typ']
    if typ == 'branch':
        fp, info = build_branch(b, lk, P, S)
    elif typ == 'secretariat':
        fp, info = build_block(b, lk, P, S, secretariat=True)
    elif typ == 'studio':
        fp, info = build_studio(b, lk, P, S)
    else:
        fp, info = build_block(b, lk, P, S)
    feats = P['feats']
    flags = 3 if 'flags' in feats and P['W'] > 20 else (1 if 'flags' in feats else 0)
    sign = (7.0, 2.0, accent_of(lk, P)) if ('signage-board' in feats and typ == 'branch') else None
    fore = 28.0 if typ in ('block', 'secretariat') else 24.0
    plot_site_args = dict(fore=fore, flags=flags, sign=sign, trees=4 if P['W'] < 40 else 6, side=14.0 if P['W'] < 60 else 10.0,
                          fence_default=(typ == 'branch' and 'fence-wall' in feats))
    pad = U.plot_site(b, lk, S, feats, P['setting'], info['bx0'], info['bx1'], info['yf'], info['yb'], **plot_site_args)
    return b.objects()
