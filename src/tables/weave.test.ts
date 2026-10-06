import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RulesError } from './rules.ts';
import { makeWeave, side, EXCHANGE_MIN_BAG, SCORELESS_LIMIT } from './weave-core.ts';
import type { WeaveMove, WeaveState } from './weave-core.ts';
import { dictionaryOf } from './weave-dict.ts';
import { emptyBoard, placeTiles, tilesOnBoard } from './weave-board.ts';
import type { Placement } from './weave-board.ts';
import { BAG_SIZE, fullBag } from './weave-letters.ts';
import { TEST_WORD_LIST } from './weave.testwords.ts';

const dict = dictionaryOf(TEST_WORD_LIST);
const rules = makeWeave(dict);
const OPTIONS = { speed: 'relaxed' as const };

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const spell = (word: string, r: number, c: number, across = true): Placement[] => [...word].map((l, i) => ({ r: across ? r : r + i, c: across ? c + i : c, l }));
const play = (tiles: Placement[]): WeaveMove => ({ t: 'play', tiles });
const total = (state: WeaveState): number => state.bag.length + state.racks.reduce((n, rack) => n + rack.length, 0) + tilesOnBoard(state.board);
const allTiles = (state: WeaveState): string[] => {
  const onBoard = state.board.join('').replace(/\./g, '').split('').map((ch) => (ch >= 'A' && ch <= 'Z' ? '?' : ch));
  return [...state.bag, ...state.racks.flat(), ...onBoard].sort();
};
const WHOLE_BAG = fullBag().sort();

/** A state with the given racks and cloth; the bag is whatever is left of the 98 tiles. */
function setup(racks: string[][], boardTiles: Placement[] = []): WeaveState {
  const state = rules.start(racks.length, seeded(1), OPTIONS);
  const pool = fullBag();
  const take = (tile: string) => { const at = pool.indexOf(tile); assert.ok(at >= 0, `tile ${tile} is in the bag`); pool.splice(at, 1); };
  for (const rack of racks) rack.forEach(take);
  for (const p of boardTiles) take(p.blank ? '?' : p.l);
  return { ...state, board: placeTiles(emptyBoard(), boardTiles), racks: racks.map((r) => r.slice()), bag: pool };
}
const rack = (letters: string): string[] => letters.split('');
const refusal = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (e) => e instanceof RulesError && pattern.test(e.message));
const rng = seeded(7);

test('start: 98 tiles in all, racks of seven, seat 0 to move', () => {
  for (const seats of [2, 3, 4]) {
    const state = rules.start(seats, seeded(seats), OPTIONS);
    assert.equal(state.racks.length, seats);
    for (const r of state.racks) assert.equal(r.length, 7);
    assert.equal(state.bag.length, BAG_SIZE - 7 * seats);
    assert.equal(total(state), BAG_SIZE);
    assert.deepEqual(allTiles(state), WHOLE_BAG);
    assert.deepEqual(rules.toMove(state), [0]);
    assert.equal(rules.outcome(state), null);
  }
  assert.deepEqual(rules.seats, { min: 2, max: 4 });
  assert.equal(rules.turnSeconds, 120);
  assert.equal(rules.id, 'weave');
});

test('the same seed deals the same game; another seed another', () => {
  const a = rules.start(2, seeded(5), OPTIONS), b = rules.start(2, seeded(5), OPTIONS), c = rules.start(2, seeded(6), OPTIONS);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.racks, c.racks);
});

test('first move: through the centre, in a line, with tiles you hold', () => {
  const state = setup([rack('stormab'), rack('abcdefg')]);
  refusal(() => rules.apply(state, 0, play(spell('storm', 0, 0)), rng), /centre/);
  refusal(() => rules.apply(state, 0, play([{ r: 6, c: 6, l: 's' }, { r: 7, c: 7, l: 't' }]), rng), /one row or one column/);
  refusal(() => rules.apply(state, 0, play([{ r: 6, c: 5, l: 's' }, { r: 6, c: 7, l: 't' }]), rng), /no gaps/);
  refusal(() => rules.apply(state, 0, play([{ r: 6, c: 6, l: 's' }]), rng), /two letters/);
  refusal(() => rules.apply(state, 0, play(spell('stork', 6, 4)), rng), /do not hold/);
  refusal(() => rules.apply(state, 0, play(spell('storms', 6, 3)), rng), /do not hold/);
  refusal(() => rules.apply(state, 0, { t: 'play', tiles: [] }, rng), /at least one/);
  refusal(() => rules.apply(state, 1, play(spell('bad', 6, 5)), rng), /not your turn/);
  const after = rules.apply(state, 0, play(spell('storm', 6, 4)), rng);
  assert.equal(after.board[6]?.slice(4, 9), 'storm');
  assert.deepEqual(rules.toMove(after), [1]);
  assert.equal(after.racks[0]?.length, 7);
  assert.equal(total(after), BAG_SIZE);
});

