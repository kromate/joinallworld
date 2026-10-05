import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../../life.ts'
import { DEFAULT_LOOK } from '../../content/traits.ts'
import { cachedCityContent, loadCityContent } from '../registry.ts'
import type { LifeContextInit, LifeState } from '../../../types/life.ts'

const NOW = Date.UTC(2026, 0, 5, 9)
const context = (cityId: string, now = NOW, trustedSave = true): LifeContextInit => ({ cityId, now, seed: 'stored-data', trustedSave })
const reload = (state: unknown, cityId: string, now = NOW, trustedSave = true): LifeState => createLife(JSON.parse(JSON.stringify(state)), context(cityId, now, trustedSave))

/** A venue id and an activity id with a cooldown in a loaded city, other than the shared `home`. */
function localPlaces(cityId: string): { venues: string[]; cooled: { id: string; seconds: number }[] } {
  const content = cachedCityContent(cityId)
  assert.ok(content, cityId)
  const cooled = [...content.venues.flatMap(venue => Object.values(venue.definition.spots).flatMap(spot => spot.activities ?? [])), ...content.workplaces.map(item => item.definition.shift)]
    .flatMap(activity => activity.cooldown ? [{ id: activity.id, seconds: activity.cooldown }] : [])
  return { venues: content.venues.map(venue => venue.id).filter(id => id !== 'home'), cooled }
}
const guest = (cityId: string, now = NOW): LifeState => createLife(null, { ...context(cityId, now), isNew: true, quickStart: true })
/** A guest who has finished the opening steps, so the character can travel. */
function settled(cityId: string, unit: string): LifeState {
  const state = guest(cityId)
  const ctx = context(cityId)
  assert.equal(dispatch(state, { type: 'onboarding.quick-start', payload: { look: DEFAULT_LOOK } }, ctx).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.traits', payload: { traits: ['clean-pikin', 'musical'] } }, ctx).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } }, ctx).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.lottery', payload: {} }, ctx).ok, true)
  assert.equal(dispatch(state, { type: 'onboarding.home', payload: { lga: unit, via: 'manual' } }, ctx).ok, true)
  return state
}

test('a stored reference to a city whose content is not loaded is kept, bounded, and re-checked when the city loads', async () => {
  await loadCityContent('lagos')
  assert.equal(cachedCityContent('ota'), null)
  const state = guest('lagos')
  const lagos = localPlaces('lagos')
  const cooled = lagos.cooled[0]
  assert.ok(cooled)
  const saved = JSON.parse(JSON.stringify(state)) as LifeState
  saved.travel.visited = ['ota:real-place-unknown-yet', 'ota:made-up']
  saved.travel.cooldowns = { 'ota:forever': Number.MAX_SAFE_INTEGER - 1, 'ota:short': NOW + 60_000, [cooled.id]: NOW + cooled.seconds * 1000 }
  const cold = reload(saved, 'lagos')
  assert.deepEqual(cold.travel.visited, ['ota:real-place-unknown-yet', 'ota:made-up'], 'cold history is bounded saved history')
  assert.equal(cold.travel.cooldowns['ota:short'], NOW + 60_000)
  assert.equal(cold.travel.cooldowns['ota:forever'], NOW + 86_400_000, 'a cold timer cannot run longer than the longest authored cooldown')
  assert.equal(cold.travel.cooldowns[cooled.id], NOW + cooled.seconds * 1000, 'the Lagos timer is untouched')

  await loadCityContent('ota')
  const ota = localPlaces('ota')
  const warm = reload({ ...saved, travel: { ...saved.travel, visited: [`ota:${ota.venues[0]}`, 'ota:made-up'], cooldowns: { [`ota:${ota.cooled[0]?.id ?? 'none'}`]: NOW + 5_000_000_000, 'ota:made-up': NOW + 1000 } } }, 'lagos')
  assert.deepEqual(warm.travel.visited, [`ota:${ota.venues[0]}`], 'a loaded city refuses a place it does not have')
  for (const [key, readyAt] of Object.entries(warm.travel.cooldowns)) {
    const seconds = ota.cooled.find(item => `ota:${item.id}` === key)?.seconds
    assert.ok(seconds && readyAt <= NOW + seconds * 1000, `${key} never exceeds the activity's own cooldown`)
  }
})

