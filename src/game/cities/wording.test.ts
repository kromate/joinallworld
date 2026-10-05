import assert from 'node:assert/strict'
import test from 'node:test'
import '../../life.ts'
import { findActivity, spotsOf } from '../systems/activities.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { fictionalCity, fictionalContent } from './testing/fictionalCity.test-fixture.ts'

test('wording overrides apply after career and NPC activities without changing shared mechanics', async () => {
  const content = { ...fictionalContent, venues: fictionalContent.venues.map(venue => venue.id === 'test-square' ? {
    ...venue, spotWording: { work: { label: 'Helping desk', caption: 'Local shifts' }, people: { label: 'Neighbours' } },
    activityWording: { 'test-help-shift': 'Help at the local desk', 'npc-test-fictional-one-hello': 'Greet One locally' },
  } : venue) }
  const registration = registerCityForTest({ ...fictionalCity, loadContent: async () => content })
  try {
    await loadCityContent(fictionalCity.id)
    const work = findActivity('test-help-shift', fictionalCity.id)?.def
    const original = fictionalContent.workplaces.find(item => item.careerId === 'community-helper')?.definition.shift
    assert.ok(work && original)
    assert.deepEqual({ ...work, label: original.label, where: undefined }, { ...original, requiresJob: 'community-helper', where: undefined })
    assert.equal(work.where?.venue, 'test-square')
    assert.equal(work.where?.spot, 'work')
    assert.equal(work.label, 'Help at the local desk')
    assert.equal(findActivity('npc-test-fictional-one-hello', fictionalCity.id)?.def.label, 'Greet One locally')
    const spots = spotsOf('test-square', fictionalCity.id)
    assert.equal(spots.find(spot => spot.id === 'work')?.caption, 'Local shifts')
    assert.equal(spots.find(spot => spot.id === 'people')?.label, 'Neighbours')
    assert.notEqual(original.label, work.label)
    assert.equal(findActivity('stage-play', 'lagos')?.def.label, 'Watch a Stage Play')
  } finally { registration.dispose() }
})

test('social guidance names a local meeting place instead of a Lagos venue', async () => {
  const { createLife, viewLife } = await import('../../life.ts')
  const { STARTER_GOALS } = await import('../content/goals.ts')
  const hello = STARTER_GOALS.find(goal => goal.id === 'say-hello')
  assert.ok(hello)
  const registration = registerCityForTest({ ...fictionalCity, loadContent: async () => ({ ...fictionalContent, starterGoals: [hello] }) })
  try {
    await loadCityContent(fictionalCity.id)
    const state = createLife({ location: 'home' }, { cityId: fictionalCity.id })
    state.onboarding.done = true
    state.goals.started = true
    state.goals.chain = 0
    const chip = viewLife(state).goals.chip
    assert.equal(chip.kind, 'goal')
    assert.match(chip.hint, /Test Square/)
    assert.equal('params' in chip && chip.params?.destination, 'test-square')
  } finally { registration.dispose() }
})
