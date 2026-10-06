/**
 * Weave: weave words on the cloth. Pure rules and a computer player (see ./rules.ts for the contract).
 * The word list is a parameter (`makeWeave(dictionary)`); ./weave.ts binds the real one.
 *
 * THE GAME — A 13 x 13 cloth, 98 tiles (96 letters and 2 blanks), a rack of seven. On your turn put
 * tiles in one row or one column so they make one unbroken line with any tiles already there; every
 * word you form, the long one and each short one crossing it, must be in the word list. The first
 * word covers the centre square; every later play joins the tiles on the cloth. Premium squares
 * (see ./weave-board.ts) count only on the turn a tile first lands on them. A blank stands for any
 * letter and scores nothing. Using all seven tiles in one turn earns 30 more. Then draw back to
 * seven. Instead of playing you may pass, or swap tiles for fresh ones while the bag still holds at
 * least seven (a swap is silent: the log says how many, never which).
 *
 * THE END — When someone's rack is empty and the bag is empty, that player gains the value of all the
 * other racks and each other player loses the value of their own. Six scoreless turns in a row (passes,
 * swaps, timeouts) end the game, each player losing the value of their own rack. The highest score
 * wins; equal is a draw. A seat that leaves is skipped and its tiles go back under the bag; the last
 * seat standing wins.
 *
 * TIME — `turnSeconds` is 120. When it runs out the server calls `timeout`, which passes the turn
 * (a scoreless turn that does not count as a real move). The server forfeits a seat after 3 missed turns.
 *
 * STATE (the server's own; a player only ever gets `view`)
 *   { options, board: 13 strings ('.' empty, lowercase tile, UPPERCASE blank), racks: [[tile]] ('?' is a
 *     blank), bag: [tile] (drawn from the end; order private), scores, scoreless: turns in a row without
 *     points, history: [{ seat, kind, words: [{w, p}], points, tiles }], turn, out: [bool] (left),
 *     moves: [n], over: Outcome | null }
 * MOVES   { t: 'play', tiles: [{ r, c, l, blank? }] }   { t: 'exchange', letters: ['a', '?', …] }
 *         { t: 'pass' }   { t: 'resign' }  (any seat, any time: see `side`)
 */
import { RulesError, shuffled } from './rules.ts';
import type { Outcome, TableRules } from './rules.ts';
import { CENTRE, RACK_SIZE, SIZE, boardIsEmpty, cellAt, checkShape, emptyBoard, formWords, placeTiles, scorePlay, tileValue } from './weave-board.ts';
import type { Board, Placement } from './weave-board.ts';
import { fullBag } from './weave-letters.ts';
import type { Dictionary } from './weave-dict.ts';

export type WeaveOptions = { speed: 'relaxed' | 'quick' };
export type WeaveTurn = { seat: number; kind: 'play' | 'exchange' | 'pass'; words: { w: string; p: number }[]; points: number; tiles: number };
export type WeaveState = {
  options: WeaveOptions; board: string[]; racks: string[][]; bag: string[]; scores: number[]; scoreless: number; history: WeaveTurn[];
  turn: number; out: boolean[]; moves: number[]; over: Outcome | null;
};
export type WeaveMove =
  | { t: 'play'; tiles: Placement[] }
  | { t: 'exchange'; letters: string[] }
  | { t: 'pass' }
  | { t: 'resign' };
/** What a seat (or a watcher: null) may see. `racks` is null until the game is over. */
export type WeaveView = {
  game: 'weave'; options: WeaveOptions; board: string[]; scores: number[]; history: WeaveTurn[]; bagCount: number; rack: string[] | null;
  counts: number[]; turn: number | null; out: boolean[]; scoreless: number; over: Outcome | null; racks: string[][] | null;
};
export type WeaveRules = TableRules<WeaveState, WeaveMove, WeaveView> & { side: (move: WeaveMove) => boolean };

/** Scoreless turns in a row that end the game. */
export const SCORELESS_LIMIT = 6;
/** Fewer tiles than this in the bag and a swap is not allowed. */
export const EXCHANGE_MIN_BAG = 7;
export const HISTORY_SHOWN = 30;
/** The turn passes on the clock (the server forfeits after this many missed turns in a row). */
export const TURN_SECONDS = 120;
export const MISSED_TURNS_BEFORE_FORFEIT = 3;

