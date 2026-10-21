"""Core parts (lowest priority in the registry: any other parts file may override these ids).

Every part is `fn(b, look, rng, detail, at=(x, y, z), rot=0.0, **params)`. The local frame has its origin at `at` on the ground
(or where the part stands), +Y away from the camera, the front of the part towards -Y. `rot` is a yaw in degrees (counter-clockwise
from above). Sizes in metres, colours '#hex'. Parts honour detail 0/1/2 (LOD0/1/2): LOD2 is massing only.

  dome         radius=8 height=None profile=hemi|shallow|pointed|onion drum=0 drumRadius=None lantern=0 finial=0 colour material
               drumColour  -> a dome (optionally on a cylindrical drum) of base radius `radius`; at.z is the springing height.
  tower        width=6 depth=None height=20 cap=flat|hip|pyramid|gable|dome|cone|none capRise=None round=False taper=0 windows=ribbon
               windowRatio=0.4 storeys=None sides=None colour capColour material -> belfry, clock tower, lift core, plain tower.
  spire        baseWidth=3 height=18 shaftHeight=0 sides=8 colour finial=True -> slender pyramid/needle on an optional shaft.
  minaret      height=30 radius=1.1 balconies=2 style=pencil|square colour capColour -> simple minaret (fallback; mosque parts override).
  colonnade    length=20 count=8 height=5 radius=0.3 kind=round|square beamHeight=0.6 roofDepth=0 colour roofColour -> columns along x
               carrying a beam; roofDepth>0 adds a flat slab behind it (towards +Y) like a loggia or covered walk.
  portico      width=12 depth=4 height=7 columns=6 pediment=True steps=4 colour roofColour -> classical porch in front of a wall at y=0
               (it extends towards -Y).
  canopy       form=flat|curved width=20 depth=8 height=5 thickness=0.35 columns=0 rise=2 colour edgeColour axis=x -> a canopy centred
               on `at`; height is the underside of a flat canopy / the springing line of a curved one.
  steps        width=8 rise=1.2 run=2.4 count=6 colour -> a flight of steps against a wall at y=0 (rises towards +Y).
  sign-board   width=6 height=3 bottom=2.5 colour frameColour posts=True -> a BLANK sign board on posts (no lettering).
  tree         kind=palm|broadleaf|acacia|conifer height=8 count=1 spread=6 line=0 colour -> one tree, a scatter (count, spread radius)
               or a row (count along `line` metres).
  car          colour='#b8bcc2' count=1 spacing=2.8 yaw=0 -> a low-poly car; count>1 makes a parked row along x.
  lamp         height=7 count=1 spacing=20 -> street lamp(s) in a row along x.
  fence-wall   length=20 height=2.2 thickness=0.3 kind=wall|railing|palisade pillarEvery=0 colour points=None -> straight boundary
               along x, or a polyline `points` [[x,y],...] relative to `at`.
  gate         width=6 height=3.5 pillar=1.0 leaf=bars|solid|open|none arch=False colour leafColour -> two gate piers with lintel/arch.
  flag         height=10 colour='#1b7a43' count=1 spacing=4 -> flagpole(s) with a plain flag (colour band set via `colours`).
  water-tank   kind=elevated|ground radius=2 tankHeight=3 legHeight=6 legs=4 colour -> elevated cylinder on a steel frame, or ground tank.
  solar-panels rows=3 cols=6 panelWidth=1.7 panelDepth=1.0 tilt=15 gap=0.2 colour -> tilted panel array; set at.z to the roof height.
  control-tower height=40 style=round|faceted|square colour shaftRadius cabRadius cabColour bandColour -> simple airport control tower (fallback).
  jet-bridge   length=18 colour -> passenger bridge leaving a wall at y=0 towards +Y at floor height at.z (fallback).
  airliner     scale=1 colour tailColour -> low-poly twin-engine airliner, nose towards +Y (fallback).

GENERIC SHAPE PARTS (parts/_generic.py, geometry in lib/generic.py; full parameters with `python3 parts/list.py <id>`): any shape you can describe.
  prism        points | rect | radius+n, z0, height, topScale, topOffset, + mass-style windows/faces/pattern -> extrude a polygon, taper the top.
  revolve      profile [[r, z(, colour)]...], segments, arcade {from,to,count,width,height,sill,shape,depth} -> lathe: domes, drums, minarets, tanks.
  loft         sections [{z, rect|circle|ellipse|poly, cx, cy, rotDeg, scale}], curve -> skin between sections: tapers, flared legs, V-fins.
  sweep-path   section {rect|circle|poly}, points | arc, sag/bulge, closed, taper, twist -> cables, curved beams, ring beams, arches, rails.
  array        of {type, params}, mode line|arc|grid, count, ... -> repeat any part (masses too, when top level); vary numeric params.
  surface      kind folded|hypar|wave|dome-cap|conoid|fan|heights|points, width, depth, rise, thickness -> folded-plate and shell roofs.
  stand        start+end | centre+radius+startDeg+endDeg, rows, rise, run, tiers, under, canopy -> raked seating seen from outside.
"""
import copy
import math
import functools

