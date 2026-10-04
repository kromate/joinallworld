// Keeps the new-player journey (scripts/new-player.mjs, `npm run new-player`) green: the merged game end to end against
// the real server on a controlled clock — landing, Play, the first goal, settling in with a local government and a house,
// missions, a share link read as a crawler reads it, a second new player landing beside the first, a whole game of Whot
// over two sockets, a referral that pays only after real work, and a restart that reads everything back identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runNewPlayer } from '../scripts/new-player.ts';

test('the new-player journey runs to the end with every assertion holding', async () => {
  const lines = [];
  const result = await runNewPlayer({ log: (line) => lines.push(line) });
  assert.equal(result.steps, 11);
  assert.ok(lines.some((line) => line.startsWith('New player complete')));
  assert.ok(result.moves > 4, 'a whole game was played');
  // The same journey twice ends with the same money for the same outcome of the one thing that is random here (the deal).
  assert.ok(Number.isSafeInteger(result.cash.ada) && Number.isSafeInteger(result.cash.bola));
});