/** True for a move any seat may make at any time (leaving), so the server skips the turn check. */
export const side = (move: WeaveMove): boolean => move.t === 'resign';

const clone = (state: WeaveState): WeaveState => ({
  ...state, board: state.board.slice(), racks: state.racks.map((rack) => rack.slice()), bag: state.bag.slice(), scores: state.scores.slice(),
  history: state.history.slice(), out: state.out.slice(), moves: state.moves.slice(),
});
const rackValue = (rack: readonly string[]): number => rack.reduce((sum, tile) => sum + tileValue(tile), 0);
const activeSeats = (state: WeaveState): number[] => state.out.map((gone, seat) => (gone ? -1 : seat)).filter((seat) => seat >= 0);

function nextSeat(state: WeaveState, from: number): number {
  const seats = state.racks.length;
  for (let step = 1; step <= seats; step++) {
    const seat = (from + step) % seats;
    if (!state.out[seat]) return seat;
  }
  return from;
}

/** Takes `wanted` tiles out of `rack` (by letter, '?' for a blank); null when the rack does not hold them. */
function takeTiles(rack: readonly string[], wanted: readonly string[]): string[] | null {
  const left = rack.slice();
  for (const tile of wanted) {
    const at = left.indexOf(tile);
    if (at < 0) return null;
    left.splice(at, 1);
  }
  return left;
}
function draw(state: WeaveState, seat: number): void {
  const rack = state.racks[seat] as string[];
  while (rack.length < RACK_SIZE && state.bag.length > 0) rack.push(state.bag.pop() as string); // the bag is not empty
}

const names = (seats: readonly number[]): string => {
  const list = seats.map((seat) => `{${seat}}`);
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
};

function finish(state: WeaveState, reason: 'empty-rack' | 'scoreless', emptied: number | null): void {
  const active = activeSeats(state);
  if (reason === 'empty-rack' && emptied !== null) {
    let rest = 0;
    for (const seat of active) if (seat !== emptied) { const lost = rackValue(state.racks[seat] as string[]); state.scores[seat] = (state.scores[seat] as number) - lost; rest += lost; }
    state.scores[emptied] = (state.scores[emptied] as number) + rest;
  } else {
    for (const seat of active) state.scores[seat] = (state.scores[seat] as number) - rackValue(state.racks[seat] as string[]);
  }
  const best = Math.max(...active.map((seat) => state.scores[seat] as number));
  const winners = active.filter((seat) => state.scores[seat] === best);
  const draw = winners.length > 1;
  const why = reason === 'empty-rack' ? `{${emptied}} used the last tile.` : 'Six turns in a row scored nothing.';
  state.over = {
    winners: draw ? [] : winners, draw, reason: reason === 'empty-rack' ? 'empty-hand' : 'count', scores: state.scores.slice(),
    text: draw ? `${why} ${names(winners)} are level on ${best} points. A draw.` : `${why} {${winners[0]}} wins with ${best} points.`,
  };
}

function pushHistory(state: WeaveState, entry: WeaveTurn): void { state.history.push(entry); }

/** The turn passes with no points (a pass, a swap or the clock). */
function scorelessTurn(state: WeaveState, seat: number): void {
  state.scoreless += 1;
  if (state.scoreless >= SCORELESS_LIMIT) finish(state, 'scoreless', null);
  else state.turn = nextSeat(state, seat);
}

function leave(before: WeaveState, seat: number): WeaveState {
  const state = clone(before);
  state.out[seat] = true;
  const rack = state.racks[seat] as string[];
  state.bag.unshift(...rack); // under the bag: nobody draws them soon
  state.racks[seat] = [];
  const active = activeSeats(state);
  if (active.length === 1) {
    const winner = active[0] as number;
    state.over = { winners: [winner], draw: false, reason: 'forfeit', text: `{${seat}} left the game. {${winner}} wins.`, scores: state.scores.slice() };
  } else if (state.turn === seat) state.turn = nextSeat(state, seat);
  return state;
}

function isLetter(value: unknown): value is string { return typeof value === 'string' && /^[a-z]$/.test(value); }
function isTile(value: unknown): value is string { return typeof value === 'string' && /^[a-z?]$/.test(value); }

