import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos'].map(preloadCityContent));
// OWNER: growth — the daily word puzzle against a real server: today's puzzle is the same for everyone, the answer is
// never in any answer before the puzzle is over, a wrong-day or replayed guess is refused, a refused word costs nothing,
// the streak and the stats are kept, a finished puzzle cannot be played again, and its result is claimed like a table game's.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { fixture } from './test-fixture.ts';
import type { Device } from './test-fixture.ts';
import type { OroView } from '../src/types/growth.ts';
import { answerAt, ANSWER_COUNT, isGuess5 } from '../src/words/guess.ts';
import { scoreGuess } from '../src/words/oro.ts';

const DAY = 86400000;
type Reply = Partial<OroView> & { status?: string | number; ok: boolean; code?: string; reason?: string; state?: OroView };
const ANSWERS = Array.from({ length: ANSWER_COUNT }, (_, i) => answerAt(i));

async function harness(t: TestContext) {
  const f = await fixture(t);
  f.advance(Date.parse('2026-10-20T08:00:00Z') - f.now()); // the fixture's clock starts in 1970, before the first puzzle
  const post = async (path: string, body: unknown, who: Device): Promise<Reply> => (await (await f.request(path, body, who.cookie)).json()) as Reply;
  async function player(name: string): Promise<Device> {
    const who = await f.device(name);
    await f.request('/api/life?city=lagos', null, who.cookie);
    await post('/api/growth/hello', { cityId: 'lagos' }, who);
    return who;
  }
  const state = (who: Device) => post('/api/growth/oro/state', { cityId: 'lagos' }, who);
  const guess = (who: Device, no: number, n: number, word: string, extra: object = {}) => post('/api/growth/oro/guess', { cityId: 'lagos', no, n, word, ...extra }, who);
  /** Plays toward the answer using only the marks the server returned: the next guess is any answer still consistent with them. */
  async function solve(who: Device, no: number, start = 0, limit = 6): Promise<Reply> {
    let reply: Reply = await state(who);
    let candidates = ANSWERS.slice();
    for (const row of reply.rows ?? []) candidates = candidates.filter((word) => scoreGuess(row.word, word).join('') === row.marks.join(''));
    for (let n = start; n < limit && reply.status === 'playing'; n++) {
      const word = candidates[Math.floor(candidates.length / 2)] ?? 'crane';
      reply = await guess(who, no, reply.rows?.length ?? n, word);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      const row = reply.rows?.at(-1);
      if (row) candidates = candidates.filter((answer) => scoreGuess(row.word, answer).join('') === row.marks.join(''));
    }
    return reply;
  }
  return { f, post, player, state, guess, solve };
}

test('oro: the same puzzle for everyone, no answer in anything sent before the end, refused words cost nothing', async (t) => {
  const { player, state, guess } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  const first = await state(ada), second = await state(bola);
  assert.deepEqual([first.ok, first.status, first.rows, first.no], [true, 'playing', [], second.no]);
  assert.ok(typeof first.no === 'number' && first.no >= 1);
  assert.equal('answer' in first, false);
  const no = first.no as number;

  const seen: string[] = [JSON.stringify(first)];
  // A wrong-day guess, a malformed word and a word that is not in the list are all refused and use no guess.
  const wrongDay = await guess(ada, no - 1, 0, 'crane');
  assert.deepEqual([wrongDay.ok, wrongDay.code], [false, 'wrong_day']);
  assert.deepEqual([(await guess(ada, no, 0, 'abc')).code, (await guess(ada, no, 0, 'zzzzz')).code], ['invalid_word', 'not_a_word']);
  assert.deepEqual((await state(ada)).rows, []);
  const one = await guess(ada, no, 0, 'crane');
  seen.push(JSON.stringify(one));
  assert.deepEqual([one.ok, one.status, one.rows?.length, one.rows?.[0]?.marks.length], [true, 'playing', 1, 5]);
  // Exactly once: the same guess with the number just used answers with the state; a wrong number is stale.
  const retry = await guess(ada, no, 0, 'crane');
  assert.deepEqual([retry.ok, retry.repeat, retry.rows?.length], [true, true, 1]);
  assert.equal((await guess(ada, no, 0, 'slate')).code, 'stale_guess');
  assert.equal((await guess(ada, no, 5, 'slate')).code, 'stale_guess');
  // Bola's puzzle is her own: Ada's guess is not on her board.
  assert.deepEqual((await state(bola)).rows, []);
  // Marks always agree with the scoring rules for the word guessed.
  const marks = (one.rows?.[0]?.marks ?? []).join('');
  assert.ok(ANSWERS.some((word) => scoreGuess('crane', word).join('') === marks), 'the marks belong to some answer');
  for (const text of seen) assert.equal(/"answer"|"share"/.test(text), false, 'nothing about the answer before the end');
});

