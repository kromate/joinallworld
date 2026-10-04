// OWNER: growth — the Whot rules: the pack, every special card, the options houses differ on, what
// each seat may see, the computer player, and whole games played to the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import whot, { pack, playable, cardValue, cardName, SHAPES, SPECIAL } from './whot.ts';
import { RulesError, cleanOptions, shuffled, withNames, eloChange } from './rules.ts';
import { makeRng } from '../game/util.ts';

const C = (s, n) => ({ s, n });
const DEFAULTS = cleanOptions(whot, {});
/** A position set up by hand: `hands` and the top card are given; the rest of the pack is the market. */
function position({ hands, top, turn = 0, options = {}, market = null, call = null, pick = 0, pickBy = null }) {
  const used = [...hands.flat(), top], rest = pack().filter((card) => { const at = used.findIndex((other) => other.s === card.s && other.n === card.n); if (at < 0) return true; used.splice(at, 1); return false; });
  return { options: cleanOptions(whot, options), hands: hands.map((hand) => hand.slice()), market: market ?? rest, pile: [top], call, turn, pick, pickBy,
    out: hands.map(() => false), moves: hands.map(() => 0), said: hands.map(() => false), last: null, over: null };
}
const rng = () => makeRng('whot-test');
const play = (state, seat, i, shape) => whot.apply(state, seat, { t: 'play', i, ...(shape ? { shape } : {}) }, rng());
const drawCard = (state, seat) => whot.apply(state, seat, { t: 'draw' }, rng());
const refused = (run, pattern) => assert.throws(run, (error) => error instanceof RulesError && pattern.test(error.message));

test('whot: the pack is the 54 Nigerian Whot cards, and a deal is fixed by its seed', () => {
  const cards = pack();
  assert.equal(cards.length, 54);
  const per = (shape) => cards.filter((card) => card.s === shape).map((card) => card.n);
  assert.deepEqual([per('circle'), per('triangle')], [[1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14], [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]]);
  assert.deepEqual([per('cross'), per('square'), per('star'), per('whot')], [[1, 2, 3, 5, 7, 10, 11, 13, 14], [1, 2, 3, 5, 7, 10, 11, 13, 14], [1, 2, 3, 4, 5, 7, 8], [20, 20, 20, 20, 20]]);
  assert.deepEqual([cardValue(C('star', 8)), cardValue(C('circle', 14)), cardValue(C('whot', 20)), cardName(C('star', 4)), cardName(C('whot', 20))], [16, 14, 20, 'Star 4', 'Whot']);
  for (const seats of [2, 3, 4]) for (const hand of [4, 5, 6]) {
    const state = whot.start(seats, makeRng(`deal-${seats}-${hand}`), cleanOptions(whot, { hand }));
    assert.deepEqual(state.hands.map((cards) => cards.length), Array(seats).fill(hand));
    assert.equal(state.hands.flat().length + state.market.length + state.pile.length, 54, 'every card is somewhere');
    assert.equal(SPECIAL[state.pile[0].n], undefined, 'the first card turned up is an ordinary one');
    assert.deepEqual(whot.toMove(state), [0]);
    const key = (card) => `${card.s}${card.n}`;
    assert.deepEqual([...state.hands.flat(), ...state.market, ...state.pile].map(key).sort(), pack().map(key).sort());
  }
  const a = whot.start(3, makeRng('same'), DEFAULTS), b = whot.start(3, makeRng('same'), DEFAULTS), c = whot.start(3, makeRng('other'), DEFAULTS);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.hands, c.hands);
  // A turned-up special goes under the market; the special cards are not all buried with it.
  const specialsInTopHalf = Array.from({ length: 40 }, (_, i) => whot.start(2, makeRng(`s${i}`), DEFAULTS)).filter((state) => state.market.slice(-20).some((card) => SPECIAL[card.n])).length;
  assert.ok(specialsInTopHalf >= 38, 'special cards stay shuffled through the market');
  assert.deepEqual(cleanOptions(whot, { hand: 9, defend: 'stack', market: 'nope', extra: 1 }), { hand: 5, defend: 'stack', market: 'count' });
});

