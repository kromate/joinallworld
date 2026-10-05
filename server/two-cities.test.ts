// Keeps the two-cities script (scripts/two-cities.ts, `npm run two-cities`) green: one character goes from Lagos to Ibadan by bus and back by
// train against the real server on a controlled clock, with each fare charged once and the Lagos home still there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTwoCities } from '../scripts/two-cities.ts';

test('the two-cities script runs to the end with every assertion holding', { timeout: 30000 }, async () => {
  const lines: string[] = [];
  const result = await runTwoCities({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 9);
  assert.deepEqual(result.fares, { bus: 3500, train: 9000 });
  assert.ok(lines.some((line) => line.startsWith('Two cities complete')));
});
