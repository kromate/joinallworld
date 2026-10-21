"""office-tower: multi-storey towers (> 8 storeys). Typologies chosen from the brief:

  slab     rectangular / L / T slab on an optional podium (glass curtain wall, ribbon windows or punched concrete)
  stepped  setback tiers (art-deco ziggurat, masonry wedding-cake) with terraces and a pinnacle crown
  round    cylindrical / oval tower with a tapering or bulging profile (lofted rings, glass skin)
  cluster  twin or multiple towers of different heights on a shared podium (optionally linked by a sky-bridge)

Crowns (cap, pod, spire, pyramid, dome, frame), masts, helipads, plant rooms, water tanks, pilotis, atrium lobbies, fins, balcony bands
and high-tech bracing come from the brief's features and wording. Layout: tower centred on x = 0, front (forecourt, road) at -Y.
Very tall buildings are shown whole up to the 138 m building-height limit (the height is clamped, never the plan).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _office_tower_util as U  # noqa: E402

FEATURES = {'podium', 'setback-tiers', 'crown', 'mast', 'helipad', 'atrium-glass', 'balcony-bands', 'brise-soleil', 'louvres', 'pilotis',
            'car-park', 'signage-board', 'flags', 'water-tank', 'floodlights', 'solar-panels', 'fence-wall', 'gate', 'awning',
            'flat-canopy', 'curved-canopy', 'spire', 'clock-tower', 'roof-terrace', 'steps', 'terrace', 'fountain', 'statue',
            'portico', 'colonnade', 'arcade', 'kiosk', 'neon-strip'}

H_LIMIT = 138.0


# ---------------------------------------------------------------------------------------------------------------------- planning
def plan(brief, style, lk, S):
    form = U.form_of(brief)
    feats = U.feat(brief)
    txt = U.text(brief)
    sty = U.style_of(brief)
    yr = U.year_of(brief)
    W = U.clamp(U.fnum(form.get('width_m'), 36), 14, 80)
    D = U.clamp(U.fnum(form.get('depth_m'), 28), 12, 60)
    H = U.clamp(U.fnum(form.get('height_m'), 60), 26, H_LIMIT)
    storeys = int(U.clamp(U.fnum(form.get('storeys'), round(H / 3.7)), 8, 70))
    fh = H / storeys
    if fh < 2.9 or fh > 4.8:
        storeys = max(8, int(round(H / 3.7)))
        fh = H / storeys
    fpk = form.get('footprint') or 'rect'
    var = str(form.get('variant') or '').lower()
    wings = int(U.fnum(form.get('wings'), 0))
    roof = form.get('roof') or 'flat'
    P = {'W': W, 'D': D, 'H': H, 'storeys': storeys, 'fh': fh, 'fpk': fpk, 'feats': feats, 'txt': txt, 'sty': sty, 'yr': yr, 'roof': roof}

    # typology
    if 'twin' in var or 'twin' in txt or 'two towers' in txt:
        typ, n = 'cluster', 2
    elif 'cluster' in var or wings >= 2 or 'four towers' in txt or 'three towers' in txt:
        typ, n = 'cluster', int(U.clamp(wings if wings >= 2 else 3, 2, 4))
    elif fpk in ('round', 'oval') or has(txt, 'cylindr', 'gherkin', 'round tower', 'drum'):
        typ, n = 'round', 1
    elif 'setback-tiers' in feats or sty in ('art-deco', 'baroque') or roof == 'stepped' or has(txt, 'stepped', 'ziggurat', 'setback', 'wedding'):
        typ, n = 'stepped', 1
    else:
        typ, n = 'slab', 1
    P['typ'], P['n'] = typ, n
    per = 2 * (W + D)
    if typ == 'stepped':
        est = storeys * per * 0.75
    elif typ == 'cluster':
        est = storeys * per * 0.9
    else:
        est = storeys * per
    P['est'] = est / 3.6
    ps = S.get('pat')
    P['pat'] = 'bands' if ps.random() < 0.5 else 'fins'
    P['tint'] = ps.choice(['accent', 'accent', 'green', 'bronze', 'blue'])

    # dress (architectural language) from style, materials and era
    mat = lk.wall_material
    if sty in ('art-deco',):
        dress = 'deco'
    elif sty in ('georgian', 'victorian', 'neoclassical', 'colonial', 'gothic-revival', 'baroque', 'tudor') or mat in ('stone', 'limestone', 'sandstone', 'marble', 'granite', 'brick', 'red-brick'):
        dress = 'masonry'
    elif sty == 'brutalist' or mat in ('exposed-concrete',) or (mat == 'concrete' and sty in ('modernist', 'soviet')):
        dress = 'brutal'
    elif sty == 'postmodern':
        dress = 'postmodern'
    elif sty == 'high-tech':
        dress = 'hightech'
    elif mat == 'glass-curtain' or lk.windows == 'curtain' or sty in ('contemporary',):
        dress = 'glass'
    else:
        dress = 'modern'
    P['dress'] = dress
    win = lk.windows
    if win in ('arched', 'pointed-arch'):
        win = 'punched'
    if win in ('louvre',):
        win = 'screen'
    if win in ('none', None):
        win = 'ribbon'
    if dress == 'masonry' and win in ('curtain', 'ribbon'):
        win = 'punched'
    if dress == 'brutal' and win == 'curtain':
        win = 'ribbon'
    P['kind'] = win

    # crown
    crown = None
    cf = feats.get('crown')
    cnote = str((cf or {}).get('note', '')).lower() + ' ' + txt
    if cf or 'spire' in feats:
        if has(cnote, 'pod'):
            crown = 'pod'
        elif 'spire' in feats or has(cnote, 'spire', 'pinnacle', 'needle') or dress == 'deco':
            crown = 'spire'
        elif has(cnote, 'pyramid') or dress in ('postmodern',):
            crown = 'pyramid'
        elif has(cnote, 'dome') or roof == 'dome':
            crown = 'dome'
        elif has(cnote, 'frame', 'lattice', 'open') or dress == 'hightech':
            crown = 'frame'
        elif dress == 'masonry':
            crown = 'pyramid'
        else:
            crown = 'cap'
    elif roof in ('pyramidal', 'hip', 'mansard'):
        crown = 'pyramid'
    elif roof == 'dome':
        crown = 'dome'
    elif dress == 'deco':
        crown = 'spire'
    P['crown'] = crown
    P['mast'] = 'mast' in feats or crown in ('spire',) or (crown == 'cap' and S.get('mast').random() < 0.4)
    P['mast_h'] = U.clamp(H * 0.1, 7, 16) if P['mast'] else 0.0
    crown_h = {'pod': 0.0, 'spire': 0.0, 'cap': 0.0, 'pyramid': 0.0, 'dome': 0.0, 'frame': 0.0, None: 0.0}[crown]
    P['helipad'] = 'helipad' in feats
    P['podium'] = 'podium' in feats or (typ in ('cluster',)) or (typ == 'slab' and storeys >= 14 and 'pilotis' not in feats and S.get('pod').random() < 0.6)
    P['pilotis'] = 'pilotis' in feats and typ in ('slab',) and not P['podium']
    # crowns sit on top of height_m: keep the whole building inside the limit
    wd = min(W, D)
    ext = {'spire': 22.0, 'pyramid': wd * 0.5 + 6, 'dome': wd * 0.36 + 12, 'frame': 15.0, 'cap': storeys and (fh * 2.0 + wd * 0.13 + 1.5), 'pod': wd * 0.5 + 5, None: 0.0}
    extra = P['mast_h'] + ext[crown] + (min(W, D) * 0.2 + 8 if typ == 'round' else 0.0) + (7.0 if not crown else 1.0)
    P['H'] = H = min(H, H_LIMIT - extra - 1.0)
    P['fh'] = H / storeys
    return P


def has(txt, *words):
    return any(w in txt for w in words)


# ---------------------------------------------------------------------------------------------------------------------- pieces
def glass_tint(lk, P):
    acc = lk.accent_col
    if P['kind'] in ('curtain', 'screen'):
        t = P.get('tint', 'accent')
        if t == 'green':
            return '#b9d1c3'
        if t == 'bronze':
            return '#d6c2a4'
        if t == 'blue':
            return '#b4c7dc'
        return lib.mix(acc, '#ffffff', 0.5) if lk.accent_col != lib.shade(lk.wall_col, 0.8) else lk.glass_col
    return lk.glass_col


def bracing(b, seg, z0, z1, floors, col, panel_floors=4):
    """Large X bracing (high-tech steel) drawn as thin proud strips across a wall."""
    if b.detail >= 1:
        return
    L = seg.length
    fh = (z1 - z0) / floors
    ph = panel_floors * fh
    npz = max(1, int(floors // panel_floors))
    nu = max(1, round(L / (ph * 0.9)))
    pw = L / nu
    w = 0.22
    for iz in range(npz):
        za, zb_ = z0 + iz * ph, z0 + (iz + 1) * ph
        for iu in range(nu):
            ua, ub_ = iu * pw, (iu + 1) * pw
            for (a, c) in (((ua, za), (ub_, zb_)), ((ub_, za), (ua, zb_))):
                pts = [seg.P(a[0] - w if a[0] < c[0] else a[0] + w, a[1], -0.2), seg.P(a[0] + w if a[0] < c[0] else a[0] - w, a[1], -0.2),
                       seg.P(c[0] + w if a[0] < c[0] else c[0] - w, c[1], -0.2), seg.P(c[0] - w if a[0] < c[0] else c[0] + w, c[1], -0.2)]
                b.facing(pts, (seg.n[0], seg.n[1], 0), 'plain', col, mode='fit')


def tower_walls(b, lk, P, fp, z0, z1, floors, front_kind=None, kind=None):
    kind = kind or P['kind']
    dress = P['dress']
    wc = lk.wall_col
    kw = dict(ratio=lk.ratio if lk.ratio > 0.2 else 0.45, ws=lk.wall_slot, wc=wc, gc=glass_tint(lk, P), group=2 if P['est'] < 900 else 3)
    if P['typ'] == 'round':
        kw['mult'] = 1.0
    feats = P['feats']
    if kind == 'punched':
        kw['bay'] = 3.2 if dress == 'masonry' else 3.8
        kw['deep'] = dress in ('brutal', 'masonry')
        kw['ratio'] = U.clamp(lk.ratio, 0.28, 0.55)
    if dress in ('deco',) and kind in ('punched', 'ribbon', 'curtain'):
        kw['fins'] = 3.4
        kw['fin_col'] = lk.trim_col
    elif kind == 'curtain':
        kw['fins'] = 6.0
        kw['fin_col'] = lib.mix(lk.trim_col, '#c9ced2', 0.6)
        if P.get('pat') == 'bands' and P['est'] < 1500:
            kw['fins'] = 0.0
            kw['bands'] = (0.55, lib.mix(lk.trim_col, '#d6d9db', 0.5), 0.3)
    if 'brise-soleil' in feats and kind in ('curtain', 'ribbon', 'screen'):
        kw['fins'] = kw.get('fins') or 2.6
    if 'balcony-bands' in feats or dress == 'brutal':
        kw['bands'] = (0.4, lk.trim_col if dress != 'brutal' else lib.shade(wc, 0.9), 0.8 if dress == 'brutal' else 0.6)
        if kind == 'ribbon' and dress == 'brutal':
            kw['deep'] = 0.9
    if kind == 'ribbon' and 'balcony-bands' in feats:
        kw['deep'] = 0.7
    kw['corner'] = 0.6 if kind == 'ribbon' else 0.5
    kw['mult'] = (1.0 if floors * sum(s.length for s in fp.edges()) < 5200 else 1.8) * (1.4 if b.detail == 1 else 1.0)
    if 'louvres' in feats and kind == 'curtain':
        kind = 'screen'
    for seg in fp.edges():
        k = front_kind if (seg.front and front_kind) else kind
        red = b.detail == 0 and (seg.rear or (P['est'] > 1100 and not seg.front) or P['est'] > 2000)
        U.skin(b, seg, z0, z1, floors, k, lk, reduced=red, **kw)
        if b.detail == 0 and not red and 'balcony-bands' in feats and k == 'punched' and seg.front and P['est'] < 1200:
            U.balcony_pods(b, seg, z0, floors, (z1 - z0) / floors, every=2, col=lk.trim_col, depth=1.0)
        if b.detail == 0 and floors >= 24 and not seg.rear:
            zb_ = z0 + (z1 - z0) * 0.55
            U.sbox(b, seg, 0, seg.length, zb_, zb_ + (z1 - z0) / floors * 1.6, 0.2, lib.shade(lk.metal_col, 0.62), skip_ends=True)
        if P['dress'] == 'hightech' and b.detail == 0 and not seg.rear and seg.length > 10:
            bracing(b, seg, z0, z1, floors, lib.shade(lk.metal_col, 0.8))


def top_of(b, lk, P, fp, z, floors, crowned=True, parapet=1.1):
    """Roof of a mass: parapet / cornice and a flat roof."""
    dress = P['dress']
    if dress in ('masonry', 'deco') and b.detail == 0:
        lib.cornice(b, fp, z - 0.55, 0.55, 0.55, lk, col=lk.trim_col)
    lib.flat_roof(b, fp, z, lk, parapet_h=parapet if b.detail < 2 else 0.6, ov=0.0, slab=0.0)


def roof_clutter(b, lk, P, fp, z, S, avoid=None):
    """Plant rooms, lift overrun, water tank, solar rows, helipad, mast on a flat roof."""
    x0, y0, x1, y1 = fp.bbox
    w, d = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rs = S.get('clutter')
    pb_w, pb_d = U.clamp(w * 0.34, 3, 14), U.clamp(d * 0.34, 3, 10)
    px, py = cx + rs.uniform(-0.12, 0.12) * w, cy + rs.uniform(-0.05, 0.2) * d
    pb_h = rs.uniform(3.2, 4.8)
    U.plant_box(b, lk, px, py, z, pb_w, pb_d, pb_h, lib.shade(lk.wall_col, 0.9), slot=lk.wall_slot if lk.wall_slot != 'metal-cladding' else 'plain-render')
    if b.detail == 0:
        # lift overrun and plant
        U.plant_box(b, lk, px + pb_w * 0.9, py - pb_d * 0.3, z, 3.4, 3.4, pb_h * 0.7, lk.metal_col)
        for k in range(3):
            U.plant_box(b, lk, cx - w * 0.3 + k * 2.6, cy - d * 0.28, z, 1.8, 1.4, 1.2 + 0.3 * k, lib.shade(lk.metal_col, 0.9 + 0.05 * k))
        if 'water-tank' in P['feats'] or rs.random() < 0.35:
            U.water_tank(b, cx - w * 0.28, cy + d * 0.25, z, 1.6, 2.4)
        if 'solar-panels' in P['feats']:
            for r in range(3):
                yy = cy - d * 0.32 + r * 2.2
                pts = [(cx + w * 0.08, yy - 0.8, z + 0.4), (cx + w * 0.4, yy - 0.8, z + 0.4), (cx + w * 0.4, yy + 0.8, z + 1.3), (cx + w * 0.08, yy + 0.8, z + 1.3)]
                b.facing(pts, (0, -0.5, 1), 'glass-ribbon', '#8fa3b5', mode='tile')


def crown_on(b, lk, P, fp, z, S):
    """Crown above a roof at height z over footprint fp (centred); returns the top height."""
    crown = P['crown']
    x0, y0, x1, y1 = fp.bbox
    w, d = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    dress = P['dress']
    ct = lk.trim_col
    if crown == 'pod':
        # restyled top shaped like a cocoa pod: ridged ellipsoid on a drum, with a stalk
        rx, ry, rz = w * 0.38, d * 0.38, min(w, d) * 0.5
        U.box_c(b, cx, cy, z, w * 0.82, d * 0.82, 2.2, 'plain-render', lk.trim_col, top_col=lk.trim_col, skip=('bottom',))
        z += 2.2
        n = 12 if b.detail == 0 else 8
        rings = 5 if b.detail == 0 else 3
        pod = lk.accent_col
        grid = []
        for k in range(n + 1):
            a = 2 * math.pi * k / n
            ridge = 1.0 + (0.07 if (k % 2 == 0) else -0.03)
            row = []
            for j in range(rings + 1):
                t = j / rings
                prof = math.sqrt(max(0.0, 1 - t * t))
                row.append((cx + rx * prof * ridge * math.cos(a), cy + ry * prof * ridge * math.sin(a), z + rz * t))
            grid.append(row)
        # simple dome profile: radius sqrt(1-t^2), height t*rz (monotone)
        b.shared_grid(grid, 'plain-render', pod, smooth=True, wrap=True, scale=2.0)
        top = z + rz
        if b.detail < 2:
            lib.cylinder(b, cx, cy, top - 0.1, top + 1.6, 0.25, n=6, slot='frame', col='#8d6a3a', r_top=0.12, top=True, smooth=False)
            top += 1.6
        return top
    if crown == 'spire':
        # art-deco pinnacle: stepped drums narrowing up to a needle
        zz = z
        sizes = [(0.62, 0.62, 4.5), (0.44, 0.44, 4.0), (0.28, 0.28, 3.2)]
        for sw, sd, sh in sizes:
            U.box_c(b, cx, cy, zz, w * sw, d * sd, sh, lk.wall_slot if b.detail < 2 else 'plain-render', lk.wall_col, top_slot='plain-render', top_col=lk.trim_col, skip=('bottom',))
            if b.detail == 0:
                U.box_c(b, cx, cy, zz + sh - 0.35, w * sw + 0.7, d * sd + 0.7, 0.35, 'plain-render', lk.trim_col, skip=())
            zz += sh
        lib.cylinder(b, cx, cy, zz, zz + 9.0, 0.5, n=6 if b.detail < 2 else 4, slot='frame', col=lk.metal_col, r_top=0.08, top=True, smooth=False)
        return zz + 9.0
    if crown == 'pyramid':
        rise = min(w, d) * (0.55 if dress == 'masonry' else 0.45)
        lib.roof(b, 'hip', fp, z, lk, rise=rise, ov=0.6)
        zt = z + rise
        if b.detail < 2:
            lib.cylinder(b, cx, cy, zt, zt + 4.5, 0.18, n=5, slot='frame', col=lk.metal_col, r_top=0.05, top=True)
            zt += 4.5
        return zt
    if crown == 'dome':
        r = min(w, d) * 0.4
        U.box_c(b, cx, cy, z, r * 2.3, r * 2.3, 1.2, 'plain-render', lk.trim_col, skip=('bottom',))
        lib.dome(b, cx, cy, z + 1.2, r, lk, height=r * 0.9, profile='hemi', slot=lk.roof_slot, col=lk.roof_col, drum=2.0, drum_slot='plain-render', drum_col=lk.trim_col, lantern=2.0, finial=3.0)
        return z + 1.2 + 2.0 + r * 0.9 + 2.0 + r * 0.2 + 3.0
    if crown == 'frame':
        # open steel crown: four posts, a top ring and a spire
        hh = 9.0
        px, py = w * 0.4, d * 0.4
        for sx in (-1, 1):
            for sy in (-1, 1):
                lib.cylinder(b, cx + sx * px, cy + sy * py, z, z + hh, 0.3, n=5, slot='frame', col=lk.metal_col, r_top=0.2, top=False, smooth=False)
        if b.detail < 2:
            for hz in (hh, hh * 0.5):
                for sx, sy, ex, ey in ((-1, -1, 1, -1), (1, -1, 1, 1), (1, 1, -1, 1), (-1, 1, -1, -1)):
                    lib.beam(b, (cx + sx * px, cy + sy * py), (cx + ex * px, cy + ey * py), z + hz - 0.2, z + hz + 0.1, 0.25, 'frame', lk.metal_col)
        U.box_c(b, cx, cy, z, w * 0.5, d * 0.5, 4.5, 'metal-cladding', lib.shade(lk.metal_col, 0.85), top_slot='roof-flat', skip=('bottom',))
        lib.cylinder(b, cx, cy, z + 4.5, z + hh + 4.0, 0.4, n=5, slot='frame', col=lk.metal_col, r_top=0.08, top=True, smooth=False)
        return z + hh + 4.0
    # 'cap': a recessed glazed lantern floor with a sloping roof (the contemporary crown)
    sw, sd = w * 0.72, d * 0.72
    hh = P['fh'] * 2.0
    cfp = lib.fp_rect(sw, sd, cx, cy)
    kind = 'curtain' if b.detail < 2 else 'none'
    for seg in cfp.edges():
        U.skin(b, seg, z, z + hh, 2, kind, lk, gc=glass_tint(lk, P), group=2, reduced=False)
    rise = min(sw, sd) * 0.18
    lib.roof_profile(b, (cx - sw / 2, cy - sd / 2, cx + sw / 2, cy + sd / 2), z + hh, [(-0.5, -0.15), (0.0, 0.0), (sw * 0.18, rise)], lk, roof_slot='metal-roof', roof_col=lk.trim_col)
    return z + hh + rise


def podium_mass(b, lk, P, x0, x1, y0, y1, floors, z1, S, front_x=(None, None)):
    """Low wide commercial podium with a glazed ground floor, upper floors in the tower's language, roof terrace and entrance canopy."""
    fp = lib.fp_rect(x1 - x0, y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2)
    gh = min(z1 * 0.5, P['fh'] * 1.5)
    for seg in fp.edges():
        red = seg.rear and b.detail == 0
        U.skin(b, seg, 0, gh, 1, 'curtain', lk, gc=lk.glass_col, group=1, reduced=red)
        up = 'ribbon' if P['dress'] not in ('masonry',) else 'punched'
        U.skin(b, seg, gh, z1, max(1, floors - 1), up, lk, ratio=0.5, ws=lk.wall_slot, wc=lib.mix(lk.wall_col, lk.trim_col, 0.4), gc=lk.glass_col, group=2, reduced=red,
               bay=3.6)
    if b.detail == 0:
        lib.sweep(b, fp, gh - 0.05, [(0.0, 0.0), (0.4, 0.0), (0.4, 0.4), (0.0, 0.4)], 'plain-render', lk.accent_col)
    lib.flat_roof(b, fp, z1, lk, parapet_h=1.0, ov=0.0, slab=0.0)
    return fp


