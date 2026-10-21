"""Commerce parts (markets, shops, malls, cafes, restaurants) for per-place composition.

Every part is `fn(b, look, rng, detail, at=(x, y, z), rot=0.0, **params)`: it builds into Builder `b` at `at` (metres, z = ground level of
the part) turned `rot` degrees about +Z (counter-clockwise seen from above). In the part's own frame: origin on the ground, +x to the right
of the part's front, +y into the part (depth), the front faces -y, +z up. All sizes are metres, colours '#hex', unknown params raise.
Every part also accepts the look overrides `wall_colour wall_material roof_colour roof_material trim_colour accent_colour`
(materials: the MATERIALS / ROOF_MATERIALS ids of the contract). Colour lists default from the look (city style) and fixed palettes.
LOD: detail 0 is the full part, 1 drops small furniture and uses coarse tiling, 2 is a coloured massing. Everything is deterministic given rng.

Parts (name: params with defaults) -- what it looks like

MARKET AND STALL PIECES
 lock-up-row: length=24 depth=3.3 height=3.2 roof=shed|gable|hip|flat unit_width=2.5 veranda=1.2 shutter_colours=None open_ratio=0.18
     arch=False relief=False awning_colours=None goods_colours=None posts=True rise=None
     a row of lock-up shops: roll-shutter or open units under blank fascia boards, corrugated roof with a veranda on posts.
     arch=True gives arched mud-brick doorways, relief=True a carved band (Hausa), awning_colours adds cloth awnings.
 stall-row: count=8 pitch=3.0 kind=umbrella|tarp|mixed size=1.0 colours=None goods_colours=None jitter=0.3
     a line of trader tables under umbrellas or four-post tarps with heaps of goods.
 umbrella-cluster: count=6 spread=4.0 radius=1.5 height=2.4 colours=None tables=True
     a loose cluster of market umbrellas (with trading tables when tables=True).
 market-shed: length=24 depth=8 height=3.8 roof=gable|shed|hip roof_rise=None post_pitch=5.0 cladding=None goods=sacks|timber|yam|none
     open-sided warehouse shed: steel posts, corrugated roof, optional steel-clad back/end walls, stacked sacks / planks / yams inside.
 awning: width=3.0 depth=1.4 drop=0.5 height=2.7 colours=None stripe=0.75 valance=0.22 posts=True
     a striped cloth awning projecting in front of a wall (wall at y=0), top edge at `height`.
 shopfront: width=3.4 height=3.6 kind=shutter|glass|open colour=None sign_colour=None sign_height=0.9 awning_colours=None depth=0.0
     one shop unit: wall, shutter / glazing / open stall, blank fascia board, optional awning; depth>0 adds a box body behind it.
 kiosk: kind=container|box width=3.2 depth=2.2 height=2.6 colour=None
     a ribbed trading container or a painted kiosk with a shutter hatch and sloping roof.
 table-set: chairs=4 table_colour='#f2f2ee' chair_colour=None umbrella=False radius=0.42
     a round table with plastic chairs (and optionally a parasol).
 bunting: length=8 height=2.8 colours=None
     a string of small triangular flags (LOD0 only).
 dye-pit-field: rows=3 cols=6 spacing_x=4.5 spacing_y=4.0 radius=1.0 rim=0.45 cloth_lines=2 colours=None
     round mud-rimmed dye pits with indigo liquid and drying lines of blue cloth.
 pen: width=14 depth=12 animals=3 kind=cattle
     a timber rail pen with cattle.
 cow: scale=1.0 colour=None
     one low-poly cow.

SHOP BLOCKS, FACADES AND STREET PIECES
 shop-block: width=30 depth=12 storeys=3 floor_height=3.4 ground_height=4.2 windows=punched|ribbon|curtain|louvre|screen|arched
     window_ratio=0.3 gallery=False arcade=False roof=flat|gable|hip parapet=1.0 shop_kind=mixed|glass|shutter awning_ratio=0.3
     entrance=True rooftop=True
     a rectangular multi-storey block with lock-up shops under fascia boards on the front, floors of windows above, optional balcony
     galleries or arcade, entrance bay with arch and sign, flat roof with parapet and tanks / stair core.
 terrace-row: length=40 depth=10 storeys=3 kind=euro|asia|naija roof=gable|flat ground_height=None floor_height=3.2 awning_ratio=0.5
     balcony=False chimneys=True
     a continuous row of narrow party-wall buildings: euro (brick/stucco, sash windows, pitched roof, chimneys), asia (five-foot-way
     shophouses with tiled gables and stepped parapets), naija (flat painted blocks with balcony bands).
 gate: width=6 height=3.4 colour=None board_colour=None arch=False
     two piers with caps and a blank lintel board.
 crenellated-wall: length=20 height=2.0 thickness=0.45 crenel=True pitch=1.4 colour=None material=None
     a free-standing wall with optional merlons.
 colonnade: count=6 spacing=3.0 height=3.6 radius=0.25 kind=round|square beam=0.5
     columns carrying a long beam.
 veranda: length=14 depth=2.6 height=3.0 balustrade=True steps=True roof=lean-to|flat|none posts=None
     a raised slab with a row of posts, balustrade between them, optional roof and centre steps (wall at y=depth).
 flat-canopy: width=12 depth=5 height=3.9 thickness=0.4 colour=None
     a flat canopy slab on columns projecting towards -y.
 neon-strip: length=10 height=3.0 colour='#ff5fd0' thickness=0.07
     a thin glowing strip (bright box).
 sign-pole: height=5.0 width=1.5 colour=None
     a pole sign with a blank board.
 roof-sign: width=6 height=2 colour=None
     a blank board on a frame standing on a roof.
 queue-posts: count=5 spacing=1.6 rope_colour='#8a1f2a' post_colour='#c9a85a'
     stanchion posts with rope and a red carpet strip.
 external-stair: height=3.9 length=8 width=1.1 colour=None
     an external concrete staircase rising towards +y with a landing.
 roof-terrace: width=10 depth=8 tables=3 pergola=True glass=True bar=True
     a rooftop lounge: deck, balustrade, pergola, bar, tables, parasols, planters, lights.
 pergola: width=6 depth=4 height=2.5 colour='#8a6a45'
     timber posts with cross beams.

ENTRANCES, TOWERS AND ROOFS
 drum-entrance: radius=7 height=7 cap_colour=None glass_colour='#dfe9ef' canopy=True
     a glazed cylinder with a disc cap, mullions and a canopy ring.
 glass-gable-entrance: width=18 depth=10 height=6.9 rise=4.5 glass_colour='#dfe9ef'
     a glazed gable-ended hall projecting towards -y.
 clock-tower: width=5 height=15 cap=hip cap_rise=5 clock=True
     a square tower with arched openings, a hipped cap and blank clock faces.
 vault-range: length=40 span=9 rise=3.0 count=1 height=6 lantern_domes=True wall=True
     parallel barrel vaults on low walls with lantern domes (souk / bazaar roof).
 iron-glass-roof: width=60 depth=40 bays=4 wall_height=8 rise_ratio=0.28 glass_colour='#a9c0cb'
     a ridge-and-furrow glass roof on arched walls (Victorian market hall).
 thatched-pavilion: width=12 depth=9 deck_height=0.7 post_height=3.0 roof=pyramid|hip thatch=True rail=True bar=True
     an open timber pavilion on a deck under a thatch or tile roof.
 teahouse-roof: width=14 depth=10 wall_height=3.3 base_z=0.0
     a double-eaved East-Asian hip roof with a plastered upper band and upturned tips.
 jetty: length=12 width=2.2 height=0.7
     a timber pier on posts (extends towards -y).
 prayer-hall: width=9 depth=7 height=3.6 minaret_height=11
     a small domed prayer hall with one minaret.

SMALL ARCHITECTURAL PIECES
 dormer: width=1.4 depth=1.2 height=1.5 colour=None            a box dormer with a small gable roof (on a pitched roof, base at z=0)
 bay-window: width=3.0 depth=0.9 height=6.0 storeys=2 colour=None   a projecting canted bay of windows over `storeys` floors
 stepped-gable: width=5.0 height=3.0 steps=4 thickness=0.5 colour=None   a stepped (crow-step) gable parapet standing on a wall top
 chimney-stack: width=1.0 height=2.2 pots=2 colour='#9b5a43'    a brick chimney stack with pots
 pediment: width=8.0 rise=1.1 depth=0.6 colour=None             a triangular pediment on a cornice slab
 balcony: width=4.0 depth=1.2 railing_colour='#2b2b2b'          a slab with a bar railing (front towards -y, wall at y=depth)
 railing: length=6.0 height=1.0 colour='#9ea3a8' glass=False     a balustrade run along x
 steps: width=3.0 rise=0.8 run=2.0 count=4 colour='#b7b2a8'     a flight of steps rising towards +y
 umbrella: radius=1.6 height=2.4 colour=None                    one market umbrella / parasol
 string-lights: length=8 height=2.8 count=10 colour='#ffe9a8'   a zigzag of bright bulbs
 hedge: length=6 height=0.8 depth=0.9 colour='#4f7d3b'          a row of clipped hedge blobs
 lamp-post: height=6.5                                           a street lamp
 flagpole: height=9 colour='#b6323a'                             a pole with a blank flag
 platform-canopy: width=18 depth=8 height=3.2 deck_height=0.55   a raised timber platform under a corrugated lean-to roof
 basilica-hall: width=60 depth=40 wall_height=5.0 nave_ratio=0.54 roof=gable|barrel|flat|shed|sawtooth|hip shop_front=True gates=True
     a covered market hall: aisle lean-tos, clerestory glazing, taller nave under a gable / vault / flat / sawtooth / mono-pitch roof,
     shop-front aisle wall facing -y, gabled end walls with a big gate and blank sign.

SITE PIECES
 car-park: width=30 depth=12 density=1.0
     asphalt parking with bays and parked cars.
 parked-car: yaw=0 colour=None   /   motorbike: colour=None
 truck: length=6 width=2.3 height=2.3 colour=None
 silo: radius=2.4 height=9.5 colour='#b9bec3'
 chimney: height=22 radius=1.0 material=brick colour=None
 water-tank: radius=1.1 height=1.7 legs=1.2 colour='#2f4f6f'
 statue-on-plinth: height=2.4 colour='#5a5148' plinth=0.9
 fountain: radius=3.8 jet=True
 tree: kind=broadleaf|palm|acacia|conifer height=7
"""
import copy
import math
import os
import random
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(os.path.dirname(_HERE), 'archetypes'))
from _xform import Xform  # noqa: E402

