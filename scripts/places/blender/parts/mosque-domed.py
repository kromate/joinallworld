"""Parts for sacred buildings (mosques, Sahelian mud mosques, Asian temples, chapels/shrines): the signature pieces of the
mosque-domed, mosque-sahelian, temple-asian and shrine-small archetypes as reusable PARTS for a per-place composer.

    PARTS = {'part-id': fn}     fn(b, look, rng, detail, at=(x, y, z), rot=0.0, **params)

* `b` is the target lib.Builder, `look` a lib.look(...), `rng` the place's random.Random, `detail` 0/1/2 (LOD0/1/2).
* `at` is the part origin in metres (+x right, +y away from the camera, z up); `rot` is the yaw in DEGREES, counter-clockwise from above.
* A part is built at its own origin on z = 0, its "front" towards -Y, and merged into `b` transformed by `at` and `rot`.
* Colours are '#hex'; None means "take it from `look`" (wall colour, trim colour, accent colour, roof colour). Sizes are metres.
* Unknown parameters are ignored and appended to `b.part_warnings` (a list that is created on demand).
* Every part honours the LOD0/1/2 triangle budgets in proportion (a typical part is 20-1500 triangles at LOD0, a few % of that at LOD2).
* `python3 scripts/places/blender/parts/list.py` style listings can read `PART_DOC` ({id: {'doc', 'params': {name: (default, text)}}}).

Part list (generated from the specs below):
"""
import copy
import importlib.util
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCH = HERE.parent / 'archetypes'
sys.path.insert(0, str(ARCH))
sys.path.insert(0, str(HERE.parent))

import lib  # noqa: E402
import _mosque_domed_util as U  # noqa: E402
from lib import mix, shade  # noqa: E402

TAU = math.tau
GOLD = '#d4a82f'
PARTS = {}
PART_DOC = {}
_mods = {}


def _mod(name):
    if name not in _mods:
        spec = importlib.util.spec_from_file_location('_part_' + name.replace('-', '_'), ARCH / (name + '.py'))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _mods[name] = m
    return _mods[name]


def M():
    return _mod('mosque-domed')


def S():
    return _mod('mosque-sahelian')


def T():
    return _mod('temple-asian')


def SH():
    return _mod('shrine-small')


# ================================================================================================================ plumbing
def _merge(b, tb, at, rot):
    """Append the faces of the temporary builder `tb` to `b`, rotated by rot (degrees, CCW) and moved by `at`."""
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    ax, ay, az = (list(at) + [0.0, 0.0, 0.0])[:3]
    base = len(b.verts)
    for v in tb.verts:
        b.verts.append((ax + c * v[0] - s * v[1], ay + s * v[0] + c * v[1], az + v[2]))
    for i, f in enumerate(tb.faces):
        b.faces.append(tuple(base + k for k in f))
        b.uv.append(tb.uv[i])
        b.cols.append(tb.cols[i])
        b.smooth.append(tb.smooth[i])
        b.layer.append(1 if (tb.layer[i] == 1 or b._layer == 1) else 0)
    b.tris += tb.tris
    b.by_label[b.label] = b.by_label.get(b.label, 0) + tb.tris


def part(pid, doc, **spec):
    """Register a part. spec: name=(default, 'description'). The decorated function is fn(tb, lk, rng, P) building at the origin."""
    def deco(fn):
        def run(b, look, rng, detail, at=(0.0, 0.0, 0.0), rot=0.0, **params):
            unknown = [k for k in params if k not in spec]
            if unknown:
                if not hasattr(b, 'part_warnings'):
                    b.part_warnings = []
                b.part_warnings.append(f'{pid}: unknown parameter(s) {unknown} ignored')
            P = {k: params.get(k, d[0]) for k, d in spec.items()}
            tb = lib.Builder(getattr(b, 'name', 'part'), detail)
            tb.label = pid
            lk = copy.copy(look)
            fn(tb, lk, rng, P)
            _merge(b, tb, at, rot)
            return tb.tris
        run.__name__ = 'part_' + pid.replace('-', '_')
        PARTS[pid] = run
        PART_DOC[pid] = {'doc': doc, 'params': spec}
        return fn
    return deco


def _col(P, key, default):
    v = P.get(key)
    return v if v else default


def _roof_slot(P, cap_col, material=None):
    m = material or P.get('material')
    if m in ('metal', 'gold', 'copper', 'metal-sheet') or U.goldish(cap_col):
        return 'metal-roof'
    if m in ('tile', 'clay-tile'):
        return 'clay-tile'
    if m in ('slate',):
        return 'slate'
    if m in ('thatch', 'timber'):
        return 'timber'
    return 'roof-flat'


def mkD(lk, P, rng, colour='colour', cap='cap_colour', **kw):
    """The dict of colours, slots and flags the archetype helpers read."""
    r = [rng.random() for _ in range(40)] if rng is not None else [0.5] * 40
    wall = _col(P, colour, lk.wall_col)
    capc = _col(P, cap, lk.roof_col)
    trim = _col(P, 'trim', lk.trim_col)
    acc = _col(P, 'accent', lk.accent_col)
    slot = _roof_slot(P, capc)
    D = {'r': r, 'lean': 0, 'type': 'gulf', 'wall': wall, 'wslot': lk.wall_slot, 'trim': trim, 'accent': acc, 'dcol': capc, 'roofc': capc, 'rcol': capc,
         'slot': slot, 'rslot': slot if slot != 'roof-flat' else 'clay-tile', 'gold': U.goldish(capc), 'onion': False, 'stained': False, 'pointed': True,
         'wood': '#6a4f38', 'bay': 3.8, 'wkind': 'arched', 'windows': 'arched', 'ratio': 0.2, 'japan': False, 'ft': {}, 'txt': '', 'st': '', 'fence': False,
         'statue': False, 'flags': False, 'tiers': 0, 'chorten': False, 'ndome': 0, 'dome': False, 'conf': 'medium', 'wall_mat': lk.wall_material,
         'F': {'storeys': 1, 'roof': 'flat', 'fp': 'rect', 'variant': '', 'w': 10, 'd': 10, 'h': 10}}
    D.update(kw)
    lk.wall_col, lk.trim_col, lk.accent_col = wall, trim, acc
    lk.roof_col = capc
    return D


def _dims(D, w, d, h):
    D['W'], D['D'], D['H'] = w, d, h


# ================================================================================================================ mosque parts
@part('minaret', 'A minaret: base block, shaft, balconies and a cap. Styles: pencil (Ottoman: slender 12-sided shaft, two balconies, cone cap), '
      'gulf (8-sided banded shaft, two galleries, onion or dome cupola), square (Arab/Maghrebi tapering square shaft, crenellated gallery, lantern, '
      'pyramid), chhatri (round shaft with a pillared kiosk and onion dome), persian (slender, accent bands, bulb cap), sahelian (tapering '
      'mud tower with toron beams and pinnacles).',
      height=(40.0, 'total height in metres'), style=('pencil', 'pencil|gulf|square|chhatri|persian|sahelian'),
      base_width=(None, 'square base width m (default height * 0.075, min 2.2)'), colour=(None, 'wall/shaft colour (look wall colour)'),
      trim=(None, 'balcony and band colour'), accent=(None, 'stripe colour (persian, gulf bands)'), cap_colour=(None, 'cap / cupola colour (look roof colour)'),
      onion=(False, 'gulf: onion cupola instead of a hemisphere'), material=(None, 'cap material: metal|tile|concrete'))
def _minaret(tb, lk, rng, P):
    D = mkD(lk, P, rng, onion=bool(P['onion']))
    H = P['height']
    bw = P['base_width'] or U.clamp(H * (0.075 if P['style'] != 'square' else 0.15), 2.2, 9.0)
    st = P['style']
    if st == 'sahelian':
        D['wood'] = '#6a4f38'
        S().tower(tb, lk, D, 0.0, 0.0, 0.0, max(bw, H * 0.28), H, taper=0.52, stages=3 if H > 12 else 2, top='pinnacles', toron=True, toron_rows=3)
        return
    M().minaret(tb, lk, D, 0.0, 0.0, 0.0, H, st if st in ('pencil', 'gulf', 'square', 'chhatri', 'persian') else 'pencil', bw)


