"""Parts for towers, offices, hotels, industry, transport and country houses: the signature pieces of the office-tower, office-low, hotel,
industrial, transport-station and manor archetypes as reusable PARTS for the per-place composer.

    PARTS = {'part-id': fn}     fn(b, look, rng, detail, at=(x, y, z), rot=0.0, **params)

Conventions (same as the other parts files)
  * `at` is the part origin in metres (+x right, +y away from the camera, z up); `rot` is the yaw in DEGREES, counter-clockwise from above.
  * A part is built in its own frame and merged into `b` transformed by `at` and `rot`. Wall-type parts (facade-wall, brand-band, relief-band,
    brise-soleil, balcony-pods, verandah-arcade, two-level-gallery, manor-facade, half-timber-wall, x-bracing, glass-lobby, porte-cochere,
    slab-entrance-canopy, station-canopy) are centred on x with the wall plane at y=0, their front towards -Y; anything attached to the wall
    projects towards -Y (canopies, verandahs, fins) and depth runs into +Y. Volumes (tower-block, round-tower, tank, warehouse-shed, silo-bank,
    cargo-ship ...) are centred on the origin on z=0 with their front (entrance, doors, -Y wall) towards -Y. Anything that stands on a roof
    (tower-crown, rooftop-plant, rooftop-helipad, parapet-merlons, tudor-chimney, corner-pinnacle) is built from z=0: put `at.z` at the roof.
  * Sizes are metres, colours '#hex'. Every part also accepts the look overrides wall_colour wall_material roof_colour roof_material
    trim_colour accent_colour (colour of walls / roof / trim / accent for that part only); unknown params are ignored and listed in
    `b.part_warnings`. Colours left as None come from the place's look (city style).
  * detail 0/1/2 = LOD0/1/2: LOD0 is the full part, LOD1 groups storeys / drops small furniture, LOD2 is a coloured massing. Deterministic.
  * Typical cost at LOD0: 20-700 triangles; tall facades, tank-farm and tower-block scale with their storeys / counts (a 26-storey tower is
    about 3-5k). Every part respects the 20,000 / 4,000 / 500 triangle budgets in proportion.


TOWERS

 facade-wall: width=24.0 height=14.0 floors=4 kind='ribbon' window_ratio=0.5 bay=3.6 fins=0.0 bands=None band_height=0.4 band_depth=0.3
     deep=False glass_colour=None balcony_pods=False plant_band=False coarse=1.0 corner=0.5
     One multi-storey wall (centred on x, front towards -Y, base on z=0): kind curtain (glass tiles per storey, optional vertical fins or
     floor-edge bands) | ribbon (strip windows between slab edges) | punched (window per bay) | screen (dense fins over glass) | plain.
     bands='#hex' draws a projecting slab edge every storey; balcony_pods adds individual balconies; plant_band a louvred refuge floor.
 tower-block: width=36.0 depth=26.0 height=60.0 storeys=0 shape='rect' facade='curtain' window_ratio=0.5 bay=3.6 fins=0.0 bands=None
     glass_colour=None balcony_pods=False plant_band=False setback_at=0.0 setback_inset=0.1 parapet=1.0 roof=True coarse=1.0 deep=False
     A tall prism skinned storey by storey: plan shape rect | chamfer (cut corners) | tri (point to the camera) | round | oval | L | T,
     facade curtain | ribbon | punched | screen, optional fins/bands/balcony pods, a louvred plant floor at 55 % height, a flat roof with
     parapet. setback_at (0..1 of the height, e.g. 0.62) steps the upper block in by setback_inset * the smaller plan side.
 stepped-tower: width=40.0 depth=30.0 height=90.0 tiers=3 shrink=0.8 storeys=0 facade='punched' window_ratio=0.38 deco_piers=True
     cornices=True planters=True terrace_colour=None
     A stepped (wedding-cake / art-deco / masonry) tower: `tiers` boxes (2-4), each `shrink` times narrower than the one below and shifted
     towards the back, pier-and-window walls, cornice and parapet at each setback, planters on the terraces.
 round-tower: radius=16.0 radius_y=0.0 height=100.0 storeys=0 profile='bulge' glass_colour=None band_every=4 dome=True plinth=True
     A cylindrical / oval tower lofted through rings: profile bulge (widest at 55 %, tapering to a tip) | taper | straight; glass skin
     tiled per storey, a floor-edge band every `band_every` storeys, shallow glazed dome and a needle on top, optional plinth drum.
 tower-crown: kind='cap' width=24.0 depth=20.0 floor_height=3.6
     The top of a tower, standing on a flat roof of width x depth at z=0: cap (glazed lantern floors under a sloping trim roof) | pod
     (ridged ellipsoid on a drum, a restyled cocoa-pod crown) | spire (art-deco stepped pinnacle with a needle) | pyramid (tall hip roof)
     | dome (drum, dome, lantern) | frame (open steel crown) | screen (louvred plant enclosure) | pent (glazed pent-roof top) | stub
     (smaller stepped plant tier).
 radio-mast: height=14.0 radius=0.25 banded=True colour='#c9ced2'
     A tapering lattice-style radio mast with cross arms; banded=True paints red/white aviation bands.
 rooftop-helipad: radius=7.0 colour='#6a6e72' stand=True
     A circular helipad slab with a white ring and H mark (and a short stand), its top about 0.4 m above z=0.
 rooftop-plant: width=30.0 depth=20.0 water_tank=False solar=False
     Roof clutter on a flat roof of width x depth at z=0: a plant room, lift overrun, small units, optional water tank and solar rows.
 podium-base: width=70.0 depth=34.0 floors=2 floor_height=3.8 upper='ribbon' ground='curtain'
     A wide commercial podium centred on the origin: glazed ground storey, ribbon (or punched) upper storeys, flat roof with parapet.
 pilotis-base: width=60.0 depth=18.0 height=6.2
     The open ground storey of a tower on pilotis: a recessed glazed core and a ring of square concrete columns (the tower sits above).
 porte-cochere: width=16.0 depth=7.5 height=4.6
     A drive-through entrance canopy projecting towards -Y from a wall at y=0: flat slab with accent fascia on slim columns, steps, paved
     drive.
 glass-lobby: width=16.0 height=8.0 curtain_colour=None
     A glazed lobby box leaning on a wall at y=0 (7 m deep, towards -Y) with a sloping glass roof rising to the wall.
 x-bracing: width=30.0 height=40.0 floors=10 panel_floors=4 colour='#6c7479'
     Large steel X-bracing panels drawn as proud strips across a wall at y=0 (high-tech / diagrid look); LOD0 only.
 sky-bridge: length=7.0 depth=10.0 height=7.0 colour=None
     A glazed bridge box between two towers: length along x, depth along y, standing on z=0 (raise it with at.z).

OFFICES (LOW-RISE)

 brand-band: length=24.0 height=9.0 panel_width=3.4 panel_side='left' cap=True colour=None
     A bank branch's colour branding on a front wall at y=0: a full-height vertical panel at one end and a projecting cap band along the
     parapet.
 atm-booth: width=2.4 depth=2.0 height=2.7 colour=None sign_colour=None
     A small ATM / guard booth with a glazed front (towards -Y) and a blank sign band.
 pylon-sign: height=7.0 width=2.0 colour=None
     A free-standing pylon sign: pole and a blank board near the top.
 slab-entrance-canopy: width=10.0 depth=4.2 height=4.3 columns=2 colour=None edge_colour=None steps=True
     A flat entrance canopy projecting towards -Y from a wall at y=0: slab with a coloured fascia on round columns, two entrance steps.
 relief-band: length=20.0 height=0.9 colour=None kind='diamond' count=0
     A band of geometric relief (diamond | zigzag) proud of a wall at y=0, bottom at z=0 (Hausa-Arewa parapets).
 corner-pinnacle: height=2.6 width=0.65 sides=4 colour=None
     A Hausa-style tapering corner pinnacle (frustum with a stepped cap) standing on z=0.
 parapet-merlons: length=20.0 depth=0.0 height=0.9 merlon=0.9 gap=0.8 colour=None
     Crenellations (merlons) along the edges of a roof outline length x depth (depth 0 = a single run along x), bottom on z=0.
 brise-soleil: length=20.0 height=10.0 pitch=2.4 depth=0.5 colour=None base=0.4
     A row of vertical sun-breaker fins standing off a wall at y=0 (fins every `pitch` m, `depth` proud).
 balcony-pods: length=20.0 floors=5 floor_height=3.4 every=2 depth=1.3 colour=None rail_colour='#3a3d41' skip_ground=True
     Individual projecting balconies (slab and railing, 3.4 m bays, `every` bays each) on every storey of a wall at y=0. LOD0 only.
 verandah-arcade: length=24.0 depth=2.8 height=3.4 count=0 kind='round' colour=None
     A verandah along a wall at y=0 (towards -Y): posts (round | square) or arches under a sloping roof; `count` posts (0 = every ~3 m).
 two-level-gallery: length=30.0 depth=2.6 floors=2 floor_height=3.6 posts_every=3.0 colour=None
     A colonial two-level colonnaded gallery on a wall at y=0: square posts, a balcony deck with balustrade at each level.

HOTEL

 swimming-pool: width=14.0 length=8.0 umbrellas=3 water_colour='#3fa7c7' coping_colour='#d9d4c8'
     A swimming pool (water, coping ring) with loungers and umbrellas; width along x, length along y, centred on the origin.
 chalet: width=5.5 depth=6.5 height=3.0 thatch=False colour=None
     A small hip-roofed chalet / bungalow with a porch step and a front window; front towards -Y.
 bar-pavilion: radius=3.4 height=2.6 thatch=True
     An open round bar / gazebo: posts round a paved ring under a conical thatch (or tile) roof.

INDUSTRIAL

 storage-tank: radius=9.0 height=14.0 roof='cone' stairs=True colour='#d9dcde'
     A vertical steel storage tank (courses of cladding): roof cone | floating (open top with a wind girder and inner deck) | dome; spiral
     stair.
 tank-farm: count=4 rows=2 radius=8.0 height=12.0 bund=True colour='#d9dcde'
     A group of storage tanks (rows x columns, alternating roof types) in a paved containment bund, centred on the origin.
 process-column: radius=2.2 height=40.0 platforms=True colour='#b9bec2'
     A refinery process column (fractionating tower): tall steel shell on a concrete skirt, dome head, platforms every 6.5 m, ladder cage,
     pipe.
 pipe-rack: length=60.0 height=7.0 levels=2 width=3.6 pipes=5 colour='#7e8a92'
     An elevated pipe rack along x (centred): portal frames every 6 m with bracing and a bundle of `pipes` pipes per level.
 heat-exchanger: length=8.0 radius=1.2 colour='#8f9aa1'
     A horizontal shell-and-tube vessel on two concrete saddles (long axis along x).
 furnace-stack: width=8.0 depth=6.0 height=9.5 stack_height=20.0 colour='#a8aeb2'
     A fired heater: clad box with a tall convection stack on top.
 banded-stack: height=30.0 radius=1.8 bands=True colour='#c9c6bd'
     A tapering concrete chimney with red/white obstruction bands (LOD0) and a dark top ring.
 flare-stack: height=60.0
     A flare stack: slim tapered tower with platforms, four guy cables and a flame (orange and yellow cones) at the tip.
 lpg-sphere: radius=6.0 colour='#d8dcdf'
     A spherical pressure vessel on six legs and a concrete pad.
 containment-bund: width=40.0 depth=30.0 height=1.1 colour='#b8b4aa'
     A paved floor with a low concrete containment wall round it, centred on the origin.
 silo-bank: nx=3 ny=2 radius=4.0 height=32.0 headhouse=True colour='#c9c6bd'
     A bank of touching concrete silos (slip-form courses) with a headhouse gallery on top, centred on the origin.
 conveyor-gantry: dx=20.0 dy=0.0 start_height=20.0 end_height=18.0 colour='#8d9298'
     An inclined conveyor walkway from the origin (at height start_height) to (dx, dy) at end_height, on trestle supports.
 warehouse-shed: width=40.0 depth=20.0 height=8.0 roof='gable' doors=3 colour=None roof_colour=None rise=0.0 teeth=0
     A ribbed-metal shed centred on the origin: plinth, clerestory band and roller doors on the -Y wall, roof gable | shed | sawtooth |
     flat.
 container-stack: nx=3 ny=3 levels=3 pitch_x=12.6 pitch_y=2.7
     A block of shipping containers (12.2 m, mixed colours, ribbed sides) nx long x ny wide x `levels` high, centred on the origin.
 quay-crane: height=42.0 reach=34.0 colour='#2f6f9a'
     A ship-to-shore container crane on rails: portal legs, girders, machinery house, raised boom reaching `reach` m towards +Y, back-
     reach.
 cargo-ship: length=84.0 width=15.0 hull_colour='#3a3f48' stripe_colour='#b03a2e'
     A container ship moored along x, centred on the origin: tapered hull, container rows on deck, stern bridge block and funnel.
 water-tower: height=16.0 radius=3.4 colour='#c9ccd0'
     An elevated steel water tank on a braced four-leg tower.

TRANSPORT

 rail-track: length=60.0 tracks=1 spacing=5.4 gauge=1.435
     Railway track along x (centred): ballast bed, two rails and sleepers (LOD0); tracks > 1 gives parallel tracks `spacing` m apart along
     y.
 station-platform: length=60.0 depth=7.0 height=1.0 colour='#b9b4aa'
     A raised paved passenger platform with a yellow safety strip on its +Y edge; centred on x, front edge at y=0, extends towards +Y.
 station-canopy: length=60.0 depth=6.4 height_inner=7.0 height_outer=3.6 kind='iron' attached=True colour=None
     A platform roof along x: attached=True slopes from a building wall at y=0 down to posts at y=depth; attached=False is a free-standing
     shelter roof centred on y=0. kind iron (brackets) | flat. Posts on a 7 m pitch, blank fascia.
 train: carriages=3 colour='#2f5f8a' loco_colour='#b03a2e' z=0.4
     A locomotive and carriages standing on a track along x (loco at the -X end), centred roughly on the origin; z = rail-bed height.
 minibus: colour='#e6b422' stripe='#1f1f22' count=1 spacing=2.9 yaw=90.0
     A minibus / danfo van (5 m); count > 1 gives a row along x at `spacing`, all facing `yaw` degrees (90 = towards +Y).
 coach: colour='#f1f1ee' stripe='#c8362f' count=1 spacing=3.5 length=11.0 yaw=90.0
     An intercity coach (11 m); count > 1 gives a row along x.
 bus-park-row: length=50.0 kind='mixed' density=0.7 coach_share=0.3 colours=None yaw=90.0 lines=True
     A row of parked vehicles along x (centred, bay lines on the ground): kind van | coach | mixed | taxi, `density` 0..1 of bays filled,
     colours list.
 open-shelter: length=30.0 depth=8.0 height=4.5 form='shed' support='steel' colour=None accent=None
     An open passenger shelter along x, centred on the origin: roof shed (mono-pitch) | gable | flat | curved (barrel vault) | sawtooth,
     on steel posts or square concrete pillars, with benches (LOD0).
 ticket-kiosk: width=2.6 depth=2.2 height=2.6 colour=None sign_colour='#2f6b4f'
     A ticket kiosk: box with a glazed hatch, a projecting roof slab and a blank sign board on its -Y face.
 gateway-arch: width=10.0 height=5.6 kind='arch' colour=None accent=None
     The gateway over a yard entrance (opening along x, centred): two piers carrying a semicircular arch (or a straight beam) with a blank
     sign panel.
 train-shed: length=60.0 span=22.0 height=9.0 rise=5.0 end_glass='#cfd8dd'
     A train shed: a barrel vault (glazed gable ends) on steel columns every 8 m over the tracks, running along x, centred on the origin.
 ferry-jetty: length=54.0 width=6.0 shelter=True timber=False colour=None
     A passenger jetty extending towards +Y from y=0 on piles with bollards, an optional shelter roof on posts; timber=True uses planks.
 launch-boat: length=9.0 width=2.6 colour='#2f5f8a' yaw=90.0
     A small passenger launch / pirogue: tapered hull, cabin box and canopy; bow towards `yaw` degrees (90 = +Y).
 metro-portal: width=12.0 depth=11.0 accent=None kiosk=True
     A metro / underground entrance: concrete balustrade walls round a stair well under a sloping glass canopy, a ring pylon sign and an
     optional kiosk.
 quay: length=80.0 depth=30.0 water_depth=36.0 bollards=True
     A cargo quay centred on x: paved slab (front edge y=-depth) with a fender kerb and bollards along its +Y edge (y=0), water beyond to
     +water_depth.

MANOR

 manor-facade: width=24.0 height=8.0 floors=2 style='georgian' door=True arches=False shutter_colour=None colour=None trim=None
     One house front at y=0 (centred, towards -Y): style georgian (sash windows with sills and lintels, string course, quoins) | tudor
     (wide mullioned windows) | colonial (shuttered windows) | castle (arched windows, quoins) | house | bungalow; a central door;
     arches=True makes the ground-floor windows round-headed.
 half-timber-wall: width=20.0 height=7.0 floors=2 close=False timber_colour='#3b2c20' plaster_colour=None windows=True
     A Tudor half-timbered wall at y=0 (centred, towards -Y): rendered panels with floor rails, studs every bay, end braces and mullioned
     windows (close=True gives close studding). LOD0 timber only.
 tudor-chimney: height=3.8 flues=3 width=1.0 depth=1.0 colour='#9a4a36'
     A tall brick chimney stack with a stone cap and `flues` terracotta pots side by side, standing on z=0.
 round-turret: radius=2.4 height=9.0 cap='cone' colour=None
     A round castle turret with slit windows, a corbelled top ring and a conical cap (or a flat top).
 parterre: width=10.0 depth=12.0
     A clipped-hedge parterre on gravel: four flower beds outlined by box hedges with topiary cones, centred on the origin.
 topiary: height=2.0 count=1 spacing=2.5 colour='#3d6f38'
     Clipped conical topiary on short trunks; count > 1 makes a row along x.
 tree-avenue: length=60.0 count=7 kind='broadleaf' gap=4.5 height_min=8.0 height_max=11.0
     Two rows of trees flanking a drive that runs along +Y from the origin: `count` per side, `gap` m either side of the centre line.
 ball-gate-piers: gap=5.0 height=2.6 colour=None
     Two stone gate piers with ball finials either side of an opening of width `gap` (along x, centred).
 gate-lodge: width=5.0 depth=4.5
     A small gate lodge / watch house with a hipped roof and a door on its -Y face.
 outbuilding: width=6.0 depth=3.6 height=2.6
     A boys'-quarters / generator house: low rendered block under a mono-pitch corrugated roof.
 garden-bed: width=4.0 depth=2.8 colour='#b8586a' hedge=True
     A flat flower bed (coloured quad on a lawn) with an optional low box-hedge outline, centred on the origin.
"""
import copy
import importlib.util
import inspect
import math
import os
import random
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ARCH = os.path.join(os.path.dirname(_HERE), 'archetypes')
for _p in (_HERE, _ARCH, os.path.dirname(_HERE)):
    if _p not in sys.path:
        sys.path.insert(0, _p)