def entrance(b, lk, P, cx, y_front, w, S, steps_n=3):
    """Flat entrance canopy with slim columns, steps; blank sign fascia."""
    if b.detail >= 2:
        return
    ch = 4.6
    lib.canopy_flat(b, cx - w / 2, y_front - 6.5, cx + w / 2, y_front, ch, lk, th=0.5, columns=max(2, int(w / 7)), col=lk.roof_col, edge_col=lk.accent_col, r=0.24)
    if b.detail == 0 and steps_n:
        lib.steps(b, cx - w / 2 + 1, cx + w / 2 - 1, y_front - 6.0, 0.45, 1.2, 2)


def atrium(b, lk, P, cx, y_front, w, h, S):
    """A glazed atrium lobby box leaning on the front of the building, with a sloped glass roof."""
    d = 7.0
    fp = lib.fp_rect(w, d, cx, y_front - d / 2)
    for seg in fp.edges():
        if seg.rear:
            continue
        U.skin(b, seg, 0, h, 2 if h > 7 else 1, 'curtain', lk, gc=glass_tint(lk, P) if P['kind'] == 'curtain' else lk.glass_col, group=1)
    # glass pent roof rising to the main wall
    pts = [(cx - w / 2, y_front - d, h), (cx + w / 2, y_front - d, h), (cx + w / 2, y_front, h + 2.2), (cx - w / 2, y_front, h + 2.2)]
    b.facing(pts, (0, -0.3, 1), 'glass-ribbon', lk.glass_col, mode='tile')
    for sx in (-1, 1):
        b.facing([(cx + sx * w / 2, y_front - d, 0), (cx + sx * w / 2, y_front, 0), (cx + sx * w / 2, y_front, h + 2.2), (cx + sx * w / 2, y_front - d, h)], (sx, 0, 0), lk.glass_slot, lk.glass_col, mode='fit')


