// OWNER: world — the Lagos pack is geographically real: every place in its own local government, roads on land, bridges over water,
// and every one of the 512 estates of all twenty local governments inside that local government's real boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import pack, { placeLga } from './cities/lagos.ts';
import { estateLayout, plotAt } from './estates.ts';
import { inLga, lgaAt, partsOf } from './lga.ts';
import { fromLocal, ORIGINS } from './geo/frame.ts';
import { ESTATE } from '../game/content/world.ts';

const spots: Record<string, { x: number; z: number }> = { ...pack.sites, ...Object.fromEntries(Object.entries(pack.homes).map(([id, home]) => [`home:${id}`, home])) };
const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const edgeDistance = (x: number, z: number, ring: readonly (readonly [number, number])[]) => {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!, [bx, bz] = ring[i]!, dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz, t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
};

test('the pack is drawn in the Nigeria frame, from the real boundaries: exact land, every part, state box', () => {
  assert.deepEqual(pack.frame, { origin: ORIGINS.lagos, unitsPerKm: 10 });
  assert.equal(pack.lgas.length, 20);
  for (const lga of pack.lgas) {
    assert.ok(lga.polygons && lga.polygons.length >= 1, `${lga.id} keeps every part of its boundary`);
    assert.ok(lga.polygons.some((part) => part[0] === lga.polygon), `${lga.id}: polygon is one of its parts`);
  }
  assert.ok(pack.land.filter((entry) => entry.kind !== 'sand').every((entry) => entry.exact), 'real land is drawn exactly, never rounded');
  assert.ok(pack.land.some((entry) => entry.id === 'eko-atlantic' && entry.kind === 'sand'));
  // The state box in degrees matches the board: the geo box is the real bounding box, the board has a sea margin around it.
  const [south, west, north, east] = pack.geo.box;
  assert.ok(south > 6.3 && south < 6.4 && north > 6.69 && north < 6.72 && west > 2.69 && west < 2.71 && east > 4.36 && east < 4.38);
  const nw = fromLocal(ORIGINS.lagos, pack.bounds.fit.minX, pack.bounds.fit.minZ), se = fromLocal(ORIGINS.lagos, pack.bounds.fit.maxX, pack.bounds.fit.maxZ);
  assert.ok(Math.abs(nw.lon - west) < 1e-6 && Math.abs(nw.lat - north) < 1e-6 && Math.abs(se.lon - east) < 1e-6 && Math.abs(se.lat - south) < 1e-6, 'fit is the whole state');
  assert.ok(pack.bounds.minX < pack.bounds.fit.minX && pack.bounds.maxZ > pack.bounds.fit.maxZ, 'a sea margin');
  for (const lga of pack.lgas) { const [s, w, n, e] = lga.geo.box; assert.ok(lga.geo.c[0] > s && lga.geo.c[0] < n && lga.geo.c[1] > w && lga.geo.c[1] < e, `${lga.id} centre is in its box`); }
  // The metropolitan core holds every venue and home.
  const core = pack.core!;
  for (const [id, spot] of Object.entries(spots)) if (id !== 'refinery') assert.ok(spot.x > core.minX && spot.x < core.maxX && spot.z > core.minZ && spot.z < core.maxZ, `${id} is in the core`);
  assert.ok(pack.roadScale! > 0 && pack.roadScale! <= 1);
});

test('every venue and home stands inside the local government it belongs to, clear of other landmarks', () => {
  assert.deepEqual(Object.keys(placeLga).sort(), Object.keys(spots).sort());
  for (const [id, spot] of Object.entries(spots)) assert.equal(lgaAt(pack, spot.x, spot.z), placeLga[id], `${id} is in ${placeLga[id]}`);
  const ids = Object.keys(spots);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(distance(spots[ids[i]!]!, spots[ids[j]!]!) >= 3.5, `${ids[i]} and ${ids[j]} are at least 350 m apart`);
  // The known anchors, in degrees.
  const at = (id: string) => fromLocal(ORIGINS.lagos, spots[id]!.x, spots[id]!.z);
  assert.ok(Math.abs(at('park').lat - 6.451) < 0.004 && Math.abs(at('park').lon - 3.397) < 0.01, 'Freedom Park is on Lagos Island');
  assert.ok(Math.abs(at('shrine').lat - 6.601) < 0.003 && Math.abs(at('shrine').lon - 3.344) < 0.003, 'the Shrine is in Ikeja');
  assert.ok(Math.abs(at('airport').lat - 6.577) < 0.003 && Math.abs(at('airport').lon - 3.321) < 0.003, 'the airport terminal');
  assert.ok(Math.abs(at('unilag').lat - 6.518) < 0.003 && Math.abs(at('unilag').lon - 3.398) < 0.003, 'UNILAG at Akoka');
  assert.ok(Math.abs(at('refinery').lat - 6.43) < 0.01 && Math.abs(at('refinery').lon - 3.99) < 0.01, 'the refinery in the Lekki Free Zone');
  assert.ok(at('beach').lat < 6.44 && at('beach').lon > 3.48 && at('beach').lon < 3.56, 'the beach is on the Eti-Osa coast');
  for (const [id, estate] of Object.entries(pack.estates)) assert.equal(lgaAt(pack, estate.x, estate.z), lgaAt(pack, pack.homes[id]!.x, pack.homes[id]!.z), `${id}: the lot is in the same local government as the home`);
  for (const lga of pack.lgas) {
    assert.equal(lgaAt(pack, lga.plate[0], lga.plate[1]), lga.id, `${lga.id} plate is inside it`);
    assert.ok(Math.min(...partsOf(lga).map((part) => edgeDistance(lga.plate[0], lga.plate[1], part[0] as readonly (readonly [number, number])[]))) > 5, `${lga.id} plate is at least half a km from its boundary`);
  }
  for (const district of pack.districts.filter((item) => !item.water)) assert.ok(lgaAt(pack, district.x, district.z), `${district.name} is lettered on land`);
  for (const district of pack.districts.filter((item) => item.water && /LAGOON|ATLANTIC|MAINLAND/.test(item.name))) assert.equal(lgaAt(pack, district.x, district.z), null, `${district.name} is lettered on the water`);
});

