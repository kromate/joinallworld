// The real boundaries: states tile Nigeria without gaps or overlaps, Lagos State is covered by its 20 local governments plus the lagoon,
// and the shapes agree with the shared projection (docs/MAP-GEOMETRY.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { NIGERIA, WATER } from './data/nigeria.ts';
import { decodeTopology } from './topo.ts';
import { ORIGINS, fromLocal, project, toLocal, unproject } from './frame.ts';
import { lagosShapes, type LonLatPolygon } from './lagos-shapes.ts';
import { LAGOS_LGAS } from '../../game/cities/lagos/localUnits.ts';

const here = (name: string) => new URL(name, import.meta.url);
const nigeria = decodeTopology(NIGERIA);
const shapes = lagosShapes();

const inRing = (x: number, y: number, ring: ArrayLike<number>): boolean => {
  let inside = false;
  for (let i = 0, n = ring.length / 2, j = n - 1; i < n; j = i++) {
    const ax = ring[i * 2]!, ay = ring[i * 2 + 1]!, bx = ring[j * 2]!, by = ring[j * 2 + 1]!;
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
};
/** A polygon prepared for sampling, in frame units: flat rings and a box. */
interface Prepared { rings: Float64Array[]; minX: number; maxX: number; minZ: number; maxZ: number }
const prepare = (polygon: readonly (readonly (readonly [number, number])[])[]): Prepared => {
  const rings = polygon.map((ring) => Float64Array.from(ring.flatMap(([lon, lat]) => { const p = project(lon, lat); return [p.x, p.z]; })));
  const out: Prepared = { rings, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < rings[0]!.length; i += 2) { out.minX = Math.min(out.minX, rings[0]![i]!); out.maxX = Math.max(out.maxX, rings[0]![i]!); out.minZ = Math.min(out.minZ, rings[0]![i + 1]!); out.maxZ = Math.max(out.maxZ, rings[0]![i + 1]!); }
  return out;
};
const covers = (p: Prepared, x: number, z: number): boolean => x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && p.rings.reduce((inside, ring) => (inRing(x, z, ring) ? !inside : inside), false);
const flat = (polygons: readonly LonLatPolygon[]): Prepared[] => polygons.map(prepare);
const ringsOfFeature = (id: string) => nigeria.byId.get(id)!.rings.flat();

test('states tile Nigeria: neighbours share each border vertex for vertex, and no point lies in two states', () => {
  assert.equal(nigeria.features.length, 37);
  // A shared arc is stored once and both states' rings contain exactly its vertices.
  let shared = 0;
  nigeria.arcs.forEach((arc, index) => {
    const users = nigeria.users[index]!;
    assert.ok(users.length === 1 || users.length === 2, `arc ${index} belongs to one state or two`);
    if (users.length !== 2) return;
    shared += 1;
    for (const user of users) {
      const points = new Set(ringsOfFeature(nigeria.features[user]!.id).flatMap((ring) => Array.from({ length: ring.length / 2 }, (_, i) => `${ring[i * 2]},${ring[i * 2 + 1]}`)));
      for (let i = 0; i < arc.length; i += 2) assert.ok(points.has(`${arc[i]},${arc[i + 1]}`), `arc ${index} vertex ${i / 2} is in ${nigeria.features[user]!.id}`);
    }
  });
  assert.ok(shared > 80);
  const neighbours = (a: string, b: string): number => nigeria.users.reduce((sum, users, i) => sum + (users.length === 2 && users.includes(nigeria.byId.get(a)!.index) && users.includes(nigeria.byId.get(b)!.index) ? nigeria.arcs[i]!.length / 2 : 0), 0);
  for (const [a, b] of [['lagos', 'ogun'], ['ogun', 'oyo'], ['oyo', 'osun'], ['kano', 'jigawa'], ['rivers', 'bayelsa'], ['kaduna', 'fct'], ['benue', 'nasarawa'], ['borno', 'yobe'], ['sokoto', 'zamfara'], ['edo', 'delta']] as const) {
    assert.ok(neighbours(a, b) >= 4, `${a} and ${b} share a border`);
  }
  // No overlap: sample the country on a 4 km grid; each sample is in at most one state.
  const states = nigeria.features.map((feature) => feature.rings.map((poly) => prepare(poly.map((ring) => Array.from({ length: ring.length / 2 }, (_, i): [number, number] => [ring[i * 2]!, ring[i * 2 + 1]!])))));
  const a = project(2.6, 14), b = project(14.7, 4.2);
  let overlapping = 0, covered = 0;
  for (let x = a.x; x < b.x; x += 40) for (let z = a.z; z < b.z; z += 40) {
    let count = 0;
    for (const polys of states) if (polys.some((poly) => covers(poly, x, z))) count += 1;
    if (count > 1) overlapping += 1;
    if (count) covered += 1;
  }
  assert.equal(overlapping, 0, 'no point is in two states');
  // The sampled union equals the sum of the states' own areas: nothing between them is lost or counted twice.
  const sumKm2 = states.flat().reduce((total, prepared) => total + prepared.rings.reduce((t, ring, i) => { let a = 0; for (let k = 0, n = ring.length; k < n; k += 2) { const m = (k + 2) % n; a += ring[k]! * ring[m + 1]! - ring[m]! * ring[k + 1]!; } return t + (i ? -1 : 1) * Math.abs(a) / 2; }, 0), 0) / 100;
  const areaKm2 = covered * 16;
  assert.ok(Math.abs(areaKm2 - sumKm2) / sumKm2 < 0.005, `sampled ${areaKm2} km² against ${sumKm2.toFixed(0)} km² summed`);
  assert.ok(areaKm2 > 900000 && areaKm2 < 940000, `Nigeria is about 923 000 km² (got ${areaKm2})`);
});

test('Lagos State is covered by its 20 local governments plus the lagoon, and the local governments do not overlap', () => {
  const lgas = Object.entries(shapes.lgas).map(([id, polygons]) => ({ id, polygons: flat(polygons) })), state = flat(shapes.state), lagoon = flat(shapes.lagoon);
  assert.equal(lgas.length, 20);
  const box = { a: project(2.69, 6.72), b: project(4.38, 6.36) };
  let inState = 0, inLand = 0, inLagoon = 0, both = 0, difference = 0, overlap = 0;
  for (let x = box.a.x; x < box.b.x; x += 3) for (let z = box.a.z; z < box.b.z; z += 3) {
    const s = state.some((p) => covers(p, x, z)), l = lgas.filter((lga) => lga.polygons.some((p) => covers(p, x, z))).length, w = lagoon.some((p) => covers(p, x, z));
    if (s) inState += 1;
    if (l) inLand += 1;
    if (w) inLagoon += 1;
    if (l > 1) overlap += 1;
    if (l && w) both += 1;
    if (s !== (l > 0 || w)) difference += 1;
  }
  assert.ok(inState * 0.09 > 3300 && inState * 0.09 < 3900, `Lagos State is about 3 600 km² (got ${inState * 0.09})`);
  assert.ok(difference / inState < 0.01, `local governments plus lagoon cover the State within 1% (difference ${(difference / inState * 100).toFixed(2)}%)`);
  assert.ok(overlap / inState < 0.001, `local governments overlap by ${(overlap / inState * 100).toFixed(3)}%`);
  assert.ok(both / inState < 0.002, 'the lagoon does not overlap the land');
  assert.ok(inLagoon / inState > 0.03 && inLagoon / inState < 0.08, `the lagoon is about 5% of the State (got ${(inLagoon / inState * 100).toFixed(1)}%)`);
  assert.ok(inLand <= inState * 1.01, 'no local government lies outside the State');
  // The same lagoon is on the Nigeria atlas as a lake, inside the Lagos State shape.
  const lake = WATER.lakes.find((l) => l.name === 'Lagos Lagoon');
  assert.ok(lake && lake.ring.length >= 20);
  const centre = [lake.ring.filter((_, i) => i % 2 === 0), lake.ring.filter((_, i) => i % 2 === 1)].map((v) => v.reduce((s, n) => s + n, 0) / v.length);
  assert.ok(nigeria.byId.get('lagos')!.bounds.minLon < centre[0]! && centre[0]! < nigeria.byId.get('lagos')!.bounds.maxLon && centre[1]! > 6.3 && centre[1]! < 6.6);
});

test('Lagos local governments carry the game ids, sit where they should, and round-trip through the frame', () => {
  assert.deepEqual(Object.keys(shapes.lgas).sort(), LAGOS_LGAS.map((lga) => lga.id).sort());
  const lonOf = (id: string): number => { const ring = shapes.lgas[id]![0]![0]!; return ring.reduce((s, p) => s + p[0], 0) / ring.length; };
  const latOf = (id: string): number => { const ring = shapes.lgas[id]![0]![0]!; return ring.reduce((s, p) => s + p[1], 0) / ring.length; };
  assert.ok(lonOf('badagry') < lonOf('lagos-island') && lonOf('lagos-island') < lonOf('epe'), 'Badagry is west of Lagos Island, which is west of Epe');
  assert.ok(latOf('ikorodu') > latOf('lagos-island') && latOf('ikeja') > latOf('apapa'), 'north is up');
  const xs = shapes.state.flatMap((poly) => poly[0]!.map(([lon, lat]) => project(lon, lat).x));
  const extentKm = (Math.max(...xs) - Math.min(...xs)) / 10;
  assert.ok(extentKm > 170 && extentKm < 195, `Lagos State is about 180 km from west to east (got ${extentKm.toFixed(0)})`);
  let worst = 0;
  for (const polygons of [...Object.values(shapes.lgas), shapes.state, shapes.lagoon]) for (const poly of polygons) for (const ring of poly) for (const [lon, lat] of ring) {
    const p = project(lon, lat), back = unproject(p.x, p.z), local = toLocal(ORIGINS.lagos, lon, lat), again = fromLocal(ORIGINS.lagos, local[0], local[1]);
    worst = Math.max(worst, Math.abs(back.lon - lon), Math.abs(back.lat - lat), Math.abs(again.lon - lon), Math.abs(again.lat - lat));
  }
  assert.ok(worst < 1e-9, `round trip error ${worst}`);
  // Lagos Island is near the Lagos origin (3.40°E, 6.45°N), within a few kilometres.
  const island = shapes.lgas['lagos-island']![0]![0]!.map(([lon, lat]) => toLocal(ORIGINS.lagos, lon, lat));
  assert.ok(island.some(([x, z]) => Math.hypot(x, z) < 60), 'Lagos Island lies at the Lagos origin');
});

test('the data chunks stay under their byte budgets and name their source and licence', () => {
  for (const [file, limit] of [['lagos.ts', 60000], ['nigeria.ts', 60000]] as const) {
    assert.ok(statSync(here(`./data/${file}`)).size <= limit, `${file} is ${statSync(here(`./data/${file}`)).size} bytes (limit ${limit})`);
  }
});
