"""Look (brief + style -> slots and colours) and facades: window bays that are really cut (LOD0) or inset flat (LOD1)."""
import math

from .core import mix, pick, rgb, shade, to_hex
from .shapes import Footprint, Seg, box, sweep, cap

WALL_SLOT = {
    'render': 'plain-render', 'painted-render': 'plain-render', 'stucco': 'plain-render', 'whitewash': 'plain-render',
    'concrete': 'rough-concrete', 'exposed-concrete': 'rough-concrete',
    'brick': 'brick', 'red-brick': 'brick',
    'stone': 'stone-blocks', 'sandstone': 'stone-blocks', 'limestone': 'stone-blocks', 'marble': 'stone-blocks', 'granite': 'stone-blocks',
    'glass-curtain': 'metal-cladding', 'metal-cladding': 'metal-cladding', 'timber': 'timber',
    'mud-render': 'mud-render', 'laterite': 'mud-render', 'tile-cladding': 'plain-render',
}
ROOF_SLOT = {
    'metal-sheet': 'metal-roof', 'corrugated': 'corrugated', 'clay-tile': 'clay-tile', 'slate': 'slate', 'concrete': 'roof-flat',
    'membrane': 'roof-flat', 'copper': 'metal-roof', 'gold-leaf': 'metal-roof', 'thatch': 'timber', 'timber-shingle': 'timber', 'glass': 'glass-ribbon',
}
GROUND_SLOT = {'laterite': 'laterite', 'asphalt': 'asphalt', 'paving': 'paving', 'grass': 'grass', 'sand': 'sand', 'cobble': 'paving', 'snow': 'plain-render'}
GROUND_COL = {'laterite': '#b5654a', 'asphalt': '#5a5c5f', 'paving': '#b9b4aa', 'grass': '#6d9a4f', 'sand': '#d9c08a', 'cobble': '#8e8a82', 'snow': '#f2f4f7'}


class Look:
    """Resolved visual vocabulary for one place: atlas slots + hex tints. Archetypes may overwrite any attribute."""

    def __init__(self, brief, style, rng=None):
        f = (brief or {}).get('facade', {})
        st = style or {}
        cols = list(f.get('colours') or [])
        wall_defaults = st.get('wallColours') or ['#d8d2c4']
        self.wall_col = cols[0] if cols else pick(rng, wall_defaults)
        self.accent_col = cols[1] if len(cols) > 1 else shade(self.wall_col, 0.8)
        self.trim_col = cols[2] if len(cols) > 2 else shade(self.wall_col, 1.08)
        mat_ = f.get('material') or (st.get('wallMaterials') or ['render'])[0]
        self.wall_material = mat_
        self.wall_slot = WALL_SLOT.get(mat_, 'plain-render')
        acc = f.get('accent')
        self.accent_slot = WALL_SLOT.get(acc, self.wall_slot) if acc else self.wall_slot
        roofm = (st.get('roofMaterials') or ['metal-sheet'])[0]
        self.roof_slot = ROOF_SLOT.get(roofm, 'metal-roof')
        self.roof_col = f.get('roofColour') or pick(rng, st.get('roofColours') or ['#8a8f94'])
        self.glass_slot = 'glass-curtain'
        self.glass_col = '#dfe9ef'  # multiplies the dark glass texture: near white keeps it dark/neutral
        self.frame_col = shade(self.trim_col, 0.8)
        self.windows = f.get('windows', 'punched')
        self.ratio = float(f.get('windowRatio', 0.4))
        ground = (brief or {}).get('setting', {}).get('ground') or st.get('ground') or 'paving'
        self.ground_slot = GROUND_SLOT.get(ground, 'paving')
        self.ground_col = GROUND_COL.get(ground, '#b0aca4')
        self.tree = (brief or {}).get('setting', {}).get('trees') or ((st.get('vegetation') or ['broadleaf'])[0])
        self.forecourt = (brief or {}).get('setting', {}).get('forecourt') or 'none'
        self.stone_col = '#cfcac0'
        self.dark_col = '#3b3e42'
        self.metal_col = '#9ea3a8'


