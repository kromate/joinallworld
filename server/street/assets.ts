import { decodeImmutableStreetTile, MAX_RAW_TILE_BYTES, tileKey, tileOf, globalPoint } from '../../src/street/frame.ts'
import type { DoorTarget, MetrePoint, TileCoord } from '../../src/street/types.ts'
import type { StreetAssetReader, StreetManifestDoor } from './types.ts'

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9:_-]{1,160}$/.test(value)
const point = (value: unknown): MetrePoint | null => object(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.z === 'number' && Number.isFinite(value.z) && Math.abs(value.x) < 128000000 && Math.abs(value.z) < 128000000 ? { x: value.x, z: value.z } : null
interface Entry { tile: TileCoord; file: string; sha256: string; packKey?: string; packSha256?: string }
export interface ParsedStreetManifest { city: string; version: string; tiles: Map<string, Entry>; doors: Map<string, StreetManifestDoor> }
const streetVersion = (value: unknown): value is string => typeof value === 'string' && /^street-v1-[a-z0-9_-]{1,100}$/.test(value)
/** Current-manifest pointers are deliberately tiny and may only name a version, never a path. Legacy full manifests return null. */
export function parseStreetManifestPointer(value: unknown, city: string): string | null {
  if (!object(value) || !('p' in value)) return null
  const keys = Object.keys(value).sort()
  if (keys.length !== 3 || keys[0] !== 'city' || keys[1] !== 'p' || keys[2] !== 'targetVersion' || value.p !== 1 || value.city !== city || !streetVersion(value.targetVersion)) throw Error('Invalid current street manifest pointer')
  return value.targetVersion
}
function parseTarget(value: unknown): DoorTarget {
  if (object(value) && value.kind === 'venue' && token(value.venue)) return { kind: 'venue', venue: value.venue }
  if (object(value) && value.kind === 'estate' && token(value.lga) && typeof value.estate === 'number' && Number.isInteger(value.estate) && value.estate >= 0 && value.estate < 512) return { kind: 'estate', lga: value.lga, estate: value.estate }
  throw Error('Invalid immutable street door target')
}
export function parseStreetManifest(value: unknown, city: string): ParsedStreetManifest {
  if (!object(value) || value.v !== 1 || value.city !== city || !token(value.version) || value.tileSize !== 128 || value.quantum !== 100 || value.groundCell !== 2 || !Array.isArray(value.tiles) || value.tiles.length > 50000 || !Array.isArray(value.doors) || value.doors.length > 20000) throw Error('Invalid immutable street manifest')
  const tiles = new Map<string, Entry>(), doors = new Map<string, StreetManifestDoor>()
  for (const entry of value.tiles) {
    const coordinate = object(entry) ? point(entry.tile) : null
    if (!coordinate || !Number.isInteger(coordinate.x) || !Number.isInteger(coordinate.z) || !object(entry) || typeof entry.file !== 'string' || !/^[a-z0-9_-]+\.txt$/.test(entry.file) || typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw Error('Invalid immutable street asset entry')
    const key = tileKey(coordinate); if (tiles.has(key)) throw Error('Duplicate immutable street tile')
    if (entry.packKey !== undefined || entry.packSha256 !== undefined) { if (entry.packKey !== key || typeof entry.packSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.packSha256) || entry.file !== `pack-${entry.packSha256}.txt`) throw Error('Invalid immutable street pack reference'); tiles.set(key, { tile: coordinate, file: entry.file, sha256: entry.sha256, packKey: key, packSha256: entry.packSha256 }) } else tiles.set(key, { tile: coordinate, file: entry.file, sha256: entry.sha256 })
  }
  for (const entry of value.doors) {
    const at = object(entry) ? point(entry.at) : null, approach = object(entry) ? point(entry.approach) : null, coordinate = object(entry) ? point(entry.tile) : null
    if (!object(entry) || !token(entry.id) || entry.source !== 'generated' || !at || !approach || !coordinate || tileKey(tileOf(approach)) !== tileKey(coordinate) || !tiles.has(tileKey(coordinate)) || doors.has(entry.id)) throw Error('Invalid immutable street door index')
    doors.set(entry.id, { id: entry.id, source: 'generated', target: parseTarget(entry.target), at, approach, tile: coordinate })
  }
  return { city, version: value.version, tiles, doors }
}
/** Read-only immutable assets; no CityPack imports, geometry generation or Node dependencies. */
export function createStreetAssets(reader: StreetAssetReader) {
  const manifests = new Map<string, ParsedStreetManifest>(), current = new Map<string, { version: string; checked: number }>(), manifestPending = new Map<string, Promise<ParsedStreetManifest>>(), versionPending = new Map<string, Promise<ParsedStreetManifest>>(), tiles = new Map<string, { decoded: ReturnType<typeof decodeImmutableStreetTile>; wire: Record<string, unknown> }>(), pending = new Map<string, Promise<{ decoded: ReturnType<typeof decodeImmutableStreetTile>; wire: Record<string, unknown> }>>()
  function cachedManifest(city: string, version: string): ParsedStreetManifest | undefined {
    const id = `${city}:${version}`, cached = manifests.get(id)
    if (cached) { manifests.delete(id); manifests.set(id, cached) }
    return cached
  }
  function rememberManifest(value: ParsedStreetManifest): ParsedStreetManifest {
    const id = `${value.city}:${value.version}`
    if (manifests.size >= 4 && !manifests.has(id)) { const first = manifests.keys().next().value; if (first) manifests.delete(first) }
    manifests.delete(id); manifests.set(id, value)
    return value
  }
  async function versionManifest(city: string, version: string): Promise<ParsedStreetManifest> {
    const cached = cachedManifest(city, version)
    if (cached) return cached
    const id = `${city}:${version}`, inFlight = versionPending.get(id)
    if (inFlight) return inFlight
    const work = (async () => {
      const value: unknown = await reader.readManifest(city, version)
      if (parseStreetManifestPointer(value, city) !== null) throw Error('Immutable street version cannot be a pointer')
      const parsed = parseStreetManifest(value, city)
      if (parsed.version !== version) throw Error('Retained street geometry version unavailable')
      return rememberManifest(parsed)
    })().finally(() => versionPending.delete(id))
    versionPending.set(id, work)
    return work
  }
  async function manifest(city: string, version?: string): Promise<ParsedStreetManifest> {
    if (version !== undefined && !/^street-v1-[a-z0-9_-]{1,100}$/.test(version)) throw Error('Invalid street geometry version')
    const pointer = current.get(city), wanted = version ?? (pointer && Date.now() - pointer.checked < 60000 ? pointer.version : undefined)
    const cached = wanted ? cachedManifest(city, wanted) : undefined
    if (cached) return cached
    const pendingKey = `${city}:${version ?? 'current'}`, inFlight = manifestPending.get(pendingKey)
    if (inFlight) return inFlight
    if (manifestPending.size >= 4) throw Error('Street manifest reader is busy')
    const work = (async () => {
      if (version !== undefined) return await versionManifest(city, version)
      const currentValue: unknown = await reader.readManifest(city)
      const targetVersion = parseStreetManifestPointer(currentValue, city)
      let value: ParsedStreetManifest
      if (targetVersion) value = await versionManifest(city, targetVersion)
      else value = rememberManifest(parseStreetManifest(currentValue, city))
      if (!current.has(city) && current.size >= 4) { const first = current.keys().next().value; if (first) current.delete(first) }
      current.set(city, { version: value.version, checked: Date.now() })
      return value
    })().finally(() => manifestPending.delete(pendingKey))
    manifestPending.set(pendingKey, work); return work
  }
  const packs = new Map<string, Map<string, Record<string, unknown>>>(), packPending = new Map<string, Promise<Map<string, Record<string, unknown>>>>()
  async function hash(text: string): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') }
  async function pack(city: string, version: string, entry: Entry): Promise<Map<string, Record<string, unknown>>> {
    const key = `${city}:${version}:${entry.file}`, held = packs.get(key); if (held) { packs.delete(key); packs.set(key, held); return held }
    const known = packPending.get(key); if (known) return known
    if (packPending.size >= 16) throw Error('Street pack reader is busy')
    const work = (async () => {
      const text = await reader.readTile(city, version, entry.file)
      if (text === null || new TextEncoder().encode(text).byteLength > MAX_RAW_TILE_BYTES || await hash(text) !== entry.packSha256) throw Error('Street pack integrity failed')
      const envelope: unknown = JSON.parse(text)
      if (!object(envelope) || envelope.v !== 1 || envelope.city !== city || envelope.version !== version || !Array.isArray(envelope.tiles) || envelope.tiles.length < 1 || envelope.tiles.length > 4) throw Error('Invalid street pack envelope')
      const values = new Map<string, Record<string, unknown>>()
      for (const item of envelope.tiles) {
        if (!object(item) || typeof item.key !== 'string' || !/^-?[0-9]{1,7}_-?[0-9]{1,7}$/.test(item.key) || values.has(item.key) || !object(item.wire) || item.wire.v !== 1 || item.wire.city !== city || item.wire.version !== version || !Array.isArray(item.wire.tile) || item.wire.tile.length !== 2 || !item.wire.tile.every(part => typeof part === 'number' && Number.isSafeInteger(part) && Math.abs(part) <= 1000000) || item.key !== `${item.wire.tile[0]}_${item.wire.tile[1]}`) throw Error('Invalid street pack logical key')
        values.set(item.key, item.wire)
      }
      if (packs.size >= 8) { const first = packs.keys().next().value; if (first) packs.delete(first) }
      packs.set(key, values); return values
    })().finally(() => packPending.delete(key))
    packPending.set(key, work); return work
  }
  async function tile(city: string, version: string, coordinate: TileCoord) {
    const index = await manifest(city, version); if (index.version !== version) throw Error('Street geometry version changed')
    const entry = index.tiles.get(tileKey(coordinate)); if (!entry) throw Error('Street tile is not in the immutable manifest')
    const key = `${city}:${version}:${tileKey(coordinate)}`, held = tiles.get(key); if (held) { tiles.delete(key); tiles.set(key, held); return held }
    const known = pending.get(key); if (known) return known
    if (pending.size >= 64) throw Error('Street tile reader is busy')
    const work = (async () => {
      let wire: unknown
      if (entry.packKey) {
        wire = (await pack(city, version, entry)).get(entry.packKey)
        if (!object(wire) || await hash(JSON.stringify(wire)) !== entry.sha256) throw Error('Street logical tile integrity failed')
      } else {
        const text = await reader.readTile(city, version, entry.file)
        if (text === null || new TextEncoder().encode(text).byteLength > MAX_RAW_TILE_BYTES || await hash(text) !== entry.sha256) throw Error('Street asset integrity failed')
        wire = JSON.parse(text)
      }
      if (!object(wire)) throw Error('Invalid street asset object')
      const decoded = decodeImmutableStreetTile(wire, { city, version, tile: coordinate }), value = { wire, decoded }
      if (decoded.roads.reduce((count, road) => count + road.points.length, 0) > 8192) throw Error('Street asset exceeds decoded point budget')
      if (tiles.size >= 32) { const first = tiles.keys().next().value; if (first) tiles.delete(first) }
      tiles.set(key, value); return value
    })().finally(() => pending.delete(key))
    pending.set(key, work); return work
  }
  async function door(city: string, version: string, id: string): Promise<StreetManifestDoor> {
    const index = await manifest(city, version), entry = index.doors.get(id); if (index.version !== version || !entry) throw Error('Street door unavailable')
    const value = await tile(city, version, entry.tile), actual = value.decoded.doors.find(door => door.id === id)
    if (!actual || JSON.stringify(actual.target) !== JSON.stringify(entry.target) || Math.hypot(globalPoint(actual.approach, entry.tile).x - entry.approach.x, globalPoint(actual.approach, entry.tile).z - entry.approach.z) > 0.015) throw Error('Street door integrity failed')
    return entry
  }
  async function projectedTile(city: string, version: string, coordinate: TileCoord, anchor: { lga: string; estate: number }): Promise<Record<string, unknown>> {
    const index = await manifest(city, version)
    if (!index.tiles.has(tileKey(coordinate))) return { v: 1, city, version, tile: [coordinate.x, coordinate.z], ground: Array<number>(128).fill(0), roads: [], buildings: [], doors: [] }
    const value = await tile(city, version, coordinate)
    // Never mutate the immutable hash-checked cache: collision, roads and fabric are shared.
    const allowed = new Set(value.decoded.doors.filter(item => item.target.kind === 'venue' || item.target.lga === anchor.lga && item.target.estate === anchor.estate).map(item => item.id))
    const doors = Array.isArray(value.wire.doors) ? value.wire.doors.filter(item => object(item) && typeof item.id === 'string' && allowed.has(item.id)) : []
    return { ...value.wire, doors }
  }
  return { manifest, tile, door, projectedTile, diagnostics: () => ({ manifests: manifests.size, tiles: tiles.size, pending: pending.size, manifestPending: manifestPending.size, packs: packs.size, packPending: packPending.size }) }
}