test('ground roads run over land; the big bridges cross water; every road joins the network', () => {
  const outside = (road: (typeof pack.roads)[number]) => {
    let out = 0, total = 0;
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1]!, [bx, bz] = road.points[i]!, n = Math.max(1, Math.ceil(distance({ x: ax, z: az }, { x: bx, z: bz })));
      for (let k = 0; k <= n; k++) { total += 1; if (!pack.lgas.some((lga) => inLga(lga, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n))) out += 1; }
    }
    return out / total;
  };
  for (const road of pack.roads) {
    if (!road.bridge) assert.equal(outside(road), 0, `${road.id} is on land`);
    for (const end of [road.points[0]!, road.points.at(-1)!]) assert.ok(pack.lgas.some((lga) => inLga(lga, end[0], end[1])), `${road.id} starts and ends on land`);
  }
  for (const id of ['third-mainland', 'carter', 'eko']) assert.ok(outside(pack.roads.find((road) => road.id === id)!) > 0.2, `${id} crosses the lagoon`);
  for (const id of ['third-mainland', 'carter', 'eko', 'falomo', 'link']) assert.ok(pack.roads.find((road) => road.id === id)!.bridge, `${id} is a bridge`);
  for (const id of ['ikorodu', 'badagry-expressway', 'lekki-epe', 'agege', 'oshodi-apapa', 'lagos-ibadan']) assert.ok(pack.roads.find((road) => road.id === id), `${id} exists`);
  // Third Mainland Bridge runs from Oworonshoki to Lagos Island, about ten kilometres.
  const third = pack.roads.find((road) => road.id === 'third-mainland')!;
  let length = 0; for (let i = 1; i < third.points.length; i++) length += distance({ x: third.points[i - 1]![0], z: third.points[i - 1]![1] }, { x: third.points[i]![0], z: third.points[i]![1] });
  assert.ok(length > 80 && length < 130, `${(length / 10).toFixed(1)} km`);
});

test('all 20 local governments hold their 512 estates inside their real boundary; layouts are deterministic', () => {
  const started = performance.now();
  const layouts = pack.lgas.map((lga) => estateLayout(pack, lga.id)!);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 4000, `the layout of all 20 local governments took ${Math.round(elapsed)} ms`);
  const full = new Set(['lagos-island', 'somolu', 'ajeromi-ifelodun', 'apapa']);
  pack.lgas.forEach((lga, index) => {
    const layout = layouts[index]!;
    assert.equal(layout.cells.length, ESTATE.estates, lga.id);
    assert.equal(new Set(layout.cells.map((cell) => `${cell.x.toFixed(4)}:${cell.z.toFixed(4)}`)).size, ESTATE.estates, `${lga.id}: 512 distinct cells`);
    assert.ok(layout.front <= 15 && layout.cells[0]!.size === layout.front, `${lga.id}: the show estate is cell 0`);
    const plots = full.has(lga.id) ? Array.from({ length: ESTATE.plots * ESTATE.streets }, (_, plot) => plot) : [0, ESTATE.plots - 1, ESTATE.plots * (ESTATE.streets - 1), ESTATE.plots * ESTATE.streets - 1, 97];
    for (let estate = 0; estate < ESTATE.estates; estate++) for (const plot of plots) {
      const at = layout.plot(estate, plot);
      assert.ok(inLga(lga, at.x, at.z), `${lga.id}/${estate}/${plot} lies inside the local government`);
      if (plot === 97 || full.has(lga.id)) assert.deepEqual(plotAt(layout, at.x, at.z), { estate, plot }, `${lga.id}/${estate}/${plot} round-trips`);
    }
  });
  // Deterministic: a second, independent build is identical.
  const twin = { ...pack, lgas: [...pack.lgas] };
  for (const lga of pack.lgas.slice(0, 20)) assert.deepEqual(estateLayout(twin, lga.id)!.cells, estateLayout(pack, lga.id)!.cells, `${lga.id} is the same on every device`);
});