def pilotis_base(b, lk, P, fp, h, S):
    """Ground storey on columns: recessed glazed core, perimeter columns."""
    x0, y0, x1, y1 = fp.bbox
    core = lib.fp_rect((x1 - x0) - 7.0, (y1 - y0) - 5.0, (x0 + x1) / 2, (y0 + y1) / 2)
    for seg in core.edges():
        U.skin(b, seg, 0, h, 1, 'curtain', lk, gc=lk.glass_col, group=1, reduced=seg.rear and b.detail == 0)
    n = max(3, int((x1 - x0) / 7))
    for k in range(n + 1):
        x = x0 + 1.2 + (x1 - x0 - 2.4) * k / n
        for y in (y0 + 1.2, y1 - 1.2):
            lib.column(b, x, y, 0, h, 0.5, lk, 'square', capital=False, slot='rough-concrete', col=lk.trim_col)


# ---------------------------------------------------------------------------------------------------------------------- typologies
def tower_fp(b, P, S, W, D):
    """Plan shape: the brief's footprint when it is L / T / U / H / cross / irregular, otherwise a rectangle, chamfered block, triangular
    prism or L chosen deterministically per venue (and by wording such as 'triangular' or 'faceted')."""
    fpk = P['fpk']
    if fpk in ('L', 'T', 'U', 'H', 'cross', 'irregular'):
        P['shape'] = fpk
        return lib.footprint(fpk, W, D, S.get('fp'), b.detail)
    r = S.get('shape').random()
    txt = P['txt']
    if has(txt, 'triang', 'wedge', 'flatiron', 'prism') or r < 0.11:
        P['shape'] = 'tri'
        return lib.fp_polygon([(-W / 2, D / 2), (W / 2, D / 2), (0.0, -D / 2)])
    if has(txt, 'chamfer', 'octagon', 'faceted', 'bevel') or r < 0.30:
        c = min(W, D) * (0.16 + 0.08 * S.get('shape').random())
        P['shape'] = 'chamfer'
        return lib.fp_polygon([(-W / 2 + c, -D / 2), (W / 2 - c, -D / 2), (W / 2, -D / 2 + c), (W / 2, D / 2 - c), (W / 2 - c, D / 2), (-W / 2 + c, D / 2), (-W / 2, D / 2 - c), (-W / 2, -D / 2 + c)])
    if r < 0.50 and W >= 30 and D >= 22:
        P['shape'] = 'L'
        return lib.footprint('L', W, D, S.get('fp'), b.detail)
    if r < 0.58 and W >= 36 and D >= 26:
        P['shape'] = 'T'
        return lib.footprint('T', W, D, S.get('fp'), b.detail)
    P['shape'] = 'rect'
    return lib.fp_rect(W, D)


