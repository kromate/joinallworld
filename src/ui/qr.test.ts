// The QR encoder against the standard's own checkable facts: a published Reed-Solomon example, the
// format and version words, the finder and timing patterns, the Reed-Solomon property of every
// block, and a full read-back of the matrix (a small decoder written here, independent of the
// encoder's placement code) that must return the text.
import assert from 'node:assert/strict'
import test from 'node:test'
import { byteCapacity, dataCapacity, dataCodewords, encodeQr, formatBits, functionPatterns, gfMultiply, interleave, maskAt, penalty, qrPath, reedSolomon, utf8, versionBits, versionFor } from './qr.ts'
import type { QrCode } from './qr.ts'

const BLOCKS: Record<number, { ecc: number; sizes: number[] }> = {
  1: { ecc: 10, sizes: [16] }, 2: { ecc: 16, sizes: [28] }, 3: { ecc: 26, sizes: [44] }, 4: { ecc: 18, sizes: [32, 32] }, 5: { ecc: 24, sizes: [43, 43] },
  6: { ecc: 16, sizes: [27, 27, 27, 27] }, 7: { ecc: 18, sizes: [31, 31, 31, 31] }, 8: { ecc: 22, sizes: [38, 38, 39, 39] },
  9: { ecc: 22, sizes: [36, 36, 36, 37, 37] }, 10: { ecc: 26, sizes: [43, 43, 43, 43, 44] },
}
const EXP = (n: number): number => { let x = 1; for (let i = 0; i < n; i++) { x <<= 1; if (x & 0x100) x ^= 0x11d } return x }
const at = (code: Pick<QrCode, 'modules'>, x: number, y: number): boolean => code.modules[y]?.[x] === true
const bitsOf = (value: number, length: number): number[] => Array.from({ length }, (_, i) => (value >>> i) & 1)

/** Read the text back out of a matrix, checking the format words on the way. */
function decode(code: QrCode): string {
  const { size, version } = code
  const copy1: number[] = []
  for (let i = 0; i <= 5; i++) copy1.push(at(code, 8, i) ? 1 : 0)
  copy1.push(at(code, 8, 7) ? 1 : 0, at(code, 8, 8) ? 1 : 0, at(code, 7, 8) ? 1 : 0)
  for (let i = 9; i < 15; i++) copy1.push(at(code, 14 - i, 8) ? 1 : 0)
  const copy2: number[] = []
  for (let i = 0; i < 8; i++) copy2.push(at(code, size - 1 - i, 8) ? 1 : 0)
  for (let i = 8; i < 15; i++) copy2.push(at(code, 8, size - 15 + i) ? 1 : 0)
  assert.deepEqual(copy1, bitsOf(formatBits(code.mask), 15), 'first format copy')
  assert.deepEqual(copy2, bitsOf(formatBits(code.mask), 15), 'second format copy')
  const { reserved } = functionPatterns(version)
  const bits: number[] = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
      if (reserved[y]?.[x]) continue
      bits.push(at(code, x, y) !== maskAt(code.mask, x, y) ? 1 : 0)
    }
  }
  const words: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((word, b) => (word << 1) | b, 0))
  const info = BLOCKS[version]
  assert.ok(info)
  const total = info.sizes.reduce((a, b) => a + b, 0) + info.ecc * info.sizes.length
  assert.equal(words.length, total, 'every codeword has a place')
  // Undo the interleaving: data words column by column, then the error-correction words.
  const blocks = info.sizes.map(() => ({ data: [] as number[], ecc: [] as number[] }))
  let at2 = 0
  for (let i = 0; i < Math.max(...info.sizes); i++) info.sizes.forEach((length, b) => { if (i < length) blocks[b]?.data.push(words[at2++] ?? 0) })
  for (let i = 0; i < info.ecc; i++) blocks.forEach((block) => block.ecc.push(words[at2++] ?? 0))
  // The Reed-Solomon property: every block, read as a polynomial, vanishes at the first ecc powers of alpha.
  for (const block of blocks) {
    const poly = [...block.data, ...block.ecc]
    for (let power = 0; power < info.ecc; power++) {
      let sum = 0
      for (const word of poly) sum = gfMultiply(sum, EXP(power)) ^ word
      assert.equal(sum, 0, `syndrome ${power} is zero`)
    }
  }
  const data = blocks.flatMap((block) => block.data)
  const stream = data.flatMap((word) => bitsOf(word, 8).reverse())
  const read = (from: number, length: number): number => stream.slice(from, from + length).reduce((v, b) => (v << 1) | b, 0)
  assert.equal(read(0, 4), 0b0100, 'byte mode')
  const head = version < 10 ? 8 : 16
  const length = read(4, head)
  const bytes = Array.from({ length }, (_, i) => read(4 + head + 8 * i, 8))
  return new TextDecoder().decode(Uint8Array.from(bytes))
}

