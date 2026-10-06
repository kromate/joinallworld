/**
 * OWNER: growth
 * Chess for two: a table game. Pure rules (see ./rules.ts for the contract); the move generator and notation
 * live in ./chess-core.ts and the computer player in ./chess-bot.ts.
 *
 * THE GAME — Standard chess. A game ends by checkmate, stalemate, a draw by rule (threefold repetition, fifty
 * moves, no way to mate), resignation, agreement, the clock, or a player leaving. The rule draws are applied
 * the moment they arise, with no claim: a position seen for the third time, and a halfmove clock that reaches
 * 100 plies without a capture or pawn move (a mate on that very move still wins).
 *
 * CLOCKS — The server owns real time. Before it applies a real move it calls `charge(state, seat, elapsedMs)`:
 * that takes the elapsed time off the mover's clock, or, when the time was already used up, returns the game
 * lost on time. `apply` then adds the increment to the mover's clock after the move is made (so charge first,
 * then apply: a 5+3 game gives 300 s, minus the time taken, plus 3 s). `clockMs` is how long the side to move
 * has. An untimed game has no clock: each move has 180 s (`RELAXED_MS`), and the server's `timeout` ends it.
 *
 * SIDE MOVES — resign, offer-draw, accept-draw and decline-draw may be made by either seat at any time, even
 * when it is not their turn, and they never change whose turn it is: `side(move)` is true for them.
 *   A draw offer: at most one is pending; a seat may offer at most 3 times a game; only the other seat may accept
 *   or decline; the offer lapses when the seat it was made to plays a move (moving is declining).
 *
 * STATE (the server's own; a player only ever gets `view`)
 *   { options, white: the seat that plays white, fen, half: halfmove clock, history: SAN of every move,
 *     played: [{ from, to, promo? }], counts: times each position has occurred, captured: { w: black pieces
 *     White has taken, b: white pieces Black has taken }, left: [ms, ms] per seat or null, inc: ms added per move,
 *     drawOffer: the seat offering or null, offers: [n, n], moves: [n, n], over: Outcome | null }
 * MOVE  { t: 'move', from: 'e2', to: 'e4', promo?: 'q' | 'r' | 'b' | 'n' } | { t: 'resign' } | { t: 'offer-draw' }
 *       | { t: 'accept-draw' } | { t: 'decline-draw' }
 */
import { RulesError } from './rules.ts';
import type { Outcome, TableRules } from './rules.ts';
import { isRecord } from '../game/util.ts';
import {
  BLACK, KNIGHT, BISHOP, QUEEN, ROOK, START_FEN, WHITE, FLAG_EP,
  after, hasLegalMove, hasMatingMaterial, inCheck, insufficientMaterial, legalMoves, moveFrom, moveTo, movePromo, moveFlags,
  parseFen, pieceName, positionKey, san, squareIndex, squareName, toFen,
} from './chess-core.ts';
import type { Position } from './chess-core.ts';
import { chooseMove } from './chess-bot.ts';
import type { BotLevel } from './chess-bot.ts';

export type Promo = 'q' | 'r' | 'b' | 'n';
export type ChessOptions = { clock: '5+3' | '10+0' | 'untimed'; colour: 'white' | 'black' | 'random'; level: BotLevel };
export type PlayedMove = { from: string; to: string; promo?: Promo };
export type ChessMove =
  | { t: 'move'; from: string; to: string; promo?: Promo }
  | { t: 'resign' } | { t: 'offer-draw' } | { t: 'accept-draw' } | { t: 'decline-draw' };
type Pair<Value> = [Value, Value];
export type ChessState = {
  options: ChessOptions; white: 0 | 1; fen: string; half: number; history: string[]; played: PlayedMove[]; counts: Record<string, number>;
  captured: { w: string[]; b: string[] }; left: Pair<number> | null; inc: number; drawOffer: 0 | 1 | null; offers: Pair<number>;
  moves: Pair<number>; over: Outcome | null;
};
/** What a seat (or a watcher) may see. Squares in `board` run a8 = 0 … h1 = 63; `legal` is only for the seat to move. */
export type ChessView = {
  game: 'chess'; options: ChessOptions; white: 0 | 1; you: 'w' | 'b' | null; turn: 'w' | 'b' | null; board: (string | null)[];
  legal: PlayedMove[]; history: string[]; last: { from: string; to: string } | null; check: string | null;
  /** `w` lists the black pieces White has captured, `b` the white pieces Black has captured. */
  captured: { w: string[]; b: string[] }; clocks: { w: number; b: number } | null; drawOffer: 'w' | 'b' | null; over: Outcome | null; halfmove: number;
};

