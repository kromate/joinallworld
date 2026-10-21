"""Private helpers shared by the hospital, campus-block, civic-palace, civic-small and museum-theatre archetypes.

Plan coordinates: the building is centred on x = 0 and y = 0, the main facade faces -Y, ground at z = 0. Everything that stands
outside the building (fences, tanks, vehicles, flag poles, trees, ground) goes into the site layer via `with b.site():`.
"""
import math
import random

import lib
from lib import shade, mix

# --------------------------------------------------------------------------------------------------------------- brief
ROOF_MAT_SLOT = {
    'metal-sheet': 'metal-roof', 'corrugated': 'corrugated', 'clay-tile': 'clay-tile', 'slate': 'slate', 'concrete': 'roof-flat',
    'membrane': 'roof-flat', 'copper': 'metal-roof', 'gold-leaf': 'metal-roof', 'thatch': 'timber', 'timber-shingle': 'timber',
    'glass': 'glass-ribbon',
}


def feats(brief):
    out = {}
    for f in brief.get('features') or []:
        if isinstance(f, dict):
            out[f.get('id')] = f
        else:
            out[f] = {'id': f, 'count': 1}
    return out


def text(brief):
    return ' '.join(str(brief.get(k) or '') for k in ('name', 'subject', 'notes', 'style', 'era')).lower()


def has(txt, *words):
    return any(w in txt for w in words)


def num(v, default):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def era_year(brief):
    """First four-digit year in the era string (or 0)."""
    s = str(brief.get('era') or '')
    import re
    m = re.search(r'(1[5-9]\d\d|20\d\d)', s)
    if m:
        return int(m.group(1))
    m = re.search(r'(1[5-9])th', s)
    if m:
        return (int(m.group(1)) - 1) * 100 + 50
    m = re.search(r'(1[5-9]\d)0s', s)
    if m:
        return int(m.group(1)) * 10 + 5
    return 0


def dims(brief, w_def=40.0, d_def=18.0, st_def=2, h_def=None, w_max=112.0, d_max=100.0, st_h=3.6):
    """(width, depth, storeys, height) of the main mass from the brief. Briefs with confidence 'low' are typed guesses (the same
    typed brief can appear in many cities), so their size is varied by a few percent and a storey, seeded by city/venue id, which
    keeps look-alike places apart; briefs describing the real building are used as given."""
    form = brief.get('form') or {}
    w = num(form.get('width_m'), w_def)
    d = num(form.get('depth_m'), d_def)
    st = int(clamp(num(form.get('storeys'), st_def), 1, 14))
    h = num(form.get('height_m'), h_def if h_def else st * st_h + 1.0)
    if (brief.get('confidence') or 'low') == 'low':
        r = random.Random('%s/%s/dims' % (brief.get('city'), brief.get('venueId')))
        w *= r.uniform(0.84, 1.16)
        d *= r.uniform(0.86, 1.14)
        if st >= 3 and r.random() < 0.55:
            st2 = max(1, st + r.choice([-1, 1]))
            h = h * st2 / st
            st = st2
        else:
            h *= r.uniform(0.93, 1.09)
    w = clamp(w, 6.0, w_max)
    d = clamp(d, 5.0, d_max)
    h = clamp(h, 2.6, 60.0)
    return w, d, st, h


def look_for(brief, style, rng):
    """lib.look plus the brief's own roofMaterial (the lib only reads the city style's)."""
    lk = lib.look(brief, style, rng)
    f = brief.get('facade') or {}
    rm = f.get('roofMaterial')
    if rm in ROOF_MAT_SLOT:
        lk.roof_slot = ROOF_MAT_SLOT[rm]
    lk.roof_mat = rm or ((style or {}).get('roofMaterials') or ['metal-sheet'])[0]
    lk.tree_col = '#5f8f45'
    if low_conf(brief) and (style or {}).get('wallColours'):
        # typed guess: the city's common wall colours are all plausible, so pick this place's own (seeded by city / venue id)
        r = random.Random('%s/%s/col' % (brief.get('city'), brief.get('venueId')))
        if r.random() < 0.75:
            lk.wall_col = r.choice(style['wallColours'])
            lk.trim_col = shade(lk.wall_col, 1.07)
            lk.frame_col = shade(lk.trim_col, 0.8)
        if style.get('roofColours') and r.random() < 0.5:
            lk.roof_col = r.choice(style['roofColours'])
    return lk


def new_builder(name, detail, coarse=0, lod1_scale=3.0, brief=None):
    """A lib.Builder that knows its `coarse` level; at LOD1 every face's texture tile is enlarged so large walls and roofs are not
    cut at every tile border (the cheapest way to hit the LOD1 budget without touching the library)."""
    b = lib.Builder(name, detail)
    b.coarse = coarse
    b.brief = brief or {}
    if detail == 1:
        face0, grid0 = b.face, b.shared_grid

        def face(pts, slot='plain', col=None, smooth=False, uvs=None, mode=None, scale=1.0):
            return face0(pts, slot, col, smooth, uvs, mode, scale * lod1_scale)

        def shared_grid(grid, slot, col, smooth=True, uvs=None, wrap=False, scale=1.0):
            return grid0(grid, slot, col, smooth, uvs, wrap, scale * lod1_scale)
        b.face, b.shared_grid = face, shared_grid
    return b


def run(build, rng, detail, limits=(17800, 3700, 470), tries=8):
    """Build with growing `coarse` (0 = full detail) until the triangle budget fits. `build(rng, coarse) -> Builder`."""
    seed = rng.getrandbits(64)
    b = None
    for coarse in range(tries):
        b = build(random.Random(seed), coarse)
        if b.tris <= limits[detail]:
            break
    return b.objects()


# -------------------------------------------------------------------------------------------------------------- plans
def union_fp(rects):
    """Footprint of the union of axis-aligned (x0, y0, x1, y1) rectangles (outer loop CCW first, holes CW)."""
    xs = sorted({round(r[0], 4) for r in rects} | {round(r[2], 4) for r in rects})
    ys = sorted({round(r[1], 4) for r in rects} | {round(r[3], 4) for r in rects})
    nx, ny = len(xs) - 1, len(ys) - 1
    fill = [[False] * ny for _ in range(nx)]
    for i in range(nx):
        for j in range(ny):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            fill[i][j] = any(r[0] < cx < r[2] and r[1] < cy < r[3] for r in rects)
    edges = {}

    def add(a, c):
        edges.setdefault(a, []).append(c)
    for i in range(nx):
        for j in range(ny):
            if not fill[i][j]:
                continue
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            if j == 0 or not fill[i][j - 1]:
                add((x0, y0), (x1, y0))
            if i == nx - 1 or not fill[i + 1][j]:
                add((x1, y0), (x1, y1))
            if j == ny - 1 or not fill[i][j + 1]:
                add((x1, y1), (x0, y1))
            if i == 0 or not fill[i - 1][j]:
                add((x0, y1), (x0, y0))
    loops = []
    used = set()
    for start in sorted(edges):
        for end in edges[start]:
            if (start, end) in used:
                continue
            loop = [start]
            cur = (start, end)
            while cur not in used:
                used.add(cur)
                a, c = cur
                loop.append(c)
                nxt = None
                for e in edges.get(c, []):
                    if (c, e) not in used:
                        nxt = (c, e)
                        break
                if nxt is None:
                    break
                cur = nxt
            pts = loop[:-1] if loop[-1] == loop[0] else loop
            # drop collinear points
            out = []
            for k, p in enumerate(pts):
                q, r = pts[k - 1], pts[(k + 1) % len(pts)]
                if abs((p[0] - q[0]) * (r[1] - p[1]) - (p[1] - q[1]) * (r[0] - p[0])) > 1e-6:
                    out.append(p)
            if len(out) >= 3:
                loops.append(out)

    def area(pl):
        return sum(pl[i][0] * pl[(i + 1) % len(pl)][1] - pl[(i + 1) % len(pl)][0] * pl[i][1] for i in range(len(pl))) / 2
    outers = sorted([l for l in loops if area(l) > 0], key=lambda l: -area(l))
    holes = [l for l in loops if area(l) < 0]
    return lib.Footprint(outers + holes, [tuple(r) for r in rects])


def plan_rects(kind, w, d, rng=None, bar_d=None, wing_w=None, open_to='back', wings=None, side='right'):
    """Wing rectangles (x0, y0, x1, y1, role) for a brief footprint, centred on (0, 0), front at y = -d / 2.
    kind: rect L U T H ring cross irregular E comb. bar_d = depth of the front bar, wing_w = width of the wings."""
    oy = -d / 2
    hw = w / 2
    ww = clamp(wing_w if wing_w else w * 0.2, 6.0, w / 2.6)
    bd = clamp(bar_d if bar_d else d * 0.4, 5.0, d * 0.8)
    if kind == 'L':
        s = 1 if side == 'right' else -1
        wx0, wx1 = (hw - ww, hw) if s == 1 else (-hw, -hw + ww)
        return [(-hw, oy, hw, oy + bd, 'bar'), (wx0, oy + bd, wx1, oy + d, 'wing')]
    if kind == 'U':
        if open_to == 'front':
            return [(-hw, oy + d - bd, hw, oy + d, 'bar'), (-hw, oy, -hw + ww, oy + d - bd, 'wing'), (hw - ww, oy, hw, oy + d - bd, 'wing')]
        return [(-hw, oy, hw, oy + bd, 'bar'), (-hw, oy + bd, -hw + ww, oy + d, 'wing'), (hw - ww, oy + bd, hw, oy + d, 'wing')]
    if kind == 'H':
        bar = clamp(bar_d if bar_d else d * 0.35, 5.0, d * 0.7)
        return [(-hw, oy, -hw + ww, oy + d, 'wing'), (hw - ww, oy, hw, oy + d, 'wing'),
                (-hw + ww, oy + (d - bar) / 2, hw - ww, oy + (d + bar) / 2, 'bar')]
    if kind in ('E', 'comb'):
        n = wings or 3
        out = [(-hw, oy, hw, oy + bd, 'bar')]
        gap = (w - n * ww) / max(1, n - 1)
        for k in range(n):
            x0 = -hw + k * (ww + gap)
            out.append((x0, oy + bd, x0 + ww, oy + d, 'wing'))
        return out
    if kind == 'T':
        sw = clamp(w * 0.3, 8.0, w * 0.5)
        return [(-hw, oy, hw, oy + bd, 'bar'), (-sw / 2, oy + bd, sw / 2, oy + d, 'wing')]
    if kind == 'cross':
        sw = clamp(w * 0.28, 8.0, w * 0.4)
        sd = clamp(d * 0.3, 6.0, d * 0.5)
        return [(-hw, -sd / 2, hw, sd / 2, 'bar'), (-sw / 2, oy, sw / 2, -sd / 2, 'wing'), (-sw / 2, sd / 2, sw / 2, oy + d, 'wing')]
    if kind == 'ring':
        cw = clamp(w * 0.5, 4.0, w - 2 * ww)
        cd = clamp(d * 0.5, 4.0, d - 2 * ww)
        ow = (w - cw) / 2
        od = (d - cd) / 2
        return [(-hw, oy, hw, oy + od, 'bar'), (-hw, oy + d - od, hw, oy + d, 'wing'),
                (-hw, oy + od, -hw + ow, oy + d - od, 'wing'), (hw - ow, oy + od, hw, oy + d - od, 'wing')]
    if kind == 'irregular':
        s = 1 if side == 'right' else -1
        ww2 = clamp(w * 0.38, 6.0, w * 0.6)
        wx0, wx1 = (hw - ww2, hw) if s == 1 else (-hw, -hw + ww2)
        return [(-hw, oy, hw, oy + d * 0.6, 'bar'), (wx0, oy + d * 0.6, wx1, oy + d, 'wing')]
    return [(-hw, oy, hw, oy + d, 'bar')]


