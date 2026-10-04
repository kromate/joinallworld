// Keeps the two-player script (scripts/two-players.ts, `npm run two-players`) green: two device
// sessions with sockets against the real server on a controlled clock — presence, friendship,
// messages, a house visit, a gift, an election, a sea plot and the gem hunt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTwoPlayers } from '../scripts/two-players.ts';

test('the two-player script runs to the end with every assertion holding', async () => {
  const lines: string[] = [];
  const result = await runTwoPlayers({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 12);
  assert.ok(lines.some((line) => line.startsWith('Two players complete')));
});
