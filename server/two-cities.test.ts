// Keeps the two-cities script (scripts/two-cities.ts, `npm run two-cities`) green: one character goes from Lagos to Ibadan by bus and back by
// train against the real server on a controlled clock, with each fare charged once and the Lagos home still there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSkippedLegs, runThreePlaces, runTwoCities } from '../scripts/two-cities.ts';

test('the two-cities script runs to the end with every assertion holding', { timeout: 30000 }, async () => {
  const lines: string[] = [];
  const result = await runTwoCities({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 9);
  assert.deepEqual(result.fares, { bus: 3500, train: 9000 });
  assert.ok(lines.some((line) => line.startsWith('Two cities complete')));
});

test('the three-places run: Lagos, Ota, Abeokuta, Ibadan and home, each fare charged once and the Lagos house intact', { timeout: 30000 }, async () => {
  const lines: string[] = [];
  const result = await runThreePlaces({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 10);
  assert.deepEqual(result.fares, [2000, 2500, 4000, 3500]);
  assert.ok(lines.some((line) => line.startsWith('Three places complete')));
});

test('the skipped legs: Lagos to Ibadan and back by bus, the first skip free and the second charged once', { timeout: 30000 }, async () => {
  const lines: string[] = [];
  const result = await runSkippedLegs({ log: (line) => lines.push(line) });
  assert.deepEqual([result.steps, result.fare, result.free, result.charged], [3, 3500, 0, 900]);
  assert.ok(lines.some((line) => line.startsWith('Skipped legs complete')));
});
