import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { VehicleUserData } from '../vehicles/index.ts';
import { createKit } from '../../scene/kit.ts';
import { createActor } from '../../map3d/actor.ts';
import type { TravelVehicleBuilder } from '../../map3d/actor.ts';
import { buildTravelVehicle } from './scene-models.ts';

/** The pose record the adapter keeps on the vehicle for diagnostics. */
interface ScenePose { distance: number; steering: number; riding: boolean }

function disposalCounter(root: THREE.Object3D, excluded: THREE.Object3D | null = null) {
  const resources = new Set<THREE.BufferGeometry | THREE.Material>();
  root.traverse((object) => {
    for (let at: THREE.Object3D | null = object; excluded && at; at = at.parent) if (at === excluded) return;
    const { geometry, material } = object as Partial<THREE.Mesh>;
    if (geometry) resources.add(geometry);
    if (Array.isArray(material)) material.forEach((item) => resources.add(item));
    else if (material) resources.add(material);
  });
  let disposed = 0;
  for (const resource of resources) resource.addEventListener('dispose', () => { disposed += 1; });
  return { resources, get disposed() { return disposed; } };
}

function worldPosition(object: THREE.Object3D) {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new THREE.Vector3());
}

test('the map actor seats the real avatar on a model anchor and poses one owned vehicle', () => {
  const kit = createKit();
  // The map's builder type is looser (time: string, Group) than the model library's (day | night, Object3D); the host only passes valid values.
  const actor = createActor(kit, { travelVehicle: buildTravelVehicle as unknown as TravelVehicleBuilder });
  actor.setPlayer({ seed: 'integration', look: { body: 'woman', hair: 'braids', outfit: 'casual' } });
  assert.equal(actor.setMode('danfo'), true);

  const danfo = actor.group.getObjectByName('vehicle:danfo');
  const passenger = actor.group.getObjectByName('actor-passenger');
  assert.ok(danfo && passenger);
  const seat = (danfo.userData as VehicleUserData).anchors.seats.at(-1);
  assert.ok(seat);
  assert.equal(passenger.parent, seat, 'the passenger is attached to the vehicle seat anchor');
  actor.group.updateMatrixWorld(true);
  assert.ok(worldPosition(passenger).distanceTo(worldPosition(seat)) < 1e-9, 'passenger origin follows the seat in world space');
  const passengerHeight = new THREE.Box3().setFromObject(passenger).getSize(new THREE.Vector3()).y;
  assert.ok(passengerHeight > 1.2 && passengerHeight < 2.1, `seated avatar fits the vehicle (${passengerHeight.toFixed(2)} units tall)`);

  const dayVehicleResources = disposalCounter(danfo, passenger);
  const passengerGeometries = new Set<THREE.BufferGeometry>();
  passenger.traverse((object: THREE.Object3D) => { const { geometry } = object as Partial<THREE.Mesh>; if (geometry) passengerGeometries.add(geometry); });
  let passengerDisposals = 0;
  for (const geometry of passengerGeometries) geometry.addEventListener('dispose', () => { passengerDisposals += 1; });
  assert.equal(actor.setTime('dusk'), false, 'dusk keeps the day vehicle phase');
  assert.equal(actor.setTime('night'), true);
  assert.equal(dayVehicleResources.disposed, dayVehicleResources.resources.size, 'time changes release the old vehicle resources');
  assert.equal(passengerDisposals, 0, 'vehicle lighting changes do not rebuild or dispose the passenger');
  const nightDanfo = actor.group.getObjectByName('vehicle:danfo');
  assert.ok(nightDanfo);
  const night = nightDanfo.userData as VehicleUserData & { scenePose: ScenePose };
  assert.notEqual(nightDanfo, danfo);
  assert.equal(actor.group.getObjectByName('actor-passenger'), passenger, 'the same passenger is reattached after the phase change');
  assert.equal(passenger.parent, night.anchors.seats.at(-1));
  assert.equal(actor.setTime('night'), false);
  assert.equal(actor.group.getObjectByName('vehicle:danfo'), nightDanfo, 'the same phase does not rebuild');

  actor.place({ phase: 'ride', distance: 2, x: 8, y: 0, z: 5, ry: 0, bridge: null, walking: false, step: 0, vehicle: { x: 8, y: 0, z: 5, ry: 0, bridge: null } });
  const firstWheel = night.parts.wheels[0];
  assert.ok(firstWheel);
  const firstRoll = firstWheel.rotation.x;
  actor.place({ phase: 'ride', distance: 4, x: 9, y: 0, z: 6, ry: 0.18, bridge: null, walking: false, step: 0, vehicle: { x: 9, y: 0, z: 6, ry: 0.18, bridge: null } });
  assert.notEqual(firstWheel.rotation.x, firstRoll, 'route distance spins the wheels');
  assert.ok(Math.abs(night.scenePose.steering) > 0.1, 'route heading changes steer the front wheels');
  assert.notEqual(night.parts.body.position.y, 0, 'the host pose supplies suspension bounce');
  const diagnostic = night.scenePose;
  const repeated = { steering: diagnostic.steering, wheel: firstWheel.rotation.x, bodyY: night.parts.body.position.y };
  actor.place({ phase: 'ride', distance: 4, x: 9, y: 0, z: 6, ry: 0.18, bridge: null, walking: false, step: 0, vehicle: { x: 9, y: 0, z: 6, ry: 0.18, bridge: null } });
  assert.equal(night.scenePose, diagnostic, 'the hot-path diagnostic record is reused');
  assert.deepEqual({ steering: diagnostic.steering, wheel: firstWheel.rotation.x, bodyY: night.parts.body.position.y }, repeated, 'an identical route sample is idempotent, including steering');

  const danfoResources = disposalCounter(nightDanfo, passenger);
  assert.equal(actor.setMode('car'), true);
  assert.equal(danfoResources.disposed, danfoResources.resources.size, 'mode change releases every old vehicle resource');
  const sedan = actor.group.getObjectByName('vehicle:sedan');
  assert.ok(sedan && actor.group.getObjectByName('actor-passenger')?.parent === (sedan.userData as VehicleUserData).anchors.seats.at(-1));
  assert.equal(actor.setMode('car'), false, 'setting the same mode does not rebuild');
  assert.equal(actor.group.getObjectByName('vehicle:sedan'), sedan);

  actor.dot(true);
  actor.place({ phase: 'ride', distance: 5, x: 10, y: 0, z: 7, ry: 0.2, bridge: null, walking: false, step: 0, vehicle: { x: 10, y: 0, z: 7, ry: 0.2, bridge: null } });
  assert.equal(actor.group.getObjectByName('actor-dot')?.visible, true);
  assert.equal(actor.group.getObjectByName('actor-ride')?.visible, false, 'reduced motion remains the route dot');

  const sedanResources = disposalCounter(sedan, actor.group.getObjectByName('actor-passenger') ?? null);
  actor.dispose();
  actor.dispose();
  assert.equal(sedanResources.disposed, sedanResources.resources.size, 'actor disposal is complete and idempotent');
  kit.dispose();
});

