import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, dispatch, viewLife } from '../../life.ts'
import { DREAMS, LOTTERY, TRAITS } from '../content/traits.ts'
import { findActivity } from '../systems/activities.ts'
import { loadCityContent } from './registry.ts'
import { dreamFor, dreamsFor, lotteryBulletsFor } from './characterContent.ts'

await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')])

test('Lagos dream and family wording stays identical', () => {
  assert.deepEqual(dreamsFor('lagos'), Object.values(DREAMS))
  for (const outcome of Object.values(LOTTERY)) assert.deepEqual(lotteryBulletsFor('lagos', outcome.id), outcome.bullets)
})

test('Ibadan dream guidance points to the real local pitch while its identity and targets stay fixed', () => {
  const dream = dreamFor('ibadan', 'yaba-unicorn')
  assert.equal(dream.id, 'yaba-unicorn')
  assert.equal(dream.label, 'Ibadan Founder')
  assert.match(dream.goal, /Lead City University/)
  const pitch = findActivity('dream-startup-pitch', 'ibadan')
  assert.equal(pitch?.venue, 'lead-city')
  const state = createLife({ goals: { dream: 'yaba-unicorn' } }, { cityId: 'ibadan' })
  const view = viewLife(state)
  assert.equal(view.goals.dream?.label, dream.label)
  assert.equal(view.goals.dream?.goal, dream.goal)
  assert.equal(dreamFor('ibadan', 'lekki-landlord').goal, DREAMS['lekki-landlord'].goal)

  const fresh = createLife(null, { cityId: 'ibadan', isNew: true })
  Object.assign(fresh.onboarding, { stage: 'guest', required: false, step: 2, traits: Object.values(TRAITS).slice(0, 2).map(trait => trait.id) })
  assert.equal(dispatch(fresh, { type: 'onboarding.dream', payload: { dream: 'yaba-unicorn' } }).code, 'dream_saved')
  assert.equal(fresh.onboarding.dream, 'yaba-unicorn')
  assert.equal(fresh.message, 'Dream saved: Ibadan Founder.')
})

test('Ibadan family cards describe the free local house without changing family benefits', () => {
  for (const outcome of Object.values(LOTTERY)) {
    const state = createLife({ onboarding: { lottery: { id: outcome.id, at: 1 } } }, { cityId: 'ibadan' })
    const view = viewLife(state).onboarding
    assert.deepEqual(view.lottery?.bullets, lotteryBulletsFor('ibadan', outcome.id))
    assert.doesNotMatch(view.lottery?.bullets.join(' ') ?? '', /Mushin|Yaba|Lekki|three homes/)
    assert.match(view.lottery?.bullets.join(' ') ?? '', /any Ibadan local government.*free starter house/)
    assert.equal(view.own.startCash, outcome.ownCash)
  }
})
