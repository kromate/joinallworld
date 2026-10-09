import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeComplementSkinWeightAttribute } from './neck-complement-v7.ts';

test('fractional barycentric weights remain normalized when source GLB uses normalized Uint8', () => {
  const source = new THREE.BufferAttribute(new Uint8Array([128, 64, 63, 0]), 4, true);
  const expected = [0.501, 0.249, 0.25, 0];
  const actual = makeComplementSkinWeightAttribute(expected, source);
  assert.ok(actual.array instanceof Float32Array);
  assert.equal(actual.normalized, false);
  const decoded = [actual.getX(0), actual.getY(0), actual.getZ(0), actual.getW(0)];
  assert.ok(Math.abs(decoded.reduce((sum, weight) => sum + weight, 0) - 1) <= 1e-6);
  for (let channel = 0; channel < 4; channel++) assert.ok(Math.abs(decoded[channel]! - expected[channel]!) <= 1e-7);
});

test('fractional barycentric weights remain normalized when source GLB uses normalized Uint16', () => {
  const source = new THREE.BufferAttribute(new Uint16Array([32768, 16384, 16383, 0]), 4, true);
  const expected = [0.375, 0.125, 0.5, 0];
  const actual = makeComplementSkinWeightAttribute(expected, source);
  assert.ok(actual.array instanceof Float32Array);
  assert.equal(actual.normalized, false);
  assert.ok(Math.abs(actual.getX(0) + actual.getY(0) + actual.getZ(0) + actual.getW(0) - 1) <= 1e-6);
});

test('invalid or non-normalized generated weights fail closed', () => {
  const source = new THREE.BufferAttribute(new Uint8Array([255, 0, 0, 0]), 4, true);
  assert.throws(() => makeComplementSkinWeightAttribute([0, 0, 0, 0], source), /do not normalize/);
  assert.throws(() => makeComplementSkinWeightAttribute([1.1, -0.1, 0, 0], source), /do not normalize/);
});
