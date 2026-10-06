/**
 * OWNER: growth
 * A small chess engine for the computer player: negamax with alpha-beta, a quiescence search over
 * captures, a hand-made evaluation, and iterative deepening bounded by a count of nodes (never by a
 * clock), so the same position and level always give the same answer. Only the easy level draws on
 * `rng`, to choose among its better moves.
 */
import {
  BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE, FLAG_EP,
  clonePosition, generate, hasLegalMove, inCheck, isAttacked, leftInCheck, make, positionKey, rayTable, unmake,
} from './chess-core.ts';
import type { Position } from './chess-core.ts';

export type BotLevel = 'easy' | 'medium' | 'hard';
/** Nodes a search may visit (easy: the nodes it nominally needs; it always finishes its one pass). */
export const NODE_BUDGET: Readonly<Record<BotLevel, number>> = Object.freeze({ easy: 2000, medium: 12000, hard: 40000 });

const MATE = 30000, INF = 32000, MAX_PLY = 64, MAX_DEPTH = 16;

// ---------------------------------------------------------------------------------------- evaluation

const VALUE = [0, 100, 320, 335, 500, 900, 0];
/** Piece-square tables from white's side, indexed like the board (a8 = 0); black reads them mirrored. */
const PST: Int16Array[] = [new Int16Array(64)];
const KING_MID = new Int16Array(64), KING_END = new Int16Array(64);

(function buildTables() {
  const PAWN_RANK = [0, 0, 2, 6, 14, 28, 50, 0];
  for (let type = 1; type <= 6; type++) PST.push(new Int16Array(64));
  for (let square = 0; square < 64; square++) {
    const file = square & 7, rank = 7 - (square >> 3);
    // How far the square is from the centre: 2 on d4/e4/d5/e5 … 14 in a corner.
    const away = Math.abs(2 * file - 7) + Math.abs(2 * rank - 7);
    const centre = file === 3 || file === 4;
    (PST[PAWN] as Int16Array)[square] = (PAWN_RANK[rank] as number) + (centre && rank >= 2 && rank <= 4 ? 7 : 0) + (file === 2 || file === 5 ? 2 : 0) - (file === 0 || file === 7 ? 4 : 0);
    (PST[KNIGHT] as Int16Array)[square] = 24 - away * 4;
    (PST[BISHOP] as Int16Array)[square] = 16 - away * 2 - (rank === 0 ? 8 : 0);
    (PST[ROOK] as Int16Array)[square] = (rank === 6 ? 12 : 0) + (centre ? 4 : 0) + (rank === 0 && centre ? 3 : 0);
    (PST[QUEEN] as Int16Array)[square] = 6 - away;
    KING_MID[square] = rank === 0 ? (file === 6 || file === 1 ? 24 : file === 2 ? 8 : file === 7 || file === 0 ? 6 : -6) : -rank * 14 - (centre ? 8 : 0);
    KING_END[square] = 30 - away * 4 + rank;
  }
})();

const PASSED = [0, 0, 10, 20, 35, 60, 100, 0];
const pawnCount = new Int8Array(16);  // pawns per file: white 0–7, black 8–15
const whiteBack = new Int8Array(8);   // the largest row (least advanced) of a white pawn on each file, -1 when none
const blackBack = new Int8Array(8);   // the smallest row (least advanced) of a black pawn on each file, 8 when none

