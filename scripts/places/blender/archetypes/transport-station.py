"""transport-station: rail stations, motor / bus parks, bus terminals, ferry terminals and jetties, harbours and metro entrances.

Typologies chosen from the brief:
  rail      station building + raised platforms + tracks with sleepers and rails + platform canopy + a train; classical (hip/gable roof,
            arcade, clock tower, steps), modern (glazed two-storey hall, big cantilever canopy) or train shed (barrel-vault over the tracks)
  motorpark open yard of parked buses, minibuses and shared taxis, a long open shelter on posts, ticket kiosks, lock-up shops, gate, wall
  busterm   bus terminal: terminal building with a departure canopy over coach bays, car park, kiosks
  ferry     terminal hall with a jetty / pier into the water, boats, passenger shelter, mooring posts
  harbour   commercial port: quay, transit sheds, bollards, a ship, container stacks, mobile crane
  metro     metro / underground entrance: stair portal with canopy, pylon sign, kiosk and plaza

Layout: street / forecourt at -Y; tracks, water and quay at +Y.
"""
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _office_tower_util as U  # noqa: E402
import industrial as IND  # noqa: E402  (private helpers: ship, crane, containers, warehouse)
import manor as MAN  # noqa: E402  (statue)

FEATURES = {'platform-canopy', 'rail-tracks', 'bus-bays', 'kiosk', 'sheds', 'steps', 'clock-tower', 'arcade', 'flat-canopy', 'car-park',
            'signage-board', 'pier', 'floodlights', 'fence-wall', 'gate', 'flags', 'awning', 'bell-tower', 'colonnade', 'stalls',
            'umbrellas', 'curved-canopy', 'portico', 'water-tank', 'relief-pattern', 'roof-terrace', 'mast', 'storage-tanks', 'arches',
            'crenellation', 'balcony-bands', 'statue', 'atrium-glass', 'dome', 'pavilion'}


def has(t, *w):
    return any(x in t for x in w)


# ------------------------------------------------------------------------------------------------------------------------- plan
def plan(brief, style, lk, S):
    form = U.form_of(brief)
    feats = U.feat(brief)
    txt = U.text(brief)
    sty = U.style_of(brief)
    W = U.clamp(U.fnum(form.get('width_m'), 60), 14, 104)
    D = U.clamp(U.fnum(form.get('depth_m'), 24), 8, 90)
    H = U.clamp(U.fnum(form.get('height_m'), 6), 3, 20)
    storeys = int(U.clamp(U.fnum(form.get('storeys'), 1), 1, 4))
    roof = form.get('roof') or 'flat'
    yr = U.year_of(brief, 2000)
    fpk = form.get('footprint') or 'rect'
    if has(txt, 'metro', 'subway', 'underground', 'tube station'):
        typ = 'metro'
    elif has(txt, 'ferry', 'jetty', 'hoverport', 'landing', 'boat') or ('pier' in feats and has(txt, 'jetty', 'ferry', 'passenger')):
        typ = 'ferry'
    elif (has(txt, 'harbour', 'harbor', 'quay', 'wharf', 'cargo') or re.search(r'\bports?\b', txt)) and not has(txt, 'motor park', 'railway station', 'rail station', 'train station'):
        typ = 'harbour'
    elif has(txt, 'railway', 'rail ', 'train', 'station on the', 'platform') or 'rail-tracks' in feats or 'rails' in txt:
        typ = 'rail'
    elif (storeys >= 2 or has(txt, 'terminal building', 'passenger terminal', 'interchange', 'bus terminal')) and not has(txt, 'motor park', 'open yard', 'open motor') \
            and ('flat-canopy' in feats or storeys >= 2):
        typ = 'busterm'
    else:
        typ = 'motorpark'
    if has(txt, 'train shed', 'barrel') or roof == 'barrel':
        shed = typ == 'rail'
    else:
        shed = False
    return {'typ': typ, 'W': W, 'D': D, 'H': H, 'storeys': storeys, 'roof': roof, 'feats': feats, 'txt': txt, 'sty': sty, 'yr': yr, 'fpk': fpk,
            'shed': shed, 'setting': brief.get('setting') or {}}


def acc_of(lk):
    a = lk.accent_col
    return lib.mix(lk.wall_col, '#2f5f8a', 0.45) if a == lib.shade(lk.wall_col, 0.8) else a


# ------------------------------------------------------------------------------------------------------------------------- parts
def rails(b, x0, x1, y, z=0.0, gauge=1.435):
    """One track along x at centre y: ballast bed, two rails, sleepers (LOD0)."""
    if b.detail >= 2:
        return
    with b.site():
        b.face([(x0, y - 1.7, z + 0.03), (x1, y - 1.7, z + 0.03), (x1, y + 1.7, z + 0.03), (x0, y + 1.7, z + 0.03)][::-1], 'plain', '#7a746a', mode='fit')
        for sy in (-gauge / 2, gauge / 2):
            U.box(b, x0, y + sy - 0.07, z + 0.03, x1, y + sy + 0.07, z + 0.2, 'plain', '#6c6f73', skip=('bottom', 'left', 'right'))
        if b.detail == 0:
            n = int((x1 - x0) / 1.4)
            for k in range(n + 1):
                xx = x0 + (x1 - x0) * k / n
                b.face([(xx - 0.12, y - 1.3, z + 0.06), (xx + 0.12, y - 1.3, z + 0.06), (xx + 0.12, y + 1.3, z + 0.06), (xx - 0.12, y + 1.3, z + 0.06)][::-1], 'plain', '#5a4e44', mode='fit')


def platform(b, lk, x0, x1, y0, y1, h=1.0, col='#b9b4aa'):
    U.box(b, x0, y0, 0, x1, y1, h, 'paving', col, top_slot='paving', top_col=lib.shade(col, 1.04), skip=('bottom',), scale=1.5 if b.detail == 0 else 6.0)
    if b.detail < 2:
        b.face([(x0, y1 - 0.9, h + 0.01), (x1, y1 - 0.9, h + 0.01), (x1, y1 - 0.75, h + 0.01), (x0, y1 - 0.75, h + 0.01)][::-1], 'plain', '#e1c24a', mode='fit') if b.detail == 0 else None


def platform_canopy(b, lk, x0, x1, y_wall, depth, z_wall, z_out, col, posts_every=7.0, rear_wall=True, kind='flat', wall_x=None):
    """A platform roof running along x. Attached to a wall at y_wall (rear_wall=True: cantilevers/slopes out to y_wall + depth) or free-standing
    (y_wall = centre line, `depth` = total width). Posts along the outer edge."""
    ya, yb = (y_wall, y_wall + depth) if rear_wall else (y_wall - depth / 2, y_wall + depth / 2)
    za, zb_ = (z_wall, z_out) if rear_wall else (z_out + 0.15, z_out)
    pts = [(x0, ya, za), (x1, ya, za), (x1, yb, zb_), (x0, yb, zb_)]
    b.facing(pts, (0, 0, 1), 'metal-roof', lk.roof_col)
    if b.detail < 2:
        b.facing([(x0, ya, za - 0.18), (x1, ya, za - 0.18), (x1, yb, zb_ - 0.18), (x0, yb, zb_ - 0.18)], (0, 0, -1), 'plain', lib.shade(lk.roof_col, 0.55), mode='fit')
        b.facing([(x0, yb, zb_ - 0.18), (x1, yb, zb_ - 0.18), (x1, yb, zb_), (x0, yb, zb_)], (0, 1, 0), 'plain', col, mode='fit')
    n = max(2, int((x1 - x0) / posts_every))
    for k in range(n + 1):
        xx = x0 + 0.4 + (x1 - x0 - 0.8) * k / n
        if b.detail == 2 and k % 2:
            continue
        lib.cylinder(b, xx, yb - 0.5, 1.0, zb_ - 0.18, 0.16 if kind == 'flat' else 0.12, n=6 if b.detail == 0 else 4, slot='frame', col='#5e656b', top=False, smooth=False)
        if (not rear_wall) or (wall_x and not (wall_x[0] <= xx <= wall_x[1])):
            lib.cylinder(b, xx, ya + 0.5, 1.0, za - 0.18, 0.16, n=6 if b.detail == 0 else 4, slot='frame', col='#5e656b', top=False, smooth=False)
        if kind == 'iron' and b.detail == 0:
            b.facing([(xx, yb - 0.5, zb_ - 0.2), (xx, yb - 0.5 - 1.6, zb_ - 0.2), (xx, yb - 0.5, zb_ - 1.4)], (1, 0, 0), 'plain', '#4a4f55', mode='fit')


