import test from 'node:test'
import assert from 'node:assert/strict'
import { createClient, STORAGE_KEY, type FetchLike } from '../src/client.ts'
import { fixture } from './test-fixture.ts'

test('a reloaded client retains its quarantined identity and can report without resetting its wallet', async t => {
  const f = await fixture(t), actor = await f.device('Wallet Recovery')
  const life = await (await f.request('/api/life?city=lagos', undefined, actor.cookie)).json()
  const memory = new Map([[STORAGE_KEY, JSON.stringify({ version: 1, state: life.state, identity: { name: actor.name }, cityId: 'lagos' })]])
  await f.server.store.transact(db => {
    const key = db.$store?.sessionKeyByPublicId(actor.id); assert.ok(key)
    const record = db.sessions[key]; assert.ok(record?.cities.lagos)
    record.cities.lagos.state.cash = -1
  })
  const storedLife = () => f.server.store.read(db => {
    const key = db.$store?.sessionKeyByPublicId(actor.id); assert.ok(key)
    return JSON.stringify(db.sessions[key]?.cities.lagos)
  })
  const before = await storedLife(), requests: string[] = []
  const fetch: FetchLike = async (path, options) => {
    requests.push(`${options.method ?? 'GET'} ${path}`)
    return f.request(path, typeof options.body === 'string' ? JSON.parse(options.body) : undefined, actor.cookie)
  }
  const client = createClient({ fetch, now: () => f.now(), setTimeout: () => 0, clearTimeout: () => {},
    storage: { getItem: key => memory.get(key), setItem: (key, value) => { memory.set(key, value) } } })
  assert.equal(await client.connect(), false)
  assert.equal(client.link, 'recovery')
  assert.equal(client.snapshotPhase, 'unavailable')
  assert.equal(client.online, false)
  assert.equal(client.session?.id, actor.id)
  assert.equal((await client.command('cancel')).code, 'offline')
  const report = await client.fetchJson<{ ok: boolean; receipt: { id: string } }>('/api/support/reports', {
    method: 'POST', body: { cityId: 'lagos', category: 'money', text: 'Please review my wallet.', clientId: f.id() },
  })
  assert.equal(report.ok, true)
  assert.ok(report.receipt.id)
  assert.equal(await storedLife(), before)
  assert.equal(requests.includes('POST /api/session'), false, 'recovery never creates a replacement life')
  assert.equal(requests.includes('POST /api/action'), false, 'gameplay stays read-only')
})