function parseMove(input: unknown): WeaveMove {
  const move = input as { t?: unknown; tiles?: unknown; letters?: unknown } | null | undefined; // untrusted: every field is checked
  if (move?.t === 'pass') return { t: 'pass' };
  if (move?.t === 'resign') return { t: 'resign' };
  if (move?.t === 'exchange') {
    const letters = Array.isArray(move.letters) ? (move.letters as unknown[]).map((l) => (typeof l === 'string' ? l.toLowerCase() : l)) : [];
    if (letters.length < 1 || letters.length > RACK_SIZE || !letters.every(isTile)) throw new RulesError('Choose the tiles to swap.');
    return { t: 'exchange', letters };
  }
  if (move?.t === 'play') {
    const raw: unknown[] = Array.isArray(move.tiles) ? move.tiles : [];
    if (raw.length < 1 || raw.length > RACK_SIZE) throw new RulesError('Place between one and seven tiles.');
    const tiles = raw.map((item): Placement => {
      const tile = item as { r?: unknown; c?: unknown; l?: unknown; blank?: unknown } | null | undefined; // untrusted
      const l = typeof tile?.l === 'string' ? tile.l.toLowerCase() : '';
      if (!Number.isInteger(tile?.r) || !Number.isInteger(tile?.c) || !isLetter(l)) throw new RulesError('That tile is not placed properly.');
      const placed: Placement = { r: tile?.r as number, c: tile?.c as number, l }; // checked above
      if (tile?.blank === true) placed.blank = true;
      return placed;
    });
    return { t: 'play', tiles };
  }
  throw new RulesError('Choose a play, a swap, pass or resign.');
}

// ---------------------------------------------------------------------------------------------
// The computer player.
//
// For each row and column that has a square a new tile could join (next to a tile, or the centre
// on the first move) it scans the word list, pre-bucketed by length with a 26-bit letter mask per
// word, keeps the words whose letters could come from the rack plus the tiles already on that
// line, and tries each alignment. Cross-words are never formed by the bot's own tiles unless the
// list holds them (a per-square set of allowed letters is computed first), so everything it finds is
// legal. Work is bounded by counts, not clocks: at most EXAMINE_BUDGET words are aligned and at most
// SCORE_BUDGET plays are scored in a move, wherever the scan starts (the start is drawn from `rng`).
// ---------------------------------------------------------------------------------------------
export const EXAMINE_BUDGET = 8000;
/** Words that pass the letter test and are looked at (cheap) in one move. */
export const LOOK_BUDGET = 40000;
export const SCORE_BUDGET = 400;
const A = 97;
type Bucket = { words: string[]; masks: Int32Array };
const bucketCache = new WeakMap<Dictionary, Bucket[]>();

function bucketsOf(dict: Dictionary): Bucket[] {
  const cached = bucketCache.get(dict);
  if (cached) return cached;
  const buckets: Bucket[] = [];
  for (let n = 0; n <= SIZE; n++) {
    const words: string[] = [];
    if (n >= 2) for (const word of dict.ofLength(n)) words.push(word);
    const masks = new Int32Array(words.length);
    words.forEach((word, i) => { let mask = 0; for (let k = 0; k < word.length; k++) mask |= 1 << (word.charCodeAt(k) - A); masks[i] = mask; });
    buckets.push({ words, masks });
  }
  bucketCache.set(dict, buckets);
  return buckets;
}
/** Builds the bot's per-length tables now (about half a second for the real list) instead of in the first bot move. */
export function warmBot(dict: Dictionary): void { bucketsOf(dict); }
const popcount = (value: number): number => { let n = 0; for (let v = value; v; v &= v - 1) n++; return n; };

type Candidate = { placements: Placement[]; used: string[]; points: number; rank: number };
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** How good the tiles kept are: balanced vowels, few doubles, blanks and the S are worth keeping. */
export function leaveValue(kept: readonly string[]): number {
  let value = 0;
  const seen = new Map<string, number>();
  let vowels = 0;
  for (const tile of kept) {
    seen.set(tile, (seen.get(tile) ?? 0) + 1);
    if (VOWELS.has(tile)) vowels++;
    if (tile === '?') value += 6; else if (tile === 's') value += 2;
  }
  for (const [tile, count] of seen) if (count > 1) value -= (VOWELS.has(tile) ? 2 : 3) * (count - 1);
  if (seen.has('q') && !seen.has('u')) value -= 6;
  if (kept.length >= 3) value -= 1.5 * Math.abs(vowels - Math.round(kept.length * 0.4));
  return value;
}