import _market_open_util as U  # noqa: E402

import lib  # noqa: E402

PARTS = {}
PART_PARAMS = {}
LOOK_KEYS = ('wall_colour', 'wall_material', 'roof_colour', 'roof_material', 'trim_colour', 'accent_colour')


def _maps():
    m = sys.modules.get('lib.facade')
    return m.WALL_SLOT, m.ROOF_SLOT


def _look(look, kw):
    lk = copy.copy(look)
    ws, rs = _maps()
    if kw.get('wall_colour'):
        lk.wall_col = kw['wall_colour']
    if kw.get('wall_material'):
        lk.wall_material = kw['wall_material']
        lk.wall_slot = ws.get(kw['wall_material'], 'plain-render')
    if kw.get('roof_colour'):
        lk.roof_col = kw['roof_colour']
    if kw.get('roof_material'):
        lk.roof_slot = rs.get(kw['roof_material'], 'metal-roof')
    if kw.get('trim_colour'):
        lk.trim_col = kw['trim_colour']
        lk.frame_col = lib.shade(lk.trim_col, 0.8)
    if kw.get('accent_colour'):
        lk.accent_col = kw['accent_colour']
    return lk


def part(name):
    """Register a raw part `raw(b, F, lk, s, **params)` (b: placed builder proxy, F: identity Frame, lk: look, s: random.Random)."""
    def deco(raw):
        import inspect
        sig = inspect.signature(raw)
        names = [p for p in sig.parameters if p not in ('b', 'F', 'lk', 's')]

        def fn(b, look, rng, detail, at=(0.0, 0.0, 0.0), rot=0.0, **params):
            bad = [k for k in params if k not in names and k not in LOOK_KEYS]
            if bad:
                raise ValueError(f'part {name}: unknown params {bad}; known: {names + list(LOOK_KEYS)}')
            lk = _look(look, params)
            args = {k: v for k, v in params.items() if k in names}
            s = random.Random(rng.getrandbits(64))
            bb = Xform.make(b, at, rot)
            return raw(bb, U.Frame(0, 0, 0), lk, s, **args)
        fn.__name__ = name
        fn.__doc__ = raw.__doc__
        PARTS[name] = fn
        PART_PARAMS[name] = {p: sig.parameters[p].default for p in names}
        return raw
    return deco


def _cols(v, default):
    return list(v) if v else list(default)


GOODS = ['#d9a441', '#c4452f', '#4f8a3a', '#e07a30', '#8a5fa0', '#e8e1cf', '#9a6a3a']


# ------------------------------------------------------------------------------------------------------------------ market pieces
@part('lock-up-row')
def lock_up_row(b, F, lk, s, length=24.0, depth=3.3, height=3.2, roof='shed', unit_width=2.5, veranda=1.2, shutter_colours=None, open_ratio=0.18,
                arch=False, relief=False, awning_colours=None, goods_colours=None, posts=True, rise=None):
    shut = _cols(shutter_colours, ['#3f7fa6', '#4f8a5b', '#b5483a'])
    U.lockup_block(b, F, length, depth, height, lk, s, roof=roof, vd=veranda, unit_w=unit_width, wall_slot=lk.wall_slot, wall_col=lk.wall_col, roof_slot=lk.roof_slot if lk.roof_slot != 'metal-roof' else 'corrugated',
                   roof_col=lk.roof_col, shut_cols=shut, open_p=open_ratio, arch=arch, fascia_col=lib.shade(lk.wall_col, 0.9), rise=rise, posts=posts,
                   goods=_cols(goods_colours, GOODS), relief=relief, awn=list(awning_colours) if awning_colours else None)


@part('stall-row')
def stall_row(b, F, lk, s, count=8, pitch=3.0, kind='umbrella', size=1.0, colours=None, goods_colours=None, jitter=0.3):
    cols = _cols(colours, U.UMB)
    goods = _cols(goods_colours, GOODS)
    for k in range(int(count)):
        x = (k - (count - 1) / 2) * pitch + s.uniform(-jitter, jitter)
        y = s.uniform(-jitter, jitter)
        kk = kind if kind != 'mixed' else s.choice(['umbrella', 'tarp'])
        if kk == 'tarp':
            U.tarp_stall(b, F, x, y, s, cols, goods)
        else:
            U.umbrella_stall(b, F, x, y, s, cols, goods, size)


@part('umbrella-cluster')
def umbrella_cluster(b, F, lk, s, count=6, spread=4.0, radius=1.5, height=2.4, colours=None, tables=True):
    cols = _cols(colours, U.UMB)
    for k in range(int(count)):
        a = s.uniform(0, 2 * math.pi)
        r = spread * math.sqrt(s.random())
        x, y = math.cos(a) * r, math.sin(a) * r
        if tables and b.detail == 0:
            U.table(b, F, x, y + 0.2, 1.6, 0.9, 0.82, '#8a6a45')
        U.umbrella(b, x, y, radius, height, s.choice(cols))


@part('market-shed')
def market_shed(b, F, lk, s, length=24.0, depth=8.0, height=3.8, roof='gable', roof_rise=None, post_pitch=5.0, cladding=None, goods='sacks'):
    gk = goods if goods in ('timber', 'yam') else 'sacks'
    gcols = ['#a9825a'] if gk == 'timber' else ['#d6c9a6', '#c9b98a', '#b8a77a']
    U.shed_over_goods(b, F, length, depth, height, lk, s, roof=roof, roof_col=lk.roof_col, post_pitch=post_pitch, wall_col=lk.wall_col, rise=roof_rise, clad=cladding,
                      goods=gcols, goods_kind=gk, stacks=goods != 'none')


@part('awning')
def awning(b, F, lk, s, width=3.0, depth=1.4, drop=0.5, height=2.7, colours=None, stripe=0.75, valance=0.22, posts=True):
    sg = F.seg(-width / 2, 0, width / 2, 0)
    U.awning_seg(b, sg, 0.0, width, height, depth, drop, _cols(colours, [U.UMB[0], '#f1ece0']), stripe, valance)
    if posts and b.detail == 0:
        for x in (-width / 2 + 0.1, width / 2 - 0.1):
            lib.cylinder(b, x, -depth + 0.1, 0, height - drop - 0.1, 0.04, n=4, slot='frame', col='#7d8286', top=False, smooth=False)


