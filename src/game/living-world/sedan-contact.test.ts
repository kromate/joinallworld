import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildVehicle, poseVehicle } from '../../models/vehicles/index.ts'
import { createSedanContactDiagnostic, SEDAN_CONTACT_LIMITS } from './sedan-contact.ts'

function triangleTotal(batches: readonly { triangles: readonly unknown[] }[]): number {
  return batches.reduce((total, batch) => total + batch.triangles.length, 0)
}

function assertPointNear(actual: readonly number[], expected: readonly number[]): void {
  assert.equal(actual.length, expected.length)
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) <= 1e-9))
}

test('contact diagnostic exports bounded map-sedan meshes in vehicle-local metres without interior claims', () => {
  const result = createSedanContactDiagnostic()
  assert.equal(result.model, 'sedan')
  assert.equal(result.detail, 'map')
  assert.equal(result.headingRadians, 0)
  assert.equal(result.frame, 'vehicle-local-metres')
  assert.ok(result.staticRenderedMeshes.length > 0)
  assert.ok(triangleTotal(result.staticRenderedMeshes) > 0)
  assert.ok(triangleTotal(result.closedDoorMeshes) > 0)
  assert.deepEqual(result.doorPoseSamples.map(sample => sample.doorFraction), [0.25, 0.5, 0.75, 1])
  assert.ok(result.doorPoseSamples.every(sample => triangleTotal(sample.batches) > 0))
  const closed = result.closedDoorMeshes.flatMap(batch => batch.triangles.flatMap(triangle => [...triangle.a, ...triangle.b, ...triangle.c]))
  for (const sample of result.doorPoseSamples) {
    const posed = sample.batches.flatMap(batch => batch.triangles.flatMap(triangle => [...triangle.a, ...triangle.b, ...triangle.c]))
    assert.equal(posed.length, closed.length, 'hinging preserves triangle topology')
    assert.ok(posed.some((coordinate, index) => Math.abs(coordinate - closed[index]!) > 1e-6), 'each sampled hinge pose changes actual door coordinates')
  }
  assertPointNear(result.anchors.driver, [-0.437, 0.74, 0.42])
  assertPointNear(result.anchors.door, [-0.96, 0.6132, 0.42])
  assert.equal(result.anchors.seats.length, 3)
  assert.equal(result.anchors.seatGeometry, 'anchor-only')
  assert.equal(result.interior.floor, 'not-authored')
  assert.equal(result.interior.doorwayGeometry, 'side-cutout-only-no-traversal-volume')
  assert.equal(result.interior.traversableDoorway, 'unknown')
  assert.equal(result.interior.continuousDoorSweep, 'not-certified-by-finite-samples')
  assert.equal(result.canBoard, false)
  assert.equal(result.routeAuthorized, false)
  assert.equal(result.triangleCount, triangleTotal(result.staticRenderedMeshes)
    + triangleTotal(result.closedDoorMeshes)
    + result.doorPoseSamples.reduce((count, sample) => count + triangleTotal(sample.batches), 0))
  assert.ok(result.triangleCount <= SEDAN_CONTACT_LIMITS.maxTriangles)
  for (const batch of [...result.staticRenderedMeshes, ...result.closedDoorMeshes,
    ...result.doorPoseSamples.flatMap(sample => sample.batches)]) {
    for (const triangle of batch.triangles) {
      for (const point of [triangle.a, triangle.b, triangle.c]) {
        assert.equal(point.length, 3)
        assert.ok(point.every(Number.isFinite))
      }
    }
  }
})

test('actual generated sedan door opens the pinned driver approach ray but does not certify cabin traversal', () => {
  const model = buildVehicle('sedan', { detail: 'map' })
  try {
    const ray = new THREE.Raycaster()
    const { driver } = model.userData.anchors
    const pivot = model.userData.parts.doors[0]
    assert.ok(pivot)
    const y = 1.06
    const origin = new THREE.Vector3(pivot.position.x - 0.3, y, driver.position.z)
    const stop = new THREE.Vector3(driver.position.x - 0.06, y, driver.position.z)
    const check = (door: number) => {
      poseVehicle(model, { door })
      model.object3D.updateMatrixWorld(true)
      const startWorld = model.object3D.localToWorld(origin.clone())
      const stopWorld = model.object3D.localToWorld(stop.clone())
      const delta = stopWorld.sub(startWorld)
      ray.set(startWorld, delta.clone().normalize())
      ray.near = 0
      ray.far = delta.length()
      return ray.intersectObject(model.object3D, true)
    }
    assert.ok(check(0).length > 0, 'closed rendered door blocks the sampled exterior approach')
    assert.equal(check(1).length, 0, 'open rendered door clears that sampled ray')
    assert.equal(model.userData.anchors.seats.length, 3, 'the model exposes seat anchors only')
    assert.equal('canBoard' in model.userData, false, 'vehicle model has no boarding authorization field')
  } finally {
    model.userData.dispose()
  }
})

test('contact diagnostics reject invalid budgets before producing oversized snapshots', () => {
  assert.throws(() => createSedanContactDiagnostic(0), RangeError)
  assert.throws(() => createSedanContactDiagnostic(SEDAN_CONTACT_LIMITS.maxTriangles + 1), RangeError)
  assert.throws(() => createSedanContactDiagnostic(1), /triangle limit exceeded/)
})
