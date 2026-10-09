import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as THREE from 'three'
import { createStreetAssets } from '../../../../server/street/assets.ts'
import type { StreetAssetReader } from '../../../../server/street/types.ts'
import type { StreetTile } from '../../../street/types.ts'
import { buildMarinaDepotOverlay } from './depotOverlay.ts'

const city = 'lagos'
const version = 'street-v1-c0dd6f6101f6f562'
const tileFile = 'pack-eab52104e1de300cccc38b649ce561fb1db87e7158676ec3c705701f8e60b52a.txt'
const tileCoord = { x: -9, z: -5 }

async function publishedTile(): Promise<StreetTile> {
  const base = new URL('../../../../public/assets/street/lagos/', import.meta.url)
  const pointer = JSON.parse(await readFile(new URL('manifest.txt', base), 'utf8')) as unknown
  const retained = JSON.parse(await readFile(new URL(`manifest-${version}.txt`, base), 'utf8')) as unknown
  const pack = await readFile(new URL(tileFile, base), 'utf8')
  const reader: StreetAssetReader = {
    async readManifest(requestCity, requestedVersion) {
      if (requestCity !== city) return null
      return requestedVersion === undefined ? pointer : requestedVersion === version ? retained : null
    },
    async readTile(requestCity, requestedVersion, file) {
      return requestCity === city && requestedVersion === version && file === tileFile ? pack : null
    },
  }
  const { decoded } = await createStreetAssets(reader).tile(city, version, tileCoord)
  return decoded
}

test('published Marina geometry yields a fictional, cosmetic overlay with rebased label metadata', async () => {
  const tile = await publishedTile()
  const overlay = buildMarinaDepotOverlay(tile)
  assert.ok(overlay)
  assert.equal(overlay.provenance, 'fictional-overlay')
  assert.equal(overlay.marker.label, 'Fictional practice depot')
  assert.deepEqual(overlay.view.tile, tileCoord)
  assert.equal(overlay.assetPin, 'not-verified-by-tile-inspector')
  assert.equal(overlay.routeAuthorized, false)
  assert.equal(overlay.physicalSupportHeightM, 0)
  assert.equal(overlay.visualLiftM, 0.025)
  assert.equal(overlay.view.group.children.length, 3, 'apron and same-color parking stripes are batched; boarding marker is one mesh')
  const metadata = overlay.view.group.userData.streetOverlay as { markers: { id: string; label: string; point: { x: number; z: number }; height: number }[] }
  assert.equal(metadata.markers.length, 1)
  const metadataMarker = metadata.markers[0]!
  assert.deepEqual(Object.keys(metadataMarker).sort(), ['height', 'id', 'label', 'point'])
  assert.deepEqual([metadataMarker.id, metadataMarker.label, metadataMarker.height], ['marina-practice-depot', 'Fictional practice depot', 0.025])
  assert.deepEqual(Object.keys(metadataMarker.point).sort(), ['x', 'z'])
  assert.ok(metadataMarker.point.x >= 0 && metadataMarker.point.x <= 128 && metadataMarker.point.z >= 0 && metadataMarker.point.z <= 128)
  assert.ok(Math.abs(overlay.marker.point.x - (metadataMarker.point.x + tileCoord.x * 128)) <= 1e-9)
  assert.ok(Math.abs(overlay.marker.point.z - (metadataMarker.point.z + tileCoord.z * 128)) <= 1e-9)
  assert.ok(Math.abs(metadataMarker.point.x - (overlay.marker.point.x - tileCoord.x * 128)) <= 1e-9)
  assert.ok(Math.abs(metadataMarker.point.z - (overlay.marker.point.z - tileCoord.z * 128)) <= 1e-9)
  assert.equal(overlay.marker.height, 1.575)
  assert.ok(overlay.view.group.children.every(child => child instanceof THREE.Mesh))
  const surfaceHeights = (overlay.view.group.children as THREE.Mesh[]).slice(0, 2).map(mesh => {
    const positions = mesh.geometry.getAttribute('position')
    return [...new Set(Array.from({ length: positions.count }, (_, index) => positions.getY(index).toFixed(3)))]
  })
  assert.deepEqual(surfaceHeights, [['0.025'], ['0.045']], 'rendered support/markings float above the physical support height of zero')

  overlay.view.rebase({ x: -8, z: -4 })
  assert.deepEqual([overlay.view.group.position.x, overlay.view.group.position.y, overlay.view.group.position.z], [-128, 0, -128])
  overlay.view.rebase(tileCoord)
  assert.deepEqual([overlay.view.group.position.x, overlay.view.group.position.z], [0, 0])

  const resources = overlay.view.group.children.flatMap(child => {
    const mesh = child as THREE.Mesh
    return [mesh.geometry, ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material])]
  })
  const disposed = resources.map(resource => {
    let count = 0
    resource.addEventListener('dispose', () => { count += 1 })
    return () => count
  })
  overlay.view.dispose(); overlay.view.dispose()
  assert.ok(disposed.every(count => count() === 1), 'the adapter owns and disposes every overlay resource exactly once')
})

test('changed tile identity or support data produces no overlay', async () => {
  const tile = await publishedTile()
  assert.equal(buildMarinaDepotOverlay({ ...tile, tile: { x: -8, z: -5 } }), null)
  assert.equal(buildMarinaDepotOverlay({ ...tile, version: 'street-v1-changed' }), null)

  const parking = buildMarinaDepotOverlay(tile)
  assert.ok(parking)
  const point = {
    x: parking.marker.point.x - tileCoord.x * 128,
    z: parking.marker.point.z - tileCoord.z * 128,
  }
  parking.view.dispose()
  const ground = tile.ground.slice()
  const col = Math.floor(point.x / 2), row = Math.floor(point.z / 2)
  ground[row * 2 + Math.floor(col / 32)] = (ground[row * 2 + Math.floor(col / 32)] ?? 0) & ~(1 << (col % 32))
  assert.equal(buildMarinaDepotOverlay({ ...tile, ground }), null)
})
