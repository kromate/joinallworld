"""Columns, colonnades, porticoes, canopies, towers, ground and forecourts, trees, signs, cars, steps."""
import math

from .core import jitter, mix, rgb, shade, to_hex
from .facade import Look, facade, walls
from .roofs import _Rot, dome, gable, hip, roof_profile, flat_roof
from .shapes import Footprint, box, box_c, cap, cylinder, fp_rect, fp_round, prism, sweep, steps


# ------------------------------------------------------------------------------------------------------------ primitives
def obox(b, cx, cy, z0, sx, sy, h, yaw=0.0, slot='plain-render', col='#d8d8d8', top_slot=None, top_col=None, skip=('bottom',), scale=1.0):
    """A box of size sx (local x) by sy (local y) by h, centred at (cx, cy), rotated `yaw` radians about +Z."""
    c, s = math.cos(yaw), math.sin(yaw)
    P = lambda lx, ly, z: (cx + c * lx - s * ly, cy + s * lx + c * ly, z)
    hx, hy, z1 = sx / 2, sy / 2, z0 + h
    ts, tc = top_slot or slot, top_col or col
    f = [
        ('front', [P(-hx, -hy, z0), P(hx, -hy, z0), P(hx, -hy, z1), P(-hx, -hy, z1)], (s, -c, 0), slot, col),
        ('right', [P(hx, -hy, z0), P(hx, hy, z0), P(hx, hy, z1), P(hx, -hy, z1)], (c, s, 0), slot, col),
        ('back', [P(hx, hy, z0), P(-hx, hy, z0), P(-hx, hy, z1), P(hx, hy, z1)], (-s, c, 0), slot, col),
        ('left', [P(-hx, hy, z0), P(-hx, -hy, z0), P(-hx, -hy, z1), P(-hx, hy, z1)], (-c, -s, 0), slot, col),
        ('top', [P(-hx, -hy, z1), P(hx, -hy, z1), P(hx, hy, z1), P(-hx, hy, z1)], (0, 0, 1), ts, tc),
        ('bottom', [P(-hx, -hy, z0), P(-hx, hy, z0), P(hx, hy, z0), P(hx, -hy, z0)], (0, 0, -1), slot, col),
    ]
    for name, pts, hint, sl, cl in f:
        if name not in skip:
            b.facing(pts, hint, sl, cl, scale=scale)


