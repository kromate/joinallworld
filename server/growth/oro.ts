/**
 * OWNER: growth
 * Oro: the daily five-letter word puzzle, one puzzle a day for everyone (the rules are in src/words/oro.ts).
 *
 * THE SECRET. The day's answer is chosen on the server from a salted permutation of the answer list (the salt is
 * the growth collection's own, made once and never sent anywhere). The browser gets marks (correct / present /
 * absent) for the words it guessed, and the answer itself only once the puzzle is finished.
 *
 * THE PLAY. Guesses are numbered: a guess carries `n`, the number of guesses already made. The same word with the
 * number just used is answered with the current state and changes nothing (a retry); any other number is refused.
 * A guess for a puzzle number that is not today's is refused. A word that is not in the guess list is refused and
 * does not use up a guess. The six guesses of a puzzle in progress live in memory only (bounded), so a guess writes
 * NOTHING; a restart of the server loses a puzzle in progress, never a finished one.
 *
 * WHAT IS STORED. When a puzzle is finished, one saved transaction writes the player's record
 * `growth.players[id].oro`: { stats: { played, won, streak, best, last, dist: [six counts] },
 * today: { no, guesses: [words], won, hard } } and queues the result for the life like a table game's (game 'oro': it
 * pays nothing; it counts for the mission "Solve today's word"). That is the only write: one growth-collection
 * transaction per finished puzzle, the cost of a finished table game. A finished puzzle cannot be played again.
 */
import { lagosTime } from '../../src/game/clock.ts';
import { ANSWER_COUNT, answerAt, isGuess5 } from '../../src/words/guess.ts';
import { MAX_GUESSES, checkHardMode, cleanGuess, dailyIndex, puzzleNumber, scoreGuess, shareText } from '../../src/words/oro.ts';
import { LIMITS } from './data.ts';
import { count } from './metrics.ts';
import type { CityId } from '../../src/types/protocol.ts';
import type { GrowthCollection, GrowthPlayerRecord, OroStats } from '../types.ts';

/** Puzzles in progress that are held in memory at once; the oldest is dropped beyond this. */
const MAX_LIVE = 20000;
const newStats = (): OroStats => ({ played: 0, won: 0, streak: 0, best: 0, last: 0, dist: Array.from({ length: MAX_GUESSES }, () => 0) });

type Live = { no: number; guesses: string[]; hard: boolean };
const refusal = (code: string, reason: string) => ({ ok: false as const, code, reason });

