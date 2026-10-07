import { loadCityContent as preloadCityContent } from '../cities/registry.ts'
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent))
// Power at home: NEPA light, the generator's petrol, the inverter, and the bonus a powered room gives (docs/REALISM.md §8).
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { lagosDayStart, lagosTime } from '../clock.ts'
import { makeContext } from '../util.ts'
import type { ActionBody, ActionResult, ActionType } from '../../types/actions.ts'
import type { LifeContext, LifeState } from '../../types/life.ts'
import { powerCutsOn, powerCutAt } from './conditions.ts'
import { LITRE_PRICE, LITRE_SECONDS, TANK_LITRES, TANK_SECONDS } from './power.ts'
import { powerOf, qualityOf } from '../systems/home.ts'

const ctxAt = (now: number): LifeContext => makeContext({ now, cityId: 'lagos', seed: 'home-power' })
const act = <T extends ActionType>(state: LifeState, type: T, payload: unknown, now: number): ActionResult<T> => dispatch(state, { type, payload } as unknown as ActionBody<T>, ctxAt(now))

/** The default rented room is in Yaba. Find a cut there that begins well inside a day, so the tests do not depend on a lucky date. */
const DISTRICT = 'Yaba'
function aCut(skip = 0) {
  let seen = 0
  for (let day = lagosTime(Date.UTC(2026, 0, 1)).day; day < lagosTime(Date.UTC(2026, 0, 1)).day + 400; day++) {
    for (const cut of powerCutsOn('lagos', DISTRICT, day)) {
      const length = cut.to - cut.from
      if (length >= 2 * 3600000 && length <= 4 * 3600000 && cut.from - 3600000 > lagosDayStart(day) && cut.to < lagosDayStart(day + 1) && !powerCutAt('lagos', DISTRICT, cut.from - 3600000) && seen++ >= skip) return cut
    }
  }
  throw new Error('no cut found')
}
const GENERATOR = { id: 'f1', itemId: 'generator', x: 4, y: 4, rot: 0 }
const INVERTER = { id: 'f2', itemId: 'inverter', x: 3, y: 4, rot: 0 }
const TV = { id: 'f3', itemId: 'small-tv', x: 3, y: 1, rot: 0 }
const room = (items: object[], fuel: number, now: number, extra: Record<string, unknown> = {}): LifeState =>
  createLife({ location: 'home', cash: 100000, home: { items, fuel, custom: true, stocked: true }, ...extra }, ctxAt(now))

test('an old save with no fuel loads as an empty tank, and fuel is kept, rounded and held to the tank', () => {
  const now = Date.UTC(2026, 0, 5, 8)
  assert.equal(createLife({ location: 'home', home: { items: [GENERATOR], custom: true } }, ctxAt(now)).home.fuel, 0)
  assert.equal(createLife({ home: { items: [GENERATOR], fuel: 5000.4 } }, ctxAt(now)).home.fuel, 5000)
  assert.equal(createLife({ home: { items: [GENERATOR], fuel: 1e12 } }, ctxAt(now)).home.fuel, TANK_SECONDS)
  for (const junk of [-5, 'lots', null, NaN, {}]) assert.equal(createLife({ home: { items: [GENERATOR], fuel: junk } }, ctxAt(now)).home.fuel, 0, String(junk))
  assert.equal(createLife(null, ctxAt(now)).home.fuel, 0)
})

test('buying petrol charges the wallet, fills the tank and refuses what the tank cannot hold', () => {
  const now = Date.UTC(2026, 0, 5, 8)
  const state = room([GENERATOR], 0, now)
  assert.equal(act(state, 'home.refuel', { litres: 5 }, now).ok, true)
  assert.deepEqual([state.home.fuel, state.cash], [5 * LITRE_SECONDS, 100000 - 5 * LITRE_PRICE])
  assert.equal(state.ledger.at(-1)?.reason, 'Generator fuel: 5 litres')
  assert.equal(viewLife(state, ctxAt(now)).home.power.fuel, 5)
  const full = act(state, 'home.refuel', { litres: TANK_LITRES }, now)
  assert.deepEqual([full.ok, full.code], [false, 'tank_full'])
  assert.equal(state.cash, 100000 - 5 * LITRE_PRICE, 'a refusal costs nothing')
  assert.equal(act(state, 'home.refuel', { litres: TANK_LITRES - 5 }, now).ok, true)
  assert.equal(act(state, 'home.refuel', { litres: 1 }, now).code, 'tank_full')
  for (const litres of [0, -1, 1.5, 21, '3', null, undefined]) assert.equal(act(room([GENERATOR], 0, now), 'home.refuel', { litres }, now).code, 'invalid_quantity', String(litres))
  assert.equal(act(room([TV], 0, now), 'home.refuel', { litres: 1 }, now).code, 'no_generator')
  const poor = room([GENERATOR], 0, now, { cash: 1000 })
  assert.equal(act(poor, 'home.refuel', { litres: 2 }, now).code, 'insufficient_funds')
  assert.deepEqual([poor.cash, poor.home.fuel], [1000, 0])
})