def top_variant(b, lk, P, fp, H, S, kind=None):
    """A distinct roof-top when the brief has no crown: louvred plant screen, glazed pent top, stepped plant tier or plain plant boxes."""
    r = S.get('top').random()
    x0, y0, x1, y1 = fp.bbox
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = x1 - x0, y1 - y0
    fh = P['fh']
    if kind is None:
        kind = 'plant'
        if P['dress'] in ('glass', 'hightech', 'postmodern'):
            kind = ['screen', 'pent', 'stub', 'plant'][int(r * 4) % 4]
        elif P['dress'] in ('modern', 'brutal'):
            kind = ['plant', 'screen', 'stub'][int(r * 3) % 3]
        if P.get('shape') in ('tri',) and kind in ('pent', 'stub'):
            kind = 'screen'
    zt = H
    if kind == 'screen' and b.detail < 2:
        sw, sd = w * 0.7, d * 0.62
        sfp = lib.fp_rect(sw, sd, cx, cy)
        for seg in sfp.edges():
            U.plain(b, seg, 0, seg.length, H, H + 3.0, 'metal-cladding', lib.shade(lk.metal_col, 0.92))
            if b.detail == 0:
                U.sbox(b, seg, 0, seg.length, H + 2.6, H + 3.1, 0.15, lk.trim_col, skip_ends=True)
        lib.flat_roof(b, sfp, H + 3.0, lk, parapet_h=0.0, ov=0.3, slab=0.25)
        zt = H + 3.2
    elif kind == 'pent' and b.detail < 2:
        sw, sd = w * 0.66, d * 0.6
        sfp = lib.fp_rect(sw, sd, cx, cy)
        for seg in sfp.edges():
            U.skin(b, seg, H, H + fh * 2.0, 2, 'curtain', lk, gc=glass_tint(lk, P), group=1)
        pts = [(cx - sw / 2, cy - sd / 2, H + fh * 2.0), (cx + sw / 2, cy - sd / 2, H + fh * 2.0), (cx + sw / 2, cy + sd / 2, H + fh * 2.0 + sd * 0.35), (cx - sw / 2, cy + sd / 2, H + fh * 2.0 + sd * 0.35)]
        b.facing(pts, (0, -0.4, 1), 'metal-roof', lk.trim_col)
        for sx in (-1, 1):
            b.facing([(cx + sx * sw / 2, cy - sd / 2, H + fh * 2.0), (cx + sx * sw / 2, cy + sd / 2, H + fh * 2.0), (cx + sx * sw / 2, cy + sd / 2, H + fh * 2.0 + sd * 0.35)], (sx, 0, 0), 'plain', lk.trim_col, mode='fit')
        b.facing([(cx - sw / 2, cy + sd / 2, H + fh * 2.0), (cx + sw / 2, cy + sd / 2, H + fh * 2.0), (cx + sw / 2, cy + sd / 2, H + fh * 2.0 + sd * 0.35), (cx - sw / 2, cy + sd / 2, H + fh * 2.0 + sd * 0.35)], (0, 1, 0), 'plain', lib.shade(lk.trim_col, 0.9), mode='fit')
        zt = H + fh * 2.0 + sd * 0.35
    elif kind == 'stub':
        sfp = lib.fp_rect(w * 0.6, d * 0.6, cx, cy)
        U.walls_b(b, lk, sfp, H, H + fh * 2.5, 2, S.get('stubw'), kind='ribbon', ratio=0.5, front_kind='ribbon', plinth=0, bay=4.0, wall_col=lib.shade(lk.wall_col, 0.95))
        lib.flat_roof(b, sfp, H + fh * 2.5, lk, parapet_h=0.6, ov=0.3, slab=0.3)
        zt = H + fh * 2.5
        roof_clutter(b, lk, P, sfp, zt, S)
    else:
        roof_clutter(b, lk, P, fp, H, S)
    return zt


