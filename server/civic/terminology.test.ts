import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, shallowRef } from 'vue'
import { LAYERS, layerLabel } from '../../src/app/features/travel/travelModel.ts'
import { createLife, dispatch } from '../../src/life.ts'
import { loadCityContent, registerCityForTest } from '../../src/game/cities/registry.ts'
import { fictionalCity, fictionalContent } from '../../src/game/cities/testing/fictionalCity.test-fixture.ts'
import { civicTitle, civicOffice } from '../../src/game/cities/terminology.ts'
import { fileCandidacy } from '../../src/game/systems/civic.ts'
import { ELECTION } from '../../src/game/content/civic.ts'
import { buildRegistry, definePanel } from '../../src/app/state/panels.ts'
import { cityOf, emptyCivic } from './data.ts'
import { announceBlock, declare, govView, notices, vote } from './elections.ts'

const DAY = 86400000, MONDAY = Date.UTC(2026, 0, 5, 9)
const council = { ...fictionalCity, rules: { ...fictionalCity.rules, civicTitle: 'Community Chair', unit: 'area council' }, loadContent: async () => ({ ...fictionalContent, civicExplanation: 'A fictional community role.' }) }

test('city-owned civic title changes public panels and fees while preserving Lagos and saved election keys', async () => {
  const registration = registerCityForTest(council)
  try {
    await Promise.all([loadCityContent(council.id), loadCityContent('lagos')])
    let current = createLife(null, { cityId: 'lagos', now: MONDAY })
    const selected = shallowRef(current)
    const panel = buildRegistry([definePanel({ id: 'governor', title: 'Chairman', titleFor: state => civicTitle(state.estate.city), placement: 'phone', component: {} }) ], () => selected.value)[0]!
    const heading = computed(() => panel.title)
    assert.equal(panel.title, 'Chairman')
    assert.equal(civicOffice('lagos'), 'State House')
    const areaLayer = LAYERS.find(layer => layer.id === 'lgas')!, officeLayer = LAYERS.find(layer => layer.id === 'gov')!
    assert.equal(layerLabel(areaLayer, 'lagos'), 'LGAs')
    assert.equal(layerLabel(officeLayer, 'lagos'), 'Chairman')
    assert.equal(layerLabel(areaLayer, council.id), 'Area councils')
    assert.equal(layerLabel(officeLayer, council.id), 'Community Chair')
    for (const cityId of [council.id, 'lagos']) {
      current = createLife({ cash: 10000 }, { cityId, now: MONDAY })
      selected.value = current
      assert.equal(heading.value, civicTitle(cityId), 'same registered panel follows a city change')
      const context = { cityId, now: MONDAY + 3 * DAY, rng: () => 0.5 }
      current.civic.work = { days: ELECTION.minWorkDays, last: 1 }
      const refused = dispatch(current, { type: 'civic.run', payload: {} }, context)
      assert.equal(refused.ok, false)
      if (refused.ok) throw new Error('Expected server-only refusal')
      assert.ok(refused.reason?.includes(`Phone → ${civicTitle(cityId)}`))
      assert.equal(current.cash, 10000)
      assert.equal(fileCandidacy(current, {}, context).code, 'declared')
      assert.equal(current.cash, 10000 - ELECTION.filingFee)
      assert.equal(current.ledger.at(-1)?.reason, cityId === 'lagos' ? 'Chairman filing fee' : 'Community Chair filing fee')
      const data = cityOf(emptyCivic(), cityId), person = { id: 'candidate', name: 'Ada' }
      declare(data, MONDAY, person, 'A shared garden')
      for (const voter of ['voter', 'voter2', 'voter3']) vote(data, MONDAY + 3 * DAY, voter, person.id)
      const sunday = MONDAY + 6 * DAY
      const view = govView(data, sunday)
      assert.equal(view.governor?.id, person.id, 'governor remains the saved/API key')
      const wording = civicTitle(cityId)
      assert.ok(notices(data, sunday, 'Test City', 0, wording).some(item => item.title.includes(`new ${wording}`)))
      assert.ok(announceBlock(data, sunday, 'other', wording)?.reason.includes(`sitting ${wording}`))
    }
  } finally { registration.dispose() }
})
