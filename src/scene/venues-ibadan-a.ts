/**
 * OWNER: scenes
 * Scenes with a character of their own for three Ibadan places: a university campus court
 * ('quad'), a hilltop tower with the city's roofs below ('hilltop') and a reservoir shore
 * ('lakeside'). Scene definition format: see venues-outdoor.ts.
 *
 * Every sign is drawn from the venue's own label (context.label); nothing here names a place.
 * All three are static; the roofs, reeds and far trees are plain baked boxes and blobs.
 */
import { GLASS } from './build.ts';
import type { Batch, Colour, SceneDef } from './types.ts';
import {
  ground, bench, leafTree, tallTree, bush, lampPost, kiosk, flag, windowPane, sign, signBoard, landmark, extra,
  WOOD_DARK, WHITE, LEAF, LEAF_DARK,
} from './props.ts';

const PI = Math.PI, HALF = Math.PI / 2;

/** A small deterministic generator, so a scene is the same every time it is built. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
/** Block lettering has no apostrophe: a possessive reads as one word. */
const plain = (label: string): string => label.replace(/[’']/g, '');
/** A sign width that fits a venue's own label between two points. */
const fitSize = (label: string, width: number, max: number): number => Math.min(max, (width * 5) / Math.max(1, label.length * 4 - 1));

// ---------------------------------------------------------------------------------------------
// Campus court: a clock tower, an arcaded faculty block, a gate, a notice board and benches.

function clockTower(b: Batch, x: number, z: number) {
  b.box(x, 0.2, z, 4.2, 0.4, 4.2, '#b7ad98');
  b.box(x, 0.55, z, 3.5, 0.3, 3.5, '#c9bfa8');
  b.box(x, 4.7, z, 2.2, 8.3, 2.2, '#ece3cc');
  for (const [dx, dz] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]] as [number, number][]) b.box(x + dx, 4.7, z + dz, 0.32, 8.3, 0.32, '#d6ccb2');
  for (const y of [2.2, 4.6, 6.8]) b.box(x, y, z, 2.5, 0.16, 2.5, '#c2b79d');
  // Slit windows up the shaft and a door at the foot
  for (const y of [3.2, 5.7]) { b.box(x, y, z + 1.11, 0.28, 1.1, 0.06, '#3d352c'); b.box(x + 1.11, y, z, 0.06, 1.1, 0.28, '#3d352c'); }
  b.box(x, 1.2, z + 1.11, 0.9, 1.5, 0.08, '#4a3a2c');
  // The clock stage: wider, with a face on each side that looks into the court
  b.box(x, 9.7, z, 2.9, 2.2, 2.9, '#e6dcc2');
  b.box(x, 8.5, z, 3.1, 0.2, 3.1, '#b9ae94');
  b.box(x, 10.9, z, 3.1, 0.2, 3.1, '#b9ae94');
  b.cyl(x, 9.7, z + 1.46, 0.95, 0.08, WHITE, { seg: 16, rx: HALF });
  b.cyl(x, 9.7, z + 1.5, 0.95, 0.03, '#2f2a24', { seg: 16, rx: HALF, top: 1 });
  b.cyl(x, 9.7, z + 1.51, 0.82, 0.03, '#fff3c4', { seg: 16, rx: HALF, layer: 'glow' });
  b.cyl(x + 1.46, 9.7, z, 0.95, 0.08, WHITE, { seg: 16, rz: HALF });
  b.cyl(x + 1.5, 9.7, z, 0.95, 0.03, '#2f2a24', { seg: 16, rz: HALF });
  b.cyl(x + 1.51, 9.7, z, 0.82, 0.03, '#fff3c4', { seg: 16, rz: HALF, layer: 'glow' });
  b.box(x, 9.95, z + 1.55, 0.09, 0.62, 0.03, '#2f2a24'); b.box(x + 0.22, 9.7, z + 1.55, 0.5, 0.08, 0.03, '#2f2a24');
  b.box(x + 1.55, 9.95, z, 0.03, 0.62, 0.09, '#2f2a24'); b.box(x + 1.55, 9.7, z - 0.22, 0.03, 0.08, 0.5, '#2f2a24');
  // A square pyramid roof of clay tile, and a finial
  b.cone(x, 12.1, z, 2.3, 2.4, '#9b4a30', { seg: 4, ry: PI / 4 });
  b.cyl(x, 13.6, z, 0.05, 1.1, '#c9ced3', { seg: 5 });
  b.ball(x, 14.2, z, 0.12, 0.12, 0.12, '#d9b24c', { seg: 5 });
}

