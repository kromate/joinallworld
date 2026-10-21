"""heritage-fort: seven typologies chosen from the brief (name, subject, notes, footprint, style, material, roof, features).

  palace   walled traditional-ruler compound: perimeter wall with crenellations and horn pinnacles, a decorated gatehouse (zaure) and
           ranges of flat-roofed or hipped halls round a courtyard (Hausa / Yoruba / Buganda / Benin variants by style)
  gate     a city-wall gatehouse (Kano kofar): battered mud-render tower-gate with arched passage, crenellations, pinnacles, relief,
           and stretches of the city wall either side
  castle   European / Middle-Eastern castle: curtain wall, corner towers (round or square, hip / conical / flat roofs), keep, gatehouse,
           optional moat; brick, stone or limestone
  fort     coastal / colonial / star fort: bastioned (angled) rampart with parapet, cannons on the terreplein, gatehouse, whitewash
  ruin     roofless broken walls of varied height, a tower stump, rubble
  earthwork steep earth rampart and ditch (moat, serpent wall), grassed or laterite
  bunker   low concrete casemates / battery with embrasures and a stair

Everything faces -Y; plan sizes come from the brief, clamped so building plus site stays under about 120 m.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import _stadium_util as U  # noqa: E402

FEATURES = {'ramparts', 'cannon', 'crenellation', 'gate', 'steps', 'courtyard', 'fence-wall', 'flags', 'relief-pattern', 'pinnacles',
            'arches', 'colonnade', 'bell-tower', 'clock-tower', 'dome', 'minaret', 'mosaic', 'painted-mural', 'terrace', 'chimney',
            'arcade', 'pavilion', 'statue', 'signage-board', 'pier', 'railings'}

ECON = False
FLAT = 60.0


# ------------------------------------------------------------------------------------------------------------------ plan
def plan(brief, style, srng, lk):
    form = brief.get('form') or {}
    fe = U.feats(brief)
    tx = U.text(brief)
    nm = ' '.join(str(brief.get(k) or '') for k in ('name', 'subject')).lower()
    w = U.num(form, 'width_m', 60)
    d = U.num(form, 'depth_m', w * 0.7)
    H = U.num(form, 'height_m', 8)
    fp = form.get('footprint') or 'rect'
    roof = form.get('roof') or 'flat'
    st = brief.get('style') or ''
    mat = (brief.get('facade') or {}).get('material') or lk.wall_material
    P = {'fe': fe, 'tx': tx, 'nm': nm, 'w': w, 'd': d, 'H': max(2.0, H), 'fp': fp, 'roof': roof, 'style': st, 'material': mat,
         'year': U.era_year(brief)}
    has = lambda *ws: any(x in nm for x in ws)
    thas = lambda *ws: any(x in tx for x in ws)
    mud = mat in ('mud-render', 'laterite') or st in ('hausa-arewa', 'sahelian')
    if has('moat (iya)', 'serpent', 'earthwork', 'rampart') and 'gate' not in fe and 'courtyard' not in fe and roof in ('none', None):
        typ = 'earthwork'
    elif has('bunker', 'pillbox', 'battery', 'flakfortet', 'dragør', 'dragor', 'mosede', 'kongelund', 'batteri') or (mat in ('concrete', 'exposed-concrete') and 'ramparts' in fe or has('bunker')):
        typ = 'bunker'
    elif roof in ('none', None, '') and (thas('ruin', 'ruined', 'remains', 'broken', 'excavated', 'roofless', 'stump') or st == 'vernacular' and H <= 6):
        typ = 'ruin'
    elif has('palace', 'lubiri', 'rova', 'alake', 'emir', 'sultan', 'shehu', 'lamido', 'maigari', 'oba', 'ora ', 'village head', 'ojude', 'awujale', 'kasubi', 'heritage gathering', 'mengo') and not has('red castle', 'citadel'):
        typ = 'palace' if not (mud and has('gate') and not 'courtyard' in fe) else 'gate'
        if has('queen') and H > 25:
            typ = 'castle'
    elif has('kofar', 'gate', 'bab ') and mud and w <= 40:
        typ = 'gate'
    elif has('castle', 'kasteel', 'slot', 'château', 'chateau', 'grad', 'burg', 'citadel', 'heinitz', 'ramana', 'buffavento', 'monastery') and not thas('star fort', 'pentagonal'):
        typ = 'castle'
    elif thas('fort', 'bastion', 'battery', 'ramparts', 'redoubt', 'fortaleza') or 'ramparts' in fe or 'cannon' in fe:
        typ = 'fort'
    elif 'courtyard' in fe or 'gate' in fe:
        typ = 'palace'
    else:
        typ = 'castle'
    if has('chellah', 'citadel', 'red castle', 'bock', 'stavrovouni'):
        typ = 'castle' if not has('chellah') else 'ruin'
    P['typ'] = typ
    P['mud'] = mud
    P['seed'] = srng.getrandbits(32)
    return P


# ------------------------------------------------------------------------------------------------------------------ pieces
def wall_seg(b, lk, p0, p1, h, th, col, slot, merlons=True, pinn=None, mud=False, batter=0.0, rng=None, cap_col=None, ruin=None):
    """A wall run from p0 to p1 with optional crenellations. ruin=(rng, drop) breaks the top into stepped heights."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    if L < 0.3:
        return
    yaw = math.atan2(dy, dx)
    det = b.detail
    if ruin:
        r, drop = ruin
        n = max(1, int(L / {0: 3.0, 1: 7.0, 2: 1e9}[det]))
        for k in range(n):
            u0, u1 = L * k / n, L * (k + 1) / n
            hh = max(0.6, h * (1.0 - drop * r.random()))
            mx, my = p0[0] + dx * (u0 + u1) / 2 / L, p0[1] + dy * (u0 + u1) / 2 / L
            lib.obox(b, mx, my, 0, u1 - u0 + 0.02, th, hh, yaw, slot, col, top_col=cap_col or col, skip=('bottom',), scale=2.0 * (1 + det * 2))
        return
    mx, my = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    if batter > 0 and det < 2:
        # sloping outer faces: build as a frustum along the wall
        nx, ny = -dy / L, dx / L
        t0 = th / 2 + batter
        t1 = th / 2
        pts0 = [(p0[0] - nx * t0, p0[1] - ny * t0), (p1[0] - nx * t0, p1[1] - ny * t0), (p1[0] + nx * t0, p1[1] + ny * t0), (p0[0] + nx * t0, p0[1] + ny * t0)]
        pts1 = [(p0[0] - nx * t1, p0[1] - ny * t1), (p1[0] - nx * t1, p1[1] - ny * t1), (p1[0] + nx * t1, p1[1] + ny * t1), (p0[0] + nx * t1, p0[1] + ny * t1)]
        for i in range(4):
            j = (i + 1) % 4
            if i in (1, 3):
                b.facing([(pts0[i][0], pts0[i][1], 0), (pts0[j][0], pts0[j][1], 0), (pts1[j][0], pts1[j][1], h), (pts1[i][0], pts1[i][1], h)], ((pts0[i][0] + pts0[j][0]) / 2 - mx, (pts0[i][1] + pts0[j][1]) / 2 - my, 0), slot, col, scale=2.5)
            else:
                b.facing([(pts0[i][0], pts0[i][1], 0), (pts0[j][0], pts0[j][1], 0), (pts1[j][0], pts1[j][1], h), (pts1[i][0], pts1[i][1], h)], ((pts0[i][0] + pts0[j][0]) / 2 - mx, (pts0[i][1] + pts0[j][1]) / 2 - my, 0), slot, col, scale=2.5)
        b.facing([(q[0], q[1], h) for q in pts1], (0, 0, 1), 'roof-flat', cap_col or col)
    else:
        lib.obox(b, mx, my, 0, L, th, h, yaw, slot, col, top_slot='roof-flat', top_col=cap_col or col, skip=('bottom',), scale=2.5 * (1 + det * 2))
    if merlons and det < 2:
        nx, ny = -dy / L, dx / L
        off = th * 0.38
        for sgn in (-1, 1):
            a = (p0[0] + nx * off * sgn, p0[1] + ny * off * sgn)
            c = (p1[0] + nx * off * sgn, p1[1] + ny * off * sgn)
            U.crenellation(b, a, c, h, min(1.0, 0.18 * h + 0.5), 0.9 if not mud else 0.8, 0.7, th * 0.3, slot, col, cap_col)
    if pinn and det < 2:
        U.pinnacle(b, p0[0], p0[1], h, pinn, th * 1.7, col, slot)


