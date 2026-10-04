/**
 * OWNER: scenes
 * Shared procedural prop library. Every prop is `(b, x, z, options?)` (a few take y as well),
 * draws into a geometry batch (src/scene/build.js) and therefore costs no draw call of its
 * own. Props sit on the ground at y = 0 and face +z unless turned with `ry`.
 *
 * Scale: a person is about 2.45 tall, a seat 0.6, a table 1.05, a counter 1.35, a wall 5.5.
 * `tree` and `lamp` at the bottom are the original kit-based props, kept for other callers.
 */
import { GLOW, GLASS } from './build.js';
import { drawAvatar } from './characters.js';

export const WOOD = '#8a6644', WOOD_DARK = '#5f4630', WOOD_LIGHT = '#b08a5c', METAL = '#7d858c', METAL_DARK = '#3d444b';
export const WHITE = '#ece8dc', BLACK = '#22252a', LEAF = '#3f8a57', LEAF_DARK = '#2c6b4a', LEAF_LIGHT = '#6aa95a', WARM = '#ffd58a';

/** Floor slab with a back wall (−z) and a left wall (−x); the camera looks in from the front right. */
export function room(b, { w = 24, d = 20, h = 5.5, floor = '#b9a98c', wall = '#d8cdb4', side = wall, trim = '#8b7a62', base = '#5a5148' } = {}) {
  b.box(0, -0.25, 0, w + 1, 0.5, d + 1, base);
  b.box(0, 0.02, 0, w, 0.06, d, floor);
  b.box(0, h / 2, -d / 2 - 0.2, w + 0.8, h, 0.4, wall);
  b.box(-w / 2 - 0.2, h / 2, 0, 0.4, h, d, side);
  b.box(0, 0.2, -d / 2 + 0.04, w, 0.4, 0.08, trim);
  b.box(-w / 2 + 0.04, 0.2, 0, 0.08, 0.4, d, trim);
  b.box(0, h + 0.1, -d / 2 - 0.2, w + 0.8, 0.2, 0.5, trim);
  b.box(-w / 2 - 0.2, h + 0.1, 0, 0.5, 0.2, d, trim);
}

/** Outdoor ground slab with an optional lighter inset (path, plaza). */
export function ground(b, { w = 30, d = 26, color = '#4f7d4c', edge = '#3b5d3d' } = {}) {
  b.box(0, -0.3, 0, w + 1, 0.5, d + 1, edge);
  b.box(0, -0.02, 0, w, 0.1, d, color);
}

export function table(b, x, z, { w = 2.2, d = 1.2, h = 1.05, color = WOOD, leg = WOOD_DARK, ry = 0, round = false } = {}) {
  b.at(x, 0, z, ry, () => {
    if (round) {
      b.cyl(0, h - 0.05, 0, w / 2, 0.1, color, { seg: 12 });
      b.cyl(0, (h - 0.1) / 2, 0, 0.1, h - 0.1, leg, { seg: 6 });
      b.cyl(0, 0.04, 0, w * 0.28, 0.08, leg, { seg: 8 });
    } else {
      b.box(0, h - 0.05, 0, w, 0.1, d, color);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * (w / 2 - 0.12), (h - 0.1) / 2, sz * (d / 2 - 0.12), 0.1, h - 0.1, 0.1, leg);
    }
  });
}

export function chair(b, x, z, { ry = 0, color = '#4d6f8f', leg = METAL_DARK, seat = 0.6 } = {}) {
  b.at(x, 0, z, ry, () => {
    b.box(0, seat - 0.05, 0, 0.62, 0.1, 0.6, color);
    b.box(0, seat + 0.42, -0.27, 0.62, 0.75, 0.08, color);
    b.box(0, (seat - 0.1) / 2, 0, 0.5, seat - 0.1, 0.08, leg);
  });
}

export function stool(b, x, z, { color = WOOD, h = 0.6, r = 0.3 } = {}) {
  b.cyl(x, h - 0.05, z, r, 0.1, color, { seg: 8 });
  b.cyl(x, (h - 0.1) / 2, z, 0.06, h - 0.1, METAL_DARK, { seg: 5 });
}