test('without a vehicle builder (the library failed to load) the actor rides the game\'s own batch-drawn vehicle', () => {
  const kit = createKit();
  const actor = createActor(kit);
  actor.setPlayer({ seed: 'default' });
  actor.setMode('danfo');
  assert.ok(actor.group.getObjectByName('legacy-vehicle:danfo'));
  assert.equal(actor.group.getObjectByName('vehicle:danfo'), undefined);
  assert.equal(actor.setTime('night'), true, 'the time is remembered');
  assert.ok(actor.group.getObjectByName('legacy-vehicle:danfo'), 'and changes nothing without a model vehicle');
  actor.dispose();
  kit.dispose();
});

test('a model trip vehicle stays inside the map\'s budget: at most 1,500 triangles and 8 draw calls at street detail', () => {
  for (const kind of ['danfo', 'keke', 'okada', 'cab', 'car']) {
    const vehicle = buildTravelVehicle(kind, { time: 'day' });
    assert.ok(vehicle);
    let triangles = 0, calls = 0;
    vehicle.object3D.traverse((node) => {
      const object = node as THREE.InstancedMesh;
      if (!object.isMesh) return;
      calls += 1;
      triangles += (object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position!.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    });
    assert.ok(triangles <= 1500 && calls <= 8, `${kind}: ${Math.round(triangles)} triangles, ${calls} draw calls`);
    vehicle.dispose();
  }
  assert.equal(buildTravelVehicle('trek'), null, 'a mode without a vehicle has none');
});


test('boat keeps a real vehicle and passenger when the road model library is loaded', () => {
  const kit = createKit();
  const actor = createActor(kit, { travelVehicle: buildTravelVehicle as unknown as TravelVehicleBuilder });
  actor.setPlayer({ seed: 'boat-passenger' });
  actor.setMode('boat');
  const boat = actor.group.getObjectByName('legacy-vehicle:boat');
  assert.ok(boat && boat.children.length > 0);
  assert.ok(actor.group.getObjectByName('actor-passenger'));
  actor.setMode('danfo');
  assert.equal(actor.group.getObjectByName('legacy-vehicle:boat'), undefined);
  assert.ok(actor.group.getObjectByName('vehicle:danfo'));
  actor.setMode('boat');
  assert.ok(actor.group.getObjectByName('legacy-vehicle:boat'));
  actor.dispose();
  kit.dispose();
});
