import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, viewLife } from '../../../life.ts'
import { loadCityContent, loadCityRoutes } from '../registry.ts'
import { routeBand } from '../../systems/travel.ts'
import { adSlot } from '../../systems/civic.ts'

await loadCityContent('ibadan')
const context = { cityId: 'ibadan', now: Date.UTC(2026, 0, 5, 9) }

test('Ibadan travel uses geographic distance and its local modes without coastal advertising', () => {
  const life = createLife(null, context)
  assert.equal(routeBand(life, 'uch', 'agodi-gardens'), 'near')
  assert.equal(routeBand(life, 'ibadan-airport', 'moniya-station'), 'far')
  const modes = viewLife(life, context).travel.modes
  assert.deepEqual(modes.map(mode => mode.label), ['Trek', 'Okada', 'Bus', 'Micra taxi'])
  assert.equal(adSlot('sea', 'sea-0-0', 'ibadan'), null)
})

test('the lazy rail route follows source vertices between the two stations', async () => {
  const routes = await loadCityRoutes('ibadan')
  const rail = routes.find(route => route.mode === 'rail')
  assert.ok(rail)
  assert.equal(rail.a, 'lagos')
  assert.equal(rail.b, 'ibadan')
  assert.ok(rail.points.length > 50)
  const start = rail.points[0], end = rail.points.at(-1)
  assert.ok(start && end)
  assert.ok(Math.abs(start[0] - 3.3735939) < 0.002 && Math.abs(start[1] - 6.5016905) < 0.002)
  assert.ok(Math.abs(end[0] - 3.896621) < 0.002 && Math.abs(end[1] - 7.559368) < 0.002)
})

test('an owned-home quote does not borrow coordinates from the saved rental', () => {
  const life = createLife(null, context)
  life.estate.living = 'own'
  life.travel.home = 'ibadan-mokola-room'
  const fromMokola = routeBand(life, 'home', 'moniya-station')
  life.travel.home = 'ibadan-bodija-flat'
  assert.equal(routeBand(life, 'home', 'moniya-station'), fromMokola)
})
