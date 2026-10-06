/**
 * OWNER: growth
 * Chess, the pure core: positions, legal moves, making moves, standard notation, draws by rule.
 *
 * A position is a 64-entry board indexed a8 = 0 … h1 = 63 (so a white pawn moves by -8). A piece is
 * its type (1 pawn … 6 king) plus 8 for black; 0 is an empty square. A move is one integer:
 * from | to << 6 | promotion type << 12 | flags << 15. Nothing here reads a clock or draws a random number.
 *
 * Draws by rule are the caller's to apply, using what this file measures: `positionKey` (equal keys =
 * the same position for the threefold rule), `Position.half` (the halfmove clock: at 100 plies without
 * a capture or a pawn move the game is drawn, automatically, with no claim) and `insufficientMaterial`.
 */

export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 0, BLACK = 1;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Castling rights, as bits. */
export const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;
/** Move flags (above bit 15). */
export const FLAG_EP = 1, FLAG_CASTLE = 2, FLAG_DOUBLE = 4;

const STACK = 1024;

export interface Position {
  board: Int8Array
  /** 0 white to move, 1 black. */
  turn: 0 | 1
  castling: number
  /** The square a pawn passed over with its last two-step move, or -1. */
  ep: number
  /** Plies since the last capture or pawn move. */
  half: number
  full: number
  king: [number, number]
  sp: number
  uMove: Int32Array
  uCaptured: Int8Array
  uCastling: Int8Array
  uEp: Int8Array
  uHalf: Int16Array
}

// ---------------------------------------------------------------------------------------- squares

const FILES = 'abcdefgh';
export const squareName = (square: number): string => `${FILES[square & 7]}${8 - (square >> 3)}`;
/** 'e4' → 36, or -1 when it is not a square. */
export function squareIndex(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) return -1;
  return (8 - Number(name[1])) * 8 + FILES.indexOf(name[0] as string);
}
export const moveFrom = (move: number): number => move & 63;
export const moveTo = (move: number): number => (move >> 6) & 63;
export const movePromo = (move: number): number => (move >> 12) & 7;
export const moveFlags = (move: number): number => move >> 15;
export const makeMoveInt = (from: number, to: number, promo = 0, flags = 0): number => from | (to << 6) | (promo << 12) | (flags << 15);

const TYPE_LETTER = ' PNBRQK';
/** 'wP', 'bK' … for a piece; null for an empty square. */
export const pieceName = (piece: number): string | null => (piece === 0 ? null : `${piece >> 3 ? 'b' : 'w'}${TYPE_LETTER[piece & 7]}`);

// ---------------------------------------------------------------------------------------- tables

/** Row and file steps: N, S, E, W (rook rays 0–3), then NE, NW, SE, SW (bishop rays 4–7). */
const STEPS: readonly (readonly [number, number])[] = [[-1, 0], [1, 0], [0, 1], [0, -1], [-1, 1], [-1, -1], [1, 1], [1, -1]];
const RAYS: Int8Array[][] = [];
const KNIGHT_TO: Int8Array[] = [];
const KING_TO: Int8Array[] = [];
const PAWN_ATTACKS: [Int8Array[], Int8Array[]] = [[], []];
const CASTLE_MASK = new Int8Array(64).fill(15);