test('oro: hard mode refuses a guess that drops what was found', async (t) => {
  const { player, state, guess } = await harness(t);
  const ada = await player('Ada');
  const no = (await state(ada)).no as number;
  const first = await guess(ada, no, 0, 'crane', { hard: true });
  assert.equal(first.hard, true);
  const greens = (first.rows?.[0]?.marks ?? []).map((mark, i) => (mark === 'c' ? i : -1)).filter((i) => i >= 0);
  const yellow = (first.rows?.[0]?.marks ?? []).some((mark) => mark === 'p');
  // Find a valid guess that breaks the rule: it lacks a found letter (if any were found).
  const candidates = ANSWERS.filter((word) => isGuess5(word) && word !== 'crane');
  const bad = candidates.find((word) => greens.some((i) => word.charAt(i) !== 'crane'.charAt(i)) || (yellow && !(first.rows?.[0]?.marks ?? []).every((mark, i) => mark !== 'p' || word.includes('crane'.charAt(i)))));
  if (bad) {
    const refused = await guess(ada, no, 1, bad, { hard: true });
    assert.deepEqual([refused.ok, refused.code], [false, 'hard_mode']);
    assert.equal((await state(ada)).rows?.length, 1, 'a refused guess costs nothing');
  }
});

test('oro: finishing records stats and a streak once, reveals the answer, and the puzzle cannot be played again', async (t) => {
  const { f, player, state, guess, solve, post } = await harness(t);
  const ada = await player('Ada');
  const day1 = (await state(ada)).no as number;
  const done = await solve(ada, day1);
  assert.ok(done.status === 'won' || done.status === 'lost', 'a solver using the marks finishes within six guesses or fails');
  assert.equal(done.finished, true);
  assert.equal(typeof done.answer, 'string');
  assert.ok(done.share?.startsWith(`Oro #${day1} `), done.share);
  assert.equal(/[a-z]{5}/i.test((done.share ?? '').replace(/Oro/, '')), false, 'a shared result has no letters of the word');
  assert.deepEqual([done.stats?.played, done.stats?.won], [1, done.status === 'won' ? 1 : 0]);
  // Reading it again gives the same finished puzzle; guessing again is refused.
  const again = await state(ada);
  assert.deepEqual([again.status, again.answer, again.rows?.length], [done.status, done.answer, done.rows?.length]);
  const late = await guess(ada, day1, again.rows?.length ?? 0, 'crane');
  assert.deepEqual([late.ok, late.code], [false, 'already_done']);
  assert.equal(JSON.stringify(late).includes('"answer"'), true, 'once finished, the answer may be shown');
  // The result is claimed like a table game's: it pays nothing and counts for the missions.
  const claim = (await post('/api/growth/tables/claim', { cityId: 'lagos' }, ada)) as Reply & { results?: { game: string; won: boolean; code: string }[] };
  assert.deepEqual(claim.results?.map((item) => [item.game, item.code]), [['oro', 'counted']]);
  assert.deepEqual(((await post('/api/growth/tables/claim', { cityId: 'lagos' }, ada)) as { results?: unknown[] }).results, [], 'and it is applied once');

  // Tomorrow is a new puzzle with a new number; the streak carries on after a win.
  f.advance(DAY);
  const next = await state(ada);
  assert.equal(next.no, day1 + 1);
  assert.deepEqual([next.status, next.rows], ['playing', []]);
  assert.equal(next.stats?.streak, done.status === 'won' ? 1 : 0);
  assert.equal((await guess(ada, day1, 0, 'crane')).code, 'wrong_day', 'yesterday’s puzzle is closed');
  const second = await solve(ada, day1 + 1);
  if (done.status === 'won' && second.status === 'won') assert.equal(second.stats?.streak, 2);
  // A missed day breaks the streak.
  f.advance(3 * DAY);
  assert.equal((await state(ada)).stats?.streak, 0);
});