def tower(b, lk, cx, cy, r, h, col, slot, kind='round', cap='cone', cap_col=None, merlons=True, windows=True, rng=None, ruin=False):
    """A corner tower: round or square, with cone / hip / crenellated-flat cap."""
    det = b.detail
    cap_col = cap_col or lk.roof_col
    n = 14 if det == 0 else (8 if det == 1 else 6)
    if ruin:
        h = h * (0.45 + 0.4 * (rng.random() if rng else 0.5))
        cap = 'none'
    if kind == 'round':
        U.revolve(b, cx, cy, [(r * 1.08, 0), (r * 1.08, 1.2), (r, 1.4), (r * 0.98, h - 0.6), (r * 1.12, h - 0.5), (r * 1.12, h)], n, slot if det < 2 else 'plain', col, smooth_=True, scale=2.5)
    else:
        lib.box(b, cx - r, cy - r, 0, cx + r, cy + r, h, slot, col, top_slot='roof-flat', top_col=col, skip=('bottom',), scale=2.5)
    if cap == 'cone':
        U.revolve(b, cx, cy, [(r * 1.25, h), (r * 0.02, h + r * 2.3)], n, lk.roof_slot if det < 2 else 'plain', cap_col, smooth_=False, scale=2.0)
    elif cap == 'hip':
        lib.hip(b, (cx - r * 1.1, cy - r * 1.1, cx + r * 1.1, cy + r * 1.1), h, r * 1.7, lk, ov=0.2) if False else lib.roof_profile(b, (cx - r * 1.15, cy - r * 1.15, cx + r * 1.15, cy + r * 1.15), h, [(0.0, 0.0), (r * 1.1, r * 1.7)], lk, roof_slot=lk.roof_slot, roof_col=cap_col)
    elif cap == 'flat' and merlons and det < 2:
        if kind == 'round':
            m = 8
            for k in range(m):
                a = 2 * math.pi * k / m
                lib.obox(b, cx + r * 1.0 * math.cos(a), cy + r * 1.0 * math.sin(a), h, 0.8, 0.6, 0.85, a + math.pi / 2, slot, col, skip=('bottom',))
        else:
            for (p0, p1) in (((cx - r, cy - r), (cx + r, cy - r)), ((cx + r, cy - r), (cx + r, cy + r)), ((cx + r, cy + r), (cx - r, cy + r)), ((cx - r, cy + r), (cx - r, cy - r))):
                U.crenellation(b, p0, p1, h, 0.85, 0.8, 0.6, 0.4, slot, col)
    if windows and det == 0 and kind == 'round':
        for k in range(2):
            zz = h * (0.4 + 0.3 * k)
            for q in range(3):
                a = -math.pi / 2 + (q - 1) * 1.0
                pts = [(cx + r * 1.0 * math.cos(a) - 0.12 * math.sin(a) * -1, cy + r * math.sin(a) - 0.12 * math.cos(a), zz - 0.5), (cx + r * math.cos(a) + 0.12 * -math.sin(a) * -1, cy + r * math.sin(a) + 0.12 * math.cos(a), zz - 0.5)]
                pts += [(pts[1][0], pts[1][1], zz + 0.5), (pts[0][0], pts[0][1], zz + 0.5)]
                b.facing(pts, (math.cos(a), math.sin(a), 0), 'plain', '#2a2c30', scale=FLAT)


