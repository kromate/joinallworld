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

/** The 85 characters of the text encoding: printable ASCII from `!`, leaving out the quote marks, the backslash and the back tick so the text sits safely in a string literal. */
export const ALPHABET = Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).filter((c) => !`'"\\\`<>&`.includes(c)).slice(0, 85).join('')

/** Decode text made of ALPHABET (five characters for four bytes; a last short group of n characters is n - 1 bytes). */
export function decodeText(text: string): Uint8Array<ArrayBuffer> {
  const digit = new Uint8Array(128).fill(255)
  for (let i = 0; i < ALPHABET.length; i++) digit[ALPHABET.charCodeAt(i)] = i
  const rest = text.length % 5
  const out = new Uint8Array(Math.floor(text.length / 5) * 4 + (rest ? rest - 1 : 0))
  if (rest === 1) throw new Error('the packed word list is damaged')
  for (let at = 0, to = 0; at < text.length; at += 5, to += 4) {
    let value = 0
    const size = Math.min(5, text.length - at)
    for (let i = 0; i < 5; i++) {
      const d = i < size ? (digit[text.charCodeAt(at + i)] ?? 255) : 84
      if (d === 255) throw new Error('the packed word list is damaged')
      value = value * 85 + d
    }
    if (value >= 4294967296) throw new Error('the packed word list is damaged')
    const take = Math.min(4, out.length - to)
    for (let i = 0; i < take; i++) out[to + i] = (value >>> (24 - 8 * i)) & 255
  }
  return out
}
