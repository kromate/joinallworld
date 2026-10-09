import { buildStreetOverlay } from '../../../street/overlay.ts'
import { globalPoint } from '../../../street/frame.ts'
import type { MetrePoint, StreetTile } from '../../../street/types.ts'
import type { StreetOverlayView } from '../../../street/overlay.ts'
import { inspectPinnedMarinaDepotTile } from '../../../game/living-world/depot-site.ts'

const APRON_COLOR = '#b9a47c'
const MARKING_COLOR = '#eed991'
const VISUAL_LIFT_M = 0.025
const MARKING_LIFT_M = 0.045

export interface DepotOverlayMarker {
  readonly id: 'marina-practice-depot'
  readonly label: 'Fictional practice depot'
  /** Global x/z coordinates; height is the cosmetic label elevation in metres. */
  readonly point: Readonly<MetrePoint>
  readonly height: number
}

export interface MarinaDepotOverlay {
  readonly view: StreetOverlayView
  readonly marker: DepotOverlayMarker
  readonly provenance: 'fictional-overlay'
  /** Flat support asserted by the site descriptor; the visual lift is cosmetic only. */
  readonly physicalSupportHeightM: 0
  readonly visualLiftM: typeof VISUAL_LIFT_M
  /** The tile inspector validates geometry/identity, not the retained asset hashes. */
  readonly assetPin: 'not-verified-by-tile-inspector'
  readonly routeAuthorized: false
}

function rectangle(center: MetrePoint, along: MetrePoint, across: MetrePoint, halfLength: number, halfWidth: number): MetrePoint[] {
  return [
    { x: center.x - along.x * halfLength - across.x * halfWidth, z: center.z - along.z * halfLength - across.z * halfWidth },
    { x: center.x + along.x * halfLength - across.x * halfWidth, z: center.z + along.z * halfLength - across.z * halfWidth },
    { x: center.x + along.x * halfLength + across.x * halfWidth, z: center.z + along.z * halfLength + across.z * halfWidth },
    { x: center.x - along.x * halfLength + across.x * halfWidth, z: center.z - along.z * halfLength + across.z * halfWidth },
  ]
}

/**
 * Build a cold, cosmetic overlay only for geometry accepted by the pinned Marina tile inspector.
 * This does not verify hashes or grant vehicle, actor, route, commerce, or reward authority.
 */
export function buildMarinaDepotOverlay(tile: StreetTile): MarinaDepotOverlay | null {
  const site = inspectPinnedMarinaDepotTile(tile)
  if (!site || site.checks.routeAuthorized || site.checks.pinnedAsset !== 'not-verified-by-tile-inspector') return null

  const heading = site.parkingPose.headingRadians
  const along = { x: Math.sin(heading), z: Math.cos(heading) }
  const across = { x: Math.cos(heading), z: -Math.sin(heading) }
  const center = site.parkingPose.center
  const halfLength = site.sedanEnvelope.halfLengthM + 0.35
  const stripeOffset = site.sedanEnvelope.halfWidthM + 0.35
  const surfaces = [
    { polygon: site.surface.polygon.map(point => ({ x: point.x, z: point.z })), height: site.surface.supportHeightM + VISUAL_LIFT_M, color: APRON_COLOR },
    ...[-stripeOffset, stripeOffset].map(offset => ({
      polygon: rectangle({ x: center.x + across.x * offset, z: center.z + across.z * offset }, along, across, halfLength, 0.045),
      height: site.surface.supportHeightM + MARKING_LIFT_M,
      color: MARKING_COLOR,
    })),
  ]
  const markerPoint = { x: site.boarding.approach.x, z: site.boarding.approach.z }
  const labelY = site.surface.supportHeightM + VISUAL_LIFT_M + 1.55
  const markerGlobalPoint = globalPoint(markerPoint, tile.tile)
  const view = buildStreetOverlay({
    id: site.id,
    tile: { ...tile.tile },
    sourceVersion: tile.version,
    surfaces,
    markers: [{ id: 'marina-practice-depot', label: 'Fictional practice depot', point: markerPoint, height: site.surface.supportHeightM + VISUAL_LIFT_M }],
  })

  return Object.freeze({
    view,
    marker: Object.freeze({
      id: 'marina-practice-depot',
      label: 'Fictional practice depot',
      point: Object.freeze(markerGlobalPoint),
      height: labelY,
    }),
    provenance: site.provenance,
    physicalSupportHeightM: site.surface.supportHeightM,
    visualLiftM: VISUAL_LIFT_M,
    assetPin: site.checks.pinnedAsset,
    routeAuthorized: site.checks.routeAuthorized,
  })
}
