"""Church parts (gothic, classical and modern) for the per-place composer. One file; exports PARTS and PARAMS.

    PARTS[id](b, look, rng, detail, at=(x, y, z), rot=0.0, **params)

builds into Builder `b` at `at` (metres) rotated `rot` degrees about +Z (counter-clockwise seen from above). `look` is lib.look(...); the
common params below override it per part. Local frame of every part: +x right, +y away from the camera, +z up; a part that stands on a
wall faces -y (towards the camera), so `rot` turns it to face another way. Unknown params are not an error: they are collected in
UNKNOWN[part-id] so the composer can report them. PARAMS[id] holds the defaults (the schema). Every part honours detail 0/1/2
(LOD2 is a plain silhouette, a handful of triangles).

Common params (all parts): colour (wall '#hex'), trim ('#hex', stone dressings), roof_colour, material (a MATERIALS id: stone,
brick, render ...), roof_material (a ROOF_MATERIALS id).

Origins: towers, domes, spires, pinnacles, apses, roofs, cross, statue, fountain, flagpole stand on `at` (the centre of their base).
Wall-fixed parts (rose-window, window-row, portal, pediment, portico, pilaster-row, cornice-band, cross-window, glazed-gable,
buttress-row, crenellation, entrance-canopy, zakomari-row, baroque-gable, gabled-porch) have `at` on the wall plane, centred along the
wall; they project towards -y. `at.z` is the base unless stated.

-------------------------------------------------------------------------------------------------------------------- GOTHIC
west-tower        square tower with belfry openings, string courses, optional corner buttresses and a cap.
                  width=6, depth=None (= width), height=18 (to the wall top), style='pyramid'|'hip'|'saddle'|'crenellated'|'spire'
                  (broach spire), spire_height=None (default 0.75 x height), belfry='pointed'|'round'|'rect'|'none', courses=3,
                  buttress_stages=0..2, clock=False, door=True, west_window=True, pinnacles=False, stair_turret=False, stained=None
                  ('#hex' west window glass), bands=None (stripe colour: banded masonry)
spire             octagonal spire. base='octagon' (needle on a drum, radius) | 'broach' (on a square tower top, width), radius=1.6,
                  width=6, height=14, lucarnes=True, finial='cross'|'rod'|'none', drum_height=0
pinnacle-row      small pinnacles along x: length=6, count=4, size=0.6, height=2.4, base_height=0
buttress-row      stepped buttresses against a wall: length=20, count=6, height=5, proud=0.6, width=0.8, stages=2
flying-buttress-row  half-arches from outer piers to a clerestory wall, along y: length=20, count=4, side=1|-1, reach=4.5 (pier to wall),
                  pier_height=3.5, wall_height=9
rose-window       circular window on a wall (at = centre): radius=1.5, glass='#5a6fb8', spokes=8
window-row        row of applied windows: count=4, length=14 (total span), width=1.1, height=3.2, sill=1.2, shape='pointed'|'round'|
                  'rect'|'lancet', mullions=0, surround=0.12, glass='#hex'|None, glass_cycle=None (list of '#hex')
portal            arched doorway with surround and steps: width=2.2, height=3.8, shape='pointed'|'round'|'rect'|'seg', door_colour='#4b3426',
                  surround=0.22, steps=2
crenellation      battlement parapet. length=8 (straight run) or width x depth for a closed rectangle, base_height=0.35, merlon_height=0.7
apse              polygonal apse opening to -y, round end to +y: radius=3.2, wall_height=7, roof_rise=4, sides=5, windows=True,
                  glass='#hex'|None
gabled-porch      gabled porch in front of a wall: width=3.3, depth=3.0, wall_height=3.4, rise=1.9, shape='pointed'|'round'|'rect',
                  timber=False
bellcote          small bell gable on a gable apex: width=1.5, height=2.7
gable-roof        two-pitch roof over a rectangle (x = width, y = length), at = centre of the eave line: width=9, length=20, rise=4,
                  overhang=0.4, gable_overhang=0.3, axis='y'|'x', hip_run=0, gable_ends=True (triangles in the wall colour)
lean-roof         single-pitch aisle / porch roof: width=4.5 (horizontal span), length=20, rise=2, side=1|-1 (high edge at x=0 side), overhang=0.35
cloister          ring of two-storey wings round a court (convent / abbey): width=24, depth=24, height=7, roof='gable'|'flat',
                  windows='punched'|'arched'
boundary-wall     churchyard wall / railing with a gate gap in the -y side: width=30, depth=40, gate_width=4, height=1.1, rail=False
headstones        scattered graves: count=12, width=20, depth=20
cross             free cross: height=2.2

------------------------------------------------------------------------------------------------------------------ CLASSICAL
dome              drum with windows, dome and optional lantern/finial/cross: radius=8, height=None (dome height; default by profile),
                  profile='hemi'|'shallow'|'pointed'|'onion', drum_height=4, drum_radius=None (= radius), drum_windows=True,
                  lantern=0 (height), finial=1.5, cross=True, dome_colour=None (default roof_colour)
bell-tower        square bell tower with round / pointed / rect belfry and a cap. width=5, depth=None, height=20, cap='pyramid'|'hip'|
                  'cupola'|'onion'|'crenellated'|'flat-cross'|'open'|'spire', belfry='round'|'pointed'|'rect', courses=2, clock=False,
                  door=True, west_window=True, pinnacles=False, bands=None
slab-tower        modern campanile: tall plain shaft, big belfry slots, flat cap, cross. width=3, depth=None, height=22, cap='flat-cross'|
                  'open'|'hip'|'spire'
octagonal-belfry  slim octagonal tower: radius=3, height=18, cap='cone'|'dome', windows=True
portico           columned porch with entablature, pediment and steps: width=8, depth=3.2, height=6, columns=4, pediment=True, steps=3,
                  column_radius=None
colonnade         row of columns with a beam: length=12, count=6, height=4.5, radius=0.3, beam_height=0.6, kind='round'|'square'
pediment          triangular pediment applied on a wall (at = centre of the base line): width=9, rise=2.4, oculus='plain'|'rose'|'none',
                  cross=True, glass='#hex'|None
baroque-gable     shaped two-tier front with scrolls: width=24, nave_width=13, lower_height=7, upper_height=12, rise=3
pilaster-row      flat pilasters with capitals: length=16, count=5, height=7, width=0.7
cornice-band      projecting band along a wall: length=16, height=0.5, projection=0.4
zakomari-row      semicircular gable heads over a wall: length=16, count=3, wall_height=0 (z of the base)
rotunda           round church: radius=12, ring_height=5, drum_height=9, roof='dome'|'cone', columns=False, door=True, windows=True,
                  glass='#hex'|None
cupola            small lantern with arched slits and a dome: radius=1.6, height=3
corner-domes      onion / hemi domes on short drums at the 4 corners of a rectangle: width=14, depth=18, radius=1.8, profile='onion'|'hemi',
                  drum_height=2.4

-------------------------------------------------------------------------------------------------------------------- MODERN
cross-window      cross-shaped glazing applied on a wall (at = bottom centre): height=8, bar=0.7, glass='#7fa0c8', frame=None
glazed-gable      glazed triangular front with mullions: width=10, rise=4.5, height=0 (rectangular glass below the triangle),
                  mullions=4, glass='#hex'|None
entrance-canopy   flat or curved canopy on columns: width=10, depth=4, height=4.2, form='flat'|'curved', columns=0 (auto)
a-frame           A-frame chapel body: width=10, length=18, height=10, glass_front=True, door=True, timber='#6b4a30', cross=True
cable-stays       thin stay cables from the origin to points: targets=[[x, y, z], ...] (relative to at), width=0.15
cross-tower       tall slender concrete cross: height=40, width=2.6, arm_length=None, arm_height=0.82 (fraction)
membrane-roof     tent-like wedge roof (tensile look): width_front=22, width_back=70, depth=60, eave=16, ridge=30, walls=True
shell-roof        hall roof: style='barrel'|'sail'|'wave', width=14, length=30, eave=7, rise=7, glazed_ends=True, walls=True
fin-wall          brutalist wall with deep ribs and slit windows: length=24, height=12, fins=6, fin_depth=0.7, slits=True
pylon             slender concrete pylon with a slab cap and optional cross: width=1.8, height=24, cross=True

----------------------------------------------------------------------------------------------------------------- SITE / SHARED
sign-board        blank board on posts: width=6.5, height=2.6, board_colour='#2f5f8a'
flagpole          pole with a flag: height=8, flag_colour='#1b7a3d'
statue-on-plinth  figure on a plinth: height=3.6, figure='#d9d6cc'
fountain          basin with a central jet: radius=2.4
steps             flight of steps against a wall (at = foot centre, rising towards +y): width=5, rise=0.6, count=4, run=None
"""
import copy
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = os.path.dirname(HERE)
for _p in (BLENDER, os.path.join(BLENDER, 'archetypes')):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import lib  # noqa: E402
import _church_gothic_util as U  # noqa: E402
from _church_gothic_util import clamp  # noqa: E402
from lib.facade import ROOF_SLOT, WALL_SLOT  # noqa: E402

