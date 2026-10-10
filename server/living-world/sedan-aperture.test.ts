import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  analyzeSedanAperture,
  SEDAN_APERTURE_SOURCE,
  type SedanApertureInput,
  type SedanCapsule,
} from './sedan-aperture.ts'

const identity = Object.freeze({ position: Object.freeze([0, 0, 0] as const), quaternion: Object.freeze([0, 0, 0, 1] as const), motion: 'static' as const })
const capsule = (id: string, x: number, y: number, z: number, radius = 0.02, phase: SedanCapsule['phase'] = 'enter-walk'): SedanCapsule => ({
  id, start: [x, y, z], end: [x, y, z], radius, phase, provenance: 'test-candidate-only',
})
const input = (capsules: readonly SedanCapsule[], changes: Partial<SedanApertureInput> = {}): SedanApertureInput => ({
  sourcePins: SEDAN_APERTURE_SOURCE.pins,
  bodyTransform: identity,
  capsules: capsules.length ? capsules : [capsule('bounded-fixture', -2.8, 1, 0.4)],
  contactMargin: 0.005,
  doorAngleInterval: [0, Math.PI * 0.55],
  steeringInterval: [-1, 1],
  ...changes,
})
const world = (point: readonly [number, number, number], position: readonly [number, number, number], quaternion: readonly [number, number, number, number]): readonly [number, number, number] => {
  const [x, y, z, w] = quaternion, [px, py, pz] = point
  const ix = w * px + y * pz - z * py, iy = w * py + z * px - x * pz, iz = w * pz + x * py - y * px, iw = -x * px - y * py - z * pz
  return [ix * w + iw * -x + iy * -z - iz * -y + position[0],
    iy * w + iw * -y + iz * -x - ix * -z + position[1],
    iz * w + iw * -z + ix * -y - iy * -x + position[2]]
}
const pinnedSource = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('source-pinned driver cap partition matches Float32 emission coordinates', () => {
  for (const [path, expected] of Object.entries(SEDAN_APERTURE_SOURCE.pins))
    assert.equal(createHash('sha256').update(pinnedSource(path)).digest('hex'), expected, path)
  assert.match(pinnedSource('src/models/vehicles/geometry.ts'), /new THREE\.Float32BufferAttribute\(positions, 3\)/)
  assert.match(pinnedSource('src/models/vehicles/index.ts'), /x: -width \/ 2 - 0\.01, y: 0\.93, z: 0\.42/)
  assert.match(pinnedSource('src/models/vehicles/index.ts'), /amount: PI \* 0\.55/)
  assert.match(pinnedSource('src/models/vehicles/sedan-interior.ts'), /poseSteering/)
  const result = analyzeSedanAperture(input([]))
  assert.equal(result.code, 'ok')
  assert.equal(result.canBoard, false)
  assert.equal(result.authoritativeClearance, false)
  assert.equal(result.routeAuthorized, false)
  assert.equal(SEDAN_APERTURE_SOURCE.detail, 'street')
  const geometry = result.sourceGeometry!
  assert.deepEqual(geometry.driverSideApertureZY, [
    [-0.05000000074505806, 0.49000000953674316],
    [0.8899999856948853, 0.49000000953674316],
    [0.8899999856948853, 1.2699998617172241],
    [0.7324999570846558, 1.4800000190734863],
    [-0.05000000074505806, 1.4800000190734863],
  ])
  assert.deepEqual(geometry.retainedProfileZY[0], [-2.174999952316284, 0.44999998807907104])
  assert.deepEqual(geometry.doorSweepRadians, [0, Math.PI * 0.55])
  assert.deepEqual(geometry.steeringSweep, '[-1,1]')
  assert.equal(geometry.interiorObstacleIds.length, 12)
  assert.deepEqual(geometry.retainedShell, {
    prismWidth: 1.9,
    driverCapX: -0.95,
    oppositeCapX: 0.95,
    oppositeCap: 'retained',
    roofHoodSill: 'profile-prism-surfaces-retained',
    windscreenLowerZY: [1.755, 0.94],
    windscreenUpperZY: [0.695, 1.53],
    sideGlassAndPillar: [
      { id: 'driver-front-glass', center: [-0.966, 1.20, 0.4175], size: [0.04, 0.5, 1.085] },
      { id: 'driver-rear-glass', center: [-0.966, 1.20, -0.7575], size: [0.04, 0.5, 1.125] },
      { id: 'driver-b-pillar', center: [-0.975, 1.20, -0.16], size: [0.055, 0.58, 0.1] },
    ],
    sideTrimPanels: [
      { id: 'driver-shoulder-trim', center: [-0.995, 0.94, 0], size: [0.06, 0.09, 3.306] },
      { id: 'driver-pillar-trim', center: [-1.002, 0.88, -0.18], size: [0.065, 0.68, 0.035] },
      { id: 'driver-door-handle-trim', center: [-1.008, 0.91, 0.12], size: [0.075, 0.07, 0.28] },
    ],
    clippedGlassAndTrim: 'hinged-parts-in-sweep-envelope; remainder-retained',
  })
  assert.equal(Object.isFrozen(geometry.doorSweepBounds.min), true)
  assert.equal(Object.isFrozen(geometry.retainedShell.sideGlassAndPillar[0]!.center), true)
})

