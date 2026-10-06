// The rules of the Oro screen that need no browser: what a typed key does to the draft, what a
// refusal says, the keyboard's letter states, the stats line and the time until the next puzzle.
// Pure, so node --test reaches it. The marks and the answer always come from the server (daily) or
// from the lazy word module (practice); nothing here knows an answer.
import type { OroMark, OroStatsView } from '../../../types/growth.ts'

export const WORD_LENGTH = 5
export const MAX_GUESSES = 6
export const KEY_ROWS: readonly string[] = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

/** A letter typed or tapped: added while the draft has room. */
export const typeLetter = (draft: string, letter: string): string => (draft.length < WORD_LENGTH && /^[a-z]$/.test(letter) ? draft + letter : draft)
export const backspace = (draft: string): string => draft.slice(0, -1)
export const canSubmit = (draft: string): boolean => draft.length === WORD_LENGTH

/** The key a keyboard event stands for: a letter, 'enter', 'back', or null. */
export function keyOf(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.key === 'Enter') return 'enter'
  if (event.key === 'Backspace') return 'back'
  return /^[a-zA-Z]$/.test(event.key) ? event.key.toLowerCase() : null
}

const RANK: Record<OroMark, number> = { a: 0, p: 1, c: 2 }
/** Best state of each letter guessed so far (for the on-screen keyboard). */
export function keyStates(rows: readonly { word: string; marks: readonly OroMark[] }[]): Record<string, OroMark> {
  const out: Record<string, OroMark> = {}
  for (const row of rows) {
    for (let i = 0; i < row.word.length; i++) {
      const mark = row.marks[i], letter = row.word.charAt(i), old = out[letter]
      if (mark !== undefined && (old === undefined || RANK[mark] > RANK[old])) out[letter] = mark
    }
  }
  return out
}
export const MARK_WORDS: Record<OroMark, string> = { c: 'in the right place', p: 'in the word, in another place', a: 'not in the word' }
/** What a screen reader hears for one tile. */
export const tileLabel = (letter: string, mark: OroMark | null): string => (letter ? `${letter.toUpperCase()}${mark ? `, ${MARK_WORDS[mark]}` : ''}` : 'empty')

/** The sentence for a refused guess (the server's own sentence when it sent one). */
export function refusalWords(code: string | undefined, reason: string | undefined): string {
  if (reason) return reason
  return code === 'rate_limited' ? 'You are guessing too quickly. Wait a moment.' : 'That guess could not be made.'
}

export const winRate = (stats: Pick<OroStatsView, 'played' | 'won'>): number => (stats.played ? Math.round((stats.won / stats.played) * 100) : 0)
/** Width of one bar of the guess distribution, in percent (the longest is full). */
export function barWidths(dist: readonly number[]): number[] {
  const most = Math.max(1, ...dist)
  return dist.map((n) => (n ? Math.max(8, Math.round((n / most) * 100)) : 0))
}
const DAY_MS = 86400000, LAGOS_OFFSET_MS = 3600000
/** "5 h 12 min" until the next puzzle (the next Lagos midnight). */
export function untilNext(nowMs: number): string {
  const local = nowMs + LAGOS_OFFSET_MS, left = DAY_MS - (((local % DAY_MS) + DAY_MS) % DAY_MS)
  const hours = Math.floor(left / 3600000), minutes = Math.floor((left % 3600000) / 60000)
  return hours ? `${hours} h ${minutes} min` : `${Math.max(1, minutes)} min`
}
/** One line for the hub card. */
export function dailyLine(state: { status: 'playing' | 'won' | 'lost'; rows: readonly unknown[]; stats: OroStatsView; no: number } | null): string {
  if (!state) return 'A new five-letter word every day.'
  if (state.status === 'won') return `Solved in ${state.rows.length} of ${MAX_GUESSES} · streak ${state.stats.streak}`
  if (state.status === 'lost') return 'Not solved today. A new word comes tomorrow.'
  return state.rows.length ? `${state.rows.length} of ${MAX_GUESSES} guesses used` : `Puzzle #${state.no} · six guesses${state.stats.streak ? ` · streak ${state.stats.streak}` : ''}`
}
export const ORO_RULES: readonly string[] = [
  'Guess the five-letter word in six tries. Every guess must be a real word.',
  'After each guess the tiles show how close you were: green is the right letter in the right place, yellow is in the word but somewhere else, grey is not in the word.',
  'A letter that appears twice in your guess is only marked as often as it appears in the word.',
  'Everyone gets the same word each day, and a new one arrives at midnight in Lagos. The answer is shown only when you have solved it or used all six guesses.',
  'Hard mode: letters you have found must be used in your next guesses.',
  'Practice puzzles are unlimited and do not count for your streak.',
]
