// Word lookups. The tile-game dictionary (about 3.2 MB, 2 to 13 letters: the board is 13 across) is stored deflated inside the script
// (about 1 MB) and inflated the first time `ready()` is awaited, never at module load. Import this module only from the server host;
// browser code should import ./guess.ts instead.
import { FIRST_LENGTH, PACKED, WORD_COUNTS } from './data/dictionary.ts'
import letterCounts from './data/letters.ts'
import { hasFixedWidth } from './guess.ts'
import { unpackFrontCoded } from './pack.ts'

export { ANSWER_COUNT, answerAt, answerCount, isGuess5 } from './guess.ts'

export const MIN_WORD = 2
export const MAX_WORD = 13

let lists: Readonly<Record<number, string>> | null = null
let pending: Promise<void> | null = null

async function inflate(): Promise<Uint8Array> {
  const text = atob(PACKED)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Inflate the word list once. Every path that needs `isWord` or `packedOf` awaits this first; a failure is reported and the next call tries again. */
export function ready(): Promise<void> {
  if (lists) return Promise.resolve()
  pending ??= inflate().then(
    (bytes) => { lists = unpackFrontCoded(bytes, FIRST_LENGTH, WORD_COUNTS); pending = null },
    (cause: unknown) => { pending = null; throw new Error('The word list could not be unpacked.', { cause }) },
  )
  return pending
}

/** True once `ready()` has finished. */
export const isReady = (): boolean => lists !== null

function loaded(): Readonly<Record<number, string>> {
  if (!lists) throw new Error('The word list is not ready: await ready() first.')
  return lists
}

/** The words of exactly `length` letters as one string: sorted, fixed width, no separator. Needs `ready()`. */
export const packedOf = (length: number): string | undefined => loaded()[length]

/** True when `word` (lower-case a-z, 2 to 13 letters) is an accepted word. Needs `ready()`. */
export function isWord(word: string): boolean {
  if (typeof word !== 'string' || word.length < MIN_WORD || word.length > MAX_WORD) return false
  const packed = loaded()[word.length]
  return packed !== undefined && hasFixedWidth(packed, word.length, word)
}

/** Letter counts over dictionary words of 2 to 8 letters plus the answers: derive a tile distribution from these. */
export const LETTER_COUNTS: Readonly<Record<string, number>> = letterCounts