(function buildTables() {
  const onBoard = (row: number, file: number) => row >= 0 && row < 8 && file >= 0 && file < 8;
  for (let square = 0; square < 64; square++) {
    const row = square >> 3, file = square & 7;
    RAYS.push(STEPS.map(([dr, df]) => {
      const list: number[] = [];
      for (let r = row + dr, f = file + df; onBoard(r, f); r += dr, f += df) list.push(r * 8 + f);
      return Int8Array.from(list);
    }));
    const near = (steps: readonly (readonly [number, number])[]) => Int8Array.from(steps.filter(([dr, df]) => onBoard(row + dr, file + df)).map(([dr, df]) => (row + dr) * 8 + file + df));
    KNIGHT_TO.push(near([[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]));
    KING_TO.push(near(STEPS));
    PAWN_ATTACKS[0].push(near([[-1, -1], [-1, 1]]));
    PAWN_ATTACKS[1].push(near([[1, -1], [1, 1]]));
  }
  CASTLE_MASK[60] = ~(CASTLE_WK | CASTLE_WQ); CASTLE_MASK[63] = ~CASTLE_WK; CASTLE_MASK[56] = ~CASTLE_WQ;
  CASTLE_MASK[4] = ~(CASTLE_BK | CASTLE_BQ); CASTLE_MASK[7] = ~CASTLE_BK; CASTLE_MASK[0] = ~CASTLE_BQ;
})();

export const rayTable = (square: number, direction: number): Int8Array => (RAYS[square] as Int8Array[])[direction] as Int8Array; // tables cover every square and direction
export const knightTargets = (square: number): Int8Array => KNIGHT_TO[square] as Int8Array;

// ---------------------------------------------------------------------------------------- positions

function blank(): Position {
  return {
    board: new Int8Array(64), turn: WHITE, castling: 0, ep: -1, half: 0, full: 1, king: [-1, -1], sp: 0,
    uMove: new Int32Array(STACK), uCaptured: new Int8Array(STACK), uCastling: new Int8Array(STACK), uEp: new Int8Array(STACK), uHalf: new Int16Array(STACK),
  };
}

/** An independent copy (the undo stack is not carried over). */
export function clonePosition(from: Position): Position {
  const pos = blank();
  pos.board.set(from.board);
  pos.turn = from.turn; pos.castling = from.castling; pos.ep = from.ep; pos.half = from.half; pos.full = from.full; pos.king = [from.king[0], from.king[1]];
  return pos;
}

const FEN_PIECES = 'pnbrqk';

/** Reads a FEN; throws an Error for text that is not a position with one king a side. */
export function parseFen(fen: string): Position {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4 || fields.length > 6) throw new Error('A FEN has four to six fields.');
  const [placement = '', turn = '', rights = '', target = '', half = '0', full = '1'] = fields;
  const pos = blank();
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error('A FEN has eight ranks.');
  const kings = [0, 0];
  rows.forEach((text, row) => {
    let file = 0;
    for (const letter of text) {
      if (/[1-8]/.test(letter)) { file += Number(letter); continue; }
      const type = FEN_PIECES.indexOf(letter.toLowerCase()) + 1;
      if (type === 0 || file > 7) throw new Error('A FEN rank is not valid.');
      const colour = letter === letter.toUpperCase() ? WHITE : BLACK;
      if (type === PAWN && (row === 0 || row === 7)) throw new Error('A pawn cannot stand on the first or last rank.');
      pos.board[row * 8 + file] = type | (colour << 3);
      if (type === KING) { kings[colour] = (kings[colour] as number) + 1; pos.king[colour] = row * 8 + file; }
      file += 1;
    }
    if (file !== 8) throw new Error('A FEN rank does not have eight squares.');
  });
  if (kings[0] !== 1 || kings[1] !== 1) throw new Error('Each side needs exactly one king.');
  if (turn !== 'w' && turn !== 'b') throw new Error('A FEN says w or b to move.');
  pos.turn = turn === 'w' ? WHITE : BLACK;
  const has = (square: number, piece: number) => pos.board[square] === piece;
  // A right is kept only when the king and the rook really stand on their home squares.
  if (rights.includes('K') && has(60, KING) && has(63, ROOK)) pos.castling |= CASTLE_WK;
  if (rights.includes('Q') && has(60, KING) && has(56, ROOK)) pos.castling |= CASTLE_WQ;
  if (rights.includes('k') && has(4, KING | 8) && has(7, ROOK | 8)) pos.castling |= CASTLE_BK;
  if (rights.includes('q') && has(4, KING | 8) && has(0, ROOK | 8)) pos.castling |= CASTLE_BQ;
  pos.ep = target === '-' ? -1 : squareIndex(target);
  if (target !== '-' && pos.ep < 0) throw new Error('A FEN en passant square is not valid.');
  pos.half = Math.max(0, Number.parseInt(half, 10) || 0);
  pos.full = Math.max(1, Number.parseInt(full, 10) || 1);
  // The side that just moved must not have left the other king capturable.
  if (isAttacked(pos, pos.king[1 - pos.turn as 0 | 1], pos.turn)) throw new Error('The side not to move is in check.');
  return pos;
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let row = 0; row < 8; row++) {
    let text = '', empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = pos.board[row * 8 + file] as number;
      if (piece === 0) { empty += 1; continue; }
      if (empty) { text += empty; empty = 0; }
      const letter = FEN_PIECES[(piece & 7) - 1] as string;
      text += piece >> 3 ? letter : letter.toUpperCase();
    }
    rows.push(text + (empty || ''));
  }
  const rights = (pos.castling & CASTLE_WK ? 'K' : '') + (pos.castling & CASTLE_WQ ? 'Q' : '') + (pos.castling & CASTLE_BK ? 'k' : '') + (pos.castling & CASTLE_BQ ? 'q' : '');
  return `${rows.join('/')} ${pos.turn === WHITE ? 'w' : 'b'} ${rights || '-'} ${pos.ep < 0 ? '-' : squareName(pos.ep)} ${pos.half} ${pos.full}`;
}

