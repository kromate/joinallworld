/**
 * OWNER: scenes
 * Scenes of Kano's own places, each asked for through `scene.variant` and held in VARIANTS[kind][variant]
 * like the variants of src/scene/venues-ibadan-b.ts and src/scene/venues-ogun-a.ts. The old city's scenes (the palace
 * gate, the mosque, the dye pits, the old market, the museum, the two hills and the gates) and the helpers shared
 * with them are in src/scene/venues-kano-b.ts; the rest of the city is here:
 *
 *   market / kano-kwari           shop blocks of several storeys behind balconies, every shop stacked with bolts of cloth
 *   market / kano-sabon-gari      long tin-roofed sheds in wide rows: produce, grain, provisions, household wares
 *   viewing / kano-stadium        a football ground with a covered main stand, a running track and four floodlight towers
 *   park / kano-racecourse        an open turf track between white rails, a small stand, a paddock
 *   gym / kano-polo               a polo field with goal posts and sideboards, a clubhouse veranda, a horse line
 *   hub / kano-railway            a brick station of the colonial era with a clock gable, a narrow-gauge platform, a forecourt
 *   hub / kano-motor-park         a motor park: buses in bays, a rank of yellow tricycles, a waiting shed
 *   office / kano-old-campus      low, older teaching blocks with verandas in the shade of neem trees
 *   office / kano-new-campus      large modern faculty buildings round a paved plaza
 *   park / kano-tea-garden        an evening garden of mats and low benches, a tea seller's table, a suya grill, lanterns
 *   office / kano-film-yard       a small film studio's yard: a camera on a tripod, lights, a painted backdrop
 *   statehouse / kano-community-hall  a modest community hall with a porch and a notice board
 *   park / kano-garden            a neighbourhood garden of neem trees, an ayo table, water pots in the shade
 *
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * Scenes are static and keep to the geometry budget of the others. Scene definition format: see venues-outdoor.ts.
 */
import { GLOW } from './build.ts';
import type { Batch, Colour, SceneDef } from './types.ts';
import {
  ground, table, stool, bench, chair, palm, bush, lampPost, flag, parasol, stringLights, fence, windowPane, sign, signBoard, car, speaker, laptop, screen, crate, rug,
  landmark, extra, WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, WARM,
} from './props.ts';
import { PI, HALF, OPEN, seeded, labelled, gable, horse, drum } from './venues-common.ts';
import {
  OLD_CITY, EARTH, MAT, TALL, LOW, MAN, WOMAN, crowdFront, spareFront, places, dust, neem, earthWall, earthWallZ, stele, tricycle, lantern,
} from './venues-kano-b.ts';

// ---------------------------------------------------------------------------------------------
// Textile market: concrete shop blocks of several storeys, their open shops stacked to the ceiling with cloth.

const BOLTS: readonly Colour[] = ['#c9423a', '#e0a43a', '#2a4fa6', '#2f8f55', '#dd6fa0', '#8055c2', '#f1efe8', '#2f9d98', '#e0822f', '#d6a83a', '#243a66', '#a8323a'];
const bolt = (rand: () => number): Colour => BOLTS[Math.floor(rand() * BOLTS.length)]!;
/** A shop block facing +z: open-fronted shops on every floor behind a balcony, bolts standing at the back of each and folded lengths in front. */
function shopBlock(b: Batch, w: number, floors: number, rand: () => number): void {
  const n = Math.round(w / 2.5), bay = w / n, fh = 3.2, d = 4.6, h = floors * fh, concrete = '#d9d2bf';
  b.box(0, h / 2, -d / 2 + 0.15, w, h, 0.3, '#b9b19c');
  for (const s of [-1, 1]) b.box(s * (w / 2 - 0.15), h / 2, 0, 0.3, h, d, concrete);
  for (let f = 0; f <= floors; f++) b.box(0, f ? f * fh - 0.12 : 0.1, 0.55, w + 0.2, 0.24, d + 1.1, f === floors ? '#c4bca6' : concrete);
  for (let i = 0; i <= n; i++) b.box(-w / 2 + i * bay, h / 2, d / 2 - 0.2, 0.3, h, 0.3, concrete);
  b.box(0, h + 0.5, d / 2 + 0.9, w + 0.2, 1, 0.2, concrete);
  for (let f = 0; f < floors; f++) {
    const y = f ? f * fh : 0.22;
    if (f) { b.box(0, y + 0.95, d / 2 + 0.95, w, 0.08, 0.08, METAL_DARK); for (let i = 0; i <= n; i++) b.box(-w / 2 + i * bay, y + 0.48, d / 2 + 0.95, 0.06, 0.95, 0.06, METAL_DARK); }
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + (i + 0.5) * bay;
      for (let k = 0; k < 4; k++) { const tall = 1.9 + rand() * 0.7; b.box(cx - 0.78 + k * 0.52, y + tall / 2, -d / 2 + 0.7, 0.42, tall, 0.4, bolt(rand)); }
      b.box(cx, y + 0.22, 1, 2, 0.44, 0.8, WOOD);
      for (let k = 0; k < 3; k++) b.box(cx, y + 0.55 + k * 0.22, 1, 1.9 - k * 0.26, 0.21, 0.7, bolt(rand));
      if (f && rand() < 0.7) b.quad(cx + (rand() - 0.5) * 0.6, y + 0.3, d / 2 + 1.12, 1.2, 1.5, bolt(rand));
    }
  }
}

