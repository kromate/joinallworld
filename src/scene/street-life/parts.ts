/**
 * OWNER: scenes
 * Street scenery as lists of instanced parts (zoom phase 3b). Pure. The shopfronts (shopfronts.ts) and the street furniture
 * (furniture.ts) are planned as these, and scenery.ts draws each list as ONE InstancedMesh: four draw calls for the whole street.
 *
 *   boxes   unit boxes in a colour (awnings, pilasters, posts, trunks, bins, benches, bollards, crossing stripes)
 *   glows   unit boxes lit from inside at dusk and night (shop glass, lamp heads)
 *   quads   cells of one canvas atlas (shop signs, mannequins in the windows, the flag)
 *   blobs   low round shapes (tree canopies, shrubs in planters)
 */
/** `bay` names the shop bay a window or a sign belongs to (its index in the plan's bays): the light on it is that shop's. */
export interface BoxPart { x: number; y: number; z: number; w: number; h: number; d: number; ry: number; colour: string; tilt?: number; bay?: number }
export interface QuadPart { x: number; y: number; z: number; w: number; h: number; ry: number; cell: number; lit?: boolean; bay?: number }
export interface BlobPart { x: number; y: number; z: number; r: number; colour: string }
export interface Parts { boxes: BoxPart[]; glows: BoxPart[]; quads: QuadPart[]; blobs: BlobPart[] }

/** Triangles each kind of part costs (a box; a quad; an icosahedron). */
export const BOX_TRIANGLES = 12, QUAD_TRIANGLES = 2, BLOB_TRIANGLES = 20;
export const emptyParts = (): Parts => ({ boxes: [], glows: [], quads: [], blobs: [] });
export function joinParts(...all: readonly Parts[]): Parts {
  const out = emptyParts();
  for (const p of all) { out.boxes.push(...p.boxes); out.glows.push(...p.glows); out.quads.push(...p.quads); out.blobs.push(...p.blobs); }
  return out;
}
export const partTriangles = (p: Parts): number => (p.boxes.length + p.glows.length) * BOX_TRIANGLES + p.quads.length * QUAD_TRIANGLES + p.blobs.length * BLOB_TRIANGLES;
/** One draw call per kind that has any. */
export const partCalls = (p: Parts): number => [p.boxes, p.glows, p.quads, p.blobs].filter((list) => list.length > 0).length;

// ---- the atlas ---------------------------------------------------------------------------------------------------------------------

/** The canvas atlas (px): SIGN_ROWS rows of two sign cells (512 × 64), then four mannequin cells (128 × 256) and a flag cell (384 × 256). */
export const ATLAS_SIZE = 1024, SIGN_W = 512, SIGN_H = 64, SIGN_ROWS = 12;
export const SIGN_CELLS = SIGN_ROWS * 2, MANNEQUIN_CELLS = 4;
export const FIRST_MANNEQUIN = SIGN_CELLS, FLAG_CELL = SIGN_CELLS + MANNEQUIN_CELLS;
/** A cell's rectangle on the canvas, in px from the top left. */
export function atlasRect(cell: number): { x: number; y: number; w: number; h: number } {
  if (cell < SIGN_CELLS) return { x: (cell % 2) * SIGN_W, y: Math.floor(cell / 2) * SIGN_H, w: SIGN_W, h: SIGN_H };
  const top = SIGN_ROWS * SIGN_H;
  if (cell < FLAG_CELL) return { x: (cell - FIRST_MANNEQUIN) * 128, y: top, w: 128, h: 256 };
  return { x: 512, y: top, w: 384, h: 256 };
}
/** A cell as texture coordinates for a canvas texture (flipY): the offset (u, v) and the scale (su, sv) of the quad's 0…1 uv. */
export function atlasUv(cell: number): [number, number, number, number] {
  const r = atlasRect(cell);
  return [r.x / ATLAS_SIZE, 1 - (r.y + r.h) / ATLAS_SIZE, r.w / ATLAS_SIZE, r.h / ATLAS_SIZE];
}