def build_slab(b, lk, P, S):
    W, D, H, fh = P['W'], P['D'], P['H'], P['fh']
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'T', 'U', 'H', 'cross', 'irregular') else 'rect'
    fp = tower_fp(b, P, S, W, D)
    if P.get('shape') not in ('rect', 'L', 'T') and P['crown'] in ('pyramid', 'dome', 'frame', 'pod'):
        P['crown'] = 'cap' if P['shape'] == 'chamfer' else None
    if P.get('shape') != 'rect':
        P['pilotis'] = False
    info = {'front': fp.bbox[1], 'back': fp.bbox[3], 'x': (fp.bbox[0], fp.bbox[2])}
    storeys = P['storeys']
    z0 = 0.0
    floors = storeys
    pf = 0
    if P['podium']:
        pfl = 2 + (1 if S.get('pod').random() < 0.5 else 0)
        pz = fh * pfl + 1.2
        pw = U.clamp(W * 1.4, W + 10, 78)
        pdf = U.clamp(D * 0.5, 8, 20)
        px0, px1 = -pw / 2, pw / 2
        py0, py1 = fp.bbox[1] - pdf, fp.bbox[3] + 3.0
        b.section('podium')
        podium_mass(b, lk, P, px0, px1, py0, py1, pfl, pz, S)
        info['front'] = py0
        info['x'] = (px0, px1)
        z0 = pz
        floors = max(1, storeys - pfl)
        zf0 = pz
        tower_h = H - z0
    elif P['pilotis']:
        pz = fh * 1.7
        b.section('pilotis')
        pilotis_base(b, lk, P, fp, pz, S)
        z0 = pz
        floors = max(1, storeys - 1)
        tower_h = H - z0
    else:
        tower_h = H
    b.section('shaft')
    two = (P['dress'] in ('glass', 'modern', 'hightech', 'postmodern') and storeys >= 16 and 'setback-tiers' not in P['feats'] and S.get('two').random() < 0.32
           and P.get('shape') in ('rect', 'chamfer', 'L', 'T'))
    fp_low = fp
    if two:
        f1 = max(3, int(round(floors * 0.62)))
        zs = z0 + (H - z0) * f1 / floors
        tower_walls(b, lk, P, fp, z0, zs, f1)
        lib.flat_roof(b, fp, zs, lk, parapet_h=0.8, ov=0.0, slab=0.0)
        inset = min(W, D) * 0.1
        fp = lib.Footprint([lib.shapes._miter(pl, -inset) for pl in fp.polys], [(a + inset, b_ + inset, c - inset, d - inset) for (a, b_, c, d) in fp.rects])
        tower_walls(b, lk, P, fp, zs, H, floors - f1)
        P['est'] = P['est'] * 0.7
    else:
        tower_walls(b, lk, P, fp, z0, H, floors)
    if P['dress'] in ('masonry', 'deco') and b.detail == 0 and z0 == 0:
        lib.sweep(b, fp, 0.0, [(0.18, 0.0), (0.18, 1.6), (0.0, 1.6)], lk.wall_slot, lib.shade(lk.wall_col, 0.8))
    if P['pilotis'] and b.detail == 0:
        lib.sweep(b, fp, z0 - 0.4, [(0.0, 0.0), (0.0, 0.4)], 'plain-render', lk.trim_col)
    b.section('roof')
    zt = H
    if P['crown'] and P['crown'] != 'cap' or P['crown'] == 'cap':
        top_of(b, lk, P, fp, H, floors, parapet=0.8 if P['crown'] else 1.1)
    else:
        top_of(b, lk, P, fp, H, floors)
    if P['crown']:
        b.section('crown')
        zt = crown_on(b, lk, P, fp, H, S)
    else:
        zt = top_variant(b, lk, P, fp, H, S)
    if P['helipad']:
        x0_, y0_, x1_, y1_ = fp.bbox
        hr = U.clamp(min(x1_ - x0_, y1_ - y0_) * 0.28, 4.5, 8.0)
        hx, hy = (x0_ + x1_) / 2 + ((x1_ - x0_) / 2 - hr - 0.4) * 0.6, (y0_ + y1_) / 2 + ((y1_ - y0_) / 2 - hr - 0.4) * 0.4
        U.helipad(b, hx, hy, H + 0.2, hr)
        if b.detail < 2:
            lib.cylinder(b, hx, hy, H, H + 0.2, hr * 0.5, n=6, slot='plain', col='#666a6e', top=False)
    if P['mast']:
        x0_, y0_, x1_, y1_ = fp.bbox
        mx = (x0_ + x1_) / 2 - (x1_ - x0_) * 0.28 if P['helipad'] else (x0_ + x1_) / 2
        if P['crown'] in ('spire',):
            pass
        else:
            U.mast(b, mx, (y0_ + y1_) / 2 + 1.0, zt, P['mast_h'])
    # lobby details at the front
    b.section('lobby')
    cx = 0.0
    if 'atrium-glass' in P['feats'] and not P['podium']:
        atrium(b, lk, P, cx, fp.bbox[1], U.clamp(W * 0.45, 10, 24), min(fh * 2.2, 8.4), S)
        info['front'] = fp.bbox[1] - 7.0
    if not P['pilotis']:
        ew = U.clamp((info['x'][1] - info['x'][0]) * 0.28, 8, 20)
        if 'atrium-glass' not in P['feats'] or P['podium']:
            entrance(b, lk, P, cx, info['front'], ew, S)
    return fp, info, zt


