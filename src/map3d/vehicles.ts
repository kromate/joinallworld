/**
 * OWNER: world
 * Small procedural vehicles for the city map, drawn into a geometry batch (src/scene/build.js)
 * at the origin, facing +z, in the same scale as an avatar (about three units tall).
 *
 *   VEHICLES[kind](b, options) → { seat: { x, y, z }, length }
 * `seat` is where the travelling player's seated avatar goes; the vehicle is open enough for the
 * avatar to be seen in or on it. The danfo and the keke come with a driver, the okada with its rider.
 * miniVehicle(b, kind) draws the few-triangle version used for the instanced street traffic.
 */
import { GLOW, GLASS } from '../scene/build.js';
import type { Point3 } from './types.ts';

/** The options a geometry batch (src/scene/build.js createBatch) takes on a shape. */
export interface ShapeOptions { rx?: number; ry?: number; rz?: number; seg?: number; layer?: string; part?: string; top?: number; open?: boolean; sx?: number; sz?: number }
/** The methods of a geometry batch that the vehicles draw with. */
export interface VehicleBatch {
  box(x: number, y: number, z: number, w: number, h: number, d: number, colour: string, o?: ShapeOptions): unknown;
  cyl(x: number, y: number, z: number, r: number, h: number, colour: string, o?: ShapeOptions): unknown;
  cone(x: number, y: number, z: number, r: number, h: number, colour: string, o?: ShapeOptions): unknown;
  ball(x: number, y: number, z: number, rx: number, ry: number, rz: number, colour: string, o?: ShapeOptions): unknown;
  at(x: number, y: number, z: number, ry: number, draw: (batch: VehicleBatch) => void): unknown;
}
/** What drawing a vehicle reports: where the seated traveller goes, and how long it is. */
export interface VehicleFit { seat: Point3; length: number }
export type VehicleKind = 'danfo' | 'keke' | 'okada' | 'cab' | 'car';
/** One entry of VEHICLES: draws the vehicle into a batch. */
export type DrawVehicle = (b: VehicleBatch, options?: { colour?: string }) => VehicleFit;

const TYRE = '#1d1f23', YELLOW = '#f4c21b', BLACK = '#1f2226', CHROME = '#c9ced3', LAMP = '#fff2c2', TAIL = '#ff5a4a';
const wheel = (b: VehicleBatch, x: number, y: number, z: number, r = 0.38, w = 0.26) => { b.cyl(x, y, z, r, w, TYRE, { seg: 8, rz: Math.PI / 2 }); b.cyl(x, y, z, r * 0.45, w + 0.02, '#8a9097', { seg: 6, rz: Math.PI / 2 }); };

/** A simple seated figure: the driver or the okada rider. */
function figure(b: VehicleBatch, x: number, y: number, z: number, shirt: string, skin = '#845236', helmet: string | null = null) {
  b.box(x, y + 0.42, z, 0.5, 0.7, 0.34, shirt);
  b.box(x, y + 0.06, z + 0.24, 0.46, 0.2, 0.6, '#2b3140');
  b.ball(x, y + 1.02, z, 0.23, 0.24, 0.23, skin, { seg: 6 });
  if (helmet) b.ball(x, y + 1.1, z - 0.02, 0.27, 0.22, 0.28, helmet, { seg: 6 });
  for (const side of [-1, 1]) b.box(x + side * 0.3, y + 0.5, z + 0.22, 0.13, 0.13, 0.56, shirt);
}