test('words are checked and the refusal names the word', () => {
  const state = setup([rack('xyzabcd'), rack('abcdefg')]);
  refusal(() => rules.apply(state, 0, play(spell('xyz', 6, 5)), rng), /^'xyz' is not in the word list\.$/);
});

test('later plays must join the cloth, use free squares and stay on the board', () => {
  const state = setup([rack('abcdefg'), rack('inoeatr')], spell('storm', 6, 4));
  const one = { ...state, turn: 1 };
  refusal(() => rules.apply(one, 1, play(spell('tine', 1, 1)), rng), /join/);
  refusal(() => rules.apply(one, 1, play([{ r: 6, c: 4, l: 'a' }, { r: 7, c: 4, l: 'n' }]), rng), /already holds/);
  refusal(() => rules.apply(one, 1, play([{ r: 20, c: 4, l: 'a' }]), rng), /off the board/);
});

test('cross-words are formed and validated, and all of them score', () => {
  const state = { ...setup([rack('abcdefg'), rack('abeinor')], spell('storm', 6, 4)), turn: 1 };
  // "ab" under "st" makes "sa" down, which is not a word.
  refusal(() => rules.apply(state, 1, play(spell('ab', 7, 4)), rng), /^'sa' is not in the word list\.$/);
  // "an" under "to" makes "an" across, "ta" and "on" down.
  const three = rules.apply(state, 1, play(spell('an', 7, 5)), rng);
  const turn = three.history.at(-1);
  assert.deepEqual(turn?.words.map((w) => w.w), ['an', 'ta', 'on']);
  assert.equal(turn?.points, turn?.words.reduce((n, w) => n + w.p, 0));
  assert.equal(three.scores[1], turn?.points);
  assert.equal(three.scores[0], 0);
});

test('a single tile forms words in both directions', () => {
  const cloth = [...spell('at', 6, 6), { r: 7, c: 5, l: 'h' }];
  const state = setup([rack('iabcdef'), rack('abcdefg')], cloth);
  const next = rules.apply(state, 0, play([{ r: 7, c: 6, l: 'i' }]), rng);
  assert.deepEqual(next.history.at(-1)?.words.map((w) => w.w).sort(), ['ai', 'hi']);
  // A tile that makes one bad word is refused whichever way.
  refusal(() => rules.apply(state, 0, play([{ r: 7, c: 6, l: 'b' }]), rng), /is not in the word list/);
});

test('seven tiles in one play earn the bonus; the rack is refilled', () => {
  const state = setup([rack('stormed'), rack('abcdefg')]);
  const next = rules.apply(state, 0, play(spell('stormed', 6, 3)), rng);
  // s(2) t(2) o(1) r(1, centre double word) m(3) e(2) d(4) = 15, doubled, plus 30.
  assert.equal(next.scores[0], 60);
  assert.equal(next.racks[0]?.length, 7);
  assert.equal(next.bag.length, state.bag.length - 7);
});

test('a blank plays as the letter named, scores nothing, and needs a blank in the rack', () => {
  const state = setup([rack('stor?xy'), rack('abcdefg')]);
  const tiles = [...spell('stor', 6, 4), { r: 6, c: 8, l: 'm', blank: true }];
  const next = rules.apply(state, 0, play(tiles), rng);
  // s(2) t(1) o(1) r(1) and a blank on a double letter (0): 5, doubled for the centre.
  assert.equal(next.scores[0], 10);
  assert.equal(next.board[6]?.slice(4, 9), 'storM');
  assert.equal(next.history.at(-1)?.points, 10);
  // Without the flag the real letter is needed; with the flag a blank is.
  refusal(() => rules.apply(state, 0, play(spell('storm', 6, 4)), rng), /do not hold/);
  const noBlank = setup([rack('stormxy'), rack('abcdefg')]);
  refusal(() => rules.apply(noBlank, 0, play(tiles), rng), /do not hold/);
});

