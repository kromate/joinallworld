// Keeps the scripted first minute (scripts/first-minute.mjs) green: a brand-new player from Play to a
// settled life over HTTP against the real server — first reward inside the minute, 'life.started' once,
// totals equal to the old flow's, reload identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFirstMinute } from '../scripts/first-minute.mjs';

test('the scripted first minute runs to the end with every assertion holding', async () => {
  const lines = [];
  const result = await runFirstMinute({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 9);
  assert.ok(result.firstRewardMs <= 60000, 'first reward inside a minute of landing');
  assert.deepEqual([result.firstRewardMs, result.serverFirstRewardMs], [13000, 9000]);
  assert.ok(lines.some((line) => line.startsWith('First minute complete')));
});
