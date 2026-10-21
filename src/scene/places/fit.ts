// OWNER: scenes (unique places)
// Where a place model stands behind a venue and how large it is drawn. Pure arithmetic on a bounding box, so it is tested without a renderer.
//
// A model is in metres, +Y up, ground at y = 0, main facade facing +Z (towards the camera). A venue scene is a small plot (about 27 x 22
// scene units, 1.4 units to the metre) with a low wall along its back edge (-Z). The model stands in the open ground BEHIND that wall, outside the
// walkable footprint, so it can never block a route, a spot or a resident, and the recipe's own rear-band reservation is not touched. It is
// scaled uniformly to fit the slot, never above life size (a small shop is not enlarged), and centred on the plot's middle line.
import { PLACE_METRES_TO_SCENE } from './limits.ts';

export interface Box3 { min: readonly [number, number, number]; max: readonly [number, number, number] }
/** The free space behind the wall, in scene units: how wide, how deep (away from the camera), how tall, and the Z of the model's front edge. */
export interface PlaceSlot { centreX: number; frontZ: number; width: number; depth: number; height: number }
export interface PlaceFit {
  /** Scene units per metre of model. */
  scale: number
  /** The model's origin in the venue frame: x, y and z; rotation is 0 (the facade faces the camera). */
  x: number; y: number; z: number; ry: 0
  /** The drawn extent in scene units. */
  size: readonly [number, number, number]
}

export function boxOf(positions: readonly Float32Array[]): Box3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { const v = p[i + a]!; if (v < min[a]!) min[a] = v; if (v > max[a]!) max[a] = v; }
  return { min, max };
}

/** The slot behind a recipe venue's back wall. The wall is `footprint.w - 1` long and stands on the footprint's back edge. */
export function recipePlaceSlot(footprint: { w: number; d: number }): PlaceSlot {
  return { centreX: 0, frontZ: -footprint.d / 2 - 0.6, width: Math.max(8, footprint.w - 1), depth: 12, height: 24 };
}

export function fitPlaceModel(box: Box3, slot: PlaceSlot, maxScale = PLACE_METRES_TO_SCENE): PlaceFit {
  const w = box.max[0] - box.min[0], h = box.max[1] - box.min[1], d = box.max[2] - box.min[2];
  if (![w, h, d].every(n => Number.isFinite(n) && n > 0)) throw new Error('Place model has empty bounds');
  const scale = Math.min(maxScale, slot.width / w, slot.height / h, slot.depth / d);
  const cx = (box.min[0] + box.max[0]) / 2;
  return {
    scale, ry: 0,
    x: slot.centreX - cx * scale, y: -box.min[1] * scale, z: slot.frontZ - box.max[2] * scale,
    size: [w * scale, h * scale, d * scale],
  };
}