test('a life saved by the previous build loads: Lagos keeps bare keys, Ibadan ids become city-qualified, nothing is dropped', async () => {
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')])
  const lagos = localPlaces('lagos'), ibadan = localPlaces('ibadan')
  const lagosVisited = lagos.venues.slice(0, 5), ibadanVisited = ibadan.venues.slice(0, 5)
  const lagosCool = lagos.cooled[0], ibadanCool = ibadan.cooled[0]
  assert.ok(lagosCool && ibadanCool)
  assert.deepEqual(lagosVisited.filter(id => ibadanVisited.includes(id)), [], 'the two catalogues use different place ids')
  assert.ok(!lagos.cooled.some(item => item.id === ibadanCool.id) && !ibadan.cooled.some(item => item.id === lagosCool.id))

  // A Lagos life from before: bare ids only.
  const old = JSON.parse(JSON.stringify(guest('lagos'))) as LifeState
  old.travel.visited = lagosVisited
  old.travel.cooldowns = { [lagosCool.id]: NOW + lagosCool.seconds * 1000 }
  old.travel.trips = 7
  for (const trusted of [true, false]) {
    const loaded = reload(old, 'lagos', NOW, trusted)
    assert.deepEqual(loaded.travel.visited, lagosVisited, 'Lagos visited keys stay bare and in order')
    assert.deepEqual(loaded.travel.cooldowns, old.travel.cooldowns, 'Lagos cooldown keys stay bare')
    assert.equal(loaded.travel.trips, 7)
    assert.deepEqual(reload(loaded, 'lagos', NOW, trusted), loaded, 'loading again changes nothing')
  }

  // An Ibadan life from before: the same shape, with Ibadan's own ids; a Lagos-style id may sit beside them.
  const oldIbadan = JSON.parse(JSON.stringify(guest('ibadan'))) as LifeState
  assert.equal(oldIbadan.estate.city, 'ibadan')
  oldIbadan.travel.visited = [...ibadanVisited, lagosVisited[0]!]
  oldIbadan.travel.cooldowns = { [ibadanCool.id]: NOW + ibadanCool.seconds * 1000 }
  for (const trusted of [true, false]) {
    const loaded = reload(oldIbadan, 'ibadan', NOW, trusted)
    assert.deepEqual(loaded.travel.visited, [...ibadanVisited.map(id => `ibadan:${id}`), lagosVisited[0]], 'Ibadan ids are qualified once; the Lagos id stays bare; none is dropped')
    assert.deepEqual(loaded.travel.cooldowns, { [`ibadan:${ibadanCool.id}`]: NOW + ibadanCool.seconds * 1000 })
    assert.deepEqual(reload(loaded, 'ibadan', NOW, trusted), loaded, 'a qualified life loads unchanged')
    assert.equal(viewLife(loaded, context('ibadan')).travel.visited, ibadanVisited.length, 'the visited count is the city\'s own')
    assert.ok((viewLife(loaded, context('ibadan')).travel.cooldowns[ibadanCool.id] ?? 0) > 0, 'the old cooldown still counts')
  }
})

test('a life saved after Ogun travel is read back whole, and a cooldown stays with the city that set it', async () => {
  await Promise.all(['lagos', 'ota'].map(loadCityContent))
  const lagos = localPlaces('lagos'), ota = localPlaces('ota')
  const cooled = lagos.cooled[0]
  assert.ok(cooled)
  let now = NOW
  const state = settled('lagos', 'ikeja')
  state.cash = 100_000
  state.travel.visited = lagos.venues.slice(0, 3)
  state.travel.cooldowns = { [cooled.id]: now + cooled.seconds * 1000 }
  const ctx = (): LifeContextInit => ({ cityId: state.estate.city, now, seed: `ogun-saved-${now}` })
  assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'ota', mode: 'road' } }, ctx()).code, 'departed')
  now += 61_000
  assert.equal(advanceLife(state, 61, ctx()).ok, true)
  assert.equal(state.estate.city, 'ota')
  assert.deepEqual(state.travel.visited.slice(0, 3), lagos.venues.slice(0, 3), 'the Lagos history keeps its bare keys in Ota')
  assert.ok(state.travel.visited.every(key => lagos.venues.includes(key) || key.startsWith('ota:')))
  assert.equal(state.travel.cooldowns[cooled.id], NOW + cooled.seconds * 1000, 'the Lagos cooldown is kept across the trip')
  assert.equal(viewLife(state, ctx()).travel.cooldowns[cooled.id], undefined, 'and is not shown in Ota')
  for (const trusted of [true, false]) {
    const loaded = reload(state, 'ota', now, trusted)
    assert.deepEqual(loaded.travel, state.travel, 'the saved travel record is read back as written')
    assert.deepEqual(loaded.estate, state.estate)
  }
  const target = ota.venues.find(id => id !== state.location)
  assert.ok(target)
  assert.equal(dispatch(state, { type: 'travel', payload: { id: target, mode: 'trek' } }, ctx()).code, 'started')
  now += ((state.activeAction?.remaining ?? 0) + 1) * 1000
  assert.equal(advanceLife(state, (state.activeAction?.remaining ?? 0) + 1, ctx()).ok, true)
  assert.ok(state.travel.visited.includes(`ota:${target}`), 'a place reached in Ota is stored as an Ota place')
  assert.deepEqual(reload(state, 'ota', now).travel, state.travel)
  // saved on the road: the trip and its fare are in the record and read as written
  state.estate.lga = null
  assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'road' } }, ctx()).code, 'departed')
  const onTheRoad = reload(state, 'ota', now)
  assert.deepEqual(onTheRoad.activeAction, state.activeAction)
  assert.equal(onTheRoad.cash, state.cash)
})

