import test from 'node:test';
import assert from 'node:assert/strict';
import { ByteLru } from './cache.ts';

test('ByteLru refreshes recency, accounts bytes, and disposes evicted values', () => {
  const disposed: string[] = [];
  const cache = new ByteLru<string, string>(5, value => disposed.push(value));
  cache.set('a', 'A', 3);
  cache.set('b', 'B', 2);
  assert.equal(cache.get('a'), 'A');
  cache.set('c', 'C', 2);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.byteLength, 5);
  assert.deepEqual(disposed, ['B']);
  cache.clear();
  assert.equal(cache.byteLength, 0);
  assert.deepEqual(disposed, ['B', 'A', 'C']);
});
