"""park-landscape: ground plus recognisable structures. Ten typologies chosen from the brief (name, subject, notes, features, setting):

  garden     lawns, paved axial path, gate with fence, pavilion / gazebo / bandstand, fountain, kiosk, flower beds, trees by city vegetation
             (formal symmetric layout for colonial / victorian / neoclassical or 'formal', informal curved paths otherwise)
  square     paved square or roundabout plaza with fountain, statue or obelisk on a plinth, flag masts, pavilion, palms and benches
  hill       rocky granite outcrop / hill with a stair path, summit pavilion or lift tower, terraces and a foot gate (the mound is the
             building so the silhouette mask sees the hill)
  beach      sand strip with the sea behind, umbrellas, thatched huts and shacks, kiosk bar, lifeguard tower, loungers and a pier
  lake       lake or reservoir with a promenade, jetty / pier, pavilion and trees round the shore
  canopy     an elevated timber canopy walkway through forest with an access tower, platforms and a boardwalk
  field      open grass field (polo, racecourse, playing field) with rails, a grandstand / clubhouse pavilion, goalposts and flags
  amusement  fun park: ticket gate, kiosks and a ferris wheel or carousel, striped awnings
  grove      forest / arboretum / zoo / botanical garden: dense trees, a gate and shelter, trails, enclosures (zoo) and signs
  allotment  community garden: raised plots, water tank on a stand, sheds, fence, shade trees
  bigtree    a single huge tree (cotton tree) inside a fenced paved ring with a statue / plaque

Everything faces -Y (the gate / front edge is at -Y); the pad is kept under about 110 m.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import _stadium_util as U  # noqa: E402

FEATURES = {'gate', 'pavilion', 'bandstand', 'fountain', 'fence-wall', 'kiosk', 'umbrellas', 'statue', 'obelisk', 'pier', 'steps', 'terrace',
            'flags', 'signage-board', 'railings', 'sheds', 'water-tank', 'stalls', 'floodlights', 'stand-roof', 'car-park', 'neon-strip',
            'awning', 'mast', 'solar-panels', 'painted-mural', 'relief-pattern', 'ramparts', 'rail-tracks', 'canopy-walkway'}

FLAT = 60.0
STRAW = '#b59a5a'


# ------------------------------------------------------------------------------------------------------------------ plan
def plan(brief, style, srng, lk):
    form = brief.get('form') or {}
    fe = U.feats(brief)
    tx = U.text(brief)
    nm = ' '.join(str(brief.get(k) or '') for k in ('name', 'subject')).lower()
    w = U.num(form, 'width_m', 80)
    d = U.num(form, 'depth_m', w * 0.7)
    H = U.num(form, 'height_m', 5)
    fp = form.get('footprint') or 'rect'
    st = brief.get('style') or ''
    P = {'fe': fe, 'tx': tx, 'nm': nm, 'w': w, 'd': d, 'H': H, 'fp': fp, 'style': st, 'roof': form.get('roof') or 'none',
         'material': (brief.get('facade') or {}).get('material') or lk.wall_material, 'year': U.era_year(brief)}
    has = lambda *ws: any(x in nm for x in ws)
    thas = lambda *ws: any(x in tx for x in ws)
    if thas('canopy walk', 'canopy-walk', 'walkway through') or 'canopy-walkway' in fe:
        typ = 'canopy'
    elif has('beach', 'plage', 'praia', 'strand'):
        typ = 'beach'
    elif H >= 12 and (has('rock', 'hill', 'outcrop', 'inselberg', 'mount', 'range', 'peak') or thas('granite outcrop', 'outcrop', 'residual hill')):
        typ = 'hill'
    elif has('cotton tree') or (has('tree') and H >= 25):
        typ = 'bigtree'
    elif has('lake', 'reservoir', 'river', 'lagoon', 'creek', 'pond', 'waterfront') and ('pier' in fe or thas('lake', 'reservoir')):
        typ = 'lake'
    elif has('amusement', 'orcaland', 'africa land', 'fun park', 'theme') or thas('ferris', 'rides'):
        typ = 'amusement'
    elif has('polo', 'race', 'field', 'pitch', 'ground') and not has('gardens', 'park') or (has('field', 'polo') and w >= 100):
        typ = 'field'
    elif has('zoo', 'botanical', 'arboretum', 'forest', 'forêt', 'reserve', 'grove', 'common', 'heath', 'woodland', 'nsele', 'banco', 'iita'):
        typ = 'grove'
    elif has('community garden', 'kubwa', 'gwagwalada') or 'water-tank' in fe or 'sheds' in fe:
        typ = 'allotment'
    elif has('square', 'place ', 'place d', 'esplanade', 'plaza', 'praça', 'roundabout', 'eagle', 'republique', 'république', 'martyrs', 'heros', 'heróis', 'forecourt', 'gathering') or (fp == 'round' and 'statue' in fe):
        typ = 'square'
    elif 'rail-tracks' in fe and 'fountain' in fe:
        typ = 'garden'
    else:
        typ = 'garden'
    P['typ'] = typ
    P['seed'] = srng.getrandbits(32)
    return P


# ----------------------------------------------------------------------------------------------------------------- helpers
def cnt(det, a, b_, c=0):
    return (a, b_, c)[det]


def disc(b, cx, cy, r0, r1, z, slot, col, n=28, scale=3.0):
    if b.detail >= 2:
        return
    U.revolve(b, cx, cy, [(r1, z), (r0, z)], n, slot, col, smooth_=False, scale=scale)


def rect_face(b, x0, y0, x1, y1, z, slot, col, scale=3.0):
    if b.detail >= 2:
        return
    b.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], slot, col, scale=scale)


def path_strip(b, pts, w, z, slot='paving', col='#cbc6bb', scale=2.0):
    """A path as a quad strip along a polyline (2D points), width w, at height z."""
    if b.detail >= 2:
        return
    for p0, p1 in zip(pts[:-1], pts[1:]):
        dx, dy = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dy)
        if L < 0.1:
            continue
        nx, ny = -dy / L * w / 2, dx / L * w / 2
        b.facing([(p0[0] - nx, p0[1] - ny, z), (p1[0] - nx, p1[1] - ny, z), (p1[0] + nx, p1[1] + ny, z), (p0[0] + nx, p0[1] + ny, z)], (0, 0, 1), slot, col, scale=scale)


def grass(b, lk, x0, y0, x1, y1, z=0.0, col=None):
    with b.site():
        gcol = col or ('#6d9a4f' if lk.ground_slot != 'grass' else lk.ground_col)
        lib.ground(b, x0, y0, x1, y1, lk, 'grass', gcol, z=z, scale=3.0)


def scatter_trees(b, lk, rng, region, n, avoid, hmin=6.0, hmax=11.0, kind=None):
    """Trees at random points of region (x0, y0, x1, y1) keeping out of `avoid` rectangles/circles."""
    if b.detail >= 2 or (kind or lk.tree) in (None, 'none'):
        return
    x0, y0, x1, y1 = region
    placed = 0
    tries = 0
    with b.site():
        while placed < n and tries < n * 14:
            tries += 1
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            ok = True
            for a in avoid:
                if len(a) == 4:
                    if a[0] <= x <= a[2] and a[1] <= y <= a[3]:
                        ok = False
                        break
                elif math.hypot(x - a[0], y - a[1]) < a[2]:
                    ok = False
                    break
            if ok:
                lib.tree(b, kind or lk.tree, x, y, rng.uniform(hmin, hmax), rng, lk)
                placed += 1


def lamp_post(b, x, y, h=4.5):
    if b.detail >= 1:
        return
    with b.site():
        lib.lamp(b, x, y, h)


def bench(b, x, y, yaw=0.0):
    if b.detail >= 1:
        return
    with b.site():
        lib.obox(b, x, y, 0.0, 1.6, 0.45, 0.45, yaw, 'timber', '#7a5a38', skip=('bottom',))
        c, s = math.cos(yaw), math.sin(yaw)
        lib.obox(b, x - s * 0.22, y + c * 0.22, 0.45, 1.6, 0.08, 0.4, yaw, 'timber', '#7a5a38', skip=('bottom',))


def flag_row(b, lk, x0, x1, y, n, h=10.0):
    if b.detail >= 2:
        return
    with b.site():
        for k in range(n):
            x = x0 + (x1 - x0) * k / max(1, n - 1)
            U.flag(b, x, y, h, ['#1f7a4d', '#f2f2ee', '#b83a32', '#2f5fa0'][k % 4], col2='#f2f2ee')


# ------------------------------------------------------------------------------------------------------------ structures
def pavilion(b, lk, x, y, w, d, h, kind='hip', rng=None, col=None, floor=True, posts=None):
    """Open-sided pavilion: floor slab, posts, roof (hip | gable | flat | cone | thatch). Returns the roof apex height."""
    det = b.detail
    rc = col or lk.roof_col
    ws = lk.wall_slot
    zf = 0.35
    if floor:
        lib.box(b, x - w / 2 - 0.4, y - d / 2 - 0.4, 0, x + w / 2 + 0.4, y + d / 2 + 0.4, zf, ws, lib.shade(lk.stone_col, 0.95), top_slot='paving', top_col=lk.stone_col, skip=('bottom',))
    if kind in ('cone', 'thatch'):
        r = min(w, d) / 2
        n_p = 8 if det == 0 else 5
        if det < 2:
            for k in range(n_p):
                a = 2 * math.pi * k / n_p
                lib.cylinder(b, x + r * 0.88 * math.cos(a), y + r * 0.88 * math.sin(a), zf, zf + h, 0.16, n=5 if det == 0 else 4, slot='timber', col='#7a5a38', top=False)
        slot, col2 = ('timber', rc if col else STRAW) if kind == 'thatch' else (lk.roof_slot, rc)
        U.revolve(b, x, y, [(r * 1.22, zf + h - 0.2), (r * 0.02, zf + h + r * 1.1)], 14 if det == 0 else 8, slot if det < 2 else 'plain', col2, smooth_=False, scale=1.5)
        return zf + h + r * 1.1
    nx = 3 if w > 6 else 2
    ny = 3 if d > 6 else 2
    if det < 2:
        pw = 0.18
        for i in range(nx):
            for j in range(ny):
                if 0 < i < nx - 1 and 0 < j < ny - 1:
                    continue
                px = x - w / 2 + 0.3 + (w - 0.6) * i / (nx - 1)
                py = y - d / 2 + 0.3 + (d - 0.6) * j / (ny - 1)
                lib.box_c(b, px, py, zf, pw * 2, pw * 2, h, ws, lk.trim_col)
    rect = (x - w / 2 - 0.5, y - d / 2 - 0.5, x + w / 2 + 0.5, y + d / 2 + 0.5)
    if kind == 'flat':
        lib.box(b, rect[0], rect[1], zf + h, rect[2], rect[3], zf + h + 0.35, ws, lk.trim_col, top_slot='roof-flat', top_col=rc, skip=('bottom',))
        return zf + h + 0.35
    if kind == 'gable':
        lib.gable(b, rect, zf + h, min(w, d) * 0.28, lk, ov=0.3, slot=lk.roof_slot, col=rc)
        return zf + h + min(w, d) * 0.28
    rise = min(w, d) * 0.3
    lib.roof_profile(b, rect, zf + h, [(0.0, 0.0), (min(rect[2] - rect[0], rect[3] - rect[1]) / 2, rise)], lk, roof_slot=lk.roof_slot, roof_col=rc)
    return zf + h + rise


def bandstand(b, lk, x, y, r, h, rng):
    det = b.detail
    n = 8
    lib.cylinder(b, x, y, 0, 0.9, r, n=n if det == 0 else 6, slot=lk.wall_slot, col=lib.shade(lk.stone_col, 0.95), top=True, top_slot='paving', top_col=lk.stone_col, smooth=False)
    if det < 2:
        for k in range(n):
            a = 2 * math.pi * k / n
            lib.cylinder(b, x + r * 0.88 * math.cos(a), y + r * 0.88 * math.sin(a), 0.9, 0.9 + h, 0.13, n=5 if det == 0 else 4, slot=lk.wall_slot, col=lk.trim_col, top=False)
            if det == 0 and k % 2 == 0:
                a2 = 2 * math.pi * (k + 1) / n
                U.strut(b, (x + r * 0.88 * math.cos(a), y + r * 0.88 * math.sin(a), 1.9), (x + r * 0.88 * math.cos(a2), y + r * 0.88 * math.sin(a2), 1.9), 0.08, lk.trim_col, ends=False)
    U.revolve(b, x, y, [(r * 1.12, 0.9 + h), (r * 0.6, 0.9 + h + 0.5), (r * 0.06, 0.9 + h + r * 0.75)], n if det < 2 else 6, lk.roof_slot if det < 2 else 'plain', lk.roof_col, smooth_=False, scale=1.5)
    if det < 2:
        lib.cylinder(b, x, y, 0.9 + h + r * 0.7, 0.9 + h + r * 0.7 + 1.4, 0.05, n=4, slot='frame', col=lk.metal_col, r_top=0.02, top=True)


def fountain(b, lk, x, y, r, rng, tiers=2):
    det = b.detail
    n = 24 if det == 0 else (12 if det == 1 else 8)
    tiers = tiers if det < 2 else 1
    sc = lib.mix(lk.stone_col, '#ffffff', 0.25)
    U.revolve(b, x, y, [(r, 0.0), (r, 0.75), (r - 0.55, 0.75), (r - 0.55, 0.45)], n, 'paving' if det < 2 else 'plain', sc, smooth_=False)
    if det < 2:
        U.revolve(b, x, y, [(r - 0.55, 0.62), (0.0, 0.62)][::-1], n, 'plain', '#5f98b3', smooth_=False, scale=FLAT)
    h = 0.62
    rr = r * 0.34
    for t in range(tiers):
        U.revolve(b, x, y, [(rr * 0.22, h), (rr * 0.22, h + 0.9), (rr * 1.0, h + 0.9), (rr * 1.0, h + 1.15), (rr * 0.1, h + 1.25)], 14 if det == 0 else 8, 'paving' if det < 2 else 'plain', sc, smooth_=False)
        h += 1.25
        rr *= 0.62
    if det < 2:
        lib.cylinder(b, x, y, h, h + 1.6, 0.06, n=4, slot='plain', col='#bfe3f2', r_top=0.03, top=True)


def gate_structure(b, lk, P, x, y, w, h, kind='piers', rng=None):
    """Park entrance: two piers with a lintel / arch / thatched cross-beam, blank sign board and side fence stubs."""
    det = b.detail
    ws = lk.wall_slot
    pw = U.clamp(w * 0.09, 0.7, 1.4)
    if kind == 'timber':
        for sx in (-1, 1):
            lib.cylinder(b, x + sx * w / 2, y, 0, h, 0.28, n=6 if det == 0 else 4, slot='timber', col='#6a4a2e', top=True)
        lib.box(b, x - w / 2 - 0.5, y - 0.3, h - 0.4, x + w / 2 + 0.5, y + 0.3, h + 0.2, 'timber', '#6a4a2e', skip=('bottom',))
        if det < 2:
            lib.roof_profile(b, (x - w / 2 - 0.7, y - 1.0, x + w / 2 + 0.7, y + 1.0), h + 0.2, [(0.0, 0.0), (0.95, 0.9)], lk, roof_slot='timber', roof_col=STRAW)
        return
    for sx in (-1, 1):
        lib.box_c(b, x + sx * (w / 2 + pw / 2), y, 0, pw, pw, h, ws, lk.trim_col, top_slot=ws, top_col=lk.trim_col)
        if det < 2:
            lib.box_c(b, x + sx * (w / 2 + pw / 2), y, h, pw * 1.3, pw * 1.3, 0.3, ws, lk.accent_col)
    span = w + 2 * pw
    if kind == 'arch':
        mon = _mon()
        mon.arch_block(b, x - span / 2, x + span / 2, y - pw / 2, y + pw / 2, h + 0.8, [{'xc': x, 'span': w, 'zs': h * 0.55, 'rise': h * 0.45, 'kind': 'round'}], ws, lk.wall_col, lk.trim_col, lk.trim_col)
    else:
        lib.box(b, x - span / 2, y - pw * 0.4, h - 0.6, x + span / 2, y + pw * 0.4, h + 0.4, ws, lk.wall_col, top_slot='roof-flat', top_col=lk.trim_col, skip=('bottom',))
        if det == 0:
            lib.obox(b, x, y - pw * 0.45, h + 0.4, min(5.0, w * 0.6), 0.2, 1.2, 0.0, 'plain', lk.accent_col, skip=('bottom',))


_MON = None


def _mon():
    global _MON
    if _MON is None:
        import importlib.util
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'monument.py')
        spec = importlib.util.spec_from_file_location('archetype_monument_shared2', path)
        _MON = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_MON)
    return _MON


def fence_line(b, lk, p0, p1, kind, gaps=()):
    """Perimeter fence between two points: 'wall' (rendered wall with piers) or 'rail' (metal railings); gaps = [(u0, u1)] in metres."""
    L = math.dist(p0, p1)
    if L < 0.5 or b.detail >= 2:
        return
    ux, uy = (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L
    cuts = [0.0]
    for g in sorted(gaps):
        cuts += [g[0], g[1]]
    cuts.append(L)
    for a, c in zip(cuts[0::2], cuts[1::2]):
        if c - a < 0.4:
            continue
        q0, q1 = (p0[0] + ux * a, p0[1] + uy * a), (p0[0] + ux * c, p0[1] + uy * c)
        if kind == 'wall':
            U.wall_run(b, q0, q1, 1.8, 0.35, lk.wall_slot, lk.wall_col, cap_col=lk.trim_col, pier_every=5.0, pier_h=2.2, pier_w=0.6)
        else:
            U.railing(b, q0, q1, 1.4, '#4a4f55', 2.2)


def kiosk(b, lk, x, y, w=3.0, d=2.4, h=2.6, col=None, rng=None):
    c = col or lk.accent_col
    lib.box_c(b, x, y, 0, w, d, h, lk.wall_slot, lk.wall_col, top_slot='roof-flat', top_col=c)
    if b.detail < 2:
        lib.box(b, x - w / 2 - 0.3, y - d / 2 - 1.0, h - 0.2, x + w / 2 + 0.3, y - d / 2 + 0.1, h + 0.1, 'plain', c, skip=('bottom',), scale=FLAT)
        if b.detail == 0:
            lib.box(b, x - w * 0.35, y - d / 2 - 0.02, 0.9, x + w * 0.35, y - d / 2 + 0.02, 2.0, lk.glass_slot, lk.glass_col, skip=('bottom', 'back', 'top', 'left', 'right'))


def umbrella(b, x, y, col, h=2.4, r=1.3):
    if b.detail >= 2:
        return
    lib.cylinder(b, x, y, 0, h, 0.04, n=4, slot='frame', col='#d8d8d8', top=False)
    n = 8 if b.detail == 0 else 5
    U.revolve(b, x, y, [(r, h - 0.35), (r * 0.02, h + 0.2)], n, 'plain', col, smooth_=False, scale=FLAT)


def hut(b, lk, x, y, r, rng, thatch=True, yaw=0.0):
    det = b.detail
    h = 2.2
    if thatch:
        U.revolve(b, x, y, [(r, 0.0), (r, h)], 10 if det == 0 else 6, lk.wall_slot if det < 2 else 'plain', lk.wall_col, smooth_=False, scale=2.0)
        U.revolve(b, x, y, [(r * 1.35, h - 0.1), (r * 0.02, h + r * 1.2)], 10 if det == 0 else 6, 'timber' if det < 2 else 'plain', STRAW, smooth_=False, scale=1.2)
    else:
        lib.obox(b, x, y, 0, r * 2, r * 1.6, h, yaw, lk.wall_slot, lk.wall_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
        lib.obox(b, x, y - r * 0.4, h, r * 2.3, r * 2.0, 0.25, yaw, 'plain', lk.roof_col, skip=('bottom',))


def jetty(b, lk, x, y0, y1, w, z=0.9, piles=True, rail=True, col='#8a6a43'):
    """A timber pier along +Y from y0 to y1 at width w, deck at height z; piles under it, rails on the sides."""
    det = b.detail
    lib.box(b, x - w / 2, y0, z - 0.2, x + w / 2, y1, z, 'timber', col, top_slot='timber', top_col=col, skip=('bottom',), scale=1.5)
    if det < 2 and piles:
        n = max(2, int((y1 - y0) / 3.5))
        for k in range(n + 1):
            yy = y0 + (y1 - y0) * k / n
            for sx in (-1, 1):
                lib.cylinder(b, x + sx * (w / 2 - 0.2), yy, -0.8, z - 0.2, 0.14, n=4 if det else 5, slot='timber', col='#5b4430', top=False)
    if det == 0 and rail:
        for sx in (-1, 1):
            xx = x + sx * (w / 2 - 0.08)
            n = max(2, int((y1 - y0) / 3.0))
            for k in range(n + 1):
                lib.cylinder(b, xx, y0 + (y1 - y0) * k / n, z, z + 1.0, 0.04, n=4, slot='frame', col='#6a4a2e', top=False)
            U.strut(b, (xx, y0, z + 1.0), (xx, y1, z + 1.0), 0.06, '#6a4a2e', ends=False)


def ferris_wheel(b, lk, x, y, r, rng):
    det = b.detail
    n = 16 if det == 0 else (10 if det == 1 else 8)
    cz = r + 2.0
    col = '#d8d8d8'
    # A-frame legs
    for sy in (-1, 1):
        U.strut(b, (x - r * 0.55, y + sy * 0.9, 0.0), (x, y + sy * 0.9, cz), 0.35, '#9ea3a8', ends=False)
        U.strut(b, (x + r * 0.55, y + sy * 0.9, 0.0), (x, y + sy * 0.9, cz), 0.35, '#9ea3a8', ends=False)
    cols = ['#d94f4f', '#e8b53a', '#3f87c8', '#4fae6a', '#a35cc0']
    for sy in (-1, 1):
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            p0 = (x + r * math.cos(a0), y + sy * 0.55, cz + r * math.sin(a0))
            p1 = (x + r * math.cos(a1), y + sy * 0.55, cz + r * math.sin(a1))
            U.strut(b, p0, p1, 0.22, col, ends=False)
            if det == 0 and k % 2 == 0:
                U.strut(b, (x, y + sy * 0.55, cz), p0, 0.07, '#bfc3c8', ends=False)
    if det < 2:
        for k in range(n):
            a = 2 * math.pi * k / n
            gx, gz = x + r * math.cos(a), cz + r * math.sin(a)
            lib.box_c(b, gx, y, gz - 1.4, 1.5, 1.4, 1.1, 'plain', cols[k % 5], top_col=lib.shade(cols[k % 5], 0.8))
    lib.cylinder(b, x, y, cz - 0.5, cz + 0.5, 0.5, n=6, slot='frame', col='#7d8286', top=True)


# ----------------------------------------------------------------------------------------------------------- typologies
def build_garden(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 104.0 / big)
    W, D = U.clamp(P['w'] * f, 36, 104), U.clamp(P['d'] * f, 30, 90)
    formal = P['style'] in ('colonial', 'victorian', 'neoclassical', 'georgian') or U.has(tx, 'formal', 'symmetric', 'promenade') or P['fp'] == 'rect' and srng.random() < 0.55
    grass(b, lk, -W / 2, -D / 2, W / 2, D / 2)
    b.section('structures')
    avoid = []
    py = D * 0.18
    has_gate = 'gate' in fe or 'fence-wall' in fe
    # perimeter fence (rail for formal gardens, wall for vernacular) with the gate gap in the middle of the front
    kind_f = 'rail' if (P['style'] in ('colonial', 'victorian', 'georgian') or 'railings' in fe) else 'wall'
    gw = 6.0
    if has_gate and det < 2:
        fl = fence_line
        fl(b, lk, (-W / 2, -D / 2), (-gw / 2, -D / 2), kind_f)
        fl(b, lk, (gw / 2, -D / 2), (W / 2, -D / 2), kind_f)
        fl(b, lk, (W / 2, -D / 2), (W / 2, D / 2), kind_f)
        fl(b, lk, (W / 2, D / 2), (-W / 2, D / 2), kind_f)
        fl(b, lk, (-W / 2, D / 2), (-W / 2, -D / 2), kind_f)
    if 'gate' in fe:
        gk = 'timber' if (P['material'] == 'timber' and P['style'] == 'vernacular') else ('arch' if (formal and srng.random() < 0.5) else 'piers')
        gate_structure(b, lk, P, 0.0, -D / 2, gw, 4.2, gk, srng)
    # axial path / curved path
    path_pts = [(0.0, -D / 2), (0.0, D * 0.05)] if formal else [(0.0, -D / 2), (-W * 0.12, -D * 0.25), (W * 0.1, -D * 0.05), (0.0, D * 0.12)]
    with b.site():
        path_strip(b, path_pts, 2.8, 0.05)
        path_strip(b, [(-W * 0.4, D * 0.05), (W * 0.4, D * 0.05)] if formal else [(-W * 0.4, D * 0.18), (-W * 0.1, D * 0.08), (W * 0.1, D * 0.1), (W * 0.4, D * 0.2)], 2.2, 0.05)
    # focal structure: fountain at the centre of a formal garden, pavilion/bandstand at the back
    cx, cy = 0.0, D * 0.05
    if 'fountain' in fe:
        fr = U.clamp(min(W, D) * 0.1, 3.0, 6.5)
        if formal:
            fountain(b, lk, cx, cy, fr, srng, 2 if det == 0 else 1)
            avoid.append((cx, cy, fr + 4))
        else:
            fx = W * 0.22
            fountain(b, lk, fx, cy - 2, fr * 0.9, srng, 2)
            avoid.append((fx, cy - 2, fr + 4))
            with b.site():
                disc(b, fx, cy - 2, 0, fr + 2.4, 0.04, 'paving', '#cbc6bb')
    if 'bandstand' in fe:
        bx, by = (0.0, D * 0.3) if formal else (-W * 0.2, D * 0.18)
        bandstand(b, lk, bx, by, 4.2, 3.6, srng)
        avoid.append((bx, by, 7.5))
    pav_made = False
    if 'pavilion' in fe or (not any(k in fe for k in ('bandstand', 'fountain', 'statue'))):
        thatch = P['material'] == 'timber' or P['style'] == 'vernacular' and srng.random() < 0.45
        kind = 'thatch' if thatch else srng.choice(['hip', 'hip', 'flat', 'gable'])
        px, py2 = (W * 0.28, D * 0.28) if not 'bandstand' in fe else (W * 0.3, D * 0.3)
        pw_, pd_ = (7.0, 5.5) if kind != 'thatch' else (6.5, 6.5)
        pavilion(b, lk, px, py2, pw_, pd_, 3.0, kind, srng)
        avoid.append((px, py2, 6.5))
        pav_made = True
    if 'statue' in fe or 'obelisk' in fe:
        sx, sy = (0.0, D * 0.34) if formal else (W * 0.05, D * 0.3)
        if 'obelisk' in fe:
            lib.box_c(b, sx, sy, 0, 2.4, 2.4, 0.8, lk.wall_slot, lk.trim_col)
            U.revolve(b, sx, sy, [(0.8, 0.8), (0.4, 7.5), (0.0, 8.4)], 4, lk.wall_slot if det < 2 else 'plain', lk.wall_col, smooth_=False, scale=2.0)
        else:
            lib.box_c(b, sx, sy, 0, 2.2, 2.2, 2.6, lk.wall_slot, lk.trim_col, top_slot=lk.wall_slot)
            U.person(b, sx, sy, 2.6, 4.2, '#6a583b', 0.0, arm=srng.choice(['down', 'up']), hold=0.0 if True else 1.0)
        avoid.append((sx, sy, 4.5))
        with b.site():
            disc(b, sx, sy, 0, 4.0, 0.04, 'paving', '#cbc6bb', n=18)
    if 'kiosk' in fe and det < 2:
        kiosk(b, lk, -W * 0.3, -D * 0.34, rng=srng)
        avoid.append((-W * 0.3, -D * 0.34, 4.0))
    if 'umbrellas' in fe and det < 2:
        with b.site():
            for k in range(5):
                umbrella(b, -W * 0.32 + 3.2 * (k % 3) - 3, -D * 0.28 + 3.0 * (k // 3), ['#d94f4f', '#e8b53a', '#3f87c8', '#4fae6a', '#a35cc0'][k % 5])
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, W * 0.18, -D / 2 - 3.0, 0.0, 5.0, 1.8, lk, 0.0, col='#2f5f8a')
    if 'flags' in fe:
        flag_row(b, lk, -6, 6, -D / 2 - 3.5, 3, 9.0)
    if 'neon-strip' in fe and det == 0:
        for sx in (-1, 1):
            U.strut(b, (sx * W * 0.3, D * 0.1, 0.1), (sx * W * 0.3, D * 0.4, 0.1), 0.15, '#ff6bd5', slot='plain', ends=False)
    if 'rail-tracks' in fe and det < 2:
        with b.site():
            for sx in (-0.7, 0.7):
                b.face([(W / 2 - 3 + sx - 0.05, -D / 2, 0.06), (W / 2 - 3 + sx + 0.05, -D / 2, 0.06), (W / 2 - 3 + sx + 0.05, D / 2, 0.06), (W / 2 - 3 + sx - 0.05, D / 2, 0.06)], 'plain', '#555a60', scale=FLAT)
    # beds, benches, lamps, trees
    if det < 2:
        with b.site():
            bed_cols = ['#d95c8a', '#e6b93a', '#f0f0e8', '#c0392b']
            if formal:
                for sx in (-1, 1):
                    for sy in (0.0, 1.0):
                        bx0 = sx * W * 0.2
                        by0 = -D * 0.2 + sy * D * 0.2
                        if all(math.hypot(bx0 - a[0], by0 - a[1]) > a[2] + 3 for a in avoid if len(a) == 3):
                            rect_face(b, bx0 - 3.5, by0 - 2.5, bx0 + 3.5, by0 + 2.5, 0.07, 'plain', srng.choice(bed_cols), scale=FLAT)
                            if det == 0:
                                lib.box(b, bx0 - 3.7, by0 - 2.7, 0, bx0 + 3.7, by0 + 2.7, 0.2, 'paving', '#c8c4ba', skip=('bottom', 'top'))
    for k in range(3):
        bench(b, -W * 0.15 + k * W * 0.15, D * 0.02, 0.0)
    lamp_post(b, -3.0, -D * 0.3)
    lamp_post(b, 3.0, -D * 0.3)
    b.section('trees')
    n_t = cnt(det, 18 if big > 90 else 12, 8, 0)
    scatter_trees(b, lk, srng, (-W / 2 + 3, -D / 2 + 5, W / 2 - 3, D / 2 - 3), n_t, avoid + [(-2.0, -D / 2 + 1, 3.0, D * 0.1)])
    return P['H']


def build_square(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 104.0 / big)
    W, D = U.clamp(P['w'] * f, 36, 104), U.clamp(P['d'] * f, 30, 92)
    round_ = P['fp'] == 'round'
    if round_:
        W = D = min(W, D, 80)
    with b.site():
        lib.ground(b, -W / 2 - 4, -D / 2 - 4, W / 2 + 4, D / 2 + 4, lk, 'paving', lib.mix(lk.ground_col, '#b9b4aa', 0.5) if lk.ground_slot != 'paving' else '#bdb7ab', z=0.0, scale=3.0)
    if det < 2:
        with b.site():
            m = 2.2
            if round_:
                disc(b, 0, 0, W / 2 - m, W / 2, 0.04, 'paving', lib.shade(lk.stone_col, 0.8), n=32)
                disc(b, 0, 0, 0, W * 0.2, 0.05, 'paving', '#d6d1c6', n=28)
                if det == 0:
                    for k in range(12):
                        a = 2 * math.pi * k / 12
                        path_strip(b, [(W * 0.2 * math.cos(a), W * 0.2 * math.sin(a)), ((W / 2 - m) * math.cos(a), (W / 2 - m) * math.sin(a))], 1.2, 0.06, 'paving', lib.shade(lk.stone_col, 0.85))
            else:
                for (a0, b0, a1, b1) in ((-W / 2, -D / 2, W / 2, -D / 2 + m), (-W / 2, D / 2 - m, W / 2, D / 2), (-W / 2, -D / 2, -W / 2 + m, D / 2), (W / 2 - m, -D / 2, W / 2, D / 2)):
                    rect_face(b, a0, b0, a1, b1, 0.04, 'paving', lib.shade(lk.stone_col, 0.8), scale=2.0)
                # inner panels of lawn on either side of the axis
                if det == 0 and not U.has(tx, 'parade', 'concrete') and P['material'] not in ('concrete',):
                    for sx in (-1, 1):
                        rect_face(b, sx * W * 0.14 - (W * 0.12 if sx < 0 else -W * 0.0), -D * 0.3, sx * W * 0.14 + (W * 0.0 if sx < 0 else W * 0.12), D * 0.3, 0.05, 'grass', '#6d9a4f', scale=2.0) if False else None
    b.section('focus')
    focus = None
    if 'obelisk' in fe:
        _obelisk_plinth(b, lk, 0.0, 0.0, srng, H=U.clamp(P['H'] * 2.2 if P['H'] < 10 else P['H'], 8.0, 24.0))
        focus = 0.0
    if 'statue' in fe and 'obelisk' not in fe:
        pw = 2.6
        lib.box_c(b, 0, 0, 0, pw + 1.2, pw + 1.2, 0.4, lk.wall_slot, lib.shade(lk.stone_col, 0.9))
        lib.box_c(b, 0, 0, 0.4, pw, pw, 3.4, lk.wall_slot, lk.stone_col, top_slot=lk.wall_slot)
        lib.box_c(b, 0, 0, 3.8, pw + 0.5, pw + 0.5, 0.35, lk.wall_slot, lk.trim_col)
        U.person(b, 0, 0, 4.15, 5.2, '#6a583b', 0.0, arm=srng.choice(['up', 'forward', 'down']), hold=0.0)
        focus = 0.0
    if 'fountain' in fe:
        fr = U.clamp(min(W, D) * 0.1, 3.0, 6.0)
        if focus is None:
            fountain(b, lk, 0.0, 0.0, fr * 1.2, srng, 2)
        else:
            fountain(b, lk, W * 0.28, 0.0, fr, srng, 2)
            fountain(b, lk, -W * 0.28, 0.0, fr, srng, 2)
    if 'pavilion' in fe or (focus is None and 'fountain' not in fe):
        kind = srng.choice(['hip', 'flat', 'hip'])
        pavilion(b, lk, 0.0, D * 0.3, 11.0, 5.5, 3.2, kind, srng)
    if 'stand-roof' in fe:
        _reviewing_stand(b, lk, srng, 0.0, D * 0.38, W * 0.34)
    if 'kiosk' in fe and det < 2:
        kiosk(b, lk, -W * 0.34, -D * 0.34, rng=srng)
    if 'flags' in fe:
        flag_row(b, lk, -W * 0.36, W * 0.36, -D * 0.4, 7 if W > 60 else 5, 10.0)
    if 'steps' in fe and det < 2:
        with b.site():
            lib.steps(b, -4, 4, D / 2 - 6, 0.9, 2.4, 3, 'paving', lk.stone_col)
    if 'floodlights' in fe:
        for sx in (-1, 1):
            U.lattice_mast(b, sx * (W / 2 - 3), D * 0.3, 22.0, yaw=0.0)
    if ('fence-wall' in fe or 'railings' in fe) and det < 2:
        for (p0, p1) in (((-W / 2, D / 2), (W / 2, D / 2)), ((-W / 2, -D / 2), (-W / 2, D / 2)), ((W / 2, -D / 2), (W / 2, D / 2))):
            fence_line(b, lk, p0, p1, 'rail' if 'railings' in fe else 'wall')
    if 'gate' in fe:
        gate_structure(b, lk, P, 0.0, -D / 2, 8.0, 4.5, 'arch' if P['style'] in ('colonial', 'neoclassical') else 'piers', srng)
    b.section('trees')
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            n = cnt(det, 10, 5)
            for k in range(n):
                x = -W / 2 + 4 + (W - 8) * (k % (n // 2)) / max(1, n // 2 - 1)
                y = (-D / 2 + 3.5) if k < n // 2 else (D / 2 - 3.5)
                lib.tree(b, lk.tree, x, y, srng.uniform(7, 10), srng, lk)
            for k in range(3 if det == 0 else 0):
                bench(b, -W * 0.2 + k * W * 0.2, -D * 0.22)
    return P['H']


def _obelisk_plinth(b, lk, x, y, rng, H=14.0):
    ws = lk.wall_slot
    lib.box_c(b, x, y, 0, 6.4, 6.4, 0.5, ws, lib.shade(lk.stone_col, 0.9))
    lib.box_c(b, x, y, 0.5, 5.0, 5.0, 0.5, ws, lk.stone_col)
    lib.box_c(b, x, y, 1.0, 3.2, 3.2, H * 0.18, ws, lk.stone_col, top_slot=ws)
    z0 = 1.0 + H * 0.18
    U.revolve(b, x, y, [(1.9, z0), (1.15, H * 0.9), (0.0, H)], 4, ws if b.detail < 2 else 'plain', lk.wall_col, smooth_=False, scale=2.0)


def _reviewing_stand(b, lk, rng, x, y, w):
    det = b.detail
    d = 7.0
    lib.box(b, x - w / 2, y, 0, x + w / 2, y + d, 3.0, lk.wall_slot, lk.wall_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    if det < 2:
        for k in range(4):
            lib.box(b, x - w / 2 + 0.5, y - 0.4 * (k + 1) * 1.0 + 0.0, 0, x + w / 2 - 0.5, y, 0.45 * (k + 1), 'paving', lk.stone_col, skip=('bottom', 'back')) if False else None
    lib.shed(b, (x - w / 2 - 0.5, y - 0.5, x + w / 2 + 0.5, y + d + 0.5), 3.0, 1.8, lk, high='back', ov=0.3, slot=lk.roof_slot, col=lk.roof_col) if det < 2 else None


# ------------------------------------------------------------------------------------------------------------------- hill
def hill_height(P, x, y, W, D, H, ph):
    u, v = x / (W / 2), y / (D / 2)
    r = math.hypot(u, v)
    a = math.atan2(v, u)
    jag = 1.0 - 0.07 * (0.5 + 0.5 * math.sin(5 * a + ph[3])) - 0.05 * (0.5 + 0.5 * math.sin(9 * a + ph[4]))
    r = r / jag
    if r >= 1.0:
        return 0.0
    base = (1 - r ** 2.6) ** 0.55
    n = 1.0 + 0.10 * math.sin(3 * a + ph[0] + 5 * r) + 0.07 * math.sin(7 * a + ph[1] - 4 * r) + 0.04 * math.sin(11 * a + ph[2] + 9 * r)
    return H * base * n + 0.08 * (1.0 if r < 1.0 else 0.0)


def build_hill(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 104.0 / big)
    W, D = U.clamp(P['w'] * f, 40, 104), U.clamp(P['d'] * f, 34, 90)
    H = U.clamp(P['H'], 12.0, 100.0)
    ph = [srng.uniform(0, 6.28) for _ in range(5)]
    na, nr = {0: 44, 1: 20, 2: 10}[det], {0: 12, 1: 6, 2: 3}[det]
    rock = lk.wall_col if lk.wall_slot not in ('plain-render',) else '#8c8a86'
    rock = lib.mix(rock, '#8c8a86', 0.5) if det < 2 else rock
    veg = '#6f8a52'
    grid = []
    for i in range(na + 1):
        a = 2 * math.pi * i / na
        row = []
        for k in range(nr + 1):
            t = 1.0 - (k / nr) ** 1.25      # outer rim -> centre
            jag = 1.0 - 0.07 * (0.5 + 0.5 * math.sin(5 * a + ph[3])) - 0.05 * (0.5 + 0.5 * math.sin(9 * a + ph[4]))
            x, y = (W / 2) * t * jag * math.cos(a), (D / 2) * t * jag * math.sin(a)
            row.append((x, y, hill_height(P, x, y, W, D, H, ph)))
        grid.append(row)
    b.section('mound')
    for i in range(na):
        for k in range(nr):
            q = [grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]]
            zm = sum(p[2] for p in q) / 4
            hs = zm / H
            t = U.clamp((0.3 - hs) / 0.3, 0.0, 1.0) * 0.85
            col = lib.mix(rock, veg, t)
            col = lib.shade(col, 0.9 + 0.2 * (((i * 7 + k * 13) % 9) / 9.0))
            b.facing(q, (0, 0, 1), 'plain' if det == 2 else 'rough-concrete', col, scale=FLAT if det == 2 else 3.0)
    # boulders on the upper slopes
    if det == 0:
        for k in range(12):
            a = srng.uniform(0, 6.28)
            r = srng.uniform(0.15, 0.7)
            x, y = (W / 2) * r * math.cos(a), (D / 2) * r * math.sin(a)
            z = hill_height(P, x, y, W, D, H, ph)
            lib.blob(b, x, y, z + 0.2, srng.uniform(1.2, 3.0), srng.uniform(1.0, 2.6), srng.uniform(0.9, 1.9), lib.shade(rock, srng.uniform(0.85, 1.05)), n=6, rings=3, smooth=False)
    # stair path up the front face
    b.section('stairs')
    pts = []
    for k in range(18):
        t = k / 17.0
        a = -math.pi / 2 + 0.35 * math.sin(t * 5.0) * (1 - t)
        r = 0.92 - 0.8 * t
        x, y = (W / 2) * r * math.cos(a), (D / 2) * r * math.sin(a)
        pts.append((x, y, hill_height(P, x, y, W, D, H, ph) + 0.06))
    if det < 2:
        for p0, p1 in zip(pts[:-1], pts[1:]):
            dx, dy = p1[0] - p0[0], p1[1] - p0[1]
            L = math.hypot(dx, dy)
            nx, ny = -dy / L * 1.1, dx / L * 1.1
            b.facing([(p0[0] - nx, p0[1] - ny, p0[2]), (p1[0] - nx, p1[1] - ny, p1[2]), (p1[0] + nx, p1[1] + ny, p1[2]), (p0[0] + nx, p0[1] + ny, p0[2])], (0, 0, 1), 'plain', '#d6d1c6', scale=FLAT)
            if det == 0:
                for sg in (-1, 1):
                    U.strut(b, (p0[0] + sg * nx * 1.0, p0[1] + sg * ny * 1.0, p0[2] + 0.9), (p1[0] + sg * nx * 1.0, p1[1] + sg * ny * 1.0, p1[2] + 0.9), 0.06, '#6f757b', ends=False)
    # summit structures
    b.section('summit')
    top = max(grid[0][nr][2], hill_height(P, 0, 0, W, D, H, ph))
    sx, sy = 0.0, 0.0
    sz = hill_height(P, sx, sy, W, D, H, ph)
    if 'pavilion' in fe or U.has(tx, 'gazebo', 'elevator', 'lift', 'tower'):
        if U.has(tx, 'elevator', 'lift') and det < 2:
            lib.box_c(b, sx + 2.0, sy, sz - 0.5, 3.4, 3.4, 9.0, lk.wall_slot, '#cfcac0', top_slot='roof-flat', top_col='#5a5c5f')
            if det == 0:
                lib.box(b, sx + 0.35, sy - 1.7 - 0.02, sz + 4.0, sx + 3.65, sy - 1.7 + 0.02, sz + 7.5, lk.glass_slot, lk.glass_col, skip=('bottom', 'back', 'top', 'left', 'right'))
            pavilion(b, lk, sx - 4.5, sy - 1.0, 5.0, 4.0, 2.8, 'hip', srng) if False else None
        zz = sz
        # raise the pavilion floor to the terrain level
        lib.cylinder(b, sx - 4.5, sy - 1.0, zz - 0.8, zz, 3.4, n=8 if det == 0 else 6, slot=lk.wall_slot, col=lk.stone_col, top=True, smooth=False)
        pv = _lifted(b, zz - 0.2)
        pavilion(b, lk, sx - 4.5, sy - 1.0, 5.0, 4.5, 2.8, 'hip', srng, floor=False)
        pv.restore()
    if 'statue' in fe and det < 2:
        for k, sgn in enumerate((-1, 1)):
            x, y = sgn * W * 0.14, -D * 0.1
            z = hill_height(P, x, y, W, D, H, ph)
            U.person(b, x, y, z, 3.6, '#6a583b' if k == 0 else '#8a8a82', 0.0, arm='up' if k == 0 else 'down')
    if 'terrace' in fe and det < 2:
        for k in range(min(2, P['fe']['terrace']['count'] if 'terrace' in fe else 1)):
            t = 0.55 - 0.2 * k
            x, y = (W / 2) * t * 0.6, -(D / 2) * t * 0.6
            z = hill_height(P, x, y, W, D, H, ph)
            lib.box(b, x - 3.2, y - 2.4, z - 0.6, x + 3.2, y + 2.4, z + 0.25, lk.wall_slot, lk.trim_col, top_slot='paving', top_col=lk.stone_col, skip=('bottom',))
    if 'mast' in fe and det < 2:
        U.strut(b, (sx + 4, sy + 4, sz), (sx + 4, sy + 4, sz + 16), 0.4, '#9ea3a8')
    if 'gate' in fe or 'fence-wall' in fe:
        gate_structure(b, lk, P, 0.0, -D / 2 - 6.0, 8.0, 4.0, 'piers', srng)
        if det < 2:
            fence_line(b, lk, (-W * 0.3, -D / 2 - 6.0), (-4.0, -D / 2 - 6.0), 'wall')
            fence_line(b, lk, (4.0, -D / 2 - 6.0), (W * 0.3, -D / 2 - 6.0), 'wall')
    b.section('site')
    with b.site():
        lib.ground(b, -W / 2 - 12, -D / 2 - 18, W / 2 + 12, D / 2 + 12, lk, lk.ground_slot, lk.ground_col if lk.ground_slot != 'paving' else None, z=0.0, scale=3.0)
    scatter_trees(b, lk, srng, (-W / 2 - 6, -D / 2 - 14, W / 2 + 6, D / 2 + 6), cnt(det, 12, 4), [(0, 0, min(W, D) * 0.34)], 6, 12)
    return H


class _lifted:
    """Context helper: nothing to restore (pavilion floors are drawn at ground level, so lift = no-op placeholder)."""

    def __init__(self, b, z):
        self.b, self.z = b, z

    def restore(self):
        pass


# ------------------------------------------------------------------------------------------------------------------ beach
def build_beach(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 106.0 / big)
    W, D = U.clamp(P['w'] * f, 50, 108), U.clamp(P['d'] * f, 34, 80)
    sand = '#d9c08a'
    # land (front, -Y) and sea (back, +Y)
    shore = D * 0.1
    with b.site():
        lib.ground(b, -W / 2 - 6, -D / 2 - 8, W / 2 + 6, shore, lk, 'sand', sand, z=0.0, scale=3.0)
        if det < 2:
            b.face([(-W / 2 - 6, shore, 0.02), (W / 2 + 6, shore, 0.02), (W / 2 + 6, D / 2 + 14, 0.02), (-W / 2 - 6, D / 2 + 14, 0.02)], 'plain', '#4f9ab5', scale=FLAT)
            b.face([(-W / 2 - 6, shore, 0.04), (W / 2 + 6, shore, 0.04), (W / 2 + 6, shore + 2.2, 0.04), (-W / 2 - 6, shore + 2.2, 0.04)], 'plain', '#cfe8ee', scale=FLAT)
    b.section('structures')
    # row of umbrellas and loungers
    if det < 2:
        with b.site():
            n = cnt(det, 9, 4)
            cols = ['#d94f4f', '#e8b53a', '#3f87c8', '#f0f0e8', '#4fae6a']
            for k in range(n):
                x = -W * 0.36 + W * 0.72 * k / max(1, n - 1)
                y = shore - 9.0 - (k % 2) * 4.0
                umbrella(b, x, y, cols[k % 5])
                if det == 0:
                    lib.obox(b, x - 1.0, y - 1.6, 0.0, 0.7, 1.8, 0.35, 0.0, 'plain', '#f0efe8', skip=('bottom',))
                    lib.obox(b, x + 1.0, y - 1.6, 0.0, 0.7, 1.8, 0.35, 0.0, 'plain', '#f0efe8', skip=('bottom',))
    thatch = lk.material_thatch if hasattr(lk, 'material_thatch') else (P['material'] == 'timber' or 'hut' in tx or 'thatch' in tx or 'shack' in tx)
    nh = 3 if 'kiosk' in fe or 'pavilion' in fe or 'sheds' in fe else 2
    for k in range(nh):
        x = -W * 0.38 + W * 0.76 * (k + 0.5) / nh + srng.uniform(-3, 3)
        y = -D * 0.3 + srng.uniform(-3, 3)
        if thatch:
            hut(b, lk, x, y, 2.6, srng, True)
        else:
            hut(b, lk, x, y, 2.6, srng, False)
    if 'kiosk' in fe:
        kiosk(b, lk, W * 0.34, -D * 0.2, 4.0, 3.0, 2.8, rng=srng)
    if 'pavilion' in fe:
        pavilion(b, lk, -W * 0.05, -D * 0.34, 7.0, 6.0, 3.0, 'thatch' if thatch else 'hip', srng)
    if 'pier' in fe:
        jetty(b, lk, W * 0.12, shore - 6.0, shore + D * 0.4, 3.0, 1.0)
    # lifeguard tower
    if det < 2:
        x = -W * 0.3
        lib.box_c(b, x, shore - 14.0, 2.4, 2.6, 2.6, 2.2, 'timber', '#d9d2c0', top_slot='roof-flat', top_col='#b83a32')
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.cylinder(b, x + sx * 1.1, shore - 14.0 + sy * 1.1, 0, 2.4, 0.12, n=4, slot='timber', col='#6a4a2e', top=False)
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, W * 0.4, -D / 2 + 3.0, 0.0, 5.0, 1.8, lk, 0.0, col='#2f5f8a')
    b.section('trees')
    scatter_trees(b, lk, srng, (-W / 2, -D / 2, W / 2, -D * 0.25), cnt(det, 10, 4), [(0, -D * 0.34, 8)], 7, 11, kind='palm' if lk.tree in ('palm', 'none', None) else lk.tree)
    return P['H']


# ------------------------------------------------------------------------------------------------------------------- lake
def build_lake(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 106.0 / big)
    W, D = U.clamp(P['w'] * f, 50, 108), U.clamp(P['d'] * f, 40, 90)
    shore = -D * 0.02
    grass(b, lk, -W / 2, -D / 2, W / 2, shore)
    with b.site():
        if det < 2:
            b.face([(-W / 2, shore, 0.02), (W / 2, shore, 0.02), (W / 2, D / 2, 0.02), (-W / 2, D / 2, 0.02)], 'plain', '#5f8ea3', scale=FLAT)
            # a ragged bank line
            n = 14
            for k in range(n):
                xa, xb_ = -W / 2 + W * k / n, -W / 2 + W * (k + 1) / n
                za = shore + 1.2 * math.sin(k * 1.7)
                zb = shore + 1.2 * math.sin((k + 1) * 1.7)
                b.face([(xa, shore - 0.5, 0.03), (xb_, shore - 0.5, 0.03), (xb_, zb + 0.8, 0.03), (xa, za + 0.8, 0.03)], 'plain', '#cdbf96', scale=FLAT)
        path_strip(b, [(-W * 0.45, shore - 3.0), (-W * 0.1, shore - 2.0), (W * 0.2, shore - 3.2), (W * 0.45, shore - 2.4)], 2.6, 0.05, 'paving', '#cbc6bb')
    b.section('structures')
    if 'pier' in fe:
        jetty(b, lk, W * 0.1, shore - 3.0, D * 0.36, 3.2, 0.9)
        if det < 2:
            # boats
            with b.site():
                for k in range(3):
                    bx, by = W * 0.1 + (6 + 4 * k) * (1 if k % 2 else -1), D * 0.22 + 6 * k
                    lib.obox(b, bx, by, 0.05, 1.3, 4.2, 0.6, srng.uniform(-0.3, 0.3), 'plain', ['#f0efe8', '#d94f4f', '#3f87c8'][k], skip=('bottom',))
    if 'pavilion' in fe or 'kiosk' not in fe:
        pavilion(b, lk, -W * 0.28, shore - 11.0, 8.0, 6.0, 3.0, 'hip' if not P['material'] == 'timber' else 'thatch', srng)
    if 'kiosk' in fe:
        kiosk(b, lk, W * 0.32, shore - 9.0, rng=srng)
    if 'gate' in fe:
        gate_structure(b, lk, P, 0.0, -D / 2 + 2.0, 6.0, 4.0, 'piers', srng)
    if 'fence-wall' in fe and det < 2:
        fence_line(b, lk, (-W / 2, -D / 2 + 2.0), (-3.0, -D / 2 + 2.0), 'rail')
        fence_line(b, lk, (3.0, -D / 2 + 2.0), (W / 2, -D / 2 + 2.0), 'rail')
    if 'steps' in fe and det < 2:
        with b.site():
            lib.steps(b, W * 0.02, W * 0.18, shore - 0.5, 0.8, 2.4, 3, 'paving', lk.stone_col)
    b.section('trees')
    scatter_trees(b, lk, srng, (-W / 2, -D / 2 + 4, W / 2, shore - 5.0), cnt(det, 13, 5), [(-W * 0.28, shore - 11.0, 7), (W * 0.1, shore - 3, 5, ), (-3, -D / 2 + 1, 4)], 6, 11)
    return P['H']


# ----------------------------------------------------------------------------------------------------------------- canopy
def build_canopy(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    W = 104.0
    D = U.clamp(P['d'], 40, 80)
    Hw = U.clamp(P['H'] * 0.9, 8.0, 22.0)
    grass(b, lk, -W / 2, -D / 2, W / 2, D / 2, col='#5e8a45')
    b.section('walkway')
    y = D * 0.05
    n_p = 9
    xs = [-W * 0.46 + W * 0.92 * k / (n_p - 1) for k in range(n_p)]
    # access tower (stairs) at the left end
    tw = 4.0
    lib.box_c(b, xs[0] - 3.0, y - 6.0, 0, tw, tw, Hw + 0.3, 'timber', '#7a5a38', top_slot='timber', skip=('bottom',), scale=6.0)
    if det < 2:
        for k in range(8 if det == 0 else 3):
            z = Hw * k / 8
            lib.box(b, xs[0] - 5.0, y - 8.2 + 0.0, z, xs[0] - 1.0, y - 8.0, z + 0.2, 'timber', '#8a6a43', skip=('bottom',)) if False else None
    # deck with handrails and trestles; sagging spans between platforms
    zs = [Hw * (0.95 + 0.08 * math.sin(k * 1.3)) for k in range(n_p)]
    for k in range(n_p - 1):
        x0, x1 = xs[k], xs[k + 1]
        yk0 = y + 3.0 * math.sin(k * 0.9)
        yk1 = y + 3.0 * math.sin((k + 1) * 0.9)
        zz0, zz1 = zs[k], zs[k + 1]
        dx, dy, dz = x1 - x0, yk1 - yk0, zz1 - zz0
        L = math.hypot(dx, dy)
        yaw = math.atan2(dy, dx)
        # a deck slab as a rotated box rising linearly
        U.strut(b, (x0, yk0, zz0), (x1, yk1, zz1), 1.6, '#8a6a43', slot='timber')
        if det < 2:
            for sg in (-1, 1):
                nx, ny = -math.sin(yaw) * 0.85 * sg, math.cos(yaw) * 0.85 * sg
                U.strut(b, (x0 + nx, yk0 + ny, zz0 + 1.0), (x1 + nx, yk1 + ny, zz1 + 1.0), 0.07, '#d8d8d8', ends=False)
                if det == 0:
                    U.cable(b, (x0 + nx, yk0 + ny, zz0 + 0.3), (x1 + nx, yk1 + ny, zz1 + 0.3), '#c8c8c8', 0.05)
    for k in range(n_p):
        x = xs[k]
        yk = y + 3.0 * math.sin(k * 0.9)
        lib.cylinder(b, x, yk, 0, zs[k], 0.45 if det == 0 else 0.5, n=6 if det == 0 else 4, slot='timber', col='#6a4a2e', top=False)
        if det < 2:
            lib.box_c(b, x, yk, zs[k] - 0.15, 3.4, 3.4, 0.25, 'timber', '#8a6a43', top_slot='timber', skip=('bottom',))
    # cone-shaped auditorium
    if 'pavilion' in fe or True:
        ax, ay = -W * 0.2, -D * 0.28
        r = 7.5
        U.revolve(b, ax, ay, [(r, 0.0), (r, 2.4), (r * 0.12, 11.0)], 14 if det == 0 else 8, lk.roof_slot if det < 2 else 'plain', lk.roof_col, smooth_=False, scale=2.0)
        if det < 2:
            U.revolve(b, ax, ay, [(r * 0.99, 0.0), (r * 0.99, 2.4)][::1], 14 if det == 0 else 8, lk.wall_slot, lk.wall_col, smooth_=False)
    # boardwalk (low) with rails
    if det < 2:
        with b.site():
            lib.box(b, -W * 0.45, -D * 0.12, 0.35, W * 0.2, -D * 0.12 + 1.8, 0.55, 'timber', '#8a6a43', skip=('bottom',), top_slot='timber')
    if 'gate' in fe:
        gate_structure(b, lk, P, W * 0.3, -D / 2 + 2.0, 6.0, 3.8, 'timber', srng)
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, W * 0.18, -D / 2 + 3.0, 0.0, 4.5, 1.6, lk, 0.0, col='#2f6b4f')
    b.section('trees')
    scatter_trees(b, lk, srng, (-W / 2, -D / 2 + 6, W / 2, D / 2), cnt(det, 26, 8), [(-W * 0.2, -D * 0.28, 9)], 14, 24, kind='broadleaf')
    if 'car-park' in fe or lk.forecourt == 'parking':
        with b.site():
            if det == 0:
                lib.forecourt(b, 'parking', W * 0.1, -D / 2, W / 2 - 2, -D / 2 + 18, lk, srng, density=0.4)
    return Hw


# ------------------------------------------------------------------------------------------------------------------- field
def build_field(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 106.0 / big)
    W, D = U.clamp(P['w'] * f, 60, 108), U.clamp(P['d'] * f, 40, 84)
    race = U.has(P['nm'], 'race', 'horse') or (P['fp'] == 'oval' and not U.has(P['nm'], 'polo'))
    grass(b, lk, -W / 2 - 6, -D / 2 - 14, W / 2 + 6, D / 2 + 8)
    if det < 2:
        with b.site():
            f_ = 0.0
            if race or P['fp'] == 'oval':
                n = 32 if det == 0 else 16
                for rr, cc in ((D * 0.46, '#a98466'),):
                    pass
                outer = [((W / 2 - 2) * math.cos(2 * math.pi * k / n), (D / 2 - 2) * math.sin(2 * math.pi * k / n)) for k in range(n)]
                inner = [((W / 2 - 9) * math.cos(2 * math.pi * k / n), (D / 2 - 9) * math.sin(2 * math.pi * k / n)) for k in range(n)]
                for k in range(n):
                    j = (k + 1) % n
                    b.facing([(outer[k][0], outer[k][1], 0.04), (outer[j][0], outer[j][1], 0.04), (inner[j][0], inner[j][1], 0.04), (inner[k][0], inner[k][1], 0.04)], (0, 0, 1), 'sand', '#b79a72', scale=3.0)
            else:
                # goalposts and markings for a plain field
                lc = '#f2f0e8'
                for (a, c) in (((-W / 2 + 3, -D / 2 + 3), (W / 2 - 3, -D / 2 + 3)), ((W / 2 - 3, -D / 2 + 3), (W / 2 - 3, D / 2 - 3)), ((W / 2 - 3, D / 2 - 3), (-W / 2 + 3, D / 2 - 3)), ((-W / 2 + 3, D / 2 - 3), (-W / 2 + 3, -D / 2 + 3)), ((0, -D / 2 + 3), (0, D / 2 - 3))):
                    path_strip(b, [a, c], 0.15, 0.06, 'plain', lc, scale=FLAT)
    # rail round the field
    if det < 2:
        n = 36 if (race or P['fp'] == 'oval') else 4
        if race or P['fp'] == 'oval':
            pts = [((W / 2 - 1) * math.cos(2 * math.pi * k / n), (D / 2 - 1) * math.sin(2 * math.pi * k / n)) for k in range(n + 1)]
            for p0, p1 in zip(pts[:-1], pts[1:]):
                if det == 0 or True:
                    U.railing(b, p0, p1, 1.1, '#f0efe8', 3.5)
        else:
            for (p0, p1) in (((-W / 2, -D / 2), (W / 2, -D / 2)), ((W / 2, -D / 2), (W / 2, D / 2)), ((W / 2, D / 2), (-W / 2, D / 2)), ((-W / 2, D / 2), (-W / 2, -D / 2))):
                U.railing(b, p0, p1, 1.1, '#f0efe8', 3.5)
    b.section('stand')
    # grandstand / clubhouse along the front outside the rail
    sw = U.clamp(W * 0.42, 22.0, 46.0)
    sy0 = -D / 2 - 11.0
    roof_col = lk.roof_col
    stand = 'stand-roof' in fe or 'pavilion' in fe or True
    if stand:
        # raked terraces (7 rows) facing the field (+Y), rear wall, shed roof
        rows = 7 if det == 0 else 2
        for r in range(rows):
            lib.box(b, -sw / 2, sy0 + (rows - r) * 0.9, 0, sw / 2, sy0 + (rows - r) * 0.9 + 0.9, 0.45 * (r + 1), 'plain', ['#b83a32', '#e9e6dc'][r % 2] if r % 3 == 0 else '#bdb9b0', skip=('bottom', 'back'), scale=FLAT)
        zt = 0.45 * rows
        lib.box(b, -sw / 2, sy0 - 0.8, 0, sw / 2, sy0 + 0.0, zt + 2.2, lk.wall_slot, lk.wall_col, top_slot='roof-flat', top_col=roof_col, skip=('bottom',))
        if det < 2:
            lib.shed(b, (-sw / 2 - 0.4, sy0 - 1.0, sw / 2 + 0.4, sy0 + rows * 0.9 + 0.5), zt + 2.0, 1.6, lk, high='front', ov=0.3, slot=lk.roof_slot, col=roof_col)
            for k in range(5 if det == 0 else 3):
                x = -sw / 2 + 1.0 + (sw - 2.0) * k / (4 if det == 0 else 2)
                lib.cylinder(b, x, sy0 + rows * 0.9 + 0.3, 0.0, zt + 2.2, 0.14, n=5 if det == 0 else 4, slot='frame', col='#8a9096', top=False)
    if 'pavilion' in fe or 'terrace' in fe:
        pavilion(b, lk, sw / 2 + 12.0, sy0 + 3.0, 7.0, 6.0, 3.0, 'hip', srng)
    if 'flags' in fe:
        flag_row(b, lk, -sw / 2, sw / 2, sy0 - 5.0, 5, 10.0)
    if 'floodlights' in fe:
        for sx in (-1, 1):
            U.lattice_mast(b, sx * (W / 2 + 4), -D / 2 - 2, 24.0, yaw=0.0)
    if ('gate' in fe) and det < 2:
        gate_structure(b, lk, P, W * 0.28, -D / 2 - 20.0, 7.0, 3.8, 'piers', srng)
    if 'fence-wall' in fe and det < 2:
        fence_line(b, lk, (-W / 2 - 4, -D / 2 - 22), (W * 0.28 - 4.5, -D / 2 - 22), 'wall')
        fence_line(b, lk, (W * 0.28 + 4.5, -D / 2 - 22), (W / 2 + 4, -D / 2 - 22), 'wall')
    scatter_trees(b, lk, srng, (-W / 2 - 4, -D / 2 - 18, W / 2 + 4, -D / 2 - 14), cnt(det, 7, 3), [(0, -D / 2 - 11, 26)], 7, 11)
    return P['H']


# ------------------------------------------------------------------------------------------------------------- amusement
def build_amusement(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 104.0 / big)
    W, D = U.clamp(P['w'] * f, 50, 104), U.clamp(P['d'] * f, 40, 86)
    with b.site():
        lib.ground(b, -W / 2, -D / 2, W / 2, D / 2, lk, 'paving', lib.mix(lk.ground_col, '#b9b4aa', 0.5) if lk.ground_slot != 'paving' else '#bdb7ab', z=0.0, scale=3.0)
    if det < 2:
        with b.site():
            for (a0, b0, a1, b1) in ((-W * 0.4, -D * 0.1, W * 0.4, D * 0.4),):
                rect_face(b, a0, b0, a1, b1, 0.03, 'grass', '#6d9a4f', scale=2.0)
            path_strip(b, [(0, -D / 2), (0, -D * 0.1), (-W * 0.2, D * 0.1), (-W * 0.2, D * 0.3)], 3.0, 0.06)
    b.section('wheel')
    wr = U.clamp(P['H'] * 0.44 if P['H'] >= 12 else 9.0, 7.0, 16.0)
    if P['H'] >= 12 or 'ferris' in tx:
        ferris_wheel(b, lk, W * 0.18, D * 0.12, wr, srng)
    else:
        # carousel: round platform, central pole, striped canopy
        cx, cy = W * 0.18, D * 0.12
        lib.cylinder(b, cx, cy, 0, 0.5, 6.0, n=16 if det == 0 else 8, slot='plain', col='#d9d2c0', top=True, smooth=False)
        lib.cylinder(b, cx, cy, 0.5, 5.5, 0.35, n=6, slot='frame', col='#c8ccd0', top=False)
        U.revolve(b, cx, cy, [(7.0, 5.0), (0.2, 7.6)], 12 if det == 0 else 8, 'plain', '#d94f4f', smooth_=False, scale=FLAT)
        if det == 0:
            for k in range(6):
                a = 2 * math.pi * k / 6
                lib.cylinder(b, cx + 4.8 * math.cos(a), cy + 4.8 * math.sin(a), 0.5, 4.8, 0.06, n=4, slot='frame', col='#e8b53a', top=False)
    b.section('structures')
    # ticket gate and kiosks with striped awnings
    if 'gate' in fe or True:
        gate_structure(b, lk, P, 0.0, -D / 2 + 1.0, 7.0, 4.6, 'piers', srng)
    cols = ['#d94f4f', '#e8b53a', '#3f87c8', '#4fae6a', '#a35cc0']
    nk = 3 if 'kiosk' in fe else 2
    for k in range(nk):
        kiosk(b, lk, -W * 0.3 + W * 0.15 * k * 2, -D * 0.05 + srng.uniform(-3, 3), 4.0, 3.0, 2.8, col=cols[k % 5], rng=srng)
    if 'pavilion' in fe:
        pavilion(b, lk, -W * 0.28, D * 0.3, 8.0, 6.0, 3.0, 'flat', srng, col=cols[srng.randrange(5)])
    if 'umbrellas' in fe and det < 2:
        with b.site():
            for k in range(6):
                umbrella(b, -W * 0.1 + 4.0 * (k % 3), D * 0.28 + 3.6 * (k // 3), cols[k % 5])
    if 'flags' in fe:
        flag_row(b, lk, -10, 10, -D / 2 - 3.0, 4, 10.0)
    if 'neon-strip' in fe and det == 0:
        U.strut(b, (-3.5, -D / 2 + 1.0, 5.4), (3.5, -D / 2 + 1.0, 5.4), 0.15, '#ff6bd5', slot='plain', ends=False)
    if 'fence-wall' in fe and det < 2:
        for (p0, p1) in (((-W / 2, -D / 2), (-4.0, -D / 2)), ((4.0, -D / 2), (W / 2, -D / 2)), ((W / 2, -D / 2), (W / 2, D / 2)), ((W / 2, D / 2), (-W / 2, D / 2)), ((-W / 2, D / 2), (-W / 2, -D / 2))):
            fence_line(b, lk, p0, p1, 'rail')
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, W * 0.25, -D / 2 - 4.0, 0.0, 6.0, 2.2, lk, 0.0, col='#d94f4f')
    b.section('trees')
    scatter_trees(b, lk, srng, (-W / 2 + 3, -D / 2 + 6, W / 2 - 3, D / 2 - 3), cnt(det, 8, 3), [(W * 0.18, D * 0.12, wr + 3), (0, -D * 0.4, 6), (-W * 0.2, D * 0.15, 10)], 5, 9)
    return P['H']


# ---------------------------------------------------------------------------------------------------------------- grove
def build_grove(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 106.0 / big)
    W, D = U.clamp(P['w'] * f, 50, 108), U.clamp(P['d'] * f, 40, 90)
    zoo = U.has(P['nm'] + tx, 'zoo', 'enclosure', 'animal')
    heath = U.has(P['nm'], 'common', 'heath') or P['H'] <= 0.5
    grass(b, lk, -W / 2, -D / 2, W / 2, D / 2, col='#5f8a45' if not heath else '#7a9a55')
    b.section('structures')
    gk = 'timber' if (P['material'] == 'timber' or P['style'] == 'vernacular') else 'piers'
    if not heath:
        gate_structure(b, lk, P, 0.0, -D / 2, 6.0, 4.0, gk, srng)
        if det < 2:
            fence_line(b, lk, (-W / 2, -D / 2), (-3.0, -D / 2), 'wall' if gk == 'piers' else 'rail')
            fence_line(b, lk, (3.0, -D / 2), (W / 2, -D / 2), 'wall' if gk == 'piers' else 'rail')
    with b.site():
        path_strip(b, [(0, -D / 2), (-W * 0.08, -D * 0.2), (W * 0.1, D * 0.05), (0, D * 0.3)], 2.4, 0.05, 'laterite' if lk.ground_slot == 'laterite' else 'paving', '#a98066' if lk.ground_slot == 'laterite' else '#cbc6bb')
    # shelter / lodge near the entrance
    if 'pavilion' in fe or not heath:
        pavilion(b, lk, W * 0.22, -D * 0.3, 7.5, 6.0, 3.0, 'thatch' if (P['material'] == 'timber' or lk.tree != 'conifer') and srng.random() < 0.6 else 'gable', srng)
    if zoo and det < 2:
        # enclosures: fenced rectangles with a shelter in each
        for k in range(4):
            ex = -W * 0.3 + (k % 2) * W * 0.3
            ey = D * 0.02 + (k // 2) * D * 0.24
            ew, ed = 14.0, 10.0
            for (p0, p1) in (((ex - ew / 2, ey - ed / 2), (ex + ew / 2, ey - ed / 2)), ((ex + ew / 2, ey - ed / 2), (ex + ew / 2, ey + ed / 2)), ((ex + ew / 2, ey + ed / 2), (ex - ew / 2, ey + ed / 2)), ((ex - ew / 2, ey + ed / 2), (ex - ew / 2, ey - ed / 2))):
                U.railing(b, p0, p1, 1.8, '#4a4f55', 2.0)
            lib.box_c(b, ex, ey + ed * 0.25, 0, 4.0, 3.0, 2.2, lk.wall_slot, lk.wall_col, top_slot='roof-flat', top_col=lk.roof_col)
    if 'kiosk' in fe:
        kiosk(b, lk, -W * 0.22, -D * 0.34, rng=srng)
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, W * 0.12, -D / 2 - 3.0, 0.0, 5.0, 1.8, lk, 0.0, col='#2f6b4f')
    if 'mast' in fe:
        U.strut(b, (W * 0.4, D * 0.2, 0), (W * 0.4, D * 0.2, 18.0), 0.4, '#9ea3a8')
    if 'solar-panels' in fe and det < 2:
        lib.obox(b, W * 0.3, -D * 0.18, 1.6, 4.0, 2.2, 0.15, 0.0, 'plain', '#26384a', skip=('bottom',))
    if 'water-tank' in fe and det < 2:
        _water_tank(b, lk, W * 0.38, D * 0.05)
    if 'steps' in fe and det < 2:
        with b.site():
            lib.steps(b, -3, 3, D * 0.25, 0.8, 2.2, 3, 'timber', '#8a6a43')
    b.section('trees')
    dense = 70 if not heath else 24
    n_t = cnt(det, dense // 2, 14)
    scatter_trees(b, lk, srng, (-W / 2 + 2, -D / 2 + 3, W / 2 - 2, D / 2 - 2), n_t, [(0.0, -D * 0.2, 5.0), (W * 0.22, -D * 0.3, 7), (-2, -D / 2 + 1, 4)] if not heath else [], 9 if not heath else 6, 18 if not heath else 12, kind='broadleaf' if lk.tree in ('palm', 'none', None, 'acacia') and not heath else lk.tree)
    if heath and det < 2:
        with b.site():
            lib.ground(b, -W * 0.32, D * 0.0, W * 0.1, D * 0.34, lk, 'plain-render', '#5f8ea3', z=0.03, scale=6.0)
    return P['H']


# ---------------------------------------------------------------------------------------------------------------- allotment
def _water_tank(b, lk, x, y):
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.cylinder(b, x + sx * 1.0, y + sy * 1.0, 0, 3.0, 0.1, n=4, slot='frame', col='#7d8286', top=False)
    lib.cylinder(b, x, y, 3.0, 5.2, 1.5, n=10 if b.detail == 0 else 6, slot='plain', col='#2f5f8a', top=True, smooth=True)


def build_allotment(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['seed'])
    big = max(P['w'], P['d'])
    f = min(1.0, 96.0 / big)
    W, D = U.clamp(P['w'] * f, 40, 96), U.clamp(P['d'] * f, 30, 70)
    with b.site():
        lib.ground(b, -W / 2, -D / 2, W / 2, D / 2, lk, lk.ground_slot if lk.ground_slot != 'paving' else 'laterite', lk.ground_col if lk.ground_slot != 'paving' else '#a98066', z=0.0, scale=3.0)
    b.section('plots')
    rows, cols_ = (3, 5) if det == 0 else (2, 3)
    crops = ['#5f9a45', '#7aae52', '#4c8a3c', '#9bb94a', '#6aa04a']
    if det < 2:
        with b.site():
            for r in range(rows):
                for c in range(cols_):
                    x0 = -W * 0.38 + c * W * 0.15
                    y0 = -D * 0.28 + r * D * 0.2
                    pw, pd = W * 0.115, D * 0.14
                    lib.box(b, x0, y0, 0, x0 + pw, y0 + pd, 0.35, 'plain', '#6b4a35', top_slot='plain', top_col='#6b4a35', skip=('bottom',), scale=FLAT)
                    if det == 0:
                        for k in range(4):
                            rect_face(b, x0 + 0.4, y0 + 0.4 + k * (pd - 0.8) / 4, x0 + pw - 0.4, y0 + 0.4 + k * (pd - 0.8) / 4 + (pd - 0.8) / 6, 0.5, 'plain', crops[(r + c + k) % 5], scale=FLAT)
                    else:
                        rect_face(b, x0 + 0.3, y0 + 0.3, x0 + pw - 0.3, y0 + pd - 0.3, 0.4, 'plain', crops[(r + c) % 5], scale=FLAT)
    b.section('structures')
    sx0 = W * 0.34
    lib.box(b, sx0, D * 0.15, 0, sx0 + 6.0, D * 0.15 + 4.0, 2.6, lk.wall_slot, lk.wall_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    if det < 2:
        lib.shed(b, (sx0 - 0.5, D * 0.15 - 0.5, sx0 + 6.5, D * 0.15 + 4.5), 2.6, 0.9, lk, high='back', ov=0.2, slot=lk.roof_slot, col=lk.roof_col)
    _water_tank(b, lk, -W * 0.38, D * 0.32)
    if 'pavilion' in fe:
        pavilion(b, lk, -W * 0.05, D * 0.34, 6.0, 4.5, 2.8, 'gable', srng)
    if 'gate' in fe:
        gate_structure(b, lk, P, 0.0, -D / 2, 4.0, 3.0, 'piers', srng)
    if det < 2:
        for (p0, p1) in (((-W / 2, -D / 2), (-2.0, -D / 2)), ((2.0, -D / 2), (W / 2, -D / 2)), ((W / 2, -D / 2), (W / 2, D / 2)), ((W / 2, D / 2), (-W / 2, D / 2)), ((-W / 2, D / 2), (-W / 2, -D / 2))):
            fence_line(b, lk, p0, p1, 'rail' if 'wall' not in P['tx'] else 'wall')
    scatter_trees(b, lk, srng, (-W / 2 + 3, D * 0.28, W / 2 - 3, D / 2 - 3), cnt(det, 6, 3), [(-W * 0.38, D * 0.32, 4), (-W * 0.05, D * 0.34, 5), (W * 0.34, D * 0.2, 7)], 6, 10)
    return P['H']


# ---------------------------------------------------------------------------------------------------------------- bigtree
def build_bigtree(b, brief, lk, P, rng):
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'])
    H = U.clamp(P['H'], 12.0, 45.0)
    R = U.clamp(P['w'] / 2, 8.0, 30.0)
    with b.site():
        lib.ground(b, -R * 2.2, -R * 2.2, R * 2.2, R * 2.2, lk, 'paving', '#bdb7ab', z=0.0, scale=3.0)
    if det < 2:
        with b.site():
            disc(b, 0, 0, 0, R * 1.05, 0.04, 'grass', '#6d9a4f', n=24, scale=2.0)
    b.section('tree')
    tr = U.clamp(H * 0.06, 1.2, 3.0)
    # buttressed trunk, then an umbrella of overlapping crown blobs
    U.revolve(b, 0, 0, [(tr * 2.4, 0.0), (tr * 1.4, H * 0.12), (tr, H * 0.3), (tr * 0.85, H * 0.55)], 10 if det == 0 else 6, 'timber' if det < 2 else 'plain', '#7a6850', smooth_=True, scale=1.5)
    n = 5 if det == 0 else (3 if det == 1 else 2)
    col = '#4f8a3f'
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = R * 0.5 if k else 0.0
        lib.blob(b, rr * math.cos(a), rr * math.sin(a), H * (0.72 + 0.05 * (k % 2)), R * 0.62, R * 0.62, H * 0.2, lib.jitter(col, srng, 0.08), n=10 if det == 0 else 6, rings=4 if det == 0 else 3)
    b.section('surround')
    if det < 2:
        rr = R * 1.05
        n_r = 20 if det == 0 else 10
        for k in range(n_r):
            a0, a1 = 2 * math.pi * k / n_r, 2 * math.pi * (k + 1) / n_r
            U.railing(b, (rr * math.cos(a0), rr * math.sin(a0)), (rr * math.cos(a1), rr * math.sin(a1)), 1.1, '#4a4f55', 2.5)
    if 'statue' in fe and det < 2:
        lib.box_c(b, R * 0.7, -R * 0.9, 0, 1.6, 1.6, 1.6, lk.wall_slot, lk.trim_col)
        U.person(b, R * 0.7, -R * 0.9, 1.6, 3.2, '#6a583b', 0.0)
    if det < 2:
        for k in range(3):
            bench(b, -R * 1.5 + k * R * 0.5, -R * 1.5)
    return H


def woodland(b, lk, rng, P):
    """Fallback main mass for grounds with no structure: a belt of tall tree crowns at the back (the 'building' for the silhouette)."""
    big = max(P['w'], P['d'])
    W = U.clamp(P['w'], 40, 100)
    n = 7 if b.detail == 0 else (4 if b.detail == 1 else 3)
    col = '#4f8a3f'
    for k in range(n):
        x = -W * 0.4 + W * 0.8 * k / max(1, n - 1)
        y = P['d'] * 0.12 + rng.uniform(-4, 4)
        h = rng.uniform(13, 20)
        if b.detail < 2:
            lib.cylinder(b, x, y, 0, h * 0.5, 0.6, n=5, slot='timber', col='#6b5240', r_top=0.45, top=False)
        lib.blob(b, x, y, h * 0.72, h * 0.34, h * 0.34, h * 0.3, lib.jitter(col, rng, 0.1), n=8 if b.detail == 0 else 6, rings=4 if b.detail == 0 else 3)


# ------------------------------------------------------------------------------------------------------------------- build
def build(brief, style, rng, detail):
    b = lib.Builder('park-landscape', detail)
    lk = lib.look(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    P = plan(brief, style, srng, lk)
    {'garden': build_garden, 'square': build_square, 'hill': build_hill, 'beach': build_beach, 'lake': build_lake, 'canopy': build_canopy,
     'field': build_field, 'amusement': build_amusement, 'grove': build_grove, 'allotment': build_allotment, 'bigtree': build_bigtree}[P['typ']](b, brief, lk, P, srng)
    if 0 not in b.layer:
        woodland(b, lk, srng, P)
    objs = b.objects()
    U.centre_xy(objs, True, False)
    return objs
