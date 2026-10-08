import test from 'node:test';
import assert from 'node:assert/strict';
import { geographicCircleBounds, groundFootprintRadius, MAX_PREVIEW_RADIUS_METERS, VIEW_EARTH_RADIUS_METERS } from './view-bounds.ts';

test('circle bounds cross the antimeridian without expanding to the whole world', () => {
  const result = geographicCircleBounds([179.99, 0], 3_000);
  assert.ok(result.bounds[0] > result.bounds[2]);
  assert.ok(result.bounds[0] > 179.9 && result.bounds[2] < -179.9);
  assert.equal(result.limited, false);
});

test('circle bounds include all longitudes when the disk reaches a pole', () => {
  const result = geographicCircleBounds([37, 89.99], 2_000);
  assert.deepEqual(result.bounds.slice(0, 3), [-180, result.bounds[1], 180]);
  assert.equal(result.bounds[3], 90);
});

test('radius is capped at the preview limit and ordinary circle edges use great-circle geometry', () => {
  const limited = geographicCircleBounds([0, 0], 50_000);
  assert.equal(limited.radiusMeters, MAX_PREVIEW_RADIUS_METERS);
  assert.equal(limited.limited, true);
  const expectedLatitude = MAX_PREVIEW_RADIUS_METERS / VIEW_EARTH_RADIUS_METERS * 180 / Math.PI;
  assert.ok(Math.abs(limited.bounds[1] + expectedLatitude) < 1e-10);
  assert.ok(Math.abs(limited.bounds[3] - expectedLatitude) < 1e-10);
  assert.ok(limited.bounds[0] < 0 && limited.bounds[2] > 0);
});

test('invalid center and radius are rejected', () => {
  assert.throws(() => geographicCircleBounds([181, 0], 100));
  assert.throws(() => geographicCircleBounds([0, 91], 100));
  assert.throws(() => geographicCircleBounds([0, 0], 0));
});

test('ground footprint covers oblique far corners and reports a horizon beyond the capped preview', () => {
  const camera = { x: 0, y: 100, z: 0 }, target = { x: 0, y: 0, z: -100 };
  const corners = [{ x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: -1, y: -0.1, z: -1 }, { x: 1, y: -0.1, z: -1 }];
  const radius = groundFootprintRadius(camera, target, corners);
  assert.ok(radius >= Math.hypot(1000, 900));
  assert.ok(radius < 1500);
  const horizon = [...corners.slice(0, 3), { x: 1, y: 0, z: -1 }];
  assert.ok(groundFootprintRadius(camera, target, horizon) > MAX_PREVIEW_RADIUS_METERS);
  assert.equal(geographicCircleBounds([0, 0], groundFootprintRadius(camera, target, horizon)).limited, true);
});
