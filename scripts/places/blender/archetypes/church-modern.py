"""church-modern: modern and brutalist churches, Pentecostal auditoriums and mega-church halls, A-frame chapels, tent-roofed and shell
cathedrals, and the many plain gabled parish churches with a bell tower. Everything is derived from the brief and the seeded rng.

Layout (metres): the entrance front faces the camera (-Y). Parish churches run along +Y (nave behind the front); auditoriums are
wide along x with the foyer and canopy in front and the car park beyond.
Typologies chosen from the brief:
  parish      gabled nave (optional transept, chancel), front gable treatments (cross window, glazed gable, arch, portico, canopy),
              a bell tower: slab campanile beside the church, attached tower, or entrance tower, with hip / flat / open belfry tops
  auditorium  wide low hall under a low-pitched gable, shed or flat roof (or a fan-shaped plan), tall glazed foyer, deep entrance
              canopy on columns, twin pylons or a tower with a cross, signage board, flags and a big car park
  aframe      steep A-frame chapel with a fully glazed front gable, low side annex and entrance canopy
  brutalist   exposed-concrete blocks: ribbed walls with slit windows, a glazed cross in the front wall, stepped roof, slab bell tower
  tent        wedge / triangular body under a sweeping membrane roof with a tall cross tower and stay cables (Abidjan)
  shell       rectangular hall under a barrel, wave or sail roof with a glazed front
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _church_gothic_util as U  # noqa: E402
from _church_gothic_util import NS, clamp  # noqa: E402

FEATURES = {'bell-tower', 'spire', 'steps', 'stained-glass', 'arches', 'fence-wall', 'gate', 'portico', 'colonnade', 'pediment', 'statue', 'signage-board', 'car-park',
            'floodlights', 'flat-canopy', 'curved-canopy', 'flags', 'atrium-glass', 'louvres', 'mosaic', 'relief-pattern', 'mast', 'fountain'}

STAIN = ['#5a74c8', '#a8485a', '#d4a63a', '#4f9a6a', '#7a56a8']
AUD_WORDS = ('auditorium', 'pentecostal', 'mega', 'charismatic', 'winners', 'tabernacle', 'revival', 'worship centre', 'christian centre', 'faith')
PARISH_WORDS = ('catholic', 'anglican', 'methodist', 'baptist', 'cathedral', 'parish', 'chapel', 'ecwa', 'st ', "st.", 'basilique', 'basilica')


def infer(brief, style, rng):
    form = brief.get('form') or {}
    fac = brief.get('facade') or {}
    txt = U.text(brief)
    ft = U.feats(brief)
    sty = str(brief.get('style') or '')
    w = float(form.get('width_m') or 30)
    d = float(form.get('depth_m') or 16)
    H = clamp(float(form.get('height_m') or 12), 4.5, 50.0)
    roof = form.get('roof') or 'gable'
    fp = form.get('footprint') or 'rect'
    cfg = NS()
    cfg.w, cfg.d, cfg.H, cfg.roof, cfg.fp, cfg.sty = w, d, H, roof, fp, sty
    subj = str(brief.get('subject') or '').lower()
    name = str(brief.get('name') or '').lower()
    cfg.big = max(w, d) >= 44
    aud = 0
    aud += 2 * ('flat-canopy' in ft) + ('car-park' in ft) + ('atrium-glass' in ft) + ('signage-board' in ft) + ('flags' in ft)
    aud += 3 * any(k in subj or k in name for k in AUD_WORDS)
    aud += 1 if roof in ('flat', 'shed') else 0
    par = 2 * ('bell-tower' in ft) + ('stained-glass' in ft) + 2 * any(k in name for k in PARISH_WORDS) + ('steps' in ft) + ('arches' in ft)
    par += 2 if ('catholic' in txt or 'cathedral' in txt or 'anglican' in txt) else 0
    cfg.type = 'parish'
    if 'a-frame' in txt or 'aframe' in txt or 'a frame' in txt:
        cfg.type = 'aframe'
    elif roof in ('tensile', 'curved', 'wave') or 'tent' in txt or 'triangular' in txt or 'fabric' in txt:
        cfg.type = 'tent' if (roof == 'tensile' or 'triangular' in txt or 'wedge' in txt) and H >= 24 else 'shell'
    elif roof == 'barrel' or 'vaulted' in txt:
        cfg.type = 'shell'
    elif sty == 'brutalist' or ('exposed-concrete' == fac.get('material') and sty in ('brutalist',)) or 'brutalist' in txt:
        cfg.type = 'brutalist'
    elif (aud >= 3 and aud > par) or (w >= 60 and par < 3) or 'auditorium' in subj:
        cfg.type = 'auditorium'
    elif max(w, d) <= 26 and sty in ('modernist', 'contemporary') and 'chapel' in txt and rng.random() < 0.3:
        cfg.type = 'aframe'
    cfg.fan = ('fan' in txt and cfg.type == 'auditorium') or (fp == 'irregular' and cfg.type == 'auditorium' and 'fan' in txt)
    cfg.stained = 'stained-glass' in ft
    cfg.cross = fp == 'cross' or 'cruciform' in txt or 'transept' in txt
    cnt = int((ft.get('bell-tower') or {}).get('count') or 0)
    cfg.tower = 'bell-tower' in ft or 'tower' in subj or 'spire' in ft
    cfg.tower_h = U.number_near(txt, ['tower', 'spire', 'cross', 'steeple', 'belfry'], 14, 120)
    cfg.steep = 'steep' in txt
    cfg.wide = 'wide' in txt
    cfg.color_roof_green = 'green' in txt
    return cfg


def build(brief, style, rng, detail):
    b = lib.Builder('church', detail)
    srng = random.Random(rng.getrandbits(64))
    lk = lib.look(brief, style, rng)
    U.set_roof(lk, brief)
    cfg = infer(brief, style, random.Random(rng.getrandbits(64)))
    ft = U.feats(brief)
    fn = {'parish': build_parish, 'auditorium': build_auditorium, 'aframe': build_aframe, 'brutalist': build_brutalist, 'tent': build_tent, 'shell': build_shell}[cfg.type]
    fn(b, lk, srng, cfg, brief, ft)
    return b.objects()


# ------------------------------------------------------------------------------------------------------------------ helpers
def cable(b, p0, p1, w=0.14, col='#aeb4ba'):
    """A thin stay cable: two crossed quads."""
    if b.detail >= 2:
        return
    dx, dy, dz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
    # one quad in the vertical plane through the cable, one perpendicular-ish horizontally
    h = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / h * w, dx / h * w
    q = [(p0[0] - nx, p0[1] - ny, p0[2]), (p0[0] + nx, p0[1] + ny, p0[2]), (p1[0] + nx, p1[1] + ny, p1[2]), (p1[0] - nx, p1[1] - ny, p1[2])]
    b.face(q, 'frame', col)
    b.face(q[::-1], 'frame', col)
    q2 = [(p0[0], p0[1], p0[2] - w), (p0[0], p0[1], p0[2] + w), (p1[0], p1[1], p1[2] + w), (p1[0], p1[1], p1[2] - w)]
    b.face(q2, 'frame', col)
    b.face(q2[::-1], 'frame', col)


def cross_glass(b, seg, cu, z0, h, w, col, d=-0.05, frame=None):
    """A cross-shaped glazed opening applied to a wall: vertical bar and cross bar, with a frame outline at LOD0."""
    if b.detail >= 2:
        return
    bw = w
    arm = h * 0.36
    zc = z0 + h * 0.66
    verts = [seg.P(cu - bw / 2, z0, d), seg.P(cu + bw / 2, z0, d), seg.P(cu + bw / 2, zc - bw / 2, d), seg.P(cu + arm, zc - bw / 2, d), seg.P(cu + arm, zc + bw / 2, d),
             seg.P(cu + bw / 2, zc + bw / 2, d), seg.P(cu + bw / 2, z0 + h, d), seg.P(cu - bw / 2, z0 + h, d), seg.P(cu - bw / 2, zc + bw / 2, d), seg.P(cu - arm, zc + bw / 2, d),
             seg.P(cu - arm, zc - bw / 2, d), seg.P(cu - bw / 2, zc - bw / 2, d)]
    if frame and b.detail == 0:
        f = 0.18
        fv = [seg.P(cu - bw / 2 - f, z0 - f, d + 0.03), seg.P(cu + bw / 2 + f, z0 - f, d + 0.03), seg.P(cu + bw / 2 + f, zc - bw / 2 - f, d + 0.03), seg.P(cu + arm + f, zc - bw / 2 - f, d + 0.03),
              seg.P(cu + arm + f, zc + bw / 2 + f, d + 0.03), seg.P(cu + bw / 2 + f, zc + bw / 2 + f, d + 0.03), seg.P(cu + bw / 2 + f, z0 + h + f, d + 0.03), seg.P(cu - bw / 2 - f, z0 + h + f, d + 0.03),
              seg.P(cu - bw / 2 - f, zc + bw / 2 + f, d + 0.03), seg.P(cu - arm - f, zc + bw / 2 + f, d + 0.03), seg.P(cu - arm - f, zc - bw / 2 - f, d + 0.03), seg.P(cu - bw / 2 - f, zc - bw / 2 - f, d + 0.03)]
        b.face(fv, 'plain-render', frame)
    b.face(verts, 'glass-punched', col)


def roof_cross(b, x, y, z, h, col):
    """A simple Latin cross standing on a roof or gable."""
    U.cross_finial(b, x, y, z, h, col)


def modern_tower(b, lk, srng, cfg, cx, cy, tw, td, th, kind, ft, wall_slot=None, wall_col=None, trim=None):
    """Bell tower of a modern church. kind: slab (tall narrow concrete/brick shaft, big belfry opening, flat cap and cross) |
    hip (square tower with a hipped cap) | open (shaft, then four posts under a slab roof round the bell) | spire (square tower, thin steel spire)."""
    det = b.detail
    ws, wc = wall_slot or lk.wall_slot, wall_col or lk.wall_col
    trim = trim or lk.trim_col
    if kind == 'open':
        sh = th - 3.2
        U.square_tower(b, cx, cy, tw, td, 0.0, sh, lk, srng, belfry=False, courses=0, door=False, west_window=False, wall_slot=ws, wall_col=wc, trim=trim)
        zb = sh
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.box_c(b, cx + sx * (tw / 2 - 0.2), cy + sy * (td / 2 - 0.2), zb, 0.4, 0.4, 3.2, ws, wc, skip=('bottom',))
        if det <= 1:
            lib.box_c(b, cx, cy, zb + 0.9, 0.5, 0.5, 1.2, 'frame', '#2d2f31', skip=('bottom',))
        lib.box_c(b, cx, cy, zb + 3.2, tw + 0.6, td + 0.6, 0.4, 'roof-flat', lib.shade(wc, 0.85), skip=())
        top = zb + 3.6
        if det <= 1:
            roof_cross(b, cx, cy, top, 2.6, '#e8e4d8')
            top += 2.6
        return top
    shape = 'rect' if kind == 'slab' else 'round'
    U.square_tower(b, cx, cy, tw, td, 0.0, th, lk, srng, belfry=True, courses=1 if kind != 'slab' else 0, door=(kind != 'slab'), west_window=False, belfry_shape=shape,
                   wall_slot=ws, wall_col=wc, trim=trim, door_w=min(2.2, tw * 0.5))
    top = th
    if kind == 'hip':
        U.pyramid(b, cx, cy, th, tw, td, tw * 0.7, lk, ov=0.4)
        top = th + tw * 0.7
        if det == 0:
            roof_cross(b, cx, cy, top, 1.8, '#e8e4d8')
            top += 1.8
    elif kind == 'spire':
        lib.cylinder(b, cx, cy, th, th + tw * 1.9 + 4.0, tw * 0.32, n=4, slot='metal-roof', col=lk.roof_col, r_top=0.0, top=False, smooth=False)
        top = th + tw * 1.9 + 4.0
    else:
        lib.box_c(b, cx, cy, th, tw + 0.5, td + 0.5, 0.45, 'roof-flat', lib.shade(wc, 0.82), skip=())
        top = th + 0.45
        roof_cross(b, cx, cy, top, clamp(tw * 1.3, 2.4, 4.0), '#e8e4d8')
        top += clamp(tw * 1.3, 2.4, 4.0)
    return top


def entrance_canopy(b, lk, x0, x1, y_wall, z, depth, srng, columns=True, col=None, curved=False):
    """A flat (or curved vault) concrete canopy on round columns over the entrance."""
    if curved and b.detail < 2:
        cols = [(x0 + 1.0 + (x1 - x0 - 2) * k / 4, y_wall - depth + 0.9) for k in range(5)]
        lib.canopy_curved(b, x0, y_wall - depth, x1, y_wall, z, 1.8, lk, th=0.35, axis='x', columns=cols, col=col or lk.roof_col)
        return
    n = max(2, int((x1 - x0) / 6.5)) if columns else None
    if b.detail >= 2:
        lib.box_c(b, (x0 + x1) / 2, y_wall - depth / 2, z - 0.5, x1 - x0, depth, 0.5, 'plain', lk.trim_col, skip=())
        return
    lib.canopy_flat(b, x0, y_wall - depth, x1, y_wall, z, lk, th=0.5, columns=n, col=col or lk.roof_col, edge_col=lib.shade(lk.trim_col, 0.95), r=0.24)


def site_modern(b, lk, srng, cfg, brief, ft, half_w, y_front, y_rear, body_half, lot=False, door_x=0.0, front_margin=14.0, trees=6, tree_h=8.0):
    det = b.detail
    setting = brief.get('setting') or {}
    forecourt = setting.get('forecourt') or ('parking' if lot else 'garden')
    if lot and forecourt in ('none', 'garden'):
        forecourt = 'parking'
    if 'car-park' in ft:
        forecourt = 'parking'
    brief2 = dict(brief, setting=dict(setting, forecourt=forecourt))
    return U.site_common(b, lk, srng, brief2, ft, half_w, y_front, y_rear, body_half, door_x, tree_h=tree_h, front_margin=front_margin, rear_margin=8.0,
                         rail=True, trees=trees, forecourt_default=forecourt, stone_fence=False)


def finish_site_extras(b, lk, srng, ft, brief, x_sign, y_front, cx_sign=None, flag_n=3):
    """Signage, floodlights, flags, statue and fountain are placed by U.site_common."""
    return None


# ------------------------------------------------------------------------------------------------------------------- parish
def build_parish(b, lk, srng, cfg, brief, ft):
    det = b.detail
    txt = U.text(brief)
    sty = cfg.sty
    w, d, H = cfg.w, cfg.d, cfg.H
    L = max(w, d)
    Wt = min(w, d)
    if cfg.cross:
        span = Wt
        Wt = clamp(span * (0.5 if span > 0.5 * L else 0.62), 8.0, 24.0)
        span = max(span, Wt * 1.6)
    else:
        span = Wt
    Wt = clamp(Wt, 6.5, 0.75 * L)
    if L / Wt > 4.2:
        Wt = L / 4.2
    colonial = sty in ('colonial', 'georgian', 'victorian') or 'colonial' in txt
    vern = sty in ('vernacular',)
    modernist = sty in ('modernist', 'brutalist', 'international')
    contemporary = sty in ('contemporary', 'postmodern', 'high-tech')
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    pitch = math.radians(srng.uniform(28, 36) if not cfg.steep else srng.uniform(48, 56))
    if modernist:
        pitch = math.radians(srng.uniform(22, 40))
    aisles = Wt >= 15.0 and L >= 26 and srng.random() < 0.55
    Wn = Wt * 0.58 if aisles else Wt
    rn = (Wn / 2) * math.tan(pitch)
    rn = min(rn, H * 0.5)
    hn = H - rn
    if hn < 3.4:
        hn = 3.4
        rn = max(1.2, H - hn)
    ha = za_top = None
    if aisles:
        ha = clamp(hn * 0.52, 3.0, hn - 2.6)
        za_top = clamp(ha + (Wt - Wn) / 2 * math.tan(math.radians(20)), ha + 0.6, hn - 1.4)
    y_front = -L / 2
    y2 = L / 2
    # tower placement
    tk = None
    if cfg.tower:
        tk = srng.choice(['slab', 'hip', 'open']) if not (colonial or vern) else srng.choice(['hip', 'hip', 'slab'])
        if 'spire' in ft:
            tk = 'spire'
    place = srng.choice(['free', 'front', 'center']) if cfg.tower else None
    if place == 'center' and Wt < 10:
        place = 'front'
    if cfg.tower and ('side' in txt):
        place = 'free'
    tw = clamp(Wt * (0.24 if place != 'center' else 0.4), 2.6, 6.0)
    th = (cfg.tower_h if cfg.tower_h else clamp(H * srng.uniform(1.5, 2.1), 11.0, 40.0))
    th = max(th, hn + rn + 3.0)
    if place == 'center':
        td = tw
        y0 = y_front + 0.01
    else:
        td = tw
        y0 = y_front
    # chancel
    chancel = not (Wt < 12 and not cfg.cross) or srng.random() < 0.3
    Lc = clamp(L * 0.16, 3.0, 12.0) if chancel else 0.0
    Wc = clamp(Wn * 0.66, 4.0, Wn)
    hc = hn - 1.2
    rc = min((Wc / 2) * math.tan(max(pitch, math.radians(26))), rn)
    y_nave_end = y2 - Lc
    tr = None
    if cfg.cross:
        depth = Wn
        yc = y0 + 0.55 * (y2 - y0)
        yc = min(yc, y2 - (Wc / 2 + 2.5) - depth / 2) if chancel else min(yc, y2 - depth / 2 - 1.0)
        yc = max(yc, y0 + 5.0 + depth / 2)
        tr = NS(yc=yc, depth=depth, span=max(span, Wt + 4.0), h=hn, rise=rn, door=False)
        y_nave_end = yc + depth / 2
        if not chancel:
            y2 = y_nave_end
    # windows
    if 'arches' in ft or colonial:
        shape, sur = 'round', 0.16 if colonial or 'arches' in ft else 0.0
    elif modernist:
        shape, sur = 'rect', 0.0
    else:
        shape, sur = 'rect', 0.1
    slit = modernist and srng.random() < 0.6
    bay = 4.4 if L > 30 else 3.8
    wf = 0.2 if slit else 0.34
    nave_spec = U.win_spec(bay=bay, wf=wf, wmin=0.5 if slit else 0.9, wmax=0.7 if slit else 1.6, sill_f=0.18 if not slit else 0.1, head_f=0.93 if not slit else 0.96, shape=shape, surround=sur, depth=0.25)
    chancel_spec = U.win_spec(bay=bay, wf=wf, wmin=0.5 if slit else 0.8, wmax=0.7 if slit else 1.3, sill_f=0.2, head_f=0.93, shape=shape, surround=sur)
    gcyc = STAIN if cfg.stained else None
    buttress_p = 0
    P = NS(Wt=Wt, Wn=Wn, y0=y0, y_nave_end=y_nave_end, hn=hn, rn=rn, ha=ha, za_top=za_top, Wc=Wc if chancel else None, hc=hc if chancel else None, rc=rc, y2=(y2 if chancel else None),
           apse=0, transept=tr, win_nave=nave_spec, win_aisle=nave_spec, win_clere=U.win_spec(bay=bay, wf=0.3, wmin=0.7, wmax=1.2, sill_f=0.05, head_f=0.95, shape=shape, surround=0.0), win_chancel=chancel_spec, glass_cycle=gcyc, buttress=0, flying=False,
           plinth=0.5, trim=trim, front='none', cornice=0.0 if modernist else 0.22, rose=False, win_shape=shape, door_shape='round' if shape == 'round' else 'rect',
           ov=0.9 if colonial else 0.6, ove=0.45, pilaster=0.0)
    if modernist and det == 0 and not slit:
        P.pilaster = 0.6
    P.roof_slot = lk.roof_slot
    P.roof_col = lk.roof_col
    if cfg.color_roof_green:
        P.roof_col = '#2e7d5b'
    info = U.complex_(b, lk, srng, P)
    # front gable
    b.section('facade')
    front_gable_modern(b, lk, srng, cfg, P, ft, y0, hn, rn, Wn, modernist, colonial, contemporary, shape, gcyc)
    if aisles:
        U.aisle_fronts(b, lk, P)
    # tower
    b.section('tower')
    if cfg.tower:
        if place == 'free':
            sgn = srng.choice([-1, 1])
            cx_t = sgn * (Wt / 2 + tw / 2 + srng.uniform(2.5, 5.0))
            modern_tower(b, lk, srng, cfg, cx_t, y_front + td / 2 + 2.0, tw, td, th, tk, ft)
        elif place == 'front':
            sgn = srng.choice([-1, 1])
            cx_t = sgn * (Wt / 2 - tw / 2 + 0.01)
            modern_tower(b, lk, srng, cfg, cx_t, y_front - td / 2 + 0.3, tw, td, th, tk, ft)
        else:
            modern_tower(b, lk, srng, cfg, 0.0, y_front - td / 2 + 0.3, tw, td, th, tk, ft)
    elif det == 0:
        roof_cross(b, 0.0, y0, hn + rn, 2.2, '#e8e4d8')
    if 'steps' in ft and det <= 1:
        sw = clamp(Wn * 0.5, 3.0, 9.0)
        U.front_steps(b, 0.0, y_front, sw, 0.6, 4, lk)
    b.section('site')
    xs = (Wt / 2 + (tw + 6 if place == 'free' else 0.0))
    ext = max(Wt / 2, (tr.span / 2 if tr else 0), xs) + 8.0
    lot = 'car-park' in ft
    site_modern(b, lk, srng, cfg, brief, ft, ext, y_front - (1.0 if place == 'front' else 0.0), y2, max(Wt / 2, tr.span / 2 if tr else 0), lot=lot, front_margin=18.0 if lot else 14.0, trees=6 if L < 40 else 8)
    finish_site_extras(b, lk, srng, ft, brief, Wt / 2 + 6, y_front)


def front_gable_modern(b, lk, srng, cfg, P, ft, y0, hn, rn, Wn, modernist, colonial, contemporary, shape, gcyc):
    det = b.detail
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    variants = ['cross', 'glazed', 'arch', 'plain']
    if modernist:
        variants = ['cross', 'glazed', 'slit']
    elif colonial:
        variants = ['arch', 'plain', 'plain']
    elif contemporary:
        variants = ['glazed', 'cross', 'glazed']
    kind = srng.choice(variants)
    if 'portico' in ft or 'colonnade' in ft:
        kind = 'plain' if kind == 'glazed' else kind
    seg = lib.Seg((-Wn / 2, y0), (Wn / 2, y0))
    dw = clamp(Wn * 0.2, 1.5, 2.8)
    dh = clamp(dw * 1.9, 3.0, 4.6)
    door_shape = 'round' if kind in ('arch',) or shape == 'round' else 'rect'
    ops = [U.op(Wn / 2 - dw / 2, Wn / 2 + dw / 2, 0.0, dh, door_shape, 'door', 1.0, 0.4, 0, 0.2 if colonial else 0.0, False)]
    glass = STAIN[1] if cfg.stained else None
    if kind == 'arch':
        aw = Wn * 0.46
        ops[0] = U.op(Wn / 2 - aw / 2, Wn / 2 + aw / 2, 0.0, hn * 0.78, 'round', 'door', 1.0, 0.5, 0, 0.3, False)
    elif kind == 'plain' and Wn > 9:
        for sgn in (-1, 1):
            c = Wn / 2 + sgn * Wn * 0.3
            ww = clamp(Wn * 0.1, 0.9, 1.5)
            ops.append(U.op(c - ww / 2, c + ww / 2, 1.6, hn - 1.2, shape, glass or 'glass', 1.0, 0.25, 0, 0.12 if shape == 'round' else 0.0, True))
    seg = U.wall(b, (-Wn / 2, y0), (Wn / 2, y0), 0.0, hn, lk, ops, ws, wc, trim, plinth=0.5)
    U.gable_tri(b, seg, hn, rn, look=lk, slot=ws, col=wc)
    # gable treatments (applique)
    if kind == 'cross':
        ch = clamp(hn + rn * 0.9 - dh - 1.2, 3.0, 10.0)
        cross_glass(b, seg, Wn / 2, dh + 0.9, ch, clamp(Wn * 0.07, 0.5, 0.9), glass or '#7fa0c8', frame=lib.shade(trim, 0.9))
    elif kind == 'glazed':
        gw = Wn * 0.78
        top_z = hn + rn * 0.78
        frac = (gw / Wn)
        pts = [seg.P(Wn / 2 - gw / 2, dh + 0.9, -0.05), seg.P(Wn / 2 + gw / 2, dh + 0.9, -0.05), seg.P(Wn / 2 + gw / 2, hn + (1 - frac) * 0 + rn * (1 - frac) * 0.95 + 0.0, -0.05), seg.P(Wn / 2, top_z, -0.05),
               seg.P(Wn / 2 - gw / 2, hn + rn * (1 - frac) * 0.95, -0.05)]
        if det < 2:
            b.face(pts, 'glass-curtain', glass or lk.glass_col, mode='tile', scale=3.0)
            if det == 0:
                for k in range(1, 5):
                    u = Wn / 2 - gw / 2 + gw * k / 5
                    top = min(top_z, hn + rn * (1 - abs(u - Wn / 2) / (Wn / 2)) * 0.95)
                    b.face([seg.P(u - 0.05, dh + 0.9, -0.1), seg.P(u + 0.05, dh + 0.9, -0.1), seg.P(u + 0.05, top, -0.1), seg.P(u - 0.05, top, -0.1)], 'frame', lib.shade(trim, 0.7))
    elif kind == 'slit':
        for k in (-1, 0, 1):
            c = Wn / 2 + k * Wn * 0.22
            if det < 2:
                b.face([seg.P(c - 0.28, dh + 1.0, -0.05), seg.P(c + 0.28, dh + 1.0, -0.05), seg.P(c + 0.28, hn + rn * 0.7 - abs(k) * rn * 0.4, -0.05), seg.P(c - 0.28, hn + rn * 0.7 - abs(k) * rn * 0.4, -0.05)], 'glass-punched', glass or '#7fa0c8')
    elif kind == 'arch' and det == 0:
        U.disc(b, seg, Wn / 2, hn + rn * 0.42, clamp(rn * 0.22, 0.5, 1.2), '#46494c', 'glass-punched', 10, -0.06)
    if det == 0:
        if 'relief-pattern' in ft:
            U.wall_pattern(b, seg, dh + 0.6, dh + 2.2, lib.shade(trim, 0.9), 'relief')
        if 'mosaic' in ft:
            U.wall_pattern(b, seg, 0.6, 1.0, None, 'mosaic')
        if 'portico' not in ft and cfg.tower is False:
            pass
        roof_cross(b, 0.0, y0, hn + rn + 0.1, 2.4, '#e8e4d8')
    if 'portico' in ft or 'colonnade' in ft:
        wp = clamp(Wn * 0.6, 4.0, 11.0)
        hp = min(dh + 1.4, hn - 0.8)
        if det >= 2:
            lib.box_c(b, 0, y0 - 1.5, 0, wp, 3.0, hp + 0.6, 'plain', trim, skip=('bottom',))
        else:
            lib.portico(b, 0.0, y0, 0.0, wp, 3.0, hp, lk, cols=4, pediment=bool(colonial or 'pediment' in ft), steps_n=2)
    elif kind in ('plain', 'cross') and srng.random() < 0.4 and Wn > 7:
        pw = clamp(dw * 2.2 + 1.2, 4.0, Wn * 0.6)
        U.front_porch(b, lk, 0.0, y0, pw, 3.4, min(hn - 0.6, dh + 0.9), 1.6 + pw * 0.12, ws, wc, trim, shape=door_shape if door_shape != 'rect' else 'rect')
    elif 'flat-canopy' in ft or ('steps' not in ft and modernist and srng.random() < 0.5):
        entrance_canopy(b, lk, -clamp(Wn * 0.28, 2.5, 6), clamp(Wn * 0.28, 2.5, 6), y0, dh + 0.9, 4.0 if Wn > 10 else 2.6, srng)


# ---------------------------------------------------------------------------------------------------------------- auditorium
def build_auditorium(b, lk, srng, cfg, brief, ft):
    det = b.detail
    txt = U.text(brief)
    W = clamp(cfg.w, 28.0, 104.0)
    D = clamp(cfg.d, 20.0, 66.0)
    H = clamp(cfg.H, 7.0, 30.0)
    if cfg.w > 104:
        D = clamp(cfg.d * 0.7, 24, 58)   # a huge place is shown by its frontage portion
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    acc = lk.accent_col
    wings = W >= 80
    fd = clamp(D * 0.2, 6.0, 12.0)
    fh = clamp(H * 0.52, 4.2, 8.0)
    hall_w = W * (srng.uniform(0.58, 0.72) if wings else srng.uniform(0.7, 0.92))
    fw_ratio = srng.uniform(0.8, 1.0)
    annex_side = srng.choice([-1, 1]) if (srng.random() < 0.55 and not cfg.fan) else 0
    if annex_side:
        W = min(W, 96.0)
        hall_w = min(hall_w, W * 0.78)
    hall_d = D - fd
    y_front = -D / 2
    yh0 = y_front + fd
    yh1 = D / 2
    roof = cfg.roof
    fan = cfg.fan
    b.section('hall')
    gl = lk.glass_col
    # --- hall block
    if fan:
        wb = hall_w * 0.62
        poly = [(-hall_w / 2, yh0), (hall_w / 2, yh0), (wb / 2, yh1), (-wb / 2, yh1)]
        fpoly = lib.fp_polygon(poly)
        for e in fpoly.edges():
            ops = []
            if e.length > 8 and b.detail <= 1 and not e.front:
                n = max(2, int(e.length / 7))
                ops = U.bay_ops(e.length, n, 0, None, 3.0, H * 0.6, H - 1.0, 'rect', 'glass', 1.0, 0.2, 0, 0.0, False)
            U.wall(b, e.p0, e.p1, 0.0, H, lk, ops if not e.rear else [], ws, wc, trim, plinth=0.5)
        lib.roof(b, 'flat', fpoly, H, lk, parapet_h=0.9, ov=0.0, slab=0.0)
        hall_roof_top = H + 0.9
    else:
        x0h, x1h = -hall_w / 2, hall_w / 2
        # side walls (louvres / punched strip) and rear
        for (p0, p1, kind) in (((x1h, yh0), (x1h, yh1), 'side'), ((x1h, yh1), (x0h, yh1), 'rear'), ((x0h, yh1), (x0h, yh0), 'side')):
            L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            ops = []
            if kind == 'side' and det <= 1:
                n = max(2, int(L / 6.5))
                ops = U.bay_ops(L, n, 0.0, None, 2.8, H * 0.55, H - 1.1, 'rect', 'glass', 1.0, 0.2, 1, 0.0, False)
            seg = U.wall(b, p0, p1, 0.0, H, lk, ops, ws, wc, trim, plinth=0.5)
            if det == 0 and 'louvres' in ft and kind == 'side':
                nb = max(2, int(L / 6.5))
                for k in range(nb):
                    ub = L / nb * (k + 0.5)
                    for j in range(7):
                        zz = H * 0.28 + j * 0.28
                        U.sbox(b, seg, ub - 1.5, ub + 1.5, zz, zz + 0.1, 0.22, lib.shade(trim, 0.8), 'frame', top=True)
        # front wall of the hall above the foyer roof
        ridge = 0.0
        if roof == 'gable' or roof is None:
            pitch = math.radians(srng.uniform(7, 13))
            ridge = (hall_w / 2) * math.tan(pitch)
            # gable fronts: ridge along y -> triangle on the front wall
            fseg = lib.Seg((-hall_w / 2, yh0), (hall_w / 2, yh0))
            U.F(b, [fseg.P(0, fh - 0.4), fseg.P(hall_w, fh - 0.4), fseg.P(hall_w, H), fseg.P(0, H)], ws, wc)
            U.gable_tri(b, fseg, H, ridge, look=lk, slot=ws, col=wc)
            rseg = lib.Seg((hall_w / 2, yh1), (-hall_w / 2, yh1))
            U.gable_tri(b, rseg, H, ridge, look=lk, slot=ws, col=wc)
            U.gable_roof(b, (x0h, yh0, x1h, yh1), H, ridge, 'y', ov=0.8, ove=0.5, look=lk, slot='metal-roof', col=lk.roof_col)
            hall_roof_top = H + ridge
        elif roof == 'shed':
            rise = clamp(hall_d * 0.14, 1.5, 5.0)
            fseg = lib.Seg((-hall_w / 2, yh0), (hall_w / 2, yh0))
            U.F(b, [fseg.P(0, fh - 0.4), fseg.P(hall_w, fh - 0.4), fseg.P(hall_w, H), fseg.P(0, H)], ws, wc)
            # mono-pitch rising to the back with a glazed clerestory strip under the high eave
            pts = [(x0h - 0.6, yh0 - 0.6, H), (x1h + 0.6, yh0 - 0.6, H), (x1h + 0.6, yh1 + 0.4, H + rise), (x0h - 0.6, yh1 + 0.4, H + rise)]
            U.F(b, pts, 'metal-roof', lk.roof_col, hint=(0, -rise, hall_d))
            for xx, hint in ((x0h, (-1, 0, 0)), (x1h, (1, 0, 0))):
                b.facing([(xx, yh0, H), (xx, yh1, H), (xx, yh1, H + rise)], hint, ws, wc)
            rseg = lib.Seg((x1h, yh1), (x0h, yh1))
            U.F(b, [rseg.P(0, H), rseg.P(hall_w, H), rseg.P(hall_w, H + rise), rseg.P(0, H + rise)], ws, wc)
            hall_roof_top = H + rise
        else:
            fseg = lib.Seg((-hall_w / 2, yh0), (hall_w / 2, yh0))
            U.F(b, [fseg.P(0, fh - 0.4), fseg.P(hall_w, fh - 0.4), fseg.P(hall_w, H), fseg.P(0, H)], ws, wc)
            lib.roof(b, 'flat', lib.fp_rect(hall_w, hall_d, 0.0, (yh0 + yh1) / 2), H, lk, parapet_h=1.0, ov=0.0, slab=0.0)
            hall_roof_top = H + 1.0
            if det == 0:
                for k in range(3):
                    bx = srng.uniform(-hall_w * 0.3, hall_w * 0.3)
                    by = srng.uniform(yh0 + 6, yh1 - 6)
                    lib.box_c(b, bx, by, H, srng.uniform(3, 6), srng.uniform(2.5, 4), srng.uniform(1.3, 2.4), 'metal-cladding', lib.shade(lk.metal_col, srng.uniform(0.85, 1.05)), top_slot='roof-flat')
    # --- foyer across the full width
    b.section('foyer')
    fw = max(W * fw_ratio, hall_w + 0.5) if not wings else W
    fseg = lib.Seg((-fw / 2, y_front), (fw / 2, y_front))
    # atrium (taller, glazed) in the middle
    atw = clamp(W * srng.uniform(0.26, 0.42), 10.0, 34.0)
    ah = clamp(fh * 1.55, fh + 2.0, H - 0.5)
    ops = []
    # lower foyer front: glazed with deep mullions (curtain) at the sides
    foyer_front = 'curtain' if lk.windows in ('curtain', 'ribbon', 'screen') or 'atrium-glass' in ft else 'punched'
    kind_f = foyer_front
    # side wings of the foyer: wall + band of glazing
    for sgn in (-1, 1):
        x_a, x_b = (atw / 2, fw / 2) if sgn > 0 else (-fw / 2, -atw / 2)
        L = x_b - x_a
        sg = lib.Seg((x_a, y_front), (x_b, y_front))
        if kind_f == 'curtain':
            U.F(b, [sg.P(0, 0), sg.P(L, 0), sg.P(L, 0.9), sg.P(0, 0.9)], ws, wc)
            U.F(b, [sg.P(0, fh - 0.9), sg.P(L, fh - 0.9), sg.P(L, fh), sg.P(0, fh)], ws, acc if acc else wc)
            if det < 2:
                if det == 0:
                    n = max(2, int(L / 3.0))
                    for k in range(n):
                        b.face([sg.P(k * L / n, 0.9, -0.05), sg.P((k + 1) * L / n, 0.9, -0.05), sg.P((k + 1) * L / n, fh - 0.9, -0.05), sg.P(k * L / n, fh - 0.9, -0.05)], lk.glass_slot, gl)
                        U.sbox(b, sg, k * L / n - 0.05, k * L / n + 0.05, 0.9, fh - 0.9, 0.12, lk.frame_col, 'frame', top=False)
                else:
                    b.face([sg.P(0, 0.9, -0.05), sg.P(L, 0.9, -0.05), sg.P(L, fh - 0.9, -0.05), sg.P(0, fh - 0.9, -0.05)], lk.glass_slot, gl, mode='tile', scale=3.0)
        else:
            n = max(2, int(L / 5.0))
            fops = U.bay_ops(L, n, 0, None, 1.8, 1.0, fh - 0.9, 'rect', 'glass', 1.0, 0.2, 0, 0.0, False)
            U.wall(b, (x_a, y_front), (x_b, y_front), 0.0, fh, lk, fops, ws, wc, trim, plinth=0.4)
        # foyer sides (end wall)
    for sgn in (-1, 1):
        xe = sgn * fw / 2
        U.wall(b, (xe, y_front) if sgn < 0 else (xe, y_front), (xe, yh0) if sgn < 0 else (xe, yh0), 0.0, fh, lk, [], ws, wc, trim) if False else None
    # end walls of the foyer
    U.wall(b, (fw / 2, y_front), (fw / 2, yh0), 0.0, fh, lk, [], ws, wc, trim, plinth=0.4)
    U.wall(b, (-fw / 2, yh0), (-fw / 2, y_front), 0.0, fh, lk, [], ws, wc, trim, plinth=0.4)
    lib.cap(b, [[(-fw / 2, y_front), (fw / 2, y_front), (fw / 2, yh0), (-fw / 2, yh0)]], fh, True, 'roof-flat', lk.roof_col, scale=2.0)
    if det == 0:
        # roof edge slab
        ring = lib.fp_rect(fw, fd, 0.0, (y_front + yh0) / 2)
        lib.sweep(b, ring, fh - 0.45, [(0.25, 0), (0.25, 0.7), (0, 0.7)], 'plain-render', trim)
    if annex_side:
        # office / classroom annex against the hall side wall
        b.section('annex')
        aw_ = clamp(W * 0.17, 6.0, 15.0)
        ad = clamp(hall_d * srng.uniform(0.4, 0.7), 8.0, 36.0)
        ah_ = fh * 1.2
        ax0 = annex_side * (hall_w / 2)
        ax1 = annex_side * (hall_w / 2 + aw_)
        ya0, ya1 = yh0 + 0.5, yh0 + 0.5 + ad
        xa, xb = min(ax0, ax1), max(ax0, ax1)
        if annex_side > 0:
            outer = [((xb, ya0), (xb, ya1)), ((xb, ya1), (xa, ya1)), ((xa, ya0), (xb, ya0))]
        else:
            outer = [((xa, ya1), (xa, ya0)), ((xb, ya1), (xa, ya1)), ((xa, ya0), (xb, ya0))]
        for (p0, p1) in outer:
            Ls = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
            ops_a = U.bay_ops(Ls, max(1, int(Ls / 4.0)), 0, None, 1.6, 1.0, ah_ - 0.9, 'rect', 'glass', 1.0, 0.2, 0, 0.0, False) if (det <= 1 and Ls > 4) else []
            U.wall(b, p0, p1, 0.0, ah_, lk, ops_a, ws, wc, trim, plinth=0.4)
        lib.cap(b, [[(xa, ya0), (xb, ya0), (xb, ya1), (xa, ya1)]], ah_, True, 'roof-flat', lk.roof_col, scale=2.0)
        if det == 0:
            lib.sweep(b, lib.fp_rect(xb - xa, ya1 - ya0, (xa + xb) / 2, (ya0 + ya1) / 2), ah_ - 0.3, [(0.2, 0), (0.2, 0.8), (0, 0.8)], 'plain-render', trim)
    # glazed atrium block rising from the foyer: tall front glass, flat-roofed or with a glazed gable
    atr_kind = 'gable' if (roof in ('gable', None) and not fan and ('glazed' in U.text(brief) and 'gable' in U.text(brief) or srng.random() < 0.5)) else 'box'
    asg = lib.Seg((-atw / 2, y_front), (atw / 2, y_front))
    if det < 2:
        bayw = 3.0
        if det == 0:
            n = max(3, int(atw / bayw))
            for k in range(n):
                b.face([asg.P(k * atw / n, 0, -0.1), asg.P((k + 1) * atw / n, 0, -0.1), asg.P((k + 1) * atw / n, ah, -0.1), asg.P(k * atw / n, ah, -0.1)], lk.glass_slot, gl)
                U.sbox(b, asg, k * atw / n - 0.07, k * atw / n + 0.07, 0, ah, 0.2, lk.frame_col, 'frame', top=False)
            U.sbox(b, asg, atw - 0.07, atw + 0.07, 0, ah, 0.2, lk.frame_col, 'frame', top=False)
            for zz in (fh, ah - 0.4):
                U.sbox(b, asg, 0, atw, zz - 0.25, zz + 0.25, 0.28, acc if acc else trim, 'plain-render')
        else:
            b.face([asg.P(0, 0, -0.1), asg.P(atw, 0, -0.1), asg.P(atw, ah, -0.1), asg.P(0, ah, -0.1)], lk.glass_slot, gl, mode='tile', scale=3.0)
    else:
        b.face([asg.P(0, 0, -0.1), asg.P(atw, 0, -0.1), asg.P(atw, ah, -0.1), asg.P(0, ah, -0.1)], 'plain', gl)
    # atrium sides and roof
    gabled = atr_kind == 'gable'
    ag = atw * 0.2
    for sgn in (-1, 1):
        xs = sgn * atw / 2
        pts = [(xs, y_front, 0), (xs, yh0 + 0.5, 0), (xs, yh0 + 0.5, ah), (xs, y_front, ah)]
        if gabled:
            pts = [(xs, y_front, 0), (xs, yh0 + 0.5, 0), (xs, yh0 + 0.5, ah), (xs, y_front, ah)]
        b.facing(pts, (sgn, 0, 0), ws, wc, scale=U.tscale(ws, det))
    if gabled:
        # a glazed pediment-like gable over the atrium block
        for sgn in (-1, 1):
            xs = sgn * atw / 2
            b.facing([(xs, y_front, ah), (xs, yh0 + 0.5, ah), (0, yh0 + 0.5, ah + ag), (0, y_front, ah + ag)], (sgn * ag, 0, atw / 2), 'metal-roof', lk.roof_col, scale=2.0)
        fr = [asg.P(0, ah, -0.1), asg.P(atw, ah, -0.1), asg.P(atw / 2, ah + ag, -0.1)]
        b.face(fr, lk.glass_slot if det < 2 else 'plain', gl, mode='tile', scale=3.0) if det < 2 else b.face(fr, 'plain', gl)
        if det == 0:
            U.sbox(b, asg, 0, atw, ah - 0.3, ah + 0.1, 0.3, acc if acc else trim, 'plain-render')
        for sgn in (-1, 1):
            xs = sgn * atw / 2
            b.facing([(xs, yh0 + 0.5, ah), (0, yh0 + 0.5, ah + ag), (xs, yh0 + 0.5, ah)], (0, 1, 0), ws, wc)
        ah_top = ah + ag
    else:
        b.face([(-atw / 2, y_front, ah), (atw / 2, y_front, ah), (atw / 2, yh0 + 0.5, ah), (-atw / 2, yh0 + 0.5, ah)], 'roof-flat', lk.roof_col)
        if det == 0:
            ring = lib.fp_rect(atw + 0.4, yh0 + 0.5 - y_front, 0.0, (y_front + yh0 + 0.5) / 2)
            lib.sweep(b, ring, ah - 0.5, [(0.2, 0), (0.2, 0.9), (0, 0.9)], 'plain-render', acc if acc else trim)
        ah_top = ah
    # --- entrance canopy over the doors
    b.section('canopy')
    cw = clamp(atw * 1.1, 10.0, 40.0)
    cdep = 7.5
    if 'flat-canopy' in ft or 'portico' in ft or True:
        entrance_canopy(b, lk, -cw / 2, cw / 2, y_front, fh - 0.2 if fh > 5 else 4.8, cdep, srng, columns=True, col=lk.roof_col, curved='curved-canopy' in ft)
    # tower / pylons / cross
    b.section('tower')
    ptop = H
    if cfg.tower or 'spire' in ft:
        ph = cfg.tower_h if cfg.tower_h else clamp(H * 1.55, H + 5, 32)
        pw = 1.8
        if srng.random() < 0.6:
            for sgn in (-1, 1):
                px = sgn * (atw / 2 + 2.0)
                lib.box_c(b, px, y_front + 1.0, 0, pw, pw, ph, 'rough-concrete', lib.shade(wc, 0.95), skip=('bottom',))
                lib.box_c(b, px, y_front + 1.0, ph, pw + 0.5, pw + 0.5, 0.35, 'roof-flat', trim, skip=())
            ptop = ph + 0.4
            roof_cross(b, 0.0, y_front + 0.3, ah_top, clamp(H * 0.35, 2.4, 6.0), '#e8e4d8')
        else:
            px = (atw / 2 + 5.0) * srng.choice([-1, 1])
            modern_tower(b, lk, srng, cfg, px, y_front + 3.0, 3.2, 3.2, ph, 'slab', ft)
    else:
        roof_cross(b, 0.0, y_front + 0.3, ah_top, clamp(H * 0.4, 2.6, 6.0), '#e8e4d8')
    if 'steps' in ft and det <= 1:
        U.front_steps(b, 0.0, y_front - cdep, clamp(atw * 0.7, 6, 14), 0.9, 5, lk)
    # --- site
    b.section('site')
    half = W / 2 + 7
    U.site_common(b, lk, srng, dict(brief, setting=dict(brief.get('setting') or {}, forecourt='parking')), ft, half, y_front - cdep, yh1, W / 2, 0.0, tree_h=8.0, front_margin=26.0 if W < 80 else 22.0,
                  rear_margin=8.0, rail=True, trees=7, forecourt_default='parking', force_fence='fence-wall' in ft or 'gate' in ft, gate_w=7.0)
    finish_site_extras(b, lk, srng, ft, brief, W * 0.33, y_front - cdep, flag_n=3)
    if 'flags' in ft and det == 0:
        pass


# --------------------------------------------------------------------------------------------------------------------- A-frame
def build_aframe(b, lk, srng, cfg, brief, ft):
    det = b.detail
    Wa = clamp(min(cfg.w, cfg.d) * 0.95 if min(cfg.w, cfg.d) > 9 else 10.0, 9.0, 22.0)
    La = clamp(max(cfg.w, cfg.d), 14.0, 40.0)
    H = clamp(cfg.H, 7.0, 24.0)
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    y0, y1 = -La / 2, La / 2
    hw = Wa / 2
    zk = 0.5
    rs, rc = lk.roof_slot, lk.roof_col
    b.section('frame')
    # two roof planes down to the ground (a low knee wall)
    for sgn in (-1, 1):
        pts = [(sgn * hw, y0 - 0.9, zk), (0, y0 - 0.9, H), (0, y1 + 0.3, H), (sgn * hw, y1 + 0.3, zk)]
        if sgn > 0:
            pts = pts[::-1]
        U.F(b, pts, rs, rc, hint=(sgn * H, 0, hw))
        if det == 0:
            b.facing([(sgn * hw, y0 - 0.9, zk), (0, y0 - 0.9, H), (0, y0 - 0.9, H - 0.25), (sgn * hw, y0 - 0.9, zk - 0.25)], (0, -1, 0), 'plain-render', lib.shade(rc, 0.65))
    # rear gable wall
    rseg = lib.Seg((hw, y1), (-hw, y1))
    U.F(b, [rseg.P(0, zk), rseg.P(Wa, zk), rseg.P(Wa / 2, H)], ws, wc)
    # front: fully glazed triangle with a timber frame + a door
    fseg = lib.Seg((-hw, y0), (hw, y0))
    gl = STAIN[0] if cfg.stained else lk.glass_col
    top_pts = [fseg.P(0.05, zk), fseg.P(Wa - 0.05, zk), fseg.P(Wa / 2, H - 0.05)]
    # door recess
    dw = clamp(Wa * 0.22, 1.6, 2.6)
    if det < 2:
        b.face(top_pts, 'glass-curtain', gl, mode='tile', scale=3.0)
    else:
        b.face(top_pts, 'plain', gl)
    if det == 0:
        # rafters and purlins
        n = 6
        for k in range(1, n):
            u = Wa * k / n
            h = zk + (H - zk) * (1 - abs(u - Wa / 2) / (Wa / 2))
            b.face([fseg.P(u - 0.07, zk, -0.1), fseg.P(u + 0.07, zk, -0.1), fseg.P(u + 0.07, h, -0.1), fseg.P(u - 0.07, h, -0.1)], 'timber', '#6b4a30')
        for k in range(1, 4):
            z = zk + (H - zk) * k / 4
            half = (Wa / 2) * (1 - (z - zk) / (H - zk))
            b.face([fseg.P(Wa / 2 - half, z - 0.07, -0.1), fseg.P(Wa / 2 + half, z - 0.07, -0.1), fseg.P(Wa / 2 + half, z + 0.07, -0.1), fseg.P(Wa / 2 - half, z + 0.07, -0.1)], 'timber', '#6b4a30')
        # door
        b.face([fseg.P(Wa / 2 - dw / 2, zk, -0.12), fseg.P(Wa / 2 + dw / 2, zk, -0.12), fseg.P(Wa / 2 + dw / 2, zk + 2.3, -0.12), fseg.P(Wa / 2 - dw / 2, zk + 2.3, -0.12)], 'timber', '#4b3426')
        roof_cross(b, 0.0, y0 - 0.9, H, 2.8, '#e8e4d8')
    # floor/base slab and side annex (vestry) with shed roof
    b.section('annex')
    ax = hw + 2.2 if srng.random() < 0.5 else -(hw + 2.2)
    sgn = 1 if ax > 0 else -1
    ay0, ay1 = y1 - clamp(La * 0.42, 5, 14), y1 - 1.0
    aw_ = 4.0
    z_a = 3.0
    xa0, xa1 = (hw - 0.6, hw - 0.6 + aw_) if sgn > 0 else (-(hw - 0.6 + aw_), -(hw - 0.6))
    for (p0, p1) in (((xa1, ay0), (xa1, ay1)) if sgn > 0 else ((xa0, ay1), (xa0, ay0)),):
        L = ay1 - ay0
        ops = U.bay_ops(L, max(1, int(L / 3.5)), 0, None, 1.2, 1.0, 2.4, 'rect', 'glass', 1.0, 0.2, 0, 0.0, False)
        U.wall(b, p0, p1, 0.0, z_a, lk, ops, ws, wc, trim)
    U.wall(b, (xa0, ay0), (xa1, ay0), 0.0, z_a, lk, [], ws, wc, trim) if True else None
    U.wall(b, (xa1, ay1), (xa0, ay1), 0.0, z_a, lk, [], ws, wc, trim)
    U.F(b, [(xa0, ay0 - 0.3, z_a + 1.2), (xa1 + 0.3 * sgn, ay0 - 0.3, z_a), (xa1 + 0.3 * sgn, ay1 + 0.3, z_a), (xa0, ay1 + 0.3, z_a + 1.2)] if sgn > 0 else [(xa1, ay0 - 0.3, z_a + 1.2), (xa0 - 0.3, ay0 - 0.3, z_a), (xa0 - 0.3, ay1 + 0.3, z_a), (xa1, ay1 + 0.3, z_a + 1.2)], 'metal-roof', rc, hint=(sgn, 0, 1.2) if True else None)
    # entrance canopy and bell frame
    b.section('canopy')
    entrance_canopy(b, lk, -dw * 1.3, dw * 1.3, y0 - 0.9, 3.0, 3.2, srng)
    if det <= 1:
        bx = -(hw + 3.5) * (1 if sgn > 0 else -1)
        for dx in (-0.6, 0.6):
            lib.box_c(b, bx + dx, y0 + 1.0, 0, 0.25, 0.25, 4.0, 'timber', '#6b4a30', skip=('bottom',))
        lib.box_c(b, bx, y0 + 1.0, 4.0, 1.8, 0.35, 0.3, 'timber', '#6b4a30', skip=())
    b.section('site')
    U.site_common(b, lk, srng, brief, ft, hw + 12, y0 - 3.5, y1, hw + 2, 0.0, tree_h=9.0, front_margin=12.0, rear_margin=7.0, rail=False, trees=7, forecourt_default='garden')
    finish_site_extras(b, lk, srng, ft, brief, hw + 4, y0)


# ------------------------------------------------------------------------------------------------------------------ brutalist
def build_brutalist(b, lk, srng, cfg, brief, ft):
    det = b.detail
    w, d, H = cfg.w, cfg.d, cfg.H
    L = clamp(max(w, d), 14.0, 80.0)
    Wt = clamp(min(w, d), 9.0, 0.7 * L)
    Wt = max(Wt, L / 3.6)
    conc = lib.shade(lk.wall_col, 0.95)
    ws, wc, trim = 'rough-concrete', conc, lib.shade(lk.trim_col, 0.92)
    lk.wall_slot = 'rough-concrete'
    y0, y1 = -L / 2, L / 2
    # stepped volumes: a tall nave block, lower aisles / sacristy blocks, with a deep slab roof
    hn = H
    b.section('nave')
    nw = Wt * 0.72
    # nave walls with deep concrete ribs (fins) and slit windows between
    for (p0, p1, side) in (((nw / 2, y0), (nw / 2, y1), 1), ((-nw / 2, y1), (-nw / 2, y0), -1)):
        Ls = y1 - y0
        n = max(3, int(Ls / 4.2))
        ops = []
        if det <= 1:
            ops = U.bay_ops(Ls, n, 0, None, 0.7, hn * 0.2, hn * 0.92, 'rect', STAIN[0] if cfg.stained else 'glass', 1.0, 0.45, 0, 0.0, False)
        seg = U.wall(b, p0, p1, 0.0, hn, lk, ops, ws, wc, trim, plinth=0.0)
        if det <= 1:
            for u in U.bay_positions(Ls, dict(bay=Ls / n)):
                U.sbox(b, seg, clamp(u, 0.4, Ls - 0.4) - 0.35, clamp(u, 0.4, Ls - 0.4) + 0.35, 0.0, hn + 0.6, 0.7, lib.shade(wc, 0.93), 'rough-concrete', top=True)
    # rear wall
    U.wall(b, (nw / 2, y1), (-nw / 2, y1), 0.0, hn, lk, [], ws, wc, trim)
    # front wall with a big glazed cross cut into it
    fseg = U.wall(b, (-nw / 2, y0), (nw / 2, y0), 0.0, hn, lk, [U.op(nw / 2 - 1.4, nw / 2 + 1.4, 0.0, 3.4, 'rect', 'door', 1.0, 0.5, 0, 0.0, False)], ws, wc, trim)
    if det < 2:
        cross_glass(b, fseg, nw / 2, 4.2, hn - 4.8, clamp(nw * 0.1, 0.7, 1.4), STAIN[0] if cfg.stained else '#7fa0c8', frame=lib.shade(wc, 0.8))
    # stepped slab roof
    lib.flat_roof(b, lib.fp_rect(nw + 1.0, L + 1.2, 0, 0), hn, lk, parapet_h=0.0, ov=0.0, slab=0.9) if False else None
    ring = lib.fp_rect(nw, L)
    lib.cap(b, ring.polys, hn, True, 'roof-flat', lib.shade(wc, 0.8), scale=2.0)
    lib.sweep(b, ring, hn - 0.9, [(0.6, 0), (0.6, 1.1), (0, 1.1)], 'rough-concrete', lib.shade(wc, 1.02))
    # raised clerestory lantern block on the roof, tilted shed above
    cw_ = nw * 0.6
    ch = clamp(H * 0.2, 1.8, 4.0)
    lib.box_c(b, 0, 0, hn + 0.2, cw_, L * 0.5, ch, 'rough-concrete', lib.shade(wc, 0.98), top_slot='roof-flat', top_col=lib.shade(wc, 0.8))
    # lower aisle / side blocks stepping down
    b.section('side blocks')
    sw = (Wt - nw) / 2 + 2.5
    sh = clamp(H * 0.4, 3.5, 7.0)
    for sgn in (-1, 1):
        x_in = sgn * (nw / 2)
        x_out = sgn * (nw / 2 + sw)
        yb0, yb1 = y0 + L * 0.12, y1 - L * 0.3
        if sgn > 0:
            U.wall(b, (x_out, yb0), (x_out, yb1), 0.0, sh, lk, [], ws, wc, trim)
            U.wall(b, (x_out, yb1), (x_in, yb1), 0.0, sh, lk, [], ws, wc, trim)
            U.wall(b, (x_in, yb0), (x_out, yb0), 0.0, sh, lk, [], ws, wc, trim)
        else:
            U.wall(b, (x_out, yb1), (x_out, yb0), 0.0, sh, lk, [], ws, wc, trim)
            U.wall(b, (x_in, yb1), (x_out, yb1), 0.0, sh, lk, [], ws, wc, trim)
            U.wall(b, (x_out, yb0), (x_in, yb0), 0.0, sh, lk, [], ws, wc, trim)
        lib.cap(b, [[(min(x_in, x_out), yb0), (max(x_in, x_out), yb0), (max(x_in, x_out), yb1), (min(x_in, x_out), yb1)]], sh, True, 'roof-flat', lib.shade(wc, 0.8), scale=2.0)
        lib.box_c(b, (x_in + x_out) / 2, (yb0 + yb1) / 2, sh - 0.7, abs(x_out - x_in) + 1.0, yb1 - yb0 + 1.0, 0.7, 'rough-concrete', lib.shade(wc, 1.03), skip=())
        if det == 0:
            sg = lib.Seg((x_out, yb0), (x_out, yb1)) if sgn > 0 else lib.Seg((x_out, yb1), (x_out, yb0))
            for k in range(3):
                u = (yb1 - yb0) * (k + 0.5) / 3
                b.face([sg.P(u - 0.5, 1.2, -0.05), sg.P(u + 0.5, 1.2, -0.05), sg.P(u + 0.5, sh - 1.4, -0.05), sg.P(u - 0.5, sh - 1.4, -0.05)], 'glass-punched', lk.glass_col)
    # slab bell tower
    b.section('tower')
    th = (cfg.tower_h if cfg.tower_h else clamp(H * 2.0, 16, 44))
    tx = (Wt / 2 + 5.0) * srng.choice([-1, 1])
    tw, td = 3.0, 6.0
    ty = y0 + 4.0
    U.wall(b, (tx + tw / 2, ty - td / 2), (tx + tw / 2, ty + td / 2), 0.0, th, lk, [], ws, wc, trim)
    U.wall(b, (tx - tw / 2, ty + td / 2), (tx - tw / 2, ty - td / 2), 0.0, th, lk, [], ws, wc, trim)
    tf = U.wall(b, (tx - tw / 2, ty - td / 2), (tx + tw / 2, ty - td / 2), 0.0, th, lk, [], ws, wc, trim)
    U.wall(b, (tx + tw / 2, ty + td / 2), (tx - tw / 2, ty + td / 2), 0.0, th, lk, [], ws, wc, trim)
    lib.cap(b, [[(tx - tw / 2, ty - td / 2), (tx + tw / 2, ty - td / 2), (tx + tw / 2, ty + td / 2), (tx - tw / 2, ty + td / 2)]], th, True, 'roof-flat', lib.shade(wc, 0.8))
    if det < 2:
        # big open slots in the broad faces
        sgx = lib.Seg((tx + tw / 2, ty - td / 2), (tx + tw / 2, ty + td / 2))
        for zz in (th * 0.45, th * 0.78):
            b.face([sgx.P(1.2, zz, -0.04), sgx.P(td - 1.2, zz, -0.04), sgx.P(td - 1.2, zz + th * 0.12, -0.04), sgx.P(1.2, zz + th * 0.12, -0.04)], 'glass-punched', '#46494c')
        b.face([tf.P(0.8, th * 0.7, -0.04), tf.P(tw - 0.8, th * 0.7, -0.04), tf.P(tw - 0.8, th - 1.2, -0.04), tf.P(0.8, th - 1.2, -0.04)], 'glass-punched', '#46494c')
    roof_cross(b, tx, ty, th, clamp(th * 0.14, 2.5, 5.5), '#d8d4c8')
    if 'steps' in ft and det <= 1:
        U.front_steps(b, 0.0, y0, 7.0, 0.9, 5, lk)
    b.section('site')
    U.site_common(b, lk, srng, brief, ft, max(Wt / 2 + 12, abs(tx) + 5), y0, y1, Wt / 2, 0.0, tree_h=8.0, front_margin=14.0, rear_margin=8.0, rail=True, trees=6, forecourt_default='plaza')
    finish_site_extras(b, lk, srng, ft, brief, Wt / 2 + 4, y0)


# ----------------------------------------------------------------------------------------------------------------------- tent
def build_tent(b, lk, srng, cfg, brief, ft):
    """Wedge-plan cathedral under a taut membrane roof, with a tall cross tower and stay cables (after Abidjan)."""
    det = b.detail
    W = clamp(cfg.w, 30.0, 90.0)
    D = clamp(cfg.d, 30.0, 80.0)
    H = clamp(cfg.H, 14.0, 44.0)
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    y0, y1 = -D / 2, D / 2
    wf = W * 0.34
    poly = [(-wf / 2, y0), (wf / 2, y0), (W / 2, y1), (-W / 2, y1)]
    fp = lib.fp_polygon(poly)
    hw_ = H * 0.62
    b.section('walls')
    for e in fp.edges():
        ops = []
        if det <= 1 and e.length > 6 and not e.rear:
            n = max(2, int(e.length / 5.5))
            ops = U.bay_ops(e.length, n, 0, None, 1.0, hw_ * 0.25, hw_ - 0.8, 'pointed', STAIN[0] if cfg.stained else 'glass', 1.5, 0.3, 0, 0.0, False)
        U.wall(b, e.p0, e.p1, 0.0, hw_, lk, ops, ws, wc, trim, plinth=0.0)
    # sweeping membrane roof: rises from the low front to the high back, lifted along the centre (a tent ridge)
    b.section('roof')
    nx, ny = (10, 6) if det == 0 else (6, 4)
    grid = []
    for i in range(nx + 1):
        u = -1 + 2 * i / nx
        row = []
        for j in range(ny + 1):
            t = j / ny
            y = y0 + (y1 - y0) * t
            half = (wf + (W - wf) * t) / 2
            x = u * half
            z = hw_ + (H - hw_) * (t ** 1.4) * (0.62 + 0.38 * (1 - u * u)) + 0.6 * (1 - abs(u))
            row.append((x, y, z))
        grid.append(row)
    lib.roof_shell(b, grid, 0.5, lk, slot='plain-render', col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.7), edge_col=lib.shade(lk.roof_col, 0.85), smooth=True)
    # the tall cross tower with arms, standing at the front corner
    b.section('tower')
    th = (cfg.tower_h if cfg.tower_h else clamp(H * 1.9, 30, 80))
    tx = -(wf / 2 + 7.0)
    ty = y0 + 3.0
    tw = 2.8
    lib.box_c(b, tx, ty, 0, tw, tw, th, 'rough-concrete', lib.shade(wc, 0.97), skip=('bottom',), top_slot='roof-flat')
    arm_z = th * 0.82
    arm_l = th * 0.2
    lib.box_c(b, tx, ty, arm_z, arm_l * 2 + tw, tw * 0.8, tw * 0.9, 'rough-concrete', lib.shade(wc, 0.97), skip=('bottom',), top_slot='roof-flat')
    lib.box_c(b, tx, ty, th, tw * 0.9, tw * 0.9, th * 0.06, 'rough-concrete', lib.shade(wc, 0.97), skip=('bottom',))
    # seven stay cables from the tower to the roof edge
    if det < 2:
        n = 7
        for k in range(n):
            t = (k + 1) / (n + 1)
            u = -1 + 2 * t
            tx2 = u * (wf + (W - wf) * 0.7) / 2 * 0.9
            ty2 = y0 + D * (0.35 + 0.5 * t)
            zr = hw_ + (H - hw_) * 0.55
            cable(b, (tx, ty, th * (0.9 - 0.4 * (k / n))), (tx2, ty2, zr + 0.4), 0.15 if det == 0 else 0.25)
    # grand steps with coloured panels in front
    b.section('steps')
    if det <= 1 or 'steps' in ft:
        sw = clamp(wf + 6, 8, 18)
        n = 7 if det == 0 else 3
        U.front_steps(b, 0.0, y0, sw, 3.0, n, lk, run=9.0)
        if det == 0 and 'mosaic' in ft:
            pal = ['#c9772f', '#2f6f9a', '#d6b24a', '#a3352f', '#4f8a5a']
            for k in range(n):
                zt = 3.0 * (k + 1) / n
                run = 9.0 * (n - k) / n
                for m in range(5):
                    xa = -sw / 2 + sw * m / 5
                    b.face([(xa, y0 - run + 0.05, zt + 0.01), (xa + sw / 5, y0 - run + 0.05, zt + 0.01), (xa + sw / 5, y0 - run + 9.0 / n - 0.05, zt + 0.01), (xa, y0 - run + 9.0 / n - 0.05, zt + 0.01)], 'plain', pal[(k + m) % 5])
    b.section('site')
    U.site_common(b, lk, srng, brief, ft, W / 2 + 10, y0 - 9.0, y1, W / 2, 0.0, tree_h=9.0, front_margin=12.0, rear_margin=8.0, rail=False, trees=6, forecourt_default='plaza')


# ---------------------------------------------------------------------------------------------------------------------- shell
def build_shell(b, lk, srng, cfg, brief, ft):
    """Hall under a barrel / sail / wave roof with glazed front and rear (contemporary cathedral or chapel)."""
    det = b.detail
    L = clamp(max(cfg.w, cfg.d), 18.0, 80.0)
    Wt = clamp(min(cfg.w, cfg.d), 10.0, 0.75 * L)
    H = clamp(cfg.H, 8.0, 34.0)
    ws, wc, trim = lk.wall_slot, lk.wall_col, lk.trim_col
    hw = Wt / 2
    zw = clamp(H * 0.45, 3.5, 12.0)
    y0, y1 = -L / 2, L / 2
    style = srng.choice(['barrel', 'sail', 'wave'])
    txt = U.text(brief)
    if 'wave' in txt or cfg.roof == 'wave':
        style = 'wave'
    elif cfg.roof == 'barrel':
        style = 'barrel'
    b.section('walls')
    fp = lib.fp_rect(Wt, L)
    for e in fp.edges():
        ops = []
        if det <= 1 and not e.front and not e.rear:
            n = max(2, int(e.length / 5))
            ops = U.bay_ops(e.length, n, 0, None, 1.2, zw * 0.3, zw - 0.5, 'rect', STAIN[0] if cfg.stained else 'glass', 1.0, 0.25, 0, 0.0, False)
        if e.front:
            dw = 2.6
            ops = [U.op(Wt / 2 - dw / 2, Wt / 2 + dw / 2, 0.0, 3.4, 'rect', 'door', 1.0, 0.45, 0, 0.0, False)]
        U.wall(b, e.p0, e.p1, 0.0, zw, lk, ops, ws, wc, trim, plinth=0.4)
    b.section('roof')
    nx, ny = (16, 8) if det == 0 else (8, 4)
    rise = H - zw
    grid = []
    ph = srng.uniform(0, 6.28)
    for i in range(nx + 1):
        u = -1 + 2 * i / nx
        row = []
        for j in range(ny + 1):
            t = j / ny
            y = y0 - 0.8 + (L + 1.6) * t
            x = u * (hw + 0.8)
            if style == 'barrel':
                z = zw + rise * math.sqrt(max(0.0, 1 - u * u)) * 0.98 + 0.1
            elif style == 'sail':
                z = zw + rise * (0.25 + 0.75 * t) * (1 - 0.55 * u * u) + 0.2
            else:
                z = zw + rise * (0.45 + 0.35 * math.sin(2 * math.pi * t * 1.5 + ph)) * (1 - 0.3 * u * u)
            row.append((x, y, z))
        grid.append(row)
    # rows run along x (i), columns along y (j): top surface faces up
    lib.roof_shell(b, grid, 0.5, lk, slot='metal-roof', col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.6), edge_col=lib.shade(lk.roof_col, 0.85))
    # glazed infill under the roof at the front and rear: fit the gap between z = zw and the shell underside
    for (yy, hint, ytag) in ((y0, (0, -1, 0), 0), (y1, (0, 1, 0), grid[0].__len__() - 1)):
        pts = []
        for i in range(nx + 1):
            z = grid[i][ytag][2] - 0.5
            pts.append((grid[i][ytag][0], yy, max(zw, z)))
        poly = [(-hw - 0.8, yy, zw), (hw + 0.8, yy, zw)] + pts[::-1]
        if det < 2:
            b.facing(poly, hint, lk.glass_slot, STAIN[0] if cfg.stained else lk.glass_col, mode='fit' if det == 0 else 'fit')
        else:
            b.facing(poly, hint, 'plain', lk.glass_col)
    b.section('tower')
    if cfg.tower:
        th = cfg.tower_h if cfg.tower_h else clamp(H * 1.7, 14, 40)
        tx = (hw + 4.5) * srng.choice([-1, 1])
        modern_tower(b, lk, srng, cfg, tx, y0 + 4.0, 3.0, 3.0, th, srng.choice(['slab', 'open']), ft)
    elif det == 0:
        roof_cross(b, 0.0, y0 + 1.0, H, 3.0, '#e8e4d8')
    if 'steps' in ft and det <= 1:
        U.front_steps(b, 0.0, y0, 6.0, 0.6, 4, lk)
    b.section('site')
    U.site_common(b, lk, srng, brief, ft, hw + 12, y0, y1, hw + 2, 0.0, tree_h=8.0, front_margin=14.0, rear_margin=8.0, rail=True, trees=6, forecourt_default='plaza')
