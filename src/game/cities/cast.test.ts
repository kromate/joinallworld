import assert from 'node:assert/strict'
import test from 'node:test'
import { CITY_CAST as calabarCast } from './calabar/cast.ts'
import { CITY_SPEC as CALABAR_SPEC } from './calabar/spec.ts'
import { castFor } from './formula/cast.ts'
import { createNamer, elderHonorific, nameRegionFor, NAME_POOLS } from './formula/names.ts'
import { loadCityContent, playableCityIds } from './registry.ts'
import { NUMBERED_NEIGHBOUR, validateCast } from './specValidation.ts'
import type { CastEntry } from './spec.ts'

const cityIds = [...playableCityIds()]
const contents = await Promise.all(cityIds.map(async id => [id, await loadCityContent(id)] as const))

const identityFacts = [
  ...CALABAR_SPEC.identity.foods, ...CALABAR_SPEC.identity.crafts, ...CALABAR_SPEC.identity.industries, ...(CALABAR_SPEC.identity.culture ?? []),
]
const identityIds = new Set(identityFacts.map(fact => fact.id))

/** A food, festival, landmark or language word in a line, and the sourced fact that must back it. */
const CLAIMS: readonly (readonly [RegExp, string])[] = [
  [/edikang/i, 'edikang-ikong'],
  [/afang/i, 'afang-soup'],
  [/ekpang/i, 'ekpang-nkukwo'],
  [/abak atama/i, 'abak-atama'],
  [/fisherman/i, 'fisherman-soup'],
  [/carnival|december/i, 'calabar-carnival-season'],
  [/marina resort/i, 'marina-resort'],
  [/duke town/i, 'duke-town-church'],
  [/tinapa/i, 'tinapa-resort'],
  [/obudu/i, 'obudu-resort'],
  [/great kwa/i, 'great-kwa-river'],
  [/\boban\b|national park/i, 'cross-river-national-park'],
  [/watt market/i, 'watt-market-goods'],
  [/emesiere|idem fo|sọsọñọ/i, 'efik-greetings'],
]

test('no regular in any city has a numbered neighbour name', () => {
  for (const [id, content] of contents) {
    assert.ok(content.regulars.length > 0, `${id} has regulars`)
    for (const regular of content.regulars) assert.doesNotMatch(regular.definition.name, NUMBERED_NEIGHBOUR, `${id} ${regular.id}`)
  }
})

test('regulars in every city have a distinct name and at least two lines', () => {
  for (const [id, content] of contents) {
    const names = content.regulars.map(regular => regular.definition.name)
    assert.equal(new Set(names).size, names.length, `${id} repeats a name`)
    for (const regular of content.regulars) assert.ok(regular.definition.quotes.length >= 2, `${id} ${regular.id}`)
  }
})

test('Calabar has 17 places and 34 authored regulars, two at each place', () => {
  assert.equal(CALABAR_SPEC.places.length, 17)
  assert.equal(calabarCast.length, 34)
  for (const place of CALABAR_SPEC.places) assert.equal(calabarCast.filter(entry => entry.placeId === place.id).length, 2, place.id)
  const content = contents.find(([id]) => id === 'calabar')?.[1]
  assert.equal(content?.regulars.length, 34)
  assert.deepEqual(
    content?.regulars.map(regular => regular.definition.name).sort(),
    calabarCast.map(entry => entry.name).sort(),
  )
})

test('every Calabar line about food, a festival, a landmark or Efik cites a sourced identity fact', () => {
  for (const entry of calabarCast) {
    const text = `${entry.role} ${entry.quotes.join(' ')}`
    for (const [pattern, factId] of CLAIMS) {
      if (!pattern.test(text)) continue
      assert.ok(identityIds.has(factId), `${factId} is a sourced identity fact`)
      assert.ok(entry.facts?.includes(factId), `${entry.name} mentions ${pattern} but does not cite ${factId}`)
    }
    for (const id of entry.facts ?? []) assert.ok(identityIds.has(id), `${entry.name} cites unknown fact ${id}`)
  }
  for (const fact of identityFacts) {
    for (const sourceId of fact.sourceIds) assert.ok(CALABAR_SPEC.sourceGroups.some(source => source.id === sourceId && source.supports.includes('identity')), `${fact.id} source ${sourceId}`)
  }
})

test('Calabar elders are Ete or Mma and never Eka', () => {
  const elders = calabarCast.filter(entry => entry.age === 'elder')
  assert.ok(elders.length >= 5)
  for (const entry of elders) {
    assert.match(entry.name, /^(Ete|Mma) \S+$/, entry.name)
    assert.doesNotMatch(entry.name, /\bEka\b/i)
  }
  assert.ok(calabarCast.some(entry => entry.age === 'young'))
  assert.ok(calabarCast.some(entry => entry.age === 'adult'))
  for (const entry of calabarCast) if (/^(Ete|Mma) /.test(entry.name)) assert.equal(entry.age, 'elder', entry.name)
})