test('whot: match the shape or the number, or go to market; anything else is refused in plain words and changes nothing', () => {
  const state = position({ hands: [[C('circle', 7), C('triangle', 3), C('star', 4), C('cross', 3)], [C('square', 10), C('square', 11)]], top: C('circle', 3) });
  const frozen = structuredClone(state);
  assert.deepEqual(whot.view(state, 0).playable, [0, 1, 3], 'Circle 7 (shape), Triangle 3 and Cross 3 (number)');
  refused(() => play(state, 0, 2), /Star 4 does not go on Circle 3/);
  refused(() => play(state, 1, 0), /not your turn/);
  refused(() => play(state, 0, 9), /do not hold/);
  for (const hostile of [undefined, null, 7, 'play', {}, { t: 'play' }, { t: 'play', i: -1 }, { t: 'play', i: 1.5 }, { t: 'play', i: 0, shape: 'hexagon' }, { t: 'steal' }, { t: 'play', i: '0' }]) assert.throws(() => whot.parseMove(hostile), RulesError);
  assert.deepEqual([whot.parseMove({ t: 'play', i: 2, shape: 'star', extra: 'x' }), whot.parseMove({ t: 'draw', n: 5 })], [{ t: 'play', i: 2, shape: 'star' }, { t: 'draw' }]);
  assert.deepEqual(state, frozen, 'a refused move and a view never change the state');
  const after = play(state, 0, 1);
  assert.deepEqual([after.pile.at(-1), after.hands[0].length, after.turn, state.turn, state.hands[0].length], [C('triangle', 3), 3, 1, 0, 4], 'apply returns a new state');
  const drew = drawCard(after, 1);
  assert.deepEqual([drew.hands[1].length, drew.market.length, drew.turn], [3, after.market.length - 1, 0], 'going to market: one card, and the turn passes');
});

test('whot: Hold On, Suspension, General Market, Pick Two and Pick Three do what they say', () => {
  const three = (hand, top) => position({ hands: [hand, [C('square', 10), C('square', 11)], [C('cross', 10), C('cross', 11)]], top });
  // 1 Hold on: the same player again.
  let state = play(three([C('circle', 1), C('circle', 7), C('circle', 4)], C('circle', 3)), 0, 0);
  assert.deepEqual([state.turn, whot.describe(three([C('circle', 1), C('circle', 7), C('circle', 4)], C('circle', 3)), 0, { t: 'play', i: 0 })], [0, '{0} played Circle 1 · Hold on!']);
  // 8 Suspension: the next player misses a turn.
  state = play(three([C('circle', 8), C('circle', 7), C('circle', 4)], C('circle', 3)), 0, 0);
  assert.equal(state.turn, 2);
  // 14 General market: everyone else draws one; the player goes again.
  state = play(three([C('circle', 14), C('circle', 7), C('circle', 4)], C('circle', 3)), 0, 0);
  assert.deepEqual([state.hands.map((hand) => hand.length), state.turn], [[2, 3, 3], 0]);
  // 2 Pick two: the next player must answer with a 2 or draw two.
  state = play(three([C('circle', 2), C('circle', 7), C('circle', 4)], C('circle', 3)), 0, 0);
  assert.deepEqual([state.turn, state.pick, state.pickBy, whot.view(state, 1).playable], [1, 2, 2, []]);
  refused(() => play(state, 1, 0), /answer with a 2 or go to market for 2/);
  const picked = drawCard(state, 1);
  assert.deepEqual([picked.hands[1].length, picked.pick, picked.turn], [4, 0, 2], 'two cards, and the turn is lost');
  // 5 Pick three.
  state = play(three([C('circle', 5), C('circle', 7), C('circle', 4)], C('circle', 3)), 0, 0);
  assert.deepEqual([state.pick, state.pickBy, drawCard(state, 1).hands[1].length], [3, 5, 5]);
  // A Whot cannot answer a pick: only the same number can.
  const withWhot = position({ hands: [[C('circle', 2), C('circle', 7), C('circle', 4)], [C('whot', 20), C('square', 11)]], top: C('circle', 3) });
  assert.deepEqual(whot.view(play(withWhot, 0, 0), 1).playable, []);
});

