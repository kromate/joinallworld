/**
 * OWNER: scenes
 * Everyday scenes of Abuja and its satellite towns, each asked for through `scene.variant` and held in
 * VARIANTS[kind][variant]; src/scene/venues-fct.ts holds the signature scenes and re-exports these with its own.
 *
 *   market / fct-lockups | fct-sheds | fct-open
 *       a planned market of numbered lock-up shops in two-storey rows behind a gate; an older, tighter market of tin-roofed
 *       foodstuff sheds; an open town market on bare earth under thatch shelters and umbrellas
 *   hub / fct-rail | fct-motor-park
 *       a railway station with a glazed, curved-roofed concourse and a train along the platform; a motor park of long
 *       coaches, ticket booths and green cabs
 *   office / fct-campus-gate | fct-campus-glass | fct-campus-court
 *       three campuses: a gate, a drive and a tall senate block on open savanna; a blue glass block with a drum and a ball
 *       court; cream and terracotta blocks round a palm court with a fountain
 *   park / fct-garden-ayo | fct-garden-plots
 *       two neighbourhood gardens: ayo boards under a neem tree by a pergola; planted ridges, a water tank and a thatched shelter
 *   rooftop / fct-evening        an evening garden with a small lit stage, tables and a grill
 *
 * The helpers at the top are shared with src/scene/venues-fct.ts. Every sign is drawn from the venue's own label
 * (context.label) or is a plain word; nothing here names a place. Scene definition format: see venues-outdoor.ts.
 */
import { GLOW, GLASS } from './build.ts';
import type { Batch, Colour, SceneDef, SceneWalkSpec } from './types.ts';
import {
  ground, table, stool, bench, chair, leafTree, tallTree, palm, bush, lampPost, kiosk, flag, parasol, stringLights, fence, sign,
  signBoard, speaker, car, crate, landmark, extra,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF, WARM,
} from './props.ts';
import { PI, HALF, OPEN, seeded, plain, fit, labelled, house, shed, boulder, FRONT_CROWD, FRONT_SPARE } from './venues-common.ts';

export const STONE = '#ece5d2', STONE_DARK = '#d3cab2', PAVING = '#d9d2be', CONCRETE = '#c9c4b6', LAWN = '#62a04f', LAWN_EDGE = '#46703a';
export const NATION: readonly Colour[] = ['#2f8f55', WHITE, '#2f8f55'];
export const frontCrowd = (): [number, number, number][] => FRONT_CROWD.map(([x, z, r]) => [x, z, r]);
export const frontSpare = (): [number, number][] => FRONT_SPARE.map(([x, z]) => [x, z]);

/** The savanna the city stands on: land far past the scene's own ground, so that what is seen beyond its edge is country, not sky. */
export function plainLand(b: Batch, colour: Colour = '#b3ad72'): void {
  b.disc(0, -0.3, -6, 84, colour, { seg: 20 });
}
/** A bare granite monolith for the far ground: a high rounded dome with lower shoulders, dark water streaks down its face and bush at its foot. */
export function monolith(b: Batch, x: number, z: number, s = 1): void {
  b.at(x, -0.3, z, 0, () => {
    b.ball(0, 1, 0, 13, 11.5, 8, '#a59d92', { seg: 12 });
    b.ball(-10.5, 0, 1.4, 9, 7, 6.4, '#9a9288', { seg: 10 });
    b.ball(10, 0, 0.6, 10.5, 8.4, 6.8, '#aea69a', { seg: 10 });
    b.ball(4.6, 5, -1, 8, 8.6, 6.4, '#b3ab9f', { seg: 10 });
    // Streaks lie on the face of the main dome: each is tipped back to the slope of the rock where it runs
    for (const [px, py, h] of ([[-7, 7, 4], [-4.4, 8.6, 5], [-1.6, 6.4, 6], [-9.4, 4.6, 3], [-0.2, 3.4, 4]] as [number, number, number][])) {
      const face = 8 * Math.sqrt(Math.max(0.01, 1 - (px / 13) ** 2 - ((py - 1) / 11.5) ** 2));
      b.quad(px, py, face + 0.12, 0.5, h, '#6f6a62', { rx: Math.atan((-(64 / 132.25) * (py - 1)) / face) });
    }
    for (let i = 0; i < 9; i++) b.ico(-18 + i * 4.6, 0.9, 7.4 + (i % 3) * 0.8, 2.2, 1.5, 1.8, i % 2 ? '#5f8a4a' : '#4f7a46');
  }, 0, 0, s);
}
/** Low rock hills on the far ground: [x, z, radius, height]. */
export function hills(b: Batch, list: [number, number, number, number][]): void {
  list.forEach(([x, z, r, h], i) => b.ball(x, -0.3, z, r, h, r * 0.7, ['#8f9a6a', '#9c9482', '#84936a', '#a39a86'][i % 4]!, { seg: 8 }));
}
/** Scattered savanna trees on the far ground, as round crowns on short trunks. */
export function farTrees(b: Batch, rand: () => number, n: number, x0: number, x1: number, z0: number, z1: number): void {
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0), s = 1.3 + rand() * 0.9;
    b.box(x, 0.5 * s, z, 0.3, 1.6 * s, 0.3, '#6b5440');
    b.ico(x, 1.9 * s, z, 1.5 * s, 0.9 * s, 1.4 * s, ['#5f8a4a', '#6f9a50', '#4f7a46'][i % 3]!);
  }
}
/** A tree clipped to a ball on a clean stem, as planted along a formal walk. */
export function clipped(b: Batch, x: number, z: number, s = 1, colour: Colour = '#3f8a57'): void {
  b.cyl(x, 0.9 * s, z, 0.12 * s, 1.8 * s, '#6b5440', { seg: 5 });
  b.ball(x, 2.5 * s, z, 1.0 * s, 1.05 * s, 1.0 * s, colour, { seg: 7 });
}
/** A round shelter under a thatch cone on posts. */
export function thatchShelter(b: Batch, x: number, z: number, r = 2.2, h = 2.6): void {
  for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2 + 0.5; b.cyl(x + Math.sin(a) * r * 0.82, h / 2, z + Math.cos(a) * r * 0.82, 0.09, h, WOOD_DARK, { seg: 5 }); }
  b.cone(x, h + 0.75, z, r * 1.25, 1.9, '#b8975a', { seg: 10 });
  b.cyl(x, h + 0.04, z, r * 1.27, 0.14, '#9a7b46', { seg: 10 });
}
/** A city cab: green with a white band. */
export function cab(b: Batch, x: number, z: number, ry: number): void {
  car(b, x, z, { ry, color: '#2f8f55' });
  b.at(x, 0, z, ry, () => b.box(0, 0.62, 0, 1.94, 0.2, 4.24, WHITE));
}
/** A long intercity coach (nose at +z): a tall body with a dark band of windows and a livery stripe. */
function coach(b: Batch, x: number, z: number, ry: number, body: Colour, stripe: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 1.9, 0, 2.5, 2.9, 9.6, body);
    b.box(0, 2.45, 0, 2.54, 0.9, 9.0, '#2b3a48');
    b.box(0, 1.25, 0, 2.54, 0.34, 9.64, stripe);
    b.box(0, 2.3, 4.82, 2.2, 1.3, 0.06, '#7fa6bb');
    b.box(0, 3.42, -0.6, 1.6, 0.16, 3, '#c9c4b4');
    for (const sz of [-3.2, -2.3, 3.2]) for (const sx of [-1, 1]) b.cyl(sx * 1.15, 0.46, sz, 0.46, 0.3, BLACK, { seg: 8, rz: HALF });
    for (const sx of [-1, 1]) b.box(sx * 0.9, 0.9, 4.84, 0.34, 0.18, 0.04, WARM, GLOW);
  });
}
/** A flat-roofed block of `floors` storeys: a band of windows to each floor along its front (+z) and its right end (+x), piers between the bays. */
function slabBlock(b: Batch, x: number, z: number, w: number, d: number, floors: number, wall: Colour, glass: Colour, trim: Colour = '#cfc8b4', bay = 2.2): number {
  const h = floors * 3.2 + 0.5;
  b.box(x, h / 2, z, w, h, d, wall);
  for (let f = 0; f < floors; f++) {
    b.box(x, 2 + f * 3.2, z + d / 2 + 0.03, w - 0.8, 1.5, 0.06, glass);
    b.box(x + w / 2 + 0.03, 2 + f * 3.2, z, 0.06, 1.5, d - 0.8, glass);
  }
  const bays = Math.max(1, Math.round(w / bay));
  for (let i = 1; i < bays; i++) b.box(x - w / 2 + (i * w) / bays, h / 2, z + d / 2 + 0.06, 0.26, h, 0.12, wall);
  b.box(x, h + 0.12, z, w + 0.4, 0.24, d + 0.4, trim);
  return h;
}
/** A heap of produce in a wide enamel basin. */
function basin(b: Batch, x: number, z: number, colour: Colour, r = 0.5, y = 0): void {
  b.cyl(x, y + 0.14, z, r, 0.28, '#7a7a7e', { seg: 8, top: 1.2 }); b.ball(x, y + 0.3, z, r * 0.9, r * 0.4, r * 0.9, colour, { seg: 6 });
}
function sacks(b: Batch, x: number, z: number, cols: number, rows: number, colour: Colour): void {
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) b.ball(x + i * 0.62, 0.3 + j * 0.34, z + (j % 2) * 0.1, 0.32, 0.22, 0.4, colour, { seg: 5 });
}
const PRODUCE: readonly Colour[] = ['#d9482f', '#c9372c', '#5f9a48', '#e3c24a', '#ede4c8', '#b87a3c', '#8f5a34', '#e8a13a'];

// ---------------------------------------------------------------------------------------------
// Markets

const SHUTTERS: readonly Colour[] = ['#3f6f9c', '#8a3a2e', '#3d7a5a', '#b98a2f', '#6a6e72'];
/**
 * A row of lock-up shops along x, facing +z: one concrete block of one or two storeys, a roller shutter and a number to
 * each shop, the upper shops along a gallery with a rail. Shops are numbered from `first`.
 */
