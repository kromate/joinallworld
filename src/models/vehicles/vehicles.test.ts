import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VEHICLE_DETAILS, VEHICLE_TYPES, buildVehicle, poseVehicle } from './index.ts';
import type { VehicleDetail, VehicleModel, VehicleOptions, VehiclePose, VehicleType } from './index.ts';
import { profilePrism } from './geometry.ts';
import type { ColoredGeometry } from './geometry.ts';

const LIMITS: Readonly<Record<VehicleDetail, number>> = Object.freeze({ map: 250, street: 1500, showcase: 8000 });

test('profile prisms are closed solids with every face wound toward the exterior', () => {
  const source: ColoredGeometry[] = [];
  profilePrism(source, [[-1, 0], [1, 0], [1, 1], [-1, 1]], 2, '#ffffff');
  const first = source[0];
  assert.ok(first);
  const geometry = first.geometry;
  const position = geometry.getAttribute('position');
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

interface Resources {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  objects: Set<THREE.Object3D>;
  instances: Set<THREE.InstancedMesh>;
}

function isMeshObject(object: THREE.Object3D): object is THREE.Mesh {
  return 'isMesh' in object && object.isMesh === true;
}

function isInstancedObject(object: THREE.Mesh): object is THREE.InstancedMesh {
  return 'isInstancedMesh' in object && object.isInstancedMesh === true;
}

function resources(root: THREE.Object3D): Resources {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const objects = new Set<THREE.Object3D>();
  const instances = new Set<THREE.InstancedMesh>();
  root.traverse((object) => {
    objects.add(object);
    if (!isMeshObject(object)) return;
    if (isInstancedObject(object)) instances.add(object);
    geometries.add(object.geometry);
    if (Array.isArray(object.material)) for (const item of object.material) materials.add(item);
    else materials.add(object.material);
  });
  return { geometries, materials, objects, instances };
}

function poseSnapshot(model: VehicleModel): number[] {
  const { body, wheels, wheelInstances, steering, doors, brakeLights, indicators } = model.userData.parts;
  const values = [body.position.y, body.rotation.x, body.rotation.z];
  for (const wheel of wheels) values.push(wheel.rotation.x);
  for (const instances of wheelInstances) for (let index = 0; index < instances.instanceMatrix.array.length; index += 1) values.push(instances.instanceMatrix.array[index] ?? Number.NaN);
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
        assert.ok(model.userData.parts.wheelInstances.every((part) => isInstancedObject(part)), `${type}/${detail} wheel draws are instanced`);
      }
      model.userData.dispose();
    }
  }
});