/** Time per move when a game is untimed (the server's move deadline). */
export const RELAXED_MS = 180000;
/** Draw offers a seat may make in one game. */
export const MAX_OFFERS = 3;
/** The halfmove clock (in plies) at which the game is drawn. */
export const FIFTY_MOVE_PLIES = 100;
export const CLOCKS = Object.freeze({ '5+3': { ms: 300000, inc: 3000 }, '10+0': { ms: 600000, inc: 0 } });

const PROMO_TYPES: Readonly<Record<Promo, number>> = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT };
const PROMO_LETTER: Readonly<Record<number, Promo>> = { [QUEEN]: 'q', [ROOK]: 'r', [BISHOP]: 'b', [KNIGHT]: 'n' };
const SIDE_MOVES: ReadonlySet<string> = new Set(['resign', 'offer-draw', 'accept-draw', 'decline-draw']);

/** True for the moves either seat may make at any time, without it being their turn (they never change whose turn it is). */
export const side = (move: ChessMove): boolean => SIDE_MOVES.has(move.t);

const colourOf = (state: ChessState, seat: number): 0 | 1 => (seat === state.white ? WHITE : BLACK);
const seatOf = (state: ChessState, colour: number): 0 | 1 => (colour === WHITE ? state.white : (1 - state.white) as 0 | 1);
const turnColour = (state: ChessState): 0 | 1 => (state.fen.split(' ')[1] === 'b' ? BLACK : WHITE);
const letter = (colour: number): 'w' | 'b' => (colour === WHITE ? 'w' : 'b');
const isSeat = (seat: number): seat is 0 | 1 => seat === 0 || seat === 1;

const clone = (state: ChessState): ChessState => ({
  ...state, history: state.history.slice(), played: state.played.slice(), counts: { ...state.counts }, captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
  left: state.left ? [state.left[0], state.left[1]] : null, offers: [state.offers[0], state.offers[1]], moves: [state.moves[0], state.moves[1]],
});

const won = (seat: number, reason: string, text: string): Outcome => ({ winners: [seat], draw: false, reason, text, scores: seat === 0 ? [1, 0] : [0, 1] });
const drawn = (reason: string, text: string): Outcome => ({ winners: [], draw: true, reason, text, scores: [0.5, 0.5] });

function start(seats: number, rng: () => number, options: ChessOptions): ChessState {
  const white: 0 | 1 = options.colour === 'white' ? 0 : options.colour === 'black' ? 1 : (rng() < 0.5 ? 0 : 1);
  const clock = options.clock === 'untimed' ? null : CLOCKS[options.clock];
  const pos = parseFen(START_FEN);
  return {
    options, white, fen: START_FEN, half: 0, history: [], played: [], counts: { [positionKey(pos)]: 1 }, captured: { w: [], b: [] },
    left: clock ? [clock.ms, clock.ms] : null, inc: clock ? clock.inc : 0, drawOffer: null, offers: [0, 0], moves: [0, 0], over: null,
  };
}

function parseMove(input: unknown): ChessMove {
  if (!isRecord(input)) throw new RulesError('That is not a chess move.');
  const kind = input.t;
  if (kind === 'resign' || kind === 'offer-draw' || kind === 'accept-draw' || kind === 'decline-draw') return { t: kind };
  if (kind !== 'move') throw new RulesError('That is not a chess move.');
  const { from, to, promo } = input;
  if (typeof from !== 'string' || typeof to !== 'string' || squareIndex(from) < 0 || squareIndex(to) < 0) throw new RulesError('Name the squares like e2 and e4.');
  if (promo === undefined || promo === null) return { t: 'move', from, to };
  if (promo !== 'q' && promo !== 'r' && promo !== 'b' && promo !== 'n') throw new RulesError('A pawn becomes a queen, rook, bishop or knight (q, r, b or n).');
  return { t: 'move', from, to, promo };
}

/** Resolve a move to one of the legal moves in `pos`, or throw a sentence for the player. */
function resolve(pos: Position, move: { from: string; to: string; promo?: Promo }): number {
  const from = squareIndex(move.from), to = squareIndex(move.to);
  const piece = pos.board[from] as number;
  if (piece === 0 || (piece >> 3) !== pos.turn) throw new RulesError(`You have no piece on ${move.from}.`);
  const options = legalMoves(pos).filter((legal) => moveFrom(legal) === from && moveTo(legal) === to);
  if (options.length === 0) throw new RulesError(inCheck(pos) ? 'You are in check. Take the attacker, block it, or move your king.' : 'That move is not allowed.');
  const promotions = options.some((legal) => movePromo(legal) !== 0);
  if (!promotions) {
    if (move.promo) throw new RulesError('Only a pawn that reaches the last rank is promoted.');
    return options[0] as number;
  }
  if (!move.promo) throw new RulesError('Choose what the pawn becomes: queen, rook, bishop or knight.');
  const chosen = options.find((legal) => movePromo(legal) === PROMO_TYPES[move.promo as Promo]);
  if (chosen === undefined) throw new RulesError('That promotion is not allowed.');
  return chosen;
}