def bbox_of(rects):
    return (min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects))


def covered(seg, others, eps=0.12):
    """True if the wall segment lies inside other solids (so it would only be a hidden interior face)."""
    n = 0
    for f in (0.1, 0.3, 0.5, 0.7, 0.9):
        p = seg.P(seg.length * f, 0.0, -eps)  # just outside
        px, py = p[0], p[1]
        if any(r[0] - 1e-6 <= px <= r[2] + 1e-6 and r[1] - 1e-6 <= py <= r[3] + 1e-6 for r in others):
            n += 1
    return n == 5


def _lod1_edge(b, lk, seg, z0, z1, storeys, kind, ratio, bay, ws, wc, ground_kind, ground_h=None):
    L = seg.length
    H = z1 - z0
    storeys = max(1, int(storeys))
    P = seg.P
    if kind == 'none':
        b.face([P(0, z0), P(L, z0), P(L, z1), P(0, z1)], ws, wc, scale=8.0)
        return
    b.face([P(0, z0), P(L, z0), P(L, z1), P(0, z1)], ws, wc, scale=8.0)
    hs = H / storeys
    for si in range(storeys):
        zb, zt = z0 + si * hs, z0 + (si + 1) * hs
        k = ground_kind if (si == 0 and ground_kind) else kind
        if k == 'curtain':
            b.face([P(0.2, zb + 0.15, -0.03), P(L - 0.2, zb + 0.15, -0.03), P(L - 0.2, zt - 0.15, -0.03), P(0.2, zt - 0.15, -0.03)], lk.glass_slot, lk.glass_col, mode='tile', scale=3.0)
        elif k in ('ribbon', 'screen', 'louvre'):
            bh = hs * min(0.7, max(0.3, ratio))
            sill = zb + (hs - bh) * 0.55
            slot = 'glass-ribbon' if k == 'ribbon' else 'metal-cladding'
            col = lk.glass_col if k == 'ribbon' else shade(lk.accent_col, 0.7)
            b.face([P(0.2, sill, -0.03), P(L - 0.2, sill, -0.03), P(L - 0.2, sill + bh, -0.03), P(0.2, sill + bh, -0.03)], slot, col, mode='tile', scale=3.0)
        else:
            bw = (bay or 3.4) * 2.2
            nb = max(1, round(L / bw))
            bw = L / nb
            oh = min(hs * 0.58, 2.6)
            ow = max(0.7, min(bw - 0.7, ratio * bw * hs / oh))
            sill = zb + (hs - oh) * 0.42
            for i in range(nb):
                c = (i + 0.5) * bw
                b.face([P(c - ow / 2, sill, -0.03), P(c + ow / 2, sill, -0.03), P(c + ow / 2, sill + oh, -0.03), P(c - ow / 2, sill + oh, -0.03)], 'glass-punched', lk.glass_col)


def walls(b, fp, z0, z1, storeys, lk, rng=None, edges=None, kind=None, ratio=None, front_kind=None, ground_kind=None, bay=None, wall_slot=None,
          wall_col=None, **kw):
    """lib.walls, except that LOD1 uses a cheaper wall builder (one big wall face and per-storey glazing quads: lib.walls cuts the
    wall at every texture tile border, which is the largest triangle cost of LOD1)."""
    if b.detail == 2 or (b.detail == 0 and getattr(b, 'coarse', 0) < 4):
        return lib.walls(b, fp, z0, z1, storeys, lk, rng, edges=edges, kind=kind, ratio=ratio, front_kind=front_kind, ground_kind=ground_kind, bay=bay,
                         wall_slot=wall_slot, wall_col=wall_col, **kw)
    ws = wall_slot or lk.wall_slot
    wc = wall_col or lk.wall_col
    rt = lk.ratio if ratio is None else ratio
    for seg in (edges if edges is not None else fp.edges()):
        k = (front_kind if seg.front and front_kind else kind) or lk.windows
        _lod1_edge(b, lk, seg, z0, z1, storeys, k, rt, bay, ws, wc, ground_kind if seg.front else None)


def mass_walls(b, lk, fp, z0, z1, storeys, others=(), rng=None, **kw):
    """walls() over a footprint, dropping segments buried in neighbouring masses (`others` = rects of the other masses)."""
    edges = [s for s in fp.edges() if not covered(s, others)]
    walls(b, fp, z0, z1, storeys, lk, rng, edges=edges, **kw)


# ------------------------------------------------------------------------------------------------------------- details
def disc(b, cx, cy, cz, r, hint, col, slot='plain', n=14):
    """A flat n-gon of radius r facing `hint` (horizontal hint = vertical disc such as a clock face; (0,0,1) = lying flat)."""
    if b.detail >= 2:
        return
    hx, hy = hint[0], hint[1]
    l = math.hypot(hx, hy)
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n
        if l < 1e-6:
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a), cz))
        else:
            tx, ty = -hy / l, hx / l
            pts.append((cx + tx * r * math.cos(a), cy + ty * r * math.cos(a), cz + r * math.sin(a)))
    b.facing(pts, hint, slot, col)


def frustum_sq(b, x, y, z0, z1, w0, w1, slot, col, d0=None, d1=None, top=False, top_col=None, bottom=False):
    """A four-sided tapering block (a pinnacle, a pylon, a mast section). w = width in x, d = depth in y (default = w)."""
    d0 = w0 if d0 is None else d0
    d1 = w1 if d1 is None else d1
    c = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i in range(4):
        a, q = c[i], c[(i + 1) % 4]
        b.face([(x + a[0] * w0 / 2, y + a[1] * d0 / 2, z0), (x + q[0] * w0 / 2, y + q[1] * d0 / 2, z0),
                (x + q[0] * w1 / 2, y + q[1] * d1 / 2, z1), (x + a[0] * w1 / 2, y + a[1] * d1 / 2, z1)], slot, col)
    if top and w1 > 0.02:
        b.facing([(x + a[0] * w1 / 2, y + a[1] * d1 / 2, z1) for a in c], (0, 0, 1), slot, top_col or col)
    if bottom:
        b.facing([(x + a[0] * w0 / 2, y + a[1] * d0 / 2, z0) for a in c], (0, 0, -1), slot, col)


def pinnacle(b, x, y, z, h, w, col, slot='mud-render'):
    """Hausa 'zankwaye' corner horn / small square pinnacle: a tapering horn, slightly bulged near the base."""
    if b.detail >= 2:
        return
    if b.detail == 1:
        frustum_sq(b, x, y, z, z + h, w, w * 0.2, slot, col)
        return
    frustum_sq(b, x, y, z, z + h * 0.35, w, w * 0.8, slot, col)
    frustum_sq(b, x, y, z + h * 0.35, z + h, w * 0.8, w * 0.12, slot, shade(col, 0.96), top=True)


def finial_ball(b, x, y, z, r, col):
    if b.detail >= 1:
        return
    lib.blob(b, x, y, z + r, r, r, r, col, n=8, rings=4, slot='plain')


def door(b, seg, u, w, h, col='#3b2f2a', z=0.0, proud=0.04, frame=None, slot='glass-shopfront'):
    """A door opening on a wall segment: dark glazed leaf with a lintel and frame."""
    if b.detail >= 2:
        return
    b.face([seg.P(u - w / 2, z, -proud), seg.P(u + w / 2, z, -proud), seg.P(u + w / 2, z + h, -proud), seg.P(u - w / 2, z + h, -proud)], slot, '#d4dde2' if slot.startswith('glass') else col)
    if b.detail == 0 and frame:
        lib.seg_box(b, seg, u - w / 2 - 0.14, u + w / 2 + 0.14, z + h, z + h + 0.18, 0.1, frame, 'plain')
        lib.seg_box(b, seg, u - w / 2 - 0.14, u - w / 2, z, z + h, 0.08, frame, 'plain')
        lib.seg_box(b, seg, u + w / 2, u + w / 2 + 0.14, z, z + h, 0.08, frame, 'plain')


def string_course(b, fp, z, lk, h=0.3, proud=0.1, col=None, slot=None):
    if b.detail >= 1:
        return
    lib.sweep(b, fp, z, [(0, 0), (proud, 0), (proud, h), (0, h)], slot or lk.wall_slot, col or lk.trim_col)


def plinth_band(b, fp, lk, h=0.9, proud=0.08, col=None, slot=None):
    if b.detail >= 1:
        return
    lib.sweep(b, fp, 0.0, [(proud, 0), (proud, h), (0, h)], slot or lk.wall_slot, col or shade(lk.wall_col, 0.8))


def eaves_band(b, fp, z, lk, drop=0.4, proud=0.35, col=None):
    """Cornice / deep eaves board round a footprint with its top at z."""
    if b.detail >= 1:
        return
    lib.sweep(b, fp, z - drop, [(0, 0), (proud, 0), (proud, drop), (0, drop)], 'plain-render', col or lk.trim_col)


def piers(b, seg, us, z0, z1, w, proud, col, slot='plain-render'):
    """Vertical fins / pilasters on a wall at the given u positions."""
    if b.detail >= 1:
        return
    for u in us:
        lib.seg_box(b, seg, u - w / 2, u + w / 2, z0, z1, proud, col, slot)


def balustrade(b, p0, p1, z, h=0.95, col='#e8e4da', pitch=2.4, post_w=0.22, rail_h=0.12):
    """A railing along p0 -> p1: top rail, bottom rail, and square posts (LOD0); a solid parapet strip at LOD1."""
    if b.detail >= 2:
        return
    L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    if L < 0.2:
        return
    if b.detail == 1:
        lib.beam(b, p0, p1, z, z + h, 0.16, 'plain-render', col, skip=())
        return
    lib.beam(b, p0, p1, z + h - rail_h, z + h, 0.26, 'plain-render', col)
    lib.beam(b, p0, p1, z + 0.08, z + 0.08 + rail_h, 0.2, 'plain-render', col)
    n = max(1, int(L / pitch))
    for k in range(n + 1):
        t = k / n
        lib.box_c(b, p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, z, post_w, post_w, h - rail_h, 'plain-render', col)


