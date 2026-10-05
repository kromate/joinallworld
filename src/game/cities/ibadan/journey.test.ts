import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../../life.ts'
import { DEFAULT_LOOK } from '../../content/traits.ts'
import { ibadanCity } from './index.ts'
import { cityModule, loadCityContent, registerCityForTest } from '../registry.ts'
import { createKit } from '../../../scene/kit.ts'
import { buildVenueScene } from '../../../scene/venue-scenes.ts'
import { sceneVenue } from '../../../venue-world.ts'
import type { LifeContextInit, LifeState, NeedMap } from '../../../types/life.ts'

const MONDAY = Date.UTC(2026, 0, 5, 9)

async function useIbadan(): Promise<() => void> {
  const registration = cityModule('ibadan') ? null : registerCityForTest(ibadanCity, { replaceClosed: true })
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')])
  return () => registration?.dispose()
}

function journeyClock(start = MONDAY): {
  at: (state?: LifeState, extras?: Partial<LifeContextInit>) => LifeContextInit
  finish: (state: LifeState) => void
} {
  let now = start, sequence = 0
  const at = (state?: LifeState, extras: Partial<LifeContextInit> = {}): LifeContextInit => ({
    now,
    cityId: state?.estate.city ?? 'ibadan',
    seed: `ibadan-journey-${sequence += 1}`,
    ...extras,
  })
  const finish = (state: LifeState): void => {
    const remaining = state.activeAction?.remaining
    if (typeof remaining !== 'number') assert.fail('a timed action is running')
    now += (remaining + 1) * 1000
    assert.equal(advanceLife(state, remaining + 1, at(state)).ok, true)
    assert.equal(state.activeAction, null)
  }
  return { at, finish }
}

function finishOnboarding(state: LifeState, clock: ReturnType<typeof journeyClock>, lga: string): void {
  assert.equal(dispatch(state, { type: 'onboarding.look', payload: { look: DEFAULT_LOOK } }, clock.at(state)).code, 'look_saved')
  assert.equal(dispatch(state, { type: 'onboarding.traits', payload: { traits: ['clean-pikin', 'musical'] } }, clock.at(state)).code, 'traits_saved')
  assert.equal(dispatch(state, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } }, clock.at(state)).code, 'dream_saved')
  assert.equal(dispatch(state, { type: 'onboarding.lottery', payload: {} }, clock.at(state)).code, 'rolled')
  assert.equal(dispatch(state, { type: 'onboarding.home', payload: { lga, via: 'manual' } }, clock.at(state)).code, 'life_started')
}

test('a new Ibadan player settles in and completes a paid local shift', async () => {
  const dispose = await useIbadan()
  try {
    const clock = journeyClock()
    const state = createLife(null, { ...clock.at(), isNew: true })
    finishOnboarding(state, clock, 'ibadan-north')
    assert.deepEqual(
      [state.estate.city, state.estate.lga, state.estate.lgaConfirmed, state.estate.living, state.location],
      ['ibadan', 'ibadan-north', true, 'own', 'home'],
    )

    assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'community-helper' } }, clock.at(state)).code, 'applied')
    assert.deepEqual([state.job, state.career.city], ['community-helper', 'ibadan'])
    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'mapo-hall', mode: 'trek' } }, clock.at(state)).code, 'started')
    clock.finish(state)
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'work' } }, clock.at(state)).code, 'selected')
    const shift = viewLife(state, clock.at(state)).career.shift
    const job = viewLife(state, clock.at(state)).career.jobs.find((item) => item.id === 'community-helper')
    assert.ok(shift)
    assert.ok(job)
    const before = state.cash
    assert.equal(dispatch(state, { type: 'activity', payload: { id: shift.id } }, clock.at(state)).code, 'started')
    clock.finish(state)
    assert.equal(state.cash, before + job.pay, 'the local shift pays exactly the listed amount')
    assert.equal(state.completedShifts, 1)
  } finally {
    dispose()
  }
})

