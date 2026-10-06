// The tile-game word list is shipped front-coded and deflated (see docs/WORDS.md): each word is one character for how many leading
// letters it shares with the word before it (the character code is 48 plus that number), then its remaining letters. Words are
// sorted within each length. This module turns the inflated bytes back into one fixed-width string per length.

/** The character code that stands for a shared prefix of zero letters. */
export const PREFIX_BASE = 48

/** Rebuild one fixed-width, sorted, separator-free string per length from front-coded bytes. `counts[i]` is the number of words of length `first + i`. */
export function unpackFrontCoded(data: Uint8Array, first: number, counts: readonly number[]): Record<number, string> {
  const result: Record<number, string> = {}
  const decoder = new TextDecoder()
  let at = 0
  counts.forEach((count, index) => {
    const width = first + index
    const out = new Uint8Array(count * width)
    for (let word = 0; word < count; word++) {
      const shared = (data[at++] ?? Infinity) - PREFIX_BASE
      if (!(shared >= 0 && shared < width) || (word === 0 && shared !== 0)) throw new Error('the packed word list is damaged')
      const start = word * width
      if (shared > 0) out.copyWithin(start, start - width, start - width + shared)
      const rest = width - shared
      if (at + rest > data.length) throw new Error('the packed word list is damaged')
      out.set(data.subarray(at, at + rest), start + shared)
      at += rest
    }
    result[width] = decoder.decode(out)
  })
  if (at !== data.length) throw new Error('the packed word list is damaged')
  return result
}
