"""church-classical: basilicas, baroque and domed churches, Orthodox cross-in-square churches, colonial classical and Romanesque-revival
churches with pediment facades and bell towers. Everything comes from the brief and the seeded rng.

Layout (metres): the nave runs along +Y, the west front faces the camera (-Y), the apse is at the far end.
Typologies chosen from the brief:
  basilica   nave + aisles, pediment facade (optionally with a columned portico), round-arched windows, pilasters; bell tower(s) as a
             single front tower (Georgian, with clock / cupola / spire), a side campanile, or twin towers (Romanesque / baroque)
  baroque    shaped two-storey facade with scrolls, twin towers with onion or pyramid caps, dome over the crossing
  domed      Greek-cross church with a central drum and dome, pedimented arms and corner belfries (Assumpta Maria, Owerri)
  orthodox   cross-in-square block under a low roof, big central drum and four small drums with onion domes, three apses, zakomari
             gables and an attached bell tower
"""
import math
import os
import random
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _church_gothic_util as U  # noqa: E402
from _church_gothic_util import NS, clamp  # noqa: E402

FEATURES = {'bell-tower', 'clock-tower', 'portico', 'pediment', 'colonnade', 'dome', 'onion-dome', 'arches', 'arcade', 'stained-glass', 'rose-window', 'relief-pattern',
            'mosaic', 'buttresses', 'pinnacles', 'crenellation', 'courtyard', 'steps', 'fence-wall', 'gate', 'flags', 'statue', 'car-park', 'signage-board', 'fountain',
            'floodlights', 'spire'}

STAIN = ['#5a74c8', '#a8485a', '#d4a63a', '#4f9a6a']


def infer(brief, style, rng):
    form = brief.get('form') or {}
    txt = U.text(brief)
    ft = U.feats(brief)
    sty = str(brief.get('style') or '')
    w = float(form.get('width_m') or 30)
    d = float(form.get('depth_m') or 16)
    H = clamp(float(form.get('height_m') or 14), 6.0, 46.0)
    fp = form.get('footprint') or 'rect'
    cfg = NS()
    cfg.H = H
    L, narrow = max(w, d), min(w, d)
    cfg.baroque = sty == 'baroque' or 'baroque' in txt or 'jesuit' in txt
    cfg.romanesque = 'romanesque' in txt or 'norman' in txt or 'byzantine-revival' in txt
    cfg.georgian = sty in ('georgian',) or 'georgian' in txt
    cfg.colonial = sty in ('colonial', 'caribbean', 'victorian') or 'colonial' in txt
    cfg.modernist = sty in ('modernist', 'international')
    ratio = max(w, d) / max(1.0, min(w, d))
    cfg.onion = 'onion-dome' in ft or any(k in txt for k in ('onion', 'russian', 'ukrain', 'belarus', 'moldov', 'kyiv', 'kiev', 'minsk', 'slav'))
    ethiopian = any(k in txt for k in ('ethiopian', 'tewahedo', 'coptic'))
    byz = ('orthodox' in txt or 'cross-in-square' in txt or ('byzantine' in txt and ('monast' in txt or 'chapel' in txt))) and not ethiopian and ratio < 1.6 and 'catholic' not in txt
    cfg.orthodox = (cfg.onion and ('onion-dome' in ft or not cfg.baroque)) or (byz and not cfg.baroque)
    cfg.round = (fp == 'round' or re.search(r'(?<!semi)\bcircular\b', txt) is not None or 'round church' in txt or 'rotunda' in txt) and not cfg.orthodox
    cfg.convent = fp in ('U', 'ring') or any(k in txt for k in ('convent', 'monaster', 'abbey', 'priory', 'cloister'))
    cfg.dome = ('dome' in ft or form.get('roof') in ('dome', 'multi-dome') or 'dome' in txt) and not (cfg.orthodox or cfg.round)
    cfg.cross = fp == 'cross' or 'greek-cross' in txt or 'greek cross' in txt or 'cruciform' in txt or 'cross-shaped' in txt or 'transept' in txt
    cfg.greek = cfg.dome and cfg.cross and abs(w - d) / max(w, d) < 0.15
    cfg.type = 'orthodox' if cfg.orthodox else ('round' if cfg.round else ('domed' if cfg.greek else 'nave'))
    cfg.L = L
    Wt = narrow
    if cfg.type == 'domed':
        dd = U.number_near(txt, ['dome'], 10, 60)
        Wt = clamp(dd * 1.0 if dd else L * 0.42, 12.0, 34.0)
        cfg.span = L
    elif cfg.cross:
        span = narrow
        Wt = clamp(span * (0.46 if span > 0.5 * L else 0.62), 8.0, 36.0)
        cfg.span = max(span, Wt * 1.5)
    else:
        cfg.span = Wt
    if cfg.convent and cfg.type == 'nave':
        L = clamp(L * 0.7, 20.0, 60.0)
        cfg.L = L
        Wt = clamp(narrow * 0.3, 10.0, 18.0)
    if cfg.type == 'nave':
        Wt = clamp(Wt, 7.0, 0.8 * L)
        if L / Wt > 4.4:
            Wt = L / 4.4
    cfg.Wt = Wt
    cfg.aisles = cfg.type == 'nave' and (Wt >= 17.0 or (Wt >= 14 and L >= 48))
    # towers
    cnt = int((ft.get('bell-tower') or {}).get('count') or 0)
    twin = ('twin' in txt) or ('two towers' in txt) or cnt == 2
    bell = 'bell-tower' in ft or 'clock-tower' in ft or 'tower' in txt or 'belfr' in txt or 'campanile' in txt
    if cfg.type == 'domed':
        cfg.tower = 'belfries'
        cfg.belfries = 8 if cnt >= 6 else 4
    elif cfg.type == 'orthodox':
        cfg.tower = 'front' if bell else 'none'
    elif twin or (cfg.baroque and bell and cfg.L >= 36):
        cfg.tower = 'twin'
    elif bell:
        side = ('side' in txt and 'tower' in txt) or cfg.romanesque or (not cfg.georgian and rng.random() < 0.4)
        cfg.tower = 'side' if side and not cfg.georgian else 'front'
        if 'central avenue' in txt or 'prominent' in txt or 'clock' in txt:
            cfg.tower = 'front'
    else:
        cfg.tower = 'none'
    cfg.clock = 'clock-tower' in ft or 'clock' in txt
    cfg.portico = ('portico' in ft or 'colonnade' in ft or 'pediment' in ft and not cfg.baroque) and cfg.tower != 'twin'
    cfg.pediment = 'pediment' in ft or cfg.type == 'nave'
    cfg.tower_h = U.number_near(txt, ['tower', 'spire', 'steeple', 'belfry', 'campanile'], 12, 120)
    cfg.stained = 'stained-glass' in ft or 'stained' in txt
    cfg.apse = 6 if (cfg.type == 'nave' and (cfg.romanesque or cfg.baroque or L >= 40)) else 0
    cfg.pitch = rng.uniform(24, 31) if not cfg.baroque else rng.uniform(21, 27)
    cfg.banded = None
    if any(k in txt for k in ('striped', 'banded', 'stripes', ' bands', 'banding', 'red and yellow', 'red/white')):
        cfg.banded = True
    cfg.arcade = 'arcade' in ft or 'arches' in ft
    cfg.pilasters = not cfg.modernist
    cfg.cap = None
    return cfg


