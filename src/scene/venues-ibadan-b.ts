/**
 * OWNER: scenes
 * Scenes with an Ibadan character that share a kind with another city's venue: a venue asks for one through
 * `scene.variant` (CitySceneVariant) and VARIANTS[kind][variant] replaces the kind's own scene
 * (src/scene/venue-scenes.ts), including its walkable description when it carries one.
 *
 *   office / tower        a slab tower with vertical fins above a paved plaza and a busy road
 *   office / campus       a polytechnic or private-university court: lecture block, workshop shed, lab annex
 *   statehouse / hill-hall   a colonial hall on a hilltop: clock tower, colonnade, wide steps, rust roofs
 *   viewing / stadium     an open football ground: a pitch, a covered main stand, floodlights
 *   walk / gallery        a museum gallery: cases, carved figures, indigo cloth
 *   walk / forest         a research forest reserve: a trail under tall trees, a stream, a bird hide
 *   hub / bus-park        a bus park under a flyover, a loading shed, buses and taxis
 *   hub / rail            a railway platform under a high roof with a train alongside
 *   market / foodstuff | street | cloth     a foodstuff market, a trading street, a cloth market
 *   park / garden         a landscaped garden with a pond, a footbridge, a pavilion and a small stage
 *
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * All scenes are static and keep to the geometry budget of the others; the roofs, hills and far trees are baked boxes and blobs.
 * Scene definition format: see venues-outdoor.ts.
 */
import { GLOW, GLASS } from './build.ts';
import type { Batch, Colour, SceneDef, SceneWalkSpec } from './types.ts';
import {
  ground, room, table, stool, bench, plant, palm, leafTree, tallTree, bush, lampPost, kiosk, crate, column, flag, parasol, stringLights,
  fence, windowPane, door, sign, signBoard, car, landmark, extra, textWidth,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF, LEAF_DARK, WARM,
} from './props.ts';

const PI = Math.PI, HALF = Math.PI / 2;
const RUST: readonly Colour[] = ['#9b5a3a', '#a8653f', '#8a4e34', '#b0704a'];
const WALLS: readonly Colour[] = ['#e8dcc2', '#d9c9a8', '#eadfcf', '#d6c3a0'];
const OUTDOORS: SceneWalkSpec = { bounds: [-14.2, -12.2, 14.2, 12.2], entrance: [0, 11.4], open: true };
const INDOORS: SceneWalkSpec = { bounds: [-11.5, -9.5, 11.5, 9.5], entrance: [0, 8.8], open: false };

/** Block lettering has only capitals, digits and a few marks: a label is cleaned to those. */
const plain = (label: string): string => label.replace(/[’']/g, '').replace(/[^A-Za-z0-9 .\-]/g, ' ').replace(/\s+/g, ' ').trim();
/** The largest letter height (at most `max`) at which a label fits `width`. */
const fit = (label: string, width: number, max: number): number => Math.min(max, (width * 5) / Math.max(1, label.length * 4 - 1));
/** A sign on a board that fits the label, centred on x. */
function labelled(b: Batch, label: string, x: number, y: number, z: number, width: number, max: number, color: Colour, board: Colour, lit = false, ry = 0): void {
  const text = plain(label);
  sign(b, x, y, z, text, { size: fit(text, width, max), color, board, lit, pad: 0.22, ry });
}

/** A gable roof of two tilted slabs over a w × d footprint, its eaves at height y. */
function gable(b: Batch, x: number, y: number, z: number, w: number, d: number, tone: number, a = 0.4): void {
  const slope = d / 2 / Math.cos(a) + 0.2, rise = Math.tan(a) * d / 4 + 0.04;
  b.box(x, y + rise, z - d / 4, w + 0.5, 0.14, slope, RUST[tone % 4]!, { rx: -a });
  b.box(x, y + rise, z + d / 4, w + 0.5, 0.14, slope, RUST[(tone + 2) % 4]!, { rx: a });
  b.box(x, y + rise * 2 + 0.06, z, w + 0.56, 0.14, 0.3, '#7a4530');
}
/** A small house under a rust-brown roof: the colour of the city seen from above. */
function house(b: Batch, x: number, z: number, w: number, d: number, h: number, tone: number, ry = 0): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, h / 2, 0, w, h, d, WALLS[tone % 4]!);
    gable(b, 0, h, 0, w, d, tone);
    for (let i = 0; i < 2; i++) b.quad(-w / 4 + i * (w / 2), h * 0.55, d / 2 + 0.02, 0.5, 0.55, '#5d7488');
    b.box(0, 0.6, d / 2 + 0.02, 0.6, 1.2, 0.04, '#6b4a30');
  });
}
/** A passenger bus, long axis along z. */
function bus(b: Batch, x: number, z: number, ry: number, body: Colour, stripe: Colour, y = 0): void {
  b.at(x, y, z, ry, () => {
    b.box(0, 1.3, 0, 1.9, 2, 4.8, body);
    b.box(0, 0.75, 0, 1.94, 0.28, 4.84, stripe);
    b.box(0, 1.75, 0, 1.96, 0.62, 4.2, '#5f7b8c');
    b.box(0, 2.38, 0, 1.6, 0.08, 4.2, '#c9c4b4');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.9, 0.36, sz * 1.6, 0.36, 0.26, BLACK, { seg: 8, rz: HALF });
    for (const sx of [-1, 1]) b.box(sx * 0.6, 0.9, 2.42, 0.36, 0.18, 0.04, WARM, GLOW);
  });
}
/** A bolt of patterned cloth hung flat: an indigo ground with a few pale motifs. */
function adire(b: Batch, x: number, y: number, z: number, w: number, h: number, ry = 0, ground = '#27437a', motif = '#e9e4d2'): void {
  b.at(x, y, z, ry, () => {
    b.quad(0, 0, 0, w, h, ground);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) b.quad(-w / 3 + i * (w / 3), -h / 2 + (j + 0.5) * (h / 4), 0.012, w / 9, h / 14, (i + j) % 2 ? motif : '#6f8fc7');
  });
}
/** Tall slab tower: vertical fins over dark glazing and floor bands, with a crown block and mast. */
function slab(b: Batch, x: number, z: number, w: number, d: number, base: number, h: number, fins: number): void {
  b.box(x, base + h / 2, z, w, h, d, '#d6d0c0');
  const front = z + d / 2, side = x + w / 2;
  b.quad(x, base + h / 2, front + 0.015, w - 0.4, h - 0.5, '#4c6577');
  b.quad(side + 0.015, base + h / 2, z, d - 0.4, h - 0.5, '#4c6577', { ry: HALF });
  for (let i = 0; i < fins; i++) b.box(x - (w - 0.8) / 2 + i * ((w - 0.8) / (fins - 1)), base + h / 2, front + 0.1, 0.16, h - 0.3, 0.36, '#f0ebdd');
  for (let i = 0; i < 6; i++) b.box(side + 0.1, base + h / 2, z - (d - 0.8) / 2 + i * ((d - 0.8) / 5), 0.36, h - 0.3, 0.14, '#f0ebdd');
  for (let i = 1; i < 7; i++) b.box(x, base + (h / 7) * i, front + 0.06, w + 0.1, 0.1, 0.2, '#c9c2b0');
  b.box(x, base + h + 0.55, z, w + 0.3, 1.1, d + 0.3, '#c4bdaa');
  b.box(x, base + h + 1.5, z, w * 0.55, 0.9, d * 0.65, '#e0dacb');
  b.cyl(x, base + h + 2.5, z, 0.11, 1.6, '#c9ced3', { seg: 5 });
  b.ball(x, base + h + 3.4, z, 0.16, 0.16, 0.16, '#ff4a3a', GLOW);
}

