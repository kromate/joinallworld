import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINGO_BONUS, CENTRE, PREMIUM_ROWS, SIZE, checkShape, emptyBoard, placeTiles, premiumAt, scorePlay, tileValue } from './weave-board.ts';
import type { Placement } from './weave-board.ts';
import { BAG_SIZE, LETTER_COUNTS, LETTER_VALUES, fullBag } from './weave-letters.ts';

/** Tiles spelling `word` along a row or column starting at (r, c). */
const spell = (word: string, r: number, c: number, across = true): Placement[] => [...word].map((l, i) => ({ r: across ? r : r + i, c: across ? c + i : c, l }));
const at = (r: number, c: number): string => PREMIUM_ROWS[r]?.[c] ?? '';

test('the layout is 13 x 13 and turns into itself under quarter turns', () => {
  assert.equal(SIZE, 13);
  assert.equal(PREMIUM_ROWS.length, 13);
  for (const row of PREMIUM_ROWS) assert.equal(row.length, 13);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) assert.equal(at(r, c), at(c, SIZE - 1 - r), `square ${r},${c}`);
});

test('the centre is the double-word start square and no triple word sits on a corner or an edge midpoint', () => {
  assert.deepEqual(CENTRE, { r: 6, c: 6 });
  assert.equal(premiumAt(6, 6), 'DW');
  for (const [r, c] of [[0, 0], [0, 12], [12, 0], [12, 12], [0, 6], [6, 0], [6, 12], [12, 6]] as const) assert.notEqual(premiumAt(r, c), 'TW');
});

test('the premium counts: 8 triple words, 12 double words and the start, 12 triple letters, 16 double letters', () => {
  const tally: Record<string, number> = {};
  for (const row of PREMIUM_ROWS) for (const ch of row) tally[ch] = (tally[ch] ?? 0) + 1;
  assert.equal(tally['T'], 8);
  assert.equal(tally['D'], 13);
  assert.equal(tally['t'], 12);
  assert.equal(tally['d'], 16);
  assert.equal(premiumAt(0, 12), 'DL');
  assert.equal(premiumAt(20, 20), null);
});

test('the bag holds 98 tiles: 96 letters and 2 blanks, with 35 vowels', () => {
  const bag = fullBag();
  assert.equal(bag.length, BAG_SIZE);
  assert.equal(bag.filter((tile) => tile === '?').length, 2);
  assert.equal(Object.values(LETTER_COUNTS).reduce((a, b) => a + b, 0), 98);
  assert.equal(bag.filter((tile) => 'aeiou'.includes(tile)).length, 35);
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') assert.ok((LETTER_COUNTS[letter] ?? 0) >= 1, letter);
});

test('values rise with rarity and a blank is worth nothing', () => {
  assert.equal(LETTER_VALUES['?'], 0);
  assert.equal(tileValue('e'), 1);
  assert.equal(tileValue('Q'), 10);
  assert.ok(tileValue('z') > tileValue('k') && tileValue('k') > tileValue('d') && tileValue('d') >= tileValue('e'));
  assert.ok(Math.max(...Object.values(LETTER_VALUES)) <= 10);
});

test('shape: tiles must be in one row or one column', () => {
  assert.equal(checkShape(emptyBoard(), [{ r: 6, c: 6, l: 'a' }, { r: 7, c: 7, l: 'b' }]), 'Those tiles must be in one row or one column.');
});

test('shape: gaps, range, occupied squares, duplicates, letters', () => {
  const board = placeTiles(emptyBoard(), spell('cat', 6, 5));
  assert.equal(checkShape(board, [{ r: 5, c: 5, l: 'a' }, { r: 5, c: 8, l: 'b' }]), 'Tiles must make one unbroken line, with no gaps.');
  assert.equal(checkShape(board, [{ r: 13, c: 5, l: 'a' }]), 'That square is off the board.');
  assert.equal(checkShape(board, [{ r: -1, c: 5, l: 'a' }]), 'That square is off the board.');
  assert.equal(checkShape(board, [{ r: 6, c: 5, l: 'a' }]), 'That square already holds a tile.');
  assert.equal(checkShape(board, [{ r: 5, c: 5, l: 'a' }, { r: 5, c: 5, l: 'b' }]), 'Two tiles cannot go on the same square.');
  assert.equal(checkShape(board, [{ r: 5, c: 5, l: '1' }]), 'Tiles carry the letters a to z.');
  assert.equal(checkShape(board, []), 'Place at least one tile.');
});