@part('shopfront')
def shopfront(b, F, lk, s, width=3.4, height=3.6, kind='shutter', colour=None, sign_colour=None, sign_height=0.9, awning_colours=None, depth=0.0):
    seg = F.seg(-width / 2, 0, width / 2, 0)
    if depth > 0:
        F.box(b, -width / 2, 0, 0, width / 2, depth, height, lk.wall_slot, lk.wall_col, 'roof-flat', lk.roof_col, skip=('bottom', 'front'))
    if b.detail >= 2:
        b.face([seg.P(0, 0), seg.P(width, 0), seg.P(width, height), seg.P(0, height)], lk.wall_slot, lk.wall_col)
        return
    b.face([seg.P(0, 0), seg.P(width, 0), seg.P(width, height), seg.P(0, height)], lk.wall_slot, lib.shade(lk.wall_col, 0.92), mode='fit')
    U.shopfront(b, seg, 0, width, 0, height, lk, s, kind, colour or lk.accent_col, sign_colour, list(awning_colours) if awning_colours else None, lk.wall_slot, lk.wall_col, sign_h=sign_height)


@part('kiosk')
def kiosk(b, F, lk, s, kind='container', width=3.2, depth=2.2, height=2.6, colour=None):
    c = colour or s.choice(U.UMB)
    if kind == 'container':
        U.container_kiosk(b, F, 0, depth / 2, width, depth, c)
        return
    F.box(b, -width / 2, 0, 0, width / 2, depth, height, 'plain-render', c, skip=('bottom', 'top'))
    F.roof(b, 'shed', -width / 2, 0, width / 2, depth, height, 0.35, 0.2, 'corrugated', lk.roof_col, 'plain-render', c, ov_front=0.5)
    if b.detail == 0:
        F.face(b, [(-width * 0.35, -0.02, 0.9), (width * 0.35, -0.02, 0.9), (width * 0.35, -0.02, 1.9), (-width * 0.35, -0.02, 1.9)], (0, -1, 0), 'glass-punched', '#46403a', mode='fit')
        F.box(b, -width * 0.4, -0.4, 0.88, width * 0.4, 0, 0.95, 'timber', '#8a6a45')


@part('table-set')
def table_set(b, F, lk, s, chairs=4, table_colour='#f2f2ee', chair_colour=None, umbrella=False, radius=0.42):
    if umbrella:
        U.umbrella(b, 0, 0, 1.7, 2.5, s.choice(U.UMB))
    U.dining_set(b, 0, 0, s, table_colour, [chair_colour or s.choice(U.CHAIRS)], chairs=int(chairs), r=radius)


@part('bunting')
def bunting(b, F, lk, s, length=8.0, height=2.8, colours=None):
    if b.detail >= 1:
        return
    cols = _cols(colours, U.UMB)
    n = max(4, int(length / 0.6))
    for k in range(n):
        t = (k + 0.5) / n
        x = -length / 2 + length * t
        z = height - 0.35 * math.sin(math.pi * t)
        c = cols[k % len(cols)]
        pts = [(x - 0.17, 0, z), (x + 0.17, 0, z), (x, 0, z - 0.45)]
        b.face(pts, 'plain', c)
        b.face(pts[::-1], 'plain', lib.shade(c, 0.85))


@part('dye-pit-field')
def dye_pit_field(b, F, lk, s, rows=3, cols=6, spacing_x=4.5, spacing_y=4.0, radius=1.0, rim=0.45, cloth_lines=2, colours=None):
    indigo = _cols(colours, ['#2f3f6b', '#26365e', '#3a4a7a', '#1f2c52'])
    det = b.detail
    for i in range(int(cols)):
        for j in range(int(rows)):
            x = (i - (cols - 1) / 2) * spacing_x + (0.0 if j % 2 == 0 else spacing_x * 0.2)
            y = j * spacing_y + 2.0
            r = radius * s.uniform(0.85, 1.1)
            n = 12 if det == 0 else 7
            if det >= 2:
                continue
            lib.cylinder(b, x, y, 0, 0.35, r + rim, n=n, slot='mud-render', col=lib.jitter(lk.wall_col, s, 0.08), top=False, smooth=True)
            b.facing([(x + (r + rim) * math.cos(2 * math.pi * k / n), y + (r + rim) * math.sin(2 * math.pi * k / n), 0.35) for k in range(n)], (0, 0, 1), 'mud-render', lib.shade(lk.wall_col, 0.9))
            b.facing([(x + r * math.cos(2 * math.pi * k / n), y + r * math.sin(2 * math.pi * k / n), 0.37) for k in range(n)], (0, 0, 1), 'plain', s.choice(indigo))
    if det < 2:
        span = (cols - 1) * spacing_x + 4
        for k in range(int(cloth_lines)):
            y = -2.0 - k * 3.0
            for sx in (-span / 2, span / 2):
                lib.cylinder(b, sx, y, 0, 3.2, 0.07, n=4, slot='timber', col='#6f5238', top=False, smooth=False)
            m = int(span / 3.4)
            for q in range(m):
                xa = -span / 2 + 1 + q * (span - 2) / max(1, m)
                col = s.choice(indigo + ['#3a5a9a', '#e8e1cf'])
                zl = s.uniform(1.0, 1.8)
                pts = [(xa, y, 3.0), (xa + 2.2, y, 3.0), (xa + 2.2, y, zl), (xa, y, zl)]
                b.facing(pts, (0, -1, 0), 'plain', col)
                b.facing(pts[::-1], (0, 1, 0), 'plain', lib.shade(col, 0.8))


def _cow(b, x, y, yaw, col, scale=1.0):
    if b.detail >= 2:
        return
    sc = scale
    c, sn = math.cos(yaw), math.sin(yaw)
    lib.obox(b, x, y, 0.55 * sc, 1.9 * sc, 0.7 * sc, 0.75 * sc, yaw, 'plain', col, skip=('bottom',))
    if b.detail == 0:
        lib.obox(b, x + c * 1.15 * sc, y + sn * 1.15 * sc, 0.9 * sc, 0.6 * sc, 0.38 * sc, 0.38 * sc, yaw, 'plain', lib.shade(col, 0.9), skip=('bottom',))
        for dx in (-0.7, 0.7):
            for dy in (-0.22, 0.22):
                px, py = x + (c * dx - sn * dy) * sc, y + (sn * dx + c * dy) * sc
                lib.cylinder(b, px, py, 0, 0.58 * sc, 0.07 * sc, n=4, slot='plain', col=lib.shade(col, 0.7), top=False, smooth=False)
        lib.obox(b, x + c * 0.75 * sc, y + sn * 0.75 * sc, 1.25 * sc, 0.35 * sc, 0.4 * sc, 0.22 * sc, yaw, 'plain', lib.shade(col, 0.85), skip=('bottom',))


@part('cow')
def cow(b, F, lk, s, scale=1.0, colour=None):
    _cow(b, 0, 0, 0.0, colour or s.choice(['#e8e1cf', '#8a5a3a', '#2f2a26', '#b8a07a', '#d9d0bc']), scale)


@part('pen')
def pen(b, F, lk, s, width=14.0, depth=12.0, animals=3, kind='cattle'):
    det = b.detail
    if det < 2:
        pts = [(-width / 2, 0), (width / 2, 0), (width / 2, depth), (-width / 2, depth), (-width / 2, 0)]
        for p0, p1 in zip(pts[:-1], pts[1:]):
            L = math.dist(p0, p1)
            zs = ((0.5, 0.68), (1.05, 1.23)) if det == 0 else ((0.45, 1.25),)
            for (za, zb) in zs:
                q = [(p0[0], p0[1], za), (p1[0], p1[1], za), (p1[0], p1[1], zb), (p0[0], p0[1], zb)]
                b.face(q, 'timber', '#8a6a45', mode='fit')
                b.face(q[::-1], 'timber', '#7a5c3c', mode='fit')
            if det == 0:
                n = int(L / 4.0) + 1
                for k in range(n):
                    t = k / n
                    lib.cylinder(b, p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, 0, 1.4, 0.08, n=3, slot='timber', col='#6f5238', top=False, smooth=False)
    sc = 1.0 if kind == 'cattle' else 0.55
    for k in range(int(animals) if det < 2 else 0):
        _cow(b, s.uniform(-width / 2 + 2, width / 2 - 2), s.uniform(2, depth - 2), s.uniform(0, 2 * math.pi), s.choice(['#e8e1cf', '#8a5a3a', '#2f2a26', '#b8a07a']), sc * s.uniform(0.9, 1.15))