export function oroService(randomId: () => string) {
  const live = new Map<string, Live>();
  const answers = new Map<number, string>();
  /** The answer for puzzle `no`; cached for the day. */
  function answerFor(g: GrowthCollection, no: number): string {
    const known = answers.get(no);
    if (known !== undefined) return known;
    const word = answerAt(dailyIndex(no, `${g.salt}|oro`, ANSWER_COUNT));
    if (answers.size > 4) answers.clear();
    answers.set(no, word);
    return word;
  }
  const todayNo = (now: number): number => puzzleNumber(lagosTime(now).day);
  const marksOf = (guesses: readonly string[], answer: string): string[][] => guesses.map((word) => scoreGuess(word, answer));
  /** A streak still alive today: the last finished puzzle was today's or yesterday's. */
  const streakNow = (stats: OroStats, no: number): number => (stats.last >= no - 1 ? stats.streak : 0);

  function view(g: GrowthCollection, player: GrowthPlayerRecord | null, id: string, no: number) {
    const stats = player?.oro?.stats ?? newStats();
    const done = player?.oro?.today?.no === no ? player.oro.today : null;
    const shown = { played: stats.played, won: stats.won, streak: streakNow(stats, no), best: stats.best, dist: stats.dist.slice() };
    if (done) {
      const answer = answerFor(g, no), marks = marksOf(done.guesses, answer);
      return { ok: true as const, no, status: done.won ? 'won' as const : 'lost' as const, hard: done.hard, rows: done.guesses.map((word, i) => ({ word, marks: marks[i] ?? [] })), answer, stats: shown,
        share: shareText(no, marks, done.won ? done.guesses.length : null, done.hard) };
    }
    const progress = live.get(id);
    const guesses = progress?.no === no ? progress.guesses : [], answer = answerFor(g, no), marks = marksOf(guesses, answer);
    // No `answer` key at all while the puzzle is open: nothing to find in the answer to a request.
    return { ok: true as const, no, status: 'playing' as const, hard: progress?.no === no ? progress.hard : false, rows: guesses.map((word, i) => ({ word, marks: marks[i] ?? [] })), stats: shown };
  }

  return {
    /** Where the caller's puzzle stands. Reads only. */
    state(g: GrowthCollection, player: GrowthPlayerRecord | null, id: string, now: number) { return view(g, player, id, todayNo(now)); },
    /** One guess. `player` is created by the caller when this finishes the puzzle (the record is written then). */
    guess(g: GrowthCollection, id: string, now: number, cityId: CityId, body: Record<string, unknown>, player: () => GrowthPlayerRecord | null) {
      const no = todayNo(now), current = g.players[id] ?? null;
      if (body.no !== no) return refusal('wrong_day', `That puzzle has ended. Today’s is number ${no}.`);
      if (current?.oro?.today?.no === no) return { ...refusal('already_done', 'You have finished today’s word. Come back tomorrow.'), state: view(g, current, id, no) };
      const word = cleanGuess(body.word);
      if (word === null) return refusal('invalid_word', 'A guess is five letters.');
      const n = body.n;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return refusal('invalid_guess', 'That guess was not understood.');
      let progress = live.get(id);
      if (!progress || progress.no !== no) { progress = { no, guesses: [], hard: body.hard === true }; live.delete(id); live.set(id, progress); if (live.size > MAX_LIVE) live.delete(live.keys().next().value ?? ''); }
      // A retry of the guess just made: answer with the state as it is.
      if (n === progress.guesses.length - 1 && progress.guesses[n] === word) return { ...view(g, current, id, no), repeat: true as const };
      if (n !== progress.guesses.length) return refusal('stale_guess', 'The puzzle moved on before that arrived. Look again.');
      if (!isGuess5(word)) return refusal('not_a_word', 'That is not in the word list.');
      const answer = answerFor(g, no);
      if (progress.hard || (progress.guesses.length === 0 && body.hard === true)) {
        progress.hard = true;
        const reason = checkHardMode(progress.guesses, marksOf(progress.guesses, answer), word);
        if (reason) return refusal('hard_mode', reason);
      }
      progress.guesses.push(word);
      const solved = word === answer;
      if (!solved && progress.guesses.length < MAX_GUESSES) return view(g, current, id, no);
      // Finished: one write.
      const record = player();
      if (!record) return refusal('server_full', 'This is not available right now. Try again later.');
      const stats = (record.oro ??= { stats: newStats(), today: null }).stats;
      stats.played += 1;
      if (solved) {
        stats.won += 1;
        stats.streak = stats.last === no - 1 ? stats.streak + 1 : 1;
        stats.best = Math.max(stats.best, stats.streak);
        stats.dist[progress.guesses.length - 1] = (stats.dist[progress.guesses.length - 1] ?? 0) + 1;
      } else stats.streak = 0;
      stats.last = no;
      record.oro.today = { no, guesses: progress.guesses.slice(), won: solved, hard: progress.hard };
      if (record.wins.length < LIMITS.results) record.wins.push({ cityId, id: randomId(), game: 'oro', label: 'Oro', won: solved, human: false, counted: false });
      count(g, now, cityId, 'table.finished.oro');
      live.delete(id);
      return { ...view(g, record, id, no), finished: true as const };
    },
  };
}
export type OroService = ReturnType<typeof oroService>;
