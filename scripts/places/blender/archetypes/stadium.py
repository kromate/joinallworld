"""stadium: three typologies chosen from the brief.

  bowl    continuous rounded bowl (oval / round / rounded-rect superellipse plan) with a raked, stepped stand profile whose height and
          depth vary round the bowl (tall main stand, lower ends), a cantilever or ring roof (membrane scallops with masts, truss
          ring with radial ribs, flat slab, shed) or none, five facade treatments (ribs, arcade, clad, glass, towers, faceted skin),
          running track and pitch, floodlight masts or roof lights, entrance forecourt. Bowls whose plan is over 140 m are shown as a
          recognisable PORTION (the main-stand sector with its section cut open), smaller ones as the whole bowl.
  grounds four separate rectangular stands (English-style ground) with corner gaps, shed roofs and corner floodlight pylons.
  hall    indoor arena / sports hall / velodrome: rectangular or oval hall under a barrel / shed / flat roof with a clerestory.

Layout: facade towards -Y, bowl centre at the origin before the final recentre.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import _stadium_util as U  # noqa: E402

FEATURES = {'stand-roof', 'ring-roof', 'floodlights', 'scoreboard', 'gate', 'fence-wall', 'flags', 'steps', 'car-park', 'pilotis',
            'signage-board', 'mast', 'arches', 'louvres', 'kiosk', 'umbrellas', 'brise-soleil', 'balcony-bands', 'colonnade', 'podium',
            'atrium-glass', 'terrace', 'solar-panels', 'roof-terrace', 'relief-pattern', 'painted-mural', 'awning', 'neon-strip', 'stalls',
            'sheds', 'bus-bays', 'railings'}

ECON = False  # set by build() when LOD0 would exceed the triangle budget (coarser stands, flat glazing)
FLAT = 60.0  # tile scale for untextured colour faces (avoids cutting big faces into 1 m cells)
TS = 1.0
SEAT_PALETTE = ['#2f5f9e', '#b83a32', '#2f7d4e', '#d08a2c', '#6a4a8a', '#c9b037']


# ------------------------------------------------------------------------------------------------------------------ plan
def plan(brief, style, srng, lk):
    form = brief.get('form') or {}
    fe = U.feats(brief)
    tx = U.text(brief)
    w = U.num(form, 'width_m', 160)
    d = U.num(form, 'depth_m', 120)
    H = U.num(form, 'height_m', 16)
    st = int(U.num(form, 'storeys', 2))
    fp = form.get('footprint') or 'oval'
    roof = form.get('roof') or 'none'
    year = U.era_year(brief)
    material = (brief.get('facade') or {}).get('material') or lk.wall_material
    accent = (brief.get('facade') or {}).get('accent')
    P = {'fe': fe, 'tx': tx, 'year': year, 'material': material, 'accent': accent, 'roof_decl': roof, 'style': brief.get('style') or ''}
    # --- typology
    hall_words = ('indoor', 'sports hall', 'gymnasium', 'gymnase', 'velodrome', 'salle', 'basketball arena', 'indoor arena')
    ht = ' '.join(str(brief.get(k) or '') for k in ('name', 'subject')).lower() + ' ' + str(form.get('variant') or '').lower()
    is_hall = (U.has(ht, *hall_words) and not U.has(ht, 'stadium', 'football ground')) or (fp == 'rect' and max(w, d) <= 70 and not U.has(tx, 'football', 'pitch'))
    four = U.has(tx, 'four-sided', 'four sided', 'four stands', 'four-stand', 'non-league')
    if is_hall:
        P['typ'] = 'hall'
    elif fp == 'rect' and (four or (min(w, d) >= 80 and st >= 3 and not U.has(tx, 'oval') and 'ring-roof' not in fe and roof != 'tensile')):
        P['typ'] = 'grounds'
    else:
        P['typ'] = 'bowl'
    P['w'], P['d'], P['H'], P['st'] = w, d, H, st
    P['fp'] = fp
    roofed_all = (U.has(tx, 'fully roofed', 'fully-roofed', 'all-covered', 'all covered', 'closed bowl', 'continuous roof', 'covered bowl',
                        'wrapped in')
                  or 'ring-roof' in fe or (roof == 'tensile' and st >= 3))
    main_cov = roofed_all or 'stand-roof' in fe or roof not in ('none', '', None)
    if U.has(tx, 'open concrete stands', 'open bowl', 'no roof') and not roofed_all and 'stand-roof' not in fe:
        main_cov = False
    P['roofed_all'], P['main_cov'] = roofed_all, main_cov
    P['track'] = not U.has(tx, 'no track') and (U.has(tx, 'track', 'athletic', 'running') or max(w, d) > 150 and not U.has(tx, 'football ground', 'non-league'))
    P['small_council'] = U.has(tx, 'sport council', 'sports council', 'one covered', 'single covered', 'single stand', 'ringed by')
    # --- facade style
    skin = roofed_all and U.has(tx, 'faceted', 'triangular', 'skin', 'panels') and (accent == 'metal-cladding' or material == 'glass-curtain')
    if skin:
        ws = 'skin'
    elif 'pilotis' in fe or U.has(tx, ' towers', '36 towers'):
        ws = 'towers'
    elif material == 'glass-curtain' or (brief.get('facade') or {}).get('windows') in ('curtain',):
        ws = 'glass'
    elif material == 'metal-cladding' or accent == 'metal-cladding' or year >= 2005:
        ws = 'clad'
    elif ('arches' in fe) or (0 < year < 1990 and srng.random() < 0.55) or P['style'] in ('colonial',):
        ws = 'arcade'
    else:
        ws = 'ribs'
    P['wall_style'] = ws
    # --- roof style
    if roofed_all:
        P['roof_style'] = 'membrane' if (roof == 'tensile' or U.has(tx, 'tensile', 'membrane', 'cable')) else ('flat' if roof == 'flat' else 'truss')
    elif roof == 'flat':
        P['roof_style'] = 'flat'
    elif roof in ('shed',) or (roof == 'none' and main_cov):
        P['roof_style'] = 'shed'
    else:
        P['roof_style'] = 'shed'
    # --- seat palette
    acc_cols = list((brief.get('facade') or {}).get('colours') or [])
    sat = lambda c: (max(lib.rgb(c)) - min(lib.rgb(c)))
    seat = None
    for c in acc_cols[1:]:
        if sat(c) > 0.25:
            seat = c
            break
    if seat is None:
        seat = srng.choice(SEAT_PALETTE)
    P['seat_a'] = seat
    P['seat_b'] = lib.mix(seat, '#e9e6dc', 0.55) if srng.random() < 0.6 else lib.shade(seat, 0.7)
    P['n_exp'] = {'round': 2.0, 'oval': 2.4, 'rect': 4.4, 'irregular': 3.0}.get(fp, 2.6) + srng.uniform(-0.15, 0.25)
    P['srng_seed'] = srng.getrandbits(32)
    return P


# ---------------------------------------------------------------------------------------------------------------- bowl
class Bowl:
    """Geometry of the continuous bowl: ring points as functions of (t, f, z). Centre at the origin."""

    def __init__(self, brief, lk, P, detail):
        self.P, self.lk, self.detail = P, lk, detail
        tx, fe = P['tx'], P['fe']
        w, d, H, st = P['w'], P['d'], P['H'], P['st']
        big = max(w, d)
        arc = P.get('arc')
        self.sector = (big > 128) if not arc else (abs(arc[1] - arc[0]) < math.radians(359.0))
        hf = 1.0
        if not self.sector and big > 112 and not P.get('exact'):
            f = 110.0 / big
            w, d = w * f, d * f
            hf = f ** 0.5
        H = max(4.0, H * hf)
        self.w, self.d = w, d
        self.n = P['n_exp']
        roofed_all, main_cov = P['roofed_all'], P['main_cov']
        # stand heights (to the top seat row)
        ring_top = H * 0.78 if roofed_all else (H - U.clamp(0.25 * H, 3.2, 6.0) if main_cov else H)
        Hm = U.clamp(ring_top, 5.0, 38.0)
        low = U.has(tx, 'low terraces', 'low concrete', 'small', 'neighbourhood', 'township') or H < 12
        if roofed_all:
            Hf, He = Hm * 0.97, Hm * 0.9
        else:
            Hf = max(4.0, Hm * (0.62 if not low else 0.55))
            He = max(3.5, Hm * (0.48 if not low else 0.42))
        if P.get('small_council') or (P['main_cov'] and not roofed_all and H < 11):
            Hf, He = max(3.2, Hm * 0.4), max(3.0, Hm * 0.35)
        ov = P.get('over') or {}
        Hm, Hf, He = ov.get('Hm', Hm), ov.get('Hf', Hf), ov.get('He', He)
        self.Hm, self.Hf, self.He = Hm, Hf, He
        self.tiers = ov.get('tiers') or (1 if (Hm < 9.5 or st <= 1) else (2 if (Hm < 24 and st <= 3) else 3))
        # track / pitch
        track = P['track'] and big >= 100
        tw = 8.5 if track else 0.0
        self.track = track
        self.tw = tw * min(1.0, big / 150.0 + 0.2) if track else 0.0
        mg = 3.0
        px_t, py_t = 52.5, 34.0
        extra = 0.28 * (py_t + self.tw + mg) if track else 0.0
        A_in = px_t + self.tw + mg + extra
        De_min = 7.5 if big > 100 else 6.0
        A_in = min(A_in, w / 2 - De_min)
        Dm = U.clamp(Hm * 1.5, 11.0, 0.33 * d)
        Df = U.clamp(Hf * 1.4, 7.0, 0.3 * d)
        B_in = (d - Dm - Df) / 2.0
        if B_in < 24:  # tiny plan: squeeze the stands
            B_in = 24
            sc = (d - 2 * B_in) / (Dm + Df)
            Dm, Df = Dm * sc, Df * sc
        Dm, Df = ov.get('Dm', Dm), ov.get('Df', Df)
        self.A_in, self.B_in = A_in, B_in
        self.Dm, self.Df, self.De = Dm, Df, w / 2 - A_in
        self.px = min(px_t, A_in - self.tw - mg - extra * 0.9)
        self.py = min(py_t, B_in - self.tw - mg)
        if not self.track:
            self.px = min(px_t, A_in - 3.5)
            self.py = min(py_t, B_in - 3.0)
        self.tc = 1.5 * math.pi
        self.t0, self.t1 = (0.0, 2 * math.pi)
        self.has_end = True
        if self.sector and arc:
            self.t0, self.t1 = arc
            self.has_end = True
            self.xl = (self.A_in + self.HD(self.t0)[1]) * U.sp(math.cos(self.t0), self.n)
            self.cx0, self.cx1 = min(self.xl, 0.0) - 12.0, 16.0
        elif self.sector:
            # the front-left quarter of the bowl: from the front centre (t = 3pi/2, cut open on the plane x = 0) round the left corner
            # towards the left end (t = pi); clipped earlier when the plan is wider than the scene allows
            self.t1 = 1.5 * math.pi
            lim = 108.0
            lo, hi = 0.0, math.pi / 2
            if (self.A_in + self.HD(math.pi)[1]) <= lim:
                self.t0 = math.pi
            else:
                for _ in range(30):
                    m = (lo + hi) / 2
                    t = self.t1 - m
                    x = (self.A_in + self.HD(t)[1]) * abs(math.cos(t)) ** (2.0 / self.n)
                    if x < lim:
                        lo = m
                    else:
                        hi = m
                self.t0 = self.t1 - lo
                self.has_end = False
            self.xl = -(self.A_in + self.HD(self.t0)[1]) * abs(math.cos(self.t0)) ** (2.0 / self.n)
            self.cx0, self.cx1 = self.xl - 12.0, 16.0
        else:
            self.cx0, self.cx1 = -w / 2 - 13.0, w / 2 + 13.0
        self.template = make_template(self.tiers, detail)
        # rim of the outer ring: for arc length sampling
        self.ts = self.sample_ts()

    # -- shape ----------------------------------------------------------------------------------------------------
    def weights(self, t):
        s = math.sin(t)
        return max(0.0, -s) ** 1.3, max(0.0, s) ** 1.3

    def HD(self, t):
        wm, wf = self.weights(t)
        H = self.He + (self.Hm - self.He) * wm + (self.Hf - self.He) * wf
        D = self.De + (self.Dm - self.De) * wm + (self.Df - self.De) * wf
        return H, D

    def pt(self, t, f, z, off=0.0):
        H, D = self.HD(t)
        if off:
            f = f + off / D
        x = (self.A_in + f * D) * U.sp(math.cos(t), self.n)
        y = (self.B_in + f * D) * U.sp(math.sin(t), self.n)
        return (x, y, z)

    def zspec(self, spec, Hs):
        k, v = spec
        if k == 'g':
            return 0.0
        if k == 'abs':
            return v
        if k == 'top':
            return Hs + v
        return 1.15 + v * (Hs - 1.15)

    def seat_z(self, t, f):
        """Height of the stand surface at fraction f (piecewise linear through the tread points)."""
        Hs, _ = self.HD(t)
        pts = [(p[0], self.zspec(p[1], Hs)) for p in make_template(self.tiers, 1)]
        best = 0.0
        for (f0, z0), (f1, z1) in zip(pts[:-1], pts[1:]):
            if f0 <= f <= f1 and f1 > f0:
                best = max(best, z0 + (z1 - z0) * (f - f0) / (f1 - f0))
            elif abs(f0 - f1) < 1e-9 and abs(f - f0) < 1e-9:
                best = max(best, z1)
        return best

    def sample_ts(self):
        a, bb = self.t0, self.t1
        # approximate outer perimeter by sampling
        per = 0.0
        prev = None
        K = 120
        for k in range(K + 1):
            t = a + (bb - a) * k / K
            p = self.pt(t, 1.0, 0.0)
            if prev:
                per += math.dist(prev[:2], p[:2])
            prev = p
        seg = {0: 5.5 if ECON else 4.0, 1: 11.0, 2: 22.0}[self.detail]
        N = max(5 if self.sector else 14, int(round(per / seg)))
        if self.detail == 2:
            N = max(6 if self.sector else 12, N)
        if self.sector:
            return [a + (bb - a) * i / N for i in range(N + 1)]
        # full: start at the back so the seam is hidden
        return [math.pi / 2 + 2 * math.pi * i / N for i in range(N + 1)]

    def tangent(self, t, f=1.0):
        e = 1e-3
        a, c = self.pt(t - e, f, 0), self.pt(t + e, f, 0)
        return U.unit((c[0] - a[0], c[1] - a[1], 0.0))

    def radial_hint(self, p):
        return (p[0], p[1], 0.0)


def make_template(tiers, detail):
    """Stand cross-section: list of (f, zspec, kind). f is the fraction of the stand depth from the pitch edge, zspec ('g', 0) ground,
    ('abs', m) metres, ('a', a) fraction of the seating height above the fence, ('top', m) above the top row."""
    pts = [(0.0, ('g', 0.0), 'start'), (0.0, ('abs', 1.15), 'fence')]
    gap = 0.12 if tiers > 1 else 0.0
    th = (1.0 - gap * (tiers - 1)) / tiers
    F = 0.84
    K = (3 if ECON else 6) if detail == 0 else 1
    for k in range(tiers):
        f0, f1 = F * k / tiers, F * (k + 1) / tiers
        a0 = k * (th + gap)
        if k > 0:
            pts.append((f0, ('a', a0), 'fascia'))
        if K == 1:
            pts.append((f1, ('a', a0 + th), 'tread'))
            continue
        df, da = (f1 - f0) / K, th / K
        for r in range(K):
            pts.append((f0 + df * r, ('a', a0 + da * (r + 1)), 'riser'))
            pts.append((f0 + df * (r + 1), ('a', a0 + da * (r + 1)), 'tread'))
    pts.append((1.0, ('a', 1.0), 'deck'))
    pts.append((1.0, ('top', 1.2), 'parapet'))
    return pts


# ------------------------------------------------------------------------------------------------------------- stand mesh
def build_stands(b, B, lk, P, rng):
    ts = B.ts
    T = B.template
    rings = []
    for t in ts:
        Hs, D = B.HD(t)
        rings.append([B.pt(t, f, B.zspec(zs, Hs)) for f, zs, _ in T])
    conc = lk.stone_col if P['wall_style'] in ('ribs', 'arcade') else '#cfcfca'
    conc = lib.mix(P.get('conc', '#bdb9b0'), conc, 0.2)
    riser_col = '#a9a69e'
    deck_col = '#c4c0b6'
    fence_col = lib.mix(P['seat_a'], '#222222', 0.6)
    spat = B.detail == 0
    for i in range(len(ts) - 1):
        for j in range(1, len(T)):
            kind = T[j][2]
            a0, a1 = rings[i][j - 1], rings[i + 1][j - 1]
            c0, c1 = rings[i][j], rings[i + 1][j]
            q = [a0, a1, c1, c0]
            cx = (a0[0] + c1[0]) / 2
            cy = (a0[1] + c1[1]) / 2
            if kind == 'tread':
                blk = (i // 3) % 2
                col = P['seat_a'] if blk == 0 else P['seat_b']
                if B.detail == 2:
                    continue
                if i % 2 and spat:
                    col = lib.shade(col, 0.94)
                b.facing(q, (0, 0, 1), 'plain', col, scale=FLAT)
            elif kind == 'riser':
                b.facing(q, (-cx, -cy, 0), 'plain', riser_col, scale=FLAT)
            elif kind == 'fascia':
                b.facing(q, (-cx, -cy, 0), 'rough-concrete', lib.shade(P.get('fascia_col', conc), 1.0), scale=3.0 * TS)
            elif kind == 'fence':
                b.facing(q, (-cx, -cy, 0), 'plain', fence_col, scale=FLAT)
            elif kind == 'deck':
                b.facing(q, (0, 0, 1), 'plain', deck_col, scale=FLAT)
            elif kind == 'parapet':
                b.facing(q, (-cx, -cy, 0), 'plain', lk.wall_col, scale=FLAT)
    return rings


def stand_caps(b, B, lk, P, rings):
    """Close the open ends of a sector with the stand cross-section (concrete mass)."""
    if not B.sector:
        return
    col = '#8f8c85'
    for idx, sgn in ((0, -1), (len(B.ts) - 1, 1)):
        t = B.ts[idx]
        ring = rings[idx]
        top = list(ring)
        outer_ground = B.pt(t, 1.0, 0.0)
        inner_ground = B.pt(t, 0.0, 0.0)
        # remove the parapet top duplicate shape: polygon over the profile then back along the ground
        pl = top + [outer_ground, inner_ground]
        tan = B.tangent(t)
        U.poly(b, pl, (tan[0] * sgn, tan[1] * sgn, 0), 'rough-concrete', col)


# --------------------------------------------------------------------------------------------------------------- outer wall
def build_wall(b, B, lk, P, rng):
    ts = B.ts
    ws = P['wall_style']
    det = B.detail
    wall_col = lk.wall_col
    n_ts = len(ts)
    Zt = [B.HD(t)[0] + 1.2 for t in ts]

    def W(i, z, off=0.0, tt=None):
        return B.pt(ts[i] if tt is None else tt, 1.0, z, off)

    def quad(i0, i1, z0, z1, off=0.0, slot='plain-render', col=None, scale=1.0):
        q = [W(i0, z0 if not callable(z0) else z0(i0), off), W(i1, z0 if not callable(z0) else z0(i1), off),
             W(i1, z1 if not callable(z1) else z1(i1), off), W(i0, z1 if not callable(z1) else z1(i0), off)]
        c = (q[0][0] + q[2][0]) / 2
        cy = (q[0][1] + q[2][1]) / 2
        sc = FLAT if slot == 'plain' else scale * (3.0 if det == 0 else 6.0)
        b.facing(q, (c, cy, 0), slot, col or wall_col, scale=sc)

    zt = lambda i: Zt[i]
    zero = lambda i: 0.0
    frac = lambda f: (lambda i: Zt[i] * f)
    sl = lk.wall_slot if ws in ('ribs', 'arcade') else ('metal-cladding' if ws == 'clad' else 'plain-render')
    if det == 2:
        for i in range(n_ts - 1):
            quad(i, i + 1, zero, zt, 0.0, 'plain', wall_col)
        return Zt
    base = lib.shade(wall_col, 0.8)
    if ws in ('ribs', 'arcade'):
        for i in range(n_ts - 1):
            quad(i, i + 1, zero, frac(0.07), 0.0, 'rough-concrete', base)
            quad(i, i + 1, frac(0.07), zt, 0.0, sl, wall_col, scale=1.0)
        if det == 0:
            per = _arc(B, ts)
            ribs = _rib_idx(B, ts, 7.5 if ws == 'ribs' else 9.5)
            for i in ribs:
                t = ts[i]
                p = B.pt(t, 1.0, 0.0, 0.0)
                tan = B.tangent(t)
                yaw = math.atan2(tan[1], tan[0])
                nrm = (tan[1], -tan[0])
                hh = Zt[i] + 0.8
                cx, cy = p[0] + nrm[0] * 0.3, p[1] + nrm[1] * 0.3
                lib.obox(b, cx, cy, 0, 1.0, 1.0, hh, yaw, lk.wall_slot, lk.trim_col, skip=('bottom', 'back'))
            if ws == 'ribs':
                # horizontal window slots between ribs and a cornice band
                for i in range(n_ts - 1):
                    if i in ribs:
                        continue
                    quad(i, i + 1, frac(0.38), frac(0.50), -0.04, 'glass-ribbon', lk.glass_col)
                    quad(i, i + 1, frac(0.72), frac(0.82), -0.04, 'glass-ribbon', lk.glass_col)
                for i in range(n_ts - 1):
                    quad(i, i + 1, lambda k: Zt[k] - 0.7, zt, 0.35, lk.wall_slot, lk.trim_col)
            else:
                # arcade: arch openings in the lower zone
                bay = _rib_idx(B, ts, 9.5)
                for a, c in zip(bay[:-1], bay[1:]):
                    _arch_opening(b, B, ts, a, c, Zt, lk)
                for i in range(n_ts - 1):
                    quad(i, i + 1, frac(0.56), frac(0.66), -0.03, 'glass-ribbon', lk.glass_col)
                    quad(i, i + 1, lambda k: Zt[k] - 0.6, zt, 0.3, lk.wall_slot, lk.trim_col)
        else:
            for i in range(n_ts - 1):
                quad(i, i + 1, frac(0.40), frac(0.62), -0.03, 'glass-ribbon', lk.glass_col)
        return Zt
    if ws == 'clad':
        for i in range(n_ts - 1):
            c2 = wall_col if (i // 2) % 2 == 0 else lib.shade(wall_col, 0.9)
            quad(i, i + 1, zero, frac(0.30), 0.0, 'metal-cladding', lib.shade(wall_col, 0.88))
            quad(i, i + 1, frac(0.30), frac(0.62), -0.1 if det == 0 else 0.0, lk.glass_slot if det == 0 else 'glass-ribbon', lk.glass_col, scale=1.0)
            quad(i, i + 1, frac(0.62), zt, 0.0, 'metal-cladding', c2)
        if det == 0:
            for i in _rib_idx(B, ts, 6.0):
                p = B.pt(ts[i], 1.0, 0.0)
                tan = B.tangent(ts[i])
                nrm = (tan[1], -tan[0])
                lib.obox(b, p[0] + nrm[0] * 0.25, p[1] + nrm[1] * 0.25, 0, 0.45, 0.5, Zt[i], math.atan2(tan[1], tan[0]), 'frame', lk.frame_col, skip=('bottom', 'back'))
            for i in range(n_ts - 1):
                quad(i, i + 1, lambda k: Zt[k] * 0.62 - 0.35, lambda k: Zt[k] * 0.62 + 0.0, 0.25, 'plain', lk.accent_col)
        return Zt
    if ws == 'glass':
        for i in range(n_ts - 1):
            quad(i, i + 1, zero, frac(0.1), 0.0, 'plain-render', base)
            quad(i, i + 1, frac(0.1), frac(0.94), -0.08 if det == 0 else 0.0, lk.glass_slot, lk.glass_col)
            quad(i, i + 1, frac(0.94), zt, 0.0, 'plain-render', lk.trim_col)
        if det == 0:
            for i in _rib_idx(B, ts, 4.5):
                p = B.pt(ts[i], 1.0, 0.0)
                tan = B.tangent(ts[i])
                nrm = (tan[1], -tan[0])
                lib.obox(b, p[0] + nrm[0] * 0.12, p[1] + nrm[1] * 0.12, Zt[i] * 0.1, 0.25, 0.3, Zt[i] * 0.84, math.atan2(tan[1], tan[0]), 'frame', lk.frame_col, skip=('bottom', 'back'))
        return Zt
    if ws == 'towers':
        for i in range(n_ts - 1):
            quad(i, i + 1, zero, frac(0.16), 0.0, 'rough-concrete', base)
            quad(i, i + 1, frac(0.16), frac(0.94), -0.3 if det == 0 else 0.0, lk.glass_slot, lk.glass_col)
            quad(i, i + 1, frac(0.94), zt, 0.0, 'rough-concrete', lk.trim_col)
        gap = 9.5
        for i in _rib_idx(B, ts, gap):
            p = B.pt(ts[i], 1.0, 0.0)
            tan = B.tangent(ts[i])
            nrm = (tan[1], -tan[0])
            yaw = math.atan2(tan[1], tan[0])
            hh = Zt[i] + 5.5
            if det == 0:
                for k, (wd, dp) in enumerate(((3.2, 2.6), (2.6, 2.1))):
                    z0, z1 = (0, hh * 0.55) if k == 0 else (hh * 0.55, hh)
                    lib.obox(b, p[0] + nrm[0] * 0.8, p[1] + nrm[1] * 0.8, z0, wd, dp, z1 - z0, yaw, 'rough-concrete', lk.trim_col, skip=('bottom',), scale=3.0)
            else:
                lib.obox(b, p[0] + nrm[0] * 0.8, p[1] + nrm[1] * 0.8, 0, 3.0, 2.4, hh, yaw, 'rough-concrete', lk.trim_col, skip=('bottom',), scale=8.0)
        return Zt
    # skin: faceted triangular panels
    levels = 5 if det == 0 else 3
    pale = lib.mix(wall_col, '#ffffff', 0.35)
    for k in range(levels - 1):
        for i in range(n_ts - 1):
            half = 0.0
            ta, tb = ts[i], ts[i + 1]
            t_mid = (ta + tb) / 2
            z0 = lambda ii: Zt[ii] * k / (levels - 1)
            z1 = lambda ii: Zt[ii] * (k + 1) / (levels - 1)
            jit = 1.0 + (((i * 7 + k * 13) % 5) - 2) * 0.025
            c1, c2 = lib.shade(pale, jit), lib.shade(pale, 2 - jit if jit > 1 else jit * 0.97)
            # two triangles per cell with the diagonal alternating
            p00, p10, p11, p01 = W(i, z0(i)), W(i + 1, z0(i + 1)), W(i + 1, z1(i + 1)), W(i, z1(i))
            hint = (p00[0] + p11[0], p00[1] + p11[1], 0)
            if (i + k) % 2:
                b.facing([p00, p10, p11], hint, 'plain-render', c1)
                b.facing([p00, p11, p01], hint, 'plain-render', c2)
            else:
                b.facing([p00, p10, p01], hint, 'plain-render', c1)
                b.facing([p10, p11, p01], hint, 'plain-render', c2)
    return Zt


def _arc(B, ts):
    return sum(math.dist(B.pt(ts[i], 1.0, 0)[:2], B.pt(ts[i + 1], 1.0, 0)[:2]) for i in range(len(ts) - 1))


def _rib_idx(B, ts, spacing):
    """Indices into ts spaced about `spacing` metres apart along the outer wall."""
    out = [0]
    acc = 0.0
    for i in range(1, len(ts)):
        acc += math.dist(B.pt(ts[i], 1.0, 0)[:2], B.pt(ts[i - 1], 1.0, 0)[:2])
        if acc >= spacing:
            out.append(i)
            acc = 0.0
    if out[-1] != len(ts) - 1:
        out.append(len(ts) - 1)
    return out


def _arch_opening(b, B, ts, ia, ic, Zt, lk):
    """A dark arched opening centred between ts[ia] and ts[ic] on the outer wall (arcade facade)."""
    tm = (ts[ia] + ts[ic]) / 2
    pc = B.pt(tm, 1.0, 0.0)
    tan = B.tangent(tm)
    nrm = (tan[1], -tan[0])
    wid = min(math.dist(B.pt(ts[ia], 1.0, 0)[:2], B.pt(ts[ic], 1.0, 0)[:2]) * 0.55, 4.2)
    if wid < 1.6:
        return
    h = min(Zt[(ia + ic) // 2] * 0.38, 5.0)
    pts = []
    n = 6
    for k in range(n + 1):
        a = math.pi * k / n
        pts.append((math.cos(a) * wid / 2, h - wid / 2 + math.sin(a) * wid / 2))
    poly = [(-wid / 2, 0.0)] + [(wid / 2, 0.0)] + [(x, z) for (x, z) in pts]
    poly = [(-wid / 2, 0.0), (wid / 2, 0.0)] + [(x, z) for (x, z) in pts]
    world = [(pc[0] + tan[0] * u - nrm[0] * 0.15 + nrm[0] * 0.04, pc[1] + tan[1] * u - nrm[1] * 0.15 + nrm[1] * 0.04, z) for u, z in poly]
    U.poly(b, world, (nrm[0], nrm[1], 0), 'plain', '#2a2c30')
    # frame (pilasters on each side)
    for sgn in (-1, 1):
        px, py = pc[0] + tan[0] * sgn * (wid / 2 + 0.35), pc[1] + tan[1] * sgn * (wid / 2 + 0.35)
        lib.obox(b, px + nrm[0] * 0.15, py + nrm[1] * 0.15, 0, 0.6, 0.5, h + 0.2, math.atan2(tan[1], tan[0]), lk.wall_slot, lk.trim_col, skip=('bottom', 'back'))


# --------------------------------------------------------------------------------------------------------------------- roof
def build_roof(b, B, lk, P, rng, Zt):
    det = B.detail
    ts = B.ts
    mode = 'ring' if P['roofed_all'] else ('canopy' if P['main_cov'] else 'none')
    if mode == 'none':
        return None
    style = P['roof_style']
    roof_col = lk.roof_col
    rm = (P.get('roof_mat') or '')
    slot = {'metal-sheet': 'metal-roof', 'corrugated': 'corrugated', 'clay-tile': 'clay-tile', 'slate': 'slate'}.get(rm, None)
    if slot is None:
        slot = 'roof-flat' if style in ('membrane', 'truss', 'flat') else lk.roof_slot
    under_col = lib.shade(lib.mix(roof_col, '#ffffff', 0.35), 0.95)
    # coverage: indices of ts inside the roofed sector
    idx = []
    for i, t in enumerate(ts):
        wm, wf = B.weights(t)
        if mode == 'ring' or wm > 0.4:
            idx.append(i)
    if len(idx) < 2:
        return None
    # profile per ts
    def prof(i):
        t = ts[i]
        Hs, D = B.HD(t)
        if mode == 'ring':
            f_front = 0.1
            zfront = B.seat_z(t, f_front) + U.clamp(0.5 * Hs + 3.0, 4.0, 8.5)
            zrear = Zt[i] + 3.0
            if style == 'flat':
                zrear = zfront = max(zrear, zfront) + 0.5
        else:
            f_front = 0.26
            zfront = B.seat_z(t, f_front) + U.clamp(0.45 * Hs + 2.2, 3.6, 7.2)
            zrear = max(Zt[i] + 1.8, zfront + 0.6)
            if style == 'flat':
                zfront = zrear = max(zrear, zfront)
        return f_front, zfront, zrear

    amp = 0.0
    spacing = 18.0
    if style == 'membrane':
        amp = 3.2
    cols = 3 if det < 2 else 2
    th = 0.55 if style != 'truss' else 1.1
    if det == 2:
        th = 0.8
    rows_top, rows_under = [], []
    arc_s = 0.0
    prev = None
    for i in idx:
        t = ts[i]
        p = B.pt(t, 1.0, 0.0)
        if prev:
            arc_s += math.dist(prev[:2], p[:2])
        prev = p
        f_front, zf, zr = prof(i)
        bump = 0.0
        if amp:
            bump = amp * (0.5 + 0.5 * math.cos(2 * math.pi * arc_s / spacing)) ** 1.6
        top = []
        # rear (over the outer wall), mid, front
        fr = (1.0 + 0.05, zr + bump)
        ff = (f_front, zf + (bump * 0.15))
        mid_t = 0.5
        sag = 0.0
        if style == 'membrane':
            sag = -1.6 - bump * 0.35
        elif style == 'truss':
            sag = 0.9
        fm = (U.lerp(fr[0], ff[0], mid_t), U.lerp(fr[1], ff[1], mid_t) + sag)
        pts = [fr, fm, ff] if cols == 3 else [fr, ff]
        for (f, z) in pts:
            q = B.pt(t, f, z)
            top.append(q)
        rows_top.append(top)
    # top surface (faces up), underside (faces down)
    U.oriented_grid(b, rows_top, 'up', slot, roof_col, smooth_=False, scale=2.0)
    if det < 2:
        under = [[(p[0], p[1], p[2] - th) for p in row] for row in rows_top]
        U.oriented_grid(b, under, 'down', 'plain-render', under_col, smooth_=False, scale=3.0)
        # front (inner) fascia and rear fascia
        for a, c in zip(rows_top[:-1], rows_top[1:]):
            q = [(a[-1][0], a[-1][1], a[-1][2] - th), (c[-1][0], c[-1][1], c[-1][2] - th), c[-1], a[-1]]
            b.facing(q, (-(a[-1][0]), -(a[-1][1]), 0), 'plain-render', lk.trim_col)
            q = [(a[0][0], a[0][1], a[0][2] - th), (c[0][0], c[0][1], c[0][2] - th), c[0], a[0]]
            b.facing(q, (a[0][0], a[0][1], 0), 'plain-render', lk.trim_col)
    # side ends of a partial roof
    ends = []
    if mode == 'canopy' or B.sector:
        ends = [(0, -1), (len(rows_top) - 1, 1)]
    if B.sector and mode == 'ring':
        ends = [(0, -1), (len(rows_top) - 1, 1)]
    if mode == 'canopy' and not B.sector:
        ends = [(0, -1), (len(rows_top) - 1, 1)]
    for r, sgn in ends:
        row = rows_top[r]
        tan = B.tangent(ts[idx[r]])
        ring = list(row) + [(p[0], p[1], p[2] - th) for p in row[::-1]]
        U.poly(b, ring, (tan[0] * sgn, tan[1] * sgn, 0), 'plain-render', lk.trim_col)
    # structure: radial ribs under the roof, masts and stays
    if det == 0:
        step = 3 if style in ('truss', 'membrane') else 4
        for r in range(0, len(rows_top), step):
            row = rows_top[r]
            for a, c in zip(row[:-1], row[1:]):
                U.strut(b, (a[0], a[1], a[2] - th - 0.05), (c[0], c[1], c[2] - th - 0.05), 0.28, '#6e7378', ends=False)
        if style in ('truss', 'membrane') and len(rows_top) > 1:
            # inner compression ring
            for a, c in zip(rows_top[:-1], rows_top[1:]):
                U.strut(b, (a[-1][0], a[-1][1], a[-1][2] - th), (c[-1][0], c[-1][1], c[-1][2] - th), 0.55, '#8a9096', ends=False)
    if style == 'membrane' and det < 2:
        arc_s = 0.0
        prev = None
        for r, i in enumerate(idx):
            t = ts[i]
            p = B.pt(t, 1.0, 0.0)
            if prev:
                arc_s += math.dist(prev[:2], p[:2])
            prev = p
            ph = (arc_s % spacing) / spacing
            if ph < 0.5 / max(1, len(idx)) * (spacing / 4.0) and True:
                pass
        # masts at the bump peaks
        arc_s = 0.0
        prev = None
        last_peak = -99.0
        for r, i in enumerate(idx):
            t = ts[i]
            p = B.pt(t, 1.0, 0.0)
            if prev:
                arc_s += math.dist(prev[:2], p[:2])
            prev = p
            if abs((arc_s % spacing) / spacing) < 0.075 or (arc_s % spacing) / spacing > 0.925:
                if arc_s - last_peak < spacing * 0.6:
                    continue
                last_peak = arc_s
                row = rows_top[r]
                base = B.pt(t, 1.04, 0.0)
                topz = row[0][2] + 7.5
                tan = B.tangent(t)
                U.strut(b, (base[0], base[1], 0.0), (base[0], base[1], topz), 0.8, '#d4d8dc', ends=True)
                if det == 0:
                    inner = row[-1]
                    U.cable(b, (base[0], base[1], topz), (inner[0], inner[1], inner[2]), '#4a4f55', 0.14)
                    for sg in (-1, 1):
                        q = B.pt(t + sg * 0.05, 1.0, 0.0)
                        U.cable(b, (base[0], base[1], topz), (q[0], q[1], rows_top[max(0, min(len(rows_top) - 1, r + sg * 2))][0][2]), '#4a4f55', 0.12)
    # roof-edge floodlight bars
    if det < 2 and (mode == 'ring') and 'floodlights' in P['fe']:
        for r in range(0, len(rows_top), 2):
            q = rows_top[r][-1]
            t = ts[idx[r]]
            tan = B.tangent(t)
            lib.obox(b, q[0], q[1], q[2] + 0.1, 2.6, 0.5, 0.7, math.atan2(tan[1], tan[0]), 'plain', '#f1eed8', skip=('bottom',))
    return {'idx': idx, 'rows': rows_top, 'mode': mode}


# -------------------------------------------------------------------------------------------------------- pitch and track
def rr_points(cx, cy, hl, hw, r, n_arc):
    """A stadium-shaped (rounded-rect) outline, counter-clockwise: half-length hl, half-width hw, end radius r."""
    pts = []
    r = min(r, hw, hl)
    corners = [(hl - r, -hw + r, -90), (hl - r, hw - r, 0), (-hl + r, hw - r, 90), (-hl + r, -hw + r, 180)]
    for (ccx, ccy, a0) in corners:
        for k in range(n_arc + 1):
            a = math.radians(a0 + 90.0 * k / n_arc)
            pts.append((cx + ccx + r * math.cos(a), cy + ccy + r * math.sin(a)))
    return pts


def build_ground(b, B, lk, P, rng):
    """Pitch, track and markings (site layer). A sector clips them to the visible x range and a short strip of pitch."""
    if B.detail >= 2:
        return
    z = 0.04
    if B.sector:
        clip = (-1e9, 0.0, -1e9, 0.0)
    else:
        clip = None

    def fill(pts, zz, col, slot='plain', scale=FLAT, hint=(0, 0, 1)):
        pl = [(p[0], p[1]) for p in pts]
        if clip:
            pl = U.clip_rect(pl, *clip)
        if len(pl) < 3:
            return
        U.poly(b, [(p[0], p[1], zz) for p in pl], hint, slot, col, scale=scale)

    def line(a, c, zz, w, col):
        dx, dy = c[0] - a[0], c[1] - a[1]
        L = math.hypot(dx, dy)
        if L < 1e-3:
            return
        nx, ny = -dy / L * w, dx / L * w
        fill([(a[0] - nx, a[1] - ny), (c[0] - nx, c[1] - ny), (c[0] + nx, c[1] + ny), (a[0] + nx, a[1] + ny)], zz, col)

    with b.site():
        hx, hy = B.A_in - 1.5, B.B_in - 1.0
        n_arc = 7 if B.detail == 0 else 3
        if B.track:
            tw = B.tw
            outer = rr_points(0, 0, hx, hy, hy, n_arc)
            inner = rr_points(0, 0, hx - tw, hy - tw, hy - tw, n_arc)
            track_col = '#b4553d'
            N = len(outer)
            for i in range(N):
                j = (i + 1) % N
                fill([outer[i], outer[j], inner[j], inner[i]], z + 0.03, track_col)
            if B.detail == 0:
                for frac in (0.34, 0.67):
                    ring = rr_points(0, 0, hx - tw * frac, hy - tw * frac, hy - tw * frac, n_arc)
                    for i in range(len(ring)):
                        line(ring[i], ring[(i + 1) % len(ring)], z + 0.07, 0.06, '#efece4')
            fill(rr_points(0, 0, hx - tw, hy - tw, hy - tw, n_arc), z + 0.06, '#5d9a45', 'grass', 2.0)
        else:
            fill(rr_points(0, 0, hx, hy, hy * 0.6, n_arc), z, '#b7a98c', 'plain')
        px, py = B.px, B.py
        stripes = 8 if B.detail == 0 else 1
        for k in range(stripes):
            xa = -px + 2 * px * k / stripes
            xb = -px + 2 * px * (k + 1) / stripes
            col = '#58953f' if k % 2 else '#62a048'
            fill([(xa, -py), (xb, -py), (xb, py), (xa, py)], z + 0.1, col, 'grass', 2.0)
        if B.detail == 0:
            lc = '#f4f2ea'
            for (a, c) in (((-px, -py), (px, -py)), ((-px, py), (px, py)), ((-px, -py), (-px, py)), ((px, -py), (px, py)), ((0, -py), (0, py))):
                line(a, c, z + 0.15, 0.07, lc)
            sc = py / 34.0
            for sx in (-1, 1):
                bx0, bx1 = sx * px, sx * (px - 16.5 * sc)
                yb = 20.15 * sc
                for (a, c) in (((bx0, -yb), (bx1, -yb)), ((bx0, yb), (bx1, yb)), ((bx1, -yb), (bx1, yb))):
                    line(a, c, z + 0.15, 0.07, lc)
            for sx in (-1, 1):
                gx = sx * px
                if B.sector and (gx > 0 or (not B.has_end and gx < B.xl)):
                    continue
                for sy in (-1, 1):
                    lib.cylinder(b, gx, sy * 3.66, 0, 2.44, 0.06, n=4, slot='plain', col='#f4f2ea', top=True)
                U.strut(b, (gx, -3.66, 2.44), (gx, 3.66, 2.44), 0.1, '#f4f2ea', slot='plain', ends=False)


# ------------------------------------------------------------------------------------------------------- masts and furniture
def build_lights(b, B, lk, P, rng, wall_top):
    fe = P['fe']
    if P['roofed_all']:
        return
    if 'floodlights' not in fe and B.Hm <= 8:
        return
    cnt = fe.get('floodlights', {}).get('count', 4)
    hm = U.clamp(B.Hm + 24, 30, 46)
    corners = [math.pi * 0.25, math.pi * 0.75, math.pi * 1.25, math.pi * 1.75][:max(2, min(4, cnt))]
    for t in corners:
        if B.sector and not (B.t0 <= t <= B.t1):
            continue
        p = B.pt(t, 1.0, 0.0, 5.5)
        yaw = math.atan2(-p[1], -p[0]) + math.pi / 2
        U.lattice_mast(b, p[0], p[1], hm, yaw=yaw)
    if B.sector and not any(B.t0 <= t <= B.t1 for t in corners):
        p = B.pt(B.t0, 1.0, 0.0, 5.5)
        U.lattice_mast(b, p[0], p[1], hm, yaw=0.0)


def build_scoreboard(b, B, lk, P, rng):
    if 'scoreboard' not in P['fe'] or B.detail >= 2:
        return
    if B.sector and not B.has_end:
        return
    # on top of the left end stand, facing the pitch
    t = math.pi
    Hs, D = B.HD(t)
    p = B.pt(t, 0.9, Hs + 0.2)
    z0 = Hs + 0.3
    yc = -6.0 if B.sector else 0.0
    lib.obox(b, p[0] - 0.6, yc, z0 + 2.2, 0.7, 12.0, 5.0, 0.0, 'plain', '#2a2d31', skip=('bottom',))
    q = [(p[0], yc - 5.4, z0 + 2.6), (p[0], yc + 5.4, z0 + 2.6), (p[0], yc + 5.4, z0 + 6.4), (p[0], yc - 5.4, z0 + 6.4)]
    if B.detail == 0:
        b.facing(q, (1, 0, 0), 'glass-ribbon', '#cfd8e0')
    for sy in (-4.5, 4.5):
        lib.cylinder(b, p[0] - 0.6, yc + sy, z0, z0 + 2.4, 0.18, n=4, slot='frame', col='#5a5f65', top=False)


def build_entrance(b, B, lk, P, rng, Zt, y_front):
    """Main entrance on the front: porch/portal, steps, flag row."""
    fe = P['fe']
    det = B.detail
    xe = B.xl * 0.5 if B.sector else 0.0
    ci = len(B.ts) // 2
    yw = B.pt(math.atan2(0, 1) + 1.5 * math.pi, 1.0, 0.0)[1] if not B.sector else _y_at_x(B, xe)
    if 'steps' in fe or 'gate' in fe or P['wall_style'] in ('towers', 'glass', 'skin', 'clad'):
        wpor = 22.0 if P['wall_style'] in ('glass', 'towers', 'skin') else 16.0
        hp = min(7.0, Zt[ci] * 0.5)
        depth = 5.0
        lib.box(b, xe - wpor / 2, yw - depth, 0, xe + wpor / 2, yw + 0.5, hp, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom', 'back'))
        if det < 2:
            if P['wall_style'] in ('glass', 'skin', 'towers', 'clad'):
                lib.box(b, xe - wpor / 2 + 1.5, yw - depth - 0.05, 0.4, xe + wpor / 2 - 1.5, yw - depth + 0.02, hp - 0.8, lk.glass_slot, lk.glass_col, skip=('bottom', 'back', 'top', 'left', 'right'))
            for sx in (-1, 1):
                lib.cylinder(b, xe + sx * (wpor / 2 - 0.6), yw - depth + 0.7, 0, hp, 0.35, n=6 if det == 0 else 4, slot=lk.wall_slot, col=lk.trim_col, top=False)
        with b.site():
            n_st = 5 if det == 0 else 2
            lib.steps(b, xe - wpor / 2 - 2.0, xe + wpor / 2 + 2.0, yw - depth, 0.8, 2.5, n_st, 'paving', lk.stone_col)
    if 'flags' in fe and det < 2:
        k = max(4, min(10, fe['flags']['count']))
        cols = P.get('flag_cols') or ['#1f7a4d', '#f2f2ee', '#c0392b', '#2f5fa0', '#d9a21c', '#222222']
        with b.site():
            x0, x1 = (B.xl + 6, -6) if B.sector else (-min(46.0, B.w / 2), min(46.0, B.w / 2))
            for q in range(k):
                x = x0 + (x1 - x0) * q / max(1, k - 1)
                U.flag(b, x, B.pt(1.5 * math.pi, 1.0, 0.0)[1] - 15.5, 12.0, cols[q % len(cols)], col2=cols[(q + 1) % len(cols)], yaw=0.0)


def _y_at_x(B, x):
    """Outer-wall y at a given x (front, t in the sampled arc), nearest sample."""
    best = None
    for t in B.ts:
        p = B.pt(t, 1.0, 0.0)
        if best is None or abs(p[0] - x) < abs(best[0] - x):
            best = p
    return best[1]


def build_site(b, B, lk, P, rng, y_front, Zt):
    fe = P['fe']
    det = B.detail
    srng = random.Random(P['srng_seed'] ^ 0x9e37)
    x0, x1 = B.cx0, B.cx1
    pad_w = x1 - x0
    xm = (x0 + x1) / 2
    depth_front = 34.0
    kind = lk.forecourt if lk.forecourt not in (None, 'none') else 'plaza'
    if 'car-park' in fe:
        kind = 'parking'
    yb = y_front if not B.sector else min(B.pt(t, 1.0, 0.0)[1] for t in (B.t0, B.t1))
    y0 = y_front - depth_front
    y1 = (B.d / 2 + 12.0) if not B.sector else 6.0
    # the wall faces the front; for a sector the pad runs over the whole footprint of the quarter
    with b.site():
        pc = lib.mix(lk.ground_col, '#a8a49a', 0.5) if lk.ground_slot != 'paving' else None
        lib.ground(b, x0, y0 - 2, x1, y1, lk, 'paving', pc, z=0.0, scale=3.0)
        if det == 0:
            lib.forecourt(b, kind if kind in ('parking', 'plaza', 'garden', 'road') else 'plaza', x0 + 3, y0, x1 - 3, y_front - 10.0, lk, srng, density=0.5, tree_h=9.0)
    if ('fence-wall' in fe or 'gate' in fe) and det < 2:
        yw = y0 - 0.5
        gate_w = 9.0
        gx = xm
        for a, c in ((x0 + 1, gx - gate_w / 2), (gx + gate_w / 2, x1 - 1)):
            U.wall_run(b, (a, yw), (c, yw), 2.4, 0.4, lk.wall_slot, lk.wall_col, cap_col=lk.trim_col, pier_every=6.0, pier_h=2.9, pier_w=0.7)
        if 'gate' in fe:
            for sx in (-1, 1):
                lib.box_c(b, gx + sx * (gate_w / 2 + 0.4), yw, 0, 1.6, 1.0, 4.2, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.trim_col)
            lib.box(b, gx - gate_w / 2 - 0.4, yw - 0.45, 4.2, gx + gate_w / 2 + 0.4, yw + 0.45, 5.2, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.trim_col, skip=('bottom',))
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, x0 + pad_w * 0.2, y0 + 4.0, 0.0, 8.0, 3.0, lk, 0.0, col=P['seat_a'])
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for k in range(6 if det == 0 else 3):
                x = srng.uniform(x0 + 4, x1 - 4)
                y = srng.uniform(y0 + 3, y_front - 8)
                lib.tree(b, lk.tree, x, y, srng.uniform(7, 10.5), srng, lk)


# ---------------------------------------------------------------------------------------------------------------- build bowl
def build_bowl(b, brief, lk, P, rng):
    B = Bowl(brief, lk, P, b.detail)
    b.section('stands')
    rings = build_stands(b, B, lk, P, rng)
    stand_caps(b, B, lk, P, rings)
    b.section('wall')
    Zt = build_wall(b, B, lk, P, rng)
    b.section('roof')
    P['roof_mat'] = (brief.get('facade') or {}).get('roofMaterial') or ''
    build_roof(b, B, lk, P, rng, Zt)
    b.section('ground')
    build_ground(b, B, lk, P, rng)
    b.section('lights')
    build_lights(b, B, lk, P, rng, Zt)
    build_scoreboard(b, B, lk, P, rng)
    y_front = B.pt(1.5 * math.pi, 1.0, 0.0)[1]
    b.section('entrance')
    build_entrance(b, B, lk, P, rng, Zt, y_front)
    b.section('site')
    build_site(b, B, lk, P, rng, y_front, Zt)
    return B


# ------------------------------------------------------------------------------------------------------------------ grounds
class Stub:
    """Just enough of a Bowl for build_ground (a pitch with a hard-standing surround, no track, no clipping)."""

    def __init__(self, detail, px, py, A_in, B_in):
        self.detail, self.px, self.py, self.A_in, self.B_in = detail, px, py, A_in, B_in
        self.track, self.sector, self.tw, self.has_end, self.xl = False, False, 0.0, True, -1e9


def stand_block(b, lk, P, fr, L, depth, Hs, roofed, rear_kind, seat_cols, rng, outward, storeys=1, accent=None):
    """One straight stand in local coordinates (u along the length centred on 0, v outward from the pitch edge): raked seating,
    rear facade, end sections and an optional cantilever shed roof. fr = U.Local frame whose +v is `outward`."""
    det = b.detail
    P_ = lambda u, v, z: fr.P(u, v, z)
    Dr = depth * 0.82
    K = (4 if ECON else 7) if det == 0 else 1
    prof = [(0.0, 0.0), (0.0, 1.0)]
    for r in range(K):
        v0, v1 = Dr * r / K, Dr * (r + 1) / K
        z1 = 1.0 + (Hs - 1.0) * (r + 1) / K
        if K > 1:
            prof += [(v0, z1), (v1, z1)]
        else:
            prof.append((Dr, Hs))
    prof.append((depth, Hs))
    prof.append((depth, Hs + 1.0))
    top = Hs + 1.0
    nseg = max(2, int(L / ((7.0 if ECON else 5.0) if det == 0 else 14.0)))
    outn = fr.D(0, 1, 0)
    inn = (-outn[0], -outn[1], 0.0)
    wcol = lk.wall_col
    # raked surfaces, quad per block along u (alternating seat colours)
    for i in range(nseg):
        u0, u1 = -L / 2 + L * i / nseg, -L / 2 + L * (i + 1) / nseg
        for j in range(1, len(prof)):
            (va, za), (vb, zb) = prof[j - 1], prof[j]
            q = [P_(u0, va, za), P_(u1, va, za), P_(u1, vb, zb), P_(u0, vb, zb)]
            if abs(vb - va) < 1e-6 and zb > za:      # riser / wall facing the pitch
                if va >= depth - 1e-6:
                    b.facing(q, inn, 'plain', lib.shade(wcol, 0.9), scale=FLAT)
                else:
                    b.facing(q, inn, 'plain', '#a9a69e' if va > 0 else lib.mix(seat_cols[0], '#222222', 0.6), scale=FLAT)
            elif zb > za or vb > va:
                if abs(zb - za) < 1e-6 and vb >= Dr:
                    b.facing(q, (0, 0, 1), 'plain', '#c4c0b6', scale=FLAT)
                else:
                    blk = (i // 2) % 2
                    b.facing(q, (0, 0, 1), 'plain', seat_cols[blk], scale=FLAT)
    # end sections
    for sgn in (-1, 1):
        u = sgn * L / 2
        pl = [P_(u, v, z) for v, z in prof] + [P_(u, depth, 0.0), P_(u, 0.0, 0.0)]
        t = fr.D(sgn, 0, 0)
        U.poly(b, pl, t, 'plain', '#8f8c85', scale=FLAT)
    # rear facade
    p0, p1 = P_(-L / 2, depth, 0), P_(L / 2, depth, 0)
    seg = lib.Seg((p0[0], p0[1]), (p1[0], p1[1]))
    if seg.n[0] * outn[0] + seg.n[1] * outn[1] < 0:
        seg = lib.Seg((p1[0], p1[1]), (p0[0], p0[1]))
    zw = top + (2.5 if roofed else 0.0)
    kind = rear_kind if rear_kind in ('ribbon', 'punched', 'curtain', 'none') else 'ribbon'
    lib.facade(b, seg, 0.0, zw, max(1, storeys), lk, kind, 0.4, rng, reduced=(det > 0 or kind == 'none' or ECON or L > 70))
    if det == 0 and accent is not None:
        lib.seg_box(b, seg, 0, seg.length, 0, min(3.2, zw * 0.35), 0.07, accent[1], accent[0])
    # parapet / top deck cap on the rear
    if roofed:
        zr_back = Hs + 3.6
        vf = Dr * 0.28
        zf = 1.0 + (Hs - 1.0) * (vf / Dr) + 3.4
        zr = max(zr_back, zf + 1.1)
        thick = 0.55 if det < 2 else 0.8
        v_front, v_back = vf, depth + 1.0
        # top and underside
        for i in range(nseg):
            u0, u1 = -L / 2 + L * i / nseg, -L / 2 + L * (i + 1) / nseg
            for (ua, ub) in ((u0, u1),):
                qt = [P_(ua, v_front, zf), P_(ub, v_front, zf), P_(ub, v_back, zr), P_(ua, v_back, zr)]
                b.facing(qt, (0, 0, 1), P.get('roof_slot', 'metal-roof'), lk.roof_col, scale=2.0)
                if det < 2:
                    qb = [(q[0], q[1], q[2] - thick) for q in qt]
                    b.facing(qb, (0, 0, -1), 'plain', lib.shade(lk.roof_col, 0.75), scale=FLAT)
        if det < 2:
            q = [P_(-L / 2, v_front, zf - thick), P_(L / 2, v_front, zf - thick), P_(L / 2, v_front, zf), P_(-L / 2, v_front, zf)]
            b.facing(q, inn, 'plain', lk.trim_col, scale=FLAT)
            q = [P_(-L / 2, v_back, zr - thick), P_(L / 2, v_back, zr - thick), P_(L / 2, v_back, zr), P_(-L / 2, v_back, zr)]
            b.facing(q, outn, 'plain', lk.trim_col, scale=FLAT)
        for sgn in (-1, 1):
            u = sgn * L / 2
            pl = [P_(u, v_front, zf), P_(u, v_back, zr), P_(u, v_back, zr - thick), P_(u, v_front, zf - thick)]
            b.facing(pl, fr.D(sgn, 0, 0), 'plain', lk.trim_col, scale=FLAT)
        if det == 0:
            # rear raking props every ~10 m
            n = max(2, int(L / 10.0))
            for k in range(n + 1):
                u = -L / 2 + L * k / n
                U.strut(b, P_(u, depth + 3.2, 0.0), P_(u, depth + 0.6, zr - thick), 0.4, '#9ea3a8')
    return top


def build_grounds(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['srng_seed'])
    W = U.clamp(P['w'], 92.0, 118.0)
    Dd = U.clamp(P['d'], 74.0, 96.0)
    H = P['H']
    small = H <= 11 or U.has(tx, 'non-league', 'small')
    Hm = U.clamp(H * (0.85 if not small else 0.9), 7.0, 22.0)
    Dm = 15.0 + 0.4 * (Hm - 7.0)
    Df = 11.0 + 0.2 * (Hm - 7.0)
    De = 10.0
    px = U.clamp(W / 2 - De - 3.0, 36.0, 52.0)
    py = U.clamp((Dd - Dm - Df) / 2 - 3.0, 22.0, 34.0)
    W = 2 * (px + 3.0 + De)
    Dd = 2 * (py + 3.0) + Dm + Df
    roofed_all = P['main_cov'] or 'stand-roof' in fe
    cols = lk.accent_col, lib.mix(lk.accent_col, '#ffffff', 0.5)
    acc = list((brief.get('facade') or {}).get('colours') or [])
    seat = P['seat_a']
    seat_cols = [seat, P['seat_b']]
    rm = (brief.get('facade') or {}).get('roofMaterial')
    P['roof_slot'] = {'metal-sheet': 'metal-roof', 'corrugated': 'corrugated', 'clay-tile': 'clay-tile', 'slate': 'slate'}.get(rm, 'metal-roof')
    windows = (brief.get('facade') or {}).get('windows') or 'ribbon'
    rear_main = windows if windows in ('ribbon', 'punched', 'curtain', 'louvre', 'screen') else ('ribbon' if not small else 'punched')
    accent_pair = (lk.accent_slot, lk.accent_col) if (brief.get('facade') or {}).get('accent') and lk.accent_slot != lk.wall_slot else None
    y_m, y_f = -(py + 3.0), (py + 3.0)
    x_e = px + 3.0
    b.section('stands')
    Hf = Hm * (0.78 if not small else 0.5)
    He = Hm * (0.62 if not small else 0.42)
    # main stand (front)
    stand_block(b, lk, P, U.Local(0, y_m, math.pi), W, Dm, Hm, True, rear_main, seat_cols, rng, (0, -1), storeys=2 if Hm > 12 else 1, accent=accent_pair)
    # far stand
    far_roof = roofed_all and not small
    stand_block(b, lk, P, U.Local(0, y_f, 0.0), W, Df, Hf, far_roof, 'ribbon' if far_roof else 'none', seat_cols, rng, (0, 1), storeys=1, accent=accent_pair)
    # end stands (between main and far stand pitch edges)
    Le = y_f - y_m
    stand_block(b, lk, P, U.Local(x_e, (y_f + y_m) / 2, -math.pi / 2), Le, De, He, False, 'none', seat_cols, rng, (1, 0), accent=accent_pair)
    stand_block(b, lk, P, U.Local(-x_e, (y_f + y_m) / 2, math.pi / 2), Le, De, He * 0.9, False, 'none', seat_cols, rng, (-1, 0), accent=accent_pair)
    b.section('ground')
    build_ground(b, Stub(det, px, py, px + 3, py + 3), lk, P, rng)
    b.section('lights')
    if 'floodlights' in fe or True:
        for sx in (-1, 1):
            for sy in (-1, 1):
                U.lattice_mast(b, sx * (W / 2 + 4.0), sy * (Dd / 2 + 4.0), 27.0 if Hm < 14 else 33.0, yaw=0.0)
    b.section('site')
    pad = (-W / 2 - 14, -Dd / 2 - 34, W / 2 + 14, Dd / 2 + 14)
    with b.site():
        pc = lib.mix(lk.ground_col, '#a8a49a', 0.5) if lk.ground_slot != 'paving' else None
        lib.ground(b, pad[0], pad[1], pad[2], pad[3], lk, 'paving', pc, z=0.0, scale=3.0)
        if det == 0:
            lib.forecourt(b, 'parking' if 'car-park' in fe else (lk.forecourt if lk.forecourt in ('plaza', 'garden', 'road') else 'plaza'), pad[0] + 3, pad[1], pad[2] - 3, -Dd / 2 - 8.0, lk, srng, density=0.5, tree_h=9.0)
    if det < 2 and ('fence-wall' in fe or 'gate' in fe):
        yw = pad[1] + 1.0
        for a, c in ((pad[0] + 1, -5.0), (5.0, pad[2] - 1)):
            U.wall_run(b, (a, yw), (c, yw), 2.2, 0.4, lk.wall_slot, lk.wall_col, cap_col=lk.trim_col, pier_every=6.0, pier_h=2.7, pier_w=0.7)
    if 'flags' in fe and det < 2:
        with b.site():
            for k in range(5):
                U.flag(b, -24 + 12 * k, y_m - Dm - 6.0, 12.0, [seat, '#f2f2ee', lk.accent_col][k % 3], col2='#f2f2ee')
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, W * 0.3, y_m - Dm - 8.0, 0.0, 8.0, 3.0, lk, 0.0, col=P['seat_a'])
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for k in range(5 if det == 0 else 2):
                lib.tree(b, lk.tree, srng.uniform(pad[0] + 4, pad[2] - 4), srng.uniform(pad[1] + 3, y_m - Dm - 10), srng.uniform(7, 10), srng, lk)


# ---------------------------------------------------------------------------------------------------------------------- hall
def _barrel_oval(b, hl, hw, z, rise, lk, n_t, n_k, col, slot):
    """A barrel (cylindrical) roof over an elliptical plan, axis along x: grid rows by angle, columns from rim to centreline."""
    rows = []
    for i in range(n_t + 1):
        t = 2 * math.pi * i / n_t
        row = []
        for k in range(n_k + 1):
            f = 1.0 - k / n_k
            x, y = hl * f * math.cos(t), hw * f * math.sin(t)
            zz = z + rise * (1 - (y / hw) ** 2) ** 0.5 if hw > 0 else z
            row.append((x, y, zz))
        rows.append(row)
    U.oriented_grid(b, rows, 'up', slot, col, smooth_=True, scale=3.0)


def build_hall(b, brief, lk, P, rng):
    det = b.detail
    fe, tx = P['fe'], P['tx']
    srng = random.Random(P['srng_seed'])
    form = brief.get('form') or {}
    w, d, H = P['w'], P['d'], U.clamp(P['H'], 8.0, 30.0)
    big = max(w, d)
    f = min(1.0, 104.0 / big)
    w, d = max(26.0, w * f), max(22.0, d * f)
    oval = P['fp'] in ('oval', 'round') or U.has(tx, 'velodrome', 'oval')
    roof = P['roof_decl'] if P['roof_decl'] not in ('none', '', None) else ('barrel' if U.has(tx, 'barrel') else 'shed')
    rm = (brief.get('facade') or {}).get('roofMaterial')
    roof_slot = {'metal-sheet': 'metal-roof', 'corrugated': 'corrugated', 'clay-tile': 'clay-tile', 'slate': 'slate', 'concrete': 'roof-flat', 'membrane': 'roof-flat'}.get(rm, 'metal-roof')
    wall_h = H * (0.72 if roof == 'barrel' else 0.9)
    rise = H - wall_h
    fp = lib.fp_oval(w, d, {0: 36, 1: 20, 2: 12}[det]) if oval else lib.fp_rect(w, d)
    b.section('walls')
    clere = (brief.get('facade') or {}).get('windows', 'none')
    lib.walls(b, fp, 0.0, wall_h, 2 if wall_h > 9 else 1, lk, srng, kind='none', plinth=0.5, rear='plain')
    if det < 2:
        # clerestory band under the eaves, and a lower window band at the front
        for seg in fp.edges(min_len=2.0):
            L = seg.length
            if det == 0 and L > 3:
                zc0, zc1 = wall_h - 3.4, wall_h - 1.3
                b.face([seg.P(0.8, zc0, -0.1), seg.P(L - 0.8, zc0, -0.1), seg.P(L - 0.8, zc1, -0.1), seg.P(0.8, zc1, -0.1)], 'glass-ribbon', lk.glass_col)
                n = max(1, int(L / 5.0))
                for k in range(n + 1):
                    u = 0.8 + (L - 1.6) * k / n
                    lib.seg_box(b, seg, u - 0.12, u + 0.12, zc0 - 0.1, zc1 + 0.1, 0.12, lk.frame_col, 'frame', inset=0.1)
            if seg.front and clere in ('ribbon', 'punched', 'curtain') and det == 0 and L > 6:
                b.face([seg.P(1.5, 1.4, -0.08), seg.P(L - 1.5, 1.4, -0.08), seg.P(L - 1.5, 4.0, -0.08), seg.P(1.5, 4.0, -0.08)], 'glass-ribbon', lk.glass_col)
        if det == 0:
            lib.cornice(b, fp, wall_h - 0.2, 0.3, 0.3, lk)
    b.section('roof')
    rect = (-w / 2, -d / 2, w / 2, d / 2)
    if oval:
        if roof in ('barrel', 'curved', 'shed', 'gable'):
            _barrel_oval(b, w / 2 + 0.3, d / 2 + 0.3, wall_h, rise, lk, {0: 32, 1: 16, 2: 10}[det], 4 if det == 0 else 2, lk.roof_col, roof_slot)
            if det == 0:
                for k in range(0, 16):
                    t = 2 * math.pi * k / 16
                    if abs(math.sin(t)) < 0.98:
                        pass
        else:
            lib.flat_roof(b, fp, wall_h, lk, parapet_h=0.8)
    else:
        if roof == 'barrel':
            lib.barrel(b, rect, wall_h, rise, lk, axis='x' if w >= d else 'y', ov=0.3, slot=roof_slot, col=lk.roof_col, pointed=False)
            if det == 0:
                nr = max(3, int(w / 9.0))
                for k in range(nr + 1):
                    xk = -w / 2 + w * k / nr
                    R = (d * d / 4 + rise * rise) / (2 * rise)
                    prev = None
                    for j in range(7):
                        a0 = math.asin(min(1.0, d / 2 / R))
                        tt = -a0 + 2 * a0 * j / 6
                        pt = (xk, R * math.sin(tt), wall_h - (R - rise) + R * math.cos(tt) + 0.08)
                        if prev:
                            U.strut(b, prev, pt, 0.32, lk.trim_col, ends=False)
                        prev = pt
        elif roof == 'shed':
            lib.shed(b, rect, wall_h, max(2.0, rise + 1.5), lk, high='back', ov=0.5, slot=roof_slot, col=lk.roof_col)
        elif roof in ('gable', 'hip'):
            lib.roof(b, roof, rect, wall_h, lk, rise=max(rise, 3.0), ov=0.5)
        else:
            lib.flat_roof(b, fp, wall_h, lk, parapet_h=1.0)
    # entrance annex on the front
    b.section('entrance')
    aw = min(26.0, w * 0.42)
    ah = min(7.0, wall_h * 0.62)
    ad = 6.5
    yf = -d / 2 if not oval else -d / 2 * 0.92
    lib.box(b, -aw / 2, yf - ad, 0, aw / 2, yf + 0.6, ah, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom', 'back'))
    if det < 2:
        lib.box(b, -aw / 2 + 1.5, yf - ad - 0.04, 0.3, aw / 2 - 1.5, yf - ad + 0.02, ah - 0.9, lk.glass_slot, lk.glass_col, skip=('bottom', 'back', 'top', 'left', 'right'))
        lib.canopy_flat(b, -aw / 2 - 1.5, yf - ad - 3.5, aw / 2 + 1.5, yf - ad, ah + 0.5, lk, th=0.45, columns=4 if aw > 18 else 2, col=lk.roof_col, edge_col=lk.accent_col, r=0.24)
    with b.site():
        lib.steps(b, -aw / 2 - 1.5, aw / 2 + 1.5, yf - ad - 3.5, 0.6, 2.0, 4 if det == 0 else 2, 'paving', lk.stone_col)
    # lower side annex (changing rooms / offices)
    if not oval and w > 40 and det < 2 or (oval and False):
        sx = 1 if srng.random() < 0.5 else -1
        lib.box(b, sx * w / 2 - (0 if sx > 0 else 0) + (0 if sx > 0 else -11.0), -d / 2 * 0.35, 0, sx * w / 2 + (11.0 if sx > 0 else 0), d / 2 * 0.55, 4.6, lk.wall_slot, lk.accent_col, top_slot='roof-flat', top_col=lk.roof_col, skip=('bottom',))
    b.section('site')
    pad = (-max(w, 60) / 2 - 12, -d / 2 - 34, max(w, 60) / 2 + 12, d / 2 + 12)
    with b.site():
        pc = lib.mix(lk.ground_col, '#a8a49a', 0.5) if lk.ground_slot != 'paving' else None
        lib.ground(b, pad[0], pad[1], pad[2], pad[3], lk, 'paving', pc, z=0.0, scale=3.0)
        if det == 0:
            lib.forecourt(b, 'parking' if ('car-park' in fe or lk.forecourt in ('parking', 'none')) else (lk.forecourt if lk.forecourt in ('plaza', 'garden', 'road') else 'parking'), pad[0] + 3, pad[1], pad[2] - 3, yf - ad - 10.0, lk, srng, density=0.5, tree_h=9.0)
    if det < 2 and ('fence-wall' in fe or 'gate' in fe):
        yw = pad[1] + 1.0
        for a, c in ((pad[0] + 1, -4.5), (4.5, pad[2] - 1)):
            U.wall_run(b, (a, yw), (c, yw), 2.2, 0.4, lk.wall_slot, lk.wall_col, cap_col=lk.trim_col, pier_every=6.0, pier_h=2.7, pier_w=0.7)
        if 'gate' in fe:
            for sg in (-1, 1):
                lib.box_c(b, sg * 5.0, yw, 0, 1.4, 0.9, 3.8, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.trim_col)
            lib.box(b, -5.0, yw - 0.4, 3.8, 5.0, yw + 0.4, 4.6, lk.wall_slot, lk.trim_col, top_slot='roof-flat', top_col=lk.trim_col, skip=('bottom',))
    if 'signage-board' in fe and det < 2:
        with b.site():
            lib.sign_board(b, w * 0.32, yf - ad - 12.0, 0.0, 8.0, 3.0, lk, 0.0, col=P['seat_a'])
    if 'flags' in fe and det < 2:
        with b.site():
            for k in range(3):
                U.flag(b, -aw / 2 - 4 - 3 * k, yf - ad - 5.0, 11.0, ['#1f7a4d', '#f2f2ee', lk.accent_col][k], col2='#f2f2ee')
    if det < 2 and lk.tree not in (None, 'none'):
        with b.site():
            for k in range(5 if det == 0 else 2):
                lib.tree(b, lk.tree, srng.uniform(pad[0] + 4, pad[2] - 4), srng.uniform(pad[1] + 3, yf - ad - 12), srng.uniform(7, 10), srng, lk)


# -------------------------------------------------------------------------------------------------------------------- build
def _build_once(brief, style, rng, detail):
    b = lib.Builder('stadium', detail)
    lk = lib.look(brief, style, rng)
    srng = random.Random(rng.getrandbits(64))
    P = plan(brief, style, srng, lk)
    if P['typ'] == 'bowl':
        build_bowl(b, brief, lk, P, rng)
    elif P['typ'] == 'grounds':
        build_grounds(b, brief, lk, P, rng)
    else:
        build_hall(b, brief, lk, P, rng)
    return b, P


def build(brief, style, rng, detail):
    global ECON
    state = rng.getstate()
    ECON = False
    b, P = _build_once(brief, style, rng, detail)
    if detail == 0 and b.tris > 18500:
        ECON = True
        rng.setstate(state)
        b, P = _build_once(brief, style, rng, detail)
        ECON = False
    objs = b.objects()
    U.centre_xy(objs, True, P['typ'] == 'bowl', 0.0)
    return objs