# ------------------------------------------------------------------------------------------------------------------ blocks, facades
@part('shop-block')
def shop_block(b, F, lk, s, width=30.0, depth=12.0, storeys=3, floor_height=3.4, ground_height=4.2, windows='punched', window_ratio=0.3, gallery=False,
               arcade=False, roof='flat', parapet=1.0, shop_kind='mixed', awning_ratio=0.3, entrance=True, rooftop=True):
    S = int(max(1, storeys))
    gh, fh = ground_height, floor_height
    H = gh + fh * (S - 1)
    acc = U.accent_cols({'facade': {'colours': [lk.accent_col, lk.trim_col]}}, {}, s)
    pal = [lk.wall_col, lk.accent_col, lk.trim_col]
    x0, x1, y0, y1 = -width / 2, width / 2, 0.0, depth
    front = F.seg(x0, y0, x1, y0)
    U.shop_facade(b, front, 0, S, gh, fh, lk, s, kind=shop_kind, cols=pal, accents=acc, unit_w=3.4, wall_slot=lk.wall_slot, wall_col=lk.wall_col, windows=windows,
                  ratio=window_ratio, gallery=gallery, awn_p=awning_ratio, arcade=arcade, bay=3.2, signs=True)
    for sg in (F.seg(x1, y0, x1, y1), F.seg(x1, y1, x0, y1), F.seg(x0, y1, x0, y0)):
        lib.facade(b, sg, 0, H, S, lk, windows if windows != 'curtain' else 'ribbon', window_ratio, s, 3.4, reduced=True, wall_slot=lk.wall_slot, wall_col=lk.wall_col)
    if roof == 'flat':
        F.roof(b, 'flat', x0, y0, x1, y1, H, 0, 0.1, 'roof-flat', lk.roof_col, lk.wall_slot, lk.wall_col, parapet=parapet, par_col=lib.shade(lk.wall_col, 1.06))
        if rooftop:
            U.roof_extras(b, F, x0 + 1.5, y0 + 1.5, x1 - 1.5, y1 - 1.5, H, s, lk, cores=1 if width * depth < 1500 else 2, tanks=2, plant=2, rebar=False)
    else:
        F.roof(b, roof, x0, y0, x1, y1, H, depth / 2 * 0.3, 0.8, lk.roof_slot, lk.roof_col, lk.wall_slot, lk.wall_col, ov_front=0.8, th=0.1)
    if entrance and width > 14:
        U.entrance_bay(b, front, width * 0.5, min(12.0, width * 0.3), 0, H, 1.6, lk, s, col=lib.shade(lk.wall_col, 1.08), sign_col=lib.shade(acc[0], 0.8), arch=windows in ('punched', 'arched'))


@part('terrace-row')
def terrace_row(b, F, lk, s, length=40.0, depth=10.0, storeys=3, kind='euro', roof='gable', ground_height=None, floor_height=3.2, awning_ratio=0.5, balcony=False, chimneys=True):
    pal = [lk.wall_col, lk.accent_col, lk.trim_col, lib.shade(lk.wall_col, 0.9)]
    acc = U.accent_cols({'facade': {'colours': [lk.accent_col, lk.trim_col]}}, {}, s)
    U.terrace_row(b, F.sub(0, 0), length, depth, int(storeys), lk, s, kind, pal, acc, gh=ground_height, fh=floor_height, roof=roof, awn_p=awning_ratio, balcony=balcony,
                  chimneys=chimneys, windows='punched')


@part('gate')
def gate(b, F, lk, s, width=6.0, height=3.4, colour=None, board_colour=None, arch=False):
    U.gate(b, F, 0.0, width, height, lk, col=colour or lk.trim_col, board=board_colour or lk.accent_col, arch=arch)


@part('crenellated-wall')
def crenellated_wall(b, F, lk, s, length=20.0, height=2.0, thickness=0.45, crenel=True, pitch=1.4, colour=None, material=None):
    ws, _ = _maps()
    slot = ws.get(material, lk.wall_slot) if material else lk.wall_slot
    col = colour or lk.wall_col
    U.fence_wall(b, [F.xy(-length / 2, 0), F.xy(length / 2, 0)], height, thickness, lk, col, slot, crenel=crenel)


@part('colonnade')
def colonnade(b, F, lk, s, count=6, spacing=3.0, height=3.6, radius=0.25, kind='round', beam=0.5):
    n = int(max(2, count))
    L = (n - 1) * spacing
    lib.colonnade(b, (-L / 2, 0), (L / 2, 0), 0, height, n, lk, r=radius, kind=kind, beam_h=beam, slot=lk.wall_slot, col=lk.trim_col)


@part('veranda')
def veranda(b, F, lk, s, length=14.0, depth=2.6, height=3.0, balustrade=True, steps=True, roof='lean-to', posts=None):
    det = b.detail
    wc, ws = lk.wall_col, lk.wall_slot
    x0, x1 = -length / 2, length / 2
    if det >= 2:
        F.box(b, x0, 0, 0, x1, depth, 0.35, 'paving', '#bdb8ae', skip=('bottom',))
        if roof != 'none':
            F.box(b, x0, 0, height, x1, depth, height + 0.3, ws, wc, skip=('bottom',))
        return
    F.box(b, x0 - 0.3, 0, 0, x1 + 0.3, depth, 0.35, 'paving', '#bdb8ae', 'paving', '#c9c4b8', skip=('bottom',))
    npost = posts if posts else int(length / 3.0) + 1
    for k in range(npost):
        px = x0 + length * k / max(1, npost - 1)
        F.box(b, px - 0.12, 0.2, 0.35, px + 0.12, 0.44, height, 'plain-render', lib.shade(wc, 1.08), skip=('bottom', 'top'))
    if roof == 'lean-to':
        F.roof(b, 'shed', x0 - 0.3, -0.3, x1 + 0.3, depth, height, 0.5, 0.2, lk.roof_slot, lk.roof_col, ws, wc, high='back', ov_front=0.4, infill=False)
    elif roof == 'flat':
        F.box(b, x0 - 0.3, -0.2, height, x1 + 0.3, depth, height + 0.25, ws, wc, 'roof-flat', lk.roof_col, skip=('bottom',))
    if balustrade and det == 0:
        for k in range(npost - 1):
            if steps and k == (npost - 1) // 2:
                continue
            px0 = x0 + length * k / max(1, npost - 1) + 0.12
            px1 = x0 + length * (k + 1) / max(1, npost - 1) - 0.12
            F.box(b, px0, 0.25, 0.35, px1, 0.35, 0.95, 'plain-render', lib.shade(wc, 1.05), 'plain-render', lib.shade(wc, 1.15), skip=('bottom',))
    if steps:
        F.box(b, -1.4, -0.5, 0, 1.4, 0.1, 0.17, 'paving', '#b7b2a8', 'paving', '#c4bfb3')
        F.box(b, -1.4, -0.2, 0, 1.4, 0.1, 0.35, 'paving', '#b7b2a8', 'paving', '#c4bfb3')


@part('flat-canopy')
def flat_canopy(b, F, lk, s, width=12.0, depth=5.0, height=3.9, thickness=0.4, colour=None):
    U.flat_canopy_at(b, F, 0, 0, width, depth, height, lk, colour)


@part('neon-strip')
def neon_strip(b, F, lk, s, length=10.0, height=3.0, colour='#ff5fd0', thickness=0.07):
    U.neon(b, F.xy(-length / 2, 0), F.xy(length / 2, 0), height, colour, th=thickness, w=thickness)


@part('sign-pole')
def sign_pole(b, F, lk, s, height=5.0, width=1.5, colour=None):
    U.sign_pole(b, F, 0, 0, height, width, colour or lk.accent_col)


@part('roof-sign')
def roof_sign(b, F, lk, s, width=6.0, height=2.0, colour=None):
    if b.detail >= 2:
        return
    F.box(b, -width / 2, 0, 0.8, width / 2, 0.25, 0.8 + height, 'plain', colour or lk.accent_col, skip=('bottom',))
    if b.detail == 0:
        for sx in (-width * 0.4, width * 0.4):
            F.box(b, sx - 0.1, 0, 0, sx + 0.1, 0.25, 0.8, 'frame', '#7d8286', skip=('bottom',))


@part('queue-posts')
def queue_posts(b, F, lk, s, count=5, spacing=1.6, rope_colour='#8a1f2a', post_colour='#c9a85a'):
    if b.detail >= 1:
        return
    F.box(b, -1.1, -spacing * count - 0.5, 0.0, 1.1, 0, 0.03, 'plain', '#8a1f2a')
    for k in range(int(count)):
        for sx in (-1.5, 1.5):
            lib.cylinder(b, sx, -1.0 - k * spacing, 0, 0.95, 0.04, n=4, slot='frame', col=post_colour, top=True, smooth=False)
    for sx in (-1.5, 1.5):
        U.neon(b, (sx, -1.0), (sx, -1.0 - (count - 1) * spacing), 0.85, rope_colour, th=0.04, w=0.04)


