import type { CityPack } from '../map3d/types.ts'
import type { DoorTarget, MetrePoint, SourceKind, StreetTile, TileCoord, TileRoad, TileBuilding, StreetDoor } from './types.ts'

export const TILE_METRES = 128
export const QUANTUM = 100
export const GROUND_CELL = 2
export const MAX_RAW_TILE_BYTES = 256 * 1024
export const tileKey = (tile: TileCoord): string => `${tile.x}_${tile.z}`
export const tileOrigin = (tile: TileCoord): MetrePoint => ({ x: tile.x * TILE_METRES, z: tile.z * TILE_METRES })
export const tileOf = (point: MetrePoint): TileCoord => ({ x: Math.floor(point.x / TILE_METRES), z: Math.floor(point.z / TILE_METRES) })
export const localPoint = (point: MetrePoint, tile: TileCoord): MetrePoint => ({ x: point.x - tile.x * TILE_METRES, z: point.z - tile.z * TILE_METRES })
export const globalPoint = (point: MetrePoint, tile: TileCoord): MetrePoint => ({ x: point.x + tile.x * TILE_METRES, z: point.z + tile.z * TILE_METRES })
export function mapPointToMetres(pack: Pick<CityPack, 'frame'>, point: MetrePoint): MetrePoint {
  if (!pack.frame || !Number.isFinite(pack.frame.unitsPerKm) || pack.frame.unitsPerKm <= 0 || !Number.isFinite(pack.frame.origin.x) || !Number.isFinite(pack.frame.origin.z)) throw Error('A street source requires the existing geographic frame')
  const scale = 1000 / pack.frame.unitsPerKm
  return { x: point.x * scale, z: point.z * scale }
}
export function metresToMapPoint(pack: Pick<CityPack, 'frame'>, point: MetrePoint): MetrePoint { const one = mapPointToMetres(pack, { x: 1, z: 1 }); return { x: point.x / one.x, z: point.z / one.z } }
export const tileWindow = (centre: TileCoord): TileCoord[] => Array.from({ length: 9 }, (_, i) => ({ x: centre.x + i % 3 - 1, z: centre.z + Math.floor(i / 3) - 1 })).sort((a, b) => Math.hypot(a.x - centre.x, a.z - centre.z) - Math.hypot(b.x - centre.x, b.z - centre.z))
export function tileGroundAt(tile: StreetTile, point: MetrePoint): boolean {
  const col = Math.floor(point.x / GROUND_CELL), row = Math.floor(point.z / GROUND_CELL)
  return col >= 0 && col < 64 && row >= 0 && row < 64 && Boolean((tile.ground[row * 2 + Math.floor(col / 32)] ?? 0) & (1 << (col % 32)))
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, low: number, high: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= low && value <= high
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9:_-]{1,160}$/.test(value)
function source(value: unknown): SourceKind { if (value === 'mapped' || value === 'authored' || value === 'generated') return value; throw Error('Invalid street provenance') }
function points(value: unknown, min: number, max = 4096, halo = 0): MetrePoint[] {
  if (!Array.isArray(value) || value.length < min * 2 || value.length > max || value.length % 2) throw Error('Invalid street coordinates')
  const result: MetrePoint[] = []
  for (let i = 0; i < value.length; i += 2) { const x: unknown = value[i], z: unknown = value[i + 1]; if (!integer(x, -halo, 12800 + halo) || !integer(z, -halo, 12800 + halo)) throw Error('Street coordinates outside tile'); result.push({ x: x / QUANTUM, z: z / QUANTUM }) }
  return result
}
function target(value: unknown): DoorTarget {
  if (!object(value)) throw Error('Invalid street door target')
  if (value.kind === 'venue' && token(value.venue)) return { kind: 'venue', venue: value.venue }
  if (value.kind === 'estate' && token(value.lga) && integer(value.estate, 0, 511)) return { kind: 'estate', lga: value.lga, estate: value.estate }
  throw Error('Invalid street door target')
}
/** Parse the data boundary: identity, lengths, provenance and coordinates are checked before use. */
export function decodeStreetTile(value: unknown, expected: { city: string; version: string; tile: TileCoord }): StreetTile { return decodeTile(value, expected, 64) }
/** Internal offline/server boundary only, after immutable payload hash verification. */
export function decodeImmutableStreetTile(value: unknown, expected: { city: string; version: string; tile: TileCoord }): StreetTile {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_RAW_TILE_BYTES) throw Error('Immutable street tile exceeds byte budget')
  return decodeTile(value, expected, 1024)
}
function decodeTile(value: unknown, expected: { city: string; version: string; tile: TileCoord }, maxDoors: 64 | 1024): StreetTile {
  if (!object(value) || value.v !== 1 || value.city !== expected.city || value.version !== expected.version || !token(value.city) || !token(value.version) || !Array.isArray(value.tile) || value.tile.length !== 2 || value.tile[0] !== expected.tile.x || value.tile[1] !== expected.tile.z || !integer(value.tile[0], -1000000, 1000000) || !integer(value.tile[1], -1000000, 1000000)) throw Error('Street tile identity mismatch')
  if (!Array.isArray(value.ground) || value.ground.length !== 128 || !value.ground.every(bit => integer(bit, 0, 0xffffffff))) throw Error('Invalid street ground mask')
  if (!Array.isArray(value.roads) || value.roads.length > 256 || !Array.isArray(value.buildings) || value.buildings.length > 128 || !Array.isArray(value.doors) || value.doors.length > maxDoors) throw Error('Street tile exceeds feature limits')
  const roads: TileRoad[] = value.roads.map(road => {
    if (!object(road) || !token(road.id) || typeof road.name !== 'string' || road.name.length > 160 || !integer(road.width, 50, 5000) || typeof road.bridge !== 'boolean') throw Error('Invalid street road')
    return { id: road.id, name: road.name, width: road.width / QUANTUM, bridge: road.bridge, source: source(road.source), points: points(road.points, 2) }
  })
  const buildings: TileBuilding[] = value.buildings.map(building => {
    if (!object(building) || !token(building.id) || !integer(building.height, 100, 10000) || (building.source !== 'generated-fabric' && building.source !== 'generated-venue')) throw Error('Invalid street building')
    return { id: building.id, height: building.height / QUANTUM, source: building.source, footprint: points(building.footprint, 3, 64) }
  })
  const doors: StreetDoor[] = value.doors.map(door => {
    if (!object(door) || !token(door.id) || door.source !== 'generated') throw Error('Invalid street door')
    const at = points(door.at, 1, 2, 800)[0], approach = points(door.approach, 1, 2, 800)[0]
    if (!at || !approach) throw Error('Missing street door point')
    return { id: door.id, target: target(door.target), at, approach, source: 'generated' }
  })
  if (new Set(doors.map(door => door.id)).size !== doors.length || new Set(buildings.map(building => building.id)).size !== buildings.length) throw Error('Duplicate street feature identity')
  return { city: expected.city, version: expected.version, tile: { ...expected.tile }, origin: tileOrigin(expected.tile), ground: Uint32Array.from(value.ground), roads, buildings, doors }
}