function lockups(b: Batch, x0: number, z: number, n: number, first: number, floors: number, rand: () => number): void {
  const w = 2.3, d = 3, h = 3.3, total = n * w, cx = x0 + total / 2, front = z + d / 2;
  for (let f = 0; f < floors; f++) {
    const y = f * h;
    b.box(cx, y + h / 2, z, total, h, d, f ? '#ded4bc' : '#e7ddc5');
    b.box(cx, y + h + 0.08, z + 0.6, total + 0.4, 0.16, d + 1.5, '#b9b3a2'); b.box(cx, y + h - 0.2, front + 1.3, total + 0.4, 0.56, 0.1, '#f1e9cf');
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * w, open = rand() < 0.62;
      b.box(x, y + 1.3, front + 0.02, w - 0.5, 2.5, 0.06, open ? '#3a3228' : SHUTTERS[(i + f * 2 + first) % SHUTTERS.length]!);
      if (open) for (let k = 0; k < 3; k++) b.box(x - 0.55 + k * 0.55, y + 0.5 + (k % 2) * 0.5, front + 0.16, 0.44, 0.9 + (k % 2) * 0.4, 0.3, PRODUCE[(i + k + first) % PRODUCE.length]!);
      sign(b, x, y + h - 0.2, front + 1.37, String(first + f * n + i), { size: 0.34, color: '#2f2a24' });
    }
    if (f) {
      b.box(cx, y + 1.0, front + 1.3, total + 0.3, 0.08, 0.08, METAL_DARK);
      for (let i = 0; i <= n; i++) b.box(x0 + i * w, y + 0.55, front + 1.3, 0.07, 0.9, 0.07, METAL_DARK);
    }
  }
  if (floors > 1) for (let i = 0; i <= n; i++) b.box(x0 + i * w, h / 2, front + 1.2, 0.2, h, 0.2, '#cfc6ae');
}

const lockupMarket: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(61);
    plainLand(b, '#b9b08a');
    ground(b, { w: 30, d: 26, color: '#cdbf9d', edge: '#93876a' });
    b.box(0, 0.04, 0.6, 5.4, 0.04, 23, '#b9ab8a');
    b.box(0, 0.045, 3, 28, 0.04, 2.6, '#b9ab8a');
    // The gate at the head of the main lane: two piers under a beam that carries the market's name, leaves folded back, the wall either side
    for (const s of [-1, 1]) {
      b.box(s * 3.9, 2.7, -11.8, 1.3, 5.4, 1.3, STONE); b.box(s * 3.9, 5.5, -11.8, 1.6, 0.3, 1.6, '#2f8f55');
      b.box(s * 2.5, 1.5, -10.9, 0.1, 3, 1.9, METAL_DARK, { ry: s * 0.5 });
      b.box(s * 9.6, 1.2, -12.3, 10, 2.4, 0.4, '#d9d0b8');
    }
    b.box(0, 6.2, -11.8, 10.4, 1.5, 1.1, STONE); b.box(0, 7.05, -11.8, 10.8, 0.2, 1.4, '#2f8f55');
    labelled(b, label, 0, 6.2, -11.22, 9.4, 0.7, '#f4efe0', '#1f6f4a');
    // Four blocks of lock-ups either side of the lane: the back ones two storeys with a gallery, the front ones single
    lockups(b, -14.3, -7.6, 4, 1, 2, rand); lockups(b, 5.1, -7.6, 4, 9, 2, rand);
    lockups(b, -14.3, -0.4, 4, 17, 1, rand); lockups(b, 5.1, -0.4, 4, 21, 1, rand);
    // A flight of steps up to each gallery
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) b.box(s * (5.4 + i * 0.5), (0.55 * (i + 1)) / 2, -4.2, 0.5, 0.55 * (i + 1), 1, '#b9b3a2');
    // Goods set out on the aprons and traders under umbrellas in the open front
    for (const [x, z, c] of ([[-9.4, 2.2, 0], [-6.2, 2.4, 3], [8.4, 2.3, 5], [11.6, 2.2, 1], [-11.4, 6.6, 2], [9.8, 7.2, 7]] as [number, number, number][])) basin(b, x, z, PRODUCE[c]!, 0.55);
    for (const [x, z, c] of ([[-11.2, 7.4, ['#3f72c4', WHITE]], [10.2, 8, ['#d2553f', '#f0e2c0']], [-7.2, 9.6, ['#e0a43a', WHITE]]] as [number, number, Colour[]][])) parasol(b, x, z, { colors: c, r: 1.6 });
    sacks(b, 11.6, 9.4, 3, 2, '#d9cfae'); crate(b, -8.2, 0, 8.8, { s: 0.8, fill: '#d9482f' }); crate(b, -6.6, 0, 10.2, { s: 0.7, fill: '#e3c24a' });
    sacks(b, 5.6, 9.8, 2, 2, '#cbb98a');
    extra(b, 'wuse-trader-1', -10.4, 8.2, 0.6, 'sit', { seat: 0.4, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'green', accessories: ['headwrap'] } });
    extra(b, 'wuse-trader-2', 9.2, 3.4, 0.2, 'stand', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream', accessories: ['fila'] } });
    extra(b, 'wuse-shopper', -2.4, -3.6, 2.6, 'walk', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', accessories: ['handbag'] } });
    lampPost(b, -3.2, 5.6, { light: true }); lampPost(b, 3.2, -4.6);
    return {
      spots: [
        landmark('lane', /visit|lane|shop|row|market|look/, 0.4, 0.6, PI),
        landmark('work', /work|staff|stall|sell|job|shift/, -6.6, 3.6, PI, { act: { pose: 'work' } }),
        landmark('gate', /gate|name|arch/, 0, -7.6, PI),
        landmark('people', /people|crowd|meet/, 0.6, 8.2, 0),
      ],
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [6.6, 5.6, 2.4], [-5, 6.6, 1.2], [8.2, 10.6, -0.8], [-3.4, 10.8, 0.8], [3, 10.4, 2.8], [-1.6, 4.2, 2.4], [-13, 4, 1.6], [13, 5.2, -0.4], [0.2, 9.6, 3.1], [1.4, -3.4, 0.6]],
      spare: frontSpare(),
    };
  },
};

/** A trader's table of basins and heaps under one of the sheds. */
function produceTable(b: Batch, x: number, z: number, w: number, first: number): void {
  b.box(x, 0.45, z, w, 0.9, 1.5, '#7a5c3c'); b.box(x, 0.93, z, w + 0.2, 0.08, 1.7, WOOD);
  const n = Math.floor(w / 1.1);
  for (let i = 0; i < n; i++) {
    const px = x - w / 2 + 0.55 + i * ((w - 1.1) / Math.max(1, n - 1));
    if ((i + first) % 3 === 0) for (let k = 0; k < 3; k++) b.box(px - 0.2 + k * 0.2, 1.1 + k * 0.05, z, 0.16, 0.2, 1.1, '#8a6a44', { ry: 0.1 * k });
    else basin(b, px, z, PRODUCE[(i * 3 + first) % PRODUCE.length]!, 0.42, 0.97);
  }
}

const shedMarket: SceneDef = {
  mood: 'outdoor', accent: '#c9423a',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b, '#b9b08a');
    ground(b, { w: 30, d: 26, color: '#bfa377', edge: '#86704a' });
    b.box(-1, 0.04, 5.8, 26, 0.03, 4, '#ad9267');
    // An old block wall along the back and down the left side, patched and stained
    b.box(0, 1.3, -12.5, 29.6, 2.6, 0.4, '#cbbf9f'); b.box(-14.6, 1.3, -3.6, 0.4, 2.6, 17.6, '#c3b797');
    for (let i = 0; i < 6; i++) b.box(-12 + i * 4.9, 0.9 + (i % 3) * 0.5, -12.28, 1.6, 0.9, 0.04, i % 2 ? '#b3a685' : '#d6cbae');
    // Six sheds in two close rows under rusting iron, a table of foodstuff beneath each, narrow lanes between
    const cols = [-10.2, -3.2, 3.8], rows = [-8.8, -3.4];
    rows.forEach((z, r) => cols.forEach((x, c) => {
      shed(b, x, z, 5.6, 3.4, r * 3 + c, 3 + ((r + c) % 2) * 0.2);
      produceTable(b, x, z - 0.3, 4.4, r * 3 + c);
    }));
    sacks(b, -12.4, -0.6, 4, 3, '#d9cfae'); sacks(b, -6, -0.8, 3, 2, '#cbb98a'); sacks(b, 1.2, -0.7, 3, 3, '#e0d6b6');
    for (let i = 0; i < 5; i++) b.box(5.2 + (i % 3) * 0.3, 0.2 + Math.floor(i / 3) * 0.3, -0.7 + (i % 2) * 0.3, 0.26, 0.26, 1.5, '#8a6a44', { ry: 0.3 * (i % 2) });
    // The corner block: a small concrete store with the market's name along its parapet, a grinding mill at its door
    b.box(11.2, 1.9, -7.4, 5.6, 3.8, 9.4, '#d9cdb0'); b.box(11.2, 3.95, -7.4, 6, 0.3, 9.8, '#a8653f');
    b.box(8.36, 1.4, -5.4, 0.08, 2.6, 1.6, '#3a3228'); b.box(8.36, 1.6, -9.4, 0.08, 1.4, 1.8, '#5d7488');
    labelled(b, label, 11.2, 3.0, -2.66, 5, 0.4, '#f4efe0', '#8a3a2e');
    b.box(9.2, 0.6, -1.6, 1, 1.2, 0.8, '#3d7a5a'); b.cyl(9.2, 1.5, -1.6, 0.4, 0.6, '#6a6e72', { seg: 7, top: 1.5 });
    // Sellers on the open ground in front: basins on the earth, yams in a stack, a wheelbarrow
    for (const [x, z, c] of ([[-9.6, 3.2, 0], [-8.4, 3.6, 1], [-7.2, 3.1, 2], [4.4, 3.2, 3], [5.6, 3.7, 7], [10.6, 2.6, 4], [11.8, 3.2, 6]] as [number, number, number][])) basin(b, x, z, PRODUCE[c]!, 0.5);
    for (const [x, z, c] of ([[-8.6, 2.4, ['#d2553f', '#f0e2c0']], [5, 2.4, ['#3d8f6a', '#f0e2c0']], [11.2, 1.8, ['#e0a43a', '#b5483f']]] as [number, number, Colour[]][])) parasol(b, x, z, { colors: c, r: 1.7 });
    b.at(-2.4, 0, 9.4, -0.4, () => { b.box(0, 0.55, 0, 0.9, 0.4, 1.3, '#6a6e72'); b.cyl(0, 0.26, 0.8, 0.26, 0.1, BLACK, { seg: 7, rz: HALF }); for (const s of [-1, 1]) b.box(s * 0.4, 0.5, -1.1, 0.06, 0.06, 1, WOOD_DARK); b.ico(0, 0.9, 0, 0.36, 0.22, 0.5, '#5f9a48'); });
    extra(b, 'garki-seller-1', -8.4, 1.6, 0.2, 'sit', { seat: 0.4, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'violet', accessories: ['headwrap'] } });
    extra(b, 'garki-seller-2', 3.8, -1.4, 0, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'teal' } });
    extra(b, 'garki-porter', 0.4, -6.0, HALF, 'walk', { look: { body: 'man', outfit: 'casual', outfitColor: 'red' } });
    leafTree(b, -12.6, 10.6, { s: 1.1, tone: 2 }); lampPost(b, -13, 6.6, { light: true });
    return {
      spots: [
        landmark('sheds', /visit|shed|food|market|row|look/, 0.4, 0.8, PI),
        landmark('work', /work|staff|stall|sell|job|shift/, -3.2, 0.6, PI, { act: { pose: 'work' } }),
        landmark('store', /store|mill|grind/, 7.4, -1.4, HALF),
        landmark('people', /people|crowd|meet/, 0.6, 8.2, 0),
      ],
      crowd: [[2.4, 7.4, 0.4], [-4.4, 7.6, -0.5], [7.6, 6.2, 2.4], [-6, 6.6, 1.2], [8.6, 8.8, -0.8], [-8.4, 9, 0.8], [3, 10.4, 2.8], [-5.2, 10.6, 2.4], [-11, 7.4, 1.6], [11, 9.6, -0.4], [0.2, 9, 3.1], [-6.8, -6.1, HALF]],
      spare: frontSpare(),
    };
  },
};

