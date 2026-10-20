/**
 * OWNER: scenes
 * Light that comes from things: how bright a street's lamps, windows and signs are by the hour, and who is lit. Pure: no Three.js,
 * no DOM. The draw modules (neighbourhood-scene.ts, street-life/scenery.ts, street/light-pools.ts) read these numbers and hand
 * them to their shaders as uniforms, so the sky, the lamps and the windows all follow the one clock that `timeOfDay` reads.
 *
 *   windowShare(minute)    the share of a street's windows that are lit: most of them in the early evening, few at 3 am
 *   emittersFor(...)       the brightness of glass, signs, lamp heads and ground pools for a band, a minute and a power cut
 *   bayLights(n, seed)     which shops are lit (a number a shop is compared with) and which run a generator, from the street's seed
 *   buildingSeed(x, z)     the number a building is compared with, the same on every device
 *
 * A power cut (NEPA off) darkens every lamp and window and sign, except a shop on a generator, which stays lit a little lower.
 * On the high tier the emitters are brighter than the colour on screen can hold (a "boost"), which is what lets the post stack's
 * bloom find them; a phone gets the plain lit colour.
 */
import { makeRng } from '../../game/util.ts';
import type { TimeOfDay } from '../types.ts';

/** Control points of the lit share through a Lagos day: [minute of the day, share]. Linear between them, round the clock. */
const SHARE_POINTS: readonly (readonly [number, number])[] = Object.freeze([
  [0, 0.4], [60, 0.26], [180, 0.1], [270, 0.12], [330, 0.28], [390, 0.04], [1050, 0.55], [1110, 0.9], [1170, 0.92], [1260, 0.76], [1350, 0.55], [1440, 0.4],
]);

/** The share (0 to 1) of windows lit at a minute of the Lagos day. */
export function windowShare(minuteOfDay: number): number {
  const m = ((Number.isFinite(minuteOfDay) ? minuteOfDay : 0) % 1440 + 1440) % 1440;
  for (let i = 1; i < SHARE_POINTS.length; i++) {
    const [m1, s1] = SHARE_POINTS[i]!, [m0, s0] = SHARE_POINTS[i - 1]!;
    if (m <= m1) return s0 + (s1 - s0) * ((m - m0) / (m1 - m0));
  }
  return SHARE_POINTS[SHARE_POINTS.length - 1]![1];
}

/** How much brighter than the colour the screen can hold an emitter is drawn on the high tier (bloom finds it); 1 elsewhere. */
export const HIGH_BOOST = 1.6;

export interface Emitters {
  /** The share of windows lit (0 by day). */
  share: number
  /** 1 while the grid is on, 0 in a power cut. A generator-fed shop ignores it. */
  power: 0 | 1
  /** Emissive strength of shop glass and of the model buildings' windows, of signs, of lamp heads, and of the warm pools on the ground. */
  glass: number
  sign: number
  lamp: number
  pool: number
}
export interface EmitterInput { band: TimeOfDay; minuteOfDay: number; outage: boolean; high: boolean }

const BASE: Readonly<Record<TimeOfDay, { glass: number; sign: number; lamp: number; pool: number }>> = Object.freeze({
  day: { glass: 0.12, sign: 0, lamp: 0, pool: 0 },
  dusk: { glass: 0.85, sign: 0.55, lamp: 1.1, pool: 0.4 },
  night: { glass: 1.15, sign: 0.9, lamp: 1.5, pool: 0.8 },
});

/** What is lit and how brightly, for a band of the day, a minute and the grid. */
export function emittersFor({ band, minuteOfDay, outage, high }: EmitterInput): Emitters {
  const base = BASE[band] ?? BASE.day, boost = high && band !== 'day' ? HIGH_BOOST : 1;
  return { share: band === 'day' ? 0 : windowShare(minuteOfDay), power: outage ? 0 : 1, glass: base.glass * boost, sign: base.sign * boost, lamp: base.lamp * boost, pool: base.pool };
}

/** A key that changes when a redraw is worth it (the share moves in steps of a twentieth). */
export const emittersKey = (e: Emitters): string => `${e.power}${Math.round(e.share * 20)}${e.glass.toFixed(2)}`;

/** Each shop bay's draw: the number it is compared with the lit share (lit when below it), and whether it runs a generator in a power cut. */
export function bayLights(count: number, seed: string): { seeds: number[]; generators: boolean[] } {
  const next = makeRng(`street-life|lit|${seed}`), seeds: number[] = [], generators: boolean[] = [];
  for (let i = 0; i < count; i++) { seeds.push(next()); generators.push(next() < 0.25); }
  return { seeds, generators };
}

/** A building's number in [0, 1) from its place: windows on the same floor of one building are lit or dark together. */
export function buildingSeed(x: number, z: number): number {
  let h = 2166136261 >>> 0;
  for (const ch of `${Math.round(x * 10)},${Math.round(z * 10)}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h / 4294967296;
}

/** The same decision as the shaders make, for a floor of a building: lit when the floor's own number is below the share. */
export function floorLit(seed: number, floor: number, share: number, powered: boolean): boolean {
  if (!powered) return false;
  const x = Math.sin(seed * 91.7 * 12.9898 + floor * 17.3 * 78.233) * 43758.5453;
  return x - Math.floor(x) < share;
}

/**
 * The GLSL for the model buildings' windows, shared by the street's materials: `aSeed` is the building's number (an attribute the model
 * layer adds), `vWindowY` the height of the fragment, and the floor is a row of 3.4 units (a storey in this street kit).
 * `windowLit()` is 1 when this floor of this building is lit now.
 */
export const WINDOW_LIT_VERTEX_PARS = /* glsl */`
attribute float aSeed;
varying float vSeed;
varying float vWindowY;
`;
export const WINDOW_LIT_VERTEX = /* glsl */`
#include <begin_vertex>
vSeed = aSeed;
vWindowY = (modelMatrix * vec4(transformed, 1.0)).y;
`;
export const WINDOW_LIT_FRAGMENT_PARS = /* glsl */`
uniform float uWindowShare;
uniform float uWindowPower;
varying float vSeed;
varying float vWindowY;
float windowLit() {
  float floorRow = floor(vWindowY / 3.4);
  float r = fract(sin(vSeed * 91.7 * 12.9898 + floorRow * 17.3 * 78.233) * 43758.5453);
  return step(r, uWindowShare) * uWindowPower;
}
`;