test('the tapered front rejects a capsule that fits at the aperture center', () => {
  const center = analyzeSedanAperture(input([capsule('center', -0.95, 1.40, 0.3)]))
  const front = analyzeSedanAperture(input([capsule('front', -0.95, 1.40, 0.78)]))
  assert.deepEqual(center.apertureCrossings, ['center'])
  assert.deepEqual(center.apertureFailures, [])
  assert.deepEqual(front.apertureCrossings, [])
  assert.deepEqual(front.apertureFailures, ['front'])
})

test('the complete hinged-door interval catches intermediate motion missed by endpoint poses', () => {
  const geometry = analyzeSedanAperture(input([])).sourceGeometry!
  const [hx, hy, hz] = [-0.96, 0.93, 0.89]
  const theta = Math.PI * 0.275
  const local = [-1.07, 1.0, -0.05]
  const dx = local[0]! - hx, dz = local[2]! - hz
  const sweptPoint = [hx + dx * Math.cos(theta) + dz * Math.sin(theta), hy + 0.07,
    hz - dx * Math.sin(theta) + dz * Math.cos(theta)] as const
  assert.ok(sweptPoint[0] >= geometry.doorSweepBounds.min[0] && sweptPoint[0] <= geometry.doorSweepBounds.max[0])
  assert.ok(sweptPoint[2] >= geometry.doorSweepBounds.min[2] && sweptPoint[2] <= geometry.doorSweepBounds.max[2])
  const result = analyzeSedanAperture(input([capsule('mid-sweep', ...sweptPoint, 0.01)]))
  assert.ok(result.sweepOverlapCandidates.includes('mid-sweep:door-sweep'))
  // The envelope is analytic: its bounds contain points from every angle, not only the endpoints.
  for (let step = 0; step <= 1000; step += 1) {
    const angle = Math.PI * 0.55 * step / 1000
    for (const x of [-1.07, -0.89]) for (const z of [-0.05, 0.89]) {
      const rx = hx + (x - hx) * Math.cos(angle) + (z - hz) * Math.sin(angle)
      const rz = hz - (x - hx) * Math.sin(angle) + (z - hz) * Math.cos(angle)
      assert.ok(rx >= geometry.doorSweepBounds.min[0] && rx <= geometry.doorSweepBounds.max[0])
      assert.ok(rz >= geometry.doorSweepBounds.min[2] && rz <= geometry.doorSweepBounds.max[2])
    }
  }
})

test('source interior and steering sweeps report known possible intersections', () => {
  const candidates = [
    capsule('floor', 0, 0.49, 0),
    capsule('seat', -0.4, 0.57, 0.4),
    capsule('dashboard', 0, 1.05, 0.77),
    capsule('wheel', -0.437, 0.93, 0.60),
  ]
  const result = analyzeSedanAperture(input(candidates))
  assert.equal(result.knownModelIntersection, true)
  for (const id of ['floor:cabin-floor', 'seat:driver-cushion', 'dashboard:dashboard'])
    assert.ok(result.modelIntersections.includes(id), id)
  assert.ok(result.sweepOverlapCandidates.includes('wheel:steering-wheel-full-input-sweep'))
  assert.equal(result.candidateGeometry, 'known-model-intersection')
})