def crenellate_seg(b, seg, z, h=0.85, w=0.8, pitch=1.9, thick=0.38, col='#c8b08a', slot='mud-render', inset=0.0):
    """Merlons along one wall at roof level z (thickness `thick`, set `inset` in from the wall face)."""
    if b.detail >= 2:
        return
    L = seg.length
    n = max(1, int((L - 0.5) / pitch))
    step = L / n
    if b.detail == 1:
        lib.seg_box(b, seg, 0, L, z, z + h * 0.8, -inset + 0.0, col, slot, inset=thick + inset)
        return
    for k in range(n):
        u = step * (k + 0.5)
        lib.seg_box(b, seg, u - w / 2, u + w / 2, z, z + h, -inset, col, slot, inset=thick + inset)
    # continuous low parapet below the merlons
    lib.seg_box(b, seg, 0, L, z, z + h * 0.42, -inset, col, slot, inset=thick + inset)


def crenellate(b, fp, z, lk, **kw):
    for seg in fp.edges():
        crenellate_seg(b, seg, z, **kw)


def pediment(b, x0, x1, y0, y1, z, rise, lk, slot=None, col=None, face_col=None, ov=0.25, face_slot=None):
    """A classical pediment: triangle facing -Y at y0, ridge along y running back to y1, raking roof planes on both sides."""
    rs = slot or lk.roof_slot
    rc = col or lk.roof_col
    xs, xe = x0 - ov, x1 + ov
    cx = (xs + xe) / 2
    b.facing([(xs, y0 - ov, z), (xe, y0 - ov, z), (cx, y0 - ov, z + rise)], (0, -1, 0), face_slot or lk.wall_slot, face_col or lk.trim_col)
    b.facing([(xs, y0 - ov, z), (cx, y0 - ov, z + rise), (cx, y1, z + rise), (xs, y1, z)], (-rise, 0, (xe - xs) / 2), rs, rc)
    b.facing([(xe, y0 - ov, z), (xe, y1, z), (cx, y1, z + rise), (cx, y0 - ov, z + rise)], (rise, 0, (xe - xs) / 2), rs, rc)
    if b.detail == 0:
        # raking cornice (thin lighter strips along the slopes at the front)
        t = 0.28
        b.facing([(xs, y0 - ov - 0.1, z), (cx, y0 - ov - 0.1, z + rise), (cx, y0 - ov - 0.1, z + rise - t), (xs + t * 1.6, y0 - ov - 0.1, z)], (0, -1, 0), 'plain-render', shade(face_col or lk.trim_col, 1.05))
        b.facing([(xe, y0 - ov - 0.1, z), (xe - t * 1.6, y0 - ov - 0.1, z), (cx, y0 - ov - 0.1, z + rise - t), (cx, y0 - ov - 0.1, z + rise)], (0, -1, 0), 'plain-render', shade(face_col or lk.trim_col, 1.05))


def portico_front(b, lk, cx, y_wall, width, depth, z0, height, cols, rng=None, pediment_rise=None, steps_n=5, col_r=None, kind='round',
                  entab_h=0.9, col=None, slab_col=None, wall_up=None, steps_w=None, roofed=True, pediment_col=None):
    """Free-standing columned porch in front of the wall at y = y_wall (front = -Y). `height` is column + base to the underside of
    the entablature. pediment_rise None = flat roof / balcony slab, >0 = triangular pediment."""
    r = col_r or clamp(width / cols / 3.6, 0.25, 0.7)
    x0, x1 = cx - width / 2, cx + width / 2
    yf = y_wall - depth
    zt = z0 + height
    col = col or lk.trim_col
    if steps_n and b.detail < 2:
        sw = steps_w or width
        lib.steps(b, cx - sw / 2 - 0.4, cx + sw / 2 + 0.4, yf - 0.0, z0, min(0.4 * steps_n, 3.2), steps_n, 'paving', lk.stone_col)
    # floor slab
    lib.box(b, x0 - 0.4, yf - 0.3, 0, x1 + 0.4, y_wall, z0, lk.wall_slot, shade(col, 0.92), skip=('bottom', 'back'))
    n_cols = cols
    if b.detail >= 1:
        n_cols = min(cols, 4)
    for k in range(n_cols):
        x = x0 + r + (width - 2 * r) * k / max(1, n_cols - 1)
        if kind == 'square' or b.detail >= 2:
            lib.box_c(b, x, yf + r + 0.35, z0, 2 * r, 2 * r, height, lk.wall_slot, col)
        else:
            lib.column(b, x, yf + r + 0.35, z0, zt, r, lk, kind, True, lk.wall_slot, col)
    # entablature
    lib.box(b, x0 - 0.5, yf - 0.1, zt, x1 + 0.5, y_wall, zt + entab_h, lk.wall_slot, col)
    if pediment_rise:
        pediment(b, x0 - 0.5, x1 + 0.5, yf - 0.1, y_wall + 0.5, zt + entab_h, pediment_rise, lk, face_col=pediment_col or shade(col, 0.96))
    elif roofed:
        lib.box(b, x0 - 0.6, yf - 0.2, zt + entab_h, x1 + 0.6, y_wall, zt + entab_h + 0.25, 'roof-flat', lk.roof_col, skip=('bottom',))


def veranda(b, lk, p0, p1, z_base, z_eave, depth, z_attach, post='square', pitch_m=3.0, r=0.12, col=None, roof_col=None, roof_slot=None,
            flat=False, floor=True, rail_h=0.0, slab_h=0.22, end_caps=True, rail_col=None, thick=0.14, posts=True):
    """A lean-to veranda along the wall line p0 -> p1 (the wall's outward side is to the right of the direction of travel).
    Posts stand `depth` out from the wall; the roof falls from z_attach on the wall to z_eave at the posts."""
    pitch_m *= (2.0 if b.detail == 1 else 1.0) * (1 + 0.5 * getattr(b, 'coarse', 0))
    seg = lib.Seg(p0, p1)
    L = seg.length
    col = col or lk.trim_col
    rcol = roof_col or lk.roof_col
    rslot = roof_slot or lk.roof_slot
    out = seg.n
    if b.detail >= 2:
        pts = [seg.P(0, z_attach, 0), seg.P(L, z_attach, 0), seg.P(L, z_eave, -depth - 0.3), seg.P(0, z_eave, -depth - 0.3)]
        b.facing(pts, (out[0] * 0.3, out[1] * 0.3, 1.0), rslot, rcol)
        return
    if floor:
        cx, cy, _ = seg.P(L / 2, 0, -depth / 2)
        lib.obox(b, cx, cy, 0, L, depth, z_base + slab_h if z_base > 0 else slab_h, math.atan2(seg.u[1], seg.u[0]), 'paving', shade(lk.stone_col, 0.95), skip=('bottom', 'back'))
    zb = z_base + slab_h if z_base > 0 else slab_h
    n = max(2, int(round(L / pitch_m)) + 1)
    if b.detail >= 1:
        n = max(2, n // 2 + 1)
    for k in range(n if posts else 0):
        u = 0.25 + (L - 0.5) * k / (n - 1)
        x, y, _ = seg.P(u, 0, -depth + r + 0.1)
        if post == 'round' and b.detail == 0:
            lib.cylinder(b, x, y, zb, z_eave - 0.1, r, n=8, slot=lk.wall_slot, col=col, r_top=r * 0.92, top=False)
        else:
            lib.box_c(b, x, y, zb, 2 * r, 2 * r, z_eave - 0.1 - zb, lk.wall_slot, col)
    if rail_h > 0:
        rcl = rail_col or col
        pa, pb = seg.P(0.25, 0, -depth + r + 0.1), seg.P(L - 0.25, 0, -depth + r + 0.1)
        balustrade(b, (pa[0], pa[1]), (pb[0], pb[1]), zb, rail_h, rcl, pitch=1.6)
    ex = depth + 0.35
    if flat:
        cx, cy, _ = seg.P(L / 2, 0, -ex / 2)
        lib.obox(b, cx, cy, z_eave - 0.1, L + 0.2, ex, thick + 0.1, math.atan2(seg.u[1], seg.u[0]), lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=rcol, skip=())
        return
    top = [seg.P(0, z_attach, 0), seg.P(L, z_attach, 0), seg.P(L, z_eave, -ex), seg.P(0, z_eave, -ex)]
    b.facing(top, (out[0] * 0.3, out[1] * 0.3, 1.0), rslot, rcol)
    if b.detail == 0:
        under = [seg.P(0, z_attach - thick, 0), seg.P(L, z_attach - thick, 0), seg.P(L, z_eave - thick, -ex), seg.P(0, z_eave - thick, -ex)]
        b.facing(under, (-out[0] * 0.3, -out[1] * 0.3, -1.0), 'plain-render', shade(rcol, 0.6))
        b.facing([seg.P(0, z_eave - thick, -ex), seg.P(L, z_eave - thick, -ex), seg.P(L, z_eave, -ex), seg.P(0, z_eave, -ex)], (out[0], out[1], 0), 'plain-render', shade(lk.trim_col, 0.95))
        if end_caps:
            for u, sgn in ((0, -1), (L, 1)):
                b.facing([seg.P(u, z_attach - thick, 0), seg.P(u, z_attach, 0), seg.P(u, z_eave, -ex), seg.P(u, z_eave - thick, -ex)], (seg.u[0] * sgn, seg.u[1] * sgn, 0), 'plain-render', shade(rcol, 0.8))


def arcade(b, lk, p0, p1, z0, z_spring, z_top, depth, bays=None, bay_w=3.4, pier_w=0.8, col=None, pointed=False, slab=True, back_col=None, horseshoe=False,
           roof_col=None):
    """An open arcade (loggia) along p0 -> p1 standing `depth` out from the wall: piers, round / pointed arches, deck slab on top.
    The arch faces are flat strips (front plane only) between piers and a floor slab under; the wall behind carries the openings."""
    seg = lib.Seg(p0, p1)
    L = seg.length
    col = col or lk.trim_col
    bay_w *= (1.8 if b.detail == 1 else 1.0) * (1 + 0.4 * getattr(b, 'coarse', 0))
    n = bays or max(1, int(round(L / bay_w)))
    bw = L / n
    if b.detail >= 2:
        return
    ns = {0: 6, 1: 3}[b.detail]
    rise_ = (bw - pier_w) / 2 * (1.25 if pointed else 1.0)
    z_spring = min(z_spring, z_top - 0.35 - rise_)
    z_spring = max(z_spring, 1.6)
    if slab:
        cx, cy, _ = seg.P(L / 2, 0, -depth / 2)
        lib.obox(b, cx, cy, 0, L, depth, 0.2, math.atan2(seg.u[1], seg.u[0]), 'paving', shade(lk.stone_col, 0.95), skip=('bottom', 'back', 'front'))
    d0 = -depth
    for k in range(n + 1):
        u = k * bw
        pw = pier_w
        ua, ub = max(0.0, u - pw / 2), min(L, u + pw / 2)
        # pier: front face + sides
        lib.seg_box(b, seg, ua, ub, 0, z_spring, depth, col, lk.wall_slot, inset=0.0)
    for k in range(n):
        ua = k * bw + pier_w / 2
        ub = (k + 1) * bw - pier_w / 2
        w = ub - ua
        if w < 0.3:
            continue
        pts = []
        for j in range(ns + 1):
            a = math.pi * (1 - j / ns)
            if pointed:
                # two-centred pointed arch: approximate by pulling the crown up
                t = j / ns
                u = ua + w * t
                z = z_spring + (w / 2) * (math.sin(math.pi * t) ** 0.8) * 1.25
            elif horseshoe:
                t = j / ns
                u = ua + w * (0.5 - 0.54 * math.cos(math.pi * t))
                u = min(max(u, ua - 0.05), ub + 0.05)
                z = z_spring + (w / 2) * math.sin(math.pi * t) * 1.0
            else:
                u = (ua + ub) / 2 + math.cos(a) * w / 2
                z = z_spring + math.sin(a) * w / 2
            pts.append((u, z))
        for (u_a, z_a), (u_b, z_b) in zip(pts[:-1], pts[1:]):
            if abs(u_b - u_a) < 1e-4:
                continue
            b.facing([seg.P(u_a, z_a, d0), seg.P(u_b, z_b, d0), seg.P(u_b, z_top, d0), seg.P(u_a, z_top, d0)], seg.N3(), lk.wall_slot, col)
        # soffit strip of the arch (underside) is skipped at LOD1
    # deck / cornice over the arcade
    lib.seg_box(b, seg, -0.1, L + 0.1, z_top - 0.2, z_top + 0.2, depth + 0.15, shade(col, 0.95), lk.wall_slot, inset=0.0)
    cx, cy, _ = seg.P(L / 2, 0, -depth / 2)
    if slab:
        b.facing([seg.P(-0.1, z_top + 0.2, -depth - 0.15), seg.P(L + 0.1, z_top + 0.2, -depth - 0.15), seg.P(L + 0.1, z_top + 0.2, 0), seg.P(-0.1, z_top + 0.2, 0)], (0, 0, 1), 'roof-flat', roof_col or shade(lk.roof_col, 1.0))


def flagpole(b, x, y, h=9.0, col='#2e7d4f', pole='#c9cdd0', yaw=0.0):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, 0.3, 0.28, n=5, slot='paving', col='#8a8780', r_top=0.2, top=True)
        lib.cylinder(b, x, y, 0.3, h, 0.06, n=5, slot='frame', col=pole, r_top=0.04, top=True)
        c, s = math.cos(yaw), math.sin(yaw)
        w, hh = 2.1, 1.3
        pts = [(x + c * 0.05, y + s * 0.05, h - hh - 0.15), (x + c * w, y + s * w, h - hh - 0.1), (x + c * w, y + s * w, h - 0.15), (x + c * 0.05, y + s * 0.05, h - 0.1)]
        n = (s, -c, 0)
        b.facing(pts, n, 'plain', col)
        b.facing(pts, (-n[0], -n[1], 0), 'plain', shade(col, 0.82))


