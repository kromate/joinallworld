/**
 * OWNER: scenes
 * Scenes of Port Harcourt's own places, each asked for through `scene.variant` and held in VARIANTS[kind][variant]
 * like the variants of src/scene/venues-ibadan-b.ts and src/scene/venues-ogun-a.ts. This file holds the parks, the
 * markets and the watersides; the campuses, stadiums, civic and industrial places are in src/scene/venues-rivers-b.ts
 * and are part of VARIANTS here.
 *
 *   park / ph-lake | ph-cenotaph | ph-rides | ph-bandstand
 *       a family park round a small lake with pedal boats and a climbing tower; a civic park of formal paths round a
 *       memorial statue on a plinth, with a row of flags and a flyover behind; a small amusement park with a carousel
 *       and a wheel; an evening garden of tables round an octagonal bandstand
 *   market / ph-block | ph-rows | ph-junction
 *       a modern market block of three floors of shops over a busy forecourt; rows of timber and of foodstuff under
 *       old sheet roofs; a market spread along both roads of a junction, with second-hand clothes on rails
 *   beach / ph-creek            sand on a tidal creek: regatta canoes drawn up, one under way, mangrove on the far bank
 *   hub / ph-terminal | ph-pier
 *       a concrete jetty with passenger boats, a ticket shed and a waiting shelter on a built-up waterside; a small
 *       town pier of planks beside houses on stilts
 *   buka / ph-bole              an open-air grill: plantain and fish roasting over drum grills, benches under a canopy
 *
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * The creeks are tidal and calm: no surf anywhere. Scenes are static. Scene definition format: see venues-outdoor.ts.
 */
import { GLOW, GLASS } from './build.ts';
import type { Batch, Colour, SceneDef } from './types.ts';
import {
  ground, bench, chair, stool, leafTree, palm, bush, lampPost, kiosk, flag, parasol, stringLights, fence, sign, signBoard, landmark, extra,
  table, crate, speaker, laptop, pot,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, WARM,
} from './props.ts';
import { PI, HALF, OPEN, seeded, plain, fit, labelled } from './venues-ogun-a.ts';
import {
  INLAND, WIDE, view, ZINC, OLD_ZINC, ASPHALT, KERB, GRASS, GRASS_EDGE,
  zincRoof, openShed, block, royalPalm, mangrove, creek, mangroveBank, canoe, speedboat, woodenBoat, bus, keke, lorry, barrow, flyover,
} from './venues-rivers-b.ts';

type Rand = () => number;
const look = (body: string, outfit: string, outfitColor: string, more: Record<string, unknown> = {}): Record<string, unknown> => ({ body, outfit, outfitColor, ...more });
const TRADER = (colour: string): Record<string, unknown> => look('woman', 'casual', colour, { accessories: ['headwrap'] });

// ---------------------------------------------------------------------------------------------
// Lake park: lawns and walkways round a small lake with pedal boats, a timber climbing tower, a playground.

function pedalBoat(b: Batch, x: number, y: number, z: number, ry: number, colour: Colour): void {
  b.at(x, y, z, ry, () => {
    b.box(0, 0.25, 0, 1.5, 0.4, 2.2, WHITE); b.box(0, 0.32, 0, 1.54, 0.14, 2.24, colour); b.box(0, 0.6, -0.5, 1.3, 0.5, 0.14, colour);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.65, 1.1, sz * 0.8, 0.05, 1.3, 0.05, METAL);
    b.box(0, 1.78, 0, 1.6, 0.08, 2, colour); b.box(0, 0.5, -1.15, 1.1, 0.5, 0.3, '#d8d4c8');
  });
}
function climbingTower(b: Batch, x: number, z: number): void {
  const holds: Colour[] = ['#c9423a', '#f2c14e', '#2a6fb0', '#2f8f55'];
  b.at(x, 0, z, 0, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1.5, 4.6, sz * 1.5, 0.24, 9.2, 0.24, WOOD_DARK);
    for (const y of [3, 6, 9]) {
      b.box(0, y, 0, 3.6, 0.18, 3.6, WOOD);
      for (const s of [-1, 1]) { b.box(s * 1.7, y + 0.7, 0, 0.08, 0.08, 3.4, WOOD_DARK); b.box(0, y + 0.7, s * 1.7, 3.4, 0.08, 0.08, WOOD_DARK); }
    }
    for (let level = 0; level < 3; level++) { b.box(0.75, 1.5 + level * 3, 1.5, 0.1, 3.3, 0.1, WOOD_DARK, { rz: (level % 2 ? 1 : -1) * 0.46 }); b.box(1.5, 1.5 + level * 3, 0, 0.1, 4.2, 0.1, WOOD_DARK, { rx: (level % 2 ? 1 : -1) * 0.78 }); }
    b.box(-0.75, 4.5, 1.58, 1.5, 9, 0.12, '#cfc6ae');
    for (let i = 0; i < 12; i++) b.box(-1.2 + ((i * 7) % 10) * 0.1, 0.8 + i * 0.68, 1.68, 0.16, 0.16, 0.1, holds[i % 4]!);
    b.cone(0, 10.6, 0, 2.9, 1.6, '#c9423a', { seg: 4, ry: PI / 4 }); b.box(0, 12, 0, 0.06, 1.4, 0.06, METAL); b.box(0.32, 12.5, 0, 0.6, 0.36, 0.03, '#f2c14e');
  });
}