/** A trader's mat on the earth with heaps of one thing. */
function mat(b: Batch, x: number, z: number, ry: number, colour: Colour, goods: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.06, 0, 2.4, 0.04, 1.7, colour);
    for (let i = 0; i < 5; i++) b.ico(-0.8 + (i % 3) * 0.8, 0.22, -0.4 + Math.floor(i / 3) * 0.8, 0.3, 0.2, 0.3, goods);
  });
}
/** A lean-to of poles under thatch, open at the front (+z). */
function thatchStall(b: Batch, x: number, z: number, w: number): void {
  for (const s of [-1, 1]) { b.cyl(x + s * (w / 2 - 0.1), 1.2, z + 1, 0.08, 2.4, WOOD_DARK, { seg: 5 }); b.cyl(x + s * (w / 2 - 0.1), 1.5, z - 1, 0.08, 3, WOOD_DARK, { seg: 5 }); }
  b.box(x, 2.85, z, w + 0.5, 0.22, 2.9, '#b8975a', { rx: 0.26 }); b.box(x, 2.99, z, w + 0.2, 0.06, 2.5, '#9a7b46', { rx: 0.26 });
  b.box(x, 0.4, z - 0.2, w - 0.6, 0.8, 1.1, '#8a6a44');
}
function goat(b: Batch, x: number, z: number, ry: number, coat: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.ball(0, 0.7, 0, 0.26, 0.28, 0.55, coat, { seg: 6 }); b.box(0, 0.98, 0.56, 0.2, 0.34, 0.3, coat, { rx: 0.5 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.14, 0.24, sz * 0.36, 0.08, 0.48, 0.08, coat);
  });
}
function pickup(b: Batch, x: number, z: number, ry: number, colour: Colour, load: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.75, 0, 1.9, 0.6, 4.8, colour); b.box(0, 1.4, 1, 1.8, 0.8, 1.6, colour); b.box(0, 1.45, 1.82, 1.6, 0.6, 0.04, '#8fb8cc');
    for (const s of [-1, 1]) b.box(s * 0.9, 1.2, -1.2, 0.08, 0.4, 2.3, colour);
    for (let i = 0; i < 6; i++) b.box(-0.5 + (i % 3) * 0.5, 1.15 + Math.floor(i / 3) * 0.24, -1.2, 0.3, 0.24, 1.9, load, { ry: 0.08 * (i % 2) });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.9, 0.38, sz * 1.5, 0.38, 0.26, BLACK, { seg: 8, rz: HALF });
  });
}

const openMarket: SceneDef = {
  mood: 'outdoor', accent: '#e0822f',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(77);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#c9a674', edge: '#8f7046' });
    for (let i = 0; i < 9; i++) b.disc(-12 + rand() * 24, 0.04, -10 + rand() * 20, 1.2 + rand() * 1.6, i % 2 ? '#bd9a68' : '#d1b080', { seg: 9, sz: 0.7 });
    // A line of thatch lean-tos along the back, grain and peppers under them
    [-11.4, -6.2, -1, 4.2].forEach((x, i) => {
      thatchStall(b, x, -10.2, 4.4);
      for (let k = 0; k < 3; k++) basin(b, x - 1.2 + k * 1.2, -10.4, PRODUCE[(i * 2 + k) % PRODUCE.length]!, 0.42, 0.8);
    });
    // The shade tree in the middle of the ground with traders round its foot
    b.cyl(-3.4, 2.4, -3.2, 0.5, 4.8, '#6b5440', { seg: 7, top: 0.7 });
    for (const [dx, dy, dz, r] of ([[0, 6, 0, 3.4], [-2.6, 5.4, 0.8, 2.4], [2.6, 5.6, -0.6, 2.6], [0.4, 7.4, 0.2, 2.2], [-0.8, 5.2, -2.2, 2.2]] as [number, number, number, number][])) b.ico(-3.4 + dx, dy, -3.2 + dz, r, r * 0.62, r, ['#4f8a45', '#3d7a4a', '#5f9a50'][Math.round(r * 10) % 3]!);
    mat(b, -6.6, -1.6, 0.5, '#8a3a2e', '#e3c24a'); mat(b, -1, -0.2, -0.3, '#3f6f9c', '#d9482f'); mat(b, -5.4, 1.8, 0.1, '#b98a2f', '#5f9a48');
    mat(b, 4.6, -3.4, -0.2, '#3d7a5a', '#ede4c8'); mat(b, 8.4, -0.6, 0.3, '#8055c2', '#c9372c'); mat(b, 10.6, 3.6, -0.5, '#d2553f', '#b87a3c');
    for (const [x, z, c] of ([[4.2, -4.8, ['#e0a43a', WHITE]], [8.8, -2, ['#3f72c4', '#f0e2c0']], [11, 2.4, ['#d2553f', '#f0e2c0']], [-11.6, 3.6, ['#3d8f6a', '#f0e2c0']]] as [number, number, Colour[]][])) parasol(b, x, z, { colors: c, r: 1.8 });
    // A pickup unloading yams, sacks of grain, clay water pots, firewood, two goats
    pickup(b, 11, -8.2, -0.5, '#e9e6dc', '#8a6a44');
    sacks(b, -12.6, 2.4, 3, 3, '#d9cfae'); sacks(b, 7.6, -7.6, 2, 2, '#cbb98a');
    for (let i = 0; i < 4; i++) { b.ball(-11.8 + i * 0.9, 0.4, 6.4 + (i % 2) * 0.5, 0.42, 0.42, 0.42, '#a85a3a', { seg: 6 }); b.cyl(-11.8 + i * 0.9, 0.84, 6.4 + (i % 2) * 0.5, 0.2, 0.14, '#96502f', { seg: 6, top: 1.3 }); }
    for (let i = 0; i < 6; i++) b.cyl(1.6 + (i % 3) * 0.24, 0.16 + Math.floor(i / 3) * 0.24, 3.4, 0.11, 1.5, '#7a5a3c', { seg: 5, rx: HALF });
    goat(b, 12.4, 8.4, 2.2, '#e9e2d0'); goat(b, 11.2, 9.6, 0.6, '#5a4634');
    signBoard(b, -10.4, 9.4, label, { y: 2.9, size: fit(label, 7, 0.36), color: '#f4efe0', board: '#7a4530' });
    extra(b, 'gwa-trader-1', -6.8, -2.6, 0.5, 'sit', { seat: 0.3, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'orange', accessories: ['headwrap'] } });
    extra(b, 'gwa-trader-2', 8.6, -1.6, 0.3, 'sit', { seat: 0.3, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'blue', accessories: ['headwrap'] } });
    extra(b, 'gwa-loader', 9.2, -6.2, -2, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'gold' } });
    hills(b, [[-40, -44, 14, 7], [26, -50, 18, 8], [56, -30, 12, 6]]); farTrees(b, rand, 12, -50, 50, -40, -16);
    return {
      spots: [
        landmark('ground', /visit|ground|mat|market|look|tree/, 1.6, 0.8, -2.4),
        landmark('work', /work|staff|stall|sell|job|shift/, 1.6, -7.4, PI, { act: { pose: 'work' } }),
        landmark('lorry', /lorry|yam|load|pickup/, 8.2, -5.2, 0.9),
        landmark('people', /people|crowd|meet/, 0.6, 8.2, 0),
      ],
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [6.6, 6.2, 2.4], [-6, 6.6, 1.2], [8.2, 8.8, -0.8], [-7.4, 9.4, 0.8], [3, 10.4, 2.8], [-4.2, 10.2, 2.4], [-9, 4.6, 1.6], [5.4, 1.4, -0.4], [0.2, 9, 3.1], [1.4, -4.6, 0.6]],
      spare: frontSpare(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Hubs

/** One passenger coach of a train standing along x, its windows to the front (+z). */
function railCoach(b: Batch, x: number, z: number, len: number): void {
  b.box(x, 2.2, z, len, 2.9, 2.7, '#eeebe2'); b.box(x, 1.5, z, len + 0.02, 0.5, 2.72, '#2f8f55'); b.box(x, 0.64, z, len - 0.6, 0.3, 2.5, '#4f5860');
  b.box(x, 2.75, z + 1.36, len - 1.4, 0.8, 0.04, '#33475a');
  const n = Math.floor((len - 1.6) / 1.3);
  for (let k = 0; k < n; k++) b.quad(x - ((n - 1) * 1.3) / 2 + k * 1.3, 2.75, z + 1.39, 0.9, 0.6, '#9fd8ff');
  b.box(x, 3.72, z, len - 0.3, 0.16, 2.4, '#b9b6ac');
  for (const s of [-1, 1]) b.box(x + s * (len / 2 - 0.5), 1.9, z + 1.37, 0.7, 2, 0.04, '#d9d5c8');
}

const rail: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: PAVING, edge: '#8f8977' });
    for (let x = -6; x <= 14; x += 4) b.box(x, 0.04, 2.6, 0.08, 0.02, 15, '#c4bca6');
    // The line along the back: ballast, sleepers and rails, and the train standing at the platform, its engine at the right
    b.box(0, 0.05, -11.2, 37, 0.1, 3.8, '#7d776b');
    for (let x = -17.6; x < 18; x += 1.6) b.box(x, 0.12, -11.2, 0.4, 0.06, 3.2, '#5f4630');
    for (const z of [-11.9, -10.5]) b.box(0, 0.19, z, 37, 0.1, 0.12, '#9aa0a6');
    railCoach(b, -11.6, -11.2, 8.2); railCoach(b, -3, -11.2, 8.2); railCoach(b, 5.6, -11.2, 8.2);
    b.box(13.4, 2.3, -11.2, 6.6, 3.2, 2.8, '#2f8f55'); b.box(13.4, 1.4, -11.2, 6.64, 0.4, 2.84, '#eeebe2'); b.box(15.2, 3.1, -11.2, 2.6, 1, 2.6, '#eeebe2'); b.box(15.2, 3.1, -9.86, 1.8, 0.7, 0.04, '#33475a'); for (let i = 0; i < 4; i++) b.box(10.9 + i * 0.9, 2.9, -9.78, 0.6, 1, 0.04, '#1f6f4a'); b.box(13.4, 3.96, -11.2, 5.4, 0.16, 2, '#256f45'); b.box(13.4, 0.64, -11.2, 6, 0.3, 2.5, '#4f5860');
    // The platform under a long glazed canopy that curves over it on white ribs and columns
    b.box(0, 0.07, -7.6, 30, 0.12, 3.6, '#e2dccb'); b.box(0, 0.14, -9.2, 30, 0.02, 0.3, '#f2c14e');
    b.cyl(-1, 4.7, -7.8, 2.7, 26, '#cfe6ee', { rz: HALF, sx: 0.3, seg: 12, open: true, layer: 'glass' });
    for (let x = -13; x <= 11; x += 4.8) { b.box(x, 5.15, -7.8, 0.22, 0.22, 5.2, WHITE); b.cyl(x, 2.4, -6, 0.14, 4.8, WHITE, { seg: 6 }); }
    b.box(-1, 5.5, -7.8, 26, 0.16, 0.2, WHITE);
    // The concourse down the left side: a hall glazed from floor to eaves under a white roof that curves from end to end
    b.box(-11.9, 2.9, 1.8, 5.4, 5.8, 12, '#e9e6dc');
    b.box(-9.17, 3, 1.8, 0.08, 4.8, 11.2, '#5f93ad'); b.box(-11.9, 3, 7.83, 4.6, 4.8, 0.08, '#5f93ad');
    for (let z = -3.8; z <= 7.4; z += 1.4) b.box(-9.12, 3, z, 0.1, 4.8, 0.12, WHITE);
    for (const y of [2.1, 3.9]) { b.box(-9.12, y, 1.8, 0.1, 0.1, 11.2, WHITE); b.box(-11.9, y, 7.88, 4.6, 0.1, 0.1, WHITE); }
    for (const x of [-13.4, -11.9, -10.4]) b.box(x, 3, 7.88, 0.12, 4.8, 0.1, WHITE);
    b.cyl(-11.9, 5.7, 1.8, 3.5, 13.2, '#f4f2ea', { rx: HALF, sz: 0.44, seg: 14 });
    b.box(-8.56, 5.62, 1.8, 0.3, 0.3, 13.2, '#2f8f55');
    b.box(-8.4, 3.3, 1.8, 1.8, 0.2, 4.2, WHITE); for (const z of [0, 3.6]) b.cyl(-7.7, 1.6, z, 0.12, 3.2, WHITE, { seg: 6 });
    b.box(-9.1, 1.5, 1.8, 0.06, 2.9, 2.6, '#2b3a48');
    labelled(b, label, -9.04, 4.5, 1.8, 6.4, 0.5, '#f4efe0', '#1f6f4a', true, HALF);
    // The forecourt: a departure board, a ticket desk, benches, bags, cabs waiting at the kerb
    b.box(3.6, 2.2, -4.6, 3.4, 2, 0.2, '#1a2230'); for (const x of [2.2, 5]) b.box(x, 0.6, -4.6, 0.12, 1.2, 0.12, METAL_DARK);
    for (let i = 0; i < 4; i++) b.quad(3.6, 2.85 - i * 0.42, -4.48, 2.9, 0.2, ['#ffe07a', '#9fd8ff', '#b8f0c8', '#f2a6c8'][i]!, GLOW);
    kiosk(b, 11.6, 0.6, { ry: -HALF, w: 3.2, color: '#e9e6dc', roof: '#2f8f55', fascia: '#f4f2ea', text: 'TICKETS', textColor: '#1f6f4a' });
    bench(b, -3, -2.4, { back: true, color: '#6a6e72', leg: METAL_DARK }); bench(b, 1.4, 3.2, { back: true, ry: PI, color: '#6a6e72', leg: METAL_DARK });
    for (const [x, z, c] of ([[-1.2, -2.6, '#2f4a66'], [-0.6, -2.3, '#a14b3c'], [5.8, -6.4, '#3f6a4a']] as [number, number, string][])) b.box(x, 0.45, z, 0.5, 0.9, 0.8, c);
    cab(b, 10.6, 9.4, HALF); cab(b, 5, 9.6, HALF);
    lampPost(b, -6.2, 6.4, { light: true }); lampPost(b, 7.6, 4.6); flag(b, 13.4, 5.4, { h: 6, colors: [...NATION] });
    for (const [x, z] of ([[-6.4, -3.6], [-6.4, 9.6]] as [number, number][])) { b.box(x, 0.3, z, 1.4, 0.6, 1.4, '#bdb6a5'); b.ico(x, 1.1, z, 0.7, 0.7, 0.7, LEAF); }
    extra(b, 'idu-passenger-1', -3, -2.4, 0, 'sit', { seat: 0.6 });
    extra(b, 'idu-passenger-2', 6.4, -7.4, PI, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', accessories: ['backpack'] } });
    extra(b, 'idu-clerk', 12, 0.6, -HALF, 'work', { look: { body: 'man', outfit: 'office', outfitColor: 'green', bottomsColor: 'navy', fabric: 'plain' } });
    return {
      spots: [
        landmark('platform', /visit|platform|rail|train|wait|board|travel/, 1.4, -7.2, PI),
        landmark('work', /work|staff|ticket|desk|job|shift/, 8.2, 0.6, HALF, { act: { pose: 'work' } }),
        landmark('concourse', /concourse|hall|door|inside/, -5.8, 1.8, -HALF),
        landmark('people', /people|crowd|meet/, 2, 7, 0),
      ],
      crowd: [[2.4, 6.4, 0.4], [-2.4, 7.2, -0.5], [7.6, 6.4, 2.4], [-4, 5.2, 1.2], [8.6, 2.8, -0.8], [-2.6, 9.6, 0.8], [3, 0.4, 2.8], [-5.2, -6.8, 2.4], [9.6, -7.4, 1.6], [-9.4, -7, -0.4], [0.2, -1, 3.1], [5.4, 1.6, 0.6]],
      spare: [[-3, 6], [4, 5], [0, 2], [6, -1]],
    };
  },
};

