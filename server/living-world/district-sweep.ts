/** Server-side binding of closed-car sweep diagnostics to the retained Marina street assets. */
import { createStreetAssets } from '../street/assets.ts'
import type { StreetAssetReader } from '../street/types.ts'
import { tileKey } from '../../src/street/frame.ts'
import type { MetrePoint, StreetTile, TileCoord } from '../../src/street/types.ts'
import { inspectPinnedMarinaDepotTile, MARINA_DEPOT_SOURCE_PINS } from '../../src/game/living-world/depot-site.ts'
import { SEDAN_BOARDING_DESCRIPTOR } from '../../src/game/living-world/vehicle-boarding.ts'
import { verifyMappedSweep } from '../../src/game/living-world/mapped-sweep.ts'

const PINS = MARINA_DEPOT_SOURCE_PINS
const ROAD_WIDTH_M = 8
const ROAD_START = Object.freeze({ x: 0, z: 32.53 })
const ROAD_END = Object.freeze({ x: 128, z: 50.56 })

export interface DistrictSweepEvidence {
  readonly kind: 'retained-street-manifest-pack-logical-tile-verified'
  readonly city: typeof PINS.city
  readonly version: typeof PINS.version
  readonly manifestCanonicalSha256: typeof PINS.manifestCanonicalSha256
  readonly tile: Readonly<TileCoord>
  readonly tileSha256: typeof PINS.tileSha256
  readonly packSha256: typeof PINS.packSha256
  readonly road: {
    readonly id: typeof PINS.roadId
    readonly widthM: 8
    readonly source: 'authored'
    readonly centerline: readonly [Readonly<MetrePoint>, Readonly<MetrePoint>]
    /** The support quadrilateral is derived directly from the verified two-point source road. */
    readonly corridor: readonly [Readonly<MetrePoint>, Readonly<MetrePoint>, Readonly<MetrePoint>, Readonly<MetrePoint>]
  }
  readonly checkedBuildingFootprints: number
}

export interface DistrictSweepResult {
  readonly routeAuthorized: false
  readonly canBoard: false
  readonly geometryOnly: true
  readonly evidence: DistrictSweepEvidence
  readonly sweep: ReturnType<typeof verifyMappedSweep>
  readonly limitations: readonly [
    'vertical terrain support and elevation continuity are unverified',
    'other-road crossings, traffic, pedestrians, and yielding are unverified',
    'door aperture, actor volume, boarding, and exit motion are unverified',
    'server trip, fleet, rental, and controller permission are not granted',
  ]
}

const LIMITATIONS = Object.freeze([
  'vertical terrain support and elevation continuity are unverified',
  'other-road crossings, traffic, pedestrians, and yielding are unverified',
  'door aperture, actor volume, boarding, and exit motion are unverified',
  'server trip, fleet, rental, and controller permission are not granted',
] as const)

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function retainedManifest(value: unknown): boolean {
  return object(value) && value.v === 1 && value.city === PINS.city && value.version === PINS.version
}
function samePoint(a: MetrePoint, b: MetrePoint): boolean { return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.z - b.z) < 1e-9 }

async function canonicalManifestHash(value: unknown): Promise<string> {
  // The reader exposes parsed JSON, so this pins the canonical object serialization used by the
  // retained-manifest resolver; it does not attest to source-file whitespace or byte formatting.
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function corridor(tile: StreetTile): {
  road: StreetTile['roads'][number]
  polygon: readonly MetrePoint[]
} | null {
  const roads = tile.roads.filter(road => road.id === PINS.roadId)
  if (roads.length !== 1) return null
  const road = roads[0]!
  if (road.name !== 'Marina' || road.source !== 'authored' || road.width !== ROAD_WIDTH_M || road.bridge || road.points.length !== 2) return null
  const [start, end] = road.points
  if (!start || !end || !samePoint(start, ROAD_START) || !samePoint(end, ROAD_END)) return null
  const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz)
  if (!Number.isFinite(length) || length < 100 || length > 130) return null
  const nx = -dz / length * road.width / 2, nz = dx / length * road.width / 2
  return {
    road,
    polygon: [
      { x: start.x + nx, z: start.z + nz }, { x: end.x + nx, z: end.z + nz },
      { x: end.x - nx, z: end.z - nz }, { x: start.x - nx, z: start.z - nz },
    ],
  }
}

