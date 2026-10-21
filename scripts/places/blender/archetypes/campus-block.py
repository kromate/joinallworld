"""campus-block: seven typologies chosen from the brief (style, size, storeys, footprint, roof, wording, features)

  faculty     modernist / brutalist / international slab, U, L or ring block: ribbon or punched windows, balcony bands, brise-soleil
              fins, pilotis, podium; library variant adds a colonnade and reading-room clerestory
  senate      administration block with a clock tower: classical (portico, hip roof, spire) or a modernist tower on a podium
  school      one- or two-storey school block with a veranda or access gallery, corrugated roof, painted dado, flagpole, yard
  collegiate  gothic / collegiate quadrangle: pointed windows, buttresses, cloister arcade, gatehouse with turrets, slate roof
  institute   glass-and-panel research institute: curtain wall, atrium, deep roof slab, brise-soleil
  gate        monumental campus gate: piers or portal, gatehouse lodges, railings, avenue and a block beyond
  colonial    (inside faculty) arcaded two-storey colonial college block with hip roof, galleries and courtyard

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

FEATURES = {'courtyard', 'fountain', 'brise-soleil', 'flags', 'signage-board', 'louvres', 'pilotis', 'podium', 'balcony-bands', 'colonnade',
            'portico', 'steps', 'gate', 'arcade', 'statue', 'car-park', 'water-tank', 'clock-tower', 'bell-tower', 'fence-wall', 'pediment',
            'dome', 'atrium-glass', 'kiosk', 'solar-panels', 'crenellation', 'pinnacles', 'spire', 'arches', 'terrace', 'curved-canopy', 'flat-canopy'}

CLASSICAL = ('colonial', 'neoclassical', 'georgian', 'victorian', 'baroque')
GOTHIC = ('gothic-revival', 'victorian', 'tudor')


# ------------------------------------------------------------------------------------------------------------- inference
def infer(brief):
    form = brief.get('form') or {}
    txt = U.text(brief)
    subj = ' '.join(str(brief.get(k) or '') for k in ('name', 'subject')).lower()
    F = U.feats(brief)
    style = brief.get('style') or ''
    w, d, st, h = U.dims(brief, 60, 22, 2, st_h=3.6)
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    var = str(form.get('variant') or '').lower()
    wk = (brief.get('facade') or {}).get('windows')
    ratio = U.num((brief.get('facade') or {}).get('windowRatio'), 0.3)
    if var in ('faculty', 'senate', 'school', 'collegiate', 'institute', 'gate'):
        return var, (w, d, st, h)
    if U.has(subj, 'campus gate', 'main gate', 'gateway', 'entrance gate', 'university gate'):
        return 'gate', (w, d, st, h)
    if U.has(subj, 'library') and st <= 4:
        return 'faculty', (w, d, st, h)
    if U.has(subj, 'senate') or 'clock-tower' in F:
        return 'senate', (w, d, st, h)
    if style in ('gothic-revival', 'tudor') or (style == 'victorian' and fpk in ('ring', 'U')) or U.has(txt, 'cloister', 'quadrangle', 'collegiate', 'gothic'):
        if style in GOTHIC + CLASSICAL or fpk == 'ring':
            return 'collegiate', (w, d, st, h)
    if style in ('contemporary', 'high-tech', 'postmodern') and (wk == 'curtain' or ratio >= 0.5 or U.has(txt, 'institute', 'research', 'centre', 'center')):
        return 'institute', (w, d, st, h)
    if st <= 2 and w <= 75 and roof in ('hip', 'gable', 'shed') and style not in ('neoclassical',):
        return 'school', (w, d, st, h)
    if U.has(subj, 'school', 'secondary', 'primary', 'polytechnic school', 'college of nursing', 'nursing') and st <= 3 and w <= 80:
        return 'school', (w, d, st, h)
    return 'faculty', (w, d, st, h)


def _wk(brief, default):
    wk = (brief.get('facade') or {}).get('windows')
    return wk if wk in ('curtain', 'ribbon', 'punched', 'arched', 'pointed-arch', 'screen', 'louvre') else default


def _plan(fpk, w, d, srng, bar_d, wing_w, rect_depth=None):
    side = 'left' if srng.random() < 0.4 else 'right'
    if fpk == 'rect':
        return U.plan_rects('rect', w, rect_depth or d)
    if fpk == 'cross':
        fpk = 'H'
    if fpk not in ('L', 'U', 'H', 'T', 'ring', 'irregular'):
        return U.plan_rects('rect', w, rect_depth or d)
    return U.plan_rects(fpk, w, d, None, bar_d=bar_d, wing_w=wing_w, side=side, open_to='back')


def _inner_edges(fp):
    x0, y0, x1, y1 = fp.bbox
    out = []
    for s in fp.edges():
        p = s.P(s.length / 2, 0.0, -1.5)  # 1.5 m outside
        if x0 + 0.5 < p[0] < x1 - 0.5 and y0 + 0.5 < p[1] < y1 - 0.5:
            out.append(s)
    return out


def _front_edges(fp, min_len=6.0):
    return [s for s in fp.edges() if s.front and s.length >= min_len]


def _entrance(b, lk, F, style, cx, y, w_ent, z_floor, st_h, srng, classical=False, cols=6):
    """Main entrance: classical portico (pediment for classical styles), a flat-roofed colonnaded porch, or a canopy."""
    seg = lib.Seg((cx - w_ent / 2, y), (cx + w_ent / 2, y))
    if 'portico' in F or classical:
        ped = w_ent * 0.14 if (classical or 'pediment' in F) else None
        U.portico_front(b, lk, cx, y, w_ent, 4.6, 0.7, st_h * (2 if classical else 1) * 0.95 + 0.6, cols, pediment_rise=ped, steps_n=6 if classical else 4,
                        col_r=0.3 if classical else 0.24, kind='round' if classical else 'square', col=lk.trim_col, entab_h=0.9, steps_w=w_ent * 0.7)
    else:
        U.entrance_canopy(b, lk, cx - w_ent / 2, cx + w_ent / 2, y, st_h + 0.4, 5.0, th=0.45, columns=2 if w_ent > 9 else 0, round_cols=True)
        if 'steps' in F:
            lib.steps(b, cx - w_ent * 0.3, cx + w_ent * 0.3, y - 5.0, 0.9, 2.4, 4, 'paving', lk.stone_col)
    U.door(b, seg, w_ent / 2, 2.8, 2.6, frame=lk.trim_col)


def _parapet_or_roof(b, lk, rects, fp, z1, form, pitch=24, ov=0.8, parapet=0.8):
    if form in ('hip', 'gable', 'pyramidal', 'mansard', 'shed'):
        U.roof_rects(b, form, rects, z1, lk, pitch=pitch, ov=ov)
    else:
        lib.flat_roof(b, fp, z1, lk, parapet_h=parapet, ov=0.0 if b.detail else 0.0)


# ---------------------------------------------------------------------------------------------------------------- faculty
def _faculty(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    library = U.has(txt, 'library')
    classical = style in CLASSICAL and roof in ('hip', 'gable')
    brut = style == 'brutalist' or lk.wall_material == 'exposed-concrete' and style != 'modernist' and 'brise-soleil' not in F
    st_h = U.clamp(h / max(1, st), 3.2, 4.4)
    z1 = st_h * st
    ww = U.clamp(w * 0.18, 12.0, 17.0)
    bd = U.clamp(d * 0.42, 12.0, 18.0)
    rect_depth = U.clamp(d, 11.0, 24.0)
    if fpk == 'rect' and d > 30 and 'courtyard' in F:
        fpk = 'U'
    rects = _plan(fpk, w, d, srng, bd, ww, rect_depth)
    bb = U.bbox_of(rects)
    bar = max([r for r in rects if r[4] == 'bar'] or rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    cx = (bar[0] + bar[2]) / 2
    fp = U.union_fp([r[:4] for r in rects])
    wk = _wk(brief, 'ribbon')
    ratio = U.clamp(lk.ratio, 0.18, 0.6)
    if brut:
        wk, ratio = 'punched', U.clamp(lk.ratio, 0.16, 0.3)
    if classical:
        wk = 'arched' if wk in ('ribbon', 'curtain') else wk
        ratio = U.clamp(lk.ratio, 0.2, 0.35)
    bay = (3.6 if wk in ('punched', 'arched') else 4.4) * (1 + 0.45 * coarse)
    pil = 'pilotis' in F and fpk in ('rect', 'L', 'T', 'irregular') and not classical
    pod = ('podium' in F or st >= 6) and fpk in ('rect', 'T', 'L', 'irregular') and not classical and st >= 4
    b.section('walls')
    zg = 0.0
    if pod:
        # slab above a two-storey podium that spreads wider than the slab
        pod_h = st_h * 2
        pr = (bar[0] - 3.0, bar[1] - 6.0, bar[2] + 3.0, bar[3] + 3.0)
        pfp = U.union_fp([pr])
        U.walls(b, pfp, 0, pod_h, 2, lk, rng, kind='ribbon' if wk != 'punched' else 'punched', ratio=ratio, bay=bay, plinth=0.5, ground_kind='curtain' if style in ('contemporary', 'international') else None)
        lib.flat_roof(b, pfp, pod_h, lk, parapet_h=0.5, ov=0.0)
        slab = (bar[0], bar[1] + 3.0, bar[2], bar[3])
        rects = [slab if r is bar else r for r in rects]
        fp = U.union_fp([r[:4] for r in rects])
        zg = pod_h
        sfp = fp
        U.walls(b, sfp, zg - 0.01, z1, max(1, st - 2), lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0)
    elif pil:
        zg = st_h
        # open ground floor: columns round the slab, a recessed dark glass wall, upper storeys on top
        for s in fp.edges():
            if s.length < 6:
                continue
            inset = 2.2 if s.front or s.rear else 0.0
            n = max(2, int(s.length / 5.0) + 1)
            n = n if b.detail == 0 else max(2, n // 2)
            for k in range(n):
                u = 0.6 + (s.length - 1.2) * k / (n - 1)
                x, y, _ = s.P(u, 0, 2.2)
                if b.detail >= 2:
                    continue
                lib.cylinder(b, x, y, 0, zg, 0.36, n=8 if b.detail == 0 else 5, slot='rough-concrete', col=lk.trim_col, r_top=0.3, top=False)
            if b.detail < 2:
                b.facing([s.P(0.0, 0, 3.6), s.P(s.length, 0, 3.6), s.P(s.length, zg, 3.6), s.P(0.0, zg, 3.6)], s.N3(), 'glass-shopfront', '#cfd8dc')
        U.walls(b, fp, zg, z1, max(1, st - 1), lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0)
        lib.sweep(b, fp, zg - 0.3, [(0, 0), (0.12, 0), (0.12, 0.3), (0, 0.3)], lk.wall_slot, shade(lk.trim_col, 0.9)) if b.detail == 0 else None
    else:
        gk = None
        if classical and b.detail < 2:
            gk = 'arched'
        U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.45, ground_kind=gk,
                band=(0.45, shade(lk.trim_col, 0.95)) if (style == 'modernist' and b.detail == 0 and 'balcony-bands' not in F and wk == 'punched') else None)
        U.plinth_band(b, fp, lk, 0.9)
    b.section('roof')
    if classical:
        U.roof_rects(b, roof, rects, z1, lk, pitch=26 if lk.roof_slot == 'clay-tile' else 20, ov=1.0)
        U.eaves_band(b, fp, z1, lk, 0.45, 0.45)
    elif roof in ('hip', 'gable'):
        U.roof_rects(b, roof, rects, z1, lk, pitch=18, ov=0.8)
    else:
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.8 if not brut else 0.5)
        if brut and b.detail == 0:
            U.eaves_band(b, fp, z1 + 0.5, lk, 0.7, 0.5, col=shade(lk.wall_col, 0.95))
    b.section('facade')
    front = [s for s in _front_edges(fp) if s.length > 8]
    if 'balcony-bands' in F and b.detail < 2 and not classical:
        for s in front:
            for k in range(1, max(1, st - (1 if pil else 0))):
                z = zg + k * st_h if pil else k * st_h
                if pod and k < 2:
                    continue
                U.balcony_slab(b, s, z, proud=1.2, col=shade(lk.trim_col, 0.97), u0=0.0, u1=s.length, rail_h=0.9)
    if 'brise-soleil' in F and b.detail == 0:
        for s in front:
            fins = max(1, int(s.length / 6))
            seg_fins = s
            U.fins_row(b, s, zg + 0.4 if not pil else zg + 0.2, z1 - 0.3, pitch=1.2, w=0.12, proud=0.55, col=shade(lk.accent_col, 1.0), u0=1.0, u1=s.length - 1.0)
    if brut and b.detail == 0:
        for s in front:
            us = [k * 6.0 + 3.0 for k in range(int(s.length / 6.0))]
            U.piers(b, s, us, 0.0, z1, 1.0, 0.7, shade(lk.wall_col, 0.9), lk.wall_slot)
        for s in front[:2]:
            lib.seg_box(b, s, 0, s.length, z1 - st_h * 0.95, z1, 1.4, shade(lk.wall_col, 0.88), lk.wall_slot)
    if classical and b.detail < 2:
        # colonial arcaded ground floor with a balustraded gallery
        for s in front:
            if s.length > 12:
                U.arcade(b, lk, s.p0, s.p1, 0, 2.6, st_h - 0.2, 2.6, bay_w=3.6, pier_w=0.7, col=lk.trim_col, slab=True)
                a, c = s.P(0, 0, 2.6), s.P(s.length, 0, 2.6)
                a2, c2 = s.P(-0.0, 0, 2.6), s.P(s.length, 0, 2.6)
                aa, cc = s.P(0, 0, 2.6), s.P(s.length, 0, 2.6)
                U.balustrade(b, (s.P(0, 0, 2.6)[0], s.P(0, 0, 2.6)[1]), (s.P(s.length, 0, 2.6)[0], s.P(s.length, 0, 2.6)[1]), st_h + 0.2, 1.0, lk.trim_col) if b.detail == 0 else None
    # entrance
    b.section('entrance')
    ent_w = U.clamp((bar[2] - bar[0]) * 0.25, 9.0, 18.0)
    y_front = bar[1] if not pod else bar[1] - 6.0
    _entrance(b, lk, F, style, cx, y_front, ent_w, 0.0, st_h, srng, classical=classical, cols=6 if classical else 4)
    if 'colonnade' in F and not classical and b.detail < 2:
        x0c, x1c = bar[0] + 4.0, bar[2] - 4.0
        yc = y_front - 3.2
        n = max(4, int((x1c - x0c) / 4.5) + 1)
        n = n if b.detail == 0 else max(3, n // 2)
        for k in range(n):
            x = x0c + (x1c - x0c) * k / (n - 1)
            lib.cylinder(b, x, yc, 0, st_h + 0.6, 0.3, n=10 if b.detail == 0 else 6, slot=lk.wall_slot, col=lk.trim_col, r_top=0.3, top=False)
        lib.box(b, x0c - 0.8, yc - 1.2, st_h + 0.6, x1c + 0.8, y_front, st_h + 1.1, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=())
    if library and b.detail < 2:
        # reading-room clerestory block on the roof
        rw = (bar[2] - bar[0]) * 0.4
        rfp = lib.fp_rect(rw, (bar[3] - bar[1]) * 0.6, cx, (bar[1] + bar[3]) / 2)
        U.walls(b, rfp, z1, z1 + 3.4, 1, lk, rng, kind='ribbon', ratio=0.5, bay=bay, plinth=0, rear='same')
        lib.flat_roof(b, rfp, z1 + 3.4, lk, parapet_h=0.3, ov=0.5, slab=0.3)
    if 'solar-panels' in F:
        U.solar_row(b, lk, (bar[0] + 2, bar[1] + 2, bar[2] - 2, bar[3] - 2), z1 + 0.3, rng, 2)
    if roof == 'flat' and b.detail == 0:
        U.roof_plant(b, lk, (bar[0] + 2, bar[1] + 2, bar[2] - 2, bar[3] - 2), z1, rng, count=3)
    if roof not in ('hip', 'gable') and not classical:
        U.skyline(b, lk, rects, z1, st_h, srng, rng, kind=wk, ratio=ratio, bay=bay)
        U.roof_variety(b, lk, [r[:4] for r in rects], z1, srng, st_h)
    # courtyard garden + features
    b.section('courtyard')
    holes = fp.polys[1:]
    if holes:
        xs = [p[0] for p in holes[0]]
        ys = [p[1] for p in holes[0]]
        U.courtyard_garden(b, lk, (min(xs), min(ys), max(xs), max(ys)), srng, fountain_r=3.0 if 'fountain' in F else 0.0, trees=4)
    elif fpk in ('U', 'H', 'L') and 'courtyard' in F:
        inner = _inner_edges(fp)
        if fpk == 'U':
            wings = [r for r in rects if r[4] == 'wing']
            if len(wings) == 2:
                U.courtyard_garden(b, lk, (wings[0][2], bar[3], wings[1][0], bb[3] + 6), srng, fountain_r=3.0 if 'fountain' in F else 0.0, trees=4)
    if fpk in ('U', 'L', 'H') and classical and b.detail < 2:
        for s in _inner_edges(fp):
            if s.length > 10:
                U.arcade(b, lk, s.p0, s.p1, 0, 2.6, st_h - 0.2, 2.4, bay_w=3.6, pier_w=0.7, col=lk.trim_col, slab=True)
    b.section('site')
    fnt_f = 'fountain' in F and (lk.forecourt in ('plaza', 'garden', 'none', None) and not holes)
    px = U.site_common(b, lk, brief, {k: v for k, v in F.items() if not (k == 'fountain' and holes or k == 'fountain' and fpk in ('U',))}, txt, srng, bb, cx=cx,
                       front=22.0 if pod else 18.0, tank_at=(bb[2] + 6, bb[3] - 3), trees=6, forecourt_default='plaza' if library else 'garden')
    if 'fountain' in F and fpk == 'U' and not holes and b.detail >= 0:
        pass
    return bb


# ---------------------------------------------------------------------------------------------------------------- senate
def _senate(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    roof = form.get('roof') or 'flat'
    classical = style in CLASSICAL or roof in ('hip', 'gable') and style != 'modernist'
    st_h = U.clamp(h / max(1, st), 3.4, 4.6)
    z1 = st_h * st
    wk = _wk(brief, 'arched' if classical else 'ribbon')
    ratio = U.clamp(lk.ratio, 0.2, 0.5)
    bay = 3.8 * (1 + 0.45 * coarse)
    if classical:
        if wk in ('ribbon', 'curtain'):
            wk = 'arched'
        cw = U.clamp(w * 0.34, 14.0, 34.0)
        ww = (w - cw) / 2
        dd = U.clamp(d, 12.0, 28.0)
        centre = (-cw / 2, -dd / 2, cw / 2, dd / 2)
        wl = (-w / 2, -dd / 2 + 1.5, -cw / 2, dd / 2 - 1.5)
        wr = (cw / 2, -dd / 2 + 1.5, w / 2, dd / 2 - 1.5)
        zc = z1 + st_h * 0.3
        zw = z1 - st_h * 0.15 if st > 1 else z1
        b.section('walls')
        cfp = U.union_fp([centre])
        U.walls(b, cfp, 0, zc, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.5)
        for r in (wl, wr):
            fpw = U.union_fp([r])
            U.mass_walls(b, lk, fpw, 0, zw, st, others=[centre], rng=rng, kind=wk, ratio=ratio, bay=bay, plinth=0.5)
            U.plinth_band(b, fpw, lk, 0.8)
        b.section('roof')
        U.roof_rects(b, 'hip', [centre], zc, lk, pitch=24, ov=0.9)
        for r in (wl, wr):
            U.roof_rects(b, 'hip', [r], zw, lk, pitch=22, ov=0.9)
        U.eaves_band(b, cfp, zc, lk, 0.5, 0.5)
        # arcaded wings
        b.section('porch')
        for r, sgn in ((wl, 1), (wr, 1)):
            if b.detail < 2:
                U.arcade(b, lk, (r[0], r[1]), (r[2], r[1]), 0, 2.7, st_h - 0.2, 2.4, bay_w=3.6, pier_w=0.7, col=lk.trim_col)
        pw = cw * 0.7
        U.portico_front(b, lk, 0.0, centre[1], pw, 5.0, 0.8, st_h * 1.0 + 1.2, 6, pediment_rise=pw * 0.15, steps_n=7, col_r=0.34, kind='round', col=lk.trim_col, steps_w=pw * 0.8)
        seg = lib.Seg((centre[0], centre[1]), (centre[2], centre[1]))
        U.door(b, seg, cw / 2, 3.0, 3.0, frame=lk.trim_col)
        tw = U.clamp(cw * 0.34, 6.5, 9.5)
        b.section('tower')
        tz0 = zc - 0.01
        tower_h = U.clamp(h * 0.95 if h > z1 + 8 else z1 * 0.9, 14.0, 34.0)
        U.clock_tower(b, lk, 0.0, centre[1] + dd * 0.35, tz0, tw, tower_h, cap='hip', cap_rise=tw * 1.4, wall_col=lk.wall_col, stone_col=lk.trim_col, finial=2.2)
        bb = (wl[0], centre[1], wr[2], centre[3])
        px = U.site_common(b, lk, brief, F, txt, srng, bb, cx=0.0, front=22.0, tank_at=(bb[2] + 6, bb[3] - 3), trees=6, forecourt_default='garden')
        return bb
    # modernist: central tower on a podium of wings, clock on the tower
    b.section('walls')
    dd = U.clamp(d, 16.0, 36.0)
    base_h = st_h * 2.0
    wing = (-w / 2, -dd / 2, w / 2, dd / 2)
    bfp = U.union_fp([wing])
    U.walls(b, bfp, 0, base_h, 2, lk, rng, kind='ribbon' if wk != 'punched' else 'punched', ratio=ratio, bay=bay, plinth=0.5)
    lib.flat_roof(b, bfp, base_h, lk, parapet_h=0.7)
    tw, td = U.clamp(w * 0.18, 10.0, 16.0), U.clamp(dd * 0.55, 10.0, 18.0)
    trect = (-tw / 2, -td / 2 + 2.0, tw / 2, td / 2 + 2.0)
    tfp = U.union_fp([trect])
    tz = max(h, base_h + st_h * 3)
    ts = max(1, round((tz - base_h) / st_h))
    U.walls(b, tfp, base_h - 0.01, tz, ts, lk, rng, kind='ribbon' if wk != 'punched' else 'punched', ratio=ratio, bay=bay, plinth=0, rear='same')
    lib.flat_roof(b, tfp, tz, lk, parapet_h=0.8)
    if b.detail < 2:
        # clock faces high on the tower + fins
        r = min(tw * 0.22, 2.2)
        U.clock_face(b, 0.0, trect[1] - 0.05, tz - r * 1.7, r, (0, -1, 0))
        U.clock_face(b, 0.0, trect[3] + 0.05, tz - r * 1.7, r, (0, 1, 0))
        U.clock_face(b, trect[0] - 0.05, (trect[1] + trect[3]) / 2, tz - r * 1.7, r, (-1, 0, 0))
        U.clock_face(b, trect[2] + 0.05, (trect[1] + trect[3]) / 2, tz - r * 1.7, r, (1, 0, 0))
        lib.box_c(b, 0, trect[1] + td / 2, tz, tw * 0.5, td * 0.5, 2.6, lk.wall_slot, shade(lk.wall_col, 0.9), top_slot='roof-flat', top_col=lk.roof_col)
        lib.cylinder(b, 0, trect[1] + td / 2, tz + 2.6, tz + 9.0, 0.12, n=5, slot='frame', col=lk.metal_col, r_top=0.05, top=True)
    if 'balcony-bands' in F and b.detail < 2:
        for s in (s_ for s_ in tfp.edges() if s_.front):
            for k in range(1, ts):
                U.balcony_slab(b, s, base_h + k * st_h, proud=0.9, col=shade(lk.trim_col, 0.97), rail_h=0.8)
    b.section('entrance')
    _entrance(b, lk, F, style, 0.0, -dd / 2, U.clamp(w * 0.3, 10.0, 20.0), 0.0, st_h, srng, classical=False, cols=4)
    bb = wing
    px = U.site_common(b, lk, brief, F, txt, srng, bb, cx=0.0, front=22.0, tank_at=(bb[2] + 6, bb[3] - 3), trees=6, forecourt_default='plaza')
    return bb


# ---------------------------------------------------------------------------------------------------------------- school
def _school(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    fpk = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'hip'
    if roof not in ('hip', 'gable', 'shed', 'flat'):
        roof = 'hip'
    st = min(st, 2)
    st_h = 3.6 if st == 2 else 3.9
    z1 = st_h * st + (0.4 if st == 1 else 0.0)
    cd = 9.0 if st == 1 else 10.0
    ww = 9.5
    w_ = U.clamp(w, 20.0, 80.0)
    if fpk == 'rect':
        rects = U.plan_rects('rect', w_, cd)
    elif fpk in ('L', 'U'):
        rects = U.plan_rects(fpk, w_, max(d, cd + 14), None, bar_d=cd, wing_w=ww, open_to='back')
    elif fpk == 'T':
        rects = U.plan_rects('L', w_, max(d, cd + 12), None, bar_d=cd, wing_w=ww)
    else:
        rects = U.plan_rects('rect', w_, cd)
    bb = U.bbox_of(rects)
    bar = rects[0]
    cx = (bar[0] + bar[2]) / 2
    fp = U.union_fp([r[:4] for r in rects])
    wk = _wk(brief, 'punched')
    if wk in ('curtain', 'ribbon', 'screen'):
        wk = 'punched'
    ratio = U.clamp(lk.ratio, 0.2, 0.34)
    bay = 3.2 * (1 + 0.45 * coarse)
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.3)
    # painted dado band in the accent colour (very common on African school blocks)
    if b.detail < 2:
        lib.sweep(b, fp, 0.0, [(0.04, 0), (0.04, 1.15), (0, 1.15)], lk.wall_slot, lk.accent_col)
    b.section('roof')
    if roof == 'flat':
        lib.flat_roof(b, fp, z1, lk, parapet_h=0.6)
    else:
        U.roof_rects(b, roof, rects, z1, lk, pitch=15 if lk.roof_slot in ('corrugated', 'metal-roof') else 24, ov=0.95)
        if b.detail == 0 and roof == 'gable' and lk.roof_slot == 'corrugated':
            pass
    b.section('veranda')
    # veranda (or access gallery) along the long front of every block
    for r in rects:
        L = r[2] - r[0]
        if r is bar or L >= r[3] - r[1]:
            p0, p1 = (r[0], r[1]), (r[2], r[1])
            if st == 2:
                U.gallery2(b, lk, p0, p1, z1, st_h, depth=2.4, col=lk.trim_col)
            else:
                U.veranda(b, lk, p0, p1, 0.0, 2.9, 2.3, z1 - 0.4, post='square', pitch_m=2.8, col=lk.trim_col)
    for r in rects:
        if r[4] == 'wing':
            # inner face of side wings gets a veranda too (courtyard side)
            if abs(r[0] - bb[0]) < 0.1 and fpk in ('U', 'L'):
                p0, p1 = (r[2], r[3] - 0.5), (r[2], r[1] + 0.5)
            else:
                p0, p1 = (r[0], r[1] + 0.5), (r[0], r[3] - 0.5)
            if abs(p1[1] - p0[1]) > 6:
                if st == 2:
                    U.gallery2(b, lk, p0, p1, z1, st_h, depth=2.4, col=lk.trim_col)
                else:
                    U.veranda(b, lk, p0, p1, 0.0, 2.9, 2.3, z1 - 0.4, post='square', pitch_m=2.8, col=lk.trim_col)
    # entrance gable over the middle of the bar
    gw = 5.0
    if roof in ('hip', 'gable') and b.detail < 2 and st == 1:
        lib.box(b, cx - gw / 2, bar[1] - 2.3 - 0.2, 0.0, cx + gw / 2, bar[1] - 2.3 + 0.0, 3.2, lk.wall_slot, lk.trim_col, skip=('bottom', 'back'))
        U.pediment(b, cx - gw / 2 - 0.3, cx + gw / 2 + 0.3, bar[1] - 2.5, bar[1] - 0.3, 3.2, 1.0, lk, face_col=lk.accent_col)
    seg = lib.Seg((bar[0], bar[1]), (bar[2], bar[1]))
    U.door(b, seg, (bar[2] - bar[0]) / 2, 1.6, 2.2, frame=lk.trim_col)
    b.section('site')
    # assembly yard: a bare packed-earth/paving area in front, flag pole, goal posts? keep to the brief's features
    F2 = dict(F)
    F2.setdefault('flags', {'id': 'flags', 'count': 1})
    F2.setdefault('signage-board', {'id': 'signage-board', 'count': 1})
    if lk.tree in (None, 'none'):
        lk.tree = 'broadleaf'
    px = U.site_common(b, lk, brief, F2, txt, srng, bb, cx=cx, front=20.0, tank_at=(bb[2] + 5, bb[3] - 2), flag_h=8.0, flag_y=bb[1] - 11.0, trees=4,
                       fence_default=True, gate_w=5.0, forecourt_default='none', tree_h=8.5)
    return bb


# ------------------------------------------------------------------------------------------------------------- collegiate
def _collegiate(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'ring'
    gothic = style in ('gothic-revival', 'tudor', 'victorian') or U.has(txt, 'gothic')
    st = max(2, min(st, 4))
    st_h = U.clamp(h / st, 3.4, 4.8)
    z1 = st_h * st
    w = U.clamp(w, 40.0, 110.0)
    d = U.clamp(d, 30.0, 90.0)
    if fpk not in ('ring', 'U'):
        fpk = 'ring' if (w >= 55 and d >= 45) else 'U'
    ww = U.clamp(min(w, d) * 0.2, 11.0, 15.0)
    rects = U.plan_rects(fpk, w, d, None, bar_d=ww, wing_w=ww, open_to='back')
    bb = U.bbox_of(rects)
    fp = U.union_fp([r[:4] for r in rects])
    bar = rects[0]
    wall_slot = lk.wall_slot
    if gothic and lk.wall_slot in ('plain-render',):
        lk.wall_slot = 'stone-blocks'
    wk = 'pointed-arch' if gothic else 'arched'
    ratio = U.clamp(lk.ratio, 0.22, 0.36)
    bay = 4.0 * (1 + 0.45 * coarse)
    b.section('walls')
    U.walls(b, fp, 0, z1, st, lk, rng, kind=wk, ratio=ratio, bay=bay, plinth=0.5, ground_h=st_h * 1.15)
    U.plinth_band(b, fp, lk, 0.9, 0.12)
    U.string_course(b, fp, st_h - 0.15, lk, 0.3, 0.12)
    b.section('roof')
    roofk = 'gable' if gothic else (form.get('roof') if form.get('roof') in ('hip', 'gable') else 'hip')
    U.roof_rects(b, roofk, rects, z1, lk, pitch=42 if gothic else 28, ov=0.5)
    # buttresses on the outer front/rear faces
    b.section('details')
    for s in fp.edges():
        if s.length > 10 and (s.front or s.rear or abs(s.n[0]) > 0.5):
            nb = int(s.length / 4.0)
            us = [(k + 0.5) * s.length / nb for k in range(nb)] if gothic else []
            if us and b.detail == 0 and coarse < 1:
                U.buttress_row(b, s, us[::1], z1, w=0.6, proud=0.6, col=shade(lk.trim_col, 0.95), slot='stone-blocks')
    # cloister arcade on the courtyard faces
    if b.detail < 2 and coarse < 3:
        for s in _inner_edges(fp):
            if s.length > 8:
                U.arcade(b, lk, s.p0, s.p1, 0, 2.7, st_h * 0.95, 2.4, bay_w=3.6, pier_w=0.6, col=shade(lk.trim_col, 0.95), pointed=gothic)
    # gatehouse tower on the front, with an arched portal, corner turrets and a crenellated crown
    b.section('gatehouse')
    gw, gd = 12.0, 7.0
    gh = z1 + st_h * 1.2
    cx = 0.0
    gy0 = bar[1] - gd
    gx0, gx1 = cx - gw / 2, cx + gw / 2
    gseg = lib.Seg((gx0, gy0), (gx1, gy0))
    if b.detail >= 2:
        lib.box(b, gx0, gy0, 0, gx1, bar[1], gh, 'plain', lk.wall_col)
    else:
        U.arch_portal(b, gseg, 0, gw, 0, gh, gw / 2, 4.4, 4.0 if gothic else 3.4, lk.wall_col, lk.wall_slot, pointed=gothic)
        for xs, sgn in ((gx0, -1), (gx1, 1)):
            b.facing([(xs, gy0, 0), (xs, bar[1], 0), (xs, bar[1], gh), (xs, gy0, gh)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.92))
        # upper window band on the gatehouse (oriel)
        if b.detail == 0:
            for k in range(3):
                u = gw * (0.28 + 0.22 * k)
                b.face([gseg.P(u - 0.5, gh - st_h * 1.0, -0.03), gseg.P(u + 0.5, gh - st_h * 1.0, -0.03), gseg.P(u + 0.5, gh - st_h * 1.0 + 1.9, -0.03), gseg.P(u - 0.5, gh - st_h * 1.0 + 1.9, -0.03)], 'glass-punched', lk.glass_col)
        for (tx, ty) in ((gx0, gy0), (gx1, gy0)):
            U.turret(b, tx, ty, 0.0, gh + 1.0, 1.15, lk.wall_col, lk.wall_slot, cone_h=3.4 if gothic else 2.4, cone_col=lk.roof_col if gothic else shade(lk.roof_col, 0.9))
        if gothic and b.detail == 0:
            for (tx, ty) in ((gx0, bar[1]), (gx1, bar[1])):
                U.turret(b, tx, ty, 0.0, gh + 1.0, 1.15, lk.wall_col, lk.wall_slot, cone_h=3.4, cone_col=lk.roof_col)
        # crenellated parapet on the gatehouse
        gfp = lib.fp_rect(gw, gd, cx, (gy0 + bar[1]) / 2)
        lib.flat_roof(b, gfp, gh, lk, parapet_h=0.0)
        for s in gfp.edges():
            U.crenellate_seg(b, s, gh, h=0.9, w=0.8, pitch=1.8, thick=0.45, col=lk.wall_col, slot=lk.wall_slot)
        if gothic and 'spire' in F:
            lib.cylinder(b, cx, (gy0 + bar[1]) / 2, gh, gh + 7.0, 1.6, n=8, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    # a bell turret / flèche on the ridge of the front range
    if gothic and b.detail < 2:
        fx, fy = (bar[0] + bar[2]) * 0.3, (bar[1] + bar[3]) / 2
        lib.cylinder(b, fx, fy, z1 + 5.5, z1 + 7.5, 0.7, n=6, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
        lib.cylinder(b, fx, fy, z1 + 7.5, z1 + 12.0, 0.9, n=6, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    # courtyard: lawn, cross paths, fountain, trees
    holes = fp.polys[1:]
    if holes:
        xs = [p[0] for p in holes[0]]
        ys = [p[1] for p in holes[0]]
        U.courtyard_garden(b, lk, (min(xs) + 2.4, min(ys) + 2.4, max(xs) - 2.4, max(ys) - 2.4), srng, fountain_r=2.8 if 'fountain' in F else 0.0, trees=4)
    elif fpk == 'U':
        wings = [r for r in rects if r[4] == 'wing']
        if len(wings) == 2:
            U.courtyard_garden(b, lk, (wings[0][2] + 2.4, bar[3], wings[1][0] - 2.4, bb[3] + 4), srng, fountain_r=2.8 if 'fountain' in F else 0.0, trees=4)
    lk.wall_slot = wall_slot
    F2 = {k: v for k, v in F.items() if k not in ('fountain',)}
    px = U.site_common(b, lk, brief, F2, txt, srng, (bb[0], gy0, bb[2], bb[3]), cx=0.0, front=18.0, tank_at=(bb[2] + 6, bb[3] - 3), trees=6, forecourt_default='garden')
    return bb


# ------------------------------------------------------------------------------------------------------------- institute
def _institute(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    form = brief.get('form') or {}
    style = brief.get('style') or ''
    fpk = form.get('footprint') or 'rect'
    st_h = U.clamp(h / max(1, st), 3.4, 4.6)
    z1 = st_h * st
    ww = U.clamp(w * 0.22, 12.0, 18.0)
    rects = _plan(fpk if fpk != 'ring' else 'U', w, d, srng, U.clamp(d * 0.45, 14, 20), ww, U.clamp(d, 14.0, 26.0))
    bb = U.bbox_of(rects)
    bar = max([r for r in rects if r[4] == 'bar'] or rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    cx = (bar[0] + bar[2]) / 2
    fp = U.union_fp([r[:4] for r in rects])
    bay = 3.2 * (1 + 0.45 * coarse)
    b.section('walls')
    # curtain wall with opaque accent panels: base facade is glass, storey edges are bands in the wall colour
    U.walls(b, fp, 0, z1, st, lk, rng, kind='curtain', bay=bay, plinth=0, front_kind='curtain', wall_col=lk.wall_col)
    b.section('roof')
    lib.flat_roof(b, fp, z1, lk, parapet_h=0.0, ov=0.9, slab=0.5, col=lk.roof_col)
    # opaque wall panels (solid bays) at the ends of the front to break up the glass
    front = _front_edges(fp, 10.0)
    if b.detail == 0:
        for s in front:
            for u in (0.0, s.length - 5.0):
                lib.seg_box(b, s, u, u + 5.0, 0.0, z1, 0.12, lk.wall_col, lk.wall_slot)
        for s in front:
            for k in range(1, st):
                lib.seg_box(b, s, 0, s.length, k * st_h - 0.2, k * st_h + 0.2, 0.2, shade(lk.accent_col, 1.0), lk.wall_slot)
    # atrium: protruding double-height glass box with a sloped glass roof at the entrance
    b.section('atrium')
    aw = U.clamp((bar[2] - bar[0]) * 0.24, 10.0, 18.0)
    ad = 8.0
    ah = st_h * 2
    afp = lib.fp_rect(aw, ad, cx, bar[1] - ad / 2)
    U.walls(b, afp, 0, ah, 2, lk, rng, kind='curtain', bay=3.0 * (1 + 0.45 * coarse), plinth=0, rear='same')
    if b.detail < 2:
        # sloped glass roof (shed) rising to the main wall
        pts = [(cx - aw / 2, bar[1] - ad, ah), (cx + aw / 2, bar[1] - ad, ah), (cx + aw / 2, bar[1], ah + 2.6), (cx - aw / 2, bar[1], ah + 2.6)]
        b.facing(pts, (0, -0.5, 1), 'glass-ribbon', '#a8bcc8', mode='tile')
        for xs, sgn in ((cx - aw / 2, -1), (cx + aw / 2, 1)):
            b.facing([(xs, bar[1] - ad, ah), (xs, bar[1], ah), (xs, bar[1], ah + 2.6)], (sgn, 0, 0), lk.wall_slot, lk.trim_col)
    else:
        lib.box(b, cx - aw / 2, bar[1] - ad, 0, cx + aw / 2, bar[1], ah, 'plain', lk.glass_col, skip=('bottom',))
    seg = lib.Seg((cx - aw / 2, bar[1] - ad), (cx + aw / 2, bar[1] - ad))
    U.door(b, seg, aw / 2, 3.2, 2.8, frame=lk.trim_col)
    if 'colonnade' in F or 'portico' in F:
        n = 5
        for k in range(n):
            x = cx - aw / 2 - 3 + (aw + 6) * k / (n - 1)
            if b.detail < 2:
                lib.cylinder(b, x, bar[1] - ad - 3.0, 0, ah + 0.4, 0.28, n=10 if b.detail == 0 else 6, slot='plain-render', col=lk.trim_col, r_top=0.28, top=False)
        lib.box(b, cx - aw / 2 - 3.6, bar[1] - ad - 3.6, ah + 0.4, cx + aw / 2 + 3.6, bar[1] - ad, ah + 0.8, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=())
    if 'brise-soleil' in F and b.detail == 0:
        for s in front:
            U.fins_row(b, s, 0.4, z1 - 0.3, pitch=1.5, w=0.1, proud=0.5, col=shade(lk.accent_col, 0.95), u0=6.0, u1=s.length - 6.0)
    if b.detail == 0:
        U.roof_plant(b, lk, (bar[0] + 2, bar[1] + 2, bar[2] - 2, bar[3] - 2), z1, rng, count=2)
    if 'solar-panels' in F:
        U.solar_row(b, lk, (bar[0] + 2, bar[1] + 2, bar[2] - 2, bar[3] - 2), z1 + 0.2, rng, 2)
    U.skyline(b, lk, rects, z1, st_h, srng, rng, kind='curtain', bay=bay)
    U.roof_variety(b, lk, [r[:4] for r in rects], z1, srng, st_h, kinds=('stair', 'tank', 'mast'))
    holes = fp.polys[1:]
    if fpk in ('U', 'ring'):
        wings = [r for r in rects if r[4] == 'wing']
        if len(wings) == 2:
            U.courtyard_garden(b, lk, (wings[0][2] + 1.0, bar[3], wings[1][0] - 1.0, bb[3] + 3), srng, fountain_r=0.0, trees=3)
    px = U.site_common(b, lk, brief, F, txt, srng, bb, cx=cx, front=24.0, tank_at=(bb[2] + 6, bb[3] - 3), trees=6, forecourt_default='plaza')
    return bb


# ----------------------------------------------------------------------------------------------------------------- gate
def _gate(b, lk, brief, F, txt, srng, rng, dims, coarse):
    w, d, st, h = dims
    style = brief.get('style') or ''
    classical = style in CLASSICAL + ('gothic-revival', 'tudor') or lk.wall_material in ('stone', 'brick', 'red-brick', 'limestone', 'sandstone')
    W = U.clamp(w, 14.0, 34.0)
    pier_w = 2.6 if classical else 1.6
    span = U.clamp(W - 2 * pier_w, 8.0, 24.0)
    ph = U.clamp(h, 5.5, 11.0)
    b.section('gate')
    col = lk.wall_col if classical else lk.trim_col
    cx = 0.0
    # carriageway: road through the gate
    if b.detail < 2:
        with b.site():
            b.face([(-W / 2 - 40, -6.0, 0.05), (W / 2 + 40, -6.0, 0.05), (W / 2 + 40, 40.0, 0.05), (-W / 2 - 40, 40.0, 0.05)], lk.ground_slot, lk.ground_col, scale=3.0)
            b.face([(-span / 2, -30.0, 0.07), (span / 2, -30.0, 0.07), (span / 2, 38.0, 0.07), (-span / 2, 38.0, 0.07)], 'asphalt', '#5a5c5f', scale=3.0)
    for sgn in (-1, 1):
        px = sgn * (span / 2 + pier_w / 2)
        if classical:
            lib.box_c(b, px, 0, 0, pier_w + 0.5, pier_w + 0.5, 0.9, 'stone-blocks', shade(col, 0.9), skip=('bottom',))
            lib.box_c(b, px, 0, 0.9, pier_w, pier_w, ph - 0.9, lk.wall_slot, col, skip=('bottom',))
            if b.detail < 2:
                lib.box_c(b, px, 0, ph, pier_w + 0.5, pier_w + 0.5, 0.45, lk.wall_slot, shade(col, 1.06))
                lib.cylinder(b, px, 0, ph + 0.45, ph + 1.8, pier_w * 0.4, n=6, slot=lk.wall_slot, col=shade(col, 1.04), r_top=0.0, top=False, smooth=False) if b.detail == 0 else None
                U.finial_ball(b, px, 0, ph + 0.45, 0.55, shade(col, 1.04))
        else:
            lib.box_c(b, px, 0, 0, pier_w, pier_w * 1.5, ph, 'rough-concrete', col, skip=('bottom',))
    # lintel / arch
    lz = ph - 0.2
    if classical:
        if b.detail >= 2:
            lib.box(b, -W / 2, -0.7, ph - 1.2, W / 2, 0.7, ph, 'plain', col)
        else:
            lib.box(b, -span / 2 - 0.1, -0.6, ph - 1.4, span / 2 + 0.1, 0.6, ph, lk.wall_slot, shade(col, 1.02), skip=('bottom',))
            if b.detail == 0:
                lib.box(b, -span / 2 - 0.3, -0.8, ph, span / 2 + 0.3, 0.8, ph + 0.3, lk.wall_slot, shade(col, 1.06))
    else:
        lib.box(b, -W / 2, -0.9, ph - 1.6, W / 2, 0.9, ph, 'rough-concrete', col, skip=('bottom',))
    if b.detail < 2:
        # blank sign panel on the lintel (no lettering)
        lib.box_c(b, cx, -0.75 if classical else -0.95, ph - 1.3 if classical else ph - 1.45, min(span * 0.6, 9.0), 0.12, 0.9, 'plain', srng.choice(['#f2f0e8', '#244a73', '#2f6b4f']))
    # side pedestrian openings (gatehouse lodges)
    for sgn in (-1, 1):
        lx = sgn * (W / 2 + 4.5)
        lib.box_c(b, lx, 3.0, 0, 7.0, 5.5, 3.4, lk.wall_slot, lk.wall_col, skip=('bottom',))
        if b.detail < 2:
            U.roof_rects(b, 'hip', [(lx - 3.5, 0.25, lx + 3.5, 5.75)], 3.4, lk, pitch=22, ov=0.5)
            seg = lib.Seg((lx - 3.5, 0.25), (lx + 3.5, 0.25))
            U.door(b, seg, 3.5, 1.2, 2.2, frame=lk.trim_col)
    # barrier arm + railings to both sides
    if b.detail < 2:
        with b.site():
            ex = W / 2 + 9.0
            for sgn in (-1, 1):
                x0, x1 = sgn * ex, sgn * (ex + 38.0)
                U.fence_wall(b, lk, min(x0, x1), 0, max(x0, x1), 0.0, gate_w=0, h=1.9, kind='railing', col=shade(lk.wall_col, 0.95), sides=False)
            if b.detail == 0:
                lib.beam(b, (-span / 2 + 0.3, -3.5), (span * 0.1, -3.5), 1.0, 1.12, 0.1, 'plain', '#f2f2ee')
    # flag poles and an avenue of trees leading to the block beyond
    cols = U.flag_cols(brief, lk, srng)
    if 'flags' in F:
        U.flags(b, lk, [-W / 2 - 2.0, W / 2 + 2.0], -3.0, 9.0, cols)
    if lk.tree not in (None, 'none') and b.detail < 2:
        for k in range(5):
            for sgn in (-1, 1):
                lib.tree(b, lk.tree, sgn * (span / 2 + 2.5), 6.0 + k * 7.0, 8.0 * srng.uniform(0.85, 1.1), srng, lk)
    # the block beyond (a simple two-storey faculty slab) so the gate has context
    bw = U.clamp(W * 1.6, 30.0, 52.0)
    by = 44.0
    bfp = lib.fp_rect(bw, 12.0, 0.0, by)
    sh = 7.4
    U.walls(b, bfp, 0, sh, 2, lk, rng, kind='ribbon', ratio=0.45, bay=4.2 * (1 + 0.45 * coarse), plinth=0.3, rear='same')
    lib.flat_roof(b, bfp, sh, lk, parapet_h=0.6)
    return (-W / 2 - 10, -3, W / 2 + 10, by + 6)


# ----------------------------------------------------------------------------------------------------------------- build
def _build(brief, style, rng, detail, coarse):
    b = U.new_builder('campus-block', detail, coarse, brief=brief)
    lk = U.look_for(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    F = U.feats(brief)
    txt = U.text(brief)
    typ, dims = infer(brief)
    fn = {'faculty': _faculty, 'senate': _senate, 'school': _school, 'collegiate': _collegiate, 'institute': _institute, 'gate': _gate}[typ]
    fn(b, lk, brief, F, txt, srng, rng, dims, coarse)
    return b


def build(brief, style, rng, detail):
    return U.run(lambda r, coarse: _build(brief, style, r, detail, coarse), rng, detail)