def carriage(b, x, y, L=20.0, w=3.0, h=3.9, col='#2f5f8a', stripe='#e8e4d8', yaw=0.0, z=0.9):
    if b.detail >= 2:
        U.obox(b, x, y, z + 0.5, L, w, h, yaw, 'plain', col, skip=('bottom',))
        return
    U.obox(b, x, y, z + 0.6, L, w, h - 0.6, yaw, 'plain', col, top_col=lib.shade(col, 1.15), skip=('bottom',))
    if b.detail == 0:
        c, s = math.cos(yaw), math.sin(yaw)
        U.obox(b, x, y, z + 0.6 + (h - 0.6) * 0.35, L * 1.003, w * 1.003, (h - 0.6) * 0.38, yaw, 'plain', '#26313a', skip=('bottom', 'top'))
        U.obox(b, x, y, z + 0.6 + (h - 0.6) * 0.18, L * 1.004, w * 1.004, 0.25, yaw, 'plain', stripe, skip=('bottom', 'top'))
        U.obox(b, x, y, z + 0.1, L * 0.9, w * 0.8, 0.6, yaw, 'plain', '#222426')


def locomotive(b, x, y, L=18.0, w=3.0, h=4.2, col='#b03a2e', yaw=0.0, z=0.9):
    if b.detail >= 2:
        U.obox(b, x, y, z + 0.5, L, w, h, yaw, 'plain', col, skip=('bottom',))
        return
    U.obox(b, x, y, z + 0.6, L, w, h - 0.6, yaw, 'plain', col, top_col=lib.shade(col, 1.12), skip=('bottom',))
    U.obox(b, x + math.cos(yaw) * L * 0.38, y + math.sin(yaw) * L * 0.38, z + h, L * 0.2, w * 0.96, 0.7, yaw, 'plain', lib.shade(col, 0.8)) if b.detail == 0 else None
    if b.detail == 0:
        U.obox(b, x, y, z + 0.1, L * 0.9, w * 0.8, 0.6, yaw, 'plain', '#222426')
        U.obox(b, x - math.cos(yaw) * L * 0.1, y - math.sin(yaw) * L * 0.1, z + 0.6 + (h - 0.6) * 0.55, L * 0.5, w * 1.004, (h - 0.6) * 0.3, yaw, 'plain', '#26313a', skip=('bottom', 'top'))


def train(b, x0, y, n_car, col, S, z=0.4, loco_col='#b03a2e'):
    xx = x0
    locomotive(b, xx, y, 18.0, 3.0, 4.2, loco_col, z=z)
    xx += 18.0 / 2 + 0.6
    for k in range(n_car):
        xx += 20.0 / 2 + 0.5
        carriage(b, xx, y, 20.0, 3.0, 3.9, S.get('car%d' % k).choice([col, lib.shade(col, 1.1)]), z=z)
        xx += 20.0 / 2


def signal_post(b, x, y, h=6.0):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.1, n=5, slot='frame', col='#6e7378', r_top=0.08, top=True)
        U.box_c(b, x, y - 0.05, h - 1.0, 0.4, 0.3, 1.0, 'plain', '#2a2d31')


def danfo(b, x, y, yaw, col='#e6b422'):
    U.van(b, x, y, yaw, col, length=5.0, width=1.9, height=2.35, stripe='#1f1f22')


def taxi(b, x, y, yaw):
    lib.car(b, x, y, yaw, '#e6b422')


def kiosk_booth(b, lk, x, y, col, yaw=0.0, w=2.6, d=2.2, h=2.6, sign='#2f6b4f'):
    """A ticket kiosk with a sloped roof overhang, glazed hatch and blank sign board."""
    U.box_c(b, x, y, 0, w, d, h, 'plain-render', col, top_slot='roof-flat', top_col=lib.shade(col, 0.85), skip=('bottom',))
    if b.detail < 2:
        U.box_c(b, x, y, h, w + 0.8, d + 0.8, 0.14, 'plain', lib.shade(sign, 0.9), skip=('bottom',))
    if b.detail == 0:
        b.face([(x - w * 0.32, y - d / 2 - 0.03, 0.9), (x + w * 0.32, y - d / 2 - 0.03, 0.9), (x + w * 0.32, y - d / 2 - 0.03, 2.0), (x - w * 0.32, y - d / 2 - 0.03, 2.0)], 'glass-shopfront', '#cfd8dd')
        U.box_c(b, x, y - d / 2 - 0.08, 2.05, w * 0.9, 0.1, 0.42, 'plain', sign, skip=('bottom',))