def gatehouse(b, lk, P, rng, cx, cy, w, d, h, mud=False, passage=True, pinn=True):
    """A gatehouse block with an arched passage along Y, crenellated top, optional horn pinnacles and relief."""
    det = b.detail
    ws, wc = lk.wall_slot, lk.wall_col
    span = U.clamp(w * 0.34, 2.4, 5.5)
    rise = U.clamp(h * 0.62, 2.2, h - 1.2)
    kind = 'pointed' if (mud and rng.random() < 0.4) else 'round'
    zs = rise * (0.5 if kind != 'rect' else 0.0)
    ops = [{'xc': 0.0, 'span': span, 'zs': zs, 'rise': rise - zs, 'kind': kind}] if passage else []
    batter = 0.3 if mud else 0.0
    import importlib.util
    mon = _mon()
    # shift into place by building at the origin then offsetting: build directly with cx, cy applied to the block extents
    curves = mon.arch_block(b, cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, h, [dict(o, xc=o['xc'] + cx) for o in ops], ws, wc, wc if mud else lk.roof_col, lk.trim_col, batter=batter)
    if det < 2:
        lib.box(b, cx - w / 2 + batter - 0.15, cy - d / 2 + batter - 0.15, h, cx + w / 2 - batter + 0.15, cy + d / 2 - batter + 0.15, h + 0.35, ws, wc, top_slot=ws, skip=('bottom',))
        for sy in (-1, 1):
            U.crenellation(b, (cx - w / 2 + batter, cy + sy * (d / 2 - batter)), (cx + w / 2 - batter, cy + sy * (d / 2 - batter)), h + 0.35, 0.9, 0.9, 0.7, 0.45, ws, wc)
        for sx in (-1, 1):
            U.crenellation(b, (cx + sx * (w / 2 - batter), cy - d / 2 + batter), (cx + sx * (w / 2 - batter), cy + d / 2 - batter), h + 0.35, 0.9, 0.9, 0.7, 0.45, ws, wc)
    if pinn and mud:
        ph = U.clamp(h * 0.34, 1.2, 3.6)
        pw = U.clamp(w * 0.07, 0.7, 1.5)
        cnt = max(4, min(6, P['fe'].get('pinnacles', {}).get('count', 4)))
        spots = [(cx - w / 2 + batter + pw, cy - d / 2 + batter + pw), (cx + w / 2 - batter - pw, cy - d / 2 + batter + pw),
                 (cx - w / 2 + batter + pw, cy + d / 2 - batter - pw), (cx + w / 2 - batter - pw, cy + d / 2 - batter - pw), (cx, cy - d / 2 + batter + pw), (cx, cy + d / 2 - batter - pw)]
        for (px, py) in spots[:cnt]:
            U.pinnacle(b, px, py, h + 0.35, ph, pw * 2.0, wc, ws)
    if det == 0 and 'relief-pattern' in P['fe'] and passage:
        op = ops[0]
        yf = cy - d / 2 + batter * (op['zs'] + op['rise']) / h - 0.04
        dark, light = lib.shade(wc, 0.74), lib.mix(wc, '#efe7d6', 0.5)
        zt = op['zs'] + op['rise']
        zb0, zb1 = zt + 0.5, min(h - 0.4, zt + 1.4)
        n = max(3, int(w / 1.4))
        if zb1 > zb0 + 0.3:
            for k in range(n):
                xa, xb_ = cx - w / 2 + 0.8 + (w - 1.6) * k / n, cx - w / 2 + 0.8 + (w - 1.6) * (k + 1) / n
                b.facing([(xa, yf, zb0), (xb_, yf, zb0), ((xa + xb_) / 2, yf, zb1)], (0, -1, 0), 'plain', dark if k % 2 == 0 else light, scale=FLAT)
        for sgn in (-1, 1):
            x0 = cx + sgn * (span / 2 + 0.25)
            b.facing([(x0, yf, 0.0), (x0 + sgn * 0.5, yf, 0.0), (x0 + sgn * 0.5, yf, zt + 0.2), (x0, yf, zt + 0.2)], (0, -1, 0), 'plain', light, scale=FLAT)
    return span


_MON = None


def _mon():
    """The monument module's arch_block (shared arch geometry)."""
    global _MON
    if _MON is None:
        import importlib.util
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'monument.py')
        spec = importlib.util.spec_from_file_location('archetype_monument_shared', path)
        _MON = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_MON)
    return _MON


def range_building(b, lk, P, rng, x0, y0, x1, y1, h, roof='hip', verandah=False, front='punched', style_col=None):
    """A single hall: walls with windows plus a roof; optional colonnaded verandah on its -Y face."""
    det = b.detail
    w, d = x1 - x0, y1 - y0
    fp = lib.fp_rect(w, d, (x0 + x1) / 2, (y0 + y1) / 2)
    storeys = 1 if h < 6.5 else 2
    if max(w, d) > 30 or ECON:
        front = 'ribbon' if det == 0 else 'none'
    lib.walls(b, fp, 0.0, h, storeys, lk, rng, kind=front, ratio=0.22, plinth=0.4, rear='flat')
    if roof == 'flat':
        lib.flat_roof(b, fp, h, lk, parapet_h=0.6 if not P['mud'] else 0.9)
    elif roof == 'gable':
        lib.gable(b, (x0, y0, x1, y1), h, min(d, w) * 0.28, lk, ov=0.5)
    else:
        lib.hip(b, (x0, y0, x1, y1), h, min(d, w) * 0.25, lk, ov=0.6)
    if verandah and det < 2 and w > 8:
        n = max(3, int(w / 3.2))
        zt = h * 0.78
        yc = y0 - 2.2
        lib.colonnade(b, (x0 + 0.5, yc), (x1 - 0.5, yc), 0.0, zt, n, lk, r=0.28, beam_h=0.5)
        lib.box(b, x0, y0 - 2.6, zt, x1, y0, zt + 0.25, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))


def forecourt_site(b, lk, P, srng, x0, y0, x1, y1, front_y):
    det = b.detail
    with b.site():
        lib.ground(b, x0, y0, x1, y1, lk, lk.ground_slot, lk.ground_col if lk.ground_slot != 'paving' else None, z=0.0, scale=3.0)
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for k in range(6 if det == 0 else 3):
                x = srng.uniform(x0 + 5, x1 - 5)
                y = srng.uniform(y0 + 4, front_y - 6)
                lib.tree(b, lk.tree, x, y, srng.uniform(6, 10), srng, lk)
    if 'flags' in P['fe'] and det < 2:
        with b.site():
            for k in range(3):
                U.flag(b, -6 + 6 * k, front_y - 8.0, 10.0, ['#1f7a4d', '#f2f2ee', '#b83a32'][k], col2='#f2f2ee')


