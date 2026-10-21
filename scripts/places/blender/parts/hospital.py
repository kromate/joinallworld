"""Parts from the hospital / campus-block / civic-palace / civic-small / museum-theatre archetypes, as placeable pieces.

Every part is `fn(b, look, rng, detail, at=(x, y, z), rot=0.0, **params)`; the local frame has its origin at `at` (on the ground, or where the
part stands), +Y away from the camera and the FRONT of the part towards -Y; `rot` is a yaw in degrees (counter-clockwise from above).
Sizes are metres, colours '#hex', angles degrees. `colour` overrides the look's wall colour, `roofColour` its roof colour, `trimColour` its
trim colour. All parts honour detail 0/1/2 (LOD2 = massing only, most small details dropped) and cost about 100 to 1500 triangles at LOD0.
Parts that run along a wall are centred on x = 0 and sit against a wall at y = 0, reaching out towards -Y (like the core `portico`).
Parts that are whole little buildings or towers are centred on the origin.

SMALL-BUILDING PARTS (hospital, school, police, post office, radio)
  red-cross-plate   size=2.4 colour='#c8242b' plateColour='#f4f4f1' facing=front|back|left|right|up
                    plain red cross on a white square plate (no lettering) centred on `at`; vertical plates face the named side
  ambulance         colour='#f1f1ee' stripeColour='#c8362f' heading=90 scale=1
                    low-poly white ambulance van (red side stripes, blue roof light); heading = direction of travel in degrees from +X
  ambulance-bay     width=12 depth=5.5 height=3.8 columns=3 colour roofColour vans=2 marking=True
                    flat canopy standing against a wall at y=0 on columns, kerb stripe and 0-3 ambulances beneath
  helipad           radius=6.5 colour='#8c9096' markColour='#e8e8e2' ringColour='#d9c13a' ground=False
                    round pad with the H mark and a ring; at.z = the roof height it stands on (ground=True: a site pad)
  road-sign-pylon   width=3 height=2.4 bottom=2 colour='#f4f4f1' cross=True
                    blank board on two posts, optionally carrying a red cross (the hospital road sign)
  covered-walkway   length=14 width=2.6 height=3 colour roofColour
                    flat-roofed walk on posts running along +X (rotate to link wings); at = the centre of its start
  lean-to-veranda           length=20 depth=2.4 eaveHeight=3 attachHeight=4.2 post=square|round postEvery=3 railHeight=0 flat=False colour roofColour
                    lean-to veranda along a wall (colonial clinics, schools, police stations)
  gallery           length=24 depth=2.4 storeyHeight=3.6 wallTop=7.6 colour railColour
                    two-level veranda: posts below, railed gallery above, lean-to roof (African school blocks, colonial houses)
  canopy-fascia   width=10 depth=5 height=4 thickness=0.45 columns=2 round=True colour roofColour
                    flat entrance canopy with a deep fascia on 0..n columns; height is the underside
  roof-monitor      length=12 width=2.4 height=1.2 colour roofColour
                    ridge ventilation clerestory (pavilion hospital wards); at.z = ridge height, long axis along X
  brick-stack           height=14 radius=0.9 colour='#a9573e'
                    brick incinerator / boiler stack, tapering
  stair-tower       width=4.6 depth=4.2 height=3.4 colour roofColour
                    stair / lift overrun on a roof with a dark window panel on its front
  roof-tank         radius=1.4 height=1.7 colour='#2d5a3d'
                    cylindrical water tank on a low steel stand, for roofs (at.z = roof height)
  roof-board         width=10 height=1.5 colour='#f2f0e8'
                    blank board on two legs along a roof edge
  guard-kiosk             width=2.4 depth=2.2 height=2.6 colour='#c8362f' roofColour='#d8d8d4'
                    guard booth / small kiosk with a window
  pickup            colour='#e8e8e4' heading=0
                    patrol pickup truck (police)
  umbrella-group  count=3 spread=6 colours=['#d84c3a','#3a7bd8','#e8b83a'] radius=1.5
                    market umbrellas / polling-day shades scattered in a radius
  shed-shelter      width=8 depth=5 height=2.8 colour roofColour
                    open waiting shed: four posts, a flat-pitched metal roof

ARCHITECTURAL PARTS (campus, civic, colonial, Islamic, Hausa)
  clock-tower-square       width=6 height=24 cap=hip|flat|spire|gable|dome|pyramid capRise=None clockRadius=None clock=True belfry=True colour trimColour
                    capColour finial=0 windows=punched|arched|ribbon
                    square tower: windows, belfry louvres, clock faces on all four sides, quoins, cap
  turret-conical            radius=1.1 height=12 coneHeight=3.4 sides=8 colour capColour
                    round / octagonal corner turret with a conical cap (coneHeight=0: plain flat top with a ring)
  gatehouse-arched         width=12 depth=7 height=16 archWidth=4.4 archSpring=4 pointed=True turrets=4 crenellated=True spireHeight=0 colour roofColour
                    gothic / collegiate gatehouse with an arched portal in its front face (y=0), corner turrets and merlons; body reaches +Y
  arch-portal       width=10 height=7 depth=0.6 archWidth=4.4 springHeight=3.2 pointed=False colour
                    a wall panel with one arched opening backed by dark glazing (front face at y=0, body behind it)
  iwan              width=12 height=18 depth=3 archRatio=0.62 colour accentColour
                    tall rectangular portal frame with a big pointed arch (Islamic entrance), flat cap and an accent band
  zaure-gatehouse   width=11 depth=5 height=7.5 archWidth=5.5 horns=True relief=True colour trimColour
                    Hausa entrance hall block: round arch, crenellated top, four corner horn pinnacles, relief squares
  zankwaye-pinnacle          height=3.4 width=1.1 style=horn|ball|spike colour
                    corner horn ('zankwaye') or small finial standing on a parapet
  merlon-wall  length=20 height=0.9 mHeight=0.7 pitch=2 thickness=0.4 colour trimColour pinnacles=False relief=False
                    parapet wall with merlons (and horn pinnacles at both ends / a relief band on the front); at.z = the wall-top level
  stepped-buttresses      length=20 height=9 pitch=4 width=0.7 proud=0.7 colour='#c8c0b0'
                    stepped gothic buttresses against a wall
  fin-row           length=20 height=10 pitch=1.2 finWidth=0.12 proud=0.5 colour='#cfc8b8'
                    vertical brise-soleil fins on a facade
  balcony-bands     length=20 floors=3 storeyHeight=3.6 proud=1.3 rail=True railHeight=0.9 colour
                    projecting balcony / access-gallery slabs on every floor of a wall (at.z = first slab height offset 0)
  pilotis-row       length=30 height=4 radius=0.36 pitch=5 colour
                    a row of slender round columns (open ground floor)
  arcade-bays            length=24 depth=2.6 springHeight=2.6 topHeight=3.8 bayWidth=3.6 pierWidth=0.7 shape=round|pointed|horseshoe colour
                    open arcade / cloister in front of a wall: piers, arches, deck
  loggia            length=30 depth=4 height=5 radius=0.35 pitch=5 kind=round|square colour roofColour baseHeight=0
                    continuous colonnade with an entablature and a flat roof in front of a wall
  portico-pedimented width=14 depth=5.5 height=8 columns=6 pediment=True steps=7 kind=round|square colour entabHeight=0.9 baseHeight=1
                    giant-order portico with a REAL front pediment (triangle facing -Y) and steps, in front of a wall at y=0
  dome-colonnaded   radius=8 drum=5 colonnade=True profile=hemi|shallow|pointed|onion lantern=3 finial=2 colour drumColour baseSquare=True
                    dome on a drum ringed by slim columns (parliament / capitol), with a square base plinth
  corner-tower-domed height=22 radius=1.4 sides=8 balconyHeight=2 colour domeColour finial=0.8
                    slender tower with a balcony ring and an onion dome (palaces, minaret-like corner towers)
  setback-tower     width=28 depth=24 height=20 tiers=3 shrink=0.72 tierHeight=8 spireHeight=14 colour trimColour windows=ribbon|punched bay=4.6
                    stepped Soviet / art-deco tower: tiers, cornices, pilaster strips and a spire
  balustrade        length=20 height=1.0 postEvery=2.4 colour='#e8e4da'
                    railing of posts with top and bottom rails
  lattice-mast      height=60 baseWidth=3.6 topWidth=0.8 panels=10 colour='#c8362f' colour2='#f2f2ee'
                    red-and-white lattice radio mast with bracing (radio stations)
  pillar-box        colour='#b3262b'
                    red cast-iron pillar box

MUSEUM / THEATRE PARTS
  sail-shell        length=40 width=18 height=26 mirror=-1|1 colour
                    one opera-house sail (quarter-ellipse section growing from a point to its apex, glazed back wall), seen from both sides
  sail-cluster      pairs=3 length=36 width=15 height=26 gap=1.5 colour
                    mirrored pairs of sails of growing size on a podium-less base (the opera-house silhouette); at.z = podium top
  wing-roof         width=100 depth=70 rise=14 overhang=7 thickness=0.55 lip=2.2 baseHeight=10 colour roofColour
                    sweeping saddle roof whose ends flare up like wings (Accra / Dakar theatres); at.z is added to baseHeight
  conical-drum      radius=30 tiers=3 tierHeight=6 colour roofColour windows=ribbon
                    layered round building: stacked drums with conical skirts and a conical top (Museum of Black Civilisations)
  ring-colonnade    radius=20 count=18 height=7 columnRadius=0.3 colour
                    a ring of slim columns with a flat slab (round museum on a roundabout)
  lattice-dome      radius=30 height=20 baseHeight=7 ribs=True glassColour='#cfdde6' ribColour
                    glazed dome on a short round glass drum with meridian and ring ribs (convention centre)
  cap-roof          radius=34 crown=24 visor=0.5 colour
                    huge flared 'military cap' roof with a raised front visor
  fly-tower         width=24 depth=16 height=32 colour louvres=True
                    tall blank stage-house box with an eaves band and a louvre strip
  amphitheatre      radius=18 tiers=6 stage=True shelter=True colour roofColour
                    half-round stepped seating bowl facing a stage platform; +Y is the back of the seating
  sawtooth-roof     width=40 depth=20 teeth=6 rise=2.4 colour roofColour
                    row of sawtooth roof teeth over a walled box; at.z = wall-top height, glazing faces -Y
  hex-pod           radius=6 height=4.5 roofRise=5 colour roofColour sides=6
                    hexagonal pavilion with a pyramid roof (adjoining hexagonal exhibition blocks)
  mud-dome-studio   radius=3.8 wallHeight=3.2 domeHeight=3.4 colour door=True
                    small domed mud-brick studio (Wissa Wassef)
  cannon-carriage            colour='#2e3033' heading=90 count=1 spacing=2
                    an old muzzle-loading cannon on a timber carriage (pair them at a gate)
  statue-on-stepped-plinth  height=4.5 plinthHeight=None colour='#6b5a3c' plinthColour='#bdb6a6'
                    standing figure on a stepped plinth
  basin-fountain          radius=3.5 waterColour='#6fa8c4' rimColour='#cfcac0'
                    round basin with a tiered jet
  obelisk-pedestal           height=18 baseWidth=2.4 colour='#c8c2b2' pedestal=True
                    square obelisk on a stepped pedestal with a pyramidion
  reflecting-pool   width=24 depth=14 colour='#6fa8c4' edgeColour='#c8c4ba'
                    shallow rectangular pool with a stone coping
  podium-platform   width=100 depth=76 height=1.2 steps=5 stepsWidth=0.6 colour
                    broad stone plinth with steps up its front (-Y) side; stepsWidth is a fraction of the width
  cinema-canopy     width=24 depth=3.2 height=3.6 finHeight=14 colour finColour neon=True
                    art-deco picture-house canopy with a tall vertical blank sign fin
  courtyard-garden  width=14 depth=10 fountainRadius=0 trees=3 paths=True
                    lawn with cross paths, trees and an optional fountain (courtyards, quadrangles)
"""
import math
import os
import sys