/** A two-storey block with a pillared arcade along its front (+z) face. */
function arcadeBlock(b: Batch, cx: number, cz: number, w: number) {
  const front = cz + 1.7;
  b.box(cx, 1.6, cz, w, 3.2, 3.4, '#e7ddc4');
  b.box(cx, 4.6, cz, w - 0.3, 2.8, 3.2, '#efe6cf');
  b.box(cx, 3.22, cz, w + 0.2, 0.22, 3.6, '#bdb298');
  // Roof of clay tile: two slopes and a ridge
  for (const side of [-1, 1]) b.box(cx, 6.5, cz + side * 1.14, w + 0.6, 0.14, 2.5, '#a4492d', { rx: side * 0.42 });
  b.box(cx, 6.98, cz, w + 0.6, 0.16, 0.3, '#7c3722');
  // Arches in the recessed wall, pillars standing forward of it
  const bays = Math.round(w / 2);
  for (let i = 0; i < bays; i++) {
    const x = cx - w / 2 + (i + 0.5) * (w / bays);
    b.box(x, 1.0, front - 0.02, 1.35, 2.0, 0.1, '#43362b');
    b.cyl(x, 2.0, front - 0.02, 0.67, 0.1, '#43362b', { seg: 10, rx: HALF });
    windowPane(b, x, 4.7, front - 0.06, { w: 0.95, h: 1.3, glass: '#9fc4d6' });
  }
  for (let i = 0; i <= bays; i++) b.box(cx - w / 2 + i * (w / bays), 1.6, front + 0.75, 0.5, 3.2, 0.5, '#f1e8d0');
  b.box(cx, 3.35, front + 0.75, w + 0.4, 0.3, 0.8, '#d3c8ae');
  b.box(cx, 0.05, front + 0.4, w, 0.08, 1.8, '#cbbf9f');
}

function campusGate(b: Batch, x: number, z0: number, z1: number, label: string) {
  for (const z of [z0, z1]) {
    b.box(x, 0.3, z, 1.5, 0.6, 1.5, '#b9ae94');
    b.box(x, 2.3, z, 1.1, 3.8, 1.1, '#d7ccb0');
    b.box(x, 4.35, z, 1.4, 0.3, 1.4, '#a99e86');
    b.ball(x, 4.75, z, 0.32, 0.32, 0.32, '#c9bfa6', { seg: 6 });
  }
  const mid = (z0 + z1) / 2;
  b.box(x, 4.15, mid, 0.5, 0.9, z1 - z0, '#2f4a45');
  sign(b, x + 0.28, 4.15, mid, label, { size: fitSize(label, z1 - z0 - 1.5, 0.36), color: '#f1e6c4', ry: HALF });
}

function noticeBoard(b: Batch, x: number, z: number) {
  b.at(x, 0, z, 0, () => {
    for (const side of [-1, 1]) b.box(side * 1.7, 1.1, 0, 0.14, 2.2, 0.14, WOOD_DARK);
    b.box(0, 1.65, 0, 3.6, 1.5, 0.12, '#6b4a2f');
    b.quad(0, 1.65, 0.07, 3.3, 1.25, '#b98d58');
    ['#f4efe2', '#9fd0e6', '#f2d27a', '#f4efe2', '#e9a6b8', '#f4efe2', '#a8d9a0', '#f2d27a'].forEach((colour, i) => {
      const px = -1.2 + (i % 4) * 0.82, py = 1.95 - Math.floor(i / 4) * 0.62;
      b.quad(px, py, 0.08, 0.55, 0.5, colour as Colour);
      b.quad(px, py + 0.12, 0.09, 0.4, 0.04, '#7a6f60');
    });
    b.box(0, 2.62, 0.1, 3.9, 0.12, 1, '#7a4a35', { rx: 0.3 });
  });
}

