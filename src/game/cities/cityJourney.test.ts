import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { DEFAULT_LOOK } from '../content/traits.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import {
  FICTIONAL_CITY_ID,
  FICTIONAL_NEIGHBOUR_CITY_ID,
  fictionalCity,
  fictionalNeighbourCity,
} from './testing/fictionalCity.test-fixture.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

test('one character can settle, work, make a local friend and return from another fictional city intact', async () => {
  const registrations = [registerCityForTest(fictionalCity), registerCityForTest(fictionalNeighbourCity)]
  try {
    await Promise.all([loadCityContent(FICTIONAL_CITY_ID), loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)])
    let now = Date.UTC(2026, 0, 5, 9)
    const context = (): LifeContextInit => ({ now, cityId: FICTIONAL_CITY_ID, seed: `city-journey-${now}` })
    const finish = (state: LifeState): void => {
      const seconds = state.activeAction?.remaining
      if (typeof seconds !== 'number') assert.fail('a timed action is running')
      now += (seconds + 1) * 1000
      assert.equal(advanceLife(state, seconds + 1, context()).ok, true)
      assert.equal(state.activeAction, null)
    }

    let state = createLife(null, { ...context(), isNew: true })
    assert.equal(state.estate.city, FICTIONAL_CITY_ID)
    assert.equal(state.location, 'test-square')
    assert.deepEqual(viewLife(state, context()).onboarding.homes, [], 'Lagos rental choices do not leak into another city')

    assert.equal(dispatch(state, { type: 'onboarding.look', payload: { look: DEFAULT_LOOK } }, context()).code, 'look_saved')
    assert.equal(dispatch(state, { type: 'onboarding.traits', payload: { traits: ['clean-pikin', 'musical'] } }, context()).code, 'traits_saved')
    assert.equal(dispatch(state, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } }, context()).code, 'dream_saved')
    assert.equal(dispatch(state, { type: 'onboarding.lottery', payload: {} }, context()).code, 'rolled')
    assert.equal(dispatch(state, { type: 'onboarding.home', payload: { lga: 'test-central', via: 'manual' } }, context()).code, 'life_started')
    assert.deepEqual(
      [state.estate.city, state.estate.lga, state.estate.lgaConfirmed, state.estate.living, state.property.house, state.location],
      [FICTIONAL_CITY_ID, 'test-central', true, 'own', 'test-centre-flat', 'home'],
    )

    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'test-square', mode: 'trek' } }, context()).code, 'started')
    finish(state)
    assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'community-helper' } }, context()).code, 'applied')
    assert.deepEqual([state.job, state.career.city], ['community-helper', FICTIONAL_CITY_ID])
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'work' } }, context()).code, 'selected')
    const beforeShift = state.cash
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-help-shift' } }, context()).code, 'started')
    finish(state)
    assert.equal(state.cash, beforeShift + 100)
    assert.equal(state.completedShifts, 1)
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-help-shift' } }, context()).code, 'cooldown', 'the same shift pays once')

    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'people' } }, context()).code, 'selected')
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'npc-test-fictional-one-hello' } }, context()).code, 'started')
    finish(state)
    for (let interaction = 0; interaction < 3; interaction += 1) {
      assert.equal(dispatch(state, { type: 'activity', payload: { id: 'npc-test-fictional-one-drink' } }, context()).code, 'started')
      finish(state)
    }
    assert.equal(state.social.rel['test-fictional-one']?.p, 20, 'the local NPC is now a friend')
    assert.match(state.message, /Hello from One/)

    const cashBeforeTravel = state.cash
    const skillsBeforeTravel = structuredClone(state.skills)
    const peopleBeforeTravel = structuredClone(state.social.rel)
    const homeBeforeTravel = {
      lga: state.estate.lga,
      lgaConfirmed: state.estate.lgaConfirmed,
      tier: state.estate.tier,
      style: structuredClone(state.estate.style),
      living: state.estate.living,
      ground: structuredClone(state.estate.ground),
    }

    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: FICTIONAL_NEIGHBOUR_CITY_ID, mode: 'road' } }, context()).code, 'departed')
    finish(state)
    assert.deepEqual([state.estate.city, state.location, state.cash, state.estate.lga], [FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square', cashBeforeTravel - 10, null])
    assert.equal(viewLife(state, context()).estate.placed, false, 'a first arrival is a public visitor without a home')
    assert.deepEqual(state.skills, skillsBeforeTravel)
    assert.deepEqual(state.social.rel, peopleBeforeTravel)
    assert.equal(state.career.city, FICTIONAL_CITY_ID)
    state = createLife(structuredClone(state), { ...context(), trustedSave: true })
    assert.deepEqual([state.estate.city, state.location, state.estate.lga, viewLife(state, context()).estate.placed], [FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square', null, false], 'reload preserves the explicit visitor state')
    const homeRefusal = dispatch(state, { type: 'travel', payload: { id: 'home', mode: 'trek' } }, context())
    assert.equal(homeRefusal.code, 'settle_required')
    assert.match(homeRefusal.reason ?? '', /choose.*local government/i)
    const localJob = viewLife(state, context()).career.jobs.find((job) => job.id === 'community-helper')
    assert.ok(localJob)
    assert.equal(localJob.current, false)
    assert.equal(localJob.blocked, null, 'the local equivalent is offered')
    assert.equal(localJob.venue, 'test-square')

    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'work' } }, context()).code, 'selected')
    const beforeForeignShift = state.cash
    const foreignShift = dispatch(state, { type: 'activity', payload: { id: 'test-help-shift' } }, context())
    assert.equal(foreignShift.code, 'no_job')
    assert.match(foreignShift.reason ?? '', /job is in another city/i)
    assert.equal(state.cash, beforeForeignShift)
    assert.equal(dispatch(state, { type: 'career.switch', payload: { id: 'community-helper' } }, context()).code, 'switched')
    assert.deepEqual([state.job, state.career.city, state.estate.lga], ['community-helper', FICTIONAL_NEIGHBOUR_CITY_ID, null])
    now += 14401 * 1000
    assert.equal(advanceLife(state, 14401, context()).ok, true)
    const beforeVisitorShift = state.cash
    assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-help-shift' } }, context()).code, 'started')
    finish(state)
    assert.equal(state.cash, beforeVisitorShift + 100, 'a visitor may work at the local equivalent without a home')
    assert.equal(state.estate.lga, null)

    assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'test-neighbour-central', via: 'manual' } }, context()).code, 'lga_set')
    assert.deepEqual([state.estate.lga, state.estate.lgaConfirmed, viewLife(state, context()).estate.placed], ['test-neighbour-central', true, true])
    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'home', mode: 'trek' } }, context()).code, 'started')
    finish(state)
    assert.equal(state.location, 'home')
    const neighbourHome = { lga: state.estate.lga, tier: state.estate.tier, style: structuredClone(state.estate.style), living: state.estate.living }
    const skillsBeforeReturn = structuredClone(state.skills)
    const cashBeforeReturn = state.cash

    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: FICTIONAL_CITY_ID, mode: 'road' } }, context()).code, 'departed')
    finish(state)
    assert.deepEqual([state.estate.city, state.location, state.cash], [FICTIONAL_CITY_ID, 'home', cashBeforeReturn - 10])
    assert.deepEqual(state.skills, skillsBeforeReturn)
    assert.deepEqual(state.social.rel, peopleBeforeTravel)
    assert.deepEqual(
      { lga: state.estate.lga, lgaConfirmed: state.estate.lgaConfirmed, tier: state.estate.tier, style: state.estate.style, living: state.estate.living, ground: state.estate.ground },
      homeBeforeTravel,
    )
    assert.deepEqual(
      { lga: state.estate.away[FICTIONAL_NEIGHBOUR_CITY_ID]?.lga, tier: state.estate.away[FICTIONAL_NEIGHBOUR_CITY_ID]?.tier, style: state.estate.away[FICTIONAL_NEIGHBOUR_CITY_ID]?.style, living: state.estate.away[FICTIONAL_NEIGHBOUR_CITY_ID]?.living },
      neighbourHome,
    )
    assert.equal(state.property.house, 'test-centre-flat')
    assert.equal(JSON.stringify(state).includes('yaba'), false, 'no Lagos rental id leaks into the fictional journey')
  } finally {
    for (const registration of registrations.reverse()) registration.dispose()
  }
})
