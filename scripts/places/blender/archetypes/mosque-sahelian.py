"""mosque-sahelian: mud-render Sahel mosques in two typologies chosen from the brief (wording, city, style) and one size class:

  hausa   (Kano, Katsina, Sokoto, Zaria): flat-roofed plastered prayer hall, arcaded or windowed front, horn-like zankwaye pinnacles
          at the corners and along the parapet, engaged buttresses, relief bands (zane), a tapering multi-stage minaret with toron
          beams and a crown of pinnacles, walled court with a gate house (zaure)
  djenne  (Mali, Burkina, Niger): massive buttressed front on a raised plinth, three tapering towers crowned with pinnacles/ostrich
          eggs, a rhythm of vertical engaged ribs topped with small pinnacles, rows of projecting toron beams, roof vent chimneys
  village (either typology when small, under about 24 m): one tower, fewer ribs, stepped parapet

Layout (metres): front (court, gate, steps) towards -Y; the prayer hall is at the back (+Y); x = 0 on the axis.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib  # noqa: E402
import _mosque_domed_util as U  # noqa: E402
from lib import mix, shade  # noqa: E402

FEATURES = {'minaret', 'pinnacles', 'toron-beams', 'courtyard', 'arches', 'fence-wall', 'gate', 'buttresses', 'relief-pattern', 'crenellation',
            'steps', 'arcade', 'colonnade', 'mosaic', 'dome'}

WOOD = '#6a4f38'
HAUSA_CITIES = {'kano', 'katsina', 'sokoto', 'zaria', 'maiduguri', 'kaduna', 'bauchi', 'gombe', 'birnin-kebbi', 'gusau', 'dutse', 'damaturu', 'jos',
                'yola', 'abuja', 'minna', 'jalingo', 'lokoja', 'kebbi', 'ilorin', 'makurdi', 'nguru', 'hadejia', 'daura'}
DJENNE_CITIES = {'bamako', 'ouagadougou', 'niamey', 'ndjamena', "n'djamena", 'nouakchott', 'mopti', 'djenne', 'timbuktu', 'agadez', 'gao', 'segou',
                 'bobo-dioulasso', 'khartoum', 'bissau', 'banjul', 'serekunda', 'dakar', 'conakry'}


def warnings(brief, style):
    w = []
    for f in (brief.get('features') or []):
        fid = f.get('id') if isinstance(f, dict) else f
        if fid == 'dome':
            w.append('dome ignored: Sahelian mud mosques are flat-roofed')
    return w


# ================================================================================================================ design
def design(brief, style, rng, lk):
    F = U.form_of(brief)
    ft = U.feats(brief)
    txt = U.text(brief, style)
    city = str((style or {}).get('city', '')).lower()
    r = [rng.random() for _ in range(40)]
    W, Dp, H = F['w'], F['d'], F['h']
    if H <= 0:
        H = 6.0 + 3.0 * max(1, F['storeys'])
    typ = None
    if 'djenn' in F['variant'] or 'sudan' in F['variant']:
        typ = 'djenne'
    elif 'hausa' in F['variant']:
        typ = 'hausa'
    elif U.has_word(txt, 'djenn', 'timbuktu', 'sankor', 'mopti', 'bobo', 'larabanga', 'sudano', 'toucouleur', 'ostrich'):
        typ = 'djenne'
    elif U.has_word(txt, 'hausa', 'zaria', 'gobarau', 'zankwaye', 'emir'):
        typ = 'hausa'
    elif city in HAUSA_CITIES:
        typ = 'hausa'
    elif city in DJENNE_CITIES:
        typ = 'djenne'
    else:
        typ = 'hausa' if r[0] < 0.6 else 'djenne'
    D = {'type': typ, 'r': r, 'ft': ft, 'txt': txt, 'H': H, 'F': F, 'city': city}
    court_default = W >= 30 and typ == 'hausa'
    D['court'] = 'courtyard' in ft or court_default
    D['fence'] = 'fence-wall' in ft or 'gate' in ft or D['court']
    D['gate'] = 'gate' in ft or D['court']
    D['steps'] = 'steps' in ft or typ == 'djenne'
    D['arch'] = 'arches' in ft
    D['arcade'] = 'arcade' in ft or 'colonnade' in ft
    D['toron'] = 'toron-beams' in ft or typ == 'djenne'
    D['pinn'] = 'pinnacles' in ft or True
    D['butt'] = 'buttresses' in ft or typ == 'djenne' or r[1] < 0.5
    D['relief'] = 'relief-pattern' in ft or 'mosaic' in ft
    D['cren'] = 'crenellation' in ft
    D['nmin'] = int(U.clamp(ft['minaret']['count'] or 1, 0, 4)) if 'minaret' in ft else (1 if (not ft or typ == 'djenne') else 0)
    if typ == 'djenne':
        D['nmin'] = max(D['nmin'], 3 if W >= 24 else 1)
    D['min_note'] = ft.get('minaret', {}).get('note', '')
    marg = 2.6 if D['fence'] else 0.0
    sc = U.fit_scale(W + 2 * marg, Dp + 2 * marg)
    D['sc'] = sc
    D['W'], D['D'] = W * sc, Dp * sc
    D['marg'] = marg
    D['village'] = W < 24
    D['wall'], D['wslot'] = lk.wall_col, lk.wall_slot
    if D['wslot'] == 'plain-render' and typ == 'djenne':
        D['wslot'] = 'mud-render'
    D['trim'] = lk.trim_col
    D['accent'] = lk.accent_col
    D['wood'] = WOOD
    D['dcol'] = lk.roof_col
    D['slot'] = 'roof-flat'
    D['bay'] = U.clamp(math.sqrt(D['W'] * D['D']) / 7.0, 4.5, 8.0)
    D['lean'] = 0
    return D


# ================================================================================================================ parts
def zankwaye(b, D, x, y, z, r, h, col=None, n=6):
    """A horn-like pinnacle: slim cone with a slight waist (Hausa zankwaye / Sahelian merlon)."""
    col = col or D['wall']
    d = b.detail
    if d >= 2:
        U.cone(b, x, y, z, z + h, r, 4, 'plain', col, smooth=False)
        return
    if d == 1:
        U.cone(b, x, y, z, z + h, r, 5, D['wslot'], col, smooth=False)
        return
    U.revolve(b, x, y, z, [(r, 0), (r * 0.78, h * 0.3), (r * 0.5, h * 0.62), (r * 0.18, h * 0.9), (0, h)], n, D['wslot'], col, smooth=False, cap=False)


def egg(b, D, x, y, z, r, col=None):
    """An ostrich-egg finial on a short neck (Djenne tower and rib crowns)."""
    col = col or D['wall']
    if b.detail >= 2:
        return
    U.revolve(b, x, y, z, [(r * 0.5, 0), (r * 0.25, r * 0.5), (r * 0.7, r * 1.1), (r * 0.8, r * 1.7), (r * 0.5, r * 2.3), (0, r * 2.6)], 6 if b.detail else 8, D['wslot'], col, smooth=True, cap=False)


def toron_row(b, D, x0, y0, x1, y1, z, count, length=0.55, size=0.16, face='front'):
    """A row of projecting palm-wood beams along a wall run (x0,y0)-(x1,y1) at height z. face: 'front' (-Y) | 'left' | 'right'."""
    if b.detail >= 1 or count <= 0:
        return
    for k in range(count):
        t = (k + 0.5) / count
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        if face == 'front':
            lib.box(b, x - size / 2, y - length, z, x + size / 2, y + 0.05, z + size, 'timber', D['wood'], skip=('bottom', 'back', 'left'))
        elif face == 'left':
            lib.box(b, x - length, y - size / 2, z, x + 0.05, y + size / 2, z + size, 'timber', D['wood'], skip=('bottom', 'right', 'back'))
        else:
            lib.box(b, x - 0.05, y - size / 2, z, x + length, y + size / 2, z + size, 'timber', D['wood'], skip=('bottom', 'left', 'back'))


def tower(b, lk, D, cx, cy, z0, w0, H, taper=0.5, stages=3, top='pinnacles', toron=True, toron_rows=None, win=True):
    """A tapering square tower in stages with ledges, toron beams and a crown. Returns the top z."""
    d = b.detail
    ws, wc = D['wslot'], D['wall']
    if d >= 2:
        U.frustum(b, cx, cy, z0, z0 + H, w0, w0, w0 * taper, w0 * taper, ws, wc, top=True)
        if top in ('pinnacles', 'egg'):
            U.cone(b, cx, cy, z0 + H, z0 + H + max(1.0, w0 * 0.3), w0 * taper * 0.25, 4, 'plain', wc, smooth=False)
        return z0 + H
    stage_h = H / stages
    w = w0
    z = z0
    for k in range(stages):
        w_top = w0 * (1 - (1 - taper) * (k + 1) / stages)
        U.frustum(b, cx, cy, z, z + stage_h, w, w, w_top, w_top, ws, wc, top=False)
        # ledge / cap of the stage
        lw = w_top + 0.34
        if d == 0:
            lib.box_c(b, cx, cy, z + stage_h - 0.18, lw, lw, 0.34, 'plain-render', shade(wc, 0.94))
        else:
            lib.box_c(b, cx, cy, z + stage_h - 0.1, lw, lw, 0.2, ws, wc)
        if d == 0 and toron:
            rows = max(1, (toron_rows if toron_rows else 3) - D['lean'])
            for q in range(rows):
                zz = z + stage_h * (0.2 + 0.7 * q / max(1, rows - 1))
                ww = w + (w_top - w) * ((zz - z) / stage_h)
                n = max(2, int(ww / (1.5 + 0.5 * D['lean'])))
                toron_row(b, D, cx - ww / 2 + ww / (2 * n), cy - ww / 2, cx + ww / 2 - ww / (2 * n), cy - ww / 2, zz, n, face='front')
                toron_row(b, D, cx - ww / 2, cy - ww / 2 + ww / (2 * n), cx - ww / 2, cy + ww / 2 - ww / (2 * n), zz, n, face='left')
                toron_row(b, D, cx + ww / 2, cy - ww / 2 + ww / (2 * n), cx + ww / 2, cy + ww / 2 - ww / (2 * n), zz, n, face='right')
        if d == 0 and win and k < stages:
            wz = z + stage_h * 0.55
            ww = w + (w_top - w) * 0.55
            pw = max(0.35, ww * 0.1)
            b.face([(cx - pw, cy - ww / 2 - 0.03, wz), (cx + pw, cy - ww / 2 - 0.03, wz), (cx + pw, cy - ww / 2 - 0.03, wz + pw * 3.0), (cx, cy - ww / 2 - 0.03, wz + pw * 3.8),
                    (cx - pw, cy - ww / 2 - 0.03, wz + pw * 3.0)], 'glass-punched', '#9aa0a4')
        z += stage_h
        w = w_top
    # crown
    zt = z0 + H
    cw = w0 * taper
    if d == 0:
        lib.box_c(b, cx, cy, zt, cw + 0.3, cw + 0.3, 0.5, ws, shade(wc, 1.04))
    if top == 'pinnacles':
        ph = max(1.1, w0 * 0.34)
        for sx in (-1, 1):
            for sy in (-1, 1):
                zankwaye(b, D, cx + sx * (cw / 2 - 0.1), cy + sy * (cw / 2 - 0.1), zt + (0.5 if d == 0 else 0), max(0.28, cw * 0.14), ph, n=6)
        zankwaye(b, D, cx, cy, zt + (0.5 if d == 0 else 0), max(0.34, cw * 0.18), ph * 1.7, n=6)
    elif top == 'egg':
        zz = zt + (0.5 if d == 0 else 0)
        U.cone(b, cx, cy, zz, zz + max(1.2, cw * 0.9), cw * 0.46, 6 if d == 0 else 5, ws, wc, smooth=False)
        egg(b, D, cx, cy, zz + max(1.2, cw * 0.9) - 0.1, max(0.28, cw * 0.1))
    elif top == 'flat':
        pass
    return zt


def rib(b, D, seg, u, z0, z1, w0, proud, crown=True):
    """An engaged rib/buttress on a wall seg: tapers from w0 x proud at the base to a narrower top, rising to z1 with a pinnacle."""
    wc, ws = D['wall'], D['wslot']
    d = b.detail
    w1 = w0 * 0.62
    p1 = proud * 0.45
    P = lambda uu, zz, dd: seg.P(uu, zz, -dd)
    if d >= 2:
        return
    # front face (tapering), two side faces, top
    b.face([P(u - w0 / 2, z0, proud), P(u + w0 / 2, z0, proud), P(u + w1 / 2, z1, p1), P(u - w1 / 2, z1, p1)], ws, wc, scale=3.0)
    b.facing([P(u + w0 / 2, z0, proud), P(u + w0 / 2, z0, 0), P(u + w1 / 2, z1, 0), P(u + w1 / 2, z1, p1)], (seg.u[0], seg.u[1], 0), ws, shade(wc, 0.92), scale=3.0)
    b.facing([P(u - w0 / 2, z0, proud), P(u - w0 / 2, z0, 0), P(u - w1 / 2, z1, 0), P(u - w1 / 2, z1, p1)], (-seg.u[0], -seg.u[1], 0), ws, shade(wc, 0.92), scale=3.0)
    b.facing([P(u - w1 / 2, z1, p1), P(u + w1 / 2, z1, p1), P(u + w1 / 2, z1, 0), P(u - w1 / 2, z1, 0)], (0, 0, 1), ws, shade(wc, 1.05))
    if crown and d == 0:
        c = seg.P(u, z1, -p1 / 2 + 0.0)
        zankwaye(b, D, c[0] - seg.n[0] * 0.0, c[1], z1, max(0.22, w1 * 0.38), max(0.7, w0 * 0.9), n=6)


def parapet_run(b, lk, D, rect, z, h=0.6, pinn_pitch=3.4, pinn=True, r=0.34, ph=1.1, stepped=False):
    """Parapet wall round a roof with pinnacles at corners and along the edges."""
    x0, y0, x1, y1 = rect
    fp = lib.fp_rect(x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2)
    lib.parapet(b, fp, z, h, 0.32, lk, D['wslot'], shade(D['wall'], 1.02), coping=0.0)
    if not pinn or b.detail >= 2 and False:
        return
    sides = [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
    zc = z + h
    for si, (p, q) in enumerate(sides):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        n = max(1, int(L / pinn_pitch))
        if b.detail == 1:
            n = max(1, n // 2)
        if b.detail == 2:
            n = 1
        for k in range(n + (1 if si == 3 else 0) if False else n):
            t = k / n
            x, y = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t
            big = k == 0
            zankwaye(b, D, x + (0.16 if x <= x0 + 0.01 else (-0.16 if x >= x1 - 0.01 else 0)), y + (0.16 if y <= y0 + 0.01 else (-0.16 if y >= y1 - 0.01 else 0)), zc,
                     r * (1.25 if big else 1.0), ph * (1.35 if big else 1.0))


def relief_band(b, lk, D, rect, z, h=0.9, sides=('front', 'left', 'right')):
    """A band of zane relief: accent strip with raised squares and a knot-like diamond rhythm."""
    if b.detail >= 2:
        return
    x0, y0, x1, y1 = rect
    segs = {'front': lib.Seg((x0, y0), (x1, y0)), 'right': lib.Seg((x1, y0), (x1, y1)), 'left': lib.Seg((x0, y1), (x0, y0))}
    col = D['accent']
    for nm in sides:
        seg = segs[nm]
        lib.seg_box(b, seg, 0, seg.length, z, z + h, 0.05, col, 'plain-render')
        if b.detail == 0:
            n = int(seg.length / 1.1)
            for k in range(n):
                u = (k + 0.5) * seg.length / n
                lib.seg_box(b, seg, u - 0.28, u + 0.28, z + 0.16, z + h - 0.16, 0.1, shade(col, 0.82 if k % 2 else 1.12), 'plain-render')


def small_windows(b, lk, D, seg, z0, z1, n, ow=0.8, oh=1.5, sill=None, shape='arch'):
    U.arch_openings(b, seg, lk, z0, z1, n, shape, ow=ow, oh=oh, depth=0.5, col=D['wall'], slot=D['wslot'], sill=(z1 - z0) * 0.5 if sill is None else sill, crown_gap=0.4)


def gatehouse(b, lk, D, cx, y, z0, w, h, depth=2.6):
    """A low gate house (zaure): block with a round-arched passage and corner pinnacles."""
    ws, wc = D['wslot'], D['wall']
    lib.box(b, cx - w / 2, y - depth / 2, z0, cx + w / 2, y + depth / 2, z0 + h, ws, wc, skip=('bottom', 'front'), top_slot='roof-flat', top_col=shade(wc, 0.95))
    seg = lib.Seg((cx - w / 2, y - depth / 2), (cx + w / 2, y - depth / 2))
    U.arch_openings(b, seg, lk, z0, z0 + h, 1, 'arch', ow=min(w * 0.5, h * 0.8), oh=h * 0.78, depth=depth * 0.5, col=wc, slot=ws, sill=0.0, crown_gap=0.4)
    if b.detail < 2:
        for sx in (-1, 1):
            zankwaye(b, D, cx + sx * (w / 2 - 0.35), y - depth / 2 + 0.35, z0 + h, 0.34, 1.2)


# ================================================================================================================ hausa
def build_hausa(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    court = D['court']
    Wh = W * (0.9 if court else 1.0)
    Dh = Dp * (0.55 + 0.1 * r[2]) if court else Dp - 2.0
    Dh = max(Dh, 9.0)
    hy1 = Dp / 2
    hy0 = hy1 - Dh
    hx0, hx1 = -Wh / 2, Wh / 2
    wh = U.clamp(H * (0.78 if not D['village'] else 0.85), 3.4, 14.0)
    z0 = 0.0
    b.section('hall')
    rect = (hx0, hy0, hx1, hy1)
    ws, wc = D['wslot'], D['wall']
    # front, sides, back: plain mud walls with openings
    front = lib.Seg((hx0, hy0), (hx1, hy0))
    narch = int(U.clamp(round(Wh / (4.2 + 2.0 * r[3])), 2, 9))
    if D['arcade'] or D['arch'] or Wh > 20:
        U.arch_openings(b, front, lk, z0, z0 + wh, narch, 'arch', ow=min(2.6, Wh / narch * 0.5), oh=wh * 0.58, depth=0.9, col=wc, slot=ws,
                        sill=0.0 if D['arcade'] else 1.0, crown_gap=0.9)
    else:
        small_windows(b, lk, D, front, z0, z0 + wh, max(1, narch - 1), 0.9, 1.7, sill=1.2)
    for seg in (lib.Seg((hx1, hy0), (hx1, hy1)), lib.Seg((hx0, hy1), (hx0, hy0))):
        small_windows(b, lk, D, seg, z0, z0 + wh, max(1, round(seg.length / 6.0)), 0.8, 1.5)
    U.plain_wall(b, lib.Seg((hx1, hy1), (hx0, hy1)), z0, z0 + wh, lk, ws, wc)
    if b.detail == 0:
        lib.sweep(b, lib.fp_rect(Wh, Dh, 0, (hy0 + hy1) / 2), z0, [(0.12, 0), (0.1, 0.7), (0, 0.8)], ws, shade(wc, 0.82))
    # buttresses on front and sides
    if D['butt']:
        b.section('buttresses')
        nb = max(2, int(Wh / (3.6 + 1.5 * r[4])))
        for k in range(nb + 1):
            u = Wh * k / nb
            if abs(u - Wh / 2) < 1.1 and narch % 2 == 1:
                continue
            rib(b, D, front, u, z0, z0 + wh + 0.3, 1.2 if Wh > 20 else 0.9, 0.9, crown=True)
        if Wh > 16:
            for seg in (lib.Seg((hx1, hy0), (hx1, hy1)), lib.Seg((hx0, hy1), (hx0, hy0))):
                m = max(1, int(seg.length / 5.0))
                for k in range(1, m):
                    rib(b, D, seg, seg.length * k / m, z0, z0 + wh + 0.3, 1.0, 0.7, crown=True)
    # relief and toron rows
    if D['relief']:
        relief_band(b, lk, D, rect, z0 + wh * 0.72, 0.9)
    if D['toron'] and b.detail == 0:
        n = max(3, int(Wh / 1.8))
        for q in range(2):
            toron_row(b, D, hx0 + 1.0, hy0, hx1 - 1.0, hy0, z0 + wh * (0.78 + 0.1 * q), n, face='front')
    # roof: parapet with pinnacles, stepped raised centre, small roof turrets
    b.section('roof')
    zr = z0 + wh
    lib.cap(b, [[(hx0, hy0), (hx1, hy0), (hx1, hy1), (hx0, hy1)]], zr, True, ws, shade(wc, 0.9), scale=4.0)
    parapet_run(b, lk, D, rect, zr, 0.6, pinn_pitch=3.2 + 1.2 * r[5], r=0.34, ph=0.9 + 0.9 * r[6])
    if Wh > 22:
        # a raised central bay running front to back, with its own parapet
        cw = Wh * 0.34
        rise = 2.2
        lib.box(b, -cw / 2, hy0 + 2.0, zr, cw / 2, hy1 - 0.6, zr + rise, ws, wc, top_slot=ws, top_col=shade(wc, 0.9), skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
        if b.detail < 2:
            for sx in (-1, 1):
                for sy in (hy0 + 2.3, hy1 - 0.9):
                    zankwaye(b, D, sx * (cw / 2 - 0.3), sy, zr + rise, 0.36, 1.3)
    ext = [hx0, hy0, hx1, hy1]
    # court + gate house
    ctrect = None
    if court:
        b.section('court')
        cy0 = -Dp / 2
        cy1 = hy0 - 0.2
        wall_h = 2.4
        x0c, x1c = -W / 2, W / 2
        for (a0, b0, a1, b1) in ((x0c, cy0, x1c, cy0 + 0.5), (x0c, cy0, x0c + 0.5, cy1), (x1c - 0.5, cy0, x1c, cy1)):
            gw = U.clamp(Wh * 0.14, 3.8, 6.5)
            if abs(b1 - b0) < 1 and False:
                pass
            if b1 - b0 <= 0.6:    # front wall: split by the gate
                lib.box(b, a0, b0, 0, -gw / 2, b1, wall_h, ws, wc, skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
                lib.box(b, gw / 2, b0, 0, a1, b1, wall_h, ws, wc, skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
            else:
                lib.box(b, a0, b0, 0, a1, b1, wall_h, ws, wc, skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
        gatehouse(b, lk, D, 0.0, cy0 + 0.25, 0, U.clamp(Wh * 0.14, 3.8, 6.5) + 3.0, 4.6)
        if b.detail < 2:
            for (px, py) in ((x0c + 0.25, cy0 + 0.25), (x1c - 0.25, cy0 + 0.25), (x0c + 0.25, cy1 - 0.25), (x1c - 0.25, cy1 - 0.25)):
                zankwaye(b, D, px, py, wall_h, 0.38, 1.2)
            n = int((x1c - x0c) / 4.0)
            for k in range(1, n):
                x = x0c + (x1c - x0c) * k / n
                if abs(x) > 5:
                    zankwaye(b, D, x, cy0 + 0.25, wall_h, 0.3, 0.9)
        # ground of the court: slightly lighter earth
        if b.detail < 2:
            b.face([(x0c + 0.6, cy0 + 0.6, 0.05), (x1c - 0.6, cy0 + 0.6, 0.05), (x1c - 0.6, cy1, 0.05), (x0c + 0.6, cy1, 0.05)], lk.ground_slot, mix(lk.ground_col, '#e0cfa8', 0.35), scale=3.0)
        ext = [min(ext[0], x0c), cy0, max(ext[2], x1c), ext[3]]
        ctrect = (x0c + 0.5, cy0 + 0.5, x1c - 0.5, cy1)
    else:
        ext[1] = hy0
    # steps to the hall front
    if b.detail < 2 and Wh > 14:
        sw = U.clamp(Wh * 0.22, 3.5, 8)
        lib.steps(b, -sw / 2, sw / 2, hy0, 0.5, 1.4, 2, 'plain-render', shade(wc, 0.85))
    # minarets
    b.section('minarets')
    mh = U.last_metres(D['min_note'], 8, 60)
    hm = U.clamp(mh or (H * 1.45 + 4), wh + 3, 40)
    bw = U.clamp(hm * 0.28, 2.6, 7.0)
    n = D['nmin']
    spots = []
    if n >= 1:
        sx = -1 if r[7] < 0.5 else 1
        spots.append((sx * (Wh / 2 - bw * 0.2 + 0.0), hy0 - bw * 0.1))
    if n >= 2:
        spots.append((-spots[0][0], hy0 - bw * 0.1))
    if n >= 3:
        spots.append((spots[0][0], hy1 - bw * 0.5))
    if n >= 4:
        spots.append((-spots[0][0], hy1 - bw * 0.5))
    for (mx, my) in spots[:n]:
        tower(b, lk, D, mx, my, 0.0, bw, hm, taper=0.5 + 0.1 * r[8], stages=3 if hm > 14 else 2, top='pinnacles', toron=True, toron_rows=3)
        ext[0], ext[2] = min(ext[0], mx - bw), max(ext[2], mx + bw)
    return tuple(ext), ctrect


# ================================================================================================================ djenne
def build_djenne(b, lk, D, srng):
    r = D['r']
    W, Dp, H = D['W'], D['D'], D['H']
    Wh = W
    plinth = 1.8 if W > 24 else 0.9
    Dh = max(Dp - (6.0 if D['court'] else 3.0), 10.0)
    hy1 = Dp / 2
    hy0 = hy1 - Dh
    hx0, hx1 = -Wh / 2, Wh / 2
    wh = U.clamp(H * 0.7, 4.0, 15.0)
    ws, wc = D['wslot'], D['wall']
    z0 = plinth
    b.section('plinth')
    lib.box(b, hx0 - 1.6, hy0 - 2.4, 0, hx1 + 1.6, hy1 + 1.0, plinth, ws, shade(wc, 0.88), skip=('bottom',), top_slot='mud-render', top_col=shade(wc, 0.8),
            scale=1.0 if b.detail == 0 else 6.0)
    b.section('hall')
    rect = (hx0, hy0, hx1, hy1)
    front = lib.Seg((hx0, hy0), (hx1, hy0))
    # front wall: windows between the ribs (few, small)
    nrib = int(U.clamp(round(Wh / (2.4 + 0.8 * r[3] + 0.9 * D['lean'])), 4, 26))
    U.plain_wall(b, front, z0, z0 + wh, lk, ws, wc)
    for seg in (lib.Seg((hx1, hy0), (hx1, hy1)), lib.Seg((hx0, hy1), (hx0, hy0)), lib.Seg((hx1, hy1), (hx0, hy1))):
        U.plain_wall(b, seg, z0, z0 + wh, lk, ws, wc)
    # small dark window slits high on the walls
    if b.detail == 0:
        for k in range(nrib):
            u = Wh * (k + 0.5) / nrib
            if k % 2 == 0:
                continue
            p = front.P(u, z0 + wh * 0.72, 0.0)
            b.face([(p[0] - 0.28, p[1] - 0.04, p[2]), (p[0] + 0.28, p[1] - 0.04, p[2]), (p[0] + 0.28, p[1] - 0.04, p[2] + 1.0), (p[0], p[1] - 0.04, p[2] + 1.3),
                    (p[0] - 0.28, p[1] - 0.04, p[2] + 1.0)], 'glass-punched', '#9aa0a4')
    # ribs across the front, along both sides
    b.section('ribs')
    zr = z0 + wh
    tw = U.clamp(Wh * 0.17, 3.0, 9.0)        # tower width
    tower_x = []
    nt = D['nmin']
    if nt >= 3:
        tower_x = [-Wh * 0.5 + tw * 0.7, 0.0, Wh * 0.5 - tw * 0.7]
    elif nt == 2:
        tower_x = [-Wh * 0.3, Wh * 0.3]
    elif nt == 1:
        tower_x = [0.0]
    for k in range(nrib + 1):
        u = Wh * k / nrib
        x = hx0 + u
        if any(abs(x - tx) < tw * 0.62 for tx in tower_x):
            continue
        rib(b, D, front, u, z0, zr + 1.6, 1.0 if Wh > 20 else 0.8, 0.8, crown=True)
    for seg in (lib.Seg((hx1, hy0), (hx1, hy1)), lib.Seg((hx0, hy1), (hx0, hy0))):
        m = max(2, int(seg.length / (2.9 + 0.9 * D['lean'])))
        for k in range(m + 1):
            rib(b, D, seg, seg.length * k / m, z0, zr + 1.2, 0.9, 0.7, crown=True)
    # toron beam rows across the front
    if b.detail == 0:
        n = max(4, int(Wh / 1.5))
        for q in range(2):
            toron_row(b, D, hx0 + 0.8, hy0, hx1 - 0.8, hy0, z0 + wh * (0.62 + 0.14 * q), n, face='front', length=0.5)
    # roof deck and vent chimneys
    b.section('roof')
    lib.cap(b, [[(hx0, hy0), (hx1, hy0), (hx1, hy1), (hx0, hy1)]], zr, True, ws, shade(wc, 0.88), scale=4.0)
    lib.parapet(b, lib.fp_rect(Wh, Dh, 0, (hy0 + hy1) / 2), zr, 0.5, 0.35, lk, ws, shade(wc, 1.02), coping=0.0)
    if b.detail < 2:
        nx = int(Wh / (7.5 + 2 * D['lean']))
        ny = int(Dh / (7.5 + 2 * D['lean']))
        for i in range(nx):
            for j in range(ny):
                px = hx0 + Wh * (i + 0.5) / nx
                py = hy0 + 3.0 + (Dh - 5.0) * (j + 0.5) / max(1, ny)
                if b.detail == 1 and (i + j) % 2:
                    continue
                U.revolve(b, px, py, zr, [(0.55, 0), (0.4, 0.9), (0.62, 1.1), (0.0, 1.55)], 5 if b.detail else 6, 'plain-render', '#8a5a40', smooth=False, cap=False)
    # towers on the front
    b.section('towers')
    ext = [hx0, hy0 - 0.8, hx1, hy1]
    for i, tx in enumerate(tower_x):
        central = (len(tower_x) == 3 and i == 1) or len(tower_x) == 1
        hh = wh * (1.55 if central else 1.3) + (2.0 if central else 0.0)
        mh = U.last_metres(D['min_note'], 8, 60)
        if mh and central:
            hh = max(wh + 2.0, mh - plinth)
        tower(b, lk, D, tx, hy0 - tw * 0.25, z0, tw * (1.12 if central else 1.0), hh, taper=0.52, stages=3, top='egg', toron=True, toron_rows=4, win=False)
    # steps up the plinth
    if b.detail < 2:
        sw = U.clamp(Wh * 0.35, 4, 12)
        lib.steps(b, -sw / 2, sw / 2, hy0 - 2.4, plinth, 2.2, 4 if plinth > 1 else 2, 'plain-render', shade(wc, 0.85))
    ext[1] = hy0 - 2.4
    ext[0], ext[2] = ext[0] - 1.6, ext[2] + 1.6
    ctrect = None
    if D['court']:
        b.section('court')
        cy0 = -Dp / 2
        cy1 = hy0 - 2.6
        wall_h = 1.8
        if cy1 - cy0 > 2.0:
            x0c, x1c = -W / 2 - 1.6, W / 2 + 1.6
            gw = 4.0
            for (a0, b0, a1, b1) in ((x0c, cy0, -gw / 2, cy0 + 0.45), (gw / 2, cy0, x1c, cy0 + 0.45), (x0c, cy0, x0c + 0.45, cy1), (x1c - 0.45, cy0, x1c, cy1)):
                lib.box(b, a0, b0, 0, a1, b1, wall_h, ws, wc, skip=('bottom',), scale=1.0 if b.detail == 0 else 6.0)
            if b.detail < 2:
                for (px, py) in ((x0c + 0.22, cy0 + 0.22), (x1c - 0.22, cy0 + 0.22), (-gw / 2 - 0.25, cy0 + 0.22), (gw / 2 + 0.25, cy0 + 0.22)):
                    zankwaye(b, D, px, py, wall_h, 0.36, 1.1)
            ext = [min(ext[0], x0c), cy0, max(ext[2], x1c), ext[3]]
            ctrect = (x0c, cy0, x1c, cy1)
    return tuple(ext), ctrect


# ================================================================================================================ build
def build(brief, style, rng, detail):
    limit = {0: 18500, 1: 3700, 2: 470}[detail]
    state = rng.getstate()
    for lean in range(0, 5):
        rng.setstate(state)
        b = lib.Builder('mosque', detail)
        lk = lib.look(brief, style, rng)
        D = design(brief, style, rng, lk)
        D['lean'] = lean
        D['bay'] *= 1.0 + 0.3 * lean
        srng = U.sub(rng)
        fn = build_hausa if D['type'] == 'hausa' else build_djenne
        ext, ctrect = fn(b, lk, D, srng)
        _site(b, lk, D, srng, ext, brief)
        if b.tris <= limit:
            break
    return b.objects()


def _site(b, lk, D, srng, ext, brief):
    b.section('site')
    x0, y0, x1, y1 = ext
    m = D['marg'] if not D['court'] else 0.8
    fx0, fy0, fx1, fy1 = x0 - m, y0 - m, x1 + m, y1 + m
    fc = (brief.get('setting') or {}).get('forecourt') or 'plaza'
    front = 14.0 if fc in ('road', 'parking') else 11.0
    pad = (fx0 - 6, fy0 - front, fx1 + 6, fy1 + 6)
    lib.ground(b, *pad, lk, scale=5.0)
    if D['lean'] >= 2 and fc == 'parking':
        fc = 'plaza'
    if fc in ('plaza', 'garden', 'water', 'none') and D['court'] is False and False:
        pass
    U.front_apron(b, lk, srng, fc, pad[0] + 1, pad[2] - 1, fy0 - 0.3, pad[1], lk.tree)
    n = max(2, 6 + int(srng.random() * 3) - 2 * D['lean'])
    U.trees_ring(b, lk, srng, lk.tree, (fx0, fy0, fx1, fy1), pad, n, h=7.0, avoid=[])