const quad: SceneDef = {
  mood: 'outdoor', accent: '#e0b04a',
  camera: { landscape: [17, 23, 29], portrait: [18, 34, 44], start: 3.5 },
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#62a04f', edge: '#46703a' });
    const tx = -3.5, tz = -3.4;
    // The paved court around the tower and the red laterite paths into it
    b.disc(0.2, 0.04, 0.4, 7.9, '#b9a98a', { seg: 28 });
    b.disc(0.2, 0.05, 0.4, 7.4, '#dcd3bf', { seg: 28 });
    b.disc(tx, 0.06, tz, 3.5, '#c9b98f', { seg: 18 });
    b.box(-8.5, 0.045, 6.4, 8, 0.05, 2.4, '#b6744d');
    b.box(0.4, 0.045, 9.2, 2.6, 0.05, 6, '#b6744d');
    b.box(8.6, 0.045, -1.4, 2.4, 0.05, 8.6, '#b6744d');
    // The faculty block and the gate
    arcadeBlock(b, 7.8, -8.2, 11);
    campusGate(b, -13, 3.2, 9.8, label);
    for (const [z0, z1] of [[-6, 2.4], [10.6, 12.2]] as [number, number][]) b.box(-13, 0.45, (z0 + z1) / 2, 0.45, 0.9, z1 - z0, '#cfc4aa');
    clockTower(b, tx, tz);
    for (let i = 0; i < 10; i++) {
      const turn = (i / 10) * PI * 2;
      bush(b, tx + Math.sin(turn) * 3, tz + Math.cos(turn) * 3, { s: 0.55, color: i % 3 === 0 ? '#c0407e' : i % 3 === 1 ? '#e0a83a' : LEAF });
    }
    // Shade trees: tall at the back, round on the lawn
    ([[-12, -9, 1.3, 0], [-8.4, -10.4, 1.2, 2], [-12.4, -2.6, 1.15, 1], [2, -11, 1.1, 0], [-11.8, 11.6, 1, 2], [12, 6.2, 1.15, 1], [12.6, -1.6, 1, 2]] as [number, number, number, number][]).forEach(([x, z, s, tone]) => leafTree(b, x, z, { s, tone }));
    tallTree(b, 10.6, 10, { h: 6, s: 0.9, tone: 2 });
    ([[-7, 0.2], [5.4, 7.8], [-2, 8], [11, 2.6], [-9.2, -6.6]] as [number, number][]).forEach(([x, z], i) => bush(b, x, z, { s: 0.85 + (i % 2) * 0.25, color: i % 2 ? LEAF_DARK : LEAF }));
    lampPost(b, -9.6, 5, { light: true }); lampPost(b, 3.4, 8.4); lampPost(b, 8.6, 3.6);
    // Students: benches under the trees, a notice board, a few on the paths
    noticeBoard(b, 6.4, 4);
    bench(b, -8.4, 2.4, { w: 2.8, ry: HALF, back: true, color: '#bdb7a6', leg: '#8f8a7d' });
    bench(b, -4.6, 9.2, { w: 2.8, ry: PI, back: true, color: '#bdb7a6', leg: '#8f8a7d' });
    bench(b, 10.6, 8.2, { w: 2.8, ry: -HALF, back: true, color: '#bdb7a6', leg: '#8f8a7d' });
    extra(b, 'campus-reader', -8.4, 2.1, HALF, 'sit', { seat: 0.6 });
    extra(b, 'campus-chat-1', 5.6, 6.2, PI - 0.3, 'stand');
    extra(b, 'campus-chat-2', 7.4, 6.1, PI + 0.4, 'wave');
    extra(b, 'campus-walker', -6.4, 6.4, HALF, 'walk');
    extra(b, 'campus-lecturer', 7.8, -4.4, PI, 'stand', { look: { outfit: 'sitework', outfitColor: 'navy' } });
    return {
      spots: [
        landmark('court', /court|walk|campus|route|stroll|lawn|green/, 1.6, 4.2, 0, { act: { pose: 'walk' } }),
        landmark('work', /work|staff|office|admin|lecture|teach/, 7.8, -4.1, PI, { act: { pose: 'work' } }),
        landmark('notice', /notice|board|read|news|announce/, 6.4, 6, PI),
        landmark('tower', /clock|tower|time|hall/, tx, tz + 2.8, PI),
        landmark('benches', /bench|sit|rest|study|student|chill/, -6.8, 2.4, -HALF, { act: { pose: 'sit', x: -8.4, z: 2.1, ry: HALF, seat: 0.6 } }),
        landmark('gate', /gate|entry|entrance|arriv/, -10.8, 6.5, -HALF),
        landmark('people', /people|crowd|meet/, 3.4, 1.2, 0),
      ],
      crowd: [[2.6, 2.4, 0.4], [-0.6, 5.2, -0.5], [4.2, 3, 2.6], [-2.4, 3.4, 1.2], [1, 7, 2.8], [-6, 0.4, 1.6], [3.8, -2, PI], [-1.8, 1, 2.6], [6, 1.4, -1], [-5, 6.2, 0.6], [9.6, 4.6, 2.2], [0.6, 10, 3.1]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Hilltop: a tall slender tower, a viewing terrace and the city's rust-brown roofs below.

const ROOFS: Colour[] = ['#8d4a2c', '#9b5532', '#7b4430', '#a65f3a', '#6f3f2d', '#b06a3f', '#84432b', '#94512f'];
const OLD_ROOFS: Colour[] = ['#8a8f92', '#a3a7a5', '#c8b9a0'];
/** [far edge, near edge, ground height] of the stepped hillside, nearest the terrace first. */
const HILLSIDE: [number, number, number][] = [[-12, -4.9, -1.6], [-19, -12, -3.4], [-26, -19, -5], [-34, -26, -6.2], [-44, -34, -5.4]];

function townBelow(b: Batch) {
  const rand = seeded(7);
  HILLSIDE.forEach(([far, near, y], step) => {
    b.box(0, y - 4, (far + near) / 2, 76, 8, near - far, step % 2 ? '#9a6a46' : '#a8714b');
    b.box(0, y - 0.02, (far + near) / 2, 76, 0.05, near - far - 0.2, step % 2 ? '#8f6540' : '#9c6a46');
    const rows = Math.floor((near - far - 1.4) / 3.4);
    for (let r = 0; r < rows; r++) {
      const z = near - 1.4 - r * 3.4 - rand() * 0.6;
      for (let x = -34; x < 34; x += 3.7) {
        if (rand() < 0.1 || (Math.round(x / 3.7) + r + step) % 6 === 0) continue;
        const cx = x + rand() * 0.9, w = 2 + rand() * 1.5, d = 2 + rand() * 1.1, h = 1 + rand() * 0.6;
        const turn = (rand() - 0.5) * 0.4, tone = rand() < 0.2 ? OLD_ROOFS[Math.floor(rand() * 3)]! : ROOFS[Math.floor(rand() * ROOFS.length)]!;
        b.at(cx, y, z, turn, () => {
          if (step < 2) b.box(0, h / 2, 0, w, h, d, '#d9c9a8');
          for (const side of [-1, 1]) b.box(0, h + 0.28, side * d * 0.25, w + 0.3, 0.1, d * 0.62, tone, { rx: side * 0.42 });
        });
      }
    }
    // Trees among the roofs, sparse, and one ridge of far hills
    for (let i = 0; i < 6; i++) b.ico(-30 + rand() * 60, y + 0.9, near - 1 - rand() * (near - far - 2), 1 + rand() * 0.5, 1.1, 1 + rand() * 0.5, rand() < 0.5 ? '#4f8a45' : '#3d7a4a');
  });
  // The old city's few tall shapes: a minaret and a church tower among the roofs
  b.cyl(-17, -3.4 + 2.6, -22.5, 0.3, 5.2, '#e9e1cd', { seg: 8 }); b.cone(-17, -3.4 + 5.6, -22.5, 0.42, 0.9, '#2f8f6a', { seg: 8 }); b.box(-17, -3.4 + 4.2, -22.5, 0.85, 0.12, 0.85, '#d6ccb2');
  b.box(14, -3.4 + 2, -23, 1.7, 4, 1.7, '#d9d0bc'); b.box(14, -3.4 + 4.6, -23, 1.2, 1.2, 1.2, '#cfc5ae'); b.cone(14, -3.4 + 5.7, -23, 1.15, 1.4, '#8d4a2c', { seg: 4, ry: PI / 4 });
  // Seven hills: low, hazy ridges at the back
  ([[-30, -46, 9, '#6f8f72'], [-12, -49, 7, '#7c9a82'], [8, -50, 10, '#6c8c6e'], [28, -47, 8, '#7a9a80'], [-2, -56, 11, '#86a58a']] as [number, number, number, Colour][]).forEach(([x, z, h, c]) => {
    b.ball(x, -5.4 + h * 0.15, z, 14, h, 9, c, { seg: 8 });
  });
}

function boweTower(b: Batch, px: number, pz: number) {
  b.at(px, 0, pz, 0, () => drawTower(b, 0, 0), 0, 0, 0.86);
}

function drawTower(b: Batch, x: number, z: number) {
  b.cyl(x, 0.25, z, 2.7, 0.5, '#8d887a', { seg: 12 });
  b.cyl(x, 0.6, z, 2.3, 0.2, '#a29c8b', { seg: 12 });
  // A tapering shaft of banded stone: rings every level, slit windows on the faces that look at the terrace
  b.cyl(x, 6.9, z, 1.5, 12.6, '#a09a89', { seg: 10, top: 0.62 });
  for (let i = 0; i < 6; i++) {
    const y = 1.6 + i * 2.1, r = 1.5 - (i * 2.1 + 1) / 12.6 * 0.88;
    b.cyl(x, y, z, r + 0.1, 0.16, i % 2 ? '#7f7a6c' : '#8b8575', { seg: 10 });
    for (const turn of [0, 0.7, 1.4]) b.box(x + Math.sin(turn) * (r - 0.1), y + 1, z + Math.cos(turn) * (r - 0.1), 0.2, 0.6, 0.2, '#2f2b26', { ry: turn });
  }
  b.box(x, 1.2, z + 1.45, 0.9, 1.7, 0.12, '#3b332b');
  b.cyl(x, 1.9, z + 1.42, 0.45, 0.14, '#3b332b', { seg: 8, rx: HALF });
  // The crown: a wider gallery with merlons, a small turret and a flagstaff
  b.cyl(x, 13.35, z, 1.35, 0.3, '#8b8575', { seg: 10, top: 1.15 });
  b.cyl(x, 13.7, z, 1.3, 0.14, '#9a9482', { seg: 10 });
  for (let i = 0; i < 10; i++) { const turn = (i / 10) * PI * 2; b.box(x + Math.sin(turn) * 1.22, 14.2, z + Math.cos(turn) * 1.22, 0.36, 0.7, 0.36, '#a39d8c', { ry: turn }); }
  b.cyl(x, 14.9, z, 0.62, 1.4, '#9d9786', { seg: 8, top: 0.9 });
  b.cone(x, 16.1, z, 0.85, 1, '#7a4a35', { seg: 8 });
  b.cyl(x, 17.3, z, 0.04, 1.6, '#c9ced3', { seg: 4 });
  b.box(x + 0.5, 17.8, z, 0.9, 0.5, 0.03, '#2f8f55'); b.box(x + 0.5, 17.8, z + 0.02, 0.3, 0.5, 0.03, WHITE);
}

const hilltop: SceneDef = {
  mood: 'outdoor', accent: '#f2c14e',
  camera: { landscape: [23, 35, 43], portrait: [24, 49, 62], start: 3.5 },
  build(b, context) {
    const label = plain(context.label);
    // The terrace: paved stone, then the hillside falling away behind a low wall
    b.box(0, -0.3, 3.6, 28, 0.5, 17, '#8f8a7d');
    b.box(0, -0.02, 3.6, 27, 0.1, 16, '#c0b7a0');
    for (let x = -12; x <= 12; x += 3) b.box(x, 0.04, 3.6, 0.05, 0.02, 16, '#a69d86');
    for (let z = -2; z <= 10; z += 3) b.box(0, 0.04, z, 27, 0.02, 0.05, '#a69d86');
    b.box(0, -0.3, -4.2, 28, 0.5, 1, '#8f8a7d');
    townBelow(b);
    // The low wall along the drop, with piers
    b.box(0, 0.45, -4.4, 27.4, 0.9, 0.46, '#9a9482');
    b.box(0, 0.95, -4.4, 27.7, 0.12, 0.62, '#bab39f');
    for (let x = -13; x <= 13; x += 4.5) b.box(x, 0.7, -4.4, 0.7, 1.4, 0.7, '#a8a28f');
    b.box(-13.2, 0.45, -0.4, 0.46, 0.9, 7.8, '#9a9482'); b.box(-13.2, 0.95, -0.4, 0.62, 0.12, 7.8, '#bab39f');
    b.box(13.2, 0.45, -0.4, 0.46, 0.9, 7.8, '#9a9482'); b.box(13.2, 0.95, -0.4, 0.62, 0.12, 7.8, '#bab39f');
    boweTower(b, -6.2, -1.2);
    // The tower's own name on a low stone at its foot (the venue's label)
    b.box(-6.2, 0.35, 2.2, 3.4, 0.7, 0.5, '#8d887a');
    sign(b, -6.2, 0.38, 2.48, label, { size: fitSize(label, 3, 0.3), color: '#f1e6c4', board: '#2f4a45', pad: 0.12, depth: 0.04 });
    // A coin viewer on its post, benches that face the view, a lamp
    b.cyl(6.6, 0.7, -3.5, 0.1, 1.4, '#4a4f56', { seg: 6 });
    b.box(6.6, 1.5, -3.5, 0.5, 0.4, 0.9, '#2f6f8f'); b.cyl(6.6, 1.5, -3.95, 0.14, 0.4, '#1f2328', { seg: 6, rx: HALF });
    bench(b, 1.6, -3.4, { w: 2.8, ry: PI, back: true, color: '#8f8a7d', leg: '#6a665c' });
    bench(b, 10.2, -3.4, { w: 2.8, ry: PI, back: true, color: '#8f8a7d', leg: '#6a665c' });
    extra(b, 'hill-viewer-1', 1, -3.4, PI, 'sit', { seat: 0.6 });
    extra(b, 'hill-viewer-2', 10.2, -3.4, PI + 0.1, 'sit', { seat: 0.6 });
    extra(b, 'hill-photo', 4.6, -3.2, PI - 0.4, 'wave');
    lampPost(b, -0.2, 1.2, { light: true }); lampPost(b, 8.6, 1.6);
    // The caretaker's hut, planting and shade
    kiosk(b, 9.8, 7.6, { color: '#c9b78f', roof: '#7a4a35', fascia: '#e9dcb4' });
    extra(b, 'hill-caretaker', 9.8, 6.6, PI, 'work');
    flag(b, 12.2, 9.6, { h: 5 });
    ([[-11.4, 8.8, 1.2, 0], [-3.2, 10.4, 1, 2], [12, 3.4, 1, 1], [-12, 2.4, 1.1, 2]] as [number, number, number, number][]).forEach(([x, z, s, tone]) => leafTree(b, x, z, { s, tone }));
    ([[-9, 6.4], [5.6, 9.8], [-1.6, 6.4], [12.2, 6.4]] as [number, number][]).forEach(([x, z], i) => bush(b, x, z, { s: 0.8 + (i % 2) * 0.3, color: i % 2 ? '#c0407e' : LEAF }));
    return {
      spots: [
        landmark('top', /top|view|city|hill|roof|photo|lookout|seven/, 3.4, -2.9, PI),
        landmark('work', /work|staff|caretak|guide|ticket/, 9.8, 5.6, PI, { act: { pose: 'work' } }),
        landmark('tower', /tower|climb|stair|plaque|history/, -6.2, 3.4, PI),
        landmark('viewer', /telescope|binocular|viewer|scope/, 6.6, -2.7, PI),
        landmark('bench', /bench|sit|rest|chill|relax/, 3.6, -1.7, PI, { act: { pose: 'sit', x: 1.6, z: -3.4, ry: PI, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 1.4, 5.6, 0),
      ],
      crowd: [[2.4, 4.4, 0.4], [-1.2, 6.4, -0.5], [4.2, 6.2, 2.6], [-3.4, 4.6, 1.2], [6.4, 3.8, -1], [-8, 5, 1.6], [0.6, 8.6, 2.2], [8.6, 4, -0.6], [-4.8, 8, 0.2], [2.4, 0.4, PI], [-9.6, 1.8, 2.6], [6.8, 9, 0.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Reservoir shore: still water, a low dam, reeds, a jetty with a canoe and a forested far shore.

const BANK_Z = -2.4, WATER = -0.12;

function reeds(b: Batch, x: number, z: number, n: number, rand: () => number) {
  for (let i = 0; i < n; i++) {
    const px = x + (rand() - 0.5) * 1.6, pz = z + (rand() - 0.5) * 0.9, h = 1.2 + rand() * 1, lean = (rand() - 0.5) * 0.25;
    b.cyl(px, WATER + h / 2, pz, 0.035, h, rand() < 0.5 ? '#9aa65a' : '#7e8f48', { seg: 3, rz: lean });
    if (rand() < 0.35) b.cyl(px - lean * h * 0.5, WATER + h, pz, 0.07, 0.34, '#6b4a2e', { seg: 4 });
  }
}

function egret(b: Batch, x: number, y: number, z: number, ry: number) {
  b.at(x, y, z, ry, () => {
    b.ball(0, 0.5, 0, 0.17, 0.17, 0.34, '#f4f1e8', { seg: 6 });
    b.box(0, 0.78, 0.2, 0.07, 0.4, 0.07, '#f4f1e8', { rx: -0.35 });
    b.ball(0, 0.98, 0.3, 0.08, 0.08, 0.1, '#f4f1e8', { seg: 5 });
    b.cone(0, 0.97, 0.45, 0.025, 0.2, '#e0b030', { seg: 3, rx: HALF });
    for (const side of [-1, 1]) b.box(side * 0.06, 0.18, 0, 0.025, 0.38, 0.025, '#2f2b26');
  });
}

function canoe(b: Batch, x: number, y: number, z: number, ry: number) {
  b.at(x, y, z, ry, () => {
    b.ball(0, 0.18, 0, 0.5, 0.26, 2.1, '#6b4a2e', { seg: 8 });
    b.ball(0, 0.3, 0, 0.36, 0.14, 1.85, '#3d2c1c', { seg: 8 });
    b.box(0.5, 0.42, 0.4, 0.06, 0.06, 1.6, '#8a6644', { ry: 0.5 });
  });
}

const lakeside: SceneDef = {
  mood: 'outdoor', accent: '#7fd1c8',
  camera: { landscape: [20, 27, 35], portrait: [18, 35, 47], start: 3.5 },
  build(b, context) {
    const label = plain(context.label);
    const rand = seeded(11);
    // The bank (grass over earth) and the water lying lower than it
    b.box(0, -0.3, 4.6, 29, 0.5, 15.4, '#6e5a3c');
    b.box(0, -0.02, 4.6, 28, 0.1, 15, '#6aa056');
    b.box(0, 0.03, 2.2, 28, 0.04, 1.6, '#8c7a52');
    b.box(0, -2, -16, 76, 3.4, 30, '#2f5f63');
    b.box(0, WATER - 0.02, -16.6, 76, 0.1, 28.4, '#3f7f82');
    b.box(0, WATER + 0.03, -16.6, 76, 0.06, 28.4, '#6fb7b2', GLASS);
    for (let i = 0; i < 9; i++) b.box(-24 + i * 6.2, WATER + 0.07, -7 - (i % 4) * 4.2, 3.2, 0.02, 0.14, '#cfe9e4', { layer: 'glass' });
    // Forested far shore: dark swells with a spread of treetops
    ([[-26, -33, 6.5, '#2f5f45'], [-8, -36, 8, '#35684a'], [12, -34, 7, '#2c5a42'], [30, -33, 6, '#34654a'], [0, -42, 10, '#3d6e50']] as [number, number, number, Colour][]).forEach(([x, z, h, c]) => b.ball(x, WATER, z, 17, h, 8, c, { seg: 8 }));
    for (let i = 0; i < 44; i++) {
      const x = -34 + rand() * 68, z = -30.5 - rand() * 9, tone = ['#3d7a4a', '#2f6a44', '#4f8a45', '#5b9a55'][i % 4]!;
      b.ico(x, WATER + 3 + rand() * 4.5, z, 1.5 + rand(), 1.4 + rand() * 0.8, 1.4 + rand(), tone);
    }
    b.box(-14, WATER + 0.3, -29, 7, 0.5, 1.6, '#a8714b');
    // The dam: an earth embankment with a concrete face, a crest road and a valve house
    b.box(11.6, 1.1, -9.4, 4.6, 0.5, 15.8, '#7a9a58');
    b.box(11.6, 0.5, -9.4, 5.4, 1.4, 16.4, '#8e8a7e');
    b.box(9.1, 0.35, -9.4, 0.5, 1, 15.8, '#b0aca0', { rz: 0.5 });
    b.box(11.6, 1.38, -9.4, 2.4, 0.06, 15.8, '#7d7a70');
    for (let z = -16; z <= -2; z += 2.3) b.cyl(10.4, 1.9, z, 0.06, 1, '#c9ced3', { seg: 4 });
    b.box(10.4, 2.35, -9.4, 0.05, 0.05, 14.2, '#c9ced3');
    b.cyl(8.2, 1.4, -7.4, 0.9, 2.8, '#c9c4b3', { seg: 8, top: 0.88 });
    b.cone(8.2, 3.3, -7.4, 1.15, 0.8, '#8d4a2c', { seg: 8 });
    b.box(9.6, 1.5, -7.4, 1.8, 0.14, 0.5, '#8e8a7e');
    b.box(8.2, 1.1, -6.55, 0.5, 0.9, 0.06, '#3b332b');
    // The jetty and its canoe
    for (let z = -1.6; z > -9.6; z -= 0.42) b.box(4.6, 0.06, z, 1.7, 0.07, 0.36, z % 0.84 < 0.42 ? '#8a6644' : '#7a5a3a');
    for (let z = -2; z > -9.4; z -= 1.7) for (const side of [-1, 1]) b.cyl(4.6 + side * 0.85, 0.2, z, 0.1, 1.1, '#4a3826', { seg: 5 });
    canoe(b, 6.1, WATER + 0.05, -6, 0.1);
    canoe(b, -3.8, 0.08, 1.2, 1.1);
    b.box(-1.8, 0.45, 1.8, 0.07, 0.07, 1.8, '#8a6644', { rz: 0.1, ry: 0.4 });
    // Reeds along the water's edge and a few birds
    for (const [x, z, n] of ([[-12, -1.9, 7], [-8.4, -2.8, 6], [-3, -2.6, 7], [1.6, -2.6, 5], [7.6, -2.2, 5], [-10, -5.6, 6], [8.6, -3.4, 4]] as [number, number, number][])) reeds(b, x, z, n, rand);
    egret(b, -7.4, WATER, -3.4, 0.5); egret(b, -2.6, 0.02, -1.6, -0.6); egret(b, 3.6, 0.13, -9.1, 0.2);
    // Shade, a sign with the venue's label, a bench facing the water
    ([[-12, 5, 1.25, 2], [-8.4, 9.6, 1.1, 0], [12, 4.6, 1.2, 1], [9.4, 10, 0.95, 2]] as [number, number, number, number][]).forEach(([x, z, s, tone]) => leafTree(b, x, z, { s, tone }));
    ([[-3.4, 4.6], [6.4, 6.2], [-12.4, -0.6], [2.6, 10.4]] as [number, number][]).forEach(([x, z], i) => bush(b, x, z, { s: 0.8 + (i % 2) * 0.3, color: i % 2 ? LEAF_DARK : LEAF }));
    signBoard(b, -4, 6.8, label, { y: 1.6, size: fitSize(label, 5.2, 0.34), color: '#f1e6c4', board: '#2f4a45' });
    bench(b, 0.6, 0.2, { w: 2.6, ry: PI, back: true, color: '#8a6644', leg: '#5f4630' });
    lampPost(b, 8.2, 3.2, { light: true });
    extra(b, 'lake-sitter', 0.6, 0.2, PI, 'sit', { seat: 0.6 });
    extra(b, 'lake-fisher', -6.4, -0.5, PI + 0.3, 'stand', { look: { outfit: 'casual', outfitColor: 'green' } });
    b.box(-6.9, 0.9, -1.4, 0.04, 0.04, 2.6, '#6b5a3a', { rx: 0.7 });
    return {
      spots: [
        landmark('shore', /shore|edge|water|bird|view|reservoir|lake/, 2.2, -0.9, PI),
        landmark('jetty', /jetty|canoe|boat|pier|dock/, 4.6, -8.4, PI),
        landmark('dam', /dam|embank|crest|valve/, 8.6, -0.8, PI),
        landmark('angler', /fish|angl|rod/, -5.2, -0.4, PI),
        landmark('bench', /bench|sit|rest|chill|relax/, 2.2, 1.4, -HALF, { act: { pose: 'sit', x: 0.6, z: 0.2, ry: PI, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 3.6, 4.8, 0),
      ],
      crowd: [[2.4, 3.4, 0.4], [-1.4, 5.6, -0.5], [4.2, 5.4, 2.6], [-3.4, 3.2, 1.2], [6.4, 2.6, -1], [-8, 3.2, 1.6], [1.2, 8, 2.2], [8.6, 5.6, -0.6], [-5.8, 7.6, 0.2], [5.4, 0.8, PI], [-10, 1, 2.6], [6.8, 9, 0.4]],
    };
  },
};

export const SCENES = { quad, hilltop, lakeside };