// ---------------------------------------------------------------------------------------------
// Cocoa House: a slab tower with vertical fins, and the plaza and road below it.
const tower: SceneDef = {
  mood: 'outdoor', accent: '#f2c14e',
  camera: { landscape: [20, 24, 33], portrait: [18, 33, 44] },
  walk: { bounds: [-14.2, -12.2, 14.2, 12.2], entrance: [0, 7.6], open: true },
  build(b, { label }) {
    const X = -4.5;
    ground(b, { w: 30, d: 26, color: '#cfc6b0', edge: '#8f866f' });
    // The road in front: kerb, asphalt, dashes.
    b.box(0, 0.05, 8.5, 30, 0.08, 0.5, '#b9b09a');
    b.box(0, 0.04, 11, 30, 0.04, 4, '#4a4d52');
    for (let i = -6; i <= 6; i++) b.box(i * 2.3, 0.07, 11, 1.1, 0.02, 0.16, '#e6dfc8');
    // The podium and the tower.
    b.box(X + 0.5, 1.6, -6.5, 13, 3.2, 6.4, '#e2dccb');
    b.box(X + 0.5, 3.3, -6.5, 13.4, 0.2, 6.8, '#bfb8a4');
    slab(b, X, -7.6, 4.8, 3.2, 3.4, 9.6, 11);
    // Entrance: glazed lobby, mullions, canopy with the venue's name.
    b.box(X, 1.4, -3.27, 8, 2.6, 0.08, '#4f6a7a');
    for (let i = -4; i <= 4; i++) b.box(X + i, 1.4, -3.2, 0.1, 2.6, 0.12, '#cfc8b4');
    b.box(X, 1.05, -3.2, 2.2, 2.1, 0.12, '#2f4a5a');
    b.box(X, 3.05, -2.3, 6.4, 0.22, 2.1, '#e9e3d3');
    b.box(X, 2.62, -1.28, 6.4, 0.6, 0.1, '#2f4a3a');
    labelled(b, label, X, 2.62, -1.2, 6, 0.4, '#f4e6b8', '#2f4a3a', true);
    for (const s of [-1, 1]) b.cyl(X + s * 3, 1.5, -1.4, 0.12, 3, METAL);
    door(b, -9.4, -3.22, { w: 1.1, h: 2.2, color: '#4a4036', frame: '#cfc8b4' });
    // Plaza: a golden cocoa-pod monument, planters, benches, a flag.
    b.cyl(5.6, 0.25, 0.2, 1.5, 0.5, '#bdb6a2', { seg: 10 });
    b.cyl(5.6, 0.7, 0.2, 0.9, 0.4, '#a79f8b', { seg: 10 });
    b.ico(5.6, 1.9, 0.2, 0.5, 0.95, 0.5, '#e3a22a', { rz: 0.18 }); b.ico(6.2, 1.6, 0.5, 0.42, 0.8, 0.42, '#d98e1c', { rz: -0.3 }); b.ico(5, 1.55, 0.5, 0.42, 0.8, 0.42, '#e9b23a', { rx: 0.3 });
    b.ico(5.6, 0.95, 1, 0.7, 0.22, 0.4, LEAF_DARK);
    for (const [x, z] of ([[-10.2, -0.6], [1.3, -0.8], [-4.5, 5.2]] as [number, number][])) { b.box(x, 0.3, z, 1.4, 0.6, 1.4, '#b9b09a'); palm(b, x, z, { s: 0.85 }); }
    bench(b, -9.2, 3.4, { ry: HALF, back: true }); bench(b, 2.4, 5, { back: true }); bench(b, 9.6, 3.4, { ry: -HALF, back: true });
    flag(b, -11.6, -2.2, { h: 6.5, w: 2 });
    lampPost(b, -1.8, 3, { light: true }); lampPost(b, 8, 5.6); lampPost(b, -8.6, 6.2);
    kiosk(b, 10.2, 0.2, { ry: -HALF, w: 3, color: '#4f8a6a', roof: '#2f5a44', fascia: '#e9dba8' });
    parasol(b, 8.4, 6.8, { colors: ['#e0a43a', WHITE] });
    // The old city's rust roofs around the foot of the tower.
    house(b, 8.4, -9.2, 4, 3, 2.6, 0); house(b, 12.6, -8, 3, 2.8, 2.2, 1, 0.2); house(b, 6.8, -5.4, 2.8, 2.6, 2, 2); house(b, 12.4, -3.8, 2.6, 2.6, 2.2, 3, -0.2); house(b, -12.8, -8.4, 2.6, 2.6, 2.4, 1);
    // Dugbe traffic.
    bus(b, -8.4, 11.9, HALF, '#e8e2d0', '#2f6f4a'); car(b, 4.6, 12.2, { ry: HALF, color: '#e8e4d8' }); car(b, -0.6, 9.9, { ry: -HALF, color: '#d8a02a' }); car(b, 9.6, 9.9, { ry: -HALF, color: '#c9423a' });
    extra(b, 'cocoa-guard', X + 3.4, -1.9, 0, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', hair: 'lowcut', fabric: 'plain' } });
    extra(b, 'cocoa-trader', 9.3, 1.4, -HALF, 'work');
    return {
      spots: [
        landmark('lobby', /lobby|reception|desk|display|read|history|cocoa/, X, -0.5, PI),
        landmark('work', /work|staff|office|job|shift/, -9.4, -1.9, PI),
        landmark('plaza', /plaza|people|crowd|meet|pod|monument/, 3.4, 2.4, -HALF),
        landmark('bench', /bench|sit|rest|chill/, 2.4, 3.9, 0, { act: { pose: 'sit', x: 2.4, z: 5, ry: PI, seat: 0.6 } }),
      ],
      crowd: [[-1, 3.4, 0.4], [-6.4, 2.8, -0.5], [1.4, 6.2, 2.4], [-3.4, 6.6, 1.2], [7.4, 2.8, -1], [-9, 5.4, 1.6], [0.8, 0.8, 2.2], [4.8, 4.6, 0.2], [-7.4, 7.4, 0.9], [9.4, 7.2, -0.6], [-11, 1.2, 2], [2.4, 7.6, 0.5]],
      spare: [[-6, 4], [6, 4.4], [-2.4, 8], [3, 7.6]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Mapo Hall: a colonial hall on a hilltop; a clock tower, a colonnade and wide steps, rust roofs on the slope.
const hillHall: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#7b8c4c', edge: '#6b4a35' });
    b.box(0, 0.04, 3.6, 16, 0.04, 15, '#dccfb2');
    b.box(0, 0.045, 3.6, 3.2, 0.04, 15, '#b87a5a');
    // The hall: central block, wings, rust roofs, a clock tower with a pyramid roof.
    b.box(0, 3.2, -10.6, 15, 6.4, 5, '#eadfc2');
    gable(b, 0, 6.4, -10.6, 15, 5, 0, 0.28);
    for (const s of [-1, 1]) {
      b.box(s * 10.5, 2.2, -10.8, 6, 4.4, 4.4, '#e2d4b4');
      gable(b, s * 10.5, 4.4, -10.8, 6, 4.4, s < 0 ? 1 : 3, 0.34);
      for (let i = 0; i < 2; i++) for (const y of [1.4, 3.2]) windowPane(b, s * (9.2 + i * 2.4), y, -8.58, { w: 1.0, h: 1.4, glass: '#7fa3b8', frame: '#fff8e8' });
    }
    b.box(0, 8.1, -10.6, 3.8, 3.4, 3.8, '#f0e6c8');
    b.cyl(0, 8.0, -8.66, 0.8, 0.08, '#f5f1e4', { seg: 14, rx: HALF });
    b.box(0, 8.18, -8.6, 0.06, 0.5, 0.04, BLACK); b.box(0.2, 8.0, -8.6, 0.4, 0.06, 0.04, BLACK);
    b.box(0, 9.25, -8.68, 1.4, 0.7, 0.04, '#5a4a38');
    b.cone(0, 11.4, -10.6, 2.9, 2.2, RUST[0]!, { seg: 4, ry: PI / 4 });
    b.cyl(0, 12.9, -10.6, 0.06, 1.2, '#c9ced3', { seg: 4 });
    // Portico on a landing: eight columns, entablature with the hall's name, a low pediment, wide steps.
    b.box(0, 0.4, -7.2, 13.4, 0.8, 4.6, '#e3dccb');
    for (let i = 0; i < 5; i++) { const top = 0.65 - i * 0.14; b.box(0, top / 2, -4.65 + i * 0.46, 15 - i * 0.2, top, 0.5, i % 2 ? '#d9d1bc' : '#e3dccb'); }
    for (const x of [-5.6, -4, -2.4, -0.8, 0.8, 2.4, 4, 5.6]) column(b, x, -5.6, { h: 6.2, r: 0.34, color: '#f6f1e3' });
    b.at(0, 0.8, 0, 0, () => {
      b.box(0, 5.75, -7.2, 13.2, 0.7, 4.4, '#efe9da');
      b.cyl(0, 6.72, -5.3, 1.24, 0.5, '#efe9da', { seg: 3, rx: -HALF, sx: 5.6 });
      b.cyl(0, 6.7, -5.02, 0.9, 0.06, '#d9d1bc', { seg: 3, rx: -HALF, sx: 5.6 });
      labelled(b, label, 0, 5.75, -4.98, 9, 0.4, '#5a5340', '#efe9da');
      door(b, 0, -8.02, { w: 2.2, h: 3.8, color: '#5a4630', frame: '#d6a83a' });
    });
    // The terrace over the city: a balustrade along the front with a gap for the way in, benches, a flag.
    for (const s of [-1, 1]) {
      b.box(s * 6.6, 0.45, 11.7, 9, 0.9, 0.4, '#e0d6bd');
      for (let i = 0; i < 4; i++) b.box(s * (2.2 + i * 3), 0.7, 11.7, 0.6, 1.4, 0.6, '#d4c9ae');
      bench(b, s * 6.8, 8.6, { back: true, color: '#cfc4a8', leg: '#9b9078' });
      lampPost(b, s * 4.6, 9.4, { light: s < 0 });
    }
    flag(b, 9.2, 1.6, { h: 7, w: 2.2 });
    // Slope: dry grass, rust-roofed houses and trees down either side.
    house(b, -11.4, -2.4, 2.8, 2.6, 2.2, 0, 0.3); house(b, -12.6, 1.6, 2.6, 2.4, 2, 2, -0.2); house(b, -11.2, 5.4, 2.8, 2.6, 2.2, 1, 0.1);
    house(b, 12.2, 3.4, 2.8, 2.6, 2.4, 3, -0.3); house(b, 11.6, 7.2, 2.6, 2.4, 2, 0, 0.2);
    leafTree(b, -12.2, -5.8, { s: 1.1, tone: 2 }); leafTree(b, 12.4, -3.6, { s: 1, tone: 0 }); palm(b, -8.8, 3.6, { s: 1.05 }); palm(b, 8.8, 5.6, { s: 1 });
    bush(b, -7.6, 9.4); bush(b, 7.8, 9.8, { s: 1.2 });
    extra(b, 'hall-guide', -3.4, -2.4, 0, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'green' } });
    return {
      spots: [
        landmark('steps', /step|stair|view|look|old|city|history|photo/, 3.2, -7, 0, { y: 0.83, approach: [3.2, -2.4] }),
        landmark('work', /work|staff|office|door|inside|notice|job|desk/, -3.2, -7, PI, { y: 0.83, approach: [-3.2, -2.4] }),
        landmark('terrace', /terrace|wall|balustrade|overlook/, 5.6, 10.1, 0),
        landmark('people', /people|crowd|meet/, 0, 5.6, 0),
      ],
      crowd: [[2.4, 5.4, 0.4], [-0.8, 6.8, -0.5], [5.6, 3.2, 2.4], [-3.6, 7.4, 1.2], [-5.6, 2.2, 2.6], [5.8, -0.6, -2.4], [-2.4, 9.6, 0.6], [1.2, 9.4, 0.2], [-6.2, 5.8, 1.6], [6.4, 7.8, -0.6], [-4.6, 0.4, 2.2], [3.4, 1.6, 2.8]],
      spare: [[-6, 8], [6, 9], [-3, 10.4], [3.4, 9.8]],
      raised: [{ rect: [-6.9, -9.5, 6.9, -4.9], y: 0.83, lip: 2.3 }],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// A polytechnic or private-university court: a lecture block with a veranda, a workshop shed, a lab annex.
const campus: SceneDef = {
  mood: 'outdoor', accent: '#3f8f6a',
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#6f9a55', edge: '#4f6d3f' });
    b.box(0, 0.04, 3, 19, 0.04, 12, '#d4cdbb');
    b.box(0, 0.045, 8.6, 4, 0.04, 6, '#c2baa4');
    // Lecture block: two floors of windows, a rust roof, a veranda on columns.
    b.box(-4.4, 3, -9.6, 17, 6, 4, '#e9e0cc');
    gable(b, -4.4, 6, -9.6, 17, 4, 0, 0.3);
    for (let i = 0; i < 7; i++) for (const y of [4.6, 1.9]) windowPane(b, -11.4 + i * 2.35, y, -7.58, { w: 1.2, h: 1.4, glass: '#6f93a8', frame: '#fff8e8' });
    b.box(-4.4, 3.35, -7, 17.4, 0.22, 2.4, '#d9d1bc');
    for (let i = 0; i < 8; i++) b.cyl(-12.6 + i * 2.4, 1.7, -5.9, 0.16, 3.4, '#f0ebdd', { seg: 6 });
    labelled(b, label, -4.4, 3.35, -5.78, 10, 0.5, '#f4efe0', '#2f5a44');
    // Workshop yard: a lean-to over the back bench, a pad with a lathe and a welding table in the open.
    for (const x of [4.6, 8.6, 12.6]) b.cyl(x, 1.7, -8.6, 0.14, 3.4, METAL_DARK, { seg: 6 });
    b.box(8.6, 3.6, -9.9, 9.2, 0.14, 2.8, '#8f4f35', { rx: -0.14 });
    for (let i = 0; i < 9; i++) b.box(4.4 + i * 1, 3.68, -9.9, 0.08, 0.1, 2.8, '#a8653f', { rx: -0.14 });
    b.box(8.8, 0.04, -5.6, 8.6, 0.04, 6.4, '#a79f8b');
    table(b, 8.6, -9.9, { w: 7, d: 1.1, h: 1, color: '#7a5c3c' });
    b.box(11, 0.9, -5.4, 1.6, 1.4, 1.1, '#3f6a8a'); b.box(11, 1.7, -5.4, 0.9, 0.3, 0.7, '#2a3f52'); b.cyl(10.2, 1.1, -5.4, 0.26, 0.5, '#c9ced3', { seg: 8, rz: HALF });
    table(b, 6.6, -5.4, { w: 2.6, d: 1.1, h: 1, color: '#7a5c3c' }); b.ball(6.2, 1.2, -5.4, 0.14, 0.14, 0.14, '#ffe08a', GLOW);
    extra(b, 'campus-welder', 6.6, -4.5, 0, 'work'); extra(b, 'campus-tech', 10.2, -4.4, PI, 'work', { look: { body: 'man', outfit: 'casual', outfitColor: 'blue' } });
    // Lab annex: glass front with rows of lit screens.
    b.box(-12.4, 1.6, 1.6, 3.2, 3.2, 6.2, '#d9d1bc');
    gable(b, -12.4, 3.2, 1.6, 3.2, 6.2, 2, 0.12);
    b.box(-10.78, 1.6, 1.6, 0.06, 2.2, 5.2, '#4f6a7a');
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) b.quad(-10.72, 1.2 + r * 0.9, -0.4 + i * 1.3, 0.8, 0.5, i % 2 ? '#7fd1e8' : '#b8f0c8', { ry: HALF, ...GLOW });
    sign(b, -10.72, 3.45, 1.6, 'LAB', { size: 0.4, color: WHITE, ry: HALF, board: '#2f5a44', pad: 0.12 });
    // The court: a flag, a notice board, benches, trees.
    flag(b, 0, 2.6, { h: 6.4, w: 2 });
    b.box(4.4, 1.3, 6.6, 2.6, 1.6, 0.14, '#8a6644'); b.quad(4.4, 1.35, 6.7, 2.3, 1.3, '#f0e8cc');
    for (const [x, y] of ([[3.7, 1.5], [4.6, 1.2], [5.1, 1.6]] as [number, number][])) b.quad(x, y, 6.72, 0.5, 0.36, ['#e0a43a', '#9fd8ff', '#f2a6c8'][(x * 3 | 0) % 3]!);
    bench(b, -4, 6.2, { back: true }); bench(b, 0, 9.4, { back: true, ry: PI });
    extra(b, 'campus-reader', -4.2, 6.2, 0, 'sit', { seat: 0.6 }); extra(b, 'campus-student', 2.4, 4.4, 2.4, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'blue' } });
    leafTree(b, -8.8, 10.2, { s: 1.05, tone: 0 }); leafTree(b, 10.6, 5.6, { s: 1, tone: 1 }); leafTree(b, 12.4, 10, { s: 0.95, tone: 2 }); leafTree(b, -12.6, 9.4, { s: 1, tone: 1 });
    lampPost(b, -6.6, 2.6, { light: true }); lampPost(b, 6.8, 2.6);
    return {
      spots: [
        landmark('quad', /quad|campus|main|court|walk/, 0, 4.4, 0),
        landmark('lab', /lab|digital|code|computer/, -8.8, 1.6, -HALF),
        landmark('work', /work|staff|office|job|shift|workshop|practical/, 8.4, -2.6, PI),
        landmark('board', /board|notice|info/, 4.4, 5.2, PI),
      ],
      crowd: [[2, 7.4, 0.4], [-2.4, 3.6, -0.5], [6.6, 3.2, 2.4], [-6, 5.6, 1.2], [0.4, 1.2, 0], [8.6, 8.6, -0.8], [-8.4, 9, 0.8], [3, 10.4, 2.8], [-1.6, 9, 2.4], [7, 0.6, -1.6], [-4.8, 0.6, 1.6], [10.6, 7.8, 0.2]],
      spare: [[-6, 8], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// An open football ground: a striped pitch, a covered main stand in blue and white, floodlights, a ticket booth.
function goal(b: Batch, x: number, ry: number): void {
  b.at(x, 0, 0, ry, () => {
    for (const z of [-1.8, 1.8]) b.box(0, 1.2, z - 0.8, 0.12, 2.4, 0.12, WHITE);
    b.box(0, 2.4, -0.8, 0.12, 0.12, 3.8, WHITE);
    b.box(-0.5, 1.2, -0.8, 0.04, 2.4, 3.6, '#d9d6cc', { layer: 'glass' });
  });
}
const stadium: SceneDef = {
  mood: 'outdoor', accent: '#2f5fb0',
  walk: OUTDOORS,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#a69f8c', edge: '#7d776a' });
    for (let i = 0; i < 8; i++) b.box(-8.75 + i * 2.5, 0.05, -0.8, 2.5, 0.06, 11, i % 2 ? '#58a24c' : '#4e9944');
    b.box(-10, 0.09, -0.8, 0.12, 0.03, 11, WHITE); b.box(10, 0.09, -0.8, 0.12, 0.03, 11, WHITE);
    b.box(0, 0.09, -6.3, 20, 0.03, 0.12, WHITE); b.box(0, 0.09, 4.7, 20, 0.03, 0.12, WHITE); b.box(0, 0.09, -0.8, 0.12, 0.03, 11, WHITE);
    b.disc(0, 0.09, -0.8, 1.9, WHITE, { seg: 18 }); b.disc(0, 0.1, -0.8, 1.76, '#54a048', { seg: 18 });
    for (const s of [-1, 1]) { b.box(s * 8.4, 0.09, -0.8, 3.2, 0.03, 0.1, WHITE); b.box(s * 6.8, 0.09, -0.8 - 2.6, 0.1, 0.03, 5.2, WHITE, { }); goal(b, s * 10, s < 0 ? 0 : PI); }
    // Main stand along the back: five tiers of blue and white seats under a canopy.
    for (let i = 0; i < 5; i++) {
      const top = (i + 1) * 0.7;
      b.box(0, top / 2, -7.6 - i * 0.9, 24, top, 0.9, '#c9c4b6');
      b.box(0, top + 0.05, -7.6 - i * 0.9, 22, 0.12, 0.6, i % 2 ? '#2f5fb0' : '#f1efe8');
    }
    b.box(0, 2.2, -12.1, 25, 4.4, 0.4, '#b5b0a2');
    for (const x of [-11.6, -4, 4, 11.6]) b.box(x, 3.4, -12.4, 0.35, 6.8, 0.35, METAL);
    b.box(0, 6.5, -10, 25.4, 0.25, 6, '#d7d2c4', { rx: -0.1 });
    b.box(0, 6.3, -7.1, 25.4, 0.9, 0.14, '#2f5fb0');
    labelled(b, label, 0, 6.3, -7.0, 14, 0.5, WHITE, '#2f5fb0', true);
    // Floodlight masts, a covered side terrace, perimeter boards, bunting.
    for (const [x, z] of ([[-12.6, 6.2], [12.6, 6.2]] as [number, number][])) { b.cyl(x, 4.8, z, 0.18, 9.6, METAL, { seg: 6, top: 0.6 }); b.box(x, 9.9, z, 1.8, 1, 0.3, '#3d444b'); for (let i = 0; i < 4; i++) b.quad(x - 0.65 + i * 0.43, 9.9, z + 0.17, 0.36, 0.36, '#fff3c4', GLOW); }
    for (let i = 0; i < 9; i++) b.box(-8.6 + i * 2.2, 0.5, 6.6, 2, 0.8, 0.1, ['#2f5fb0', '#f1efe8', '#e0a43a'][i % 3]!);
    stringLights(b, [-12, 3.4, 7.6], [12, 3.4, 7.6], { n: 12, sag: 0.8, colors: ['#2f5fb0', '#f1efe8', '#e0a43a'] });
    // Ticket booth at the left front, a snack kiosk at the right.
    kiosk(b, -11, 9.6, { ry: HALF, w: 3.2, color: '#3a5a8a', roof: '#1f3a66', fascia: '#e9dba8', text: 'TICKETS', textColor: '#1f3a66' });
    kiosk(b, 11.6, 9.4, { ry: -HALF, w: 3, color: '#c69a4e', roof: '#b5483f' });
    // Players, an official, a coach, supporters in the stand with drums.
    const kit = (c: string) => ({ body: 'man', outfit: 'casual', outfitColor: c, bottomsColor: 'white', hair: 'lowcut' });
    extra(b, 'st-p1', -3, -1, 0.6, 'walk', { look: kit('blue') }); extra(b, 'st-p2', 1.6, 1.4, -2.4, 'walk', { look: kit('red') }); extra(b, 'st-p3', 5, -2.2, 2.4, 'stand', { look: kit('blue') });
    extra(b, 'st-ref', 0.2, -0.4, 0.3, 'walk', { look: { body: 'man', outfit: 'casual', outfitColor: 'yellow' } });
    b.ball(0.2, 0.2, 0.2, 0.2, 0.2, 0.2, WHITE, { seg: 6 });
    extra(b, 'st-fan-1', -4.6, -8.5, 0, 'wave', { y: 1.4 }); extra(b, 'st-fan-2', 1.4, -9.4, 0, 'stand', { y: 2.1 }); extra(b, 'st-fan-3', 6.4, -10.3, 0, 'wave', { y: 2.8 });
    b.cyl(-6.6, 2.1, -9.5, 0.3, 0.5, '#8a5a36', { seg: 8 });
    return {
      spots: [
        landmark('stand', /stand|match|watch|view|seat|fan/, 3.4, -5.6, 0),
        landmark('work', /work|staff|ticket|office|job|shift/, -9, 8, HALF),
        landmark('touchline', /touchline|pitch|train|warm/, -3.6, 5.8, PI),
        landmark('people', /people|crowd|meet/, 5.6, 7.6, 0),
      ],
      crowd: [[2, 7.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 6.2, 2.4], [-6, 6.6, 1.2], [-1.2, -5.4, 0], [8.6, 8.8, -0.8], [-8.4, 9, 0.8], [3, 10.4, 2.8], [-5.6, -5.6, 0.4], [10, -5.4, -0.2], [-9.6, 5.2, 1.6], [5.2, -5.4, 0.2]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// A museum gallery: glass cases, carved figures on plinths, a carved column, indigo cloth on the walls.
const gallery: SceneDef = {
  mood: 'indoor', accent: '#c9873a',
  walk: INDOORS,
  build(b, { label }) {
    room(b, { w: 24, d: 20, h: 5.6, floor: '#bfa27c', wall: '#efe7d6', side: '#e6dcc6', trim: '#8b6f4e', base: '#5a4636' });
    b.box(0, 0.045, 0, 22, 0.02, 18, '#b39469');
    labelled(b, label, -1, 4.7, -9.64, 11, 0.42, '#f4e6b8', '#3a2c20', true);
    // Walls: indigo cloth, rows of carved masks.
    adire(b, -7, 2.4, -9.7, 3.6, 3.2); adire(b, 7.4, 2.4, -9.7, 3.6, 3.2, 0, '#8a3a2e', '#f1d9a0');
    for (let i = 0; i < 6; i++) { b.box(-3.4 + i * 1.3, 2.3 - (i % 2) * 0.4, -9.72, 0.7, 1, 0.12, '#6b4a30'); b.quad(-3.4 + i * 1.3, 2.4 - (i % 2) * 0.4, -9.64, 0.4, 0.5, '#3a2a1c'); b.quad(-3.55 + i * 1.3, 2.5 - (i % 2) * 0.4, -9.63, 0.1, 0.1, '#f1e6c8'); b.quad(-3.25 + i * 1.3, 2.5 - (i % 2) * 0.4, -9.63, 0.1, 0.1, '#f1e6c8'); }
    adire(b, -11.88, 2.6, -2, 3.6, 3, HALF); adire(b, -11.88, 2.6, 3.4, 3.6, 3, HALF, '#2f6f5c', '#f1e6c8');
    for (let i = 0; i < 3; i++) { b.box(-11.84, 2.2, 7 + i * 0.9 - 1.5, 0.08, 0.9, 0.6, '#6b4a30', {}); }
    // Glass cases with pots, beads and small carvings.
    for (const [x, z, ry] of ([[-6.6, -4.6, 0], [-1.4, -4.6, 0], [4.4, -4.8, 0], [-8, 2.4, HALF]] as [number, number, number][])) {
      b.at(x, 0, z, ry, () => {
        b.box(0, 0.5, 0, 2.6, 1, 1.2, '#5f4630');
        b.box(0, 1.55, 0, 2.5, 1.1, 1.1, '#cfe3ea', GLASS);
        b.cyl(-0.7, 1.28, 0, 0.26, 0.5, '#b0653e', { seg: 8, top: 0.7 }); b.cyl(0, 1.24, 0, 0.2, 0.42, '#d9b46a', { seg: 8 }); b.ico(0.7, 1.22, 0, 0.3, 0.3, 0.3, '#3f72c4');
        b.box(0, 1.04, 0.45, 2.4, 0.05, 0.1, '#e0d6bd');
      });
    }
    // Carved figures and heads on plinths.
    for (const [x, z, h, c] of ([[6.4, 1.4, 1.2, '#a8742f'], [-4.4, 1.2, 1.3, '#6b4a30'], [8.4, -1, 1, '#8a5a36']] as [number, number, number, string][])) {
      b.box(x, h / 2, z, 1, h, 1, '#efe9dc'); b.ball(x, h + 0.5, z, 0.42, 0.55, 0.38, c, { seg: 7 }); b.box(x, h + 0.55, z + 0.3, 0.14, 0.2, 0.08, '#3a2a1c'); b.box(x, h + 0.12, z + 0.5, 1.1, 0.04, 0.04, '#cfc6b0');
    }
    // A carved column at the centre, a talking drum, a woven mat.
    b.cyl(0.4, 1.9, 0.6, 0.55, 3.8, '#6b4a30', { seg: 8 });
    for (let i = 0; i < 4; i++) { b.box(0.4, 0.8 + i * 0.85, 1.12, 0.7, 0.5, 0.1, '#3a2a1c'); b.quad(0.2, 0.86 + i * 0.85, 1.19, 0.12, 0.12, '#e8d9a8'); b.quad(0.6, 0.86 + i * 0.85, 1.19, 0.12, 0.12, '#e8d9a8'); }
    b.cyl(0.4, 3.95, 0.6, 0.9, 0.2, '#8a6644', { seg: 8 });
    b.cyl(-7.4, 0.45, 6, 0.3, 0.5, '#7a4a2c', { seg: 8, top: 0.5 }); b.cyl(-7.4, 0.95, 6, 0.3, 0.5, '#7a4a2c', { seg: 8, top: 1.7 }); b.cyl(-7.4, 0.7, 6, 0.32, 0.06, '#e0c58a', { seg: 8 });
    b.box(6.6, 0.04, 5.6, 4.2, 0.03, 3.2, '#c9873a'); b.box(6.6, 0.05, 5.6, 3.6, 0.03, 2.6, '#8a3a2e');
    stool(b, 6.6, 5.6, { h: 0.45 });
    // Information desk.
    b.box(9.4, 0.55, -6.8, 2.4, 1.1, 1, '#5f4630'); b.box(9.4, 1.12, -6.8, 2.6, 0.08, 1.1, '#e0d6bd'); plant(b, 10.8, -8.6, { s: 0.9 });
    extra(b, 'gal-educator', 9.4, -7.9, 0, 'work'); extra(b, 'gal-visitor', 2.6, -2.4, PI, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'green' } }); extra(b, 'gal-visitor-2', -3.2, 4.6, 0.6, 'stand');
    for (const x of [-4, 3.6]) { b.box(x, 3.5, -2.6, 0.04, 0.04, 0.04, METAL); }
    b.light(0, 4.6, 1, '#ffe2b0', 22, 14);
    return {
      spots: [
        landmark('gallery', /gallery|collection|tour|unity|art|history|exhibit/, 2.6, 3.4, PI),
        landmark('work', /work|staff|desk|office|job|shift/, 7.4, -5.8, PI),
        landmark('cases', /case|display|object/, -4, -2.4, PI),
        landmark('people', /people|crowd|meet/, -2, 6.4, 0),
      ],
      crowd: [[2, 6.4, 0.4], [-3.6, 7, -0.5], [6.6, 3.2, 2.4], [-7.6, 5.4, 1.2], [4.4, -1, 3], [8.4, 7.6, -0.8], [-9.4, -1, 0.8], [0.2, 8.4, 2.8], [-1.6, 2.8, 2.4], [9.6, 2.2, -1.6], [-5.8, 8.2, 1.6], [3.2, 4.8, 0.2]],
      spare: [[-6, 7], [6, 8], [-3, 8.6], [3.4, 8.2]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// A research forest reserve: a trail under tall trees, a stream with stepping stones, a bird hide, a trailhead board.
const forest: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#3f6a3e', edge: '#2c4a30' });
    // A winding trail of pale earth and a stream at the left.
    for (const [x, z, w, d] of ([[0, 9.6, 3, 3.4], [-0.6, 6.4, 2.8, 3.2], [0.6, 3.2, 2.8, 3.4], [1.4, -0.2, 2.8, 3.4], [0.4, -3.6, 2.8, 3.4], [-1, -6.8, 2.8, 3.4], [-1.4, -9.8, 2.6, 3.2]] as [number, number, number, number][])) b.box(x, 0.04, z, w, 0.04, d, '#c4a876');
    b.box(-8.6, 0.04, 0, 3.2, 0.05, 22, '#5a8f9a', GLASS);
    for (const z of [-3.4, -2.4, -1.4]) b.ico(-8.6, 0.12, z, 0.5, 0.14, 0.4, '#8d8f8a');
    // Trailhead board with the reserve's name, a research hut on stilts, a bird hide.
    signBoard(b, 8, 10, plain(label).slice(0, 22), { y: 2.6, size: fit(plain(label).slice(0, 22), 7, 0.4), color: '#f4e6b8', board: '#3a2c20' });
    b.at(8.6, 0, -3, -0.3, () => {
      for (const x of [-1.2, 1.2]) for (const z of [-1, 1]) b.box(x, 0.6, z, 0.18, 1.2, 0.18, WOOD_DARK);
      b.box(0, 1.3, 0, 3, 0.2, 2.6, WOOD); b.box(0, 2.4, 0, 2.8, 2, 2.4, '#8a6644'); gable(b, 0, 3.4, 0, 2.8, 2.4, 2, 0.35);
      b.box(0, 2.2, 1.22, 0.9, 1.2, 0.04, '#3a2a1c'); b.quad(-0.9, 2.5, 1.22, 0.6, 0.5, '#9fd8ff', GLOW);
      b.box(0, 0.65, 1.8, 1.4, 0.12, 0.8, WOOD_LIGHT, { rx: 0.5 });
    });
    b.at(-4.4, 0, -6.6, 0.4, () => { b.box(0, 1.1, 0, 3, 2.2, 1.8, '#6a4e34'); b.box(0, 1.5, 0.92, 2.2, 0.2, 0.04, '#1c1a14'); b.box(0, 2.3, 0, 3.4, 0.14, 2.2, '#4f3a28'); });
    // Tall trees along both sides and behind; undergrowth and ferns; logs to sit on.
    ([[-12.4, -9.4], [-10, -4.8], [-13, 2.2], [-11.2, 8.4], [-5.4, -10.6], [3.4, -10.8], [7.6, -9.6], [12.6, -8], [12.8, -0.6], [11, 5.6], [13, 9.6], [6.6, 1.6], [-4.6, 3.2], [-3.4, -2.4]] as [number, number][]).forEach(([x, z], i) => tallTree(b, x, z, { h: 7 + (i % 4) * 1.5, s: 1.05 + (i % 3) * 0.12, tone: i % 3 }));
    ([[-6.2, 8], [5.4, 7], [8, 9.6], [-3.4, 9.8], [2.6, -5.4], [-6.4, 4.8], [10, 2.2], [-7.4, -8.6]] as [number, number][]).forEach(([x, z], i) => bush(b, x, z, { s: 0.9 + (i % 3) * 0.2, color: i % 2 ? LEAF : LEAF_DARK }));
    for (const [x, z] of ([[3.8, 4.4], [-2.6, 6], [4.2, -2.6]] as [number, number][])) for (let i = 0; i < 3; i++) b.cone(x + i * 0.25, 0.35, z + (i % 2) * 0.2, 0.22, 0.7, '#5fa04a', { seg: 4, rz: (i - 1) * 0.25 });
    b.cyl(-2.6, 0.3, 4.4, 0.32, 2.4, '#6b5440', { seg: 7, rz: HALF }); b.cyl(3.2, 0.3, 7.2, 0.32, 2.2, '#6b5440', { seg: 7, rz: HALF, ry: 0.5 });
    extra(b, 'forest-guide', 2.6, 3.6, -0.7, 'stand', { look: { body: 'man', outfit: 'casual', outfitColor: 'green', hair: 'lowcut' } });
    extra(b, 'forest-watcher', -4.6, -4.6, 0.4, 'stand');
    return {
      spots: [
        landmark('trail', /trail|walk|forest|path|nature|bird/, 0.6, 4.6, PI),
        landmark('work', /work|staff|office|job|shift|hut|guide/, 7.2, -0.6, PI),
        landmark('hide', /hide|watch/, -3.4, -4.6, PI),
        landmark('people', /people|crowd|meet/, 2.4, 8, 0),
      ],
      crowd: [[2.4, 7.6, 0.4], [-0.8, 5.6, -0.5], [4.6, 2.2, 2.4], [-2.6, 8.4, 1.2], [-1.6, 0.6, 2.6], [2.6, -3.2, -2.4], [-1.4, -7.4, 0.6], [6.2, 5.4, 0.2], [-5.2, 6.4, 1.6], [6.4, -6.6, -0.6], [-3.4, -5.4, 2.2], [0.4, 10.2, 0.2]],
      spare: [[-6, 8], [4, 8.6], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// A bus park under a flyover: parked buses and taxis, a loading shed with benches, route board, traders.
const busPark: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  walk: OUTDOORS,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#6a6d72', edge: '#43464a' });
    b.box(0, 0.04, 9.2, 30, 0.04, 0.3, '#e6dfc8');
    for (let i = 0; i < 8; i++) b.box(-9.8 + i * 2.8, 0.045, 10.6, 1.6, 0.03, 0.2, '#e6dfc8');
    for (let i = 0; i < 6; i++) b.box(2.4 + i * 0.7, 0.05, 6.6, 0.4, 0.03, 2.6, '#e6dfc8');
    // The flyover: a deck on piers across the back, with parapets and a bus crossing.
    b.box(0, 5, -9.6, 32, 0.8, 5.2, '#bdb8aa');
    b.box(0, 5.6, -12.1, 32, 0.9, 0.3, '#a8a395'); b.box(0, 5.6, -7.1, 32, 0.9, 0.3, '#a8a395');
    for (const x of [-12, -4, 4, 12]) { b.box(x, 2.3, -9.6, 1.4, 4.6, 1.6, '#a9a496'); b.box(x, 4.5, -9.6, 3.2, 0.5, 2.2, '#b5b0a2'); }
    bus(b, 3, -9.6, HALF, '#e8e2d0', '#2f6f4a', 5.4);
    // Parked buses on the lower level.
    bus(b, -9.2, -4.8, 0, '#e8e2d0', '#2f6f4a'); bus(b, -6.4, -4.4, 0.05, '#f0d070', '#a14b3c'); bus(b, 6.4, -4.8, -0.04, '#e8e2d0', '#3f72c4'); bus(b, 10, -4.4, 0, '#d9d2b8', '#a8323a');
    // Loading shed with a rust roof, benches and a route board.
    for (const [x, z] of ([[-13, 1], [-5, 1], [-13, 5.4], [-5, 5.4]] as [number, number][])) b.cyl(x, 1.7, z, 0.13, 3.4, METAL_DARK, { seg: 6 });
    b.box(-9, 3.55, 3.2, 9.4, 0.16, 5.4, '#8f4f35', { rx: 0.1 });
    for (let i = 0; i < 10; i++) b.box(-13.2 + i * 0.95, 3.65, 3.2, 0.08, 0.1, 5.4, '#a8653f', { rx: 0.1 });
    bench(b, -10.4, 4.6, { back: true, ry: PI }); bench(b, -7, 4.6, { back: true, ry: PI });
    b.box(-12.8, 1.4, 3, 0.12, 1.4, 2.4, '#2f3b36'); for (let i = 0; i < 4; i++) b.quad(-12.72, 1.9 - i * 0.3, 3, 2, 0.14, ['#ffe07a', '#9fd8ff', '#b8f0c8', '#f2a6c8'][i]!, { ry: HALF, ...GLOW });
    // The park's own name over the entry, taxis in a queue, traders with trays.
    signBoard(b, 6.2, 8.6, plain(label), { y: 3, size: fit(plain(label), 10, 0.44), color: '#f4e6b8', board: '#2f3b36' });
    car(b, 9.4, 1.6, { ry: 0.1, color: '#e8e4d8' }); car(b, 11.8, 1.8, { ry: -0.05, color: '#e8e4d8' }); car(b, 9.6, 6, { ry: 0.2, color: '#d9d2b8' });
    parasol(b, -1.6, 7.4, { colors: ['#3f9a5a', WHITE] }); b.box(-1.6, 0.55, 8.4, 1.4, 0.1, 0.8, WOOD); for (let i = 0; i < 4; i++) b.ball(-2 + i * 0.3, 0.7, 8.4, 0.12, 0.1, 0.12, ['#e8a13a', '#d9482f'][i % 2]!, { seg: 5 });
    lampPost(b, 1, 3, { light: true }); lampPost(b, -2.6, 0.8); house(b, 13, 9, 2.4, 2.4, 2.2, 1, -0.3);
    extra(b, 'bus-conductor', 6.8, 3.6, 2.4, 'wave', { look: { body: 'man', outfit: 'casual', outfitColor: 'yellow' } });
    extra(b, 'bus-waiter-1', -10.4, 4.6, PI, 'sit', { seat: 0.6 }); extra(b, 'bus-waiter-2', -8.6, 2.2, 1.2, 'stand'); extra(b, 'bus-seller', -1.6, 8.7, PI, 'work');
    return {
      spots: [
        landmark('platform', /platform|bus|stop|wait|queue|travel/, -7, 0.4, PI),
        landmark('work', /work|staff|dispatch|job|shift/, 4.6, 2.6, HALF),
        landmark('people', /people|crowd|meet/, 0.4, 4.6, 0),
      ],
      crowd: [[2, 3.8, 0.4], [-2.4, 5.6, -0.5], [4.6, 5.2, 2.4], [-4, 2.4, 1.2], [8, 3.6, -1], [-1, 1.6, 2.2], [0.4, 8.4, 0.6], [-5.4, 7.6, 0.8], [3.2, -0.6, 2.4], [-11.6, 7.4, 1.6], [7.4, 8, -0.4], [12, 4.4, -1.6]],
      spare: [[-4, 6.8], [0, 6.2], [4, 7.4], [2, 9.2]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// A railway platform under a high roof: a long train alongside, a station building with its name, benches, luggage.
const rail: SceneDef = {
  mood: 'outdoor', accent: '#2f8f55',
  walk: { bounds: [-14.2, -5.4, 14.2, 12.2], entrance: [0, 10.6], open: true },
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#bdb6a5', edge: '#8a8474' });
    // Track bed at the back with sleepers and rails.
    b.box(0, 0.05, -9.2, 30, 0.1, 4.4, '#7d776b');
    for (let i = 0; i < 30; i++) b.box(-14.4 + i, 0.11, -9.2, 0.35, 0.06, 3, '#5f4630');
    for (const z of [-9.9, -8.5]) b.box(0, 0.17, z, 30, 0.08, 0.14, '#9aa0a6');
    b.box(0, 0.05, -6.6, 30, 0.04, 0.36, '#f2c14e');
    // The train: three cars and a nose, white with a green band and a dark window strip.
    for (let i = 0; i < 3; i++) {
      const x = -9.4 + i * 7.6;
      b.box(x, 1.9, -9.2, 7.3, 3.1, 2.6, '#eceae2'); b.box(x, 0.9, -9.2, 7.32, 0.7, 2.62, '#1f7a4d');
      b.box(x, 2.45, -7.9, 6.6, 0.8, 0.04, '#33475a'); b.box(x, 3.5, -9.2, 7, 0.14, 2.2, '#b9b6ac');
      for (let w = 0; w < 6; w++) b.quad(x - 2.7 + w * 1.1, 2.45, -7.86, 0.7, 0.55, '#9fd8ff', { });
      b.box(x + 3.7, 1.9, -9.2, 0.25, 2.6, 2.2, '#6a6e72');
    }
    b.box(14, 1.9, -9.2, 1.6, 3.1, 2.6, '#1f7a4d'); b.box(14.9, 1.6, -9.2, 0.3, 1.6, 2.4, '#e9b23a'); b.box(14.84, 2.4, -7.9, 0.1, 0.4, 0.3, '#fff3c4', GLOW);
    // High station roof over the platform's back half, on slim columns, with the building at the left end.
    for (const x of [-12, -6, 0, 6, 12]) b.cyl(x, 2.4, -3.2, 0.2, 4.8, '#f0ebdd', { seg: 6 });
    b.box(0, 5, -5.4, 30, 0.2, 5.8, '#cfe3ea', GLASS); b.box(0, 4.85, -2.5, 30, 0.2, 0.3, '#b9b6ac'); b.box(0, 4.85, -8.3, 30, 0.2, 0.3, '#b9b6ac');
    for (let i = 0; i < 7; i++) b.box(-13.2 + i * 4.4, 4.6, -5.4, 0.2, 0.5, 5.8, '#c4c0b4');
    b.box(-11, 2.4, 1.6, 7.6, 4.8, 5.6, '#e9e2cf'); b.box(-11, 4.95, 1.6, 8.2, 0.3, 6.2, '#9b5a3a');
    b.box(-7.14, 1.6, 1.6, 0.06, 2.4, 4.4, '#4f6a7a'); for (let i = -2; i <= 2; i++) b.box(-7.1, 1.6, 1.6 + i * 1.1, 0.08, 2.4, 0.1, '#cfc8b4');
    labelled(b, label, -7.1, 4.1, 1.6, 4.6, 0.36, '#f4efe0', '#1f7a4d', true, HALF);
    // Platform furniture and people.
    bench(b, 0.4, -4, { back: true, ry: 0, color: '#6a6e72', leg: METAL_DARK }); bench(b, 5.4, -4, { back: true, color: '#6a6e72', leg: METAL_DARK });
    kiosk(b, 10.4, 1.6, { ry: -HALF, w: 3, color: '#3a6ea5', roof: '#243a66', fascia: '#e9dba8' });
    for (const [x, z, c] of ([[2.6, -2.2, '#2f4a66'], [3.2, -2.0, '#a14b3c'], [8.4, -3.2, '#3f6a4a']] as [number, number, string][])) b.box(x, 0.45, z, 0.7, 0.9, 0.4, c);
    lampPost(b, -2.6, 4, { light: true }); lampPost(b, 4, 6.4); lampPost(b, 11, 7);
    b.box(-3, 2.8, -2.7, 2.6, 0.9, 0.1, '#1a2230'); sign(b, -3, 2.9, -2.64, 'TRAINS', { size: 0.26, color: '#ffe07a', lit: true });
    flag(b, 12.6, 6.6, { h: 6, w: 1.8 });
    extra(b, 'rail-passenger-1', 0.4, -4, 0, 'sit', { seat: 0.6 }); extra(b, 'rail-passenger-2', 7, -1, -1, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange' } });
    extra(b, 'rail-attendant', -5.4, 3.2, HALF, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', hair: 'lowcut', fabric: 'plain' } });
    return {
      spots: [
        landmark('platform', /platform|rail|train|wait|board|travel/, 2.2, 0.2, PI),
        landmark('ticket', /ticket|desk|work|staff|job|shift/, 8.2, 3.4, 0),
        landmark('bench', /bench|sit|rest/, 5.4, -2.6, 0),
        landmark('people', /people|crowd|meet/, -1.6, 6, 0),
      ],
      crowd: [[2, 4, 0.4], [-2.4, 2.4, -0.5], [6, 2.4, 2.4], [-4, 6.4, 1.2], [8.6, 5.4, -1], [-1, 8.4, 2.2], [0.4, -1.8, 0.6], [4.4, 8, 0.8], [10.6, -1.8, 2.4], [-3.4, -2.8, 1.6], [6.4, 9.2, -0.4], [-8, 8.6, 1.6]],
      spare: [[-1, 6.2], [3, 6.6], [6, 5.4], [0, 9.2]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Markets: one ground, three characters.
function sacks(b: Batch, x: number, z: number, cols: number, rows: number, colour: Colour): void {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) b.ball(x + c * 0.62 + (r % 2) * 0.3, 0.3 + r * 0.42, z, 0.34, 0.3, 0.3, r % 2 ? '#cdbf99' : colour, { seg: 6 });
}
function yams(b: Batch, x: number, z: number, ry: number): void {
  b.at(x, 0, z, ry, () => { for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) b.cyl(-0.45 + j * 0.3, 0.2 + i * 0.22, 0, 0.12, 1.5, i % 2 ? '#a9743c' : '#8f5a34', { seg: 5, rx: HALF }); });
}
function basin(b: Batch, x: number, z: number, colour: Colour, r = 0.5): void {
  b.cyl(x, 0.2, z, r, 0.4, '#d9d6cc', { seg: 8, top: 1.3 }); b.ico(x, 0.5, z, r * 0.9, 0.26, r * 0.9, colour);
}
/** A rust corrugated roof on four posts over a w × d floor. */
function roofed(b: Batch, x: number, z: number, w: number, d: number, tone = 0): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(x + sx * (w / 2 - 0.1), 1.8, z + sz * (d / 2 - 0.1), 0.14, 3.6, 0.14, WOOD_DARK);
  b.box(x, 3.7, z, w + 0.4, 0.12, d + 0.4, RUST[tone % 4]!, { rx: 0.12 });
  for (let i = 0; i < Math.floor(w / 0.7); i++) b.box(x - w / 2 + 0.4 + i * 0.7, 3.78, z, 0.07, 0.08, d + 0.4, RUST[(tone + 1) % 4]!, { rx: 0.12 });
}
const marketGround = (b: Batch, tone: Colour = '#d2b584'): void => {
  ground(b, { w: 30, d: 26, color: tone, edge: '#9a8058' });
  b.box(1, 0.04, 1.5, 9, 0.03, 19, '#c2a273'); b.box(0, 0.04, -3.6, 26, 0.03, 3, '#c2a273');
};
const MARKET_CROWD: [number, number, number][] = [[2.8, 1.4, 0.5], [-0.6, 4.6, -0.4], [3.4, 4.2, 2.4], [-2.6, 0.6, 1.4], [-7.6, -4.6, PI], [-1.2, -5.4, PI], [7.6, -3, 2.6], [-8.2, 4.4, -HALF], [5.6, 6.8, 0.2], [-5.6, 3, 1], [9.6, 0.6, -0.8], [0.2, 9, 0.3]];

/** Bodija: foodstuff in sacks, yams and basins under rust roofs. */
const foodstuff: SceneDef = {
  mood: 'outdoor', accent: '#f08a3c',
  build(b, { label }) {
    marketGround(b, '#d0b078');
    roofed(b, -8.4, -8.4, 7.6, 3.6, 0); roofed(b, 0.4, -8.4, 7.6, 3.6, 1); roofed(b, 9, -8.4, 7.6, 3.6, 2);
    for (const x of [-8.4, 0.4, 9]) { table(b, x, -8.6, { w: 6.4, d: 1.2, h: 0.9, color: '#8a6644' }); }
    sacks(b, -10.6, -9.6, 4, 2, '#d9cdaa'); basin(b, -7.4, -8.6, '#d9482f'); basin(b, -6.4, -8.6, '#c9372c', 0.45); basin(b, -5.4, -8.6, '#5f9a48', 0.45);
    sacks(b, -1.6, -9.6, 3, 2, '#e3d6a8'); basin(b, 0.4, -8.6, '#e8a13a'); basin(b, 1.4, -8.6, '#e3c24a', 0.45); basin(b, 2.4, -8.6, '#b87a3c', 0.45);
    yams(b, 8, -8.6, 0); yams(b, 9.8, -8.6, 0); sacks(b, 6.4, -9.8, 3, 2, '#cdbf99');
    // Front rows: yams stacked at the edge of the lane, bags of beans, onion nets, a scale.
    yams(b, -11.8, 0.2, HALF); yams(b, -11.8, 1.6, HALF); sacks(b, -12.6, 3.8, 1, 3, '#d9cdaa'); sacks(b, -12.6, 5, 1, 3, '#cdbf99');
    parasol(b, -8.4, 5.4, { colors: ['#3f9a5a', '#f0e2c0'] }); basin(b, -8.4, 6.2, '#e07a2f'); basin(b, -7.4, 6.4, '#8f5a8a', 0.4); basin(b, -9.4, 6.4, '#d9482f', 0.4);
    parasol(b, 8.4, 4.6, { colors: ['#e9614b', WHITE] }); basin(b, 8.4, 5.4, '#e8a13a'); basin(b, 9.4, 5.6, '#5f9a48', 0.4); basin(b, 7.4, 5.6, '#d9482f', 0.4);
    b.box(6, 0.75, 1.6, 0.9, 0.1, 0.5, METAL); b.cyl(6, 0.4, 1.6, 0.06, 0.8, METAL_DARK, { seg: 5 }); b.ball(6.4, 1.0, 1.6, 0.2, 0.12, 0.2, '#d9482f', { seg: 5 });
    b.at(3.8, 0, 7.4, 0.5, () => { b.box(0, 0.62, 0, 1, 0.4, 1.5, '#4d7a8a'); b.ico(0, 0.92, 0, 0.42, 0.24, 0.6, '#a67c4a'); b.cyl(0, 0.3, 0.9, 0.3, 0.12, BLACK, { seg: 8, rz: HALF }); });
    signBoard(b, 10.6, 9.6, plain(label), { y: 2.8, size: fit(plain(label), 7.5, 0.4), color: '#f4e6b8', board: '#3a4f2f' });
    lampPost(b, -2.2, -4.6, { light: true }); lampPost(b, 5.6, 1.2);
    stringLights(b, [-12, 3.8, -6], [-2.2, 4.3, -5.6], { n: 8 }); stringLights(b, [-2.2, 4.3, -5.6], [12.4, 3.8, -6], { n: 10 });
    extra(b, 'food-trader', -8, -9.4, 0, 'work'); extra(b, 'food-yam', 9, -9.5, 0.2, 'stand'); extra(b, 'food-pepper', -8.4, 6.9, PI, 'sit', { seat: 0.4 }); extra(b, 'food-shopper', 0.6, -2.6, 2.6, 'walk');
    return {
      spots: [
        landmark('aisle', /aisle|food|price|foodstuff|produce|market|tomato|yam|rice/, -3.4, -5.6, PI),
        landmark('work', /work|staff|porter|job|shift|carry/, 3.8, 5.8, 0.6, { act: { pose: 'work' } }),
        landmark('yams', /yam|bean|garri/, -9.8, 1, -HALF),
        landmark('people', /people|crowd|meet/, 1.4, 3, 0),
      ],
      crowd: MARKET_CROWD,
    };
  },
};

/** Dugbe: a trading street with shopfronts, taxis and buses, and the tower of Cocoa House behind. */
function shopfront(b: Batch, x: number, w: number, h: number, wall: Colour, fascia: Colour, text: string, shutter: Colour): void {
  b.box(x, h / 2, -9.2, w, h, 3, wall);
  b.box(x, 2.6, -7.6, w, 0.7, 0.2, fascia);
  sign(b, x, 2.6, -7.48, text, { size: Math.min(0.4, fit(text, w - 0.6, 0.4)), color: WHITE });
  b.box(x, 1.2, -7.66, w - 0.8, 2, 0.1, shutter);
  b.box(x, h + 0.1, -9.2, w + 0.2, 0.2, 3.2, '#9a9482');
}
const street: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  walk: OUTDOORS,
  build(b, { label }) {
    ground(b, { w: 30, d: 26, color: '#c9bea6', edge: '#8f866f' });
    b.box(0, 0.04, 7.6, 30, 0.04, 5.6, '#4a4d52'); b.box(0, 0.05, 4.6, 30, 0.06, 0.4, '#b9b09a');
    for (let i = -6; i <= 6; i++) b.box(i * 2.3, 0.07, 7.6, 1.1, 0.02, 0.16, '#e6dfc8');
    // The tower of Cocoa House seen across the roofs, a block of shops, a second storey.
    slab(b, -9.4, -11.6, 4.6, 2.6, 2, 12, 11);
    const fascias = ['#2f6f4a', '#a14b3c', '#3f72c4', '#7a4a8e', '#c98a3c'];
    const names = ['PROVISIONS', 'FABRICS', 'PHONES', 'PHARMACY', 'HARDWARE'];
    const widths = [5.6, 5, 4.6, 5.2, 5.4];
    let x = -13.8;
    widths.forEach((w, i) => { shopfront(b, x + w / 2, w, 4.2 + (i % 2) * 1.2, WALLS[i % 4]!, fascias[i]!, names[i]!, ['#8a8f96', '#6b7a8a', '#a9743c'][i % 3]!); x += w; });
    for (const [px, pz] of ([[-5, -9], [4, -9], [10, -9]] as [number, number][])) b.box(px, 6, pz, 0.14, 0.14, 0.14, METAL);
    // Traffic: a bus, taxis, and traders on the pavement.
    bus(b, -7.6, 8.8, HALF, '#f0d070', '#a14b3c'); bus(b, 6.4, 6.6, -HALF, '#e8e2d0', '#2f6f4a');
    car(b, 0, 8.6, { ry: HALF, color: '#e8e4d8' }); car(b, 12, 8.8, { ry: HALF, color: '#d8a02a' }); car(b, -1.4, 6.5, { ry: -HALF, color: '#c9423a' });
    parasol(b, -6.6, -3.2, { colors: ['#e9614b', WHITE] }); basin(b, -6.6, -2.4, '#e8a13a'); basin(b, -5.6, -2.2, '#5f9a48', 0.4);
    parasol(b, 3.8, -3.4, { colors: ['#3f72c4', WHITE] }); b.box(3.8, 0.6, -2.4, 2, 0.1, 0.8, WOOD);
    for (let i = 0; i < 4; i++) b.box(3.1 + i * 0.5, 0.9, -2.4, 0.3, 0.5, 0.04, ['#c9423a', '#3f72c4', '#e0a43a', '#3f9a5a'][i]!);
    signBoard(b, 11, -2.6, plain(label), { y: 2.8, size: fit(plain(label), 7, 0.4), color: '#f4e6b8', board: '#2f3b36' });
    lampPost(b, -2.2, 3.6, { light: true }); lampPost(b, 8.2, 3.6); lampPost(b, -10.6, 3.6);
    stringLights(b, [-12.6, 4.2, -6.6], [-1.2, 4.6, -6.4], { n: 9 }); stringLights(b, [-1.2, 4.6, -6.4], [12.4, 4.2, -6.6], { n: 10 });
    house(b, 12.6, -11.6, 3.4, 3, 2.6, 1);
    extra(b, 'street-trader', -6.6, -3.8, 0, 'work'); extra(b, 'street-seller', 3.8, -3.8, 0.1, 'stand'); extra(b, 'street-shopper', 0.6, 1.6, 2.6, 'walk'); extra(b, 'street-clerk', -4, -6.4, 0.2, 'stand', { look: { body: 'woman', outfit: 'office', outfitColor: 'navy' } });
    return {
      spots: [
        landmark('arcade', /arcade|market|bargain|shop|buy|goods|household/, -1, -5.2, PI),
        landmark('work', /work|staff|porter|job|shift|carry/, 6.8, -1.4, 0.4, { act: { pose: 'work' } }),
        landmark('pavement', /pavement|trader|stall|street/, -6.6, -1.4, PI),
        landmark('people', /people|crowd|meet/, 1.4, 1.4, 0),
      ],
      crowd: [[2.8, 0.6, 0.5], [-0.6, 2.6, -0.4], [3.4, 2.6, 2.4], [-2.6, -0.8, 1.4], [-8, 1.2, PI], [-3.2, -3.6, PI], [7.6, 0.6, 2.6], [-8.2, 3, -HALF], [5.6, 3, 0.2], [-5.6, 1.6, 1], [9.6, 2.4, -0.8], [0.2, 3, 0.3]],
      spare: [[-4, 2.4], [0, 3], [4, 2.4], [2, 1.2]],
    };
  },
};

/** Gbagi: a cloth market of long counters, bolts of cloth and hanging indigo under rust roofs. */
function bolts(b: Batch, x: number, z: number, n: number, palette: Colour[]): void {
  for (let i = 0; i < n; i++) b.cyl(x + i * 0.42, 1.16, z, 0.17, 0.5, palette[i % palette.length]!, { seg: 7 });
  for (let i = 0; i < n; i++) b.cyl(x + i * 0.42, 1.6, z, 0.17, 0.4, palette[(i + 2) % palette.length]!, { seg: 7 });
}
const cloth: SceneDef = {
  mood: 'outdoor', accent: '#3f72c4',
  build(b, { label }) {
    marketGround(b, '#cdb584');
    const palette = ['#c9423a', '#3f72c4', '#e0a43a', '#3f9a5a', '#8055c2', '#dd6fa0', '#27437a'];
    roofed(b, -7.6, -8.2, 9.6, 4.4, 0); roofed(b, 4.2, -8.2, 9.6, 4.4, 2);
    for (const x of [-7.6, 4.2]) { table(b, x, -8.6, { w: 8.6, d: 1.1, h: 0.95, color: '#7a5c3c' }); bolts(b, x - 3.6, -8.6, 9, palette); }
    adire(b, -9.4, 2.6, -10.2, 2.4, 2.6); adire(b, -5.4, 2.6, -10.2, 2.4, 2.6, 0, '#8a3a2e', '#f1d9a0'); adire(b, 2.4, 2.6, -10.2, 2.4, 2.6, 0, '#2f6f5c', '#f1e6c8'); adire(b, 6, 2.6, -10.2, 2.4, 2.6);
    // Hanging cloth on a line across the lane; a second counter on the left of the lane.
    for (const side of [-1, 1]) b.box(side * 5.6, 2, 0.4, 0.14, 4, 0.14, WOOD_DARK);
    b.box(0, 3.95, 0.4, 11.4, 0.1, 0.1, WOOD_DARK);
    palette.forEach((c, i) => { b.box(-4.6 + i * 1.5, 3.1, 0.4, 0.9, 1.6, 0.05, c); b.quad(-4.6 + i * 1.5, 3.2, 0.44, 0.5, 0.2, i % 2 ? '#f1e6c8' : '#2f2a3a'); });
    b.at(-12, 0, 2, HALF, () => { table(b, 0, 0, { w: 7, d: 1.1, h: 0.95, color: '#7a5c3c' }); bolts(b, -2.8, 0, 7, palette.slice().reverse()); });
    // Mannequins in aso-oke, a tailor at a sewing machine, a wholesaler's stack of cartons.
    for (const [x, c] of ([[9.6, '#c9423a'], [11.2, '#27437a']] as [number, string][])) { b.cyl(x, 0.9, 1.4, 0.3, 1.5, c, { seg: 7, top: 0.7 }); b.ball(x, 1.85, 1.4, 0.22, 0.26, 0.22, '#b08a5c', { seg: 6 }); b.box(x, 0.06, 1.4, 0.8, 0.12, 0.8, '#8a6644'); }
    b.box(8, 0.7, 5.6, 1.6, 0.1, 0.9, WOOD_LIGHT); b.box(7.4, 0.4, 5.6, 0.1, 0.8, 0.8, METAL_DARK); b.box(8.6, 0.4, 5.6, 0.1, 0.8, 0.8, METAL_DARK); b.box(8, 0.95, 5.6, 0.5, 0.35, 0.3, '#2a2d33');
    stool(b, 8, 6.4, { h: 0.5 });
    for (let i = 0; i < 4; i++) crate(b, -10 + (i % 2) * 0.9, Math.floor(i / 2) * 0.62, 8.2, { s: 0.85, color: '#c9a56a' });
    signBoard(b, 10.8, 9.6, plain(label), { y: 2.8, size: fit(plain(label), 8, 0.4), color: '#f4e6b8', board: '#27437a' });
    lampPost(b, -1.2, 4.6, { light: true }); lampPost(b, 6.6, 3);
    stringLights(b, [-12.4, 3.7, 5.4], [-2.2, 4.4, 4.6], { n: 8 });
    extra(b, 'cloth-trader-1', -9, -9.7, 0, 'work'); extra(b, 'cloth-trader-2', 5, -9.7, 0.2, 'wave'); extra(b, 'cloth-tailor', 8, 6.2, PI, 'sit', { seat: 0.5 }); extra(b, 'cloth-shopper', 0.6, -2.6, 2.6, 'walk');
    return {
      spots: [
        landmark('cloth', /cloth|compare|fabric|aso|adire|ankara|lace|wholesale|market/, -1.8, -5.6, PI),
        landmark('work', /work|staff|porter|job|shift|carry/, 3.8, 6.2, 0.6, { act: { pose: 'work' } }),
        landmark('counter', /counter|row|buy|bargain|price/, -9.4, 2.4, -HALF),
        landmark('people', /people|crowd|meet/, 1.4, 3, 0),
      ],
      crowd: MARKET_CROWD,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// A landscaped garden: a pond with a footbridge, a pavilion, flower beds and a small stage.
const garden: SceneDef = {
  mood: 'outdoor', accent: '#e0a43a',
  build(b) {
    ground(b, { w: 30, d: 26, color: '#5f9a52', edge: '#3f6a3e' });
    // Paths, the pond at the left with a footbridge, a pavilion on the right.
    b.box(0, 0.04, 6.4, 3, 0.04, 12, '#e0cfa2'); b.box(1.4, 0.04, 0.4, 14, 0.04, 2.6, '#e0cfa2');
    b.cyl(-8.4, 0.03, -1.6, 5.4, 0.08, '#79c3df', { seg: 18, ...GLASS, sz: 0.7 }); b.cyl(-8.4, 0.01, -1.6, 5.9, 0.06, '#8a8f84', { seg: 18, sz: 0.74 });
    for (const z of [-1.2, -2.2]) for (const x of [-10.6, -6]) b.ico(x, 0.12, z, 0.45, 0.14, 0.4, '#8d8f8a');
    b.box(-8.4, 0.62, -1.6, 2.2, 0.18, 6.2, WOOD, { ry: HALF }); for (const s of [-1, 1]) b.box(-8.4, 1.1, -1.6 + s * 0.95 * 0, 0.1, 0.1, 0.1, WOOD_DARK);
    for (const s of [-1, 1]) { b.box(-8.4, 1.05, -1.6 + s * 1.0, 6.2, 0.08, 0.1, WOOD_DARK); for (let i = 0; i < 5; i++) b.box(-10.8 + i * 1.2, 0.8, -1.6 + s * 1.0, 0.1, 0.6, 0.1, WOOD_DARK); }
    b.at(9, 0, -3.4, 0, () => {
      for (const x of [-2, 2]) for (const z of [-1.6, 1.6]) b.cyl(x, 1.5, z, 0.14, 3, WHITE, { seg: 6 });
      b.cone(0, 3.9, 0, 3.2, 1.8, RUST[1]!, { seg: 6 }); b.cyl(0, 4.95, 0, 0.1, 0.5, '#7a4530', { seg: 5 });
      b.box(0, 0.12, 0, 4.6, 0.24, 3.8, '#d9cdaa');
      bench(b, 0, -1.3, { w: 3, back: true }); bench(b, 0, 1.3, { w: 3, back: true, ry: PI });
    });
    // A small stage with a backdrop, speakers and string lights.
    b.cyl(-1, 0.18, -8.6, 4, 0.36, '#cdb68a', { seg: 14, sz: 0.62 });
    b.box(-1, 2, -10.6, 7.6, 3.4, 0.2, '#2f4a3a'); b.box(-1, 3.8, -10.6, 8, 0.2, 0.3, '#e0a43a');
    for (const s of [-1, 1]) b.box(-1 + s * 3.4, 0.9, -8.4, 0.9, 1.6, 0.7, '#26282d');
    stringLights(b, [-4.6, 3.5, -8], [2.6, 3.5, -8], { n: 8, sag: 0.4 });
    extra(b, 'garden-singer', -1, -8.8, 0.2, 'wave', { y: 0.36, look: { body: 'woman', outfit: 'dress', outfitColor: 'orange' } });
    // Flower beds, palms, shrubs.
    for (const [x, z] of ([[-3.2, 7.8], [3.4, 7.8], [-3.4, 1.8], [6.4, 4.6], [-12.6, 6.2]] as [number, number][])) { b.box(x, 0.15, z, 2.6, 0.3, 1.6, '#7a5a3c'); for (let i = 0; i < 5; i++) b.ico(x - 1 + i * 0.5, 0.45, z + (i % 2) * 0.3 - 0.15, 0.24, 0.2, 0.24, ['#e9614b', '#e8c43a', '#dd6fa0', '#f1efe8', '#8055c2'][i]!); }
    for (const [x, z, s] of ([[-12, -8, 1.1], [12.4, -8.6, 1.05], [-12.8, 1.6, 0.95], [13, 5, 1], [-6, 8.8, 0.9]] as [number, number, number][])) palm(b, x, z, { s });
    leafTree(b, 6.6, -9.4, { s: 1.1, tone: 1 }); leafTree(b, 11, 9, { s: 1, tone: 0 }); leafTree(b, -13, 9.6, { s: 1, tone: 2 }); bush(b, 4.8, 9.8, { s: 1.2 });
    bench(b, 3.2, 3.6, { back: true, ry: PI }); lampPost(b, -2, 4.6, { light: true }); lampPost(b, 2, 9.6); lampPost(b, 5.8, -0.6);
    extra(b, 'garden-family', 7.6, 3, -2.4, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange' } });
    return {
      spots: [
        landmark('garden', /garden|lawn|ayo|play|game|walk/, 0.4, 5.6, 0),
        landmark('stage', /stage|set|music|band|evening|listen/, -1, -5.4, 0),
        landmark('pavilion', /pavilion|shade|rest|bench|sit/, 6.4, -1, -HALF),
        landmark('work', /work|staff|office|job|shift/, -5, 6.4, 0.6),
        landmark('people', /people|crowd|meet/, 4.6, 7.4, 0),
      ],
      crowd: [[2, 8.4, 0.4], [-1.2, 8.8, -0.5], [5.8, 6.6, 2.4], [-5.2, 6.8, 1.2], [-2.8, -3.6, 0], [3.4, -4.8, -0.2], [8.8, 1.6, 1.6], [-8.8, 6.4, 0.8], [1.6, 2.4, 2.8], [9.6, 8.6, -0.6], [-0.4, -6, 0.4], [6.6, -6.4, 0.4]],
      spare: [[-4, 8.6], [2.4, 6.2], [-1, 10.4], [3.4, 9.8]],
    };
  },
};

/** Variant scenes by scene kind, then by variant (venue.scene.variant). */
export const VARIANTS: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = Object.freeze({
  office: { tower, campus },
  statehouse: { 'hill-hall': hillHall },
  viewing: { stadium },
  walk: { gallery, forest },
  hub: { 'bus-park': busPark, rail },
  market: { foodstuff, street, cloth },
  park: { garden },
});
