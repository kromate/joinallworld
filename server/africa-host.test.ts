import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer } from './server.ts'
import { createStore } from './store.ts'
import { flakyDisk } from './test-fixture.ts'
import type { AllworldServer } from './server.ts'
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts'
import { africaJourney, homewardJourney } from './testing/africaJourney.ts'
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

test('Node HTTP host: all five capital trips and cashless homeward journeys preserve original homes across restart', { timeout: 60000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'africa-capitals-node-'))
  const disk = flakyDisk()
  let time = Date.now()
  let server: AllworldServer | undefined
  let base = ''
  t.after(async () => { try { await stop() } finally { await rm(folder, { recursive: true, force: true }) } })
  const key = await makeKey('africa-node-founder')
  const provider = fakeProvider([key])
  async function start(): Promise<void> {
    const store = await createStore(folder, { io: disk.io })
    server = await createServer({ store, dataDir: folder, now: () => time, env: ENV, telemetry: createServerTelemetry({ env: {}, now: () => time }), fetch: (url, init) => provider.fetch(url, init) })
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

  const current = (): AllworldServer => { assert.ok(server); return server }
  const keyOf = (device: JourneyDevice): string => {
    const separator = device.cookie.indexOf('=')
    assert.ok(separator > 0)
    return device.cookie.slice(separator + 1)
  }
  const host: AfricaJourneyHost = {
    storageFaults: {
      kinds: ['disk'],
      failCommit: async kind => {
        assert.equal(kind, 'disk')
        await current().store.flush?.()
        disk.fail = 'ENOSPC'
      },
      recoverCommit: async () => { disk.fail = null },
      inspect: async (device, actionId) => {
        await current().store.flush?.()
        const bytes = await readFile(join(folder, 'devices.json'), 'utf8')
        const database = object(JSON.parse(bytes))
        const session = object(object(database.sessions)[keyOf(device)])
        const effects = database.walletEffects
        assert.ok(Array.isArray(effects))
        const receipts = object(session.actions), receipt = receipts[actionId]
        return { bytes, session: JSON.stringify(session), effects: JSON.stringify(effects.filter(entry => object(entry).publicId === device.id)),
          hasReceipt: Object.hasOwn(receipts, actionId), receipt: receipt === undefined ? null : JSON.stringify(receipt) }
      },
      replaceLiabilityField: async (device, city, field, value) => current().store.transact(db => {
        const session = db.sessions[keyOf(device)]
        assert.ok(session)
        const state = object(object(object(session.cities)[city]).state)
        assert.equal(object(state.activeAction).kind, 'homeward')
        const target = field === 'travel' ? state : object(state.travel)
        const previous = target[field]
        if (value === undefined) delete target[field]
        else target[field] = value
        return previous
      }),
      replaceTicketKey: async (device, city, key) => current().store.transact(db => {
        const session = db.sessions[keyOf(device)]
        assert.ok(session)
        const state = object(object(object(session.cities)[city]).state)
        const active = object(state.activeAction)
        assert.equal(active.kind, 'homeward')
        const ticket = object(active.ticket), previous = ticket.key
        assert.ok(typeof previous === 'string')
        ticket.key = key
        return previous
      }),
    },
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
    debit: async (device, amount, reason) => {
      const intent: Record<string, unknown> = { clientId: `${time}:${randomUUID()}`, action: 'debit', amount, reason }
      let response = await request(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      let answer = object(await response.json())
      if (answer.code === 'confirmation_required') {
        assert.equal(typeof answer.token, 'string')
        intent.confirm = answer.token
        response = await request(`/api/admin/players/${device.id}/act`, intent, founderCookie)
        answer = object(await response.json())
      }
      assert.equal(response.status, 200, JSON.stringify(answer))
      assert.equal(answer.code, 'debited', JSON.stringify(answer))
      const repeated = await request(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      assert.equal(repeated.status, 200)
      const replay = object(await repeated.json())
      assert.equal(replay.duplicate, true, 'fixture spending reuses its original admin receipt')
      assert.equal(replay.after, answer.after)
    },
  }
  await africaJourney(host)
  await homewardJourney(host)
})