export function bench(b, x, z, { w = 3, ry = 0, color = WOOD, leg = WOOD_DARK, back = false, seat = 0.6 } = {}) {
  b.at(x, 0, z, ry, () => {
    b.box(0, seat - 0.05, 0, w, 0.1, 0.55, color);
    for (const side of [-1, 1]) b.box(side * (w / 2 - 0.2), (seat - 0.1) / 2, 0, 0.12, seat - 0.1, 0.48, leg);
    if (back) b.box(0, seat + 0.4, -0.25, w, 0.5, 0.08, color);
  });
}

export function sofa(b, x, z, { w = 3, ry = 0, color = '#7a5c8e', cushion } = {}) {
  const pad = cushion || color;
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.3, 0, w, 0.6, 1.1, color);
    b.box(0, 0.63, 0.08, w - 0.5, 0.12, 0.9, pad);
    b.box(0, 0.85, -0.45, w, 0.9, 0.3, color);
    for (const side of [-1, 1]) b.box(side * (w / 2 - 0.13), 0.6, 0, 0.26, 0.5, 1.1, color);
  });
}

export function counter(b, x, z, { w = 5, d = 1, h = 1.35, ry = 0, color = WOOD, top = WOOD_LIGHT, stripe } = {}) {
  b.at(x, 0, z, ry, () => {
    b.box(0, (h - 0.1) / 2, 0, w, h - 0.1, d, color);
    b.box(0, h - 0.05, 0, w + 0.2, 0.1, d + 0.2, top);
    if (stripe) b.box(0, h * 0.55, d / 2 + 0.01, w, 0.18, 0.03, stripe);
  });
}

/** Market stall: posts, striped awning, a display table and heaps of goods. */
export function stall(b, x, z, { w = 3.6, ry = 0, awning = ['#d2553f', '#f0e2c0'], goods = ['#d9482f', '#e8a13a', '#5f9a48'], frame = WOOD_DARK } = {}) {
  b.at(x, 0, z, ry, () => {
    for (const side of [-1, 1]) {
      b.box(side * (w / 2 - 0.08), 1.5, 0.75, 0.12, 3, 0.12, frame);
      b.box(side * (w / 2 - 0.08), 1.75, -0.75, 0.12, 3.5, 0.12, frame);
    }
    const stripes = 6;
    for (let i = 0; i < stripes; i++) b.box(-w / 2 + (i + 0.5) * (w / stripes), 3.32, 0.1, w / stripes, 0.1, 2.3, awning[i % awning.length], { rx: 0.2 });
    b.box(0, 0.95, 0.2, w - 0.3, 0.12, 1.3, WOOD);
    b.box(0, 0.45, 0.2, w - 0.5, 0.9, 1.1, WOOD_DARK);
    const heaps = goods.length;
    for (let i = 0; i < heaps; i++) {
      const gx = -w / 2 + 0.3 + (i + 0.5) * ((w - 0.6) / heaps);
      b.box(gx, 1.08, 0.2, (w - 0.9) / heaps, 0.16, 1.05, '#c9a56a');
      b.ico(gx, 1.3, 0.2, (w - 1.3) / heaps / 2, 0.26, 0.42, goods[i]);
    }
  });
}

export function speaker(b, x, z, { h = 2, w = 1, ry = 0, color = '#26282d', cone = '#4a4e57', y = 0 } = {}) {
  b.at(x, y, z, ry, () => {
    b.box(0, h / 2, 0, w, h, w * 0.8, color);
    b.cyl(0, h * 0.68, w * 0.4, w * 0.22, 0.05, cone, { rx: Math.PI / 2, seg: 8 });
    b.cyl(0, h * 0.3, w * 0.4, w * 0.34, 0.05, cone, { rx: Math.PI / 2, seg: 8 });
  });
}

/** A framed display panel centred on x, y, z, facing +z. `lit` panels sit on the glow layer. */
export function screen(b, x, y, z, { w = 3, h = 1.8, ry = 0, color = '#7fd1e8', frame = BLACK, lit = true, stand = false } = {}) {
  b.at(x, y, z, ry, () => {
    b.box(0, 0, 0, w + 0.2, h + 0.2, 0.12, frame);
    b.quad(0, 0, 0.07, w, h, color, lit ? GLOW : undefined);
    if (stand) { b.box(0, -h / 2 - 0.4, 0, 0.14, 0.7, 0.1, frame); b.box(0, -h / 2 - 0.72, 0, 0.9, 0.06, 0.45, frame); }
  });
}

