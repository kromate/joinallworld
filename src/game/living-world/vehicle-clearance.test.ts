import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { buildVehicle, poseVehicle } from '../../models/vehicles/index.ts'
import { attachSedanInterior } from '../../models/vehicles/sedan-interior.ts'
import { SEDAN_BOARDING_DESCRIPTOR } from './vehicle-boarding.ts'
import {
  inspectSedanRoadFootprint,
  SEDAN_CLEARANCE_SOURCE,
  type ClearanceInput,
} from './vehicle-clearance.ts'

const provenance = {
  sourceSha: SEDAN_CLEARANCE_SOURCE.sourceSha,
  model: SEDAN_CLEARANCE_SOURCE.model,
  detail: SEDAN_CLEARANCE_SOURCE.detail,
  sourceHashes: { ...SEDAN_CLEARANCE_SOURCE.sourceHashes },
}
const road = { start: { x: 0, z: -50 }, end: { x: 0, z: 50 }, width: 8, edgeMargin: 0.4 }
const input: ClearanceInput = {
  provenance,
  road,
  vehicle: { center: { x: -2, z: 0 }, headingRadians: 0 },
  atMs: 1_000,
}

test('clearance evidence remains tied to the actual model and boarding source', async () => {
  for (const [path, expected] of Object.entries(SEDAN_CLEARANCE_SOURCE.sourceHashes)) {
    const source = await readFile(new URL(`../../../${path}`, import.meta.url))
    assert.equal(createHash('sha256').update(source).digest('hex'), expected,
      `${path} changed: recompute geometry evidence before accepting these bounds`)
  }
})

test('Marina left-lane pose fits the closed sedan only; door and boarding scope fail closed', () => {
  const result = inspectSedanRoadFootprint(input)
  assert.equal(result.code, 'ok')
  assert.equal(result.routeAuthorized, false)
  assert.equal(result.scopes.closedVehicleOnRoad?.fits, true)
  assert.equal(result.scopes.fullDoorSweepOnRoad?.fits, false, 'analytic hinge-centered door disk exceeds the required edge margin')
  assert.equal(result.scopes.boardingCenterlineOnRoad?.fits, false, 'approach center at local x=-2.46 is outside the road edge')
  assert.equal(result.scopes.actorVolume, 'unverified')
  assert.deepEqual(result.missingProof, ['actor_volume', 'terrain', 'depot_apron', 'buildings_and_access', 'yielding', 'crossings', 'continuous_motion'])
  assert.equal(Object.isFrozen(result.missingProof), true, 'callers cannot mutate the shared fail-closed proof list')
  assert.ok(result.geometry!.vehicleHalfWidth >= 1.302, 'steered/spinning wheels are enclosed by a conservative sphere')
  assert.ok(result.geometry!.vehicleHalfLength >= 2.246, 'full body overhang is included')
  assert.ok(result.geometry!.doorSweepRadius >= Math.hypot(0.11, 0.94), 'door sweep radius comes from the full authored clipping box')
})

test('the active street sedan uses its own measured envelope and cannot reuse map-detail provenance', () => {
  const car = buildVehicle('sedan', { detail: 'street' })
  try {
    attachSedanInterior(car)
    const geometry = inspectSedanRoadFootprint(input).geometry
    assert.ok(geometry)
    const activeEnvelope = SEDAN_BOARDING_DESCRIPTOR.sedan.conservativeStaticEnvelope
    let exceedsMapLength = false
    for (const steering of [-0.65, 0, 0.65]) {
      for (let spoke = 0; spoke < 8; spoke++) {
        poseVehicle(car, { door: 0, steering, distance: 2 * Math.PI * 0.37 * spoke / 8 })
        car.object3D.updateMatrixWorld(true)
        // Rotated local AABB corners overstate wheel-cylinder extents; inspect actual mesh vertices.
        const box = new THREE.Box3()
        const point = new THREE.Vector3(), instance = new THREE.Matrix4(), transform = new THREE.Matrix4()
        const inverseRoot = car.object3D.matrixWorld.clone().invert()
        car.object3D.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return
          const positions = object.geometry.getAttribute('position')
          const instances = object instanceof THREE.InstancedMesh ? object.count : 1
          for (let index = 0; index < instances; index++) {
            transform.copy(inverseRoot).multiply(object.matrixWorld)
            if (object instanceof THREE.InstancedMesh) { object.getMatrixAt(index, instance); transform.multiply(instance) }
            for (let vertex = 0; vertex < positions.count; vertex++) {
              point.fromBufferAttribute(positions, vertex).applyMatrix4(transform)
              box.expandByPoint(point)
            }
          }
        })
        const halfWidth = Math.max(Math.abs(box.min.x), Math.abs(box.max.x))
        const halfLength = Math.max(Math.abs(box.min.z), Math.abs(box.max.z))
        assert.ok(halfWidth <= activeEnvelope.halfWidth)
        assert.ok(halfLength <= activeEnvelope.halfLength)
        exceedsMapLength ||= halfLength > geometry.vehicleHalfLength
      }
    }
    assert.equal(exceedsMapLength, true, 'street trim has an actual overhang beyond the map-detail bound')
    assert.equal(inspectSedanRoadFootprint({ ...input, provenance: { ...provenance, detail: 'street' } }).code, 'unsupported_provenance')
    assert.equal(inspectSedanRoadFootprint(input).routeAuthorized, false,
      'finite visual envelope witnesses do not establish continuous movement or actor clearance')
  } finally { car.userData.dispose() }
})