const lake: SceneDef = {
  mood: 'outdoor', accent: '#39a9a6', camera: view(3.5, [17.5, 25.5, 32], [21, 49, 64]), walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: GRASS, edge: GRASS_EDGE });
    // Walkways: in from the gate, along the near shore, round to the tower
    b.box(0, 0.03, 8, 2.6, 0.04, 9.6, '#d9cfb2'); b.box(-1, 0.03, 3.4, 26, 0.04, 2.2, '#d9cfb2'); b.box(11.2, 0.03, -3.6, 2.2, 0.04, 14, '#d9cfb2'); b.box(-12.4, 0.03, -2.6, 2, 0.04, 12, '#d9cfb2');
    // The lake: two lobes inside a stone rim, a jet of water, three pedal boats and their landing
    for (const [x, z, rx, rz] of ([[-2.6, -3.4, 7.4, 4.3], [3.6, -6.6, 5.2, 3.6]] as [number, number, number, number][])) b.disc(x, 0.04, z, 1, '#cfc6ae', { seg: 20, sx: rx + 0.4, sz: rz + 0.4 });
    for (const [x, z, rx, rz] of ([[-2.6, -3.4, 7.4, 4.3], [3.6, -6.6, 5.2, 3.6]] as [number, number, number, number][])) { b.disc(x, 0.06, z, 1, '#3f8a96', { seg: 20, sx: rx, sz: rz }); b.disc(x, 0.09, z, 1, '#8fd0d8', { seg: 20, sx: rx, sz: rz, ...GLASS }); }
    b.cone(1.6, 0.9, -5.4, 0.3, 1.7, '#e8f6f6', { seg: 6, ...GLASS }); b.cyl(1.6, 0.14, -5.4, 0.5, 0.1, '#a39f92', { seg: 8 });
    pedalBoat(b, -5.6, 0.08, -4.2, 0.7, '#e9614b'); pedalBoat(b, 0.6, 0.08, -2.4, -1, '#f2c14e'); pedalBoat(b, 4.6, 0.08, -7.4, 2.4, '#2a6fb0');
    b.box(-3.2, 0.14, 1.6, 4.4, 0.24, 1.8, WOOD); for (const x of [-5.2, -1.2]) b.cyl(x, 0.5, 0.9, 0.09, 1, WOOD_DARK, { seg: 5 });
    pedalBoat(b, -3.6, 0.08, -0.2, HALF, '#2f8f55');
    kiosk(b, -8.6, 5.6, { w: 3, color: '#e8e4d8', roof: '#39a9a6', fascia: '#f1efe8', text: 'BOATS', textColor: '#1f5f5c' });
    extra(b, 'ph-lake-boatman', -8.6, 4.8, 0, 'work');
    // The climbing tower at the back, a playground on the right
    climbingTower(b, -11, -10);
    extra(b, 'ph-lake-climber', -10.4, -8.3, PI, 'wave', { y: 3.1, look: look('woman', 'jersey', 'orange') });
    b.at(11.4, 0, -10.4, -0.5, () => {
      b.box(0, 1.9, 0, 1.6, 0.14, 1.6, '#f2c14e'); for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.7, 0.95, sz * 0.7, 0.1, 1.9, 0.1, '#2a6fb0');
      b.box(0, 1.05, 2.1, 1, 0.1, 3.4, '#e9614b', { rx: 0.56 }); b.box(0, 3.1, 0, 2, 0.1, 2, '#c9423a');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.7, 2.5, sz * 0.7, 0.08, 1.2, 0.08, '#2a6fb0');
    });
    for (const s of [-1, 1]) b.box(8.4 + s * 1.3, 1.3, -10.6, 0.1, 2.6, 0.1, '#2a6fb0', { rz: s * 0.14 });
    b.box(8.4, 2.5, -10.6, 3, 0.1, 0.1, '#2a6fb0'); for (const x of [7.8, 9]) { b.box(x, 1.6, -10.6, 0.03, 1.8, 0.03, METAL); b.box(x, 0.7, -10.6, 0.5, 0.06, 0.3, '#e9614b'); }
    // Lawns: a picnic, an ayo board on a table, the help table
    b.box(6, 0.05, 7.6, 2.6, 0.03, 1.9, '#d86f9c', { ry: 0.3 }); extra(b, 'ph-lake-picnic', 6, 7.6, 2.6, 'sit', { seat: 0.2 });
    table(b, 9.6, 5, { w: 1.3, d: 0.9, h: 0.7 }); b.box(9.6, 0.74, 5, 0.9, 0.08, 0.36, '#6b4a2f');
    for (let i = 0; i < 6; i++) b.cyl(9.6 - 0.33 + (i % 3) * 0.33, 0.79, 5 + (i < 3 ? -0.09 : 0.09), 0.06, 0.02, '#d9c58c', { seg: 5 });
    stool(b, 9.6, 4.1, { h: 0.45 }); stool(b, 9.6, 5.9, { h: 0.45 }); extra(b, 'ph-lake-ayo', 9.6, 4.1, 0, 'sit', { seat: 0.45 });
    table(b, -5.4, 9.2, { w: 2.6, d: 1 }); sign(b, -5.4, 0.62, 9.74, 'HELP', { size: 0.3, color: WHITE, board: '#39a9a6', pad: 0.18 });
    b.box(7.4, 0.55, 10.8, 8.6, 1.1, 0.5, '#d8d2c2'); sign(b, 7.4, 0.6, 11.07, label, { size: fit(label, 8, 0.42), color: '#1f5f5c' });
    for (let i = 0; i < 5; i++) b.ico(3.6 + i * 1.9, 1.3, 10.7, 0.5, 0.3, 0.3, i % 2 ? '#d9482f' : '#f2c14e');
    // Palms, shade trees, hibiscus, benches facing the water, lamps
    royalPalm(b, -13.2, -5.4, 5.8); royalPalm(b, 8.8, 0.4, 5.4); royalPalm(b, -2.2, 10.6, 5);
    for (const [x, z, s, t] of ([[-13, 9.6, 1.1, 0], [13.2, 0.6, 1.05, 1], [13, 9.6, 0.95, 2], [-13.4, 3.6, 0.9, 1], [-5.6, -11.4, 1.1, 2], [2, -11.6, 1.1, 0]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    palm(b, 9.6, -3.2, { s: 0.95, ry: 2 });
    for (const [x, z, c] of ([[-9.6, 1.4, '#c0407e'], [5.6, 1.6, '#d9482f'], [-12.6, 6.4, '#c0407e'], [12.8, 5.4, '#d9482f'], [8.4, -1.6, '#c0407e']] as [number, number, Colour][])) bush(b, x, z, { s: 0.85, color: c });
    bench(b, 2.4, 1.9, { w: 2.6, ry: PI, back: true, color: '#8f9384', leg: '#6f766c' }); bench(b, 7.6, 1.9, { w: 2.6, ry: PI, back: true, color: '#8f9384', leg: '#6f766c' });
    extra(b, 'ph-lake-sitter', 7.6, 1.9, PI, 'sit', { seat: 0.6 }); extra(b, 'ph-lake-walker', -9, 3.4, HALF, 'walk');
    lampPost(b, 1.8, 5, { light: true }); lampPost(b, -11, 1.6); lampPost(b, 10, -6);
    return {
      spots: [
        landmark('lawn', /lawn|ayo|grass|picnic|play|rest/, 7.6, 4.8, HALF),
        landmark('work', /work|desk|job|community|volunteer|help/, -5.4, 8.3, 0, { act: { pose: 'work' } }),
        landmark('lake', /lake|water|boat|pedal/, -0.8, 3.2, PI),
        landmark('people', /people|crowd|meet/, 2.2, 7.4, 0),
      ],
      crowd: [[3.6, 5.6, 0.4], [-2.4, 6.6, -0.5], [4.6, 9.2, 2.6], [-2.2, 10.2, 1.2], [-7.6, 8, 2.8], [11.6, 2.6, PI], [-6.6, 3.4, 2.6], [5, 3.4, -1], [-11, 8.6, 0.6], [11.4, 8.4, 2.2], [-12.4, -1.6, 1.6], [11.2, -2.4, 0.5]],
      spare: [[0, 6], [3, 8.6], [-3, 8], [5, 5.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Civic park: formal paths meet at a memorial statue on a tall plinth; a row of flags stands behind it and a flyover
// runs past the back of the park.

const cenotaph: SceneDef = {
  mood: 'outdoor', accent: '#d9b24c', camera: view(3), walk: OPEN,
  build(b, context) {
    const label = plain(context.label), bronze = '#6a5a3c';
    ground(b, { w: 30, d: 26, color: '#5d9a54', edge: GRASS_EDGE });
    flyover(b, -11, 4.8, -16, 16, 4.4);
    b.at(0, 4.86, 0, 0, () => { bus(b, -6.6, -11, HALF, '#f1efe8', '#2a6fb0'); keke(b, 6, -11, -HALF); });
    // Formal paths: the axis from the gate, a cross walk, two diagonals, a paved round at the middle
    b.box(0, 0.03, 5, 3, 0.04, 16, '#d9cfb2'); b.box(0, 0.03, -2.4, 28, 0.04, 2.4, '#d9cfb2');
    for (const s of [-1, 1]) b.box(s * 7.4, 0.03, 3.6, 2, 0.04, 15, '#d9cfb2', { ry: s * 0.86 });
    b.disc(0, 0.06, -2.4, 5, '#e0d8c4', { seg: 20 }); b.disc(0, 0.07, -2.4, 3.6, '#cfc6ae', { seg: 20 });
    // The memorial: three steps, a tall plinth with a plaque, a bronze figure standing on it, a wreath at its foot
    b.box(0, 0.14, -2.4, 4.6, 0.28, 4.6, '#d8d2c2'); b.box(0, 0.42, -2.4, 3.6, 0.28, 3.6, '#cfc8b6'); b.box(0, 0.7, -2.4, 2.8, 0.28, 2.8, '#d8d2c2');
    b.box(0, 3, -2.4, 1.9, 4.4, 1.9, '#e6e0d0'); b.box(0, 5.3, -2.4, 2.3, 0.3, 2.3, '#cfc8b6'); b.box(0, 1, -2.4, 2.2, 0.4, 2.2, '#cfc8b6');
    b.box(0, 2.9, -1.42, 1.5, 1.3, 0.06, '#3a3226'); sign(b, 0, 2.9, -1.38, label, { size: fit(label, 1.3, 0.14), color: '#e6d59a' });
    for (const s of [-1, 1]) b.box(s * 0.2, 6.15, -2.4, 0.26, 1.4, 0.3, bronze);
    b.box(0, 7.4, -2.4, 0.74, 1.2, 0.4, bronze); b.ball(0, 8.32, -2.4, 0.24, 0.28, 0.24, bronze, { seg: 6 }); b.cyl(0, 8.56, -2.4, 0.3, 0.1, bronze, { seg: 8 });
    for (const s of [-1, 1]) b.box(s * 0.48, 7.3, -2.4, 0.2, 1.1, 0.24, bronze);
    b.cyl(0, 0.95, -0.9, 0.5, 0.14, '#2f6f3f', { seg: 10, rx: 1.1 }); for (let i = 0; i < 5; i++) b.ball(Math.sin(i * 1.26) * 0.36, 1.0 + Math.cos(i * 1.26) * 0.16, -0.82 + Math.cos(i * 1.26) * 0.3, 0.09, 0.09, 0.09, i % 2 ? '#c9423a' : WHITE, { seg: 4 });
    // The row of flags behind
    for (let i = 0; i < 7; i++) flag(b, -8.4 + i * 2.8 - 0.9, -7.2 + Math.abs(i - 3) * 0.3, { h: 6.4 });
    // Clipped hedges and flower beds along the paths, benches, old shade trees, lamps
    for (const s of [-1, 1]) { for (const z of [5.4, 9.6]) b.box(s * 2.1, 0.35, z, 0.6, 0.7, 3.2, '#3f8a57'); for (const x of [6.6, 11]) b.box(s * x, 0.35, -0.8, 3.4, 0.7, 0.6, '#3f8a57'); }
    for (const [x, z] of ([[-5.6, -5], [5.6, -5], [-10.6, 1.6], [10.6, 1.6]] as [number, number][])) { b.disc(x, 0.05, z, 1.2, '#7a5a3c', { seg: 10 }); for (let i = 0; i < 5; i++) b.ico(x + Math.sin(i * 1.26) * 0.7, 0.3, z + Math.cos(i * 1.26) * 0.7, 0.34, 0.26, 0.34, i % 2 ? '#d9482f' : '#f2c14e'); }
    bench(b, -4.6, -0.6, { w: 2.6, ry: HALF * 0.5, back: true, color: '#8f9384', leg: '#6f766c' }); bench(b, 4.6, -0.6, { w: 2.6, ry: -HALF * 0.5, back: true, color: '#8f9384', leg: '#6f766c' });
    bench(b, 3.2, 8.4, { w: 2.6, ry: -HALF, back: true, color: '#8f9384', leg: '#6f766c' });
    extra(b, 'ph-cenotaph-reader', 3.2, 8.4, -HALF, 'sit', { seat: 0.6, look: look('man', 'office', 'cream', { accessories: ['glasses'] }) });
    for (const [x, z, s, t] of ([[-12.6, -6, 1.3, 0], [12.6, -6.4, 1.25, 1], [-13, 6.4, 1.15, 2], [13, 10.4, 1, 0], [-8.4, 11, 0.9, 1]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    royalPalm(b, -3.4, -6.2, 5.6); royalPalm(b, 3.4, -6.2, 5.6);
    lampPost(b, -2.4, 2.6, { light: true }); lampPost(b, 2.4, 9.6); lampPost(b, -11.4, -3.6); lampPost(b, 11.4, -3.6);
    // The events table under a small canopy
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(-9.6 + sx * 1.5, 1.3, 6.4 + sz * 1.1, 0.08, 2.6, 0.08, METAL);
    b.box(-9.6, 2.7, 6.4, 3.4, 0.1, 2.6, '#f1efe8'); b.cone(-9.6, 3.1, 6.4, 2.3, 0.8, '#f1efe8', { seg: 4, ry: PI / 4 });
    table(b, -9.6, 6.6, { w: 2.2, d: 0.9 }); b.box(-9.6, 1.12, 6.6, 0.5, 0.06, 0.36, WHITE);
    extra(b, 'ph-cenotaph-walker', 6.4, 3.4, -2.2, 'walk', { look: look('woman', 'office', 'navy', { accessories: ['handbag'] }) });
    return {
      spots: [
        landmark('walk', /walk|path|park|stroll/, 4.2, 4.6, -0.7),
        landmark('work', /work|desk|job|event|staff|shift/, -9.6, 5.6, 0, { act: { pose: 'work' } }),
        landmark('memorial', /memorial|statue|history|plinth|cenotaph/, 0, 1.8, PI),
        landmark('people', /people|crowd|meet/, -0.6, 7.6, 0),
      ],
      crowd: [[0.6, 5, 0.4], [-0.4, 10, -0.5], [6.4, 6.6, 2.6], [-5.4, 4.4, 1.2], [8.6, 9.4, -0.8], [-5.4, 9.6, 0.8], [5, 11, 2.8], [-3.6, 11.2, 2.4], [-8, -2.4, 1.6], [8.4, -2.4, -1.6], [-3, 1, 3.1], [10.6, 4.6, 0.6]],
      spare: [[-4, 6.8], [5, 8.6], [-3, 9.4], [2.6, 3]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Amusement park: a carousel, a small observation wheel, a bouncy castle and kiosks inside a painted fence.

function carousel(b: Batch, x: number, z: number): void {
  const horses: Colour[] = ['#f1efe8', '#8a5a36', '#2a2d33', '#d9b24c'];
  b.at(x, 0, z, 0, () => {
    b.cyl(0, 0.15, 0, 3.5, 0.3, '#c9423a', { seg: 14 }); b.disc(0, 0.31, 0, 3.3, '#e8d9b0', { seg: 14 });
    b.cyl(0, 2, 0, 0.8, 3.6, '#f2c14e', { seg: 8 }); for (let k = 0; k < 3; k++) b.cyl(0, 1 + k, 0, 0.84, 0.3, k % 2 ? '#2a6fb0' : '#c9423a', { seg: 8 });
    b.cyl(0, 3.9, 0, 3.7, 0.36, '#f2c14e', { seg: 14 }); b.cone(0, 4.95, 0, 3.8, 1.8, '#c9423a', { seg: 14 });
    for (let i = 0; i < 7; i++) b.at(0, 0, 0, (i / 7) * PI * 2, () => b.box(0, 5.0, 1.9, 0.6, 0.04, 4.1, WHITE, { rx: 0.44 }));
    b.ball(0, 6, 0, 0.25, 0.3, 0.25, '#f2c14e', { seg: 6 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * PI * 2, px = Math.sin(a) * 2.5, pz = Math.cos(a) * 2.5;
      b.cyl(px, 2.1, pz, 0.04, 3.6, '#f2c14e', { seg: 4 });
      b.at(px, 1.15 + (i % 2) * 0.35, pz, a + HALF, () => {
        b.ball(0, 0, 0, 0.22, 0.3, 0.55, horses[i % 4]!, { seg: 5 }); b.box(0, 0.4, 0.5, 0.16, 0.5, 0.2, horses[i % 4]!, { rx: 0.5 });
        for (const s of [-1, 1]) b.box(0, -0.45, s * 0.3, 0.08, 0.5, 0.08, horses[i % 4]!);
      });
    }
    for (let i = 0; i < 14; i++) { const a = (i / 14) * PI * 2; b.box(Math.sin(a) * 3.72, 3.9, Math.cos(a) * 3.72, 0.14, 0.14, 0.14, WARM, GLOW); }
  });
}
function wheel(b: Batch, x: number, z: number, R: number): void {
  const cars: Colour[] = ['#c9423a', '#f2c14e', '#2a6fb0', '#2f8f55', '#dd6fa0', '#e0822f'], hub = R + 1.4, N = 12;
  b.at(x, 0, z, 0, () => {
    for (const sz of [-1, 1]) for (const s of [-1, 1]) b.box(s * hub * 0.135, hub / 2, sz * 0.9, 0.26, hub + 0.4, 0.26, '#e8e4d8', { rz: s * 0.27 });
    b.cyl(0, hub, 0, 0.3, 2.2, '#c9423a', { seg: 8, rx: HALF });
    for (let i = 0; i < N; i++) {
      const a = (i / N) * PI * 2, mid = ((i + 0.5) / N) * PI * 2, gx = Math.sin(a) * R, gy = hub + Math.cos(a) * R;
      for (const sz of [-0.45, 0.45]) b.box(Math.sin(mid) * R * 0.966, hub + Math.cos(mid) * R * 0.966, sz, 2 * R * Math.sin(PI / N) + 0.05, 0.12, 0.12, i % 2 ? '#e9614b' : '#f2c14e', { rz: -mid });
      if (i < N / 2) b.box(0, hub, 0, 0.08, 2 * R, 0.08, '#e8e4d8', { rz: -a });
      b.box(gx, gy - 0.55, 0, 0.9, 0.7, 0.8, cars[i % 6]!); b.box(gx, gy - 0.12, 0, 1, 0.08, 0.9, '#f1efe8'); b.box(gx, gy, 0, 0.06, 0.06, 1, METAL);
      b.box(gx, gy + 0.14, 0.5, 0.14, 0.14, 0.14, WARM, GLOW);
    }
  });
}

const rides: SceneDef = {
  mood: 'outdoor', accent: '#e9614b', camera: view(3.5, [18, 25.5, 32], [22, 50, 65]), walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#c9bd9c', edge: '#8c8068' });
    for (const [x, z, w, d] of ([[-12.4, -9.4, 4.2, 6], [12.4, 9.6, 4.2, 5.6], [0, -11.6, 6, 2]] as [number, number, number, number][])) b.box(x, 0.03, z, w, 0.04, d, '#6aa056');
    carousel(b, -6.2, -1.4);
    wheel(b, 5.4, -8.8, 4.6);
    b.box(5.4, 0.15, -8.8, 5, 0.3, 3.4, '#8f8b7c'); fence(b, [2.6, -6.6], [8.2, -6.6], { h: 0.9, color: '#2a6fb0', gap: 1.1 });
    // The bouncy castle
    b.at(9.6, 0, 1.4, -0.3, () => {
      b.box(0, 0.4, 0, 4.4, 0.8, 3.8, '#c9423a'); b.box(0, 1.6, -1.7, 4.4, 1.8, 0.4, '#f2c14e');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.cyl(sx * 1.9, 1.5, sz * 1.6, 0.4, 2.2, sx * sz > 0 ? '#2a6fb0' : '#f2c14e', { seg: 7 }); b.cone(sx * 1.9, 3.0, sz * 1.6, 0.5, 0.8, '#c9423a', { seg: 7 }); }
      b.box(0, 2.5, 1.6, 3.6, 0.36, 0.36, '#2a6fb0');
    });
    // Kiosks, a balloon seller, the name board, bunting and the painted fence
    kiosk(b, -11.6, 6.4, { ry: HALF, color: '#f1efe8', roof: '#e9614b', fascia: '#f2c14e', text: 'TICKETS' });
    extra(b, 'ph-rides-tickets', -12, 6.4, HALF, 'work');
    kiosk(b, 0.4, -9.6, { w: 3, color: '#f2c14e', roof: '#2a6fb0', fascia: '#f1efe8', text: 'SNACKS' });
    b.cyl(11.4, 1.5, 6.4, 0.03, 3, METAL_DARK, { seg: 3 }); for (let i = 0; i < 6; i++) b.ball(11.4 + Math.sin(i * 1.05) * 0.4, 3.1 + (i % 3) * 0.34, 6.4 + Math.cos(i * 1.05) * 0.4, 0.26, 0.32, 0.26, ['#c9423a', '#f2c14e', '#2a6fb0', '#2f8f55', '#dd6fa0', '#8055c2'][i]!, { seg: 5 });
    extra(b, 'ph-rides-balloons', 10.8, 6.6, -0.8, 'stand', { look: look('man', 'casual', 'pink', { accessories: ['cap'] }) });
    signBoard(b, -6.4, 10.2, label, { y: 1.9, size: fit(label, 8.4, 0.38), color: WHITE, board: '#e9614b' });
    for (const [x, z] of ([[-13.6, 2.4], [-1.4, 4.2], [4, 3.6], [13.4, -4]] as [number, number][])) b.cyl(x, 2.4, z, 0.07, 4.8, '#2a6fb0', { seg: 5 });
    stringLights(b, [-13.6, 4.7, 2.4], [-1.4, 4.7, 4.2], { n: 10, colors: ['#ff8a5c', '#f2e24a', '#9fd8ff'] }); stringLights(b, [-1.4, 4.7, 4.2], [4, 4.7, 3.6], { n: 5, colors: ['#ff8a5c', '#f2e24a', '#9fd8ff'] }); stringLights(b, [4, 4.7, 3.6], [13.4, 4.7, -4], { n: 10, colors: ['#ff8a5c', '#f2e24a', '#9fd8ff'] });
    for (const [a, c] of ([[[-14.4, 12.4], [-3, 12.4]], [[3, 12.4], [14.4, 12.4]], [[-14.4, 12.4], [-14.4, -12.4]], [[14.4, 12.4], [14.4, -12.4]]] as [[number, number], [number, number]][])) fence(b, a, c, { h: 1, color: '#f2c14e', gap: 1.6 });
    bench(b, -2, 8.4, { w: 2.6, back: true, color: '#2a6fb0', leg: METAL_DARK }); bench(b, 5.6, 8.6, { w: 2.6, back: true, color: '#c9423a', leg: METAL_DARK });
    extra(b, 'ph-rides-parent', 5.6, 8.6, 0, 'sit', { seat: 0.6 }); extra(b, 'ph-rides-rider', -6.6, 2.8, PI, 'wave', { look: look('woman', 'casual', 'teal') });
    lampPost(b, -2.4, 0.6, { light: true }); lampPost(b, 11.4, -3.6);
    for (const [x, z, s, t] of ([[-12.6, -9.6, 1.1, 0], [12.8, 10, 0.9, 2], [-13, 10.4, 0.85, 1]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    return {
      spots: [
        landmark('rides', /ride|carousel|wheel|amuse|fun|game/, -1.6, 3, PI),
        landmark('tickets', /ticket|kiosk|pay|work|staff/, -8.6, 6.4, -HALF),
        landmark('people', /people|crowd|meet/, 2, 7, 0),
      ],
      crowd: [[2.4, 4.6, 0.4], [-3.4, 6.2, -0.5], [6.4, 5.4, 2.4], [-6.4, 8.6, 1.2], [8.6, 10, -0.8], [-9.4, 10.2, 0.8], [1.4, 10.4, 2.8], [-1.6, -5.6, 2.4], [0.4, -2, 1.6], [3.4, -3.6, -0.4], [0.2, 8.6, 3.1], [-10.6, 2.2, 0.6]],
      spare: [[-4, 5], [3.6, 6.4], [-2, 10.4], [2.6, 9.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Evening garden: an octagonal bandstand strung with lights, garden tables on the lawn, a sound table, a drinks kiosk.

function bandstand(b: Batch, x: number, z: number): void {
  b.at(x, 0, z, 0, () => {
    b.cyl(0, 0.3, 0, 3.5, 0.6, '#d8d2c2', { seg: 8, ry: PI / 8 }); b.cyl(0, 0.62, 0, 3.3, 0.06, '#b08a5c', { seg: 8, ry: PI / 8 });
    for (let i = 0; i < 8; i++) {
      const a = PI / 8 + (i / 8) * PI * 2, m = (i / 8) * PI * 2;
      b.cyl(Math.sin(a) * 3.15, 2.3, Math.cos(a) * 3.15, 0.1, 3.4, WHITE, { seg: 5 });
      if (i !== 0) { b.box(Math.sin(m) * 2.92, 1.5, Math.cos(m) * 2.92, 2.4, 0.08, 0.08, WHITE, { ry: m }); b.box(Math.sin(m) * 2.92, 1.05, Math.cos(m) * 2.92, 2.4, 0.6, 0.04, '#3d6a5c', { ry: m }); }
      b.box(Math.sin(m) * 2.95, 3.75, Math.cos(m) * 2.95, 2.5, 0.3, 0.05, '#f1eee4', { ry: m });
    }
    b.cyl(0, 4.1, 0, 3.9, 0.24, '#f1eee4', { seg: 8, ry: PI / 8 }); b.cone(0, 5.2, 0, 4, 2, '#3d6a5c', { seg: 8, ry: PI / 8 });
    b.cyl(0, 6.4, 0, 0.3, 0.5, '#f1eee4', { seg: 6 }); b.ball(0, 6.9, 0, 0.2, 0.3, 0.2, '#d9b24c', { seg: 5 });
    b.box(0, 0.15, 3.5, 2.2, 0.3, 0.8, '#d8d2c2'); b.box(0, 0.45, 3.2, 2.2, 0.3, 0.5, '#d8d2c2');
  });
}
function gardenTable(b: Batch, x: number, z: number, turn: number): void {
  table(b, x, z, { w: 1.5, round: true, h: 0.95, color: '#f1eee4', leg: '#3d6a5c' });
  b.cyl(x, 1.1, z, 0.1, 0.24, WARM, { seg: 5, ...GLOW });
  for (let i = 0; i < 3; i++) { const a = turn + i * 2.1; chair(b, x + Math.sin(a) * 1.25, z + Math.cos(a) * 1.25, { ry: a + PI, color: '#3d6a5c' }); }
}

const bandstandGarden: SceneDef = {
  mood: 'outdoor', accent: '#e8b04a', camera: view(2), walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#4f8a4c', edge: '#345f38' });
    b.box(0, 0.03, 7.4, 2.6, 0.04, 10.8, '#cbbf9f'); b.disc(-1, 0.05, -3.6, 6.4, '#cbbf9f', { seg: 20 }); b.box(-7, 0.03, 3.2, 9, 0.04, 2, '#cbbf9f', { ry: -0.3 });
    bandstand(b, -1, -4.4);
    b.light(-1, 3.4, -4.4, '#ffd9a0', 30, 13);
    extra(b, 'ph-bandstand-singer', -1.2, -3.2, 0.1, 'wave', { y: 0.65, look: look('woman', 'gown', 'gold') });
    extra(b, 'ph-bandstand-player', 0.6, -5, -0.4, 'stand', { y: 0.65, look: look('man', 'kaftan', 'teal') });
    b.box(-2.6, 1.6, -5.4, 1.5, 0.14, 0.5, '#22262b'); for (const s of [-1, 1]) b.box(-2.6 + s * 0.5, 1.1, -5.4, 0.06, 0.95, 0.06, METAL_DARK, { rz: s * 0.3 });
    b.cyl(-1.2, 1.5, -2.4, 0.03, 1.7, METAL_DARK, { seg: 3 });
    speaker(b, -5.4, -1.2, { h: 1.8, ry: 0.5 }); speaker(b, 3.4, -1.4, { h: 1.8, ry: -0.5 });
    // Lights strung from the bandstand out to poles round the lawn
    for (const [x, z] of ([[-10.6, 0.6], [-6.6, 7], [5.4, 6.4], [9.6, -0.6], [-9.6, -9.4], [8, -9.6]] as [number, number][])) {
      b.cyl(x, 2.1, z, 0.07, 4.2, '#3d444b', { seg: 5 });
      stringLights(b, [-1 + Math.sign(x + 1) * 2.6, 4, -4.4 + (z > -4.4 ? 2 : -2)], [x, 4.2, z], { n: 7, sag: 0.4, colors: [WARM, '#ffb86a', '#fff0c4'] });
    }
    // Tables on the lawn, the sound table, the drinks kiosk
    gardenTable(b, -5.6, 4.6, 0.4); gardenTable(b, 3.6, 3.4, 1.2); gardenTable(b, -3.4, 9.4, 2); gardenTable(b, 11.4, 1.6, 0.8); gardenTable(b, -11.4, 9, 2.6);
    extra(b, 'ph-bandstand-guest-1', -5.6 + Math.sin(0.4) * 1.25, 4.6 + Math.cos(0.4) * 1.25, 0.4 + PI, 'sit', { seat: 0.6 });
    table(b, 6.4, -4.2, { w: 2.4, d: 1, color: '#2f3238', leg: METAL_DARK }); b.box(6, 1.12, -4.2, 0.9, 0.12, 0.6, '#3d444b'); laptop(b, 7, 1.05, -4.2, { ry: PI });
    kiosk(b, -11.6, -3.4, { ry: HALF, color: '#3d6a5c', roof: '#27463c', fascia: '#e8b04a', text: 'DRINKS', textColor: '#27323a' });
    extra(b, 'ph-bandstand-barman', -12, -3.4, HALF, 'work');
    // Hedges, flower beds, frangipani and palms round the edge; the name on a low wall by the path
    for (const [x, z, w, d] of ([[-8.4, 12, 11, 0.7], [8.4, 12, 11, 0.7], [14, 2, 0.7, 19], [-14, 4, 0.7, 15]] as [number, number, number, number][])) b.box(x, 0.45, z, w, 0.9, d, '#2f6f44');
    for (const [x, z, c] of ([[4.6, 10.6, '#dd6fa0'], [-7.4, -0.4, '#f2c14e'], [12.4, 6.6, '#dd6fa0'], [1.6, -10.6, '#f4f1e6'], [12.2, -5.4, '#f2c14e']] as [number, number, Colour][])) { bush(b, x, z, { s: 0.9, color: '#3f8a57' }); for (let i = 0; i < 4; i++) b.ball(x - 0.4 + i * 0.3, 0.86 + (i % 2) * 0.1, z + 0.2, 0.12, 0.12, 0.12, c, { seg: 4 }); }
    for (const [x, z, s, t] of ([[-12.8, -9.8, 1.2, 0], [12.6, -10, 1.15, 1], [13, 10, 0.9, 2], [-5.4, -11.4, 1, 2], [4.8, -11.6, 1, 0]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    royalPalm(b, -2.4, 11, 5.4); royalPalm(b, 2.4, 11, 5.4);
    b.box(5.6, 0.5, 8.6, 6, 1, 0.4, '#d8d2c2', { ry: -0.2 }); b.at(5.6, 0, 8.6, -0.2, () => sign(b, 0, 0.52, 0.22, label, { size: fit(label, 5.4, 0.3), color: '#27463c' }));
    lampPost(b, 2.2, 6.6, { light: true }); lampPost(b, -9, 6);
    return {
      spots: [
        landmark('stage', /stage|band|music|set|listen|show|perform/, -1, 1.4, PI),
        landmark('work', /work|sound|desk|job|shift|staff/, 6.4, -3, PI, { act: { pose: 'work' } }),
        landmark('drinks', /drink|kiosk|bar/, -8.6, -3.4, -HALF),
        landmark('people', /people|crowd|meet/, 0.6, 5.6, 0),
      ],
      crowd: [[1.4, 2.6, 2.9], [-3.4, 1.6, 2.6], [1.6, 8, -0.5], [-8.6, 2, 2.2], [7.4, 0.4, -2.4], [-1.4, 6.4, 3], [6.4, 9.8, 2.8], [-7.4, 8, 2.4], [8.6, -2.2, 1.6], [-8.4, -6.4, 1], [3.4, -0.4, 3.1], [-5.6, 0.6, 2.4]],
      spare: [[-3, 4], [2, 5.4], [-1, 8.4], [5, 1]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Markets.

const GOODS: readonly Colour[] = ['#d9482f', '#e8a13a', '#5f9a48', '#3f72c4', '#dd6fa0', '#f0e2c0', '#8055c2', '#2f9d98'];
const UMBRELLAS: readonly Colour[] = ['#e9614b', '#2f8f55', '#f2c14e', '#3f72c4', '#dd6fa0', '#e0822f', '#2f9d98', '#8055c2'];

/** A trader's pitch: an umbrella over a low table of heaped goods. */
function pitchUnder(b: Batch, x: number, z: number, i: number): void {
  parasol(b, x, z, { colors: [UMBRELLAS[i % 8]!, i % 3 ? WHITE : '#f0e2c0'], r: 1.6, h: 2.7 });
  b.box(x + 0.3, 0.3, z + 0.7, 1.7, 0.6, 0.9, WOOD);
  for (let k = 0; k < 2; k++) b.ico(x - 0.1 + k * 0.8, 0.74, z + 0.7, 0.36, 0.22, 0.34, GOODS[(i * 3 + k * 2) % 8]!);
}
/** An enamel basin of produce. */
function basin(b: Batch, x: number, y: number, z: number, fill: Colour, r = 0.36): void {
  b.cyl(x, y + 0.11, z, r, 0.22, '#e8e4d8', { seg: 7, top: 1.25 }); b.ico(x, y + 0.26, z, r * 0.95, 0.16, r * 0.95, fill);
}
/** A filled sack standing open. */
function sack(b: Batch, x: number, z: number, grain: Colour): void {
  b.cyl(x, 0.4, z, 0.34, 0.8, '#d9cdaa', { seg: 6, top: 1.1 }); b.cyl(x, 0.82, z, 0.33, 0.06, grain, { seg: 6 });
}

/** The modern market block: three floors of shops behind open galleries, a stair hall in the middle, a busy forecourt. */
const marketBlock: SceneDef = {
  mood: 'outdoor', accent: '#e0822f', camera: view(3.5, [16.4, 23.4, 29.6], [21, 48, 62]), walk: OPEN,
  build(b, context) {
    const W = 27, FH = 2.8;
    ground(b, { w: 30, d: 26, color: '#c9bfa6', edge: '#8f8672' });
    b.box(0, 0.05, -6.4, 28, 0.06, 0.5, '#6d6a62');
    // The block: shops open on to a gallery on every floor, columns up the front, a sheet roof behind a parapet
    b.box(0, FH * 1.5, -11, W, FH * 3, 4, '#ece4cf');
    for (let f = 0; f < 3; f++) {
      const y = f * FH;
      b.box(0, y + FH - 0.12, -8.3, W + 0.4, 0.24, 1.7, '#d8cdb0');
      if (f) for (const dy of [0.5, 0.95]) b.box(0, y + dy, -7.6, W, 0.06, 0.06, '#2f6f8f');
      for (let i = 0; i < 10; i++) {
        const x = -W / 2 + (i + 0.5) * (W / 10);
        if (Math.abs(x) < 2) continue;
        b.box(x, y + 1.2, -8.98, 2.1, 2, 0.06, '#2b2620'); b.box(x, y + 2.36, -8.94, 2.2, 0.26, 0.08, GOODS[(i + f * 3) % 8]!);
        b.box(x - 0.5, y + 0.6, -8.72, 0.8, 1, 0.4, GOODS[(i * 3 + f) % 8]!); b.box(x + 0.55, y + 0.45, -8.72, 0.7, 0.7, 0.4, GOODS[(i + f + 4) % 8]!);
      }
    }
    for (let i = 0; i <= 10; i++) b.box(-W / 2 + (i * W) / 10, FH * 1.5, -7.6, 0.3, FH * 3, 0.3, '#f4eedd');
    b.box(0, FH * 3 + 0.3, -7.6, W + 0.4, 0.6, 0.3, '#f4eedd');
    for (const s of [-1, 1]) zincRoof(b, s * 7.6, FH * 3 + 0.1, -11, 11.6, 4.4, s > 0 ? 0 : 2, 0.24);
    // The stair hall: a taller bay with a glazed slot and the way in
    b.box(0, 5.4, -8.6, 3.8, 10.8, 3, '#e0822f'); b.box(0, 11, -8.6, 4.4, 0.4, 3.6, '#f4eedd'); b.box(0, 6.6, -7.08, 1.2, 6, 0.06, '#7fb0c9', GLASS);
    b.box(0, 1.6, -7.06, 2.4, 3.2, 0.08, '#2b2620');
    labelled(b, context.label, -7.6, FH * 3 + 1.1, -7.5, 10.4, 0.5, WHITE, '#2f6f8f', true);
    // A lower wing down the left side
    block(b, -13, -2.8, 3, 7.6, 2, '#ece4cf', { fh: 2.8, glass: '#2b2620', band: '#d8cdb0' }); zincRoof(b, -13, 5.7, -2.8, 8, 3.4, 1, 0.26, HALF);
    b.box(-10.9, 2.5, -2.8, 1.4, 0.08, 7.4, '#e0822f', { rz: -0.16 });
    // The forecourt: traders under umbrellas, a rank of tricycles, a bus, porters with barrows
    ([[-7, -3.4], [-3.6, -4], [5.4, -3.6], [9, -4], [-8, 1.4], [8.4, 0.6], [5.6, 3.6], [-9.6, 5.6]] as [number, number][]).forEach(([x, z], i) => pitchUnder(b, x, z, i));
    for (let i = 0; i < 3; i++) keke(b, 12.4, 4.4 + i * 2.5, -HALF - 0.2);
    bus(b, -11.4, 9.6, HALF + 0.2, '#f1efe8', '#2a6fb0');
    barrow(b, 2.6, 0.4, 0.8, '#e8a13a'); barrow(b, -4.4, 2.6, 2.4);
    for (const [x, z, c] of ([[2.4, 6, '#d9cdaa'], [3.1, 6.3, '#cdbf99'], [-2.6, -1.6, '#d9cdaa']] as [number, number, Colour][])) b.ball(x, 0.42, z, 0.4, 0.5, 0.36, c, { seg: 6 });
    crate(b, 9.4, 0, 5.6, { fill: '#d9482f' }); crate(b, 9.4, 0, 6.5, { fill: '#5f9a48' });
    extra(b, 'ph-block-trader', -7.4, -2.2, 0.3, 'sit', { seat: 0.4, look: TRADER('orange') });
    extra(b, 'ph-block-porter', 3.2, -0.8, 0.8, 'walk', { look: look('man', 'chill', 'green') });
    extra(b, 'ph-block-shopper', -1.4, 2.4, 2.6, 'walk', { look: look('woman', 'casual', 'violet', { accessories: ['handbag'] }) });
    extra(b, 'ph-block-seller', 6.4, 4.8, -0.4, 'work', { look: TRADER('teal') });
    lampPost(b, 0.6, 6.6, { light: true }); lampPost(b, -12.6, 3);
    return {
      spots: [
        landmark('aisle', /aisle|market|price|shop|row|block/, 2.6, -5, PI),
        landmark('work', /work|stall|sell|job|shift|trade/, -4.6, 5.6, 0, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 1.4, 8.6, 0),
      ],
      crowd: [[3.6, 8.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 8.6, 2.4], [-6, 8.6, 1.2], [5.6, 10.8, -0.8], [-6.4, 11, 0.8], [2.4, 11, 2.8], [-2.6, 10.6, 2.4], [-1.4, -5.4, 2.9], [6.6, -5.6, 2.6], [-6.6, -5.6, 3.1], [0.4, 3.6, 0.6]],
      spare: [[-4, 8.6], [4, 6.4], [-1, 9.6], [2.6, 3]],
    };
  },
};

function plankStack(b: Batch, x: number, z: number, len: number, n: number, ry = 0): void {
  const tones: Colour[] = ['#c9a36a', '#b98d54', '#d6b47c'];
  b.at(x, 0, z, ry, () => {
    for (let i = 0; i < n; i++) b.box((i % 2) * 0.12, 0.14 + i * 0.2, 0, len, 0.16, 1.2 - (i % 3) * 0.1, tones[i % 3]!);
    for (const s of [-1, 1]) b.box(s * len * 0.3, 0.03, 0, 0.2, 0.06, 1.4, WOOD_DARK);
  });
}
/** Planks stood on end against both sides of a rail. */
function leaningPlanks(b: Batch, x: number, z: number, w: number, h = 3.8): void {
  const tones: Colour[] = ['#c9a36a', '#b98d54', '#d6b47c', '#a87c48'];
  for (const s of [-1, 1]) b.box(x + s * (w / 2), h * 0.42, z, 0.14, h * 0.84, 0.14, WOOD_DARK);
  b.box(x, h * 0.8, z, w + 0.3, 0.14, 0.14, WOOD_DARK);
  for (let i = 0; i < Math.floor(w / 0.34); i++) { const side = i % 2 ? 1 : -1; b.box(x - w / 2 + 0.2 + i * 0.34, h * 0.45, z + side * 0.52, 0.26, h * (0.9 + (i % 3) * 0.05), 0.07, tones[i % 4]!, { rx: -side * 0.26 }); }
}
/** A row of foodstuff under a low sheet roof: a long table of basins, open sacks in front, plantain hung from the beam. */
function foodRow(b: Batch, x: number, z: number, w: number, tone: number, rand: Rand): void {
  const fills: Colour[] = ['#c9372c', '#d9482f', '#4f8a3c', '#e3c24a', '#f1ead6', '#8a5a36', '#e08a6a', '#6f9a3c'];
  openShed(b, x, z, w, 3.2, 2.7, tone, OLD_ZINC);
  b.box(x, 0.5, z + 0.3, w - 0.8, 1, 1.5, WOOD); b.box(x, 1.03, z + 0.3, w - 0.6, 0.06, 1.7, WOOD_LIGHT);
  const n = Math.floor((w - 1) / 0.85);
  for (let i = 0; i < n; i++) basin(b, x - (w - 1.4) / 2 + i * ((w - 1.4) / (n - 1)), 1.06, z + 0.3 + (i % 2) * 0.3 - 0.15, fills[Math.floor(rand() * fills.length)]!);
  for (let i = 0; i < Math.floor(w / 1.5); i++) sack(b, x - w / 2 + 0.9 + i * 1.5, z + 1.9, ['#f1ead6', '#e3c24a', '#8a5a36', '#c9a36a'][i % 4]!);
  for (let i = 0; i < 3; i++) { const px = x - w / 2 + 1.2 + i * ((w - 2.4) / 2); b.box(px, 2.3, z + 1.3, 0.34, 0.7, 0.3, i % 2 ? '#d9b24c' : '#7c9b3c'); b.box(px, 2.75, z + 1.3, 0.04, 0.3, 0.04, WOOD_DARK); }
}

/** Rows of timber and of foodstuff either side of a worn aisle. */
const marketRows: SceneDef = {
  mood: 'outdoor', accent: '#c9a36a', walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(89);
    ground(b, { w: 30, d: 26, color: '#b99a6a', edge: '#8a6f48' });
    b.box(0.2, 0.03, 0.6, 3.6, 0.04, 24.6, '#c9ad7c');
    // Timber on the left: stacked planks under a tall open shed, planks stood on end along two rails, logs, a saw bench
    openShed(b, -9, -8.2, 9.4, 6, 4.4, 0, OLD_ZINC);
    plankStack(b, -10.8, -9, 5.4, 8); plankStack(b, -7.4, -7, 4.8, 6, 0.08); plankStack(b, -10.6, -6.4, 3.6, 4, -0.1);
    leaningPlanks(b, -8.6, -1.6, 7.4); leaningPlanks(b, -9.4, 3.4, 6.4, 3.4);
    for (let i = 0; i < 3; i++) b.cyl(-12.6 + i * 0.2, 0.4 + (i === 2 ? 0.62 : 0), 7.6 + (i === 2 ? 0.4 : i * 0.8), 0.4, 4.4, i % 2 ? '#7a5636' : '#8a6644', { seg: 7, rz: HALF });
    plankStack(b, -7.6, 8.2, 4.4, 4, 0.2);
    table(b, -3.6, -3.8, { w: 2.4, d: 1, h: 0.95, color: WOOD_LIGHT }); b.cyl(-3.6, 1.1, -3.8, 0.5, 0.04, '#c9cdd0', { seg: 10, rz: HALF });
    for (const [x, z] of ([[-4.4, -2.6], [-2.6, -5.2], [-5.6, 5.8]] as [number, number][])) b.ico(x, 0.16, z, 0.6, 0.2, 0.5, '#d9c08c');
    extra(b, 'ph-rows-sawyer', -3.6, -4.9, 0, 'work', { look: look('man', 'sitework', 'navy') });
    extra(b, 'ph-rows-timber', -5.2, 1.2, HALF, 'stand', { look: look('man', 'chill', 'cream') });
    // Foodstuff on the right: three rows of tables under low roofs, then traders on the ground
    foodRow(b, 8.2, -9.4, 10.4, 1, rand); foodRow(b, 8.6, -3.6, 9.6, 3, rand); foodRow(b, 9.2, 2.2, 8.4, 0, rand);
    for (const [x, z, c] of ([[4.6, 7.6, '#c9372c'], [5.6, 8.2, '#4f8a3c'], [4.8, 8.9, '#e3c24a']] as [number, number, Colour][])) basin(b, x, 0, z, c, 0.5);
    parasol(b, 5.2, 7.4, { colors: ['#2f8f55', '#f0e2c0'], r: 1.7 });
    for (let i = 0; i < 6; i++) b.cyl(9.6 + (i % 3) * 0.5, 0.3, 8 + Math.floor(i / 3) * 0.5, 0.2, 0.6, '#e8b820', { seg: 6 });
    for (let i = 0; i < 7; i++) b.ball(11.8 + (i % 3) * 0.4, 0.2 + Math.floor(i / 3) * 0.24, 8.4 + (i % 2) * 0.4, 0.2, 0.2, 0.5, '#a67c4a', { seg: 5, ry: i });
    extra(b, 'ph-rows-trader-1', 6.6, -2.6, PI, 'work', { look: TRADER('green') });
    extra(b, 'ph-rows-trader-2', 6.2, 7.6, -0.6, 'sit', { seat: 0.4, look: TRADER('pink') });
    barrow(b, 1, -6, 0.3, '#a67c4a');
    signBoard(b, -5.6, 10.6, label, { y: 2.2, size: fit(label, 7, 0.38), color: WHITE, board: '#6a4a30' });
    lampPost(b, 2.6, 4.6, { light: true });
    leafTree(b, 13.4, 11, { s: 0.9, tone: 2 }); leafTree(b, -13.4, 11.4, { s: 0.85, tone: 0 });
    return {
      spots: [
        landmark('aisle', /aisle|market|price|compare|row|food/, 0.4, 2.6, PI),
        landmark('work', /work|stall|sell|job|shift|trade/, 3.2, -1.2, HALF, { act: { pose: 'work' } }),
        landmark('timber', /timber|plank|wood|saw/, -3.6, 1, -HALF),
        landmark('people', /people|crowd|meet/, 1, 8.6, 0),
      ],
      crowd: [[1.6, 6.4, 0.4], [-1.6, 9.6, -0.5], [2.4, 10.8, 2.4], [-3.4, 7.4, 1.2], [0.6, -2.4, 2.8], [-0.8, -6.4, 0.8], [3.4, 5, 2.8], [-1.2, 4.6, 2.4], [1.4, -9.8, 1.6], [8.6, 5.8, 3], [-4.6, 10.6, 3.1], [3, 0.6, 0.6]],
      spare: [[-1.4, 6.8], [1.6, 8.6], [-0.6, 11], [2.6, 3]],
    };
  },
};

/** A rail of second-hand clothes. */
function clothesRail(b: Batch, x: number, z: number, ry: number, w = 3): void {
  b.at(x, 0, z, ry, () => {
    for (const s of [-1, 1]) b.box(s * (w / 2), 1.05, 0, 0.08, 2.1, 0.08, METAL_DARK);
    b.box(0, 2.05, 0, w + 0.1, 0.06, 0.06, METAL_DARK);
    for (let i = 0; i < Math.floor(w / 0.42); i++) b.box(-w / 2 + 0.3 + i * 0.42, 1.4 - (i % 3) * 0.1, 0, 0.34, 1.1 + (i % 3) * 0.2, 0.1, GOODS[(i * 3 + Math.abs(Math.round(x))) % 8]!);
  });
}

/** The junction market: stalls, umbrellas and rails of clothes along both roads of a junction, traffic pushing through. */
const marketJunction: SceneDef = {
  mood: 'outdoor', accent: '#f08a3c', walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#b5a583', edge: '#857858' });
    // The two roads: the main road across the back, the side road coming down to the front
    b.box(0, 0.03, -5.6, 30, 0.04, 5.4, ASPHALT); b.box(6, 0.03, 5, 5, 0.04, 16.2, ASPHALT);
    for (let i = 0; i < 10; i++) b.box(-13.4 + i * 3, 0.06, -5.6, 1.5, 0.02, 0.14, '#e6dfc8');
    for (let i = 0; i < 5; i++) b.box(6, 0.06, -1 + i * 3, 0.14, 0.02, 1.5, '#e6dfc8');
    // Lock-up shops under sheet roofs on the far side of the main road, trees behind
    for (const [x, w, t] of ([[-8, 12, 0], [7.6, 11, 2]] as [number, number, number][])) {
      b.box(x, 1.5, -11.2, w, 3, 3, '#d8ceb4'); zincRoof(b, x, 3, -11, w + 0.3, 4.2, t, 0.3, 0, OLD_ZINC);
      for (let i = 0; i < Math.floor(w / 2); i++) { b.box(x - w / 2 + 1 + i * 2, 1.2, -9.67, 1.5, 2.2, 0.06, i % 3 ? '#2b2620' : '#4a6a7a'); b.box(x - w / 2 + 1 + i * 2, 0.5, -9.4, 1.1, 0.8, 0.4, GOODS[(i * 3 + t) % 8]!); }
    }
    for (const x of [-13, -1, 13.6]) leafTree(b, x, -12.4, { s: 1.1, tone: Math.abs(Math.round(x)) });
    // Traffic: a bus loading at the corner, a lorry of sacks, tricycles
    bus(b, -3.6, -4.4, HALF, '#f1efe8', '#2a6fb0'); keke(b, -11, -6.8, -HALF); keke(b, 6.9, 6.4, PI); keke(b, 5, 0.4, 0.1);
    lorry(b, 9, -6.6, -HALF, '#2f8f55', (l) => { for (let i = 0; i < 6; i++) l.ball(-0.5 + (i % 2), 1.6 + Math.floor(i / 4) * 0.5, -2.6 + Math.floor(i / 2) * 1.4, 0.5, 0.36, 0.66, i % 2 ? '#d9cdaa' : '#cdbf99', { seg: 5 }); });
    // The market along the verges: umbrellas shoulder to shoulder, sheds, rails and heaps of clothes on tarpaulins
    ([[-12.6, -1.6], [-9.6, -1.8], [-6.6, -1.6], [-3.6, -1.9], [-0.4, -1.6], [2.2, 1.4], [2.4, 4.6], [10, 0.6], [10.2, 3.8], [10, 7], [12.6, -1.4], [-1.6, 5.6], [10.4, 10.2]] as [number, number][]).forEach(([x, z], i) => pitchUnder(b, x, z, i));
    openShed(b, -11, 3.4, 5.4, 3, 2.7, 0, OLD_ZINC); openShed(b, -11, 8.4, 5.4, 3, 2.7, 2, OLD_ZINC);
    for (const z of [3.6, 8.6]) { b.box(-11, 0.45, z, 4.6, 0.9, 1.3, WOOD); for (let i = 0; i < 5; i++) b.ico(-12.8 + i * 0.9, 1.06, z, 0.36, 0.22, 0.4, GOODS[(i + Math.round(z)) % 8]!); }
    clothesRail(b, -6, 2.4, 0.2, 3.2); clothesRail(b, -5.6, 6.4, -0.1, 3); clothesRail(b, 13, 6.4, HALF, 3);
    for (const [x, z, c] of ([[-4.6, 9.6, '#3f72c4'], [-7.4, 10.6, '#8a8f95']] as [number, number, Colour][])) { b.box(x, 0.05, z, 2.4, 0.03, 1.8, c, { ry: 0.2 }); for (let i = 0; i < 4; i++) b.ico(x - 0.6 + (i % 2) * 1.1, 0.28, z - 0.4 + Math.floor(i / 2) * 0.7, 0.5, 0.26, 0.4, GOODS[(i * 3 + Math.round(x) + 9) % 8]!); }
    barrow(b, 1.4, 8.2, 2.6, '#5f9a48');
    extra(b, 'ph-junction-trader-1', -9.2, -0.6, 0.2, 'sit', { seat: 0.4, look: TRADER('orange') });
    extra(b, 'ph-junction-trader-2', -7.6, 4, HALF, 'work', { look: TRADER('violet') });
    extra(b, 'ph-junction-shopper', -2.6, 2.6, -1.2, 'walk', { look: look('woman', 'casual', 'teal', { accessories: ['handbag'] }) });
    extra(b, 'ph-junction-conductor', -1.6, -3.6, 0.4, 'wave', { look: look('man', 'chill', 'red') });
    // The junction's sign
    b.box(2.4, 2.4, -2.2, 0.16, 4.8, 0.16, METAL_DARK); b.box(2.4, 4.3, -2.2, 0.1, 0.9, 0.1, METAL_DARK);
    labelled(b, label, 0.2, 4.4, -2.1, 5, 0.34, WHITE, '#2f6f4f', false);
    lampPost(b, 2.8, 9.6, { light: true, h: 5 }); lampPost(b, -13.4, -2.4, { h: 5 });
    return {
      spots: [
        landmark('aisle', /aisle|market|price|row|junction/, -2.4, 3.4, PI),
        landmark('work', /work|stall|sell|job|shift|trade/, -7.6, 5.6, -HALF, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, -0.6, 9, 0),
      ],
      crowd: [[0.6, 7.4, 0.4], [-3, 7.6, -0.5], [0.4, 10.6, 2.4], [-2.4, 10.8, 1.2], [6, 9.6, -0.8], [5.4, 3.6, 0.8], [1.6, 11.4, 2.8], [-4.2, 4.4, 2.4], [-8.4, 0.8, 1.6], [7.6, -2, -0.4], [-4.6, -0.2, 3.1], [-9.4, 6, 0.6]],
      spare: [[-3, 6], [0.6, 5], [-1.6, 11], [1, 9.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Creek waterside: sand on a tidal creek, regatta canoes drawn up on it and one under way, mangrove on the far bank.

/** A long regatta canoe in painted colours; with `crew`, its paddlers sit two abreast. */
function regattaCanoe(b: Batch, x: number, y: number, z: number, ry: number, len: number, c1: Colour, c2: Colour, crew = false): void {
  b.at(x, y, z, ry, () => {
    b.ball(0, 0.22, 0, 0.64, 0.38, len / 2, c1, { seg: 6 }); b.ball(0, 0.4, 0, 0.48, 0.16, len / 2 - 0.3, '#3d2c1c', { seg: 6 });
    for (const s of [-1, 1]) b.box(s * 0.56, 0.44, 0, 0.07, 0.14, len * 0.72, c2);
    const n = Math.floor(len / 1.15);
    for (let i = 0; i < n; i++) {
      const tz = -len * 0.34 + (i * len * 0.68) / (n - 1);
      b.box(0, 0.5, tz, 1, 0.06, 0.2, c2);
      if (crew) for (const s of [-1, 1]) { b.ball(s * 0.28, 0.95, tz, 0.18, 0.34, 0.18, i % 2 ? c1 : c2, { seg: 4 }); b.ball(s * 0.28, 1.4, tz, 0.13, 0.14, 0.13, '#5a3a28', { seg: 4 }); b.box(s * 0.66, 0.8, tz + 0.2, 0.05, 1.3, 0.14, WOOD_LIGHT, { rz: -s * 0.3 }); }
      else if (i % 2) b.box(0.1, 0.57, tz, 0.1, 0.05, 1.5, WOOD_LIGHT, { ry: 0.5 });
    }
    b.box(0, 1.2, -len / 2 + 0.4, 0.06, 1.8, 0.06, WOOD_DARK); b.box(0.32, 1.9, -len / 2 + 0.4, 0.6, 0.36, 0.03, c2);
    b.box(0, 0.9, len / 2 - 0.4, 0.06, 1.1, 0.06, WOOD_DARK); b.box(0.24, 1.3, len / 2 - 0.4, 0.44, 0.26, 0.03, c1);
  });
}

const creekBeach: SceneDef = {
  mood: 'outdoor', accent: '#e9614b',
  walk: { bounds: [-14.2, 2.4, 14.2, 12.2], entrance: [0, 11.2], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(97);
    b.box(0, -0.4, 6.4, 31, 0.7, 14.4, '#b9a474'); b.box(0, -0.02, 6.6, 30, 0.1, 13.2, '#e2cf9c'); b.box(0, -0.06, 0.4, 30, 0.1, 2, '#bfa878');
    creek(b, rand, -15, -0.2, -0.32, 7);
    mangroveBank(b, rand, -15, -0.4, -30, 30, 3.6);
    // Regatta canoes: three drawn up on the sand, one under way with its crew, a small dug-out
    regattaCanoe(b, -8, 0, 0.8, 0.5, 8.4, '#c9423a', '#f1efe8');
    regattaCanoe(b, -1.6, 0, 0.4, 0.35, 8.8, '#2a6fb0', '#f2c14e');
    regattaCanoe(b, 6.4, 0, 0.6, -0.3, 8.4, '#2f8f55', '#f1efe8');
    regattaCanoe(b, 2, -0.3, -8.2, HALF + 0.12, 9.6, '#f2c14e', '#c9423a', true);
    canoe(b, -11, -0.3, -5.4, 1.1); canoe(b, 12.4, -0.3, -3.6, -0.6, 3.8, '#7a5a3a');
    // On the sand: a round pavilion, a viewing stand of two tiers, a board, palms and bunting
    b.at(-10.6, 0, 7, 0, () => {
      for (let i = 0; i < 6; i++) b.cyl(Math.sin(i * 1.047) * 2.2, 1.4, Math.cos(i * 1.047) * 2.2, 0.1, 2.8, WOOD_DARK, { seg: 5 });
      b.cone(0, 3.6, 0, 3.2, 1.8, '#b99746', { seg: 10 }); b.cyl(0, 2.76, 0, 3.2, 0.12, '#a8853c', { seg: 10 });
      b.cyl(0, 0.3, 0, 1.6, 0.14, WOOD, { seg: 10 }); b.cyl(0, 0.15, 0, 0.14, 0.3, WOOD_DARK, { seg: 5 });
    });
    for (let i = 0; i < 2; i++) { b.box(10.6, 0.3 + i * 0.3, 6.6 + i * 0.9, 5.4, 0.6 + i * 0.6, 0.9, '#cfc6ae'); b.box(10.6, 0.65 + i * 0.6, 6.6 + i * 0.9, 5.2, 0.1, 0.6, i ? '#2a6fb0' : '#e9614b'); }
    extra(b, 'ph-creek-watcher', 9.6, 6.6, PI, 'sit', { seat: 0.7 });
    signBoard(b, 4.6, 9.4, label, { y: 1.9, size: fit(label, 6.6, 0.34), color: WHITE, board: '#2f6f8f' });
    for (const [x, z, s, lean, ry] of ([[-13, 3.6, 1.05, 0.14, 0.4], [13.2, 3.4, 1, 0.16, 3.4], [-5.4, 11.2, 0.9, 0.1, 2]] as [number, number, number, number, number][])) palm(b, x, z, { s, lean, ry });
    for (const [x, z] of ([[-13.6, 4.6], [-4, 4.4], [4, 4.6], [13.6, 4.8]] as [number, number][])) b.cyl(x, 1.8, z, 0.06, 3.6, WOOD_DARK, { seg: 4 });
    for (const [x0, x1] of ([[-13.6, -4], [-4, 4], [4, 13.6]] as [number, number][])) for (let i = 0; i < 9; i++) { const t = (i + 0.5) / 9, x = x0 + (x1 - x0) * t; b.box(x, 3.4 - 1.2 * t * (1 - t), 4.5 + (x1 - x0) * t * 0.012, 0.3, 0.36, 0.03, GOODS[(i + Math.abs(Math.round(x0))) % 8]!); }
    // A drum for the regatta, mats, a storyteller and walkers
    b.cyl(-6.4, 0.45, 5.6, 0.4, 0.9, '#6a3f27', { seg: 8, top: 0.8 }); b.disc(-6.4, 0.91, 5.6, 0.32, '#e8d9b0', { seg: 8 });
    b.box(0.6, 0.05, 6.2, 1.6, 0.03, 2.4, '#3f72c4', { ry: 0.3 });
    extra(b, 'ph-creek-teller', -4.6, 5.8, 1.2, 'wave', { look: look('man', 'kaftan', 'cream') });
    extra(b, 'ph-creek-walker', 8.4, 3.6, -HALF, 'walk', { look: look('woman', 'casual', 'pink') });
    lampPost(b, -1.6, 8.4, { light: true });
    return {
      spots: [
        landmark('shore', /shore|water|creek|walk|front|edge|regatta/, 2.4, 3.2, PI),
        landmark('pavilion', /pavilion|shade|sit|rest/, -8, 8.6, -HALF),
        landmark('people', /people|crowd|meet/, 1, 8, 0),
      ],
      crowd: [[4.6, 6.4, 0.4], [-2.4, 7.4, -0.5], [6.4, 10.6, 2.4], [-6.4, 9.6, 1.2], [8.6, 10.4, -0.8], [-2.6, 10.4, 0.8], [2.4, 10.6, 2.8], [-1.6, 3.4, 2.9], [11.6, 3.6, 2.6], [-10.4, 3.4, 3], [5.6, 3.2, 3.1], [-5.6, 3.6, 2.6]],
      spare: [[-3, 6], [3, 6.4], [-1, 9.6], [2, 5]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Waterside landings.

/** Life jackets hung in a row on a rail. */
function jacketRail(b: Batch, x: number, z: number, n: number, ry = 0): void {
  b.at(x, 0, z, ry, () => {
    const w = n * 0.5;
    for (const s of [-1, 1]) b.box(s * (w / 2 + 0.1), 0.9, 0, 0.07, 1.8, 0.07, METAL_DARK);
    b.box(0, 1.75, 0, w + 0.3, 0.06, 0.06, METAL_DARK);
    for (let i = 0; i < n; i++) b.box(-w / 2 + 0.25 + i * 0.5, 1.35, 0, 0.4, 0.62, 0.16, i % 4 === 3 ? '#f2c14e' : '#f07a1e');
  });
}

/** The city terminal: a concrete jetty out into the creek, passenger boats on both sides, a ticket shed and a shelter. */
const terminal: SceneDef = {
  mood: 'outdoor', accent: '#f07a1e',
  walk: { bounds: [-14.2, -9.6, 14.2, 12.2], entrance: [0, 11.4], open: true, block: [[-15, -14, -2.1, 0.9], [2.1, -14, 15, 0.9]] },
  build(b, context) {
    const rand = seeded(101), wy = -0.9;
    // The quay and the jetty: concrete, tyre fenders along the edges, bollards, a low step at the end
    b.box(0, -0.7, 7, 31, 1.4, 12.6, '#8e8a7e'); b.box(0, -0.02, 7, 30, 0.1, 12, '#b9b4a6');
    b.box(0, -0.7, -4.4, 4.4, 1.4, 10.8, '#a9a496'); b.box(0, -0.02, -4.4, 4.2, 0.1, 10.6, '#c4bfb0');
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) { b.cyl(s * 2.24, -0.5, -0.8 - i * 2, 0.34, 0.2, BLACK, { seg: 7, rz: HALF }); b.cyl(s * 1.8, 0.14, -0.8 - i * 2, 0.16, 0.26, '#e0c23a', { seg: 6 }); }
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) b.cyl(s * (4 + i * 2), -0.5, 0.96, 0.34, 0.2, BLACK, { seg: 7, rx: HALF });
    b.box(0, -0.45, -10.3, 2.6, 0.5, 1, '#a9a496');
    creek(b, rand, -34, 1, wy, 8); mangroveBank(b, rand, -30, wy - 0.1, -40, 40, 4.4, true);
    // Boats: fibre speedboats and wooden boats alongside, one speedboat leaving
    speedboat(b, -3.3, wy, -2, 0, '#2a6fb0'); speedboat(b, -3.3, wy, -6.8, 0, '#c9423a', true);
    woodenBoat(b, 3.5, wy, -2.8, 0, 6.4, '#2f8f55'); speedboat(b, 3.3, wy, -7.8, 0.1, '#2f8f55');
    speedboat(b, -9.6, wy, -6.4, -1.1, '#e0822f', true); woodenBoat(b, 10.6, wy, -4.6, 0.9, 6, '#2a6fb0'); woodenBoat(b, 8.4, wy, -0.4, HALF, 5.6, '#c9423a');
    canoe(b, -8, wy, -0.4, HALF + 0.1);
    extra(b, 'ph-terminal-boatman', -3.3, -2.4, 0.2, 'stand', { y: wy + 0.6, look: look('man', 'chill', 'orange') });
    // The ticket shed with the name over it, life jackets on rails by the jetty's head
    b.box(-8.8, 1.6, 5, 5.4, 3.2, 3.2, '#e8e4d8'); b.box(-8.8, 0.6, 5.02, 5.44, 1.2, 3.24, '#2f6f8f'); zincRoof(b, -8.8, 3.2, 5, 5.8, 4, 0, 0.3);
    b.box(-8.8, 1.9, 6.62, 2.2, 1, 0.06, '#27323a'); b.box(-8.8, 1.36, 6.8, 2.6, 0.1, 0.4, WOOD_LIGHT);
    sign(b, -8.8, 2.85, 6.64, 'TICKETS', { size: 0.26, color: WHITE, board: '#f07a1e', pad: 0.14 });
    for (const s of [-1, 1]) b.box(-8.8 + s * 3.2, 2.4, 7.2, 0.14, 4.8, 0.14, METAL_DARK);
    labelled(b, context.label, -8.8, 4.7, 7.24, 6.6, 0.34, WHITE, '#2f6f8f', true);
    jacketRail(b, 4.8, 2.2, 5); jacketRail(b, -4.6, 2.2, 4);
    // The waiting shelter, the storeyed waterside behind, cargo on the quay, a tricycle, a barrow
    openShed(b, 9.8, 8.6, 6.4, 3.2, 2.7, 1, ZINC, METAL_DARK);
    bench(b, 8.4, 8.4, { w: 2.8, back: true }); bench(b, 11.4, 8.4, { w: 2.8, back: true });
    extra(b, 'ph-terminal-wait', 11.4, 8.4, 0, 'sit', { seat: 0.6, look: look('woman', 'casual', 'teal', { accessories: ['headwrap'] }) });
    block(b, -13, 10, 3, 5, 2, '#d9cdb0', { fh: 2.8 }); zincRoof(b, -13, 5.6, 10, 5.4, 3.4, 2, 0.28, HALF);
    for (let i = 0; i < 6; i++) b.cyl(-13 + (i % 3) * 0.5, 0.3, 2 + Math.floor(i / 3) * 0.5, 0.2, 0.6, i % 2 ? '#e8b820' : '#2a6fb0', { seg: 6 });
    for (let i = 0; i < 4; i++) b.cyl(12.2 + (i % 2) * 0.8, 0.55, 2.2 + Math.floor(i / 2) * 0.8, 0.36, 1.1, i % 2 ? '#2a6fb0' : '#c9423a', { seg: 7 });
    crate(b, 7.4, 0, 4.4, { s: 0.9 }); crate(b, 8.4, 0, 4.6, { s: 0.8, fill: '#5f9a48' }); crate(b, 7.8, 0.54, 4.5, { s: 0.7, fill: '#e8a13a' });
    for (const [x, z] of ([[2.6, 5.6], [3.3, 5.9], [2.9, 5.2]] as [number, number][])) b.ball(x, 0.42, z, 0.4, 0.5, 0.36, '#d9cdaa', { seg: 6 });
    keke(b, -4.8, 10.2, HALF + 0.3); barrow(b, 4.6, 8.2, 1.2, '#d9cdaa');
    extra(b, 'ph-terminal-helper', -1.8, 2.8, 0.5, 'wave', { look: look('man', 'casual', 'orange', { accessories: ['cap'] }) });
    extra(b, 'ph-terminal-loader', 4.4, 6.6, -1, 'walk', { look: look('man', 'chill', 'navy') });
    lampPost(b, 1.6, 8.6, { light: true }); lampPost(b, -12.6, 4.4); lampPost(b, 13, 5);
    return {
      spots: [
        landmark('landing', /landing|ferry|jetty|boat|wait|water/, 0.6, -2.4, PI),
        landmark('tickets', /ticket|shed|pay|work|staff/, -8.8, 8.6, PI),
        landmark('people', /people|crowd|meet/, 0.6, 5.6, 0),
      ],
      crowd: [[1.6, 3.4, 0.4], [-2.4, 5.6, -0.5], [5.4, 10.6, 2.4], [-5.4, 7.6, 1.2], [-0.8, -5.4, 2.9], [-9.4, 11, 0.8], [1.4, 10.4, 2.8], [-1.6, 8.4, 2.4], [0.9, -8, 3.1], [-4.4, 4, 3.1], [10.4, 4.4, 3], [6.4, 2.6, 0.6]],
      spare: [[-3, 6], [3, 7.6], [-1, 9.6], [0.4, 3]],
    };
  },
};

/** A wooden house standing on stilts over the water, a plank walk leading to it. */
function stiltHouse(b: Batch, x: number, y: number, z: number, w: number, d: number, tone: number, wall: Colour): void {
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) b.cyl(x + sx * (w / 2 - 0.2), y + 0.9, z + sz * (d / 2 - 0.2), 0.09, 2.2, '#5a4a38', { seg: 4 });
  b.box(x, y + 1.9, z, w + 0.8, 0.14, d + 0.8, '#8a6e4a');
  b.box(x, y + 3.2, z, w, 2.5, d, wall); zincRoof(b, x, y + 4.45, z, w + 0.2, d + 0.5, tone, 0.34, 0, OLD_ZINC);
  b.box(x - w / 4, y + 3, z + d / 2 + 0.02, 0.8, 1.9, 0.05, '#3a2c22'); b.box(x + w / 4, y + 3.4, z + d / 2 + 0.02, 0.8, 0.8, 0.05, '#4f6a7a');
  for (let i = 0; i < 4; i++) b.box(x - w / 2 + 0.4 + (i * (w - 0.8)) / 3, y + 3.2, z + d / 2 + 0.03, 0.04, 2.5, 0.03, '#6a5a48');
}

/** The town pier: planks on timber piles, a few boats, houses on stilts beside it, nets drying on the shore. */
const pier: SceneDef = {
  mood: 'outdoor', accent: '#2f9d98',
  walk: { bounds: [-14.2, -8.8, 14.2, 12.2], entrance: [0, 11.4], open: true, block: [[-15, -14, 1.7, -2], [4.3, -14, 15, -2]] },
  build(b, context) {
    const label = plain(context.label), rand = seeded(103), wy = -0.8;
    // The shore: packed sand running down to mud at the water's edge
    b.box(0, -0.6, 5.6, 31, 1.2, 15.6, '#9a8660'); b.box(0, -0.02, 5.8, 30, 0.1, 14.8, '#c9b488'); b.box(0, -0.1, -1.8, 30, 0.14, 1.2, '#8a7a5a');
    creek(b, rand, -34, -2, wy, 8);
    mangroveBank(b, rand, -30, wy - 0.1, -40, -4, 4.2, true);
    // The city's shoreline far off across the water
    for (let i = 0; i < 9; i++) b.box(6 + i * 4.2 + rand() * 2, wy + 1 + rand() * 0.8, -30 - rand() * 2, 2.6 + rand() * 1.6, 1.6 + rand() * 1.8, 2, ['#a9b9bd', '#b6c3c6', '#9cafb4'][i % 3]!);
    b.box(24, wy + 0.2, -29, 44, 0.6, 5, '#7c8a70');
    // The pier: planks on piles with a lower landing at its end
    b.box(3, -0.16, -5.6, 2.6, 0.3, 7.8, '#8a6e4a'); for (let i = 0; i < 12; i++) b.box(3, 0.0, -9.2 + i * 0.66, 2.6, 0.02, 0.05, '#6a5238');
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.cyl(3 + s * 1.36, -0.2, -2.4 - i * 1.7, 0.12, 2.2, '#5a4a38', { seg: 5 });
    b.box(3, -0.5, -10.2, 3.4, 0.2, 1.6, '#7a6040');
    woodenBoat(b, 5.3, wy, -5.4, 0.05, 6.4, '#2f9d98'); woodenBoat(b, 5.6, wy, -10.4, -0.4, 5.8, '#c9423a'); speedboat(b, 0.8, wy, -6.4, 0, '#2a6fb0');
    canoe(b, -2.6, wy, -3.6, 0.9); canoe(b, 10.6, wy, -4, -1.2, 4, '#7a5a3a'); canoe(b, -6.4, -0.04, -0.6, 1.3, 4.2, '#5f4630');
    extra(b, 'ph-pier-boatman', 5.3, -5.6, -HALF, 'stand', { y: wy + 0.5, look: look('man', 'chill', 'teal') });
    // Houses on stilts over the water at the left, plank walks between them
    stiltHouse(b, -8.6, wy, -5.6, 4.6, 3.6, 0, '#a8876a'); stiltHouse(b, -12.6, wy, -9.6, 4, 3.4, 2, '#8f9a94'); stiltHouse(b, -4.4, wy, -10, 3.8, 3.2, 1, '#b39a72');
    b.box(-8.6, wy + 1.9, -2.6, 1, 0.1, 3, '#8a6e4a', { rx: -0.34 }); b.box(-10.8, wy + 1.9, -7.8, 1, 0.1, 2.4, '#8a6e4a', { ry: 0.8 }); b.box(-6.4, wy + 1.9, -8, 1, 0.1, 2.6, '#8a6e4a', { ry: -0.8 });
    // The shore: a ticket table under an umbrella, the name board, a bench under an almond tree, nets drying, a small house
    parasol(b, 6.6, 0.6, { colors: ['#2f9d98', WHITE], r: 1.6 }); table(b, 6.9, 1.2, { w: 1.6, d: 0.8, h: 0.9 });
    sign(b, 6.9, 0.5, 1.64, 'TICKETS', { size: 0.16, color: WHITE, board: '#2f9d98', pad: 0.1 });
    extra(b, 'ph-pier-clerk', 6.9, 0.4, 0, 'sit', { seat: 0.5, look: look('woman', 'casual', 'gold', { accessories: ['headwrap'] }) });
    for (let i = 0; i < 3; i++) b.box(8.4 + i * 0.5, 0.36, 0.2, 0.4, 0.62, 0.16, '#f07a1e', { rx: -0.2 });
    signBoard(b, -1, 0.4, label, { y: 2.3, size: fit(label, 4.6, 0.34), color: WHITE, board: '#2f6f6c' });
    leafTree(b, 13.2, 6, { s: 1, tone: 1 }); bench(b, 9.6, 7.6, { w: 2.6, ry: -0.4, back: true }); extra(b, 'ph-pier-wait', 9.6, 7.6, -0.4, 'sit', { seat: 0.6 });
    for (const x of [-11.6, -8.8, -6]) b.cyl(x, 1.1, 3.6, 0.06, 2.2, WOOD_DARK, { seg: 4 });
    b.box(-8.8, 2.1, 3.6, 5.8, 0.05, 0.05, WOOD_DARK); b.box(-8.8, 1.3, 3.6, 5.4, 1.5, 0.03, '#8fa39a', GLASS);
    for (let i = 0; i < 6; i++) b.ball(-11.2 + i * 0.95, 0.58, 3.64, 0.1, 0.1, 0.1, '#e0822f', { seg: 4 });
    b.box(-11.4, 1.5, 9, 4.4, 3, 3.6, '#d8c9a4'); zincRoof(b, -11.4, 3, 9, 4.8, 4, 1, 0.34, 0, OLD_ZINC); b.box(-10.6, 1.1, 10.83, 0.9, 2.1, 0.06, '#3a2c22');
    palm(b, -13.2, 0.4, { s: 1, lean: 0.16, ry: 2.6 }); palm(b, 13.2, -0.6, { s: 1.05, lean: 0.12, ry: 0.6 });
    for (let i = 0; i < 4; i++) mangrove(b, 9 + i * 1.7 + rand(), -0.3, -1.9 - rand() * 0.4, 0.8 + rand() * 0.3, i);
    crate(b, 0.6, 0, -0.2, { s: 0.8 }); b.cyl(1.5, 0.3, 0, 0.2, 0.6, '#e8b820', { seg: 6 });
    extra(b, 'ph-pier-helper', 1.2, 2.2, 0.4, 'wave', { look: look('man', 'casual', 'teal', { accessories: ['cap'] }) });
    lampPost(b, 4.8, 4.4, { light: true }); lampPost(b, -4.4, 8);
    return {
      spots: [
        landmark('landing', /landing|pier|jetty|boat|wait|water|town/, 3, -3.6, PI),
        landmark('tickets', /ticket|table|pay|work|staff/, 5.4, 2.8, PI - 0.6),
        landmark('people', /people|crowd|meet/, 0.6, 6, 0),
      ],
      crowd: [[2.4, 4.4, 0.4], [-2.4, 5.6, -0.5], [5.6, 8.6, 2.4], [-6, 7.2, 1.2], [7.6, 10.4, -0.8], [-6.4, 10.6, 0.8], [2.4, 10.4, 2.8], [-2.6, 9.4, 2.4], [3, -6.4, 2.9], [3.2, -8.4, 3.1], [-3.4, 1.6, 3.1], [8.4, 3.6, 0.6]],
      spare: [[-3, 4], [3, 7.6], [-1, 8.6], [0.4, 3]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Open-air grill: plantain and fish roasting over charcoal in drum grills by the road, a serving table, benches under a
// sheet canopy, the creek behind.

/** A drum cut in half lengthways and set on legs, glowing coals in it and a mesh of plantain and fish on top. */
function drumGrill(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => {
    b.cyl(0, 0.9, 0, 0.5, 1.5, '#2b2b2e', { seg: 8, rz: HALF }); b.box(0, 1.16, 0, 1.46, 0.5, 0.96, '#2b2b2e');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.6, 0.35, sz * 0.36, 0.07, 0.7, 0.07, METAL_DARK);
    b.box(0, 1.4, 0, 1.36, 0.06, 0.86, '#ff7a2a', GLOW); b.box(0, 1.46, 0, 1.44, 0.03, 0.94, '#5d646b');
    for (let i = 0; i < 4; i++) b.ball(-0.5 + i * 0.26, 1.54, -0.18, 0.1, 0.09, 0.3, i % 2 ? '#c98a2c' : '#e0a83a', { seg: 5 });
    for (let i = 0; i < 2; i++) { b.ball(-0.1 + i * 0.5, 1.54, 0.24, 0.36, 0.07, 0.13, '#8f8a80', { seg: 5 }); b.box(0.28 + i * 0.5, 1.54, 0.24, 0.14, 0.03, 0.2, '#6d6a62'); }
    for (let i = 0; i < 2; i++) b.ico(-0.2 + i * 0.5, 2.3 + i * 0.6, -0.1, 0.34 + i * 0.1, 0.3, 0.3, '#d8d8d4', GLASS);
  });
}

const bole: SceneDef = {
  mood: 'outdoor', accent: '#e0822f',
  walk: { bounds: [-14.2, -5.4, 14.2, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(107);
    b.box(0, -0.5, 3, 31, 0.9, 20.4, '#a8946a'); b.box(0, -0.02, 3.2, 30, 0.1, 19.6, '#cdb88c');
    b.box(0, 0.03, 10.4, 30, 0.04, 3.4, ASPHALT); b.box(0, 0.08, 8.6, 30, 0.16, 0.3, KERB);
    // The creek behind: a strip of water, mangrove, a canoe at the bank
    creek(b, rand, -16, -6.8, -0.5, 5); mangroveBank(b, rand, -15.4, -0.6, -30, 30, 3.8);
    canoe(b, 9.4, -0.5, -8.4, 1.3); for (let x = -13.6; x <= 13.6; x += 3.4) b.cyl(x, 0.5, -6.4, 0.09, 1.2, WOOD_DARK, { seg: 5 });
    b.box(0, 0.9, -6.4, 27.4, 0.07, 0.07, WOOD_DARK);
    // The canopy: old sheet on poles over long tables and benches
    openShed(b, -6.4, -1.2, 10.4, 6.4, 3, 1, OLD_ZINC);
    for (const z of [-2.6, 0.6]) { table(b, -6.4, z, { w: 6.4, d: 0.9, h: 0.95, color: WOOD_LIGHT }); bench(b, -6.4, z - 0.9, { w: 6 }); bench(b, -6.4, z + 0.9, { w: 6 }); }
    extra(b, 'ph-bole-eater-1', -8.2, -1.7, PI, 'sit', { seat: 0.6 });
    for (const [x, z] of ([[-8.2, -2.6], [-4.6, 0.6], [-6.8, 0.6]] as [number, number][])) { b.cyl(x, 1.07, z, 0.3, 0.05, '#e8e4d8', { seg: 8 }); b.ball(x - 0.06, 1.14, z, 0.2, 0.06, 0.08, '#e0a83a', { seg: 4 }); b.ball(x + 0.1, 1.14, z + 0.1, 0.16, 0.05, 0.07, '#8f8a80', { seg: 4 }); }
    stringLights(b, [-11.4, 3, 2.2], [-1.4, 3, 2.2], { n: 8, colors: [WARM, '#ffb86a'] });
    // The grills in the open, the cooks, the serving table with trays of bole, fish and pepper sauce
    drumGrill(b, 3.6, 0.2, 0.1); drumGrill(b, 5.8, -0.1, -0.05); drumGrill(b, 8, 0.2, 0.1);
    b.light(5.8, 2.2, 0.4, '#ffb060', 22, 10);
    extra(b, 'ph-bole-cook-1', 4.7, -1.2, 0.2, 'work', { look: TRADER('orange') }); extra(b, 'ph-bole-cook-2', 7, -1.3, -0.2, 'work', { look: look('man', 'casual', 'red', { accessories: ['cap'] }) });
    b.box(5.8, 0.5, 2.6, 6.4, 1, 1, WOOD); b.box(5.8, 1.04, 2.6, 6.8, 0.08, 1.3, WOOD_LIGHT);
    for (let i = 0; i < 3; i++) { b.box(3.6 + i * 1.5, 1.12, 2.6, 1.1, 0.06, 0.8, '#c9cdd0'); for (let k = 0; k < 4; k++) b.ball(3.3 + i * 1.5 + (k % 2) * 0.5, 1.2, 2.4 + Math.floor(k / 2) * 0.36, 0.26, 0.08, 0.1, i === 1 ? '#8f8a80' : k % 2 ? '#c98a2c' : '#e0a83a', { seg: 5 }); }
    pot(b, 8.2, 1.08, 2.6, { r: 0.32, color: '#c9cdd0', food: '#b8321f' }); pot(b, 8.9, 1.08, 2.7, { r: 0.24, color: '#c9cdd0', food: '#d9482f' });
    sign(b, 5.8, 0.5, 3.12, 'BOLE AND FISH', { size: 0.26, color: WHITE, board: '#e0822f', pad: 0.16 });
    // Supplies: plantain in bunches, sacks of charcoal, firewood, a hand-wash bucket
    for (let i = 0; i < 8; i++) b.box(11.4 + (i % 4) * 0.42, 0.34 + Math.floor(i / 4) * 0.46, -2.6 + (i % 2) * 0.2, 0.36, 0.6, 0.5, i % 3 ? '#7c9b3c' : '#9ab04a', { rz: (i % 3 - 1) * 0.2 });
    for (const [x, z] of ([[11.2, -4.2], [12.2, -4.4], [11.7, -3.6]] as [number, number][])) { b.ball(x, 0.42, z, 0.42, 0.5, 0.38, '#3a3632', { seg: 6 }); b.ico(x, 0.88, z, 0.26, 0.12, 0.24, '#1f1d1b'); }
    for (let i = 0; i < 4; i++) b.cyl(10.6 + (i % 2) * 0.24, 0.14 + Math.floor(i / 2) * 0.24, 1.2, 0.12, 1.2, '#7a5636', { seg: 5, rx: HALF });
    b.box(1.2, 0.4, 5, 0.5, 0.8, 0.5, WOOD_DARK); b.cyl(1.2, 1.06, 5, 0.3, 0.52, '#e8b820', { seg: 8, top: 1.1 }); b.box(1.2, 0.94, 5.32, 0.06, 0.06, 0.14, '#c9423a');
    // Two tables under umbrellas by the road, the name on a board
    for (const [x, z, c] of ([[-10.6, 5.6, '#e9614b']] as [number, number, Colour][])) { parasol(b, x, z, { colors: [c, WHITE] }); table(b, x, z, { w: 1.4, round: true, h: 0.9, color: WOOD_LIGHT }); for (let i = 0; i < 3; i++) stool(b, x + Math.sin(i * 2.1) * 1.2, z + Math.cos(i * 2.1) * 1.2, { h: 0.5 }); }
    signBoard(b, -5.4, 7.2, label, { y: 2.2, size: fit(label, 6.6, 0.36), color: '#fff0c4', board: '#6a3a20' });
    palm(b, 13, 4, { s: 1, lean: 0.14, ry: 3 }); palm(b, -13.4, -4.4, { s: 0.95, ry: 1 });
    lampPost(b, -1, 6.6, { light: true });
    return {
      spots: [
        landmark('counter', /counter|food|eat|bole|fish|serve|order/, 5.8, 4.3, PI),
        landmark('work', /work|grill|cook|kitchen|job|shift/, 9.6, -1.2, -HALF, { act: { pose: 'work' } }),
        landmark('seat', /seat|table|bench|sit|canopy/, -0.4, -1, -HALF),
        landmark('people', /people|crowd|meet/, 1, 7.4, 0),
      ],
      crowd: [[3.2, 6, 0.4], [-2.4, 5.6, -0.5], [8.6, 5, 2.8], [-7.6, 4.6, 1.2], [7.6, 7.6, -0.8], [-8.4, 7.6, 0.8], [2.4, 7.8, 2.8], [-2.6, 7.6, 2.4], [-0.4, 2.4, 1.6], [12, 1.6, -1.4], [0.4, -3.4, 3.1], [-12.4, 2.4, 0.6]],
      spare: [[-3, 4], [3, 7], [-1, 6.6], [0.4, 3.6]],
    };
  },
};

/** Variant scenes by scene kind, then by variant (venue.scene.variant). */
const WATERSIDE: Record<string, Record<string, SceneDef>> = {
  park: { 'ph-lake': lake, 'ph-cenotaph': cenotaph, 'ph-rides': rides, 'ph-bandstand': bandstandGarden },
  market: { 'ph-block': marketBlock, 'ph-rows': marketRows, 'ph-junction': marketJunction },
  beach: { 'ph-creek': creekBeach },
  hub: { 'ph-terminal': terminal, 'ph-pier': pier },
  buka: { 'ph-bole': bole },
};

const kinds = [...new Set([...Object.keys(WATERSIDE), ...Object.keys(INLAND)])];
/** Every scene opens on the whole of itself, so a stand, a crane or the far bank is in view before the player walks in. */
const WHOLE_START = 4.2;
export const VARIANTS: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = Object.freeze(Object.fromEntries(kinds.map((kind) => [
  kind,
  Object.freeze(Object.fromEntries(Object.entries({ ...WATERSIDE[kind], ...INLAND[kind] }).map(([variant, def]) => { const camera = def.camera ?? WIDE; return [variant, { ...def, camera: { ...camera, start: Math.max(camera.start ?? 0, WHOLE_START) } }]; }))),
])));