// ---------------------------------------------------------------------------------------- attacks

/** True when a piece of colour `by` attacks `square`. */
export function isAttacked(pos: Position, square: number, by: number): boolean {
  const board = pos.board, colour = by << 3;
  for (const from of PAWN_ATTACKS[1 - by as 0 | 1][square] as Int8Array) if (board[from] === (PAWN | colour)) return true;
  for (const from of KNIGHT_TO[square] as Int8Array) if (board[from] === (KNIGHT | colour)) return true;
  for (const from of KING_TO[square] as Int8Array) if (board[from] === (KING | colour)) return true;
  const rays = RAYS[square] as Int8Array[];
  for (let direction = 0; direction < 8; direction++) {
    const line = rays[direction] as Int8Array;
    for (let i = 0; i < line.length; i++) {
      const piece = board[line[i] as number] as number;
      if (piece === 0) continue;
      if ((piece & 8) === colour) {
        const type = piece & 7;
        if (type === QUEEN || type === (direction < 4 ? ROOK : BISHOP)) return true;
      }
      break;
    }
  }
  return false;
}

export const inCheck = (pos: Position): boolean => isAttacked(pos, pos.king[pos.turn], 1 - pos.turn);

// ---------------------------------------------------------------------------------------- generation

/**
 * Pseudo-legal moves of the side to move, written to `out` from index `offset`; returns the index after
 * the last. With `capturesOnly`, only captures and promotions. The mover's own king may be left in check:
 * `make` + `leftInCheck` filters those.
 */