# ----------------------------------------------------------------------------------------------------------- polygon helpers
def outline(kind, W, D, rng, n=None):
    """Irregular compound / fort outline (CCW) for a footprint kind, within W x D."""
    hw, hd = W / 2, D / 2
    if kind == 'rect' or kind == 'ring':
        return [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    if kind in ('U', 'L'):
        return [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    if kind == 'round' or kind == 'oval':
        m = n or 18
        return [(hw * math.cos(2 * math.pi * k / m), hd * math.sin(2 * math.pi * k / m)) for k in range(m)]
    # irregular: a convex-ish polygon with the front edge flat (facade side) and a jittered back
    return [(-hw, -hd), (hw * 0.96, -hd), (hw, -hd * 0.1 + rng.uniform(-1, 1) * hd * 0.1), (hw * 0.9, hd * 0.85), (hw * 0.2, hd), (-hw * 0.6, hd * 0.95), (-hw, hd * 0.2)]


def star_outline(W, D, k=5, depth=0.22):
    """Bastioned outline: a polygon with `k` bastion points, flattened at the front (-Y) side for the main face."""
    pts = []
    cx, cy = 0.0, 0.0
    R = min(W, D) / 2
    for i in range(k):
        a0 = -math.pi / 2 + 2 * math.pi * i / k
        a1 = a0 + math.pi / k
        pts.append((W / 2 * 0.97 * math.cos(a0) * 0.98, D / 2 * 0.97 * math.sin(a0) * 0.98))
        pts.append((W / 2 * (1 - depth) * math.cos(a1) * 0.97, D / 2 * (1 - depth) * math.sin(a1) * 0.97))
    return pts


def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if a > 0 else pts[::-1]


def perimeter(b, lk, P, rng, pts, h, th, gate_edge=None, gate_w=0.0, merlons=True, mud=False, ruin=None, pinn=None, batter=0.0, towers=None):
    """Walls round a closed polygon; the edge `gate_edge` leaves a gap of gate_w centred on it (a gatehouse fills it)."""
    ws, wc = lk.wall_slot, lk.wall_col
    n = len(pts)
    for i in range(n):
        p0, p1 = pts[i], pts[(i + 1) % n]
        if gate_edge is not None and i == gate_edge:
            L = math.dist(p0, p1)
            if L > gate_w + 1:
                u = (gate_w / 2) / L
                m = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
                ga = (m[0] + (p0[0] - m[0]) * (gate_w / 2) / (L / 2), m[1] + (p0[1] - m[1]) * (gate_w / 2) / (L / 2))
                gb = (m[0] + (p1[0] - m[0]) * (gate_w / 2) / (L / 2), m[1] + (p1[1] - m[1]) * (gate_w / 2) / (L / 2))
                wall_seg(b, lk, p0, ga, h, th, wc, ws, merlons, None, mud, batter, rng, ruin=ruin)
                wall_seg(b, lk, gb, p1, h, th, wc, ws, merlons, None, mud, batter, rng, ruin=ruin)
                continue
        wall_seg(b, lk, p0, p1, h, th, wc, ws, merlons, pinn if (pinn and i % 2 == 0) else None, mud, batter, rng, ruin=ruin)


# ------------------------------------------------------------------------------------------------------------------- palace
def build_palace(b, brief, lk, P, rng):
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'])
    W = U.clamp(P['w'], 30, 104)
    D = U.clamp(P['d'], 24, 84)
    f = min(1.0, 104.0 / max(P['w'], P['d']))
    mud = P['mud']
    h_wall = U.clamp(P['H'] * (0.55 if mud else 0.35), 2.6, 5.0)
    h_wall = max(h_wall, 3.2) if mud else h_wall
    th = 0.7 if mud else 0.5
    pts = outline(P['fp'] if P['fp'] in ('irregular', 'rect') else 'rect', W, D, srng)
    b.section('wall')
    ge = 0
    perimeter(b, lk, P, srng, ccw(pts), h_wall, th, gate_edge=0, gate_w=U.clamp(W * 0.12, 6.0, 12.0), merlons=('crenellation' in fe or mud), mud=mud, pinn=(h_wall * 0.45 if ('pinnacles' in fe or mud) else None), batter=0.25 if mud else 0.0)
    b.section('gate')
    gw = U.clamp(W * 0.12, 6.0, 12.0)
    gh = U.clamp(P['H'] * 0.85, 5.0, 10.0)
    front = pts[0][1]
    gatehouse(b, lk, P, srng, 0.0, front, gw + 2.0, 6.0, gh, mud=mud, passage=True, pinn=mud or 'pinnacles' in fe)
    b.section('halls')
    # courtyard with ranges: a main hall at the back, side ranges, a second smaller court block
    Hh = U.clamp(P['H'], 4.0, 14.0)
    roof = P['roof'] if P['roof'] in ('flat', 'hip', 'gable') else 'flat'
    if lk.wall_material in ('painted-render', 'render', 'whitewash') and P['roof'] == 'hip':
        roof = 'hip'
    yb = pts[0][1]
    back_h = Hh
    ymax = max(p[1] for p in pts)
    xs = [p[0] for p in pts]
    xl, xr = min(xs) + 3.0, max(xs) - 3.0
    main_d = U.clamp(D * 0.2, 7.0, 13.0)
    main_w = (xr - xl) * 0.8
    verand = P['style'] in ('yoruba', 'colonial', 'vernacular') or 'colonnade' in fe
    range_building(b, lk, P, srng, -main_w / 2, ymax - main_d - 4.0, main_w / 2, ymax - 4.0, back_h, roof, verandah=verand)
    sw = U.clamp(W * 0.17, 6.0, 12.0)
    for sx in (-1, 1):
        x0, x1 = (xl, xl + sw) if sx < 0 else (xr - sw, xr)
        y0, y1 = yb + D * 0.3, ymax - main_d - 8.0
        if y1 - y0 > 8:
            range_building(b, lk, P, srng, x0, y0, x1, y1, max(3.4, back_h * 0.65), roof)
    # inner courtyard: stone-paved yard with a tree and a pavilion if asked
    if det < 2:
        with b.site():
            lib.ground(b, xl + sw + 1, yb + 8.0, xr - sw - 1, ymax - main_d - 6.0, lk, 'paving', lib.mix(lk.ground_col, '#d6cdb6', 0.5), z=0.03, scale=2.0)
        if 'pavilion' in fe:
            lib.box_c(b, 0, (yb + ymax) / 2, 0, 8, 6, 3.4, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col)
        if lk.tree not in (None, 'none'):
            with b.site():
                lib.tree(b, lk.tree, -12, yb + (ymax - yb) * 0.45, 8.0, srng, lk)
                lib.tree(b, lk.tree, 14, yb + (ymax - yb) * 0.4, 8.5, srng, lk)
    if 'statue' in fe and det < 2:
        lib.box_c(b, 12, yb - 7.0, 0, 1.4, 1.4, 2.0, lk.wall_slot, lk.trim_col)
        U.person(b, 12, yb - 7.0, 2.0, 3.2, '#6a583b', 0.0)
    b.section('site')
    forecourt_site(b, lk, P, srng, -W / 2 - 12, yb - 26, W / 2 + 12, ymax + 10, yb - 2)
    return P['H']


# --------------------------------------------------------------------------------------------------------------------- gate
def build_gate(b, brief, lk, P, rng):
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'])
    W = U.clamp(P['w'], 10, 44)
    D = U.clamp(P['d'], 5, 22)
    H = U.clamp(P['H'], 4.0, 14.0)
    mud = P['mud']
    wide = U.clamp(W * 0.55, 8, 24)
    b.section('gate')
    gatehouse(b, lk, P, srng, 0.0, 0.0, wide, D, H, mud=mud, passage=True, pinn=mud or 'pinnacles' in fe)
    b.section('wall')
    ext = U.clamp(W * 1.6, 18, 46)
    wh = H * 0.82
    for sgn in (-1, 1):
        x0, x1 = sgn * (wide / 2 - 0.2), sgn * (wide / 2 + ext)
        wall_seg(b, lk, (x0, 0), (x1, 0), wh, 3.0 if mud else 1.8, lk.wall_col, lk.wall_slot, True, None, mud, 0.5 if mud else 0.0, srng)
        if det < 2:
            # a stair up to the wall walk behind the wall and a stub tower at the far end
            lib.box(b, min(x0, x1) + (sgn * 4), 1.5, 0, min(x0, x1) + (sgn * 4) + 2.2 * (1 if sgn > 0 else -1), 4.5, wh * 0.5, lk.wall_slot, lk.trim_col, skip=('bottom',)) if False else None
        if 'ramparts' in fe and det < 2:
            tower(b, lk, sgn * (wide / 2 + ext), 0, 3.2, wh * 1.15, lk.wall_col, lk.wall_slot, 'square' if mud else 'round', 'flat', merlons=True, rng=srng)
    b.section('site')
    pad = U.clamp(W * 2.6, 60, 110)
    with b.site():
        lib.ground(b, -pad / 2, -22, pad / 2, 22, lk, lk.ground_slot, lk.ground_col if lk.ground_slot != 'paving' else None, z=0.0, scale=3.0)
        lib.ground(b, -wide * 0.32, -22, wide * 0.32, 22, lk, 'laterite' if lk.ground_slot == 'laterite' else 'asphalt', '#a98066' if lk.ground_slot == 'laterite' else '#5a5c5f', z=0.04, scale=3.0)
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for sx in (-1, 1):
                lib.tree(b, lk.tree, sx * (wide * 0.5 + 9), -12, srng.uniform(6, 9), srng, lk)
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, wide * 0.5 + 6, -9.0, 0.0, 4.0, 1.6, lk, 0.0, col='#2f5f8a')
    return H


# ------------------------------------------------------------------------------------------------------------------- castle
def build_castle(b, brief, lk, P, rng):
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'])
    f = 1.0
    big = max(P['w'], P['d'])
    if big > 108:
        f = 108.0 / big
    W, D = max(18.0, P['w'] * f), max(14.0, P['d'] * f)
    H = U.clamp(P['H'] * (f ** 0.4), 6.0, 38.0)
    brick = lk.wall_material in ('brick', 'red-brick')
    tx = P['tx']
    moat = U.has(tx, 'moat', 'moated', 'beside the', 'water')
    towers_ = 4
    pts = ccw(outline('rect' if P['fp'] in ('rect', 'L', 'U', 'ring') else 'irregular', W, D, srng))
    wall_h = U.clamp(H * 0.6, 4.5, 14.0)
    rt = U.clamp(min(W, D) * 0.1, 2.4, 6.5)
    kind = 'round' if (P['style'] not in ('tudor',) and not U.has(tx, 'square tower', 'donjon')) else 'square'
    cap = 'cone' if (lk.roof_slot in ('clay-tile', 'slate') or P['roof'] in ('hip',)) else 'flat'
    if P['roof'] in ('flat', 'none', 'gable') and not brick:
        cap = 'flat'
    ruin = P['roof'] in ('none', None, '')
    rr = (srng, 0.55) if ruin else None
    b.section('walls')
    perimeter(b, lk, P, srng, pts, wall_h, 1.6 if det < 2 else 1.6, gate_edge=0, gate_w=U.clamp(W * 0.12, 4.0, 7.0), merlons=True, ruin=rr)
    b.section('towers')
    for (px, py) in pts[:4] if len(pts) >= 4 else pts:
        tower(b, lk, px, py, rt, wall_h + U.clamp(H * 0.35, 2.0, 7.0), lk.wall_col, lk.wall_slot, kind, cap, rng=srng, ruin=ruin)
    b.section('gate')
    gw = U.clamp(W * 0.12, 4.0, 7.0) + 1.6
    gh = wall_h + 2.0
    front_y = pts[0][1]
    gatehouse(b, lk, P, srng, 0.0, front_y, gw + 3.0, 5.0, gh, mud=False, passage=True, pinn=False)
    b.section('keep')
    kw, kd = W * 0.34, D * 0.34
    kh = H
    fp = lib.fp_rect(kw, kd, 0, D * 0.12)
    if ruin:
        for (p0, p1) in (((-kw / 2, D * 0.12 - kd / 2), (kw / 2, D * 0.12 - kd / 2)), ((kw / 2, D * 0.12 - kd / 2), (kw / 2, D * 0.12 + kd / 2)), ((kw / 2, D * 0.12 + kd / 2), (-kw / 2, D * 0.12 + kd / 2)), ((-kw / 2, D * 0.12 + kd / 2), (-kw / 2, D * 0.12 - kd / 2))):
            wall_seg(b, lk, p0, p1, kh * 0.7, 1.4, lk.wall_col, lk.wall_slot, False, None, False, 0.0, srng, ruin=(srng, 0.7))
    else:
        lib.walls(b, fp, 0.0, kh, max(2, int(kh / 4.0)), lk, srng, kind='punched', ratio=0.12, plinth=0.5, rear='flat')
        if P['roof'] == 'flat' or cap == 'flat':
            lib.flat_roof(b, fp, kh, lk, parapet_h=0.9)
        elif P['roof'] == 'gable':
            lib.gable(b, (-kw / 2, D * 0.12 - kd / 2, kw / 2, D * 0.12 + kd / 2), kh, kd * 0.35, lk, ov=0.5)
        else:
            lib.hip(b, (-kw / 2, D * 0.12 - kd / 2, kw / 2, D * 0.12 + kd / 2), kh, min(kw, kd) * 0.45, lk, ov=0.6)
        if 'bell-tower' in fe or 'clock-tower' in fe:
            tower(b, lk, kw * 0.3, D * 0.12 + kd * 0.3, 1.8, kh + 5.5, lk.wall_col, lk.wall_slot, 'square', 'hip', windows=False, rng=srng)
        if 'dome' in fe and det < 2:
            lib.dome(b, -kw * 0.15, D * 0.12, kh, min(kw, kd) * 0.25, lk, profile='shallow', drum=1.0, finial=1.5)
        if 'minaret' in fe and det < 2:
            tower(b, lk, kw * 0.38, D * 0.12 - kd * 0.2, 1.3, kh + 8.0, lk.wall_col, lk.wall_slot, 'round', 'cone', windows=False, rng=srng)
    b.section('site')
    pad_x, pad_y = W / 2 + 14, D / 2 + 14
    if moat and det < 2:
        with b.site():
            mw = 7.0
            for (a0, b0, a1, b1) in ((-W / 2 - mw - 1, -D / 2 - mw - 1, W / 2 + mw + 1, -D / 2 - 1), (-W / 2 - mw - 1, D / 2 + 1, W / 2 + mw + 1, D / 2 + mw + 1), (-W / 2 - mw - 1, -D / 2 - 1, -W / 2 - 1, D / 2 + 1), (W / 2 + 1, -D / 2 - 1, W / 2 + mw + 1, D / 2 + 1)):
                b.face([(a0, b0, 0.06), (a1, b0, 0.06), (a1, b1, 0.06), (a0, b1, 0.06)], 'plain', '#4f86a0', scale=FLAT)
            lib.box(b, -gw / 2 - 0.4, -D / 2 - mw - 1, 0.07, gw / 2 + 0.4, -D / 2 - 0.5, 0.2, 'paving', '#b8b2a4', skip=('bottom',))
        pad_x += 8
        pad_y += 8
    forecourt_site(b, lk, P, srng, -pad_x, -pad_y - 10, pad_x, pad_y, -D / 2 - (9 if moat else 3))
    return H


# --------------------------------------------------------------------------------------------------------------------- fort
def build_fort(b, brief, lk, P, rng):
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 104.0 / big)
    W, D = max(24.0, P['w'] * f), max(20.0, P['d'] * f)
    tx = P['tx']
    H = U.clamp(P['H'], 3.0, 16.0)
    star = U.has(tx, 'star', 'pentagonal', 'bastion') or P['fp'] == 'irregular'
    k = 5 if U.has(tx, 'pentagon') else (4 if W / D < 1.5 else 5)
    pts = ccw(star_outline(W, D, k, 0.2)) if star else ccw(outline('rect', W, D, srng))
    h_w = U.clamp(H * 0.8, 3.0, 9.0)
    wall_h = h_w
    ruin = P['roof'] in ('none', None, '') and U.has(tx, 'ruin', 'remains', 'stump', 'earthen')
    earth = lk.wall_material in ('laterite', 'mud-render') or U.has(tx, 'earthen', 'earth-covered', 'earth ')
    b.section('ramparts')
    n = len(pts)
    # sloping rampart: battered walls (outer face leans in), parapet on the top, earth terreplein inside
    for i in range(n):
        p0, p1 = pts[i], pts[(i + 1) % n]
        wall_seg(b, lk, p0, p1, wall_h, 2.4, lk.wall_col, lk.wall_slot, merlons=not ruin and P['style'] != 'soviet', mud=False, batter=0.9 if not earth else 1.6, rng=srng, ruin=(srng, 0.45) if ruin else None, cap_col=lk.trim_col)
    # terreplein (floor inside walls) and cannons
    if det < 2:
        with b.site():
            inner = [(p[0] * 0.9, p[1] * 0.9) for p in pts]
            U.poly(b, [(p[0], p[1], 0.05) for p in inner], (0, 0, 1), 'laterite' if lk.ground_slot == 'laterite' else 'paving', lk.ground_col if lk.ground_slot == 'laterite' else '#c9c1ae', scale=3.0)
    b.section('cannon')
    nc = max(2, min(9, P['fe'].get('cannon', {}).get('count', 4)))
    if 'cannon' in fe and det < 2:
        for i in range(nc):
            a = -math.pi / 2 + (i - (nc - 1) / 2) * 0.55 if nc > 1 else -math.pi / 2
            # place on the front (seaward) edge points of the rampart, muzzle out
            ex = math.cos(a) * W / 2 * 0.82
            ey = math.sin(a) * D / 2 * 0.82
            cannon(b, ex, ey, wall_h, a, 0.9)
    b.section('gate')
    gate_w = 5.0
    gh = wall_h + 1.8
    front_y = min(p[1] for p in pts)
    if 'gate' in fe:
        mid = max(pts, key=lambda p: -p[1])
        gatehouse(b, lk, P, srng, 0.0, front_y + 0.5, gate_w + 3.0, 4.5, gh, mud=earth and P['mud'], passage=True, pinn=False)
    b.section('buildings')
    if not ruin:
        # barracks block, a small tower / lighthouse accent, flagpole
        bw, bd = W * 0.4, D * 0.18
        range_building(b, lk, P, srng, -bw / 2, D * 0.1, bw / 2, D * 0.1 + bd, max(4.0, H * 0.5), 'flat', verandah=False)
        if 'bell-tower' in fe or U.has(tx, 'lighthouse'):
            tower(b, lk, W * 0.22, D * 0.1 + bd / 2, 2.2, H * 1.2 + 5.0, lk.wall_col, lk.wall_slot, 'round', 'cone', windows=False, rng=srng, cap_col='#b83a32')
        if 'flags' in fe and det < 2:
            U.flag(b, -W * 0.2, D * 0.05, 11.0, '#1f7a4d', col2='#f2f2ee')
    elif det < 2:
        for k_ in range(5):
            x = srng.uniform(-W * 0.3, W * 0.3)
            y = srng.uniform(-D * 0.2, D * 0.2)
            lib.box_c(b, x, y, 0, srng.uniform(1, 2.6), srng.uniform(1, 2.6), srng.uniform(0.4, 1.0), lk.wall_slot, lk.wall_col)
    b.section('site')
    water = lk.forecourt == 'water' or U.has(tx, 'coastal', 'sea', 'seaward', 'bay', 'ocean')
    pad = (W / 2 + 14, D / 2 + 14)
    with b.site():
        lib.ground(b, -pad[0], -pad[1] - 4, pad[0], pad[1], lk, lk.ground_slot, lk.ground_col if lk.ground_slot != 'paving' else None, z=0.0, scale=3.0)
        if water and det < 2:
            ys = pad[1] + 0.1
            # sea strip beyond the back of the fort (so the seaward face is the far side) plus a quay
            b.face([(-pad[0] - 12, ys), (pad[0] + 12, ys), (pad[0] + 12, ys + 26), (-pad[0] - 12, ys + 26)], 'plain', '#4f86a0', scale=FLAT) if False else None
    if det < 2 and 'steps' in fe:
        with b.site():
            lib.steps(b, -4.0, 4.0, front_y - 0.2, 1.2, 3.0, 4 if det == 0 else 2, 'paving', lk.stone_col)
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for k_ in range(5 if det == 0 else 2):
                lib.tree(b, lk.tree, srng.uniform(-pad[0] + 4, pad[0] - 4), srng.uniform(-pad[1] - 2, front_y - 6), srng.uniform(6, 9), srng, lk)
    return H


