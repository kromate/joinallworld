/**
 * OWNER: scenes
 * Scenes for the everyday venues of Ogun State's cities that share a kind with another city's venue: a venue asks for one
 * through `scene.variant` (CitySceneVariant) and VARIANTS[kind][variant] replaces the kind's own scene
 * (src/scene/venue-scenes.ts). The signature scenes are in src/scene/venues-ogun-a.ts.
 *
 *   hub / station | park-lot | park-trucks | park-rank | interchange
 *       a rail platform beside a long train; three motor parks (a lot of minibuses and tricycles, a lot of trucks and a
 *       weighbridge, a car rank with motorbikes); a flyover ramp over an expressway with trucks and a gantry sign
 *   market / market-sheds | market-containers | market-garri | market-kola
 *       rows of tin-roofed produce sheds; a block of container shops with a truck; sacks of garri under umbrellas
 *       behind a gate arch; a round shed ringed with baskets of kola and produce
 *   office / campus-farm | campus-dome | campus-tech | campus-lawn | campus-flag | cloth-studio | media-studio
 *       five university courts with silhouettes of their own (farm plots, greenhouse and tractor shed; a chapel dome and a
 *       colonnade; sawtooth workshops and solar panels; red-roofed halls on a lawn; blocks round a flag court) and two studios
 *   viewing / bowl | track-stadium | ground-clay | ground-terrace
 *       a bowl stadium with stands on every side; a stadium with a red running track and one arched stand; two community grounds
 *   walk / factory | heritage-house | heritage-gallery
 *       a factory gate with trucks and a warehouse; a storeyed house with a veranda and waymarks; a gallery court with artefacts
 *   statehouse / hall-brick | hall-dome      a council hall in brick with a clock turret; one under a low dome
 *   park / ayo-park | evening-garden         a shaded square with ayo boards; a lit evening plaza with a stage
 *
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * All scenes are static and keep to the geometry budget of the others. Scene definition format: see venues-outdoor.ts.
 */
import { GLOW, GLASS } from './build.ts';
import type { Batch, Colour, SceneCamera, SceneDef, SceneWalkSpec } from './types.ts';
import {
  ground, room, table, stool, bench, chair, plant, palm, leafTree, tallTree, bush, lampPost, kiosk, crate, column, flag, parasol, stringLights,
  fence, windowPane, sign, signBoard, car, speaker, laptop, desk, screen, landmark, extra, textWidth,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF, LEAF_DARK, WARM,
} from './props.ts';
import { PI, HALF, OPEN, seeded, plain, fit, labelled, gable, house, shed, boulder, drum, adireCloth, FRONT_CROWD, FRONT_SPARE, RUST } from './venues-ogun-a.ts';

const INDOORS: SceneWalkSpec = { bounds: [-11.5, -9.5, 11.5, 9.5], entrance: [0, 8.8], open: false };
const standardCrowd = (): [number, number, number][] => FRONT_CROWD.map(([x, z, r]) => [x, z, r]);
const GRASS = '#62a04f', GRASS_EDGE = '#46703a';

// ---------------------------------------------------------------------------------------------
// Vehicles and small machines (long axis along z, nose at +z).

function minibus(b: Batch, x: number, z: number, ry: number, body: Colour, stripe: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 1.2, 0, 1.8, 1.9, 4.0, body);
    b.box(0, 0.7, 0, 1.84, 0.26, 4.04, stripe);
    b.box(0, 1.7, 0.1, 1.86, 0.6, 3.4, '#5f7b8c');
    b.box(0, 2.22, 0, 1.6, 0.1, 3.6, '#c9c4b4');
    b.box(0, 2.34, -0.2, 1.3, 0.14, 2.2, '#8a6644');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.86, 0.34, sz * 1.3, 0.34, 0.24, BLACK, { seg: 7, rz: HALF });
    for (const sx of [-1, 1]) b.box(sx * 0.58, 0.8, 2.02, 0.32, 0.16, 0.04, WARM, GLOW);
  });
}
function truck(b: Batch, x: number, z: number, ry: number, cab: Colour, load: Colour, y = 0): void {
  b.at(x, y, z, ry, () => {
    b.box(0, 1.9, -0.9, 2.4, 2.7, 5.6, load);
    b.box(0, 0.64, -0.9, 2.2, 0.3, 5.8, METAL_DARK);
    b.box(0, 1.4, 3.1, 2.3, 2.1, 1.9, cab);
    b.box(0, 1.9, 4.06, 1.9, 0.8, 0.06, '#8fb8cc');
    b.box(0, 0.8, 4.1, 2.3, 0.3, 0.2, METAL_DARK);
    for (const sz of [-3, -1.9, 3.4]) for (const sx of [-1, 1]) b.cyl(sx * 1.05, 0.46, sz, 0.46, 0.34, BLACK, { seg: 8, rz: HALF });
    for (const sx of [-1, 1]) b.box(sx * 0.8, 0.9, 4.12, 0.3, 0.16, 0.04, WARM, GLOW);
  });
}
function keke(b: Batch, x: number, z: number, ry: number, body: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.9, -0.2, 1.3, 1.1, 1.8, body);
    b.box(0, 1.65, -0.2, 1.4, 0.12, 1.9, '#2f2a24');
    for (const sx of [-1, 1]) b.cyl(sx * 0.6, 1.2, -0.2, 0.04, 0.9, '#2f2a24', { seg: 4 });
    b.box(0, 0.75, 0.9, 0.5, 0.8, 0.9, body);
    for (const [sx, sz] of [[-0.62, -0.9], [0.62, -0.9], [0, 1.3]] as [number, number][]) b.cyl(sx, 0.28, sz, 0.28, 0.2, BLACK, { seg: 6, rz: HALF });
  });
}
function bike(b: Batch, x: number, z: number, ry: number, colour: Colour): void {
  b.at(x, 0, z, ry, () => {
    for (const sz of [-0.7, 0.7]) b.cyl(0, 0.34, sz, 0.34, 0.14, BLACK, { seg: 7, rz: HALF });
    b.box(0, 0.7, 0, 0.3, 0.3, 1.1, colour); b.box(0, 0.95, -0.25, 0.3, 0.12, 0.7, '#2f2a24'); b.box(0, 1.1, 0.55, 0.7, 0.06, 0.06, METAL_DARK);
  });
}
function tractor(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, 1.1, 0.5, 1.2, 1.1, 1.8, '#2f8f55'); b.box(0, 2.3, -0.5, 1.3, 0.1, 1.3, '#2f8f55');
    for (const sx of [-1, 1]) b.cyl(sx * 0.6, 1.6, -0.9, 0.05, 1.2, '#2a2d33', { seg: 4 });
    b.box(0, 1.5, -0.5, 1.2, 0.8, 1.2, '#eceae2');
    for (const sx of [-1, 1]) { b.cyl(sx * 0.85, 0.8, -0.6, 0.8, 0.4, BLACK, { seg: 9, rz: HALF }); b.cyl(sx * 0.7, 0.45, 1.3, 0.45, 0.3, BLACK, { seg: 8, rz: HALF }); }
    b.box(0, 0.5, -1.7, 0.2, 0.2, 0.9, METAL_DARK);
  });
}
function sacks(b: Batch, x: number, z: number, cols: number, rows: number, colour: Colour): void {
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) b.ball(x + i * 0.62, 0.3 + j * 0.34, z + (j % 2) * 0.1, 0.32, 0.22, 0.4, colour, { seg: 5 });
}
function basin(b: Batch, x: number, z: number, colour: Colour, r = 0.5): void {
  b.cyl(x, 0.14, z, r, 0.28, '#7a7a7e', { seg: 8, top: 1.2 }); b.ball(x, 0.3, z, r * 0.9, r * 0.4, r * 0.9, colour, { seg: 6 });
}

// ---------------------------------------------------------------------------------------------
// Hubs

/** A passenger rail station: a platform beside a train that runs from the back to the front, the station building at the right. */
const station: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  walk: { bounds: [-5.6, -9.4, 14.2, 12.2], entrance: [4, 11], open: true },
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#cfc8b4', edge: '#8f8977' });
    // The ballast bed with two tracks along z at the left; the train on the nearer one
    b.box(-9.6, 0.04, 0, 9, 0.08, 26, '#7d776b');
    for (let z = -12.6; z < 12.6; z += 0.9) b.box(-9.6, 0.1, z, 7.4, 0.06, 0.34, '#5f4630');
    for (const x of [-11.2, -10, -7.8, -6.6]) b.box(x, 0.16, 0, 0.12, 0.08, 26, '#9aa0a6');
    for (let i = 0; i < 3; i++) {
      const z = -8.4 + i * 7.4;
      b.box(-8.6, 1.9, z, 2.5, 3, 7.1, '#e9e6dc'); b.box(-8.6, 1.0, z, 2.52, 0.8, 7.12, '#27384f'); b.box(-8.6, 0.64, z, 2.4, 0.2, 7, '#5f6a72');
      b.box(-7.34, 2.5, z, 0.04, 0.8, 6.4, '#33475a');
      for (let k = 0; k < 5; k++) b.quad(-7.31, 2.5, z - 2.6 + k * 1.3, 0.8, 0.55, '#9fd8ff', { ry: HALF });
      b.box(-8.6, 3.5, z, 2.3, 0.14, 6.9, '#b9b6ac');
    }
    b.box(-8.6, 1.9, 13.4, 2.5, 3, 2.4, '#27384f'); b.box(-8.6, 2.2, 14.64, 1.9, 0.9, 0.06, '#8fb8cc');
    // The platform: raised, edged with a yellow line, with a long canopy on columns
    b.box(-0.8, 0.14, 0, 7.4, 0.28, 25, '#bdb6a5'); b.box(-0.8, 0.29, 0, 7.6, 0.04, 25.2, '#d9d3c1');
    b.box(-4.45, 0.31, 0, 0.3, 0.03, 25.2, '#f2c14e');
    for (const z of [-9, -4, 1, 6]) { b.cyl(0.9, 2.6, z, 0.18, 3.4, '#f0ebdd', { seg: 6 }); b.cyl(-3.8, 2.6, z, 0.18, 3.4, '#f0ebdd', { seg: 6 }); }
    b.box(-1.4, 4.45, -1.5, 6.4, 0.2, 22, '#cfe3ea', GLASS); b.box(-1.4, 4.65, -1.5, 6.8, 0.12, 22.4, '#7a8a92');
    // The station building: pale walls under a long pitched roof, a covered entrance and the name above it
    b.box(10, 2.4, -3, 7.6, 4.8, 12.4, '#ece3c8'); gable(b, 10, 4.8, -3, 7.6, 12.4, 1, 0.28);
    for (let i = 0; i < 4; i++) windowPane(b, 6.15, 2.6, -7.4 + i * 3.3, { w: 1.5, h: 1.8, ry: -HALF, glass: '#8fb0c4', frame: '#bdb298' });
    b.box(6.1, 1.6, -2.8, 0.1, 3.2, 3, '#4f6a7a');
    for (const z of [-4.2, -1.4]) b.cyl(5.2, 1.7, z, 0.16, 3.4, WHITE, { seg: 6 });
    b.box(5.5, 3.5, -2.8, 1.6, 0.2, 3.4, '#bdb298');
    labelled(b, label, 6.05, 4.1, -2.8, 4.8, 0.32, '#f4efe0', '#1f6f4a', true, -HALF);
    // A ticket kiosk, benches on the platform, a notice board, bags
    kiosk(b, 11.4, 6.8, { ry: -HALF, w: 3, color: '#3a6ea5', roof: '#243a66', fascia: '#e9dba8' });
    bench(b, -2.4, 3.4, { back: true, ry: -HALF, color: '#6a6e72', leg: METAL_DARK }); bench(b, -2.4, -4.6, { back: true, ry: -HALF, color: '#6a6e72', leg: METAL_DARK });
    b.box(-1.6, 1.9, 8.4, 0.12, 2, 2.4, '#1a2230'); for (let i = 0; i < 4; i++) b.quad(-1.52, 2.6 - i * 0.35, 8.4, 2, 0.16, ['#ffe07a', '#9fd8ff', '#b8f0c8', '#f2a6c8'][i]!, { ry: HALF, ...GLOW });
    for (const [z, c] of ([[-3.6, '#2f4a66'], [-2.9, '#a14b3c'], [5.2, '#3f6a4a']] as [number, string][])) b.box(-3.4, 1.35, z, 0.5, 0.9, 0.8, c);
    lampPost(b, 1.4, 8, { light: true }); lampPost(b, 8, 9.4); lampPost(b, 1.4, -8);
    flag(b, 13, 10.2, { h: 6, w: 1.8 });
    extra(b, 'sta-passenger-1', -2.4, 3.4, -HALF, 'sit', { seat: 0.6, y: 0.3 }); extra(b, 'sta-passenger-2', -1.6, -1, 1.4, 'stand', { y: 0.3, look: { body: 'woman', outfit: 'casual', outfitColor: 'orange' } });
    extra(b, 'sta-attendant', 9, 5.6, PI, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', fabric: 'plain' } });
    return {
      spots: [
        landmark('platform', /platform|rail|train|wait|board|travel/, -1.6, 1.8, -HALF),
        landmark('ticket', /ticket|desk|work|staff|job|shift/, 9, 4, 0, { act: { pose: 'work' } }),
        landmark('bench', /bench|sit|rest/, 8, 9.2, PI),
        landmark('people', /people|crowd|meet/, 5.6, 7.4, 0),
      ],
      crowd: [[7.6, 8.6, 0.4], [3, 6.8, -0.5], [10.6, 10, 2.4], [-1.6, 8, 1.2], [12.4, 8.2, -1], [0.4, 10.6, 2.2], [5, 10.4, 0.6], [9, 1.4, 0.8], [3.4, 2, 2.4], [12, 2, 1.6], [-2.4, 11, -0.4], [6.4, 4.6, 0]],
      spare: [[3, 9], [7, 9.2], [10, 8], [1, 10]],
    };
  },
};

function bays(b: Batch, x0: number, z0: number, n: number, dx: number): void {
  for (let i = 0; i <= n; i++) b.box(x0 + i * dx, 0.05, z0, 0.1, 0.02, 4.4, '#e6dfc8');
}

/** A motor park of minibuses and tricycles around a ticket shed. */
const parkLot: SceneDef = {
  mood: 'outdoor', accent: '#3f72c4',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#76797e', edge: '#4a4d52' });
    bays(b, -13, -5.6, 8, 1.9); bays(b, -3, -9.2, 6, 2.2);
    b.box(0, 0.05, 6.4, 30, 0.02, 0.26, '#e6dfc8');
    // The ticket shed with a rust roof and benches, a route board with coloured lines
    for (const [x, z] of ([[6, -1.4], [13, -1.4], [6, 3.4], [13, 3.4]] as [number, number][])) b.cyl(x, 1.7, z, 0.13, 3.4, METAL_DARK, { seg: 6 });
    b.box(9.5, 3.55, 1, 8.4, 0.16, 5.6, '#8f4f35', { rx: 0.08 });
    for (let i = 0; i < 9; i++) b.box(5.6 + i * 0.95, 3.65, 1, 0.08, 0.1, 5.6, '#a8653f', { rx: 0.08 });
    bench(b, 8, 2.4, { back: true, ry: PI, w: 3 }); bench(b, 11.4, 2.4, { back: true, ry: PI, w: 3 });
    b.box(13.4, 1.5, 1, 0.12, 1.6, 3, '#2f3b36'); for (let i = 0; i < 4; i++) b.quad(13.32, 2 - i * 0.32, 1, 2.4, 0.14, ['#ffe07a', '#9fd8ff', '#b8f0c8', '#f2a6c8'][i]!, { ry: -HALF, ...GLOW });
    // Rows of minibuses in white with blue and green bands, a queue of tricycles
    const body: [Colour, Colour][] = [['#eceae2', '#3f72c4'], ['#e4e0d2', '#2f8f55'], ['#d9e3ef', '#c9423a'], ['#eceae2', '#2f8f55']];
    for (let i = 0; i < 6; i++) minibus(b, -12 + i * 1.9, -3.6, 0, ...body[i % 4]!);
    for (let i = 0; i < 4; i++) minibus(b, -3 + i * 2.2, -7.6, 0.04 * (i % 2 ? 1 : -1), ...body[(i + 2) % 4]!);
    for (let i = 0; i < 4; i++) keke(b, -12 + i * 1.9, 1.4, 0.2, ['#e8c43a', '#2f8f55', '#3f72c4', '#e8c43a'][i]!);
    signBoard(b, -4.6, 8.4, plain(label), { y: 3, size: fit(plain(label), 9, 0.44), color: '#f4e6b8', board: '#26435f' });
    parasol(b, -8.4, 9.6, { colors: ['#e9614b', WHITE] }); b.box(-8.4, 0.55, 10.6, 1.6, 0.1, 0.8, WOOD); for (let i = 0; i < 4; i++) b.ball(-8.9 + i * 0.35, 0.7, 10.6, 0.12, 0.1, 0.12, ['#e8a13a', '#d9482f'][i % 2]!, { seg: 5 });
    lampPost(b, 2, 2.4, { light: true }); lampPost(b, -6, 5.4);
    flag(b, 13.6, 6, { h: 5.4, colors: ['#3f72c4', WHITE, '#3f72c4'] });
    extra(b, 'lot-conductor', 5.2, 2.8, 2.4, 'wave', { look: { body: 'man', outfit: 'casual', outfitColor: 'green' } });
    extra(b, 'lot-waiter-1', 8, 2.4, PI, 'sit', { seat: 0.6 }); extra(b, 'lot-waiter-2', 12, 4.4, 1.2, 'stand'); extra(b, 'lot-seller', -8.4, 11, PI, 'work');
    return {
      spots: [
        landmark('platform', /platform|bus|stop|wait|queue|travel/, 9.6, 5, PI),
        landmark('work', /work|staff|dispatch|job|shift/, 3.6, 3.4, HALF, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, -1, 4.2, 0),
      ],
      crowd: [[-1.4, 8.4, 0.4], [-5, 4.6, -0.5], [3.2, 8, 2.4], [-9, 3.8, 1.2], [5.6, 5.2, -1], [0.4, 10.4, 2.2], [-12, 7.4, 0.6], [8.4, 9.4, 0.8], [-3.2, 6.2, 2.4], [-11.6, 10.2, 1.6], [11, 8.4, -0.4], [1.4, 4.8, 0.3]],
      spare: [[-4, 7.8], [2, 6.2], [6.4, 7.4], [0, 9.2]],
    };
  },
};

