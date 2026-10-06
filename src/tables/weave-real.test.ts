import { test } from 'node:test';
import assert from 'node:assert/strict';
import rules, { warm } from './weave.ts';
import { BAG_SIZE } from './weave-letters.ts';
import { tilesOnBoard } from './weave-board.ts';

await warm();

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('with the real word list a bot game finishes, every move is legal and every tile is accounted for', () => {
  const r = seeded(21);
  let state = rules.start(3, r, { speed: 'relaxed' });
  let moves = 0;
  while (!state.over && moves < 300) {
    const seat = rules.toMove(state)[0] as number;
    state = rules.apply(state, seat, rules.bot(state, seat, r), r);
    assert.equal(state.bag.length + state.racks.reduce((n, rack) => n + rack.length, 0) + tilesOnBoard(state.board), BAG_SIZE);
    moves++;
  }
  assert.ok(state.over);
  assert.ok(state.history.filter((turn) => turn.kind === 'play').length > 10);
});

test('the real word list knows plain words and refuses nonsense', () => {
  const state = rules.start(2, seeded(1), { speed: 'relaxed' });
  const chosen = { ...state, racks: [['s', 't', 'o', 'r', 'm', 'x', 'y'], state.racks[1] as string[]] };
  const tiles = [...'storm'].map((l, i) => ({ r: 6, c: 4 + i, l }));
  assert.doesNotThrow(() => rules.apply(chosen, 0, { t: 'play', tiles }, seeded(1)));
  assert.throws(() => rules.apply(chosen, 0, { t: 'play', tiles: [...'ymxs'].map((l, i) => ({ r: 6, c: 4 + i, l })) }, seeded(1)), /not in the word list/);
});