PARTS = {}
PARAMS = {}
UNKNOWN = {}
COMMON = {'colour': None, 'trim': None, 'roof_colour': None, 'material': None, 'roof_material': None}
STONE = '#d9d6cc'


class _XB:
    """Builder proxy: places everything a part builds at `at` with yaw `rot` (degrees) by transforming every point and direction."""

    def __init__(self, b, at, rot):
        self._b = b
        self.at = (float(at[0]), float(at[1]), float(at[2]) if len(at) > 2 else 0.0)
        a = math.radians(rot)
        self.c, self.s = math.cos(a), math.sin(a)

    detail = property(lambda self: self._b.detail)
    flat = property(lambda self: self._b.flat)
    tris = property(lambda self: self._b.tris)

    def _p(self, p):
        x, y = p[0], p[1]
        return (self.at[0] + self.c * x - self.s * y, self.at[1] + self.s * x + self.c * y, self.at[2] + p[2])

    def _v(self, v):
        return (self.c * v[0] - self.s * v[1], self.s * v[0] + self.c * v[1], v[2])

    def face(self, pts, slot='plain', col=None, smooth=False, uvs=None, mode=None, scale=1.0):
        return self._b.face([self._p(p) for p in pts], slot, col, smooth=smooth, uvs=uvs, mode=mode, scale=scale)

    def facing(self, pts, hint, slot='plain', col=None, **kw):
        return self._b.facing([self._p(p) for p in pts], self._v(hint), slot, col, **kw)

    def shared_grid(self, grid, slot, col, **kw):
        return self._b.shared_grid([[self._p(p) for p in row] for row in grid], slot, col, **kw)

    def site(self):
        return self._b.site()

    def section(self, label):
        return self._b.section(label)


def _look(look, p):
    lk = copy.copy(look)
    if p.get('colour'):
        lk.wall_col = p['colour']
        lk.accent_col = lib.shade(p['colour'], 0.8)
    if p.get('trim'):
        lk.trim_col = p['trim']
        lk.frame_col = lib.shade(p['trim'], 0.8)
    if p.get('roof_colour'):
        lk.roof_col = p['roof_colour']
    m = p.get('material')
    if m:
        lk.wall_slot = WALL_SLOT.get(m, m if m in lib.slots()['slots'] else lk.wall_slot)
    rm = p.get('roof_material')
    if rm:
        lk.roof_slot = ROOF_SLOT.get(rm, rm if rm in lib.slots()['slots'] else lk.roof_slot)
    return lk


def part(name, **defaults):
    def deco(fn):
        def wrapper(b, look, rng, detail, at=(0.0, 0.0, 0.0), rot=0.0, **params):
            unknown = [k for k in params if k not in defaults and k not in COMMON]
            if unknown:
                UNKNOWN.setdefault(name, set()).update(unknown)
            p = dict(COMMON)
            p.update(defaults)
            p.update({k: v for k, v in params.items() if k in p})
            xb = _XB(b, at, rot)
            return fn(xb, _look(look, p), rng, p)
        wrapper.__name__ = name
        wrapper.__doc__ = fn.__doc__
        PARTS[name] = wrapper
        PARAMS[name] = dict(defaults)
        return fn
    return deco


def _seg(L):
    """A wall line along local x, centred on the origin, outside towards -y."""
    return lib.Seg((-L / 2, 0.0), (L / 2, 0.0))


def _ws(lk):
    return lk.wall_slot, lk.wall_col, lk.trim_col


# ============================================================================================================== GOTHIC
@part('west-tower', width=6.0, depth=None, height=18.0, style='pyramid', spire_height=None, belfry='pointed', courses=3, buttress_stages=0, clock=False, door=True,
      west_window=True, pinnacles=False, stair_turret=False, stained=None, bands=None)
def west_tower(b, lk, rng, p):
    tw = p['width']
    td = p['depth'] or tw
    th = p['height']
    bel = p['belfry']
    U.square_tower(b, 0.0, 0.0, tw, td, 0.0, th, lk, rng, bands=(1.1, p['bands']) if p['bands'] else None, belfry=bel != 'none', courses=p['courses'], buttress_stages=p['buttress_stages'],
                   clock=p['clock'], belfry_shape=bel if bel != 'none' else 'pointed', stained=p['stained'], door=p['door'], west_window=p['west_window'],
                   wall_slot=lk.wall_slot, wall_col=lk.wall_col, trim=lk.trim_col)
    _tower_cap(b, lk, rng, tw, td, th, p['style'], p['spire_height'], p['pinnacles'], p['stair_turret'])