/** Score for the side to move, in centipawns. */
export function evaluate(pos: Position): number {
  const board = pos.board;
  let score = 0, phase = 0;
  const bishops = [0, 0];
  pawnCount.fill(0); whiteBack.fill(-1); blackBack.fill(8);
  for (let square = 0; square < 64; square++) {
    if (((board[square] as number) & 7) !== PAWN) continue;
    const colour = (board[square] as number) >> 3, file = square & 7, row = square >> 3;
    pawnCount[colour * 8 + file] = (pawnCount[colour * 8 + file] as number) + 1;
    if (colour === WHITE) { if (row > (whiteBack[file] as number)) whiteBack[file] = row; }
    else if (row < (blackBack[file] as number)) blackBack[file] = row;
  }
  for (let square = 0; square < 64; square++) {
    const piece = board[square] as number;
    if (piece === 0) continue;
    const type = piece & 7, colour = piece >> 3, mirrored = colour === WHITE ? square : square ^ 56;
    if (type === KING) continue;
    let value = (VALUE[type] as number) + ((PST[type] as Int16Array)[mirrored] as number);
    const file = square & 7, row = square >> 3;
    if (type === PAWN) {
      if ((pawnCount[colour * 8 + file] as number) > 1) value -= 8;
      let passed = true;
      for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1) && passed; f++) {
        // A pawn is passed when no enemy pawn on its file or the next is still ahead of it.
        passed = colour === WHITE ? (blackBack[f] as number) >= row : (whiteBack[f] as number) <= row;
      }
      if (passed) value += PASSED[colour === WHITE ? 7 - row : row] as number;
    } else if (type === KNIGHT) phase += 1;
    else if (type === QUEEN) phase += 4;
    else {
      // Bishops and rooks: a little for the squares they see (mobility), and rooks like open files.
      const first = type === BISHOP ? 4 : 0, last = type === BISHOP ? 8 : 4;
      let reach = 0;
      for (let direction = first; direction < last; direction++) {
        const line = rayTable(square, direction);
        for (let i = 0; i < line.length; i++) { reach += 1; if (board[line[i] as number] !== 0) break; }
      }
      if (type === BISHOP) { phase += 1; bishops[colour] = (bishops[colour] as number) + 1; value += (reach - 6) * 3; }
      else {
        phase += 2; value += reach - 7;
        if (pawnCount[colour * 8 + file] === 0) value += pawnCount[(1 - colour) * 8 + file] === 0 ? 14 : 7;
      }
    }
    score += colour === WHITE ? value : -value;
  }
  // Kings: safe at home while there is material to attack with, active once it thins out (phase 24 = everything).
  const p = Math.min(phase, 24);
  const kingValue = (square: number) => ((KING_MID[square] as number) * p + (KING_END[square] as number) * (24 - p)) / 24;
  score += Math.round(kingValue(pos.king[WHITE]) - kingValue(pos.king[BLACK] ^ 56));
  if ((bishops[WHITE] as number) >= 2) score += 25;
  if ((bishops[BLACK] as number) >= 2) score -= 25;
  return (pos.turn === WHITE ? score : -score) + 8;
}

// ---------------------------------------------------------------------------------------- search

const moveBuf = new Int32Array(MAX_PLY * 256);
const scoreBuf = new Int32Array(MAX_PLY * 256);
const killers = new Int32Array(MAX_PLY * 2);
const VICTIM = [0, 1, 3, 3, 5, 9, 10];
let nodes = 0, budget = 0, stopped = false;

/** Order the moves in [off, off+n): captures by victim then cheapest attacker, promotions, killers, the rest. */
function order(pos: Position, off: number, n: number, ply: number, first: number): void {
  const board = pos.board;
  for (let i = off; i < off + n; i++) {
    const move = moveBuf[i] as number, to = (move >> 6) & 63, promo = (move >> 12) & 7;
    const victim = (move >> 15) & FLAG_EP ? PAWN : (board[to] as number) & 7;
    const mover = (board[move & 63] as number) & 7;
    let score = 0;
    if (move === first) score = 1000000;
    else if (victim) score = 20000 + (VICTIM[victim] as number) * 16 - mover;
    else if (move === killers[ply * 2] || move === killers[ply * 2 + 1]) score = 15000;
    if (promo) score += promo === QUEEN ? 30000 : 1000;
    scoreBuf[i] = score;
  }
}