def look(brief, style, rng=None):
    return Look(brief, style, rng)


# -------------------------------------------------------------------------------------------------------------- facade
def _wall(b, seg, u0, u1, z0, z1, slot, col, d=0.0, scale=1.0):
    if u1 - u0 < 1e-4 or z1 - z0 < 1e-4:
        return
    b.face([seg.P(u0, z0, d), seg.P(u1, z0, d), seg.P(u1, z1, d), seg.P(u0, z1, d)], slot, col, scale=scale * (2.5 if b.detail >= 1 else 1.0))


def _glass(b, seg, pts_uz, d, slot, col, mode=None):
    b.face([seg.P(u, z, d) for u, z in pts_uz], slot, col, mode=mode)


def _arch(shape, ou0, ou1, zs, n):
    """Points (u, z) of the arch head from the left springing to the right springing."""
    w = ou1 - ou0
    pts = []
    if shape == 'arch':
        cx = (ou0 + ou1) / 2
        for k in range(n + 1):
            a = math.pi * (1 - k / n)
            pts.append((cx + math.cos(a) * w / 2, zs + math.sin(a) * w / 2))
    else:  # pointed: two arcs of radius w
        half = max(2, n // 2)
        for k in range(half + 1):
            a = math.pi - (math.pi / 3) * k / half
            pts.append((ou1 + math.cos(a) * w, zs + math.sin(a) * w))
        for k in range(half - 1, -1, -1):
            a = math.pi - (math.pi / 3) * k / half
            pts.append((ou0 - math.cos(a) * w, zs + math.sin(a) * w))
    return pts


def _round_bay(b, seg, look, u0, u1, zb, zt, ou0, ou1, sill, top, depth, cut, glass_slot, wall_slot, col):
    """A bay with a circular opening (oculus / porthole) inscribed in ou0..ou1 x sill..top."""
    uc, zc = (ou0 + ou1) / 2, (sill + top) / 2
    rho = min(ou1 - ou0, top - sill) / 2
    n = 8
    circ = [(uc + rho * math.cos(2 * math.pi * k / n), zc + rho * math.sin(2 * math.pi * k / n)) for k in range(n)]
    if not cut:
        _wall(b, seg, u0, u1, zb, zt, wall_slot, col)
        _glass(b, seg, circ, -0.03, glass_slot, look.glass_col)
        return
    _wall(b, seg, u0, u1, zb, zc - rho, wall_slot, col)
    _wall(b, seg, u0, uc - rho, zc - rho, zt, wall_slot, col)
    _wall(b, seg, uc + rho, u1, zc - rho, zt, wall_slot, col)
    _wall(b, seg, uc - rho, uc + rho, zc + rho, zt, wall_slot, col)
    q = n // 4
    for quad in range(4):   # the four corner pieces between the square and the circle
        a0 = quad * q
        arc = [circ[(a0 + k) % n] for k in range(q + 1)]
        cu = uc + (rho if quad in (0, 3) else -rho)
        cz = zc + (rho if quad in (0, 1) else -rho)
        b.facing([seg.P(pu, pz) for pu, pz in arc + [(cu, cz)]], seg.N3(), wall_slot, col)
    dark = shade(col, 0.8)
    cen = seg.P(uc, zc, depth)
    for k in range(n):
        p, qn = circ[k], circ[(k + 1) % n]
        m = seg.P((p[0] + qn[0]) / 2, (p[1] + qn[1]) / 2, 0)
        b.facing([seg.P(p[0], p[1]), seg.P(qn[0], qn[1]), seg.P(qn[0], qn[1], depth), seg.P(p[0], p[1], depth)], (cen[0] - m[0], cen[1] - m[1], cen[2] - m[2]), wall_slot, dark)
    _glass(b, seg, circ, depth, glass_slot, look.glass_col)
    seg_box(b, seg, uc - rho - 0.1, uc + rho + 0.1, zc - rho - 0.09, zc - rho, 0.12, look.trim_col, wall_slot)


def _punched_bay(b, seg, look, u0, u1, zb, zt, ou0, ou1, sill, top, shape, depth, cut, glass_slot, wall_slot, col, arch_n=6, frame=True):
    """One wall bay (u0..u1, zb..zt) with an opening ou0..ou1 between sill and top (top = crown height for arched shapes)."""
    if shape == 'round':
        return _round_bay(b, seg, look, u0, u1, zb, zt, ou0, ou1, sill, top, depth, cut, glass_slot, wall_slot, col)
    if shape == 'rect':
        zs, arch = top, None
        outline = [(ou0, sill), (ou1, sill), (ou1, top), (ou0, top)]
    else:
        rise = (ou1 - ou0) * (0.5 if shape == 'arch' else 0.866)
        zs = top - rise
        arch = _arch(shape, ou0, ou1, zs, arch_n)
        outline = [(ou0, sill), (ou1, sill)] + list(reversed(arch))
    if not cut:
        _wall(b, seg, u0, u1, zb, zt, wall_slot, col)
        _glass(b, seg, outline, -0.03, glass_slot, look.glass_col)
        return
    dd = depth
    _wall(b, seg, u0, u1, zb, sill, wall_slot, col)
    _wall(b, seg, u0, ou0, sill, zt, wall_slot, col)
    _wall(b, seg, ou1, u1, sill, zt, wall_slot, col)
    if shape == 'rect':
        _wall(b, seg, ou0, ou1, top, zt, wall_slot, col)
    else:
        for (ua, za), (ub, zc) in zip(arch[:-1], arch[1:]):
            if abs(ub - ua) > 1e-4:
                b.facing([seg.P(ua, za), seg.P(ub, zc), seg.P(ub, zt), seg.P(ua, zt)], seg.N3(), wall_slot, col)
    dark = shade(col, 0.8)

    def reveal(p, q, hint):
        b.facing([seg.P(p[0], p[1]), seg.P(q[0], q[1]), seg.P(q[0], q[1], dd), seg.P(p[0], p[1], dd)], hint, wall_slot, dark)

    reveal((ou0, sill), (ou0, zs), (seg.u[0], seg.u[1], 0))
    reveal((ou1, sill), (ou1, zs), (-seg.u[0], -seg.u[1], 0))
    reveal((ou0, sill), (ou1, sill), (0, 0, 1))
    if shape == 'rect':
        reveal((ou0, top), (ou1, top), (0, 0, -1))
    else:
        c = seg.P((ou0 + ou1) / 2, zs, dd)
        for (ua, za), (ub, zc) in zip(arch[:-1], arch[1:]):
            m = seg.P((ua + ub) / 2, (za + zc) / 2, 0)
            reveal((ua, za), (ub, zc), (c[0] - m[0], c[1] - m[1], c[2] - m[2]))
    _glass(b, seg, outline, dd, glass_slot, look.glass_col)
    if frame:
        seg_box(b, seg, ou0 - 0.1, ou1 + 0.1, sill - 0.09, sill, 0.12, look.trim_col, wall_slot)
        if ou1 - ou0 > 1.3:
            mc = (ou0 + ou1) / 2
            seg_box(b, seg, mc - 0.035, mc + 0.035, sill, zs, -dd + 0.06, look.frame_col, 'frame', inset=dd)


def seg_box(b, seg, u0, u1, z0, z1, proud, col, slot, inset=0.0):
    """A box on a wall: u0..u1, z0..z1, standing `proud` metres out of the wall plane (negative: sunk) with its back at depth `inset`."""
    d0 = -proud
    d1 = inset
    # front face
    b.face([seg.P(u0, z0, d0), seg.P(u1, z0, d0), seg.P(u1, z1, d0), seg.P(u0, z1, d0)], slot, col)
    # top, bottom, sides (only outward ones)
    b.facing([seg.P(u0, z1, d0), seg.P(u1, z1, d0), seg.P(u1, z1, d1), seg.P(u0, z1, d1)], (0, 0, 1), slot, col)
    b.facing([seg.P(u0, z0, d0), seg.P(u1, z0, d0), seg.P(u1, z0, d1), seg.P(u0, z0, d1)], (0, 0, -1), slot, shade(col, 0.8))
    b.facing([seg.P(u0, z0, d0), seg.P(u0, z1, d0), seg.P(u0, z1, d1), seg.P(u0, z0, d1)], (-seg.u[0], -seg.u[1], 0), slot, shade(col, 0.9))
    b.facing([seg.P(u1, z0, d0), seg.P(u1, z1, d0), seg.P(u1, z1, d1), seg.P(u1, z0, d1)], (seg.u[0], seg.u[1], 0), slot, shade(col, 0.9))


def facade(b, seg, z0, z1, storeys, look, kind=None, ratio=None, rng=None, bay=None, reduced=False, ground_kind=None, ground_h=None,
           wall_slot=None, wall_col=None, plinth=0.0, band=None):
    """Build one wall. kind: curtain|ribbon|punched|arched|pointed-arch|screen|louvre|none.

    z0..z1 is the wall's height split into `storeys` equal storeys (ground_h overrides the ground storey height).
    detail 0: openings are cut (reveals, sills, mullions, real glazing planes); detail 1 or reduced=True: glazing is a flat
    quad proud of the wall; detail 2: plain wall. ground_kind overrides the first storey on this wall (e.g. 'curtain').
    band: optional (height, colour) of a floor-edge band between storeys (for punched/ribbon)."""
    kind = kind or look.windows
    ratio = look.ratio if ratio is None else ratio
    detail = b.detail
    ws = wall_slot or look.wall_slot
    wc = wall_col or look.wall_col
    L = seg.length
    H = z1 - z0
    storeys = max(1, int(storeys))
    hs = []
    if ground_h and storeys > 1:
        rest = (H - ground_h) / (storeys - 1)
        hs = [ground_h] + [rest] * (storeys - 1)
    else:
        hs = [H / storeys] * storeys
    if detail >= 2 or kind == 'none':
        _wall(b, seg, 0, L, z0, z1, ws, wc)
        return
    cut = detail == 0 and not reduced
    z = z0
    # plain base wall for flat-window modes is emitted per storey below
    for si in range(storeys):
        h = hs[si]
        zb, zt = z, z + h
        z = zt
        k = ground_kind if (si == 0 and ground_kind) else kind
        _storey(b, seg, look, zb, zt, k, ratio, rng, bay, cut, ws, wc, h, si == 0)
        if band and si < storeys - 1 and cut:
            seg_box(b, seg, 0, L, zt - band[0] / 2, zt + band[0] / 2, 0.06, band[1], ws)


def _storey(b, seg, look, zb, zt, kind, ratio, rng, bay, cut, ws, wc, h, ground):
    L = seg.length
    detail = b.detail
    if kind in ('punched', 'arched', 'pointed-arch', 'round'):
        shape = {'punched': 'rect', 'arched': 'arch', 'pointed-arch': 'pointed', 'round': 'round'}[kind]
        bw = bay or (3.4 if shape == 'rect' else 3.8)
        if detail >= 1 or not cut:
            bw *= 1.5
        nb = max(1, round(L / bw))
        bw = L / nb
        oh = min(h * (0.58 if shape == 'rect' else 0.72), 2.6 if shape == 'rect' else 3.6)
        ow = max(0.7, min(bw - 0.7, ratio * bw * h / oh * (1.0 if shape == 'rect' else 0.7)))
        if shape == 'round':
            ow = oh = max(0.6, min(h * 0.5, bw - 0.7, 1.7))
        elif shape != 'rect':
            ow = min(ow, oh * 0.55)
        sill = zb + (h - oh) * (0.42 if shape != 'round' else 0.55)
        top = sill + oh
        slot = 'glass-punched'
        if not cut:
            _wall(b, seg, 0, L, zb, zt, ws, wc)
        for k in range(nb):
            u0, u1 = k * bw, (k + 1) * bw
            c = (u0 + u1) / 2
            ou0, ou1 = c - ow / 2, c + ow / 2
            if cut:
                _punched_bay(b, seg, look, u0, u1, zb, zt, ou0, ou1, sill, top, shape, 0.22, True, slot, ws, wc)
            else:
                pts = [(ou0, sill), (ou1, sill), (ou1, top), (ou0, top)]
                if shape == 'round' and detail < 2:
                    zc_, rr_ = (sill + top) / 2, (top - sill) / 2
                    pts = [(c + rr_ * math.cos(2 * math.pi * q / 8), zc_ + rr_ * math.sin(2 * math.pi * q / 8)) for q in range(8)]
                elif shape != 'rect' and detail < 2:
                    rise = ow * (0.5 if shape == 'arch' else 0.866)
                    zs = top - rise
                    pts = [(ou0, sill), (ou1, sill), (ou1, zs), (c, top), (ou0, zs)]
                _glass(b, seg, pts, -0.03, slot, look.glass_col)
        return
    if kind == 'curtain':
        bw = bay or (3.0 if ratio > 0 else 3.0)
        nb = max(1, round(L / bw))
        bw = L / nb
        if cut:
            for k in range(nb):
                _glass(b, seg, [(k * bw, zb), ((k + 1) * bw, zb), ((k + 1) * bw, zt), (k * bw, zt)], 0.06, look.glass_slot, look.glass_col)
            # vertical mullions and floor-edge band
            for k in range(nb + 1):
                u = min(max(k * bw, 0.06), L - 0.06)
                seg_box(b, seg, u - 0.06, u + 0.06, zb, zt, 0.14, look.frame_col, 'frame', inset=0.05)
            seg_box(b, seg, 0, L, zt - 0.45, zt, 0.1, look.accent_col if ws == look.wall_slot else wc, ws, inset=0.0)
        else:
            b.face([seg.P(0, zb, -0.02), seg.P(L, zb, -0.02), seg.P(L, zt, -0.02), seg.P(0, zt, -0.02)], look.glass_slot, look.glass_col, mode='tile', scale=3.0)
        return
    if kind == 'ribbon':
        band_h = h * min(0.7, max(0.3, ratio))
        sill = zb + (h - band_h) * 0.55
        top = sill + band_h
        _wall(b, seg, 0, L, zb, sill, ws, wc)
        _wall(b, seg, 0, L, top, zt, ws, wc)
        if cut:
            dd = 0.18
            bw = bay or 4.0
            nb = max(1, round(L / bw))
            bw = L / nb
            for k in range(nb):
                _glass(b, seg, [(k * bw, sill), ((k + 1) * bw, sill), ((k + 1) * bw, top), (k * bw, top)], dd, 'glass-ribbon', look.glass_col)
            for (p, q, hint) in ((sill, sill, (0, 0, 1)), (top, top, (0, 0, -1))):
                b.facing([seg.P(0, p), seg.P(L, p), seg.P(L, p, dd), seg.P(0, p, dd)], hint, ws, shade(wc, 0.85))
            for k in range(nb + 1):
                u = min(max(k * bw, 0.04), L - 0.04)
                seg_box(b, seg, u - 0.04, u + 0.04, sill, top, 0.04, look.frame_col, 'frame', inset=dd)
        else:
            b.face([seg.P(0, sill, -0.03), seg.P(L, sill, -0.03), seg.P(L, top, -0.03), seg.P(0, top, -0.03)], 'glass-ribbon', look.glass_col, mode='tile', scale=3.0)
        return
    if kind in ('screen', 'louvre'):
        _wall(b, seg, 0, L, zb, zb + 0.5, ws, wc)
        _wall(b, seg, 0, L, zt - 0.4, zt, ws, wc)
        a, c = zb + 0.5, zt - 0.4
        if not cut:
            b.face([seg.P(0, a, -0.02), seg.P(L, a, -0.02), seg.P(L, c, -0.02), seg.P(0, c, -0.02)], 'metal-cladding', shade(look.accent_col, 0.7), mode='tile', scale=3.0)
            return
        # dark backing plane + fins (screen) or slats (louvre)
        _glass(b, seg, [(0, a), (L, a), (L, c), (0, c)], 0.12, look.glass_slot, look.glass_col, mode='tile')
        if kind == 'screen':
            pitch = 0.7
            n = int(L / pitch)
            for k in range(n + 1):
                u = min(max(k * pitch + (L - n * pitch) / 2, 0.05), L - 0.05)
                seg_box(b, seg, u - 0.04, u + 0.04, a, c, 0.3, look.accent_col, ws, inset=0.1)
        else:
            pitch = 0.32
            n = int((c - a) / pitch)
            for k in range(n):
                zz = a + (k + 0.5) * pitch
                seg_box(b, seg, 0, L, zz - 0.05, zz + 0.05, 0.12, look.accent_col, ws, inset=0.05)
        return
    _wall(b, seg, 0, L, zb, zt, ws, wc)


def walls(b, fp, z0, z1, storeys, look, rng=None, kind=None, ratio=None, front_kind=None, rear='flat', ground_kind=None,
          ground_h=None, plinth=0.35, band=None, wall_slot=None, wall_col=None, bay=None, edges=None):
    """Walls round a whole Footprint. front_kind applies to edges facing -Y; rear: 'flat' (windows inset flat, default), 'same', or
    'plain' for edges facing +Y. Adds a plinth strip at the base (plinth = height, 0 disables). Returns nothing."""
    ws = wall_slot or look.wall_slot
    wc = wall_col or look.wall_col
    for seg in (edges if edges is not None else fp.edges()):
        k = (front_kind if seg.front and front_kind else kind) or look.windows
        red = False
        if seg.rear:
            if rear == 'plain':
                k = 'none'
            elif rear == 'flat':
                red = True
        facade(b, seg, z0, z1, storeys, look, k, ratio, rng, bay, reduced=red or (b.detail >= 1 and not seg.front and False),
               ground_kind=ground_kind if (seg.front or ground_kind and not seg.rear) else None, ground_h=ground_h,
               wall_slot=ws, wall_col=wc)
    if plinth and b.detail == 0:
        sweep(b, fp, z0, [(0.06, 0), (0.06, plinth), (0, plinth)], look.wall_slot, shade(wc, 0.78))


def parapet(b, fp, z, height=0.9, thick=0.3, look=None, slot=None, col=None, coping=0.08):
    """Parapet (with a slightly projecting coping) round the footprint at roof level z; solid and visible from inside too."""
    slot = slot or (look.wall_slot if look else 'plain-render')
    col = col or (look.trim_col if look else '#d8d8d8')
    prof = [(0, 0), (0, height), (coping, height), (coping, height + 0.06), (-thick - coping, height + 0.06), (-thick - coping, height), (-thick, height), (-thick, 0)]
    if b.detail >= 1:
        prof = [(0, 0), (0, height), (-thick, height), (-thick, 0)]
    sweep(b, fp, z, prof, slot, col)


def cornice(b, fp, z, projection=0.4, height=0.35, look=None, col=None, slot=None):
    """A projecting cornice band round the footprint with its top at z + height (stepped profile, detail 0 only)."""
    if b.detail >= 1:
        return
    col = col or (look.trim_col if look else '#d8d8d8')
    p = projection
    prof = [(0, 0), (p * 0.6, 0), (p * 0.6, height * 0.35), (p, height * 0.4), (p, height * 0.75), (p * 0.4, height), (0, height)]
    sweep(b, fp, z, prof, slot or 'plain-render', col)