/** A motor park with a weighbridge: lines of trucks, buses, a fuel pump and a dispatch hut. */
const parkTrucks: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#6b6f73', edge: '#43464a' });
    b.box(0, 0.05, -3.4, 30, 0.03, 0.3, '#e6dfc8'); b.box(0, 0.05, 8, 30, 0.03, 0.24, '#e6dfc8');
    for (let i = 0; i < 8; i++) b.box(-12 + i * 3.4, 0.05, -10.2, 0.12, 0.02, 4.6, '#e6dfc8');
    // Trucks along the back, two buses
    const cabs = ['#2f6f8f', '#c9423a', '#e0a43a', '#3f9a5a', '#7a4a8e'], loads = ['#d9d4c4', '#a8b4c0', '#c9a56a', '#d9d4c4', '#b8c4a8'];
    for (let i = 0; i < 5; i++) truck(b, -11.6 + i * 3.3, -8.4, 0.02 * (i % 2 ? 1 : -1), cabs[i]!, loads[i]!);
    minibus(b, 4.6, -1.6, HALF, '#eceae2', '#e0a43a'); minibus(b, 4.6, 1.2, HALF, '#e4e0d2', '#2f8f55');
    // The weighbridge: a plate in the road between two kerbs, a hut with a window, a barrier arm
    b.box(-6, 0.08, 1.6, 2.6, 0.12, 6, '#5a5f66'); for (const sx of [-1, 1]) b.box(-6 + sx * 1.6, 0.25, 1.6, 0.3, 0.5, 6.4, '#c9c4b4');
    b.box(-9.6, 1.4, 1.6, 2.4, 2.8, 2.6, '#d9d2b8'); b.box(-9.6, 2.9, 1.6, 2.9, 0.2, 3.1, '#8f4f35'); b.box(-8.36, 1.8, 1.6, 0.06, 1, 1.6, '#4f6a7a');
    b.box(-6, 1, 5.2, 0.14, 1.9, 0.14, METAL_DARK); b.box(-6, 1.5, 4.4, 0.1, 0.12, 1.8, '#c9423a', { rx: 0.1 });
    // A fuel pump island on the right with a canopy
    for (const x of [8, 12.4]) b.cyl(x, 2.1, 6.4, 0.16, 4.2, '#f0ebdd', { seg: 6 });
    b.box(10.2, 4.3, 6.4, 6, 0.3, 3.2, '#e0a43a'); b.box(10.2, 4.55, 6.4, 6.2, 0.12, 3.4, '#f0ebdd');
    b.box(10.2, 0.2, 6.4, 3.6, 0.4, 1.2, '#9a958a'); for (const x of [9.2, 11.2]) { b.box(x, 1.2, 6.4, 0.7, 2, 0.5, '#c9423a'); b.quad(x, 1.8, 6.66, 0.4, 0.3, '#9fd8ff', GLOW); }
    truck(b, 12, 0.2, -HALF, '#3f9a5a', '#d9d4c4');
    signBoard(b, 0.6, 9.4, plain(label), { y: 3, size: fit(plain(label), 9, 0.44), color: '#f4e6b8', board: '#3a3f46' });
    stack(b, -13.2, 6, 3); stack(b, -11.6, 7.6, 2);
    lampPost(b, 3, 4, { light: true }); lampPost(b, -2.4, 9);
    extra(b, 'trk-driver', -4, -4, 0.5, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'orange' } });
    extra(b, 'trk-clerk', -9.6, 3.2, PI, 'work', { look: { body: 'woman', outfit: 'office', outfitColor: 'teal' } });
    extra(b, 'trk-dispatch', 3.2, 1.4, 1.2, 'wave', { look: { body: 'man', outfit: 'casual', outfitColor: 'green' } });
    return {
      spots: [
        landmark('platform', /platform|bus|stop|wait|queue|travel/, 2.2, 6.4, PI),
        landmark('work', /work|staff|dispatch|job|shift|weigh/, -8, 5.8, 0.4, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, -2, 4.4, 0),
      ],
      crowd: [[-1.4, 8, 0.4], [-4.4, 6.2, -0.5], [3.4, 8.4, 2.4], [-9, 8.6, 1.2], [6.4, 3.4, -1], [0.4, 10.6, 2.2], [-12, 10.4, 0.6], [8.4, 10.2, 0.8], [-2.8, 2.2, 2.4], [-5.6, 10.6, 1.6], [12, 10.6, -0.4], [1.4, 5.8, 0.3]],
      spare: [[-4, 8], [2, 7.8], [6.4, 8], [0, 10]],
    };
  },
};
function stack(b: Batch, x: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) b.cyl(x, 0.28 + i * 0.5, z, 0.5, 0.5, '#2a2d33', { seg: 8 });
}

/** A taxi rank: cars nose to tail, motorbikes, an arched shelter and food umbrellas. */
const parkRank: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#b9b09a', edge: '#8a826c' });
    b.box(0, 0.05, -1, 30, 0.06, 7.2, '#5f6368'); for (let i = -6; i <= 6; i++) b.box(i * 2.2, 0.09, -1, 1, 0.02, 0.14, '#e6dfc8');
    // The shelter at the back: a row of arches under a long roof, a bench inside
    b.box(0, 2.6, -11, 20, 5.2, 2.4, '#e6dcc2');
    for (let i = 0; i < 8; i++) { const x = -8.75 + i * 2.5; b.box(x, 1.4, -9.76, 1.5, 2.6, 0.1, '#3a3f46'); b.cyl(x, 2.7, -9.76, 0.75, 0.1, '#3a3f46', { seg: 10, rx: HALF }); }
    b.box(0, 5.35, -10.2, 21, 0.3, 4, '#2f8f55'); b.box(0, 5.7, -10.2, 21.4, 0.14, 4.4, '#8f4f35', { rx: 0.06 });
    labelled(b, label, 0, 4.2, -9.6, 11, 0.5, '#f4e6b8', '#2f6f4a', false);
    bench(b, -4, -8.6, { back: true, w: 3.4, color: '#8a6644' }); bench(b, 4, -8.6, { back: true, w: 3.4, color: '#8a6644' });
    // Cars in the rank, nose to tail along the road, a line of motorbikes by the kerb
    const cols = ['#e8e4d8', '#d9d2b8', '#2f6f8f', '#e8e4d8', '#c9423a', '#d9d2b8'];
    for (let i = 0; i < 6; i++) car(b, -11.4 + i * 4.6, 1.2, { ry: HALF, color: cols[i]! });
    for (let i = 0; i < 6; i++) bike(b, -12 + i * 1.4, 4.4, HALF + 0.1, ['#c9423a', '#2f8f55', '#2f6f8f', '#e0a43a', '#c9423a', '#2f8f55'][i]!);
    for (let i = 0; i < 3; i++) car(b, 5 + i * 3.6, -4.6, { ry: 0.1 * (i - 1), color: cols[i + 3]! });
    // Food umbrellas with tables
    for (const [x, z, c] of ([[6.6, 6.2, '#e9614b'], [10.4, 8.4, '#3f9a5a'], [-6.6, 8.6, '#e0a43a']] as [number, number, string][])) { parasol(b, x, z, { h: 3, r: 1.9, colors: [c, WHITE] }); table(b, x, z + 0.6, { w: 1.6, d: 0.9, h: 0.9, color: '#7a5c3c' }); stool(b, x - 0.9, z + 1.7); stool(b, x + 0.9, z + 1.7); }
    lampPost(b, -2, 6, { light: true }); lampPost(b, 12.8, 4);
    palm(b, -13.2, 9.6, { s: 1.1 }); leafTree(b, 13, 10.6, { s: 1, tone: 1 });
    extra(b, 'rank-driver-1', -6.8, 3.2, 2, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'teal' } });
    extra(b, 'rank-driver-2', 4.6, -2.4, PI, 'wave', { look: { body: 'man', outfit: 'casual', outfitColor: 'orange' } });
    extra(b, 'rank-vendor', 6.6, 7.4, PI, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'red', fabric: 'ankara' } });
    return {
      spots: [
        landmark('platform', /platform|bus|stop|wait|queue|travel/, 0, 6.2, PI),
        landmark('work', /work|staff|dispatch|job|shift/, -9.6, 9.6, 0.4, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 2.6, 9, 0),
      ],
      crowd: [[-1.4, 8.4, 0.4], [-4.6, 6.8, -0.5], [3.4, 7.4, 2.4], [-9, 6.8, 1.2], [12.4, 6, -1], [0.4, 10.4, 2.2], [-12, 8.4, 0.6], [8.4, 5.4, 0.8], [-2.8, 9.8, 2.4], [-5.6, 10.6, 1.6], [3, 5, -0.4], [-8, 4.4, 0.3]],
      spare: [[-4, 8], [2, 8], [6.4, 4.4], [0, 10]],
    };
  },
};

/** A flyover ramp climbing over an expressway: piers rising along the back, trucks on the road, a gantry sign. */
const interchange: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#9aa08a', edge: '#6a7058' });
    // The expressway: four lanes along x with a concrete median and dashed lines
    b.box(0, 0.05, -2.4, 30, 0.06, 8.6, '#54585e'); b.box(0, 0.12, -2.4, 30, 0.2, 0.5, '#bdb8aa');
    for (let i = -7; i <= 7; i++) { b.box(i * 2, 0.09, -4.5, 1, 0.02, 0.14, '#e6dfc8'); b.box(i * 2, 0.09, -0.3, 1, 0.02, 0.14, '#e6dfc8'); }
    b.box(0, 0.09, -6.6, 30, 0.02, 0.2, '#f2c14e'); b.box(0, 0.09, 1.8, 30, 0.02, 0.2, '#f2c14e');
    truck(b, -9, -4.5, HALF, '#2f6f8f', '#d9d4c4'); truck(b, 3.6, -4.5, HALF, '#c9423a', '#a8b4c0'); truck(b, 11, 0, -HALF, '#e0a43a', '#c9a56a'); car(b, -2, 0, { ry: -HALF, color: '#e8e4d8' }); car(b, -11, 0, { ry: -HALF, color: '#3f6a8a' });
    // The ramp: a deck rising from left to right on piers of rising height, parapets, a lamp mast line
    const rise = 5.4, len = 31;
    b.box(0, rise / 2 + 0.6, -11.6, len, 0.7, 4.4, '#c4bfb1', { rz: Math.atan2(rise, len) });
    b.box(0, rise / 2 + 1.1, -9.5, len, 0.5, 0.3, '#a8a395', { rz: Math.atan2(rise, len) }); b.box(0, rise / 2 + 1.0, -13.7, len, 0.5, 0.3, '#a8a395', { rz: Math.atan2(rise, len) });
    for (let i = 0; i < 6; i++) { const x = -12.4 + i * 5, h = 0.6 + (x + 15.5) / len * rise; b.box(x, h / 2, -11.6, 1.2, h, 1.6, '#a9a496'); b.box(x, h - 0.1, -11.6, 2.8, 0.4, 2.6, '#b5b0a2'); }
    b.box(-15.4, 0.4, -11.6, 3, 0.8, 4.6, '#8f8b7e');
    for (let i = 0; i < 4; i++) b.cyl(-9 + i * 7, 3.8 + i * 0.6, -9.5, 0.08, 3.4, '#c9ced3', { seg: 5 });
    truck(b, 6, -11.6, HALF, '#3f9a5a', '#d9d4c4', 4.2);
    // A gantry sign over the road with arrows and the plain words, a bus shelter and a name board
    for (const x of [-6, 7]) b.cyl(x, 3.3, 3.2, 0.18, 6.6, METAL_DARK, { seg: 6 });
    b.box(0.5, 6.4, 3.2, 14.4, 0.2, 0.2, METAL_DARK);
    b.box(-3, 5.2, 3.15, 4.6, 1.6, 0.12, '#2f6f4a'); sign(b, -3, 5.4, 3.24, 'EXIT', { size: 0.5, color: WHITE }); b.box(-3.9, 4.65, 3.24, 1.6, 0.14, 0.04, WHITE); b.box(-2.2, 4.65, 3.24, 0.8, 0.14, 0.04, WHITE);
    b.box(3.8, 5.2, 3.15, 4.6, 1.6, 0.12, '#2f6f4a'); sign(b, 3.8, 5.4, 3.24, 'NEXT', { size: 0.5, color: WHITE }); b.box(3.8, 4.65, 3.24, 3, 0.14, 0.04, WHITE);
    for (const x of [-6, 7]) b.box(x, 0.2, 3.2, 0.9, 0.4, 0.9, '#9a958a');
    for (const x of [8.4, 12]) b.cyl(x, 1.7, 8.2, 0.12, 3.4, METAL_DARK, { seg: 6 }); b.box(10.2, 3.5, 8, 4.8, 0.16, 2.4, '#2f8f55'); bench(b, 10.2, 8.6, { back: true, w: 3.4, color: '#6a6e72', leg: METAL_DARK });
    signBoard(b, -6.4, 9.4, plain(label), { y: 3, size: fit(plain(label), 9, 0.44), color: '#f4e6b8', board: '#2f4a45' });
    for (const x of [-13, -9]) leafTree(b, x, 6, { s: 1.1, tone: 2 }); palm(b, 13.4, 3.4, { s: 1 });
    lampPost(b, 1, 8, { light: true }); lampPost(b, -3, 6.2);
    extra(b, 'int-traveller', 10.2, 8.6, PI, 'sit', { seat: 0.6 }); extra(b, 'int-trader', 6.2, 6.6, PI, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', fabric: 'ankara' } });
    return {
      spots: [
        landmark('platform', /platform|bus|stop|wait|queue|travel|interchange|ramp/, 5.6, 6.6, PI),
        landmark('work', /work|staff|dispatch|job|shift/, -4.6, 5.6, 0.4, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, -1, 7.8, 0),
      ],
      crowd: [[-1.4, 9.4, 0.4], [-4.4, 7.4, -0.5], [3.4, 9.4, 2.4], [-9, 8.6, 1.2], [8, 10.4, -1], [0.4, 10.8, 2.2], [-12, 10.4, 0.6], [12.4, 6.4, 0.8], [-2.8, 5.2, 2.4], [-7.6, 6.2, 1.6], [12, 10.6, -0.4], [2.4, 6.8, 0.3]],
      spare: [[-4, 8], [2, 8], [6.4, 9.4], [0, 10]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Markets

function groundMarket(b: Batch, c = '#c9a874'): void { ground(b, { w: 30, d: 26, color: c, edge: '#8a7048' }); b.box(0, 0.04, 3.6, 4, 0.03, 18, '#b8965f'); }
function heapOf(b: Batch, x: number, z: number, colour: Colour, r = 0.5): void { b.ico(x, 0.3, z, r, r * 0.55, r, colour); }
const MARKET_CROWD: [number, number, number][] = [[2.6, 1.6, 0.5], [-0.6, 3.6, -0.4], [3.4, 4.2, 2.4], [-2.6, 1.0, 1.4], [-8, 4.6, PI], [-3.2, 6.6, PI], [7.6, 3.6, 2.6], [-8.2, 7, -HALF], [5.6, 7, 0.2], [-5.6, 3.6, 1], [9.6, 7.4, -0.8], [0.2, 8, 0.3]];

/** Rows of tin-roofed produce sheds either side of a long aisle. */
const marketSheds: SceneDef = {
  mood: 'outdoor', accent: '#e0762c',
  walk: OPEN,
  build(b, { label }) {
    groundMarket(b);
    const goods: Colour[] = ['#d9482f', '#e8a13a', '#5f9a48', '#c9372c', '#b98a4f', '#7c9b3c'];
    // Three long sheds: each a corrugated roof on posts over a counter of heaped produce
    for (const [x, z, w, tone] of ([[-7, -9.2, 12, 0], [7, -9.2, 12, 2], [-10, -3.2, 7, 1], [9.6, -3, 7, 3]] as [number, number, number, number][])) {
      shed(b, x, z, w, 3.6, tone, 3.2);
      table(b, x, z + 0.4, { w: w - 1, d: 1.1, h: 0.95, color: '#7a5c3c' });
      for (let i = 0; i < Math.floor((w - 1.4) / 0.9); i++) heapOf(b, x - (w - 1.4) / 2 + i * 0.9, z + 0.4, goods[(i + tone) % 6]!, 0.34);
    }
    // Pyramids of tomatoes and peppers in basins, sacks of rice, a pushcart
    for (let i = 0; i < 4; i++) basin(b, 6 + i * 1.2, 1.4, ['#d9482f', '#c9372c', '#5f9a48', '#e8a13a'][i]!, 0.5);
    sacks(b, 5.6, 3.4, 4, 2, '#d9cdaa'); sacks(b, -13, 1, 2, 3, '#cdbf99');
    b.at(-4, 0, 6, 0.5, () => { b.box(0, 0.62, 0, 1, 0.4, 1.5, '#4d7a8a'); b.ico(0, 0.92, 0, 0.42, 0.24, 0.6, '#a67c4a'); b.cyl(0, 0.3, 0.9, 0.3, 0.12, BLACK, { seg: 8, rz: HALF }); });
    parasol(b, -3, 2.6, { colors: ['#3f9a5a', '#f0e2c0'] }); b.box(-3, 0.07, 3.7, 2.6, 0.04, 1.8, '#a1493d'); for (let i = 0; i < 4; i++) b.ball(-3.8 + i * 0.45, 0.24, 3.7, 0.2, 0.16, 0.2, i % 2 ? '#8a5a36' : '#b98a4f', { seg: 6 });
    labelled(b, label, 0, 6.2, -6.6, 9, 0.46, '#f4e6b8', '#7a2f2a', false);
    for (const x of [-4.6, 4.6]) b.cyl(x, 3.1, -6.8, 0.07, 6.2, WOOD_DARK, { seg: 5 });
    stringLights(b, [-13, 3.8, 1], [-3, 4.2, 0.4], { n: 8 });
    lampPost(b, 1, 5, { light: true });
    extra(b, 'ksh-trader-1', -7, -10.1, 0, 'work'); extra(b, 'ksh-trader-2', 7, -10.1, 0.2, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'green', fabric: 'ankara' } });
    extra(b, 'ksh-trader-3', -10, -4.2, 0, 'wave'); extra(b, 'ksh-shopper', 0.6, 2.6, 2.6, 'walk');
    return {
      spots: [
        landmark('produce', /aisle|price|produce|food|stall|market|row/, -1.4, -4.6, PI),
        landmark('work', /work|staff|porter|job|shift|carry/, 3.4, 5.8, 0.6, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 1.4, 3, 0),
      ],
      crowd: MARKET_CROWD,
      spare: [[-4, 7.4], [0, 8.4], [4, 7.8], [2, 5.6]],
    };
  },
};

/** Shops made of shipping containers, a truck unloading, provision stores and a phone kiosk. */
const marketContainers: SceneDef = {
  mood: 'outdoor', accent: '#3f72c4',
  walk: OPEN,
  build(b, { label }) {
    groundMarket(b, '#b9b09a');
    const cols: Colour[] = ['#3f72c4', '#c9423a', '#2f8f55', '#e0a43a', '#7a4a8e', '#3f9a9a'];
    // A block of containers two high at the back, each with an open front and a fascia
    for (let i = 0; i < 4; i++) {
      const x = -11 + i * 4.8;
      b.box(x, 1.4, -9.6, 4.6, 2.8, 2.6, cols[i]!);
      b.box(x, 1.2, -8.26, 3.6, 2, 0.1, '#2a2d33'); b.box(x, 2.8, -8.26, 4.4, 0.5, 0.1, WHITE);
      for (let k = 0; k < 4; k++) b.box(x - 1.4 + k * 0.94, 1.0, -8.2, 0.7, 1.3, 0.06, ['#e8a13a', '#d9482f', '#5f9a48', '#9fd8ff'][(i + k) % 4]!);
      if (i % 2 === 0) { b.box(x, 4.2, -9.6, 4.6, 2.8, 2.6, cols[(i + 3) % 6]!); for (let k = 0; k < 8; k++) b.box(x - 1.9 + k * 0.54, 4.2, -8.28, 0.08, 2.6, 0.06, '#1a1a1a'); }
    }
    sign(b, -6.2, 2.84, -8.18, 'PROVISIONS', { size: 0.3, color: '#26283a' });
    sign(b, 3.4, 2.84, -8.18, 'PHONES', { size: 0.3, color: '#26283a' });
    labelled(b, label, 0, 6.9, -8.3, 14, 0.5, '#f4e6b8', '#26435f', false);
    for (const x of [-7, 7]) b.cyl(x, 3.3, -8.2, 0.08, 6.6, METAL_DARK, { seg: 5 });
    // A truck backed up to the left side, cartons on a hand trolley
    truck(b, 9.4, -1, PI, '#c9423a', '#d9d4c4');
    for (let i = 0; i < 6; i++) crate(b, 6.2 + (i % 3) * 0.8, Math.floor(i / 3) * 0.6, 4.2, { s: 0.8, color: '#c9a56a' });
    b.box(-8, 0.55, 4, 1.4, 0.1, 0.8, WOOD); b.cyl(-8.6, 0.25, 4.5, 0.25, 0.1, BLACK, { seg: 6, rz: HALF }); for (let i = 0; i < 3; i++) crate(b, -8.2, 0.55 + i * 0.5, 4, { s: 0.7 });
    parasol(b, -4, 3.2, { colors: ['#3f72c4', WHITE] }); b.box(-4, 0.6, 4.2, 2, 0.1, 0.8, WOOD); for (let i = 0; i < 4; i++) b.box(-4.6 + i * 0.4, 0.9, 4.2, 0.3, 0.5, 0.04, ['#c9423a', '#3f72c4', '#e0a43a', '#3f9a5a'][i]!);
    lampPost(b, 1.8, 3.6, { light: true }); lampPost(b, -12.4, 3.6);
    stringLights(b, [-12, 4.2, 2.4], [-2, 4.6, 2.2], { n: 9 });
    extra(b, 'ctr-seller', -4, 3.2, 0.1, 'work'); extra(b, 'ctr-porter', 6.4, 3.4, 1, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'orange' } });
    extra(b, 'ctr-clerk', -9, -6.4, 0, 'stand', { look: { body: 'woman', outfit: 'office', outfitColor: 'navy' } });
    return {
      spots: [
        landmark('produce', /aisle|price|produce|food|stall|market|row/, -2.8, -4.4, PI),
        landmark('work', /work|staff|porter|job|shift|carry/, 4.2, 5.8, 0.6, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 1.4, 3, 0),
      ],
      crowd: MARKET_CROWD,
      spare: [[-4, 7.4], [0, 8.4], [4, 7.8], [2, 5.6]],
    };
  },
};