test('a blank on the cloth is worth nothing when a later word uses it', () => {
  const cloth = [...spell('sto', 6, 4), { r: 6, c: 7, l: 'r', blank: true }];
  const state = { ...setup([rack('abcdefg'), rack('mxyzqwv')], cloth), turn: 1 };
  const next = rules.apply(state, 1, play([{ r: 6, c: 8, l: 'm' }]), rng);
  // s t o (premium squares are not repeated) 1 + 1 + 1, the blank 0, and the new m on a double letter 6: 9.
  assert.equal(next.history.at(-1)?.points, 3 + 0 + 6);
});

test('exchange: allowed with enough in the bag, silent in the log, and the tiles stay in play', () => {
  const state = setup([rack('qzxjkvw'), rack('abcdefg')]);
  assert.ok(state.bag.length >= EXCHANGE_MIN_BAG);
  const next = rules.apply(state, 0, { t: 'exchange', letters: ['q', 'z', 'x'] }, rng);
  assert.equal(next.racks[0]?.length, 7);
  assert.equal(total(next), BAG_SIZE);
  assert.deepEqual(allTiles(next), WHOLE_BAG);
  assert.deepEqual(next.history.at(-1), { seat: 0, kind: 'exchange', words: [], points: 0, tiles: 3 });
  assert.equal(next.scoreless, 1);
  assert.deepEqual(rules.toMove(next), [1]);
  assert.equal(rules.describe(state, 0, { t: 'exchange', letters: ['q', 'z', 'x'] }), '{0} swaps 3 tiles');
  assert.equal(rules.describe(state, 0, { t: 'exchange', letters: ['q'] }), '{0} swaps 1 tile');
  assert.equal(JSON.stringify(next.history).includes('"q"'), false);
});

test('exchange: a blank may be swapped; tiles must be held; a short bag refuses', () => {
  const state = setup([rack('abcde?f'), rack('abcdefg')]);
  assert.equal(rules.apply(state, 0, { t: 'exchange', letters: ['?'] }, rng).racks[0]?.length, 7);
  refusal(() => rules.apply(state, 0, { t: 'exchange', letters: ['z'] }, rng), /do not hold/);
  refusal(() => rules.apply(state, 0, { t: 'exchange', letters: [] }, rng), /Choose/);
  const low = { ...state, bag: state.bag.slice(0, EXCHANGE_MIN_BAG - 1) };
  refusal(() => rules.apply(low, 0, { t: 'exchange', letters: ['a'] }, rng), /fewer than 7/);
  const exactly = { ...state, bag: state.bag.slice(0, EXCHANGE_MIN_BAG) };
  assert.equal(rules.apply(exactly, 0, { t: 'exchange', letters: ['a'] }, rng).bag.length, EXCHANGE_MIN_BAG);
});

test('pass counts as a scoreless turn; a play resets the count', () => {
  const state = setup([rack('stormab'), rack('abcdefg')]);
  const passed = rules.apply(state, 0, { t: 'pass' }, rng);
  assert.equal(passed.scoreless, 1);
  assert.equal(rules.moved(passed)[0], 1);
  const played = rules.apply(passed, 1, play(spell('bad', 6, 5)), rng);
  assert.equal(played.scoreless, 0);
});

test('six scoreless turns end the game; each player loses their own rack', () => {
  let state = setup([rack('zqabcde'), rack('eeeeeee')]);
  for (let i = 0; i < SCORELESS_LIMIT - 1; i++) {
    state = rules.apply(state, i % 2, { t: 'pass' }, rng);
    assert.equal(state.over, null);
  }
  state = rules.apply(state, 1, { t: 'pass' }, rng);
  assert.ok(state.over);
  // z 10 + q 10 + a 1 + b 3 + c 3 + d 2 + e 1 = 30; seven e = 7.
  assert.deepEqual(state.scores, [-30, -7]);
  assert.deepEqual(state.over?.winners, [1]);
  assert.equal(state.over?.reason, 'count');
  assert.deepEqual(rules.toMove(state), []);
  assert.deepEqual(rules.outcome(state)?.scores, [-30, -7]);
  refusal(() => rules.apply(state, 0, { t: 'pass' }, rng), /over/);
});