@part('dome', 'A smooth dome on an optional windowed drum with a cornice ring and a ball finial.',
      radius=(6.0, 'base radius m'), height=(None, 'dome height m (default radius * profile ratio)'),
      profile=('hemi', 'hemi|shallow|pointed|bulb|onion|ogee|lotus'), drum=(0.0, 'drum height m (0 = none)'), windows=(0, 'number of drum windows (LOD0)'),
      colour=(None, 'dome colour (look roof colour)'), drum_colour=(None, 'drum colour (look wall colour)'), material=(None, 'metal|tile|concrete (auto from colour)'),
      flute=(0, 'ribs/lobes on the dome (0 = smooth)'), finial=(True, 'ball-and-spike finial'), finial_height=(None, 'finial height m'),
      ring=(True, 'cornice ring at the drum top / dome base'), stained=(False, 'blue drum windows'))
def _dome(tb, lk, rng, P):
    D = mkD(lk, P, rng, colour='drum_colour', cap='colour', stained=bool(P['stained']))
    R = P['radius']
    kind = P['profile']
    hd = P['height'] or R * M().HR.get(kind, 1.0)
    fh = P['finial_height'] if P['finial'] else 0.0
    M().dome_unit(tb, lk, D, 0.0, 0.0, 0.0, R, hd, P['drum'], kind, windows=P['windows'], flute=(P['flute'], 0.03) if P['flute'] else None, drum_col=D['wall'],
                  finial_h=fh if fh is not None else (None if P['finial'] else 0.0), ring=bool(P['ring']))


@part('semi-dome', 'Half a dome (Ottoman semi-dome) bulging towards -Y from the straight edge on the x axis.',
      radius=(8.0, 'radius m'), height=(None, 'height m (default 0.8 radius)'), colour=(None, 'dome colour'), material=(None, 'metal|tile|concrete'))
def _semi(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='colour')
    R = P['radius']
    hs = P['height'] or R * 0.8
    n = 6 if tb.detail == 0 else 3
    prof = [(R * math.cos(t * math.pi / 2), hs * math.sin(t * math.pi / 2)) for t in [j / n for j in range(n + 1)]]
    U.revolve(tb, 0.0, 0.0, 0.0, prof, U.nn(tb, 14), D['slot'], D['dcol'], smooth=True, scale=1.5, cap=False, a0=math.pi, a1=TAU)


@part('portal', 'Projecting iwan / pishtaq: a block with a tall recessed arch, cornice and finials (or a small dome).',
      width=(8.0, 'm'), height=(14.0, 'm to the cornice'), depth=(3.0, 'projection m'), pointed=(True, 'pointed (True) or round arch'),
      dome_top=(False, 'small dome on top instead of finials'), colour=(None, 'wall'), trim=(None, 'trim'), cap_colour=(None, 'dome colour'))
