"""manor: country houses, villas, mansions and historic residences. The style changes the architecture:

  tudor     half-timbered E / L / H plan: jettied upper floor, studs, rails and braces, mullioned windows, steep cross-gables,
            tall clustered brick chimney stacks, gabled porch
  georgian  symmetrical stucco or brick front with sash windows, string course, pedimented portico on steps, hip roof with end
            chimneys, dormers, optional lower pavilion wings
  colonial  verandah villa: deep hipped roof, louvred shutters, columned verandah and steps (the Nigerian / tropical colonial house)
  castle    castle-styled mansion: crenellated parapets, a central or corner towers (square with crenellations or round with cone caps),
            arched windows, flags
  bungalow  single-storey hipped house with a porch
  house     compact three-storey painted house with balcony pods, steps and garden statues (artist's / family houses)

Gardens: lawn and gravel drive, fountain, statues, pavilion, hedges, trees, boundary wall with gate piers.
Layout: house centred on x = 0, main front towards -Y (forecourt and gate).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _office_tower_util as U  # noqa: E402

FEATURES = {'portico', 'pediment', 'colonnade', 'arcade', 'balcony-bands', 'courtyard', 'fence-wall', 'gate', 'statue', 'pavilion', 'steps',
            'crenellation', 'bell-tower', 'clock-tower', 'flags', 'fountain', 'water-tank', 'signage-board', 'terrace', 'dome', 'chimney',
            'obelisk', 'car-park', 'umbrellas', 'awning', 'pinnacles', 'relief-pattern', 'roof-terrace', 'solar-panels', 'louvres', 'arches'}


def has(t, *w):
    return any(x in t for x in w)


# ------------------------------------------------------------------------------------------------------------------- planning
def plan(brief, style, lk, S):
    form = U.form_of(brief)
    feats = U.feat(brief)
    txt = U.text(brief)
    sty = U.style_of(brief)
    yr = U.year_of(brief, 1900)
    storeys = int(U.clamp(U.fnum(form.get('storeys'), 2), 1, 4))
    W = U.clamp(U.fnum(form.get('width_m'), 28), 10, 60)
    D = U.clamp(U.fnum(form.get('depth_m'), 16), 8, 36)
    H = U.clamp(U.fnum(form.get('height_m'), storeys * 3.4 + 1.0), 3.4, 20)
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'hip'
    if sty == 'tudor' or has(txt, 'tudor', 'half-timber', 'elizabethan', 'jacobean'):
        typ = 'tudor'
    elif has(txt, 'castle', 'turret', 'fortress') or 'crenellation' in feats:
        typ = 'castle'
    elif sty in ('georgian', 'neoclassical', 'victorian', 'baroque') or has(txt, 'georgian', 'palladian', 'country house', 'manor house'):
        typ = 'georgian'
    elif storeys == 1:
        typ = 'bungalow'
    elif sty == 'colonial' or has(txt, 'verandah', 'veranda', 'colonial') or yr < 1960 and sty in ('vernacular', 'colonial'):
        typ = 'colonial'
    elif storeys >= 3 or has(txt, 'sculpt', 'artist', 'statue'):
        typ = 'house'
    else:
        typ = 'colonial' if yr < 1975 else 'house'
    return {'typ': typ, 'W': W, 'D': D, 'H': H, 'storeys': storeys, 'fpk': fpk, 'roof': roof, 'feats': feats, 'txt': txt, 'sty': sty, 'yr': yr,
            'setting': brief.get('setting') or {}}


# ------------------------------------------------------------------------------------------------------------------- parts
def chimney(b, lk, x, y, z, h, w=1.3, d=1.0, flues=1, col='#9a4a36'):
    """A brick chimney stack with a stone cap and pots (flues stacked side by side for tudor clusters)."""
    if b.detail >= 2:
        U.box_c(b, x, y, z, w * flues, d, h, 'plain', col, skip=('bottom',))
        return
    ww = w * flues + (flues - 1) * 0.0
    U.box_c(b, x, y, z, ww, d, h, 'brick', col, top_slot='plain', top_col='#8d8a84', skip=('bottom',), scale=1.0)
    if b.detail == 0:
        U.box_c(b, x, y, z + h - 0.25, ww + 0.3, d + 0.3, 0.25, 'plain', '#b5b0a6', skip=())
        for k in range(flues):
            px = x - ww / 2 + w * (k + 0.5)
            lib.cylinder(b, px, y, z + h, z + h + 0.5, 0.2, n=6, slot='plain', col='#b5603e', r_top=0.17, top=True, smooth=False)


def window_quad(b, seg, u0, u1, z0, z1, slot, col, d=-0.05):
    b.face([seg.P(u0, z0, d), seg.P(u1, z0, d), seg.P(u1, z1, d), seg.P(u0, z1, d)], slot, col, mode='fit')


def arch_window(b, seg, uc, ww, zs, z1, col, d=-0.05, n=6):
    """Round-headed window: rectangle up to the springing then a half circle."""
    r = ww / 2
    pts = [seg.P(uc - r, zs, d), seg.P(uc + r, zs, d)]
    for k in range(n + 1):
        a = math.pi * k / n
        pts.append(seg.P(uc + r * math.cos(a), z1 - r + r * math.sin(a), d))
    b.face(pts, 'glass-punched', col, mode='fit')


def manor_facade(b, lk, P, seg, z0, z1, floors, S, dress, door_seg=False, ws=None, wc=None, rear=False, shutters=None, balcony=False, ground_door=True):
    """One wall: plain wall plus window bays per dress (georgian sash, tudor mullioned, colonial shuttered, castle arched, house plain)."""
    ws = ws or lk.wall_slot
    wc = wc or lk.wall_col
    L = seg.length
    fh = (z1 - z0) / floors
    U.plain(b, seg, 0, L, z0, z1, ws, wc)
    if b.detail >= 2 or L < 2.0:
        return
    bay = {'georgian': 3.3, 'tudor': 2.6, 'colonial': 3.4, 'castle': 3.4, 'house': 3.4, 'bungalow': 3.6}[dress]
    nb = max(1, round(L / bay))
    bw = L / nb
    glass = lk.glass_col
    trim = lk.trim_col
    mid = (nb - 1) / 2
    for f in range(floors):
        zb = z0 + f * fh
        for k in range(nb):
            uc = (k + 0.5) * bw
            if door_seg and f == 0 and ground_door and (abs(k - mid) < 0.51 and (nb % 2 == 1 or k in (nb // 2 - 1, nb // 2))):
                if nb % 2 == 0 and k != nb // 2:
                    continue
                dw = 1.5 if dress != 'tudor' else 1.3
                dh = min(2.5, fh * 0.75)
                uc_ = uc if nb % 2 == 1 else (nb // 2) * bw
                if b.detail == 0:
                    window_quad(b, seg, uc_ - dw / 2, uc_ + dw / 2, zb + 0.0, zb + dh, 'plain', lib.shade(lk.trim_col, 0.45) if dress != 'colonial' else '#6a4a30')
                    U.sbox(b, seg, uc_ - dw / 2 - 0.15, uc_ + dw / 2 + 0.15, zb + dh, zb + dh + 0.18, 0.15, trim, skip_ends=True)
                else:
                    window_quad(b, seg, uc_ - dw / 2, uc_ + dw / 2, zb, zb + dh, 'plain', lib.shade(lk.trim_col, 0.45))
                continue
            if 'arches' in P['feats'] and f == 0 and dress in ('georgian', 'colonial', 'house', 'bungalow'):
                ww = min(1.4, bw - 0.9)
                zs = zb + fh * 0.3
                arch_window(b, seg, uc, ww, zs, zs + min(2.4, fh * 0.65), glass)
                if b.detail == 0:
                    U.sbox(b, seg, uc - ww / 2 - 0.12, uc + ww / 2 + 0.12, zs - 0.12, zs, 0.1, trim, skip_ends=True)
            elif dress == 'georgian':
                ww, wh = 1.05, min(2.05, fh * 0.62)
                if f == floors - 1 and floors > 1:
                    wh *= 0.85
                sill = zb + (fh - wh) * 0.45
                window_quad(b, seg, uc - ww / 2, uc + ww / 2, sill, sill + wh, 'glass-punched', glass)
                if b.detail == 0:
                    U.sbox(b, seg, uc - ww / 2 - 0.12, uc + ww / 2 + 0.12, sill - 0.12, sill, 0.1, trim, skip_ends=True)
                    U.sbox(b, seg, uc - ww / 2 - 0.1, uc + ww / 2 + 0.1, sill + wh, sill + wh + 0.2, 0.1, lib.shade(trim, 0.9), skip_ends=True)
            elif dress == 'tudor':
                ww, wh = min(1.9, bw - 0.6), min(1.15, fh * 0.4)
                sill = zb + fh * 0.4
                window_quad(b, seg, uc - ww / 2, uc + ww / 2, sill, sill + wh, 'glass-ribbon', glass)
                if b.detail == 0:
                    U.sbox(b, seg, uc - ww / 2 - 0.1, uc + ww / 2 + 0.1, sill - 0.12, sill, 0.08, '#3b2c20', skip_ends=True)
                    U.sbox(b, seg, uc - ww / 2 - 0.1, uc + ww / 2 + 0.1, sill + wh, sill + wh + 0.12, 0.08, '#3b2c20', skip_ends=True)
            elif dress == 'castle':
                ww = min(1.3, bw - 0.9)
                zs = zb + fh * 0.32
                arch_window(b, seg, uc, ww, zs, zs + min(2.3, fh * 0.62), glass)
                if b.detail == 0:
                    U.sbox(b, seg, uc - ww / 2 - 0.12, uc + ww / 2 + 0.12, zs - 0.12, zs, 0.1, trim, skip_ends=True)
            else:   # colonial, bungalow, house
                ww, wh = 1.25, min(1.7, fh * 0.52)
                if dress == 'house':
                    ww = 1.5
                sill = zb + (fh - wh) * 0.45
                window_quad(b, seg, uc - ww / 2, uc + ww / 2, sill, sill + wh, 'glass-punched', glass)
                if b.detail == 0:
                    U.sbox(b, seg, uc - ww / 2 - 0.1, uc + ww / 2 + 0.1, sill - 0.1, sill, 0.1, trim, skip_ends=True)
                    if shutters or dress in ('colonial', 'bungalow'):
                        sc = shutters or lib.mix('#3f6a4a', lk.accent_col, 0.3)
                        for sg in (-1, 1):
                            uu = uc + sg * (ww / 2 + 0.28)
                            window_quad(b, seg, uu - 0.24, uu + 0.24, sill, sill + wh, 'corrugated', sc, d=-0.06)
    if b.detail == 0 and not rear:
        if dress == 'georgian' and floors > 1:
            U.sbox(b, seg, 0, L, z0 + fh - 0.12, z0 + fh + 0.12, 0.1, trim, skip_ends=True)   # string course
        if dress in ('georgian', 'castle', 'house', 'colonial'):
            U.sbox(b, seg, 0, L, z0, z0 + 0.6, 0.08, lib.shade(wc, 0.78), skip_ends=True)      # plinth
        if dress in ('georgian', 'castle') and seg.length > 4:
            # quoins: alternating corner blocks
            for k in range(int((z1 - z0) / 0.7)):
                zq = z0 + 0.3 + k * 0.7
                wq = 0.55 if k % 2 == 0 else 0.35
                U.sbox(b, seg, 0, wq, zq, zq + 0.55, 0.05, trim, skip_ends=True)
                U.sbox(b, seg, L - wq, L, zq, zq + 0.55, 0.05, trim, skip_ends=True)


def half_timber(b, seg, z0, z1, floors, col='#3b2c20', close=False):
    """Timber framing drawn over a rendered wall: floor rails, studs at each bay, diagonal braces; LOD0 only."""
    if b.detail >= 1:
        return
    L = seg.length
    fh = (z1 - z0) / floors
    d = -0.05
    tw = 0.12
    # rails
    for f in range(floors + 1):
        zz = z0 + f * fh
        b.face([seg.P(0, zz - 0.1, d), seg.P(L, zz - 0.1, d), seg.P(L, zz + 0.1, d), seg.P(0, zz + 0.1, d)], 'plain', col, mode='fit')
    pitch = 0.62 if close else 1.25
    n = max(2, int(L / pitch))
    for f in range(floors):
        za, zb_ = z0 + f * fh, z0 + (f + 1) * fh
        for k in range(n + 1):
            u = min(max(k * L / n, tw), L - tw)
            b.face([seg.P(u - tw, za, d), seg.P(u + tw, za, d), seg.P(u + tw, zb_, d), seg.P(u - tw, zb_, d)], 'plain', col, mode='fit')
        # braces in the end panels
        pw = L / n
        for (ua, ub) in ((0, pw), (L - pw, L)):
            b.face([seg.P(ua, za, d), seg.P(ua + 0.2, za, d), seg.P(ub, zb_, d), seg.P(ub - 0.2, zb_, d)], 'plain', col, mode='fit')
            b.face([seg.P(ub, za, d), seg.P(ub - 0.2, za, d), seg.P(ua, zb_, d), seg.P(ua + 0.2, zb_, d)], 'plain', col, mode='fit')


def dormer(b, lk, x, y, z, w=1.6, h=1.5, depth=1.3):
    """A small gabled dormer window standing on the front roof slope (faces -Y)."""
    if b.detail >= 1:
        return
    U.box(b, x - w / 2, y, z, x + w / 2, y + depth, z + h, 'plain-render', lk.trim_col, skip=('bottom', 'back'))
    b.face([(x - w / 2, y, z + 0.4), (x + w / 2, y, z + 0.4), (x + w / 2, y, z + h - 0.3), (x - w / 2, y, z + h - 0.3)], 'glass-punched', lk.glass_col, mode='fit')
    # little gable roof
    rr = w / 2 + 0.15
    for sx in (-1, 1):
        b.facing([(x + sx * rr, y - 0.15, z + h), (x, y - 0.15, z + h + 0.7), (x, y + depth, z + h + 0.7), (x + sx * rr, y + depth, z + h)], (sx * 0.7, -0.1, 1), lk.roof_slot, lk.roof_col, scale=1.0)
    b.facing([(x - rr + 0.15, y - 0.15, z + h), (x + rr - 0.15, y - 0.15, z + h), (x, y - 0.15, z + h + 0.7)], (0, -1, 0), 'plain-render', lk.trim_col)


def turret(b, lk, x, y, z0, r, h, S, cap='cone', col=None, crenel=False):
    """A round turret with slit windows and a conical cap (castle-styled mansions)."""
    col = col or lk.wall_col
    n = 14 if b.detail == 0 else (8 if b.detail == 1 else 6)
    lib.cylinder(b, x, y, z0, z0 + h, r, n=n, slot=lk.wall_slot, col=col, r_top=r, top=False, smooth=True, scale=1.5)
    if b.detail == 0:
        for k in range(3):
            zz = z0 + 2.0 + k * (h - 3.5) / 3
            a = -math.pi / 2
            b.facing([(x - 0.15, y - r - 0.02, zz), (x + 0.15, y - r - 0.02, zz), (x + 0.15, y - r - 0.02, zz + 0.9), (x - 0.15, y - r - 0.02, zz + 0.9)], (0, -1, 0), 'plain', '#2c3338', mode='fit')
        lib.cylinder(b, x, y, z0 + h - 0.3, z0 + h + 0.35, r + 0.35, n=n, slot='plain-render', col=lk.trim_col, r_top=r + 0.35, top=True, smooth=False)
    if cap == 'cone':
        lib.cylinder(b, x, y, z0 + h + (0.35 if b.detail == 0 else 0.0), z0 + h + r * 2.2, r + 0.5, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
        if b.detail < 2:
            lib.cylinder(b, x, y, z0 + h + r * 2.2, z0 + h + r * 2.2 + 1.6, 0.05, n=4, slot='frame', col='#8d9298', top=True)
    else:
        lib.flat_roof(b, lib.fp_round(r, n).moved(x, y), z0 + h, lk, parapet_h=0.0, ov=0.0, slab=0.0)


def statue(b, x, y, h=2.6, col='#cfc9bd', base='#a9a59b', kind=None):
    """A garden statue: plinth plus a stylised standing figure (column + torso + head) or an abstract stack."""
    if b.detail >= 2:
        return
    with b.site():
        U.box_c(b, x, y, 0, 1.1, 1.1, 0.9, 'stone-blocks', base, top_col=lib.shade(base, 0.9), skip=('bottom',))
        if b.detail == 0:
            lib.cylinder(b, x, y, 0.9, 0.9 + h * 0.55, 0.28, n=6, slot='plain', col=col, r_top=0.2, top=False, smooth=True)
            lib.blob(b, x, y, 0.9 + h * 0.62, 0.32, 0.2, 0.28, col, n=6, rings=3)
            lib.blob(b, x, y, 0.9 + h * 0.87, 0.16, 0.16, 0.17, col, n=6, rings=3)
            if kind == 'abstract':
                lib.blob(b, x + 0.3, y, 0.9 + h * 0.5, 0.2, 0.2, 0.35, lib.shade(col, 0.9), n=5, rings=3)
        else:
            lib.cylinder(b, x, y, 0.9, 0.9 + h * 0.8, 0.22, n=4, slot='plain', col=col, top=False, smooth=False)


def fountain(b, x, y, r=3.0, water='#5ba7c7', stone='#c8c3b8'):
    if b.detail >= 2:
        return
    with b.site():
        n = 16 if b.detail == 0 else 8
        lib.cylinder(b, x, y, 0, 0.6, r, n=n, slot='stone-blocks', col=stone, r_top=r, top=False, smooth=False)
        lib.cylinder(b, x, y, 0.58, 0.59, r - 0.35, n=n, slot='plain', col=water, r_top=r - 0.35, top=True, smooth=False)
        lib.cylinder(b, x, y, 0.6, 2.0, 0.3, n=6, slot='stone-blocks', col=stone, r_top=0.2, top=False, smooth=False)
        if b.detail == 0:
            lib.cylinder(b, x, y, 1.5, 1.7, 1.0, n=10, slot='stone-blocks', col=stone, r_top=0.3, top=True, smooth=False)
            lib.cylinder(b, x, y, 2.0, 2.9, 0.12, n=5, slot='plain', col='#bfe3f2', r_top=0.02, top=False, smooth=False)


def hedge_row(b, S, pts, h=1.2, w=0.9, col='#3f6f3a', key='hedge'):
    if b.detail >= 2:
        return
    for i in range(len(pts) - 1):
        p, q = pts[i], pts[i + 1]
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        if L < 0.5:
            continue
        yaw = math.atan2(q[1] - p[1], q[0] - p[0])
        with b.site():
            U.obox(b, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0, L, w, h, yaw, 'plain', col, top_col=lib.shade(col, 1.12), skip=('bottom',))


# ------------------------------------------------------------------------------------------------------------------- house builders
def roof_any(b, lk, form, fp, z, pitch, ov, slot=None, col=None):
    """lib.roof with the roof surface overridden (gable/shed take slot=/col=, the ring-profile roofs roof_slot=/roof_col=)."""
    slot = slot or lk.roof_slot
    col = col or lk.roof_col
    if form in ('gable', 'shed'):
        lib.roof(b, form, fp, z, lk, pitch=pitch, ov=ov, slot=slot, col=col)
    else:
        lib.roof(b, form, fp, z, lk, pitch=pitch, ov=ov, roof_slot=slot, roof_col=col)


def walls_all(b, lk, P, fp, z0, z1, floors, S, dress, door_front=True, **kw):
    fronts = [s_ for s_ in fp.edges() if s_.front]
    main = max(fronts, key=lambda s_: s_.length) if fronts else None
    for seg in fp.edges():
        manor_facade(b, lk, P, seg, z0, z1, floors, S, dress, door_seg=(seg is main and door_front), rear=seg.rear and b.detail == 0, **kw)


def main_fp(P, S, b, W, D, kinds=('rect', 'L', 'U', 'H', 'T')):
    fpk = P['fpk'] if P['fpk'] in kinds else 'rect'
    return lib.footprint(fpk, W, D, S.get('fp'), b.detail)


def main_rect(fp):
    return max(fp.rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))


def build_tudor(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], max(2, P['storeys'])
    feats = P['feats']
    W = U.clamp(W, 18, 54)
    fpk = P['fpk'] if P['fpk'] in ('L', 'U', 'H', 'T', 'rect') else 'rect'
    if fpk == 'rect' and W > 30:
        fpk = 'H' if S.get('plan').random() < 0.5 else 'U'
    fp = lib.footprint(fpk, W, D, S.get('fp'), b.detail)
    H = U.clamp(H, 6.0, 12.0)
    fh = H / st
    plaster = lk.wall_col if lk.wall_slot == 'plain-render' else '#efe6cf'
    # ground storey in brick or render, upper storeys jettied half-timber
    gcol = lk.wall_col if lk.wall_slot in ('brick',) else lib.mix(plaster, '#b08a6a', 0.0)
    gslot = lk.wall_slot if lk.wall_slot in ('brick', 'stone-blocks') else 'brick'
    gcol = '#a45a3f' if gslot == 'brick' and lk.wall_slot != 'brick' else lk.wall_col
    b.section('ground')
    walls_all(b, lk, P, fp, 0, fh, 1, S, 'tudor', ws=gslot, wc=gcol)
    up_polys = [lib.shapes._miter(pl, 0.45) for pl in fp.polys]
    fp_up = lib.Footprint(up_polys, fp.rects)
    b.section('upper')
    for seg in fp_up.edges():
        manor_facade(b, lk, P, seg, fh, H, st - 1, S, 'tudor', ws='plain-render', wc=plaster, rear=seg.rear and b.detail == 0, ground_door=False)
        if not seg.rear:
            half_timber(b, seg, fh, H, st - 1, close=seg.front)
    if b.detail == 0:
        # jetty soffit and bressummer beam
        lib.sweep(b, fp_up, fh, [(-0.45, 0.0), (0.0, 0.0)], 'plain', '#3b2c20')
        lib.sweep(b, fp_up, fh - 0.25, [(0.0, 0.0), (0.0, 0.25)], 'plain', '#3b2c20')
    elif b.detail == 1:
        lib.sweep(b, fp_up, fh, [(-0.45, 0.0), (0.0, 0.0)], 'plain', '#4a3a2c')
    b.section('roof')
    lib.roof(b, 'gable', fp, H, lk, pitch=46, ov=0.7 if b.detail < 2 else 0.3, slot=lk.roof_slot if lk.roof_slot in ('clay-tile', 'slate') else 'clay-tile', col=lk.roof_col)
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    run = min(x1 - x0, y1 - y0) / 2
    ridge_z = H + run * math.tan(math.radians(46))
    b.section('chimneys')
    for sx in (x0 + 2.4, x1 - 2.4):
        chimney(b, lk, sx, (y0 + y1) / 2, ridge_z - 2.6, 3.8 + 2.6 - 0.0, w=1.0, d=1.0, flues=3, col='#9a4a36')
    if fp.rects and len(fp.rects) > 1:
        r2 = [r for r in fp.rects if r is not mr][0]
        chimney(b, lk, (r2[0] + r2[2]) / 2, (r2[1] + r2[3]) / 2, H + 0.5, ridge_z - H + 2.0, w=1.0, d=1.0, flues=2, col='#9a4a36')
    # gabled porch on the front
    cx = (x0 + x1) / 2
    b.section('porch')
    pw_, pd_ = 3.4, 2.4
    pfp = lib.fp_rect(pw_, pd_, cx, y0 - pd_ / 2 + 0.05)
    for seg in pfp.edges():
        if seg.rear:
            continue
        U.plain(b, seg, 0, seg.length, 0, fh + 0.4, 'brick', gcol)
    if b.detail < 2:
        door_seg = [s for s in pfp.edges() if s.front][0]
        window_quad(b, door_seg, pw_ / 2 - 0.65, pw_ / 2 + 0.65, 0.0, 2.3, 'plain', '#3b2c20', d=-0.03)
        lib.gable(b, (cx - pw_ / 2 - 0.2, y0 - pd_, cx + pw_ / 2 + 0.2, y0), fh + 0.4, 1.9, lk, axis='y', ov=0.25, slot=lk.roof_slot, col=lk.roof_col, gable_slot='plain-render', gable_col=plaster)
    # cross gables on the front of the wings are handled by lib.roof (multi-rect footprints)
    info = {'bx0': fp.bbox[0] - 0.5, 'bx1': fp.bbox[2] + 0.5, 'yf': fp.bbox[1] - 0.5, 'yb': fp.bbox[3] + 0.5}
    return fp, info


def avant_corps(b, lk, P, S, cx, y0, w, H, st, depth=1.3, dress='georgian'):
    """A slightly projecting central bay with its own pediment (baroque / neoclassical fronts)."""
    afp = lib.fp_rect(w, depth, cx, y0 - depth / 2 + 0.02)
    for seg in afp.edges():
        if seg.rear:
            continue
        if seg.front:
            manor_facade(b, lk, P, seg, 0, H, st, S, dress, door_seg=True)
        else:
            U.plain(b, seg, 0, seg.length, 0, H, lk.wall_slot, lk.wall_col)
    if b.detail < 2:
        rise = w * 0.13
        lib.gable(b, (cx - w / 2 - 0.2, y0 - depth - 0.2, cx + w / 2 + 0.2, y0 + 0.3), H, rise, lk, axis='x', ov=0.0, slot=lk.roof_slot, col=lk.roof_col, gable_slot='plain-render', gable_col=lk.trim_col)


def build_georgian(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], max(2, P['storeys'])
    feats = P['feats']
    W = U.clamp(W, 18, 88)
    D = U.clamp(D, 10, 34)
    H = U.clamp(H, 8.0, 17.0)
    fh = H / st
    shaped = P['fpk'] in ('U', 'H', 'L', 'T', 'ring') and W >= 30
    wings = (not shaped) and W >= 34
    mw = W * (0.58 if wings else 1.0)
    if shaped:
        kind = P['fpk'] if P['fpk'] != 'ring' else 'U'
        fp = lib.footprint(kind, W, D if kind != 'U' else max(D, 26), S.get('fp'), b.detail)
    else:
        fp = lib.fp_rect(mw, D)
    b.section('walls')
    walls_all(b, lk, P, fp, 0, H, st, S, 'georgian')
    if b.detail == 0:
        lib.cornice(b, fp, H - 0.55, 0.45, 0.55, lk, col=lk.trim_col)
    b.section('roof')
    flat = P['roof'] == 'flat'
    pitch = 27
    rslot = lk.roof_slot if lk.roof_slot in ('slate', 'clay-tile', 'metal-roof', 'corrugated') else 'slate'
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    mwid = x1 - x0
    if flat:
        lib.flat_roof(b, fp, H, lk, parapet_h=1.0, ov=0.0, slab=0.0)
    elif P['roof'] == 'mansard':
        lib.roof(b, 'mansard', fp, H, lk, ov=0.4, rise=3.6)
    else:
        lib.roof(b, 'hip', fp, H, lk, pitch=pitch, ov=0.55 if b.detail < 2 else 0.3, slot=rslot) if False else lib.roof(b, 'hip', fp, H, lk, pitch=pitch, ov=0.55 if b.detail < 2 else 0.3)
    if not flat:
        for sx in (x0 + 3.0, x1 - 3.0):
            chimney(b, lk, sx, (y0 + y1) / 2, H + 0.8, 3.4, w=1.4, d=1.1, flues=2, col='#8f4b38' if lk.wall_slot != 'brick' else '#7a3d2e')
        if b.detail == 0 and mwid > 22 and not shaped:
            for k in range(3):
                dormer(b, lk, x0 + mwid * (0.2 + 0.3 * k), y0 + 1.7, H + 0.6, 1.5, 1.5, 1.2)
    b.section('wings')
    if wings:
        ww = (W - mw) / 2 - 1.2
        wd = D * 0.8
        wh = H * 0.82
        for sx in (-1, 1):
            wcx = sx * (mw / 2 + 1.2 + ww / 2)
            wfp = lib.fp_rect(ww, wd, wcx, 0.0)
            walls_all(b, lk, P, wfp, 0, wh, max(1, st - 1), S, 'georgian', door_front=False)
            lib.roof(b, 'hip', wfp, wh, lk, pitch=28, ov=0.5 if b.detail < 2 else 0.3)
            chimney(b, lk, wcx, 0.0, wh + 0.6, 2.6, w=1.2, d=1.0, flues=1, col='#8f4b38')
    b.section('portico')
    cx = (x0 + x1) / 2
    pw = U.clamp(mwid * 0.3, 6.5, 11.0)
    ydoor = y0
    if 'portico' in feats or ('pediment' not in feats):
        if b.detail < 2:
            lib.portico(b, cx, y0, 0.9, pw, 3.6, max(3.6, fh * 1.45 if st > 1 else 3.6), lk, cols=4, pediment=True, steps_n=4)
        ydoor = y0 - 4.5
    elif 'pediment' in feats and mwid > 16:
        avant_corps(b, lk, P, S, cx, y0, U.clamp(mwid * 0.28, 7, 14), H, st)
        if b.detail == 0:
            lib.steps(b, cx - 2.0, cx + 2.0, y0 - 1.4, 0.9, 2.0, 4)
        ydoor = y0 - 3.5
    if 'bell-tower' in feats and b.detail < 2:
        lib.tower(b, cx, (y0 + y1) / 2, H, 4.2, 4.2, 5.0, lk, storeys=1, windows='punched', cap='hip', cap_rise=3.2, ratio=0.45)
    if 'courtyard' in feats and shaped and b.detail < 2:
        pass
    info = {'bx0': fp.bbox[0], 'bx1': fp.bbox[2], 'yf': ydoor, 'yb': fp.bbox[3] + 0.5}
    return fp, info


def build_colonial(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    W = U.clamp(W, 14, 46)
    D = U.clamp(D, 10, 24)
    H = U.clamp(H, 4.2, 9.0)
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'U', 'T') else 'rect'
    fp = lib.footprint(fpk, W, D, S.get('fp'), b.detail)
    b.section('walls')
    wcol = lk.wall_col
    walls_all(b, lk, P, fp, 0, H, st, S, 'colonial', shutters=None)
    b.section('roof')
    roof = 'hip' if P['roof'] in ('hip', 'flat', 'pyramidal', 'mansard') else P['roof']
    rs = lk.roof_slot if lk.roof_slot in ('corrugated', 'clay-tile', 'metal-roof', 'slate') else 'corrugated'
    roof_any(b, lk, roof, fp, H, 26, 1.5 if b.detail < 2 else 0.6, rs, lk.roof_col)
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    cx = (x0 + x1) / 2
    b.section('verandah')
    n = max(4, int((x1 - x0) / 2.8))
    vz = min(3.4, H * 0.62 + 0.8) if st > 1 else min(3.3, H - 0.6)
    if b.detail < 2:
        U.veranda(b, lk, x0 + 0.6, x1 - 0.6, y0, vz, 2.6, n, kind='arch' if 'arcade' in feats else ('square' if P['sty'] == 'vernacular' else 'round'), roof_slot=rs, roof_col=lk.roof_col)
    if 'portico' in feats and b.detail < 2:
        lib.portico(b, cx, y0 - 2.6, 0.5, U.clamp((x1 - x0) * 0.22, 5, 8), 2.4, max(3.2, vz + 0.4), lk, cols=4, pediment=True, steps_n=3)
    elif b.detail == 0:
        lib.steps(b, cx - 2.2, cx + 2.2, y0 - 2.7, 0.55, 1.4, 3)
    if 'balcony-bands' in feats and st > 1 and b.detail == 0:
        for seg in fp.edges():
            if seg.front:
                for f in range(1, st):
                    U.sbox(b, seg, 0, seg.length, H * f / st - 0.15, H * f / st + 0.15, 0.2, lk.trim_col, skip_ends=True)
    if 'chimney' in feats or True:
        chimney(b, lk, x1 - 3.0, (y0 + y1) / 2, H + 0.5, 3.0, w=1.2, d=1.0, flues=1, col='#9a5a46')
    if 'water-tank' in feats and b.detail < 2:
        U.water_tank(b, x1 + 2.5, y1 - 2.5, 0.0, 1.2, 2.2)
    info = {'bx0': fp.bbox[0] - 0.5, 'bx1': fp.bbox[2] + 0.5, 'yf': y0 - 3.4, 'yb': fp.bbox[3] + 0.5}
    return fp, info


def build_castle(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], max(2, P['storeys'])
    feats = P['feats']
    W = U.clamp(W, 20, 50)
    D = U.clamp(D, 12, 30)
    H = U.clamp(H, 7.0, 14.0)
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'U', 'T') else 'rect'
    fp = lib.footprint(fpk, W, D, S.get('fp'), b.detail)
    walls_all(b, lk, P, fp, 0, H, st, S, 'castle', ws=lk.wall_slot, wc=lk.wall_col)
    b.section('roof')
    if P['roof'] in ('hip', 'gable'):
        lib.roof(b, P['roof'], fp, H, lk, pitch=22, ov=0.5)
        mr = main_rect(fp)
    else:
        lib.flat_roof(b, fp, H, lk, parapet_h=1.0 if b.detail < 2 else 0.5, ov=0.0, slab=0.0)
        mr = main_rect(fp)
        if b.detail == 0 and ('crenellation' in feats or True):
            U.crenellate(b, lk, fp, H + 1.0, h=0.85, w=0.9, gap=0.8, col=lk.trim_col)
    x0, y0, x1, y1 = mr
    cx = (x0 + x1) / 2
    b.section('towers')
    tw = 5.4
    # central entrance tower
    tfp = lib.fp_rect(tw, tw, cx, y0 - 0.5)
    th = H + 5.0
    for seg in tfp.edges():
        manor_facade(b, lk, P, seg, 0, th, st + 1, S, 'castle', door_seg=seg.front, ws=lk.wall_slot, wc=lib.shade(lk.wall_col, 0.97), rear=False)
    lib.flat_roof(b, tfp, th, lk, parapet_h=1.0 if b.detail < 2 else 0.5, ov=0.0, slab=0.0)
    if b.detail == 0:
        U.crenellate(b, lk, tfp, th + 1.0, h=0.85, w=0.85, gap=0.7, col=lk.trim_col)
    if b.detail < 2:
        U.flagpole(b, cx, y0 - 0.5, th + 7.0, lk.accent_col) if False else None
        lib.cylinder(b, cx, y0 - 0.5, th, th + 7.0, 0.07, n=4, slot='frame', col='#b8bcc0', top=True)
        if 'flags' in feats:
            pts = [(cx + 0.05, y0 - 0.5, th + 5.4), (cx + 2.0, y0 - 0.5, th + 5.5), (cx + 2.0, y0 - 0.5, th + 6.8), (cx + 0.05, y0 - 0.5, th + 7.0)]
            b.facing(pts, (0, -1, 0), 'plain', '#b6323a')
            b.facing(pts, (0, 1, 0), 'plain', '#8f2630')
    # corner turrets
    r = 2.4
    for sx in (x0 + 0.8, x1 - 0.8):
        turret(b, lk, sx, y0 + 0.8, 0.0, r, H + 1.0, S, 'cone', col=lk.wall_col)
    if 'bell-tower' in feats and b.detail < 2:
        pass
    b.section('portico')
    if b.detail == 0:
        lib.steps(b, cx - 1.6, cx + 1.6, y0 - 3.2, 0.5, 1.3, 3)
    info = {'bx0': fp.bbox[0] - 1.0, 'bx1': fp.bbox[2] + 1.0, 'yf': y0 - 4.4, 'yb': fp.bbox[3] + 0.5}
    return fp, info


def build_bungalow(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    W = U.clamp(W, 10, 36)
    D = U.clamp(D, 8, 20)
    H = U.clamp(H, 3.2, 6.0)
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'U', 'T') else 'rect'
    fp = lib.footprint(fpk, W, D, S.get('fp'), b.detail)
    walls_all(b, lk, P, fp, 0, H, 1, S, 'bungalow')
    rs = lk.roof_slot if lk.roof_slot in ('corrugated', 'clay-tile', 'metal-roof', 'slate') else 'corrugated'
    roof = P['roof'] if P['roof'] in ('hip', 'gable') else 'hip'
    roof_any(b, lk, roof, fp, H, 24, 1.0 if b.detail < 2 else 0.4, rs, lk.roof_col)
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    cx = (x0 + x1) / 2
    if b.detail < 2:
        # open porch with two posts under a little hip
        pw = 4.4
        for sx in (-1, 1):
            lib.cylinder(b, cx + sx * (pw / 2 - 0.2), y0 - 2.2, 0, H - 0.3, 0.14, n=6, slot='plain-render', col=lk.trim_col, top=False)
        pts = [(cx - pw / 2 - 0.2, y0 - 2.6, H - 0.35), (cx + pw / 2 + 0.2, y0 - 2.6, H - 0.35), (cx + pw / 2 + 0.2, y0, H + 0.5), (cx - pw / 2 - 0.2, y0, H + 0.5)]
        b.facing(pts, (0, -1, 1.5), rs, lk.roof_col, scale=1.0)
        if b.detail == 0:
            lib.steps(b, cx - pw / 2 + 0.4, cx + pw / 2 - 0.4, y0 - 2.6, 0.4, 1.0, 2)
    chimney(b, lk, x1 - 2.4, (y0 + y1) / 2, H + 0.3, 2.6, w=0.9, d=0.9, flues=1, col='#9a5a46')
    info = {'bx0': fp.bbox[0] - 0.5, 'bx1': fp.bbox[2] + 0.5, 'yf': y0 - 3.0, 'yb': fp.bbox[3] + 0.5}
    return fp, info


def build_house(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], max(2, P['storeys'])
    feats = P['feats']
    W = U.clamp(W, 10, 30)
    D = U.clamp(D, 8, 20)
    H = U.clamp(H, 6.0, 14.0)
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'U', 'T') else 'rect'
    fp = lib.footprint(fpk, W, D, S.get('fp'), b.detail)
    acc = lk.accent_col
    walls_all(b, lk, P, fp, 0, H, st, S, 'house')
    rs = lk.roof_slot if lk.roof_slot in ('corrugated', 'clay-tile', 'metal-roof', 'slate') else 'corrugated'
    if P['roof'] in ('hip', 'gable', 'pyramidal', 'shed'):
        roof_any(b, lk, 'hip' if P['roof'] == 'pyramidal' else P['roof'], fp, H, 22, 0.8 if b.detail < 2 else 0.3, rs, lk.roof_col)
    else:
        lib.flat_roof(b, fp, H, lk, parapet_h=1.0 if b.detail < 2 else 0.5, ov=0.0, slab=0.0)
        if 'roof-terrace' in feats:
            U.roof_terrace(b, lk, fp, H + 0.1, S)
    mr = main_rect(fp)
    x0, y0, x1, y1 = mr
    cx = (x0 + x1) / 2
    for seg in fp.edges():
        if seg.front and 'balcony-bands' in feats and b.detail == 0:
            U.balcony_pods(b, seg, 0, st, H / st, every=2, col=lk.trim_col, depth=1.1, gap_u=1.2)
            for f in range(1, st):
                U.sbox(b, seg, 0, seg.length, H * f / st - 0.12, H * f / st + 0.12, 0.1, lib.shade(lk.trim_col, 0.9), skip_ends=True)
    if 'steps' in feats and b.detail == 0:
        lib.steps(b, cx - 1.6, cx + 1.6, y0, 0.9, 2.0, 5)
    elif b.detail == 0:
        lib.steps(b, cx - 1.2, cx + 1.2, y0, 0.45, 1.0, 2)
    if 'portico' in feats and b.detail < 2:
        lib.portico(b, cx, y0, 0.5, 5.0, 2.4, max(3.0, H / st), lk, cols=4, pediment=False, steps_n=2)
    chimney(b, lk, x1 - 2.2, (y0 + y1) / 2, H + 0.2, 2.2, w=0.9, d=0.9, flues=1)
    if 'water-tank' in feats and b.detail < 2:
        U.water_tank(b, x0 + 2.0, y1 - 2.0, H + 0.1 if P['roof'] == 'flat' else 0.0, 1.1, 1.8) if P['roof'] == 'flat' else U.water_tank(b, x1 + 2.5, y1 - 2.5, 0.0, 1.1, 2.0)
    info = {'bx0': fp.bbox[0] - 0.5, 'bx1': fp.bbox[2] + 0.5, 'yf': y0 - (2.2 if 'steps' in feats else 1.2), 'yb': fp.bbox[3] + 0.5}
    return fp, info


# ------------------------------------------------------------------------------------------------------------------- garden
def tree_kind(lk, P, prefer=None):
    k = lk.tree if lk.tree not in (None, 'none') else None
    if prefer and (k in prefer or k is None):
        return prefer[0] if k is None else k
    return k


def pick_setting(P, lk, S):
    """Which kind of grounds the brief and style imply."""
    typ, sty, txt, feats = P['typ'], P['sty'], P['txt'], P['feats']
    setting = P['setting']
    ground = setting.get('ground') or ''
    tropical = lk.tree in ('palm', 'acacia') or ground in ('laterite', 'sand') or lk.ground_slot in ('laterite', 'sand')
    fpk = P['fpk']
    if tropical and typ in ('colonial', 'bungalow', 'house', 'castle', 'georgian'):
        return 'compound'
    if ('courtyard' in feats or fpk in ('U', 'ring', 'H')) and (sty in ('baroque', 'neoclassical', 'vernacular', 'colonial') or has(txt, 'courtyard', 'palazzo', 'palace')):
        return 'courtyard'
    if typ in ('georgian', 'tudor', 'castle') and P['W'] >= 34:
        return 'estate'
    if typ in ('georgian', 'tudor', 'castle'):
        return 'formal'
    if typ in ('house', 'bungalow', 'colonial'):
        return 'cottage'
    return 'formal'


def avenue(b, lk, S, x, y0, y1, n, kind, gap=4.5, key='av'):
    """Two rows of trees along a drive at x from y0 to y1."""
    if kind in (None, 'none') or b.detail >= 2:
        return
    rs = S.get(key)
    for i in range(n):
        yy = y0 + (y1 - y0) * (i + 0.5) / n
        for sg in (-1, 1):
            if b.detail == 1 and i % 2:
                continue
            h = rs.uniform(8, 11) if kind != 'conifer' else rs.uniform(9, 12)
            lib.tree(b, kind, x + sg * gap, yy, h, S.get('%s%d%d' % (key, i, sg)), lk)


def box_hedge_rect(b, S, x0, y0, x1, y1, h=0.7, w=0.55, col='#3f6f3a', key='bh'):
    hedge_row(b, S, [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)], h=h, w=w, col=col, key=key)


def parterre(b, S, x0, y0, x1, y1, key='pt'):
    """A clipped-hedge parterre: hedged rectangle with gravel paths and flower beds."""
    if b.detail >= 2:
        return
    rs = S.get(key)
    with b.site():
        b.face([(x0, y0, 0.06), (x1, y0, 0.06), (x1, y1, 0.06), (x0, y1, 0.06)], 'paving', '#cbbf9f', scale=1.5)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        beds = [(x0 + 0.5, y0 + 0.5, cx - 0.4, cy - 0.4), (cx + 0.4, y0 + 0.5, x1 - 0.5, cy - 0.4), (x0 + 0.5, cy + 0.4, cx - 0.4, y1 - 0.5), (cx + 0.4, cy + 0.4, x1 - 0.5, y1 - 0.5)]
        for (a, bb, c, d) in beds:
            b.face([(a, bb, 0.1), (c, bb, 0.1), (c, d, 0.1), (a, d, 0.1)], 'grass', rs.choice(['#7fb05a', '#b8586a', '#d9b43a', '#8a6fb0']), scale=1.0)
    if b.detail == 0:
        for (a, bb, c, d) in beds:
            box_hedge_rect(b, S, a, bb, c, d, h=0.5, w=0.4, key=key + 'h')
        for sx in (x0 + 0.5, x1 - 0.5):
            topiary(b, sx, (y0 + y1) / 2)


def topiary(b, x, y, h=2.0, col='#3d6f38'):
    if b.detail >= 2:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, 0.5, 0.18, n=5, slot='timber', col='#6b5240', top=False)
        lib.cylinder(b, x, y, 0.4, h, 0.7, n=7 if b.detail == 0 else 5, slot='plain', col=col, r_top=0.05, top=False, smooth=False)


def gate_piers(b, lk, cx, y, gap=5.0, col=None, h=2.6):
    if b.detail >= 2:
        return
    col = col or lk.trim_col
    with b.site():
        for sg in (-1, 1):
            U.box_c(b, cx + sg * (gap / 2 + 0.45), y, 0, 0.9, 0.9, h, 'stone-blocks', col, top_col=lib.shade(col, 0.9), skip=('bottom',))
            if b.detail == 0:
                lib.blob(b, cx + sg * (gap / 2 + 0.45), y, h + 0.3, 0.38, 0.38, 0.38, lib.shade(col, 0.95), n=6, rings=3)


def lodge(b, lk, x, y, w=5.0, d=4.5):
    """A small gate lodge / watch house: hipped roof."""
    if b.detail >= 2:
        U.box_c(b, x, y, 0, w, d, 4.0, 'plain', lk.wall_col, skip=('bottom',))
        return
    fp = lib.fp_rect(w, d, x, y)
    for seg in fp.edges():
        U.plain(b, seg, 0, seg.length, 0, 3.0, lk.wall_slot, lk.wall_col)
        if b.detail == 0 and seg.front:
            b.face([seg.P(seg.length / 2 - 0.5, 0.0, -0.04), seg.P(seg.length / 2 + 0.5, 0.0, -0.04), seg.P(seg.length / 2 + 0.5, 2.1, -0.04), seg.P(seg.length / 2 - 0.5, 2.1, -0.04)], 'plain', '#4a3a2c', mode='fit')
    lib.roof(b, 'hip', fp, 3.0, lk, pitch=26, ov=0.5 if b.detail < 2 else 0.3, roof_slot=lk.roof_slot, roof_col=lk.roof_col)


def outbuilding(b, lk, x, y, w=6.0, d=3.6, h=2.6):
    """A boys'-quarters / generator house: low block with a mono-pitch corrugated roof."""
    if b.detail >= 2:
        return
    U.box_c(b, x, y, 0, w, d, h, 'plain-render', lib.shade(lk.wall_col, 0.95), skip=('bottom', 'top'))
    pts = [(x - w / 2 - 0.3, y - d / 2 - 0.4, h), (x + w / 2 + 0.3, y - d / 2 - 0.4, h), (x + w / 2 + 0.3, y + d / 2 + 0.3, h + 0.6), (x - w / 2 - 0.3, y + d / 2 + 0.3, h + 0.6)]
    b.facing(pts, (0, -0.2, 1), 'corrugated', lk.roof_col, scale=1.5)


