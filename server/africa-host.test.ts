import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from './server.ts'
import type { AllworldServer } from './server.ts'
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts'
import { africaJourney } from './testing/africaJourney.ts'
import type { AfricaJourneyHost } from './testing/africaJourney.ts'
import type { JourneyDevice } from './testing/cityJourney.ts'
import { object } from './testing/cityJourney.ts'
import { createServerTelemetry } from './telemetry/index.ts'

const PROJECT = 'allworld-africa-journey-test'
const FOUNDER = 'africa-founder@example.test'
const HASH = createHash('sha256').update(FOUNDER).digest('hex')
const ENV = {
  ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
  ACCOUNTS_FIREBASE_API_KEY: 'africa-test-api-key-000000000000000000000000',
  FOUNDER_EMAIL_SHA256: HASH,
  NEW_SESSIONS_PER_ADDRESS: '1000',
}

test('Node HTTP host: all five African capital flight journeys preserve a Lagos home across restart', { timeout: 60000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'africa-capitals-node-'))
  let time = Date.now()
  let server: AllworldServer | undefined
  let base = ''
  t.after(async () => { try { await stop() } finally { await rm(folder, { recursive: true, force: true }) } })
  const key = await makeKey('africa-node-founder')
  const provider = fakeProvider([key])
  async function start(): Promise<void> {
    server = await createServer({ dataDir: folder, now: () => time, env: ENV, telemetry: createServerTelemetry({ env: {}, now: () => time }), fetch: (url, init) => provider.fetch(url, init) })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    base = `http://127.0.0.1:${address.port}`
  }
  async function stop(): Promise<void> {
    const current = server
    if (!current) return
    for (const socket of current.wss.clients) socket.terminate()
    current.closeAllConnections()
    if (current.listening) await new Promise<void>((resolve, reject) => { current.close(error => error ? reject(error) : resolve()) })
    await current.store.close?.()
  }
  await start()
  const request = (path: string, body?: object, cookie?: string): Promise<Response> => fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: base, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const founderSession = await request('/api/session', { name: 'Fixture founder' })
  assert.equal(founderSession.status, 200)
  const guestCookie = founderSession.headers.get('set-cookie')?.split(';')[0]
  assert.ok(guestCookie)
  assert.equal((await request('/api/life?city=lagos', undefined, guestCookie)).status, 200)
  const accountState = object(await (await request('/api/account', undefined, guestCookie)).json())
  assert.equal(typeof accountState.csrf, 'string')
  const token = await signToken(key, claimsFor(PROJECT, time, { subject: 'AfricaFixtureFounder', email: FOUNDER, n: 1 }))
  const signedIn = await request('/api/account/sign-in', { csrf: accountState.csrf, idToken: token }, guestCookie)
  assert.equal(signedIn.status, 200)
  const founderCookie = signedIn.headers.get('set-cookie')?.split(';')[0]
  assert.ok(founderCookie)
  const founderMe = object(await (await request('/api/admin/me', undefined, founderCookie)).json())
  assert.equal(founderMe.level, 'root', 'fixture funding is authorized through the existing founder boundary')

  const host: AfricaJourneyHost = {
    now: () => time,
    request,
    elapse: async (_device: JourneyDevice, _city: string, ms: number) => { time += ms },
    restart: async () => { await stop(); await start() },
    credit: async (device, amount, reason) => {
      const intent = { clientId: `${time}:${randomUUID()}`, action: 'credit', amount, reason }
      const response = await request(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      const answer = object(await response.json())
      assert.equal(response.status, 200, JSON.stringify(answer))
      assert.equal(answer.code, 'credited', JSON.stringify(answer))
      const repeated = await request(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      assert.equal(repeated.status, 200)
      const replay = object(await repeated.json())
      assert.equal(replay.duplicate, true, 'fixture funding reuses its original admin receipt')
      assert.equal(replay.after, answer.after)
    },
  }
  await africaJourney(host)
})