def build_stepped(b, lk, P, S):
    W, D, H, fh = P['W'], P['D'], P['H'], P['fh']
    nt = U.fcount(P['feats'], 'setback-tiers', 3) or 3
    nt = int(U.clamp(nt if 'setback-tiers' in P['feats'] else (3 if H < 90 else 4), 2, 4))
    sw = [1.0, 0.8, 0.58, 0.38][:nt]
    hf = {2: [0.55, 0.45], 3: [0.42, 0.30, 0.28], 4: [0.34, 0.27, 0.22, 0.17]}[nt]
    storeys = P['storeys']
    info = {'front': -D / 2, 'x': (-W / 2, W / 2)}
    z = 0.0
    done = 0
    last_fp = None
    b.section('tiers')
    fpk = P['fpk'] if P['fpk'] in ('rect', 'L', 'T', 'U', 'H', 'cross') else 'rect'
    for t in range(nt):
        w_t, d_t = W * sw[t], D * sw[t]
        yshift = (D - d_t) / 2 * 0.45
        if t == 0 and fpk != 'rect':
            fp = lib.footprint(fpk, w_t, d_t, S.get('fp'), b.detail)
        else:
            fp = lib.fp_rect(w_t, d_t, 0, yshift)
        zt = H * sum(hf[:t + 1])
        fl = max(1, int(round(storeys * hf[t]))) if t < nt - 1 else max(1, storeys - done)
        done += fl
        ground = None
        tower_walls(b, lk, P, fp, z, zt, fl, front_kind=None)
        top_of(b, lk, P, fp, zt, fl, parapet=1.0 if t < nt - 1 else 0.7)
        if t < nt - 1 and b.detail == 0:
            # terrace furniture on the setback roofs: planters
            x0_, y0_, x1_, y1_ = fp.bbox
            nxt = W * sw[t + 1]
            for k in range(3):
                lib.blob(b, x0_ + 1.5 + k * 3.0, y0_ + 1.2, zt + 0.5, 0.9, 0.9, 0.5, '#4f7d3b', n=6, rings=3)
        z = zt
        last_fp = fp
    zt = H
    # ground storey emphasis on the first tier (arcade of piers + entrance)
    if b.detail == 0:
        fp0 = lib.fp_rect(W, D, 0, 0) if fpk == 'rect' else last_fp
        entrance(b, lk, P, 0.0, -D / 2, U.clamp(W * 0.3, 8, 18), S)
    b.section('crown')
    zc = H
    if P['crown']:
        zc = crown_on(b, lk, P, last_fp, H, S)
    else:
        roof_clutter(b, lk, P, last_fp, H, S)
    if P['mast'] and P['crown'] != 'spire':
        U.mast(b, 0.0, 0.0, zc, P['mast_h'])
    if P['helipad']:
        fp1 = lib.fp_rect(W * sw[1], D * sw[1], 0, (D - D * sw[1]) / 2 * 0.45)
        zh = H * sum(hf[:1])
        hr = U.clamp(min(W, D) * sw[1] * 0.25, 4.5, 7.0)
        U.helipad(b, fp1.bbox[0] + hr + 1.5, fp1.bbox[1] + hr + 1.5, zh + 1.0, hr)
    return last_fp, info, zc


