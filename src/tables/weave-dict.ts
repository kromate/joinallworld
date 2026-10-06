/**
 * Weave: what the rules need from a word list. Every pure function takes one of these, so the rules
 * can run against the real list or a small one in a test.
 */
export interface Dictionary {
  /** Lowercase a-z, 2 to 13 letters. */
  has(word: string): boolean
  /** Every word of exactly n letters (lowercase), in any order. */
  ofLength(n: number): Iterable<string>
  /** Optional: the words of exactly n letters as one string, sorted, each n characters wide, no separator. The computer player then reads words out of it as it needs them. */
  packed?(n: number): string | undefined
}

/** A dictionary over a list of words (used by tests and by anything that only has a list). */
export function dictionaryOf(words: Iterable<string>): Dictionary {
  const set = new Set<string>();
  const byLength = new Map<number, string[]>();
  for (const word of words) {
    if (set.has(word)) continue;
    set.add(word);
    const list = byLength.get(word.length);
    if (list) list.push(word); else byLength.set(word.length, [word]);
  }
  return { has: (word) => set.has(word), ofLength: (n) => byLength.get(n) ?? [] };
}