test('closed, intermediate, and fully open door positions are covered by one full-sweep envelope', () => {
  const [hx, hy, hz] = [-0.96, 0.93, 0.89]
  const angle = Math.PI * 0.55, x = -1.07, y = 1, z = -0.05
  const dx = x - hx, dz = z - hz
  const open = [hx + dx * Math.cos(angle) + dz * Math.sin(angle), hy + y - 0.93,
    hz - dx * Math.sin(angle) + dz * Math.cos(angle)] as const
  const result = analyzeSedanAperture(input([
    capsule('closed', -0.96, 0.93, 0.42),
    capsule('intermediate', -1.65, 0.93, 0.10),
    capsule('open', ...open),
  ]))
  for (const id of ['closed', 'intermediate', 'open']) assert.ok(result.sweepOverlapCandidates.includes(`${id}:door-sweep`), id)
})

test('valid rigid body transforms are applied and non-rigid or malformed transforms fail closed', () => {
  const rotated = input([capsule('transformed-floor', 1, 0.49, 0)], {
    bodyTransform: { position: [1, 0, 0], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2], motion: 'static' },
  })
  const transformed = analyzeSedanAperture(rotated)
  assert.equal(transformed.code, 'ok')
  assert.ok(transformed.modelIntersections.includes('transformed-floor:cabin-floor'))
  for (const bodyTransform of [
    { position: [0, 0, 0], quaternion: [0, 0, 0, 2], motion: 'static' },
    { position: [0, 0, 0], quaternion: [0, 0, 0, 1], motion: 'static', scale: [1, 1, 1] },
    { position: [0, 0, 0], quaternion: [0, 0, 0, 1], motion: 'static', shear: [0, 0, 0] },
    { position: [0, 0, 0], quaternion: [0, 0, 0, 1], motion: 'static', determinant: -1 },
    { position: [0, 0, 0], quaternion: [0, 0, 0, 1], motion: 'moving' },
    { position: [0, 0, 0], quaternion: [0, 0, Number.NaN, 1], motion: 'static' },
  ]) assert.equal(analyzeSedanAperture(input([], { bodyTransform } as Partial<SedanApertureInput>)).code, 'invalid_descriptor')
})

test('translated static yaw, pitch, and roll preserve body-local obstacle checks', () => {
  for (const [roll, pitch, yaw] of [[0.31, 0, 0], [0, -0.27, 0], [0, 0, 0.68], [0.2, -0.3, 0.4]]) {
    const sx = Math.sin(roll / 2), cx = Math.cos(roll / 2), sy = Math.sin(pitch / 2), cy = Math.cos(pitch / 2), sz = Math.sin(yaw / 2), cz = Math.cos(yaw / 2)
    const quaternion = [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz,
      cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz] as const
    const position = [1.2, -0.4, 0.7] as const
    const point = world([0, 0.49, 0], position, quaternion)
    const result = analyzeSedanAperture(input([{
      id: 'rigid-floor', start: point, end: point, radius: 0.02, phase: 'enter-seat', provenance: 'static-rigid-transform-fixture',
    }], { bodyTransform: { position, quaternion, motion: 'static' } }))
    assert.ok(result.modelIntersections.includes('rigid-floor:cabin-floor'), `${roll}/${pitch}/${yaw}`)
  }
})

test('relative 10m bounds are invariant to vehicle translation away from world origin', () => {
  const origin = analyzeSedanAperture(input([capsule('local-floor', 0, 0.49, 0)]))
  const position = [100, -40, 25] as const
  const point = world([0, 0.49, 0], position, [0, 0, 0, 1])
  const translated = analyzeSedanAperture(input([{
    id: 'translated-floor', start: point, end: point, radius: 0.02, phase: 'enter-seat', provenance: 'translation-invariance',
  }], { bodyTransform: { position, quaternion: [0, 0, 0, 1], motion: 'static' } }))
  assert.ok(origin.modelIntersections.includes('local-floor:cabin-floor'))
  assert.ok(translated.modelIntersections.includes('translated-floor:cabin-floor'))
  const tooFar = world([10.01, 0.49, 0], position, [0, 0, 0, 1])
  assert.equal(analyzeSedanAperture(input([{
    id: 'too-far-relative', start: tooFar, end: tooFar, radius: 0.02, phase: 'enter-seat', provenance: 'range-check',
  }], { bodyTransform: { position, quaternion: [0, 0, 0, 1], motion: 'static' } })).code, 'invalid_descriptor')
})

