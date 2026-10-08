import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import type { TileRef, WorldManifest, WorldTile } from './types.ts';
import { WORLD_LIMITS } from './types.ts';
import { validateManifest, validateTile } from './validate.ts';

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = normalize((value as Record<string, unknown>)[key]);
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonical JSON cannot encode non-finite numbers');
  if (typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') throw new TypeError('value is not JSON data');
  return value;
}
export function canonicalJson(value: unknown): string {
  const result = JSON.stringify(normalize(value));
  if (result === undefined) throw new TypeError('value is not JSON data');
  return result;
}
export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
const bytesOf = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
const compressedSize = (bytes: Uint8Array) => brotliCompressSync(bytes, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } }).byteLength;

/** Upper bound for a closed polygon mesh: caps plus two triangles per boundary edge. */
function triangleCount(tile: WorldTile): number {
  let total = 0;
  for (const b of tile.buildings) {
    const vertices = b.rings.reduce((n, r) => n + r.length - 1, 0), holes = b.rings.length - 1;
    // Ear clipping with holes needs at most V + 2H - 2 cap triangles. Count both caps and walls.
    total += 2 * (vertices + 2 * holes - 2) + 2 * vertices;
  }
  // Roads use a two-triangle quad per segment; eight-sided end/join caps are budgeted generously.
  for (const r of tile.roads) total += 2 * (r.points.length - 1) + 16 * r.points.length;
  return total;
}
function drawCallCount(tile: WorldTile): number { return tile.buildings.length + tile.roads.length; }

export function encodeTile(value: WorldTile): { ref: TileRef; bytes: Uint8Array } {
  const tile = validateTile(value), bytes = bytesOf(tile), digest = sha256(bytes), triangles = triangleCount(tile), drawCalls = drawCallCount(tile), brotliBytes = compressedSize(bytes);
  if (bytes.byteLength > 10_000_000) throw new TypeError('tile raw JSON exceeds 10 MB');
  if (brotliBytes > WORLD_LIMITS.tileBrotliBytes) throw new TypeError(`tile Brotli budget exceeded: ${brotliBytes}`);
  if (triangles > WORLD_LIMITS.tileTriangles) throw new TypeError(`tile triangle budget exceeded: ${triangles}`);
  if (drawCalls > WORLD_LIMITS.visibleDrawCalls) throw new TypeError(`tile draw-call budget exceeded: ${drawCalls}`);
  const ref: TileRef = { id: tile.id, path: `tiles/${digest}.json`, sha256: digest, bytes: bytes.byteLength, brotliBytes, triangles, drawCalls, bounds: tile.bounds };
  return { ref, bytes };
}
export function encodeManifest(value: WorldManifest): { hash: string; bytes: Uint8Array } {
  const manifest = validateManifest(value), bytes = bytesOf(manifest), brotliBytes = compressedSize(bytes);
  if (brotliBytes > WORLD_LIMITS.bootstrapBrotliBytes) throw new TypeError(`manifest Brotli budget exceeded: ${brotliBytes}`);
  return { hash: sha256(bytes), bytes };
}
