// OWNER: growth — the penalty shoot-out rules: simultaneous secret choices, the count, sudden death.
import test from 'node:test';
import assert from 'node:assert/strict';
import penalty, { SUDDEN_ROUNDS } from './penalty.ts';
import { RulesError, cleanOptions, withNames } from './rules.ts';
import { makeRng } from '../game/util.ts';

const start = (options = {}) => penalty.start(2, makeRng('p'), cleanOptions(penalty, options));
/** One kick: `shot` by the kicker, `dive` by the keeper. */
function kick(state, shot, dive) {
  const kicker = state.kick % 2;
  const first = penalty.apply(state, kicker, { z: shot });
  return penalty.apply(first, 1 - kicker, { z: dive });
}
const sequence = (state, kicks) => kicks.reduce((now, [shot, dive]) => (now.over ? now : kick(now, shot, dive)), state);
const GOAL = [0, 2], SAVE = [1, 1];

test('penalty: both choose in secret; the same side is a save, a different side a goal; seats take turns to shoot', () => {
  let state = start();
  assert.deepEqual([penalty.toMove(state), penalty.view(state, 0).kicker, penalty.seats, penalty.turnSeconds], [[0, 1], 0, { min: 2, max: 2 }, 15]);
  const one = penalty.apply(state, 1, { z: 2 }); // the keeper may choose first
  assert.deepEqual([penalty.toMove(one), state.picks], [[0], [null, null]], 'apply returns a new state');
  // Until both are in, nobody is told what the other chose: not the other seat, not a watcher, not the log.
  assert.deepEqual([penalty.view(one, 0).chosen, penalty.view(one, 0).mine, penalty.view(one, 1).mine, penalty.view(one, null).mine], [[false, true], null, 2, null]);
  for (const seat of [0, null]) assert.equal(JSON.stringify(penalty.view(one, seat)).includes('"picks"'), false);
  assert.equal(penalty.describe(one, 1, { z: 2 }), '{1} is ready');
  assert.throws(() => penalty.apply(one, 1, { z: 0 }), (error) => error instanceof RulesError && /Wait for the other player/.test(error.message));
  state = penalty.apply(one, 0, { z: 0 });
  assert.deepEqual([state.goals, state.taken, state.history, state.kick, penalty.view(state, 1).kicker, state.picks], [[1, 0], [1, 0], [{ kicker: 0, shot: 0, dive: 2, goal: true }], 1, 1, [null, null]]);
  assert.match(withNames(penalty.report(one, state)[0], ['Ada', 'Bola']), /^GOAL! Ada shot left, Bola went right\. 1–0$/);
  const saved = kick(state, 1, 1);
  assert.deepEqual([saved.goals, saved.taken], [[1, 0], [1, 1]]);
  assert.match(withNames(penalty.report(state, saved)[0], ['Ada', 'Bola']), /^SAVED! Ada guessed centre\. 1–0$/);
  assert.deepEqual(penalty.report(state, penalty.apply(state, 0, { z: 1 })), [], 'nothing is reported until the kick is decided');
  for (const hostile of [undefined, null, 3, -1, '1', { z: 3 }, { z: 1.5 }, { z: '0' }, {}]) assert.throws(() => penalty.parseMove(hostile), RulesError);
  assert.deepEqual(penalty.parseMove({ z: 2, extra: true }), { z: 2 });
});

test('penalty: five kicks each, ended early once it cannot be caught; level goes to sudden death; ten level rounds are a draw', () => {
  // 3–0 after three kicks each: with two left each, seat 1 cannot catch up... not yet (3–0, two left): it can only reach 2. Over.
  const early = sequence(start(), [GOAL, SAVE, GOAL, SAVE, GOAL, SAVE]);
  assert.deepEqual([early.over.winners, early.goals, early.taken], [[0], [3, 0], [3, 3]]);
  assert.match(withNames(early.over.text, ['Ada', 'Bola']), /Ada wins the shoot-out 3–0/);
  // Not over while it can still be caught.
  assert.equal(sequence(start(), [GOAL, SAVE, GOAL, SAVE]).over, null);
  // All ten kicks: 3–2.
  const full = sequence(start(), [GOAL, GOAL, SAVE, SAVE, GOAL, GOAL, SAVE, SAVE, GOAL, SAVE]);
  assert.deepEqual([full.over.winners, full.goals, full.taken, penalty.toMove(full)], [[0], [3, 2], [5, 5], []]);
  // The second shooter can win it with the last kick.
  assert.deepEqual(sequence(start(), [SAVE, GOAL, SAVE, SAVE, SAVE, SAVE, SAVE, SAVE, SAVE, SAVE]).over.winners, [1]);
  // Level after five each: sudden death, decided only after both have kicked.
  const level = sequence(start(), Array(10).fill(GOAL));
  assert.deepEqual([level.over, level.goals, penalty.view(level, 0).sudden], [null, [5, 5], true]);
  const ahead = kick(level, ...GOAL);
  assert.equal(ahead.over, null, 'the other side still has its kick');
  const decided = kick(ahead, ...SAVE);
  assert.deepEqual([decided.over.winners, /in sudden death/.test(decided.over.text)], [[0], true]);
  assert.equal(kick(ahead, ...GOAL).over, null, 'both scored: another round');
  const drawn = sequence(level, Array(SUDDEN_ROUNDS * 2).fill(GOAL));
  assert.deepEqual([drawn.over.draw, drawn.over.winners, drawn.goals], [true, [], [10, 10]]);
  // Three kicks each as a table option.
  const short = sequence(start({ kicks: 3 }), [GOAL, SAVE, GOAL, SAVE]);
  assert.deepEqual([short.over.winners, short.taken], [[0], [2, 2]]);
  assert.deepEqual(cleanOptions(penalty, { kicks: 9 }), { kicks: 5 });
});

test('penalty: leaving loses, the clock chooses for a seat, and the computer plays whole shoot-outs by the rules', () => {
  const state = start();
  const left = penalty.forfeit(state, 0);
  assert.deepEqual([left.over.winners, left.over.reason, penalty.forfeit(left, 1)], [[1], 'forfeit', left]);
  const timed = penalty.timeout(state, 1, makeRng('t'));
  assert.deepEqual([penalty.toMove(timed), penalty.moved(timed)], [[0], [0, 1]]);
  const results = { 0: 0, 1: 0, draw: 0 };
  for (let game = 0; game < 400; game++) {
    let now = start(), n = 0;
    while (!penalty.outcome(now)) {
      const seat = penalty.toMove(now)[0];
      now = penalty.apply(now, seat, penalty.parseMove(penalty.bot(now, seat, makeRng(`g${game}|${n}`))), makeRng('x'));
      assert.ok(++n <= 2 * (10 + SUDDEN_ROUNDS * 2), 'a shoot-out is short');
    }
    const outcome = penalty.outcome(now);
    assert.equal(now.goals[0] + now.goals[1], now.history.filter((item) => item.goal).length);
    results[outcome.draw ? 'draw' : outcome.winners[0]] += 1;
  }
  assert.ok(results[0] > 120 && results[1] > 120, `neither seat is favoured much: ${JSON.stringify(results)}`);
});