import lib
from lib.facade import ROOF_SLOT, WALL_SLOT

from ._xform import Xform
from . import _generic


def _at3(at):
    at = tuple(at or (0.0, 0.0, 0.0))
    return tuple(float(v) for v in at) + (0.0,) * (3 - len(at))


def placed(fn):
    """Adapter: the public part signature is (b, look, rng, detail, at, rot, **params); the body is written in a local frame."""
    @functools.wraps(fn)
    def wrapper(b, look, rng, detail, at=(0.0, 0.0, 0.0), rot=0.0, **params):
        return fn(Xform.make(b, _at3(at), rot), look, rng, detail, **params)
    return wrapper


def _num(v, default, lo=None, hi=None):
    try:
        v = float(v)
    except (TypeError, ValueError):
        v = float(default)
    if v != v or v in (float('inf'), float('-inf')):
        v = float(default)
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


def _lk(look, colour=None, roofColour=None, material=None, roofMaterial=None, trim=None):
    """A copy of `look` with per-part overrides (wall colour/material, roof colour/material)."""
    lk = copy.copy(look)
    if colour:
        lk.wall_col = colour
        lk.trim_col = trim or lib.shade(colour, 1.06)
    if material:
        lk.wall_slot = WALL_SLOT.get(material, material if material in lib.slots()['slots'] else lk.wall_slot)
    if roofColour:
        lk.roof_col = roofColour
    if roofMaterial:
        lk.roof_slot = ROOF_SLOT.get(roofMaterial, roofMaterial if roofMaterial in lib.slots()['slots'] else lk.roof_slot)
    return lk


# ---------------------------------------------------------------------------------------------------------------- roofs
@placed
def dome(b, look, rng, detail, radius=8.0, height=None, profile='hemi', drum=0.0, drumRadius=None, lantern=0.0, finial=0.0,
         colour=None, material=None, drumColour=None):
    r = _num(radius, 8, 0.5, 60)
    lk = _lk(look, roofColour=colour, roofMaterial=material)
    b.section('dome')
    lib.dome(b, 0, 0, 0, r, lk, height=_num(height, 0, 0, 80) or None, profile=profile if profile in ('hemi', 'shallow', 'pointed', 'onion') else 'hemi',
             drum=_num(drum, 0, 0, 40), drum_r=_num(drumRadius, 0, 0, 80) or None, drum_col=drumColour or look.wall_col,
             lantern=_num(lantern, 0, 0, 20), finial=_num(finial, 0, 0, 20))


@placed
def tower(b, look, rng, detail, width=6.0, depth=None, height=20.0, cap='flat', capRise=None, round=False, taper=0.0, windows='ribbon',
          windowRatio=0.4, storeys=None, sides=None, colour=None, capColour=None, material=None):
    w = _num(width, 6, 0.8, 60)
    d = _num(depth, w, 0.8, 60)
    h = _num(height, 20, 2, 140)
    lk = _lk(look, colour, capColour, material)
    b.section('tower')
    lib.tower(b, 0, 0, 0, w, d, h, lk, storeys=int(storeys) if storeys else None, windows=windows, cap=cap, cap_rise=_num(capRise, 0, 0, 80) or None,
              round_=bool(round), taper=_num(taper, 0, 0, 0.6), ratio=_num(windowRatio, 0.4, 0, 0.95), sides=int(sides) if sides else None)