function applySide(before: ChessState, seat: 0 | 1, move: ChessMove): ChessState {
  const state = clone(before);
  const other = (1 - seat) as 0 | 1;
  switch (move.t) {
    case 'resign':
      state.over = won(other, 'resign', `{${seat}} resigned. {${other}} wins.`);
      state.drawOffer = null;
      return state;
    case 'offer-draw':
      if (state.drawOffer !== null) throw new RulesError(state.drawOffer === seat ? 'You have already offered a draw.' : 'A draw has been offered to you. Accept or decline it.');
      if (state.offers[seat] >= MAX_OFFERS) throw new RulesError(`You have offered ${MAX_OFFERS} draws already.`);
      state.drawOffer = seat;
      state.offers[seat] += 1;
      return state;
    case 'accept-draw':
      if (state.drawOffer !== other) throw new RulesError('There is no draw offer to accept.');
      state.over = drawn('agreed', 'Draw agreed.');
      state.drawOffer = null;
      return state;
    case 'decline-draw':
      if (state.drawOffer !== other) throw new RulesError('There is no draw offer to decline.');
      state.drawOffer = null;
      return state;
    default:
      throw new RulesError('That is not a chess move.');
  }
}

function apply(before: ChessState, seat: number, move: ChessMove): ChessState {
  if (before.over) throw new RulesError('The game is over.');
  if (!isSeat(seat)) throw new RulesError('You are not in this game.');
  if (move.t !== 'move') return applySide(before, seat, move);
  const pos = parseFen(before.fen), mover = turnColour(before);
  if (seatOf(before, mover) !== seat) throw new RulesError('It is not your turn.');
  const encoded = resolve(pos, move);
  const state = clone(before);
  const text = san(pos, encoded), next = after(pos, encoded);
  const from = squareName(moveFrom(encoded)), to = squareName(moveTo(encoded));
  const taken = moveFlags(encoded) & FLAG_EP ? pieceName(pos.board[moveTo(encoded) + (mover === WHITE ? 8 : -8)] as number) : pieceName(pos.board[moveTo(encoded)] as number);
  if (taken) state.captured[letter(mover)].push(taken);
  const promo = PROMO_LETTER[movePromo(encoded)];
  state.played.push(promo ? { from, to, promo } : { from, to });
  state.history.push(text);
  state.fen = toFen(next);
  state.half = next.half;
  state.moves[seat] += 1;
  if (state.left) state.left[seat] += state.inc;
  if (state.drawOffer !== null && state.drawOffer !== seat) state.drawOffer = null; // moving on is declining
  const key = positionKey(next);
  state.counts[key] = (state.counts[key] ?? 0) + 1;
  const loser = (1 - seat) as 0 | 1;
  if (!hasLegalMove(next)) {
    if (inCheck(next)) state.over = won(seat, 'checkmate', `{${seat}} wins by checkmate.`);
    else state.over = drawn('stalemate', `Stalemate: {${loser}} has no move and is not in check. A draw.`);
  } else if (insufficientMaterial(next)) state.over = drawn('insufficient', 'Neither side has enough pieces to checkmate. A draw.');
  else if ((state.counts[key] as number) >= 3) state.over = drawn('repetition', 'The same position has come up three times. A draw.');
  else if (next.half >= FIFTY_MOVE_PLIES) state.over = drawn('fifty-move', 'Fifty moves without a capture or a pawn move. A draw.');
  if (state.over) state.drawOffer = null;
  return state;
}

/** The seat whose clock runs out loses, unless the other side could never checkmate. */
function timeout(before: ChessState, seat: number): ChessState {
  if (before.over || !isSeat(seat)) return before;
  const state = clone(before);
  if (state.left) state.left[seat] = 0;
  const winner = (1 - seat) as 0 | 1;
  state.drawOffer = null;
  state.over = hasMatingMaterial(parseFen(before.fen), colourOf(before, winner))
    ? won(winner, 'time', `{${seat}} ran out of time. {${winner}} wins.`)
    : drawn('insufficient', `{${seat}} ran out of time, but {${winner}} cannot checkmate. A draw.`);
  return state;
}

function forfeit(before: ChessState, seat: number): ChessState {
  if (before.over || !isSeat(seat)) return before;
  const state = clone(before), winner = (1 - seat) as 0 | 1;
  state.drawOffer = null;
  state.over = won(winner, 'forfeit', `{${seat}} left the game. {${winner}} wins.`);
  return state;
}

/** Milliseconds the side to move has: its clock, or `RELAXED_MS` in an untimed game; 0 once the game is over. */
export function clockMs(state: ChessState): number {
  if (state.over) return 0;
  return state.left ? state.left[seatOf(state, turnColour(state))] : RELAXED_MS;
}

