// The creator's decisions without a DOM: the steps each kind of player sees, where they start, what blocks a step, and
// the server actions that settle a life (only what the server does not hold yet, in the order it needs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_LOOK } from '../../../game/content/traits.ts'
import { FOCUS_CHOICES, defaultSpirit, focusForField, focusForTab, nextLabel, previousStep, progressOf, pushHistory, settlePlan, startStep, stepBlocked, stepsFor } from './creatorModel.ts'
import { PLACES, cityOpen, firstOpen, groupLgas, stateOfCity, stateOpen } from './placesModel.ts'
import { loadCityContent } from '../../../game/cities/registry.ts'
await loadCityContent('lagos')

const look = { ...DEFAULT_LOOK }
const saved = { step: 1, look, traits: [] as never[], dream: null, lottery: null }

test('a new device sees five steps and starts on the first; a settling life has no "Who are you?"', () => {
  assert.deepEqual(stepsFor('new').map((step) => step.id), ['who', 'look', 'spirit', 'home', 'ready'])
  assert.deepEqual(stepsFor('settle').map((step) => step.id), ['look', 'spirit', 'home', 'ready'])
  assert.equal(startStep('new', saved), 'who')
  assert.equal(startStep('settle', saved), 'spirit')
  assert.equal(startStep('settle', { ...saved, step: 0 }), 'look')
  const steps = stepsFor('new')
  assert.deepEqual(progressOf(steps, 'look'), { index: 2, count: 5, label: 'Look', percent: 40 })
  assert.equal(nextLabel(steps, 'who'), 'Next: Look')
  assert.equal(nextLabel(steps, 'ready'), 'Start your life')
  assert.equal(previousStep(steps, 'who'), null)
})

test('what blocks a step, in words', () => {
  const facts = { nameProblem: null, area: undefined, traits: 2 }
  assert.equal(stepBlocked('who', { ...facts, nameProblem: 'Too short.' }), 'Too short.')
  assert.equal(stepBlocked('look', facts), '')
  assert.match(stepBlocked('spirit', { ...facts, traits: 1 }), /Choose 1 more trait/)
  assert.match(stepBlocked('home', facts), /Choose where you live/)
  assert.equal(stepBlocked('home', { ...facts, area: { lga: 'surulere', via: 'manual' } }), '')
})

test('the stage looks close at hair and faces, at the outfit for clothes; undo keeps a bounded history of real changes', () => {
  assert.deepEqual(FOCUS_CHOICES.map((item) => item.id), ['body', 'head', 'outfit'])
  assert.equal(focusForTab('hair'), 'head'); assert.equal(focusForTab('colours'), 'outfit'); assert.equal(focusForTab('extras'), 'body')
  assert.equal(focusForField('skin'), 'head'); assert.equal(focusForField('fabric'), 'outfit'); assert.equal(focusForField('body'), null)
  const other = { ...look, hair: 'afro' } as typeof look
  assert.deepEqual(pushHistory([], look, look), [])
  assert.equal(pushHistory([], look, other).length, 1)
  let history: typeof look[] = []
  for (let i = 0; i < 50; i++) history = pushHistory(history, i % 2 ? look : other, i % 2 ? other : look)
  assert.equal(history.length, 30)
})

test('a skipped spirit step still holds two different traits and a dream', () => {
  for (let i = 0; i < 20; i++) {
    const { traits, dream } = defaultSpirit(() => (i + 1) / 21)
    assert.equal(new Set(traits).size, 2)
    assert.ok(dream)
  }
})

test('the settle plan sends only what the server does not hold, in order, and the home last', () => {
  const draft = { look, traits: ['hustler', 'foodie'] as never[], dream: 'lekki-landlord' as never, area: { lga: 'surulere', via: 'device' as const } }
  const plan = settlePlan({ saved, draft })
  assert.deepEqual(plan?.map((action) => action.type), ['onboarding.traits', 'onboarding.dream', 'onboarding.lottery', 'onboarding.home'])
  assert.deepEqual(plan?.at(-1)?.payload, { lga: 'surulere', via: 'device' })
  assert.deepEqual(settlePlan({ saved: { ...saved, step: 0 }, draft: { ...draft, area: { lga: 'ikeja', via: 'manual' } }, stay: true })?.map((action) => action.type)[0], 'onboarding.look')
  assert.deepEqual(settlePlan({ saved, draft: { ...draft, area: { lga: 'ikeja', via: 'manual' } }, stay: true })?.at(-1)?.payload, { lga: 'ikeja', via: 'manual', stay: true })
  const changed = settlePlan({ saved, draft: { ...draft, look: { ...look, hair: 'afro' } as typeof look } })
  assert.equal(changed?.[0]?.type, 'onboarding.look')
  const held = { ...saved, traits: ['foodie', 'hustler'] as never[], dream: 'lekki-landlord' as never, lottery: { id: 'x', at: 1 } as never }
  assert.deepEqual(settlePlan({ saved: held, draft })?.map((action) => action.type), ['onboarding.home'])
  assert.equal(settlePlan({ saved, draft: { ...draft, area: undefined } }), null)
  assert.equal(settlePlan({ saved, draft: { ...draft, dream: null } }), null)
})

test('places are data: the open city is found, the others are coming and have no local governments to choose', () => {
  assert.equal(PLACES[0]?.id, 'nigeria')
  assert.deepEqual(firstOpen() && [firstOpen()?.state.id, firstOpen()?.city.id], ['lagos', 'lagos'])
  for (const id of ['lagos', 'ibadan']) assert.equal(cityOpen(id), true)
  for (const id of ['abuja', 'port-harcourt', 'abeokuta', 'kano']) assert.equal(cityOpen(id), false)
  // The list is read from the city registry: the planned cities come from there, grouped by their state.
  assert.deepEqual(PLACES[0]?.states.flatMap((state) => state.cities.map((city) => city.id)), ['lagos', 'ibadan', 'abuja', 'port-harcourt', 'abeokuta', 'kano'])
  assert.deepEqual(stateOfCity('ibadan'), { id: 'oyo', name: 'Oyo State', cities: [{ id: 'ibadan', name: 'Ibadan' }] })
  assert.deepEqual(PLACES[0]?.states.filter(stateOpen).map((state) => state.id), ['lagos', 'oyo'])
  assert.equal(stateOfCity('abuja')?.id, 'fct')
  const lgas = ['eti-osa', 'agege', 'badagry', 'epe'].map((id) => ({ id, name: id, line: '', land: 0, levy: 0 }))
  const groups = groupLgas('lagos', lgas as never)
  assert.deepEqual(groups.map((group) => group.zone), ['island', 'mainland', 'east'])
  assert.deepEqual(groups[1]?.items.map((item) => item.id), ['agege', 'badagry'])
  assert.deepEqual(groupLgas('lagos', lgas as never, 'EPE').flatMap((group) => group.items.map((item) => item.id)), ['epe'])
})