def cannon(b, x, y, z, yaw, scale=1.0):
    """A muzzle-loading cannon on a carriage: barrel (tapered cylinder) pointing along yaw, two wheels, trail."""
    det = b.detail
    c, s = math.cos(yaw), math.sin(yaw)
    L = 2.6 * scale
    x1, y1 = x + c * L, y + s * L
    n = 6 if det == 0 else 4
    p0, p1 = (x, y, z + 0.75 * scale), (x1, y1, z + 0.85 * scale)
    U.strut(b, p0, p1, 0.4 * scale, '#2e3236', slot='frame', ends=True)
    lib.obox(b, x + c * 0.9 * scale, y + s * 0.9 * scale, z, 1.6 * scale, 0.7 * scale, 0.5 * scale, yaw, 'timber', '#6b4a2e', skip=('bottom',))
    if det == 0:
        for sg in (-1, 1):
            wx, wy = x + c * 0.9 * scale - s * sg * 0.5 * scale, y + s * 0.9 * scale + c * sg * 0.5 * scale
            lib.cylinder(b, wx, wy, z, z + 0.7 * scale, 0.35 * scale, n=6, slot='timber', col='#5a3d25', top=False, smooth=False) if False else None
            U.strut(b, (wx, wy, z + 0.35 * scale), (wx + c * 0.01, wy + s * 0.01, z + 0.36 * scale), 0.7 * scale, '#5a3d25', slot='timber')


