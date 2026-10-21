"""Build the ONE global 2048x2048 trim atlas (procedural, no third-party inputs, so no licence issues).

    /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 scripts/places/atlas/build.py
    (any Python 3 with numpy works; Blender's bundled one is simply guaranteed to have it)

Writes atlas/trim.webp (via cwebp), atlas/slots.json (slot name -> pixel rect, world tile size, kind) and, when
--preview is given, a PNG next to it for looking at. Everything is deterministic (fixed seeds).

Textures are deliberately neutral/light: vertex colour (COLOR_0) multiplies them in the game, so one brick slot serves
red, yellow or grey brick. Glazing slots are the exception: dark and reflective by themselves.
Every slot is stored with an 8 px gutter of wrapped (tiled) content so mip-mapping never bleeds a neighbour in.
"""
import json
import struct
import subprocess
import sys
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SIZE = 2048
GUTTER = 8
CWEBP = '/opt/homebrew/bin/cwebp'


# ---------------------------------------------------------------------------------------------------------------- noise
def fnoise(h, w, rng, beta=2.0, stretch=(1.0, 1.0)):
    """Periodic (tileable) noise, mean 0, std 1. beta ~ spectral slope (higher = smoother). stretch scales the y/x frequency
    (stretch=(0.1, 1) gives features long in y)."""
    fy = np.fft.fftfreq(h)[:, None] * stretch[0]
    fx = np.fft.fftfreq(w)[None, :] * stretch[1]
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    spec = (rng.standard_normal((h, w)) + 1j * rng.standard_normal((h, w))) / f ** (beta / 2.0)
    spec[0, 0] = 0
    n = np.fft.ifft2(spec).real
    return (n - n.mean()) / (n.std() + 1e-9)


def grid(h, w):
    y, x = np.mgrid[0:h, 0:w]
    return (y + 0.5) / h, (x + 0.5) / w  # 0..1 periodic coordinates


