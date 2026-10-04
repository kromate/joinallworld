// OWNER: world — tests for this owner's systems and content.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife } from '../life.js';
import { systems } from './registry.js';
import { makeContext } from './util.js';

const ctx = makeContext({ now: Date.UTC(2026, 0, 5, 8), cityId: 'lagos', seed: 'world-test' });

test('world systems are registered and survive hostile saves', () => {
  for (const id of ['travel', 'health']) {
    const system = systems().find(item => item.id === id);
    assert.ok(system, id);
    for (const junk of ['text', 7, [], { nested: { deep: true } }]) {
      const state = createLife({ [id]: junk }, ctx);
      for (const key of system.stateKeys) assert.notEqual(state[key], junk, `${id}.${key} must be rebuilt, not copied`);
    }
  }
  const state = createLife(null, ctx);
  assert.equal(advanceLife(state, 60, { ...ctx, now: ctx.now + 60000 }).ok, true);
  assert.equal(typeof viewLife(state, ctx), 'object');
  assert.equal(typeof dispatch, 'function');
});