function snapshotEvidence(tile: StreetTile, road: StreetTile['roads'][number], polygon: readonly MetrePoint[]): DistrictSweepEvidence {
  const a = Object.freeze({ ...road.points[0]! }), b = Object.freeze({ ...road.points[1]! })
  const bounds = Object.freeze([
    Object.freeze({ ...polygon[0]! }), Object.freeze({ ...polygon[1]! }),
    Object.freeze({ ...polygon[2]! }), Object.freeze({ ...polygon[3]! }),
  ]) as DistrictSweepEvidence['road']['corridor']
  return Object.freeze({
    kind: 'retained-street-manifest-pack-logical-tile-verified', city: PINS.city, version: PINS.version,
    manifestCanonicalSha256: PINS.manifestCanonicalSha256, tile: Object.freeze({ ...PINS.tile }),
    tileSha256: PINS.tileSha256, packSha256: PINS.packSha256,
    road: Object.freeze({ id: PINS.roadId, widthM: ROAD_WIDTH_M, source: 'authored', centerline: Object.freeze([a, b]) as DistrictSweepEvidence['road']['centerline'], corridor: Object.freeze(bounds) }),
    checkedBuildingFootprints: tile.buildings.length,
  })
}

/**
 * Verify one closed-vehicle sweep against the pinned road corridor and every decoded building
 * footprint from the same immutable asset read. Poses are tile-local diagnostic proposals only.
 * Caller-supplied geometry is intentionally not part of this API.
 */
export async function inspectMarinaDistrictSweep(reader: StreetAssetReader | undefined, from: unknown, to: unknown): Promise<DistrictSweepResult | null> {
  if (!reader) return null
  try {
    let retainedRaw: unknown
    const captured: StreetAssetReader = {
      async readManifest(city, version) {
        const value = await reader.readManifest(city, version)
        if (city === PINS.city && (version === PINS.version || version === undefined && retainedManifest(value))) retainedRaw = value
        return value
      },
      readTile: (city, version, file) => reader.readTile(city, version, file),
    }
    const assets = createStreetAssets(captured)
    const current = await assets.manifest(PINS.city)
    if (current.version !== PINS.version) return null
    const retained = await assets.manifest(PINS.city, PINS.version)
    if (retained.version !== PINS.version || await canonicalManifestHash(retainedRaw) !== PINS.manifestCanonicalSha256) return null
    const entry = retained.tiles.get(tileKey(PINS.tile))
    if (!entry || entry.sha256 !== PINS.tileSha256 || entry.packKey !== tileKey(PINS.tile) || entry.packSha256 !== PINS.packSha256) return null

    // `assets.tile` returns the very decoded logical tile whose pack and logical hashes were just checked.
    // Keep all following geometry on this object; do not ask the source reader for a second snapshot.
    const { decoded } = await assets.tile(PINS.city, PINS.version, PINS.tile)
    const depot = inspectPinnedMarinaDepotTile(decoded)
    const road = corridor(decoded)
    if (!depot || !road) return null
    const sweep = verifyMappedSweep({
      descriptor: SEDAN_BOARDING_DESCRIPTOR,
      from,
      to,
      supportPolygon: road.polygon,
      buildings: decoded.buildings.map(building => building.footprint),
    })
    if (sweep.reason === 'invalid_input' || sweep.reason === 'invalid_descriptor' || sweep.reason === 'invalid_support' || sweep.reason === 'invalid_buildings') return null
    return Object.freeze({ routeAuthorized: false, canBoard: false, geometryOnly: true,
      evidence: snapshotEvidence(decoded, road.road, road.polygon), sweep, limitations: LIMITATIONS })
  } catch { return null }
}