function candidates(state: WeaveState, seat: number, dict: Dictionary, rng: () => number): Candidate[] {
  const rack = state.racks[seat] as string[];
  const board: Board = state.board;
  const first = boardIsEmpty(board);
  const counts = new Int8Array(26);
  let blanks = 0, rackMask = 0;
  for (const tile of rack) { if (tile === '?') blanks++; else { counts[tile.charCodeAt(0) - A] = (counts[tile.charCodeAt(0) - A] ?? 0) + 1; rackMask |= 1 << (tile.charCodeAt(0) - A); } }
  const buckets = bucketsOf(dict);
  const found: Candidate[] = [];
  let examined = 0, scored = 0, looked = 0;
  const scratch = new Int8Array(26);
  const bagOpen = state.bag.length > 0;

  let linesDone = 0;
  for (const across of [true, false]) {
    for (let line = 0; line < SIZE; line++, linesDone++) {
      if (examined >= EXAMINE_BUDGET || scored >= SCORE_BUDGET) return found;
      // Each line may spend its fair share of what is left, so the first rows cannot use it all up.
      const linesLeft = 2 * SIZE - linesDone;
      const lookTo = looked + Math.ceil((LOOK_BUDGET - looked) / linesLeft), examineTo = examined + Math.ceil((EXAMINE_BUDGET - examined) / linesLeft), scoreTo = SCORE_BUDGET;
      const at = (p: number): string => (across ? cellAt(board, line, p) : cellAt(board, p, line));
      const rowOf = (p: number): number => (across ? line : p), colOf = (p: number): number => (across ? p : line);
      // Allowed letters per square (cross-checks) and which squares are anchors.
      const allowed: number[] = new Array<number>(SIZE).fill(-1);
      const anchor: boolean[] = new Array<boolean>(SIZE).fill(false);
      let anyAnchor = false, lineMask = rackMask;
      for (let p = 0; p < SIZE; p++) {
        const here = at(p);
        if (here !== '.') { lineMask |= 1 << (here.toLowerCase().charCodeAt(0) - A); continue; }
        const r = rowOf(p), c = colOf(p);
        const dr = across ? 1 : 0, dc = across ? 0 : 1; // the other direction
        const before = cellAt(board, r - dr, c - dc) !== '.', after = cellAt(board, r + dr, c + dc) !== '.';
        const joins = before || after || cellAt(board, r - (across ? 0 : 1), c - (across ? 1 : 0)) !== '.' || cellAt(board, r + (across ? 0 : 1), c + (across ? 1 : 0)) !== '.';
        if (first ? (r === CENTRE.r && c === CENTRE.c) : joins) { anchor[p] = true; anyAnchor = true; }
        if (before || after) {
          let head = '', tail = '';
          for (let rr = r - dr, cc = c - dc; cellAt(board, rr, cc) !== '.'; rr -= dr, cc -= dc) head = cellAt(board, rr, cc).toLowerCase() + head;
          for (let rr = r + dr, cc = c + dc; cellAt(board, rr, cc) !== '.'; rr += dr, cc += dc) tail += cellAt(board, rr, cc).toLowerCase();
          let mask = 0;
          for (let k = 0; k < 26; k++) if (dict.has(head + String.fromCharCode(A + k) + tail)) mask |= 1 << k;
          allowed[p] = mask;
        }
      }
      if (!anyAnchor) continue;
      // Running totals along the line, so a window can be rejected without looking at its letters.
      const anchorsTo: number[] = [0], emptiesTo: number[] = [0];
      for (let p = 0; p < SIZE; p++) { anchorsTo.push((anchorsTo[p] as number) + (anchor[p] ? 1 : 0)); emptiesTo.push((emptiesTo[p] as number) + (at(p) === '.' ? 1 : 0)); }
      const offered = lineMask; // letters a word on this line may use without a blank

      for (let length = 2; length <= SIZE; length++) {
        const { words, masks } = buckets[length] as Bucket;
        const total = words.length;
        if (total === 0) continue;
        const startAt = Math.floor(rng() * total);
        for (let n = 0; n < total; n++) {
          const index = (startAt + n) % total;
          const missing = (masks[index] as number) & ~offered;
          if (missing !== 0 && (blanks === 0 || popcount(missing) > blanks)) continue;
          if (++looked > lookTo) break;
          const word = words[index] as string;
          for (let s = 0; s + length <= SIZE; s++) {
            const end = s + length, fresh = (emptiesTo[end] as number) - (emptiesTo[s] as number);
            if (fresh === 0 || fresh > rack.length || (anchorsTo[end] as number) === (anchorsTo[s] as number)) continue;
            if ((s > 0 && at(s - 1) !== '.') || (end < SIZE && at(end) !== '.')) continue;
            if (++examined > examineTo) break;
            scratch.set(counts);
            let blanksLeft = blanks, ok = true, covers = false;
            const placements: Placement[] = [], used: string[] = [];
            for (let k = 0; k < length && ok; k++) {
              const p = s + k, code = word.charCodeAt(k) - A, here = at(p);
              if (here !== '.') { if (here.toLowerCase() !== word[k]) ok = false; continue; }
              if (((allowed[p] as number) >> code & 1) === 0) { ok = false; continue; }
              const place: Placement = { r: rowOf(p), c: colOf(p), l: word[k] as string };
              if ((scratch[code] as number) > 0) { scratch[code] = (scratch[code] as number) - 1; used.push(word[k] as string); }
              else if (blanksLeft > 0) { blanksLeft--; place.blank = true; used.push('?'); }
              else { ok = false; continue; }
              if (anchor[p]) covers = true;
              placements.push(place);
            }
            if (!ok || !covers || placements.length === 0) continue;
            if (scored++ >= scoreTo) break;
            const result = scorePlay(board, placements);
            if (!result.ok) continue;
            const kept = takeTiles(rack, used) as string[]; // the tiles were taken from this rack
            found.push({ placements, used, points: result.points, rank: result.points + (bagOpen ? leaveValue(kept) : 0) });
          }
          if (looked >= lookTo || examined >= examineTo || scored >= scoreTo) break;
        }
        if (looked >= lookTo || examined >= examineTo || scored >= scoreTo) break;
      }
    }
  }
  return found;
}