/** Sacks of garri and beans under big umbrellas behind a gate arch, a long cloth line of cotton wrappers. */
const marketGarri: SceneDef = {
  mood: 'outdoor', accent: '#d6a83a',
  walk: OPEN,
  build(b, { label }) {
    groundMarket(b, '#d0b080');
    // The gate arch at the back with the market's name
    for (const x of [-4.6, 4.6]) { b.box(x, 2.4, -10.4, 1.6, 4.8, 1.6, '#e6dcc2'); b.box(x, 4.9, -10.4, 2, 0.3, 2, '#cfc4a8'); }
    b.box(0, 4.7, -10.4, 9.6, 1.2, 1.2, '#e6dcc2'); b.cyl(0, 4.1, -10.4, 3.2, 1.2, '#e6dcc2', { seg: 14, rx: HALF, top: 1, sz: 0.5 });
    b.box(0, 5.5, -10.4, 10, 0.25, 1.5, '#cfc4a8');
    labelled(b, label, 0, 4.7, -9.7, 8.4, 0.46, '#2a3f6e', '#f0e8d0', false);
    // Rows of umbrellas over sacks of garri (white), beans (brown) and rice, with scoops
    const sets: [number, number, Colour, Colour][] = [[-9.6, -5.6, '#e9e2c4', '#e9614b'], [-5.2, -6.4, '#8a5a36', '#3f9a5a'], [0, -5.4, '#e9e2c4', '#e0a43a'], [5, -6.2, '#d9c9a0', '#3f72c4'], [9.6, -5.4, '#8a5a36', '#c9423a'], [-9.4, 0, '#d9c9a0', '#8055c2'], [10, 1, '#e9e2c4', '#e0a43a']];
    for (const [x, z, sack, umb] of sets) {
      parasol(b, x, z, { h: 3.2, r: 2.1, colors: [umb, WHITE] });
      sacks(b, x - 0.9, z + 1.4, 3, 2, sack);
      b.cyl(x + 1.3, 0.3, z + 1.4, 0.4, 0.5, '#8d8d90', { seg: 8 }); b.disc(x + 1.3, 0.56, z + 1.4, 0.34, sack, { seg: 8 });
      stool(b, x - 1.2, z - 0.5, { h: 0.45 });
    }
    // A cotton wrapper line across the lane and a trader with a head load
    for (const x of [-3, 3]) b.cyl(x, 2.5, 3, 0.08, 5, WOOD_DARK, { seg: 5 });
    b.box(0, 4.9, 3, 6.2, 0.07, 0.07, '#c9b88f');
    for (let i = 0; i < 4; i++) adireCloth(b, -2.1 + i * 1.4, 3.6, 3.05, 1.2, 2.6, i, 0, ['#c9423a', '#e0a43a', '#3f72c4', '#2f8f55'][i]!, '#f0e8d0');
    stringLights(b, [-13, 3.6, -1.6], [-4, 4.2, -2], { n: 8 });
    lampPost(b, 2, 0, { light: true }); lampPost(b, -6.2, 5.2);
    extra(b, 'gar-trader-1', -9.6, -4.6, 0.3, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'red', fabric: 'ankara', hair: 'gele' } });
    extra(b, 'gar-trader-2', 5, -4.8, -0.3, 'sit', { seat: 0.45, look: { body: 'woman', outfit: 'kaftan', outfitColor: 'blue', hair: 'gele' } });
    extra(b, 'gar-trader-3', -5.2, -4.8, 0.2, 'stand'); extra(b, 'gar-shopper', 0.6, 0.6, 2.6, 'walk');
    return {
      spots: [
        landmark('produce', /aisle|price|produce|food|stall|market|row|garri/, -2.4, -2, PI),
        landmark('work', /work|staff|porter|job|shift|carry/, 3.6, 6, 0.6, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 1.4, 4.6, 0),
      ],
      crowd: MARKET_CROWD,
      spare: [[-4, 7.4], [0, 8.4], [4, 7.8], [2, 5.6]],
    };
  },
};

/** A round central shed under a conical roof, ringed with baskets of kola, yams and cartons of produce. */
const marketKola: SceneDef = {
  mood: 'outdoor', accent: '#c9423a',
  walk: OPEN,
  build(b, { label }) {
    groundMarket(b, '#c4a06c');
    // The round shed at the back: a ring of posts under a low conical iron roof; kola, yams and baskets stand around and in front of it
    b.cyl(-2, 0.14, -7.6, 4.6, 0.28, '#8a6644', { seg: 14 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; b.cyl(-2 + Math.sin(a) * 4, 1.6, -7.6 + Math.cos(a) * 4, 0.14, 3.2, WOOD_DARK, { seg: 5 }); }
    b.cone(-2, 3.9, -7.6, 5.4, 1.7, '#9b5a3a', { seg: 14 }); b.cone(-2, 5, -7.6, 0.9, 0.7, '#7a4530', { seg: 8 });
    const warm: Colour[] = ['#b05a3a', '#c98a4f', '#8a4a30', '#d9b070', '#a8653f'];
    for (let i = 0; i < 9; i++) { const a = (i / 9) * PI * 2 + 0.3; const x = -2 + Math.sin(a) * 2.6, z = -7.6 + Math.cos(a) * 2.6; b.cyl(x, 0.65, z, 0.55, 0.5, '#b9955a', { seg: 8, top: 1.3 }); b.ico(x, 1.05, z, 0.5, 0.28, 0.5, warm[i % 5]!); }
    for (let i = 0; i < 6; i++) { const x = -8 + i * 1.5, z = -2.6 + (i % 2) * 0.5; b.cyl(x, 0.65, z, 0.6, 0.5, '#b9955a', { seg: 8, top: 1.3 }); b.ico(x, 1.1, z, 0.55, 0.3, 0.55, warm[(i + 2) % 5]!); }
    for (const [x, z, c] of ([[7.6, -7.6, '#c98a4f'], [9, -6.2, '#d9c9a0'], [10.4, -7.6, '#a8653f'], [9.4, -9, '#d9c9a0']] as [number, number, string][])) { b.cyl(x, 0.65, z, 0.6, 0.5, '#b9955a', { seg: 8, top: 1.3 }); b.ico(x, 1.1, z, 0.55, 0.3, 0.55, c); }
    // Side stalls with produce on mats: yams stacked, bean sacks, cartons
    b.at(-9.4, 0, 3.6, HALF, () => { shed(b, 0, 0, 5.2, 3, 3, 2.9); table(b, 0, 0.2, { w: 4.2, d: 1, h: 0.9, color: '#7a5c3c' }); for (let i = 0; i < 4; i++) heapOf(b, -1.4 + i * 0.95, 0.2, ['#d9482f', '#5f9a48', '#e8a13a', '#b98a4f'][i]!, 0.38); });
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) b.cyl(7 + i * 0.7, 0.18 + j * 0.3, 4 + j * 0.15, 0.2, 1.2, '#a0683c', { seg: 5, rz: HALF });
    sacks(b, 8.6, 6.2, 3, 2, '#8a5a36'); sacks(b, 9.2, 2, 2, 2, '#d9cdaa');
    for (let i = 0; i < 5; i++) crate(b, -3 + (i % 3) * 0.9, Math.floor(i / 3) * 0.62, 6.8, { s: 0.85, color: '#c9a56a' });
    labelled(b, label, 3, 3, 3.2, 9, 0.4, '#f4e6b8', '#7a2f2a', false, 0);
    for (const x of [-1.4, 7.4]) b.cyl(x, 1.5, 3.2, 0.07, 3, WOOD_DARK, { seg: 5 });
    lampPost(b, 4, 2, { light: true }); lampPost(b, -4.6, 8.4);
    extra(b, 'kol-trader-1', 1, -5.2, PI, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', fabric: 'ankara', hair: 'gele' } });
    extra(b, 'kol-trader-2', -5.8, -6.6, 0.3, 'stand'); extra(b, 'kol-trader-3', -9.4, 4.8, -HALF, 'wave');
    extra(b, 'kol-shopper', 5.6, 0.6, 2.6, 'walk');
    return {
      spots: [
        landmark('produce', /aisle|price|produce|food|stall|market|row|kola/, 1, -3.6, PI),
        landmark('work', /work|staff|porter|job|shift|carry/, 4.4, 5.6, 0.6, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, -4, 3.6, 0),
      ],
      crowd: MARKET_CROWD,
      spare: [[-4, 7.4], [0, 8.4], [4, 7.8], [2, 5.6]],
    };
  },
};


// ---------------------------------------------------------------------------------------------
// University courts: one builder per silhouette, sharing the small pieces below.

/** A block of floors with rows of windows on its front and one side, a flat roof slab and an entrance. */
function lectureBlock(b: Batch, x: number, z: number, w: number, d: number, floors: number, wall: Colour, band: Colour, roof: Colour = '#cfc8b4'): void {
  const h = floors * 3;
  b.box(x, h / 2, z, w, h, d, wall);
  b.box(x, h + 0.15, z, w + 0.5, 0.3, d + 0.5, roof);
  const front = z + d / 2, n = Math.floor(w / 1.9);
  for (let f = 0; f < floors; f++) {
    b.box(x, 3 * f + 0.1, front + 0.02, w + 0.1, 0.2, 0.06, band);
    for (let i = 0; i < n; i++) b.quad(x - w / 2 + (i + 0.5) * (w / n), 3 * f + 1.8, front + 0.03, 1.1, 1.3, '#7fa4b8');
  }
  b.box(x, 1.1, front + 0.04, 1.8, 2.2, 0.08, '#4a3a2c');
  b.box(x, 2.5, front + 0.5, 3, 0.2, 1.2, band);
  for (const s of [-1, 1]) b.box(x + s * 1.4, 1.2, front + 1, 0.2, 2.4, 0.2, band);
}
/** Two paths, a flag and benches: the plain furniture of a court. */
function paths(b: Batch, c = '#d8cfb8'): void {
  b.box(0, 0.05, 5.6, 3.2, 0.04, 14.8, c); b.box(0, 0.05, 2.2, 26, 0.04, 2.4, c);
}
function standing(b: Batch, id: string, x: number, z: number, ry: number, look?: Record<string, unknown>, pose: 'stand' | 'walk' | 'wave' | 'work' | 'sit' = 'stand'): void {
  extra(b, id, x, z, ry, pose, look ? { look } : undefined);
}
const campusSpots = (labX: number, labZ: number, labRy: number, workX: number, workZ: number, extraSpots: ReturnType<typeof landmark>[] = []) => [
  landmark('lab', /lab|innov|enterpr|project|tech|class|teach|lecture|workshop/, labX, labZ, labRy),
  landmark('work', /work|staff|office|admin|job|shift/, workX, workZ, PI, { act: { pose: 'work' } }),
  ...extraSpots,
  landmark('people', /people|crowd|meet/, 0.6, 6.4, 0),
];

/** A farm campus: plots of crops, a greenhouse, a tractor shed and a lecture block. */
const campusFarm: SceneDef = {
  mood: 'outdoor', accent: '#5fae4a',
  walk: OPEN,
  build(b, { label }) {
    const rand = seeded(31);
    ground(b, { w: 30, d: 26, color: '#79a850', edge: '#4f7a3a' });
    paths(b, '#d9c9a0');
    lectureBlock(b, -8.4, -9.6, 9.4, 4, 2, '#f1ecd9', '#2f8f55', '#bdb7a0');
    // The greenhouse: a glazed gable on a low plinth with rows of seedlings inside, a water tank on stilts beside it
    b.box(7, 0.35, -9.4, 9.4, 0.7, 5.6, '#a8a38c');
    b.box(7, 1.9, -9.4, 9, 2.4, 5.2, '#bfe0d6', GLASS);
    for (const side of [-1, 1]) b.box(7, 3.7, -9.4 + side * 1.4, 9.4, 0.1, 3.2, '#cfeadf', { rx: -side * 0.5, ...GLASS });
    for (let i = 0; i <= 5; i++) b.box(2.8 + i * 1.68, 2, -6.8, 0.1, 2.5, 0.1, '#e8e4d4');
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) b.ico(3.4 + i * 1.5, 0.95, -10.6 + r * 1.2, 0.34, 0.26, 0.34, i % 2 ? '#3f9a4a' : '#5fae4a');
    b.cyl(12.8, 2.6, -4.4, 1, 1.6, '#8aa0aa', { seg: 10, top: 0.95 }); for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as [number, number][]) b.box(12.8 + dx, 1, -4.4 + dz, 0.12, 2, 0.12, METAL_DARK);
    // Plots: raised beds of crops in rows, an irrigation pipe, a scarecrow
    for (let p = 0; p < 3; p++) {
      const x = -10.4 + p * 5, tall = p === 1;
      b.box(x, 0.12, 0.2, 4.2, 0.24, 6, '#6b4a30');
      for (let r = 0; r < 4; r++) { b.box(x - 1.5 + r, 0.2, 0.2, 0.5, 0.18, 5.6, '#5a3a24'); for (let i = 0; i < 6; i++) { if (tall) b.cyl(x - 1.5 + r, 0.7, -2.2 + i * 0.95, 0.07, 1.2 + rand() * 0.5, '#6fae48', { seg: 4 }); else b.ico(x - 1.5 + r, 0.45, -2.2 + i * 0.95, 0.26, 0.26, 0.3, p === 0 ? '#58a844' : '#8aa83a'); } }
    }
    b.cyl(-3, 0.28, 4, 0.05, 20, '#2a6a8a', { seg: 4, rx: HALF });
    b.cyl(-10.4, 0.8, 4, 0.05, 1.6, WOOD_DARK, { seg: 4 }); b.box(-10.4, 1.3, 4, 1.2, 0.06, 0.06, WOOD_DARK); b.ico(-10.4, 1.7, 4, 0.2, 0.24, 0.2, '#d9c9a0');
    // The tractor shed: an open shed with a tractor, hay bales and a trailer
    shed(b, 11, 1.4, 6, 4, 1, 3.2); tractor(b, 10, 1.2, 0.3);
    for (let i = 0; i < 4; i++) b.cyl(12.8, 0.4 + (i % 2) * 0.7, 0.2 + Math.floor(i / 2) * 0.9, 0.38, 0.9, '#d6b45a', { seg: 8, rz: HALF });
    b.box(11, 0.6, 4.2, 1.8, 0.2, 3, '#5a6a72'); for (const s of [-1, 1]) b.cyl(11 + s * 1, 0.4, 4.9, 0.4, 0.2, BLACK, { seg: 7, rz: HALF });
    labelled(b, label, -8.4, 7.4, -7.2, 8.6, 0.42, '#f1f0d8', '#2a6a3a', false);
    standing(b, 'farm-student-1', -6, 3.6, 0.4, { body: 'woman', outfit: 'casual', outfitColor: 'green' }); standing(b, 'farm-lecturer', 2.8, -4.4, PI, { body: 'man', outfit: 'sitework', outfitColor: 'navy' });
    standing(b, 'farm-worker', 9, 5.6, 0.8, { body: 'man', outfit: 'casual', outfitColor: 'orange' }, 'work');
    leafTree(b, -13, 5, { s: 1.2, tone: 2 }); leafTree(b, 13.4, 9, { s: 1.1, tone: 0 }); bush(b, 4, -4.8, { s: 0.8 }); flag(b, -2.6, -4.6, { h: 6 });
    return {
      spots: campusSpots(8, -4.2, PI, 3.6, -3.2, [landmark('plots', /plot|farm|field|crop|garden/, -4.6, 5, PI)]),
      crowd: standardCrowd().map(([x, z, r]) => [x, Math.max(z, 6), r] as [number, number, number]), spare: FRONT_SPARE,
    };
  },
};

