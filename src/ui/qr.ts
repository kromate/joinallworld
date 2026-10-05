/**
 * A small QR Code encoder: byte mode, error-correction level M, versions 1 to 10 (up to 213 bytes,
 * enough for any share link). Pure: no DOM, no I/O, so it is tested without a browser and drawn by
 * whatever wants the modules (a canvas, an SVG path).
 *
 * The steps are the standard's: the text as UTF-8 bytes with a mode and a length header, padded to
 * the version's data capacity; Reed-Solomon over GF(256) (polynomial 0x11D) per block; the blocks
 * interleaved; the function patterns (finders, timing, alignment, version and format information)
 * drawn; the data placed in the two-column zigzag; and the one of the eight masks with the lowest
 * penalty chosen, with its format word written last.
 */

export interface QrCode {
  version: number
  /** Modules per side: 17 + 4 * version. */
  size: number
  mask: number
  /** `modules[row][column]`, true = dark. */
  modules: boolean[][]
}

/** Per version (1 to 10) at level M: error-correction codewords per block, then [blocks, data codewords per block] groups. */
const BLOCKS: readonly { ecc: number; groups: readonly (readonly [number, number])[] }[] = [
  { ecc: 10, groups: [[1, 16]] }, { ecc: 16, groups: [[1, 28]] }, { ecc: 26, groups: [[1, 44]] }, { ecc: 18, groups: [[2, 32]] },
  { ecc: 24, groups: [[2, 43]] }, { ecc: 16, groups: [[4, 27]] }, { ecc: 18, groups: [[4, 31]] }, { ecc: 22, groups: [[2, 38], [2, 39]] },
  { ecc: 22, groups: [[3, 36], [2, 37]] }, { ecc: 26, groups: [[4, 43], [1, 44]] },
]
/** Alignment pattern centres (rows and columns) for versions 1 to 10. */
const ALIGNMENT: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]

export const MAX_VERSION = 10
/** The format word's error-correction bits: level M is 00. */
const ECC_M_BITS = 0

const blockInfo = (version: number) => {
  const info = BLOCKS[version - 1]
  if (!info) throw new RangeError('QR version out of range')
  return info
}
/** Data codewords a version holds at level M. */
export const dataCapacity = (version: number): number => blockInfo(version).groups.reduce((sum, [count, length]) => sum + count * length, 0)
/** How many bytes of text fit in a version: the capacity less the 4-bit mode and the length field. */
export const byteCapacity = (version: number): number => Math.floor((dataCapacity(version) * 8 - 4 - (version < 10 ? 8 : 16)) / 8)

// ---- Reed-Solomon over GF(256) ---------------------------------------------------------------

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0
}
export const gfMultiply = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0)

/** The generator polynomial of `degree`, highest power first without the leading 1: (x - a^0)(x - a^1)... */
export function generator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ (poly[j] ?? 0)
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMultiply(poly[j] ?? 0, EXP[i] ?? 0)
    }
    poly = next
  }
  return poly.slice(1)
}
/** The `degree` error-correction codewords of `data`. */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  const gen = generator(degree)
  const result = new Array<number>(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0)
    result.push(0)
    for (let i = 0; i < degree; i++) result[i] = (result[i] ?? 0) ^ gfMultiply(gen[i] ?? 0, factor)
  }
  return result
}

// ---- the bit stream --------------------------------------------------------------------------