from _xform import Xform  # noqa: E402

import lib  # noqa: E402
import _office_tower_util as U  # noqa: E402

PARTS = {}
PART_PARAMS = {}
LOOK_KEYS = ('wall_colour', 'wall_material', 'roof_colour', 'roof_material', 'trim_colour', 'accent_colour')
_mods = {}


def _mod(name):
    """Load one of my archetype modules (office-tower, office-low, hotel, industrial, transport-station, manor) by path, once."""
    if name not in _mods:
        spec = importlib.util.spec_from_file_location('_pt_' + name.replace('-', '_'), os.path.join(_ARCH, name + '.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _mods[name] = m
    return _mods[name]


def _look(look, kw):
    lk = copy.copy(look)
    fm = sys.modules.get('lib.facade')
    ws, rs = fm.WALL_SLOT, fm.ROOF_SLOT
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
    """Register a raw part `raw(b, lk, S, **params)`: b = builder proxy placed at `at`/`rot`, lk = look with the *_colour/*_material
    overrides applied, S = U.Streams (named deterministic random streams). Unknown params are reported in `b.part_warnings`."""
    def deco(raw):
        sig = inspect.signature(raw)
        names = [p for p in sig.parameters if p not in ('b', 'lk', 'S')]

        def fn(b, look, rng, detail, at=(0.0, 0.0, 0.0), rot=0.0, **params):
            bad = [k for k in params if k not in names and k not in LOOK_KEYS]
            if bad:
                if not hasattr(b, 'part_warnings'):
                    try:
                        b.part_warnings = []
                    except Exception:  # noqa: BLE001
                        pass
                try:
                    b.part_warnings.append(f'part {name}: unknown params {bad} ignored; known: {names + list(LOOK_KEYS)}')
                except Exception:  # noqa: BLE001
                    pass
            lk = _look(look, params)
            args = {k: v for k, v in params.items() if k in names}
            S = U.Streams(random.Random(rng.getrandbits(64)))
            bb = Xform.make(b, at, rot)
            return raw(bb, lk, S, **args)
        fn.__name__ = name
        fn.__doc__ = raw.__doc__
        PARTS[name] = fn
        PART_PARAMS[name] = {p: sig.parameters[p].default for p in names}
        return raw
    return deco


def _n(v, default, lo=None, hi=None):
    try:
        v = float(v)
    except (TypeError, ValueError):
        v = float(default)
    if v != v:
        v = float(default)
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


def _P(**kw):
    """A synthetic archetype 'plan' dict with the keys the archetype helpers read."""
    P = {'feats': {}, 'txt': '', 'sty': 'contemporary', 'dress': 'modern', 'kind': 'ribbon', 'fh': 3.6, 'est': 0.0, 'crown': None, 'tint': 'accent',
         'pat': 'fins', 'typ': 'slab', 'shape': 'rect', 'roof': 'flat', 'setting': {}, 'storeys': 4, 'W': 30.0, 'D': 20.0, 'H': 20.0, 'yr': 2000, 'fpk': 'rect',
         'mast': False, 'mast_h': 0.0, 'helipad': False}
    P.update(kw)
    return P


def _feats(**flags):
    return {k: {'id': k, 'count': 1} for k, v in flags.items() if v}


def _wall(width, y=0.0):
    """A wall segment along x centred on the part origin, outward (front) towards -Y: Seg.P(u, z, d): u from the left end, d into +Y."""
    return lib.Seg((-width / 2, y), (width / 2, y))


def _shape_fp(shape, W, D):
    if shape == 'chamfer':
        c = min(W, D) * 0.2
        return lib.fp_polygon([(-W / 2 + c, -D / 2), (W / 2 - c, -D / 2), (W / 2, -D / 2 + c), (W / 2, D / 2 - c), (W / 2 - c, D / 2), (-W / 2 + c, D / 2),
                               (-W / 2, D / 2 - c), (-W / 2, -D / 2 + c)])
    if shape == 'tri':
        return lib.fp_polygon([(-W / 2, D / 2), (W / 2, D / 2), (0.0, -D / 2)])
    if shape in ('round', 'oval'):
        n = int(U.clamp(round(math.pi * (W + D) / 2 / 3.2), 14, 34))
        return lib.fp_polygon(U.ring_poly(0, 0, W / 2, (D if shape == 'oval' else W) / 2, n))
    if shape in ('L', 'T', 'U', 'H', 'cross'):
        return lib.footprint(shape, W, D, random.Random(7), 0)
    return lib.fp_rect(W, D)


# ====================================================================================================================== TOWERS
@part('facade-wall')
def facade_wall(b, lk, S, width=24.0, height=14.0, floors=4, kind='ribbon', window_ratio=0.5, bay=3.6, fins=0.0, bands=None, band_height=0.4,
                band_depth=0.3, deep=False, glass_colour=None, balcony_pods=False, plant_band=False, coarse=1.0, corner=0.5):
    """One multi-storey wall (centred on x, front towards -Y, base on z=0): kind curtain (glass tiles per storey, optional vertical fins or
    floor-edge bands) | ribbon (strip windows between slab edges) | punched (window per bay) | screen (dense fins over glass) | plain.
    bands='#hex' draws a projecting slab edge every storey; balcony_pods adds individual balconies; plant_band a louvred refuge floor."""
    W, H = _n(width, 24, 1, 120), _n(height, 14, 2, 140)
    fl = int(_n(floors, 4, 1, 60))
    seg = _wall(W)
    k = kind if kind in ('curtain', 'ribbon', 'punched', 'screen') else 'none'
    bnd = (_n(band_height, 0.4, 0.1, 1.5), bands, _n(band_depth, 0.3, 0.05, 1.2)) if bands else None
    b.section('facade-wall')
    U.skin(b, seg, 0, H, fl, k, lk, ratio=_n(window_ratio, 0.5, 0.1, 0.9), ws=lk.wall_slot, wc=lk.wall_col, gc=glass_colour or lk.glass_col, group=2 if b.detail else 1,
           mult=_n(coarse, 1, 0.5, 4), fins=_n(fins, 0, 0, 12), deep=bool(deep), bands=bnd, bay=_n(bay, 3.6, 1.5, 8), reduced=False, fin_col=lk.trim_col, corner=_n(corner, 0.5, 0, 3))
    if balcony_pods and b.detail == 0:
        U.balcony_pods(b, seg, 0, fl, H / fl, every=2, col=lk.trim_col)
    if plant_band and b.detail == 0 and fl >= 6:
        zb = H * 0.55
        U.sbox(b, seg, 0, W, zb, zb + H / fl * 1.6, 0.2, lib.shade(lk.metal_col, 0.62), skip_ends=True)


@part('tower-block')
def tower_block(b, lk, S, width=36.0, depth=26.0, height=60.0, storeys=0, shape='rect', facade='curtain', window_ratio=0.5, bay=3.6, fins=0.0, bands=None,
                glass_colour=None, balcony_pods=False, plant_band=False, setback_at=0.0, setback_inset=0.1, parapet=1.0, roof=True, coarse=1.0, deep=False):
    """A tall prism skinned storey by storey: plan shape rect | chamfer (cut corners) | tri (point to the camera) | round | oval | L | T,
    facade curtain | ribbon | punched | screen, optional fins/bands/balcony pods, a louvred plant floor at 55 % height, a flat roof with parapet.
    setback_at (0..1 of the height, e.g. 0.62) steps the upper block in by setback_inset * the smaller plan side."""
    W, D, H = _n(width, 36, 6, 100), _n(depth, 26, 6, 80), _n(height, 60, 6, 138)
    fl = int(storeys) if storeys else max(2, int(round(H / 3.7)))
    fp = _shape_fp(shape, W, D)
    bnd = (0.5, bands, 0.3) if bands else None
    gc = glass_colour or lk.glass_col
    b.section('tower-block')

    def walls(fp_, za, zb, n):
        cells = n * sum(s.length for s in fp_.edges()) / _n(bay, 3.6, 1.5, 8)
        for seg in fp_.edges():
            red = b.detail == 0 and (seg.rear or (cells > 1100 and not seg.front))
            U.skin(b, seg, za, zb, n, facade if facade in ('curtain', 'ribbon', 'punched', 'screen') else 'ribbon', lk, ratio=_n(window_ratio, 0.5, 0.1, 0.9), ws=lk.wall_slot,
                   wc=lk.wall_col, gc=gc, group=2 if cells < 900 else 3, mult=_n(coarse, 1, 0.5, 4) * (1.4 if b.detail == 1 else 1.0), fins=_n(fins, 0, 0, 12), deep=bool(deep),
                   bands=bnd, bay=_n(bay, 3.6, 1.5, 8), reduced=red, fin_col=lk.trim_col)
            if balcony_pods and b.detail == 0 and not red and seg.front and cells < 1200:
                U.balcony_pods(b, seg, za, n, (zb - za) / n, every=2, col=lk.trim_col)
            if plant_band and b.detail == 0 and n >= 12 and not seg.rear:
                zp = za + (zb - za) * 0.55
                U.sbox(b, seg, 0, seg.length, zp, zp + (zb - za) / n * 1.6, 0.2, lib.shade(lk.metal_col, 0.62), skip_ends=True)

    if setback_at and 0.2 < setback_at < 0.9 and fl >= 8:
        f1 = max(3, int(round(fl * setback_at)))
        zs = H * f1 / fl
        walls(fp, 0, zs, f1)
        lib.flat_roof(b, fp, zs, lk, parapet_h=0.8, ov=0.0, slab=0.0)
        inset = min(W, D) * _n(setback_inset, 0.1, 0.02, 0.3)
        fp2 = lib.Footprint([lib.shapes._miter(pl, -inset) for pl in fp.polys], [(a + inset, c + inset, d_ - inset, e - inset) for (a, c, d_, e) in fp.rects])
        walls(fp2, zs, H, fl - f1)
        fp = fp2
    else:
        walls(fp, 0, H, fl)
    if roof:
        lib.flat_roof(b, fp, H, lk, parapet_h=_n(parapet, 1.0, 0, 4) if b.detail < 2 else 0.5, ov=0.0, slab=0.0)


@part('stepped-tower')
def setback_tower(b, lk, S, width=40.0, depth=30.0, height=90.0, tiers=3, shrink=0.8, storeys=0, facade='punched', window_ratio=0.38, deco_piers=True,
                  cornices=True, planters=True, terrace_colour=None):
    """A stepped (wedding-cake / art-deco / masonry) tower: `tiers` boxes (2-4), each `shrink` times narrower than the one below and shifted
    towards the back, pier-and-window walls, cornice and parapet at each setback, planters on the terraces."""
    W, D, H = _n(width, 40, 10, 100), _n(depth, 30, 8, 80), _n(height, 90, 12, 138)
    nt = int(U.clamp(int(tiers), 2, 4))
    sh = _n(shrink, 0.8, 0.5, 0.95)
    hf = {2: [0.55, 0.45], 3: [0.42, 0.30, 0.28], 4: [0.34, 0.27, 0.22, 0.17]}[nt]
    total = int(storeys) if storeys else max(nt * 3, int(round(H / 3.7)))
    z, done = 0.0, 0
    b.section('setback-tower')
    for t in range(nt):
        s_ = sh ** t * (1 - 0.02 * t)
        w_t, d_t = W * s_, D * s_
        fp = lib.fp_rect(w_t, d_t, 0, (D - d_t) / 2 * 0.45)
        zt = H * sum(hf[:t + 1])
        fl = max(1, int(round(total * hf[t]))) if t < nt - 1 else max(1, total - done)
        done += fl
        cells = total * 2 * (W + D) * 0.7 / 3.2
        for seg in fp.edges():
            U.skin(b, seg, z, zt, fl, facade if facade in ('curtain', 'ribbon', 'punched', 'screen') else 'punched', lk, ratio=_n(window_ratio, 0.38, 0.1, 0.9), ws=lk.wall_slot, wc=lk.wall_col,
                   gc=lk.glass_col, group=2, bay=3.2, reduced=b.detail == 0 and (seg.rear or (cells > 600 and not seg.front) or cells > 1800),
                   fins=3.4 if (deco_piers and cells < 900) else 0.0, fin_col=lk.trim_col, deep=False)
        if cornices and b.detail == 0:
            lib.cornice(b, fp, zt - 0.55, 0.55, 0.55, lk, col=lk.trim_col)
        lib.flat_roof(b, fp, zt, lk, parapet_h=1.0 if t < nt - 1 else 0.7, ov=0.0, slab=0.0, col=terrace_colour)
        if planters and t < nt - 1 and b.detail == 0:
            x0_, y0_ = fp.bbox[0], fp.bbox[1]
            for k in range(3):
                lib.blob(b, x0_ + 1.5 + k * 3.0, y0_ + 1.2, zt + 0.5, 0.9, 0.9, 0.5, '#4f7d3b', n=6, rings=3)
        z = zt


@part('round-tower')
def round_tower(b, lk, S, radius=16.0, radius_y=0.0, height=100.0, storeys=0, profile='bulge', glass_colour=None, band_every=4, dome=True, plinth=True):
    """A cylindrical / oval tower lofted through rings: profile bulge (widest at 55 %, tapering to a tip) | taper | straight; glass skin tiled
    per storey, a floor-edge band every `band_every` storeys, shallow glazed dome and a needle on top, optional plinth drum."""
    rx = _n(radius, 16, 4, 40)
    ry = _n(radius_y, rx, 4, 40) if radius_y else rx
    H = _n(height, 100, 12, 136)
    fl = int(storeys) if storeys else max(4, int(round(H / 3.7)))
    stages = {0: 9, 1: 5, 2: 3}[b.detail]
    n = {0: int(U.clamp(round(2 * math.pi * max(rx, ry) / 3.2), 16, 34)), 1: 16, 2: 10}[b.detail]

    def prof(t):
        if profile == 'bulge':
            return (0.7 + 0.3 * (t / 0.55) ** 0.8) if t < 0.55 else max(0.32, 1.0 - 0.68 * ((t - 0.55) / 0.45) ** 1.5)
        if profile == 'taper':
            return 1.0 - 0.28 * t ** 1.3
        return 1.0
    b.section('round-tower')
    if plinth:
        lib.cylinder(b, 0, 0, 0, 1.0, max(rx, ry) + 1.2, n=n, slot='rough-concrete', col=lib.shade(lk.trim_col, 0.9), r_top=max(rx, ry) + 1.0, top=True, smooth=False)
    z0 = 1.0 if plinth else 0.0
    zs = [z0 + (H - z0) * k / stages for k in range(stages + 1)]
    rings = [U.ring_poly(0, 0, rx * prof(k / stages), ry * prof(k / stages), n) for k in range(stages + 1)]
    tv = (H - z0) / fl * (1 if b.detail == 0 else 2)
    U.loft(b, rings, zs, lk.glass_slot, glass_colour or lk.glass_col, 3.4 if b.detail == 0 else 7.0, tv)
    if b.detail == 0 and band_every:
        for k in range(1, int(fl // band_every)):
            zb = z0 + (H - z0) * k * band_every / fl
            t = (zb - z0) / (H - z0)
            lib.sweep(b, lib.fp_polygon(U.ring_poly(0, 0, rx * prof(t), ry * prof(t), n)), zb - 0.2, [(0.0, 0.0), (0.22, 0.0), (0.22, 0.4), (0.0, 0.4)], 'plain', lib.shade(lk.wall_col, 0.9))
    rt = min(rx, ry) * prof(1.0)
    if dome:
        lib.dome(b, 0, 0, H, rt, lk, height=rt * 0.6, profile='shallow', slot=lk.glass_slot if b.detail < 2 else 'plain', col=lk.glass_col)
        if b.detail < 2:
            lib.cylinder(b, 0, 0, H + rt * 0.6, H + rt * 0.6 + 5.0, 0.2, n=5, slot='frame', col=lk.metal_col, r_top=0.05, top=True)
    else:
        lib.flat_roof(b, lib.fp_polygon(U.ring_poly(0, 0, rx * prof(1.0), ry * prof(1.0), n)), H, lk, parapet_h=0.8, ov=0.0, slab=0.0)


@part('tower-crown')
def tower_crown(b, lk, S, kind='cap', width=24.0, depth=20.0, floor_height=3.6):
    """The top of a tower, standing on a flat roof of width x depth at z=0: cap (glazed lantern floors under a sloping trim roof) | pod (ridged
    ellipsoid on a drum, a restyled cocoa-pod crown) | spire (art-deco stepped pinnacle with a needle) | pyramid (tall hip roof) | dome (drum,
    dome, lantern) | frame (open steel crown) | screen (louvred plant enclosure) | pent (glazed pent-roof top) | stub (smaller stepped plant tier)."""
    T = _mod('office-tower')
    W, D = _n(width, 24, 4, 80), _n(depth, 20, 4, 60)
    fp = lib.fp_rect(W, D)
    fh = _n(floor_height, 3.6, 2.8, 5)
    k = kind if kind in ('cap', 'pod', 'spire', 'pyramid', 'dome', 'frame', 'screen', 'pent', 'stub') else 'cap'
    dress = {'spire': 'deco', 'pyramid': 'masonry', 'dome': 'masonry'}.get(k, 'glass')
    P = _P(crown=k, dress=dress, kind='curtain', fh=fh, W=W, D=D)
    b.section('tower-crown')
    if k in ('screen', 'pent', 'stub'):
        T.top_variant(b, lk, P, fp, 0.0, S, kind=k)
    else:
        T.crown_on(b, lk, P, fp, 0.0, S)


@part('radio-mast')
def lattice_mast(b, lk, S, height=14.0, radius=0.25, banded=True, colour='#c9ced2'):
    """A tapering lattice-style radio mast with cross arms; banded=True paints red/white aviation bands."""
    U.mast(b, 0, 0, 0, _n(height, 14, 2, 80), _n(radius, 0.25, 0.05, 2), colour, bool(banded))


@part('rooftop-helipad')
def rooftop_helipad(b, lk, S, radius=7.0, colour='#6a6e72', stand=True):
    """A circular helipad slab with a white ring and H mark (and a short stand), its top about 0.4 m above z=0."""
    r = _n(radius, 7, 3, 14)
    U.helipad(b, 0, 0, 0.2, r, colour)
    if stand and b.detail < 2:
        lib.cylinder(b, 0, 0, 0, 0.2, r * 0.5, n=6, slot='plain', col='#666a6e', top=False)


@part('rooftop-plant')
def rooftop_plant(b, lk, S, width=30.0, depth=20.0, water_tank=False, solar=False):
    """Roof clutter on a flat roof of width x depth at z=0: a plant room, lift overrun, small units, optional water tank and solar rows."""
    T = _mod('office-tower')
    P = _P(feats=_feats(**{'water-tank': water_tank, 'solar-panels': solar}))
    T.roof_clutter(b, lk, P, lib.fp_rect(_n(width, 30, 6, 80), _n(depth, 20, 6, 60)), 0.0, S)


@part('podium-base')
def podium_base(b, lk, S, width=70.0, depth=34.0, floors=2, floor_height=3.8, upper='ribbon', ground='curtain'):
    """A wide commercial podium centred on the origin: glazed ground storey, ribbon (or punched) upper storeys, flat roof with parapet."""
    T = _mod('office-tower')
    W, D = _n(width, 70, 12, 100), _n(depth, 34, 8, 70)
    fh = _n(floor_height, 3.8, 3, 5)
    fl = int(U.clamp(int(floors), 1, 4))
    P = _P(fh=fh, dress='masonry' if upper == 'punched' else 'modern')
    b.section('podium-base')
    T.podium_mass(b, lk, P, -W / 2, W / 2, -D / 2, D / 2, fl, fh * fl + 1.2, S)


@part('pilotis-base')
def pilotis_base(b, lk, S, width=60.0, depth=18.0, height=6.2):
    """The open ground storey of a tower on pilotis: a recessed glazed core and a ring of square concrete columns (the tower sits above)."""
    T = _mod('office-tower')
    b.section('pilotis-base')
    T.pilotis_base(b, lk, _P(), lib.fp_rect(_n(width, 60, 10, 100), _n(depth, 18, 8, 60)), _n(height, 6.2, 3, 12), S)


@part('porte-cochere')
def porte_cochere(b, lk, S, width=16.0, depth=7.5, height=4.6):
    """A drive-through entrance canopy projecting towards -Y from a wall at y=0: flat slab with accent fascia on slim columns, steps, paved drive."""
    H = _mod('hotel')
    H.porte_cochere(b, lk, _P(), 0.0, 0.0, _n(width, 16, 6, 40), _n(depth, 7.5, 3, 16), _n(height, 4.6, 3.2, 8))


@part('glass-lobby')
def glass_lobby(b, lk, S, width=16.0, height=8.0, curtain_colour=None):
    """A glazed lobby box leaning on a wall at y=0 (7 m deep, towards -Y) with a sloping glass roof rising to the wall."""
    T = _mod('office-tower')
    P = _P(kind='curtain')
    T.atrium(b, lk, P, 0.0, 0.0, _n(width, 16, 5, 40), _n(height, 8, 3.5, 20), S)


@part('x-bracing')
def x_bracing(b, lk, S, width=30.0, height=40.0, floors=10, panel_floors=4, colour='#6c7479'):
    """Large steel X-bracing panels drawn as proud strips across a wall at y=0 (high-tech / diagrid look); LOD0 only."""
    T = _mod('office-tower')
    T.bracing(b, _wall(_n(width, 30, 4, 100)), 0, _n(height, 40, 4, 138), int(U.clamp(int(floors), 2, 60)), colour, int(U.clamp(int(panel_floors), 1, 10)))


@part('sky-bridge')
def sky_bridge(b, lk, S, length=7.0, depth=10.0, height=7.0, colour=None):
    """A glazed bridge box between two towers: length along x, depth along y, standing on z=0 (raise it with at.z)."""
    L, Dp, Hh = _n(length, 7, 2, 40), _n(depth, 10, 2, 40), _n(height, 7, 2, 12)
    U.box_c(b, 0, 0, 0, L, Dp, Hh, lk.glass_slot, colour or lk.glass_col, top_slot='roof-flat', top_col=lk.roof_col, skip=())


# ================================================================================================================ OFFICES (low-rise)
@part('brand-band')
def brand_band(b, lk, S, length=24.0, height=9.0, panel_width=3.4, panel_side='left', cap=True, colour=None):
    """A bank branch's colour branding on a front wall at y=0: a full-height vertical panel at one end and a projecting cap band along the parapet."""
    L, H = _n(length, 24, 4, 80), _n(height, 9, 3, 40)
    seg = _wall(L)
    col = colour or lk.accent_col
    pw = min(_n(panel_width, 3.4, 0.5, 8), L * 0.3)
    if panel_side in ('left', 'right'):
        ua, ub = (0.2, 0.2 + pw) if panel_side == 'left' else (L - 0.2 - pw, L - 0.2)
        U.sbox(b, seg, ua, ub, 0.0, H + 0.6, 0.38 if b.detail == 0 else 0.3, col)
    if cap:
        U.sbox(b, seg, 0.0, L, H - 0.1, H + 0.35, 0.22, col, skip_ends=True)


@part('atm-booth')
def atm_booth(b, lk, S, width=2.4, depth=2.0, height=2.7, colour=None, sign_colour=None):
    """A small ATM / guard booth with a glazed front (towards -Y) and a blank sign band."""
    U.booth(b, 0, 0, _n(width, 2.4, 1, 6), _n(depth, 2, 1, 5), _n(height, 2.7, 2, 4), colour or lk.accent_col, sign_col=sign_colour or lk.accent_col)


@part('pylon-sign')
def pylon_sign(b, lk, S, height=7.0, width=2.0, colour=None):
    """A free-standing pylon sign: pole and a blank board near the top."""
    U.pylon_sign(b, 0, 0, _n(height, 7, 3, 20), _n(width, 2, 0.5, 8), colour or lk.accent_col)


@part('slab-entrance-canopy')
def entrance_canopy(b, lk, S, width=10.0, depth=4.2, height=4.3, columns=2, colour=None, edge_colour=None, steps=True):
    """A flat entrance canopy projecting towards -Y from a wall at y=0: slab with a coloured fascia on round columns, two entrance steps."""
    w, d, h = _n(width, 10, 3, 40), _n(depth, 4.2, 1.5, 12), _n(height, 4.3, 2.8, 8)
    lib.canopy_flat(b, -w / 2, -d, w / 2, 0, h, lk, th=0.55, columns=int(columns) or None, col=colour or lk.roof_col, edge_col=edge_colour or lk.accent_col, r=0.2)
    if steps and b.detail == 0:
        lib.steps(b, -w / 2 + 1.0, w / 2 - 1.0, -d + 0.4, 0.3, 0.8, 2)


@part('relief-band')
def relief_band(b, lk, S, length=20.0, height=0.9, colour=None, kind='diamond', count=0):
    """A band of geometric relief (diamond | zigzag) proud of a wall at y=0, bottom at z=0 (Hausa-Arewa parapets)."""
    L, H = _n(length, 20, 2, 80), _n(height, 0.9, 0.3, 3)
    U.relief_band(b, _wall(L), 0.0, H, colour or lib.shade(lk.wall_col, 0.75), n=int(count) or None, kind=kind if kind in ('diamond', 'zigzag') else 'diamond')


@part('corner-pinnacle')
def corner_pinnacle(b, lk, S, height=2.6, width=0.65, sides=4, colour=None):
    """A Hausa-style tapering corner pinnacle (frustum with a stepped cap) standing on z=0."""
    U.pinnacle(b, lk, 0, 0, 0, _n(height, 2.6, 0.5, 8), _n(width, 0.65, 0.2, 2), colour, int(U.clamp(int(sides), 3, 8)))


@part('parapet-merlons')
def parapet_merlons(b, lk, S, length=20.0, depth=0.0, height=0.9, merlon=0.9, gap=0.8, colour=None):
    """Crenellations (merlons) along the edges of a roof outline length x depth (depth 0 = a single run along x), bottom on z=0."""
    L = _n(length, 20, 1, 100)
    dd = _n(depth, 0, 0, 100)
    if dd <= 0:
        fp = lib.fp_rect(L, 0.4)
        U.crenellate(b, lk, fp, 0.0, _n(height, 0.9, 0.3, 3), _n(merlon, 0.9, 0.3, 3), _n(gap, 0.8, 0.3, 3), colour, skip_rear=True)
    else:
        U.crenellate(b, lk, lib.fp_rect(L, dd), 0.0, _n(height, 0.9, 0.3, 3), _n(merlon, 0.9, 0.3, 3), _n(gap, 0.8, 0.3, 3), colour)


@part('brise-soleil')
def brise_soleil(b, lk, S, length=20.0, height=10.0, pitch=2.4, depth=0.5, colour=None, base=0.4):
    """A row of vertical sun-breaker fins standing off a wall at y=0 (fins every `pitch` m, `depth` proud)."""
    L, H = _n(length, 20, 2, 100), _n(height, 10, 1, 60)
    if b.detail >= 2:
        return
    seg = _wall(L)
    n = max(1, int(L / _n(pitch, 2.4, 0.6, 8)))
    col = colour or lib.mix(lk.trim_col, lk.wall_col, 0.3)
    for k in range(n + 1):
        u = min(max(k * L / n, 0.1), L - 0.1)
        U.sbox(b, seg, u - 0.1, u + 0.1, _n(base, 0.4, 0, 4), H, _n(depth, 0.5, 0.1, 2), col, skip_ends=True)


@part('balcony-pods')
def balcony_pods(b, lk, S, length=20.0, floors=5, floor_height=3.4, every=2, depth=1.3, colour=None, rail_colour='#3a3d41', skip_ground=True):
    """Individual projecting balconies (slab and railing, 3.4 m bays, `every` bays each) on every storey of a wall at y=0. LOD0 only."""
    U.balcony_pods(b, _wall(_n(length, 20, 3, 100)), 0, int(U.clamp(int(floors), 1, 30)), _n(floor_height, 3.4, 2.6, 5), every=int(U.clamp(int(every), 1, 4)),
                   depth=_n(depth, 1.3, 0.4, 2.5), col=colour or lk.trim_col, rail_col=rail_colour, skip_ground=bool(skip_ground))


@part('verandah-arcade')
def verandah_arcade(b, lk, S, length=24.0, depth=2.8, height=3.4, count=0, kind='round', colour=None):
    """A verandah along a wall at y=0 (towards -Y): posts (round | square) or arches under a sloping roof; `count` posts (0 = every ~3 m)."""
    L = _n(length, 24, 4, 100)
    n = int(count) if count else max(3, int(L / 3.0))
    U.veranda(b, lk, -L / 2 + 0.5, L / 2 - 0.5, 0.0, _n(height, 3.4, 2.5, 6), _n(depth, 2.8, 1.5, 6), n, kind=kind if kind in ('round', 'square', 'arch') else 'round', col=colour)


@part('two-level-gallery')
def two_level_gallery(b, lk, S, length=30.0, depth=2.6, floors=2, floor_height=3.6, posts_every=3.0, colour=None):
    """A colonial two-level colonnaded gallery on a wall at y=0: square posts, a balcony deck with balustrade at each level."""
    L = _n(length, 30, 4, 100)
    n = max(3, int(L / _n(posts_every, 3.0, 1.5, 8)))
    fh = _n(floor_height, 3.6, 2.8, 5)
    for f in range(int(U.clamp(int(floors), 1, 3))):
        U.gallery(b, lk, -L / 2 + 0.5, L / 2 - 0.5, 0.0, _n(depth, 2.6, 1.5, 5), f * fh + (0.3 if f == 0 else 0.0), (f + 1) * fh - (0.0 if f < floors - 1 else 0.35), n, col=colour,
                  rail=f < floors - 1, slab=f < floors - 1)


# ===================================================================================================================== HOTEL
@part('swimming-pool')
def swimming_pool(b, lk, S, width=14.0, length=8.0, umbrellas=3, water_colour='#3fa7c7', coping_colour='#d9d4c8'):
    """A swimming pool (water, coping ring) with loungers and umbrellas; width along x, length along y, centred on the origin."""
    w, d = _n(width, 14, 3, 40), _n(length, 8, 2, 25)
    U.pool(b, -w / 2, -d / 2, w / 2, d / 2, S, umbrellas=int(U.clamp(int(umbrellas), 0, 8)), coping=coping_colour, water=water_colour)


@part('chalet')
def chalet(b, lk, S, width=5.5, depth=6.5, height=3.0, thatch=False, colour=None):
    """A small hip-roofed chalet / bungalow with a porch step and a front window; front towards -Y."""
    U.chalet(b, lk, 0, 0, 0.0, _n(width, 5.5, 3, 12), _n(depth, 6.5, 3, 12), _n(height, 3.0, 2.4, 5), thatch=bool(thatch), wall_col=colour)


@part('bar-pavilion')
def bar_pavilion(b, lk, S, radius=3.4, height=2.6, thatch=True):
    """An open round bar / gazebo: posts round a paved ring under a conical thatch (or tile) roof."""
    U.thatched_pavilion(b, lk, 0, 0, _n(radius, 3.4, 1.5, 8), _n(height, 2.6, 2, 4), bool(thatch))


# ================================================================================================================== INDUSTRIAL
@part('storage-tank')
def storage_tank(b, lk, S, radius=9.0, height=14.0, roof='cone', stairs=True, colour='#d9dcde'):
    """A vertical steel storage tank (courses of cladding): roof cone | floating (open top with a wind girder and inner deck) | dome; spiral stair."""
    I = _mod('industrial')
    I.tank(b, lk, 0, 0, _n(radius, 9, 1.5, 25), _n(height, 14, 3, 30), colour, roof if roof in ('cone', 'floating', 'dome') else 'cone', bool(stairs))


@part('tank-farm')
def tank_farm(b, lk, S, count=4, rows=2, radius=8.0, height=12.0, bund=True, colour='#d9dcde'):
    """A group of storage tanks (rows x columns, alternating roof types) in a paved containment bund, centred on the origin."""
    I = _mod('industrial')
    nt = int(U.clamp(int(count), 1, 12))
    rw = int(U.clamp(int(rows), 1, 4))
    per = (nt + rw - 1) // rw
    r = _n(radius, 8, 2, 14)
    w = per * (2 * r + 3) + 2
    d = rw * (2 * r + 3) + 2
    if bund:
        I.bund(b, -w / 2 - 2, -d / 2 - 2, w / 2 + 2, d / 2 + 2)
    k = 0
    for ri in range(rw):
        for i in range(per):
            if k >= nt:
                break
            x = -w / 2 + r + 1.5 + i * (2 * r + 3)
            y = -d / 2 + r + 1.0 + ri * (2 * r + 3)
            I.tank(b, lk, x, y, r, _n(height, 12, 4, 24) * (0.9 + 0.1 * (k % 3)), lib.shade(colour, 0.95 + 0.03 * (k % 3)), ['cone', 'floating', 'cone', 'dome'][k % 4], stairs=k < 3)
            k += 1


@part('process-column')
def process_column(b, lk, S, radius=2.2, height=40.0, platforms=True, colour='#b9bec2'):
    """A refinery process column (fractionating tower): tall steel shell on a concrete skirt, dome head, platforms every 6.5 m, ladder cage, pipe."""
    _mod('industrial').proc_column(b, 0, 0, _n(radius, 2.2, 0.8, 5), _n(height, 40, 6, 100), colour, bool(platforms))


@part('pipe-rack')
def pipe_rack(b, lk, S, length=60.0, height=7.0, levels=2, width=3.6, pipes=5, colour='#7e8a92'):
    """An elevated pipe rack along x (centred): portal frames every 6 m with bracing and a bundle of `pipes` pipes per level."""
    L = _n(length, 60, 6, 120)
    _mod('industrial').pipe_rack(b, -L / 2, L / 2, 0, _n(height, 7, 3, 14), S, levels=int(U.clamp(int(levels), 1, 3)), width=_n(width, 3.6, 2, 8), pipes=int(U.clamp(int(pipes), 1, 10)), col=colour)


@part('heat-exchanger')
def heat_exchanger(b, lk, S, length=8.0, radius=1.2, colour='#8f9aa1'):
    """A horizontal shell-and-tube vessel on two concrete saddles (long axis along x)."""
    _mod('industrial').exchanger(b, 0, 0, _n(length, 8, 2, 20), _n(radius, 1.2, 0.4, 3), colour)


@part('furnace-stack')
def furnace_stack(b, lk, S, width=8.0, depth=6.0, height=9.5, stack_height=20.0, colour='#a8aeb2'):
    """A fired heater: clad box with a tall convection stack on top."""
    I = _mod('industrial')
    w, d, h = _n(width, 8, 3, 20), _n(depth, 6, 3, 16), _n(height, 9.5, 3, 20)
    sh = _n(stack_height, 20, 3, 60)
    U.box_c(b, 0, 0, 0, w, d, h, 'metal-cladding', colour, top_slot='roof-flat', top_col=lib.shade(colour, 0.8), skip=('bottom',))
    if b.detail < 2:
        I.stack(b, lk, 0, 0, h + sh, 1.3, bands=False, col='#b9bcbf')


@part('banded-stack')
def banded_stack(b, lk, S, height=30.0, radius=1.8, bands=True, colour='#c9c6bd'):
    """A tapering concrete chimney with red/white obstruction bands (LOD0) and a dark top ring."""
    _mod('industrial').stack(b, lk, 0, 0, _n(height, 30, 6, 120), _n(radius, 1.8, 0.5, 6), bool(bands), colour)


@part('flare-stack')
def flare_stack(b, lk, S, height=60.0):
    """A flare stack: slim tapered tower with platforms, four guy cables and a flame (orange and yellow cones) at the tip."""
    _mod('industrial').flare(b, lk, 0, 0, _n(height, 60, 15, 120))


@part('lpg-sphere')
def lpg_sphere(b, lk, S, radius=6.0, colour='#d8dcdf'):
    """A spherical pressure vessel on six legs and a concrete pad."""
    _mod('industrial').sphere_tank(b, 0, 0, _n(radius, 6, 2, 12), colour)


@part('containment-bund')
def containment_bund(b, lk, S, width=40.0, depth=30.0, height=1.1, colour='#b8b4aa'):
    """A paved floor with a low concrete containment wall round it, centred on the origin."""
    w, d = _n(width, 40, 4, 100), _n(depth, 30, 4, 100)
    _mod('industrial').bund(b, -w / 2, -d / 2, w / 2, d / 2, colour, _n(height, 1.1, 0.3, 3))


@part('silo-bank')
def silo_bank(b, lk, S, nx=3, ny=2, radius=4.0, height=32.0, headhouse=True, colour='#c9c6bd'):
    """A bank of touching concrete silos (slip-form courses) with a headhouse gallery on top, centred on the origin."""
    I = _mod('industrial')
    nx_, ny_ = int(U.clamp(int(nx), 1, 8)), int(U.clamp(int(ny), 1, 6))
    r = _n(radius, 4, 1.5, 8)
    I.silo_bank(b, lk, -(nx_ - 1) * r, -(ny_ - 1) * r, nx_, ny_, r, _n(height, 32, 8, 70), colour, S)


@part('conveyor-gantry')
def conveyor_gantry(b, lk, S, dx=20.0, dy=0.0, start_height=20.0, end_height=18.0, colour='#8d9298'):
    """An inclined conveyor walkway from the origin (at height start_height) to (dx, dy) at end_height, on trestle supports."""
    _mod('industrial').gantry_walkway(b, 0, 0, _n(start_height, 20, 2, 80), _n(dx, 20, -100, 100), _n(dy, 0, -100, 100), _n(end_height, 18, 2, 80), colour)


@part('warehouse-shed')
def warehouse_shed(b, lk, S, width=40.0, depth=20.0, height=8.0, roof='gable', doors=3, colour=None, roof_colour=None, rise=0.0, teeth=0):
    """A ribbed-metal shed centred on the origin: plinth, clerestory band and roller doors on the -Y wall, roof gable | shed | sawtooth | flat."""
    _mod('industrial').warehouse(b, lk, 0, 0, _n(width, 40, 6, 100), _n(depth, 20, 6, 80), _n(height, 8, 3, 20), S, roof if roof in ('gable', 'shed', 'sawtooth', 'flat') else 'gable',
                                  col=colour, doors=int(U.clamp(int(doors), 0, 8)), roof_col=roof_colour, rise=_n(rise, 0, 0, 10) or None, teeth=int(teeth) or None)


@part('container-stack')
def container_stack(b, lk, S, nx=3, ny=3, levels=3, pitch_x=12.6, pitch_y=2.7):
    """A block of shipping containers (12.2 m, mixed colours, ribbed sides) nx long x ny wide x `levels` high, centred on the origin."""
    I = _mod('industrial')
    nx_, ny_ = int(U.clamp(int(nx), 1, 8)), int(U.clamp(int(ny), 1, 8))
    I.container_stack(b, S, -(nx_ - 1) * _n(pitch_x, 12.6, 6, 20) / 2, -(ny_ - 1) * _n(pitch_y, 2.7, 2.5, 6) / 2, nx_, ny_, int(U.clamp(int(levels), 1, 6)), 'cs', _n(pitch_x, 12.6, 6, 20), _n(pitch_y, 2.7, 2.5, 6))


@part('quay-crane')
def quay_crane(b, lk, S, height=42.0, reach=34.0, colour='#2f6f9a'):
    """A ship-to-shore container crane on rails: portal legs, girders, machinery house, raised boom reaching `reach` m towards +Y, back-reach."""
    _mod('industrial').crane(b, 0, -7.0, 7.0 + _n(reach, 34, 15, 70), colour, _n(height, 42, 20, 70))


@part('cargo-ship')
def cargo_ship(b, lk, S, length=84.0, width=15.0, hull_colour='#3a3f48', stripe_colour='#b03a2e'):
    """A container ship moored along x, centred on the origin: tapered hull, container rows on deck, stern bridge block and funnel."""
    _mod('industrial').ship(b, 0, 0, _n(length, 84, 30, 160), _n(width, 15, 8, 30), S, hull_colour, stripe_colour)


@part('water-tower')
def water_tower(b, lk, S, height=16.0, radius=3.4, colour='#c9ccd0'):
    """An elevated steel water tank on a braced four-leg tower."""
    _mod('industrial').water_tower(b, lk, 0, 0, _n(height, 16, 5, 50), _n(radius, 3.4, 1, 8), colour)


# ================================================================================================================== TRANSPORT
@part('rail-track')
def rail_track(b, lk, S, length=60.0, tracks=1, spacing=5.4, gauge=1.435):
    """Railway track along x (centred): ballast bed, two rails and sleepers (LOD0); tracks > 1 gives parallel tracks `spacing` m apart along y."""
    T = _mod('transport-station')
    L = _n(length, 60, 5, 120)
    for k in range(int(U.clamp(int(tracks), 1, 6))):
        T.rails(b, -L / 2, L / 2, k * _n(spacing, 5.4, 4, 12), 0.0, _n(gauge, 1.435, 1.0, 1.7))


@part('station-platform')
def station_platform(b, lk, S, length=60.0, depth=7.0, height=1.0, colour='#b9b4aa'):
    """A raised paved passenger platform with a yellow safety strip on its +Y edge; centred on x, front edge at y=0, extends towards +Y."""
    L, d = _n(length, 60, 6, 120), _n(depth, 7, 2, 14)
    _mod('transport-station').platform(b, lk, -L / 2, L / 2, 0, d, _n(height, 1.0, 0.3, 1.5), colour)


@part('station-canopy')
def station_canopy(b, lk, S, length=60.0, depth=6.4, height_inner=7.0, height_outer=3.6, kind='iron', attached=True, colour=None):
    """A platform roof along x: attached=True slopes from a building wall at y=0 down to posts at y=depth; attached=False is a free-standing
    shelter roof centred on y=0. kind iron (brackets) | flat. Posts on a 7 m pitch, blank fascia."""
    T = _mod('transport-station')
    L = _n(length, 60, 6, 120)
    if attached:
        T.platform_canopy(b, lk, -L / 2, L / 2, 0.0, _n(depth, 6.4, 2, 12), _n(height_inner, 7, 3, 14), _n(height_outer, 3.6, 2.8, 8), colour or lib.shade(lk.roof_col, 0.9), 7.0, True, kind)
    else:
        T.platform_canopy(b, lk, -L / 2, L / 2, 0.0, _n(depth, 5, 2, 12), _n(height_inner, 4.2, 3, 8), _n(height_outer, 4.0, 2.8, 8), colour or lk.trim_col, 8.0, False, kind)


@part('train')
def train(b, lk, S, carriages=3, colour='#2f5f8a', loco_colour='#b03a2e', z=0.4):
    """A locomotive and carriages standing on a track along x (loco at the -X end), centred roughly on the origin; z = rail-bed height."""
    T = _mod('transport-station')
    n = int(U.clamp(int(carriages), 0, 6))
    L = 18.0 + n * 20.5
    T.train(b, -L / 2 + 9.0, 0.0, n, colour, S, _n(z, 0.4, 0, 2), loco_colour)


@part('minibus')
def minibus(b, lk, S, colour='#e6b422', stripe='#1f1f22', count=1, spacing=2.9, yaw=90.0):
    """A minibus / danfo van (5 m); count > 1 gives a row along x at `spacing`, all facing `yaw` degrees (90 = towards +Y)."""
    n = int(U.clamp(int(count), 1, 24))
    for k in range(n):
        U.van(b, (k - (n - 1) / 2) * _n(spacing, 2.9, 2.2, 5), 0, math.radians(_n(yaw, 90)), colour, length=5.0, width=1.9, height=2.35, stripe=stripe)


@part('coach')
def coach(b, lk, S, colour='#f1f1ee', stripe='#c8362f', count=1, spacing=3.5, length=11.0, yaw=90.0):
    """An intercity coach (11 m); count > 1 gives a row along x."""
    n = int(U.clamp(int(count), 1, 16))
    for k in range(n):
        U.coach(b, (k - (n - 1) / 2) * _n(spacing, 3.5, 2.8, 6), 0, math.radians(_n(yaw, 90)), colour, length=_n(length, 11, 6, 16), width=2.5, stripe=stripe)


@part('bus-park-row')
def bus_park_row(b, lk, S, length=50.0, kind='mixed', density=0.7, coach_share=0.3, colours=None, yaw=90.0, lines=True):
    """A row of parked vehicles along x (centred, bay lines on the ground): kind van | coach | mixed | taxi, `density` 0..1 of bays filled, colours list."""
    T = _mod('transport-station')
    L = _n(length, 50, 6, 110)
    pal = list(colours) if colours else ['#f1f1ee', '#2f5f8a', '#c8362f', '#e6b422']
    T.park_row(b, S, 'row', -L / 2, L / 2, 0.0, math.radians(_n(yaw, 90)), kind if kind in ('van', 'coach', 'mixed', 'taxi') else 'mixed', _n(density, 0.7, 0, 1), pal, _n(coach_share, 0.3, 0, 1), bool(lines))


@part('open-shelter')
def open_shelter(b, lk, S, length=30.0, depth=8.0, height=4.5, form='shed', support='steel', colour=None, accent=None):
    """An open passenger shelter along x, centred on the origin: roof shed (mono-pitch) | gable | flat | curved (barrel vault) | sawtooth, on
    steel posts or square concrete pillars, with benches (LOD0)."""
    T = _mod('transport-station')
    T.shelter(b, lk, -_n(length, 30, 6, 100) / 2, _n(length, 30, 6, 100) / 2, 0.0, _n(depth, 8, 3, 16), _n(height, 4.5, 3, 8), S, form if form in ('shed', 'gable', 'flat', 'curved', 'sawtooth') else 'shed',
              support if support in ('steel', 'concrete') else 'steel', colour or lk.roof_col, accent or lk.trim_col, key='os')


@part('ticket-kiosk')
def ticket_kiosk(b, lk, S, width=2.6, depth=2.2, height=2.6, colour=None, sign_colour='#2f6b4f'):
    """A ticket kiosk: box with a glazed hatch, a projecting roof slab and a blank sign board on its -Y face."""
    _mod('transport-station').kiosk_booth(b, lk, 0, 0, colour or lk.wall_col, 0.0, _n(width, 2.6, 1.5, 5), _n(depth, 2.2, 1.5, 4), _n(height, 2.6, 2.2, 4), sign_colour)


@part('gateway-arch')
def gateway_arch(b, lk, S, width=10.0, height=5.6, kind='arch', colour=None, accent=None):
    """The gateway over a yard entrance (opening along x, centred): two piers carrying a semicircular arch (or a straight beam) with a blank sign panel."""
    _mod('transport-station').gate_arch(b, lk, 0, 0, _n(width, 10, 3, 24), _n(height, 5.6, 3, 10), colour or lk.wall_col, accent or lk.trim_col, kind if kind in ('arch', 'beam') else 'arch')


@part('train-shed')
def train_shed(b, lk, S, length=60.0, span=22.0, height=9.0, rise=5.0, end_glass='#cfd8dd'):
    """A train shed: a barrel vault (glazed gable ends) on steel columns every 8 m over the tracks, running along x, centred on the origin."""
    L, sp = _n(length, 60, 10, 110), _n(span, 22, 8, 40)
    lib.barrel(b, (-L / 2, -sp / 2, L / 2, sp / 2), _n(height, 9, 5, 16), _n(rise, 5, 2, 12), lk, axis='x', ov=0.0, slot='metal-roof', col=lk.roof_col, end_slot='glass-ribbon', end_col=end_glass)
    if b.detail < 2:
        for k in range(int(L / 8) + 1):
            xx = -L / 2 + 8 * k
            for sy in (-1, 1):
                U.box_c(b, xx, sy * sp / 2, 0, 0.4, 0.4, _n(height, 9, 5, 16) - 0.8, 'frame', '#5e656b', skip=('bottom',))


@part('ferry-jetty')
def ferry_jetty(b, lk, S, length=54.0, width=6.0, shelter=True, timber=False, colour=None):
    """A passenger jetty extending towards +Y from y=0 on piles with bollards, an optional shelter roof on posts; timber=True uses planks."""
    L, w = _n(length, 54, 8, 100), _n(width, 6, 3, 14)
    col = colour or ('#8a6a4a' if timber else '#9d9a92')
    U.box(b, -w / 2, -1.0, 0.5, w / 2, L, 1.05, 'timber' if timber else 'paving', col, skip=('bottom',), scale=2.0)
    if b.detail == 0:
        for k in range(int(L / 4) + 1):
            for sx in (-1, 1):
                lib.cylinder(b, sx * (w / 2 - 0.3), 1 + k * 4.0, -0.2, 0.5, 0.2, n=5, slot='timber', col='#5a4a3a', top=False)
                lib.cylinder(b, sx * (w / 2 + 0.05), 1 + k * 4.0, 1.05, 1.5, 0.12, n=5, slot='frame', col='#3a3d41', top=True)
    if shelter and b.detail < 2:
        U.box_c(b, 0, 6.0, 2.6, w + 0.6, 12.0, 0.2, 'plain', lk.roof_col, skip=())
        if b.detail == 0:
            for k in range(4):
                for sx in (-1, 1):
                    lib.cylinder(b, sx * (w / 2 - 0.2), 1.0 + k * 3.6, 1.05, 2.7, 0.1, n=4, slot='frame', col='#6e7378', top=False, smooth=False)


@part('launch-boat')
def launch_boat(b, lk, S, length=9.0, width=2.6, colour='#2f5f8a', yaw=90.0):
    """A small passenger launch / pirogue: tapered hull, cabin box and canopy; bow towards `yaw` degrees (90 = +Y)."""
    U.boat(b, 0, 0, math.radians(_n(yaw, 90)), colour, length=_n(length, 9, 4, 20), width=_n(width, 2.6, 1.5, 6))


@part('metro-portal')
def metro_portal(b, lk, S, width=12.0, depth=11.0, accent=None, kiosk=True):
    """A metro / underground entrance: concrete balustrade walls round a stair well under a sloping glass canopy, a ring pylon sign and an optional kiosk."""
    T = _mod('transport-station')
    acc = accent or lk.accent_col
    cw, cd = _n(width, 12, 5, 28) * 0.9, _n(depth, 11, 5, 26) * 0.9
    hh = 3.4
    for sx in (-1, 1):
        U.box(b, sx * cw / 2 - 0.25, -cd / 2, 0, sx * cw / 2 + 0.25, cd / 2, hh, 'rough-concrete', lib.shade(lk.wall_col, 0.9), skip=('bottom',))
    U.box(b, -cw / 2, cd / 2 - 0.4, 0, cw / 2, cd / 2, hh, 'rough-concrete', lib.shade(lk.wall_col, 0.9), skip=('bottom',))
    pts = [(-cw / 2 - 0.4, -cd / 2 - 0.4, hh - 0.6), (cw / 2 + 0.4, -cd / 2 - 0.4, hh - 0.6), (cw / 2 + 0.4, cd / 2 + 0.4, hh + 1.2), (-cw / 2 - 0.4, cd / 2 + 0.4, hh + 1.2)]
    if b.detail < 2:
        b.facing(pts, (0, -0.4, 1), 'glass-curtain', '#9fb4c2', mode='tile', scale=2.0)
        b.facing([(-cw / 2 - 0.4, -cd / 2 - 0.4, hh - 0.8), (cw / 2 + 0.4, -cd / 2 - 0.4, hh - 0.8), (cw / 2 + 0.4, -cd / 2 - 0.4, hh - 0.6), (-cw / 2 - 0.4, -cd / 2 - 0.4, hh - 0.6)], (0, -1, 0), 'plain', acc, mode='fit')
        lib.cylinder(b, cw / 2 + 3.0, -cd / 2 - 2.0, 0, 6.0, 0.25, n=6, slot='frame', col='#6e7378', top=False)
        lib.cylinder(b, cw / 2 + 3.0, -cd / 2 - 2.0, 5.2, 5.5, 1.3, n=12, slot='plain', col=acc, r_top=1.3, top=True, smooth=False)
        lib.cylinder(b, cw / 2 + 3.0, -cd / 2 - 2.0, 5.2, 5.5, 0.85, n=12, slot='plain', col='#f1eee4', r_top=0.85, top=True, smooth=False)
        if kiosk:
            T.kiosk_booth(b, lk, -cw / 2 - 3.5, -cd / 2 - 1.0, lib.mix(lk.wall_col, acc, 0.3), sign=acc)
    else:
        b.facing(pts, (0, -0.4, 1), 'plain', '#6f8fa2')


@part('quay')
def quay(b, lk, S, length=80.0, depth=30.0, water_depth=36.0, bollards=True):
    """A cargo quay centred on x: paved slab (front edge y=-depth) with a fender kerb and bollards along its +Y edge (y=0), water beyond to +water_depth."""
    L, d = _n(length, 80, 10, 120), _n(depth, 30, 5, 80)
    if b.detail < 2:
        with b.site():
            b.face([(-L / 2 - 4, 0, 0.0), (L / 2 + 4, 0, 0.0), (L / 2 + 4, _n(water_depth, 36, 5, 80), 0.0), (-L / 2 - 4, _n(water_depth, 36, 5, 80), 0.0)], 'plain', '#4d8aa6', mode='fit')
    U.box(b, -L / 2 - 4, -d, 0, L / 2 + 4, 0, 0.5, 'paving', '#9d9a92', skip=('bottom', 'back'), scale=3.0)
    if b.detail < 2:
        U.box(b, -L / 2 - 4, -0.6, 0.5, L / 2 + 4, 0, 0.9, 'rough-concrete', '#b0aca3', skip=('bottom',))
        if bollards and b.detail == 0:
            for k in range(int(L // 9) + 1):
                lib.cylinder(b, -L / 2 + 3 + k * 9, -1.2, 0.5, 1.0, 0.3, n=6, slot='frame', col='#3a3d41', r_top=0.4, top=True, smooth=False)


# ===================================================================================================================== MANOR
@part('manor-facade')
def manor_facade(b, lk, S, width=24.0, height=8.0, floors=2, style='georgian', door=True, arches=False, shutter_colour=None, colour=None, trim=None):
    """One house front at y=0 (centred, towards -Y): style georgian (sash windows with sills and lintels, string course, quoins) | tudor
    (wide mullioned windows) | colonial (shuttered windows) | castle (arched windows, quoins) | house | bungalow; a central door; arches=True makes the
    ground-floor windows round-headed."""
    M = _mod('manor')
    st = style if style in ('georgian', 'tudor', 'colonial', 'castle', 'house', 'bungalow') else 'georgian'
    P = _P(feats=_feats(arches=arches))
    b.section('manor-facade')
    M.manor_facade(b, lk, P, _wall(_n(width, 24, 4, 80)), 0, _n(height, 8, 3, 20), int(U.clamp(int(floors), 1, 4)), S, st, door_seg=bool(door), wc=colour, shutters=shutter_colour)


@part('half-timber-wall')
def half_timber_wall(b, lk, S, width=20.0, height=7.0, floors=2, close=False, timber_colour='#3b2c20', plaster_colour=None, windows=True):
    """A Tudor half-timbered wall at y=0 (centred, towards -Y): rendered panels with floor rails, studs every bay, end braces and mullioned windows
    (close=True gives close studding). LOD0 timber only."""
    M = _mod('manor')
    W, H = _n(width, 20, 3, 60), _n(height, 7, 3, 16)
    fl = int(U.clamp(int(floors), 1, 3))
    seg = _wall(W)
    pc = plaster_colour or '#efe6cf'
    P = _P()
    if windows:
        M.manor_facade(b, lk, P, seg, 0, H, fl, S, 'tudor', door_seg=False, ws='plain-render', wc=pc, ground_door=False)
    else:
        U.plain(b, seg, 0, W, 0, H, 'plain-render', pc)
    M.half_timber(b, seg, 0, H, fl, timber_colour, bool(close))


@part('tudor-chimney')
def tudor_chimney(b, lk, S, height=3.8, flues=3, width=1.0, depth=1.0, colour='#9a4a36'):
    """A tall brick chimney stack with a stone cap and `flues` terracotta pots side by side, standing on z=0."""
    _mod('manor').chimney(b, lk, 0, 0, 0, _n(height, 3.8, 0.8, 10), _n(width, 1.0, 0.5, 2.5), _n(depth, 1.0, 0.5, 2.5), int(U.clamp(int(flues), 1, 5)), colour)


@part('round-turret')
def round_turret(b, lk, S, radius=2.4, height=9.0, cap='cone', colour=None):
    """A round castle turret with slit windows, a corbelled top ring and a conical cap (or a flat top)."""
    _mod('manor').turret(b, lk, 0, 0, 0, _n(radius, 2.4, 1, 6), _n(height, 9, 3, 30), S, cap if cap in ('cone', 'flat') else 'cone', colour or lk.wall_col)


@part('parterre')
def parterre(b, lk, S, width=10.0, depth=12.0):
    """A clipped-hedge parterre on gravel: four flower beds outlined by box hedges with topiary cones, centred on the origin."""
    w, d = _n(width, 10, 4, 30), _n(depth, 12, 4, 30)
    _mod('manor').parterre(b, S, -w / 2, -d / 2, w / 2, d / 2, 'pt')


@part('topiary')
def topiary(b, lk, S, height=2.0, count=1, spacing=2.5, colour='#3d6f38'):
    """Clipped conical topiary on short trunks; count > 1 makes a row along x."""
    M = _mod('manor')
    n = int(U.clamp(int(count), 1, 20))
    for k in range(n):
        M.topiary(b, (k - (n - 1) / 2) * _n(spacing, 2.5, 1, 8), 0, _n(height, 2, 1, 5), colour)


@part('tree-avenue')
def tree_avenue(b, lk, S, length=60.0, count=7, kind='broadleaf', gap=4.5, height_min=8.0, height_max=11.0):
    """Two rows of trees flanking a drive that runs along +Y from the origin: `count` per side, `gap` m either side of the centre line."""
    M = _mod('manor')
    if b.detail >= 2:
        return
    kd = kind if kind in ('broadleaf', 'conifer', 'palm', 'acacia') else 'broadleaf'
    n = int(U.clamp(int(count), 1, 20))
    rs = S.get('avenue')
    for i in range(n):
        yy = _n(length, 60, 5, 120) * (i + 0.5) / n
        for sg in (-1, 1):
            if b.detail == 1 and i % 2:
                continue
            lib.tree(b, kd, sg * _n(gap, 4.5, 2, 12), yy, rs.uniform(_n(height_min, 8, 3, 20), _n(height_max, 11, 4, 24)), S.get('t%d%d' % (i, sg)), lk)


@part('ball-gate-piers')
def gate_piers(b, lk, S, gap=5.0, height=2.6, colour=None):
    """Two stone gate piers with ball finials either side of an opening of width `gap` (along x, centred)."""
    _mod('manor').gate_piers(b, lk, 0, 0, _n(gap, 5, 1.5, 12), colour or lk.trim_col, _n(height, 2.6, 1.5, 5))


@part('gate-lodge')
def gate_lodge(b, lk, S, width=5.0, depth=4.5):
    """A small gate lodge / watch house with a hipped roof and a door on its -Y face."""
    _mod('manor').lodge(b, lk, 0, 0, _n(width, 5, 2.5, 10), _n(depth, 4.5, 2.5, 9))


@part('outbuilding')
def outbuilding(b, lk, S, width=6.0, depth=3.6, height=2.6):
    """A boys'-quarters / generator house: low rendered block under a mono-pitch corrugated roof."""
    _mod('manor').outbuilding(b, lk, 0, 0, _n(width, 6, 2, 14), _n(depth, 3.6, 2, 8), _n(height, 2.6, 2, 4))


@part('garden-bed')
def garden_bed(b, lk, S, width=4.0, depth=2.8, colour='#b8586a', hedge=True):
    """A flat flower bed (coloured quad on a lawn) with an optional low box-hedge outline, centred on the origin."""
    if b.detail >= 2:
        return
    w, d = _n(width, 4, 1, 20), _n(depth, 2.8, 1, 20)
    with b.site():
        b.face([(-w / 2, -d / 2, 0.08), (w / 2, -d / 2, 0.08), (w / 2, d / 2, 0.08), (-w / 2, d / 2, 0.08)][::-1], 'plain', colour, mode='fit')
    if hedge and b.detail == 0:
        _mod('manor').box_hedge_rect(b, S, -w / 2, -d / 2, w / 2, d / 2, 0.5, 0.4, key='gb')
