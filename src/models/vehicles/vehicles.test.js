import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VEHICLE_DETAILS, VEHICLE_TYPES, buildVehicle, poseVehicle } from './index.js';
import { profilePrism } from './geometry.js';

const LIMITS = Object.freeze({ map: 250, street: 1500, showcase: 8000 });

test('profile prisms are closed solids with every face wound toward the exterior', () => {
  const source = [];
  profilePrism(source, [[-1, 0], [1, 0], [1, 1], [-1, 1]], 2, '#ffffff');
  const geometry = source[0].geometry;
  const position = geometry.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const outward = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);
    edgeAB.subVectors(b, a);
    edgeAC.subVectors(c, a);
    normal.crossVectors(edgeAB, edgeAC);
    outward.set(
      (a.x + b.x + c.x) / 3,
      (a.y + b.y + c.y) / 3 - 0.5,
      (a.z + b.z + c.z) / 3,
    );
    assert.ok(normal.dot(outward) > 0, `triangle ${index / 3} faces outside`);
  }
  geometry.dispose();
});

/** @param {THREE.Object3D} root @returns {{ geometries: Set<THREE.BufferGeometry>, materials: Set<THREE.Material>, objects: Set<THREE.Object3D>, instances: Set<THREE.InstancedMesh> }} */
function resources(root) {
  const geometries = new Set();
  const materials = new Set();
  const objects = new Set();
  const instances = new Set();
  root.traverse((object) => {
    objects.add(object);
    if (!object.isMesh) return;
    if (object.isInstancedMesh) instances.add(object);
    geometries.add(object.geometry);
    if (Array.isArray(object.material)) for (const item of object.material) materials.add(item);
    else materials.add(object.material);
  });
  return { geometries, materials, objects, instances };
}

/** @param {ReturnType<typeof buildVehicle>} model @returns {number[]} */
function poseSnapshot(model) {
  const { body, wheels, wheelInstances, steering, doors, brakeLights, indicators } = model.userData.parts;
  const values = [body.position.y, body.rotation.x, body.rotation.z];
  for (const wheel of wheels) values.push(wheel.rotation.x);
  for (const instances of wheelInstances) for (let index = 0; index < instances.instanceMatrix.array.length; index += 1) values.push(instances.instanceMatrix.array[index]);
  for (const axle of steering) values.push(axle.rotation.y);
  for (const door of doors) values.push(door.position.x, door.position.y, door.position.z, door.rotation.x, door.rotation.y);
  values.push(brakeLights ? brakeLights.material.emissiveIntensity : -1);
  values.push(indicators[0] ? indicators[0].material.emissiveIntensity : -1);
  values.push(indicators[1] ? indicators[1].material.emissiveIntensity : -1);
  return values;
}

test('every vehicle and detail level stays within its hard triangle budget', () => {
  for (const type of VEHICLE_TYPES) {
    for (const detail of VEHICLE_DETAILS) {
      const model = buildVehicle(type, {
        detail,
        time: detail === 'showcase' ? 'night' : 'day',
        color: '#7654a8',
        stripe: '#d29a32',
        route: 'MMMMMMMMMMMM',
      });
      assert.equal(model.object3D.userData, model.userData, `${type}/${detail} shares metadata`);
      assert.ok(model.userData.triangles > 0, `${type}/${detail} has geometry`);
      assert.ok(model.userData.triangles <= LIMITS[detail], `${type}/${detail}: ${model.userData.triangles} <= ${LIMITS[detail]}`);
      assert.ok(model.userData.drawCalls > 0, `${type}/${detail} has draw calls`);
      assert.ok(model.userData.drawCalls <= 8, `${type}/${detail}: ${model.userData.drawCalls} draw calls <= 8`);
      if (model.userData.parts.wheels.length) {
        assert.ok(model.userData.parts.wheelInstances.length > 0, `${type}/${detail} instances repeated wheels`);
        assert.ok(model.userData.parts.wheelInstances.every((part) => part.isInstancedMesh), `${type}/${detail} wheel draws are instanced`);
      }
      model.userData.dispose();
    }
  }
});

test('each LOD preserves solid vehicle massing and finite bounds', () => {
  const minimum = Object.freeze({
    danfo: [2.2, 2.4, 4.8], keke: [1.6, 2, 3], okada: [0.8, 1.2, 2.7],
    cab: [1.9, 1.5, 4.1], sedan: [1.9, 1.4, 4.2], hatchback: [1.8, 1.4, 3.7],
    suv: [2, 1.8, 4.4], pickup: [2, 1.7, 4.7], molue: [2.5, 3, 8.3],
    brt: [2.5, 3, 9], tanker: [2.4, 3, 9], container: [2.4, 3, 9],
    ferry: [2.8, 1.6, 8.2], canoe: [0.9, 0.7, 5.2], airplane: [8.8, 2.8, 8.5],
  });
  for (const type of VEHICLE_TYPES) {
    let mapSize = null;
    for (const detail of VEHICLE_DETAILS) {
      const model = buildVehicle(type, { detail });
      model.object3D.updateMatrixWorld(true);
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(model.object3D).getSize(size);
      assert.ok(Number.isFinite(size.x + size.y + size.z), `${type}/${detail} has finite bounds`);
      assert.ok(size.x >= minimum[type][0] && size.y >= minimum[type][1] && size.z >= minimum[type][2], `${type}/${detail} preserves its expected mass: ${size.toArray().map((value) => value.toFixed(2)).join(' x ')}`);
      if (detail === 'map') mapSize = size.clone();
      else {
        assert.ok(size.x / mapSize.x < 1.35 && size.y / mapSize.y < 1.9 && size.z / mapSize.z < 1.35, `${type}/${detail} stays in the map LOD footprint`);
      }
      model.userData.dispose();
    }
  }
});