/** UTF-8 bytes of a string, without TextEncoder (the engine has no DOM or Node globals). */
export function utf8(text: string): number[] {
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

/** The smallest version (1 to 10) whose capacity holds `length` bytes, or null. */
export function versionFor(length: number): number | null {
  for (let version = 1; version <= MAX_VERSION; version++) if (length <= byteCapacity(version)) return version
  return null
}

/** The data codewords of a byte-mode message: header, bytes, terminator and the 0xEC/0x11 padding. */
export function dataCodewords(bytes: readonly number[], version: number): number[] {
  const bits: number[] = []
  const put = (value: number, length: number): void => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, version < 10 ? 8 : 16)
  for (const byte of bytes) put(byte, 8)
  const capacity = dataCapacity(version) * 8
  put(0, Math.min(4, capacity - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const words: number[] = []
  for (let i = 0; i < bits.length; i += 8) { let word = 0; for (let j = 0; j < 8; j++) word = (word << 1) | (bits[i + j] ?? 0); words.push(word) }
  for (let pad = 0xec; words.length < dataCapacity(version); pad ^= 0xec ^ 0x11) words.push(pad)
  return words
}

/** Split into blocks, add each block's error correction, and interleave: the codewords in the order they are placed. */
export function interleave(data: readonly number[], version: number): number[] {
  const { ecc, groups } = blockInfo(version)
  const blocks: { data: number[]; ecc: number[] }[] = []
  let at = 0
  for (const [count, length] of groups) for (let i = 0; i < count; i++) {
    const chunk = data.slice(at, at + length)
    at += length
    blocks.push({ data: chunk, ecc: reedSolomon(chunk, ecc) })
  }
  const out: number[] = []
  const longest = Math.max(...blocks.map((block) => block.data.length))
  for (let i = 0; i < longest; i++) for (const block of blocks) { const word = block.data[i]; if (word !== undefined) out.push(word) }
  for (let i = 0; i < ecc; i++) for (const block of blocks) out.push(block.ecc[i] ?? 0)
  return out
}

// ---- format and version information ----------------------------------------------------------

/** The 15-bit format word: error-correction level, mask, a BCH(15,5) remainder, XORed with 0x5412. */
export function formatBits(mask: number): number {
  const data = (ECC_M_BITS << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}
/** The 18-bit version word (versions 7 and up): the version and a BCH(18,6) remainder. */
export function versionBits(version: number): number {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

// ---- the matrix ------------------------------------------------------------------------------

const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0

/** True where the mask flips the module at column x, row y. */
export function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0
  }
}

/** The matrix with every function pattern drawn and the data not yet placed. `reserved` marks the modules that are not data. */
export function functionPatterns(version: number): { modules: boolean[][]; reserved: boolean[][]; size: number } {
  const size = 17 + 4 * version
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean): void => {
    const row = modules[y]; const flag = reserved[y]
    if (!row || !flag || x < 0 || x >= size) return
    row[x] = dark; flag[x] = true
  }
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      set(cx + dx, cy + dy, dist !== 2 && dist !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  const centres = ALIGNMENT[version - 1] ?? []
  const last = centres.length - 1
  centres.forEach((cy, i) => centres.forEach((cx, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  // The format areas are reserved now and written with the chosen mask; the always-dark module is fixed.
  for (let i = 0; i < 9; i++) if (i !== 6) { set(8, i, false); set(i, 8, false) }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8, false); set(8, size - 1 - i, false) }
  set(8, size - 8, true)
  if (version >= 7) {
    const word = versionBits(version)
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3); const b = Math.floor(i / 3)
      set(a, b, bit(word, i)); set(b, a, bit(word, i))
    }
  }
  return { modules, reserved, size }
}

function writeFormat(modules: boolean[][], size: number, mask: number): void {
  const word = formatBits(mask)
  const set = (x: number, y: number, dark: boolean): void => { const row = modules[y]; if (row) row[x] = dark }
  for (let i = 0; i <= 5; i++) set(8, i, bit(word, i))
  set(8, 7, bit(word, 6)); set(8, 8, bit(word, 7)); set(7, 8, bit(word, 8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(word, i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(word, i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(word, i))
  set(8, size - 8, true)
}

/** The penalty of a finished matrix: runs, 2x2 blocks, finder-like patterns and the dark balance (the standard's four rules). */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length
  const at = (x: number, y: number): boolean => modules[y]?.[x] === true
  let score = 0
  const lines: string[] = []
  for (let a = 0; a < size; a++) {
    let across = '', down = ''
    for (let b = 0; b < size; b++) { across += at(b, a) ? '1' : '0'; down += at(a, b) ? '1' : '0' }
    lines.push(across, down)
  }
  for (const line of lines) {
    let run = 1
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) { run++; continue }
      if (run >= 5) score += 3 + (run - 5)
      run = 1
    }
    for (const pattern of ['10111010000', '00001011101']) for (let from = line.indexOf(pattern); from !== -1; from = line.indexOf(pattern, from + 1)) score += 40
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const here = at(x, y)
    if (here === at(x + 1, y) && here === at(x, y + 1) && here === at(x + 1, y + 1)) score += 3
  }
  let dark = 0
  for (const row of modules) for (const cell of row) if (cell) dark++
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/** Place the codewords, apply one mask and write the format word. */
export function build(codewords: readonly number[], version: number, mask: number): boolean[][] {
  const { modules, reserved, size } = functionPatterns(version)
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
      const row = modules[y]; const flag = reserved[y]
      if (!row || !flag || flag[x]) continue
      const word = codewords[index >>> 3]
      let dark = word !== undefined && bit(word, 7 - (index & 7))
      index++
      if (maskAt(mask, x, y)) dark = !dark
      row[x] = dark
    }
  }
  writeFormat(modules, size, mask)
  return modules
}

/**
 * Encode text. Returns null when it does not fit in version 10 at level M (213 bytes of UTF-8).
 * `forceMask` (0 to 7) is for tests; otherwise the mask with the lowest penalty is used.
 */
export function encodeQr(text: string, forceMask?: number): QrCode | null {
  const bytes = utf8(text)
  const version = versionFor(bytes.length)
  if (version === null) return null
  const codewords = interleave(dataCodewords(bytes, version), version)
  let best: QrCode | null = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    if (forceMask !== undefined && mask !== forceMask) continue
    const modules = build(codewords, version, mask)
    const score = penalty(modules)
    if (score < bestScore) { bestScore = score; best = { version, size: 17 + 4 * version, mask, modules } }
  }
  return best
}

/** The matrix as one SVG path (one square per dark module, in module units), for drawing without a canvas. */
export function qrPath(code: Pick<QrCode, 'modules'>): string {
  let path = ''
  code.modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x} ${y}h1v1h-1z` }))
  return path
}
