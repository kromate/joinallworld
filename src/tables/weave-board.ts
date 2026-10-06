/**
 * Weave: the board, its premium squares and the scoring of a placement. Client-safe: no word list
 * is imported here. The rules module and the browser's live score preview both use these functions,
 * so the geometry and the arithmetic exist in one place only.
 *
 * BOARD  13 x 13 squares, row 0 at the top. A board is 13 strings of 13 characters: '.' is an empty
 * square, a lowercase letter is a tile, an UPPERCASE letter is a blank standing for that letter.
 *
 * PREMIUMS  The pattern turns into itself when the board is turned a quarter of a way round (see
 * PREMIUM_ROWS). Double and triple letters (DL, TL) multiply one new tile; double and triple words
 * (DW, TW) multiply every word that covers a new tile on them, and stack by multiplying.
 */
import { LETTER_VALUES } from './weave-letters.ts';

export { LETTER_VALUES };
export const SIZE = 13;
export const RACK_SIZE = 7;
/** Playing the whole rack in one turn adds this many points. */
export const BINGO_BONUS = 30;
/** The square the first word must cover; it counts as a double word. */
export const CENTRE: Readonly<{ r: number; c: number }> = Object.freeze({ r: 6, c: 6 });

export type Premium = 'DL' | 'TL' | 'DW' | 'TW';
export type Board = readonly string[];
/** A tile put on a square. For a blank, `l` is the letter it stands for and `blank` is true. */
export interface Placement { r: number; c: number; l: string; blank?: boolean }
export interface PlayedWord { word: string; points: number; r: number; c: number; across: boolean }
export interface PlayScore { ok: boolean; error: string | null; points: number; bonus: number; words: PlayedWord[] }

/** Short names for the premium squares, for the legend. */
export const PREMIUM_LABELS: Readonly<Record<Premium, string>> = Object.freeze({ DL: 'Double letter', TL: 'Triple letter', DW: 'Double word', TW: 'Triple word' });

// One eighth of the pattern is listed; turning it a quarter of the way round three times gives the rest.
const SEEDS: Readonly<Record<Premium, readonly (readonly [number, number])[]>> = {
  TW: [[3, 3], [2, 6]],
  DW: [[1, 1], [4, 4], [1, 5], [6, 6]],
  TL: [[5, 5], [0, 4], [2, 2]],
  DL: [[0, 0], [3, 6], [6, 4], [4, 1]],
};
const CODES: Readonly<Record<Premium, string>> = { DL: 'd', TL: 't', DW: 'D', TW: 'T' };

function buildPremiumRows(): string[] {
  const grid = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'));
  for (const kind of Object.keys(SEEDS) as Premium[]) {
    for (const [r0, c0] of SEEDS[kind]) {
      let r = r0, c = c0;
      for (let turn = 0; turn < 4; turn++) {
        (grid[r] as string[])[c] = CODES[kind];
        [r, c] = [c, SIZE - 1 - r]; // a quarter turn
      }
    }
  }
  return grid.map((row) => row.join(''));
}
/** The premium squares, row by row: '.' none, 'd' double letter, 't' triple letter, 'D' double word, 'T' triple word. */
export const PREMIUM_ROWS: readonly string[] = Object.freeze(buildPremiumRows());

export function premiumAt(r: number, c: number): Premium | null {
  switch (PREMIUM_ROWS[r]?.[c]) {
    case 'd': return 'DL';
    case 't': return 'TL';
    case 'D': return 'DW';
    case 'T': return 'TW';
    default: return null;
  }
}

export const tileValue = (letter: string): number => LETTER_VALUES[letter.toLowerCase()] ?? 0;
export const emptyBoard = (): string[] => Array.from({ length: SIZE }, () => '.'.repeat(SIZE));
const inside = (r: number, c: number): boolean => Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < SIZE && c < SIZE;
/** The character on a square; '.' for an empty one or one off the board. */
export const cellAt = (board: Board, r: number, c: number): string => (inside(r, c) ? board[r]?.[c] ?? '.' : '.');
export const isBlankTile = (cell: string): boolean => cell >= 'A' && cell <= 'Z';
export const boardIsEmpty = (board: Board): boolean => board.every((row) => /^\.*$/.test(row));
/** How many tiles are on the board. */
export const tilesOnBoard = (board: Board): number => board.reduce((sum, row) => sum + row.replace(/\./g, '').length, 0);

/** A new board with the tiles put down (blanks as uppercase letters). Does not check anything. */
export function placeTiles(board: Board, placements: readonly Placement[]): string[] {
  const grid = board.map((row) => row.split(''));
  for (const p of placements) {
    const row = grid[p.r];
    if (row && inside(p.r, p.c)) row[p.c] = p.blank ? p.l.toUpperCase() : p.l.toLowerCase();
  }
  return grid.map((row) => row.join(''));
}