test('equal scores are a draw', () => {
  let state = setup([rack('abcdefg'), rack('abcdefg')]);
  for (let i = 0; i < SCORELESS_LIMIT; i++) state = rules.apply(state, i % 2, { t: 'pass' }, rng);
  assert.equal(state.over?.draw, true);
  assert.deepEqual(state.over?.winners, []);
});

test('emptying the rack with the bag empty ends the game and settles the racks', () => {
  const state = { ...setup([rack('at'), rack('zqe')]), bag: [] };
  const next = rules.apply(state, 0, play(spell('at', 6, 6)), rng);
  // "at": 1 + 1 on the centre double word = 4; the other rack is 10 + 10 + 1 = 21.
  assert.deepEqual(next.scores, [4 + 21, -21]);
  assert.deepEqual(next.over?.winners, [0]);
  assert.equal(next.over?.reason, 'empty-hand');
  assert.deepEqual(rules.toMove(next), []);
});

test('the game goes on when the rack is empty but the bag is not', () => {
  const state = setup([rack('at'), rack('zqe')]);
  const next = rules.apply({ ...state, bag: state.bag }, 0, play(spell('at', 6, 6)), rng);
  assert.equal(next.over, null);
  assert.equal(next.racks[0]?.length, 7);
});

test('view hides the bag and other racks until the game is over', () => {
  const state = setup([rack('stormab'), rack('zqxjkvw'), rack('eeeeaaa')]);
  const mine = rules.view(state, 1);
  assert.equal(mine.rack?.join(''), 'zqxjkvw');
  assert.deepEqual(mine.counts, [7, 7, 7]);
  assert.equal(mine.bagCount, state.bag.length);
  assert.equal(mine.racks, null);
  const text = JSON.stringify(mine);
  assert.equal('bag' in mine, false);
  assert.equal(text.includes('stormab'), false);
  assert.equal(text.includes('eeeeaaa'), false);
  assert.equal(rules.view(state, null).rack, null);
  assert.equal(rules.view(state, 5).rack, null);
  assert.equal(rules.view(state, null).turn, 0);
  // Mutating a view never touches the state.
  mine.rack?.push('q');
  mine.board[0] = 'x';
  assert.equal(state.racks[1]?.length, 7);
  assert.equal(state.board[0], '.'.repeat(13));
  let over = state;
  for (let i = 0; i < SCORELESS_LIMIT; i++) over = rules.apply(over, i % 3, { t: 'pass' }, rng);
  const final = rules.view(over, null);
  assert.deepEqual(final.racks, over.racks);
  assert.equal(final.turn, null);
});

test('view keeps the last 30 turns', () => {
  let state = setup([rack('abcdefg'), rack('abcdefg')]);
  state = { ...state, history: Array.from({ length: 45 }, (_, i) => ({ seat: i % 2, kind: 'pass' as const, words: [], points: 0, tiles: 0 })) };
  assert.equal(rules.view(state, 0).history.length, 30);
});

test('turn order for three and four players', () => {
  for (const seats of [3, 4]) {
    let state = rules.start(seats, seeded(9), OPTIONS);
    const order: number[] = [];
    for (let i = 0; i < seats + 1; i++) { order.push(rules.toMove(state)[0] as number); state = rules.apply(state, rules.toMove(state)[0] as number, { t: 'pass' }, rng); }
    assert.deepEqual(order, Array.from({ length: seats + 1 }, (_, i) => i % seats));
  }
});

