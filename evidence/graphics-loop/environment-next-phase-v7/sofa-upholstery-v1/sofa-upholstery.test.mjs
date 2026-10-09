import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { loadCityContent } from '../../../../src/game/cities/registry.ts'
import { createLife } from '../../../../src/life.ts'
import { createKit } from '../../../../src/scene/kit.ts'
import { buildHomeScene as buildBaselineHome, seatOf as baselineSeatOf } from './home-scene-before.ts'
import { buildHomeScene as buildCandidateHome, seatOf as candidateSeatOf } from './home-scene-candidate.ts'

await loadCityContent('lagos')

const furnitureStats = home => {
  const meshes = []
  home.group.traverse(node => {
    if (node instanceof THREE.Mesh && node.name.startsWith('home-furniture-')) meshes.push(node)
  })
  return {
    drawMeshes: meshes.length,
    triangles: meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0),
    geometryBytes: meshes.reduce((sum, mesh) => sum + Object.values(mesh.geometry.attributes).reduce((n, attribute) => n + attribute.array.byteLength, 0) + (mesh.geometry.index?.array.byteLength ?? 0), 0),
  }
}

for (const itemId of ['velvet-sofa', 'family-sofa']) {
  test(`${itemId}: upholstery profile changes only merged furniture geometry, not anchors or walk data`, () => {
    const items = [{ id: `fixture-${itemId}`, itemId, x: 2, y: 2, rot: 0 }]
    const state = createLife({ location: 'home', home: { custom: true, items } }, { now: Date.UTC(2026, 9, 8, 11), cityId: 'lagos' })
    const beforeKit = createKit(), candidateKit = createKit()
    const before = buildBaselineHome(beforeKit), candidate = buildCandidateHome(candidateKit)
    try {
      before.update(state); candidate.update(state)
      const oldStats = furnitureStats(before), newStats = furnitureStats(candidate)
      assert.equal(newStats.drawMeshes, oldStats.drawMeshes, 'same furniture mesh/draw count')
      assert.ok(newStats.triangles <= oldStats.triangles, 'profile stays within old sofa triangle count')
      assert.ok(newStats.geometryBytes <= oldStats.geometryBytes, 'profile stays within old sofa vertex/index bytes')
      assert.deepEqual(candidate.objects(), before.objects(), 'placed item identity and footprint remain the same')
      assert.deepEqual(candidate.walk.solids, before.walk.solids, 'camera collision solids are unchanged')
      assert.deepEqual(candidate.walk.entrance, before.walk.entrance, 'door approach remains unchanged')
      assert.deepEqual(candidate.walk.grid?.bounds, before.walk.grid?.bounds, 'walkable room bounds are unchanged')
      for (const [x, z] of [[-4.5,-4.5],[-1.5,-1.5],[0.5,0.5],[3.5,3.5],[4.5,0.5]]) {
        assert.equal(candidate.walk.grid?.free(x, z), before.walk.grid?.free(x, z), `walk occupancy differs at ${x},${z}`)
      }
      assert.deepEqual(candidateSeatOf('sofa', itemId === 'family-sofa' ? 3 : 2, 1), baselineSeatOf('sofa', itemId === 'family-sofa' ? 3 : 2, 1), 'the seated avatar anchor is unchanged')
      const seats = itemId === 'family-sofa' ? 3 : 2
      assert.equal(oldStats.triangles - newStats.triangles, seats * 4, 'two profile pads replace four box slabs per seat')
      assert.ok(newStats.geometryBytes < oldStats.geometryBytes, 'profile reduces merged geometry array bytes')
      console.log(`${itemId} furniture batch: before=${JSON.stringify(oldStats)} after=${JSON.stringify(newStats)}`)
    } finally {
      before.dispose(); candidate.dispose(); beforeKit.dispose(); candidateKit.dispose()
    }
  })
}

test('bevel faces are closed, outward-oriented quads on the cushion envelope', async () => {
  const { cushion } = await import('./home-scene-candidate.ts')
  const faces = [], boxes = []
  cushion({ box: (...args) => boxes.push(args), face4: (points) => faces.push(points) }, 0, 0.5, 0, 0.78, 0.11, 0.48, 0.025, '#f0e6d6')
  assert.equal(boxes.length, 1)
  assert.equal(faces.length, 5)
  const normals = faces.map(([a,b,c]) => {
    const u = c.map((v, i) => v - b[i]), v = a.map((value, i) => value - b[i])
    return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
  })
  for (const [nx, ny] of normals.slice(0, 4).map(n => [n[0], n[1]])) assert.ok(ny > 0 && Math.hypot(nx, ny) > 0, 'each bevel face faces outward and upward')
  assert.ok(normals[0][2] < 0 && normals[1][2] > 0, 'front/back faces point away from the cushion')
  assert.ok(normals[2][0] > 0 && normals[3][0] < 0, 'left/right faces point away from the cushion')
  assert.ok(normals[4][1] > 0, 'top face points upward')
  const envelope = faces.flat(2)
  const xs = envelope.filter((_, i) => i % 3 === 0), ys = envelope.filter((_, i) => i % 3 === 1), zs = envelope.filter((_, i) => i % 3 === 2)
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-0.39, 0.39])
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [0.53, 0.555])
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [-0.24, 0.24])
  const edgeKey = (p, q) => [p.join(','), q.join(',')].sort().join('|')
  const edgeCounts = new Map()
  for (const face of faces) for (let i = 0; i < 4; i++) {
    const key = edgeKey(face[i], face[(i + 1) % 4]); edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
  }
  assert.equal([...edgeCounts.values()].filter(count => count === 2).length, 8, 'bevels join each other and the top along shared edges')
})
