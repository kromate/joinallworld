"""civic-small: town halls, parish / centenary halls, polling halls in schools, police stations, post offices, radio stations, archives.
Six typologies chosen from the wording (name / subject / notes), the style and the features:

  hall     single-volume hall: gable (pediment end towards the street) or hip roof, columned porch, arched windows, cupola or clock tower
  polling  school-type block with a veranda, hip roof, flagpole, painted dado, fenced yard (polling halls in schools)
  police   low station block with veranda or canopy, blank blue sign board, flagpole, guard booth, patrol pickups, walled yard, small mast
  post     colonial post office: arcade, hip roof, gabled centre with a clock, pillar box and a mail van
  radio    studio block, a tall red-and-white lattice mast, dish, generator hut and a fenced compound
  archive  heavy stone-clad record office: small deep windows, piered porch, flat roof with parapet

Layout (metres): centred on x = 0, y = 0; main facade towards -Y.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _hospital_util as U  # noqa: E402
import lib  # noqa: E402
from lib import shade, mix  # noqa: E402

FEATURES = {'flags', 'signage-board', 'fence-wall', 'steps', 'portico', 'car-park', 'awning', 'gate', 'balcony-bands', 'pediment', 'colonnade', 'arcade',
            'sheds', 'umbrellas', 'mast', 'atrium-glass', 'flat-canopy', 'dome', 'clock-tower', 'bell-tower', 'kiosk', 'water-tank', 'solar-panels',
            'louvres', 'statue', 'courtyard', 'arches', 'curved-canopy', 'chimney', 'relief-pattern'}


# ------------------------------------------------------------------------------------------------------------- inference
def infer(brief):
    form = brief.get('form') or {}
    txt = U.text(brief)
    subj = ' '.join(str(brief.get(k) or '') for k in ('name', 'subject')).lower()
    F = U.feats(brief)
    style = brief.get('style') or ''
    w, d, st, h = U.dims(brief, 28, 14, 1, st_h=3.8, w_max=70.0)
    var = str(form.get('variant') or '').lower()
    if var in ('hall', 'polling', 'police', 'post', 'radio', 'archive'):
        return var, (w, d, st, h)
    if U.has(subj, 'radio', 'broadcast', 'fm station', 'television', 'tv station') or ('mast' in F and U.has(txt, 'station', 'broadcast')):
        return 'radio', (w, d, st, h)
    if U.has(subj, 'police', 'gendarm', 'constabulary', 'command'):
        return 'police', (w, d, st, h)
    if U.has(subj, 'post office', 'postal', 'poste', 'nipost', 'mail'):
        return 'post', (w, d, st, h)
    if U.has(subj, 'archive', 'records', 'registry', 'registrar', 'deeds'):
        return 'archive', (w, d, st, h)
    if U.has(subj, 'polling', 'school', 'election', 'ward', 'primary', 'secondary', 'voting'):
        return 'polling', (w, d, st, h)
    return 'hall', (w, d, st, h)


def _wk(brief, default):
    wk = (brief.get('facade') or {}).get('windows')
    return wk if wk in ('curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre') else default


def _site(b, lk, brief, F, txt, srng, bb, cx, front=18.0, forecourt='plaza', fence=False, **kw):
    return U.site_common(b, lk, brief, F, txt, srng, bb, cx=cx, front=front, tank_at=(bb[2] + 5, bb[3] - 2), trees=4, forecourt_default=forecourt, flag_h=8.5,
                         statue_h=4.0, fence_default=fence, gate_w=6.5, tree_h=8.0, **kw)


def _rects(fpk, w, d, srng, bar_d=None, wing_w=None):
    if fpk in ('L', 'U', 'T', 'H', 'irregular'):
        return U.plan_rects('L' if fpk in ('T', 'irregular') else fpk, w, max(d, 14.0), None, bar_d=bar_d or d * 0.55, wing_w=wing_w or min(10.0, w * 0.3), side='left' if srng.random() < 0.4 else 'right')
    return U.plan_rects('rect', w, d)


# ------------------------------------------------------------------------------------------------------------------ hall
def _hall(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'gable'
    if roof in ('flat', 'none') and style in ('colonial', 'neoclassical', 'georgian'):
        roof = 'gable'
    classical = style in ('colonial', 'neoclassical', 'georgian', 'victorian', 'baroque')
    st = min(st, 3)
    z1 = U.clamp(h * 0.6 if roof in ('gable', 'hip') and h > 7 else h, 3.8, 9.5) if roof in ('gable', 'hip') else U.clamp(h, 3.8, 9.5)
    st_h = z1 / max(1, st)
    rects = _rects(fpk, w, d, srng)
    bar = rects[0]
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    wk = _wk(brief, 'arched' if classical else 'punched')
    if wk in ('ribbon', 'curtain'):
        wk = 'punched'
    ratio = U.clamp(lk.ratio, 0.18, 0.34)
    bay = 3.8 * (1 + 0.45 * coarse)
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.5)
    U.plinth_band(b, fp, lk, 0.8)
    b.section('roof')
    portico = 'portico' in F or 'pediment' in F or 'colonnade' in F
    axis = 'y' if (portico and (bar[2] - bar[0]) <= 1.9 * (bar[3] - bar[1]) and roof == 'gable') else 'x'
    if roof == 'gable':
        for r in rects:
            kw = {'axis': axis if r is bar else 'auto'}
            lib.gable(b, r[:4], z1, (min(r[2] - r[0], r[3] - r[1]) / 2) * math.tan((24 if lk.roof_slot in ('clay-tile', 'slate') else 18) * math.pi / 180), lk, ov=0.8, **kw)
    elif roof in ('hip', 'pyramidal', 'mansard', 'shed'):
        U.roof_rects(b, 'hip' if roof != 'shed' else 'shed', rects, z1, lk, pitch=22 if lk.roof_slot in ('clay-tile', 'slate') else 17, ov=0.9)
    elif roof == 'dome':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.5)
        lib.dome(b, cx, (bar[1] + bar[3]) / 2, z1, min(bar[2] - bar[0], bar[3] - bar[1]) * 0.28, lk, profile='shallow', drum=0.8)
    else:
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.6, ov=0.0)
    if b.detail == 0 and roof != 'flat':
        U.eaves_band(b, fp, z1, lk, 0.35, 0.4)
    b.section('porch')
    cw = U.clamp((bar[2] - bar[0]) * 0.34, 5.0, 12.0)
    if portico:
        cols = 4 if cw < 9 else 6
        ped = cw * 0.17 if ('pediment' in F or classical) else None
        U.portico_front(b, lk, cx, bar[1], cw, 4.2, 0.6, z1 * 0.82 if st == 1 else st_h * 1.3, cols, pediment_rise=ped, steps_n=5, col_r=0.26, kind='round' if classical else 'square', col=lk.trim_col,
                        entab_h=0.8, steps_w=cw * 0.8)
    elif roof in ('gable', 'hip'):
        U.veranda(b, lk, (bar[0] + 0.5, bar[1]), (bar[2] - 0.5, bar[1]), 0.0, min(3.0, z1 - 0.8), 2.2, z1 - 0.4, post='square', pitch_m=2.8, col=lk.trim_col)
    else:
        U.entrance_canopy(b, lk, cx - cw / 2, cx + cw / 2, bar[1], 3.4, 3.4, columns=2)
        lib.steps(b, cx - cw * 0.35, cx + cw * 0.35, bar[1] - 3.4, 0.5, 1.5, 3, 'paving', lk.stone_col) if b.detail < 2 else None
    seg = lib.Seg((cx - cw / 2, bar[1]), (cx + cw / 2, bar[1]))
    U.door(b, seg, cw / 2, 2.2, 2.6, frame=lk.trim_col, z=0.6 if portico else 0.0)
    if 'clock-tower' in F or 'bell-tower' in F:
        U.clock_tower(b, lk, cx, (bar[1] + bar[3]) / 2, z1 + 1.0, 3.4, 8.0, cap='hip', cap_rise=3.5, clock=('clock-tower' in F), storeys=2, finial=1.2)
    elif roof in ('gable', 'hip') and b.detail < 2 and classical:
        # little bell cupola on the ridge
        lib.box_c(b, cx, (bar[1] + bar[3]) / 2, z1 + (min(bar[2] - bar[0], bar[3] - bar[1]) / 2) * 0.42, 1.6, 1.6, 1.6, lk.wall_slot, lk.trim_col)
        lib.hip(b, (cx - 1.0, (bar[1] + bar[3]) / 2 - 1.0, cx + 1.0, (bar[1] + bar[3]) / 2 + 1.0), z1 + (min(bar[2] - bar[0], bar[3] - bar[1]) / 2) * 0.42 + 1.6, 1.4, lk, ov=0.2)
    if 'dome' in F and roof != 'dome' and b.detail < 3:
        lib.dome(b, cx, (bar[1] + bar[3]) / 2, z1 + 1.0, min(4.0, (bar[3] - bar[1]) * 0.28), lk, profile='hemi', drum=1.2, lantern=0.5, finial=0.8)
    if 'awning' in F and b.detail < 2:
        pass
    if 'umbrellas' in F:
        for k in range(3):
            U.umbrella(b, bar[0] - 4.0 - k * 3.5, bar[1] - 3.0 - (k % 2) * 3.0, srng.choice(['#d84c3a', '#e8b83a', '#3a7bd8']))
    if 'sheds' in F and b.detail < 2:
        sx = bb[2] + 5.0
        with b.site():
            for sxx in (sx, sx + 8.0):
                lib.box_c(b, sxx, bb[1] + 4.0, 0, 0.2, 0.2, 2.8, 'plain', '#7d8286')
            lib.box(b, sx - 1.0, bb[1] + 1.0, 2.8, sx + 9.0, bb[1] + 7.0, 3.0, 'metal-cladding', '#8a8f94', top_slot='corrugated', top_col=lk.roof_col)
    b.section('site')
    _site(b, lk, brief, F, txt, srng, bb, cx, front=18.0, forecourt='plaza' if classical else 'garden', fence=('fence-wall' in F or 'gate' in F))
    return bb


# ---------------------------------------------------------------------------------------------------------------- polling
def _polling(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    roof = form.get('roof') or 'hip'
    if roof not in ('hip', 'gable', 'shed', 'flat'):
        roof = 'hip'
    st = 1
    z1 = 4.0
    fpk = form.get('footprint') or 'rect'
    w_ = U.clamp(w, 14.0, 60.0)
    cd = 8.5
    rects = U.plan_rects('rect', w_, cd) if fpk not in ('L', 'U') else U.plan_rects(fpk, w_, max(d, cd + 10), None, bar_d=cd, wing_w=8.0)
    bar = rects[0]
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    wk = 'punched'
    bay = 3.2 * (1 + 0.45 * coarse)
    b.section('walls')
    U.walls(b, fp, 0, z1, 1, lk, rng, kind=wk, ratio=U.clamp(lk.ratio, 0.2, 0.32), bay=bay, plinth=0.3)
    if b.detail < 2:
        lib.sweep(b, fp, 0.0, [(0.04, 0), (0.04, 1.1), (0, 1.1)], lk.wall_slot, lk.accent_col)
    b.section('roof')
    if roof == 'flat':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.5)
    else:
        U.roof_rects(b, roof, rects, z1, lk, pitch=16 if lk.roof_slot in ('corrugated', 'metal-roof') else 24, ov=0.9)
    for r in rects:
        if r is bar or (r[2] - r[0]) > (r[3] - r[1]):
            U.veranda(b, lk, (r[0], r[1]), (r[2], r[1]), 0.0, 2.9, 2.2, z1 - 0.4, post='square', pitch_m=2.8, col=lk.trim_col)
    seg = lib.Seg((bar[0], bar[1]), (bar[2], bar[1]))
    U.door(b, seg, (bar[2] - bar[0]) / 2, 1.6, 2.2, frame=lk.trim_col)
    b.section('site')
    F2 = dict(F)
    F2.setdefault('flags', {'id': 'flags', 'count': 1})
    # a few polling-day shades (open sheds / umbrellas) on the yard
    if b.detail == 0:
        for k in range(3):
            U.umbrella(b, bb[0] + 6 + k * 6.0, bb[1] - 7.0 - (k % 2) * 3.0, srng.choice(['#d84c3a', '#3a7bd8', '#e8b83a']))
    _site(b, lk, brief, F2, txt, srng, bb, cx, front=18.0, forecourt='none', fence=True)
    return bb


# ---------------------------------------------------------------------------------------------------------------- police
def _police(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'hip'
    st = min(st, 2)
    z1 = 3.9 if st == 1 else 7.4
    w_ = U.clamp(w, 14.0, 48.0)
    rects = _rects(fpk, w_, U.clamp(d, 9.0, 14.0), srng, bar_d=9.5, wing_w=8.0)
    bar = rects[0]
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    bay = 3.4 * (1 + 0.45 * coarse)
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind='punched', ratio=0.22, bay=bay, plinth=0.4)
    if b.detail < 2:
        lib.sweep(b, fp, 0.0, [(0.04, 0), (0.04, 1.0), (0, 1.0)], lk.wall_slot, mix('#2a4a8a', lk.wall_col, 0.2))
    b.section('roof')
    if roof == 'flat':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.6)
    else:
        U.roof_rects(b, roof if roof in ('hip', 'gable', 'shed') else 'hip', rects, z1, lk, pitch=17, ov=0.9)
    if st == 1 and roof != 'flat':
        U.veranda(b, lk, (bar[0] + 0.3, bar[1]), (bar[2] - 0.3, bar[1]), 0.0, 2.8, 2.2, z1 - 0.4, post='square', pitch_m=3.0, col=lk.trim_col)
    else:
        U.entrance_canopy(b, lk, cx - 3.2, cx + 3.2, bar[1], 3.4, 3.0, columns=2)
    seg = lib.Seg((bar[0], bar[1]), (bar[2], bar[1]))
    U.door(b, seg, (bar[2] - bar[0]) / 2, 1.6, 2.2, frame=lk.trim_col)
    # blank blue sign board on the wall above the entrance, and a short radio mast behind the block
    if b.detail < 2 and roof == 'flat':
        lib.seg_box(b, seg, (bar[2] - bar[0]) / 2 - 2.4, (bar[2] - bar[0]) / 2 + 2.4, z1 - 1.5, z1 - 0.3, 0.12, '#244a73', 'plain')
    if b.detail < 2:
        U.lattice_mast(b, bar[2] + 3.0, bar[3] + 2.0, 16.0 if 'mast' in F else 11.0, base_w=1.2, top_w=0.5, panels=4)
    b.section('site')
    F2 = dict(F)
    F2.setdefault('flags', {'id': 'flags', 'count': 1})
    F2.setdefault('kiosk', {'id': 'kiosk', 'count': 1})
    px = _site(b, lk, brief, F2, txt, srng, bb, cx, front=18.0, forecourt='none', fence=True)
    U.pickup(b, bb[0] + 6.0, bb[1] - 7.0, 0.0, '#e8e8e4')
    U.pickup(b, bb[0] + 13.0, bb[1] - 9.0, math.pi * 0.9, '#2a4a8a')
    if b.detail < 2:
        # sign pylon with a blue board (blank)
        with b.site():
            lib.box_c(b, px[2] - 7, px[1] + 2.2, 0, 0.3, 0.3, 3.0, 'plain', '#8d9298')
            lib.box_c(b, px[2] - 7, px[1] + 2.2, 2.1, 3.0, 0.2, 1.4, 'plain', '#244a73')
    return bb


# ------------------------------------------------------------------------------------------------------------------- post
def _post(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    roof = form.get('roof') or 'hip'
    st = min(st, 2)
    z1 = 4.6 if st == 1 else 8.0
    w_ = U.clamp(w, 16.0, 48.0)
    d_ = U.clamp(d, 10.0, 18.0)
    rects = U.plan_rects('rect', w_, d_)
    bar = rects[0]
    cx = 0.0
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind='arched' if lk.windows != 'punched' else 'punched', ratio=0.26, bay=3.8 * (1 + 0.45 * coarse), plinth=0.5)
    U.plinth_band(b, fp, lk, 0.8)
    b.section('roof')
    if roof == 'flat':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.7)
    else:
        U.roof_rects(b, 'hip', rects, z1, lk, pitch=22 if lk.roof_slot in ('clay-tile', 'slate') else 17, ov=0.9)
    if b.detail == 0:
        U.eaves_band(b, fp, z1, lk, 0.35, 0.4)
    # arcade across the front (the post-office hallmark), a gabled centre with a clock
    b.section('arcade')
    gw = U.clamp(w_ * 0.28, 6.0, 12.0)
    if b.detail < 2:
        U.arcade(b, lk, (bar[0] + 0.3, bar[1]), (cx - gw / 2, bar[1]), 0, 2.4, 3.5 if st == 1 else 3.8, 2.4, bay_w=3.4, pier_w=0.7, col=lk.trim_col)
        U.arcade(b, lk, (cx + gw / 2, bar[1]), (bar[2] - 0.3, bar[1]), 0, 2.4, 3.5 if st == 1 else 3.8, 2.4, bay_w=3.4, pier_w=0.7, col=lk.trim_col)
    gz = z1 + (0.4 if roof != 'flat' else 0.0)
    U.portico_front(b, lk, cx, bar[1], gw, 3.0, 0.4, z1 * 0.72 if st == 1 else 5.6, 4, pediment_rise=gw * 0.2, steps_n=3, col_r=0.24, kind='round', col=lk.trim_col, entab_h=0.7, steps_w=gw * 0.7)
    if b.detail == 0:
        U.clock_face(b, cx, bar[1] - 3.0 - 0.25, z1 * 0.72 + 1.45, 0.55, (0, -1, 0))
    seg = lib.Seg((cx - gw / 2, bar[1]), (cx + gw / 2, bar[1]))
    U.door(b, seg, gw / 2, 2.2, 2.6, frame=lk.trim_col, z=0.4)
    if 'clock-tower' in F or 'bell-tower' in F:
        U.clock_tower(b, lk, cx, bar[1] + d_ * 0.5, z1 + 1.0, 3.0, 7.0, cap='hip', cap_rise=3.0, clock='clock-tower' in F, storeys=2)
    b.section('site')
    if b.detail < 2:
        # red pillar box and a mail van at the kerb
        px_, py_ = bar[2] + 3.0, bar[1] - 7.0
        with b.site():
            lib.cylinder(b, px_, py_, 0, 1.45, 0.42, n=8 if b.detail == 0 else 5, slot='plain', col='#b3262b', r_top=0.42, top=False)
            lib.cylinder(b, px_, py_, 1.45, 1.65, 0.46, n=8 if b.detail == 0 else 5, slot='plain', col='#a02226', r_top=0.2, top=True, smooth=False)
        U.pickup(b, bar[0] + 6.0, bar[1] - 10.0, 0.0, '#b3262b')
    F2 = dict(F)
    F2.setdefault('flags', {'id': 'flags', 'count': 1})
    _site(b, lk, brief, F2, txt, srng, bb, cx, front=16.0, forecourt='plaza', fence=False)
    return bb


# ------------------------------------------------------------------------------------------------------------------ radio
def _radio(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    st = min(st, 2)
    z1 = 4.0 if st == 1 else 7.4
    w_ = U.clamp(w, 14.0, 40.0)
    d_ = U.clamp(d, 9.0, 18.0)
    rects = U.plan_rects('rect', w_, d_)
    bar = rects[0]
    bb0 = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=(form.get('footprint') and 'ribbon') or 'ribbon', ratio=0.3, bay=4.0 * (1 + 0.45 * coarse), plinth=0.4)
    b.section('roof')
    roof = form.get('roof') or 'flat'
    if roof in ('hip', 'gable'):
        U.roof_rects(b, roof, rects, z1, lk, pitch=16, ov=0.7)
    else:
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.6)
    cx = 0.0
    seg = lib.Seg((bar[0], bar[1]), (bar[2], bar[1]))
    U.entrance_canopy(b, lk, cx - 2.8, cx + 2.8, bar[1], 3.3, 2.8, columns=0)
    U.door(b, seg, (bar[2] - bar[0]) / 2, 1.8, 2.3, frame=lk.trim_col)
    # the mast: tall lattice tower beside the studio block, with guy anchors implied by a concrete base
    b.section('mast')
    mh = 42.0 + (srng.random() * 28.0 if 'mast' in F else 0.0)
    mx, my = bar[2] + 9.0, bar[3] + 5.0
    U.lattice_mast(b, mx, my, mh, base_w=3.6, top_w=0.8, panels=10)
    if b.detail < 2:
        lib.box_c(b, mx, my, 0, 5.2, 5.2, 0.5, 'rough-concrete', '#9a9a96', skip=('bottom',))
        # satellite dish on the roof and a generator hut
        if b.detail == 0:
            dx, dy = bar[0] + 4.0, (bar[1] + bar[3]) / 2
            lib.cylinder(b, dx, dy, z1, z1 + 1.6, 0.12, n=5, slot='frame', col='#9ea3a8', top=False)
            lib.cylinder(b, dx, dy + 0.4, z1 + 1.6, z1 + 2.0, 1.4, n=12, slot='plain', col='#e8e8e4', r_top=0.4, top=False, smooth=False)
            lib.box_c(b, bar[2] + 4.0, bar[1] + 3.0, 0, 3.4, 2.6, 2.4, 'metal-cladding', '#6b7a72', top_slot='roof-flat', skip=('bottom',))
    bb = (min(bar[0], mx - 3), bar[1], max(bar[2], mx + 3), my + 4)
    b.section('site')
    F2 = dict(F)
    F2.setdefault('fence-wall', {'id': 'fence-wall', 'count': 1})
    F2.setdefault('flags', {'id': 'flags', 'count': 1})
    _site(b, lk, brief, F2, txt, srng, bb, cx, front=16.0, forecourt='parking' if 'car-park' in F else 'none', fence=True)
    return bb


# ----------------------------------------------------------------------------------------------------------------- archive
def _archive(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    st = max(1, min(st, 3))
    st_h = U.clamp(h / st, 3.8, 5.0)
    z1 = st_h * st
    w_ = U.clamp(w, 16.0, 56.0)
    d_ = U.clamp(d, 11.0, 26.0)
    rects = U.plan_rects('rect', w_, d_)
    bar = rects[0]
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    lk.wall_slot = 'stone-blocks' if lk.wall_slot in ('plain-render', 'rough-concrete') else lk.wall_slot
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind='punched', ratio=0.1, bay=4.6 * (1 + 0.45 * coarse), plinth=0.0, ground_h=st_h * 1.1)
    if b.detail == 0:
        lib.sweep(b, fp, 0.0, [(0.12, 0), (0.12, 1.0), (0, 1.0)], 'stone-blocks', shade(lk.wall_col, 0.82))
    b.section('roof')
    lib.flat_roof(b, fp, z1, lk, parapet_h=0.0)
    if b.detail < 2:
        U.eaves_band(b, fp, z1 + 0.5, lk, 0.5, 0.5)
    cw = U.clamp(w_ * 0.4, 8.0, 16.0)
    U.portico_front(b, lk, 0.0, bar[1], cw, 3.4, 0.8, st_h * min(st, 2) * 0.92, 4, pediment_rise=None, steps_n=6, col_r=0.4, kind='square', col=lk.trim_col, entab_h=1.1, steps_w=cw * 0.8)
    seg = lib.Seg((-cw / 2, bar[1]), (cw / 2, bar[1]))
    U.door(b, seg, cw / 2, 2.4, 3.0, frame=lk.trim_col, z=0.8)
    if b.detail == 0:
        for s in fp.edges():
            if s.front:
                n = max(2, int(s.length / 4.6))
                U.piers(b, s, [s.length * k / n for k in range(n + 1)], 0.0, z1, 0.6, 0.18, shade(lk.trim_col, 0.98), lk.wall_slot)
    b.section('site')
    F2 = dict(F)
    F2.setdefault('flags', {'id': 'flags', 'count': 1})
    _site(b, lk, brief, F2, txt, srng, bb, 0.0, front=16.0, forecourt='plaza', fence=('fence-wall' in F))
    return bb


# ----------------------------------------------------------------------------------------------------------------- build
def _build(brief, style, rng, detail, coarse):
    b = U.new_builder('civic-small', detail, coarse, brief=brief)
    lk = U.look_for(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    F = U.feats(brief)
    txt = U.text(brief)
    typ, dims = infer(brief)
    fn = {'hall': _hall, 'polling': _polling, 'police': _police, 'post': _post, 'radio': _radio, 'archive': _archive}[typ]
    fn(b, lk, brief, F, txt, srng, rng, dims, coarse)
    return b


def build(brief, style, rng, detail):
    return U.run(lambda r, coarse: _build(brief, style, r, detail, coarse), rng, detail)