const motorPark: SceneDef = {
  mood: 'outdoor', accent: '#3f72c4',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#8f8b82', edge: '#5f5c56' });
    b.box(3, 0.04, 8.6, 23, 0.04, 6.4, '#cfc9b8'); b.box(9.6, 0.04, -3, 9.6, 0.04, 17, '#cfc9b8');
    // Coaches drawn up in slanted bays along the left, their noses to the yard
    for (let i = 0; i < 4; i++) b.box(-13.4 + i * 4.1, 0.05, -5.4, 0.14, 0.02, 11.6, '#e9e2c6', { ry: -0.3 });
    coach(b, -11.4, -5.6, 0.3, '#e9e6dc', '#c9423a'); coach(b, -7.3, -5.6, 0.3, '#2a4fa6', '#e0a43a'); coach(b, -3.2, -5.6, 0.3, '#e9e6dc', '#2f8f55');
    coach(b, -10.6, 6.2, HALF + 0.12, '#d6a83a', '#22262c');
    // The terminal's name on a gantry over the back of the yard
    for (const x of [-4.4, 6.4]) b.cyl(x, 3.2, -12, 0.16, 6.4, METAL_DARK, { seg: 6 });
    labelled(b, label, 1, 5.8, -11.9, 10, 0.5, '#f4efe0', '#243a66', true);
    // Ticket booths in a row at the right, each under its own awning, and a waiting shed with benches
    for (let i = 0; i < 4; i++) {
      const z = -10.2 + i * 2.7, c = ['#c9423a', '#2a4fa6', '#2f8f55', '#d6a83a'][i]!;
      b.box(12.8, 1.4, z, 2.4, 2.8, 2.3, '#e9e2cf'); b.box(11.56, 1.9, z, 0.06, 1, 1.5, '#2b3230'); b.box(11.4, 1.3, z, 0.5, 0.1, 1.8, WOOD_LIGHT);
      b.box(11.9, 3.0, z, 3.6, 0.14, 2.5, c, { rz: 0.12 }); b.box(11.55, 2.62, z, 0.06, 0.34, 2.3, c);
    }
    sign(b, 12.4, 3.7, -0.4, 'TICKETS', { size: 0.5, color: '#f4efe0', board: '#243a66', pad: 0.2 });
    for (const x of [10.8, 14]) b.cyl(x, 1.7, -0.5, 0.07, 3.4, METAL_DARK, { seg: 5 });
    b.at(7.2, 0, 2.2, 0, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 2.6, 1.5, sz * 1.3, 0.1, 3, METAL_DARK, { seg: 5 });
      b.box(0, 3.1, 0, 6, 0.14, 3.4, '#4f7fb0', { rx: 0.1 });
      bench(b, -1.2, -0.4, { w: 2.6, back: true, color: '#6a6e72', leg: METAL_DARK }); bench(b, 1.6, -0.4, { w: 2.6, back: true, color: '#6a6e72', leg: METAL_DARK });
    });
    extra(b, 'utako-waiting', 6, 1.8, 0, 'sit', { seat: 0.6, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'pink', accessories: ['headwrap', 'handbag'] } });
    // Bags waiting to be loaded, a hand trolley, cabs at the kerb in front
    for (let i = 0; i < 7; i++) b.box(-0.6 + (i % 3) * 0.75, 0.3 + Math.floor(i / 3) * 0.55, 1.4 + (i % 2) * 0.2, 0.7, 0.55, 0.5, ['#c9423a', '#2a4fa6', '#e9e6dc', '#3d7a5a'][i % 4]!);
    b.at(1.9, 0, 2.6, 0.7, () => { b.box(0, 0.16, 0, 0.9, 0.08, 1.3, METAL); b.box(0, 0.7, -0.62, 0.9, 1.1, 0.06, METAL_DARK); });
    cab(b, -3.4, 9.6, HALF); cab(b, 2.6, 10, HALF);
    extra(b, 'utako-loader', -0.4, -0.2, 2.6, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'navy' } });
    extra(b, 'utako-agent', 10.2, -4.8, -HALF, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'blue', bottomsColor: 'navy', fabric: 'plain' } });
    lampPost(b, 4.6, -1.6, { light: true, h: 5 }); lampPost(b, -6.6, 2.4, { h: 5 }); lampPost(b, 13.2, 6.4, { h: 5 });
    return {
      spots: [
        landmark('bays', /visit|bay|bus|coach|park|travel|board/, 1, -3.4, -HALF),
        landmark('work', /work|staff|ticket|desk|job|shift/, 9.8, -7.4, HALF, { act: { pose: 'work' } }),
        landmark('shed', /shed|wait|bench|sit/, 7.2, 4.6, PI),
        landmark('people', /people|crowd|meet/, 3, 7.4, 0),
      ],
      crowd: [[2.4, 6.6, 0.4], [-1.4, 5.2, -0.5], [7.6, 6.8, 2.4], [4.6, 4.8, 1.2], [9.6, 8, -0.8], [-5.2, 3.2, 0.8], [0.6, 7.6, 2.8], [6.4, -2.2, 2.4], [3.6, -6.4, 1.6], [12, 4.4, -0.4], [5.2, 7.6, 3.1], [2.6, -0.8, 0.6]],
      spare: [[4, 6], [7, 7], [1, 5], [9, 5]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Campuses

/** A drive from a gate to a turning circle before a tall senate block, on open savanna with rock at its edge. */
const campusGate: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  camera: { landscape: [17, 23, 29.5], portrait: [13, 48, 69] },
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(83);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#a9aa68', edge: '#74703f' });
    // The drive in from the gate at the left to a turning circle with a book of stone on its island
    b.box(-6.4, 0.04, 3, 17, 0.04, 4.4, '#8f8b82'); b.box(1.6, 0.04, -2.6, 4, 0.04, 8, '#8f8b82');
    b.disc(1.6, 0.07, 3, 4.6, '#8f8b82', { seg: 18 }); b.disc(1.6, 0.09, 3, 2.3, LAWN, { seg: 14 });
    for (let i = 0; i < 5; i++) b.box(-13 + i * 2.6, 0.07, 3, 1.4, 0.02, 0.14, '#e9e2c6');
    b.box(1.6, 0.5, 3, 1.5, 1, 1.1, STONE); for (const s of [-1, 1]) b.box(1.6 + s * 0.42, 1.2, 3, 0.86, 0.12, 0.9, '#f4f2ea', { rz: s * 0.35 });
    // The gate: two pylons and a beam across the drive, a gatehouse and a raised barrier
    for (const z of [0.2, 5.8]) { b.cyl(-12.4, 3, z, 1, 6, STONE, { seg: 4, top: 0.7, ry: PI / 4 }); b.box(-12.4, 6.1, z, 1.3, 0.24, 1.3, '#2f8f55'); }
    b.box(-12.4, 5.2, 3, 1, 1.1, 5.6, STONE); b.box(-12.4, 5.86, 3, 1.2, 0.2, 6, '#2f8f55');
    sign(b, -11.86, 5.2, 3, 'WELCOME', { size: 0.5, color: '#1f6f4a', ry: HALF });
    b.box(-12.4, 1.4, 8.2, 2.2, 2.8, 2.2, '#e9e2cf'); b.box(-12.4, 2.9, 8.2, 2.6, 0.2, 2.6, '#a8653f'); b.box(-11.28, 1.8, 8.2, 0.04, 0.8, 1.2, '#5d7488');
    b.box(-10.2, 1.9, 5.4, 0.12, 0.12, 3.6, '#c9423a', { rx: 0.5 }); b.box(-10.2, 0.6, 6.8, 0.3, 1.2, 0.3, METAL_DARK);
    // The senate block across the back: a tall slab of fins and window bands round a stair tower, the name across its head
    const h = slabBlock(b, 0.8, -10.4, 19, 4.4, 3, '#e6dcc0', '#5d7488', '#bdb298', 1.9);
    b.box(0.8, 6.2, -9.4, 4.4, 12.4, 4.2, '#d9cdae'); b.box(0.8, 12.5, -9.4, 4.8, 0.3, 4.6, '#bdb298');
    for (let f = 0; f < 3; f++) b.box(0.8, 2.6 + f * 3.2, -7.28, 2.2, 2, 0.06, '#5d7488');
    labelled(b, label, 0.8, h + 1.2, -7.26, 4, 0.36, '#f4efe0', '#1f6f4a');
    b.box(0.8, 3, -6.4, 6, 0.24, 2.2, '#bdb298'); for (const s of [-1, 1]) b.cyl(0.8 + s * 2.6, 1.5, -5.6, 0.16, 3, STONE, { seg: 6 });
    // A round lecture theatre at the right, its roof a shallow cone
    b.cyl(11, 1.7, -3, 3.4, 3.4, '#ded2b4', { seg: 14 }); b.cone(11, 4.1, -3, 3.8, 1.4, '#a8653f', { seg: 14 }); b.cyl(11, 3.44, -3, 3.7, 0.16, '#bdb298', { seg: 14 });
    for (let i = 0; i < 5; i++) { const a = -0.4 + i * 0.55; b.box(11 + Math.sin(a) * 3.42, 1.9, -3 + Math.cos(a) * 3.42, 0.8, 1.3, 0.06, '#5d7488', { ry: a }); }
    // Open ground: flags by the circle, neem trees, boulders, students on the paths
    for (let i = 0; i < 3; i++) flag(b, 5.4 + i * 1.2, -0.2 - i * 0.9, { h: 6.4, w: 1.6, colors: i === 1 ? [...NATION] : ['#2f8f55', '#f4f2ea'] });
    leafTree(b, -6.6, -4.2, { s: 1.3, tone: 2 }); leafTree(b, -12.6, -6.4, { s: 1.1, tone: 0 }); leafTree(b, -13, 11, { s: 1, tone: 2 }); leafTree(b, -5.4, 8.6, { s: 1, tone: 1 });
    boulder(b, 11, 0, 8.6, 1.2, 0); boulder(b, 12.8, 0, 7.2, 0.8, 1); boulder(b, 12.6, 0, 10.2, 0.7, 3); boulder(b, 9.4, 0, 4.4, 0.6, 2); bush(b, 9, 10.4, { color: '#8fa050' });
    bench(b, -6.6, -1.8, { back: true, color: '#8f8a7d', leg: '#6a665c' });
    extra(b, 'uni-student-1', -6.2, -1.8, 0, 'sit', { seat: 0.6, look: { body: 'woman', outfit: 'casual', outfitColor: 'green', accessories: ['backpack'] } });
    extra(b, 'uni-student-2', 3.4, -3.6, 2.8, 'walk', { look: { body: 'man', outfit: 'casual', outfitColor: 'blue', accessories: ['backpack'] } });
    extra(b, 'uni-porter', -10.4, 8.4, HALF, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', fabric: 'plain', accessories: ['cap'] } });
    lampPost(b, -2.4, 6.2, { light: true }); lampPost(b, 6.4, 6.4);
    hills(b, [[-44, -30, 14, 8], [34, -46, 20, 9], [58, -20, 12, 6]]); farTrees(b, rand, 12, -50, 50, -38, -17);
    return {
      spots: [
        landmark('senate', /visit|senate|campus|block|look|learn/, -1.8, -3.6, PI),
        landmark('work', /work|staff|office|desk|job|shift/, 3.6, -5.2, PI, { act: { pose: 'work' } }),
        landmark('gate', /gate|drive|arrive/, -8.4, 0.2, -HALF),
        landmark('people', /people|crowd|meet/, 1.6, 8.6, 0),
      ],
      crowd: [[3.4, 8.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 6.2, 2.4], [-6, 6.6, 1.2], [6.6, 9.8, -0.8], [-8.4, 9.6, 0.8], [3, 10.6, 2.8], [-3.2, 10.2, 2.4], [-3.6, -0.6, 1.6], [6.4, 1.4, -0.4], [0.2, 10.4, 3.1], [5.4, -3.4, 0.6]],
      spare: frontSpare(),
    };
  },
};

/** A blue glass block with a drum at its middle over a paved plaza, clipped trees, a ball court at the front. */
const campusGlass: SceneDef = {
  mood: 'outdoor', accent: '#3f72c4',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b, '#a9b070');
    ground(b, { w: 30, d: 26, color: LAWN, edge: LAWN_EDGE });
    b.box(0, 0.04, 1.2, 12, 0.04, 21, PAVING); b.box(0, 0.045, -4.4, 28, 0.04, 3, PAVING);
    for (let z = -8; z <= 10; z += 3) b.box(0, 0.07, z, 12, 0.02, 0.1, '#bfb7a2');
    // The main block: two wings of blue glass in white frames and, between them, a glass drum under a wide white ring
    for (const s of [-1, 1]) {
      b.box(s * 9.6, 4.3, -10.4, 9.6, 8.6, 4.6, '#f4f2ea');
      b.box(s * 9.6, 4.5, -8.07, 8.8, 7, 0.06, '#4f86b8'); if (s > 0) b.box(14.43, 4.5, -10.4, 0.06, 7, 3.8, '#4f86b8');
      for (let i = 0; i < 4; i++) b.box(s * 9.6 - 3.3 + i * 2.2, 4.5, -8.02, 0.14, 7, 0.1, '#f4f2ea');
      for (const y of [2.6, 4.9, 7.2]) b.box(s * 9.6, y, -8.02, 8.8, 0.18, 0.1, '#f4f2ea');
      b.box(s * 9.6, 8.75, -10.4, 10, 0.3, 5, '#dcd8cc');
    }
    b.cyl(0, 5, -9.8, 5, 10, '#4f86b8', { seg: 18, sz: 0.74 });
    for (const y of [2.8, 5.1, 7.4]) b.cyl(0, y, -9.8, 5.08, 0.2, '#f4f2ea', { seg: 18, sz: 0.74 });
    b.cyl(0, 10.2, -9.8, 5.7, 0.5, '#f4f2ea', { seg: 18, sz: 0.74 });
    b.box(0, 3.5, -5.2, 6.4, 0.3, 2.4, '#f4f2ea'); for (const s of [-1, 1]) b.cyl(s * 2.8, 1.7, -4.4, 0.18, 3.4, '#f4f2ea', { seg: 8 });
    b.box(0, 1.5, -6.02, 3, 3, 0.1, '#2b4a6a');
    labelled(b, label, 0, 4.2, -4.0, 5.8, 0.44, '#f4f2ea', '#27507c', true);
    // Clipped trees in planters down the plaza, banners on poles, benches
    for (const s of [-1, 1]) for (const z of [-1.4, 2.6, 6.6]) { b.box(s * 5, 0.25, z, 1.3, 0.5, 1.3, '#bdb6a5'); clipped(b, s * 5, z, 0.9); }
    for (const [x, z] of ([[-8.2, -2.2], [-10.6, -2.2], [8.2, -2.2]] as [number, number][])) { b.cyl(x, 2.6, z, 0.06, 5.2, '#c9ced3', { seg: 5 }); b.box(x + 0.45, 3.8, z, 0.8, 2.4, 0.04, '#27507c'); b.box(x + 0.45, 3.2, z + 0.03, 0.8, 0.3, 0.02, '#f4f2ea'); }
    bench(b, -3.2, 4.6, { back: true, ry: HALF, color: '#9aa0a6', leg: METAL_DARK }); bench(b, 3.2, 0.6, { back: true, ry: -HALF, color: '#9aa0a6', leg: METAL_DARK });
    // The ball court on the right lawn: a painted slab, a hoop on a post, a ball
    b.box(10.4, 0.05, 5.4, 6.6, 0.04, 9.6, '#b5654a'); b.box(10.4, 0.08, 5.4, 6.2, 0.02, 0.08, WHITE); b.disc(10.4, 0.08, 5.4, 1.1, WHITE, { seg: 14 }); b.disc(10.4, 0.085, 5.4, 1, '#b5654a', { seg: 14 });
    for (const s of [-1, 1]) { b.box(10.4 + s * 3.2, 0.08, 5.4, 0.08, 0.02, 9.4, WHITE); b.box(10.4, 0.08, 5.4 + s * 4.7, 6.4, 0.02, 0.08, WHITE); }
    b.cyl(10.4, 1.9, 0.2, 0.1, 3.8, METAL_DARK, { seg: 6 }); b.box(10.4, 3.6, 0.5, 1.5, 1, 0.08, WHITE); b.cyl(10.4, 3.3, 0.9, 0.3, 0.05, '#e0822f', { seg: 8, open: true }); b.ball(9.4, 0.3, 4.4, 0.22, 0.22, 0.22, '#e0822f', { seg: 6 });
    // A pond lawn on the left with a tall tree
    tallTree(b, -11.4, 7.2, { h: 6, s: 1.1, tone: 1 }); leafTree(b, -9, 10.2, { s: 0.9, tone: 0 }); bush(b, -12.6, 3.2); bush(b, -8.2, 3.4, { s: 0.8, color: '#c0407e' });
    extra(b, 'nile-player', 10.8, 3.4, PI, 'wave', { look: { body: 'man', outfit: 'jersey', outfitColor: 'blue' } });
    extra(b, 'nile-student-1', -2.8, 4.6, HALF, 'sit', { seat: 0.6, look: { body: 'woman', outfit: 'casual', outfitColor: 'cream', accessories: ['glasses'] } });
    extra(b, 'nile-student-2', 2.2, -2.4, 2.9, 'walk', { look: { body: 'man', outfit: 'office', outfitColor: 'blue', bottomsColor: 'navy', fabric: 'plain' } });
    lampPost(b, -5.6, 9.6, { light: true }); lampPost(b, 5.6, -2.6);
    return {
      spots: [
        landmark('plaza', /visit|plaza|campus|block|look|learn/, 1.4, -1.6, PI),
        landmark('work', /work|staff|office|desk|job|shift/, -1.8, -2.8, PI, { act: { pose: 'work' } }),
        landmark('court', /court|ball|play|sport/, 6.2, 5.4, HALF),
        landmark('people', /people|crowd|meet/, -0.6, 8.2, 0),
      ],
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [1.4, 3.6, 2.4], [-7, 6.6, 1.2], [3.6, 10.2, -0.8], [-6.4, 9.4, 0.8], [-1, 10.6, 2.8], [-5.2, -4.4, 2.4], [-11, -3.6, 1.6], [6.6, -4.4, -0.4], [0.2, 5.4, 3.1], [-1.6, 1.2, 0.6]],
      spare: [[-2, 8.6], [2, 9], [-3, 10.4], [0, 6]],
    };
  },
};

