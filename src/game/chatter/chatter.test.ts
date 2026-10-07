import assert from 'node:assert/strict'
import test from 'node:test'
import { CITY_CATALOGUE } from '../cities/catalogue.ts'
import { EXCHANGE_BANK, SETTLE_MS, SLOT_MS, SPEAK_RATE, START_WINDOW_MS, VISIT_CAP, createChatter, exchangeAt, exchangesFromMoments } from './index.ts'
import type { ChatterContext, Exchange } from './index.ts'
import { BETA_CHATTER_LANGS } from './types.ts'

const MORNING = Date.UTC(2026, 9, 6, 8)
const FIRST_SLOT = Math.floor(MORNING / SLOT_MS)
const REGULARS = [{ id: 'npc-c', name: 'Mama Put' }, { id: 'npc-a', name: 'Chidi' }, { id: 'npc-b', name: 'Tunde' }]
const here = (extra: Partial<ChatterContext> = {}): ChatterContext => ({ cityId: 'lagos', venueId: 'buka-1', place: { kind: 'buka' }, regulars: REGULARS, ...extra })
const speaking = (context: ChatterContext, from = FIRST_SLOT, bank: readonly Exchange[] = EXCHANGE_BANK): number => {
  for (let slot = from; slot < from + 200; slot += 1) if (exchangeAt(bank, context, slot)) return slot
  throw new Error('no slot speaks')
}

test('the bank has unique ids, short plain lines and beta marking on every language but English', () => {
  const ids = new Set<string>()
  for (const exchange of EXCHANGE_BANK) {
    assert.ok(!ids.has(exchange.id), `duplicate id ${exchange.id}`)
    ids.add(exchange.id)
    assert.equal(exchange.lines.length, 2)
    for (const line of exchange.lines) assert.ok(line.length >= 2 && line.length <= 90, `${exchange.id}: line length ${line.length}`)
    if (BETA_CHATTER_LANGS.includes(exchange.lang)) assert.equal(exchange.beta, true, `${exchange.id} (${exchange.lang}) must be beta`)
    for (const city of exchange.cityIds ?? []) assert.ok(CITY_CATALOGUE.some((entry) => entry.id === city), `${exchange.id}: unknown city ${city}`)
  }
  assert.ok(EXCHANGE_BANK.length >= 40, `only ${EXCHANGE_BANK.length} exchanges`)
  assert.ok(EXCHANGE_BANK.some((exchange) => exchange.beta) && EXCHANGE_BANK.some((exchange) => !exchange.beta))
})

test('the same venue and slot give the same exchange between the same two regulars, whatever order they are listed in', () => {
  const slot = speaking(here())
  const one = exchangeAt(EXCHANGE_BANK, here(), slot)
  const two = exchangeAt(EXCHANGE_BANK, here({ regulars: [...REGULARS].reverse() }), slot)
  assert.deepEqual(one, two)
  assert.ok(one)
  assert.notEqual(one.first.npcId, one.second.npcId, 'two different regulars')
  assert.ok(REGULARS.some((regular) => regular.id === one.first.npcId) && REGULARS.some((regular) => regular.id === one.second.npcId))
  assert.ok(one.startsAt >= slot * SLOT_MS && one.startsAt + START_WINDOW_MS <= (slot + 1) * SLOT_MS, 'the exchange starts and ends inside its slot')
})

test('nothing is said at home or by fewer than two regulars', () => {
  for (let slot = FIRST_SLOT; slot < FIRST_SLOT + 100; slot += 1) {
    assert.equal(exchangeAt(EXCHANGE_BANK, here({ place: { kind: 'home' } }), slot), null)
    assert.equal(exchangeAt(EXCHANGE_BANK, here({ regulars: [REGULARS[0] as never] }), slot), null)
    assert.equal(exchangeAt(EXCHANGE_BANK, here({ regulars: [] }), slot), null)
  }
})

test('a venue is quiet in a good share of its slots, not a stream', () => {
  const slots = 400
  let talk = 0
  for (let slot = FIRST_SLOT; slot < FIRST_SLOT + slots; slot += 1) if (exchangeAt(EXCHANGE_BANK, here(), slot)) talk += 1
  assert.ok(Math.abs(talk / slots - SPEAK_RATE) < 0.1, `spoke in ${talk} of ${slots}`)
})

