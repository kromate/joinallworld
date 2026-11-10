// OWNER: start — the city offered to a first-time visitor from the device's time zone (./suggestCity.ts).
import test from 'node:test'
import assert from 'node:assert/strict'
import { isOpenCityId } from '../../../game/cities/registry.ts'
import { ZONE_CITY, cityOfZone, suggestCity, zoneSlug } from './suggestCity.ts'

test('a time zone names its own open city, or a large one of the same country; Nigeria and unknown zones get none', async () => {
  assert.equal(zoneSlug('America/Argentina/Buenos_Aires'), 'buenos-aires')
  assert.deepEqual(['America/Sao_Paulo', 'Europe/London', 'Asia/Jakarta', 'Asia/Calcutta', 'America/Los_Angeles', 'Africa/Johannesburg'].map(cityOfZone), ['sao-paulo', 'london', 'jakarta', 'delhi', 'new-york', 'cape-town'])
  assert.deepEqual(['Africa/Lagos', 'Etc/UTC', 'Antarctica/Troll', ''].map(cityOfZone), [null, null, null, null])
  for (const [zone, city] of Object.entries(ZONE_CITY)) assert.equal(isOpenCityId(city), true, `${zone} → ${city} is an open city`)
  assert.equal(await suggestCity('Africa/Lagos'), null)
  assert.equal(await suggestCity(undefined), null)
  const found = await suggestCity('Asia/Tokyo')
  assert.deepEqual(found, { kind: 'near', city: 'tokyo', name: 'Tokyo', place: null, line: 'Tokyo is open in Allworld — start there?' })
})
