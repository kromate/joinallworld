// The one-day memory of people you greeted or bought a drink for: the time to live, the cap, bad data, and that nothing breaks without storage.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACQUAINTANCE_KEY, CAP, TTL_MS, kindOfAction, readAcquaintances, recall, remember } from './acquaintance.ts'
import { MEMORY_LINES, memoryLine } from './memory-lines.ts'
import { ACQUAINTANCE_KEY as LAYER_KEY } from '../scene/ambient/layer.ts'

const memory = (start: Record<string, string> = {}) => {
  const data = new Map(Object.entries(start))
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
}
const NOW = Date.UTC(2026, 9, 20, 12, 0)

test('a regular is remembered for 24 hours, then forgotten', () => {
  const store = memory()
  remember('kunle', 'greeted', NOW, store)
  assert.equal(recall('kunle', NOW, store), 'greeted')
  assert.equal(recall('kunle', NOW + TTL_MS - 1, store), 'greeted')
  assert.equal(recall('kunle', NOW + TTL_MS, store), null)
  assert.equal(recall('someone-else', NOW, store), null)
  assert.equal(JSON.parse(store.data.get(ACQUAINTANCE_KEY)!).v, 1)
})

test('a drink bought outranks a hello, and a hello again renews the day', () => {
  const store = memory()
  remember('kunle', 'bought', NOW, store)
  remember('kunle', 'greeted', NOW + 3600000, store)
  assert.equal(recall('kunle', NOW + 3600000, store), 'bought')
  assert.equal(recall('kunle', NOW + 3600000 + TTL_MS - 1, store), 'bought', 'the day runs from the last time')
  const other = memory()
  remember('ada', 'greeted', NOW, other)
  remember('ada', 'bought', NOW + 1000, other)
  assert.equal(recall('ada', NOW + 1000, other), 'bought')
})

test('at most 50 people are kept: the ones who would be forgotten first go first', () => {
  const store = memory()
  for (let i = 0; i < CAP + 10; i++) remember(`npc-${i}`, 'greeted', NOW + i * 1000, store)
  const kept = readAcquaintances(NOW + (CAP + 9) * 1000, store)
  assert.equal(kept.size, CAP)
  assert.equal(kept.has('npc-0'), false)
  assert.equal(kept.has('npc-9'), false)
  assert.equal(kept.has('npc-10'), true)
  assert.equal(kept.has(`npc-${CAP + 9}`), true)
})

test('malformed data is skipped, entry by entry, and never throws', () => {
  const bad = (value: string) => readAcquaintances(NOW, memory({ [ACQUAINTANCE_KEY]: value }))
  assert.equal(bad('not json').size, 0)
  assert.equal(bad('null').size, 0)
  assert.equal(bad('[]').size, 0)
  assert.equal(bad('{"v":2,"people":{"a":{"kind":"greeted","until":' + (NOW + 1000) + '}}}').size, 0, 'another version is not read')
  assert.equal(bad('{"v":1,"people":[1,2]}').size, 0)
  const mixed = bad(JSON.stringify({ v: 1, people: {
    good: { kind: 'greeted', until: NOW + 1000 },
    helped: { kind: 'helped', until: NOW + 1000 },
    string: { kind: 'bought', until: String(NOW + 1000) },
    nan: { kind: 'bought', until: null },
    past: { kind: 'bought', until: NOW - 1 },
    far: { kind: 'bought', until: NOW + TTL_MS + 5 },
    empty: null,
    num: 5,
    [`${'x'.repeat(81)}`]: { kind: 'greeted', until: NOW + 1000 },
  } }))
  assert.deepEqual([...mixed.keys()], ['good'])
  // A store that throws, or none at all, remembers nothing and breaks nothing.
  const broken = { getItem: () => { throw new Error('off') }, setItem: () => { throw new Error('off') } }
  assert.equal(readAcquaintances(NOW, broken).size, 0)
  remember('kunle', 'greeted', NOW, broken)
  remember('kunle', 'greeted', NOW, null)
  assert.equal(recall('kunle', NOW, null), null)
  // A bad write over bad data heals it.
  const store = memory({ [ACQUAINTANCE_KEY]: '{oops' })
  remember('kunle', 'bought', NOW, store)
  assert.equal(recall('kunle', NOW, store), 'bought')
  remember('', 'bought', NOW, store)
  remember('kunle', 'splashed' as never, NOW, store)
  assert.deepEqual([...readAcquaintances(NOW, store).keys()], ['kunle'])
})

test('the NPC card\'s interactions map to a kind: hello, gist, joke and compliment are greeting; the drink is buying', () => {
  assert.deepEqual(['hello', 'gist', 'joke', 'compliment', 'drink', 'other', ''].map(kindOfAction), ['greeted', 'greeted', 'greeted', 'greeted', 'bought', null, null])
})

test('the ambient layer looks at the same key as the store', () => {
  assert.equal(LAYER_KEY, ACQUAINTANCE_KEY)
  assert.match(readFileSync(new URL('../scene/ambient/layer.ts', import.meta.url), 'utf8'), /import\('\.\.\/\.\.\/news\/acquaintance\.ts'\)/)
})

test('thirty lines for each kind, ten in each register, short and with no money, and a regular says the same thing all day', () => {
  for (const kind of ['greeted', 'bought'] as const) {
    const all = Object.values(MEMORY_LINES[kind]).flat()
    assert.equal(all.length, 30, kind)
    assert.equal(new Set(all).size, 30, `${kind} has no twins`)
    for (const register of ['lagos', 'kano', 'english'] as const) assert.equal(MEMORY_LINES[kind][register].length, 10)
    for (const line of all) { assert.ok(line.length <= 50, line); assert.doesNotMatch(line, /[₦$£€]|naira|kobo|\{/i) }
  }
  assert.equal(memoryLine('greeted', 'lagos', 'kunle'), memoryLine('greeted', 'lagos', 'kunle'))
  const seeds = Array.from({ length: 40 }, (_, i) => `person-${i}`)
  assert.ok(new Set(seeds.map((seed) => memoryLine('bought', 'kano', seed))).size >= 6, 'different people say different things')
})
