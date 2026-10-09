import assert from 'node:assert/strict'
import test from 'node:test'

import { indexRoadBuildings, roadCorridorClear, roadCorridorClearIndexed, segmentBuildingDistance } from './shuttle-clearance.ts'
import { CAMPUS_MAP } from './map.generated.ts'
import type { MetreRing } from './geo.ts'

const building: MetreRing = [[0, 0], [2, 0], [2, 2], [0, 2]]

test('a corridor rejects crossings and a parallel road within half its mapped width', () => {
  assert.equal(roadCorridorClear({ x: -1, z: 1 }, { x: 3, z: 1 }, 1, [building]), false)
  assert.equal(roadCorridorClear({ x: -1, z: -0.4 }, { x: 3, z: -0.4 }, 1, [building]), false)
  assert.ok(Math.abs(segmentBuildingDistance({ x: -1, z: -0.4 }, { x: 3, z: -0.4 }, building) - 0.4) < 1e-12)
})

test('a contact at the full-width boundary is rejected while a clear parallel segment passes', () => {
  assert.equal(roadCorridorClear({ x: -1, z: -0.5 }, { x: 3, z: -0.5 }, 1, [building]), false)
  assert.equal(roadCorridorClear({ x: -1, z: -0.75 }, { x: 3, z: -0.75 }, 1, [building]), true)
  assert.equal(roadCorridorClear({ x: -1, z: -0.75 }, { x: 3, z: -0.75 }, 1, [building, []]), false,
    'malformed building geometry fails closed')
})

test('a segment near a polygon corner uses distance to the actual ring, not its bounds', () => {
  assert.ok(Math.abs(segmentBuildingDistance({ x: -1, z: -0.8 }, { x: -0.5, z: -0.8 }, building) - Math.hypot(0.5, 0.8)) < 1e-12)
  assert.equal(roadCorridorClear({ x: -1, z: -0.8 }, { x: -0.5, z: -0.8 }, 1, [building]), true)
})

test('prepared bounds preserve scalar full-width results for every generated mapped-road segment', (t) => {
  const buildings = CAMPUS_MAP.buildings.map(({ ring }) => ring)
  const index = indexRoadBuildings(buildings)
  assert.ok(index)
  const rows = buildings.map((ring) => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
    for (const [x, z] of ring) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z) }
    return { ring, minX, minZ, maxX, maxZ }
  })
  // Baseline equivalent to the previous scalar bounds screen, with its
  // stationary bounds calculated once so this all-road parity fixture is bounded.
  const baseline = (a: { x: number; z: number }, b: { x: number; z: number }, width: number): boolean => {
    const radius = width / 2
    const minX = Math.min(a.x, b.x) - radius, maxX = Math.max(a.x, b.x) + radius
    const minZ = Math.min(a.z, b.z) - radius, maxZ = Math.max(a.z, b.z) + radius
    return rows.every((row) => row.maxX < minX || row.minX > maxX || row.maxZ < minZ || row.minZ > maxZ
      || (segmentBuildingDistance(a, b, row.ring) > radius + 1e-9))
  }
  let segments = 0, clear = 0, blocked = 0
  for (const road of CAMPUS_MAP.roads) for (let i = 1; i < road.points.length; i += 1) {
    const from = road.points[i - 1], to = road.points[i]
    assert.ok(from && to)
    const a = { x: from[0], z: from[1] }, b = { x: to[0], z: to[1] }
    const expected = baseline(a, b, road.width)
    assert.equal(roadCorridorClearIndexed(a, b, road.width, index), expected, `${road.id} segment ${i - 1}`)
    if (expected) clear += 1
    else blocked += 1
    segments += 1
  }
  assert.ok(clear > 0 && blocked > 0, 'the mapped corpus exercises both allowed and blocked road segments')
  t.diagnostic(`Mapped corpus: ${segments} segments, ${clear} clear, ${blocked} blocked`)
})

test('the compiled index is an immutable validated snapshot and invalid geometry fails closed', () => {
  const source: [number, number][][] = [[[0, 0], [2, 0], [2, 2], [0, 2]]]
  const index = indexRoadBuildings(source)
  assert.ok(index)
  source[0]![0] = [-100, -100]
  assert.equal(roadCorridorClearIndexed({ x: -1, z: 1 }, { x: 3, z: 1 }, 1, index), false,
    'mutating the source after compilation cannot change the copied map snapshot')
  assert.equal(roadCorridorClearIndexed({ x: -1, z: 1 }, { x: 3, z: 1 }, 1, {} as never), false,
    'a structurally forged token has no privately registered contents')
  assert.equal(indexRoadBuildings([]), null)
  assert.equal(roadCorridorClear({ x: -1, z: 1 }, { x: 3, z: 1 }, 1, []), false)
  assert.equal(indexRoadBuildings([[[0, 0], [1, 1]]]), null)
  assert.equal(indexRoadBuildings([[[0, 0], [1, Number.NaN], [1, 1]]]), null)
  assert.equal(indexRoadBuildings([[[0, 0], null, [1, 1]] as unknown as MetreRing]), null)
  const sparse = new Array<readonly [number, number]>(3)
  sparse[0] = [0, 0]; sparse[2] = [1, 1]
  assert.equal(indexRoadBuildings([sparse as MetreRing]), null, 'sparse rings fail closed instead of skipping missing vertices')
  assert.equal(roadCorridorClearIndexed({ x: 0, z: 0 }, { x: 1, z: 1 }, 1, indexRoadBuildings([building])), false,
    'boundary contact remains blocked')
  assert.equal(roadCorridorClear({ x: Number.POSITIVE_INFINITY, z: 0 }, { x: 1, z: 1 }, 1, [building]), false)
  assert.equal(roadCorridorClear({ x: -Number.MAX_VALUE, z: 0 }, { x: Number.MAX_VALUE, z: 0 }, 1, [building]), false,
    'finite endpoints whose corridor arithmetic overflows are not accepted as clear')
})