test('each LOD preserves solid vehicle massing and finite bounds', () => {
  const minimum: Readonly<Record<VehicleType, readonly [number, number, number]>> = Object.freeze({
    danfo: [2.2, 2.4, 4.8], keke: [1.6, 2, 3], okada: [0.8, 1.2, 2.7],
    cab: [1.9, 1.5, 4.1], sedan: [1.9, 1.4, 4.2], hatchback: [1.8, 1.4, 3.7],
    suv: [2, 1.8, 4.4], pickup: [2, 1.7, 4.7], molue: [2.5, 3, 8.3],
    brt: [2.5, 3, 9], tanker: [2.4, 3, 9], container: [2.4, 3, 9],
    ferry: [2.8, 1.6, 8.2], canoe: [0.9, 0.7, 5.2], airplane: [8.8, 2.8, 8.5],
  });
  for (const type of VEHICLE_TYPES) {
    let mapSize: THREE.Vector3 | null = null;
    for (const detail of VEHICLE_DETAILS) {
      const model = buildVehicle(type, { detail });
      model.object3D.updateMatrixWorld(true);
      const size = new THREE.Vector3();
      new THREE.Box3().setFromObject(model.object3D).getSize(size);
      assert.ok(Number.isFinite(size.x + size.y + size.z), `${type}/${detail} has finite bounds`);
      const floor = minimum[type];
      assert.ok(size.x >= floor[0] && size.y >= floor[1] && size.z >= floor[2], `${type}/${detail} preserves its expected mass: ${size.toArray().map((value) => value.toFixed(2)).join(' x ')}`);
      if (detail === 'map') mapSize = size.clone();
      else {
        assert.ok(mapSize);
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
    assert.ok(anchors.door.parent && parts.doors.includes(anchors.door.parent), `${type} door belongs to a moving door root`);
    assert.ok(anchors.seats.length > 0, `${type} exposes passenger seats`);
    const driver = anchors.driver.position;
    for (let index = 0; index < anchors.seats.length; index += 1) {
      const seat = anchors.seats[index];
      assert.ok(seat);
      assert.equal(seat.name, `seat:${index}`);
      assert.equal(seat.parent, parts.body);
      assert.notEqual(seat, anchors.driver);
      assert.ok(Number.isFinite(seat.position.x + seat.position.y + seat.position.z));
      assert.ok(seat.position.distanceToSquared(driver) > 1e-6, `${type} passenger ${index} is not the driver position`);
    }
    model.userData.dispose();
  }
});

test('road-car boarding door reaches the driver side and opens outward around the front hinge', () => {
  for (const type of ['sedan', 'hatchback', 'suv', 'cab'] as const) {
    for (const detail of VEHICLE_DETAILS) {
      const model = buildVehicle(type, { detail });
      try {
        // Public anchors must retain their meaning when a host places and scales the vehicle.
        model.object3D.position.set(7, 0.3, -4);
        model.object3D.rotation.y = 1.1;
        model.object3D.scale.setScalar(0.8);
        const vehiclePoint = (node: THREE.Object3D) => model.object3D.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
        poseVehicle(model, { door: 0 });
        model.object3D.updateMatrixWorld(true);
        const { driver, door } = model.userData.anchors;
        const driverPoint = vehiclePoint(driver), closedDoor = vehiclePoint(door);
        const pivot = door.parent!;
        const panel = pivot.getObjectByName('door-panel') as THREE.Mesh<THREE.BufferGeometry>;
        assert.ok(panel?.isMesh, `${type}/${detail}: public door belongs to the actual panel`);
        panel.geometry.computeBoundingBox();
        const panelBounds = panel.geometry.boundingBox;
        assert.ok(panelBounds, `${type}/${detail}: actual door panel has bounds`);
        const centre = vehiclePoint(panel), hinge = vehiclePoint(pivot);
        assert.ok(driverPoint.x < 0 && closedDoor.x < driverPoint.x, `${type}/${detail}: boarding door is outside the driver on the same side`);
        assert.ok(driverPoint.z > centre.z + panelBounds.min.z && driverPoint.z < centre.z + panelBounds.max.z, `${type}/${detail}: driver lies within the doorway's longitudinal span`);
        assert.ok(hinge.z > centre.z, `${type}/${detail}: hinge is at the car's forward end`);
        assert.ok(closedDoor.distanceTo(new THREE.Vector3(centre.x, closedDoor.y, centre.z)) < 1e-6, `${type}/${detail}: closed public approach matches the panel centre`);
        for (const amount of [0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          poseVehicle(model, { door: amount });
          model.object3D.updateMatrixWorld(true);
          const opened = vehiclePoint(door);
          assert.ok(opened.x <= closedDoor.x + 1e-6 && opened.x < 0, `${type}/${detail}/${amount}: door never opens across the cabin`);
          assert.ok(vehiclePoint(panel).distanceTo(new THREE.Vector3(opened.x, vehiclePoint(panel).y, opened.z)) < 1e-6, `${type}/${detail}/${amount}: anchor tracks its panel`);
        }
        poseVehicle(model, { door: 0 });
        model.object3D.updateMatrixWorld(true);
        assert.ok(vehiclePoint(door).distanceTo(closedDoor) < 1e-6, `${type}/${detail}: closed approach resets exactly`);
      } finally { model.userData.dispose(); }
    }
  }
});

test('opening a road-car door clears its driver entry surface while the closed door fills it', () => {
  for (const type of ['sedan', 'hatchback', 'suv', 'cab'] as const) {
    for (const detail of VEHICLE_DETAILS) {
      const model = buildVehicle(type, { detail });
      try {
        model.object3D.position.set(-3, 0.2, 5);
        model.object3D.rotation.y = -0.7;
        model.object3D.scale.setScalar(0.8);
        const ray = new THREE.Raycaster();
        const driver = model.userData.anchors.driver.position;
        const pivot = model.userData.parts.doors[0];
        assert.ok(pivot);
        // The hatchback's front roof slope is below 1.25 at z=.62; sample inside every authored contour.
        for (const y of [0.82, 1.06, 1.20]) {
          for (const z of [0.22, driver.z, 0.62]) {
            const origin = new THREE.Vector3(pivot.position.x - 0.3, y, z);
            const stop = new THREE.Vector3(driver.x - 0.06, y, z);
            const check = (amount: number) => {
              poseVehicle(model, { door: amount });
              model.object3D.updateMatrixWorld(true);
              const worldOrigin = model.object3D.localToWorld(origin.clone());
              const worldStop = model.object3D.localToWorld(stop.clone());
              const direction = worldStop.clone().sub(worldOrigin);
              ray.set(worldOrigin, direction.clone().normalize());
              ray.near = 0; ray.far = direction.length();
              return ray.intersectObject(model.object3D, true);
            };
            assert.ok(check(0).length > 0, `${type}/${detail}/${y}/${z}: closed entry surface is filled`);
            assert.equal(check(1).length, 0, `${type}/${detail}/${y}/${z}: open entry surface is unobstructed`);
          }
        }
      } finally { model.userData.dispose(); }
    }
  }
});

test('pose is deterministic, resets backwards, and retains all allocated scene resources', () => {
  const pose: VehiclePose = { distance: 18.25, steering: -0.42, bounce: 0.13, door: 0.76, brake: 0.8, indicator: 'hazard', time: 3.625 };
  const otherPose: VehiclePose = { distance: -7, steering: 0.51, bounce: -0.08, door: 0, brake: false, indicator: false, time: 0.12 };
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
  const nightLights = night.userData.parts.headlights;
  const dayLights = day.userData.parts.headlights;
  assert.ok(nightLights && dayLights);
  assert.ok(nightLights.material.emissiveIntensity > dayLights.material.emissiveIntensity);
  day.userData.dispose();
  night.userData.dispose();
  assert.throws(() => buildVehicle('hovercraft' as unknown as VehicleType), /Unknown vehicle type/);
  assert.throws(() => buildVehicle('danfo', { detail: 'cinematic' as unknown as VehicleDetail }), /Unknown vehicle detail/);
  assert.throws(() => buildVehicle('danfo', { time: 'dusk' as unknown as NonNullable<VehicleOptions['time']> }), /Unknown vehicle time/);
});
