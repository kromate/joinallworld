import test from 'node:test';
import assert from 'node:assert/strict';
import { boundsCenter, fromLocal, toLocal } from './geo.ts';

test('solar and camera centres follow geographic bounds across the antimeridian', () => {
  assert.deepEqual(boundsCenter([179.998, -16.8004, -179.998, -16.7964]), [-180, -16.7984]);
  assert.deepEqual(boundsCenter([-180, -90, 180, -60]), [0, -75]);
  const [longitude, latitude] = boundsCenter([-0.207, 5.552, -0.203, 5.556]);
  assert.ok(Math.abs(longitude + 0.205) < 1e-10);
  assert.ok(Math.abs(latitude - 5.554) < 1e-10);
  assert.throws(() => boundsCenter([20, 10, 20, 15]), /valid WGS84/);
});

test('WGS84 equatorial longitude reference and scene axes', () => {
  const origin = { longitude: 0, latitude: 0, height: 0 };
  const east = toLocal({ longitude: 1, latitude: 0, height: 0 }, origin);
  // ECEF-to-ENU is a chord projected into the tangent plane (not arc distance).
  assert.ok(Math.abs(east.x - 111_313.84) < 0.02);
  assert.ok(Math.abs(east.y + 971.42) < 0.02);
  assert.ok(Math.abs(east.z) < 0.02);
  const north = toLocal({ longitude: 0, latitude: 1, height: 0 }, origin);
  assert.ok(north.z < 0);
  assert.ok(Math.abs(north.z + 110_568.77) < 0.1);
});

test('forward and inverse handle dateline crossing, height, and high latitude', () => {
  for (const origin of [
    { longitude: 179.9, latitude: 10, height: 42 },
    { longitude: 20, latitude: 89.5, height: 5 },
  ]) {
    const point = { longitude: -179.8, latitude: origin.latitude + 0.01, height: 100 };
    const recovered = fromLocal(toLocal(point, origin), origin);
    assert.ok(Math.abs((((recovered.longitude - point.longitude + 540) % 360) - 180)) < 1e-8);
    assert.ok(Math.abs(recovered.latitude - point.latitude) < 1e-8);
    assert.ok(Math.abs(recovered.height - point.height) < 0.01);
  }
});

test('inverse remains stable at both geographic poles and preserves ellipsoid height', () => {
  for (const [latitude, height] of [[90, 125], [-90, 850]] as const) {
    const origin = { longitude: 73, latitude, height: 20 };
    const local = { x: 0, y: height - origin.height, z: 0 };
    const recovered = fromLocal(local, origin);
    assert.equal(recovered.latitude, latitude);
    assert.ok(Math.abs(recovered.height - height) < 1e-8);
    const back = toLocal(recovered, origin);
    assert.ok(Math.abs(back.x - local.x) < 1e-8);
    assert.ok(Math.abs(back.y - local.y) < 1e-8);
    assert.ok(Math.abs(back.z - local.z) < 1e-8);
  }
});

test('London metre-scale frame agrees with WGS84 tangent scale', () => {
  const origin = { longitude: -0.1278, latitude: 51.5074, height: 0 };
  const point = { longitude: -0.12779, latitude: 51.50741, height: 0 };
  const local = toLocal(point, origin);
  // WGS84 radii of curvature at London give approximately 0.696 m east
  // and 1.113 m north for these angular offsets.
  assert.ok(Math.abs(local.x - 0.696) < 0.002);
  assert.ok(Math.abs(local.z + 1.113) < 0.002);
});

test('invalid anchor and local coordinates fail explicitly', () => {
  const origin = { longitude: 0, latitude: 0, height: 0 };
  assert.throws(() => toLocal({ longitude: 0, latitude: 91, height: 0 }, origin), RangeError);
  assert.throws(() => toLocal({ longitude: Infinity, latitude: 0, height: 0 }, origin), RangeError);
  assert.throws(() => fromLocal({ x: 0, y: NaN, z: 0 }, origin), RangeError);
});