test('the generator burns petrol only while the light is off, by the server clock, at any polling rhythm', () => {
  const cut = aCut()
  const start = cut.from - 600000
  const whole = room([GENERATOR], 3 * 3600, start)
  advanceLife(whole, (cut.to + 3600000 - start) / 1000, ctxAt(cut.to + 3600000))
  const burned = (cut.to - cut.from) / 1000
  assert.equal(whole.home.fuel, 3 * 3600 - burned)
  const stepped = room([GENERATOR], 3 * 3600, start)
  for (let t = start + 7000; t < cut.to + 3600000 + 7000; t += 7000) advanceLife(stepped, 7, ctxAt(Math.min(t, cut.to + 3600000)))
  assert.ok(Math.abs(stepped.home.fuel - whole.home.fuel) <= 7, `${stepped.home.fuel} vs ${whole.home.fuel}`)
  const dry = room([GENERATOR], 3 * 3600, start)
  advanceLife(dry, 500, ctxAt(start + 500000))
  assert.equal(dry.home.fuel, 3 * 3600, 'light is still on for the first 500 seconds: nothing burned')
})

test('no petrol is burned away from home, without a generator, or with an inverter', () => {
  const cut = aCut()
  const inside = cut.from + 3600000
  for (const [what, items, extra] of [['away', [GENERATOR], { location: 'park' }], ['no generator', [TV], {}], ['inverter too', [GENERATOR, INVERTER], {}]] as const) {
    const state = createLife({ cash: 100000, location: 'home', ...extra, home: { items, fuel: 7200, custom: true, stocked: true } }, ctxAt(cut.from - 60000))
    advanceLife(state, (inside - (cut.from - 60000)) / 1000, ctxAt(inside))
    assert.equal(state.home.fuel, 7200, what)
  }
})

test('running out of petrol puts the light out, takes the power bonus, and says so', () => {
  const cut = aCut()
  const state = room([GENERATOR, TV], 1800, cut.from - 60000)
  advanceLife(state, 60, ctxAt(cut.from))
  assert.equal(powerOf(state, cut.from + 1000).source, 'generator')
  assert.equal(qualityOf(state, 'tv', cut.from + 1000), 1.25 * 1.2, 'petrol in the tank: the room is powered')
  advanceLife(state, 3600, ctxAt(cut.from + 3600000))
  assert.equal(state.home.fuel, 0)
  assert.equal(powerOf(state, cut.from + 3600000).source, 'none')
  assert.equal(qualityOf(state, 'tv', cut.from + 3600000), 1.25, 'no petrol: the bonus is gone')
  assert.equal(qualityOf(state, 'tv', cut.to + 1000), 1.25 * 1.2, 'the light is back: powered again')
  const texts = state.social.notices.map((notice) => notice.text)
  assert.ok(texts.some((text) => /^NEPA has taken light in Yaba\. Light is due back around/.test(text)), texts.join(' | '))
  assert.ok(texts.some((text) => /run out of petrol/.test(text)))
  assert.ok(state.social.notices.some((notice) => notice.kind === 'power'))
})

test('an inverter carries the room through the cut with no petrol; a room with neither loses the bonus', () => {
  const cut = aCut()
  const during = cut.from + 1800000
  assert.equal(qualityOf(room([INVERTER, TV], 0, during), 'tv', during), 1.25 * 1.2)
  assert.equal(powerOf(room([INVERTER], 0, during), during).source, 'inverter')
  const bare = room([TV], 0, during)
  assert.equal(qualityOf(bare, 'tv', during), 1.25, 'no power item: no bonus, as before')
  assert.equal(qualityOf(room([GENERATOR, TV], 0, cut.to + 60000), 'tv', cut.to + 60000), 1.25 * 1.2, 'on the grid a placed generator still gives the bonus')
  const view = viewLife(room([GENERATOR, TV], 7200, during), ctxAt(during)).home.power
  assert.deepEqual([view.district, view.grid, view.until, view.source, view.generator, view.fuel, view.tank, view.litrePrice], ['Yaba', false, cut.to, 'generator', true, 3, TANK_LITRES, LITRE_PRICE])
})
