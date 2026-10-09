import assert from 'node:assert/strict'
import test from 'node:test'
import { SEDAN_BOARDING_DESCRIPTOR } from './vehicle-boarding.ts'
import { verifyMappedSweep } from './mapped-sweep.ts'

const pose = (x: number, z: number, headingRadians: number) => ({ center: { x, z }, headingRadians })
const rect = (halfX: number, halfZ: number) => [
  { x: -halfX, z: -halfZ }, { x: halfX, z: -halfZ },
  { x: halfX, z: halfZ }, { x: -halfX, z: halfZ },
]
const check = (from: ReturnType<typeof pose>, to: ReturnType<typeof pose>, supportPolygon = rect(8, 12), buildings: unknown[] = []) =>
  verifyMappedSweep({ descriptor: SEDAN_BOARDING_DESCRIPTOR, from, to, supportPolygon, buildings })

test('source-pinned street sedan fits a straight authored lane with margin and never gains authority', () => {
  const result = check(pose(0, -3, 0), pose(0, 3, 0), rect(2.5, 8))
  assert.equal(result.reason, 'clear')
  assert.ok(result.minimumSupportClearanceM !== null && result.minimumSupportClearanceM > 0.05)
  assert.equal(result.obstacleEnvelopeRadiusM, Math.hypot(1.302, 2.271) + 0.05)
  assert.equal(result.routeAuthorized, false)
  assert.equal(result.canBoard, false)
  assert.equal(result.scope, 'closed-vehicle-swept-footprint-only')
})

test('analytical heading critical angles reject a mid-rotation protrusion with fitting endpoints', () => {
  const support = rect(2.4, 2.4)
  assert.equal(check(pose(0, 0, 0), pose(0, 0, 0), support).reason, 'clear')
  assert.equal(check(pose(0, 0, Math.PI / 2), pose(0, 0, Math.PI / 2), support).reason, 'clear')
  const swept = check(pose(0, 0, 0), pose(0, 0, Math.PI / 2), support)
  assert.equal(swept.reason, 'outside_support')
  assert.ok(swept.minimumSupportClearanceM !== null && swept.minimumSupportClearanceM < 0)
})

test('the analytic minimum accounts for translation and rotation at the same interior time', () => {
  const support = rect(2.7, 2.7)
  assert.equal(check(pose(0, 0, 0), pose(0, 0, 0), support).reason, 'clear', 'the first endpoint fits')
  assert.equal(check(pose(0.3, 0, Math.PI / 2), pose(0.3, 0, Math.PI / 2), support).reason, 'clear', 'the second endpoint fits')
  const fixedCenter = check(pose(0, 0, 0), pose(0, 0, Math.PI / 2), support)
  assert.equal(fixedCenter.reason, 'clear')
  const moved = check(pose(0, 0, 0), pose(0.3, 0, Math.PI / 2), support)
  assert.equal(moved.reason, 'outside_support', 'the combined path exceeds the boundary between its fitting endpoints')
})

test('heading wrap takes the short continuous turn and edge margin is fail-closed', () => {
  const wrapLane = rect(1.5, 8)
  const wrapped = check(pose(0, 0, 179 * Math.PI / 180), pose(0, 0, -179 * Math.PI / 180), wrapLane)
  assert.equal(wrapped.reason, 'clear')
  assert.ok(wrapped.headingDeltaRadians !== null && Math.abs(wrapped.headingDeltaRadians) < 3 * Math.PI / 180)

  const grazing = check(pose(0, 0, 0), pose(0, 0, 0), rect(1.3521, 5))
  const tooNarrow = check(pose(0, 0, 0), pose(0, 0, 0), rect(1.3519, 5))
  assert.equal(grazing.reason, 'clear')
  assert.equal(tooNarrow.reason, 'outside_support')
})

test('the circumscribed body envelope blocks a whole-line obstacle crossing despite clear endpoints', () => {
  const building = [[{ x: -0.2, z: -0.2 }, { x: 0.2, z: -0.2 }, { x: 0.2, z: 0.2 }, { x: -0.2, z: 0.2 }]]
  const result = check(pose(-6, 0, Math.PI / 2), pose(6, 0, Math.PI / 2), rect(10, 10), building)
  assert.equal(result.reason, 'building_clearance')
  assert.equal(result.routeAuthorized, false)
})

test('future descriptor, malformed polygons, nonfinite poses, sparse arrays and excess work refuse', () => {
  const future = JSON.parse(JSON.stringify(SEDAN_BOARDING_DESCRIPTOR)) as { schemaVersion: number }
  future.schemaVersion = 2
  const base = { descriptor: SEDAN_BOARDING_DESCRIPTOR, from: pose(0, 0, 0), to: pose(0, 1, 0), supportPolygon: rect(8, 8), buildings: [] }
  assert.equal(verifyMappedSweep({ ...base, descriptor: future }).reason, 'invalid_descriptor')
  assert.equal(verifyMappedSweep({ ...base, from: pose(Number.NaN, 0, 0) }).reason, 'invalid_pose')
  assert.equal(verifyMappedSweep({ ...base, supportPolygon: [{ x: 0, z: 0 }, , { x: 1, z: 0 }, { x: 0, z: 1 }] }).reason, 'invalid_support')
  assert.equal(verifyMappedSweep({ ...base, supportPolygon: rect(8, 8).reverse() }).reason, 'clear', 'clockwise convex support is valid')
  assert.equal(verifyMappedSweep({ ...base, supportPolygon: rect(8, 8).concat([{ x: 0, z: 0 }]) }).reason, 'invalid_support')
  const crossing = [{ x: 0, z: 0 }, { x: 3, z: 3 }, { x: 0, z: 4 }, { x: 4, z: 0 }]
  assert.equal(verifyMappedSweep({ ...base, buildings: [crossing] }).reason, 'invalid_buildings')
  const concaveAway = [{ x: 20, z: 20 }, { x: 24, z: 20 }, { x: 24, z: 21 }, { x: 21, z: 21 }, { x: 21, z: 24 }, { x: 20, z: 24 }]
  assert.equal(verifyMappedSweep({ ...base, buildings: [concaveAway] }).reason, 'clear', 'simple concave building footprints are accepted')
  assert.equal(verifyMappedSweep({ ...base, buildings: Array.from({ length: 65 }, () => rect(1, 1)) }).reason, 'invalid_buildings')
  let gets = 0
  const center = new Proxy({ x: 0, z: 0 }, { get(_target, key) { gets++; if (key === 'x' || key === 'z') throw new Error('unexpected property read'); return undefined } })
  assert.equal(verifyMappedSweep({ ...base, from: { center, headingRadians: 0 } }).reason, 'clear')
  assert.equal(gets, 0, 'point validation and use rely on own data descriptors rather than proxy get traps')
  const hostile = new Proxy(base, { ownKeys() { throw new Error('hostile') } })
  assert.equal(verifyMappedSweep(hostile).reason, 'invalid_input')
})