const kwari: SceneDef = {
  mood: 'outdoor', accent: '#dd6fa0', camera: TALL, walk: OPEN,
  build(b, context) {
    const rand = seeded(101);
    ground(b, { w: 30, d: 26, color: '#cbbfa6', edge: '#8f8672' });
    b.box(0, 0.05, 3, 4, 0.03, 18, '#d8cfb8');
    // The main block across the back, three storeys; a second, lower block down the left
    b.at(-3.4, 0, -10, 0, () => shopBlock(b, 20, 3, rand));
    b.box(8.4, 5.6, -10, 3.4, 11.2, 4.8, '#cfc7b2'); for (let i = 0; i < 6; i++) b.box(8.4, 1.6 + i * 1.6, -7.58, 1.4, 0.5, 0.06, '#5f6a72');
    b.cyl(8.4, 11.9, -10.4, 1.1, 1.4, '#3a3d42', { seg: 10 });
    labelled(b, context.label, -3.4, 10.1, -6.68, 16, 0.5, '#f6efd8', '#2a3f66', false);
    b.at(-12.6, 0, 1.2, HALF, () => shopBlock(b, 10, 2, rand));
    // In front: trestles of folded cloth under parasols, a handcart of bales, a loaded tricycle
    for (const [x, z, c] of ([[-3.6, 0.4, 0], [3.4, -0.6, 1], [7.6, 3.4, 2]] as [number, number, number][])) {
      table(b, x, z, { w: 2.8, d: 1.2, h: 0.9, color: '#7a5c3c' });
      for (let i = 0; i < 5; i++) for (let k = 0; k < 2 + (i % 2); k++) b.box(x - 1.1 + i * 0.55, 1.0 + k * 0.17, z, 0.48, 0.16, 1, bolt(rand));
      parasol(b, x + 1.7, z - 0.9, { colors: [BOLTS[c * 3]!, WHITE] });
    }
    extra(b, 'kano-kwari-seller-1', -3.6, -0.7, 0, 'stand', { look: MAN('cream') });
    extra(b, 'kano-kwari-seller-2', 3.4, -1.7, 0, 'work', { look: MAN('blue') });
    extra(b, 'kano-kwari-shopper-1', -4.4, 2, PI, 'stand', { look: WOMAN('pink') });
    b.at(-7.4, 0, 6.4, -0.5, () => {
      b.box(0, 0.7, 0, 1.4, 0.12, 2.4, WOOD); for (const s of [-1, 1]) b.cyl(s * 0.8, 0.42, -0.2, 0.42, 0.1, '#3a3028', { seg: 8, rz: HALF }); b.box(0, 0.7, 1.7, 0.08, 0.08, 1.2, WOOD_DARK);
      for (let i = 0; i < 4; i++) b.box((i % 2) * 0.1, 1.02 + Math.floor(i / 2) * 0.5, -0.6 + (i % 2) * 1.1, 1.2, 0.5, 1, i % 2 ? '#e9e4d6' : '#c9b88f');
    });
    extra(b, 'kano-kwari-porter', -6.2, 7.8, 2.6, 'walk', { look: MAN('green', { outfit: 'casual' }) });
    tricycle(b, 11.6, 8.6, -0.6);
    for (let i = 0; i < 3; i++) b.box(11.4 + (i % 2) * 0.5, 0.3 + i * 0.5, 4.6, 1.1, 0.5, 0.9, i % 2 ? '#c9b88f' : '#e9e4d6');
    lampPost(b, 2.4, 6.4, { light: true }); lampPost(b, -9.4, 9.6);
    return {
      spots: places([-0.4, 1.6, PI], [3.4, 1.2, PI], [0.6, 7.6]),
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [5.6, 7.2, 2.4], [-3.4, 5, 1.2], [8.6, 9.8, -0.8], [-9.4, 4.4, 0.8], [3, 10.4, 2.8], [-5.2, 10.2, 2.4], [0.4, -3.6, 0], [10.4, 0.6, -0.4], [0.2, 9, 3.1], [5.4, 4.6, 0.6]],
      spare: spareFront(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// General market: long open sheds under tin roofs with wide rows between them.

/** A long shed running along x: posts, a pitched tin roof, a table down each side heaped with one kind of goods. */
function longShed(b: Batch, len: number, roof: Colour, ridge: Colour, set: number, rand: () => number): void {
  const posts = Math.round(len / 3.5);
  for (let i = 0; i <= posts; i++) for (const s of [-1, 1]) b.box(-len / 2 + i * (len / posts), 1.6, s * 1.35, 0.14, 3.2, 0.14, METAL_DARK);
  for (const s of [-1, 1]) b.box(0, 3.5, s * 0.9, len + 0.8, 0.1, 2, roof, { rx: s * 0.3 });
  b.box(0, 3.8, 0, len + 0.8, 0.1, 0.26, ridge);
  const n = Math.floor((len - 1) / 1.25);
  for (const s of [-1, 1]) {
    b.box(0, 0.9, s * 0.8, len - 0.6, 0.1, 1, WOOD); b.box(0, 0.44, s * 0.8, len - 1, 0.88, 0.8, WOOD_DARK);
    for (let k = 0; k < n; k++) {
      const gx = -(len - 1.6) / 2 + k * ((len - 1.6) / (n - 1)), gz = s * 0.8, pick = Math.floor(rand() * 5);
      if (set === 0) { b.cyl(gx, 1.06, gz, 0.42, 0.2, '#7a7a7e', { seg: 6, top: 1.25 }); b.ico(gx, 1.24, gz, 0.38, 0.22, 0.38, ['#c9423a', '#d9482f', '#7a3f8a', '#5f9a48', '#e8a13a'][pick]!); }
      else if (set === 1) { b.ball(gx, 1.16, gz, 0.42, 0.26, 0.44, ['#e9e4d6', '#c9b88f', '#d9c9a0'][pick % 3]!, { seg: 5 }); b.disc(gx, 1.43, gz, 0.24, ['#e8dcb4', '#a8573a', '#d6a84f', '#8a5a34', '#f1efe8'][pick]!, { seg: 7 }); }
      else if (set === 2) { for (let j = 0; j < 1 + (k % 3); j++) b.box(gx, 1.14 + j * 0.36, gz, 0.9, 0.34, 0.6, ['#c9a56a', '#b8905a', '#d6b47c', '#e9e4d6', '#c08a4f'][(pick + j) % 5]!); }
      else { b.cyl(gx, 1.2, gz, 0.36, 0.5, ['#3f72c4', '#c9423a', '#2f9d98', '#e0a43a', '#dd6fa0'][pick]!, { seg: 6, top: 1.3 }); if (k % 2) b.cyl(gx, 1.56, gz, 0.3, 0.26, ['#2f8f55', '#8055c2', '#e0822f', '#3f72c4', '#c9423a'][pick]!, { seg: 6, top: 1.3 }); }
    }
  }
}

const sabonGari: SceneDef = {
  mood: 'outdoor', accent: '#e0822f', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(107);
    ground(b, { w: 30, d: 26, color: '#c4b594', edge: '#8a7d62' });
    b.box(0, 0.05, 0, 5, 0.03, 25, '#d1c4a4');
    // Four long sheds running back from the front, a wide row up the middle and one on either side
    const sheds: [number, Colour, Colour, number][] = [[-11.4, '#9b5a3a', '#7a4530', 0], [-5.2, '#8f9aa3', '#6f7a83', 1], [5.2, '#6f8a78', '#566e5e', 2], [11.4, '#a8653f', '#7a4530', 3]];
    for (const [x, roof, ridge, set] of sheds) b.at(x, 0, -4.4, HALF, () => longShed(b, 14, roof, ridge, set, rand));
    // The market's name on a board over the far end of the middle row
    for (const x of [-2.5, 2.5]) b.cyl(x, 2.6, -12, 0.1, 5.2, METAL_DARK, { seg: 5 });
    labelled(b, context.label, 0, 4.7, -11.9, 4.6, 0.42, '#f6efd8', '#8a3a2e', false);
    // In the open front: traders under parasols with basins, sacks stacked, a wheelbarrow
    for (const [x, z, c] of ([[-7.4, 6.6, '#e0822f'], [8, 6.2, '#3f72c4'], [-12, 9.6, '#2f8f55']] as [number, number, Colour][])) {
      parasol(b, x, z, { colors: [c, WHITE] });
      for (let i = 0; i < 3; i++) { b.cyl(x - 0.9 + i * 0.9, 0.16, z + 1, 0.4, 0.32, '#7a7a7e', { seg: 8, top: 1.25 }); b.ico(x - 0.9 + i * 0.9, 0.4, z + 1, 0.36, 0.22, 0.36, ['#c9423a', '#e8a13a', '#5f9a48'][i]!); }
      stool(b, x - 0.6, z - 0.2, { h: 0.4 });
    }
    extra(b, 'kano-sabon-trader-1', -8, 6.4, 0.2, 'sit', { seat: 0.4, look: WOMAN('orange') });
    extra(b, 'kano-sabon-trader-2', 7.4, 6, -0.2, 'sit', { seat: 0.4, look: WOMAN('blue') });
    extra(b, 'kano-sabon-stall-1', 3.2, -3, HALF, 'work', { look: MAN('cream') });
    extra(b, 'kano-sabon-shopper', -1, -2.4, PI, 'walk', { look: WOMAN('violet') });
    for (let i = 0; i < 6; i++) b.ball(12.4 + (i % 2) * 0.7, 0.3 + Math.floor(i / 2) * 0.4, 5.4, 0.36, 0.24, 0.5, i % 2 ? '#e9e4d6' : '#c9b88f', { seg: 5 });
    b.at(3.4, 0, 8.4, 0.5, () => { b.box(0, 0.6, 0, 0.9, 0.4, 1.3, '#3f72c4'); b.cyl(0, 0.3, 0.9, 0.3, 0.12, BLACK, { seg: 8, rz: HALF }); for (const s of [-1, 1]) b.box(s * 0.4, 0.7, -1, 0.06, 0.06, 0.9, METAL_DARK); b.ico(0, 0.9, 0, 0.36, 0.2, 0.5, '#8a5a34'); });
    tricycle(b, -3.4, 9.4, 2.4);
    neem(b, -13.4, 5.2, 1.1);
    lampPost(b, 2.8, 4.4, { light: true }); lampPost(b, -2.8, -8);
    return {
      spots: places([0, 0.6, PI], [2.2, -3, -HALF], [0.4, 7.6]),
      crowd: [[1.6, 6, 0.4], [-1.6, 7.6, -0.5], [5.4, 8.6, 2.4], [-4.6, 5.4, 1.2], [9.6, 9.8, -0.8], [-9.4, 9, 0.8], [1.4, 10.4, 2.8], [-5.2, 10.2, 2.4], [8.2, -2, PI], [-8.4, -5, 0], [0.2, 9, 3.1], [1.2, -7, 0.6]],
      spare: [[-1.4, 4.6], [1.6, 8.6], [-2, 9.4], [5.6, 10.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Stadium: a football pitch inside a running track, a covered main stand, open terraces, four floodlight towers.

/** Terraced seats: `n` rows rising away from the pitch (dir 1 or -1 along z, 2 or -2 along x), with seated spectators. */
function terrace(b: Batch, x: number, z: number, w: number, n: number, dir: 1 | -1 | 2 | -2, seats: [Colour, Colour], rand: () => number): void {
  const tread = 0.85, rise = 0.7, alongZ = Math.abs(dir) === 1, step = alongZ ? dir : dir / 2;
  for (let i = 0; i < n; i++) {
    const top = (i + 1) * rise, off = step * i * tread;
    if (alongZ) { b.box(x, top / 2, z + off, w, top, tread, '#c9c4b6'); b.box(x, top + 0.05, z + off, w - 0.4, 0.1, tread * 0.66, seats[i % 2]!); }
    else { b.box(x + off, top / 2, z, tread, top, w, '#c9c4b6'); b.box(x + off, top + 0.05, z, tread * 0.66, 0.1, w - 0.4, seats[i % 2]!); }
    for (let k = 0; k < Math.floor(w / 0.9); k++) {
      if (rand() < 0.6) continue;
      const along = -w / 2 + 0.45 + k * 0.9;
      b.ball(alongZ ? x + along : x + off, top + 0.42, alongZ ? z + off : z + along, 0.2, 0.3, 0.2, ['#f1efe8', '#2f8f55', '#e0a43a', '#2a4fa6', '#c9423a', '#4a3224', '#ece2c6'][Math.floor(rand() * 7)]!, { seg: 4 });
    }
  }
}
function floodTower(b: Batch, x: number, z: number, h: number, ry: number): void {
  b.cyl(x, h / 2, z, 0.24, h, METAL, { seg: 6, top: 0.55 }); b.box(x, 0.3, z, 1, 0.6, 1, '#8d887a');
  b.at(x, h + 0.5, z, ry, () => { b.box(0, 0, 0, 2.4, 1.5, 0.3, '#3d444b'); for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) b.quad(-0.9 + i * 0.6, -0.36 + j * 0.72, 0.17, 0.46, 0.5, '#fff3c4', GLOW); });
}

const stadium: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55', camera: TALL, walk: OPEN,
  build(b, context) {
    const rand = seeded(113), zc = -2.6, seats: [Colour, Colour] = ['#2f8f55', '#f1efe8'];
    ground(b, { w: 30, d: 26, color: '#b9ae95', edge: '#7f7765' });
    // The running track round the pitch, the pitch in mown stripes, goals at either end
    b.box(0, 0.05, zc, 23, 0.04, 13.8, '#b5654a');
    for (const dz of [-6.3, -5.6, 5.6, 6.3]) b.box(0, 0.08, zc + dz, 22.4, 0.02, 0.06, '#f4f1e6');
    for (let i = 0; i < 8; i++) b.box(-9.5 + (i + 0.5) * 2.375, 0.08, zc, 2.375, 0.03, 10, i % 2 ? '#58a24c' : '#4e9944');
    for (const dz of [-5, 5]) b.box(0, 0.1, zc + dz, 19, 0.02, 0.12, '#f4f1e6');
    for (const dx of [-9.5, 0, 9.5]) b.box(dx, 0.1, zc, 0.12, 0.02, 10, '#f4f1e6');
    b.disc(0, 0.1, zc, 1.6, '#f4f1e6', { seg: 18 }); b.disc(0, 0.105, zc, 1.46, '#54a048', { seg: 18 });
    for (const s of [-1, 1]) {
      b.box(s * 8, 0.1, zc, 0.1, 0.02, 5, '#f4f1e6'); b.box(s * 8.75, 0.1, zc - 2.5, 1.5, 0.02, 0.1, '#f4f1e6'); b.box(s * 8.75, 0.1, zc + 2.5, 1.5, 0.02, 0.1, '#f4f1e6');
      for (const dz of [-1.5, 1.5]) b.box(s * 9.6, 1.1, zc + dz, 0.1, 2.2, 0.1, WHITE);
      b.box(s * 9.6, 2.2, zc, 0.1, 0.1, 3.1, WHITE);
    }
    // The covered main stand along the far side: terraces under a cantilever roof, the ground's name on its fascia
    terrace(b, 0, -10.2, 25, 4, -1, seats, rand);
    b.box(0, 3.4, -13.4, 25.4, 6.8, 0.5, '#d9d2bf');
    for (let x = -12; x <= 12; x += 4.8) { b.box(x, 3.6, -13, 0.4, 7.2, 0.4, '#bdb6a5'); b.box(x, 6.2, -11.6, 0.16, 0.16, 3.4, METAL_DARK, { rx: -0.42 }); }
    b.box(0, 7.3, -11.4, 26, 0.24, 5.4, '#e9e4d6', { rx: 0.1 }); b.box(0, 7.1, -8.72, 26, 0.7, 0.14, '#2f6f4a');
    labelled(b, context.label, 0, 7.1, -8.62, 12, 0.36, '#f6efd8', '#2f6f4a', false);
    // An open terrace at the left end, a scoreboard at the right
    terrace(b, -12.4, zc, 11, 3, -2, seats, rand);
    for (const dz of [-1.2, 1.2]) b.box(-14.6, 2.6, zc + dz, 0.24, 5.2, 0.24, METAL_DARK);
    b.box(-14.6, 5.4, zc, 0.3, 1.7, 3.6, '#1a2230'); sign(b, -14.43, 5.4, zc, '0 - 0', { size: 0.6, color: '#ffe07a', lit: true, ry: HALF });
    floodTower(b, -13.6, -12.4, 12.4, 0.7); floodTower(b, 13.6, -12.4, 12.4, -0.7); floodTower(b, -13.8, 6, 12.4, 2.2); floodTower(b, 14.2, 10.4, 12.4, -2.4);
    for (const [x, z, ry, c, pose] of ([[-3, -3.4, 1.2, 'green', 'jog'], [2.6, -1.4, -1.6, 'cream', 'jog'], [5.6, -4.6, -1.2, 'green', 'stand'], [-6.4, -0.6, 1.4, 'cream', 'walk']] as [number, number, number, string, 'jog' | 'stand' | 'walk'][])) extra(b, `kano-stadium-player-${x}`, x, z, ry, pose, { look: { body: 'man', outfit: 'jersey', outfitColor: c } });
    b.ball(0.6, 0.3, -2.4, 0.2, 0.2, 0.2, '#f4f2ea', { seg: 6 });
    // The apron in front: a gate office, a rail along the track, benches
    b.box(-10.4, 1.5, 8.4, 3.4, 3, 2.6, '#e9dfc4'); b.box(-10.4, 3.1, 8.4, 3.8, 0.2, 3, '#2f6f4a'); b.box(-8.68, 1.7, 8.4, 0.06, 0.9, 1.4, '#2a3230');
    sign(b, -10.4, 2.5, 9.72, 'GATE', { size: 0.3, color: '#f6efd8', board: '#2f6f4a', pad: 0.14 });
    extra(b, 'kano-stadium-steward', -7.8, 7.6, HALF, 'stand', { look: MAN('green') });
    fence(b, [-9, 4.6], [-2.4, 4.6], { h: 1, color: METAL, gap: 1.6 }); fence(b, [2.4, 4.6], [5, 4.6], { h: 1, color: METAL, gap: 1.3 }); fence(b, [10.6, 4.6], [13.4, 4.6], { h: 1, color: METAL, gap: 1.4 });
    bench(b, 11.6, 9.4, { w: 2.8, ry: -HALF, back: true, color: '#6a6e72', leg: METAL_DARK });
    flag(b, -13.2, 11, { h: 5.4 });
    extra(b, 'kano-stadium-fan', 3.8, 6.2, PI, 'stand', { look: MAN('cream') });
    lampPost(b, 5.6, 9.6, { light: true });
    return {
      spots: places([0, 6, PI], [-6.4, 7.8, -HALF], [0.6, 8.6]),
      crowd: [[2.4, 8.4, 0.4], [-2.4, 8, -0.5], [5.6, 11, 2.4], [-4.6, 9.4, 1.2], [8.6, 10.6, -0.8], [-5.4, 11, 0.8], [3, 10.6, 2.8], [-2, 10.8, 2.4], [0.4, 2.8, PI], [12, 7.4, -0.4], [0.2, 9.8, 3.1], [-1.6, 6.4, 0.6]],
      spare: [[-3.6, 6.6], [3.4, 8.6], [-1, 10], [1.4, 7]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Racecourse: an oval of turf between white rails, a small stand, a paddock and a winning post.

function ringRail(b: Batch, cx: number, cz: number, rx: number, rz: number, n: number, skip: (x: number, z: number) => boolean): void {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * PI * 2, a1 = ((i + 1) / n) * PI * 2, x0 = cx + Math.sin(a0) * rx, z0 = cz + Math.cos(a0) * rz, x1 = cx + Math.sin(a1) * rx, z1 = cz + Math.cos(a1) * rz;
    if (skip(x0, z0) || skip(x1, z1)) continue;
    b.box(x0, 0.5, z0, 0.1, 1, 0.1, WHITE);
    b.box((x0 + x1) / 2, 1, (z0 + z1) / 2, 0.1, 0.1, Math.hypot(x1 - x0, z1 - z0) + 0.1, WHITE, { ry: Math.atan2(x1 - x0, z1 - z0) });
  }
}

const racecourse: SceneDef = {
  mood: 'outdoor', accent: '#c9423a', camera: LOW, walk: OPEN,
  build(b, context) {
    const cx = 2, cz = -3.6, crossing = (x: number, z: number): boolean => z > 0 && Math.abs(x - 1) < 2.6;
    ground(b, { w: 30, d: 26, color: '#b3ab72', edge: '#7d7a4c' });
    // The course: a broad oval of sandy turf round a drier infield, a white rail on either side of it
    b.disc(cx, 0.045, cz, 12, '#cdb480', { seg: 30, sz: 0.66 });
    b.disc(cx, 0.055, cz, 9, '#a3a862', { seg: 26, sz: 0.56 });
    for (let i = 0; i < 6; i++) b.disc(cx - 5 + i * 2, 0.06, cz + (i % 2 ? 1.4 : -1.2), 1.2, '#b6b06e', { seg: 8, sz: 0.5 });
    ringRail(b, cx, cz, 12, 7.9, 34, crossing); ringRail(b, cx, cz, 9, 5.04, 28, crossing);
    // The winning post and a number board on the infield
    b.cyl(5, 1.8, 0.7, 0.07, 3.6, WHITE, { seg: 5 }); b.cyl(5, 3.4, 0.7, 0.42, 0.08, '#c9423a', { seg: 12, rx: HALF }); b.cyl(5, 3.4, 0.75, 0.24, 0.08, WHITE, { seg: 10, rx: HALF });
    b.box(-2, 1, -3.4, 0.14, 2, 0.14, METAL_DARK); b.box(-2, 2.5, -3.4, 2.2, 1.3, 0.14, '#22313f'); for (let i = 0; i < 3; i++) b.quad(-2.7 + i * 0.7, 2.5, -3.32, 0.5, 0.8, '#f1efe8');
    // Two horses out on the far side, a small covered stand at the left
    horse(b, -1, -10.4, HALF, '#5a3a26', '#2a4fa6'); horse(b, 3.4, -10.9, HALF, '#8a6a4a', '#c9423a');
    b.at(-13, 0, -3.4, HALF, () => {
      for (let i = 0; i < 3; i++) { b.box(0, (i + 1) * 0.35, -i * 0.9, 8.4, (i + 1) * 0.7, 0.9, '#c9c4b6'); b.box(0, (i + 1) * 0.7 + 0.05, -i * 0.9, 8, 0.1, 0.6, i % 2 ? '#2f6f4a' : '#e9e4d6'); }
      for (const s of [-1, 1]) for (const dz of [0.6, -2.4]) b.box(s * 4.1, 2.3, dz, 0.16, 4.6, 0.16, WHITE);
      b.box(0, 4.7, -0.9, 9, 0.12, 4, '#9b5a3a', { rx: 0.12 }); b.box(0, 4.3, 1.06, 9, 0.5, 0.1, '#e9e4d6');
    });
    extra(b, 'kano-race-watcher-1', -12.6, -5, HALF, 'sit', { seat: 0.6, y: 0.75, look: MAN('cream') });
    extra(b, 'kano-race-watcher-2', -12.6, -1.6, HALF, 'sit', { seat: 0.6, y: 0.75, look: MAN('blue') });
    // The paddock at the front right: a ring of rail with a horse and its groom; the course's name by the way in
    ringRail(b, 9.4, 8, 3, 2.6, 14, (x, z) => z < 6.2 && Math.abs(x - 8.4) < 1.2);
    horse(b, 9.8, 8.2, -1, '#3a2a20', '#d6a83a');
    extra(b, 'kano-race-groom', 8.2, 8.6, 1.2, 'stand', { look: MAN('green') });
    b.cyl(12.2, 0.3, 4.6, 0.5, 0.6, '#7a7a7e', { seg: 9 }); b.disc(12.2, 0.61, 4.6, 0.44, '#6f9fb4', { seg: 9 });
    extra(b, 'kano-race-steward', 4, 4.4, PI, 'stand', { look: MAN('teal') });
    stele(b, context.label, -8.4, 7.8, 0.3, 4.4);
    neem(b, -12.6, 9.6, 1.2); palm(b, 13.4, -12, { s: 1.2 }); palm(b, -13.6, -11.6, { s: 1.1, ry: 2 });
    lampPost(b, -3.4, 5.6, { light: true });
    return {
      spots: places([0.6, 5.4, PI], [5.6, 6.4, HALF], [-1.6, 8.4]),
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [4.4, 10, 2.4], [-5.4, 5.6, 1.2], [5.6, 11.4, -0.8], [-10.4, 10.6, 0.8], [1, 10.6, 2.8], [-5.2, 10.4, 2.4], [-11.6, 5.4, 1.6], [13, 11.4, -0.4], [0.2, 9.2, 3.1], [1, -3.4, 0.6]],
      spare: [[-3.4, 9], [2.6, 9], [-1, 10.6], [-6.4, 10.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Polo ground: a mown field with goal posts and sideboards, a clubhouse with a deep veranda, a line of tethered horses.

const polo: SceneDef = {
  mood: 'outdoor', accent: '#2a4fa6', camera: LOW, walk: OPEN,
  build(b, context) {
    const fx = 2.4, fz = -6.4;
    ground(b, { w: 30, d: 26, color: '#b8ac7c', edge: '#7f7650' });
    // The field in mown stripes inside low white boards; a pair of slim banded posts at either end
    for (let i = 0; i < 10; i++) b.box(fx - 10.35 + i * 2.3, 0.05, fz, 2.3, 0.04, 11, i % 2 ? '#7fa052' : '#8aab5a');
    for (const dz of [-5.5, 5.5]) b.box(fx, 0.16, fz + dz, 23, 0.24, 0.12, WHITE);
    b.box(fx, 0.08, fz, 0.1, 0.02, 11, '#f4f1e6');
    for (const s of [-1, 1]) for (const dz of [-1.4, 1.4]) for (let k = 0; k < 4; k++) b.cyl(fx + s * 11.2, 0.45 + k * 0.9, fz + dz, 0.09, 0.9, k % 2 ? WHITE : '#c9423a', { seg: 6 });
    horse(b, 0, -7.4, 1.2, '#5a3a26', '#2a4fa6'); horse(b, 5.6, -5, -1.9, '#8a6a4a', '#f1efe8'); horse(b, 8.8, -8.8, -1.2, '#3a2a20', '#2a4fa6');
    b.ball(3.2, 0.2, -6, 0.13, 0.13, 0.13, WHITE, { seg: 5 });
    // The clubhouse down the left: plain walls under a tin roof, a deep veranda with chairs looking over the field
    b.at(-12.4, 0, -3.4, HALF, () => {
      b.box(0, 1.9, -1.2, 11, 3.8, 3.4, '#e6d8b4'); b.box(0, 0.5, -1.2, 11.1, 1, 3.5, '#c79f6b');
      for (const s of [-1, 1]) b.box(0, 4.3, -1.2 + s * 1.1, 11.8, 0.14, 2.5, s < 0 ? '#8a4e34' : '#9b5a3a', { rx: s * 0.3 });
      b.box(0, 4.66, -1.2, 11.8, 0.14, 0.3, '#7a4530');
      b.box(0, 0.14, 1.8, 11, 0.28, 2.8, '#cfc3a0'); b.box(0, 3.5, 1.9, 11.6, 0.14, 3.2, '#9b5a3a', { rx: 0.1 });
      for (let i = 0; i < 5; i++) b.box(-5.2 + i * 2.6, 1.8, 3.1, 0.18, 3.4, 0.18, WHITE);
      for (const x of [-3.6, 3.6]) windowPane(b, x, 2.2, 0.52, { w: 1.4, h: 1.4, glass: '#7f9fb4', frame: '#4f6a5c' });
      b.box(0, 1.5, 0.52, 1.5, 2.7, 0.08, '#4a3626');
      for (const x of [-3.9, -1.3, 1.3, 3.9]) chair(b, x, 2, { color: '#4f6a5c' });
      labelled(b, context.label, 0, 3.86, 3.48, 9, 0.34, '#f6efd8', '#2a3f66', false);
    });
    extra(b, 'kano-polo-member-1', -10.4, -4.7, HALF, 'sit', { seat: 0.6, y: 0.28, look: MAN('cream', { outfit: 'agbada' }) });
    extra(b, 'kano-polo-member-2', -10.4, -2.1, HALF, 'sit', { seat: 0.6, y: 0.28, look: MAN('blue') });
    // The horse line at the front right: a tethering rail, two ponies, a groom, a rack of mallets, a trough
    fence(b, [7, 5.6], [13, 5.6], { h: 1.1, color: WOOD, gap: 2 });
    horse(b, 8.6, 7, PI, '#6a4a34', '#c9423a'); horse(b, 11.6, 7, PI, '#4a3626', '#2a4fa6');
    extra(b, 'kano-polo-groom', 10.2, 8.6, PI, 'stand', { look: MAN('green') });
    b.box(5.4, 0.9, 9.8, 1.8, 0.08, 0.08, WOOD_DARK); for (const s of [-1, 1]) b.box(5.4 + s * 0.9, 0.5, 9.8, 0.1, 1, 0.3, WOOD_DARK);
    for (let i = 0; i < 5; i++) { b.cyl(4.7 + i * 0.35, 1.1, 9.9, 0.03, 2.1, '#c9a56a', { seg: 4, rx: 0.12 }); b.box(4.7 + i * 0.35, 0.12, 10.04, 0.1, 0.1, 0.34, WOOD_LIGHT); }
    b.box(13, 0.3, 9.4, 0.9, 0.6, 2, '#7a7a7e'); b.box(13, 0.58, 9.4, 0.7, 0.06, 1.8, '#6f9fb4');
    // An exercise corner by the clubhouse: mats, cones, a bar
    for (let i = 0; i < 3; i++) rug(b, -7.6 + i * 1.5, 6.4, 1.1, 2.4, ['#3f72c4', '#2f9d98', '#e0822f'][i]!);
    for (let i = 0; i < 4; i++) b.cone(-8.4 + i * 1.3, 0.2, 9, 0.16, 0.4, '#e0822f', { seg: 6 });
    for (const s of [-1, 1]) b.cyl(-11.6 + s * 0.9, 1.2, 8.4, 0.06, 2.4, METAL_DARK, { seg: 5 }); b.box(-11.6, 2.36, 8.4, 2, 0.06, 0.06, METAL);
    extra(b, 'kano-polo-trainer', -5.6, 4.4, 0.3, 'wave', { look: { body: 'man', outfit: 'jersey', outfitColor: 'blue' } });
    palm(b, 13.6, 0.4, { s: 1.1 }); palm(b, -13.6, 11, { s: 1.1, ry: 2 });
    lampPost(b, -2.4, 3.4, { light: true });
    return {
      spots: places([2.4, 1.4, PI], [-6.4, 4.4, HALF], [0.6, 6.4]),
      crowd: [[4.4, 3.4, 0.4], [-2.4, 7.6, -0.5], [6.2, 2.6, 2.4], [-0.4, 2.6, PI], [3.4, 8, -0.8], [-3.6, 10, 0.8], [5, 11.4, 2.8], [-5.2, 10.8, 2.4], [-10, 10.6, 1.6], [8.6, 11, -0.4], [0.2, 8.6, 3.1], [8.6, 0.6, PI]],
      spare: [[-2, 5.4], [3.4, 5.6], [-1, 8.6], [4.4, 9.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Railway station: a brick building of the colonial era with a clock in its gable, a narrow-gauge line and platform
// beside it, and a forecourt where outings gather.

const BRICK = '#a5553a', BRICK_DARK = '#8a4630', STONE = '#e3d6b8';
const railway: SceneDef = {
  mood: 'outdoor', accent: '#a5553a', camera: TALL,
  walk: { bounds: [-9.4, -6.6, 14.2, 12.2], entrance: [3, 11.4], open: true },
  build(b, context) {
    ground(b, { w: 30, d: 26, color: '#d2c3a0', edge: '#93876a' });
    b.box(3, 0.05, 4, 13, 0.03, 15, '#dccfb0');
    // The line down the left: ballast, close-set sleepers, two rails a narrow gauge apart, a buffer stop, one stabled wagon
    b.box(-12.6, 0.06, 0, 3.6, 0.1, 26, '#7d776b');
    for (let z = -12.6; z < 12.8; z += 0.8) b.box(-12.6, 0.14, z, 2.2, 0.06, 0.3, '#5f4630');
    for (const s of [-1, 1]) b.box(-12.6 + s * 0.55, 0.2, 0, 0.1, 0.08, 26, '#9aa0a6');
    b.box(-12.6, 0.7, 11.6, 2, 0.3, 0.3, '#c9423a'); for (const s of [-1, 1]) b.box(-12.6 + s * 0.7, 0.4, 11.9, 0.16, 0.8, 0.9, METAL_DARK, { rx: -0.5 });
    b.box(-12.6, 1.8, -8.6, 2.1, 2.4, 6.4, '#7a4a35'); b.box(-12.6, 0.52, -8.6, 1.9, 0.2, 6.2, METAL_DARK); b.box(-12.6, 3.06, -8.6, 2.2, 0.14, 6.6, '#5f5a52');
    for (const dz of [-2.2, 2.2]) for (const s of [-1, 1]) b.cyl(-12.6 + s * 0.55, 0.42, -8.6 + dz, 0.26, 0.14, BLACK, { seg: 8, rz: HALF });
    b.box(-11.52, 1.8, -8.6, 0.06, 1.8, 1.8, '#5f3a28');
    // The platform: low, stone-edged, under an iron canopy on posts
    b.box(-9.2, 0.14, -1, 2.8, 0.28, 22, '#bdb6a5'); b.box(-10.5, 0.3, -1, 0.24, 0.04, 22, '#f1efe8');
    for (const z of [-9, -4.5, 0, 4.5]) { b.cyl(-9.2, 1.9, z, 0.1, 3.4, '#2f4a45', { seg: 6 }); b.box(-9.2, 3.5, z, 2.6, 0.1, 0.1, '#2f4a45'); }
    b.box(-9.4, 3.66, -2.2, 3.2, 0.1, 15.4, '#6f7a72', { rz: 0.08 });
    bench(b, -8.6, 2.2, { w: 2.6, ry: -HALF, back: true, color: '#2f4a45', leg: METAL_DARK });
    // The station: long brick wings under a tin roof, a veranda on posts, a taller middle bay with a clock in its gable
    b.box(2.4, 2.2, -10.2, 18, 4.4, 4.6, BRICK); b.box(2.4, 0.4, -10.2, 18.2, 0.8, 4.8, BRICK_DARK);
    for (const y of [1.6, 3.2]) b.box(2.4, y, -7.88, 18, 0.12, 0.04, STONE);
    b.at(2.4, 0, -10.2, 0, () => gable(b, 0, 4.4, 0, 18, 4.6, 2, 0.34));
    for (const x of [-5, -2.4, 7.2, 9.8]) { b.box(x, 2.2, -7.87, 1, 1.8, 0.06, '#33475a'); b.cyl(x, 3.1, -7.87, 0.5, 0.06, '#33475a', { seg: 10, rx: HALF }); b.box(x, 1.24, -7.84, 1.3, 0.12, 0.12, STONE); }
    for (let x = -6.2; x <= 11; x += 2.86) b.cyl(x, 1.6, -6.2, 0.1, 3.2, '#2f4a45', { seg: 6 });
    b.box(2.4, 3.3, -6.9, 18.4, 0.1, 2, '#7d776b', { rx: 0.12 });
    b.box(2.4, 3.9, -8.6, 5, 7.8, 2.2, BRICK); b.box(2.4, 0.4, -8.6, 5.2, 0.8, 2.4, BRICK_DARK);
    for (const s of [-1, 1]) { b.box(2.4 + s * 2.4, 3.9, -7.48, 0.4, 7.8, 0.1, STONE); b.box(2.4 + s * 1.4, 8.72, -8.6, 3.5, 0.2, 2.6, '#7a4530', { rz: -s * 0.62 }); }
    b.box(2.4, 8.3, -8.6, 3.6, 1.4, 2.1, BRICK);
    b.cyl(2.4, 6.5, -7.46, 0.95, 0.1, STONE, { seg: 16, rx: HALF }); b.cyl(2.4, 6.5, -7.42, 0.8, 0.08, '#f6f2e6', { seg: 16, rx: HALF });
    b.box(2.4, 6.78, -7.36, 0.07, 0.56, 0.03, BLACK); b.box(2.62, 6.5, -7.36, 0.44, 0.07, 0.03, BLACK);
    b.box(2.4, 1.5, -7.46, 1.8, 3, 0.1, '#33475a'); b.cyl(2.4, 3, -7.46, 0.9, 0.1, '#33475a', { seg: 12, rx: HALF });
    labelled(b, context.label, 2.4, 4.9, -7.44, 4.2, 0.34, '#f6efd8', '#2f4a45', false);
    // The forecourt: a plain notice board for outings, a taxi rank of yellow tricycles, luggage, shade
    signBoard(b, 9.2, 3.2, 'OUTINGS', { y: 2.3, size: 0.34, board: '#2f4a45', color: '#f6efd8' });
    for (let i = 0; i < 3; i++) b.quad(8.4 + i * 0.8, 1.5, 3.14, 0.6, 0.7, ['#f1efe8', '#f2e2a6', '#e9e4d6'][i]!);
    b.box(9.2, 1.5, 3.1, 2.7, 0.9, 0.06, '#4a3626');
    extra(b, 'kano-rail-host', 6.4, 4.4, PI + 0.4, 'wave', { look: MAN('teal') });
    extra(b, 'kano-rail-clerk', 0.4, -5.4, PI, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy' } });
    extra(b, 'kano-rail-traveller-1', -8.6, 2.2, -HALF, 'sit', { seat: 0.6, y: 0.28, look: MAN('cream') });
    extra(b, 'kano-rail-traveller-2', 4.6, 0.4, PI, 'stand', { look: WOMAN('orange', { accessories: ['headwrap', 'handbag'] }) });
    tricycle(b, 12.4, 2.4, -HALF); tricycle(b, 12.4, 5.2, -HALF);
    for (const [x, z, c] of ([[5.6, 0.6, '#2f4a66'], [6.2, 0.9, '#a14b3c'], [-0.6, 2.4, '#3f6a4a']] as [number, number, Colour][])) b.box(x, 0.4, z, 0.5, 0.8, 0.8, c);
    palm(b, 13.6, -3.6, { s: 1.2, ry: 1 }); neem(b, -5.4, 7.6, 1.1, 2);
    bench(b, -5.4, 9.6, { w: 2.6, color: '#8a6644' });
    flag(b, -1.6, -5.4, { h: 6 });
    lampPost(b, 1.4, 6.4, { light: true }); lampPost(b, 9.4, -4.4);
    return {
      spots: places([7, 5.8, PI], [2.4, -5.2, PI], [3.6, 8.4]),
      crowd: [[5.6, 8.4, 0.4], [1.4, 7.6, -0.5], [9.6, 9, 2.4], [-1.6, 5.4, 1.2], [8.6, 10.8, -0.8], [-2.4, 10.6, 0.8], [5, 10.6, 2.8], [0.2, 10.2, 2.4], [-8.8, -2.6, HALF], [10.4, 6.6, -0.4], [3.2, 9.4, 3.1], [3.6, 2.6, 0.6]],
      spare: [[1, 8.6], [6, 9.6], [9.4, 7.4], [-1, 9]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Motor park: buses loading in bays, a rank of yellow tricycles, a waiting shed and a ticket office.

function bus(b: Batch, x: number, z: number, ry: number, stripe: Colour, loaded = false): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 1.3, 0, 2, 2, 4.6, '#eceae2'); b.box(0, 0.8, 0, 2.04, 0.3, 4.64, stripe); b.box(0, 1.8, 0.1, 2.06, 0.6, 4, '#5f7b8c');
    b.box(0, 2.34, 0, 1.8, 0.1, 4.2, '#c9c4b4');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.96, 0.36, sz * 1.5, 0.36, 0.26, BLACK, { seg: 7, rz: HALF });
    for (const sx of [-1, 1]) b.box(sx * 0.66, 0.9, 2.32, 0.34, 0.16, 0.04, WARM, GLOW);
    if (loaded) for (let i = 0; i < 4; i++) b.box((i % 2 ? 0.4 : -0.4), 2.6, -1.2 + i * 0.8, 0.9, 0.44, 0.7, ['#c9b88f', '#2f4a66', '#a14b3c', '#e9e4d6'][i]!);
  });
}

const motorPark: SceneDef = {
  mood: 'outdoor', accent: '#e8b820', camera: LOW, walk: OPEN,
  build(b, context) {
    ground(b, { w: 30, d: 26, color: '#807e7a', edge: '#4f4d4a' });
    for (let i = 0; i <= 5; i++) b.box(-13.4 + i * 3, 0.05, -8.4, 0.12, 0.02, 5.6, '#e6dfc8');
    for (let i = 0; i <= 6; i++) b.box(13.6, 0.05, -10.6 + i * 2.2, 3.2, 0.02, 0.12, '#e6dfc8');
    // Buses nose-out in their bays along the back, one with a loaded roof rack
    ([[-11.9, '#2f8f55', false], [-8.9, '#3f72c4', true], [-5.9, '#2f8f55', false], [-2.9, '#c9423a', false]] as [number, Colour, boolean][]).forEach(([x, c, loaded]) => bus(b, x, -8.6, 0, c, loaded));
    // The rank of yellow tricycles down the right
    for (let i = 0; i < 5; i++) tricycle(b, 13.2, -9.5 + i * 2.2, -HALF);
    // The waiting shed: a tin roof on posts over benches; the ticket office beside it carries the park's name
    for (const [x, z] of ([[1.6, -10.4], [8.4, -10.4], [1.6, -6.6], [8.4, -6.6]] as [number, number][])) b.box(x, 1.6, z, 0.16, 3.2, 0.16, METAL_DARK);
    b.box(5, 3.4, -8.5, 7.8, 0.12, 4.8, '#9b5a3a', { rx: 0.08 }); for (let i = 0; i < 8; i++) b.box(1.5 + i, 3.48, -8.5, 0.06, 0.06, 4.8, '#7a4530', { rx: 0.08 });
    for (const z of [-9.6, -7.6]) bench(b, 5, z, { w: 5.2, color: '#6a6e72', leg: METAL_DARK });
    extra(b, 'kano-park-waiting-1', 3.6, -7.6, 0, 'sit', { seat: 0.6, look: WOMAN('teal') });
    extra(b, 'kano-park-waiting-2', 6.2, -9.6, 0, 'sit', { seat: 0.6, look: MAN('cream') });
    b.box(-10.2, 1.6, 4.6, 4.4, 3.2, 3.2, '#e9dfc4'); b.box(-10.2, 0.5, 4.6, 4.5, 1, 3.3, '#2f6f4a'); b.box(-10.2, 3.3, 4.6, 5, 0.2, 3.8, '#566e5e');
    b.box(-7.96, 1.9, 4.6, 0.06, 1, 1.6, '#2a3230'); b.box(-7.7, 1.34, 4.6, 0.5, 0.08, 1.9, WOOD_LIGHT);
    labelled(b, context.label, -10.2, 3.9, 6.24, 4.4, 0.3, '#f6efd8', '#2f6f4a', false);
    extra(b, 'kano-park-clerk', -6.6, 5.2, -HALF, 'stand', { look: MAN('green') });
    // Luggage, a tyre stack, a food seller under a parasol, shade
    for (let i = 0; i < 5; i++) b.ball(-0.6 + (i % 3) * 0.7, 0.3 + Math.floor(i / 3) * 0.4, -3.4, 0.36, 0.24, 0.5, i % 2 ? '#e9e4d6' : '#c9b88f', { seg: 5 });
    for (let i = 0; i < 3; i++) b.cyl(9.6, 0.16 + i * 0.3, 2.4, 0.5, 0.28, BLACK, { seg: 10 });
    parasol(b, 8.6, 7.6, { colors: ['#e8b820', WHITE] }); table(b, 8.6, 8.4, { w: 1.8, d: 0.9, h: 0.85 });
    for (let i = 0; i < 3; i++) b.cyl(8 + i * 0.6, 1.02, 8.4, 0.2, 0.3, ['#3a3d42', '#8b9096', '#3a3d42'][i]!, { seg: 7 });
    extra(b, 'kano-park-food', 8.6, 7.2, 0, 'work', { look: WOMAN('orange') });
    extra(b, 'kano-park-driver', -4.4, -4.6, 0.4, 'stand', { look: MAN('blue') });
    neem(b, -13.2, -1.4, 1.2); neem(b, -12.8, 10.6, 1.1, 1);
    lampPost(b, 0.6, 5.6, { light: true }); lampPost(b, -6.4, -4.6);
    return {
      spots: places([-1.4, 0.4, PI], [-5.4, 4.2, -HALF], [0.6, 7.6]),
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [5.6, 4.6, 2.4], [-3.4, 1.6, 1.2], [5, 10.4, -0.8], [-5.4, 9.4, 0.8], [3, 10.4, 2.8], [-3.2, 10.4, 2.4], [2.6, -3.4, 0], [10.4, -1.6, HALF], [0.2, 9, 3.1], [3.4, 1.6, 0.6]],
      spare: spareFront(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Old campus: low teaching blocks of an earlier time, long verandas, louvred windows, deep neem shade.

/** A single-storey teaching block facing +z: a veranda on posts along its front, doors and louvred windows behind it, a rust tin roof. */
function oldBlock(b: Batch, w: number, tone: number, wall: Colour = '#e6d6aa'): void {
  b.box(0, 1.8, -1, w, 3.6, 4, wall); b.box(0, 0.5, -1, w + 0.1, 1, 4.1, '#c79f6b');
  gable(b, 0, 3.6, -0.4, w, 5.6, tone, 0.3);
  b.box(0, 0.12, 1.9, w, 0.24, 1.8, '#cfc3a0');
  const bays = Math.round(w / 2.6);
  for (let i = 0; i <= bays; i++) b.box(-w / 2 + 0.2 + i * ((w - 0.4) / bays), 1.7, 2.6, 0.2, 3.2, 0.2, '#f1ead6');
  for (let i = 0; i < bays; i++) {
    const x = -w / 2 + (i + 0.5) * (w / bays);
    if (i % 3 === 1) b.box(x, 1.3, 1.03, 1.1, 2.4, 0.06, '#3f6a55');
    else { b.box(x, 2.1, 1.03, 1.5, 1.3, 0.06, '#f1ead6'); for (let k = 0; k < 4; k++) b.box(x, 1.66 + k * 0.3, 1.06, 1.3, 0.14, 0.04, '#6f8a8c'); }
  }
}
function bike(b: Batch, x: number, z: number, ry: number, colour: Colour): void {
  b.at(x, 0, z, ry, () => {
    for (const sz of [-0.55, 0.55]) b.cyl(0, 0.36, sz, 0.36, 0.06, BLACK, { seg: 9, rz: HALF });
    b.box(0, 0.62, 0, 0.06, 0.06, 1, colour); b.box(0, 0.8, -0.2, 0.06, 0.4, 0.06, colour); b.box(0, 1, -0.24, 0.16, 0.06, 0.3, BLACK); b.box(0, 0.86, 0.5, 0.06, 0.56, 0.06, colour); b.box(0, 1.12, 0.5, 0.56, 0.05, 0.05, METAL_DARK);
  });
}

const oldCampus: SceneDef = {
  mood: 'outdoor', accent: '#3f6a55', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(127);
    dust(b, rand, '#d2c08f', '#9a8a5e');
    for (let i = 0; i < 7; i++) b.disc(-12 + rand() * 24, 0.05, -4 + rand() * 14, 1.6 + rand() * 1.6, '#b3b070', { seg: 9, sz: 0.6 });
    b.box(0, 0.06, 3.6, 2.4, 0.03, 17, '#e3d6b0'); b.box(-1, 0.06, -4.4, 22, 0.03, 2, '#e3d6b0');
    // Three low blocks round the court: one across the back, one down the left, a small hall at the right
    b.at(-4, 0, -9.8, 0, () => oldBlock(b, 16, 0));
    b.at(-12.2, 0, 2.6, HALF, () => oldBlock(b, 10.6, 2, '#e0cfa0'));
    b.at(9.8, 0, -9.8, 0, () => oldBlock(b, 7.4, 1, '#e9dcb4'));
    // An old water tank on a steel stand behind the hall
    for (const [dx, dz] of ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][])) b.box(13.4 + dx, 3.2, -4 + dz, 0.14, 6.4, 0.14, METAL_DARK);
    b.box(13.4, 3.2, -4, 2.2, 0.1, 2.2, METAL_DARK); b.cyl(13.4, 7.4, -4, 1.5, 2, '#8f9aa3', { seg: 12 }); b.cone(13.4, 8.7, -4, 1.6, 0.6, '#6f7a83', { seg: 12 });
    // Neem trees with whitewashed trunks, a ring seat under the largest, students reading in the shade
    for (const [x, z, s, t] of ([[4.6, 1.4, 1.3, 0], [-6.4, 1.6, 1.25, 1], [12.6, 1.6, 1.1, 2], [-11.6, 10.6, 1, 0]] as [number, number, number, number][])) { neem(b, x, z, s, t); b.cyl(x, 0.6, z, 0.3 * s, 1.2, '#f1ead6', { seg: 6 }); }
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; b.box(4.6 + Math.sin(a) * 1.5, 0.3, 1.4 + Math.cos(a) * 1.5, 1.1, 0.6, 0.5, '#d8cfb8', { ry: a }); }
    extra(b, 'kano-old-student-1', 4.6, 2.9, 0, 'sit', { seat: 0.6, look: MAN('blue', { accessories: ['fila', 'glasses'] }) });
    extra(b, 'kano-old-student-2', 6.1, 1.4, HALF, 'sit', { seat: 0.6, look: WOMAN('green') });
    extra(b, 'kano-old-lecturer', -2.4, -6.4, 0.2, 'wave', { look: MAN('cream', { outfit: 'agbada' }) });
    extra(b, 'kano-old-student-3', -8.4, -1.4, 1.2, 'walk', { look: WOMAN('violet', { accessories: ['headwrap', 'backpack'] }) });
    // A notice board, bicycles in a rack, a bench, the campus name on a low slab by the path
    b.at(2.6, 0, -5.4, 0, () => { for (const s of [-1, 1]) b.box(s * 1.2, 1, 0, 0.1, 2, 0.1, WOOD_DARK); b.box(0, 1.5, 0, 2.6, 1.2, 0.08, '#3f6a55'); for (let i = 0; i < 4; i++) b.quad(-0.9 + i * 0.6, 1.5, 0.05, 0.44, 0.6, ['#f1efe8', '#f2e2a6', '#e9e4d6', '#f1efe8'][i]!); });
    b.box(-8.6, 0.5, 6.8, 3.4, 0.06, 0.06, METAL_DARK); for (const s of [-1, 1]) b.box(-8.6 + s * 1.7, 0.25, 6.8, 0.08, 0.5, 0.4, METAL_DARK);
    bike(b, -9.6, 6.9, 0.1, '#2a4fa6'); bike(b, -8.6, 6.9, -0.1, '#c9423a'); bike(b, -7.6, 6.9, 0.05, '#2f2a24');
    bench(b, 11.6, 3.4, { w: 2.6, ry: -HALF, color: '#8a6644' });
    stele(b, context.label, 5.4, 7, -0.25, 5.6);
    lampPost(b, -2.2, 5.6, { light: true });
    return {
      spots: places([-1.4, -1.6, PI], [-4, -6.2, PI], [-0.6, 7.6]),
      crowd: [[1.6, 5.4, 0.4], [-2.4, 7.6, -0.5], [1.6, 9.6, 2.4], [-6.6, 5, 1.2], [2.4, 11.4, -0.8], [-8.4, 10, 0.8], [0.4, 3.4, 2.8], [-1.6, 10.6, 2.4], [8.4, -2.4, 1.6], [11.4, 8.4, -0.4], [0.2, 9, 3.1], [1.4, -2.6, 0.6]],
      spare: [[-2, 4.6], [0.6, 6.6], [-3, 9.4], [1.4, 8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// New campus: large modern faculty buildings with bands of glass and sun fins, round a paved plaza.

/** A modern block facing +z: pale storeys, a dark band of glass on each floor behind upright sun fins, a flat roof. */
function facultyBlock(b: Batch, w: number, d: number, floors: number, band: Colour): void {
  const fh = 3.2, h = floors * fh;
  b.box(0, h / 2, 0, w, h, d, '#ebe8df');
  b.box(0, h + 0.2, 0, w + 0.6, 0.4, d + 0.6, '#cfcabd');
  for (let f = 0; f < floors; f++) {
    b.box(0, f * fh + 1.9, d / 2 + 0.02, w - 0.8, 1.5, 0.06, '#4f6f86'); b.box(0, f * fh + 0.56, d / 2 + 0.04, w - 0.4, 0.5, 0.1, band);
    b.box(w / 2 + 0.02, f * fh + 1.9, 0, 0.06, 1.5, d - 0.8, '#4f6f86');
  }
  for (let i = 0; i <= Math.round(w / 1.4); i++) b.box(-w / 2 + 0.4 + i * ((w - 0.8) / Math.round(w / 1.4)), h / 2 + 0.4, d / 2 + 0.3, 0.12, h - 1, 0.5, '#f6f4ee');
}

const newCampus: SceneDef = {
  mood: 'outdoor', accent: '#2f9d98', camera: TALL, walk: OPEN,
  build(b, context) {
    ground(b, { w: 30, d: 26, color: '#d5d0c4', edge: '#8f8a7e' });
    for (let x = -12; x <= 12; x += 3) b.box(x, 0.05, 2.6, 0.06, 0.02, 18, '#bfb9aa');
    for (let z = -6; z <= 11; z += 3) b.box(0, 0.05, z, 28, 0.02, 0.06, '#bfb9aa');
    for (const [x, z, w, d] of ([[-9.4, 4, 5, 4.4], [9.6, 1.6, 4.6, 3.6], [-9.4, 9.6, 5, 2.4]] as [number, number, number, number][])) { b.box(x, 0.1, z, w, 0.16, d, '#8fae62'); b.box(x, 0.06, z, w + 0.4, 0.1, d + 0.4, '#bfb9aa'); }
    // The main faculty building across the back, four storeys, with a glazed entrance hall under a canopy
    b.at(-4.4, 0, -10, 0, () => facultyBlock(b, 17.6, 5.6, 4, '#2f9d98'));
    b.box(-4.4, 3, -6.4, 5.6, 6, 2, '#6f8fa6'); for (let i = 0; i < 5; i++) b.box(-6.9 + i * 1.25, 3, -5.38, 0.1, 6, 0.06, '#f6f4ee'); for (const y of [2, 4]) b.box(-4.4, y, -5.38, 5.6, 0.1, 0.06, '#f6f4ee');
    b.box(-4.4, 6.15, -5.4, 7.4, 0.3, 4.4, '#f6f4ee'); for (const s of [-1, 1]) b.cyl(-4.4 + s * 3.3, 3, -3.6, 0.14, 6, '#cfcabd', { seg: 8 });
    b.box(-4.4, 1.3, -5.36, 2, 2.6, 0.06, '#33475a');
    labelled(b, context.label, -4.4, 6.9, -3.3, 7, 0.32, '#f6f4ee', '#1f6f6a', false);
    // A second building at the right: a lower wing ending in a round lecture theatre
    b.at(10.6, 0, -9.6, 0, () => facultyBlock(b, 7, 6.4, 3, '#e0a43a'));
    b.cyl(7.2, 3.6, -5.4, 3, 7.2, '#ebe8df', { seg: 16 }); b.cyl(7.2, 7.4, -5.4, 3.2, 0.4, '#cfcabd', { seg: 16 });
    for (const y of [2.2, 5.2]) b.cyl(7.2, y, -5.4, 3.04, 1.3, '#4f6f86', { seg: 16 });
    b.box(6.2, 1.3, -2.52, 1.6, 2.6, 0.1, '#33475a', { ry: -0.34 });
    // The plaza: young palms in planters, modern lamps, benches, students, a row of parked cars
    for (const [x, z] of ([[-1.6, 0.4], [-1.6, 5.6], [2.2, 0.4], [2.2, 5.6]] as [number, number][])) { b.box(x, 0.3, z, 1.3, 0.6, 1.3, '#bdb6a5'); palm(b, x, z, { s: 0.62, lean: 0.04 }); }
    for (const [x, z] of ([[-5.6, 0.6], [5.4, 6.8], [-5.6, 7.2]] as [number, number][])) { b.cyl(x, 2.4, z, 0.07, 4.8, '#6f7a83', { seg: 5 }); b.box(x + 0.4, 4.8, z, 1, 0.08, 0.3, '#6f7a83'); b.box(x + 0.7, 4.74, z, 0.4, 0.05, 0.24, WARM, GLOW); }
    bench(b, -9.4, 6.6, { w: 3, back: true, color: '#8f9384', leg: METAL_DARK }); bench(b, 6.4, 3.6, { w: 2.6, ry: HALF, back: true, color: '#8f9384', leg: METAL_DARK });
    car(b, 12.6, 6, { ry: 0, color: '#c9c4b4' }); car(b, 12.6, 10.6, { ry: 0, color: '#33475a' });
    extra(b, 'kano-new-student-1', -9.4, 6.6, 0, 'sit', { seat: 0.6, look: MAN('blue', { outfit: 'casual', accessories: ['backpack'] }) });
    extra(b, 'kano-new-student-2', 0.4, -1.6, PI, 'walk', { look: WOMAN('teal', { accessories: ['headwrap', 'backpack'] }) });
    extra(b, 'kano-new-tutor', -2.4, -3.2, 0.3, 'wave', { look: MAN('cream', { accessories: ['fila', 'glasses'] }) });
    extra(b, 'kano-new-student-3', 4.6, 2.6, -1.2, 'stand', { look: MAN('green', { outfit: 'casual' }) });
    table(b, -7.4, -3, { w: 2.2, d: 1 }); laptop(b, -7.8, 1.05, -3, { ry: PI }); laptop(b, -7, 1.05, -3, { ry: PI });
    extra(b, 'kano-new-coder', -7.4, -1.9, PI, 'work', { look: WOMAN('violet') });
    lampPost(b, 4.4, 9.6, { light: true });
    return {
      spots: [...places([0.3, 2.8, PI], [-4.4, -2.4, PI], [0.6, 8]), landmark('pitch-room', /pitch|startup|present/, 5.2, -1.4, PI)],
      crowd: [[2.6, 8, 0.4], [-3.4, 7.8, -0.5], [6.4, 9.6, 2.4], [-4.6, 3, 1.2], [8.6, 8.6, -0.8], [-6.4, 10.6, 0.8], [3, 10.6, 2.8], [-3.2, 10.6, 2.4], [4.6, -1.4, 1.6], [9.4, 5.6, -0.4], [0.2, 9.6, 3.1], [-3.6, 0.4, 0.6]],
      spare: [[-4, 5], [4.4, 8], [-3, 9.4], [0.4, 6.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Tea and suya garden: mats and low benches in lantern light, a tea seller's table, a suya grill. No bar.

function kettle(b: Batch, x: number, y: number, z: number, s = 1): void {
  b.cyl(x, y + 0.17 * s, z, 0.18 * s, 0.34 * s, '#b9bec2', { seg: 7, top: 0.75 }); b.cone(x, y + 0.4 * s, z, 0.14 * s, 0.12 * s, '#8f959b', { seg: 7 });
  b.box(x + 0.22 * s, y + 0.22 * s, z, 0.22 * s, 0.05 * s, 0.05 * s, '#b9bec2', { rz: 0.5 });
}

const teaGarden: SceneDef = {
  mood: 'outdoor', accent: '#e0822f', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(131);
    dust(b, rand, '#c8a878', '#94764e');
    // A low earth wall round the back and the left, lanterns along it
    earthWall(b, -14.6, 14.6, -12, 1.5, { pinnacles: false, t: 0.6 }); earthWallZ(b, -14.4, -12, 7, 1.5, { pinnacles: false, t: 0.6, tone: 1 });
    for (const x of [-10, -3.4, 3.4, 10]) lantern(b, x, -12, 1.1, 1.7);
    // The tea seller's table under a mat shade: kettles, glasses, tins, a stove with the big kettle on it
    for (const [x, z] of ([[-8.4, -9.8], [-2.6, -9.8], [-8.4, -6.6], [-2.6, -6.6]] as [number, number][])) b.cyl(x, 1.5, z, 0.08, 3, WOOD_DARK, { seg: 5 });
    b.box(-5.5, 3.06, -8.2, 6.4, 0.1, 3.8, MAT); for (let i = 0; i < 6; i++) b.box(-8.4 + i * 1.16, 3.13, -8.2, 0.06, 0.05, 3.8, '#a8843f');
    table(b, -5.4, -7.6, { w: 3.6, d: 1.1, h: 0.95, color: '#7a5c3c' });
    kettle(b, -6.7, 1, -7.6, 1.2); kettle(b, -6, 1, -7.4); kettle(b, -5.4, 1, -7.7);
    for (let i = 0; i < 5; i++) b.cyl(-4.7 + (i % 3) * 0.22, 1.07 + Math.floor(i / 3) * 0.14, -7.4, 0.08, 0.14, '#dfe6ea', { seg: 6 });
    for (let i = 0; i < 3; i++) b.cyl(-4 + i * 0.3, 1.14, -7.8, 0.12, 0.28, ['#c9423a', '#e8dcb4', '#2f8f55'][i]!, { seg: 7 });
    b.cyl(-7.9, 0.3, -6.9, 0.3, 0.6, '#3a3d42', { seg: 8 }); b.cyl(-7.9, 0.62, -6.9, 0.2, 0.06, '#ff9a3c', { seg: 8, ...GLOW }); kettle(b, -7.9, 0.66, -6.9, 1.5);
    extra(b, 'kano-tea-seller', -5.4, -8.6, 0, 'work', { look: MAN('cream') });
    bench(b, -5.4, -5.8, { w: 3.4, seat: 0.45, color: '#8a6644' });
    // The suya grill: a long charcoal trough on legs, skewers across it, more standing round a mound, onions and tomatoes
    b.box(6.4, 0.9, -7.8, 3.2, 0.3, 1, '#3a3d42'); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(6.4 + sx * 1.4, 0.4, -7.8 + sz * 0.4, 0.08, 0.8, 0.08, METAL_DARK);
    b.box(6.4, 1.06, -7.8, 3, 0.04, 0.8, '#ff7a2c', GLOW);
    for (let i = 0; i < 9; i++) { b.box(5.1 + i * 0.32, 1.12, -7.8, 0.04, 0.03, 1.2, WOOD_LIGHT); b.box(5.1 + i * 0.32, 1.14, -7.8, 0.12, 0.06, 0.7, i % 3 ? '#8a4a2c' : '#a85a34'); }
    b.box(9.4, 0.5, -7.6, 1.4, 1, 1.2, '#7a5c3c'); b.cone(9.4, 1.3, -7.6, 0.44, 0.6, '#8a4a2c', { seg: 8 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; b.cyl(9.4 + Math.sin(a) * 0.5, 1.36, -7.6 + Math.cos(a) * 0.5, 0.02, 0.8, WOOD_LIGHT, { seg: 4 }); }
    for (let i = 0; i < 4; i++) b.ball(8.9 + (i % 2) * 0.3, 1.1, -7.1 - Math.floor(i / 2) * 0.1 + 0.2, 0.1, 0.1, 0.1, i % 2 ? '#c9423a' : '#8a5aa0', { seg: 5 });
    extra(b, 'kano-suya-seller', 6.4, -8.9, 0, 'work', { look: MAN('orange') });
    b.light(6.4, 2.2, -7.2, '#ff9a4a', 16, 9);
    // Mats on the swept ground with low benches round them; people sitting to eat and talk
    const mats: [number, number, number, Colour, Colour][] = [[-0.6, -1.6, 0.1, '#b9603f', MAT], [6.4, -2.2, -0.15, '#2f6f5c', '#d9c08a'], [-7.6, 0.4, 0.2, '#2a4fa6', MAT], [5.6, 4.2, 0.1, '#8a3a2e', '#d9c08a']];
    for (const [x, z, ry, border, weave] of mats) { rug(b, x, z, 3.6, 2.6, weave, { ry, border }); b.at(x, 0, z, ry, () => { for (let i = 0; i < 4; i++) b.box(-1.35 + i * 0.9, 0.1, 0, 0.12, 0.02, 2.6, border); }); }
    bench(b, -0.6, -3.6, { w: 3, seat: 0.4, color: '#8a6644' }); bench(b, 9, -2.2, { w: 2.4, seat: 0.4, ry: -HALF, color: '#8a6644' }); bench(b, -10.2, 0.4, { w: 2.4, seat: 0.4, ry: HALF, color: '#8a6644' });
    extra(b, 'kano-tea-guest-1', -0.6, -3.6, 0, 'sit', { seat: 0.4, look: MAN('green') });
    extra(b, 'kano-tea-guest-2', 6.4, -2.2, -2.2, 'sit', { seat: 0.12, look: MAN('cream', { outfit: 'agbada' }) });
    extra(b, 'kano-tea-guest-3', -7.6, 0.4, 1.8, 'sit', { seat: 0.12, look: WOMAN('violet') });
    for (const [x, z] of ([[-0.2, -1.4], [6.8, -1.6], [5.4, 4]] as [number, number][])) { b.cyl(x, 0.13, z, 0.4, 0.05, '#c9a56a', { seg: 9 }); kettle(b, x, 0.15, z, 0.8); for (let i = 0; i < 3; i++) b.cyl(x + 0.24 * Math.cos(i * 2.1), 0.22, z + 0.24 * Math.sin(i * 2.1), 0.06, 0.12, '#dfe6ea', { seg: 5 }); }
    // The music corner: a low platform with a rug, two drums and a small speaker
    b.box(-10.4, 0.14, -4.6, 4.2, 0.28, 3, '#8a6644'); b.box(-10.4, 0.3, -4.6, 3.6, 0.04, 2.4, '#8a3a2e');
    b.at(-11.2, 0.3, -4.8, 0, () => drum(b, 0, 0, '#6a3f27')); b.at(-10.2, 0.3, -5.2, 0, () => drum(b, 0, 0, '#7a4a2c'));
    speaker(b, -12.4, -5.4, { h: 1.3, w: 0.7, ry: 0.5, y: 0.3 });
    extra(b, 'kano-tea-drummer', -9.4, -4.2, 0.6, 'stand', { y: 0.3, look: MAN('teal') });
    // Lanterns on poles, strings of bulbs, a milk seller's calabashes, the garden's name on the wall
    for (const [x, z] of ([[-3.4, 1.6], [2.6, -4.6], [9.6, 1.4], [-11.4, 4.6], [2.4, 6.4]] as [number, number][])) lantern(b, x, z);
    stringLights(b, [-8.4, 3.1, -6.6], [2.6, 2.9, -4.6], { n: 9, colors: [WARM, '#ffb97a'] }); stringLights(b, [2.6, 2.9, -4.6], [9.6, 2.9, 1.4], { n: 7, colors: [WARM, '#ffb97a'] });
    b.light(-3.4, 2.6, 1.6, '#ffc878', 18, 11); b.light(9.6, 2.6, 1.4, '#ffc878', 16, 10);
    b.box(11.6, 0.06, 7.6, 2.6, 0.04, 2, MAT);
    for (let i = 0; i < 3; i++) { b.ball(10.9 + i * 0.7, 0.3, 7.4, 0.3, 0.26, 0.3, '#e3c77a', { seg: 6 }); b.cone(10.9 + i * 0.7, 0.62, 7.4, 0.32, 0.22, '#c9a45a', { seg: 7 }); }
    extra(b, 'kano-tea-milk-seller', 11.6, 8.4, PI, 'sit', { seat: 0.12, look: WOMAN('pink') });
    labelled(b, context.label, 2, 2.3, -11.6, 9, 0.36, '#f6e9c6', '#4a3626', true);
    for (const x of [-2.6, 6.6]) b.cyl(x, 1.3, -11.7, 0.07, 2.6, WOOD_DARK, { seg: 5 });
    neem(b, 12.4, -9.6, 1.3); palm(b, -12.6, 9.6, { s: 1.1 });
    return {
      spots: places([1.6, 1.6, PI], [4.6, -6.4, PI], [0.4, 7]),
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 7.4, 2.4], [-5, 5.6, 1.2], [8.6, 10.4, -0.8], [-8.4, 9, 0.8], [3, 10.4, 2.8], [-5.2, 10.2, 2.4], [-10.6, 6.6, 1.6], [2.6, -1.2, -0.4], [0.2, 9, 3.1], [-3.4, -1.4, 0.6]],
      spare: [[-2.4, 4.4], [1.4, 4.6], [-3, 9.4], [3.4, 8.6]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Film workshop: the yard of a small studio, set up for a scene — a camera on its tripod, lights, a painted backdrop.

function tripod(b: Batch, h: number): void {
  for (let i = 0; i < 3; i++) b.at(0, 0, 0, (i / 3) * PI * 2, () => b.cyl(0, h / 2, h * 0.19, 0.035, h * 1.07, BLACK, { seg: 4, rx: -0.37 }));
}
function filmCamera(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => {
    tripod(b, 1.5);
    b.box(0, 1.56, 0, 0.3, 0.12, 0.3, METAL_DARK); b.box(0, 1.84, 0.02, 0.34, 0.42, 0.72, '#2a2d33');
    b.cyl(0, 1.84, 0.52, 0.14, 0.34, BLACK, { seg: 8, rx: HALF }); b.box(0, 1.84, 0.74, 0.4, 0.34, 0.12, '#1a1c20');
    b.box(0.25, 1.96, -0.2, 0.1, 0.16, 0.3, '#3d444b'); b.box(0, 2.14, 0.2, 0.07, 0.07, 0.62, '#5f666c');
    b.box(0.3, 1.5, -0.5, 0.05, 0.05, 0.7, METAL_DARK, { rx: 0.4 });
  });
}
function studioLight(b: Batch, x: number, z: number, ry: number, h = 3): void {
  b.at(x, 0, z, ry, () => {
    tripod(b, 0.9); b.cyl(0, h / 2 + 0.4, 0, 0.04, h - 0.8, BLACK, { seg: 5 });
    b.box(0, h, 0.1, 1.1, 1.1, 0.4, '#22252a', { rx: 0.2 }); b.quad(0, h - 0.04, 0.32, 0.96, 0.96, '#fff6dc', { rx: -0.2, ...GLOW });
  });
}

const filmYard: SceneDef = {
  mood: 'outdoor', accent: '#8055c2', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(137);
    dust(b, rand, '#d6c8a4', '#9a8f72');
    // The yard wall and the studio room at the back left, its name over the door
    b.box(4.4, 1.4, -12.2, 20.4, 2.8, 0.4, '#e3dcc4'); b.box(4.4, 2.86, -12.2, 20.6, 0.14, 0.56, '#bdb298');
    b.box(-14.4, 1.4, -2.4, 0.4, 2.8, 14, '#e3dcc4'); b.box(-14.4, 2.86, -2.4, 0.56, 0.14, 14.2, '#bdb298');
    b.box(-9.6, 1.9, -10, 8.4, 3.8, 4.8, '#e9dfc4'); b.box(-9.6, 0.5, -10, 8.5, 1, 4.9, '#8055c2'); b.box(-9.6, 3.94, -10, 8.9, 0.28, 5.3, '#bdb298');
    b.box(-8.2, 1.5, -7.56, 1.4, 2.6, 0.08, '#33475a'); windowPane(b, -11.4, 2.2, -7.56, { w: 1.6, h: 1.3, glass: '#7f9fb4', frame: '#bdb298' });
    labelled(b, context.label, -9.6, 3.3, -7.54, 7.6, 0.3, '#f6efd8', '#4a3a6a', false);
    // The set: a painted backdrop on a frame, a rug with two stools and a low table in front of it
    for (const x of [1.6, 9.6]) { b.cyl(x, 2.3, -9.4, 0.07, 4.6, METAL_DARK, { seg: 5 }); b.box(x, 0.08, -9.4, 0.2, 0.16, 1.6, METAL_DARK); }
    b.box(5.6, 4.56, -9.4, 8.2, 0.08, 0.08, METAL_DARK);
    b.quad(5.6, 3.3, -9.34, 7.8, 2.4, '#9fc4dc'); b.quad(5.6, 1.3, -9.34, 7.8, 1.7, '#d9b77c');
    b.quad(3.6, 2.2, -9.32, 2.2, 1.6, '#c79f6b'); b.quad(3.6, 3.1, -9.31, 2.4, 0.2, '#d3ae7c'); b.quad(3.2, 1.9, -9.31, 0.5, 1, '#4a3626');
    b.quad(7.6, 2, -9.32, 0.24, 2.2, '#75614a'); b.quad(7.6, 3.3, -9.31, 1.8, 0.8, '#6f9a52');
    rug(b, 5.6, -6.4, 4.4, 2.8, '#b9603f', { border: MAT });
    stool(b, 4.6, -6.4, { h: 0.5 }); stool(b, 6.8, -6.6, { h: 0.5 }); table(b, 5.7, -5.8, { w: 0.9, d: 0.6, h: 0.5 });
    extra(b, 'kano-film-actor-1', 4.6, -6.4, 1.2, 'sit', { seat: 0.5, look: MAN('cream', { outfit: 'agbada' }) });
    extra(b, 'kano-film-actor-2', 6.8, -6.6, -1.2, 'sit', { seat: 0.5, look: WOMAN('gold') });
    // The crew: the camera on its tripod and its operator, two lights, a reflector, a microphone on a stand
    filmCamera(b, 5.2, -1.6, PI);
    extra(b, 'kano-film-operator', 5.3, -0.5, PI, 'work', { look: MAN('navy', { outfit: 'casual', accessories: ['cap'] }) });
    studioLight(b, 0.8, -4.6, 2.2); studioLight(b, 10.6, -4.2, -2.2, 3.3);
    b.at(9.4, 0, -1.4, -2.4, () => { tripod(b, 0.9); b.cyl(0, 1.5, 0, 0.04, 1.4, BLACK, { seg: 5 }); b.cyl(0, 2.4, 0.06, 0.7, 0.05, '#f1efe8', { seg: 14, rx: HALF + 0.2 }); });
    b.at(2, 0, -6.4, 0, () => { tripod(b, 0.9); b.cyl(0, 1.6, 0, 0.04, 1.8, BLACK, { seg: 5 }); b.box(0.9, 2.6, 0, 2.2, 0.05, 0.05, BLACK, { rz: 0.2 }); b.box(1.96, 2.8, 0, 0.36, 0.1, 0.1, '#5f666c', { rz: 0.2 }); });
    for (let i = 0; i < 5; i++) b.box(2.6 + i * 1.2, 0.06, -3 + (i % 2) * 0.3, 1.3, 0.03, 0.06, BLACK, { ry: 0.3 - (i % 2) * 0.6 });
    // The editing table under a parasol, folding chairs, cases of equipment
    table(b, -6.4, 1.6, { w: 2.8, d: 1.1 }); laptop(b, -7, 1.05, 1.6, { ry: PI }); screen(b, -5.8, 1.5, 1.4, { w: 0.9, h: 0.6, stand: false, color: '#b3a6e6' });
    b.box(-5.8, 1.12, 1.4, 0.3, 0.16, 0.2, BLACK); b.box(-7.5, 1.08, 2, 0.4, 0.04, 0.3, '#22252a'); b.box(-7.5, 1.12, 1.88, 0.4, 0.06, 0.05, '#f1efe8', { rz: 0.2 });
    parasol(b, -8.4, 0.8, { colors: ['#8055c2', WHITE] });
    extra(b, 'kano-film-editor', -6.4, 2.7, PI, 'work', { look: WOMAN('teal') });
    chair(b, -2.4, 0.4, { ry: 2.6, color: '#2a2d33' }); chair(b, 0.6, 1.4, { ry: 2.9, color: '#2a2d33' });
    extra(b, 'kano-film-director', -2.4, 0.4, 2.6, 'sit', { seat: 0.6, look: MAN('green') });
    crate(b, 11.6, 0, 2.4, { s: 1, color: '#3d444b' }); crate(b, 12.6, 0, 2.8, { s: 0.8, color: '#2a2d33' }); crate(b, 11.8, 0.6, 2.5, { s: 0.7, color: '#5f666c' });
    neem(b, 13.8, -10.4, 1.3); neem(b, -12, 8.4, 1.1, 2);
    lampPost(b, -1.6, 6.4, { light: true });
    return {
      spots: places([2.2, 1.6, PI], [-4.2, 3, -HALF], [0.6, 7.6]),
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 6.2, 2.4], [-6, 6.6, 1.2], [8.6, 8.8, -0.8], [-8.4, 9, 0.8], [3, 10.4, 2.8], [-5.2, 10.2, 2.4], [8.4, 2.4, PI], [11, 5.6, -0.4], [0.2, 9, 3.1], [5.4, 4.6, 0.6]],
      spare: spareFront(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Community hall: a plain single-storey hall with a porch, a notice board on the forecourt, a hand pump, a flag.

const communityHall: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(139);
    dust(b, rand);
    b.box(0, 0.05, 3.6, 3, 0.03, 17, '#e6d6ae');
    // The hall: cream walls over a green band, louvred windows, a pitched tin roof; a small gabled porch on four posts
    b.box(-1, 2.1, -9.6, 17, 4.2, 6, '#ece2c6'); b.box(-1, 0.6, -9.6, 17.1, 1.2, 6.1, '#3f7f5c');
    b.at(-1, 0, -9.6, 0, () => { for (const s of [-1, 1]) b.box(0, 5.05, s * 1.7, 18, 0.14, 3.9, s < 0 ? '#6f8a78' : '#7d9886', { rx: s * 0.42 }); b.box(0, 5.84, 0, 18, 0.14, 0.3, '#566e5e'); });
    for (const x of [-7.4, -4.6, 2.6, 5.4]) { b.box(x, 2.6, -6.57, 1.5, 1.4, 0.06, '#f6f2e6'); for (let k = 0; k < 4; k++) b.box(x, 2.12 + k * 0.32, -6.54, 1.3, 0.14, 0.04, '#6f8a8c'); }
    b.box(-1, 1.5, -6.56, 2.2, 3, 0.08, '#4a3626'); b.box(-1, 1.5, -6.5, 0.06, 3, 0.04, '#2a1f18');
    b.box(-1, 0.14, -5.2, 5, 0.28, 2.8, '#cfc3a0');
    for (const sx of [-1, 1]) for (const z of [-6.2, -4]) b.box(-1 + sx * 2.3, 1.9, z, 0.2, 3.5, 0.2, '#f6f2e6');
    for (const s of [-1, 1]) b.box(-1 + s * 1.36, 4.26, -5.1, 3, 0.14, 3, '#6f8a78', { rz: -s * 0.42 });
    b.box(-1, 3.86, -3.66, 5, 0.5, 0.1, '#f6f2e6');
    labelled(b, context.label, -1, 3.86, -3.6, 4.6, 0.26, '#f6f2e6', '#2f6f4a', false);
    // The front desk on the porch, the notice board on the forecourt with a little roof of its own
    table(b, -3.4, -2.6, { w: 2, d: 0.9 }); chair(b, -3.4, -3.5, { color: '#3f7f5c' });
    for (let i = 0; i < 3; i++) b.box(-4 + i * 0.5, 1.09, -2.6, 0.36, 0.06 + i * 0.03, 0.5, ['#f1efe8', '#f2e2a6', '#e9e4d6'][i]!);
    extra(b, 'kano-hall-clerk', -3.4, -3.5, 0, 'sit', { seat: 0.6, look: MAN('green') });
    b.at(5.4, 0, 1.4, 0.6, () => {
      for (const s of [-1, 1]) b.box(s * 1.9, 1.3, 0, 0.14, 2.6, 0.14, WOOD_DARK);
      b.box(0, 1.6, 0, 3.8, 1.8, 0.1, '#3f6a55'); b.box(0, 2.7, 0.1, 4.4, 0.1, 0.9, '#9b5a3a', { rx: 0.2 });
      sign(b, 0, 2.24, 0.07, 'NOTICES', { size: 0.22, color: '#f6f2e6' });
      for (let i = 0; i < 8; i++) b.quad(-1.4 + (i % 4) * 0.92, 1.72 - Math.floor(i / 4) * 0.72, 0.06, 0.66, 0.56, ['#f1efe8', '#f2e2a6', '#e9e4d6', '#f1d6dc', '#d6e6f1'][i % 5]!);
    });
    extra(b, 'kano-hall-reader', 5.4, 3.6, PI + 0.4, 'stand', { look: WOMAN('blue') });
    // A hand pump on a concrete apron, a water tank beside the hall, a flag, benches in the shade
    b.box(-9.6, 0.1, 3.4, 2.8, 0.2, 2.8, '#bdb6a5'); b.cyl(-9.6, 0.8, 3.4, 0.12, 1.2, '#3f72c4', { seg: 7 }); b.box(-9.6, 1.5, 3.4, 0.3, 0.3, 0.3, '#3f72c4');
    b.box(-9.6, 1.7, 2.7, 0.07, 0.07, 1.6, '#3f72c4', { rx: 0.4 }); b.box(-9.6, 1.1, 3.9, 0.1, 0.1, 0.6, '#3f72c4');
    b.cyl(-9.6, 0.36, 4.4, 0.26, 0.4, '#c9423a', { seg: 8, top: 1.2 });
    for (const [dx, dz] of ([[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as [number, number][])) b.box(10.4 + dx, 1.3, -8.4 + dz, 0.14, 2.6, 0.14, METAL_DARK);
    b.box(10.4, 2.64, -8.4, 2, 0.1, 2, METAL_DARK); b.cyl(10.4, 3.7, -8.4, 1, 2, '#22252a', { seg: 12 }); b.cyl(10.4, 4.76, -8.4, 0.5, 0.14, '#3a3d42', { seg: 10 });
    flag(b, 8.6, -3.4, { h: 6 });
    neem(b, 12.8, -1.4, 1.2); neem(b, -12.4, 8.6, 1.15, 1); neem(b, -12.6, -3, 1.1, 2);
    bench(b, 11.4, 1.2, { w: 2.8, color: '#8a6644' }); bench(b, 10.6, 5.6, { w: 2.8, ry: -HALF, color: '#8a6644' });
    extra(b, 'kano-hall-elder', 11.4, 1.2, 0, 'sit', { seat: 0.6, look: MAN('cream', { outfit: 'agbada' }) });
    b.at(-6.4, 0, 8.4, 0.3, () => { for (const sz of [-0.55, 0.55]) b.cyl(0, 0.36, sz, 0.36, 0.06, BLACK, { seg: 9, rz: HALF }); b.box(0, 0.62, 0, 0.06, 0.06, 1, '#2f2a24'); b.box(0, 0.9, 0.5, 0.06, 0.6, 0.06, '#2f2a24'); b.box(0, 1.16, 0.5, 0.56, 0.05, 0.05, METAL_DARK); b.box(0, 0.96, -0.24, 0.16, 0.06, 0.3, BLACK); });
    lampPost(b, -4.4, 5.4, { light: true });
    return { spots: places([7.2, 3.6, PI + 0.6], [-1.6, -2.6, HALF], [0.6, 7.6]), crowd: crowdFront(), spare: spareFront() };
  },
};

// ---------------------------------------------------------------------------------------------
// Neighbourhood garden: neem shade over swept paths, an ayo table, water pots in a shelter, beds of flowers.

const DUST_PATH: Colour = '#dcc898';
const garden: SceneDef = {
  mood: 'outdoor', accent: '#6f9a52', camera: LOW, walk: OPEN,
  build(b, context) {
    const rand = seeded(149);
    ground(b, { w: 30, d: 26, color: '#a9b272', edge: '#75804c' });
    for (let i = 0; i < 8; i++) b.disc(-13 + rand() * 26, 0.045, -11 + rand() * 22, 1.4 + rand() * 1.8, i % 2 ? '#b9bc7c' : '#9aa866', { seg: 9, sz: 0.6 });
    b.box(0, 0.06, 2, 2.6, 0.03, 20, DUST_PATH); b.box(0, 0.06, -0.6, 26, 0.03, 2.4, DUST_PATH); b.disc(0, 0.08, -0.6, 3.2, '#e3d0a2', { seg: 16 });
    // A low earth wall round the back and sides, open at the front
    earthWall(b, -14.6, 14.6, -12.2, 1.3, { pinnacles: false, t: 0.6 }); earthWallZ(b, -14.4, -12.2, 8, 1.3, { pinnacles: false, t: 0.6, tone: 1 }); earthWallZ(b, 14.4, -12.2, 2, 1.3, { pinnacles: false, t: 0.6, tone: 2 });
    // Neem trees, the largest in a round earth planter where the paths cross
    b.cyl(0, 0.25, -0.6, 1.5, 0.5, EARTH[1]!, { seg: 12 }); b.cyl(0, 0.52, -0.6, 1.3, 0.06, '#7a6a4a', { seg: 12 });
    neem(b, 0, -0.6, 1.45);
    neem(b, -9.4, -7.4, 1.3, 1); neem(b, 10.6, -7.2, 1.35, 2); neem(b, -10.6, 6.4, 1.15, 2); neem(b, 1.6, -9.8, 1.1, 1);
    // The ayo table under the left-hand tree: a board of two rows of six cups, two players on stools, one watching
    table(b, -6.4, -4, { w: 1.4, d: 0.9, h: 0.7 });
    b.box(-6.4, 0.75, -4, 1.1, 0.1, 0.44, '#6b4a2f');
    for (let i = 0; i < 12; i++) { b.cyl(-6.86 + (i % 6) * 0.185, 0.81, -4 + (i < 6 ? -0.11 : 0.11), 0.07, 0.02, '#3a2a1c', { seg: 6 }); if (i % 3) b.ball(-6.86 + (i % 6) * 0.185, 0.83, -4 + (i < 6 ? -0.11 : 0.11), 0.035, 0.03, 0.035, '#d9c58c', { seg: 4 }); }
    stool(b, -6.4, -4.95, { h: 0.45 }); stool(b, -6.4, -3.05, { h: 0.45 });
    extra(b, 'kano-garden-ayo-1', -6.4, -4.95, 0, 'sit', { seat: 0.45, look: MAN('cream') });
    extra(b, 'kano-garden-ayo-2', -6.4, -3.05, PI, 'sit', { seat: 0.45, look: MAN('blue') });
    extra(b, 'kano-garden-watcher', -4.6, -4.2, -HALF, 'stand', { look: MAN('green') });
    // Water pots under a small mat shelter, a standpipe with a bucket
    for (const [x, z] of ([[5.6, -9.8], [8.6, -9.8], [5.6, -8], [8.6, -8]] as [number, number][])) b.cyl(x, 1.1, z, 0.07, 2.2, WOOD_DARK, { seg: 5 });
    b.box(7.1, 2.26, -8.9, 3.6, 0.1, 2.4, MAT);
    b.box(7.1, 0.2, -8.9, 2.6, 0.4, 1, EARTH[2]!);
    for (let i = 0; i < 3; i++) { b.ball(6.3 + i * 0.8, 0.84, -8.9, 0.36, 0.44, 0.36, ['#a8573a', '#8a4a30', '#b8683f'][i]!, { seg: 7 }); b.cyl(6.3 + i * 0.8, 1.3, -8.9, 0.2, 0.06, '#c9a45a', { seg: 7 }); }
    b.cyl(12.4, 0.6, -2.4, 0.06, 1.2, METAL, { seg: 5 }); b.box(12.4, 1.16, -2.2, 0.08, 0.08, 0.4, METAL); b.cyl(12.4, 0.2, -1.8, 0.24, 0.36, '#3f72c4', { seg: 8, top: 1.2 });
    // Beds of flowers edged in earth, benches along the paths, a gardener with a barrow
    for (const [x, z, w, d] of ([[-7.4, 3.6, 5, 2.2], [6.4, -3.6, 4.4, 2], [6.6, 2.6, 4.6, 2]] as [number, number, number, number][])) {
      b.box(x, 0.14, z, w, 0.28, d, EARTH[2]!); b.box(x, 0.3, z, w - 0.4, 0.04, d - 0.4, '#6a5a3c');
      for (let i = 0; i < Math.floor(w / 0.8); i++) b.ico(x - w / 2 + 0.6 + i * 0.8, 0.5, z + (i % 2 ? 0.3 : -0.3), 0.3, 0.26, 0.3, ['#c0407e', '#e8c43a', '#e9614b', '#f1efe8', '#6f9a52'][(i + Math.abs(Math.round(x))) % 5]!);
    }
    bush(b, -12.6, -1.4, { s: 1, color: '#c0407e' }); bush(b, 12.8, -10.6, { s: 0.9, color: '#c0407e' });
    bench(b, -3.4, 1.4, { w: 2.8, back: true, ry: 0, color: '#8a6644' }); bench(b, 3.4, -2.6, { w: 2.6, back: true, ry: 0, color: '#8a6644' }); bench(b, -12.4, -4, { w: 2.6, ry: HALF, color: '#8a6644' });
    extra(b, 'kano-garden-sitter', -3.4, 1.4, 0, 'sit', { seat: 0.6, look: WOMAN('teal') });
    b.at(11.2, 0, 2.4, -0.6, () => { b.box(0, 0.6, 0, 0.9, 0.4, 1.3, '#2f8f55'); b.cyl(0, 0.3, 0.9, 0.3, 0.12, BLACK, { seg: 8, rz: HALF }); for (const s of [-1, 1]) b.box(s * 0.4, 0.7, -1, 0.06, 0.06, 0.9, METAL_DARK); b.ico(0, 0.9, 0, 0.36, 0.2, 0.5, '#6a5a3c'); });
    extra(b, 'kano-garden-keeper', 10.4, 3.8, 2.6, 'work', { look: MAN('green', { outfit: 'casual' }) });
    palm(b, -13.2, -10.8, { s: 1.2 }); palm(b, 13.2, 5.2, { s: 1, ry: 2 });
    stele(b, context.label, -6.6, 9.4, 0.3, 5.4);
    lampPost(b, 2.6, 4.6, { light: true }); lampPost(b, -2.6, -4.6);
    return {
      spots: places([-3.6, -1.4, -2.2], [8.6, 5, 0.6], [0.6, 7.6]),
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [4.6, 9.4, 2.4], [-4.6, 6.6, 1.2], [6.6, 10.8, -0.8], [-9.4, 10.8, 0.8], [3, 10.8, 2.8], [-2.2, 10.4, 2.4], [-9.6, -0.6, 1.6], [10.4, -0.6, -0.4], [0.2, 9, 3.1], [3.4, 0.6, 0.6]],
      spare: [[-2, 5.4], [2, 6], [-1, 10], [1.4, 9.4]],
    };
  },
};

/** Variant scenes by scene kind, then by variant (venue.scene.variant): the old city's and the rest of the city's. */
const RAW: Record<string, Record<string, SceneDef>> = {
  market: { ...OLD_CITY.market, 'kano-kwari': kwari, 'kano-sabon-gari': sabonGari },
  viewing: { 'kano-stadium': stadium },
  park: { 'kano-racecourse': racecourse, 'kano-tea-garden': teaGarden, 'kano-garden': garden },
  gym: { 'kano-polo': polo },
  hub: { 'kano-railway': railway, 'kano-motor-park': motorPark },
  office: { ...OLD_CITY.office, 'kano-old-campus': oldCampus, 'kano-new-campus': newCampus, 'kano-film-yard': filmYard },
  statehouse: { 'kano-community-hall': communityHall },
  walk: { ...OLD_CITY.walk },
  worship: { ...OLD_CITY.worship },
};

export const VARIANTS: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = Object.freeze(Object.fromEntries(Object.entries(RAW).map(([kind, variants]) => [kind, Object.freeze(variants)])));
