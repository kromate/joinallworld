import assert from 'node:assert/strict';
import test from 'node:test';

import { ANCHORS, BUILDINGS, ENTRANCE, ZONES } from './layout.ts';
import { createCampusWalk, footprintOf } from './walk.ts';

const walk = createCampusWalk();
const campusZones = ZONES;

test('all building anchors are exact, free destinations in their declared zones', () => {
  const anchors = Object.values(ANCHORS);
  assert.ok(anchors.length >= BUILDINGS.length);
  assert.deepEqual([ANCHORS.people.x,ANCHORS.people.z],[ANCHORS['student-union'].x,ANCHORS['student-union'].z]);
  for (const anchor of anchors) {
    assert.equal(walk.zoneAt(anchor.x, anchor.z)?.id, anchor.zone, anchor.id);
    assert.equal(walk.grids.get(anchor.zone)?.free(anchor.x, anchor.z), true, anchor.id);
  }
});

test('interior walls keep the full south facade open and exterior footprints stay solid', () => {
  const interior = BUILDINGS.find((building) => building.id === 'library');
  const exterior = BUILDINGS.find((building) => building.id === 'main-gate');
  const walls = footprintOf(interior);
  assert.equal(walls.length, 6);
  assert.ok(walls.every((wall) => wall[1] < interior.z + interior.d / 2));

  const gatePillars = footprintOf(exterior);
  assert.equal(gatePillars.length, 2);
  assert.ok(gatePillars[0][2] < gatePillars[1][0], 'gate arch must remain walkable');
});

test('main gate can reach every building anchor and preserves each exact endpoint', () => {
  for (const anchor of Object.values(ANCHORS)) {
    const path = walk.route(ENTRANCE, anchor);
    assert.ok(path, `route to ${anchor.id}`);
    assert.deepEqual(path.at(-1), { x: anchor.x, z: anchor.z }, anchor.id);
  }
});

test('every pair of walkable zones is connected through free exact endpoints', () => {
  const pointIn = (zone) => {
    const [x0, z0, x1, z1] = zone.bounds;
    return walk.grids.get(zone.id).nearest((x0 + x1) / 2, (z0 + z1) / 2);
  };
  for (const fromZone of campusZones) {
    for (const toZone of campusZones) {
      const from = pointIn(fromZone);
      const to = pointIn(toZone);
      const path = walk.route(from, to);
      assert.ok(path, `${fromZone.id} -> ${toZone.id}`);
      if (fromZone.id === toZone.id && from.x === to.x && from.z === to.z) {
        assert.deepEqual(path, []);
      } else {
        assert.deepEqual(path.at(-1), to, `${fromZone.id} -> ${toZone.id}`);
      }
    }
  }
});

test('shore water, outside bounds and blocked exact endpoints are rejected', () => {
  assert.deepEqual(walk.route(ENTRANCE, { x: 320, z: 0 })?.at(-1), { x: 320, z: 0 });
  assert.equal(walk.route(ENTRANCE, { x: 350, z: 0 }), null);
  assert.equal(walk.route(ENTRANCE, { x: 401, z: 0 }), null);
  assert.equal(walk.route({ x: Number.NaN, z: 0 }, ENTRANCE), null);

  const solidBackWall = BUILDINGS.find((building) => building.id === 'senate');
  assert.equal(walk.route(ENTRANCE, { x: solidBackWall.x, z: solidBackWall.z - solidBackWall.d / 2 }), null);
});

test('additional rendered footprints participate in exact route validation', () => {
  const blocked = createCampusWalk({ gate: [[ENTRANCE.x - 1, ENTRANCE.z - 1, ENTRANCE.x + 1, ENTRANCE.z + 1]] });
  assert.equal(blocked.route(ENTRANCE, ANCHORS.library), null);
});