import lib
from lib import mix, shade

from ._xform import Xform  # noqa: F401  (kept for readers: `b` arrives as an Xform proxy when placed)
from .core import _lk, _num, placed

_ARCH = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'archetypes'))
if _ARCH not in sys.path:
    sys.path.insert(0, _ARCH)
import _hospital_util as U  # noqa: E402


def _heading_rad(deg):
    return math.radians(_num(deg, 0))


def _L(look, colour=None, roofColour=None, trimColour=None, material=None):
    lk = _lk(look, colour=colour, roofColour=roofColour, material=material, trim=trimColour)
    if trimColour:
        lk.trim_col = trimColour
        lk.frame_col = shade(trimColour, 0.8)
    return lk


# ===================================================================================================== small-building parts
@placed
def red_cross_plate(b, look, rng, detail, size=2.4, colour='#c8242b', plateColour='#f4f4f1', facing='front'):
    hint = {'front': (0, -1, 0), 'back': (0, 1, 0), 'left': (-1, 0, 0), 'right': (1, 0, 0), 'up': (0, 0, 1)}.get(facing, (0, -1, 0))
    b.section('red-cross')
    U.red_cross(b, 0, 0, 0, _num(size, 2.4, 0.3, 20), hint, plate=plateColour, col=colour)


@placed
def ambulance(b, look, rng, detail, colour='#f1f1ee', stripeColour='#c8362f', heading=90.0, scale=1.0):
    b.section('ambulance')
    sc = _num(scale, 1, 0.3, 3)
    if detail >= 1:
        with b.site():
            lib.obox(b, 0, 0, 0.4 * sc, 5.4 * sc, 2.0 * sc, 2.0 * sc, _heading_rad(heading), 'plain', colour)
        return
    U.ambulance(b, 0, 0, _heading_rad(heading), sc)


@placed
def ambulance_bay(b, look, rng, detail, width=12.0, depth=5.5, height=3.8, columns=3, colour=None, roofColour=None, vans=2, marking=True):
    lk = _L(look, colour, roofColour)
    w, d, h = _num(width, 12, 3, 60), _num(depth, 5.5, 3, 16), _num(height, 3.8, 2.8, 8)
    b.section('ambulance-bay')
    cols = None
    if detail < 2 and int(columns) > 0:
        n = int(_num(columns, 3, 0, 12))
        cols = [(-w / 2 + 0.5 + (w - 1.0) * k / max(1, n - 1), -d + 0.6) for k in range(n)]
    lib.canopy_flat(b, -w / 2, -d, w / 2, 0.3, h, lk, th=0.4, columns=cols, col=lk.roof_col, r=0.18)
    if detail < 1 and marking:
        with b.site():
            for k in range(int(_num(vans, 2, 0, 4)) + 1):
                x = -w / 2 + 1.0 + (w - 2.0) * k / max(1, int(vans))
                b.face([(x - 0.06, -d + 0.4, 0.07), (x + 0.06, -d + 0.4, 0.07), (x + 0.06, -0.4, 0.07), (x - 0.06, -0.4, 0.07)], 'plain', '#efefe8')
            lib.seg_box(b, lib.Seg((-w / 2, 0), (w / 2, 0)), 0.5, w - 0.5, 0.0, 1.0, 0.04, '#7b2b27', 'plain')
    n_v = int(_num(vans, 2, 0, 4))
    for k in range(n_v):
        x = -w / 2 + (w * (k + 0.5) / max(1, n_v))
        U.ambulance(b, x, -d / 2 - 0.2, math.radians(90 if k % 2 == 0 else 270))


@placed
def helipad(b, look, rng, detail, radius=6.5, colour='#8c9096', markColour='#e8e8e2', ringColour='#d9c13a', ground=False):
    b.section('helipad')
    U.helipad(b, 0, 0, 0.0, r=_num(radius, 6.5, 2, 20), col=colour, mark=markColour, ring=ringColour, ground=bool(ground))


@placed
def road_sign_pylon(b, look, rng, detail, width=3.0, height=2.4, bottom=2.0, colour='#f4f4f1', cross=True):
    w, h, z = _num(width, 3, 0.8, 12), _num(height, 2.4, 0.4, 8), _num(bottom, 2.0, 0.2, 6)
    b.section('sign')
    with b.site():
        if detail < 2:
            for sx in (-1, 1):
                lib.cylinder(b, sx * (w / 2 - 0.15), 0, 0, z + h + 0.2, 0.07, n=5, slot='frame', col='#8d9298', r_top=0.07, top=False)
        lib.box_c(b, 0, 0, z, w, 0.18, h, 'plain', colour, skip=('bottom',))
    if cross and detail < 2:
        with b.site():
            U.red_cross(b, 0, -0.12, z + h / 2, min(h, w) * 0.6, (0, -1, 0))


