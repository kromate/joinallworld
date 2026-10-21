"""monument: five typologies chosen from the brief (name, subject, notes, features, footprint, style, material).

  statue   a figure on a stepped plinth (standing / arm raised / robed lady / warrior with spear / chains), on a roundabout or in a
           paved plaza; plinth shape follows style (tiered classical, tapered modern, round drum).
  obelisk  tapering square obelisk with pyramidion, faceted round brutalist pylon with ring slabs, or the upturned-sword blade.
  arch     one or several arched openings through a block (round / parabolic / pointed / portal), attic with flag masts, star or
           blank crest, side wings; mud-render gatehouses get a batter, crenellations, horn pinnacles and relief panels.
  tower    colonial square clock / lookout tower (storeys, belt courses, deck with merlons, clock dials, hip cap), sahelian conical
           minaret with toron beams, or a modern pylon with an observation pod.
  hall     memorial / mausoleum on a podium: portico or colonnade, flat / pyramidal / domed roof, enclosure wall and gate.

Everything faces -Y. Plan sizes come from the brief but the site pad stays under about 100 m.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import _stadium_util as U  # noqa: E402

FEATURES = {'statue', 'obelisk', 'arches', 'gate', 'steps', 'flags', 'fountain', 'fence-wall', 'terrace', 'relief-pattern', 'colonnade',
            'portico', 'pediment', 'railings', 'signage-board', 'toron-beams', 'pinnacles', 'crenellation', 'painted-mural', 'clock-tower',
            'bell-tower', 'dome', 'ramparts', 'mosaic', 'floodlights', 'kiosk', 'stand-roof'}

FLAT = 60.0
BRONZE = '#6a583b'


# ------------------------------------------------------------------------------------------------------------------ plan
def plan(brief, style, srng, lk):
    form = brief.get('form') or {}
    fe = U.feats(brief)
    tx = U.text(brief)
    nm = ' '.join(str(brief.get(k) or '') for k in ('name', 'subject')).lower()
    w = U.num(form, 'width_m', 10)
    d = U.num(form, 'depth_m', w)
    H = U.num(form, 'height_m', 8)
    fp = form.get('footprint') or 'rect'
    st = brief.get('style') or ''
    mat = (brief.get('facade') or {}).get('material') or lk.wall_material
    P = {'fe': fe, 'tx': tx, 'nm': nm, 'w': w, 'd': d, 'H': max(2.5, H), 'fp': fp, 'style': st, 'material': mat, 'year': U.era_year(brief),
         'roof': form.get('roof') or 'none'}
    words = lambda *ws: any(x in nm for x in ws)
    twords = lambda *ws: any(x in tx for x in ws)
    if words('mausoleum', 'tomb', 'memorial and', 'memorial hall') or 'portico' in fe or ('colonnade' in fe and 'statue' not in fe):
        typ = 'hall'
    elif words('sword'):
        typ = 'obelisk'
    elif words(' arch', 'arch ', 'archway') or ('arches' in fe and 'statue' not in fe and 'obelisk' not in fe) or ('gate' in fe and 'statue' not in fe and 'obelisk' not in fe and not words('memorial')):
        typ = 'arch'
    elif words('tower', 'minaret', 'clock', 'lookout', 'belfry'):
        typ = 'tower'
    elif 'obelisk' in fe or words('obelisk', 'pylon', 'monument du'):
        typ = 'obelisk'
    elif 'statue' in fe or words('statue', 'figure', 'amazon', 'holy mary'):
        typ = 'statue'
    elif d <= 12 and H / max(w, 1) > 2.5:
        typ = 'tower'
    elif words('memorial', 'monument', 'mémorial'):
        typ = 'statue' if 'steps' in fe else 'obelisk'
    else:
        typ = 'statue'
    if P['H'] > 112:
        k = 112.0 / P['H']
        P['H'] *= k
        P['w'] *= k
        P['d'] *= k
    P['typ'] = typ
    P['seed'] = srng.getrandbits(32)
    return P


# ----------------------------------------------------------------------------------------------------------------- helpers
def stone_look(lk, P):
    """Material slot / colours for monumental masonry from the brief's facade (stone, marble, concrete, mud-render ...)."""
    return lk.wall_slot, lk.wall_col, lk.trim_col


def disc(b, cx, cy, r0, r1, z, slot, col, n=32, scale=3.0):
    """A flat annulus (or disc when r0 = 0) at height z facing up."""
    if b.detail >= 2:
        return
    U.revolve(b, cx, cy, [(r1, z), (r0, z)], n, slot, col, smooth_=False, scale=scale)


def kerb(b, cx, cy, r, z, h, w, slot, col, n=32):
    if b.detail >= 2:
        return
    U.revolve(b, cx, cy, [(r, z), (r, z + h), (r - w, z + h)], n, slot, col, smooth_=False)


def frustum_box(b, cx, cy, z0, z1, w0, d0, w1, d1, slot, col, top_slot=None, top_col=None, skip=('bottom',), scale=1.0):
    """A box whose plan shrinks (or grows) linearly from w0 x d0 at z0 to w1 x d1 at z1."""
    pts0 = [(cx - w0 / 2, cy - d0 / 2), (cx + w0 / 2, cy - d0 / 2), (cx + w0 / 2, cy + d0 / 2), (cx - w0 / 2, cy + d0 / 2)]
    pts1 = [(cx - w1 / 2, cy - d1 / 2), (cx + w1 / 2, cy - d1 / 2), (cx + w1 / 2, cy + d1 / 2), (cx - w1 / 2, cy + d1 / 2)]
    for i in range(4):
        j = (i + 1) % 4
        b.face([(pts0[i][0], pts0[i][1], z0), (pts0[j][0], pts0[j][1], z0), (pts1[j][0], pts1[j][1], z1), (pts1[i][0], pts1[i][1], z1)], slot, col, scale=scale)
    if 'top' not in skip:
        b.facing([(p[0], p[1], z1) for p in pts1], (0, 0, 1), top_slot or slot, top_col or col)
    if 'bottom' not in skip:
        b.facing([(p[0], p[1], z0) for p in pts0], (0, 0, -1), slot, col)


def stepped_base(b, cx, cy, w, d, n, step_h, grow, slot, col, round_=False, nseg=24):
    """n steps, the lowest widest (w + n*grow each side); returns the top height and the top plan size."""
    z = 0.0
    for k in range(n):
        g = grow * (n - k)
        if round_:
            r = w / 2 + g
            U.revolve(b, cx, cy, [(r, z), (r, z + step_h), (r * 0.0 + max(0.0, w / 2 + grow * (n - k - 1)), z + step_h)], nseg, slot, col, smooth_=False, scale=3.0)
        else:
            lib.box(b, cx - w / 2 - g, cy - d / 2 - g, z, cx + w / 2 + g, cy + d / 2 + g, z + step_h, slot, lib.shade(col, 1.0 - 0.02 * k), top_slot=slot, skip=('bottom',), scale=3.0)
        z += step_h
        if b.detail >= 2 and k < n - 1:
            continue
    return z


def relief_panels(b, cx, cy, z0, z1, w, d, col, count=1, depth=0.1, slot='plain-render'):
    """Recessed / raised panel rectangles on the four faces of a square shaft (blank: no lettering)."""
    if b.detail >= 1:
        return
    for (nx, ny, hw) in ((0, -1, w), (1, 0, d), (0, 1, w), (-1, 0, d)):
        n = count
        for k in range(n):
            u = (k - (n - 1) / 2) * hw / max(1, n) * 0.9
            pw = hw / max(1, n) * 0.62
            pz0, pz1 = z0 + (z1 - z0) * 0.18, z1 - (z1 - z0) * 0.14
            if nx == 0:
                x0, x1 = cx + u - pw / 2, cx + u + pw / 2
                y = cy + ny * (d / 2 + depth)
                pts = [(x0, y, pz0), (x1, y, pz0), (x1, y, pz1), (x0, y, pz1)]
            else:
                y0, y1 = cy + u - pw / 2, cy + u + pw / 2
                x = cx + nx * (w / 2 + depth)
                pts = [(x, y0, pz0), (x, y1, pz0), (x, y1, pz1), (x, y0, pz1)]
            b.facing(pts, (nx, ny, 0), slot, col, scale=FLAT)


