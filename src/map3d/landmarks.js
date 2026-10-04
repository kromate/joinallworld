/**
 * OWNER: world
 * The landmark buildings of the city map: one small procedural building per venue scene kind
 * (src/game/content/venues.js `scene.kind` / `scene.variant`), each on its own plinth and shaped
 * so that it says what it is before its label is read.
 *
 *   drawLandmark(g, kind, variant) → { top }       top = where the label pill sits
 * `g` is the builder's drawing context: g.b the geometry batch (solid / glow / glass layers),
 * g.w the window batch (quads that are dull glass by day and lit at night). The landmark is drawn
 * at the origin facing +z (the road); the builder places and turns it. Everything fits the
 * plinth, PLINTH × PLINTH units, whose top is at y = BASE.
 */
import { GLOW, GLASS } from '../scene/build.js';
import { sign } from '../scene/props.js';

export const PLINTH = 6.6;
export const BASE = 0.5;
const Y = BASE;
const WHITE = '#f1ede2', ZINC = '#9aa3a8', TERRACOTTA = '#b5593c', LEAF = '#3f8a57', LEAF_DARK = '#2c6b4a', WOOD = '#8a6644', LIT = ['#ffe6ae', '#fff4d6', '#ffd98a', '#cfe4ff'];

/** A window: a quad that faces +z turned by ry. `i` picks one of a few warm tones so a facade is not uniform. */
const win = (g, x, y, z, w, h, ry = 0, i = 0) => g.w.quad(x, y, z, w, h, LIT[i % LIT.length], { ry });
/** A grid of windows on a wall facing `ry`, centred on (cx, cy) at depth z along that facing. */
function winGrid(g, cx, cy, z, cols, rows, w, h, gx, gy, ry = 0, cz = 0) {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lx = (c - (cols - 1) / 2) * gx, ly = cy + (r - (rows - 1) / 2) * gy;
    win(g, cx + lx * cos + z * sin, ly, cz - lx * sin + z * cos, w, h, ry, r * 3 + c * 5);
  }
}
const tree = (b, x, z, s = 1, colour = LEAF) => { b.cyl(x, Y + 0.5 * s, z, 0.14 * s, 1 * s, '#6b4f36', { seg: 5 }); b.ico(x, Y + 1.5 * s, z, 0.85 * s, 0.95 * s, 0.85 * s, colour); };
function palm(b, x, z, s = 1) {
  b.cyl(x, Y + 1.4 * s, z, 0.12 * s, 2.8 * s, '#8a7250', { seg: 5, top: 0.7 });
  for (let i = 0; i < 5; i++) b.cone(x + Math.sin(i * 1.257) * 0.75 * s, Y + 2.75 * s, z + Math.cos(i * 1.257) * 0.75 * s, 0.34 * s, 1.5 * s, i % 2 ? LEAF : '#4f9a5f', { seg: 3, rz: -Math.sin(i * 1.257) * 1.25, rx: Math.cos(i * 1.257) * 1.25 });
}
/** A ridge roof: a triangular prism w wide, h high and d long (the ridge runs along z), sitting on y. */
const gable = (b, x, y, z, w, h, d, colour, ry = 0) => b.cyl(x, y + h / 3, z, 1, d, colour, { seg: 3, rx: -Math.PI / 2, ry, sx: w / 1.732, sz: h / 1.5 });
const flag = (b, x, z, h = 4) => { b.cyl(x, Y + h / 2, z, 0.06, h, '#c9ced3', { seg: 5 }); for (let i = 0; i < 3; i++) b.box(x + 0.25 + i * 0.4, Y + h - 0.35, z, 0.4, 0.6, 0.04, i === 1 ? WHITE : '#2f8f55'); };
function plinth(b, top = '#e7e1d0', rim = '#c9c1ab') {
  b.box(0, 0.12, 0, PLINTH + 0.5, 0.24, PLINTH + 0.5, rim);
  b.box(0, 0.36, 0, PLINTH, 0.3, PLINTH, top);
}