test('one Lagos character goes to Ibadan by road and returns by rail with one wallet, job and needs', async () => {
  const dispose = await useIbadan()
  try {
    const clock = journeyClock()
    let state = createLife(null, { ...clock.at(undefined, { cityId: 'lagos' }), isNew: true })
    finishOnboarding(state, clock, 'ikeja')
    assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'community-helper' } }, clock.at(state)).code, 'applied')
    const lagosHome = { lga: state.estate.lga, tier: state.estate.tier, living: state.estate.living }
    state.needs = { hunger: 81, energy: 72, fun: 63, social: 54, hygiene: 45, bladder: 36 }
    const cashBeforeRoad = state.cash

    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' } }, clock.at(state)).code, 'departed')
    clock.finish(state)
    assert.deepEqual([state.estate.city, state.cash, state.job, state.career.city, state.estate.lga], ['ibadan', cashBeforeRoad - 3500, 'community-helper', 'lagos', null])
    const afterRoad = { cash: state.cash, needs: structuredClone(state.needs), job: state.job, career: structuredClone(state.career) }
    state = createLife(structuredClone(state), { ...clock.at(state), trustedSave: true })
    assert.deepEqual({ cash: state.cash, needs: state.needs, job: state.job, career: state.career }, afterRoad)

    const cashBeforeChoice = state.cash
    assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'ibadan-north', via: 'manual' } }, clock.at(state)).code, 'lga_set')
    assert.deepEqual([state.estate.lga, state.estate.lgaConfirmed, state.cash], ['ibadan-north', true, cashBeforeChoice], 'the first Ibadan home choice is free')
    const cashBeforeRail = state.cash
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'rail' } }, clock.at(state)).code, 'departed')
    clock.finish(state)
    assert.deepEqual([state.estate.city, state.cash, state.job, state.career.city], ['lagos', cashBeforeRail - 9000, 'community-helper', 'lagos'])
    assert.deepEqual({ lga: state.estate.lga, tier: state.estate.tier, living: state.estate.living }, lagosHome)
    const returned = { cash: state.cash, needs: structuredClone(state.needs), job: state.job, career: structuredClone(state.career) }
    state = createLife(structuredClone(state), { ...clock.at(state), trustedSave: true })
    assert.deepEqual({ cash: state.cash, needs: state.needs, job: state.job, career: state.career }, returned)
  } finally {
    dispose()
  }
})

test('legacy Ibadan lives choose an LGA once for free without losing cash, job or needs', async () => {
  const dispose = await useIbadan()
  try {
    const savedNeeds: NeedMap = { hunger: 81, energy: 72, fun: 63, social: 54, hygiene: 45, bladder: 36 }
    for (const estate of [{ city: 'ibadan' }, { city: 'ibadan', lga: 'ikeja', lgaConfirmed: false }]) {
      const clock = journeyClock()
      let state = createLife({
        t: MONDAY,
        cash: 123_456,
        needs: savedNeeds,
        job: 'community-helper',
        career: { city: 'ibadan', level: 1, performance: 0, shifts: 2 },
        estate,
      }, { ...clock.at(), trustedSave: true })
      assert.equal(state.onboarding.legacy, true)
      assert.deepEqual([state.estate.lga, state.estate.lgaConfirmed, viewLife(state, clock.at(state)).estate.placed], [null, false, false])
      assert.deepEqual({ cash: state.cash, needs: state.needs, job: state.job }, { cash: 123_456, needs: savedNeeds, job: 'community-helper' })

      assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'ibadan-north', via: 'manual' } }, clock.at(state)).code, 'lga_set')
      assert.deepEqual([state.estate.lga, state.estate.lgaConfirmed, state.cash], ['ibadan-north', true, 123_456])
      assert.deepEqual(state.needs, savedNeeds)
      assert.equal(state.job, 'community-helper')
      state = createLife(structuredClone(state), { ...clock.at(state), trustedSave: true })
      assert.deepEqual([state.estate.lga, state.estate.lgaConfirmed, viewLife(state, clock.at(state)).estate.placed], ['ibadan-north', true, true], 'reload does not ask again')
      assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'ibadan-north', via: 'manual' } }, clock.at(state)).code, 'unchanged')
      assert.equal(state.cash, 123_456)

      const cashBeforeMoveIn = state.cash
      assert.equal(dispatch(state, { type: 'estate.move-in', payload: {} }, clock.at(state)).code, 'moved_in')
      assert.deepEqual([state.estate.living, state.cash], ['own', cashBeforeMoveIn], 'moving into the starter house is free')
      assert.equal(dispatch(state, { type: 'estate.move-in', payload: {} }, clock.at(state)).code, 'already_home')
    }
  } finally {
    dispose()
  }
})