# ---------------------------------------------------------------------------------------------------------------------- figures
def figure(b, x, y, z0, h, col, pose, rng, yaw=0.0, skin=None):
    """A statue figure of height h. pose: stand | raised | forward | robed | lady | warrior | chains | chief. Faces -Y at yaw 0."""
    det = b.detail
    skin = skin or col
    if det >= 2:
        U.revolve(b, x, y, [(h * 0.13, 0), (h * 0.1, h * 0.55), (h * 0.12, h * 0.8), (h * 0.06, h * 0.88), (0, h)], 5, 'plain', col, smooth_=False, z0=z0)
        return
    c, s = math.cos(yaw), math.sin(yaw)
    L = lambda lx, ly, lz: (x + c * lx - s * ly, y + s * lx + c * ly, z0 + lz)
    nn = 10 if det == 0 else 6
    if pose in ('robed', 'lady', 'chief'):
        r_hem = h * (0.15 if pose == 'lady' else 0.13)
        prof = [(r_hem, 0.0), (r_hem * 0.93, h * 0.1), (r_hem * 0.7, h * 0.35), (h * 0.075, h * 0.62), (h * 0.1, h * 0.7), (h * 0.085, h * 0.78), (h * 0.04, h * 0.8)]
        U.revolve(b, x, y, prof, nn, 'plain', col, smooth_=True, z0=z0)
        hp = L(0, 0, h * 0.875)
        lib.blob(b, hp[0], hp[1], hp[2], h * 0.055, h * 0.055, h * 0.07, skin, n=6, rings=3)
        if pose == 'lady':
            # veil over the head and shoulders, hands joined in front
            U.revolve(b, x, y, [(h * 0.1, h * 0.72), (h * 0.075, h * 0.82), (h * 0.065, h * 0.92), (0.0, h * 0.945)], nn, 'plain', lib.shade(col, 0.96), smooth_=True, z0=z0)
            hand = L(0, -h * 0.085, h * 0.58)
            lib.blob(b, hand[0], hand[1], hand[2], h * 0.03, h * 0.03, h * 0.04, skin, n=5, rings=3)
        elif pose == 'chief':
            sp0, sp1 = L(h * 0.14, -h * 0.05, 0.0), L(h * 0.14, -h * 0.05, h * 1.0)
            U.strut(b, sp0, sp1, h * 0.02, '#4a3f2e', slot='frame')
            U.strut(b, L(h * 0.07, 0, h * 0.62), L(h * 0.14, -h * 0.05, h * 0.62), h * 0.04, col, slot='plain')
            U.strut(b, L(-h * 0.1, 0, h * 0.7), L(-h * 0.13, -h * 0.02, h * 0.5), h * 0.04, col, slot='plain')
        else:
            U.strut(b, L(h * 0.09, 0, h * 0.7), L(h * 0.16, -h * 0.05, h * 0.55), h * 0.045, col, slot='plain')
            U.strut(b, L(-h * 0.09, 0, h * 0.7), L(-h * 0.16, -h * 0.05, h * 0.55), h * 0.045, col, slot='plain')
        return
    arm = {'raised': 'up', 'forward': 'forward', 'chains': 'out', 'warrior': 'up'}.get(pose, 'down')
    hold = h * 0.34 if pose in ('raised', 'warrior') else 0.0
    U.person(b, x, y, z0, h, col, yaw, arm=arm, cloth=lib.shade(col, 0.92), skin=skin, hold=hold)
    if pose == 'warrior':
        # shield on the left arm and a plumed headdress
        sc_ = L(-h * 0.17, -h * 0.07, h * 0.58)
        lib.obox(b, sc_[0], sc_[1], sc_[2] - h * 0.16, h * 0.05, h * 0.2, h * 0.32, yaw, 'plain', lib.shade(col, 0.8), skip=('bottom',))
        hp = L(0, 0, h * 0.89)
        lib.cylinder(b, hp[0], hp[1], hp[2], hp[2] + h * 0.1, h * 0.04, n=5, slot='plain', col=lib.shade(col, 0.85), r_top=h * 0.015, top=True)
    if pose == 'chains':
        for sx in (-1, 1):
            p = L(sx * h * 0.34, 0, h * 0.58)
            lib.cylinder(b, p[0], p[1], p[2] - h * 0.12, p[2], h * 0.012, n=4, slot='frame', col='#3b3b3b', top=False)