test('source pins, descriptor accessors, capsule bounds, radii, and capsule count are checked', () => {
  const wrongPins = { ...SEDAN_APERTURE_SOURCE.pins, 'src/models/vehicles/index.ts': 'unknown' }
  assert.equal(analyzeSedanAperture(input([], { sourcePins: wrongPins as typeof SEDAN_APERTURE_SOURCE.pins })).code, 'unsupported_source')
  const accessor = Object.defineProperty({}, 'sourcePins', { get() { throw new Error('must not invoke getter') } })
  assert.equal(analyzeSedanAperture(accessor).code, 'unsupported_source')
  for (const bad of [
    capsule('too-far', 10.01, 0, 0),
    capsule('too-large', 0, 0, 0, 2.01),
    { ...capsule('bad-id', 0, 0, 0), provenance: '' },
  ]) assert.equal(analyzeSedanAperture(input([bad])).code, 'invalid_descriptor')
  assert.equal(analyzeSedanAperture(input(Array.from({ length: 65 }, (_, i) => capsule(`c${i}`, 0, 0, 0)))).code, 'invalid_descriptor')
  assert.equal(analyzeSedanAperture(input([capsule('duplicate', 0, 0, 0), capsule('duplicate', 1, 0, 0)])).code, 'invalid_descriptor')
  const capsuleGetter = Object.defineProperty({ ...capsule('accessor', 0, 0, 0) }, 'radius', { get() { throw new Error('no getter') } })
  assert.equal(analyzeSedanAperture(input([capsuleGetter])).code, 'invalid_descriptor')
  assert.equal(analyzeSedanAperture(input([{ ...capsule('moving', 0, 0, 0), velocity: [1, 0, 0] } as SedanCapsule])).code, 'invalid_descriptor')
})

test('Float32 and explicit margins shrink the opening and grow modeled obstacles', () => {
  const exact = analyzeSedanAperture(input([capsule('near-roof', -0.95, 1.45, 0.3, 0.02)], { contactMargin: 0.005 }))
  const margined = analyzeSedanAperture(input([capsule('near-roof', -0.95, 1.45, 0.3, 0.02)], { contactMargin: 0.02 }))
  assert.deepEqual(exact.apertureCrossings, ['near-roof'])
  assert.deepEqual(margined.apertureFailures, ['near-roof'])
  const obstacle = analyzeSedanAperture(input([capsule('near-floor', 0, 0.54, 0)], { contactMargin: 0.03 }))
  assert.ok(obstacle.modelIntersections.includes('near-floor:cabin-floor'))
})

test('retained opposite cap and shell profile are checked as conservative obstacles', () => {
  const result = analyzeSedanAperture(input([
    capsule('opposite-cap-hit', 0.95, 1.35, 0.3),
    capsule('roof-edge-hit', 0, 1.53, 0.3),
  ]))
  assert.ok(result.shellIntersections.includes('opposite-cap-hit:opposite-cap'))
  assert.ok(result.shellIntersections.some(value => value.startsWith('roof-edge-hit:retained-profile-edge-')))
  assert.equal(result.canBoard, false)
  assert.equal(result.authoritativeClearance, false)
})

test('aperture boundary failure is blocked and never reported clear', () => {
  const result = analyzeSedanAperture(input([capsule('above-opening', -0.95, 1.55, 0.3)]))
  assert.deepEqual(result.apertureFailures, ['above-opening'])
  assert.equal(result.status, 'blocked_candidate')
  assert.equal(result.reason, 'aperture_boundary_failure')
  assert.equal(result.candidateGeometry, 'aperture-boundary-failure')
})