test('whot: the contested rules are table options — a defended pick passes on or adds up; a finished market counts or turns over', () => {
  const hands = [[C('circle', 2), C('circle', 7), C('circle', 4)], [C('square', 2), C('square', 11)], [C('cross', 2), C('cross', 11)], [C('star', 3), C('star', 4)]];
  for (const [defend, owed] of [['pass', 2], ['stack', 6]]) {
    let state = play(position({ hands, top: C('circle', 3), options: { defend } }), 0, 0);
    state = play(state, 1, 0); state = play(state, 2, 0);
    assert.deepEqual([state.turn, state.pick], [3, owed], `${defend}: after three 2s the fourth player owes ${owed}`);
    assert.equal(drawCard(state, 3).hands[3].length, 2 + owed);
  }
  // A Pick Three answered with a 2 is not an answer.
  const mixed = play(position({ hands: [[C('circle', 5), C('circle', 7), C('circle', 4)], [C('circle', 2), C('square', 11)]], top: C('circle', 3) }), 0, 0);
  assert.deepEqual(whot.view(mixed, 1).playable, []);
  // The market finishes. 'count': lowest total wins, a star counts double.
  const low = position({ hands: [[C('star', 8), C('circle', 4)], [C('square', 10), C('triangle', 7)]], top: C('cross', 3), market: [] });
  const counted = drawCard(low, 0);
  assert.deepEqual([counted.over.reason, counted.over.winners, counted.over.scores, whot.toMove(counted)], ['count', [1], [20, 17], []]);
  assert.match(withNames(counted.over.text, ['Ada', 'Bola']), /Bola wins on the count with 17/);
  const level = drawCard(position({ hands: [[C('circle', 10)], [C('square', 10)]], top: C('cross', 3), market: [] }), 0);
  assert.deepEqual([level.over.draw, level.over.winners], [true, []]);
  // 'turn': the pile, except its top card, becomes the new market, and play goes on.
  const turning = position({ hands: [[C('star', 8), C('circle', 4)], [C('square', 10), C('triangle', 7)]], top: C('cross', 3), market: [], options: { market: 'turn' } });
  turning.pile = [C('circle', 10), C('circle', 11), C('circle', 12), C('cross', 3)];
  const turned = drawCard(turning, 0);
  assert.deepEqual([turned.over, turned.hands[0].length, turned.market.length, turned.pile, turned.turn], [null, 3, 2, [C('cross', 3)], 1]);
  // With nothing to turn over either, it is counted after all.
  assert.equal(drawCard(position({ hands: [[C('circle', 10)], [C('square', 9 + 1)]], top: C('cross', 3), market: [], options: { market: 'turn' } }), 0).over.reason, 'count');
});

test('whot: a Whot goes on anything and names the shape; the last card wins; "last card" is called for you', () => {
  const state = position({ hands: [[C('whot', 20), C('star', 4), C('star', 7)], [C('square', 10), C('star', 1), C('whot', 20)]], top: C('circle', 3) });
  refused(() => play(state, 0, 0), /Name the shape/);
  const called = play(state, 0, 0, 'star');
  assert.deepEqual([called.call, called.turn, whot.view(called, 1).playable, whot.view(called, 1).call], ['star', 1, [1, 2], 'star'], 'a Star or another Whot follows');
  refused(() => play(called, 1, 0), /Stars were called/);
  const answered = play(called, 1, 1); // Star 1: Hold on
  assert.deepEqual([answered.call, answered.turn], [null, 1]);
  assert.equal(whot.describe(state, 0, { t: 'play', i: 0, shape: 'star' }), '{0} played Whot: “I need Stars”');
  // Down to one card: it is said for the player. Drawing takes it back.
  const two = position({ hands: [[C('circle', 7), C('circle', 4)], [C('square', 10), C('square', 11)]], top: C('circle', 3) });
  assert.equal(whot.describe(two, 0, { t: 'play', i: 0 }), '{0} played Circle 7 · Last card!');
  const last = play(two, 0, 0);
  assert.deepEqual([last.said, whot.view(last, null).said], [[true, false], [true, false]]);
  // The last card ends it at once, whatever it is — also a Whot with no shape named, and a Pick Two.
  for (const final of [C('circle', 4), C('whot', 20), C('circle', 2), C('circle', 14)]) {
    const won = play(position({ hands: [[final], [C('square', 10), C('square', 11)]], top: C('circle', 3) }), 0, 0);
    assert.deepEqual([won.over.winners, won.over.reason, won.hands[1].length, whot.toMove(won)], [[0], 'empty-hand', 2, []], cardName(final));
    refused(() => drawCard(won, 1), /game is over/);
  }
});

