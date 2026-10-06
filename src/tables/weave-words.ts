/**
 * Weave: the real word list as a `Dictionary` (see ./weave-dict.ts). SERVER ONLY: it pulls in the whole
 * list (about 3.7 MB), so browser code imports ./weave-board.ts instead.
 *
 * Lookups go through `isWord`; the computer player enumerates a length by slicing that length's packed
 * string (fixed-width words, sorted, no separator) from the data module.
 */
import { isWord } from '../words/dict.ts';
import packed from '../words/data/dictionary.ts';
import type { Dictionary } from './weave-dict.ts';

function* wordsOfLength(n: number): Generator<string> {
  const text = packed[n];
  if (text === undefined || n < 1) return;
  for (let at = 0; at + n <= text.length; at += n) yield text.slice(at, at + n);
}

export const wordList: Dictionary = { has: isWord, ofLength: wordsOfLength };
