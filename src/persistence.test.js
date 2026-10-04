import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from './game.js';
import { loadProgress, saveProgress } from './persistence.js';

function storageWith(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test('legacy browser cash, delivery progress and name survive migration and round trip', () => {
  const storage = storageWith({
    'allworld-save-v1': JSON.stringify({ cash: 9500, deliveries: 3, job: 'dropoff', health: 64 }),
    'allworld-name': '  Ada  ',
  });
  const loaded = loadProgress(storage);
  assert.equal(loaded.game.cash, 9500);
  assert.equal(loaded.game.deliveries, 3);
  assert.equal(loaded.game.job, 'dropoff');
  assert.equal(loaded.name, 'Ada');
  assert.deepEqual(loaded.position, { x: 0, z: 16 });
  loaded.position = { x: -28, z: 16 };
  assert.equal(saveProgress(storage, loaded), true);
  assert.deepEqual(loadProgress(storage), loaded);
  assert.equal(JSON.parse(storage.getItem('allworld-save-v1')).cash, 9500);
});

test('current progress takes precedence while malformed envelopes fall back to legacy', () => {
  const storage = storageWith({
    'allworld-save-v1': JSON.stringify({ cash: 8000 }),
    'allworld-name': 'Legacy',
    'allworld-progress-v1': '{broken',
  });
  assert.equal(loadProgress(storage).game.cash, 8000);
  for (const corrupt of ['null', '[]', '42', '{"game":"invalid"}']) {
    storage.setItem('allworld-progress-v1', corrupt);
    assert.equal(loadProgress(storage).game.cash, 8000);
  }
  saveProgress(storage, { game: createGame({ cash: 11000 }), name: 'Current', position: { x: 32, z: 22 } });
  const loaded = loadProgress(storage);
  assert.equal(loaded.game.cash, 11000);
  assert.equal(loaded.name, 'Current');
  assert.deepEqual(loaded.position, { x: 32, z: 22 });
});

test('corrupted fields are sanitized and names are trimmed and limited', () => {
  const storage = storageWith({
    'allworld-progress-v1': JSON.stringify({
      game: { cash: -100, health: 400, job: 'invalid' },
      name: '   ' + 'a'.repeat(50) + '   ',
      position: { x: '20', z: 10 },
    }),
  });
  const loaded = loadProgress(storage);
  assert.equal(loaded.game.cash, 5000);
  assert.equal(loaded.game.health, 100);
  assert.equal(loaded.game.job, null);
  assert.equal(loaded.name, 'a'.repeat(24));
  assert.deepEqual(loaded.position, { x: 0, z: 16 });
  saveProgress(storage, { game: loaded.game, name: '   ', position: null });
  assert.equal(loadProgress(storage).name, 'New Lagosian');
});

test('positions outside the world or in water reset; bridge positions and land persist', () => {
  const storage = storageWith();
  const game = createGame();
  for (const position of [
    { x: 56, z: 16 }, { x: -56, z: 16 }, { x: 0, z: 41 }, { x: 0, z: -41 },
    { x: NaN, z: 16 }, { x: 0, z: Infinity }, { x: 0, z: -3.3 }, { x: 0, z: 7.2 },
    { x: -12, z: 0 }, { x: 23, z: 0 },
  ]) {
    saveProgress(storage, { game, position });
    assert.deepEqual(loadProgress(storage).position, { x: 0, z: 16 });
  }
  for (const position of [
    { x: -15, z: 0 }, { x: 20, z: 0 }, { x: -14, z: 3 }, { x: 21, z: 3 },
    { x: -55, z: -40 }, { x: 55, z: 40 }, { x: 0, z: -3.4 }, { x: 0, z: 7.3 },
  ]) {
    saveProgress(storage, { game, position });
    assert.deepEqual(loadProgress(storage).position, position);
  }
});

test('blocked, absent and quota-limited storage never throw or falsely report success', () => {
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  const defaults = { game: createGame(), name: 'New Lagosian', position: { x: 0, z: 16 } };
  for (const storage of [blocked, null, undefined, {}]) {
    assert.deepEqual(loadProgress(storage), defaults);
    assert.equal(saveProgress(storage, defaults), false);
  }
  const storage = storageWith({ 'allworld-progress-v1': JSON.stringify(defaults) });
  storage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.equal(saveProgress(storage, { ...defaults, name: 'Changed' }), false);
  assert.deepEqual(loadProgress(storage), defaults);
});