test('a hostile travel record is bounded and cleaned on load', async () => {
  await Promise.all(['lagos', 'ibadan', 'ota'].map(loadCityContent))
  const lagos = localPlaces('lagos'), cooled = lagos.cooled[0]
  assert.ok(cooled)
  const junk = Array.from({ length: 3000 }, (_, index) => index % 3 === 0 ? { index } : index % 3 === 1 ? `ota:${'x'.repeat(index % 400)}` : `zz:place-${index}`)
  const saved = JSON.parse(JSON.stringify(guest('lagos'))) as LifeState
  const manyCooldowns: Record<string, unknown> = { [cooled.id]: NOW + 99 * 86_400_000, [`lagos:${cooled.id}`]: NOW + 1000, 'ota:': NOW + 1, 'ota:UPPER': NOW + 1, 'nowhere:x': NOW + 1, [`${'a'.repeat(300)}`]: NOW + 1 }
  for (let index = 0; index < 5000; index += 1) manyCooldowns[`${index % 2 ? 'ota' : 'ibadan'}:junk-${index}`] = index % 4 === 0 ? 'soon' : index % 4 === 1 ? Number.POSITIVE_INFINITY : index % 4 === 2 ? -5 : NOW + 1000
  ;(saved.travel as unknown as Record<string, unknown>).visited = [...junk, ...lagos.venues.slice(0, 600), ...lagos.venues.slice(0, 2), 'ota:__proto__', '__proto__', 'constructor']
  ;(saved.travel as unknown as Record<string, unknown>).cooldowns = manyCooldowns
  for (const trusted of [true, false]) {
    const loaded = reload(saved, 'lagos', NOW, trusted)
    assert.ok(loaded.travel.visited.length <= 512, 'visited is bounded')
    assert.equal(new Set(loaded.travel.visited).size, loaded.travel.visited.length, 'visited has no duplicates')
    assert.ok(loaded.travel.visited.every(key => typeof key === 'string' && /^([a-z-]+:)?[a-z0-9][a-z0-9-]{0,159}$/.test(key)))
    assert.ok(Object.keys(loaded.travel.cooldowns).length <= 80, 'cooldowns are bounded')
    for (const [key, readyAt] of Object.entries(loaded.travel.cooldowns)) {
      assert.ok(Number.isFinite(readyAt) && readyAt > NOW && readyAt <= NOW + 86_400_000, `${key} is a real, near timer`)
      assert.ok(/^([a-z-]+:)?[a-z0-9][a-z0-9-]{0,159}$/.test(key))
    }
    assert.equal(loaded.travel.cooldowns[cooled.id], NOW + 1000, 'a Lagos bare key and its explicit form are one record')
    assert.equal(Object.getPrototypeOf(loaded.travel.cooldowns), Object.prototype)
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
    assert.deepEqual(reload(loaded, 'lagos', NOW, trusted), loaded, 'a cleaned record is stable')
  }
  const view = viewLife(reload(saved, 'lagos'), context('lagos'))
  assert.ok(view.travel.visited <= 512)
})

test('a bare stored key can only mean Lagos or Ibadan: their venue and activity ids never collide', async () => {
  await Promise.all(['lagos', 'ibadan'].map(loadCityContent))
  const ids = (cityId: string) => {
    const content = cachedCityContent(cityId)
    assert.ok(content)
    return { venues: new Set(content.venues.map(venue => venue.id).filter(id => id !== 'home')), activities: new Set(content.venues.flatMap(venue => Object.values(venue.definition.spots).flatMap(spot => (spot.activities ?? []).map(activity => activity.id)))) }
  }
  const lagos = ids('lagos'), ibadan = ids('ibadan')
  assert.deepEqual([...ibadan.venues].filter(id => lagos.venues.has(id)), [])
  assert.deepEqual([...ibadan.activities].filter(id => lagos.activities.has(id) && !['garri', 'bath', 'nap'].includes(id)).filter(id => !/^(hospital|health)/.test(id)), [])
})