const KINDS = {
  park(g) {
    const { b } = g; plinth(b, '#7fb56a', '#5f9552');
    b.box(0, Y + 0.02, 0.4, 1.1, 0.04, 6.2, '#d8cdb0');
    for (const sx of [-1, 1]) b.box(sx * 0.9, Y + 0.9, 3.0, 0.36, 1.8, 0.36, WHITE);
    b.box(0, Y + 1.95, 3.0, 2.5, 0.34, 0.44, WHITE);
    sign(b, 0, Y + 1.95, 3.24, 'PARK', { size: 0.22, color: '#256b45' });
    b.cyl(0.2, Y + 0.15, -0.9, 1.5, 0.3, '#d8cdb0', { seg: 8 });
    for (let i = 0; i < 6; i++) b.cyl(0.2 + Math.sin(i * 1.047) * 1.25, Y + 1.0, -0.9 + Math.cos(i * 1.047) * 1.25, 0.07, 1.5, WHITE, { seg: 4 });
    b.cone(0.2, Y + 2.2, -0.9, 1.75, 0.95, TERRACOTTA, { seg: 8 });
    tree(b, -2.3, -2.2, 1.25); tree(b, 2.4, -2.3, 1.05, LEAF_DARK); tree(b, -2.4, 1.2, 0.95, '#5aa55f'); tree(b, 2.5, 0.9, 1.1);
    b.box(-1.5, Y + 0.25, 1.9, 1.1, 0.1, 0.36, WOOD); b.box(1.6, Y + 0.25, 2.0, 1.1, 0.1, 0.36, WOOD);
    return 3.6;
  },
  club(g, variant) {
    const { b } = g;
    if (variant === 'speakeasy') {
      plinth(b);
      b.box(0, Y + 1.7, -0.5, 5.2, 3.4, 4.2, '#7c4a36');
      b.box(0, Y + 3.5, -0.5, 5.5, 0.26, 4.5, '#5a3628');
      const books = ['#c9423a', '#3f72c4', '#d6a83a', '#3f9a5a', '#8055c2', '#ece2c6'];
      for (let i = 0; i < 9; i++) b.box(-2.2 + i * 0.55, Y + 1.25 + (i % 3) * 0.12, 1.66, 0.42, 1.9 + (i % 3) * 0.24, 0.14, books[i % books.length]);
      b.box(0, Y + 0.28, 1.72, 5.0, 0.12, 0.3, '#5a3628');
      b.box(2.05, Y + 0.85, 1.64, 0.9, 1.7, 0.1, '#2a1c16');
      sign(b, -0.4, Y + 2.95, 1.64, 'LIBRARY', { size: 0.34, color: '#ffd98a', lit: true, board: '#2a1c16', pad: 0.14 });
      b.box(2.05, Y + 1.95, 1.75, 0.3, 0.3, 0.3, '#ffb347', GLOW);
      winGrid(g, 0, Y + 2.0, 2.61, 2, 1, 0.7, 0.9, 1.6, 1, Math.PI / 2);
      return 4.2;
    }
    plinth(b, '#3a3550', '#2a2640');
    b.box(0, Y + 1.9, -0.4, 5.0, 3.8, 4.4, '#17161f');
    b.box(0, Y + 3.9, -0.4, 5.3, 0.22, 4.7, '#2a2836');
    for (const [y, colour] of [[1.0, '#ff4fd8'], [2.2, '#38e1ff'], [3.3, '#ff4fd8']]) { b.box(0, Y + y, 1.82, 5.02, 0.12, 0.05, colour, GLOW); b.box(2.52, Y + y, -0.4, 0.05, 0.12, 4.42, colour, GLOW); b.box(-2.52, Y + y, -0.4, 0.05, 0.12, 4.42, colour, GLOW); }
    sign(b, 0, Y + 2.75, 1.84, 'CLUB', { size: 0.5, color: '#ffe86b', lit: true });
    b.box(0, Y + 0.85, 1.84, 1.1, 1.7, 0.08, '#6a3fa0', GLOW);
    for (const sx of [-1, 1]) { b.cyl(sx * 1.3, Y + 0.45, 2.6, 0.07, 0.9, '#d6a83a', { seg: 5 }); b.ico(sx * 1.3, Y + 0.95, 2.6, 0.12, 0.12, 0.12, '#d6a83a'); }
    b.box(0, Y + 0.75, 2.6, 2.6, 0.06, 0.06, '#b23a2e');
    for (const [x, colour, rz] of [[-1.6, '#ff4fd8', 0.3], [1.6, '#38e1ff', -0.3]]) b.cone(x, Y + 5.4, -0.6, 0.5, 3.0, colour, { seg: 5, rz: Math.PI + rz, layer: 'glass' });
    b.ball(0, Y + 4.5, -0.4, 0.5, 0.5, 0.5, '#e9edf2', { seg: 6, ...GLOW });
    return 5.2;
  },
  home(g) {
    const { b } = g; plinth(b, '#9cc47f', '#6f9f5c');
    b.box(0, Y + 1.25, -0.6, 3.8, 2.5, 3.2, '#f0e6cf');
    gable(b, 0, Y + 2.5, -0.6, 4.5, 1.5, 3.9, TERRACOTTA);
    b.box(0.9, Y + 0.7, 1.02, 0.8, 1.4, 0.08, '#256b45');
    b.box(0.9, Y + 0.05, 1.5, 1.2, 0.1, 0.9, '#d8cdb0');
    win(g, -0.85, Y + 1.5, 1.02, 0.9, 0.8); win(g, 1.92, Y + 1.5, -0.6, 0.8, 0.8, Math.PI / 2, 1); win(g, -1.92, Y + 1.5, -0.6, 0.8, 0.8, -Math.PI / 2, 2);
    b.box(-1.2, Y + 3.3, -1.2, 0.4, 1.0, 0.4, '#8f8577');
    for (let i = 0; i < 9; i++) { b.box(-2.9 + i * 0.72, Y + 0.3, 2.95, 0.12, 0.6, 0.12, WHITE); }
    b.box(0, Y + 0.42, 2.95, 5.9, 0.08, 0.06, WHITE);
    tree(b, -2.4, 1.7, 0.9); b.ico(2.5, Y + 0.3, 2.0, 0.5, 0.36, 0.5, LEAF_DARK);
    return 4.4;
  },
  radio(g) {
    const { b } = g; plinth(b);
    b.box(-0.9, Y + 1.0, 0.3, 4.2, 2.0, 3.4, '#e9dfc8');
    b.box(-0.9, Y + 2.1, 0.3, 4.5, 0.22, 3.7, '#c9423a');
    sign(b, -0.9, Y + 1.55, 2.02, 'ON AIR', { size: 0.3, color: '#ff5a4a', lit: true, board: '#2a2c31', pad: 0.12 });
    winGrid(g, -0.9, Y + 0.75, 2.01, 3, 1, 0.7, 0.6, 1.2, 1);
    b.cyl(-2.2, Y + 2.6, -0.6, 0.75, 0.2, '#dfe4e6', { seg: 8, top: 0.4, rx: 0.6 });
    for (let i = 0; i < 6; i++) {       // the mast: a tapering lattice, red and white
      const y = Y + 0.7 + i * 1.3, w = 0.9 - i * 0.12;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(2.2 + sx * w / 2, y, -1.2 + sz * w / 2, 0.09, 1.34, 0.09, i % 2 ? WHITE : '#c9423a');
      b.box(2.2, y + 0.62, -1.2, w + 0.1, 0.06, w + 0.1, '#8a8f95');
    }
    b.cyl(2.2, Y + 8.6, -1.2, 0.04, 1.2, '#8a8f95', { seg: 4 });
    b.ico(2.2, Y + 9.3, -1.2, 0.2, 0.2, 0.2, '#ff3b30', GLOW);
    return 9.6;
  },
  shrine(g) {
    const { b } = g; plinth(b, '#c9a77a', '#a2835c');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 2.7, Y + 1.4, sz * 2.3 - 0.2, 0.26, 2.8, 0.26, '#5f4630');
    b.box(0, Y + 3.0, -0.2, 6.2, 0.16, 5.4, ZINC, { rx: -0.07 });
    b.box(0, Y + 0.45, -1.9, 4.8, 0.9, 1.6, '#3a2f2a');                  // the stage
    for (const [i, colour] of ['#c9423a', '#e8c13a', '#2f8f55'].entries()) b.box(-1.6 + i * 1.6, Y + 2.2, -2.72, 1.6, 1.4, 0.06, colour);
    for (const sx of [-1, 1]) { b.box(sx * 2.0, Y + 1.5, -1.9, 0.7, 1.2, 0.7, '#22252a'); b.cyl(sx * 2.0, Y + 1.6, -1.52, 0.22, 0.06, '#55595f', { seg: 6, rx: Math.PI / 2 }); }
    for (let i = 0; i < 5; i++) b.box(-1.6 + i * 0.8, Y + 2.85, -1.2, 0.2, 0.14, 0.2, ['#ff5a4a', '#ffe86b', '#58d68a', '#6fb4ff', '#ff4fd8'][i], GLOW);
    b.cyl(0, Y + 1.5, -1.9, 0.06, 1.2, '#c9ced3', { seg: 4 });           // the microphone, and a saxophone in gold
    b.cyl(0.7, Y + 1.5, -1.8, 0.09, 1.0, '#d6a83a', { seg: 5, rz: 0.3 }); b.cone(0.95, Y + 1.05, -1.8, 0.22, 0.4, '#d6a83a', { seg: 6, rz: 2.4 });
    for (let i = 0; i < 3; i++) b.box(-1.5 + i * 1.5, Y + 0.25, 1.1, 1.2, 0.1, 0.36, WOOD);
    sign(b, 0, Y + 3.45, 2.4, 'SHRINE', { size: 0.36, color: '#ffe86b', lit: true, board: '#3a2f2a', pad: 0.14 });
    return 4.3;
  },
  viewing(g) {
    const { b } = g; plinth(b, '#d9d2bd');
    b.box(0, Y + 0.04, 0.5, 4.4, 0.06, 3.0, '#4c9a52');                  // a strip of pitch
    b.box(0, Y + 0.08, 0.5, 0.06, 0.02, 3.0, WHITE); b.cyl(0, Y + 0.08, 0.5, 0.6, 0.02, WHITE, { seg: 10, open: true });
    for (let step = 0; step < 4; step++) for (const sx of [-1, 1]) b.box(sx * (2.5 + step * 0.22), Y + 0.25 + step * 0.42, 0.5, 0.5, 0.5 + step * 0.84, 4.6, step % 2 ? '#3f72c4' : '#ece2c6');
    b.box(0, Y + 2.0, -2.7, 5.2, 2.7, 0.3, '#22252a');                   // the big screen
    b.box(0, Y + 2.1, -2.52, 4.7, 2.2, 0.05, '#4fbf6a', GLOW);
    b.box(0, Y + 2.1, -2.49, 0.05, 2.2, 0.02, '#eafff0', GLOW); b.cyl(0, Y + 2.1, -2.48, 0.45, 0.02, '#eafff0', { seg: 10, rx: Math.PI / 2, open: true, ...GLOW });
    for (const sx of [-1, 1]) { b.cyl(sx * 3.0, Y + 2.6, -2.6, 0.08, 5.2, '#8a8f95', { seg: 5 }); b.box(sx * 2.85, Y + 5.2, -2.5, 0.8, 0.4, 0.2, '#fff4d6', GLOW); }
    b.ball(0.9, Y + 0.28, 1.3, 0.22, 0.22, 0.22, WHITE, { seg: 6 });
    return 5.9;
  },
  buka(g) {
    const { b } = g; plinth(b, '#d2bf99', '#b09a72');
    b.box(-0.6, Y + 1.0, -0.9, 4.4, 2.0, 2.8, '#c98e55');
    b.box(-0.6, Y + 2.25, -0.6, 4.9, 0.14, 3.8, ZINC, { rx: 0.12 });
    b.box(-0.6, Y + 1.75, 1.3, 4.6, 0.1, 1.6, '#b5483f', { rx: 0.22 });
    for (const sx of [-1, 1]) b.box(-0.6 + sx * 2.1, Y + 0.8, 1.95, 0.1, 1.6, 0.1, '#5f4630');
    sign(b, -0.6, Y + 1.65, 0.54, 'AMALA', { size: 0.26, color: WHITE });
    b.box(-0.6, Y + 0.55, 0.9, 3.4, 0.1, 0.8, WOOD); for (const sx of [-1, 1]) b.box(-0.6 + sx * 1.5, Y + 0.27, 0.9, 0.12, 0.54, 0.7, '#5f4630');
    for (const [x, z, r] of [[2.3, 1.6, 0.55], [2.5, 0.2, 0.42]]) {      // the big pots, on the fire, smoking
      b.cyl(x, Y + 0.12, z, r * 0.9, 0.2, '#ff7a2f', { seg: 6, ...GLOW });
      b.cyl(x, Y + 0.55, z, r, 0.7, '#2a2c31', { seg: 8, top: 1.15 });
      b.cyl(x, Y + 0.92, z, r * 1.05, 0.06, '#b8652f', { seg: 8 });
      for (let i = 0; i < 3; i++) b.ico(x + (i % 2 ? 0.2 : -0.14), Y + 1.5 + i * 0.7, z - i * 0.16, 0.3 + i * 0.12, 0.26 + i * 0.1, 0.3 + i * 0.12, '#e9e6de', GLASS);
    }
    return 3.6;
  },
  hub(g) {
    const { b } = g; plinth(b);
    b.box(0, Y + 2.3, -0.5, 4.8, 4.6, 4.0, '#e3e8ea');
    for (let floor = 0; floor < 3; floor++) b.box(0, Y + 1.0 + floor * 1.5, 1.52, 4.6, 1.0, 0.06, '#8fc7dd', GLASS);
    winGrid(g, 0, Y + 2.5, 1.56, 4, 3, 0.9, 0.8, 1.12, 1.5);
    winGrid(g, 0, Y + 2.5, 2.41, 3, 3, 0.8, 0.8, 1.2, 1.5, Math.PI / 2);
    b.box(-2.0, Y + 2.3, 1.58, 0.7, 4.6, 0.12, '#3f9a5a');                // a living-wall stripe
    b.box(0, Y + 4.72, -0.5, 5.1, 0.24, 4.3, '#2f9d98');
    sign(b, 0.4, Y + 4.25, 1.6, 'HUB', { size: 0.42, color: '#eaffff', lit: true });
    b.box(1.4, Y + 5.1, -1.4, 1.4, 0.5, 1.0, '#8a9097'); b.cyl(-1.4, Y + 5.7, -1.4, 0.05, 1.8, '#8a8f95', { seg: 4 });
    b.cyl(-1.4, Y + 5.3, -1.1, 0.5, 0.12, '#dfe4e6', { seg: 8, top: 0.4, rx: 0.9 });
    b.box(0, Y + 0.6, 1.9, 1.4, 1.2, 0.7, '#2f9d98', GLASS);
    return 6.5;
  },
  hospital(g) {
    const { b } = g; plinth(b);
    b.box(0, Y + 1.8, -0.7, 5.4, 3.6, 3.4, WHITE);
    b.box(-1.9, Y + 1.1, 1.5, 1.8, 2.2, 1.4, WHITE);
    b.box(0, Y + 3.7, -0.7, 5.6, 0.2, 3.6, '#c9d2d4');
    for (const [w, h] of [[0.5, 1.5], [1.5, 0.5]]) { b.box(1.2, Y + 2.6, 1.03, w, h, 0.08, '#d9342b', GLOW); b.box(0, Y + 3.84, -0.7, w * 1.6, 0.06, h * 1.6, '#d9342b'); }
    winGrid(g, -1.0, Y + 2.2, 1.02, 2, 2, 0.6, 0.6, 1.0, 1.1); winGrid(g, 0, Y + 2.0, 2.71, 3, 2, 0.6, 0.6, 1.0, 1.2, Math.PI / 2); winGrid(g, 0, Y + 2.0, 2.71, 3, 2, 0.6, 0.6, 1.0, 1.2, -Math.PI / 2);
    b.box(1.3, Y + 1.5, 2.0, 2.6, 0.14, 1.9, '#3f72c4');                  // the ambulance bay
    for (const sx of [-1, 1]) b.box(1.3 + sx * 1.15, Y + 0.75, 2.8, 0.12, 1.5, 0.12, '#c9ced3');
    b.box(1.3, Y + 0.5, 2.2, 1.0, 0.8, 1.8, WHITE); b.box(1.3, Y + 0.6, 2.2, 1.02, 0.14, 1.82, '#d9342b'); b.box(1.3, Y + 0.98, 1.9, 0.4, 0.14, 0.3, '#6fb4ff', GLOW);
    return 4.5;
  },
  salon(g) {
    const { b } = g; plinth(b);
    b.box(0, Y + 1.3, -0.8, 4.2, 2.6, 3.0, '#f2b8c6');
    b.box(0, Y + 2.7, -0.8, 4.5, 0.22, 3.3, '#c2607c');
    for (let i = 0; i < 7; i++) b.box(-1.8 + i * 0.6, Y + 1.95, 1.2, 0.6, 0.1, 1.2, i % 2 ? WHITE : '#dd6fa0', { rx: 0.3 });
    b.box(-0.8, Y + 0.95, 0.72, 2.0, 1.3, 0.05, '#bfe0ee', GLASS); win(g, -0.8, Y + 0.95, 0.74, 1.8, 1.1);
    b.box(1.3, Y + 0.8, 0.72, 0.8, 1.6, 0.08, '#8055c2');
    sign(b, 0, Y + 3.25, 0.6, 'SALON', { size: 0.34, color: WHITE, board: '#c2607c', pad: 0.14, lit: true });
    for (let i = 0; i < 5; i++) b.cyl(2.5, Y + 0.5 + i * 0.3, 1.6, 0.14, 0.3, ['#d9342b', WHITE, '#3f72c4'][i % 3], { seg: 6 });     // the barber's pole
    b.ball(2.5, Y + 2.08, 1.6, 0.18, 0.18, 0.18, '#fff4d6', { seg: 5, ...GLOW });
    b.cyl(-2.4, Y + 0.3, 1.9, 0.3, 0.6, '#b06a4a', { seg: 6, top: 1.2 }); b.ico(-2.4, Y + 0.9, 1.9, 0.5, 0.5, 0.5, LEAF);
    return 4.0;
  },
  worship(g, variant) {
    const { b } = g;
    if (variant === 'mosque') {
      plinth(b, '#eee7d3');
      b.box(0, Y + 1.5, -0.4, 4.4, 3.0, 4.0, '#f4efe0');
      b.box(0, Y + 3.1, -0.4, 4.7, 0.24, 4.3, '#dcd3bb');
      b.cyl(0, Y + 3.5, -0.4, 1.5, 0.6, '#f4efe0', { seg: 10 });
      b.ball(0, Y + 3.8, -0.4, 1.5, 1.4, 1.5, '#2f8f55', { seg: 10 });
      b.cyl(0, Y + 5.5, -0.4, 0.04, 0.7, '#d6a83a', { seg: 4 }); b.ico(0, Y + 5.95, -0.4, 0.16, 0.16, 0.16, '#ffe08a', GLOW);
      for (let i = 0; i < 3; i++) { b.box(-1.3 + i * 1.3, Y + 0.9, 1.63, 0.8, 1.8, 0.06, '#2a5f48'); b.cyl(-1.3 + i * 1.3, Y + 1.8, 1.63, 0.4, 0.06, '#2a5f48', { seg: 8, rx: Math.PI / 2 }); }
      b.cyl(2.6, Y + 3.2, 2.2, 0.36, 6.4, '#f4efe0', { seg: 8 });         // the minaret
      b.cyl(2.6, Y + 4.9, 2.2, 0.56, 0.2, '#dcd3bb', { seg: 8 });
      b.cone(2.6, Y + 6.9, 2.2, 0.44, 1.1, '#2f8f55', { seg: 8 });
      b.ico(2.6, Y + 7.6, 2.2, 0.13, 0.13, 0.13, '#ffe08a', GLOW);
      win(g, 2.6, Y + 5.5, 2.57, 0.26, 0.5); winGrid(g, 0, Y + 1.7, 2.21, 2, 1, 0.5, 0.9, 1.6, 1, Math.PI / 2);
      return 7.9;
    }
    plinth(b, '#dfe6d3');
    b.box(0, Y + 1.4, -0.9, 3.2, 2.8, 4.2, '#efe9dc');
    gable(b, 0, Y + 2.8, -0.9, 3.7, 1.5, 4.8, '#7b4a3a');
    b.box(0, Y + 2.6, 1.9, 1.6, 5.2, 1.6, '#efe9dc');                    // the tower
    b.cone(0, Y + 6.5, 1.9, 1.2, 2.6, '#7b4a3a', { seg: 4, ry: Math.PI / 4 });
    b.box(0, Y + 8.3, 1.9, 0.12, 1.0, 0.12, '#d6a83a'); b.box(0, Y + 8.45, 1.9, 0.56, 0.12, 0.12, '#d6a83a');
    b.box(0, Y + 0.8, 2.72, 0.8, 1.6, 0.06, '#5f4630'); b.cyl(0, Y + 1.6, 2.72, 0.4, 0.06, '#5f4630', { seg: 8, rx: Math.PI / 2 });
    win(g, 0, Y + 3.6, 2.72, 0.5, 1.0, 0, 3); win(g, 0, Y + 4.7, 2.72, 0.4, 0.4, 0, 2);
    winGrid(g, 0, Y + 1.6, 1.61, 3, 1, 0.4, 1.1, 1.3, 1, Math.PI / 2, -0.9); winGrid(g, 0, Y + 1.6, 1.61, 3, 1, 0.4, 1.1, 1.3, 1, -Math.PI / 2, -0.9);
    tree(b, -2.5, 2.2, 0.8); tree(b, 2.5, 2.3, 0.8, LEAF_DARK);
    return 9.0;
  },
  market(g) {
    const { b } = g; plinth(b, '#d8caa8', '#b8a880');
    const awnings = [['#d2553f', '#f0e2c0'], ['#3f72c4', '#f0e2c0'], ['#e0a23a', '#f0e2c0'], ['#3f9a5a', '#f0e2c0'], ['#8055c2', '#f0e2c0'], ['#d2553f', '#f0e2c0']];
    const goods = ['#d9482f', '#e8a13a', '#5f9a48', '#f2d27a', '#b23a2e', '#7a4bb0'];
    awnings.forEach(([a, c], i) => {
      const x = -2.1 + (i % 3) * 2.1, z = i < 3 ? -1.6 : 1.5;
      for (const sx of [-1, 1]) b.box(x + sx * 0.8, Y + 0.8, z - 0.5, 0.09, 1.6, 0.09, '#5f4630');
      b.box(x, Y + 0.5, z, 1.7, 0.1, 1.0, WOOD);
      for (let k = 0; k < 3; k++) b.box(x - 0.5 + k * 0.5, Y + 0.68, z, 0.4, 0.26, 0.6, goods[(i + k) % goods.length]);
      for (let s = 0; s < 4; s++) b.box(x - 0.66 + s * 0.44, Y + 1.6, z + 0.1, 0.44, 0.07, 1.5, s % 2 ? c : a, { rx: 0.3 });
    });
    for (const [x, z, colour] of [[-3.0, 0, '#e8a13a'], [3.0, -0.2, '#5f9a48']]) { b.cyl(x, Y + 0.3, z, 0.4, 0.6, '#b08a5c', { seg: 7, top: 1.2 }); b.ball(x, Y + 0.66, z, 0.4, 0.2, 0.4, colour, { seg: 6 }); }
    b.cyl(0, Y + 1.5, 0, 0.05, 3.0, '#5f4630', { seg: 4 });
    for (let i = 0; i < 6; i++) b.cone(Math.sin(i * 1.047) * 0.5, Y + 2.9, Math.cos(i * 1.047) * 0.5, 1.2, 0.5, i % 2 ? '#e8c13a' : '#d2553f', { seg: 3 });
    return 3.6;
  },
  police(g) {
    const { b } = g; plinth(b);
    b.box(-0.4, Y + 1.2, -0.8, 4.6, 2.4, 3.0, '#2b4f8f');
    b.box(-0.4, Y + 0.5, -0.8, 4.64, 0.5, 3.04, '#f2c230');
    b.box(-0.4, Y + 2.5, -0.8, 4.9, 0.22, 3.3, '#1e3a6b');
    sign(b, -0.4, Y + 1.95, 0.74, 'POLICE', { size: 0.3, color: WHITE });
    win(g, -1.8, Y + 1.2, 0.72, 0.7, 0.6); win(g, 1.0, Y + 1.2, 0.72, 0.7, 0.6, 0, 1); b.box(-0.4, Y + 0.7, 0.72, 0.8, 1.4, 0.06, '#1e3a6b');
    b.box(-0.4, Y + 2.85, -0.8, 0.5, 0.3, 0.5, '#3b82ff', GLOW);
    flag(b, 2.6, 2.4, 4.4);
    b.box(0.8, Y + 0.55, 2.2, 1.2, 0.6, 2.6, '#2b4f8f'); b.box(0.8, Y + 1.05, 2.7, 1.1, 0.5, 1.2, '#2b4f8f'); b.box(0.8, Y + 0.6, 2.2, 1.22, 0.14, 2.62, '#f2c230');
    b.box(0.8, Y + 1.38, 2.7, 0.6, 0.12, 0.2, '#ff3b30', GLOW);
    for (const sx of [-1, 1]) b.box(-2.4 + (sx + 1) * 0.5, Y + 0.45, 2.7, 0.2, 0.9, 0.2, sx > 0 ? '#f2c230' : '#22252a');
    return 4.9;
  },
  polling(g) {
    const { b } = g; plinth(b, '#dfe6d3');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 2.1, Y + 1.2, sz * 1.5 - 0.4, 0.1, 2.4, 0.1, '#c9ced3');
    for (let i = 0; i < 6; i++) b.box(-1.75 + i * 0.7, Y + 2.55, -0.4, 0.7, 0.08, 3.5, i % 2 ? WHITE : '#2f8f55');
    b.cone(0, Y + 2.95, -0.4, 2.6, 0.7, WHITE, { seg: 4, ry: Math.PI / 4 });
    b.box(0, Y + 0.55, -0.6, 2.4, 0.1, 0.9, WOOD); for (const sx of [-1, 1]) b.box(sx * 1.0, Y + 0.27, -0.6, 0.1, 0.54, 0.8, '#5f4630');
    b.box(0, Y + 0.95, -0.6, 0.8, 0.7, 0.6, '#eaf2ff', GLASS); b.box(0, Y + 1.32, -0.6, 0.84, 0.06, 0.64, '#2f8f55'); b.box(0, Y + 1.36, -0.6, 0.4, 0.02, 0.08, '#22252a');
    for (const sx of [-1, 1]) { b.box(sx * 1.9, Y + 0.6, 1.2, 0.7, 1.2, 0.06, '#eef1ee'); b.box(sx * 1.9, Y + 0.6, 0.86, 0.06, 1.2, 0.7, '#eef1ee'); }
    for (let i = 0; i < 4; i++) b.cyl(0, Y + 0.03, 1.2 + i * 0.5, 0.16, 0.04, '#2f8f55', { seg: 6 });
    flag(b, -2.7, 2.5, 3.8);
    sign(b, 0, Y + 2.05, 1.16, 'VOTE', { size: 0.28, color: WHITE, board: '#2f8f55', pad: 0.12 });
    return 4.5;
  },
  statehouse(g) {
    const { b } = g; plinth(b, '#eef0e6', '#cfd6c4');
    b.box(0, Y + 0.2, 0.4, 6.0, 0.4, 4.6, '#dcd8ca'); b.box(0, Y + 0.1, 2.8, 3.2, 0.2, 0.6, '#dcd8ca');
    b.box(0, Y + 1.9, -0.8, 5.6, 3.0, 2.8, WHITE);
    b.box(0, Y + 3.5, 0.3, 5.9, 0.3, 5.0, '#e4dfd0');
    gable(b, 0, Y + 3.65, 1.9, 5.2, 1.1, 0.7, WHITE);
    for (let i = 0; i < 6; i++) { b.cyl(-2.4 + i * 0.96, Y + 1.9, 2.1, 0.19, 2.9, WHITE, { seg: 7 }); b.box(-2.4 + i * 0.96, Y + 0.5, 2.1, 0.5, 0.2, 0.5, '#dcd8ca'); }
    b.cyl(0, Y + 3.9, -0.8, 1.2, 0.6, WHITE, { seg: 10 }); b.ball(0, Y + 4.2, -0.8, 1.15, 1.0, 1.15, '#2f8f55', { seg: 10 });
    b.cyl(0, Y + 5.9, -0.8, 0.05, 1.6, '#c9ced3', { seg: 4 }); for (let i = 0; i < 3; i++) b.box(0.25 + i * 0.36, Y + 6.4, -0.8, 0.36, 0.5, 0.04, i === 1 ? WHITE : '#2f8f55');
    winGrid(g, 0, Y + 2.0, 0.62, 4, 1, 0.5, 1.0, 1.25, 1); b.box(0, Y + 1.2, 0.62, 0.8, 1.6, 0.05, '#5f4630');
    for (const sx of [-1, 1]) b.ico(sx * 2.85, Y + 0.55, 2.85, 0.4, 0.4, 0.4, LEAF_DARK);
    return 6.9;
  },
  gym(g) {
    const { b } = g; plinth(b);
    b.box(0, Y + 1.6, -0.6, 5.2, 3.2, 3.8, '#2f3540');
    b.box(0, Y + 1.5, 1.32, 4.6, 2.4, 0.06, '#9fd0e6', GLASS);
    winGrid(g, 0, Y + 1.5, 1.36, 3, 1, 1.3, 2.0, 1.5, 1);
    b.box(0, Y + 3.0, 1.34, 5.24, 0.4, 0.1, '#f08a1d'); b.box(0, Y + 3.3, -0.6, 5.5, 0.22, 4.1, '#f08a1d');
    sign(b, 0, Y + 3.0, 1.42, 'FITNESS', { size: 0.24, color: WHITE, lit: true });
    b.cyl(0, Y + 4.4, -0.6, 0.1, 2.6, '#c9ced3', { seg: 5, rz: Math.PI / 2 });        // the dumbbell on the roof
    for (const sx of [-1, 1]) for (const [d, r] of [[1.3, 0.75], [1.62, 0.55]]) b.cyl(sx * d, Y + 4.4, -0.6, r, 0.26, '#22252a', { seg: 10, rz: Math.PI / 2 });
    for (const sx of [-1, 1]) b.box(sx * 0.5, Y + 3.9, -0.6, 0.12, 1.0, 0.12, '#8a8f95');
    b.box(2.1, Y + 0.3, 2.4, 0.5, 0.6, 1.2, '#f08a1d');
    return 5.6;
  },
  office(g) {
    const { b } = g; plinth(b);
    b.box(0, Y + 0.9, 0, 5.4, 1.8, 4.6, '#c9d2d4');
    b.box(0, Y + 5.3, -0.3, 3.6, 7.0, 3.2, '#5b7f96');
    b.box(0, Y + 8.95, -0.3, 3.8, 0.3, 3.4, '#3d5a6c');
    b.box(0.8, Y + 9.5, -0.9, 1.2, 0.8, 0.9, '#8a9097'); b.cyl(-1.0, Y + 10.0, -0.9, 0.04, 1.8, '#8a8f95', { seg: 4 });
    for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) winGrid(g, 0, Y + 5.3, ry % Math.PI ? 1.81 : (ry ? 1.91 : 1.31), 3, 6, 0.7, 0.62, 1.05, 1.08, ry);
    b.box(0, Y + 0.9, 2.32, 2.2, 1.5, 0.06, '#9fd0e6', GLASS); winGrid(g, 0, Y + 0.95, 2.36, 2, 1, 0.9, 1.2, 1.1, 1);
    b.box(0, Y + 1.95, 2.6, 2.8, 0.12, 0.9, '#3d5a6c');
    return 10.6;
  },
  rooftop(g) {
    const { b } = g; plinth(b);
    b.box(0, Y + 3.1, -0.2, 3.6, 6.2, 3.6, '#ece4d2');
    for (const ry of [0, Math.PI / 2, -Math.PI / 2]) winGrid(g, 0, Y + 3.0, 1.81 - (ry ? 0 : 0.2), 2, 5, 0.8, 0.6, 1.4, 1.05, ry);
    b.box(0, Y + 6.3, -0.2, 4.4, 0.2, 4.4, '#d9cdb4');                    // the terrace, wider than the tower
    for (const sx of [-1, 1]) { b.box(sx * 2.15, Y + 6.7, -0.2, 0.08, 0.6, 4.4, '#bfe0ee', GLASS); b.box(0, Y + 6.7, -0.2 + sx * 2.15, 4.4, 0.6, 0.08, '#bfe0ee', GLASS); }
    for (const [x, z, colour] of [[-1.1, 0.6, '#e9614b'], [1.1, -0.9, '#f0e2c0']]) { b.cyl(x, Y + 7.1, z, 0.04, 1.4, '#8a8f95', { seg: 4 }); b.cone(x, Y + 7.9, z, 0.9, 0.4, colour, { seg: 8 }); b.cyl(x, Y + 6.6, z, 0.34, 0.5, '#f1ede2', { seg: 6 }); }
    b.box(1.3, Y + 6.75, 1.1, 1.2, 0.7, 0.5, '#5f4630'); b.box(1.3, Y + 7.3, 0.9, 1.3, 0.06, 0.1, '#ffd98a', GLOW);
    for (let i = 0; i < 7; i++) b.ico(-1.9 + i * 0.63, Y + 8.1 - Math.sin(i / 6 * Math.PI) * 0.35, -2.0, 0.09, 0.09, 0.09, ['#ffd58a', '#ffb0a0', '#bfe3ff'][i % 3], GLOW);
    for (const sx of [-1, 1]) b.cyl(sx * 2.05, Y + 7.3, -2.0, 0.04, 1.8, '#8a8f95', { seg: 4 });
    sign(b, 0, Y + 5.6, 1.64, 'ROOFTOP', { size: 0.24, color: '#ffd98a', lit: true });
    return 8.8;
  },
  walk(g) {
    const { b } = g; plinth(b, '#5f9552', '#3f7a48');
    for (const [x, z, s, colour] of [[-2.3, -2.1, 1.5, LEAF_DARK], [2.3, -1.9, 1.7, LEAF], [-2.1, 2.0, 1.4, '#4f9a5f'], [2.2, 2.1, 1.3, LEAF_DARK], [0, -0.2, 1.9, LEAF]]) {
      b.cyl(x, Y + 1.6 * s, z, 0.2 * s, 3.2 * s, '#6b4f36', { seg: 5, top: 0.7 });
      b.ico(x, Y + 3.6 * s, z, 1.3 * s, 1.1 * s, 1.3 * s, colour); b.ico(x + 0.5 * s, Y + 3.1 * s, z - 0.4 * s, 0.9 * s, 0.8 * s, 0.9 * s, colour);
    }
    const posts = [[-2.4, 0.2], [0.1, 1.9], [2.5, 0.3]];                  // the walkway, slung between three towers
    for (const [x, z] of posts) { for (const s of [-1, 1]) b.box(x + s * 0.22, Y + 1.9, z, 0.1, 3.8, 0.1, '#7a5a3a'); b.box(x, Y + 3.5, z, 0.9, 0.1, 0.9, '#8a6644'); }
    for (let i = 0; i < posts.length - 1; i++) {
      const [ax, az] = posts[i], [bx, bz] = posts[i + 1], length = Math.hypot(bx - ax, bz - az), ry = Math.atan2(bx - ax, bz - az);
      for (let s = 0; s < 6; s++) {
        const t = (s + 0.5) / 6, sag = Math.sin(t * Math.PI) * 0.4;
        b.box(ax + (bx - ax) * t, Y + 3.5 - sag, az + (bz - az) * t, 0.6, 0.06, length / 6, '#c9a676', { ry });
        for (const side of [-1, 1]) b.box(ax + (bx - ax) * t + Math.cos(ry) * side * 0.3, Y + 3.85 - sag, az + (bz - az) * t - Math.sin(ry) * side * 0.3, 0.04, 0.04, length / 6, '#e9dfc8', { ry });
      }
    }
    b.box(0, Y + 0.02, 2.9, 0.9, 0.04, 0.8, '#d8cdb0');
    return 7.6;
  },
  mall(g) {
    const { b } = g; plinth(b, '#e2ddd0');
    b.box(0, Y + 1.4, -0.9, 6.0, 2.8, 3.6, '#f0e8d8');
    b.box(0, Y + 2.9, -0.9, 6.2, 0.2, 3.8, '#d6a83a');
    b.box(0, Y + 1.9, 1.2, 2.4, 3.8, 1.0, '#f0e8d8');                    // the entrance arch
    b.box(0, Y + 1.4, 1.73, 1.6, 2.6, 0.06, '#9fd0e6', GLASS); b.cyl(0, Y + 2.7, 1.73, 0.8, 0.06, '#9fd0e6', { seg: 10, rx: Math.PI / 2, ...GLASS });
    win(g, 0, Y + 1.4, 1.76, 1.4, 2.4, 0, 1);
    sign(b, 0, Y + 3.5, 1.74, 'MALL', { size: 0.3, color: '#b23a2e', lit: true });
    b.cyl(0, Y + 3.3, -0.9, 1.5, 0.8, '#9fd0e6', { seg: 8, top: 0.3, ...GLASS });
    winGrid(g, -2.1, Y + 1.3, 0.92, 2, 1, 0.7, 1.2, 0.9, 1); winGrid(g, 2.1, Y + 1.3, 0.92, 2, 1, 0.7, 1.2, 0.9, 1);
    palm(b, -2.7, 2.5, 0.85); palm(b, 2.7, 2.5, 0.85);
    for (let i = 0; i < 3; i++) b.box(-1.9 + i * 0.9, Y + 0.3, 2.7, 0.6, 0.5, 1.1, ['#b23a2e', '#ece2c6', '#3f72c4'][i]);
    return 4.9;
  },
  beach(g) {
    const { b } = g; plinth(b, '#f0deb0', '#d9c48f');
    for (const [x, z, s] of [[-1.6, -1.6, 1], [1.5, -1.2, 0.85]]) {       // thatched huts
      b.cyl(x, Y + 0.6 * s, z, 0.9 * s, 1.2 * s, '#c9a676', { seg: 8 });
      b.cone(x, Y + 1.75 * s, z, 1.4 * s, 1.2 * s, '#a8843f', { seg: 8 });
      b.box(x, Y + 0.45 * s, z + 0.9 * s, 0.5 * s, 0.9 * s, 0.06, '#5f4630');
    }
    for (const [x, z, colours] of [[-1.5, 1.6, ['#e9614b', WHITE]], [0.6, 2.1, ['#3f9ad0', WHITE]], [2.4, 1.2, ['#f2c230', WHITE]]]) {
      b.cyl(x, Y + 0.8, z, 0.04, 1.6, '#8a8f95', { seg: 4 });
      for (let i = 0; i < 6; i++) b.cone(x + Math.sin(i * 1.047) * 0.3, Y + 1.65, z + Math.cos(i * 1.047) * 0.3, 0.75, 0.3, colours[i % 2], { seg: 3 });
      b.box(x + 0.5, Y + 0.14, z + 0.2, 0.5, 0.08, 1.1, colours[0], { ry: 0.3 });
    }
    palm(b, 2.6, -2.5, 1); palm(b, -2.8, 0.2, 0.8);
    b.box(2.9, Y + 0.7, 2.6, 0.5, 1.5, 0.08, '#38b5c9', { rz: 0.2 }); b.box(0, Y + 0.02, 3.0, 6.4, 0.04, 0.5, '#bfe6ee', GLASS);
    return 3.9;
  },
  airport(g) {
    const { b } = g; plinth(b, '#d5d8d2', '#b4b8b0');
    b.box(-0.5, Y + 1.0, -0.7, 5.0, 2.0, 3.0, '#e9edee');                 // the terminal, under one long swept roof
    b.box(-0.5, Y + 2.2, -0.5, 5.6, 0.22, 4.0, '#3f9ad0', { rx: 0.1 });
    b.box(-0.5, Y + 1.1, 0.83, 4.6, 1.5, 0.06, '#9fd0e6', GLASS); winGrid(g, -0.5, Y + 1.1, 0.87, 4, 1, 0.9, 1.2, 1.12, 1);
    sign(b, -0.5, Y + 2.75, 1.3, 'AIRPORT', { size: 0.3, color: WHITE, lit: true, board: '#2f4a66', pad: 0.12 });
    b.cyl(2.5, Y + 2.6, -2.2, 0.42, 5.2, '#d9d4c4', { seg: 8 });           // the control tower
    b.cyl(2.5, Y + 5.6, -2.2, 0.85, 0.9, '#55707c', { seg: 8, top: 1.25 });
    b.cyl(2.5, Y + 6.15, -2.2, 1.15, 0.14, '#d9d4c4', { seg: 8 });
    b.ico(2.5, Y + 6.6, -2.2, 0.14, 0.14, 0.14, '#ff3b30', GLOW);
    b.at(0.2, Y, 2.3, Math.PI / 2 - 0.25, () => {                         // a plane at the stand
      b.cyl(0, 0.5, 0, 0.3, 3.0, WHITE, { seg: 7, rx: Math.PI / 2 }); b.cone(0, 0.5, 1.8, 0.3, 0.6, WHITE, { seg: 7, rx: Math.PI / 2 });
      b.box(0, 0.46, 0.1, 3.4, 0.08, 0.7, '#d9d4c4'); b.box(0, 0.6, -1.3, 1.3, 0.06, 0.4, '#d9d4c4'); b.box(0, 0.95, -1.35, 0.08, 0.8, 0.5, '#3f9a5a');
    });
    return 7.0;
  },
  refinery(g) {
    const { b } = g; plinth(b, '#cfd0c8', '#aeb0a6');
    b.box(1.9, Y + 0.7, 2.2, 1.4, 1.4, 1.2, '#ece2c6'); b.box(1.9, Y + 1.5, 2.2, 1.8, 0.16, 1.6, '#2f4a45');      // the gate house and its boom
    win(g, 1.9, Y + 0.85, 2.81, 0.8, 0.5);
    for (let i = 0; i < 5; i++) b.box(-1.9 + i * 0.6, Y + 0.6, 2.7, 0.6, 0.12, 0.12, i % 2 ? WHITE : '#c9423a');
    sign(b, -0.6, Y + 1.5, 2.9, 'REFINERY', { size: 0.22, color: WHITE, board: '#2f4a45', pad: 0.1 });
    for (const [x, z, r, h] of [[-1.9, -1.6, 1.15, 1.9], [0.7, -1.9, 1.15, 1.9]]) {                                 // two tanks
      b.cyl(x, Y + h / 2, z, r, h, '#dfe2e0', { seg: 10 }); b.cyl(x, Y + h + 0.1, z, r * 0.96, 0.2, '#b8bcba', { seg: 10, top: 0.5 });
      b.cyl(x, Y + h * 0.6, z, r * 1.02, 0.2, '#3f72c4', { seg: 10, open: true });
    }
    for (const [x, z, r, h] of [[-2.2, 0.6, 0.36, 5.6], [-1.3, 0.9, 0.28, 4.4]]) {                                  // the columns
      b.cyl(x, Y + h / 2, z, r, h, '#aab0b3', { seg: 8 }); b.cyl(x, Y + h + 0.14, z, r, 0.28, '#8a8f95', { seg: 8, top: 0.3 });
      for (let band = 0; band < 2; band++) b.cyl(x, Y + h - 0.6 - band * 0.8, z, r * 1.04, 0.28, band ? WHITE : '#c9423a', { seg: 8, open: true });
    }
    for (const [dz, colour] of [[0, '#c9ced3'], [0.26, '#f2c230']]) b.cyl(0.6, Y + 1.25, 0.5 + dz, 0.1, 4.4, colour, { seg: 5, rz: Math.PI / 2 });
    for (const x of [-0.6, 1.2, 2.6]) b.box(x, Y + 0.6, 0.63, 0.1, 1.2, 0.5, '#3d444b');
    b.cyl(2.6, Y + 3.6, -1.2, 0.12, 7.2, '#8a8f95', { seg: 5 });                                                     // the flare stack
    b.cone(2.6, Y + 7.7, -1.2, 0.34, 1.1, '#ff7a2f', { seg: 6, ...GLOW }); b.cone(2.6, Y + 7.55, -1.2, 0.18, 0.7, '#ffe08a', { seg: 5, ...GLOW });
    return 8.4;
  },
  /** The University of Lagos at Akoka: Senate House with its red grid over a low entrance block, and the main gate (after src/campus/unilag/landmark.js). */
  unilag(g) {
    const { b } = g; plinth(b, '#b9c887', '#98aa6c');
    const cream = '#efe2c4', red = '#8f2434';
    b.box(0.7, Y + 0.6, -0.9, 3.4, 1.2, 2.3, cream);                      // the entrance block
    b.box(0.7, Y + 2.3, -1.15, 2.1, 2.3, 1.6, cream);                     // the tower
    b.box(0.7, Y + 3.55, -1.15, 2.3, 0.18, 1.8, red);
    for (let floor = 0; floor < 3; floor++) {
      const y = Y + 1.6 + floor * 0.62;
      b.box(0.7, y + 0.2, -0.32, 2.0, 0.06, 0.06, red);
      for (let column = -1; column <= 1; column++) b.box(0.7 + column * 0.6, y, -0.32, 0.06, 0.4, 0.06, red);
    }
    winGrid(g, 0.7, Y + 2.22, -0.33, 2, 3, 0.42, 0.3, 0.6, 0.62);
    winGrid(g, 0.7, Y + 0.65, 0.27, 4, 1, 0.5, 0.5, 0.75, 1);
    for (const x of [-2.5, -1.1]) b.box(x, Y + 0.65, 2.2, 0.34, 1.3, 0.34, red);   // the main gate
    b.box(-1.8, Y + 1.3, 2.2, 1.9, 0.2, 0.46, red); b.box(-1.8, Y + 1.46, 2.2, 1.3, 0.12, 0.5, cream);
    sign(b, -1.8, Y + 1.74, 2.3, 'UNILAG', { size: 0.2, color: WHITE, board: red, pad: 0.08 });
    b.box(-1.8, Y + 0.02, 1.2, 1.4, 0.04, 2.6, '#8a7a66');
    palm(b, -2.7, -2.3, 0.8); palm(b, 2.7, 1.9, 0.72); tree(b, 2.6, -2.5, 0.9, LEAF_DARK);
    return 4.2;
  },
};

/** Draw the landmark for a venue's scene kind. Unknown kinds get a plain block, so a new venue is never invisible. */
export function drawLandmark(g, kind, variant) {
  const draw = KINDS[kind];
  if (draw) return { top: Y + draw(g, variant) };
  plinth(g.b); g.b.box(0, Y + 1.5, 0, 4, 3, 4, '#d9d4c4');
  return { top: Y + 3.6 };
}
export const LANDMARK_KINDS = Object.freeze(Object.keys(KINDS));