test('anchors are named, parented, finite, and never duplicate the driver as a passenger seat', () => {
  for (const type of VEHICLE_TYPES) {
    const model = buildVehicle(type, { detail: 'street' });
    const { anchors, parts } = model.userData;
    assert.equal(anchors.driver.name, 'driver');
    assert.equal(anchors.driver.parent, parts.body);
    assert.equal(anchors.door.name, 'door');
    assert.ok(parts.doors.includes(anchors.door.parent), `${type} door belongs to a moving door root`);
    assert.ok(anchors.seats.length > 0, `${type} exposes passenger seats`);
    const driver = anchors.driver.position;
    for (let index = 0; index < anchors.seats.length; index += 1) {
      const seat = anchors.seats[index];
      assert.equal(seat.name, `seat:${index}`);
      assert.equal(seat.parent, parts.body);
      assert.notEqual(seat, anchors.driver);
      assert.ok(Number.isFinite(seat.position.x + seat.position.y + seat.position.z));
      assert.ok(seat.position.distanceToSquared(driver) > 1e-6, `${type} passenger ${index} is not the driver position`);
    }
    model.userData.dispose();
  }
});

test('pose is deterministic, resets backwards, and retains all allocated scene resources', () => {
  const pose = { distance: 18.25, steering: -0.42, bounce: 0.13, door: 0.76, brake: 0.8, indicator: 'hazard', time: 3.625 };
  const otherPose = { distance: -7, steering: 0.51, bounce: -0.08, door: 0, brake: false, indicator: false, time: 0.12 };
  for (const type of VEHICLE_TYPES) {
    const model = buildVehicle(type, { detail: 'showcase', time: 'night' });
    const before = resources(model.object3D);
    poseVehicle(model, pose);
    const expected = poseSnapshot(model);
    poseVehicle(model.object3D, otherPose);
    poseVehicle(model, pose);
    assert.deepEqual(poseSnapshot(model), expected, `${type} returns exactly to an earlier pose`);
    for (let index = 0; index < 100; index += 1) poseVehicle(model, { ...otherPose, time: index / 17, distance: index - 50 });
    const after = resources(model.object3D);
    assert.deepEqual(after.geometries, before.geometries, `${type} pose creates no geometry`);
    assert.deepEqual(after.materials, before.materials, `${type} pose creates no material`);
    assert.deepEqual(after.objects, before.objects, `${type} pose creates no scene objects`);
    model.userData.dispose();
  }
});

test('dispose releases each owned instanced mesh, geometry, and material once and is idempotent', () => {
  for (const type of VEHICLE_TYPES) {
    const model = buildVehicle(type, { detail: 'showcase' });
    const owned = resources(model.object3D);
    let geometryEvents = 0;
    let materialEvents = 0;
    let instanceEvents = 0;
    for (const geometry of owned.geometries) geometry.addEventListener('dispose', () => { geometryEvents += 1; });
    for (const item of owned.materials) item.addEventListener('dispose', () => { materialEvents += 1; });
    for (const item of owned.instances) item.addEventListener('dispose', () => { instanceEvents += 1; });
    model.userData.dispose();
    model.object3D.userData.dispose();
    assert.equal(geometryEvents, owned.geometries.size, `${type} geometries`);
    assert.equal(materialEvents, owned.materials.size, `${type} materials`);
    assert.equal(instanceEvents, owned.instances.size, `${type} instanced meshes`);
  }
});

test('day and night are explicit and invalid public inputs fail at the boundary', () => {
  const day = buildVehicle('danfo', { time: 'day' });
  const night = buildVehicle('danfo', { time: 'night' });
  assert.ok(night.userData.parts.headlights.material.emissiveIntensity > day.userData.parts.headlights.material.emissiveIntensity);
  day.userData.dispose();
  night.userData.dispose();
  assert.throws(() => buildVehicle('hovercraft'), /Unknown vehicle type/);
  assert.throws(() => buildVehicle('danfo', { detail: 'cinematic' }), /Unknown vehicle detail/);
  assert.throws(() => buildVehicle('danfo', { time: 'dusk' }), /Unknown vehicle time/);
});