def garden_estate(b, lk, P, S, info):
    """Country-house park: avenue of trees up a long drive, gravel forecourt, gate lodge, scattered tree clumps, no road strip."""
    feats = P['feats']
    bx0, bx1, yf, yb = info['bx0'], info['bx1'], info['yf'], info['yb']
    x0p, x1p = max(bx0 - 22, -56.0), min(bx1 + 22, 56.0)
    y0p, y1p = yf - 42.0, yb + 14.0
    if y1p - y0p > 112:
        y0p = y1p - 112
    dcx = (bx0 + bx1) / 2
    b.section('lawn')
    lib.ground(b, x0p, y0p, x1p, y1p, lk, 'grass', '#6f9a52')
    with b.site():
        b.face([(x0p, y0p + 12, 0.02), (x1p, y0p + 12, 0.02), (x1p, y1p, 0.02), (x0p, y1p, 0.02)], 'grass', '#7ba35c', scale=4.0)
    b.section('drive')
    gy = y0p + 3.0
    dw = 4.2
    with b.site():
        b.face([(dcx - dw / 2, gy, 0.05), (dcx + dw / 2, gy, 0.05), (dcx + dw / 2, yf - 7.0, 0.05), (dcx - dw / 2, yf - 7.0, 0.05)], 'paving', '#c9bfa8', scale=1.5)
        fw = U.clamp((bx1 - bx0) * 0.75, 14, 36)
        b.face([(dcx - fw / 2, yf - 9.0, 0.05), (dcx + fw / 2, yf - 9.0, 0.05), (dcx + fw / 2, yf, 0.05), (dcx - fw / 2, yf, 0.05)], 'paving', '#c9bfa8', scale=1.5)
    if 'fountain' in feats:
        fountain(b, dcx, yf - 15.0, r=3.2)
    kind = tree_kind(lk, P, ['broadleaf', 'conifer']) or 'broadleaf'
    avenue(b, lk, S, dcx, gy + 6, yf - 12.0, 7, kind, gap=5.0)
    # gate with piers, lodge, low boundary
    gate_piers(b, lk, dcx, gy, 5.0)
    lodge(b, lk, dcx + 8.5, gy + 1.5)
    if 'fence-wall' in feats or 'gate' in feats:
        U.fence(b, lk, [(x0p + 1, gy), (dcx - 3, gy)], h=1.9, col=lk.trim_col, solid=0.6)
        U.fence(b, lk, [(dcx + 3, gy), (x1p - 1, gy)], h=1.9, col=lk.trim_col, solid=0.6)
    else:
        hedge_row(b, S, [(x0p + 1, gy), (dcx - 3, gy)], key='e1', h=1.4)
        hedge_row(b, S, [(dcx + 3, gy), (x1p - 1, gy)], key='e2', h=1.4)
    b.section('park')
    rs = S.get('park')
    if kind:
        for g in range(4):
            gx = (x0p + 8 + rs.uniform(0, 18)) if g % 2 == 0 else (x1p - 8 - rs.uniform(0, 18))
            gy2 = rs.uniform(y0p + 18, yb + 6)
            for t in range(3 if b.detail == 0 else 1):
                lib.tree(b, kind, gx + rs.uniform(-4, 4), gy2 + rs.uniform(-4, 4), rs.uniform(9, 13), S.get('pk%d%d' % (g, t)), lk)
    if 'statue' in feats:
        statue(b, dcx + 12, yf - 8.0, 2.8)
    return (x0p, y0p, x1p, y1p)