# --------------------------------------------------------------------------------------------------------------------- ruin
def build_ruin(b, brief, lk, P, rng):
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 100.0 / big)
    W, D = max(8.0, P['w'] * f), max(6.0, P['d'] * f)
    H = U.clamp(P['H'], 1.5, 12.0)
    ws, wc = lk.wall_slot, lk.wall_col
    tx = P['tx']
    pts = ccw(outline('irregular' if P['fp'] in ('irregular', 'oval', 'round') else 'rect', W, D, srng))
    b.section('walls')
    th = 1.0 if big < 30 else 1.6
    n = len(pts)
    for i in range(n):
        p0, p1 = pts[i], pts[(i + 1) % n]
        # leave random gaps in the ring (collapsed sections)
        if srng.random() < 0.28 and n > 4:
            continue
        wall_seg(b, lk, p0, p1, H, th, wc, ws, False, None, False, 0.0, srng, ruin=(srng, 0.65), cap_col=lk.trim_col)
    b.section('tower')
    if W > 14 and (P['fp'] != 'rect' or big > 30):
        r = U.clamp(min(W, D) * 0.1, 1.8, 4.0)
        tower(b, lk, pts[0][0] + r, pts[0][1] + r, r, H * 1.2, wc, ws, 'square' if U.has(tx, 'square', 'donjon', 'tower') else 'round', 'none', rng=srng, ruin=True)
    if 'steps' in fe and det < 2:
        lib.steps(b, -W * 0.15, W * 0.15, -D * 0.3, 1.4, 3.0, 4 if det == 0 else 2, ws, lk.stone_col)
    if 'colonnade' in fe and det < 2:
        n_c = 7
        for k in range(n_c):
            x = -W * 0.3 + W * 0.6 * k / (n_c - 1)
            hh = srng.uniform(1.2, 3.8)
            lib.column(b, x, 0.0, 0.0, hh, 0.4, lk, 'round', capital=False, slot=ws, col=wc)
    if 'arches' in fe and det < 2:
        mon = _mon()
        mon.arch_block(b, -2.2, 2.2, D * 0.25, D * 0.25 + 1.2, min(H, 5.0), [{'xc': 0.0, 'span': 2.4, 'zs': 1.4, 'rise': 1.8, 'kind': 'round'}], ws, wc, wc, lk.trim_col)
    if 'arcade' in fe and det < 2:
        pass
    if det < 2:
        with b.site():
            for k in range(14 if det == 0 else 5):
                x = srng.uniform(-W / 2, W / 2)
                y = srng.uniform(-D / 2, D / 2)
                lib.box_c(b, x, y, 0, srng.uniform(0.4, 1.6), srng.uniform(0.4, 1.6), srng.uniform(0.2, 0.7), ws, lib.shade(wc, srng.uniform(0.8, 1.0)))
    b.section('site')
    forecourt_site(b, lk, P, srng, -W / 2 - 14, -D / 2 - 18, W / 2 + 14, D / 2 + 12, -D / 2 - 4)
    if 'fence-wall' in fe and det < 2:
        for sx in (-1, 1):
            U.railing(b, (sx * (W / 2 + 9), -D / 2 - 10), (sx * (W / 2 + 9), D / 2 + 8), 1.1)
    return H