@placed
def covered_walkway(b, look, rng, detail, length=14.0, width=2.6, height=3.0, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    L = _num(length, 14, 2, 80)
    b.section('walkway')
    U.covered_walk(b, lk, (0, 0), (L, 0), _num(height, 3, 2.4, 6), _num(width, 2.6, 1.2, 8), col=lk.trim_col, roof=lk.roof_col)


@placed
def veranda(b, look, rng, detail, length=20.0, depth=2.4, eaveHeight=3.0, attachHeight=4.2, post='square', postEvery=3.0, railHeight=0.0, flat=False,
            colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    L = _num(length, 20, 1.5, 120)
    b.section('veranda')
    U.veranda(b, lk, (-L / 2, 0), (L / 2, 0), 0.0, _num(eaveHeight, 3, 2.2, 8), _num(depth, 2.4, 1, 6), _num(attachHeight, 4.2, 3, 12), post=post,
              pitch_m=_num(postEvery, 3, 1.5, 8), col=lk.trim_col, roof_col=lk.roof_col, flat=bool(flat), rail_h=_num(railHeight, 0, 0, 1.5))


@placed
def gallery(b, look, rng, detail, length=24.0, depth=2.4, storeyHeight=3.6, wallTop=7.6, colour=None, railColour=None):
    lk = _L(look, colour)
    L = _num(length, 24, 2, 120)
    b.section('gallery')
    U.gallery2(b, lk, (-L / 2, 0), (L / 2, 0), _num(wallTop, 7.6, 5, 20), _num(storeyHeight, 3.6, 2.8, 6), _num(depth, 2.4, 1.2, 5), rail_col=railColour, col=lk.trim_col)


@placed
def entrance_canopy(b, look, rng, detail, width=10.0, depth=5.0, height=4.0, thickness=0.45, columns=2, round=True, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    w = _num(width, 10, 2, 60)
    b.section('canopy')
    U.entrance_canopy(b, lk, -w / 2, w / 2, 0.0, _num(height, 4, 2.6, 12), _num(depth, 5, 1.5, 20), th=_num(thickness, 0.45, 0.15, 1.2), col=lk.roof_col,
                      columns=int(_num(columns, 2, 0, 12)), round_cols=bool(round))


@placed
def roof_monitor(b, look, rng, detail, length=12.0, width=2.4, height=1.2, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    L, W, H = _num(length, 12, 2, 80), _num(width, 2.4, 0.8, 8), _num(height, 1.2, 0.4, 4)
    b.section('monitor')
    lib.box(b, -L / 2, -W / 2, -0.3, L / 2, W / 2, H, 'metal-cladding', shade(lk.trim_col, 0.85), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    if detail == 0:
        b.facing([(-L / 2 + 0.3, -W / 2 - 0.03, 0.15), (L / 2 - 0.3, -W / 2 - 0.03, 0.15), (L / 2 - 0.3, -W / 2 - 0.03, H - 0.2), (-L / 2 + 0.3, -W / 2 - 0.03, H - 0.2)],
                 (0, -1, 0), 'glass-ribbon', '#cfd8dd', mode='tile')


@placed
def chimney(b, look, rng, detail, height=14.0, radius=0.9, colour='#a9573e'):
    b.section('chimney')
    r = _num(radius, 0.9, 0.2, 4)
    lib.cylinder(b, 0, 0, 0, _num(height, 14, 3, 80), r, n=10 if detail == 0 else 6, slot='brick', col=colour, r_top=r * 0.62, top=True, smooth=True)
    if detail == 0:
        lib.cylinder(b, 0, 0, _num(height, 14, 3, 80) - 0.5, _num(height, 14, 3, 80), r * 0.75, n=10, slot='brick', col=shade(colour, 0.85), r_top=r * 0.68, top=True, smooth=False)


@placed
def stair_tower(b, look, rng, detail, width=4.6, depth=4.2, height=3.4, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    w, d, h = _num(width, 4.6, 1.5, 20), _num(depth, 4.2, 1.5, 20), _num(height, 3.4, 1.5, 12)
    b.section('stair-tower')
    lib.box_c(b, 0, 0, 0, w, d, h, lk.wall_slot, shade(lk.wall_col, 0.94), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    if detail < 2:
        b.face([(-w * 0.3, -d / 2 - 0.03, h * 0.3), (w * 0.3, -d / 2 - 0.03, h * 0.3), (w * 0.3, -d / 2 - 0.03, h * 0.85), (-w * 0.3, -d / 2 - 0.03, h * 0.85)], 'glass-punched', lk.glass_col)


@placed
def roof_tank(b, look, rng, detail, radius=1.4, height=1.7, colour='#2d5a3d'):
    b.section('roof-tank')
    if detail >= 2:
        lib.cylinder(b, 0, 0, 0, 1.1 + _num(height, 1.7), _num(radius, 1.4), n=6, slot='plain', col=colour, top=True, smooth=False)
        return
    if detail >= 1:
        lib.cylinder(b, 0, 0, 0.0, 1.1 + _num(height, 1.7, 0.5, 6), _num(radius, 1.4, 0.4, 5), n=7, slot='metal-cladding', col=colour, top=True, smooth=False)
        return
    U.roof_tank(b, 0, 0, 0, r=_num(radius, 1.4, 0.4, 5), h=_num(height, 1.7, 0.5, 6), col=colour)


@placed
def roof_sign(b, look, rng, detail, width=10.0, height=1.5, colour='#f2f0e8'):
    w, h = _num(width, 10, 1.5, 40), _num(height, 1.5, 0.4, 5)
    b.section('roof-sign')
    if detail < 2:
        for lx in (-w / 2 + 0.4, w / 2 - 0.4):
            lib.box_c(b, lx, 0, 0, 0.16, 0.16, 1.4, 'frame', '#7d8286')
    lib.box_c(b, 0, 0, 1.2 if detail < 2 else 0.0, w, 0.2, h, 'plain', colour, skip=('bottom',))


@placed
def kiosk(b, look, rng, detail, width=2.4, depth=2.2, height=2.6, colour='#c8362f', roofColour='#d8d8d4'):
    b.section('kiosk')
    w, d, h = _num(width, 2.4, 1, 8), _num(depth, 2.2, 1, 8), _num(height, 2.6, 1.8, 5)
    lib.box_c(b, 0, 0, 0, w, d, h, 'plain-render', colour, skip=('bottom',))
    if detail < 2:
        lib.box_c(b, 0, 0, h, w + 0.6, d + 0.6, 0.15, 'plain-render', roofColour)
    if detail == 0:
        b.face([(-w * 0.35, -d / 2 - 0.02, 1.0), (w * 0.35, -d / 2 - 0.02, 1.0), (w * 0.35, -d / 2 - 0.02, 2.0), (-w * 0.35, -d / 2 - 0.02, 2.0)], 'glass-shopfront', '#cfd8dc')


@placed
def pickup(b, look, rng, detail, colour='#e8e8e4', heading=0.0):
    b.section('pickup')
    if detail >= 1:
        with b.site():
            lib.obox(b, 0, 0, 0.4, 5.0, 1.9, 1.5, _heading_rad(heading), 'plain', colour)
        return
    U.pickup(b, 0, 0, _heading_rad(heading), colour)


@placed
def umbrella_cluster(b, look, rng, detail, count=3, spread=6.0, colours=None, radius=1.5):
    b.section('umbrellas')
    cols = list(colours or ['#d84c3a', '#3a7bd8', '#e8b83a'])
    for k in range(int(_num(count, 3, 1, 24))):
        a = 2 * math.pi * k / max(1, int(count)) + rng.uniform(-0.4, 0.4)
        r = _num(spread, 6) * (0.4 + 0.6 * rng.random()) if k else 0.0
        U.umbrella(b, r * math.cos(a), r * math.sin(a), cols[k % len(cols)], r=_num(radius, 1.5, 0.6, 4))
        if detail >= 1:
            continue


@placed
def shed_shelter(b, look, rng, detail, width=8.0, depth=5.0, height=2.8, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    w, d, h = _num(width, 8, 2, 40), _num(depth, 5, 2, 20), _num(height, 2.8, 2.2, 6)
    b.section('shed')
    if detail < 2:
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.box_c(b, sx * (w / 2 - 0.2), sy * (d / 2 - 0.2), 0, 0.18, 0.18, h, 'frame', '#7d8286')
    lib.box(b, -w / 2 - 0.4, -d / 2 - 0.4, h, w / 2 + 0.4, d / 2 + 0.4, h + 0.18, 'metal-cladding', '#8a8f94', top_slot=lk.roof_slot, top_col=lk.roof_col, skip=())


# ================================================================================================= architectural parts
@placed
def clock_tower(b, look, rng, detail, width=6.0, height=24.0, cap='hip', capRise=None, clockRadius=None, clock=True, belfry=True, colour=None,
                trimColour=None, capColour=None, finial=0.0, windows='punched'):
    lk = _L(look, colour, capColour, trimColour)
    w = _num(width, 6, 2, 30)
    b.section('clock-tower')
    U.clock_tower(b, lk, 0, 0, 0, w, _num(height, 24, 6, 90), cap=cap, cap_rise=_num(capRise, 0, 0, 40) or None, clock_r=_num(clockRadius, 0, 0, 5) or None,
                  wall_col=lk.wall_col, stone_col=lk.trim_col, windows=windows, belfry=bool(belfry), clock=bool(clock), finial=_num(finial, 0, 0, 6))


@placed
def turret(b, look, rng, detail, radius=1.1, height=12.0, coneHeight=3.4, sides=8, colour=None, capColour=None):
    lk = _L(look, colour, capColour)
    b.section('turret')
    U.turret(b, 0, 0, 0, _num(height, 12, 2, 60), _num(radius, 1.1, 0.3, 6), lk.wall_col, lk.wall_slot, cone_h=_num(coneHeight, 3.4, 0, 20) or None, cone_col=lk.roof_col,
             n=int(_num(sides, 8, 4, 16)))


@placed
def gatehouse(b, look, rng, detail, width=12.0, depth=7.0, height=16.0, archWidth=4.4, archSpring=4.0, pointed=True, turrets=4, crenellated=True, spireHeight=0.0,
              colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    gw, gd, gh = _num(width, 12, 5, 40), _num(depth, 7, 3, 20), _num(height, 16, 5, 50)
    b.section('gatehouse')
    if detail >= 2:
        lib.box(b, -gw / 2, 0, 0, gw / 2, gd, gh, 'plain', lk.wall_col, skip=('bottom',))
        return
    gseg = lib.Seg((-gw / 2, 0), (gw / 2, 0))
    aw = min(_num(archWidth, 4.4, 1.5, gw - 2), gw - 2)
    U.arch_portal(b, gseg, 0, gw, 0, gh, gw / 2, aw, _num(archSpring, 4, 1.5, gh - 3), lk.wall_col, lk.wall_slot, pointed=bool(pointed))
    for xs, sgn in ((-gw / 2, -1), (gw / 2, 1)):
        b.facing([(xs, 0, 0), (xs, gd, 0), (xs, gd, gh), (xs, 0, gh)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.92))
    b.facing([(-gw / 2, gd, 0), (gw / 2, gd, 0), (gw / 2, gd, gh), (-gw / 2, gd, gh)], (0, 1, 0), lk.wall_slot, shade(lk.wall_col, 0.9))
    nt = int(_num(turrets, 4, 0, 4))
    corners = [(-gw / 2, 0), (gw / 2, 0), (-gw / 2, gd), (gw / 2, gd)][:nt]
    for (tx, ty) in corners:
        if detail >= 1 and ty > 0:
            continue
        U.turret(b, tx, ty, 0.0, gh + 1.0, 1.15, lk.wall_col, lk.wall_slot, cone_h=3.4, cone_col=lk.roof_col)
    gfp = lib.fp_rect(gw, gd, 0, gd / 2)
    lib.flat_roof(b, gfp, gh, lk, parapet_h=0.0)
    if crenellated:
        for s in gfp.edges():
            U.crenellate_seg(b, s, gh, h=0.9, w=0.8, pitch=1.8, thick=0.45, col=lk.wall_col, slot=lk.wall_slot)
    if _num(spireHeight, 0) > 0:
        lib.cylinder(b, 0, gd / 2, gh, gh + _num(spireHeight, 7), 1.6, n=8, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)
    if detail == 0:
        for k in range(3):
            u = gw * (0.28 + 0.22 * k)
            b.face([gseg.P(u - 0.5, gh - 4.0, -0.03), gseg.P(u + 0.5, gh - 4.0, -0.03), gseg.P(u + 0.5, gh - 2.1, -0.03), gseg.P(u - 0.5, gh - 2.1, -0.03)], 'glass-punched', lk.glass_col)


@placed
def arch_portal(b, look, rng, detail, width=10.0, height=7.0, depth=0.6, archWidth=4.4, springHeight=3.2, pointed=False, colour=None):
    lk = _L(look, colour)
    w, h = _num(width, 10, 2, 60), _num(height, 7, 3, 40)
    aw = min(_num(archWidth, 4.4, 1.2, w - 0.5), w - 0.5)
    b.section('arch-portal')
    seg = lib.Seg((-w / 2, 0), (w / 2, 0))
    if detail >= 2:
        lib.box(b, -w / 2, 0, 0, w / 2, _num(depth, 0.6, 0.2, 10), h, 'plain', lk.wall_col, skip=('bottom',))
        return
    U.arch_portal(b, seg, 0, w, 0, h, w / 2, aw, _num(springHeight, 3.2, 1, h - 1.5), lk.wall_col, lk.wall_slot, pointed=bool(pointed))
    d = _num(depth, 0.6, 0.2, 10)
    for xs, sgn in ((-w / 2, -1), (w / 2, 1)):
        b.facing([(xs, 0, 0), (xs, d, 0), (xs, d, h), (xs, 0, h)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.92))


@placed
def iwan(b, look, rng, detail, width=12.0, height=18.0, depth=3.0, archRatio=0.62, colour=None, accentColour=None):
    lk = _L(look, colour)
    w, h, d = _num(width, 12, 4, 40), _num(height, 18, 6, 60), _num(depth, 3, 1, 12)
    acc = accentColour or lk.accent_col
    b.section('iwan')
    seg = lib.Seg((-w / 2, 0), (w / 2, 0))
    if detail >= 2:
        lib.box(b, -w / 2, 0, 0, w / 2, d, h, 'plain', lk.wall_col, skip=('bottom',))
        return
    U.arch_portal(b, seg, 0, w, 0, h, w / 2, w * _num(archRatio, 0.62, 0.3, 0.9), h * 0.42, shade(lk.wall_col, 1.04), lk.wall_slot, pointed=True, tall=1.15)
    for xs, sgn in ((-w / 2, -1), (w / 2, 1)):
        b.facing([(xs, 0, 0), (xs, d, 0), (xs, d, h), (xs, 0, h)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.94))
    lib.box(b, -w / 2, 0, h, w / 2, d, h + 0.5, lk.wall_slot, acc, top_slot='roof-flat', top_col=lk.roof_col, skip=())
    if detail == 0:
        lib.seg_box(b, seg, 0.3, w - 0.3, h - 1.6, h - 0.9, 0.08, acc, lk.wall_slot)


@placed
def zaure_gatehouse(b, look, rng, detail, width=11.0, depth=5.0, height=7.5, archWidth=5.5, horns=True, relief=True, colour=None, trimColour=None):
    lk = _L(look, colour, None, trimColour)
    gw, gd, gh = _num(width, 11, 4, 40), _num(depth, 5, 2, 16), _num(height, 7.5, 3.5, 24)
    b.section('zaure')
    if detail >= 2:
        lib.box(b, -gw / 2, 0, 0, gw / 2, gd, gh, 'plain', lk.wall_col, skip=('bottom',))
        return
    seg = lib.Seg((-gw / 2, 0), (gw / 2, 0))
    U.arch_portal(b, seg, 0, gw, 0, gh, gw / 2, min(_num(archWidth, 5.5, 1.5, gw - 1), gw - 1), 3.2, lk.wall_col, lk.wall_slot, pointed=False)
    for xs, sgn in ((-gw / 2, -1), (gw / 2, 1)):
        b.facing([(xs, 0, 0), (xs, gd, 0), (xs, gd, gh), (xs, 0, gh)], (sgn, 0, 0), lk.wall_slot, shade(lk.wall_col, 0.94))
    fp = lib.fp_rect(gw, gd, 0, gd / 2)
    lib.flat_roof(b, fp, gh, lk, parapet_h=0.0)
    for s in fp.edges():
        U.crenellate_seg(b, s, gh, h=0.7, w=0.7, pitch=2.0, thick=0.4, col=lk.trim_col, slot=lk.wall_slot)
    if horns:
        for (hx, hy) in ((-gw / 2 + 0.4, 0.4), (gw / 2 - 0.4, 0.4), (-gw / 2 + 0.4, gd - 0.4), (gw / 2 - 0.4, gd - 0.4)):
            U.pinnacle(b, hx, hy, gh, 3.6, 1.2, lk.wall_col, slot=lk.wall_slot)
    if relief and detail == 0:
        for k in range(7):
            lib.seg_box(b, seg, 0.5 + k * (gw - 1.0) / 6, 0.5 + k * (gw - 1.0) / 6 + 0.5, gh - 1.2, gh - 0.4, 0.07, shade(lk.trim_col, 0.85 if k % 2 else 1.0), lk.wall_slot)


@placed
def pinnacle(b, look, rng, detail, height=3.4, width=1.1, style='horn', colour=None):
    lk = _L(look, colour)
    b.section('pinnacle')
    h, w = _num(height, 3.4, 0.3, 20), _num(width, 1.1, 0.1, 6)
    if style == 'ball':
        lib.cylinder(b, 0, 0, 0, h * 0.5, w * 0.35, n=6, slot=lk.wall_slot, col=lk.wall_col, top=False, smooth=False)
        U.finial_ball(b, 0, 0, h * 0.5, w * 0.5, shade(lk.wall_col, 1.04)) if detail == 0 else None
    elif style == 'spike':
        lib.cylinder(b, 0, 0, 0, h, w / 2, n=4, slot=lk.wall_slot, col=lk.wall_col, r_top=0.0, top=False, smooth=False)
    else:
        U.pinnacle(b, 0, 0, 0, h, w, lk.wall_col, slot=lk.wall_slot) if detail < 2 else U.frustum_sq(b, 0, 0, 0, h, w, w * 0.2, lk.wall_slot, lk.wall_col)


@placed
def crenellated_wall(b, look, rng, detail, length=20.0, height=0.9, mHeight=0.7, pitch=2.0, thickness=0.4, colour=None, trimColour=None, pinnacles=False, relief=False):
    lk = _L(look, colour, None, trimColour)
    L = _num(length, 20, 2, 200)
    t = _num(thickness, 0.4, 0.15, 2)
    b.section('crenellated-wall')
    seg = lib.Seg((-L / 2, 0), (L / 2, 0))
    if _num(height, 0.9) > 0 and detail < 2:
        lib.seg_box(b, seg, 0, L, 0, _num(height, 0.9, 0.2, 12), 0.0, lk.wall_col, lk.wall_slot, inset=t)
    U.crenellate_seg(b, seg, _num(height, 0.9), h=_num(mHeight, 0.7, 0.2, 2), w=0.7, pitch=_num(pitch, 2.0, 1.0, 6), thick=t, col=lk.trim_col, slot=lk.wall_slot)
    if pinnacles and detail < 2:
        for x in (-L / 2 + 0.3, L / 2 - 0.3):
            U.pinnacle(b, x, t / 2, _num(height, 0.9), 3.0, 1.0, lk.wall_col, slot=lk.wall_slot)
    if relief and detail == 0:
        n = int(L / 1.5)
        for k in range(n):
            lib.seg_box(b, seg, k * 1.5 + 0.3, k * 1.5 + 1.2, -1.2, -0.4, 0.07, lk.trim_col if k % 2 == 0 else shade(lk.trim_col, 0.85), lk.wall_slot)


@placed
def buttress_row(b, look, rng, detail, length=20.0, height=9.0, pitch=4.0, width=0.7, proud=0.7, colour='#c8c0b0'):
    L = _num(length, 20, 2, 200)
    b.section('buttresses')
    seg = lib.Seg((-L / 2, 0), (L / 2, 0))
    n = max(1, int(L / _num(pitch, 4, 1.5, 12)))
    U.buttress_row(b, seg, [(k + 0.5) * L / n for k in range(n)], _num(height, 9, 3, 40), w=_num(width, 0.7, 0.3, 2), proud=_num(proud, 0.7, 0.2, 2), col=colour)


@placed
def fin_row(b, look, rng, detail, length=20.0, height=10.0, pitch=1.2, finWidth=0.12, proud=0.5, colour='#cfc8b8'):
    L = _num(length, 20, 2, 200)
    b.section('fins')
    seg = lib.Seg((-L / 2, 0), (L / 2, 0))
    U.fins_row(b, seg, 0.0, _num(height, 10, 1, 60), pitch=_num(pitch, 1.2, 0.5, 4), w=_num(finWidth, 0.12, 0.04, 0.6), proud=_num(proud, 0.5, 0.1, 2), col=colour, u0=0.4, u1=L - 0.4)


@placed
def balcony_bands(b, look, rng, detail, length=20.0, floors=3, storeyHeight=3.6, proud=1.3, rail=True, railHeight=0.9, colour=None):
    lk = _L(look, colour)
    L = _num(length, 20, 2, 200)
    b.section('balconies')
    seg = lib.Seg((-L / 2, 0), (L / 2, 0))
    for k in range(int(_num(floors, 3, 1, 14))):
        U.balcony_slab(b, seg, (k + 1) * _num(storeyHeight, 3.6, 2.6, 6), proud=_num(proud, 1.3, 0.5, 3), col=lk.trim_col, rail=bool(rail), rail_h=_num(railHeight, 0.9, 0.5, 1.4))


@placed
def pilotis_row(b, look, rng, detail, length=30.0, height=4.0, radius=0.36, pitch=5.0, colour=None):
    lk = _L(look, colour)
    L = _num(length, 30, 2, 200)
    b.section('pilotis')
    n = max(2, int(L / _num(pitch, 5, 2, 15)) + 1)
    n = n if detail == 0 else max(2, n // 2)
    for k in range(n):
        lib.cylinder(b, -L / 2 + L * k / (n - 1), 0, 0, _num(height, 4, 2, 20), _num(radius, 0.36, 0.1, 2), n=8 if detail == 0 else 5, slot='rough-concrete', col=lk.trim_col,
                     r_top=_num(radius, 0.36) * 0.85, top=False)


@placed
def arcade(b, look, rng, detail, length=24.0, depth=2.6, springHeight=2.6, topHeight=3.8, bayWidth=3.6, pierWidth=0.7, shape='round', colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    L = _num(length, 24, 2, 200)
    b.section('arcade')
    U.arcade(b, lk, (-L / 2, 0), (L / 2, 0), 0, _num(springHeight, 2.6, 1, 8), _num(topHeight, 3.8, 2.5, 12), _num(depth, 2.6, 1, 8), bay_w=_num(bayWidth, 3.6, 2, 8),
             pier_w=_num(pierWidth, 0.7, 0.3, 2), col=lk.trim_col, pointed=(shape == 'pointed'), horseshoe=(shape == 'horseshoe'), roof_col=lk.roof_col)


@placed
def loggia(b, look, rng, detail, length=30.0, depth=4.0, height=5.0, radius=0.35, pitch=5.0, kind='round', colour=None, roofColour=None, baseHeight=0.0):
    lk = _L(look, colour, roofColour)
    L = _num(length, 30, 3, 200)
    b.section('loggia')
    d, h, r = _num(depth, 4, 1.5, 12), _num(height, 5, 2.6, 20), _num(radius, 0.35, 0.1, 1.5)
    zb = _num(baseHeight, 0, 0, 5)
    yc = -d + r + 0.4
    n = max(3, int(L / _num(pitch, 5, 2, 15)) + 1)
    n = n if detail == 0 else max(3, n // 2 + 1)
    if detail >= 2:
        lib.box(b, -L / 2, -d, 0, L / 2, 0, h + 0.8, 'plain', lk.trim_col, skip=('bottom',))
        return
    lib.box(b, -L / 2 - 0.3, -d - 0.2, 0, L / 2 + 0.3, 0, zb + 0.35, lk.wall_slot, shade(lk.trim_col, 0.92), skip=('bottom', 'back'))
    for k in range(n):
        x = -L / 2 + r + (L - 2 * r) * k / max(1, n - 1)
        if kind == 'square':
            lib.box_c(b, x, yc, zb, 2 * r, 2 * r, h - zb, lk.wall_slot, lk.trim_col)
        else:
            lib.column(b, x, yc, zb, h, r, lk, 'round', True, lk.wall_slot, lk.trim_col)
    lib.box(b, -L / 2 - 0.5, -d, h, L / 2 + 0.5, 0, h + 0.8, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=())


@placed
def portico_pedimented(b, look, rng, detail, width=14.0, depth=5.5, height=8.0, columns=6, pediment=True, steps=7, kind='round', colour=None, entabHeight=0.9, baseHeight=1.0):
    lk = _L(look, colour)
    w = _num(width, 14, 3, 60)
    cols = int(_num(columns, 6, 2, 12))
    ped = None
    if pediment:
        ped = w * 0.13 if pediment is True else _num(pediment, w * 0.13, 0.5, 20)
    b.section('portico')
    U.portico_front(b, lk, 0, 0, w, _num(depth, 5.5, 2, 14), _num(baseHeight, 1.0, 0, 5), _num(height, 8, 3, 30), cols, pediment_rise=ped, steps_n=int(_num(steps, 7, 0, 12)),
                    col_r=min(0.6, w / cols / 3.2), kind=kind, col=lk.trim_col, entab_h=_num(entabHeight, 0.9, 0.3, 2.5), steps_w=w * 0.85,
                    pediment_col=shade(lk.trim_col, 0.97))


@placed
def dome_colonnaded(b, look, rng, detail, radius=8.0, drum=5.0, colonnade=True, profile='hemi', lantern=3.0, finial=2.0, colour=None, drumColour=None, baseSquare=True):
    lk = _L(look, colour)
    r = _num(radius, 8, 2, 40)
    dr = _num(drum, 5, 0, 20)
    b.section('dome')
    if baseSquare and detail < 2:
        lib.box_c(b, 0, 0, 0, r * 2.6, r * 2.6, 0.8, lk.wall_slot, lk.trim_col, skip=('bottom',))
    lib.dome(b, 0, 0, 0.8, r, lk, profile=profile if profile in ('hemi', 'shallow', 'pointed', 'onion') else 'hemi', drum=dr, drum_r=r * 1.05, drum_slot=lk.wall_slot,
             drum_col=drumColour or lk.trim_col, lantern=_num(lantern, 3, 0, 12), finial=_num(finial, 2, 0, 10), slot='metal-roof',
             col=mix(lk.roof_col, '#9aa3a8', 0.4) if lk.roof_slot == 'roof-flat' else lk.roof_col)
    if colonnade and detail == 0:
        for k in range(12):
            a = 2 * math.pi * k / 12
            lib.cylinder(b, r * 1.02 * math.cos(a), r * 1.02 * math.sin(a), 0.8, 0.8 + dr, 0.18, n=5, slot=lk.wall_slot, col=lk.trim_col, r_top=0.18, top=False)


@placed
def corner_tower_domed(b, look, rng, detail, height=22.0, radius=1.4, sides=8, balconyHeight=2.0, colour=None, domeColour=None, finial=0.8):
    lk = _L(look, colour)
    h, r = _num(height, 22, 5, 80), _num(radius, 1.4, 0.4, 6)
    n = int(_num(sides, 8, 4, 16)) if detail == 0 else 6
    dome_col = domeColour or lk.accent_col
    b.section('corner-tower')
    lib.cylinder(b, 0, 0, 0, h, r, n=n, slot=lk.wall_slot, col=shade(lk.wall_col, 1.05), r_top=r * 0.88, top=False, smooth=False)
    if detail < 2:
        lib.cylinder(b, 0, 0, h - _num(balconyHeight, 2, 0.5, 8) - 0.3, h - _num(balconyHeight, 2, 0.5, 8), r * 1.7, n=n, slot=lk.wall_slot, col=lk.trim_col, r_top=r * 1.7, top=True, smooth=False)
        lib.dome(b, 0, 0, h - _num(balconyHeight, 2, 0.5, 8), r, lk, profile='onion', height=r * 3.0, slot='metal-roof', col=dome_col, finial=_num(finial, 0.8, 0, 4))
    else:
        lib.cylinder(b, 0, 0, h, h + 2.0, r, n=6, slot='plain', col=dome_col, r_top=0.0, top=False, smooth=False)


@placed
def setback_tower(b, look, rng, detail, width=28.0, depth=24.0, height=20.0, tiers=3, shrink=0.72, tierHeight=8.0, spireHeight=14.0, colour=None, trimColour=None,
                  windows='ribbon', bay=4.6):
    lk = _L(look, colour, None, trimColour)
    w, d, h0 = _num(width, 28, 6, 80), _num(depth, 24, 6, 80), _num(height, 20, 3, 80)
    st_h = 4.0
    b.section('setback-tower')
    z0 = 0.0
    zt = h0
    n = int(_num(tiers, 3, 1, 6))
    for k in range(n):
        tw, td = w * (_num(shrink, 0.72, 0.4, 0.95) ** k), d * (_num(shrink, 0.72, 0.4, 0.95) ** k)
        ztop = h0 if k == 0 else zt + _num(tierHeight, 8, 3, 30)
        tf = lib.fp_rect(tw, td, 0, 0)
        ns = max(1, round((ztop - z0) / st_h))
        U.walls(b, tf, z0 if k == 0 else z0 - 0.01, ztop, ns, lk, rng, kind=windows, ratio=0.3, bay=_num(bay, 4.6, 2.5, 10), plinth=0, rear='same')
        if detail == 0:
            U.eaves_band(b, tf, ztop + 0.6, lk, 0.6, 0.6)
            for s in tf.edges():
                nn = max(2, int(s.length / 4.6))
                U.piers(b, s, [s.length * j / nn for j in range(1, nn)], z0 + 0.5, ztop - 0.3, 0.5, 0.26, shade(lk.trim_col, 1.0), lk.wall_slot)
        lib.flat_roof(b, tf, ztop, lk, parapet_h=0.0)
        z0 = ztop
        zt = ztop
    sp = _num(spireHeight, 14, 0, 60)
    if sp > 0 and detail < 3:
        base = w * (_num(shrink, 0.72) ** (n - 1))
        lib.cylinder(b, 0, 0, zt, zt + 3.0, base * 0.18, n=8 if detail < 2 else 6, slot=lk.wall_slot, col=lk.trim_col, r_top=base * 0.12, top=True, smooth=False)
        lib.cylinder(b, 0, 0, zt + 3.0, zt + sp, base * 0.12, n=8 if detail < 2 else 6, slot='metal-roof', col=mix(lk.roof_col, '#b8a050', 0.5), r_top=0.0, top=False, smooth=False)


@placed
def balustrade(b, look, rng, detail, length=20.0, height=1.0, postEvery=2.4, colour='#e8e4da'):
    L = _num(length, 20, 1, 200)
    b.section('balustrade')
    U.balustrade(b, (-L / 2, 0), (L / 2, 0), 0.0, _num(height, 1.0, 0.5, 1.6), colour, pitch=_num(postEvery, 2.4, 0.8, 6))


@placed
def lattice_mast(b, look, rng, detail, height=60.0, baseWidth=3.6, topWidth=0.8, panels=10, colour='#c8362f', colour2='#f2f2ee'):
    b.section('mast')
    U.lattice_mast(b, 0, 0, _num(height, 60, 6, 140), base_w=_num(baseWidth, 3.6, 0.6, 12), top_w=_num(topWidth, 0.8, 0.2, 4), col_a=colour, col_b=colour2,
                   panels=int(_num(panels, 10, 3, 24)))
    if detail < 2:
        lib.box_c(b, 0, 0, 0, _num(baseWidth, 3.6) + 1.6, _num(baseWidth, 3.6) + 1.6, 0.5, 'rough-concrete', '#9a9a96', skip=('bottom',))


@placed
def pillar_box(b, look, rng, detail, colour='#b3262b'):
    b.section('pillar-box')
    lib.cylinder(b, 0, 0, 0, 1.45, 0.42, n=8 if detail == 0 else 5, slot='plain', col=colour, r_top=0.42, top=False)
    lib.cylinder(b, 0, 0, 1.45, 1.65, 0.46, n=8 if detail == 0 else 5, slot='plain', col=shade(colour, 0.92), r_top=0.2, top=True, smooth=False)


# ================================================================================================ museum and theatre parts
def _sail(b, x0, y0, L, W, H, mirror, col, lean=0.0):
    ns = {0: 12, 1: 6, 2: 3}[b.detail]
    nt = {0: 8, 1: 4, 2: 3}[b.detail]
    grid = []
    for i in range(ns + 1):
        s = i / ns
        f = math.sin(s * math.pi / 2) ** 1.1
        row = []
        for j in range(nt + 1):
            a = j / nt * math.pi / 2
            row.append((x0 + mirror * W * f * math.sin(a), y0 + L * s, H * f * math.cos(a)))
        grid.append(row)
    outer = grid if mirror < 0 else [r[::-1] for r in grid]
    b.shared_grid(outer, 'metal-roof', col, smooth=True, scale=1.2)
    if b.detail < 2:
        b.shared_grid([r[::-1] for r in outer], 'plain-render', shade(col, 0.7), smooth=False, scale=1.2)
        pts = [(x0 + mirror * W * math.sin(j / nt * math.pi / 2), y0 + L, H * math.cos(j / nt * math.pi / 2)) for j in range(nt + 1)] + [(x0, y0 + L, 0.0)]
        b.facing(pts, (0, 1, 0), 'glass-curtain', '#bcd0da')


@placed
def sail_shell(b, look, rng, detail, length=40.0, width=18.0, height=26.0, mirror=-1, colour='#f1ede2'):
    b.section('sail')
    _sail(b, 0, 0, _num(length, 40, 4, 120), _num(width, 18, 2, 60), _num(height, 26, 3, 80), 1 if _num(mirror, -1) > 0 else -1, colour)


@placed
def sail_cluster(b, look, rng, detail, pairs=3, length=36.0, width=15.0, height=26.0, gap=1.5, colour='#f1ede2'):
    b.section('sails')
    n = int(_num(pairs, 3, 1, 5))
    L0, W0, H0 = _num(length, 36, 6, 120), _num(width, 15, 3, 50), _num(height, 26, 4, 70)
    for k in range(n):
        sc = (k + 1) / n
        if detail >= 2 and k == 0 and n > 2:
            continue
        for mir in (-1, 1):
            _sail(b, mir * _num(gap, 1.5, 0, 10) * (0.5 + 0.5 * sc), (k - n + 1) * L0 * 0.28, L0 * (0.55 + 0.45 * sc), W0 * (0.6 + 0.4 * sc), H0 * sc, mir, shade(colour, 0.96 if mir > 0 else 1.0))


@placed
def wing_roof(b, look, rng, detail, width=100.0, depth=70.0, rise=14.0, overhang=7.0, thickness=0.55, lip=2.2, baseHeight=10.0, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    w, d = _num(width, 100, 10, 140), _num(depth, 70, 8, 120)
    ov = _num(overhang, 7, 0, 20)
    W2, D2 = w / 2 + ov, d / 2 + ov * 0.6
    nx = {0: 40, 1: 14, 2: 6}[detail]
    ny = {0: 12, 1: 6, 2: 3}[detail]
    z1, rs = _num(baseHeight, 10, 2, 40), _num(rise, 14, 1, 40)
    top = []
    for i in range(nx + 1):
        u = -1 + 2 * i / nx
        row = []
        for j in range(ny + 1):
            t = j / ny
            hump = 0.22 + 0.78 * (abs(u) ** 1.7)
            z = z1 + 1.0 + rs * hump * (0.75 + 0.25 * (1 - abs(2 * t - 1) ** 2)) + _num(lip, 2.2, 0, 8) * math.exp(-(t / 0.1) ** 2) * (1 - abs(u) * 0.3)
            row.append((u * W2, -D2 + 2 * D2 * t, z))
        top.append(row)
    b.section('wing-roof')
    lib.roof_shell(b, top, _num(thickness, 0.55, 0.15, 2), lk, slot='metal-roof', col=lk.roof_col)


@placed
def conical_drum(b, look, rng, detail, radius=30.0, tiers=3, tierHeight=6.0, colour=None, roofColour=None, windows='ribbon'):
    lk = _L(look, colour, roofColour)
    R = _num(radius, 30, 6, 60)
    n = {0: 22, 1: 14, 2: 10}[detail]
    hh = _num(tierHeight, 6, 3, 14)
    b.section('conical-drum')
    z0, r = 0.0, R
    for t in range(int(_num(tiers, 3, 1, 5))):
        U.walls(b, lib.fp_round(r, n), z0, z0 + hh, 1, lk, rng, kind=windows, ratio=0.3, bay=4.0, plinth=0.0, rear='same')
        rn = r * 0.72
        lib.cylinder(b, 0, 0, z0 + hh, z0 + hh + hh * 0.55, r + 0.8, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=rn, top=False, smooth=False)
        z0 += hh + hh * 0.55
        r = rn
    lib.cylinder(b, 0, 0, z0, z0 + hh * 1.2, r + 0.4, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)


@placed
def ring_colonnade(b, look, rng, detail, radius=20.0, count=18, height=7.0, columnRadius=0.3, colour=None):
    lk = _L(look, colour)
    R, h = _num(radius, 20, 3, 60), _num(height, 7, 3, 20)
    n = int(_num(count, 18, 6, 48)) if detail == 0 else max(6, int(_num(count, 18)) // 2)
    b.section('ring-colonnade')
    if detail >= 2:
        lib.cylinder(b, 0, 0, h, h + 0.4, R + 0.5, n=10, slot='plain', col=lk.trim_col, top=True, smooth=False)
        return
    for i in range(n):
        a = 2 * math.pi * i / n
        lib.cylinder(b, R * math.cos(a), R * math.sin(a), 0, h, _num(columnRadius, 0.3, 0.1, 1.5), n=6, slot=lk.wall_slot, col=lk.trim_col, r_top=_num(columnRadius, 0.3), top=False)
    lib.cylinder(b, 0, 0, h, h + 0.4, R + 0.5, n=28 if detail == 0 else 14, slot=lk.wall_slot, col=lk.trim_col, r_top=R + 0.5, top=True, smooth=False)


@placed
def lattice_dome(b, look, rng, detail, radius=30.0, height=20.0, baseHeight=7.0, ribs=True, glassColour='#cfdde6', ribColour=None):
    lk = _L(look)
    R, zb = _num(radius, 30, 6, 60), _num(baseHeight, 7, 0, 20)
    top = _num(height, 20, 4, 50)
    n = {0: 36, 1: 18, 2: 10}[detail]
    rings = {0: 10, 1: 5, 2: 3}[detail]
    b.section('lattice-dome')
    U.walls(b, lib.fp_round(R, n), 0, zb, 2, lk, rng, kind='curtain', bay=4.0, plinth=0.0, rear='same')
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    curve = [(R * math.cos(j / rings * math.pi / 2) ** 0.95, zb + top * math.sin(j / rings * math.pi / 2) ** 1.1) for j in range(rings + 1)]
    b.shared_grid([[(rr * math.cos(a), rr * math.sin(a), zz) for rr, zz in curve] for a in angs], 'glass-curtain', glassColour, smooth=True, wrap=True, scale=1.5)
    if ribs and detail == 0:
        rc = ribColour or lk.metal_col
        for k in range(0, n, 3):
            a = angs[k]
            for (r0, z0), (r1, z1) in zip(curve[:-1], curve[1:]):
                tx, ty = -math.sin(a) * 0.12, math.cos(a) * 0.12
                pa = (r0 * math.cos(a) * 1.01, r0 * math.sin(a) * 1.01, z0)
                pb = (r1 * math.cos(a) * 1.01, r1 * math.sin(a) * 1.01, z1)
                b.face([(pa[0] - tx, pa[1] - ty, pa[2]), (pa[0] + tx, pa[1] + ty, pa[2]), (pb[0] + tx, pb[1] + ty, pb[2]), (pb[0] - tx, pb[1] - ty, pb[2])], 'frame', rc)
        for (r0, z0) in curve[2:-1:2]:
            lib.cylinder(b, 0, 0, z0 - 0.1, z0 + 0.1, r0 * 1.012, n=n, slot='frame', col=rc, r_top=r0 * 1.012, top=False, smooth=False)


@placed
def cap_roof(b, look, rng, detail, radius=34.0, crown=24.0, visor=0.5, colour=None):
    lk = _L(look, None, colour)
    R, ch = _num(radius, 34, 8, 60), _num(crown, 24, 6, 50)
    n = {0: 32, 1: 18, 2: 10}[detail]
    b.section('cap')
    curve = [(R * 1.25, 0.0), (R * 1.18, ch * 0.12), (R * 0.95, ch * 0.45), (R * 0.62, ch * 0.8), (R * 0.28, ch * 0.97), (0.0, ch)]
    if detail == 2:
        curve = [curve[0], curve[2], curve[4], curve[5]]
    grid = []
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        v = 1.0 + _num(visor, 0.5, 0, 1.2) * max(0.0, -math.sin(a)) ** 3
        grid.append([(rr * v * math.cos(a), rr * v * math.sin(a), zz + (3.0 * max(0.0, -math.sin(a)) ** 3 if rr > 0.5 * R else 0.0)) for rr, zz in curve])
    b.shared_grid(grid, 'metal-roof', lk.roof_col, smooth=True, wrap=True, scale=1.5)


@placed
def fly_tower(b, look, rng, detail, width=24.0, depth=16.0, height=32.0, colour=None, louvres=True):
    lk = _L(look, colour)
    w, d, h = _num(width, 24, 6, 80), _num(depth, 16, 6, 60), _num(height, 32, 8, 60)
    b.section('fly-tower')
    fp = lib.fp_rect(w, d, 0, 0)
    U.walls(b, fp, 0, h, 1, lk, rng, kind='none', plinth=0.0)
    lib.flat_roof(b, fp, h, lk, parapet_h=0.0)
    if detail < 2:
        U.eaves_band(b, fp, h + 0.6, lk, 0.6, 0.5, col=shade(lk.wall_col, 0.9))
    if louvres and detail == 0:
        for s in fp.edges():
            if s.length > 8:
                lib.seg_box(b, s, s.length * 0.15, s.length * 0.85, h - 3.0, h - 1.4, 0.1, shade(lk.wall_col, 0.8), 'metal-cladding')


@placed
def amphitheatre(b, look, rng, detail, radius=18.0, tiers=6, stage=True, shelter=True, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    R = _num(radius, 18, 5, 50)
    n = {0: 24, 1: 14, 2: 8}[detail]
    nt = int(_num(tiers, 6, 2, 10)) if detail == 0 else min(4, int(_num(tiers, 6, 2, 10)))
    b.section('amphitheatre')
    for t in range(nt):
        r0, r1 = R * (0.35 + 0.65 * t / nt), R * (0.35 + 0.65 * (t + 1) / nt)
        zt = 0.45 * (t + 1)
        angs = [math.pi * k / n for k in range(n + 1)]
        top = [(r1 * math.cos(a), r1 * math.sin(a) * 0.9 + 4.0, zt) for a in angs]
        low = [(r0 * math.cos(a), r0 * math.sin(a) * 0.9 + 4.0, zt) for a in angs]
        for k in range(n):
            b.facing([low[k], low[k + 1], top[k + 1], top[k]], (0, 0, 1), 'paving', '#bdb6a6')
            b.facing([(top[k][0], top[k][1], zt), (top[k + 1][0], top[k + 1][1], zt), (top[k + 1][0], top[k + 1][1], zt - 0.45), (top[k][0], top[k][1], zt - 0.45)],
                     (math.cos((angs[k] + angs[k + 1]) / 2), math.sin((angs[k] + angs[k + 1]) / 2), 0), 'rough-concrete', '#a9a398')
    if stage:
        lib.box(b, -R * 0.45, -R * 0.55, 0, R * 0.45, 3.0, 0.9, 'timber', '#8a6a4a', top_slot='timber', top_col='#7a5a3c', skip=('bottom',))
        if shelter and detail < 2:
            for sx in (-R * 0.42, R * 0.42):
                lib.cylinder(b, sx, -R * 0.52, 0.9, 5.2, 0.14, n=5, slot='frame', col='#8d9298', r_top=0.14, top=False)
            lib.box(b, -R * 0.5, -R * 0.6, 5.2, R * 0.5, 3.0, 5.5, 'metal-cladding', lk.roof_col, top_slot=lk.roof_slot, top_col=lk.roof_col, skip=())


@placed
def sawtooth_roof(b, look, rng, detail, width=40.0, depth=20.0, teeth=6, rise=2.4, colour=None, roofColour=None):
    lk = _L(look, colour, roofColour)
    b.section('sawtooth')
    lib.sawtooth(b, (-_num(width, 40, 6, 120) / 2, -_num(depth, 20, 4, 80) / 2, _num(width, 40) / 2, _num(depth, 20) / 2), 0.0, _num(rise, 2.4, 0.8, 6), lk,
                 teeth=int(_num(teeth, 6, 2, 20)), axis='x', glaze='front')


@placed
def hex_pod(b, look, rng, detail, radius=6.0, height=4.5, roofRise=5.0, colour=None, roofColour=None, sides=6):
    lk = _L(look, colour, roofColour)
    r, h = _num(radius, 6, 1.5, 20), _num(height, 4.5, 2.4, 14)
    n = int(_num(sides, 6, 4, 10))
    b.section('hex-pod')
    U.walls(b, lib.fp_round(r, n), 0, h, 1, lk, rng, kind='punched', ratio=0.2, plinth=0.0, rear='same')
    lib.cylinder(b, 0, 0, h, h + _num(roofRise, 5, 0.5, 20), r + 0.3, n=n, slot=lk.roof_slot, col=lk.roof_col, r_top=0.0, top=False, smooth=False)


@placed
def mud_dome_studio(b, look, rng, detail, radius=3.8, wallHeight=3.2, domeHeight=3.4, colour=None, door=True):
    lk = _L(look, colour)
    r = _num(radius, 3.8, 1.5, 12)
    zh = _num(wallHeight, 3.2, 1.5, 8)
    b.section('mud-dome')
    lib.box_c(b, 0, 0, 0, r * 2, r * 2, zh, 'mud-render' if lk.wall_slot == 'plain-render' else lk.wall_slot, lk.wall_col, skip=('bottom',))
    lib.dome(b, 0, 0, zh, r, lk, profile='hemi', height=_num(domeHeight, 3.4, 0.8, 12), slot='mud-render', col=mix(lk.wall_col, '#ffffff', 0.1))
    if door and detail < 2:
        seg = lib.Seg((-r, -r), (r, -r))
        U.door(b, seg, r, 1.2, 2.0, col='#3a2a20', frame=lk.trim_col)


@placed
def cannon(b, look, rng, detail, colour='#2e3033', heading=90.0, count=1, spacing=2.0):
    b.section('cannon')
    for k in range(int(_num(count, 1, 1, 6))):
        U.cannon(b, k * _num(spacing, 2.0, 1, 10), 0, _heading_rad(heading), colour)
        if detail >= 1 and k == 0:
            with b.site():
                lib.box_c(b, 0, 0, 0, 0.5, 1.8, 0.6, 'plain', colour)


@placed
def statue_on_plinth(b, look, rng, detail, height=4.5, plinthHeight=None, colour='#6b5a3c', plinthColour='#bdb6a6'):
    b.section('statue')
    U.statue(b, 0, 0, _num(height, 4.5, 1.5, 20), col=colour, plinth_col=plinthColour, plinth_h=_num(plinthHeight, 0, 0, 12) or None)


@placed
def fountain(b, look, rng, detail, radius=3.5, waterColour='#6fa8c4', rimColour='#cfcac0'):
    b.section('fountain')
    U.fountain(b, 0, 0, _num(radius, 3.5, 1, 20), water=waterColour, rim=rimColour)


@placed
def obelisk(b, look, rng, detail, height=18.0, baseWidth=2.4, colour='#c8c2b2', pedestal=True):
    b.section('obelisk')
    h, w = _num(height, 18, 4, 80), _num(baseWidth, 2.4, 0.6, 10)
    z = 0.0
    if pedestal:
        lib.box_c(b, 0, 0, 0, w * 2.2, w * 2.2, 0.5, 'stone-blocks', shade(colour, 0.9), skip=('bottom',))
        lib.box_c(b, 0, 0, 0.5, w * 1.6, w * 1.6, 1.0, 'stone-blocks', shade(colour, 0.95), skip=('bottom',))
        z = 1.5
    shaft = h - z - w * 0.9
    U.frustum_sq(b, 0, 0, z, z + shaft, w, w * 0.62, 'stone-blocks', colour)
    U.frustum_sq(b, 0, 0, z + shaft, z + shaft + w * 0.9, w * 0.62, 0.04, 'stone-blocks', shade(colour, 1.06))


@placed
def reflecting_pool(b, look, rng, detail, width=24.0, depth=14.0, colour='#6fa8c4', edgeColour='#c8c4ba'):
    w, d = _num(width, 24, 2, 100), _num(depth, 14, 2, 80)
    b.section('pool')
    with b.site():
        b.face([(-w / 2, -d / 2, 0.1), (w / 2, -d / 2, 0.1), (w / 2, d / 2, 0.1), (-w / 2, d / 2, 0.1)], 'plain-render', colour)
        if detail == 0:
            lib.box(b, -w / 2 - 0.5, -d / 2 - 0.5, 0, w / 2 + 0.5, -d / 2, 0.4, 'paving', edgeColour)
            lib.box(b, -w / 2 - 0.5, d / 2, 0, w / 2 + 0.5, d / 2 + 0.5, 0.4, 'paving', edgeColour)
            lib.box(b, -w / 2 - 0.5, -d / 2, 0, -w / 2, d / 2, 0.4, 'paving', edgeColour)
            lib.box(b, w / 2, -d / 2, 0, w / 2 + 0.5, d / 2, 0.4, 'paving', edgeColour)


@placed
def podium_platform(b, look, rng, detail, width=100.0, depth=76.0, height=1.2, steps=5, stepsWidth=0.6, colour=None):
    lk = _L(look, colour)
    w, d, h = _num(width, 100, 6, 140), _num(depth, 76, 6, 140), _num(height, 1.2, 0.3, 6)
    b.section('podium')
    lib.box(b, -w / 2, -d / 2, 0, w / 2, d / 2, h, 'stone-blocks', shade(lk.stone_col, 0.95), top_slot='paving', top_col=mix(lk.stone_col, '#ffffff', 0.2), skip=('bottom',),
            scale=6.0 if detail == 0 else 16.0)
    if detail < 2 and int(steps) > 0:
        sw = w * _num(stepsWidth, 0.6, 0.1, 1.0)
        lib.steps(b, -sw / 2, sw / 2, -d / 2, h, min(0.4 * int(steps), 6.0), int(_num(steps, 5, 1, 14)), 'paving', lk.stone_col)


@placed
def cinema_canopy(b, look, rng, detail, width=24.0, depth=3.2, height=3.6, finHeight=14.0, colour=None, finColour=None, neon=True):
    lk = _L(look, colour)
    w, d, h = _num(width, 24, 4, 60), _num(depth, 3.2, 1.5, 8), _num(height, 3.6, 2.6, 8)
    b.section('cinema-canopy')
    U.entrance_canopy(b, lk, -w / 2, w / 2, 0.0, h, d, th=0.5, columns=0, col=finColour or lk.accent_col)
    if detail < 2:
        fx = w / 2 - 2.0
        lib.box_c(b, fx, -0.4, 3.0, 1.0, 0.5, _num(finHeight, 14, 3, 40) - 3.0 + 4.0, 'plain', finColour or lk.accent_col, skip=('bottom',))
        if neon and detail == 0:
            lib.box_c(b, 0.0, -d - 0.05, h - 0.25, w * 0.8, 0.08, 0.14, 'plain', '#f2d24a')


@placed
def courtyard_garden(b, look, rng, detail, width=14.0, depth=10.0, fountainRadius=0.0, trees=3, paths=True):
    w, d = _num(width, 14, 3, 100), _num(depth, 10, 3, 100)
    b.section('courtyard')
    U.courtyard_garden(b, look, (-w / 2, -d / 2, w / 2, d / 2), rng, fountain_r=_num(fountainRadius, 0, 0, 10), trees=int(_num(trees, 3, 0, 20)), path=bool(paths))


PARTS = {
    'red-cross-plate': red_cross_plate, 'ambulance': ambulance, 'ambulance-bay': ambulance_bay, 'helipad': helipad, 'road-sign-pylon': road_sign_pylon,
    'covered-walkway': covered_walkway, 'lean-to-veranda': veranda, 'gallery': gallery, 'canopy-fascia': entrance_canopy, 'roof-monitor': roof_monitor,
    'brick-stack': chimney, 'stair-tower': stair_tower, 'roof-tank': roof_tank, 'roof-board': roof_sign, 'guard-kiosk': kiosk, 'pickup': pickup,
    'umbrella-group': umbrella_cluster, 'shed-shelter': shed_shelter,
    'clock-tower-square': clock_tower, 'turret-conical': turret, 'gatehouse-arched': gatehouse, 'arch-portal': arch_portal, 'iwan': iwan, 'zaure-gatehouse': zaure_gatehouse,
    'zankwaye-pinnacle': pinnacle, 'merlon-wall': crenellated_wall, 'stepped-buttresses': buttress_row, 'fin-row': fin_row, 'balcony-bands': balcony_bands,
    'pilotis-row': pilotis_row, 'arcade-bays': arcade, 'loggia': loggia, 'portico-pedimented': portico_pedimented, 'dome-colonnaded': dome_colonnaded,
    'corner-tower-domed': corner_tower_domed, 'setback-tower': setback_tower, 'balustrade': balustrade, 'lattice-mast': lattice_mast, 'pillar-box': pillar_box,
    'sail-shell': sail_shell, 'sail-cluster': sail_cluster, 'wing-roof': wing_roof, 'conical-drum': conical_drum, 'ring-colonnade': ring_colonnade,
    'lattice-dome': lattice_dome, 'cap-roof': cap_roof, 'fly-tower': fly_tower, 'amphitheatre': amphitheatre, 'sawtooth-roof': sawtooth_roof,
    'hex-pod': hex_pod, 'mud-dome-studio': mud_dome_studio, 'cannon-carriage': cannon, 'statue-on-stepped-plinth': statue_on_plinth, 'basin-fountain': fountain,
    'obelisk-pedestal': obelisk, 'reflecting-pool': reflecting_pool, 'podium-platform': podium_platform, 'cinema-canopy': cinema_canopy,
    'courtyard-garden': courtyard_garden,
}
