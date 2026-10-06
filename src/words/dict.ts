// Word lookups. The tile-game dictionary (about 3.2 MB, 2 to 13 letters: the board is 13 across) is imported here, so
// import this module only from the server host. Browser code should import ./guess.ts instead.
import dictionary from './data/dictionary.ts'
import letterCounts from './data/letters.ts'
import { hasFixedWidth } from './guess.ts'

export { ANSWER_COUNT, answerAt, answerCount, isGuess5 } from './guess.ts'

export const MIN_WORD = 2
export const MAX_WORD = 13

/** True when `word` (lower-case a-z, 2 to 13 letters) is an accepted word. */
export function isWord(word: string): boolean {
  if (typeof word !== 'string' || word.length < MIN_WORD || word.length > MAX_WORD) return false
  const packed = dictionary[word.length]
  return packed !== undefined && hasFixedWidth(packed, word.length, word)
}

/** Letter counts over dictionary words of 2 to 8 letters plus the answers: derive a tile distribution from these. */
export const LETTER_COUNTS: Readonly<Record<string, number>> = letterCounts
