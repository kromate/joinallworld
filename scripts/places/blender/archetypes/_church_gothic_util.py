"""Shared church geometry for church-gothic, church-classical and church-modern (private helper module).

Conventions: the church's long axis runs along +Y. The west front (tower / entrance) is at the low-y end and faces -Y, towards the
camera; the chancel / apse is at the high-y end. x is across the building. Ground z = 0, metres.

Everything here is detail aware: b.detail 0 cuts real openings and adds ornament, 1 keeps flat glazing and the main masses, 2 is a
plain colour silhouette (walls and roofs only).
"""
import math
import re

import lib
from lib.facade import ROOF_SLOT

# --------------------------------------------------------------------------------------------------------------- small utils
TILE = {'brick': 2.0, 'stone-blocks': 4.0, 'plain-render': 4.0, 'rough-concrete': 4.0, 'mud-render': 4.0, 'metal-cladding': 4.0, 'timber': 1.6,
        'corrugated': 2.0, 'clay-tile': 2.0, 'slate': 2.0, 'metal-roof': 3.0, 'roof-flat': 4.0, 'paving': 2.0}


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def feats(brief):
    out = {}
    for f in brief.get('features') or []:
        if isinstance(f, dict):
            out[f.get('id')] = f
        else:
            out[f] = {'id': f, 'count': 1}
    return out


def text(brief):
    return ' '.join(str(brief.get(k) or '') for k in ('name', 'subject', 'notes', 'style', 'era')).lower() + ' ' + str((brief.get('form') or {}).get('variant') or '').lower()


def number_near(txt, words, lo, hi):
    """First metre figure written right next to one of `words` ('70 m cross', 'tower ~38 m') inside [lo, hi]; None when absent.
    A footprint such as '22.6 x 14.3 m including tower' is not a height and is skipped."""
    w = '|'.join(words)
    pats = (r'(?:%s)s?[^.;()\d]{0,14}?(\d{2,3}(?:\.\d)?)\s*(?:m\b|metres|meters)(?!\s*(?:x|by))' % w,
            r'(\d{2,3}(?:\.\d)?)\s*(?:m|metre|meter)\s*(?:high|tall)?\s*(?:%s)' % w)
    for pat in pats:
        for m in re.finditer(pat, txt):
            if 'including' in txt[max(0, m.start() - 12):m.end() + 12]:
                continue
            v = float(m.group(1))
            if lo <= v <= hi:
                return v
    return None


def tscale(slot, detail):
    """Texture scale so that big walls and roofs stay cheap: aim for ~3 m tiles at LOD0 and coarser below."""
    t = TILE.get(slot, 4.0)
    s = max(1.0, 3.2 / t)
    return s * (2.2 if detail >= 1 else 1.0)


def F(b, pts, slot, col, hint=None, mode=None):
    sc = tscale(slot, b.detail)
    if hint is None:
        b.face(pts, slot, col, scale=sc, mode=mode)
    else:
        b.facing(pts, hint, slot, col, scale=sc, mode=mode)


def set_roof(lk, brief):
    """The Look takes the roof material from the city style; the brief's own roofMaterial wins."""
    rm = (brief.get('facade') or {}).get('roofMaterial')
    if rm and rm in ROOF_SLOT:
        lk.roof_slot = ROOF_SLOT[rm]
    return lk


