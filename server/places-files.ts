/**
 * OWNER: scenes (unique places)
 * The shared place models on the Node host (local development and tests): GET /assets/places/<sha256>.glb is read from a folder of
 * `<sha256>.glb` files, PLACES_DIR or scripts/places/out/store (scripts/places/manifest.ts fills it from the packer's output). The
 * Worker host reads the same address from R2 (deploy/places-route.ts); the answers carry the same headers.
 * A file is served only if it exists under exactly its hash name; whether its bytes match the name is the client's check.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PLACE_MODEL_CACHE_CONTROL, PLACE_MODEL_CONTENT_TYPE, placeModelHash } from '../src/scene/places/paths.ts';

export const defaultPlacesDir = (env: Record<string, string | undefined> = process.env): string => env.PLACES_DIR || resolve('scripts/places/out/store');

export interface PlaceFileAnswer { status: 200 | 304 | 404; headers: Record<string, string>; body: Buffer | null }

export async function servePlaceFile(dir: string, pathname: string, method: string, ifNoneMatch?: string | null): Promise<PlaceFileAnswer> {
  const missing = (): PlaceFileAnswer => ({ status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, body: method === 'HEAD' ? null : Buffer.from('Not found') });
  const hash = placeModelHash(pathname);
  if (!hash) return missing();
  const headers = { 'Content-Type': PLACE_MODEL_CONTENT_TYPE, 'Cache-Control': PLACE_MODEL_CACHE_CONTROL, ETag: `"${hash}"`, 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
  if (ifNoneMatch && ifNoneMatch.split(',').some(tag => { const t = tag.trim().replace(/^W\//, ''); return t === '*' || t === `"${hash}"`; })) return { status: 304, headers, body: null };
  let bytes: Buffer;
  try { bytes = await readFile(join(dir, `${hash}.glb`)); } catch { return missing(); }
  return { status: 200, headers: { ...headers, 'Content-Length': String(bytes.length) }, body: method === 'HEAD' ? null : bytes };
}
