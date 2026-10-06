// The location-confirmed badge as the rules see it: the one action the device sends, what it records, when the record lapses
// or is deleted, and that a life saved before it existed loads unchanged. The check itself runs on the device (src/map3d/residence.ts).
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { DEFAULT_LOOK } from '../content/traits.ts'
import { CONFIRMATION_DAYS, CONFIRMATION_MS, mainHomeUnit, standingConfirmation } from '../residence.ts'
import { cityRules, loadCityContent } from './registry.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

await Promise.all(['lagos', 'abuja'].map(loadCityContent))

const DAY = 86400000
const unit = (city: string, index = 0): string => cityRules(city)!.units[index]!.id
function settled(seed: string) {
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? 'lagos', now, seed })
  const state = createLife({ name: 'Resident' }, { ...context(), isNew: true, quickStart: true })
  const run = (type: string, payload: object = {}) => dispatch(state, { type, payload } as never, context(state))
  const days = (count: number): void => { now += count * DAY; advanceLife(state, 1, context(state)) }
  run('onboarding.quick-start', { look: DEFAULT_LOOK })
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery', {})
  assert.equal(run('onboarding.home', { lga: unit('lagos'), via: 'manual' }).code, 'life_started')
  state.cash = 1_000_000
  return { state, run, days, view: () => viewLife(state, context(state)), context: () => context(state), now: () => now }
}

test('the device\'s word is recorded as the id and the server clock, and nothing else', () => {
  const life = settled('badge')
  assert.equal(life.state.estate.confirmed, undefined, 'absent by default')
  assert.deepEqual(life.view().estate.residence?.confirmed, null)
  const done = life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true })
  assert.equal(done.code, 'residence_confirmed')
  assert.deepEqual(life.state.estate.confirmed, { lga: unit('lagos'), at: life.now() })
  const residence = life.view().estate.residence!
  assert.deepEqual([residence.city, residence.lga, residence.days, residence.confirmed?.until], ['lagos', unit('lagos'), CONFIRMATION_DAYS, life.now() + CONFIRMATION_MS])
  // A payload that carries more is not kept: the stored shape is exactly { lga, at }.
  life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true, latitude: 6.6, longitude: 3.3, accuracy: 20, at: 5 })
  assert.deepEqual(Object.keys(life.state.estate.confirmed ?? {}).sort(), ['at', 'lga'])
  assert.ok(!JSON.stringify(life.state).includes('latitude'))
})

test('refusals: a wrong local government, a nothing-confirmed payload, a guest', () => {
  const life = settled('refuse')
  const other = unit('lagos', 3)
  assert.equal(life.run('estate.confirm-residence', { lga: other, ok: true }).code, 'not_main_home')
  assert.equal(life.run('estate.confirm-residence', { lga: unit('lagos'), ok: false }).code, 'not_confirmed')
  assert.equal(life.run('estate.confirm-residence', { lga: unit('lagos') }).code, 'not_confirmed')
  assert.equal(life.run('estate.confirm-residence', {}).code, 'not_main_home')
  assert.equal(life.state.estate.confirmed, undefined)
  const guest = createLife({ name: 'Guest' }, { cityId: 'lagos', now: Date.UTC(2026, 0, 5, 9), seed: 'guest', isNew: true, quickStart: true })
  const out = dispatch(guest, { type: 'estate.confirm-residence', payload: { lga: unit('lagos'), ok: true } } as never, { cityId: 'lagos', now: Date.UTC(2026, 0, 5, 9), seed: 'guest' })
  assert.equal(out.ok, false, 'a character that has not settled in has no home to confirm')
})

test('a visitor in another city confirms only the main home, never the city they stand in', () => {
  const life = settled('visitor')
  life.run('estate.relocate', { to: 'abuja', mode: 'air' })
  life.days(0)
  for (let i = 0; i < 40 && life.state.activeAction; i++) advanceLife(life.state, 1, life.context())
  assert.equal(life.state.estate.city, 'abuja')
  assert.deepEqual(mainHomeUnit(life.state.estate), { city: 'lagos', lga: unit('lagos') })
  assert.equal(life.run('estate.confirm-residence', { lga: unit('abuja'), ok: true }).code, 'not_main_home')
  assert.equal(life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true }).code, 'residence_confirmed', 'the home is Lagos wherever the character is')
  assert.equal(life.view().estate.residence?.city, 'lagos')
  // Moving the main home to Abuja voids it.
  assert.equal(life.run('estate.set-lga', { lga: unit('abuja'), via: 'manual', home: 'main' }).code, 'home_moved')
  assert.equal(life.state.estate.confirmed, undefined, 'a confirmation belongs to the old home')
  assert.equal(life.view().estate.residence?.city, 'abuja')
})

test('it lapses after ninety days, and switching it off deletes it', () => {
  assert.equal(CONFIRMATION_DAYS, 90)
  const life = settled('lapse')
  life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true })
  life.days(89)
  assert.ok(standingConfirmation(life.state.estate, life.now()))
  assert.ok(life.view().estate.residence?.confirmed)
  life.days(2)
  assert.equal(standingConfirmation(life.state.estate, life.now()), null)
  assert.equal(life.view().estate.residence?.confirmed, null, 'lapsed: the owner is offered a fresh check')
  // A save read after it lapsed does not bring it back.
  const reloaded = createLife(structuredClone(life.state), { ...life.context(), trustedSave: true })
  assert.equal(reloaded.estate.confirmed, undefined)
  // Off deletes at once; a second off changes nothing; on again needs a fresh action.
  assert.equal(life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true }).code, 'residence_confirmed')
  assert.equal(life.run('estate.unconfirm-residence').code, 'residence_removed')
  assert.equal('confirmed' in life.state.estate, false)
  assert.equal(life.run('estate.unconfirm-residence').code, 'unchanged')
})

test('a new local government at the main home clears it, and the old id is no longer accepted', () => {
  const life = settled('moved')
  life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true })
  life.days(31)
  life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true })
  const moved = life.run('estate.set-lga', { lga: unit('lagos', 4), via: 'manual' })
  assert.equal(moved.ok, true, moved.code)
  assert.equal(life.state.estate.confirmed, undefined)
  assert.equal(life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true }).code, 'not_main_home', 'the old id is no longer the home')
  assert.equal(life.run('estate.confirm-residence', { lga: unit('lagos', 4), ok: true }).code, 'residence_confirmed')
})

test('a life saved before the badge existed loads unchanged, with no field added', () => {
  const life = settled('legacy')
  const saved = structuredClone(life.state)
  assert.equal('confirmed' in saved.estate, false)
  const loaded = createLife(structuredClone(saved), { ...life.context(), trustedSave: true })
  assert.equal('confirmed' in loaded.estate, false)
  assert.deepEqual(loaded.estate, saved.estate)
  // A confirmation for some other place, or a malformed one, is dropped at load; a good one survives it.
  for (const bad of [{ lga: 'nowhere', at: life.now() }, { lga: unit('lagos'), at: 'yesterday' }, 'yes', { lga: unit('lagos') }]) {
    const copy = structuredClone(saved)
    Object.assign(copy.estate, { confirmed: bad })
    assert.equal('confirmed' in createLife(copy, { ...life.context(), trustedSave: true }).estate, false, JSON.stringify(bad))
  }
  life.run('estate.confirm-residence', { lga: unit('lagos'), ok: true })
  const kept = createLife(structuredClone(life.state), { ...life.context(), trustedSave: true })
  assert.deepEqual(kept.estate.confirmed, life.state.estate.confirmed)
})