/** An orderly campus: a chapel under a dome, a long colonnade, hedged lawns and a fountain. */
const campusDome: SceneDef = {
  mood: 'outdoor', accent: '#d6a83a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#6aa656', edge: '#46703a' });
    paths(b, '#e8e0cc');
    b.disc(0, 0.06, 2.2, 3.2, '#e8e0cc', { seg: 20 });
    // The chapel: a broad hall of pale stone with a portico, a drum and a great white dome with a gold lantern
    b.box(0, 2.4, -9, 13, 4.8, 8, '#efe7d2'); b.box(0, 4.95, -9, 13.6, 0.3, 8.6, '#d6ccb2');
    for (const x of [-2.6, -0.9, 0.9, 2.6]) b.cyl(x, 2.4, -4.4, 0.3, 4.6, WHITE, { seg: 8, top: 0.88 });
    b.box(0, 5, -4.4, 7, 0.4, 1.6, '#d6ccb2');
    for (let i = 0; i < 4; i++) b.box(0, 0.1 + i * 0.1, -3.4 + (3 - i) * 0.4, 7, 0.2 + i * 0.1, 0.5, '#e0d8c2');
    b.box(0, 1.6, -4.94, 1.8, 3.2, 0.1, '#4a3a2c');
    b.cyl(0, 6.2, -9, 4.4, 2.4, '#f4eedc', { seg: 16 });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; b.box(Math.sin(a) * 4.44, 6.2, -9 + Math.cos(a) * 4.44, 0.5, 1.6, 0.14, '#7aa0b8', { ry: a }); }
    b.ball(0, 7.4, -9, 4.5, 3.8, 4.5, '#f6f1e2', { seg: 16 });
    b.cyl(0, 11.2, -9, 0.6, 1.2, '#d6a83a', { seg: 8 }); b.cone(0, 12.3, -9, 0.7, 1, '#d6a83a', { seg: 8 }); b.box(0, 13.1, -9, 0.1, 0.8, 0.1, '#d6a83a');
    labelled(b, label, 0, 5.9, -3.5, 7.8, 0.4, '#f4e6b8', '#2f3b36', false);
    // The long colonnade along the left: a row of columns carrying a flat roof from the chapel to the front
    for (let z = -10; z <= 9; z += 2.4) { b.cyl(-9.4, 1.7, z, 0.24, 3.4, WHITE, { seg: 8 }); b.cyl(-6.4, 1.7, z, 0.24, 3.4, WHITE, { seg: 8 }); }
    b.box(-7.9, 3.55, -0.5, 4.2, 0.3, 21.4, '#e8e0cc'); b.box(-7.9, 3.8, -0.5, 4.6, 0.12, 21.8, '#d6ccb2');
    b.box(-7.9, 0.04, -0.5, 2.6, 0.03, 20.6, '#d4c8a8');
    // A glass library block at the right, ordered hedge lines and beds, a fountain
    lectureBlock(b, 9.4, -8.6, 9, 5, 3, '#e0dcd0', '#2f6fa8', '#bdb7a0');
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) b.box(side * 3.4, 0.35, -0.6 + i * 2.8, 1, 0.7, 2.2, '#3d7a40');
    b.cyl(0, 0.25, 2.2, 1.6, 0.5, '#bdb7a0', { seg: 12 }); b.disc(0, 0.52, 2.2, 1.35, '#79c3df', { seg: 12, ...GLASS }); b.cyl(0, 1, 2.2, 0.16, 1, '#bdb7a0', { seg: 6 });
    for (const x of [-4.4, 4.4]) { b.box(x, 0.2, 8.4, 3, 0.4, 1.4, '#6b4a30'); for (let i = 0; i < 5; i++) b.ico(x - 1.1 + i * 0.55, 0.55, 8.4, 0.24, 0.2, 0.24, ['#e9614b', '#e8c43a', '#f1efe8', '#dd6fa0', '#8055c2'][i]!); }
    flag(b, 6.2, 3.6, { h: 7 }); flag(b, 7.6, 3.6, { h: 7, colors: ['#d6a83a', '#2a4fa6', '#d6a83a'] });
    bench(b, 4.6, 6.2, { w: 2.8, back: true, ry: PI, color: '#bdb7a6', leg: '#8f8a7d' });
    standing(b, 'dome-student-1', -7.9, 2, HALF, { body: 'woman', outfit: 'office', outfitColor: 'navy' }, 'walk'); standing(b, 'dome-student-2', 4.6, 6.2, PI, undefined, 'sit');
    standing(b, 'dome-staff', 9.4, -5.4, PI, { body: 'man', outfit: 'sitework', outfitColor: 'navy' });
    for (const x of [-13, 13]) leafTree(b, x, 9.6, { s: 1.2, tone: 0 }); palm(b, 13.4, 3, { s: 1.05 });
    lampPost(b, -3.6, 5, { light: true }); lampPost(b, 3.6, 5); lampPost(b, -3.6, -1); lampPost(b, 3.6, -1);
    return { spots: campusSpots(9.4, -4.6, PI, 4.6, -3.4, [landmark('colonnade', /colonnade|walk|path|stroll/, -7.9, 4.6, PI)]), crowd: standardCrowd(), spare: FRONT_SPARE };
  },
};

/** A technology campus: sawtooth workshops, a lab block with a dish, rows of solar panels. */
const campusTech: SceneDef = {
  mood: 'outdoor', accent: '#2f8fd0',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#a8aea0', edge: '#6f756a' });
    b.box(0, 0.05, 6, 30, 0.04, 14, '#c9c5b8'); b.box(0, 0.06, 2.4, 3, 0.02, 12, '#e6dfc8');
    // The workshop: a long hall under sawtooth roofs with high clerestory glass, a roller door and a chimney
    b.box(-6.4, 2.4, -9.4, 15.6, 4.8, 6.4, '#d9d4c4');
    for (let i = 0; i < 4; i++) { const x = -12 + i * 3.9; b.box(x + 1.95, 5.6, -9.4, 0.14, 1.6, 6.4, '#b0b4b0'); b.box(x, 5.4, -9.4, 3.9, 0.12, 6.6, '#7a8a92', { rz: -0.4 }); b.box(x + 1.4, 5.2, -6.18, 1.2, 1, 0.06, '#8fc4d8', GLASS); }
    b.box(-6.4, 1.5, -6.18, 5, 3, 0.1, '#3a6ea5'); for (let i = 0; i < 6; i++) b.box(-6.4, 0.4 + i * 0.5, -6.1, 5, 0.04, 0.06, '#2f5a90');
    labelled(b, label, -6.4, 4.1, -6.1, 8.6, 0.42, WHITE, '#2f5a90', true);
    b.cyl(-13.2, 4.2, -12, 0.5, 8.4, '#b0a898', { seg: 8, top: 0.8 });
    // A lab block with a glass front, a rooftop dish and a mast
    lectureBlock(b, 7.4, -9.2, 9, 5.4, 2, '#e8ecee', '#2f8fd0', '#9aa4a8');
    b.cyl(9.6, 7.4, -9.2, 0.1, 2.2, '#c9ced3', { seg: 5 }); b.ball(9.6, 8.6, -9.2, 1, 0.3, 1, '#e8ecee', { seg: 8 }); b.cyl(5, 8.6, -9.2, 0.07, 5, '#c9ced3', { seg: 4 });
    // Solar panels in rows facing the court, a charging post for a small electric cart
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) { b.box(3.4 + i * 1.5, 0.95 + r * 0.02, -2.6 + r * 2.1, 1.35, 0.06, 1.2, '#26446f', { rx: -0.6 }); b.box(3.4 + i * 1.5, 0.45, -2.6 + r * 2.1 + 0.4, 0.07, 0.9, 0.07, METAL_DARK); }
    b.box(-6.4, 0.7, -2.4, 3.4, 1.2, 1.8, '#7a8a92'); b.box(-6.4, 1.4, -2.4, 3, 0.2, 1.5, '#2f8fd0'); b.cyl(-4.6, 0.8, -2.4, 0.3, 1.6, '#d9d4c4', { seg: 6 });
    // Cable reels, pallets and a robot arm on a bench by the workshop
    b.cyl(-11.4, 0.4, -4.4, 0.55, 0.8, '#b07a3c', { seg: 8 }); b.cyl(-10.2, 0.4, -4.4, 0.55, 0.8, '#b07a3c', { seg: 8 });
    b.box(-8.4, 0.55, -4.2, 2, 0.1, 0.9, WOOD); b.box(-8.4, 0.9, -4.2, 0.4, 0.6, 0.4, '#e0a43a'); b.box(-8.1, 1.4, -4.2, 0.9, 0.12, 0.12, '#e0a43a', { rz: 0.5 });
    flag(b, 0.6, -3.6, { h: 6, colors: ['#2f8fd0', WHITE, '#2f8fd0'] });
    standing(b, 'tech-student', -2, 5, 0.5, { body: 'woman', outfit: 'casual', outfitColor: 'teal' }); standing(b, 'tech-welder', -8.4, -3.4, PI, { body: 'man', outfit: 'casual', outfitColor: 'orange' }, 'work');
    standing(b, 'tech-staff', 7.4, -5.6, PI, { body: 'man', outfit: 'sitework', outfitColor: 'navy' });
    leafTree(b, 12.6, 6, { s: 1.1, tone: 1 }); leafTree(b, -13, 9, { s: 1.1, tone: 0 }); lampPost(b, 2.8, 5, { light: true }); lampPost(b, -2.8, 5);
    return { spots: campusSpots(-6.4, -3.8, PI, 7.4, -4.8, [landmark('panels', /solar|panel|power|energy/, 7.4, 1.2, PI)]), crowd: standardCrowd(), spare: FRONT_SPARE };
  },
};

/** A lawn campus: red-roofed halls round a wide lawn, a gate with a barrier. */
const campusLawn: SceneDef = {
  mood: 'outdoor', accent: '#c9423a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#7db856', edge: '#4f7a3a' });
    b.box(0, 0.05, 0.6, 21, 0.05, 15, '#8cc662'); b.box(0, 0.06, 0.6, 22.4, 0.04, 16.4, '#d8cfb4'); b.box(0, 0.07, 0.6, 21, 0.05, 15, '#8cc662');
    b.box(0, 0.08, 4, 3, 0.04, 16, '#d8cfb4');
    // Three halls in cream with red tile roofs: one across the back, two at the sides, turned inward
    const hallAt = (x: number, z: number, w: number, d: number, ry: number, h: number) => b.at(x, 0, z, ry, () => {
      b.box(0, h / 2, 0, w, h, d, '#f1e6c8'); b.box(0, h + 0.1, 0, w + 0.4, 0.2, d + 0.4, '#d6c8a0');
      for (const s of [-1, 1]) b.box(0, h + 1.1, s * d * 0.25, w + 1, 0.16, d * 0.62, s < 0 ? '#c9423a' : '#b83a34', { rx: -s * 0.42 });
      b.box(0, h + 1.9, 0, w + 1, 0.18, 0.3, '#8a2a28');
      const n = Math.floor(w / 2);
      for (let i = 0; i < n; i++) { const x0 = -w / 2 + (i + 0.5) * (w / n); b.quad(x0, h * 0.62, d / 2 + 0.03, 1.1, 1.4, '#7fa4b8'); b.quad(x0, h * 0.2, d / 2 + 0.03, 1.1, 1.2, '#7fa4b8'); b.box(x0, 1.0, d / 2 + 0.6, 0.2, 2, 0.2, WHITE); }
      b.box(0, 2.1, d / 2 + 0.7, w, 0.2, 1.4, '#d6c8a0');
    });
    hallAt(0, -9.8, 16, 5.2, 0, 4.4); hallAt(-12, -2, 8, 4.4, HALF, 3.6); hallAt(12, -2, 8, 4.4, -HALF, 3.6);
    b.cyl(0, 6.6, -9.8, 0.9, 1.6, '#f1e6c8', { seg: 8 }); b.cone(0, 8.2, -9.8, 1.2, 1.4, '#c9423a', { seg: 8 });
    labelled(b, label, 0, 6.2, -7, 9, 0.42, '#f4e6b8', '#7a2a2a', false);
    // The gate: two pillars, a name arch, a barrier arm and a guard house
    for (const x of [-3.6, 3.6]) { b.box(x, 1.5, 11.4, 1, 3, 1, '#e8dcc2'); b.box(x, 3.15, 11.4, 1.4, 0.3, 1.4, '#cfc4a8'); b.ball(x, 3.55, 11.4, 0.3, 0.3, 0.3, '#c9423a', { seg: 6 }); }
    b.box(-4.6, 1.2, 11.4, 1.8, 2.4, 1.8, '#e8dcc2'); b.box(-4.6, 2.5, 11.4, 2.2, 0.2, 2.2, '#b83a34'); b.box(0, 0.9, 11.4, 0.1, 1.2, 0.1, METAL_DARK); b.box(1.6, 1.2, 11.4, 3.2, 0.12, 0.12, '#c9423a');
    // Beds and trees along the lawn edge, a bench, a bell on a post
    for (let i = 0; i < 4; i++) { b.box(-9.2 + i * 6, 0.18, 7.4, 2.6, 0.36, 1.2, '#7a5a3c'); for (let k = 0; k < 4; k++) b.ico(-10.2 + i * 6 + k * 0.7, 0.5, 7.4, 0.24, 0.2, 0.24, ['#e9614b', '#e8c43a', '#dd6fa0', '#f1efe8'][(i + k) % 4]!); }
    for (const [x, z, s, t] of ([[-13.4, 6, 1.3, 0], [13.4, 6, 1.3, 2], [-13, 11, 1.1, 1], [13, 11, 1.1, 0]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    bench(b, -6, 5.2, { w: 2.8, back: true, ry: PI, color: '#bdb7a6', leg: '#8f8a7d' }); standing(b, 'lawn-reader', -6, 5.2, PI, undefined, 'sit');
    standing(b, 'lawn-student-1', 5, 4, 2.4, { body: 'woman', outfit: 'casual', outfitColor: 'red' }); standing(b, 'lawn-student-2', 6.6, 4.4, -2.2, { body: 'man', outfit: 'casual', outfitColor: 'navy' }, 'wave');
    standing(b, 'lawn-guard', -2.4, 10.2, 3, { body: 'man', outfit: 'office', outfitColor: 'navy' }); standing(b, 'lawn-staff', 2.4, -5.8, PI, { body: 'woman', outfit: 'sitework', outfitColor: 'teal' });
    lampPost(b, -2.6, 3, { light: true }); lampPost(b, 2.6, 3); lampPost(b, -2.6, -3); lampPost(b, 2.6, -3);
    return { spots: campusSpots(0, -4.6, PI, 3.4, -5.2, [landmark('lawn', /lawn|green|walk|gate/, -3, 6.6, 0)]), crowd: standardCrowd().map(([x, z, r]) => [x, Math.min(Math.max(z, 5.6), 9.4), r] as [number, number, number]), spare: [[-8, 8], [8, 8], [-3, 9], [3.4, 9]] };
  },
};

/** A court of lecture blocks round a flag court: concrete, louvres, a rostrum. */
const campusFlag: SceneDef = {
  mood: 'outdoor', accent: '#e0762c',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#a9a58f', edge: '#74705d' });
    b.box(0, 0.05, 1.6, 26, 0.04, 17, '#cfc9b6');
    for (let i = -6; i <= 6; i++) b.box(i * 2, 0.07, 1.6, 0.04, 0.02, 17, '#b9b39e');
    // A three-storey block of grey concrete with louvres and an outside stair, a lower block with a corrugated roof
    const w = 15;
    b.box(-4.2, 4.5, -9.6, w, 9, 5, '#c9c5b6'); b.box(-4.2, 9.15, -9.6, w + 0.5, 0.3, 5.5, '#8f8b7c');
    for (let f = 0; f < 3; f++) { b.box(-4.2, 3 * f + 0.2, -7.06, w + 0.1, 0.4, 0.14, '#8f8b7c'); for (let i = 0; i < 8; i++) { b.quad(-10.7 + i * 1.86, 3 * f + 1.8, -7.06, 1.2, 1.2, '#7fa4b8'); for (let k = 0; k < 4; k++) b.box(-10.7 + i * 1.86, 3 * f + 1.4 + k * 0.28, -7.0, 1.3, 0.05, 0.1, '#e0762c'); } }
    for (let i = 0; i < 9; i++) b.box(4.4 + i * 0.22, 0.25 + i * 0.5, -7.4, 0.22, 0.5 + i * 0.5, 1.2, '#b5b09f');
    b.box(11.4, 2.1, -8.6, 5.6, 4.2, 6.4, '#d6d1bf'); for (let i = 0; i < 8; i++) b.box(8.9 + i * 0.7, 4.6, -8.6, 0.08, 0.14, 6.6, '#9b5a3a', { rx: -0.1 });
    b.box(11.4, 4.4, -8.6, 6, 0.3, 6.8, '#b5b09f');
    for (let i = 0; i < 3; i++) b.quad(9.6 + i * 1.8, 1.8, -5.38, 1, 1.6, '#7fa4b8');
    labelled(b, label, -4.2, 9.9, -6.8, 12, 0.5, WHITE, '#2c3f6a', false);
    // The flag court: a row of five poles with the national colours and the institution's, a rostrum, rows of seats
    const flags: Colour[][] = [['#2f8f55', WHITE, '#2f8f55'], ['#e0762c', WHITE, '#2c3f6a'], ['#2c3f6a', '#d6a83a', '#2c3f6a'], ['#2f8f55', WHITE, '#2f8f55'], ['#e0762c', '#2c3f6a', '#e0762c']];
    flags.forEach((colors, i) => flag(b, -6 + i * 3, -2.2, { h: 7, w: 1.9, colors }));
    b.box(0.6, 0.45, 0.6, 4.2, 0.9, 2.2, '#bdb7a6'); b.box(0.6, 1, 0.6, 4.4, 0.12, 2.4, '#8f8b7c'); b.box(0.6, 1.5, 0.2, 1.2, 1.1, 0.6, '#6b4a2f');
    for (let r = 0; r < 3; r++) for (let i = 0; i < 5; i++) chair(b, -4.2 + i * 1.4, 3.8 + r * 1.2, { color: '#2c3f6a', ry: PI });
    standing(b, 'flag-speaker', 0.6, 0.2, PI, { body: 'man', outfit: 'agbada', outfitColor: 'cream', accessories: ['fila'] }, 'wave');
    for (let i = 0; i < 3; i++) standing(b, `flag-seated-${i}`, -4.2 + i * 2.8, 3.8, PI, undefined, 'sit');
    standing(b, 'flag-student', 8.4, 3.6, 2.6, { body: 'woman', outfit: 'casual', outfitColor: 'orange' }); standing(b, 'flag-staff', 9.2, -2.6, PI, { body: 'man', outfit: 'sitework', outfitColor: 'navy' });
    leafTree(b, -13, 8, { s: 1.2, tone: 2 }); leafTree(b, 13, 8.4, { s: 1.2, tone: 0 }); lampPost(b, -9, 3, { light: true }); lampPost(b, 5, 8.6);
    return { spots: campusSpots(-4.2, -5.4, PI, 9.2, -3.4, [landmark('court', /court|flag|walk|assembly/, 2.6, 2, PI)]), crowd: standardCrowd().map(([x, z, r]) => [x, Math.max(z, 6.6), r] as [number, number, number]), spare: FRONT_SPARE };
  },
};