def flags(b, lk, xs, y, h, cols, yaw=0.0):
    for k, x in enumerate(xs):
        flagpole(b, x, y, h, cols[k % len(cols)], yaw=yaw)


FLAG_SETS = {
    'nigeria': ['#1f8a4c', '#f4f4f0', '#1f8a4c'], 'default': ['#2e7d4f', '#d8d8d4', '#b8432f'],
}


def flag_cols(brief, lk, rng):
    txt = text(brief) + str((brief.get('city') or ''))
    if has(txt, 'nigeria'):
        return ['#1f8a4c', '#f2f2ee', '#1f8a4c']
    if has(txt, 'ghana'):
        return ['#c8362f', '#f5c344', '#1f7a4a']
    if has(txt, 'london', 'united kingdom', 'england'):
        return ['#1f3b78', '#c8362f', '#f0f0f0']
    return ['#2e7d4f', '#c8362f', '#e8c43a']


def fence_wall(b, lk, x0, y0, x1, y1, gate_x=None, gate_w=7.0, h=1.9, kind='wall', col=None, sides=True, back=False, thick=0.3, pier_col=None, rng=None):
    """Perimeter wall (or railing on a low wall) along the front y0 (with a central gate gap) and optionally the sides and back.
    Everything goes to the site layer."""
    if b.detail >= 2:
        return
    col = col or shade(lk.wall_col, 0.95)
    pc = pier_col or shade(col, 1.05)
    gx = (x0 + x1) / 2 if gate_x is None else gate_x
    ga, gb = (gx - gate_w / 2, gx + gate_w / 2) if gate_w else (x1 + 1, x1 + 1)
    with b.site():
        def run_seg(xa, ya, xb, yb):
            if math.hypot(xb - xa, yb - ya) < 0.3:
                return
            if kind == 'railing' and b.detail == 0:
                lib.beam(b, (xa, ya), (xb, yb), 0, 0.7, thick, lk.wall_slot, col)
                L = math.hypot(xb - xa, yb - ya)
                n = max(1, int(L / 1.4))
                for k in range(n + 1):
                    t = k / n
                    lib.box_c(b, xa + (xb - xa) * t, ya + (yb - ya) * t, 0.7, 0.07, 0.07, h - 0.7, 'frame', '#2f3236')
                lib.beam(b, (xa, ya), (xb, yb), h - 0.08, h, 0.1, 'frame', '#2f3236')
            else:
                lib.beam(b, (xa, ya), (xb, yb), 0, h, thick, lk.wall_slot, col, skip=())
        run_seg(x0, y0, ga, y0)
        run_seg(gb, y0, x1, y0)
        if sides:
            run_seg(x0, y0, x0, y1)
            run_seg(x1, y0, x1, y1)
        if back:
            run_seg(x0, y1, x1, y1)
        if gate_w and b.detail < 2:
            for gxp in (ga, gb):
                lib.box_c(b, gxp, y0, 0, 0.9, 0.9, h + 0.5, lk.wall_slot, pc, skip=('bottom',))
                if b.detail == 0:
                    lib.box_c(b, gxp, y0, h + 0.5, 1.15, 1.15, 0.18, lk.wall_slot, shade(pc, 1.05))
            if b.detail == 0:
                for sgn in (-1, 1):
                    xa = gx + sgn * 0.05
                    xb = gx + sgn * (gate_w / 2 - 0.55)
                    lib.beam(b, (xa, y0), (xb, y0), 0.1, 1.7, 0.08, 'frame', '#2f3a35', skip=())


def tank_tower(b, x, y, h=9.0, r=1.6, col='#3a3d42', leg_col='#7d8286', tank_col='#1f3f66'):
    """An elevated water tank on four legs (typical roadside / hospital water supply)."""
    if b.detail >= 2:
        return
    with b.site():
        if b.detail == 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    lib.cylinder(b, x + sx * r * 0.7, y + sy * r * 0.7, 0, h, 0.09, n=4, slot='frame', col=leg_col, r_top=0.09, top=False)
            lib.box_c(b, x, y, h - 0.15, r * 2.1, r * 2.1, 0.15, 'metal-cladding', leg_col, skip=())
            lib.beam(b, (x - r * 0.7, y - r * 0.7), (x + r * 0.7, y + r * 0.7), h * 0.5, h * 0.5 + 0.06, 0.06, 'frame', leg_col, skip=())
            lib.beam(b, (x - r * 0.7, y + r * 0.7), (x + r * 0.7, y - r * 0.7), h * 0.5, h * 0.5 + 0.06, 0.06, 'frame', leg_col, skip=())
        else:
            lib.box_c(b, x, y, 0, 0.5, 0.5, h, 'frame', leg_col)
        lib.cylinder(b, x, y, h, h + r * 1.5, r, n=12 if b.detail == 0 else 7, slot='metal-cladding', col=tank_col, r_top=r, top=False, smooth=True)
        lib.cylinder(b, x, y, h + r * 1.5, h + r * 1.9, r, n=12 if b.detail == 0 else 7, slot='metal-cladding', col=shade(tank_col, 1.15), r_top=r * 0.2, top=True, smooth=True)


def ambulance(b, x, y, yaw=0.0, scale=1.0):
    """A low-poly ambulance (white van, red stripe, roof light). yaw: direction of travel in radians (0 = +X)."""
    if b.detail >= 1:
        return
    with b.site():
        c, s = math.cos(yaw), math.sin(yaw)
        P = lambda lx, ly, z: (x + (c * lx - s * ly) * scale, y + (s * lx + c * ly) * scale, z * scale)
        # body 5.4 x 2.0 x 2.3 + cab slope
        lib.obox(b, x + c * -0.5 * scale, y + s * -0.5 * scale, 0.45 * scale, 4.4 * scale, 2.0 * scale, 1.85 * scale, yaw, 'plain', '#f1f1ee', skip=('bottom',))
        lib.obox(b, x + c * 2.35 * scale, y + s * 2.35 * scale, 0.45 * scale, 1.5 * scale, 1.9 * scale, 1.1 * scale, yaw, 'plain', '#f1f1ee')
        # windscreen
        b.facing([P(3.1, -0.9, 1.55), P(3.1, 0.9, 1.55), P(2.65, 0.9, 1.0), P(2.65, -0.9, 1.0)], (c * 0.6, s * 0.6, 0.8), 'plain', '#2a3540')
        # stripe along both flanks
        for sgn in (-1, 1):
            n = (-s * sgn, c * sgn, 0)
            b.facing([P(-2.5, sgn * 1.011, 1.0), P(2.6, sgn * 1.011, 1.0), P(2.6, sgn * 1.011, 1.4), P(-2.5, sgn * 1.011, 1.4)], n, 'plain', '#c8362f')
        lib.obox(b, x + c * -0.2 * scale, y + s * -0.2 * scale, 2.3 * scale, 0.5 * scale, 1.2 * scale, 0.22 * scale, yaw, 'plain', '#2f6bd0')
        for dx in (-1.6, 2.0):
            for dy in (-1, 1):
                px, py, _ = P(dx, dy * 0.95, 0)
                lib.obox(b, px, py, 0.0, 0.9 * scale, 0.28 * scale, 0.9 * scale, yaw, 'plain', '#1f2124')


def pickup(b, x, y, yaw, col='#e8e8e4', stripe='#2a4a8a'):
    """Small pickup / patrol truck (police)."""
    if b.detail >= 1:
        return
    with b.site():
        c, s = math.cos(yaw), math.sin(yaw)
        lib.obox(b, x, y, 0.45, 5.0, 1.9, 0.9, yaw, 'plain', col)
        lib.obox(b, x + c * 0.9, y + s * 0.9, 1.35, 2.0, 1.75, 0.65, yaw, 'plain', '#27323c', top_col=shade(col, 0.95))
        lib.obox(b, x - c * 1.0, y - s * 1.0, 1.35, 2.4, 1.8, 0.35, yaw, 'plain', col)
        for dx in (-1.6, 1.7):
            for dy in (-1, 1):
                px, py = x + c * dx - s * dy * 0.92, y + s * dx + c * dy * 0.92
                lib.obox(b, px, py, 0.0, 0.85, 0.3, 0.85, yaw, 'plain', '#1f2124')


