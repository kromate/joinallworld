"""church-gothic: medieval parish churches, gothic-revival churches and cathedrals, colonial gothic, Romanesque twin-tower cathedrals and
postmodern 'neo-gothic' halls. Everything comes from the brief (form, facade, features, notes, style, era) and the seeded rng.

Layout (metres): the nave runs along +Y with the west front at the low-y end facing the camera (-Y); the chancel / apse is at the far end.
Typologies chosen from the brief:
  parish     west tower (battlemented, spired or capped) + nave + lower chancel + gabled south porch (England / vernacular / tudor)
  revival    nave with lancets and buttresses, west tower with broach spire or pyramid, rose or gable window (gothic-revival, colonial)
  twin       two projecting western towers around a gabled front with portal and rose window (cathedrals, Romanesque or gothic)
  cathedral  twin or crossing towers + aisles + clerestory + flying buttresses + transepts + polygonal apse
  folded     postmodern 'neo-gothic' hall: cross plan, tall pointed glazed gables, steep pyramid roof and a central spire
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _church_gothic_util as U  # noqa: E402
from _church_gothic_util import NS, clamp  # noqa: E402

FEATURES = {'spire', 'bell-tower', 'clock-tower', 'buttresses', 'rose-window', 'stained-glass', 'pinnacles', 'crenellation', 'arches', 'arcade', 'courtyard', 'steps',
            'fence-wall', 'gate', 'flags', 'statue', 'car-park', 'signage-board', 'fountain', 'floodlights'}

STAIN = ['#5a74c8', '#a8485a', '#d4a63a', '#4f9a6a', '#7a56a8']


def infer(brief, style, rng):
    form = brief.get('form') or {}
    fac = brief.get('facade') or {}
    txt = U.text(brief)
    ft = U.feats(brief)
    sty = str(brief.get('style') or '')
    era = str(brief.get('era') or '')
    w = float(form.get('width_m') or 30)
    d = float(form.get('depth_m') or 14)
    H = clamp(float(form.get('height_m') or 14), 6.0, 44.0)
    fp = form.get('footprint') or 'rect'
    L = max(w, d)
    narrow = min(w, d)
    big = L >= 44 or 'cathedral' in txt or H >= 22
    modern = sty in ('postmodern', 'contemporary', 'modernist', 'brutalist', 'international', 'high-tech')
    romanesque = 'romanesque' in txt or 'norman' in txt
    tudor = sty == 'tudor' or 'perpendicular' in txt
    colonial = sty in ('colonial', 'victorian', 'georgian', 'caribbean') or 'colonial' in txt
    medieval = (not colonial and not modern and sty in ('vernacular', 'gothic-revival', '') and ('medieval' in txt or 'century' in era or 'flint' in txt or 'village' in txt or 'tooting' in txt or 'churchyard' in txt)) or tudor
    cfg = NS()
    cfg.big, cfg.modern, cfg.romanesque, cfg.tudor, cfg.colonial, cfg.medieval = big, modern, romanesque, tudor, colonial, medieval
    cfg.H = H
    cfg.abbey = fp in ('U', 'ring', 'H') or any(k in txt for k in ('abbey', 'monaster', 'convent', 'priory', 'cloister'))
    cfg.cross = fp == 'cross' or ('cruciform' in txt) or ('cross-shaped' in txt) or ('transept' in txt)
    if cfg.abbey:
        cfg.cross = False
    if cfg.abbey:
        cfg.L = clamp(L * 0.7, 24.0, 62.0)
        Wt = clamp(narrow * 0.3, 11.0, 20.0)
        cfg.span = Wt
        cfg.cloister = (clamp(w * 0.5, 16.0, 36.0), clamp(d * 0.6, 16.0, 40.0))
    elif cfg.cross:
        span = min(w, d)
        cfg.L = L
        Wt = clamp(span * (0.46 if span > 0.5 * L else 0.62), 8.0, 42.0)
        cfg.span = max(span, Wt * 1.5) if span < Wt * 1.5 else span
    else:
        cfg.L = L
        Wt = narrow
        cfg.span = Wt
    Wt = clamp(Wt, 7.0, 0.8 * cfg.L)
    if cfg.L / Wt > 4.6:
        Wt = cfg.L / 4.6
    cfg.Wt = Wt
    cfg.aisles = Wt >= 15.5 or (big and Wt >= 13)
    if modern and not big:
        cfg.aisles = False
    # tower kind
    twin = ('twin' in txt) or ('two tower' in txt) or ('twin-tower' in txt)
    spire_f = 'spire' in ft or 'spire' in txt or 'steeple' in txt
    bell_f = 'bell-tower' in ft or 'clock-tower' in ft or ('tower' in txt and 'no tower' not in txt and 'without a tower' not in txt)
    if twin:
        cfg.tower = 'twin'
    elif cfg.modern and cfg.cross and big:
        cfg.tower = 'folded'
    elif spire_f and cfg.cross and big and not bell_f:
        cfg.tower = 'crossing'
    elif bell_f or spire_f:
        cfg.tower = 'west'
    else:
        cfg.tower = 'none'
    if cfg.tower == 'west' and big and cfg.L >= 60 and spire_f and cfg.cross:
        cfg.tower = 'crossing'
    cfg.clock = 'clock-tower' in ft or 'clock' in txt
    cfg.spire = spire_f
    cfg.pinn = 'pinnacles' in ft or 'pinnacle' in txt
    cfg.crenel = 'crenellation' in ft or tudor or (medieval and not spire_f and not colonial)
    cfg.rose = 'rose-window' in ft or 'rose window' in txt or (big and cfg.tower in ('twin',) and not colonial and rng.random() < 0.55)
    cfg.stained = 'stained-glass' in ft or 'stained' in txt
    cfg.buttress = 'buttresses' in ft or 'buttress' in txt or (not colonial and not modern and (big or sty == 'gothic-revival'))
    cfg.flying = big and cfg.aisles and cfg.buttress and not romanesque and cfg.L >= 56
    cfg.steps = 'steps' in ft
    cfg.porch = (medieval or tudor) and not cfg.big and cfg.tower != 'folded'
    cfg.apse = 5 if (big or (sty == 'gothic-revival' and cfg.aisles)) else (3 if (cfg.cross and not colonial) else 0)
    if romanesque and cfg.apse:
        cfg.apse = 5
    # window language
    if romanesque:
        cfg.shape, cfg.rf = 'round', 1.0
    elif tudor:
        cfg.shape, cfg.rf = 'rect', 1.0
    elif colonial:
        cfg.shape, cfg.rf = 'pointed', 1.45
    else:
        cfg.shape, cfg.rf = 'pointed', 1.25 if big else 1.1
    # roof pitch
    if romanesque:
        cfg.pitch = rng.uniform(28, 35)
    elif colonial:
        cfg.pitch = rng.uniform(32, 40)
    elif tudor or medieval:
        cfg.pitch = rng.uniform(34, 42)
    else:
        cfg.pitch = rng.uniform(44, 56) if big else rng.uniform(38, 50)
    cfg.tower_h = U.number_near(txt, ['tower', 'spire', 'steeple', 'belfry'], 12, 120)
    cfg.cap = None
    return cfg


def build(brief, style, rng, detail):
    b = lib.Builder('church', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    U.set_roof(lk, brief)
    cfg = infer(brief, style, random.Random(rng.getrandbits(64)))
    vr = random.Random(rng.getrandbits(64))   # variety stream (tower side, cap choice): identical at every LOD
    ft = U.feats(brief)
    det = detail
    form = brief.get('form') or {}
    trim = lk.trim_col
    if lk.wall_slot == 'plain-render' and (brief.get('facade') or {}).get('accent') in ('stone', 'sandstone', 'limestone', 'granite', 'marble'):
        pass
    # --------------------------------------------------------------------------------------------------------- proportions
    L, Wt, H = cfg.L, cfg.Wt, cfg.H
    if cfg.tower == 'folded':
        return build_folded(b, lk, srng, cfg, brief, ft, det)
    aisles = cfg.aisles
    Wn = Wt * 0.52 if aisles else Wt
    aw = (Wt - Wn) / 2
    pitch = math.radians(cfg.pitch)
    rn = (Wn / 2) * math.tan(pitch)
    rn = min(rn, H * 0.46)
    hn = H - rn
    if hn < 3.6:
        hn = 3.6
        rn = max(1.5, H - hn)
    ha = za_top = None
    if aisles:
        ha = clamp(hn * 0.5, 3.0, hn - 3.2)
        za_top = clamp(ha + aw * math.tan(math.radians(24)), ha + 0.8, hn - 2.0)
    # towers
    tw = td = th = 0.0
    tk = cfg.tower
    y_front = -L / 2
    if tk == 'west':
        tw = clamp(Wn * 0.55 if aisles else Wn * 0.5, 3.6, 8.0)
        td = tw * 1.0
        th = cfg.tower_h * 0.74 if cfg.tower_h else clamp(H * 1.45, 11.0, 38.0)
        if cfg.tower_h and (cfg.spire or cfg.pinn is False):
            th = cfg.tower_h * 0.62
        th = max(th, H * 1.15)
        y0 = y_front + td
    elif tk == 'twin':
        tw = clamp(Wt * (0.3 if aisles else 0.26), 4.5, 11.0)
        td = tw
        th = cfg.tower_h * 0.7 if cfg.tower_h else clamp(H * 1.5, 14.0, 40.0)
        th = max(th, H * 1.2)
        y0 = y_front + 1.2
    elif tk == 'crossing':
        y0 = y_front
    else:
        y0 = y_front
    # chancel and apse
    Wc = clamp(Wn * (0.62 if cfg.big else 0.7), 4.0, Wn)
    Lc = clamp((L - (y0 - y_front)) * (0.24 if cfg.big else 0.2), 4.0, 22.0)
    pc = max(pitch, math.radians(34))
    hc = max(3.2, hn - (1.6 if not cfg.big else 2.6))
    rc = min((Wc / 2) * math.tan(pc), rn)
    apse = cfg.apse
    y2 = L / 2
    y_nave_end = y2 - Lc
    tr = None
    if cfg.cross:
        depth = Wn
        yc = y0 + 0.6 * (y2 - y0)
        yc = min(yc, y2 - (Wc / 2 + 3.0) - depth / 2)
        yc = max(yc, y0 + 6.0 + depth / 2)
        tr = NS(yc=yc, depth=depth, span=max(cfg.span, Wt + 4.0), h=hn, rise=rn, door=cfg.big)
        y_nave_end = yc + depth / 2
    # --------------------------------------------------------------------------------------------------------- windows
    sh, rf = cfg.shape, cfg.rf
    mull = 1 if cfg.big else 0
    wide = Wt >= 14
    sur = 0.14 if lk.wall_slot in ('brick', 'plain-render', 'rough-concrete') or cfg.colonial else 0.0
    nave_spec = U.win_spec(bay=4.4 if not cfg.big else 5.2, wf=0.3 if not cfg.colonial else 0.24, wmin=0.8, wmax=1.7 if wide else 1.4, sill_f=0.2, head_f=0.94, shape=sh, rf=rf, mull=1 if (sh == 'rect' or wide) else 0,
                           surround=sur, tracery=(cfg.big or wide) and sh == 'pointed')
    aisle_spec = U.win_spec(bay=4.4 if not cfg.big else 5.2, wf=0.3, wmin=0.8, wmax=1.5, sill_f=0.22, head_f=0.93, shape=sh, rf=rf, mull=mull if aw > 4.5 else 0, surround=sur, tracery=False)
    clere_spec = U.win_spec(bay=aisle_spec['bay'], wf=0.27, wmin=0.7, wmax=1.4, sill_f=0.05, head_f=0.96, shape=sh, rf=rf, surround=0.0)
    chancel_spec = U.win_spec(bay=4.0, wf=0.27, wmin=0.7, wmax=1.3, sill_f=0.2, head_f=0.94, shape=sh, rf=rf, surround=sur)
    gcyc = [STAIN[(k + int(srng.random() * 5)) % 5] for k in range(5)] if cfg.stained else None
    ws, wc = lk.wall_slot, lk.wall_col
    P = NS(Wt=Wt, Wn=Wn, y0=y0, y_nave_end=y_nave_end, hn=hn, rn=rn, ha=ha, za_top=za_top, Wc=Wc, hc=hc, rc=rc, y2=y2, apse=apse, transept=tr,
           win_nave=nave_spec, win_aisle=aisle_spec, win_clere=clere_spec, win_chancel=chancel_spec, glass_cycle=gcyc,
           buttress=(2 if cfg.big else 1) if cfg.buttress else 0, flying=cfg.flying, plinth=0.6, trim=trim, front='gable' if tk in ('west', 'none', 'twin', 'crossing') else 'none',
           cornice=0.18 if not cfg.colonial else 0.0, rose=cfg.rose, win_shape=sh, door_shape=sh if sh != 'rect' else 'seg', front_window=tk != 'west' or True,
           ov=0.3 if not cfg.colonial else 0.7, ove=0.28, towers_flank=tk == 'twin', stringcourse=True, frieze=cfg.romanesque, aisle_front_window=tk != 'twin')
    P.roof_slot = lk.roof_slot
    P.roof_col = lk.roof_col
    if tk == 'twin':
        P.front = 'gable'
    info = U.complex_(b, lk, rng, P)
    if cfg.abbey:
        b.section('cloister')
        Wr, Dr = cfg.cloister
        hcl = clamp(hn * 0.62, 5.0, 9.0)
        U.cloister(b, lk, srng, Wt / 2 + Wr / 2 - 0.4, y0 + (y_nave_end - y0) * 0.5 + Dr * 0.1, Wr, Dr, hcl, 'flat' if (form.get('roof') == 'flat') else 'gable')
    # --------------------------------------------------------------------------------------------------------- towers
    b.section('tower')
    top_h = H
    if tk == 'west':
        toff = 0.0
        if not cfg.medieval and vr.random() < 0.34 and Wt - tw > 4:
            toff = vr.choice([-1, 1]) * (Wt / 2 - tw / 2 - 0.2)
        top_h = west_tower(b, lk, vr, cfg, toff, y_front + td / 2, tw, td, th, ft)
    elif tk == 'twin':
        xo = Wt / 2 - tw / 2
        for sgn in (-1, 1):
            top_h = max(top_h, west_tower(b, lk, vr, cfg, sgn * xo, y_front + td / 2, tw, td, th, ft, twin=True))
    elif tk == 'crossing':
        yc_ = tr.yc if tr else (y0 + y_nave_end) / 2
        top_h = crossing_spire(b, lk, srng, cfg, 0.0, yc_, hn + rn, Wn, H)
    elif tk == 'none':
        bellcote(b, lk, 0.0, y0, hn + rn, cfg)
    if cfg.porch and det <= 1:
        b.section('porch')
        porch(b, lk, srng, cfg, Wn / 2 if not aisles else Wt / 2, y0 + (y_nave_end - y0) * 0.3, hn if not aisles else ha, ws, wc)
    if cfg.steps and det <= 1:
        W_in = tw if tk == 'west' else Wn * 0.4
        U.front_steps(b, 0.0 if tk != 'twin' else 0.0, y_front, clamp(W_in * 0.7, 2.6, 6), 0.45, 3, lk)
    # --------------------------------------------------------------------------------------------------------- site
    b.section('site')
    kinds = ['conifer', 'broadleaf'] if (lk.tree in ('palm', 'broadleaf', 'acacia') and cfg.medieval) else None
    half_w = Wt / 2 + 8.0 + (cfg.cloister[0] + 2 if cfg.abbey else 0.0)
    U.site_common(b, lk, srng, brief, ft, max(half_w, 14.0), y_front, y2, Wt / 2 + (cfg.cloister[0] if cfg.abbey else 0.0), 0.0, medieval=cfg.medieval, tree_h=9.0 if cfg.medieval else 8.0,
                  front_margin=14.0, rear_margin=8.0, force_fence=cfg.medieval, rail=not cfg.medieval, headstone_n=14 if cfg.medieval else 0, trees=7 if L < 40 else 9, kinds=kinds)
    return b.objects()


# ------------------------------------------------------------------------------------------------------------------ towers
def west_tower(b, lk, srng, cfg, cx, cy, tw, td, th, ft, twin=False):
    det = b.detail
    sh = cfg.shape
    stained = STAIN[1] if cfg.stained else None
    segs = U.square_tower(b, cx, cy, tw, td, 0.0, th, lk, srng, belfry=True, courses=3, buttress_stages=2 if (cfg.buttress and not cfg.colonial) else (1 if cfg.colonial and 'buttresses' in ft else 0),
                          clock=cfg.clock, belfry_shape=sh if sh != 'rect' else 'rect', stained=stained, wall_slot=lk.wall_slot, wall_col=lk.wall_col)
    zt = th
    hw, hd = tw / 2, td / 2
    rect = (cx - hw, cy - hd, cx + hw, cy + hd)
    trim = lk.trim_col
    cap = 'broach' if cfg.spire else None
    if cap is None:
        if cfg.crenel:
            cap = 'crenel'
        elif cfg.romanesque or cfg.colonial:
            cap = 'pyramid'
        elif cfg.pinn:
            cap = 'crenel'
        else:
            cap = srng.choice(['pyramid', 'pyramid', 'hip', 'saddle', 'crenel'])
    if cap == 'broach':
        sp = clamp(th * 0.78, 5.0, 26.0)
        if cfg.tower_h:
            sp = clamp(cfg.tower_h - th, 4.0, 30.0)
        if det <= 1:
            lib.cylinder(b, cx, cy, zt - 0.01, zt + 0.0, 0.01, n=3, slot='plain', col=trim, top=False)
        # a small eaves cornice, then the broach spire
        if det == 0:
            U.sbox(b, lib.Seg((cx - hw - 0.15, cy - hd - 0.15), (cx + hw + 0.15, cy - hd - 0.15)), 0, tw + 0.3, zt - 0.1, zt + 0.35, 0.0, trim, 'plain-render', top=True)
        U.spire_broach(b, cx, cy, zt + (0.0), tw, td, sp, lk, slot=lk.roof_slot, col=lk.roof_col, lucarnes=True)
        if det <= 1:
            lib.cylinder(b, cx, cy, zt + sp, zt + sp + 1.2 + sp * 0.04, 0.05, n=4, slot='frame', col='#c9b677', r_top=0.02, top=True)
            if det == 0:
                U.cross_finial(b, cx, cy, zt + sp + 1.0, 1.6, '#c9b677')
        top = zt + sp + 1.8
        if cfg.pinn and det == 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    U.pinnacle(b, cx + sx * (hw - 0.3), cy + sy * (hd - 0.3), zt, 0.6, 2.2, lk)
    elif cap == 'crenel':
        lib.cap(b, [[(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])]], zt, True, 'roof-flat', lk.roof_col, scale=2.0)
        U.crenellate(b, rect, zt, lk, col=lib.shade(trim, 0.95))
        top = zt + 1.1
        if cfg.pinn or srng.random() < 0.5:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    U.pinnacle(b, cx + sx * (hw - 0.1), cy + sy * (hd - 0.1), zt + 0.3, 0.7, 2.8, lk)
            top = zt + 3.0
        if det <= 1:
            # stair turret on the back corner, rising above the parapet
            sx, sy = (hw - 0.55, hd - 0.55)
            lib.cylinder(b, cx + sx * (1 if cx >= 0 else -1), cy + sy, 0, zt + 2.2, 0.85, n=8 if det == 0 else 6, slot=lk.wall_slot, col=lk.wall_col, top=True, smooth=False)
            lib.cylinder(b, cx + sx * (1 if cx >= 0 else -1), cy + sy, zt + 2.2, zt + 3.4, 0.95, n=8 if det == 0 else 6, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
            top = max(top, zt + 3.4)
    elif cap == 'hip':
        U.pyramid(b, cx, cy, zt, tw, td, tw * 0.55, lk, ov=0.45)
        top = zt + tw * 0.55
    elif cap == 'saddle':
        U.gable_roof(b, rect, zt, tw * 0.5, 'x', ov=0.3, ove=0.3, look=lk, gables=(True, True))
        top = zt + tw * 0.5
    else:
        rise = tw * (1.15 if cfg.romanesque else 0.95)
        U.pyramid(b, cx, cy, zt, tw, td, rise, lk, ov=0.35)
        top = zt + rise
        if det == 0:
            U.cross_finial(b, cx, cy, top, 1.3, '#c9b677')
            top += 1.3
    return top


def crossing_spire(b, lk, srng, cfg, cx, cy, z, Wn, H):
    """Central flèche: octagonal lantern on the roof crossing carrying a slim needle spire."""
    det = b.detail
    r = clamp(Wn * 0.2, 1.6, 3.4)
    dh = clamp(H * 0.16, 2.4, 5.0)
    n = 8 if det <= 1 else 8
    lib.cylinder(b, cx, cy, z - 0.3, z + dh, r, n=n, slot='stone-blocks', col=lib.shade(lk.trim_col, 0.97), top=False, smooth=False)
    if det == 0:
        # louvred openings on the lantern
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 8
            cxo, cyo = cx + math.cos(a) * (r * 0.93), cy + math.sin(a) * (r * 0.93)
            seg = lib.Seg((cxo - math.sin(a) * r * 0.3, cyo + math.cos(a) * r * 0.3), (cxo + math.sin(a) * r * 0.3, cyo - math.cos(a) * r * 0.3))
            b.facing([seg.P(0, z + 0.7), seg.P(seg.length, z + 0.7), seg.P(seg.length, z + dh - 0.6), seg.P(0, z + dh - 0.6)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
    sp = clamp(H * 1.05, 8.0, 34.0)
    U.ngon_pyramid(b, cx, cy, z + dh, r * 1.1, sp, n, lk, rot=math.pi / 8, slot=lk.roof_slot, col=lk.roof_col, alt=0.06)
    if det <= 1:
        lib.cylinder(b, cx, cy, z + dh + sp, z + dh + sp + 2.0, 0.05, n=4, slot='frame', col='#c9b677', r_top=0.02, top=True)
    return z + dh + sp + 2.0


def bellcote(b, lk, cx, y, z, cfg):
    """A small bell gable at the apex of the west gable (churches without a tower)."""
    if b.detail >= 2:
        return
    trim = lk.trim_col
    w = 1.5
    seg = lib.Seg((cx - w / 2, y), (cx + w / 2, y))
    U.sbox(b, seg, 0, w, z - 0.2, z + 1.8, 0.45, lk.wall_col, lk.wall_slot, top=False)
    if b.detail == 0:
        b.face([seg.P(0.45, z + 0.4, -0.5), seg.P(1.05, z + 0.4, -0.5), seg.P(1.05, z + 1.4, -0.5), seg.P(0.45, z + 1.4, -0.5)], 'glass-punched', '#46494c')
    F = U.F
    F(b, [seg.P(-0.1, z + 1.8, -0.5), seg.P(w + 0.1, z + 1.8, -0.5), seg.P(w / 2, z + 2.7, -0.5)], lk.roof_slot, lk.roof_col)
    if b.detail == 0:
        U.cross_finial(b, cx, y - 0.25, z + 2.6, 1.0, trim)


def porch(b, lk, srng, cfg, x_wall, y, z_eave, ws, wc):
    """Gabled south porch against the right wall."""
    timber = (cfg.medieval or cfg.tudor) and srng.random() < 0.6
    pw, pd = 3.3, 3.0
    rise = 1.9
    zh = min(z_eave - 0.6, 3.4)
    slot = 'timber' if timber else ws
    col = '#6b5238' if timber else wc
    x1 = x_wall + pw
    # side walls (facing -Y and +Y) and the open gabled end (facing +X)
    for (p0, p1) in (((x_wall, y - pd / 2), (x1, y - pd / 2)), ((x1, y + pd / 2), (x_wall, y + pd / 2))):
        U.wall(b, p0, p1, 0.0, zh, lk, [], slot, col, plinth=0.0)
    seg = lib.Seg((x1, y - pd / 2), (x1, y + pd / 2))
    o = U.op(0.45, pd - 0.45, 0.0, zh - 0.15, 'pointed', 'dark', 1.0, 0.35, 0, 0.12, False)
    U.wall(b, (x1, y - pd / 2), (x1, y + pd / 2), 0.0, zh, lk, [o], slot, col, plinth=0.0)
    U.gable_tri(b, seg, zh, rise, look=lk, slot=slot, col=col)
    U.gable_roof(b, (x_wall, y - pd / 2, x1, y + pd / 2), zh, rise, 'x', ov=0.1, ove=0.28, look=lk, slot=lk.roof_slot, col=lk.roof_col, gables=(False, False))


# ---------------------------------------------------------------------------------------------------------- folded (postmodern)
def build_folded(b, lk, srng, cfg, brief, ft, det):
    """Postmodern neo-gothic hall: cross plan of four tall gables with big pointed glazing and a steep central pyramid + spire."""
    L = cfg.L
    S = min(cfg.span, L)
    H = cfg.H
    arm_w = clamp(S * 0.3, 14.0, 26.0)
    rise = min(arm_w / 2 * math.tan(math.radians(60)), H * 0.5)
    hn = H - rise
    hw = arm_w / 2
    gl = '#9fb4c4' if not cfg.stained else STAIN[0]
    reach_f = L / 2
    reach_r = L / 2 * 0.92
    reach_x = S / 2
    b.section('arms')
    for axis, sgn, reach in (('y', -1, reach_f), ('y', 1, reach_r), ('x', -1, reach_x), ('x', 1, reach_x)):
        _fold_arm(b, lk, axis, sgn, arm_w, hn, rise, reach, gl, det, door=(axis == 'y' and sgn < 0))
    b.section('crown')
    cz = hn + rise
    ph = H * 0.26
    U.pyramid(b, 0.0, 0.0, cz - 0.01, arm_w * 0.8, arm_w * 0.8, ph, lk, slot=lk.roof_slot, col=lib.shade(lk.roof_col, 1.04))
    sp = clamp(H * 1.0, 10.0, 40.0)
    base = cz + ph * 0.7
    r = clamp(arm_w * 0.075, 1.0, 2.2)
    lib.cylinder(b, 0, 0, base - 0.3, base + 3.0, r, n=8, slot='stone-blocks', col=lk.trim_col, top=False, smooth=False)
    U.ngon_pyramid(b, 0, 0, base + 3.0, r * 1.15, sp, 8, lk, rot=math.pi / 8, slot=lk.roof_slot, col=lk.roof_col, alt=0.06)
    if det <= 1:
        lib.cylinder(b, 0, 0, base + 3.0 + sp, base + 3.0 + sp + 2.4, 0.06, n=4, slot='frame', col='#c9b677', r_top=0.02, top=True)
    b.section('site')
    ext = max(reach_x, hw) + 12
    lib.ground(b, -min(ext, 60), -L / 2 - 14, min(ext, 60), min(L / 2 + 10, 55), lk, z=0.0)
    if det <= 1:
        for k in range(3):
            lib.tree(b, lk.tree, -20 + 20 * k, -L / 2 - 8, 8.0, srng, lk)
    if 'steps' in ft:
        U.front_steps(b, 0.0, -reach_f, arm_w * 0.4, 0.6, 4, lk)
    if 'flags' in ft and det == 0:
        for k, c in enumerate(['#1b7a3d', '#f0f0f0', '#1b7a3d']):
            U.flagpole(b, -6 + 6 * k, -L / 2 - 8.0, 9.0, c)
    return b.objects()


def _fold_arm(b, lk, axis, sgn, w, hn, rise, reach, gl, det, door=False):
    """One arm of the folded cross: side walls with tall pointed windows, a big pointed glazed gable end and a steep roof."""
    ws, wc = lk.wall_slot, lk.wall_col
    trim = lk.trim_col
    hw = w / 2
    dx, dy = (0, sgn) if axis == 'y' else (sgn, 0)
    px, py = -dy, dx

    def pt(a, c):
        return (dx * a + px * c, dy * a + py * c)

    for side in (-1, 1):
        p0, p1 = pt(hw, side * hw), pt(reach, side * hw)
        if side > 0:
            p0, p1 = p1, p0
        # the wall must be walked so that the outside is on the right: swap when needed
        L = reach - hw
        seg = lib.Seg(p0, p1)
        side_out = (seg.n[0] * px + seg.n[1] * py) * side
        if side_out < 0:
            p0, p1 = p1, p0
        n = max(2, int(L / 4.8))
        ops = U.bay_ops(L, n, 0.0, None, 1.15, 2.6, hn - 0.8, 'pointed', 'glass', 1.5, 0.3, 0, 0.0, False)
        U.wall(b, p0, p1, 0.0, hn, lk, ops if p0 == (pt(hw, side * hw)) or True else ops, ws, wc, trim, plinth=0.5)
    e0, e1 = pt(reach, hw), pt(reach, -hw)
    seg = lib.Seg(e0, e1)
    if seg.n[0] * dx + seg.n[1] * dy < 0:
        e0, e1 = e1, e0
    ops = []
    if door:
        dw = clamp(w * 0.2, 2.2, 3.6)
        ops.append(U.op(w / 2 - dw / 2, w / 2 + dw / 2, 0.0, dw * 1.9, 'pointed', 'door', 1.0, 0.5, 0, 0.25, False))
    seg = U.wall(b, e0, e1, 0.0, hn, lk, ops, ws, wc, trim, plinth=0.5)
    U.gable_tri(b, seg, hn, rise, look=lk, slot=ws, col=wc)
    ww = w * 0.7
    o = U.op(w / 2 - ww / 2, w / 2 + ww / 2, (ops[0]['top'] + 1.0) if ops else hn * 0.18, hn + rise * 0.82, 'pointed', gl, 1.9, 0.2, 3, 0.4, False, tracery=False)
    U.applique_window(b, seg, o, lk, trim)
    if det == 0:
        U.cross_finial(b, seg.P(w / 2, hn + rise)[0], seg.P(w / 2, hn + rise)[1], hn + rise, 1.6, trim)
    if axis == 'y':
        rect = (-hw, min(-hw, sgn * reach), hw, max(hw, sgn * reach)) if False else (-hw, (-reach if sgn < 0 else -hw), hw, (reach if sgn > 0 else hw))
    else:
        rect = ((-reach if sgn < 0 else -hw), -hw, (reach if sgn > 0 else hw), hw)
    U.gable_roof(b, rect, hn, rise, axis, ov=0.4, ove=0.35, look=lk, gables=(False, False))