export function generate(pos: Position, out: Int32Array, offset: number, capturesOnly: boolean): number {
  const board = pos.board, us = pos.turn, them = 1 - us;
  let n = offset;
  for (let from = 0; from < 64; from++) {
    const piece = board[from] as number;
    if (piece === 0 || (piece >> 3) !== us) continue;
    const type = piece & 7;
    if (type === PAWN) {
      const forward = us === WHITE ? -8 : 8, startRow = us === WHITE ? 6 : 1, lastRow = us === WHITE ? 0 : 7;
      const one = from + forward;
      if (board[one] === 0) {
        if ((one >> 3) === lastRow) { out[n++] = from | (one << 6) | (QUEEN << 12); out[n++] = from | (one << 6) | (KNIGHT << 12); out[n++] = from | (one << 6) | (ROOK << 12); out[n++] = from | (one << 6) | (BISHOP << 12); }
        else if (!capturesOnly) {
          out[n++] = from | (one << 6);
          if ((from >> 3) === startRow && board[one + forward] === 0) out[n++] = from | ((one + forward) << 6) | (FLAG_DOUBLE << 15);
        }
      }
      for (const to of PAWN_ATTACKS[us][from] as Int8Array) {
        const target = board[to] as number;
        if (target !== 0 && (target >> 3) === them) {
          if ((to >> 3) === lastRow) { out[n++] = from | (to << 6) | (QUEEN << 12); out[n++] = from | (to << 6) | (KNIGHT << 12); out[n++] = from | (to << 6) | (ROOK << 12); out[n++] = from | (to << 6) | (BISHOP << 12); }
          else out[n++] = from | (to << 6);
        } else if (to === pos.ep && target === 0) out[n++] = from | (to << 6) | (FLAG_EP << 15);
      }
    } else if (type === KNIGHT || type === KING) {
      for (const to of (type === KNIGHT ? KNIGHT_TO : KING_TO)[from] as Int8Array) {
        const target = board[to] as number;
        if (target === 0 ? !capturesOnly : (target >> 3) === them) out[n++] = from | (to << 6);
      }
    } else {
      const first = type === BISHOP ? 4 : 0, last = type === ROOK ? 4 : 8;
      const rays = RAYS[from] as Int8Array[];
      for (let direction = first; direction < last; direction++) {
        const line = rays[direction] as Int8Array;
        for (let i = 0; i < line.length; i++) {
          const to = line[i] as number, target = board[to] as number;
          if (target === 0) { if (!capturesOnly) out[n++] = from | (to << 6); continue; }
          if ((target >> 3) === them) out[n++] = from | (to << 6);
          break;
        }
      }
    }
  }
  if (!capturesOnly && pos.castling) {
    const empty = (...squares: number[]) => squares.every((square) => board[square] === 0);
    const safe = (...squares: number[]) => squares.every((square) => !isAttacked(pos, square, them));
    if (us === WHITE) {
      if ((pos.castling & CASTLE_WK) && empty(61, 62) && safe(60, 61, 62)) out[n++] = 60 | (62 << 6) | (FLAG_CASTLE << 15);
      if ((pos.castling & CASTLE_WQ) && empty(57, 58, 59) && safe(60, 59, 58)) out[n++] = 60 | (58 << 6) | (FLAG_CASTLE << 15);
    } else {
      if ((pos.castling & CASTLE_BK) && empty(5, 6) && safe(4, 5, 6)) out[n++] = 4 | (6 << 6) | (FLAG_CASTLE << 15);
      if ((pos.castling & CASTLE_BQ) && empty(1, 2, 3) && safe(4, 3, 2)) out[n++] = 4 | (2 << 6) | (FLAG_CASTLE << 15);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------------------- making moves

/** Plays a (pseudo-legal) move; `unmake` takes it back. */
export function make(pos: Position, move: number): void {
  const board = pos.board, from = move & 63, to = (move >> 6) & 63, promo = (move >> 12) & 7, flags = move >> 15;
  const piece = board[from] as number, us = piece >> 3, type = piece & 7;
  const captureSquare = flags & FLAG_EP ? (us === WHITE ? to + 8 : to - 8) : to;
  const captured = board[captureSquare] as number;
  const sp = pos.sp++;
  pos.uMove[sp] = move; pos.uCaptured[sp] = captured; pos.uCastling[sp] = pos.castling; pos.uEp[sp] = pos.ep; pos.uHalf[sp] = pos.half;
  board[captureSquare] = 0;
  board[from] = 0;
  board[to] = promo ? promo | (us << 3) : piece;
  if (flags & FLAG_CASTLE) {
    const rookFrom = to > from ? from + 3 : from - 4, rookTo = to > from ? from + 1 : from - 1;
    board[rookTo] = board[rookFrom] as number;
    board[rookFrom] = 0;
  }
  if (type === KING) pos.king[us] = to;
  pos.castling &= (CASTLE_MASK[from] as number) & (CASTLE_MASK[to] as number);
  pos.ep = flags & FLAG_DOUBLE ? (from + to) >> 1 : -1;
  pos.half = type === PAWN || captured !== 0 ? 0 : pos.half + 1;
  if (us === BLACK) pos.full += 1;
  pos.turn = (1 - us) as 0 | 1;
}

export function unmake(pos: Position): void {
  const board = pos.board, sp = --pos.sp, move = pos.uMove[sp] as number;
  const from = move & 63, to = (move >> 6) & 63, promo = (move >> 12) & 7, flags = move >> 15;
  const us = 1 - pos.turn as 0 | 1;
  const piece = promo ? PAWN | (us << 3) : board[to] as number;
  const captured = pos.uCaptured[sp] as number;
  board[to] = 0;
  board[from] = piece;
  board[flags & FLAG_EP ? (us === WHITE ? to + 8 : to - 8) : to] = captured;
  if (flags & FLAG_CASTLE) {
    const rookFrom = to > from ? from + 3 : from - 4, rookTo = to > from ? from + 1 : from - 1;
    board[rookFrom] = board[rookTo] as number;
    board[rookTo] = 0;
  }
  if ((piece & 7) === KING) pos.king[us] = from;
  pos.castling = pos.uCastling[sp] as number; pos.ep = pos.uEp[sp] as number; pos.half = pos.uHalf[sp] as number;
  if (us === BLACK) pos.full -= 1;
  pos.turn = us;
}

/** After `make`: did the side that just moved leave its own king attacked? */
export const leftInCheck = (pos: Position): boolean => isAttacked(pos, pos.king[pos.turn === WHITE ? BLACK : WHITE], pos.turn);

const scratch = new Int32Array(256);

/** Every legal move of the side to move. */
export function legalMoves(pos: Position): number[] {
  const count = generate(pos, scratch, 0, false), list: number[] = [];
  for (let i = 0; i < count; i++) {
    const move = scratch[i] as number;
    make(pos, move);
    if (!leftInCheck(pos)) list.push(move);
    unmake(pos);
  }
  return list;
}

export function hasLegalMove(pos: Position): boolean {
  const count = generate(pos, scratch, 0, false);
  for (let i = 0; i < count; i++) {
    make(pos, scratch[i] as number);
    const legal = !leftInCheck(pos);
    unmake(pos);
    if (legal) return true;
  }
  return false;
}

/** The position after a legal move, as a new object. */
export function after(pos: Position, move: number): Position {
  const next = clonePosition(pos);
  make(next, move);
  return next;
}

// ---------------------------------------------------------------------------------------- notation

const LETTERS = ' PNBRQK';

/** Standard algebraic notation of a legal move in `pos`: Nf3, exd5, O-O, e8=Q+, Rae1, Qh4xe1#. */
export function san(pos: Position, move: number): string {
  const from = move & 63, to = (move >> 6) & 63, promo = (move >> 12) & 7, flags = move >> 15;
  const piece = pos.board[from] as number, type = piece & 7;
  let text: string;
  if (flags & FLAG_CASTLE) text = to > from ? 'O-O' : 'O-O-O';
  else {
    const capture = pos.board[to] !== 0 || (flags & FLAG_EP) !== 0;
    if (type === PAWN) text = (capture ? FILES[from & 7] + 'x' : '') + squareName(to) + (promo ? '=' + LETTERS[promo] : '');
    else {
      let from1 = '';
      const rivals = legalMoves(pos).filter((other) => other !== move && (other >> 6 & 63) === to && (pos.board[other & 63] as number) === piece);
      if (rivals.length) {
        const sameFile = rivals.some((other) => (other & 7) === (from & 7)), sameRow = rivals.some((other) => ((other & 63) >> 3) === (from >> 3));
        if (!sameFile) from1 = FILES[from & 7] as string;
        else if (!sameRow) from1 = String(8 - (from >> 3));
        else from1 = squareName(from);
      }
      text = LETTERS[type] + from1 + (capture ? 'x' : '') + squareName(to);
    }
  }
  make(pos, move);
  const check = inCheck(pos), mate = check && !hasLegalMove(pos);
  unmake(pos);
  return text + (mate ? '#' : check ? '+' : '');
}

// ---------------------------------------------------------------------------------------- game status

/** True when no series of legal moves could end in checkmate: K v K, K+minor v K, bishops all on one colour of square. */
export function insufficientMaterial(pos: Position): boolean {
  let minors = 0, knights = 0, light = 0, dark = 0;
  for (let square = 0; square < 64; square++) {
    const type = (pos.board[square] as number) & 7;
    if (type === 0 || type === KING) continue;
    if (type !== KNIGHT && type !== BISHOP) return false;
    minors += 1;
    if (type === KNIGHT) knights += 1;
    else if (((square >> 3) + (square & 7)) & 1) dark += 1;
    else light += 1;
  }
  if (minors <= 1) return true;
  return knights === 0 && (light === 0 || dark === 0);
}

/** Can this colour ever give mate, going by its own pieces alone: a pawn, rook, queen or two minor pieces. */
export function hasMatingMaterial(pos: Position, colour: number): boolean {
  let minors = 0;
  for (let square = 0; square < 64; square++) {
    const piece = pos.board[square] as number;
    if (piece === 0 || (piece >> 3) !== colour) continue;
    const type = piece & 7;
    if (type === PAWN || type === ROOK || type === QUEEN) return true;
    if (type === KNIGHT || type === BISHOP) minors += 1;
  }
  return minors >= 2;
}

/**
 * Identity of a position for the threefold rule: placement, side to move, castling rights and the
 * en passant square only when a legal en passant capture exists.
 */
export function positionKey(pos: Position): string {
  const parts = toFen(pos).split(' ');
  let target = '-';
  if (pos.ep >= 0 && legalMoves(pos).some((move) => (move >> 15 & FLAG_EP) !== 0)) target = squareName(pos.ep);
  return `${parts[0]} ${parts[1]} ${parts[2]} ${target}`;
}

/** Legal-move nodes at exactly `depth` plies from a FEN. */
export function perft(fen: string, depth: number): number {
  const pos = parseFen(fen), buffers: Int32Array[] = [];
  for (let i = 0; i <= depth; i++) buffers.push(new Int32Array(256));
  const walk = (left: number): number => {
    const list = buffers[left] as Int32Array, count = generate(pos, list, 0, false);
    let total = 0;
    for (let i = 0; i < count; i++) {
      make(pos, list[i] as number);
      if (!leftInCheck(pos)) total += left === 1 ? 1 : walk(left - 1);
      unmake(pos);
    }
    return total;
  };
  return depth <= 0 ? 1 : walk(depth);
}
