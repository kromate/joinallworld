/**
 * OWNER: scenes
 * Signature scenes of Ogun State's cities, each asked for through `scene.variant` (CitySceneVariant) and held in
 * VARIANTS[kind][variant] like the variants of src/scene/venues-ibadan-b.ts:
 *
 *   rooftop / outcrop          a granite outcrop with carved steps, cave mouths, an old forest tree and the roofs far below
 *   market / adire             a cloth yard: indigo and white resist-dyed cloth on lines, dye vats, women's stalls
 *   statehouse / palace-court  a colonial-era palace frontage over a wide forecourt, a beaded-crown emblem, a drummers' bench
 *   statehouse / ojude-ground  an open palace ground on festival day: age-grade banners and umbrellas, a raised dais, horses
 *   walk / hall                a civic hall with a portico and a plaque, on a lawn with a memorial pillar
 *   walk / library             a modern library complex: a stepped museum with a dome, an archive wing and a garden
 *   park / river-bridge        a river under a steel and concrete bridge, rocks, a fisher's canoe
 *   worship / cathedral        a stone church with a square tower in a churchyard
 *   worship / mosque-court     a white mosque with a minaret and dome around a washing court
 *
 * Every sign is drawn from the venue's own label (context.label) or is a plain word; nothing here names a place.
 * Scenes are static: roofs, hills and far trees are baked boxes and blobs. Scene definition format: see venues-outdoor.ts.
 * The helpers at the top are shared with src/scene/venues-ogun-b.ts.
 */
import { GLOW, GLASS } from './build.ts';
import type { Batch, Colour, SceneCamera, SceneDef, SceneWalkSpec } from './types.ts';
import {
  ground, bench, chair, leafTree, tallTree, palm, bush, lampPost, kiosk, flag, parasol, stringLights, fence, windowPane, sign, signBoard,
  landmark, extra, table, car, crate, plant, textWidth,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF, LEAF_DARK, WARM,
} from './props.ts';

export const PI = Math.PI, HALF = Math.PI / 2;
export const OPEN: SceneWalkSpec = { bounds: [-14.2, -12.2, 14.2, 12.2], entrance: [0, 11.4], open: true };

/** A small deterministic generator, so a scene is the same every time it is built. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
/** Block lettering has only capitals, digits and a few marks: a label is cleaned to those. */
export const plain = (label: string): string => label.replace(/['’]s\b/gi, '').replace(/[’']/g, '').replace(/[^A-Za-z0-9 .\-]/g, ' ').replace(/\s+/g, ' ').trim();
/** The largest letter height (at most `max`) at which a label fits `width`. */
export const fit = (label: string, width: number, max: number): number => Math.min(max, (width * 5) / Math.max(1, label.length * 4 - 1));
/** A sign on a board that fits the label, centred on x. */
export function labelled(b: Batch, label: string, x: number, y: number, z: number, width: number, max: number, color: Colour, board: Colour, lit = false, ry = 0): void {
  const text = plain(label);
  sign(b, x, y, z, text, { size: fit(text, width, max), color, board, lit, pad: 0.22, ry });
}
/** The shared crowd of the open front of a scene. */
export const FRONT_CROWD: [number, number, number][] = [[2.4, 7.4, 0.4], [-2.4, 7.6, -0.5], [7.6, 6.2, 2.4], [-6, 6.6, 1.2], [8.6, 8.8, -0.8], [-8.4, 9, 0.8], [3, 10.4, 2.8], [-5.2, 10.2, 2.4], [-11, 7.4, 1.6], [11, 9.6, -0.4], [0.2, 9, 3.1], [5.4, 4.6, 0.6]];
export const FRONT_SPARE: [number, number][] = [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]];

export const RUST: readonly Colour[] = ['#9b5a3a', '#a8653f', '#8a4e34', '#b0704a'];
/** A gable roof of two tilted slabs over a w by d footprint, its eaves at height y. */
export function gable(b: Batch, x: number, y: number, z: number, w: number, d: number, tone = 0, a = 0.4): void {
  const slope = d / 2 / Math.cos(a) + 0.2, rise = Math.tan(a) * d / 4 + 0.04;
  b.box(x, y + rise, z - d / 4, w + 0.5, 0.14, slope, RUST[tone % 4]!, { rx: -a });
  b.box(x, y + rise, z + d / 4, w + 0.5, 0.14, slope, RUST[(tone + 2) % 4]!, { rx: a });
  b.box(x, y + rise * 2 + 0.06, z, w + 0.56, 0.14, 0.3, '#7a4530');
}
/** A small house under a rust-brown roof. */
export function house(b: Batch, x: number, z: number, w: number, d: number, h: number, tone: number, ry = 0, wall: Colour = '#e0d3b6'): void {
  b.at(x, 0, z, ry, () => {
    b.box(0, h / 2, 0, w, h, d, wall);
    gable(b, 0, h, 0, w, d, tone);
    b.box(-w / 4, h * 0.55, d / 2 + 0.02, 0.5, 0.55, 0.04, '#5d7488');
    b.box(w / 4, 0.6, d / 2 + 0.02, 0.6, 1.2, 0.04, '#6b4a30');
  });
}
/** A flat-topped, corrugated iron shed on posts. */
export function shed(b: Batch, x: number, z: number, w: number, d: number, tone = 0, h = 3.1): void {
  for (const sx of [-1, 1]) { b.box(x + sx * (w / 2 - 0.1), h / 2, z + d / 2 - 0.1, 0.12, h, 0.12, WOOD_DARK); b.box(x + sx * (w / 2 - 0.1), (h + 0.5) / 2, z - d / 2 + 0.1, 0.12, h + 0.5, 0.12, WOOD_DARK); }
  b.box(x, h + 0.3, z, w + 0.5, 0.12, d + 0.5, RUST[tone % 4]!, { rx: 0.14 });
  for (let i = 0; i < Math.round(w / 0.7); i++) b.box(x - w / 2 + 0.35 + i * 0.7, h + 0.38, z, 0.06, 0.06, d + 0.5, '#7a4530', { rx: 0.14 });
}
/** Grass and loose rock around a scene's edge. */
export function boulder(b: Batch, x: number, y: number, z: number, r: number, tone = 0): void {
  b.ico(x, y + r * 0.5, z, r * 1.2, r * 0.8, r, ['#8d8883', '#9c958d', '#7c7873', '#a59d94'][tone % 4]!);
}
/** An hourglass-shaped talking drum standing on the ground. */
export function drum(b: Batch, x: number, z: number, colour: Colour = '#6a3f27'): void {
  b.cyl(x, 0.28, z, 0.34, 0.56, colour, { seg: 8, top: 0.45 });
  b.cyl(x, 0.78, z, 0.15, 0.5, colour, { seg: 8, top: 2.3 });
  b.disc(x, 1.04, z, 0.34, '#e8d9b0', { seg: 8 });
  b.disc(x, 0.04, z, 0.38, '#e8d9b0', { seg: 8 });
}
/** A horse standing, drawn as simple blocks: a static prop. */
export function horse(b: Batch, x: number, z: number, ry: number, coat: Colour, blanket: Colour): void {
  b.at(x, 0, z, ry, () => {
    b.ball(0, 1.5, 0, 0.55, 0.62, 1.15, coat, { seg: 7 });
    b.box(0, 2.15, 1.0, 0.36, 1.0, 0.5, coat, { rx: 0.6 });
    b.ball(0, 2.7, 1.45, 0.24, 0.26, 0.5, coat, { seg: 6 });
    b.box(0, 3.0, 1.2, 0.08, 0.34, 0.5, '#2f2420');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.3, 0.7, sz * 0.8, 0.2, 1.4, 0.2, coat);
    b.box(0, 1.5, -1.2, 0.12, 0.9, 0.18, '#2f2420', { rx: -0.3 });
    b.box(0, 2.16, 0, 1.2, 0.08, 1.1, blanket);
    b.box(0, 2.0, 0, 0.16, 0.5, 1.0, blanket);
  });
}
/** A bolt of resist-dyed cloth hung flat: an indigo ground with white motifs. Pattern 0..3 differ. */
export function adireCloth(b: Batch, x: number, y: number, z: number, w: number, h: number, pattern: number, ry = 0, base: Colour = '#233c7c', motif: Colour = '#eae4d0'): void {
  b.at(x, y, z, ry, () => {
    b.quad(0, 0, 0, w, h, base);
    b.quad(0, h / 2 - 0.08, 0.012, w, 0.1, motif); b.quad(0, -h / 2 + 0.08, 0.012, w, 0.1, motif);
    const p = ((pattern % 4) + 4) % 4;
    if (p === 0) { for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) b.quad(-w * 0.375 + i * w * 0.25, -h * 0.36 + j * h * 0.18, 0.014, w * 0.2, h * 0.14, motif); }
    else if (p === 1) { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) b.quad(-w / 3 + i * w / 3, -h / 3 + j * h / 3, 0.014, w * 0.2, w * 0.2, motif, { rz: PI / 4 }); }
    else if (p === 2) { for (let i = 0; i < 5; i++) b.quad(-w * 0.4 + i * w * 0.2, 0, 0.014, w * 0.07, h * 0.8, i % 2 ? '#6f8fc7' : motif); }
    else { for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) { b.quad(-w / 3 + i * w / 3, -h * 0.34 + j * h * 0.23, 0.014, w * 0.17, w * 0.17, motif, { rz: PI / 4 }); b.quad(-w / 3 + i * w / 3, -h * 0.34 + j * h * 0.23, 0.016, w * 0.07, w * 0.07, '#6f8fc7'); } }
  });
}
/** A beaded crown: a conical crown ringed with bead strands, its brim gold, topped with a small bird. */
export function beadedCrown(b: Batch, x: number, y: number, z: number, s: number): void {
  b.at(x, y, z, 0, () => {
    b.cyl(0, 0.15, 0, 1.05, 0.3, '#d6a83a', { seg: 10 });
    b.cyl(0, 1.2, 0, 0.98, 1.9, '#2a4fa6', { seg: 10, top: 0.35 });
    for (let r = 0; r < 3; r++) b.cyl(0, 0.55 + r * 0.55, 0, 1.0 - r * 0.22, 0.12, r % 2 ? '#eae4d0' : '#d6a83a', { seg: 10 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * PI * 2;
      for (let k = 0; k < 3; k++) b.ball(Math.sin(a) * 1.04, -0.05 - k * 0.3, Math.cos(a) * 1.04, 0.1, 0.1, 0.1, (i + k) % 2 ? '#d6a83a' : '#c9423a', { seg: 4 });
    }
    b.ball(0, 2.35, 0, 0.18, 0.26, 0.18, '#d6a83a', { seg: 5 });
    b.box(0, 2.58, 0, 0.5, 0.1, 0.1, '#d6a83a'); b.box(0, 2.58, 0, 0.1, 0.1, 0.5, '#d6a83a');
  }, 0, 0, s);
}
/** Seeded far roofs for a drop below a viewing ledge: rows of walls under rust roofs, stepping down and away. */
export function roofTown(b: Batch, steps: [number, number, number][], left: number, right: number, rand: () => number, skip?: (x: number, z: number) => boolean): void {
  const roofs: Colour[] = ['#8d4a2c', '#9b5532', '#7b4430', '#a65f3a', '#6f3f2d', '#b06a3f', '#84432b', '#94512f', '#a9a7a0', '#c4bba8'];
  steps.forEach(([far, near, y], step) => {
    const width = right - left, mid = (left + right) / 2;
    b.box(mid, y - 4, (far + near) / 2, width, 8, near - far, step % 2 ? '#9a6a46' : '#a8714b');
    b.box(mid, y - 0.02, (far + near) / 2, width, 0.05, near - far - 0.2, step % 2 ? '#8f6540' : '#9c6a46');
    const rows = Math.floor((near - far - 1.4) / 3.6);
    for (let r = 0; r < rows; r++) {
      const z = near - 1.4 - r * 3.6 - rand() * 0.6;
      for (let x = left + 2; x < right - 1; x += 4.8) {
        if (rand() < 0.12 || (Math.round(x / 4.8) + r + step) % 6 === 0 || skip?.(x, z)) continue;
        const cx = x + rand() * 0.9, w = 2.2 + rand() * 1.5, d = 2 + rand() * 1.1, h = 1 + rand() * 0.6;
        const turn = (rand() - 0.5) * 0.4, tone = roofs[Math.floor(rand() * roofs.length)]!;
        b.at(cx, y, z, turn, () => {
          if (step < 2) b.box(0, h / 2, 0, w, h, d, '#d9c9a8');
          for (const side of [-1, 1]) b.box(0, h + 0.28, side * d * 0.25, w + 0.3, 0.1, d * 0.62, tone, { rx: side * 0.42 });
        });
      }
    }
    for (let i = 0; i < 4; i++) b.ico(left + 3 + rand() * (width - 6), y + 0.9, near - 1 - rand() * (near - far - 2), 1 + rand() * 0.5, 1.1, 1 + rand() * 0.5, rand() < 0.5 ? '#4f8a45' : '#3d7a4a');
  });
}
/** A low white parapet wall with piers along a drop. */
function ledgeWall(b: Batch, x0: number, x1: number, z: number, tone: Colour, cap: Colour): void {
  const w = x1 - x0, cx = (x0 + x1) / 2;
  b.box(cx, 0.45, z, w, 0.9, 0.46, tone); b.box(cx, 0.95, z, w + 0.2, 0.12, 0.62, cap);
  for (let x = x0 + 0.6; x <= x1 - 0.5; x += 4.4) b.box(x, 0.7, z, 0.7, 1.4, 0.7, tone);
}
export const LOOK_WOMAN = (colour: string, extra2: Record<string, unknown> = {}) => ({ body: 'woman', outfit: 'kaftan', outfitColor: colour, ...extra2 });

// ---------------------------------------------------------------------------------------------
// Rock outcrop: the viewing terrace at the foot of a granite outcrop. Carved steps wind up the face in three flights to a
// summit terrace with a railing and a shelter; cave mouths open at the base, an old forest tree grows on a rock shelf, and
// the plaza ends in a railing over a sheer drop to the roofs, the river and the hills far below.

const GRANITE = ['#a79f94', '#b4ab9e', '#968f85', '#bfb6a8', '#8c857b'];
const FLOOR_Y = -7.6;

/** A smooth granite swell: a sphere clipped by the ground below, so that it reads as one rounded rock rather than as facets. */
function swell(b: Batch, x: number, y: number, z: number, rx: number, ry: number, rz: number, tone: number): void {
  b.ball(x, y, z, rx, ry, rz, GRANITE[tone % GRANITE.length]!, { seg: 7 });
}

/** The rock itself: a massive stepped body under the flights and rounded swells that soften it into an outcrop. */
function rockBody(b: Batch, rand: () => number): void {
  // The solid core under the three flights, in jointed slabs
  b.box(-8.4, 1.5, -8.2, 12.8, 3.0, 5.6, '#9a9389');
  b.box(-6.6, 4.5, -9.2, 9.4, 3.0, 3.6, '#a29a8f');
  // Rounded shoulders and a crest, left, right and behind
  const swells: [number, number, number, number, number, number][] = [
    [-15.4, 3, -7.2, 5.2, 7, 6.2], [-11, 9.4, -13.6, 6.4, 4.6, 4.4], [-4.8, 7, -14, 5.6, 6, 4.4], [-15, 8, -13, 4.6, 5.6, 4.2],
    [1.6, 2.6, -9.8, 3.4, 3.6, 3.4], [-0.4, 5.2, -12, 4, 4, 3.6],
  ];
  swells.forEach(([x, y, z, rx, ry, rz], i) => swell(b, x, y, z, rx, ry, rz, i));
  // Dark water streaks down the slabs and tufts of green in the cracks
  for (let i = 0; i < 26; i++) {
    const x = -14 + rand() * 12, y = 1 + rand() * 9, z = -3.7 - rand() * 0.2;
    if (rand() < 0.5) b.quad(x, y, -4.62 - rand() * 0.2, 0.14 + rand() * 0.2, 0.8 + rand() * 1.6, '#5e5a54'); else b.quad(x, y, z - 2 - rand() * 3, 0.14 + rand() * 0.2, 0.8 + rand() * 1.6, '#5e5a54');
  }
  for (const [x, y, z, r] of ([[-13, 3.3, -3.9, 0.7], [-1.4, 6.2, -5.4, 0.6], [-12.6, 6.4, -6.2, 0.8], [-7.8, 9, -7.6, 0.5], [0.4, 4.4, -7.8, 0.9]] as [number, number, number, number][])) {
    b.ico(x, y + r * 0.4, z, r * 1.2, r * 0.7, r, '#4f7a46'); b.ico(x + r, y + r * 0.3, z + 0.2, r * 0.7, r * 0.5, r * 0.6, '#6b9a50');
  }
}

/** One straight flight of carved steps. They climb from (x0, y0) to (x1, y1) along z and stand on a solid wall of rock. */
function flight(b: Batch, x0: number, y0: number, x1: number, y1: number, z: number, d: number, n: number): void {
  const dx = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const y = y0 + ((i + 1) * (y1 - y0)) / n, cx = x0 + (i + 0.5) * dx;
    b.box(cx, y / 2 - 0.02, z, Math.abs(dx) + 0.01, y, d, i % 2 ? '#c9c1b2' : '#d8d0c1');
  }
}
/** An iron railing along a slope or a level, with posts. */
function railing(b: Batch, x0: number, y0: number, x1: number, y1: number, z: number, h = 1.1, tone: Colour = METAL_DARK): void {
  const run = x1 - x0, rise = y1 - y0, length = Math.hypot(run, rise), posts = Math.max(2, Math.round(length / 2.4) + 1);
  for (let i = 0; i < posts; i++) { const t = i / (posts - 1); b.box(x0 + run * t, y0 + rise * t + h / 2, z, 0.08, h, 0.08, tone); }
  const rz = Math.atan2(rise, run);
  b.box((x0 + x1) / 2, (y0 + y1) / 2 + h, z, length, 0.07, 0.09, tone, { rz });
  b.box((x0 + x1) / 2, (y0 + y1) / 2 + h * 0.5, z, length, 0.05, 0.06, tone, { rz });
}
function carvedSteps(b: Batch): void {
  // First flight along the foot, rising left to a landing; the second doubles back right; the third climbs left to the summit
  flight(b, -2.4, 0, -9.6, 3, -4.7, 1.8, 12);
  b.box(-12, 1.48, -4.7, 4.6, 3, 1.8, '#a8a095'); b.box(-12, 3.02, -4.7, 4.7, 0.07, 1.9, '#e0d8c9');
  flight(b, -9.6, 3, -2.6, 6, -6.5, 1.8, 12);
  b.box(-1.2, 2.98, -6.5, 2.6, 6, 1.8, '#a8a095'); b.box(-1.2, 6.02, -6.5, 2.7, 0.07, 1.9, '#e0d8c9');
  flight(b, -2.6, 6, -9.6, 9, -8.4, 1.8, 12);
  // The summit terrace
  b.box(-9.4, 4.5, -11.2, 11.6, 9, 4.2, '#a29a8f'); b.box(-9, 9.02, -11.2, 11.8, 0.1, 4.3, '#cfc7b8');
  for (let i = 0; i < 5; i++) b.box(-14.4 + i * 1.7, 9.04, -9.0, 0.02, 0.02, 4.1, '#b3ab9d');
  // Railings: along each flight, across the top terrace, round the landings
  railing(b, -2.4, 0, -9.6, 3, -3.8, 1.0);
  railing(b, -14.2, 3, -9.6, 3, -3.8, 1.0); b.box(-14.3, 3.5, -4.7, 0.08, 1, 1.8, METAL_DARK);
  railing(b, -9.6, 3, -2.6, 6, -5.6, 1.0);
  railing(b, -2.6, 6, 0.1, 6, -5.6, 1.0); railing(b, 0.1, 6, 0.1, 6, -7.4, 1.0);
  railing(b, -2.6, 6, -9.6, 9, -7.5, 1.0);
  railing(b, -14.4, 9, -2.7, 9, -9.2, 1.15);
}