export function plant(b, x, z, { s = 1, pot = '#b06a4a', leaf = LEAF } = {}) {
  b.cyl(x, 0.3 * s, z, 0.34 * s, 0.6 * s, pot, { top: 1.25, seg: 7 });
  b.ico(x, 1.05 * s, z, 0.5 * s, 0.7 * s, 0.5 * s, leaf);
  b.ico(x + 0.2 * s, 1.5 * s, z - 0.1 * s, 0.34 * s, 0.5 * s, 0.34 * s, LEAF_LIGHT);
}

export function palm(b, x, z, { s = 1, lean = 0.12, ry = 0 } = {}) {
  b.at(x, 0, z, ry, () => {
    const height = 5.2 * s;
    for (let i = 0; i < 4; i++) b.cyl(lean * i * i * 0.35 * s, (i + 0.5) * height / 4, 0, (0.24 - i * 0.03) * s, height / 4 + 0.05, i % 2 ? '#8b7355' : '#7a6449', { seg: 6, rz: -lean * i * 0.5 });
    const tx = lean * 9 * 0.35 * s + lean * 1.6 * s;
    for (let i = 0; i < 7; i++) {
      const turn = (i / 7) * Math.PI * 2;
      b.at(tx, height, 0, turn, () => {
        b.box(0, 0.08 * s, 0.85 * s, 0.5 * s, 0.06, 1.6 * s, i % 2 ? LEAF : LEAF_LIGHT, { rx: 0.3 });
        b.box(0, -0.42 * s, 2.05 * s, 0.38 * s, 0.06, 1.1 * s, i % 2 ? LEAF_DARK : LEAF, { rx: 0.95 });
      });
    }
    for (const [cx, cz] of [[0.18, 0.1], [-0.12, 0.16], [0, -0.2]]) b.ico(tx + cx * s, height - 0.22 * s, cz * s, 0.15 * s, 0.17 * s, 0.15 * s, '#7a5a34');
  });
}

export function leafTree(b, x, z, { s = 1, tone = 0 } = {}) {
  const [a, c, d] = [[LEAF_DARK, LEAF, LEAF_LIGHT], ['#2f6f5c', '#3d8468', '#5b9f74'], ['#4d7f3d', '#6a9a45', '#8cb354']][tone % 3];
  b.cyl(x, 1.4 * s, z, 0.26 * s, 2.8 * s, '#6b5440', { top: 0.7, seg: 6 });
  b.ico(x, 3.5 * s, z, 1.8 * s, 2.1 * s, 1.7 * s, a);
  b.ico(x + 0.85 * s, 4.1 * s, z - 0.3 * s, 1.3 * s, 1.45 * s, 1.25 * s, c);
  b.ico(x - 0.7 * s, 4.3 * s, z + 0.5 * s, 1.05 * s, 1.15 * s, 1 * s, d);
}

export function bush(b, x, z, { s = 1, color = LEAF } = {}) {
  b.ico(x, 0.45 * s, z, 0.8 * s, 0.6 * s, 0.7 * s, color);
  b.ico(x + 0.55 * s, 0.35 * s, z + 0.2 * s, 0.5 * s, 0.45 * s, 0.5 * s, LEAF_DARK);
}

/** Street lamp. `light` adds a real point light; leave it off for most lamps to stay cheap. */
export function lampPost(b, x, z, { h = 4, light = false, color = '#34413f' } = {}) {
  b.cyl(x, h / 2, z, 0.07, h, color, { seg: 5 });
  b.cyl(x, 0.1, z, 0.2, 0.2, color, { seg: 6 });
  b.box(x, h + 0.1, z, 0.42, 0.55, 0.42, WARM, GLOW);
  b.box(x, h + 0.44, z, 0.62, 0.1, 0.62, color);
  if (light) b.light(x, h - 0.2, z, '#ffc878', 22, 12);
}

