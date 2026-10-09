import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCurrentPublishedActorTrace } from './load-trace-contract.mjs';

const lifecycle = (generation, actorId, resolved = true) => [
  { generation, actorId, stage: 'selection-start' },
  { generation, actorId, stage: 'body-load-start' },
  { generation, actorId, stage: 'body-load-resolved', requestGenerationCurrent: resolved },
  { generation, actorId, stage: 'recipe-start' },
  { generation, actorId, stage: 'recipe-resolved', requestGenerationCurrent: resolved },
  { generation, actorId, stage: 'actor-published', bodyKey: 'male' },
];

test('accepts the getter trace for the newest completely published actor generation', () => {
  const result = requireCurrentPublishedActorTrace([...lifecycle(1, 'prior'), ...lifecycle(2, 'current')], 'current');
  assert.equal(result.generation, 2);
  assert.equal(result.events.at(-1).stage, 'actor-published');
});

test('rejects a stale actor publication when a newer generation started', () => {
  assert.throws(() => requireCurrentPublishedActorTrace([
    ...lifecycle(1, 'current'), { generation: 2, actorId: 'other', stage: 'selection-start' },
  ], 'current'), /does not belong solely/);
});

test('rejects absent, failed, and superseded load traces', () => {
  assert.throws(() => requireCurrentPublishedActorTrace(undefined, 'current'), /missing or malformed/);
  assert.throws(() => requireCurrentPublishedActorTrace([
    ...lifecycle(1, 'current'), { generation: 1, actorId: 'current', stage: 'load-failed' },
  ], 'current'), /did not complete publication/);
  assert.throws(() => requireCurrentPublishedActorTrace(lifecycle(1, 'current', false), 'current'), /stale or lacks/);
});