test('shape: a line may run through tiles already there', () => {
  const board = placeTiles(emptyBoard(), spell('cat', 6, 5));
  assert.equal(checkShape(board, [{ r: 6, c: 4, l: 's' }, { r: 6, c: 8, l: 's' }]), null);
  assert.equal(checkShape(board, [{ r: 4, c: 5, l: 'x' }, { r: 5, c: 5, l: 'y' }]), null);
});

test('shape: the first word covers the centre and has two letters; later plays join the cloth', () => {
  assert.equal(checkShape(emptyBoard(), spell('ab', 0, 0)), 'The first word must cover the centre square.');
  assert.equal(checkShape(emptyBoard(), [{ r: 6, c: 6, l: 'a' }]), 'The first word needs at least two letters.');
  assert.equal(checkShape(emptyBoard(), spell('ab', 6, 5)), null);
  assert.equal(checkShape(emptyBoard(), spell('ab', 5, 6, false)), null);
  const board = placeTiles(emptyBoard(), spell('cat', 6, 5));
  assert.equal(checkShape(board, spell('dog', 0, 0)), 'Your word must join the tiles already on the board.');
  assert.equal(checkShape(board, spell('dog', 8, 5)), 'Your word must join the tiles already on the board.');
  assert.equal(checkShape(board, spell('dog', 7, 5)), null);
});

test('scoring: letter premiums count only for new tiles; the first word gets the centre double word', () => {
  assert.equal(at(6, 4), 'd');
  assert.equal(at(6, 5), '.');
  assert.equal(at(6, 6), 'D');
  const score = scorePlay(emptyBoard(), spell('cab', 6, 4));
  // c(3) on a double letter = 6, a = 1, b = 3 on the centre: 10, doubled.
  assert.equal(score.points, 20);
  assert.deepEqual(score.words.map((w) => w.word), ['cab']);
});

test('scoring: an old tile on a premium square counts plainly', () => {
  const board = placeTiles(emptyBoard(), spell('cab', 6, 4));
  const score = scorePlay(board, spell('s', 6, 7));
  assert.equal(at(6, 7), '.');
  assert.equal(score.points, 3 + 1 + 3 + 1);
});

test('scoring: a triple letter multiplies one new tile and the cross-word through it', () => {
  const board = placeTiles(emptyBoard(), spell('ab', 6, 6));
  assert.equal(at(5, 7), 't');
  const score = scorePlay(board, [{ r: 5, c: 7, l: 'k' }]);
  // Only the column word "kb" forms: k (5) tripled = 15, b = 3.
  assert.deepEqual(score.words.map((w) => w.word), ['kb']);
  assert.equal(score.points, 18);
});

test('scoring: a triple word and a double letter in one column', () => {
  const base = placeTiles(emptyBoard(), [{ r: 6, c: 6, l: 'e' }]);
  assert.equal(at(2, 6), 'T');
  assert.equal(at(3, 6), 'd');
  assert.equal(at(4, 6), 'd');
  // t (TW) e (DL) a (DL) s e: 1 + 2 + 2 + 1 + 1 = 7, tripled.
  const score = scorePlay(base, spell('teas', 2, 6, false));
  assert.equal(score.points, 21);
});

test('scoring: a triple word and the centre double word multiply together', () => {
  const score = scorePlay(emptyBoard(), spell('tease', 2, 6, false));
  assert.equal(score.points, 7 * 3 * 2);
});