# ----------------------------------------------------------------------------------------------------------------- earthwork
def build_earthwork(b, brief, lk, P, rng):
    det = b.detail
    srng = random.Random(P['seed'])
    L = U.clamp(P['w'], 40.0, 108.0)
    Dd = U.clamp(P['d'], 14.0, 40.0)
    H = U.clamp(P['H'], 3.0, 12.0)
    col = lk.wall_col if lk.wall_slot in ('mud-render', 'plain-render') else lk.ground_col
    slot = 'grass' if (lk.tree not in ('palm', 'acacia') and lk.ground_slot != 'laterite') else lk.ground_slot
    gcol = '#6d9a4f' if slot == 'grass' else lk.ground_col
    nseg = {0: 24, 1: 10, 2: 5}[det]
    # cross-section: ditch (z < 0 is not allowed, so the ditch is drawn as a low dish between a raised outer bank and the rampart)
    prof = [(-Dd * 0.5, 0.0), (-Dd * 0.34, 0.9), (-Dd * 0.2, 0.3), (-Dd * 0.12, 0.1), (-Dd * 0.02, H * 0.55), (Dd * 0.1, H), (Dd * 0.2, H), (Dd * 0.38, H * 0.45), (Dd * 0.5, 0.0)]
    rows = []
    for i in range(nseg + 1):
        x = -L / 2 + L * i / nseg
        jit = 1.0 + 0.1 * math.sin(i * 1.7) * (1 if det == 0 else 0)
        rows.append([(x, p[0], p[1] * jit) for p in prof])
    # surface: rows along +x, columns across y; normal = x-dir cross y-dir = up
    b.shared_grid(rows, slot, gcol, smooth=True, scale=3.0)
    # ditch bottom colour hint and earth scar on the rampart face
    if det == 0:
        for i in range(nseg):
            x0, x1 = -L / 2 + L * i / nseg, -L / 2 + L * (i + 1) / nseg
            if i % 3 == 0:
                b.facing([(x0, -Dd * 0.12, 0.12), (x1, -Dd * 0.12, 0.12), (x1, -Dd * 0.02, H * 0.55), (x0, -Dd * 0.02, H * 0.55)], (0, -1, 1), 'laterite', '#a56a4c', scale=2.0)
    b.section('end')
    # end faces closing the solid
    for sgn in (-1, 1):
        x = sgn * L / 2
        pl = [(x, p[0], p[1]) for p in prof] + [(x, Dd * 0.5, 0.0)]
        U.poly(b, pl, (sgn, 0, 0), 'plain', '#8a6a4c', scale=FLAT)
    # trees on the bank, a path and steps up
    if det < 2 and lk.tree not in (None, 'none'):
        srng2 = random.Random(P['seed'] + 5)
        for k in range(10 if det == 0 else 4):
            x = srng2.uniform(-L / 2 + 4, L / 2 - 4)
            y = srng2.choice([srng2.uniform(Dd * 0.05, Dd * 0.2), srng2.uniform(-Dd * 0.45, -Dd * 0.3)])
            z = 0.0
            lib.tree(b, lk.tree, x, y, srng2.uniform(6, 11), srng2, lk)
        if 'steps' in P['fe']:
            lib.steps(b, -3.0, 3.0, -Dd * 0.34, 1.0, 3.0, 4, 'paving', lk.stone_col)
    return H


