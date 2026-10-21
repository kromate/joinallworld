"""shrine-small: small chapels, churches, synagogues, tombs, shrines, prayer halls and similar. One kit, many typologies picked from the
brief (wording, style, footprint, features, size):

  chapel     gabled nave with the entrance on the gable end: apse, bellcote / turret / square tower (pyramid, spire or onion cap), porch or
             pediment front, buttresses (gothic), steps, cross; wall, roof and window character follow the style (whitewashed Mediterranean,
             baroque pediment, georgian, gothic-revival, nordic timber, modern)
  orthodox   small Orthodox church: gabled nave, apse, a dome (or conical drum cap) on a drum, free-standing bell tower
  cross      cross plan (arms as gables meeting at a centre) with a drum and dome / conical cap (cross-in-square churches)
  monastery  U / L / ring ranges round a court with the church and a bell tower inside it (also Shia tekyeh style courtyard houses)
  rotunda    octagonal / round chapel with a pyramidal or conical roof; bahai: nine-sided domed house of worship with open arches
  lds        wide hipped temple with an attached front spire carrying a gilded statue
  synagogue  arched-window hall, portico or twin towers, dome, a hexagram roundel over the door
  tomb       qubba (cube + dome), turbe (octagon), imamzadeh (brick cube, tall drum, turquoise dome, court), Mughal plinth tomb, Hausa
             mud tomb (pinnacles), hip-roofed tomb, tomb mound with a hall, roman block; usually inside a wall with a gate
  pavilion   east-asian small temple hall (curved gable roof), Shinto haiden with torii, Nepalese dega, lean-to, pyramidal memorial shelter,
             Malay kramat, thatched round shrine
  grotto     Lourdes-type rock grotto with a statue; ruin: low rubble walls of a roofless church
  hall       plain gabled prayer hall / kingdom hall / evangelical hall with verandah (or flat-roofed hosseiniyeh with arches)

Layout (metres): front (entrance, steps, gate) towards -Y; the building stands at the back of its yard; x = 0 on the axis.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib  # noqa: E402
import _mosque_domed_util as U  # noqa: E402
from lib import mix, shade  # noqa: E402

FEATURES = {'bell-tower', 'spire', 'statue', 'steps', 'fence-wall', 'gate', 'arches', 'relief-pattern', 'courtyard', 'dome', 'onion-dome', 'minaret',
            'pinnacles', 'crenellation', 'stained-glass', 'rose-window', 'buttresses', 'portico', 'colonnade', 'pediment', 'flags', 'terrace', 'mosaic',
            'podium', 'pavilion', 'pagoda-roof', 'signage-board', 'awning', 'arcade', 'painted-mural', 'pier'}

TAU = math.tau
GOLD = '#d4a82f'


def bx(b, *a, **kw):
    if b.detail >= 1:
        kw.setdefault('scale', 6.0)
    lib.box(b, *a, **kw)


def bxc(b, *a, **kw):
    if b.detail >= 1:
        kw.setdefault('scale', 6.0)
    lib.box_c(b, *a, **kw)


def warnings(brief, style):
    w = []
    ft = U.feats(brief)
    if brief.get('confidence') == 'low':
        w.append('low confidence brief: typology guessed from wording and style')
    return w


# ================================================================================================================ design
def design(brief, style, rng, lk):
    F = U.form_of(brief)
    ft = U.feats(brief)
    txt = U.text(brief, style)
    st = brief.get('style') or ''
    f = brief.get('facade') or {}
    r = [rng.random() for _ in range(40)]
    W, Dp, H = F['w'], F['d'], F['h']
    if H <= 0:
        H = 6.0
    W, Dp = max(W, 2.5), max(Dp, 2.5)
    variant = F['variant']
    fp = F['fp']
    roof = F['roof']
    hw = lambda *w: U.has_word(txt, *w)
    typ = None
    # variant words first (generators must not require them, but they are the most direct hint)
    if 'grotto' in variant or hw('grotto', 'lourdes'):
        typ = 'grotto'
    elif 'nine-sided' in variant or hw('bah[aá]', 'baha'):
        typ = 'bahai'
    elif 'fuji' in variant or hw('fujizuka', 'fuji-mound', 'tomb mound'):
        typ = 'mound'
    elif roof == 'none' or hw('ruin', 'ruined', 'remains of'):
        typ = 'ruin'
    elif hw('synagog', 'shul', 'maghen', 'beth '):
        typ = 'synagogue'
    elif ft.get('spire') and ft.get('statue') and W >= 25 and st in ('modernist', 'contemporary', 'postmodern'):
        typ = 'lds'
    elif hw('tomb', 'mausoleum', 'turbe', 'imamzadeh', 'maqam', 'qubba', 'burial', 'dargah', 'mazar', 'shrine of', 'sufi', 'kramat', 'keramat') and not hw('chapel'):
        typ = 'tomb'
    elif fp in ('U', 'ring', 'L', 'H') or hw('monastery', 'monastic', 'convent', 'carmelite', 'abbey', 'manastir', 'tekyeh', 'hosseiniyeh courtyard'):
        typ = 'monastery'
    elif hw('cross-in-square', 'cone-dome', 'conical') and hw('church', 'monastery', 'orthodox') or fp == 'cross':
        typ = 'cross'
    elif fp == 'round' or 'octagonal' in variant or roof in ('pyramidal',) and fp in ('round',):
        typ = 'rotunda'
    elif hw('shinto', 'torii', 'haiden', 'jinja') or ('lean' in variant) or hw('lean-to', 'roadside shrine', 'dega', 'memorial shelter', 'prayer flag', 'hilltop', 'thatch') \
            or st in ('east-asian', 'southeast-asian', 'south-asian') or (roof in ('shed', 'pyramidal') and W < 10):
        typ = 'pavilion'
    elif ft.get('dome') and hw('orthodox', 'cemetery chapel', 'greek orthodox', 'serbian', 'macedonian', 'bulgarian'):
        typ = 'orthodox'
    elif hw('church', 'chapel', 'ermita', 'kapel', 'kirche', 'sanctuary', 'ecclesia', 'parish', 'cathedral', 'bell') or ft.get('bell-tower') or ft.get('spire'):
        typ = 'orthodox' if (ft.get('dome') and not hw('baroque')) else 'chapel'
    elif hw('hall', 'prayer', 'islamic centre', 'centre', 'kingdom', 'brother', 'evangel', 'hosseiniyeh', 'khelloua', 'cell'):
        typ = 'hall'
    else:
        typ = 'chapel' if r[0] < 0.7 else 'hall'
    if typ == 'hall' and ft.get('dome') and hw('khelloua', 'cell', 'hargeisa', 'tls', 'arab'):
        typ = 'tomb'
    D = {'type': typ, 'r': r, 'ft': ft, 'txt': txt, 'H': H, 'F': F, 'st': st, 'conf': brief.get('confidence', 'low')}
    D['fence'] = 'fence-wall' in ft or 'gate' in ft
    D['gate'] = 'gate' in ft
    D['steps'] = 'steps' in ft
    D['bell'] = 'bell-tower' in ft
    D['bell_note'] = (ft.get('bell-tower', {}).get('note', '') + ' ' + txt).lower()
    D['spire'] = 'spire' in ft
    D['dome'] = 'dome' in ft or 'onion-dome' in ft
    D['onion'] = 'onion-dome' in ft
    D['arches'] = 'arches' in ft
    D['relief'] = 'relief-pattern' in ft or 'mosaic' in ft
    D['stained'] = 'stained-glass' in ft or 'rose-window' in ft
    D['pedim'] = 'pediment' in ft or 'portico' in ft
    D['butt'] = 'buttresses' in ft
    D['statue'] = 'statue' in ft
    D['flags'] = 'flags' in ft
    D['court'] = 'courtyard' in ft
    D['arcade'] = 'arcade' in ft or 'colonnade' in ft
    D['minaret'] = 'minaret' in ft
    D['pagoda'] = ft.get('pagoda-roof', {}).get('count', 0)
    marg = 2.4 if D['fence'] else 0.0
    sc = U.fit_scale(W + 2 * marg, Dp + 2 * marg)
    D['sc'] = sc
    D['W'], D['D'] = W * sc, Dp * sc
    D['marg'] = marg
    D['wall'], D['wslot'] = lk.wall_col, lk.wall_slot
    D['accent'], D['trim'] = lk.accent_col, lk.trim_col
    D['rcol'] = lk.roof_col
    rm = f.get('roofMaterial')
    D['rslot'] = U._F.ROOF_SLOT.get(rm) if rm else None
    if not D['rslot']:
        D['rslot'] = lk.roof_slot
    if U.goldish(lk.roof_col):
        D['rslot'] = 'metal-roof'
    lk.roof_slot, lk.roof_col = D['rslot'], D['rcol']
    D['windows'] = lk.windows if lk.windows in ('arched', 'pointed-arch', 'punched', 'none', 'screen', 'louvre', 'ribbon', 'curtain') else 'arched'
    D['ratio'] = max(0.12, min(0.4, lk.ratio))
    D['lean'] = 0
    D['wall_mat'] = lk.wall_material
    return D


def roof_rise(W, D, H, wh, pitch_deg=None):
    rise = max(1.2, H - wh)
    return rise


# ================================================================================================================ pieces
def sq_tower(b, lk, D, cx, cy, z0, w, h, cap='pyramid', cap_h=None, open_belfry=True, ccol=None):
    """Square tower with a belfry stage (dark arched openings on all sides) and a cap: pyramid | spire | onion | flat | hip."""
    ws, wc = D['wslot'], D['wall']
    ccol = ccol or D['rcol']
    d = b.detail
    bxc(b, cx, cy, z0, w, w, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if d == 0 else 6.0)
    zt = z0 + h
    if d == 0:
        bxc(b, cx, cy, zt - 0.3, w + 0.4, w + 0.4, 0.3, 'plain-render', D['trim'])
        if open_belfry:
            bh = min(h * 0.28, 3.2)
            for (px, py, nx_, ny_) in ((0, -w / 2 - 0.03, 0, -1), (0, w / 2 + 0.03, 0, 1), (-w / 2 - 0.03, 0, -1, 0), (w / 2 + 0.03, 0, 1, 0)):
                ww = w * 0.34
                zb = zt - 0.5 - bh
                if nx_ == 0:
                    pts = [(cx - ww / 2, cy + py, zb), (cx + ww / 2, cy + py, zb), (cx + ww / 2, cy + py, zb + bh * 0.7), (cx, cy + py, zb + bh), (cx - ww / 2, cy + py, zb + bh * 0.7)]
                else:
                    pts = [(cx + px, cy - ww / 2, zb), (cx + px, cy + ww / 2, zb), (cx + px, cy + ww / 2, zb + bh * 0.7), (cx + px, cy, zb + bh), (cx + px, cy - ww / 2, zb + bh * 0.7)]
                b.facing(pts, (nx_, ny_, 0), 'glass-punched', '#d6dade')
            # a slim window lower down on the front
            b.face([(cx - w * 0.07, cy - w / 2 - 0.03, z0 + h * 0.25), (cx + w * 0.07, cy - w / 2 - 0.03, z0 + h * 0.25), (cx + w * 0.07, cy - w / 2 - 0.03, z0 + h * 0.5), (cx - w * 0.07, cy - w / 2 - 0.03, z0 + h * 0.5)], 'glass-punched', '#d6dade')
    ch = cap_h if cap_h is not None else (w * 1.0 if cap in ('pyramid', 'hip') else w * 2.6)
    if cap in ('pyramid', 'hip'):
        U.frustum(b, cx, cy, zt, zt + ch, w + (0.5 if d == 0 else 0.2), w + (0.5 if d == 0 else 0.2), 0.05, 0.05, D['rslot'], ccol, top=False, scale=1.0 if d == 0 else 4.0)
    elif cap == 'spire':
        n = 8 if d == 0 else 4
        base = [(cx + (w * 0.5 + 0.1) * 1.0 * math.cos(TAU * k / n + math.pi / n * 0), cy + (w * 0.5 + 0.1) * math.sin(TAU * k / n + math.pi / n * 0), zt) for k in range(n)]
        # square base rising into an octagonal spire (a transition would be nicer; a plain cone with 4 sides at LOD1/2)
        lib.cylinder(b, cx, cy, zt, zt + ch, (w * 0.5 + 0.15) * 1.0, n=n if d == 0 else 4, slot=D['rslot'], col=ccol, r_top=0.0, top=False, smooth=False)
    elif cap == 'onion':
        U.dome(b, cx, cy, zt, w * 0.5 + 0.1, w * 0.9, 'onion', D['rslot'], ccol, n=U.nn(b, 14), rings=5 if d == 0 else 3)
        ch = w * 0.9
    elif cap == 'flat':
        if d == 0:
            U.crenellate(b, cx - w / 2, cy - w / 2, cx + w / 2, cy + w / 2, zt, D['trim'], h=0.5, w=0.5, pitch=1.1)
        ch = 0.0
    if cap != 'flat' and d < 2:
        cross(b, D, cx, cy, zt + ch - 0.05, min(1.6, w * 0.5))
    return zt + ch


def cross(b, D, x, y, z, h, col=None):
    if b.detail >= 2:
        return
    col = col or '#c9a74a'
    t = 0.07 * h + 0.05
    lib.box(b, x - t, y - t, z, x + t, y + t, z + h, 'plain', col, skip=('bottom',))
    lib.box(b, x - h * 0.28, y - t, z + h * 0.62, x + h * 0.28, y + t, z + h * 0.62 + 2 * t, 'plain', col, skip=('bottom',))


def bellcote(b, lk, D, cx, y, z, w, h):
    """A small bell gable on the front gable apex: wall with a round-arched opening, a pointed cap and a cross."""
    ws, wc = D['wslot'], D['wall']
    ww = max(0.9, w)
    pts = [(cx - ww / 2, y, z), (cx + ww / 2, y, z), (cx + ww / 2, y, z + h * 0.7), (cx, y, z + h), (cx - ww / 2, y, z + h * 0.7)]
    b.facing(pts, (0, -1, 0), ws, wc)
    if b.detail >= 2:
        return
    t = 0.32
    b.facing([(px, y + t, pz) for (px, py, pz) in pts], (0, 1, 0), ws, wc)
    for k in range(len(pts)):
        p, q = pts[k], pts[(k + 1) % len(pts)]
        if p[2] == z and q[2] == z:
            continue
        b.facing([(p[0], y, p[2]), (q[0], y, q[2]), (q[0], y + t, q[2]), (p[0], y + t, p[2])], ((p[0] + q[0]) / 2 - cx, 0, (p[2] + q[2]) / 2 - (z + h * 0.4)), ws, D['trim'])
    if b.detail == 0:
        ow = ww * 0.36
        b.face([(cx - ow / 2, y - 0.02, z + h * 0.18), (cx + ow / 2, y - 0.02, z + h * 0.18), (cx + ow / 2, y - 0.02, z + h * 0.5), (cx, y - 0.02, z + h * 0.62), (cx - ow / 2, y - 0.02, z + h * 0.5)],
               'glass-punched', '#3a3f45')
        cross(b, D, cx, y + t / 2, z + h, 0.9)


def turret(b, lk, D, cx, cy, z, w, h):
    """A little square bell turret on the ridge with a pyramidal cap."""
    bxc(b, cx, cy, z, w, w, h, D['wslot'], D['wall'], skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 6.0)
    U.frustum(b, cx, cy, z + h, z + h + w * 1.1, w + 0.3, w + 0.3, 0.05, 0.05, D['rslot'], D['rcol'], top=False)
    if b.detail == 0:
        b.face([(cx - w * 0.2, cy - w / 2 - 0.02, z + h * 0.3), (cx + w * 0.2, cy - w / 2 - 0.02, z + h * 0.3), (cx + w * 0.2, cy - w / 2 - 0.02, z + h * 0.85), (cx - w * 0.2, cy - w / 2 - 0.02, z + h * 0.85)],
               'glass-punched', '#3a3f45')


def apse(b, lk, D, cx, y0, r, h, rise, rcol, slot):
    """Half-round apse behind y0: wall half-cylinder and a half-cone roof."""
    n = 10 if b.detail == 0 else 6
    prof = [(r, 0), (r, h)]
    U.revolve(b, cx, y0, 0.0, prof, n, D['wslot'], D['wall'], smooth=False, cap=False, a0=0.0, a1=math.pi)
    prof2 = [(r + 0.3, h - 0.1), (r * 0.12, h + rise)]
    U.revolve(b, cx, y0, 0.0, prof2, n, slot, rcol, smooth=False, cap=False, a0=0.0, a1=math.pi)


def door_front(b, lk, D, cx, y, z0, w, h, col='#6b4a30', arch=True):
    if b.detail >= 2:
        return
    seg = lib.Seg((cx - 2.0 * w, y), (cx + 2.0 * w, y))
    # a doorway opening in a short wall piece is overkill: draw a recessed dark door with a frame on the wall plane
    pts = [(cx - w / 2, y - 0.03, z0), (cx + w / 2, y - 0.03, z0), (cx + w / 2, y - 0.03, z0 + h * 0.78)]
    if arch:
        pts += [(cx, y - 0.03, z0 + h), (cx - w / 2, y - 0.03, z0 + h * 0.78)]
    else:
        pts += [(cx + w / 2, y - 0.03, z0 + h), (cx - w / 2, y - 0.03, z0 + h)]
    b.face(pts, 'glass-punched', '#e0e4e6')
    if b.detail == 0:
        for sx in (-1, 1):
            lib.box(b, cx + sx * w / 2 - 0.08, y - 0.12, z0, cx + sx * w / 2 + 0.08, y, z0 + h * 0.8, 'plain-render', D['trim'], skip=('bottom',))
        lib.box(b, cx - w / 2 - 0.08, y - 0.12, z0 + h * 0.78, cx + w / 2 + 0.08, y, z0 + h * 0.78 + 0.18, 'plain-render', D['trim'], skip=('bottom',))


def front_window(b, lk, D, cx, y, z, w, h, kind='arch'):
    if b.detail >= 2:
        return
    pts = [(cx - w / 2, y - 0.03, z), (cx + w / 2, y - 0.03, z), (cx + w / 2, y - 0.03, z + h * 0.7)]
    if kind == 'pointed':
        pts += [(cx, y - 0.03, z + h), (cx - w / 2, y - 0.03, z + h * 0.7)]
    elif kind == 'arch':
        pts += [(cx, y - 0.03, z + h), (cx - w / 2, y - 0.03, z + h * 0.7)]
    else:
        pts = [(cx - w / 2, y - 0.03, z), (cx + w / 2, y - 0.03, z), (cx + w / 2, y - 0.03, z + h), (cx - w / 2, y - 0.03, z + h)]
    b.face(pts, 'glass-punched', '#e0e4e6' if not D['stained'] else '#7a9ac8')
    if b.detail == 0:
        lib.box(b, cx - w / 2 - 0.06, y - 0.1, z - 0.1, cx + w / 2 + 0.06, y, z, 'plain-render', D['trim'], skip=('bottom',))


def rose(b, D, cx, y, z, r):
    if b.detail >= 2:
        return
    n = 10 if b.detail == 0 else 6
    pts = [(cx + r * math.cos(TAU * k / n), y - 0.03, z + r * math.sin(TAU * k / n)) for k in range(n)]
    b.facing(pts, (0, -1, 0), 'glass-punched', '#e0e4e6' if not D['stained'] else '#8aa4d0')


def steps_at(b, lk, D, cx, y_face, width, z_top, n=3, run=1.8):
    if z_top < 0.05:
        return
    lib.steps(b, cx - width / 2, cx + width / 2, y_face, z_top, run, n, 'paving', shade(D['wall'], 0.85))


def yard(b, lk, D, x0, y0, x1, y1, gate_w=2.4, h=1.1, thick=0.3, col=None, cap=None):
    """Low boundary wall round the yard with a gate gap (and piers) in the front wall."""
    col = col or shade(D['wall'], 0.97)
    cap = cap or D['trim']
    sc = 1.0 if b.detail == 0 else 6.0
    gx = 0.0
    segs = [(x0, y0, -gate_w / 2, y0 + thick), (gate_w / 2, y0, x1, y0 + thick), (x0, y1 - thick, x1, y1), (x0, y0, x0 + thick, y1), (x1 - thick, y0, x1, y1)]
    with b.site():
        for (a0, b0, a1, b1) in segs:
            if a1 - a0 < 0.1 or b1 - b0 < 0.1:
                continue
            lib.box(b, a0, b0, 0, a1, b1, h, D['wslot'], col, top_slot='roof-flat', top_col=cap, skip=('bottom',), scale=sc)
        for sx in (-1, 1):
            lib.box(b, sx * (gate_w / 2 + 0.2) - 0.25, y0 - 0.1, 0, sx * (gate_w / 2 + 0.2) + 0.25, y0 + thick + 0.1, h + 0.5, D['wslot'], col, top_slot='roof-flat', top_col=cap, skip=('bottom',), scale=sc)


# ================================================================================================================ chapel
def build_chapel(b, lk, D, srng, orthodox=False):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    st = D['st']
    # nave: the entrance is on the gable end, so the long side runs front to back
    gw, gl = (min(W, Dp), max(W, Dp)) if W > Dp * 1.15 else (W, Dp)
    gw = max(gw, 3.0)
    gl = max(gl, 3.5)
    timber = D['wall_mat'] == 'timber' or st == 'nordic'
    gothic = st in ('gothic-revival', 'victorian', 'tudor') or D['windows'] == 'pointed-arch'
    baroque = st in ('baroque', 'neoclassical') or D['pedim']
    modern = st in ('modernist', 'contemporary', 'brutalist', 'postmodern')
    wh = U.clamp(H * (0.58 if not gothic else 0.5), 2.4, 12.0)
    ridge = max(1.3, H - wh)
    pitch = math.degrees(math.atan2(ridge, gw / 2))
    if modern:
        ridge = min(ridge, gw / 2 * 0.4)
    ov = 0.45 if not baroque else 0.25
    cy = 0.0
    x0, x1 = -gw / 2, gw / 2
    y0, y1 = -gl / 2, gl / 2
    b.section('nave')
    ws, wc = D['wslot'], D['wall']
    rect = (x0, y0, x1, y1)
    # side walls with windows; back wall plain; front wall plain (door and window drawn on it)
    kind = D['windows'] if D['windows'] != 'none' else 'none'
    nside = max(1, int(gl / 3.4))
    segs = [lib.Seg((x1, y0), (x1, y1)), lib.Seg((x0, y1), (x0, y0))]
    for seg in segs:
        if kind == 'none' or b.detail >= 2:
            lib.facade(b, seg, 0, wh, 1, lk, 'none', 0.2, None, None, wall_slot=ws, wall_col=wc)
        else:
            lib.facade(b, seg, 0, wh, 1, lk, kind, D['ratio'], None, gl / nside, reduced=(b.detail >= 1), wall_slot=ws, wall_col=wc)
    U.plain_wall(b, lib.Seg((x1, y1), (x0, y1)), 0, wh, lk, ws, wc)
    front = lib.Seg((x0, y0), (x1, y0))
    U.plain_wall(b, front, 0, wh, lk, ws, wc)
    # gable end wall
    b.facing([(x0, y0, wh), (x1, y0, wh), (0, y0, wh + ridge)], (0, -1, 0), ws, wc)
    b.facing([(x1, y1, wh), (x0, y1, wh), (0, y1, wh + ridge)], (0, 1, 0), ws, wc)
    if b.detail == 0:
        fp = lib.fp_rect(gw, gl, 0, 0)
        lib.sweep(b, fp, 0, [(0.05, 0), (0.05, 0.5), (0, 0.5)], ws, shade(wc, 0.85))
    # front details
    dw = U.clamp(gw * 0.26, 1.2, 2.4)
    door_front(b, lk, D, 0.0, y0, 0.0, dw, min(wh * 0.7, 3.2), arch=(D['windows'] != 'punched'))
    if gw > 5.5:
        front_window(b, lk, D, 0.0, y0, wh + ridge * 0.22 if False else wh * 0.74, min(1.2, gw * 0.2), min(wh * 0.5, 2.0) if wh * 0.74 + 1.5 < wh + ridge else 1.0,
                     'pointed' if gothic else 'arch')
    if D['stained'] and gw > 4:
        rose(b, D, 0.0, y0, wh + ridge * 0.45, min(1.0, ridge * 0.22))
    # roof
    b.section('roof')
    rs, rc = D['rslot'], D['rcol']
    if timber and D['rslot'] in ('clay-tile', 'roof-flat'):
        pass
    U.gable_y(b, x0, y0, x1, y1, wh, ridge, rs, rc, ws, wc, scale=1.5 if b.detail == 0 else 5.0, ov=ov)
    if b.detail == 0:
        # barge boards along the rakes of the front gable
        for sx in (-1, 1):
            p0, p1 = (sx * (gw / 2 + ov), y0 - ov, wh - ov * ridge / (gw / 2)), (0, y0 - ov, wh + ridge)
            b.facing([p0, p1, (p1[0], p1[1], p1[2] - 0.22), (p0[0], p0[1], p0[2] - 0.22)], (0, -1, 0), 'plain-render', D['trim'])
    # apse
    ext = [-gw / 2 - 1.0, y0 - 0.5, gw / 2 + 1.0, y1 + 0.5]
    if orthodox or (r[2] < 0.5 and gl > 7) or gothic or baroque and gl > 12:
        ar = gw * 0.34
        apse(b, lk, D, 0.0, y1, ar, wh * 0.92, ridge * 0.55, rc, rs)
        ext[3] = y1 + ar
    # dome on the nave for Orthodox churches
    if orthodox or (D['dome'] and not baroque):
        b.section('dome')
        R = U.clamp(gw * 0.3, 1.0, 5.0)
        cyd = y1 - gl * 0.42
        dh = R * 0.9
        zd = wh + ridge * 0.55
        conical = U.has_word(D['txt'], 'conical', 'cone')
        n = 12 if b.detail == 0 else 8
        lib.cylinder(b, 0.0, cyd, zd - 0.4, zd + dh, R, n=n, slot=ws, col=wc, top=False, smooth=False)
        if b.detail == 0:
            for k in range(4):
                a = TAU * (k + 0.5) / 4 + math.pi / 4
                pass
            for k in range(n // 2):
                a = TAU * (k + 0.5) / (n // 2)
                ca, sa = math.cos(a), math.sin(a)
                pts = [(R * 0.96 * ca - 0.14 * sa, cyd + R * 0.96 * sa + 0.14 * ca, zd + dh * 0.2), (R * 0.96 * ca + 0.14 * sa, cyd + R * 0.96 * sa - 0.14 * ca, zd + dh * 0.2),
                       (R * 0.96 * ca + 0.14 * sa, cyd + R * 0.96 * sa - 0.14 * ca, zd + dh * 0.75), (R * 0.96 * ca - 0.14 * sa, cyd + R * 0.96 * sa + 0.14 * ca, zd + dh * 0.75)]
                b.face(pts, 'glass-punched', '#3a3f45')
        if conical:
            lib.cylinder(b, 0.0, cyd, zd + dh, zd + dh + R * 1.3, R * 1.08, n=n, slot=rs, col=rc, r_top=0.05, top=False, smooth=False)
            top = zd + dh + R * 1.3
        else:
            U.dome(b, 0.0, cyd, zd + dh, R * 1.0, R * 0.95, 'hemi' if not D['onion'] else 'onion', rs, rc, n=U.nn(b, 16), rings=5 if b.detail == 0 else 3)
            top = zd + dh + R * (0.95 if not D['onion'] else 1.4)
        cross(b, D, 0.0, cyd, top - 0.05, min(1.8, R * 0.6))
    # bell: tower, turret or bellcote
    b.section('bell')
    note = D['bell_note']
    has_bell = D['bell'] or D['spire'] or gothic
    if has_bell:
        tower_words = U.has_word(note, 'tower', 'campanile', 'belfry', 'steeple') and not U.has_word(note, 'bellcote', 'bell-cote', 'turret', 'gable', 'bell gable')
        if tower_words or D['spire'] or (gothic and gw > 6):
            tw = U.clamp(gw * 0.36, 1.8, 6.0)
            th = U.clamp(H * 0.8, wh + 1.2, 22)
            cap = 'spire' if (D['spire'] or gothic) else ('onion' if D['onion'] else 'pyramid')
            if st in ('baroque',) or U.has_word(note, 'onion'):
                cap = 'onion' if U.has_word(note, 'onion') else cap
            if orthodox and not D['spire']:
                # free-standing small tower beside the church
                tx = gw / 2 + tw * 0.8 + 1.0
                sq_tower(b, lk, D, tx, y0 + tw, 0.0, tw, th * 0.9, cap='pyramid')
                ext[2] = max(ext[2], tx + tw)
            else:
                sq_tower(b, lk, D, 0.0, y0 - tw * 0.5 + 0.3, 0.0, tw, th, cap=cap)
                ext[1] = y0 - tw + 0.3
        elif U.has_word(note, 'turret'):
            turret(b, lk, D, 0.0, y0 + gl * 0.3, wh + ridge * 0.55, 1.1, 1.4)
        else:
            bw_ = U.clamp(gw * 0.34, 1.0, 2.2)
            bellcote(b, lk, D, 0.0, y0 - ov, wh + ridge - 0.1, bw_, bw_ * 1.5)
    elif b.detail < 2:
        cross(b, D, 0.0, y0, wh + ridge - 0.1, min(1.5, gw * 0.18))
    # pediment screen / porch / pilasters
    if baroque and b.detail < 2:
        pw_ = gw * 0.62
        for sx in (-1, 1):
            lib.seg_box(b, front, gw / 2 + sx * (pw_ / 2) - 0.25, gw / 2 + sx * (pw_ / 2) + 0.25, 0.4, wh + ridge * 0.2, 0.22, D['trim'], 'plain-render')
        lib.seg_box(b, front, gw / 2 - pw_ / 2 - 0.35, gw / 2 + pw_ / 2 + 0.35, wh - 0.1, wh + 0.15, 0.3, D['trim'], 'plain-render')
        if b.detail == 0:
            lib.seg_box(b, front, gw / 2 - 0.9, gw / 2 + 0.9, 0.0, 0.2, 0.22, D['trim'], 'plain-render')
    if D['butt'] or gothic and b.detail == 0:
        nb = max(2, int(gl / 3.4))
        for sx in (-1, 1):
            for k in range(nb + 1):
                y = y0 + 0.2 + (gl - 0.4) * k / nb
                bxc(b, sx * (gw / 2 + 0.28), y, 0, 0.56, 0.5, wh * 0.82, 'plain-render', shade(wc, 0.94), skip=('bottom',))
                if b.detail == 0:
                    U.frustum(b, sx * (gw / 2 + 0.28), y, wh * 0.82, wh * 0.82 + 0.5, 0.56, 0.5, 0.3, 0.2, 'plain-render', shade(wc, 0.94), top=True)
    elif (not has_bell) and b.detail == 0 and gw > 6 and r[5] < 0.5:
        # simple porch: two posts and a lean-to gable
        pw_ = dw + 1.2
        for sx in (-1, 1):
            lib.cylinder(b, sx * pw_ / 2, y0 - 1.3, 0, 2.6, 0.12, n=5, slot='timber', col=D['trim'], top=False)
        U.gable_y(b, -pw_ / 2 - 0.2, y0 - 1.5, pw_ / 2 + 0.2, y0, 2.6, 0.9, rs, rc, ws, wc, scale=1.5)
    # steps
    if D['steps'] or (gw > 4 and r[6] < 0.7):
        steps_at(b, lk, D, 0.0, y0 - 0.0 if not (has_bell and not orthodox and ext[1] < y0 - 0.5) else ext[1], U.clamp(dw + 1.4, 2.0, 4.0), 0.45, 2, 1.0)
    return tuple(ext)


# ================================================================================================================ lds
def build_lds(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    gw, gl = W, Dp
    wh = U.clamp(H * 0.68, 3.5, 12)
    ws, wc = D['wslot'], D['wall']
    cy = 0.0
    b.section('hall')
    fp = lib.fp_rect(gw, gl, 0, cy)
    segs = fp.edges()
    for seg in segs:
        if seg.front or b.detail >= 1 or True:
            lib.facade(b, seg, 0, wh, 1, lk, 'arched' if D['windows'] in ('arched', 'punched') else D['windows'], 0.16, None, 4.4, reduced=(seg.rear or b.detail >= 1), wall_slot=ws, wall_col=wc)
    if b.detail == 0:
        lib.sweep(b, fp, 0, [(0.07, 0), (0.07, 0.6), (0, 0.6)], ws, shade(wc, 0.85))
        lib.cornice(b, fp, wh - 0.45, 0.4, 0.45, lk, D['trim'])
    # relief bands and panels
    if D['relief'] and b.detail < 2:
        for seg in fp.edges():
            if seg.rear:
                continue
            lib.seg_box(b, seg, 0, seg.length, wh * 0.62, wh * 0.62 + 0.55, 0.06, D['accent'], 'plain-render')
            if b.detail == 0:
                n = int(seg.length / 1.5)
                for k in range(n):
                    u = (k + 0.5) * seg.length / n
                    lib.seg_box(b, seg, u - 0.3, u + 0.3, wh * 0.62 + 0.1, wh * 0.62 + 0.45, 0.12, shade(D['accent'], 0.8 if k % 2 else 1.15), 'plain-render')
    b.section('roof')
    rise = max(1.5, H * 0.18)
    lib.hip(b, (-gw / 2, -gl / 2 + cy, gw / 2, gl / 2 + cy), wh, rise, lk, ov=0.8)
    # attached front spire
    b.section('spire')
    sw = U.clamp(min(gw, gl) * 0.2, 3.0, 7.0)
    sy = -gl / 2 - sw * 0.3 + cy
    th = U.clamp(H * 1.5, wh + 3, 40)
    bxc(b, 0.0, sy, 0, sw, sw, th, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 6.0)
    zt = th
    if b.detail == 0:
        for k in range(3):
            zz = th * (0.22 + 0.25 * k)
            bxc(b, 0.0, sy, zz, sw + 0.3, sw + 0.3, 0.25, 'plain-render', D['trim'])
        # narrow window slits
        b.face([(-sw * 0.1, sy - sw / 2 - 0.03, th * 0.35), (sw * 0.1, sy - sw / 2 - 0.03, th * 0.35), (sw * 0.1, sy - sw / 2 - 0.03, th * 0.75), (-sw * 0.1, sy - sw / 2 - 0.03, th * 0.75)], 'glass-punched', '#d6dade')
        door_front(b, lk, D, 0.0, sy - sw / 2, 0.0, sw * 0.4, 3.2, arch=False)
    ph = sw * 2.4
    U.frustum(b, 0.0, sy, zt, zt + ph, sw + 0.3, sw + 0.3, 0.12, 0.12, D['rslot'] if D['rslot'] != 'clay-tile' else 'metal-roof', lk.roof_col if not D['spire'] else shade(wc, 0.95), top=False,
              scale=1.0 if b.detail == 0 else 5.0)
    # gilded figure on the top
    if D['statue'] and b.detail < 2:
        zf = zt + ph - 0.1
        lib.cylinder(b, 0.0, sy, zf, zf + 1.1, 0.16, n=5, slot='plain', col=GOLD, r_top=0.1)
        U.revolve(b, 0.0, sy, zf + 1.0, [(0.25, 0), (0.3, 0.4), (0.18, 0.8), (0.1, 1.0), (0.0, 1.15)], 6, 'metal-roof', GOLD, smooth=True, cap=False)
    ext = [-gw / 2, sy - sw / 2, gw / 2, gl / 2 + cy]
    steps_at(b, lk, D, 0.0, sy - sw / 2, sw * 1.2, 0.5, 3, 1.5)
    return tuple(ext)


# ================================================================================================================ cross / monastery / rotunda
def build_cross(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    arm_w = U.clamp(min(W, Dp) * 0.55, 3, 14)
    fp = lib.fp_cross(W, Dp, arm_w, arm_w)
    wh = U.clamp(H * 0.52, 2.8, 9.0)
    ws, wc = D['wslot'], D['wall']
    b.section('walls')
    lib.walls(b, fp, 0, wh, 1, lk, kind='none' if (b.detail >= 1 or D['windows'] == 'none') else D['windows'], ratio=D['ratio'], plinth=0.5, rear='same', bay=3.2,
              wall_slot=ws, wall_col=wc)
    b.section('roof')
    ridge = max(1.3, min(arm_w / 2 * 0.75, H - wh) if H > wh else arm_w / 2 * 0.6)
    lk.roof_slot, lk.roof_col = D['rslot'], D['rcol']
    lib.roof(b, 'gable', fp, wh, lk, rise=ridge, ov=0.3)
    # drum and cap over the centre
    b.section('dome')
    R = U.clamp(arm_w * 0.46, 1.2, 6.0)
    dh = U.clamp(H - wh - ridge * 0.6, R * 0.8, R * 2.0)
    zd = wh + ridge * 0.55
    n = 12 if b.detail == 0 else 8
    conical = U.has_word(D['txt'], 'conical', 'cone') or r[1] < 0.5
    lib.cylinder(b, 0.0, 0.0, zd - 0.4, zd + dh, R, n=n, slot=ws, col=wc, top=False, smooth=False)
    if b.detail == 0:
        for k in range(n // 2):
            a = TAU * (k + 0.5) / (n // 2)
            ca, sa = math.cos(a), math.sin(a)
            pts = [(R * 0.97 * ca - 0.12 * sa, R * 0.97 * sa + 0.12 * ca, zd + dh * 0.25), (R * 0.97 * ca + 0.12 * sa, R * 0.97 * sa - 0.12 * ca, zd + dh * 0.25),
                   (R * 0.97 * ca + 0.12 * sa, R * 0.97 * sa - 0.12 * ca, zd + dh * 0.78), (R * 0.97 * ca - 0.12 * sa, R * 0.97 * sa + 0.12 * ca, zd + dh * 0.78)]
            b.face(pts, 'glass-punched', '#3a3f45')
    if conical:
        lib.cylinder(b, 0.0, 0.0, zd + dh, zd + dh + R * 1.5, R * 1.08, n=n, slot=D['rslot'], col=D['rcol'], r_top=0.06, top=False, smooth=False)
        top = zd + dh + R * 1.5
    else:
        U.dome(b, 0.0, 0.0, zd + dh, R, R * 0.95, 'hemi', D['rslot'], D['rcol'], n=U.nn(b, 16), rings=5 if b.detail == 0 else 3)
        top = zd + dh + R * 0.95
    cross(b, D, 0.0, 0.0, top - 0.05, min(1.8, R * 0.6))
    ext = [-W / 2 - 0.5, -Dp / 2 - 0.5, W / 2 + 0.5, Dp / 2 + 0.5]
    if D['bell'] and b.detail < 2:
        tw = U.clamp(arm_w * 0.3, 1.4, 3.0)
        sq_tower(b, lk, D, W / 2 + tw * 0.8 + 0.8, -Dp / 2 + tw, 0.0, tw, wh * 1.3, cap='pyramid')
        ext[2] = W / 2 + tw * 1.6 + 1.2
    steps_at(b, lk, D, 0.0, -Dp / 2, 2.0, 0.3, 2, 0.8)
    return tuple(ext)


def build_monastery(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    fpk = D['F']['fp']
    ws, wc = D['wslot'], D['wall']
    arm = U.clamp(min(W, Dp) * 0.2, 4.0, 9.0)
    if fpk == 'ring':
        fp = lib.fp_ring(W, Dp, W - 2 * arm, Dp - 2 * arm)
    elif fpk == 'L':
        fp = lib.fp_L(W, Dp - arm, arm, Dp, 'right') if False else lib.fp_L(W, Dp * 0.62, arm, Dp * 0.38 + 1.0, 'right')
    elif fpk == 'H':
        fp = lib.fp_H(W, Dp, Dp * 0.35, arm)
    else:
        fp = lib.fp_U(W, Dp * 0.4, arm, Dp * 0.6, 'front')
    cx_off = 0.0
    wh = U.clamp(H * 0.62, 3.2, 8.0)
    b.section('ranges')
    lib.walls(b, fp, 0, wh, 2 if wh > 5.4 else 1, lk, kind='punched' if D['windows'] in ('none', 'arched', 'pointed-arch') else D['windows'], ratio=0.2, plinth=0.4, rear='same',
              bay=3.4 + 1.2 * D['lean'], wall_slot=ws, wall_col=wc)
    lk.roof_slot, lk.roof_col = D['rslot'], D['rcol']
    lib.roof(b, 'hip', fp, wh, lk, rise=max(1.5, (H - wh) * 0.85), ov=0.5)
    # church in the court
    b.section('church')
    x0, y0, x1, y1 = fp.bbox
    cw = U.clamp(arm * 1.15, 3.5, 8.0)
    cl = U.clamp(Dp * 0.46, 6, 18)
    cyc = (y0 + y1) / 2 + (0 if fpk != 'U' else -Dp * 0.06)
    if fpk == 'U':
        cyc = y1 - arm - cl / 2 - 0.6
    ch_h = U.clamp(wh * 1.1, 4.0, 10.0)
    ridge = max(1.4, cw / 2 * 0.62)
    bxc(b, 0.0, cyc, 0, cw, cl, ch_h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 6.0)
    b.facing([(-cw / 2, cyc - cl / 2, ch_h), (cw / 2, cyc - cl / 2, ch_h), (0, cyc - cl / 2, ch_h + ridge)], (0, -1, 0), ws, wc)
    b.facing([(cw / 2, cyc + cl / 2, ch_h), (-cw / 2, cyc + cl / 2, ch_h), (0, cyc + cl / 2, ch_h + ridge)], (0, 1, 0), ws, wc)
    U.gable_y(b, -cw / 2, cyc - cl / 2, cw / 2, cyc + cl / 2, ch_h, ridge, D['rslot'], D['rcol'], ws, wc, scale=1.5 if b.detail == 0 else 5.0, ov=0.35)
    door_front(b, lk, D, 0.0, cyc - cl / 2, 0.0, 1.4, 2.8)
    if D['dome'] or D['txt'].count('dome'):
        R = cw * 0.34
        lib.cylinder(b, 0.0, cyc + cl * 0.1, ch_h + ridge * 0.4, ch_h + ridge * 0.4 + R * 0.9, R, n=U.nn(b, 12), slot=ws, col=wc, top=False)
        U.dome(b, 0.0, cyc + cl * 0.1, ch_h + ridge * 0.4 + R * 0.9, R, R * 0.9, 'hemi', D['rslot'], D['rcol'], n=U.nn(b, 14), rings=4 if b.detail == 0 else 3)
        cross(b, D, 0.0, cyc + cl * 0.1, ch_h + ridge * 0.4 + R * 1.8 - 0.05, 1.3)
    else:
        cross(b, D, 0.0, cyc - cl / 2, ch_h + ridge - 0.1, 1.2)
    ext = [x0, y0, x1, y1]
    if D['bell'] and b.detail < 3:
        tw = U.clamp(cw * 0.5, 2.0, 4.0)
        sq_tower(b, lk, D, cw / 2 + tw * 0.7 + 0.3, cyc - cl / 2 + tw * 0.6, 0.0, tw, ch_h * 1.4, cap='pyramid')
    if D['fence'] and b.detail < 3:
        ext = [x0 - 0.5, y0 - 0.5, x1 + 0.5, y1 + 0.5]
    return tuple(ext)


def build_rotunda(b, lk, D, srng, bahai=False):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    R = max(2.0, min(W, Dp) / 2)
    ws, wc = D['wslot'], D['wall']
    sides = 9 if bahai else (8 if U.has_word(D['txt'], 'octagon') or r[0] < 0.6 else 6)
    wh = U.clamp(H * (0.5 if bahai else 0.55), 2.8, 18)
    z0 = 0.0
    if bahai or D['steps']:
        b.section('podium')
        pr = R * 1.35
        for k in range(2 if bahai else 1):
            pts = [(pr * math.cos(TAU * i / sides + math.pi / sides) * (1 - 0.1 * k), pr * math.sin(TAU * i / sides + math.pi / sides) * (1 - 0.1 * k)) for i in range(sides)]
            h_ = 0.45
            lib.prism(b, pts, z0, z0 + h_, 'stone-blocks', shade(lk.stone_col, 0.95), top=True, top_slot='paving', top_col=lk.stone_col, scale=1.0 if b.detail == 0 else 5.0)
            z0 += h_
    b.section('walls')
    fp = lib.fp_round(R * 0.95, sides)
    # rotate so that a flat faces the front (-Y): fp_round starts at angle 0; rebuild polygon manually
    pts = [(R * 0.95 * math.cos(TAU * i / sides + math.pi / sides + math.pi / 2), R * 0.95 * math.sin(TAU * i / sides + math.pi / sides + math.pi / 2)) for i in range(sides)]
    fp = lib.fp_polygon(pts)
    for seg in fp.edges():
        if bahai and b.detail < 2:
            U.arch_openings(b, seg, lk, z0, z0 + wh, 1, 'arch', ow=seg.length * 0.55, oh=wh * 0.8, depth=0.7, col=wc, slot=ws, sill=0.0, crown_gap=0.4)
        else:
            lib.facade(b, seg, z0, z0 + wh, 1, lk, 'none' if (b.detail >= 1 or D['windows'] == 'none') else D['windows'], 0.2, None, 2.6, wall_slot=ws, wall_col=wc)
    if b.detail == 0:
        lib.cornice(b, fp, z0 + wh - 0.4, 0.35, 0.4, lk, D['trim'])
    b.section('roof')
    if bahai:
        top = z0 + wh
        lib.cap(b, fp.polys, top, True, 'roof-flat', shade(wc, 0.92))
        dh = max(H - wh - 0.5, R * 0.6)
        Rd = R * 0.62
        U.dome(b, 0.0, 0.0, top, Rd, dh, 'shallow' if r[1] < 0.5 else 'hemi', D['rslot'], D['rcol'], n=sides * 3 if b.detail == 0 else sides * 2, rings=6 if b.detail == 0 else 3,
               flute=(sides, 0.03) if b.detail == 0 else None)
        U.finial(b, 0.0, 0.0, top + dh * (0.6 if r[1] < 0.5 else 1.0) - 0.1, max(1.0, R * 0.22), GOLD, balls=1, r=0.25)
    else:
        rise = max(1.8, H - wh)
        lib.cylinder(b, 0.0, 0.0, z0 + wh - 0.3, z0 + wh + rise, R * 1.0 + 0.5, n=sides if b.detail < 2 else min(sides, 6), slot=D['rslot'], col=D['rcol'], r_top=0.05, top=False, smooth=False)
        cross(b, D, 0.0, 0.0, z0 + wh + rise - 0.1, 1.4)
    steps_at(b, lk, D, 0.0, -R * (1.35 if (bahai or D['steps']) else 0.95), R * 0.5 if bahai else 2.0, 0.45 if bahai else 0.3, 2, 1.0)
    e = R * 1.4 + 1.0
    return (-e, -e, e, e)


# ================================================================================================================ synagogue
def build_synagogue(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    gw, gl = W, Dp
    ws, wc = D['wslot'], D['wall']
    moorish = U.has_word(D['txt'], 'moorish', 'sephardic', 'horseshoe') or (D['onion'] and r[0] < 0.7)
    wh = U.clamp(H * (0.68 if D['dome'] else 0.86), 4.0, 16.0)
    fp = lib.fp_rect(gw, gl, 0, 0)
    b.section('hall')
    shape = 'pointed' if D['windows'] == 'pointed-arch' else ('rect' if D['windows'] == 'punched' else 'arch')
    for seg in fp.edges():
        n_ = max(2, round(seg.length / (4.4 + 1.4 * D['lean'])))
        if (seg.front and (D['pedim'] or moorish)) or seg.rear:
            lib.facade(b, seg, 0, wh, 1, lk, 'none', 0.2, None, None, wall_slot=ws, wall_col=wc)
        else:
            U.arch_openings(b, seg, lk, 0, wh, n_, shape, ow=min(1.7, seg.length / n_ * 0.4), oh=wh * 0.68, depth=0.35, col=wc, slot=ws, sill=wh * 0.2, crown_gap=0.7)
    # a raised central bay on the front with a pediment, framed by pilasters
    if not moorish and D['F']['roof'] != 'gable' and b.detail < 2:
        pw0 = gw * 0.34
        pts = [(-pw0 / 2, -gl / 2 - 0.02, wh), (pw0 / 2, -gl / 2 - 0.02, wh), (pw0 / 2, -gl / 2 - 0.02, wh + 0.8), (0, -gl / 2 - 0.02, wh + 0.8 + pw0 * 0.18), (-pw0 / 2, -gl / 2 - 0.02, wh + 0.8)]
        b.facing(pts, (0, -1, 0), ws, wc)
        for sx in (-1, 1):
            lib.seg_box(b, lib.Seg((-gw / 2, -gl / 2), (gw / 2, -gl / 2)), gw / 2 + sx * pw0 / 2 - 0.3, gw / 2 + sx * pw0 / 2 + 0.3, 0.4, wh, 0.25, D['trim'], 'plain-render')
    if b.detail == 0:
        lib.sweep(b, fp, 0, [(0.07, 0), (0.07, 0.6), (0, 0.6)], ws, shade(wc, 0.85))
        lib.cornice(b, fp, wh - 0.5, 0.45, 0.5, lk, D['trim'])
    # front: portico with columns and pediment, or a Moorish screen with twin towers
    b.section('front')
    roof = D['F']['roof']
    ridge = max(1.6, gw * 0.14) if roof in ('gable', 'hip') else 0.0
    dw = U.clamp(gw * 0.12, 1.8, 3.2)
    if moorish:
        # horseshoe arch door and a wide central window; two octagonal towers with domes
        U.arch_openings(b, lib.Seg((-gw / 2, -gl / 2), (gw / 2, -gl / 2)), lk, 0, wh, 1, 'arch', ow=gw * 0.18, oh=wh * 0.6, depth=0.8, col=wc, slot=ws, sill=0.0, crown_gap=0.5)
        tw = U.clamp(gw * 0.16, 2.6, 5.5)
        for sx in (-1, 1):
            tx = sx * (gw / 2 - tw * 0.5)
            th = wh * 1.28
            lib.cylinder(b, tx, -gl / 2, 0, th, tw / 2 + 0.2, n=8 if b.detail < 2 else 6, slot=ws, col=wc, top=False, smooth=False)
            if b.detail == 0:
                lib.cylinder(b, tx, -gl / 2, th - 0.3, th + 0.1, tw / 2 + 0.5, n=8, slot='plain-render', col=D['trim'], top=True)
                b.face([(tx - 0.4, -gl / 2 - tw / 2 - 0.25, th * 0.55), (tx + 0.4, -gl / 2 - tw / 2 - 0.25, th * 0.55), (tx + 0.4, -gl / 2 - tw / 2 - 0.25, th * 0.8), (tx, -gl / 2 - tw / 2 - 0.25, th * 0.88),
                        (tx - 0.4, -gl / 2 - tw / 2 - 0.25, th * 0.8)], 'glass-punched', '#3a3f45') if False else None
            U.dome(b, tx, -gl / 2, th, tw / 2 + 0.3, tw * 0.85, 'onion', D['rslot'], D['rcol'], n=U.nn(b, 12), rings=5 if b.detail == 0 else 3)
        rose(b, D, 0.0, -gl / 2, wh * 0.82, min(gw * 0.07, 1.4))
    else:
        if D['pedim'] and b.detail < 2:
            lib.portico(b, 0.0, -gl / 2, 0.0, U.clamp(gw * 0.5, 4, 14), min(3.4, gl * 0.2), wh * 0.78, lk, cols=4, pediment=True, steps_n=0, rise=min(gw * 0.07, 1.8))
        else:
            door_front(b, lk, D, 0.0, -gl / 2, 0.0, dw, min(wh * 0.5, 3.4))
        if b.detail < 2:
            U.hexagram(b, 0.0, -gl / 2 - 0.05 - (min(3.4, gl * 0.2) if D['pedim'] else 0), wh * 0.9 if not D['pedim'] else wh * 0.96, min(0.8, gw * 0.04), GOLD)
    # roof
    b.section('roof')
    zc = wh
    lk.roof_slot, lk.roof_col = D['rslot'], D['rcol']
    rect = (-gw / 2, -gl / 2, gw / 2, gl / 2)
    if roof == 'gable':
        U.gable_y(b, -gw / 2, -gl / 2, gw / 2, gl / 2, wh, ridge, D['rslot'], D['rcol'], ws, wc, scale=1.5 if b.detail == 0 else 5.0, ov=0.4)
    elif roof == 'hip':
        lib.hip(b, rect, wh, max(1.5, H - wh), lk, ov=0.6)
    else:
        lib.cap(b, fp.polys, wh, True, 'roof-flat', mix(wc, '#8c8c88', 0.5), scale=4.0)
        lib.parapet(b, fp, wh, 0.8, 0.3, lk, ws, D['trim'])
    if D['dome']:
        R = U.clamp(min(gw, gl) * 0.26, 2.0, 8.0)
        cy_d = gl * 0.04
        dh = R * 0.55
        zb = wh + (ridge * 0.0 if roof not in ('gable', 'hip') else 0.0)
        lib.cylinder(b, 0.0, cy_d, zb, zb + dh, R, n=U.nn(b, 16), slot=ws, col=wc, top=False)
        if b.detail == 0:
            for k in range(8):
                a = TAU * (k + 0.5) / 8
                ca, sa = math.cos(a), math.sin(a)
                pts = [(R * 0.97 * ca - 0.16 * sa, cy_d + R * 0.97 * sa + 0.16 * ca, zb + dh * 0.2), (R * 0.97 * ca + 0.16 * sa, cy_d + R * 0.97 * sa - 0.16 * ca, zb + dh * 0.2),
                       (R * 0.97 * ca + 0.16 * sa, cy_d + R * 0.97 * sa - 0.16 * ca, zb + dh * 0.8), (R * 0.97 * ca - 0.16 * sa, cy_d + R * 0.97 * sa + 0.16 * ca, zb + dh * 0.8)]
                b.face(pts, 'glass-punched', '#e0e4e6')
        U.dome(b, 0.0, cy_d, zb + dh, R, R * 0.95, 'hemi', D['rslot'], D['rcol'], n=U.nn(b, 20), rings=6 if b.detail == 0 else 3)
        U.finial(b, 0.0, cy_d, zb + dh + R * 0.93, max(0.8, R * 0.3), GOLD, balls=1, r=0.2)
    if D['relief'] and b.detail < 2 and not moorish:
        # Art Deco fins on the front
        n = int(gw / 1.8)
        for k in range(n):
            u = (k + 0.5) * gw / n
            lib.seg_box(b, lib.Seg((-gw / 2, -gl / 2), (gw / 2, -gl / 2)), u - 0.2, u + 0.2, 0.0, wh + 0.7, 0.3, D['trim'], 'plain-render')
    ext = [-gw / 2 - 0.5, -gl / 2 - (3.4 if D['pedim'] else 0.5), gw / 2 + 0.5, gl / 2 + 0.5]
    steps_at(b, lk, D, 0.0, ext[1] + 0.2, U.clamp(gw * 0.4, 3, 9), 0.6, 3, 1.5)
    return tuple(ext)


# ================================================================================================================ tombs
def build_tomb(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    st, txt = D['st'], D['txt']
    ws, wc = D['wslot'], D['wall']
    mud = st in ('hausa-arewa', 'sahelian') or D['wall_mat'] in ('mud-render', 'laterite')
    imam = st == 'persian' or U.has_word(txt, 'imamzadeh')
    mughal = st == 'mughal' or U.has_word(txt, 'sufi', 'dargah', 'marble')
    turbe = U.has_word(txt, 'turbe', 'ottoman') or st == 'ottoman'
    mound = U.has_word(txt, 'tomb mound', 'korean', 'goguryeo') or st == 'east-asian'
    roman = U.has_word(txt, 'roman', 'mausoleum') and not mughal and not imam
    hip = D['F']['roof'] == 'hip'
    sub = 'mud' if mud else ('imam' if imam else ('mughal' if mughal else ('turbe' if turbe else ('mound' if mound else ('block' if roman and not D['dome'] else 'qubba')))))
    if hip and mud:
        sub = 'hip'
    s = U.clamp(min(W, Dp) * (0.5 if D['fence'] or D['court'] else 0.8), 3.5, 20)
    if imam:
        s = U.clamp(min(W, Dp) * 0.5, 5, 14)
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    cy = Dp * 0.1
    b.section('tomb')
    if sub == 'mound':
        # grassy mound, a stone stair, a hall in front of it
        R = min(W, Dp) * 0.28
        prof = [(R * math.cos(t * math.pi / 2), R * 0.62 * math.sin(t * math.pi / 2)) for t in [k / (6 if b.detail == 0 else 3) for k in range(7 if b.detail == 0 else 4)]]
        U.revolve(b, 0.0, Dp * 0.18, 0.0, prof, 16 if b.detail == 0 else 8, 'grass', '#6d9a4f', smooth=True, scale=2.0, cap=True)
        hw_, hd_ = min(W * 0.34, 14), min(Dp * 0.18, 6)
        hy = -Dp * 0.16
        bxc(b, 0.0, hy, 0, hw_, hd_, 0.9, 'stone-blocks', '#a8a39a', skip=('bottom',), top_slot='paving', top_col='#b8b4aa', scale=1.0 if b.detail == 0 else 5.0)
        bxc(b, 0.0, hy, 0.9, hw_ - 1.4, hd_ - 1.4, 3.0, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        U.curved_hip(b, D, 0.0, hy, 3.9, hw_ - 1.4, hd_ - 1.4, 2.4, 1.5, 0.6, D['rslot'], D['rcol'], D['accent'])
        steps_at(b, lk, D, 0.0, hy - hd_, 3.0, 0.9, 4, 2.0)
        ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    elif sub == 'imam':
        # brick cube, a tall drum and a turquoise bulbous dome, an iwan on the front
        h = U.clamp(H * 0.45, 3.5, 9)
        bxc(b, 0.0, cy, 0, s, s, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        seg = lib.Seg((-s / 2, cy - s / 2), (s / 2, cy - s / 2))
        U.arch_openings(b, seg, lk, 0, h, 1, 'pointed', ow=s * 0.4, oh=h * 0.78, depth=0.8, col=wc, slot=ws, sill=0.0, crown_gap=0.4)
        if b.detail == 0:
            lib.cornice(b, lib.fp_rect(s, s, 0, cy), h - 0.4, 0.3, 0.4, lk, D['trim'])
            lib.cap(b, [[(-s / 2, cy - s / 2), (s / 2, cy - s / 2), (s / 2, cy + s / 2), (-s / 2, cy + s / 2)]], h, True, 'roof-flat', shade(wc, 0.9))
        else:
            lib.cap(b, [[(-s / 2, cy - s / 2), (s / 2, cy - s / 2), (s / 2, cy + s / 2), (-s / 2, cy + s / 2)]], h, True, 'roof-flat', shade(wc, 0.9))
        R = s * 0.36
        dh = max(H - h, R * 1.8) * 0.4
        dcol = D['rcol'] if (U.greenish(D['rcol']) or lib.rgb(D['rcol'])[2] > lib.rgb(D['rcol'])[0]) else '#2f9aa8'
        lib.cylinder(b, 0.0, cy, h, h + dh, R, n=U.nn(b, 16), slot=ws, col=wc, top=False)
        U.dome(b, 0.0, cy, h + dh, R * 1.0, R * 1.3, 'bulb', 'roof-flat', dcol, n=U.nn(b, 20), rings=6 if b.detail == 0 else 3, flute=(12, 0.012) if b.detail == 0 else None)
        U.finial(b, 0.0, cy, h + dh + R * 1.25, 1.2, GOLD, balls=1, r=0.2)
    elif sub == 'mughal':
        pl = s * 1.25
        bxc(b, 0.0, cy, 0, pl, pl, 0.9, 'stone-blocks', '#e8e2d4', skip=('bottom',), top_slot='paving', top_col='#efe9dc', scale=1.0 if b.detail == 0 else 5.0)
        h = U.clamp(H * 0.45, 3.2, 8)
        bxc(b, 0.0, cy, 0.9, s, s, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        seg = lib.Seg((-s / 2, cy - s / 2), (s / 2, cy - s / 2))
        U.arch_openings(b, seg, lk, 0.9, 0.9 + h, 1, 'pointed', ow=s * 0.3, oh=h * 0.75, depth=0.6, col=wc, slot=ws, sill=0.0, crown_gap=0.4)
        lib.cap(b, [[(-s / 2, cy - s / 2), (s / 2, cy - s / 2), (s / 2, cy + s / 2), (-s / 2, cy + s / 2)]], 0.9 + h, True, 'roof-flat', shade(wc, 0.92))
        R = s * 0.36
        U.dome(b, 0.0, cy, 0.9 + h, R, R * 1.4, 'onion' if r[0] < 0.5 else 'hemi', D['rslot'], D['rcol'], n=U.nn(b, 20), rings=6 if b.detail == 0 else 3)
        U.finial(b, 0.0, cy, 0.9 + h + R * 1.35, 1.0, GOLD, balls=1, r=0.2)
        for sx in (-1, 1):
            for sy in (-1, 1):
                if b.detail < 2:
                    U.dome(b, sx * (s / 2 - 0.7), cy + sy * (s / 2 - 0.7), 0.9 + h, 0.7, 1.0, 'onion', D['rslot'], D['rcol'], n=8, rings=3)
    elif sub == 'turbe':
        h = U.clamp(H * 0.5, 3.0, 8)
        n8 = 8
        R = s * 0.52
        lib.cylinder(b, 0.0, cy, 0, h, R, n=n8, slot=ws, col=wc, top=False, smooth=False)
        if b.detail == 0:
            for k in range(n8):
                a = TAU * (k + 0.5) / n8
                ca, sa = math.cos(a), math.sin(a)
                rr = R * math.cos(math.pi / n8) + 0.03
                pts = [(rr * ca - 0.3 * sa, cy + rr * sa + 0.3 * ca, h * 0.2), (rr * ca + 0.3 * sa, cy + rr * sa - 0.3 * ca, h * 0.2), (rr * ca + 0.3 * sa, cy + rr * sa - 0.3 * ca, h * 0.7),
                       (rr * ca, cy + rr * sa, h * 0.82), (rr * ca - 0.3 * sa, cy + rr * sa + 0.3 * ca, h * 0.7)]
                b.face(pts, 'glass-punched', '#d6dade')
        U.dome(b, 0.0, cy, h, R * 1.02, R * 1.15, 'pointed', D['rslot'], D['rcol'], n=U.nn(b, 16), rings=6 if b.detail == 0 else 3)
        U.finial(b, 0.0, cy, h + R * 1.2, 1.1, GOLD, balls=1, r=0.2)
    elif sub == 'mud' or sub == 'hip':
        h = U.clamp(H * 0.8, 2.6, 7)
        bxc(b, 0.0, cy, 0, s, s * 0.9, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        seg = lib.Seg((-s / 2, cy - s * 0.45), (s / 2, cy - s * 0.45))
        if b.detail < 2:
            U.arch_openings(b, seg, lk, 0, h, 1, 'arch', ow=s * 0.22, oh=h * 0.62, depth=0.4, col=wc, slot=ws, sill=0.0, crown_gap=0.4)
        if sub == 'hip':
            lib.hip(b, (-s / 2, cy - s * 0.45, s / 2, cy + s * 0.45), h, max(1.2, H - h) + 0.6, lk, ov=0.6)
        else:
            lib.cap(b, [[(-s / 2, cy - s * 0.45), (s / 2, cy - s * 0.45), (s / 2, cy + s * 0.45), (-s / 2, cy + s * 0.45)]], h, True, ws, shade(wc, 0.92), scale=4.0)
            lib.parapet(b, lib.fp_rect(s, s * 0.9, 0, cy), h, 0.5, 0.3, lk, ws, shade(wc, 1.03), coping=0.0)
            for sx in (-1, 1):
                for sy in (-1, 1):
                    px, py = sx * (s / 2 - 0.25), cy + sy * (s * 0.45 - 0.25)
                    if b.detail >= 2:
                        U.cone(b, px, py, h + 0.5, h + 1.3, 0.3, 4, 'plain', wc, smooth=False)
                    else:
                        U.revolve(b, px, py, h + 0.5, [(0.32, 0), (0.24, 0.3), (0.15, 0.62), (0.0, 0.95)], 6, ws, wc, smooth=False, cap=False)
        if D['relief'] and b.detail == 0:
            seg2 = lib.Seg((-s / 2, cy - s * 0.45), (s / 2, cy - s * 0.45))
            lib.seg_box(b, seg2, 0, s, h * 0.72, h * 0.72 + 0.5, 0.06, D['accent'], 'plain-render')
    elif sub == 'block':
        h = U.clamp(H * 0.85, 3.5, 9)
        bxc(b, 0.0, cy, 0, s, s, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        seg = lib.Seg((-s / 2, cy - s / 2), (s / 2, cy - s / 2))
        U.arch_openings(b, seg, lk, 0, h, 1, 'arch', ow=s * 0.3, oh=h * 0.66, depth=0.6, col=wc, slot=ws, sill=0.0, crown_gap=0.4)
        if D['F']['roof'] == 'gable':
            U.gable_y(b, -s / 2, cy - s / 2, s / 2, cy + s / 2, h, s * 0.2, D['rslot'], D['rcol'], ws, wc, scale=4.0, ov=0.3)
        else:
            lib.cap(b, [[(-s / 2, cy - s / 2), (s / 2, cy - s / 2), (s / 2, cy + s / 2), (-s / 2, cy + s / 2)]], h, True, 'roof-flat', shade(wc, 0.9))
            if b.detail == 0:
                lib.parapet(b, lib.fp_rect(s, s, 0, cy), h, 0.5, 0.3, lk, ws, D['trim'])
        steps_at(b, lk, D, 0.0, cy - s / 2, s * 0.4, 0.5, 3, 1.5)
    else:   # qubba
        h = U.clamp(H * 0.52, 2.6, 8)
        bxc(b, 0.0, cy, 0, s, s, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        if b.detail < 2:
            seg = lib.Seg((-s / 2, cy - s / 2), (s / 2, cy - s / 2))
            U.arch_openings(b, seg, lk, 0, h, 1, 'pointed' if D['windows'] == 'pointed-arch' else 'arch', ow=s * 0.26, oh=h * 0.66, depth=0.5, col=wc, slot=ws, sill=0.0, crown_gap=0.4)
        if b.detail == 0:
            fpq = lib.fp_rect(s, s, 0, cy)
            lib.cornice(b, fpq, h - 0.4, 0.3, 0.4, lk, D['trim'])
        lib.cap(b, [[(-s / 2, cy - s / 2), (s / 2, cy - s / 2), (s / 2, cy + s / 2), (-s / 2, cy + s / 2)]], h, True, 'roof-flat', shade(wc, 0.92))
        R = s * 0.4
        dh = max(H - h, R * 0.7)
        kind = 'hemi' if r[0] < 0.6 else 'pointed'
        drum_h = R * 0.35 if s > 6 else 0
        if drum_h > 0.2:
            lib.cylinder(b, 0.0, cy, h, h + drum_h, R, n=U.nn(b, 14), slot=ws, col=wc, top=False)
        U.dome(b, 0.0, cy, h + drum_h, R, dh - drum_h if dh > drum_h + 0.5 else R * 0.9, kind, D['rslot'], D['rcol'], n=U.nn(b, 18), rings=6 if b.detail == 0 else 3)
        U.finial(b, 0.0, cy, h + drum_h + (dh - drum_h if dh > drum_h + 0.5 else R * 0.9) - 0.1, max(0.7, R * 0.3), GOLD, balls=1, r=0.2)
        if s > 6 and b.detail < 2:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    U.cone(b, sx * (s / 2 - 0.3), cy + sy * (s / 2 - 0.3), h, h + 1.2, 0.3, 5, ws, wc, smooth=False)
    # grave slabs and minaret hint
    if sub in ('mud', 'hip', 'qubba', 'block') and b.detail == 0 and D['court']:
        for k in range(3):
            bxc(b, -s * 0.9 + k * 1.2, cy - s * 0.9, 0, 0.7, 1.8, 0.25, 'plain-render', '#d0c8b0', skip=('bottom',))
    if D['minaret'] and b.detail < 2:
        bxc(b, s * 0.9 + 1.0, cy + s * 0.2, 0, 1.6, 1.6, H * 1.4, ws, wc, skip=('bottom',))
        U.dome(b, s * 0.9 + 1.0, cy + s * 0.2, H * 1.4, 0.9, 1.0, 'hemi', D['rslot'], D['rcol'], n=8, rings=3)
    if D['steps'] and sub not in ('mound', 'mughal', 'block'):
        steps_at(b, lk, D, 0.0, cy - s * 0.46, s * 0.35, 0.4, 2, 1.0)
    return tuple(ext)


# ================================================================================================================ pavilions
def build_pavilion(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    st, txt = D['st'], D['txt']
    ws, wc = D['wslot'], D['wall']
    ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
    east = st == 'east-asian' or U.has_word(txt, 'tin hau', 'temple', 'shinto', 'torii')
    shinto = U.has_word(txt, 'shinto', 'torii', 'haiden', 'jinja')
    fuji = U.has_word(txt, 'fuji')
    dega = U.has_word(txt, 'dega', 'pent roof', 'nepal')
    kramat = U.has_word(txt, 'kramat', 'keramat', 'hilltop')
    thatch = D['wall_mat'] == 'mud-render' and U.has_word(txt, 'thatch', 'orisha', 'oshun') or U.has_word(txt, 'thatch')
    lean = 'lean' in D['F']['variant'] or U.has_word(txt, 'lean-to') or D['F']['roof'] == 'shed'
    pyr = D['F']['roof'] == 'pyramidal' and not dega
    b.section('shrine')
    if fuji:
        R = min(W, Dp) * 0.38
        prof = [(R * math.cos(t * math.pi / 2) ** 0.8, R * 0.5 * math.sin(t * math.pi / 2)) for t in [k / (6 if b.detail == 0 else 3) for k in range(7 if b.detail == 0 else 4)]]
        U.revolve(b, 0.0, Dp * 0.12, 0.0, prof, 16 if b.detail == 0 else 8, 'grass', '#6d9a4f', smooth=True, scale=2.0)
        lib.steps(b, -1.0, 1.0, -Dp * 0.18, R * 0.46, R * 0.9, 6 if b.detail == 0 else 3, 'stone-blocks', '#9a968c')
        U.curved_hip(b, D, 0.0, Dp * 0.12, R * 0.5, 1.6, 1.2, 1.0, 0.4, 0.2, D['rslot'], D['rcol'], D['accent']) if False else None
        # a small stone shrine on the summit
        bxc(b, 0.0, Dp * 0.12, R * 0.5, 1.2, 1.0, 0.9, 'stone-blocks', '#8a8780', skip=('bottom',))
        ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
        U.hexagram  # no-op reference
        _torii_small(b, D, 0.0, -Dp * 0.36, 3.2, 3.0)
        return tuple(ext)
    if east and not dega and not kramat and not lean and not thatch:
        # small hall with a curved gable roof (Tin Hau / Chinese village temple) or a Shinto haiden
        hw = U.clamp(W * 0.8, 3.5, 16)
        hd = U.clamp(Dp * 0.8, 3.0, 14)
        cy = Dp * 0.06
        plat = 0.45
        bxc(b, 0.0, cy, 0, hw + 1.0, hd + 1.0, plat, 'stone-blocks', '#a8a39a', skip=('bottom',), top_slot='paving', top_col='#b8b4aa', scale=1.0 if b.detail == 0 else 5.0)
        wh = U.clamp(H * 0.55, 2.6, 6.0)
        col = D['accent'] if not shinto else '#b5342a'
        bxc(b, 0.0, cy, plat, hw, hd, wh, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        door_front(b, lk, D, 0.0, cy - hd / 2, plat, hw * 0.28, wh * 0.78, col=col, arch=False)
        if b.detail < 2:
            for sx in (-1, 1):
                for off in (0.0,):
                    lib.cylinder(b, sx * (hw / 2 - 0.1), cy - hd / 2 - 0.55, plat, plat + wh, 0.2, n=6 if b.detail == 0 else 4, slot='timber', col=col, top=False, smooth=False)
            lib.beam(b, (-hw / 2 + 0.1, cy - hd / 2 - 0.55), (hw / 2 - 0.1, cy - hd / 2 - 0.55), plat + wh - 0.4, plat + wh, 0.4, 'timber', shade(col, 0.9))
        if D['relief'] and b.detail == 0:
            lib.seg_box(b, lib.Seg((-hw / 2, cy - hd / 2), (hw / 2, cy - hd / 2)), 0, hw, plat + wh * 0.82, plat + wh * 0.82 + 0.5, 0.06, D['accent'], 'plain-render')
        rise = max(1.5, H - wh - plat)
        _curved_gable(b, D, 0.0, cy, plat + wh, hw + 0.8, hd + 0.8, rise, 1.1, 0.5 if not shinto else 0.25, D['rslot'], D['rcol'], col)
        if D['pagoda'] >= 2 and b.detail < 2:
            pass
        steps_at(b, lk, D, 0.0, cy - hd / 2 - 1.2, hw * 0.4, plat, 2, 1.0)
        if D['gate'] and shinto and b.detail < 2:
            _torii_small(b, D, 0.0, -Dp * 0.44, 3.4, 3.2)
        ext = [-W / 2, -Dp / 2, W / 2, Dp / 2]
        return tuple(ext)
    if dega:
        # Nepalese brick shrine with a pent tiled roof, steps and a brass figure
        w_, d_ = U.clamp(W * 0.8, 2.5, 8), U.clamp(Dp * 0.8, 2.5, 6)
        bxc(b, 0.0, 0.0, 0, w_ + 0.6, d_ + 0.6, 0.35, 'stone-blocks', '#a8a39a', skip=('bottom',), top_slot='paving', top_col='#b8b4aa')
        h = U.clamp(H * 0.7, 2.0, 4.5)
        bxc(b, 0.0, 0.0, 0.35, w_, d_, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        if b.detail < 2:
            b.face([(-w_ * 0.18, -d_ / 2 - 0.03, 0.35), (w_ * 0.18, -d_ / 2 - 0.03, 0.35), (w_ * 0.18, -d_ / 2 - 0.03, 0.35 + h * 0.7), (-w_ * 0.18, -d_ / 2 - 0.03, 0.35 + h * 0.7)], 'glass-punched', '#d6dade')
        lib.hip(b, (-w_ / 2, -d_ / 2, w_ / 2, d_ / 2), 0.35 + h, 1.1, lk, ov=0.7)
        if b.detail < 2 and D['statue']:
            lib.cylinder(b, 0.0, -d_ / 2 - 0.6, 0.35, 1.1, 0.18, n=6, slot='plain', col=GOLD, r_top=0.12)
        lib.steps(b, -w_ * 0.2, w_ * 0.2, -d_ / 2 - 0.3, 0.3, 0.9, 2, 'paving', '#b8b4aa')
        return tuple([-W / 2, -Dp / 2, W / 2, Dp / 2])
    if thatch:
        R = U.clamp(min(W, Dp) * 0.35, 1.6, 5.0)
        lib.cylinder(b, 0.0, 0.0, 0, H * 0.45, R, n=U.nn(b, 14), slot=ws, col=wc, top=False)
        lib.cylinder(b, 0.0, 0.0, H * 0.4, H, R * 1.45, n=U.nn(b, 14), slot='timber', col='#b79a5a', r_top=0.12, top=False, smooth=False)
        if b.detail < 2:
            b.face([(-0.45, -R - 0.03, 0.0), (0.45, -R - 0.03, 0.0), (0.45, -R - 0.03, 1.5), (-0.45, -R - 0.03, 1.5)], 'glass-punched', '#d6dade')
        return tuple([-W / 2, -Dp / 2, W / 2, Dp / 2])
    if kramat:
        # whitewashed little shrines on a stepped terrace under an awning
        w_, d_ = U.clamp(W * 0.8, 3, 10), U.clamp(Dp * 0.8, 3, 8)
        bxc(b, 0.0, 0.0, 0, w_, d_, 0.4, 'stone-blocks', '#c8c2b4', skip=('bottom',), top_slot='paving', top_col='#d0cabc')
        n = 3
        for k in range(n):
            x = -w_ / 3 + k * w_ / 3
            bxc(b, x, d_ * 0.1, 0.4, w_ * 0.2, d_ * 0.36, 1.1 + 0.2 * (k % 2), ws, wc, top_slot='plain-render', top_col=shade(wc, 0.95), skip=('bottom',))
        if b.detail < 2:
            for sx in (-1, 1):
                lib.cylinder(b, sx * (w_ / 2 - 0.3), -d_ / 2 + 0.4, 0.4, 2.6, 0.1, n=5, slot='timber', col='#8a6a48', top=False)
            lib.shed(b, (-w_ / 2, -d_ / 2, w_ / 2, d_ * 0.1), 2.6, 0.6, lk, high='back', ov=0.3, slot=D['rslot'], col=D['rcol'])
        steps_at(b, lk, D, 0.0, -d_ / 2 - 0.2, w_ * 0.4, 0.4, 2, 0.8)
        return tuple([-W / 2, -Dp / 2, W / 2, Dp / 2])
    # lean-to / pyramidal memorial shelter / generic pavilion: posts, a floor, a roof, a bench or altar
    w_, d_ = U.clamp(W, 2.4, 14), U.clamp(Dp, 2.4, 10)
    h = U.clamp(H * 0.7, 2.2, 5.0)
    bxc(b, 0.0, 0.0, 0, w_ + 0.5, d_ + 0.5, 0.25, 'stone-blocks', '#a8a39a', skip=('bottom',), top_slot='paving', top_col='#b8b4aa')
    if pyr and U.has_word(txt, 'memorial', 'prayer flag', 'shelter') or pyr:
        bxc(b, 0.0, 0.0, 0.25, w_ * 0.8, d_ * 0.8, h, ws, wc, skip=('bottom', 'top'), scale=1.0 if b.detail == 0 else 5.0)
        lib.hip(b, (-w_ / 2, -d_ / 2, w_ / 2, d_ / 2), 0.25 + h, max(1.2, H - h), lk, ov=0.5)
        if D['flags'] and b.detail < 2:
            for k, c in enumerate(('#2f6bb0', '#f2efe6', '#b6323a', '#3f9a5a', '#e8c22a')):
                b.face([(-w_ * 0.45 + k * w_ * 0.2, -d_ / 2 - 0.2, 0.25 + h * 0.9), (-w_ * 0.45 + k * w_ * 0.2 + w_ * 0.18, -d_ / 2 - 0.2, 0.25 + h * 0.9),
                        (-w_ * 0.45 + k * w_ * 0.2 + w_ * 0.18, -d_ / 2 - 0.2, 0.25 + h * 0.9 - 0.5), (-w_ * 0.45 + k * w_ * 0.2, -d_ / 2 - 0.2, 0.25 + h * 0.9 - 0.5)], 'plain', c)
        if D['statue'] and b.detail < 2:
            lib.cylinder(b, 0.0, -d_ / 2 - 0.6, 0.25, 1.4, 0.25, n=5, slot='plain', col='#d8d2c2', r_top=0.18)
    else:
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.cylinder(b, sx * (w_ / 2 - 0.15), sy * (d_ / 2 - 0.15), 0.25, h, 0.1, n=5, slot='timber', col='#8a6a48', top=False)
        if lean:
            lib.shed(b, (-w_ / 2, -d_ / 2, w_ / 2, d_ / 2), h, min(1.4, d_ * 0.25), lk, high='back', ov=0.4, slot=D['rslot'], col=D['rcol'])
        else:
            lib.hip(b, (-w_ / 2, -d_ / 2, w_ / 2, d_ / 2), h, 1.2, lk, ov=0.4)
        if b.detail == 0:
            bxc(b, 0.0, d_ * 0.3, 0.25, w_ * 0.6, 0.4, 0.45, 'timber', '#6b4a30', skip=('bottom',))
    return tuple([-W / 2, -Dp / 2, W / 2, Dp / 2])


def _curved_gable(b, D, cx, cy, z, w, l, rise, ov, up, slot, col, trim):
    """Gable roof (ridge along Y) with concave slopes and ends swept up (rows along x, columns along y)."""
    nx = {0: 8, 1: 4, 2: 2}[b.detail]
    ny = {0: 6, 1: 3, 2: 2}[b.detail]
    hw, hl = w / 2 + ov, l / 2 + ov
    top = []
    for i in range(nx + 1):
        x = -hw + 2 * hw * i / nx
        s = abs(x) / hw
        row = []
        for j in range(ny + 1):
            y = -hl + 2 * hl * j / ny
            sy = abs(y) / hl
            zz = z + rise * (1 - s) ** 1.45 + up * (s ** 2) * (sy ** 3)
            row.append((cx + x, cy + y, zz))
        top.append(row)
    b.shared_grid(top, slot, col, smooth=False, scale=1.5)
    if b.detail < 2:
        n = 6 if b.detail == 0 else 3
        for sgn, hint in ((-1, (0, -1, 0)), (1, (0, 1, 0))):
            y = cy + sgn * l / 2
            prof = [(cx + (-w / 2 + w * k / n), y, z + rise * (1 - abs(-w / 2 + w * k / n) / hw) ** 1.45) for k in range(n + 1)]
            poly = [(cx - w / 2, y, z), (cx + w / 2, y, z)] + prof[::-1]
            b.facing(poly, hint, D['wslot'], D['wall'])
        if b.detail == 0:
            lib.box(b, cx - 0.2, cy - l / 2 - ov * 0.5, z + rise - 0.05, cx + 0.2, cy + l / 2 + ov * 0.5, z + rise + 0.45, 'plain-render', shade(col, 0.8), skip=('bottom',))
            for sy_ in (-1, 1):
                lib.box(b, cx - 0.3, cy + sy_ * (l / 2 + ov * 0.5) - 0.2, z + rise + 0.4, cx + 0.3, cy + sy_ * (l / 2 + ov * 0.5) + 0.2, z + rise + 1.0, 'plain-render', shade(col, 0.8), skip=('bottom',))


def _torii_small(b, D, cx, y, w, h):
    col = '#b5342a'
    for sx in (-1, 1):
        lib.cylinder(b, cx + sx * (w / 2 - 0.3), y, 0, h, 0.2, n=6 if b.detail == 0 else 4, slot='timber', col=col, r_top=0.17, top=False, smooth=False)
    lib.box(b, cx - w / 2 - 0.4, y - 0.22, h - 0.3, cx + w / 2 + 0.4, y + 0.22, h + 0.05, 'timber', '#2a2a2a', skip=('bottom',))
    lib.box(b, cx - w / 2 + 0.1, y - 0.12, h - 0.9, cx + w / 2 - 0.1, y + 0.12, h - 0.65, 'timber', col, skip=('bottom',))


# ================================================================================================================ grotto / ruin / hall
def build_grotto(b, lk, D, srng):
    W, Dp, H = D['W'], D['D'], D['H']
    b.section('grotto')
    rock = '#8a867c'
    n = {0: 9, 1: 6, 2: 4}[b.detail]
    for k in range(n):
        ang = math.pi * (0.1 + 0.8 * k / max(1, n - 1))
        cx = -W / 2 * 0.9 * math.cos(ang) * 0.9
        cy = W * 0.05 + (Dp * 0.25) * math.sin(ang)
        rr = (W * 0.3) * (0.7 + 0.5 * srng.random())
        lib.blob(b, cx, cy + Dp * 0.18, H * 0.2, rr, rr * 0.9, H * (0.45 + 0.25 * srng.random()), shade(rock, 0.9 + 0.2 * srng.random()), n=7 if b.detail == 0 else 5, rings=4 if b.detail == 0 else 3, slot='stone-blocks')
    lib.blob(b, 0.0, Dp * 0.3, H * 0.4, W * 0.45, Dp * 0.3, H * 0.6, shade(rock, 1.0), n=8 if b.detail == 0 else 5, rings=4 if b.detail == 0 else 3, slot='stone-blocks')
    if b.detail < 2:
        b.face([(-W * 0.12, Dp * 0.05, 0.1), (W * 0.12, Dp * 0.05, 0.1), (W * 0.12, Dp * 0.05, H * 0.55), (0, Dp * 0.05, H * 0.72), (-W * 0.12, Dp * 0.05, H * 0.55)], 'glass-punched', '#3a3f45')
        if D['statue']:
            lib.cylinder(b, 0.0, Dp * 0.09, 0.1, H * 0.46, 0.18, n=6, slot='plain', col='#f0ece4', r_top=0.12)
            lib.blob(b, 0.0, Dp * 0.09, H * 0.5, 0.17, 0.17, 0.2, '#f0ece4', n=6, rings=3)
    steps_at(b, lk, D, 0.0, -Dp * 0.1, W * 0.5, 0.35, 2, 0.8)
    return tuple([-W / 2 - 0.5, -Dp / 2, W / 2 + 0.5, Dp / 2])


def build_ruin(b, lk, D, srng):
    W, Dp, H = D['W'], D['D'], D['H']
    b.section('ruin')
    gw, gl = (min(W, Dp), max(W, Dp)) if W > Dp else (W, Dp)
    t = 0.7
    ws, wc = D['wslot'], D['wall']
    # broken rubble walls: segments of varying height
    def wall_run(x0, y0, x1, y1):
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(2, int(L / 1.6))
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        for k in range(n):
            if srng.random() < 0.18:
                continue
            h = H * (0.35 + 0.65 * srng.random())
            u0, u1 = L * k / n, L * (k + 1) / n
            cx, cy = x0 + ux * (u0 + u1) / 2, y0 + uy * (u0 + u1) / 2
            lib.obox(b, cx, cy, 0, (u1 - u0) + 0.02, t, h, math.atan2(uy, ux), ws, shade(wc, 0.9 + 0.2 * srng.random()), skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
    wall_run(-gw / 2, -gl / 2, gw / 2, -gl / 2)
    wall_run(gw / 2, -gl / 2, gw / 2, gl / 2)
    wall_run(gw / 2, gl / 2, -gw / 2, gl / 2)
    wall_run(-gw / 2, gl / 2, -gw / 2, -gl / 2)
    if b.detail < 2:
        for k in range(4):
            lib.box(b, -gw * 0.3 + k * gw * 0.2, -gl * 0.1 + srng.random() * gl * 0.3, 0, -gw * 0.3 + k * gw * 0.2 + 0.5, -gl * 0.1 + 0.3 + srng.random() * 0, 0.8, 'stone-blocks', '#8a867c', skip=('bottom',)) if False else None
    return tuple([-W / 2 - 1, -Dp / 2 - 1, W / 2 + 1, Dp / 2 + 1])


def build_hall(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    ws, wc = D['wslot'], D['wall']
    islamic = D['st'] in ('arab-islamic', 'persian', 'ottoman', 'mughal') or U.has_word(D['txt'], 'islamic', 'mosque', 'hosseiniyeh', 'prayer')
    flat = D['F']['roof'] == 'flat' or islamic and D['F']['roof'] not in ('gable', 'hip')
    gw, gl = (W, Dp)
    fpk = D['F']['fp']
    wh = U.clamp(H * (0.88 if not flat else 1.0), 2.8, 10)
    fp = lib.fp_rect(gw, gl, 0, 0) if fpk != 'U' else lib.fp_U(gw, gl * 0.45, gw * 0.3, gl * 0.55, 'front')
    b.section('hall')
    kind = D['windows'] if D['windows'] in ('arched', 'pointed-arch', 'punched', 'none') else 'punched'
    for seg in fp.edges():
        lib.facade(b, seg, 0, wh, 1, lk, kind if not seg.rear else 'none', max(0.15, D['ratio']), None, 3.4 + 1.2 * D['lean'], reduced=(b.detail >= 1 or seg.rear), wall_slot=ws, wall_col=wc)
    if b.detail == 0:
        lib.sweep(b, fp, 0, [(0.06, 0), (0.06, 0.5), (0, 0.5)], ws, shade(wc, 0.85))
    b.section('roof')
    lk.roof_slot, lk.roof_col = D['rslot'], D['rcol']
    if flat:
        lib.cap(b, fp.polys, wh, True, 'roof-flat', mix(wc, '#8c8c88', 0.5), scale=4.0)
        lib.parapet(b, fp, wh, 0.9, 0.3, lk, ws, D['trim'])
        if D['dome'] or (islamic and r[0] < 0.5):
            R = U.clamp(min(gw, gl) * 0.2, 1.4, 5.0)
            lib.cylinder(b, 0.0, gl * 0.1, wh, wh + R * 0.35, R, n=U.nn(b, 14), slot=ws, col=wc, top=False)
            U.dome(b, 0.0, gl * 0.1, wh + R * 0.35, R, R * 0.95, 'hemi', D['rslot'], D['rcol'], n=U.nn(b, 16), rings=5 if b.detail == 0 else 3)
            U.finial(b, 0.0, gl * 0.1, wh + R * 0.35 + R * 0.92, 0.9, GOLD, balls=1, r=0.18)
        if D['flags'] and b.detail < 2:
            for k, c in enumerate(('#b6323a', '#1f6b3a', '#1c1c1c')):
                x = -gw * 0.3 + k * gw * 0.3
                lib.cylinder(b, x, -gl / 2 + 0.3, wh, wh + 3.0, 0.05, n=4, slot='frame', col='#8a8f94', top=False)
                b.face([(x, -gl / 2 + 0.3, wh + 3.0), (x + 1.2, -gl / 2 + 0.3, wh + 2.8), (x + 1.2, -gl / 2 + 0.3, wh + 2.0), (x, -gl / 2 + 0.3, wh + 2.0)], 'plain', c)
    else:
        rise = max(1.3, H - wh) if D['F']['roof'] == 'gable' else max(1.2, (H - wh))
        rect = (-gw / 2, -gl / 2, gw / 2, gl / 2)
        if gw >= gl:
            # long front: ridge along x? keep the gable end at the front: ridge along y
            pass
        lib.roof(b, D['F']['roof'] if D['F']['roof'] in ('gable', 'hip') else 'gable', rect, wh, lk, rise=max(1.3, min(rise, min(gw, gl) / 2 * 0.7)), ov=0.5,
                 axis='y') if D['F']['roof'] != 'hip' else lib.roof(b, 'hip', rect, wh, lk, rise=max(1.3, min(rise, min(gw, gl) / 2 * 0.7)), ov=0.5)
    # entrance and verandah
    dw = U.clamp(gw * 0.12, 1.2, 2.2)
    door_front(b, lk, D, 0.0, -gl / 2, 0.0, dw, min(wh * 0.7, 3.0), arch=islamic)
    if D['arcade'] and b.detail < 2:
        n = max(3, int(gw / 3.2))
        for k in range(n + 1):
            x = -gw / 2 + gw * k / n
            lib.cylinder(b, x, -gl / 2 - 1.4, 0, wh * 0.78, 0.18, n=5 if b.detail == 0 else 4, slot='plain-render', col=D['trim'], top=False)
        lib.beam(b, (-gw / 2, -gl / 2 - 1.4), (gw / 2, -gl / 2 - 1.4), wh * 0.78 - 0.3, wh * 0.78, 0.4, 'plain-render', D['trim'])
        lib.cap(b, [[(-gw / 2, -gl / 2 - 1.5), (gw / 2, -gl / 2 - 1.5), (gw / 2, -gl / 2), (-gw / 2, -gl / 2)]], wh * 0.78 + 0.0, True, 'roof-flat', shade(wc, 0.85)) if False else None
    if 'signage-board' in D['ft'] and b.detail < 2:
        lib.sign_board(b, gw * 0.3, -gl / 2 - 3.0, 0.0, 2.6, 1.0, lk, 0.0, col='#2f5f8a')
    if D['steps'] or True:
        steps_at(b, lk, D, 0.0, -gl / 2 - (1.5 if D['arcade'] else 0.0), dw + 1.2, 0.3, 2, 0.8)
    return tuple([-gw / 2 - 0.5, -gl / 2 - 1.0, gw / 2 + 0.5, gl / 2 + 0.5])


# ================================================================================================================ build
def build(brief, style, rng, detail):
    limit = {0: 18500, 1: 3700, 2: 470}[detail]
    state = rng.getstate()
    for lean in range(0, 5):
        rng.setstate(state)
        b = lib.Builder('shrine', detail)
        lk = lib.look(brief, style, rng)
        D = design(brief, style, rng, lk)
        D['lean'] = lean
        srng = U.sub(rng)
        t = D['type']
        fn = {
            'chapel': lambda: build_chapel(b, lk, D, srng, False), 'orthodox': lambda: build_chapel(b, lk, D, srng, True), 'cross': lambda: build_cross(b, lk, D, srng),
            'monastery': lambda: build_monastery(b, lk, D, srng), 'rotunda': lambda: build_rotunda(b, lk, D, srng), 'bahai': lambda: build_rotunda(b, lk, D, srng, True),
            'lds': lambda: build_lds(b, lk, D, srng), 'synagogue': lambda: build_synagogue(b, lk, D, srng), 'tomb': lambda: build_tomb(b, lk, D, srng),
            'mound': lambda: build_pavilion(b, lk, D, srng), 'pavilion': lambda: build_pavilion(b, lk, D, srng), 'grotto': lambda: build_grotto(b, lk, D, srng),
            'ruin': lambda: build_ruin(b, lk, D, srng), 'hall': lambda: build_hall(b, lk, D, srng)}[t]
        ext = fn()
        _site(b, lk, D, srng, ext, brief)
        if b.tris <= limit:
            break
    return b.objects()


def _site(b, lk, D, srng, ext, brief):
    b.section('site')
    x0, y0, x1, y1 = ext
    big = (x1 - x0) > 12
    gate = D['gate'] or D['fence']
    m = 1.8 if D['fence'] else 1.0
    fx0, fy0, fx1, fy1 = x0 - m, y0 - m, x1 + m, y1 + m
    if D['fence'] and D['type'] not in ('monastery',):
        yard(b, lk, D, fx0, fy0, fx1, fy1, gate_w=2.6 if big else 1.8, h=1.1 if D['type'] not in ('tomb', 'lds') else 1.6)
    fc = (brief.get('setting') or {}).get('forecourt') or 'garden'
    sidem = U.clamp(0.3 * (x1 - x0), 2.5, 6.0)
    front = U.clamp(0.55 * (y1 - y0), 4.5, 9.0) + (4.0 if fc in ('road', 'parking') else 0.0)
    pad = (fx0 - sidem, fy0 - front, fx1 + sidem, fy1 + sidem)
    lib.ground(b, *pad, lk, scale=5.0)
    if D['lean'] >= 2 and fc == 'parking':
        fc = 'plaza'
    U.front_apron(b, lk, srng, fc, pad[0] + 1, pad[2] - 1, fy0 - 0.3, pad[1], lk.tree, tree_h=6.0)
    n = max(2, 5 + int(srng.random() * 3) - 2 * D['lean'])
    U.trees_ring(b, lk, srng, lk.tree, (fx0, fy0, fx1, fy1), pad, n, h=6.5, avoid=[])