test('resign: any seat, any time; the others play on and the last one wins', () => {
  assert.equal(side({ t: 'resign' }), true);
  assert.equal(side({ t: 'pass' }), false);
  assert.equal(rules.side({ t: 'play', tiles: [] }), false);
  const state = rules.start(3, seeded(3), OPTIONS);
  const out = rules.apply(state, 2, { t: 'resign' }, rng);
  assert.deepEqual(out.out, [false, false, true]);
  assert.equal(out.over, null);
  assert.equal(out.racks[2]?.length, 0);
  assert.equal(total(out), BAG_SIZE);
  assert.deepEqual(allTiles(out), WHOLE_BAG);
  assert.deepEqual(rules.toMove(out), [0]);
  // Seat 2 is skipped in the order.
  const one = rules.apply(out, 0, { t: 'pass' }, rng);
  const two = rules.apply(one, 1, { t: 'pass' }, rng);
  assert.deepEqual(rules.toMove(two), [0]);
  refusal(() => rules.apply(two, 2, { t: 'pass' }, rng), /not in this game/);
  const alone = rules.forfeit(two, 1);
  assert.deepEqual(alone.over?.winners, [0]);
  assert.equal(alone.over?.reason, 'forfeit');
  assert.deepEqual(rules.toMove(alone), []);
  assert.equal(rules.forfeit(alone, 0), alone);
  refusal(() => rules.apply(alone, 0, { t: 'resign' }, rng), /over/);
});

test('forfeit on your own turn passes the move on', () => {
  const state = rules.start(3, seeded(4), OPTIONS);
  const next = rules.forfeit(state, 0);
  assert.deepEqual(rules.toMove(next), [1]);
  assert.equal(next.over, null);
  assert.equal(rules.forfeit(next, 0), next);
  const resigned = rules.apply(state, 0, { t: 'resign' }, rng);
  assert.deepEqual(resigned, next);
});

test('timeout passes the turn without counting as a real move', () => {
  const state = rules.start(2, seeded(2), OPTIONS);
  const next = rules.timeout(state, 0, rng);
  assert.deepEqual(rules.toMove(next), [1]);
  assert.equal(next.scoreless, 1);
  assert.deepEqual(rules.moved(next), [0, 0]);
  assert.equal(rules.timeout(state, 1, rng), state);
  assert.deepEqual(state, rules.start(2, seeded(2), OPTIONS));
  let cur = state;
  for (let i = 0; i < SCORELESS_LIMIT; i++) cur = rules.timeout(cur, i % 2, rng);
  assert.ok(cur.over);
  assert.equal(rules.timeout(cur, 0, rng), cur);
});

test('moved counts real plays, swaps and passes per seat', () => {
  let state = rules.start(2, seeded(2), OPTIONS);
  state = rules.apply(state, 0, { t: 'pass' }, rng);
  state = rules.apply(state, 1, { t: 'exchange', letters: [state.racks[1]?.[0] as string] }, rng);
  state = rules.apply(state, 0, { t: 'pass' }, rng);
  assert.deepEqual(rules.moved(state), [2, 1]);
});

test('parseMove accepts well-formed moves and refuses the rest', () => {
  assert.deepEqual(rules.parseMove({ t: 'pass' }), { t: 'pass' });
  assert.deepEqual(rules.parseMove({ t: 'resign', junk: 1 }), { t: 'resign' });
  assert.deepEqual(rules.parseMove({ t: 'exchange', letters: ['A', '?'] }), { t: 'exchange', letters: ['a', '?'] });
  assert.deepEqual(rules.parseMove({ t: 'play', tiles: [{ r: 6, c: 6, l: 'A', blank: true }, { r: 6, c: 7, l: 'b', blank: false }] }),
    { t: 'play', tiles: [{ r: 6, c: 6, l: 'a', blank: true }, { r: 6, c: 7, l: 'b' }] });
  for (const bad of [null, 5, {}, { t: 'dance' }, { t: 'play' }, { t: 'play', tiles: [] }, { t: 'play', tiles: [{ r: 1.5, c: 2, l: 'a' }] },
    { t: 'play', tiles: [{ r: 1, c: 2, l: 'ab' }] }, { t: 'play', tiles: [{ r: 1, c: 2, l: '?' }] }, { t: 'play', tiles: [null] },
    { t: 'play', tiles: Array.from({ length: 8 }, (_, i) => ({ r: 6, c: i, l: 'a' })) },
    { t: 'exchange' }, { t: 'exchange', letters: [] }, { t: 'exchange', letters: ['ab'] }, { t: 'exchange', letters: [1] }]) {
    assert.throws(() => rules.parseMove(bad), RulesError);
  }
});

