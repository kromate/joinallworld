import assert from 'node:assert/strict'
import test from 'node:test'

import { roadCorridorClear, segmentBuildingDistance } from './shuttle-clearance.ts'
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
