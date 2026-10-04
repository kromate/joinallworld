// Keeps the scripted first day (scripts/first-day.mjs, `npm run first-day`) green: one new life
// played end to end over HTTP against the real server, with exact wallet and need values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFirstDay } from '../scripts/first-day.mjs';

test('the scripted first day runs to the end with every assertion holding', async () => {
  const lines = [];
  const result = await runFirstDay({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 19);
  assert.equal(result.cash, 88450); // ₦150 more than before: the free automatic commute replaced the Danfo to work
  assert.ok(lines.some((line) => line.startsWith('First day complete')));
});