function makeBot(dict: Dictionary) {
  return (state: WeaveState, seat: number, rng: () => number): WeaveMove => {
    if (state.over) return { t: 'pass' };
    const found = candidates(state, seat, dict, rng);
    if (found.length > 0) {
      const top = found.sort((x, y) => y.rank - x.rank || y.points - x.points).slice(0, 3);
      const pick = top[Math.floor(rng() * rng() * top.length)] as Candidate;
      return { t: 'play', tiles: pick.placements };
    }
    if (state.bag.length >= EXCHANGE_MIN_BAG) {
      // Keep the blanks and the S; swap the rest.
      const letters = (state.racks[seat] as string[]).filter((tile) => tile !== '?' && tile !== 's');
      if (letters.length > 0) return { t: 'exchange', letters };
    }
    return { t: 'pass' };
  };
}

/** The rules of Weave, judged against `dict`. */
export function makeWeave(dict: Dictionary): WeaveRules {
  function apply(before: WeaveState, seat: number, move: WeaveMove, rng: () => number): WeaveState {
    if (before.over) throw new RulesError('The game is over.');
    if (seat < 0 || seat >= before.racks.length || before.out[seat]) throw new RulesError('You are not in this game.');
    if (move.t === 'resign') return leave(before, seat);
    if (seat !== before.turn) throw new RulesError('It is not your turn.');
    const state = clone(before);
    const rack = state.racks[seat] as string[];
    if (move.t === 'pass') {
      state.moves[seat] = (state.moves[seat] as number) + 1;
      pushHistory(state, { seat, kind: 'pass', words: [], points: 0, tiles: 0 });
      scorelessTurn(state, seat);
      return state;
    }
    if (move.t === 'exchange') {
      if (state.bag.length < EXCHANGE_MIN_BAG) throw new RulesError(`The bag holds fewer than ${EXCHANGE_MIN_BAG} tiles, so you cannot swap now.`);
      if (move.letters.length < 1) throw new RulesError('Choose the tiles to swap.');
      const kept = takeTiles(rack, move.letters);
      if (!kept) throw new RulesError('You do not hold those tiles.');
      state.racks[seat] = kept;
      draw(state, seat);
      state.bag = shuffled([...state.bag, ...move.letters], rng);
      state.moves[seat] = (state.moves[seat] as number) + 1;
      pushHistory(state, { seat, kind: 'exchange', words: [], points: 0, tiles: move.letters.length });
      scorelessTurn(state, seat);
      return state;
    }
    const error = checkShape(state.board, move.tiles);
    if (error) throw new RulesError(error);
    const kept = takeTiles(rack, move.tiles.map((tile) => (tile.blank ? '?' : tile.l)));
    if (!kept) throw new RulesError('You do not hold those tiles.');
    for (const word of formWords(state.board, move.tiles)) if (!dict.has(word.word)) throw new RulesError(`'${word.word}' is not in the word list.`);
    const result = scorePlay(state.board, move.tiles);
    state.board = placeTiles(state.board, move.tiles);
    state.racks[seat] = kept;
    draw(state, seat);
    state.scores[seat] = (state.scores[seat] as number) + result.points;
    state.scoreless = 0;
    state.moves[seat] = (state.moves[seat] as number) + 1;
    pushHistory(state, { seat, kind: 'play', words: result.words.map((word) => ({ w: word.word, p: word.points })), points: result.points, tiles: move.tiles.length });
    if ((state.racks[seat] as string[]).length === 0 && state.bag.length === 0) finish(state, 'empty-rack', seat);
    else state.turn = nextSeat(state, seat);
    return state;
  }

  return {
    id: 'weave', label: 'Weave', seats: { min: 2, max: 4 }, turnSeconds: TURN_SECONDS,
    options: { speed: { label: 'Pace', values: ['relaxed', 'quick'], default: 'relaxed', names: ['Relaxed', 'Quick'] } },
    start(seats, rng, options): WeaveState {
      const bag = shuffled(fullBag(), rng);
      const racks: string[][] = [];
      for (let seat = 0; seat < seats; seat++) racks.push(bag.splice(bag.length - RACK_SIZE, RACK_SIZE));
      return { options, board: emptyBoard(), racks, bag, scores: new Array<number>(seats).fill(0), scoreless: 0, history: [], turn: 0, out: new Array<boolean>(seats).fill(false), moves: new Array<number>(seats).fill(0), over: null };
    },
    toMove: (state) => (state.over ? [] : [state.turn]),
    parseMove,
    apply,
    outcome: (state) => state.over,
    view(state, seat): WeaveView {
      const mine = seat !== null && seat >= 0 && seat < state.racks.length;
      return {
        game: 'weave', options: state.options, board: state.board.slice(), scores: state.scores.slice(), history: state.history.slice(-HISTORY_SHOWN), bagCount: state.bag.length,
        rack: mine ? (state.racks[seat] as string[]).slice() : null, counts: state.racks.map((rack) => rack.length), turn: state.over ? null : state.turn,
        out: state.out.slice(), scoreless: state.scoreless, over: state.over, racks: state.over ? state.racks.map((rack) => rack.slice()) : null,
      };
    },
    bot: makeBot(dict),
    timeout(before, seat) {
      if (before.over || seat !== before.turn) return before;
      const state = clone(before);
      pushHistory(state, { seat, kind: 'pass', words: [], points: 0, tiles: 0 });
      scorelessTurn(state, seat);
      return state;
    },
    forfeit(state, seat) { return state.over || state.out[seat] || seat < 0 || seat >= state.racks.length ? state : leave(state, seat); },
    describe(state, seat, move) {
      if (move.t === 'pass') return `{${seat}} passes`;
      if (move.t === 'resign') return `{${seat}} resigns`;
      if (move.t === 'exchange') return `{${seat}} swaps ${move.letters.length} ${move.letters.length === 1 ? 'tile' : 'tiles'}`;
      const result = scorePlay(state.board, move.tiles);
      const main = result.words[0];
      return main ? `{${seat}} plays ${main.word.toUpperCase()} for ${result.points}` : `{${seat}} plays`;
    },
    moved: (state) => state.moves.slice(),
    side,
  };
}
