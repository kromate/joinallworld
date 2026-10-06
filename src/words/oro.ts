// Oro: the daily five-letter word puzzle. Pure rules: no I/O, no clock, no randomness.
// The day number is the Lagos day index (lagosTime(ms).day from ../game/clock.ts). The answer for a
// day comes from dailyIndex(), keyed with a server-held secret salt that is generated once and
// stored; without the salt the answer cannot be worked out from the day.
import { sha256Words } from '../game/util.ts'

export const MAX_GUESSES = 6
export const WORD_LENGTH = 5
/** Lagos day index of puzzle number 1 (2026-10-06). */
export const ORO_EPOCH_DAY = 20732

export type Mark = 'c' | 'p' | 'a'

/** A guess as typed: 5 letters a-z after trimming and lower-casing, otherwise null. */
export function cleanGuess(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const word = input.trim().toLowerCase()
  return /^[a-z]{5}$/.test(word) ? word : null
}

/** Correct (right place), present (elsewhere in the word), absent. Repeated letters count only as often as the answer has them. */
export function scoreGuess(guess: string, answer: string): Mark[] {
  const marks: Mark[] = Array(guess.length).fill('a')
  const left = new Map<string, number>()
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) marks[i] = 'c'
    else left.set(answer.charAt(i), (left.get(answer.charAt(i)) ?? 0) + 1)
  }
  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === 'c') continue
    const letter = guess.charAt(i)
    const n = left.get(letter) ?? 0
    if (n > 0) { marks[i] = 'p'; left.set(letter, n - 1) }
  }
  return marks
}

const ordinal = (n: number): string => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`

/** Hard mode: green letters stay put and yellow letters must be used. Returns the reason a next guess is not allowed, or null. */
export function checkHardMode(guesses: string[], marks: string[][], next: string): string | null {
  const fixed = new Map<number, string>()
  const need = new Map<string, number>()
  guesses.forEach((guess, g) => {
    const row = marks[g] ?? []
    const seen = new Map<string, number>()
    for (let i = 0; i < guess.length; i++) {
      const mark = row[i]
      const letter = guess.charAt(i)
      if (mark === 'c') fixed.set(i, letter)
      if (mark === 'c' || mark === 'p') seen.set(letter, (seen.get(letter) ?? 0) + 1)
    }
    for (const [letter, n] of seen) need.set(letter, Math.max(need.get(letter) ?? 0, n))
  })
  for (const [i, letter] of [...fixed].sort(([a], [b]) => a - b)) {
    if (next.charAt(i) !== letter) return `The ${ordinal(i + 1)} letter must be ${letter.toUpperCase()}.`
  }
  for (const [letter, n] of [...need].sort(([a], [b]) => (a < b ? -1 : 1))) {
    let have = 0
    for (const c of next) if (c === letter) have++
    if (have < n) return n > 1 ? `Your guess must contain ${letter.toUpperCase()} ${n} times.` : `Your guess must contain ${letter.toUpperCase()}.`
  }
  return null
}

const RANK: Record<Mark, number> = { a: 0, p: 1, c: 2 }

/** Best known state of each guessed letter. */
export function keyboardStates(guesses: string[], marks: string[][]): Record<string, Mark> {
  const out: Record<string, Mark> = {}
  guesses.forEach((guess, g) => {
    const row = marks[g] ?? []
    for (let i = 0; i < guess.length; i++) {
      const mark = row[i]
      if (mark !== 'c' && mark !== 'p' && mark !== 'a') continue
      const letter = guess.charAt(i)
      const old = out[letter]
      if (old === undefined || RANK[mark] > RANK[old]) out[letter] = mark
    }
  })
  return out
}

const ABSENT_SQUARE = '\u2B1B'
const SQUARE: Record<string, string> = { c: '\u{1F7E9}', p: '\u{1F7E8}', a: ABSENT_SQUARE }

/** Shareable result: a title line and one row of squares per guess. No letters, no answer. `solvedIn` null means not solved. */
export function shareText(puzzleNo: number, marks: string[][], solvedIn: number | null, hard: boolean): string {
  const score = solvedIn === null ? 'X' : String(solvedIn)
  const rows = marks.map(row => row.map(mark => SQUARE[mark] ?? ABSENT_SQUARE).join(''))
  return [`Oro #${puzzleNo} ${score}/${MAX_GUESSES}${hard ? '*' : ''}`, ...rows].join('\n')
}

/** Puzzle number for a Lagos day index (the epoch day is number 1). */
export const puzzleNumber = (dayIndex: number): number => dayIndex - ORO_EPOCH_DAY + 1

// One cycle's permutation is cached: every call in a day asks for the same one.
let cached: { key: string; order: Uint32Array } | null = null

/** Uniform-enough draw below `bound` from a keyed digest (53 bits, so the modulo bias is negligible). */
function draw(salt: string, cycle: number, step: number, bound: number): number {
  const w = sha256Words(`oro|${salt.length}|${salt}|${cycle}|${step}`)
  return (((w[0] ?? 0) >>> 0) * 2097152 + ((w[1] ?? 0) >>> 11)) % bound
}

function permutation(salt: string, cycle: number, count: number): Uint32Array {
  const key = `${salt.length}|${salt}|${cycle}|${count}`
  if (cached?.key === key) return cached.order
  const order = Uint32Array.from({ length: count }, (_, i) => i)
  for (let i = count - 1; i > 0; i--) {
    const j = draw(salt, cycle, i, i + 1)
    const held = order[i] ?? 0
    order[i] = order[j] ?? 0
    order[j] = held
  }
  cached = { key, order }
  return order
}

/**
 * Index of the day's answer among `count` answers. Day d uses the salted permutation for cycle
 * floor(d / count) at position d % count, so no answer repeats until every answer has been used.
 */
export function dailyIndex(dayNo: number, salt: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer')
  const day = Math.floor(Number.isFinite(dayNo) ? dayNo : 0)
  const cycle = Math.floor(day / count)
  const at = ((day % count) + count) % count
  return permutation(String(salt), cycle, count)[at] ?? 0
}