def open_shed(b, lk, x0, x1, y, depth, h, S, roof='shed', col=None, benches=True):
    """An open passenger shelter: two rows of posts under a ribbed-metal roof, with benches (axis along x, high side at +Y)."""
    col = col or lk.roof_col
    ya, yb = y - depth / 2, y + depth / 2
    n = max(2, int((x1 - x0) / 5.5))
    ps = 0.14
    for k in range(n + 1):
        xx = x0 + (x1 - x0) * k / n
        if b.detail >= 2:
            continue
        U.box_c(b, xx, ya + 0.3, 0, 2 * ps, 2 * ps, h - 0.6 if roof == 'shed' else h - 0.3, 'frame', '#6e7378', skip=('bottom',))
        U.box_c(b, xx, yb - 0.3, 0, 2 * ps, 2 * ps, h + (0.8 if roof == 'shed' else 0.0), 'frame', '#6e7378', skip=('bottom',))
        if b.detail == 0 and benches and k < n:
            pass
    if roof == 'shed':
        rise = 0.8 + depth * 0.1
        pts = [(x0 - 0.4, ya - 0.5, h - 0.7), (x1 + 0.4, ya - 0.5, h - 0.7), (x1 + 0.4, yb + 0.5, h + 0.8 + 0.5), (x0 - 0.4, yb + 0.5, h + 0.8 + 0.5)]
        b.facing(pts, (0, -0.3, 1), 'corrugated', col, scale=1.5)
        if b.detail == 0:
            b.facing([(x0 - 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, yb + 0.5, h + 1.1 - 0.2), (x0 - 0.4, yb + 0.5, h + 1.1 - 0.2)], (0, 0.3, -1), 'plain', lib.shade(col, 0.55), mode='fit')
            b.facing([(x0 - 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, ya - 0.5, h - 0.7), (x0 - 0.4, ya - 0.5, h - 0.7)], (0, -1, 0), 'plain', lib.shade(col, 0.8), mode='fit')
    else:
        lib.gable(b, (x0 - 0.4, ya - 0.5, x1 + 0.4, yb + 0.5), h, depth * 0.5 * math.tan(math.radians(12)), lk, axis='x', ov=0.2, slot='corrugated', col=col, gable_slot='plain', gable_col=lib.shade(col, 0.8))
    if b.detail == 0 and benches:
        for k in range(max(2, n // 2)):
            bx = x0 + 3 + (x1 - x0 - 6) * k / max(1, n // 2 - 1) if n // 2 > 1 else (x0 + x1) / 2
            U.box_c(b, bx, y + depth * 0.1, 0.35, 2.6, 0.45, 0.12, 'timber', '#7a5a3a', skip=('bottom',))
            U.box_c(b, bx, y + depth * 0.1 + 0.2, 0.55, 2.6, 0.08, 0.5, 'timber', '#7a5a3a', skip=('bottom',))


def row_shops(b, lk, x0, x1, y, S, w=3.0, d=3.2, h=3.0, key='lock'):
    """A row of lock-up shops with roller shutters under a shared sloping roof."""
    n = max(2, int((x1 - x0) / w))
    ww = (x1 - x0) / n
    rs = S.get(key)
    pal = ['#d9a53a', '#2f6f9a', '#b03a2e', '#4a7a55', '#d9d3c4', '#8a4f9e']
    for k in range(n):
        cx = x0 + ww * (k + 0.5)
        col = rs.choice(pal)
        U.box_c(b, cx, y, 0, ww - 0.1, d, h, 'plain-render', lib.mix(lk.wall_col, col, 0.25), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
        if b.detail == 0:
            U.box_c(b, cx, y - d / 2 - 0.04, 0.2, ww * 0.7, 0.08, 2.1, 'corrugated', col, skip=('bottom',))
    if b.detail < 2:
        pts = [(x0 - 0.2, y - d / 2 - 0.8, h + 0.1), (x1 + 0.2, y - d / 2 - 0.8, h + 0.1), (x1 + 0.2, y + d / 2, h + 0.5), (x0 - 0.2, y + d / 2, h + 0.5)]
        b.facing(pts, (0, -0.2, 1), 'corrugated', lk.roof_col, scale=1.5)


def umbrella(b, x, y, col, r=1.4):
    if b.detail >= 1:
        return
    lib.cylinder(b, x, y, 0, 2.2, 0.04, n=4, slot='frame', col='#8d9298', top=False)
    lib.cylinder(b, x, y, 2.2, 2.6, r, n=8, slot='plain', col=col, r_top=0.05, top=False, smooth=False)


def yard_pad(b, lk, x0, y0, x1, y1, S, tarmac=True):
    lib.ground(b, x0, y0, x1, y1, lk)
    if b.detail < 2 and tarmac:
        with b.site():
            b.face([(x0 + 2, y0 + 2, 0.04), (x1 - 2, y0 + 2, 0.04), (x1 - 2, y1 - 2, 0.04), (x0 + 2, y1 - 2, 0.04)], 'asphalt', '#6a6c70', scale=3.0 if b.detail == 0 else 6.0)


def tint_buses(txt, S):
    """Vehicle palette: Lagos-style yellow danfo, or mixed liveries."""
    if has(txt, 'lagos', 'danfo', 'yellow'):
        return ['#e6b422']
    return ['#f1f1ee', '#2f5f8a', '#c8362f', '#e6b422', '#d9d3c4', '#3f7a52']


# ------------------------------------------------------------------------------------------------------------------------- typologies
def station_building(b, lk, P, S, W, D, H, st, classic):
    """Station building at the origin spanning y in [-D/2, D/2] (front at -Y, platform side at +Y). Returns the roof height and info."""
    feats = P['feats']
    fp = lib.fp_rect(W, D)
    acc = acc_of(lk)
    kind = lk.windows
    if kind in ('none', 'screen', 'louvre', None):
        kind = 'punched' if classic else 'ribbon'
    if classic:
        wk = 'arched' if (lk.windows == 'arched' or 'arcade' in feats or 'arches' in feats) else 'punched'
        U.walls_b(b, lk, fp, 0, H, st, S.get('walls'), kind=wk, ratio=0.4, front_kind=wk, plinth=0.5, band=(0.22, lk.trim_col) if st > 1 else None, bay=3.8)
        if P['roof'] in ('gable', 'hip', 'pyramidal', 'mansard'):
            lib.roof(b, 'gable' if P['roof'] == 'gable' else 'hip', fp, H, lk, pitch=24, ov=1.0 if b.detail < 2 else 0.4)
        else:
            lib.flat_roof(b, fp, H, lk, parapet_h=1.0, ov=0.0, slab=0.0)
    else:
        gh = min(4.6, H * 0.5) if st > 1 else None
        U.walls_b(b, lk, fp, 0, H, st, S.get('walls'), kind=kind, ratio=max(0.35, lk.ratio), front_kind='curtain' if lk.windows in ('curtain',) else kind,
                  ground_kind='curtain' if (st > 1 and lk.windows in ('curtain', 'ribbon')) else None, ground_h=gh, plinth=0.3, bay=4.0)
        if P['roof'] in ('gable', 'hip'):
            lib.roof(b, P['roof'], fp, H, lk, pitch=14, ov=1.2 if b.detail < 2 else 0.4)
        else:
            lib.flat_roof(b, fp, H, lk, parapet_h=0.9, ov=0.0, slab=0.0)
    return fp


def building_extras(b, lk, P, S, fp, H, st, front_y, roof_flat=True):
    """Features shared by station / terminal buildings: crenellated parapet, dome, balcony bands, glazed hall, statue, pavilion."""
    feats = P['feats']
    acc = acc_of(lk)
    x0, y0, x1, y1 = fp.bbox
    cx = (x0 + x1) / 2
    if 'crenellation' in feats and roof_flat and P['roof'] not in ('hip', 'gable'):
        U.crenellate(b, lk, fp, H + 1.0, h=0.8, w=0.9, gap=0.8, col=lk.trim_col, skip_rear=True)
    if 'dome' in feats and b.detail < 2:
        r = U.clamp(min(x1 - x0, y1 - y0) * 0.14, 2.5, 5.5)
        zz = H + (0.0 if roof_flat else 3.0)
        lib.dome(b, cx, (y0 + y1) / 2, zz, r, lk, height=r * 0.9, profile='hemi', slot=lk.roof_slot, col=lk.roof_col, drum=1.6, drum_slot='plain-render', drum_col=lk.trim_col, lantern=1.2, finial=1.5)
    if 'balcony-bands' in feats and st > 1 and b.detail == 0:
        for seg in fp.edges():
            if seg.front:
                for f_ in range(1, st):
                    U.sbox(b, seg, 0, seg.length, H * f_ / st - 0.15, H * f_ / st + 0.15, 0.25, lk.trim_col, skip_ends=True)
    if 'atrium-glass' in feats and b.detail < 2:
        gw = U.clamp((x1 - x0) * 0.2, 6, 14)
        gfp = lib.fp_rect(gw, 3.4, cx, y0 - 1.7)
        gh_ = min(H, 7.0)
        for seg in gfp.edges():
            if not seg.rear:
                U.skin(b, seg, 0, gh_, 2 if gh_ > 5 else 1, 'curtain', lk, group=1)
        pts = [(cx - gw / 2, y0 - 3.4, gh_), (cx + gw / 2, y0 - 3.4, gh_), (cx + gw / 2, y0, gh_ + 1.5), (cx - gw / 2, y0, gh_ + 1.5)]
        b.facing(pts, (0, -0.3, 1), 'glass-ribbon', lk.glass_col, mode='tile')
    if 'statue' in feats and b.detail < 2:
        MAN.statue(b, cx + (x1 - x0) * 0.22, front_y - 5.0, 2.8)
    if 'pavilion' in feats and b.detail < 2:
        U.thatched_pavilion(b, lk, x1 + 6.0, y0 - 4.0, 2.8, thatch=False)


def build_rail(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    classic = P['sty'] in ('colonial', 'georgian', 'victorian', 'neoclassical', 'vernacular', 'tudor', 'gothic-revival') or P['yr'] < 1960
    acc = acc_of(lk)
    W = U.clamp(W, 24, 104)
    D = U.clamp(D, 10, 36)
    H = U.clamp(H, 4.5, 16)
    b.section('building')
    fp = station_building(b, lk, P, S, W, D, H, st, classic)
    cx = 0.0
    yf, yr_ = -D / 2, D / 2
    yq = yr_ + 0.0
    front_y = yf
    if b.detail < 2:
        if classic and 'arcade' in feats and b.detail == 0:
            # arcade along the front
            n = max(4, int(W / 3.4))
            U.veranda(b, lk, -W / 2 + 1.0, W / 2 - 1.0, yf, min(3.8, H * 0.7), 2.6, n, kind='arch')
            front_y = yf - 2.8
        elif 'flat-canopy' in feats or not classic:
            cw = U.clamp(W * 0.38, 8, 26)
            lib.canopy_flat(b, -cw / 2, yf - 6.0, cw / 2, yf, min(4.8, H * 0.7), lk, th=0.55, columns=3 if cw > 14 else 2, col=lk.roof_col, edge_col=acc, r=0.24)
            front_y = yf - 6.0
        if ('clock-tower' in feats or 'bell-tower' in feats) and classic:
            lib.tower(b, cx, 0, H - 0.2, 4.4, 4.4, 7.0, lk, storeys=2, windows='punched', cap='hip', cap_rise=3.6, ratio=0.45)
            if b.detail == 0:
                for sgn in (-1, 1):
                    b.face([(cx - 1.0, -2.23 + (0 if sgn < 0 else 4.46), H + 6.0), (cx + 1.0, -2.23 + (0 if sgn < 0 else 4.46), H + 6.0), (cx + 1.0, -2.23 + (0 if sgn < 0 else 4.46), H + 7.2), (cx - 1.0, -2.23 + (0 if sgn < 0 else 4.46), H + 7.2)] if sgn < 0 else
                           [(cx + 1.0, 2.23, H + 6.0), (cx - 1.0, 2.23, H + 6.0), (cx - 1.0, 2.23, H + 7.2), (cx + 1.0, 2.23, H + 7.2)], 'plain', '#f1eee4', mode='fit')
        if 'steps' in feats and b.detail == 0:
            lib.steps(b, -3, 3, front_y, 0.6, 1.4, 3)
            front_y -= 1.4
        if 'signage-board' in feats:
            U.sign_box(b, cx, yf + 0.3, H + 0.5 if P['roof'] == 'flat' else H + 1.2, U.clamp(W * 0.22, 4, 9), 1.2, acc)
    building_extras(b, lk, P, S, fp, H, st, front_y)
    # platforms and tracks
    b.section('platforms')
    plat_d = 7.0
    y_edge = yr_ + plat_d
    PX = min(W / 2 + 18, 56.0)
    platform(b, lk, -PX, PX, yr_, y_edge, 1.0)
    shed = P['shed']
    track_ys = [y_edge + 3.2, y_edge + 8.6]
    x_a, x_b = -57.0, 57.0
    if shed:
        # train shed: barrel vault over the tracks and an island platform
        sw = 22.0
        yc = y_edge + 5.8
        lib.barrel(b, (-W / 2 - 4, yc - sw / 2, W / 2 + 4, yc + sw / 2), 9.0, 5.0, lk, axis='x', ov=0.0, slot='metal-roof', col=lk.roof_col, end_slot='glass-ribbon', end_col='#cfd8dd')
        if b.detail < 2:
            for k in range(int((W + 8) / 8) + 1):
                xx = -W / 2 - 4 + 8 * k
                for sy in (-1, 1):
                    U.box_c(b, xx, yc + sy * sw / 2, 1.0, 0.4, 0.4, 8.0, 'frame', '#5e656b', skip=('bottom',))
    for ty in track_ys[:2 if b.detail < 2 else 0]:
        rails(b, x_a, x_b, ty, 0.0)
    if 'platform-canopy' in feats or classic or not shed:
        if not shed:
            if classic:
                platform_canopy(b, lk, -PX + 2, PX - 2, yr_, plat_d - 0.6, H - 0.7, 3.6, lib.shade(lk.roof_col, 0.9), 6.5, True, 'iron', wall_x=(-W / 2, W / 2))
            else:
                platform_canopy(b, lk, -PX + 2, PX - 2, yr_, plat_d - 0.4, H * 0.8, H * 0.7, lk.trim_col, 8.0, True, 'flat', wall_x=(-W / 2, W / 2))
    # an island platform with its own canopy beyond the tracks
    ypl = track_ys[1] + 3.2
    platform(b, lk, -PX + 6, PX - 6, ypl, ypl + 5.0, 1.0)
    if 'platform-canopy' in feats and not shed:
        platform_canopy(b, lk, -PX + 8, PX - 8, ypl + 2.5, 5.0, 4.2, 4.0, lk.trim_col, 8.0, False, 'flat')
    # train
    b.section('train')
    if b.detail < 2:
        tcol = S.get('trc').choice(['#2f5f8a', '#c0c7cc', '#3f7a52', '#8a2f2a', '#d9d3c4'])
        train(b, -PX + 14, track_ys[0], int(U.clamp(PX / 18, 2, 4)), tcol, S, loco_col=lk.accent_col if lk.accent_col != lib.shade(lk.wall_col, 0.8) else '#b03a2e')
    if b.detail == 0:
        for k in range(2):
            signal_post(b, x_a + 6 + k * 30, track_ys[0] + 2.4)
    info = {'x0': -PX, 'x1': PX, 'yf': front_y, 'yb': ypl + 6.0, 'fence': False}
    return fp, info


def park_row(b, S, key, x0, x1, y, yaw, kind, density, pal, coach_share=0.3, lines=True):
    """A row of parked vehicles between x0 and x1 on the line y, all facing `yaw`. kind: van | coach | mixed | taxi."""
    vs = S.get(key)
    if b.detail >= 2:
        return
    pitch = {'van': 2.9, 'coach': 3.5, 'mixed': 3.3, 'taxi': 2.6}[kind]
    n = max(1, int((x1 - x0) // pitch))
    for k in range(n):
        xx = x0 + (x1 - x0) * (k + 0.5) / n
        # draw the random numbers first so the choices do not depend on the LOD
        r1, r2, r3, r4 = vs.random(), vs.random(), vs.random(), vs.random()
        col = pal[int(r3 * len(pal)) % len(pal)]
        if r1 > density:
            continue
        if b.detail == 1 and k % 2:
            continue
        a = yaw + (r4 - 0.5) * 0.06
        if kind == 'coach' or (kind == 'mixed' and r2 < coach_share):
            U.coach(b, xx, y, a, col, length=11.0, width=2.5)
        elif kind == 'taxi' or (kind == 'mixed' and r2 > 0.9):
            taxi(b, xx, y, a)
        else:
            danfo(b, xx, y, a, col)
    if lines and b.detail == 0:
        with b.site():
            for k in range(n + 1):
                xx = x0 + (x1 - x0) * k / n
                b.face([(xx - 0.05, y - 3.4, 0.06), (xx + 0.05, y - 3.4, 0.06), (xx + 0.05, y + 3.4, 0.06), (xx - 0.05, y + 3.4, 0.06)][::-1], 'plain', '#f1f1ee', mode='fit')


def shelter(b, lk, x0, x1, y, depth, h, S, form='shed', support='steel', col=None, accent=None, key='sh'):
    """An open passenger / loading shelter of any construction: roof form (shed | gable | flat | curved | sawtooth) on steel posts or
    concrete pillars. Axis along x; the high side is +Y for mono-pitch."""
    col = col or lk.roof_col
    accent = accent or lk.trim_col
    ya, yb = y - depth / 2, y + depth / 2
    n = max(2, int((x1 - x0) / (6.5 if support == 'concrete' else 5.5)))
    for k in range(n + 1):
        xx = x0 + (x1 - x0) * k / n
        if b.detail >= 2:
            continue
        if support == 'concrete':
            hh = h - 0.2
            U.box_c(b, xx, ya + 0.4, 0, 0.5, 0.5, hh, 'plain', '#a9a59b', top_col='#8d8a84', skip=('bottom',))
            if form != 'flat' or depth > 7:
                U.box_c(b, xx, yb - 0.4, 0, 0.5, 0.5, hh + (0.7 if form == 'shed' else 0.0), 'plain', '#a9a59b', top_col='#8d8a84', skip=('bottom',))
            if b.detail == 0 and form in ('flat', 'curved'):
                U.box_c(b, xx, ya + 0.4, hh - 0.5, 0.7, 0.7, 0.5, 'plain', '#9a968e', skip=('bottom',))
        else:
            ps = 0.14
            U.box_c(b, xx, ya + 0.3, 0, 2 * ps, 2 * ps, h - 0.6 if form == 'shed' else h - 0.3, 'frame', '#6e7378', skip=('bottom',))
            U.box_c(b, xx, yb - 0.3, 0, 2 * ps, 2 * ps, h + (0.8 if form == 'shed' else 0.0), 'frame', '#6e7378', skip=('bottom',))
    rect = (x0 - 0.5, ya - 0.5, x1 + 0.5, yb + 0.5)
    if form == 'shed':
        pts = [(x0 - 0.4, ya - 0.5, h - 0.7), (x1 + 0.4, ya - 0.5, h - 0.7), (x1 + 0.4, yb + 0.5, h + 1.3), (x0 - 0.4, yb + 0.5, h + 1.3)]
        b.facing(pts, (0, -0.3, 1), 'corrugated', col, scale=1.5)
        if b.detail == 0:
            b.facing([(x0 - 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, yb + 0.5, h + 0.9), (x0 - 0.4, yb + 0.5, h + 0.9)], (0, 0.3, -1), 'plain', lib.shade(col, 0.55), mode='fit')
            b.facing([(x0 - 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, ya - 0.5, h - 0.9), (x1 + 0.4, ya - 0.5, h - 0.7), (x0 - 0.4, ya - 0.5, h - 0.7)], (0, -1, 0), 'plain', accent, mode='fit')
    elif form == 'gable':
        lib.gable(b, rect, h, depth * 0.5 * math.tan(math.radians(14)), lk, axis='x', ov=0.2, slot='corrugated', col=col, gable_slot='plain', gable_col=lib.shade(col, 0.8))
    elif form == 'flat':
        U.box(b, rect[0], rect[1], h, rect[2], rect[3], h + 0.5, 'plain', accent, top_slot='roof-flat', top_col=col, skip=())
    elif form == 'curved':
        lib.barrel(b, rect, h, max(1.6, depth * 0.22), lk, axis='x', ov=0.0, slot='metal-roof', col=col, end_slot='plain', end_col=lib.shade(col, 0.8))
    else:
        lib.sawtooth(b, rect, h, 1.8, lk, teeth=max(3, int((x1 - x0) / 9)), axis='x', glaze='back', slot='corrugated', col=col)
    if b.detail == 0:
        nb = max(2, n // 2)
        for k in range(nb):
            bx = x0 + 3 + (x1 - x0 - 6) * k / max(1, nb - 1) if nb > 1 else (x0 + x1) / 2
            U.box_c(b, bx, y + depth * 0.1, 0.35, 2.6, 0.45, 0.12, 'timber', '#7a5a3a', skip=('bottom',))
            U.box_c(b, bx, y + depth * 0.1 + 0.2, 0.55, 2.6, 0.08, 0.5, 'timber', '#7a5a3a', skip=('bottom',))


def gate_arch(b, lk, cx, y, w=10.0, h=5.6, col=None, accent=None, kind='arch'):
    """A gateway over the yard entrance: two piers carrying a semicircular arch (or a straight beam) with a blank sign panel on top."""
    if b.detail >= 2:
        return
    col = col or lk.wall_col
    accent = accent or lk.trim_col
    pw = 1.3
    with b.site():
        for sx in (-1, 1):
            U.box_c(b, cx + sx * (w / 2 + pw / 2), y, 0, pw, 1.2, h - 1.2, 'plain-render', col, top_col=lib.shade(col, 0.85), skip=('bottom',))
        if kind == 'arch':
            r = w / 2
            n = 12 if b.detail == 0 else 6
            zc = h - 1.2
            inner, outer = [], []
            for k in range(n + 1):
                a = math.pi * (1 - k / n)
                inner.append((cx + r * math.cos(a), zc + r * 0.55 * math.sin(a)))
                outer.append((cx + (r + pw) * math.cos(a), zc + (r + pw) * 0.55 * math.sin(a)))
            for k in range(n):
                p = [(inner[k][0], y - 0.6, inner[k][1]), (inner[k + 1][0], y - 0.6, inner[k + 1][1]), (outer[k + 1][0], y - 0.6, outer[k + 1][1]), (outer[k][0], y - 0.6, outer[k][1])]
                b.facing(p, (0, -1, 0), 'plain', col, mode='fit')
                if b.detail == 0:
                    q = [(inner[k][0], y + 0.6, inner[k][1]), (inner[k + 1][0], y + 0.6, inner[k + 1][1]), (outer[k + 1][0], y + 0.6, outer[k + 1][1]), (outer[k][0], y + 0.6, outer[k][1])]
                    b.facing(q, (0, 1, 0), 'plain', lib.shade(col, 0.9), mode='fit')
                    b.facing([p[0], p[1], q[1], q[0]], (0, 0, -1), 'plain', lib.shade(col, 0.75), mode='fit')
                    b.facing([p[3], p[2], q[2], q[3]], (0, 0, 1), 'plain', lib.shade(col, 1.05), mode='fit')
            U.box_c(b, cx, y, zc + r * 0.55 + pw * 0.55 - 0.2, 4.4, 0.4, 1.3, 'plain', accent, top_col=lib.shade(accent, 1.1), skip=('bottom',))
        else:
            U.box(b, cx - w / 2 - pw, y - 0.6, h - 1.4, cx + w / 2 + pw, y + 0.6, h - 0.5, 'plain-render', col, skip=())
            U.box_c(b, cx, y, h - 0.5, w * 0.6, 0.35, 1.4, 'plain', accent, top_col=lib.shade(accent, 1.1), skip=('bottom',))


def terminal(b, lk, P, S, cx, cy, w, d, storeys, style, acc, key='term'):
    """The park's ticketing / office building. style: block (rendered, ribbon windows, sign band) | glass (glazed hall) | arcade (arched
    ground floor) | pitched (verandah under a hipped corrugated roof)."""
    H = storeys * 3.7 + (0.5 if style != 'pitched' else 0.0)
    fp = lib.fp_rect(w, d, cx, cy)
    wcol = lib.mix(lk.wall_col, '#f0ece0', 0.25) if style != 'block' else lk.wall_col
    if style == 'glass':
        U.walls_b(b, lk, fp, 0, H, storeys, S.get(key), kind='ribbon', ratio=0.5, front_kind='curtain', ground_kind='curtain' if storeys > 1 else None,
                  ground_h=3.9 if storeys > 1 else None, plinth=0.3, bay=3.6, wall_col=wcol)
    elif style == 'arcade':
        U.walls_b(b, lk, fp, 0, H, storeys, S.get(key), kind='punched', ratio=0.4, front_kind='punched', ground_kind='arched' if storeys > 1 else None,
                  ground_h=3.9 if storeys > 1 else None, plinth=0.4, bay=3.4, wall_col=wcol)
    elif style == 'pitched':
        lib.walls(b, fp, 0, H, storeys, lk, S.get(key), kind='punched', ratio=0.4, front_kind='punched', plinth=0.4, bay=3.4, wall_col=wcol)
    else:
        U.walls_b(b, lk, fp, 0, H, storeys, S.get(key), kind='ribbon', ratio=0.45, front_kind='ribbon', plinth=0.3, bay=3.8, wall_col=wcol)
    if style == 'pitched':
        lib.roof(b, 'hip', fp, H, lk, pitch=20, ov=1.2 if b.detail < 2 else 0.4, roof_slot='corrugated', roof_col=lk.roof_col)
        if b.detail < 2:
            nn = max(3, int(w / 3.0))
            U.veranda(b, lk, cx - w / 2 + 0.6, cx + w / 2 - 0.6, cy - d / 2, 3.2, 2.3, nn, kind='square', roof_slot='corrugated', roof_col=lk.roof_col)
    else:
        lib.flat_roof(b, fp, H, lk, parapet_h=0.9, ov=0.0, slab=0.0)
        if b.detail < 2:
            for seg in fp.edges():
                if seg.front:
                    U.sbox(b, seg, 0, seg.length, H - 0.2, H + 0.9, 0.15, acc, skip_ends=True)
                    U.sbox(b, seg, seg.length * 0.3, seg.length * 0.7, H + 0.9, H + 2.0, 0.1, lib.shade(acc, 1.12), skip_ends=True)
    return H


def build_motorpark(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    txt = P['txt']
    W = U.clamp(W, 28, 104)
    D = U.clamp(D, 20, 80)
    rs = S.get('mp')
    r = [rs.random() for _ in range(20)]
    x0, x1 = -W / 2, W / 2
    yf, yb = -D / 2, D / 2
    acc = acc_of(lk)
    if r[0] < 0.3:
        acc = rs.choice(['#2f6b4f', '#2f5f8a', '#b03a2e', '#d9803a', '#6a3f7a']) if lk.accent_col == lib.shade(lk.wall_col, 0.8) else acc
    wall_on = 'fence-wall' in feats or 'gate' in feats
    # ---- brief-driven decisions
    shape = 'L' if (P['fpk'] in ('irregular', 'L') and W >= 50 and D >= 40) else 'rect'
    nw, nd = W * (0.3 + 0.1 * r[1]), D * (0.3 + 0.12 * r[2])      # notch (back-right corner) for L yards
    unpaved = has(txt, 'laterite', 'sandy', 'bare', 'unpaved', 'dirt', 'sand ') and not has(txt, 'tarmac', 'paved')
    concrete_yard = (not unpaved) and (has(txt, 'concrete', 'paving', 'paved') or lk.wall_material in ('concrete', 'exposed-concrete')) and r[3] < 0.55
    roof_map = {'gable': 'gable', 'flat': 'flat', 'barrel': 'curved', 'curved': 'curved', 'shed': 'shed', 'sawtooth': 'sawtooth'}
    forms = ['shed', 'gable', 'flat', 'curved']
    form = roof_map.get(P['roof']) if (P['roof'] in roof_map and r[4] < 0.65) else forms[int(r[5] * len(forms)) % len(forms)]
    support = 'concrete' if ((lk.wall_material in ('concrete', 'exposed-concrete') and r[6] < 0.65) or r[6] < 0.2) else 'steel'
    layout = 'island' if (W >= 56 and D >= 42 and r[7] < 0.38) else ('split' if (W >= 64 and D >= 46 and r[7] < 0.7) else 'back')
    n_sheds = 1 + (1 if (W > 78 and layout == 'back') else 0) + (1 if (W > 98 and layout == 'back' and r[8] < 0.5) else 0)
    sh = U.clamp(H, 3.8, 6.2) + (0.6 if form in ('curved', 'flat') else 0.0)
    sd = U.clamp(D * (0.16 + 0.07 * r[9]), 6.0, 11.0)
    density = 0.3 if has(txt, ' few ', 'quiet', 'small') else (0.95 if has(txt, 'rows', 'busy', 'crowd', 'large', 'many') else 0.45 + 0.35 * r[10])
    coach_share = 0.75 if has(txt, 'intercity', 'coach', 'long-distance', 'luxury') else (0.0 if has(txt, 'minibus', 'shared taxi', 'taxi') and not has(txt, 'bus') else 0.12 + 0.35 * r[11])
    herring = r[12] < 0.28
    tstor = 2 if ((W >= 70 and r[13] < 0.6) or P['storeys'] >= 2) else 1
    tstyle = ['block', 'glass', 'arcade', 'pitched'][int(r[14] * 4) % 4]
    if tstor == 2 and tstyle == 'pitched':
        tstyle = 'block'
    tleft = r[15] < 0.5
    wall_kind = 'none' if not wall_on else ('high' if r[16] < 0.5 else 'rail')
    if not wall_on and r[16] < 0.2:
        wall_kind = 'rail'
    gate_kind = 'arch' if (wall_kind != 'none' and r[17] < 0.55) else ('beam' if wall_kind != 'none' and r[17] < 0.8 else None)
    P['paved'] = not unpaved
    pool = ['#f1f1ee', '#2f5f8a', '#c8362f', '#e6b422', '#d9d3c4', '#3f7a52', '#5a6f8a', '#8a2f2a']
    ps = S.get('pal')
    ps.shuffle(pool)
    pal = pool[:3]
    if has(P['txt'] + ' ' + str(P.get('city', '')), 'lagos', 'danfo', 'yellow', 'ibadan', 'abeokuta', 'ijebu', 'ota ', 'sagamu'):
        pal = ['#e6b422']
    ground_col = '#6a6c70' if not concrete_yard else '#a7a49c'
    # ---- yard surface and boundary (site)
    xr_back = x1 - nw - 2.0 if shape == 'L' else x1
    yard = [(x0, yf), (x1, yf), (x1, yb - nd if shape == 'L' else yb), ((x1 - nw) if shape == 'L' else x1, yb - nd if shape == 'L' else yb), ((x1 - nw) if shape == 'L' else x1, yb), (x0, yb)]
    yard = [p for k, p in enumerate(yard) if k == 0 or p != yard[k - 1]]
    if shape != 'L':
        yard = [(x0, yf), (x1, yf), (x1, yb), (x0, yb)]
    P['yard'] = yard
    P['notch'] = (nw, nd)
    P['yard_cols'] = (ground_col, unpaved, concrete_yard)
    P['wall_kind'] = wall_kind
    P['gate_kind'] = gate_kind
    # ---- shelters
    b.section('shelter')
    scol = lib.mix(lk.roof_col, '#8a8f93', 0.3) if lk.roof_slot != 'corrugated' else lk.roof_col
    shelter_ys = []
    if layout == 'back':
        avail = (xr_back - x0 - 12)
        sw = (avail - 4 * (n_sheds - 1)) / n_sheds
        for i in range(n_sheds):
            sx0 = x0 + 6 + i * (sw + 4)
            yy = yb - sd / 2 - 3
            shelter(b, lk, sx0, sx0 + sw, yy, sd, sh, S, form, support, scol, acc)
        shelter_ys.append(yb - sd - 6)
    elif layout == 'island':
        sw = U.clamp(W * 0.55, 24, 64)
        shelter(b, lk, -sw / 2, sw / 2, 2.0, sd, sh, S, form, support, scol, acc)
        shelter_ys.append(2.0 + sd / 2 + 8)
    else:   # split: a long shelter at the back-left, a short one at the front-right
        sw = U.clamp((xr_back - x0) * 0.62, 22, 60)
        shelter(b, lk, x0 + 6, x0 + 6 + sw, yb - sd / 2 - 3, sd, sh, S, form, support, scol, acc)
        sw2 = U.clamp(W * 0.28, 14, 30)
        sx2 = (x1 - 6 - sw2) if tleft else (x0 + 6)
        shelter(b, lk, sx2, sx2 + sw2, yf + 22, sd * 0.8, sh * 0.9, S, form, support, scol, acc, key='sh2')
        shelter_ys.append(yb - sd - 6)
    # ---- terminal / office
    b.section('buildings')
    tw = U.clamp(W * 0.2, 11, 26)
    td = U.clamp(D * 0.17, 8, 13)
    tcx = (x0 + 4 + tw / 2) if tleft else (x1 - 4 - tw / 2)
    tcy = yf + td / 2 + 3.5
    terminal(b, lk, P, S, tcx, tcy, tw, td, tstor, tstyle, acc)
    # lock-up shops along the opposite front corner or the inner back wall
    lw = U.clamp(W * 0.28, 12, 26)
    if r[18] < 0.5 or shape == 'L':
        lx0 = (x1 - 4 - lw) if tleft else (x0 + 4)
        row_shops(b, lk, lx0, lx0 + lw, yf + 3.0 + 1.6, S, 3.0, 3.2, 3.0)
    else:
        row_shops(b, lk, xr_back - 4 - lw, xr_back - 4, yb - 2.2, S, 3.0, 3.2, 3.0)
    b.section('kiosks')
    nk = 2 if W < 60 else 3
    kx0 = (tcx + tw / 2 + 5.0) if tleft else (tcx - tw / 2 - 5.0)
    for k in range(nk):
        kiosk_booth(b, lk, kx0 + (1 if tleft else -1) * k * 5.5, yf + 5.5, lib.mix(lk.wall_col, acc, 0.3 if k else 0.15), sign=acc)
    # ---- vehicles
    b.section('vehicles')
    kind = 'coach' if coach_share > 0.7 else ('van' if coach_share == 0.0 else 'mixed')
    y_top = min(shelter_ys) - 2.0
    rows = int(U.clamp((y_top - (yf + 16.0)) // 11 + 1, 1, 3))
    yaw0 = math.pi / 2
    for rr in range(rows):
        yy = yf + 18.0 + rr * 12.0
        if yy > y_top:
            break
        yaw = (yaw0 if rr % 2 == 0 else -yaw0)
        if herring:
            yaw = (math.pi / 2 - 0.6) if rr % 2 == 0 else (-math.pi / 2 - 0.6)
        xa, xb = x0 + 8, x1 - 8
        if shape == 'L' and yy > yb - nd - 10:
            xb = x1 - nw - 6
        k_ = kind if rr % 2 else ('van' if kind == 'mixed' else kind)
        park_row(b, S, 'row%d' % rr, xa, xb, yy, yaw, k_, density, pal, coach_share, lines=not herring)
    if layout == 'island':
        park_row(b, S, 'rowb', x0 + 8, (x1 - 8) if shape != 'L' else (x1 - nw - 6), 2.0 + sd / 2 + 8, -math.pi / 2, 'van' if kind == 'mixed' else kind, density, pal, coach_share)
    if b.detail == 0 and r[19] < 0.55:
        # shade-tree islands between the bus rows
        for kk in range(2):
            ix = x0 + W * (0.3 + 0.4 * kk)
            iy = yf + 24.0
            if iy < y_top - 4:
                with b.site():
                    U.box_c(b, ix, iy, 0, 3.2, 3.2, 0.35, 'rough-concrete', '#b0aca3', top_slot='grass', top_col='#6d9a4f', skip=('bottom',))
                if lk.tree not in (None, 'none'):
                    lib.tree(b, lk.tree, ix, iy, rs.uniform(6, 8), S.get('isl%d' % kk), lk)
    if b.detail == 0:
        for k in range(4 if ('umbrellas' in feats or 'stalls' in feats) else 2):
            umbrella(b, x0 + 10 + rs.uniform(0, W - 24), min(shelter_ys) + rs.uniform(-1.5, 1.5), rs.choice(['#c0392b', '#e0b43a', '#2f7d5b', '#2f5f8a']))
    if 'water-tank' in feats:
        IND.water_tower(b, lk, x0 + 4, yb - 3, 9.0, r=2.0)
    info = {'x0': x0, 'x1': x1, 'yf': yf, 'yb': yb, 'fence': wall_on, 'motor': True}
    return None, info


def IND_coach(b, x, y, yaw, col):
    U.coach(b, x, y, yaw, col, length=11.0)


def build_busterm(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    W = U.clamp(W, 36, 104)
    D = U.clamp(D, 24, 70)
    bd = U.clamp(D * 0.36, 12, 20)
    H = U.clamp(H, 5, 14)
    acc = acc_of(lk)
    yb = D / 2
    yf = -D / 2
    ybld0 = yb - bd
    rr_ = [S.get('bt').random() for _ in range(8)]
    b.section('building')
    bw_ = W * (0.62 + 0.2 * rr_[0])
    bcx = (-W * 0.1 if rr_[1] < 0.35 else (W * 0.1 if rr_[1] < 0.7 else 0.0))
    style_ = ['block', 'glass', 'arcade'][int(rr_[2] * 3) % 3]
    fp = lib.fp_rect(bw_, bd, bcx, ybld0 + bd / 2)
    H = terminal(b, lk, P, S, bcx, ybld0 + bd / 2, bw_, bd, max(1, st), style_, acc, key='bterm')
    b.section('canopy')
    # departure canopy over the coach bays: flat slab, barrel vault or mono-pitch, on steel posts or concrete pillars
    cdx = U.clamp(D * 0.28, 8, 14)
    cw_ = U.clamp(W * (0.62 + 0.25 * rr_[3]), 24, W * 0.92)
    cx0, cx1 = bcx - cw_ / 2, bcx + cw_ / 2
    cform = ['flat', 'curved', 'shed'][int(rr_[4] * 3) % 3]
    csup = 'concrete' if rr_[5] < 0.4 else 'steel'
    if b.detail < 2:
        shelter(b, lk, cx0, cx1, ybld0 - cdx / 2, cdx, min(5.2, max(4.4, H * 0.7)), S, cform, csup, lk.roof_col, acc, key='bshelter')
    else:
        U.box(b, cx0, ybld0 - cdx, 4.0, cx1, ybld0, 4.7, 'plain', lk.roof_col, skip=())
    b.section('vehicles')
    vs = S.get('veh')
    pal = tint_buses(P['txt'], S)
    nb = int((cx1 - cx0) // 4.0)
    if b.detail < 2:
        for k in range(nb):
            xx = cx0 + 3.0 + (cx1 - cx0 - 6.0) * (k + 0.5) / nb
            if vs.random() < 0.3:
                continue
            if b.detail == 1 and k % 2:
                continue
            if vs.random() < 0.55:
                U.coach(b, xx, ybld0 - cdx + 7.0, -math.pi / 2 + 0.0, vs.choice(pal), length=11.0)
            else:
                danfo(b, xx, ybld0 - cdx + 4.0, -math.pi / 2, vs.choice(pal))
    if b.detail == 0:
        with b.site():
            for k in range(nb + 1):
                xx = cx0 + 3.0 + (cx1 - cx0 - 6.0) * k / nb
                b.face([(xx - 0.05, ybld0 - cdx, 0.06), (xx + 0.05, ybld0 - cdx, 0.06), (xx + 0.05, ybld0 - 1.0, 0.06), (xx - 0.05, ybld0 - 1.0, 0.06)][::-1], 'plain', '#f1f1ee', mode='fit')
    building_extras(b, lk, P, S, fp, H, max(1, st), ybld0 - cdx)
    b.section('kiosks')
    if 'kiosk' in feats or True:
        for k in range(2):
            kiosk_booth(b, lk, cx1 + 4 + k * 4.0 if cx1 + 8 < W / 2 + 10 else cx0 - 4 - k * 4.0, ybld0 + 3.0, lib.mix(lk.wall_col, acc, 0.25), sign=acc)
    if 'signage-board' in feats and b.detail < 2:
        U.sign_box(b, 0.0, ybld0 + 0.3 + bd - 0.6, H + 0.5, U.clamp(W * 0.18, 5, 10), 1.3, acc)
    info = {'x0': -W / 2, 'x1': W / 2, 'yf': yf, 'yb': yb + 2.0, 'fence': 'fence-wall' in feats}
    return fp, info


def build_ferry(b, lk, P, S):
    W, D, H, st = P['W'], P['D'], P['H'], P['storeys']
    feats = P['feats']
    W = U.clamp(W, 24, 80)
    D = U.clamp(D, 10, 30)
    H = U.clamp(H, 3.6, 10)
    acc = acc_of(lk)
    y0 = -D / 2 - 4.0
    b.section('terminal')
    fp = lib.fp_rect(W, D, 0, 0)
    lib.walls(b, fp, 0, H, max(1, st), lk, S.get('walls'), kind=lk.windows if lk.windows not in ('none', None, 'screen') else 'ribbon', ratio=max(0.3, lk.ratio), plinth=0.4, bay=3.8,
              front_kind=lk.windows if lk.windows not in ('none', None, 'screen') else 'ribbon')
    if P['roof'] in ('hip', 'gable'):
        lib.roof(b, P['roof'], fp, H, lk, pitch=16, ov=1.4 if b.detail < 2 else 0.5)
    elif P['roof'] == 'shed':
        lib.roof(b, 'shed', (-W / 2, -D / 2, W / 2, D / 2), H, lk, rise=min(2.4, D * 0.18), ov=0.6, high='back')
    else:
        lib.flat_roof(b, fp, H, lk, parapet_h=0.8, ov=0.0, slab=0.0)
    if b.detail < 2:
        lib.canopy_flat(b, -W * 0.18, -D / 2 - 5.0, W * 0.18, -D / 2, min(4.2, H * 0.8), lk, th=0.5, columns=2, col=lk.roof_col, edge_col=acc, r=0.22)
    b.section('water+jetty')
    yw = D / 2 + 14.0     # shoreline
    jl = 54.0
    if b.detail < 2:
        with b.site():
            b.face([(-62.0, yw, 0.0), (62.0, yw, 0.0), (62.0, yw + 42.0, 0.0), (-62.0, yw + 42.0, 0.0)], 'plain', '#4d8aa6', mode='fit')
        # quay apron from the terminal back to the shore
        U.box(b, -W / 2 - 4, D / 2, 0, W / 2 + 4, yw, 0.4, 'paving', '#a9a59b', skip=('bottom', 'back'), scale=2.0)
    jw = 6.0
    jx = 0.0
    # jetty deck on piles
    U.box(b, jx - jw / 2, yw - 1.0, 0.5, jx + jw / 2, yw + jl, 1.05, 'timber' if lk.wall_material == 'timber' else 'paving', '#9d9a92' if lk.wall_material != 'timber' else '#8a6a4a', skip=('bottom',), scale=2.0)
    if b.detail == 0:
        for k in range(int(jl / 4) + 1):
            for sx in (-1, 1):
                lib.cylinder(b, jx + sx * (jw / 2 - 0.3), yw + 1 + k * 4.0, -0.2, 0.5, 0.2, n=5, slot='timber', col='#5a4a3a', top=False)
                lib.cylinder(b, jx + sx * (jw / 2 + 0.05), yw + 1 + k * 4.0, 1.05, 1.5, 0.12, n=5, slot='frame', col='#3a3d41', top=True)
    if 'platform-canopy' in feats or 'pier' in feats or True:
        # passenger shelter on the jetty
        U.box_c(b, jx, yw + 6.0, 2.6, jw + 0.6, 12.0, 0.2, 'plain', lk.roof_col, skip=()) if b.detail < 2 else None
        if b.detail == 0:
            for k in range(4):
                for sx in (-1, 1):
                    lib.cylinder(b, jx + sx * (jw / 2 - 0.2), yw + 1.0 + k * 3.6, 1.05, 2.7, 0.1, n=4, slot='frame', col='#6e7378', top=False, smooth=False)
    # boats
    b.section('boats')
    bs = S.get('boats')
    if b.detail < 2:
        U.boat(b, jx + jw / 2 + 4.2, yw + 14.0, math.pi / 2, bs.choice(['#2f5f8a', '#b03a2e', '#3f7a52']), length=12.0, width=3.4)
        U.boat(b, jx - jw / 2 - 3.2, yw + 30.0, math.pi / 2, bs.choice(['#d9a53a', '#8a2f2a', '#2f5f8a']), length=9.0, width=2.8)
        U.boat(b, jx + jw / 2 + 16.0, yw + 8.0, 0.3, '#d8d3c4', length=7.0, width=2.4)
    info = {'x0': -W / 2 - 4, 'x1': W / 2 + 4, 'yf': y0, 'yb': yw, 'fence': 'fence-wall' in feats, 'water': True}
    return fp, info


def build_harbour(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    W = U.clamp(W, 60, 104)
    D = U.clamp(D, 40, 70)
    x0, x1 = -W / 2, W / 2
    yf, yb = -D / 2, D / 2
    rs = S.get('hb')
    yq = yb - 4.0
    b.section('water+quay')
    if b.detail < 2:
        with b.site():
            b.face([(x0 - 6, yq, 0.0), (x1 + 6, yq, 0.0), (x1 + 6, yq + 42.0, 0.0), (x0 - 6, yq + 42.0, 0.0)], 'plain', '#4d8aa6', mode='fit')
    U.box(b, x0 - 6, yf + 4, 0, x1 + 6, yq, 0.5, 'paving', '#9d9a92', skip=('bottom', 'back'), scale=3.0)
    if b.detail < 2:
        U.box(b, x0 - 6, yq - 0.6, 0.5, x1 + 6, yq, 0.9, 'rough-concrete', '#b0aca3', skip=('bottom',))
        if b.detail == 0:
            for k in range(int(W // 9) + 1):
                lib.cylinder(b, x0 + 3 + k * 9, yq - 1.2, 0.5, 1.0, 0.3, n=6, slot='frame', col='#3a3d41', r_top=0.4, top=True, smooth=False)
    b.section('ship')
    IND.ship(b, x0 + W * 0.42 + 6, yq + 8.0, L=min(80.0, W * 0.8), Wd=14.0, S=S, hull=rs.choice(['#394049', '#2f4a63', '#4a3a3a']), stripe=rs.choice(['#b03a2e', '#c8962f']))
    b.section('sheds')
    nsh = 2 if 'sheds' in feats or W > 80 else 1
    for i in range(nsh):
        IND.warehouse(b, lk, x0 + 22 + i * 38, yf + 18, 34.0, 16.0, 9.0, S, 'shed' if P['roof'] == 'shed' else 'gable', col=lib.jitter(lk.wall_col, S.get('wh%d' % i), 0.06), doors=3)
    b.section('crane+containers')
    IND.crane(b, x1 - 20, yq - 14.0, yq + 18.0, '#2f6f9a', h=34.0)
    IND.container_stack(b, S, x0 + 12, yf + 38, 3, 3, 3, key='c1')
    if b.detail < 2:
        for k in range(3):
            U.truck(b, x0 + 30 + k * 9, yf + 32.0, 0.0, rs.choice(['#c8362f', '#2f5f8a', '#d9d3c4']), length=8.0)
    if 'storage-tanks' in feats and b.detail < 2:
        for i in range(2):
            IND.tank(b, lk, x1 - 12, yf + 14 + i * 12, 4.6, 9.0, '#d9dcde', 'cone', stairs=False)
    info = {'x0': x0 - 6, 'x1': x1 + 6, 'yf': yf, 'yb': yq, 'fence': 'fence-wall' in feats, 'water': True}
    return None, info


def build_metro(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    W = U.clamp(W, 8, 28)
    D = U.clamp(D, 8, 26)
    acc = acc_of(lk)
    b.section('portal')
    # sunken stair portal: a low glazed canopy over a stair well with balustrades
    hh = 3.4
    fp = lib.fp_rect(W, D, 0, 0)
    cw, cd = W * 0.9, D * 0.9
    # side walls (balustrades) and the glass roof sloping down towards the street
    for sx in (-1, 1):
        U.box(b, sx * cw / 2 - 0.25, -cd / 2, 0, sx * cw / 2 + 0.25, cd / 2, hh, 'rough-concrete', lib.shade(lk.wall_col, 0.9), skip=('bottom',))
    U.box(b, -cw / 2, cd / 2 - 0.4, 0, cw / 2, cd / 2, hh, 'rough-concrete', lib.shade(lk.wall_col, 0.9), skip=('bottom',))
    pts = [(-cw / 2 - 0.4, -cd / 2 - 0.4, hh - 0.6), (cw / 2 + 0.4, -cd / 2 - 0.4, hh - 0.6), (cw / 2 + 0.4, cd / 2 + 0.4, hh + 1.2), (-cw / 2 - 0.4, cd / 2 + 0.4, hh + 1.2)]
    b.facing(pts, (0, -0.4, 1), 'glass-curtain' if b.detail < 2 else 'plain', '#9fb4c2', mode='tile', scale=2.0) if b.detail < 2 else b.facing(pts, (0, -0.4, 1), 'plain', '#6f8fa2')
    if b.detail < 2:
        b.facing([(-cw / 2 - 0.4, -cd / 2 - 0.4, hh - 0.8), (cw / 2 + 0.4, -cd / 2 - 0.4, hh - 0.8), (cw / 2 + 0.4, -cd / 2 - 0.4, hh - 0.6), (-cw / 2 - 0.4, -cd / 2 - 0.4, hh - 0.6)], (0, -1, 0), 'plain', acc, mode='fit')
    # descending stairs: a dark inclined opening with steps (approximated by a ramp quad and treads)
    if b.detail == 0:
        for k in range(10):
            zz = 0.0 - 0.0
            b.face([(-cw / 2 + 0.6, -cd / 2 + 0.2 + k * (cd - 1.0) / 10, 0.08 + 0.0), (cw / 2 - 0.6, -cd / 2 + 0.2 + k * (cd - 1.0) / 10, 0.08), (cw / 2 - 0.6, -cd / 2 + 0.2 + (k + 1) * (cd - 1.0) / 10 - 0.02, 0.08), (-cw / 2 + 0.6, -cd / 2 + 0.2 + (k + 1) * (cd - 1.0) / 10 - 0.02, 0.08)][::-1], 'plain', '#4d4f53' if k % 2 == 0 else '#3d3f43', mode='fit')
    b.section('signage')
    # pylon sign: a blank lit column with a ring, plus a kiosk
    if b.detail < 2:
        lib.cylinder(b, cw / 2 + 3.0, -cd / 2 - 2.0, 0, 6.0, 0.25, n=6, slot='frame', col='#6e7378', top=False)
        lib.cylinder(b, cw / 2 + 3.0, -cd / 2 - 2.0, 5.2, 5.5, 1.3, n=12, slot='plain', col=acc, r_top=1.3, top=True, smooth=False)
        lib.cylinder(b, cw / 2 + 3.0, -cd / 2 - 2.0, 5.2, 5.5, 0.85, n=12, slot='plain', col='#f1eee4', r_top=0.85, top=True, smooth=False)
    if 'kiosk' in feats and b.detail < 2:
        kiosk_booth(b, lk, -cw / 2 - 3.5, -cd / 2 - 1.0, lib.mix(lk.wall_col, acc, 0.3), sign=acc)
    info = {'x0': -W / 2 - 6, 'x1': W / 2 + 6, 'yf': -D / 2 - 2.5, 'yb': D / 2 + 1.0, 'fence': False, 'plaza': True}
    return fp, info


def build(brief, style, rng, detail):
    b = lib.Builder('transport-station', detail)
    S = U.Streams(rng)
    brief = U.sane(brief)
    style = style if isinstance(style, dict) else {}
    lk = lib.look(brief, style, S.get('look'))
    P = plan(brief, style, lk, S)
    P['city'] = brief.get('city', '')
    typ = P['typ']
    fn = {'rail': build_rail, 'motorpark': build_motorpark, 'busterm': build_busterm, 'ferry': build_ferry, 'harbour': build_harbour, 'metro': build_metro}[typ]
    fp, info = fn(b, lk, P, S)
    feats = P['feats']
    if typ in ('motorpark',):
        if detail < 2:
            x0, x1, yf, yb = info['x0'] - 3.0, info['x1'] + 3.0, info['yf'] - 8.0, info['yb'] + 3.0
            ground_col, unpaved, concrete_yard = P['yard_cols']
            b.section('ground')
            lib.ground(b, x0 - 5, yf - 10, x1 + 5, yb + 5, lk)
            poly = [(px, py) for (px, py) in P['yard']]
            if len(poly) == 4:
                poly = [(x0, yf), (x1, yf), (x1, yb), (x0, yb)]
            with b.site():
                if not unpaved:
                    lib.cap(b, [poly], 0.04, True, 'asphalt' if not concrete_yard else 'paving', ground_col, scale=3.0 if detail == 0 else 6.0)
                else:
                    gx0 = (x0 + x1) / 2 - 9
                    b.face([(gx0, yf - 2, 0.04), (gx0 + 18, yf - 2, 0.04), (gx0 + 18, yf + 14, 0.04), (gx0, yf + 14, 0.04)], 'asphalt', '#6a6c70', scale=3.0)
            lib.forecourt(b, 'road', x0 - 5, yf - 10, x1 + 5, yf - 2, lk, S.get('road'))
            wk = P['wall_kind']
            if wk != 'none':
                if len(P['yard']) == 4:
                    pts = [(x0 + 1, yf + 1), (x0 + 1, yb - 1), (x1 - 1, yb - 1), (x1 - 1, yf + 1), (x0 + 1, yf + 1)]
                else:
                    nw_, nd_ = P['notch']
                    pts = [(x0 + 1, yf + 1), (x0 + 1, yb - 1), (x1 - nw_ - 1, yb - 1), (x1 - nw_ - 1, yb - nd_ - 1), (x1 - 1, yb - nd_ - 1), (x1 - 1, yf + 1), (x0 + 1, yf + 1)]
                solid = 2.2 if wk == 'high' else 0.7
                fh = 2.7 if wk == 'high' else 2.1
                gseg = len(pts) - 2
                gate_w = 10.0
                # position the gate so it opens at the middle of the front segment
                seg_len = math.hypot(pts[gseg + 1][0] - pts[gseg][0], pts[gseg + 1][1] - pts[gseg][1])
                gfrac = 0.5
                U.fence(b, lk, pts, h=fh, col=lib.shade(lk.wall_col, 1.0), solid=solid, gate=(gseg, gfrac, gate_w), pillar_every=6.0)
                if P['gate_kind']:
                    gcx = (pts[gseg][0] + pts[gseg + 1][0]) / 2
                    gate_arch(b, lk, gcx, yf + 1, gate_w, 5.6, col=lk.wall_col, accent=acc_of(lk), kind=P['gate_kind'])
            if 'signage-board' in feats:
                U.pylon_sign(b, x1 - 12, yf - 0.6, 7.0, 4.0, acc_of(lk))
            for k in range(2 if detail == 1 else 3):
                U.floodlight(b, x0 + 8 + (x1 - x0 - 16) * k / 2.0, yb - 2, 14)
            if lk.tree not in (None, 'none'):
                rs = S.get('trees')
                for k in range(3 if detail == 0 else 1):
                    lib.tree(b, lk.tree, x0 - 1 + rs.uniform(0, 2), yf + 8 + k * 12, rs.uniform(6, 9), S.get('tr%d' % k), lk)
    elif typ == 'metro':
        U.plot_site(b, lk, S, feats, {'forecourt': 'plaza', **P['setting']}, info['x0'] + 6, info['x1'] - 6, info['yf'], info['yb'], fore=18.0, aft=6.0, road_w=8.0, side=20.0, trees=4)
    else:
        sign = (7.0, 2.2, acc_of(lk)) if ('signage-board' in feats and typ in ('ferry', 'harbour')) else None
        extra = dict(fore=24.0 if typ in ('rail', 'busterm') else 18.0, aft=0.0 if info.get('water') else 8.0, side=8.0, trees=4, flags=3 if 'flags' in feats else 0, sign=sign,
                     forecourt=(P['setting'].get('forecourt') if P['setting'].get('forecourt') in ('parking', 'garden', 'plaza') else 'parking'), fence_default=info['fence'])
        if typ == 'busterm':
            extra['forecourt'] = 'parking' if ('car-park' in feats) else 'plaza'
        U.plot_site(b, lk, S, feats, P['setting'], info['x0'], info['x1'], info['yf'], info['yb'], **extra)
    return b.objects()