def garden_formal(b, lk, P, S, info):
    """Walled formal garden: clipped parterres either side of a gravel walk, topiary, iron railings and a gate, side hedges."""
    feats = P['feats']
    bx0, bx1, yf, yb = info['bx0'], info['bx1'], info['yf'], info['yb']
    x0p, x1p = max(bx0 - 14, -56.0), min(bx1 + 14, 56.0)
    y0p, y1p = yf - 34.0, yb + 12.0
    dcx = (bx0 + bx1) / 2
    b.section('lawn')
    lib.ground(b, x0p, y0p, x1p, y1p, lk, 'grass', '#6f9a52')
    gy = y0p + 3.0
    with b.site():
        b.face([(dcx - 1.8, gy, 0.05), (dcx + 1.8, gy, 0.05), (dcx + 1.8, yf, 0.05), (dcx - 1.8, yf, 0.05)], 'paving', '#c9bfa8', scale=1.5)
    b.section('parterre')
    py0, py1 = gy + 5.0, yf - 6.0
    if py1 - py0 > 8:
        pw = U.clamp((x1p - x0p) * 0.28, 7, 14)
        n_p = 2 if py1 - py0 > 24 else 1
        for i in range(n_p):
            ya, yb_ = py0 + (py1 - py0) * i / n_p + 1.0, py0 + (py1 - py0) * (i + 1) / n_p - 1.0
            for sg in (-1, 1):
                xa = dcx + sg * 3.0 if sg > 0 else dcx - 3.0 - pw
                parterre(b, S, xa, ya, xa + pw, yb_, key='pt%d%d' % (i, sg))
    if 'fountain' in feats:
        fountain(b, dcx, (py0 + py1) / 2, r=2.8)
    b.section('boundary')
    pts = [(x0p + 1, y1p - 1), (x0p + 1, gy), (x1p - 1, gy), (x1p - 1, y1p - 1)]
    U.fence(b, lk, pts, h=2.2, col=lk.trim_col, solid=0.5, gate=(1, (dcx - (x0p + 1)) / (x1p - x0p - 2), 4.0))
    gate_piers(b, lk, dcx, gy, 4.0, col=lk.trim_col)
    kind = tree_kind(lk, P, ['broadleaf', 'conifer']) or 'broadleaf'
    rs = S.get('fg')
    for k in range(6 if b.detail == 0 else 3):
        sg = -1 if k % 2 == 0 else 1
        tx = (x0p + 4 + rs.uniform(0, 4)) if sg < 0 else (x1p - 4 - rs.uniform(0, 4))
        lib.tree(b, kind, tx, rs.uniform(gy + 6, yb + 8), rs.uniform(8, 12), S.get('ft%d' % k), lk)
    hedge_row(b, S, [(x0p + 3, y1p - 3), (x0p + 3, gy + 3)], key='fh1', h=1.6, w=1.0)
    hedge_row(b, S, [(x1p - 3, y1p - 3), (x1p - 3, gy + 3)], key='fh2', h=1.6, w=1.0)
    if 'statue' in feats:
        statue(b, dcx + 6, (py0 + py1) / 2, 2.8)
    return (x0p, y0p, x1p, y1p)


