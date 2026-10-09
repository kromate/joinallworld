import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPoseCheckpointUnchanged } from './floor-visibility-contract.mjs';

test('permits a visual-only floor toggle at one paused pose', () => {
  const checkpoint = '[{"q":[0,0,0,1],"p":[0,0,0]}]';
  assert.equal(assertPoseCheckpointUnchanged(checkpoint, checkpoint), true);
});

test('rejects a floor toggle that coincides with a rig-pose change', () => {
  assert.throws(() => assertPoseCheckpointUnchanged('paused-a', 'paused-b'), /changed the sampled actor pose/);
  assert.throws(() => assertPoseCheckpointUnchanged(undefined, 'paused-a'), /changed the sampled actor pose/);
});