/** Cream and terracotta blocks on three sides of a court of palms, cross paths and a fountain. */
const campusCourt: SceneDef = {
  mood: 'outdoor', accent: '#b5533c',
  camera: { landscape: [17, 22.5, 29.5], portrait: [13, 48, 69] },
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: LAWN, edge: LAWN_EDGE });
    b.box(0, 0.04, 2.4, 3, 0.04, 20, '#e2d6bc'); b.box(0, 0.04, 0.6, 20, 0.04, 2.6, '#e2d6bc');
    // The blocks: three storeys across the back and down the left, two at the right; a terracotta stair tower at each corner
    const cream = '#f0e7d0', red = '#b5533c', glass = '#55707f';
    const tall = slabBlock(b, 0, -10.6, 21, 4, 3, cream, glass, red, 2.6);
    slabBlock(b, -12.4, -1.2, 3.8, 14.8, 3, cream, glass, red, 9);
    slabBlock(b, 12.6, -5.4, 3.4, 6.4, 2, cream, glass, red, 9);
    for (const x of [-10.9, 10.9]) { b.box(x, tall / 2 + 0.9, -9.4, 2.6, tall + 1.8, 3.2, red); b.box(x, tall + 1.95, -9.4, 3, 0.3, 3.6, cream); for (let f = 0; f < 3; f++) b.box(x, 2 + f * 3.2, -7.77, 0.6, 2, 0.06, glass); }
    // A walkway on columns along the foot of the back block, its roof a terracotta band; the name over the middle doors
    b.box(0, 3.3, -7.9, 18.4, 0.24, 1.6, red); for (let x = -8.4; x <= 8.4; x += 2.8) b.cyl(x, 1.6, -7.3, 0.16, 3.2, cream, { seg: 8 });
    b.box(0, tall + 1.2, -8.56, 9.4, 1.9, 0.3, red); b.box(0, tall + 2.25, -8.56, 9.8, 0.2, 0.5, cream);
    labelled(b, label, 0, tall + 1.2, -8.38, 8.6, 0.6, '#f6f0de', red);
    b.box(0, 1.4, -8.56, 2.6, 2.8, 0.1, '#4a3626');
    // The court: a round basin with a jet where the paths cross, royal palms down the long path, benches, flower beds
    b.cyl(0, 0.3, 0.6, 2.2, 0.6, '#cfc6ae', { seg: 16 }); b.disc(0, 0.62, 0.6, 1.95, '#79c3df', { seg: 16, ...GLASS });
    b.cyl(0, 0.9, 0.6, 0.3, 1.2, '#cfc6ae', { seg: 8 }); b.cyl(0, 1.55, 0.6, 0.8, 0.1, '#dcd3bc', { seg: 10, top: 1.3 }); b.cyl(0, 2.2, 0.6, 0.06, 1.2, '#bfe3f2', { seg: 5, layer: 'glass' });
    for (const [x, z] of ([[-2.8, -4.4], [2.8, -4.4], [-9.4, 3.4], [-9.4, 8.6]] as [number, number][])) palm(b, x, z, { s: 1.15, lean: 0.03, ry: x > 0 ? 0 : PI });
    for (const [x, z] of ([[-6.4, -3], [6.4, -3], [-6.4, 4.4], [6.4, 4.4]] as [number, number][])) { b.box(x, 0.2, z, 3.4, 0.4, 1.6, '#7a5a3c'); for (let i = 0; i < 5; i++) b.ico(x - 1.2 + i * 0.6, 0.55, z, 0.3, 0.24, 0.3, ['#e9614b', '#e8c43a', '#f1efe8', '#dd6fa0', '#e9614b'][i]!); }
    bench(b, -5.4, 1.2, { back: true, ry: PI, color: '#8a6644' }); bench(b, 5.4, 1.2, { back: true, ry: PI, color: '#8a6644' });
    extra(b, 'baze-student-1', 5.4, 1.2, PI, 'sit', { seat: 0.6, look: { body: 'woman', outfit: 'owambe', outfitColor: 'red', accessories: ['handbag'] } });
    extra(b, 'baze-student-2', -3.4, -5.4, 0.4, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'cream', bottomsColor: 'navy', fabric: 'plain' } });
    extra(b, 'baze-student-3', -8.6, 7.4, 2.2, 'walk', { look: { body: 'woman', outfit: 'casual', outfitColor: 'violet', accessories: ['backpack'] } });
    lampPost(b, -4, 7, { light: true }); lampPost(b, 4, 7); lampPost(b, 8.6, -6.6);
    bush(b, 12.6, 6.4, { s: 1.2 }); bush(b, 6.6, 10.8, { color: '#c0407e' }); bush(b, -6, 10.8);
    return {
      spots: [
        landmark('court', /visit|court|campus|fountain|look|learn/, 2.6, 3.4, -2.6),
        landmark('work', /work|staff|office|desk|job|shift/, -3.6, -6, PI, { act: { pose: 'work' } }),
        landmark('walkway', /walkway|door|class/, 3, -6, PI),
        landmark('people', /people|crowd|meet/, 0.6, 8.4, 0),
      ],
      crowd: [[1.2, 6.4, 0.4], [-1.2, 9.6, -0.5], [7.6, 6.8, 2.4], [-6, 7.4, 1.2], [8.6, 9.2, -0.8], [-10.4, 9, 0.8], [5, 10.6, 2.8], [-5.2, 10.4, 2.4], [-8.6, -0.6, 1.6], [9, 0.4, -0.4], [0.4, 10.8, 3.1], [5.4, -5.6, 0.6]],
      spare: [[-6, 8.6], [6, 9], [-4, 10.4], [4.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Neighbourhood gardens

/** An ayo board on a low table with a stool at each end. */
function ayoTable(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => {
    table(b, 0, 0, { w: 1.3, d: 0.9, h: 0.7 }); b.box(0, 0.74, 0, 0.9, 0.08, 0.36, '#6b4a2f');
    for (let i = 0; i < 12; i++) b.cyl(-0.38 + (i % 6) * 0.15, 0.79, i < 6 ? -0.09 : 0.09, 0.055, 0.02, '#d9c58c', { seg: 5 });
    stool(b, 0, -0.95, { h: 0.45 }); stool(b, 0, 0.95, { h: 0.45 });
  });
}

const ayoGarden: SceneDef = {
  mood: 'outdoor', accent: '#f2c14e',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#6a9f52', edge: '#48703b' });
    b.box(0, 0.04, 4.6, 2.4, 0.04, 16, '#dcc99a'); b.box(-2, 0.04, -1.6, 18, 0.04, 2.2, '#dcc99a');
    // A low painted wall along the back and the left; bungalows of the estate and the town's rock hills beyond it
    b.box(0, 0.5, -12.4, 29.6, 1, 0.4, '#ece5d2'); b.box(0, 1.06, -12.4, 29.8, 0.14, 0.56, '#2f8f55');
    b.box(-14.6, 0.5, -1, 0.4, 1, 22.6, '#ece5d2'); b.box(-14.6, 1.06, -1, 0.56, 0.14, 22.8, '#2f8f55');
    house(b, -10, -17, 5, 4, 2.6, 0); house(b, -3, -18, 5.4, 4, 2.6, 2, 0, '#e6dcc0'); house(b, 4.6, -17.2, 5, 4, 2.6, 1); house(b, 12, -18.4, 5.4, 4, 2.6, 3, 0, '#dcd0b0');
    hills(b, [[-16, -40, 20, 12], [22, -44, 24, 14], [52, -24, 12, 7]]);
    // The neem tree with a ring seat round its foot, and the ayo boards in its shade
    b.cyl(-5.6, 1.9, -5.6, 0.42, 3.8, '#6b5440', { seg: 7, top: 0.7 });
    for (const [dx, dy, dz, r] of ([[0, 5.2, 0, 3.2], [-2.2, 4.6, 0.8, 2.2], [2.4, 4.8, -0.4, 2.4], [0.4, 6.4, 0.4, 2], [-0.6, 4.6, 2, 2]] as [number, number, number, number][])) b.ico(-5.6 + dx, dy, -5.6 + dz, r, r * 0.66, r, ['#3d7a4a', '#4f8a45', '#5f9a50'][Math.round(r * 10) % 3]!);
    b.cyl(-5.6, 0.3, -5.6, 1.3, 0.6, '#cfc6ae', { seg: 12 });
    ayoTable(b, -2.6, -4.6, 0.3); ayoTable(b, -8.4, -3.4, -0.5);
    extra(b, 'kubwa-ayo-1', -2.88, -5.5, 0.3, 'sit', { seat: 0.45, look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream', accessories: ['fila'] } });
    extra(b, 'kubwa-ayo-2', -2.32, -3.7, PI + 0.3, 'sit', { seat: 0.45, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'teal', accessories: ['headwrap'] } });
    // A pergola with a flowering climber over a bench at the right
    b.at(8.6, 0, -6.6, 0, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 2.4, 1.5, sz * 1.5, 0.18, 3, 0.18, WHITE);
      for (let i = 0; i < 7; i++) b.box(-2.4 + i * 0.8, 3.1, 0, 0.12, 0.14, 3.8, WHITE);
      for (const sz of [-1, 1]) b.box(0, 2.98, sz * 1.5, 5.4, 0.14, 0.14, WHITE);
      for (const [x, z, c] of ([[-1.8, -1.2, '#c0407e'], [0.2, 0.6, '#dd6fa0'], [1.8, -0.4, '#c0407e'], [-0.6, -0.2, LEAF]] as [number, number, Colour][])) b.ico(x, 3.4, z, 1, 0.34, 0.9, c);
      bench(b, 0, -0.8, { w: 3.4, back: true, color: '#8a6644' });
    });
    // Raised beds of vegetables and flowers, painted tyre planters along the path, a swing and a see-saw
    for (const [x, z] of ([[-10.6, 3.4], [-10.6, 6.6], [-6.2, 3.4], [-6.2, 6.6]] as [number, number][])) { b.box(x, 0.2, z, 3.4, 0.4, 2, '#7a5a3c'); for (let i = 0; i < 8; i++) b.ico(x - 1.2 + (i % 4) * 0.8, 0.52, z - 0.45 + Math.floor(i / 4) * 0.9, 0.3, 0.24, 0.3, (i + Math.round(z)) % 3 ? '#4f8a45' : '#e8c43a'); }
    for (let i = 0; i < 5; i++) { b.cyl(1.9, 0.18, 0.8 + i * 2.1, 0.44, 0.36, ['#c9423a', '#f2c14e', '#3f72c4', '#f4f2ea', '#2f8f55'][i]!, { seg: 8 }); b.ico(1.9, 0.5, 0.8 + i * 2.1, 0.3, 0.28, 0.3, '#5f9a50'); }
    b.at(9, 0, 3.4, 0.2, () => {
      for (const s of [-1, 1]) { b.box(s * 1.6, 1.3, 0, 0.12, 2.7, 0.12, '#3f72c4', { rx: 0.25 }); b.box(s * 1.6, 1.3, 0, 0.12, 2.7, 0.12, '#3f72c4', { rx: -0.25 }); }
      b.box(0, 2.6, 0, 3.4, 0.12, 0.12, '#3f72c4');
      for (const s of [-0.7, 0.7]) { b.box(s - 0.2, 1.5, 0, 0.03, 2.1, 0.03, METAL_DARK); b.box(s + 0.2, 1.5, 0, 0.03, 2.1, 0.03, METAL_DARK); b.box(s, 0.5, 0, 0.5, 0.06, 0.24, '#c9423a'); }
    });
    b.at(7.4, 0, 8, -0.3, () => { b.box(0, 0.36, 0, 0.3, 0.7, 0.3, '#f2c14e'); b.box(0, 0.76, 0, 3.4, 0.1, 0.3, '#c9423a', { rz: 0.16 }); });
    signBoard(b, -9.4, 10.4, label, { y: 1.7, size: fit(label, 6.4, 0.34), color: '#f4efe0', board: '#2f6f4a' });
    extra(b, 'kubwa-gardener', -8.4, 5, HALF, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'green', accessories: ['cap'] } });
    lampPost(b, 3.2, -3.2, { light: true }); lampPost(b, -3.4, 9.4); leafTree(b, -12.6, -9.6, { s: 1, tone: 0 }); palm(b, 13, -1.4, { s: 0.95 });
    return {
      spots: [
        landmark('ayo', /visit|ayo|tree|shade|play|garden|rest/, -4.8, -1.8, PI),
        landmark('work', /work|staff|bed|plant|job|shift/, -8.4, 1.4, 0, { act: { pose: 'work' } }),
        landmark('pergola', /pergola|bench|sit|flower/, 8.6, -3.6, PI),
        landmark('people', /people|crowd|meet/, 3.6, 7.6, 0),
      ],
      crowd: [[4.4, 7.4, 0.4], [-1.6, 7.6, -0.5], [5.6, 5.2, 2.4], [-1.8, 1.2, 1.2], [10.6, 9.4, -0.8], [-2.4, 10.6, 0.8], [3.6, 10.4, 2.8], [4.6, -0.2, 2.4], [-11.4, -0.4, 1.6], [11.6, -0.8, -0.4], [0.2, 9, 3.1], [5.4, 2.6, 0.6]],
      spare: [[4, 8.6], [6, 9], [-2, 9.4], [3.4, 5.8]],
    };
  },
};