/** Bookcase / goods shelf with rows of small coloured boxes on its front (+z) face. */
export function shelf(b, x, z, { w = 3, h = 3.6, d = 0.6, ry = 0, color = WOOD_DARK, rows = 3, per = 6, items = ['#7c9a9c', '#b6867c', '#a79c62', '#7f77a0', '#b9603f'], y = 0 } = {}) {
  b.at(x, y, z, ry, () => {
    b.box(0, h / 2, -d * 0.2, w, h, d * 0.6, color);
    const step = (h - 0.3) / rows;
    for (let row = 0; row < rows; row++) {
      const ry0 = 0.2 + row * step;
      b.box(0, ry0, 0.06, w, 0.1, d, WOOD);
      for (let i = 0; i < per; i++) {
        const tall = step * (0.5 + ((i * 7 + row * 3) % 4) * 0.09);
        b.box(-w / 2 + (i + 0.5) * (w / per), ry0 + 0.05 + tall / 2, 0.12, (w / per) * 0.72, tall, d * 0.55, items[(i + row * 2) % items.length]);
      }
    }
  });
}

export function bed(b, x, z, { ry = 0, frame = METAL, sheet = '#e9eef0', blanket = '#7fb0c9' } = {}) {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.45, 0, 1.5, 0.14, 3.2, frame);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.68, 0.2, sz * 1.5, 0.1, 0.4, 0.1, frame);
    b.box(0, 0.66, 0, 1.4, 0.28, 3.05, sheet);
    b.box(0, 0.83, 0.55, 1.44, 0.1, 1.9, blanket);
    b.box(0, 0.88, -1.15, 0.9, 0.16, 0.5, WHITE);
    b.box(0, 0.95, -1.56, 1.5, 1.1, 0.1, frame);
  });
}

/** Open laptop on a surface at height y. */
export function laptop(b, x, y, z, { ry = 0, color = '#c9ced3', lit = '#9fd8ff' } = {}) {
  b.at(x, y, z, ry, () => {
    b.box(0, 0.025, 0, 0.6, 0.05, 0.42, color);
    b.box(0, 0.25, -0.24, 0.6, 0.42, 0.04, color, { rx: -0.25 });
    b.quad(0, 0.25, -0.21, 0.52, 0.34, lit, { rx: -0.25, layer: 'glow' });
  });
}

/** Work desk with a chair on its +z side. */
export function desk(b, x, z, { ry = 0, w = 2.2, color = WOOD_LIGHT, laptop: withLaptop = true, seatColor = '#4d6f8f' } = {}) {
  b.at(x, 0, z, ry, () => {
    table(b, 0, 0, { w, d: 1.1, color });
    if (withLaptop) laptop(b, 0, 1.05, -0.05, { ry: Math.PI });
    chair(b, 0, 0.95, { ry: Math.PI, color: seatColor });
  });
}

export function rug(b, x, z, w, d, color, { ry = 0, border } = {}) {
  b.at(x, 0, z, ry, () => {
    if (border) b.box(0, 0.06, 0, w + 0.4, 0.03, d + 0.4, border);
    b.box(0, 0.075, 0, w, 0.04, d, color);
  });
}

/** A row of bottles (alternating colours) along local x. */
export function bottles(b, x, y, z, { n = 6, gap = 0.3, ry = 0, colors = ['#5f9a62', '#c9973f', '#a14b3c', '#d9d2b8'], lit = false } = {}) {
  b.at(x, y, z, ry, () => {
    for (let i = 0; i < n; i++) b.cyl((i - (n - 1) / 2) * gap, 0.2, 0, 0.07, 0.4, colors[i % colors.length], { seg: 5, top: 0.45, ...(lit ? GLOW : null) });
  });
}

/** Cooking pot with a lid and a visible stew colour. */
export function pot(b, x, y, z, { r = 0.42, color = '#3a3d42', food = '#b8652f', lid = false } = {}) {
  b.cyl(x, y + r * 0.6, z, r, r * 1.2, color, { seg: 9, top: 1.1 });
  b.cyl(x, y + r * 1.22, z, r * 1.02, 0.05, food, { seg: 9 });
  if (lid) { b.cyl(x, y + r * 1.32, z, r * 1.12, 0.1, '#8b9096', { seg: 9, top: 0.6 }); b.ball(x, y + r * 1.48, z, 0.07, 0.07, 0.07, BLACK, { seg: 5 }); }
}