def helipad(b, x, y, z, r=7.0, col='#8c9096', mark='#e8e8e2', ring='#d9c13a', ground=False):
    """A circular helipad with the H mark. ground=True builds a pad in the site layer; otherwise it sits on a roof at height z."""
    if b.detail >= 2:
        return

    def draw():
        n = 16 if b.detail == 0 else 10
        lib.cylinder(b, x, y, z, z + 0.16, r, n=n, slot='roof-flat', col=col, r_top=r, top=True, smooth=False)
        if b.detail >= 1:
            return
        zz = z + 0.17
        ringpts = [(x + r * 0.9 * math.cos(2 * math.pi * k / 24), y + r * 0.9 * math.sin(2 * math.pi * k / 24)) for k in range(24)]
        for k in range(24):
            a, c2 = ringpts[k], ringpts[(k + 1) % 24]
            ma = (x + (a[0] - x) * 0.93, y + (a[1] - y) * 0.93)
            mb = (x + (c2[0] - x) * 0.93, y + (c2[1] - y) * 0.93)
            b.facing([(a[0], a[1], zz), (c2[0], c2[1], zz), (mb[0], mb[1], zz), (ma[0], ma[1], zz)], (0, 0, 1), 'plain', ring)
        hh, ww, t = r * 0.45, r * 0.26, r * 0.07
        for sx in (-1, 1):
            b.facing([(x + sx * ww - t, y - hh, zz), (x + sx * ww + t, y - hh, zz), (x + sx * ww + t, y + hh, zz), (x + sx * ww - t, y + hh, zz)], (0, 0, 1), 'plain', mark)
        b.facing([(x - ww, y - t, zz), (x + ww, y - t, zz), (x + ww, y + t, zz), (x - ww, y + t, zz)], (0, 0, 1), 'plain', mark)
    if ground:
        with b.site():
            draw()
    else:
        draw()


def red_cross(b, cx, cy, cz, size, hint=(0, -1, 0), plate='#f4f4f1', col='#c8242b', plate_pad=1.25):
    """A plain red cross on a white square plate, facing `hint` (horizontal) or lying on a roof (hint (0,0,1))."""
    if b.detail >= 2:
        return
    hx, hy = hint[0], hint[1]
    l = math.hypot(hx, hy)
    if l < 1e-6:
        tx, ty = 1.0, 0.0
        P = lambda u, v: (cx + u, cy + v, cz)
        up = (0, 0, 1)
        P2 = lambda u, v: (cx + u, cy + v, cz + 0.02)
    else:
        tx, ty = -hy / l, hx / l
        P = lambda u, v: (cx + tx * u, cy + ty * u, cz + v)
        P2 = lambda u, v: (cx + tx * u + hx / l * 0.03, cy + ty * u + hy / l * 0.03, cz + v)
        up = (hx, hy, 0)
    h = size / 2 * plate_pad
    b.facing([P(-h, -h), P(h, -h), P(h, h), P(-h, h)], up, 'plain', plate)
    a, t = size / 2, size / 6
    b.facing([P2(-a, -t), P2(a, -t), P2(a, t), P2(-a, t)], up, 'plain', col)
    b.facing([P2(-t, -a), P2(t, -a), P2(t, a), P2(-t, a)], up, 'plain', col)


def statue(b, x, y, h=4.0, col='#6b5a3c', plinth_col='#bdb6a6', plinth_h=None, pose='stand'):
    """A statue on a plinth (site layer): stepped plinth + low-poly standing figure."""
    if b.detail >= 2:
        return
    ph = plinth_h or h * 0.45
    fh = h - ph
    with b.site():
        lib.box_c(b, x, y, 0, h * 0.62, h * 0.62, 0.35, 'stone-blocks', shade(plinth_col, 0.9), skip=('bottom',))
        lib.box_c(b, x, y, 0.35, h * 0.46, h * 0.46, ph - 0.35, 'stone-blocks', plinth_col, skip=('bottom',))
        if b.detail >= 1:
            lib.cylinder(b, x, y, ph, ph + fh, fh * 0.15, n=5, slot='plain', col=col, r_top=fh * 0.1, top=True, smooth=False)
            return
        z = ph
        lib.box_c(b, x, y, z, fh * 0.34, fh * 0.2, fh * 0.52, 'plain', col)                       # robe / body
        lib.cylinder(b, x, y, z + fh * 0.5, z + fh * 0.78, fh * 0.11, n=6, slot='plain', col=shade(col, 1.05), r_top=fh * 0.09, top=False)
        lib.blob(b, x, y, z + fh * 0.86, fh * 0.085, fh * 0.085, fh * 0.1, shade(col, 1.08), n=6, rings=3, slot='plain')
        lib.box_c(b, x + fh * 0.2, y, z + fh * 0.5, fh * 0.07, fh * 0.07, fh * 0.28, 'plain', col)  # an arm raised
        lib.box_c(b, x - fh * 0.2, y, z + fh * 0.3, fh * 0.07, fh * 0.07, fh * 0.3, 'plain', col)


def fountain(b, x, y, r=3.5, water='#6fa8c4', rim='#cfcac0'):
    if b.detail >= 2:
        return
    with b.site():
        n = 16 if b.detail == 0 else 8
        lib.cylinder(b, x, y, 0, 0.55, r, n=n, slot='stone-blocks', col=rim, r_top=r, top=False, smooth=False)
        lib.cylinder(b, x, y, 0.5, 0.52, r - 0.35, n=n, slot='plain', col=water, r_top=r - 0.35, top=True, smooth=False)
        if b.detail >= 1:
            return
        lib.cylinder(b, x, y, 0.5, 1.5, 0.25, n=6, slot='stone-blocks', col=rim, r_top=0.2, top=False)
        lib.cylinder(b, x, y, 1.5, 1.8, r * 0.38, n=10, slot='stone-blocks', col=rim, r_top=r * 0.42, top=True, smooth=False)
        lib.cylinder(b, x, y, 1.8, 3.1, 0.12, n=5, slot='plain', col='#d8ecf4', r_top=0.04, top=True)
        lib.cylinder(b, x, y, 3.1, 3.2, 0.5, n=8, slot='plain', col='#cfe4ee', r_top=0.05, top=True)


def cannon(b, x, y, yaw=0.0, col='#2e3033'):
    if b.detail >= 1:
        return
    with b.site():
        lib.box_c(b, x, y, 0.0, 0.5, 1.5, 0.12, 'timber', '#5a4636')
        c, s = math.cos(yaw), math.sin(yaw)
        # barrel: tapering box along yaw
        lib.cylinder(b, x, y, 0.45, 0.45 + 0.01, 0.01, n=3, slot='plain', col=col, top=False)
        for k in range(2):
            px, py = x + (k - 0.5) * 0.9 * (-s) , y + (k - 0.5) * 0.9 * c
        lib.obox(b, x, y, 0.4, 1.9, 0.3, 0.3, yaw, 'plain', col, skip=())
        for sgn in (-1, 1):
            lib.cylinder(b, x - s * sgn * 0.42, y + c * sgn * 0.42, 0.0, 0.1, 0.4, n=8, slot='timber', col='#4a3a2e', r_top=0.4, top=True, smooth=False)


def vegetation_row(b, lk, srng, x0, x1, y, n, h=8.0, jit=2.0, kind=None):
    if b.detail >= 2 or (kind or lk.tree) in (None, 'none'):
        return
    n = n if b.detail == 0 else max(1, int(n * 0.45))
    for k in range(n):
        tx = x0 + (x1 - x0) * (k + 0.5) / n + srng.uniform(-jit, jit)
        lib.tree(b, kind or lk.tree, tx, y + srng.uniform(-jit * 0.5, jit * 0.5), h * srng.uniform(0.8, 1.15), srng, lk)


def clock_face(b, cx, cy, cz, r, hint, face='#f2efe6', hands='#2a2a2a'):
    if b.detail >= 1:
        return
    disc(b, cx, cy, cz, r * 1.08, hint, '#3a3a38', n=14)
    hx, hy = hint[0], hint[1]
    l = math.hypot(hx, hy) or 1.0
    ox, oy = hx / l * 0.04, hy / l * 0.04
    disc(b, cx + ox, cy + oy, cz, r, hint, face, n=14)
    tx, ty = -hy / l, hx / l
    for (u, v, uu, vv) in ((0, 0, 0.1 * r, 0.75 * r), (0, 0, 0.55 * r, 0.08 * r)):
        p = [(cx + ox * 2 + tx * (u - 0.07 * r), cy + oy * 2 + ty * (u - 0.07 * r), cz + v),
             (cx + ox * 2 + tx * (u + 0.07 * r), cy + oy * 2 + ty * (u + 0.07 * r), cz + v),
             (cx + ox * 2 + tx * (uu + 0.07 * r), cy + oy * 2 + ty * (uu + 0.07 * r), cz + vv),
             (cx + ox * 2 + tx * (uu - 0.07 * r), cy + oy * 2 + ty * (uu - 0.07 * r), cz + vv)]
        b.facing(p, (hx, hy, 0), 'plain', hands)


