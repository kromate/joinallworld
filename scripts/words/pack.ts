// Packs the tile-game dictionary for the Worker script: front-coded (see src/words/pack.ts), deflated, base64. Deterministic for a given
// Node build; the check below compares decoded words, never the compressed bytes, so a different zlib cannot fail it.
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { PREFIX_BASE, unpackFrontCoded } from '../../src/words/pack.ts'

/** `byLength` holds the sorted words of each length; lengths must run from `first` upward with no gap. */
export function packDictionary(byLength: ReadonlyMap<number, readonly string[]>): { first: number; counts: number[]; base64: string } {
  const lengths = [...byLength.keys()].sort((a, b) => a - b)
  const first = lengths[0] ?? 0
  const parts: string[] = []
  const counts: number[] = []
  lengths.forEach((width, index) => {
    if (width !== first + index) throw new Error(`no words of length ${first + index}`)
    const words = byLength.get(width) ?? []
    counts.push(words.length)
    let previous = ''
    for (const word of words) {
      let shared = 0
      while (shared < width - 1 && word[shared] === previous[shared]) shared++
      parts.push(String.fromCharCode(PREFIX_BASE + shared), word.slice(shared))
      previous = word
    }
  })
  const packed = deflateRawSync(Buffer.from(parts.join('')), { level: 9, memLevel: 9 })
  return { first, counts, base64: packed.toString('base64') }
}

/** Decode a committed module's data back to one string per length. */
export function unpackDictionary(first: number, counts: readonly number[], base64: string): Record<number, string> {
  return unpackFrontCoded(new Uint8Array(inflateRawSync(Buffer.from(base64, 'base64'))), first, counts)
}

/** Problems with the words themselves: width, order, letters, duplicates. Empty when the list is sound. */
export function problemsWith(lists: Readonly<Record<number, string>>): string[] {
  const problems: string[] = []
  for (const [key, text] of Object.entries(lists)) {
    const width = Number(key)
    if (text.length % width !== 0) problems.push(`length ${width} is not fixed width`)
    if (!/^[a-z]*$/.test(text)) problems.push(`length ${width} holds something other than a-z`)
    let previous = ''
    for (let at = 0; at < text.length; at += width) {
      const word = text.slice(at, at + width)
      if (word <= previous) { problems.push(`length ${width}: ${word} is out of order or repeated`); break }
      previous = word
    }
  }
  return problems
}

export const moduleSource = (packed: { first: number; counts: number[]; base64: string }): string =>
  `// Accepted words of 2 to 13 letters: sorted per length, front-coded, deflated (raw) and base64 encoded. Unpacked by src/words/pack.ts.\n` +
  `export const FIRST_LENGTH = ${packed.first}\n` +
  `/** How many words there are of length FIRST_LENGTH, FIRST_LENGTH + 1, and so on. */\n` +
  `export const WORD_COUNTS: readonly number[] = [${packed.counts.join(', ')}]\n` +
  `export const PACKED = '${packed.base64}'\n`