# ----------------------------------------------------------------------------------------------------------------- arches
def arch_pts(shape, u0, u1, zs, n, rf=1.0):
    """(u, z) points of an arch head from the left springing (u0, zs) to the right springing (u1, zs)."""
    w = u1 - u0
    if shape == 'round':
        c = (u0 + u1) / 2
        return [(c + math.cos(math.pi * (1 - k / n)) * w / 2, zs + math.sin(math.pi * (1 - k / n)) * w / 2) for k in range(n + 1)]
    if shape == 'seg':
        s = 0.22 * w
        R = (w * w / 4 + s * s) / (2 * s)
        c = (u0 + u1) / 2
        a0 = math.asin(min(1.0, w / 2 / R))
        return [(c + R * math.sin(-a0 + 2 * a0 * k / n), zs + s - R + R * math.cos(-a0 + 2 * a0 * k / n)) for k in range(n + 1)]
    R = w * max(0.55, rf)
    half = max(2, n // 2)
    top = math.acos(max(-1.0, min(1.0, (w / 2 - R) / R)))
    left = []
    for k in range(half + 1):
        a = math.pi - (math.pi - top) * k / half
        left.append((u0 + R + R * math.cos(a), zs + R * math.sin(a)))
    mid = (u0 + u1) / 2
    right = [(2 * mid - u, z) for (u, z) in left[:-1]][::-1]
    return left + right


def arch_rise(shape, w, rf=1.0):
    if shape == 'rect':
        return 0.0
    if shape == 'round':
        return w / 2
    if shape == 'seg':
        return 0.22 * w
    R = w * max(0.55, rf)
    return math.sqrt(max(0.0, R * R - (R - w / 2) ** 2))


# ---------------------------------------------------------------------------------------------------------------- wall boxes
def sbox(b, seg, u0, u1, z0, z1, proud, col, slot='plain-render', top=True, sloped=0.0, inset=0.0, bottom=False):
    """Box on a wall standing `proud` metres out; sloped > 0 makes the top a weathering slope that meets the wall `sloped` m higher."""
    d0, d1 = -proud, inset
    sc = tscale(slot, b.detail)
    b.face([seg.P(u0, z0, d0), seg.P(u1, z0, d0), seg.P(u1, z1, d0), seg.P(u0, z1, d0)], slot, col, scale=sc)
    if top:
        if sloped > 0:
            b.facing([seg.P(u0, z1, d0), seg.P(u1, z1, d0), seg.P(u1, z1 + sloped, d1), seg.P(u0, z1 + sloped, d1)], (0, 0, 1), slot, lib.shade(col, 1.06), scale=sc)
        else:
            b.facing([seg.P(u0, z1, d0), seg.P(u1, z1, d0), seg.P(u1, z1, d1), seg.P(u0, z1, d1)], (0, 0, 1), slot, lib.shade(col, 1.05), scale=sc)
    for u, hint in ((u0, (-seg.u[0], -seg.u[1], 0)), (u1, (seg.u[0], seg.u[1], 0))):
        zt = z1 + (sloped if top and sloped > 0 else 0)
        b.facing([seg.P(u, z0, d0), seg.P(u, z1, d0), seg.P(u, zt, d1), seg.P(u, z0, d1)], hint, slot, lib.shade(col, 0.92), scale=sc)
    if bottom:
        b.facing([seg.P(u0, z0, d0), seg.P(u1, z0, d0), seg.P(u1, z0, d1), seg.P(u0, z0, d1)], (0, 0, -1), slot, lib.shade(col, 0.8), scale=sc)


def string_course(b, seg, z, h, proud, col, slot='plain-render'):
    if b.detail >= 1:
        return
    sbox(b, seg, 0, seg.length, z, z + h, proud, col, slot, sloped=0.0)


# ------------------------------------------------------------------------------------------------------------------ openings
def op(u0, u1, sill, top, shape='pointed', glass='glass', rf=1.0, depth=0.28, mull=0, surround=0.0, sill_box=True, tracery=False):
    return dict(u0=u0, u1=u1, sill=sill, top=top, shape=shape, glass=glass, rf=rf, depth=depth, mull=mull, surround=surround, sill_box=sill_box, tracery=tracery)


def _glass_style(look, g):
    """(slot, colour) of the infill. g: 'glass' | 'dark' | 'door' | '#hex' (stained glass) | ('louvre', '#hex')."""
    if g == 'dark':
        return 'glass-punched', '#46494c'
    if g == 'door':
        return 'timber', '#4b3426'
    if isinstance(g, tuple) and g and g[0] == 'timber':
        return 'timber', g[1]
    if isinstance(g, str) and g.startswith('#'):
        return 'glass-punched', g
    return 'glass-punched', look.glass_col


def wall(b, p0, p1, z0, z1, look, ops=(), ws=None, wc=None, trim=None, plinth=0.0, plinth_col=None, bands=None):
    """One straight wall p0 -> p1 (outside on the right of travel) with cut openings. Returns the Seg for further decoration."""
    seg = lib.Seg(p0, p1)
    ws = ws or look.wall_slot
    wc = wc or look.wall_col
    trim = trim or look.trim_col
    L = seg.length
    det = b.detail
    ops = sorted([_fit_op(o) for o in ops if o['u1'] > o['u0'] + 0.15 and o['u0'] >= 0 and o['u1'] <= L], key=lambda o: o['u0'])

    def rect(u0, u1, za, zb):
        if u1 - u0 > 1e-3 and zb - za > 1e-3:
            F(b, [seg.P(u0, za), seg.P(u1, za), seg.P(u1, zb), seg.P(u0, zb)], ws, wc)

    if det >= 1 or not ops:
        rect(0, L, z0, z1)
        if det == 1:
            for o in ops:
                _flat_glass(b, seg, look, o)
        elif plinth:
            _plinth(b, seg, z0, plinth, plinth_col or lib.shade(wc, 0.7), ops)
        if bands and det <= 1:
            _bands(b, seg, z0, z1, bands, ops if det == 0 else [])
        return seg
    cur = 0.0
    for o in ops:
        if o['u0'] > cur:
            rect(cur, o['u0'], z0, z1)
        _cut_opening(b, seg, look, o, z0, z1, ws, wc, trim)
        cur = o['u1']
    if cur < L:
        rect(cur, L, z0, z1)
    if plinth:
        _plinth(b, seg, z0, plinth, plinth_col or lib.shade(wc, 0.7), ops)
    if bands:
        _bands(b, seg, z0, z1, bands, ops)
    return seg


def _bands(b, seg, z0, z1, bands, ops):
    """Horizontal stripes (alternate courses in a second colour) laid on a wall, leaving the openings clear."""
    pitch, col = bands
    L = seg.length
    spans = []
    cur = 0.0
    for o in sorted(ops, key=lambda o: o['u0']):
        if o['u0'] > cur + 0.05:
            spans.append((cur, o['u0']))
        cur = max(cur, o['u1'])
    if cur < L - 0.05:
        spans.append((cur, L))
    z = z0 + pitch * 0.5
    k = 0
    while z + pitch <= z1 + 1e-6:
        if k % 2 == 0:
            for (ua, ub) in spans:
                b.face([seg.P(ua, z, -0.02), seg.P(ub, z, -0.02), seg.P(ub, z + pitch, -0.02), seg.P(ua, z + pitch, -0.02)], 'plain-render', col, scale=tscale('plain-render', 0))
        z += pitch
        k += 1


def _plinth(b, seg, z0, h, col, ops):
    cur = 0.0
    for o in sorted([o for o in ops if o['sill'] <= z0 + h + 0.2], key=lambda o: o['u0']):
        if o['u0'] > cur + 0.1:
            b.face([seg.P(cur, z0, -0.04), seg.P(o['u0'], z0, -0.04), seg.P(o['u0'], z0 + h, -0.04), seg.P(cur, z0 + h, -0.04)], 'stone-blocks', col, scale=tscale('stone-blocks', 0))
        cur = o['u1']
    if seg.length > cur + 0.1:
        b.face([seg.P(cur, z0, -0.04), seg.P(seg.length, z0, -0.04), seg.P(seg.length, z0 + h, -0.04), seg.P(cur, z0 + h, -0.04)], 'stone-blocks', col, scale=tscale('stone-blocks', 0))


def _fit_op(o):
    """Narrow an arched opening whose arch would spring below its sill (a squat wall with a tall window)."""
    if o['shape'] == 'rect':
        return o
    w = o['u1'] - o['u0']
    rise = arch_rise(o['shape'], w, o['rf'])
    room = o['top'] - o['sill']
    if rise > 0.72 * room and room > 0.8:
        k = rise / w
        nw = max(0.45, 0.72 * room / k)
        c = (o['u0'] + o['u1']) / 2
        return dict(o, u0=c - nw / 2, u1=c + nw / 2, mull=0 if nw < 1.4 else o['mull'])
    return o


def _outline(o, n):
    w = o['u1'] - o['u0']
    rise = arch_rise(o['shape'], w, o['rf'])
    top = o['top']
    if o['shape'] == 'rect':
        return [], top
    zs = top - rise
    return arch_pts(o['shape'], o['u0'], o['u1'], zs, n, o['rf']), zs


def _flat_glass(b, seg, look, o):
    slot, col = _glass_style(look, o['glass'])
    arch, zs = _outline(o, 4)
    pts = [(o['u0'], o['sill']), (o['u1'], o['sill'])] + (list(reversed(arch)) if arch else [(o['u1'], o['top']), (o['u0'], o['top'])])
    b.face([seg.P(u, z, -0.04) for u, z in pts], slot, col)


def _cut_opening(b, seg, look, o, z0, z1, ws, wc, trim):
    u0, u1, sill = o['u0'], o['u1'], max(o['sill'], z0)
    top = min(o['top'], z1 - 0.1)
    o = dict(o, top=top)
    dd = o['depth']
    arch, zs = _outline(o, 4 if (u1 - u0) < 3.5 else 6)
    slot, col = _glass_style(look, o['glass'])
    dark = lib.shade(wc, 0.72)
    if sill > z0 + 1e-3:
        F(b, [seg.P(u0, z0), seg.P(u1, z0), seg.P(u1, sill), seg.P(u0, sill)], ws, wc)
    if arch:
        for (ua, za), (ub, zb) in zip(arch[:-1], arch[1:]):
            if abs(ub - ua) > 1e-4:
                F(b, [seg.P(ua, za), seg.P(ub, zb), seg.P(ub, z1), seg.P(ua, z1)], ws, wc, hint=seg.N3())
        # triangle fill between the springing line and the arch is the opening itself; wall above handled by quads
    else:
        F(b, [seg.P(u0, top), seg.P(u1, top), seg.P(u1, z1), seg.P(u0, z1)], ws, wc)

    def reveal(p, q, hint):
        b.facing([seg.P(p[0], p[1]), seg.P(q[0], q[1]), seg.P(q[0], q[1], dd), seg.P(p[0], p[1], dd)], hint, ws, dark, scale=tscale(ws, 0))

    reveal((u0, sill), (u0, zs if arch else top), (seg.u[0], seg.u[1], 0))
    reveal((u1, sill), (u1, zs if arch else top), (-seg.u[0], -seg.u[1], 0))
    if o['glass'] != 'door':
        reveal((u0, sill), (u1, sill), (0, 0, 1))
    if arch:
        c = seg.P((u0 + u1) / 2, zs, dd)
        for (ua, za), (ub, zb) in zip(arch[:-1], arch[1:]):
            m = seg.P((ua + ub) / 2, (za + zb) / 2, 0)
            reveal((ua, za), (ub, zb), (c[0] - m[0], c[1] - m[1], c[2] - m[2]))
    else:
        reveal((u0, top), (u1, top), (0, 0, -1))
    pts = [(u0, sill), (u1, sill)] + (list(reversed(arch)) if arch else [(u1, top), (u0, top)])
    b.face([seg.P(u, z, dd) for u, z in pts], slot, col)
    # mullions
    if o['mull'] and o['glass'] != 'door':
        for k in range(1, o['mull'] + 1):
            mc = u0 + (u1 - u0) * k / (o['mull'] + 1)
            sbox(b, seg, mc - 0.05, mc + 0.05, sill, zs if arch else top, -dd + 0.07, lib.shade(trim, 0.85), 'frame', top=False, inset=dd)
    if o['glass'] == 'door' and (u1 - u0) > 1.4:
        mc = (u0 + u1) / 2
        sbox(b, seg, mc - 0.04, mc + 0.04, sill, zs if arch else top, -dd + 0.06, lib.shade(col, 0.7), 'frame', top=False, inset=dd)
    if o['tracery'] and arch and (u1 - u0) > 1.1:
        _tracery(b, seg, o, zs, dd, trim, look)
    sw = o['surround']
    if sw > 0:
        _surround(b, seg, o, arch, zs, sw, trim, sill)
    elif o['sill_box'] and o['glass'] != 'door' and (u1 - u0) < 6:
        sbox(b, seg, u0 - 0.08, u1 + 0.08, sill - 0.1, sill, 0.1, trim, 'plain-render', top=True)


def _tracery(b, seg, o, zs, dd, trim, look):
    """A small circle (oculus) in the head of a pointed window: stone ring over the glass."""
    u0, u1 = o['u0'], o['u1']
    mc = (u0 + u1) / 2
    r = (u1 - u0) * 0.2
    zc = zs + (o['top'] - zs) * 0.45 + r * 0.2
    n = 8
    ring = []
    for k in range(n):
        a = 2 * math.pi * k / n
        ring.append((mc + math.cos(a) * r, zc + math.sin(a) * r))
    b.face([seg.P(u, z, dd - 0.05) for u, z in ring], 'plain-render', lib.shade(trim, 0.92))


def _surround(b, seg, o, arch, zs, sw, trim, sill):
    u0, u1 = o['u0'], o['u1']
    pr = 0.07
    b.face([seg.P(u0 - sw, sill, -pr), seg.P(u0, sill, -pr), seg.P(u0, zs if arch else o['top'], -pr), seg.P(u0 - sw, zs if arch else o['top'], -pr)], 'plain-render', trim)
    b.face([seg.P(u1, sill, -pr), seg.P(u1 + sw, sill, -pr), seg.P(u1 + sw, zs if arch else o['top'], -pr), seg.P(u1, zs if arch else o['top'], -pr)], 'plain-render', trim)
    if arch:
        cu, cz = (u0 + u1) / 2, zs + (o['top'] - zs) * 0.1
        outer = []
        for k, (u, z) in enumerate(arch):
            pu = arch[max(0, k - 1)]
            nu = arch[min(len(arch) - 1, k + 1)]
            tx, tz = nu[0] - pu[0], nu[1] - pu[1]
            ln = math.hypot(tx, tz) or 1
            nx, nz = tz / ln, -tx / ln
            if (u - cu) * nx + (z - cz) * nz < 0:
                nx, nz = -nx, -nz
            outer.append((u + nx * sw, z + nz * sw))
        for k in range(len(arch) - 1):
            b.facing([seg.P(*arch[k], -pr), seg.P(*arch[k + 1], -pr), seg.P(*outer[k + 1], -pr), seg.P(*outer[k], -pr)], seg.N3(), 'plain-render', trim)
    else:
        b.face([seg.P(u0 - sw, o['top'], -pr), seg.P(u1 + sw, o['top'], -pr), seg.P(u1 + sw, o['top'] + sw, -pr), seg.P(u0 - sw, o['top'] + sw, -pr)], 'plain-render', trim)


def bay_ops(L, n, start=0.0, end=None, w=1.2, sill=1.0, top=3.5, shape='pointed', glass='glass', rf=1.0, depth=0.28, mull=0, surround=0.0, tracery=False, glass_cycle=None, skip=()):
    """n evenly spaced openings between u = start and u = end along a wall of length L."""
    end = L if end is None else end
    out = []
    if n <= 0:
        return out
    bw = (end - start) / n
    for k in range(n):
        if k in skip:
            continue
        c = start + bw * (k + 0.5)
        g = glass_cycle[k % len(glass_cycle)] if glass_cycle else glass
        out.append(op(c - w / 2, c + w / 2, sill, top, shape, g, rf, depth, mull, surround, True, tracery))
    return out


def buttress(b, seg, u, z0, z1, col, slot='stone-blocks', w=0.75, proud=0.6, stages=2):
    """Stepped buttress against a wall: each stage is narrower and shallower; the last one has a weathered (sloped) top."""
    if b.detail >= 2:
        return
    if b.detail == 1:
        stages = 1
    h = z1 - z0
    for k in range(stages):
        za = z0 + h * (k / stages) * 0.9 if k else z0
        zb = z0 + h * ((k + 1) / stages) * (0.93 if k < stages - 1 else 1.0)
        ww = w * (1 - 0.18 * k)
        pr = proud * (1 - 0.3 * k)
        sbox(b, seg, u - ww / 2, u + ww / 2, za, zb, pr, col, slot, top=True, sloped=(pr * 0.9 if k == stages - 1 else 0.0))


def corner_buttress(b, seg_a, seg_b, z0, z1, col, slot='stone-blocks', stages=2, w=0.8, proud=0.55):
    """Pair of buttresses at the corner between walls a (ending) and b (starting)."""
    buttress(b, seg_a, seg_a.length - w / 2 - 0.02, z0, z1, col, slot, w, proud, stages)
    buttress(b, seg_b, w / 2 + 0.02, z0, z1, col, slot, w, proud, stages)


# ------------------------------------------------------------------------------------------------------------------ roofs
def gable_roof(b, rect, z, rise, axis='y', ov=0.4, ove=0.3, look=None, slot=None, col=None, gslot=None, gcol=None, gables=(False, False), th=0.2, hip=0.0, hip_ends=(True, True)):
    """Gable roof over rect (x0, y0, x1, y1) with its eaves at z; ridge along `axis`. ov: eave overhang, ove: overhang at the gable
    ends. gables: build the gable-end triangles at the (low, high) end of the ridge axis. hip > 0 turns the ends into half-hips
    (hip = horizontal run of the hipped part)."""
    x0, y0, x1, y1 = rect
    rs, rc = slot or look.roof_slot, col or look.roof_col
    gs, gc = gslot or look.wall_slot, gcol or look.wall_col
    if axis == 'y':
        a0, a1, c0, c1 = x0, x1, y0, y1
        mp = lambda a, c, zz: (a, c, zz)
    else:
        a0, a1, c0, c1 = y0, y1, x0, x1
        mp = lambda a, c, zz: (c, a, zz)
    am, half = (a0 + a1) / 2, (a1 - a0) / 2
    drop = ov * rise / half
    det = b.detail
    cc0, cc1 = c0 - ove, c1 + ove
    h0 = h1 = 0.0
    if hip > 0:
        h0 = min(hip, (c1 - c0) / 2 - 0.1) if hip_ends[0] else 0.0
        h1 = min(hip, (c1 - c0) / 2 - 0.1) if hip_ends[1] else 0.0
    # main planes: ridge runs between c0 + h0 and c1 - h1
    r0, r1 = c0 + h0, c1 - h1
    for sgn, aa in ((-1, a0 - ov), (1, a1 + ov)):
        pts = [mp(aa, cc0, z - drop), mp(am, r0 if h0 else cc0, z + rise), mp(am, r1 if h1 else cc1, z + rise), mp(aa, cc1, z - drop)]
        if sgn > 0:
            pts = pts[::-1]
        hint = mp(sgn * rise, 0, half)
        F(b, pts, rs, rc, hint=hint)
        if det == 0 and ov > 0.25:
            low = [(p[0], p[1], p[2] - th) for p in pts]
            F(b, low, 'plain-render', lib.shade(rc, 0.55), hint=(-hint[0], -hint[1], -hint[2]))
    if det == 0:
        # ridge cap
        ra, rb = (r0 if h0 else cc0), (r1 if h1 else cc1)
        rcol = lib.shade(rc, 0.8)
        if axis == 'y':
            lib.box(b, am - 0.17, ra, z + rise - 0.04, am + 0.17, rb, z + rise + 0.2, 'plain-render', rcol, skip=('bottom',))
        else:
            lib.box(b, ra, am - 0.17, z + rise - 0.04, rb, am + 0.17, z + rise + 0.2, 'plain-render', rcol, skip=('bottom',))
        # fascia boards: along both eaves and up the rakes
        for sgn, aa in ((-1, a0 - ov), (1, a1 + ov)):
            e = [mp(aa, cc0, z - drop), mp(aa, cc1, z - drop), mp(aa, cc1, z - drop - th), mp(aa, cc0, z - drop - th)]
            b.facing(e, mp(sgn, 0, 0), 'plain-render', lib.shade(rc, 0.7))
        for cc, sg in ((cc0, -1), (cc1, 1)):
            if (sg < 0 and h0) or (sg > 0 and h1):
                continue
            for sgn, aa in ((-1, a0 - ov), (1, a1 + ov)):
                e = [mp(aa, cc, z - drop), mp(am, cc, z + rise), mp(am, cc, z + rise - th), mp(aa, cc, z - drop - th)]
                b.facing(e, mp(0, sg, 0), 'plain-render', lib.shade(rc, 0.7))
    # hips
    for (cc, rr, sg, hv) in ((cc0, r0, -1, h0), (cc1, r1, 1, h1)):
        if not hv:
            continue
        pts = [mp(a0 - ov, cc, z - drop), mp(a1 + ov, cc, z - drop), mp(am, rr, z + rise)]
        F(b, pts if sg > 0 else pts[::-1], rs, rc, hint=mp(0, sg * rise, hv))
    for (c, g, on, sg) in ((c0, gs, gables[0], -1), (c1, gs, gables[1], 1)):
        if on and not ((sg < 0 and h0) or (sg > 0 and h1)):
            pts = [mp(a0, c, z), mp(a1, c, z), mp(am, c, z + rise)]
            F(b, pts, gs, gc, hint=mp(0, sg, 0))


def gable_tri(b, seg, z, rise, slot=None, col=None, look=None, ws=None):
    """Gable-end triangle above a wall (seg) whose top is at z."""
    F(b, [seg.P(0, z), seg.P(seg.length, z), seg.P(seg.length / 2, z + rise)], slot or look.wall_slot, col or look.wall_col)


def lean_roof(b, x_out, x_in, y0, y1, z_out, z_in, look, ov=0.3, slot=None, col=None):
    """Single-pitch roof (aisle, porch) from the low outer edge x_out to the high inner edge x_in."""
    rs, rc = slot or look.roof_slot, col or look.roof_col
    s = 1 if x_in > x_out else -1
    drop = ov * (z_in - z_out) / max(abs(x_in - x_out), 1e-3)
    pts = [(x_out - s * ov, y0 - ov, z_out - drop), (x_in, y0 - ov, z_in), (x_in, y1 + ov, z_in), (x_out - s * ov, y1 + ov, z_out - drop)]
    F(b, pts, rs, rc, hint=(-s * (z_in - z_out), 0, abs(x_in - x_out)))
    if b.detail == 0:
        # eave edge board
        b.facing([(x_out - s * ov, y0 - ov, z_out - drop), (x_out - s * ov, y1 + ov, z_out - drop), (x_out - s * ov, y1 + ov, z_out - drop - 0.18), (x_out - s * ov, y0 - ov, z_out - drop - 0.18)],
                 (-s, 0, 0), 'plain-render', lib.shade(rc, 0.7))


def pyramid(b, cx, cy, z, w, d, h, look, slot=None, col=None, ov=0.0):
    """Four-sided pyramid roof/cap on a w x d base (axis aligned)."""
    rs, rc = slot or look.roof_slot, col or look.roof_col
    x0, x1, y0, y1 = cx - w / 2 - ov, cx + w / 2 + ov, cy - d / 2 - ov, cy + d / 2 + ov
    zb = z - (h * ov / max(min(w, d) / 2, 1e-3) if ov else 0)
    ap = (cx, cy, z + h)
    F(b, [(x0, y0, zb), (x1, y0, zb), ap], rs, rc)
    F(b, [(x1, y0, zb), (x1, y1, zb), ap], rs, lib.shade(rc, 0.94))
    F(b, [(x1, y1, zb), (x0, y1, zb), ap], rs, rc)
    F(b, [(x0, y1, zb), (x0, y0, zb), ap], rs, lib.shade(rc, 0.94))


def ngon_pyramid(b, cx, cy, z, R, h, n, look, rot=0.0, slot=None, col=None, alt=0.0):
    """n-sided pyramid with its apex over (cx, cy); R is the circumradius; faces alternate shade by `alt`."""
    rs, rc = slot or look.roof_slot, col or look.roof_col
    ap = (cx, cy, z + h)
    pts = [(cx + R * math.cos(rot + 2 * math.pi * k / n), cy + R * math.sin(rot + 2 * math.pi * k / n), z) for k in range(n)]
    for k in range(n):
        c = lib.shade(rc, 1.0 - alt * (k % 2))
        F(b, [pts[k], pts[(k + 1) % n], ap], rs, c)


def spire_broach(b, cx, cy, z, tw, td, h, look, slot=None, col=None, lucarnes=False, base=None):
    """Octagonal spire on a square/rectangular tower top (broach spire): corner half-pyramids lead into the octagon."""
    rs, rc = slot or look.roof_slot, col or look.roof_col
    hw, hd = tw / 2, td / 2
    a_w, a_d = hw * math.tan(math.pi / 8), hd * math.tan(math.pi / 8)
    # octagon vertices going CCW starting at the front-right edge
    pts = [(a_w, -hd), (hw, -a_d), (hw, a_d), (a_w, hd), (-a_w, hd), (-hw, a_d), (-hw, -a_d), (-a_w, -hd)]
    ap = (cx, cy, z + h)
    for k in range(8):
        p, q = pts[k], pts[(k + 1) % 8]
        F(b, [(cx + p[0], cy + p[1], z), (cx + q[0], cy + q[1], z), ap], rs, lib.shade(rc, 1.0 - 0.07 * (k % 2)))
    # the corner pieces: the square corner is cut off by the diagonal facet pts[k]-pts[k+1] (k odd); broach it
    for (cxy, i) in [((hw, -hd), 0), ((hw, hd), 2), ((-hw, hd), 4), ((-hw, -hd), 6)]:
        p, q = pts[(i) % 8], pts[(i + 1) % 8]
        # p and q are the ends of the diagonal facet that faces the corner... pick the facet between them
        mid = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        fz = 0.30 * h
        f = 1 - fz / h
        peak = (cx + mid[0] * f, cy + mid[1] * f, z + fz)
        corner = (cx + cxy[0], cy + cxy[1], z)
        F(b, [corner, (cx + q[0], cy + q[1], z), peak], rs, lib.shade(rc, 0.9), hint=(cxy[0], cxy[1], 0.7))
        F(b, [(cx + p[0], cy + p[1], z), corner, peak], rs, lib.shade(rc, 0.9), hint=(cxy[0], cxy[1], 0.7))
    if lucarnes and b.detail == 0:
        for (dx, dy) in ((0, -1), (1, 0), (0, 1), (-1, 0)):
            fz = 0.33 * h
            f = 1 - fz / h
            bx, by = cx + dx * hw * 0.99 * f, cy + dy * hd * 0.99 * f
            ww = tw * 0.07
            tx, ty = -dy, dx
            lo = (bx + tx * ww, by + ty * ww, z + fz)
            lo2 = (bx - tx * ww, by - ty * ww, z + fz)
            up = (bx + tx * ww, by + ty * ww, z + fz + h * 0.07)
            up2 = (bx - tx * ww, by - ty * ww, z + fz + h * 0.07)
            ap2 = (bx - dx * ww * 0.5, by - dy * ww * 0.5, z + fz + h * 0.13)
            b.facing([lo, lo2, up2, up], (dx, dy, 0), 'glass-punched', '#46494c')
            b.facing([up, up2, ap2], (dx, dy, 0.6), 'plain-render', lib.shade(rc, 0.9))


def cross_finial(b, x, y, z, h, col='#d9d6cc', dark=False):
    """A tiny cross (two thin boxes) for gables and spire tops."""
    if b.detail >= 2:
        return
    w = h * 0.1
    lib.box_c(b, x, y, z, w, w, h, 'plain', col, skip=('bottom',))
    lib.box_c(b, x, y, z + h * 0.62, h * 0.55, w, w, 'plain', col, skip=('bottom',))


def pinnacle(b, x, y, z, w, h, look, col=None):
    if b.detail >= 1:
        return
    col = col or look.trim_col
    lib.box_c(b, x, y, z, w, w, h * 0.55, 'stone-blocks', col, skip=('bottom',))
    pyramid(b, x, y, z + h * 0.55, w * 1.0, w * 1.0, h * 0.45, look, slot='stone-blocks', col=lib.shade(col, 0.92))


def crenellate(b, rect, z, look, col=None, merlon_h=0.7, base_h=0.35, merlon=0.9, gap=0.75, thick=0.45, slot='stone-blocks'):
    """Battlemented parapet round a rectangle (x0, y0, x1, y1) whose wall top is at z."""
    x0, y0, x1, y1 = rect
    col = col or look.trim_col
    if b.detail >= 2:
        return
    ring = lib.fp_polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    lib.sweep(b, ring, z, [(0.08, 0), (0.08, base_h), (-thick, base_h), (-thick, 0)] if b.detail == 0 else [(0.04, 0), (0.04, base_h + merlon_h * 0.5), (-thick, base_h + merlon_h * 0.5), (-thick, 0)], slot, col)
    if b.detail >= 1:
        return
    for (ax, ay, bx, by) in ((x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)):
        L = math.hypot(bx - ax, by - ay)
        n = max(2, int(L / (merlon + gap)))
        step = L / n
        ux, uy = (bx - ax) / L, (by - ay) / L
        for k in range(n):
            u = step * (k + 0.5)
            cx, cy = ax + ux * u, ay + uy * u
            # inset by half a thickness
            nx, ny = uy, -ux
            cx -= nx * (thick / 2 - 0.04)
            cy -= ny * (thick / 2 - 0.04)
            lib.obox(b, cx, cy, z + base_h, merlon, thick, merlon_h, math.atan2(uy, ux), slot, col, top_col=lib.shade(col, 1.08), skip=('bottom',))


# --------------------------------------------------------------------------------------------------------- tower and details
def disc(b, seg, cu, cz, r, col, slot='plain-render', n=12, d=-0.05):
    pts = [seg.P(cu + math.cos(2 * math.pi * k / n) * r, cz + math.sin(2 * math.pi * k / n) * r, d) for k in range(n)]
    b.face(pts, slot, col)


def clock_face(b, seg, cu, cz, r, look):
    if b.detail >= 2:
        return
    n = 16 if b.detail == 0 else 8
    disc(b, seg, cu, cz, r * 1.12, lib.shade(look.trim_col, 0.9), 'stone-blocks', n, -0.04)
    disc(b, seg, cu, cz, r, '#f1ede0', 'plain-render', n, -0.08)
    if b.detail == 0:
        b.face([seg.P(cu - 0.04, cz, -0.1), seg.P(cu + 0.04, cz, -0.1), seg.P(cu + 0.04, cz + r * 0.8, -0.1), seg.P(cu - 0.04, cz + r * 0.8, -0.1)], 'plain', '#2a2a2a')
        b.face([seg.P(cu, cz - 0.04, -0.1), seg.P(cu + r * 0.55, cz - 0.04, -0.1), seg.P(cu + r * 0.55, cz + 0.04, -0.1), seg.P(cu, cz + 0.04, -0.1)], 'plain', '#2a2a2a')


def rose_window(b, seg, cu, cz, r, look, glass='#5a6fb8', spokes=8, d=-0.05, ring_col=None):
    """Circular window applied to a wall (stone ring, glass disc, spokes). Applique only: no cut into the wall."""
    if b.detail >= 2:
        return
    ring_col = ring_col or lib.shade(look.trim_col, 0.95)
    n = 20 if b.detail == 0 else 10
    b.face([seg.P(cu + math.cos(2 * math.pi * k / n) * r * 1.18, cz + math.sin(2 * math.pi * k / n) * r * 1.18, d + 0.02) for k in range(n)], 'stone-blocks', ring_col)
    b.face([seg.P(cu + math.cos(2 * math.pi * k / n) * r, cz + math.sin(2 * math.pi * k / n) * r, d - 0.03) for k in range(n)], 'glass-punched', glass)
    if b.detail == 0:
        for k in range(spokes):
            a = math.pi * k / spokes
            ca, sa = math.cos(a), math.sin(a)
            w = 0.05
            b.face([seg.P(cu - ca * r - sa * w, cz - sa * r + ca * w, d - 0.06), seg.P(cu + ca * r - sa * w, cz + sa * r + ca * w, d - 0.06),
                    seg.P(cu + ca * r + sa * w, cz + sa * r - ca * w, d - 0.06), seg.P(cu - ca * r + sa * w, cz - sa * r - ca * w, d - 0.06)], 'frame', ring_col)
        disc(b, seg, cu, cz, r * 0.18, ring_col, 'stone-blocks', 8, d - 0.08)


def applique_window(b, seg, o, look, trim, d=-0.04):
    """Window drawn on the wall (no cut): glass poly + optional surround. For gable ends and tight spots."""
    if b.detail >= 2:
        return
    slot, col = _glass_style(look, o['glass'])
    arch, zs = _outline(o, 6 if b.detail == 0 else 4)
    pts = [(o['u0'], o['sill']), (o['u1'], o['sill'])] + (list(reversed(arch)) if arch else [(o['u1'], o['top']), (o['u0'], o['top'])])
    if b.detail == 0 and o['surround'] > 0:
        _surround(b, seg, dict(o), arch, zs, o['surround'], trim, o['sill'])
    b.face([seg.P(u, z, d) for u, z in pts], slot, col)
    if b.detail == 0 and o['mull']:
        for k in range(1, o['mull'] + 1):
            mc = o['u0'] + (o['u1'] - o['u0']) * k / (o['mull'] + 1)
            b.face([seg.P(mc - 0.04, o['sill'], d - 0.02), seg.P(mc + 0.04, o['sill'], d - 0.02), seg.P(mc + 0.04, zs if arch else o['top'], d - 0.02), seg.P(mc - 0.04, zs if arch else o['top'], d - 0.02)], 'frame', lib.shade(trim, 0.85))


def square_tower(b, cx, cy, tw, td, z0, h, look, rng, bands=None, front_ops=None, side_ops=None, rear_ops=None, belfry=True, courses=3, bfr='stone-blocks',
                 buttress_stages=0, wall_slot=None, wall_col=None, trim=None, clock=False, belfry_shape='pointed', door=True, door_w=None,
                 west_window=True, stained=None, band_col=None, base_clad=None):
    """A square tower (belfry / clock tower / twin facade tower) from z0 to z0 + h. Returns the Seg list (front, right, rear, left).
    front: portal + west window + belfry openings; sides: slits + belfry. buttress_stages > 0 adds corner buttress pairs."""
    ws = wall_slot or look.wall_slot
    wc = wall_col or look.wall_col
    trim = trim or look.trim_col
    x0, x1, y0, y1 = cx - tw / 2, cx + tw / 2, cy - td / 2, cy + td / 2
    zt = z0 + h
    segs = {}
    belfry_h = clamp(h * 0.2, 2.2, 6.0)
    zb0 = zt - belfry_h - 0.2   # belfry stage starts
    ops_by = {}
    for name, L in (('front', tw), ('right', td), ('rear', tw), ('left', td)):
        ops = []
        if b.detail <= 1:
            if name == 'front' and door:
                dw = door_w or clamp(tw * 0.28, 1.5, 2.8)
                dh = clamp(dw * 1.9, 3.0, 5.0)
                ops.append(op(L / 2 - dw / 2, L / 2 + dw / 2, z0, z0 + dh, belfry_shape if belfry_shape != 'rect' else 'rect', 'door', 1.0, 0.45, 0, 0.2, False))
                if west_window and zb0 - (z0 + dh) > 4.0:
                    ww = clamp(tw * 0.2, 1.0, 2.2)
                    wh = clamp((zb0 - (z0 + dh) - 2.4) * 0.8, 2.5, 8.0)
                    s0 = z0 + dh + (zb0 - z0 - dh - wh) * 0.45 + 0.5
                    ops.append(op(L / 2 - ww / 2, L / 2 + ww / 2, s0, s0 + wh, belfry_shape, stained or 'glass', 1.4, 0.3, 1 if ww > 1.5 else 0, 0.16, True, tracery=ww > 1.5))
            elif name != 'front' or not door:
                mid_h = zb0 - z0
                if mid_h > 5.0:
                    for zz in (z0 + mid_h * 0.34, z0 + mid_h * 0.7):
                        sw = 0.4
                        ops.append(op(L / 2 - sw / 2, L / 2 + sw / 2, zz, zz + 1.35, 'lancet' if belfry_shape != 'rect' else 'rect', 'dark', 1.5, 0.35, 0, 0.0, False))
            if belfry:
                bw = clamp(L * 0.24, 0.9, 2.2)
                gap = L * 0.1
                for sgn in (-1, 1):
                    c = L / 2 + sgn * (bw / 2 + gap / 2 + 0.05 * L)
                    ops.append(op(c - bw / 2, c + bw / 2, zb0 + 0.6, zt - 0.9, belfry_shape, 'dark', 1.2, 0.4, 0, 0.14, False))
        ops_by[name] = ops
    for name, (p0, p1) in (('front', ((x0, y0), (x1, y0))), ('right', ((x1, y0), (x1, y1))), ('rear', ((x1, y1), (x0, y1))), ('left', ((x0, y1), (x0, y0)))):
        segs[name] = wall(b, p0, p1, z0, zt, look, ops_by[name], ws, wc, trim, bands=bands)
    if b.detail == 0:
        for name, seg in segs.items():
            for k in range(courses):
                zc = z0 + h * (k + 1) / (courses + 1) if k < courses - 1 else zb0 - 0.1
                string_course(b, seg, zc, 0.28, 0.1, trim, 'stone-blocks')
            if clock and name == 'front':
                clock_face(b, seg, seg.length / 2, zb0 - 1.9, clamp(tw * 0.15, 0.7, 1.4), look)
    if buttress_stages and b.detail <= 1:
        order = ['front', 'right', 'rear', 'left']
        bh = h * (0.68 if buttress_stages > 1 else 0.55)
        for i, nm in enumerate(order):
            corner_buttress(b, segs[nm], segs[order[(i + 1) % 4]], z0, z0 + bh, lib.shade(trim, 0.95), bfr, buttress_stages, 0.85, 0.55)
    return segs


def ring_window_stage(b, cx, cy, r, z0, z1, look, n, col, slot):
    cylinder = lib.cylinder
    cylinder(b, cx, cy, z0, z1, r, n=n, slot=slot, col=col, top=False, smooth=False)


# ------------------------------------------------------------------------------------------------------------------- apse
def apse(b, cx, y_start, r, z0, z1, look, rng, sides=5, window=True, ws=None, wc=None, roof_rise=None, buttresses=False, stained=None, shape='pointed',
         win_w=0.95, sill=1.4, head=None):
    """Polygonal apse (half of a regular 2*sides-gon) opening towards -Y at y_start, with a conical-ish roof. Returns the apex height."""
    ws = ws or look.wall_slot
    wc = wc or look.wall_col
    n = sides
    pts = [(cx + r * math.cos(math.pi * (1 - k / n)), y_start + r * math.sin(math.pi * (1 - k / n))) for k in range(n + 1)]
    # wall runs from the right side (angle 0) round the back to the left: that is counter-clockwise, outside on the right
    pts = pts[::-1]  # from angle 0 .. pi
    segs = []
    head = head or z1 - 1.5
    for i in range(n):
        p0, p1 = pts[i], pts[i + 1]
        L = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
        ops = []
        if window and b.detail <= 1 and L > win_w + 0.8:
            ops = [op(L / 2 - win_w / 2, L / 2 + win_w / 2, z0 + sill, head, shape, stained or 'glass', 1.4, 0.28, 1 if win_w > 1.4 else 0, 0.12, True)]
        segs.append(wall(b, p0, p1, z0, z1, look, ops, ws, wc))
    rise = roof_rise if roof_rise is not None else r * 0.9
    rs, rc = look.roof_slot, look.roof_col
    ap = (cx, y_start, z1 + rise)
    for i in range(n):
        p0, p1 = pts[i], pts[i + 1]
        F(b, [(p0[0], p0[1], z1), (p1[0], p1[1], z1), ap], rs, rc)
    return z1 + rise, segs


# ------------------------------------------------------------------------------------------------------------------- site
def fence_wall(b, x0, y0, x1, y1, gate_x, gate_w, look, h=1.0, col=None, front_only=False, thick=0.35, rail=False):
    """Boundary wall (or railing) round a rectangle with a gap for a gate on the front (-Y) side."""
    col = col or lib.shade(look.stone_col, 0.95)
    with b.site():
        if b.detail >= 2:
            return
        runs = [((x0, y0), (gate_x - gate_w / 2, y0)), ((gate_x + gate_w / 2, y0), (x1, y0))]
        if not front_only:
            runs += [((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]
        for (p, q) in runs:
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            if L < 0.3:
                continue
            if rail and b.detail == 0:
                n = max(2, int(L / 2.4))
                for k in range(n + 1):
                    px, py = p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n
                    lib.box_c(b, px, py, 0, 0.18, 0.18, h + 0.2, 'plain-render', col, skip=('bottom',))
                lib.beam(b, p, q, h - 0.15, h, 0.08, 'plain', '#2d2f31')
                lib.beam(b, p, q, 0.3, 0.4, 0.08, 'plain', '#2d2f31')
                if b.detail == 0:
                    pass
            else:
                lib.beam(b, p, q, 0, h, thick, 'plain-render', col)
        if b.detail == 0:
            for sgn in (-1, 1):
                lib.box_c(b, gate_x + sgn * (gate_w / 2 + 0.2), y0, 0, 0.55, 0.55, h + 0.9, 'plain-render', lib.shade(col, 1.05), skip=('bottom',))


def path_strip(b, x, y0, y1, w, look, col='#c9c4b8'):
    with b.site():
        if b.detail >= 2:
            return
        b.face([(x - w / 2, y0, 0.06), (x + w / 2, y0, 0.06), (x + w / 2, y1, 0.06), (x - w / 2, y1, 0.06)], 'paving', col, scale=1.5)


def headstones(b, rng, x0, x1, y0, y1, avoid, count, col='#9a9a96'):
    """Scatter small headstones (LOD0 only) outside the avoid rectangles."""
    if b.detail >= 1:
        return
    with b.site():
        n = 0
        tries = 0
        while n < count and tries < count * 12:
            tries += 1
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if any(a[0] - 1 < x < a[2] + 1 and a[1] - 1 < y < a[3] + 1 for a in avoid):
                continue
            yaw = math.pi / 2 + rng.uniform(-0.12, 0.12)
            lib.obox(b, x, y, 0, 0.6, 0.12, rng.uniform(0.6, 0.95), yaw, 'stone-blocks', lib.jitter(col, rng, 0.1), skip=('bottom',))
            n += 1


def statue(b, x, y, h, col='#d9d6cc'):
    """A figure on a plinth (very low-poly)."""
    if b.detail >= 2:
        return
    with b.site():
        lib.box_c(b, x, y, 0, 1.4, 1.4, h * 0.35, 'stone-blocks', '#b9b4a8', skip=('bottom',))
        lib.cylinder(b, x, y, h * 0.35, h * 0.78, h * 0.1, n=6, slot='plain-render', col=col, r_top=h * 0.07, top=False)
        lib.cylinder(b, x, y, h * 0.78, h * 0.92, h * 0.07, n=6, slot='plain-render', col=col, r_top=h * 0.05, top=True)
        if b.detail == 0:
            lib.cylinder(b, x, y, h * 0.92, h, h * 0.045, n=6, slot='plain-render', col=col, r_top=0.0)


def flagpole(b, x, y, h, col):
    if b.detail >= 1:
        return
    with b.site():
        lib.cylinder(b, x, y, 0, h, 0.07, n=5, slot='frame', col='#b8bcc0', r_top=0.05, top=True)
        b.facing([(x + 0.05, y, h - 1.6), (x + 2.2, y, h - 1.5), (x + 2.2, y, h - 0.2), (x + 0.05, y, h)], (0, -1, 0), 'plain', col)
        b.facing([(x + 0.05, y, h - 1.6), (x + 2.2, y, h - 1.5), (x + 2.2, y, h - 0.2), (x + 0.05, y, h)][::-1], (0, 1, 0), 'plain', lib.shade(col, 0.85))


def front_steps(b, cx, y_face, width, z_top, n, look, col=None, run=None):
    if b.detail >= 2:
        return
    col = col or lib.shade(look.stone_col, 1.0)
    if b.detail == 1:
        n = min(n, 2)
    lib.steps(b, cx - width / 2, cx + width / 2, y_face, z_top, run if run else 0.38 * n, n, 'paving', col)


def site_pad(b, look, srng, x0, y0, x1, y1, forecourt='garden', front_gap=None, tree_count=6, tree_h=7.5, kinds=None, cars=False, tree_zone=None, clear=()):
    """Ground plate and a ring of trees. (x0, y0, x1, y1) is the pad; `clear` rectangles are kept free of trees."""
    lib.ground(b, x0, y0, x1, y1, look, z=0.0)
    if b.detail >= 2 or look.tree in (None, 'none'):
        return
    n = tree_count if b.detail == 0 else max(2, tree_count // 2)
    placed = 0
    tries = 0
    while placed < n and tries < n * 30:
        tries += 1
        x = srng.uniform(x0 + 2.5, x1 - 2.5)
        y = srng.uniform(y0 + 2.5, y1 - 2.5)
        if any(c[0] - 1.5 < x < c[2] + 1.5 and c[1] - 1.5 < y < c[3] + 1.5 for c in clear):
            continue
        k = look.tree if not kinds else srng.choice(kinds)
        lib.tree(b, k, x, y, tree_h * srng.uniform(0.8, 1.2), srng, look)
        placed += 1


# ============================================================================================================= the composer
class NS:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def get(self, k, d=None):
        return self.__dict__.get(k, d)


def win_spec(**kw):
    d = dict(bay=4.0, wf=0.34, wmin=0.8, wmax=1.8, sill_f=0.16, head_f=0.93, shape='pointed', rf=1.0, mull=0, surround=0.0, tracery=False, depth=0.28, on=True)
    d.update(kw)
    return d


def zone_ops(L, spec, zlo, zhi, glass_cycle=None, start=0.0, end=None, skip=(), ref=None):
    """Window openings for a wall run of length L inside the height band zlo..zhi."""
    if not spec or not spec.get('on', True) or zhi - zlo < 1.2:
        return []
    end = L if end is None else end
    n = max(1, round((end - start) / spec['bay']))
    bw = (end - start) / n
    w = clamp(bw * spec['wf'], spec['wmin'], min(spec['wmax'], bw - 0.55))
    band = zhi - zlo
    sill = zlo + band * spec['sill_f']
    top = zlo + band * spec['head_f']
    return bay_ops(L, n, start, end, w, sill, top, spec['shape'], 'glass', spec['rf'], spec['depth'], spec['mull'], spec['surround'], spec['tracery'], glass_cycle, skip)


def bay_positions(L, spec, start=0.0, end=None):
    end = L if end is None else end
    n = max(1, round((end - start) / spec['bay']))
    bw = (end - start) / n
    return [start + bw * k for k in range(n + 1)]


def pilasters(b, seg, L, spec, z0, z1, col, w=0.7, proud=0.16):
    """Flat pilaster strips with a capital band at each bay line of a wall."""
    for u in bay_positions(L, spec):
        uu = clamp(u, w / 2 + 0.05, L - w / 2 - 0.05)
        sbox(b, seg, uu - w / 2, uu + w / 2, z0 + 0.4, z1, proud, col, 'plain-render', top=False)
        sbox(b, seg, uu - w * 0.62, uu + w * 0.62, z1 - 0.3, z1, proud + 0.05, col, 'plain-render', top=True)


def wall_decor(b, seg, L, P, z_sill, z_top, trim):
    """LOD0 string course at window-sill height and (Romanesque) a corbel-table frieze under the eaves."""
    if b.detail >= 1:
        return
    if P.get('stringcourse'):
        sbox(b, seg, 0, L, z_sill - 0.12, z_sill + 0.03, 0.09, trim, 'stone-blocks', top=True)
    if P.get('frieze'):
        zigzag_frieze(b, seg, z_top - 0.45, 0.5, lib.shade(trim, 0.92))


def complex_(b, lk, rng, P):
    """Nave (+ aisles, clerestory), optional transept, chancel and apse as walls with cut openings plus roofs. Returns an info dict.
    P (NS) fields: Wt, Wn, y0, y_nave_end, hn, rn, ha (aisle eave or None), za_top, Wc, hc, rc, y2 (chancel end), apse (sides or 0),
    transept (NS yc, depth, span, h, rise) or None, win_nave/win_aisle/win_clere/win_chancel/win_tr (spec dicts), glass_cycle,
    buttress (None|1|2 stages), flying (bool), plinth, trim, front ('gable'|'none'), cornice (projection or 0), pitch_rear_gable (bool)."""
    det = b.detail
    ws, wc, trim = P.get('wall_slot') or lk.wall_slot, P.get('wall_col') or lk.wall_col, P.get('trim') or lk.trim_col
    buts = P.get('buttress') or 0
    but_col = lib.mix(P.get('but_col') or trim, wc, 0.45)
    but_slot = P.get('but_slot') or ('stone-blocks' if ws != 'brick' else 'brick')
    plinth = P.get('plinth', 0.55)
    gc = P.get('glass_cycle')
    Wt, Wn = P.Wt, P.Wn
    xn0, xn1, xt0, xt1 = -Wn / 2, Wn / 2, -Wt / 2, Wt / 2
    aisles = P.ha is not None and Wt > Wn + 1.0
    y0, hn, rn = P.y0, P.hn, P.rn
    tr = P.get('transept')
    info = {'x0': xt0, 'x1': xt1, 'y0': y0, 'hn': hn, 'ridge': hn + rn}
    y_tr0 = tr.yc - tr.depth / 2 if tr else P.y_nave_end
    y_tr1 = tr.yc + tr.depth / 2 if tr else P.y_nave_end
    cornice = P.get('cornice', 0.0)

    def nave_side(sgn):
        x = xn1 if sgn > 0 else xn0
        ya, yb = y0, y_tr0
        L = yb - ya
        if L < 1.0:
            return
        zlo = P.za_top + 0.55 if aisles else 0.0
        zbase = (P.ha - 0.4) if aisles else 0.0
        if aisles:
            ops = zone_ops(L, P.win_clere, zlo, hn - 0.5, gc) if P.get('win_clere') else []
        else:
            ops = zone_ops(L, P.win_nave, 0.0, hn - 0.2, gc)
        if sgn > 0:
            seg = wall(b, (x, ya), (x, yb), zbase, hn, lk, ops, ws, wc, trim, plinth=0 if aisles else plinth, bands=P.get('bands'))
        else:
            ops = [dict(o, u0=L - o['u1'], u1=L - o['u0']) for o in ops]
            seg = wall(b, (x, yb), (x, ya), zbase, hn, lk, ops, ws, wc, trim, plinth=0 if aisles else plinth, bands=P.get('bands'))
        if cornice and det == 0:
            sbox(b, seg, 0, L, hn - 0.35, hn, cornice, trim, 'plain-render')
        if not aisles and buts and det <= 1:
            spec = P.win_nave
            for u in bay_positions(L, spec):
                if det == 1 and (u < 0.1 or u > L - 0.1):
                    continue
                buttress(b, seg, clamp(u, 0.45, L - 0.45), 0.0, hn - 0.9, but_col, but_slot, 0.8, 0.6, buts)
        if P.get('pilaster') and det == 0 and not aisles:
            pilasters(b, seg, L, P.win_nave, 0.0, hn - 0.4, trim, P.get('pilaster'))
        wall_decor(b, seg, L, P, (zlo + 0.05 * (hn - zlo)) if aisles else 0.2 * hn, hn, trim)
        return seg

    def aisle_side(sgn, ya, yb):
        x = xt1 if sgn > 0 else xt0
        L = yb - ya
        if L < 1.0:
            return
        ops = zone_ops(L, P.win_aisle, 0.0, P.ha - 0.1, gc)
        if sgn > 0:
            seg = wall(b, (x, ya), (x, yb), 0.0, P.ha, lk, ops, ws, wc, trim, plinth=plinth, bands=P.get('bands'))
        else:
            ops = [dict(o, u0=L - o['u1'], u1=L - o['u0']) for o in ops]
            seg = wall(b, (x, yb), (x, ya), 0.0, P.ha, lk, ops, ws, wc, trim, plinth=plinth, bands=P.get('bands'))
        if buts and det <= 1:
            for u in bay_positions(L, P.win_aisle):
                if det == 1 and (u < 0.1 or u > L - 0.1):
                    continue
                buttress(b, seg, clamp(u, 0.45, L - 0.45), 0.0, P.ha - 0.2, but_col, but_slot, 0.8, 0.6, buts)
        if cornice and det == 0:
            sbox(b, seg, 0, L, P.ha - 0.3, P.ha, cornice * 0.8, trim, 'plain-render')
        if P.get('pilaster') and det == 0:
            pilasters(b, seg, L, P.win_aisle, 0.0, P.ha - 0.3, trim, P.get('pilaster'))
        wall_decor(b, seg, L, P, 0.22 * P.ha, P.ha, trim)

    b.section('nave')
    for sgn in (-1, 1):
        nave_side(sgn)
    if aisles:
        b.section('aisles')
        for sgn in (-1, 1):
            aisle_side(sgn, y0, y_tr0)
            lean_roof(b, sgn * Wt / 2, sgn * Wn / 2, y0 - (0.0), y_tr0, P.ha, P.za_top, lk, ov=0.35)
        if det <= 1 and P.get('flying'):
            b.section('flying')
            for sgn in (-1, 1):
                for u in bay_positions(y_tr0 - y0, P.win_aisle):
                    if u < 1.0 or u > y_tr0 - y0 - 1.0:
                        continue
                    flying_buttress(b, sgn, y0 + u, Wt / 2 + 0.4, Wn / 2, P.ha + 0.6, hn - 1.4, but_col, but_slot)
    # nave roof
    b.section('roof')
    ridge_end = tr.yc if tr else P.y_nave_end
    gable_roof(b, (xn0, y0, xn1, ridge_end), hn, rn, 'y', ov=P.get('ov', 0.35), ove=P.get('ove', 0.3), look=lk, slot=P.get('roof_slot'), col=P.get('roof_col'), gables=(False, False), hip=P.get('hip_nave', 0.0),
               hip_ends=(False, False))
    # nave front: gable wall (optional)
    if P.get('front', 'gable') == 'gable':
        front_gable(b, lk, P, info)
    # rear wall of the nave above the lower chancel
    if not tr:
        rear = lib.Seg((xn1, P.y_nave_end), (xn0, P.y_nave_end))
        hc = P.hc
        if hc is not None and hc < hn:
            F(b, [rear.P(0, hc - 0.3), rear.P(rear.length, hc - 0.3), rear.P(rear.length, hn), rear.P(0, hn)], ws, wc)
            F(b, [rear.P(0, hn), rear.P(rear.length, hn), rear.P(rear.length / 2, hn + rn)], ws, wc)
        else:
            F(b, [rear.P(0, 0), rear.P(rear.length, 0), rear.P(rear.length, hn), rear.P(0, hn)], ws, wc)
            F(b, [rear.P(0, hn), rear.P(rear.length, hn), rear.P(rear.length / 2, hn + rn)], ws, wc)
        if aisles:
            for sgn in (-1, 1):
                x_o, x_i = sgn * Wt / 2, sgn * Wn / 2
                end = P.y_nave_end
                if sgn > 0:
                    F(b, [(x_i, end, P.ha - 0.3), (x_o, end, P.ha - 0.3), (x_o, end, P.ha), (x_i, end, P.za_top)], ws, wc, hint=(0, 1, 0))
                    F(b, [(x_i, end, 0), (x_o, end, 0), (x_o, end, P.ha), (x_i, end, P.za_top)], ws, wc, hint=(0, 1, 0))
                else:
                    F(b, [(x_i, end, 0), (x_o, end, 0), (x_o, end, P.ha), (x_i, end, P.za_top)], ws, wc, hint=(0, 1, 0))
    # ---- transept
    if tr:
        b.section('transept')
        transept(b, lk, P, info, tr, aisles, ws, wc, trim, but_col, but_slot, buts, gc, plinth)
    # ---- chancel + apse
    if P.y2 is not None and P.Wc:
        b.section('chancel')
        chancel(b, lk, P, info, tr, ws, wc, trim, but_col, but_slot, buts, gc, plinth)
    return info


def front_gable(b, lk, P, info):
    """Default nave front: gable wall with a portal and a big window, optional rose; aisle ends as trapezoids with a small window."""
    det = b.detail
    ws, wc, trim = P.get('wall_slot') or lk.wall_slot, P.get('wall_col') or lk.wall_col, P.get('trim') or lk.trim_col
    Wt, Wn = P.Wt, P.Wn
    aisles = P.ha is not None and Wt > Wn + 1.0
    y0, hn, rn = P.y0, P.hn, P.rn
    gc = P.get('glass_cycle')
    Lw = Wn
    dw = clamp(Wn * 0.22, 1.6, 3.0)
    dh = clamp(dw * 1.9, 3.2, 5.2)
    ops = [op(Lw / 2 - dw / 2, Lw / 2 + dw / 2, 0.0, dh, P.get('door_shape', 'pointed'), 'door', 1.0, 0.5, 0, 0.22, False)]
    ww = clamp(Wn * 0.3, 1.4, 3.2)
    wtop = hn - 0.9
    wsill = dh + 1.6
    if wtop - wsill > 2.2 and P.get('front_window', True):
        ops.append(op(Lw / 2 - ww / 2, Lw / 2 + ww / 2, wsill, wtop, P.get('win_shape', 'pointed'), (gc[0] if gc else 'glass'), 1.4, 0.3, 2 if ww > 2.4 else 1, 0.18, True, tracery=True))
    seg = wall(b, (-Lw / 2, y0), (Lw / 2, y0), 0.0, hn, lk, ops, ws, wc, trim, plinth=P.get('plinth', 0.55))
    gable_tri(b, seg, hn, rn, look=lk, slot=ws, col=wc)
    if det == 0:
        if P.get('rose'):
            rose_window(b, seg, Lw / 2, hn + rn * 0.42, clamp(rn * 0.28, 0.6, 2.4), lk, (gc[1] if gc and len(gc) > 1 else '#5a6fb8'))
        elif rn > 3.0:
            applique_window(b, seg, op(Lw / 2 - 0.35, Lw / 2 + 0.35, hn + 0.9, hn + rn * 0.62, P.get('win_shape', 'pointed'), 'glass', 1.4, 0.2, 0, 0.0, False), lk, trim)
        cross_finial(b, 0, y0, hn + rn, 1.6, lib.shade(trim, 1.0))
        info['cross_top'] = hn + rn + 1.6
        if P.get('buttress') and not P.get('towers_flank'):
            for sx in (-Lw / 2, Lw / 2):
                buttress(b, seg, clamp(sx, 0.4, Lw - 0.4) if False else (0.4 if sx < 0 else Lw - 0.4), 0.0, hn - 1.0, lib.shade(trim, 0.97), 'stone-blocks', 0.75, 0.55, 2)
    if aisles:
        for sgn in (-1, 1):
            x_o, x_i = sgn * Wt / 2, sgn * Wn / 2
            pts = [(x_i, y0, 0), (x_o, y0, 0), (x_o, y0, P.ha), (x_i, y0, P.za_top)]
            F(b, pts, ws, wc, hint=(0, -1, 0))
            if det == 0 and P.get('aisle_front_window', True):
                cu = (x_i + x_o) / 2
                aw = clamp(abs(x_o - x_i) * 0.34, 0.7, 1.2)
                sg = lib.Seg((x_i, y0), (x_o, y0)) if sgn > 0 else lib.Seg((x_o, y0), (x_i, y0))
                u = abs(x_o - x_i) / 2
                applique_window(b, sg, op(u - aw / 2, u + aw / 2, 1.3, P.ha - 1.0, 'pointed', 'glass', 1.4, 0.2, 0, 0.1, False), lk, trim)
    return seg


def flying_buttress(b, sgn, y, x_pier, x_wall, z_pier, z_wall, col, slot):
    """A half-arch from a pier outside the aisle up to the clerestory wall: sloped slab with a thin underside curve."""
    if b.detail >= 2:
        return
    t = 0.32
    a = sgn * x_pier
    w = sgn * x_wall
    pts_top = [(a, z_pier + 0.4), (w, z_wall + 0.45)]
    pts_bot = [(a, z_pier - 0.3), (sgn * (x_pier + x_wall) / 2, (z_pier + z_wall) / 2 - 0.6), (w, z_wall - 0.5)]
    prof = [pts_top[0], pts_top[1], pts_bot[2], pts_bot[1], pts_bot[0]]
    for yy, hint in ((y - t, (0, -1, 0)), (y + t, (0, 1, 0))):
        b.facing([(p[0], yy, p[1]) for p in prof], hint, slot, col, scale=tscale(slot, b.detail))
    # top and underside strips
    b.facing([(pts_top[0][0], y - t, pts_top[0][1]), (pts_top[1][0], y - t, pts_top[1][1]), (pts_top[1][0], y + t, pts_top[1][1]), (pts_top[0][0], y + t, pts_top[0][1])], (0, 0, 1), slot, lib.shade(col, 1.05), scale=tscale(slot, b.detail))
    for (p, q) in ((pts_bot[0], pts_bot[1]), (pts_bot[1], pts_bot[2])):
        b.facing([(p[0], y - t, p[1]), (q[0], y - t, q[1]), (q[0], y + t, q[1]), (p[0], y + t, p[1])], (0, 0, -1), slot, lib.shade(col, 0.8), scale=tscale(slot, b.detail))
    # the pier above the aisle buttress
    lib.box_c(b, sgn * x_pier, y, 0, 0.8, 0.8, z_pier + 0.4, slot, col, skip=('bottom',))


def transept(b, lk, P, info, tr, aisles, ws, wc, trim, but_col, but_slot, buts, gc, plinth):
    det = b.detail
    Wt, Wn = P.Wt, P.Wn
    S2 = tr.span / 2
    ya, yb = tr.yc - tr.depth / 2, tr.yc + tr.depth / 2
    ht, rt = tr.h, tr.rise
    inner = Wn / 2
    inner_rear = min(Wn / 2, P.Wc / 2) if (P.get('y2') is not None and P.get('Wc')) else Wn / 2
    arm = S2 - inner
    if arm > 0.8:
        # front and rear faces of each arm (they start at the nave piers: the aisles end against them)
        for sgn in (-1, 1):
            for (yy, front) in ((ya, True), (yb, False)):
                inn = inner if front else inner_rear
                x_a, x_b = (inn, S2) if sgn > 0 else (-S2, -inn)
                if front:
                    p0, p1 = (x_a, yy), (x_b, yy)
                else:
                    p0, p1 = (x_b, yy), (x_a, yy)
                L = S2 - inn
                ops = zone_ops(L, win_spec(bay=max(3.5, L), wf=0.5, wmin=0.8, wmax=1.4, shape=P.win_aisle['shape'] if P.get('win_aisle') else 'pointed',
                                           rf=P.win_aisle['rf'] if P.get('win_aisle') else 1.0), 0.0, ht - 0.2, gc) if L > 2.2 else []
                wall(b, p0, p1, 0.0, ht, lk, ops, ws, wc, trim, plinth=plinth)
    for sgn in (-1, 1):
        xx = sgn * S2
        L = tr.depth
        # end wall with a big window and a gable
        ww = clamp(L * 0.34, 1.4, 3.4)
        ops = []
        dh = 0
        if tr.get('door'):
            dw = clamp(L * 0.16, 1.4, 2.2)
            ops.append(op(L / 2 - dw / 2, L / 2 + dw / 2, 0.0, clamp(dw * 1.9, 3.0, 4.2), P.get('door_shape', 'pointed'), 'door', 1.0, 0.45, 0, 0.18, False))
            dh = ops[-1]['top']
        top_w = ht - 0.9
        sill_w = max(dh + 1.4, ht * 0.3)
        if top_w - sill_w > 2.0:
            ops.append(op(L / 2 - ww / 2, L / 2 + ww / 2, sill_w, top_w, P.get('win_shape', 'pointed'), (gc[0] if gc else 'glass'), 1.4, 0.3, 2 if ww > 2.6 else 1, 0.18, True, tracery=True))
        if sgn > 0:
            seg = wall(b, (xx, ya), (xx, yb), 0.0, ht, lk, ops, ws, wc, trim, plinth=plinth)
        else:
            ops2 = [dict(o, u0=L - o['u1'], u1=L - o['u0']) for o in ops]
            seg = wall(b, (xx, yb), (xx, ya), 0.0, ht, lk, ops2, ws, wc, trim, plinth=plinth)
        gable_tri(b, seg, ht, rt, look=lk, slot=ws, col=wc)
        if det == 0:
            if P.get('rose') and P.get('rose_transept', True):
                rose_window(b, seg, L / 2, ht + rt * 0.42, clamp(rt * 0.28, 0.6, 2.2), lk, (gc[1] if gc and len(gc) > 1 else '#5a6fb8'))
            cross_finial(b, xx, tr.yc, ht + rt, 1.3, trim)
        if buts and det <= 1:
            buttress(b, seg, 0.45, 0.0, ht - 1.0, but_col, but_slot, 0.75, 0.55, buts)
            buttress(b, seg, L - 0.45, 0.0, ht - 1.0, but_col, but_slot, 0.75, 0.55, buts)
    b.section('transept roof')
    gable_roof(b, (-S2, ya, S2, yb), ht, rt, 'x', ov=P.get('ov', 0.35), ove=P.get('ove', 0.3), look=lk, slot=P.get('roof_slot'), col=P.get('roof_col'), gables=(False, False))
    info['transept'] = tr


def chancel(b, lk, P, info, tr, ws, wc, trim, but_col, but_slot, buts, gc, plinth):
    det = b.detail
    Wc, hc, rc = P.Wc, P.hc, P.rc
    ys = (tr.yc if tr else P.y_nave_end)
    ys_wall = (tr.yc + tr.depth / 2) if tr else P.y_nave_end
    y2 = P.y2
    x0, x1 = -Wc / 2, Wc / 2
    apse_sides = P.get('apse', 0)
    wall_end = y2 - (Wc / 2 if apse_sides else 0)
    L = wall_end - ys_wall
    if L > 1.0:
        for sgn in (-1, 1):
            ops = zone_ops(L, P.win_chancel, 0.0, hc - 0.2, gc, end=None)
            if sgn > 0:
                seg = wall(b, (x1, ys_wall), (x1, wall_end), 0.0, hc, lk, ops, ws, wc, trim, plinth=plinth)
            else:
                ops = [dict(o, u0=L - o['u1'], u1=L - o['u0']) for o in ops]
                seg = wall(b, (x0, wall_end), (x0, ys_wall), 0.0, hc, lk, ops, ws, wc, trim, plinth=plinth)
            wall_decor(b, seg, L, P, 0.2 * hc, hc, trim)
            if buts and det <= 1:
                spec = P.win_chancel
                for u in bay_positions(L, spec):
                    if u < 0.3 or u > L - 0.3:
                        continue
                    buttress(b, seg, u, 0.0, hc - 0.8, but_col, but_slot, 0.7, 0.5, 1)
    b.section('apse')
    if apse_sides:
        apse(b, 0.0, wall_end, Wc / 2, 0.0, hc, lk, rng=None, sides=apse_sides, ws=ws, wc=wc, roof_rise=rc, stained=(gc[0] if gc else None), shape=P.win_chancel['shape'] if P.get('win_chancel') else 'pointed',
             win_w=clamp(Wc * 0.13, 0.7, 1.4), sill=1.6, head=hc - 1.2)
        roof_end = wall_end
    else:
        # flat east end: wall + big window + gable
        seg = lib.Seg((x1, y2), (x0, y2))
        ww = clamp(Wc * 0.4, 1.0, 3.0)
        o = [op(Wc / 2 - ww / 2, Wc / 2 + ww / 2, hc * 0.3, hc - 0.8, P.get('win_shape', 'pointed'), (gc[0] if gc else 'glass'), 1.4, 0.3, 1 if ww > 1.6 else 0, 0.15, True, tracery=ww > 1.5)]
        seg = wall(b, (x1, y2), (x0, y2), 0.0, hc, lk, o, ws, wc, trim, plinth=plinth)
        gable_tri(b, seg, hc, rc, look=lk, slot=ws, col=wc)
        roof_end = y2
        if det == 0:
            cross_finial(b, 0, y2, hc + rc, 1.2, trim)
    gable_roof(b, (x0, ys if tr else P.y_nave_end - 0.2, x1, roof_end), hc, rc, 'y', ov=P.get('ov', 0.3) * 0.8, ove=0.25 if not apse_sides else 0.0, look=lk, slot=P.get('roof_slot'), col=P.get('roof_col'), gables=(False, False))


# =============================================================================================================== shared site
def site_common(b, lk, srng, brief, ft, half_w, y_front, y_rear, body_half, door_x=0.0, medieval=False, tree_h=8.0, front_margin=14.0, rear_margin=8.0,
                side_margin=0.0, force_fence=False, rail=True, headstone_n=0, statue_at=None, flag_cols=None, cars_in_front=0.0, trees=7, forecourt_default='garden',
                gate_w=4.0, stone_fence=False, kinds=None):
    """Churchyard / forecourt shared by the three church archetypes: ground, trees (kept off the entrance axis), path, boundary
    wall or railing with a gate, optional forecourt paving or parking, headstones, statue and flagpoles."""
    det = b.detail
    setting = brief.get('setting') or {}
    fc = setting.get('forecourt') or forecourt_default
    if fc == 'none':
        fc = forecourt_default
    if 'car-park' in ft:
        fc = 'parking'
    x0, x1 = -half_w - side_margin, half_w + side_margin
    x0, x1 = max(x0, -58.0), min(x1, 58.0)
    pad_y0 = y_front - front_margin
    pad_y1 = y_rear + rear_margin
    if pad_y1 - pad_y0 > 118:
        pad_y1 = pad_y0 + 118
    clear = [(-body_half - 2, y_front - 2, body_half + 5, y_rear + 1), (-max(body_half * 0.5 + 3, 8) + door_x, pad_y0, max(body_half * 0.5 + 3, 8) + door_x, y_front)]
    site_pad(b, lk, srng, x0, pad_y0, x1, pad_y1, fc, tree_count=trees, tree_h=tree_h, clear=clear, kinds=kinds)
    if det <= 1:
        if fc == 'plaza':
            lib.forecourt(b, 'plaza', door_x - clamp(body_half * 0.9, 6, 20), pad_y0 + 1, door_x + clamp(body_half * 0.9, 6, 20), y_front - 0.5, lk, srng)
        elif fc == 'parking':
            lib.forecourt(b, 'parking', x0 + 2, pad_y0 + 1, x1 - 2, y_front - 4, lk, srng, density=0.6)
    path_strip(b, door_x, pad_y0 + 0.5, y_front - 0.1, 2.4, lk)
    if force_fence or 'fence-wall' in ft or 'gate' in ft:
        fence_wall(b, x0 + 1.5, pad_y0 + 1.0, x1 - 1.5, pad_y1 - 1.0, door_x, gate_w, lk, h=1.0 if not rail else 1.4, rail=rail and not stone_fence)
    if headstone_n and det == 0:
        headstones(b, srng, x0 + 3, x1 - 3, y_front + 2, pad_y1 - 3, [(-body_half - 1, y_front - 1, body_half + 9, y_rear + 1)], headstone_n)
    if det <= 1:
        if 'signage-board' in ft:
            with b.site():
                sign_x = door_x + clamp(body_half * 0.6 + 4, 6, 22)
                lib.sign_board(b, sign_x, y_front - 9.0, 0.0, 6.5, 2.6, lk, 0.0, col='#2f5f8a')
        if 'fountain' in ft and det == 0:
            with b.site():
                fx, fy = door_x - clamp(body_half * 0.6 + 4, 6, 20), y_front - 8.0
                lib.cylinder(b, fx, fy, 0, 0.6, 2.4, n=12, slot='stone-blocks', col='#b9b4a8', top=False, smooth=False)
                lib.cylinder(b, fx, fy, 0.55, 0.62, 2.1, n=12, slot='plain-render', col='#5f98b3', top=True, smooth=False)
                lib.cylinder(b, fx, fy, 0.6, 1.8, 0.25, n=6, slot='stone-blocks', col='#b9b4a8', r_top=0.15, top=True)
        if 'floodlights' in ft and det == 0:
            with b.site():
                for sx_ in (-1, 1):
                    fx = sx_ * (half_w - 4)
                    lib.cylinder(b, fx, y_front - 6, 0, 12, 0.2, n=6, slot='frame', col='#8d9298', r_top=0.12, top=True)
                    lib.box_c(b, fx, y_front - 6, 12, 2.2, 0.5, 1.0, 'plain', '#3d4146')
    if 'statue' in ft:
        sx, sy = statue_at or (body_half * 0.5 + 4.0, y_front - 8.0)
        statue(b, sx, sy, 3.6)
    if 'flags' in ft:
        for k, c in enumerate(flag_cols or ['#1b7a3d', '#f0f0f0', '#1b7a3d']):
            flagpole(b, door_x - 9 + 4 * k, y_front - 11.0, 8.0, c)
    return (x0, pad_y0, x1, pad_y1)


def zigzag_frieze(b, seg, z, h, col, tooth=0.8, proud=0.06):
    """Romanesque corbel table: a strip of little arches under the eaves, drawn as a zig-zag edged band (LOD0)."""
    if b.detail >= 1:
        return
    L = seg.length
    n = max(2, int(L / tooth))
    step = L / n
    for k in range(n):
        u0, u1 = k * step, (k + 1) * step
        um = (u0 + u1) / 2
        b.face([seg.P(u0, z, -proud), seg.P(um, z - h, -proud), seg.P(u1, z, -proud)], 'plain-render', col)
    b.face([seg.P(0, z, -proud), seg.P(L, z, -proud), seg.P(L, z + 0.22, -proud), seg.P(0, z + 0.22, -proud)], 'plain-render', col)


def dome(b, cx, cy, z, r, look, height=None, profile='hemi', slot=None, col=None, finial=0.0, lantern=0.0):
    """lib.dome with a cheap LOD2 (a plain cone) so a church with many domes stays inside the 500 triangle budget."""
    height = height or r
    if b.detail >= 2:
        lib.cylinder(b, cx, cy, z, z + height, r, n=6, slot='plain', col=col or look.roof_col, r_top=0.0, top=False, smooth=False)
        return
    lib.dome(b, cx, cy, z, r, look, height=height, profile=profile, slot=slot, col=col, finial=finial, lantern=lantern)


def wall_pattern(b, seg, z0, z1, col, kind):
    """Decorative applique on a plain wall: 'mosaic' (coloured tile row) or 'relief' (row of raised panels)."""
    if b.detail >= 2:
        return
    L = seg.length
    if kind == 'mosaic':
        pal = ['#c9772f', '#2f6f9a', '#d6b24a', '#a3352f', '#4f8a5a']
        n = max(3, int(L / 1.3))
        w = L / n
        for k in range(n):
            b.face([seg.P(k * w, z0, -0.03), seg.P((k + 1) * w, z0, -0.03), seg.P((k + 1) * w, z1, -0.03), seg.P(k * w, z1, -0.03)], 'plain-render', pal[k % len(pal)])
    else:
        n = max(3, int(L / 2.4))
        w = L / n
        for k in range(n):
            b.face([seg.P(k * w + 0.2, z0, -0.08), seg.P((k + 1) * w - 0.2, z0, -0.08), seg.P((k + 1) * w - 0.2, z1, -0.08), seg.P(k * w + 0.2, z1, -0.08)], 'plain-render', col)


def cloister(b, lk, srng, cx, cy, W, D, h, roof='gable', ws=None, wc=None):
    """A courtyard range (monastery / convent): a ring of two-storey wings round a court, with its own plain roofs."""
    ws = ws or lk.wall_slot
    wc = wc or lk.wall_col
    cw, cd = max(5.0, W * 0.5), max(5.0, D * 0.5)
    fp = lib.fp_ring(W, D, cw, cd).moved(cx, cy)
    storeys = 2 if h >= 6.0 else 1
    lib.walls(b, fp, 0.0, h, storeys, lk, srng, kind='arched' if lk.windows == 'arched' else 'punched', ratio=0.3, rear='same', plinth=0.4, wall_slot=ws, wall_col=wc, bay=4.8)
    if roof == 'flat':
        lib.flat_roof(b, fp, h, lk, parapet_h=0.9)
    else:
        lib.roof(b, 'gable', fp, h, lk, pitch=24, ov=0.5)
    return fp


def front_porch(b, lk, cx, y_wall, pw, pd, zh, rise, ws=None, wc=None, trim=None, shape='round', col_roof=None):
    """Small gabled porch standing in front of a front wall (at y_wall), open through an arch or a rectangular doorway."""
    ws = ws or lk.wall_slot
    wc = wc or lk.wall_col
    trim = trim or lk.trim_col
    x0, x1 = cx - pw / 2, cx + pw / 2
    yf = y_wall - pd
    wall(b, (x1, yf), (x1, y_wall), 0.0, zh, lk, [], ws, wc, trim, plinth=0.35)
    wall(b, (x0, y_wall), (x0, yf), 0.0, zh, lk, [], ws, wc, trim, plinth=0.35)
    ow = pw * 0.62
    o = op(pw / 2 - ow / 2, pw / 2 + ow / 2, 0.0, zh - 0.35, shape, 'dark', 1.0, 0.3, 0, 0.14, False)
    seg = wall(b, (x0, yf), (x1, yf), 0.0, zh, lk, [o], ws, wc, trim, plinth=0.35)
    gable_tri(b, seg, zh, rise, look=lk, slot=ws, col=wc)
    gable_roof(b, (x0, yf, x1, y_wall), zh, rise, 'y', ov=0.25, ove=0.3, look=lk, slot=lk.roof_slot, col=col_roof or lk.roof_col, gables=(False, False))
    return yf


def aisle_fronts(b, lk, P, trim=None):
    """Trapezoid end walls of the aisles at the front of the nave (y = P.y0)."""
    ws, wc = P.get('wall_slot') or lk.wall_slot, P.get('wall_col') or lk.wall_col
    trim = trim or lk.trim_col
    for sgn in (-1, 1):
        x_o, x_i = sgn * P.Wt / 2, sgn * P.Wn / 2
        pts = [(x_i, P.y0, 0), (x_o, P.y0, 0), (x_o, P.y0, P.ha), (x_i, P.y0, P.za_top)]
        F(b, pts, ws, wc, hint=(0, -1, 0))
        if b.detail == 0:
            aw = clamp(abs(x_o - x_i) * 0.34, 0.7, 1.2)
            sg = lib.Seg((x_i, P.y0), (x_o, P.y0)) if sgn > 0 else lib.Seg((x_o, P.y0), (x_i, P.y0))
            u = abs(x_o - x_i) / 2
            applique_window(b, sg, op(u - aw / 2, u + aw / 2, 1.3, P.ha - 1.0, 'round', 'glass', 1.0, 0.2, 0, 0.1, False), lk, trim)