def lattice_mast(b, x, y, h, base_w=3.2, top_w=0.8, col_a='#c8362f', col_b='#f2f2ee', panels=8):
    """A radio mast of lattice type: four tapering legs in red and white sections, diagonal bracing, a slim whip on top."""
    if b.detail >= 2:
        frustum_sq(b, x, y, 0, h, base_w * 0.5, top_w * 0.5, 'plain', col_b)
        return
    np_ = panels if b.detail == 0 else max(3, panels // 2)
    for k in range(np_):
        z0, z1 = h * k / np_, h * (k + 1) / np_
        w0 = base_w + (top_w - base_w) * (k / np_)
        w1 = base_w + (top_w - base_w) * ((k + 1) / np_)
        col = col_a if k % 2 == 0 else col_b
        lw = max(0.12, 0.3 - 0.03 * k)
        for sx in (-1, 1):
            for sy in (-1, 1):
                _leg(b, x + sx * w0 / 2, y + sy * w0 / 2, z0, x + sx * w1 / 2, y + sy * w1 / 2, z1, lw, col)
        if b.detail == 0:
            for e, (sa, sb) in enumerate((((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1)))):
                p0 = (x + sa[0] * w0 / 2, y + sa[1] * w0 / 2, z0)
                p1 = (x + sb[0] * w1 / 2, y + sb[1] * w1 / 2, z1)
                q0 = (x + sb[0] * w0 / 2, y + sb[1] * w0 / 2, z0)
                q1 = (x + sa[0] * w1 / 2, y + sa[1] * w1 / 2, z1)
                a, c2 = (p0, p1) if (k + e) % 2 == 0 else (q0, q1)
                tw = 0.05
                nx, ny = (a[1] - c2[1], c2[0] - a[0])
                nl = math.hypot(nx, ny) or 1.0
                nx, ny = nx / nl * tw, ny / nl * tw
                quad = [(a[0] - nx, a[1] - ny, a[2]), (a[0] + nx, a[1] + ny, a[2]), (c2[0] + nx, c2[1] + ny, c2[2]), (c2[0] - nx, c2[1] - ny, c2[2])]
                b.face(quad, 'frame', '#d9d9d6')
                b.face(quad[::-1], 'frame', '#d9d9d6')
    lib.cylinder(b, x, y, h, h + h * 0.12, 0.07, n=4, slot='frame', col='#d0d0d0', r_top=0.03, top=True)


def _leg(b, ax, ay, az, bx, by, bz, w, col):
    """A thin square leg from (ax, ay, az) to (bx, by, bz)."""
    c = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    for i in range(4):
        p, q = c[i], c[(i + 1) % 4]
        b.face([(ax + p[0] * w / 2, ay + p[1] * w / 2, az), (ax + q[0] * w / 2, ay + q[1] * w / 2, az),
                (bx + q[0] * w / 2, by + q[1] * w / 2, bz), (bx + p[0] * w / 2, by + p[1] * w / 2, bz)], 'plain', col)


def entrance_canopy(b, lk, x0, x1, y_front, z, depth, th=0.45, col=None, columns=2, round_cols=False, sign=False):
    """A flat entrance canopy slab standing in front of the wall at y_front on `columns` columns (0 = cantilevered)."""
    ec = lk.trim_col
    cols = None
    if columns:
        r = 0.2
        cols = [(x0 + r + 0.4 + (x1 - x0 - 2 * r - 0.8) * k / max(1, columns - 1), y_front - depth + 0.6) for k in range(columns)]
    lib.box(b, x0, y_front - depth, z - th, x1, y_front, z, lk.wall_slot, ec, top_slot='roof-flat', top_col=col or lk.roof_col, skip=())
    for (x, y) in (cols or []):
        if b.detail >= 2:
            continue
        if round_cols and b.detail == 0:
            lib.cylinder(b, x, y, 0, z - th, 0.2, n=8, slot=lk.wall_slot, col=ec, r_top=0.2, top=False)
        else:
            lib.box_c(b, x, y, 0, 0.4, 0.4, z - th, lk.wall_slot, ec)


def covered_walk(b, lk, p0, p1, z=2.9, w=2.6, col=None, roof=None):
    """A covered walkway (flat roof on posts) between two points, e.g. linking hospital wards."""
    if b.detail >= 2:
        return
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy)
    if L < 1.0:
        return
    ux, uy = dx / L, dy / L
    yaw = math.atan2(dy, dx)
    cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    lib.obox(b, cx, cy, z, L, w + 0.5, 0.25, yaw, lk.wall_slot, col or lk.trim_col, top_slot='roof-flat', top_col=roof or shade(lk.roof_col, 1.05), skip=())
    if b.detail >= 1:
        return
    n = max(2, int(L / 3.5) + 1)
    for k in range(n):
        t = k / (n - 1)
        for sgn in (-1, 1):
            px = p0[0] + dx * t - uy * sgn * w / 2
            py = p0[1] + dy * t + ux * sgn * w / 2
            lib.box_c(b, px, py, 0, 0.18, 0.18, z, lk.wall_slot, col or lk.trim_col)
    lib.obox(b, cx, cy, 0, L, w, 0.1, yaw, 'paving', '#bdb8ae', skip=('bottom', 'front', 'back', 'left', 'right'))


def parapet_mass(b, fp, z, lk, h=0.8, thick=0.3, col=None):
    if b.detail >= 2:
        return
    lib.parapet(b, fp, z, h, thick, lk, col=col)


def roof_plant(b, lk, rect, z, rng, count=4, tall=2.2):
    """Plant rooms / lift cores / vents on a flat roof."""
    if b.detail >= 1:
        return
    x0, y0, x1, y1 = rect
    for _ in range(count):
        w, d, h = rng.uniform(2.5, 6), rng.uniform(2, 4.5), rng.uniform(1.4, tall)
        if x1 - x0 < w + 2 or y1 - y0 < d + 2:
            continue
        cx = rng.uniform(x0 + w / 2 + 1, x1 - w / 2 - 1)
        cy = rng.uniform(y0 + d / 2 + 1, y1 - d / 2 - 1)
        lib.box_c(b, cx, cy, z, w, d, h, 'metal-cladding', shade(lk.metal_col, rng.uniform(0.85, 1.05)), top_slot='roof-flat', skip=('bottom',))


def solar_row(b, lk, rect, z, rng, rows=3):
    if b.detail >= 1:
        return
    x0, y0, x1, y1 = rect
    for r in range(rows):
        y = y0 + (y1 - y0) * (r + 1) / (rows + 1)
        pts = [(x0 + 3, y - 0.9, z + 0.25), (x1 - 3, y - 0.9, z + 0.25), (x1 - 3, y + 0.9, z + 1.0), (x0 + 3, y + 0.9, z + 1.0)]
        b.facing(pts, (0, -0.4, 1), 'glass-ribbon', '#7f95ab', mode='tile')


def low_conf(brief):
    return ((brief or {}).get('confidence') or 'low') == 'low'


def roof_rects(b, form, rects, z, lk, **kw):
    """lib.roof over a list of (x0, y0, x1, y1[, role]) rectangles. (lib.roof treats any footprint with more than ten corners
    as a round plan and builds a cone, so union outlines of H / U plans must not be passed to it.) For typed (low confidence) briefs
    the pitch varies by place, which gives look-alike roofs different profiles."""
    rr = [tuple(r[:4]) for r in rects]
    x0, y0, x1, y1 = bbox_of(rr)
    br = getattr(b, 'brief', None) or {}
    if 'pitch' in kw and low_conf(br):
        kw['pitch'] = kw['pitch'] * random.Random('%s/%s/pitch' % (br.get('city'), br.get('venueId'))).uniform(0.8, 1.32)
    return lib.roof(b, form, lib.Footprint([[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]], rr), z, lk, **kw)