@placed
def spire(b, look, rng, detail, baseWidth=3.0, height=18.0, shaftHeight=0.0, sides=8, colour=None, finial=True):
    w = _num(baseWidth, 3, 0.4, 30)
    h = _num(height, 18, 1, 80)
    sh = _num(shaftHeight, 0, 0, 60)
    n = 4 if detail >= 2 else int(_num(sides, 8, 3, 16))
    n = min(n, 6) if detail == 1 else n
    col = colour or look.roof_col
    b.section('spire')
    z = 0.0
    if sh > 0:
        lib.cylinder(b, 0, 0, 0, sh, w / 2, n=n, slot=look.wall_slot, col=colour or look.wall_col, smooth=False, top=False)
        z = sh
    lib.cylinder(b, 0, 0, z, z + h, w / 2, n=n, slot=look.roof_slot, col=col, r_top=0.0, smooth=False, top=False)
    if finial and detail < 2:
        lib.cylinder(b, 0, 0, z + h, z + h + max(0.8, h * 0.08), 0.05, n=4, slot='frame', col=look.metal_col, r_top=0.02)


@placed
def minaret(b, look, rng, detail, height=30.0, radius=1.1, balconies=2, style='pencil', colour=None, capColour=None):
    h = _num(height, 30, 6, 120)
    r = _num(radius, 1.1, 0.3, 6)
    n = {0: 16, 1: 10, 2: 6}[detail]
    col = colour or look.trim_col
    cap = capColour or look.roof_col
    b.section('minaret')
    sq = style == 'square'
    nb = int(_num(balconies, 2, 0, 5))
    base_h = h * 0.12
    if sq:
        lib.box_c(b, 0, 0, 0, r * 2.4, r * 2.4, h * 0.82, look.wall_slot, col, skip=('bottom',))
    else:
        lib.cylinder(b, 0, 0, 0, base_h, r * 1.5, n=n, slot=look.wall_slot, col=col, r_top=r * 1.2, top=False)
        lib.cylinder(b, 0, 0, base_h, h * 0.82, r * 1.2, n=n, slot=look.wall_slot, col=col, r_top=r * 0.85, top=False)
    if detail < 2:
        for k in range(nb):
            zb = h * (0.5 + 0.3 * k / max(1, nb)) if nb else 0
            lib.cylinder(b, 0, 0, zb, zb + 0.35, r * 1.9, n=n, slot=look.wall_slot, col=lib.shade(col, 0.92), top=True, bottom=True)
            if detail == 0:
                lib.cylinder(b, 0, 0, zb + 0.35, zb + 1.2, r * 1.75, n=n, slot=look.wall_slot, col=lib.shade(col, 0.96), top=False, bottom=False)
    zt = h * 0.82
    lib.cylinder(b, 0, 0, zt, h, r * 0.9, n=n, slot=look.roof_slot, col=cap, r_top=0.0, top=False)
    if detail < 2:
        lib.cylinder(b, 0, 0, h, h + max(1.2, h * 0.06), 0.06, n=4, slot='frame', col=look.metal_col, r_top=0.02)


# --------------------------------------------------------------------------------------------------------- porches, arcades
@placed
def colonnade(b, look, rng, detail, length=20.0, count=8, height=5.0, radius=0.3, kind='round', beamHeight=0.6, roofDepth=0.0,
              colour=None, roofColour=None):
    L = _num(length, 20, 1, 120)
    lk = _lk(look, colour, roofColour)
    n = int(_num(count, 8, 2, 40))
    h = _num(height, 5, 2, 30)
    b.section('colonnade')
    lib.colonnade(b, (-L / 2, 0), (L / 2, 0), 0, h, n, lk, r=_num(radius, 0.3, 0.1, 2), kind=kind if kind in ('round', 'square') else 'round',
                  beam_h=_num(beamHeight, 0.6, 0.1, 3))
    rd = _num(roofDepth, 0, 0, 20)
    if rd > 0:
        lib.box(b, -L / 2 - 0.2, 0, h, L / 2 + 0.2, rd, h + 0.35, 'roof-flat', lk.roof_col, skip=())