function caveMouth(b: Batch, x: number, z: number, s: number, y = 0): void {
  // A dark opening under an overhanging slab, a worn threshold, and a stone lintel with rubble
  b.at(x, y, z, 0, () => {
    b.ball(0, 0.9 * s, 0.1, 1.15 * s, 1.2 * s, 0.7, '#14110e', { seg: 7 });
    b.ico(0, 2.15 * s, 0.1, 1.5 * s, 0.5 * s, 0.9, '#b4ab9e');
    b.ico(-1.5 * s, 0.5, 0.35, 0.7, 0.6, 0.6, '#968f85'); b.ico(1.4 * s, 0.4, 0.45, 0.6, 0.5, 0.5, '#a79f94');
  });
}

/** The old forest tree: a buttressed iroko with a broad crown, growing on a ledge of rock. */
function irokoTree(b: Batch, x: number, y: number, z: number, s = 1): void {
  b.at(x, y, z, 0, () => {
    b.cyl(0, 4.2, 0, 1, 8.4, '#5e5446', { seg: 8, top: 0.7 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2 + 0.3; b.box(Math.sin(a) * 0.95, 0.9, Math.cos(a) * 0.95, 0.3, 1.9, 1.5, '#5e5446', { ry: a, rx: 0.12 }); }
    for (const [dx, dy, dz, r, c] of ([[0, 10, 0, 3.8, '#2f6f46'], [-3.2, 9.2, 1.2, 3, '#3d7a4a'], [3.4, 9.4, -0.6, 3.2, '#2c6540'], [0.8, 12, 0.2, 2.8, '#4d8a4d'], [-1.4, 11.4, -1.8, 2.8, '#35704a'], [1.8, 8.6, 2.4, 2.5, '#478048'], [-0.4, 8.2, -2.6, 2.4, '#2f6f46']] as [number, number, number, number, Colour][])) b.ico(dx, dy, dz, r, r * 0.72, r, c);
    b.cyl(-0.3, 7, 0.3, 0.22, 3, '#5e5446', { seg: 4, rz: 0.7 });
  }, 0, 0, s);
}

/** Roofs of the old town spread over the hillside far below the terrace, with a few towers and trees among them. */
function valley(b: Batch, rand: () => number): void {
  const roofs: Colour[] = ['#8d4a2c', '#9b5532', '#7b4430', '#a65f3a', '#6f3f2d', '#b06a3f', '#84432b', '#94512f', '#a9a7a0', '#c4bba8'];
  // The valley floor and the far hills
  b.box(0, FLOOR_Y - 3, -10, 140, 6, 120, '#6f6648');
  b.box(0, FLOOR_Y + 0.02, -10, 140, 0.1, 120, '#7e8a58');
  // The river: a brown-green ribbon winding through the valley on the right
  const riverX = (z: number): number => 30 + Math.sin(z * 0.09) * 5 - z * 0.12;
  for (let z = 48; z > -64; z -= 8) { const a = Math.atan2(riverX(z - 8) - riverX(z), -8); b.box(riverX(z - 4), FLOOR_Y + 0.07, z - 4, 4.8, 0.06, 9.4, '#5d6f4a', { ry: -a - PI / 2 + PI / 2 }); }
  // Blocks of rust roofs with the streets between them, thickest behind the rock where the terrace looks out, thinner at its sides
  for (let gx = -32; gx <= 50; gx += 4.6) {
    for (let gz = -32; gz <= 30; gz += 4.2) {
      const behind = gz < -9;
      if (!behind && gx > -22 && gx < 24) continue;
      if (Math.abs(gx - riverX(gz)) < 4.4) continue;
      if (rand() < (behind ? 0.4 : 0.66)) continue;
      const x = gx + (rand() - 0.5) * 0.8, z = gz + (rand() - 0.5) * 0.8, w = 3.2 + rand() * 1.1, d = 2.8 + rand() * 0.9, ry = (rand() - 0.5) * 0.35;
      const tone = roofs[Math.floor(rand() * roofs.length)]!;
      b.at(x, FLOOR_Y, z, ry, () => {
        b.box(0, 0.5, 0, w, 1, d, tone, { rx: 0.06 });
        b.quad(0, 1.05, -d * 0.18, w * 0.96, 0.14, '#6a3f2d', { rx: -HALF }); b.quad(0, 1.05, d * 0.18, w * 0.96, 0.14, '#6a3f2d', { rx: -HALF });
      });
    }
  }
  // The far town, in larger blocks so that fewer will do
  for (let gx = -52; gx <= 64; gx += 7.2) {
    for (let gz = -74; gz <= -35; gz += 6.4) {
      if (Math.abs(gx - riverX(gz)) < 5 || rand() < 0.5) continue;
      const x = gx + (rand() - 0.5) * 1.2, z = gz + (rand() - 0.5) * 1.2, w = 5.2 + rand() * 1.6, d = 4.4 + rand() * 1.2, tone = roofs[Math.floor(rand() * roofs.length)]!;
      b.at(x, FLOOR_Y, z, (rand() - 0.5) * 0.35, () => { b.box(0, 0.6, 0, w, 1.2, d, tone, { rx: 0.06 }); b.quad(0, 1.25, 0, w * 0.96, 0.18, '#6a3f2d', { rx: -HALF }); });
    }
  }
  for (let i = 0; i < 9; i++) { const x = -30 + rand() * 80, z = -8 - rand() * 50; if (Math.abs(x - riverX(z)) < 3.4) continue; b.ico(x, FLOOR_Y + 1, z, 1.2 + rand() * 0.6, 1.3, 1.2 + rand() * 0.6, rand() < 0.5 ? '#4f8a45' : '#3d7a4a'); }
  // A minaret and a church tower among the roofs
  b.cyl(18, FLOOR_Y + 2.8, -34, 0.3, 5.6, '#e9e1cd', { seg: 8 }); b.cone(18, FLOOR_Y + 6.1, -34, 0.45, 1, '#2f8f6a', { seg: 8 });
  b.box(-6, FLOOR_Y + 2.2, -42, 1.8, 4.4, 1.8, '#d9d0bc'); b.cone(-6, FLOOR_Y + 5.5, -42, 1.2, 1.5, '#8d4a2c', { seg: 4, ry: PI / 4 });
  ([[-46, -22, 8, '#6f8f66'], [-40, -4, 6, '#7a9a6a'], [30, -64, 12, '#6f8f72'], [4, -68, 9, '#7c9a82'], [-24, -66, 12, '#6c8c6e'], [-48, -50, 10, '#7a9a80'], [56, -56, 9, '#7a9a80']] as [number, number, number, Colour][]).forEach(([x, z, h, c]) => b.ball(x, FLOOR_Y + h * 0.1, z, 18, h, 11, c, { seg: 6 }));
}

const outcrop: SceneDef = {
  mood: 'outdoor', accent: '#e8b04a',
  camera: { landscape: [19, 29, 36], portrait: [18, 38, 48] },
  walk: { bounds: [-12.4, -3.4, 12.4, 11.2], entrance: [0, 10.6], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(23);
    // The terrace: a slab of grey granite on a cliff whose foot spreads out in a steep apron of jointed rock
    b.box(0, -3.9, 3.6, 28, 7.7, 17, '#8a8379');
    b.box(0, -0.02, 3.6, 28.2, 0.12, 17.2, '#b3aa9d');
    const slope = Math.atan2(7.6, 3.6), length = Math.hypot(7.6, 3.6);
    b.at(0, -3.8, 12.2 + 1.8, 0, () => {
      b.box(0, 0, 0, 33, 0.9, length, '#9a9387');
      for (let i = 0; i < 4; i++) b.box(0, 0.47, -3.2 + i * 2.2 + rand() * 0.4, 33, 0.04, 0.3, '#7d776d');
      for (let i = 0; i < 12; i++) b.quad(-15 + rand() * 30, 0.48, -3.6 + rand() * 7, 0.18 + rand() * 0.2, 1 + rand() * 2, '#5e5a54', { rx: -HALF });
    }, slope);
    b.at(14.2 + 1.8, -3.8, 3.6, 0, () => {
      b.box(0, 0, 0, length, 0.9, 20, '#a29b8f');
      for (let i = 0; i < 4; i++) b.box(-3.2 + i * 2.2 + rand() * 0.4, 0.47, 0, 0.3, 0.04, 20, '#847e74');
      for (let i = 0; i < 10; i++) b.quad(-3.6 + rand() * 7, 0.48, -8 + rand() * 16, 0.18 + rand() * 0.2, 1 + rand() * 2, '#5e5a54', { rx: -HALF, rz: HALF });
    }, 0, -slope);
    for (let x = -11; x <= 11; x += 4.4) b.box(x + rand(), 0.04, 3.6, 0.06, 0.02, 16, '#968f84');
    for (const [x, z, r] of ([[6, 5, 2.4], [-3, 7.6, 1.8], [9.6, 9, 1.6], [-8.6, 3, 1.4]] as [number, number, number][])) b.disc(x, 0.05, z, r, '#c4bcae', { seg: 9, sz: 0.7 });
    // Boulders at the foot of the apron
    for (const [x, y, z, r] of ([[-4, -6.2, 16.6, 1.5], [18.4, -6.2, 9, 1.6]] as [number, number, number, number][])) swell(b, x, y, z, r * 1.2, r, r * 1.1, 4 + (Math.round(x) & 1));
    valley(b, rand);
    rockBody(b, rand);
    carvedSteps(b);
    caveMouth(b, -12.2, -3.9, 1.1); caveMouth(b, -1.4, -3.9, 0.85);
    caveMouth(b, -6.4, -5.6, 0.8, 3); // a low opening beside the second flight
    // The summit terrace: a shelter on posts, a flag, a sign and a couple of climbers
    b.at(-6.8, 9, -11, 0, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 1.9, 1.4, sz * 0.9, 0.14, 2.8, 0.14, WOOD_DARK);
      for (const side of [-1, 1]) b.box(0, 3.05, side * 0.55, 4.6, 0.12, 1.5, side < 0 ? '#a8653f' : '#9b5a3a', { rx: side * 0.3 });
      b.box(0, 3.4, 0, 4.6, 0.1, 0.18, '#7a4530');
      bench(b, 0, -0.4, { w: 2.8, ry: 0, back: false, color: '#8a6644', leg: '#5f4630' });
    });
    b.at(-12.2, 9, -10.4, 0, () => flag(b, 0, 0, { h: 4.6, w: 1.5, colors: ['#2f8f55', WHITE, '#2f8f55'] }));
    b.at(-3.8, 9, -10.4, 0, () => { b.box(0, 0.4, 0, 0.5, 0.8, 0.5, '#8d887a'); b.cyl(0.2, 1.1, 0, 0.07, 0.5, METAL_DARK, { seg: 4 }); b.box(0.2, 1.45, 0, 0.3, 0.25, 0.5, METAL_DARK); });
    extra(b, 'rock-climber-2', -4.6, -6.5, PI, 'walk', { y: 5.1, look: { body: 'man', outfit: 'casual', outfitColor: 'blue' } });
    // The old iroko on a rock shelf at the right, its roots over the stone, the drop railing beside it
    b.box(12.2, 0.3, -2.4, 3.6, 0.8, 3.6, '#a79f94'); swell(b, 12.4, 0.2, -3.2, 2.2, 1.1, 1.8, 3);
    irokoTree(b, 12.2, 0.7, -2, 0.66);
    // The viewing terrace: an iron railing along the drop, a coin telescope, a bench facing the view
    railing(b, 1.2, 0, 10.2, 0, -4.4, 1.15); railing(b, 13.7, 0, 13.7, 0, -4.4, 1.15);
    for (let z = -4.4; z < 8; z += 1.6) b.box(13.7, 0.58, z, 0.08, 1.15, 0.08, METAL_DARK);
    b.box(13.7, 1.15, 1.8, 0.09, 0.07, 12.4, METAL_DARK); b.box(13.7, 0.58, 1.8, 0.06, 0.05, 12.4, METAL_DARK);
    b.box(7.4, 0.95, -3.4, 0.3, 0.9, 0.3, '#34413f'); b.box(7.4, 1.55, -3.4, 0.9, 0.34, 0.34, '#34413f', { rz: 0.3 });
    // A plaque with the venue's own name at the foot of the steps
    b.box(-0.8, 0.35, 2.2, 3.6, 0.7, 0.5, '#8d887a');
    sign(b, -0.8, 0.38, 2.48, label, { size: fit(label, 3.2, 0.3), color: '#f1e6c4', board: '#2f3b36', pad: 0.12, depth: 0.04 });
    // The guides' hut, benches facing the view, a lamp
    kiosk(b, 9.8, 7.6, { color: '#c9b78f', roof: '#7a4a35', fascia: '#e9dcb4' });
    extra(b, 'rock-guide', 9.8, 6.6, PI, 'work', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'teal' } });
    bench(b, 4.4, -3.4, { w: 2.8, ry: PI, back: true, color: '#8f8a7d', leg: '#6a665c' });
    extra(b, 'rock-sitter', 4.4, -3.4, PI, 'sit', { seat: 0.6 });
    lampPost(b, 1.6, 1.6, { light: true }); lampPost(b, 8.6, 1.6);
    flag(b, 12.2, 9.6, { h: 5 });
    ([[-11.4, 8.8, 1.2, 0], [12, 3.4, 0.9, 1]] as [number, number, number, number][]).forEach(([x, z, s, tone]) => leafTree(b, x, z, { s, tone }));
    ([[-9, 6.4], [12.2, 6.4]] as [number, number][]).forEach(([x, z], i) => bush(b, x, z, { s: 0.8 + (i % 2) * 0.3, color: i % 2 ? '#c0407e' : LEAF }));
    return {
      spots: [
        landmark('summit', /summit|top|climb|view|city|roof|rock/, 3.4, -2.9, PI),
        landmark('work', /work|staff|guide|ticket|caretak/, 9.8, 5.6, PI, { act: { pose: 'work' } }),
        landmark('steps', /step|stair|carv|cave/, -3.4, -2.6, PI),
        landmark('bench', /bench|sit|rest|chill|relax/, 6.2, -1.8, PI, { act: { pose: 'sit', x: 4.4, z: -3.4, ry: PI, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 1.4, 5.6, 0),
      ],
      crowd: [[2.4, 4.4, 0.4], [-1.2, 6.4, -0.5], [4.2, 6.2, 2.6], [-3.4, 4.6, 1.2], [6.4, 3.8, -1], [-8, 5, 1.6], [0.6, 8.6, 2.2], [8.6, 4, -0.6], [-4.8, 8, 0.2], [2.4, 0.4, PI], [-9.6, 1.8, 2.6], [6.8, 9, 0.4]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Cloth yard: indigo and white resist-dyed cloth hung on lines, dye vats of dark blue liquor, women's stalls.

function vat(b: Batch, x: number, z: number, r: number, liquor: Colour = '#16224d'): void {
  b.cyl(x, 0.55, z, r, 1.1, '#6a4a38', { seg: 10, top: 0.9 });
  b.cyl(x, 1.1, z, r + 0.1, 0.14, '#7d5a45', { seg: 10 });
  b.disc(x, 1.19, z, r * 0.86, liquor, { seg: 10 });
  b.disc(x - r * 0.2, 1.2, z + r * 0.15, r * 0.3, '#3f5fb0', { seg: 6 });
  b.box(x + r * 0.6, 1.5, z - r * 0.2, 0.08, 1.6, 0.08, WOOD_LIGHT, { rz: -0.5 });
}
function dryingRack(b: Batch, x: number, z: number, ry: number, pattern: number): void {
  b.at(x, 0, z, ry, () => {
    for (const s of [-1, 1]) b.box(s * 1.3, 1.2, 0, 0.1, 2.4, 0.1, WOOD_DARK);
    b.box(0, 2.35, 0, 2.8, 0.09, 0.09, WOOD_DARK);
    adireCloth(b, 0, 1.2, 0.04, 2.2, 2.3, pattern);
  });
}

const adire: SceneDef = {
  mood: 'outdoor', accent: '#3f6fd0',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label), rand = seeded(5);
    ground(b, { w: 30, d: 26, color: '#b98d5e', edge: '#8a6844' });
    // Earth stained blue around the vats; swept paths
    b.disc(8.2, 0.05, 3.2, 5.2, '#8d7a78', { seg: 14 }); b.disc(8.2, 0.06, 3.2, 3.6, '#5d5f86', { seg: 12 });
    b.box(-1, 0.04, 6.4, 3.4, 0.04, 12.4, '#d6ba88');
    // The back row: tin-roofed sheds with long tables of rolled and folded cloth, women selling
    const tones = ['#233c7c', '#e9e4d2', '#6f8fc7', '#8a3a2e', '#2f6f5c', '#d6a83a', '#1b2a5e'];
    for (const [x, w] of ([[-9.2, 8], [-0.6, 7.6], [7.6, 7.6]] as [number, number][])) {
      shed(b, x, -10.2, w, 3.4, Math.round(x + 10) % 4, 3.2);
      table(b, x, -9.6, { w: w - 1.2, d: 1, h: 0.95, color: '#7a5c3c' });
      for (let i = 0; i < Math.floor((w - 1.6) / 0.5); i++) { b.cyl(x - (w - 1.6) / 2 + i * 0.5, 1.2, -9.6, 0.2, 0.55, tones[(i + Math.round(x)) % tones.length]!, { seg: 7 }); if (i % 2) b.cyl(x - (w - 1.6) / 2 + i * 0.5, 1.7, -9.6, 0.2, 0.4, tones[(i + 3) % tones.length]!, { seg: 7 }); }
    }
    // Cloth lines: poles with ropes, indigo cloth with white resist patterns hanging to dry
    const lines: [number, number, number, number][] = [[-12.4, -2.2, -6.4, 0], [-12.4, -2.2, -2.6, 1], [-12.4, 0, 1.4, 2]];
    for (const [x0, x1, z, off] of lines) {
      const cx = (x0 + x1) / 2, w = x1 - x0;
      for (const x of [x0, x1]) b.cyl(x, 2.4, z, 0.1, 4.8, WOOD_DARK, { seg: 5 });
      b.box(cx, 4.7, z, w, 0.07, 0.07, '#c9b88f');
      const n = Math.floor(w / 1.7);
      for (let i = 0; i < n; i++) adireCloth(b, x0 + 1 + i * (w - 1.2) / n + 0.4, 3.2, z + 0.05, 1.6, 3.2, i + off, 0.04 * (i % 3 - 1), i % 5 === 3 ? '#8a3a2e' : '#233c7c', i % 5 === 3 ? '#f1d9a0' : '#eae4d0');
    }
    // The dye yard: vats, racks of freshly dyed cloth
    for (const [x, z, r] of ([[6.2, 1.2, 1.15], [9, 0.6, 1.0], [11, 3.2, 1.2], [7, 4.8, 1.05], [10, 6.2, 0.95]] as [number, number, number][])) vat(b, x, z, r);
    dryingRack(b, 5.4, -2.6, 0.2, 1); dryingRack(b, 11.2, -3.6, -0.1, 3);
    for (const [x, z] of ([[4.2, 7.6], [12.6, 8.4]] as [number, number][])) { b.cyl(x, 0.35, z, 0.4, 0.7, '#8a5a3a', { seg: 7, top: 0.8 }); b.ball(x, 0.7, z, 0.3, 0.12, 0.3, '#16224d', { seg: 6 }); }
    extra(b, 'adire-dyer', 7.6, 2.8, 2.6, 'work', { look: LOOK_WOMAN('navy', { fabric: 'adire', outfit: 'casual' }) });
    // Front stalls: two awnings in indigo and white, women seated behind rolled cloth
    for (const [x, c] of ([[-9, ['#233c7c', '#eae4d0']], [-3.6, ['#6f8fc7', '#eae4d0']]] as [number, Colour[]][])) {
      b.at(x, 0, 4.2, 0, () => {
        for (const s of [-1, 1]) { b.box(s * 1.7, 1.45, 0.8, 0.12, 2.9, 0.12, WOOD_DARK); b.box(s * 1.7, 1.7, -0.8, 0.12, 3.4, 0.12, WOOD_DARK); }
        for (let i = 0; i < 6; i++) b.box(-1.5 + i * 0.6, 3.25, 0, 0.6, 0.1, 2.4, c[i % 2]!, { rx: 0.18 });
        b.box(0, 0.95, 0.2, 3.1, 0.12, 1.3, WOOD);
        b.box(0, 0.45, 0.2, 2.9, 0.9, 1.1, WOOD_DARK);
        for (let i = 0; i < 6; i++) b.cyl(-1.25 + i * 0.5, 1.28, 0.2, 0.2, 0.5, tones[(i + Math.round(x)) % tones.length]!, { seg: 7, rz: HALF });
      });
      adireCloth(b, x, 2.3, 3.5, 1.4, 1.4, Math.round(x));
    }
    extra(b, 'adire-seller-1', -9, 3.3, 0.1, 'work', { look: LOOK_WOMAN('blue', { fabric: 'adire', hair: 'gele' }) });
    extra(b, 'adire-seller-2', -3.6, 3.3, -0.1, 'sit', { seat: 0.5, look: LOOK_WOMAN('cream', { fabric: 'adire', outfit: 'owambe' }) });
    // Name board over the middle shed
    labelled(b, label, -0.6, 5.1, -8.6, 7, 0.46, '#eae4d0', '#233c7c', false);
    for (const x of [-4.2, 3]) b.cyl(x, 2.5, -8.7, 0.07, 5, WOOD_DARK, { seg: 5 });
    stringLights(b, [-12.4, 3.2, 3.2], [-0.8, 3.7, 3.4], { n: 8, colors: ['#9fd8ff', '#eae4d0', WARM] });
    lampPost(b, 2.6, 5.4, { light: true });
    crate(b, 3, 0, 9.4, { s: 0.9 }); crate(b, 3.9, 0, 9.5, { s: 0.8, fill: '#233c7c' });
    for (const [x, z, s, t] of ([[-13, 9.4, 1.2, 0], [13.2, 10.4, 1.1, 2]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    return {
      spots: [
        landmark('cloth', /cloth|adire|row|dye|fabric|vat|resist/, 5.2, 2.8, HALF, { act: { pose: 'work' } }),
        landmark('work', /work|staff|stall|sell|shop/, -6.2, 5.8, PI, { act: { pose: 'work' } }),
        landmark('lines', /line|dry|hang|market/, -6, -0.4, PI),
        landmark('people', /people|crowd|meet/, 0.6, 8.6, 0),
      ],
      crowd: [[2.2, 4.4, 0.4], [-1.4, 5.6, -0.5], [-6.4, 1.6, 1.4], [-9, 8.4, 0.8], [3, 9, 2.8], [-2.8, 9.4, 2.4], [-8.4, -3.8, 1.2], [1.4, 1.2, 0], [12.6, -0.4, -1.6], [6.2, 9.4, -0.2], [-11.4, 6.6, 1.6], [9.4, 9, 0.4]],
      spare: [[-4, 7.6], [0.4, 9.8], [4, 8.4], [-9, 10]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Palace forecourt: a colonial-era frontage of two storeys with an arcaded verandah and a portico, a beaded-crown
// emblem, flags, a wide paved forecourt and a bench of drummers.

function palaceFront(b: Batch, cx: number, z: number, w: number): void {
  const d = 5, front = z + d / 2;
  b.box(cx, 0.25, z, w + 1, 0.5, d + 1, '#cbbf9f');
  b.box(cx, 3.3, z, w, 5.6, d, '#f0e8d2');
  b.box(cx, 6.2, z, w + 0.3, 0.3, d + 0.4, '#d8cdb0');
  b.box(cx, 3.1, front + 0.9, w, 0.28, 1.8, '#d8cdb0');
  // Ground floor arcade: arches of dark doors between white piers; first floor shutters behind a balustrade
  const bays = Math.round(w / 2.4);
  for (let i = 0; i < bays; i++) {
    const x = cx - w / 2 + (i + 0.5) * (w / bays);
    b.box(x, 1.4, front + 0.02, 1.3, 2.2, 0.1, '#43362b'); b.cyl(x, 2.5, front + 0.02, 0.65, 0.1, '#43362b', { seg: 10, rx: HALF });
    windowPane(b, x, 4.5, front + 0.04, { w: 1.0, h: 1.6, glass: '#7f9fb4', frame: '#4f7f5c' });
  }
  for (let i = 0; i <= bays; i++) { b.cyl(cx - w / 2 + i * (w / bays), 1.55, front + 1.7, 0.2, 3.1, WHITE, { seg: 8 }); b.cyl(cx - w / 2 + i * (w / bays), 4.7, front + 1.7, 0.14, 3.1, WHITE, { seg: 8 }); }
  for (let i = 0; i < bays * 2; i++) b.box(cx - w / 2 + 0.3 + i * (w - 0.6) / (bays * 2 - 1), 3.55, front + 1.8, 0.12, 0.55, 0.12, WHITE);
  b.box(cx, 3.9, front + 1.8, w, 0.08, 0.14, WHITE);
  // Hipped roof of iron sheet with a central pediment holding the crown
  for (const side of [-1, 1]) b.box(cx, 7.1, z + side * 1.25, w + 1.1, 0.16, 3.2, side < 0 ? '#a8653f' : '#9b5a3a', { rx: -side * 0.34 });
  b.box(cx, 7.75, z, w + 1.1, 0.18, 0.3, '#7a4530');
  b.box(cx, 7.35, front + 0.9, 5.4, 2.2, 0.5, '#f0e8d2');
  for (const side of [-1, 1]) b.box(cx + side * 1.4, 8.7, front + 0.9, 3.4, 0.16, 0.7, '#d8cdb0', { rz: -side * 0.5 });
  beadedCrown(b, cx, 7.5, front + 1.25, 0.42);
}

function drummers(b: Batch, x: number, z: number): void {
  bench(b, x, z, { w: 5.2, back: false, color: '#8a6644', leg: '#5f4630' });
  const robe = ['white', 'cream', 'teal'] as const;
  for (let i = 0; i < 3; i++) {
    extra(b, `ake-drummer-${i}`, x - 1.6 + i * 1.6, z, 0, 'sit', { seat: 0.6, look: { body: 'man', outfit: i === 1 ? 'agbada' : 'kaftan', outfitColor: robe[i]!, accessories: ['fila'] } });
    drum(b, x - 1.6 + i * 1.6 + 0.4, z + 0.9, i % 2 ? '#6a3f27' : '#7a4a30');
  }
}

const palaceCourt: SceneDef = {
  mood: 'outdoor', accent: '#d6a83a',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#a8b08a', edge: '#6f7d5c' });
    // The wide forecourt: pale paving with a terracotta ceremonial way
    b.box(0, 0.05, 1.4, 27, 0.06, 20.6, '#d8cfb4');
    b.box(0, 0.07, 3.4, 4.4, 0.04, 17, '#b87055');
    for (let z = -6; z <= 12; z += 2) b.box(0, 0.1, z, 4.4, 0.02, 0.06, '#d8cfb4');
    // The frontage: a long central block with a verandah, two lower wings
    palaceFront(b, 0, -9.6, 14);
    for (const side of [-1, 1]) {
      b.box(side * 11.6, 2, -9.2, 5.6, 4, 4.2, '#efe6cf'); gable(b, side * 11.6, 4, -9.2, 5.6, 4.2, side < 0 ? 1 : 3, 0.3);
      for (const dx of [-1.4, 1.4]) windowPane(b, side * 11.6 + dx, 2.2, -7.06, { w: 1, h: 1.4, glass: '#7f9fb4', frame: '#4f7f5c' });
    }
    // The crown on its plinth in the middle of the forecourt, the flags either side of the way
    b.box(0, 0.5, -2.2, 2.2, 1, 2.2, '#cfc4a8'); b.box(0, 1.05, -2.2, 1.8, 0.2, 1.8, '#e6dcc2');
    beadedCrown(b, 0, 1.3, -2.2, 0.8);
    flag(b, -4.2, -3.4, { h: 7, w: 2.1 }); flag(b, 4.2, -3.4, { h: 7, w: 2.1, colors: ['#2a4fa6', '#d6a83a', '#2a4fa6'] });
    // Gate pillars and railings across the front, low hedges
    for (const x of [-2.6, 2.6]) { b.box(x, 1.1, 12, 0.9, 2.2, 0.9, '#e6dcc2'); b.box(x, 2.35, 12, 1.2, 0.2, 1.2, '#cfc4a8'); b.ball(x, 2.75, 12, 0.3, 0.3, 0.3, '#d6a83a', { seg: 6 }); }
    fence(b, [-13.6, 12], [-3.4, 12], { h: 1.1, color: '#3a4440', gap: 1.8 }); fence(b, [3.4, 12], [13.6, 12], { h: 1.1, color: '#3a4440', gap: 1.8 });
    // The display of the history of the town, a name board on posts, the drummers' bench at the right
    b.box(-6.4, 1.4, 1.6, 3.4, 1.8, 0.16, '#6b4a2f'); b.quad(-6.4, 1.45, 1.7, 3.1, 1.5, '#efe6cf');
    for (const s of [-1, 1]) b.cyl(-6.4 + s * 1.6, 0.6, 1.55, 0.06, 1.2, WOOD_DARK, { seg: 4 });
    signBoard(b, 6.4, 8.4, label, { y: 2.4, size: fit(label, 6, 0.36), color: '#f1e6c4', board: '#2a3f6e' });
    drummers(b, 7.6, 3.6);
    leafTree(b, -13, 4, { s: 1.2, tone: 0 }); leafTree(b, 13, 6, { s: 1.15, tone: 2 });
    lampPost(b, -2.8, 6, { light: true }); lampPost(b, 2.8, 0.8);
    extra(b, 'ake-chief', 3, -6, PI, 'stand', { look: { body: 'man', outfit: 'agbada', outfitColor: 'gold', accessories: ['fila'] } });
    return {
      spots: [
        landmark('court', /court|front|palace|history|read|display|egba/, -6.2, 3.6, PI),
        landmark('drums', /drum|music|bench|sit|rest/, 5, 6, HALF),
        landmark('work', /work|staff|guard|office|attend/, 0, -5, PI, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 0.6, 7.8, 0),
      ],
      crowd: [[2.4, 8.4, 0.4], [-2.4, 8.6, -0.5], [-9, 6.6, 1.2], [9.6, 8.8, -0.8], [-8.4, 9.6, 0.8], [-6, 0.6, 1.4], [8.8, -0.4, -1.2], [-3.4, 4.4, 2.4], [11, 3.4, -1.4], [-11, 1.4, 1.6], [3.8, 1.4, 0.6], [0.4, 10.4, 3.1]],
      spare: [[-6, 9], [6, 9.6], [-3, 10.6], [3.4, 10.2]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Festival ground: a low palace with a wide verandah, a raised dais under a canopy, tall age-grade banners in bright
// fabric colours, big umbrellas, and horses standing at the edge.

const GRADES: [Colour, Colour][] = [['#c9423a', '#f0c24a'], ['#2a4fa6', '#eae4d0'], ['#2f8f55', '#f0c24a'], ['#8055c2', '#f2a6c8'], ['#e0822f', '#233c7c'], ['#d6a83a', '#c9423a'], ['#3f9a9a', '#eae4d0'], ['#dd6fa0', '#2a4fa6']];

function banner(b: Batch, x: number, z: number, i: number, ry = 0): void {
  const [a, c] = GRADES[i % GRADES.length]!;
  b.at(x, 0, z, ry, () => {
    b.cyl(0, 3, 0, 0.07, 6, '#c9ced3', { seg: 5 });
    b.ball(0, 6.1, 0, 0.12, 0.12, 0.12, '#d6a83a', { seg: 5 });
    b.box(0.62, 4.6, 0, 1.2, 2.6, 0.05, a);
    b.box(0.62, 5.6, 0.02, 1.2, 0.22, 0.05, c); b.box(0.62, 3.65, 0.02, 1.2, 0.22, 0.05, c);
    b.quad(0.62, 4.6, 0.06, 0.55, 0.55, c, { rz: PI / 4 });
    b.quad(0.62, 4.6, 0.07, 0.25, 0.25, a, { rz: PI / 4 });
  });
}

const ojude: SceneDef = {
  mood: 'outdoor', accent: '#f0c24a',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#b8aa86', edge: '#7e7358' });
    b.box(0, 0.05, 0, 28, 0.06, 24, '#d4c7a2');
    for (let i = -6; i <= 6; i += 2) b.box(i * 2, 0.08, 1, 0.06, 0.02, 22, '#bfb18a');
    // The palace across the back: one storey, a long verandah on slim pillars, carved doors, an iron roof
    b.box(0, 2.3, -11.4, 26, 4.2, 3.6, '#f3ecd8');
    b.box(0, 4.55, -11.4, 26.6, 0.3, 4, '#d8cdb0');
    for (const side of [-1, 1]) b.box(0, 5.4, -11.4 + side * 1.0, 27, 0.16, 2.7, side < 0 ? '#a8653f' : '#9b5a3a', { rx: -side * 0.32 });
    b.box(0, 6.3, -11.4, 27, 0.16, 0.3, '#7a4530');
    for (let i = 0; i < 14; i++) { const x = -12 + i * 24 / 13; b.cyl(x, 2.2, -9, 0.17, 4.3, WHITE, { seg: 6 }); if (i % 2 === 0) windowPane(b, x + 0.9, 2.4, -9.62, { w: 1.1, h: 1.5, glass: '#6f8fa4', frame: '#7a5a3c' }); }
    b.box(0, 4.45, -8.9, 26, 0.2, 0.5, '#d8cdb0');
    b.box(0, 1.6, -9.64, 2.8, 3.2, 0.1, '#5a3a24'); b.cyl(0, 3.2, -9.64, 1.4, 0.1, '#5a3a24', { seg: 12, rx: HALF });
    for (let i = 0; i < 4; i++) b.quad(-1 + i * 0.66, 1.6, -9.56, 0.5, 2.6, i % 2 ? '#7a5030' : '#6a4228');
    labelled(b, label, 0, 5.15, -9.2, 9, 0.5, '#f4e6b8', '#7a2f2a', false);
    // The dais: a raised platform with steps, a fringed canopy in red and gold, seats and a carpet
    b.at(7.2, 0, -4.6, 0, () => {
      b.box(0, 0.45, 0, 6.4, 0.9, 3.8, '#c9b88f'); b.box(0, 0.93, 0, 6.6, 0.1, 4, '#e8dcb8');
      for (let i = 0; i < 3; i++) b.box(0, 0.15 + i * 0.28, 2.3 + (2 - i) * 0.4, 3.6, 0.3 + i * 0.28, 0.45, '#d8cdb0');
      b.box(0, 0.97, 0.3, 2, 0.04, 3.2, '#a8323a');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 3, 2.6, sz * 1.7, 0.1, 3.4, '#d6a83a', { seg: 6 });
      b.box(0, 4.5, 0, 6.9, 0.2, 4.2, '#a8323a'); b.box(0, 4.7, 0, 6.5, 0.14, 3.8, '#d6a83a');
      for (let i = 0; i < 14; i++) b.box(-3.2 + i * 0.5, 4.2, 2.05, 0.32, 0.5, 0.04, i % 2 ? '#d6a83a' : '#a8323a');
      for (let i = 0; i < 3; i++) chair(b, -1.5 + i * 1.5, -0.8, { color: '#a8323a', leg: '#d6a83a', ry: 0 });
    });
    extra(b, 'oj-oba', 7.2, -5.4, 0, 'sit', { y: 0.95, seat: 0.6, look: { body: 'man', outfit: 'agbada', outfitColor: 'gold', accessories: ['fila', 'beads'] } });
    // Age-grade banners in rows along both sides, strung with pennants; big umbrellas over seated groups
    for (let i = 0; i < 6; i++) banner(b, -12.4 + i * 1.2, -7.4 + i * 1.2, i);
    for (let i = 0; i < 4; i++) banner(b, 12.6, -2 + i * 3.2, i + 3, -0.2);
    stringLights(b, [-12.4, 5.6, -7.4], [-2, 5.6, -8], { n: 10, sag: 0.7, colors: ['#c9423a', '#f0c24a', '#2a4fa6', '#2f8f55'] });
    const umbrellas: [number, number, Colour[]][] = [[-10.4, 2.6, ['#c9423a', '#f0c24a']], [-6.2, 4.6, ['#2a4fa6', '#eae4d0']], [-10.2, 7.6, ['#2f8f55', '#f0c24a']], [-2.6, 2.6, ['#8055c2', '#f2a6c8']], [10.4, 5.6, ['#e0822f', '#233c7c']]];
    for (const [x, z, colors] of umbrellas) { parasol(b, x, z, { h: 3.3, r: 2.1, colors }); chair(b, x - 0.9, z + 0.8, { color: colors[0]!, ry: 0.4 }); chair(b, x + 0.9, z + 0.8, { color: colors[0]!, ry: -0.4 }); }
    // Horses at the edge: static props with a bright blanket
    horse(b, 1.4, 2.4, 2.4, '#7a4a2c', '#c9423a'); horse(b, 3.8, 3.4, 2.9, '#e8e2d2', '#2a4fa6'); horse(b, 11.8, 9, -1.2, '#4a3224', '#f0c24a');
    extra(b, 'oj-rider-1', 1.4, 2.4, 2.4, 'sit', { y: 1.35, seat: 0.5, look: { body: 'man', outfit: 'agbada', outfitColor: 'red', accessories: ['fila'] } });
    extra(b, 'oj-rider-2', 3.8, 3.4, 2.9, 'sit', { y: 1.35, seat: 0.5, look: { body: 'man', outfit: 'agbada', outfitColor: 'blue', accessories: ['fila'] } });
    drum(b, -3.4, -6.2); drum(b, -2.6, -6.2, '#7a4a30'); drum(b, -1.8, -6.2);
    extra(b, 'oj-drummer', -2.6, -7, 0, 'stand', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream' } });
    palm(b, -13.4, 11, { s: 1.1 }); palm(b, 13.6, 4, { s: 1 });
    return {
      spots: [
        landmark('forecourt', /fore|court|heritage|gather|ground|festival|regbe|learn|age|grade/, 1.2, -1.4, PI),
        landmark('work', /work|staff|steward|usher|office/, 4, -2.2, 0, { act: { pose: 'work' } }),
        landmark('umbrella', /umbrella|shade|seat|sit|rest/, -6.2, 6.6, PI),
        landmark('people', /people|crowd|meet/, 0.6, 7.6, 0),
      ],
      crowd: [[-1, 5.2, 0.4], [-4.4, 6.4, -0.5], [6.6, 6.8, 2.4], [-8, 5.4, 1.2], [8.6, 9.6, -0.8], [-8.4, 10.4, 0.8], [3, 9.8, 2.8], [-1.6, 9.4, 2.4], [5.6, 1.8, -1.6], [-12, 5.2, 1.6], [0.4, 0.6, 0.6], [10.8, 7.2, -1.4]],
      spare: [[-3, 8.4], [3, 8.4], [-6, 9.6], [6, 10.6]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Civic hall: a squat hall with a deep portico, steps and a plaque, on a lawn with a memorial pillar.

const hall: SceneDef = {
  mood: 'outdoor', accent: '#2a4fa6',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#6aa056', edge: '#46703a' });
    b.box(0, 0.05, 2, 6, 0.05, 20, '#d8cfb4'); b.box(0, 0.05, 2, 26, 0.05, 3, '#d8cfb4');
    // The hall: a long single storey on a red brick plinth under a hipped iron roof with a ventilating cupola
    b.box(0, 3.0, -9.4, 20, 6, 6.4, '#efe4c6');
    b.box(0, 0.8, -9.4, 20.4, 1.6, 6.8, '#a8553c');
    b.box(0, 6.1, -9.4, 21, 0.3, 7.4, '#d8cdb0');
    gable(b, 0, 6.2, -9.4, 18, 7, 0, 0.3);
    for (const side of [-1, 1]) b.box(side * 9.6, 7.1, -9.4, 2.2, 0.16, 5.2, side < 0 ? '#9b5a3a' : '#8a4e34', { rz: -side * 0.7 });
    b.box(0, 8.6, -9.4, 1.8, 1.4, 1.8, '#efe4c6'); b.cone(0, 9.8, -9.4, 1.5, 1.4, '#7a4530', { seg: 4, ry: PI / 4 });
    // A deep arcaded portico across the middle: brick piers, round arches, a flat porch roof, wide steps
    for (let i = 0; i < 4; i++) b.box(-4.5 + i * 3, 1.9, -5.2, 0.9, 3.8, 0.9, '#a8553c');
    for (let i = 0; i < 3; i++) { b.cyl(-3 + i * 3, 3.8, -5.2, 1.0, 0.8, '#efe4c6', { seg: 10, rx: HALF }); b.box(-3 + i * 3, 4.4, -5.2, 2.1, 0.7, 0.9, '#efe4c6'); }
    b.box(0, 4.95, -5.8, 10.8, 0.4, 2.8, '#d8cdb0');
    b.box(0, 5.4, -4.5, 11, 0.5, 0.3, '#a8553c');
    for (let i = 0; i < 4; i++) b.box(0, 0.12 + i * 0.12, -3.6 + (3 - i) * 0.4, 10.4, 0.24 + i * 0.12, 0.5, '#d8cfb4');
    b.box(0, 1.8, -6.14, 2.8, 3.6, 0.1, '#4a3626'); b.box(0, 1.8, -6.08, 0.06, 3.5, 0.06, '#d6a83a');
    for (const x of [-8.2, -5.8, 5.8, 8.2]) { windowPane(b, x, 3.2, -6.14, { w: 1.2, h: 2.2, glass: '#8fb0c4', frame: '#bdb298' }); b.cyl(x, 4.5, -6.1, 0.7, 0.1, '#bdb298', { seg: 8, rx: HALF }); }
    for (const x of [-9.4, 9.4]) windowPane(b, x, 3.2, -6.14, { w: 0.9, h: 2.2, glass: '#8fb0c4', frame: '#bdb298' });
    b.cyl(0, 5.8, -4.34, 0.5, 0.08, '#d6a83a', { seg: 12, rx: HALF });
    // The plaque on its own stone, in front of the portico: the venue's own name
    b.box(-6.6, 0.55, -1.4, 3.8, 1.1, 0.7, '#8d887a'); b.box(-6.6, 1.2, -1.4, 4, 0.14, 0.8, '#a8a396');
    sign(b, -6.6, 0.58, -1.02, label, { size: fit(label, 3.4, 0.28), color: '#f1e6c4', board: '#2a3f36', pad: 0.12, depth: 0.04 });
    // A memorial pillar on a stepped base
    b.box(7.6, 0.3, -1.4, 3.2, 0.6, 3.2, '#bdb298'); b.box(7.6, 0.8, -1.4, 2.4, 0.4, 2.4, '#cdc2a6');
    b.cyl(7.6, 4, -1.4, 0.6, 6, '#e6dcc2', { seg: 6, top: 0.7 }); b.box(7.6, 7.2, -1.4, 1.4, 0.5, 1.4, '#cdc2a6'); b.ball(7.6, 7.8, -1.4, 0.5, 0.5, 0.5, '#d6a83a', { seg: 6 });
    flag(b, -11.6, -2.4, { h: 6.6 }); flag(b, 11.6, -2.4, { h: 6.6, colors: ['#2a4fa6', '#d6a83a', '#2a4fa6'] });
    for (let i = 0; i < 5; i++) bush(b, -9 + i * 1.6, -3.8, { s: 0.55, color: i % 2 ? '#c0407e' : LEAF });
    for (let i = 0; i < 5; i++) bush(b, 4.4 + i * 1.6, -3.8, { s: 0.55, color: i % 2 ? '#e0a83a' : LEAF });
    bench(b, -3.6, 6.2, { w: 2.8, back: true, ry: PI, color: '#bdb7a6', leg: '#8f8a7d' }); bench(b, 3.6, 6.2, { w: 2.8, back: true, ry: PI, color: '#bdb7a6', leg: '#8f8a7d' });
    extra(b, 'hall-reader', -3.6, 6.2, PI, 'sit', { seat: 0.6 });
    extra(b, 'hall-usher', -1.8, -3, PI, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy' } });
    extra(b, 'hall-visitor', 5.4, 3, 2.6, 'wave'); extra(b, 'hall-guide', -5.2, 1.4, 0.5, 'stand', { look: { body: 'woman', outfit: 'kaftan', outfitColor: 'teal', fabric: 'adire' } });
    for (const [x, z, s, t] of ([[-13, 4, 1.2, 0], [13, 2, 1.1, 1], [-12.6, 10.6, 1, 2], [12.6, 10.4, 1.1, 0]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    lampPost(b, -2.8, 3.4, { light: true }); lampPost(b, 2.8, 3.4); lampPost(b, -9, 8.6); lampPost(b, 9, 8.6);
    return {
      spots: [
        landmark('hall', /hall|front|story|read|plaque|centenary|meeting|civic|history|egba|remo|ota/, -4.4, 1.2, PI),
        landmark('work', /work|staff|office|usher|attend|admin/, -1, -2.6, 0, { act: { pose: 'work' } }),
        landmark('pillar', /pillar|monument|memorial/, 5.6, 1, HALF),
        landmark('people', /people|crowd|meet/, 0.6, 8.4, 0),
      ],
      crowd: [[2.4, 4.6, 0.4], [-2.4, 3.6, -0.5], [8, 6.6, 2.4], [-7, 5.4, 1.2], [9.6, 8.8, -0.8], [-8.4, 9, 0.8], [3, 9.6, 2.8], [-1.6, 9.2, 2.4], [10.6, 2.4, -1.6], [-11, 7.4, 1.6], [0.4, 6.8, 0.6], [6, 0.4, -1]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Library complex: a stepped museum building under a glazed dome, a long archive wing, a garden with a pond and rock sculptures.

const library: SceneDef = {
  mood: 'outdoor', accent: '#d6a83a',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#78a860', edge: '#4f7a46' });
    b.box(0, 0.05, 2.6, 8, 0.05, 18.4, '#e0d8c2'); b.box(0, 0.05, 1.4, 27, 0.05, 2.6, '#e0d8c2');
    // The museum: three stepped tiers of pale stone narrowing upwards, a glass drum and a dome
    const tiers: [number, number, number, number][] = [[0, -9.2, 15, 2.4], [0, -9.4, 11.4, 2.2], [0, -9.6, 7.8, 2]];
    let y = 0;
    tiers.forEach(([x, z, w, h], i) => {
      b.box(x, y + h / 2, z, w, h, 7.2 - i * 1.2, i % 2 ? '#e8e0cc' : '#f1eadb');
      b.box(x, y + h + 0.1, z, w + 0.5, 0.2, 7.7 - i * 1.2, '#cfc6ad');
      for (let k = 0; k < Math.floor(w / 1.6); k++) b.box(x - w / 2 + 0.8 + k * 1.6, y + h / 2, z + (7.2 - i * 1.2) / 2 + 0.03, 0.9, h * 0.7, 0.06, '#5d7f93');
      y += h + 0.2;
    });
    b.cyl(0, y + 0.9, -9.6, 3, 1.8, '#a9c7d4', { seg: 16, ...GLASS });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; b.box(Math.sin(a) * 3, y + 0.9, -9.6 + Math.cos(a) * 3, 0.14, 1.8, 0.14, '#e8e0cc'); }
    b.ball(0, y + 1.8, -9.6, 3.1, 2.2, 3.1, '#e6c458', { seg: 12 });
    b.cyl(0, y + 4.1, -9.6, 0.06, 1, '#c9ced3', { seg: 4 });
    // Entrance stair up the front tier, flanking columns
    for (let i = 0; i < 5; i++) b.box(0, 0.12 + i * 0.12, -5.2 + (4 - i) * 0.4, 6, 0.24 + i * 0.12, 0.5, '#e0d8c2');
    for (const x of [-2.8, -1, 1, 2.8]) b.cyl(x, 1.4, -5.8, 0.18, 2.4, WHITE, { seg: 6 });
    b.box(0, 2.7, -5.8, 6.8, 0.3, 0.9, '#cfc6ad');
    labelled(b, label, 0, 3.4, -5.2, 7.2, 0.4, '#f4e6b8', '#2f3b36', false);
    // The archive wing on the right: a long low block with a shaded walkway; a reading pavilion on the left
    b.box(10.4, 2.0, -4.4, 6, 4, 10, '#e0d8c2'); b.box(10.4, 4.1, -4.4, 6.6, 0.3, 10.6, '#cfc6ad'); b.box(10.4, 4.5, -4.4, 5, 0.5, 8.6, '#e8e0cc');
    for (let i = 0; i < 4; i++) windowPane(b, 7.34, 2.3, -7.6 + i * 2.6, { w: 1.4, h: 1.6, ry: HALF, glass: '#8fb0c4', frame: '#bdb298' });
    b.box(-11, 1.8, -5.4, 6.4, 3.6, 5.2, '#e8e0cc'); b.box(-11, 3.75, -5.4, 7, 0.3, 5.8, '#cfc6ad');
    for (let i = 0; i < 3; i++) windowPane(b, -11 + (i - 1) * 2, 1.9, -2.76, { w: 1.5, h: 2, glass: '#8fb0c4', frame: '#cfc6ad' });
    // The garden: a long pond with rock sculptures, flower beds, a flag line
    b.box(-4.4, 0.02, 1.6, 4.6, 0.1, 6.4, '#7e8f94'); b.box(-4.4, 0.08, 1.6, 4.2, 0.06, 6, '#7fc3d9', GLASS);
    for (const [x, z, r] of ([[-5.4, 0.6, 0.9], [-3.6, 2.4, 0.7], [-4.8, 3.4, 0.5]] as [number, number, number][])) { b.ico(x, 0.4 + r * 0.3, z, r, r * 1.4, r, '#a09a90'); }
    for (const [x, z] of ([[6.4, 3.2], [9.6, 3.2], [8, 6.6]] as [number, number][])) { b.box(x, 0.15, z, 2.6, 0.3, 1.4, '#7a5a3c'); for (let i = 0; i < 5; i++) b.ico(x - 1 + i * 0.5, 0.45, z, 0.24, 0.2, 0.24, ['#e9614b', '#e8c43a', '#dd6fa0', '#f1efe8', '#8055c2'][i]!); }
    for (let i = 0; i < 5; i++) flag(b, -13 + i * 1.2, 8.6, { h: 4.6, w: 1.4, colors: i % 2 ? ['#2f8f55', WHITE, '#2f8f55'] : ['#d6a83a', '#2a4fa6', '#d6a83a'] });
    bench(b, -9.4, 5.6, { w: 2.8, back: true, ry: PI / 2 + 0.2 }); bench(b, 3.4, 8.2, { w: 2.8, back: true, ry: PI });
    for (const [x, z, s] of ([[-13.4, 1, 1], [13.4, 4, 1.1], [13, 10, 1], [-13, 10.6, 1.1]] as [number, number, number][])) palm(b, x, z, { s });
    leafTree(b, 12.8, 9, { s: 1, tone: 1 });
    lampPost(b, -2.8, 4.8, { light: true }); lampPost(b, 2.8, 4.8); lampPost(b, 2.8, 9.8);
    extra(b, 'lib-reader', 3.4, 8.2, PI, 'sit', { seat: 0.6 });
    extra(b, 'lib-staff', 0, -4, PI, 'stand', { look: { body: 'woman', outfit: 'office', outfitColor: 'teal' } });
    extra(b, 'lib-visitor', -6.6, 6, 2.2, 'wave'); extra(b, 'lib-visitor-2', 6.2, 5.6, -2.4, 'stand', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange' } });
    return {
      spots: [
        landmark('gallery', /gallery|exhibit|tour|museum|display|history|learn|read|library/, 0, -3.4, PI),
        landmark('work', /work|staff|office|desk|attend/, 3.4, -3.4, PI, { act: { pose: 'work' } }),
        landmark('garden', /garden|pond|walk|rest|sit/, -1.6, 6.4, 0),
        landmark('people', /people|crowd|meet/, 3.6, 5.6, 0),
      ],
      crowd: [[2.4, 4.6, 0.4], [-3.4, 8, -0.5], [7.6, 8.6, 2.4], [-7, 7.4, 1.2], [9.6, 8.8, -0.8], [-6, 4, 0.8], [-1.6, 10.4, 2.8], [5.6, 10.2, 2.4], [10.6, 1.4, -1.6], [-11, 4.4, 1.6], [0.4, 2.8, 0.6], [11, 6.4, -1]],
      spare: [[-6, 9.6], [6, 9], [0, 10.6], [3.4, 6.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// River with a bridge: a brown river under a long concrete deck on piers carrying a steel truss, rocks in the water,
// a fisher's canoe; the far bank is green with roofs among the trees.

const RIVER_FAR = -13, RIVER_NEAR = -3.2, RIVER_Y = -0.18;

function trussSpan(b: Batch, x0: number, x1: number, z: number, y: number): void {
  const n = Math.round((x1 - x0) / 2.4);
  for (const s of [-1, 1]) {
    const zz = z + s * 2.2;
    b.box((x0 + x1) / 2, y + 2.6, zz, x1 - x0, 0.22, 0.22, '#4a6a8a');
    for (let i = 0; i <= n; i++) b.box(x0 + (i * (x1 - x0)) / n, y + 1.3, zz, 0.16, 2.6, 0.16, '#5a7a9a');
    for (let i = 0; i < n; i++) b.box(x0 + ((i + 0.5) * (x1 - x0)) / n, y + 1.3, zz, 0.12, 2.9, 0.12, '#5a7a9a', { rz: i % 2 ? 0.8 : -0.8 });
  }
  for (let i = 0; i <= n; i += 2) b.box(x0 + (i * (x1 - x0)) / n, y + 2.6, z, 0.14, 0.14, 4.4, '#4a6a8a');
}
function pirogue(b: Batch, x: number, y: number, z: number, ry: number): void {
  b.at(x, y, z, ry, () => {
    b.ball(0, 0.18, 0, 0.5, 0.26, 2.2, '#6b4a2e', { seg: 8 });
    b.ball(0, 0.3, 0, 0.36, 0.14, 1.95, '#3d2c1c', { seg: 8 });
    b.box(0.5, 0.42, 0.4, 0.06, 0.06, 1.6, '#8a6644', { ry: 0.5 });
  });
}

const riverBridge: SceneDef = {
  mood: 'outdoor', accent: '#5fb0c8',
  camera: { landscape: [16, 22, 28], portrait: [14, 28, 38] },
  walk: { bounds: [-13.4, -2.2, 13.4, 11.4], entrance: [0, 10.6], open: true },
  build(b, context) {
    const label = plain(context.label), rand = seeded(17);
    // The near bank: grass over earth, a stone-faced edge
    b.box(0, -0.3, 4.6, 29, 0.5, 15.4, '#6e5a3c'); b.box(0, -0.02, 4.6, 28, 0.1, 15, '#6aa056');
    b.box(0, 0.03, 0.4, 28, 0.04, 2.6, '#d1c197');
    b.box(0, -0.45, RIVER_NEAR + 0.2, 29, 0.9, 0.8, '#8e8a7e');
    // The river: brown-green, wide, with ripples; the far bank rising to trees
    b.box(0, -2, (RIVER_FAR + RIVER_NEAR) / 2 - 8, 76, 3.4, 40, '#5e5a40');
    b.box(0, RIVER_Y - 0.02, (RIVER_FAR + RIVER_NEAR) / 2 - 0.2, 76, 0.1, RIVER_NEAR - RIVER_FAR + 0.4, '#7a6a4a');
    b.box(0, RIVER_Y + 0.03, (RIVER_FAR + RIVER_NEAR) / 2 - 0.2, 76, 0.06, RIVER_NEAR - RIVER_FAR, '#a58c62', GLASS);
    for (let i = 0; i < 9; i++) b.box(-24 + i * 6.2, RIVER_Y + 0.07, -5 - (i % 4) * 2.2, 3.2, 0.02, 0.14, '#e0e8c8', { layer: 'glass' });
    b.box(0, 0.8, RIVER_FAR - 2, 80, 3.2, 5, '#6a8a4e');
    for (let i = 0; i < 20; i++) b.ico(-34 + rand() * 68, 2.4 + rand() * 3, RIVER_FAR - 1.4 - rand() * 6, 1.6 + rand(), 1.6 + rand() * 0.8, 1.5 + rand(), ['#3d7a4a', '#2f6a44', '#4f8a45', '#5b9a55'][i % 4]!);
    for (let i = 0; i < 9; i++) { const x = -15 + i * 3.6 + rand(); house(b, x, RIVER_FAR - 1.4 - rand() * 1.6, 2.4, 2, 1.4, i, 0, '#e6d9bc'); }
    // The bridge: a deck of concrete on three piers across the river, with a steel truss above
    b.box(0, 3.4, -8.4, 32, 0.5, 4.2, '#bdb8aa');
    b.box(0, 3.85, -8.4, 32, 0.12, 3.4, '#4a4d52');
    for (let i = -7; i <= 7; i++) b.box(i * 2, 3.92, -8.4, 1, 0.02, 0.14, '#e6dfc8');
    for (const x of [-9.6, 0, 9.6]) { b.box(x, 1.5, -8.4, 1.6, 3.8, 3, '#a9a496'); b.box(x, -0.4, -8.4, 2.2, 0.8, 3.8, '#8e8a7e'); b.box(x, 3.3, -8.4, 2.4, 0.3, 3.6, '#b5b0a2'); }
    trussSpan(b, -14.4, -0.6, -8.4, 3.65); trussSpan(b, 0.6, 14.4, -8.4, 3.65);
    b.box(-15.4, 1.9, -8.4, 2.6, 3.8, 4.2, '#a9a496'); b.box(15.4, 1.9, -8.4, 2.6, 3.8, 4.2, '#a9a496');
    car(b, -4.8, -8.4, { ry: HALF, color: '#c9423a' }); car(b, 6.4, -8.4, { ry: -HALF, color: '#e8e4d8' });
    // Rocks in the water and along the near edge
    for (const [x, z, r, t] of ([[-6, -5.6, 1.6, 0], [-4.4, -6.2, 1.0, 2], [4, -5.2, 1.4, 1], [11, -6, 1.8, 3], [-12, -6.8, 1.5, 0], [6.6, -11, 1.2, 2], [-1.4, -11.4, 1.6, 1]] as [number, number, number, number][])) { b.ico(x, RIVER_Y + r * 0.35, z, r * 1.2, r * 0.8, r, ['#8d8883', '#9c958d', '#7c7873', '#a59d94'][t]!); }
    for (const [x, z, r] of ([[-12.4, -2.4, 0.8], [-8.8, -2.6, 0.6], [8.4, -2.4, 0.9], [13, -2.6, 0.7]] as [number, number, number][])) boulder(b, x, 0, z, r, 1);
    // A fisher's canoe and net poles, women washing at the edge, a floating line of reeds
    pirogue(b, -8.6, RIVER_Y + 0.05, -4.8, 0.3); pirogue(b, 8.6, RIVER_Y + 0.05, -4.2, -0.5);
    extra(b, 'riv-fisher', -8.6, -4.8, 0.3, 'stand', { y: 0.3, look: { body: 'man', outfit: 'casual', outfitColor: 'green' } });
    for (const x of [1.6, 2.6, 3.6]) b.cyl(x, 0.9, -3.8, 0.05, 2.2, WOOD_DARK, { seg: 4, rz: 0.1 });
    b.box(2.6, 1.6, -3.8, 2.2, 0.04, 0.04, '#6b5a3a'); b.quad(2.6, 1.1, -3.76, 2, 0.9, '#8b8a70');
    for (let i = 0; i < 12; i++) { const x = -13 + rand() * 26, z = -3.4 - rand() * 1.4; b.cyl(x, RIVER_Y + 0.5, z, 0.03, 1, '#7e8f48', { seg: 3, rz: (rand() - 0.5) * 0.3 }); }
    // The promenade: a rail along the edge, benches, lamps, the venue's name on a board
    for (let x = -13; x <= 13; x += 2) b.cyl(x, 0.7, -2.5, 0.06, 1.4, METAL_DARK, { seg: 4 });
    b.box(0, 1.35, -2.5, 27.4, 0.06, 0.08, METAL_DARK);
    signBoard(b, -4, 6.6, label, { y: 1.6, size: fit(label, 5.6, 0.34), color: '#f1e6c4', board: '#2f4a45' });
    bench(b, 0.6, -1, { w: 2.6, ry: PI, back: true, color: '#8a6644', leg: '#5f4630' }); bench(b, 7, -1, { w: 2.6, ry: PI, back: true, color: '#8a6644', leg: '#5f4630' });
    lampPost(b, 4, 2.4, { light: true }); lampPost(b, -10, 2.4);
    extra(b, 'riv-sitter', 0.6, -1, PI, 'sit', { seat: 0.6 }); extra(b, 'riv-walker', -4.8, 1.4, HALF, 'walk');
    extra(b, 'riv-washer', -11.8, -1.6, PI, 'work', { look: { body: 'woman', outfit: 'casual', outfitColor: 'orange', fabric: 'adire' } });
    for (const [x, z, s, t] of ([[-12, 6, 1.25, 2], [-8.4, 10, 1.1, 0], [12, 5.6, 1.2, 1], [9.4, 10, 0.95, 2]] as [number, number, number, number][])) leafTree(b, x, z, { s, tone: t });
    palm(b, 13, 1.4, { s: 1 }); bush(b, -3.4, 6.4, { s: 0.9 }); bush(b, 6.4, 7, { s: 1 });
    return {
      spots: [
        landmark('bank', /bank|river|view|water|walk|bridge|shore|edge/, 2.6, -0.4, PI),
        landmark('work', /work|staff|ranger|fish|job|shift/, 5, 3, 0.4, { act: { pose: 'work' } }),
        landmark('bench', /bench|sit|rest|chill|relax/, 4, 0.2, -HALF, { act: { pose: 'sit', x: 7, z: -1, ry: PI, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 3.6, 4.8, 0),
      ],
      crowd: [[2.4, 3.4, 0.4], [-1.4, 5.6, -0.5], [4.2, 5.4, 2.6], [-3.4, 3.2, 1.2], [6.4, 2.6, -1], [-8, 3.2, 1.6], [1.2, 8, 2.2], [8.6, 5.6, -0.6], [-5.8, 7.6, 0.2], [-6.4, 0.2, PI], [-10, 1, 2.6], [6.8, 9, 0.4]],
      spare: [[-4, 6.8], [0, 6.2], [4, 7.4], [2, 9.2]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Cathedral: a church of grey stone with a square tower, pointed windows, a porch and a churchyard.

function pointedWindow(b: Batch, x: number, y: number, z: number, w: number, h: number, ry = 0, glass: Colour = '#4f78b8'): void {
  b.at(x, y, z, ry, () => {
    b.box(0, 0, 0, w + 0.3, h + 0.2, 0.08, '#cfc8b4');
    b.box(0, 0, 0.04, w, h, 0.06, glass);
    b.cone(0, h / 2 + 0.3, 0.02, w * 0.72, 0.6, '#cfc8b4', { seg: 4, ry: PI / 4 });
    b.box(0, 0, 0.08, 0.06, h, 0.04, '#cfc8b4');
  });
}

const cathedral: SceneDef = {
  mood: 'outdoor', accent: '#e0b04a',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#78a05a', edge: '#4f7a46' });
    b.box(0, 0.05, 3, 4, 0.05, 20, '#d4c8a8'); b.box(0, 0.05, 1.6, 26, 0.05, 2.4, '#d4c8a8');
    const stone = '#a3a094', stoneD = '#8c897d', trim = '#cdc8b6';
    // The nave runs back along z; its gable end faces the camera with a porch and a rose window
    b.box(2.4, 3.6, -7.4, 9.6, 7.2, 11.6, stone);
    b.box(2.4, 0.4, -7.4, 10, 0.8, 12, stoneD);
    for (const side of [-1, 1]) b.box(2.4 + side * 2.5, 8.55, -7.4, 5.9, 0.25, 12.6, side < 0 ? '#8a4e34' : '#7d4630', { rz: -side * 0.5 });
    b.box(2.4, 10.05, -7.4, 0.5, 0.3, 12.7, '#6f3f2d');
    for (let i = 0; i < 4; i++) { const z = -11.4 + i * 3; pointedWindow(b, -2.42, 3.4, z, 1.1, 3, -HALF); pointedWindow(b, 7.22, 3.4, z, 1.1, 3, HALF); }
    pointedWindow(b, 2.4, 4.4, -1.52, 1.5, 3.6); b.cyl(2.4, 6.9, -1.5, 0.7, 0.08, '#c9423a', { seg: 12, rx: HALF }); b.cyl(2.4, 6.9, -1.46, 0.45, 0.06, '#e0b04a', { seg: 12, rx: HALF });
    b.box(2.4, 1.2, -1.5, 2.2, 2.4, 0.5, '#4a3626'); b.cone(2.4, 2.6, -1.4, 1.5, 1.4, trim, { seg: 4, ry: PI / 4, sx: 0.9 });
    // The tower: square, buttressed, with louvred bell openings, battlements and four pinnacles
    b.box(-4.4, 5.6, -2.6, 4.4, 11.2, 4.4, stone); b.box(-4.4, 0.4, -2.6, 4.8, 0.8, 4.8, stoneD);
    for (const [dx, dz] of [[-2.4, 2.4], [2.4, 2.4], [-2.4, -2.4], [2.4, -2.4]] as [number, number][]) b.box(-4.4 + dx, 1.4, -2.6 + dz, 0.8, 2.8, 0.8, stoneD);
    for (const y of [3.2, 6.4]) b.box(-4.4, y, -2.6, 4.7, 0.18, 4.7, trim);
    pointedWindow(b, -4.4, 4.6, -0.36, 0.9, 2, 0); pointedWindow(b, -4.4, 8.4, -0.36, 1.1, 2.4, 0, '#2f2a24'); pointedWindow(b, -2.18, 8.4, -2.6, 1.1, 2.4, HALF, '#2f2a24');
    b.box(-4.4, 11.4, -2.6, 5, 0.4, 5, trim);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { b.box(-4.4 - 2.2 + i * 0.88, 12, -2.6 + s * 2.3, 0.5, 0.7, 0.4, stone); b.box(-4.4 + s * 2.3, 12, -2.6 - 2.2 + i * 0.88, 0.4, 0.7, 0.5, stone); }
    for (const [dx, dz] of [[-2.3, 2.3], [2.3, 2.3], [-2.3, -2.3], [2.3, -2.3]] as [number, number][]) b.cone(-4.4 + dx, 13.1, -2.6 + dz, 0.38, 1.6, stoneD, { seg: 4, ry: PI / 4 });
    b.cone(-4.4, 13.6, -2.6, 2.1, 3.4, '#6f6a60', { seg: 4, ry: PI / 4 }); b.box(-4.4, 15.7, -2.6, 0.1, 1.2, 0.1, '#d6a83a'); b.box(-4.4, 16, -2.6, 0.6, 0.1, 0.1, '#d6a83a');
    b.box(-4.4, 1.3, -0.34, 1.5, 2.6, 0.1, '#4a3626'); b.cone(-4.4, 2.8, -0.3, 1.1, 0.9, trim, { seg: 4, ry: PI / 4 });
    // Churchyard: low wall, gate, plain stone crosses and flower beds, a signboard
    b.box(-8, 0.45, 12, 11, 0.9, 0.4, '#a3a094'); b.box(8, 0.45, 12, 11, 0.9, 0.4, '#a3a094');
    for (const x of [-2.3, 2.3]) { b.box(x, 1.2, 12, 0.7, 2.4, 0.7, '#8c897d'); b.cone(x, 2.8, 12, 0.6, 0.8, '#6f6a60', { seg: 4, ry: PI / 4 }); }
    for (const [x, z] of ([[-10, 4], [-8.2, 6.2], [-11.4, 7], [10, 3.4], [11.4, 6.2], [8.6, 7.6]] as [number, number][])) { b.box(x, 0.3, z, 0.8, 0.6, 1.8, '#8c897d'); b.box(x, 0.8, z - 0.5, 0.2, 0.9, 0.2, '#cfc8b4'); b.box(x, 1, z - 0.5, 0.6, 0.18, 0.2, '#cfc8b4'); }
    for (const [x, z] of ([[-1.2, 4.6], [5.6, 4.6]] as [number, number][])) { b.box(x, 0.2, z, 2.2, 0.4, 1.2, '#7a5a3c'); for (let i = 0; i < 4; i++) b.ico(x - 0.8 + i * 0.5, 0.5, z, 0.22, 0.18, 0.22, ['#e9614b', '#e8c43a', '#f1efe8', '#dd6fa0'][i]!); }
    signBoard(b, -9.4, 10, label, { y: 1.5, size: fit(label, 6, 0.34), color: '#f1e6c4', board: '#2f3b36' });
    bench(b, 7.4, 3.4, { w: 2.6, back: true, ry: PI, color: '#8a6644' }); extra(b, 'cath-sitter', 7.4, 3.4, PI, 'sit', { seat: 0.6 });
    extra(b, 'cath-verger', 2.4, -0.4, PI, 'stand', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream' } });
    extra(b, 'cath-visitor', -7, 3, 1.4, 'walk'); extra(b, 'cath-visitor-2', 4.6, 8, 3, 'stand', { look: { body: 'woman', outfit: 'owambe', outfitColor: 'violet', fabric: 'asooke', hair: 'gele' } });
    leafTree(b, -13, 1.6, { s: 1.3, tone: 0 }); leafTree(b, 13, 1.4, { s: 1.2, tone: 2 }); tallTree(b, 12, -6, { h: 8, s: 1, tone: 2 }); palm(b, -12.6, 10.4, { s: 1 });
    lampPost(b, -2.2, 7, { light: true }); lampPost(b, 2.2, 7);
    return {
      spots: [
        landmark('hall', /hall|nave|aisle|chapel|cathedral|church|worship|quiet|pray|sit/, 2.4, 1.2, PI),
        landmark('tower', /tower|bell|history/, -4.4, 2.6, PI),
        landmark('work', /work|staff|office|verger|attend/, 6.2, 0.4, PI, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 0.6, 7.8, 0),
      ],
      crowd: [[2.4, 5.6, 0.4], [-2.4, 7.8, -0.5], [7.6, 6.2, 2.4], [-6, 5.2, 1.2], [8.6, 9.8, -0.8], [-8.4, 9, 0.8], [4, 10.4, 2.8], [-5.2, 10.2, 2.4], [-12, 5, 1.6], [11, 1.2, -0.4], [0.2, 9.6, 3.1], [5.4, 4.6, 0.6]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Mosque court: a white prayer hall with an arcade and a green dome, a minaret, a washing court and a shoe rack.

function minaret(b: Batch, x: number, z: number, h: number): void {
  b.box(x, 0.4, z, 2.2, 0.8, 2.2, '#e6e0cc');
  b.cyl(x, h / 2, z, 0.8, h, '#f4f0e2', { seg: 8, top: 0.72 });
  for (const y of [h * 0.45, h * 0.82]) { b.cyl(x, y, z, 1.1, 0.2, '#e6e0cc', { seg: 8 }); b.cyl(x, y + 0.5, z, 0.98, 0.1, '#2f8f6a', { seg: 8 }); }
  for (let i = 0; i < 5; i++) b.box(x, 2 + i * (h * 0.4 / 5) * 1.1, z + 0.78, 0.2, 0.7, 0.06, '#2f2b26');
  b.cyl(x, h + 0.4, z, 0.7, 0.8, '#f4f0e2', { seg: 8 });
  b.ball(x, h + 1.2, z, 0.7, 0.9, 0.7, '#2f8f6a', { seg: 8 });
  b.cyl(x, h + 2.4, z, 0.04, 1.4, '#d6a83a', { seg: 4 }); b.ball(x, h + 3, z, 0.18, 0.18, 0.18, '#d6a83a', { seg: 5 });
}

const mosqueCourt: SceneDef = {
  mood: 'outdoor', accent: '#2f8f6a',
  walk: OPEN,
  build(b, context) {
    const label = plain(context.label);
    ground(b, { w: 30, d: 26, color: '#d9d0b6', edge: '#a89e82' });
    for (let x = -13; x <= 13; x += 2) for (let z = -3; z <= 11; z += 2) if ((x + z) % 4 === 0) b.box(x, 0.06, z, 2, 0.02, 2, '#c9bfa2');
    // The prayer hall: wide, white, with an arcade along the front and a green dome over its middle
    b.box(0, 2.6, -8.6, 18, 5.2, 8, '#f4f0e2'); b.box(0, 5.35, -8.6, 18.6, 0.3, 8.6, '#d8d2bc');
    for (let i = 0; i < 8; i++) { const x = -7.7 + i * 2.2; b.box(x, 1.5, -4.54, 1.5, 2.6, 0.12, '#2f6f5c'); b.cyl(x, 2.8, -4.54, 0.75, 0.12, '#2f6f5c', { seg: 10, rx: HALF }); b.cyl(x + 1.1, 1.6, -3.7, 0.2, 3.2, WHITE, { seg: 6 }); }
    b.cyl(-8.8, 1.6, -3.7, 0.2, 3.2, WHITE, { seg: 6 }); b.box(0, 3.3, -3.7, 19, 0.3, 1.4, '#e6e0cc');
    for (const x of [-6.6, 6.6]) windowPane(b, x, 4.4, -4.56, { w: 1.2, h: 1.2, glass: '#6fb09a', frame: '#e6e0cc' });
    b.cyl(0, 5.8, -8.6, 3.8, 1, '#f4f0e2', { seg: 16 });
    b.ball(0, 6.5, -8.6, 3.8, 3, 3.8, '#2f8f6a', { seg: 14 });
    b.cyl(0, 9.6, -8.6, 0.05, 1.4, '#d6a83a', { seg: 4 }); b.ball(0, 10.4, -8.6, 0.2, 0.2, 0.2, '#d6a83a', { seg: 5 });
    for (const x of [-7.4, 7.4]) b.ball(x, 5.9, -8.6, 1.5, 1.2, 1.5, '#2f8f6a', { seg: 10 });
    minaret(b, -11.4, -5.4, 11.4);
    // A washing court: a low wall with taps along it, a shoe rack, prayer mats on the paving
    b.box(8.8, 0.5, 4.4, 7, 1, 0.5, '#e6e0cc');
    for (let i = 0; i < 4; i++) { b.cyl(6.6 + i * 1.5, 1.05, 4.2, 0.07, 0.28, METAL, { seg: 5 }); b.box(6.6 + i * 1.5, 0.15, 3.6, 0.5, 0.3, 0.5, '#8aa0aa'); }
    b.box(-9.4, 0.6, 5.6, 3.2, 1.2, 0.9, WOOD); for (let i = 0; i < 6; i++) b.box(-10.6 + i * 0.5, 0.9, 5.6, 0.34, 0.14, 0.2, ['#c9423a', '#2f8f55', '#e0a43a'][i % 3]!);
    for (let i = 0; i < 4; i++) b.box(-4.2 + i * 1.5, 0.08, -1.6, 1, 0.05, 2.2, i % 2 ? '#2f8f6a' : '#a8323a');
    labelled(b, label, 0, 4.2, -4.4, 8.4, 0.44, '#f4e6b8', '#2f6f5c', false);
    // Low boundary wall with a gate, date palms, lamps
    b.box(-8.6, 0.6, 12, 12, 1.2, 0.4, '#e6e0cc'); b.box(8.6, 0.6, 12, 12, 1.2, 0.4, '#e6e0cc');
    for (const x of [-2.2, 2.2]) { b.box(x, 1.4, 12, 0.7, 2.8, 0.7, '#e6e0cc'); b.ball(x, 3.0, 12, 0.35, 0.4, 0.35, '#2f8f6a', { seg: 6 }); }
    for (const [x, z] of ([[-13, 3], [13, 2], [13.4, 9], [-13.4, 10]] as [number, number][])) palm(b, x, z, { s: 1.1 });
    lampPost(b, -4, 6, { light: true }); lampPost(b, 4, 6);
    extra(b, 'mosque-imam', 0, -3.2, PI, 'stand', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream', accessories: ['fila'] } });
    extra(b, 'mosque-washer', 8.2, 3.2, PI, 'work', { look: { body: 'man', outfit: 'kaftan', outfitColor: 'cream' } });
    extra(b, 'mosque-visitor', -6.4, 2, 1.4, 'stand', { look: { body: 'woman', outfit: 'kaftan', outfitColor: 'teal', accessories: ['headwrap'] } });
    return {
      spots: [
        landmark('hall', /hall|prayer|mosque|worship|quiet|pray|sit|mat/, 0, -1.4, PI),
        landmark('court', /court|wash|ablut|tap|shoe/, 8.6, 2.4, PI),
        landmark('work', /work|staff|office|attend|imam/, 4.4, -2.2, PI, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 0.6, 7.8, 0),
      ],
      crowd: [[2.4, 5.6, 0.4], [-2.4, 7.8, -0.5], [7.6, 7.2, 2.4], [-7, 7.2, 1.2], [8.6, 9.8, -0.8], [-8.4, 9.6, 0.8], [4, 10.4, 2.8], [-5.2, 10.2, 2.4], [-12, 7, 1.6], [11, 6, -0.4], [0.2, 9.6, 3.1], [-3.4, 1.4, 0.6]],
      spare: [[-6, 8.6], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

/** Variant scenes by scene kind, then by variant (venue.scene.variant). */
const RAW: Record<string, Record<string, SceneDef>> = ({
  rooftop: { outcrop },
  market: { adire },
  statehouse: { 'palace-court': palaceCourt, 'ojude-ground': ojude },
  walk: { hall, library },
  park: { 'river-bridge': riverBridge },
  worship: { cathedral, 'mosque-court': mosqueCourt },
});

/** A wide scene in a tall window needs the camera further back than the rooms do. */
const WIDE: SceneCamera = { landscape: [15, 19.8, 25.4], portrait: [18, 40, 52] };
export const VARIANTS: Readonly<Record<string, Readonly<Record<string, SceneDef>>>> = Object.freeze(Object.fromEntries(Object.entries(RAW).map(([kind, variants]) => [kind, Object.freeze(Object.fromEntries(Object.entries(variants).map(([variant, def]) => [variant, def.mood === 'outdoor' && !def.camera ? { ...def, camera: WIDE } : def])))])));