def _tower_cap(b, lk, rng, tw, td, zt, style, spire_h, pinn, turret):
    det = b.detail
    hw, hd = tw / 2, td / 2
    trim = lk.trim_col
    rect = (-hw, -hd, hw, hd)
    if style in ('spire', 'broach'):
        sp = spire_h or clamp(zt * 0.75, 4.0, 28.0)
        if det == 0:
            U.sbox(b, lib.Seg((-hw - 0.15, -hd - 0.15), (hw + 0.15, -hd - 0.15)), 0, tw + 0.3, zt - 0.1, zt + 0.35, 0.0, trim, 'plain-render')
        U.spire_broach(b, 0, 0, zt, tw, td, sp, lk, slot=lk.roof_slot, col=lk.roof_col, lucarnes=True)
        if det <= 1:
            lib.cylinder(b, 0, 0, zt + sp, zt + sp + 1.2 + sp * 0.04, 0.05, n=4, slot='frame', col='#c9b677', r_top=0.02, top=True)
            if det == 0:
                U.cross_finial(b, 0, 0, zt + sp + 1.0, 1.6, '#c9b677')
        if pinn and det == 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    U.pinnacle(b, sx * (hw - 0.3), sy * (hd - 0.3), zt, 0.6, 2.2, lk)
    elif style in ('crenellated', 'crenel'):
        lib.cap(b, [[(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])]], zt, True, 'roof-flat', lk.roof_col, scale=2.0)
        U.crenellate(b, rect, zt, lk, col=lib.shade(trim, 0.95))
        if pinn:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    U.pinnacle(b, sx * (hw - 0.1), sy * (hd - 0.1), zt + 0.3, 0.7, 2.8, lk)
        if turret and det <= 1:
            n = 8 if det == 0 else 6
            lib.cylinder(b, hw - 0.55, hd - 0.55, 0, zt + 2.2, 0.85, n=n, slot=lk.wall_slot, col=lk.wall_col, top=True, smooth=False)
            lib.cylinder(b, hw - 0.55, hd - 0.55, zt + 2.2, zt + 3.4, 0.95, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    elif style == 'hip':
        U.pyramid(b, 0, 0, zt, tw, td, tw * 0.55, lk, ov=0.45)
    elif style == 'saddle':
        U.gable_roof(b, rect, zt, tw * 0.5, 'x', ov=0.3, ove=0.3, look=lk, gables=(True, True))
    else:
        rise = tw * 0.95
        U.pyramid(b, 0, 0, zt, tw, td, rise, lk, ov=0.4)
        if det == 0:
            U.cross_finial(b, 0, 0, zt + rise, 1.3, '#c9b677')
        if pinn and det == 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    U.pinnacle(b, sx * (hw - 0.1), sy * (hd - 0.1), zt - 0.2, 0.6, 2.2, lk)


@part('spire', base='octagon', radius=1.6, width=6.0, height=14.0, lucarnes=True, finial='cross', drum_height=0.0)
def spire(b, lk, rng, p):
    det = b.detail
    h = p['height']
    z = 0.0
    if p['base'] == 'broach':
        U.spire_broach(b, 0.0, 0.0, 0.0, p['width'], p['width'], h, lk, slot=lk.roof_slot, col=lk.roof_col, lucarnes=p['lucarnes'])
        top = h
    else:
        r = p['radius']
        if p['drum_height'] > 0:
            lib.cylinder(b, 0, 0, 0, p['drum_height'], r, n=8, slot='stone-blocks', col=lib.shade(lk.trim_col, 0.97), top=False, smooth=False)
            z = p['drum_height']
        U.ngon_pyramid(b, 0, 0, z, r * 1.1, h, 8, lk, rot=math.pi / 8, slot=lk.roof_slot, col=lk.roof_col, alt=0.06)
        top = z + h
    if det <= 1 and p['finial'] != 'none':
        lib.cylinder(b, 0, 0, top, top + 1.4 + h * 0.04, 0.05, n=4, slot='frame', col='#c9b677', r_top=0.02, top=True)
        if p['finial'] == 'cross' and det == 0:
            U.cross_finial(b, 0, 0, top + 1.0, 1.6, '#c9b677')


@part('pinnacle-row', length=6.0, count=4, size=0.6, height=2.4, base_height=0.0)
def pinnacle_row(b, lk, rng, p):
    if b.detail >= 1:
        return
    n = max(1, p['count'])
    for k in range(n):
        x = -p['length'] / 2 + (p['length'] * k / (n - 1) if n > 1 else p['length'] / 2)
        U.pinnacle(b, x, 0.0, p['base_height'], p['size'], p['height'], lk)


@part('buttress-row', length=20.0, count=6, height=5.0, proud=0.6, width=0.8, stages=2)
def buttress_row(b, lk, rng, p):
    seg = _seg(p['length'])
    n = max(1, p['count'])
    col = lib.mix(lk.trim_col, lk.wall_col, 0.45)
    slot = 'stone-blocks' if lk.wall_slot != 'brick' else 'brick'
    for k in range(n):
        u = p['width'] / 2 + (p['length'] - p['width']) * k / (n - 1) if n > 1 else p['length'] / 2
        U.buttress(b, seg, u, 0.0, p['height'], col, slot, p['width'], p['proud'], p['stages'])


@part('flying-buttress-row', length=20.0, count=4, side=1, reach=4.5, pier_height=3.5, wall_height=9.0)
def flying_buttress_row(b, lk, rng, p):
    n = max(1, p['count'])
    sgn = 1 if p['side'] >= 0 else -1
    col = lib.mix(lk.trim_col, lk.wall_col, 0.45)
    for k in range(n):
        y = -p['length'] / 2 + (p['length'] * k / (n - 1) if n > 1 else p['length'] / 2)
        U.flying_buttress(b, sgn, y, p['reach'] + 0.4, 0.0, p['pier_height'] + 0.6, p['wall_height'] - 1.4, col, 'stone-blocks')


@part('rose-window', radius=1.5, glass='#5a6fb8', spokes=8)
def rose_window(b, lk, rng, p):
    r = p['radius']
    U.rose_window(b, _seg(r * 4), r * 2, 0.0, r, lk, p['glass'], p['spokes'])


@part('window-row', count=4, length=14.0, width=1.1, height=3.2, sill=1.2, shape='pointed', mullions=0, surround=0.12, glass=None, glass_cycle=None)
def window_row(b, lk, rng, p):
    L = p['length']
    n = max(1, p['count'])
    seg = _seg(L)
    shape, rf = p['shape'], 1.0
    if shape == 'lancet':
        shape, rf = 'pointed', 1.6
    bw = L / n
    for k in range(n):
        c = bw * (k + 0.5)
        g = (p['glass_cycle'][k % len(p['glass_cycle'])] if p['glass_cycle'] else None) or p['glass'] or 'glass'
        o = U.op(c - p['width'] / 2, c + p['width'] / 2, p['sill'], p['sill'] + p['height'], shape, g, rf, 0.2, p['mullions'], p['surround'], False)
        U.applique_window(b, seg, o, lk, lk.trim_col)


@part('portal', width=2.2, height=3.8, shape='pointed', door_colour='#4b3426', surround=0.22, steps=2)
def portal(b, lk, rng, p):
    w = p['width']
    seg = _seg(w * 3)
    o = U.op(w * 1.5 - w / 2, w * 1.5 + w / 2, 0.0, p['height'], p['shape'], ('timber', p['door_colour']), 1.0, 0.4, 0, p['surround'], False)
    U.applique_window(b, seg, o, lk, lk.trim_col, d=-0.06)
    if b.detail == 0:
        b.face([seg.P(w * 1.5 - 0.04, 0.0, -0.1), seg.P(w * 1.5 + 0.04, 0.0, -0.1), seg.P(w * 1.5 + 0.04, p['height'] * 0.8, -0.1), seg.P(w * 1.5 - 0.04, p['height'] * 0.8, -0.1)], 'frame', lib.shade(p['door_colour'], 0.7))
    if p['steps'] and b.detail <= 1:
        U.front_steps(b, 0.0, -0.05, w + 1.0, 0.18 * p['steps'], p['steps'], lk)


@part('crenellation', length=8.0, width=None, depth=None, base_height=0.35, merlon_height=0.7)
def crenellation(b, lk, rng, p):
    col = lib.shade(lk.trim_col, 0.95)
    if p['width'] and p['depth']:
        U.crenellate(b, (-p['width'] / 2, -p['depth'] / 2, p['width'] / 2, p['depth'] / 2), 0.0, lk, col=col, merlon_h=p['merlon_height'], base_h=p['base_height'])
        return
    L = p['length']
    lib.box(b, -L / 2, -0.25, 0, L / 2, 0.25, p['base_height'], 'stone-blocks', col, skip=('bottom',))
    if b.detail >= 1:
        return
    n = max(2, int(L / 1.65))
    step = L / n
    for k in range(n):
        lib.box_c(b, -L / 2 + step * (k + 0.5), 0.0, p['base_height'], 0.9, 0.5, p['merlon_height'], 'stone-blocks', lib.shade(col, 1.06), skip=('bottom',))


@part('apse', radius=3.2, wall_height=7.0, roof_rise=4.0, sides=5, windows=True, glass=None)
def apse(b, lk, rng, p):
    U.apse(b, 0.0, 0.0, p['radius'], 0.0, p['wall_height'], lk, None, sides=p['sides'], window=p['windows'], roof_rise=p['roof_rise'], stained=p['glass'],
           shape='pointed', win_w=clamp(p['radius'] * 0.4, 0.7, 1.4), sill=1.6, head=p['wall_height'] - 1.2)


@part('gabled-porch', width=3.3, depth=3.0, wall_height=3.4, rise=1.9, shape='pointed', timber=False)
def gabled_porch(b, lk, rng, p):
    ws = 'timber' if p['timber'] else lk.wall_slot
    wc = '#6b5238' if p['timber'] else lk.wall_col
    U.front_porch(b, lk, 0.0, 0.0, p['width'], p['depth'], p['wall_height'], p['rise'], ws, wc, lk.trim_col, shape=p['shape'])


@part('bellcote', width=1.5, height=2.7)
def bellcote(b, lk, rng, p):
    if b.detail >= 2:
        lib.box_c(b, 0, -0.2, 0, p['width'], 0.5, p['height'], 'plain', lk.wall_col, skip=('bottom',))
        return
    w, h = p['width'], p['height']
    seg = lib.Seg((-w / 2, 0.0), (w / 2, 0.0))
    U.sbox(b, seg, 0, w, 0.0, h * 0.66, 0.45, lk.wall_col, lk.wall_slot, top=False)
    if b.detail == 0:
        b.face([seg.P(0.45, 0.4, -0.5), seg.P(w - 0.45, 0.4, -0.5), seg.P(w - 0.45, h * 0.5, -0.5), seg.P(0.45, h * 0.5, -0.5)], 'glass-punched', '#46494c')
    U.F(b, [seg.P(-0.1, h * 0.66, -0.5), seg.P(w + 0.1, h * 0.66, -0.5), seg.P(w / 2, h, -0.5)], lk.roof_slot, lk.roof_col)
    if b.detail == 0:
        U.cross_finial(b, 0, -0.25, h - 0.1, 1.0, lk.trim_col)


@part('gable-roof', width=9.0, length=20.0, rise=4.0, overhang=0.4, gable_overhang=0.3, axis='y', hip_run=0.0, gable_ends=True)
def gable_roof(b, lk, rng, p):
    w, L = p['width'], p['length']
    U.gable_roof(b, (-w / 2, -L / 2, w / 2, L / 2), 0.0, p['rise'], p['axis'], ov=p['overhang'], ove=p['gable_overhang'], look=lk, gables=(p['gable_ends'], p['gable_ends']), hip=p['hip_run'])


@part('lean-roof', width=4.5, length=20.0, rise=2.0, side=1, overhang=0.35)
def lean_roof(b, lk, rng, p):
    s = 1 if p['side'] >= 0 else -1
    U.lean_roof(b, s * p['width'], 0.0, -p['length'] / 2, p['length'] / 2, 0.0, p['rise'], lk, ov=p['overhang'])


@part('cloister', width=24.0, depth=24.0, height=7.0, roof='gable', windows='punched')
def cloister(b, lk, rng, p):
    lk2 = copy.copy(lk)
    lk2.windows = 'arched' if p['windows'] == 'arched' else 'punched'
    U.cloister(b, lk2, rng, 0.0, 0.0, p['width'], p['depth'], p['height'], p['roof'])


@part('boundary-wall', width=30.0, depth=40.0, gate_width=4.0, height=1.1, rail=False)
def boundary_wall(b, lk, rng, p):
    U.fence_wall(b, -p['width'] / 2, 0.0, p['width'] / 2, p['depth'], 0.0, p['gate_width'], lk, h=p['height'], rail=p['rail'])


@part('headstones', count=12, width=20.0, depth=20.0)
def headstones(b, lk, rng, p):
    U.headstones(b, rng, -p['width'] / 2, p['width'] / 2, 0.0, p['depth'], [], p['count'])


@part('cross', height=2.2)
def cross(b, lk, rng, p):
    U.cross_finial(b, 0.0, 0.0, 0.0, p['height'], lk.trim_col or STONE)


# ============================================================================================================ CLASSICAL
@part('dome', radius=8.0, height=None, profile='hemi', drum_height=4.0, drum_radius=None, drum_windows=True, lantern=0.0, finial=1.5, cross=True, dome_colour=None)
def dome(b, lk, rng, p):
    det = b.detail
    r = p['radius']
    dr = p['drum_radius'] or r
    z = 0.0
    n = 16 if det == 0 else (12 if det == 1 else 8)
    dh = p['drum_height']
    if dh > 0:
        lib.cylinder(b, 0, 0, 0.0, dh, dr, n=n, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
        if det == 0 and p['drum_windows']:
            for k in range(0, n, 2):
                a = (k + 0.5) * 2 * math.pi / n
                px, py = math.cos(a) * dr * 0.995, math.sin(a) * dr * 0.995
                sg = lib.Seg((px - math.sin(a) * dr * 0.16, py + math.cos(a) * dr * 0.16), (px + math.sin(a) * dr * 0.16, py - math.cos(a) * dr * 0.16))
                b.facing([sg.P(0, dh * 0.22), sg.P(sg.length, dh * 0.22), sg.P(sg.length, dh * 0.82), sg.P(0, dh * 0.82)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
            lib.cylinder(b, 0, 0, dh - 0.2, dh + 0.35, dr * 1.07, n=n, slot='plain-render', col=lk.trim_col, top=True, smooth=False)
        z = dh
    prof = p['profile']
    height = p['height'] or (r * 1.7 if prof == 'onion' else r * (0.86 if prof == 'hemi' else 0.6))
    col = p['dome_colour'] or lk.roof_col
    U.dome(b, 0, 0, z, r, lk, height=height, profile=prof, slot='metal-roof' if prof == 'onion' else lk.roof_slot, col=col, lantern=p['lantern'], finial=p['finial'] if det == 0 else 0)
    top = z + height + (p['lantern'] * 1.5 if p['lantern'] else 0.0)
    if p['cross'] and det <= 1:
        U.cross_finial(b, 0, 0, top - 0.1, max(1.0, r * 0.2), '#c9b677')


def _classical_cap(b, lk, rng, tw, td, zt, cap, pinn):
    det = b.detail
    hw, hd = tw / 2, td / 2
    trim = lk.trim_col
    rect = (-hw, -hd, hw, hd)
    if det == 0 and cap not in ('flat-cross', 'open', 'crenellated'):
        ring = lib.fp_polygon([(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)])
        lib.cornice(b, ring, zt - 0.5, 0.45, 0.5, lk, col=trim)
        lib.sweep(b, ring, zt, [(0.4, 0), (0.4, 0.05)], 'plain-render', trim)
    if cap == 'onion':
        r = tw / 2 * 0.95
        lib.cylinder(b, 0, 0, zt, zt + 1.0, r * 0.95, n=8 if det < 2 else 6, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
        U.dome(b, 0, 0, zt + 1.0, r, lk, height=r * 1.7, profile='onion', slot='metal-roof', col=lk.roof_col, finial=1.6 if det == 0 else 0)
    elif cap == 'cupola':
        U.pyramid(b, 0, 0, zt, tw, td, tw * 0.28, lk, ov=0.35)
        zb = zt + tw * 0.28 * 0.9
        r = tw * 0.27
        lib.cylinder(b, 0, 0, zb, zb + tw * 0.34, r, n=8, slot=lk.wall_slot, col=lk.trim_col, top=False, smooth=False)
        if det == 0:
            for k in range(8):
                a = k * math.pi / 4 + math.pi / 8
                px, py = math.cos(a) * r * 0.95, math.sin(a) * r * 0.95
                sg = lib.Seg((px - math.sin(a) * r * 0.26, py + math.cos(a) * r * 0.26), (px + math.sin(a) * r * 0.26, py - math.cos(a) * r * 0.26))
                b.facing([sg.P(0, zb + 0.35), sg.P(sg.length, zb + 0.35), sg.P(sg.length, zb + tw * 0.28), sg.P(0, zb + tw * 0.28)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
        U.dome(b, 0, 0, zb + tw * 0.34, r * 1.12, lk, height=r * 1.1, profile='hemi', slot=lk.roof_slot, col=lk.roof_col, finial=1.4 if det == 0 else 0)
    elif cap == 'hip':
        U.pyramid(b, 0, 0, zt, tw, td, tw * 0.62, lk, ov=0.45)
    elif cap == 'crenellated':
        lib.cap(b, [[(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])]], zt, True, 'roof-flat', lk.roof_col, scale=2.0)
        U.crenellate(b, rect, zt, lk, col=lib.shade(trim, 0.95))
    elif cap == 'spire':
        U.spire_broach(b, 0, 0, zt, tw, td, tw * 2.6, lk, slot=lk.roof_slot, col=lk.roof_col, lucarnes=False)
    elif cap == 'flat-cross':
        lib.box_c(b, 0, 0, zt, tw + 0.5, td + 0.5, 0.45, 'roof-flat', lib.shade(lk.wall_col, 0.82), skip=())
        U.cross_finial(b, 0, 0, zt + 0.45, clamp(tw * 1.3, 2.4, 4.0), '#e8e4d8')
    elif cap == 'open':
        pass
    else:
        rise = tw * 0.9
        U.pyramid(b, 0, 0, zt, tw, td, rise, lk, ov=0.4)
        if det == 0:
            U.cross_finial(b, 0, 0, zt + rise, 1.4, '#c9b677')
    if pinn and det == 0:
        for sx in (-1, 1):
            for sy in (-1, 1):
                U.pinnacle(b, sx * (hw - 0.2), sy * (hd - 0.2), zt - 0.2, 0.6, 2.4, lk)


def _open_belfry(b, lk, rng, tw, td, th):
    """Shaft, then four posts under a slab roof round the bell, and a cross."""
    sh = th - 3.2
    U.square_tower(b, 0, 0, tw, td, 0.0, sh, lk, rng, belfry=False, courses=0, door=False, west_window=False, wall_slot=lk.wall_slot, wall_col=lk.wall_col, trim=lk.trim_col)
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.box_c(b, sx * (tw / 2 - 0.2), sy * (td / 2 - 0.2), sh, 0.4, 0.4, 3.2, lk.wall_slot, lk.wall_col, skip=('bottom',))
    if b.detail <= 1:
        lib.box_c(b, 0, 0, sh + 0.9, 0.5, 0.5, 1.2, 'frame', '#2d2f31', skip=('bottom',))
    lib.box_c(b, 0, 0, sh + 3.2, tw + 0.6, td + 0.6, 0.4, 'roof-flat', lib.shade(lk.wall_col, 0.85), skip=())
    if b.detail <= 1:
        U.cross_finial(b, 0, 0, sh + 3.6, 2.6, '#e8e4d8')


@part('bell-tower', width=5.0, depth=None, height=20.0, cap='pyramid', belfry='round', courses=2, clock=False, door=True, west_window=True, pinnacles=False, bands=None)
def bell_tower(b, lk, rng, p):
    tw = p['width']
    td = p['depth'] or tw
    th = p['height']
    if p['cap'] == 'open':
        _open_belfry(b, lk, rng, tw, td, th)
        return
    U.square_tower(b, 0, 0, tw, td, 0.0, th, lk, rng, bands=(1.1, p['bands']) if p['bands'] else None, belfry=True, courses=p['courses'], buttress_stages=0, clock=p['clock'],
                   belfry_shape=p['belfry'], door=p['door'], west_window=p['west_window'], wall_slot=lk.wall_slot, wall_col=lk.wall_col, trim=lk.trim_col)
    _classical_cap(b, lk, rng, tw, td, th, p['cap'], p['pinnacles'])


@part('slab-tower', width=3.0, depth=None, height=22.0, cap='flat-cross')
def slab_tower(b, lk, rng, p):
    tw = p['width']
    td = p['depth'] or tw
    th = p['height']
    if p['cap'] == 'open':
        _open_belfry(b, lk, rng, tw, td, th)
        return
    U.square_tower(b, 0, 0, tw, td, 0.0, th, lk, rng, belfry=True, courses=0, door=False, west_window=False, belfry_shape='rect', wall_slot=lk.wall_slot, wall_col=lk.wall_col, trim=lk.trim_col)
    if p['cap'] == 'hip':
        U.pyramid(b, 0, 0, th, tw, td, tw * 0.7, lk, ov=0.4)
        if b.detail == 0:
            U.cross_finial(b, 0, 0, th + tw * 0.7, 1.8, '#e8e4d8')
    elif p['cap'] == 'spire':
        lib.cylinder(b, 0, 0, th, th + tw * 1.9 + 4.0, tw * 0.32, n=4, slot='metal-roof', col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    else:
        _classical_cap(b, lk, rng, tw, td, th, 'flat-cross', False)


@part('octagonal-belfry', radius=3.0, height=18.0, cap='cone', windows=True)
def octagonal_belfry(b, lk, rng, p):
    det = b.detail
    r, th = p['radius'], p['height']
    lib.cylinder(b, 0, 0, 0, th, r, n=8, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
    if det == 0 and p['windows']:
        for k in range(0, 8, 2):
            a = k * math.pi / 4 + math.pi / 8
            px, py = math.cos(a) * r * 0.98, math.sin(a) * r * 0.98
            sg = lib.Seg((px - math.sin(a) * r * 0.3, py + math.cos(a) * r * 0.3), (px + math.sin(a) * r * 0.3, py - math.cos(a) * r * 0.3))
            b.facing([sg.P(0, th - 3.6), sg.P(sg.length, th - 3.6), sg.P(sg.length, th - 0.8), sg.P(0, th - 0.8)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
        lib.cylinder(b, 0, 0, th - 0.4, th + 0.2, r * 1.15, n=8, slot='plain-render', col=lk.trim_col, top=True, smooth=False)
    if p['cap'] == 'dome':
        U.dome(b, 0, 0, th + 0.2, r * 1.05, lk, height=r * 1.0, profile='hemi', slot=lk.roof_slot, col=lk.roof_col)
    else:
        lib.cylinder(b, 0, 0, th + 0.2, th + r * 1.5, r * 1.1, n=8, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)


@part('portico', width=8.0, depth=3.2, height=6.0, columns=4, pediment=True, steps=3, column_radius=None)
def portico(b, lk, rng, p):
    if b.detail >= 2:
        lib.box_c(b, 0, -p['depth'] / 2, 0, p['width'], p['depth'], p['height'] + 0.7, 'plain', lk.trim_col, skip=('bottom',))
        return
    lib.portico(b, 0.0, 0.0, 0.0, p['width'], p['depth'], p['height'], lk, cols=p['columns'], pediment=p['pediment'], steps_n=p['steps'] if b.detail == 0 else min(2, p['steps']), r=p['column_radius'])


@part('colonnade', length=12.0, count=6, height=4.5, radius=0.3, beam_height=0.6, kind='round')
def colonnade(b, lk, rng, p):
    if b.detail >= 2:
        lib.box_c(b, 0, 0, 0, p['length'], 0.8, p['height'], 'plain', lk.trim_col, skip=('bottom',))
        return
    lib.colonnade(b, (-p['length'] / 2, 0.0), (p['length'] / 2, 0.0), 0.0, p['height'], p['count'], lk, r=p['radius'], kind=p['kind'], beam_h=p['beam_height'])


def _raking(b, seg, z, rise, col, L):
    pr, th = 0.22, 0.34
    b.face([seg.P(0, z, -pr), seg.P(L / 2, z + rise, -pr), seg.P(L / 2, z + rise + th, -pr), seg.P(0, z + th, -pr)], 'plain-render', col)
    b.face([seg.P(L / 2, z + rise, -pr), seg.P(L, z, -pr), seg.P(L, z + th, -pr), seg.P(L / 2, z + rise + th, -pr)], 'plain-render', col)


@part('pediment', width=9.0, rise=2.4, oculus='plain', cross=True, glass=None)
def pediment(b, lk, rng, p):
    w, rise = p['width'], p['rise']
    seg = _seg(w)
    U.gable_tri(b, seg, 0.0, rise, look=lk, slot=lk.wall_slot, col=lk.wall_col)
    if b.detail == 0:
        _raking(b, seg, 0.0, rise, lk.trim_col, w)
        r = clamp(rise * 0.26, 0.4, 1.4)
        if p['oculus'] == 'rose':
            U.rose_window(b, seg, w / 2, rise * 0.42, r * 1.1, lk, p['glass'] or '#5a6fb8')
        elif p['oculus'] == 'plain':
            U.disc(b, seg, w / 2, rise * 0.42, r * 1.25, lib.shade(lk.trim_col, 0.95), 'stone-blocks', 12, -0.05)
            U.disc(b, seg, w / 2, rise * 0.42, r, p['glass'] or '#46494c', 'glass-punched', 12, -0.09)
        if p['cross']:
            U.cross_finial(b, 0.0, 0.0, rise + 0.2, 1.8, lk.trim_col)


@part('baroque-gable', width=24.0, nave_width=13.0, lower_height=7.0, upper_height=12.0, rise=3.0)
def baroque_gable(b, lk, rng, p):
    Wt, Wn, ha, hn, rn = p['width'], p['nave_width'], p['lower_height'], p['upper_height'], p['rise']
    ws, wc = lk.wall_slot, lk.wall_col
    seg = lib.Seg((-Wt / 2, 0.0), (Wt / 2, 0.0))
    aw = (Wt - Wn) / 2
    n = 6 if b.detail == 0 else 3
    R = min(aw, (hn - ha) * 0.9)
    for sgn in (-1, 1):
        pts = [((aw - R) + R * math.sin((math.pi / 2) * k / n), ha + R - R * math.cos((math.pi / 2) * k / n)) for k in range(n + 1)]
        poly = [(aw - R, ha)] + pts[1:] + [(aw, ha)]
        if sgn > 0:
            poly = [(Wt - u, z) for (u, z) in poly]
        b.facing([seg.P(u, z, -0.05) for u, z in poly], (0, -1, 0), ws, wc, scale=U.tscale(ws, b.detail))
    gseg = lib.Seg((-Wn / 2, 0.0), (Wn / 2, 0.0))
    U.gable_tri(b, gseg, hn, rn, look=lk, slot=ws, col=wc)
    if b.detail == 0:
        _raking(b, gseg, hn, rn, lk.trim_col, Wn)
        U.cross_finial(b, 0, 0, hn + rn + 0.9, 1.8, lk.trim_col)


@part('pilaster-row', length=16.0, count=5, height=7.0, width=0.7)
def pilaster_row(b, lk, rng, p):
    if b.detail >= 1:
        return
    seg = _seg(p['length'])
    n = max(2, p['count'])
    for k in range(n):
        u = p['width'] * 0.8 + (p['length'] - p['width'] * 1.6) * k / (n - 1)
        U.sbox(b, seg, u - p['width'] / 2, u + p['width'] / 2, 0.4, p['height'] - 0.4, 0.16, lk.trim_col, 'plain-render', top=False)
        U.sbox(b, seg, u - p['width'] * 0.62, u + p['width'] * 0.62, p['height'] - 0.7, p['height'] - 0.4, 0.21, lk.trim_col, 'plain-render')


@part('cornice-band', length=16.0, height=0.5, projection=0.4)
def cornice_band(b, lk, rng, p):
    if b.detail >= 2:
        return
    U.sbox(b, _seg(p['length']), 0, p['length'], 0.0, p['height'], p['projection'], lk.trim_col, 'plain-render')


@part('zakomari-row', length=16.0, count=3, wall_height=0.0)
def zakomari_row(b, lk, rng, p):
    if b.detail >= 1:
        return
    seg = _seg(p['length'])
    L, nz, hn = p['length'], max(1, p['count']), p['wall_height']
    zr = L / nz / 2
    for k in range(nz):
        c = L / nz * (k + 0.5)
        pts = [(c - zr + zr * (1 - math.cos(math.pi * j / 8)), hn + zr * math.sin(math.pi * j / 8)) for j in range(9)]
        b.face([seg.P(c - zr, hn, -0.04)] + [seg.P(u, z, -0.04) for u, z in pts[1:-1]] + [seg.P(c + zr, hn, -0.04)], lk.wall_slot, lk.wall_col, scale=U.tscale(lk.wall_slot, 0))
        U.disc(b, seg, c, hn + zr * 0.45, zr * 0.18, lib.shade(lk.trim_col, 0.85), 'plain', 6, -0.08)


@part('rotunda', radius=12.0, ring_height=5.0, drum_height=9.0, roof='dome', columns=False, door=True, windows=True, glass=None)
def rotunda(b, lk, rng, p):
    det = b.detail
    R, ha, hd = p['radius'], p['ring_height'], p['drum_height']
    ws, wc, trim = _ws(lk)
    n = 16 if det == 0 else (12 if det == 1 else 8)
    ri = R * 0.64
    for k, e in enumerate(lib.fp_round(R, n).edges()):
        ops = []
        if det <= 1:
            if e.n[1] < -0.9 and p['door']:
                dw = min(2.6, e.length * 0.5)
                ops = [U.op(e.length / 2 - dw / 2, e.length / 2 + dw / 2, 0.0, min(ha - 0.5, dw * 1.9), 'round', 'door', 1.0, 0.4, 0, 0.2, False)]
            elif e.length > 2.2 and p['windows']:
                ww = min(1.2, e.length * 0.4)
                ops = [U.op(e.length / 2 - ww / 2, e.length / 2 + ww / 2, ha * 0.28, ha - 0.8, 'round', p['glass'] or 'glass', 1.0, 0.28, 0, 0.12, True)]
        U.wall(b, e.p0, e.p1, 0.0, ha, lk, ops, ws, wc, trim, plinth=0.5)
    rh = (R - ri) * 0.42
    lib.cylinder(b, 0, 0, ha, ha + rh, R + 0.7, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=ri, top=False, smooth=False)
    if p['columns']:
        for k in range(n):
            a = 2 * math.pi * (k + 0.5) / n
            lib.column(b, math.cos(a) * (R + 1.5), math.sin(a) * (R + 1.5), 0.0, ha + 0.1, 0.22, lk, 'round', capital=det == 0, col=lib.shade(trim, 0.95), n=6 if det == 0 else 4)
    for k, e in enumerate(lib.fp_round(ri, n).edges()):
        ops = []
        if det <= 1 and e.length > 1.6 and p['windows']:
            ww = min(1.1, e.length * 0.36)
            ops = [U.op(e.length / 2 - ww / 2, e.length / 2 + ww / 2, ha + rh + 0.6, hd - 1.0, 'round', p['glass'] or 'glass', 1.0, 0.25, 0, 0.1, True)]
        U.wall(b, e.p0, e.p1, ha + rh - 0.2, hd, lk, ops, ws, wc, trim)
    if p['roof'] == 'dome':
        U.dome(b, 0, 0, hd, ri * 1.02, lk, height=ri * 0.75, profile='hemi', slot=lk.roof_slot, col=lk.roof_col)
        top = hd + ri * 0.75
    else:
        lib.cylinder(b, 0, 0, hd, hd + ri * 1.1, ri + 0.5, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
        top = hd + ri * 1.1
    if det <= 1:
        U.cross_finial(b, 0, 0, top - 0.1, 2.0 + ri * 0.2, '#c9b677')


@part('cupola', radius=1.6, height=3.0)
def cupola(b, lk, rng, p):
    det = b.detail
    r, h = p['radius'], p['height']
    lib.cylinder(b, 0, 0, 0, h, r, n=8, slot=lk.wall_slot, col=lk.trim_col, top=False, smooth=False)
    if det == 0:
        for k in range(8):
            a = k * math.pi / 4 + math.pi / 8
            px, py = math.cos(a) * r * 0.95, math.sin(a) * r * 0.95
            sg = lib.Seg((px - math.sin(a) * r * 0.26, py + math.cos(a) * r * 0.26), (px + math.sin(a) * r * 0.26, py - math.cos(a) * r * 0.26))
            b.facing([sg.P(0, 0.35), sg.P(sg.length, 0.35), sg.P(sg.length, h - 0.3), sg.P(0, h - 0.3)], (math.cos(a), math.sin(a), 0), 'glass-punched', '#46494c')
    U.dome(b, 0, 0, h, r * 1.12, lk, height=r * 1.1, profile='hemi', slot=lk.roof_slot, col=lk.roof_col, finial=1.2 if det == 0 else 0)


@part('corner-domes', width=14.0, depth=18.0, radius=1.8, profile='onion', drum_height=2.4)
def corner_domes(b, lk, rng, p):
    r = p['radius']
    onion = p['profile'] == 'onion'
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (p['width'] / 2 - r * 1.6), sy * (p['depth'] / 2 - r * 1.6)
            lib.cylinder(b, x, y, 0, p['drum_height'], r, n=8 if b.detail < 2 else 6, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
            U.dome(b, x, y, p['drum_height'], r * (1.22 if onion else 1.04), lk, height=r * (1.75 if onion else 1.0), profile=p['profile'], slot='metal-roof', col=lk.roof_col)
            if b.detail <= 1:
                U.cross_finial(b, x, y, p['drum_height'] + r * (1.65 if onion else 0.9), r, '#c9b677')


# ============================================================================================================== MODERN
def _cross_glass(b, seg, h, z0, w, col, frame):
    """Cross-shaped glazing applied on a wall (vertical bar with a cross bar at two thirds of the height)."""
    if b.detail >= 2:
        return
    cu = seg.length / 2
    d = -0.05
    arm = h * 0.36
    zc = z0 + h * 0.66

    def outline(f, dd):
        return [seg.P(cu - w / 2 - f, z0 - f, dd), seg.P(cu + w / 2 + f, z0 - f, dd), seg.P(cu + w / 2 + f, zc - w / 2 - f, dd), seg.P(cu + arm + f, zc - w / 2 - f, dd),
                seg.P(cu + arm + f, zc + w / 2 + f, dd), seg.P(cu + w / 2 + f, zc + w / 2 + f, dd), seg.P(cu + w / 2 + f, z0 + h + f, dd), seg.P(cu - w / 2 - f, z0 + h + f, dd),
                seg.P(cu - w / 2 - f, zc + w / 2 + f, dd), seg.P(cu - arm - f, zc + w / 2 + f, dd), seg.P(cu - arm - f, zc - w / 2 - f, dd), seg.P(cu - w / 2 - f, zc - w / 2 - f, dd)]
    if frame and b.detail == 0:
        b.face(outline(0.18, d + 0.03), 'plain-render', frame)
    b.face(outline(0.0, d), 'glass-punched', col)


@part('cross-window', height=8.0, bar=0.7, glass='#7fa0c8', frame=None)
def cross_window(b, lk, rng, p):
    _cross_glass(b, _seg(p['height'] * 2), p['height'], 0.0, p['bar'], p['glass'], p['frame'])


@part('glazed-gable', width=10.0, rise=4.5, height=0.0, mullions=4, glass=None)
def glazed_gable(b, lk, rng, p):
    if b.detail >= 2:
        return
    w, rise, h0 = p['width'], p['rise'], p['height']
    seg = _seg(w)
    col = p['glass'] or lk.glass_col
    pts = [seg.P(0, 0, -0.05), seg.P(w, 0, -0.05)] + ([seg.P(w, h0, -0.05)] if h0 > 0 else []) + [seg.P(w / 2, h0 + rise, -0.05)] + ([seg.P(0, h0, -0.05)] if h0 > 0 else [])
    b.face(pts, 'glass-curtain', col, mode='tile', scale=3.0)
    if b.detail == 0:
        fc = lib.shade(lk.trim_col, 0.7)
        for k in range(1, p['mullions'] + 1):
            u = w * k / (p['mullions'] + 1)
            top = h0 + rise * (1 - abs(u - w / 2) / (w / 2))
            b.face([seg.P(u - 0.05, 0.0, -0.1), seg.P(u + 0.05, 0.0, -0.1), seg.P(u + 0.05, top, -0.1), seg.P(u - 0.05, top, -0.1)], 'frame', fc)
        b.face([seg.P(0, h0 - 0.05, -0.1), seg.P(w / 2, h0 + rise, -0.1), seg.P(w / 2, h0 + rise + 0.2, -0.1), seg.P(0, h0 + 0.15, -0.1)], 'frame', fc)
        b.face([seg.P(w / 2, h0 + rise, -0.1), seg.P(w, h0 - 0.05, -0.1), seg.P(w, h0 + 0.15, -0.1), seg.P(w / 2, h0 + rise + 0.2, -0.1)], 'frame', fc)


@part('entrance-canopy', width=10.0, depth=4.0, height=4.2, form='flat', columns=0)
def entrance_canopy(b, lk, rng, p):
    w, d, h = p['width'], p['depth'], p['height']
    if b.detail >= 2:
        lib.box_c(b, 0, -d / 2, h - 0.5, w, d, 0.5, 'plain', lk.trim_col, skip=())
        return
    n = p['columns'] or max(2, int(w / 6.5))
    if p['form'] == 'curved':
        cols = [(-w / 2 + 1.0 + (w - 2) * k / max(1, n - 1), -d + 0.9) for k in range(n)]
        lib.canopy_curved(b, -w / 2, -d, w / 2, 0.0, h, 1.8, lk, th=0.35, axis='x', columns=cols, col=lk.roof_col)
    else:
        lib.canopy_flat(b, -w / 2, -d, w / 2, 0.0, h, lk, th=0.5, columns=n, col=lk.roof_col, edge_col=lib.shade(lk.trim_col, 0.95), r=0.24)


@part('a-frame', width=10.0, length=18.0, height=10.0, glass_front=True, door=True, timber='#6b4a30', cross=True)
def a_frame(b, lk, rng, p):
    det = b.detail
    Wa, La, H = p['width'], p['length'], p['height']
    hw, zk = Wa / 2, 0.5
    y0, y1 = -La / 2, La / 2
    rs, rc = lk.roof_slot, lk.roof_col
    for sgn in (-1, 1):
        pts = [(sgn * hw, y0 - 0.9, zk), (0, y0 - 0.9, H), (0, y1 + 0.3, H), (sgn * hw, y1 + 0.3, zk)]
        if sgn > 0:
            pts = pts[::-1]
        U.F(b, pts, rs, rc, hint=(sgn * H, 0, hw))
        if det == 0:
            b.facing([(sgn * hw, y0 - 0.9, zk), (0, y0 - 0.9, H), (0, y0 - 0.9, H - 0.25), (sgn * hw, y0 - 0.9, zk - 0.25)], (0, -1, 0), 'plain-render', lib.shade(rc, 0.65))
    rseg = lib.Seg((hw, y1), (-hw, y1))
    U.F(b, [rseg.P(0, zk), rseg.P(Wa, zk), rseg.P(Wa / 2, H)], lk.wall_slot, lk.wall_col)
    fseg = lib.Seg((-hw, y0), (hw, y0))
    top_pts = [fseg.P(0.05, zk), fseg.P(Wa - 0.05, zk), fseg.P(Wa / 2, H - 0.05)]
    if p['glass_front']:
        if det < 2:
            b.face(top_pts, 'glass-curtain', lk.glass_col, mode='tile', scale=3.0)
        else:
            b.face(top_pts, 'plain', lk.glass_col)
    else:
        b.face(top_pts, lk.wall_slot, lk.wall_col, scale=U.tscale(lk.wall_slot, det))
    if det == 0:
        tcol = p['timber']
        for k in range(1, 6):
            u = Wa * k / 6
            h = zk + (H - zk) * (1 - abs(u - Wa / 2) / (Wa / 2))
            b.face([fseg.P(u - 0.07, zk, -0.1), fseg.P(u + 0.07, zk, -0.1), fseg.P(u + 0.07, h, -0.1), fseg.P(u - 0.07, h, -0.1)], 'timber', tcol)
        for k in range(1, 4):
            z = zk + (H - zk) * k / 4
            half = (Wa / 2) * (1 - (z - zk) / (H - zk))
            b.face([fseg.P(Wa / 2 - half, z - 0.07, -0.1), fseg.P(Wa / 2 + half, z - 0.07, -0.1), fseg.P(Wa / 2 + half, z + 0.07, -0.1), fseg.P(Wa / 2 - half, z + 0.07, -0.1)], 'timber', tcol)
        if p['door']:
            dw = clamp(Wa * 0.22, 1.6, 2.6)
            b.face([fseg.P(Wa / 2 - dw / 2, zk, -0.12), fseg.P(Wa / 2 + dw / 2, zk, -0.12), fseg.P(Wa / 2 + dw / 2, zk + 2.3, -0.12), fseg.P(Wa / 2 - dw / 2, zk + 2.3, -0.12)], 'timber', '#4b3426')
        if p['cross']:
            U.cross_finial(b, 0.0, y0 - 0.9, H, 2.8, '#e8e4d8')


def _cable(b, p0, p1, w=0.14, col='#aeb4ba'):
    """A thin stay cable: two crossed double-sided quads."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    h = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / h * w, dx / h * w
    q = [(p0[0] - nx, p0[1] - ny, p0[2]), (p0[0] + nx, p0[1] + ny, p0[2]), (p1[0] + nx, p1[1] + ny, p1[2]), (p1[0] - nx, p1[1] - ny, p1[2])]
    b.face(q, 'frame', col)
    b.face(q[::-1], 'frame', col)
    q2 = [(p0[0], p0[1], p0[2] - w), (p0[0], p0[1], p0[2] + w), (p1[0], p1[1], p1[2] + w), (p1[0], p1[1], p1[2] - w)]
    b.face(q2, 'frame', col)
    b.face(q2[::-1], 'frame', col)


@part('cable-stays', targets=[[10.0, 10.0, 8.0], [-10.0, 10.0, 8.0]], width=0.15)
def cable_stays(b, lk, rng, p):
    if b.detail >= 2:
        return
    for t in p['targets']:
        _cable(b, (0.0, 0.0, 0.0), (float(t[0]), float(t[1]), float(t[2])), p['width'] if b.detail == 0 else p['width'] * 1.6)


@part('cross-tower', height=40.0, width=2.6, arm_length=None, arm_height=0.82)
def cross_tower(b, lk, rng, p):
    th, tw = p['height'], p['width']
    col = lib.shade(lk.wall_col, 0.97)
    lib.box_c(b, 0, 0, 0, tw, tw, th, 'rough-concrete', col, skip=('bottom',), top_slot='roof-flat')
    al = p['arm_length'] or th * 0.2
    lib.box_c(b, 0, 0, th * p['arm_height'], al * 2 + tw, tw * 0.8, tw * 0.9, 'rough-concrete', col, skip=('bottom',), top_slot='roof-flat')
    lib.box_c(b, 0, 0, th, tw * 0.9, tw * 0.9, th * 0.06, 'rough-concrete', col, skip=('bottom',))


@part('membrane-roof', width_front=22.0, width_back=70.0, depth=60.0, eave=16.0, ridge=30.0, walls=True)
def membrane_roof(b, lk, rng, p):
    det = b.detail
    wf, W, D, hw_, H = p['width_front'], p['width_back'], p['depth'], p['eave'], p['ridge']
    y0, y1 = -D / 2, D / 2
    if p['walls']:
        poly = [(-wf / 2, y0), (wf / 2, y0), (W / 2, y1), (-W / 2, y1)]
        for e in lib.fp_polygon(poly).edges():
            ops = []
            if det <= 1 and e.length > 6 and not e.rear:
                ops = U.bay_ops(e.length, max(2, int(e.length / 5.5)), 0, None, 1.0, hw_ * 0.25, hw_ - 0.8, 'pointed', 'glass', 1.5, 0.3, 0, 0.0, False)
            U.wall(b, e.p0, e.p1, 0.0, hw_, lk, ops, lk.wall_slot, lk.wall_col, lk.trim_col)
    nx, ny = (10, 6) if det == 0 else (6, 4)
    grid = []
    for i in range(nx + 1):
        u = -1 + 2 * i / nx
        row = []
        for j in range(ny + 1):
            t = j / ny
            y = y0 + (y1 - y0) * t
            half = (wf + (W - wf) * t) / 2
            z = hw_ + (H - hw_) * (t ** 1.4) * (0.62 + 0.38 * (1 - u * u)) + 0.6 * (1 - abs(u))
            row.append((u * half, y, z))
        grid.append(row)
    lib.roof_shell(b, grid, 0.5, lk, slot='plain-render', col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.7), edge_col=lib.shade(lk.roof_col, 0.85), smooth=True)


@part('shell-roof', style='barrel', width=14.0, length=30.0, eave=7.0, rise=7.0, glazed_ends=True, walls=True)
def shell_roof(b, lk, rng, p):
    det = b.detail
    Wt, L, zw, rise = p['width'], p['length'], p['eave'], p['rise']
    hw = Wt / 2
    y0, y1 = -L / 2, L / 2
    if p['walls']:
        for e in lib.fp_rect(Wt, L).edges():
            if e.front or e.rear:
                continue
            ops = U.bay_ops(e.length, max(2, int(e.length / 5)), 0, None, 1.2, zw * 0.3, zw - 0.5, 'rect', 'glass', 1.0, 0.25, 0, 0.0, False) if det <= 1 else []
            U.wall(b, e.p0, e.p1, 0.0, zw, lk, ops, lk.wall_slot, lk.wall_col, lk.trim_col, plinth=0.4)
    nx, ny = (16, 8) if det == 0 else (8, 4)
    grid = []
    for i in range(nx + 1):
        u = -1 + 2 * i / nx
        row = []
        for j in range(ny + 1):
            t = j / ny
            y = y0 - 0.8 + (L + 1.6) * t
            x = u * (hw + 0.8)
            if p['style'] == 'barrel':
                z = zw + rise * math.sqrt(max(0.0, 1 - u * u)) * 0.98 + 0.1
            elif p['style'] == 'sail':
                z = zw + rise * (0.25 + 0.75 * t) * (1 - 0.55 * u * u) + 0.2
            else:
                z = zw + rise * (0.45 + 0.35 * math.sin(2 * math.pi * t * 1.5 + 1.3)) * (1 - 0.3 * u * u)
            row.append((x, y, z))
        grid.append(row)
    lib.roof_shell(b, grid, 0.5, lk, slot='metal-roof', col=lk.roof_col, under_col=lib.shade(lk.roof_col, 0.6), edge_col=lib.shade(lk.roof_col, 0.85))
    if p['glazed_ends']:
        for (yy, hint, jj) in ((y0, (0, -1, 0), 0), (y1, (0, 1, 0), ny)):
            pts = [(grid[i][jj][0], yy, max(zw, grid[i][jj][2] - 0.5)) for i in range(nx + 1)]
            poly = [(-hw - 0.8, yy, zw), (hw + 0.8, yy, zw)] + pts[::-1]
            if det < 2:
                b.facing(poly, hint, lk.glass_slot, lk.glass_col, mode='fit')
            else:
                b.facing(poly, hint, 'plain', lk.glass_col)


@part('fin-wall', length=24.0, height=12.0, fins=6, fin_depth=0.7, slits=True)
def fin_wall(b, lk, rng, p):
    L, h = p['length'], p['height']
    n = max(2, p['fins'])
    ops = U.bay_ops(L, n, 0, None, 0.7, h * 0.2, h * 0.92, 'rect', 'glass', 1.0, 0.45, 0, 0.0, False) if (p['slits'] and b.detail <= 1) else []
    seg = U.wall(b, (-L / 2, 0.0), (L / 2, 0.0), 0.0, h, lk, ops, 'rough-concrete', lk.wall_col, lk.trim_col)
    if b.detail <= 1:
        for k in range(n + 1):
            u = clamp(L * k / n, 0.4, L - 0.4)
            U.sbox(b, seg, u - 0.35, u + 0.35, 0.0, h + 0.6, p['fin_depth'], lib.shade(lk.wall_col, 0.93), 'rough-concrete', top=True)


@part('pylon', width=1.8, height=24.0, cross=True)
def pylon(b, lk, rng, p):
    w, h = p['width'], p['height']
    lib.box_c(b, 0, 0, 0, w, w, h, 'rough-concrete', lib.shade(lk.wall_col, 0.95), skip=('bottom',))
    lib.box_c(b, 0, 0, h, w + 0.5, w + 0.5, 0.35, 'roof-flat', lk.trim_col, skip=())
    if p['cross'] and b.detail <= 1:
        U.cross_finial(b, 0, 0, h + 0.35, clamp(h * 0.14, 2.4, 5.0), '#e8e4d8')


# ============================================================================================================ SITE / SHARED
@part('sign-board', width=6.5, height=2.6, board_colour='#2f5f8a')
def sign_board(b, lk, rng, p):
    lib.sign_board(b, 0.0, 0.0, 0.0, p['width'], p['height'], lk, 0.0, col=p['board_colour'])


@part('flagpole', height=8.0, flag_colour='#1b7a3d')
def flagpole(b, lk, rng, p):
    if b.detail == 0:
        U.flagpole(b, 0.0, 0.0, p['height'], p['flag_colour'])
    else:
        lib.cylinder(b, 0, 0, 0, p['height'], 0.08, n=4, slot='frame', col='#b8bcc0', top=True)


@part('statue-on-plinth', height=3.6, figure='#d9d6cc')
def statue_on_plinth(b, lk, rng, p):
    U.statue(b, 0.0, 0.0, p['height'], p['figure'])


@part('fountain', radius=2.4)
def fountain(b, lk, rng, p):
    r = p['radius']
    n = 12 if b.detail == 0 else 8
    lib.cylinder(b, 0, 0, 0, 0.6, r, n=n, slot='stone-blocks', col='#b9b4a8', top=False, smooth=False)
    if b.detail >= 2:
        return
    lib.cylinder(b, 0, 0, 0.55, 0.62, r * 0.88, n=n, slot='plain-render', col='#5f98b3', top=True, smooth=False)
    lib.cylinder(b, 0, 0, 0.6, 1.8, r * 0.1, n=6, slot='stone-blocks', col='#b9b4a8', r_top=r * 0.06, top=True)


@part('steps', width=5.0, rise=0.6, count=4, run=None)
def steps(b, lk, rng, p):
    n = max(1, p['count'] if b.detail == 0 else min(p['count'], 2))
    lib.steps(b, -p['width'] / 2, p['width'] / 2, 0.0, p['rise'], p['run'] or 0.38 * p['count'], n, 'paving', lk.stone_col)
