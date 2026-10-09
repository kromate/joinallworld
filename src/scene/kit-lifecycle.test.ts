import assert from 'node:assert/strict';
import test from 'node:test';
import { createKit } from './kit.ts';

test('kit disposal is idempotent and cleanup registered after disposal runs immediately', () => {
  const kit = createKit();
  let calls = 0;
  kit.onDispose(() => { calls++; });
  kit.dispose();
  kit.dispose();
  assert.equal(calls, 1);
  let lateCalls = 0;
  const withdraw = kit.onDispose(() => { lateCalls++; });
  assert.equal(lateCalls, 1);
  assert.equal(withdraw(), false);
});