def skyline(b, lk, rects, z1, st_h, srng, rng, kind='ribbon', ratio=0.4, bay=4.2, scheme=None):
    """Seeded rooftop massing for typed (low confidence) flat-roofed blocks: a set-back penthouse floor, taller ends, a central tower or
    a stepped roofline, so that look-alike blocks get clearly different silhouettes. Random numbers are always drawn."""
    pick, a, c, e = srng.random(), srng.random(), srng.random(), srng.choice([-1, 1])
    if not low_conf(getattr(b, 'brief', None)):
        return
    main = max([tuple(r[:4]) for r in rects], key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    x0, y0, x1, y1 = main
    L, D = x1 - x0, y1 - y0
    if L < 14 or D < 8:
        return
    kinds = ['none', 'penthouse', 'ends', 'tower', 'step']
    sch = scheme or kinds[0 if pick < 0.18 else 1 if pick < 0.38 else 2 if pick < 0.56 else 3 if pick < 0.76 else 4]
    boxes = []
    cx = (x0 + x1) / 2
    if sch == 'penthouse':
        wx = L * (0.3 + 0.3 * a)
        mx = cx + (c - 0.5) * L * 0.3
        boxes = [(mx - wx / 2, y0 + D * 0.1, mx + wx / 2, y1 - D * 0.1, 1)]
    elif sch == 'ends':
        ew = max(L * 0.15, 8.0)
        boxes = [(x0, y0, x0 + ew, y1, 1 + (1 if a > 0.5 else 0)), (x1 - ew, y0, x1, y1, 1 + (1 if c > 0.5 else 0))]
    elif sch == 'tower':
        tw = max(L * (0.1 + 0.07 * a), 7.0)
        mx = cx + (c - 0.5) * L * 0.45
        boxes = [(mx - tw / 2, y0 + D * 0.12, mx + tw / 2, y1 - D * 0.12, 2 + (1 if a > 0.5 else 0))]
    elif sch == 'step':
        third = L / 3
        order = [0, 1, 2] if e > 0 else [2, 1, 0]
        for k, slot in enumerate(order):
            n = 2 - k
            if n > 0:
                boxes.append((x0 + slot * third, y0, x0 + (slot + 1) * third, y1, n))
    for (bx0, by0, bx1, by1, n) in boxes:
        fp = lib.fp_rect(bx1 - bx0, by1 - by0, (bx0 + bx1) / 2, (by0 + by1) / 2)
        zt = z1 + n * st_h
        walls(b, fp, z1 - 0.01, zt, n, lk, rng, kind=kind, ratio=ratio, bay=bay, plinth=0, rear='same')
        lib.flat_roof(b, fp, zt, lk, parapet_h=0.0 if b.detail >= 2 else 0.6)


def pad(b, lk, brief, bbox, srng, front=16.0, side=6.0, back=6.0, forecourt=None, tree_h=8.0, trees=6, w_cap=124.0, plaza_col=None, path=True, density=1.0):
    """Ground pad + forecourt strip + front path + a few trees. Returns (px0, py0, px1, py1) of the pad."""
    coarse = getattr(b, 'coarse', 0)
    density = density / (1 + 0.6 * coarse)
    trees = int(trees / (1 + 0.5 * coarse)) if coarse else trees
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) / 2
    hw = min((x1 - x0) / 2 + side, w_cap / 2)
    px0, px1 = cx - hw, cx + hw
    py0, py1 = y0 - front, y1 + back
    if b.detail >= 2:
        return (px0, py0, px1, py1)
    lib.ground(b, px0, py0, px1, py1, lk)
    kind = forecourt or lk.forecourt
    if kind in (None, 'none'):
        kind = None
    if kind:
        lib.forecourt(b, kind, px0 + 1, py0 + 1, px1 - 1, y0 - 3.0, lk, srng, density=density, tree_h=tree_h)
    if path and b.detail < 2:
        with b.site():
            ent = 3.2
            b.face([(cx - ent / 2, py0, 0.06), (cx + ent / 2, py0, 0.06), (cx + ent / 2, y0 - 0.3, 0.06), (cx - ent / 2, y0 - 0.3, 0.06)], 'paving', '#cfc9bd', scale=2.0)
    if trees and lk.tree not in (None, 'none') and kind not in ('parking',):
        n = trees if b.detail == 0 else max(2, trees // 3)
        for k in range(n):
            side_ = -1 if k % 2 == 0 else 1
            tx = cx + side_ * (hw - 2.5 - srng.random() * 4)
            ty = y0 - 4 - srng.random() * (front - 6)
            if abs(tx - cx) < 5:
                tx += side_ * 6
            lib.tree(b, lk.tree, tx, ty, tree_h * srng.uniform(0.8, 1.15), srng, lk)
    return (px0, py0, px1, py1)


# ------------------------------------------------------------------------------------------------------ towers and portals
def clock_tower(b, lk, cx, cy, z0, w, h, cap='hip', cap_rise=None, clock_r=None, d=None, wall_col=None, wall_slot=None, windows='punched', belfry=True,
                stone_col=None, clock=True, storeys=None, ratio=0.22, finial=0.0):
    """A square clock / bell tower: walls with a small window rhythm, a belfry stage with louvred openings, clock faces on all four
    sides below the cap (cap: hip | flat | spire | pyramid | gable | dome | none). Returns the z of the cap base."""
    d = d or w
    ws, wc = wall_slot or lk.wall_slot, wall_col or lk.wall_col
    rect = (cx - w / 2, cy - d / 2, cx + w / 2, cy + d / 2)
    bel_h = min(h * 0.22, 6.0) if belfry else 0.0
    shaft_h = h - bel_h
    fp = lib.fp_rect(w, d, cx, cy)
    storeys = storeys or max(1, int(shaft_h / 4.2))
    if b.detail >= 1:
        lib.box(b, rect[0], rect[1], z0, rect[2], rect[3], z0 + h, ws, wc, skip=('bottom',))
    else:
        walls(b, fp, z0, z0 + shaft_h, storeys, lk, None, kind=windows, ratio=ratio, wall_slot=ws, wall_col=wc, plinth=0, rear='same')
        if belfry:
            zb = z0 + shaft_h
            lib.sweep(b, fp, zb - 0.1, [(0, 0), (0.25, 0), (0.25, 0.3), (0, 0.4)], 'plain-render', stone_col or lk.trim_col)
            walls(b, fp, zb, zb + bel_h, 1, lk, None, kind='louvre', ratio=0.5, wall_slot=ws, wall_col=wc, plinth=0, rear='same')
    zt = z0 + h
    if b.detail < 2:
        # corner quoins
        if b.detail == 0:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    lib.box_c(b, cx + sx * (w / 2 - 0.15), cy + sy * (d / 2 - 0.15), z0, 0.5, 0.5, h, ws, shade(stone_col or lk.trim_col, 1.0), skip=('bottom', 'top'))
    if clock and b.detail < 2:
        r = clock_r or min(w * 0.3, 1.8)
        zc = z0 + shaft_h - r * 1.2 if belfry else zt - r * 1.8
        clock_face(b, cx, cy - d / 2 - 0.05, zc, r, (0, -1, 0))
        clock_face(b, cx, cy + d / 2 + 0.05, zc, r, (0, 1, 0))
        clock_face(b, cx - w / 2 - 0.05, cy, zc, r, (-1, 0, 0))
        clock_face(b, cx + w / 2 + 0.05, cy, zc, r, (1, 0, 0))
    rs, rc = lk.roof_slot, lk.roof_col
    if cap == 'flat':
        lib.flat_roof(b, fp, zt, lk, parapet_h=0.7)
    elif cap in ('hip', 'pyramid', 'spire'):
        rise = cap_rise or (w * 0.9 if cap == 'hip' else w * 1.8)
        lib.hip(b, rect, zt, rise, lk, ov=0.4)
        if finial:
            lib.cylinder(b, cx, cy, zt + rise, zt + rise + finial, 0.06, n=5, slot='frame', col=lk.metal_col, r_top=0.02, top=True)
    elif cap == 'gable':
        lib.gable(b, rect, zt, cap_rise or w * 0.4, lk, ov=0.4)
    elif cap == 'dome':
        lib.dome(b, cx, cy, zt, min(w, d) / 2, lk, profile='hemi', lantern=0.8, finial=1.2)
    return zt


def turret(b, x, y, z0, z1, r, col, slot, cone_h=None, cone_col=None, n=8, crenel=False):
    """A round / octagonal corner turret with a conical cap (or crenellated top)."""
    if b.detail >= 2:
        lib.cylinder(b, x, y, z0, z1, r, n=6, slot='plain', col=col, top=True, smooth=False)
        return
    nn = n if b.detail == 0 else 6
    lib.cylinder(b, x, y, z0, z1, r, n=nn, slot=slot, col=col, top=not cone_h, smooth=False)
    if cone_h:
        lib.cylinder(b, x, y, z1, z1 + cone_h, r * 1.2, n=nn, slot='slate', col=cone_col or '#4a5058', r_top=0.0, top=False, smooth=False)
    elif b.detail == 0:
        lib.cylinder(b, x, y, z1, z1 + 0.6, r * 1.12, n=nn, slot=slot, col=shade(col, 0.95), r_top=r * 1.12, top=True, smooth=False)


def arch_portal(b, seg, u0, u1, z0, z1, cu, aw, spring, col, slot, pointed=True, dark='#2b2e33', reveal=0.0, tall=1.0):
    """A wall panel u0..u1 x z0..z1 on a segment with an arched opening of width aw centred at cu (springing at `spring`), behind
    which a dark glazed quad is set. Pointed (gothic / Islamic) or round."""
    ns = 6
    ua, ub = cu - aw / 2, cu + aw / 2
    if ua > u0:
        b.face([seg.P(u0, z0), seg.P(ua, z0), seg.P(ua, z1), seg.P(u0, z1)], slot, col)
    if ub < u1:
        b.face([seg.P(ub, z0), seg.P(u1, z0), seg.P(u1, z1), seg.P(ub, z1)], slot, col)
    pts = []
    for j in range(ns + 1):
        t = j / ns
        if pointed:
            half = aw / 2
            u = ua + aw * t
            z = spring + (aw / 2) * 1.2 * (1 - abs(2 * t - 1) ** 1.6) ** 0.9 * tall
        else:
            a = math.pi * (1 - t)
            u = cu + math.cos(a) * aw / 2
            z = spring + math.sin(a) * aw / 2
        pts.append((u, z))
    for (ua_, za), (ub_, zb) in zip(pts[:-1], pts[1:]):
        if abs(ub_ - ua_) > 1e-4:
            b.facing([seg.P(ua_, za), seg.P(ub_, zb), seg.P(ub_, z1), seg.P(ua_, z1)], seg.N3(), slot, col)
    outline = [seg.P(ua, z0, 0.35 + reveal), seg.P(ub, z0, 0.35 + reveal)] + [seg.P(u, z, 0.35 + reveal) for (u, z) in reversed(pts)]
    # opening backing (dark), plus the two jambs
    if b.detail < 2:
        b.facing([seg.P(ua, z0, 0.35 + reveal), seg.P(ub, z0, 0.35 + reveal), seg.P(ub, spring, 0.35 + reveal), seg.P(ua, spring, 0.35 + reveal)], seg.N3(), 'glass-shopfront', '#cfd6db')
        # arched head glazing fan
        c = seg.P(cu, spring, 0.35 + reveal)
        for (ua_, za), (ub_, zb) in zip(pts[:-1], pts[1:]):
            b.facing([seg.P(ua_, za, 0.35 + reveal), seg.P(ub_, zb, 0.35 + reveal), seg.P(ub_, spring, 0.35 + reveal), seg.P(ua_, spring, 0.35 + reveal)], seg.N3(), 'glass-shopfront', '#cfd6db')
        for u, hint in ((ua, (seg.u[0], seg.u[1], 0)), (ub, (-seg.u[0], -seg.u[1], 0))):
            b.facing([seg.P(u, z0, 0), seg.P(u, spring, 0), seg.P(u, spring, 0.35 + reveal), seg.P(u, z0, 0.35 + reveal)], hint, slot, shade(col, 0.8))


def buttress_row(b, seg, us, z1, w=0.7, proud=0.7, col='#c8c0b0', slot='stone-blocks'):
    """Stepped buttresses against a wall (gothic bays): a wide lower stage and a slimmer sloping top."""
    if b.detail >= 1:
        return
    for u in us:
        lib.seg_box(b, seg, u - w / 2, u + w / 2, 0, z1 * 0.62, proud, col, slot)
        lib.seg_box(b, seg, u - w / 2, u + w / 2, z1 * 0.62, z1 * 0.9, proud * 0.6, col, slot, inset=0.0)
        b.facing([seg.P(u - w / 2, z1 * 0.9, -proud * 0.6), seg.P(u + w / 2, z1 * 0.9, -proud * 0.6), seg.P(u + w / 2, z1 * 0.96, 0), seg.P(u - w / 2, z1 * 0.96, 0)], (seg.n[0], seg.n[1], 1), slot, shade(col, 1.05))


def fins_row(b, seg, z0, z1, pitch=1.4, w=0.12, proud=0.5, col='#cfc8b8', slot='plain-render', u0=0.5, u1=None):
    """Vertical brise-soleil fins along a wall."""
    if b.detail >= 1:
        return
    u1 = seg.length - 0.5 if u1 is None else u1
    n = max(1, int((u1 - u0) / pitch))
    for k in range(n + 1):
        u = u0 + (u1 - u0) * k / n
        lib.seg_box(b, seg, u - w / 2, u + w / 2, z0, z1, proud, col, slot)


def balcony_slab(b, seg, z, proud=1.4, col='#d8d4cc', rail=True, rail_col=None, u0=0.0, u1=None, slot='plain-render', thick=0.22, rail_h=1.0):
    """A projecting balcony / access gallery slab at height z along a wall, with a solid or railed parapet."""
    if b.detail >= 2:
        return
    u1 = seg.length if u1 is None else u1
    lib.seg_box(b, seg, u0, u1, z - thick, z, proud, col, slot, inset=0.0)
    if rail:
        if b.detail == 0:
            lib.seg_box(b, seg, u0, u1, z, z + rail_h, proud, rail_col or shade(col, 0.95), slot, inset=proud - 0.12)
        else:
            lib.seg_box(b, seg, u0, u1, z, z + rail_h, proud, rail_col or shade(col, 0.95), slot, inset=proud - 0.12)


# ------------------------------------------------------------------------------------------------------------ site assembly
def kiosk(b, lk, x, y, w=2.4, d=2.2, h=2.6, col='#c8362f', roof='#d8d8d4'):
    """A small booth / guard post (site layer)."""
    if b.detail >= 2:
        return
    with b.site():
        lib.box_c(b, x, y, 0, w, d, h, 'plain-render', col, skip=('bottom',))
        lib.box_c(b, x, y, h, w + 0.6, d + 0.6, 0.15, 'plain-render', roof)
        if b.detail == 0:
            b.face([(x - w * 0.35, y - d / 2 - 0.02, 1.0), (x + w * 0.35, y - d / 2 - 0.02, 1.0), (x + w * 0.35, y - d / 2 - 0.02, 2.0), (x - w * 0.35, y - d / 2 - 0.02, 2.0)], 'glass-shopfront', '#cfd8dc')


def umbrella(b, x, y, col='#d84c3a', r=1.5, h=2.4):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.04, n=4, slot='frame', col='#c9cdd0', r_top=0.04, top=False)
        lib.cylinder(b, x, y, h - 0.45, h, r, n=8, slot='plain', col=col, r_top=0.0, top=False, smooth=False)


