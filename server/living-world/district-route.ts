import { createStreetAssets } from '../street/assets.ts'
import type { StreetAssetReader } from '../street/types.ts'
import { globalPoint, tileKey } from '../../src/street/frame.ts'
import type { MetrePoint, TileCoord } from '../../src/street/types.ts'

const CITY = 'lagos'
const VERSION = 'street-v1-c0dd6f6101f6f562'
const MANIFEST_SHA256 = '76cd9b6db8e79fc0c5e1be3aea193b32430a6cc9cdda694f96df8b5f1cf597c3'
const TILE: TileCoord = { x: -9, z: -5 }
const TILE_SHA256 = '846c38cf8c80a2651e344b29779a3a6cd3d2246e821ffe9a01e440c4a321ab2b'
const PACK_SHA256 = 'eab52104e1de300cccc38b649ce561fb1db87e7158676ec3c705701f8e60b52a'
const ROAD_ID = 'road:lagos:15'
const ROAD_START = { x: 0, z: 32.53 }
const ROAD_END = { x: 128, z: 50.56 }
const ROAD_WIDTH = 8
const PRACTICE_LANE_OFFSET = 2
// The current sedan body is1.9m wide before wheels/trim/door motion. This larger
// provisional envelope still needs model/collider and turning-sweep checks.
const ASSUMED_VEHICLE_HALF_WIDTH = 1.2
const PROPOSED_EDGE_MARGIN = 0.4

export interface DistrictRouteProposal {
  readonly proposalOnly: true
  readonly clearance: 'unverified'
  readonly city: typeof CITY
  readonly version: typeof VERSION
  readonly manifestCanonicalSha256: typeof MANIFEST_SHA256
  readonly tile: Readonly<TileCoord>
  readonly tileSha256: typeof TILE_SHA256
  readonly packSha256: typeof PACK_SHA256
  readonly road: {
    readonly id: typeof ROAD_ID
    readonly name: 'Marina'
    readonly source: 'authored'
    readonly width: typeof ROAD_WIDTH
    readonly bridge: false
    readonly centerline: readonly [Readonly<MetrePoint>, Readonly<MetrePoint>]
  }
  /** Proposed envelope only; the actual vehicle collider/model extent has not been verified. */
  readonly assumedVehicleHalfWidth: typeof ASSUMED_VEHICLE_HALF_WIDTH
  readonly edgeMargin: typeof PROPOSED_EDGE_MARGIN
  /** Derived from road width and assumptions above, not certified clearance or driving authority. */
  readonly widthDerivedCenterRadius: number
  readonly stops: readonly [
    { readonly id: 'practice-depot'; readonly label: 'Fictional practice depot'; readonly at: Readonly<MetrePoint> },
    { readonly id: 'practice-shop'; readonly label: 'Fictional practice shop'; readonly at: Readonly<MetrePoint> },
  ]
}

const samePoint = (actual: MetrePoint, expected: MetrePoint): boolean =>
  Math.abs(actual.x - expected.x) < 1e-9 && Math.abs(actual.z - expected.z) < 1e-9

async function sha256(value: unknown): Promise<string> {
  // The reader returns parsed values, so this pins canonical JSON serialization, not original
  // source-file whitespace or byte formatting.
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function isRetainedManifest(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && 'v' in value && value.v === 1 && 'city' in value && value.city === CITY
    && 'version' in value && value.version === VERSION
}

function lanePoint(local: MetrePoint, fraction: number): MetrePoint {
  const dx = ROAD_END.x - ROAD_START.x, dz = ROAD_END.z - ROAD_START.z
  const length = Math.hypot(dx, dz)
  const centre = { x: local.x + dx * fraction, z: local.z + dz * fraction }
  return globalPoint({ x: centre.x - dz / length * PRACTICE_LANE_OFFSET, z: centre.z + dx / length * PRACTICE_LANE_OFFSET }, TILE)
}

function freezeProposal(): DistrictRouteProposal {
  const start = Object.freeze(globalPoint(ROAD_START, TILE))
  const end = Object.freeze(globalPoint(ROAD_END, TILE))
  const at = (fraction: number) => Object.freeze(lanePoint(ROAD_START, fraction))
  const stops = Object.freeze([
    Object.freeze({ id: 'practice-depot' as const, label: 'Fictional practice depot' as const, at: at(16 / 128) }),
    Object.freeze({ id: 'practice-shop' as const, label: 'Fictional practice shop' as const, at: at(112 / 128) }),
  ]) as DistrictRouteProposal['stops']
  return Object.freeze({
    proposalOnly: true, clearance: 'unverified', city: CITY, version: VERSION,
    manifestCanonicalSha256: MANIFEST_SHA256, tile: Object.freeze({ ...TILE }), tileSha256: TILE_SHA256,
    packSha256: PACK_SHA256,
    road: Object.freeze({ id: ROAD_ID, name: 'Marina', source: 'authored', width: ROAD_WIDTH, bridge: false, centerline: Object.freeze([start, end]) as DistrictRouteProposal['road']['centerline'] }),
    assumedVehicleHalfWidth: ASSUMED_VEHICLE_HALF_WIDTH,
    edgeMargin: PROPOSED_EDGE_MARGIN,
    widthDerivedCenterRadius: ROAD_WIDTH / 2 - ASSUMED_VEHICLE_HALF_WIDTH - PROPOSED_EDGE_MARGIN,
    stops,
  })
}

/**
 * Resolve a finite, fictional practice-route proposal from the retained, published street data.
 * This does not certify collisions, enable a vehicle, or grant trip authority.
 */
export async function resolveDistrictRoute(reader?: StreetAssetReader): Promise<DistrictRouteProposal | null> {
  if (!reader) return null
  try {
    let retainedRaw: unknown
    const captured: StreetAssetReader = {
      async readManifest(city, version) {
        const value = await reader.readManifest(city, version)
        if (city === CITY && (version === VERSION || version === undefined && isRetainedManifest(value))) retainedRaw = value
        return value
      },
      readTile: (city, version, file) => reader.readTile(city, version, file),
    }
    const assets = createStreetAssets(captured)
    const current = await assets.manifest(CITY)
    if (current.version !== VERSION) return null
    const retained = await assets.manifest(CITY, VERSION)
    if (retained.version !== VERSION || await sha256(retainedRaw) !== MANIFEST_SHA256) return null

    const entry = retained.tiles.get(tileKey(TILE))
    if (!entry || entry.sha256 !== TILE_SHA256 || entry.packKey !== tileKey(TILE) || entry.packSha256 !== PACK_SHA256) return null
    const { decoded } = await assets.tile(CITY, VERSION, TILE)
    const matchingRoads = decoded.roads.filter(road => road.id === ROAD_ID)
    if (matchingRoads.length !== 1) return null
    const road = matchingRoads[0]
    if (!road || road.name !== 'Marina' || road.source !== 'authored' || road.width !== ROAD_WIDTH || road.bridge || road.points.length !== 2) return null
    const [start, end] = road.points
    if (!start || !end || !samePoint(start, ROAD_START) || !samePoint(end, ROAD_END)) return null
    return freezeProposal()
  } catch {
    return null
  }
}