test('whot: a seat sees its own hand and only counts of everything else; a watcher sees no hand; the market’s order never leaves', () => {
  const state = whot.start(3, makeRng('hidden'), DEFAULTS);
  const mine = whot.view(state, 1), watcher = whot.view(state, null);
  assert.deepEqual([mine.hand, watcher.hand, mine.counts, mine.market, typeof mine.market], [state.hands[1], null, [5, 5, 5], state.market.length, 'number']);
  assert.equal(watcher.playable.length + whot.view(state, 1).playable.length + whot.view(state, 2).playable.length, 0, 'only the seat to move is told what it may play');
  for (const seat of [0, 1, 2, null]) {
    const text = JSON.stringify(whot.view(state, seat));
    assert.equal(text.includes('"hands"') || text.includes('"shown":[') , false);
    // Deal the unseen cards any other way: what this seat is sent is byte-for-byte the same.
    const other = structuredClone(state);
    const unseen = shuffled([...other.market, ...other.hands.flatMap((hand, index) => (index === seat ? [] : hand))], makeRng('reshuffle'));
    other.hands = other.hands.map((hand, index) => (index === seat ? hand : unseen.splice(0, hand.length)));
    other.market = unseen;
    assert.equal(JSON.stringify(whot.view(other, seat)), text, `seat ${seat}`);
  }
  // The computer player uses only what its seat is shown: reshuffle the unseen cards and it plays the same move.
  const other = structuredClone(state);
  const unseen = shuffled([...other.market, ...other.hands[1], ...other.hands[2]], makeRng('again'));
  other.hands[1] = unseen.splice(0, 5); other.hands[2] = unseen.splice(0, 5); other.market = unseen;
  // (It looks at how many cards the next player holds, which is public, never at which.)
  assert.deepEqual(whot.bot(other, 0, makeRng('bot')), whot.bot(state, 0, makeRng('bot')));
  // Once the game is over the hands are laid on the table for everyone.
  const over = whot.forfeit(whot.forfeit(state, 1), 2);
  assert.deepEqual([over.over.winners, whot.view(over, null).shown.map((hand) => hand.length)], [[0], [5, 0, 0]]);
});

test('whot: leaving and running out of time — the others play on, the last one left wins, no card is lost', () => {
  const state = whot.start(3, makeRng('leave'), DEFAULTS);
  const left = whot.forfeit(state, 0);
  assert.deepEqual([left.out, left.turn, left.hands[0], left.market.length, left.over], [[true, false, false], 1, [], state.market.length + 5, null], 'the leaver’s cards go under the market and the turn moves on');
  assert.equal(left.hands.flat().length + left.market.length + left.pile.length, 54);
  assert.equal(whot.forfeit(left, 0), left, 'leaving twice changes nothing');
  const alone = whot.forfeit(left, 2);
  assert.deepEqual([alone.over.winners, alone.over.reason], [[1], 'forfeit']);
  assert.match(withNames(alone.over.text, ['Ada', 'Bola', 'Chidi']), /Chidi left the table\. Bola wins\./);
  // Suspension skips a seat that has left.
  const skip = whot.forfeit(position({ hands: [[C('circle', 8), C('circle', 7), C('circle', 4)], [C('square', 10)], [C('cross', 10)], [C('star', 3)]], top: C('circle', 3) }), 1);
  assert.equal(play(skip, 0, 0).turn, 3, 'the next player still at the table is the one suspended');
  // The clock: the seat goes to market, or takes what it owes.
  const timed = whot.timeout(state, 0, rng());
  assert.deepEqual([timed.hands[0].length, timed.turn, whot.moved(timed)], [6, 1, [1, 0, 0]]);
  const owing = play(position({ hands: [[C('circle', 2), C('circle', 7), C('circle', 4)], [C('square', 2), C('square', 11)]], top: C('circle', 3) }), 0, 0);
  assert.equal(whot.timeout(owing, 1, rng()).hands[1].length, 4, 'a seat that times out under a Pick Two takes the two cards even though it could have answered');
});