def garden_compound(b, lk, P, S, info):
    """Tropical walled compound: laterite yard, wall with gate and gatehouse, drive to the veranda, shade trees, outbuildings, a car."""
    feats = P['feats']
    bx0, bx1, yf, yb = info['bx0'], info['bx1'], info['yf'], info['yb']
    x0p, x1p = max(bx0 - 11, -56.0), min(bx1 + 11, 56.0)
    y0p, y1p = yf - 26.0, yb + 10.0
    dcx = (bx0 + bx1) / 2
    b.section('yard')
    lib.ground(b, x0p, y0p, x1p, y1p, lk)
    road_y1 = y0p + 6.5
    lib.forecourt(b, 'road', x0p + 0.3, y0p + 0.5, x1p - 0.3, road_y1, lk, S.get('road'))
    gy = road_y1 + 1.5
    with b.site():
        b.face([(dcx - 2.2, gy, 0.05), (dcx + 2.2, gy, 0.05), (dcx + 2.2, yf, 0.05), (dcx - 2.2, yf, 0.05)], 'laterite' if lk.ground_slot != 'laterite' else 'paving', '#b9926e' if lk.ground_slot != 'laterite' else '#c9bfa8', scale=2.0)
        if yf - gy > 12:
            b.face([(bx0 + 2, yf - 6.0, 0.05), (bx1 - 2, yf - 6.0, 0.05), (bx1 - 2, yf - 1.0, 0.05), (bx0 + 2, yf - 1.0, 0.05)], 'laterite' if lk.ground_slot != 'laterite' else 'paving', '#b9926e' if lk.ground_slot != 'laterite' else '#c9bfa8', scale=2.0)
    b.section('wall')
    wallc = lk.wall_col if lk.wall_slot in ('plain-render', 'brick') else '#e6dcc4'
    pts = [(x0p + 1, y1p - 1), (x0p + 1, gy), (x1p - 1, gy), (x1p - 1, y1p - 1)]
    U.fence(b, lk, pts, h=2.4, col=wallc, solid=1.8, gate=(1, (dcx - (x0p + 1)) / (x1p - x0p - 2), 4.6), pillar_every=5.0)
    gate_piers(b, lk, dcx, gy, 4.6, col=wallc, h=3.0)
    lodge(b, lk, dcx + 8.0, gy + 3.4, 3.4, 3.0)
    b.section('trees')
    rs = S.get('cm')
    kind = lk.tree if lk.tree not in (None, 'none') else 'broadleaf'
    for k in range(6 if b.detail == 0 else 3):
        sg = -1 if k % 2 == 0 else 1
        tx = (x0p + 4 + rs.uniform(0, 6)) if sg < 0 else (x1p - 4 - rs.uniform(0, 6))
        lib.tree(b, kind, tx, rs.uniform(gy + 5, yb + 6), rs.uniform(7, 11), S.get('ct%d' % k), lk)
    if kind != 'palm':
        for k in range(2):
            lib.tree(b, 'palm', dcx + (-1 if k else 1) * 6.5, gy + 7 + 6 * k, 8.0, S.get('cp%d' % k), lk)
    b.section('outbuildings')
    outbuilding(b, lk, x0p + 7.0, yb + 3.5)
    if 'water-tank' in feats:
        U.water_tank(b, x1p - 6.0, yb + 4.0, 0.0, 1.3, 2.4)
    if b.detail < 2:
        lib.car(b, bx1 + 5.0, yf - 4.0, math.pi / 2, S.get('cm').choice(['#c9ccd0', '#8a1f1f', '#27456e']), S.get('cm'))
    if b.detail == 0:
        hedge_row(b, S, [(bx0 + 1, yf - 0.8), (bx1 - 1, yf - 0.8)], h=0.5, w=0.5, col='#4f7d3b', key='vh')
    if 'statue' in feats:
        statue(b, bx0 - 4.0, yf - 4.0, 2.8, kind='abstract' if has(P['txt'], 'abstract', 'sculpt', 'art') else None)
        statue(b, bx1 + 4.0, yf - 6.0, 2.4)
    if 'flags' in feats:
        U.flagpole(b, dcx + 4, yf - 4.0, 9.0, '#0b7a43')
    return (x0p, y0p, x1p, y1p)


