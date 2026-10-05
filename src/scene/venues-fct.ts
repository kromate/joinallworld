/**
 * OWNER: scenes
 * Scenes of Abuja's own places, each asked for through `scene.variant` and held in VARIANTS[kind][variant]
 * like the variants of src/scene/venues-ibadan-b.ts and src/scene/venues-ogun-a.ts:
 *
 *   park / fct-terraces        a formal park: a stone walk with a line of fountains, grass terraces behind, a granite monolith beyond
 *   park / fct-parade          a parade ground before a long grandstand under a white canopy, flags, an eagle, far office slabs
 *   park / fct-lake            a lakeside promenade: a jetty with boats for hire, picnic lawns, a long mall across the water
 *   park / fct-zoo             a children's park: a playground, animal paddocks behind fences, the monolith close behind
 *   worship / fct-mosque       a pale stone mosque with a golden dome and four tall minarets over a wide forecourt
 *   worship / fct-church       a church of tall pointed concrete frames with a spire and strips of coloured glass
 *   market / fct-crafts        round thatched huts round a sandy court: pots, carvings, baskets and cloth
 *   viewing / fct-stadium      the forecourt of a great bowl under a ring roof with four floodlight masts
 *   gym / fct-velodrome        a hall with a banked wooden cycling track
 *   walk / fct-gate            a lay-by beside an expressway that runs under a monumental gate
 *   statehouse / fct-hall      a modest community hall with a porch and a notice board
 *
 * The everyday scenes (markets, stations, campuses, gardens) are in src/scene/venues-fct-b.ts and are part of VARIANTS here.
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * Scenes are static. Scene definition format: see venues-outdoor.ts.
 */
import { GLOW, GLASS } from './build.ts';
import type { Batch, Colour, SceneCamera, SceneDef } from './types.ts';
import {
  ground, room, table, bench, chair, leafTree, tallTree, palm, bush, lampPost, kiosk, flag, fence, windowPane, sign, signBoard, car, landmark, extra,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF,
} from './props.ts';
import { PI, HALF, OPEN, seeded, plain, fit, labelled, adireCloth } from './venues-ogun-a.ts';
import {
  EVERYDAY, INDOORS, STONE, STONE_DARK, PAVING, CONCRETE, LAWN, LAWN_EDGE, NATION, frontCrowd, frontSpare, plainLand, monolith, hills, farTrees,
  clipped, thatchShelter,
} from './venues-fct-b.ts';

const GOLD = '#d8a838';

// ---------------------------------------------------------------------------------------------
// The terraced park: a broad stone walk with a line of fountain basins down its middle, lawns and clipped trees either
// side, three grass terraces stepping up behind with a flight of steps through each, and the monolith beyond.