test('whot: the computer never offers an illegal move and every game ends by the rules — 600 games at 2, 3 and 4 seats and every option', () => {
  let games = 0, moves = 0, longest = 0;
  const reasons = {};
  for (const seats of [2, 3, 4]) for (const hand of [4, 5, 6]) for (const defend of ['pass', 'stack']) for (const market of ['count', 'turn']) {
    for (let round = 0; round < 17; round++) {
      const seed = `selfplay-${seats}-${hand}-${defend}-${market}-${round}`, options = cleanOptions(whot, { hand, defend, market });
      let state = whot.start(seats, makeRng(seed), options), n = 0;
      while (!whot.outcome(state)) {
        const [seat] = whot.toMove(state);
        const move = whot.parseMove(whot.bot(state, seat, makeRng(`${seed}|bot|${n}`)));
        state = whot.apply(state, seat, move, makeRng(`${seed}|${n}`)); // throws on an illegal move
        assert.equal(state.hands.flat().length + state.market.length + state.pile.length, 54, 'no card is ever made or lost');
        assert.ok(++n < 3000, `${seed} did not end`);
      }
      const outcome = whot.outcome(state);
      assert.ok(outcome.draw ? outcome.winners.length === 0 : outcome.winners.length === 1);
      assert.ok(outcome.reason === 'count' || state.hands[outcome.winners[0]].length === 0);
      reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1; games += 1; moves += n; longest = Math.max(longest, n);
    }
  }
  assert.equal(games, 612);
  assert.ok(reasons['empty-hand'] > 100 && reasons.count > 20, `both endings happen (${JSON.stringify(reasons)})`);
  assert.ok(moves / games < 200 && longest < 3000, `a game is short: ${Math.round(moves / games)} moves on average, ${longest} at most`);
  // The same seed gives the same game, move for move.
  const replay = (seed) => { let state = whot.start(2, makeRng(seed), DEFAULTS), n = 0; const log = []; while (!state.over && n < 500) { const [seat] = whot.toMove(state); const move = whot.bot(state, seat, makeRng(`${seed}|bot|${n}`)); log.push(whot.describe(state, seat, move)); state = whot.apply(state, seat, move, makeRng(`${seed}|${n++}`)); } return log; };
  assert.deepEqual(replay('same-game'), replay('same-game'));
  // It answers a pick when it can, and finishes when it can.
  const answer = whot.bot(play(position({ hands: [[C('circle', 2), C('circle', 7), C('circle', 4)], [C('square', 2), C('square', 11)]], top: C('circle', 3) }), 0, 0), 1, makeRng('x'));
  assert.deepEqual(answer, { t: 'play', i: 0 });
  assert.deepEqual(whot.bot(position({ hands: [[C('whot', 20)], [C('square', 2)]], top: C('circle', 3) }), 0, makeRng('x')).t, 'play');
  const started = Date.now();
  for (let i = 0; i < 2000; i++) whot.bot(whot.start(4, makeRng(`t${i}`), DEFAULTS), 0, makeRng(`b${i}`));
  assert.ok(Date.now() - started < 2000, 'the computer answers in well under a millisecond');
});

test('table rules are pure: no clock, no random source and no I/O anywhere under src/tables', async () => {
  const dir = new URL('.', import.meta.url);
  for (const file of (await readdir(dir)).filter((name) => name.endsWith('.js') && !name.endsWith('.test.js') && !['client.js'].includes(name) && !name.endsWith('-board.js'))) {
    const code = (await readFile(new URL(file, dir), 'utf8')).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /Math\.random\(|Date\.now\(|new Date\(|from\s+['"]node:|\bfetch\(|\bprocess\.|document\.|window\./, file);
  }
  assert.ok(playable && SHAPES.length === 5);
  assert.deepEqual(eloChange({ rating: 1200, played: 0 }, { rating: 1200, played: 0 }, 1), [20, -20]);
  assert.deepEqual(eloChange({ rating: 1400, played: 40 }, { rating: 1200, played: 12 }, 0), [-12, 18]);
});