def garden_courtyard(b, lk, P, S, info):
    """Mediterranean / central-European palace grounds: paved court and forecourt, cypress rows, wall and gate arch, no lawn."""
    feats = P['feats']
    bx0, bx1, yf, yb = info['bx0'], info['bx1'], info['yf'], info['yb']
    x0p, x1p = max(bx0 - 9, -56.0), min(bx1 + 9, 56.0)
    y0p, y1p = yf - 24.0, yb + 8.0
    dcx = (bx0 + bx1) / 2
    b.section('court')
    lib.ground(b, x0p, y0p, x1p, y1p, lk, 'paving', '#b9ae98', scale=1.5)
    lib.forecourt(b, 'road', x0p + 0.3, y0p + 0.5, x1p - 0.3, y0p + 6.5, lk, S.get('road'))
    gy = y0p + 8.0
    wallc = lk.wall_col if lk.wall_slot in ('plain-render', 'brick', 'stone-blocks') else '#d9cdb0'
    pts = [(x0p + 1, y1p - 1), (x0p + 1, gy), (x1p - 1, gy), (x1p - 1, y1p - 1)]
    U.fence(b, lk, pts, h=2.8, col=wallc, solid=2.4, gate=(1, (dcx - (x0p + 1)) / (x1p - x0p - 2), 5.0))
    gate_piers(b, lk, dcx, gy, 5.0, col=wallc, h=3.2)
    # cypress rows along the walk and planters in the forecourt
    rs = S.get('cy')
    n = int(U.clamp((yf - gy - 4) / 5.5, 2, 6))
    for i in range(n):
        yy = gy + 4 + (yf - gy - 8) * (i + 0.5) / n
        for sg in (-1, 1):
            if b.detail >= 2:
                continue
            lib.tree(b, 'conifer', dcx + sg * 5.0, yy, rs.uniform(7, 9), S.get('cy%d%d' % (i, sg)), lk)
    if b.detail == 0:
        for sg in (-1, 1):
            for k in range(3):
                bxx = dcx + sg * (9 + 4 * k)
                lib.cylinder(b, bxx, yf - 4.0, 0, 0.8, 0.7, n=8, slot='rough-concrete', col='#a9855f', r_top=0.6, top=True, smooth=False)
                lib.blob(b, bxx, yf - 4.0, 1.4, 0.7, 0.7, 0.6, '#4f7d3b', n=6, rings=3)
    if 'fountain' in feats:
        fountain(b, dcx, (gy + yf) / 2, r=3.0)
    # courtyard of a U / ring plan: trees and a well-head in the court
    kindt = lk.tree if lk.tree not in (None, 'none') else 'broadleaf'
    for k in range(5 if b.detail == 0 else 2):
        sg = -1 if k % 2 == 0 else 1
        lib.tree(b, kindt, (x0p + 4 if sg < 0 else x1p - 4) + rs.uniform(-1, 1), rs.uniform(gy + 8, y1p - 3), rs.uniform(7, 10), S.get('co%d' % k), lk)
    if 'statue' in feats:
        statue(b, dcx + 8, (gy + yf) / 2, 2.8)
    return (x0p, y0p, x1p, y1p)


