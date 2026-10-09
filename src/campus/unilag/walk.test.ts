import assert from 'node:assert/strict';
import test from 'node:test';

import { ANCHORS, ENTRANCE, ZONES } from './layout.ts';
import { CAMPUS_MAP } from './map.generated.ts';
import { pointInRing } from './geo.ts';
import { createCampusWalk } from './walk.ts';
import type { CampusZone } from './layout.ts';
import type { MetreRing } from './geo.ts';

const walk = createCampusWalk();

function freeEndpointIn(zone: CampusZone): { x: number; z: number } | null {
  const grid = walk.grids.get(zone.id);
  if (!grid) return null;
  const [x0, z0, x1, z1] = zone.bounds;
  for (let z = Math.max(z0, grid.bounds[1]) + grid.cell / 2; z < Math.min(z1, grid.bounds[3]); z += grid.cell) {
    for (let x = Math.max(x0, grid.bounds[0]) + grid.cell / 2; x < Math.min(x1, grid.bounds[2]); x += grid.cell) {
      if (grid.free(x, z) && walk.zoneAt(x, z)?.id === zone.id) return { x, z };
    }
  }
  return null;
}

function interiorPoint(ring: MetreRing): { x: number; z: number } | null {
  const xs = ring.map(([x]) => x), zs = ring.map(([, z]) => z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const step = Math.max(0.25, Math.min(2, Math.max(maxX - minX, maxZ - minZ) / 80));
  for (let z = minZ + step / 2; z < maxZ; z += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      if (pointInRing([x, z], ring)) return { x, z };
    }
  }
  return null;
}

test('every published building anchor is free and reachable at its exact endpoint', () => {
  const anchors = Object.values(ANCHORS);
  assert.ok(anchors.length > 0);
  for (const anchor of anchors) {
    assert.equal(walk.zoneAt(anchor.x, anchor.z)?.id, anchor.zone, anchor.id);
    assert.equal(walk.grids.get(anchor.zone)?.free(anchor.x, anchor.z), true, anchor.id);
    const path = walk.route(ENTRANCE, anchor);
    assert.ok(path, `route to ${anchor.id}`);
    if (anchor.x === ENTRANCE.x && anchor.z === ENTRANCE.z) assert.deepEqual(path, [], anchor.id);
    else assert.deepEqual(path.at(-1), { x: anchor.x, z: anchor.z }, anchor.id);
  }
});

test('mapped building and water polygons block exact destinations', () => {
  const building = CAMPUS_MAP.buildings.map(feature => ({ id: feature.id, ring: feature.ring })).find(feature => interiorPoint(feature.ring));
  const water = CAMPUS_MAP.surfaces.filter(surface => surface.kind === 'water' || surface.kind === 'wetland' || surface.kind === 'pool')
    .map(feature => ({ id: feature.id, ring: feature.ring })).find(feature => interiorPoint(feature.ring));
  assert.ok(building, 'published map contains a mapped building footprint');
  assert.ok(water, 'published map contains a mapped water/wetland/pool footprint');
  const buildingPoint = interiorPoint(building.ring), waterPoint = interiorPoint(water.ring);
  assert.ok(buildingPoint && waterPoint);
  assert.equal(pointInRing([buildingPoint.x, buildingPoint.z], building.ring), true, building.id);
  assert.equal(pointInRing([waterPoint.x, waterPoint.z], water.ring), true, water.id);
  assert.equal(walk.route(ENTRANCE, buildingPoint), null, building.id);
  assert.equal(walk.route(ENTRANCE, waterPoint), null, water.id);
});

test('only streaming zones with a real free endpoint are treated as navigation areas', () => {
  const areas = ZONES.map(zone => ({ zone, endpoint: freeEndpointIn(zone) })).filter(
    (entry): entry is { zone: CampusZone; endpoint: { x: number; z: number } } => entry.endpoint !== null,
  );
  assert.ok(areas.length > 0);
  for (const { zone, endpoint } of areas) {
    assert.equal(walk.zoneAt(endpoint.x, endpoint.z)?.id, zone.id, zone.id);
    assert.equal(walk.grids.get(zone.id)?.free(endpoint.x, endpoint.z), true, zone.id);
    assert.deepEqual(walk.route(endpoint, endpoint), [], zone.id);
  }
  assert.ok(areas.length < ZONES.length, 'empty/off-campus streaming rectangles are not assumed walkable');
});

test('bounded mapped anchor representatives remain connected at exact endpoints across zones', () => {
  const representatives = new Map<string, (typeof ANCHORS)[string]>();
  for (const anchor of Object.values(ANCHORS).sort((a, b) => a.id.localeCompare(b.id))) {
    if (!representatives.has(anchor.zone)) representatives.set(anchor.zone, anchor);
  }
  const zones = [...representatives.keys()].sort().slice(0, 8);
  assert.ok(zones.length >= Math.min(2, representatives.size));
  const selected = zones.map(zone => representatives.get(zone)!);
  for (const from of selected) for (const to of selected) {
    const path = walk.route(from, to);
    assert.ok(path, `${from.id} -> ${to.id}`);
    if (from.x === to.x && from.z === to.z) assert.deepEqual(path, [], `${from.id} -> ${to.id}`);
    else assert.deepEqual(path.at(-1), { x: to.x, z: to.z }, `${from.id} -> ${to.id}`);
  }
});

test('actual map bounds, NaN and blocked exact endpoints are rejected', () => {
  const outside = { x: CAMPUS_MAP.bounds[2] + 1, z: CAMPUS_MAP.bounds[1] + 1 };
  assert.equal(walk.zoneAt(outside.x, outside.z), null);
  assert.equal(walk.route(ENTRANCE, outside), null);
  assert.equal(walk.route({ x: Number.NaN, z: ENTRANCE.z }, ENTRANCE), null);
});

test('additional rendered footprints participate in exact route validation', () => {
  const blocked = createCampusWalk({ gate: [[ENTRANCE.x - 1, ENTRANCE.z - 1, ENTRANCE.x + 1, ENTRANCE.z + 1]] });
  const library = ANCHORS['library'];
  assert.ok(library);
  assert.equal(blocked.route(ENTRANCE, library), null);
});
