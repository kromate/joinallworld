"""museum-theatre: museums, galleries, theatres, opera houses, cinemas, cultural and convention centres. Typologies chosen from the wording
(name / subject), the style, footprint, roof and features:

  classical   neoclassical / baroque museum or palace: giant portico with pediment, pavilions, arched windows, cornice, optional dome
  colonial    colonial villa or institutional block: veranda / gallery, hip roof, gabled porch (the typical African national museum)
  courtyard   walled courtyard museum: Hausa / Sahelian (mud walls, crenellation, horn pinnacles, zaure gate, cannons) or Arab-Islamic
              (arcaded patio, pointed arches, small domes, tiled pavilions) or a plain colonial courtyard
  modern      gallery / cultural centre of boxes: glazed entrance bay, canopy, stepped terraces, double-arch colonnade, hexagonal pods,
              sawtooth gallery or mud-brick domes depending on roof and wording
  flytower    theatre: foyer block, auditorium box and a tall blank fly tower; concrete (brutalist) or white (modernist) versions
  cinema      art-deco picture house: narrow frontage, canopy, vertical fin and a tall blank box behind
  oval        oval performance hall under a sweeping, wing-like roof (curved or shed roof on an oval or round plan)
  roundmuseum drum museum: stacked, conical-topped tiers (round plan) or a plain round block with a ring colonnade
  domelattice big glazed lattice dome over a round hall (convention centres)
  shells      opera-house sails on a podium (when the brief says sails / shells / opera house)
  cap         the 'military cap' National Theatre (Lagos): a huge flared cap roof on a drum with two flanking halls
  open        open-air venue: stepped seating bowl and a stage shelter, or big shed roofs on posts

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

FEATURES = {'steps', 'flags', 'fence-wall', 'signage-board', 'courtyard', 'statue', 'gate', 'relief-pattern', 'portico', 'car-park', 'painted-mural',
            'arcade', 'curved-canopy', 'atrium-glass', 'balcony-bands', 'pinnacles', 'colonnade', 'cannon', 'arches', 'sheds', 'roof-terrace',
            'terrace', 'dome', 'louvres', 'flat-canopy', 'platform-canopy', 'rail-tracks', 'ramparts', 'crenellation', 'chimney', 'kiosk', 'railings',
            'fountain', 'pediment', 'mast', 'obelisk', 'neon-strip', 'mosaic', 'awning'}

CLASSICAL = ('neoclassical', 'georgian', 'baroque', 'victorian')


# ------------------------------------------------------------------------------------------------------------- inference
def infer(brief):
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    txt = U.text(brief)
    subj = ' '.join(str(brief.get(k) or '') for k in ('name', 'subject')).lower()
    F = U.feats(brief)
    w, d, st, h = U.dims(brief, 40, 22, 2, st_h=4.0, w_max=112.0)
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    var = str(form.get('variant') or '').lower()
    if var in ('classical', 'colonial', 'courtyard', 'modern', 'flytower', 'cinema', 'oval', 'roundmuseum', 'domelattice', 'shells', 'cap', 'open'):
        return var, (w, d, st, h)
    if U.has(subj, 'military cap', 'cap-shaped', 'cap shaped'):
        return 'cap', (w, d, st, h)
    perf = U.has(subj, 'theatre', 'theater', 'opera', 'playhouse', 'concert', 'cinema', 'auditorium', 'scala', '7 arts', 'seven arts', 'reps ')
    venue = U.has(subj, 'convention', 'congress', 'conference', 'cultural cent', 'palais de la culture', 'cultural palace', 'festival')
    if U.has(subj, 'opera house', 'sail-like', ' sails', 'shell-roof'):
        return 'shells', (w, d, st, h)
    if fpk == 'round' and (roof == 'dome' or U.has(subj, 'convention')):
        return 'domelattice', (w, d, st, h)
    if perf:
        if fpk in ('oval', 'round') or (roof in ('curved', 'shed') and fpk in ('oval',)):
            return 'oval', (w, d, st, h)
        if U.has(subj, 'cinema', 'scala') or (style == 'art-deco' and w <= 40):
            return 'cinema', (w, d, st, h)
        if roof == 'none' or U.has(subj, 'open theatre', 'open-air', 'open air'):
            return 'open', (w, d, st, h)
        if w <= 40 and st <= 2 and style not in ('brutalist',) and roof in ('gable', 'hip'):
            return 'colonial' if style in ('colonial', 'vernacular') else 'modern', (w, d, st, h)
        return 'flytower', (w, d, st, h)
    if fpk == 'round':
        return 'roundmuseum', (w, d, st, h)
    if U.has(subj, 'shrine') and roof in ('shed',) or (style == 'vernacular' and roof in ('shed',) and fpk == 'irregular'):
        return 'open', (w, d, st, h)
    if style in CLASSICAL and style != 'victorian' or (style == 'victorian' and st >= 2 and w >= 40):
        return 'classical', (w, d, st, h)
    if style in ('hausa-arewa', 'sahelian', 'arab-islamic') or (fpk in ('U', 'ring') and 'courtyard' in F and style in ('vernacular',)):
        return 'courtyard', (w, d, st, h)
    if style in ('colonial', 'caribbean', 'swahili', 'nordic', 'tudor') or (style == 'vernacular' and roof in ('hip', 'gable') and not venue):
        if fpk in ('U', 'ring') and 'courtyard' in F and style == 'colonial' and w >= 45:
            return 'courtyard', (w, d, st, h)
        return 'colonial', (w, d, st, h)
    if style in ('postmodern', 'contemporary', 'modernist', 'high-tech', 'international', 'brutalist', 'art-deco', 'soviet') or venue:
        return 'modern', (w, d, st, h)
    return 'colonial' if roof in ('hip', 'gable') else 'modern', (w, d, st, h)


def _wk(brief, default):
    wk = (brief.get('facade') or {}).get('windows')
    return wk if wk in ('curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre') else default


def _plan(fpk, w, d, srng, bar_d=None, wing_w=None):
    side = 'left' if srng.random() < 0.4 else 'right'
    if fpk == 'cross':
        fpk = 'H'
    if fpk not in ('L', 'U', 'H', 'T', 'ring', 'irregular'):
        return U.plan_rects('rect', w, d)
    return U.plan_rects(fpk, w, d, None, bar_d=bar_d, wing_w=wing_w, side=side, open_to='back')


def _bar(rects):
    return max([r for r in rects if r[4] == 'bar'] or rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))


def _site(b, lk, brief, F, txt, srng, bb, cx, front=20.0, forecourt='plaza', **kw):
    return U.site_common(b, lk, brief, F, txt, srng, bb, cx=cx, front=front, tank_at=(bb[2] + 6, bb[3] - 3), trees=5, forecourt_default=forecourt, flag_h=9.0,
                         statue_h=4.5, fence_default=('gate' in F or 'fence-wall' in F), **kw)


def _courtyard_for(b, lk, fp, rects, bar, bb, srng, F, fountain=False):
    holes = fp.polys[1:]
    if holes:
        xs = [p[0] for p in holes[0]]
        ys = [p[1] for p in holes[0]]
        U.courtyard_garden(b, lk, (min(xs) + 1, min(ys) + 1, max(xs) - 1, max(ys) - 1), srng, fountain_r=2.8 if fountain else 0.0, trees=2)
        return
    wings = [r for r in rects if r[4] == 'wing']
    if len(wings) == 2 and abs(wings[0][1] - wings[1][1]) < 0.5:
        U.courtyard_garden(b, lk, (wings[0][2] + 1.0, bar[3], wings[1][0] - 1.0, bb[3] + 3), srng, fountain_r=2.8 if fountain else 0.0, trees=2)


def _tint_roof(lk, col):
    lk.roof_col = col


# ---------------------------------------------------------------------------------------------------------------- classical
def _classical(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    st = min(max(st, 1), 4)
    st_h = U.clamp(h / st, 3.8, 6.0)
    z1 = st_h * st
    roof = form.get('roof') or 'hip'
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 16.0, 34.0), srng, U.clamp(d * 0.45, 14, 24), U.clamp(w * 0.18, 12, 20))
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    pav = U.clamp((bar[2] - bar[0]) * 0.14, 7.0, 14.0)
    extra = [(bar[0], bar[1] - 2.0, bar[0] + pav, bar[1], 'wing'), (bar[2] - pav, bar[1] - 2.0, bar[2], bar[1], 'wing')] if (bar[2] - bar[0]) > 36 else []
    allr = rects + extra
    bb = U.bbox_of(allr)
    fp = U.union_fp([r[:4] for r in allr])
    b.section('walls')
    ratio = U.clamp(lk.ratio, 0.2, 0.34)
    bay = 4.0 * (1 + 0.45 * coarse)
    U.walls(b, fp, 0, z1, st, lk, rng, kind='punched', ratio=ratio, bay=bay, plinth=0.0, ground_kind='arched' if b.detail < 2 else None, ground_h=st_h * 1.1 if st > 1 else None)
    if b.detail == 0:
        lib.sweep(b, fp, 0.0, [(0.1, 0), (0.1, 1.1), (0, 1.1)], 'stone-blocks', shade(lk.wall_col, 0.84))
        if st > 1:
            U.string_course(b, fp, st_h * 1.1, lk, 0.3, 0.14)
        for s in fp.edges():
            if s.length > 8:
                n = max(1, int(s.length / 4.2))
                U.piers(b, s, [s.length * k / n for k in range(n + 1)], 0.6, z1 - 0.2, 0.6, 0.2, shade(lk.trim_col, 1.0), lk.wall_slot)
    b.section('roof')
    dome = ('dome' in F) or roof == 'dome'
    if roof in ('hip', 'gable') or dome:
        U.roof_rects(b, 'hip', rects, z1, lk, pitch=22 if lk.roof_slot in ('clay-tile', 'slate', 'metal-roof') else 14, ov=0.9)
    else:
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.0)
    if b.detail == 0:
        U.eaves_band(b, fp, z1 + 0.4, lk, 0.5, 0.5)
    if b.detail < 2:
        lib.parapet(b, fp, z1 + 0.0, 0.7, 0.3, lk, col=lk.trim_col)
    b.section('portico')
    cw = U.clamp((bar[2] - bar[0]) * 0.36, 10.0, 28.0)
    pw = cw * 0.9
    cols = 6 if pw < 18 else 8
    U.portico_front(b, lk, cx, bar[1], pw, 5.5, 1.0, st_h * min(st, 2) - 0.2 if st > 1 else st_h * 0.95, cols, pediment_rise=pw * 0.13, steps_n=7, col_r=min(0.5, pw / cols / 3.2), kind='round',
                    col=lk.trim_col, entab_h=0.9, steps_w=pw * 0.85, pediment_col=shade(lk.trim_col, 0.97))
    seg = lib.Seg((cx - cw / 2, bar[1]), (cx + cw / 2, bar[1]))
    U.door(b, seg, cw / 2, 3.2, 3.4, frame=lk.trim_col, z=1.0)
    if dome:
        r = U.clamp(cw * 0.3, 4.5, 10.0)
        dy = (bar[1] + bar[3]) / 2
        if b.detail < 2:
            lib.box_c(b, cx, dy, z1 - 0.2, r * 2.4, r * 2.4, 1.0, lk.wall_slot, lk.trim_col, skip=('bottom',))
        lib.dome(b, cx, dy, z1 + 0.8, r, lk, profile='shallow' if lk.roof_slot == 'metal-roof' else 'hemi', drum=r * 0.55, drum_r=r * 1.05, drum_slot=lk.wall_slot, drum_col=lk.trim_col,
                 lantern=r * 0.35, finial=1.5, slot='metal-roof', col=mix(lk.roof_col, '#9aa3a8', 0.5))
    if 'statue' in F and b.detail < 2:
        pass
    b.section('site')
    _courtyard_for(b, lk, fp, rects, bar, bb, srng, F)
    _site(b, lk, brief, F, txt, srng, bb, cx, front=26.0, forecourt='plaza')
    return bb


# ---------------------------------------------------------------------------------------------------------------- colonial
def _colonial(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'hip'
    if roof not in ('hip', 'gable', 'flat', 'shed', 'pyramidal'):
        roof = 'hip'
    st = min(max(st, 1), 3)
    st_h = U.clamp(h / st, 3.4, 4.8) if roof in ('flat',) else U.clamp((h * 0.72) / st, 3.2, 4.6)
    z1 = st_h * st
    small = w < 26
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 9.0, 24.0), srng, U.clamp(d * 0.5, 9, 16), U.clamp(w * 0.28, 8, 14))
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    wk = _wk(brief, 'arched' if style in ('colonial',) and lk.windows == 'arched' else 'punched')
    if wk in ('ribbon', 'curtain'):
        wk = 'punched'
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=U.clamp(lk.ratio, 0.18, 0.32), bay=3.6 * (1 + 0.45 * coarse), plinth=0.5)
    U.plinth_band(b, fp, lk, 0.9)
    b.section('roof')
    tiled = lk.roof_slot in ('clay-tile', 'slate')
    if roof == 'flat':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.7)
    elif roof == 'pyramidal':
        U.roof_rects(b, 'hip', rects, z1, lk, pitch=30, ov=0.9)
    else:
        U.roof_rects(b, roof, rects, z1, lk, pitch=26 if tiled else 19, ov=1.0)
        if b.detail == 0:
            U.eaves_band(b, fp, z1, lk, 0.35, 0.4)
    b.section('veranda')
    cw = U.clamp((bar[2] - bar[0]) * 0.22, 4.5, 10.0)
    for (xa, xb) in ((bar[0], cx - cw / 2 - 0.3), (cx + cw / 2 + 0.3, bar[2])):
        if xb - xa > 3.5:
            if st >= 2:
                U.gallery2(b, lk, (xa, bar[1]), (xb, bar[1]), z1, st_h, depth=2.4, col=lk.trim_col)
            else:
                U.veranda(b, lk, (xa, bar[1]), (xb, bar[1]), 0.0, min(3.0, st_h - 0.2), 2.4, z1 - 0.4, post='square', pitch_m=3.0, col=lk.trim_col)
    for r in rects:
        if r[4] == 'wing' and r[3] - r[1] > 8 and fpk in ('U', 'L', 'H'):
            if r[2] < 0:
                p0, p1 = (r[2], r[3] - 0.5), (r[2], r[1] + 0.5)
            else:
                p0, p1 = (r[0], r[1] + 0.5), (r[0], r[3] - 0.5)
            if st >= 2:
                U.gallery2(b, lk, p0, p1, z1, st_h, depth=2.4, col=lk.trim_col)
            else:
                U.veranda(b, lk, p0, p1, 0.0, min(3.0, st_h - 0.2), 2.4, z1 - 0.4, post='square', pitch_m=3.0, col=lk.trim_col)
    # central porch
    U.portico_front(b, lk, cx, bar[1], cw, 3.6 if small else 4.4, 0.6, st_h * min(st, 2) - 0.3 if st > 1 else st_h * 0.9, 4 if cw > 6 else 2,
                    pediment_rise=cw * 0.2 if roof in ('hip', 'gable', 'pyramidal') else None, steps_n=5, col_r=0.22, kind='round', col=lk.trim_col, entab_h=0.7, steps_w=cw * 0.8)
    seg = lib.Seg((cx - cw / 2, bar[1]), (cx + cw / 2, bar[1]))
    U.door(b, seg, cw / 2, 2.2, 2.7, frame=lk.trim_col, z=0.6)
    b.section('site')
    _courtyard_for(b, lk, fp, rects, bar, bb, srng, F)
    if 'cannon' in F:
        U.cannon(b, bar[0] + 6.0, bar[1] - 9.0, 0.3)
        U.cannon(b, bar[2] - 6.0, bar[1] - 9.0, math.pi - 0.3)
    _site(b, lk, brief, F, txt, srng, bb, cx, front=20.0, forecourt='garden')
    return bb


# ---------------------------------------------------------------------------------------------------------------- courtyard
def _courtyard(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'U'
    arewa = style in ('hausa-arewa', 'sahelian')
    arab = style == 'arab-islamic'
    st = min(st, 3)
    st_h = U.clamp(h / max(1, st), 3.2, 5.0)
    z1 = st_h * st
    w = U.clamp(w, 25.0, 110.0)
    ww = U.clamp(min(w, d) * 0.22, 8.0, 14.0)
    if fpk not in ('U', 'ring', 'L', 'irregular', 'rect'):
        fpk = 'U'
    if fpk == 'rect' and d > 22:
        fpk = 'U'
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 10.0, 24.0), srng, ww, ww)
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    kind = 'arched' if (arewa or style == 'colonial') else ('pointed-arch' if arab else 'arched')
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=kind, ratio=U.clamp(lk.ratio * 0.9, 0.1, 0.28), bay=4.0 * (1 + 0.45 * coarse), plinth=0.6)
    if b.detail == 0:
        lib.sweep(b, fp, 0.0, [(0.12, 0), (0.12, 0.9), (0, 0.9)], lk.wall_slot, shade(lk.wall_col, 0.86))
    b.section('roof')
    roofk = form.get('roof') or 'flat'
    pitched = roofk in ('hip', 'gable') and not arewa
    tiled = lk.roof_slot in ('clay-tile', 'slate', 'metal-roof')
    if pitched:
        U.roof_rects(b, 'hip', rects, z1, lk, pitch=24 if tiled else 16, ov=0.9)
    else:
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.0)
    ph = 3.0
    if arewa or arab:
        for s in fp.edges():
            lib.seg_box(b, s, 0, s.length, z1, z1 + 0.8, 0.0, lk.wall_col, lk.wall_slot, inset=0.4) if (b.detail < 2 and not pitched) else None
            U.crenellate_seg(b, s, z1 + (0.8 if not pitched else 0.0), h=0.7, w=0.7, pitch=2.0, thick=0.4, col=lk.trim_col, slot=lk.wall_slot)
    if arewa and b.detail < 2:
        for k, p in enumerate(fp.polys[0]):
            if b.detail == 1 and k % 2:
                continue
            U.pinnacle(b, p[0] + (0.3 if p[0] < 0 else -0.3), p[1] + (0.3 if p[1] < 0 else -0.3), z1 + (0.8 if not pitched else 0.0), ph, 1.0, lk.wall_col, slot=lk.wall_slot)
        if b.detail == 0:
            for s in fp.edges():
                if s.front and s.length > 8:
                    n = int(s.length / 1.5)
                    for k in range(n):
                        lib.seg_box(b, s, k * 1.5 + 0.3, k * 1.5 + 1.2, z1 - 1.2, z1 - 0.4, 0.07, lk.trim_col if k % 2 == 0 else shade(lk.trim_col, 0.85), lk.wall_slot)
    # entrance gatehouse (zaure) with big arch
    b.section('gate')
    gw = U.clamp((bar[2] - bar[0]) * 0.2, 7.0, 13.0)
    gd = 4.5
    gh = z1 + st_h * 0.2
    gseg = lib.Seg((cx - gw / 2, bar[1] - gd), (cx + gw / 2, bar[1] - gd))
    if b.detail >= 2:
        lib.box(b, cx - gw / 2, bar[1] - gd, 0, cx + gw / 2, bar[1], gh, 'plain', lk.wall_col, skip=('bottom',))
    else:
        U.arch_portal(b, gseg, 0, gw, 0, gh, gw / 2, gw * 0.5, 3.0, lk.wall_col, lk.wall_slot, pointed=arab)
        for xs, sgn in ((cx - gw / 2, -1), (cx + gw / 2, 1)):
            b.facing([(xs, bar[1] - gd, 0), (xs, bar[1], 0), (xs, bar[1], gh), (xs, bar[1] - gd, gh)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.94))
        gfp = lib.fp_rect(gw, gd, cx, bar[1] - gd / 2)
        lib.flat_roof(b, gfp, gh, lk, parapet_h=0.0)
        if arewa or arab:
            for s in gfp.edges():
                U.crenellate_seg(b, s, gh, h=0.7, w=0.7, pitch=2.0, thick=0.4, col=lk.trim_col, slot=lk.wall_slot)
        if arewa:
            for (hx, hy) in ((cx - gw / 2 + 0.4, bar[1] - gd + 0.4), (cx + gw / 2 - 0.4, bar[1] - gd + 0.4), (cx - gw / 2 + 0.4, bar[1] - 0.4), (cx + gw / 2 - 0.4, bar[1] - 0.4)):
                U.pinnacle(b, hx, hy, gh, ph * 1.1, 1.1, lk.wall_col, slot=lk.wall_slot)
    if arab and b.detail < 2:
        dome_col = srng.choice(['#2f7d6a', '#2d5f8a', '#c9a24a'])
        for sx, sy in ((bb[0] + ww * 0.5, bb[1] + 2.5), (bb[2] - ww * 0.5, bb[1] + 2.5)):
            lib.dome(b, sx, sy, z1 + 0.1, 2.6, lk, profile='onion', height=3.6, drum=1.4, drum_r=2.1, drum_slot=lk.wall_slot, drum_col=lk.trim_col, slot='metal-roof', col=dome_col, finial=0.8)
    # arcaded courtyard sides
    if b.detail < 2 and (arab or style == 'colonial'):
        for s in fp.edges():
            p = s.P(s.length / 2, 0.0, -1.5)
            x0, y0, x1, y1 = fp.bbox
            if x0 + 0.5 < p[0] < x1 - 0.5 and y0 + 0.5 < p[1] < y1 - 0.5 and s.length > 8:
                U.arcade(b, lk, s.p0, s.p1, 0, 2.7, st_h * 0.95, 2.4, bay_w=3.6, pier_w=0.6, col=lk.trim_col, pointed=arab)
    b.section('site')
    _courtyard_for(b, lk, fp, rects, bar, bb, srng, F, fountain=arab)
    if 'cannon' in F:
        U.cannon(b, cx - gw / 2 - 3.0, bar[1] - gd - 3.0, 0.3)
        U.cannon(b, cx + gw / 2 + 3.0, bar[1] - gd - 3.0, math.pi - 0.3)
    F2 = dict(F)
    _site(b, lk, brief, F2, txt, srng, bb, cx, front=18.0, forecourt='plaza' if lk.forecourt != 'garden' else 'garden')
    return bb


# ------------------------------------------------------------------------------------------------------------------ modern
def _hex_pod(b, lk, x, y, r, h, rng, col):
    fp = lib.fp_round(r, 6).moved(x, y)
    U.walls(b, fp, 0, h, 1, lk, rng, kind='punched', ratio=0.2, plinth=0.0, rear='same', wall_col=col)
    lib.cylinder(b, x, y, h, h + r * 1.1, r + 0.3, n=6, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)


def _modern(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    st = min(max(st, 1), 5)
    st_h = U.clamp(h / st, 3.4, 5.4)
    z1 = st_h * st
    wk = _wk(brief, 'curtain' if style in ('contemporary', 'high-tech') else 'ribbon')
    ratio = U.clamp(lk.ratio, 0.15, 0.6)
    bay = 4.0 * (1 + 0.45 * coarse)
    if roof in ('pyramidal',) and fpk in ('irregular', 'rect', 'U', 'L') and w < 80:
        # cluster of hexagonal pods round a small court (adjoining hexagonal exhibition blocks)
        b.section('pods')
        n = 6
        R = U.clamp(min(w, d) * 0.3, 6.0, 13.0)
        rr = R * 0.5
        pts = [(0.0, 0.0)] + [((R + rr * 0.6) * math.cos(2 * math.pi * k / (n - 1) + 0.3), (R + rr * 0.6) * math.sin(2 * math.pi * k / (n - 1) + 0.3) * 0.8) for k in range(n - 1)]
        pods = pts if b.detail < 2 else pts[:3]
        for k, (px_, py_) in enumerate(pods):
            rad = rr * (1.35 if k == 0 else 1.0)
            _hex_pod(b, lk, px_, py_, rad, 4.0 + (k % 3) * 0.9 + (1.5 if k == 0 else 0), rng, lk.wall_col if k % 2 == 0 else mix(lk.wall_col, lk.accent_col, 0.4))
        # a shaded link walk
        bbp = (-R - rr * 2, -R * 0.8 - rr * 2, R + rr * 2, R * 0.8 + rr * 2)
        _site(b, lk, brief, F, txt, srng, bbp, 0.0, front=18.0, forecourt='garden')
        return bbp
    if roof == 'multi-dome':
        b.section('domes')
        n = 5
        pods = [(-14, 0), (-7, 8), (2, -2), (10, 6), (17, -4)][:n if b.detail < 2 else 3]
        for k, (px_, py_) in enumerate(pods):
            r = 3.8 + (k % 2) * 0.8
            lib.box_c(b, px_, py_, 0, r * 2, r * 2, 3.2, lk.wall_slot, lk.wall_col, skip=('bottom',))
            lib.dome(b, px_, py_, 3.2, r * 1.0, lk, profile='hemi', height=r * 0.9, slot='plain-render', col=mix(lk.wall_col, '#ffffff', 0.1))
            if b.detail < 2:
                seg = lib.Seg((px_ - r, py_ - r), (px_ + r, py_ - r))
                U.door(b, seg, r, 1.2, 2.0, col='#3a2a20', frame=lk.trim_col)
        bbp = (-20, -9, 24, 13)
        _site(b, lk, brief, F, txt, srng, bbp, 0.0, front=16.0, forecourt='garden')
        return bbp
    rects = _plan(fpk, w, d if fpk != 'rect' else U.clamp(d, 12.0, 40.0), srng, U.clamp(d * 0.5, 12, 24), U.clamp(w * 0.28, 12, 26))
    bar = _bar(rects)
    cx = (bar[0] + bar[2]) / 2
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    b.section('walls')
    stepped = roof == 'stepped'
    if stepped and st >= 2:
        # terraced complex: each rect (or each tier of a rect plan) steps down in height; roofs are green / terrace decks
        tiers = 3
        for t in range(tiers):
            sx = 0.0 + t * 7.0
            tr = (bar[0] + t * 5.0, bar[1] + t * 4.0, bar[2] - t * 5.0, bar[3] - t * 0.0)
            if tr[2] - tr[0] < 12:
                break
            zt = z1 * (0.45 + 0.27 * t)
            tz0 = z1 * (0.45 + 0.27 * (t - 1)) if t else 0.0
            tfp = lib.fp_rect(tr[2] - tr[0], tr[3] - tr[1], (tr[0] + tr[2]) / 2, (tr[1] + tr[3]) / 2)
            ns = max(1, round((zt - tz0) / st_h))
            U.walls(b, tfp, tz0, zt, ns, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.3 if t == 0 else 0, rear='same')
            lib.flat_roof(b, tfp, zt, lk, parapet_h=0.0)
            if b.detail < 2 and t < tiers - 1:
                for s in tfp.edges():
                    if s.front:
                        a, c = s.P(0.2, 0, 0.3), s.P(s.length - 0.2, 0, 0.3)
                        U.balustrade(b, (a[0], a[1]), (c[0], c[1]), zt, 1.0, lk.trim_col, pitch=3.0)
        fp_top = fp
    else:
        U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.4, front_kind=wk, ground_kind='curtain' if (style in ('contemporary', 'high-tech') and st > 1) else None)
        U.plinth_band(b, fp, lk, 0.8)
        b.section('roof')
        if roof == 'sawtooth':
            for r in rects:
                lib.sawtooth(b, r[:4], z1, 2.4, lk, teeth=max(3, int((r[2] - r[0]) / 7)), axis='x', glaze='front')
        elif roof in ('hip', 'gable'):
            U.roof_rects(b, roof, rects, z1, lk, pitch=16, ov=0.9)
        elif roof == 'shed':
            lib.roof(b, 'shed', bar[:4], z1, lk, rise=2.6, ov=0.7, high='back')
            lib.flat_roof(b, U.union_fp([r[:4] for r in rects if r is not bar]), z1, lk, parapet_h=0.4) if len(rects) > 1 else None
        else:
            lib.flat_roof(b, fp, z1, lk, parapet_h=0.6, ov=0.0)
    b.section('front')
    ew = U.clamp((bar[2] - bar[0]) * 0.28, 8.0, 20.0)
    ey = bar[1]
    ed = 7.0
    eh = st_h * min(st, 2)
    # double-arch colonnade facade (Rabat) when the brief lists arches and a large flat block
    if 'arches' in F and b.detail < 2 and wk != 'curtain' and (bar[2] - bar[0]) >= 40:
        U.arcade(b, lk, (bar[0] + 0.5, ey), (bar[2] - 0.5, ey), 0, st_h * 0.55, z1 - 0.3, 3.0, bay_w=6.0, pier_w=1.1, col=lk.trim_col)
    # glazed entrance bay with a sloped glass roof; curved canopy when asked
    efp = lib.fp_rect(ew, ed, cx, ey - ed / 2)
    atrium = ('atrium-glass' in F) or style in ('contemporary', 'high-tech', 'postmodern') or wk == 'curtain'
    if atrium:
        U.walls(b, efp, 0, eh, min(st, 2), lk, rng, kind='curtain', bay=3.0 * (1 + 0.45 * coarse), plinth=0, rear='same')
        if b.detail < 2:
            pts = [(cx - ew / 2, ey - ed, eh), (cx + ew / 2, ey - ed, eh), (cx + ew / 2, ey, eh + 2.0), (cx - ew / 2, ey, eh + 2.0)]
            b.facing(pts, (0, -0.4, 1), 'glass-ribbon', '#a8bcc8', mode='tile')
            for xs, sgn in ((cx - ew / 2, -1), (cx + ew / 2, 1)):
                b.facing([(xs, ey - ed, eh), (xs, ey, eh), (xs, ey, eh + 2.0)], (sgn, 0, 0), lk.wall_slot, lk.trim_col)
    else:
        U.walls(b, efp, 0, eh, min(st, 2), lk, rng, kind='ribbon', ratio=0.3, bay=bay, plinth=0.3, rear='same')
        lib.flat_roof(b, efp, eh, lk, parapet_h=0.5, ov=0.4, slab=0.3)
    seg = lib.Seg((cx - ew / 2, ey - ed), (cx + ew / 2, ey - ed))
    U.door(b, seg, ew / 2, 3.0, 2.8, frame=lk.trim_col)
    if 'curved-canopy' in F:
        cwid = ew + 8.0
        lib.canopy_curved(b, cx - cwid / 2, ey - ed - 6.0, cx + cwid / 2, ey - ed + 0.1, 4.2, 1.4, lk, th=0.3, axis='x',
                          columns=[(cx - cwid / 2 + 0.6, ey - ed - 5.4), (cx + cwid / 2 - 0.6, ey - ed - 5.4)], col=lk.accent_col)
    elif 'flat-canopy' in F or not atrium:
        U.entrance_canopy(b, lk, cx - ew / 2 - 1.0, cx + ew / 2 + 1.0, ey - ed, eh * 0.9 + 0.4, 4.5, th=0.4, columns=2, round_cols=True)
    if 'colonnade' in F and b.detail < 2:
        n = max(4, int((bar[2] - bar[0]) / 6.0))
        n = n if b.detail == 0 else max(3, n // 2)
        for k in range(n):
            x = bar[0] + 2.0 + (bar[2] - bar[0] - 4.0) * k / max(1, n - 1)
            if abs(x - cx) < ew / 2 + 1.5:
                continue
            lib.cylinder(b, x, ey - 3.0, 0, eh, 0.3, n=8 if b.detail == 0 else 5, slot=lk.wall_slot, col=lk.trim_col, r_top=0.3, top=False)
        lib.box(b, bar[0] + 0.5, ey - 3.6, eh, bar[2] - 0.5, ey, eh + 0.45, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=())
    if 'roof-terrace' in F and b.detail < 2 and roof == 'flat':
        for s in fp.edges():
            if s.front or s.length > 14:
                a, c = s.P(0.2, 0, 0.35), s.P(s.length - 0.2, 0, 0.35)
                U.balustrade(b, (a[0], a[1]), (c[0], c[1]), z1, 1.0, lk.metal_col, pitch=3.0)
    if 'balcony-bands' in F and b.detail < 2 and coarse < 2:
        for s in fp.edges():
            if s.front and s.length > 10:
                for k in range(1, st):
                    U.balcony_slab(b, s, k * st_h, proud=1.0, col=shade(lk.trim_col, 0.95), rail_h=0.9)
    if (roof == 'dome' or 'dome' in F) and b.detail < 3:
        # saucer dome of aluminium / metal over the central hall
        rr = U.clamp(min(bar[2] - bar[0], bar[3] - bar[1]) * 0.36, 4.0, 14.0)
        dcy = (bar[1] + bar[3]) / 2
        lib.dome(b, cx, dcy, z1, rr, lk, profile='shallow', height=rr * 0.62, drum=0.9, drum_r=rr * 1.02, drum_slot=lk.wall_slot, drum_col=lk.trim_col, lantern=0.0, finial=0.8,
                 slot='metal-roof', col=mix(lk.roof_col, '#c8ccd0', 0.6))
    elif b.detail == 0 and roof == 'flat':
        U.roof_plant(b, lk, (bar[0] + 2, bar[1] + 2, bar[2] - 2, bar[3] - 2), z1, rng, count=2)
    if roof == 'flat':
        U.skyline(b, lk, rects, z1, st_h, srng, rng, kind=wk, ratio=ratio, bay=bay)
        U.roof_variety(b, lk, [r[:4] for r in rects], z1, srng, st_h, kinds=('stair', 'tank', 'mast'))
    b.section('site')
    _courtyard_for(b, lk, fp, rects, bar, bb, srng, F)
    if 'painted-mural' in F and b.detail == 0:
        for s in fp.edges():
            if s.length > 8 and not s.front and not s.rear:
                lib.seg_box(b, s, s.length * 0.2, s.length * 0.8, 0.8, min(z1 - 0.8, 5.0), 0.05, lk.accent_col, lk.wall_slot)
                break
    _site(b, lk, brief, F, txt, srng, bb, cx, front=22.0, forecourt='plaza')
    return bb


# ---------------------------------------------------------------------------------------------------------------- flytower
def _flytower(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    w = U.clamp(w, 28.0, 110.0)
    d = U.clamp(d, 24.0, 70.0)
    brut = style in ('brutalist', 'soviet') or lk.wall_material in ('exposed-concrete',)
    st = min(max(st, 2), 4)
    foyer_d = U.clamp(d * 0.32, 12.0, 20.0)
    foyer_h = U.clamp(h * 0.32, 8.0, 14.0)
    aud_h = U.clamp(h * 0.62, 12.0, 24.0)
    fly_h = U.clamp(h * 1.1 if h > 16 else h * 1.6, aud_h + 5.0, 42.0)
    oy = -d / 2
    foyer = (-w / 2, oy, w / 2, oy + foyer_d)
    aud = (-w * 0.38, oy + foyer_d, w * 0.38, oy + d * 0.82)
    fly = (-w * 0.24, oy + d * 0.82 - 4.0, w * 0.24, oy + d)
    b.section('walls')
    ffp = U.union_fp([foyer])
    bay = 4.2 * (1 + 0.45 * coarse)
    foyer_kind = 'curtain' if not brut else 'punched'
    U.walls(b, ffp, 0, foyer_h, 2, lk, rng, kind=foyer_kind, ratio=0.5 if not brut else 0.12, bay=bay, plinth=0.3, front_kind='curtain' if not brut else 'punched',
            wall_col=lk.wall_col)
    lib.flat_roof(b, ffp, foyer_h, lk, parapet_h=0.6 if not brut else 0.0, ov=0.8 if not brut else 0.0, slab=0.5)
    afp = U.union_fp([aud])
    U.mass_walls(b, lk, afp, 0, aud_h, 1, others=[foyer, fly], rng=rng, kind='none', plinth=0.0)
    if b.detail < 2:
        # a few blank vent louvres high on the auditorium walls
        if b.detail == 0:
            for s in afp.edges():
                if s.length > 12 and (s.n[0] != 0):
                    lib.seg_box(b, s, s.length * 0.2, s.length * 0.8, aud_h - 2.2, aud_h - 1.0, 0.1, shade(lk.wall_col, 0.8), 'metal-cladding')
    lib.flat_roof(b, afp, aud_h, lk, parapet_h=0.0, ov=0.0)
    flyfp = U.union_fp([fly])
    U.mass_walls(b, lk, flyfp, 0, fly_h, 1, others=[aud], rng=rng, kind='none', plinth=0.0)
    lib.flat_roof(b, flyfp, fly_h, lk, parapet_h=0.0, ov=0.0)
    if b.detail < 2:
        U.eaves_band(b, flyfp, fly_h + 0.6, lk, 0.6, 0.5, col=shade(lk.wall_col, 0.9))
        U.eaves_band(b, afp, aud_h + 0.5, lk, 0.5, 0.4, col=shade(lk.wall_col, 0.92))
    b.section('front')
    cx = 0.0
    if brut and b.detail < 2:
        # vertical concrete fins across the foyer and a deep cantilevered upper floor
        s = lib.Seg((foyer[0], foyer[1]), (foyer[2], foyer[1]))
        lib.seg_box(b, s, 0, s.length, foyer_h - 4.0, foyer_h, 1.8, shade(lk.wall_col, 0.9), lk.wall_slot)
        n = max(3, int(s.length / 6.0))
        for k in range(n + 1):
            u = min(max(s.length * k / n, 0.4), s.length - 0.4)
            lib.seg_box(b, s, u - 0.4, u + 0.4, 0, foyer_h - 4.0, 1.2, shade(lk.wall_col, 0.92), lk.wall_slot)
    ew = U.clamp(w * 0.3, 10.0, 24.0)
    if 'curved-canopy' in F:
        lib.canopy_curved(b, cx - ew / 2, oy - 6.5, cx + ew / 2, oy + 0.1, 5.0, 1.6, lk, th=0.3, axis='x', columns=[(cx - ew / 2 + 0.6, oy - 5.9), (cx + ew / 2 - 0.6, oy - 5.9)], col=lk.accent_col)
    elif b.detail < 2:
        U.entrance_canopy(b, lk, cx - ew / 2, cx + ew / 2, oy, 4.6, 6.0, th=0.5, columns=2 if not brut else 0, round_cols=True)
    seg = lib.Seg((cx - ew / 2, oy), (cx + ew / 2, oy))
    U.door(b, seg, ew / 2, 3.6, 3.0, frame=lk.trim_col)
    if b.detail < 2:
        lib.steps(b, -ew * 0.45, ew * 0.45, oy - 6.5, 0.6, 2.4, 4, 'paving', lk.stone_col)
    b.section('site')
    bb = (-w / 2, oy, w / 2, oy + d)
    _site(b, lk, brief, F, txt, srng, bb, cx, front=26.0, forecourt='plaza')
    return bb


# ------------------------------------------------------------------------------------------------------------------ cinema
def _cinema(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    w = U.clamp(w, 14.0, 40.0)
    d = U.clamp(d, 20.0, 40.0)
    fh = U.clamp(h, 9.0, 16.0)
    bh = fh * 0.9
    oy = -d / 2
    front = (-w / 2, oy, w / 2, oy + 9.0)
    box = (-w / 2, oy + 9.0, w / 2, oy + d)
    b.section('walls')
    ffp = U.union_fp([front])
    U.walls(b, ffp, 0, fh, 2, lk, rng, kind='ribbon', ratio=0.3, bay=4.0 * (1 + 0.45 * coarse), plinth=0.3, front_kind='ribbon', ground_kind='curtain')
    lib.flat_roof(b, ffp, fh, lk, parapet_h=0.6)
    bfp = U.union_fp([box])
    U.mass_walls(b, lk, bfp, 0, bh, 1, others=[front], rng=rng, kind='none')
    lib.flat_roof(b, bfp, bh, lk, parapet_h=0.0)
    if b.detail < 2:
        # canopy, vertical sign fin (blank), neon strip
        U.entrance_canopy(b, lk, -w * 0.42, w * 0.42, oy, 3.6, 3.2, th=0.5, columns=0, col=lk.accent_col)
        fin_x = w / 2 - 2.0
        lib.box_c(b, fin_x, oy - 0.4, 3.0, 1.0, 0.5, fh + 4.0 - 3.0, 'plain', lk.accent_col, skip=('bottom',))
        lib.box_c(b, fin_x, oy - 0.5, fh - 2.0, 0.2, 0.2, 5.0, 'plain', '#d8d8d4')
        lib.box_c(b, 0.0, oy - 3.45, 3.35, w * 0.8, 0.08, 0.14, 'plain', '#f2d24a')
        seg = lib.Seg((-w / 2, oy), (w / 2, oy))
        U.door(b, seg, w / 2, 3.0, 2.6, frame=lk.trim_col)
    b.section('site')
    bb = (-w / 2, oy, w / 2, oy + d)
    _site(b, lk, brief, F, txt, srng, bb, 0.0, front=14.0, forecourt='plaza')
    return bb


# -------------------------------------------------------------------------------------------------------------------- oval
def _oval(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    w = U.clamp(w, 30.0, 108.0)
    d = U.clamp(d, 26.0, 96.0)
    n = {0: 32, 1: 20, 2: 12}[b.detail]
    fp = lib.fp_oval(w, d, n)
    z1 = U.clamp(h * 0.55, 8.0, 18.0)
    b.section('walls')
    U.walls(b, fp, 0, z1, 2, lk, rng, kind='curtain' if (brief.get('facade') or {}).get('windows') in (None, 'curtain', 'ribbon') else _wk(brief, 'curtain'),
            bay=4.0 * (1 + 0.45 * coarse), plinth=0.0, rear='same')
    b.section('roof')
    # sweeping roof: edges at both ends flare up like wings, the middle dips; the front lip lifts
    ov = 7.0
    W2, D2 = w / 2 + ov, d / 2 + ov * 0.6
    nx = {0: 40, 1: 14, 2: 6}[b.detail]
    ny = {0: 12, 1: 6, 2: 3}[b.detail]
    rise = U.clamp(h - z1, 6.0, 22.0)
    top = []
    for i in range(nx + 1):
        u = -1 + 2 * i / nx
        row = []
        for j in range(ny + 1):
            t = j / ny
            y = -D2 + 2 * D2 * t
            hump = 0.22 + 0.78 * (abs(u) ** 1.7)
            z = z1 + 1.0 + rise * hump * (0.75 + 0.25 * (1 - abs(2 * t - 1) ** 2))
            z += 2.2 * math.exp(-(t / 0.1) ** 2) * (1 - abs(u) * 0.3)
            row.append((u * W2, y, z))
        top.append(row)
    lib.roof_shell(b, top, 0.55, lk, slot='metal-roof', col=lk.roof_col)
    # roof edge columns / props at the ends and a glazed foyer wall under the lip
    b.section('front')
    if b.detail < 2:
        n_c = 7 if b.detail == 0 else 4
        for k in range(n_c):
            a = math.pi * (0.1 + 0.8 * k / (n_c - 1)) + math.pi
            x, y = (w / 2 + 2.0) * math.cos(a), (d / 2 + 2.0) * math.sin(a)
            lib.cylinder(b, x, y, 0, z1 + 1.0, 0.35, n=8 if b.detail == 0 else 5, slot=lk.wall_slot, col=lk.trim_col, r_top=0.35, top=False)
        lib.steps(b, -w * 0.18, w * 0.18, -d / 2 - 8.0, 1.5, 5.0, 6, 'paving', lk.stone_col)
    b.section('site')
    bb = (-w / 2, -d / 2, w / 2, d / 2)
    _site(b, lk, brief, F, txt, srng, bb, 0.0, front=24.0, forecourt='plaza')
    return bb


# ----------------------------------------------------------------------------------------------------------------- roundmuseum
def _roundmuseum(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    R = U.clamp(min(w, d) / 2, 8.0, 52.0)
    st = min(max(st, 1), 5)
    n = {0: 28, 1: 16, 2: 10}[b.detail]
    layered = U.has(txt, 'conical', 'layered', 'cone', 'hut') or (form.get('roof') in ('curved',))
    b.section('walls')
    if layered:
        tiers = 3
        z0 = 0.0
        r = R
        hh = U.clamp(h / (tiers + 0.8), 4.0, 9.0)
        for t in range(tiers):
            fp = lib.fp_round(r, n)
            U.walls(b, fp, z0, z0 + hh, 1, lk, rng, kind='ribbon', ratio=0.3, bay=4.0 * (1 + 0.45 * coarse), plinth=0.0, rear='same', wall_col=lk.wall_col)
            # conical skirt roof over this tier stepping in to the next
            r_next = r * 0.72
            lib.cylinder(b, 0, 0, z0 + hh, z0 + hh + hh * 0.55, r + 0.8, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=r_next, top=False, smooth=False)
            z0 += hh + hh * 0.55
            r = r_next
        lib.cylinder(b, 0, 0, z0, z0 + hh * 1.2, r + 0.4, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    else:
        z1 = U.clamp(h, 6.0, 20.0)
        fp = lib.fp_round(R, n)
        U.walls(b, fp, 0, z1, st, lk, rng, kind=_wk(brief, 'ribbon'), ratio=U.clamp(lk.ratio, 0.2, 0.45), bay=4.0 * (1 + 0.45 * coarse), plinth=0.5, rear='same')
        b.section('roof')
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.8)
        if b.detail < 2:
            lib.cylinder(b, 0, 0, z1, z1 + 3.2, R * 0.45, n=n, slot=lk.wall_slot, col=lk.trim_col, r_top=R * 0.42, top=True, smooth=False)
            # ring colonnade of slim columns
            k = 18 if b.detail == 0 else 8
            for i in range(k):
                a = 2 * math.pi * i / k
                lib.cylinder(b, (R + 1.8) * math.cos(a), (R + 1.8) * math.sin(a), 0, min(z1, 7.0), 0.3, n=6, slot=lk.wall_slot, col=lk.trim_col, r_top=0.3, top=False)
            lib.cylinder(b, 0, 0, min(z1, 7.0), min(z1, 7.0) + 0.4, R + 2.3, n=n, slot=lk.wall_slot, col=lk.trim_col, r_top=R + 2.3, top=True, smooth=False)
    b.section('site')
    bb = (-R, -R, R, R)
    if b.detail < 2:
        lib.steps(b, -5.0, 5.0, -R - 2.5, 1.0, 3.0, 4, 'paving', lk.stone_col)
    _site(b, lk, brief, F, txt, srng, bb, 0.0, front=22.0, forecourt='plaza')
    return bb


# ------------------------------------------------------------------------------------------------------------------ domelattice
def _domelattice(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    R = U.clamp(min(w, d) / 2 * 0.85, 12.0, 46.0)
    n = {0: 36, 1: 18, 2: 10}[b.detail]
    zb = 7.0
    b.section('walls')
    fp = lib.fp_round(R, n)
    U.walls(b, fp, 0, zb, 2, lk, rng, kind='curtain', bay=4.0 * (1 + 0.45 * coarse), plinth=0.0, rear='same')
    b.section('dome')
    top = U.clamp(h, 18.0, 36.0) - zb
    rings = {0: 10, 1: 5, 2: 3}[b.detail]
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    curve = []
    for j in range(rings + 1):
        t = j / rings
        curve.append((R * math.cos(t * math.pi / 2) ** 0.95, zb + top * math.sin(t * math.pi / 2) ** 1.1))
    grid = [[(rr * math.cos(a), rr * math.sin(a), zz) for rr, zz in curve] for a in angs]
    b.shared_grid(grid, 'glass-curtain', '#cfdde6', smooth=True, wrap=True, scale=1.5)
    if b.detail == 0:
        # lattice ribs: meridians and rings in a metal colour, slightly proud
        rc = lk.metal_col
        for k in range(0, n, 2):
            a = angs[k]
            for (r0, z0), (r1, z1_) in zip(curve[:-1], curve[1:]):
                pa = (r0 * math.cos(a) * 1.01, r0 * math.sin(a) * 1.01, z0)
                pb = (r1 * math.cos(a) * 1.01, r1 * math.sin(a) * 1.01, z1_)
                tx, ty = -math.sin(a) * 0.12, math.cos(a) * 0.12
                b.face([(pa[0] - tx, pa[1] - ty, pa[2]), (pa[0] + tx, pa[1] + ty, pa[2]), (pb[0] + tx, pb[1] + ty, pb[2]), (pb[0] - tx, pb[1] - ty, pb[2])], 'frame', rc)
        for (r0, z0) in curve[1:-1]:
            lib.cylinder(b, 0, 0, z0 - 0.1, z0 + 0.1, r0 * 1.012, n=n, slot='frame', col=rc, r_top=r0 * 1.012, top=False, smooth=False)
    # a low wing block beside the dome (hotel / foyer) and the entrance
    side = (R * 0.6, -R * 0.3, R * 1.6, R * 0.9)
    if w > 2.4 * R:
        sf = U.union_fp([side])
        U.walls(b, sf, 0, 14.0, 3, lk, rng, kind='ribbon', ratio=0.45, bay=4.2 * (1 + 0.45 * coarse), plinth=0.3, rear='same')
        lib.flat_roof(b, sf, 14.0, lk, parapet_h=0.5)
    if b.detail < 2:
        U.entrance_canopy(b, lk, -7.0, 7.0, -R - 0.2, 5.0, 6.0, th=0.4, columns=2)
        lib.steps(b, -7.0, 7.0, -R - 6.5, 1.0, 3.0, 4, 'paving', lk.stone_col)
    b.section('site')
    bb = (-R, -R, R * (1.6 if w > 2.4 * R else 1.0), R)
    _site(b, lk, brief, F, txt, srng, bb, 0.0, front=22.0, forecourt='plaza')
    return bb


# ----------------------------------------------------------------------------------------------------------------- shells
def _sail(b, x0, y0, L, W, H, mirror, col, lean=0.25):
    """One opera-house sail: a quarter-ellipse cross-section scaled by f(s): it starts as a point at the front, swells and rises to its
    apex at the back, where a glazed end wall closes it. Drawn two-sided (light outside, darker inside)."""
    ns = {0: 12, 1: 6, 2: 3}[b.detail]
    nt = {0: 8, 1: 4, 2: 3}[b.detail]
    grid = []
    for i in range(ns + 1):
        s = i / ns
        f = math.sin(s * math.pi / 2) ** 1.1
        row = []
        for j in range(nt + 1):
            t = j / nt            # 0 = ridge, 1 = base
            a = t * math.pi / 2
            x = x0 + mirror * W * f * math.sin(a)
            z = H * f * math.cos(a)
            y = y0 + L * s - lean * L * f * (1 - t) * 0.0
            row.append((x, y, z))
        grid.append(row)
    # row direction +y, column direction ridge -> base ( +x/-z for mirror +1 ): cross = (-1, 0, -1) is inward, so flip for mirror +1
    outer = grid if mirror < 0 else [r[::-1] for r in grid]
    b.shared_grid(outer, 'metal-roof', col, smooth=True, scale=1.2)
    if b.detail < 2:
        inner = [r[::-1] for r in outer]
        b.shared_grid(inner, 'plain-render', shade(col, 0.7), smooth=False, scale=1.2)
        # glazed back wall
        pts = [(x0 + mirror * W * math.sin(j / nt * math.pi / 2), y0 + L, H * math.cos(j / nt * math.pi / 2)) for j in range(nt + 1)] + [(x0, y0 + L, 0.0)]
        b.facing(pts, (0, 1, 0), 'glass-curtain', '#bcd0da')


def _shells(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    w = U.clamp(w, 40.0, 110.0)
    d = U.clamp(d, 36.0, 100.0)
    b.section('podium')
    pod_h = 3.2
    lib.box(b, -w / 2, -d / 2, 0, w / 2, d / 2, pod_h, 'stone-blocks', shade(lk.stone_col, 0.92), top_slot='paving', top_col=mix(lk.stone_col, '#ffffff', 0.25), skip=('bottom',))
    if b.detail < 2:
        lib.steps(b, -w * 0.3, w * 0.3, -d / 2, pod_h, 6.0, 8, 'paving', lk.stone_col)
    b.section('sails')
    col = mix(lk.roof_col if lk.roof_col else '#f2eee2', '#f4f0e6', 0.7)
    H0 = U.clamp(h, 16.0, 34.0)
    # three pairs rising from the front of the podium to the back
    groups = [(-d * 0.38, d * 0.26, 0.52), (-d * 0.2, d * 0.34, 0.74), (-d * 0.02, d * 0.40, 1.0)]
    for k, (ys, L, sc) in enumerate(groups):
        if b.detail == 2 and k == 0:
            continue
        for mir in (-1, 1):
            sx = mir * w * 0.015
            _sail_at(b, sx, ys, L, w * 0.125 * (0.6 + 0.4 * sc), H0 * sc, mir, col, pod_h)
    b.section('site')
    bb = (-w / 2, -d / 2, w / 2, d / 2)
    _site(b, lk, brief, F, txt, srng, bb, 0.0, front=26.0, forecourt='plaza')
    return bb


def _sail_at(b, x0, y0, L, W, H, mirror, col, z0):
    """Sail standing on a podium at height z0 (shift the grid up)."""
    before = len(b.verts)
    _sail(b, x0, y0, L, W, H, mirror, col)
    for i in range(before, len(b.verts)):
        v = b.verts[i]
        b.verts[i] = (v[0], v[1], v[2] + z0)


# -------------------------------------------------------------------------------------------------------------------- cap
def _cap(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    R = U.clamp(min(w, d) * 0.42, 14.0, 42.0)
    n = {0: 32, 1: 18, 2: 10}[b.detail]
    zb = 10.0
    b.section('walls')
    fp = lib.fp_round(R * 0.8, n)
    U.walls(b, fp, 0, zb, 2, lk, rng, kind='curtain', bay=4.0 * (1 + 0.45 * coarse), plinth=0.0, rear='same')
    # two flanking halls
    for sgn in (-1, 1):
        hx = sgn * (R + 14.0)
        hf = U.union_fp([(hx - 12.0, -R * 0.45, hx + 12.0, R * 0.45)])
        U.walls(b, hf, 0, 12.0, 2, lk, rng, kind='ribbon', ratio=0.3, bay=4.4 * (1 + 0.45 * coarse), plinth=0.3, rear='same')
        lib.flat_roof(b, hf, 12.0, lk, parapet_h=0.6)
    b.section('cap')
    # the flared cap: a wide, dished crown with a raised visor at the front
    rings = {0: 10, 1: 5, 2: 3}[b.detail]
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    crown = U.clamp(h, 22.0, 40.0) - zb
    curve = [(R * 1.25, zb + 0.0), (R * 1.18, zb + crown * 0.12), (R * 0.95, zb + crown * 0.45), (R * 0.62, zb + crown * 0.8), (R * 0.28, zb + crown * 0.97), (0.0, zb + crown)]
    if b.detail == 2:
        curve = [curve[0], curve[2], curve[4], curve[5]]
    grid = []
    for a in angs:
        visor = 1.0 + 0.5 * max(0.0, -math.sin(a)) ** 3
        grid.append([(rr * visor * math.cos(a), rr * visor * math.sin(a) * 1.0, zz + (3.0 * max(0.0, -math.sin(a)) ** 3 if rr > 0.5 * R else 0.0)) for rr, zz in curve])
    b.shared_grid(grid, 'metal-roof', lk.roof_col, smooth=True, wrap=True, scale=1.5)
    if b.detail < 2:
        lib.cylinder(b, 0, 0, zb - 0.4, zb + 0.2, R * 1.26, n=n, slot=lk.wall_slot, col=lk.trim_col, r_top=R * 1.26, top=False, smooth=False)
    b.section('site')
    bb = (-R - 26.0, -R * 1.5, R + 26.0, R * 1.3)
    if b.detail < 2:
        lib.steps(b, -8.0, 8.0, -R * 1.25 - 2.0, 1.2, 4.0, 5, 'paving', lk.stone_col)
    _site(b, lk, brief, F, txt, srng, (-R - 26.0, -R * 1.25, R + 26.0, R * 1.25), 0.0, front=22.0, forecourt='plaza')
    return bb


# ------------------------------------------------------------------------------------------------------------------- open
def _open(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'round'
    b.section('bowl')
    if fpk in ('round', 'oval') and (form.get('roof') in ('none', None) or fpk == 'round'):
        R = U.clamp(min(w, d) / 2, 10.0, 30.0)
        n = {0: 24, 1: 14, 2: 8}[b.detail]
        tiers = 6 if b.detail == 0 else 4
        # semicircular stepped seating, rising away from the stage (stage at -Y, seating towards +Y)
        for t in range(tiers):
            r0 = R * (0.35 + 0.65 * t / tiers)
            r1 = R * (0.35 + 0.65 * (t + 1) / tiers)
            zt = 0.45 * (t + 1)
            angs = [math.pi * k / n for k in range(n + 1)]
            top = [(r1 * math.cos(a), r1 * math.sin(a) * 0.9 + 4.0, zt) for a in angs]
            low = [(r0 * math.cos(a), r0 * math.sin(a) * 0.9 + 4.0, zt) for a in angs]
            for k in range(n):
                b.facing([low[k], low[k + 1], top[k + 1], top[k]], (0, 0, 1), 'paving', '#bdb6a6')
                b.facing([(top[k][0], top[k][1], zt), (top[k + 1][0], top[k + 1][1], zt), (top[k + 1][0], top[k + 1][1], zt - 0.45), (top[k][0], top[k][1], zt - 0.45)],
                         (math.cos((angs[k] + angs[k + 1]) / 2), math.sin((angs[k] + angs[k + 1]) / 2), 0), 'rough-concrete', '#a9a398')
        # stage platform and a stage shelter
        lib.box(b, -R * 0.45, -R * 0.55, 0, R * 0.45, 3.0, 0.9, 'timber', '#8a6a4a', top_slot='timber', top_col='#7a5a3c', skip=('bottom',))
        if b.detail < 2:
            for sx in (-R * 0.42, R * 0.42):
                lib.cylinder(b, sx, -R * 0.52, 0.9, 5.2, 0.14, n=5, slot='frame', col='#8d9298', r_top=0.14, top=False)
            lib.box(b, -R * 0.5, -R * 0.6, 5.2, R * 0.5, 3.0, 5.5, 'metal-cladding', lk.roof_col, top_slot=lk.roof_slot, top_col=lk.roof_col, skip=())
        bb = (-R, -R * 0.6, R, R * 1.0 + 4.0)
    else:
        # big shed roofs on posts over a stage and standing area, walled compound with murals
        sw, sd = U.clamp(w * 0.8, 20.0, 60.0), U.clamp(d * 0.6, 14.0, 40.0)
        for k in range(2):
            x0 = -sw / 2 + k * sw * 0.52
            if b.detail < 2:
                for px_ in (x0, x0 + sw * 0.48):
                    for py_ in (-sd / 2 + 1, sd / 2 - 1):
                        lib.cylinder(b, px_, py_, 0, 4.2 + k * 0.8, 0.18, n=5, slot='frame', col='#8d9298', r_top=0.18, top=False)
            lib.roof(b, 'shed', (x0 - 0.5, -sd / 2, x0 + sw * 0.48 + 0.5, sd / 2), 4.2 + k * 0.8, lk, rise=1.4, ov=0.5, high='back', slot=lk.roof_slot, col=lk.roof_col) if b.detail < 3 else None
        lib.box(b, -sw * 0.3, sd / 2 - 4.0, 0, sw * 0.3, sd / 2 - 0.5, 1.1, 'timber', '#6a4a30', top_slot='timber', top_col='#7a5a3c', skip=('bottom',))
        bb = (-sw / 2 - 2, -sd / 2 - 1, sw / 2 + 2, sd / 2 + 1)
    b.section('site')
    F2 = dict(F)
    F2.setdefault('fence-wall', {'id': 'fence-wall', 'count': 1})
    _site(b, lk, brief, F2, txt, srng, bb, 0.0, front=18.0, forecourt='plaza', )
    return bb


# ----------------------------------------------------------------------------------------------------------------- build
def _build(brief, style, rng, detail, coarse):
    b = U.new_builder('museum-theatre', detail, coarse, brief=brief)
    lk = U.look_for(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    F = U.feats(brief)
    txt = U.text(brief)
    typ, dims = infer(brief)
    fn = {'classical': _classical, 'colonial': _colonial, 'courtyard': _courtyard, 'modern': _modern, 'flytower': _flytower, 'cinema': _cinema,
          'oval': _oval, 'roundmuseum': _roundmuseum, 'domelattice': _domelattice, 'shells': _shells, 'cap': _cap, 'open': _open}[typ]
    fn(b, lk, brief, F, txt, srng, rng, dims, coarse)
    return b


def build(brief, style, rng, detail):
    return U.run(lambda r, coarse: _build(brief, style, r, detail, coarse), rng, detail)