// ---------------------------------------------------------------------------------------------
// Studios: two rooms, each with its own tools.

const cloth: Colour[] = ['#c9423a', '#2a4fa6', '#2f8f55', '#d6a83a', '#8055c2', '#dd6fa0'];
const clothStudio: SceneDef = {
  mood: 'indoor', accent: '#d6a83a',
  walk: INDOORS,
  build(b, { label }) {
    room(b, { w: 24, d: 20, h: 5.6, floor: '#c4a87c', wall: '#f0e6cf', side: '#e8dcc2', trim: '#8b6f4e', base: '#5a4636' });
    b.box(0, 0.045, 0, 22, 0.02, 18, '#b99a68');
    labelled(b, label, -1, 4.8, -9.64, 11, 0.42, '#f4e6b8', '#3a2c20', true);
    // A photo backdrop of paper in indigo, two soft boxes on stands, a tripod, a stool for the sitter
    b.box(-4.4, 2.2, -9.2, 7, 4.2, 0.1, '#233c7c'); b.box(-4.4, 0.04, -7.4, 7, 0.02, 3.6, '#233c7c');
    for (const x of [-8.6, -0.4]) { b.cyl(x, 1.4, -6, 0.05, 2.8, METAL_DARK, { seg: 4 }); b.box(x, 2.9, -6, 1.3, 1.3, 0.3, '#f4f4ec', GLOW); b.box(x, 2.9, -6.2, 1.4, 1.4, 0.1, '#2a2d33'); }
    for (const dx of [-0.4, 0, 0.4]) b.box(-4.4 + dx * 1.4, 0.8, -3.4 + Math.abs(dx), 0.05, 1.6, 0.05, METAL_DARK, { rx: dx * 0.5 });
    b.box(-4.4, 1.7, -3.4, 0.5, 0.35, 0.4, '#2a2d33'); b.cyl(-4.4, 1.7, -3.8, 0.16, 0.3, '#1a1c20', { seg: 8, rx: HALF });
    stool(b, -4.4, -7, { h: 0.7 }); standing(b, 'cs-model', -4.4, -7.2, 0, { body: 'woman', outfit: 'owambe', outfitColor: 'violet', fabric: 'asooke', hair: 'gele' }, 'sit');
    standing(b, 'cs-photographer', -4.4, -2.8, PI, { body: 'man', outfit: 'casual', outfitColor: 'teal' }, 'work');
    // Racks of festival cloth in bright woven stripes, tables of folded bolts, a mannequin in a wrapper
    for (const [x, z] of ([[6, -8], [9.4, -8]] as [number, number][])) { for (const s of [-1, 1]) b.box(x + s * 1.5, 1.4, z, 0.1, 2.8, 0.1, WOOD_DARK); b.box(x, 2.7, z, 3.1, 0.07, 0.07, WOOD_DARK); for (let i = 0; i < 6; i++) { b.box(x - 1.2 + i * 0.5, 1.7, z, 0.46, 2, 0.05, cloth[(i + Math.round(x)) % 6]!); b.box(x - 1.2 + i * 0.5, 1.2, z + 0.03, 0.46, 0.2, 0.03, '#f4efe0'); } }
    table(b, 8, -4.4, { w: 5, d: 1.2, h: 0.95, color: '#7a5c3c' }); for (let i = 0; i < 8; i++) b.box(5.9 + i * 0.6, 1.12, -4.4, 0.5, 0.3, 0.9, cloth[i % 6]!);
    b.cyl(-10, 0.9, 1, 0.3, 1.5, '#c9423a', { seg: 7, top: 0.7 }); b.ball(-10, 1.85, 1, 0.22, 0.26, 0.22, '#b08a5c', { seg: 6 }); b.box(-10, 0.06, 1, 0.8, 0.12, 0.8, '#8a6644');
    desk(b, 8.4, 3, { laptop: true }); sofa(b, -8.4, 5.6, 0);
    plant(b, 10.4, 6.4); plant(b, -10.4, -2); lampPost(b, 0.4, 6, { light: true });
    return {
      spots: [
        landmark('studio', /studio|photo|camera|shoot|cloth|festival|create/, -1.2, -2.4, PI),
        landmark('work', /work|staff|office|edit|job|shift/, 8.4, 1.6, PI, { act: { pose: 'work' } }),
        landmark('racks', /rack|fabric|bolt|aso|look/, 7.4, -5.8, PI),
        landmark('people', /people|crowd|meet/, 0.6, 5.4, 0),
      ],
      crowd: [[2.4, 4.4, 0.4], [-1.2, 6.4, -0.5], [4.2, 6.2, 2.6], [-3.4, 3.6, 1.2], [6.4, 2.8, -1], [-6.4, 2, 1.6], [0.6, 7.6, 2.2], [8.6, 5.2, -0.6], [-4.8, 7.4, 0.2], [2.4, 0.4, PI], [-9, 6.8, 2.6], [5.8, 7.6, 0.4]],
    };
  },
};
function sofa(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => { b.box(0, 0.4, 0, 3, 0.5, 1.1, '#7a5c8e'); b.box(0, 0.9, -0.5, 3, 0.7, 0.2, '#7a5c8e'); for (const s of [-1, 1]) b.box(s * 1.55, 0.6, 0, 0.2, 0.7, 1.1, '#6a4c7e'); });
}

const mediaStudio: SceneDef = {
  mood: 'indoor', accent: '#e0a43a',
  walk: INDOORS,
  build(b, { label }) {
    room(b, { w: 24, d: 20, h: 5.6, floor: '#8a7a68', wall: '#4a5060', side: '#424858', trim: '#e0a43a', base: '#2a2d33' });
    b.box(0, 0.045, 0, 22, 0.02, 18, '#6b5a4a');
    labelled(b, label, -1, 4.8, -9.64, 11, 0.42, '#f4e6b8', '#26283a', true);
    // Acoustic panels on the back wall in a grid of muted colours; an ON AIR light
    for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) b.box(-9 + i * 2.2, 1.6 + j * 1.3, -9.58, 2, 1.1, 0.12, (i + j) % 3 === 0 ? '#c9873a' : (i + j) % 3 === 1 ? '#4a5568' : '#7a4a4a');
    b.box(10, 3.4, -9.5, 2.4, 0.9, 0.1, '#2a1a1a'); sign(b, 10, 3.4, -9.42, 'ON AIR', { size: 0.4, color: '#ff5a4a', lit: true });
    // The booth: a glass-fronted box with a microphone on a boom, a pop filter and a stool
    b.box(-6, 1.8, -5, 6.4, 3.6, 4.6, '#2a2d33'); b.box(-6, 1.8, -2.66, 6, 3.2, 0.1, '#9fc4d8', GLASS);
    b.box(-6, 0.08, -5, 6, 0.1, 4.2, '#4a4338');
    b.cyl(-6, 0.9, -5, 0.05, 1.8, METAL_DARK, { seg: 4 }); b.box(-6, 1.8, -5.5, 0.05, 0.05, 0.9, METAL_DARK); b.cyl(-6, 1.7, -4.9, 0.22, 0.04, '#1a1c20', { seg: 8, rx: HALF }); b.ball(-6, 1.8, -5.1, 0.1, 0.14, 0.1, '#c9ced3', { seg: 6 });
    stool(b, -6, -6.2, { h: 0.7 }); standing(b, 'ms-speaker', -6, -6.4, 0, { body: 'woman', outfit: 'kaftan', outfitColor: 'orange' }, 'sit');
    // The control desk: a mixing console with sliders, two screens, speakers either side
    b.box(3.6, 0.5, -3.4, 9, 1, 2.2, '#3a3f4a'); b.box(3.6, 1.05, -3.6, 8.6, 0.12, 1.6, '#1a1c20', { rx: -0.2 });
    for (let i = 0; i < 16; i++) { b.box(0.2 + i * 0.5, 1.15, -3.5, 0.08, 0.06, 0.5, i % 3 ? '#9fb0c0' : '#e0a43a', { rx: -0.2 }); b.box(0.2 + i * 0.5, 1.12, -3.8, 0.14, 0.04, 0.14, ['#c9423a', '#2f8f55', '#2a4fa6'][i % 3]!); }
    screen(b, 1.6, 2.2, -4.2, { w: 2.4, h: 1.4 }); screen(b, 5.6, 2.2, -4.2, { w: 2.4, h: 1.4, color: '#b8f0c8' });
    speaker(b, -0.4, -4.6, { h: 2.2, w: 1 }); speaker(b, 8.2, -4.6, { h: 2.2, w: 1 });
    chair(b, 3.6, -2, { color: '#2f4a66', ry: PI }); standing(b, 'ms-engineer', 3.6, -2.2, PI, { body: 'man', outfit: 'hoodie', outfitColor: 'teal' }, 'work');
    // A lounge: sofa, low table, a rack of cables, plants
    sofa(b, -8.4, 5.6, 0); b.box(-8.4, 0.3, 4, 1.6, 0.5, 0.9, '#8a6644');
    b.cyl(9.6, 0.6, 5.4, 0.3, 1.2, '#c9873a', { seg: 6 }); b.box(10.4, 0.5, 4.4, 1.2, 1, 0.8, '#26283a'); plant(b, 10.8, 7.6); plant(b, -10.4, -1.4);
    lampPost(b, 0.4, 6, { light: true });
    return {
      spots: [
        landmark('studio', /studio|record|media|story|voice|mic|booth|create/, -3, -1.4, PI),
        landmark('work', /work|staff|office|edit|job|shift|mix/, 3.6, -0.8, PI, { act: { pose: 'work' } }),
        landmark('lounge', /lounge|sofa|rest|wait/, -6.4, 3.2, PI),
        landmark('people', /people|crowd|meet/, 0.6, 5.4, 0),
      ],
      crowd: [[2.4, 4.4, 0.4], [-1.2, 6.4, -0.5], [4.2, 6.2, 2.6], [-3.4, 3.6, 1.2], [6.4, 2.8, -1], [-5.6, 1.4, 1.6], [0.6, 7.6, 2.2], [8.6, 5.2, -0.6], [-4.8, 7.4, 0.2], [2.4, 0.8, PI], [-9, 8, 2.6], [5.8, 7.6, 0.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Stadia and grounds. Each keeps an apron of free ground between the touchline and the stands (the penalty table stands there).

function pitch(b: Batch, w: number, d: number, zc: number, light = '#58a24c', dark = '#4e9944', clay = false): void {
  const stripes = 8;
  for (let i = 0; i < stripes; i++) b.box(-w / 2 + (i + 0.5) * w / stripes, 0.05, zc, w / stripes, 0.06, d, clay ? (i % 2 ? '#b5654a' : '#aa5c42') : (i % 2 ? light : dark));
  const line = '#f4f1e6', y = 0.09;
  b.box(0, y, zc - d / 2, w, 0.03, 0.12, line); b.box(0, y, zc + d / 2, w, 0.03, 0.12, line);
  b.box(-w / 2, y, zc, 0.12, 0.03, d, line); b.box(w / 2, y, zc, 0.12, 0.03, d, line); b.box(0, y, zc, 0.12, 0.03, d, line);
  b.disc(0, y, zc, 1.7, line, { seg: 18 }); b.disc(0, y + 0.01, zc, 1.56, clay ? '#aa5c42' : '#54a048', { seg: 18 });
  for (const s of [-1, 1]) { b.box(s * (w / 2 - 1.6), y, zc, 3.2, 0.03, 0.1, line); b.box(s * (w / 2 - 3.2), y, zc, 0.1, 0.03, 5, line); }
}
function goalFrame(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => { for (const s of [-1, 1]) b.box(0, 1.2, s * 1.8, 0.12, 2.4, 0.12, WHITE); b.box(0, 2.4, 0, 0.12, 0.12, 3.8, WHITE); b.box(-0.5, 1.2, 0, 0.04, 2.4, 3.6, '#d9d6cc', { layer: 'glass' }); });
}
function floodlight(b: Batch, x: number, z: number, h = 9.6): void {
  b.cyl(x, h / 2, z, 0.18, h, METAL, { seg: 6, top: 0.6 }); b.box(x, h + 0.3, z, 1.8, 1, 0.3, '#3d444b'); for (let i = 0; i < 4; i++) b.quad(x - 0.65 + i * 0.43, h + 0.3, z + 0.17, 0.36, 0.36, '#fff3c4', GLOW);
}
function tiers(b: Batch, x: number, z: number, w: number, n: number, dir: 1 | -1 | 2 | -2, c1: Colour, c2: Colour, tread = 0.95, rise = 0.7): void {
  // dir ±1 steps away along z; ±2 along x
  for (let i = 0; i < n; i++) {
    const top = (i + 1) * rise, off = i * tread;
    if (Math.abs(dir) === 1) { b.box(x, top / 2, z + dir * off, w, top, tread, '#c9c4b6'); b.box(x, top + 0.05, z + dir * off, w - 0.4, 0.12, tread * 0.7, i % 2 ? c1 : c2); }
    else { b.box(x + (dir / 2) * off, top / 2, z, tread, top, w, '#c9c4b6'); b.box(x + (dir / 2) * off, top + 0.05, z, tread * 0.7, 0.12, w - 0.4, i % 2 ? c1 : c2); }
  }
}
function crowdDots(b: Batch, rand: () => number, x: number, z: number, w: number, n: number, rowDir: 1 | -1 | 2 | -2, tread: number, rise: number): void {
  for (let i = 0; i < n; i++) for (let k = 0; k < Math.floor(w / 0.9); k++) {
    if (rand() < 0.62) continue;
    const px = Math.abs(rowDir) === 1 ? x - w / 2 + 0.45 + k * 0.9 : x + (rowDir / 2) * i * tread, pz = Math.abs(rowDir) === 1 ? z + rowDir * i * tread : z - w / 2 + 0.45 + k * 0.9;
    b.ball(px, (i + 1) * rise + 0.42, pz, 0.2, 0.3, 0.2, ['#c9423a', '#2f8f55', '#e0a43a', '#2a4fa6', '#f1efe8', '#dd6fa0', '#4a3224'][Math.floor(rand() * 7)]!, { seg: 4 });
  }
}

/** A bowl: stands on all four sides, the front one low and open at the tunnel. */
const bowl: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  camera: { landscape: [17, 25, 31], portrait: [15, 34, 44] },
  walk: { bounds: [-10.4, -7.4, 10.4, 8.4], entrance: [0, 8], open: true },
  build(b, { label }) {
    const rand = seeded(41);
    ground(b, { w: 30, d: 26, color: '#b7b09a', edge: '#7d776a' });
    pitch(b, 17, 10.4, 0.4);
    goalFrame(b, -8.2, 0.4, 0); goalFrame(b, 8.2, 0.4, PI);
    // Terraces on every side; the back one tallest, roofed, with a name band; stands step away from the pitch
    tiers(b, 0, -7, 24, 6, -1, '#2f8f55', '#f1efe8'); crowdDots(b, rand, 0, -7, 24, 6, -1, 0.95, 0.7);
    tiers(b, -10.6, 0.4, 16, 5, -2, '#2f8f55', '#f1efe8'); crowdDots(b, rand, -10.6, 0.4, 16, 5, -2, 0.95, 0.7);
    tiers(b, 10.6, 0.4, 16, 5, 2, '#2f8f55', '#f1efe8'); crowdDots(b, rand, 10.6, 0.4, 16, 5, 2, 0.95, 0.7);
    for (const s of [-1, 1]) { tiers(b, s * 6.6, 9.4, 9, 3, 1, '#f1efe8', '#2f8f55'); crowdDots(b, rand, s * 6.6, 9.4, 9, 3, 1, 0.95, 0.7); }
    for (const [x, z] of ([[-11.4, -7.8], [11.4, -7.8], [-11.8, 8.4], [11.8, 8.4]] as [number, number][])) b.box(x, 1.4, z, 3, 2.8, 3, '#c9c4b6');
    b.box(0, 7.6, -13.6, 25, 0.28, 6.6, '#e7e2d4', { rx: -0.1 }); b.box(0, 6.8, -10.6, 25.4, 1, 0.16, '#2f8f55');
    for (const x of [-11.6, -4, 4, 11.6]) b.box(x, 3.8, -15, 0.35, 7.6, 0.35, METAL);
    labelled(b, label, 0, 6.8, -10.4, 14, 0.5, WHITE, '#1f6f4a', true);
    for (const [x, z] of ([[-13.4, -9.6], [13.4, -9.6], [-13.4, 10.6], [13.4, 10.6]] as [number, number][])) floodlight(b, x, z, 11);
    // The tunnel mouth in the front stand's gap, a scoreboard, bunting boards round the pitch
    b.box(0, 1.2, 10.2, 4, 2.4, 2, '#8f8b7e'); b.box(0, 1, 9.2, 3, 2, 0.1, '#1a1c20');
    b.box(-9.8, 3.4, -7.2, 3.4, 1.8, 0.3, '#1a1c20'); sign(b, -9.8, 3.5, -7.0, '2 1', { size: 0.8, color: '#ffe07a', lit: true });
    for (let i = 0; i < 12; i++) b.box(-9.9 + i * 1.8, 0.5, -5.8, 1.7, 0.7, 0.1, ['#2f8f55', '#f1efe8', '#e0a43a'][i % 3]!);
    const kit = (c: string) => ({ body: 'man', outfit: 'jersey', outfitColor: c, hair: 'lowcut' });
    extra(b, 'bowl-p1', -3, -1, 0.6, 'walk', { look: kit('green') }); extra(b, 'bowl-p2', 1.6, 1.8, -2.4, 'walk', { look: kit('red') }); extra(b, 'bowl-p3', 5, -2.2, 2.4, 'stand', { look: kit('green') });
    extra(b, 'bowl-ref', 0.2, 0, 0.3, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'gold' } });
    b.ball(0.6, 0.2, 0.8, 0.2, 0.2, 0.2, WHITE, { seg: 6 });
    return {
      spots: [
        landmark('stand', /stand|match|watch|view|seat|fan|touchline/, 3.4, 6.2, 0),
        landmark('work', /work|staff|ticket|office|job|shift/, -5.6, 6.6, 0.4, { act: { pose: 'work' } }),
        landmark('pitch', /pitch|train|warm|play/, -4.6, 2.6, HALF),
        landmark('people', /people|crowd|meet/, 6.4, 5.6, 0),
      ],
      crowd: [[-1.4, 5.6, 0.4], [-6, 5.2, -0.5], [6.6, 3.2, 2.4], [-7.4, -3.8, 1.2], [8, 6.6, -0.8], [-8.4, 6.8, 0.8], [2.4, 7.2, 2.8], [-3.2, 4.4, 2.4], [8, -4.4, 1.6], [-0.4, -4.2, -0.4], [5, 0.4, 3.1], [-9.4, 0.4, 0.6]],
      spare: [[-6, 6.6], [6, 6.8], [-3, 7.2], [3.4, 6.2]],
    };
  },
};