/** Swap the best-scored remaining move into slot i. */
function pick(off: number, end: number, i: number): number {
  let best = i;
  for (let j = i + 1; j < end; j++) if ((scoreBuf[j] as number) > (scoreBuf[best] as number)) best = j;
  if (best !== i) {
    const move = moveBuf[i] as number, score = scoreBuf[i] as number;
    moveBuf[i] = moveBuf[best] as number; scoreBuf[i] = scoreBuf[best] as number;
    moveBuf[best] = move; scoreBuf[best] = score;
  }
  return moveBuf[i] as number;
}

function quiesce(pos: Position, alpha: number, beta: number, ply: number): number {
  nodes += 1;
  const stand = evaluate(pos);
  if (ply >= MAX_PLY - 1) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const off = ply * 256, n = generate(pos, moveBuf, off, true) - off;
  order(pos, off, n, ply, 0);
  for (let i = off; i < off + n; i++) {
    const move = pick(off, off + n, i);
    const victim = (move >> 15) & FLAG_EP ? PAWN : (pos.board[(move >> 6) & 63] as number) & 7;
    const mover = (pos.board[move & 63] as number) & 7;
    // Skip captures that cannot lift the score back to alpha even with a generous margin.
    if (!((move >> 12) & 7) && stand + (VALUE[victim] as number) + 200 < alpha) continue;
    make(pos, move);
    if (leftInCheck(pos)) { unmake(pos); continue; }
    // A capture of something cheaper than the capturer, onto a square the other side guards, loses material.
    if (!((move >> 12) & 7) && (VALUE[victim] as number) < (VALUE[mover] as number) && isAttacked(pos, (move >> 6) & 63, pos.turn)) { unmake(pos); continue; }
    const score = -quiesce(pos, -beta, -alpha, ply + 1);
    unmake(pos);
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Does the side to move have a piece besides pawns and its king? */
function hasPieces(pos: Position): boolean {
  for (let square = 0; square < 64; square++) {
    const piece = pos.board[square] as number;
    if (piece !== 0 && (piece >> 3) === pos.turn && (piece & 7) > PAWN && (piece & 7) < KING) return true;
  }
  return false;
}

function negamax(pos: Position, depth: number, alpha: number, beta: number, ply: number): number {
  nodes += 1;
  if (nodes >= budget && budget > 0) { stopped = true; return 0; }
  if (pos.half >= 100) return 0;
  const checked = inCheck(pos);
  if (checked && ply < MAX_PLY - 8) depth += 1;
  if (depth <= 0 || ply >= MAX_PLY - 2) return quiesce(pos, alpha, beta, ply);
  // Null move: if passing the turn still holds the position, a real move will too. Not when in check or with bare pieces (zugzwang).
  if (depth >= 3 && !checked && beta < MATE - MAX_PLY && hasPieces(pos)) {
    const ep = pos.ep;
    pos.ep = -1; pos.turn = (1 - pos.turn) as 0 | 1;
    const score = -negamax(pos, depth - 3, -beta, -beta + 1, ply + 1);
    pos.turn = (1 - pos.turn) as 0 | 1; pos.ep = ep;
    if (stopped) return 0;
    if (score >= beta) return beta;
  }
  const off = ply * 256, n = generate(pos, moveBuf, off, false) - off;
  order(pos, off, n, ply, 0);
  let best = -INF, legal = 0;
  for (let i = off; i < off + n; i++) {
    const move = pick(off, off + n, i);
    const quiet = pos.board[(move >> 6) & 63] === 0 && !((move >> 12) & 7) && !((move >> 15) & FLAG_EP);
    make(pos, move);
    if (leftInCheck(pos)) { unmake(pos); continue; }
    legal += 1;
    // Late quiet moves are looked at one ply shallower first, and again in full only if they turn out good.
    let score: number;
    if (depth >= 3 && legal > 4 && quiet && !checked && !inCheck(pos)) {
      score = -negamax(pos, depth - 2, -alpha - 1, -alpha, ply + 1);
      if (score > alpha && !stopped) score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    } else score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    unmake(pos);
    if (stopped) return 0;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      if (!pos.board[(move >> 6) & 63] && !((move >> 12) & 7) && move !== killers[ply * 2]) { killers[ply * 2 + 1] = killers[ply * 2] as number; killers[ply * 2] = move; }
      break;
    }
  }
  if (legal === 0) return checked ? -MATE + ply : 0;
  return best;
}

interface Scored { move: number; score: number }

/** Legal moves at the root, each with the score of the last search that finished for it. */
function rootMoves(pos: Position): Scored[] {
  const n = generate(pos, moveBuf, 0, false), list: Scored[] = [];
  order(pos, 0, n, 0, 0);
  for (let i = 0; i < n; i++) {
    const move = pick(0, n, i);
    make(pos, move);
    if (!leftInCheck(pos)) list.push({ move, score: 0 });
    unmake(pos);
  }
  return list;
}

export interface BotResult { move: number; score: number; nodes: number; depth: number }

/**
 * The computer's move. `avoid` holds position keys that have already occurred twice: when the computer
 * is clearly ahead it will not walk into them again. Throws if there is no legal move.
 */
export function chooseMove(source: Position, level: BotLevel, rng: () => number, avoid?: ReadonlySet<string>): BotResult {
  const pos = clonePosition(source);
  nodes = 0; stopped = false; killers.fill(0);
  let roots = rootMoves(pos);
  if (roots.length === 0) throw new Error('There is no legal move.');
  if (roots.length === 1) return { move: (roots[0] as Scored).move, score: 0, nodes: 0, depth: 0 };
  if (avoid && avoid.size && evaluate(pos) > 200) {
    const fresh = roots.filter(({ move }) => { make(pos, move); const seen = avoid.has(positionKey(pos)); unmake(pos); return !seen; });
    if (fresh.length) roots = fresh;
  }

  if (level === 'easy') {
    budget = 0; // one full pass over the moves, however many nodes it takes
    for (const root of roots) {
      make(pos, root.move);
      // One look ahead: the reply is judged only by the captures that follow, but a move that mates is seen.
      root.score = inCheck(pos) && !hasLegalMove(pos) ? MATE : -negamax(pos, 0, -INF, INF, 1);
      unmake(pos);
    }
    roots.sort((a, b) => b.score - a.score);
    const best = (roots[0] as Scored).score;
    const roll = rng();
    let chosen: Scored;
    if (roll < 0.12 && best < MATE - 100) chosen = roots[Math.floor(rng() * roots.length)] as Scored; // a slip
    else {
      const top = roots.slice(0, 3).filter((root) => root.score >= best - 120);
      chosen = top[Math.floor(rng() * top.length)] as Scored;
    }
    return { move: chosen.move, score: chosen.score, nodes, depth: 1 };
  }

  budget = NODE_BUDGET[level];
  let bestMove = (roots[0] as Scored).move, bestScore = 0, reached = 0;
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    // The first pass is allowed to finish whatever it costs; later ones stop when the budget is spent.
    if (depth === 1) budget = 0; else budget = NODE_BUDGET[level];
    let alpha = -INF, iterationBest = -INF, iterationMove = 0, finished = 0;
    for (const root of roots) {
      make(pos, root.move);
      const score = -negamax(pos, depth - 1, -INF, -alpha, 1);
      unmake(pos);
      if (stopped) break;
      root.score = score;
      finished += 1;
      if (score > iterationBest) { iterationBest = score; iterationMove = root.move; }
      if (score > alpha) alpha = score;
    }
    // A pass cut short still counts when it re-searched the previous best move first and found something at least as good.
    if (finished > 0 && iterationMove) { bestMove = iterationMove; bestScore = iterationBest; reached = depth - (stopped ? 1 : 0); }
    if (stopped) break;
    // Best move first for the next pass.
    const at = roots.findIndex((root) => root.move === bestMove);
    if (at > 0) roots.unshift(roots.splice(at, 1)[0] as Scored);
    if (Math.abs(bestScore) > MATE - MAX_PLY || nodes >= NODE_BUDGET[level]) break;
  }
  budget = 0;
  return { move: bestMove, score: bestScore, nodes, depth: reached };
}
