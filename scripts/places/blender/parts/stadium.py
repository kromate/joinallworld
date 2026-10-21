"""Parts for stadiums, monuments, parks / landscape and forts / palaces (one author file: stadium.py; the first archetype is `stadium`).

Every part is `fn(b, look, rng, detail, at=(x, y, z), rot=0.0, **params)`: it builds into Builder `b` at `at` (metres) turned `rot` degrees
about +Z (counter-clockwise seen from above). Local frame: origin on the ground, +x to the right of the part's front, +y away from the
camera (into the part), the front faces -y, +z up. Plan-centred parts (bowl, pitch, tower, fountain ...) have their origin at the centre;
wall-attached parts (stand, portico-like things) have the origin at the middle of their front face and extend towards +y.
All sizes are metres, colours '#hex'. Unknown parameters raise TypeError. Every part also accepts the look overrides
`wall_colour wall_material roof_colour roof_material trim_colour accent_colour` (materials: the MATERIALS / ROOF_MATERIALS ids).
detail 0 = full part, 1 = coarse (no small furniture, big tiling), 2 = coloured massing only. Everything is deterministic given `rng`.
Ids are deliberately distinct from ids in core.py / market-open.py / mosque-domed.py.

STADIUM
 stadium-bowl      width=190 depth=150 height=22 tiers=None arc_start=None arc_end=None roof=canopy|ring|none roof_style=shed|truss|membrane|flat
                   wall=ribs|arcade|clad|glass|towers|skin seat_colour=None seat_colour2=None main_height=None far_height=None end_height=None
                   main_depth=None far_depth=None track=True ground=True exponent=2.4 floodlights=True only=None
     a continuous rounded bowl centred on `at`: raked stepped seating whose height and depth vary round the bowl (tall main stand at -y,
     lower ends), outer wall in one of six treatments, cantilever / ring roof, optional pitch + running track. arc_start/arc_end are
     degrees (270 = the front, -y; counter-clockwise) and cut the bowl open with a concrete section at each end (omit both for the whole
     ring). `only` = 'stands'|'wall'|'roof' builds just that layer (ring-roof alone, etc.). height = top of the roof (stand tops lower).
 stadium-stand     length=100 depth=24 height=16 roof=cantilever|none rear=ribbon|punched|curtain|none storeys=2 seat_colour=None seat_colour2=None
                   accent_colour=None accent_material=None
     one straight stand (English-style): raked seating, rear facade with windows, sectioned ends and a cantilever shed roof with props.
     Origin at the middle of the OUTER (rear) wall facing -y; the pitch lies towards +y at y = depth.
 floodlight-mast   height=36 head_width=5 colour='#aeb4ba' -> tapering lattice mast with a lamp rack (LOD0 4 legs + bands).
 football-pitch    length=105 width=68 stripes=8 markings=True goals=True -> mown pitch with lines, penalty boxes and goals (site layer).
 athletics-track   length=176 width=96 lane_width=8.5 infield=True pitch=True colour='#b4553d' -> running track round an infield + pitch.
 scoreboard        width=12 height=5 post_height=2.4 facing=east|west|south|north colour='#2a2d31' -> board on two posts with a blank screen.
 arena-hall        width=60 depth=40 height=14 plan=rect|oval roof=barrel|shed|flat|gable clerestory=True entrance=True entrance_width=None
     an indoor arena / sports hall / velodrome: walls with a clerestory band, barrel (ribbed) / shed / flat roof, glazed entrance annex with
     canopy and columns on the -y face.
 race-track        width=110 depth=70 track_width=7 colour='#b79a72' rail=True rail_colour='#f0efe8' -> dirt oval with white running rail.

MONUMENT
 statue-figure     height=5 pose=stand|raised|forward|robed|lady|warrior|chains|chief colour='#6a583b' -> a statue figure (no plinth) facing -y.
 statue-plinth     height=9 width=None steps=3 shape=tier|tapered|round figure=stand|raised|forward|robed|lady|warrior|chains|chief|none
                   figure_colour='#6a583b' figure_ratio=None relief=False -> stepped base + plinth shaft + figure; `height` is the total.
 obelisk           height=20 base_width=None style=square|pylon|sword steps=3 relief=False crown=none|bird -> tapering stone obelisk with pedestal
                   and pyramidion, a faceted round brutalist pylon with ring slabs, or the upturned sword blade.
 arch-gateway      width=20 depth=6 height=12 openings=1 kind=round|pointed|parabolic|rect pier=None batter=0 crest=none|star|board
                   crenellated=False pinnacles=0 relief=False masts=0 steps=False -> a block pierced by arches (passage along y). batter > 0
                   leans the faces inward (mud gatehouse); crenellated adds merlons; pinnacles = number of horn pinnacles on top; masts = flagpoles.
 tower-square      width=5 height=20 storeys=None cap=hip|flat|none clock=False deck=True -> colonial square tower: plinth, belt courses, slit
                   windows, arched door, corbelled deck with merlons or a clock chamber and hipped cap.
 conical-tower     height=15 radius=3.5 toron=True -> sahelian mud-brick tapering tower with rings of toron beams, stepped top and pinnacle.
 lookout-pylon     height=45 width=5 pod_radius=None -> slim tapered shaft, flared observation pod and mast.
 memorial-hall     width=18 depth=12 height=8 portico=True columns=6 roof=flat|pyramid|dome|none podium=1.2 steps=4 -> a mausoleum / memorial
                   block on a podium with a classical portico or a modernist overhang.
 roundabout        radius=20 road_width=6 island_colour=None trees=6 kerb=True -> roundabout: paved apron, asphalt ring with dashes, kerbed island.
 plaza             width=40 depth=30 border=1.4 colour=None border_colour=None -> paved square with a border band.

PARK / LANDSCAPE
 park-pavilion     width=7 depth=5.5 height=3 kind=hip|gable|flat|cone|thatch floor=True roof_colour=None -> open pavilion / gazebo.
 bandstand         radius=4.2 height=3.6 -> octagonal platform, eight posts, conical roof with finial.
 fountain-basin    radius=4 tiers=2 -> round basin with a stacked-tier fountain and jet.
 gate-piers        width=6 height=4.2 kind=piers|arch|timber -> park entrance: two piers + lintel / arch, or timber posts under a thatched cap.
 thatched-hut      radius=2.6 kind=round|box -> round thatched hut or box shack with a flat lid.
 beach-row         count=8 spacing=4.5 umbrellas=True loungers=True colours=None -> a row of umbrellas with sun loungers.
 pier-boardwalk    length=24 width=3 height=0.9 rails=True piles=True colour='#8a6a43' -> timber pier (extends towards +y).
 ferris-wheel      radius=10 gondolas=16 -> ferris wheel on A-frame legs.
 carousel          radius=6 height=7.6 colour='#d94f4f' -> round platform, pole, striped canopy.
 rock-hill         width=100 depth=80 height=40 seed=1 stairs=True rock_colour=None boulders=12 -> granite outcrop / hill with a stair path up the
                   front (-y) and boulders; the ground stays at z = 0.
 canopy-walkway    length=90 height=18 spans=8 tower=True rails=True -> elevated timber walkway on trestles with an access tower.
 raised-plots      rows=3 cols=5 plot_width=8 plot_depth=6 crop_colours=None -> raised vegetable beds.
 big-tree          height=36 crown_radius=14 trunk_radius=2 colour='#4f8a3f' -> a huge buttressed tree with an umbrella crown.
 water-surface     width=60 depth=40 shape=rect|ellipse colour='#5f8ea3' bank=True -> flat water with a sandy bank line.
 lawn              width=40 depth=30 colour='#6d9a4f' -> a flat grass pad (site layer).
 path-strip        points=[[0,0],[10,5]] width=2.6 colour='#cbc6bb' -> a paved path along a polyline.
 tree-grove        width=40 depth=30 count=12 kind=None min_height=6 max_height=11 keep_out=None -> scattered trees (kind defaults to the look's tree).
 park-bench        count=1 spacing=2.2 -> bench(es) in a row along x.
 flowerbeds        rows=2 cols=2 width=7 depth=5 colours=None -> kerbed flower beds.

FORT / PALACE
 battlement-wall   length=30 height=4 thickness=0.7 merlons=True batter=0 pinnacle=0 ruin=0 points=None -> wall along x (or a polyline `points`),
                   optional merlons, battered faces, horn pinnacles every other post, ruin 0..1 breaks the top.
 corner-tower      radius=3.5 height=12 kind=round|square cap=cone|hip|flat|none ruin=False -> corner / flanking tower.
 fort-gatehouse    width=12 depth=6 height=9 kind=round|pointed batter=0.3 pinnacles=4 relief=True crenellated=True -> arched-passage gate block with
                   merlons, horn pinnacles and relief bands (Hausa zaure / city gate / castle gate).
 horn-pinnacle     height=3 width=1.2 count=1 spacing=3 -> stepped horn-like pinnacle(s) (zankwaye) in a row along x.
 rampart-ring      points=None width=60 depth=40 sides=5 height=6 thickness=2.4 batter=0.9 merlons=True ruin=0 star=True -> closed bastioned or custom
                   polygon rampart.
 cannon            count=1 spacing=3 yaw=0 scale=1 -> muzzle-loading cannon(s) in a row along x, barrels towards `yaw` degrees (0 = +x, 270 = -y).
 hall-range        width=40 depth=10 height=5 roof=flat|hip|gable windows=ribbon|punched|none verandah=False -> a hall with walls, windows, roof.
 earth-rampart     length=80 width=24 height=8 colour='#6d9a4f' -> grassed bank with a ditch (closed ends).
 casemate-block    width=40 depth=16 height=4 count=5 -> concrete casemates with embrasures under an earth terrace.
 moat              width=60 depth=40 moat_width=7 colour='#4f86a0' -> a water ring round a rectangle (centre left free).
 rubble            width=20 depth=12 count=14 colour=None -> scattered fallen blocks.
"""
import copy
import functools
import importlib.util
import math
import os
import random
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ARCH = os.path.join(os.path.dirname(_HERE), 'archetypes')
sys.path.insert(0, _HERE)
sys.path.insert(0, _ARCH)

from _xform import Xform  # noqa: E402

import _stadium_util as U  # noqa: E402

import lib  # noqa: E402
from lib.facade import ROOF_SLOT, WALL_SLOT  # noqa: E402