export function crate(b, x, y, z, { s = 0.7, color = WOOD_LIGHT, fill } = {}) {
  b.box(x, y + s * 0.3, z, s, s * 0.6, s, color);
  if (fill) b.box(x, y + s * 0.62, z, s * 0.86, 0.08, s * 0.86, fill);
}

export function column(b, x, z, { h = 5, r = 0.4, color = WHITE, seg = 8 } = {}) {
  b.box(x, 0.15, z, r * 2.8, 0.3, r * 2.8, color);
  b.cyl(x, h / 2, z, r, h - 0.6, color, { seg, top: 0.86 });
  b.box(x, h - 0.15, z, r * 2.6, 0.3, r * 2.6, color);
}

/** Flag on a pole; `colors` are vertical bands, left to right. */
export function flag(b, x, z, { h = 6, colors = ['#2f8f55', WHITE, '#2f8f55'], w = 1.8, ry = 0 } = {}) {
  b.at(x, 0, z, ry, () => {
    b.cyl(0, h / 2, 0, 0.06, h, '#c9ced3', { seg: 5 });
    b.cyl(0, 0.12, 0, 0.3, 0.24, METAL, { seg: 6 });
    b.ball(0, h + 0.06, 0, 0.11, 0.11, 0.11, '#d9b24c', { seg: 5 });
    const band = w / colors.length;
    colors.forEach((color, i) => b.box(0.08 + band * (i + 0.5), h - 0.6, 0, band, 1.05, 0.04, color));
  });
}

/** Parasol / canopy umbrella. */
export function parasol(b, x, z, { h = 2.9, r = 1.7, colors = ['#e9614b', WHITE] } = {}) {
  b.cyl(x, h / 2, z, 0.05, h, WOOD_DARK, { seg: 5 });
  b.cone(x, h + 0.15, z, r, 0.6, colors[0], { seg: 8 });
  b.cyl(x, h - 0.17, z, r, 0.06, colors[1] || colors[0], { seg: 8 });
}

/** Rope barrier: posts at the given [x, z] points with a rope between neighbours. */
export function ropeLine(b, points, { post = '#c9a14a', rope = '#a8323a', h = 1.05 } = {}) {
  points.forEach(([x, z], i) => {
    b.cyl(x, h / 2, z, 0.06, h, post, { seg: 5 });
    b.cyl(x, 0.04, z, 0.2, 0.08, post, { seg: 6 });
    const next = points[i + 1];
    if (next) {
      const dx = next[0] - x, dz = next[1] - z;
      b.box((x + next[0]) / 2, h - 0.2, (z + next[1]) / 2, 0.06, 0.06, Math.hypot(dx, dz), rope, { ry: Math.atan2(dx, dz) });
    }
  });
}

/** A sagging string of small lit bulbs between two [x, y, z] points. */
export function stringLights(b, from, to, { n = 9, sag = 0.5, colors = [WARM, '#ffb0a0', '#bfe3ff'] } = {}) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const flat = Math.hypot(dx, dz);
  b.box((from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - sag * 0.6, (from[2] + to[2]) / 2, 0.03, 0.03, Math.hypot(flat, dy), BLACK, { ry: Math.atan2(dx, dz), rx: -Math.atan2(dy, flat) });
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    b.box(from[0] + dx * t, from[1] + dy * t - sag * 4 * t * (1 - t) - 0.08, from[2] + dz * t, 0.14, 0.14, 0.14, colors[i % colors.length], GLOW);
  }
}

export function fence(b, from, to, { h = 1, color = WOOD_LIGHT, gap = 1.4 } = {}) {
  const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz), ry = Math.atan2(dx, dz);
  const posts = Math.max(2, Math.round(length / gap) + 1);
  for (let i = 0; i < posts; i++) b.box(from[0] + dx * i / (posts - 1), h / 2, from[1] + dz * i / (posts - 1), 0.12, h, 0.12, color);
  for (const y of [h * 0.45, h * 0.85]) b.box((from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2, 0.06, 0.1, length, color, { ry });
}