test('closed-footprint edge equality is accepted only at the declared margin', () => {
  const halfWidth = inspectSedanRoadFootprint(input).geometry!.vehicleHalfWidth
  const boundaryCenterX = -road.width / 2 + road.edgeMargin + halfWidth + 0.000001
  const onBoundary = inspectSedanRoadFootprint({ ...input, vehicle: { center: { x: boundaryCenterX, z: 0 }, headingRadians: 0 } })
  const beyondBoundary = inspectSedanRoadFootprint({ ...input, vehicle: { center: { x: boundaryCenterX - 0.001, z: 0 }, headingRadians: 0 } })
  assert.equal(onBoundary.scopes.closedVehicleOnRoad?.fits, true)
  assert.equal(beyondBoundary.scopes.closedVehicleOnRoad?.fits, false)
})

test('rotated straight road uses its own tangent and normal frame', () => {
  const rootHalf = Math.SQRT1_2
  const along = { x: 50 * rootHalf, z: 50 * rootHalf }
  const center = { x: along.x - 2 * rootHalf, z: along.z + 2 * rootHalf }
  const result = inspectSedanRoadFootprint({
    ...input,
    road: { start: { x: 0, z: 0 }, end: { x: 100 * rootHalf, z: 100 * rootHalf }, width: 8, edgeMargin: 0.4 },
    vehicle: { center, headingRadians: Math.PI / 4 },
  })
  assert.equal(result.scopes.closedVehicleOnRoad?.fits, true)
  assert.equal(result.routeAuthorized, false, 'rotated static footprint is not a route certificate')
})

test('full oriented body can leave a road while its center remains within the edge margin', () => {
  const result = inspectSedanRoadFootprint({
    ...input,
    vehicle: { center: { x: -1.2, z: 0 }, headingRadians: Math.PI / 4 },
  })
  assert.ok(Math.abs(result.scopes.closedVehicleOnRoad!.across.min) > 0, 'the full footprint has a measured edge')
  assert.ok(-1.2 > -road.width / 2 + road.edgeMargin, 'center-only check would pass')
  assert.equal(result.scopes.closedVehicleOnRoad?.fits, false)
})

test('source stamp, timestamp, and geometry inputs are strict and fail closed', () => {
  const badSource = { ...provenance, sourceHashes: { ...provenance.sourceHashes, 'src/models/vehicles/index.ts': 'stale' } }
  assert.equal(inspectSedanRoadFootprint({ ...input, provenance: badSource }).code, 'unsupported_provenance')
  assert.equal(inspectSedanRoadFootprint({ ...input, provenance: { ...provenance, detail: 'street' } }).code, 'unsupported_provenance')
  assert.equal(inspectSedanRoadFootprint({ ...input, atMs: Number.NaN }).code, 'invalid_time')
  assert.equal(inspectSedanRoadFootprint({ ...input, atMs: -1 }).code, 'invalid_time')
  assert.equal(inspectSedanRoadFootprint({ ...input, road: { ...road, width: 0 } }).code, 'invalid_geometry')
  assert.equal(inspectSedanRoadFootprint({ ...input, vehicle: { center: { x: 100_001, z: 0 }, headingRadians: 0 } }).code, 'invalid_geometry')
  const futurePose = { ...input, futureMotion: 'unverified' }
  assert.equal(inspectSedanRoadFootprint(futurePose).code, 'invalid_geometry', 'future pose fields cannot silently change the inspected meaning')
})

test('no player capsule is guessed or accepted as trusted clearance evidence', () => {
  const malformed = inspectSedanRoadFootprint({ ...input, actorCapsule: { radius: Number.POSITIVE_INFINITY } })
  assert.equal(malformed.code, 'invalid_actor_capsule')
  assert.equal(malformed.routeAuthorized, false)

  const unverified = inspectSedanRoadFootprint({
    ...input,
    actorCapsule: { radius: 0.3, halfHeight: 0.8, evidenceRef: 'client-estimate' },
  })
  assert.equal(unverified.code, 'ok')
  assert.equal(unverified.scopes.actorVolume, 'unverified', 'synthetic dimensions remain diagnostic, never trusted')
  assert.equal(unverified.routeAuthorized, false)
  assert.ok(unverified.missingProof.includes('actor_volume'))
})

test('invalid and incomplete claims never produce route authorization', () => {
  const missingProvenance = inspectSedanRoadFootprint({ ...input, provenance: null })
  const missingRoad = inspectSedanRoadFootprint({ ...input, road: null as unknown as ClearanceInput['road'] })
  assert.equal(missingProvenance.routeAuthorized, false)
  assert.equal(missingRoad.code, 'invalid_geometry')
  assert.equal(missingRoad.routeAuthorized, false)
})