@placed
def portico(b, look, rng, detail, width=12.0, depth=4.0, height=7.0, columns=6, pediment=True, steps=4, colour=None, roofColour=None):
    lk = _lk(look, colour, roofColour)
    b.section('portico')
    lib.portico(b, 0, 0, 0, _num(width, 12, 2, 60), _num(depth, 4, 1, 20), _num(height, 7, 2, 30), lk, cols=int(_num(columns, 6, 2, 16)),
                pediment=bool(pediment), steps_n=int(_num(steps, 4, 0, 10)))


@placed
def canopy(b, look, rng, detail, form='flat', width=20.0, depth=8.0, height=5.0, thickness=0.35, columns=0, rise=2.0, colour=None,
           edgeColour=None, axis='x'):
    w, d = _num(width, 20, 1, 120), _num(depth, 8, 1, 60)
    z = _num(height, 5, 2, 40)
    lk = _lk(look)
    cols = int(_num(columns, 0, 0, 40))
    b.section('canopy')
    x0, y0, x1, y1 = -w / 2, -d / 2, w / 2, d / 2
    if form == 'curved':
        pts = None
        if cols:
            pts = [(x0 + 0.8 + (w - 1.6) * k / max(1, cols - 1), y0 + 0.8) for k in range(cols)] if axis == 'x' else \
                  [(x0 + 0.8, y0 + 0.8 + (d - 1.6) * k / max(1, cols - 1)) for k in range(cols)]
        lib.canopy_curved(b, x0, y0, x1, y1, z, _num(rise, 2, 0.3, 20), lk, th=_num(thickness, 0.3, 0.1, 2), axis='y' if axis == 'y' else 'x',
                          columns=pts, col=colour)
    else:
        th = _num(thickness, 0.35, 0.1, 3)
        top_col = colour or lk.roof_col
        # one big slab: coarse texture tiling (scale) so a 100 m canopy does not cost hundreds of tile-cut triangles
        lib.box(b, x0, y0, z - th, x1, y1, z, lk.wall_slot, edgeColour or lib.shade(colour or lk.trim_col, 0.95), top_slot='roof-flat', top_col=top_col,
                skip=(), scale=3.0 if detail >= 1 else 2.0)
        if cols:
            for k in range(cols):
                lib.column(b, x0 + 0.8 + (w - 1.6) * k / max(1, cols - 1), y0 + 0.9, 0, z - th, 0.22, lk, 'round', capital=False, col=lk.metal_col)


@placed
def steps(b, look, rng, detail, width=8.0, rise=1.2, run=2.4, count=6, colour=None):
    w = _num(width, 8, 0.8, 80)
    n = 2 if detail >= 2 else int(_num(count, 6, 1, 20))
    b.section('steps')
    lib.steps(b, -w / 2, w / 2, 0, _num(rise, 1.2, 0.1, 10), _num(run, 2.4, 0.3, 30), n, 'paving', colour or look.stone_col)


@placed
def sign_board(b, look, rng, detail, width=6.0, height=3.0, bottom=2.5, colour='#2f6b4f', frameColour='#b8bcc0', posts=True):
    if detail >= 2:
        return
    b.section('sign-board')
    with b.site():
        lib.sign_board(b, 0, 0, _num(bottom, 2.5, 0, 30), _num(width, 6, 0.5, 40), _num(height, 3, 0.3, 20), look, 0.0, bool(posts), colour or '#2f6b4f',
                       frameColour or '#b8bcc0')


