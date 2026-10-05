import { spawnSync } from 'node:child_process'
import { loadCityContent as preloadCityContent } from './registry.ts';
await preloadCityContent('lagos');
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { cachedCityContent, loadCityContent, registerCityForTest } from './registry.ts'
import { JOBS } from '../content/jobs.ts'
import {
  FICTIONAL_CITY_ID,
  FICTIONAL_NEIGHBOUR_CITY_ID,
  fictionalCity,
  fictionalNeighbourCity,
} from './testing/fictionalCity.test-fixture.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

test('an NPC friend survives a cold reload in another city without loading the origin content', async () => {
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (cityId: string): LifeContextInit => ({ now, cityId, seed: `cold-friend-${now}` })
  const finish = (state: LifeState): void => {
    const seconds = state.activeAction?.remaining
    if (typeof seconds !== 'number') assert.fail('a timed action is running')
    now += (seconds + 1) * 1000
    assert.equal(advanceLife(state, seconds + 1, context(state.estate.city)).ok, true)
  }

  let registrations = [registerCityForTest(fictionalCity), registerCityForTest(fictionalNeighbourCity)]
  await Promise.all([loadCityContent(FICTIONAL_CITY_ID), loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)])
  let state = createLife({ location: 'test-square', social: { rel: { 'test-fictional-one': { p: 18, npc: true } } } }, context(FICTIONAL_CITY_ID))
  assert.equal(dispatch(state, { type: 'spot', payload: { id: 'people' } }, context(FICTIONAL_CITY_ID)).code, 'selected')
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'npc-test-fictional-one-hello' } }, context(FICTIONAL_CITY_ID)).code, 'started')
  finish(state)
  assert.equal(state.social.rel['test-fictional-one']?.p, 20)
  assert.deepEqual(state.social.rel['test-fictional-one']?.npcSnapshot, { city: FICTIONAL_CITY_ID, name: 'One', emoji: 'person', role: 'Neighbour' })
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'tech' } }, context(FICTIONAL_CITY_ID)).code, 'applied')
  Object.assign(state.career, { level: 3, performance: 77, shifts: 5, oriented: true })
  state.completedShifts = 7
  assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: FICTIONAL_NEIGHBOUR_CITY_ID, mode: 'road' } }, context(FICTIONAL_CITY_ID)).code, 'departed')
  finish(state)
  const savedInNeighbour = structuredClone(state)
  const expected = {
    cash: savedInNeighbour.cash,
    needs: structuredClone(savedInNeighbour.needs),
    skills: structuredClone(savedInNeighbour.skills),
    friend: structuredClone(savedInNeighbour.social.rel['test-fictional-one']),
    awayHome: structuredClone(savedInNeighbour.estate.away[FICTIONAL_CITY_ID]),
    job: savedInNeighbour.job,
    completedShifts: savedInNeighbour.completedShifts,
    career: structuredClone(savedInNeighbour.career),
  }

  for (const registration of registrations.reverse()) registration.dispose()
  assert.equal(cachedCityContent(FICTIONAL_CITY_ID), null)
  registrations = [registerCityForTest(fictionalCity), registerCityForTest(fictionalNeighbourCity)]
  try {
    await loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)
    assert.equal(cachedCityContent(FICTIONAL_CITY_ID), null)
    state = createLife(savedInNeighbour, { ...context(FICTIONAL_NEIGHBOUR_CITY_ID), trustedSave: true })
    const relationship = viewLife(state, context(FICTIONAL_NEIGHBOUR_CITY_ID)).social.relationships.find((entry) => entry.id === 'test-fictional-one')
    assert.deepEqual(relationship && { name: relationship.name, emoji: relationship.emoji, role: relationship.role, points: relationship.points, friend: relationship.friend },
      { name: 'One', emoji: 'person', role: 'Neighbour', points: 20, friend: true })
    assert.deepEqual(state.social.rel['test-fictional-one']?.npcSnapshot, { city: FICTIONAL_CITY_ID, name: 'One', emoji: 'person', role: 'Neighbour' })
    assert.deepEqual({
      cash: state.cash,
      needs: state.needs,
      skills: state.skills,
      friend: state.social.rel['test-fictional-one'],
      awayHome: state.estate.away[FICTIONAL_CITY_ID],
      job: state.job,
      completedShifts: state.completedShifts,
      career: state.career,
    }, expected)
    const career = viewLife(state, context(FICTIONAL_NEIGHBOUR_CITY_ID)).career
    assert.deepEqual({ id: career.id, label: career.label, level: career.level, performance: career.performance, shifts: career.shifts, pay: career.pay, weeklyPay: career.weeklyPay, schedule: career.schedule, workplace: career.workplace, hours: career.hours, shift: career.shift, today: career.today.code },
      { id: 'tech', label: JOBS.tech.label, level: 3, performance: 77, shifts: 5, pay: 0, weeklyPay: 0, schedule: null, workplace: null, hours: null, shift: null, today: 'no_job' })
    assert.equal(cachedCityContent(FICTIONAL_CITY_ID), null, 'viewing the friend does not load the origin city')
  } finally {
    for (const registration of registrations.reverse()) registration.dispose()
  }
})