@part('external-stair')
def external_stair(b, F, lk, s, height=3.9, length=8.0, width=1.1, colour=None):
    U.external_stair(b, F, 0, 0, length, height, s, colour or lib.shade(lk.wall_col, 0.92))


@part('roof-terrace')
def roof_terrace(b, F, lk, s, width=10.0, depth=8.0, tables=3, pergola=True, glass=True, bar=True):
    acc = U.accent_cols({'facade': {'colours': [lk.accent_col, lk.trim_col]}}, {}, s)
    U.roof_lounge(b, F, -width / 2, 0, width / 2, depth, 0.0, s, lk, acc, tables_n=int(tables), pergola_=pergola, glass_rail=glass, bar=bar)


@part('pergola')
def pergola(b, F, lk, s, width=6.0, depth=4.0, height=2.5, colour='#8a6a45'):
    U.pergola(b, F, -width / 2, 0, width / 2, depth, 0.0, height, colour)


# ------------------------------------------------------------------------------------------------------------------ entrances, roofs
@part('drum-entrance')
def drum_entrance(b, F, lk, s, radius=7.0, height=7.0, cap_colour=None, glass_colour='#dfe9ef', canopy=True):
    n = 18 if b.detail == 0 else 10
    cap = cap_colour or lib.shade(lk.accent_col, 0.9)
    cy = radius
    lib.cylinder(b, 0, cy, 0, height, radius, n=n, slot='glass-curtain', col=glass_colour, top=False, smooth=False)
    if b.detail < 2:
        lib.cylinder(b, 0, cy, height, height + 0.8, radius + 0.5, n=n, slot='plain-render', col=cap, r_top=radius + 0.3, top=True, smooth=False)
        if b.detail == 0:
            for k in range(0, n, 2):
                a = 2 * math.pi * k / n
                lib.cylinder(b, math.cos(a) * (radius + 0.05), cy + math.sin(a) * (radius + 0.05), 0, height, 0.1, n=3, slot='frame', col=lk.frame_col, top=False, smooth=False)
            if canopy:
                lib.cylinder(b, 0, cy, 4.6, 4.9, radius + 2.2, n=n, slot='plain-render', col=lib.shade(cap, 0.9), r_top=radius + 2.2, top=True, smooth=False)


@part('glass-gable-entrance')
def glass_gable_entrance(b, F, lk, s, width=18.0, depth=10.0, height=6.9, rise=4.5, glass_colour='#dfe9ef'):
    x0, x1 = -width / 2, width / 2
    h = height
    ym = 0.0
    yb = depth
    b.facing([(x0, ym, 0), (x1, ym, 0), (x1, ym, h), (0, ym, h + rise), (x0, ym, h)], (0, -1, 0), 'glass-curtain', glass_colour, mode='fit')
    for xa, hint in ((x0, (-0.4, 0, 1)), (x1, (0.4, 0, 1))):
        b.facing([(xa, ym, h), (0, ym, h + rise), (0, yb, h + rise), (xa, yb, h)], hint, 'glass-curtain', glass_colour, mode='fit')
    for sx, hint in ((x0, (-1, 0, 0)), (x1, (1, 0, 0))):
        b.facing([(sx, ym, 0), (sx, yb, 0), (sx, yb, h), (sx, ym, h)], hint, 'glass-curtain', glass_colour, mode='fit')
    if b.detail == 0:
        for k in range(5):
            x = x0 + width * k / 4
            lib.box_c(b, x, ym - 0.06, 0, 0.18, 0.14, h + rise * (1 - abs(2 * k / 4 - 1)), 'frame', lk.frame_col)
        lib.beam(b, (x0, ym - 0.05), (x1, ym - 0.05), h - 0.2, h + 0.05, 0.22, 'plain', lk.roof_col)


@part('clock-tower')
def clock_tower(b, F, lk, s, width=5.0, height=15.0, cap='hip', cap_rise=5.0, clock=True):
    lib.tower(b, 0, width / 2, 0, width, width, height, lk, windows='arched', cap=cap, cap_rise=cap_rise, ratio=0.3, wall_slot=lk.wall_slot, wall_col=lib.shade(lk.wall_col, 1.06))
    if clock and b.detail == 0:
        zc = height - 2.8
        for sgn in (-1, 1):
            yy = width / 2 + sgn * (width / 2 + 0.05)
            b.facing([(-1.1, yy, zc), (1.1, yy, zc), (1.1, yy, zc + 2.2), (-1.1, yy, zc + 2.2)], (0, sgn, 0), 'plain', '#f1ede0')


@part('vault-range')
def vault_range(b, F, lk, s, length=40.0, span=9.0, rise=3.0, count=1, height=6.0, lantern_domes=True, wall=True):
    rs = lk.roof_slot if lk.roof_slot != 'corrugated' else 'plain-render'
    n = int(max(1, count))
    for i in range(n):
        y0 = i * span
        rect = (-length / 2, y0, length / 2, y0 + span)
        lib.barrel(b, rect, height, rise, lk, axis='x', ov=0.0, slot=rs, col=lib.jitter(lk.roof_col, s, 0.05), end_slot=lk.wall_slot, end_col=lk.wall_col)
        if lantern_domes and b.detail < 2:
            k = int(length / 15.0)
            for q in range(k):
                cx = -length / 2 + length * (q + 0.5) / k
                lib.dome(b, cx, y0 + span / 2, height + rise - 0.6, 1.7, lk, profile='hemi', slot=rs, col=lib.shade(lk.roof_col, 1.08), drum=0.9 if b.detail == 0 else 0.0, drum_col=lib.shade(lk.wall_col, 1.05))


@part('iron-glass-roof')
def iron_glass_roof(b, F, lk, s, width=60.0, depth=40.0, bays=4, wall_height=8.0, rise_ratio=0.28, glass_colour='#a9c0cb'):
    nb = int(max(1, bays))
    bw = width / nb
    for i in range(nb):
        xa, xb = -width / 2 + i * bw, -width / 2 + (i + 1) * bw
        rise = bw * rise_ratio
        F.roof(b, 'gable', xa, 0, xb, depth, wall_height, rise, 0.0 if 0 < i < nb - 1 else 0.4, 'glass-ribbon', glass_colour, lk.wall_slot, lk.wall_col, ridge='y', ov_front=0.4, th=0.0, infill=False)
        if b.detail == 0:
            lib.beam(b, (xa + bw / 2, 0), (xa + bw / 2, depth), wall_height + rise, wall_height + rise + 0.18, 0.2, 'plain', '#4a4f54', skip=('bottom',))
        F.face(b, [(xa, depth, wall_height), (xb, depth, wall_height), ((xa + xb) / 2, depth, wall_height + rise)], (0, 1, 0), lk.wall_slot, lib.shade(lk.wall_col, 0.97))
        F.face(b, [(xb, 0, wall_height), (xa, 0, wall_height), ((xa + xb) / 2, 0, wall_height + rise)], (0, -1, 0), lk.wall_slot, lib.shade(lk.wall_col, 0.97))
    walls_fp = lib.fp_rect(width, depth, 0, depth / 2)
    wl = copy.copy(lk)
    for sg in walls_fp.edges():
        lib.facade(b, sg, 0, wall_height, 1, wl, 'arched', 0.55, s, U.bay(5.2), reduced=(sg.rear), wall_slot=lk.wall_slot, wall_col=lk.wall_col)


