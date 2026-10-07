import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { GENESIS, entryHash, sha256, verifyChain } from './chain.ts'
import type { ChainEntry } from './chain.ts'

test('sha256 agrees with the platform’s own on text of every length and on non-ASCII text', () => {
  for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(1000), 'Ọmọ Èkó · ₦1,000 · 🇳🇬', '\u0000\u007f\u0080߿ࠀ￿']) {
    assert.equal(sha256(text), createHash('sha256').update(text).digest('hex'), JSON.stringify(text).slice(0, 30))
  }
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

function chain(count: number): ChainEntry[] {
  const entries: ChainEntry[] = []
  let prev = GENESIS
  for (let n = 1; n <= count; n++) {
    const entry = { n, at: 1000 * n, kind: 'term' as const, scope: 'city:lagos', scopeName: 'Lagos', week: n, title: `Term ${n}`, facts: { votes: n, winner: 'Ada', void: false } }
    const hash = entryHash(entry, prev)
    entries.push({ ...entry, prev, hash })
    prev = hash
  }
  return entries
}

test('a chain verifies, and any change, removal or reordering breaks it at the entry', () => {
  const entries = chain(6)
  assert.deepEqual(verifyChain(entries), { ok: true, brokenAt: null, checked: 6 })
  assert.equal(verifyChain([]).ok, true)
  const edited = entries.map((entry) => (entry.n === 3 ? { ...entry, facts: { ...entry.facts, votes: 99 } } : entry))
  assert.deepEqual([verifyChain(edited).ok, verifyChain(edited).brokenAt], [false, 3])
  const retitled = entries.map((entry) => (entry.n === 2 ? { ...entry, title: 'Rewritten' } : entry))
  assert.equal(verifyChain(retitled).brokenAt, 2)
  const removed = entries.filter((entry) => entry.n !== 4)
  assert.equal(verifyChain(removed).brokenAt, 5, 'a gap is found at the entry after it')
  const swapped = [entries[0]!, entries[2]!, entries[1]!, ...entries.slice(3)]
  assert.equal(verifyChain(swapped).ok, false)
  assert.equal(verifyChain(entries.slice(2, 5)).ok, true, 'any stretch of the chain can be checked on its own')
})

test('the same facts in any key order give the same hash', () => {
  const a = { n: 1, at: 1, kind: 'term' as const, scope: 's', scopeName: 'S', week: 1, title: 't', facts: { b: 1, a: 'x' } }
  const b = { ...a, facts: { a: 'x', b: 1 } }
  assert.equal(entryHash(a, GENESIS), entryHash(b, GENESIS))
  assert.notEqual(entryHash(a, GENESIS), entryHash({ ...a, facts: { a: 'x', b: 2 } }, GENESIS))
  assert.notEqual(entryHash(a, GENESIS), entryHash(a, sha256('other')))
})
