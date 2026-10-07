/**
 * OWNER: politics
 * The public record's chain. Every entry carries the hash of the one before it, so an entry cannot be changed, removed or put out of
 * order without every later hash changing: anyone with the list can check it, here or in their own browser. Pure and portable (no
 * Node, no clock): the server writes the chain with it and the page verifies what it was shown with the same code. Design: docs/POLITICS.md.
 */
import type { RecordFacts, RecordKind } from '../types/records.ts'

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]
const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits))

/** UTF-8 bytes of a string, without TextEncoder (so the same file runs wherever the game does). */
function utf8(text: string): number[] {
  const bytes: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  return bytes
}

/** SHA-256 of a text, as 64 lower-case hex digits. */
export function sha256(text: string): string {
  const bytes = utf8(text), length = bytes.length
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const bits = length * 8
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push(Math.floor(bits / 2 ** shift) & 255)
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const w = new Array<number>(64).fill(0)
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index++) w[index] = ((bytes[offset + index * 4] ?? 0) << 24) | ((bytes[offset + index * 4 + 1] ?? 0) << 16) | ((bytes[offset + index * 4 + 2] ?? 0) << 8) | (bytes[offset + index * 4 + 3] ?? 0)
    for (let index = 16; index < 64; index++) {
      const a = w[index - 15] ?? 0, b = w[index - 2] ?? 0
      w[index] = ((w[index - 16] ?? 0) + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + (w[index - 7] ?? 0) + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number]
    for (let index = 0; index < 64; index++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[index] ?? 0) + (w[index] ?? 0)) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] = ((h[0] ?? 0) + a) | 0; h[1] = ((h[1] ?? 0) + b) | 0; h[2] = ((h[2] ?? 0) + c) | 0; h[3] = ((h[3] ?? 0) + d) | 0
    h[4] = ((h[4] ?? 0) + e) | 0; h[5] = ((h[5] ?? 0) + f) | 0; h[6] = ((h[6] ?? 0) + g) | 0; h[7] = ((h[7] ?? 0) + hh) | 0
  }
  return h.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('')
}

/** The hash an entry must carry: of the previous hash and of the entry's own facts in a fixed order, so the same entry always gives the same text. */
export function entryHash(entry: { n: number; at: number; kind: RecordKind; scope: string; scopeName: string; week: number | null; title: string; facts: RecordFacts }, prev: string): string {
  const facts = Object.keys(entry.facts).sort().map((key) => [key, entry.facts[key]])
  return sha256(JSON.stringify([prev, entry.n, entry.at, entry.kind, entry.scope, entry.scopeName, entry.week, entry.title, facts]))
}

export const GENESIS = '0'.repeat(64)

export interface ChainEntry { n: number; at: number; kind: RecordKind; scope: string; scopeName: string; week: number | null; title: string; facts: RecordFacts; prev: string; hash: string }
export interface ChainCheck { ok: boolean; /** The first entry that does not hold, if any. */ brokenAt: number | null; checked: number }

/** Check that each entry's hash is what its facts and its predecessor give, and that each entry names the one before it. `entries` are in order, oldest first; the first is trusted to start the chain (its `prev` is read as it stands). */
export function verifyChain(entries: readonly ChainEntry[]): ChainCheck {
  let previous: ChainEntry | null = null
  for (const entry of entries) {
    if (entryHash(entry, entry.prev) !== entry.hash) return { ok: false, brokenAt: entry.n, checked: entries.indexOf(entry) }
    if (previous && (entry.prev !== previous.hash || entry.n !== previous.n + 1)) return { ok: false, brokenAt: entry.n, checked: entries.indexOf(entry) }
    previous = entry
  }
  return { ok: true, brokenAt: null, checked: entries.length }
}
