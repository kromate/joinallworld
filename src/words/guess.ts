// The small half of the word data: five-letter guesses and daily answers. Safe for the browser
// (about 70 KB raw, 30 KB gzip); the large tile-game dictionary lives in dict.ts.
import allowed5 from './data/allowed5.ts'
import answers from './data/answers.ts'

export const ANSWER_COUNT = answers.length / 5

/** Binary search over a sorted string of fixed-width words. */
export function hasFixedWidth(packed: string, width: number, word: string): boolean {
  if (word.length !== width) return false
  let low = 0
  let high = packed.length / width - 1
  while (low <= high) {
    const mid = (low + high) >>> 1
    const at = mid * width
    let order = 0
    for (let i = 0; i < width; i++) {
      order = packed.charCodeAt(at + i) - word.charCodeAt(i)
      if (order !== 0) break
    }
    if (order === 0) return true
    if (order < 0) low = mid + 1
    else high = mid - 1
  }
  return false
}

export const answerCount = (): number => ANSWER_COUNT

/** The i-th answer in the stored order (wraps; the stored order is a fixed shuffle). */
export function answerAt(i: number): string {
  const n = ((Math.trunc(i) % ANSWER_COUNT) + ANSWER_COUNT) % ANSWER_COUNT
  return answers.slice(n * 5, n * 5 + 5)
}

/** True when `word` (lower-case) is an accepted five-letter guess. */
export const isGuess5 = (word: string): boolean => hasFixedWidth(allowed5, 5, word)
