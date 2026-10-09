import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPinnedStageToolingSha, interactiveTeachingBindings, resolveInteractiveTeachingStarts } from './stage-capability-policy.mjs';

test('teaching starts default off and worker bindings omit the flag when disabled', () => {
  assert.equal(resolveInteractiveTeachingStarts(undefined, undefined), '0');
  assert.deepEqual(interactiveTeachingBindings('0'), {});
});

test('only the explicit literal 1 enables the worker binding', () => {
  assert.equal(resolveInteractiveTeachingStarts('1', undefined), '1');
  assert.deepEqual(interactiveTeachingBindings('1'), { INTERACTIVE_TEACHING_STARTS: '1' });
  assert.equal(resolveInteractiveTeachingStarts('0', '1'), '0');
  assert.equal(resolveInteractiveTeachingStarts('1', '0'), '1');
});

test('an omitted selection is always off, including resumed and legacy checkpoints', () => {
  assert.equal(resolveInteractiveTeachingStarts(undefined, '1'), '0');
  assert.equal(resolveInteractiveTeachingStarts(undefined, '0'), '0');
  assert.equal(resolveInteractiveTeachingStarts(undefined, undefined), '0');
});

test('rejects nonliteral requested and checkpoint values', () => {
  for (const value of ['true', 'false', 'yes', '2', '', true, false, null]) {
    assert.throws(() => resolveInteractiveTeachingStarts(value, undefined), /literal 1 or 0/);
    assert.throws(() => resolveInteractiveTeachingStarts(undefined, value), /literal 1 or 0/);
  }
});

test('requires exact explicit pins for the running stage helper and policy helper', () => {
  const expected = 'a'.repeat(64);
  assert.equal(assertPinnedStageToolingSha(expected, expected, 'stage helper'), expected);
  assert.throws(() => assertPinnedStageToolingSha('bad', expected, 'stage helper'), /64 lowercase hexadecimal/);
  assert.throws(() => assertPinnedStageToolingSha(expected, 'b'.repeat(64), 'stage helper'), /does not match/);
  assert.throws(() => assertPinnedStageToolingSha(expected, 'c'.repeat(64), 'stage capability policy'), /does not match/);
  assert.throws(() => assertPinnedStageToolingSha(expected, undefined, 'stage policy'), /actual SHA-256 is invalid/);
});
