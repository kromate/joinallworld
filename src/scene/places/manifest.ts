// OWNER: scenes (unique places)
// The per-city manifest of place models: which venue has which model, in three levels of detail, by content hash.
//
//   { schema: 'allworld-place-models', version: 1, city, atlas: { url, sha256 },
//     venues: { [venueId]: { archetype, lod0: { sha256, bytes, brotliBytes, triangles }, lod1: {…}, lod2: {…} } } }
//
// scripts/places/manifest.ts writes the committed JSON (scripts/places/manifest/<city>.json) and a lazy TypeScript module per city
// (src/scene/places/cities/<city>.ts) from the packer's reports. The game reads the module, never the JSON, and only when a venue or the
// map of that city is shown. This file is the one definition of the format: the generator, the loader and the tests all use it.
// No imports: the generator (Node) and the browser read it.
import { PLACE_MODEL_LIMITS } from './limits.ts'

export type PlaceLodKey = 'lod0' | 'lod1' | 'lod2'
export const PLACE_LOD_KEYS: readonly PlaceLodKey[] = Object.freeze(['lod0', 'lod1', 'lod2'] as const)
export interface PlaceLod { sha256: string; bytes: number; brotliBytes: number; triangles: number }
export interface PlaceVenueModels { archetype: string; lod0: PlaceLod; lod1: PlaceLod; lod2: PlaceLod }
export interface PlaceManifest {
  schema: 'allworld-place-models'; version: 1; city: string
  atlas: { url: string; sha256: string }
  venues: { [venueId: string]: PlaceVenueModels }
}

const fail = (path: string, message: string): never => { throw new Error(`Place manifest ${path}: ${message}`) }
const plain = (value: unknown, keys: readonly string[], path: string): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(path, 'expected an object')
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) if (!keys.includes(key)) fail(path, `unexpected field ${key}`)
  for (const key of keys) if (!Object.hasOwn(record, key)) fail(path, `missing ${key}`)
  return record
}
const hash = (value: unknown, path: string): string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : fail(path, 'expected a SHA-256')
const integer = (value: unknown, min: number, max: number, path: string): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : fail(path, `expected an integer ${min}..${max}`)
const name = (value: unknown, path: string): string => typeof value === 'string' && /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(value) && value.length <= 100 ? value : fail(path, 'invalid name')

export function parsePlaceLod(input: unknown, lod: PlaceLodKey, path: string): PlaceLod {
  const limits = PLACE_MODEL_LIMITS[lod]
  const r = plain(input, ['sha256', 'bytes', 'brotliBytes', 'triangles'], path)
  return {
    sha256: hash(r.sha256, `${path}.sha256`),
    bytes: integer(r.bytes, 20, limits.bytes, `${path}.bytes`),
    brotliBytes: integer(r.brotliBytes, 1, limits.brotliBytes, `${path}.brotliBytes`),
    triangles: integer(r.triangles, 1, limits.triangles, `${path}.triangles`),
  }
}

/** Strict parse of a city manifest (a generated module, or the committed JSON). Throws on anything outside the format or its limits. */
export function parsePlaceManifest(input: unknown, city?: string): PlaceManifest {
  const r = plain(input, ['schema', 'version', 'city', 'atlas', 'venues'], 'manifest')
  if (r.schema !== 'allworld-place-models' || r.version !== 1) fail('manifest', 'unsupported schema or version')
  const id = name(r.city, 'city')
  if (city !== undefined && id !== city) fail('city', `expected ${city}`)
  const a = plain(r.atlas, ['url', 'sha256'], 'atlas'), atlasHash = hash(a.sha256, 'atlas.sha256')
  if (a.url !== `/assets/places/trim-${atlasHash}.webp`) fail('atlas.url', 'must be /assets/places/trim-<sha256>.webp')
  if (r.venues === null || typeof r.venues !== 'object' || Array.isArray(r.venues)) fail('venues', 'expected an object')
  const venues: { [venueId: string]: PlaceVenueModels } = {}
  for (const venueId of Object.keys(r.venues as object)) {
    name(venueId, `venues.${venueId}`)
    const v = plain((r.venues as Record<string, unknown>)[venueId], ['archetype', ...PLACE_LOD_KEYS], `venues.${venueId}`)
    venues[venueId] = {
      archetype: name(v.archetype, `venues.${venueId}.archetype`),
      lod0: parsePlaceLod(v.lod0, 'lod0', `venues.${venueId}.lod0`), lod1: parsePlaceLod(v.lod1, 'lod1', `venues.${venueId}.lod1`), lod2: parsePlaceLod(v.lod2, 'lod2', `venues.${venueId}.lod2`),
    }
  }
  return { schema: 'allworld-place-models', version: 1, city: id, atlas: { url: a.url as string, sha256: atlasHash }, venues }
}