test('NPC snapshots are bounded, registered, and subordinate to loaded authoritative content', async () => {
  let registrations = [registerCityForTest(fictionalCity), registerCityForTest(fictionalNeighbourCity)]
  try {
    await Promise.all([loadCityContent(FICTIONAL_CITY_ID), loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)])
    const invented = createLife({ social: { rel: {
      'test-fictional-ghost': { p: 20, npc: true, npcSnapshot: { city: FICTIONAL_CITY_ID, name: 'Ghost', emoji: 'x', role: 'Invented' } },
    } } }, { cityId: FICTIONAL_NEIGHBOUR_CITY_ID })
    assert.deepEqual(invented.social.rel, {}, 'loaded origin content rejects an invented NPC id')
    await loadCityContent('ibadan')
    const compatibilityGhost = createLife({ social: { rel: {
      'ibadan-ghost': { p: 20, npc: true, npcSnapshot: { city: 'ibadan', name: 'Ghost', emoji: 'x', role: 'Invented' } },
    } } }, { cityId: FICTIONAL_NEIGHBOUR_CITY_ID })
    assert.deepEqual(compatibilityGhost.social.rel, {}, 'loaded closed-city compatibility content is also authoritative')
  } finally {
    for (const registration of registrations.reverse()) registration.dispose()
  }

  registrations = [registerCityForTest(fictionalCity), registerCityForTest(fictionalNeighbourCity)]
  try {
    await loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)
    const cold = createLife({ social: { rel: {
      'test-fictional-one': { p: 20, d: 4, n: 3, npc: true, at: 9, npcSnapshot: { city: FICTIONAL_CITY_ID, name: 'N'.repeat(100), emoji: 'E'.repeat(100), role: 'R'.repeat(100) } },
      'test-fictional-two': { p: 20, npc: true, npcSnapshot: { city: 'not-a-city', name: 'Two', emoji: 'x', role: 'Neighbour' } },
      'test-fictional-empty': { p: 20, npc: true, npcSnapshot: { city: FICTIONAL_CITY_ID, name: '', emoji: 'x', role: 'Neighbour' } },
    } } }, { cityId: FICTIONAL_NEIGHBOUR_CITY_ID })
    const kept = cold.social.rel['test-fictional-one']
    assert.deepEqual([kept?.p, kept?.d, kept?.n, kept?.at], [20, 4, 3, 9])
    assert.deepEqual([kept?.npcSnapshot?.name.length, kept?.npcSnapshot?.emoji.length, kept?.npcSnapshot?.role.length], [24, 12, 48])
    assert.equal(cold.social.rel['test-fictional-two'], undefined)
    assert.equal(cold.social.rel['test-fictional-empty'], undefined)
  } finally {
    for (const registration of registrations.reverse()) registration.dispose()
  }
})

test('legacy Lagos NPC relationships keep their original saved shape', () => {
  const state = createLife({ social: { rel: { kunle: { p: 20, d: 4, n: 2, npc: true, at: 9 } } } }, { cityId: 'lagos' })
  assert.deepEqual(state.social.rel.kunle, { p: 20, d: 4, n: 2, npc: true, at: 9 })
  assert.equal(Object.hasOwn(state.social.rel.kunle ?? {}, 'npcSnapshot'), false)
  assert.deepEqual(createLife(structuredClone(state), { cityId: 'lagos' }).social, state.social)
})


test('a Lagos NPC friend survives a journey and a destination-only cold reload', async () => {
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')])
  const now = Date.UTC(2026, 0, 5, 9)
  const state = createLife({ cash: 100000, job: 'tech', completedShifts: 7, career: { city: 'lagos', level: 3, performance: 77, shifts: 5, oriented: true }, social: { rel: { kunle: { p: 20, d: 4, n: 2, npc: true, at: 9 } } } }, { cityId: 'lagos', now })
  assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' } }, { now }).code, 'departed')
  const seconds = state.activeAction?.remaining
  assert.ok(typeof seconds === 'number')
  assert.equal(advanceLife(state, seconds + 1, { now: now + (seconds + 1) * 1000 }).ok, true)
  assert.equal(state.estate.city, 'ibadan')
  assert.equal(state.social.rel.kunle?.npcSnapshot?.city, 'lagos')
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { loadCityContent, cachedCityContent } from './src/game/cities/registry.ts';
    import { createLife, viewLife } from './src/life.ts';
    await loadCityContent('ibadan');
    const state = createLife(JSON.parse(readFileSync(0, 'utf8')), { cityId: 'ibadan', trustedSave: true });
    console.log(JSON.stringify({ cold: cachedCityContent('lagos') === null, friend: state.social.rel.kunle,
      job: state.job, career: state.career, careerView: viewLife(state).career,
      card: viewLife(state).social.relationships.find(item => item.id === 'kunle') }));
  `], { input: JSON.stringify(state), encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout)
  assert.equal(result.cold, true)
  assert.deepEqual(result.friend, state.social.rel.kunle)
  assert.equal(result.card.name, 'Kunle')
  assert.equal(result.card.points, 20)
  assert.equal(result.card.friend, true)
  assert.equal(result.job, 'tech')
  assert.deepEqual(result.career, state.career)
  assert.equal(result.career.level, 3)
  assert.equal(result.career.performance, 77)
  assert.equal(result.career.shifts, 5)
  assert.equal(result.careerView.workplace, null)
  assert.equal(result.careerView.pay, 0)
})