# ---------------------------------------------------------------------------------------------------------------- site items
@placed
def tree(b, look, rng, detail, kind=None, height=8.0, count=1, spread=6.0, line=0.0, colour=None):
    kind = kind or look.tree
    if kind in (None, 'none') or detail >= 2:
        return
    n = int(_num(count, 1, 1, 60))
    h = _num(height, 8, 1.5, 40)
    sp, ln = _num(spread, 6, 0, 80), _num(line, 0, 0, 200)
    r = rng
    b.section('tree')
    for k in range(n):
        if n == 1:
            x = y = 0.0
        elif ln > 0:
            x, y = -ln / 2 + ln * k / (n - 1), r.uniform(-0.4, 0.4)
        else:
            a, d = r.uniform(0, 2 * math.pi), sp * math.sqrt(r.random())
            x, y = d * math.cos(a), d * math.sin(a)
        lib.tree(b, kind, x, y, h * r.uniform(0.85, 1.15), r, look, colour)


@placed
def car(b, look, rng, detail, colour=None, count=1, spacing=2.8, yaw=0.0):
    if detail >= 2:
        return
    n = int(_num(count, 1, 1, 80))
    cols = ['#b8bcc2', '#2f3b52', '#8b2d2d', '#e6e6e2', '#3d4a3f', '#c9a66b']
    b.section('car')
    for k in range(n):
        x = (k - (n - 1) / 2) * _num(spacing, 2.8, 0.2, 10)
        lib.car(b, x, 0, math.radians(_num(yaw, 0, -360, 360) + 90), colour or cols[(k + int(rng.random() * 6)) % len(cols)], rng)


@placed
def lamp(b, look, rng, detail, height=7.0, count=1, spacing=20.0):
    if detail >= 1:
        return
    n = int(_num(count, 1, 1, 60))
    b.section('lamp')
    for k in range(n):
        lib.lamp(b, (k - (n - 1) / 2) * _num(spacing, 20, 2, 80), 0, _num(height, 7, 2, 20), look)


@placed
def fence_wall(b, look, rng, detail, length=20.0, height=2.2, thickness=0.3, kind='wall', pillarEvery=0.0, colour=None, points=None):
    h = _num(height, 2.2, 0.3, 12)
    t = _num(thickness, 0.3, 0.05, 3)
    col = colour or look.stone_col
    if points:
        pts = [(float(p[0]), float(p[1])) for p in points if isinstance(p, (list, tuple)) and len(p) >= 2][:60]
    else:
        L = _num(length, 20, 0.5, 300)
        pts = [(-L / 2, 0.0), (L / 2, 0.0)]
    b.section('fence-wall')
    with b.site():
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            L = math.hypot(x1 - x0, y1 - y0)
            if L < 0.2:
                continue
            if kind == 'wall' or detail >= 2:
                lib.beam(b, (x0, y0), (x1, y1), 0, h, t, look.wall_slot, col, skip=('bottom',))
            else:
                n = max(2, int(L / (0.9 if kind == 'palisade' else 2.2)) + 1)
                for k in range(n):
                    px, py = x0 + (x1 - x0) * k / (n - 1), y0 + (y1 - y0) * k / (n - 1)
                    lib.cylinder(b, px, py, 0, h, t * 0.3 if kind == 'railing' else 0.07, n=4, slot='frame', col=col, top=True)
                if kind == 'railing':
                    lib.beam(b, (x0, y0), (x1, y1), h - 0.12, h, t * 0.4, 'frame', col)
                    lib.beam(b, (x0, y0), (x1, y1), 0.3, 0.42, t * 0.4, 'frame', col)
        pe = _num(pillarEvery, 0, 0, 100)
        if pe > 0 and detail < 2:
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                L = math.hypot(x1 - x0, y1 - y0)
                for k in range(int(L / pe) + 1):
                    f = min(1.0, k * pe / L) if L else 0
                    lib.box_c(b, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, 0, t * 2.2, t * 2.2, h + 0.35, look.wall_slot, lib.shade(col, 1.05), skip=('bottom',))