test('describe: plays, passes and resigning are public lines', () => {
  const state = setup([rack('stormab'), rack('abcdefg')]);
  assert.equal(rules.describe(state, 0, play(spell('storm', 6, 4))), '{0} plays STORM for 22');
  assert.equal(rules.describe(state, 1, { t: 'pass' }), '{1} passes');
  assert.equal(rules.describe(state, 2, { t: 'resign' }), '{2} resigns');
});

test('apply never changes its input', () => {
  const state = setup([rack('stormab'), rack('abcdefg')]);
  const before = JSON.stringify(state);
  const moves: WeaveMove[] = [play(spell('storm', 6, 4)), { t: 'pass' }, { t: 'exchange', letters: ['a', 'b'] }, { t: 'resign' }];
  for (const move of moves) { rules.apply(state, 0, move, rng); assert.equal(JSON.stringify(state), before); }
  rules.timeout(state, 0, rng);
  rules.forfeit(state, 1);
  rules.view(state, 0);
  assert.equal(JSON.stringify(state), before);
});

// ---------------------------------------------------------------------------------------------
// The computer player.
// ---------------------------------------------------------------------------------------------

function botGame(seats: number, seed: number, cap = 400) {
  const r = seeded(seed);
  let state = rules.start(seats, r, OPTIONS);
  let plays = 0, moves = 0;
  while (!state.over && moves < cap) {
    const seat = rules.toMove(state)[0] as number;
    const frozen = JSON.stringify(state);
    const move = rules.bot(state, seat, r);
    assert.equal(JSON.stringify(state), frozen, 'the bot does not change the state');
    state = rules.apply(state, seat, rules.parseMove(JSON.parse(JSON.stringify(move))), r); // a legal move, even after a trip through JSON
    assert.equal(JSON.stringify(state).length > 0, true);
    assert.equal(total(state), BAG_SIZE);
    assert.deepEqual(allTiles(state), WHOLE_BAG);
    for (const hand of state.racks) assert.ok(hand.length <= 7);
    if (move.t === 'play') plays++;
    moves++;
  }
  return { state, plays, moves };
}

test('bot games finish within the cap with legal moves and exact tile accounting', () => {
  for (const [seats, seed] of [[2, 1], [2, 2], [2, 3], [3, 4], [3, 5], [4, 6], [4, 7]] as const) {
    const { state, plays, moves } = botGame(seats, seed);
    assert.ok(state.over, `game ${seats}/${seed} finished in ${moves} moves`);
    assert.ok(plays > 3, `game ${seats}/${seed} had plays`);
    assert.equal(state.over?.scores.length, seats);
  }
});

test('the bot is deterministic given the generator and plays the first move through the centre', () => {
  const state = rules.start(2, seeded(11), OPTIONS);
  const a = rules.bot(state, 0, seeded(3)), b = rules.bot(state, 0, seeded(3));
  assert.deepEqual(a, b);
  assert.equal(a.t, 'play');
  if (a.t === 'play') {
    assert.ok(a.tiles.some((p) => p.r === 6 && p.c === 6));
    assert.doesNotThrow(() => rules.apply(state, 0, a, rng));
  }
});

test('the bot swaps when it cannot play, and passes when it cannot swap', () => {
  const stuck = setup([rack('vvxzjkq'), rack('abcdefg')]);
  const move = rules.bot(stuck, 0, seeded(1));
  assert.equal(move.t, 'exchange');
  if (move.t === 'exchange') assert.doesNotThrow(() => rules.apply(stuck, 0, move, rng));
  const low = { ...stuck, bag: stuck.bag.slice(0, 3) };
  assert.deepEqual(rules.bot(low, 0, seeded(1)), { t: 'pass' });
});

test('the bot finds a high scoring play when one is there', () => {
  const state = setup([rack('stormed'), rack('abcdefg')]);
  // A generator that always answers 0 takes the best-ranked play: all seven tiles, at least 60 points.
  const move = rules.bot(state, 0, () => 0);
  const next = rules.apply(state, 0, move, rng);
  assert.ok((next.scores[0] as number) >= 60, `scored ${next.scores[0]}`);
  assert.equal(next.history.at(-1)?.tiles, 7);
});
