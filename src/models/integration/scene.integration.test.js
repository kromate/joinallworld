import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createKit } from '../../scene/kit.js';
import { createActor } from '../../map3d/actor.js';
import { buildCity } from '../../map3d/city-build.js';
import { buildNetwork } from '../../map3d/roads.js';
import pack from '../../map3d/cities/lagos.js';
import { VENUES, COMING_SOON } from '../../game/content/venues.js';

function disposalCounter(root, excluded = null) {
  const resources = new Set();
  root.traverse((object) => {
    for (let at = object; excluded && at; at = at.parent) if (at === excluded) return;
    if (object.geometry) resources.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach((material) => resources.add(material));
    else if (object.material) resources.add(object.material);
  });
  let disposed = 0;
  for (const resource of resources) resource.addEventListener('dispose', () => { disposed += 1; });
  return { resources, get disposed() { return disposed; } };
}

function worldPosition(object) {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new THREE.Vector3());
}

test('the map actor seats the real avatar on a model anchor and poses one owned vehicle', () => {
  const kit = createKit();
  const actor = createActor(kit);
  actor.setPlayer({ seed: 'integration', look: { body: 'woman', hair: 'braids', outfit: 'casual' } });
  assert.equal(actor.setMode('danfo'), true);

  const danfo = actor.group.getObjectByName('vehicle:danfo');
  const passenger = actor.group.getObjectByName('actor-passenger');
  const seat = danfo.userData.anchors.seats.at(-1);
  assert.equal(passenger.parent, seat, 'the passenger is attached to the vehicle seat anchor');
  actor.group.updateMatrixWorld(true);
  assert.ok(worldPosition(passenger).distanceTo(worldPosition(seat)) < 1e-9, 'passenger origin follows the seat in world space');
  const passengerHeight = new THREE.Box3().setFromObject(passenger).getSize(new THREE.Vector3()).y;
  assert.ok(passengerHeight > 1.2 && passengerHeight < 2.1, `seated avatar fits the vehicle (${passengerHeight.toFixed(2)} units tall)`);

  const dayVehicleResources = disposalCounter(danfo, passenger);
  const passengerGeometries = new Set();
  passenger.traverse((object) => { if (object.geometry) passengerGeometries.add(object.geometry); });
  let passengerDisposals = 0;
  for (const geometry of passengerGeometries) geometry.addEventListener('dispose', () => { passengerDisposals += 1; });
  assert.equal(actor.setTime('dusk'), false, 'dusk keeps the day vehicle phase');
  assert.equal(actor.setTime('night'), true);
  assert.equal(dayVehicleResources.disposed, dayVehicleResources.resources.size, 'time changes release the old vehicle resources');
  assert.equal(passengerDisposals, 0, 'vehicle lighting changes do not rebuild or dispose the passenger');
  const nightDanfo = actor.group.getObjectByName('vehicle:danfo');
  assert.notEqual(nightDanfo, danfo);
  assert.equal(actor.group.getObjectByName('actor-passenger'), passenger, 'the same passenger is reattached after the phase change');
  assert.equal(passenger.parent, nightDanfo.userData.anchors.seats.at(-1));
  assert.equal(actor.setTime('night'), false);
  assert.equal(actor.group.getObjectByName('vehicle:danfo'), nightDanfo, 'the same phase does not rebuild');

  actor.place({ phase: 'ride', distance: 2, x: 8, y: 0, z: 5, ry: 0, vehicle: { x: 8, y: 0, z: 5, ry: 0 } });
  const firstWheel = nightDanfo.userData.parts.wheels[0];
  const firstRoll = firstWheel.rotation.x;
  actor.place({ phase: 'ride', distance: 4, x: 9, y: 0, z: 6, ry: 0.18, vehicle: { x: 9, y: 0, z: 6, ry: 0.18 } });
  assert.notEqual(firstWheel.rotation.x, firstRoll, 'route distance spins the wheels');
  assert.ok(Math.abs(nightDanfo.userData.scenePose.steering) > 0.1, 'route heading changes steer the front wheels');
  assert.notEqual(nightDanfo.userData.parts.body.position.y, 0, 'the host pose supplies suspension bounce');
  const diagnostic = nightDanfo.userData.scenePose;
  const repeated = { steering: diagnostic.steering, wheel: firstWheel.rotation.x, bodyY: nightDanfo.userData.parts.body.position.y };
  actor.place({ phase: 'ride', distance: 4, x: 9, y: 0, z: 6, ry: 0.18, vehicle: { x: 9, y: 0, z: 6, ry: 0.18 } });
  assert.equal(nightDanfo.userData.scenePose, diagnostic, 'the hot-path diagnostic record is reused');
  assert.deepEqual({ steering: diagnostic.steering, wheel: firstWheel.rotation.x, bodyY: nightDanfo.userData.parts.body.position.y }, repeated, 'an identical route sample is idempotent, including steering');

  const danfoResources = disposalCounter(nightDanfo, passenger);
  assert.equal(actor.setMode('car'), true);
  assert.equal(danfoResources.disposed, danfoResources.resources.size, 'mode change releases every old vehicle resource');
  const sedan = actor.group.getObjectByName('vehicle:sedan');
  assert.ok(sedan && actor.group.getObjectByName('actor-passenger').parent === sedan.userData.anchors.seats.at(-1));
  assert.equal(actor.setMode('car'), false, 'setting the same mode does not rebuild');
  assert.equal(actor.group.getObjectByName('vehicle:sedan'), sedan);

  actor.dot(true);
  actor.place({ phase: 'ride', distance: 5, x: 10, y: 0, z: 7, ry: 0.2, vehicle: { x: 10, y: 0, z: 7, ry: 0.2 } });
  assert.equal(actor.group.getObjectByName('actor-dot').visible, true);
  assert.equal(actor.group.getObjectByName('actor-ride').visible, false, 'reduced motion remains the route dot');

  const sedanResources = disposalCounter(sedan, actor.group.getObjectByName('actor-passenger'));
  actor.dispose();
  actor.dispose();
  assert.equal(sedanResources.disposed, sedanResources.resources.size, 'actor disposal is complete and idempotent');
  kit.dispose();
});

