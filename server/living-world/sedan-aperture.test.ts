import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { buildVehicle, poseVehicle } from '../../src/models/vehicles/index.ts'
import { createSedanInterior } from '../../src/models/vehicles/sedan-interior.ts'
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
function pointToMeshDistance(point: readonly [number, number, number], mesh: THREE.Mesh): number {
  const attribute = mesh.geometry.getAttribute('position'), index = mesh.geometry.index
  const target = new THREE.Vector3(...point), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3()
  let minimum = Infinity
  const count = index?.count ?? attribute.count
  for (let offset = 0; offset + 2 < count; offset += 3) {
    const ia = index?.getX(offset) ?? offset, ib = index?.getX(offset + 1) ?? offset + 1, ic = index?.getX(offset + 2) ?? offset + 2
    triangle.set(a.fromBufferAttribute(attribute, ia).applyMatrix4(mesh.matrixWorld),
      b.fromBufferAttribute(attribute, ib).applyMatrix4(mesh.matrixWorld), c.fromBufferAttribute(attribute, ic).applyMatrix4(mesh.matrixWorld))
    triangle.closestPointToPoint(target, closest)
    minimum = Math.min(minimum, closest.distanceTo(target))
  }
  return minimum
}

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
  for (const id of ['driver-cap-retained-rear', 'driver-cap-retained-front', 'driver-cap-retained-sill',
    'driver-cap-retained-roof', 'windscreen-sloped-panel', 'rear-glass-static', 'roof-shoulder-trim',
    'passenger-front-glass', 'passenger-rear-glass', 'passenger-b-pillar', 'passenger-shoulder-trim',
    'passenger-pillar-trim', 'passenger-door-handle-trim']) assert.ok(geometry.retainedObstacleIds.includes(id), id)
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
      { id: 'passenger-front-glass', center: [0.966, 1.20, 0.4175], size: [0.04, 0.5, 1.085] },
      { id: 'passenger-rear-glass', center: [0.966, 1.20, -0.7575], size: [0.04, 0.5, 1.125] },
      { id: 'passenger-b-pillar', center: [0.975, 1.20, -0.16], size: [0.055, 0.58, 0.1] },
    ],
    sideTrimPanels: [
      { id: 'driver-shoulder-trim', center: [-0.995, 0.94, 0], size: [0.06, 0.09, 3.306] },
      { id: 'driver-pillar-trim', center: [-1.002, 0.88, -0.18], size: [0.065, 0.68, 0.035] },
      { id: 'driver-door-handle-trim', center: [-1.008, 0.91, 0.12], size: [0.075, 0.07, 0.28] },
      { id: 'passenger-shoulder-trim', center: [0.995, 0.94, 0], size: [0.06, 0.09, 3.306] },
      { id: 'passenger-pillar-trim', center: [1.002, 0.88, -0.18], size: [0.065, 0.68, 0.035] },
      { id: 'passenger-door-handle-trim', center: [1.008, 0.91, 0.04], size: [0.075, 0.07, 0.28] },
    ],
    clippedGlassAndTrim: 'driver-cut-pieces-hinged; all-other-glass-and-trim-retained',
  })
  assert.equal(Object.isFrozen(geometry.doorSweepBounds.min), true)
  assert.equal(Object.isFrozen(geometry.retainedShell.sideGlassAndPillar[0]!.center), true)
})

