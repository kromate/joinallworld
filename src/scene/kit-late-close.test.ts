import test from 'node:test';
import assert from 'node:assert/strict';
import { createKit } from './kit.ts';
test('Kit close is idempotent and late cache registrations release immediately', () => {
  const kit = createKit(); let early = 0, late = 0, cancelled = 0;
  kit.onDispose(() => early++);
  const unregister = kit.onDispose(() => cancelled++); assert.equal(unregister(), true);
  kit.dispose(); kit.dispose();
  const lateUnregister = kit.onDispose(() => late++);
  assert.equal(early, 1); assert.equal(late, 1); assert.equal(cancelled, 0);
  assert.equal(lateUnregister(), false);
});