test('no exchange repeats back to back, and a different venue hears different talk', () => {
  const heard = (context: ChatterContext): string[] => Array.from({ length: 150 }, (_, i) => exchangeAt(EXCHANGE_BANK, context, FIRST_SLOT + i)?.exchangeId).filter((id): id is string => Boolean(id))
  const a = heard(here())
  for (let i = 1; i < a.length; i += 1) assert.notEqual(a[i], a[i - 1])
  assert.notDeepEqual(a, heard(here({ venueId: 'buka-2' })))
})

test('a city exchange only plays in its own city', () => {
  const pool: Exchange[] = [{ id: 't-1', lines: ['One.', 'Two.'], cityIds: ['kano'], weight: 1, lang: 'en', beta: false }]
  assert.equal(speaking(here({ cityId: 'kano' }), FIRST_SLOT, pool) >= FIRST_SLOT, true)
  for (let slot = FIRST_SLOT; slot < FIRST_SLOT + 100; slot += 1) assert.equal(exchangeAt(pool, here({ cityId: 'lagos' }), slot), null)
})

test('a visit hears one exchange per slot, none while the scene settles, and no more than the cap', () => {
  const slot = speaking(here())
  const chosen = exchangeAt(EXCHANGE_BANK, here(), slot)
  assert.ok(chosen)
  const settling = createChatter(EXCHANGE_BANK)
  assert.equal(settling.poll(here(), chosen.startsAt - 1000), null)
  assert.equal(settling.poll(here(), chosen.startsAt), null, 'still settling')
  assert.deepEqual(settling.poll(here(), chosen.startsAt + SETTLE_MS - 500)?.exchangeId, chosen.exchangeId, 'due until its window ends')
  assert.equal(settling.poll(here(), chosen.startsAt + SETTLE_MS), null, 'once only')
  const late = createChatter(EXCHANGE_BANK)
  late.poll(here(), chosen.startsAt - 60_000)
  assert.equal(late.poll(here(), chosen.startsAt + START_WINDOW_MS + 1), null, 'a late arrival does not replay it')
  const timely = createChatter(EXCHANGE_BANK)
  timely.poll(here(), chosen.startsAt - 30_000)
  assert.equal(timely.poll(here(), chosen.startsAt + 1)?.exchangeId, chosen.exchangeId)
  timely.reset()
  assert.equal(timely.poll(here(), chosen.startsAt + 2), null, 'a new visit settles again')

  const long = createChatter(EXCHANGE_BANK)
  const heard: number[] = []
  for (let now = MORNING; now < MORNING + 60 * 60_000; now += 4_000) { const got = long.poll(here(), now); if (got) heard.push(got.slot) }
  assert.ok(heard.length > 0 && heard.length <= VISIT_CAP, `heard ${heard.length}`)
  assert.equal(new Set(heard).size, heard.length, 'one per slot')
})

test('moment lines that are already two voices become exchanges, with the moment\'s place and beta mark', () => {
  const moments = [
    { id: 'm1', text: '“How much is this one?” “For you, special price.”', weight: 3, placeKinds: ['market'] },
    { id: 'm2', text: 'Just one sentence here.', weight: 1 },
    { id: 'm3', text: '“Wetin dey happen?” “Nothing, we dey.”', weight: 2 },
    { id: 'm4', text: '“Sannu.” “Yauwa.”', weight: 1, lang: 'ha', beta: true },
    { id: 'm5', text: '“Hello.” “Hi.”', weight: 1, cond: { rain: true } },
  ] as never
  const made = exchangesFromMoments(moments)
  assert.deepEqual(made.map((exchange) => exchange.id), ['moment:m1', 'moment:m3', 'moment:m4'])
  assert.deepEqual(made[0]?.lines, ['How much is this one?', 'For you, special price.'])
  assert.deepEqual(made[0]?.placeKinds, ['market'])
  assert.equal(made[0]?.beta, false)
  assert.equal(made[1]?.beta, true, 'Pidgin is beta')
  assert.equal(made[2]?.beta, true)
})