def _portal(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    M().portal(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'], P['depth'], bool(P['pointed']), bool(P['dome_top']))


@part('arcade', 'A wall strip with a row of arched openings in its front (-Y) face and a flat roof (arcade, riwaq, cloister side).',
      length=(20.0, 'm along x'), height=(5.0, 'm'), thickness=(3.5, 'm in y'), bays=(None, 'number of arches (default length / 3.6)'),
      shape=('pointed', 'pointed|arch|rect'), recess=(1.2, 'depth of the dark recess m'), roof=(True, 'flat roof slab'), parapet=(True, 'parapet round the roof'),
      domes=(False, 'a small dome over each bay (LOD0)'), colour=(None, 'wall'), trim=(None, 'parapet colour'), cap_colour=(None, 'dome colour'))
def _arcade(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    L, h, t = P['length'], P['height'], P['thickness']
    ws, wc = D['wslot'], D['wall']
    M().bx(tb, -L / 2, 0, 0, L / 2, t, h, ws, wc, skip=('bottom', 'front', 'top'))
    seg = lib.Seg((-L / 2, 0.0), (L / 2, 0.0))
    n = P['bays'] or max(1, round(L / 3.6))
    U.arch_openings(tb, seg, lk, 0, h, n, P['shape'], ow=L / n * 0.6, oh=h * 0.74, depth=min(P['recess'], t * 0.8), col=wc, slot=ws, sill=0.0, crown_gap=0.5)
    if P['roof']:
        lib.cap(tb, [[(-L / 2, 0), (L / 2, 0), (L / 2, t), (-L / 2, t)]], h, True, 'roof-flat', shade(wc, 0.92), scale=3.5)
        if P['parapet'] and tb.detail == 0:
            lib.parapet(tb, lib.fp_rect(L, t, 0, t / 2), h, 0.55, 0.25, lk, ws, D['trim'])
        if P['domes'] and tb.detail == 0:
            for k in range(n):
                x = -L / 2 + (k + 0.5) * L / n
                rr = min(t * 0.36, L / n * 0.4)
                U.dome(tb, x, t / 2, h + 0.05, rr, rr * 0.85, 'hemi', D['slot'], D['dcol'], n=12, rings=3)


@part('cloister', 'Three-sided arcaded court enclosure (front -Y wall with a central gate gap, left and right arcades), open at the back (+Y).',
      width=(40.0, 'outer width m'), depth=(30.0, 'outer depth m'), thickness=(3.6, 'arcade width m'), height=(5.0, 'm'),
      gate_width=(5.0, 'gate gap in the front arcade m'), domed=(False, 'small domes on the roofs (LOD0)'), shape=('pointed', 'pointed|arch'),
      colour=(None, 'wall'), trim=(None, 'trim'), cap_colour=(None, 'dome colour'), bay=(3.6, 'target bay width m'))
def _cloister(tb, lk, rng, P):
    D = mkD(lk, P, rng, pointed=P['shape'] == 'pointed')
    W, Dp = P['width'], P['depth']
    M().cloister(tb, lk, D, -W / 2, 0.0, W / 2, Dp, P['thickness'], P['height'], 0.0, P['gate_width'], sides=('front', 'left', 'right'), domed=bool(P['domed']), nbay=P['bay'])


@part('court-floor', 'Paved court floor with a darker border and an optional octagonal pool (with a domed kiosk).',
      width=(30.0, 'm'), depth=(30.0, 'm'), colour=(None, 'paving colour'), pool=(True, 'octagonal ablution pool in the middle'), kiosk=(False, 'domed kiosk over the pool (Ottoman sadirvan)'),
      cap_colour=(None, 'kiosk dome colour'))
def _court_floor(tb, lk, rng, P):
    D = mkD(lk, P, rng, type='ottoman' if P['kiosk'] else 'gulf')
    if P['colour']:
        lk.stone_col = P['colour']
    W, Dp = P['width'], P['depth']
    M().court_floor(tb, lk, D, -W / 2, -Dp / 2, W / 2, Dp / 2, bool(P['pool']))


@part('fountain', 'Octagonal ablution fountain, optionally under a domed kiosk on eight posts.',
      radius=(2.0, 'basin radius m'), kiosk=(False, 'domed kiosk'), kiosk_height=(4.5, 'm'), colour=(None, 'stone colour'), cap_colour=(None, 'kiosk dome colour'))
def _fountain(tb, lk, rng, P):
    D = mkD(lk, P, rng, colour='colour')
    r = P['radius']
    if tb.detail >= 2:
        pts = U.poly_ring(0, 0, r, 8, 0)
        lib.prism(tb, [(p[0], p[1]) for p in pts], 0, 0.7, 'plain-render', D['wall'], top=True)
        return
    pts = U.poly_ring(0, 0, r, 8, 0.0)
    lib.prism(tb, [(p[0], p[1]) for p in pts], 0, 0.7, 'plain-render', D['wall'], top=False)
    tb.face(U.poly_ring(0, 0, r * 0.82, 8, 0.58), 'plain', '#6fa3b8')
    if P['kiosk']:
        kh = P['kiosk_height']
        for k in range(8):
            a = TAU * k / 8
            lib.cylinder(tb, 0.9 * r * math.cos(a), 0.9 * r * math.sin(a), 0.7, kh, 0.14, n=5, slot='plain-render', col=D['trim'], top=False)
        lib.cylinder(tb, 0, 0, kh, kh + 0.3, r * 1.1, n=8, slot='plain-render', col=D['trim'], top=True)
        U.dome(tb, 0, 0, kh + 0.3, r * 1.1, r * 0.9, 'hemi', D['slot'], D['dcol'], n=10, rings=3)
    else:
        lib.cylinder(tb, 0, 0, 0.7, 1.5, 0.2, n=6, slot='plain-render', col=D['trim'], r_top=0.1)


@part('colonnade', 'A row of columns carrying a beam, along +x.',
      length=(12.0, 'm'), count=(None, 'columns (default one per 3 m)'), height=(4.0, 'm to the top of the beam'), radius=(0.3, 'column radius m'),
      kind=('round', 'round|square'), beam=(0.6, 'beam depth m'), colour=(None, 'column and beam colour (trim colour)'))
def _colonnade(tb, lk, rng, P):
    D = mkD(lk, P, rng, colour='colour')
    n = P['count'] or max(2, int(P['length'] / 3.0) + 1)
    lib.colonnade(tb, (-P['length'] / 2, 0.0), (P['length'] / 2, 0.0), 0.0, P['height'], n, lk, r=P['radius'], kind=P['kind'], beam_h=P['beam'],
                  col=P['colour'] or lk.trim_col, slot=lk.wall_slot)


@part('chhatri', 'Open kiosk: four posts, a slab and a dome (Mughal chhatri / Sikh kiosk).',
      radius=(1.5, 'half width m'), height=(4.0, 'overall height m'), profile=('onion', 'dome profile: onion|hemi|ogee'), colour=(None, 'posts'),
      cap_colour=(None, 'dome colour'), material=(None, 'metal|tile|concrete'))
def _chhatri(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    M().chhatri(tb, lk, D, 0.0, 0.0, 0.0, P['radius'], P['height'], P['profile'])


@part('crenellated-wall', 'A wall run with merlons along its top, along +x (front face towards -Y).',
      length=(20.0, 'm'), height=(4.0, 'wall height m'), thickness=(0.8, 'm'), merlon_height=(0.7, 'm'), merlon_width=(0.5, 'm'), pitch=(1.1, 'merlon spacing m'),
      colour=(None, 'wall colour'), trim=(None, 'merlon colour'))
def _cren_wall(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    L, h, t = P['length'], P['height'], P['thickness']
    M().bx(tb, -L / 2, 0, 0, L / 2, t, h, D['wslot'], D['wall'], top_slot='roof-flat', top_col=D['trim'], skip=('bottom',))
    if tb.detail == 0:
        n = max(1, int(L / P['pitch']))
        for k in range(n):
            x = -L / 2 + (k + 0.5) * L / n
            lib.box_c(tb, x, t / 2, h, P['merlon_width'], t * 0.9, P['merlon_height'], 'plain-render', D['trim'], skip=('bottom',))


@part('pinnacle', 'A pointed finial cone: horn-like zankwaye (Hausa), plain cone, or an ostrich-egg on a neck (Djenne).',
      radius=(0.4, 'base radius m'), height=(1.4, 'm'), style=('zankwaye', 'zankwaye|cone|egg'), colour=(None, 'wall colour'), material=(None, 'wall slot override (e.g. mud)'))
def _pinnacle(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    if P['style'] == 'egg':
        S().egg(tb, D, 0.0, 0.0, 0.0, P['radius'], D['wall'])
    elif P['style'] == 'cone':
        U.cone(tb, 0.0, 0.0, 0.0, P['height'], P['radius'], 6, D['wslot'], D['wall'], smooth=False)
    else:
        S().zankwaye(tb, D, 0.0, 0.0, 0.0, P['radius'], P['height'], D['wall'])


@part('finial', 'A spike with stacked balls (mosque finial / alem).',
      height=(2.0, 'm'), balls=(3, 'number of balls'), radius=(0.25, 'ball radius m'), colour=(GOLD, 'colour'))
def _finial(tb, lk, rng, P):
    U.finial(tb, 0.0, 0.0, 0.0, P['height'], P['colour'], balls=int(P['balls']), r=P['radius'])


@part('toron-row', 'A row of projecting palm-wood toron beams along +x on a wall whose face looks towards -Y (LOD0 only).',
      length=(12.0, 'm'), spacing=(1.2, 'beam spacing m'), rows=(2, 'number of rows'), row_gap=(1.2, 'vertical gap between rows m'), beam_length=(0.55, 'projection m'),
      beam_size=(0.16, 'beam section m'), colour=('#6a4f38', 'wood colour'))
def _toron(tb, lk, rng, P):
    D = mkD(lk, P, rng, wood=P['colour'])
    n = max(1, int(P['length'] / P['spacing']))
    for q in range(int(P['rows'])):
        S().toron_row(tb, D, -P['length'] / 2 + P['length'] / (2 * n), 0.0, P['length'] / 2 - P['length'] / (2 * n), 0.0, q * P['row_gap'], n, length=P['beam_length'],
                      size=P['beam_size'], face='front')


@part('buttress-row', 'Engaged tapering ribs/buttresses along +x on a wall facing -Y, each capped by a pinnacle.',
      length=(20.0, 'm'), spacing=(3.6, 'm'), height=(8.0, 'm'), width=(1.1, 'base width m'), proud=(0.8, 'projection m'), crown=(True, 'pinnacle on each'),
      colour=(None, 'colour'))
def _buttress_row(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    L = P['length']
    seg = lib.Seg((-L / 2, 0.0), (L / 2, 0.0))
    n = max(1, int(round(L / P['spacing'])))
    for k in range(n + 1):
        S().rib(tb, D, seg, L * k / n, 0.0, P['height'], P['width'], P['proud'], crown=bool(P['crown']))


@part('mud-tower', 'Tapering square mud tower in stages with ledges, toron beams and a crown (Hausa minaret, Djenne tower, Sahelian buttress tower).',
      height=(14.0, 'm'), base_width=(4.0, 'm'), taper=(0.5, 'top width / base width'), stages=(3, 'number of stages'), top=('pinnacles', 'pinnacles|egg|flat'),
      toron=(True, 'toron beams'), toron_rows=(3, 'rows per stage'), windows=(True, 'a small window per stage'), colour=(None, 'mud/plaster colour'),
      wood=('#6a4f38', 'toron colour'))
def _mud_tower(tb, lk, rng, P):
    D = mkD(lk, P, rng, wood=P['wood'])
    S().tower(tb, lk, D, 0.0, 0.0, 0.0, P['base_width'], P['height'], taper=P['taper'], stages=int(P['stages']), top=P['top'], toron=bool(P['toron']),
              toron_rows=int(P['toron_rows']), win=bool(P['windows']))


@part('gatehouse', 'A low gate house (zaure) with a round-arched passage and corner pinnacles.',
      width=(6.0, 'm'), height=(4.5, 'm'), depth=(2.6, 'm'), colour=(None, 'wall'))
def _gatehouse(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    S().gatehouse(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'], P['depth'])


@part('roof-vents', 'A grid of tapering ceramic roof vents (Djenne roof).',
      width=(20.0, 'm'), depth=(20.0, 'm'), spacing=(7.0, 'm'), colour=('#8a5a40', 'clay colour'))
def _vents(tb, lk, rng, P):
    nx, ny = max(1, int(P['width'] / P['spacing'])), max(1, int(P['depth'] / P['spacing']))
    if tb.detail >= 2:
        return
    for i in range(nx):
        for j in range(ny):
            if tb.detail == 1 and (i + j) % 2:
                continue
            x = -P['width'] / 2 + P['width'] * (i + 0.5) / nx
            y = P['depth'] * (j + 0.5) / ny
            U.revolve(tb, x, y, 0.0, [(0.55, 0), (0.4, 0.9), (0.62, 1.1), (0.0, 1.55)], 5 if tb.detail else 6, 'plain-render', P['colour'], smooth=False, cap=False)


# ================================================================================================================ temple parts
@part('curved-roof', 'Chinese / Japanese / Korean hip roof with concave slopes and eaves swept up at the corners, fascia and ridge ornament.',
      width=(10.0, 'wall-top width m (x)'), depth=(8.0, 'wall-top depth m (y)'), rise=(3.0, 'ridge height above the eave m'), overhang=(1.8, 'eave overhang m'),
      upturn=(0.8, 'corner lift m'), colour=(None, 'roof colour'), trim=(None, 'fascia colour'), material=(None, 'tile|metal|slate'), ridge=(True, 'ridge beam and end ornaments'))
def _curved_roof(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='colour')
    slot = _roof_slot(P, D['dcol'], P['material']) if P['material'] else 'clay-tile'
    U.curved_hip(tb, D, 0.0, 0.0, 0.0, P['width'], P['depth'], P['rise'], P['overhang'], P['upturn'], slot, D['dcol'], D['trim'], ridge=bool(P['ridge']))


@part('pagoda-tower', 'A tiered pagoda: base platform, 3-9 storeys of body and swept eaves (square, hexagonal or octagonal), finial mast.',
      storeys=(5, '3-9'), base_width=(10.0, 'm'), height=(30.0, 'total height m'), sides=(4, '4|6|8'), brick=(False, 'brick body with small eaves (Chinese brick pagoda)'),
      colour=(None, 'wall'), accent=(None, 'columns / eave trim'), cap_colour=(None, 'roof colour'), japan=(False, 'Japanese: flatter eaves'),
      newar=(False, 'Newar: allow 2 tiers'))
def _pagoda(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour', japan=bool(P['japan']), txt={6: 'hexagon', 8: 'octagon'}.get(int(P['sides']), ''),
            tiers=int(P['storeys']), F={'storeys': int(P['storeys']), 'roof': 'hip', 'fp': 'rect', 'variant': '', 'w': P['base_width'], 'd': P['base_width'], 'h': P['height']})
    D['rslot'] = 'clay-tile' if not P['japan'] else 'slate'
    if P['brick']:
        lk.wall_material = 'brick'
    else:
        lk.wall_material = 'whitewash'
    w = P['base_width'] * 2.0
    _dims(D, w, w, P['height'])
    T().build_pagoda(tb, lk, D, rng)


@part('platform', 'Stepped stone platform (stylobate) with a paved top.',
      width=(20.0, 'm (x)'), depth=(14.0, 'm (y)'), height=(1.2, 'total height m'), tiers=(2, 'steps'), colour=('#bdb6a8', 'stone colour'))
def _platform(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    T()._platform_at(tb, D, 0.0, 0.0, P['width'], P['depth'], P['height'], P['colour'], tiers=int(P['tiers']))


@part('stair', 'A flight of steps rising towards +Y with optional balustrades, front at -Y.',
      width=(3.0, 'm'), height=(1.2, 'rise m'), run=(2.4, 'total run m'), colour=('#bdb6a8', 'stone'), rails=(True, 'side balustrades (LOD0)'))
def _stair(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    n = max(3, int(P['height'] / 0.22)) if tb.detail == 0 else 3
    lib.steps(tb, -P['width'] / 2, P['width'] / 2, 0.0, P['height'], P['run'], min(n, 12), 'paving', P['colour'])
    if P['rails'] and tb.detail == 0 and P['height'] > 0.5:
        for sx in (-1, 1):
            U.railing(tb, (sx * (P['width'] / 2 + 0.1), 0.0), (sx * (P['width'] / 2 + 0.1), -P['run']), P['height'], 0.7, P['colour'])


@part('stupa', 'A Buddhist stupa. dome: hemispherical Sanchi/Sri Lankan stupa with harmika, umbrellas, railing and four toranas; bell: gilded Burmese/Thai zedi on '
      'three terraces with a ringed spire; chorten: Tibetan white vase stupa with a gilded ring stack.',
      style=('dome', 'dome|bell|chorten'), radius=(12.0, 'half the terrace width m'), height=(20.0, 'm'), colour=(None, 'body colour'), gold=(None, 'gilding colour (bell/chorten)'),
      railing=(True, 'railing and gates for the dome style'))
def _stupa(tb, lk, rng, P):
    gold = P['gold'] or GOLD
    D = mkD(lk, P, rng, cap='gold', st='southeast-asian' if P['style'] == 'bell' else 'south-asian', chorten=P['style'] == 'chorten', roofc=gold)
    D['dcol'] = gold
    lk.roof_col = gold
    w = P['radius'] * 2 / 0.7
    _dims(D, w, w, P['height'])
    D['fence'] = False
    D['txt'] = 'zedi' if P['style'] == 'bell' else ''
    D['nstupa'] = 0
    if P['style'] == 'chorten':
        T().build_chorten(tb, lk, D, rng)
    else:
        T().build_stupa(tb, lk, D, rng)


@part('shikhara', 'North Indian curvilinear tower (nagara shikhara) with projecting ribs, amalaka and a gold kalasha, on a square sanctum base.',
      width=(8.0, 'base width m'), height=(18.0, 'tower height above the base m'), base_height=(3.5, 'sanctum wall height m'), layers=(22, 'courses (LOD0)'),
      colour=(None, 'stone colour'), amalaka=(True, 'amalaka disc and kalasha'))
def _shikhara(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    col, ws = D['wall'], D['wslot']
    sw, bh, th = P['width'], P['base_height'], P['height']
    lib.box_c(tb, 0.0, 0.0, 0.0, sw, sw, bh, ws, col, skip=('bottom', 'top'), scale=1.0 if tb.detail == 0 else 5.0)
    a0 = sw / 2
    N = {0: int(P['layers']), 1: 10, 2: 4}[tb.detail]
    rings = []
    for i in range(N + 1):
        t = i / N
        a = a0 * (1 - 0.72 * (t ** 1.7))
        if tb.detail == 0 and i % 2 == 1:
            a *= 0.955
        if tb.detail == 2:
            rings.append(U.rect_ring(0.0, 0.0, 2 * a * 1.06, 2 * a * 1.06, bh + th * t))
        else:
            rings.append(U.nagara_ring(0.0, 0.0, a, bh + th * t, p=0.16 - 0.06 * t, wc=0.3))
    U.ring_loft(tb, rings, ws, col, scale=3.0 if tb.detail else 1.4)
    tb.facing(rings[-1], (0, 0, 1), ws, col)
    if P['amalaka']:
        ztop = bh + th
        ar = a0 * 0.32
        U.revolve(tb, 0.0, 0.0, ztop, [(ar * 0.9, 0), (ar * 1.0, ar * 0.2), (ar * 1.12, ar * 0.42), (ar * 0.95, ar * 0.62), (ar * 0.55, ar * 0.72)], 16 if tb.detail == 0 else 8,
                  'plain-render', shade(col, 0.95), smooth=True, cap=True, flute=(16, 0.06) if tb.detail == 0 else None)
        U.revolve(tb, 0.0, 0.0, ztop + ar * 0.7, [(ar * 0.3, 0), (ar * 0.5, ar * 0.25), (ar * 0.44, ar * 0.6), (ar * 0.2, ar * 0.85), (ar * 0.14, ar * 1.05), (0.02, ar * 1.7)],
                  8 if tb.detail < 2 else 5, 'metal-roof', GOLD, smooth=True, cap=False)


@part('mandapa-roof', 'Stepped pyramidal (pidha) roof of a Hindu porch / assembly hall: stacked tiers with sloped bands and risers.',
      width=(10.0, 'm (x)'), depth=(8.0, 'm (y)'), tiers=(4, 'number of tiers'), tier_height=(1.1, 'm'), colour=(None, 'stone colour'), finial=(True, 'gold finial'))
def _mandapa(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    col = D['wall']
    zz = 0.0
    wk, dk = P['width'], P['depth']
    th = P['tier_height']
    for k in range(int(P['tiers'])):
        outer = U.rect_ring(0.0, 0.0, wk + 1.0, dk + 1.0, zz)
        inner = U.rect_ring(0.0, 0.0, wk, dk, zz + th * 0.55)
        up = U.rect_ring(0.0, 0.0, wk * 0.84, dk * 0.84, zz + th)
        U.ring_loft(tb, [outer, inner, up], 'plain-render', shade(col, 0.92) if k % 2 == 0 else shade(col, 1.04), scale=3.0)
        zz += th
        wk, dk = wk * 0.84, dk * 0.84
    tb.facing(U.rect_ring(0.0, 0.0, wk, dk, zz), (0, 0, 1), 'plain-render', col)
    if P['finial'] and tb.detail < 2:
        U.revolve(tb, 0.0, 0.0, zz, [(0.5, 0), (0.55, 0.3), (0.3, 0.7), (0.05, 1.2)], 8, 'metal-roof', GOLD, smooth=True, cap=False)


@part('gopuram', 'South Indian gateway tower: a gate block with a passage, 5-9 diminishing tiers with cornices and figure niches, a barrel-vault crown with kalasa.',
      width=(24.0, 'base width m'), depth=(14.0, 'base depth m'), height=(40.0, 'total height m'), tiers=(7, 'number of tiers'), base_height=(7.0, 'gate block height m'),
      colour=(None, 'wall colour'), accent=(None, 'alternate tier / niche colour'), niches=(True, 'rows of niche figures (LOD0)'))
def _gopuram(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    col, acc, ws = D['wall'], D['accent'], D['wslot']
    gw, gd, H = P['width'], P['depth'], P['height']
    base_h = P['base_height']
    ntiers = int(P['tiers'])
    M().bx(tb, -gw / 2, -gd / 2, 0, gw / 2, gd / 2, base_h, ws, shade(col, 0.96), skip=('bottom', 'top'))
    if tb.detail < 2:
        seg = lib.Seg((-gw / 2, -gd / 2), (gw / 2, -gd / 2))
        U.arch_openings(tb, seg, lk, 0, base_h, 1, 'rect', ow=min(gw * 0.26, 5.0), oh=base_h * 0.78, depth=1.2, col=shade(col, 0.96), slot=ws, sill=0.0, crown_gap=0.4)
        if tb.detail == 0:
            M().bx(tb, -gw / 2 - 0.3, -gd / 2 - 0.3, base_h - 0.5, gw / 2 + 0.3, gd / 2 + 0.3, base_h, 'plain-render', shade(acc, 0.9), skip=('bottom',))
    z = base_h
    th = (H - base_h) / (ntiers + 0.9)
    palette = [col, acc, shade(col, 0.92), shade(acc, 1.1)]
    wk, dk = gw, gd
    for k in range(ntiers):
        f0, f1 = 1 - 0.56 * (k / ntiers), 1 - 0.56 * ((k + 1) / ntiers)
        w0_, d0_ = gw * f0 * 0.94, gd * (1 - 0.72 * k / ntiers) * 0.94
        w1_, d1_ = gw * f1 * 0.94, gd * (1 - 0.72 * (k + 1) / ntiers) * 0.94
        c = palette[k % 4]
        U.frustum(tb, 0.0, 0.0, z, z + th, w0_, d0_, w1_ * 1.02, d1_ * 1.02, ws, c, top=False, scale=1.0 if tb.detail == 0 else 5.0)
        if tb.detail == 0:
            lib.box_c(tb, 0.0, 0.0, z + th - 0.22, w1_ * 1.06 + 0.5, d1_ * 1.06 + 0.5, 0.3, 'plain-render', shade(palette[(k + 1) % 4], 0.9), skip=('bottom',))
            if P['niches']:
                n = max(3, int(w0_ / 1.5))
                yf = -(d0_ + d1_) / 4
                for q in range(n):
                    x = -w0_ / 2 * 0.86 + w0_ * 0.86 * (q + 0.5) / n
                    lib.box(tb, x - 0.28, yf - 0.28, z + th * 0.2, x + 0.28, yf + 0.02, z + th * 0.75, 'plain-render', palette[(k + 2 + q) % 4], skip=('bottom', 'back'))
        z += th
        wk, dk = w1_, d1_
    ch = th * 0.9
    n = {0: 10, 1: 6, 2: 4}[tb.detail]
    prof = [(dk / 2 * math.cos(math.pi * k / n), ch * math.sin(math.pi * k / n)) for k in range(n + 1)]
    grid = [[(x, py, z + pz) for (py, pz) in prof] for x in (-wk / 2, wk / 2)]
    tb.shared_grid(grid, 'plain-render', acc, smooth=True)
    if tb.detail < 2:
        for sx_, hint in ((-wk / 2, (-1, 0, 0)), (wk / 2, (1, 0, 0))):
            tb.facing([(sx_, py, z + pz) for (py, pz) in prof], hint, ws, col)
        kn = max(3, int(wk / 1.8)) if tb.detail == 0 else 3
        for q in range(kn):
            x = -wk / 2 + wk * (q + 0.5) / kn
            U.revolve(tb, x, 0.0, z + ch - 0.05, [(0.25, 0), (0.4, 0.35), (0.3, 0.8), (0.08, 1.2), (0.0, 1.6)], 6, 'metal-roof', GOLD, smooth=True, cap=False)


@part('thai-roof', 'Steep tiered gable roof (ridge along Y, gable ends front and back) with coloured edge bands, patterned gable ends and chofa horns: '
      '2-3 overlapping tiers of a Thai/Lao ubosot.',
      width=(9.0, 'lower eave width m (x)'), length=(18.0, 'lower eave length m (y)'), tiers=(3, '2-3'), pitch=(0.95, 'rise / half-width'), tier_step=(0.42, 'vertical step per tier / rise'),
      colour=(None, 'tile colour (look roof colour)'), edge_colour=(None, 'edge / alternate tier colour (accent)'), wall_colour=(None, 'inner gable panel'))
def _thai_roof(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='colour')
    D['rslot'] = 'clay-tile'
    roofs = [D['dcol'], D['accent']]
    z = 0.0
    for k in range(int(P['tiers'])):
        wk = P['width'] * (1.0 - 0.17 * k)
        lk_ = P['length'] * (1.0 - 0.13 * k)
        rise = wk / 2 * P['pitch']
        T()._thai_gable(tb, D, 0.0, 0.0, z, wk, lk_, rise, roofs[k % 2], roofs[1 - (k % 2)], P['wall_colour'] or D['wall'])
        z += rise * P['tier_step']


@part('chedi', 'Gilded bell-shaped chedi/zedi on a two-step square base with ringed spire.',
      radius=(3.0, 'bell base radius m (the square base is about 2.4x)'), height=(18.0, 'm'), colour=(GOLD, 'gilding'))
def _chedi(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    T()._chedi(tb, D, 0.0, 0.0, P['radius'] / 1.5, P['height'], P['colour'])


@part('torii', 'Shinto torii gate (two posts, nuki and a black kasagi), facing -Y.',
      width=(5.4, 'm'), height=(4.6, 'm'), colour=('#b5342a', 'vermilion'))
def _torii(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    T()._torii(tb, D, 0.0, 0.0, P['width'], P['height'], P['colour'])


@part('pailou', 'Three-bay Chinese gate (paifang): posts, lintels, small curved roofs.',
      width=(7.0, 'm'), height=(5.0, 'm'), colour=(None, 'post colour (accent)'), cap_colour=(None, 'roof colour'))
def _pailou(tb, lk, rng, P):
    D = mkD(lk, P, rng, colour='colour', cap='cap_colour')
    col = P['colour'] or lk.accent_col
    T()._gate_hall(tb, D, 0.0, 0.0, P['width'], P['height'], {'col': col}, 'clay-tile', D['dcol'], False)


@part('stone-lantern', 'Japanese stone lantern (tourou).', scale=(1.0, 'size factor (1 = 1.75 m)'))
def _lantern(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    T().lantern_stone(tb, D, 0.0, 0.0, P['scale'])


@part('meru', 'Balinese meru: stone base and stacked tapering square thatched roofs on posts.',
      tiers=(5, 'number of roofs (odd 1-11)'), base_width=(5.0, 'm'), tier_height=(3.0, 'm per tier'), colour=('#3a2f26', 'thatch'), wall_colour=(None, 'post blocks'))
def _meru(tb, lk, rng, P):
    D = mkD(lk, P, rng, colour='wall_colour')
    T()._meru(tb, D, 0.0, 0.0, int(P['tiers']), P['base_width'], P['tier_height'], P['colour'], D['wall'])


@part('lotus', 'Lotus-flower temple: three tiers of free-standing petal shells on a round podium with nine pools (default nine petals per tier).',
      radius=(30.0, 'podium radius m'), height=(34.0, 'm'), colour=(None, 'petal colour (white marble)'))
def _lotus(tb, lk, rng, P):
    D = mkD(lk, P, rng, txt='')
    w = 2 * P['radius'] / 0.92 / 1.05
    _dims(D, w, w, P['height'])
    T().build_lotus(tb, lk, D, rng)


@part('yurt', 'Mongolian ger-shaped temple: round white wall, conical red roof with a lantern and finial, one door.',
      radius=(8.0, 'm'), height=(11.0, 'm'), colour=(None, 'wall'), cap_colour=(None, 'roof'), accent=(None, 'door and band'))
def _yurt(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour')
    D['rslot'] = 'clay-tile'
    _dims(D, 2 * P['radius'] / 0.9, 2 * P['radius'] / 0.9, P['height'])
    T().build_yurt(tb, lk, D, rng)


@part('finial-mast', 'Pagoda sorin: pole with stacked discs, water-flame and a point.',
      height=(6.0, 'm'), colour=(GOLD, 'colour'), rings=(9, 'number of discs'))
def _mast(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    T().finial_mast(tb, D, 0.0, 0.0, 0.0, P['height'], P['colour'], rings=int(P['rings']))


# ================================================================================================================ chapel / shrine parts
@part('bell-tower', 'Square tower with a belfry stage (arched openings on all sides), cornice and a cap with a cross: pyramid, hip, spire, onion or flat (crenellated).',
      width=(4.0, 'm'), height=(14.0, 'shaft height m'), cap=('pyramid', 'pyramid|hip|spire|onion|flat'), cap_height=(None, 'cap height m (default by cap)'),
      belfry=(True, 'dark belfry openings (LOD0)'), colour=(None, 'wall'), cap_colour=(None, 'roof'), material=(None, 'tile|metal|slate'))
def _bell_tower(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour')
    D['rslot'] = _roof_slot(P, D['dcol'], P['material']) if P['material'] else 'clay-tile'
    D['rcol'] = D['dcol']
    SH().sq_tower(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'], cap=P['cap'], cap_h=P['cap_height'], open_belfry=bool(P['belfry']))


@part('bellcote', 'A small bell gable: a wall with a round-arched opening, a pointed top and a cross, facing -Y.',
      width=(1.4, 'm'), height=(2.1, 'm'), colour=(None, 'wall'))
def _bellcote(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    SH().bellcote(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'])


@part('turret', 'A little square bell turret with a pyramidal cap.', width=(1.1, 'm'), height=(1.4, 'shaft m'), colour=(None, 'wall'), cap_colour=(None, 'cap'))
def _turret(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour')
    D['rslot'] = 'clay-tile'
    SH().turret(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'])


@part('cross', 'A small Latin cross (box section), standing on z = 0.', height=(1.5, 'm'), colour=('#c9a74a', 'colour'))
def _cross(tb, lk, rng, P):
    SH().cross(tb, mkD(lk, P, rng), 0.0, 0.0, 0.0, P['height'], P['colour'])


@part('apse', 'Half-round apse: a half cylinder wall and a half-cone roof behind the straight edge on the x axis (bulges towards +Y).',
      radius=(3.0, 'm'), height=(5.0, 'wall height m'), roof_rise=(2.5, 'm'), colour=(None, 'wall'), cap_colour=(None, 'roof'), material=(None, 'tile|metal|slate'))
def _apse(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour')
    slot = _roof_slot(P, D['dcol'], P['material']) if P['material'] else 'clay-tile'
    SH().apse(tb, lk, D, 0.0, 0.0, P['radius'], P['height'], P['roof_rise'], D['dcol'], slot)


@part('rose-window', 'A round window (rose / oculus) on a wall facing -Y.', radius=(1.0, 'm'), stained=(False, 'blue stained glass'))
def _rose(tb, lk, rng, P):
    D = mkD(lk, P, rng, stained=bool(P['stained']))
    SH().rose(tb, D, 0.0, 0.0, 0.0, P['radius'])


@part('church-door', 'A recessed dark door with a frame and (optionally) a round arch, on a wall facing -Y.',
      width=(1.6, 'm'), height=(3.0, 'm'), arch=(True, 'round arch'), colour=(None, 'wall'), trim=(None, 'frame'))
def _door(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    SH().door_front(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'], '#6b4a30', bool(P['arch']))


@part('arched-window', 'A window on a wall facing -Y (arched, pointed or rectangular) with a sill.',
      width=(1.2, 'm'), height=(2.2, 'm'), kind=('arch', 'arch|pointed|rect'), stained=(False, 'blue glass'), trim=(None, 'sill'))
def _awindow(tb, lk, rng, P):
    D = mkD(lk, P, rng, stained=bool(P['stained']))
    SH().front_window(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'], P['kind'])


@part('gable-roof', 'A gable roof (ridge along Y) with overhanging eaves and filled gable ends.',
      width=(8.0, 'wall width m (x)'), length=(14.0, 'wall length m (y)'), rise=(3.5, 'ridge height m'), overhang=(0.45, 'm'), colour=(None, 'roof colour'),
      wall_colour=(None, 'gable end colour'), material=(None, 'tile|metal|slate|thatch'), scale=(1.5, 'tile scale'))
def _gable(tb, lk, rng, P):
    D = mkD(lk, P, rng, colour='wall_colour', cap='colour')
    slot = _roof_slot(P, D['dcol'], P['material']) if P['material'] else 'clay-tile'
    w, l = P['width'], P['length']
    U.gable_y(tb, -w / 2, -l / 2, w / 2, l / 2, 0.0, P['rise'], slot, D['dcol'], D['wslot'], D['wall'], scale=P['scale'] if tb.detail == 0 else 5.0, ov=P['overhang'])


@part('drum-dome', 'A polygonal drum with slit windows carrying a dome or a conical cap and a cross (Orthodox / Armenian / Georgian church).',
      radius=(3.0, 'm'), drum_height=(2.6, 'm'), cap=('dome', 'dome|cone'), cap_height=(None, 'm (default radius * 0.95 dome, 1.3 cone)'), sides=(12, 'drum sides'),
      cross=(True, 'cross on top'), colour=(None, 'drum'), cap_colour=(None, 'cap'), material=(None, 'tile|metal|slate'))
def _drum_dome(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour')
    D['rslot'] = _roof_slot(P, D['dcol'], P['material']) if P['material'] else 'clay-tile'
    R, dh = P['radius'], P['drum_height']
    n = int(P['sides']) if tb.detail == 0 else max(8, int(P['sides']) // 2)
    ws, wc = D['wslot'], D['wall']
    lib.cylinder(tb, 0.0, 0.0, 0.0, dh, R, n=n, slot=ws, col=wc, top=False, smooth=False)
    if tb.detail == 0:
        for k in range(n // 2):
            a = TAU * (k + 0.5) / (n // 2)
            ca, sa = math.cos(a), math.sin(a)
            pts = [(R * 0.97 * ca - 0.13 * sa, R * 0.97 * sa + 0.13 * ca, dh * 0.22), (R * 0.97 * ca + 0.13 * sa, R * 0.97 * sa - 0.13 * ca, dh * 0.22),
                   (R * 0.97 * ca + 0.13 * sa, R * 0.97 * sa - 0.13 * ca, dh * 0.78), (R * 0.97 * ca - 0.13 * sa, R * 0.97 * sa + 0.13 * ca, dh * 0.78)]
            tb.face(pts, 'glass-punched', '#3a3f45')
    if P['cap'] == 'cone':
        ch = P['cap_height'] or R * 1.3
        lib.cylinder(tb, 0.0, 0.0, dh, dh + ch, R * 1.08, n=n, slot=D['rslot'], col=D['dcol'], r_top=0.06, top=False, smooth=False)
        top = dh + ch
    else:
        ch = P['cap_height'] or R * 0.95
        U.dome(tb, 0.0, 0.0, dh, R, ch, 'hemi', D['rslot'], D['dcol'], n=U.nn(tb, 16), rings=5 if tb.detail == 0 else 3)
        top = dh + ch
    if P['cross']:
        SH().cross(tb, D, 0.0, 0.0, top - 0.05, min(1.8, R * 0.6))


@part('spire', 'A tall pointed spire on a square or polygonal base (church steeple): a cone / pyramid with a finial cross.',
      base_width=(3.0, 'm'), height=(10.0, 'm'), sides=(8, '4|6|8'), colour=(None, 'roof / lead colour'), cross=(True, 'cross at the tip'), material=(None, 'tile|metal|slate'))
def _spire(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='colour')
    slot = _roof_slot(P, D['dcol'], P['material']) if P['material'] else 'slate'
    n = int(P['sides']) if tb.detail == 0 else 4
    lib.cylinder(tb, 0.0, 0.0, 0.0, P['height'], P['base_width'] * 0.5 + 0.15, n=n, slot=slot, col=D['dcol'], r_top=0.0, top=False, smooth=False)
    if P['cross'] and tb.detail < 2:
        SH().cross(tb, D, 0.0, 0.0, P['height'] - 0.05, 1.2)


@part('frontispiece', 'A raised screen wall above a front parapet / gable with a triangular, arched or stepped top and a recessed panel, facing -Y.',
      width=(8.0, 'm'), height=(3.0, 'm'), kind=('tri', 'tri|arch|stepped'), thickness=(0.5, 'm'), colour=(None, 'wall'), trim=(None, 'edge'))
def _fronti(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    M().frontispiece(tb, lk, D, 0.0, 0.0, 0.0, P['width'], P['height'], P['kind'], P['thickness'])


@part('statue-on-plinth', 'A standing figure on a stepped stone plinth (simple low-poly human figure).',
      height=(5.0, 'total height m'), plinth_height=(1.6, 'm'), colour=('#8a8780', 'stone'), figure_colour=('#d8d2c2', 'figure'))
def _statue(tb, lk, rng, P):
    hp = P['plinth_height']
    lib.box_c(tb, 0, 0, 0, 1.6, 1.6, hp * 0.4, 'stone-blocks', P['colour'], skip=('bottom',))
    lib.box_c(tb, 0, 0, hp * 0.4, 1.2, 1.2, hp * 0.6, 'stone-blocks', shade(P['colour'], 1.06), skip=('bottom',))
    if tb.detail >= 2:
        lib.cylinder(tb, 0, 0, hp, P['height'], 0.3, n=4, slot='plain', col=P['figure_colour'], r_top=0.15, top=False, smooth=False)
        return
    fh = P['height'] - hp
    lib.cylinder(tb, 0, 0, hp, hp + fh * 0.62, fh * 0.11, n=6, slot='plain', col=P['figure_colour'], r_top=fh * 0.08, top=False)
    lib.blob(tb, 0, 0, hp + fh * 0.72, fh * 0.09, fh * 0.09, fh * 0.12, P['figure_colour'], n=6, rings=3)
    lib.blob(tb, 0, 0, hp + fh * 0.93, fh * 0.07, fh * 0.07, fh * 0.07, P['figure_colour'], n=6, rings=3)


@part('grotto-rock', 'A Lourdes-type rock grotto: a mound of boulders with an arched dark niche and (optionally) a white statue, niche facing -Y.',
      width=(6.0, 'm'), depth=(4.0, 'm'), height=(4.0, 'm'), colour=('#8a867c', 'rock'), statue=(True, 'white figure in the niche'))
def _grotto(tb, lk, rng, P):
    W, Dp, H = P['width'], P['depth'], P['height']
    n = {0: 9, 1: 6, 2: 4}[tb.detail]
    for k in range(n):
        ang = math.pi * (0.1 + 0.8 * k / max(1, n - 1))
        cx = -W / 2 * 0.9 * math.cos(ang) * 0.9
        cy = W * 0.05 + (Dp * 0.25) * math.sin(ang)
        rr = (W * 0.3) * (0.7 + 0.5 * rng.random())
        lib.blob(tb, cx, cy + Dp * 0.18, H * 0.2, rr, rr * 0.9, H * (0.45 + 0.25 * rng.random()), shade(P['colour'], 0.9 + 0.2 * rng.random()), n=7 if tb.detail == 0 else 5,
                 rings=4 if tb.detail == 0 else 3, slot='stone-blocks')
    lib.blob(tb, 0.0, Dp * 0.3, H * 0.4, W * 0.45, Dp * 0.3, H * 0.6, P['colour'], n=8 if tb.detail == 0 else 5, rings=4 if tb.detail == 0 else 3, slot='stone-blocks')
    if tb.detail < 2:
        tb.face([(-W * 0.12, Dp * 0.05, 0.1), (W * 0.12, Dp * 0.05, 0.1), (W * 0.12, Dp * 0.05, H * 0.55), (0, Dp * 0.05, H * 0.72), (-W * 0.12, Dp * 0.05, H * 0.55)], 'glass-punched', '#3a3f45')
        if P['statue']:
            lib.cylinder(tb, 0.0, Dp * 0.09, 0.1, H * 0.46, 0.18, n=6, slot='plain', col='#f0ece4', r_top=0.12)
            lib.blob(tb, 0.0, Dp * 0.09, H * 0.5, 0.17, 0.17, 0.2, '#f0ece4', n=6, rings=3)


@part('ruin-wall', 'A broken rubble wall run along +x with random gaps and varying height (roofless ruin), front towards -Y.',
      length=(10.0, 'm'), height=(2.4, 'max height m'), thickness=(0.7, 'm'), colour=(None, 'wall'), gaps=(0.18, 'fraction of missing sections'))
def _ruin(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    L = P['length']
    n = max(2, int(L / 1.6))
    for k in range(n):
        if rng.random() < P['gaps']:
            continue
        h = P['height'] * (0.35 + 0.65 * rng.random())
        u0, u1 = L * k / n, L * (k + 1) / n
        lib.box(tb, -L / 2 + u0, 0, 0, -L / 2 + u1 + 0.02, P['thickness'], h, D['wslot'], shade(D['wall'], 0.9 + 0.2 * rng.random()), skip=('bottom',),
                scale=1.0 if tb.detail == 0 else 6.0)


@part('pointed-arch-window-row', 'A row of tall arched windows set into a wall facing -Y (a run of nave or hall windows), drawn on the wall plane.',
      length=(12.0, 'm'), count=(None, 'windows (default one per 3.4 m)'), width=(1.2, 'm'), height=(2.6, 'm'), kind=('pointed', 'arch|pointed|rect'), sill=(1.0, 'sill height m'),
      stained=(False, 'blue glass'))
def _window_row(tb, lk, rng, P):
    D = mkD(lk, P, rng, stained=bool(P['stained']))
    if tb.detail >= 2:
        return
    n = P['count'] or max(1, int(P['length'] / 3.4))
    for k in range(n):
        x = -P['length'] / 2 + P['length'] * (k + 0.5) / n
        SH().front_window(tb, lk, D, x, 0.0, P['sill'], P['width'], P['height'], P['kind'])


@part('portico', 'Classical portico on the -Y face of a wall at y = 0: steps, columns, entablature and a triangular pediment (it stands in front, towards -Y).',
      width=(8.0, 'm'), depth=(3.0, 'm'), height=(5.0, 'column height m'), columns=(4, 'number of columns'), pediment=(True, 'triangular pediment'),
      steps=(3, 'steps (0 = none)'), colour=(None, 'wall / column colour'), cap_colour=(None, 'pediment roof colour'))
def _portico(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    lk.roof_slot = D['rslot']
    lib.portico(tb, 0.0, 0.0, 0.0, P['width'], P['depth'], P['height'], lk, cols=int(P['columns']), pediment=bool(P['pediment']), steps_n=int(P['steps']),
                rise=P['width'] * 0.11)


@part('gate-arch', 'A gateway: a wall block with a single arched passage, a cornice and finials (gate of a compound, city gate, mosque gate), front towards -Y.',
      width=(7.0, 'm'), height=(5.5, 'm'), thickness=(2.4, 'm'), opening=(3.2, 'passage width m'), shape=('arch', 'arch|pointed|rect'), finials=(True, 'pinnacles on top'),
      colour=(None, 'wall'), trim=(None, 'cornice'))
def _gate_arch(tb, lk, rng, P):
    D = mkD(lk, P, rng)
    W, h, t = P['width'], P['height'], P['thickness']
    M().bx(tb, -W / 2, -t / 2, 0, W / 2, t / 2, h, D['wslot'], D['wall'], skip=('bottom', 'front'), top_slot='roof-flat', top_col=D['trim'])
    seg = lib.Seg((-W / 2, -t / 2), (W / 2, -t / 2))
    U.arch_openings(tb, seg, lk, 0, h, 1, P['shape'], ow=P['opening'], oh=h * 0.78, depth=t * 0.9, col=D['wall'], slot=D['wslot'], sill=0.0, crown_gap=0.4)
    if tb.detail == 0:
        M().bx(tb, -W / 2 - 0.2, -t / 2 - 0.2, h - 0.35, W / 2 + 0.2, t / 2 + 0.2, h, 'plain-render', D['trim'], skip=('bottom',))
        if P['finials']:
            for sx in (-1, 1):
                U.pinnacle(tb, sx * (W / 2 - 0.4), 0.0, h, 0.32, 1.1, D['trim'], n=6, slot='plain-render', base=0.3)


@part('pavilion', 'An open pavilion: stepped floor, posts and a roof (hip, gable or curved), for garden, shrine and kiosk use.',
      width=(6.0, 'm (x)'), depth=(5.0, 'm (y)'), height=(3.6, 'post height m'), roof=('hip', 'hip|gable|curved'), rise=(1.6, 'roof rise m'), posts=(4, 'posts (4 corners, or more along the long sides)'),
      colour=(None, 'post colour (accent)'), cap_colour=(None, 'roof colour'), floor_colour=('#a8a39a', 'floor'))
def _pavilion(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour')
    W, Dp, h = P['width'], P['depth'], P['height']
    col = P['colour'] or lk.accent_col
    lib.box_c(tb, 0.0, 0.0, 0.0, W + 0.5, Dp + 0.5, 0.35, 'stone-blocks', P['floor_colour'], skip=('bottom',), top_slot='paving', top_col=shade(P['floor_colour'], 1.08))
    if tb.detail < 2:
        n = max(2, int(P['posts']) // 2)
        for sx in range(n):
            x = -W / 2 + 0.3 + (W - 0.6) * sx / max(1, n - 1)
            for sy in (-1, 1):
                if tb.detail == 0:
                    lib.cylinder(tb, x, sy * (Dp / 2 - 0.3), 0.35, 0.35 + h, 0.16, n=6, slot='timber', col=col, top=False, smooth=False)
                else:
                    lib.box_c(tb, x, sy * (Dp / 2 - 0.3), 0.35, 0.3, 0.3, h, 'timber', col, skip=('bottom', 'top'))
    z = 0.35 + h
    rect = (-W / 2, -Dp / 2, W / 2, Dp / 2)
    if P['roof'] == 'curved':
        U.curved_hip(tb, D, 0.0, 0.0, z, W, Dp, P['rise'], 1.0, 0.5, 'clay-tile', D['dcol'], D['trim'])
    elif P['roof'] == 'gable':
        U.gable_y(tb, -W / 2, -Dp / 2, W / 2, Dp / 2, z, P['rise'], 'clay-tile', D['dcol'], D['wslot'], D['wall'], scale=1.5 if tb.detail == 0 else 5.0, ov=0.5)
    else:
        lk.roof_slot, lk.roof_col = 'clay-tile', D['dcol']
        lib.hip(tb, rect, z, P['rise'], lk, ov=0.5)


@part('veranda', 'A veranda / loggia: a row of posts carrying a sloping roof along +x, roof rising towards +Y (attach to a wall at y = depth).',
      length=(12.0, 'm'), depth=(2.4, 'm'), height=(3.0, 'eave height m'), rise=(0.8, 'm'), posts=(None, 'number of posts (default one per 2.4 m)'),
      colour=(None, 'post colour (trim)'), cap_colour=(None, 'roof colour'), material=(None, 'tile|metal|slate|thatch'))
def _veranda(tb, lk, rng, P):
    D = mkD(lk, P, rng, cap='cap_colour')
    L, d, h = P['length'], P['depth'], P['height']
    col = P['colour'] or lk.trim_col
    n = P['posts'] or max(2, int(L / 2.4) + 1)
    if tb.detail < 2:
        for k in range(n):
            x = -L / 2 + L * k / (n - 1)
            if tb.detail == 0:
                lib.cylinder(tb, x, 0.0, 0.0, h, 0.12, n=5, slot='timber', col=col, top=False)
            else:
                lib.box_c(tb, x, 0.0, 0.0, 0.25, 0.25, h, 'timber', col, skip=('bottom', 'top'))
    slot = _roof_slot(P, D['dcol'], P['material']) if P['material'] else 'metal-roof'
    lk.roof_slot, lk.roof_col = slot, D['dcol']
    lib.shed(tb, (-L / 2 - 0.3, -0.3, L / 2 + 0.3, d), h, P['rise'], lk, high='back', ov=0.3, slot=slot, col=D['dcol'])


@part('awning', 'A sloping shop/shrine awning: a canopy sheet with a front valance, high edge at +Y (against the wall), supported by two arms.',
      width=(4.0, 'm'), depth=(1.8, 'm'), height=(2.6, 'm lower edge'), rise=(0.5, 'm'), colour=('#b6323a', 'canopy colour'))
def _awning(tb, lk, rng, P):
    W, d, h, r_ = P['width'], P['depth'], P['height'], P['rise']
    pts = [(-W / 2, -d, h), (W / 2, -d, h), (W / 2, 0.0, h + r_), (-W / 2, 0.0, h + r_)]
    tb.facing(pts, (0, -r_ * 0.5, 1.0), 'plain', P['colour'])
    if tb.detail < 2:
        tb.facing([(-W / 2, -d, h - 0.25), (W / 2, -d, h - 0.25), (W / 2, -d, h), (-W / 2, -d, h)], (0, -1, 0), 'plain', shade(P['colour'], 0.85))
        for sx in (-1, 1):
            tb.facing([(sx * W / 2, -d, h - 0.25), (sx * W / 2, -d, h), (sx * W / 2, 0.0, h + r_)], (sx, 0, 0), 'plain', shade(P['colour'], 0.8))


# aliases requested by the part wish-list
for _alias, _target in (('west-tower', 'bell-tower'), ('pagoda-roof', 'curved-roof'), ('toron-beam-row', 'toron-row'), ('crenellation', 'crenellated-wall')):
    PARTS[_alias] = PARTS[_target]
    PART_DOC[_alias] = {'doc': 'Alias of ' + _target + '. ' + PART_DOC[_target]['doc'], 'params': PART_DOC[_target]['params']}


# ================================================================================================================ docstring
def _build_doc():
    lines = []
    for pid in sorted(PART_DOC):
        d = PART_DOC[pid]
        lines.append(f'  {pid}: {d["doc"]}')
        for k, (default, text) in d['params'].items():
            lines.append(f'      {k} = {default!r}  # {text}')
    return '\n'.join(lines)


__doc__ = (__doc__ or '') + _build_doc() + '\n'