def beam(b, p0, p1, z0, z1, width, slot='plain-render', col='#d8d8d8', skip=('bottom',)):
    """A box along the horizontal line p0 -> p1 (2D points), width wide, z0..z1 tall."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    obox(b, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, z0, L, width, z1 - z0, math.atan2(dy, dx), slot, col, skip=skip)


def column(b, x, y, z0, z1, r=0.3, look=None, kind='round', capital=True, slot=None, col=None, n=None):
    """A column: shaft (tapered slightly), plinth and capital at detail 0. kind: round | square."""
    slot = slot or (look.wall_slot if look else 'plain-render')
    col = col or (look.trim_col if look else '#d8d8d8')
    n = n or {0: 10, 1: 5, 2: 4}[b.detail]
    h = z1 - z0
    if kind == 'square':
        box_c(b, x, y, z0, 2 * r, 2 * r, h, slot, col, skip=('bottom',))
        if capital and b.detail == 0:
            box_c(b, x, y, z1 - 0.2, 2 * r * 1.35, 2 * r * 1.35, 0.2, slot, col)
        return
    cylinder(b, x, y, z0, z1, r, n=n, slot=slot, col=col, r_top=r * 0.92, top=capital is False)
    if capital and b.detail == 0:
        cylinder(b, x, y, z1 - 0.18, z1, r * 1.35, n=n, slot=slot, col=col, r_top=r * 1.35, top=True, smooth=False)
        cylinder(b, x, y, z0, z0 + 0.16, r * 1.25, n=n, slot=slot, col=col, r_top=r * 1.25, top=True, smooth=False)


def colonnade(b, p0, p1, z0, z1, count, look, r=0.3, kind='round', beam_h=0.6, beam_w=None, slot=None, col=None, capital=True):
    """`count` columns on the line p0 -> p1 (ends included) carrying an architrave beam on top."""
    pts = [(p0[0] + (p1[0] - p0[0]) * k / max(1, count - 1), p0[1] + (p1[1] - p0[1]) * k / max(1, count - 1)) for k in range(count)]
    for (x, y) in pts:
        column(b, x, y, z0, z1 - beam_h, r, look, kind, capital, slot, col)
    if beam_h > 0:
        beam(b, p0, p1, z1 - beam_h, z1, beam_w or r * 2.6, slot or look.wall_slot, col or look.trim_col)
    return pts


def portico(b, cx, y_front, z0, width, depth, height, look, cols=6, pediment=True, steps_n=4, r=None, rise=None):
    """A classical portico on the -Y face of a wall at y = y_front: columns, entablature, optional triangular pediment, steps.
    It stands in front of the wall (towards -Y) and is `depth` deep; height is to the underside of the entablature + pediment base."""
    r = r or min(0.45, width / cols / 4)
    x0, x1 = cx - width / 2, cx + width / 2
    yc = y_front - depth + r
    zt = z0 + height
    if steps_n:
        steps(b, x0 - 1.0, x1 + 1.0, y_front - depth - 0.0, 0.18 * steps_n, 0.4 * steps_n, steps_n, 'paving', look.stone_col)
    # floor slab
    box(b, x0 - 0.3, y_front - depth - 0.3, 0, x1 + 0.3, y_front, z0, look.wall_slot, shade(look.trim_col, 0.9))
    for k in range(cols):
        x = x0 + r + (width - 2 * r) * k / max(1, cols - 1)
        column(b, x, yc, z0, zt, r, look)
    box(b, x0 - 0.3, y_front - depth - 0.2, zt, x1 + 0.3, y_front, zt + 0.7, look.wall_slot, look.trim_col)
    if pediment:
        ph = rise or width * 0.11
        gable(b, (x0 - 0.3, y_front - depth - 0.2, x1 + 0.3, y_front), zt + 0.7, ph, look, axis='y', ov=0.0, slot=look.roof_slot, col=look.roof_col,
              gable_slot=look.wall_slot, gable_col=look.trim_col)
    else:
        box(b, x0 - 0.3, y_front - depth - 0.2, zt + 0.7, x1 + 0.3, y_front, zt + 1.0, 'roof-flat', look.roof_col)


# ---------------------------------------------------------------------------------------------------------------- canopies
def canopy_flat(b, x0, y0, x1, y1, z, look, th=0.35, columns=None, col=None, edge_col=None, r=0.22, slot=None, col_kind='round', pad=True):
    """A flat canopy slab with a deep fascia. `columns`: list of (x, y) supports, or an int (evenly spaced along the front edge)."""
    col = col or look.roof_col
    ec = edge_col or look.trim_col
    box(b, x0, y0, z - th, x1, y1, z, slot or look.wall_slot, ec, top_slot='roof-flat', top_col=col, skip=())
    if isinstance(columns, int):
        n = columns
        columns = [(x0 + r + 0.3 + (x1 - x0 - 2 * r - 0.6) * k / max(1, n - 1), y0 + 0.9) for k in range(n)]
    for (x, y) in (columns or []):
        column(b, x, y, 0, z - th, r, look, col_kind, capital=False, col=look.metal_col if col_kind == 'round' else look.trim_col)


def canopy_curved(b, x0, y0, x1, y1, z, rise, look, th=0.3, axis='x', columns=None, col=None, r=0.2, segments=None):
    """A curved (barrel-vault) canopy, springing at z, crown z + rise, running along `axis`; thin shell with visible underside."""
    n = segments or {0: 10, 1: 5, 2: 3}[b.detail]
    k = 0 if axis == 'x' else 1
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    w, d = (x1 - x0, y1 - y0) if k == 0 else (y1 - y0, x1 - x0)
    R = (d * d / 4 + rise * rise) / (2 * rise)
    a0 = math.asin(min(1.0, d / 2 / R))
    arc = [(R * math.sin(-a0 + 2 * a0 * j / n), z - (R - rise) + R * math.cos(-a0 + 2 * a0 * j / n)) for j in range(n + 1)]
    r_ = _Rot(b, cx, cy, k)
    top = [[(x, y, zz) for (y, zz) in arc] for x in (-w / 2, w / 2)]
    r_.grid(top, 'metal-roof', col or look.roof_col, smooth=True)
    if b.detail < 2:
        under = [[(x, y, zz - th) for (y, zz) in arc[::-1]] for x in (w / 2, -w / 2)]
        r_.grid(under, 'plain-render', shade(col or look.roof_col, 0.7), smooth=True)
        for x, hint in ((-w / 2, (-1, 0, 0)), (w / 2, (1, 0, 0))):
            poly = [(x, y, zz) for (y, zz) in arc] + [(x, y, zz - th) for (y, zz) in arc[::-1]]
            r_.facing(poly, hint, 'plain-render', look.trim_col)
    for (x, y) in (columns or []):
        column(b, x, y, 0, z - th, r, look, 'round', capital=False, col=look.metal_col)


# ----------------------------------------------------------------------------------------------------------------- towers
def tower(b, cx, cy, z0, w, d, h, look, storeys=None, windows='ribbon', cap='flat', cap_rise=None, round_=False, taper=0.0, ratio=0.5,
          wall_slot=None, wall_col=None, parapet_h=0.6, sides=None):
    """A free-standing tower (belfry, clock tower, lift core, tall block). cap: flat|hip|pyramid|gable|dome|none.
    round_=True makes it a polygonal drum (sides sides). taper shrinks width/depth towards the top (square towers only)."""
    storeys = storeys or max(1, int(h / 3.6))
    ws, wc = wall_slot or look.wall_slot, wall_col or look.wall_col
    if round_:
        n = sides or {0: 16, 1: 10, 2: 6}[b.detail]
        fp = fp_round(w / 2, n)
        fp = fp.moved(cx, cy)
        walls(b, fp, z0, z0 + h, storeys, look, kind=windows, ratio=ratio, wall_slot=ws, wall_col=wc, plinth=0, rear='same')
    elif taper > 0:
        # sloping plain sides (windows would need a sheared facade); the cap sits on the smaller top rectangle
        for k in range(4):
            a_, b_ = [(-1, -1), (1, -1), (1, 1), (-1, 1)][k], [(-1, -1), (1, -1), (1, 1), (-1, 1)][(k + 1) % 4]
            P = lambda s, zz, f: (cx + s[0] * (w / 2) * f, cy + s[1] * (d / 2) * f, z0 + zz)
            b.face([P(a_, 0, 1.0), P(b_, 0, 1.0), P(b_, h, 1 - taper), P(a_, h, 1 - taper)], ws, wc)
        w, d = w * (1 - taper), d * (1 - taper)
        fp = fp_rect(w, d, cx, cy)
    else:
        fp = fp_rect(w, d, cx, cy)
        walls(b, fp, z0, z0 + h, storeys, look, kind=windows, ratio=ratio, wall_slot=ws, wall_col=wc, plinth=0, rear='same')
    zt = z0 + h
    rect = (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)
    if cap == 'flat':
        flat_roof(b, fp, zt, look, parapet_h=parapet_h)
    elif cap in ('hip', 'pyramid'):
        hip(b, rect, zt, cap_rise or w * 0.9, look, ov=0.3)
    elif cap == 'gable':
        gable(b, rect, zt, cap_rise or w * 0.45, look, ov=0.3)
    elif cap == 'dome':
        dome(b, cx, cy, zt, min(w, d) / 2, look)
    elif cap == 'cone' or (round_ and cap == 'pyramid'):
        cylinder(b, cx, cy, zt, zt + (cap_rise or w), w / 2 + 0.2, n=16, slot=look.roof_slot, col=look.roof_col, r_top=0.0)
    return fp


# ----------------------------------------------------------------------------------------------------------------- ground
def ground(b, x0, y0, x1, y1, look, slot=None, col=None, z=0.0, scale=3.0):
    """A flat ground quad (faces up) at height z, tile-scaled `scale` times so a big pad stays cheap."""
    with b.site():
        return _ground_impl(b, x0, y0, x1, y1, look, slot, col, z, scale)


def _ground_impl(b, x0, y0, x1, y1, look, slot=None, col=None, z=0.0, scale=3.0):
    """A flat ground quad (faces up) at height z, tile-scaled `scale` times so a big pad stays cheap."""
    if b.detail >= 2:
        return
    s = scale * (2 if b.detail == 1 else 1)
    b.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], slot or look.ground_slot, col or look.ground_col, scale=s)


def tree(b, kind, x, y, h, rng, look=None, col=None):
    """A low-poly tree of height h at (x, y). kind: palm|broadleaf|acacia|conifer|none. Skipped at detail 2."""
    with b.site():
        return _tree_impl(b, kind, x, y, h, rng, look, col)


def _tree_impl(b, kind, x, y, h, rng, look=None, col=None):
    """A low-poly tree of height h at (x, y). kind: palm|broadleaf|acacia|conifer|none. Skipped at detail 2."""
    if kind in (None, 'none') or b.detail >= 2:
        return
    foliage = col or (look.tree_col if look and hasattr(look, 'tree_col') else '#5f8f45')
    foliage = jitter(foliage, rng, 0.12)
    bark = '#6b5240'
    lo = b.detail == 1
    if kind == 'palm':
        th = h * 0.8
        lean = (rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6))
        cylinder(b, x, y, 0, th * 0.5, h * 0.025, n=5, slot='timber', col=bark, r_top=h * 0.02, top=False)
        cylinder(b, x + lean[0] * 0.5, y + lean[1] * 0.5, th * 0.5, th, h * 0.02, n=5, slot='timber', col=bark, r_top=h * 0.018, top=True)
        tx, ty = x + lean[0], y + lean[1]
        nf = 5 if lo else 8
        for k in range(nf):
            a = 2 * math.pi * k / nf + rng.uniform(-0.2, 0.2)
            ca, sa = math.cos(a), math.sin(a)
            L = h * 0.38
            pw = h * 0.07
            px, py = -sa, ca
            pts = [(tx, ty, th), (tx + ca * L * 0.5, ty + sa * L * 0.5, th + h * 0.1), (tx + ca * L, ty + sa * L, th - h * 0.08)]
            # frond = two triangles forming a leaf blade, both sides
            blade = [(pts[0][0], pts[0][1], pts[0][2]), (pts[1][0] + px * pw, pts[1][1] + py * pw, pts[1][2]), (pts[2][0], pts[2][1], pts[2][2]), (pts[1][0] - px * pw, pts[1][1] - py * pw, pts[1][2])]
            b.face(blade, 'plain', foliage)
            b.face(blade[::-1], 'plain', shade(foliage, 0.8))
        return
    if kind == 'conifer':
        cylinder(b, x, y, 0, h * 0.18, h * 0.03, n=5, slot='timber', col=bark, top=False)
        tiers = 2 if lo else 4
        for t in range(tiers):
            z0 = h * (0.12 + 0.2 * t)
            rr = h * 0.2 * (1 - t / (tiers + 0.5)) + h * 0.04
            cylinder(b, x, y, z0, z0 + h * 0.42 * (1 - t * 0.12), rr, n=6 if lo else 8, slot='plain', col=jitter(foliage, rng, 0.05), r_top=0.0, smooth=False, bottom=False)
        return
    # broadleaf / acacia: trunk + ellipsoid crowns
    tr = h * 0.03
    if kind == 'acacia':
        cylinder(b, x, y, 0, h * 0.62, tr, n=5, slot='timber', col=bark, r_top=tr * 0.7, top=False)
        crowns = [(0.0, 0.0, h * 0.78, h * 0.5, h * 0.5, h * 0.13)]
        if not lo:
            crowns += [(h * 0.2, h * 0.05, h * 0.72, h * 0.3, h * 0.3, h * 0.09), (-h * 0.18, -h * 0.05, h * 0.74, h * 0.3, h * 0.3, h * 0.09)]
    else:
        cylinder(b, x, y, 0, h * 0.45, tr, n=5, slot='timber', col=bark, r_top=tr * 0.8, top=False)
        crowns = [(0, 0, h * 0.68, h * 0.34, h * 0.34, h * 0.3)]
        if not lo:
            crowns += [(h * 0.17, h * 0.07, h * 0.58, h * 0.24, h * 0.24, h * 0.22), (-h * 0.16, -h * 0.1, h * 0.6, h * 0.23, h * 0.23, h * 0.21)]
    for (dx, dy, zc, rx, ry, rz) in crowns:
        blob(b, x + dx, y + dy, zc, rx, ry, rz, jitter(foliage, rng, 0.1), n=6 if lo else 8, rings=3 if lo else 4)


def blob(b, cx, cy, cz, rx, ry, rz, col, n=8, rings=4, slot='plain', smooth=True):
    """A closed ellipsoid (smooth-shaded) for foliage and bushes."""
    angs = [2 * math.pi * k / n for k in range(n + 1)]
    ph = [-math.pi / 2 + math.pi * j / rings for j in range(rings + 1)]
    grid = [[(cx + rx * math.cos(p) * math.cos(a), cy + ry * math.cos(p) * math.sin(a), cz + rz * math.sin(p)) for p in ph] for a in angs]
    b.shared_grid(grid, slot, col, smooth=smooth, wrap=True)


def car(b, x, y, yaw, col, rng=None):
    """A small low-poly car (about 4.3 x 1.8 m, 26 triangles at detail 0)."""
    with b.site():
        return _car_impl(b, x, y, yaw, col, rng)


def _car_impl(b, x, y, yaw, col, rng=None):
    """A small low-poly car (about 4.3 x 1.8 m, 26 triangles at detail 0)."""
    if b.detail >= 2:
        return
    obox(b, x, y, 0.28, 4.3, 1.8, 0.7, yaw, 'plain', col)
    obox(b, x - math.cos(yaw) * 0.15, y - math.sin(yaw) * 0.15, 0.98, 2.3, 1.6, 0.55, yaw, 'plain', '#2d3640', top_col=shade(col, 0.95))
    if b.detail == 0:
        obox(b, x, y, 0.0, 3.6, 1.6, 0.3, yaw, 'plain', '#1e1e20')


def lamp(b, x, y, h=7.0, look=None):
    """A street lamp post with a small head."""
    with b.site():
        return _lamp_impl(b, x, y, h, look)


def _lamp_impl(b, x, y, h=7.0, look=None):
    """A street lamp post with a small head."""
    if b.detail >= 1:
        return
    cylinder(b, x, y, 0, h, 0.07, n=5, slot='frame', col='#7d8286', r_top=0.05, top=True)
    box_c(b, x, y, h, 0.7, 0.3, 0.12, 'frame', '#3c4045')


def sign_board(b, x, y, z, w, h, look=None, facing=0.0, posts=True, col='#2f6b4f', frame_col='#b8bcc0'):
    """A BLANK sign board (no lettering, per the contract) facing -Y when facing=0; yaw in radians. z is the bottom of the board."""
    obox(b, x, y, z, w, 0.18, h, facing, 'plain', col, skip=('bottom',))
    if posts:
        c, s = math.cos(facing), math.sin(facing)
        for sx in (-w * 0.4, w * 0.4):
            cylinder(b, x + c * sx, y + s * sx, 0, z, 0.08, n=5, slot='frame', col=frame_col, top=False)


def forecourt(b, kind, x0, y0, x1, y1, look, rng, density=1.0, orient='x', tree_h=7.0):
    """Surface treatment of a rectangle (usually the strip in front of the building).
    kind: parking (asphalt, white bay lines, parked cars) | plaza (paving, border, lamps) | garden (lawn, paths, trees, hedges) |
          road (asphalt road along x with kerbs and dashed centre line) | water (a pool or lake edge) | none."""
    with b.site():
        return _forecourt_impl(b, kind, x0, y0, x1, y1, look, rng, density, orient, tree_h)


def _forecourt_impl(b, kind, x0, y0, x1, y1, look, rng, density=1.0, orient='x', tree_h=7.0):
    """Surface treatment of a rectangle (usually the strip in front of the building).
    kind: parking (asphalt, white bay lines, parked cars) | plaza (paving, border, lamps) | garden (lawn, paths, trees, hedges) |
          road (asphalt road along x with kerbs and dashed centre line) | water (a pool or lake edge) | none."""
    if kind in (None, 'none') or b.detail >= 2:
        return
    z = 0.07
    w, d = x1 - x0, y1 - y0
    lod = b.detail
    if kind == 'parking':
        ground(b, x0, y0, x1, y1, look, 'asphalt', '#6a6c6f', z=0.05)
        pitch, bay_len = 2.7, 5.0
        rows = max(1, int(d // (bay_len * 2 + 6))) if d > bay_len * 2 + 6 else 1
        y = y0 + 1.5
        cols = ['#c9ccd0', '#2a2d33', '#8a1f1f', '#e6e6e6', '#27456e', '#6b6e72', '#e0c25a', '#3c6b49']
        for rrow in range(rows):
            yb = y0 + 2.5 + rrow * (bay_len * 2 + 6)
            if yb + bay_len > y1:
                break
            n = int((w - 6) // pitch)
            for k in range(n + 1):
                xl = x0 + 3 + k * pitch
                b.face([(xl - 0.06, yb, z + 0.01), (xl + 0.06, yb, z + 0.01), (xl + 0.06, yb + bay_len, z + 0.01), (xl - 0.06, yb + bay_len, z + 0.01)], 'plain', '#f1f1ee') if lod == 0 else None
                if k < n and rng.random() < 0.38 * density and (lod == 0 or rng.random() < 0.3):
                    car(b, xl + pitch / 2, yb + bay_len / 2, math.pi / 2 + rng.uniform(-0.03, 0.03), rng.choice(cols), rng)
            # opposite bank
            yb2 = yb + bay_len + 6
            if yb2 + bay_len <= y1 and lod == 0:
                for k in range(n + 1):
                    xl = x0 + 3 + k * pitch
                    b.face([(xl - 0.06, yb2, z + 0.01), (xl + 0.06, yb2, z + 0.01), (xl + 0.06, yb2 + bay_len, z + 0.01), (xl - 0.06, yb2 + bay_len, z + 0.01)], 'plain', '#f1f1ee')
                    if k < n and rng.random() < 0.38 * density:
                        car(b, xl + pitch / 2, yb2 + bay_len / 2, math.pi / 2 + rng.uniform(-0.03, 0.03), rng.choice(cols), rng)
        # kerb island with trees at the ends
        for tx in (x0 + 4, x1 - 4):
            if look.tree not in (None, 'none'):
                tree(b, look.tree, tx, y1 - 1.5, tree_h * 0.8, rng, look)
    elif kind == 'plaza':
        ground(b, x0, y0, x1, y1, look, 'paving', mix(look.stone_col, '#ffffff', 0.2), z=0.05, scale=1.0)
        if lod == 0:
            m = 1.2
            for (a0, b0, a1, b1) in ((x0, y0, x1, y0 + m), (x0, y1 - m, x1, y1), (x0, y0, x0 + m, y1), (x1 - m, y0, x1, y1)):
                b.face([(a0, b0, z + 0.01), (a1, b0, z + 0.01), (a1, b1, z + 0.01), (a0, b1, z + 0.01)], 'paving', shade(look.stone_col, 0.82))
            for tx in range(int(w // 18)):
                lamp(b, x0 + 9 + tx * 18, y0 + 2, 6.0)
    elif kind == 'garden':
        ground(b, x0, y0, x1, y1, look, 'grass', '#6d9a4f' if look.ground_slot != 'grass' else look.ground_col, z=0.05, scale=2.0)
        px = (x0 + x1) / 2
        b.face([(px - 1.4, y0, 0.05), (px + 1.4, y0, 0.05), (px + 1.4, y1, 0.05), (px - 1.4, y1, 0.05)], 'paving', '#cbc6bb')
        n = max(2, int(w / 14 * density))
        for k in range(n):
            tx = x0 + 4 + rng.random() * (w - 8)
            if abs(tx - px) < 3:
                tx += 5
            tree(b, look.tree, min(max(tx, x0 + 2), x1 - 2), y0 + 3 + rng.random() * (d - 6), tree_h * rng.uniform(0.8, 1.1), rng, look)
        if lod == 0:
            blob(b, x0 + 2, y0 + 2, 0.4, 1.6, 1.2, 0.5, '#4f7d3b', n=6, rings=3)
    elif kind == 'road':
        ground(b, x0, y0, x1, y1, look, 'asphalt', '#5a5c5f', z=0.05)
        if lod == 0:
            yc = (y0 + y1) / 2
            n = int(w // 8)
            for k in range(n):
                xa = x0 + 2 + k * 8
                b.face([(xa, yc - 0.08, z + 0.01), (xa + 3.5, yc - 0.08, z + 0.01), (xa + 3.5, yc + 0.08, z + 0.01), (xa, yc + 0.08, z + 0.01)], 'plain', '#efefe8')
            box(b, x0, y1 - 0.25, 0, x1, y1, 0.14, 'paving', '#b8b4aa', skip=('bottom', 'back'))
            box(b, x0, y0, 0, x1, y0 + 0.25, 0.14, 'paving', '#b8b4aa', skip=('bottom', 'front'))
    elif kind == 'water':
        ground(b, x0, y0, x1, y1, look, 'plain-render', '#5f98b3', z=0.05)
        if lod == 0:
            box(b, x0, y1 - 0.5, 0, x1, y1, 0.3, 'paving', '#c8c4ba')


def roof_shell(b, top, thickness, look, slot='metal-roof', col=None, under_col=None, edge_col=None, smooth=True):
    """A thin curved roof shell from a grid of points `top[i][j]`: rows i run along +x, columns j run along +y, so the top surface
    faces up. Adds the smooth top, an underside `thickness` below (detail 0/1) and four fascia edges. The caller owns the shape (sine
    waves, swoops, vaults ...): this only skins it. Returns the underside z at the four edges is up to the caller (z - thickness)."""
    col = col or look.roof_col
    b.shared_grid(top, slot, col, smooth=smooth, scale=1.0)
    if b.detail >= 2:
        return
    R, C = len(top), len(top[0])
    if b.detail == 0:
        under = [[(p[0], p[1], p[2] - thickness) for p in row[::-1]] for row in top]
        b.shared_grid(under, 'plain-render', under_col or shade(col, 0.62), smooth=smooth, scale=2.0)
    ec = edge_col or shade(col, 0.85)
    for i in range(R - 1):
        a, c = top[i], top[i + 1]
        # front (j = 0) and back (j = C - 1) edges
        b.facing([(a[0][0], a[0][1], a[0][2] - thickness), (c[0][0], c[0][1], c[0][2] - thickness), c[0], a[0]], (0, -1, 0), 'plain-render', ec)
        b.facing([(a[-1][0], a[-1][1], a[-1][2] - thickness), (c[-1][0], c[-1][1], c[-1][2] - thickness), c[-1], a[-1]], (0, 1, 0), 'plain-render', ec)
    for idx, hint in ((0, (-1, 0, 0)), (R - 1, (1, 0, 0))):
        row = top[idx]
        poly = [p for p in row] + [(p[0], p[1], p[2] - thickness) for p in row[::-1]]
        b.facing(poly, hint, 'plain-render', ec)