test('the city mounts only purposeful environment models and keeps its shoreline surface and budget', () => {
  const kit = createKit();
  const city = buildCity(kit, pack, buildNetwork(pack), { venues: VENUES, soon: COMING_SOON });
  const market = city.group.getObjectByName('environment:market-stall');
  const house = city.group.getObjectByName('environment:compound-house');
  const canoe = city.group.getObjectByName('vehicle:canoe');
  assert.deepEqual([market.position.x, market.position.z], [pack.sites.market.x, pack.sites.market.z], 'the model is the actual market landmark');
  assert.equal(house.parent.name, 'home', 'the model is the selected Home landmark');
  city.setHome('lekki');
  const homeAt = worldPosition(house);
  assert.ok(Math.abs(homeAt.x - pack.homes.lekki.x) < 1e-9 && Math.abs(homeAt.z - pack.homes.lekki.z) < 1e-9, 'Home moves with the existing place contract');

  const water = city.group.getObjectByName('water');
  water.geometry.computeBoundingBox();
  const waterSize = water.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(waterSize.x > 200 && waterSize.y > 150, 'the city keeps its full water surface and shoreline overlays instead of mounting the 12 × 8 lagoon model');
  assert.equal(city.group.getObjectByName('environment:lagoon'), undefined);
  assert.equal(canoe.position.y, -0.5, 'one bounded model canoe occupies the existing lagoon boat layer');
  const canoeBodyY = canoe.userData.parts.body.position.y;
  city.animate(1);
  assert.notEqual(canoe.userData.parts.body.position.y, canoeBodyY, 'the host animation sample poses the canoe without a model-owned loop');
  assert.equal(water.material.userData.sceneModel, 'lagoon', 'the existing water uses the model library palette and material');
  assert.equal(water.material.roughness, 0.72);
  const day = water.material.color.getHex();
  city.setTime('night');
  assert.notEqual(water.material.color.getHex(), day, 'host time still drives model-backed water and landmarks');

  let meshes = 0;
  let triangles = 0;
  city.group.traverse((object) => {
    if (!object.isMesh || !object.visible) return;
    meshes += 1;
    const count = object.geometry.index ? object.geometry.index.count : object.geometry.attributes.position.count;
    triangles += count / 3 * (object.isInstancedMesh ? object.count : 1);
  });
  assert.ok(triangles < 60000, `${Math.round(triangles)} city triangles stay inside the host budget`);
  assert.ok(meshes <= 40, `${meshes} city draw calls stay inside the host budget`);

  const marketResources = disposalCounter(market);
  const houseResources = disposalCounter(house);
  const canoeResources = disposalCounter(canoe);
  let waterDisposals = 0;
  water.material.addEventListener('dispose', () => { waterDisposals += 1; });
  city.dispose();
  city.dispose();
  assert.equal(marketResources.disposed, marketResources.resources.size);
  assert.equal(houseResources.disposed, houseResources.resources.size);
  assert.equal(canoeResources.disposed, canoeResources.resources.size);
  assert.equal(waterDisposals, 1, 'city-owned water material is disposed once');
  kit.dispose();
});

test('models=legacy retains the prior actor vehicle and city landmark paths', () => {
  const previous = globalThis.location;
  globalThis.location = { search: '?models=legacy' };
  try {
    const actorKit = createKit();
    const actor = createActor(actorKit);
    actor.setPlayer({ seed: 'legacy' });
    actor.setMode('danfo');
    assert.ok(actor.group.getObjectByName('legacy-vehicle:danfo'));
    assert.equal(actor.group.getObjectByName('vehicle:danfo'), undefined);
    actor.dispose();
    actorKit.dispose();

    const cityKit = createKit();
    const city = buildCity(cityKit, pack, buildNetwork(pack), { venues: VENUES, soon: COMING_SOON });
    assert.equal(city.group.getObjectByName('environment:market-stall'), undefined);
    assert.equal(city.group.getObjectByName('environment:compound-house'), undefined);
    assert.equal(city.group.getObjectByName('vehicle:canoe'), undefined);
    assert.equal(city.group.getObjectByName('water').material.userData.sceneModel, undefined);
    city.dispose();
    cityKit.dispose();
  } finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
});