/** A stadium with a running track round the pitch, one big arched stand, a smaller side stand and open ground. */
const trackStadium: SceneDef = {
  mood: 'outdoor', accent: '#c9423a',
  camera: { landscape: [17, 25, 31], portrait: [15, 34, 44] },
  walk: { bounds: [-13.4, -9.4, 13.4, 11.4], entrance: [0, 10.6], open: true },
  build(b, { label }) {
    const rand = seeded(43);
    ground(b, { w: 30, d: 26, color: '#9bb07a', edge: '#6a7a50' });
    // Red track: concentric lanes, white lane lines; the grass pitch inside
    b.disc(0, 0.05, 0, 14, '#b5523a', { seg: 28, sx: 1, sz: 0.62 });
    for (let i = 0; i < 4; i++) b.disc(0, 0.06 + i * 0.002, 0, 13.6 - i * 0.9, i % 2 ? '#b5523a' : '#be5a42', { seg: 28, sx: 1, sz: 0.62 });
    b.disc(0, 0.07, 0, 10, '#d4cfc0', { seg: 28, sx: 1, sz: 0.62 }); b.disc(0, 0.08, 0, 9.6, '#4e9944', { seg: 28, sx: 1, sz: 0.62 });
    for (let i = 0; i < 8; i++) b.box(-7.4 + i * 2.1, 0.09, 0, 2.1, 0.02, 7.4, i % 2 ? '#58a24c' : '#4e9944');
    b.box(0, 0.1, 0, 0.12, 0.02, 7.4, '#f4f1e6'); b.disc(0, 0.1, 0, 1.4, '#f4f1e6', { seg: 16 }); b.disc(0, 0.11, 0, 1.28, '#54a048', { seg: 16 });
    goalFrame(b, -7.6, 0, 0); goalFrame(b, 7.6, 0, PI);
    // The main stand: tiers under a roof held by a row of arched trusses; the name on the fascia
    tiers(b, 0, -9.4, 26, 6, -1, '#2f8f55', '#f1efe8'); crowdDots(b, rand, 0, -9.4, 26, 6, -1, 0.95, 0.7);
    for (let i = 0; i < 6; i++) {
      const x = -11.6 + i * 4.64;
      for (const s of [-1, 1]) b.cyl(x + s * 0.3, 4.8, -15.4 + (s > 0 ? 0 : 0), 0.14, 9.6, '#e7e2d4', { seg: 5, rx: 0.25 * s, ry: 0 });
      b.box(x, 9.2, -12.4, 0.3, 0.3, 9.6, '#e7e2d4', { rx: 0.05 });
      b.box(x, 8.4, -9.6, 0.3, 3, 0.3, '#e7e2d4', { rx: 0.5 });
    }
    b.box(0, 9.5, -12.4, 27, 0.22, 10, '#f4f1e6', { rx: 0.05 }); b.box(0, 8.5, -7.4, 27.4, 1, 0.16, '#c9423a');
    labelled(b, label, 0, 8.5, -7.3, 15, 0.5, WHITE, '#9a2f2a', true);
    // A side stand at the left, an open grass bank at the right with trees, a scoreboard tower, floodlights
    tiers(b, -14.6, 0, 14, 4, -2, '#c9423a', '#f1efe8'); crowdDots(b, rand, -14.6, 0, 14, 4, -2, 0.95, 0.7);
    b.box(14.6, 0.8, 0, 3, 1.6, 15, '#7aa05a'); for (const [x, z, s] of ([[14.4, -5, 1.3], [14.6, 1, 1.2], [14.2, 6, 1.3]] as [number, number, number][])) leafTree(b, x, z, { s, tone: 2 });
    b.box(9.6, 4.6, -9, 2.6, 2.2, 0.5, '#1a1c20'); b.box(9.6, 2.2, -9, 0.4, 4.4, 0.4, METAL_DARK); sign(b, 9.6, 4.7, -8.7, '0 0', { size: 0.7, color: '#ffe07a', lit: true });
    for (const [x, z] of ([[-13.4, 11], [13.4, 11]] as [number, number][])) floodlight(b, x, z, 11);
    bench(b, -9, 9.4, { w: 3, back: true, ry: PI }); bench(b, 8, 9.4, { w: 3, back: true, ry: PI });
    for (let i = 0; i < 9; i++) b.box(-10 + i * 2.5, 0.4, 10.6, 2.3, 0.6, 0.1, ['#c9423a', '#f1efe8', '#2f8f55'][i % 3]!);
    const kit = (c: string) => ({ body: 'man', outfit: 'jersey', outfitColor: c, hair: 'lowcut' });
    extra(b, 'trk-p1', -3, -1, 0.6, 'walk', { look: kit('red') }); extra(b, 'trk-p2', 2.6, 1, -2.4, 'walk', { look: kit('green') });
    extra(b, 'trk-runner', 11.4, 3, PI, 'jog', { look: { body: 'woman', outfit: 'jersey', outfitColor: 'orange' } });
    extra(b, 'trk-fan', -4.4, -10.2, 0, 'wave', { y: 1.4 });
    return {
      spots: [
        landmark('stand', /stand|match|watch|view|seat|fan|touchline/, 3.4, 7.8, 0),
        landmark('work', /work|staff|ticket|office|job|shift/, -8, 7.4, 0.4, { act: { pose: 'work' } }),
        landmark('track', /track|run|train|warm|pitch/, 8.8, 4, -HALF),
        landmark('people', /people|crowd|meet/, 5.6, 9.2, 0),
      ],
      crowd: [[-1.4, 8.6, 0.4], [-5.6, 8, -0.5], [6.6, 7.2, 2.4], [-11, 4.4, 1.2], [9, 9.2, -0.8], [-8.4, 9.6, 0.8], [2.4, 10.2, 2.8], [-3.2, 10.4, 2.4], [11.4, 6.2, 1.6], [-0.4, -6.2, -0.4], [12, -2.4, 3.1], [-12, 9.4, 0.6]],
      spare: [[-6, 9.6], [6, 8.6], [-3, 7.4], [3.4, 9.2]],
    };
  },
};

/** A community ground of red earth behind a wire fence, a tin-roofed stand and vendors under umbrellas. */
const groundClay: SceneDef = {
  mood: 'outdoor', accent: '#c96a3a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#b9936a', edge: '#8a6a44' });
    pitch(b, 20, 11, -1, '#b5654a', '#aa5c42', true);
    goalFrame(b, -10, -1, 0); goalFrame(b, 10, -1, PI);
    // A wire fence on posts round the pitch, open at the front for the entrance
    for (let x = -11.4; x <= 11.4; x += 1.9) { b.cyl(x, 1.1, -7.4, 0.06, 2.2, METAL, { seg: 4 }); }
    b.box(0, 1.5, -7.4, 23, 0.04, 0.04, METAL); b.box(0, 0.8, -7.4, 23, 0.04, 0.04, METAL);
    for (const x of [-12, 12]) for (let z = -6.4; z <= 4.6; z += 2.2) b.cyl(x, 1.1, z, 0.06, 2.2, METAL, { seg: 4 });
    // The stand: five rows of concrete steps under a corrugated roof on pipes
    tiers(b, 0, -9.6, 14, 4, -1, '#d9cdaa', '#c96a3a'); const rand = seeded(47); crowdDots(b, rand, 0, -9.6, 14, 4, -1, 0.95, 0.7);
    for (const x of [-7.4, 0, 7.4]) b.cyl(x, 2.6, -8.6, 0.12, 5.2, METAL_DARK, { seg: 5 });
    b.box(0, 5.5, -10.8, 15.6, 0.14, 5.8, '#8f4f35', { rx: -0.12 }); for (let i = 0; i < 14; i++) b.box(-7 + i * 1.07, 5.55, -10.8, 0.06, 0.06, 5.8, '#7a4530', { rx: -0.12 });
    labelled(b, label, 0, 5.2, -8.1, 10, 0.4, WHITE, '#2f4a45', false);
    // Vendors with umbrellas, a drinks cooler, spectators standing along the fence, a goat on the touchline
    for (const [x, z, c] of ([[8.6, 5.6, '#e9614b'], [-9.6, 6.2, '#3f9a5a'], [11.4, 1, '#e0a43a']] as [number, number, string][])) { parasol(b, x, z, { h: 3, r: 1.9, colors: [c, WHITE] }); table(b, x, z + 0.8, { w: 1.6, d: 0.9, h: 0.9, color: '#7a5c3c' }); }
    b.box(-11.4, 0.4, 3.4, 1.4, 0.8, 0.8, '#3f6a8a'); b.box(-11.4, 0.85, 3.4, 1.5, 0.1, 0.9, WHITE);
    b.ball(4, 0.5, 8.8, 0.3, 0.3, 0.55, '#e9e2cf', { seg: 5 }); b.box(4.3, 0.9, 9.2, 0.14, 0.4, 0.14, '#e9e2cf', { rx: 0.4 });
    palm(b, -13.2, 9.6, { s: 1.1 }); leafTree(b, 13.4, 10, { s: 1.1, tone: 0 }); leafTree(b, -13.6, -3.4, { s: 1.2, tone: 2 });
    extra(b, 'clay-p1', -3, -1, 0.6, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'red' } }); extra(b, 'clay-p2', 2, 0.4, -2.4, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'blue' } });
    extra(b, 'clay-fan', -4, -10.2, 0, 'wave', { y: 1.4 }); extra(b, 'clay-vendor', 8.6, 6.6, PI, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange' } });
    b.ball(0.6, 0.2, 0.4, 0.2, 0.2, 0.2, WHITE, { seg: 6 });
    lampPost(b, -6, 8.4, { light: true }); lampPost(b, 6, 8.4);
    return {
      spots: [
        landmark('stand', /stand|match|watch|view|seat|fan|touchline/, 2.4, 6.6, 0),
        landmark('work', /work|staff|ticket|office|job|shift/, -6.6, 8.2, 0.4, { act: { pose: 'work' } }),
        landmark('pitch', /pitch|train|warm|play/, -5.6, 2.4, HALF),
        landmark('people', /people|crowd|meet/, 4.6, 8.8, 0),
      ],
      crowd: [[-1.4, 8.4, 0.4], [-4.6, 9.6, -0.5], [6.6, 3.4, 2.4], [-7.4, 3.8, 1.2], [8, 8, -0.8], [-12, 8.4, 0.8], [2.4, 10.2, 2.8], [-3.2, 10.8, 2.4], [11.6, 6.6, 1.6], [-0.4, 3.8, -0.4], [5, 5.4, 3.1], [-9.4, 0.4, 0.6]],
      spare: [[-6, 9.6], [6, 9.8], [-3, 10.4], [3.4, 9.2]],
    };
  },
};

/** A ground with two concrete terraces, a club house with flags and a scoreboard. */
const groundTerrace: SceneDef = {
  mood: 'outdoor', accent: '#7a2f5a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#9eb08a', edge: '#6a7a58' });
    pitch(b, 20, 11, 0.4);
    goalFrame(b, -10, 0.4, 0); goalFrame(b, 10, 0.4, PI);
    const rand = seeded(53);
    tiers(b, -13.4, 0.4, 14, 4, -2, '#7a2f5a', '#f1efe8'); crowdDots(b, rand, -13.4, 0.4, 14, 4, -2, 0.95, 0.7);
    tiers(b, 13.4, 0.4, 14, 4, 2, '#7a2f5a', '#f1efe8'); crowdDots(b, rand, 13.4, 0.4, 14, 4, 2, 0.95, 0.7);
    // The club house across the back: two storeys, a balcony, flags on the roof, the name over the door
    b.box(0, 2.6, -10.8, 14, 5.2, 4.6, '#efe3c8'); b.box(0, 5.35, -10.8, 14.6, 0.3, 5.2, '#7a2f5a');
    for (let i = 0; i < 5; i++) { b.quad(-5.6 + i * 2.8, 3.4, -8.48, 1.5, 1.4, '#7fa4b8'); b.box(-5.6 + i * 2.8, 1.2, -8.46, 1.4, 2.2, 0.08, '#4a3a2c'); }
    b.box(0, 2.5, -7.9, 14.4, 0.2, 1.2, '#cdc2a6'); for (let i = 0; i <= 14; i++) b.box(-7 + i, 3.1, -7.4, 0.08, 1, 0.08, '#cdc2a6'); b.box(0, 3.65, -7.4, 14, 0.08, 0.1, '#cdc2a6');
    for (let i = 0; i < 4; i++) flag(b, -5.4 + i * 3.6, -10.8, { h: 3.4, w: 1.4, colors: i % 2 ? ['#7a2f5a', WHITE, '#7a2f5a'] : ['#2f8f55', WHITE, '#2f8f55'] });
    labelled(b, label, 0, 4.8, -8.4, 10, 0.4, WHITE, '#7a2f5a', true);
    b.box(-8.4, 4.2, -7, 3.4, 1.8, 0.3, '#1a1c20'); sign(b, -8.4, 4.3, -6.8, '1 1', { size: 0.8, color: '#ffe07a', lit: true });
    b.box(-8.4, 1.8, -7, 0.3, 3.6, 0.3, METAL_DARK);
    floodlight(b, -15, 9, 10.4); floodlight(b, 15, 9, 10.4);
    for (let i = 0; i < 10; i++) b.box(-9 + i * 2, 0.5, 6.4, 1.9, 0.7, 0.1, ['#7a2f5a', '#f1efe8', '#e0a43a'][i % 3]!);
    kiosk(b, 10.6, 9.4, { ry: -HALF, w: 3, color: '#c69a4e', roof: '#7a2f5a' });
    extra(b, 'ter-p1', -3, 0, 0.6, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'violet' } }); extra(b, 'ter-p2', 2, 1.4, -2.4, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'green' } });
    extra(b, 'ter-ref', 0.2, 0.4, 0.3, 'walk', { look: { body: 'man', outfit: 'jersey', outfitColor: 'gold' } }); extra(b, 'ter-fan', -13, -3.6, HALF, 'wave', { y: 1.2 });
    b.ball(0.6, 0.2, 1, 0.2, 0.2, 0.2, WHITE, { seg: 6 });
    leafTree(b, -3, 11.4, { s: 1, tone: 1 }); leafTree(b, 5, 11.6, { s: 1, tone: 2 });
    return {
      spots: [
        landmark('stand', /stand|match|watch|view|seat|fan|touchline/, 2.4, 7.8, 0),
        landmark('work', /work|staff|ticket|office|job|shift/, -6.6, 8.4, 0.4, { act: { pose: 'work' } }),
        landmark('pitch', /pitch|train|warm|play/, -5.6, 3, HALF),
        landmark('people', /people|crowd|meet/, 4.6, 9, 0),
      ],
      crowd: [[-1.4, 9, 0.4], [-4.6, 9.6, -0.5], [6.6, 4.4, 2.4], [-7.4, 4.8, 1.2], [8, 9, -0.8], [-12, 8.4, 0.8], [2.4, 10.6, 2.8], [-3.2, 10.8, 2.4], [11, 7.6, 1.6], [-0.4, 5.4, -0.4], [5, 6.4, 3.1], [-9.4, 7.4, 0.6]],
      spare: [[-6, 9.6], [6, 9.8], [-3, 10.4], [3.4, 9.2]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Walks

/** A factory gate: a barrier and a gatehouse, a sawtooth factory, a warehouse with roller doors and trucks. */
const factory: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#9a9d98', edge: '#6a6d68' });
    b.box(0, 0.05, 6.4, 30, 0.04, 8, '#6b6f73'); for (let i = -6; i <= 6; i++) b.box(i * 2.2, 0.08, 6.4, 1, 0.02, 0.14, '#e6dfc8');
    b.box(0, 0.06, 0, 4, 0.04, 10, '#e0c24a');
    // The factory: long block with sawtooth roofs and a tall stack; the warehouse beside it with three roller doors
    b.box(-6.4, 2.6, -9.6, 14, 5.2, 6, '#c9cdd0');
    for (let i = 0; i < 4; i++) { const x = -11.6 + i * 3.5; b.box(x, 5.8, -9.6, 3.5, 0.14, 6.2, '#8a8f96', { rz: -0.42 }); b.box(x + 1.7, 5.9, -9.6, 0.1, 1.6, 6.2, '#b5b9bd'); b.box(x + 1.1, 5.6, -6.55, 1.2, 1, 0.06, '#8fc4d8', GLASS); }
    for (let i = 0; i < 5; i++) b.box(-11.2 + i * 2.2, 1.4, -6.58, 1.6, 2.6, 0.06, '#7a8a92');
    b.cyl(-13.4, 5.5, -12.4, 0.8, 11, '#a8a090', { seg: 8, top: 0.7 }); b.cyl(-13.4, 11.2, -12.4, 0.9, 0.3, '#7a7468', { seg: 8 });
    b.box(8, 2.5, -9.2, 11, 5, 6.6, '#d9d4c4'); b.box(8, 5.15, -9.2, 11.4, 0.3, 7, '#8a8f96');
    for (let i = 0; i < 3; i++) { b.box(4.8 + i * 3.2, 1.6, -5.84, 2.6, 3.2, 0.08, ['#c9423a', '#3f72c4', '#2f8f55'][i]!); for (let k = 0; k < 6; k++) b.box(4.8 + i * 3.2, 0.5 + k * 0.5, -5.8, 2.6, 0.04, 0.06, '#1a1a1a'); }
    labelled(b, label, 8, 5.9, -5.7, 10, 0.5, WHITE, '#2f3b46', true);
    // The gate: two posts, a sliding gate, a barrier arm across the road and a gatehouse with a roof
    for (const x of [-3.4, 3.4]) { b.box(x, 1.4, 3.2, 0.9, 2.8, 0.9, '#cfc9b6'); }
    b.box(0, 1.2, 3.2, 5.6, 1.6, 0.1, '#3a4440', { layer: 'solid' }); for (let i = 0; i < 12; i++) b.box(-2.5 + i * 0.46, 1.2, 3.25, 0.06, 1.6, 0.04, '#5a645e');
    b.box(-5, 1.3, 2.6, 2.4, 2.6, 2.2, '#e0dac6'); b.box(-5, 2.75, 2.6, 3, 0.2, 2.8, '#8f4f35'); b.box(-3.8, 1.8, 2.6, 0.06, 1, 1.6, '#4f6a7a');
    b.box(4.8, 0.9, 5.6, 0.14, 1.8, 0.14, METAL_DARK); b.box(1.6, 1.4, 5.6, 6.4, 0.12, 0.12, '#c9423a'); for (let i = 0; i < 4; i++) b.box(-1 + i * 0.9, 1.4, 5.66, 0.4, 0.14, 0.02, WHITE);
    // Trucks queueing on the road and in the yard, pallets and a stack of drums, a forklift
    truck(b, -9, 7, HALF, '#2f6f8f', '#d9d4c4'); truck(b, 3, 8.6, -HALF, '#c9423a', '#a8b4c0'); truck(b, 11, -1, 0.1, '#e0a43a', '#c9a56a'); truck(b, -1, -3.6, PI, '#3f9a5a', '#d9d4c4');
    for (let i = 0; i < 6; i++) crate(b, -12 + (i % 3) * 1.1, Math.floor(i / 3) * 0.6, -2.4, { s: 1, color: '#b08a5c' });
    for (let i = 0; i < 5; i++) b.cyl(13 + (i % 2) * 0.9, 0.5, -3.6 + Math.floor(i / 2) * 0.9, 0.4, 1, ['#2f6f8f', '#c9423a'][i % 2]!, { seg: 7 });
    b.at(-8, 0, -0.6, 0.6, () => { b.box(0, 0.9, 0, 1.1, 1.4, 1.6, '#e0a43a'); b.box(0, 1.9, -0.2, 1.1, 0.1, 1.2, '#2a2d33'); b.box(0, 1.2, 1.2, 0.2, 2, 0.1, '#5a5a5e'); b.box(0, 0.5, 1.4, 0.9, 0.1, 0.9, '#5a5a5e'); for (const s of [-1, 1]) b.cyl(s * 0.55, 0.35, 0.5, 0.35, 0.2, BLACK, { seg: 7, rz: HALF }); });
    fence(b, [-14, 3.2], [-4, 3.2], { h: 1.6, color: '#3a4440', gap: 1.2 }); fence(b, [4, 3.2], [14, 3.2], { h: 1.6, color: '#3a4440', gap: 1.2 });
    lampPost(b, 5.6, 1, { light: true }); lampPost(b, -6.4, 0.6);
    extra(b, 'fac-guard', -3.6, 3.6, PI, 'work', { look: { body: 'man', outfit: 'office', outfitColor: 'navy' } });
    extra(b, 'fac-worker-1', -7, -2.2, 0.4, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'orange' } }); extra(b, 'fac-worker-2', 6, -3.2, 2.6, 'wave', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange' } });
    extra(b, 'fac-driver', 0, 4.4, 1.2, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'green' } });
    return {
      spots: [
        landmark('route', /route|walk|industry|path|gate|tour/, 0, 0.6, PI),
        landmark('work', /work|staff|office|guard|job|shift/, -1.6, 3.8, 0.4, { act: { pose: 'work' } }),
        landmark('yard', /yard|truck|load|ware/, 8.6, 1.4, PI),
        landmark('people', /people|crowd|meet/, 2.6, 6.2, 0),
      ],
      crowd: [[-1.4, 5.6, 0.4], [-5.2, 4.6, -0.5], [6.6, 3.4, 2.4], [-10.4, 2.8, 1.2], [8, 3.6, -0.8], [-12.4, -0.4, 0.8], [10.4, 3.2, 2.8], [-3.2, -1.6, 2.4], [12, 1.6, 1.6], [3.4, -1.6, -0.4], [5, 2.4, 3.1], [-7.4, 0.8, 0.6]],
      spare: [[-6, 2], [6, 1.6], [-3, 5.2], [3.4, 4.4]],
    };
  },
};

