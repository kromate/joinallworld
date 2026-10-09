import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import test from 'node:test'
import { buildVehicle, poseVehicle } from '../../models/vehicles/index.ts'
import { attachSedanInterior } from '../../models/vehicles/sedan-interior.ts'
import { readSedanBoardingDescriptor, SEDAN_BOARDING_DESCRIPTOR, vehicleLocalToWorld } from './vehicle-boarding.ts'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)

test('descriptor pins every source used for its sedan geometry and scene root-motion facts', async () => {
  for (const [path, expected] of Object.entries(SEDAN_BOARDING_DESCRIPTOR.source.sha256)) {
    const bytes = await readFile(resolve(repo, path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path)
  }
  assert.equal(SEDAN_BOARDING_DESCRIPTOR.source.revision, 'sedan-interior-content-pins-v2')
  assert.equal(SEDAN_BOARDING_DESCRIPTOR.source.baselineRevision, '75ad421adc6d1eb455c9f7a258bc63e315ce5955')
})

test('active street sedan interior, anchors and open-door hinge agree with the pinned driver-frame descriptor', () => {
  const car = buildVehicle('sedan', { detail: SEDAN_BOARDING_DESCRIPTOR.sedan.detail })
  try {
    const interior = attachSedanInterior(car)
    assert.equal(interior.group.parent, car.userData.parts.body)
    assert.equal(car.userData.triangles, SEDAN_BOARDING_DESCRIPTOR.sedan.geometryBudget.triangles)
    assert.equal(car.userData.drawCalls, SEDAN_BOARDING_DESCRIPTOR.sedan.geometryBudget.drawCalls)
    assert.equal(interior.solids.length, 9)
    assert.equal(interior.supportSurfaces.length, 5)
    car.object3D.updateWorldMatrix(true, true)
    const driver = car.userData.anchors.driver.position
    near(driver.x, SEDAN_BOARDING_DESCRIPTOR.sedan.driverAnchor.x)
    near(driver.y, SEDAN_BOARDING_DESCRIPTOR.sedan.driverAnchor.y)
    near(driver.z, SEDAN_BOARDING_DESCRIPTOR.sedan.driverAnchor.z)

    const doorAnchor = car.userData.anchors.door.getWorldPosition(new THREE.Vector3())
    near(doorAnchor.x, -0.96); near(doorAnchor.y, 0.6132); near(doorAnchor.z, 0.42)
    const hinge = car.object3D.getObjectByName('door-root')
    assert.ok(hinge)
    near(hinge.position.x, SEDAN_BOARDING_DESCRIPTOR.sedan.driverDoor.hingeLocal.x)
    near(hinge.position.y, SEDAN_BOARDING_DESCRIPTOR.sedan.driverDoor.hingeLocal.y)
    near(hinge.position.z, SEDAN_BOARDING_DESCRIPTOR.sedan.driverDoor.hingeLocal.z)
    poseVehicle(car, { door: 1 })
    near(hinge.rotation.y, SEDAN_BOARDING_DESCRIPTOR.sedan.driverDoor.openAngleRadians)
  } finally { car.userData.dispose() }
})

test('local vehicle points use the same +Z-forward transform as the scene, and authority stays disabled', () => {
  assert.deepEqual(vehicleLocalToWorld({ x: -1, z: 0 }, { x: 10, z: 20 }, 0), { x: 9, z: 20 })
  const turned = vehicleLocalToWorld({ x: -1, z: 0 }, { x: 10, z: 20 }, Math.PI / 2)
  assert.ok(turned)
  near(turned.x, 10); near(turned.z, 21)
  assert.equal(SEDAN_BOARDING_DESCRIPTOR.authority.canBoard, false)
  assert.equal(SEDAN_BOARDING_DESCRIPTOR.authority.routeAuthorized, false)
  assert.equal(SEDAN_BOARDING_DESCRIPTOR.sedan.cabin.clearDoorway, 'unknown')
  assert.equal(SEDAN_BOARDING_DESCRIPTOR.actor.actorVolume, 'unverified')
})

test('descriptor reader accepts only the exact pinned contract', () => {
  assert.equal(readSedanBoardingDescriptor(SEDAN_BOARDING_DESCRIPTOR), SEDAN_BOARDING_DESCRIPTOR)
  assert.equal(readSedanBoardingDescriptor(null), null)
  assert.equal(readSedanBoardingDescriptor({ ...SEDAN_BOARDING_DESCRIPTOR, schemaVersion: 2 }), null)
  const forged = structuredClone(SEDAN_BOARDING_DESCRIPTOR) as { authority: { canBoard: boolean } }
  forged.authority.canBoard = true
  assert.equal(readSedanBoardingDescriptor(forged), null)
})

test('descriptor rejects hidden extensions, prototypes and getters without invoking them', () => {
  assert.equal(readSedanBoardingDescriptor(structuredClone(SEDAN_BOARDING_DESCRIPTOR)), SEDAN_BOARDING_DESCRIPTOR)
  for (const key of ['hidden', Symbol('hidden')]) {
    const extended = structuredClone(SEDAN_BOARDING_DESCRIPTOR)
    Object.defineProperty(extended, key, { value: true })
    assert.equal(readSedanBoardingDescriptor(extended), null)
  }
  const inherited = Object.assign(Object.create({ externalAuthority: true }), SEDAN_BOARDING_DESCRIPTOR)
  assert.equal(readSedanBoardingDescriptor(inherited), null)
  let calls = 0
  const accessor = { ...SEDAN_BOARDING_DESCRIPTOR }
  Object.defineProperty(accessor, 'authority', { enumerable: true, get: () => { calls++; return SEDAN_BOARDING_DESCRIPTOR.authority } })
  assert.equal(readSedanBoardingDescriptor(accessor), null)
  assert.equal(calls, 0)
})

test('vehicle transform refuses non-finite inputs and finite arithmetic overflow', () => {
  assert.equal(vehicleLocalToWorld({ x: NaN, z: 0 }, { x: 0, z: 0 }, 0), null)
  assert.equal(vehicleLocalToWorld({ x: 1, z: 0 }, { x: 0, z: 0 }, Infinity), null)
  assert.equal(vehicleLocalToWorld({ x: Number.MAX_VALUE, z: 0 }, { x: Number.MAX_VALUE, z: 0 }, 0), null)
})