test('scoring: two triple words in one row make nine times, the bonus and the cross-word add on', () => {
  assert.equal(at(3, 3), 'T');
  assert.equal(at(3, 9), 'T');
  const open = placeTiles(emptyBoard(), [{ r: 4, c: 6, l: 'a' }, { r: 5, c: 6, l: 'a' }, { r: 6, c: 6, l: 'a' }]);
  const score = scorePlay(open, spell('aaaaaaa', 3, 3));
  // Main word: six plain tiles and one on a double letter at (3,6) = 8, times 9. The column word "aaaa" is 2 + 3 = 5.
  assert.equal(score.words[0]?.points, 72);
  assert.equal(score.words[1]?.points, 5);
  assert.equal(score.bonus, BINGO_BONUS);
  assert.equal(score.points, 72 + 5 + 30);
});

test('scoring: cross-words score separately and sum with the main word', () => {
  const board = placeTiles(emptyBoard(), spell('at', 6, 6));
  // Put "ta" under: t below a (col 6) and a below t (col 7): row 7 "ta", crosses "at" columns => "at" vertical (a,t) and "ta" vertical (t,a).
  const score = scorePlay(board, spell('ta', 7, 6));
  assert.equal(score.words.length, 3);
  assert.deepEqual(score.words.map((w) => w.word), ['ta', 'at', 'ta']);
  const total = score.words.reduce((s, w) => s + w.points, 0);
  assert.equal(score.points, total);
});

test('scoring: a single tile forms words in both directions', () => {
  const board = placeTiles(emptyBoard(), [{ r: 6, c: 6, l: 'a' }, { r: 6, c: 7, l: 't' }, { r: 7, c: 5, l: 'c' }]);
  // 's' at (7,6) joins "c" on its left (row: "cs"? 'c' at (7,5), 's' (7,6)) and 'a' above (col: "as").
  const score = scorePlay(board, [{ r: 7, c: 6, l: 's' }]);
  assert.deepEqual(score.words.map((w) => w.word).sort(), ['as', 'cs']);
});

test('scoring: blanks are worth nothing but their square still multiplies the word', () => {
  const normal = scorePlay(emptyBoard(), spell('ox', 6, 6));
  const blank = scorePlay(emptyBoard(), [{ r: 6, c: 6, l: 'o', blank: true }, { r: 6, c: 7, l: 'x' }]);
  assert.equal(normal.points, (1 + 8) * 2);
  assert.equal(blank.points, (0 + 8) * 2);
  const both = scorePlay(emptyBoard(), [{ r: 6, c: 6, l: 'o', blank: true }, { r: 6, c: 7, l: 'x', blank: true }]);
  assert.equal(both.points, 0);
  // A blank on a letter premium: no value to double.
  const onLetter = scorePlay(emptyBoard(), [{ r: 6, c: 4, l: 'z', blank: true }, { r: 6, c: 5, l: 'o' }, { r: 6, c: 6, l: 'e' }]);
  assert.equal(onLetter.points, (0 + 1 + 1) * 2);
});

test('scoring: a blank already on the cloth stays worth nothing', () => {
  const board = placeTiles(emptyBoard(), [{ r: 6, c: 6, l: 'z', blank: true }, { r: 6, c: 7, l: 'o' }]);
  assert.equal(board[6]?.[6], 'Z');
  const score = scorePlay(board, [{ r: 6, c: 8, l: 'o' }]);
  // The old blank adds 0, the old o adds 1, the new o lands on a double letter (6,8) and adds 2.
  assert.equal(score.points, 0 + 1 + 2);
});

test('scoring: seven tiles in one play add the bonus; six do not', () => {
  const seven = scorePlay(emptyBoard(), spell('abcdefg', 6, 0));
  const six = scorePlay(emptyBoard(), spell('abcdef', 6, 1));
  assert.equal(seven.bonus, 30);
  assert.equal(six.bonus, 0);
  assert.equal(seven.points, seven.words[0]!.points + 30);
});

test('scorePlay on a bad shape reports it and scores nothing; the board is not changed', () => {
  const board = emptyBoard();
  const copy = board.slice();
  const score = scorePlay(board, [{ r: 0, c: 0, l: 'a' }]);
  assert.equal(score.ok, false);
  assert.equal(score.points, 0);
  assert.ok(score.error);
  assert.deepEqual(board, copy);
});
