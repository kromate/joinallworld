"""hospital: five typologies chosen from the brief (footprint, size, storeys, style, era, wording, features)

  clinic    small single-storey clinic / health centre: hip or gable roof, veranda, porch, red-cross board, water tank, fence
  pavilion  colonial pavilion hospital: admin block with gabled porch, ward wings with deep verandas, ridge monitors, linked by
            covered walks, incinerator chimney
  block     modernist / international / contemporary multi-wing block (H, U, L, rect): entrance block with canopy or glass atrium,
            ribbon / curtain / punched windows, ambulance bay, roof plant, tank, helipad
  soviet    long heavy slab with taller central block and a rhythm of tall punched windows, stair towers
  tower     six storeys or more: podium plus stepped slab (art-deco brick and stone, or a glass medical tower)

Layout (metres): centred on x = 0, y = 0; main facade towards -Y; ambulance bay at one end; tank, chimney and helipad behind.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _hospital_util as U  # noqa: E402
import lib  # noqa: E402
from lib import shade, mix  # noqa: E402

FEATURES = {'red-cross-sign', 'ambulance-bay', 'car-park', 'water-tank', 'fence-wall', 'flat-canopy', 'canopy-walkway', 'signage-board', 'awning',
            'solar-panels', 'balcony-bands', 'helipad', 'arcade', 'gate', 'louvres', 'flags', 'atrium-glass', 'colonnade', 'sheds', 'arches',
            'steps', 'portico', 'chimney', 'bell-tower', 'brise-soleil', 'podium', 'courtyard', 'pilotis', 'setback-tiers', 'curved-canopy'}


# ------------------------------------------------------------------------------------------------------------- inference
def infer(brief, rng):
    form = brief.get('form') or {}
    txt = U.text(brief)
    F = U.feats(brief)
    style = brief.get('style') or ''
    w, d, st, h = U.dims(brief, 40, 18, 2, st_h=3.8)
    fp = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    yr = U.era_year(brief)
    var = str(form.get('variant') or '').lower()
    old = (0 < yr < 1960) or U.has(txt, 'colonial', 'pavilion', 'cottage')
    if var in ('clinic', 'pavilion', 'block', 'soviet', 'tower'):
        typ = var
    elif st >= 6 or h >= 26:
        typ = 'tower'
    elif style == 'soviet':
        typ = 'soviet'
    elif w < 46 and st <= 2 and (d <= 26 or U.has(txt, 'clinic', 'health cent', 'dispensary')):
        typ = 'clinic'
    elif style in ('colonial', 'georgian', 'victorian') and st <= 2 and roof in ('hip', 'gable'):
        typ = 'pavilion'
    elif old and st <= 2 and roof in ('hip', 'gable') and w >= 46:
        typ = 'pavilion'
    elif style == 'vernacular' and st <= 2 and roof in ('hip', 'gable'):
        typ = 'pavilion' if w >= 60 else 'clinic'
    else:
        typ = 'block'
    return typ, (w, d, st, h)


def _window_kind(brief, lk, default='ribbon'):
    wk = (brief.get('facade') or {}).get('windows')
    return wk if wk in ('curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre') else default


# --------------------------------------------------------------------------------------------------------------- shared
def _entrance_sign(b, lk, x, y, F, brief, srng, size=2.6):
    """Free-standing red-cross sign board on two posts (road side) and optionally 'signage-board' pylon."""
    if b.detail >= 2:
        return
    with b.site():
        if b.detail == 0:
            for sx in (-1, 1):
                lib.cylinder(b, x + sx * 1.35, y, 0, 3.4, 0.07, n=5, slot='frame', col='#8d9298', r_top=0.07, top=False)
        lib.box_c(b, x, y, 2.2, 3.0, 0.18, 2.4, 'plain', '#f4f4f1', skip=('bottom',))
    if 'red-cross-sign' in F:
        with b.site():
            U.red_cross(b, x, y - 0.12, 3.4, 1.45, (0, -1, 0))


def _wall_cross(b, lk, x, z, y_wall, size=2.4):
    U.red_cross(b, x, y_wall - 0.02, z, size, (0, -1, 0))


def _site_common(b, lk, brief, F, srng, bbox, fp_front_y, cx, typ, w, d, ambulance_at=None, tank_at=None, flags_n=0, gate=True, pad_front=18.0):
    x0, y0, x1, y1 = bbox
    forecourt = lk.forecourt
    if 'car-park' in F and forecourt in (None, 'none', 'plaza', 'garden'):
        forecourt = 'parking' if forecourt in (None, 'none') else forecourt
    px = U.pad(b, lk, brief, bbox, srng, front=pad_front, side=7.0, back=7.0, forecourt=forecourt if forecourt != 'plaza' else 'plaza', tree_h=7.5 if typ == 'clinic' else 9.0,
               trees=5 if typ != 'clinic' else 4)
    if 'fence-wall' in F or 'gate' in F:
        gx = cx
        U.fence_wall(b, lk, px[0] + 0.5, px[1] + 0.5, px[2] - 0.5, px[3] - 0.5, gate_x=gx, gate_w=7.5 if typ != 'clinic' else 5.0,
                     h=1.9 if typ != 'clinic' else 1.7, kind='railing' if lk.wall_material in ('glass-curtain', 'metal-cladding') or srng.random() < 0.35 else 'wall',
                     col=shade(lk.wall_col, 0.96), sides=True, back=True)
    if 'water-tank' in F:
        tx, ty = tank_at if tank_at else (x1 + 6, y1 - 4)
        U.tank_tower(b, tx, ty, h=8.5 if typ != 'clinic' else 6.5, r=1.7 if typ != 'clinic' else 1.3, tank_col=srng.choice(['#1f3f66', '#2d5a3d', '#7b2d26', '#3a3d42']))
    return px


# --------------------------------------------------------------------------------------------------------------- clinic
def _clinic(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    h = U.clamp(h, 3.4, 9.0) if st <= 1 else h
    bd = U.clamp(min(d, 11.5) if fpk == 'L' else d, 7.0, 16.0)
    ww = U.clamp(w * 0.28, 7.5, 12.0)
    rects = U.plan_rects(fpk if fpk in ('rect', 'L', 'U', 'T') else 'rect', w, d if fpk != 'L' else d, bar_d=bd, wing_w=ww, side='left' if srng.random() < 0.4 else 'right')
    fp = U.union_fp([r[:4] for r in rects])
    bb = U.bbox_of(rects)
    z1 = h
    roof = form.get('roof') or 'hip'
    if roof == 'flat' and st == 1 and lk.roof_mat in ('metal-sheet', 'corrugated', 'clay-tile'):
        roof = 'hip'
    wk = _window_kind(brief, lk, 'punched')
    bay = 3.6 * (1 + 0.45 * coarse)
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=U.clamp(lk.ratio, 0.12, 0.35), bay=bay, plinth=0.5)
    U.plinth_band(b, fp, lk, 0.7)
    b.section('roof')
    if roof == 'flat':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.7)
    else:
        U.roof_rects(b, roof, rects, z1, lk, pitch=22 if lk.roof_slot in ('corrugated', 'metal-roof') else 27, ov=0.7)
    # eaves board + veranda along the front of the bar
    bar = rects[0]
    cx = (bar[0] + bar[2]) / 2
    b.section('veranda')
    vd = 2.3
    if roof != 'flat':
        U.veranda(b, lk, (bar[0] + 0.0, bar[1]), (bar[2], bar[1]), 0.0, 2.75, vd, z1 - 0.35, post='square', pitch_m=2.8, col=lk.trim_col)
        # gable-fronted porch over the entrance
        pw = 4.4
        if b.detail < 2:
            lib.box(b, cx - pw / 2, bar[1] - vd - 0.35, 0, cx + pw / 2, bar[1] - vd - 0.35 + 0.35, 2.9, lk.wall_slot, lk.trim_col, skip=('bottom', 'back'))
            U.pediment(b, cx - pw / 2 - 0.2, cx + pw / 2 + 0.2, bar[1] - vd - 0.35, bar[1] - 0.1, 2.9, 1.1, lk, slot=lk.roof_slot, col=lk.roof_col, face_col=lk.trim_col)
    else:
        U.entrance_canopy(b, lk, cx - 3.5, cx + 3.5, bar[1], 3.0, 3.2, columns=2)
    seg = lib.Seg((bar[0], bar[1]), (bar[2], bar[1]))
    U.door(b, seg, (bar[2] - bar[0]) / 2, 1.8, 2.3, frame=lk.trim_col)
    b.section('site')
    # ambulance bay: small flat canopy on the end of the bar + van
    if 'ambulance-bay' in F:
        x_amb = bar[2] + 1.0 if fpk != 'L' else bar[0] - 1.0
        sgn = 1 if fpk != 'L' else -1
        ax0, ax1 = (bar[2] - 1.0, bar[2] + 5.0) if sgn == 1 else (bar[0] - 5.0, bar[0] + 1.0)
        with b.site():
            pass
        lib.canopy_flat(b, ax0, bar[1] - 4.8, ax1, bar[1] + 0.5, 3.0, lk, th=0.3, columns=[(ax1 - 0.4 if sgn == 1 else ax0 + 0.4, bar[1] - 4.3)], col=lk.roof_col, r=0.15)
        U.ambulance(b, (ax0 + ax1) / 2, bar[1] - 2.4, math.pi / 2 * (1 if srng.random() < 0.5 else -1))
    px = _site_common(b, lk, brief, F, srng, bb, bar[1], cx, 'clinic', w, d, tank_at=(bb[2] + 4.5, bb[3] - 3))
    if 'red-cross-sign' in F:
        _entrance_sign(b, lk, bb[0] + 3.5 if cx > 0 else cx + (bar[2] - bar[0]) * 0.32, px[1] + 2.2, F, brief, srng)
    if 'solar-panels' in F and roof == 'flat':
        U.solar_row(b, lk, (bar[0], bar[1], bar[2], bar[3]), z1 + 0.3, rng, 1)
    if 'flags' in F:
        U.flags(b, lk, [cx - 4.5], bar[1] - 7.0, 7.5, U.flag_cols(brief, lk, srng))
    if 'sheds' in F or 'awning' in F and srng.random() < 0.0:
        pass
    return bb


# ------------------------------------------------------------------------------------------------------------ pavilion
def _pavilion(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    st = min(st, 2)
    ward_w = U.clamp(w * 0.13, 10.0, 13.0)
    bd = U.clamp(d * 0.28, 11.0, 16.0)
    if fpk not in ('rect', 'L', 'U', 'H'):
        fpk = 'E'
    if fpk == 'rect':
        rects = U.plan_rects('rect', w, min(d, 24), None)
    else:
        rects = U.plan_rects(fpk, w, d, None, bar_d=bd, wing_w=ward_w, wings=3 if w >= 90 else 2)
    bar = rects[0]
    wards = [r for r in rects if r[4] == 'wing']
    bb = U.bbox_of(rects)
    cx = (bar[0] + bar[2]) / 2
    z_bar = U.clamp(h, 6.0, 10.0) if st == 2 else 5.4
    z_ward = 4.8
    roofk = form.get('roof') or 'hip'
    if roofk not in ('hip', 'gable'):
        roofk = 'hip'
    tiled = lk.roof_slot in ('clay-tile', 'slate')
    pitch = 28 if tiled else 20
    wk = _window_kind(brief, lk, 'arched' if lk.windows != 'punched' else 'punched')
    if wk not in ('arched', 'punched'):
        wk = 'punched'
    bay = 3.8 * (1 + 0.45 * coarse)
    ratio = U.clamp(lk.ratio, 0.2, 0.34)
    b.section('walls')
    # admin bar (taller) and wards (single storey) built as separate unions
    bar_fp = U.union_fp([bar[:4]])
    mass_others = [r[:4] for r in wards]
    U.mass_walls(b, lk, bar_fp, 0, z_bar, st, others=mass_others if st == 1 else [], rng=rng, kind=wk, ratio=ratio, bay=bay, plinth=0.6)
    wards_fp = None
    if wards:
        wards_fp = U.union_fp([r[:4] for r in wards])
        U.mass_walls(b, lk, wards_fp, 0, z_ward, 1, others=[bar[:4]], rng=rng, kind=wk, ratio=ratio, bay=bay, plinth=0.6)
    U.plinth_band(b, bar_fp, lk, 0.7)
    if wards_fp:
        U.plinth_band(b, wards_fp, lk, 0.7)
    b.section('roof')
    lib.roof(b, roofk, bar_fp, z_bar, lk, pitch=pitch, ov=0.8)
    for r in wards:
        lib.roof(b, roofk, (r[0], r[1], r[2], r[3]), z_ward, lk, pitch=pitch, ov=0.9)
        # ridge monitor (ventilating clerestory) along each ward
        if b.detail == 0:
            run = (r[2] - r[0]) / 2
            rise = run * math.tan(pitch * math.pi / 180)
            ry0, ry1 = r[1] + run + 1.0, r[3] - run - 1.0
            if ry1 - ry0 > 3 and roofk == 'hip':
                mx = (r[0] + r[2]) / 2
                lib.box(b, mx - 1.2, ry0, z_ward + rise - 0.3, mx + 1.2, ry1, z_ward + rise + 0.9, 'metal-cladding', shade(lk.trim_col, 0.85), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    b.section('porch')
    # gabled entrance porch on the bar
    pw = U.clamp((bar[2] - bar[0]) * 0.16, 6.0, 9.0)
    U.portico_front(b, lk, cx, bar[1], pw, 4.2, 0.55, 3.4 if st == 1 else 4.4, 4, pediment_rise=pw * 0.2, steps_n=3, col_r=0.22, kind='square', col=lk.trim_col, steps_w=pw * 0.6)
    seg = lib.Seg((bar[0], bar[1]), (bar[2], bar[1]))
    U.door(b, seg, (bar[2] - bar[0]) / 2, 2.0, 2.6, frame=lk.trim_col)
    b.section('verandas')
    # verandas on the bar front (flanking the porch) and on both long sides of every ward
    if st == 1 or True:
        vz = 2.7 if st == 1 else 3.0
        if st == 1:
            lx0, lx1 = bar[0], cx - pw / 2 - 0.5
            rx0, rx1 = cx + pw / 2 + 0.5, bar[2]
            for (xa, xb) in ((lx0, lx1), (rx0, rx1)):
                if xb - xa > 4:
                    U.veranda(b, lk, (xa, bar[1]), (xb, bar[1]), 0.0, vz, 2.4, z_bar - 0.4, post='square', pitch_m=3.0, col=lk.trim_col)
        else:
            # two-storey colonial bar: arcaded ground floor with a balcony gallery above
            for (xa, xb) in ((bar[0], cx - pw / 2 - 0.5), (cx + pw / 2 + 0.5, bar[2])):
                if xb - xa > 4:
                    _two_level_gallery(b, lk, (xa, bar[1]), (xb, bar[1]), z_bar, 2.4)
    for r in wards:
        L = r[3] - r[1]
        if L < 8:
            continue
        # left side (outward -X): travel +Y; right side (outward +X): travel -Y
        if not any(abs(o[2] - r[0]) < 0.01 and o[1] < r[3] and o[3] > r[1] for o in rects if o is not r):
            U.veranda(b, lk, (r[0], r[1] + 0.3), (r[0], r[3] - 0.3), 0.0, 2.7, 2.3, z_ward - 0.35, post='square', pitch_m=3.0, col=lk.trim_col)
        if not any(abs(o[0] - r[2]) < 0.01 and o[1] < r[3] and o[3] > r[1] for o in rects if o is not r):
            U.veranda(b, lk, (r[2], r[3] - 0.3), (r[2], r[1] + 0.3), 0.0, 2.7, 2.3, z_ward - 0.35, post='square', pitch_m=3.0, col=lk.trim_col)
    if len(wards) >= 2 and fpk in ('E', 'U'):
        # covered link across the back of the wards
        yb = max(r[3] for r in wards) + 3.0
        U.covered_walk(b, lk, (wards[0][0] + ward_w / 2, yb), (wards[-1][2] - ward_w / 2, yb), 2.9, 2.4)
        for r in wards:
            U.covered_walk(b, lk, ((r[0] + r[2]) / 2, r[3]), ((r[0] + r[2]) / 2, yb), 2.9, 2.4)
    if 'chimney' in F or lk.wall_material in ('brick', 'red-brick') or U.has(txt, 'incinerator'):
        cxx = bb[0] + 6 if srng.random() < 0.5 else bb[2] - 6
        cyy = bb[3] + 4
        if b.detail < 2:
            lib.cylinder(b, cxx, cyy, 0, 14, 0.9, n=10 if b.detail == 0 else 6, slot='brick', col=shade('#a9573e', srng.uniform(0.9, 1.05)), r_top=0.55, top=True, smooth=True)
    b.section('site')
    px = _site_common(b, lk, brief, F, srng, bb, bar[1], cx, 'pavilion', w, d, tank_at=(bb[2] + 5, bb[3] - 6), pad_front=22.0)
    if 'ambulance-bay' in F:
        x_amb = bb[2] - 2
        lib.canopy_flat(b, bb[2] - 4.5, bb[1] - 4.6, bb[2] + 3.0 - 0.2, bb[1] + 0.6, 3.1, lk, th=0.3, columns=[(bb[2] + 2.4, bb[1] - 4.0)], col=lk.roof_col, r=0.15)
        U.ambulance(b, bb[2] - 1.0, bb[1] - 2.3, math.pi / 2)
    if 'red-cross-sign' in F:
        _entrance_sign(b, lk, cx - 14, px[1] + 2.2, F, brief, srng)
    if 'flags' in F:
        U.flags(b, lk, [cx - 7, cx + 7], bar[1] - 10, 8.0, U.flag_cols(brief, lk, srng))
    if 'bell-tower' in F:
        lib.tower(b, cx, bar[1] + 6, z_bar, 3.2, 3.2, 6.0, lk, windows='punched', cap='hip', cap_rise=3.0, ratio=0.3) if b.detail < 2 else None
    return bb


def _two_level_gallery(b, lk, p0, p1, z_wall_top, depth):
    """Ground-floor posts + first-floor gallery with rail, under a lean-to roof (colonial two-storey verandas)."""
    seg = lib.Seg(p0, p1)
    L = seg.length
    zf = 3.4
    if b.detail >= 2:
        return
    # ground floor posts / arcade
    U.arcade(b, lk, p0, p1, 0, 2.3, zf - 0.2, depth, bay_w=3.2, pier_w=0.55, col=lk.trim_col, slab=True)
    # upper gallery: floor slab + rail + posts + roof
    cx, cy, _ = seg.P(L / 2, 0, -depth / 2)
    lib.obox(b, cx, cy, zf - 0.2, L, depth, 0.2, math.atan2(seg.u[1], seg.u[0]), lk.wall_slot, shade(lk.trim_col, 0.95), top_slot='roof-flat', top_col='#b9b4aa', skip=('bottom', 'back'))
    U.veranda(b, lk, p0, p1, zf, z_wall_top - 0.9, depth, z_wall_top - 0.4, post='square', pitch_m=3.2, r=0.1, col=lk.trim_col, floor=False, rail_h=0.95, slab_h=0.0)


# ---------------------------------------------------------------------------------------------------------------- block
def _block(b, lk, brief, F, txt, srng, rng, dims, coarse, soviet=False):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'rect'
    wk = _window_kind(brief, lk, 'ribbon')
    ratio = U.clamp(lk.ratio, 0.2, 0.62)
    st_h = U.clamp(h / max(1, st), 3.2, 4.4)
    z1 = st_h * st
    pitched = (form.get('roof') in ('hip', 'gable')) and not soviet
    ww = U.clamp(w * 0.16, 13.0, 17.5)
    bd = U.clamp(d * 0.3, 12.0, 17.0)
    if fpk == 'rect':
        dd = min(d, 22.0)
        rects = U.plan_rects('rect', w, dd)
        # real hospital slabs get a rear service wing when there is depth to spare
        if d > 28:
            rects = U.plan_rects('T', w, d, None, bar_d=16.0, wing_w=w * 0.3)
    elif fpk == 'cross':
        rects = U.plan_rects('H', w, d, None, bar_d=bd, wing_w=ww)
    else:
        rects = U.plan_rects(fpk if fpk in ('L', 'U', 'H', 'T', 'ring', 'irregular') else 'rect', w, d, None, bar_d=bd, wing_w=ww, side='left' if srng.random() < 0.4 else 'right',
                             open_to='back')
    bb = U.bbox_of(rects)
    bar = max(rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]) if r[4] == 'bar' else 0)
    cx = (bar[0] + bar[2]) / 2
    fp = U.union_fp([r[:4] for r in rects])
    b.section('walls')
    front_kind = wk
    ground_kind = None
    if style in ('contemporary', 'international') and not soviet:
        ground_kind = 'curtain' if st > 1 else None
    if soviet:
        wk, ratio = 'punched', U.clamp(lk.ratio, 0.22, 0.4)
    bay = (3.4 if wk == 'punched' else 4.2) * (1 + 0.45 * coarse)
    band = (0.5, shade(lk.trim_col, 0.95)) if (style in ('modernist', 'international') and b.detail == 0 and 'balcony-bands' in F) else None
    mass_wall_kw = dict(kind=wk, ratio=ratio, bay=bay, plinth=0.45, band=band)
    bar_rects = [r[:4] for r in rects if r[4] != 'wing']
    wing_rects = [r[:4] for r in rects if r[4] == 'wing']
    mode = srng.choice(['flat', 'flat', 'bar-up', 'wings-up', 'wings-down'])
    if st < 3 or soviet or pitched or not wing_rects:
        mode = 'flat'
    zw = z1
    if mode == 'bar-up':
        z1, zw = z1 + st_h, z1
    elif mode == 'wings-up':
        zw = z1 + st_h
    elif mode == 'wings-down':
        zw = z1 - st_h
    b.zw = zw
    if mode == 'flat':
        U.walls(b, fp, 0, z1, st, lk, rng, front_kind=front_kind, ground_kind=ground_kind, **mass_wall_kw)
        U.plinth_band(b, fp, lk, 0.9)
    else:
        fpb, fpw = U.union_fp(bar_rects), U.union_fp(wing_rects)
        U.mass_walls(b, lk, fpb, 0, z1, max(1, round(z1 / st_h)), others=wing_rects if zw > z1 else [], rng=rng, front_kind=front_kind, ground_kind=ground_kind, **mass_wall_kw)
        U.mass_walls(b, lk, fpw, 0, zw, max(1, round(zw / st_h)), others=bar_rects if z1 > zw else [], rng=rng, front_kind=front_kind, ground_kind=ground_kind, **mass_wall_kw)
        U.plinth_band(b, fpb, lk, 0.9)
        U.plinth_band(b, fpw, lk, 0.9)
    # floor-edge strings on the front for modernist slabs
    if b.detail == 0 and wk in ('ribbon', 'punched') and mode == 'flat':
        for s in fp.edges():
            if s.front and s.length > 18:
                for k in range(1, st):
                    lib.seg_box(b, s, 0, s.length, k * st_h - 0.14, k * st_h + 0.14, 0.07, shade(lk.trim_col, 0.98), lk.wall_slot)
    b.section('roof')
    if pitched:
        U.roof_rects(b, form.get('roof'), rects, z1, lk, pitch=24, ov=0.8)
    elif mode == 'flat':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.8 if not soviet else 0.5)
        if soviet:
            U.eaves_band(b, fp, z1 + 0.5, lk, 0.5, 0.45)
    else:
        lib.flat_roof(b, fpb, z1, lk, parapet_h=0.8)
        lib.flat_roof(b, fpw, zw, lk, parapet_h=0.8)
    # entrance block
    b.section('entrance')
    eb_w = U.clamp((bar[2] - bar[0]) * 0.2, 9.0, 16.0)
    eb_d = 7.5
    eb_st = min(2, st)
    eb_h = st_h * eb_st
    ey = bar[1]
    if fpk == 'H':
        ey = bar[1]
    atrium = 'atrium-glass' in F or style == 'contemporary'
    if not soviet:
        efp = lib.fp_rect(eb_w, eb_d, cx, ey - eb_d / 2)
        if atrium:
            lk_g = _glass_look(lk)
            U.walls(b, efp, 0, eb_h + 0.6, eb_st, lk_g, rng, kind='curtain', bay=3.2 * (1 + 0.45 * coarse), plinth=0, rear='same')
            lib.flat_roof(b, efp, eb_h + 0.6, lk, parapet_h=0.0, ov=0.5, slab=0.4, col=lk.accent_col if b.detail == 0 else lk.roof_col)
        else:
            U.walls(b, efp, 0, eb_h, eb_st, lk, rng, kind='punched' if wk == 'punched' else 'ribbon', ratio=0.3, bay=bay, plinth=0.3, rear='same')
            lib.flat_roof(b, efp, eb_h, lk, parapet_h=0.6, ov=0.4, slab=0.35)
        seg = lib.Seg((cx - eb_w / 2, ey - eb_d), (cx + eb_w / 2, ey - eb_d))
        U.door(b, seg, eb_w / 2, 3.0, 2.6, frame=lk.trim_col)
        # flat canopy projecting from the entrance block
        if 'flat-canopy' in F or 'curved-canopy' in F or True:
            cw = eb_w + 4.0
            if 'curved-canopy' in F:
                lib.canopy_curved(b, cx - cw / 2, ey - eb_d - 6.2, cx + cw / 2, ey - eb_d + 0.1, 4.0, 1.4, lk, th=0.3, axis='x',
                                  columns=[(cx - cw / 2 + 0.6, ey - eb_d - 5.6), (cx + cw / 2 - 0.6, ey - eb_d - 5.6)], col=lk.accent_col)
            else:
                U.entrance_canopy(b, lk, cx - cw / 2, cx + cw / 2, ey - eb_d, 4.0, 6.0, th=0.45, col=lk.roof_col, columns=2 if cw > 10 else 0, round_cols=srng.random() < 0.5)
        if 'red-cross-sign' in F:
            U.red_cross(b, cx, ey - eb_d - 0.02, eb_h - 1.55 if not atrium else eb_h + 0.9, 2.3 if w > 50 else 1.6, (0, -1, 0))
        # ramp / steps
        if b.detail < 2:
            lib.steps(b, cx - 3.0, cx + 3.0, ey - eb_d - 6.0, 0.45, 1.6, 3, 'paving', lk.stone_col)
    else:
        # soviet: taller central block with a portal
        cbw = U.clamp((bar[2] - bar[0]) * 0.28, 14.0, 28.0)
        cb_h = z1 + st_h * 1.2
        cfp = lib.fp_rect(cbw, bar[3] - bar[1], cx, (bar[1] + bar[3]) / 2)
        U.walls(b, cfp, z1 - 0.01, cb_h, 1, lk, rng, kind='punched', ratio=0.3, bay=bay * 1.4, plinth=0, rear='same')
        lib.flat_roof(b, cfp, cb_h, lk, parapet_h=0.5)
        U.eaves_band(b, cfp, cb_h + 0.5, lk, 0.5, 0.5)
        # pilaster-like piers + portal with a small portico
        s = lib.Seg((cx - cbw / 2, bar[1]), (cx + cbw / 2, bar[1]))
        U.piers(b, s, [cbw * k / 6 for k in range(1, 6)], 0, cb_h, 0.8, 0.25, lk.trim_col, lk.wall_slot)
        U.portico_front(b, lk, cx, bar[1], cbw * 0.5, 3.6, 0.5, 4.6, 6, pediment_rise=None, steps_n=4, col_r=0.38, kind='square', col=lk.trim_col, entab_h=1.2)
        U.door(b, s, cbw / 2, 3.2, 3.0, frame=lk.trim_col)
        if 'red-cross-sign' in F:
            U.red_cross(b, cx, bar[1] - 0.02, cb_h - 3.2, 2.6, (0, -1, 0))
    b.section('details')
    # balcony bands on the wing courtyard faces (access galleries): projecting slabs
    if 'balcony-bands' in F and b.detail == 0 and mode == 'flat':
        for s in fp.edges():
            if s.length > 14 and not s.front:
                for k in range(1, st):
                    lib.seg_box(b, s, 0, s.length, k * st_h - 0.12, k * st_h + 0.12, 1.2, shade(lk.trim_col, 0.95), lk.wall_slot)
                    lib.seg_box(b, s, 0, s.length, k * st_h + 0.12, k * st_h + 1.0, 1.2, mix(lk.trim_col, '#ffffff', 0.15), lk.wall_slot, inset=1.08)
    # brise-soleil fins on the front of wings
    if 'brise-soleil' in F and b.detail == 0 and mode == 'flat':
        for s in fp.edges():
            if s.front and s.length > 10 and not s.rear:
                n = int(s.length / 1.4)
                for k in range(n):
                    lib.seg_box(b, s, k * 1.4 + 0.5, k * 1.4 + 0.58, 0.5, z1 - 0.3, 0.45, shade(lk.accent_col, 0.9), lk.wall_slot)
    # roof plant, solar, helipad
    if not pitched:
        _roof_extras(b, lk, F, rects, z1, rng, srng, bb, st, coarse)
    if not pitched and not soviet:
        U.skyline(b, lk, bar_rects or [r[:4] for r in rects], z1, st_h, srng, rng, kind=wk, ratio=ratio, bay=bay)
    U.roof_variety(b, lk, bar_rects or [r[:4] for r in rects], z1, srng, st_h)
    # covered walkway linking
    if 'canopy-walkway' in F:
        wing = [r for r in rects if r[4] == 'wing']
        if wing:
            r = wing[0]
            lowx = cx - eb_w / 2 - 2.0
            U.covered_walk(b, lk, (lowx, ey - eb_d + 0.5 - 0.0), (lowx - 14.0, ey - eb_d + 0.5), 3.0, 2.8)
    # ambulance bay on the left end: canopy against the first wing + van
    ab_x = bb[0] + 7.0
    if 'ambulance-bay' in F:
        ax0, ax1 = bb[0] + 1.0, bb[0] + 14.0
        ay = bb[1]
        if fpk == 'H':
            # in the H, the bay opens at the foot of the left wing
            ax0, ax1 = bb[0] + 1.5, bb[0] + 14.5
        lib.canopy_flat(b, ax0, ay - 5.4, ax1, ay + 0.2, 3.8, lk, th=0.4, columns=[(ax0 + 0.5, ay - 4.8), (ax1 - 0.5, ay - 4.8), ((ax0 + ax1) / 2, ay - 4.8)] if b.detail < 2 else None,
                        col=lk.accent_col if lk.accent_col else lk.roof_col, r=0.18)
        if b.detail < 2:
            lib.seg_box(b, lib.Seg((ax0, ay), (ax1, ay)), 1.0, ax1 - ax0 - 1.0, 0.0, 2.6, 0.1, '#7b2b27', lk.wall_slot) if b.detail == 0 else None
        U.ambulance(b, (ax0 + ax1) / 2 - 2.0, ay - 2.4, math.pi / 2)
        if srng.random() < 0.7:
            U.ambulance(b, (ax0 + ax1) / 2 + 3.2, ay - 2.4, math.pi / 2 * -1)
    px = _site_common(b, lk, brief, F, srng, bb, bar[1], cx, 'block', w, d, tank_at=(bb[2] + 7, bb[3] - 6), pad_front=20.0)
    if 'red-cross-sign' in F:
        _entrance_sign(b, lk, bb[2] - 9, px[1] + 2.4, F, brief, srng)
    if 'flags' in F:
        U.flags(b, lk, [cx - 8, cx + 8], ey - eb_d - 9, 9.0, U.flag_cols(brief, lk, srng))
    if 'helipad' in F and pitched:
        U.helipad(b, bb[2] + 2 + 8, bb[3] + 10, 0.0, r=7.0, ground=True)
    return bb


def _glass_look(lk):
    """A look whose walls are dark glass-friendly (used for atrium boxes)."""
    g = lib.Look.__new__(lib.Look)
    g.__dict__.update(lk.__dict__)
    return g


def _roof_extras(b, lk, F, rects, z1, rng, srng, bb, st, coarse):
    if b.detail >= 1:
        return
    bar = max(rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    roof_rect = (bar[0] + 1, bar[1] + 1, bar[2] - 1, bar[3] - 1)
    U.roof_plant(b, lk, roof_rect, z1, rng, count=3 if coarse == 0 else 1)
    # a lift/stair overrun above the entrance block
    cx = (bar[0] + bar[2]) / 2
    lib.box_c(b, cx, (bar[1] + bar[3]) / 2, z1, 5.5, 4.5, 3.0, lk.wall_slot, shade(lk.wall_col, 0.9), top_slot='roof-flat', top_col=lk.roof_col)
    if 'solar-panels' in F:
        U.solar_row(b, lk, roof_rect, z1 + 0.8, rng, 2)
    if 'helipad' in F and st >= 3:
        wing = [r for r in rects if r[4] == 'wing']
        tgt = wing[-1] if wing else bar
        hx, hy = (tgt[0] + tgt[2]) / 2, (tgt[1] + tgt[3]) / 2
        r_ = min(6.5, (tgt[2] - tgt[0]) / 2 - 1.0, (tgt[3] - tgt[1]) / 2 - 1.0)
        if r_ >= 4.0:
            U.helipad(b, hx, hy, getattr(b, 'zw', z1) + 0.0, r=r_)
    if 'water-tank' in F:
        # a roof tank on a low stand is more usual on tall blocks
        pass


# ----------------------------------------------------------------------------------------------------------------- tower
def _tower(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    style = brief.get('style') or ''
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    deco = style == 'art-deco' or U.has(txt, 'art deco', 'art-deco')
    st_h = U.clamp(h / max(1, st), 3.2, 4.4)
    pod_h = st_h * 2
    z1 = h
    bd = d
    bb_rect = (-w / 2, -d / 2, w / 2, d / 2)
    wk = _window_kind(brief, lk, 'punched' if deco else 'ribbon')
    bay = (3.2 if wk == 'punched' else 4.2) * (1 + 0.45 * coarse)
    ratio = U.clamp(lk.ratio, 0.2, 0.55)
    b.section('podium')
    # podium: full footprint, 2 storeys, with a canopy-fronted entrance
    pod_rects = [(-w / 2, -d / 2, w / 2, d / 2)]
    pfp = U.union_fp(pod_rects)
    U.walls(b, pfp, 0, pod_h, 2, lk, rng, kind='punched' if deco else wk, ratio=ratio, bay=bay, plinth=0.5, ground_kind='arched' if deco else ('curtain' if style == 'contemporary' else None))
    U.plinth_band(b, pfp, lk, 1.0, col=shade(lk.accent_col, 1.0))
    # tower: set back from the front, tiers for art-deco
    tiers = []
    inset_f = 7.0 if w > 40 else 4.0
    side = 3.0 if deco else 5.0
    if fpk in ('H', 'U'):
        # wings run the full depth, joined by the bar: keep the plan shape, drop the podium to the front strip
        rects = U.plan_rects(fpk, w, d, None, bar_d=d * 0.32, wing_w=U.clamp(w * 0.18, 14, 20))
        tfp = U.union_fp([r[:4] for r in rects])
        tiers = [(tfp, 0, z1)]
        U.walls(b, tfp, pod_h - 0.01, z1, max(1, st - 2), lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0)
        lib.flat_roof(b, tfp, z1, lk, parapet_h=0.7)
    else:
        n_t = 3 if (deco and st >= 7) else 1
        cur = (-w / 2 + side, -d / 2 + inset_f, w / 2 - side, d / 2 - 2.0)
        zc = pod_h
        total = z1 - pod_h
        for t in range(n_t):
            top = z1 if t == n_t - 1 else zc + total * (0.55 if t == 0 else 0.3)
            r = cur
            tf = lib.fp_rect(r[2] - r[0], r[3] - r[1], (r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
            ns = max(1, round((top - zc) / st_h))
            U.walls(b, tf, zc - 0.01, top, ns, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0, rear='same')
            if deco and b.detail == 0:
                # stone piers up the front: vertical emphasis
                for s in tf.edges():
                    if s.front or s.rear:
                        us = [k * 3.2 for k in range(0, int(s.length / 3.2) + 1)]
                        U.piers(b, s, [min(max(u, 0.3), s.length - 0.3) for u in us], zc, top, 0.45, 0.22, shade(lk.accent_col, 1.05), lk.wall_slot)
            if t < n_t - 1:
                lib.flat_roof(b, tf, top, lk, parapet_h=0.5)
            else:
                lib.flat_roof(b, tf, top, lk, parapet_h=0.7)
            zc = top
            cur = (r[0] + 4.5, r[1] + 3.5, r[2] - 4.5, r[3] - 3.0)
            if cur[2] - cur[0] < 8:
                break
        if deco and b.detail < 2:
            # crown: a small stepped lantern on the top tier
            tc = ((cur[0] + cur[2]) / 2, (cur[1] + cur[3]) / 2)
            lib.box_c(b, tc[0], tc[1], zc, 8, 5, 2.6, lk.wall_slot, shade(lk.accent_col, 1.0), top_slot='roof-flat', top_col=lk.roof_col)
            lib.box_c(b, tc[0], tc[1], zc + 2.6, 4.6, 3, 1.6, lk.wall_slot, shade(lk.accent_col, 1.05), top_slot='roof-flat', top_col=lk.roof_col)
    b.section('podium roof')
    lib.flat_roof(b, pfp, pod_h, lk, parapet_h=0.6)
    # entrance
    cx = 0.0
    ey = -d / 2
    if deco or 'portico' in F:
        U.portico_front(b, lk, cx, ey, U.clamp(w * 0.28, 8, 14), 3.2, 0.5, 4.8, 4, pediment_rise=None, steps_n=5, col_r=0.35, kind='square', col=lk.trim_col, entab_h=1.2)
        if 'steps' not in F:
            pass
    else:
        U.entrance_canopy(b, lk, cx - 6, cx + 6, ey, 4.2, 6.0, th=0.5, columns=2)
    seg = lib.Seg((-w / 2, ey), (w / 2, ey))
    U.door(b, seg, w / 2, 3.2, 2.8, frame=lk.trim_col)
    if 'red-cross-sign' in F:
        U.red_cross(b, cx + (w * 0.28 / 2 + 3.5), ey - 0.02, pod_h - 1.5, 1.8, (0, -1, 0))
    if 'helipad' in F:
        pass
    if 'ambulance-bay' in F:
        ax0, ax1 = -w / 2 + 1.0, -w / 2 + 12.0
        lib.canopy_flat(b, ax0, ey - 5.0, ax1, ey + 0.2, 3.6, lk, th=0.4, columns=[(ax0 + 0.5, ey - 4.4), (ax1 - 0.5, ey - 4.4)] if b.detail < 2 else None, col=lk.roof_col, r=0.18)
        U.ambulance(b, (ax0 + ax1) / 2, ey - 2.3, math.pi / 2)
    if 'chimney' in F and b.detail < 2:
        lib.cylinder(b, w / 2 - 6, d / 2 - 5, z1 - 2, z1 + 9, 0.85, n=10 if b.detail == 0 else 6, slot='brick', col='#9a5b44', r_top=0.6, top=True)
    if 'helipad' in F and b.detail < 2 and fpk not in ('H', 'U'):
        U.helipad(b, 0, d / 2 - 10, z1 + 0.0, r=5.5) if z1 < 60 and b.detail == 0 else None
    if fpk in ('H', 'U') and b.detail == 0 and 'helipad' in F:
        U.helipad(b, w / 2 - 9, 0, z1, r=6.0)
    px = _site_common(b, lk, brief, F, srng, bb_rect, ey, cx, 'tower', w, d, tank_at=(w / 2 + 7, d / 2 - 5), pad_front=18.0)
    if 'red-cross-sign' in F:
        _entrance_sign(b, lk, w / 2 - 6, px[1] + 2.4, F, brief, srng)
    if 'flags' in F:
        U.flags(b, lk, [cx - 9, cx + 9], ey - 8, 8.5, U.flag_cols(brief, lk, srng))
    return bb_rect


# ----------------------------------------------------------------------------------------------------------------- build
def _build(brief, style, rng, detail, coarse):
    b = U.new_builder('hospital', detail, coarse, brief=brief)
    lk = U.look_for(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    F = U.feats(brief)
    F.setdefault('red-cross-sign', {'id': 'red-cross-sign', 'count': 1})
    txt = U.text(brief)
    typ, dims = infer(brief, rng)
    fn = {'clinic': _clinic, 'pavilion': _pavilion, 'block': _block, 'soviet': lambda *a: _block(*a, soviet=True), 'tower': _tower}[typ]
    fn(b, lk, brief, F, txt, srng, rng, dims, coarse)
    return b


def build(brief, style, rng, detail):
    return U.run(lambda r, coarse: _build(brief, style, r, detail, coarse), rng, detail)