def garden_cottage(b, lk, P, S, info):
    """Small house plot: hedge or picket fence, a short path, lawn and flower beds, a shed, two or three trees; a lane in front."""
    feats = P['feats']
    bx0, bx1, yf, yb = info['bx0'], info['bx1'], info['yf'], info['yb']
    x0p, x1p = max(bx0 - 8, -56.0), min(bx1 + 8, 56.0)
    y0p, y1p = yf - 18.0, yb + 9.0
    dcx = (bx0 + bx1) / 2
    b.section('lawn')
    lib.ground(b, x0p, y0p, x1p, y1p, lk, 'grass', '#6f9a52' if lk.ground_slot not in ('laterite', 'sand') else lk.ground_col)
    lib.forecourt(b, 'road', x0p + 0.3, y0p + 0.5, x1p - 0.3, y0p + 5.5, lk, S.get('road'))
    gy = y0p + 6.5
    with b.site():
        b.face([(dcx - 0.9, gy, 0.05), (dcx + 0.9, gy, 0.05), (dcx + 0.9, yf, 0.05), (dcx - 0.9, yf, 0.05)], 'paving', '#c9bfa8', scale=1.5)
    wall_on = 'fence-wall' in feats or 'gate' in feats
    pts = [(x0p + 1, y1p - 1), (x0p + 1, gy), (x1p - 1, gy), (x1p - 1, y1p - 1)]
    if wall_on:
        U.fence(b, lk, pts, h=1.5, col=lk.trim_col, solid=0.5, gate=(1, (dcx - (x0p + 1)) / (x1p - x0p - 2), 2.2), pillar_every=3.0)
    else:
        hedge_row(b, S, [(x0p + 1, y1p - 1), (x0p + 1, gy), (dcx - 1.2, gy)], h=1.1, w=0.9, key='ch1')
        hedge_row(b, S, [(dcx + 1.2, gy), (x1p - 1, gy), (x1p - 1, y1p - 1)], h=1.1, w=0.9, key='ch2')
    b.section('beds')
    rs = S.get('ck')
    if b.detail < 2:
        with b.site():
            for sg in (-1, 1):
                ax = dcx + sg * 3.0
                b.face([(ax - 1.4, yf - 3.6, 0.08), (ax + 1.4, yf - 3.6, 0.08), (ax + 1.4, yf - 1.0, 0.08), (ax - 1.4, yf - 1.0, 0.08)], 'grass', rs.choice(['#b8586a', '#d9b43a', '#8a6fb0', '#e8903a']), scale=1.0)
    kind = lk.tree if lk.tree not in (None, 'none') else 'broadleaf'
    for k in range(3 if b.detail == 0 else 1):
        sg = -1 if k % 2 == 0 else 1
        tx = (x0p + 4) if sg < 0 else (x1p - 4)
        lib.tree(b, kind, tx + rs.uniform(-1, 1), rs.uniform(gy + 5, y1p - 3), rs.uniform(6, 9), S.get('kt%d' % k), lk)
    outbuilding(b, lk, x1p - 6.0, y1p - 4.0, 3.2, 2.6, 2.4)
    if 'statue' in feats:
        statue(b, bx0 - 3.0, yf - 4.0, 2.6)
    if 'pavilion' in feats:
        U.thatched_pavilion(b, lk, bx1 + 5.5, (yf + yb) / 2, 2.4, thatch=False)
    return (x0p, y0p, x1p, y1p)


