// The shared ticker: one look turns what the page can see into a line, a new city is a new board, the live adapter asks the conditions code
// for the districts out of light, and the radio reads what the ticker said.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cachedCityContent, loadCityContent } from '../game/cities/registry.ts'
import { powerCutsOn } from '../game/conditions/grid.ts'
import { lagosDayStart, lagosTime } from '../game/clock.ts'
import { districtsOf, liveSource, lifeOf, outagesIn } from './live.ts'
import { look, recentLines, resetTicker, ticker, tickerCity, watchTicker } from './ticker.ts'
import type { TickerSource } from './ticker.ts'
import { radioLine } from './radio.ts'
await loadCityContent('lagos')
await loadCityContent('kano')

const NOON = Date.UTC(2026, 9, 20, 11, 0)
const source = (more: Partial<TickerSource> = {}): TickerSource => ({
  city: () => 'lagos', cityName: () => 'Lagos', register: () => 'lagos', now: () => NOON, gist: () => [], life: () => null, outages: () => [], refresh: () => undefined, ...more,
})

test('a look posts a line into the shared board, and asks the gist store to read at most once a minute', () => {
  resetTicker()
  let asked = 0
  const from = source({ refresh: () => { asked++ } })
  const line = look(from, () => 0)
  assert.equal(line?.topic, 'afternoon')
  assert.equal(ticker.line, line!.text)
  assert.equal(ticker.at, NOON)
  assert.equal(asked, 1)
  assert.equal(tickerCity(), 'lagos')
  look(source({ now: () => NOON + 20000, refresh: () => { asked++ } }), () => 0)
  assert.equal(asked, 1, 'not again within the minute')
  look(source({ now: () => NOON + 61000, refresh: () => { asked++ } }), () => 0)
  assert.equal(asked, 2)
  assert.equal(recentLines(NOON + 61000).length, 1)
  resetTicker()
})

test('a new city is a new board: nothing said about one city is said in another', () => {
  resetTicker()
  look(source({ outages: () => [{ district: 'Yaba', from: NOON - 1000 }] }), () => 0)
  assert.match(ticker.line, /Yaba/)
  look(source({ city: () => 'kano', cityName: () => 'Kano', register: () => 'kano', now: () => NOON + 120000 }), () => 0)
  assert.equal(tickerCity(), 'kano')
  assert.doesNotMatch(ticker.line, /Yaba/)
  resetTicker()
})

test('the live source finds the districts out of light with the conditions code, the player\'s own first, and reads the life numbers', () => {
  // Find a moment when a Lagos district really is out of light (the same seeded answer the scene's lamps read).
  const districts = districtsOf('lagos')
  assert.ok(districts.length > 3, 'Lagos has districts')
  let found: { district: string; from: number; day: number } | null = null
  for (let day = lagosTime(NOON).day; day < lagosTime(NOON).day + 30 && !found; day++) for (const district of districts) {
    const cut = powerCutsOn('lagos', district, day)[0]
    if (cut) { found = { district, from: cut.from, day }; break }
  }
  assert.ok(found, 'some district loses light in a month')
  const during = found!.from + 3 * 60000
  const out = outagesIn('lagos', districts, during)
  assert.ok(out.some((o) => o.district === found!.district && o.from === found!.from))
  assert.ok(!outagesIn('lagos', districts, lagosDayStart(found!.day) + 1000).some((o) => o.from > lagosDayStart(found!.day) + 1000), 'a cut that has not begun is not out')
  assert.equal(districtsOf('lagos', undefined)[0], districts[0])
  const venue = cachedCityContent('lagos')!.venues.at(-1)!
  assert.equal(districtsOf('lagos', venue.id)[0], venue.district, 'the player\'s own district first')

  const live = liveSource({ cityId: () => 'lagos', state: () => ({ location: venue.id, cash: 500, career: { level: 2 }, goals: { chain: 3 } }), gistLines: () => [], askGist: () => undefined, now: () => during })
  assert.equal(live.cityName(), 'Lagos')
  assert.equal(live.register(), 'lagos')
  assert.deepEqual(live.life(), { cash: 500, level: 2, goals: 3 })
  assert.ok(live.outages(during).some((o) => o.district === found!.district))
  const kano = liveSource({ cityId: () => 'kano', state: () => null, gistLines: () => [], askGist: () => undefined })
  assert.equal(kano.register(), 'kano')
  assert.equal(kano.life(), null)
  assert.deepEqual(lifeOf({}), { cash: 0, level: 0, goals: 0 })
  assert.deepEqual(lifeOf({ cash: Number.NaN, career: { level: 'x' } }), { cash: 0, level: 0, goals: 0 })
})

test('the radio reads the ticker\'s own recent lines in turn, and the hour\'s colour when the ticker has said nothing', () => {
  resetTicker()
  const colour = radioLine('lagos', NOON, 0)
  assert.ok(colour.length > 10 && !colour.includes('{'))
  look(source({ gist: () => [{ n: 1, at: NOON - 1000, kind: 'busy', text: 'Lagos is buzzing: 12 people out right now' }] }), () => 0)
  look(source({ now: () => NOON + 60000, outages: () => [{ district: 'Yaba', from: NOON + 59000 }] }), () => 0)
  const lines = recentLines(NOON + 61000)
  assert.equal(lines.length, 2)
  assert.equal(radioLine('lagos', NOON + 61000, 0), lines[0]!.text)
  assert.equal(radioLine('lagos', NOON + 61000, 1), lines[1]!.text)
  assert.equal(radioLine('lagos', NOON + 61000, 2), lines[0]!.text)
  // Another city's radio does not read Lagos's board.
  assert.notEqual(radioLine('kano', NOON + 61000, 0), lines[0]!.text)
  assert.match(radioLine('kano', NOON + 61000, 0), /\w/)
  resetTicker()
})

test('a viewer starts the timer and the last one out stops it (nothing runs with nobody looking)', () => {
  resetTicker()
  const from = source({ now: () => Date.now() })
  const a = watchTicker(from), b = watchTicker(from)
  a(); a()
  b()
  assert.doesNotThrow(() => resetTicker())
})