# --------------------------------------------------------------------------------------------------------------------- bunker
def build_bunker(b, brief, lk, P, rng):
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 100.0 / big)
    W, D = max(7.0, P['w'] * f), max(6.0, P['d'] * f)
    H = U.clamp(P['H'], 2.0, 7.0)
    ws, wc = lk.wall_slot, lk.wall_col
    concrete = '#a7a59d'
    b.section('mass')
    if big < 25:
        # a single casemate / entrance block with embrasures and a stair
        lib.box(b, -W / 2, -D / 2, 0, W / 2, D / 2, H, 'rough-concrete', wc, top_slot='roof-flat', top_col='#8f918c', skip=('bottom',), scale=2.0)
        if det < 2:
            n = max(2, int(W / 4.5))
            for k in range(n):
                xc = -W / 2 + W * (k + 0.5) / n
                b.facing([(xc - 0.8, -D / 2 - 0.02, H * 0.45), (xc + 0.8, -D / 2 - 0.02, H * 0.45), (xc + 0.8, -D / 2 - 0.02, H * 0.7), (xc - 0.8, -D / 2 - 0.02, H * 0.7)], (0, -1, 0), 'plain', '#1f2124', scale=FLAT)
            if 'steps' in fe:
                lib.steps(b, -1.5, 1.5, -D / 2, H * 0.55, 4.5, 6 if det == 0 else 3, 'rough-concrete', concrete)
            lib.box(b, -W / 2 - 0.4, -D / 2 - 0.4, H, W / 2 + 0.4, D / 2 + 0.4, H + 0.3, 'rough-concrete', lib.shade(wc, 0.9), skip=('bottom',))
        mound = H * 0.4
    else:
        # a bank of casemates under an earth-covered terrace, in a ring or line
        nb = max(3, min(7, int(W / 14)))
        for k in range(nb):
            xc = -W / 2 + W * (k + 0.5) / nb
            cw = W / nb * 0.8
            lib.box(b, xc - cw / 2, -D * 0.22, 0, xc + cw / 2, D * 0.12, H, 'rough-concrete', wc, top_slot='grass', top_col='#6d9a4f', skip=('bottom',), scale=2.0)
            if det < 2:
                for sg in (-1, 1):
                    b.facing([(xc - 1.0, -D * 0.22 - 0.02, H * 0.2), (xc + 1.0, -D * 0.22 - 0.02, H * 0.2), (xc + 1.0, -D * 0.22 - 0.02, H * 0.65), (xc - 1.0, -D * 0.22 - 0.02, H * 0.65)], (0, -1, 0), 'plain', '#1f2124', scale=FLAT) if sg == 1 else None
        # earth rampart bank behind
        prof = [(-D * 0.1, 0.0), (-D * 0.05, H), (D * 0.2, H * 1.2), (D * 0.5, 0.0)]
        rows = [[(x, p[0] + D * 0.15, p[1]) for p in prof] for x in (-W / 2, 0.0, W / 2)]
        b.shared_grid(rows, 'grass', '#6d9a4f', smooth=True, scale=3.0)
        if 'cannon' in fe and det < 2:
            for k in range(min(4, nb)):
                xc = -W / 2 + W * (k + 0.5) / nb
                cannon(b, xc, -D * 0.1, H, -math.pi / 2, 1.3)
        if 'gate' in fe and det < 2:
            for sx in (-1, 1):
                lib.box_c(b, sx * 3.0, -D * 0.4, 0, 1.2, 1.2, 3.0, 'rough-concrete', concrete)
        mound = 0.0
    b.section('site')
    with b.site():
        lib.ground(b, -W / 2 - 14, -D / 2 - 18, W / 2 + 14, D / 2 + 12, lk, 'grass' if lk.ground_slot not in ('laterite', 'sand') else lk.ground_slot, '#6d9a4f' if lk.ground_slot not in ('laterite', 'sand') else None, z=0.0, scale=3.0)
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for k in range(6 if det == 0 else 3):
                lib.tree(b, lk.tree, srng.uniform(-W / 2 - 10, W / 2 + 10), srng.uniform(D / 2 - 2, D / 2 + 8), srng.uniform(6, 10), srng, lk)
    if 'fence-wall' in fe and det < 2:
        for sy in (-1,):
            U.railing(b, (-W / 2 - 6, -D / 2 - 9), (W / 2 + 6, -D / 2 - 9), 1.2)
    if 'flags' in fe and det < 2:
        with b.site():
            U.flag(b, W / 2 + 4, -D / 2 - 6, 9.0, '#1f7a4d', col2='#f2f2ee')
    return H


# ------------------------------------------------------------------------------------------------------------------- build
def _build_once(brief, style, rng, detail):
    b = lib.Builder('heritage-fort', detail)
    lk = lib.look(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    P = plan(brief, style, srng, lk)
    {'palace': build_palace, 'gate': build_gate, 'castle': build_castle, 'fort': build_fort, 'ruin': build_ruin, 'earthwork': build_earthwork,
     'bunker': build_bunker}[P['typ']](b, brief, lk, P, srng)
    return b


def build(brief, style, rng, detail):
    global ECON
    state = rng.getstate()
    ECON = False
    b = _build_once(brief, style, rng, detail)
    if detail == 0 and b.tris > 18500:
        ECON = True
        rng.setstate(state)
        b = _build_once(brief, style, rng, detail)
        ECON = False
    objs = b.objects()
    U.centre_xy(objs, True, False)
    return objs
