import assert from 'node:assert/strict'
import test from 'node:test'
import { LOTTERY } from '../../content/traits.ts'
import { dreamFor, lotteryBulletsFor } from '../characterContent.ts'
import { loadCityContent } from '../registry.ts'

const cities = ['abeokuta', 'ota', 'ijebu-ode', 'sagamu'] as const
await Promise.all(cities.map(city => loadCityContent(city)))

test('Ogun startup dreams and family cards use local guidance without changing thresholds or benefits', () => {
  for (const city of cities) {
    const dream = dreamFor(city, 'yaba-unicorn')
    assert.match(dream.goal, /Covenant|FUNAAB|Creative|Federal University|University/)
    assert.match(dream.measure, /level 8 is 60%.*level 5 is 20%.*visit is 5%.*15%/)
    assert.doesNotMatch(`${dream.label} ${dream.goal} ${dream.measure}`, /Yaba|CcHub|Lagos/)
    assert.doesNotMatch(dreamFor(city, 'lekki-landlord').label, /Lekki/)
    for (const outcome of Object.values(LOTTERY)) {
      const bullets = lotteryBulletsFor(city, outcome.id).join(' ')
      assert.doesNotMatch(bullets, /Mushin|Yaba|Lekki|three homes/)
      assert.match(bullets, /free starter house/)
    }
  }
})