def garden(b, lk, P, S, info):
    if b.detail >= 2:
        return None
    kind = pick_setting(P, lk, S)
    P['garden'] = kind
    fn = {'estate': garden_estate, 'formal': garden_formal, 'compound': garden_compound, 'courtyard': garden_courtyard, 'cottage': garden_cottage}[kind]
    out = fn(b, lk, P, S, info)
    feats = P['feats']
    if 'signage-board' in feats:
        with b.site():
            lib.sign_board(b, (info['bx0'] + info['bx1']) / 2 + 6.0, info['yf'] - 8.0, 0.0, 4.0, 1.5, lk, 0.0, col='#2f5f4a')
    return out


def build(brief, style, rng, detail):
    b = lib.Builder('manor', detail)
    S = U.Streams(rng)
    brief = U.sane(brief)
    style = style if isinstance(style, dict) else {}
    lk = lib.look(brief, style, S.get('look'))
    P = plan(brief, style, lk, S)
    typ = P['typ']
    fn = {'tudor': build_tudor, 'georgian': build_georgian, 'colonial': build_colonial, 'castle': build_castle, 'bungalow': build_bungalow, 'house': build_house}[typ]
    fp, info = fn(b, lk, P, S)
    garden(b, lk, P, S, info)
    return b.objects()