test('every Efik greeting and honorific is beta, noted as awaiting native-speaker review, and backed by a source', () => {
  const content = contents.find(([id]) => id === 'calabar')?.[1]
  assert.ok(content)
  let greetings = 0
  for (const regular of content.regulars) {
    const { definition } = regular
    const efik = /emesiere|idem fo|sọsọñọ/i.test(definition.quotes.join(' ')) || /^(Ete|Mma) /.test(definition.name)
    if (!efik) continue
    assert.equal(definition.beta, true, definition.name)
    assert.match(definition.note ?? '', /native-speaker review/, definition.name)
    if (/emesiere|idem fo|sọsọñọ/i.test(definition.quotes.join(' '))) {
      assert.ok(definition.greeting, `${definition.name} opens in Efik without a greeting record`)
      assert.ok(identityIds.has(definition.greeting.identityId))
      assert.ok(definition.quotes[0]?.includes(definition.greeting.text))
      greetings += 1
    }
  }
  assert.ok(greetings >= 8)
  assert.ok(calabarCast.every(entry => !/\babadie\b|\bhenshaw\b/i.test(entry.quotes.join(' '))))
})

test('the cast validator rejects numbered names, an Eka elder, an unknown greeting source and a place with one regular', () => {
  const [first, second] = calabarCast
  assert.ok(first && second)
  const withCast = (cast: readonly CastEntry[]): readonly string[] => validateCast(CALABAR_SPEC, cast)
  assert.deepEqual(withCast(calabarCast), [])
  assert.ok(withCast([{ ...first, name: 'calabar neighbour 3' }, second]).some(error => /numbered/.test(error)))
  assert.ok(withCast([{ ...first, name: 'Eka Affiong' }, second]).some(error => /Eka/.test(error)))
  assert.ok(withCast([{ ...first, greeting: { text: 'Emesiere', meaning: 'Good morning', identityId: 'nope' } }, second]).some(error => /unknown identity/.test(error)))
  assert.ok(withCast([first]).some(error => /exactly two/.test(error)))
  assert.ok(withCast([{ ...first, facts: ['made-up'] }, second]).some(error => /unknown identity/.test(error)))
})

test('the generator names people from a regional pool without numbering or repeats', () => {
  const bare = CALABAR_SPEC
  const generated = castFor(bare, bare.places)
  assert.equal(generated.length, bare.places.length * 2)
  const names = generated.map(person => person.name)
  assert.equal(new Set(names).size, names.length)
  for (const person of generated) {
    assert.doesNotMatch(person.name, NUMBERED_NEIGHBOUR)
    assert.ok(person.age)
  }
  assert.deepEqual(castFor(bare, bare.places), generated)
  assert.ok(generated.some(person => person.age === 'elder' && /^(Ete|Mma) /.test(person.name)))
})

test('generated food and market lines use only the sourced identity facts', () => {
  const bare = CALABAR_SPEC
  const generated = castFor(bare, bare.places)
  const indexOf = (id: string): number => bare.places.findIndex(place => place.id === id)
  const eatery = generated.slice(indexOf('native-delicacies-food') * 2, indexOf('native-delicacies-food') * 2 + 2)
  assert.match(eatery[0]!.quotes[0], /Edikang Ikong/)
  const market = generated.slice(indexOf('watt-market') * 2, indexOf('watt-market') * 2 + 2)
  assert.match(market[0]!.quotes[0], /Watt Market goods/)
})

test('honorifics: Ete and Mma are used only for Efik regions', () => {
  assert.equal(nameRegionFor('cross-river'), 'efik')
  assert.equal(elderHonorific('efik', 'male'), 'Ete')
  assert.equal(elderHonorific('efik', 'female'), 'Mma')
  for (const region of Object.keys(NAME_POOLS) as (keyof typeof NAME_POOLS)[]) {
    if (region === 'efik') continue
    assert.notEqual(elderHonorific(region, 'male'), 'Ete', region)
    assert.notEqual(elderHonorific(region, 'female'), 'Mma', region)
  }
})

test('a namer is deterministic, unique and honours names already taken', () => {
  const draw = (taken: string[] = []): string[] => {
    const namer = createNamer('test-city', 'yoruba', taken)
    return Array.from({ length: 40 }, (_, index) => namer.next(index % 2 ? 'male' : 'female', index % 5 === 0))
  }
  const first = draw()
  assert.deepEqual(draw(), first)
  assert.equal(new Set(first).size, first.length)
  const avoided = draw(first.slice(0, 5))
  for (const name of first.slice(0, 5)) assert.ok(!avoided.includes(name))
})

test('every regular holds only the fields of an NPC definition, so nothing of the cast file leaks into the page', () => {
  const allowed = new Set(['id', 'venue', 'name', 'role', 'emoji', 'quotes', 'at', 'beta', 'note', 'age', 'look', 'greeting'])
  for (const [id, content] of contents) {
    for (const { definition } of content.regulars) {
      for (const key of Object.keys(definition)) assert.ok(allowed.has(key), `${id} ${definition.id} carries ${key}`)
    }
  }
})