def courtyard_garden(b, lk, rect, srng, fountain_r=0.0, trees=3, path=True):
    """Lawn, cross paths, trees and an optional fountain inside a courtyard rect (site layer)."""
    if b.detail >= 2:
        return
    x0, y0, x1, y1 = rect
    if x1 - x0 < 4 or y1 - y0 < 4:
        return
    with b.site():
        b.face([(x0 + 0.5, y0 + 0.5, 0.08), (x1 - 0.5, y0 + 0.5, 0.08), (x1 - 0.5, y1 - 0.5, 0.08), (x0 + 0.5, y1 - 0.5, 0.08)], 'grass', '#6d9a4f', scale=2.0)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if path:
            b.face([(cx - 1.0, y0 + 0.5, 0.1), (cx + 1.0, y0 + 0.5, 0.1), (cx + 1.0, y1 - 0.5, 0.1), (cx - 1.0, y1 - 0.5, 0.1)], 'paving', '#cbc6bb', scale=2.0)
            b.face([(x0 + 0.5, cy - 1.0, 0.11), (x1 - 0.5, cy - 1.0, 0.11), (x1 - 0.5, cy + 1.0, 0.11), (x0 + 0.5, cy + 1.0, 0.11)], 'paving', '#cbc6bb', scale=2.0)
    if fountain_r > 0:
        fountain(b, (x0 + x1) / 2, (y0 + y1) / 2, min(fountain_r, (x1 - x0) / 4, (y1 - y0) / 4))
    if lk.tree not in (None, 'none'):
        n = trees if b.detail == 0 else max(1, trees // 2)
        qx, qy = (x1 - x0) / 4, (y1 - y0) / 4
        for k in range(n):
            sx, sy = (-1 if k % 2 == 0 else 1), (-1 if (k // 2) % 2 == 0 else 1)
            tx = (x0 + x1) / 2 + sx * qx * (1.0 + 0.25 * srng.uniform(-1, 1))
            ty = (y0 + y1) / 2 + sy * qy * (1.0 + 0.25 * srng.uniform(-1, 1))
            lib.tree(b, lk.tree, tx, ty, 7.0 * srng.uniform(0.8, 1.1), srng, lk)


def site_common(b, lk, brief, F, brief_txt, srng, bbox, cx=None, front=18.0, side=7.0, back=7.0, tree_h=9.0, flag_h=9.0, gate_w=7.5, fence_default=False,
                tank_at=None, statue_h=4.5, sign_at=None, trees=5, forecourt_default=None, flag_y=None, flag_span=14.0):
    """Ground pad, forecourt, perimeter wall / gate, flag poles, sign pylon, statues, fountain, kiosk, water tank, trees.
    Everything is driven by the brief's features and setting. Returns the pad rect."""
    x0, y0, x1, y1 = bbox
    cx = (x0 + x1) / 2 if cx is None else cx
    forecourt = lk.forecourt
    if forecourt in (None, 'none') and forecourt_default:
        forecourt = forecourt_default
    if 'car-park' in F and forecourt in (None, 'none'):
        forecourt = 'parking'
    px = pad(b, lk, brief, bbox, srng, front=front, side=side, back=back, forecourt=forecourt, tree_h=tree_h, trees=trees)
    if b.detail >= 2:
        return px
    if 'fence-wall' in F or 'gate' in F or fence_default:
        kind = 'railing' if (lk.wall_material in ('glass-curtain', 'metal-cladding') or has(brief_txt, 'railing', 'palisade')) else 'wall'
        fence_wall(b, lk, px[0] + 0.5, px[1] + 0.5, px[2] - 0.5, px[3] - 0.5, gate_x=cx, gate_w=gate_w if ('gate' in F or fence_default or 'fence-wall' in F) else 0,
                   h=2.0, kind=kind, col=shade(lk.wall_col, 0.96), sides=True, back=True)
    if 'flags' in F:
        n = int(clamp(F['flags'].get('count', 3) or 3, 1, 5))
        fy = flag_y if flag_y is not None else y0 - front * 0.45
        xs = [cx + flag_span * (k / max(1, n - 1) - 0.5) for k in range(n)] if n > 1 else [cx - 5.0]
        if n == 1:
            xs = [cx - 6.0]
        flags(b, lk, xs, fy, flag_h, flag_cols(brief, lk, srng))
    if 'statue' in F:
        statue(b, cx + (7.0 if 'fountain' in F else 0.0) - (0 if 'fountain' in F else 0.0), y0 - front * 0.62, statue_h, col=srng.choice(['#6b5a3c', '#3f4a3a', '#7a6a50', '#4a4a4c']))
    if 'fountain' in F:
        fountain(b, cx - (4.0 if 'statue' in F else 0.0), y0 - front * 0.6, 3.6)
    if 'signage-board' in F:
        sx, sy = sign_at if sign_at else (px[2] - 8.0, px[1] + 2.4)
        with b.site():
            if b.detail == 0:
                for sgn in (-1, 1):
                    lib.cylinder(b, sx + sgn * 1.7, sy, 0, 3.0, 0.08, n=5, slot='frame', col='#8d9298', r_top=0.08, top=False)
            lib.box_c(b, sx, sy, 1.4, 3.8, 0.2, 1.6, 'plain', srng.choice(['#f2f0e8', '#2f6b4f', '#244a73']), skip=('bottom',))
    if 'kiosk' in F:
        kiosk(b, lk, px[0] + 6.0, px[1] + 3.0)
    if 'water-tank' in F:
        tx, ty = tank_at if tank_at else (x1 + 6, y1 - 3)
        tank_tower(b, tx, ty, h=8.0, r=1.6, tank_col=srng.choice(['#1f3f66', '#2d5a3d', '#7b2d26', '#3a3d42']))
    return px


def gallery2(b, lk, p0, p1, z_wall_top, st_h, depth=2.4, post='square', rail_col=None, pitch_m=3.0, r=0.11, col=None):
    """Two-level veranda (school / colonial): posts and a ground slab, a first-floor gallery with a railing, and a lean-to roof."""
    seg = lib.Seg(p0, p1)
    L = seg.length
    col = col or lk.trim_col
    if b.detail >= 2:
        veranda(b, lk, p0, p1, 0, z_wall_top - 0.9, depth, z_wall_top - 0.4)
        return
    pitch_m *= (2.0 if b.detail == 1 else 1.0) * (1 + 0.5 * getattr(b, 'coarse', 0))
    yaw = math.atan2(seg.u[1], seg.u[0])
    cx, cy, _ = seg.P(L / 2, 0, -depth / 2)
    lib.obox(b, cx, cy, 0, L, depth, 0.2, yaw, 'paving', shade(lk.stone_col, 0.95), skip=('bottom', 'back'))
    lib.obox(b, cx, cy, st_h - 0.22, L, depth, 0.22, yaw, lk.wall_slot, shade(col, 0.95), top_slot='paving', top_col='#b9b4aa', skip=('bottom', 'back'))
    n = max(2, int(round(L / pitch_m)) + 1)
    z_eave = z_wall_top - 0.9
    for k in range(n):
        u = 0.25 + (L - 0.5) * k / (n - 1)
        x, y, _ = seg.P(u, 0, -depth + r + 0.1)
        lib.box_c(b, x, y, 0.2, 2 * r, 2 * r, st_h - 0.22 - 0.2, lk.wall_slot, col)
        lib.box_c(b, x, y, st_h, 2 * r, 2 * r, z_eave - st_h - 0.1, lk.wall_slot, col)
    pa, pb = seg.P(0.25, 0, -depth + r + 0.1), seg.P(L - 0.25, 0, -depth + r + 0.1)
    balustrade(b, (pa[0], pa[1]), (pb[0], pb[1]), st_h, 1.0, rail_col or col, pitch=1.5)
    veranda(b, lk, p0, p1, z_eave, z_eave, depth, z_wall_top - 0.4, col=col, floor=False, posts=False)


# ------------------------------------------------------------------------------------------------------- silhouette variety
def roof_tank(b, x, y, z, r=1.4, h=1.7, col='#2d5a3d'):
    """A cylindrical water tank on a low steel stand, standing on a roof at height z."""
    if b.detail >= 1:
        return
    for sx in (-1, 1):
        for sy in (-1, 1):
            lib.box_c(b, x + sx * r * 0.65, y + sy * r * 0.65, z, 0.14, 0.14, 1.1, 'frame', '#7d8286')
    lib.cylinder(b, x, y, z + 1.1, z + 1.1 + h, r, n=10, slot='metal-cladding', col=col, r_top=r, top=True, smooth=True)


def roof_variety(b, lk, rects, z, srng, st_h=3.6, kinds=('stair', 'tank', 'sign', 'mast'), main=None):
    """Seeded roof-level furniture (stair towers, a tank, a blank roof sign, an aerial) so look-alike blocks get different skylines.
    Random numbers are always drawn (all LODs stay in step); geometry only at LOD0, where the silhouette mask is taken."""
    rects = [tuple(r[:4]) for r in rects]
    main = main or max(rects, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    plan = []
    n_stair = srng.choice([0, 1, 1, 2, 2, 3]) if 'stair' in kinds else 0
    for k in range(n_stair):
        r = srng.choice(rects)
        plan.append(('stair', r, srng.random(), srng.random(), srng.uniform(3.4, 5.4), srng.uniform(0.75, 1.25)))
    if 'tank' in kinds and srng.random() < 0.4:
        plan.append(('tank', srng.choice(rects), srng.random(), srng.random(), srng.uniform(1.1, 1.7), 0))
    if 'sign' in kinds and srng.random() < 0.3:
        plan.append(('sign', main, srng.random(), 0, srng.uniform(7.0, 13.0), 0))
    if 'mast' in kinds and srng.random() < 0.3:
        plan.append(('mast', srng.choice(rects), srng.random(), srng.random(), srng.uniform(5.0, 9.0), 0))
    if b.detail >= 1:
        return
    for kind, r, u, v, s, hs in plan:
        x0, y0, x1, y1 = r
        if x1 - x0 < 8 or y1 - y0 < 6:
            continue
        cx = x0 + 3.0 + u * (x1 - x0 - 6.0)
        cy = y0 + 3.0 + v * (y1 - y0 - 6.0)
        if kind == 'stair':
            lib.box_c(b, cx, cy, z, s, s * 0.9, st_h * hs, lk.wall_slot, shade(lk.wall_col, 0.94), top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
            b.face([(cx - s * 0.3, cy - s * 0.45 - 0.03, z + st_h * hs * 0.3), (cx + s * 0.3, cy - s * 0.45 - 0.03, z + st_h * hs * 0.3), (cx + s * 0.3, cy - s * 0.45 - 0.03, z + st_h * hs * 0.85),
                    (cx - s * 0.3, cy - s * 0.45 - 0.03, z + st_h * hs * 0.85)], 'glass-punched', lk.glass_col)
        elif kind == 'tank':
            roof_tank(b, cx, cy, z, r=s)
        elif kind == 'sign':
            sx = x0 + 3.0 + u * max(0.0, x1 - x0 - 6.0 - s)
            for lx in (sx + 0.4, sx + s - 0.4):
                lib.box_c(b, lx, y0 + 1.0, z, 0.16, 0.16, 1.4, 'frame', '#7d8286')
            lib.box_c(b, sx + s / 2, y0 + 1.0, z + 1.2, s, 0.2, 1.5, 'plain', '#f2f0e8', skip=('bottom',))
        elif kind == 'mast':
            lib.cylinder(b, cx, cy, z, z + s, 0.07, n=4, slot='frame', col='#8d9298', r_top=0.03, top=True)