const plotGarden: SceneDef = {
  mood: 'outdoor', accent: '#5f9a48',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(91);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#8aa058', edge: '#5f6f3a' });
    b.box(1.6, 0.04, 3, 2.2, 0.04, 19, '#c9a674'); b.box(-5, 0.04, 0.2, 12, 0.04, 1.8, '#c9a674');
    // Two blocks of planted ridges: brown earth in rows with greens, maize at the back
    for (const [x0, z0, kind] of ([[-12.6, -9.4, 0], [-12.6, 2.2, 1]] as [number, number, number][])) {
      for (let r = 0; r < 5; r++) {
        const z = z0 + r * 1.6;
        b.box(x0 + 5.6, 0.14, z, 11.2, 0.28, 1, '#7a5638');
        for (let i = 0; i < 9; i++) {
          const x = x0 + 0.7 + i * 1.24;
          if (kind === 0 && r < 2) { b.box(x, 1.1, z, 0.08, 1.9, 0.08, '#6f9a45'); b.box(x, 1.4, z, 0.7, 0.05, 0.16, '#5f9a48', { rz: 0.5 }); b.box(x, 1.0, z, 0.7, 0.05, 0.16, '#6aa552', { rz: -0.5 }); }
          else b.ico(x, 0.44, z, 0.34, 0.24, 0.34, (i + r + kind) % 4 ? '#4f8a45' : '#8cb354');
        }
      }
    }
    // A water tank on a steel stand with a hand pump on its apron, buckets, a watering can
    b.at(8.4, 0, -8.6, 0, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1, 2, sz * 1, 0.14, 4, 0.14, METAL_DARK);
      for (const y of [1.4, 3]) for (const s of [-1, 1]) { b.box(0, y, s * 1, 2.1, 0.08, 0.08, METAL_DARK); b.box(s * 1, y, 0, 0.08, 0.08, 2.1, METAL_DARK); }
      b.box(0, 4.06, 0, 2.6, 0.12, 2.6, METAL);
      b.cyl(0, 5.2, 0, 1.2, 2.2, '#22262c', { seg: 12 }); b.cyl(0, 6.4, 0, 1.2, 0.3, '#22262c', { seg: 12, top: 0.4 });
      for (const y of [4.7, 5.3, 5.9]) b.cyl(0, y, 0, 1.24, 0.08, '#3a3f46', { seg: 12 });
    });
    b.box(5.2, 0.08, -5.6, 2.6, 0.16, 2.6, CONCRETE); b.cyl(5.2, 0.7, -5.6, 0.12, 1.1, '#3f72c4', { seg: 6 }); b.box(5.2, 1.3, -5.2, 0.08, 0.08, 1.2, '#3f72c4', { rx: -0.4 }); b.box(5.2, 0.9, -6.1, 0.1, 0.1, 0.5, '#3f72c4');
    for (const [x, z, c] of ([[6.4, -4.6, '#c9423a'], [4.2, -4.2, '#3f72c4']] as [number, number, Colour][])) b.cyl(x, 0.22, z, 0.24, 0.44, c, { seg: 7, top: 1.2 });
    // A thatched shelter with a bench, mango trees, plantain, a barrow and a compost heap
    thatchShelter(b, 9.4, 3.6, 2.3); bench(b, 9.4, 3.2, { w: 2.4, back: true, color: '#8a6644' });
    extra(b, 'gwa-garden-rest', 9.4, 3.2, 0, 'sit', { seat: 0.6, look: { body: 'man', outfit: 'kaftan', outfitColor: 'gold', accessories: ['fila'] } });
    for (const [x, z, s] of ([[12.4, -3.2, 1.35], [-12.4, 10.6, 1.1]] as [number, number, number][])) { leafTree(b, x, z, { s, tone: 0 }); for (let i = 0; i < 5; i++) b.ball(x - 1.2 + i * 0.6, 2.6 * s + (i % 2) * 0.5, z + 1.3 * s, 0.14, 0.18, 0.14, '#e8a13a', { seg: 4 }); }
    for (const [x, z] of ([[12.6, 9], [13.4, 7.2]] as [number, number][])) { b.cyl(x, 1.1, z, 0.16, 2.2, '#8a9a5a', { seg: 6 }); for (let i = 0; i < 5; i++) b.box(x + Math.sin(i * 1.26) * 0.7, 2.4, z + Math.cos(i * 1.26) * 0.7, 0.5, 0.05, 1.5, i % 2 ? '#5f9a48' : '#6aa552', { ry: i * 1.26, rx: 0.5 }); }
    b.at(4.4, 0, 6.6, 0.8, () => { b.box(0, 0.55, 0, 0.9, 0.4, 1.3, '#3d7a5a'); b.cyl(0, 0.26, 0.8, 0.26, 0.1, BLACK, { seg: 7, rz: HALF }); for (const s of [-1, 1]) b.box(s * 0.4, 0.5, -1.1, 0.06, 0.06, 1, WOOD_DARK); });
    b.ico(12.2, 0.4, -10.6, 1.3, 0.6, 1.1, '#5a4634'); b.ico(11.4, 0.3, -11.2, 0.8, 0.4, 0.7, '#6f6a3a');
    // A pole fence along the back and the open savanna behind it
    fence(b, [-14.4, -12.4], [14.4, -12.4], { h: 1.3, color: '#8a6a44', gap: 2 });
    signBoard(b, 6.6, 10.6, label, { y: 1.7, size: fit(label, 6.8, 0.32), color: '#f4efe0', board: '#4a6f3a' });
    extra(b, 'gwa-gardener-1', -5.4, -1.2, 2.9, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', accessories: ['headwrap'] } });
    extra(b, 'gwa-gardener-2', 5.8, -3.8, -2.4, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'blue', accessories: ['cap'] } });
    hills(b, [[-36, -40, 16, 7], [30, -48, 22, 9]]); farTrees(b, rand, 14, -50, 50, -40, -15); lampPost(b, 3.2, 10.6, { light: true });
    return {
      spots: [
        landmark('plots', /visit|plot|ridge|garden|grow|look|learn/, 0.4, 3.4, -HALF),
        landmark('work', /work|staff|tend|plant|job|shift/, -3.4, 0.4, PI, { act: { pose: 'work' } }),
        landmark('pump', /pump|water|tank/, 3.4, -2.4, 2.4),
        landmark('people', /people|crowd|meet/, 3.6, 8.2, 0),
      ],
      crowd: [[4.4, 8.4, 0.4], [0.2, 8.6, -0.5], [7.6, 7.2, 2.4], [3.2, 5.2, 1.2], [8.6, 9.6, -0.8], [-0.2, 10.8, 0.8], [3.6, 0.6, 2.8], [6.6, -0.4, 2.4], [8.6, -2.2, 1.6], [11.4, 0.6, -0.4], [1.6, 1.4, 3.1], [2.4, -9.4, 0.6]],
      spare: [[3, 8.6], [6, 9], [1, 10.4], [5.4, 5.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Evening garden

/** A walled estate garden at dusk: a small stage under a lighting bar, round tables on the lawn, a grill and a drinks hut. */
const evening: SceneDef = {
  mood: 'outdoor', accent: '#e0762c',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b, '#9aa46a');
    ground(b, { w: 30, d: 26, color: '#4f8a4a', edge: '#3a6238' });
    b.disc(0, 0.06, 0.4, 5.6, '#cfc3a6', { seg: 20 }); b.box(0, 0.05, 7.6, 2.6, 0.04, 9, '#cfc3a6');
    // The estate behind the garden wall: two-storey houses under dark roofs
    b.box(0, 1.1, -12.5, 29.6, 2.2, 0.4, '#d9d0b8');
    for (const [x, c, t] of ([[-11, '#e9e2cf', 0], [-3.6, '#e0d3b6', 2], [4, '#ece5d2', 1], [11.4, '#dcd0b0', 3]] as [number, Colour, number][])) {
      b.box(x, 3, -18, 6.2, 6, 5, c); for (const s of [-1, 1]) b.box(x, 6.7, -18 + s * 1.3, 6.8, 0.16, 3.2, t % 2 ? '#6a4a3c' : '#7a5340', { rx: s * 0.42 });
      for (const sx of [-1, 1]) for (const y of [1.8, 4.4]) b.box(x + sx * 1.6, y, -15.47, 1.2, 1.3, 0.06, '#ffd58a', (sx + y + t) % 2 > 0.5 ? GLOW : undefined);
    }
    // The stage: a low deck, a backdrop of dyed panels, a bar of lamps on two posts, speakers, a keyboard and drums
    b.box(0, 0.35, -9.2, 9, 0.7, 4.4, '#6a5444'); b.box(0, 0.72, -9.2, 9.2, 0.06, 4.6, '#8a705a');
    b.box(0, 2.9, -11.5, 9.4, 4.4, 0.24, '#2f2630'); for (let i = 0; i < 7; i++) b.box(-3.9 + i * 1.3, 2.9, -11.35, 1.1, 4.2, 0.08, ['#e0762c', '#8a3a5a', '#d6a83a', '#27437a'][i % 4]!);
    for (const s of [-1, 1]) { b.cyl(s * 4.6, 3, -7.4, 0.12, 6, METAL_DARK, { seg: 6 }); speaker(b, s * 5.6, -7.6, { h: 2.2, w: 1.1 }); }
    b.box(0, 5.9, -7.4, 9.6, 0.22, 0.22, METAL_DARK); for (let i = 0; i < 6; i++) b.box(-3.75 + i * 1.5, 5.6, -7.4, 0.44, 0.44, 0.44, i % 2 ? '#ffd58a' : '#ffb0a0', GLOW);
    b.light(0, 4.6, -7.4, '#ffd9a0', 26, 13);
    labelled(b, label, 0, 6.7, -7.4, 9.2, 0.44, '#f4e6b8', '#2f2630', true);
    b.box(-2.6, 1.55, -9.4, 1.9, 0.14, 0.6, '#22262c'); for (const s of [-1, 1]) b.box(-2.6 + s * 0.7, 1.1, -9.4, 0.06, 0.8, 0.06, METAL_DARK, { rz: s * 0.3 });
    b.cyl(2.8, 1.2, -9.8, 0.55, 0.5, '#8a3a2e', { seg: 9, rx: HALF }); b.cyl(2, 1.4, -9.2, 0.3, 0.3, '#d9d5c8', { seg: 8 }); b.cyl(3.6, 1.85, -9.4, 0.4, 0.04, '#d6a83a', { seg: 8 }); b.cyl(3.6, 1.3, -9.4, 0.03, 1.1, METAL_DARK, { seg: 4 });
    b.cyl(0.2, 1.5, -8, 0.03, 1.5, METAL_DARK, { seg: 4 }); b.ball(0.2, 2.3, -8, 0.08, 0.1, 0.08, BLACK, { seg: 5 });
    extra(b, 'gwarinpa-singer', 0.2, -8.6, 0, 'wave', { y: 0.75, look: { body: 'woman', outfit: 'owambe', outfitColor: 'gold', hair: 'gele' } });
    extra(b, 'gwarinpa-keys', -2.6, -10, 0, 'work', { y: 0.75, look: { body: 'man', outfit: 'kaftan', outfitColor: 'navy' } });
    // Strings of bulbs from the stage to poles at the front, round tables on the lawn
    for (const s of [-1, 1]) { b.cyl(s * 12.6, 2.7, 6.4, 0.08, 5.4, METAL_DARK, { seg: 5 }); stringLights(b, [s * 4.6, 5.8, -7.4], [s * 12.6, 5.3, 6.4], { n: 12, sag: 0.9 }); }
    stringLights(b, [-12.6, 5.3, 6.4], [12.6, 5.3, 6.4], { n: 16, sag: 1.1, colors: [WARM, '#ffb0a0', '#bfe3ff'] });
    for (const [x, z, c] of ([[-8.4, -2.6, '#c9423a'], [-9.6, 3.2, '#f4f2ea'], [8.4, -2.2, '#f4f2ea'], [-5.6, 7.8, '#d6a83a']] as [number, number, Colour][])) {
      table(b, x, z, { w: 1.7, round: true, h: 0.95, color: c, leg: METAL_DARK });
      for (let i = 0; i < 3; i++) { const a = i * 2.1 + x; chair(b, x + Math.sin(a) * 1.3, z + Math.cos(a) * 1.3, { ry: a + PI, color: '#f4f2ea', leg: '#c9ced3' }); }
      b.cyl(x, 1.12, z, 0.1, 0.24, WARM, { seg: 5, layer: 'glow' });
    }
    // The grill at the right with meat on skewers, and a drinks hut at the left
    b.at(11.2, 0, 3.6, -HALF, () => {
      b.box(0, 0.5, 0, 2.6, 1, 1, '#3a3d42'); b.box(0, 1.04, 0, 2.4, 0.08, 0.9, '#22252a'); for (let i = 0; i < 6; i++) b.box(-0.9 + i * 0.36, 1.12, 0, 0.1, 0.06, 0.8, '#8a4a2e');
      b.box(0, 1.08, 0.1, 2.2, 0.03, 0.5, '#ff8a3c', GLOW);
      for (const s of [-1, 1]) b.box(s * 1.5, 1.4, -0.6, 0.1, 2.8, 0.1, WOOD_DARK); b.box(0, 2.85, -0.2, 3.6, 0.1, 1.9, '#c9423a', { rx: 0.14 });
    });
    extra(b, 'gwarinpa-grill', 12.3, 3.6, -HALF, 'work', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream', accessories: ['fila'] } });
    kiosk(b, -12, 8.6, { ry: HALF, w: 3.2, color: '#5a4634', roof: '#2f2630', fascia: '#e0762c', text: 'DRINKS', textColor: '#2f2630' });
    palm(b, -13, -6.6, { s: 1.1 }); palm(b, 13.2, -6.8, { s: 1.05, ry: PI }); bush(b, -4.2, 11.6, { s: 0.9 }); bush(b, 4.4, 11.6, { s: 0.9, color: '#c0407e' });
    lampPost(b, 5.6, 8.6, { light: true }); lampPost(b, -4.6, 3.6, { light: true });
    return {
      spots: [
        landmark('stage', /visit|stage|set|music|band|evening|listen|hear|garden/, 0.6, -4.4, PI),
        landmark('work', /work|staff|bar|serve|job|shift|sound/, -8.6, 8.6, -HALF, { act: { pose: 'work' } }),
        landmark('grill', /grill|suya|food|eat/, 8.8, 3.6, HALF),
        landmark('people', /people|crowd|meet/, 1.4, 4.6, 0),
      ],
      crowd: [[2.4, 2.4, 0.4], [-2.4, 1.6, -0.5], [4.6, -1.2, 2.4], [-4, -1.6, 1.2], [3.6, 8.8, -0.8], [-2.2, 9.6, 0.8], [1.6, 10.6, 2.8], [-1.2, -2.6, 2.8], [6.4, 5.6, 1.6], [8.4, 9.6, -0.4], [0.2, 6.4, 3.1], [-3.4, 4.2, 0.6]],
      spare: [[-2, 6.6], [3, 6], [-3, 9.4], [3.4, 2.8]],
    };
  },
};

export const INDOORS: SceneWalkSpec = { bounds: [-11.5, -9.5, 11.5, 9.5], entrance: [0, 8.8], open: false };
/** The everyday scenes by scene kind, then by variant (venue.scene.variant). */
export const EVERYDAY: Record<string, Record<string, SceneDef>> = {
  market: { 'fct-lockups': lockupMarket, 'fct-sheds': shedMarket, 'fct-open': openMarket },
  hub: { 'fct-rail': rail, 'fct-motor-park': motorPark },
  office: { 'fct-campus-gate': campusGate, 'fct-campus-glass': campusGlass, 'fct-campus-court': campusCourt },
  park: { 'fct-garden-ayo': ayoGarden, 'fct-garden-plots': plotGarden },
  rooftop: { 'fct-evening': evening },
};
