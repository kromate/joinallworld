"""industrial: refineries, factories, mills, depots and ports. Typologies chosen from the brief:

  refinery  process columns with platforms, pipe racks, furnaces and stacks, tank farm in a bund, LPG spheres, flare stack with flame
  factory   ribbed-metal production sheds (gable / sawtooth / shed roofs), glazed office block, loading docks, chimney, water tower, silos
  mill      grain / oil mill: bank of concrete silos with a headhouse, tall mill house, conveyor gantry, chimney, oil tanks, trucks
  depot     warehouse rows, fuel tank group, container stacks, gantry, gated yard with trucks (also fabrication yards)
  port      quay with water, a moored ship, container gantry cranes, container stacks, warehouse sheds, floodlight masts

Large plants are shown as a recognisable portion (plan clamped to about 108 x 96 m). Front (gate, offices) towards -Y.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import _office_tower_util as U  # noqa: E402

FEATURES = {'flare-stack', 'storage-tanks', 'chimney', 'water-tank', 'sheds', 'fence-wall', 'gate', 'floodlights', 'car-park',
            'signage-board', 'pier', 'solar-panels', 'mast', 'kiosk', 'steps', 'platform-canopy', 'flags'}


def has(t, *w):
    return any(x in t for x in w)


# ------------------------------------------------------------------------------------------------------------------ primitives
def cyl(b, x, y, z0, z1, r, n, courses, slot, col, r_top=None, smooth=True, scale=1.0, cap=True, cap_col=None):
    """Cylinder/frustum shell built from `courses` stacked rings (texture stays undistorted on tall shells)."""
    rt = r if r_top is None else r_top
    courses = max(1, courses if b.detail == 0 else max(1, courses // 2))
    if b.detail >= 2:
        courses = 1
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    grid = []
    for a in angs:
        col_pts = []
        for c in range(courses + 1):
            t = c / courses
            rr = r + (rt - r) * t
            col_pts.append((x + rr * math.cos(a), y + rr * math.sin(a), z0 + (z1 - z0) * t))
        grid.append(col_pts)
    b.shared_grid(grid, slot, col, smooth=smooth, wrap=True, scale=scale)
    if cap and rt > 1e-6:
        b.facing([(x + rt * math.cos(a), y + rt * math.sin(a), z1) for a in angs[:-1]], (0, 0, 1), 'roof-flat' if slot != 'plain' else 'plain', cap_col or lib.shade(col, 0.9))


def hcyl(b, x0, y0, z0, x1, y1, z1, r, n, slot, col, smooth=True, caps=True):
    """A horizontal/inclined cylinder along the segment (x0,y0,z0) -> (x1,y1,z1)."""
    dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
    L = math.sqrt(dx * dx + dy * dy + dz * dz)
    if L < 1e-6:
        return
    d = (dx / L, dy / L, dz / L)
    up = (0, 0, 1) if abs(d[2]) < 0.95 else (1, 0, 0)
    s = (d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0])
    sl = math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2)
    s = (s[0] / sl, s[1] / sl, s[2] / sl)
    t = (d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0])
    grid = []
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        ca, sa = math.cos(a) * r, math.sin(a) * r
        off = (s[0] * ca + t[0] * sa, s[1] * ca + t[1] * sa, s[2] * ca + t[2] * sa)
        grid.append([(x0 + off[0], y0 + off[1], z0 + off[2]), (x1 + off[0], y1 + off[1], z1 + off[2])])
    # rows run around, columns along d: row dir x col dir = (tangent) x d should point outward; flip by reversing rows if not
    grid = grid[::-1]
    b.shared_grid(grid, slot, col, smooth=smooth, wrap=True, scale=2.0)


def beam3(b, a, c, w, col, slot='frame'):
    """A square-section beam between two 3D points."""
    dx, dy, dz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
    L = math.sqrt(dx * dx + dy * dy + dz * dz)
    if L < 1e-6:
        return
    d = (dx / L, dy / L, dz / L)
    up = (0, 0, 1) if abs(d[2]) < 0.95 else (1, 0, 0)
    s = (d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0])
    sl = math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2)
    s = (s[0] / sl, s[1] / sl, s[2] / sl)
    t = (d[1] * s[2] - d[2] * s[1], d[2] * s[0] - d[0] * s[2], d[0] * s[1] - d[1] * s[0])
    h = w / 2
    corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]

    def P(p, cs):
        return (p[0] + s[0] * cs[0] * h + t[0] * cs[1] * h, p[1] + s[1] * cs[0] * h + t[1] * cs[1] * h, p[2] + s[2] * cs[0] * h + t[2] * cs[1] * h)
    for i in range(4):
        c0, c1 = corners[i], corners[(i + 1) % 4]
        nrm = (s[0] * (c0[0] + c1[0]) + t[0] * (c0[1] + c1[1]), s[1] * (c0[0] + c1[0]) + t[1] * (c0[1] + c1[1]), s[2] * (c0[0] + c1[0]) + t[2] * (c0[1] + c1[1]))
        b.facing([P(a, c0), P(c, c0), P(c, c1), P(a, c1)], nrm, slot, col if i < 2 else lib.shade(col, 0.82), mode='fit')


def tank(b, lk, x, y, r, h, col, kind='cone', stairs=True):
    n = {0: 20, 1: 12, 2: 6}[b.detail]
    if b.detail >= 2:
        cyl(b, x, y, 0, h, r, n, 1, 'plain', col, cap=True)
        return
    cyl(b, x, y, 0, h, r, n, max(2, int(h / 3.2)), 'metal-cladding', col, scale=1.5, cap=False)
    if kind == 'cone':
        rise = r * 0.16
        lib.cylinder(b, x, y, h, h + rise, r * 1.01, n=n, slot='plain', col=lib.shade(col, 1.08), r_top=0.06, top=False, smooth=False)
        if b.detail == 0:
            lib.cylinder(b, x, y, h + rise, h + rise + 0.5, 0.35, n=6, slot='plain', col=lib.shade(col, 0.8), r_top=0.2, top=True, smooth=False)
    elif kind == 'floating':
        # open top: wind girder ring, inner floating deck lower down
        b.facing([(x + r * 0.985 * math.cos(2 * math.pi * k / n), y + r * 0.985 * math.sin(2 * math.pi * k / n), h - 1.6) for k in range(n)], (0, 0, 1), 'roof-flat', lib.shade(col, 0.7))
        if b.detail == 0:
            lib.cylinder(b, x, y, h - 0.02, h + 0.3, r * 1.04, n=n, slot='frame', col=lib.shade(col, 0.85), r_top=r * 1.04, top=False, smooth=False)
            for k in range(4):
                a = math.pi / 2 * k
                b.facing([(x + 0.4 * r * math.cos(a), y + 0.4 * r * math.sin(a), h - 1.55), (x + 0.4 * r * math.cos(a) + 0.2, y + 0.4 * r * math.sin(a) + 0.2, h - 1.55), (x + 0.4 * r * math.cos(a) + 0.2, y + 0.4 * r * math.sin(a) + 0.2, h - 1.3), (x + 0.4 * r * math.cos(a), y + 0.4 * r * math.sin(a), h - 1.3)], (0, 0, 1), 'plain', '#5f6368', mode='fit')
    else:  # dome
        lib.dome(b, x, y, h, r * 0.98, lk, height=r * 0.3, profile='shallow', slot='plain', col=lib.shade(col, 1.06))
    if stairs and b.detail == 0:
        # spiral stair: a helical strip up the shell
        steps_n = 14
        for k in range(steps_n):
            a0 = 0.6 + k * 0.28
            a1 = a0 + 0.28
            z0_, z1_ = h * k / steps_n, h * (k + 1) / steps_n
            p = [(x + (r + 0.05) * math.cos(a0), y + (r + 0.05) * math.sin(a0), z0_), (x + (r + 0.75) * math.cos(a0), y + (r + 0.75) * math.sin(a0), z0_),
                 (x + (r + 0.75) * math.cos(a1), y + (r + 0.75) * math.sin(a1), z1_), (x + (r + 0.05) * math.cos(a1), y + (r + 0.05) * math.sin(a1), z1_)]
            b.facing(p, (0, 0, 1), 'frame', '#7d8286', mode='fit')


def bund(b, x0, y0, x1, y1, col='#b8b4aa', h=1.1):
    """A low containment wall (and the paved floor inside)."""
    if b.detail >= 2:
        return
    with b.site():
        b.face([(x0, y0, 0.05), (x1, y0, 0.05), (x1, y1, 0.05), (x0, y1, 0.05)], 'paving', '#a9a59b', scale=2.0)
        if b.detail == 0:
            U.box(b, x0, y0, 0, x1, y0 + 0.4, h, 'rough-concrete', col, skip=('bottom',))
            U.box(b, x0, y1 - 0.4, 0, x1, y1, h, 'rough-concrete', col, skip=('bottom',))
            U.box(b, x0, y0 + 0.4, 0, x0 + 0.4, y1 - 0.4, h, 'rough-concrete', col, skip=('bottom',))
            U.box(b, x1 - 0.4, y0 + 0.4, 0, x1, y1 - 0.4, h, 'rough-concrete', col, skip=('bottom',))


def proc_column(b, x, y, r, h, col, platforms=True):
    n = {0: 12, 1: 8, 2: 5}[b.detail]
    if b.detail >= 2:
        cyl(b, x, y, 0, h, r, n, 1, 'plain', col, cap=True)
        return
    cyl(b, x, y, 0.8, h, r, n, max(2, int(h / 4)), 'metal-cladding', col, scale=1.2, cap=False)
    lib.cylinder(b, x, y, 0, 0.8, r * 1.3, n=n, slot='rough-concrete', col='#8d8f90', r_top=r * 1.2, top=False, smooth=False)
    # dome head
    if b.detail < 2:
        lib.dome(b, x, y, h, r, lk=None, height=r * 0.55, profile='hemi', slot='plain', col=lib.shade(col, 1.05)) if False else _dome(b, x, y, h, r, r * 0.55, lib.shade(col, 1.05))
    if b.detail == 0 and platforms:
        zp = 5.0
        k = 0
        while zp < h - 2:
            lib.cylinder(b, x, y, zp, zp + 0.18, r + 0.9, n=n, slot='frame', col='#6e7378', r_top=r + 0.9, top=True, smooth=False)
            zp += 6.5
            k += 1
        # ladder cage and a vertical pipe
        U.box_c(b, x + (r + 0.15), y, 0.8, 0.12, 0.7, h - 1.0, 'frame', '#7d8286', skip=('bottom',))
        lib.cylinder(b, x - r * 0.9, y + r * 0.5, 0.8, h + 1.2, 0.22, n=5, slot='frame', col='#8b9096', top=True)


def _dome(b, x, y, z, r, hh, col):
    n = 10 if b.detail == 0 else 6
    rings = 3 if b.detail == 0 else 2
    grid = []
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        row = []
        for j in range(rings + 1):
            t = j / rings
            row.append((x + r * math.cos(t * math.pi / 2) * math.cos(a), y + r * math.cos(t * math.pi / 2) * math.sin(a), z + hh * math.sin(t * math.pi / 2)))
        grid.append(row)
    b.shared_grid(grid, 'plain', col, smooth=True, wrap=True)


def pipe_rack(b, x0, x1, y, z, S, levels=2, width=3.4, pipes=5, col='#7e8a92'):
    """An elevated pipe rack along x at y: portal frames every 6 m, pipe bundle(s) on top."""
    if b.detail >= 2:
        U.box(b, x0, y - width / 2, 0, x1, y + width / 2, z + 0.8, 'plain', '#8b9096', skip=('bottom',))
        return
    n = max(2, int((x1 - x0) / 6.0))
    for k in range(n + 1):
        xx = x0 + (x1 - x0) * k / n
        for sy in (-1, 1):
            U.box_c(b, xx, y + sy * width / 2, 0, 0.4, 0.4, z + (levels - 1) * 0 + 0.3, 'frame', '#5e656b', skip=('bottom',))
        for lv in range(levels):
            zz = z * (lv + 1) / levels
            U.box(b, xx - 0.2, y - width / 2, zz - 0.15, xx + 0.2, y + width / 2, zz + 0.15, 'frame', '#5e656b', skip=())
        if b.detail == 0 and k < n:
            xa, xb = xx, x0 + (x1 - x0) * (k + 1) / n
            for sy in (-1, 1):
                beam3(b, (xa, y + sy * width / 2, 0.3), (xb, y + sy * width / 2, z * 0.5), 0.12, '#5e656b')
    rs = S.get('pipes')
    cols = ['#8a959c', '#b9b4a8', '#7a7f84', '#c8962f', '#9aa6ac', '#6a7f8a']
    for lv in range(levels):
        zz = z * (lv + 1) / levels + 0.15
        npipe = pipes if b.detail == 0 else max(2, pipes // 2)
        for p in range(npipe):
            py = y - width / 2 + 0.5 + (width - 1.0) * p / max(1, npipe - 1)
            hcyl(b, x0, py, zz + 0.25, x1, py, zz + 0.25, rs.uniform(0.14, 0.36), 5 if b.detail == 0 else 4, 'plain', rs.choice(cols), smooth=b.detail == 0)


def exchanger(b, x, y, L, r, col, S=None):
    """A horizontal shell-and-tube vessel on two saddles."""
    if b.detail >= 2:
        return
    z = r + 0.7
    hcyl(b, x - L / 2, y, z, x + L / 2, y, z, r, 8 if b.detail == 0 else 5, 'plain', col)
    for sx in (-0.3, 0.3):
        U.box_c(b, x + sx * L, y, 0, 0.5, r * 1.6, z - r * 0.4, 'rough-concrete', '#8d8f90', skip=('bottom',))


def stack(b, lk, x, y, h, r, bands=True, col='#c9c6bd'):
    n = {0: 14, 1: 8, 2: 6}[b.detail]
    segs = 5 if (bands and b.detail == 0) else 1
    for k in range(segs):
        za, zb_ = h * k / segs, h * (k + 1) / segs
        ra, rb = r * (1 - 0.45 * k / segs), r * (1 - 0.45 * (k + 1) / segs)
        c = '#c0392b' if (bands and k in (1, 3) and b.detail == 0) else col
        lib.cylinder(b, x, y, za, zb_, ra, n=n, slot='rough-concrete', col=c, r_top=rb, top=False, smooth=True)
    rt = r * 0.55
    lib.cylinder(b, x, y, h, h + 0.5, rt * 1.12, n=n, slot='plain', col='#3d4146', r_top=rt * 1.12, top=True, smooth=False)


def flare(b, lk, x, y, h):
    """A flare stack: slim tapered tower with platforms, guy cables, and a flame."""
    n = 6 if b.detail < 2 else 4
    lib.cylinder(b, x, y, 0, h, 0.9, n=n, slot='frame', col='#9a9ea2', r_top=0.35, top=False, smooth=b.detail == 0)
    if b.detail < 2:
        # flame: two nested cones
        lib.cylinder(b, x, y, h, h + 6.5, 0.9, n=6, slot='plain', col='#f08a1e', r_top=0.0, top=False, smooth=False)
        if b.detail == 0:
            lib.cylinder(b, x, y, h, h + 3.6, 0.5, n=6, slot='plain', col='#ffd23a', r_top=0.0, top=False, smooth=False)
            for k in range(4):
                a = math.pi / 2 * k + 0.4
                R = 22.0
                gz = h * 0.7
                beam3(b, (x + 0.3 * math.cos(a), y + 0.3 * math.sin(a), gz), (x + R * math.cos(a), y + R * math.sin(a), 0.2), 0.1, '#5a5e62')
            for zz in (h * 0.35, h * 0.7):
                lib.cylinder(b, x, y, zz, zz + 0.15, 1.7, n=6, slot='frame', col='#6e7378', r_top=1.7, top=True, smooth=False)
        lib.cylinder(b, x, y, 0, 0.6, 1.5, n=6, slot='rough-concrete', col='#8d8f90', r_top=1.2, top=True, smooth=False)


def sphere_tank(b, x, y, r, col='#d8dcdf'):
    zc = r + 2.2
    n, rings = (12, 6) if b.detail == 0 else (8, 4)
    if b.detail >= 2:
        n, rings = 6, 3
    lib.blob(b, x, y, zc, r, r, r, col, n=n, rings=rings)
    if b.detail == 0:
        for k in range(6):
            a = 2 * math.pi * k / 6
            lib.cylinder(b, x + r * 0.8 * math.cos(a), y + r * 0.8 * math.sin(a), 0, zc - r * 0.5, 0.2, n=4, slot='frame', col='#6e7378', top=False)
        lib.cylinder(b, x, y, 0, 0.3, r * 0.95, n=12, slot='rough-concrete', col='#8d8f90', r_top=r * 0.95, top=True, smooth=False)


def furnace(b, lk, x, y, w=8.0, d=6.0, h=9.0, col='#a8aeb2'):
    U.box_c(b, x, y, 0, w, d, h, 'metal-cladding', col, top_slot='roof-flat', top_col=lib.shade(col, 0.8), skip=('bottom',))
    if b.detail < 2:
        stack(b, lk, x, y, h + 20.0, 1.3, bands=False, col='#b9bcbf')
        if b.detail == 0:
            U.box_c(b, x, y - d / 2 - 0.3, 0.0, w * 0.7, 0.6, 3.0, 'frame', '#6e7378', skip=('bottom',))


def gantry_walkway(b, x0, y0, z0, x1, y1, z1, col='#8d9298'):
    if b.detail >= 2:
        return
    beam3(b, (x0, y0, z0), (x1, y1, z1), 1.0, col)
    if b.detail == 0:
        n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 7))
        for k in range(n + 1):
            t = k / n
            beam3(b, (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.0), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t - 0.5), 0.3, '#5e656b')


def warehouse(b, lk, cx, cy, w, d, h, S, roof='gable', col=None, doors=3, roof_col=None, front='front', rise=None, teeth=None):
    """A ribbed-metal shed with plinth, roller doors and clerestory band on the long front wall, roofed per `roof`."""
    col = col or lk.wall_col
    fp = lib.fp_rect(w, d, cx, cy)
    for seg in fp.edges():
        U.plain(b, seg, 0, seg.length, 0, h, 'metal-cladding', col, scale=1.0 if b.detail == 0 else 3.0)
    if b.detail == 0:
        for seg in fp.edges():
            if seg.front:
                L = seg.length
                U.sbox(b, seg, 0, L, 0, 1.0, 0.1, lib.shade('#9a9a96', 1.0), skip_ends=True)
                # clerestory band
                b.face([seg.P(1.0, h - 2.4, -0.04), seg.P(L - 1.0, h - 2.4, -0.04), seg.P(L - 1.0, h - 0.7, -0.04), seg.P(1.0, h - 0.7, -0.04)], 'glass-ribbon', '#cfd8dd', mode='tile',
                       uvs=[(0, 0), ((L - 2.0) / 8.0, 0), ((L - 2.0) / 8.0, 1), (0, 1)])
                for k in range(doors):
                    u = L * (k + 0.5) / doors
                    dw = min(5.5, L / doors * 0.6)
                    dh = min(5.0, h - 3.2)
                    b.face([seg.P(u - dw / 2, 0, -0.06), seg.P(u + dw / 2, 0, -0.06), seg.P(u + dw / 2, dh, -0.06), seg.P(u - dw / 2, dh, -0.06)], 'corrugated', '#8b6f4e' if k % 2 == 0 else '#5d6d7a',
                           mode='tile', uvs=[(0, 0), (dw / 1.0, 0), (dw / 1.0, dh / 1.0), (0, dh / 1.0)])
    rc = roof_col or lk.roof_col
    if roof == 'sawtooth':
        t = teeth or max(3, int(w / 9))
        lib.sawtooth(b, (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2), h, rise or 2.6, lk, teeth=t, axis='x', glaze='back', slot='corrugated', col=rc)
    elif roof == 'shed':
        lib.roof(b, 'shed', (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2), h, lk, rise=rise or min(d * 0.14, 3.0), ov=0.3, high='back', slot='corrugated', col=rc)
    elif roof == 'flat':
        lib.flat_roof(b, fp, h, lk, parapet_h=0.6, ov=0.0, slab=0.0)
    else:
        lib.gable(b, (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2), h, rise or d * 0.5 * math.tan(math.radians(11)), lk, axis='x', ov=0.4, slot='corrugated', col=rc,
                  gable_slot='metal-cladding', gable_col=col)
        if b.detail == 0:
            # ridge vent
            U.box_c(b, cx, cy, h + (rise or d * 0.5 * math.tan(math.radians(11))) - 0.05, w * 0.9, 0.9, 0.5, 'corrugated', lib.shade(rc, 0.9), skip=('bottom',))


def office_block(b, lk, cx, cy, w, d, storeys, S, col=None):
    H = storeys * 3.6
    fp = lib.fp_rect(w, d, cx, cy)
    lib.walls(b, fp, 0, H, storeys, lk, S.get('office'), kind='ribbon', ratio=0.5, front_kind='ribbon', plinth=0.3, wall_col=col or lib.mix(lk.wall_col, '#e8e4d8', 0.5), bay=4.0)
    lib.flat_roof(b, fp, H, lk, parapet_h=0.8, ov=0.0, slab=0.0)
    return H


def container(b, x, y, z, yaw, col, long_=12.2, w=2.44, h=2.59):
    U.obox(b, x, y, z, long_, w, h, yaw, 'corrugated', col, top_slot='roof-flat', top_col=lib.shade(col, 0.85), skip=('bottom',), scale=3.0)


CONT_COLS = ['#a8362f', '#2f5f8a', '#d9a53a', '#3f7a52', '#8d9298', '#c4672d', '#4a4f57', '#d8d3c4', '#6a3f7a']


def container_stack(b, S, x0, y0, nx, ny, levels, key='cont', pitch_x=12.6, pitch_y=2.7, yaw=0.0):
    """A block of containers laid along x. LOD1: one slab per row; LOD2: nothing."""
    if b.detail >= 2:
        return
    rs = S.get(key)
    for i in range(nx):
        for j in range(ny):
            lv = max(1, levels - (1 if rs.random() < 0.25 else 0))
            col = rs.choice(CONT_COLS)
            for k in range(lv):
                if b.detail == 1 and k > 0:
                    continue
                if b.detail == 1:
                    U.box_c(b, x0 + i * pitch_x, y0 + j * pitch_y, 0, 12.2, 2.44, 2.59 * lv, 'plain', col, top_col=lib.shade(col, 0.85), skip=('bottom',))
                else:
                    container(b, x0 + i * pitch_x, y0 + j * pitch_y, k * 2.62, yaw, col)


def crane(b, x, y_land, y_sea, col='#2f6f9a', h=42.0):
    """A ship-to-shore container crane: portal legs over the rails, a raised boom reaching seawards, a back-reach and machinery house."""
    sx = 11.0   # half gauge
    ly0, ly1 = y_land, y_land + 14.0
    if b.detail >= 2:
        U.box_c(b, x, (ly0 + ly1) / 2, 0, 24.0, 16.0, h * 0.7, 'plain', col, skip=('bottom',))
        beam3(b, (x, ly1, h * 0.8), (x, y_sea, h * 0.95), 2.0, col)
        return
    leg = 1.4
    if b.detail >= 1:
        legs = [(lx, ly) for lx in (-sx, sx) for ly in (ly0, ly1)] if b.detail == 0 else [(lx, (ly0 + ly1) / 2) for lx in (-sx, sx)]
    for lx in (-sx, sx):
        for ly in (ly0, ly1):
            if b.detail == 1:
                continue
            U.box_c(b, x + lx, ly, 0, leg, leg, h * 0.62, 'frame', col, skip=('bottom',))
    if b.detail == 1:
        for lx in (-sx, sx):
            U.box(b, x + lx - 0.7, ly0, 0, x + lx + 0.7, ly1, h * 0.62, 'frame', col, skip=('bottom',))
    # portal girders
    for ly in ((ly0, ly1) if b.detail == 0 else (ly0,)):
        U.box(b, x - sx - 0.8, ly - 0.8, h * 0.62 - 0.9, x + sx + 0.8, ly + 0.8, h * 0.62 + 0.9, 'frame', lib.shade(col, 0.92), skip=())
    if b.detail == 0:
        for lx in (-sx, sx):
            U.box(b, x + lx - 0.8, ly0, h * 0.62 - 0.9, x + lx + 0.8, ly1, h * 0.62 + 0.9, 'frame', lib.shade(col, 0.92), skip=())
    if b.detail == 0:
        for lx in (-sx, sx):
            beam3(b, (x + lx, ly0, 3.0), (x + lx, ly1, h * 0.55), 0.35, lib.shade(col, 0.85))
            beam3(b, (x + lx, ly1, 3.0), (x + lx, ly0, h * 0.55), 0.35, lib.shade(col, 0.85))
    # machinery house + boom + backreach
    U.box_c(b, x, (ly0 + ly1) / 2, h * 0.62 + 0.9, 8.0, 10.0, 4.0, 'plain', lib.shade(col, 1.12), top_col=lib.shade(col, 0.9), skip=('bottom',))
    for dx in ((-3.0, 3.0) if b.detail == 0 else (0.0,)):
        beam3(b, (x + dx, ly1 - 2.0, h * 0.62 + 0.9), (x + dx, ly1 + 3.0, h * 0.62 + 18.0), 1.0, col)
        beam3(b, (x + dx, ly1 + 3.0, h * 0.62 + 18.0), (x + dx, y_sea, h * 0.62 + 24.0), 0.9, col)
        beam3(b, (x + dx, ly1 + 3.0, h * 0.62 + 18.0), (x + dx, ly0 - 12.0, h * 0.62 + 5.0), 0.8, lib.shade(col, 0.9))
        beam3(b, (x + dx, ly1 - 2.0, h * 0.62 + 5.0), (x + dx, y_sea, h * 0.62 + 24.0), 0.4, '#8d9298') if b.detail == 0 else None


def ship(b, x, y, L=84.0, Wd=15.0, S=None, hull='#3a3f48', stripe='#b03a2e'):
    """A container ship moored along x at y (centre line): tapered hull, rows of containers on deck, stern bridge block and funnel."""
    if b.detail >= 2:
        U.box_c(b, x, y, 0.5, L, Wd, 8.0, 'plain', hull, skip=('bottom',))
        return
    deck = 7.0
    h2 = L / 2
    hw = Wd / 2
    top = [(x - h2, y - hw), (x + h2 * 0.55, y - hw), (x + h2, y - hw * 0.2), (x + h2, y + hw * 0.2), (x + h2 * 0.55, y + hw), (x - h2, y + hw)]
    bot = [(x - h2 * 0.95, y - hw * 0.8), (x + h2 * 0.5, y - hw * 0.8), (x + h2 * 0.92, y - hw * 0.12), (x + h2 * 0.92, y + hw * 0.12), (x + h2 * 0.5, y + hw * 0.8), (x - h2 * 0.95, y + hw * 0.8)]
    n = len(top)
    for i in range(n):
        j = (i + 1) % n
        mid = ((top[i][0] + top[j][0]) / 2 - x, (top[i][1] + top[j][1]) / 2 - y, 0)
        b.facing([(bot[i][0], bot[i][1], 0.2), (bot[j][0], bot[j][1], 0.2), (top[j][0], top[j][1], deck), (top[i][0], top[i][1], deck)], mid, 'metal-cladding', hull if True else stripe, scale=2.0)
    b.facing([(p[0], p[1], deck) for p in top], (0, 0, 1), 'roof-flat', '#6a5a4a')
    # waterline stripe
    if b.detail == 0:
        b.facing([(top[0][0], top[0][1] - 0.02, deck - 1.4), (top[1][0], top[1][1] - 0.02, deck - 1.4), (top[1][0], top[1][1] - 0.02, deck - 0.6), (top[0][0], top[0][1] - 0.02, deck - 0.6)], (0, -1, 0), 'plain', stripe, mode='fit')
    # containers
    rs = S.get('shipc') if S else None
    nbays = int((L * 0.62) / 12.6)
    for i in range(nbays):
        for j in range(3):
            lv = 3 if j != 1 else 4
            col = rs.choice(CONT_COLS) if rs else '#a8362f'
            if b.detail == 1:
                U.box_c(b, x + h2 * 0.35 - i * 12.6 + 2.0, y + (j - 1) * 2.6, deck, 12.2, 2.5, 2.6 * lv, 'plain', col, top_col=lib.shade(col, 0.85), skip=('bottom',))
            else:
                for k in range(lv):
                    container(b, x + h2 * 0.35 - i * 12.6 + 2.0, y + (j - 1) * 2.6, deck + 2.62 * k, 0.0, col)
    # bridge
    bx = x - h2 + 7.0
    U.box_c(b, bx, y, deck, 11.0, Wd * 0.8, 14.0, 'plain-render', '#e6e3da', top_col='#cfcbc0', skip=('bottom',))
    if b.detail == 0:
        for lv in range(3):
            b.face([(bx + 5.55, y - 5.0, deck + 4 + lv * 3.6), (bx + 5.55, y + 5.0, deck + 4 + lv * 3.6), (bx + 5.55, y + 5.0, deck + 5.8 + lv * 3.6), (bx + 5.55, y - 5.0, deck + 5.8 + lv * 3.6)], 'glass-ribbon', '#cfd8dd', mode='fit')
    lib.cylinder(b, bx - 2.0, y, deck + 14.0, deck + 19.0, 1.7, n=8 if b.detail == 0 else 5, slot='plain', col=stripe, r_top=1.4, top=True, smooth=False)


def water_tower(b, lk, x, y, h=16.0, r=3.4, col='#c9ccd0'):
    """An elevated steel water tank on a braced tower."""
    if b.detail >= 2:
        lib.cylinder(b, x, y, h - 4, h + 2, r, n=6, slot='plain', col=col, r_top=r * 0.8, top=True, smooth=False)
        return
    n = 10 if b.detail == 0 else 6
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.cylinder(b, x + sx * r * 0.7, y + sy * r * 0.7, 0, h - 3.5, 0.22, n=4, slot='frame', col='#6e7378', top=False)
    if b.detail == 0:
        for z in (h * 0.35, h * 0.65):
            U.box(b, x - r * 0.72, y - r * 0.72, z, x + r * 0.72, y + r * 0.72, z + 0.18, 'frame', '#7d8286', skip=())
    lib.cylinder(b, x, y, h - 3.5, h, r, n=n, slot='plain', col=col, r_top=r, top=False, smooth=True)
    lib.cylinder(b, x, y, h, h + 1.6, r, n=n, slot='plain', col=lib.shade(col, 1.08), r_top=0.2, top=False, smooth=False)


def silo_bank(b, lk, x0, y0, nx, ny, r, h, col, S):
    """A bank of touching concrete silos with a headhouse gallery on top."""
    n = {0: 16, 1: 10, 2: 8}[b.detail]
    for i in range(nx):
        for j in range(ny):
            cx, cy = x0 + i * 2 * r, y0 + j * 2 * r
            cyl(b, cx, cy, 0, h, r, n, max(3, int(h / 4.0)), 'rough-concrete', lib.jitter(col, S.get('silo%d%d' % (i, j)), 0.04), scale=1.2, cap=True)
    gx, gy = x0 + (nx - 1) * r, y0 + (ny - 1) * r
    U.box_c(b, gx, gy, h, nx * 2 * r - 1.0, ny * 2 * r - 1.0, 4.2, 'metal-cladding', lib.shade(col, 0.96), top_slot='roof-flat', top_col='#8d9298', skip=('bottom',))
    if b.detail == 0:
        # slip-form base ring and hopper pillars
        U.box_c(b, gx, gy, 0, nx * 2 * r + 0.4, ny * 2 * r + 0.4, 1.0, 'rough-concrete', lib.shade(col, 0.82), skip=('bottom',))
    return gx, gy


# ---------------------------------------------------------------------------------------------------------------------- plan
def plan(brief, style, lk, S):
    form = U.form_of(brief)
    feats = U.feat(brief)
    txt = U.text(brief)
    W = U.clamp(U.fnum(form.get('width_m'), 90), 36, 108)
    D = U.clamp(U.fnum(form.get('depth_m'), 60), 28, 96)
    H = U.clamp(U.fnum(form.get('height_m'), 12), 5, 90)
    storeys = int(U.clamp(U.fnum(form.get('storeys'), 1), 1, 6))
    roof = form.get('roof') or 'gable'
    if has(txt, 'refinery', 'process column', 'distill', 'petrochem', 'lng', 'gas plant') or ('flare-stack' in feats and has(txt, 'process', 'refin')):
        typ = 'refinery'
    elif has(txt, 'silo', 'grain', ' mill', 'flour', 'oil mill'):
        typ = 'mill'
    elif has(txt, 'port', 'quay', 'wharf', 'harbour', 'harbor', 'container terminal', 'dock') or ('pier' in feats and has(txt, 'ship', 'cargo')):
        typ = 'port'
    elif has(txt, 'depot', 'warehouse', 'tank farm', 'fabrication', 'yard', 'logistic', 'trans-amadi', 'storage'):
        typ = 'depot'
    elif 'flare-stack' in feats:
        typ = 'refinery'
    else:
        typ = 'factory'
    return {'typ': typ, 'W': W, 'D': D, 'H': H, 'storeys': storeys, 'roof': roof, 'feats': feats, 'txt': txt, 'setting': brief.get('setting') or {}}


def yard_ground(b, lk, P, x0, y0, x1, y1):
    lib.ground(b, x0, y0, x1, y1, lk)
    if b.detail < 2:
        # paved working yard inside the fence
        with b.site():
            b.face([(x0 + 3, y0 + 3, 0.04), (x1 - 3, y0 + 3, 0.04), (x1 - 3, y1 - 3, 0.04), (x0 + 3, y1 - 3, 0.04)], 'asphalt', '#6b6d70', scale=3.0 if b.detail == 0 else 6.0)


def common_site(b, lk, P, S, x0, y0, x1, y1, gate_x=0.0):
    """Fence with a gate on the front, gatehouse, floodlight masts, sign, entrance road."""
    feats = P['feats']
    if b.detail >= 2:
        return
    b.section('fence')
    if 'fence-wall' in feats or True:
        U.fence(b, lk, [(x0 + 1, y0 + 1), (x0 + 1, y1 - 1), (x1 - 1, y1 - 1), (x1 - 1, y0 + 1), (x0 + 1, y0 + 1)], h=2.6, col=lib.shade(lk.wall_col, 1.0), gate=(3, 0.5 + gate_x / (x1 - x0), 9.0), pillar_every=6.0)
    # gatehouse beside the gate
    if b.detail < 2:
        U.box_c(b, gate_x + 7.5, y0 + 4.0, 0, 3.2, 2.8, 2.7, 'plain-render', lib.shade(lk.wall_col, 0.95), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    b.section('lights')
    for k in range(2 if b.detail == 1 else 3):
        U.floodlight(b, x0 + 8 + (x1 - x0 - 16) * k / 2.0, y1 - 6, 18)
    if 'signage-board' in feats:
        with b.site():
            lib.sign_board(b, gate_x - 10.0, y0 - 1.5, 0.0, 7.0, 2.4, lk, 0.0, col='#2f5f8a')


# ---------------------------------------------------------------------------------------------------------------------- typologies
def build_refinery(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    x0, x1 = -W / 2, W / 2
    yf, yb = -D / 2, D / 2
    rs = S.get('ref')
    mx = -1.0 if S.get('mirror').random() < 0.5 else 1.0
    X = lambda v: mx * v
    XR = lambda a, c: (min(mx * a, mx * c), max(mx * a, mx * c))
    b.section('tankfarm')
    # tank farm (left front)
    nt = int(U.clamp(U.fcount(feats, 'storage-tanks', 4) + 2 if 'storage-tanks' in feats else 4, 3, 8))
    cols = ['#d9dcde', '#c9ccce', '#e6e3dc', '#bfc4c7']
    fx0 = x0 + 5
    rows = 2 if nt > 3 else 1
    per_row = (nt + rows - 1) // rows
    rr = U.clamp(min((W * 0.4) / per_row / 2 - 1.2, 10.5), 5.0, 10.5)
    bx1 = fx0 + per_row * (2 * rr + 3) + 2
    by0 = yf + 11
    by1 = by0 + rows * (2 * rr + 3) + 2
    ba, bc = XR(fx0 - 2, bx1)
    bund(b, ba, by0 - 2, bc, by1, '#b8b4aa')
    k = 0
    for r_ in range(rows):
        for i in range(per_row):
            if k >= nt:
                break
            tx = fx0 + rr + 1.5 + i * (2 * rr + 3)
            ty = by0 + rr + 1.0 + r_ * (2 * rr + 3)
            kind = ['cone', 'floating', 'cone', 'dome'][(k + rs.randint(0, 3)) % 4]
            tank(b, lk, X(tx), ty, rr, U.clamp(H * 0.4, 9, 17) * (0.9 + 0.1 * (k % 3)), cols[k % 4], kind, stairs=(k < 3))
            k += 1
    b.section('process')
    # pipe rack and process columns on the right
    px0 = x0 + W * 0.36
    px1 = x1 - 6
    prz = 7.0
    rack_y = yf + D * 0.45
    ra, rc = XR(px0, px1)
    pipe_rack(b, ra, rc, rack_y, prz, S, levels=2, width=3.6, pipes=5)
    ncol = int(U.clamp((px1 - px0) / 12, 3, 6))
    for i in range(ncol):
        cx = px0 + 8 + (px1 - px0 - 14) * i / max(1, ncol - 1)
        hh = H * (1.0 if i == 1 else rs.uniform(0.5, 0.85))
        rcol = 2.0 + 1.6 * (hh / H)
        proc_column(b, X(cx), rack_y + 10 + rs.uniform(-1, 3), rcol, hh, rs.choice(['#b9bec2', '#a9afb4', '#c7c9c6']))
        if i < ncol - 1 and b.detail < 2:
            # overhead pipe from column top to its neighbour's
            pass
    for i in range(3):
        exchanger(b, X(px0 + 8 + i * 14), rack_y - 6.5, 8.0, 1.2, '#8f9aa1')
    furnace(b, lk, X(px1 - 6), rack_y + 22, 8.0, 6.0, 9.5)
    b.section('spheres+flare')
    for i in range(2 if W < 80 else 3):
        sphere_tank(b, X(x0 + 10 + i * 17), yb - 14, 6.0 if i % 2 == 0 else 5.0)
    flare(b, lk, X(x0 + 4.0), yb - 4.0, U.clamp(H * 1.25, 38, 95))
    if 'chimney' in feats:
        stack(b, lk, X(x1 - 5), yb - 8, U.clamp(H * 0.9, 28, 60), 2.0)
    if 'water-tank' in feats:
        water_tower(b, lk, X(x0 + W * 0.3), yb - 6, 14.0)
    b.section('admin')
    ofp_w = 22.0
    office_block(b, lk, X(x1 - 16), yf + 7.0, ofp_w, 10.0, 2, S)
    if b.detail < 2:
        lib.canopy_flat(b, X(x1 - 16) - 5, yf + 0.5, X(x1 - 16) + 5, yf + 3.5, 3.2, lk, th=0.4, columns=2, col=lk.roof_col, edge_col=lk.trim_col, r=0.15)
    if 'sheds' in feats:
        warehouse(b, lk, X(x0 + W * 0.58), yf + 14, 20.0, 12.0, 7.5, S, 'gable', doors=2)
    if 'mast' in feats:
        U.mast(b, X(x1 - 3), yf + 14, 0, 28.0, 0.35, banded=True)
    # trucks
    if b.detail < 2:
        for k in range(2):
            U.truck(b, X(x1 - 28 + k * 8), yf + 2.5, 0.0, '#c8362f' if k == 0 else '#d9d3c4', length=8.0)
    return {'x0': x0, 'x1': x1, 'yf': yf, 'yb': yb}


def build_factory(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    x0, x1 = -W / 2, W / 2
    yf, yb = -D / 2, D / 2
    rs = S.get('fac')
    b.section('sheds')
    roof = P['roof'] if P['roof'] in ('gable', 'sawtooth', 'shed', 'flat') else 'gable'
    if roof == 'flat':
        roof = 'shed'
    sw = U.clamp(W * 0.72, 30, 84)
    sd = U.clamp(D * 0.5, 22, 44)
    sh = U.clamp(H * 0.7 if H > 8 else H, 6.5, 14.0)
    sx = x1 - sw / 2 - 4
    sy = yb - sd / 2 - 6
    wcol = lk.wall_col
    warehouse(b, lk, sx, sy, sw, sd, sh, S, roof, col=wcol, doors=max(2, int(sw / 18)), teeth=max(3, int(sw / 10)))
    nsheds = 2 if ('sheds' in feats and sw < 70) or W > 90 else 1
    if nsheds > 1:
        warehouse(b, lk, x0 + 14, yb - 22, 24.0, 22.0, sh * 0.85, S, 'gable' if roof != 'gable' else 'shed', col=lib.shade(wcol, 0.95), doors=2)
    b.section('office')
    oh = office_block(b, lk, x0 + 14, yf + 15, 22.0, 12.0, 2, S, col=lib.mix(wcol, '#f0ece0', 0.4))
    if b.detail < 2:
        lib.canopy_flat(b, x0 + 14 - 5, yf + 8.0, x0 + 14 + 5, yf + 11.5, 3.4, lk, th=0.4, columns=2, col=lk.roof_col, edge_col=lk.trim_col, r=0.15)
    b.section('plant')
    if 'chimney' in feats or True:
        stack(b, lk, sx + sw / 2 - 6, sy + sd / 2 + 7, U.clamp(H * 1.3, 22, 40), 1.6, bands=True)
    if 'water-tank' in feats or True:
        water_tower(b, lk, x1 - 10, yf + 16, 15.0)
    if 'storage-tanks' in feats:
        for i in range(3):
            tank(b, lk, x0 + 10 + i * 9.0, yb - 12 if nsheds < 2 else yb - 6, 3.6, 8.5, '#d9dcde', 'cone', stairs=False)
    # silos beside the shed
    if has(P['txt'], 'silo', 'grain') or 'storage-tanks' in feats:
        silo_bank(b, lk, x0 + 4, yb - 12, 2, 1, 3.2, 20.0, '#c9c6bd', S)
    # loading dock canopy + trucks
    if b.detail < 2:
        lib.canopy_flat(b, sx - sw / 4, sy - sd / 2 - 5.0, sx + sw / 4, sy - sd / 2, 4.6, lk, th=0.45, columns=3, col=lk.roof_col, edge_col=lk.trim_col, r=0.2)
        for k in range(3):
            U.truck(b, sx - sw / 4 + 5 + k * (sw / 2) / 3, sy - sd / 2 - 7.5, math.pi / 2 if False else 0.0, rs.choice(['#c8362f', '#2f5f8a', '#d9d3c4', '#4a7a55']), length=8.0)
    return {'x0': x0, 'x1': x1, 'yf': yf, 'yb': yb}


def build_mill(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    x0, x1 = -W / 2, W / 2
    yf, yb = -D / 2, D / 2
    rs = S.get('mill')
    b.section('silos')
    r = 4.4 if W > 70 else 3.6
    nx = int(U.clamp(W * 0.3 // (2 * r), 3, 6))
    ny = 2 if D > 50 else 1
    sh = U.clamp(H * 1.1, 24, 44)
    sx0 = x0 + 8
    sy0 = yb - 8 - ny * 2 * r
    gx, gy = silo_bank(b, lk, sx0 + r, sy0 + r, nx, ny, r, sh, lib.mix(lk.wall_col, '#b9b6ae', 0.5), S)
    b.section('milling')
    mw, md = 20.0, 17.0
    mh = U.clamp(sh * 0.8, 20, 34)
    mx = sx0 + nx * 2 * r + 5 + mw / 2
    my = yb - md / 2 - 10
    mfp = lib.fp_rect(mw, md, mx, my)
    lib.walls(b, mfp, 0, mh, max(3, int(mh / 4.2)), lk, S.get('mw'), kind='ribbon', ratio=0.34, front_kind='ribbon', plinth=0.4, wall_col=lib.mix(lk.wall_col, '#d8d2c4', 0.4), bay=4.0, rear='flat')
    lib.flat_roof(b, mfp, mh, lk, parapet_h=0.8, ov=0.0, slab=0.0)
    U.box_c(b, mx - 4, my, mh, 9.0, 8.0, 4.0, 'metal-cladding', '#a8aeb2', top_slot='roof-flat', top_col='#7e8288', skip=('bottom',))
    # conveyor gantry between headhouse and mill
    gantry_walkway(b, gx + nx * r - 0.5, gy + 0.0, sh + 3.5, mx - mw / 2 + 2.0, my, mh - 1.0)
    # flour store / warehouse + loading
    b.section('stores')
    wx = x1 - 26 if x1 - 26 > mx + mw / 2 + 14 else mx + mw / 2 + 16
    warehouse(b, lk, min(wx, x1 - 14), yf + 38 if D > 70 else yb - 38, 26.0, 16.0, 8.0, S, 'gable', doors=2, col=lib.shade(lk.wall_col, 0.95))
    stack(b, lk, mx + mw / 2 + 5, my + 3, U.clamp(H * 1.2, 30, 46), 1.5)
    for i in range(2):
        tank(b, lk, x0 + 10 + i * 9.0, yf + 14, 3.8, 9.0, '#d9dcde', 'cone', stairs=False) if ('storage-tanks' in feats or has(P['txt'], 'oil')) else None
    if 'water-tank' in feats:
        water_tower(b, lk, x1 - 8, yf + 10, 14.0)
    office_block(b, lk, x0 + 12, yf + 9.0, 16.0, 9.0, 2, S)
    # weighbridge + trucks queue
    if b.detail < 2:
        U.box_c(b, 0, yf + 5.0, 0, 3.0, 2.4, 2.5, 'plain-render', '#d8d2c4', top_col='#8a8f93', skip=('bottom',))
        for k in range(3):
            U.truck(b, 6 + k * 9, yf + 14.0 + 0.0, math.pi / 2 * 0, rs.choice(['#c8362f', '#2f5f8a', '#d9d3c4']), length=8.0)
    return {'x0': x0, 'x1': x1, 'yf': yf, 'yb': yb}


def build_depot(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    x0, x1 = -W / 2, W / 2
    yf, yb = -D / 2, D / 2
    rs = S.get('dep')
    b.section('sheds')
    n = 3 if W > 80 else 2
    roof = P['roof'] if P['roof'] in ('gable', 'shed', 'sawtooth') else 'gable'
    sh = U.clamp(H * 0.75, 6.0, 12.0)
    ww = U.clamp((W * 0.62 - 3 * (n - 1)) / n, 14, 34)
    for i in range(n):
        sx = x0 + 8 + ww / 2 + i * (ww + 3.0)
        sd = U.clamp(D * 0.36, 16, 28) * (1.0 - 0.12 * (i % 2))
        warehouse(b, lk, sx, yb - sd / 2 - 6, ww, sd, sh * (1.0 - 0.1 * (i % 2)), S, roof if i == 0 else rs.choice(['gable', 'shed']), col=lib.jitter(lk.wall_col, S.get('wh%d' % i), 0.07), doors=2)
    b.section('tanks')
    if 'storage-tanks' in feats or has(P['txt'], 'tank farm'):
        tx0 = x1 - 8.0
        for i in range(4):
            tank(b, lk, x1 - 10 - (i % 2) * 11.0, yf + 12 + (i // 2) * 11.5, 4.8, 10.0, ['#d9dcde', '#c9ccce'][i % 2], 'cone' if i < 3 else 'floating', stairs=(i == 0))
        bund(b, x1 - 28, yf + 4.0, x1 - 4, yf + 28.5, '#b8b4aa')
    b.section('containers')
    cx_ = x0 + 12
    container_stack(b, S, cx_, yf + 10, 3, 3, 3, key='cont1')
    container_stack(b, S, cx_ + 4, yf + 28, 2, 2, 2, key='cont2')
    b.section('gantry')
    if b.detail < 2 and (has(P['txt'], 'fabricat', 'crane') or W >= 100):
        # a gantry crane over a steel lay-down area
        gx = (x0 + x1) / 2
        for sx in (-12.0, 12.0):
            for sy in (-4.0, 4.0):
                U.box_c(b, gx + sx, yf + 22 + sy, 0, 0.7, 0.7, 11.0, 'frame', '#d9a53a', skip=('bottom',))
        for sy in (-4.0, 4.0):
            U.box(b, gx - 12.4, yf + 22 + sy - 0.4, 10.6, gx + 12.4, yf + 22 + sy + 0.4, 11.4, 'frame', '#d9a53a', skip=())
        U.box(b, gx - 0.8, yf + 17.6, 10.0, gx + 0.8, yf + 26.4, 10.6, 'frame', '#c8962f', skip=())
        for k in range(3):
            hcyl(b, gx - 10 + k * 3, yf + 19.0 + k * 1.2, 0.9, gx + 8 + k * 2, yf + 19.0 + k * 1.2, 0.9, 0.7, 6, 'plain', '#8a5a3a') if b.detail == 0 else None
    office_block(b, lk, x0 + 12, yf + 5.5, 12.0, 8.0, 1, S)
    if 'water-tank' in feats:
        water_tower(b, lk, x0 + 6, yb - 3.0, 12.0)
    if 'chimney' in feats:
        stack(b, lk, x1 - 6, yb - 6, 24.0, 1.3, bands=False)
    if b.detail < 2:
        for k in range(4):
            U.truck(b, x0 + 36 + k * 9, yf + 7.0 + (k % 2) * 3.0, 0.0, rs.choice(['#c8362f', '#2f5f8a', '#d9d3c4', '#4a7a55']), length=8.0)
    return {'x0': x0, 'x1': x1, 'yf': yf, 'yb': yb}


def build_port(b, lk, P, S):
    W, D, H = P['W'], P['D'], P['H']
    feats = P['feats']
    W = U.clamp(W, 60, 100)
    D = U.clamp(D, 40, 70)
    x0, x1 = -W / 2, W / 2
    yf, yb = -D / 2, D / 2
    rs = S.get('port')
    yq = yb - 6.0     # quay edge (water beyond)
    b.section('water')
    if b.detail < 2:
        with b.site():
            b.face([(x0 - 4, yq, 0.0), (x1 + 4, yq, 0.0), (x1 + 4, yq + 44.0, 0.0), (x0 - 4, yq + 44.0, 0.0)], 'plain', '#4d8aa6', mode='fit')
    b.section('quay')
    U.box(b, x0 - 4, yf + 2, 0, x1 + 4, yq, 0.5, 'paving', '#9d9a92', skip=('bottom', 'back'), scale=3.0)
    if b.detail < 2:
        U.box(b, x0 - 4, yq - 0.6, 0.5, x1 + 4, yq, 0.9, 'rough-concrete', '#b0aca3', skip=('bottom',))
        if b.detail == 0:
            for k in range(int(W // 9)):
                lib.cylinder(b, x0 + 3 + k * 9, yq - 1.2, 0.5, 1.0, 0.3, n=6, slot='frame', col='#3a3d41', r_top=0.4, top=True, smooth=False)
        with b.site():
            pass
    b.section('ship')
    ship(b, x0 + W * 0.45 + 6, yq + 9.0, L=min(88.0, W * 0.85), Wd=15.0, S=S, hull=rs.choice(['#394049', '#2f4a63', '#4a3a3a']), stripe=rs.choice(['#b03a2e', '#c8962f']))
    b.section('cranes')
    ncr = 2 if W < 90 else 3
    for i in range(ncr):
        crane(b, x0 + 20 + i * (W - 40) / max(1, ncr - 1) if ncr > 1 else 0.0, yq - 14.0, yq + 20.0, rs.choice(['#2f6f9a', '#b03a2e', '#5a8f6a']) if i == 0 else '#2f6f9a')
    b.section('containers')
    container_stack(b, S, x0 + 12, yf + 26, 3, 4, 3, key='c1')
    container_stack(b, S, x0 + 12 + 12.6 * 3 + 6, yf + 26, 2, 4, 2, key='c2')
    b.section('sheds')
    warehouse(b, lk, x1 - 18, yf + 12, 32.0, 14.0, 8.0, S, 'gable' if P['roof'] != 'shed' else 'shed', col=lk.wall_col, doors=3)
    office_block(b, lk, x0 + 12, yf + 9.0, 14.0, 8.0, 2, S)
    if b.detail < 2:
        for k in range(3):
            U.truck(b, x0 + 36 + k * 9, yf + 18.0, 0.0, rs.choice(['#c8362f', '#2f5f8a', '#d9d3c4']), length=8.0)
    if 'pier' in feats and b.detail < 2:
        U.box(b, x1 - 6, yq, 0.0, x1 - 2, yq + 24.0, 0.7, 'paving', '#a9a59b', skip=('bottom',))
    return {'x0': x0, 'x1': x1, 'yf': yf, 'yb': yq + 14.0, 'water': True}


def build(brief, style, rng, detail):
    b = lib.Builder('industrial', detail)
    S = U.Streams(rng)
    brief = U.sane(brief)
    style = style if isinstance(style, dict) else {}
    lk = lib.look(brief, style, S.get('look'))
    P = plan(brief, style, lk, S)
    typ = P['typ']
    # industrial surfaces: ribbed metal / grey render whatever the style
    if lk.wall_slot in ('timber', 'mud-render'):
        lk.wall_slot = 'plain-render'
    if lk.roof_slot in ('clay-tile', 'slate', 'timber'):
        lk.roof_slot = 'corrugated'
    fn = {'refinery': build_refinery, 'factory': build_factory, 'mill': build_mill, 'depot': build_depot, 'port': build_port}[typ]
    ext = fn(b, lk, P, S)
    if detail < 2:
        pad_x0, pad_x1 = ext['x0'] - 5, ext['x1'] + 5
        pad_y0, pad_y1 = ext['yf'] - 12, ext['yb'] + 6
        if pad_y1 - pad_y0 > 118:
            pad_y0 = pad_y1 - 118
        b.section('ground')
        yard_ground(b, lk, P, pad_x0, pad_y0 if typ != 'port' else ext['yf'] - 10, pad_x1, pad_y1 if typ != 'port' else ext['yb'] - 14.0)
        if typ == 'port':
            common = (pad_x0, ext['yf'] - 10, pad_x1, ext['yb'] - 14.0)
        else:
            common = (pad_x0, pad_y0, pad_x1, pad_y1)
        if typ != 'port':
            common_site(b, lk, P, S, common[0], common[1], common[2], common[3], 0.0)
        else:
            U.fence(b, lk, [(pad_x0 + 1, ext['yf'] - 9), (pad_x1 - 1, ext['yf'] - 9)], h=2.4, col=lk.wall_col, gate=(0, 0.5, 9.0))
            for k in range(3):
                U.floodlight(b, pad_x0 + 12 + (pad_x1 - pad_x0 - 24) * k / 2.0, ext['yf'] + 40.0, 20)
        # entrance road / apron in front
        with b.site():
            b.face([(-5.0, pad_y0 - 8.0 if typ != 'port' else common[1] - 8.0, 0.03), (5.0, pad_y0 - 8.0 if typ != 'port' else common[1] - 8.0, 0.03), (5.0, common[1] + 1.0, 0.03), (-5.0, common[1] + 1.0, 0.03)], 'asphalt', '#5a5c5f', scale=3.0)
        if lk.tree not in (None, 'none'):
            rs = S.get('trees')
            for k in range(3 if detail == 0 else 1):
                lib.tree(b, lk.tree, pad_x0 + 2 + rs.uniform(0, 2), common[1] + 10 + k * 12 + rs.uniform(-2, 2), rs.uniform(6, 9), S.get('tr%d' % k), lk)
    return b.objects()