/** Window panel on a wall, centred on x, y, z and facing +z. Lit at night through the glow layer. */
export function windowPane(b, x, y, z, { w = 1.6, h = 1.8, ry = 0, frame = WHITE, glass = '#a9d3e6', lit = false } = {}) {
  b.at(x, y, z, ry, () => {
    b.box(0, 0, 0, w + 0.2, h + 0.2, 0.1, frame);
    b.quad(0, 0, 0.06, w, h, glass, lit ? GLOW : undefined);
    b.box(0, 0, 0.07, 0.06, h, 0.03, frame);
    b.box(0, 0, 0.07, w, 0.06, 0.03, frame);
  });
}

export function door(b, x, z, { w = 1.5, h = 3, ry = 0, color = WOOD_DARK, frame = WOOD, knob = '#d9b24c' } = {}) {
  b.at(x, 0, z, ry, () => {
    b.box(0, h / 2, 0, w + 0.3, h + 0.15, 0.12, frame);
    b.box(0, h / 2 - 0.04, 0.05, w, h - 0.08, 0.1, color);
    b.ball(w / 2 - 0.2, h * 0.45, 0.14, 0.07, 0.07, 0.07, knob, { seg: 5 });
  });
}

/** A translucent slab (pool, aquarium, shop window). */
export function glassPanel(b, x, y, z, w, h, d, color = '#9fd0e6', o) { b.box(x, y, z, w, h, d, color, { ...o, ...GLASS }); }

/** Ground marker for a spot the player can stand at. */
export function spotMarker(b, x, z, color = '#f2d27a', y = 0) {
  b.disc(x, y + 0.085, z, 0.62, color, { seg: 14 });
  b.disc(x, y + 0.095, z, 0.42, '#3b3f46', { seg: 14 });
}

/** Small serving kiosk with a roof, hatch, counter and an optional fascia text. */
export function kiosk(b, x, z, { ry = 0, w = 3.6, color = '#c69a4e', roof = '#b5483f', fascia = '#e2bb62', text, textColor = '#3a2a1a' } = {}) {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.08, 0.2, w + 0.8, 0.16, 3.4, '#8f8b7c');
    b.box(0, 1.5, -0.5, w, 2.84, 1.8, color);
    b.box(0, 2.1, 0.42, w - 0.6, 1.1, 0.06, '#2a3230');
    b.box(0, 1.42, 0.7, w + 0.2, 0.14, 0.8, WOOD_LIGHT);
    b.box(0, 0.7, 0.6, w, 1.3, 0.5, color);
    b.box(0, 3.02, 0.1, w + 0.9, 0.2, 3.3, roof);
    b.box(0, 2.74, 1.7, w + 0.9, 0.4, 0.08, fascia);
    if (text) sign(b, 0, 2.74, 1.75, text, { size: 0.24, color: textColor });
    bottles(b, 0, 1.49, 0.8, { n: 5, gap: 0.5 });
  });
}

/** Tall forest tree: a long trunk with a high crown. */
export function tallTree(b, x, z, { h = 8, s = 1, tone = 0 } = {}) {
  const [a, c] = [[LEAF_DARK, LEAF], ['#2f6f5c', '#3d8468'], ['#4d7f3d', '#6a9a45']][tone % 3];
  b.cyl(x, h / 2, z, 0.3 * s, h, '#6b5440', { top: 0.6, seg: 6 });
  b.ico(x, h + 0.6 * s, z, 2 * s, 1.6 * s, 1.9 * s, a);
  b.ico(x + 0.9 * s, h + 1.5 * s, z - 0.4 * s, 1.3 * s, 1.2 * s, 1.3 * s, c);
}

/** Simple parked car. */
export function car(b, x, z, { ry = 0, color = '#22262c', glass = '#8fb8cc' } = {}) {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.62, 0, 1.9, 0.6, 4.2, color);
    b.box(0, 1.2, -0.2, 1.7, 0.6, 2.3, color);
    b.box(0, 1.22, -0.2, 1.74, 0.42, 2.0, glass);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.9, 0.36, sz * 1.35, 0.36, 0.24, BLACK, { seg: 8, rz: Math.PI / 2 });
    for (const sx of [-1, 1]) b.box(sx * 0.62, 0.72, 2.11, 0.36, 0.16, 0.04, WARM, GLOW);
  });
}