test('Reed-Solomon: the published HELLO WORLD example at version 1-M', () => {
  const data = [0x20, 0x5b, 0x0b, 0x78, 0xd1, 0x72, 0xdc, 0x4d, 0x43, 0x40, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11]
  assert.deepEqual(reedSolomon(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  assert.deepEqual(interleave(data, 1).slice(0, 16), data)
})

test('Reed-Solomon: the field is multiplied correctly', () => {
  assert.equal(gfMultiply(0, 77), 0)
  assert.equal(gfMultiply(2, 128), 0x1d)
  assert.equal(gfMultiply(3, 7), 9)
})

test('format and version words match the standard', () => {
  assert.equal(formatBits(0), 0b101010000010010)
  assert.equal(formatBits(1), 0b101000100100101)
  assert.equal(formatBits(2), 0b101111001111100)
  assert.equal(formatBits(3), 0b101101101001011)
  assert.equal(formatBits(5), 0b100000011001110)
  assert.equal(formatBits(7), 0b100101010100000)
  assert.deepEqual([7, 8, 9, 10].map(versionBits), [0x07c94, 0x085bc, 0x09a99, 0x0a4d3])
})

test('capacity: the byte capacity of each version at level M', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(byteCapacity), [14, 26, 42, 62, 84, 106, 122, 152, 180, 213])
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(dataCapacity), [16, 28, 44, 64, 86, 108, 124, 154, 182, 216])
  assert.equal(versionFor(14), 1); assert.equal(versionFor(15), 2); assert.equal(versionFor(213), 10); assert.equal(versionFor(214), null)
  assert.equal(encodeQr('x'.repeat(214)), null)
})

test('data codewords: header, terminator and padding', () => {
  const words = dataCodewords(utf8('HELLO WORLD'), 1)
  assert.equal(words.length, 16)
  assert.deepEqual(words.slice(0, 3), [0x40, 0xb4, 0x84]) // 0100 | 00001011 | 0100 1000 ...
  assert.deepEqual(words.slice(-3), [0xec, 0x11, 0xec])
})

test('the finder, separator, timing and dark-module patterns of every version', () => {
  for (let version = 1; version <= 10; version++) {
    const code = encodeQr('https://example.test/s/abcdef1234', version % 8)
    assert.ok(code)
    const probe = encodeQr('a'.repeat(byteCapacity(version)))
    assert.ok(probe && probe.version === version)
    const size = 17 + 4 * version
    assert.equal(probe.size, size)
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]] as const) {
      for (let d = 0; d < 7; d++) for (let e = 0; e < 7; e++) {
        const ring = Math.max(Math.abs(d - 3), Math.abs(e - 3))
        assert.equal(at(probe, ox + d, oy + e), ring !== 2, `finder v${version} ${ox},${oy} ${d},${e}`)
      }
    }
    for (let i = 8; i < size - 8; i++) { assert.equal(at(probe, i, 6), i % 2 === 0, 'row timing'); assert.equal(at(probe, 6, i), i % 2 === 0, 'column timing') }
    assert.equal(at(probe, 8, size - 8), true, 'the dark module')
    for (let i = 0; i < 8; i++) { assert.equal(at(probe, 7, i), false); assert.equal(at(probe, i, 7), false) }
    if (version >= 7) {
      const word = versionBits(version)
      for (let i = 0; i < 18; i++) { const bit = ((word >>> i) & 1) === 1; assert.equal(at(probe, size - 11 + (i % 3), Math.floor(i / 3)), bit); assert.equal(at(probe, Math.floor(i / 3), size - 11 + (i % 3)), bit) }
    }
  }
})

test('alignment patterns are drawn where the standard puts them', () => {
  const v2 = encodeQr('a'.repeat(20))
  assert.ok(v2 && v2.version === 2)
  for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) assert.equal(at(v2, 18 + d, 18 + e), Math.max(Math.abs(d), Math.abs(e)) !== 1)
})

test('a full read-back returns the text, for every version and every mask', () => {
  for (let version = 1; version <= 10; version++) for (let mask = 0; mask < 8; mask++) {
    const text = `Allworld ${'é/?&=#'.repeat(3)} ${'x'.repeat(Math.max(0, byteCapacity(version) - 28))}`.slice(0, byteCapacity(version))
    const bytes = utf8(text)
    if (versionFor(bytes.length) !== version) continue
    const code = encodeQr(text, mask)
    assert.ok(code)
    assert.equal(code.version, version)
    assert.equal(decode(code), text)
  }
  const link = 'https://play.example/s/a1b2c3d4e5'
  const code = encodeQr(link)
  assert.ok(code)
  assert.equal(code.version, 3)
  assert.equal(decode(code), link)
  assert.equal(decode(encodeQr('Lagos · ₦1,500 🎲') as QrCode), 'Lagos · ₦1,500 🎲')
})

test('the chosen mask has the lowest penalty of the eight', () => {
  const link = 'https://play.example/s/a1b2c3d4e5?ref=zz'
  const best = encodeQr(link)
  assert.ok(best)
  const scores = Array.from({ length: 8 }, (_, mask) => penalty((encodeQr(link, mask) as QrCode).modules))
  assert.equal(penalty(best.modules), Math.min(...scores))
  assert.equal(scores[best.mask], Math.min(...scores))
  assert.ok(new Set(scores).size > 1, 'the masks differ')
})

test('the path draws one square per dark module', () => {
  const code = encodeQr('hi') as QrCode
  const dark = code.modules.flat().filter(Boolean).length
  assert.equal((qrPath(code).match(/M/g) ?? []).length, dark)
})