def build(brief, style, rng, detail):
    b = lib.Builder('church', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    U.set_roof(lk, brief)
    cfg = infer(brief, style, random.Random(rng.getrandbits(64)))
    ft = U.feats(brief)
    if cfg.type == 'orthodox':
        return build_orthodox(b, lk, srng, cfg, brief, ft)
    if cfg.type == 'round':
        return build_round(b, lk, srng, cfg, brief, ft)
    return build_nave(b, lk, srng, cfg, brief, ft)


# ------------------------------------------------------------------------------------------------------------- nave churches
def build_nave(b, lk, srng, cfg, brief, ft):
    det = b.detail
    L, Wt, H = cfg.L, cfg.Wt, cfg.H
    cfg.porch = srng.random() < 0.4
    domed = cfg.type == 'domed'
    trim = lk.trim_col
    ws, wc = lk.wall_slot, lk.wall_col
    fac = brief.get('facade') or {}
    aisles = cfg.aisles
    Wn = Wt * 0.56 if aisles else Wt
    aw = (Wt - Wn) / 2
    pitch = math.radians(cfg.pitch if not domed else 15)
    rn = (Wn / 2) * math.tan(pitch)
    r_dome = 0.0
    ridge_target = H
    if domed or (cfg.dome and cfg.cross):
        r_dome = Wn * 0.5 * 0.96
        drum_h = r_dome * 0.55
        dome_h = r_dome * 0.86
        lant = 2.6
        ridge_target = H - drum_h - dome_h - lant
        ridge_target = max(ridge_target, H * 0.4)
    rn = min(rn, ridge_target * 0.4)
    hn = ridge_target - rn
    if hn < 3.6:
        hn = 3.6
        rn = max(1.2, ridge_target - hn)
    ha = za_top = None
    if aisles:
        ha = clamp(hn * 0.55, 3.0, hn - 3.0)
        za_top = clamp(ha + aw * math.tan(math.radians(18)), ha + 0.6, hn - 1.8)
    # ----- towers
    tk = cfg.tower
    tw = td = th = 0.0
    y_front = -L / 2
    y0 = y_front
    if tk == 'front':
        tw = clamp(Wn * 0.62, 4.5, 8.5)
        td = tw * 1.05
        th = (cfg.tower_h * 0.78) if cfg.tower_h else clamp(H * 1.5, 11.0, 36.0)
        th = max(th, hn + rn + 2.5)
        y0 = y_front + td
    elif tk == 'twin':
        tw = clamp(Wt * 0.26, 4.5, 9.5)
        td = tw
        th = (cfg.tower_h * 0.72) if cfg.tower_h else clamp(H * 1.45, 12.0, 36.0)
        th = max(th, hn + rn + 2.0)
        y0 = y_front + 0.7
    elif tk == 'side':
        tw = clamp(Wn * 0.46, 4.0, 7.5)
        td = tw
        th = (cfg.tower_h * 0.78) if cfg.tower_h else clamp(H * 1.75, 12.0, 38.0)
        th = max(th, hn + rn + 3.0)
        y0 = y_front
    # chancel / apse / transept
    sides = cfg.apse
    Wc = clamp(Wn * (0.85 if sides else 0.9), 4.0, Wn) if not domed else Wn
    Lc = clamp((L - (y0 - y_front)) * (0.22 if not domed else 0.0), 0.0, 22.0)
    y2 = L / 2
    y_nave_end = y2 - Lc
    pc = max(pitch, math.radians(24))
    hc = hn - (1.0 if not domed else 0.0)
    rc = min((Wc / 2) * math.tan(pc), rn) if not domed else rn
    tr = None
    if cfg.cross:
        depth = Wn
        if domed:
            yc = 0.0
        else:
            yc = y0 + 0.58 * (y2 - y0)
            yc = min(yc, y2 - (Wc / 2 + 3.0) - depth / 2)
            yc = max(yc, y0 + 6.0 + depth / 2)
        tr = NS(yc=yc, depth=depth, span=(cfg.span if domed else max(cfg.span, Wt + 4.0)), h=hn, rise=rn, door=False)
        y_nave_end = yc + depth / 2
    # ----- windows / decorations
    shape = 'round' if not cfg.modernist else 'rect'
    wide = Wt >= 14
    sur = 0.2 if not cfg.modernist else 0.0
    bay = 4.0 if L < 40 else 5.2
    nave_spec = U.win_spec(bay=bay, wf=0.4, wmin=0.9, wmax=1.8, sill_f=0.24, head_f=0.93, shape=shape, mull=0, surround=sur, depth=0.3)
    aisle_spec = U.win_spec(bay=bay, wf=0.4, wmin=0.9, wmax=1.5, sill_f=0.22, head_f=0.93, shape=shape, surround=sur, depth=0.3)
    clere_spec = U.win_spec(bay=bay, wf=0.34, wmin=0.8, wmax=1.3, sill_f=0.05, head_f=0.95, shape=shape, surround=0.0)
    chancel_spec = U.win_spec(bay=bay, wf=0.36, wmin=0.8, wmax=1.4, sill_f=0.22, head_f=0.94, shape=shape, surround=sur)
    gcyc = STAIN if cfg.stained else None
    bands = None
    if cfg.banded:
        cols = (fac.get('colours') or [])
        bc = cols[1] if len(cols) > 1 else lib.shade(wc, 0.7)
        bands = (1.1, bc)
    P = NS(Wt=Wt, Wn=Wn, y0=y0, y_nave_end=y_nave_end, hn=hn, rn=rn, ha=ha, za_top=za_top, Wc=Wc if (Lc > 0 or domed) else None, hc=hc, rc=rc, y2=(y2 if (Lc > 0 or domed) else None),
           apse=sides, transept=tr, win_nave=nave_spec, win_aisle=aisle_spec, win_clere=clere_spec, win_chancel=chancel_spec, glass_cycle=gcyc,
           buttress=1 if 'buttresses' in ft else 0, flying=False, plinth=0.6, trim=trim, front='none', cornice=0.42 if not cfg.modernist else 0.0, pilaster=0.7 if cfg.pilasters else 0.0, rose=False,
           win_shape=shape, door_shape='round', ov=0.7, ove=0.35, bands=bands, stringcourse=not cfg.modernist, frieze=cfg.romanesque)
    P.roof_slot = lk.roof_slot
    P.roof_col = lk.roof_col
    if domed:
        P.apse = 0
        tr.door = True
    info = U.complex_(b, lk, srng, P)
    if cfg.convent:
        b.section('cloister')
        form = brief.get('form') or {}
        Wr = clamp(float(form.get('width_m') or 60) * 0.42, 16.0, 36.0)
        Dr = clamp(float(form.get('depth_m') or 40) * 0.55, 16.0, 40.0)
        U.cloister(b, lk, srng, Wt / 2 + Wr / 2 - 0.4, y0 + (y_nave_end - y0) * 0.55, Wr, Dr, clamp(hn * 0.62, 5.0, 9.0), 'gable' if cfg.pitch > 22 else 'flat')
    # ----- facade
    b.section('facade')
    ft_x = 0.0
    x_tower_side = 1.0 if srng.random() < 0.5 else -1.0
    facade(b, lk, srng, cfg, P, ft, y0, hn, rn, ha, za_top, Wt, Wn, tk, bands, y_front)
    # ----- towers
    b.section('tower')
    top_h = H
    if tk == 'front':
        top_h = class_tower(b, lk, srng, cfg, 0.0, y_front + td / 2, tw, td, th, bands, ft)
    elif tk == 'twin':
        xo = Wt / 2 - tw / 2
        for sgn in (-1, 1):
            top_h = max(top_h, class_tower(b, lk, srng, cfg, sgn * xo, y_front + td / 2 - 0.35, tw, td + 0.7, th, bands, ft))
    elif tk == 'side':
        top_h = class_tower(b, lk, srng, cfg, x_tower_side * (Wt / 2 + tw / 2 - 0.2), y_front + td / 2 - 0.3, tw, td, th, bands, ft)
    elif tk == 'belfries':
        top_h = corner_belfries(b, lk, srng, cfg, Wn, tr.span if tr else L, hn + rn, H)
    if domed or (cfg.dome and tr):
        b.section('dome')
        crossing_dome(b, lk, srng, cfg, 0.0, tr.yc, hn + rn, r_dome, drum_h, dome_h, lant, ft)
    # ----- steps / site
    if det <= 1:
        face_x = 0.0
        if 'steps' in ft:
            sw = clamp(Wn * 0.5, 4.0, 10.0)
            U.front_steps(b, 0.0, y_front - (3.4 if cfg.portico else 0.0) if not domed else y_front - 0.1, sw, 0.55, 4, lk, run=1.6 if not cfg.portico else None)
    b.section('site')
    half_w = Wt / 2 + (tw if tk == 'side' else 0.0) + (clamp(float((brief.get('form') or {}).get('width_m') or 60) * 0.42, 16.0, 36.0) if cfg.convent else 0.0)
    ext = max(half_w, (tr.span / 2 if tr else 0)) + 9.0
    U.site_common(b, lk, srng, brief, ft, ext, y_front - (3.4 if cfg.portico else 0.0), y2 + (0 if not domed else 0), max(Wt / 2, tr.span / 2 if tr else 0), 0.0, medieval=False,
                  tree_h=9.0, front_margin=15.0 if not domed else 18.0, rear_margin=8.0, rail=True, headstone_n=0, statue_at=None, trees=6 if L < 45 else 8,
                  forecourt_default='plaza' if (domed or L >= 45) else 'garden')
    return b.objects()


def facade(b, lk, srng, cfg, P, ft, y0, hn, rn, ha, za_top, Wt, Wn, tk, bands, y_front):
    """West front: flat pedimented wall (two storeys when there are aisles) with doors, arched windows, pilasters and cornice, or a
    shaped baroque gable; a columned portico when asked. The towers are drawn by the caller."""
    det = b.detail
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    aisled = ha is not None
    stained = STAIN[1] if cfg.stained else None
    y = y0
    cx = 0.0
    domed = cfg.type == 'domed'
    if domed:
        # arm end of the Greek cross: the nave arm is in front; build its gable end like a transept end
        pass
    # --- the lower (aisle-height) wall across the full width
    if aisled:
        ops = []
        dw = clamp(Wn * 0.22, 1.8, 3.2)
        dh = clamp(dw * 1.9, 3.4, 5.4)
        ops.append(U.op(Wt / 2 - dw / 2, Wt / 2 + dw / 2, 0.0, dh, 'round', 'door', 1.0, 0.45, 0, 0.22, False))
        sdw = dw * 0.62
        for sgn in (-1, 1):
            c = Wt / 2 + sgn * (Wn / 2 + (Wt - Wn) / 4)
            ops.append(U.op(c - sdw / 2, c + sdw / 2, 0.0, min(ha - 0.9, sdw * 2.0), 'round', 'door', 1.0, 0.4, 0, 0.16, False))
        seg = U.wall(b, (-Wt / 2, y), (Wt / 2, y), 0.0, ha, lk, ops, ws, wc, trim, plinth=0.6, bands=bands)
        # upper nave front above the aisle roofs
        ww = clamp(Wn * 0.3, 1.4, 2.6)
        up_ops = [U.op(Wn / 2 - ww / 2, Wn / 2 + ww / 2, ha + 1.0, hn - 1.2, 'round', stained or 'glass', 1.0, 0.3, 1 if ww > 1.9 else 0, 0.2, True)] if hn - ha > 3.4 else []
        seg_up = U.wall(b, (-Wn / 2, y), (Wn / 2, y), ha, hn, lk, up_ops, ws, wc, trim, bands=bands)
    else:
        ops = []
        dw = clamp(Wt * 0.2, 1.8, 3.0)
        dh = clamp(dw * 1.9, 3.4, 5.2)
        ops.append(U.op(Wt / 2 - dw / 2, Wt / 2 + dw / 2, 0.0, dh, 'round', 'door', 1.0, 0.45, 0, 0.22, False))
        if Wt > 10:
            wwid = clamp(Wt * 0.11, 1.0, 1.7)
            for sgn in (-1, 1):
                c = Wt / 2 + sgn * Wt * 0.3
                ops.append(U.op(c - wwid / 2, c + wwid / 2, 1.6, min(hn - 1.0, 1.6 + wwid * 2.8), 'round', stained or 'glass', 1.0, 0.3, 0, 0.18, True))
        ww = clamp(Wt * 0.16, 1.0, 2.2)
        top_w = hn - 0.7
        s_w = dh + 1.0
        if top_w - s_w > 2.0 and Wt > 8:
            ops.append(U.op(Wt / 2 - ww / 2, Wt / 2 + ww / 2, s_w, top_w, 'round', stained or 'glass', 1.0, 0.3, 0, 0.18, True))
        if 'arcade' in ft and not cfg.portico and Wt > 9:
            na = max(3, int(Wt / 3.2))
            aw_ = Wt / na * 0.62
            for k in range(na):
                c = Wt / na * (k + 0.5)
                if abs(c - Wt / 2) < dw / 2 + aw_ / 2 + 0.2:
                    continue
                ops.append(U.op(c - aw_ / 2, c + aw_ / 2, 0.0, min(hn - 1.0, aw_ * 2.1), 'round', 'dark', 1.0, 0.45, 0, 0.16, False))
        seg = U.wall(b, (-Wt / 2, y), (Wt / 2, y), 0.0, hn, lk, ops, ws, wc, trim, plinth=0.6, bands=bands)
    # --- gable / pediment
    Wg = Wn if aisled else Wt
    gseg = lib.Seg((-Wg / 2, y), (Wg / 2, y))
    if cfg.baroque and aisled:
        _baroque_gable(b, lk, y, Wt, Wn, ha, hn, rn, trim)
        if det == 0:
            U.cross_finial(b, 0, y, hn + rn + 0.9, 1.8, trim)
    else:
        U.gable_tri(b, gseg, hn, rn, look=lk, slot=ws, col=wc)
        if det == 0:
            _raking_cornice(b, gseg, hn, rn, trim)
            r = clamp(rn * 0.26, 0.5, 1.4)
            if 'rose-window' in ft:
                U.rose_window(b, gseg, Wg / 2, hn + rn * 0.42, r * 1.1, lk, STAIN[0] if cfg.stained else '#5a6fb8')
            else:
                U.disc(b, gseg, Wg / 2, hn + rn * 0.42, r * 1.25, lib.shade(trim, 0.95), 'stone-blocks', 12, -0.05)
                U.disc(b, gseg, Wg / 2, hn + rn * 0.42, r, '#46494c' if not cfg.stained else STAIN[2], 'glass-punched', 12, -0.09)
            U.cross_finial(b, 0, y, hn + rn + 0.2, 1.8, trim)
    if not cfg.portico and not aisled and tk in ('none', 'side', 'twin') and cfg.porch and det <= 1:
        pw = clamp(Wt * 0.3, 4.2, 7.0)
        U.front_porch(b, lk, 0.0, y, pw, 3.2, min(hn - 0.7, 4.4), 1.4 + pw * 0.1, ws, wc, trim, shape='round', col_roof=lk.roof_col)
    if det == 0:
        if 'relief-pattern' in ft:
            U.wall_pattern(b, seg, dh + 0.7, dh + 2.3, lib.shade(trim, 0.9), 'relief')
        if 'mosaic' in ft and not cfg.banded:
            U.wall_pattern(b, seg, dh + 0.3, dh + 0.8, None, 'mosaic')
    # --- pilasters, entablature
    if det == 0:
        wl = Wt
        for u in ([0.0, wl] + ([Wt / 2 - Wn / 2, Wt / 2 + Wn / 2] if aisled else [wl * 0.28, wl * 0.72])):
            uu = clamp(u, 0.45, wl - 0.45)
            top = (hn if not aisled or abs(uu - wl / 2) < Wn / 2 - 0.2 else ha)
            U.sbox(b, seg, uu - 0.38, uu + 0.38, 0.5, top - 0.5, 0.18, trim, 'plain-render', top=False)
            U.sbox(b, seg, uu - 0.52, uu + 0.52, top - 0.5, top - 0.2, 0.24, trim, 'plain-render')
        U.sbox(b, seg, 0, Wt, (ha if aisled else hn) - 0.45, (ha if aisled else hn), 0.4, trim, 'plain-render')
        if aisled:
            U.sbox(b, seg_up, 0, Wn, hn - 0.45, hn, 0.38, trim, 'plain-render')
    # --- portico in front of the centre
    if cfg.portico and tk != 'front':
        wpor = clamp(Wn * 0.8 if aisled else Wt * 0.72, 5.0, 16.0)
        h_por = min((hn if not aisled else hn) * 0.74, 12.0)
        cols_n = 4 if wpor < 9 else 6
        if det >= 2:
            lib.box_c(b, 0, y - 1.6, 0, wpor, 3.2, h_por + 0.7, 'plain', trim, skip=('bottom',))
        else:
            lib.portico(b, 0.0, y, 0.0, wpor, 3.2, h_por, lk, cols=cols_n, pediment=True, steps_n=3 if det == 0 else 2)
    elif cfg.portico and tk == 'front':
        pass
    elif det <= 1 and 'arches' in ft and not aisled:
        pass


def _raking_cornice(b, seg, z, rise, col):
    L = seg.length
    pr, th = 0.22, 0.34
    b.face([seg.P(0, z, -pr), seg.P(L / 2, z + rise, -pr), seg.P(L / 2, z + rise + th, -pr), seg.P(0, z + th, -pr)], 'plain-render', col)
    b.face([seg.P(L / 2, z + rise, -pr), seg.P(L, z, -pr), seg.P(L, z + th, -pr), seg.P(L / 2, z + rise + th, -pr)], 'plain-render', col)


def _baroque_gable(b, lk, y, Wt, Wn, ha, hn, rn, trim):
    """Shaped two-tier front: scrolls rising from the aisle roofs to the nave front, a pediment on top."""
    ws, wc = lk.wall_slot, lk.wall_col
    seg = lib.Seg((-Wt / 2, y), (Wt / 2, y))
    aw = (Wt - Wn) / 2
    n = 6 if b.detail == 0 else 3
    R = min(aw, (hn - ha) * 0.9)
    for sgn in (-1, 1):
        # scroll: concave quarter circle from the outer edge (at the aisle eave) up to the nave front wall
        pts = [((aw - R) + R * math.sin((math.pi / 2) * k / n), ha + R - R * math.cos((math.pi / 2) * k / n)) for k in range(n + 1)]
        poly = [(aw - R, ha)] + pts[1:] + [(aw, ha)]
        if sgn > 0:
            poly = [(Wt - u, z) for (u, z) in poly]
        b.facing([seg.P(u, z, -0.05) for u, z in poly], (0, -1, 0), ws, wc, scale=U.tscale(ws, b.detail))
    gseg = lib.Seg((-Wn / 2, y), (Wn / 2, y))
    U.gable_tri(b, gseg, hn, rn, look=lk, slot=ws, col=wc)
    if b.detail == 0:
        _raking_cornice(b, gseg, hn, rn, trim)
        # a round niche under the pediment
        U.disc(b, gseg, Wn / 2, hn + rn * 0.4, clamp(rn * 0.26, 0.5, 1.3), '#46494c', 'glass-punched', 12, -0.06)


# ----------------------------------------------------------------------------------------------------------------- towers
def class_tower(b, lk, srng, cfg, cx, cy, tw, td, th, bands, ft):
    det = b.detail
    trim = lk.trim_col
    stained = STAIN[0] if cfg.stained else None
    U.square_tower(b, cx, cy, tw, td, 0.0, th, lk, srng, bands=bands, belfry=True, courses=3, buttress_stages=0, clock=cfg.clock, belfry_shape='round', west_window=True,
                   stained=stained, wall_slot=lk.wall_slot, wall_col=lk.wall_col, trim=trim)
    zt = th
    hw, hd = tw / 2, td / 2
    # entablature at the top and quoins
    if det == 0:
        for k, (x_, y_) in enumerate(((cx - hw, cy - hd), (cx + hw, cy - hd), (cx + hw, cy + hd), (cx - hw, cy + hd))):
            pass
        ring = lib.fp_polygon([(cx - hw, cy - hd), (cx + hw, cy - hd), (cx + hw, cy + hd), (cx - hw, cy + hd)])
        lib.cornice(b, ring, zt - 0.5, 0.45, 0.5, lk, col=trim)
        lib.sweep(b, ring, zt, [(0.4, 0), (0.4, 0.05)], 'plain-render', trim)
    cap = cfg.cap
    if cap is None:
        if 'crenellation' in ft:
            cap = 'crenel'
        elif cfg.baroque:
            cap = 'onion'
        elif cfg.georgian or cfg.clock:
            cap = 'cupola'
        elif cfg.romanesque:
            cap = 'pyramid'
        else:
            cap = srng.choice(['pyramid', 'hip', 'cupola', 'pyramid'])
    top = zt
    if cap == 'onion':
        r = tw / 2 * 0.95
        lib.cylinder(b, cx, cy, zt, zt + 1.0, r * 0.95, n=8 if det < 2 else 6, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
        U.dome(b, cx, cy, zt + 1.0, r, lk, height=r * 1.7, profile='onion', slot=lk.roof_slot, col=lk.roof_col, finial=1.6)
        top = zt + 1.0 + r * 1.7 + 1.6
    elif cap == 'cupola':
        U.pyramid(b, cx, cy, zt, tw, td, tw * 0.28, lk, ov=0.35)
        zb = zt + tw * 0.28 * 0.9
        r = tw * 0.27
        lib.cylinder(b, cx, cy, zb, zb + tw * 0.34, r, n=8, slot=lk.wall_slot, col=lk.trim_col, top=False, smooth=False)
        if det == 0:
            for k in range(8):
                a = k * math.pi / 4 + math.pi / 8
                px, py = cx + math.cos(a) * r * 0.95, cy + math.sin(a) * r * 0.95
                sg = lib.Seg((px - math.sin(a) * r * 0.26, py + math.cos(a) * r * 0.26), (px + math.sin(a) * r * 0.26, py - math.cos(a) * r * 0.26))
                b.facing([sg.P(0, zb + 0.35), sg.P(sg.length, zb + 0.35), sg.P(sg.length, zb + tw * 0.28), sg.P(0, zb + tw * 0.28)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
        U.dome(b, cx, cy, zb + tw * 0.34, r * 1.12, lk, height=r * 1.1, profile='hemi', slot=lk.roof_slot, col=lk.roof_col, finial=1.4)
        top = zb + tw * 0.34 + r * 1.1 + 1.4
    elif cap == 'crenel':
        rect = (cx - hw, cy - hd, cx + hw, cy + hd)
        lib.cap(b, [[(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])]], zt, True, 'roof-flat', lk.roof_col, scale=2.0)
        U.crenellate(b, rect, zt, lk, col=lib.shade(trim, 0.95))
        top = zt + 1.1
    elif cap == 'hip':
        U.pyramid(b, cx, cy, zt, tw, td, tw * 0.62, lk, ov=0.45)
        top = zt + tw * 0.62
    else:
        rise = tw * (1.1 if cfg.romanesque else 0.85)
        U.pyramid(b, cx, cy, zt, tw, td, rise, lk, ov=0.4)
        top = zt + rise
        if det == 0:
            U.cross_finial(b, cx, cy, top, 1.4, '#c9b677')
            top += 1.4
    if 'pinnacles' in ft and det == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                U.pinnacle(b, cx + sx * (hw - 0.2), cy + sy * (hd - 0.2), zt - 0.2, 0.6, 2.4, lk)
    return top


def corner_belfries(b, lk, srng, cfg, Wn, span, z_ridge, H):
    """Octagonal belfry towers flanking the end of each arm of a Greek cross (4 or 8)."""
    det = b.detail
    r = clamp(Wn * 0.1, 2.2, 3.6)
    hw = Wn / 2
    reach = span / 2
    th = clamp(H * 0.62, 10.0, 26.0)
    pos = []
    for sx in (-1, 1):
        pos.append((sx * (hw - r * 0.6), -(reach - r * 0.6)))
        pos.append((sx * (hw - r * 0.6), (reach - r * 0.6)))
    if cfg.belfries >= 8:
        for sy in (-1, 1):
            pos.append((-(reach - r * 0.6), sy * (hw - r * 0.6)))
            pos.append(((reach - r * 0.6), sy * (hw - r * 0.6)))
    n = 8
    for (x, y) in pos:
        lib.cylinder(b, x, y, 0, th, r, n=n if det < 2 else 8, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
        if det == 0:
            for k in range(0, 8, 2):
                a = k * math.pi / 4 + math.pi / 8
                px, py = x + math.cos(a) * r * 0.98, y + math.sin(a) * r * 0.98
                sg = lib.Seg((px - math.sin(a) * r * 0.3, py + math.cos(a) * r * 0.3), (px + math.sin(a) * r * 0.3, py - math.cos(a) * r * 0.3))
                b.facing([sg.P(0, th - 3.6), sg.P(sg.length, th - 3.6), sg.P(sg.length, th - 0.8), sg.P(0, th - 0.8)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
            lib.cylinder(b, x, y, th - 0.4, th + 0.2, r * 1.15, n=8, slot='plain-render', col=lk.trim_col, top=True, smooth=False)
        lib.cylinder(b, x, y, th + 0.2, th + r * 1.5, r * 1.1, n=8, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    return th + r * 1.5


def crossing_dome(b, lk, srng, cfg, cx, cy, z, r, drum_h, dome_h, lant, ft):
    """Drum with windows, a ribbed-looking dome and a lantern over the crossing."""
    det = b.detail
    n = 16 if det == 0 else (12 if det == 1 else 8)
    lib.cylinder(b, cx, cy, z - 1.0, z + drum_h, r, n=n, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=det > 0 and False)
    if det == 0:
        for k in range(n):
            if k % 2:
                continue
            a = (k + 0.5) * 2 * math.pi / n
            px, py = cx + math.cos(a) * r * 0.995, cy + math.sin(a) * r * 0.995
            sg = lib.Seg((px - math.sin(a) * r * 0.16, py + math.cos(a) * r * 0.16), (px + math.sin(a) * r * 0.16, py - math.cos(a) * r * 0.16))
            b.facing([sg.P(0, z + drum_h * 0.22), sg.P(sg.length, z + drum_h * 0.22), sg.P(sg.length, z + drum_h * 0.82), sg.P(0, z + drum_h * 0.82)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
        lib.cylinder(b, cx, cy, z + drum_h - 0.2, z + drum_h + 0.35, r * 1.07, n=n, slot='plain-render', col=lk.trim_col, top=True, smooth=False)
    domecol = lk.roof_col
    U.dome(b, cx, cy, z + drum_h, r * 1.02, lk, height=dome_h, profile='hemi', slot=lk.roof_slot, col=domecol, lantern=lant, finial=1.6)


# ------------------------------------------------------------------------------------------------------------------ orthodox
def build_orthodox(b, lk, srng, cfg, brief, ft):
    det = b.detail
    form = brief.get('form') or {}
    w = float(form.get('width_m') or 20)
    d = float(form.get('depth_m') or 24)
    H = cfg.H
    Wo = clamp(min(w, d), 11.0, 40.0)
    Do = clamp(max(w, d) * (1.0 if max(w, d) > min(w, d) * 1.05 else 1.12), Wo * 1.05, 60.0)
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    txt = U.text(brief)
    gold = '#d6b24a'
    dome_col = gold
    if 'blue' in txt:
        dome_col = '#2c5aa0'
    elif 'green' in txt and 'roof' not in txt:
        dome_col = '#3f8a5a'
    elif 'silver' in txt:
        dome_col = '#c8ccd2'
    onion = cfg.onion
    if not onion:
        dome_col = lk.roof_col
        gold = '#c9b677'
    prof = 'onion' if onion else 'hemi'
    Dm = Do - Wo * 0.17
    rc = clamp(Wo * (0.17 if onion else 0.2), 1.8, 6.5)
    hn = clamp(H * 0.5, 6.0, 18.0)
    rs = rc * 0.55
    rise = clamp(Wo * 0.12, 1.8, 4.5)
    b.section('walls')
    ycen = 0.0
    x0, x1 = -Wo / 2, Wo / 2
    yf, yr = -Do / 2, -Do / 2 + Dm
    # four walls, each with narrow round-headed windows and zakomari (semicircular gable heads)
    def run(p0, p1, door=False, n_target=None):
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        n = n_target or max(2, round(L / 4.2))
        ops = U.bay_ops(L, n, 0.0, None, 0.95, hn * 0.3, hn - 1.0, 'round', 'glass', 1.0, 0.3, 0, 0.12, False)
        if door:
            dw = 2.4
            ops = [o for o in ops if abs((o['u0'] + o['u1']) / 2 - L / 2) > 2.4]
            ops.append(U.op(L / 2 - dw / 2, L / 2 + dw / 2, 0.0, 4.2, 'round', 'door', 1.0, 0.45, 0, 0.2, False))
        seg = U.wall(b, p0, p1, 0.0, hn, lk, ops, ws, wc, trim, plinth=0.6)
        if det == 0:
            U.sbox(b, seg, 0, seg.length, hn - 0.4, hn, 0.25, trim, 'plain-render')
            nz = max(1, round(L / 6.5))
            zr = L / nz / 2
            for k in range(nz):
                c = L / nz * (k + 0.5)
                pts = [(c - zr + zr * (1 - math.cos(math.pi * j / 8)), hn + zr * math.sin(math.pi * j / 8)) for j in range(9)]
                b.face([seg.P(c - zr, hn, -0.04)] + [seg.P(u, z, -0.04) for u, z in pts[1:-1]] + [seg.P(c + zr, hn, -0.04)], ws, wc, scale=U.tscale(ws, 0))
                U.disc(b, seg, c, hn + zr * 0.45, zr * 0.18, lib.shade(trim, 0.85), 'plain', 6, -0.08)
        return seg
    run((x0, yf), (x1, yf), door=True)
    run((x1, yf), (x1, yr))
    run((x1, yr), (x0, yr))
    run((x0, yr), (x0, yf))
    b.section('roof')
    roof_col = lk.roof_col
    # low hipped roof over the square, pitched like the zakomari ridges
    U.pyramid(b, 0, (yf + yr) / 2, hn, Wo, Dm, rise * 1.3, lk, slot=lk.roof_slot, col=roof_col, ov=0.35)
    zr0 = hn + rise * 1.3 * 0.9
    # central drum + onion dome
    yc_ = (yf + yr) / 2 + Dm * 0.04
    drum_h = clamp(rc * 1.9, 3.0, 8.0)
    dn = 12 if det == 0 else 8
    lib.cylinder(b, 0, yc_, zr0 - 0.4, zr0 + drum_h, rc, n=dn, slot=ws, col=wc, top=False, smooth=False)
    if det == 0:
        for k in range(dn):
            if k % 2:
                continue
            a = (k + 0.5) * 2 * math.pi / dn
            px, py = math.cos(a) * rc * 0.995, yc_ + math.sin(a) * rc * 0.995
            sg = lib.Seg((px - math.sin(a) * rc * 0.2, py + math.cos(a) * rc * 0.2), (px + math.sin(a) * rc * 0.2, py - math.cos(a) * rc * 0.2))
            b.facing([sg.P(0, zr0 + drum_h * 0.25), sg.P(sg.length, zr0 + drum_h * 0.25), sg.P(sg.length, zr0 + drum_h * 0.85), sg.P(0, zr0 + drum_h * 0.85)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
    ho = rc * (1.75 if onion else 1.0)
    U.dome(b, 0, yc_, zr0 + drum_h, rc * (1.22 if onion else 1.04), lk, height=ho, profile=prof, slot='metal-roof', col=dome_col, finial=0.0)
    top = zr0 + drum_h + ho
    if det <= 1:
        lib.cylinder(b, 0, yc_, top - 0.1, top + rc * 1.1, 0.07, n=4, slot='frame', col=gold, r_top=0.04, top=True)
        U.cross_finial(b, 0, yc_, top + rc * 0.6, rc * 1.2, gold)
    # four small drums at the corners (the five-dome Slavic type)
    for sx in ((-1, 1) if onion else ()):
        for sy in (-1, 1):
            px, py = sx * (Wo / 2 - rs * 1.6 - 0.3), yc_ + sy * (Dm / 2 - rs * 1.6 - 0.3)
            zb = hn + rise * 1.3 * 0.35
            dh = clamp(rs * 1.5, 1.6, 4.0)
            lib.cylinder(b, px, py, zb - 0.3, zb + dh, rs, n=8 if det < 2 else 6, slot=ws, col=wc, top=False, smooth=False)
            U.dome(b, px, py, zb + dh, rs * 1.22, lk, height=rs * 1.75, profile='onion', slot='metal-roof', col=dome_col)
            if det <= 1:
                U.cross_finial(b, px, py, zb + dh + rs * 1.75 - 0.1, rs * 1.0, gold)
    # three apses at the east end
    b.section('apses')
    aw = [(0.0, rc * 1.1, hn * 0.88), (-Wo * 0.3, rc * 0.62, hn * 0.7), (Wo * 0.3, rc * 0.62, hn * 0.7)]
    for (ax, ar, ah) in aw:
        U.apse(b, ax, yr, ar, 0.0, ah, lk, None, sides=6, window=True, ws=ws, wc=wc, roof_rise=ar * 1.0, shape='round', win_w=0.8, sill=ah * 0.3, head=ah - 0.8)
        if det <= 1:
            lib.cylinder(b, ax, yr, ah + ar * 1.0 - 0.05, ah + ar * 1.0 + 0.5, 0.05, n=4, slot='frame', col=gold, r_top=0.03, top=True)
    # bell tower at the front, attached (narthex tower)
    b.section('tower')
    tw = clamp(Wo * 0.28, 3.4, 8.0)
    th = clamp(H * 0.72, hn + 4, 34)
    tcy = yf + tw / 2 - 0.2
    U.square_tower(b, 0, tcy, tw, tw, 0.0, th, lk, srng, belfry=True, courses=2, buttress_stages=0, belfry_shape='round', west_window=False, door=True, door_w=2.2,
                   wall_slot=ws, wall_col=wc, trim=trim)
    tz = th
    cap_h = tw * 1.75
    U.pyramid(b, 0, tcy, tz, tw, tw, cap_h, lk, slot=lk.roof_slot, col=roof_col, ov=0.35)
    if det <= 1:
        U.dome(b, 0, tcy, tz + cap_h - 0.1, tw * 0.17, lk, height=tw * 0.28, profile='onion', slot='metal-roof', col=dome_col)
        U.cross_finial(b, 0, tcy, tz + cap_h + tw * 0.2, 1.4, gold)
    b.section('site')
    ext = max(Wo / 2, 0.0) + 8.0
    U.site_common(b, lk, srng, brief, ft, ext, yf - 0.0, yr + rc * 1.3, Wo / 2, 0.0, tree_h=8.0, front_margin=13.0, rear_margin=8.0, rail=True, trees=7, forecourt_default='garden')
    return b.objects()


# -------------------------------------------------------------------------------------------------------------------- round
def build_round(b, lk, srng, cfg, brief, ft):
    """Circular church: an outer ring (ambulatory) under a low conical roof round a taller drum with a dome or cone, an optional ring of
    columns (arcade), entrance steps and a cross on top (after the Ethiopian round churches and rotundas)."""
    det = b.detail
    form = brief.get('form') or {}
    H = cfg.H
    R = clamp(min(float(form.get('width_m') or 30), float(form.get('depth_m') or 30)) / 2, 7.0, 30.0)
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    n = 16 if det == 0 else (12 if det == 1 else 8)
    ha = clamp(H * 0.34, 3.6, 9.0)
    ri = R * 0.64
    hd = clamp(H * 0.66, ha + 3.0, H - 3.0)
    b.section('ring')
    fp = lib.fp_round(R, n)
    for k, e in enumerate(fp.edges()):
        ops = []
        if det <= 1:
            # an entrance in the front-most facet, round-headed windows in the others
            front = e.n[1] < -0.9
            if front:
                dw = min(2.6, e.length * 0.5)
                ops = [U.op(e.length / 2 - dw / 2, e.length / 2 + dw / 2, 0.0, min(ha - 0.5, dw * 1.9), 'round', 'door', 1.0, 0.4, 0, 0.2, False)]
            elif e.length > 2.2:
                ww = min(1.2, e.length * 0.4)
                ops = [U.op(e.length / 2 - ww / 2, e.length / 2 + ww / 2, ha * 0.28, ha - 0.8, 'round', STAIN[k % 4] if cfg.stained else 'glass', 1.0, 0.28, 0, 0.12, True)]
        U.wall(b, e.p0, e.p1, 0.0, ha, lk, ops, ws, wc, trim, plinth=0.5)
    # low conical roof over the ring (a frustum up to the drum)
    rh = (R - ri) * 0.42
    lib.cylinder(b, 0, 0, ha, ha + rh, R + 0.7, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=ri, top=False, smooth=False)
    if 'arcade' in ft or 'colonnade' in ft:
        for k in range(n):
            a = 2 * math.pi * (k + 0.5) / n
            lib.column(b, math.cos(a) * (R + 1.5), math.sin(a) * (R + 1.5), 0.0, ha + 0.1, 0.22, lk, 'round', capital=det == 0, col=lib.shade(trim, 0.95), n=6 if det == 0 else 4)
    b.section('drum')
    dp = lib.fp_round(ri, n)
    for k, e in enumerate(dp.edges()):
        ops = []
        if det <= 1 and e.length > 1.6:
            ww = min(1.1, e.length * 0.36)
            ops = [U.op(e.length / 2 - ww / 2, e.length / 2 + ww / 2, ha + rh + 0.6, hd - 1.0, 'round', STAIN[k % 4] if cfg.stained else 'glass', 1.0, 0.25, 0, 0.1, True)]
        U.wall(b, e.p0, e.p1, ha + rh - 0.2, hd, lk, ops, ws, wc, trim)
    if det == 0:
        lib.sweep(b, dp, hd - 0.1, [(0.3, 0), (0.3, 0.5), (0, 0.5)], 'plain-render', trim)
    top = hd
    if cfg.dome or 'dome' in ft:
        dh = ri * 0.75
        U.dome(b, 0, 0, hd, ri * 1.02, lk, height=dh, profile='shallow' if False else 'hemi', slot=lk.roof_slot, col=lk.roof_col, finial=0.0)
        top = hd + dh
    else:
        ch = ri * 1.1
        lib.cylinder(b, 0, 0, hd, hd + ch, ri + 0.5, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
        top = hd + ch
    if det <= 1:
        lib.cylinder(b, 0, 0, top - 0.1, top + 2.0 + ri * 0.2, 0.08, n=4, slot='frame', col='#c9b677', r_top=0.04, top=True)
        U.cross_finial(b, 0, 0, top + 0.9, 2.0 + ri * 0.2, '#c9b677')
    if 'steps' in ft and det <= 1:
        U.front_steps(b, 0.0, -R - (1.6 if ('arcade' in ft or 'colonnade' in ft) else 0.0), 5.0, 0.6, 4, lk)
    b.section('site')
    U.site_common(b, lk, srng, brief, ft, R + 12, -R - 1.5, R + 1.0, R, 0.0, tree_h=9.0, front_margin=14.0, rear_margin=8.0, rail=True, trees=7, forecourt_default='garden')
    return b.objects()