/** The geometric rules for a play, with no word list: an error sentence for the player, or null when the shape is fine. */
export function checkShape(board: Board, placements: readonly Placement[]): string | null {
  if (placements.length === 0) return 'Place at least one tile.';
  const seen = new Set<number>();
  for (const p of placements) {
    if (!inside(p.r, p.c)) return 'That square is off the board.';
    if (typeof p.l !== 'string' || !/^[a-z]$/.test(p.l)) return 'Tiles carry the letters a to z.';
    if (cellAt(board, p.r, p.c) !== '.') return 'That square already holds a tile.';
    const key = p.r * SIZE + p.c;
    if (seen.has(key)) return 'Two tiles cannot go on the same square.';
    seen.add(key);
  }
  const first = placements[0] as Placement;
  const sameRow = placements.every((p) => p.r === first.r), sameCol = placements.every((p) => p.c === first.c);
  if (!sameRow && !sameCol) return 'Those tiles must be in one row or one column.';
  if (placements.length > 1) {
    const across = sameRow;
    const at = (p: Placement) => (across ? p.c : p.r);
    const lo = Math.min(...placements.map(at)), hi = Math.max(...placements.map(at));
    for (let i = lo; i <= hi; i++) {
      const filled = across ? cellAt(board, first.r, i) !== '.' : cellAt(board, i, first.c) !== '.';
      if (!filled && !seen.has(across ? first.r * SIZE + i : i * SIZE + first.c)) return 'Tiles must make one unbroken line, with no gaps.';
    }
  }
  if (boardIsEmpty(board)) {
    if (!seen.has(CENTRE.r * SIZE + CENTRE.c)) return 'The first word must cover the centre square.';
    if (placements.length < 2) return 'The first word needs at least two letters.';
    return null;
  }
  const joins = placements.some((p) => cellAt(board, p.r - 1, p.c) !== '.' || cellAt(board, p.r + 1, p.c) !== '.' || cellAt(board, p.r, p.c - 1) !== '.' || cellAt(board, p.r, p.c + 1) !== '.');
  return joins ? null : 'Your word must join the tiles already on the board.';
}

/** A word on the board after a play: where it starts and each square of it. */
export interface FormedWord { word: string; r: number; c: number; across: boolean; cells: { r: number; c: number; ch: string; fresh: boolean }[] }

function wordThrough(grid: Board, r: number, c: number, across: boolean, fresh: ReadonlySet<number>): FormedWord {
  const dr = across ? 0 : 1, dc = across ? 1 : 0;
  let sr = r, sc = c;
  while (cellAt(grid, sr - dr, sc - dc) !== '.') { sr -= dr; sc -= dc; }
  const cells: FormedWord['cells'] = [];
  for (let rr = sr, cc = sc; cellAt(grid, rr, cc) !== '.'; rr += dr, cc += dc) cells.push({ r: rr, c: cc, ch: cellAt(grid, rr, cc), fresh: fresh.has(rr * SIZE + cc) });
  return { word: cells.map((cell) => cell.ch.toLowerCase()).join(''), r: sr, c: sc, across, cells };
}

/** Every word (two letters or more) a play forms, main word first. Assumes the shape is fine (see checkShape). */
export function formWords(board: Board, placements: readonly Placement[]): FormedWord[] {
  if (placements.length === 0) return [];
  const grid = placeTiles(board, placements);
  const fresh = new Set(placements.map((p) => p.r * SIZE + p.c));
  const first = placements[0] as Placement;
  const across = placements.length > 1 ? placements.every((p) => p.r === first.r) : true;
  const words: FormedWord[] = [];
  const main = wordThrough(grid, first.r, first.c, across, fresh);
  if (main.cells.length >= 2) words.push(main);
  for (const p of placements) {
    const cross = wordThrough(grid, p.r, p.c, !across, fresh);
    if (cross.cells.length >= 2) words.push(cross);
  }
  return words;
}

function pointsOf(word: FormedWord): number {
  let sum = 0, multiplier = 1;
  for (const cell of word.cells) {
    let value = isBlankTile(cell.ch) ? 0 : tileValue(cell.ch);
    if (cell.fresh) {
      const premium = premiumAt(cell.r, cell.c);
      if (premium === 'DL') value *= 2;
      else if (premium === 'TL') value *= 3;
      else if (premium === 'DW') multiplier *= 2;
      else if (premium === 'TW') multiplier *= 3;
    }
    sum += value;
  }
  return sum * multiplier;
}

/** What a tentative placement would score, with NO word list check (the words may not exist). `ok` is false, with `error`, when the shape is wrong. */
export function scorePlay(board: Board, placements: readonly Placement[]): PlayScore {
  const error = checkShape(board, placements);
  if (error) return { ok: false, error, points: 0, bonus: 0, words: [] };
  const words = formWords(board, placements).map((word): PlayedWord => ({ word: word.word, points: pointsOf(word), r: word.r, c: word.c, across: word.across }));
  const bonus = placements.length === RACK_SIZE ? BINGO_BONUS : 0;
  return { ok: true, error: null, points: words.reduce((sum, word) => sum + word.points, 0) + bonus, bonus, words };
}
