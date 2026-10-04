// Keeps the two-player script (scripts/two-players.mjs, `npm run two-players`) green: two device
// sessions with sockets against the real server on a controlled clock — presence, friendship,
// messages, a house visit, a gift, an election, a sea plot and the gem hunt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTwoPlayers } from '../scripts/two-players.mjs';

test('the two-player script runs to the end with every assertion holding', async () => {
  const lines = [];
  const result = await runTwoPlayers({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 11);
  assert.ok(lines.some((line) => line.startsWith('Two players complete')));
});