const terraces: SceneDef = {
  mood: 'outdoor', accent: '#f2c14e',
  camera: { landscape: [16, 13.5, 29], portrait: [13, 30, 78] },
  walk: { bounds: [-14.2, -6.6, 14.2, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(11);
    plainLand(b, '#93ad63');
    ground(b, { w: 30, d: 26, color: '#5f9d4c', edge: LAWN_EDGE });
    b.box(0, 0.04, 2.8, 6.6, 0.04, 20.4, STONE);
    for (const s of [-1, 1]) b.box(s * 3.2, 0.05, 2.8, 0.24, 0.04, 20.4, STONE_DARK);
    // The fountains: four stone basins in line, three jets to each
    for (const z of [6.6, 2.8, -1, -4.8]) {
      b.box(0, 0.22, z, 2, 0.44, 2.8, STONE_DARK); b.box(0, 0.46, z, 1.7, 0.04, 2.5, '#79c3df', GLASS);
      for (let k = -1; k <= 1; k++) { b.cyl(0, 1.05 - Math.abs(k) * 0.2, z + k * 0.8, 0.07, 1.3 - Math.abs(k) * 0.4, '#e4f4fa', { seg: 5, layer: 'glass' }); b.ball(0, 1.75 - Math.abs(k) * 0.4, z + k * 0.8, 0.16, 0.12, 0.16, '#f4fbfd', { seg: 5 }); }
    }
    // The terraces: each a bank of grass behind a white stone wall, the walk climbing through them in short flights
    for (let t = 0; t < 3; t++) {
      const wall = -7.4 - t * 2.8, deep = t === 2 ? 5 : 2.8, wide = t === 2 ? 36 : 30;
      b.box(0, (t + 1) / 2, wall - deep / 2, wide, t + 1, deep, ['#62a04f', '#5c9a4a', '#579446'][t]!);
      b.box(0, t + 0.5, wall + 0.06, wide, 1, 0.12, STONE); b.box(0, t + 1.04, wall + 0.06, wide, 0.1, 0.3, STONE_DARK);
      b.box(0, t + 1.03, wall - deep / 2, 6.6, 0.04, deep, STONE);
      for (let i = 0; i < 3; i++) b.box(0, t + (i + 1) / 6, wall + 1.1 - i * 0.4, 6.6, (i + 1) / 3, 0.4, i % 2 ? STONE_DARK : STONE);
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
        const x = s * (5.4 + k * 4.2);
        if (t === 0) b.at(x, 1, wall - 1.4, 0, () => clipped(b, 0, 0, 0.85));
        else if (t === 1) b.at(x + s * 1.6, 2, wall - 1.4, 0, () => { b.cyl(0, 0.4, 0, 0.12, 0.8, '#6b5440', { seg: 5 }); b.cone(0, 2.4, 0, 0.8, 3.6, '#2f6f46', { seg: 7 }); });
        else b.at(x, 3, wall - 2.6, 0, () => leafTree(b, 0, 0, { s: 1.05, tone: k }));
      }
    }
    monolith(b, -9, -44, 0.95);
    hills(b, [[30, -42, 16, 7], [52, -26, 12, 6], [-50, -30, 12, 6]]); farTrees(b, rand, 10, -40, 50, -34, -21);
    // The lawns: clipped trees and benches along the walk, round flower beds, lamps, a picnic on the grass
    for (const s of [-1, 1]) {
      for (const z of [9.4, 4.8, 0.2, -4.4]) clipped(b, s * 4.6, z, 0.95);
      bench(b, s * 4.5, 7.1, { w: 2.6, back: true, ry: -s * HALF, color: '#8f9384', leg: '#6f766c' }); bench(b, s * 4.5, -2.1, { w: 2.6, back: true, ry: -s * HALF, color: '#8f9384', leg: '#6f766c' });
      b.disc(s * 9.6, 0.07, 2.4, 2, '#7a5a3c', { seg: 12 });
      for (let i = 0; i < 8; i++) b.ico(s * 9.6 + Math.sin(i * 0.785) * 1.3, 0.3, 2.4 + Math.cos(i * 0.785) * 1.3, 0.34, 0.26, 0.34, ['#e9614b', '#e8c43a', '#f1efe8', '#dd6fa0'][i % 4]!);
      b.ico(s * 9.6, 0.5, 2.4, 0.6, 0.5, 0.6, '#3f8a57');
    }
    b.box(9.6, 0.06, 8, 2.6, 0.03, 1.9, '#c9423a', { ry: 0.3 }); b.cyl(10.4, 0.25, 8.4, 0.3, 0.4, '#c9a56a', { seg: 7, top: 1.2 });
    extra(b, 'park-picnic', 9.2, 7.8, -2.2, 'sit', { seat: 0.12, look: { body: 'woman', outfit: 'casual', outfitColor: 'pink' } });
    extra(b, 'park-sketcher', -4.5, 7.1, HALF, 'sit', { seat: 0.6, look: { body: 'man', outfit: 'casual', outfitColor: 'teal', accessories: ['glasses'] } });
    extra(b, 'park-walker', 2.2, -3.4, 0.2, 'walk', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange' } });
    // A keeper's hut on the left lawn and the park's name on a low stone wall by the way in
    kiosk(b, -11.6, -3, { ry: HALF, w: 3, color: '#e9e2cf', roof: '#5f7a6a', fascia: '#f4f2ea' });
    b.box(-9, 0.55, 10.4, 7.4, 1.1, 0.5, STONE); b.box(-9, 1.14, 10.4, 7.7, 0.1, 0.66, STONE_DARK);
    sign(b, -9, 0.58, 10.68, label, { size: fit(label, 6.6, 0.46), color: '#3a4a3a' });
    lampPost(b, -3.9, 2.6, { light: true }); lampPost(b, 3.9, 2.6); lampPost(b, 3.9, -6);
    return {
      spots: [
        landmark('fountains', /visit|fountain|lawn|park|terrace|look|learn/, 2.2, 0.9, -HALF),
        landmark('work', /work|staff|keeper|garden|job|shift/, -8.6, -3, -HALF, { act: { pose: 'work' } }),
        landmark('bench', /bench|sit|rest|sketch/, 6.2, -2.1, -HALF),
        landmark('people', /people|crowd|meet/, 1.8, 9, 0),
      ],
      crowd: [[2.4, 9.8, 0.4], [-2.2, 9.4, -0.5], [7.6, 5.2, 2.4], [-7, 6.6, 1.2], [6.4, 10.2, -0.8], [-8.4, 8, 0.8], [2.2, 4.6, 2.8], [-2.2, 4.8, 2.4], [-11, 6.4, 1.6], [12.2, 9.6, -0.4], [-2.2, 0.6, 3.1], [6.4, -4.6, 0.6]],
      spare: frontSpare(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The mosque: a pale stone hall under a golden dome, a tall minaret at each corner, arcaded wings and a wide paved forecourt.

/** A recess with a pointed head, facing +z. */
function pointedRecess(b: Batch, x: number, y: number, z: number, w: number, h: number, colour: Colour, ry = 0): void {
  b.at(x, y, z, ry, () => { b.box(0, h / 2, 0, w, h, 0.08, colour); b.box(0, h, 0, w * 0.7071, w * 0.7071, 0.08, colour, { rz: PI / 4 }); });
}
/** A slender square minaret: a base, a long shaft to a balcony, a shorter shaft and a pointed golden cap. `h` is the height of the two shafts together. */
function tallMinaret(b: Batch, x: number, z: number, h: number): void {
  const lower = h * 0.72, upper = h * 0.28, shaft = '#f1ebda';
  b.box(x, 1.6, z, 2, 3.2, 2, STONE); b.box(x, 3.3, z, 2.3, 0.24, 2.3, STONE_DARK);
  b.cyl(x, 3.4 + lower / 2, z, 0.95, lower, shaft, { seg: 4, ry: PI / 4, top: 0.82 });
  b.box(x, 3.5 + lower, z, 2, 0.24, 2, STONE_DARK); b.box(x, 3.9 + lower, z, 1.8, 0.6, 1.8, shaft);
  b.cyl(x, 3.6 + lower + upper / 2, z, 0.64, upper, shaft, { seg: 4, ry: PI / 4, top: 0.85 });
  b.box(x, 3.7 + h, z, 1.2, 0.2, 1.2, STONE_DARK);
  b.cone(x, 3.8 + h + 1.3, z, 0.74, 2.6, GOLD, { seg: 4, ry: PI / 4 });
  b.cyl(x, 6.8 + h, z, 0.03, 0.9, GOLD, { seg: 4 }); b.ball(x, 7.3 + h, z, 0.14, 0.14, 0.14, GOLD, { seg: 5 });
}

const mosque: SceneDef = {
  mood: 'outdoor', accent: '#d8a838',
  camera: { landscape: [22, 31, 40], portrait: [14, 50, 72], start: 5.4 },
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), hall = '#efe8d6', shade = '#40525c';
    plainLand(b, '#b3ad72');
    ground(b, { w: 30, d: 26, color: '#e9e2cf', edge: '#b5ab90' });
    // The forecourt: a darker band up the middle to the door, cross bands, an eight-pointed star set in the paving
    b.box(0, 0.04, 3.6, 5, 0.04, 17, '#d9cfb4');
    for (const z of [-1.4, 8.2]) b.box(0, 0.045, z, 28, 0.04, 0.5, '#d9cfb4');
    b.box(0, 0.06, 3.4, 4, 0.02, 4, '#c9b98f'); b.box(0, 0.062, 3.4, 4, 0.02, 4, '#c9b98f', { ry: PI / 4 }); b.disc(0, 0.09, 3.4, 1.3, '#efe8d6', { seg: 16 });
    // The hall on its plinth: a tall middle bay with the great door, two pointed recesses either side of it, arcaded wings
    b.box(0, 0.3, -9.2, 28.4, 0.6, 9.4, STONE_DARK);
    b.box(0, 4, -9.4, 15, 6.8, 8, hall); b.box(0, 7.5, -9.4, 15.5, 0.3, 8.5, STONE_DARK);
    b.box(0, 4.8, -5.1, 5.2, 8.4, 1.2, hall); b.box(0, 9.1, -5.1, 5.6, 0.3, 1.6, STONE_DARK);
    pointedRecess(b, 0, 0.6, -4.47, 2.6, 5.4, shade); b.box(0, 2.2, -4.42, 1.8, 3.2, 0.06, '#6a4a30'); b.box(0, 5.2, -4.42, 1.6, 0.9, 0.04, GOLD);
    for (const s of [-1, 1]) {
      for (const x of [3.9, 6.1]) { pointedRecess(b, s * x, 1, -5.37, 1.4, 4.2, shade); b.box(s * x, 2.6, -5.33, 0.9, 2.6, 0.04, '#cdbf9a'); }
      b.box(s * 10.9, 2.5, -9.4, 6.8, 3.8, 6.4, '#e9e1cc'); b.box(s * 10.9, 4.5, -9.4, 7.2, 0.24, 6.8, STONE_DARK);
      for (let i = 0; i < 3; i++) pointedRecess(b, s * (9 + i * 1.9), 0.6, -6.17, 1.2, 2.5, shade);
      for (const z of [-6.6, -12.2]) { b.cyl(s * 6, 7.9, z, 1.2, 0.6, hall, { seg: 8 }); b.ball(s * 6, 8.1, z, 1.15, 1.2, 1.15, GOLD, { seg: 8 }); }
      tallMinaret(b, s * 13, -5.2, 10.5); tallMinaret(b, s * 13, -13.2, 10.5);
    }
    for (let i = 0; i < 4; i++) b.box(0, 0.08 + i * 0.13, -3.6 - i * 0.34, 6.4, 0.16 + i * 0.26, 0.4, i % 2 ? STONE_DARK : STONE);
    // The dome: a drum of small windows under a golden shell with a crescent finial
    b.cyl(0, 8.3, -9.4, 4.7, 1.4, hall, { seg: 16 });
    for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2 + 0.196; b.box(Math.sin(a) * 4.62, 8.3, -9.4 + Math.cos(a) * 4.62, 0.6, 0.8, 0.1, shade, { ry: a }); }
    b.ball(0, 9, -9.4, 4.6, 4.6, 4.6, GOLD, { seg: 16 });
    b.cyl(0, 14, -9.4, 0.06, 1.2, GOLD, { seg: 4 }); b.ball(0, 14.7, -9.4, 0.26, 0.26, 0.1, GOLD, { seg: 6 });
    // Date palms and lamps down the sides of the court, a rack for shoes by the steps, the name on a stone block
    for (const s of [-1, 1]) { palm(b, s * 9.4, 1.4, { s: 1.15, lean: 0.04, ry: s > 0 ? 0 : PI }); palm(b, s * 9.4, 6.6, { s: 1.05, lean: 0.04, ry: s > 0 ? 0 : PI }); lampPost(b, s * 6, -1.4, { light: s < 0 }); }
    b.box(-6.2, 0.6, -2.9, 2.8, 1.2, 0.7, WOOD); for (let i = 0; i < 5; i++) b.box(-7.2 + i * 0.5, 0.86, -2.6, 0.34, 0.14, 0.2, ['#3a3228', '#8a6644', '#22252a'][i % 3]!);
    b.box(-9.2, 0.55, 10.2, 8, 1.1, 0.6, STONE); b.box(-9.2, 1.14, 10.2, 8.3, 0.1, 0.76, STONE_DARK);
    sign(b, -9.2, 0.58, 10.53, label, { size: fit(label, 7.2, 0.44), color: '#3c4a44' });
    extra(b, 'mosque-helper', -3.6, -1.6, 0.2, 'stand', { look: { body: 'woman', outfit: 'kaftan', outfitColor: 'teal', accessories: ['headwrap'] } });
    extra(b, 'mosque-student', 6.2, 4.6, -2.6, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'cream', accessories: ['backpack', 'glasses'] } });
    extra(b, 'mosque-elder', 1.6, -2.4, 2.6, 'walk', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream', accessories: ['fila'] } });
    return {
      spots: [
        landmark('court', /visit|court|forecourt|mosque|look|learn|quiet/, 0.6, 0.4, PI),
        landmark('work', /work|staff|help|guide|job|shift/, -4.6, 0.6, PI, { act: { pose: 'stand' } }),
        landmark('star', /star|paving|photo/, 3.4, 4.4, -2.4),
        landmark('people', /people|crowd|meet/, 1, 8.4, 0),
      ],
      crowd: [[2.6, 7.4, 0.4], [-2.4, 7.6, -0.5], [6.6, 7.4, 2.4], [-6, 6.6, 1.2], [8.6, 9.8, -0.8], [-6.4, 4, 0.8], [3, 10.4, 2.8], [-3.2, 10.2, 2.4], [-12, 4.4, 1.6], [12, 6.6, -0.4], [0.2, 9.6, 3.1], [5.4, 0.6, 0.6]],
      spare: frontSpare(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The church: a tall nave under a steep roof, its front and flanks a rhythm of pointed concrete frames with narrow strips
// of coloured glass between them, a spire with a cross over the crossing, lawns and a paved court before the doors.

const GLASSES: readonly Colour[] = ['#3f72c4', '#c9423a', '#e0a43a', '#3d8f6a', '#8055c2'];
/** Two leaning members that meet in a point: a pointed frame w wide and h high, standing across x at z. */
function pointedFrame(b: Batch, x: number, z: number, w: number, h: number, t: number, colour: Colour): void {
  const lean = Math.atan(w / 2 / h), len = Math.hypot(w / 2, h);
  for (const s of [-1, 1]) b.box(x + (s * w) / 4, h / 2, z, t, len, t + 0.2, colour, { rz: s * lean });
}

const church: SceneDef = {
  mood: 'outdoor', accent: '#e0b04a',
  camera: { landscape: [24.5, 36, 44], portrait: [14, 50, 72], start: 5.4 },
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), conc = '#dcd6c6', dark = '#c4bdab', roof = '#b3ac9a';
    plainLand(b, '#9fae6a');
    ground(b, { w: 30, d: 26, color: LAWN, edge: LAWN_EDGE });
    b.box(0, 0.04, 4, 9, 0.04, 16.4, PAVING); b.box(0, 0.045, 0.4, 27, 0.04, 2.6, PAVING);
    // The nave: tall walls under a steep roof, a gable at each end
    b.box(0, 3.5, -9, 8.8, 7, 9, conc);
    for (const s of [-1, 1]) b.box(s * 2.2, 10.1, -9, 7.7, 0.26, 9.6, s < 0 ? roof : '#a59e8c', { rz: -s * 0.953 });
    for (const z of [-4.62, -13.38]) b.cyl(0, 9.07, z, 4.13, 0.3, conc, { seg: 3, rx: -HALF, sx: 1.23 });
    // Aisles under lean-to roofs, and the frames that rise from the ground past them to the eaves, glass between
    for (const s of [-1, 1]) {
      b.box(s * 6.3, 2.2, -9.3, 3.8, 4.4, 8.2, dark); b.box(s * 6.3, 4.8, -9.3, 4.2, 0.2, 8.6, roof, { rz: -s * 0.24 });
      for (let i = 0; i < 5; i++) {
        const z = -12.9 + i * 1.95;
        b.box(s * 6.9, 4.1, z, 0.5, 9.2, 0.5, conc, { rz: s * 0.45 });
        if (i < 4) { b.box(s * 8.23, 2.5, z + 0.98, 0.06, 3, 0.5, GLASSES[(i + (s > 0 ? 0 : 2)) % 5]!); b.box(s * 4.43, 5.9, z + 0.98, 0.06, 1.7, 0.4, GLASSES[(i + 3) % 5]!); }
      }
    }
    // The front: a great pointed frame over the doors with a fan of glass strips, a lower frame before each aisle
    pointedFrame(b, 0, -3.9, 6, 12.8, 0.55, conc); pointedFrame(b, 0, -4.2, 3.6, 10.4, 0.3, dark);
    for (let k = -2; k <= 2; k++) { const h = 6.6 - Math.abs(k) * 1.9; b.box(k * 0.5, 3.8 + h / 2, -4.42, 0.3, h, 0.08, GLASSES[k + 2]!); }
    b.box(0, 1.7, -4.4, 2.4, 3.4, 0.12, '#4a3626'); b.box(0, 1.7, -4.33, 0.06, 3.4, 0.04, '#2f2218');
    for (const s of [-1, 1]) {
      pointedFrame(b, s * 6.3, -4.9, 3.8, 8, 0.45, conc);
      b.box(s * 6.3, 3.1, -5.16, 0.4, 3.6, 0.08, GLASSES[s > 0 ? 1 : 3]!); b.box(s * 6.3, 0.9, -5.16, 1, 1.8, 0.08, '#4a3626');
    }
    for (let i = 0; i < 3; i++) b.box(0, 0.08 + i * 0.1, -3.2 - i * 0.3, 7 - i * 0.6, 0.16 + i * 0.2, 0.4, i % 2 ? dark : conc);
    // The spire over the crossing and its cross
    b.box(0, 13.2, -10.6, 2.4, 2.4, 2.4, conc); b.cone(0, 16.9, -10.6, 1.6, 5, '#cfc9b8', { seg: 4, ry: PI / 4 });
    b.box(0, 20.2, -10.6, 0.18, 1.8, 0.18, WHITE); b.box(0, 20.5, -10.6, 1, 0.18, 0.18, WHITE);
    // The court: clipped hedges along the paving, flower beds, benches, a notice of the name on a stone block, old trees
    for (const s of [-1, 1]) {
      b.box(s * 4.9, 0.4, 6.6, 0.7, 0.8, 9, '#3f8a57');
      b.box(s * 8.4, 0.2, 4.6, 3.6, 0.4, 1.6, '#7a5a3c'); for (let i = 0; i < 5; i++) b.ico(s * 8.4 - 1.2 + i * 0.6, 0.55, 4.6, 0.3, 0.24, 0.3, ['#f1efe8', '#e8c43a', '#e9614b', '#f1efe8', '#dd6fa0'][i]!);
      bench(b, s * 8.4, 7.4, { w: 2.6, back: true, ry: PI, color: '#8a6644' });
      lampPost(b, s * 3.6, -1.4, { light: s > 0 });
    }
    b.box(-9.6, 0.55, 10.4, 7.6, 1.1, 0.6, conc); b.box(-9.6, 1.14, 10.4, 7.9, 0.1, 0.76, dark);
    sign(b, -9.6, 0.58, 10.73, label, { size: fit(label, 6.8, 0.44), color: '#3c4440' });
    leafTree(b, -12.6, 2.4, { s: 1.25, tone: 0 }); leafTree(b, 12.8, 2.2, { s: 1.2, tone: 2 }); tallTree(b, 13, -9.6, { h: 7, s: 1, tone: 1 }); tallTree(b, -13, -9.4, { h: 7.4, s: 1, tone: 0 });
    extra(b, 'church-usher', 2.2, -2.2, 2.9, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'cream', bottomsColor: 'navy', fabric: 'plain' } });
    extra(b, 'church-visitor-1', -8.4, 7.4, PI, 'sit', { seat: 0.6, look: { body: 'woman', outfit: 'owambe', outfitColor: 'violet', hair: 'gele' } });
    extra(b, 'church-visitor-2', 6.6, 1, -2.2, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'blue', accessories: ['backpack'] } });
    return {
      spots: [
        landmark('court', /visit|court|church|centre|door|look|learn|quiet/, -0.8, 0.2, PI),
        landmark('work', /work|staff|usher|office|job|shift/, -3, -1.8, PI, { act: { pose: 'stand' } }),
        landmark('garden', /garden|bench|sit|rest/, 8.4, 9.2, PI),
        landmark('people', /people|crowd|meet/, 0.6, 8.2, 0),
      ],
      crowd: [[2.4, 6.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 10.2, 2.4], [-7, 2, 1.2], [3, 9.4, -0.8], [-6.4, 10, 0.8], [1.4, 10.6, 2.8], [-2.2, 4.4, 2.4], [-11, 7, 1.6], [11.4, 6, -0.4], [0.2, 3.6, 3.1], [3.4, 2.6, 0.6]],
      spare: [[-2, 8.6], [2, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The parade ground: a wide paved square marked for marching, a long grandstand across the back under a white canopy of
// peaks, a covered box at its middle with an eagle over it, a line of flags, and office slabs far behind.

function eagle(b: Batch, x: number, y: number, z: number, s: number): void {
  const bronze = '#a8742e';
  b.at(x, y, z, 0, () => {
    b.box(0, 0.3, 0, 1.6, 0.6, 1.1, STONE);
    b.ball(0, 1.3, 0, 0.38, 0.6, 0.42, bronze, { seg: 7 }); b.ball(0, 2.04, 0.14, 0.22, 0.24, 0.26, '#f1efe8', { seg: 6 });
    b.cone(0, 2, 0.46, 0.08, 0.28, '#e0a43a', { seg: 4, rx: HALF });
    for (const side of [-1, 1]) { b.box(side * 0.8, 1.8, -0.05, 1.3, 0.14, 0.56, bronze, { rz: side * 0.5 }); b.box(side * 1.72, 2.4, -0.05, 1, 0.12, 0.46, bronze, { rz: side * 0.25 }); }
    b.box(0, 0.86, -0.3, 0.46, 0.5, 0.14, bronze, { rx: 0.4 });
  }, 0, 0, s);
}

const parade: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  camera: { landscape: [16.5, 17.5, 29.5], portrait: [13, 34, 78], start: 5.3 },
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(29);
    plainLand(b, '#a9aa78');
    ground(b, { w: 30, d: 26, color: '#cdc7b6', edge: '#8f8a7b' });
    // The square: a darker marching strip, lane lines, the saluting base before the stand
    b.box(0, 0.035, 1.6, 29, 0.02, 4.4, '#bdb7a6');
    for (const z of [-3.6, -0.6, 3.8, 8.2]) b.box(0, 0.05, z, 29, 0.02, 0.14, '#f4f1e6');
    b.box(0, 0.16, -5.6, 3.4, 0.32, 1.8, STONE); b.box(0, 0.33, -5.6, 2.6, 0.02, 1.2, '#a8323a');
    // The grandstand: five tiers of green and white seats the length of the ground, the covered box at the middle
    for (let i = 0; i < 5; i++) {
      const top = (i + 1) * 0.75, z = -8.4 - i * 0.95;
      b.box(0, top / 2, z, 28.6, top, 0.95, CONCRETE); b.box(0, top + 0.06, z, 28, 0.12, 0.6, i % 2 ? '#2f8f55' : '#f1efe8');
    }
    b.box(0, 2.8, -13.1, 28.6, 5.6, 0.5, STONE);
    b.box(0, 2.3, -9.6, 6.6, 4.6, 3.8, STONE); b.box(0, 3.3, -7.68, 5.8, 1.6, 0.06, '#3a342c'); b.box(0, 4.7, -9.6, 7, 0.24, 4.2, STONE_DARK);
    for (let i = 0; i < 3; i++) b.box(-1.8 + i * 1.8, 3.2, -7.64, 0.6, 1, 0.04, i === 1 ? WHITE : '#2f8f55');
    labelled(b, label, 0, 1.5, -7.62, 5.8, 0.62, '#f4efe0', '#1f6f4a', true);
    eagle(b, 0, 4.8, -9.4, 1.5);
    // The canopy: white peaks in a row on tall masts behind the seats, slender props at the front
    for (let i = 0; i < 7; i++) {
      const x = -12.3 + i * 4.1;
      if (i !== 3) b.cone(x, 9.4, -10.6, 2.9, 1.6, '#f6f4ec', { seg: 4, ry: PI / 4 });
      else b.cone(x, 10.6, -10.6, 2.9, 1.6, '#f6f4ec', { seg: 4, ry: PI / 4 });
      b.cyl(x - 2.05, 4.4, -12.7, 0.14, 8.8, WHITE, { seg: 6 }); if (i % 2 === 0 && i !== 3) b.cyl(x, 4.3, -8.5, 0.08, 8.6, WHITE, { seg: 5 });
    }
    b.cyl(12.35, 4.4, -12.7, 0.14, 8.8, WHITE, { seg: 6 });
    for (const s of [-1, 1]) b.cyl(s * 2.05, 5, -8.5, 0.1, 10, WHITE, { seg: 5 });
    // Flags along the front of the stand, floodlights at its ends
    for (let i = 0; i < 6; i++) flag(b, -12.4 + i * 4.96 + (i > 2 ? 0.2 : -0.2), -6.9, { h: 6.4, w: 1.5, colors: [...NATION] });
    for (const s of [-1, 1]) { b.cyl(s * 14.2, 5.6, -7, 0.18, 11.2, METAL, { seg: 6, top: 0.6 }); b.box(s * 14.2, 11.5, -7, 1.9, 1, 0.3, METAL_DARK); for (let k = 0; k < 4; k++) b.quad(s * 14.2 - 0.66 + k * 0.44, 11.5, -6.83, 0.36, 0.36, '#fff3c4', GLOW); }
    // The office slabs of the ministries far behind, trees before them
    for (const [x, w, h] of ([[-25, 12, 9], [-6, 16, 11.5], [14, 12, 9]] as [number, number, number][])) {
      b.box(x, h / 2 - 0.3, -31, w, h, 6, '#cbbfa3'); b.box(x, h - 0.1, -31, w + 0.6, 0.5, 6.6, '#b5a98c');
      for (let f = 0; f < 5; f++) b.box(x, 1.6 + (f * (h - 2.4)) / 5, -27.96, w - 1, 0.8, 0.06, '#6f7f8a');
      for (let k = 1; k < 5; k++) b.box(x - w / 2 + (k * w) / 5, h / 2, -27.9, 0.4, h - 0.6, 0.16, '#d9cdb0');
    }
    farTrees(b, rand, 14, -40, 30, -25, -17);
    // On the square: rails that hold a crowd back, a steward and visitors
    for (const [x0, x1] of ([[-13.4, -9.8], [-9, -5.4], [5.4, 9], [9.8, 13.4]] as [number, number][])) fence(b, [x0, 10.6], [x1, 10.6], { h: 1, color: '#9aa0a6', gap: 1.2 });
    extra(b, 'square-steward', -5.6, -3.4, 0.2, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'green', bottomsColor: 'navy', fabric: 'plain', accessories: ['cap'] } });
    extra(b, 'square-visitor-1', 6.4, -1.8, 2.8, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', accessories: ['handbag'] } });
    extra(b, 'square-visitor-2', -9.4, 4.6, 1.2, 'walk', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream', accessories: ['fila'] } });
    return {
      spots: [
        landmark('square', /visit|square|parade|ground|look|learn/, 1.8, -2.2, PI),
        landmark('work', /work|staff|steward|guide|job|shift/, -3.6, -3.4, PI, { act: { pose: 'stand' } }),
        landmark('flags', /flag|stand|seat/, 7.6, -5, PI),
        landmark('people', /people|crowd|meet/, 2, 7, 0),
      ],
      crowd: frontCrowd(),
      spare: frontSpare(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The crafts village: round mud huts under thatch round a sandy court, each a shop with its wares set out before it.

function hut(b: Batch, x: number, z: number, r: number, ry: number, tone: number): void {
  const wall = ['#b5653f', '#c27a4a', '#a8583a'][tone % 3]!;
  b.cyl(x, 1.2, z, r, 2.4, wall, { seg: 12 }); b.cyl(x, 0.5, z, r + 0.03, 0.18, '#f1e6c8', { seg: 12 }); b.cyl(x, 2, z, r + 0.03, 0.12, '#2f2a24', { seg: 12 });
  b.at(x, 0, z, ry, () => { b.box(0, 1, r - 0.02, 1, 2, 0.14, '#2f2620'); b.box(0, 2.08, r + 0.03, 1.3, 0.16, 0.12, '#f1e6c8'); });
  b.cone(x, 3.9, z, r * 1.5, 3, '#b8975a', { seg: 12 }); b.cone(x, 2.95, z, r * 1.62, 1.1, '#9a7b46', { seg: 12 });
  b.cyl(x, 5.55, z, 0.14, 0.5, '#7a5f34', { seg: 5, top: 0.4 });
}
/** A round-bellied water pot with a short flared neck. */
function bellyPot(b: Batch, x: number, z: number, s: number, tone = 0, y = 0): void {
  const clay = ['#a85a3a', '#96502f', '#b96a44', '#8d8378'][tone % 4]!;
  b.ball(x, y + 0.42 * s, z, 0.44 * s, 0.42 * s, 0.44 * s, clay, { seg: 7 }); b.cyl(x, y + 0.88 * s, z, 0.2 * s, 0.2 * s, clay, { seg: 7, top: 1.3 });
}
function carving(b: Batch, x: number, z: number, h: number, y = 0): void {
  b.box(x, y + h / 2, z, 0.22, h, 0.2, '#4a3224'); b.ball(x, y + h + 0.16, z, 0.16, 0.2, 0.16, '#4a3224', { seg: 5 });
}
function basket(b: Batch, x: number, z: number, r: number, fill: Colour, y = 0): void {
  b.cyl(x, y + r * 0.6, z, r, r * 1.2, '#c9a56a', { seg: 8, top: 1.3 }); b.cyl(x, y + r * 1.22, z, r * 1.3, 0.06, fill, { seg: 8 });
}

const crafts: SceneDef = {
  mood: 'outdoor', accent: '#b5653f',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(47);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#d8c08e', edge: '#9a8052' });
    b.disc(0, 0.05, 1.6, 7.4, '#e2cda0', { seg: 20 });
    // Five huts round the court, their doors turned to it
    hut(b, -10.6, -8.2, 2.5, 0.7, 0); hut(b, -4, -10, 2.4, 0.2, 1); hut(b, 3, -10, 2.5, -0.2, 2); hut(b, 9.8, -8.4, 2.4, -0.7, 0);
    hut(b, -12, -0.6, 2.2, 1.3, 1);
    // Pots: a potter at work on a mat, fired pots in rows, grey unfired ones drying
    b.box(-3.4, 0.05, -5.2, 3.6, 0.04, 2.6, '#b98a4a', { ry: 0.2 });
    for (let i = 0; i < 7; i++) bellyPot(b, -6.6 + (i % 4) * 1.1 + (i > 3 ? 0.5 : 0), -5.4 + Math.floor(i / 4) * 1.1, 0.9 + (i % 3) * 0.2, i);
    for (let i = 0; i < 3; i++) bellyPot(b, -1.6 + i * 0.8, -6.4, 0.7, 3);
    bellyPot(b, -2.6, -4.4, 1.25, 2);
    extra(b, 'crafts-potter', -3.4, -5, 0.5, 'sit', { seat: 0.2, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'orange', accessories: ['headwrap', 'beads'] } });
    // Carvings on a low bench before the third hut, masks on a board
    b.box(3.6, 0.3, -6.2, 3.4, 0.6, 0.9, WOOD);
    for (let i = 0; i < 6; i++) carving(b, 2.2 + i * 0.56, -6.2, 0.9 + ((i * 7) % 4) * 0.3, 0.6);
    b.box(6.6, 1.5, -6.6, 0.1, 2.2, 1.9, WOOD_DARK, { ry: 0.5 }); for (let i = 0; i < 4; i++) b.box(6.72 + (i % 2) * 0.24, 1.1 + Math.floor(i / 2) * 0.9, -6.9 + (i % 2) * 0.7, 0.14, 0.6, 0.4, ['#8a4a2e', '#e9e2cf', '#22252a', '#b5653f'][i]!, { ry: 0.5 });
    extra(b, 'crafts-carver', 4.4, -4.6, 2.8, 'sit', { seat: 0.5, look: { body: 'man', outfit: 'kaftan', outfitColor: 'navy', accessories: ['fila'] } });
    b.cyl(4.4, 0.25, -4.6, 0.3, 0.5, WOOD_DARK, { seg: 7 });
    // Baskets and calabashes at the right, cloth on a line at the left
    for (let i = 0; i < 6; i++) basket(b, 9.4 + (i % 3) * 1.1, -3.4 + Math.floor(i / 3) * 1.2, 0.42 + (i % 2) * 0.1, ['#e9614b', '#e8c43a', '#3f72c4', '#f1efe8', '#3d8f6a', '#dd6fa0'][i]!);
    for (let i = 0; i < 4; i++) b.ball(9.6 + i * 0.7, 0.26, -0.8, 0.3, 0.26, 0.3, i % 2 ? '#d9b46a' : '#c99a4e', { seg: 6 });
    for (const x of [-12.8, -6.6]) b.cyl(x, 1.5, 3.8, 0.08, 3, WOOD_DARK, { seg: 5 });
    b.box(-9.7, 2.9, 3.8, 6.2, 0.06, 0.06, '#c9b88f');
    for (let i = 0; i < 4; i++) adireCloth(b, -11.9 + i * 1.46, 1.9, 3.84, 1.3, 1.9, i, 0, ['#233c7c', '#8a3a2e', '#2f6f5c', '#233c7c'][i]!, i === 1 ? '#f1d9a0' : '#eae4d0');
    extra(b, 'crafts-seller', -9.6, 5.2, 0.3, 'stand', { look: { body: 'woman', outfit: 'owambe', outfitColor: 'blue', fabric: 'adire', hair: 'gele' } });
    // The middle of the court: a stack of big pots on a mat, a carved post with the village's name
    b.disc(1.4, 0.07, 2, 1.7, '#b98a4a', { seg: 12 });
    bellyPot(b, 1, 1.7, 1.5, 0); bellyPot(b, 2.1, 2.3, 1.3, 2); bellyPot(b, 1.4, 2.1, 1, 1, 1.2);
    for (const x of [-13, -3.6]) { b.box(x, 1.7, 9.8, 0.3, 3.4, 0.3, '#4a3224'); b.ball(x, 3.5, 9.8, 0.24, 0.3, 0.24, '#4a3224', { seg: 5 }); }
    labelled(b, label, -8.3, 2.5, 9.9, 8.4, 0.42, '#fbf1d4', '#5a3a26');
    thatchShelter(b, 10.6, 6.4, 2.1, 2.5); bench(b, 10.6, 6.2, { w: 2.2, color: WOOD });
    leafTree(b, -13.4, -5, { s: 1, tone: 0 }); bush(b, 6.6, 10.8, { color: '#8fa050' }); bush(b, 13, 10.6, { s: 1.1, color: '#8fa050' });
    hills(b, [[-40, -40, 15, 7], [34, -44, 20, 9]]); farTrees(b, rand, 10, -50, 50, -38, -17);
    return {
      spots: [
        landmark('pottery', /visit|pot|craft|learn|clay|look|village/, -1.2, -2.6, 2.6),
        landmark('work', /work|staff|shop|sell|job|shift|stall/, 6.4, -2.4, PI, { act: { pose: 'work' } }),
        landmark('cloth', /cloth|dye|line/, -8.4, 6.6, PI),
        landmark('people', /people|crowd|meet/, 1.4, 7.6, 0),
      ],
      crowd: [[3.4, 6.4, 0.4], [-2.4, 7.6, -0.5], [6.6, 4.2, 2.4], [-5, 6.4, 1.2], [6.6, 9.4, -0.8], [-3.4, 3.2, 0.8], [3, 10.4, 2.8], [-1.2, 10.6, 2.4], [-6.4, -1, 1.6], [5.4, 0.6, -0.4], [0.2, 9, 3.1], [-0.6, -8, 0.6]],
      spare: [[-3, 8.6], [5, 8], [0, 5.4], [4, 3.2]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The stadium, from its forecourt: an oval bowl of seats under a white ring roof, the pitch seen over the near wall,
// a floodlight mast at each corner, gates and ticket huts before it.

function stadiumBowl(b: Batch, cx: number, cz: number, A: number, B: number): void {
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * PI * 2, sin = Math.sin(a), cos = Math.cos(a), ry = Math.atan2(B * sin, A * cos);
    const chord = (Math.hypot(A * cos, B * sin) * PI * 2) / n, seat = (i >> 1) % 2 ? '#2f8f55' : '#f1efe8';
    for (let k = 0; k < 3; k++) {
      const f = 0.56 + k * 0.14, top = 1.4 + k * 1.6;
      b.at(cx + A * f * sin, 0, cz + B * f * cos, ry, () => b.box(0, top / 2, 0, chord * f * 1.08, top, 1.9, k === 1 ? seat : (i >> 1) % 2 ? '#f1efe8' : '#2f8f55'));
    }
    b.at(cx + A * sin, 0, cz + B * cos, ry, () => {
      b.box(0, 3.3, 0, chord * 1.07, 6.6, 0.5, '#dcd6c6'); b.box(0, 3.3, 0.3, 0.5, 6.6, 0.4, '#c4bdab');
      if (cos > 0.2) b.box(chord / 4, 4.7, 0.27, chord * 0.42, 1.5, 0.06, '#5d7488');
    });
    b.at(cx + A * 0.85 * sin, 7.9, cz + B * 0.85 * cos, ry, () => b.box(0, 0, 0, chord * 0.98, 0.18, 3.6, i % 2 ? '#f6f4ec' : '#eceae0', { rx: 0.13 }));
  }
  b.disc(cx, 0.05, cz, 1, '#b5654a', { sx: A * 0.5, sz: B * 0.5, seg: 22 }); b.disc(cx, 0.07, cz, 1, '#4e9944', { sx: A * 0.42, sz: B * 0.38, seg: 22 });
  b.box(cx, 0.09, cz, A * 0.56, 0.02, B * 0.46, '#58a24c'); b.box(cx, 0.11, cz, 0.1, 0.02, B * 0.46, '#f4f1e6'); b.disc(cx, 0.115, cz, 1, '#f4f1e6', { seg: 14 }); b.disc(cx, 0.12, cz, 0.88, '#58a24c', { seg: 14 });
}
function mast(b: Batch, x: number, z: number, h: number, ry: number): void {
  b.cyl(x, h / 2, z, 0.26, h, METAL, { seg: 6, top: 0.5 });
  b.at(x, h + 0.7, z, ry, () => { b.box(0, 0, 0, 2.8, 1.9, 0.3, METAL_DARK); for (let i = 0; i < 8; i++) b.quad(-0.99 + (i % 4) * 0.66, 0.42 - Math.floor(i / 4) * 0.84, 0.17, 0.5, 0.6, '#fff3c4', GLOW); });
}

const stadium: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  camera: { landscape: [20, 29, 37], portrait: [14, 50, 72], start: 5.4 },
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b, '#a9aa78');
    ground(b, { w: 30, d: 26, color: PAVING, edge: '#8f8977' });
    for (let x = -12; x <= 12; x += 4) b.box(x, 0.04, 7, 0.1, 0.02, 11, '#c4bca6');
    stadiumBowl(b, 0, -9.8, 13.4, 8.6);
    mast(b, -11.8, -2.4, 13, PI); mast(b, 11.8, -2.4, 13, PI); mast(b, -11.8, -17.2, 13, 0); mast(b, 11.8, -17.2, 13, 0);
    // The way in: a canopy on columns with the stadium's name, dark gateways in the wall behind it, turnstile rails
    b.box(0, 3.8, 0.4, 10.4, 0.6, 3, '#f4f2ea'); for (const x of [-4.6, -1.6, 1.6, 4.6]) b.cyl(x, 1.75, 1.6, 0.2, 3.5, '#f4f2ea', { seg: 8 });
    labelled(b, label, 0, 3.8, 1.92, 9.6, 0.44, '#f4efe0', '#1f6f4a', true);
    for (const x of [-3.1, 0, 3.1]) { b.box(x, 1.3, -0.82, 2, 2.6, 0.12, '#2b2f33'); b.box(x, 0.55, 2.6, 0.08, 1.1, 1.4, METAL_DARK); }
    // Ticket huts at the left, flags, a board of fixtures, planters, fans arriving
    kiosk(b, -11.4, 6.2, { ry: HALF, w: 3.2, color: '#e9e6dc', roof: '#2f8f55', fascia: '#f4f2ea', text: 'TICKETS', textColor: '#1f6f4a' });
    for (let i = 0; i < 5; i++) flag(b, 6.4 + i * 1.7, 4.2 + (i % 2) * 0.01, { h: 6.2, w: 1.4, colors: [...NATION] });
    b.box(9.6, 1.7, 8.4, 0.2, 2.2, 3, '#1a1c20', { ry: -0.4 }); for (const dz of [-1.2, 1.2]) b.box(9.6 + dz * 0.39, 0.5, 8.4 + dz * 0.92, 0.12, 1, 0.12, METAL_DARK);
    for (const [x, z] of ([[-5.6, 5.4], [5.2, 9.6], [-7.4, 10.4]] as [number, number][])) { b.box(x, 0.3, z, 1.5, 0.6, 1.5, '#bdb6a5'); b.ico(x, 1.1, z, 0.75, 0.7, 0.75, LEAF); }
    extra(b, 'stadium-fan-1', -2.4, 4.4, 2.9, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'green', hair: 'lowcut' } });
    extra(b, 'stadium-fan-2', 3.6, 5.6, -2.6, 'wave', { look: { body: 'woman', outfit: 'jersey', outfitColor: 'green' } });
    extra(b, 'stadium-steward', 1.6, 2.8, 0, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'gold', bottomsColor: 'navy', fabric: 'plain', accessories: ['cap'] } });
    lampPost(b, -6.4, 8.6, { light: true, h: 5 }); lampPost(b, 12.6, 10.4, { h: 5 });
    return {
      spots: [
        landmark('gates', /visit|gate|stadium|forecourt|bowl|look|learn|match/, -0.6, 4.4, PI),
        landmark('work', /work|staff|ticket|steward|job|shift/, -8.4, 6.2, -HALF, { act: { pose: 'work' } }),
        landmark('flags', /flag|board|fixture/, 7, 7.4, HALF),
        landmark('people', /people|crowd|meet/, 2, 8.4, 0),
      ],
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [6.4, 6.4, 2.4], [-5, 8.6, 1.2], [8, 10.6, -0.8], [-9.4, 9.4, 0.8], [3, 10.4, 2.8], [-4.2, 10.6, 2.4], [-11.6, 2.6, 1.6], [12, 6.6, -0.4], [0.2, 9.6, 3.1], [4.6, 3, 0.6]],
      spare: frontSpare(),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The velodrome: a hall round an oval track of pale boards, steeply banked at its two ends, with riders on the straight,
// the blue band and the racing lines, and seats along the rail where visitors stand.

/** One board-surfaced piece of track at a point on the oval: its inner edge on the floor, its outer edge raised by the banking, a rail along the top. */
function trackPiece(b: Batch, x: number, z: number, ry: number, len: number, bank: number, i: number): void {
  const W = 2.6, lift = (W / 2) * Math.sin(bank) + 0.06;
  b.at(x, 0, z, ry, () => {
    b.at(0, lift, 0, 0, () => {
      b.box(0, 0, 0, len, 0.1, W, i % 2 ? '#d9b27a' : '#cfa66c');
      b.box(0, 0.06, -W / 2 + 0.22, len, 0.02, 0.44, '#5fb0d6'); b.box(0, 0.06, -W / 2 + 0.8, len, 0.02, 0.07, '#22252a'); b.box(0, 0.06, 0.1, len, 0.02, 0.07, '#c9423a');
    }, -bank);
    b.box(0, W * Math.sin(bank) + 0.5, (W / 2) * (1 + Math.cos(bank)) / 2 + W / 4 * Math.cos(bank) + 0.1, len, 0.9, 0.08, '#e9e6dc');
  });
}
/** A track bicycle standing along x, with a rider's seat at about 1.05. */
function trackBike(b: Batch, x: number, y: number, z: number, ry: number, colour: Colour): void {
  b.at(x, y, z, ry, () => {
    for (const s of [-1, 1]) b.cyl(0, 0.36, s * 0.55, 0.36, 0.05, BLACK, { seg: 9, rz: HALF });
    b.box(0, 0.62, 0, 0.06, 0.06, 1, colour, { rx: 0.2 }); b.box(0, 0.8, -0.2, 0.06, 0.5, 0.06, colour); b.box(0, 1.02, -0.26, 0.16, 0.05, 0.3, BLACK); b.box(0, 0.98, 0.5, 0.5, 0.05, 0.05, METAL_DARK);
  });
}

const velodrome: SceneDef = {
  mood: 'indoor', accent: '#e0a43a',
  camera: { landscape: [16, 21, 27], portrait: [13, 46, 66] },
  walk: INDOORS,
  build(b, context) {
    const label = plain(context.label), cz = -2.7, half = 4.2, R = 5;
    room(b, { w: 24, d: 20, h: 6.4, floor: '#aab1b3', wall: '#e3e6e4', trim: '#7d858c' });
    // The infield: a blue apron inside the track, bicycles on a rack, a bench, a table for the timekeepers
    b.box(0, 0.07, cz, half * 2, 0.04, (R - 1.4) * 2, '#7fa6b4'); for (const s of [-1, 1]) b.disc(s * half, 0.09, cz, R - 1.4, '#7fa6b4', { seg: 16 });
    b.box(-3, 0.5, cz - 0.6, 2.6, 0.06, 0.06, METAL_DARK); for (let i = 0; i < 3; i++) trackBike(b, -3.8 + i * 0.8, 0, cz - 0.6, HALF, ['#c9423a', '#2f8f55', '#f1efe8'][i]!);
    table(b, 2.6, cz + 0.4, { w: 2.4, d: 1, color: '#e9e6dc', leg: METAL_DARK }); chair(b, 2.6, cz - 0.5, { color: '#2f8f55' }); b.box(2.2, 1.2, cz + 0.4, 0.5, 0.3, 0.3, '#1a1c20');
    bench(b, -1, cz + 1.6, { w: 3, color: '#6a6e72', leg: METAL_DARK });
    // The track: two straights with a gentle bank, two ends that turn through half a circle banked steeply
    let n = 0;
    for (const side of [1, -1]) for (const dx of [-half / 2, half / 2]) trackPiece(b, dx, cz + side * R, side > 0 ? 0 : PI, half + 0.04, 0.24, n++);
    for (const end of [1, -1]) for (let j = 0; j < 8; j++) {
      const a = ((j + 0.5) * PI) / 8 + (end > 0 ? 0 : PI);
      trackPiece(b, end * half + R * Math.sin(a), cz + R * Math.cos(a), a, 2.52, j === 0 || j === 7 ? 0.44 : 0.66, n++);
    }
    for (const [x, ry, c, look] of ([[1.8, -HALF, '#c9423a', 'red'], [-2.6, -HALF, '#3f72c4', 'blue']] as [number, number, Colour, string][])) {
      trackBike(b, x, 0.22, cz + R - 0.5, HALF, c);
      extra(b, `velo-rider-${look}`, x - 0.2, cz + R - 0.5, ry, 'sit', { y: 0.22, seat: 1.05, look: { body: 'man', outfit: 'jersey', outfitColor: look, hair: 'lowcut' } });
    }
    // Round the walls: the hall's name, bands in the national colours, a lap board, lamps hung over the track
    labelled(b, label, 0, 4.9, -9.86, 9.6, 0.6, '#f4efe0', '#27437a', true);
    for (let i = 0; i < 3; i++) b.box(0, 2.5 + i * 0.5, -9.9, 23.6, 0.5, 0.08, NATION[i]!);
    b.box(-11.86, 4, -1, 0.12, 1.6, 3.4, '#1a1c20'); sign(b, -11.78, 4.3, -1, 'LAP', { size: 0.42, color: '#ffe07a', ry: HALF, lit: true }); sign(b, -11.78, 3.6, -1, '12', { size: 0.5, color: '#9fd8ff', ry: HALF, lit: true });
    for (const x of [-6, 0, 6]) { b.box(x, 6.2, cz, 2.2, 0.16, 0.5, METAL_DARK); b.box(x, 6.08, cz, 1.9, 0.08, 0.34, '#fff3c4', GLOW); }
    b.light(0, 5.6, cz, '#fff0d2', 24, 16);
    // The visitors' side: a rail above the home straight, two rows of seats, a mechanic's stand with a bike on it
    for (const s of [-1, 1]) { b.box(s * 6.2, 1, 4.9, 10.4, 0.08, 0.08, METAL_DARK); for (let i = 0; i < 6; i++) b.box(s * (1.2 + i * 2), 0.5, 4.9, 0.08, 1, 0.08, METAL_DARK); }
    for (const s of [-1, 1]) for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) chair(b, s * (3 + i * 0.95), 6.6 + r * 1.2, { ry: PI, color: (i + r) % 2 ? '#2f8f55' : '#f1efe8', seat: 0.6 + r * 0.14 });
    b.at(9.4, 0, 6.8, 0, () => {
      b.box(0, 0.7, 0, 0.1, 1.4, 0.1, METAL_DARK); b.box(0, 0.05, 0, 0.9, 0.1, 0.9, METAL_DARK); trackBike(b, 0, 1.0, 0, 0.3, '#e0a43a');
      b.box(1.2, 0.3, 0.2, 0.8, 0.6, 0.5, '#c9423a'); b.box(1.2, 0.64, 0.2, 0.84, 0.08, 0.54, '#22252a');
    });
    extra(b, 'velo-mechanic', 8.2, 7, HALF, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'navy', accessories: ['cap'] } });
    extra(b, 'velo-watcher', -3.95, 6.6, PI, 'sit', { seat: 0.6, look: { body: 'woman', outfit: 'casual', outfitColor: 'gold' } });
    return {
      spots: [
        landmark('rail', /visit|rail|track|watch|ride|cycle|look|learn/, 0, 5.8, PI),
        landmark('work', /work|staff|mechanic|bike|job|shift/, 7.6, 8.4, 0.4, { act: { pose: 'work' } }),
        landmark('seats', /seat|sit|stand/, -8.6, 8.4, PI),
        landmark('people', /people|crowd|meet/, 1.6, 8, 0),
      ],
      crowd: [[2.2, 8.4, 0.4], [-2.2, 8.6, -0.5], [1.2, 6, 2.9], [-1.4, 6.2, 3], [9.6, 8.8, -0.8], [-9.6, 7, 2.8], [3, 9.2, 2.8], [-5.2, 9.2, 2.4], [-10.6, 8.8, 1.6], [10.6, 5.6, PI], [0.2, 7.4, 3.1], [-10.4, 5.6, PI]],
      spare: [[-2, 8], [2, 7.4], [-1, 9], [1, 9]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The city gate, from a lay-by: an expressway of two carriageways runs away under a monumental gate of three tapering
// towers and a deep beam; the lay-by beside it has a rail, bays, a board with the gate's name and seats.

const gate: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  camera: { landscape: [19, 17, 34], portrait: [16, 34, 82], start: 5.6 },
  walk: { bounds: [-1.6, -12.2, 14.2, 12.2], entrance: [5, 11.4], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(53);
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#a9aa68', edge: '#74703f' });
    // The expressway: two carriageways and a planted median, running on over the plain to the hills
    b.box(-9.4, -0.24, -48, 12.4, 0.06, 72, '#77746d'); b.box(-9.4, -0.2, -48, 1.2, 0.06, 72, '#8fa050');
    b.box(-9.4, 0.04, 0, 12.4, 0.05, 26, '#77746d'); b.box(-9.4, 0.12, 0, 1.2, 0.2, 26, '#9aa46a');
    for (const x of [-12.5, -6.3]) for (let z = -11.6; z < 13; z += 3) b.box(x, 0.075, z, 0.14, 0.02, 1.5, '#f4f1e6');
    for (const x of [-15.4, -3.4]) b.box(x, 0.075, 0, 0.16, 0.02, 26, '#f2c14e');
    for (let z = -10; z <= 10; z += 5) { b.cyl(-9.4, 4, z + 2, 0.1, 8, METAL, { seg: 5 }); b.box(-9.4, 7.9, z + 2, 3.2, 0.1, 0.1, METAL); for (const s of [-1, 1]) b.box(-9.4 + s * 1.5, 7.82, z + 2, 0.5, 0.12, 0.26, '#fff3c4', GLOW); }
    // The gate across the road: three towers that taper as they rise, green bands, a deep beam and a stepped crown
    for (const x of [-15.9, -9.4, -2.9]) {
      b.cyl(x, 5.2, -6.4, x === -9.4 ? 1.1 : 1.9, 10.4, STONE, { seg: 4, ry: PI / 4, top: 0.62 });
      b.box(x, 3.4, -5.6 + (x === -9.4 ? 0.5 : 0), x === -9.4 ? 0.5 : 0.8, 5.6, 0.1, '#2f8f55');
    }
    b.box(-9.4, 10.6, -6.4, 16.4, 2, 2.4, STONE); b.box(-9.4, 11.7, -6.4, 16.9, 0.3, 2.8, STONE_DARK);
    for (const x of [-12.65, -6.15]) { b.box(x, 9.2, -6.4, 4.2, 1, 2, STONE_DARK); for (const s of [-1, 1]) b.box(x + s * 2.4, 9, -6.4, 1.6, 0.5, 2, STONE_DARK, { rz: s * 0.6 }); }
    for (let i = 0; i < 3; i++) b.box(-9.4 + (i - 1) * 3.4, 10.6, -5.17, 3.4, 1.2, 0.06, NATION[i]!);
    b.box(-9.4, 12.5, -6.4, 6, 1.3, 2.2, STONE); b.box(-9.4, 13.5, -6.4, 3, 0.8, 2, STONE); b.box(-9.4, 13.25, -6.4, 6.4, 0.2, 2.5, STONE_DARK);
    for (const s of [-1, 1]) b.at(-9.4 + s * 7.4, 11.8, -6.4, 0, () => flag(b, 0, 0, { h: 3.4, w: 1.2, colors: [...NATION] }));
    // Traffic on the near side of the gate
    car(b, -6.4, 4.4, { ry: PI, color: '#e9e6dc' }); car(b, -12.4, -1.6, { color: '#8a3a2e' }); car(b, -6.2, -10, { ry: PI, color: '#2f8f55' }); b.box(-6.2, 0.62, -10, 1.94, 0.2, 4.24, WHITE);
    b.at(-12.6, 0, 8, 0, () => { b.box(0, 1.5, 0, 2.2, 2.4, 6, '#e9e6dc'); b.box(0, 1.9, 0, 2.24, 0.8, 5.6, '#2b3a48'); b.box(0, 1.0, 0, 2.24, 0.3, 6.04, '#3f72c4'); for (const sz of [-2, 2]) for (const sx of [-1, 1]) b.cyl(sx * 1, 0.42, sz, 0.42, 0.3, BLACK, { seg: 8, rz: HALF }); });
    // The lay-by: a kerb and a steel rail along the road, parking bays, a board with the gate's name, seats, a hut
    b.box(6.4, 0.04, 0.6, 15, 0.04, 23, '#cfc9b8'); b.box(-2.2, 0.45, 0, 0.1, 0.3, 24, METAL); for (let z = -11.6; z <= 11.6; z += 2.9) b.box(-2.2, 0.3, z, 0.14, 0.6, 0.14, METAL_DARK);
    for (let i = 0; i < 4; i++) b.box(13.9 - 2.4, 0.07, -9.4 + i * 3, 4.8, 0.02, 0.12, '#f4f1e6');
    car(b, 11.6, -7.9, { ry: -HALF, color: '#3f72c4' }); car(b, 11.6, -1.9, { ry: -HALF, color: '#6a6e72' });
    b.box(2.6, 2, -4.6, 5.6, 1.6, 0.2, '#1f6f4a'); for (const s of [-1, 1]) b.box(2.6 + s * 2.5, 0.7, -4.6, 0.16, 1.4, 0.16, METAL_DARK);
    sign(b, 2.6, 2, -4.48, label, { size: fit(label, 5, 0.5), color: '#f4efe0' });
    bench(b, 1, 3.4, { w: 2.6, back: true, ry: -HALF, color: '#8f8a7d', leg: '#6a665c' }); bench(b, 1, 7.4, { w: 2.6, back: true, ry: -HALF, color: '#8f8a7d', leg: '#6a665c' });
    kiosk(b, 11.4, 5.4, { ry: -HALF, w: 3, color: '#e9e2cf', roof: '#2f8f55', fascia: '#f4f2ea', text: 'GUIDE', textColor: '#1f6f4a' });
    extra(b, 'gate-guide', 12, 5.4, -HALF, 'work', { look: { body: 'woman', outfit: 'office', outfitColor: 'green', bottomsColor: 'navy', fabric: 'plain' } });
    extra(b, 'gate-visitor-1', 0.2, -1.6, -2.3, 'wave', { look: { body: 'man', outfit: 'casual', outfitColor: 'orange', accessories: ['sunglasses'] } });
    extra(b, 'gate-visitor-2', 1, 3.4, -HALF, 'sit', { seat: 0.6, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'violet', accessories: ['headwrap'] } });
    lampPost(b, 4.6, 9.6, { light: true, h: 5 }); lampPost(b, 4.6, -9.6, { h: 5 }); palm(b, 13.6, -11.4, { s: 1.1 }); palm(b, 13.4, -4.6, { s: 1 }); bush(b, 6.6, -6, { color: '#8fa050' });
    // Far ground: the monolith and low hills beyond the gate
    monolith(b, 16, -52, 0.9); hills(b, [[-38, -44, 16, 7], [40, -40, 14, 6]]); farTrees(b, rand, 12, -2, 50, -40, -16); farTrees(b, rand, 6, -50, -18, -40, -10);
    return {
      spots: [
        landmark('view', /visit|view|gate|lay|look|learn|photo/, 1.2, -1.4, -2.3),
        landmark('work', /work|staff|guide|hut|job|shift/, 8.6, 5.4, HALF, { act: { pose: 'work' } }),
        landmark('seats', /seat|bench|sit|rest/, 3, 5.4, -HALF),
        landmark('people', /people|crowd|meet/, 5.6, 8, 0),
      ],
      crowd: [[6.4, 7.4, 0.4], [3.2, 8.6, -0.5], [8.6, 9.2, 2.4], [4.4, 2.2, -2], [9.6, 1.2, -0.8], [2.6, 10.6, 0.8], [7, 10.6, 2.8], [5.2, -1.4, -2.2], [7.4, -5.4, -2], [12, 9, -0.4], [6.2, 4.6, 3.1], [3.4, -8, -2.4]],
      spare: [[5, 8.6], [7, 9], [4, 6.4], [6.4, 2.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The lakeside park: a paved promenade with a rail along a wide lake, a jetty with boats for hire, picnic lawns and
// shelters, and across the water the long outline of a mall under trees.

function rowBoat(b: Batch, x: number, y: number, z: number, ry: number, colour: Colour): void {
  b.at(x, y, z, ry, () => {
    b.ball(0, 0.16, 0, 0.62, 0.34, 1.7, colour, { seg: 7 }); b.box(0, 0.36, 0, 1.0, 0.06, 2.9, '#f1efe8', { ry: 0 });
    b.box(0, 0.33, 0, 0.86, 0.1, 2.5, '#6a5444'); for (const s of [-0.6, 0.5]) b.box(0, 0.44, s, 0.96, 0.06, 0.26, WOOD_LIGHT);
  });
}

const lake: SceneDef = {
  mood: 'outdoor', accent: '#3f9ac4',
  camera: { landscape: [16, 14, 29], portrait: [13, 30, 78] },
  walk: { bounds: [-14.2, -2.2, 14.2, 12.2], entrance: [0, 11.4], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(67);
    plainLand(b, '#8fae62');
    ground(b, { w: 30, d: 26, color: '#62a04f', edge: LAWN_EDGE });
    // The lake: water from the promenade's edge away to the far shore, lighter where the sky lies on it
    b.disc(0, 0.06, -28, 1, '#3d7f96', { sx: 60, sz: 25, seg: 24 });
    b.disc(0, 0.1, -28, 1, '#5fa3ba', { sx: 60, sz: 25, seg: 24, ...GLASS });
    for (let i = 0; i < 9; i++) b.box(-30 + rand() * 60, 0.14, -8 - rand() * 30, 3 + rand() * 5, 0.01, 0.16, '#a9d3e0');
    // The far shore: a long low mall with a drum at its entrance and a white band along its roof, trees, hills
    b.box(0, 0.4, -52, 110, 1.2, 4, '#7a9a5a');
    b.box(-2, 4, -54, 38, 7.4, 8, '#e3ddd0'); b.box(-2, 7.9, -54, 38.6, 0.8, 8.4, '#f4f2ea'); b.box(-2, 3.6, -49.96, 36, 2.2, 0.06, '#6f8f9f');
    b.cyl(9, 5, -51, 4.6, 9.4, '#d9d3c4', { seg: 14 }); b.cyl(9, 9.9, -51, 4.9, 0.6, '#f4f2ea', { seg: 14 }); b.box(-16, 9, -55, 9, 2.6, 6, '#d3ccbc');
    farTrees(b, rand, 12, -50, 50, -50.5, -49.5); hills(b, [[-44, -66, 20, 9], [36, -68, 24, 10]]);
    // The promenade: pale paving along the shore, a rail with lamp standards, the jetty running out from a gap in it
    b.box(0, 0.05, -0.6, 30, 0.05, 4.6, PAVING); b.box(0, 0.06, -2.8, 30, 0.06, 0.4, STONE_DARK);
    for (const [x0, x1] of ([[-14.6, 4.4], [8, 14.6]] as [number, number][])) { b.box((x0 + x1) / 2, 1.05, -2.8, x1 - x0, 0.08, 0.1, METAL_DARK); b.box((x0 + x1) / 2, 0.6, -2.8, x1 - x0, 0.05, 0.06, METAL_DARK); for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / Math.round((x1 - x0) / 2.1)) b.box(x, 0.55, -2.8, 0.1, 1.1, 0.1, METAL_DARK); }
    b.box(6.2, 0.2, -7.6, 2.6, 0.14, 9.6, '#a8865a'); for (let i = 0; i < 5; i++) for (const s of [-1, 1]) b.cyl(6.2 + s * 1.2, 0.1, -3.6 - i * 2.1, 0.12, 1.1, WOOD_DARK, { seg: 5 });
    rowBoat(b, 4, 0.1, -6, 0.1, '#c9423a'); rowBoat(b, 4.1, 0.1, -9.6, -0.1, '#e8c43a'); rowBoat(b, 8.4, 0.1, -7.2, 0.2, '#3f72c4'); rowBoat(b, 8.6, 0.1, -10.8, -0.15, '#f1efe8');
    rowBoat(b, -9, 0.1, -17, 1.1, '#2f8f55'); b.box(-9, 0.9, -17, 0.5, 0.9, 0.4, '#e0822f'); b.ball(-9, 1.5, -17, 0.2, 0.22, 0.2, '#6a4a34', { seg: 5 });
    kiosk(b, 10.6, 0.2, { ry: PI, w: 3, color: '#e9e2cf', roof: '#3f72c4', fascia: '#f4f2ea', text: 'BOATS', textColor: '#27437a' });
    extra(b, 'lake-boatman', 10.6, 1.4, 0, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'blue', accessories: ['cap'] } });
    // The lawns: a path up from the gate, picnic mats and a shelter, benches that face the water, trees
    b.box(0, 0.05, 6.6, 2.6, 0.04, 10, '#dcc99a');
    thatchShelter(b, -9.6, 6.4, 2.3, 2.6); table(b, -9.6, 6.4, { w: 1.5, d: 1.5, h: 0.8, round: true });
    b.box(7.4, 0.07, 6.4, 2.8, 0.03, 2, '#c9423a', { ry: 0.3 }); b.box(7.4, 0.08, 6.4, 2.8, 0.03, 0.3, '#f4f2ea', { ry: 0.3 }); b.cyl(8.2, 0.3, 6.8, 0.3, 0.44, '#c9a56a', { seg: 7, top: 1.2 });
    extra(b, 'lake-picnic-1', 7, 6.2, 2.4, 'sit', { seat: 0.14, look: { body: 'woman', outfit: 'casual', outfitColor: 'pink' } });
    extra(b, 'lake-jogger', -3.4, -0.4, HALF, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'orange', hair: 'lowcut' } });
    bench(b, -4.6, 1.2, { w: 2.6, back: true, ry: PI, color: '#8f9384', leg: '#6f766c' }); bench(b, 2.8, 1.2, { w: 2.6, back: true, ry: PI, color: '#8f9384', leg: '#6f766c' });
    for (const [x, z, s, t] of ([[-13, 2.6, 1.1, 0], [-12.6, 10.8, 1, 1], [-13.2, 6.6, 0.9, 2]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    palm(b, -6.8, 2.4, { s: 1 }); palm(b, 13.4, 2.2, { s: 1.05, ry: PI }); bush(b, -4.2, 9.4, { color: '#c0407e' }); bush(b, 11, 10.6);
    for (const x of [-10.5, -1, 12.6]) lampPost(b, x, -2.2, { light: x === -1 });
    signBoard(b, -5.4, 10.6, label, { y: 1.7, size: fit(label, 5.6, 0.4), color: '#f4efe0', board: '#27507c' });
    return {
      spots: [
        landmark('promenade', /walk|lake|promenade|visit|water|look/, 0.6, -1.4, PI),
        landmark('work', /work|staff|boat|hire|job|shift/, 8.2, 2.6, HALF, { act: { pose: 'work' } }),
        landmark('lawn', /lawn|picnic|rest|sit/, -6.4, 5.4, -HALF),
        landmark('people', /people|crowd|meet/, 1.6, 6.4, 0),
      ],
      crowd: [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [4.6, 3.6, 2.4], [-6, 8.8, 1.2], [9.6, 9.4, -0.8], [-4.4, 4.6, 0.8], [3, 10.4, 2.8], [-2.6, 10.6, 2.4], [-8.4, -0.4, PI], [12.4, -0.6, PI], [0.2, 4.6, 3.1], [-12.4, -0.8, PI]],
      spare: [[-2, 8.6], [3, 9], [-3, 5.4], [3.4, 5.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The children's park and zoo: a playground on the front lawn, three paddocks behind pole fences along the back, and the
// monolith rising close behind the trees.

function giraffe(b: Batch, x: number, z: number, ry: number): void {
  const coat = '#dba94e', patch = '#8a5a2e';
  b.at(x, 0, z, ry, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.28, 1.1, sz * 0.62, 0.16, 2.2, 0.16, coat);
    b.box(0, 2.6, 0, 0.7, 0.9, 1.8, coat); b.box(0, 4, 1.24, 0.34, 2.9, 0.4, coat, { rx: 0.42 }); b.box(0, 5.36, 2.02, 0.3, 0.34, 0.74, coat);
    for (const sx of [-1, 1]) b.box(sx * 0.1, 5.66, 1.8, 0.05, 0.3, 0.05, patch);
    for (const [py, pz] of ([[2.7, -0.5], [2.5, 0.3], [2.9, 0.7], [3.4, 0.98], [4.3, 1.4]] as [number, number][])) b.box(0, py, pz, 0.72, 0.3, 0.34, patch);
    b.box(0, 2.3, -0.96, 0.06, 0.9, 0.06, patch);
  });
}
function zebra(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => {
    b.ball(0, 1.15, 0, 0.36, 0.42, 0.86, '#f1efe8', { seg: 6 }); b.box(0, 1.6, 0.74, 0.26, 0.8, 0.34, '#f1efe8', { rx: 0.6 }); b.box(0, 1.92, 1.14, 0.22, 0.26, 0.5, '#f1efe8');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.2, 0.42, sz * 0.56, 0.12, 0.84, 0.12, '#f1efe8');
    for (let i = 0; i < 5; i++) b.box(0, 1.17, -0.6 + i * 0.3, 0.76, 0.84, 0.07, '#22252a');
    b.box(0, 1.75, 0.6, 0.06, 0.5, 0.4, '#22252a', { rx: 0.6 });
  });
}
function ostrich(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => {
    b.ball(0, 1.5, 0, 0.42, 0.42, 0.6, '#2f2a28', { seg: 6 }); b.box(0, 1.56, -0.5, 0.5, 0.3, 0.3, '#e9e6dc');
    b.box(0, 2.2, 0.56, 0.1, 1.3, 0.1, '#d9b8a8', { rx: 0.2 }); b.ball(0, 2.9, 0.72, 0.13, 0.12, 0.18, '#d9b8a8', { seg: 5 });
    for (const sx of [-1, 1]) b.box(sx * 0.14, 0.6, 0, 0.08, 1.2, 0.08, '#d9b8a8');
  });
}

const zoo: SceneDef = {
  mood: 'outdoor', accent: '#f2c14e',
  camera: { landscape: [16, 13.5, 29], portrait: [13, 30, 78] },
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    plainLand(b, '#93ad63');
    ground(b, { w: 30, d: 26, color: '#62a04f', edge: LAWN_EDGE });
    b.box(0, 0.04, -3.4, 29, 0.04, 2.6, '#dcc99a'); b.box(0.6, 0.04, 4.4, 2.6, 0.04, 14, '#dcc99a');
    // The paddocks: sandy ground behind pole fences, a board to each
    b.box(0, 0.05, -9, 29.4, 0.05, 7.4, '#d9c79c');
    fence(b, [-14.6, -5.2], [14.6, -5.2], { h: 1.4, color: '#8a6a44', gap: 1.5 });
    for (const x of [-4.8, 4.8]) fence(b, [x, -5.2], [x, -12.6], { h: 1.4, color: '#8a6a44', gap: 1.5 });
    giraffe(b, -10.6, -9.6, 0.5); giraffe(b, -7.6, -8, 2.4); zebra(b, -1.6, -8.4, 0.9); zebra(b, 1.8, -10.2, -0.6); zebra(b, 2.6, -7.2, 2.2); ostrich(b, 8.4, -8.6, 0.4); ostrich(b, 11.6, -10.4, -1.2);
    for (const [x, z] of ([[-13, -11.4], [0, -11.8], [13, -7]] as [number, number][])) { b.cyl(x, 1.6, z, 0.2, 3.2, '#6b5440', { seg: 6 }); b.ico(x, 3.8, z, 2, 1.1, 1.8, '#5f8a4a'); }
    b.box(11, 0.3, -11.6, 2.6, 0.6, 1.4, '#8a6a44'); b.box(7, 0.14, -6.6, 1.2, 0.28, 0.6, '#6a6e72');
    for (const x of [-9.6, 0, 9.6]) { b.box(x, 0.8, -4.9, 0.1, 1.6, 0.1, WOOD_DARK); b.box(x, 1.5, -4.84, 1.3, 0.8, 0.08, '#f4f2ea'); b.box(x, 1.6, -4.79, 1, 0.12, 0.02, '#2f6f4a'); b.box(x, 1.36, -4.79, 0.8, 0.08, 0.02, '#6a6e72'); }
    // The monolith close behind the trees
    monolith(b, 2, -30, 1.05);
    for (let i = 0; i < 8; i++) leafTree(b, -15.5 + i * 4.6, -15.4 - (i % 2) * 1.6, { s: 1.2 + (i % 3) * 0.15, tone: i });
    // The playground on a bed of sand: a slide, swings, a roundabout, a see-saw
    b.box(-8.4, 0.05, 4.6, 10.4, 0.05, 9.4, '#e3d3a4');
    b.at(-11, 0, 2.4, 0.3, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.6, 1.1, sz * 0.6, 0.12, 2.2, 0.12, '#3f72c4');
      b.box(0, 2.2, 0, 1.4, 0.1, 1.4, '#3f72c4'); for (let i = 0; i < 4; i++) b.box(0, 0.4 + i * 0.5, -0.75, 0.9, 0.06, 0.1, '#f2c14e');
      b.box(0, 1.14, 2.3, 0.9, 0.08, 3.6, '#c9423a', { rx: 0.62 }); for (const sx of [-1, 1]) b.box(sx * 0.48, 1.26, 2.3, 0.06, 0.24, 3.6, '#f2c14e', { rx: 0.62 });
    });
    b.at(-6, 0, 3, -0.2, () => {
      for (const s of [-1, 1]) { b.box(s * 1.8, 1.4, 0, 0.12, 2.9, 0.12, '#2f8f55', { rx: 0.25 }); b.box(s * 1.8, 1.4, 0, 0.12, 2.9, 0.12, '#2f8f55', { rx: -0.25 }); }
      b.box(0, 2.8, 0, 3.8, 0.12, 0.12, '#2f8f55');
      for (const s of [-0.8, 0.8]) { b.box(s - 0.2, 1.65, 0, 0.03, 2.2, 0.03, METAL_DARK); b.box(s + 0.2, 1.65, 0, 0.03, 2.2, 0.03, METAL_DARK); b.box(s, 0.55, 0, 0.5, 0.06, 0.24, '#c9423a'); }
    });
    b.cyl(-10.6, 0.3, 7.4, 1.3, 0.12, '#e0822f', { seg: 10 }); b.cyl(-10.6, 0.5, 7.4, 0.08, 1, METAL_DARK, { seg: 5 }); for (let i = 0; i < 4; i++) b.box(-10.6, 0.98, 7.4, 2.4, 0.06, 0.06, '#3f72c4', { ry: i * 0.785 });
    b.at(-5.6, 0, 7.6, 0.5, () => { b.box(0, 0.36, 0, 0.3, 0.7, 0.3, '#f2c14e'); b.box(0, 0.76, 0, 3.6, 0.1, 0.3, '#3f72c4', { rz: 0.16 }); });
    // A ticket hut and the park's name at the right, a shelter with seats, a keeper at the fence
    kiosk(b, 11.6, 3.4, { ry: -HALF, w: 3, color: '#f2e2a8', roof: '#c9423a', fascia: '#f4f2ea', text: 'TICKETS', textColor: '#8a3a2e' });
    for (const x of [4.4, 12.6]) b.cyl(x, 2, 10.9, 0.12, 4, '#3f72c4', { seg: 6 });
    labelled(b, label, 8.5, 3.6, 10.9, 7.6, 0.4, '#f4efe0', '#2f6f4a');
    thatchShelter(b, 7.4, 6.4, 2, 2.5); bench(b, 7.4, 6.2, { w: 2.2, color: WOOD });
    extra(b, 'zoo-keeper', -7.6, -4, PI, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'green', accessories: ['cap'] } });
    extra(b, 'zoo-visitor-1', 2.4, -3.6, PI, 'wave', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', accessories: ['handbag'] } });
    extra(b, 'zoo-visitor-2', -3.4, 5.4, -HALF, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'blue' } });
    lampPost(b, -1.4, 0.4, { light: true }); lampPost(b, 4, -1.6); bush(b, 13.4, -2.4); bush(b, -13.6, -2.2, { color: '#c0407e' });
    return {
      spots: [
        landmark('paddocks', /visit|paddock|zoo|animal|look|learn|park/, 0.2, -3.2, PI),
        landmark('work', /work|staff|keeper|feed|job|shift/, -5.4, -3.6, PI, { act: { pose: 'work' } }),
        landmark('play', /play|swing|slide|sand/, -2.4, 3.2, -HALF),
        landmark('people', /people|crowd|meet/, 2.6, 8, 0),
      ],
      crowd: [[2.4, 7.4, 0.4], [-1.4, 8.6, -0.5], [4.6, 3.2, 2.4], [-1.6, 0.6, 1.2], [9.6, 8.8, -0.8], [-2.4, 10.6, 0.8], [3, 10.4, 2.8], [6.4, -2.6, 3], [-11, -3.4, PI], [11.4, -2.8, PI], [0.6, 5, 3.1], [5.4, 0.6, 0.6]],
      spare: [[2, 8.6], [4, 9], [1, 10.4], [3.4, 5.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// The community house: a single-storey hall under a green sheet roof with a porch, a ramp and louvred windows; a notice
// board under its own little roof on the lawn, a flag, seats beneath a tree. A plain civic building of the neighbourhood.

const communityHall: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), wall = '#efe6cf', trim = '#2f6f4a', sheet = '#5f7a6a';
    plainLand(b);
    ground(b, { w: 30, d: 26, color: '#6a9f52', edge: '#48703b' });
    b.box(0, 0.04, 4.4, 3.4, 0.04, 15.6, PAVING); b.box(0, 0.045, -3, 16, 0.04, 2.4, PAVING);
    // The hall: cream walls on a stone base, a low roof of green sheet, four louvred windows, double doors
    b.box(0, 0.3, -9, 15, 0.6, 6.6, '#bdb6a5'); b.box(0, 2.6, -9, 14.4, 4, 6, wall);
    for (const s of [-1, 1]) b.box(0, 5.2, -9 + s * 1.7, 15.4, 0.14, 3.8, s < 0 ? sheet : '#6a8676', { rx: s * 0.32 });
    b.box(0, 5.78, -9, 15.5, 0.14, 0.3, '#4f6a5a');
    for (const x of [-5.4, -2.9, 2.9, 5.4]) { windowPane(b, x, 2.8, -5.96, { w: 1.4, h: 1.6, glass: '#7f9fb0', frame: trim }); for (let i = 0; i < 3; i++) b.box(x, 2.3 + i * 0.5, -5.9, 1.4, 0.06, 0.06, '#dfe6e4'); }
    b.box(0, 2, -5.96, 2.2, 2.8, 0.1, '#5a4630'); b.box(0, 2, -5.9, 0.06, 2.8, 0.04, '#3a2c1e');
    // The porch: a flat roof on four posts with the hall's name along its edge, two steps and a ramp with a rail
    b.box(0, 3.9, -4.6, 7.6, 0.24, 3, '#f4f2ea'); b.box(0, 3.66, -3.16, 7.6, 0.5, 0.12, trim);
    for (const x of [-3.5, -1.5, 1.5, 3.5]) b.box(x, 1.9, -3.3, 0.22, 3.8, 0.22, '#f4f2ea');
    labelled(b, label, 0, 4.5, -3.2, 7, 0.42, '#f4efe0', trim);
    b.box(0, 0.3, -4.5, 7.4, 0.6, 2.6, '#cfc9b8'); for (let i = 0; i < 2; i++) b.box(1.2, 0.12 + i * 0.16, -2.9 - i * 0.2, 4.6, 0.24 + i * 0.3, 0.4, '#bdb6a5');
    b.box(-2.6, 0.3, -2.2, 1.6, 0.08, 3, '#cfc9b8', { rx: 0.2 }); b.box(-3.46, 0.9, -2.2, 0.06, 0.06, 3, METAL_DARK, { rx: 0.2 }); for (const z of [-3.4, -1]) b.box(-3.46, 0.6, z, 0.06, 0.9, 0.06, METAL_DARK);
    // The notice board on the lawn: a framed board of pinned sheets under a strip of roof
    b.at(-7.4, 0, 3, 0.15, () => {
      for (const s of [-1, 1]) b.box(s * 2.5, 1.7, 0, 0.18, 3.4, 0.18, WOOD_DARK);
      b.box(0, 2, 0, 4.8, 2.4, 0.1, '#3d6f58'); b.box(0, 3.5, 0.1, 5.8, 0.1, 1.1, sheet, { rx: 0.2 });
      sign(b, 0, 2.9, 0.07, 'NOTICES', { size: 0.34, color: '#f4efe0' });
      for (let i = 0; i < 8; i++) b.quad(-1.8 + (i % 4) * 1.2, 2.2 - Math.floor(i / 4) * 0.84, 0.07, 0.86, 0.64, ['#f4f2ea', '#f2e2a8', '#f4f2ea', '#cfe3ea', '#f4f2ea', '#f2c9b8', '#f2e2a8', '#f4f2ea'][i]!);
    });
    extra(b, 'house-reader', -8.4, 4.8, PI + 0.2, 'stand', { look: { body: 'woman', outfit: 'kaftan', outfitColor: 'gold', accessories: ['headwrap'] } });
    // A desk on the porch, a flag, seats under a neem tree, a rack of bicycles, a water tank at the gable
    table(b, 2.6, -4.6, { w: 1.8, d: 0.9, color: WOOD_LIGHT }); b.box(2.3, 1.1, -4.6, 0.5, 0.06, 0.36, WHITE);
    extra(b, 'house-clerk', 2.6, -5.3, 0, 'sit', { y: 0.6, seat: 0.6, look: { body: 'man', outfit: 'office', outfitColor: 'cream', bottomsColor: 'navy', fabric: 'plain', accessories: ['glasses'] } });
    flag(b, 6.4, 0.6, { h: 6.4, w: 1.7, colors: [...NATION] });
    leafTree(b, 11.6, 4, { s: 1.15, tone: 2 }); bench(b, 8.2, 8.2, { w: 2.6, back: true, ry: PI - 0.4, color: '#8a6644' }); bench(b, 11.6, 8.4, { w: 2.4, back: true, ry: PI + 0.5, color: '#8a6644' });
    extra(b, 'house-elder', 8.2, 8.2, PI - 0.4, 'sit', { seat: 0.6, look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream', accessories: ['fila'] } });
    b.box(-11.4, 0.5, 7.6, 3, 0.06, 0.06, METAL_DARK); for (let i = 0; i < 4; i++) b.box(-12.6 + i * 0.8, 0.26, 7.6, 0.06, 0.5, 0.06, METAL_DARK);
    for (const [x, c] of ([[-12.2, '#c9423a'], [-11, '#3f72c4']] as [number, Colour][])) b.at(x, 0, 7.6, 0, () => { for (const s of [-1, 1]) b.cyl(0, 0.34, s * 0.55, 0.34, 0.05, BLACK, { seg: 8, rz: HALF }); b.box(0, 0.62, 0, 0.06, 0.06, 1, c); b.box(0, 0.86, -0.2, 0.06, 0.44, 0.06, c); b.box(0, 0.98, 0.5, 0.44, 0.05, 0.05, METAL_DARK); });
    b.box(9.4, 1, -9.6, 1.8, 2, 1.8, CONCRETE); b.cyl(9.4, 2.9, -9.6, 0.86, 1.8, '#22262c', { seg: 10 }); b.cyl(9.4, 3.9, -9.6, 0.86, 0.24, '#22262c', { seg: 10, top: 0.4 });
    for (const s of [-1, 1]) { b.box(s * 4.6, 0.2, 0, 4.4, 0.4, 1.2, '#7a5a3c'); for (let i = 0; i < 6; i++) b.ico(s * 4.6 - 1.75 + i * 0.7, 0.55, 0, 0.32, 0.26, 0.32, ['#e9614b', '#e8c43a', '#f1efe8'][i % 3]!); }
    fence(b, [-14.4, 12.2], [-2.4, 12.2], { h: 0.9, color: '#f4f2ea', gap: 1.2 }); fence(b, [2.4, 12.2], [14.4, 12.2], { h: 0.9, color: '#f4f2ea', gap: 1.2 });
    lampPost(b, -2.6, 7.4, { light: true }); leafTree(b, -12.4, -4.6, { s: 1.1, tone: 0 }); bush(b, 12.6, -2.4); bush(b, -9.6, -4.8, { s: 0.8, color: '#c0407e' });
    return {
      spots: [
        landmark('notices', /visit|notice|board|hall|community|look|learn/, -6, 5.4, PI),
        landmark('work', /work|staff|desk|office|clerk|job|shift/, 2.6, -1.6, PI, { act: { pose: 'stand' } }),
        landmark('shade', /shade|tree|bench|sit|rest/, 6.4, 7.4, HALF),
        landmark('people', /people|crowd|meet/, 1.6, 6.6, 0),
      ],
      crowd: [[2.4, 4.4, 0.4], [-2.4, 7.6, -0.5], [4.6, 2.6, 2.4], [-9.6, 5.6, 1.2], [4.6, 10.2, -0.8], [-8.4, 9.6, 0.8], [1.4, 10.4, 2.8], [-5.2, 10.2, 2.4], [-10.4, 1.4, 1.6], [12.4, 1.6, -0.4], [0.2, 9, 3.1], [-1.6, 1.8, 0.6]],
      spare: [[-2, 8.6], [3, 9], [-3, 5.4], [1.4, 5.8]],
    };
  },
};

/** The signature scenes by scene kind, then by variant (venue.scene.variant). */
const SIGNATURE: Record<string, Record<string, SceneDef>> = {
  park: { 'fct-terraces': terraces, 'fct-parade': parade, 'fct-lake': lake, 'fct-zoo': zoo },
  worship: { 'fct-mosque': mosque, 'fct-church': church },
  market: { 'fct-crafts': crafts },
  viewing: { 'fct-stadium': stadium },
  gym: { 'fct-velodrome': velodrome },
  walk: { 'fct-gate': gate },
  statehouse: { 'fct-hall': communityHall },
};

/** A wide scene in a tall window needs the camera further back, and more nearly in front, than the rooms do: the whole ground is in view. */
const WIDE: SceneCamera = { landscape: [15, 19.8, 25.4], portrait: [13, 48, 69] };
const kinds = [...new Set([...Object.keys(SIGNATURE), ...Object.keys(EVERYDAY)])];
export const VARIANTS: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = Object.freeze(Object.fromEntries(kinds.map((kind) => [
  kind,
  Object.freeze(Object.fromEntries(Object.entries({ ...SIGNATURE[kind], ...EVERYDAY[kind] }).map(([variant, def]) => [variant, def.mood === 'outdoor' && !def.camera ? { ...def, camera: WIDE } : def]))),
])));