test('explicit intervals, positive numeric margin, phase labels, and static pose fail closed', () => {
  const base = [capsule('phase', -2.8, 1, 0.4, 0.02, 'enter-seat')]
  assert.equal(analyzeSedanAperture(input(base, { doorAngleInterval: [0.2, 0.8] })).sourceGeometry!.doorSweepRadians[0], 0.2)
  for (const changes of [
    { doorAngleInterval: undefined },
    { doorAngleInterval: [0.8, 0.2] },
    { doorAngleInterval: [-0.01, 0.2] },
    { doorAngleInterval: [0, Math.PI] },
    { steeringInterval: undefined },
    { steeringInterval: [0.5, -0.5] },
    { steeringInterval: [-1.1, 0] },
    { contactMargin: 0 },
    { contactMargin: 0.004999 },
    { contactMargin: 0.251 },
  ]) assert.equal(analyzeSedanAperture(input(base, changes as Partial<SedanApertureInput>)).code, 'invalid_descriptor')
  assert.equal(analyzeSedanAperture({ ...input(base), capsules: [] }).code, 'invalid_descriptor')
  const noPhase = { ...base[0] } as Record<string, unknown>
  delete noPhase.phase
  assert.equal(analyzeSedanAperture(input([noPhase as SedanCapsule])).code, 'invalid_descriptor')
  assert.equal(analyzeSedanAperture(input(base, { bodyTransform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } as SedanApertureInput['bodyTransform'] })).code, 'invalid_descriptor')
})

test('scene phase fixtures preserve normal and reduced motion ordering without actor-fit claims', () => {
  const source = readFileSync(new URL('../../src/app/features/living-world/drivingScene.ts', import.meta.url), 'utf8')
  for (const phase of ['enter-walk', 'enter-seat', 'exit-slide', 'exit-seat']) assert.ok(source.includes(`phase === '${phase}'`))
  assert.ok(source.indexOf("} else if (phase === 'enter-walk')") < source.indexOf("} else if (phase === 'enter-seat')"))
  assert.ok(source.indexOf("} else if (phase === 'exit-slide')") < source.indexOf("} else if (phase === 'exit-seat')"))
  const enterSeat = source.slice(source.indexOf("} else if (phase === 'enter-seat')"), source.indexOf("} else if (phase === 'exit-door')"))
  assert.match(enterSeat, /reduceMotion \? 0\.18 : 0\.38/)
  assert.match(enterSeat, /reduceMotion \? 0\.1 : 0\.22/)
  assert.match(enterSeat, /moveActor\(seated, heading, 'sit'/)
  assert.match(enterSeat, /1 - Math\.max\(0, phaseTime - seatMoveDuration\) \/ doorCloseDuration/)
  const exitSlide = source.slice(source.indexOf("} else if (phase === 'exit-slide')"), source.indexOf("} else if (phase === 'exit-seat')"))
  assert.match(exitSlide, /bodySeat\.[xz].*exitSeat\.[xz]/s)
  assert.match(exitSlide, /moveActor\(seated, current\.heading, 'sit'/)
  assert.match(exitSlide, /setActorPose\('stand'/)
  const exitSeat = source.slice(source.indexOf("} else if (phase === 'exit-seat')"), source.indexOf("} else if (phase === 'exit-walk')"))
  assert.match(exitSeat, /reduceMotion \? 0\.22 : 0\.35/)
  const candidates = [
    capsule('normal-enter-walk', -1.12, 0.8, 0.2, 0.18, 'enter-walk'),
    capsule('reduced-enter-seat', -0.96, 0.9, 0.42, 0.18, 'enter-seat'),
    capsule('normal-exit-slide', -0.95, 0.75, 0.42, 0.18, 'exit-slide'),
    capsule('reduced-exit-seat', -1.4, 0.55, 0.42, 0.18, 'exit-seat'),
  ].map(item => ({ ...item, provenance: 'scene-anchor-trajectory-only-unverified' }))
  const result = analyzeSedanAperture(input(candidates))
  assert.equal(result.code, 'ok')
  assert.equal(result.canBoard, false)
  assert.equal(result.authoritativeClearance, false)
  assert.equal(result.routeAuthorized, false)
})

test('the authority contract stays negative even for empty or apparently clear proposals', () => {
  const result = analyzeSedanAperture(input([capsule('outside', -2.8, 1, 0.4)]))
  assert.equal(result.code, 'ok')
  assert.equal(result.candidateGeometry, 'clear-for-supplied-capsules')
  assert.deepEqual([result.canBoard, result.authoritativeClearance, result.routeAuthorized], [false, false, false])
  assert.deepEqual(result.missingProof, ['complete_clothed_actor_pose', 'terrain_and_support', 'continuous_entry_motion', 'full_scene_collision', 'route_and_yield_authority'])
})