function danfo(b: VehicleBatch): VehicleFit {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(b, sx * 0.98, 0.4, sz * 1.5, 0.4);
  b.box(0, 0.98, 0, 2.05, 0.95, 4.7, YELLOW);
  for (const sx of [-1, 1]) for (const y of [0.78, 1.08]) b.box(sx * 1.035, y, 0, 0.02, 0.13, 4.7, BLACK);
  b.box(0, 0.62, 2.38, 2.1, 0.22, 0.12, BLACK); b.box(0, 0.62, -2.38, 2.1, 0.22, 0.12, BLACK);
  for (const sx of [-1, 1]) for (const z of [-2.25, -0.85, 0.55, 1.6]) b.box(sx * 0.96, 1.86, z, 0.13, 0.84, 0.13, YELLOW);
  b.box(0, 1.86, -2.3, 2.05, 0.84, 0.1, YELLOW);
  b.box(0, 2.34, -0.1, 2.05, 0.14, 4.5, YELLOW);
  b.box(0, 2.5, -0.6, 1.5, 0.08, 2.2, '#6b6f75');                      // roof rack and a load
  b.box(-0.2, 2.72, -0.7, 0.9, 0.36, 1.1, '#b5483f'); b.box(0.45, 2.66, -0.1, 0.5, 0.26, 0.6, '#3f72c4');
  b.box(0, 1.84, 2.2, 1.86, 0.74, 0.05, '#bfe0ee', { rx: -0.12, ...GLASS });
  for (const sx of [-1, 1]) { b.box(sx * 0.7, 0.92, 2.36, 0.36, 0.2, 0.05, LAMP, GLOW); b.box(sx * 0.75, 0.95, -2.36, 0.3, 0.18, 0.05, TAIL, GLOW); }
  figure(b, -0.48, 1.0, 1.25, '#3f9a5a');                              // the driver
  figure(b, 0.5, 1.0, -1.3, '#c9423a', '#6e422c'); figure(b, -0.5, 1.0, -1.35, '#e0822f', '#573323');   // it is never empty
  return { seat: { x: 0.5, y: 1.05, z: 0.1 }, length: 4.7 };
}

function keke(b: VehicleBatch): VehicleFit {
  wheel(b, 0, 0.32, 1.35, 0.32, 0.2);
  for (const sx of [-1, 1]) wheel(b, sx * 0.72, 0.32, -0.95, 0.32, 0.22);
  b.box(0, 0.5, -0.1, 1.5, 0.18, 2.5, BLACK);
  b.box(0, 0.86, -1.05, 1.6, 0.66, 0.9, YELLOW);
  b.box(0, 0.86, -1.52, 1.62, 0.12, 0.04, BLACK);
  b.box(0, 0.95, 1.05, 0.95, 0.85, 0.5, YELLOW);
  b.box(0, 1.7, 1.02, 1.3, 0.72, 0.04, '#bfe0ee', { rx: -0.2, ...GLASS });
  for (const sx of [-1, 1]) { b.box(sx * 0.72, 1.55, -1.42, 0.08, 1.0, 0.08, BLACK); b.box(sx * 0.66, 1.6, 0.95, 0.07, 1.0, 0.07, BLACK); }
  b.box(0, 2.12, -0.2, 1.62, 0.12, 2.7, YELLOW);
  b.box(0, 2.2, -0.2, 1.3, 0.06, 2.3, '#2f8f55');
  b.box(0, 1.02, 1.32, 0.3, 0.22, 0.05, LAMP, GLOW);
  figure(b, 0, 0.72, 0.42, '#3f72c4');
  return { seat: { x: 0, y: 0.92, z: -0.7 }, length: 2.9 };
}

function okada(b: VehicleBatch): VehicleFit {
  wheel(b, 0, 0.42, 1.0, 0.42, 0.16); wheel(b, 0, 0.42, -0.95, 0.42, 0.18);
  b.box(0, 0.72, 0, 0.3, 0.34, 1.5, '#c9423a');
  b.box(0, 0.98, 0.3, 0.38, 0.3, 0.6, '#c9423a');
  b.box(0, 0.98, -0.45, 0.42, 0.14, 1.0, BLACK);
  b.box(0, 0.86, 0.9, 0.1, 0.9, 0.1, CHROME, { rx: 0.4 });
  b.box(0, 1.28, 0.74, 0.92, 0.07, 0.07, CHROME);
  b.box(0, 1.12, 1.02, 0.22, 0.2, 0.08, LAMP, GLOW);
  b.box(0.2, 0.5, -0.7, 0.1, 0.1, 0.9, CHROME);
  figure(b, 0, 1.0, 0.02, '#e0822f', '#6e422c', '#2b5fa8');
  return { seat: { x: 0, y: 1.08, z: -0.72 }, length: 2.3 };
}

