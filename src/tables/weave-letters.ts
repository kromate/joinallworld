/**
 * Weave: the tile bag and what each letter is worth. Plain data, safe for the browser.
 *
 * The counts follow how often letters open and fill English words, nudged by hand so that a rack of
 * seven usually has two or three vowels and the awkward consonants are few. Values grow as letters get rarer.
 * 98 tiles: 96 letters and 2 blanks ('?').
 */

/** How many of each tile the bag holds; '?' is a blank. */
export const LETTER_COUNTS: Readonly<Record<string, number>> = Object.freeze({
  a: 7, b: 2, c: 3, d: 4, e: 11, f: 2, g: 3, h: 2, i: 7, j: 1, k: 1, l: 4, m: 3,
  n: 6, o: 7, p: 2, q: 1, r: 7, s: 6, t: 6, u: 3, v: 2, w: 2, x: 1, y: 2, z: 1, '?': 2,
});

/** What a letter scores. A blank scores nothing. */
export const LETTER_VALUES: Readonly<Record<string, number>> = Object.freeze({
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 2, v: 5, w: 4, x: 8, y: 4, z: 10, '?': 0,
});

/** The whole bag as one list, in alphabetical order (blanks last). */
export function fullBag(): string[] {
  const tiles: string[] = [];
  for (const [letter, count] of Object.entries(LETTER_COUNTS)) for (let i = 0; i < count; i++) tiles.push(letter);
  return tiles;
}
export const BAG_SIZE = 98;