/** A landmark a venue spot can attach to: key, a pattern matched against "id label", position, facing. */
export const landmark = (key, match, x, z, ry = 0, more) => ({ key, match, x, z, ry, ...more });

/** A background character baked into the static scene (staff, regulars). Looks come from the seed. */
export const extra = (b, seed, x, z, ry = 0, pose = 'stand', more) => drawAvatar(b, more?.look ?? null, { seed, x, z, ry, pose, ...more });

// ---------------------------------------------------------------------------------------------
// Block lettering: text is drawn from a 3×5 cell font as flat panels — no canvas, no textures.
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', '!': '010010010000010', '+': '000010111010000',
  ':': '000010000010000', '/': '001001010100100',
};

/** Width of a line of block text at a given letter height. */
export const textWidth = (text, size = 0.6) => Math.max(0, String(text).length * 4 - 1) * (size / 5);

/**
 * sign(b, x, y, z, text, { size, color, ry, lit, board, pad }) — block text centred on x, y, z,
 * facing +z. `board` is the backing colour (omit for bare letters); `lit` puts the letters on
 * the glow layer so they read as a lit sign at night.
 */
export function sign(b, x, y, z, text, { size = 0.6, color = WHITE, ry = 0, lit = false, board, pad = 0.25, depth = 0.1 } = {}) {
  const cell = size / 5, value = String(text).toUpperCase(), width = textWidth(value, size);
  b.at(x, y, z, ry, () => {
    if (board) b.box(0, 0, -depth / 2, width + pad * 2, size + pad * 2, depth, board);
    for (let i = 0; i < value.length; i++) {
      const glyph = FONT[value[i]];
      if (!glyph) continue;
      const left = -width / 2 + i * 4 * cell;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (glyph[row * 3 + col] !== '1') continue;
          let run = 1;
          while (col + run < 3 && glyph[row * 3 + col + run] === '1') run += 1;
          b.quad(left + (col + run / 2) * cell, size / 2 - (row + 0.5) * cell, 0.02, run * cell, cell * 1.02, color, lit ? GLOW : undefined);
          col += run;
        }
      }
    }
  });
}

/** Free-standing or wall signage board with block text. */
export function signBoard(b, x, z, text, { y = 2.6, size = 0.5, ry = 0, color = WHITE, board = '#2f4a45', lit = false, posts = true } = {}) {
  const width = textWidth(text, size) + 0.6;
  b.at(x, 0, z, ry, () => {
    if (posts) for (const side of [-1, 1]) b.box(side * (width / 2 - 0.1), y / 2, -0.1, 0.1, y, 0.1, METAL_DARK);
    sign(b, 0, y, 0, text, { size, color, board, lit, pad: 0.3 });
  });
}

// ---------------------------------------------------------------------------------------------
// Original kit-based props (one mesh per part). New scenes use the batch props above.

/** tree(kit, parent, x, z, size = 1) */
export function tree(kit, parent, x, z, size = 1) {
  const { round, mesh, crownGeometry } = kit;
  round(x, 1.45 * size, z, 0.25 * size, 2.9 * size, '#635141', parent);
  mesh(crownGeometry, x, 3.6 * size, z, 1.8 * size, 2.3 * size, 1.7 * size, '#2b6957', parent);
  mesh(crownGeometry, x + 0.8 * size, 4.1 * size, z - 0.3, 1.35 * size, 1.5 * size, 1.3 * size, '#39775b', parent);
}

/** lamp(kit, parent, x, z) — a street lamp with a warm point light */
export function lamp(kit, parent, x, z) {
  const { THREE, round, box } = kit;
  round(x, 2, z, 0.065, 4, '#344441', parent);
  box(x, 4.1, z, 0.44, 0.65, 0.44, '#ffe2a2', parent, true);
  box(x, 4.48, z, 0.65, 0.12, 0.65, '#394a43', parent);
  const light = new THREE.PointLight('#ffc878', 23, 12, 1.5);
  light.position.set(x, 3.8, z);
  parent.add(light);
}