test('the free Ibadan home restores basic needs and UCH free care cures illness', async () => {
  const dispose = await useIbadan()
  try {
    const clock = journeyClock()
    const state = createLife(null, { ...clock.at(), isNew: true })
    finishOnboarding(state, clock, 'ibadan-north')
    state.needs = { hunger: 5, energy: 5, fun: 50, social: 50, hygiene: 5, bladder: 50 }
    const cash = state.cash, debits = state.ledger.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0)
    for (const [spot, activity] of [['kitchen', 'garri'], ['bathroom', 'bath'], ['bedroom', 'nap']] as const) {
      assert.equal(dispatch(state, { type: 'spot', payload: { id: spot } }, clock.at(state)).code, 'selected')
      assert.equal(dispatch(state, { type: 'activity', payload: { id: activity } }, clock.at(state)).code, 'started')
      clock.finish(state)
    }
    assert.ok(state.needs.hunger >= 20 && state.needs.hygiene >= 20 && state.needs.energy >= 20, JSON.stringify(state.needs))
    assert.ok(state.cash >= cash, 'goal rewards may arrive while the player recovers')
    assert.equal(state.ledger.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0), debits, 'the basic recovery loop has no debit')

    state.health = { sick: true, cause: 'rain', since: MONDAY, strain: 0, immuneUntil: 0 }
    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'uch', mode: 'trek' } }, clock.at(state)).code, 'started')
    clock.finish(state)
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'ward' } }, clock.at(state)).code, 'selected')
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'hospital-free' } }, clock.at(state)).code, 'started')
    clock.finish(state)
    assert.equal(state.health.sick, false)
    assert.ok(state.cash >= cash)
    assert.equal(state.ledger.filter((entry) => entry.amount < 0).reduce((sum, entry) => sum + entry.amount, 0), debits, 'trekking and the free clinic have no debit')
  } finally {
    dispose()
  }
})

test('every public Ibadan scene spot has a walkable path from its entrance', async () => {
  const dispose = await useIbadan()
  const kit = createKit()
  try {
    const content = await ibadanCity.loadContent()
    for (const venue of content.venues.filter((item) => item.id !== 'home')) {
      const definition = sceneVenue(venue.id, 'ibadan')
      assert.ok(definition, venue.id)
      const entry = buildVenueScene(kit, definition, 'ibadan')
      const grid = entry.walk.grid, entrance = entry.walk.entrance
      assert.ok(grid && entrance, `${venue.id}: walk grid and entrance`)
      for (const spot of entry.walk.spots()) {
        const near = grid.nearest(spot.approach?.x ?? spot.x, spot.approach?.z ?? spot.z)
        assert.ok(near && grid.path(entrance.x, entrance.z, near.x, near.z)?.length, `${venue.id}: ${spot.id} is reachable`)
      }
      entry.dispose()
    }
  } finally {
    kit.dispose()
    dispose()
  }
})


test('a quick-start guest begins at Agodi Gardens and can play before choosing a home', async () => {
  const dispose = await useIbadan()
  try {
    const clock = journeyClock()
    const state = createLife(null, { ...clock.at(), isNew: true, quickStart: true })
    assert.equal(state.location, 'agodi-gardens')
    const result = dispatch(state, { type: 'onboarding.quick-start', payload: { look: DEFAULT_LOOK } }, clock.at(state))
    assert.equal(result.ok, true)
    assert.equal(state.location, 'agodi-gardens')
    assert.equal(state.onboarding.done, false)
    assert.equal(state.estate.lga, null)
  } finally { dispose() }
})
