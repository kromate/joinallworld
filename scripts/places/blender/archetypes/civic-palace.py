"""civic-palace: parliaments, state houses, courts, ministries and city halls. The STYLE decides the architecture (eight typologies):

  neoclassical  giant-order portico with pediment, pilastered wings, rusticated base, cornice and balustrade, optional dome on a drum
  colonial      two-storey government house: brick or white render, galleries on both floors, hip roof, gabled central porch
  secretariat   Nigerian-style state secretariat / assembly: U, H or slab block, ribbon windows, canopy porch, taller stair core
  islamic       arcaded block with a central pointed-arch iwan portal, domes on drums, slender corner towers, crenellated parapet
  arewa         Hausa / Sahelian palace look: mud-render walls, crenellated parapet with horn pinnacles, zaure gatehouse, relief bands
  soviet        monumental pilastered block with a stepped central tower and spire, rusticated base, heavy cornice
  brasilia      modernist monument: glass box under a thin overhanging slab on a ring of slender columns, podium and ramp, optional bowl
  brutalist     concrete mass with cantilevered upper floors, projecting side blocks, slit windows and a big blank relief panel

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

FEATURES = {'portico', 'colonnade', 'pediment', 'arcade', 'dome', 'flags', 'steps', 'fence-wall', 'gate', 'car-park', 'signage-board', 'fountain',
            'statue', 'courtyard', 'arches', 'relief-pattern', 'balcony-bands', 'canopy-walkway', 'water-tank', 'podium', 'pilotis', 'brise-soleil',
            'crenellation', 'pinnacles', 'minaret', 'clock-tower', 'atrium-glass', 'flat-canopy', 'curved-canopy', 'louvres', 'obelisk', 'mast',
            'kiosk', 'terrace', 'mosaic', 'painted-mural'}


# ------------------------------------------------------------------------------------------------------------- inference
def infer(brief):
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    txt = U.text(brief)
    F = U.feats(brief)
    w, d, st, h = U.dims(brief, 60, 28, 2, st_h=4.2)
    var = str(form.get('variant') or '').lower()
    if var in ('neoclassical', 'colonial', 'secretariat', 'islamic', 'arewa', 'soviet', 'brasilia', 'brutalist'):
        return var, (w, d, st, h)
    if style == 'soviet':
        t = 'soviet'
    elif style in ('arab-islamic', 'ottoman', 'mughal', 'persian'):
        t = 'islamic'
    elif style in ('hausa-arewa', 'sahelian'):
        t = 'arewa'
    elif style == 'brutalist':
        t = 'brutalist'
    elif style in ('neoclassical', 'georgian', 'baroque'):
        t = 'neoclassical'
    elif style in ('colonial', 'victorian', 'caribbean', 'swahili'):
        t = 'colonial'
    elif style in ('modernist', 'international', 'contemporary', 'postmodern', 'high-tech', 'art-deco'):
        if ('colonnade' in F or 'podium' in F or 'pilotis' in F) and (w >= 80 or U.has(txt, 'palais', 'congress', 'congrès', 'assembly hall')) and 'pediment' not in F:
            t = 'brasilia'
        else:
            t = 'secretariat'
    else:
        t = 'secretariat'
    if t == 'neoclassical' and st >= 5:
        t = 'secretariat'
    return t, (w, d, st, h)


def _wk(brief, default):
    wk = (brief.get('facade') or {}).get('windows')
    return wk if wk in ('curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre') else default


def _plan(fpk, w, d, srng, bar_d=None, wing_w=None, open_to='back'):
    side = 'left' if srng.random() < 0.4 else 'right'
    if fpk == 'cross':
        fpk = 'H'
    if fpk not in ('L', 'U', 'H', 'T', 'ring', 'irregular'):
        return U.plan_rects('rect', w, d)
    return U.plan_rects(fpk, w, d, None, bar_d=bar_d, wing_w=wing_w, side=side, open_to=open_to)


def _bar(rects):
    return max([r for r in rects if r[4] == 'bar'] or rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))


def _loggia(b, lk, x0, x1, y_wall, z_top, depth=4.0, n=None, r=0.4, kind='round', col=None, slab=True, entab=0.8, base_z=0.0):
    """A continuous colonnade (loggia) along the front wall at y = y_wall: floor, columns, entablature and a flat roof."""
    col = col or lk.trim_col
    yc = y_wall - depth + r + 0.4
    n = n or max(3, int((x1 - x0) / 5.2) + 1)
    n = n if b.detail == 0 else max(3, n // 2 + 1)
    if b.detail >= 2:
        lib.box(b, x0, y_wall - depth, 0, x1, y_wall, z_top + entab, 'plain', col, skip=('bottom',))
        return
    if slab:
        lib.box(b, x0 - 0.3, y_wall - depth - 0.2, 0, x1 + 0.3, y_wall, base_z + 0.35, lk.wall_slot, shade(col, 0.92), skip=('bottom', 'back'))
    for k in range(n):
        x = x0 + r + (x1 - x0 - 2 * r) * k / max(1, n - 1)
        if kind == 'square':
            lib.box_c(b, x, yc, base_z, 2 * r, 2 * r, z_top - base_z, lk.wall_slot, col)
        else:
            lib.column(b, x, yc, base_z, z_top, r, lk, 'round', True, lk.wall_slot, col)
    lib.box(b, x0 - 0.5, y_wall - depth, z_top, x1 + 0.5, y_wall, z_top + entab, lk.wall_slot, col, top_slot='roof-flat', top_col=lk.roof_col, skip=())


def _bays_piers(b, lk, fp, z0, z1, pitch=4.2, w=0.7, proud=0.22, col=None, min_len=8.0, front_only=True):
    if b.detail >= 1:
        return
    col = col or shade(lk.trim_col, 1.0)
    for s in fp.edges():
        if s.length < min_len or (front_only and not s.front):
            continue
        n = max(1, int(s.length / pitch))
        us = [s.length * k / n for k in range(n + 1)]
        us = [min(max(u, w / 2), s.length - w / 2) for u in us]
        U.piers(b, s, us, z0, z1, w, proud, col, lk.wall_slot)


def _balustrade_parapet(b, lk, fp, z, h=1.0, col=None):
    if b.detail >= 2:
        return
    if b.detail == 1:
        lib.parapet(b, fp, z, h, 0.3, lk, col=col or lk.trim_col)
        return
    for s in fp.edges():
        if s.length < 3:
            continue
        a, c = s.P(0.2, 0, 0.25), s.P(s.length - 0.2, 0, 0.25)
        U.balustrade(b, (a[0], a[1]), (c[0], c[1]), z, h, col or lk.trim_col, pitch=2.8)


def _statues_on_pediment(b, lk, cx, z, n=3):
    if b.detail >= 1:
        return
    for k in range(n):
        x = cx + (k - (n - 1) / 2) * 3.0
        lib.box_c(b, x, 0, z, 0.9, 0.9, 1.4 - abs(k - (n - 1) / 2) * 0.35, 'stone-blocks', shade(lk.trim_col, 0.9))


def _site(b, lk, brief, F, txt, srng, bb, cx, front=26.0, forecourt='plaza', **kw):
    tank = (bb[2] + 6, bb[3] - 3)
    return U.site_common(b, lk, brief, F, txt, srng, bb, cx=cx, front=front, tank_at=tank, trees=7, forecourt_default=forecourt, flag_h=11.0, statue_h=5.0,
                         fence_default=('gate' in F or 'fence-wall' in F), **kw)


# ---------------------------------------------------------------------------------------------------------------- neoclassical
def _neoclassical(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    st = min(st, 4)
    st_h = U.clamp(h / max(1, st), 4.0, 5.6)
    z1 = st_h * st
    roof = form.get('roof') or 'flat'
    ww = U.clamp(w * 0.2, 12.0, 20.0)
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 14.0, 30.0), srng, U.clamp(d * 0.45, 14, 22), ww)
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    cw = U.clamp((bar[2] - bar[0]) * 0.34, 14.0, 30.0)
    # end pavilions project slightly forward and the centre carries the portico
    pav = U.clamp((bar[2] - bar[0]) * 0.12, 8.0, 14.0)
    extra = []
    if (bar[2] - bar[0]) > 50:
        extra = [(bar[0], bar[1] - 2.0, bar[0] + pav, bar[1], 'wing'), (bar[2] - pav, bar[1] - 2.0, bar[2], bar[1], 'wing')]
    all_rects = rects + extra
    bb = U.bbox_of(all_rects)
    fp = U.union_fp([r[:4] for r in all_rects])
    dome = 'dome' in F or U.has(txt, 'parliament', 'capitol', 'house of assembly', 'national assembly') and (bar[2] - bar[0]) > 55
    b.section('walls')
    ratio = U.clamp(lk.ratio, 0.22, 0.34)
    bay = 4.2 * (1 + 0.45 * coarse)
    U.walls(b, fp, 0, z1, st, lk, rng, kind='punched', ratio=ratio, bay=bay, plinth=0.0, ground_kind='arched' if b.detail < 2 else None, ground_h=st_h * 1.1)
    if b.detail == 0:
        # rusticated base: darker stone band over the ground storey
        lib.sweep(b, fp, 0.0, [(0.1, 0), (0.1, 1.2), (0, 1.2)], 'stone-blocks', shade(lk.wall_col, 0.82))
        U.string_course(b, fp, st_h * 1.1, lk, 0.3, 0.14)
    _bays_piers(b, lk, fp, 0.6, z1 - 0.2, pitch=4.4, w=0.7, proud=0.2, front_only=False)
    b.section('roof')
    lib.flat_roof(b, fp, z1, lk, parapet_h=0.0)
    if b.detail == 0:
        U.eaves_band(b, fp, z1 + 0.5, lk, 0.5, 0.5)
    _balustrade_parapet(b, lk, fp, z1 + 0.0, 1.0)
    if roof in ('hip', 'gable'):
        # attic roof set well back behind the balustrade: a low tiled hip over the main bar
        inner = (bar[0] + 3.0, bar[1] + 3.0, bar[2] - 3.0, bar[3] - 3.0)
        if inner[2] - inner[0] > 6 and inner[3] - inner[1] > 6:
            lib.hip(b, inner, z1 + 0.05, 3.2, lk, ov=0.0) if b.detail < 2 else None
    b.section('portico')
    pw = cw * 0.9
    cols = 6 if pw < 22 else 8
    pz = 1.0
    ph = st_h * min(st, 2) - 0.4
    U.portico_front(b, lk, cx, bar[1], pw, 6.5, pz, ph, cols, pediment_rise=pw * 0.13, steps_n=7, col_r=min(0.55, pw / cols / 3.2), kind='round', col=lk.trim_col, entab_h=1.0, steps_w=pw * 0.85,
                    pediment_col=shade(lk.trim_col, 0.97))
    seg = lib.Seg((cx - cw / 2, bar[1]), (cx + cw / 2, bar[1]))
    U.door(b, seg, cw / 2, 3.4, 3.6, frame=lk.trim_col, z=pz)
    if 'colonnade' in F:
        # side loggias connect the portico to the pavilions
        _loggia(b, lk, bar[0] + pav, cx - pw / 2 - 0.5, bar[1], st_h * 1.05, depth=3.2, r=0.28, kind='round', base_z=0.0)
        _loggia(b, lk, cx + pw / 2 + 0.5, bar[2] - pav, bar[1], st_h * 1.05, depth=3.2, r=0.28, kind='round', base_z=0.0)
    if dome and b.detail < 3:
        b.section('dome')
        r = U.clamp(cw * 0.3, 5.0, 11.0)
        dy = (bar[1] + bar[3]) / 2
        zd = z1 + 0.6
        if b.detail < 2:
            lib.box_c(b, cx, dy, z1, r * 2.6, r * 2.6, 0.8, lk.wall_slot, lk.trim_col, skip=('bottom',))
        lib.dome(b, cx, dy, zd, r, lk, profile='hemi', drum=r * 0.7, drum_r=r * 1.05, drum_slot=lk.wall_slot, drum_col=lk.trim_col, lantern=r * 0.45, finial=2.0,
                 col=mix(lk.roof_col, '#9aa3a8', 0.4) if lk.roof_slot == 'roof-flat' else lk.roof_col, slot='metal-roof')
        if b.detail == 0:
            n = 12
            for k in range(n):
                a = 2 * math.pi * k / n
                lib.cylinder(b, cx + r * 1.0 * math.cos(a), dy + r * 1.0 * math.sin(a), zd, zd + r * 0.7, 0.18, n=5, slot=lk.wall_slot, col=lk.trim_col, r_top=0.18, top=False)
    elif b.detail < 2 and 'pediment' in F and not roof in ('hip',):
        pass
    if b.detail == 0 and U.has(txt, 'court', 'justice'):
        # scales-of-justice style acroteria on the pediment: three small plinths
        _statues_on_pediment(b, lk, cx, z1 + st_h * 0.0 + 0.0, 0)
    b.section('site')
    holes = fp.polys[1:]
    if holes:
        xs = [p[0] for p in holes[0]]
        ys = [p[1] for p in holes[0]]
        U.courtyard_garden(b, lk, (min(xs) + 1, min(ys) + 1, max(xs) - 1, max(ys) - 1), srng, trees=3)
    F2 = dict(F)
    _site(b, lk, brief, F2, txt, srng, bb, cx, front=28.0)
    return bb


# ---------------------------------------------------------------------------------------------------------------- colonial
def _colonial(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    st = min(max(st, 1), 3)
    st_h = U.clamp(h / max(1, st), 3.8, 5.0)
    z1 = st_h * st
    ww = U.clamp(w * 0.16, 11.0, 17.0)
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 14.0, 26.0), srng, U.clamp(d * 0.4, 12, 18), ww)
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    roofk = form.get('roof') if form.get('roof') in ('hip', 'gable') else 'hip'
    tiled = lk.roof_slot in ('clay-tile', 'slate')
    ratio = U.clamp(lk.ratio, 0.22, 0.32)
    bay = 3.8 * (1 + 0.45 * coarse)
    wk = 'arched' if (brief.get('facade') or {}).get('windows') == 'arched' else 'punched'
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.5)
    U.plinth_band(b, fp, lk, 0.9)
    b.section('roof')
    U.roof_rects(b, roofk, rects, z1, lk, pitch=28 if tiled else 20, ov=1.1)
    U.eaves_band(b, fp, z1, lk, 0.4, 0.5)
    b.section('galleries')
    cw = U.clamp((bar[2] - bar[0]) * 0.2, 8.0, 14.0)
    # verandas / galleries across the front of the bar except at the central porch; side galleries inside courtyards
    runs = [(bar[0], cx - cw / 2 - 0.4), (cx + cw / 2 + 0.4, bar[2])]
    for (xa, xb) in runs:
        if xb - xa > 4:
            if st >= 2:
                U.gallery2(b, lk, (xa, bar[1]), (xb, bar[1]), z1, st_h, depth=2.8, col=lk.trim_col)
            else:
                U.veranda(b, lk, (xa, bar[1]), (xb, bar[1]), 0.0, st_h - 0.4, 2.8, z1 - 0.4, post='round', pitch_m=3.2, col=lk.trim_col)
    for r in rects:
        if r[4] != 'wing' or r[3] - r[1] < 8:
            continue
        # courtyard-facing (inner) side of side wings
        if r[0] < bar[0] + 1 and r[2] < (bar[0] + bar[2]) / 2:
            p0, p1 = (r[2], r[3] - 0.5), (r[2], r[1] + 0.5)
        elif r[2] > bar[2] - 1 and r[0] > (bar[0] + bar[2]) / 2:
            p0, p1 = (r[0], r[1] + 0.5), (r[0], r[3] - 0.5)
        else:
            continue
        if fpk in ('U', 'H', 'L'):
            if st >= 2:
                U.gallery2(b, lk, p0, p1, z1, st_h, depth=2.6, col=lk.trim_col)
            else:
                U.veranda(b, lk, p0, p1, 0.0, st_h - 0.4, 2.6, z1 - 0.4, post='round', pitch_m=3.2, col=lk.trim_col)
    # central gabled porch with columns, pediment and steps
    pw = cw
    U.portico_front(b, lk, cx, bar[1], pw, 5.2, 0.7, st_h * min(st, 2) - 0.2, 4, pediment_rise=pw * 0.2, steps_n=6, col_r=0.3, kind='round', col=lk.trim_col, entab_h=0.8, steps_w=pw * 0.8)
    seg = lib.Seg((cx - cw / 2, bar[1]), (cx + cw / 2, bar[1]))
    U.door(b, seg, cw / 2, 2.6, 3.2, frame=lk.trim_col, z=0.7)
    if 'courtyard' in F and fpk in ('U', 'H', 'ring'):
        holes = fp.polys[1:]
        if holes:
            xs = [p[0] for p in holes[0]]
            ys = [p[1] for p in holes[0]]
            U.courtyard_garden(b, lk, (min(xs) + 1, min(ys) + 1, max(xs) - 1, max(ys) - 1), srng, trees=3)
        elif fpk == 'U':
            wings = [r for r in rects if r[4] == 'wing']
            if len(wings) == 2:
                U.courtyard_garden(b, lk, (wings[0][2] + 2.6, bar[3], wings[1][0] - 2.6, bb[3] + 4), srng, trees=3)
    if 'clock-tower' in F:
        U.clock_tower(b, lk, cx, bar[1] + (bar[3] - bar[1]) * 0.5, z1, 6.0, 12.0, cap='hip', cap_rise=5.0)
    b.section('site')
    _site(b, lk, brief, F, txt, srng, bb, cx, front=26.0, forecourt='garden')
    return bb


# -------------------------------------------------------------------------------------------------------------- secretariat
def _secretariat(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    st_h = U.clamp(h / max(1, st), 3.4, 4.6)
    z1 = st_h * st
    ww = U.clamp(w * 0.2, 14.0, 20.0)
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 14.0, 26.0), srng, U.clamp(d * 0.4, 13, 20), ww)
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    wk = _wk(brief, 'ribbon')
    contemporary = style in ('contemporary', 'postmodern', 'high-tech')
    ratio = U.clamp(lk.ratio, 0.2, 0.6)
    bay = (4.2 if wk != 'punched' else 3.6) * (1 + 0.45 * coarse)
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.45, front_kind=wk, ground_kind='curtain' if contemporary and st > 1 else None)
    U.plinth_band(b, fp, lk, 0.9)
    b.section('roof')
    pitched = roof in ('hip', 'gable') and st <= 3
    if pitched:
        U.roof_rects(b, roof, rects, z1, lk, pitch=16 if lk.roof_slot in ('metal-roof', 'corrugated') else 22, ov=1.0)
    else:
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.7, ov=0.0)
    # floor-edge bands on the front and balcony bands
    front = [s for s in fp.edges() if s.front and s.length > 12]
    if b.detail == 0 and coarse < 2:
        for s in front:
            for k in range(1, st):
                lib.seg_box(b, s, 0, s.length, k * st_h - 0.15, k * st_h + 0.15, 0.08, shade(lk.trim_col, 0.97), lk.wall_slot)
    if 'balcony-bands' in F and b.detail < 2 and coarse < 3:
        for s in fp.edges():
            if s.length > 14 and (not s.front or fpk in ('H', 'U')):
                for k in range(1, st):
                    U.balcony_slab(b, s, k * st_h, proud=1.3, col=shade(lk.trim_col, 0.95), rail_h=0.9)
    # central core: taller stair/lift tower with louvres, and the porch
    b.section('entrance')
    cw = U.clamp((bar[2] - bar[0]) * 0.22, 10.0, 22.0)
    ent_y = bar[1]
    if 'portico' in F or 'colonnade' in F:
        if 'colonnade' in F:
            # a tall colonnade of square piers across the middle of the front (stripped-classical government house)
            cwid = U.clamp((bar[2] - bar[0]) * 0.55, 16.0, 60.0)
            _loggia(b, lk, cx - cwid / 2, cx + cwid / 2, ent_y, st_h * min(st, 2) + 0.2, depth=4.5, r=0.4, kind='square', col=lk.trim_col)
        else:
            U.portico_front(b, lk, cx, ent_y, cw, 5.0, 0.7, st_h * min(st, 2) - 0.4, 4, pediment_rise=None, steps_n=5, col_r=0.4, kind='square', col=lk.trim_col, entab_h=1.1, steps_w=cw * 0.7)
        seg = lib.Seg((cx - cw / 2, ent_y), (cx + cw / 2, ent_y))
        U.door(b, seg, cw / 2, 3.4, 3.2, frame=lk.trim_col, z=0.7 if 'colonnade' not in F else 0.0)
    else:
        U.entrance_canopy(b, lk, cx - cw / 2, cx + cw / 2, ent_y, st_h + 0.8, 6.0, th=0.5, columns=2, round_cols=True)
        seg = lib.Seg((cx - cw / 2, ent_y), (cx + cw / 2, ent_y))
        U.door(b, seg, cw / 2, 3.4, 3.0, frame=lk.trim_col)
        lib.steps(b, cx - cw * 0.3, cx + cw * 0.3, ent_y - 6.0, 0.5, 1.8, 3, 'paving', lk.stone_col) if b.detail < 2 else None
    if b.detail < 2 and not pitched:
        # stair / lift core above the middle of the bar
        core = lib.fp_rect(cw * 0.5, 7.0, cx, (bar[1] + bar[3]) / 2)
        U.walls(b, core, z1, z1 + st_h * 0.9, 1, lk, rng, kind='louvre' if b.detail == 0 else 'ribbon', ratio=0.5, plinth=0, rear='same', wall_col=lk.accent_col)
        lib.flat_roof(b, core, z1 + st_h * 0.9, lk, parapet_h=0.3, ov=0.4, slab=0.3)
        if b.detail == 0:
            U.roof_plant(b, lk, (bar[0] + 2, bar[1] + 2, bar[2] - 2, bar[3] - 2), z1, rng, count=2)
    if not pitched:
        U.skyline(b, lk, rects, z1, st_h, srng, rng, kind=wk, ratio=ratio, bay=bay)
        U.roof_variety(b, lk, [r[:4] for r in rects], z1, srng, st_h, kinds=('stair', 'tank', 'sign', 'mast'))
    if 'brise-soleil' in F and b.detail == 0:
        for s in front:
            U.fins_row(b, s, 0.5, z1 - 0.3, pitch=1.4, w=0.1, proud=0.5, col=shade(lk.accent_col, 0.95), u0=3.0, u1=s.length - 3.0)
    if 'canopy-walkway' in F and b.detail < 2:
        U.covered_walk(b, lk, (cx - cw / 2 - 2.0, ent_y - 3.0), (bar[0] + 6.0, ent_y - 3.0), 3.0, 2.8)
    b.section('site')
    holes = fp.polys[1:]
    if fpk == 'U':
        wings = [r for r in rects if r[4] == 'wing']
        if len(wings) == 2:
            U.courtyard_garden(b, lk, (wings[0][2] + 1.0, bar[3], wings[1][0] - 1.0, bb[3] + 3), srng, trees=3)
    elif holes:
        xs = [p[0] for p in holes[0]]
        ys = [p[1] for p in holes[0]]
        U.courtyard_garden(b, lk, (min(xs) + 1, min(ys) + 1, max(xs) - 1, max(ys) - 1), srng, trees=3)
    _site(b, lk, brief, F, txt, srng, bb, cx, front=26.0, forecourt='parking' if 'car-park' in F else 'plaza')
    return bb


# ------------------------------------------------------------------------------------------------------------------ islamic
def _islamic(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    st = min(st, 3)
    st_h = U.clamp(h / max(1, st), 4.0, 6.0)
    z1 = st_h * st
    w = U.clamp(w, 30.0, 110.0)
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 16.0, 32.0), srng, U.clamp(d * 0.45, 14, 22), U.clamp(w * 0.2, 12, 20))
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    dome_col = srng.choice(['#2f7d6a', '#2d5f8a', '#c9a24a', lk.accent_col])
    b.section('walls')
    bay = 4.2 * (1 + 0.45 * coarse)
    U.walls(b, fp, 0, z1, st, lk, rng, kind='pointed-arch', ratio=U.clamp(lk.ratio, 0.22, 0.34), bay=bay, plinth=0.5)
    U.plinth_band(b, fp, lk, 0.9)
    b.section('roof')
    lib.flat_roof(b, fp, z1, lk, parapet_h=0.0)
    # pointed merlons along the parapet
    for s in fp.edges():
        U.crenellate_seg(b, s, z1, h=0.9, w=0.7, pitch=1.7, thick=0.35, col=shade(lk.wall_col, 1.04), slot=lk.wall_slot)
    # relief band of geometric panels under the parapet
    if b.detail == 0:
        for s in fp.edges():
            if s.front and s.length > 8:
                n = int(s.length / 1.6)
                for k in range(n):
                    if k % 2 == 0:
                        lib.seg_box(b, s, k * 1.6 + 0.2, k * 1.6 + 1.4, z1 - 1.5, z1 - 0.5, 0.06, lk.accent_col, lk.wall_slot)
    # front arcade along the whole front bar
    b.section('arcade')
    wing_w = U.clamp((bar[2] - bar[0]) * 0.2, 8.0, 16.0)
    iw = U.clamp((bar[2] - bar[0]) * 0.18, 10.0, 16.0)
    if b.detail < 2:
        U.arcade(b, lk, (bar[0] + 0.5, bar[1]), (cx - iw / 2 - 0.3, bar[1]), 0, 3.4, st_h - 0.1, 2.8, bay_w=4.2, pier_w=0.9, col=lk.trim_col, pointed=True, horseshoe=False)
        U.arcade(b, lk, (cx + iw / 2 + 0.3, bar[1]), (bar[2] - 0.5, bar[1]), 0, 3.4, st_h - 0.1, 2.8, bay_w=4.2, pier_w=0.9, col=lk.trim_col, pointed=True)
    # central iwan: a tall rectangular portal frame with a big pointed arch, rising above the roofline
    b.section('iwan')
    ih = z1 + st_h * 0.9
    idp = 3.0
    iseg = lib.Seg((cx - iw / 2, bar[1] - idp), (cx + iw / 2, bar[1] - idp))
    if b.detail >= 2:
        lib.box(b, cx - iw / 2, bar[1] - idp, 0, cx + iw / 2, bar[1], ih, 'plain', lk.wall_col, skip=('bottom',))
    else:
        U.arch_portal(b, iseg, 0, iw, 0, ih, iw / 2, iw * 0.62, ih * 0.42, shade(lk.wall_col, 1.04), lk.wall_slot, pointed=True, tall=1.15)
        for xs, sgn in ((cx - iw / 2, -1), (cx + iw / 2, 1)):
            b.facing([(xs, bar[1] - idp, 0), (xs, bar[1], 0), (xs, bar[1], ih), (xs, bar[1] - idp, ih)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.94))
        lib.box(b, cx - iw / 2, bar[1] - idp, ih, cx + iw / 2, bar[1], ih + 0.5, lk.wall_slot, lk.accent_col, top_slot='roof-flat', top_col=lk.roof_col, skip=())
        if b.detail == 0:
            # decorative band round the arch
            lib.seg_box(b, iseg, 0.3, iw - 0.3, ih - 1.6, ih - 0.9, 0.08, lk.accent_col, lk.wall_slot)
    # dome on a drum behind the iwan, plus smaller domes at the wing ends
    b.section('domes')
    dr = U.clamp(iw * 0.45, 4.0, 9.0)
    dy = bar[1] + (bar[3] - bar[1]) * 0.5
    if 'minaret' not in F or True:
        lib.dome(b, cx, dy, z1 + 0.1, dr, lk, profile='pointed', drum=dr * 0.55, drum_r=dr * 1.02, drum_slot=lk.wall_slot, drum_col=lk.trim_col, lantern=dr * 0.2, finial=1.6,
                 slot='metal-roof', col=dome_col)
    for sgn in (-1, 1):
        sx = (bar[0] + wing_w * 0.4) if sgn < 0 else (bar[2] - wing_w * 0.4)
        sy = bar[1] + 3.0
        if b.detail < 2:
            lib.dome(b, sx, sy, z1 + 0.1, 2.4, lk, profile='onion', height=3.4, drum=1.4, drum_r=2.0, drum_slot=lk.wall_slot, drum_col=lk.trim_col, finial=0.8, slot='metal-roof', col=dome_col)
    # slender corner towers (minarets when asked)
    b.section('towers')
    th = z1 + st_h * (1.9 if 'minaret' in F else 1.1)
    for sgn in (-1, 1):
        tx = bb[0] + 1.5 if sgn < 0 else bb[2] - 1.5
        ty = bb[1] + 1.5
        n = 8 if b.detail == 0 else 6
        r = 1.1 if 'minaret' in F else 1.5
        lib.cylinder(b, tx, ty, 0, th, r, n=n, slot=lk.wall_slot, col=shade(lk.wall_col, 1.05), r_top=r * 0.88, top=False, smooth=False)
        if b.detail < 2:
            lib.cylinder(b, tx, ty, th - 2.2, th - 1.9, r * 1.7, n=n, slot=lk.wall_slot, col=lk.trim_col, r_top=r * 1.7, top=True, smooth=False)
            lib.dome(b, tx, ty, th - 1.9, r * 1.0, lk, profile='onion', height=r * 3.0, slot='metal-roof', col=dome_col, finial=0.8)
        else:
            lib.cylinder(b, tx, ty, th, th + 2.0, r, n=6, slot='plain', col=dome_col, r_top=0.0, top=False, smooth=False)
    b.section('site')
    holes = fp.polys[1:]
    if holes:
        xs = [p[0] for p in holes[0]]
        ys = [p[1] for p in holes[0]]
        U.courtyard_garden(b, lk, (min(xs) + 1, min(ys) + 1, max(xs) - 1, max(ys) - 1), srng, fountain_r=2.8, trees=2)
    elif fpk == 'U':
        wings = [r for r in rects if r[4] == 'wing']
        if len(wings) == 2:
            U.courtyard_garden(b, lk, (wings[0][2] + 1.0, bar[3], wings[1][0] - 1.0, bb[3] + 3), srng, trees=2)
    F2 = dict(F)
    _site(b, lk, brief, F2, txt, srng, bb, cx, front=28.0, forecourt='plaza')
    return bb


# -------------------------------------------------------------------------------------------------------------------- arewa
def _arewa(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    st = min(st, 3)
    st_h = U.clamp(h / max(1, st), 3.8, 5.0)
    z1 = st_h * st
    wmax = U.clamp(w, 30.0, 105.0)
    rects = _plan(fpk, wmax, d if fpk != 'rect' else U.clamp(d, 16.0, 36.0), srng, U.clamp(d * 0.4, 14, 24), U.clamp(wmax * 0.18, 12, 20))
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    mud = lk.wall_slot in ('mud-render', 'plain-render')
    if lk.wall_slot not in ('mud-render', 'plain-render'):
        pass
    trim = lk.trim_col
    b.section('walls')
    bay = 4.4 * (1 + 0.45 * coarse)
    U.walls(b, fp, 0, z1, st, lk, rng, kind='arched', ratio=U.clamp(lk.ratio * 0.9, 0.12, 0.26), bay=bay, plinth=0.6)
    if b.detail == 0:
        lib.sweep(b, fp, 0.0, [(0.12, 0), (0.12, 1.0), (0, 1.0)], lk.wall_slot, shade(lk.wall_col, 0.85))
    b.section('roof')
    roofk = form.get('roof') or 'flat'
    if roofk in ('hip', 'gable') and lk.roof_slot in ('clay-tile', 'corrugated', 'metal-roof'):
        # tiled roof set behind the crenellated parapet (government-house variant)
        U.roof_rects(b, 'hip', [(r[0] + 1.5, r[1] + 1.5, r[2] - 1.5, r[3] - 1.5) for r in rects], z1 + 0.9, lk, pitch=18, ov=0.0)
    lib.flat_roof(b, fp, z1, lk, parapet_h=0.0)
    # parapet wall + merlons + corner horns
    for s in fp.edges():
        lib.seg_box(b, s, 0, s.length, z1, z1 + 0.9, 0.0, lk.wall_col, lk.wall_slot, inset=0.4) if b.detail < 2 else None
        U.crenellate_seg(b, s, z1 + 0.9, h=0.7, w=0.7, pitch=2.0, thick=0.4, col=trim, slot=lk.wall_slot)
    ph = 3.4
    if b.detail < 2:
        for poly in fp.polys[:1]:
            for k, p in enumerate(poly):
                if b.detail == 1 and k % 2:
                    continue
                U.pinnacle(b, p[0] + (0.3 if p[0] < 0 else -0.3), p[1] + (0.3 if p[1] < 0 else -0.3), z1 + 0.9, ph, 1.1, lk.wall_col, slot=lk.wall_slot)
    # relief bands: a row of raised squares under the parapet and round the portal
    if b.detail == 0 and ('relief-pattern' in F or True):
        for s in fp.edges():
            if s.front and s.length > 8:
                n = int(s.length / 1.4)
                for k in range(n):
                    lib.seg_box(b, s, k * 1.4 + 0.3, k * 1.4 + 1.1, z1 - 1.3, z1 - 0.5, 0.07, trim if k % 2 == 0 else shade(trim, 0.85), lk.wall_slot)
    # zaure gatehouse: a projecting entrance block with a big arch and its own horns
    b.section('zaure')
    zw = U.clamp((bar[2] - bar[0]) * 0.2, 9.0, 16.0)
    zd = 5.0
    zh = z1 + st_h * 0.3
    zseg = lib.Seg((cx - zw / 2, bar[1] - zd), (cx + zw / 2, bar[1] - zd))
    if b.detail >= 2:
        lib.box(b, cx - zw / 2, bar[1] - zd, 0, cx + zw / 2, bar[1], zh, 'plain', lk.wall_col, skip=('bottom',))
    else:
        U.arch_portal(b, zseg, 0, zw, 0, zh, zw / 2, zw * 0.5, 3.2, lk.wall_col, lk.wall_slot, pointed=False)
        for xs, sgn in ((cx - zw / 2, -1), (cx + zw / 2, 1)):
            b.facing([(xs, bar[1] - zd, 0), (xs, bar[1], 0), (xs, bar[1], zh), (xs, bar[1] - zd, zh)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.94))
        zfp = lib.fp_rect(zw, zd, cx, bar[1] - zd / 2)
        lib.flat_roof(b, zfp, zh, lk, parapet_h=0.0)
        for s in zfp.edges():
            U.crenellate_seg(b, s, zh, h=0.7, w=0.7, pitch=2.0, thick=0.4, col=trim, slot=lk.wall_slot)
        for (hx, hy) in ((cx - zw / 2 + 0.4, bar[1] - zd + 0.4), (cx + zw / 2 - 0.4, bar[1] - zd + 0.4), (cx - zw / 2 + 0.4, bar[1] - 0.4), (cx + zw / 2 - 0.4, bar[1] - 0.4)):
            U.pinnacle(b, hx, hy, zh, ph * 1.1, 1.2, lk.wall_col, slot=lk.wall_slot)
        if b.detail == 0:
            for k in range(7):
                lib.seg_box(b, zseg, 0.5 + k * (zw - 1.0) / 6, 0.5 + k * (zw - 1.0) / 6 + 0.5, zh - 1.2, zh - 0.4, 0.07, shade(trim, 0.85 if k % 2 else 1.0), lk.wall_slot)
    # a portico / colonnade where the brief asks for one (government houses of the north often add a modern arcade)
    if 'colonnade' in F and b.detail < 2:
        U.arcade(b, lk, (bar[0] + 1.0, bar[1]), (cx - zw / 2 - 0.5, bar[1]), 0, 3.4, st_h - 0.2, 2.8, bay_w=4.0, pier_w=0.8, col=lk.trim_col, pointed=False)
        U.arcade(b, lk, (cx + zw / 2 + 0.5, bar[1]), (bar[2] - 1.0, bar[1]), 0, 3.4, st_h - 0.2, 2.8, bay_w=4.0, pier_w=0.8, col=lk.trim_col, pointed=False)
    b.section('site')
    holes = fp.polys[1:]
    if fpk == 'U':
        wings = [r for r in rects if r[4] == 'wing']
        if len(wings) == 2:
            U.courtyard_garden(b, lk, (wings[0][2] + 1.0, bar[3], wings[1][0] - 1.0, bb[3] + 3), srng, trees=2)
    elif holes:
        xs = [p[0] for p in holes[0]]
        ys = [p[1] for p in holes[0]]
        U.courtyard_garden(b, lk, (min(xs) + 1, min(ys) + 1, max(xs) - 1, max(ys) - 1), srng, trees=2)
    _site(b, lk, brief, F, txt, srng, bb, cx, front=26.0, forecourt='plaza')
    return bb


# ------------------------------------------------------------------------------------------------------------------- soviet
def _soviet(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    st = max(3, min(st, 8))
    st_h = U.clamp(h / st, 3.8, 5.2)
    z1 = st_h * st
    w = U.clamp(w, 50.0, 110.0)
    dd = U.clamp(d, 22.0, 50.0)
    cw = U.clamp(w * 0.3, 18.0, 34.0)
    wing = (-w / 2, -dd / 2, w / 2, dd / 2)
    bb = wing
    wfp = U.union_fp([wing])
    zw = z1 - st_h * 1.0
    b.section('walls')
    bay = 3.4 * (1 + 0.45 * coarse)
    ratio = U.clamp(lk.ratio, 0.28, 0.4)
    st_w = st - 1
    U.walls(b, wfp, 0, zw, st_w, lk, rng, kind='punched', ratio=ratio, bay=bay, plinth=0.0, ground_h=st_h * 1.2)
    if b.detail == 0:
        lib.sweep(b, wfp, 0.0, [(0.12, 0), (0.12, 1.4), (0, 1.4)], 'stone-blocks', shade(lk.wall_col, 0.8))
        U.string_course(b, wfp, st_h * 1.2, lk, 0.4, 0.2)
        U.eaves_band(b, wfp, zw + 0.7, lk, 0.7, 0.8)
    for s in wfp.edges():
        if s.front or s.rear:
            n = max(3, int(s.length / 3.4))
            us = [s.length * (k + 0.5) / n for k in range(n)]
            U.piers(b, s, [s.length * k / n for k in range(1, n)], st_h * 1.2, zw - 0.2, 0.55, 0.28, shade(lk.trim_col, 1.0), lk.wall_slot)
    lib.flat_roof(b, wfp, zw, lk, parapet_h=0.0, ov=0.0)
    # stepped central tower: three tiers and a spire
    b.section('tower')
    tiers = [(cw, dd * 0.72, z1), (cw * 0.72, dd * 0.55, z1 + st_h * 2.2), (cw * 0.5, dd * 0.4, z1 + st_h * 3.8)]
    z0 = zw - 0.01
    for k, (tw, td, ztop) in enumerate(tiers):
        tf = lib.fp_rect(tw, td, 0.0, dd * 0.05 - (dd * 0.05 if k else 0.0))
        ns = max(1, round((ztop - z0) / st_h))
        U.walls(b, tf, z0, ztop, ns, lk, rng, kind='punched', ratio=ratio * 0.9, bay=bay, plinth=0, rear='same')
        if b.detail == 0:
            U.eaves_band(b, tf, ztop + 0.6, lk, 0.6, 0.6)
            for s in tf.edges():
                n = max(2, int(s.length / 3.2))
                U.piers(b, s, [s.length * j / n for j in range(1, n)], z0 + 0.5, ztop - 0.3, 0.5, 0.26, shade(lk.trim_col, 1.0), lk.wall_slot)
        lib.flat_roof(b, tf, ztop, lk, parapet_h=0.0)
        z0 = ztop
    zt = z0
    ty = 0.0
    if b.detail < 2:
        lib.cylinder(b, 0.0, ty, zt, zt + 3.0, cw * 0.18, n=8, slot=lk.wall_slot, col=lk.trim_col, r_top=cw * 0.12, top=True, smooth=False)
        lib.cylinder(b, 0.0, ty, zt + 3.0, zt + 14.0, cw * 0.12, n=8, slot='metal-roof', col=mix(lk.roof_col, '#b8a050', 0.5), r_top=0.0, top=False, smooth=False)
        lib.cylinder(b, 0.0, ty, zt + 14.0, zt + 17.0, 0.08, n=4, slot='frame', col=lk.metal_col, r_top=0.03, top=True)
    else:
        lib.cylinder(b, 0.0, ty, zt, zt + 12.0, cw * 0.12, n=6, slot='plain', col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    # grand entrance: a deep portal of square piers
    b.section('entrance')
    pw = cw * 0.8
    U.portico_front(b, lk, 0.0, -dd / 2, pw, 4.0, 0.9, st_h * 1.6, 6, pediment_rise=None, steps_n=6, col_r=0.5, kind='square', col=lk.trim_col, entab_h=1.5, steps_w=pw * 0.8)
    seg = lib.Seg((-cw / 2, -dd / 2), (cw / 2, -dd / 2))
    U.door(b, seg, cw / 2, 4.2, 4.0, frame=lk.trim_col, z=0.9)
    b.section('site')
    _site(b, lk, brief, F, txt, srng, bb, 0.0, front=28.0, forecourt='plaza')
    return bb


# ----------------------------------------------------------------------------------------------------------------- brasilia
def _brasilia(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    st = max(1, min(st, 4))
    st_h = U.clamp(h / st, 4.0, 6.0)
    z1 = st_h * st
    w = U.clamp(w, 40.0, 110.0)
    d = U.clamp(d, 26.0, 70.0)
    fpk = form.get('footprint') or 'rect'
    b.section('podium')
    # raised paved platform with a ramp
    pod = (-w / 2 - 4.0, -d / 2 - 5.0, w / 2 + 4.0, d / 2 + 4.0)
    if b.detail < 2:
        lib.box(b, pod[0], pod[1], 0, pod[2], pod[3], 1.2, 'stone-blocks', shade(lk.stone_col, 0.95), top_slot='paving', top_col=mix(lk.stone_col, '#ffffff', 0.2), skip=('bottom',))
        lib.steps(b, -w * 0.14, w * 0.14, pod[1] - 0.0, 1.2, 4.0, 5, 'paving', lk.stone_col)
    # inner glass volume, set well back from the colonnade
    b.section('walls')
    inset = 5.5
    gl = (-w / 2 + inset, -d / 2 + inset * 0.8, w / 2 - inset, d / 2 - inset * 0.8)
    gfp = U.union_fp([gl])
    if fpk == 'U' or fpk == 'H':
        gl2 = U.plan_rects('U', w - 2 * inset, d - 2 * inset * 0.8, None, bar_d=(d - 2 * inset) * 0.45, wing_w=(w - 2 * inset) * 0.22)
        gfp = U.union_fp([r[:4] for r in gl2])
    zz0 = 1.2
    ns = st
    U.walls(b, gfp, zz0, zz0 + z1 - 0.6, ns, lk, rng, kind='curtain', bay=3.4 * (1 + 0.45 * coarse), plinth=0, rear='same')
    # thin overhanging roof slab carried on a ring of slender columns
    b.section('colonnade')
    slab_z = zz0 + z1 + 0.5
    ov = 2.4
    sx0, sy0, sx1, sy1 = -w / 2, -d / 2, w / 2, d / 2
    sfp = lib.fp_rect(sx1 - sx0, sy1 - sy0, 0, 0)
    lib.flat_roof(b, sfp, slab_z, lk, parapet_h=0.0, ov=0.6, slab=0.9, col=lk.roof_col)
    if b.detail < 2:
        pitch = 5.4
        nx = max(3, int((sx1 - sx0) / pitch))
        ny = max(2, int((sy1 - sy0) / (pitch * 1.15)))
        nx = nx if b.detail == 0 else max(3, nx // 2)
        ny = ny if b.detail == 0 else max(2, ny // 2)
        pts = []
        for k in range(nx + 1):
            x = sx0 + 0.8 + (sx1 - sx0 - 1.6) * k / nx
            pts += [(x, sy0 + 0.8), (x, sy1 - 0.8)]
        for k in range(1, ny):
            y = sy0 + 0.8 + (sy1 - sy0 - 1.6) * k / ny
            pts += [(sx0 + 0.8, y), (sx1 - 0.8, y)]
        for (x, y) in pts:
            # slender columns that taper toward the base (the Alvorada profile)
            r_ = 0.42
            lib.cylinder(b, x, y, zz0, zz0 + 0.4, 0.5, n=6, slot=lk.wall_slot, col=lk.trim_col, r_top=r_, top=False) if b.detail == 0 else None
            lib.cylinder(b, x, y, zz0 + (0.4 if b.detail == 0 else 0.0), slab_z - 0.9, r_, n=8 if b.detail == 0 else 5, slot=lk.wall_slot, col=lk.trim_col, r_top=r_ * 0.7, top=False, smooth=True)
    # optional assembly bowl on the roof behind (a shallow saucer dome)
    if 'dome' in F or U.has(txt, 'assembly', 'parliament', 'congress'):
        b.section('bowl')
        rr = U.clamp(w * 0.12, 6.0, 12.0)
        lib.dome(b, w * 0.18, 0.0, slab_z + 0.0, rr, lk, profile='shallow', height=rr * 0.55, slot='roof-flat', col=lk.wall_col)
    if 'flags' in F and b.detail < 2:
        pass
    b.section('site')
    if b.detail < 2:
        # reflecting pool on the forecourt
        with b.site():
            b.face([(-w * 0.35, pod[1] - 26.0, 0.1), (w * 0.35, pod[1] - 26.0, 0.1), (w * 0.35, pod[1] - 6.0, 0.1), (-w * 0.35, pod[1] - 6.0, 0.1)], 'plain-render', '#6fa8c4')
            if b.detail == 0:
                lib.box(b, -w * 0.35 - 0.5, pod[1] - 26.5, 0, w * 0.35 + 0.5, pod[1] - 26.0, 0.4, 'paving', '#c8c4ba')
                lib.box(b, -w * 0.35 - 0.5, pod[1] - 6.0, 0, w * 0.35 + 0.5, pod[1] - 5.5, 0.4, 'paving', '#c8c4ba')
    F2 = {k: v for k, v in F.items() if k != 'fountain'}
    _site(b, lk, brief, F2, txt, srng, pod, 0.0, front=34.0, forecourt='plaza')
    return (sx0, sy0, sx1, sy1)


# --------------------------------------------------------------------------------------------------------------- brutalist
def _brutalist(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    st = max(2, min(st, 6))
    st_h = U.clamp(h / st, 3.6, 5.0)
    z1 = st_h * st
    w = U.clamp(w, 30.0, 100.0)
    d = U.clamp(d, 18.0, 50.0)
    sw = U.clamp(w * 0.26, 10.0, 22.0)
    proj = 5.0
    centre = (-w / 2 + sw, -d / 2, w / 2 - sw, d / 2)
    left = (-w / 2, -d / 2 - proj, -w / 2 + sw, d / 2)
    right = (w / 2 - sw, -d / 2 - proj, w / 2, d / 2)
    rects = [(centre + ('bar',)), (left + ('wing',)), (right + ('wing',))]
    bb = (-w / 2, -d / 2 - proj, w / 2, d / 2)
    cfp = U.union_fp([centre])
    b.section('walls')
    bay = 3.6 * (1 + 0.45 * coarse)
    # centre recess: glazed bands behind a deep concrete grid
    U.walls(b, cfp, 0, z1, st, lk, rng, kind='ribbon', ratio=0.5, bay=bay, plinth=0.0, front_kind='ribbon')
    for r in (left, right):
        sfp = U.union_fp([r])
        # side blocks: nearly blank concrete, a few tall slit windows
        U.mass_walls(b, lk, sfp, 0, z1, st, others=[centre], rng=rng, kind='punched', ratio=0.1, bay=7.0 * (1 + 0.3 * coarse), plinth=0.0)
        lib.flat_roof(b, sfp, z1, lk, parapet_h=0.0, ov=0.0)
        if b.detail < 2:
            U.eaves_band(b, sfp, z1 + 1.0, lk, 1.0, 0.7, col=shade(lk.wall_col, 0.92))
    lib.flat_roof(b, cfp, z1, lk, parapet_h=0.0)
    # deep concrete frame over the centre front: cantilevered upper floors
    b.section('frame')
    if b.detail < 2:
        cseg = lib.Seg((centre[0], centre[1]), (centre[2], centre[1]))
        L = cseg.length
        lib.seg_box(b, cseg, 0, L, z1 - st_h * 1.0, z1, 1.6, shade(lk.wall_col, 0.9), lk.wall_slot)
        for k in range(1, st):
            if b.detail == 0:
                lib.seg_box(b, cseg, 0, L, k * st_h - 0.3, k * st_h + 0.3, 0.9, shade(lk.wall_col, 0.95), lk.wall_slot)
        n = max(3, int(L / 5.5))
        for k in range(n + 1):
            u = min(max(L * k / n, 0.4), L - 0.4)
            lib.seg_box(b, cseg, u - 0.4, u + 0.4, 0, z1 - st_h * 1.0, 1.2, shade(lk.wall_col, 0.92), lk.wall_slot)
        if 'relief-pattern' in F:
            # the big blank relief panel on the left block's front face (arms / emblem panel, no lettering)
            lseg = lib.Seg((left[0], left[1]), (left[2], left[1]))
            lib.seg_box(b, lseg, lseg.length * 0.15, lseg.length * 0.85, z1 - st_h * 1.6, z1 - st_h * 0.4, 0.5, shade(lk.accent_col, 1.0), lk.wall_slot)
    if 'balcony-bands' in F and b.detail == 0:
        pass
    b.section('entrance')
    ew = U.clamp((centre[2] - centre[0]) * 0.4, 8.0, 16.0)
    U.entrance_canopy(b, lk, -ew / 2, ew / 2, centre[1], st_h * 1.0 + 0.5, 5.0, th=0.6, columns=2)
    seg = lib.Seg((-ew / 2, centre[1]), (ew / 2, centre[1]))
    U.door(b, seg, ew / 2, 3.4, 3.0, frame=lk.trim_col)
    if b.detail < 2:
        lib.steps(b, -ew * 0.4, ew * 0.4, centre[1] - 5.0, 0.6, 2.0, 4, 'paving', lk.stone_col)
    b.section('site')
    _site(b, lk, brief, F, txt, srng, bb, 0.0, front=22.0, forecourt='road' if lk.forecourt == 'road' else 'plaza')
    return bb


# ----------------------------------------------------------------------------------------------------------------- build
def _build(brief, style, rng, detail, coarse):
    b = U.new_builder('civic-palace', detail, coarse, brief=brief)
    lk = U.look_for(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    F = U.feats(brief)
    txt = U.text(brief)
    typ, dims = infer(brief)
    fn = {'neoclassical': _neoclassical, 'colonial': _colonial, 'secretariat': _secretariat, 'islamic': _islamic, 'arewa': _arewa, 'soviet': _soviet,
          'brasilia': _brasilia, 'brutalist': _brutalist}[typ]
    fn(b, lk, brief, F, txt, srng, rng, dims, coarse)
    return b


def build(brief, style, rng, detail):
    return U.run(lambda r, coarse: _build(brief, style, r, detail, coarse), rng, detail)