@part('thatched-pavilion')
def thatched_pavilion(b, F, lk, s, width=12.0, depth=9.0, deck_height=0.7, post_height=3.0, roof='pyramid', thatch=True, rail=True, bar=True):
    dz = deck_height
    F.box(b, -width / 2 - 1.0, -1.5, dz - 0.15, width / 2 + 1.0, depth + 1.0, dz, 'timber', '#7a5a3a', 'timber', '#a58559', skip=('bottom',))
    if b.detail == 0:
        for k in range(int(width / 2.5) + 1):
            px = -width / 2 - 0.8 + (width + 1.6) * k / max(1, int(width / 2.5))
            for py in (-1.3, depth + 0.8):
                F.cyl(b, px, py, 0, dz - 0.15, 0.1, n=4, slot='timber', col='#6f5238', top=False, smooth=False)
    pw, pd = width * 0.8, depth * 0.8
    cx, cy = 0.0, depth / 2
    if b.detail < 2:
        for sx in (-1, 1):
            for sy in (-1, 1):
                F.box(b, cx + sx * pw / 2 - 0.12, cy + sy * pd / 2 - 0.12, dz, cx + sx * pw / 2 + 0.12, cy + sy * pd / 2 + 0.12, dz + post_height, 'timber', '#6f5238', skip=('bottom', 'top'))
    rc = '#b8a064' if thatch else lk.roof_col
    rslot = 'timber' if thatch else lk.roof_slot
    form = 'pyramidal' if roof == 'pyramid' else 'hip'
    F.roof(b, form, cx - pw / 2 - 0.4, cy - pd / 2 - 0.4, cx + pw / 2 + 0.4, cy + pd / 2 + 0.4, dz + post_height, max(2.0, min(pw, pd) * 0.42), 1.4, rslot, rc, 'timber', '#6f5238', ov_front=1.4, th=0.15)
    if bar and b.detail < 2:
        F.box(b, cx - pw / 2 + 0.4, cy + pd / 2 - 1.4, dz, cx - pw / 2 + 0.4 + pw * 0.4, cy + pd / 2 - 0.5, dz + 1.1, 'timber', '#6f5238', 'timber', '#a58559', skip=('bottom',))
    if rail and b.detail == 0:
        U.railing_ring(b, F, cx - width / 2 - 0.8, -1.3, cx + width / 2 + 0.8, depth + 0.8, dz, 0.9, col='#6f5238')


@part('teahouse-roof')
def teahouse_roof(b, F, lk, s, width=14.0, depth=10.0, wall_height=3.3, base_z=0.0):
    tile = lk.roof_col
    plaster = '#efe9dc'
    zr = base_z + wall_height
    cx, cy = 0.0, depth / 2
    ts = 'clay-tile' if lk.roof_slot != 'slate' else 'slate'
    F.roof(b, 'hip', cx - width / 2 - 0.8, cy - depth / 2 - 0.9, cx + width / 2 + 0.8, cy + depth / 2 + 0.5, zr, 0.9, 0.6, ts, tile, 'plain-render', plaster, th=0.12, ov_front=0.6)
    ux0, ux1, uy0, uy1 = cx - width / 2 + 2.0, cx + width / 2 - 2.0, cy - depth / 2 + 1.6, cy + depth / 2 - 1.8
    zu = zr + 0.9
    F.box(b, ux0, uy0, zu - 0.25, ux1, uy1, zu + 1.5, 'plain-render', plaster, skip=('bottom', 'top'))
    F.roof(b, 'hip', ux0 - 0.7, uy0 - 0.7, ux1 + 0.7, uy1 + 0.7, zu + 1.5, min(ux1 - ux0, uy1 - uy0) * 0.3, 0.5, ts, lib.shade(tile, 1.05), 'plain-render', plaster, th=0.12, ov_front=0.7)
    if b.detail == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                q = F.xy(cx + sx * (width / 2 + 0.6), cy + sy * (depth / 2 - 0.2) + (-0.4 if sy < 0 else 0.0))
                lib.cylinder(b, q[0], q[1], zr - 0.05, zr + 0.45, 0.18, n=4, slot='plain', col=lib.shade(tile, 1.15), r_top=0.0, top=False, smooth=False)


@part('jetty')
def jetty(b, F, lk, s, length=12.0, width=2.2, height=0.7):
    F.box(b, -width / 2, -length, height - 0.15, width / 2, 0, height, 'timber', '#7a5a3a', 'timber', '#a58559', skip=('bottom',))
    if b.detail == 0:
        for k in range(int(length / 2.4) + 1):
            for sx in (-width / 2 + 0.1, width / 2 - 0.1):
                F.cyl(b, sx, -0.4 - k * 2.4, 0, height - 0.15, 0.09, n=4, slot='timber', col='#6f5238', top=False, smooth=False)


@part('prayer-hall')
def prayer_hall(b, F, lk, s, width=9.0, depth=7.0, height=3.6, minaret_height=11.0):
    U.mosque_small(b, F, 0, 0, s, lk, w=width, d=depth, h=height, minaret_h=minaret_height)


# ------------------------------------------------------------------------------------------------------------------ site pieces
@part('car-park')
def car_park(b, F, lk, s, width=30.0, depth=12.0, density=1.0):
    if b.detail >= 2:
        return
    q0 = F.xy(-width / 2, 0)
    q1 = F.xy(width / 2, depth)
    lib.forecourt(b, 'parking', min(q0[0], q1[0]), min(q0[1], q1[1]), max(q0[0], q1[0]), max(q0[1], q1[1]), lk, s, density=density)


@part('parked-car')
def parked_car(b, F, lk, s, yaw=0.0, colour=None):
    lib.car(b, 0, 0, math.radians(yaw), colour or s.choice(['#c9ccd0', '#2a2d33', '#8a1f1f', '#e6e6e6', '#27456e']))


@part('motorbike')
def motorbike(b, F, lk, s, colour=None):
    col = colour or s.choice(['#c9ccd0', '#2a2d33', '#8a1f1f', '#e6e6e6', '#27456e'])
    if b.detail >= 1:
        return
    with b.site():
        lib.obox(b, 0, 0, 0.28, 1.8, 0.35, 0.3, 0.0, 'plain', col, skip=('bottom',))
        lib.obox(b, 0, 0, 0.0, 1.7, 0.12, 0.3, 0.0, 'plain', '#1e1e20', skip=('bottom',))
        lib.obox(b, 0.5, 0, 0.58, 0.5, 0.5, 0.25, 0.0, 'plain', lib.shade(col, 0.8), skip=('bottom',))


@part('truck')
def truck(b, F, lk, s, length=6.0, width=2.3, height=2.3, colour=None):
    if b.detail >= 2:
        lib.obox(b, 0, 0, 0.5, length, width, height, 0.0, 'plain', colour or '#3f7fa6', skip=('bottom',))
        return
    col = colour or s.choice(['#3f7fa6', '#b5483a', '#d8d2c2', '#4f8a5b'])
    lib.obox(b, 0, 0, 0.5, length, width, height, 0.0, 'plain', col, skip=('bottom',))
    lib.obox(b, length / 2 + 0.7, 0, 0.5, 1.7, width - 0.1, height - 0.4, 0.0, 'plain', '#d8d4c8', skip=('bottom',))
    if b.detail == 0:
        lib.obox(b, 0, 0, 0.0, length - 0.6, width - 0.3, 0.5, 0.0, 'plain', '#1e1e20')


@part('silo')
def silo(b, F, lk, s, radius=2.4, height=9.5, colour='#b9bec3'):
    n = 12 if b.detail == 0 else 7
    lib.cylinder(b, 0, 0, 0, height, radius, n=n, slot='metal-cladding', col=colour, top=False, smooth=True)
    if b.detail < 2:
        lib.cylinder(b, 0, 0, height, height + radius * 0.7, radius, n=n, slot='metal-cladding', col=lib.shade(colour, 0.85), r_top=0.0, top=False, smooth=True)


@part('chimney')
def chimney(b, F, lk, s, height=22.0, radius=1.0, material='brick', colour=None):
    ws, _ = _maps()
    lib.cylinder(b, 0, 0, 0, height, radius, n=8 if b.detail == 0 else 5, slot=ws.get(material, 'brick'), col=colour or '#9b5a43', r_top=radius * 0.65, top=True)


@part('water-tank')
def water_tank(b, F, lk, s, radius=1.1, height=1.7, legs=1.2, colour='#2f4f6f'):
    if b.detail >= 2:
        lib.cylinder(b, 0, 0, legs, legs + height, radius, n=6, slot='plain', col=colour, top=True)
        return
    if b.detail == 0 and legs > 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.box_c(b, sx * radius * 0.7, sy * radius * 0.7, 0, 0.18, 0.18, legs, 'plain', '#7d8286')
    lib.cylinder(b, 0, 0, legs, legs + height, radius, n=10 if b.detail == 0 else 6, slot='plain', col=colour, r_top=radius * 0.95, top=True)


@part('statue-on-plinth')
def statue_on_plinth(b, F, lk, s, height=2.4, colour='#5a5148', plinth=0.9):
    if b.detail >= 2:
        return
    lib.box_c(b, 0, 0, 0, 1.4, 1.4, plinth, 'stone-blocks', '#bdb7ab')
    lib.cylinder(b, 0, 0, plinth, plinth + height * 0.55, 0.28, n=6, slot='plain', col=colour, r_top=0.2, top=True)
    lib.blob(b, 0, 0, plinth + height * 0.55 + 0.25, 0.2, 0.2, 0.25, colour, n=6, rings=3)
    if b.detail == 0:
        lib.beam(b, (-0.55, 0), (0.55, 0), plinth + height * 0.4, plinth + height * 0.4 + 0.1, 0.12, 'plain', colour)