# ------------------------------------------------------------------------------------------------------------------- statue
def build_statue(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    H, W = P['H'], max(P['w'], P['d'])
    huge = H >= 22
    round_fp = P['fp'] == 'round'
    ws, wc, tc = stone_look(lk, P)
    stone = lk.wall_col
    # pose / colour
    nm = P['nm'] + ' ' + tx
    if U.has(nm, 'virgin', 'mary', 'madonna'):
        pose, fcol = 'lady', '#f1efe8'
    elif U.has(nm, 'amazon', 'warrior', 'soldier'):
        pose, fcol = 'warrior', BRONZE if 'bronze' in nm or 'granite' in nm else lk.wall_col
    elif U.has(nm, 'slave', 'chains'):
        pose, fcol = 'chains', BRONZE
    elif U.has(nm, 'chief', 'efik'):
        pose, fcol = 'chief', BRONZE
    else:
        pose = rng.choice(['stand', 'raised', 'forward', 'stand'])
        fcol = BRONZE if (U.has(nm, 'bronze') or 'contemporary' in P['style'] or P['style'] in ('colonial', 'neoclassical', 'modernist')) else '#cfcabd'
    if U.has(nm, 'white'):
        fcol = '#f1efe8'
    ph_ratio = 0.30 if huge else (0.5 if H < 12 else 0.42)
    step_n = 3 if H > 8 else 2
    step_h = 0.3 if H < 12 else 0.4
    grow = 0.55 if H < 12 else 0.9
    plinth_h = max(1.2, H * ph_ratio - step_n * step_h)
    pw = U.clamp(0.16 * H + 1.2, 1.4, 7.0) if not huge else U.clamp(0.1 * H + 3.0, 4, 9)
    style_tier = P['style'] in ('colonial', 'neoclassical', 'georgian', 'victorian', 'art-deco')
    shape = 'round' if (round_fp and not style_tier and rng.random() < 0.5) else ('tapered' if (P['style'] in ('modernist', 'brutalist', 'contemporary') and not style_tier) else 'tier')
    cx = cy = 0.0
    b.section('base')
    ztop = stepped_base(b, cx, cy, pw, pw, step_n, step_h, grow, lk.wall_slot if det < 2 else 'plain', lib.shade(stone, 0.92), round_=(shape == 'round'))
    b.section('plinth')
    zp1 = ztop + plinth_h
    pc = lib.shade(stone, 1.0)
    if shape == 'round':
        U.revolve(b, cx, cy, [(pw / 2, ztop), (pw / 2 * 0.92, zp1 - 0.5), (pw / 2 * 1.08, zp1 - 0.5), (pw / 2 * 1.08, zp1)], 16 if det == 0 else 8, ws, pc, smooth_=False, scale=3.0)
        U.revolve(b, cx, cy, [(pw / 2 * 1.08, zp1), (0, zp1)][::1], 16 if det == 0 else 8, ws, tc, smooth_=False)
    elif shape == 'tapered':
        frustum_box(b, cx, cy, ztop, zp1 - 0.35, pw, pw, pw * 0.72, pw * 0.72, ws, pc, skip=('bottom', 'top'), scale=2.0)
        lib.box(b, cx - pw * 0.42, cy - pw * 0.42, zp1 - 0.35, cx + pw * 0.42, cy + pw * 0.42, zp1, ws, tc, top_slot=ws, skip=('bottom',))
        if 'relief-pattern' in fe or 'painted-mural' in fe:
            relief_panels(b, cx, cy, ztop, zp1 - 0.35, pw * 0.86, pw * 0.86, lib.shade(pc, 0.7))
    else:
        lib.box(b, cx - pw / 2, cy - pw / 2, ztop, cx + pw / 2, cy + pw / 2, ztop + 0.45, ws, lib.shade(pc, 0.9), skip=('bottom',))
        lib.box(b, cx - pw * 0.42, cy - pw * 0.42, ztop + 0.45, cx + pw * 0.42, cy + pw * 0.42, zp1 - 0.55, ws, pc, skip=('bottom',), scale=2.0)
        lib.box(b, cx - pw * 0.52, cy - pw * 0.52, zp1 - 0.55, cx + pw * 0.52, cy + pw * 0.52, zp1, ws, tc, top_slot=ws, skip=('bottom',))
        if det == 0:
            lib.box(b, cx - pw * 0.47, cy - pw * 0.47, zp1 - 0.7, cx + pw * 0.47, cy + pw * 0.47, zp1 - 0.55, ws, lib.shade(tc, 0.85), skip=('bottom',))
            relief_panels(b, cx, cy, ztop + 0.45, zp1 - 0.55, pw * 0.84, pw * 0.84, lib.shade(pc, 0.75))
    b.section('figure')
    fh = H - zp1
    figure(b, cx, cy, zp1, max(1.6, fh), fcol, pose, rng, 0.0)
    b.section('site')
    plaza_or_roundabout(b, lk, P, rng, pw + step_n * grow * 2, zp1)
    return H


def plaza_or_roundabout(b, lk, P, rng, base_w, base_h):
    """Setting round the monument base: a roundabout (round footprint or road forecourt) or a paved plaza with trees and lamps."""
    det = b.detail
    fe = P['fe']
    srng = random.Random(P['seed'] ^ 0x77)
    fc = lk.forecourt
    round_fp = P['fp'] == 'round'
    R = U.clamp(max(P['w'], P['d']) / 2 * 0.8, 5.0, 26.0)
    if round_fp or fc == 'road':
        R = max(R, base_w / 2 + 3.5, min(26.0, P['H'] * 0.3))
        n = 32 if det == 0 else 16
        with b.site():
            ring_out = R + 6.0
            disc(b, 0, 0, 0.0, ring_out + 3.0, 0.0, 'paving', lib.mix(lk.ground_col, '#9a968c', 0.4), n=n, scale=4.0)
            if det < 2:
                disc(b, 0, 0, R, R + 6.0, 0.04, 'asphalt', '#5a5c5f', n=n, scale=4.0)
                if det == 0:
                    for k in range(24):
                        a0 = 2 * math.pi * k / 24
                        a1 = a0 + 0.1
                        rr = R + 3.0
                        U.poly(b, [(rr * math.cos(a0), rr * math.sin(a0), 0.06), (rr * math.cos(a1), rr * math.sin(a1), 0.06), ((rr + 0.15) * math.cos(a1), (rr + 0.15) * math.sin(a1), 0.06), ((rr + 0.15) * math.cos(a0), (rr + 0.15) * math.sin(a0), 0.06)][::-1], (0, 0, 1), 'plain', '#efece4', scale=FLAT)
                disc(b, 0, 0, 0.0, R, 0.12, 'grass', '#6d9a4f' if lk.ground_slot != 'grass' else lk.ground_col, n=n, scale=2.0)
                kerb(b, 0, 0, R, 0.0, 0.18, 0.35, 'paving', '#b8b4aa', n=n)
                disc(b, 0, 0, 0.0, base_w / 2 + 2.2, 0.14, 'paving', '#cfcac0', n=n, scale=2.0)
                if R - base_w / 2 > 4.0 and lk.tree not in (None, 'none'):
                    k_ = 5 if det == 0 else 3
                    for k in range(k_):
                        a = 2 * math.pi * (k + 0.5) / k_
                        rr = (R + base_w / 2 + 2.2) / 2 + 1.5
                        lib.tree(b, lk.tree, rr * math.cos(a), rr * math.sin(a), srng.uniform(5, 8), srng, lk)
                if 'flags' in fe and det == 0:
                    for k in range(4):
                        a = 2 * math.pi * k / 4 + math.pi / 4
                        U.flag(b, (base_w / 2 + 3.2) * math.cos(a), (base_w / 2 + 3.2) * math.sin(a), 9.0, ['#1f7a4d', '#f2f2ee', '#b83a32', '#2f5fa0'][k], col2='#f2f2ee', yaw=0.0)
        if ('railings' in fe or 'fence-wall' in fe) and det < 2:
            n_r = 16 if det == 0 else 8
            rr = base_w / 2 + 2.2
            for k in range(n_r):
                a0, a1 = 2 * math.pi * k / n_r, 2 * math.pi * (k + 1) / n_r
                if k == n_r // 4 * 3:      # gap facing the camera? keep a gap at -Y for the approach
                    continue
                U.railing(b, (rr * math.cos(a0), rr * math.sin(a0)), (rr * math.cos(a1), rr * math.sin(a1)), 1.0)
        return
    # square plaza
    S = U.clamp(max(P['w'], P['d']) * 1.3 + 12.0, 22.0, 64.0)
    with b.site():
        lib.ground(b, -S / 2, -S / 2, S / 2, S / 2, lk, 'paving', lib.mix(lk.ground_col, '#b9b4aa', 0.5) if lk.ground_slot != 'paving' else '#bdb7ab', z=0.0, scale=3.0)
        if det < 2:
            m = 1.4
            for (a0, b0, a1, b1) in ((-S / 2, -S / 2, S / 2, -S / 2 + m), (-S / 2, S / 2 - m, S / 2, S / 2), (-S / 2, -S / 2, -S / 2 + m, S / 2), (S / 2 - m, -S / 2, S / 2, S / 2)):
                b.face([(a0, b0, 0.03), (a1, b0, 0.03), (a1, b1, 0.03), (a0, b1, 0.03)], 'paving', lib.shade(lk.stone_col, 0.8), scale=2.0)
            lib.ground(b, -base_w / 2 - 3.5, -base_w / 2 - 3.5, base_w / 2 + 3.5, base_w / 2 + 3.5, lk, 'paving', '#d6d1c6', z=0.05, scale=1.0)
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for (sx, sy) in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
                lib.tree(b, lk.tree, sx * (S / 2 - 4.0), sy * (S / 2 - 4.0), srng.uniform(6, 9), srng, lk)
            if det == 0:
                for sx in (-1, 1):
                    lib.lamp(b, sx * (S / 2 - 3.0), -S / 2 + 3.0, 5.0, lk)
    if 'flags' in fe and det < 2:
        with b.site():
            k = 4
            for q in range(k):
                x = -S / 2 * 0.7 + S * 0.7 * q / (k - 1)
                U.flag(b, x, -S / 2 + 5.5, 9.0, ['#1f7a4d', '#f2f2ee', '#b83a32', '#2f5fa0'][q % 4], col2='#f2f2ee', yaw=0.0)
    if ('railings' in fe or 'fence-wall' in fe) and det < 2:
        rr = base_w / 2 + 3.5
        pts = [(-rr, -rr), (rr, -rr), (rr, rr), (-rr, rr)]
        for i in range(4):
            if i == 0:
                continue
            U.railing(b, pts[i], pts[(i + 1) % 4], 1.0)
        U.railing(b, pts[0], (-2.0, -rr), 1.0)
        U.railing(b, (2.0, -rr), pts[1], 1.0)


# ------------------------------------------------------------------------------------------------------------------ obelisk
def build_obelisk(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    H = P['H']
    W = max(P['w'], P['d'])
    ws, wc, tc = stone_look(lk, P)
    nm = P['nm'] + ' ' + tx
    brutal = P['fp'] == 'round' and (P['style'] in ('brutalist', 'modernist', 'contemporary') or lk.wall_material in ('concrete', 'exposed-concrete')) and not U.has(nm, 'obelisk')
    sword = U.has(P['nm'], 'sword') or U.has(tx, 'upturned sword', 'sword-shaped')
    step_n = 3 if H > 8 else 2
    sh = 0.32 if H < 20 else 0.45
    base_w = U.clamp(0.16 * H + 2.0, 2.0, 11.0) if not brutal else U.clamp(W * 0.55, 6, 12)
    grow = 0.7 if H < 20 else 1.1
    b.section('base')
    ztop = stepped_base(b, 0, 0, base_w, base_w, step_n, sh, grow, ws if det < 2 else 'plain', lib.shade(lk.wall_col, 0.92), round_=brutal)
    b.section('shaft')
    if sword:
        _blade(b, lk, P, ztop, H - ztop, base_w)
        top_h = H
    elif brutal:
        top_h = _brutal_pylon(b, lk, P, rng, ztop, H, base_w)
    else:
        ped = H * 0.2
        lib.box(b, -base_w / 2, -base_w / 2, ztop, base_w / 2, base_w / 2, ztop + ped, ws, lk.wall_col, top_slot=ws, skip=('bottom',), scale=2.0)
        if det < 2:
            lib.box(b, -base_w * 0.55, -base_w * 0.55, ztop + ped - 0.35, base_w * 0.55, base_w * 0.55, ztop + ped, ws, lk.trim_col, skip=('bottom',))
        if det == 0 and ('relief-pattern' in fe or 'statue' in fe or 'painted-mural' in fe):
            relief_panels(b, 0, 0, ztop, ztop + ped - 0.35, base_w * 0.86, base_w * 0.86, lib.shade(lk.wall_col, 0.72))
        z0 = ztop + ped
        shaft_h = (H - z0) * 0.9
        w0, w1 = base_w * 0.62, base_w * 0.36
        frustum_box(b, 0, 0, z0, z0 + shaft_h, w0, w0, w1, w1, ws, lk.wall_col, skip=('bottom', 'top'), scale=2.5)
        pyr = (H - z0) - shaft_h
        frustum_box(b, 0, 0, z0 + shaft_h, H, w1, w1, 0.01, 0.01, 'plain', lk.trim_col, skip=('bottom', 'top'), scale=FLAT)
        if det == 0:
            for k in range(1, 4):
                zz = z0 + shaft_h * k / 4
                ww = U.lerp(w0, w1, k / 4) + 0.12
                lib.box(b, -ww / 2, -ww / 2, zz - 0.06, ww / 2, ww / 2, zz + 0.06, ws, lk.trim_col, skip=('bottom',))
        top_h = H
    # figures
    b.section('figures')
    srng = random.Random(P['seed'])
    if 'statue' in fe and det < 2:
        fh = U.clamp(H * 0.2, 2.2, 6.0)
        if U.has(nm, 'eagle', 'crowned by'):
            # bird of prey crowning the top: simple faceted body with spread wings
            _bird(b, 0, 0, top_h, fh * 0.45, BRONZE)
        else:
            col = BRONZE if not U.has(nm, 'white') else '#f1efe8'
            for sx in (-1, 1):
                figure(b, sx * (base_w * 0.5 + 0.9), -base_w * 0.2, 0.0, fh * 0.9, col, 'stand' if sx < 0 else 'raised', srng, 0.0)
    if 'fountain' in fe:
        _fountain(b, lk, base_w * 0.5 + grow * step_n + 5.5, 5.0)
    b.section('site')
    plaza_or_roundabout(b, lk, P, rng, base_w + grow * step_n * 2, ztop)
    return H


def _blade(b, lk, P, z0, h, base_w):
    """The upturned-sword mausoleum: a tall flat blade tapering to a point, with a cross-guard at its foot."""
    w0, th = base_w * 0.95, base_w * 0.2
    col = lk.wall_col
    zb = z0 + h * 0.12
    # guard
    lib.box(b, -base_w * 1.3, -th * 0.9, z0, base_w * 1.3, th * 0.9, z0 + h * 0.05, lk.wall_slot, lk.trim_col, skip=('bottom',))
    # blade: two faces of a six-point profile, with a thin mid ridge
    prof = [(-w0 / 2, 0.0), (w0 / 2, 0.0), (w0 * 0.55, h * 0.55), (0.0, h * 0.97), (-w0 * 0.55, h * 0.55)]
    zz = z0 + h * 0.05
    f = [(x, zz + z * 0.95) for x, z in prof]
    for sgn, hint in ((-1, (0, -1, 0)), (1, (0, 1, 0))):
        ridge = (0.0, sgn * th / 2, zz + h * 0.45)
        pts = [(x, sgn * th * 0.3, z) for x, z in f]
        b.facing([pts[0], pts[1], (pts[1][0], sgn * th * 0.3, pts[1][1]), ], hint, 'plain', col, scale=FLAT) if False else None
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            tri = [(pts[i][0], pts[i][1], pts[i][2]), (pts[j][0], pts[j][1], pts[j][2]), (0.0, sgn * th * 0.5, zz + h * 0.4)]
            b.facing(tri, (0, sgn, 0.0) if (i not in (0,)) else (0, sgn, -0.3), 'plain-render' if b.detail < 2 else 'plain', col if (i % 2 == 0) else lib.shade(col, 0.9), scale=3.0)


def _brutal_pylon(b, lk, P, rng, z0, H, base_w):
    """Tall faceted round tower, tapering, with ring slabs per storey (the 'storeys' of the brief) and a flared crown."""
    n_side = 8 if b.detail < 2 else 6
    st = max(3, int(P.get('storeys') or 6))
    rings = max(4, min(10, int(U.num({'x': P['H']}, 'x', 20) / 4)))
    r0, r1 = base_w * 0.5, base_w * 0.28
    ws = lk.wall_slot
    prof = [(r0, z0), (r1, H - 4.0)]
    U.revolve(b, 0, 0, prof, n_side, ws if b.detail < 2 else 'plain', lk.wall_col, smooth_=False, scale=3.0)
    if b.detail < 2:
        for k in range(1, rings + 1):
            z = z0 + (H - 4.0 - z0) * k / (rings + 1)
            r = U.lerp(r0, r1, (z - z0) / (H - 4.0 - z0))
            prof2 = [(r, z - 0.3), (r + 0.55, z - 0.1), (r + 0.55, z + 0.2), (r, z + 0.3)]
            if b.detail == 0:
                U.revolve(b, 0, 0, prof2 + [(r - 0.1, z + 0.3)], n_side, ws, lk.trim_col, smooth_=False)
    crown = [(r1, H - 4.0), (r1 * 1.55, H - 2.4), (r1 * 1.55, H - 0.6), (r1 * 1.2, H), (0.0, H)]
    U.revolve(b, 0, 0, crown, n_side, ws if b.detail < 2 else 'plain', lk.trim_col, smooth_=False, scale=3.0)
    if b.detail < 2:
        U.revolve(b, 0, 0, [(r1 * 0.2, H), (r1 * 0.2, H + 3.5)], 4, 'frame', lk.metal_col, smooth_=False)
    return H + 3.5


def _bird(b, x, y, z, s, col):
    body = [(s * 0.22, 0.0), (s * 0.3, s * 0.5), (s * 0.12, s * 1.0), (0.0, s * 1.12)]
    U.revolve(b, x, y, body, 5, 'plain', col, smooth_=False, z0=z)
    for sgn in (-1, 1):
        pts = [(x + sgn * s * 0.15, y, z + s * 0.9), (x + sgn * s * 1.4, y, z + s * 1.2), (x + sgn * s * 1.2, y, z + s * 0.5), (x + sgn * s * 0.2, y, z + s * 0.45)]
        b.face(pts, 'plain', col, scale=FLAT)
        b.face(pts[::-1], 'plain', lib.shade(col, 0.85), scale=FLAT)


def _fountain(b, lk, r, h):
    if b.detail >= 2:
        return
    n = 24 if b.detail == 0 else 12
    with b.site():
        U.revolve(b, 0, 0, [(r, 0.0), (r, 0.7), (r - 0.5, 0.7), (r - 0.5, 0.45)], n, 'paving', '#cfcac0', smooth_=False)
        disc(b, 0, 0, 0.0, r - 0.5, 0.5, 'plain', '#5f98b3', n=n, scale=FLAT)


# --------------------------------------------------------------------------------------------------------------------- arch
def arch_curve(kind, xc, span, zs, rise, n):
    """Points (x, z) of an arch head from the left springing to the right springing."""
    pts = []
    if kind == 'rect':
        return [(xc - span / 2, zs + rise), (xc + span / 2, zs + rise)]
    if kind == 'pointed':
        R = span
        for k in range(n + 1):
            t = k / n
            if t <= 0.5:
                a = math.pi - (math.pi / 3) * (t * 2)
                pts.append((xc + span / 2 + R * math.cos(a) - 0.0, zs + R * math.sin(a)))
            else:
                a = math.pi - (math.pi / 3) * ((1 - t) * 2)
                pts.append((xc - span / 2 - R * math.cos(a), zs + R * math.sin(a)))
        pts = [(x, z) for x, z in pts]
        # normalise: left to right
        pts.sort(key=lambda p: p[0])
        top = max(z for _, z in pts)
        sc = rise / max(1e-6, top - zs)
        return [(x, zs + (z - zs) * sc) for x, z in pts]
    if kind == 'parabolic':
        return [(xc - span / 2 + span * k / n, zs + rise * (1 - (2.0 * k / n - 1.0) ** 2)) for k in range(n + 1)]
    for k in range(n + 1):  # round
        a = math.pi * (1 - k / n)
        pts.append((xc + math.cos(a) * span / 2, zs + math.sin(a) * rise))
    return pts


def arch_block(b, x0, x1, y0, y1, H, openings, slot, col, top_col, trim_col, batter=0.0, n_curve=10, jamb_col=None, scale=2.0):
    """A block with arched openings through it along Y. openings: list of dict(xc, span, zs, rise, kind). batter: the front/back faces lean
    inwards by this much at the top. The block is solid concrete / masonry: front and back faces carry the openings as holes."""
    det = b.detail
    nc = n_curve if det == 0 else (6 if det == 1 else 4)
    fy = lambda z, side: (y0 + batter * z / H) if side == 0 else (y1 - batter * z / H)
    fx = lambda x, z: x
    holes_f, holes_b = [], []
    curves = []
    for op in openings:
        c = arch_curve(op['kind'], op['xc'], op['span'], op['zs'], op['rise'], nc)
        curves.append(c)
        ring = [(op['xc'] - op['span'] / 2, 0.0)] + c + [(op['xc'] + op['span'] / 2, 0.0)]
        ring = [(c[0][0], 0.0)] + c + [(c[-1][0], 0.0)]
        holes_f.append([(x, fy(z, 0), z) for x, z in ring][::-1])
        holes_b.append([(x, fy(z, 1), z) for x, z in ring])
    xb0, xb1 = x0 + batter * 0.0, x1
    outer_f = [(x0, fy(0, 0), 0.0), (x1, fy(0, 0), 0.0), (x1 - batter, fy(H, 0), H), (x0 + batter, fy(H, 0), H)]
    outer_b = [(x1, fy(0, 1), 0.0), (x0, fy(0, 1), 0.0), (x0 + batter, fy(H, 1), H), (x1 - batter, fy(H, 1), H)]
    # CCW seen from the outside: front (-Y) face: left-bottom -> right-bottom -> right-top -> left-top
    U.poly_holes(b, [outer_f] + [h[::-1] if False else h for h in holes_f], (0, -1, 0), slot, col, scale=scale)
    U.poly_holes(b, [outer_b] + holes_b, (0, 1, 0), slot, col, scale=scale)
    # sides and top
    b.facing([(x0, fy(0, 0), 0), (x0, fy(0, 1), 0), (x0 + batter, fy(H, 1), H), (x0 + batter, fy(H, 0), H)], (-1, 0, 0), slot, col, scale=scale)
    b.facing([(x1, fy(0, 1), 0), (x1, fy(0, 0), 0), (x1 - batter, fy(H, 0), H), (x1 - batter, fy(H, 1), H)], (1, 0, 0), slot, col, scale=scale)
    b.facing([(x0 + batter, fy(H, 0), H), (x1 - batter, fy(H, 0), H), (x1 - batter, fy(H, 1), H), (x0 + batter, fy(H, 1), H)], (0, 0, 1), 'roof-flat', top_col, scale=3.0)
    # intrados + jambs
    jc = jamb_col or lib.shade(col, 0.82)
    for op, c in zip(openings, curves):
        ring = [(c[0][0], 0.0)] + c + [(c[-1][0], 0.0)]
        cx_ = op['xc']
        cz_ = op['zs'] + op['rise'] * 0.4
        for (xa, za), (xc2, zc2) in zip(ring[:-1], ring[1:]):
            if abs(xc2 - xa) < 1e-6 and abs(zc2 - za) < 1e-6:
                continue
            mid = ((xa + xc2) / 2, (za + zc2) / 2)
            hint = (cx_ - mid[0], 0.0, cz_ - mid[1])
            b.facing([(xa, fy(za, 0), za), (xc2, fy(zc2, 0), zc2), (xc2, fy(zc2, 1), zc2), (xa, fy(za, 1), za)], hint, 'plain', jc, scale=FLAT)
    return curves


def archivolt(b, curves, openings, yface, side, w, proud, col, slot='plain-render'):
    """A moulding band round each opening on the front face (side = -1 front, +1 back)."""
    if b.detail >= 1:
        return
    for op, c in zip(openings, curves):
        if op['kind'] == 'rect':
            continue
        outer = []
        for (x, z) in c:
            dx, dz = x - op['xc'], z - op['zs']
            L = math.hypot(dx, dz) or 1
            outer.append((x + dx / L * w, z + dz / L * w))
        for i in range(len(c) - 1):
            q = [(c[i][0], yface + side * proud * 0.0, c[i][1]), (c[i + 1][0], yface, c[i + 1][1]), (outer[i + 1][0], yface - side * proud, outer[i + 1][1]), (outer[i][0], yface - side * proud, outer[i][1])]
            b.facing(q, (0, side, 0), slot, col, scale=FLAT)


def build_arch(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    nm = P['nm']
    srng = random.Random(P['seed'])
    W, D, H = max(4.0, P['w']), max(2.5, P['d']), P['H']
    n_op = max(1, min(5, fe.get('arches', {}).get('count', 1) if 'arches' in fe else 1))
    if U.has(nm, 'three'):
        n_op = max(n_op, 3)
    mud = lk.wall_material in ('mud-render', 'laterite') or P['style'] in ('hausa-arewa', 'sahelian')
    pillar = U.has(tx, 'inverted', 'legs')
    wide = W > 60
    if wide:
        W_blk = U.clamp(W * 0.32, 14, 28)
        D = min(D, 12.0)
    else:
        W_blk = W
    ws, wc, tc = stone_look(lk, P)
    kind = 'pointed' if (mud and srng.random() < 0.4) else ('parabolic' if (P['style'] == 'modernist' and H > 15 and not mud) else 'round')
    if pillar:
        kind = 'parabolic'
    if mud:
        kind = 'round' if srng.random() < 0.6 else 'pointed'
    if P['style'] in ('contemporary', 'modernist') and H < 10 and not mud:
        kind = srng.choice(['round', 'rect'])
    zs_frac = 0.55
    ops = []
    pier = U.clamp(W_blk * (0.14 if n_op == 1 else 0.1), 1.6, 5.0)
    if n_op == 1:
        span = W_blk - 2 * pier
        span = U.clamp(span, 2.5, W_blk * 0.7)
        rise_total = U.clamp(H * 0.62, 2.0, H - 1.6)
        zs = rise_total * (0.5 if kind != 'rect' else 0.0)
        ops.append({'xc': 0.0, 'span': span, 'zs': zs if kind != 'rect' else 0.0, 'rise': rise_total - zs if kind != 'rect' else rise_total, 'kind': kind})
    else:
        # central opening largest; side openings smaller
        spans = []
        total = W_blk - pier * (n_op + 1)
        weights = [1.0] * n_op
        if n_op >= 3:
            weights = [0.62 if i not in (n_op // 2,) else 1.0 for i in range(n_op)]
        s = sum(weights)
        spans = [total * w_ / s for w_ in weights]
        x = -W_blk / 2 + pier
        for i, sp in enumerate(spans):
            xc = x + sp / 2
            big = (i == n_op // 2)
            rt = H * (0.7 if big else 0.5)
            zs = rt * 0.5 if kind != 'rect' else 0.0
            ops.append({'xc': xc, 'span': sp, 'zs': zs, 'rise': (rt - zs) if kind != 'rect' else rt, 'kind': kind})
            x += sp + pier
    batter = 0.35 if mud else 0.0
    b.section('block')
    blk_H = H * (0.88 if (not mud and not pillar) else 0.9 if mud else 0.97)
    # steps / podium in front
    if 'steps' in fe and not mud and det < 2:
        with b.site():
            lib.steps(b, -W_blk / 2 - 2, W_blk / 2 + 2, -D / 2, 0.9, 2.6, 3 if det == 0 else 2, 'paving', lk.stone_col)
    curves = arch_block(b, -W_blk / 2, W_blk / 2, -D / 2, D / 2, blk_H, ops, ws, wc, lk.roof_col if not mud else wc, tc, batter=batter, scale=2.5 if not mud else 2.0)
    yfront = -D / 2
    b.section('detail')
    if det == 0 and not mud:
        archivolt(b, curves, ops, yfront, -1, 0.45, 0.22, tc)
    # attic / crown
    top = blk_H
    if mud:
        _mud_gate_details(b, lk, P, srng, W_blk, D, blk_H, batter, ops)
    else:
        att_h = H - blk_H
        if att_h > 0.5:
            lib.box(b, -W_blk / 2 * 0.98, -D / 2 * 0.98, blk_H, W_blk / 2 * 0.98, D / 2 * 0.98, H, ws, tc, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
            top = H
        elif det < 2:
            lib.box(b, -W_blk / 2 - 0.25, -D / 2 - 0.25, blk_H - 0.45, W_blk / 2 + 0.25, D / 2 + 0.25, blk_H, ws, tc, top_slot='roof-flat', top_col=tc, skip=('bottom',))
        # star / crest / flag masts
        has_star = U.has(tx, 'star') or U.has(nm, 'independence', 'black star')
        if has_star and det < 2:
            sr = U.clamp(W_blk * 0.12, 1.2, 4.0)
            pts = U.star_pts(0.0, 0.0, sr, sr * 0.4)
            ys = -0.3
            q = [(x, ys, top + sr * 0.2 + y_) for x, y_ in pts]
            U.poly(b, q, (0, -1, 0), 'plain', '#26282b', scale=FLAT)
            U.poly(b, q[::-1], (0, 1, 0), 'plain', '#26282b', scale=FLAT)
        elif det < 2 and ('flags' in fe or 'arches' in fe):
            # blank crest board at the centre of the top
            lib.obox(b, 0, -D / 2 - 0.1, top + 0.0, min(6.0, W_blk * 0.25), 0.4, min(3.4, H * 0.16), 0.0, 'plain', lib.mix(tc, '#3a3a3a', 0.5), skip=('bottom',))
        if 'flags' in fe and det < 2:
            cols = ['#1f7a4d', '#f2f2ee', '#b83a32', '#2f5fa0']
            masts = 1 if n_op == 1 and W_blk < 14 else 2
            for k in range(masts):
                x = (k - (masts - 1) / 2) * (W_blk * 0.42)
                lib.cylinder(b, x, 0, top, top + 9.0, 0.14, n=5, slot='frame', col='#c8ccd0', r_top=0.08, top=True)
                if det == 0:
                    q = [(x, 0, top + 8.9), (x + 3.4, 0, top + 8.9), (x + 3.4, 0, top + 6.9), (x, 0, top + 6.9)]
                    b.face(q, 'plain', cols[k % 4], scale=FLAT)
                    b.face(q[::-1], 'plain', cols[k % 4], scale=FLAT)
        if ('gate' in fe or 'fence-wall' in fe) and not wide:
            _gate_wings(b, lk, P, srng, W_blk, D, ops)
    if wide:
        _square_plaza(b, lk, P, srng, W, D)
    else:
        b.section('site')
        _road_and_verge(b, lk, P, srng, W_blk, D)
    return H


def _gate_wings(b, lk, P, rng, W, D, ops):
    """Fence walls with piers flanking a gate, a guard booth and a blank sign board."""
    det = b.detail
    fe = P['fe']
    ws = lk.wall_slot
    ext = U.clamp(W * 1.2, 10, 24)
    h = 2.2
    for sgn in (-1, 1):
        x0, x1 = sgn * W / 2, sgn * (W / 2 + ext)
        if det < 2:
            U.wall_run(b, (x0, 0), (x1, 0), h, 0.4, ws, lk.wall_col, cap_col=lk.trim_col, pier_every=5.0, pier_h=h + 0.6, pier_w=0.6)
        else:
            lib.box(b, min(x0, x1), -0.2, 0, max(x0, x1), 0.2, h, 'plain', lk.wall_col)
    if 'signage-board' in fe and det < 2:
        lib.sign_board(b, W / 2 + ext * 0.5, -1.4, 0.0, 4.0, 1.5, lk, 0.0, col='#2f5f8a')
    if det < 2:
        lib.box_c(b, -W / 2 - 2.8, -1.5, 0, 2.2, 2.2, 2.6, ws, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col)


def _mud_gate_details(b, lk, P, rng, W, D, H, batter, ops):
    """Hausa gatehouse: crenellated parapets, horn pinnacles on the corners and over the arch, relief panels, wall stubs."""
    det = b.detail
    col, tcol = lk.wall_col, lk.trim_col
    ws = lk.wall_slot
    fe = P['fe']
    z = H
    # parapet ring just above the block
    if det < 2:
        lib.box(b, -W / 2 + batter - 0.15, -D / 2 + batter - 0.15, z, W / 2 - batter + 0.15, D / 2 - batter + 0.15, z + 0.35, ws, col, top_slot=ws, skip=('bottom',))
        if 'crenellation' in fe or True:
            for sy in (-1, 1):
                U.crenellation(b, (-W / 2 + batter, sy * (D / 2 - batter)), (W / 2 - batter, sy * (D / 2 - batter)), z + 0.35, 0.9, 0.9, 0.7, 0.45, ws, col)
            for sx in (-1, 1):
                U.crenellation(b, (sx * (W / 2 - batter), -D / 2 + batter), (sx * (W / 2 - batter), D / 2 - batter), z + 0.35, 0.9, 0.9, 0.7, 0.45, ws, col)
    ph = U.clamp(H * 0.34, 1.2, 4.0)
    pw = U.clamp(W * 0.07, 0.7, 1.6)
    corners = [(-W / 2 + batter + pw * 0.5, -D / 2 + batter + pw * 0.5), (W / 2 - batter - pw * 0.5, -D / 2 + batter + pw * 0.5),
               (-W / 2 + batter + pw * 0.5, D / 2 - batter - pw * 0.5), (W / 2 - batter - pw * 0.5, D / 2 - batter - pw * 0.5)]
    cnt = max(4, min(8, P['fe'].get('pinnacles', {}).get('count', 4)))
    spots = list(corners)
    if cnt > 4 and W > 8:
        spots += [(0.0, -D / 2 + batter + pw * 0.5), (0.0, D / 2 - batter - pw * 0.5)]
    for (px, py) in spots[:max(4, cnt)]:
        U.pinnacle(b, px, py, z + 0.35, ph, pw * 2.0, col, ws)
    # relief panels on the front face around the arch (incised zane pattern as lighter/darker blocks)
    if det == 0:
        op = ops[len(ops) // 2]
        yf = -D / 2 + batter * (op['zs'] + op['rise']) / H - 0.04
        zt = op['zs'] + op['rise']
        dark = lib.shade(col, 0.74)
        light = lib.mix(col, '#efe7d6', 0.5)
        # frame band round the arch
        for sgn in (-1, 1):
            x0 = op['xc'] + sgn * (op['span'] / 2 + 0.25)
            b.facing([(x0, yf, 0.0), (x0 + sgn * 0.55, yf, 0.0), (x0 + sgn * 0.55, yf, zt + 0.2), (x0, yf, zt + 0.2)], (0, -1, 0), 'plain', light, scale=FLAT)
        # triangular zig-zag band across the upper face
        zb0, zb1 = zt + 0.55, min(H - 0.5, zt + 1.5)
        n = max(3, int(W / 1.4))
        if zb1 > zb0 + 0.3:
            for k in range(n):
                xa, xb_ = -W / 2 + 0.8 + (W - 1.6) * k / n, -W / 2 + 0.8 + (W - 1.6) * (k + 1) / n
                b.facing([(xa, yf, zb0), (xb_, yf, zb0), ((xa + xb_) / 2, yf, zb1)], (0, -1, 0), 'plain', dark if k % 2 == 0 else light, scale=FLAT)
        # incised knot rectangles on each pier
        for sgn in (-1, 1):
            xc = sgn * (W / 2 - (W / 2 - op['span'] / 2 - op['xc'] * 0) / 2 * 0.0 - (W / 2 - op['span'] / 2) / 2) if False else sgn * (op['span'] / 2 + (W / 2 - op['span'] / 2) / 2)
            pwid = (W / 2 - op['span'] / 2) * 0.55
            if pwid > 0.7:
                for zz0, zz1 in ((1.0, 2.4), (3.0, 4.4)):
                    if zz1 < H - 1.0:
                        b.facing([(xc - pwid / 2, yf - 0.02, zz0), (xc + pwid / 2, yf - 0.02, zz0), (xc + pwid / 2, yf - 0.02, zz1), (xc - pwid / 2, yf - 0.02, zz1)], (0, -1, 0), 'plain', dark, scale=FLAT)
                        b.facing([(xc - pwid / 4, yf - 0.03, zz0 + 0.3), (xc + pwid / 4, yf - 0.03, zz0 + 0.3), (xc + pwid / 4, yf - 0.03, zz1 - 0.3), (xc - pwid / 4, yf - 0.03, zz1 - 0.3)], (0, -1, 0), 'plain', light, scale=FLAT)
    # wall stubs
    ext = U.clamp(W * 1.1, 8, 26)
    wh = H * 0.68
    for sgn in (-1, 1):
        x0, x1 = sgn * (W / 2 - batter), sgn * (W / 2 + ext)
        lib.box(b, min(x0, x1), -D * 0.3, 0, max(x0, x1), D * 0.3, wh, ws, col, top_slot=ws, skip=('bottom',), scale=2.0)
        if det < 2:
            for sy in (-1, 1):
                U.crenellation(b, (x0, sy * D * 0.3 * 0.78), (x1, sy * D * 0.3 * 0.78), wh, 0.7, 0.8, 0.7, 0.35, ws, col)


def _square_plaza(b, lk, P, rng, W, D):
    """Black Star Square style: a paved parade ground in front of the arch with flag masts and a rostrum stand."""
    det = b.detail
    S = (U.clamp(W * 1.0, 50, 100), 46.0)
    fe = P['fe']
    with b.site():
        lib.ground(b, -S[0] / 2, -S[1] - D / 2, S[0] / 2, D / 2 + 8, lk, 'paving', lib.mix(lk.ground_col, '#b9b4aa', 0.5) if lk.ground_slot != 'paving' else '#bdb7ab', z=0.0, scale=3.0)
    if det < 2:
        with b.site():
            for k in range(7 if det == 0 else 4):
                x = -S[0] * 0.42 + S[0] * 0.84 * k / (6 if det == 0 else 3)
                U.flag(b, x, -D / 2 - 6.0, 11.0, ['#1f7a4d', '#f2f2ee', '#b83a32', '#2f5fa0'][k % 4], col2='#f2f2ee')
            if lk.tree not in (None, 'none'):
                for sx in (-1, 1):
                    for k in range(3):
                        lib.tree(b, lk.tree, sx * (S[0] / 2 - 4.0), -D / 2 - 10 - 12 * k, 8.0, rng, lk)
        if det == 0:
            lib.box(b, -S[0] * 0.2, -D / 2 - 40, 0, S[0] * 0.2, -D / 2 - 34, 1.1, lk.wall_slot, lk.trim_col, top_slot='paving', top_col=lk.stone_col, skip=('bottom',))
    # statue figure in front of the arch (liberty figure)
    if 'statue' in fe and det < 2:
        with b.site():
            lib.box(b, -1.2, -D / 2 - 12.5, 0, 1.2, -D / 2 - 10, 2.4, lk.wall_slot, lk.trim_col, skip=('bottom',))
        figure(b, 0, -D / 2 - 11.2, 2.4, 5.4, BRONZE, 'raised', rng)


def _road_and_verge(b, lk, P, rng, W, D):
    """A strip of road under the arch with grass verges and kerbs (the gate straddles it) plus trees; skipped at LOD2."""
    det = b.detail
    if det >= 2:
        return
    with b.site():
        pad = U.clamp(W * 2.2, 40, 90)
        lib.ground(b, -pad / 2, -26, pad / 2, 26, lk, 'grass' if lk.ground_slot != 'laterite' else lk.ground_slot, '#6d9a4f' if lk.ground_slot != 'laterite' else None, z=0.0, scale=3.0)
        lib.ground(b, -W * 0.28, -26, W * 0.28, 26, lk, 'asphalt', '#5a5c5f', z=0.04, scale=3.0)
        if det == 0:
            for k in range(7):
                y = -21 + 6 * k
                b.face([(-0.12, y, 0.06), (0.12, y, 0.06), (0.12, y + 3, 0.06), (-0.12, y + 3, 0.06)], 'plain', '#efece4', scale=FLAT)
        for sy in (-1, 1):
            for sx in (-1, 1):
                if lk.tree not in (None, 'none') and (det == 0 or sy == -1):
                    lib.tree(b, lk.tree, sx * (W * 0.5 + 8), sy * 14, 7.5, rng, lk)


# --------------------------------------------------------------------------------------------------------------------- tower
def build_tower(b, brief, lk, P, rng):
    det = b.detail
    fe, tx, nm = P['fe'], P['tx'], P['nm']
    srng = random.Random(P['seed'])
    H, W = P['H'], max(P['w'], P['d'])
    ws, wc, tc = stone_look(lk, P)
    style = P['style']
    sah = style in ('sahelian', 'hausa-arewa') or lk.wall_material in ('mud-render',) and (P['roof'] == 'pyramidal' or 'minaret' in nm or 'toron-beams' in fe)
    clock = U.has(nm + ' ' + tx, 'clock')
    modern = style in ('modernist', 'contemporary', 'brutalist', 'high-tech') and H > 22 and not clock
    if sah or U.has(nm, 'minaret'):
        _tower_conical(b, lk, P, srng, H, max(P['w'], P['d']))
        top = H
    elif modern:
        top = _tower_pylon(b, lk, P, srng, H, W)
    else:
        top = _tower_square(b, lk, P, srng, H, W, clock)
    b.section('site')
    base = max(W, 4.0) + 3.0
    plaza_or_roundabout(b, lk, P, srng, base, 0.0)
    return top


def _tower_square(b, lk, P, rng, H, W, clock):
    det = b.detail
    fe = P['fe']
    ws, wc, tc = stone_look(lk, P)
    w0 = U.clamp(W, 2.5, 9.0)
    storeys = max(3, int(P.get('storeys') or 0) or int(H / 3.6))
    plinth_h = min(1.8, H * 0.1)
    deck_h = U.clamp(H * 0.09, 1.4, 3.0)
    shaft_top = H - deck_h - (H * 0.12 if (clock or P['style'] in ('neoclassical', 'victorian', 'georgian')) else 0.0)
    cap = 'hip' if (clock or P['style'] in ('colonial', 'victorian', 'georgian', 'neoclassical')) else 'flat'
    if not clock and P['style'] in ('colonial',) and H < 24:
        cap = 'flat'
    taper = 0.88
    b.section('shaft')
    lib.box(b, -w0 * 0.58, -w0 * 0.58, 0, w0 * 0.58, w0 * 0.58, plinth_h, ws, lib.shade(wc, 0.85), top_slot=ws, skip=('bottom',), scale=2.0)
    frustum_box(b, 0, 0, plinth_h, shaft_top, w0, w0, w0 * taper, w0 * taper, ws, wc, skip=('bottom', 'top'), scale=2.5)
    wt = w0 * taper
    if det == 0:
        # belt courses and slit windows per storey
        n = storeys
        for k in range(1, n):
            z = plinth_h + (shaft_top - plinth_h) * k / n
            ww = U.lerp(w0, wt, (z - plinth_h) / (shaft_top - plinth_h)) + 0.14
            lib.box(b, -ww / 2, -ww / 2, z - 0.1, ww / 2, ww / 2, z + 0.1, ws, tc, skip=('bottom',))
        for k in range(n):
            z0 = plinth_h + (shaft_top - plinth_h) * (k + 0.5) / n
            ww = U.lerp(w0, wt, (z0 - plinth_h) / (shaft_top - plinth_h))
            hh = 0.9
            for (nx, ny, off) in ((0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0)):
                if k == 0 and ny == -1:
                    continue
                ex = nx * (ww / 2 + 0.03)
                ey = ny * (ww / 2 + 0.03)
                if nx == 0:
                    pts = [(-0.22, ey, z0 - hh / 2), (0.22, ey, z0 - hh / 2), (0.22, ey, z0 + hh / 2), (-0.22, ey, z0 + hh / 2)]
                else:
                    pts = [(ex, -0.22, z0 - hh / 2), (ex, 0.22, z0 - hh / 2), (ex, 0.22, z0 + hh / 2), (ex, -0.22, z0 + hh / 2)]
                b.facing(pts, (nx, ny, 0), 'plain', '#27292d', scale=FLAT)
        # arched door on the front
        dw, dh = min(1.5, w0 * 0.34), min(2.6, shaft_top * 0.14)
        pts = [(-dw / 2, -w0 / 2 - 0.03, plinth_h)] + [(math.cos(math.pi * (1 - k / 6)) * dw / 2, -w0 / 2 - 0.03, plinth_h + dh - dw / 2 + math.sin(math.pi * (1 - k / 6)) * dw / 2) for k in range(7)] + [(dw / 2, -w0 / 2 - 0.03, plinth_h)]
        U.poly(b, [pts[0]] + pts[-1:] + pts[1:-1][::-1], (0, -1, 0), 'plain', '#30241c', scale=FLAT)
    b.section('deck')
    # corbelled deck with merlons / parapet
    wd = wt * 1.28
    zt0 = shaft_top
    lib.box(b, -wd / 2, -wd / 2, zt0, wd / 2, wd / 2, zt0 + deck_h * 0.45, ws, tc, skip=('bottom',))
    if cap == 'flat':
        lib.box(b, -wd / 2, -wd / 2, zt0 + deck_h * 0.45, wd / 2, wd / 2, zt0 + deck_h * 0.8, ws, wc, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
        if det < 2:
            for (p0, p1) in (((-wd / 2 + 0.3, -wd / 2 + 0.3), (wd / 2 - 0.3, -wd / 2 + 0.3)), ((wd / 2 - 0.3, -wd / 2 + 0.3), (wd / 2 - 0.3, wd / 2 - 0.3)),
                             ((wd / 2 - 0.3, wd / 2 - 0.3), (-wd / 2 + 0.3, wd / 2 - 0.3)), ((-wd / 2 + 0.3, wd / 2 - 0.3), (-wd / 2 + 0.3, -wd / 2 + 0.3))):
                U.crenellation(b, p0, p1, zt0 + deck_h * 0.8, 0.8, 0.7, 0.55, 0.4, ws, wc)
    else:
        # clock chamber + hip cap
        ch = H * 0.12
        frustum_box(b, 0, 0, zt0 + deck_h * 0.45, zt0 + deck_h * 0.45 + ch, wd * 0.8, wd * 0.8, wd * 0.8, wd * 0.8, ws, wc, skip=('bottom', 'top'), scale=2.5)
        zc = zt0 + deck_h * 0.45
        lib.box(b, -wd * 0.46, -wd * 0.46, zc + ch, wd * 0.46, wd * 0.46, zc + ch + 0.3, ws, tc, skip=('bottom',))
        if clock and det < 2:
            for (nx, ny) in ((0, -1), (1, 0), (0, 1), (-1, 0)):
                cx_, cy_ = nx * (wd * 0.4 + 0.06), ny * (wd * 0.4 + 0.06)
                rr = wd * 0.26
                zc2 = zc + ch * 0.5
                pts = [(cx_ + (-ny if nx == 0 else 0) * 0 + (math.cos(a) * rr * (1 if nx == 0 else 0)), cy_ + (math.cos(a) * rr * (1 if ny == 0 else 0)), zc2 + math.sin(a) * rr) for a in [2 * math.pi * k / (14 if det == 0 else 8) for k in range(14 if det == 0 else 8)]]
                U.poly(b, pts, (nx, ny, 0), 'plain', '#f4f2ea', scale=FLAT)
                if det == 0:
                    pts2 = [(cx_ + nx * 0.02 + (math.cos(a) * rr * 0.12 * (1 if nx == 0 else 0)), cy_ + ny * 0.02 + (math.cos(a) * rr * 0.12 * (1 if ny == 0 else 0)), zc2 + math.sin(a) * rr * 0.12) for a in [2 * math.pi * k / 6 for k in range(6)]]
                    U.poly(b, pts2, (nx, ny, 0), 'plain', '#222222', scale=FLAT)
        z_roof = zc + ch + 0.3
        lib.hip(b, (-wd * 0.5, -wd * 0.5, wd * 0.5, wd * 0.5), z_roof, max(2.2, wd * 1.25), lk, ov=0.4)
        if det < 2:
            lib.cylinder(b, 0, 0, z_roof + max(2.2, wd * 1.25), z_roof + max(2.2, wd * 1.25) + 1.8, 0.07, n=4, slot='frame', col=lk.metal_col, r_top=0.03, top=True)
    return H


def _tower_conical(b, lk, P, rng, H, W):
    """Sahelian mud-brick tapering tower with rings of projecting toron beams and a stepped parapet."""
    det = b.detail
    r0 = U.clamp(max(W, 4.0) / 2, 2.0, 5.0)
    r1 = r0 * 0.45
    n = 14 if det == 0 else (9 if det == 1 else 6)
    ws = lk.wall_slot
    plinth = 0.5
    prof = [(r0 * 1.12, 0.0), (r0 * 1.12, plinth), (r0, plinth), (r1, H - 0.9), (r1 * 1.12, H - 0.9), (r1 * 1.12, H - 0.2)]
    U.revolve(b, 0, 0, prof, n, ws if det < 2 else 'plain', lk.wall_col, smooth_=True, scale=2.5)
    # top: shallow platform with a pinnacle crown
    U.revolve(b, 0, 0, [(r1 * 1.12, H - 0.2), (r1 * 0.4, H - 0.2), (r1 * 0.4, H + 0.2)], n, 'plain', lk.wall_col, smooth_=False, scale=FLAT)
    if det < 2:
        U.pinnacle(b, 0, 0, H - 0.2, H * 0.12 + 0.6, r1 * 0.9, lk.wall_col, ws)
    if det == 0:
        # toron beams: short palm-wood poles projecting in rings (every ~1.9 m), 8 per ring
        rings = max(3, int((H - 2.0) / 1.9))
        for k in range(rings):
            z = 1.3 + (H - 3.0) * k / max(1, rings - 1)
            r = U.lerp(r0, r1, (z - plinth) / (H - 0.9 - plinth))
            cnt = 8
            for q in range(cnt):
                a = 2 * math.pi * (q + (0.5 if k % 2 else 0.0)) / cnt
                p0 = (r * math.cos(a), r * math.sin(a), z)
                p1 = ((r + 0.7) * math.cos(a), (r + 0.7) * math.sin(a), z + 0.04)
                U.strut(b, p0, p1, 0.13, '#5c4631', slot='timber')
        # arched door
        dw = 0.9
        pts = [(-dw / 2, -r0 - 0.02, plinth)] + [(math.cos(math.pi * (1 - k / 6)) * dw / 2, -r0 - 0.02, plinth + 1.5 + math.sin(math.pi * (1 - k / 6)) * dw / 2) for k in range(7)] + [(dw / 2, -r0 - 0.02, plinth)]
        U.poly(b, [pts[0]] + pts[-1:] + pts[1:-1][::-1], (0, -1, 0), 'plain', '#2a1f18', scale=FLAT)
    else:
        pass


def _tower_pylon(b, lk, P, rng, H, W):
    """A modern lookout: a slim tapered concrete shaft, an observation pod (flared drum) and a mast."""
    det = b.detail
    ws, wc, tc = stone_look(lk, P)
    w0 = U.clamp(W * 0.6, 3.5, 9.0)
    pod_z = H * 0.78
    pod_r = U.clamp(w0 * 1.5, 4.0, 11.0)
    frustum_box(b, 0, 0, 0, pod_z, w0, w0, w0 * 0.55, w0 * 0.55, ws, wc, skip=('bottom', 'top'), scale=3.0)
    n = 16 if det == 0 else 8
    pr = [(w0 * 0.4, pod_z - 1.6), (pod_r, pod_z), (pod_r, pod_z + 2.4), (pod_r * 0.8, pod_z + 3.2), (0.0, pod_z + 3.2)]
    U.revolve(b, 0, 0, pr, n, ws if det < 2 else 'plain', tc, smooth_=False, scale=3.0)
    if det == 0:
        U.revolve(b, 0, 0, [(pod_r + 0.02, pod_z + 0.45), (pod_r + 0.02, pod_z + 1.95)], n, 'glass-ribbon', lk.glass_col, smooth_=False)
    U.revolve(b, 0, 0, [(0.35, pod_z + 3.2), (0.1, H)], 6 if det < 2 else 4, 'frame', lk.metal_col, smooth_=False)
    return H


# ----------------------------------------------------------------------------------------------------------------------- hall
def build_hall(b, brief, lk, P, rng):
    det = b.detail
    fe, tx, nm = P['fe'], P['tx'], P['nm']
    srng = random.Random(P['seed'])
    W, D, H = P['w'], P['d'], P['H']
    cl = P['style'] in ('neoclassical', 'colonial', 'georgian', 'baroque') or 'portico' in fe or 'colonnade' in fe
    ws, wc, tc = stone_look(lk, P)
    enclosure = U.has(nm + tx, 'enclosure', 'walled', 'compound') or ('fence-wall' in fe and 'gate' in fe and H < 8)
    wb = U.clamp(min(W, 28.0) * (0.62 if not enclosure else 0.4), 6.0, 24.0)
    db = U.clamp(min(D, 24.0) * (0.55 if not enclosure else 0.4), 5.0, 18.0)
    hb = U.clamp(H, 3.5, 20.0)
    pod_h = 1.2 if cl else 0.8
    b.section('podium')
    # podium + steps
    lib.box(b, -wb / 2 - 3.0, -db / 2 - 4.5, 0, wb / 2 + 3.0, db / 2 + 3.0, pod_h, ws, lib.shade(lk.stone_col, 0.95), top_slot='paving', top_col=lk.stone_col, skip=('bottom',), scale=3.0)
    if det < 2:
        with b.site():
            lib.steps(b, -min(wb * 0.4, 7.0), min(wb * 0.4, 7.0), -db / 2 - 4.5, pod_h, 2.4, 4 if det == 0 else 2, 'paving', lk.stone_col)
    b.section('block')
    lib.box(b, -wb / 2, -db / 2, pod_h, wb / 2, db / 2, pod_h + hb, ws, wc, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',), scale=2.5)
    zt = pod_h + hb
    if det < 2:
        lib.sweep(b, lib.fp_rect(wb, db), zt - 0.45, [(0, 0), (0.35, 0), (0.35, 0.3), (0.5, 0.45), (0, 0.45)], ws, tc)
    if cl:
        cols = max(4, min(8, int(wb / 3.0)))
        lib.portico(b, 0, -db / 2, pod_h, min(wb * 0.7, 18.0), 3.6 if det < 2 else 3.0, hb * 0.92, lk, cols=cols, pediment=(P['style'] in ('neoclassical', 'georgian', 'colonial') or 'pediment' in fe), steps_n=0, rise=min(2.4, wb * 0.08))
        if P['roof'] in ('pyramidal', 'hip'):
            lib.hip(b, (-wb / 2, -db / 2, wb / 2, db / 2), zt + 0.0, max(2.0, wb * 0.18), lk, ov=0.5)
        elif 'dome' in fe or P['roof'] == 'dome':
            lib.dome(b, 0, 0, zt, min(wb, db) * 0.3, lk, profile='shallow', drum=1.2, lantern=0.8)
    else:
        # modernist hall: overhanging slab and a recessed glazed entrance
        if det < 2:
            lib.box(b, -wb / 2 - 1.2, -db / 2 - 2.8, zt, wb / 2 + 1.2, db / 2 + 1.2, zt + 0.5, ws, tc, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
            lib.box(b, -wb * 0.28, -db / 2 - 0.02, pod_h + 0.2, wb * 0.28, -db / 2 + 0.02, pod_h + hb * 0.72, lk.glass_slot, lk.glass_col, skip=('bottom', 'back', 'top', 'left', 'right'))
        if P['roof'] == 'pyramidal':
            lib.hip(b, (-wb / 2, -db / 2, wb / 2, db / 2), zt, max(2.5, hb * 0.5), lk, ov=0.3, roof_slot=lk.wall_slot if False else None) if False else lib.hip(b, (-wb / 2, -db / 2, wb / 2, db / 2), zt, max(2.5, hb * 0.5), lk, ov=0.3)
    # a statue before the memorial
    if 'statue' in fe and det < 2:
        sp = U.clamp(wb * 0.14, 1.0, 2.6)
        zb = 0.0
        with b.site():
            lib.box(b, wb * 0.5 + 2.5 - sp / 2, -db / 2 - 8.0 - sp / 2, 0, wb * 0.5 + 2.5 + sp / 2, -db / 2 - 8.0 + sp / 2, 1.9, ws, tc, skip=('bottom',))
        figure(b, wb * 0.5 + 2.5, -db / 2 - 8.0, 1.9, U.clamp(hb * 0.45, 2.6, 5.5), BRONZE, srng.choice(['stand', 'raised']), srng, 0.0)
    if 'flags' in fe and det < 2:
        with b.site():
            for k in range(3):
                U.flag(b, -wb * 0.5 - 5 - k * 3.0, -db / 2 - 6.0, 10.0, ['#1f7a4d', '#f2f2ee', '#b83a32'][k], col2='#f2f2ee')
    b.section('site')
    S = U.clamp(max(W, D) * 1.15 + 16, 40, 92)
    with b.site():
        lib.ground(b, -S / 2, -S / 2 - 4, S / 2, S / 2 - 8, lk, 'grass' if lk.ground_slot != 'laterite' else lk.ground_slot, '#6d9a4f' if lk.ground_slot != 'laterite' else None, z=0.0, scale=3.0)
        if det < 2:
            lib.ground(b, -5.0, -S / 2 - 4, 5.0, -db / 2 - 4.5, lk, 'paving', '#cbc6bb', z=0.05, scale=1.5)
    if (enclosure or 'fence-wall' in fe) and det < 2:
        ex0, ex1 = -S * 0.43, S * 0.43
        ey0, ey1 = -S * 0.43 - 4, S * 0.35 - 8
        wh = 2.2
        for (p0, p1) in (((ex0, ey1), (ex1, ey1)), ((ex0, ey0), (ex0, ey1)), ((ex1, ey0), (ex1, ey1))):
            U.wall_run(b, p0, p1, wh, 0.45, ws, lk.wall_col, cap_col=tc, pier_every=6.0, pier_h=wh + 0.5, pier_w=0.7)
        gw = 4.5
        for (p0, p1) in (((ex0, ey0), (-gw, ey0)), ((gw, ey0), (ex1, ey0))):
            U.wall_run(b, p0, p1, wh, 0.45, ws, lk.wall_col, cap_col=tc, pier_every=6.0, pier_h=wh + 0.5, pier_w=0.7)
        for sx in (-1, 1):
            lib.box_c(b, sx * (gw + 0.4), ey0, 0, 1.3, 1.1, wh + 1.6, ws, tc, top_slot='roof-flat', top_col=tc)
        if 'painted-mural' in fe and det == 0:
            for (p0, p1) in (((ex0 + 3, ey1 - 0.26), (ex1 - 3, ey1 - 0.26)),):
                pass
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for k in range(6 if det == 0 else 3):
                x = srng.uniform(-S * 0.38, S * 0.38)
                y = srng.uniform(-S * 0.3, S * 0.25)
                if abs(x) < wb / 2 + 6 and y > -db / 2 - 8:
                    x += (wb / 2 + 8) * (1 if x >= 0 else -1)
                lib.tree(b, lk.tree, x, y, srng.uniform(6, 10), srng, lk)
    return H


# ------------------------------------------------------------------------------------------------------------------- build
def build(brief, style, rng, detail):
    b = lib.Builder('monument', detail)
    lk = lib.look(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    P = plan(brief, style, srng, lk)
    P['storeys'] = int(U.num(brief.get('form') or {}, 'storeys', 0))
    typ = P['typ']
    {'statue': build_statue, 'obelisk': build_obelisk, 'arch': build_arch, 'tower': build_tower, 'hall': build_hall}[typ](b, brief, lk, P, srng)
    objs = b.objects()
    U.centre_xy(objs, True, False)
    return objs