def build_round(b, lk, P, S):
    W, D, H, fh = P['W'], P['D'], P['H'], P['fh']
    rx0, ry0 = min(W, 56) / 2, min(D, 56) / 2
    if P['fpk'] == 'round':
        rx0 = ry0 = min(rx0, ry0)
    txt = P['txt']
    bulge = has(txt, 'bulg', 'gherkin', 'swiss re', 'egg', 'barrel')
    taper = has(txt, 'taper', 'cone', 'conical') or not bulge
    stages = {0: 9, 1: 5, 2: 3}[b.detail]
    rmax = max(rx0, ry0)
    n = {0: int(U.clamp(round(2 * math.pi * rmax / 3.2), 16, 34)), 1: 16, 2: 10}[b.detail]
    z0 = 0.0
    info = {'front': -ry0, 'x': (-rx0, rx0)}
    if P['podium']:
        pz = P['fh'] * 2 + 1.2
        pw, pd_ = rx0 * 2 + 14, ry0 * 2 + 12
        fpp = lib.fp_rect(pw, pd_, 0, -2)
        b.section('podium')
        podium_mass(b, lk, P, -pw / 2, pw / 2, -2 - pd_ / 2, -2 + pd_ / 2, 2, pz, S)
        z0 = pz
        info['front'] = -2 - pd_ / 2
        info['x'] = (-pw / 2, pw / 2)
    else:
        # drum plinth
        b.section('plinth')
        lib.cylinder(b, 0, 0, 0, 1.0, rmax + 1.2, n=n, slot='rough-concrete', col=lib.shade(lk.trim_col, 0.9), r_top=rmax + 1.0, top=True, smooth=False)
    # radius profile
    def prof(t):
        if bulge:
            if t < 0.55:
                return 0.7 + 0.3 * (t / 0.55) ** 0.8
            return max(0.32, 1.0 - 0.68 * ((t - 0.55) / 0.45) ** 1.5)
        if taper:
            return 1.0 - 0.28 * t ** 1.3
        return 1.0
    zs = [z0 + (H - z0) * k / stages for k in range(stages + 1)]
    rings = [ring_pts(rx0 * prof(k / stages), ry0 * prof(k / stages), n) for k in range(stages + 1)]
    floors = max(1, P['storeys'] - (2 if P['podium'] else 0))
    b.section('shaft')
    tv = (H - z0) / floors * (1 if b.detail == 0 else 2)
    U.loft(b, rings, zs, lk.glass_slot, glass_tint(lk, P) if P['kind'] != 'ribbon' else lk.glass_col, 3.4 if b.detail == 0 else 7.0, tv)
    if b.detail == 0:
        # spiral-ish floor bands every few storeys
        for k in range(1, floors // 4):
            zb_ = z0 + (H - z0) * k * 4 / floors
            t = (zb_ - z0) / (H - z0)
            lib.sweep(b, lib.fp_polygon(ring_pts(rx0 * prof(t), ry0 * prof(t), n)), zb_ - 0.2, [(0.0, 0.0), (0.22, 0.0), (0.22, 0.4), (0.0, 0.4)], 'plain', lib.shade(lk.wall_col, 0.9))
    b.section('roof')
    top_fp = lib.fp_polygon(ring_pts(rx0 * prof(1.0), ry0 * prof(1.0), n))
    zc = H
    if P['crown'] in (None, 'cap', 'frame', 'spire', 'pyramid'):
        r_top = min(rx0, ry0) * prof(1.0)
        if b.detail < 2:
            lib.dome(b, 0, 0, H, r_top, lk, height=r_top * 0.6, profile='shallow', slot=lk.glass_slot, col=lk.glass_col, lantern=0.0, finial=0.0)
        else:
            lib.dome(b, 0, 0, H, r_top, lk, height=r_top * 0.6, profile='shallow', slot='plain', col=lk.glass_col)
        zc = H + r_top * 0.6
        if b.detail < 2:
            lib.cylinder(b, 0, 0, zc, zc + 5.0, 0.2, n=5, slot='frame', col=lk.metal_col, r_top=0.05, top=True)
            zc += 5.0
    else:
        lib.flat_roof(b, top_fp, H, lk, parapet_h=0.8, ov=0.0, slab=0.0)
        zc = crown_on(b, lk, P, top_fp, H, S)
    if P['mast'] and P['crown'] not in (None, 'cap', 'frame', 'spire', 'pyramid'):
        U.mast(b, 0, 0, zc, P['mast_h'])
    if P['helipad']:
        U.helipad(b, 0, 0, H + 0.3, min(rx0, ry0) * prof(1) * 0.8)
    entrance(b, lk, P, 0.0, info['front'] if P['podium'] else -ry0 - 1.0, 12.0, S)
    return top_fp, info, zc


def ring_pts(rx, ry, n):
    return U.ring_poly(0, 0, rx, ry, n)


def build_cluster(b, lk, P, S):
    n = P['n']
    W, D, H, fh = P['W'], P['D'], P['H'], P['fh']
    span = U.clamp(W, 40 if n == 2 else 56, 100)
    gap = 7.0 if n == 2 else 6.0
    tw = (span - gap * (n - 1)) / n
    td = U.clamp(min(D, tw * 1.05), 14, 40)
    tw = U.clamp(tw, 14, 40)
    span = tw * n + gap * (n - 1)
    hs = {2: [1.0, 0.88], 3: [0.86, 1.0, 0.74], 4: [0.94, 1.0, 0.8, 0.88]}[n]
    if n == 2 and S.get('hh').random() < 0.5:
        hs = [1.0, 1.0]
    if n == 2 and P['txt'].count('twin') > 0:
        hs = [1.0, 1.0]
    pfl = 3
    pz = fh * pfl + 1.2
    pw = span + 14
    pdf = U.clamp(td * 0.55, 10, 20)
    b.section('podium')
    podium_mass(b, lk, P, -pw / 2, pw / 2, -td / 2 - pdf, td / 2 + 3.0, pfl, pz, S)
    info = {'front': -td / 2 - pdf, 'x': (-pw / 2, pw / 2)}
    tops = []
    crown_i = max(range(n), key=lambda i: hs[i])
    b.section('shafts')
    zc = 0.0
    for i in range(n):
        cx = -span / 2 + tw / 2 + i * (tw + gap)
        fp = lib.fp_rect(tw, td, cx, 0)
        Hi = pz + (H - pz) * hs[i]
        fl = max(2, int(round((Hi - pz) / fh)))
        tower_walls(b, lk, P, fp, pz, Hi, fl)
        top_of(b, lk, P, fp, Hi, fl, parapet=0.9)
        if P['crown'] and i == crown_i:
            zc = max(zc, crown_on(b, lk, P, fp, Hi, S))
        elif P['crown'] == 'pyramid' or P['crown'] == 'dome' or P['crown'] == 'spire':
            zc = max(zc, crown_on(b, lk, P, fp, Hi, S))
        else:
            roof_clutter(b, lk, P, fp, Hi, S) if i == 0 else U.plant_box(b, lk, cx, 0, Hi, tw * 0.4, td * 0.3, 3.4, lib.shade(lk.wall_col, 0.9), slot='plain-render')
            zc = max(zc, Hi)
        tops.append((cx, fp, Hi))
        if P['helipad'] and i == 1 % n:
            U.helipad(b, cx, 0, Hi + 0.3, min(tw, td) * 0.32)
    # sky-bridge between the first two towers
    if n >= 2 and b.detail < 2:
        zb_ = pz + (min(tops[0][2], tops[1][2]) - pz) * 0.72
        xa, xb = tops[0][0] + tw / 2, tops[1][0] - tw / 2
        U.box_c(b, (xa + xb) / 2, 0, zb_, xb - xa, td * 0.3, fh * 2.0, lk.glass_slot, lk.glass_col, top_slot='roof-flat', top_col=lk.roof_col, skip=())
    if P['mast']:
        U.mast(b, tops[crown_i][0], 0, zc, P['mast_h'])
        zc += P['mast_h']
    entrance(b, lk, P, 0.0, info['front'], U.clamp(span * 0.22, 10, 24), S)
    return tops[0][1], info, zc


# ---------------------------------------------------------------------------------------------------------------------- site
def site(b, lk, P, S, info, zc):
    if b.detail >= 2:
        return
    x0, x1 = info['x']
    front = info['front']
    pad_w = U.clamp(max(x1 - x0, P['W']) + 26, 50, 112)
    back = P['D'] / 2 + 12
    y_front = front - 26.0
    if back - y_front > 112:
        back = y_front + 112
    lk_ground = lk
    b.section('ground')
    lib.ground(b, -pad_w / 2, y_front, pad_w / 2, back, lk)
    fc = (P['setting'].get('forecourt') or 'plaza')
    road_y1 = front - 3.0
    road_y0 = road_y1 - 10.0
    b.section('forecourt')
    lib.forecourt(b, 'road', -pad_w / 2 + 0.5, road_y0, pad_w / 2 - 0.5, road_y1, lk, S.get('road'))
    inner0, inner1 = y_front + 1, road_y0 - 1
    kind = fc if fc in ('parking', 'garden', 'plaza') else ('plaza' if 'car-park' not in P['feats'] else 'parking')
    if 'car-park' in P['feats']:
        kind = 'parking'
    if inner1 - inner0 > 4:
        lib.forecourt(b, kind, -pad_w / 2 + 3, inner0, pad_w / 2 - 3, inner1, lk, S.get('court'), density=1.0)
    # front plaza strip tying the entrance to the road
    if b.detail == 0:
        lib.forecourt(b, 'plaza', -min(14, pad_w / 3), road_y1, min(14, pad_w / 3), front, lk, S.get('plaza'))
    b.section('trees')
    # trees: hold to the two flanks of the plot
    rs = S.get('flank')
    if lk.tree not in (None, 'none'):
        for k in range(5 if b.detail == 0 else 3):
            side = -1 if k % 2 == 0 else 1
            tx = side * (pad_w / 2 - 5 - rs.uniform(0, 4))
            ty = front + 4 + rs.uniform(0, 10) * (k + 1) / 2
            lib.tree(b, lk.tree, tx, ty, rs.uniform(6, 9), S.get('t%d' % k), lk)
    b.section('furniture')
    U.street_lamps(b, lk, -pad_w / 2 + 6, pad_w / 2 - 6, road_y1 + 1.5, 4)
    if 'flags' in P['feats']:
        for k in range(3):
            U.flagpole(b, -6 + 6 * k, front - 12.0, 11.0, ['#0b7a43', '#f2f2f2', '#b6323a'][k])
    if 'signage-board' in P['feats']:
        with b.site():
            lib.sign_board(b, x1 * 0.8, front - 11.0, 0.0, 8.0, 3.0, lk, 0.0, col='#2f5f8a')
    if 'floodlights' in P['feats']:
        U.floodlight(b, -pad_w / 2 + 8, back - 6)
        U.floodlight(b, pad_w / 2 - 8, back - 6)
    if 'fence-wall' in P['feats']:
        U.fence(b, lk, [(-pad_w / 2 + 2, y_front + 2), (-pad_w / 2 + 2, back - 2), (pad_w / 2 - 2, back - 2), (pad_w / 2 - 2, y_front + 2)], h=2.4, col=lk.wall_col, gate=None)
        U.fence(b, lk, [(-pad_w / 2 + 2, y_front + 2), (pad_w / 2 - 2, y_front + 2)], h=2.4, col=lk.wall_col, gate=(0, 0.5, 8.0))


# ---------------------------------------------------------------------------------------------------------------------- build
def build(brief, style, rng, detail):
    b = lib.Builder('office-tower', detail)
    S = U.Streams(rng)
    brief = U.sane(brief)
    style = style if isinstance(style, dict) else {}
    lk = lib.look(brief, style, S.get('look'))
    P = plan(brief, style, lk, S)
    P['setting'] = brief.get('setting') or {}
    typ = P['typ']
    fn = {'slab': build_slab, 'stepped': build_stepped, 'round': build_round, 'cluster': build_cluster}[typ]
    fp, info, zc = fn(b, lk, P, S)
    site(b, lk, P, S, info, zc)
    return b.objects()
