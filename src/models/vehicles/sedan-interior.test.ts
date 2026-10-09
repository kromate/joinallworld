import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildVehicle, poseVehicle } from './index.ts'
import { attachSedanInterior, createSedanInterior, SEDAN_INTERIOR_LAYOUT } from './sedan-interior.ts'

function localAnchor(model: ReturnType<typeof buildVehicle>, anchor: THREE.Object3D): readonly number[] {
  model.object3D.updateMatrixWorld(true)
  const point = model.userData.parts.body.worldToLocal(anchor.getWorldPosition(new THREE.Vector3()))
  return [point.x, point.y, point.z]
}

function near(actual: number, expected: number, epsilon = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} differs from ${expected}`)
}

function vertices(attribute: THREE.BufferAttribute, start: number, count: number): number[] {
  const result: number[] = []
  for (let i = start; i < start + count; i += 1) result.push(attribute.getX(i), attribute.getY(i), attribute.getZ(i))
  return result
}

test('map sedan interior builds bounded floor and four anchor-derived seats as one render batch', () => {
  const model = buildVehicle('sedan', { detail: 'map' })
  try {
    const anchors = [model.userData.anchors.driver, ...model.userData.anchors.seats]
    const beforeAnchors = anchors.map(anchor => localAnchor(model, anchor))
    const actualBodyBounds = new THREE.Box3().setFromObject(model.userData.parts.body)
    const interior = createSedanInterior(model)
    try {
      assert.equal(SEDAN_INTERIOR_LAYOUT.frame, 'vehicle-body-local')
      assert.equal(SEDAN_INTERIOR_LAYOUT.units, 'vehicle-world-units')
      assert.equal(SEDAN_INTERIOR_LAYOUT.forward, '+Z')
      assert.equal(interior.triangleCount, 284)
      assert.equal(interior.geometry.getAttribute('position').count / 3, interior.triangleCount)
      assert.equal(interior.group.children.length, 1)
      assert.equal(interior.group.children[0]?.name, 'sedan-interior-solids')
      assert.equal(interior.solids.length, 11)
      assert.equal(interior.supportSurfaces.length, 5)
      assert.equal(interior.supportSurfaces[0]?.surfaceY, 0.52)
      assert.equal(interior.supportSurfaces[0]?.id, 'cabin-floor-support')
      assert.equal(interior.supportSurfaces.filter(surface => surface.kind === 'seat-cushion').length, 4)
      assert.equal(SEDAN_INTERIOR_LAYOUT.canBoard, false)
      assert.equal(SEDAN_INTERIOR_LAYOUT.actorVolume, 'unverified')
      assert.equal(SEDAN_INTERIOR_LAYOUT.traversableAperture, 'unknown')
      assert.deepEqual(anchors.map(anchor => localAnchor(model, anchor)), beforeAnchors,
        'creating an interior must not rewrite the published driver or passenger anchors')

      const positions = interior.geometry.getAttribute('position')
      const normals = interior.geometry.getAttribute('normal')
      const steering = interior.solids.find(solid => solid.id === 'steering-wheel')
      const dashboard = interior.solids.find(solid => solid.id === 'dashboard')
      assert.ok(steering && dashboard)
      const centeredWheel = vertices(positions, steering.vertexStart, steering.vertexCount)
      const centeredWheelNormals = vertices(normals, steering.vertexStart, steering.vertexCount)
      let topVertex = steering.vertexStart
      for (let i = topVertex + 1; i < steering.vertexStart + steering.vertexCount; i += 1) {
        if (positions.getY(i) > positions.getY(topVertex)) topVertex = i
      }
      const neutralTopX = positions.getX(topVertex)
      const stationary = new Map<number, number[]>()
      for (let start = 0; start < steering.vertexStart; start += 1) stationary.set(start, vertices(positions, start, 1))
      for (let start = steering.vertexStart + steering.vertexCount; start < positions.count; start += 1) stationary.set(start, vertices(positions, start, 1))
      interior.poseSteering(1)
      const turnedWheel = vertices(positions, steering.vertexStart, steering.vertexCount)
      assert.ok(positions.getX(topVertex) > neutralTopX, 'right input turns the top of the wheel toward the driver’s right')
      const turnedWheelNormals = vertices(normals, steering.vertexStart, steering.vertexCount)
      assert.notDeepEqual(turnedWheel, centeredWheel, 'steering rotates the actual wheel vertices')
      assert.notDeepEqual(turnedWheelNormals, centeredWheelNormals, 'steering rotates wheel normals with the vertices')
      for (const [vertex, expected] of stationary) assert.deepEqual(vertices(positions, vertex, 1), expected,
        'floor, seats, and dashboard remain stationary')
      interior.poseSteering(50)
      assert.deepEqual(vertices(positions, steering.vertexStart, steering.vertexCount), turnedWheel, 'input is clamped')
      interior.poseSteering(Number.NaN)
      assert.deepEqual(vertices(positions, steering.vertexStart, steering.vertexCount), centeredWheel, 'invalid input centers the wheel')
      assert.deepEqual(vertices(normals, steering.vertexStart, steering.vertexCount), centeredWheelNormals)
      interior.poseSteering(-1)
      assert.ok(positions.getX(topVertex) < neutralTopX, 'left input turns the top of the wheel toward the driver’s left')
      const sphere = interior.geometry.boundingSphere
      assert.ok(sphere)
      for (const input of [-1, -0.5, 0, 0.5, 1]) {
        interior.poseSteering(input)
        for (let i = 0; i < positions.count; i += 1) {
          assert.ok(Math.hypot(positions.getX(i) - sphere.center.x, positions.getY(i) - sphere.center.y, positions.getZ(i) - sphere.center.z) <= sphere.radius + 1e-6, 'animated vertices stay inside the culling sphere')
        }
      }
      interior.poseSteering(-1)
      assert.notDeepEqual(vertices(positions, steering.vertexStart, steering.vertexCount), centeredWheel)
      interior.poseSteering(0)
      assert.deepEqual(vertices(positions, steering.vertexStart, steering.vertexCount), centeredWheel, 'neutral restores exact authored vertices')
      assert.deepEqual(vertices(normals, steering.vertexStart, steering.vertexCount), centeredWheelNormals)
      const envelope = SEDAN_INTERIOR_LAYOUT.shell
      for (const solid of interior.solids) {
        const { min, max } = solid.bounds
        assert.ok(min.x >= envelope.minX && max.x <= envelope.maxX)
        assert.ok(min.y >= envelope.minY && max.y <= envelope.maxY)
        assert.ok(min.z >= envelope.minZ && max.z <= envelope.maxZ)
        assert.ok(min.x >= actualBodyBounds.min.x && max.x <= actualBodyBounds.max.x)
        assert.ok(min.y >= actualBodyBounds.min.y && max.y <= actualBodyBounds.max.y)
        assert.ok(min.z >= actualBodyBounds.min.z && max.z <= actualBodyBounds.max.z)
        const observed = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }
        for (let i = solid.vertexStart; i < solid.vertexStart + solid.vertexCount; i += 1) {
          const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i)
          observed.minX = Math.min(observed.minX, x); observed.minY = Math.min(observed.minY, y); observed.minZ = Math.min(observed.minZ, z)
          observed.maxX = Math.max(observed.maxX, x); observed.maxY = Math.max(observed.maxY, y); observed.maxZ = Math.max(observed.maxZ, z)
        }
        near(observed.minX, min.x); near(observed.minY, min.y); near(observed.minZ, min.z)
        near(observed.maxX, max.x); near(observed.maxY, max.y); near(observed.maxZ, max.z)
      }
      for (const support of interior.supportSurfaces) {
        const solid = interior.solids.find(item => item.id === support.solidId)
        assert.ok(solid, `${support.id} refers to an authored solid`)
        near(support.surfaceY, solid.bounds.max.y)
        assert.equal(support.polygonXZ.length, 4)
        for (const [x, z] of support.polygonXZ) {
          assert.ok(x >= solid.bounds.min.x - 1e-6 && x <= solid.bounds.max.x + 1e-6)
          assert.ok(z >= solid.bounds.min.z - 1e-6 && z <= solid.bounds.max.z + 1e-6)
          assert.ok(Array.from({ length: solid.vertexCount }, (_, offset) => solid.vertexStart + offset).some(index =>
            Math.abs(positions.getX(index) - x) <= 1e-6
            && Math.abs(positions.getY(index) - support.surfaceY) <= 1e-6
            && Math.abs(positions.getZ(index) - z) <= 1e-6), `${support.id} corner is an actual top-surface vertex`)
        }
      }

      let geometryDisposals = 0, materialDisposals = 0
      interior.geometry.addEventListener('dispose', () => geometryDisposals += 1)
      interior.material.addEventListener('dispose', () => materialDisposals += 1)
      interior.dispose()
      interior.dispose()
      assert.equal(geometryDisposals, 1)
      assert.equal(materialDisposals, 1)
    } finally { interior.dispose() }
  } finally { model.userData.dispose() }
})

test('interior refuses incompatible model and anchors outside its authored envelope', () => {
  const wrongModel = buildVehicle('hatchback', { detail: 'map' })
  try { assert.throws(() => createSedanInterior(wrongModel), /map- or street-detail sedan model/) }
  finally { wrongModel.userData.dispose() }

  const wrongDetail = buildVehicle('sedan', { detail: 'showcase' })
  try { assert.throws(() => createSedanInterior(wrongDetail), /map- or street-detail sedan model/) }
  finally { wrongDetail.userData.dispose() }

  const malformedAnchor = buildVehicle('sedan', { detail: 'map' })
  try {
    malformedAnchor.userData.anchors.driver.position.x = 5
    assert.throws(() => createSedanInterior(malformedAnchor), /anchor layout is outside the authored interior envelope/)
  } finally { malformedAnchor.userData.dispose() }
})

test('only the street sedan attaches once within existing budgets and follows its animated body', () => {
  const mapModel = buildVehicle('sedan', { detail: 'map' })
  try {
    const mapBody = mapModel.userData.parts.body
    const beforeMap = { triangles: mapModel.userData.triangles, drawCalls: mapModel.userData.drawCalls }
    const mapChildren = mapBody.children.slice()
    assert.deepEqual(beforeMap, { triangles: 224, drawCalls: 7 })
    assert.throws(() => attachSedanInterior(mapModel), /map vehicle geometry budget/)
    assert.deepEqual([mapModel.userData.triangles, mapModel.userData.drawCalls], [beforeMap.triangles, beforeMap.drawCalls])
    assert.deepEqual(mapBody.children, mapChildren, 'map budget refusal occurs before attachment')
  } finally { mapModel.userData.dispose() }

  const model = buildVehicle('sedan', { detail: 'street' })
  try {
    model.object3D.position.set(7, 0.3, -4)
    model.object3D.rotation.y = 1.1
    model.object3D.scale.setScalar(0.8)
    poseVehicle(model, { bounce: 0.18, time: 1.4 })
    model.object3D.updateMatrixWorld(true)
    let originalDisposeCalls = 0
    const builtDispose = model.userData.dispose
    model.userData.dispose = () => { originalDisposeCalls += 1; builtDispose() }
    const priorTriangles = model.userData.triangles
    const priorDrawCalls = model.userData.drawCalls
    const staleAlias = { object3D: model.object3D, userData: { ...model.userData } }
    const interior = attachSedanInterior(model)
    assert.equal(interior.group.parent, model.userData.parts.body)
    assert.equal(model.userData.triangles, priorTriangles + SEDAN_INTERIOR_LAYOUT.triangles)
    assert.equal(model.userData.drawCalls, priorDrawCalls + 1)
    assert.deepEqual([model.userData.triangles, model.userData.drawCalls], [990, 8])
    assert.equal(attachSedanInterior(model), interior, 'repeat attachment returns the same resource without recounting')
    assert.equal(attachSedanInterior({ object3D: model.object3D, userData: model.userData }), interior,
      'wrapper aliases share the physical vehicle resource owner')
    assert.throws(() => attachSedanInterior(staleAlias), /canonical vehicle metadata owner/)
    assert.equal(model.userData.triangles, 990)
    assert.equal(model.userData.drawCalls, 8)
    const steering = interior.solids.find(solid => solid.id === 'steering-wheel')
    assert.ok(steering)
    const position = interior.geometry.getAttribute('position')
    const centered = vertices(position, steering.vertexStart, steering.vertexCount)
    interior.poseSteering(0.5)
    assert.notDeepEqual(vertices(position, steering.vertexStart, steering.vertexCount), centered,
      'the attached street interior exposes the steering pose')
    interior.poseSteering(0)
    assert.deepEqual(vertices(position, steering.vertexStart, steering.vertexCount), centered)

    const driver = model.userData.anchors.driver
    const body = model.userData.parts.body
    const driverLocal = body.worldToLocal(driver.getWorldPosition(new THREE.Vector3()))
    const driverSupport = interior.supportSurfaces.find(surface => surface.id === 'driver-seat-support')
    assert.ok(driverSupport)
    near(driverSupport.surfaceY, driverLocal.y - 0.12)
    const localContact = new THREE.Vector3(driverLocal.x, driverSupport.surfaceY, driverLocal.z)
    const surfaceWorld = () => {
      model.object3D.updateMatrixWorld(true)
      return interior.group.localToWorld(localContact.clone())
    }
    const firstWorldContact = surfaceWorld()
    const expectedFirst = body.localToWorld(localContact.clone())
    near(firstWorldContact.distanceTo(expectedFirst), 0)
    poseVehicle(model, { bounce: 0.18, time: 2.3 })
    const movedWorldContact = surfaceWorld()
    const expectedMoved = body.localToWorld(localContact.clone())
    near(movedWorldContact.distanceTo(expectedMoved), 0)
    assert.ok(movedWorldContact.distanceTo(firstWorldContact) > 0.01, 'interior surfaces follow the posed body transform')

    let geometryDisposals = 0, materialDisposals = 0
    interior.geometry.addEventListener('dispose', () => geometryDisposals += 1)
    interior.material.addEventListener('dispose', () => materialDisposals += 1)
    model.userData.dispose()
    model.userData.dispose()
    assert.equal(originalDisposeCalls, 1)
    assert.equal(interior.group.parent, null)
    assert.equal(geometryDisposals, 1)
    assert.equal(materialDisposals, 1)
    assert.throws(() => attachSedanInterior({ object3D: model.object3D, userData: model.userData }), /already disposed/)
    assert.equal(SEDAN_INTERIOR_LAYOUT.canBoard, false)
  } finally { model.userData.dispose() }
})