@part('fountain')
def fountain(b, F, lk, s, radius=3.8, jet=True):
    if b.detail >= 2:
        return
    n = 14 if b.detail == 0 else 8
    lib.cylinder(b, 0, 0, 0, 0.55, radius, n=n, slot='stone-blocks', col='#c8c4ba', top=False, smooth=False)
    b.facing([(radius * math.cos(2 * math.pi * k / n), radius * math.sin(2 * math.pi * k / n), 0.55) for k in range(n)], (0, 0, 1), 'stone-blocks', '#c8c4ba')
    lib.cylinder(b, 0, 0, 0.15, 0.5, radius - 0.35, n=n, slot='plain', col='#5f98b3', top=True, smooth=False)
    if jet and b.detail == 0:
        lib.cylinder(b, 0, 0, 0.5, 2.2, 0.35, n=6, slot='stone-blocks', col='#c8c4ba', r_top=0.2, top=True)
        lib.cylinder(b, 0, 0, 2.2, 3.2, 0.5, n=8, slot='plain', col='#dff0f7', r_top=0.04, top=False, smooth=False)


@part('tree')
def tree(b, F, lk, s, kind='broadleaf', height=7.0):
    lib.tree(b, kind, 0, 0, height, s, lk)


# ------------------------------------------------------------------------------------------------------------------ small pieces
@part('dormer')
def dormer(b, F, lk, s, width=1.4, depth=1.2, height=1.5, colour=None):
    c = colour or lib.shade(lk.wall_col, 1.1)
    F.box(b, -width / 2, 0, 0, width / 2, depth, height, lk.wall_slot, c, skip=('bottom', 'top', 'back'))
    F.roof(b, 'gable', -width / 2, 0, width / 2, depth, height, width * 0.35, 0.12, lk.roof_slot, lk.roof_col, lk.wall_slot, c, ridge='y', ov_front=0.15)
    if b.detail < 2:
        F.face(b, [(-width * 0.3, -0.02, height * 0.2), (width * 0.3, -0.02, height * 0.2), (width * 0.3, -0.02, height * 0.85), (-width * 0.3, -0.02, height * 0.85)], (0, -1, 0), 'glass-punched', '#3a4852', mode='fit')


@part('bay-window')
def bay_window(b, F, lk, s, width=3.0, depth=0.9, height=6.0, storeys=2, colour=None):
    c = colour or lib.shade(lk.wall_col, 1.05)
    w2 = width * 0.3
    pts = [(-width / 2, 0), (-w2, -depth), (w2, -depth), (width / 2, 0)]
    for (a, bq) in zip(pts[:-1], pts[1:]):
        b.facing([(a[0], a[1], 0), (bq[0], bq[1], 0), (bq[0], bq[1], height), (a[0], a[1], height)], (bq[1] - a[1], -(bq[0] - a[0]), 0), lk.wall_slot, c)
    if b.detail < 2:
        n = int(max(1, storeys))
        for k in range(n):
            z0 = height / n * k + height / n * 0.28
            z1 = height / n * (k + 1) - height / n * 0.2
            F.face(b, [(-w2 + 0.1, -depth - 0.03, z0), (w2 - 0.1, -depth - 0.03, z0), (w2 - 0.1, -depth - 0.03, z1), (-w2 + 0.1, -depth - 0.03, z1)], (0, -1, 0), 'glass-punched', '#3a4852', mode='fit')
        F.box(b, -width / 2 - 0.05, -depth - 0.1, height - 0.05, width / 2 + 0.05, 0.0, height + 0.15, lk.wall_slot, lib.shade(c, 1.1), lk.roof_slot, lk.roof_col)


@part('stepped-gable')
def stepped_gable(b, F, lk, s, width=5.0, height=3.0, steps=4, thickness=0.5, colour=None):
    c = colour or lk.wall_col
    n = int(max(2, steps))
    for k in range(n):
        w = width * (1 - k / (n + 0.5))
        F.box(b, -w / 2, 0, height * k / n, w / 2, thickness, height * (k + 1) / n, lk.wall_slot, c, lk.wall_slot, lib.shade(c, 1.1), skip=('bottom',))


@part('chimney-stack')
def chimney_stack(b, F, lk, s, width=1.0, height=2.2, pots=2, colour='#9b5a43'):
    F.box(b, -width / 2, -width * 0.35, 0, width / 2, width * 0.35, height, 'brick', colour, 'plain', '#4a4540')
    if b.detail == 0:
        for k in range(int(pots)):
            x = (k - (pots - 1) / 2) * width * 0.45
            F.cyl(b, x, 0, height, height + 0.45, 0.14, n=5, slot='plain', col='#b5683f', top=True, smooth=False)


@part('pediment')
def pediment(b, F, lk, s, width=8.0, rise=1.1, depth=0.6, colour=None):
    c = colour or lib.shade(lk.wall_col, 1.12)
    F.box(b, -width / 2, -depth, 0, width / 2, 0, 0.3, lk.wall_slot, c, skip=('bottom',))
    F.roof(b, 'gable', -width / 2, -depth, width / 2, 0, 0.3, rise, 0.1, lk.roof_slot, lk.roof_col, lk.wall_slot, c, ridge='y', ov_front=0.1, th=0.0)


@part('balcony')
def balcony(b, F, lk, s, width=4.0, depth=1.2, railing_colour='#2b2b2b'):
    F.box(b, -width / 2, 0.0, 0, width / 2, depth, 0.2, lk.wall_slot, lib.shade(lk.wall_col, 0.9), 'plain', lib.shade(lk.wall_col, 1.0), skip=('bottom',))
    if b.detail == 0:
        for (xa, ya, xb, yb) in ((-width / 2, 0, width / 2, 0), (width / 2, 0, width / 2, depth), (-width / 2, depth, -width / 2, 0)):
            lib.beam(b, F.xy(xa, ya), F.xy(xb, yb), 0.2 + 0.93, 0.2 + 1.0, 0.05, 'frame', railing_colour, skip=('bottom',))
        n = int(width / 0.15)
        for k in range(n + 1):
            x = -width / 2 + width * k / n
            lib.cylinder(b, x, 0.0, 0.2, 1.2, 0.012, n=3, slot='frame', col=railing_colour, top=False, smooth=False)
    elif b.detail == 1:
        F.box(b, -width / 2, 0, 0.2, width / 2, 0.05, 1.1, 'frame', railing_colour)


@part('railing')
def railing(b, F, lk, s, length=6.0, height=1.0, colour='#9ea3a8', glass=False):
    if b.detail >= 2:
        return
    if glass:
        q = [(-length / 2, 0, 0), (length / 2, 0, 0), (length / 2, 0, height), (-length / 2, 0, height)]
        b.face(q, 'glass-ribbon', '#cfe0e8', mode='fit')
        b.face(q[::-1], 'glass-ribbon', '#cfe0e8', mode='fit')
        return
    lib.beam(b, (-length / 2, 0), (length / 2, 0), height - 0.06, height, 0.07, 'frame', colour, skip=('bottom',))
    if b.detail == 0:
        lib.beam(b, (-length / 2, 0), (length / 2, 0), height * 0.45, height * 0.45 + 0.04, 0.05, 'frame', colour, skip=('bottom',))
        n = int(length / 1.8) + 1
        for k in range(n + 1):
            lib.cylinder(b, -length / 2 + length * k / n, 0, 0, height, 0.03, n=3, slot='frame', col=colour, top=False, smooth=False)


@part('steps')
def steps(b, F, lk, s, width=3.0, rise=0.8, run=2.0, count=4, colour='#b7b2a8'):
    n = int(max(1, count))
    for k in range(n):
        h = rise * (k + 1) / n
        y0 = -run + run * k / n
        F.box(b, -width / 2, y0, 0, width / 2, 0.0 if k == n - 1 else y0 + run / n + 0.001, h, 'paving', colour, 'paving', lib.shade(colour, 1.08), skip=('bottom', 'back'))


@part('umbrella')
def umbrella_part(b, F, lk, s, radius=1.6, height=2.4, colour=None):
    U.umbrella(b, 0, 0, radius, height, colour or s.choice(U.UMB))