/** A storeyed house with a veranda and a balcony in a walled garden, with waymarks and a plaque on a path. */
const heritageHouse: SceneDef = {
  mood: 'outdoor', accent: '#a8653f',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#78a85c', edge: '#4f7a46' });
    b.box(0, 0.05, 3, 3, 0.05, 20, '#d4c4a0'); b.box(-4, 0.05, 1, 20, 0.05, 2.2, '#d4c4a0');
    // The house: two storeys, cream walls with a green trim, a hip roof of iron, a veranda below and a balcony above
    b.box(0, 3.3, -8.6, 11, 6, 6, '#efe3c8'); b.box(0, 6.4, -8.6, 11.6, 0.3, 6.6, '#7a4530');
    for (const s of [-1, 1]) b.box(0, 7.3, -8.6 + s * 1.5, 11.8, 0.16, 3.6, s < 0 ? '#a8653f' : '#9b5a3a', { rx: -s * 0.36 });
    b.box(0, 8.25, -8.6, 11.8, 0.18, 0.3, '#7a4530');
    for (let i = 0; i < 4; i++) { const x = -4.2 + i * 2.8; windowPane(b, x, 4.6, -5.56, { w: 1.2, h: 1.8, glass: '#7f9fb4', frame: '#4f7f5c' }); b.box(x, 1.6, -5.58, 1.3, 2.6, 0.08, '#4a3626'); }
    for (let i = 0; i <= 4; i++) { b.cyl(-5.6 + i * 2.8, 1.6, -4.4, 0.18, 3.2, WHITE, { seg: 8 }); }
    b.box(0, 3.3, -4.4, 12, 0.3, 2.4, '#d8cdb0');
    for (let i = 0; i <= 12; i++) b.box(-5.6 + i * 0.93, 3.9, -3.5, 0.08, 0.9, 0.08, WHITE); b.box(0, 4.35, -3.5, 11.2, 0.08, 0.1, WHITE);
    for (let i = 0; i < 3; i++) b.box(0, 0.12 + i * 0.1, -3 + (2 - i) * 0.4, 3.2, 0.2 + i * 0.1, 0.5, '#d8cfb4');
    // A low garden wall with a gate, flower beds, a mango tree and a bench under it
    for (const s of [-1, 1]) b.box(s * 8, 0.55, 11.8, 12, 1.1, 0.4, '#e8dcc2'); for (const x of [-2, 2]) { b.box(x, 1.2, 11.8, 0.8, 2.4, 0.8, '#e8dcc2'); b.ball(x, 2.7, 11.8, 0.3, 0.3, 0.3, '#a8653f', { seg: 6 }); }
    tallTree(b, -10, -2, { h: 6, s: 1.3, tone: 1 }); b.ico(-10, 7.4, -2, 3.4, 2.4, 3.4, '#3d7a4a'); b.ico(-8.6, 6.8, -1, 2.4, 1.8, 2.4, '#4f8a45');
    bench(b, -9, 0.4, { w: 2.8, back: true, ry: HALF, color: '#8a6644' }); extra(b, 'her-sitter', -9, 0.4, HALF, 'sit', { seat: 0.6 });
    for (const [x, z] of ([[-6, -2.6], [6, -2.6], [8.4, 4], [-8.6, 6.4]] as [number, number][])) { b.box(x, 0.18, z, 2.6, 0.36, 1.2, '#7a5a3c'); for (let i = 0; i < 5; i++) b.ico(x - 1 + i * 0.5, 0.5, z, 0.24, 0.2, 0.24, ['#e9614b', '#e8c43a', '#dd6fa0', '#f1efe8', '#8055c2'][i]!); }
    // Waymarks along the route, each a post with a small coloured disc, and the plaque with the venue's own name
    for (let i = 0; i < 4; i++) { b.cyl(2.6, 0.7, 4.2 + i * 2.4, 0.07, 1.4, WOOD_DARK, { seg: 4 }); b.cyl(2.6, 1.5, 4.2 + i * 2.4, 0.3, 0.06, ['#c9423a', '#2f8f55', '#e0a43a', '#2a4fa6'][i]!, { seg: 8, rx: HALF }); }
    b.box(5.6, 0.6, -1.8, 3.6, 1.2, 0.5, '#8d887a'); sign(b, 5.6, 0.62, -1.52, plain(label), { size: fit(plain(label), 3.2, 0.28), color: '#f1e6c4', board: '#2f3b36', pad: 0.12, depth: 0.04 });
    flag(b, 6.6, -3.6, { h: 6 });
    extra(b, 'her-guide', 4, -1.2, PI, 'stand', { look: { body: 'woman', outfit: 'kaftan', outfitColor: 'teal', fabric: 'adire' } }); extra(b, 'her-visitor', -4.4, 2.8, 0.6, 'walk'); extra(b, 'her-visitor-2', 7, 6.2, 2.4, 'wave');
    for (const [x, z, s, t] of ([[-13, 8, 1.2, 0], [13, 6, 1.2, 2], [13, -3, 1.1, 1]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    lampPost(b, -1.9, 6, { light: true }); lampPost(b, 1.9, 6);
    return {
      spots: [
        landmark('route', /route|walk|heritage|path|waymark|tour|history/, -1.6, 2.2, PI),
        landmark('work', /work|staff|office|guide|job|shift/, 3.6, 0.4, PI, { act: { pose: 'work' } }),
        landmark('plaque', /plaque|house|read|story/, 5.6, 1, PI),
        landmark('people', /people|crowd|meet/, 0.6, 8, 0),
      ],
      crowd: [[2.4, 6.4, 0.4], [-2.4, 8.2, -0.5], [7.6, 8.2, 2.4], [-6, 5.6, 1.2], [8.6, 9.8, -0.8], [-8.4, 9.4, 0.8], [4, 10.4, 2.8], [-5.2, 10.2, 2.4], [-12, 5, 1.6], [11, 2, -0.4], [0.2, 9.8, 3.1], [-5, 1.4, 0.6]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

/** A gallery court: a pavilion of arches round a court with artefacts on plinths, drums and a banner of cloth. */
const heritageGallery: SceneDef = {
  mood: 'outdoor', accent: '#c9873a',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#c9c0a8', edge: '#8f8770' });
    for (let x = -13; x <= 13; x += 2) for (let z = -4; z <= 12; z += 2) if ((x + z) % 4 === 0) b.box(x, 0.05, z, 2, 0.02, 2, '#bfb59a');
    // The pavilion at the back: a long arcade of five arches under a flat roof with a name band, cases behind
    b.box(0, 2.8, -10.4, 20, 5.6, 4.4, '#efe3c8'); b.box(0, 5.75, -10.4, 20.6, 0.3, 5, '#a8653f');
    for (let i = 0; i < 5; i++) { const x = -8 + i * 4; b.box(x, 1.7, -8.16, 2.6, 3, 0.1, '#43362b'); b.cyl(x, 3.2, -8.16, 1.3, 0.1, '#43362b', { seg: 12, rx: HALF }); b.box(x, 1.7, -8.1, 3.4, 3.4, 0.04, '#9fc4d8', GLASS); for (const s of [-1, 1]) b.cyl(x + s * 2, 1.6, -7.2, 0.2, 3.2, WHITE, { seg: 8 }); }
    b.cyl(-10, 1.6, -7.2, 0.2, 3.2, WHITE, { seg: 8 }); b.box(0, 3.4, -7.2, 21, 0.3, 1.4, '#e0d4b8');
    labelled(b, label, 0, 4.6, -7.4, 12, 0.46, '#f4e6b8', '#3a2c20', false);
    // Plinths with artefacts: a carved stool, a pair of drums, a stone head, a pot; and a banner of woven cloth
    const plinth = (x: number, z: number, h = 1) => { b.box(x, h / 2, z, 1.6, h, 1.6, '#a8a08a'); b.box(x, h + 0.05, z, 1.8, 0.1, 1.8, '#c9c1ac'); };
    plinth(-6, -2); b.cyl(-6, 1.35, -2, 0.5, 0.2, '#6a3f27', { seg: 8 }); b.cyl(-6, 1.65, -2, 0.12, 0.5, '#6a3f27', { seg: 6 }); b.cyl(-6, 2, -2, 0.55, 0.12, '#6a3f27', { seg: 8 });
    plinth(-2, -3); drum(b, -2.2, -3, '#6a3f27'); b.ball(-1.7, 1.5, -3, 0.3, 0.4, 0.3, '#3a2a1c', { seg: 6 });
    plinth(2.4, -2.4, 1.3); b.ball(2.4, 1.85, -2.4, 0.4, 0.5, 0.4, '#6f6a60', { seg: 7 });
    plinth(6.4, -3); b.cyl(6.4, 1.5, -3, 0.4, 0.6, '#a0683c', { seg: 8, top: 1.3 }); b.cyl(6.4, 1.9, -3, 0.5, 0.1, '#a0683c', { seg: 8 });
    for (const x of [10, 13]) b.cyl(x, 2.6, 0.4, 0.07, 5.2, WOOD_DARK, { seg: 5 }); b.box(11.5, 4.9, 0.4, 3.2, 0.07, 0.07, WOOD_DARK);
    for (let i = 0; i < 5; i++) b.box(10.3 + i * 0.6, 3.6, 0.45, 0.54, 2.6, 0.05, ['#c9423a', '#2a4fa6', '#d6a83a', '#2f8f55', '#8055c2'][i]!);
    for (let i = 0; i < 4; i++) { b.box(-12.4 + i * 0.5, 0.4, 3 - i * 0.2, 0.34, 0.8, 0.34, '#6a3f27'); }
    bench(b, -9.4, 4.4, { w: 2.8, back: true, ry: HALF, color: '#8a6644' }); bench(b, 5.4, 6.2, { w: 2.8, back: true, ry: PI, color: '#8a6644' }); extra(b, 'gal-sitter', 5.4, 6.2, PI, 'sit', { seat: 0.6 });
    extra(b, 'gal-curator', 2.4, -0.6, PI, 'stand', { look: { body: 'woman', outfit: 'office', outfitColor: 'teal' } }); extra(b, 'gal-visitor', -4, 1.4, 1.4, 'stand', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream' } });
    palm(b, -13.4, 9.6, { s: 1.1 }); palm(b, 13.4, 9.6, { s: 1.1 }); leafTree(b, 13.6, -3, { s: 1.1, tone: 1 }); lampPost(b, -3, 6, { light: true }); lampPost(b, 3, 6);
    return {
      spots: [
        landmark('gallery', /gallery|heritage|tour|museum|display|artef|history|learn/, -2, 1.4, PI),
        landmark('work', /work|staff|office|curat|job|shift/, 4.4, 1, PI, { act: { pose: 'work' } }),
        landmark('banner', /banner|cloth|fabric/, 10.6, 2.6, PI),
        landmark('people', /people|crowd|meet/, 0.6, 7.8, 0),
      ],
      crowd: [[2.4, 5.4, 0.4], [-2.4, 7.8, -0.5], [7.6, 7.2, 2.4], [-6, 5.6, 1.2], [8.6, 9.8, -0.8], [-8.4, 9.4, 0.8], [4, 10.4, 2.8], [-5.2, 10.2, 2.4], [-12, 6, 1.6], [11, 4.4, -0.4], [0.2, 9.8, 3.1], [-9, 1.4, 0.6]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Council halls

interface HallStyle { wall: Colour; trim: Colour; roof: Colour; dome: boolean; accent: Colour }
function councilHall(b: Batch, label: string, s: HallStyle, seed: number): { spots: ReturnType<typeof landmark>[] } {
  ground(b, { w: 30, d: 26, color: '#78a85c', edge: '#4f7a46' });
  b.box(0, 0.05, 3, 5, 0.05, 20, '#d4c4a0'); b.box(0, 0.05, 1.4, 26, 0.05, 2.4, '#d4c4a0');
  // The hall: a broad block, a pitched or domed roof, a porch with two pillars, three tall windows and a notice board
  b.box(0, 2.8, -9, 15, 5.6, 7, s.wall); b.box(0, 5.7, -9, 15.5, 0.3, 7.5, s.trim);
  if (s.dome) { b.cyl(0, 6.4, -9, 3.4, 1.4, s.wall, { seg: 14 }); b.ball(0, 7.2, -9, 3.5, 2.4, 3.5, s.roof, { seg: 14 }); b.cyl(0, 9.6, -9, 0.06, 1.2, '#d6a83a', { seg: 4 }); b.ball(0, 10.3, -9, 0.2, 0.2, 0.2, '#d6a83a', { seg: 5 }); for (const x of [-6.4, 6.4]) b.cone(x, 6.7, -9, 1.6, 1.8, s.roof, { seg: 6 }); }
  else { for (const side of [-1, 1]) b.box(0, 6.8, -9 + side * 1.9, 16, 0.16, 4.4, s.roof, { rx: -side * 0.4 }); b.box(0, 7.9, -9, 16, 0.2, 0.3, s.trim); }
  b.box(0, 1.6, -5.46, 2.6, 3.2, 0.1, '#4a3626'); b.box(0, 3.5, -4.4, 5.4, 0.3, 2.4, s.trim);
  for (const x of [-2.4, 2.4]) b.cyl(x, 1.7, -3.4, 0.3, 3.4, WHITE, { seg: 8 });
  for (const x of [-6, -3.6, 3.6, 6]) windowPane(b, x, 2.8, -5.46, { w: 1.2, h: 2.2, glass: '#8fb0c4', frame: s.trim });
  for (let i = 0; i < 3; i++) b.box(0, 0.1 + i * 0.1, -2.4 + (2 - i) * 0.4, 5.6, 0.2 + i * 0.1, 0.5, '#d8cfb4');
  b.box(-10.6, 1.7, -3.6, 3.4, 1.8, 0.14, '#6b4a2f'); b.quad(-10.6, 1.75, -3.52, 3.1, 1.5, '#efe6cf');
  for (let i = 0; i < 3; i++) b.quad(-11.6 + i * 1, 2.05, -3.5, 0.7, 0.5, ['#d6a83a', '#9fd0e6', '#e0a09a'][i]!);
  for (const sd of [-1, 1]) b.cyl(-10.6 + sd * 1.5, 0.6, -3.5, 0.06, 1.2, WOOD_DARK, { seg: 4 });
  labelled(b, label, 0, 4.7, -5.4, 9.2, 0.4, '#f4e6b8', s.accent, false);
  flag(b, -5.6, -1.4, { h: 6.4 }); flag(b, 5.6, -1.4, { h: 6.4, colors: [s.accent, '#d6a83a', s.accent] });
  // Seats set out in rows on the forecourt for a meeting, a speaker's table, benches, trees
  table(b, 0, 2.8, { w: 3.2, d: 1, h: 0.95, color: '#6b4a2f' });
  for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) chair(b, -4.2 + i * 1.7, 5.4 + r * 1.3, { color: s.accent, ry: PI });
  for (let i = 0; i < 3; i++) extra(b, `hall${seed}-seated-${i}`, -2.5 + i * 3.4, 5.4, PI, 'sit', { seat: 0.6 });
  extra(b, `hall${seed}-speaker`, 0, 1.8, 0, 'wave', { look: { body: 'man', outfit: 'agbada', outfitColor: 'cream', accessories: ['fila'] } });
  extra(b, `hall${seed}-clerk`, 3.6, -1.6, PI, 'work', { look: { body: 'woman', outfit: 'office', outfitColor: 'teal' } });
  for (const [x, z, sc, t] of ([[-13, 3, 1.2, 0], [13, 4, 1.1, 2], [-12.6, 10.6, 1, 1], [12.6, 10.4, 1.1, 0]] as [number, number, number, number][])) leafTree(b, x, z, { s: sc, tone: t });
  for (const x of [-9, 9]) bush(b, x, -2.8, { s: 0.7, color: LEAF_DARK });
  lampPost(b, -2.8, 2.4, { light: true }); lampPost(b, 2.8, 8.6);
  return {
    spots: [
      landmark('hall', /hall|meeting|story|history|civic|learn|town|council|read/, -5.6, 3, PI),
      landmark('work', /work|staff|office|clerk|admin|job|shift/, 2.6, -0.6, PI, { act: { pose: 'work' } }),
      landmark('board', /board|notice|info/, -9.4, -1.4, PI),
      landmark('people', /people|crowd|meet/, 0.6, 8.6, 0),
    ],
  };
}
const crowdAfterSeats: [number, number, number][] = [[2.4, 9.4, 0.4], [-2.4, 8.8, -0.5], [7.6, 6.6, 2.4], [-7.6, 7.6, 1.2], [9.6, 9.8, -0.8], [-8.4, 9.8, 0.8], [4, 10.6, 2.8], [-5.2, 10.4, 2.4], [-12, 6, 1.6], [11, 2.4, -0.4], [0.2, 10.6, 3.1], [-9, 3, 0.6]];
const hallBrick: SceneDef = {
  mood: 'outdoor', accent: '#a8473a', walk: OPEN,
  build(b, { label }) {
    const { spots } = councilHall(b, label, { wall: '#b5573f', trim: '#e0d6bd', roof: '#6f6f6a', dome: false, accent: '#7a2f2a' }, 1);
    // A clock turret on the roof ridge
    b.box(0, 9.2, -9, 2, 3.2, 2, '#b5573f'); b.box(0, 11, -9, 2.4, 0.3, 2.4, '#e0d6bd'); b.cone(0, 12, -9, 1.7, 1.8, '#6f6f6a', { seg: 4, ry: PI / 4 });
    b.cyl(0, 9.4, -7.96, 0.7, 0.08, WHITE, { seg: 14, rx: HALF }); b.cyl(0, 9.4, -7.92, 0.6, 0.04, '#fff3c4', { seg: 14, rx: HALF, layer: 'glow' }); b.box(0, 9.6, -7.9, 0.07, 0.4, 0.03, '#2f2a24'); b.box(0.16, 9.4, -7.9, 0.34, 0.07, 0.03, '#2f2a24');
    return { spots, crowd: crowdAfterSeats, spare: FRONT_SPARE };
  },
};
const hallDome: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55', walk: OPEN,
  build(b, { label }) {
    const { spots } = councilHall(b, label, { wall: '#efe3c8', trim: '#cdc2a6', roof: '#2f8f6a', dome: true, accent: '#1f6f4a' }, 2);
    drum(b, 7.6, 2.8); drum(b, 8.4, 3.2, '#7a4a30');
    return { spots, crowd: crowdAfterSeats, spare: FRONT_SPARE };
  },
};

// ---------------------------------------------------------------------------------------------
// Parks

/** A shaded square: great trees over benches, an ayo board on a stone table, a drinks kiosk, children's swings. */
const ayoPark: SceneDef = {
  mood: 'outdoor', accent: '#6aa056',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#6aa056', edge: '#46703a' });
    b.disc(0, 0.05, 1, 9.4, '#d8cfb4', { seg: 22 }); b.disc(0, 0.06, 1, 8.8, '#e6dfc8', { seg: 22 });
    b.box(0, 0.05, 8, 3, 0.04, 8, '#d8cfb4');
    // Four big shade trees with wide crowns, benches underneath
    for (const [x, z, s] of ([[-9, -4, 1.4], [9.4, -5, 1.5], [-11, 5, 1.2], [11.2, 2, 1.2]] as [number, number, number][])) {
      b.cyl(x, 2.4 * s, z, 0.5 * s, 4.8 * s, '#6b5440', { top: 0.7, seg: 6 }); for (const [dx, dy, dz, r, c] of ([[0, 5.4, 0, 3.2, '#3d7a4a'], [-2.4, 4.8, 0.8, 2.4, '#4f8a45'], [2.4, 5, -0.6, 2.6, '#2f6a44'], [0.6, 6.4, 0.4, 2, '#5b9a55']] as [number, number, number, number, Colour][])) b.ico(x + dx * s * 0.8, dy * s * 0.9, z + dz, r * s * 0.9, r * s * 0.6, r * s * 0.9, c);
    }
    bench(b, -7.4, -2, { w: 2.8, back: true, ry: HALF }); bench(b, 7.8, -3, { w: 2.8, back: true, ry: -HALF }); bench(b, -8, 4.4, { w: 2.8, back: true, ry: HALF }); bench(b, 8, 3.6, { w: 2.8, back: true, ry: -HALF });
    // The ayo table: a stone slab on two blocks with a carved board of twelve pits and seeds
    b.box(0, 0.5, -1.4, 0.7, 1, 1.4, '#a8a396'); b.box(0, 0.5, -3.8, 0.7, 1, 1.4, '#a8a396'); b.box(0, 1.1, -2.6, 1.4, 0.2, 4.2, '#bdb7a6');
    b.box(0, 1.28, -2.6, 0.9, 0.16, 3.2, '#8a5a36'); for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { b.disc(s * 0.22, 1.37, -3.7 + i * 0.28, 0.1, '#3d2a1c', { seg: 6 }); b.ball(s * 0.22, 1.4, -3.7 + i * 0.28, 0.05, 0.04, 0.05, '#d6a83a', { seg: 4 }); }
    for (const [x, z, c] of ([[-1.6, -2.6, 'orange'], [1.6, -2.6, 'green']] as [number, number, string][])) { stool(b, x, z, { h: 0.5 }); extra(b, `ayo-elder-${c}`, x, z, x < 0 ? HALF : -HALF, 'sit', { seat: 0.5, look: { body: 'man', outfit: 'kaftan', outfitColor: c, accessories: ['fila'] } }); }
    // Swings and a seesaw at the right, a drinks kiosk at the left
    for (const x of [-1, 1]) { b.box(11.4 + x * 0.9, 1.1, -0.4, 0.1, 2.2, 0.1, METAL_DARK, { rz: x * 0.1 }); } b.box(11.4, 2.2, -0.4, 2, 0.1, 0.1, METAL_DARK); for (const x of [-0.4, 0.4]) { b.box(11.4 + x, 1.1, -0.4, 0.04, 2, 0.04, '#6a6e72'); } b.box(11.4, 0.55, -0.4, 0.9, 0.08, 0.4, '#e0a43a');
    b.box(11.4, 0.4, -4.4, 3.2, 0.1, 0.4, '#c9423a', { rz: 0.1 }); b.box(11.4, 0.2, -4.4, 0.3, 0.4, 0.6, METAL_DARK);
    kiosk(b, -11.6, 9.4, { ry: HALF, w: 2.8, color: '#c9423a', roof: WHITE, fascia: '#ffe07a' });
    signBoard(b, 4, 9.6, plain(label), { y: 1.6, size: fit(plain(label), 5.4, 0.32), color: '#f1e6c4', board: '#2f4a45' });
    for (let i = 0; i < 5; i++) bush(b, -12 + i * 6, -10.6, { s: 0.9, color: i % 2 ? '#c0407e' : LEAF });
    lampPost(b, -4, 4.4, { light: true }); lampPost(b, 4, 4.4); lampPost(b, 0, 8.6);
    extra(b, 'ayo-kid-1', 11.4, 1, 3, 'wave', { look: { body: 'woman', outfit: 'casual', outfitColor: 'pink' } }); extra(b, 'ayo-sitter-1', -7.4, -2, HALF, 'sit', { seat: 0.6 }); extra(b, 'ayo-walker', 3.4, 3, 2.4, 'walk');
    return {
      spots: [
        landmark('trees', /tree|shade|ayo|play|game|round|rest|sit/, 0, 0.2, PI),
        landmark('work', /work|staff|office|job|shift/, -9.6, 8.4, 0.4, { act: { pose: 'work' } }),
        landmark('swings', /swing|play|kid|child/, 9, 1.6, -HALF),
        landmark('people', /people|crowd|meet/, 3.4, 6.4, 0),
      ],
      crowd: [[2.4, 6.4, 0.4], [-2.4, 7.8, -0.5], [6.6, 7.2, 2.4], [-6, 6.6, 1.2], [8.6, 9.8, -0.8], [-5, 9.4, 0.8], [4, 10.4, 2.8], [-3.2, 10.2, 2.4], [-12, 4, 1.6], [4.6, 1.6, -0.4], [0.2, 9.8, 3.1], [-4.4, 1.4, 0.6]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

/** A lit evening plaza: a stage with a backdrop, hanging lanterns, food stalls and rows of benches. */
const eveningGarden: SceneDef = {
  mood: 'outdoor', accent: '#e0762c',
  walk: OPEN,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#c9bfa6', edge: '#8f866f' });
    for (let x = -13; x <= 13; x += 2) for (let z = -4; z <= 12; z += 2) if ((x + z) % 4 === 0) b.box(x, 0.05, z, 2, 0.02, 2, '#b9af94');
    // The stage at the back: a raised platform with a curved backdrop in warm colours, lights on a truss, speakers
    b.cyl(0, 0.22, -8.6, 6, 0.44, '#8d7a66', { seg: 18, sz: 0.6 }); b.cyl(0, 0.46, -8.6, 5.8, 0.06, '#a8927a', { seg: 18, sz: 0.58 });
    b.box(0, 2.6, -11.8, 12, 5.2, 0.3, '#3a2c34'); for (let i = 0; i < 10; i++) b.box(-5.4 + i * 1.2, 2.6, -11.6, 1, 5, 0.1, ['#e0762c', '#c9423a', '#d6a83a', '#8a3a5a', '#e0762c'][i % 5]!);
    b.box(0, 5.5, -9.6, 12.4, 0.3, 0.3, METAL_DARK); for (let i = 0; i < 6; i++) b.box(-5 + i * 2, 5.2, -9.6, 0.5, 0.5, 0.5, '#fff3c4', GLOW); b.light(0, 4.5, -8, '#ffd9a0', 24, 12);
    for (const s of [-1, 1]) { speaker(b, s * 6.6, -7.4, { h: 2.6, w: 1.2 }); b.cyl(s * 6.4, 2.6, -11.2, 0.15, 5.2, METAL_DARK, { seg: 5 }); }
    labelled(b, label, 0, 6.5, -11.5, 12, 0.5, '#f4e6b8', '#3a2c34', true);
    extra(b, 'eg-singer', 0, -8.8, 0, 'wave', { y: 0.5, look: { body: 'woman', outfit: 'owambe', outfitColor: 'orange', fabric: 'ankara', hair: 'gele' } });
    extra(b, 'eg-drummer', 3.2, -9.6, 0, 'stand', { y: 0.5, look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream' } }); drum(b, 2.4, -9.2);
    // Hanging lanterns in rows across the plaza, strings of bulbs
    for (const x of [-12, 12]) b.cyl(x, 3, 1.4, 0.08, 6, METAL_DARK, { seg: 5 }); for (const x of [-12, 12]) b.cyl(x, 3, 6.4, 0.08, 6, METAL_DARK, { seg: 5 });
    stringLights(b, [-12, 5.8, 1.4], [12, 5.8, 1.4], { n: 16, sag: 0.9, colors: [WARM, '#ffb0a0', '#ffd58a'] }); stringLights(b, [-12, 5.8, 6.4], [12, 5.8, 6.4], { n: 16, sag: 0.9, colors: ['#ffb0a0', WARM, '#bfe3ff'] });
    for (let i = 0; i < 6; i++) { b.cyl(-9 + i * 3.6, 4.9, 1.4, 0.3, 0.5, ['#e0762c', '#c9423a', '#d6a83a'][i % 3]!, { seg: 6, top: 0.7, layer: 'glow' }); }
    // Food stalls with awnings along the right edge, benches in rows facing the stage
    for (let i = 0; i < 2; i++) { b.at(11.4, 0, -0.4 + i * 4.2, -HALF, () => { for (const s of [-1, 1]) b.box(s * 1.5, 1.4, 0.7, 0.12, 2.8, 0.12, WOOD_DARK); b.box(0, 2.9, 0, 3.4, 0.1, 2.2, i ? '#2f8f55' : '#c9423a', { rx: 0.15 }); b.box(0, 0.5, 0.2, 3, 1, 1.1, WOOD_DARK); b.box(0, 1.05, 0.2, 3.2, 0.1, 1.3, WOOD); for (let k = 0; k < 4; k++) pot(b, -1.1 + k * 0.7, 1.1, 0.2); }); }
    for (let r = 0; r < 2; r++) for (const s of [-1, 1]) bench(b, s * 4.4, 0.6 + r * 2.8, { w: 4, back: true, ry: PI, color: '#8a6644' });
    for (let i = 0; i < 4; i++) extra(b, `eg-listener-${i}`, (i % 2 ? 1 : -1) * 3.6 + (i % 3 - 1) * 1.1, 0.6 + Math.floor(i / 2) * 2.8, PI, 'sit', { seat: 0.6 });
    for (const x of [-13.2, 13.4]) palm(b, x, 9.6, { s: 1.1 }); lampPost(b, -9, 9, { light: true }); lampPost(b, 9, 9);
    return {
      spots: [
        landmark('stage', /stage|set|music|band|evening|listen|garden/, 0, -4.8, PI),
        landmark('work', /work|staff|office|job|shift|sound/, -8, -4.4, 0.4, { act: { pose: 'work' } }),
        landmark('lanterns', /lantern|light|walk|rest/, -9, 4.2, 0),
        landmark('people', /people|crowd|meet/, 0.6, 8.4, 0),
      ],
      crowd: [[2.4, 9.4, 0.4], [-2.4, 8.8, -0.5], [7.6, 6.6, 2.4], [-7.6, 7.6, 1.2], [9.6, 9.8, -0.8], [-8.4, 9.8, 0.8], [4, 10.6, 2.8], [-5.2, 10.4, 2.4], [-12, 6, 1.6], [8.4, 3.2, -0.4], [0.2, 10.6, 3.1], [-9, 1.4, 0.6]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};
function pot(b: Batch, x: number, y: number, z: number): void { b.cyl(x, y + 0.2, z, 0.24, 0.4, '#3a3d42', { seg: 7 }); b.ball(x, y + 0.4, z, 0.2, 0.08, 0.2, '#b8652f', { seg: 5 }); }

/** Variant scenes by scene kind, then by variant (venue.scene.variant). */
const RAW: Record<string, Record<string, SceneDef>> = ({
  hub: { station, 'park-lot': parkLot, 'park-trucks': parkTrucks, 'park-rank': parkRank, interchange },
  market: { 'market-sheds': marketSheds, 'market-containers': marketContainers, 'market-garri': marketGarri, 'market-kola': marketKola },
  office: { 'campus-farm': campusFarm, 'campus-dome': campusDome, 'campus-tech': campusTech, 'campus-lawn': campusLawn, 'campus-flag': campusFlag, 'cloth-studio': clothStudio, 'media-studio': mediaStudio },
  viewing: { bowl, 'track-stadium': trackStadium, 'ground-clay': groundClay, 'ground-terrace': groundTerrace },
  walk: { factory, 'heritage-house': heritageHouse, 'heritage-gallery': heritageGallery },
  statehouse: { 'hall-brick': hallBrick, 'hall-dome': hallDome },
  park: { 'ayo-park': ayoPark, 'evening-garden': eveningGarden },
});

/** A wide scene in a tall window needs the camera further back than the rooms do. */
const WIDE: SceneCamera = { landscape: [15, 19.8, 25.4], portrait: [18, 40, 52] };
export const VARIANTS: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = Object.freeze(Object.fromEntries(Object.entries(RAW).map(([kind, variants]) => [kind, Object.freeze(Object.fromEntries(Object.entries(variants).map(([variant, def]) => [variant, def.mood === 'outdoor' && !def.camera ? { ...def, camera: WIDE } : def])))])));