test('actual map and street CPU sedan/interior/door partitions emit bounded Float32 meshes', () => {
  for (const detail of ['map', 'street'] as const) {
    const model = buildVehicle('sedan', { detail })
    const interior = createSedanInterior(model)
    try {
      const body = model.userData.parts.body
      const staticBody = body.getObjectByName('static-body')
      const doorRoot = model.userData.parts.doors[0]
      const doorPanel = doorRoot?.getObjectByName('door-panel')
      if (!(staticBody instanceof THREE.Mesh) || !(doorPanel instanceof THREE.Mesh)) throw new Error(`${detail} sedan meshes are missing`)
      const staticPosition = staticBody.geometry.getAttribute('position')
      const doorPosition = doorPanel.geometry.getAttribute('position')
      const interiorPosition = interior.geometry.getAttribute('position')
      assert.ok(staticPosition.array instanceof Float32Array)
      assert.ok(doorPosition.array instanceof Float32Array)
      assert.ok(interiorPosition.array instanceof Float32Array)
      assert.ok(staticPosition.count > 0 && doorPosition.count > 0 && interiorPosition.count > 0)
      assert.ok(Math.abs(doorRoot.position.x + 0.96) <= 1e-12)
      assert.ok(Math.abs(doorRoot.position.y - 0.93) <= 1e-12)
      assert.ok(Math.abs(doorRoot.position.z - 0.89) <= 1e-12)
      poseVehicle(model, { door: 0 })
      model.object3D.updateMatrixWorld(true)
      const hasWorldVertex = (mesh: THREE.Mesh, expected: readonly [number, number, number]): boolean => {
        const attribute = mesh.geometry.getAttribute('position')
        for (let index = 0; index < attribute.count; index += 1) {
          const point = new THREE.Vector3().fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld)
          if (point.distanceToSquared(new THREE.Vector3(...expected)) < 1e-10) return true
        }
        return false
      }
      const movingGlassVertex: readonly [number, number, number] = detail === 'street' ? [-0.986, 1.45, 0.89] : [-0.966, 1.45, -0.05]
      const retainedGlassVertex: readonly [number, number, number] = detail === 'street' ? [-0.986, 1.45, 0.96] : [-0.966, 1.45, -1.214]
      assert.ok(hasWorldVertex(doorPanel, movingGlassVertex), `${detail} clipped glass remains in the moving door mesh`)
      assert.ok(hasWorldVertex(staticBody, retainedGlassVertex), `${detail} glass remainder stays in static body mesh`)
      if (detail === 'street') {
        assert.ok(hasWorldVertex(doorPanel, [-1.0455, 0.875, -0.02]), 'clipped handle trim remains on the articulated panel')
        assert.ok(hasWorldVertex(staticBody, [-1.025, 0.895, -1.653]), 'shoulder trim outside the cut remains in the static body')
        assert.ok(hasWorldVertex(staticBody, [-0.836, 1.595, -1.1435]), 'roof shoulder trim remains in the static body outside the hinge cut')
      }
      if (detail === 'street') {
        assert.ok(hasWorldVertex(staticBody, [1.025, 0.895, -1.653]), 'opposite shoulder trim remains static')
        assert.ok(hasWorldVertex(staticBody, [1.0455, 0.875, -0.1]), 'opposite handle trim remains static')
      }
      const modelGeometry = analyzeSedanAperture(input([capsule('actual-mesh-fixture', -2.8, 1, 0.4)])).sourceGeometry!
      const bounds = modelGeometry.doorSweepBounds
      for (const door of [0, 0.5, 1]) {
        poseVehicle(model, { door })
        model.object3D.updateMatrixWorld(true)
        for (let index = 0; index < doorPosition.count; index += 1) {
          const point = new THREE.Vector3().fromBufferAttribute(doorPosition, index).applyMatrix4(doorPanel.matrixWorld)
          assert.ok(point.x >= bounds.min[0] - 1e-5 && point.x <= bounds.max[0] + 1e-5, `${detail}/${door}/x`)
          assert.ok(point.y >= bounds.min[1] - 1e-5 && point.y <= bounds.max[1] + 1e-5, `${detail}/${door}/y`)
          assert.ok(point.z >= bounds.min[2] - 1e-5 && point.z <= bounds.max[2] + 1e-5, `${detail}/${door}/z`)
        }
      }
      const solidIds = interior.solids.map(solid => solid.id)
      assert.ok(solidIds.includes('cabin-floor') && solidIds.includes('dashboard') && solidIds.includes('driver-cushion') && solidIds.includes('driver-backrest'))
      assert.equal(solidIds.filter(id => id.endsWith('-cushion')).length, 4)
      assert.equal(solidIds.filter(id => id.endsWith('-backrest')).length, 4)
      const expectedInteriorBounds: Record<string, readonly [number, number, number, number, number, number]> = {
        'cabin-floor': [-0.78, 0.46, -1.25, 0.78, 0.52, 0.90],
        dashboard: [-0.67, 0.985, 0.63, 0.67, 1.125, 0.91],
        'driver-cushion': [-0.707, 0.50, 0.14, -0.167, 0.62, 0.76],
        'driver-backrest': [-0.707, 0.62, 0.045, -0.167, 1.20, 0.175],
        'front-passenger-cushion': [0.167, 0.50, 0.14, 0.707, 0.62, 0.76],
        'front-passenger-backrest': [0.167, 0.62, 0.045, 0.707, 1.20, 0.175],
        'rear-driver-side-cushion': [-0.707, 0.50, -0.86, -0.167, 0.62, -0.24],
        'rear-driver-side-backrest': [-0.707, 0.62, -0.955, -0.167, 1.20, -0.825],
        'rear-passenger-side-cushion': [0.167, 0.50, -0.86, 0.707, 0.62, -0.24],
        'rear-passenger-side-backrest': [0.167, 0.62, -0.955, 0.707, 1.20, -0.825],
      }
      for (const solid of interior.solids.filter(value => value.id !== 'steering-wheel')) {
        const expected = expectedInteriorBounds[solid.id]
        assert.ok(expected, `${detail}/${solid.id} has a matching analyzer descriptor`)
        const actual = [solid.bounds.min.x, solid.bounds.min.y, solid.bounds.min.z,
          solid.bounds.max.x, solid.bounds.max.y, solid.bounds.max.z]
        for (let coordinate = 0; coordinate < expected.length; coordinate += 1)
          assert.ok(Math.abs(actual[coordinate]! - expected[coordinate]!) <= 1e-6,
            `${detail}/${solid.id} actual geometry bound ${coordinate}: ${actual[coordinate]} vs ${expected[coordinate]}`)
      }
      const steering = interior.solids.find(solid => solid.id === 'steering-wheel')!
      for (const value of [-1, 1]) {
        interior.poseSteering(value)
        for (let vertex = steering.vertexStart; vertex < steering.vertexStart + steering.vertexCount; vertex += 1) {
          const offset = vertex * 3
          const x = interiorPosition.getX(vertex), y = interiorPosition.getY(vertex), z = interiorPosition.getZ(vertex)
          assert.ok(x >= -0.64 - 1e-5 && x <= -0.23 + 1e-5, `${detail}/${value}/steering-x/${offset}`)
          assert.ok(y >= 0.75 - 1e-5 && y <= 1.11 + 1e-5, `${detail}/${value}/steering-y/${offset}`)
          assert.ok(z >= 0.40 - 1e-5 && z <= 0.80 + 1e-5, `${detail}/${value}/steering-z/${offset}`)
        }
      }
    } finally {
      interior.dispose()
      model.userData.dispose()
    }
  }
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
  let coercions = 0
  const hostilePhase = { toString() { coercions += 1; throw new Error('phase must not be coerced') } }
  assert.equal(analyzeSedanAperture(input([{ ...capsule('hostile-phase', 0, 0, 0), phase: hostilePhase } as unknown as SedanCapsule])).code, 'invalid_descriptor')
  assert.equal(coercions, 0)
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

test('driver-side glass inside the clipped door region is moving, not a static shell collision', () => {
  const angle = Math.PI * 0.55
  const result = analyzeSedanAperture(input([capsule('glass-moving-part', -0.966, 1.2, 0.4)], {
    doorAngleInterval: [angle, angle],
  }))
  assert.equal(result.code, 'ok')
  assert.ok(!result.shellIntersections.some(id => id.startsWith('glass-moving-part:driver-front-glass')))
  assert.equal(result.candidateGeometry, 'clear-for-supplied-capsules')
  assert.deepEqual([result.canBoard, result.authoritativeClearance, result.routeAuthorized], [false, false, false])
})

test('retained source-cap and windshield contacts are covered by the shell envelopes', () => {
  for (const detail of ['map', 'street'] as const) {
    const model = buildVehicle('sedan', { detail })
    try {
      const body = model.userData.parts.body.getObjectByName('static-body')
      if (!(body instanceof THREE.Mesh)) throw new Error(`${detail} sedan static body mesh is missing`)
      model.object3D.updateMatrixWorld(true)
      const capPoint = [-0.95, 0.70, -1.30] as const
      assert.ok(pointToMeshDistance(capPoint, body) < 1e-5, `${detail} actual retained driver-cap triangles contact the fixture`)
      const cap = analyzeSedanAperture(input([capsule('retained-driver-cap', ...capPoint)]))
      assert.ok(cap.shellIntersections.includes('retained-driver-cap:driver-cap-retained-rear'))

      const windscreenPoint = [0, 0.94 + (1.755 - 1.4) * 0.59 / 1.06, 1.4] as const
      const windscreenDistance = pointToMeshDistance(windscreenPoint, body)
      assert.ok(windscreenDistance > 0.01 && windscreenDistance < 0.04, `${detail} source windshield triangle is near but outside this 1cm capsule: ${windscreenDistance}`)
      const windshield = analyzeSedanAperture(input([capsule('sloped-windscreen-envelope', ...windscreenPoint, 0.005)]))
      assert.ok(windshield.shellIntersections.includes('sloped-windscreen-envelope:windscreen-sloped-panel'))
      assert.deepEqual([windshield.canBoard, windshield.authoritativeClearance, windshield.routeAuthorized], [false, false, false])

      const angle = Math.atan2(0.695 - 1.755, 1.53 - 0.94), glassHeight = Math.hypot(0.695 - 1.755, 1.53 - 0.94)
      const centerY = (0.94 + 1.53) / 2 - Math.sin(angle) * 0.045
      const centerZ = (1.755 + 0.695) / 2 + Math.cos(angle) * 0.045
      for (const x of [-0.817, 0.817]) for (const y of [-glassHeight / 2, glassHeight / 2]) for (const z of [-0.0225, 0.0225]) {
        const vertex = [x, centerY + Math.cos(angle) * y - Math.sin(angle) * z,
          centerZ + Math.sin(angle) * y + Math.cos(angle) * z] as const
        assert.ok(pointToMeshDistance(vertex, body) < 1e-5, `${detail} actual sloped-windscreen vertex is present`)
        assert.ok(vertex[0] >= -0.817 - 1e-5 && vertex[0] <= 0.817 + 1e-5
          && vertex[1] >= 0.959 - 1e-5 && vertex[1] <= 1.589 + 1e-5
          && vertex[2] >= 0.705 - 1e-5 && vertex[2] <= 1.788 + 1e-5, `${detail} sloped-windscreen vertex fits the shell envelope`)
      }
      const glassFacePoint = [0, centerY - Math.sin(angle) * 0.0225, centerZ + Math.cos(angle) * 0.0225] as const
      assert.ok(pointToMeshDistance(glassFacePoint, body) < 1e-5, `${detail} actual sloped-windscreen face contact`)
      assert.ok(analyzeSedanAperture(input([capsule('sloped-windscreen-face', ...glassFacePoint, 0.001)]))
        .shellIntersections.includes('sloped-windscreen-face:windscreen-sloped-panel'))

      const oppositeGlassPoint = [detail === 'street' ? 0.986 : 0.966, 1.2, 0.4] as const
      assert.ok(pointToMeshDistance(oppositeGlassPoint, body) < 1e-5, `${detail} actual opposite-front-glass triangles contact the witness`)
      const oppositeGlass = analyzeSedanAperture(input([capsule('opposite-front-glass', ...oppositeGlassPoint, 0.001)]))
      assert.ok(oppositeGlass.shellIntersections.includes('opposite-front-glass:passenger-front-glass'))

      const rearGlassPoint = [0, 1.2 - Math.sin(0.22) * 0.025, -1.367 + Math.cos(0.22) * 0.025] as const
      if (detail === 'street') assert.ok(pointToMeshDistance(rearGlassPoint, body) < 1e-5, 'street actual static rear-glass triangles contact the witness')
      const rearGlass = analyzeSedanAperture(input([capsule('rear-window-glass', ...rearGlassPoint, 0.001)]))
      assert.ok(rearGlass.shellIntersections.includes('rear-window-glass:rear-glass-static'))
    } finally {
      model.userData.dispose()
    }
  }
})

test('retained side glass, pillar, shoulder trim, and rear glass stay covered after partition', () => {
  const cases = [
    { id: 'front-glass-remainder', point: [-0.966, 1.45, 0.96] as const, match: ':driver-front-glass:retained-z-high' },
    { id: 'rear-glass-remainder', point: [-0.966, 1.2, -1.214] as const, match: ':driver-rear-glass' },
    { id: 'b-pillar-remainder', point: [-0.975, 1.49, -0.16] as const, match: ':driver-b-pillar' },
    { id: 'shoulder-trim-remainder', point: [-1.0, 0.94, -1.5] as const, match: ':driver-shoulder-trim:retained-z-low' },
    { id: 'rear-window-static', point: [0, 1.2, -1.367] as const, match: ':rear-glass-static' },
    { id: 'roof-shoulder-trim', point: [0, 1.555, -0.18] as const, match: ':roof-shoulder-trim' },
    { id: 'passenger-front-glass', point: [0.986, 1.2, 0.4] as const, match: ':passenger-front-glass' },
    { id: 'passenger-rear-glass', point: [0.966, 1.2, -1.214] as const, match: ':passenger-rear-glass' },
    { id: 'passenger-b-pillar', point: [0.975, 1.2, -0.16] as const, match: ':passenger-b-pillar' },
    { id: 'passenger-shoulder-trim', point: [1.0, 0.94, -1.5] as const, match: ':passenger-shoulder-trim' },
    { id: 'passenger-pillar-trim', point: [1.002, 0.88, -0.18] as const, match: ':passenger-pillar-trim' },
    { id: 'passenger-door-handle-trim', point: [1.008, 0.91, 0.04] as const, match: ':passenger-door-handle-trim' },
  ]
  for (const fixture of cases) {
    const result = analyzeSedanAperture(input([capsule(fixture.id, ...fixture.point)]))
    assert.ok(result.shellIntersections.some(value => value.endsWith(fixture.match)), fixture.id)
  }
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
  const enterWalk = source.slice(source.indexOf("} else if (phase === 'enter-walk')"), source.indexOf("} else if (phase === 'enter-seat')"))
  assert.match(enterWalk, /reduceMotion \? 0\.24 : 0\.62/)
  const enterSeat = source.slice(source.indexOf("} else if (phase === 'enter-seat')"), source.indexOf("} else if (phase === 'exit-door')"))
  assert.match(enterSeat, /reduceMotion \? 0\.18 : 0\.38/)
  assert.match(enterSeat, /reduceMotion \? 0\.1 : 0\.22/)
  assert.match(enterSeat, /moveActor\(seated, heading, 'sit'/)
  assert.match(enterSeat, /1 - Math\.max\(0, phaseTime - seatMoveDuration\) \/ doorCloseDuration/)
  const exitSlide = source.slice(source.indexOf("} else if (phase === 'exit-slide')"), source.indexOf("} else if (phase === 'exit-seat')"))
  assert.match(exitSlide, /bodySeat\.[xz].*exitSeat\.[xz]/s)
  assert.match(exitSlide, /reduceMotion \? 0\.22 : 0\.5/)
  assert.match(exitSlide, /moveActor\(seated, current\.heading, 'sit'/)
  assert.match(exitSlide, /setActorPose\('stand'/)
  const exitSeat = source.slice(source.indexOf("} else if (phase === 'exit-seat')"), source.indexOf("} else if (phase === 'exit-walk')"))
  assert.match(exitSeat, /reduceMotion \? 0\.22 : 0\.35/)
  const model = buildVehicle('sedan', { detail: 'street' })
  try {
    const root = model.object3D
    root.position.set(0, 0, 0); root.rotation.y = 0; root.updateWorldMatrix(true, true)
    const doorAnchor = model.userData.anchors.door
    const closedDoorLocal = root.worldToLocal(doorAnchor.getWorldPosition(new THREE.Vector3()))
    const driver = model.userData.anchors.driver.getWorldPosition(new THREE.Vector3())
    const door = root.localToWorld(closedDoorLocal.clone())
    const outward = new THREE.Vector3(-1, 0, 0).transformDirection(root.matrixWorld)
    const approach = door.clone().addScaledVector(outward, 1.5); approach.y = 0
    const threshold = door.clone().addScaledVector(outward, 0.2); threshold.y = 0
    const bodySeat = new THREE.Vector3(driver.x, driver.y - 0.6 * (1.75 / 2.45), driver.z)
    const thresholdSeat = new THREE.Vector3(threshold.x, bodySeat.y, threshold.z)
    const exitSeat = door.clone().addScaledVector(outward, 0.6); exitSeat.y = bodySeat.y
    const exitGround = new THREE.Vector3(exitSeat.x, 0, exitSeat.z)
    const track = [
      { phase: 'enter-walk' as const, start: approach, end: threshold, door: [Math.PI * 0.55, Math.PI * 0.55] as const },
      { phase: 'enter-seat' as const, start: thresholdSeat, end: bodySeat, door: [0, Math.PI * 0.55] as const },
      { phase: 'exit-slide' as const, start: bodySeat, end: exitSeat, door: [Math.PI * 0.55, Math.PI * 0.55] as const },
      { phase: 'exit-seat' as const, start: exitSeat, end: exitGround, door: [Math.PI * 0.55, Math.PI * 0.55] as const },
    ]
    for (const mode of ['normal', 'reduced'] as const) for (const [index, item] of track.entries()) {
      const phaseCapsule: SedanCapsule = {
        id: `${mode}-${item.phase}`, start: [item.start.x, item.start.y, item.start.z], end: [item.end.x, item.end.y, item.end.z],
        radius: 0.02, phase: item.phase, provenance: `drivingScene-${mode}-anchor-centerline-unverified`,
      }
      const result = analyzeSedanAperture(input([phaseCapsule], { doorAngleInterval: item.door }))
      assert.equal(result.code, 'ok', `${mode}/${item.phase}/${index}`)
      assert.deepEqual([result.canBoard, result.authoritativeClearance, result.routeAuthorized], [false, false, false])
    }
  } finally { model.userData.dispose() }
})

test('the authority contract stays negative even for empty or apparently clear proposals', () => {
  const result = analyzeSedanAperture(input([capsule('outside', -2.8, 1, 0.4)]))
  assert.equal(result.code, 'ok')
  assert.equal(result.candidateGeometry, 'clear-for-supplied-capsules')
  assert.deepEqual([result.canBoard, result.authoritativeClearance, result.routeAuthorized], [false, false, false])
  assert.deepEqual(result.missingProof, ['complete_clothed_actor_pose', 'terrain_and_support', 'continuous_entry_motion', 'full_scene_collision', 'route_and_yield_authority'])
})