@part('string-lights')
def string_lights(b, F, lk, s, length=8.0, height=2.8, count=10, colour='#ffe9a8'):
    if b.detail >= 1:
        return
    for k in range(int(count)):
        t = k / max(1, count - 1)
        x = -length / 2 + length * t
        z = height - 0.35 * math.sin(math.pi * t)
        lib.box_c(b, x, 0.0, z, 0.12, 0.12, 0.12, 'plain', colour)


@part('hedge')
def hedge(b, F, lk, s, length=6.0, height=0.8, depth=0.9, colour='#4f7d3b'):
    if b.detail >= 2:
        return
    n = max(1, int(length / (depth * 1.1)))
    for k in range(n):
        x = -length / 2 + length * (k + 0.5) / n
        lib.blob(b, x, 0, height * 0.7, depth * 0.62, depth * 0.55, height * 0.7, lib.jitter(colour, s, 0.1), n=6 if b.detail == 0 else 5, rings=3)


@part('lamp-post')
def lamp_post(b, F, lk, s, height=6.5):
    lib.lamp(b, 0, 0, height, lk)


@part('flagpole')
def flagpole(b, F, lk, s, height=9.0, colour='#b6323a'):
    U.flag_pole(b, 0, 0, height, colour)


@part('platform-canopy')
def platform_canopy(b, F, lk, s, width=18.0, depth=8.0, height=3.2, deck_height=0.55):
    F.box(b, -width / 2, 0, 0, width / 2, depth, deck_height, 'timber', '#8a6a45', 'timber', '#a58559', skip=('bottom',))
    if b.detail == 0:
        for sx in (-width / 2 + 0.6, width / 2 - 0.6):
            for sy in (0.6, depth - 0.6):
                F.cyl(b, sx, sy, deck_height, height, 0.07, n=4, slot='timber', col='#7a5a3a', top=False, smooth=False)
    F.roof(b, 'shed', -width / 2 - 0.3, -0.2, width / 2 + 0.3, depth + 0.2, height, 0.8, 0.2, 'corrugated', lk.roof_col, lk.wall_slot, lk.wall_col, th=0.08, ov_front=0.3)


@part('basilica-hall')
def basilica_hall(b, F, lk, s, width=60.0, depth=40.0, wall_height=5.0, nave_ratio=0.54, roof='gable', shop_front=True, gates=True):
    D, W = depth, width
    bb = Xform(b, (0.0, D / 2, 0.0), 0.0)       # build in a frame centred on the plan, then shift back so the front sits at y = 0
    FF = U.Frame(0, 0, 0)
    det = bb.detail
    hw = wall_height
    nave_w = D * nave_ratio
    z_hi = hw + 1.5
    z_cl = z_hi + 2.0
    rise = nave_w * 0.2
    wc, ws = lk.wall_col, lk.wall_slot
    acc = U.accent_cols({'facade': {'colours': [lk.accent_col, lk.trim_col]}}, {}, s)
    pal = [wc, lk.accent_col, lk.trim_col]
    front = lib.Seg((-W / 2, -D / 2), (W / 2, -D / 2))
    if shop_front:
        U.shop_facade(bb, front, 0, 1, hw, hw, lk, s, kind='mixed', cols=pal, accents=acc, unit_w=4.2, wall_slot=ws, wall_col=wc)
        U.entrance_bay(bb, front, W * 0.5, min(14.0, W * 0.2), 0, hw, 1.4, lk, s, col=lib.shade(wc, 1.08), sign_col=lib.shade(acc[0], 0.8), arch=False)
    else:
        bb.face([front.P(0, 0), front.P(W, 0), front.P(W, hw), front.P(0, hw)], ws, wc, scale=3.0)
    lib.facade(bb, lib.Seg((W / 2, D / 2), (-W / 2, D / 2)), 0, hw, 1, lk, 'arched', 0.3, s, U.bay(4.8), reduced=True, wall_slot=ws, wall_col=wc)
    prof = [(-D / 2, 0), (D / 2, 0), (D / 2, hw)]
    if roof in ('gable', 'barrel', 'hip', 'flat'):
        prof += [(nave_w / 2, z_hi), (nave_w / 2, z_cl)]
        prof += {'gable': [(0, z_cl + rise)], 'hip': [(0, z_cl + rise * 0.8)], 'barrel': [(nave_w * 0.25, z_cl + rise * 0.7), (0, z_cl + rise), (-nave_w * 0.25, z_cl + rise * 0.7)],
                 'flat': [(nave_w / 2, z_cl + 0.4), (-nave_w / 2, z_cl + 0.4)]}[roof]
        prof += [(-nave_w / 2, z_cl), (-nave_w / 2, z_hi), (-D / 2, hw)]
    elif roof == 'shed':
        prof = [(-D / 2, 0), (D / 2, 0), (D / 2, hw + D * 0.16), (-D / 2, hw)]
    else:
        prof = [(-D / 2, 0), (D / 2, 0), (D / 2, hw), (-D / 2, hw)]
    for sx, hint in ((-W / 2, (-1, 0, 0)), (W / 2, (1, 0, 0))):
        bb.facing([(sx, y, z) for (y, z) in prof], hint, ws, lib.shade(wc, 0.97), scale=3.0 if det else 2.0)
        if gates and det < 2:
            sgn = -1 if sx < 0 else 1
            gw, gz = nave_w * 0.55, hw * 0.78
            bb.facing([(sx + sgn * 0.03, -gw / 2, 0), (sx + sgn * 0.03, gw / 2, 0), (sx + sgn * 0.03, gw / 2, gz), (sx + sgn * 0.03, -gw / 2, gz)], (sgn, 0, 0), 'glass-punched', '#3c3a38', mode='fit')
            if det == 0:
                bb.facing([(sx + sgn * 0.05, -gw * 0.45, gz + 0.5), (sx + sgn * 0.05, gw * 0.45, gz + 0.5), (sx + sgn * 0.05, gw * 0.45, gz + 1.7), (sx + sgn * 0.05, -gw * 0.45, gz + 1.7)], (sgn, 0, 0), 'plain', lib.shade(acc[0], 0.8))
    rslot = 'metal-roof' if lk.roof_slot != 'corrugated' else 'corrugated'
    if roof in ('gable', 'hip', 'flat', 'barrel'):
        for sgn in (-1, 1):
            ya, yb = (-D / 2, -nave_w / 2) if sgn < 0 else (nave_w / 2, D / 2)
            FF.roof(bb, 'shed', -W / 2, ya, W / 2, yb, hw, z_hi - hw, 0.8, rslot, lk.roof_col, ws, wc, high='back' if sgn < 0 else 'front', infill=False, ov_front=0.8)
            ycl = sgn * nave_w / 2
            q = [(-W / 2, ycl, z_hi), (W / 2, ycl, z_hi), (W / 2, ycl, z_cl), (-W / 2, ycl, z_cl)]
            if det < 2:
                bb.facing(q, (0, sgn, 0), 'glass-ribbon', '#cfd8dd', mode='tile', scale=3.0)
            else:
                bb.facing(q, (0, sgn, 0), 'plain', lib.shade(wc, 0.6))
        nr = (-W / 2 - 0.4, -nave_w / 2, W / 2 + 0.4, nave_w / 2)
        if roof == 'gable':
            FF.roof(bb, 'gable', *nr, z_cl, rise, 0.5, 'metal-roof', lk.roof_col, ws, wc, ov_front=0.6, th=0.12, infill=False)
        elif roof == 'hip':
            FF.roof(bb, 'hip', *nr, z_cl, rise * 0.8, 0.5, 'metal-roof', lk.roof_col, ws, wc, ov_front=0.6)
        elif roof == 'barrel':
            lib.barrel(bb, nr, z_cl, rise, lk, axis='x', ov=0.0, slot='metal-roof', col=lk.roof_col)
        else:
            FF.roof(bb, 'flat', nr[0], nr[1], nr[2], nr[3], z_cl, 0, 0.6, 'metal-roof', lk.roof_col, ws, wc, parapet=0.5)
    elif roof == 'shed':
        FF.roof(bb, 'shed', -W / 2, -D / 2, W / 2, D / 2, hw, D * 0.16, 0.8, 'metal-roof', lk.roof_col, ws, wc, high='back', ov_front=1.2, infill=False)
    else:
        lib.sawtooth(bb, (-W / 2, -D / 2, W / 2, D / 2), hw, 2.8, lk, teeth=int(U.clamp(W / 11, 4, 9)), axis='x', glaze='back', slot='metal-roof', col=lk.roof_col)
