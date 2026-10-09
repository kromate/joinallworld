import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { buildStreetOverlay } from './overlay.ts'
import type { StreetOverlayGeometry } from './overlay.ts'

const sample = (): StreetOverlayGeometry => ({
  id: 'fictional-depot', tile: { x: 4, z: -2 }, sourceVersion: 'district-v1',
  surfaces: [
    { polygon: [{ x: 10, z: 10 }, { x: 22, z: 10 }, { x: 22, z: 20 }, { x: 10, z: 20 }], height: 0.1, color: '#d2b48c' },
    { polygon: [{ x: 30, z: 10 }, { x: 36, z: 10 }, { x: 36, z: 16 }, { x: 30, z: 16 }], height: 0.12, color: '#d2b48c' },
  ],
  markers: [{ id: 'depot-door', label: 'Depot entrance', point: { x: 16, z: 22 }, height: 0.1 }],
})

test('overlay surfaces are tile-local, marker metadata is retained, and rebasing only moves the owner group', () => {
  const overlay = buildStreetOverlay(sample()), parent = new THREE.Group()
  overlay.attach(parent)
  assert.equal(parent.children[0], overlay.group)
  assert.equal(overlay.group.children.length, 2, 'two same-color surfaces batch together and markers share one mesh')
  assert.deepEqual(overlay.group.userData.streetOverlay.markers.map((marker: { id: string }) => marker.id), ['depot-door'])
  const meshes = overlay.group.children as THREE.Mesh[]
  const geometries = meshes.map((mesh) => mesh.geometry)
  const materials = meshes.map((mesh) => mesh.material as THREE.Material)
  const firstPositions = geometries[0]!.getAttribute('position').array
  assert.ok(firstPositions instanceof Float32Array)
  assert.ok([...firstPositions].some((coordinate) => coordinate === 10), 'coordinates stay local to their authored tile')
  overlay.rebase({ x: 3, z: -3 })
  assert.deepEqual([overlay.group.position.x, overlay.group.position.y, overlay.group.position.z], [128, 0, 128])
  assert.deepEqual(meshes.map((mesh) => mesh.geometry), geometries, 'rebasing does not allocate or rebuild geometry')
  assert.equal(meshes[0]!.geometry.getAttribute('position').array, firstPositions)
  overlay.rebase({ x: 4, z: -2 })
  assert.deepEqual([overlay.group.position.x, overlay.group.position.z], [0, 0])
  const disposedGeometries = geometries.map((resource) => { let disposed = false; resource.addEventListener('dispose', () => { disposed = true }); return () => disposed })
  const disposedMaterials = materials.map((resource) => { let disposed = false; resource.addEventListener('dispose', () => { disposed = true }); return () => disposed })
  overlay.dispose()
  overlay.dispose()
  assert.equal(overlay.group.children.length, 0)
  assert.equal(overlay.group.parent, null)
  assert.ok(disposedGeometries.every((wasDisposed) => wasDisposed()), 'owned geometries are released')
  assert.ok(disposedMaterials.every((wasDisposed) => wasDisposed()), 'owned materials are released')
})

test('overlay input rejects malformed bounds, degenerate polygons, duplicate markers and unsupported colors', () => {
  const invalid: StreetOverlayGeometry[] = [
    { ...sample(), surfaces: [{ polygon: [{ x: -1, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }], height: 0, color: '#ffffff' }] },
    { ...sample(), surfaces: [{ polygon: [{ x: 1, z: 1 }, { x: 4, z: 4 }, { x: 8, z: 8 }], height: 0, color: '#ffffff' }] },
    { ...sample(), surfaces: [{ polygon: [{ x: 1, z: 1 }, { x: 8, z: 8 }, { x: 1, z: 8 }, { x: 8, z: 1 }], height: 0, color: '#ffffff' }] },
    { ...sample(), surfaces: [{ polygon: [{ x: 1, z: 1 }, { x: 8, z: 1 }, { x: 8, z: 8 }], height: 0, color: 'red' }] },
    { ...sample(), markers: [{ id: 'same', label: 'A', point: { x: 2, z: 2 }, height: 0 }, { id: 'same', label: 'B', point: { x: 4, z: 4 }, height: 0 }] },
  ]
  for (const descriptor of invalid) assert.throws(() => buildStreetOverlay(descriptor))
})