def smooth(a, lo, hi):
    t = np.clip((a - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def to_rgb(g):
    return np.repeat(np.clip(g, 0, 1)[:, :, None], 3, axis=2)


def soft_line(coord, period, width):
    """Soft line at multiples of 1/period (distance in units of one period)."""
    f = (coord * period) % 1.0
    d = np.minimum(f, 1.0 - f)
    return 1.0 - smooth(d, width * 0.5, width * 1.5)


# ------------------------------------------------------------------------------------------------------------- helpers
def gblur(a, s):
    """Periodic gaussian blur (sigma in pixels), works on (h, w) or (h, w, c)."""
    if a.ndim == 3:
        return np.stack([gblur(a[:, :, i], s) for i in range(a.shape[2])], axis=2)
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2 * (np.pi * s) ** 2 * (fx * fx + fy * fy))
    return np.fft.ifft2(np.fft.fft2(a) * k).real.astype(np.float32)


def relief(hm, k, light=(-0.7, -0.7)):
    """Shading factor from a height map (pixel units), light from the top left. Bakes the micro relief that makes joints and
    mouldings read crisp at phone scale. Periodic."""
    gx = (np.roll(hm, -1, 1) - np.roll(hm, 1, 1)) * 0.5
    gy = (np.roll(hm, -1, 0) - np.roll(hm, 1, 0)) * 0.5
    return 1.0 - k * (gx * light[0] + gy * light[1])


def voronoi(h, w, n, rng, jit=0.8):
    """Periodic worley noise on an n x n jittered grid: returns F1, F2 (grid-cell units) and the id of the nearest point."""
    y, x = grid(h, w)
    gy, gx = np.mgrid[0:n, 0:n]
    py = ((gy + 0.5 + (rng.random((n, n)) - 0.5) * jit) / n).ravel()
    px = ((gx + 0.5 + (rng.random((n, n)) - 0.5) * jit) / n).ravel()
    f1 = np.full((h, w), 9.0, np.float32)
    f2 = np.full((h, w), 9.0, np.float32)
    ids = np.zeros((h, w), np.int32)
    for i in range(n * n):
        dy = np.abs(y - py[i])
        dy = np.minimum(dy, 1 - dy)
        dx = np.abs(x - px[i])
        dx = np.minimum(dx, 1 - dx)
        d = np.sqrt(dx * dx + dy * dy).astype(np.float32) * n
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        ids = np.where(closer, i, ids)
        f1 = np.where(closer, d, f1)
    return f1, f2, ids


def bond(h, w, rows, per, offset=0.5, shift=None):
    """Brick-like running bond coordinates: row, col, fy (0 at the top of a course), fx (0 at the left of a unit)."""
    y, x = grid(h, w)
    ry = y * rows
    row = np.floor(ry).astype(int)
    fy = ry - row
    rx = x * per + (row % 2) * offset
    col = np.floor(rx).astype(int) % per
    return row % rows, col, fy, rx - np.floor(rx)


def speckle(h, w, rng, amount, size=0.15):
    return amount * fnoise(h, w, rng, size)


def tone(g, rgb=(1.0, 1.0, 1.0)):
    """Grey (h, w) to a very slightly tinted rgb. Keep the tints tiny: vertex colour carries the colour."""
    return np.clip(np.stack([g * rgb[0], g * rgb[1], g * rgb[2]], axis=2), 0, 1)


def edge_ao(inside, px):
    """Darkening near the borders of the 'inside' mask (joint ambient occlusion), 0..1."""
    return np.clip(gblur((~inside).astype(np.float32), px) * 2.0, 0, 1)


# ------------------------------------------------------------------------------------------------------------ materials
def plain_render(h, w, rng, tile):
    """Painted sand-cement render: soft trowel mottling, fine sand grain, faint run-off streaks and a hairline crack."""
    y, x = grid(h, w)
    g = 0.86 + 0.018 * fnoise(h, w, rng, 3.2) + 0.014 * fnoise(h, w, rng, 1.4) + speckle(h, w, rng, 0.012, 0.0)
    swirl = gblur(fnoise(h, w, rng, 1.0), 1.2) * 3
    g *= relief(swirl, 0.025)
    streak = fnoise(h, w, rng, 2.0, (1.0, 0.06))
    g -= 0.025 * np.clip(streak - 0.4, 0, 3)
    crack = np.abs(fnoise(h, w, rng, 2.6)) < 0.012
    g -= 0.05 * crack * smooth(fnoise(h, w, rng, 3.0), 0.3, 1.0)
    return tone(g)


def smooth_concrete(h, w, rng, tile):
    """Cast in-situ concrete, ply formwork (2.4 x 1.2 m sheets, faint seams, tie holes), cloudy, with a few blow-holes."""
    y, x = grid(h, w)
    g = 0.78 + 0.03 * fnoise(h, w, rng, 3.0) + 0.012 * fnoise(h, w, rng, 1.2) + speckle(h, w, rng, 0.008, 0.0)
    sheet = np.floor(y * tile[1] / 1.2).astype(int)
    g += 0.012 * ((sheet % 2) * 2 - 1) * 0.6
    sx, sy = (x * tile[0]) % 2.4, (y * tile[1]) % 1.2
    seam = (np.minimum(sx, 2.4 - sx) < 0.012) | (np.minimum(sy, 1.2 - sy) < 0.012)
    g -= 0.08 * gblur(seam.astype(np.float32), 0.7) * 2
    hole = np.zeros((h, w), np.float32)
    for gy in range(int(tile[1] / 1.2 + 0.5)):
        for gx in range(int(tile[0] / 2.4 + 0.5)):
            for (tx, ty) in ((0.6, 0.3), (1.8, 0.3), (0.6, 0.9), (1.8, 0.9)):
                cx, cy = (gx * 2.4 + tx) / tile[0], (gy * 1.2 + ty) / tile[1]
                d = np.hypot(((x - cx + 0.5) % 1 - 0.5) * tile[0], ((y - cy + 0.5) % 1 - 0.5) * tile[1])
                hole += (d < 0.022)
    g -= 0.28 * gblur(np.clip(hole, 0, 1), 0.7) * 2
    pits = fnoise(h, w, rng, 0.0) > 3.1
    g -= 0.12 * gblur(pits.astype(np.float32), 0.6) * 2
    g -= 0.04 * smooth(fnoise(h, w, rng, 2.6, (1.0, 0.25)), 0.9, 2.4)
    return tone(g)


def board_concrete(h, w, rng, tile):
    """Board-marked (rough sawn timber formwork) concrete: 143 mm boards, grain imprint, staggered butt joints."""
    y, x = grid(h, w)
    nb = 28
    b = np.floor(y * nb).astype(int) % nb
    fb = (y * nb) % 1.0
    bt = rng.normal(0, 1, nb)
    g = 0.74 + 0.028 * bt[b] + 0.02 * fnoise(h, w, rng, 2.6)
    grain = fnoise(h, w, rng, 1.5, (0.025, 1.0))
    g += 0.03 * grain + 0.012 * fnoise(h, w, rng, 0.8, (0.1, 1.0))
    hm = 1.4 * grain + 0.0
    edge = smooth(fb, 0.0, 0.1) * (1 - smooth(fb, 0.9, 1.0))
    hm = hm - 2.0 * (1 - edge)
    # butt joints: each board has its own stagger, boards 1.2 to 2.4 m long
    off = rng.random(nb)
    lens = rng.integers(1, 4, nb) * 0.8 + 0.8
    bx = (x * tile[0] + off[b] * 3) % lens[b]
    butt = bx < 0.02
    hm = hm - 2.0 * butt
    g *= relief(gblur(hm, 0.6), 0.09)
    g -= 0.045 * (1 - edge)
    g -= 0.06 * butt
    g -= 0.05 * smooth(fnoise(h, w, rng, 2.6, (1.0, 0.3)), 0.8, 2.4)
    return tone(g)


def rough_concrete(h, w, rng, tile):
    """Rough shuttered / tooled concrete: heavy aggregate pitting, 2 m panel joints with tie holes, rain staining."""
    y, x = grid(h, w)
    g = 0.74 + 0.03 * fnoise(h, w, rng, 2.4) + 0.025 * fnoise(h, w, rng, 1.0) + 0.02 * fnoise(h, w, rng, 0.4)
    agg = gblur(fnoise(h, w, rng, 0.2), 0.8)
    g *= relief(agg * 8, 0.09)
    pit = (fnoise(h, w, rng, 0.0) > 2.5).astype(np.float32)
    g -= 0.2 * gblur(pit, 0.7) * 2
    joints = np.maximum(soft_line(y, 2, 0.01), soft_line(x, 2, 0.01))
    g -= 0.2 * joints
    g *= relief(gblur(-joints * 3, 0.8), 0.08)
    ties = np.zeros((h, w), np.float32)
    for gy in range(4):
        for gx in range(4):
            cy, cx = (gy + 0.5) / 4, (gx + 0.5) / 4
            d = np.hypot(((x - cx + 0.5) % 1 - 0.5) * tile[0], ((y - cy + 0.5) % 1 - 0.5) * tile[1])
            ties += (d < 0.03)
    g -= 0.28 * gblur(np.clip(ties, 0, 1), 0.7) * 2
    g -= 0.07 * smooth(fnoise(h, w, rng, 2.6, (1.0, 0.25)), 0.7, 2.2)
    return tone(g)


def precast_panel(h, w, rng, tile):
    """Precast concrete cladding: 1.2 x 1.5 m panels, recessed 20 mm joints, per-panel tone, lifting sockets."""
    y, x = grid(h, w)
    nx, ny = int(round(tile[0] / 1.2)), int(round(tile[1] / 1.5))
    px, py = np.floor(x * nx).astype(int) % nx, np.floor(y * ny).astype(int) % ny
    t = rng.normal(0, 1, (ny, nx))[py, px]
    g = 0.80 + 0.018 * t + 0.014 * fnoise(h, w, rng, 2.8) + speckle(h, w, rng, 0.012, 0.0)
    fx, fy = (x * nx) % 1.0, (y * ny) % 1.0
    jw = 0.02 / 1.2 * nx * 0.5
    jh = 0.02 / 1.5 * ny * 0.5
    joint = (np.minimum(fx, 1 - fx) < jw) | (np.minimum(fy, 1 - fy) < jh)
    inner = (~joint).astype(np.float32)
    hm = gblur(inner, 1.0) * 2.5
    g *= relief(hm, 0.3)
    g = np.where(joint, 0.56 + 0.02 * fnoise(h, w, rng, 1.0), g)
    # chamfer highlight just inside each panel and soft AO into the joints
    g -= 0.1 * edge_ao(joint == 0, 2.0) * inner
    sock = np.zeros((h, w), np.float32)
    for sx in (0.2, 0.8):
        d = np.hypot(((fx - sx) * 1.2), ((fy - 0.5) * 1.5))
        sock += (d < 0.03)
    g -= 0.2 * gblur(np.clip(sock, 0, 1), 0.8) * 2
    g -= 0.04 * smooth(fnoise(h, w, rng, 2.6, (1.0, 0.25)), 0.8, 2.3)
    return tone(g)


def _brick(h, w, rng, rows, per, jv, jh, base, spread, mort, mort_noise, depth, fine=0.03, ao=0.3, crease=0.0):
    row, col, fy, fx = bond(h, w, rows, per)
    inb = (fy >= jv) & (fx >= jh)
    t = rng.normal(0, 1, (rows, per))[row, col]
    ramp = rng.uniform(-1, 1, (rows, per))[row, col]
    face = base + spread * t + 0.02 * ramp * (fy - 0.5)
    face += fine * fnoise(h, w, rng, 0.9) + 0.015 * fnoise(h, w, rng, 2.2)
    if crease:
        face -= crease * smooth(np.abs(fnoise(h, w, rng, 0.5, (0.15, 1.0))), 2.0, 3.2)
    g = np.where(inb, face, mort + mort_noise * fnoise(h, w, rng, 0.2))
    hm = gblur(inb.astype(np.float32), 0.75) * depth
    g *= relief(hm, 0.55)
    g -= ao * edge_ao(inb, 1.6) * inb
    # sun-bleached lower arris: brighter bottom edge of each brick, softens the flat look
    g += 0.04 * inb * smooth(fy, 0.9, 1.0)
    return g


def brick(h, w, rng, tile):
    """Stretcher bond, 215 x 65 mm bricks on 225 x 75 mm centres (24 courses, 8 bricks per 1.8 m), light mortar."""
    return tone(_brick(h, w, rng, 24, 8, 0.133, 0.045, 0.70, 0.045, 0.90, 0.02, 1.6))


def brick_stock(h, w, rng, tile):
    """Soft stock brick: strongly varied tones, irregular faces and creases, thicker light joints."""
    return tone(_brick(h, w, rng, 24, 8, 0.15, 0.055, 0.64, 0.095, 0.88, 0.025, 1.4, fine=0.045, ao=0.28, crease=0.04))


def brick_dark(h, w, rng, tile):
    """Engineering / dark brick: uniform face, thin flush joint a touch darker than the unit."""
    return tone(_brick(h, w, rng, 24, 8, 0.09, 0.03, 0.76, 0.03, 0.55, 0.015, 0.8, fine=0.02, ao=0.18))


def stone_blocks(h, w, rng, tile):
    """Coursed rough-dressed stone blocks, 0.3 to 0.55 m courses, per-block tone, chiselled face and deep joints."""
    y, x = grid(h, w)
    heights = np.array([0.1, 0.07, 0.12, 0.08, 0.09, 0.11, 0.1, 0.07, 0.1, 0.08, 0.08])
    heights = heights / heights.sum()
    edges = np.concatenate([[0], np.cumsum(heights)])
    g = np.zeros((h, w), np.float32)
    inside = np.zeros((h, w), bool)
    for i in range(len(heights)):
        y0, y1 = edges[i], edges[i + 1]
        n = int(rng.integers(3, 5))
        wid = rng.uniform(0.7, 1.3, n)
        wid /= wid.sum()
        cuts = np.cumsum(wid)
        xs = (x - rng.uniform(0, 1)) % 1.0
        idx = np.searchsorted(cuts, xs.clip(0, 0.999999))
        starts = np.concatenate([[0], cuts[:-1]])[idx]
        shade = rng.normal(0, 0.05, n)[idx]
        row = (y >= y0) & (y < y1)
        joint = ((xs - starts) < 0.006) | (y < y0 + 0.006) | (y >= y1 - 0.0)
        ins = row & ~((xs - starts) < 0.006) & ~(y < y0 + 0.006)
        g = np.where(row, 0.80 + shade, g)
        inside |= ins
    hm = gblur(inside.astype(np.float32), 0.8) * 2.0 + 3.0 * gblur(fnoise(h, w, rng, 0.6), 1.0)
    g = np.where(inside, g + 0.03 * fnoise(h, w, rng, 1.6) + 0.03 * fnoise(h, w, rng, 0.5), 0.40 + 0.02 * fnoise(h, w, rng, 0.5))
    g *= relief(hm, 0.28)
    g -= 0.2 * edge_ao(inside, 2.0) * inside
    return tone(g)


def stone_ashlar(h, w, rng, tile):
    """Fine-jointed ashlar: 0.3 m courses, 0.6 to 1.2 m blocks, 4 mm joints, subtle tooling lines and tone changes."""
    y, x = grid(h, w)
    rows = 12
    row = np.floor(y * rows).astype(int) % rows
    fy = (y * rows) % 1.0
    g = np.zeros((h, w), np.float32)
    inside = np.zeros((h, w), bool)
    for r in range(rows):
        n = int(rng.integers(3, 6))
        wid = rng.uniform(0.7, 1.3, n)
        wid /= wid.sum()
        cuts = np.cumsum(wid)
        xs = (x - rng.uniform(0, 1)) % 1.0
        idx = np.searchsorted(cuts, xs.clip(0, 0.999999))
        starts = np.concatenate([[0], cuts[:-1]])[idx]
        sel = row == r
        tn = rng.normal(0, 0.035, n)[idx]
        inb = ((xs - starts) * tile[0] > 0.008) & (fy * 0.3 > 0.006)
        g = np.where(sel, 0.84 + tn, g)
        inside |= sel & inb
    tool = fnoise(h, w, rng, 1.2, (0.07, 1.0))
    g += 0.015 * tool + 0.02 * fnoise(h, w, rng, 2.6) + 0.012 * fnoise(h, w, rng, 0.6)
    hm = gblur(inside.astype(np.float32), 0.7) * 1.5
    g = np.where(inside, g, 0.5)
    g *= relief(hm, 0.3)
    g -= 0.05 * smooth(fnoise(h, w, rng, 2.8, (1.0, 0.2)), 0.8, 2.3) * inside
    return tone(g, (1.0, 0.99, 0.96))


def rubble_flint(h, w, rng, tile):
    """Random rubble / knapped flint: irregular stones about 0.3 m across in lime mortar, rounded relief, per-stone tone."""
    n = 13
    f1, f2, ids = voronoi(h, w, n, rng, 0.9)
    d = f2 - f1
    t = rng.normal(0, 1, n * n)[ids]
    size = rng.uniform(0.85, 1.0, n * n)[ids]
    inside = d > 0.10 * size
    g = 0.62 + 0.11 * t + 0.05 * fnoise(h, w, rng, 1.0) + 0.04 * fnoise(h, w, rng, 0.3)
    g = np.where(inside, np.clip(g, 0.3, 0.9), 0.82 + 0.04 * fnoise(h, w, rng, 0.3))
    hm = np.sqrt(np.clip(d / 0.32, 0, 1)) * 6 + 2.0 * gblur(fnoise(h, w, rng, 0.8), 1.0)
    g *= relief(gblur(hm, 0.8), 0.18)
    g -= 0.28 * edge_ao(inside, 2.5) * inside
    return tone(g)


def mud_render(h, w, rng, tile):
    """Sun-baked mud render: hand-smoothed lumps, shrinkage cracks, rain gullies."""
    g = 0.86 + 0.04 * fnoise(h, w, rng, 3.2) + 0.022 * fnoise(h, w, rng, 1.4) + 0.012 * fnoise(h, w, rng, 0.5)
    lump = gblur(fnoise(h, w, rng, 2.0), 2.0) * 6
    g *= relief(lump, 0.05)
    crack = np.abs(fnoise(h, w, rng, 2.2))
    g -= 0.14 * gblur((crack < 0.028).astype(np.float32), 0.6) * 2
    g -= 0.06 * smooth(fnoise(h, w, rng, 3.0, (1.0, 0.15)), 0.5, 2.0)
    return tone(g)


def mud_toron(h, w, rng, tile):
    """Mud render with toron (protruding palm-beam) rows every 0.8 m, each with a drop shadow, plus rain-washed bands."""
    y, x = grid(h, w)
    g = mud_render(h, w, rng, tile)[:, :, 0]
    rows, per = 5, 8
    for r in range(rows):
        cy = (r + 0.18) / rows
        for k in range(per):
            cx = (k + 0.5 + 0.18 * rng.uniform(-1, 1)) / per
            dx = ((x - cx + 0.5) % 1 - 0.5) * tile[0]
            dy = ((y - cy + 0.5) % 1 - 0.5) * tile[1]
            stick = (np.abs(dx) < 0.07) & (np.abs(dy) < 0.035)
            shadow = (np.abs(dx) < 0.1) & (dy > 0.0) & (dy < 0.15)
            g = np.where(shadow & ~stick, g * (1 - 0.35 * smooth(0.15 - dy, 0.0, 0.15)), g)
            g = np.where(stick, 0.52 + 0.1 * (0.5 - (dy + 0.035) / 0.07) + 0.04 * rng.normal(), g)
    g = g * (1 + 0.0)
    return tone(g)


def metal_cladding(h, w, rng, tile):
    """Painted trapezoidal profile sheet, 250 mm pitch (16 ribs per 4 m), fixing screws, horizontal sheet laps."""
    y, x = grid(h, w)
    per = 16
    f = (x * per) % 1.0
    prof = np.where(f < 0.3, 0.0, np.where(f < 0.4, (f - 0.3) / 0.1, np.where(f < 0.7, 1.0, np.where(f < 0.8, (0.8 - f) / 0.1, 0.0))))
    g = 0.76 + 0.012 * fnoise(h, w, rng, 1.0, (1.0, 0.03))
    g *= relief(prof * 3.5, 0.22, (-1.0, 0.0))
    g += 0.05 * smooth(f, 0.38, 0.5) * (1 - smooth(f, 0.5, 0.62))
    g -= 0.07 * (f < 0.3) * 0.5
    lap = np.minimum((y * 2) % 1.0, 1 - (y * 2) % 1.0) < 0.004
    g -= 0.2 * lap
    screws = np.zeros((h, w), np.float32)
    for r in (0.25, 0.75):
        for gy in range(2):
            cy = (gy * 0.5 + r * 0.5)
            dy = ((y - cy + 0.5) % 1 - 0.5) * tile[1]
            screws += (np.abs(dy) < 0.02) & (f > 0.45) & (f < 0.55) & (np.abs(((x * per * 2) % 1.0) - 0.5) < 0.35)
    g -= 0.1 * gblur(np.clip(screws, 0, 1), 0.7) * 2
    g += 0.03 * fnoise(h, w, rng, 2.2) * 0.5
    return tone(g)


def standing_seam(h, w, rng, tile):
    """Standing-seam metal roof or wall: 500 mm pans, raised seams with highlight and shadow, oil-canning sheen, end laps."""
    y, x = grid(h, w)
    per = int(round(tile[0] / 0.5))
    f = (x * per) % 1.0
    seam = np.exp(-((np.minimum(f, 1 - f)) / 0.018) ** 2)
    g = 0.78 + 0.02 * fnoise(h, w, rng, 3.0, (1.0, 0.2)) + 0.012 * fnoise(h, w, rng, 1.0, (1.0, 0.05))
    pan = rng.normal(0, 1, per)[np.floor(x * per).astype(int) % per]
    g += 0.012 * pan
    g += 0.09 * np.sin(2 * np.pi * f * 1.0) * 0.4 * (0.5 + 0.5 * fnoise(h, w, rng, 3.0, (1.0, 0.3)))
    g *= relief(seam * 3, 0.5, (-1.0, 0.0))
    g += 0.07 * seam
    g -= 0.22 * (np.minimum(f, 1 - f) < 0.006)
    lap = np.minimum(y % 1.0, 1 - y % 1.0) < 0.006
    g -= 0.12 * lap
    return tone(g)


def corrugated(h, w, rng, tile):
    """Corrugated iron sheet: 76 mm pitch (26 per 2 m), crisp sine shading, rust streaks, screw rows, side laps."""
    y, x = grid(h, w)
    ridges = 26
    ph = 2 * np.pi * x * ridges
    g = 0.72 + 0.15 * np.sin(ph + 0.6) + 0.012 * fnoise(h, w, rng, 1.2, (1.0, 0.1)) + 0.02 * fnoise(h, w, rng, 3.0)
    g += 0.04 * np.maximum(0, np.sin(ph + 0.2)) ** 6
    rust = smooth(fnoise(h, w, rng, 2.6, (1.0, 0.1)), 0.9, 2.4)
    g -= 0.1 * rust
    scr = np.zeros((h, w), np.float32)
    for cy in (0.12, 0.62):
        dy = ((y - cy + 0.5) % 1 - 0.5) * tile[1]
        scr += (np.abs(dy) < 0.012) & (np.abs(np.sin(ph * 0.5)) > 0.98) & (np.cos(ph * 0.5) < 0)
    g -= 0.2 * gblur(np.clip(scr, 0, 1), 0.7) * 2
    g -= 0.15 * (np.minimum(y % 0.5, 0.5 - y % 0.5) < 0.004)
    return tone(g)


def clay_tile(h, w, rng, tile):
    """Plain clay tiles, 100 mm gauge (20 courses per 2 m), 167 mm wide, each with camber, drip shadow and own tone."""
    y, x = grid(h, w)
    rows, per = 20, 12
    row, col, fy, fx = bond(h, w, rows, per)
    t = rng.normal(0, 1, (rows, per))[row, col]
    g = (0.84 + 0.06 * t) * (0.72 + 0.28 * smooth(fy, 0.0, 0.8)) * (0.92 + 0.08 * np.sin(np.pi * fx))
    g -= 0.30 * smooth(fy, 0.86, 0.99) * 0.0
    g += 0.05 * smooth(fy, 0.82, 0.9) * (1 - smooth(fy, 0.9, 0.97))
    g -= 0.38 * (fy > 0.95)
    g -= 0.16 * (fx < 0.045)
    g += 0.03 * fnoise(h, w, rng, 1.2) + 0.015 * fnoise(h, w, rng, 0.4)
    moss = smooth(fnoise(h, w, rng, 2.6), 1.1, 2.6)
    g -= 0.05 * moss
    return tone(g)


def slate(h, w, rng, tile):
    """Natural slate: 250 mm wide, 200 mm exposed gauge, per-slate tone, layered shadow lines, a few chipped corners."""
    y, x = grid(h, w)
    rows, per = 10, 8
    row, col, fy, fx = bond(h, w, rows, per)
    t = rng.normal(0, 1, (rows, per))[row, col]
    g = (0.72 + 0.08 * t) * (0.78 + 0.22 * smooth(fy, 0.0, 0.85))
    g -= 0.30 * (fy > 0.94) + 0.2 * (fx < 0.03)
    g += 0.04 * smooth(fy, 0.85, 0.93) * (1 - smooth(fy, 0.93, 0.99))
    g += 0.025 * fnoise(h, w, rng, 1.0) + 0.012 * fnoise(h, w, rng, 0.3, (0.2, 1.0))
    return tone(g)


def thatch(h, w, rng, tile):
    """Layered straw thatch: long fibres running down the slope, ragged eaves bands every 0.5 m, shadowed clumps."""
    y, x = grid(h, w)
    fib = fnoise(h, w, rng, 0.5, (1.0, 0.07))
    clump = fnoise(h, w, rng, 2.0, (1.0, 0.3))
    g = 0.70 + 0.07 * fib + 0.05 * clump + 0.02 * fnoise(h, w, rng, 0.2)
    band = (y * 4) % 1.0
    g *= 0.82 + 0.18 * smooth(band, 0.0, 0.8)
    g -= 0.22 * (band > 0.93) * (0.6 + 0.4 * smooth(fnoise(h, w, rng, 1.0), -1, 1))
    g *= relief(gblur(clump * 4 + fib * 2, 0.8), 0.08)
    g -= 0.05 * smooth(fnoise(h, w, rng, 2.6), 1.0, 2.5)
    return tone(g, (1.0, 0.97, 0.88))


def timber(h, w, rng, tile):
    """Vertical timber planks, 133 mm, grain, knots, shadow gaps, a staggered butt joint."""
    y, x = grid(h, w)
    planks = 12
    px = np.floor(x * planks).astype(int) % planks
    t = rng.normal(0, 1, planks)[px]
    f = (x * planks) % 1.0
    grain = fnoise(h, w, rng, 1.4, (0.03, 1.0))
    ring = np.sin((x * planks * 7 + 6 * fnoise(h, w, rng, 3.0, (1.0, 0.1))) * 2 * np.pi)
    g = 0.70 + 0.045 * t + 0.045 * grain + 0.02 * ring + 0.02 * fnoise(h, w, rng, 2.4)
    g *= relief(gblur(grain * 1.5, 0.6), 0.04)
    gap = (f < 0.045) | (f > 0.97)
    g -= 0.32 * gap
    g += 0.05 * smooth(f, 0.05, 0.12) * (1 - smooth(f, 0.12, 0.2))
    jy = (y * 2 + px * 0.37) % 1.0
    g -= 0.2 * (jy < 0.008)
    knot = np.zeros((h, w), np.float32)
    for k in range(4):
        cx, cy = rng.random(), rng.random()
        d = np.hypot(((x - cx + 0.5) % 1 - 0.5) * 1.0, ((y - cy + 0.5) % 1 - 0.5) * 2.4) * 25
        knot += np.exp(-d * d)
    g -= 0.2 * np.clip(knot, 0, 1)
    return tone(g, (1.0, 0.97, 0.93))


def timber_boards(h, w, rng, tile):
    """Horizontal shiplap / weatherboard cladding, 140 mm boards (12 per 1.68 m), shadow line under each, grain along x."""
    y, x = grid(h, w)
    nb = 12
    b = np.floor(y * nb).astype(int) % nb
    fb = (y * nb) % 1.0
    t = rng.normal(0, 1, nb)[b]
    grain = fnoise(h, w, rng, 1.4, (0.03, 1.0))
    g = 0.72 + 0.045 * t + 0.045 * grain + 0.02 * fnoise(h, w, rng, 2.6)
    g *= 0.86 + 0.14 * smooth(fb, 0.0, 0.7)
    g -= 0.38 * (fb > 0.9) * smooth(fb, 0.9, 0.97)
    g += 0.07 * (fb < 0.07) * smooth(fb, 0.0, 0.03)
    off = rng.random(nb)
    butt = ((x * 1.0 + off[b]) % 0.75) < 0.006
    g -= 0.15 * butt
    return tone(g, (1.0, 0.97, 0.93))


def paving(h, w, rng, tile):
    """Concrete paving slabs, 500 mm, per-slab tone, hairline joints with grit, wear, a bit of weed in the joints."""
    y, x = grid(h, w)
    n = 4
    cy, cx = np.floor(y * n).astype(int) % n, np.floor(x * n).astype(int) % n
    t = rng.normal(0, 1, (n, n))[cy, cx]
    g = 0.72 + 0.03 * t + 0.02 * fnoise(h, w, rng, 1.2) + 0.012 * fnoise(h, w, rng, 3.0) + speckle(h, w, rng, 0.016, 0.0)
    jx = np.minimum((x * n) % 1.0, 1 - (x * n) % 1.0) < 0.016
    jy = np.minimum((y * n) % 1.0, 1 - (y * n) % 1.0) < 0.016
    joint = jx | jy
    g *= relief(gblur((~joint).astype(np.float32) * 2, 0.8), 0.3)
    g = np.where(joint, 0.40 + 0.03 * fnoise(h, w, rng, 0.3), g)
    g -= 0.1 * edge_ao(~joint, 1.5) * (~joint)
    weeds = smooth(fnoise(h, w, rng, 1.2), 1.2, 2.5) * joint
    g -= 0.1 * weeds
    g -= 0.05 * smooth(fnoise(h, w, rng, 2.6), 0.8, 2.3)
    return tone(g)


def paving_block(h, w, rng, tile):
    """Interlocking concrete paver blocks 200 x 100 mm in running bond (16 rows per 1.6 m), per-block tone, sand joints."""
    row, col, fy, fx = bond(h, w, 16, 8)
    inb = (fy > 0.09) & (fx > 0.045)
    t = rng.normal(0, 1, (16, 8))[row, col]
    g = 0.70 + 0.05 * t + 0.02 * fnoise(h, w, rng, 1.2) + speckle(h, w, rng, 0.02, 0.0)
    g = np.where(inb, g, 0.50 + 0.03 * fnoise(h, w, rng, 0.2))
    g *= relief(gblur(inb.astype(np.float32), 0.7) * 1.5, 0.4)
    g -= 0.05 * smooth(fnoise(h, w, rng, 2.6), 0.9, 2.4)
    return tone(g)


def asphalt(h, w, rng, tile):
    """Weathered asphalt: bright aggregate chips, polished wheel-path tone, patches, tar-sealed cracks, oil spots."""
    y, x = grid(h, w)
    g = 0.46 + 0.025 * fnoise(h, w, rng, 1.6) + 0.04 * fnoise(h, w, rng, 0.2) + 0.012 * fnoise(h, w, rng, 3.0)
    chips = (fnoise(h, w, rng, 0.0) > 2.1).astype(np.float32)
    g += 0.12 * gblur(chips, 0.6) * 2
    g *= relief(gblur(fnoise(h, w, rng, 0.3), 0.8) * 3, 0.06)
    g -= 0.045 * smooth(fnoise(h, w, rng, 3.0, (0.2, 1.0)), 0.5, 2.0) * 1.0
    # repair patch: straight-edged darker rectangle
    px0, py0 = rng.uniform(0.1, 0.5), rng.uniform(0.1, 0.5)
    patch = (x > px0) & (x < px0 + 0.28) & (y > py0) & (y < py0 + 0.16)
    g = np.where(patch, g * 0.82, g)
    g -= 0.05 * gblur((np.abs(gblur(patch.astype(np.float32), 0.6) - 0.5) < 0.2).astype(np.float32), 0.8)
    crack = np.abs(fnoise(h, w, rng, 2.4)) < 0.012
    g -= 0.2 * gblur(crack.astype(np.float32), 0.6) * 2 * smooth(fnoise(h, w, rng, 3.0), 0.0, 1.0)
    g -= 0.06 * smooth(fnoise(h, w, rng, 2.4), 1.4, 2.6)
    return tone(g)


def grass(h, w, rng, tile):
    """Lawn / rough grass: clumpy two-scale mottling, directional blade streaks, a few dry patches."""
    g = 0.68 + 0.06 * fnoise(h, w, rng, 2.4) + 0.05 * fnoise(h, w, rng, 1.0) + 0.045 * fnoise(h, w, rng, 0.2) + 0.03 * fnoise(h, w, rng, 0.4, (1.0, 0.25))
    g *= relief(gblur(fnoise(h, w, rng, 0.6), 0.9) * 3, 0.08)
    g += 0.05 * smooth(fnoise(h, w, rng, 3.0), 1.2, 2.6)
    return tone(g, (0.98, 1.0, 0.95))


def laterite(h, w, rng, tile):
    """Compacted laterite: gravel pebbles with relief, rain-erosion gullies, wheel-scuffed fines."""
    g = 0.72 + 0.05 * fnoise(h, w, rng, 2.2) + 0.04 * fnoise(h, w, rng, 0.6) + 0.025 * fnoise(h, w, rng, 0.2)
    peb = fnoise(h, w, rng, 0.0)
    pebs = gblur((peb > 2.3).astype(np.float32), 0.9) * 3
    g += 0.08 * (peb > 2.5)
    g *= relief(pebs, 0.25)
    g -= 0.06 * (peb < -2.6)
    g -= 0.07 * smooth(np.abs(fnoise(h, w, rng, 2.2, (1.0, 0.2))), 0.0, 0.18) * -1 * 0
    gully = np.abs(fnoise(h, w, rng, 2.6, (1.0, 0.15))) < 0.05
    g -= 0.06 * gblur(gully.astype(np.float32), 1.5) * 2
    return tone(g)


def sand(h, w, rng, tile):
    """Windblown sand: crisp ripples with a lit side and a shaded side, grain speckle."""
    y, x = grid(h, w)
    ph = x * 5 + 0.35 * fnoise(h, w, rng, 3.0) + 0.05 * fnoise(h, w, rng, 2.0)
    hm = np.sin(2 * np.pi * ph) + 0.4 * np.sin(4 * np.pi * ph + 1.0)
    g = 0.84 + 0.02 * fnoise(h, w, rng, 1.0) + 0.02 * fnoise(h, w, rng, 0.2) + speckle(h, w, rng, 0.01, 0.0)
    g *= relief(hm * 1.2, 0.12, (-1.0, 0.0))
    return tone(g, (1.0, 0.98, 0.93))


def roof_flat(h, w, rng, tile):
    """Flat roof membrane: 1 m welded strips with laps, gravel ballast speckle, ponding stains, drainage dirt."""
    y, x = grid(h, w)
    g = 0.58 + 0.035 * fnoise(h, w, rng, 2.0) + 0.04 * fnoise(h, w, rng, 0.2) + 0.015 * fnoise(h, w, rng, 0.6)
    lap = np.minimum((x * 4) % 1.0, 1 - (x * 4) % 1.0) < 0.008
    g *= relief(gblur(lap.astype(np.float32) * 2, 0.8), 0.4, (-1.0, 0.0))
    g -= 0.04 * lap
    gravel = gblur((fnoise(h, w, rng, 0.0) > 1.6).astype(np.float32), 0.7) * 2
    g += 0.05 * gravel
    g -= 0.06 * smooth(fnoise(h, w, rng, 2.8), 0.9, 2.4)
    g += 0.03 * smooth(fnoise(h, w, rng, 2.4), 1.2, 2.5)
    return tone(g)


def metal_roof(h, w, rng, tile):
    """Trapezoidal (IBR) roof sheet: 333 mm pitch (9 ribs per 3 m), rib highlight and shade, screws, light weathering."""
    y, x = grid(h, w)
    per = 9
    f = (x * per) % 1.0
    prof = np.where(f < 0.3, 0.0, np.where(f < 0.38, (f - 0.3) / 0.08, np.where(f < 0.6, 1.0, np.where(f < 0.68, (0.68 - f) / 0.08, 0.0))))
    g = 0.78 + 0.012 * fnoise(h, w, rng, 1.0, (1.0, 0.03)) + 0.025 * fnoise(h, w, rng, 2.6, (1.0, 0.4))
    g *= relief(prof * 3.0, 0.24, (-1.0, 0.0))
    g += 0.05 * smooth(f, 0.36, 0.48) * (1 - smooth(f, 0.48, 0.6))
    scr = np.zeros((h, w), np.float32)
    for cy in (0.1, 0.6):
        dy = ((y - cy + 0.5) % 1 - 0.5) * tile[1]
        scr += (np.abs(dy) < 0.014) & (np.abs(f - 0.49) < 0.06)
    g -= 0.2 * gblur(np.clip(scr, 0, 1), 0.7) * 2
    g -= 0.1 * (np.minimum(y % 1.0, 1 - y % 1.0) < 0.004)
    g -= 0.04 * smooth(fnoise(h, w, rng, 2.6, (1.0, 0.1)), 1.0, 2.5)
    return tone(g)


def terracotta_panels(h, w, rng, tile):
    """Terracotta / HPL rainscreen: 300 mm high baguette planks of varied length and tone, shadow gaps, fine extrusion lines."""
    y, x = grid(h, w)
    rows = 12
    row = np.floor(y * rows).astype(int) % rows
    fy = (y * rows) % 1.0
    g = np.zeros((h, w), np.float32)
    inside = np.zeros((h, w), bool)
    for r in range(rows):
        n = int(rng.integers(2, 5))
        wid = rng.uniform(0.6, 1.4, n)
        wid /= wid.sum()
        cuts = np.cumsum(wid)
        xs = (x - rng.uniform(0, 1)) % 1.0
        idx = np.searchsorted(cuts, xs.clip(0, 0.999999))
        starts = np.concatenate([[0], cuts[:-1]])[idx]
        tn = rng.uniform(-0.12, 0.1, n)[idx]
        sel = row == r
        ins = ((xs - starts) * tile[0] > 0.012) & (fy * 0.3 > 0.012)
        g = np.where(sel, 0.76 + tn, g)
        inside |= sel & ins
    # fine extrusion channels every 25 mm
    g *= 1 + 0.025 * np.sin(2 * np.pi * y * tile[1] / 0.025 * 1.0) * 0.0
    g += 0.012 * fnoise(h, w, rng, 2.4) + 0.012 * fnoise(h, w, rng, 0.8)
    hm = gblur(inside.astype(np.float32), 0.7) * 2.0
    g = np.where(inside, g, 0.20)
    g *= relief(hm, 0.25)
    g += 0.04 * inside * smooth(fy, 0.0, 0.1) * (1 - smooth(fy, 0.1, 0.2))
    return tone(g)


def louvre(h, w, rng, tile):
    """Brise-soleil / louvre fins: horizontal blades every 150 mm (8 per 1.2 m), lit top, shaded underside, dark void behind."""
    y, x = grid(h, w)
    nb = 8
    fb = (y * nb) % 1.0
    # blade occupies fb 0.06 .. 0.62 as a slightly tilted slab; remaining is the dark gap behind
    blade = (fb > 0.06) & (fb < 0.64)
    top = blade * smooth(fb, 0.06, 0.2) * (1 - smooth(fb, 0.2, 0.3))
    under = blade * smooth(fb, 0.5, 0.64)
    g = np.where(blade, 0.82 - 0.07 * smooth(fb, 0.2, 0.6) + 0.1 * top - 0.14 * under, 0.10 + 0.05 * (fb > 0.9))
    g += blade * (0.01 * fnoise(h, w, rng, 1.6, (0.3, 1.0)) + speckle(h, w, rng, 0.008, 0.0))
    g = np.where(blade, g, g + 0.18 * smooth(fb, 0.64, 0.7) * (1 - smooth(fb, 0.7, 0.8)))
    return tone(g)


def stadium_seating(h, w, rng, tile):
    """Raked seating bowl: 0.8 m rows, plastic bucket seats (0.6 m wide) in varied greys, concrete tread and riser, aisle step."""
    y, x = grid(h, w)
    rows = 2
    fy = (y * rows) % 1.0
    ns = 8
    sx = np.floor(x * ns).astype(int) % ns
    fx = (x * ns) % 1.0
    r = np.floor(y * rows).astype(int) % rows
    t = rng.uniform(0, 1, (rows, ns))[r, sx]
    pal = np.where(t < 0.6, 0.78, np.where(t < 0.85, 0.42, 0.95))
    seat = (fy > 0.14) & (fy < 0.62) & (fx > 0.08) & (fx < 0.92)
    back = (fy > 0.14) & (fy < 0.34) & seat
    g = np.where(seat, pal * (0.9 + 0.1 * smooth(fy, 0.14, 0.62)), 0.58 + 0.02 * fnoise(h, w, rng, 1.0))
    g = np.where(back, pal * 0.82, g)
    tread = (fy >= 0.62)
    g = np.where(tread, 0.66 + 0.012 * fnoise(h, w, rng, 1.0), g)
    g -= 0.16 * (fy < 0.14)
    g -= 0.2 * ((fy > 0.62) & (fy < 0.66))
    shade = seat & (np.abs(fx - 0.5) > 0.35)
    g -= 0.1 * shade * seat
    g += speckle(h, w, rng, 0.012, 0.2)
    return tone(g)


def shutter(h, w, rng, tile):
    """Roller shutter door: 75 mm slats, shadow line per slat, side guide rails, head box, bottom bar, dents and rust."""
    y, x = grid(h, w)
    ns = 28
    fs = (y * ns) % 1.0
    g = 0.74 + 0.012 * fnoise(h, w, rng, 1.0, (0.3, 1.0))
    g *= 0.88 + 0.12 * smooth(fs, 0.0, 0.5) * (1 - 0.0)
    g -= 0.28 * (fs > 0.86) * smooth(fs, 0.86, 0.96)
    g += 0.06 * smooth(fs, 0.0, 0.15) * (1 - smooth(fs, 0.15, 0.3))
    # bottom bar, head box, guide rails
    g = np.where(y > 0.94, 0.5 + 0.1 * smooth(y, 0.94, 0.96), g)
    g = np.where(y < 0.075, 0.62 + 0.15 * smooth(y, 0.0, 0.03) - 0.2 * smooth(y, 0.06, 0.075), g)
    rail = (x < 0.035) | (x > 0.965)
    g = np.where(rail, 0.46 + 0.15 * smooth(np.minimum(x, 1 - x), 0.0, 0.03), g)
    g -= 0.09 * smooth(fnoise(h, w, rng, 2.4, (1.0, 0.2)), 0.8, 2.4)
    g -= 0.06 * np.clip(smooth(fnoise(h, w, rng, 1.6), 1.6, 3.0), 0, 1)
    handle = (np.abs(x - 0.5) < 0.05) & (np.abs(y - 0.88) < 0.012)
    g = np.where(handle, 0.3, g)
    return tone(g)


# ------------------------------------------------------------------------------------------------------------- glazing
def _sky(h, w, rng, tilt=1.0, bright=1.0):
    """Reflection in glass: pale sky at the top fading to a darker horizon band then dark ground, cloud mottling, a soft diagonal
    streak. Returns rgb (h, w, 3) around 0.15 to 0.55 (the tint in vertex colour then darkens or colours it)."""
    y, x = grid(h, w)
    sky = np.clip(1.0 - y * 1.25, 0, 1)
    ground = np.clip(y * 1.25 - 0.6, 0, 1)
    cloud = smooth(fnoise(h, w, rng, 3.2, (0.6, 1.0)), -0.2, 1.4)
    base = 0.17 + 0.30 * sky ** 1.3 * (0.75 + 0.45 * cloud) - 0.04 * ground
    streak = smooth(np.sin(2 * np.pi * (x * 0.8 + y * 0.55) * tilt), 0.6, 1.0) * 0.06
    g = (base + streak) * bright + 0.006 * fnoise(h, w, rng, 2.4)
    return np.stack([g * 0.90, g * 0.98, g * 1.10], axis=2)


def _bars(h, w, bars, bevel=1.6, val=0.74):
    """Frame/mullion mask from a list of (axis, centre, half-width) in 0..1. Returns (mask, bevel shading)."""
    y, x = grid(h, w)
    m = np.zeros((h, w), bool)
    for ax, c, hw in bars:
        if ax == 'x':
            m |= np.abs(x - c) < hw
        elif ax == 'y':
            m |= np.abs(y - c) < hw
        elif ax == 'x<':
            m |= x < hw
        elif ax == 'x>':
            m |= x > 1 - hw
        elif ax == 'y<':
            m |= y < hw
        elif ax == 'y>':
            m |= y > 1 - hw
    hm = gblur(m.astype(np.float32), bevel) * 3
    return m, relief(hm, 0.55)


def _apply_frame(rgb, mask, shade, val=0.74, gasket=True):
    out = rgb.copy()
    fr = np.clip(val * shade, 0, 1)
    out[mask] = np.stack([fr] * 3, axis=2)[mask]
    if gasket:
        dark = gblur(mask.astype(np.float32), 1.2) * (~mask)
        out *= (1 - 0.7 * np.clip(dark * 2, 0, 1))[:, :, None]
    return out


def glazing_curtain(h, w, rng, tile):
    """Curtain wall bay (3 x 3.6 m): 60 mm mullions, transom at the spandrel (0.8), a central mullion, sky reflection above, lighter spandrel."""
    rgb = _sky(h, w, rng)
    y, x = grid(h, w)
    m, sh = _bars(h, w, [('x<', 0, 0.014), ('x>', 0, 0.014), ('y<', 0, 0.012), ('y>', 0, 0.012), ('y', 0.8, 0.012), ('x', 0.5, 0.01)])
    spandrel = (y > 0.8) & ~m
    rgb[spandrel] = np.clip(rgb[spandrel] * 0.45 + 0.28, 0, 1)
    return _apply_frame(rgb, m, sh, 0.68)


def glazing_punched(h, w, rng, tile):
    """Punched window (1.2 x 1.6 m): deep reveal frame, central mullion and transom, sky reflection."""
    rgb = _sky(h, w, rng, 1.3)
    m, sh = _bars(h, w, [('x<', 0, 0.05), ('x>', 0, 0.05), ('y<', 0, 0.038), ('y>', 0, 0.038), ('x', 0.5, 0.022), ('y', 0.4, 0.018)], 2.2)
    return _apply_frame(rgb, m, sh, 0.76)


def glazing_shopfront(h, w, rng, tile):
    """Shopfront (3 x 3 m): stall riser below 0.82, transom above 0.16, a central mullion, sky reflection in the clear glass."""
    rgb = _sky(h, w, rng, 0.8)
    y, x = grid(h, w)
    m, sh = _bars(h, w, [('x<', 0, 0.02), ('x>', 0, 0.02), ('y<', 0, 0.02), ('y>', 0, 0.02), ('y', 0.82, 0.01), ('y', 0.16, 0.012), ('x', 0.5, 0.012)], 1.6)
    riser = (y > 0.82) & ~m
    rgb[riser] = 0.26 + 0.02 * fnoise(h, w, rng, 1.0)[riser][:, None]
    return _apply_frame(rgb, m, sh, 0.58)


def glazing_ribbon(h, w, rng, tile):
    """Ribbon window (4 x 1.2 m): continuous glazing with 4 lites, thin head and sill frames, sky reflection."""
    rgb = _sky(h, w, rng, 2.0)
    bars = [('y<', 0, 0.05), ('y>', 0, 0.05), ('x<', 0, 0.005), ('x>', 0, 0.005)] + [('x', k / 4, 0.005) for k in range(1, 4)]
    m, sh = _bars(h, w, bars, 1.4)
    return _apply_frame(rgb, m, sh, 0.64)


def glazing_dark(h, w, rng, tile):
    """Dark tinted / spandrel glass (3 x 3 m): near-black bronze with a faint sky glint, hairline mullions at 1.5 m."""
    rgb = _sky(h, w, rng, 1.0, 0.55) * 0.75 + 0.03
    rgb *= np.array([1.05, 0.98, 0.92])
    m, sh = _bars(h, w, [('x<', 0, 0.01), ('x>', 0, 0.01), ('y<', 0, 0.01), ('y>', 0, 0.01), ('x', 0.5, 0.008), ('y', 0.5, 0.008)], 1.2)
    return _apply_frame(rgb, m, sh, 0.3)


def glazing_green(h, w, rng, tile):
    """Green-tinted solar glass (3 x 3.6 m): blue-green cast, stronger sky gradient, thin mullions, transom at 0.8."""
    rgb = _sky(h, w, rng, 1.1, 1.05)
    rgb *= np.array([0.62, 1.12, 0.92])
    y, x = grid(h, w)
    m, sh = _bars(h, w, [('x<', 0, 0.012), ('x>', 0, 0.012), ('y<', 0, 0.012), ('y>', 0, 0.012), ('x', 0.5, 0.009), ('y', 0.8, 0.01)], 1.3)
    sp = (y > 0.8) & ~m
    rgb[sp] = np.clip(rgb[sp] * 0.5 + 0.22, 0, 1) * np.array([0.8, 1.0, 0.9])
    return _apply_frame(rgb, m, sh, 0.6)


# ----------------------------------------------------------------------------------------------------------------- trim
def cornice(h, w, rng, tile):
    y, x = grid(h, w)   # y = 0 is the top of the strip
    g = np.full((h, w), 0.86, np.float32)
    g = np.where(y < 0.25, 0.98, g)                 # lit top face / drip edge
    g = np.where((y >= 0.25) & (y < 0.45), 0.66, g)  # undercut shadow
    g = np.where((y >= 0.45) & (y < 0.6), 0.92, g)
    g = np.where((y >= 0.6) & (y < 0.75), 0.60, g)
    g = np.where(y >= 0.75, 0.82, g)
    d = soft_line(x, 32, 0.3)
    g = np.where((y >= 0.6) & (y < 0.75), g * (0.7 + 0.35 * d), g)
    g -= 0.2 * (np.abs(y - 0.25) < 0.02) + 0.12 * (np.abs(y - 0.6) < 0.02)
    g += 0.01 * fnoise(h, w, rng, 2.0)
    return tone(g)


def frame_strip(h, w, rng, tile):
    y, x = grid(h, w)
    g = 0.84 + 0.12 * smooth(0.25 - np.abs(y - 0.5), 0, 0.25) - 0.2 * (y > 0.9) - 0.1 * (y < 0.1)
    return tone(g + 0.008 * fnoise(h, w, rng, 2.0))


def plain(h, w, rng, tile):
    return np.full((h, w, 3), 0.9, np.float32)


# name, w, h, tile_m (u, v), kind, fn
SLOTS = [
    # walls (existing names first, then new)
    ('plain-render', 320, 320, (4, 4), 'wall', plain_render),
    ('rough-concrete', 352, 352, (4, 4), 'wall', rough_concrete),
    ('brick', 352, 352, (1.8, 1.8), 'wall', brick),
    ('stone-blocks', 352, 352, (4, 4), 'wall', stone_blocks),
    ('mud-render', 320, 320, (4, 4), 'wall', mud_render),
    ('metal-cladding', 352, 352, (4, 4), 'wall', metal_cladding),
    ('timber', 256, 256, (1.6, 1.6), 'wall', timber),
    ('smooth-concrete', 352, 352, (4.8, 3.6), 'wall', smooth_concrete),
    ('board-concrete', 320, 320, (4, 4), 'wall', board_concrete),
    ('precast-panel', 384, 320, (3.6, 3.0), 'wall', precast_panel),
    ('brick-stock', 320, 320, (1.8, 1.8), 'wall', brick_stock),
    ('brick-dark', 320, 320, (1.8, 1.8), 'wall', brick_dark),
    ('stone-ashlar', 320, 320, (3.6, 3.6), 'wall', stone_ashlar),
    ('rubble-flint', 320, 320, (4, 4), 'wall', rubble_flint),
    ('mud-toron', 320, 320, (4, 4), 'wall', mud_toron),
    ('terracotta-panels', 320, 320, (3.6, 3.6), 'wall', terracotta_panels),
    ('timber-boards', 256, 256, (1.68, 1.68), 'wall', timber_boards),
    ('louvre', 256, 256, (1.2, 1.2), 'wall', louvre),
    ('shutter', 256, 256, (2.4, 2.4), 'wall', shutter),
    ('stadium-seating', 384, 128, (4.8, 1.6), 'wall', stadium_seating),
    # roofs
    ('corrugated', 256, 256, (2, 2), 'roof', corrugated),
    ('clay-tile', 256, 256, (2, 2), 'roof', clay_tile),
    ('slate', 256, 256, (2, 2), 'roof', slate),
    ('metal-roof', 256, 256, (3, 3), 'roof', metal_roof),
    ('roof-flat', 256, 256, (4, 4), 'roof', roof_flat),
    ('standing-seam', 256, 256, (3, 3), 'roof', standing_seam),
    ('thatch', 256, 256, (2, 2), 'roof', thatch),
    # ground
    ('paving', 256, 256, (2, 2), 'ground', paving),
    ('paving-block', 256, 256, (1.6, 1.6), 'ground', paving_block),
    ('asphalt', 320, 320, (4, 4), 'ground', asphalt),
    ('grass', 256, 256, (4, 4), 'ground', grass),
    ('laterite', 256, 256, (4, 4), 'ground', laterite),
    ('sand', 256, 256, (4, 4), 'ground', sand),
    # glazing
    ('glass-curtain', 256, 304, (3, 3.6), 'glazing', glazing_curtain),
    ('glass-punched', 208, 272, (1.2, 1.6), 'glazing', glazing_punched),
    ('glass-shopfront', 288, 288, (3, 3), 'glazing', glazing_shopfront),
    ('glass-ribbon', 384, 128, (4, 1.2), 'glazing', glazing_ribbon),
    ('glass-dark', 224, 224, (3, 3), 'glazing', glazing_dark),
    ('glass-green', 256, 304, (3, 3.6), 'glazing', glazing_green),
    # trims
    ('cornice', 400, 64, (4, 0.5), 'trim', cornice),
    ('frame', 224, 32, (2, 0.3), 'trim', frame_strip),
    ('plain', 32, 32, (1, 1), 'trim', plain),
]


def pack(slots):
    """First-fit shelf packing (inner w,h plus a gutter each side) into SIZE x SIZE; tallest first, every shelf reused."""
    order = sorted(range(len(slots)), key=lambda i: (-slots[i][2], -slots[i][1]))
    shelves = []  # [y, height, x_cursor]
    pos = {}
    ytop = 0
    for i in order:
        w, h = slots[i][1] + 2 * GUTTER, slots[i][2] + 2 * GUTTER
        for sh in shelves:
            if h <= sh[1] and sh[2] + w <= SIZE:
                pos[i] = (sh[2] + GUTTER, sh[0] + GUTTER)
                sh[2] += w
                break
        else:
            shelves.append([ytop, h, w])
            pos[i] = (GUTTER, ytop + GUTTER)
            ytop += h
    if ytop > SIZE:
        raise SystemExit(f'atlas overflow: needs {ytop} rows')
    return pos


def write_png(path, rgb8):
    h, w, _ = rgb8.shape
    raw = b''.join(b'\x00' + rgb8[r].tobytes() for r in range(h))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    Path(path).write_bytes(png)


def main():
    atlas = np.full((SIZE, SIZE, 3), 0.5, np.float32)
    atlas[:] = (0.9, 0.9, 0.9)
    pos = pack(SLOTS)
    meta = {}
    for i, (name, w, h, tile, kind, fn) in enumerate(SLOTS):
        rng = np.random.default_rng(1000 + i)
        px = fn(h, w, rng, tile).astype(np.float32)
        x0, y0 = pos[i]
        pad = np.pad(px, ((GUTTER, GUTTER), (GUTTER, GUTTER), (0, 0)), mode='wrap')  # tileable, so wrapping is the right gutter
        atlas[y0 - GUTTER:y0 + h + GUTTER, x0 - GUTTER:x0 + w + GUTTER] = pad
        if '--slots' in sys.argv:
            d = Path(sys.argv[sys.argv.index('--slots') + 1])
            d.mkdir(parents=True, exist_ok=True)
            write_png(d / f'{name}.png', (np.clip(px, 0, 1) * 255 + 0.5).astype(np.uint8))
        meta[name] = {'px': [x0, y0, w, h], 'tileM': list(tile), 'kind': kind}
    out = (np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8)
    tmp = HERE / '_trim.png'
    write_png(tmp, out)
    subprocess.run([CWEBP, '-quiet', '-q', '82', '-m', '6', '-sns', '60', '-f', '30', str(tmp), '-o', str(HERE / 'trim.webp')], check=True)
    if '--preview' in sys.argv:
        tmp.replace(HERE.parent / 'out' / 'atlas-preview.png')
    else:
        tmp.unlink()
    (HERE / 'slots.json').write_text(json.dumps({'schema': 'allworld-trim-atlas', 'version': 1, 'size': SIZE, 'gutter': GUTTER, 'slots': meta}, indent=1) + '\n')
    print(f'wrote trim.webp ({(HERE / "trim.webp").stat().st_size} bytes) and slots.json with {len(meta)} slots')


if __name__ == '__main__':
    main()