function saloon(b: VehicleBatch, body: string, { taxi = false, seat }: { taxi?: boolean; seat: Point3 }): VehicleFit {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheel(b, sx * 0.9, 0.36, sz * 1.32, 0.36);
  b.box(0, 0.66, 0, 1.9, 0.62, 4.2, body);
  b.box(0, 0.42, 2.12, 1.9, 0.2, 0.1, CHROME); b.box(0, 0.42, -2.12, 1.9, 0.2, 0.1, CHROME);
  for (const sx of [-1, 1]) for (const z of [-1.2, -0.25, 0.75]) b.box(sx * 0.86, 1.3, z, 0.1, 0.66, 0.1, body);
  b.box(0, 1.68, -0.22, 1.82, 0.1, 2.1, body);
  b.box(0, 1.3, 0.86, 1.66, 0.66, 0.04, '#bfe0ee', { rx: -0.3, ...GLASS });
  b.box(0, 1.3, -1.3, 1.66, 0.62, 0.04, '#bfe0ee', { rx: 0.25, ...GLASS });
  if (taxi) {
    b.box(0, 1.84, -0.2, 0.7, 0.2, 0.3, YELLOW, GLOW);
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) b.box(sx * 0.955, 0.7, -1.75 + i * 0.7, 0.02, 0.18, 0.35, i % 2 ? BLACK : YELLOW);
  }
  for (const sx of [-1, 1]) { b.box(sx * 0.62, 0.74, 2.11, 0.36, 0.16, 0.04, LAMP, GLOW); b.box(sx * 0.66, 0.76, -2.11, 0.3, 0.14, 0.04, TAIL, GLOW); }
  if (taxi) figure(b, -0.42, 0.62, 0.3, '#ece2c6', '#573323');
  return { seat, length: 4.2 };
}

export const VEHICLES: Readonly<Record<VehicleKind, DrawVehicle>> = Object.freeze({
  danfo,
  keke,
  okada,
  cab: (b: VehicleBatch) => saloon(b, '#1f8a86', { taxi: true, seat: { x: 0.42, y: 0.68, z: -0.6 } }),
  car: (b: VehicleBatch, { colour = '#b23a2e' }: { colour?: string } = {}) => saloon(b, colour, { seat: { x: -0.42, y: 0.68, z: 0.3 } }),
});

/** A few-triangle vehicle for the instanced street traffic. White parts take the instance's colour. */
export function miniVehicle(b: VehicleBatch, kind: string) {
  if (kind === 'danfo') {
    b.box(0, 0.62, 0, 1.0, 0.72, 2.3, YELLOW);
    b.box(0, 0.5, 0, 1.03, 0.12, 2.32, BLACK);
    b.box(0, 0.84, 0.2, 1.02, 0.22, 1.5, '#39424d');
    b.box(0, 0.2, 0, 0.9, 0.2, 1.7, TYRE);
  } else {
    b.box(0, 0.4, 0, 0.95, 0.4, 2.0, '#ffffff');
    b.box(0, 0.76, -0.1, 0.84, 0.34, 1.05, '#ffffff');
    b.box(0, 0.78, -0.1, 0.86, 0.22, 0.9, '#39424d');
    b.box(0, 0.16, 0, 0.9, 0.18, 1.5, TYRE);
  }
}

/** A lagoon canoe with a little canopy, and a fishing boat. */
export function boat(b: VehicleBatch, x: number, z: number, ry = 0, colour = '#b5483f', canopy = true) {
  b.at(x, -0.48, z, ry, () => {
    b.box(0, 0.16, 0, 0.9, 0.32, 3.4, colour);
    b.cone(0, 0.16, 2.05, 0.46, 0.8, colour, { seg: 4, rx: Math.PI / 2 });
    b.box(0, 0.34, 0, 0.7, 0.05, 3.0, '#d9c9a0');
    if (canopy) { for (const sz of [-0.6, 0.6]) b.box(0, 0.7, sz, 0.06, 0.7, 0.06, '#5f4630'); b.box(0, 1.08, 0, 1.0, 0.07, 1.7, '#ece2c6'); }
  });
}
