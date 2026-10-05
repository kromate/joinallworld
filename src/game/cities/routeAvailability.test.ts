import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { regionInfo } from '../../map3d/geo/info.ts'
import { allCityLinks, loadCityContent, registerCityForTest } from './registry.ts'
import { fictionalCity, fictionalNeighbourCity } from './testing/fictionalCity.test-fixture.ts'
import type { CityLink } from '../../types/content.ts'

function register(status?: CityLink['status'], seconds?: number) {
  const links = fictionalCity.rules.links.map(link => ({ ...link, ...(status ? { status } : {}), ...(seconds ? { seconds } : {}) }))
  const registrations = [fictionalCity, fictionalNeighbourCity].map(module => registerCityForTest({ ...module, rules: { ...module.rules, links } }))
  return () => registrations.reverse().forEach(registration => registration.dispose())
}

const now = Date.UTC(2026, 0, 5, 9)

test('coming routes refuse both directions before fare checks and cannot be opened by context or stale atlas views', async () => {
  const dispose = register('coming')
  try {
    await Promise.all([fictionalCity.id, fictionalNeighbourCity.id].map(loadCityContent))
    for (const [from, to] of [[fictionalCity.id, fictionalNeighbourCity.id], [fictionalNeighbourCity.id, fictionalCity.id]]) {
      assert.ok(from && to)
      const ctx = { cityId: from, now, openCities: [to] }
      const state = createLife(null, ctx)
      state.cash = 0
      const ledger = structuredClone(state.ledger)
      assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to, mode: 'road' } }, ctx).code, 'route_not_open')
      assert.equal(state.cash, 0)
      assert.deepEqual(state.ledger, ledger)
      assert.equal(state.activeAction, null)
      assert.match(viewLife(state, ctx).estate.links.find(link => link.to === to)?.blocked ?? '', /coming soon/)
      const route = regionInfo({ kind: 'state', id: 'test-state' }, { cityId: to, current: from, routes: [{ to, mode: 'road' }] }).routes[0]
      assert.equal(route?.live, false)
      assert.match(route?.why ?? '', /coming soon/)
    }
  } finally { dispose() }
})

test('paid departures survive a coming-only change; duration changes refund once', async () => {
  for (const changedDuration of [false, true]) {
    let dispose = register()
    try {
      await Promise.all([fictionalCity.id, fictionalNeighbourCity.id].map(loadCityContent))
      const ctx = { cityId: fictionalCity.id, now }
      let state = createLife(null, ctx)
      state.cash = 1000
      const link = fictionalCity.rules.links[0]
      assert.ok(link)
      assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: fictionalNeighbourCity.id, mode: 'road' } }, ctx).code, 'departed')
      assert.equal(state.cash, 1000 - link.fare)
      const saved = structuredClone(state)
      dispose()
      dispose = register('coming', changedDuration ? link.seconds + 1 : undefined)
      await Promise.all([fictionalCity.id, fictionalNeighbourCity.id].map(loadCityContent))
      state = createLife(saved, { ...ctx, trustedSave: true })
      if (changedDuration) {
        assert.equal(state.activeAction, null)
        assert.equal(state.cash, 1000)
        state = createLife(structuredClone(state), { ...ctx, trustedSave: true })
        assert.equal(state.cash, 1000, 'invalidated fare is refunded only once')
        assert.equal(state.estate.city, fictionalCity.id)
      } else {
        assert.equal(state.activeAction?.kind, 'intercity')
        advanceLife(state, link.seconds + 1, { ...ctx, now: now + (link.seconds + 1) * 1000 })
        assert.equal(state.estate.city, fictionalNeighbourCity.id)
        assert.equal(state.cash, 1000 - link.fare)
        assert.equal(state.activeAction, null)
      }
    } finally { dispose() }
  }
})

test('canonical links treat omitted status as open but reject an authored availability conflict', () => {
  const first = registerCityForTest(fictionalCity)
  const second = registerCityForTest({ ...fictionalNeighbourCity, rules: { ...fictionalNeighbourCity.rules, links: fictionalNeighbourCity.rules.links.map(link => ({ ...link, status: 'open' })) } })
  try { assert.doesNotThrow(() => allCityLinks()) } finally { second.dispose(); first.dispose() }
  const original = registerCityForTest(fictionalCity)
  const conflict = registerCityForTest({ ...fictionalNeighbourCity, rules: { ...fictionalNeighbourCity.rules, links: fictionalNeighbourCity.rules.links.map(link => ({ ...link, status: 'coming' })) } })
  try { assert.throws(() => allCityLinks(), /Conflicting fixtures city link/) } finally { conflict.dispose(); original.dispose() }
})
