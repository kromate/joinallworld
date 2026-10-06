// OWNER: world — the location-confirmed badge on the Node host: the exactly-once action, who sees which badge, the daily limit,
// switching off, expiry, and that the Permissions-Policy lets the page ask for the location (and nobody else).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './test-fixture.ts'
import { residenceJourney } from './testing/residenceJourney.ts'
import { badgeOf } from './routes/residence.ts'
import { appHeaders } from './security-headers.ts'
import { driver } from './testing/cityJourney.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'

await loadCityContent('lagos')

test('Node: two players in Ikeja, a confirmation by one device, the badge seen by the other, the limit, switching off', { timeout: 60000 }, async (t) => {
  const f = await fixture(t)
  const result = await residenceJourney({ now: f.now, request: (path, body, cookie) => f.request(path, body, cookie), elapse: async (_d, _c, ms) => { f.advance(ms) } })
  assert.deepEqual(result.sent, { lga: 'ikeja', ok: true }, 'the whole payload a device sends')
  assert.equal(result.limitedAfter, 5)
})

test('a confirmation lapses after 90 days for other players too, with no one doing anything', { timeout: 60000 }, async (t) => {
  const DAY = 86400000
  const f = await fixture(t, { sessionTtlMs: 400 * DAY })
  const { start } = driver({ now: f.now, request: (path, body, cookie) => f.request(path, body, cookie), elapse: async () => {} })
  const open = (name: string) => start(name, 'lagos', 'ikeja')
  const ada = await open('Ada'), kunle = await open('Kunle')
  const confirmed = await f.action(ada.cookie, { type: 'estate.confirm-residence', payload: { lga: 'ikeja', ok: true } })
  assert.equal(confirmed.ok, true, `${confirmed.code} ${confirmed.error}`)
  const read = async () => ((await (await f.request('/api/world/badges', { ids: [ada.id] }, kunle.cookie)).json()) as { badges: Record<string, unknown> }).badges
  assert.deepEqual(await read(), { [ada.id]: { lga: 'ikeja', name: 'Ikeja' } })
  f.advance(89 * DAY)
  assert.ok(ada.id in await read(), 'day 89: still standing')
  f.advance(2 * DAY)
  assert.deepEqual(await read(), {}, 'day 91: gone, with no one having to do anything')
  assert.equal(badgeOf(undefined, f.now()), null)
})

test('the page may ask for the device location itself, and no embedded page may', () => {
  for (const headers of [appHeaders({ scriptHashes: [], secure: true, host: 'joinallworld.com' })]) {
    const features = String(headers['Permissions-Policy']).split(', ')
    assert.ok(features.includes('geolocation=(self)'), 'the page itself may ask')
    assert.ok(!features.some((feature) => /^geolocation=(\*|\(\*\)|\(.*https?:.*\))/.test(feature)), 'no other origin may')
    assert.ok(features.includes('camera=()') && features.includes('microphone=(self)'), 'the rest is as it was')
  }
})