@placed
def gate(b, look, rng, detail, width=6.0, height=3.5, pillar=1.0, leaf='bars', arch=False, colour=None, leafColour='#2d3033'):
    w = _num(width, 6, 1, 40)
    h = _num(height, 3.5, 1.5, 15)
    p = _num(pillar, 1.0, 0.3, 4)
    col = colour or look.stone_col
    b.section('gate')
    for sx in (-1, 1):
        lib.box_c(b, sx * (w / 2 + p / 2), 0, 0, p, p, h + 0.5, look.wall_slot, col, skip=('bottom',))
        if detail < 2:
            lib.box_c(b, sx * (w / 2 + p / 2), 0, h + 0.5, p * 1.25, p * 1.25, 0.3, look.wall_slot, lib.shade(col, 1.05))
    if arch and detail < 2:
        lib.box(b, -w / 2 - p, -p / 2, h, w / 2 + p, p / 2, h + 0.7, look.wall_slot, col)
    elif detail < 2 and leaf == 'none':
        pass
    if leaf in ('bars', 'solid') and detail < 2:
        if leaf == 'solid' or detail == 1:
            lib.box(b, -w / 2, -0.06, 0.1, w / 2, 0.06, h - 0.2, 'metal-cladding', leafColour, skip=())
        else:
            n = max(4, int(w / 0.2))
            for k in range(n + 1):
                x = -w / 2 + w * k / n
                lib.cylinder(b, x, 0, 0.05, h - 0.2, 0.035, n=4, slot='frame', col=leafColour, top=True)
            lib.box(b, -w / 2, -0.04, h - 0.45, w / 2, 0.04, h - 0.3, 'frame', leafColour)
            lib.box(b, -w / 2, -0.04, 0.3, w / 2, 0.04, 0.45, 'frame', leafColour)


@placed
def flag(b, look, rng, detail, height=10.0, colour='#1b7a43', count=1, spacing=4.0, colours=None):
    if detail >= 1:
        return
    n = int(_num(count, 1, 1, 20))
    cl = list(colours) if colours else [colour]
    b.section('flag')
    with b.site():
        for k in range(n):
            x, h = (k - (n - 1) / 2) * _num(spacing, 4, 1, 20), _num(height, 10, 2, 60)
            c = cl[k % len(cl)]
            lib.cylinder(b, x, 0, 0, h, 0.07, n=5, slot='frame', col='#b8bcc0', r_top=0.05, top=True)
            pts = [(x + 0.05, 0, h - 1.6), (x + 2.2, 0, h - 1.5), (x + 2.2, 0, h - 0.2), (x + 0.05, 0, h)]
            b.facing(pts, (0, -1, 0), 'plain', c)
            b.facing(pts, (0, 1, 0), 'plain', lib.shade(c, 0.85))