FLAT = 60.0
_MODS = {}


def _arch(name):
    """An archetype module (stadium, monument, park-landscape, heritage-fort) loaded by path, cached."""
    if name not in _MODS:
        path = os.path.join(_ARCH, name + '.py')
        spec = importlib.util.spec_from_file_location('parts_arch_' + name.replace('-', '_'), path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _MODS[name] = mod
    return _MODS[name]


def _at3(at):
    at = tuple(at or (0.0, 0.0, 0.0))
    return tuple(float(v) for v in at) + (0.0,) * (3 - len(at))


def _lk(look, wall_colour=None, roof_colour=None, trim_colour=None, wall_material=None, roof_material=None, accent_colour=None):
    lk = copy.copy(look)
    if wall_colour:
        lk.wall_col = wall_colour
        if not trim_colour:
            lk.trim_col = lib.shade(wall_colour, 1.08)
    if wall_material:
        lk.wall_material = wall_material
        lk.wall_slot = WALL_SLOT.get(wall_material, 'plain-render')
    if roof_colour:
        lk.roof_col = roof_colour
    if roof_material:
        lk.roof_slot = ROOF_SLOT.get(roof_material, 'metal-roof')
    if trim_colour:
        lk.trim_col = trim_colour
        lk.frame_col = lib.shade(trim_colour, 0.8)
    if accent_colour:
        lk.accent_col = accent_colour
    return lk


def place(fn):
    """Adapter: the body is written in a local frame as fn(b, look, rng, detail, **params); `b` is a placed proxy, `look` has the
    per-part overrides applied and `rng` is a fresh Random."""
    @functools.wraps(fn)
    def wrapper(b, look, rng, detail, at=(0.0, 0.0, 0.0), rot=0.0, wall_colour=None, wall_material=None, roof_colour=None, roof_material=None,
                trim_colour=None, accent_colour=None, **params):
        lk = _lk(look, wall_colour, roof_colour, trim_colour, wall_material, roof_material, accent_colour)
        s = random.Random(rng.getrandbits(64))
        return fn(Xform.make(b, _at3(at), rot), lk, s, detail, **params)
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


def _col(v, default):
    return v if isinstance(v, str) and v.startswith('#') else default


# =================================================================================================================== STADIUM
def _bowl_P(look, width, depth, height, tiers, roof, roof_style, wall, seat_colour, seat_colour2, track, exponent, floodlights, arc, over, roof_material):
    seat = _col(seat_colour, look.accent_col)
    fe = {'floodlights': {'id': 'floodlights', 'count': 4, 'note': ''}} if floodlights else {}
    return {'fe': fe, 'tx': '', 'w': width, 'd': depth, 'H': height, 'st': 2, 'fp': 'oval', 'roof_decl': 'none', 'style': '', 'material': look.wall_material,
            'accent': None, 'year': 0, 'roofed_all': roof == 'ring', 'main_cov': roof in ('ring', 'canopy'), 'track': bool(track),
            'small_council': False, 'wall_style': wall, 'roof_style': roof_style, 'seat_a': seat, 'seat_b': _col(seat_colour2, lib.mix(seat, '#e9e6dc', 0.55)),
            'n_exp': exponent, 'srng_seed': 7, 'typ': 'bowl', 'exact': True, 'arc': arc, 'over': over, 'roof_mat': roof_material or ''}


@place
def stadium_bowl(b, look, rng, detail, width=190.0, depth=150.0, height=22.0, tiers=None, arc_start=None, arc_end=None, roof='canopy', roof_style='shed',
                 wall='ribs', seat_colour=None, seat_colour2=None, main_height=None, far_height=None, end_height=None, main_depth=None, far_depth=None,
                 track=True, ground=True, exponent=2.4, floodlights=True, only=None, roof_material=None):
    st = _arch('stadium')
    w, d, h = _num(width, 190, 30, 400), _num(depth, 150, 24, 400), _num(height, 22, 4, 80)
    arc = None
    if arc_start is not None and arc_end is not None:
        a0, a1 = math.radians(_num(arc_start, 180)), math.radians(_num(arc_end, 270))
        if a1 < a0:
            a1 += 2 * math.pi
        arc = (a0, a1)
    over = {}
    for k, v in (('Hm', main_height), ('Hf', far_height), ('He', end_height), ('Dm', main_depth), ('Df', far_depth)):
        if v is not None:
            over[k] = _num(v, 10, 2, 80)
    if tiers:
        over['tiers'] = int(tiers)
    P = _bowl_P(look, w, d, h, tiers, roof if roof in ('ring', 'canopy', 'none') else 'canopy', roof_style, wall, seat_colour, seat_colour2, track, _num(exponent, 2.4, 2.0, 8.0),
                floodlights, arc, over, roof_material)
    if roof == 'none':
        P['main_cov'] = False
    P['storeys'] = 2
    B = st.Bowl({}, look, P, detail)
    st.ECON = False
    which = only or 'all'
    Zt = None
    if which in ('all', 'stands'):
        b.section('stands')
        rings = st.build_stands(b, B, look, P, rng)
        st.stand_caps(b, B, look, P, rings)
    if which in ('all', 'wall', 'roof'):
        if which != 'roof':
            b.section('wall')
            Zt = st.build_wall(b, B, look, P, rng)
        else:
            Zt = [B.HD(t)[0] + 1.2 for t in B.ts]
    if which in ('all', 'roof'):
        b.section('roof')
        st.build_roof(b, B, look, P, rng, Zt)
    if which == 'all':
        if ground:
            b.section('ground')
            st.build_ground(b, B, look, P, rng)
        if floodlights:
            b.section('lights')
            st.build_lights(b, B, look, P, rng, Zt)


@place
def stadium_stand(b, look, rng, detail, length=100.0, depth=24.0, height=16.0, roof='cantilever', rear='ribbon', storeys=2, seat_colour=None, seat_colour2=None,
                  accent_material=None):
    st = _arch('stadium')
    L, D, Hs = _num(length, 100, 6, 200), _num(depth, 24, 6, 60), _num(height, 16, 3, 40)
    seat = _col(seat_colour, look.accent_col)
    cols = [seat, _col(seat_colour2, lib.mix(seat, '#e9e6dc', 0.55))]
    fr = U.Local(0.0, D, math.pi)
    P = {'roof_slot': look.roof_slot if look.roof_slot != 'corrugated' else 'corrugated'}
    acc = (WALL_SLOT.get(accent_material, 'plain-render'), look.accent_col) if accent_material else None
    st.ECON = False
    b.section('stand')
    st.stand_block(b, look, P, fr, L, D, Hs, roof != 'none', rear if rear in ('ribbon', 'punched', 'curtain', 'none') else 'ribbon', cols, rng, (0, -1),
                   storeys=int(_num(storeys, 2, 1, 4)), accent=acc)


@place
def floodlight_mast(b, look, rng, detail, height=36.0, head_width=5.0, colour='#aeb4ba'):
    b.section('floodlight')
    U.lattice_mast(b, 0, 0, _num(height, 36, 6, 80), colour, _num(head_width, 5, 1, 14), 2.2, 0.0)


def _pitch_marks(b, px, py, z, detail, stripes, markings, goals, clip=None):
    def fill(pts, zz, col, slot='plain', scale=FLAT):
        pl = [(p[0], p[1]) for p in pts]
        if clip:
            pl = U.clip_rect(pl, *clip)
        if len(pl) >= 3:
            U.poly(b, [(p[0], p[1], zz) for p in pl], (0, 0, 1), slot, col, scale=scale)

    def line(a, c, zz, w, col):
        dx, dy = c[0] - a[0], c[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 1e-3:
            return
        nx, ny = -dy / L * w, dx / L * w
        fill([(a[0] - nx, a[1] - ny), (c[0] - nx, c[1] - ny), (c[0] + nx, c[1] + ny), (a[0] + nx, a[1] + ny)], zz, col)

    n = stripes if detail == 0 else 1
    for k in range(n):
        xa, xb = -px + 2 * px * k / n, -px + 2 * px * (k + 1) / n
        fill([(xa, -py), (xb, -py), (xb, py), (xa, py)], z + 0.1, '#58953f' if k % 2 else '#62a048', 'grass', 2.0)
    if detail == 0 and markings:
        lc = '#f4f2ea'
        for (a, c) in (((-px, -py), (px, -py)), ((-px, py), (px, py)), ((-px, -py), (-px, py)), ((px, -py), (px, py)), ((0, -py), (0, py))):
            line(a, c, z + 0.15, 0.07, lc)
        sc = py / 34.0
        for sx in (-1, 1):
            bx0, bx1 = sx * px, sx * (px - 16.5 * sc)
            yb = 20.15 * sc
            for (a, c) in (((bx0, -yb), (bx1, -yb)), ((bx0, yb), (bx1, yb)), ((bx1, -yb), (bx1, yb))):
                line(a, c, z + 0.15, 0.07, lc)
        n_c = 14
        rr = 9.15 * sc
        ring = [(rr * math.cos(2 * math.pi * k / n_c), rr * math.sin(2 * math.pi * k / n_c)) for k in range(n_c)]
        for k in range(n_c):
            line(ring[k], ring[(k + 1) % n_c], z + 0.15, 0.07, lc)
    if detail == 0 and goals:
        for sx in (-1, 1):
            gx = sx * px
            for sy in (-1, 1):
                lib.cylinder(b, gx, sy * 3.66, 0, 2.44, 0.06, n=4, slot='plain', col='#f4f2ea', top=True)
            U.strut(b, (gx, -3.66, 2.44), (gx, 3.66, 2.44), 0.1, '#f4f2ea', slot='plain', ends=False)


@place
def football_pitch(b, look, rng, detail, length=105.0, width=68.0, stripes=8, markings=True, goals=True):
    if detail >= 2:
        return
    with b.site():
        _pitch_marks(b, _num(length, 105, 20, 140) / 2, _num(width, 68, 15, 100) / 2, 0.04, detail, int(_num(stripes, 8, 1, 20)), markings, goals)


@place
def athletics_track(b, look, rng, detail, length=176.0, width=96.0, lane_width=8.5, infield=True, pitch=True, colour='#b4553d'):
    if detail >= 2:
        return
    st = _arch('stadium')
    hx, hy = _num(length, 176, 40, 260) / 2, _num(width, 96, 30, 160) / 2
    tw = _num(lane_width, 8.5, 3, 14)
    n_arc = 7 if detail == 0 else 3
    z = 0.04
    with b.site():
        outer = st.rr_points(0, 0, hx, hy, hy, n_arc)
        inner = st.rr_points(0, 0, hx - tw, hy - tw, hy - tw, n_arc)
        N = len(outer)
        for i in range(N):
            j = (i + 1) % N
            U.poly(b, [(outer[i][0], outer[i][1], z + 0.03), (outer[j][0], outer[j][1], z + 0.03), (inner[j][0], inner[j][1], z + 0.03), (inner[i][0], inner[i][1], z + 0.03)],
                   (0, 0, 1), 'plain', colour, scale=FLAT)
        if detail == 0:
            for frac in (0.34, 0.67):
                ring = st.rr_points(0, 0, hx - tw * frac, hy - tw * frac, hy - tw * frac, n_arc)
                for i in range(len(ring)):
                    a, c = ring[i], ring[(i + 1) % len(ring)]
                    dx, dy = c[0] - a[0], c[1] - a[1]
                    L = math.hypot(dx, dy) or 1
                    nx, ny = -dy / L * 0.06, dx / L * 0.06
                    b.facing([(a[0] - nx, a[1] - ny, z + 0.07), (c[0] - nx, c[1] - ny, z + 0.07), (c[0] + nx, c[1] + ny, z + 0.07), (a[0] + nx, a[1] + ny, z + 0.07)], (0, 0, 1), 'plain', '#efece4', scale=FLAT)
        if infield:
            U.poly(b, [(p[0], p[1], z + 0.06) for p in st.rr_points(0, 0, hx - tw, hy - tw, hy - tw, n_arc)], (0, 0, 1), 'grass', '#5d9a45', scale=2.0)
        if pitch:
            px = min(52.5, hx - tw - 0.4 * (hy - tw) - 2)
            py = min(34.0, hy - tw - 4)
            _pitch_marks(b, px, py, z, detail, 8, True, True)


@place
def scoreboard(b, look, rng, detail, width=12.0, height=5.0, post_height=2.4, facing='south', colour='#2a2d31'):
    yaw = {'south': 0.0, 'east': 90.0, 'north': 180.0, 'west': 270.0}.get(facing, 0.0)
    xb = Xform.make(b, (0, 0, 0), yaw)
    w, h, ph = _num(width, 12, 2, 40), _num(height, 5, 1, 14), _num(post_height, 2.4, 0, 12)
    lib.obox(xb, 0, 0, ph, w, 0.7, h, 0.0, 'plain', colour, skip=('bottom',))
    if detail < 2:
        if detail == 0:
            xb.facing([(-w / 2 + 0.5, -0.38, ph + 0.4), (w / 2 - 0.5, -0.38, ph + 0.4), (w / 2 - 0.5, -0.38, ph + h - 0.4), (-w / 2 + 0.5, -0.38, ph + h - 0.4)], (0, -1, 0), 'glass-ribbon', '#cfd8e0')
        for sx in (-1, 1):
            lib.cylinder(xb, sx * (w / 2 - 1.2), 0, 0, ph, 0.18, n=4, slot='frame', col='#5a5f65', top=False)


@place
def arena_hall(b, look, rng, detail, width=60.0, depth=40.0, height=14.0, plan='rect', roof='barrel', clerestory=True, entrance=True, entrance_width=None):
    st = _arch('stadium')
    lk = look
    w, d, H = _num(width, 60, 16, 120), _num(depth, 40, 14, 100), _num(height, 14, 6, 34)
    oval = plan == 'oval'
    wall_h = H * (0.72 if roof == 'barrel' else 0.9)
    rise = H - wall_h
    fp = lib.fp_oval(w, d, {0: 36, 1: 20, 2: 12}[detail]) if oval else lib.fp_rect(w, d)
    b.section('walls')
    lib.walls(b, fp, 0.0, wall_h, 2 if wall_h > 9 else 1, lk, rng, kind='none', plinth=0.5, rear='plain')
    if detail < 2 and clerestory:
        for seg in fp.edges(min_len=2.0):
            L = seg.length
            if detail == 0 and L > 3:
                zc0, zc1 = wall_h - 3.4, wall_h - 1.3
                b.face([seg.P(0.8, zc0, -0.1), seg.P(L - 0.8, zc0, -0.1), seg.P(L - 0.8, zc1, -0.1), seg.P(0.8, zc1, -0.1)], 'glass-ribbon', lk.glass_col)
                n = max(1, int(L / 5.0))
                for k in range(n + 1):
                    u = 0.8 + (L - 1.6) * k / n
                    lib.seg_box(b, seg, u - 0.12, u + 0.12, zc0 - 0.1, zc1 + 0.1, 0.12, lk.frame_col, 'frame', inset=0.1)
        if detail == 0:
            lib.cornice(b, fp, wall_h - 0.2, 0.3, 0.3, lk)
    b.section('roof')
    rect = (-w / 2, -d / 2, w / 2, d / 2)
    if oval:
        if roof in ('barrel', 'gable', 'shed'):
            pk = _arch('stadium')
            pk._barrel_oval(b, w / 2 + 0.3, d / 2 + 0.3, wall_h, rise, lk, {0: 32, 1: 16, 2: 10}[detail], 4 if detail == 0 else 2, lk.roof_col, lk.roof_slot)
        else:
            lib.flat_roof(b, fp, wall_h, lk, parapet_h=0.8)
    elif roof == 'barrel':
        lib.barrel(b, rect, wall_h, rise, lk, axis='x' if w >= d else 'y', ov=0.3, slot=lk.roof_slot, col=lk.roof_col)
        if detail == 0:
            nr = max(3, int(w / 9.0))
            R = (d * d / 4 + rise * rise) / (2 * rise)
            a0 = math.asin(min(1.0, d / 2 / R))
            for k in range(nr + 1):
                xk = -w / 2 + w * k / nr
                prev = None
                for j in range(7):
                    tt = -a0 + 2 * a0 * j / 6
                    pt = (xk, R * math.sin(tt), wall_h - (R - rise) + R * math.cos(tt) + 0.08)
                    if prev:
                        U.strut(b, prev, pt, 0.32, lk.trim_col, ends=False)
                    prev = pt
    elif roof == 'shed':
        lib.shed(b, rect, wall_h, max(2.0, rise + 1.5), lk, high='back', ov=0.5, slot=lk.roof_slot, col=lk.roof_col)
    elif roof in ('gable', 'hip'):
        lib.roof(b, roof, rect, wall_h, lk, rise=max(rise, 3.0), ov=0.5)
    else:
        lib.flat_roof(b, fp, wall_h, lk, parapet_h=1.0)
    if entrance:
        b.section('entrance')
        aw = _num(entrance_width, min(26.0, w * 0.42), 6, 60)
        ah = min(7.0, wall_h * 0.62)
        ad = 6.5
        yf = -d / 2 if not oval else -d / 2 * 0.92
        lib.box(b, -aw / 2, yf - ad, 0, aw / 2, yf + 0.6, ah, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom', 'back'))
        if detail < 2:
            lib.box(b, -aw / 2 + 1.5, yf - ad - 0.04, 0.3, aw / 2 - 1.5, yf - ad + 0.02, ah - 0.9, lk.glass_slot, lk.glass_col, skip=('bottom', 'back', 'top', 'left', 'right'))
            lib.canopy_flat(b, -aw / 2 - 1.5, yf - ad - 3.5, aw / 2 + 1.5, yf - ad, ah + 0.5, lk, th=0.45, columns=4 if aw > 18 else 2, col=lk.roof_col, edge_col=lk.accent_col, r=0.24)


@place
def race_track(b, look, rng, detail, width=110.0, depth=70.0, track_width=7.0, colour='#b79a72', rail=True, rail_colour='#f0efe8'):
    if detail >= 2:
        return
    W, D, tw = _num(width, 110, 30, 220) / 2, _num(depth, 70, 20, 160) / 2, _num(track_width, 7, 2, 14)
    n = 32 if detail == 0 else 16
    with b.site():
        for k in range(n):
            j = (k + 1) % n
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * j / n
            o0, o1 = ((W - 2) * math.cos(a0), (D - 2) * math.sin(a0)), ((W - 2) * math.cos(a1), (D - 2) * math.sin(a1))
            i0, i1 = ((W - 2 - tw) * math.cos(a0), (D - 2 - tw) * math.sin(a0)), ((W - 2 - tw) * math.cos(a1), (D - 2 - tw) * math.sin(a1))
            b.facing([(o0[0], o0[1], 0.04), (o1[0], o1[1], 0.04), (i1[0], i1[1], 0.04), (i0[0], i0[1], 0.04)], (0, 0, 1), 'sand', colour, scale=3.0)
    if rail:
        for k in range(n):
            a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
            U.railing(b, ((W - 1) * math.cos(a0), (D - 1) * math.sin(a0)), ((W - 1) * math.cos(a1), (D - 1) * math.sin(a1)), 1.1, rail_colour, 3.5)


# ================================================================================================================== MONUMENT
@place
def statue_figure(b, look, rng, detail, height=5.0, pose='stand', colour='#6a583b'):
    M = _arch('monument')
    b.section('figure')
    M.figure(b, 0, 0, 0, _num(height, 5, 0.5, 60), colour, pose if pose in ('stand', 'raised', 'forward', 'robed', 'lady', 'warrior', 'chains', 'chief') else 'stand', rng)


@place
def statue_plinth(b, look, rng, detail, height=9.0, width=None, steps=3, shape='tier', figure='stand', figure_colour='#6a583b', figure_ratio=None, relief=False):
    M = _arch('monument')
    H = _num(height, 9, 2, 60)
    huge = H >= 22
    ph_ratio = _num(figure_ratio, 0, 0, 0.95)
    ph_ratio = (1 - ph_ratio) if ph_ratio else (0.30 if huge else (0.5 if H < 12 else 0.42))
    step_n = int(_num(steps, 3, 0, 6))
    step_h = 0.3 if H < 12 else 0.4
    grow = 0.55 if H < 12 else 0.9
    plinth_h = max(1.2, H * ph_ratio - step_n * step_h)
    pw = _num(width, 0, 0, 40) or (U.clamp(0.16 * H + 1.2, 1.4, 7.0) if not huge else U.clamp(0.1 * H + 3.0, 4, 9))
    ws, stone, tc = look.wall_slot, look.wall_col, look.trim_col
    b.section('base')
    ztop = M.stepped_base(b, 0, 0, pw, pw, step_n, step_h, grow, ws if detail < 2 else 'plain', lib.shade(stone, 0.92), round_=(shape == 'round')) if step_n else 0.0
    b.section('plinth')
    zp1 = ztop + plinth_h
    if shape == 'round':
        U.revolve(b, 0, 0, [(pw / 2, ztop), (pw / 2 * 0.92, zp1 - 0.5), (pw / 2 * 1.08, zp1 - 0.5), (pw / 2 * 1.08, zp1)], 16 if detail == 0 else 8, ws, stone, smooth_=False, scale=3.0)
        U.revolve(b, 0, 0, [(pw / 2 * 1.08, zp1), (0, zp1)], 16 if detail == 0 else 8, ws, tc, smooth_=False)
    elif shape == 'tapered':
        M.frustum_box(b, 0, 0, ztop, zp1 - 0.35, pw, pw, pw * 0.72, pw * 0.72, ws, stone, skip=('bottom', 'top'), scale=2.0)
        lib.box(b, -pw * 0.42, -pw * 0.42, zp1 - 0.35, pw * 0.42, pw * 0.42, zp1, ws, tc, top_slot=ws, skip=('bottom',))
        if relief:
            M.relief_panels(b, 0, 0, ztop, zp1 - 0.35, pw * 0.86, pw * 0.86, lib.shade(stone, 0.7))
    else:
        lib.box(b, -pw / 2, -pw / 2, ztop, pw / 2, pw / 2, ztop + 0.45, ws, lib.shade(stone, 0.9), skip=('bottom',))
        lib.box(b, -pw * 0.42, -pw * 0.42, ztop + 0.45, pw * 0.42, pw * 0.42, zp1 - 0.55, ws, stone, skip=('bottom',), scale=2.0)
        lib.box(b, -pw * 0.52, -pw * 0.52, zp1 - 0.55, pw * 0.52, pw * 0.52, zp1, ws, tc, top_slot=ws, skip=('bottom',))
        if detail == 0 and relief:
            M.relief_panels(b, 0, 0, ztop + 0.45, zp1 - 0.55, pw * 0.84, pw * 0.84, lib.shade(stone, 0.75))
    if figure and figure != 'none':
        b.section('figure')
        M.figure(b, 0, 0, zp1, max(1.6, H - zp1), figure_colour, figure if figure in ('stand', 'raised', 'forward', 'robed', 'lady', 'warrior', 'chains', 'chief') else 'stand', rng)


@place
def obelisk(b, look, rng, detail, height=20.0, base_width=None, style='square', steps=3, relief=False, crown='none'):
    M = _arch('monument')
    H = _num(height, 20, 4, 110)
    ws = look.wall_slot
    step_n = int(_num(steps, 3, 0, 6))
    sh = 0.32 if H < 20 else 0.45
    bw = _num(base_width, 0, 0, 40) or (U.clamp(0.16 * H + 2.0, 2.0, 11.0) if style != 'pylon' else U.clamp(H * 0.25, 6, 12))
    grow = 0.7 if H < 20 else 1.1
    b.section('base')
    ztop = M.stepped_base(b, 0, 0, bw, bw, step_n, sh, grow, ws if detail < 2 else 'plain', lib.shade(look.wall_col, 0.92), round_=(style == 'pylon')) if step_n else 0.0
    b.section('shaft')
    top = H
    if style == 'sword':
        M._blade(b, look, {}, ztop, H - ztop, bw)
    elif style == 'pylon':
        top = M._brutal_pylon(b, look, {'storeys': 6, 'H': H}, rng, ztop, H, bw)
    else:
        ped = H * 0.2
        lib.box(b, -bw / 2, -bw / 2, ztop, bw / 2, bw / 2, ztop + ped, ws, look.wall_col, top_slot=ws, skip=('bottom',), scale=2.0)
        if detail < 2:
            lib.box(b, -bw * 0.55, -bw * 0.55, ztop + ped - 0.35, bw * 0.55, bw * 0.55, ztop + ped, ws, look.trim_col, skip=('bottom',))
        if detail == 0 and relief:
            M.relief_panels(b, 0, 0, ztop, ztop + ped - 0.35, bw * 0.86, bw * 0.86, lib.shade(look.wall_col, 0.72))
        z0 = ztop + ped
        shaft_h = (H - z0) * 0.9
        w0, w1 = bw * 0.62, bw * 0.36
        M.frustum_box(b, 0, 0, z0, z0 + shaft_h, w0, w0, w1, w1, ws, look.wall_col, skip=('bottom', 'top'), scale=2.5)
        M.frustum_box(b, 0, 0, z0 + shaft_h, H, w1, w1, 0.01, 0.01, 'plain', look.trim_col, skip=('bottom', 'top'), scale=FLAT)
        if detail == 0:
            for k in range(1, 4):
                zz = z0 + shaft_h * k / 4
                ww = U.lerp(w0, w1, k / 4) + 0.12
                lib.box(b, -ww / 2, -ww / 2, zz - 0.06, ww / 2, ww / 2, zz + 0.06, ws, look.trim_col, skip=('bottom',))
    if crown == 'bird' and detail < 2:
        M._bird(b, 0, 0, top, U.clamp(H * 0.09, 0.8, 3.0), '#6a583b')


@place
def arch_gateway(b, look, rng, detail, width=20.0, depth=6.0, height=12.0, openings=1, kind='round', pier=None, batter=0.0, crest='none', crenellated=False,
              pinnacles=0, relief=False, masts=0, steps=False):
    M = _arch('monument')
    W, D, H = _num(width, 20, 3, 100), _num(depth, 6, 1.5, 40), _num(height, 12, 3, 60)
    n_op = int(_num(openings, 1, 1, 5))
    kind = kind if kind in ('round', 'pointed', 'parabolic', 'rect') else 'round'
    pw = _num(pier, 0, 0, 20) or U.clamp(W * (0.14 if n_op == 1 else 0.1), 1.6, 5.0)
    ops = []
    if n_op == 1:
        span = U.clamp(W - 2 * pw, 2.5, W * 0.7)
        rt = U.clamp(H * 0.62, 2.0, H - 1.6)
        zs = rt * (0.5 if kind != 'rect' else 0.0)
        ops.append({'xc': 0.0, 'span': span, 'zs': zs, 'rise': rt - zs if kind != 'rect' else rt, 'kind': kind})
    else:
        total = W - pw * (n_op + 1)
        wts = [1.0] * n_op
        if n_op >= 3:
            wts = [0.62 if i != n_op // 2 else 1.0 for i in range(n_op)]
        x = -W / 2 + pw
        for i, wt in enumerate(wts):
            sp = total * wt / sum(wts)
            rt = H * (0.7 if i == n_op // 2 else 0.5)
            zs = rt * 0.5 if kind != 'rect' else 0.0
            ops.append({'xc': x + sp / 2, 'span': sp, 'zs': zs, 'rise': (rt - zs) if kind != 'rect' else rt, 'kind': kind})
            x += sp + pw
    bt = _num(batter, 0, 0, 2)
    blk_H = H * (0.9 if bt else 0.88)
    b.section('block')
    if steps and detail < 2:
        with b.site():
            lib.steps(b, -W / 2 - 2, W / 2 + 2, -D / 2, 0.9, 2.6, 3 if detail == 0 else 2, 'paving', look.stone_col)
    curves = M.arch_block(b, -W / 2, W / 2, -D / 2, D / 2, blk_H, ops, look.wall_slot, look.wall_col, look.wall_col if bt else look.roof_col, look.trim_col, batter=bt,
                          scale=2.5 if not bt else 2.0)
    if detail == 0 and not bt:
        M.archivolt(b, curves, ops, -D / 2, -1, 0.45, 0.22, look.trim_col)
    top = blk_H
    if H - blk_H > 0.5 and not bt:
        lib.box(b, -W / 2 * 0.98, -D / 2 * 0.98, blk_H, W / 2 * 0.98, D / 2 * 0.98, H, look.wall_slot, look.trim_col, top_slot='roof-flat', top_col=look.roof_col, skip=('bottom',))
        top = H
    if crenellated and detail < 2:
        lib.box(b, -W / 2 + bt - 0.15, -D / 2 + bt - 0.15, top, W / 2 - bt + 0.15, D / 2 - bt + 0.15, top + 0.35, look.wall_slot, look.wall_col, top_slot=look.wall_slot, skip=('bottom',))
        for sy in (-1, 1):
            U.crenellation(b, (-W / 2 + bt, sy * (D / 2 - bt)), (W / 2 - bt, sy * (D / 2 - bt)), top + 0.35, 0.9, 0.9, 0.7, 0.45, look.wall_slot, look.wall_col)
        for sx in (-1, 1):
            U.crenellation(b, (sx * (W / 2 - bt), -D / 2 + bt), (sx * (W / 2 - bt), D / 2 - bt), top + 0.35, 0.9, 0.9, 0.7, 0.45, look.wall_slot, look.wall_col)
        top += 0.35
    npin = int(_num(pinnacles, 0, 0, 8))
    if npin and detail < 2:
        ph, pwd = U.clamp(H * 0.34, 1.2, 4.0), U.clamp(W * 0.07, 0.7, 1.6)
        spots = [(-W / 2 + bt + pwd, -D / 2 + bt + pwd), (W / 2 - bt - pwd, -D / 2 + bt + pwd), (-W / 2 + bt + pwd, D / 2 - bt - pwd), (W / 2 - bt - pwd, D / 2 - bt - pwd),
                 (0.0, -D / 2 + bt + pwd), (0.0, D / 2 - bt - pwd), (-W * 0.25, -D / 2 + bt + pwd), (W * 0.25, -D / 2 + bt + pwd)]
        for (px, py) in spots[:npin]:
            U.pinnacle(b, px, py, top, ph, pwd * 2.0, look.wall_col, look.wall_slot)
    if relief and detail == 0 and ops:
        M_ = M
        op = ops[len(ops) // 2]
        yf = -D / 2 + bt * (op['zs'] + op['rise']) / H - 0.04
        zt = op['zs'] + op['rise']
        dark, light = lib.shade(look.wall_col, 0.74), lib.mix(look.wall_col, '#efe7d6', 0.5)
        zb0, zb1 = zt + 0.55, min(H - 0.5, zt + 1.5)
        n = max(3, int(W / 1.4))
        if zb1 > zb0 + 0.3:
            for k in range(n):
                xa, xb = -W / 2 + 0.8 + (W - 1.6) * k / n, -W / 2 + 0.8 + (W - 1.6) * (k + 1) / n
                b.facing([(xa, yf, zb0), (xb, yf, zb0), ((xa + xb) / 2, yf, zb1)], (0, -1, 0), 'plain', dark if k % 2 == 0 else light, scale=FLAT)
        for sgn in (-1, 1):
            x0 = op['xc'] + sgn * (op['span'] / 2 + 0.25)
            b.facing([(x0, yf, 0.0), (x0 + sgn * 0.55, yf, 0.0), (x0 + sgn * 0.55, yf, zt + 0.2), (x0, yf, zt + 0.2)], (0, -1, 0), 'plain', light, scale=FLAT)
    if crest == 'star' and detail < 2:
        sr = U.clamp(W * 0.12, 1.2, 4.0)
        q = [(x, -0.3, top + sr * 0.2 + y_) for x, y_ in U.star_pts(0.0, 0.0, sr, sr * 0.4)]
        U.poly(b, q, (0, -1, 0), 'plain', '#26282b', scale=FLAT)
        U.poly(b, q[::-1], (0, 1, 0), 'plain', '#26282b', scale=FLAT)
    elif crest == 'board' and detail < 2:
        lib.obox(b, 0, -D / 2 - 0.1, top, min(6.0, W * 0.25), 0.4, min(3.4, H * 0.16), 0.0, 'plain', lib.mix(look.trim_col, '#3a3a3a', 0.5), skip=('bottom',))
    nm = int(_num(masts, 0, 0, 4))
    if nm and detail < 2:
        cols = ['#1f7a4d', '#f2f2ee', '#b83a32', '#2f5fa0']
        for k in range(nm):
            x = (k - (nm - 1) / 2) * (W * 0.42)
            lib.cylinder(b, x, 0, top, top + 9.0, 0.14, n=5, slot='frame', col='#c8ccd0', r_top=0.08, top=True)
            if detail == 0:
                q = [(x, 0, top + 8.9), (x + 3.4, 0, top + 8.9), (x + 3.4, 0, top + 6.9), (x, 0, top + 6.9)]
                b.face(q, 'plain', cols[k % 4], scale=FLAT)
                b.face(q[::-1], 'plain', cols[k % 4], scale=FLAT)


@place
def tower_square(b, look, rng, detail, width=5.0, height=20.0, storeys=None, cap='hip', clock=False, deck=True):
    M = _arch('monument')
    P = {'fe': {}, 'style': 'colonial' if cap == 'flat' else 'victorian', 'storeys': storeys or 0, 'roof': 'none'}
    b.section('tower')
    M._tower_square(b, look, P, rng, _num(height, 20, 4, 110), _num(width, 5, 2, 20), bool(clock) or cap == 'hip')


@place
def conical_tower(b, look, rng, detail, height=15.0, radius=3.5, toron=True):
    M = _arch('monument')
    b.section('tower')
    M._tower_conical(b, look, {'fe': {}}, rng, _num(height, 15, 4, 60), _num(radius, 3.5, 1, 10) * 2)


@place
def lookout_pylon(b, look, rng, detail, height=45.0, width=5.0, pod_radius=None):
    M = _arch('monument')
    b.section('pylon')
    M._tower_pylon(b, look, {'fe': {}, 'style': 'modernist'}, rng, _num(height, 45, 12, 130), _num(width, 5, 2, 14) / 0.6)


@place
def memorial_hall(b, look, rng, detail, width=18.0, depth=12.0, height=8.0, portico=True, columns=6, roof='flat', podium=1.2, steps=4):
    wb, db, hb = _num(width, 18, 4, 60), _num(depth, 12, 4, 40), _num(height, 8, 3, 30)
    ws, wc, tc = look.wall_slot, look.wall_col, look.trim_col
    pod = _num(podium, 1.2, 0.2, 4)
    b.section('podium')
    lib.box(b, -wb / 2 - 3.0, -db / 2 - 4.5, 0, wb / 2 + 3.0, db / 2 + 3.0, pod, ws, lib.shade(look.stone_col, 0.95), top_slot='paving', top_col=look.stone_col, skip=('bottom',), scale=3.0)
    if detail < 2 and steps:
        with b.site():
            lib.steps(b, -min(wb * 0.4, 7.0), min(wb * 0.4, 7.0), -db / 2 - 4.5, pod, 2.4, int(steps) if detail == 0 else 2, 'paving', look.stone_col)
    b.section('block')
    lib.box(b, -wb / 2, -db / 2, pod, wb / 2, db / 2, pod + hb, ws, wc, top_slot='roof-flat', top_col=look.roof_col, skip=('bottom',), scale=2.5)
    zt = pod + hb
    if detail < 2:
        lib.sweep(b, lib.fp_rect(wb, db), zt - 0.45, [(0, 0), (0.35, 0), (0.35, 0.3), (0.5, 0.45), (0, 0.45)], ws, tc)
    if portico:
        lib.portico(b, 0, -db / 2, pod, min(wb * 0.7, 18.0), 3.6 if detail < 2 else 3.0, hb * 0.92, look, cols=int(_num(columns, 6, 2, 12)), pediment=(roof != 'dome'), steps_n=0, rise=min(2.4, wb * 0.08))
    elif detail < 2:
        lib.box(b, -wb / 2 - 1.2, -db / 2 - 2.8, zt, wb / 2 + 1.2, db / 2 + 1.2, zt + 0.5, ws, tc, top_slot='roof-flat', top_col=look.roof_col, skip=('bottom',))
        lib.box(b, -wb * 0.28, -db / 2 - 0.02, pod + 0.2, wb * 0.28, -db / 2 + 0.02, pod + hb * 0.72, look.glass_slot, look.glass_col, skip=('bottom', 'back', 'top', 'left', 'right'))
    if roof == 'pyramid':
        lib.hip(b, (-wb / 2, -db / 2, wb / 2, db / 2), zt, max(2.0, wb * 0.18), look, ov=0.5)
    elif roof == 'dome':
        lib.dome(b, 0, 0, zt, min(wb, db) * 0.3, look, profile='shallow', drum=1.2, lantern=0.8)


@place
def roundabout(b, look, rng, detail, radius=20.0, road_width=6.0, island_colour=None, trees=6, kerb=True):
    M = _arch('monument')
    R = _num(radius, 20, 4, 50)
    rw = _num(road_width, 6, 2, 14)
    n = 32 if detail == 0 else 16
    with b.site():
        M.disc(b, 0, 0, 0.0, R + rw + 3.0, 0.0, 'paving', lib.mix(look.ground_col, '#9a968c', 0.4), n=n, scale=4.0)
        if detail < 2:
            M.disc(b, 0, 0, R, R + rw, 0.04, 'asphalt', '#5a5c5f', n=n, scale=4.0)
            if detail == 0:
                for k in range(24):
                    a0 = 2 * math.pi * k / 24
                    a1 = a0 + 0.1
                    rr = R + rw / 2
                    U.poly(b, [(rr * math.cos(a0), rr * math.sin(a0), 0.06), (rr * math.cos(a1), rr * math.sin(a1), 0.06), ((rr + 0.15) * math.cos(a1), (rr + 0.15) * math.sin(a1), 0.06), ((rr + 0.15) * math.cos(a0), (rr + 0.15) * math.sin(a0), 0.06)][::-1], (0, 0, 1), 'plain', '#efece4', scale=FLAT)
            M.disc(b, 0, 0, 0.0, R, 0.12, 'grass', _col(island_colour, '#6d9a4f'), n=n, scale=2.0)
            if kerb:
                M.kerb(b, 0, 0, R, 0.0, 0.18, 0.35, 'paving', '#b8b4aa', n=n)
            for k in range(int(_num(trees, 6, 0, 16)) if detail == 0 else 0):
                a = 2 * math.pi * (k + 0.5) / max(1, int(trees))
                lib.tree(b, look.tree, R * 0.66 * math.cos(a), R * 0.66 * math.sin(a), rng.uniform(5, 8), rng, look)


@place
def plaza(b, look, rng, detail, width=40.0, depth=30.0, border=1.4, colour=None, border_colour=None):
    W, D = _num(width, 40, 6, 120) / 2, _num(depth, 30, 6, 120) / 2
    with b.site():
        lib.ground(b, -W, -D, W, D, look, 'paving', _col(colour, lib.mix(look.ground_col, '#b9b4aa', 0.5) if look.ground_slot != 'paving' else '#bdb7ab'), z=0.0, scale=3.0)
        if detail < 2 and border > 0:
            m = _num(border, 1.4, 0.2, 6)
            bc = _col(border_colour, lib.shade(look.stone_col, 0.8))
            for (a0, b0, a1, b1) in ((-W, -D, W, -D + m), (-W, D - m, W, D), (-W, -D, -W + m, D), (W - m, -D, W, D)):
                b.face([(a0, b0, 0.04), (a1, b0, 0.04), (a1, b1, 0.04), (a0, b1, 0.04)], 'paving', bc, scale=2.0)


# ================================================================================================================= PARK
@place
def park_pavilion(b, look, rng, detail, width=7.0, depth=5.5, height=3.0, kind='hip', floor=True, roof_colour=None):
    P = _arch('park-landscape')
    b.section('pavilion')
    P.pavilion(b, look, 0, 0, _num(width, 7, 2, 40), _num(depth, 5.5, 2, 40), _num(height, 3, 2, 12), kind if kind in ('hip', 'gable', 'flat', 'cone', 'thatch') else 'hip', rng,
               col=None, floor=bool(floor))


@place
def bandstand(b, look, rng, detail, radius=4.2, height=3.6):
    b.section('bandstand')
    _arch('park-landscape').bandstand(b, look, 0, 0, _num(radius, 4.2, 2, 12), _num(height, 3.6, 2, 8), rng)


@place
def fountain_basin(b, look, rng, detail, radius=4.0, tiers=2):
    b.section('fountain')
    _arch('park-landscape').fountain(b, look, 0, 0, _num(radius, 4, 1.5, 14), rng, int(_num(tiers, 2, 1, 4)))


@place
def gate_piers(b, look, rng, detail, width=6.0, height=4.2, kind='piers'):
    b.section('gate')
    _arch('park-landscape').gate_structure(b, look, {}, 0, 0, _num(width, 6, 2, 30), _num(height, 4.2, 2, 12), kind if kind in ('piers', 'arch', 'timber') else 'piers', rng)


@place
def thatched_hut(b, look, rng, detail, radius=2.6, kind='round'):
    b.section('hut')
    _arch('park-landscape').hut(b, look, 0, 0, _num(radius, 2.6, 1, 8), rng, thatch=(kind == 'round'))


@place
def beach_row(b, look, rng, detail, count=8, spacing=4.5, umbrellas=True, loungers=True, colours=None):
    if detail >= 2:
        return
    P = _arch('park-landscape')
    cols = list(colours) if colours else ['#d94f4f', '#e8b53a', '#3f87c8', '#f0f0e8', '#4fae6a']
    n = int(_num(count, 8, 1, 30)) if detail == 0 else max(2, int(_num(count, 8, 1, 30)) // 2)
    sp = _num(spacing, 4.5, 2, 12)
    with b.site():
        for k in range(n):
            x = (k - (n - 1) / 2) * sp
            y = (k % 2) * 1.5
            if umbrellas:
                P.umbrella(b, x, y, cols[k % len(cols)])
            if loungers and detail == 0:
                lib.obox(b, x - 1.0, y - 1.6, 0.0, 0.7, 1.8, 0.35, 0.0, 'plain', '#f0efe8', skip=('bottom',))
                lib.obox(b, x + 1.0, y - 1.6, 0.0, 0.7, 1.8, 0.35, 0.0, 'plain', '#f0efe8', skip=('bottom',))


@place
def pier_boardwalk(b, look, rng, detail, length=24.0, width=3.0, height=0.9, rails=True, piles=True, colour='#8a6a43'):
    b.section('pier')
    _arch('park-landscape').jetty(b, look, 0, 0, _num(length, 24, 3, 120), _num(width, 3, 1, 10), _num(height, 0.9, 0.3, 4), piles=bool(piles), rail=bool(rails), col=colour)


@place
def ferris_wheel(b, look, rng, detail, radius=10.0, gondolas=16):
    b.section('wheel')
    _arch('park-landscape').ferris_wheel(b, look, 0, 0, _num(radius, 10, 4, 40), rng)


@place
def carousel(b, look, rng, detail, radius=6.0, height=7.6, colour='#d94f4f'):
    r = _num(radius, 6, 2, 14)
    h = _num(height, 7.6, 4, 16)
    b.section('carousel')
    lib.cylinder(b, 0, 0, 0, 0.5, r, n=16 if detail == 0 else 8, slot='plain', col='#d9d2c0', top=True, smooth=False)
    lib.cylinder(b, 0, 0, 0.5, h - 2.0, 0.35, n=6, slot='frame', col='#c8ccd0', top=False)
    U.revolve(b, 0, 0, [(r * 1.15, h - 2.6), (0.2, h)], 12 if detail == 0 else 8, 'plain', colour, smooth_=False, scale=FLAT)
    if detail == 0:
        for k in range(6):
            a = 2 * math.pi * k / 6
            lib.cylinder(b, r * 0.8 * math.cos(a), r * 0.8 * math.sin(a), 0.5, h - 2.6, 0.06, n=4, slot='frame', col='#e8b53a', top=False)


@place
def rock_hill(b, look, rng, detail, width=100.0, depth=80.0, height=40.0, seed=1, stairs=True, rock_colour=None, boulders=12):
    PK = _arch('park-landscape')
    W, D, H = _num(width, 100, 20, 200), _num(depth, 80, 16, 160), _num(height, 40, 6, 120)
    r = random.Random(int(seed) * 7919 + 13)
    ph = [r.uniform(0, 6.28) for _ in range(5)]
    na, nr = {0: 44, 1: 20, 2: 10}[detail], {0: 12, 1: 6, 2: 3}[detail]
    rock = _col(rock_colour, lib.mix(look.wall_col if look.wall_slot != 'plain-render' else '#8c8a86', '#8c8a86', 0.5))
    veg = '#6f8a52'
    grid = []
    for i in range(na + 1):
        a = 2 * math.pi * i / na
        row = []
        for k in range(nr + 1):
            t = 1.0 - (k / nr) ** 1.25
            jag = 1.0 - 0.07 * (0.5 + 0.5 * math.sin(5 * a + ph[3])) - 0.05 * (0.5 + 0.5 * math.sin(9 * a + ph[4]))
            x, y = (W / 2) * t * jag * math.cos(a), (D / 2) * t * jag * math.sin(a)
            row.append((x, y, PK.hill_height({}, x, y, W, D, H, ph)))
        grid.append(row)
    b.section('mound')
    for i in range(na):
        for k in range(nr):
            q = [grid[i][k], grid[i + 1][k], grid[i + 1][k + 1], grid[i][k + 1]]
            zm = sum(p[2] for p in q) / 4
            t = U.clamp((0.3 - zm / H) / 0.3, 0.0, 1.0) * 0.85
            col = lib.shade(lib.mix(rock, veg, t), 0.9 + 0.2 * (((i * 7 + k * 13) % 9) / 9.0))
            b.facing(q, (0, 0, 1), 'plain' if detail == 2 else 'rough-concrete', col, scale=FLAT if detail == 2 else 3.0)
    if detail == 0:
        for k in range(int(_num(boulders, 12, 0, 40))):
            a, rr = r.uniform(0, 6.28), r.uniform(0.15, 0.7)
            x, y = (W / 2) * rr * math.cos(a), (D / 2) * rr * math.sin(a)
            z = PK.hill_height({}, x, y, W, D, H, ph)
            lib.blob(b, x, y, z + 0.2, r.uniform(1.2, 3.0), r.uniform(1.0, 2.6), r.uniform(0.9, 1.9), lib.shade(rock, r.uniform(0.85, 1.05)), n=6, rings=3, smooth=False)
    if stairs and detail < 2:
        b.section('stairs')
        pts = []
        for k in range(18):
            t = k / 17.0
            a = -math.pi / 2 + 0.35 * math.sin(t * 5.0) * (1 - t)
            rr = 0.92 - 0.8 * t
            x, y = (W / 2) * rr * math.cos(a), (D / 2) * rr * math.sin(a)
            pts.append((x, y, PK.hill_height({}, x, y, W, D, H, ph) + 0.06))
        for p0, p1 in zip(pts[:-1], pts[1:]):
            dx, dy = p1[0] - p0[0], p1[1] - p0[1]
            L = math.hypot(dx, dy) or 1
            nx, ny = -dy / L * 1.1, dx / L * 1.1
            b.facing([(p0[0] - nx, p0[1] - ny, p0[2]), (p1[0] - nx, p1[1] - ny, p1[2]), (p1[0] + nx, p1[1] + ny, p1[2]), (p0[0] + nx, p0[1] + ny, p0[2])], (0, 0, 1), 'plain', '#d6d1c6', scale=FLAT)
            if detail == 0:
                for sg in (-1, 1):
                    U.strut(b, (p0[0] + sg * nx, p0[1] + sg * ny, p0[2] + 0.9), (p1[0] + sg * nx, p1[1] + sg * ny, p1[2] + 0.9), 0.06, '#6f757b', ends=False)


@place
def canopy_walkway(b, look, rng, detail, length=90.0, height=18.0, spans=8, tower=True, rails=True):
    L, Hw = _num(length, 90, 12, 200), _num(height, 18, 4, 40)
    n_p = int(_num(spans, 8, 2, 20)) + 1
    xs = [-L / 2 + L * k / (n_p - 1) for k in range(n_p)]
    zs = [Hw * (0.95 + 0.08 * math.sin(k * 1.3)) for k in range(n_p)]
    b.section('walkway')
    if tower:
        lib.box_c(b, xs[0] - 3.0, -6.0, 0, 4.0, 4.0, Hw + 0.3, 'timber', '#7a5a38', top_slot='timber', skip=('bottom',), scale=6.0)
    for k in range(n_p - 1):
        x0, x1 = xs[k], xs[k + 1]
        y0, y1 = 3.0 * math.sin(k * 0.9), 3.0 * math.sin((k + 1) * 0.9)
        U.strut(b, (x0, y0, zs[k]), (x1, y1, zs[k + 1]), 1.6, '#8a6a43', slot='timber')
        if rails and detail < 2:
            yaw = math.atan2(y1 - y0, x1 - x0)
            for sg in (-1, 1):
                nx, ny = -math.sin(yaw) * 0.85 * sg, math.cos(yaw) * 0.85 * sg
                U.strut(b, (x0 + nx, y0 + ny, zs[k] + 1.0), (x1 + nx, y1 + ny, zs[k + 1] + 1.0), 0.07, '#d8d8d8', ends=False)
    for k in range(n_p):
        yk = 3.0 * math.sin(k * 0.9)
        lib.cylinder(b, xs[k], yk, 0, zs[k], 0.45, n=6 if detail == 0 else 4, slot='timber', col='#6a4a2e', top=False)
        if detail < 2:
            lib.box_c(b, xs[k], yk, zs[k] - 0.15, 3.4, 3.4, 0.25, 'timber', '#8a6a43', top_slot='timber', skip=('bottom',))


@place
def raised_plots(b, look, rng, detail, rows=3, cols=5, plot_width=8.0, plot_depth=6.0, crop_colours=None):
    if detail >= 2:
        return
    crops = list(crop_colours) if crop_colours else ['#5f9a45', '#7aae52', '#4c8a3c', '#9bb94a', '#6aa04a']
    R, C = int(_num(rows, 3, 1, 8)), int(_num(cols, 5, 1, 12))
    pw, pd = _num(plot_width, 8, 2, 20), _num(plot_depth, 6, 2, 20)
    with b.site():
        for r in range(R):
            for c in range(C):
                x0 = (c - C / 2) * (pw + 1.4)
                y0 = (r - R / 2) * (pd + 1.4)
                lib.box(b, x0, y0, 0, x0 + pw, y0 + pd, 0.35, 'plain', '#6b4a35', top_slot='plain', top_col='#6b4a35', skip=('bottom',), scale=FLAT)
                if detail == 0:
                    for k in range(4):
                        yy = y0 + 0.4 + k * (pd - 0.8) / 4
                        b.face([(x0 + 0.4, yy, 0.5), (x0 + pw - 0.4, yy, 0.5), (x0 + pw - 0.4, yy + (pd - 0.8) / 6, 0.5), (x0 + 0.4, yy + (pd - 0.8) / 6, 0.5)], 'plain', crops[(r + c + k) % len(crops)], scale=FLAT)
                else:
                    b.face([(x0 + 0.3, y0 + 0.3, 0.4), (x0 + pw - 0.3, y0 + 0.3, 0.4), (x0 + pw - 0.3, y0 + pd - 0.3, 0.4), (x0 + 0.3, y0 + pd - 0.3, 0.4)], 'plain', crops[(r + c) % len(crops)], scale=FLAT)


@place
def big_tree(b, look, rng, detail, height=36.0, crown_radius=14.0, trunk_radius=2.0, colour='#4f8a3f'):
    H, R, tr = _num(height, 36, 6, 70), _num(crown_radius, 14, 3, 40), _num(trunk_radius, 2, 0.4, 6)
    b.section('tree')
    U.revolve(b, 0, 0, [(tr * 2.4, 0.0), (tr * 1.4, H * 0.12), (tr, H * 0.3), (tr * 0.85, H * 0.55)], 10 if detail == 0 else 6, 'timber' if detail < 2 else 'plain', '#7a6850', smooth_=True, scale=1.5)
    n = 5 if detail == 0 else (3 if detail == 1 else 2)
    for k in range(n):
        a = 2 * math.pi * k / n
        rr = R * 0.5 if k else 0.0
        lib.blob(b, rr * math.cos(a), rr * math.sin(a), H * (0.72 + 0.05 * (k % 2)), R * 0.62, R * 0.62, H * 0.2, lib.jitter(colour, rng, 0.08), n=10 if detail == 0 else 6, rings=4 if detail == 0 else 3)


@place
def water_surface(b, look, rng, detail, width=60.0, depth=40.0, shape='rect', colour='#5f8ea3', bank=True):
    if detail >= 2:
        return
    W, D = _num(width, 60, 4, 220) / 2, _num(depth, 40, 4, 160) / 2
    with b.site():
        if shape == 'ellipse':
            n = 28 if detail == 0 else 14
            pts = [(W * math.cos(2 * math.pi * k / n), D * math.sin(2 * math.pi * k / n), 0.03) for k in range(n)]
            b.facing(pts, (0, 0, 1), 'plain', colour, scale=FLAT)
            if bank and detail == 0:
                out = [((W + 1.2) * math.cos(2 * math.pi * k / n), (D + 1.2) * math.sin(2 * math.pi * k / n), 0.02) for k in range(n)]
                for k in range(n):
                    j = (k + 1) % n
                    b.facing([out[k], out[j], pts[j], pts[k]], (0, 0, 1), 'plain', '#cdbf96', scale=FLAT)
        else:
            b.face([(-W, -D, 0.03), (W, -D, 0.03), (W, D, 0.03), (-W, D, 0.03)], 'plain', colour, scale=FLAT)
            if bank and detail == 0:
                n = 14
                for k in range(n):
                    xa, xb = -W + 2 * W * k / n, -W + 2 * W * (k + 1) / n
                    za, zb = 1.2 * math.sin(k * 1.7), 1.2 * math.sin((k + 1) * 1.7)
                    b.face([(xa, -D - 0.5, 0.025), (xb, -D - 0.5, 0.025), (xb, -D + zb + 1.4, 0.025), (xa, -D + za + 1.4, 0.025)], 'plain', '#cdbf96', scale=FLAT)


@place
def lawn(b, look, rng, detail, width=40.0, depth=30.0, colour='#6d9a4f'):
    W, D = _num(width, 40, 2, 220) / 2, _num(depth, 30, 2, 220) / 2
    with b.site():
        lib.ground(b, -W, -D, W, D, look, 'grass', colour, z=0.0, scale=3.0)


@place
def path_strip(b, look, rng, detail, points=((0.0, 0.0), (10.0, 5.0)), width=2.6, colour='#cbc6bb'):
    pts = [(float(p[0]), float(p[1])) for p in points]
    with b.site():
        _arch('park-landscape').path_strip(b, pts, _num(width, 2.6, 0.3, 20), 0.05, 'paving', colour)


@place
def tree_grove(b, look, rng, detail, width=40.0, depth=30.0, count=12, kind=None, min_height=6.0, max_height=11.0, keep_out=None):
    W, D = _num(width, 40, 2, 220) / 2, _num(depth, 30, 2, 220) / 2
    avoid = [tuple(float(v) for v in a) for a in (keep_out or [])]
    n = int(_num(count, 12, 0, 120)) if detail == 0 else max(1, int(_num(count, 12, 0, 120)) // 3)
    _arch('park-landscape').scatter_trees(b, look, rng, (-W, -D, W, D), n, avoid, _num(min_height, 6, 2, 40), _num(max_height, 11, 3, 50), kind=kind)


@place
def park_bench(b, look, rng, detail, count=1, spacing=2.2):
    if detail >= 1:
        return
    P = _arch('park-landscape')
    n = int(_num(count, 1, 1, 20))
    for k in range(n):
        P.bench(b, (k - (n - 1) / 2) * _num(spacing, 2.2, 1.8, 10), 0.0, 0.0)


@place
def flowerbeds(b, look, rng, detail, rows=2, cols=2, width=7.0, depth=5.0, colours=None):
    if detail >= 2:
        return
    cs = list(colours) if colours else ['#d95c8a', '#e6b93a', '#f0f0e8', '#c0392b']
    R, C = int(_num(rows, 2, 1, 6)), int(_num(cols, 2, 1, 8))
    w, d = _num(width, 7, 1, 20), _num(depth, 5, 1, 20)
    with b.site():
        for r in range(R):
            for c in range(C):
                x0, y0 = (c - (C - 1) / 2) * (w + 3), (r - (R - 1) / 2) * (d + 3)
                b.face([(x0 - w / 2, y0 - d / 2, 0.07), (x0 + w / 2, y0 - d / 2, 0.07), (x0 + w / 2, y0 + d / 2, 0.07), (x0 - w / 2, y0 + d / 2, 0.07)], 'plain', cs[(r * C + c) % len(cs)], scale=FLAT)
                if detail == 0:
                    lib.box(b, x0 - w / 2 - 0.2, y0 - d / 2 - 0.2, 0, x0 + w / 2 + 0.2, y0 + d / 2 + 0.2, 0.2, 'paving', '#c8c4ba', skip=('bottom', 'top'))


# ================================================================================================================= FORT
@place
def battlement_wall(b, look, rng, detail, length=30.0, height=4.0, thickness=0.7, merlons=True, batter=0.0, pinnacle=0.0, ruin=0.0, points=None):
    F = _arch('heritage-fort')
    pts = [(float(p[0]), float(p[1])) for p in points] if points else [(-_num(length, 30, 1, 200) / 2, 0.0), (_num(length, 30, 1, 200) / 2, 0.0)]
    ru = (rng, _num(ruin, 0, 0, 1)) if ruin else None
    b.section('wall')
    for p0, p1 in zip(pts[:-1], pts[1:]):
        F.wall_seg(b, look, p0, p1, _num(height, 4, 0.5, 30), _num(thickness, 0.7, 0.2, 8), look.wall_col, look.wall_slot, bool(merlons), _num(pinnacle, 0, 0, 8) or None, False, _num(batter, 0, 0, 3), rng, ruin=ru)


@place
def corner_tower(b, look, rng, detail, radius=3.5, height=12.0, kind='round', cap='cone', ruin=False):
    F = _arch('heritage-fort')
    b.section('tower')
    F.tower(b, look, 0, 0, _num(radius, 3.5, 0.8, 14), _num(height, 12, 2, 60), look.wall_col, look.wall_slot, kind if kind in ('round', 'square') else 'round',
            cap if cap in ('cone', 'hip', 'flat', 'none') else 'cone', rng=rng, ruin=bool(ruin))


@place
def fort_gatehouse(b, look, rng, detail, width=12.0, depth=6.0, height=9.0, kind='round', batter=0.3, pinnacles=4, relief=True, crenellated=True):
    F = _arch('heritage-fort')
    M = _arch('monument')
    W, D, H = _num(width, 12, 3, 60), _num(depth, 6, 2, 30), _num(height, 9, 3, 40)
    b.section('gate')
    span = U.clamp(W * 0.34, 2.4, 5.5)
    rise = U.clamp(H * 0.62, 2.2, H - 1.2)
    kk = kind if kind in ('round', 'pointed') else 'round'
    zs = rise * 0.5
    ops = [{'xc': 0.0, 'span': span, 'zs': zs, 'rise': rise - zs, 'kind': kk}]
    bt = _num(batter, 0, 0, 1.5)
    M.arch_block(b, -W / 2, W / 2, -D / 2, D / 2, H, ops, look.wall_slot, look.wall_col, look.wall_col if bt else look.roof_col, look.trim_col, batter=bt)
    if detail < 2 and crenellated:
        lib.box(b, -W / 2 + bt - 0.15, -D / 2 + bt - 0.15, H, W / 2 - bt + 0.15, D / 2 - bt + 0.15, H + 0.35, look.wall_slot, look.wall_col, top_slot=look.wall_slot, skip=('bottom',))
        for sy in (-1, 1):
            U.crenellation(b, (-W / 2 + bt, sy * (D / 2 - bt)), (W / 2 - bt, sy * (D / 2 - bt)), H + 0.35, 0.9, 0.9, 0.7, 0.45, look.wall_slot, look.wall_col)
        for sx in (-1, 1):
            U.crenellation(b, (sx * (W / 2 - bt), -D / 2 + bt), (sx * (W / 2 - bt), D / 2 - bt), H + 0.35, 0.9, 0.9, 0.7, 0.45, look.wall_slot, look.wall_col)
    npn = int(_num(pinnacles, 0, 0, 6))
    if npn and detail < 2:
        ph, pw = U.clamp(H * 0.34, 1.2, 3.6), U.clamp(W * 0.07, 0.7, 1.5)
        spots = [(-W / 2 + bt + pw, -D / 2 + bt + pw), (W / 2 - bt - pw, -D / 2 + bt + pw), (-W / 2 + bt + pw, D / 2 - bt - pw), (W / 2 - bt - pw, D / 2 - bt - pw), (0.0, -D / 2 + bt + pw), (0.0, D / 2 - bt - pw)]
        for (px, py) in spots[:npn]:
            U.pinnacle(b, px, py, H + 0.35, ph, pw * 2.0, look.wall_col, look.wall_slot)
    if relief and detail == 0:
        op = ops[0]
        yf = -D / 2 + bt * (op['zs'] + op['rise']) / H - 0.04
        dark, light = lib.shade(look.wall_col, 0.74), lib.mix(look.wall_col, '#efe7d6', 0.5)
        zt = op['zs'] + op['rise']
        zb0, zb1 = zt + 0.5, min(H - 0.4, zt + 1.4)
        n = max(3, int(W / 1.4))
        if zb1 > zb0 + 0.3:
            for k in range(n):
                xa, xb = -W / 2 + 0.8 + (W - 1.6) * k / n, -W / 2 + 0.8 + (W - 1.6) * (k + 1) / n
                b.facing([(xa, yf, zb0), (xb, yf, zb0), ((xa + xb) / 2, yf, zb1)], (0, -1, 0), 'plain', dark if k % 2 == 0 else light, scale=FLAT)
        for sgn in (-1, 1):
            x0 = sgn * (span / 2 + 0.25)
            b.facing([(x0, yf, 0.0), (x0 + sgn * 0.5, yf, 0.0), (x0 + sgn * 0.5, yf, zt + 0.2), (x0, yf, zt + 0.2)], (0, -1, 0), 'plain', light, scale=FLAT)


@place
def horn_pinnacle(b, look, rng, detail, height=3.0, width=1.2, count=1, spacing=3.0):
    n = int(_num(count, 1, 1, 30))
    for k in range(n):
        U.pinnacle(b, (k - (n - 1) / 2) * _num(spacing, 3, 0.6, 20), 0, 0, _num(height, 3, 0.5, 12), _num(width, 1.2, 0.3, 4), look.wall_col, look.wall_slot)


@place
def rampart_ring(b, look, rng, detail, points=None, width=60.0, depth=40.0, sides=5, height=6.0, thickness=2.4, batter=0.9, merlons=True, ruin=0.0, star=True):
    F = _arch('heritage-fort')
    if points:
        pts = F.ccw([(float(p[0]), float(p[1])) for p in points])
    elif star:
        pts = F.ccw(F.star_outline(_num(width, 60, 8, 200), _num(depth, 40, 8, 160), int(_num(sides, 5, 3, 9)), 0.2))
    else:
        pts = F.ccw(F.outline('rect', _num(width, 60, 8, 200), _num(depth, 40, 8, 160), rng))
    ru = (rng, _num(ruin, 0, 0, 1)) if ruin else None
    b.section('rampart')
    n = len(pts)
    for i in range(n):
        F.wall_seg(b, look, pts[i], pts[(i + 1) % n], _num(height, 6, 1, 30), _num(thickness, 2.4, 0.4, 10), look.wall_col, look.wall_slot, bool(merlons) and not ru, None, False, _num(batter, 0.9, 0, 3), rng,
                   cap_col=look.trim_col, ruin=ru)


@place
def cannon(b, look, rng, detail, count=1, spacing=3.0, yaw=270.0, scale=1.0):
    F = _arch('heritage-fort')
    n = int(_num(count, 1, 1, 20))
    for k in range(n):
        F.cannon(b, (k - (n - 1) / 2) * _num(spacing, 3, 1, 20), 0.0, 0.0, math.radians(_num(yaw, 270)), _num(scale, 1, 0.3, 3))


@place
def hall_range(b, look, rng, detail, width=40.0, depth=10.0, height=5.0, roof='flat', windows='ribbon', verandah=False):
    F = _arch('heritage-fort')
    W, D = _num(width, 40, 3, 120), _num(depth, 10, 3, 40)
    P = {'mud': look.wall_material in ('mud-render', 'laterite'), 'fe': {}}
    b.section('range')
    F.range_building(b, look, P, rng, -W / 2, 0.0, W / 2, D, _num(height, 5, 2.5, 30), roof if roof in ('flat', 'hip', 'gable') else 'flat', verandah=bool(verandah),
                     front=windows if windows in ('ribbon', 'punched', 'none', 'curtain', 'arched') else 'ribbon')


@place
def earth_rampart(b, look, rng, detail, length=80.0, width=24.0, height=8.0, colour='#6d9a4f'):
    L, Dd, H = _num(length, 80, 8, 200), _num(width, 24, 6, 80), _num(height, 8, 1, 30)
    nseg = {0: 24, 1: 10, 2: 5}[detail]
    prof = [(-Dd * 0.5, 0.0), (-Dd * 0.34, 0.9), (-Dd * 0.2, 0.3), (-Dd * 0.12, 0.1), (-Dd * 0.02, H * 0.55), (Dd * 0.1, H), (Dd * 0.2, H), (Dd * 0.38, H * 0.45), (Dd * 0.5, 0.0)]
    rows = []
    for i in range(nseg + 1):
        x = -L / 2 + L * i / nseg
        jit = 1.0 + (0.1 * math.sin(i * 1.7) if detail == 0 else 0.0)
        rows.append([(x, p[0], p[1] * jit) for p in prof])
    b.section('bank')
    b.shared_grid(rows, 'grass', colour, smooth=True, scale=3.0)
    for sgn in (-1, 1):
        x = sgn * L / 2
        U.poly(b, [(x, p[0], p[1]) for p in prof] + [(x, Dd * 0.5, 0.0)], (sgn, 0, 0), 'plain', '#8a6a4c', scale=FLAT)


@place
def casemate_block(b, look, rng, detail, width=40.0, depth=16.0, height=4.0, count=5):
    W, D, H = _num(width, 40, 6, 120), _num(depth, 16, 4, 60), _num(height, 4, 2, 12)
    nb = int(_num(count, 5, 1, 12))
    b.section('casemates')
    for k in range(nb):
        xc = -W / 2 + W * (k + 0.5) / nb
        cw = W / nb * 0.8
        lib.box(b, xc - cw / 2, -D * 0.22, 0, xc + cw / 2, D * 0.12, H, 'rough-concrete', look.wall_col, top_slot='grass', top_col='#6d9a4f', skip=('bottom',), scale=2.0)
        if detail < 2:
            b.facing([(xc - 1.0, -D * 0.22 - 0.02, H * 0.2), (xc + 1.0, -D * 0.22 - 0.02, H * 0.2), (xc + 1.0, -D * 0.22 - 0.02, H * 0.65), (xc - 1.0, -D * 0.22 - 0.02, H * 0.65)], (0, -1, 0), 'plain', '#1f2124', scale=FLAT)
    prof = [(-D * 0.1, 0.0), (-D * 0.05, H), (D * 0.2, H * 1.2), (D * 0.5, 0.0)]
    rows = [[(x, p[0] + D * 0.15, p[1]) for p in prof] for x in (-W / 2, 0.0, W / 2)]
    b.shared_grid(rows, 'grass', '#6d9a4f', smooth=True, scale=3.0)


@place
def moat(b, look, rng, detail, width=60.0, depth=40.0, moat_width=7.0, colour='#4f86a0'):
    if detail >= 2:
        return
    W, D, mw = _num(width, 60, 6, 200) / 2, _num(depth, 40, 6, 160) / 2, _num(moat_width, 7, 1.5, 30)
    with b.site():
        for (a0, b0, a1, b1) in ((-W - mw, -D - mw, W + mw, -D), (-W - mw, D, W + mw, D + mw), (-W - mw, -D, -W, D), (W, -D, W + mw, D)):
            b.face([(a0, b0, 0.06), (a1, b0, 0.06), (a1, b1, 0.06), (a0, b1, 0.06)], 'plain', colour, scale=FLAT)


@place
def rubble(b, look, rng, detail, width=20.0, depth=12.0, count=14, colour=None):
    if detail >= 2:
        return
    W, D = _num(width, 20, 2, 100), _num(depth, 12, 2, 100)
    n = int(_num(count, 14, 1, 80)) if detail == 0 else max(2, int(_num(count, 14, 1, 80)) // 3)
    base = _col(colour, look.wall_col)
    with b.site():
        for k in range(n):
            lib.box_c(b, rng.uniform(-W / 2, W / 2), rng.uniform(-D / 2, D / 2), 0, rng.uniform(0.4, 1.6), rng.uniform(0.4, 1.6), rng.uniform(0.2, 0.7), look.wall_slot, lib.shade(base, rng.uniform(0.8, 1.0)))


PARTS = {
    'stadium-bowl': stadium_bowl, 'stadium-stand': stadium_stand, 'floodlight-mast': floodlight_mast, 'football-pitch': football_pitch,
    'athletics-track': athletics_track, 'scoreboard': scoreboard, 'arena-hall': arena_hall, 'race-track': race_track,
    'statue-figure': statue_figure, 'statue-plinth': statue_plinth, 'obelisk': obelisk, 'arch-gateway': arch_gateway, 'tower-square': tower_square,
    'conical-tower': conical_tower, 'lookout-pylon': lookout_pylon, 'memorial-hall': memorial_hall, 'roundabout': roundabout, 'plaza': plaza,
    'park-pavilion': park_pavilion, 'bandstand': bandstand, 'fountain-basin': fountain_basin, 'gate-piers': gate_piers, 'thatched-hut': thatched_hut,
    'beach-row': beach_row, 'pier-boardwalk': pier_boardwalk, 'ferris-wheel': ferris_wheel, 'carousel': carousel, 'rock-hill': rock_hill,
    'canopy-walkway': canopy_walkway, 'raised-plots': raised_plots, 'big-tree': big_tree, 'water-surface': water_surface, 'lawn': lawn,
    'path-strip': path_strip, 'tree-grove': tree_grove, 'park-bench': park_bench, 'flowerbeds': flowerbeds,
    'battlement-wall': battlement_wall, 'corner-tower': corner_tower, 'fort-gatehouse': fort_gatehouse, 'horn-pinnacle': horn_pinnacle,
    'rampart-ring': rampart_ring, 'cannon': cannon, 'hall-range': hall_range, 'earth-rampart': earth_rampart, 'casemate-block': casemate_block,
    'moat': moat, 'rubble': rubble,
}