/**
 * Call before `apply` for a real (non-side) move: takes `elapsedMs` off the mover's clock. If that clock is
 * already used up, the game is returned lost on time instead (and `apply` will then refuse the move).
 * Untimed games and moves by the seat not to move come back unchanged.
 */
export function charge(state: ChessState, seat: number, elapsedMs: number): ChessState {
  if (state.over || !state.left || !isSeat(seat) || seatOf(state, turnColour(state)) !== seat) return state;
  const used = Math.max(0, Math.floor(elapsedMs));
  if (used >= state.left[seat]) return timeout(state, seat);
  const next = clone(state);
  (next.left as Pair<number>)[seat] = state.left[seat] - used;
  return next;
}

function view(state: ChessState, seat: number | null): ChessView {
  const pos = parseFen(state.fen), mover = turnColour(state);
  const mine = seat !== null && isSeat(seat);
  const toMoveNow = !state.over && mine && seatOf(state, mover) === seat;
  const legal: PlayedMove[] = toMoveNow
    ? legalMoves(pos).map((move) => {
      const from = squareName(moveFrom(move)), to = squareName(moveTo(move)), promo = PROMO_LETTER[movePromo(move)];
      return promo ? { from, to, promo } : { from, to };
    })
    : [];
  const last = state.played.at(-1);
  const clocks = state.left ? { w: state.left[state.white], b: state.left[state.white === 0 ? 1 : 0] } : null;
  return {
    game: 'chess', options: state.options, white: state.white, you: mine ? letter(colourOf(state, seat)) : null, turn: state.over ? null : letter(mover),
    board: Array.from(pos.board, (piece) => pieceName(piece)), legal, history: state.history.slice(), last: last ? { from: last.from, to: last.to } : null,
    check: inCheck(pos) ? squareName(pos.king[pos.turn]) : null, captured: { w: state.captured.w.slice(), b: state.captured.b.slice() },
    clocks: clocks ? { w: clocks.w, b: clocks.b } : null, drawOffer: state.drawOffer === null ? null : letter(colourOf(state, state.drawOffer)), over: state.over, halfmove: state.half,
  };
}

function bot(state: ChessState, seat: number, rng: () => number): ChessMove {
  if (state.over) throw new RulesError('The game is over.');
  if (seatOf(state, turnColour(state)) !== seat) throw new RulesError('It is not the computer\'s turn.');
  const pos = parseFen(state.fen);
  // Positions seen twice: a computer that is winning does not step into them a third time.
  const seen = new Set(Object.keys(state.counts).filter((key) => (state.counts[key] as number) >= 2));
  const { move } = chooseMove(pos, state.options.level, rng, seen);
  const promo = PROMO_LETTER[movePromo(move)];
  return promo ? { t: 'move', from: squareName(moveFrom(move)), to: squareName(moveTo(move)), promo } : { t: 'move', from: squareName(moveFrom(move)), to: squareName(moveTo(move)) };
}

function describe(state: ChessState, seat: number, move: ChessMove): string {
  switch (move.t) {
    case 'resign': return `{${seat}} resigns`;
    case 'offer-draw': return `{${seat}} offers a draw`;
    case 'accept-draw': return `{${seat}} accepts the draw`;
    case 'decline-draw': return `{${seat}} declines the draw`;
    default: {
      const pos = parseFen(state.fen);
      try { return `{${seat}} plays ${san(pos, resolve(pos, move))}`; } catch { return `{${seat}} plays ${move.from}${move.to}`; } // an illegal move is only described, never judged here
    }
  }
}

/** The rules of the game, plus the clock and side-move hooks the server uses. */
export type ChessRules = TableRules<ChessState, ChessMove, ChessView> & {
  side: (move: ChessMove) => boolean;
  clockMs: (state: ChessState) => number;
  charge: (state: ChessState, seat: number, elapsedMs: number) => ChessState;
};

const rules: ChessRules = {
  id: 'chess', label: 'Chess', seats: { min: 2, max: 2 }, turnSeconds: RELAXED_MS / 1000,
  options: {
    clock: { label: 'Clock', values: ['5+3', '10+0', 'untimed'], default: '10+0', names: ['5 min + 3 s', '10 min', 'Relaxed (3 min a move)'] },
    colour: { label: 'Your colour', values: ['white', 'black', 'random'], default: 'white', names: ['White', 'Black', 'Random'] },
    level: { label: 'Computer strength', values: ['easy', 'medium', 'hard'], default: 'medium', names: ['Easy', 'Medium', 'Hard'] },
  },
  start,
  toMove: (state) => (state.over ? [] : [seatOf(state, turnColour(state))]),
  parseMove, apply, bot, timeout, forfeit, describe, view, side, clockMs, charge,
  outcome: (state) => state.over,
  moved: (state) => [state.moves[0], state.moves[1]],
};
export default rules;