@placed
def water_tank(b, look, rng, detail, kind='elevated', radius=2.0, tankHeight=3.0, legHeight=6.0, legs=4, colour=None):
    r = _num(radius, 2, 0.5, 15)
    th = _num(tankHeight, 3, 0.5, 20)
    col = colour or '#8f979e'
    b.section('water-tank')
    n = {0: 16, 1: 10, 2: 6}[detail]
    if kind == 'ground':
        lib.cylinder(b, 0, 0, 0, th, r, n=n, slot='metal-cladding', col=col, top=True)
        return
    lh = _num(legHeight, 6, 1, 40)
    nl = int(_num(legs, 4, 3, 8))
    for k in range(nl):
        a = 2 * math.pi * k / nl + math.pi / nl
        x, y = r * 0.8 * math.cos(a), r * 0.8 * math.sin(a)
        lib.cylinder(b, x, y, 0, lh, 0.12, n=4, slot='frame', col='#6e7378', top=False)
    if detail < 2:
        lib.cylinder(b, 0, 0, lh - 0.1, lh, r * 0.95, n=n, slot='frame', col='#6e7378', top=True, bottom=True)
        if detail == 0:
            lib.cylinder(b, 0, 0, lh * 0.5, lh * 0.5 + 0.1, r * 0.8, n=n, slot='frame', col='#6e7378', top=True, bottom=True)
    lib.cylinder(b, 0, 0, lh, lh + th, r, n=n, slot='metal-cladding', col=col, r_top=r, top=True)
    if detail < 2:
        lib.cylinder(b, 0, 0, lh + th, lh + th + 0.35, r * 0.5, n=max(6, n // 2), slot='metal-cladding', col=lib.shade(col, 0.9), r_top=r * 0.4, top=True)


@placed
def solar_panels(b, look, rng, detail, rows=3, cols=6, panelWidth=1.7, panelDepth=1.0, tilt=15.0, gap=0.2, colour='#2c3e57'):
    nr, nc = int(_num(rows, 3, 1, 30)), int(_num(cols, 6, 1, 60))
    pw, pd = _num(panelWidth, 1.7, 0.5, 4), _num(panelDepth, 1.0, 0.4, 3)
    g = _num(gap, 0.2, 0, 3)
    t = math.radians(_num(tilt, 15, 0, 60))
    b.section('solar-panels')
    rowpitch = pd * math.cos(t) + 1.2 * math.sin(t) + 0.4
    W = nc * (pw + g)
    for i in range(nr):
        y = (i - (nr - 1) / 2) * rowpitch * (1.0 + 0.0)
        if detail >= 2:
            continue
        if detail == 1:
            segs = [(-W / 2, W / 2)]
        else:
            segs = [(-W / 2 + k * (pw + g), -W / 2 + k * (pw + g) + pw) for k in range(nc)]
        for (x0, x1) in segs:
            a = [(x0, y - pd / 2 * math.cos(t), 0.4 - pd / 2 * math.sin(t) + 0.3), (x1, y - pd / 2 * math.cos(t), 0.4 - pd / 2 * math.sin(t) + 0.3),
                 (x1, y + pd / 2 * math.cos(t), 0.4 + pd / 2 * math.sin(t) + 0.3), (x0, y + pd / 2 * math.cos(t), 0.4 + pd / 2 * math.sin(t) + 0.3)]
            b.facing(a, (0, -0.5, 1.0), 'glass-ribbon', colour, mode='tile')
        if detail == 0:
            lib.box(b, -W / 2, y - 0.05, 0, W / 2, y + 0.05, 0.4, 'frame', '#7d8286')


# ---------------------------------------------------------------------------------------------------------- airport fallbacks
@placed
def control_tower(b, look, rng, detail, height=40.0, style='round', colour=None, shaftRadius=None, cabRadius=None, cabColour=None, bandColour=None):
    h = _num(height, 40, 10, 100)
    col = colour or look.stone_col
    n = {0: 14, 1: 10, 2: 6}[detail]
    cab_h = max(3.6, h * 0.1)
    shaft = h - cab_h - 2.2
    r0 = _num(shaftRadius, max(2.4, h * 0.06), 0.5, 8)
    b.section('control-tower')
    if style == 'square':
        lib.box_c(b, 0, 0, 0, r0 * 1.8, r0 * 1.8, shaft, 'rough-concrete', col)
    else:
        lib.cylinder(b, 0, 0, 0, shaft, r0, n=n if style == 'round' else 6, slot='rough-concrete', col=col, r_top=r0 * 0.75, top=False, smooth=style == 'round')
    rt = r0 * 0.75
    cr = _num(cabRadius, rt * 1.9, 0.8, 10)
    lib.cylinder(b, 0, 0, shaft, shaft + 2.2, rt, n=n, slot='rough-concrete', col=bandColour or lib.shade(col, 0.85), r_top=cr, top=False)
    lib.cylinder(b, 0, 0, shaft + 2.2, shaft + 2.2 + cab_h, cr, n=n, slot='glass-ribbon', col=cabColour or look.glass_col, r_top=cr * 1.2, top=False)
    lib.cylinder(b, 0, 0, shaft + 2.2 + cab_h, shaft + 2.8 + cab_h, cr * 1.25, n=n, slot='plain-render', col=lib.shade(col, 0.9), r_top=cr * 1.15, top=True)
    if detail < 2:
        lib.cylinder(b, 0, 0, h + 0.6, h + 0.6 + h * 0.15, 0.1, n=4, slot='frame', col='#5a5f64', r_top=0.04)


@placed
def jet_bridge(b, look, rng, detail, length=18.0, colour='#c9ced1'):
    if detail >= 2:
        return
    L = _num(length, 18, 6, 60)
    b.section('jet-bridge')
    with b.site():
        floor = getattr(b, 'at', (0, 0, 0))[2]   # at.z is the floor height the bridge leaves from; the support reaches down to the apron
        lib.obox(b, 0, L / 2, 0, 2.7, L, 2.7, 0.0, 'plain', colour, top_col=lib.shade(colour, 1.08))
        if detail == 0:
            for sgn in (-1, 1):
                pts = [(sgn * 1.36, 3, 1.0), (sgn * 1.36, L - 2, 1.0), (sgn * 1.36, L - 2, 2.1), (sgn * 1.36, 3, 2.1)]
                b.facing(pts, (sgn, 0, 0), 'glass-ribbon', '#cfd8dd', mode='tile')
            lib.cylinder(b, 0, 1.2, -0.2, 3.0, 2.0, n=10, slot='plain', col=lib.shade(colour, 0.9))
            lib.cylinder(b, 0, L - 0.6, -0.1, 2.9, 1.7, n=8, slot='plain', col=lib.shade(colour, 0.85))
        if floor > 0.5:
            lib.cylinder(b, 0, L - 3.0, -floor, 0.0, 0.25, n=5, slot='frame', col='#6e7378', top=False)
            lib.obox(b, 0, L - 3.0, -floor, 1.6, 0.9, 0.4, 0.0, 'plain', '#3a3d41')


@placed
def airliner(b, look, rng, detail, scale=1.0, colour='#eceff1', tailColour='#2f6b4f'):
    if detail >= 2:
        return
    s = _num(scale, 1, 0.3, 3)
    n = 10 if detail == 0 else 6
    b.section('airliner')
    with b.site():
        stations = [(-17.5, 0.35), (-14, 1.0), (-8, 1.9), (-2, 2.0), (8, 2.0), (14, 1.9), (17, 1.4), (18.7, 0.9), (19.2, 0.0)]
        if detail == 1:
            stations = [stations[0], stations[2], stations[4], stations[6], stations[8]]
        grid = []
        for k in range(n + 1):
            a = 2 * math.pi * k / n
            grid.append([(r * math.cos(a) * s, ly * s, (2.6 + r * math.sin(a) * 0.95) * s) for ly, r in stations])
        b.shared_grid(grid, 'plain', colour, smooth=True, wrap=True)
        for sx in (-1, 1):
            pts = [(sx * 1.6 * s, 5.5 * s, 2.2 * s), (sx * 16.5 * s, -4.0 * s, 2.6 * s), (sx * 16.5 * s, -7.0 * s, 2.6 * s), (sx * 1.6 * s, -1.5 * s, 2.2 * s)]
            b.facing(pts, (0, 0, 1), 'plain', lib.shade(colour, 0.95))
            b.facing(pts, (0, 0, -1), 'plain', lib.shade(colour, 0.7))
            if detail == 0:
                lib.cylinder(b, sx * 6.2 * s, 2.5 * s, 1.3 * s, 1.3 * s + 0.01, 0.9 * s, n=8, slot='plain', col=lib.shade(colour, 0.78))
        fin = [(0, -12.5 * s, 4.0 * s), (0, -18.6 * s, 4.0 * s), (0, -19.2 * s, 10.5 * s), (0, -15.6 * s, 10.5 * s)]
        b.facing(fin, (1, 0, 0), 'plain', tailColour)
        b.facing(fin, (-1, 0, 0), 'plain', tailColour)
        for gx, gy in ((0.0, 13.0), (-2.7, -1.2), (2.7, -1.2)):
            lib.cylinder(b, gx * s, gy * s, 0.0, 1.9 * s, 0.25 * s, n=4, slot='plain', col='#2b2d30', top=False, smooth=False)


PARTS = {
    'dome': dome, 'tower': tower, 'spire': spire, 'minaret': minaret, 'colonnade': colonnade, 'portico': portico, 'canopy': canopy,
    'steps': steps, 'sign-board': sign_board, 'tree': tree, 'car': car, 'lamp': lamp, 'fence-wall': fence_wall, 'gate': gate,
    'flag': flag, 'water-tank': water_tank, 'solar-panels': solar_panels, 'control-tower': control_tower, 'jet-bridge': jet_bridge,
    'airliner': airliner,
}

PARTS.update(_generic.PARTS)
PART_DOC = _generic.PART_DOC
