import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_LAT, FRAME_LON, ORIGINS, UNITS_PER_KM, fromLocal, originAt, project, toLocal, unproject } from './frame.ts';

test('the frame round-trips lon/lat', () => {
  for (const [lon, lat] of [[3.4, 6.45], [2.7, 6.4], [13.9, 13.8], [8, 9], [4.37, 4.0]] as const) {
    const p = project(lon, lat), back = unproject(p.x, p.z);
    assert.ok(Math.abs(back.lon - lon) < 1e-9 && Math.abs(back.lat - lat) < 1e-9);
  }
  assert.deepEqual(project(FRAME_LON, FRAME_LAT), { x: 0, z: 0 });
});

test('north is up and east is right, at 100 m a unit', () => {
  const o = project(8, 9), north = project(8, 10), east = project(9, 9);
  assert.ok(north.z < o.z && east.x > o.x);
  assert.ok(Math.abs((o.z - north.z) / UNITS_PER_KM - 111.195) < 0.01);
  assert.ok(Math.abs((east.x - o.x) / UNITS_PER_KM - 111.195 * Math.cos(9 * Math.PI / 180)) < 0.01);
});

test('a local map plus its origin is the frame, and local round-trips', () => {
  const origin = ORIGINS.lagos, [x, z] = toLocal(origin, 3.395, 6.455), p = project(3.395, 6.455);
  assert.ok(Math.abs(x + origin.x - p.x) < 1e-9 && Math.abs(z + origin.z - p.z) < 1e-9);
  const back = fromLocal(origin, x, z);
  assert.ok(Math.abs(back.lon - 3.395) < 1e-9 && Math.abs(back.lat - 6.455) < 1e-9);
  assert.ok(Number.isInteger(origin.x) && Number.isInteger(origin.z) && Number.isInteger(originAt(7, 7).x));
});
