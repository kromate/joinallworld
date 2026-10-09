import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { claimsFor, makeKey, signToken } from '../server/accounts/test-tokens.ts'
import { TOKEN_KEYS_URL } from '../server/accounts/token.ts'
import { africaJourney, homewardJourney } from '../server/testing/africaJourney.ts'
import type { AfricaJourneyHost } from '../server/testing/africaJourney.ts'
import type { JourneyDevice } from '../server/testing/cityJourney.ts'
import { layoutBindings } from '../server/testing/sqliteStorage.ts'

interface StoredObject { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
type WorkerResponse = Response & { webSocket?: unknown }
interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, options?: RequestInit): Promise<WorkerResponse>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<StoredObject>
}
interface Tooling {
  Miniflare: new (options: Record<string, unknown>) => WorkerHost
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
  build(options: Record<string, unknown>): Promise<unknown>
}

const PROJECT = 'allworld-africa-worker-test'
const FOUNDER = 'africa-founder@example.test'
const FOUNDER_HASH = createHash('sha256').update(FOUNDER).digest('hex')
const ORIGIN = 'https://africa-journey.test'
const TOOL = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = TOOL('miniflare') as Tooling
const { build } = TOOL('esbuild') as Tooling
const within = async <T>(label: string, promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30000) })])
  } finally { if (timer) clearTimeout(timer) }
}
const object = (value: unknown): Record<string, unknown> => {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value as Record<string, unknown>
}

test('Worker HTTP host: all five capital trips and cashless homeward journeys preserve original homes across SQLite restart', { timeout: 120000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'africa-capitals-worker-'))
  let worker: WorkerHost | null = null
  const current = (): WorkerHost => { assert.ok(worker); return worker }
  async function stop(): Promise<void> {
    if (!worker) return
    const previous = worker
    worker = null
    await within('Worker disposal', previous.dispose())
  }
  t.after(async () => { try { await stop() } finally { await rm(folder, { recursive: true, force: true }) } })
  const bundle = join(folder, 'worker.mjs'), storagePath = join(folder, 'storage')
  const key = await makeKey('africa-worker-founder')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  const bindings = {
    ...layoutBindings(), BUILD_ID: 'local-africa-journey',
    ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT,
    ACCOUNTS_FIREBASE_API_KEY: 'africa-edge-test-api-key-0000000000000000000000',
    FOUNDER_EMAIL_SHA256: FOUNDER_HASH,
  }
  const outbound: string[] = []
  const options = {
    name: 'joinallworld-africa-journey', script, modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
    durableObjectsPersist: storagePath, resourcePersistencePath: storagePath,
    unsafeInspectDurableObjects: true, bindings,
    outboundService: async (request: Request): Promise<Response> => {
      const url = new URL(request.url)
      outbound.push(`${url.origin}${url.pathname}`)
      if (url.href.split('?')[0] === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
    serviceBindings: { ASSETS: () => new Response('asset') }, handleStructuredLogs: () => {},
  }
  const make = (): WorkerHost => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: storagePath, unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
  worker = make()
  let address = 0, minted = 0
  const ips = () => `198.51.100.${(address++ % 250) + 1}`
  await within('Worker startup', worker.ready)
  const send = async (path: string, body?: object, cookie?: string): Promise<WorkerResponse> => within(`Worker ${path}`, current().dispatchFetch(ORIGIN + path, {
    method: body ? 'POST' : 'GET',
    headers: { origin: ORIGIN, 'cf-connecting-ip': ips(), ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }))
  const founderGuest = await send('/api/session', { name: 'Africa fixture founder' })
  assert.equal(founderGuest.status, 200)
  const guestCookie = founderGuest.headers.get('set-cookie')?.split(';')[0]
  assert.ok(guestCookie)
  assert.equal((await send('/api/life?city=lagos', undefined, guestCookie)).status, 200)
  const accountState = object(await (await send('/api/account', undefined, guestCookie)).json())
  const idToken = await signToken(key, claimsFor(PROJECT, Date.now(), { subject: 'AfricaFixtureFounder', email: FOUNDER, n: ++minted }))
  const signedIn = await send('/api/account/sign-in', { csrf: accountState.csrf, idToken }, guestCookie)
  assert.equal(signedIn.status, 200)
  const founderCookie = signedIn.headers.get('set-cookie')?.split(';')[0]
  assert.ok(founderCookie)
  const founderMe = object(await (await send('/api/admin/me', undefined, founderCookie)).json())
  assert.equal(founderMe.level, 'root', 'fixture funding uses the real founder authorization boundary')

  const keyOf = (device: JourneyDevice): string => {
    const separator = device.cookie.indexOf('=')
    assert.ok(separator > 0)
    return device.cookie.slice(separator + 1)
  }
  const storage = () => current().unsafeGetDurableObjectStorage('joinallworld-africa-journey', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const host: AfricaJourneyHost = {
    now: () => Date.now(),
    request: (path, body, cookie) => send(path, body, cookie),
    elapse: async (device, city, ms) => {
      const db = await storage()
      const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device))
      assert.equal(rows.length, 1)
      const session = object(JSON.parse(String(rows[0]?.value)))
      const cities = object(session.cities)
      const entry = object(cities[city])
      assert.equal(typeof entry.updatedAt, 'number')
      entry.updatedAt = Number(entry.updatedAt) - ms
      await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
    },
    restart: async () => { await stop(); worker = make(); await within('Worker restart', worker.ready) },
    credit: async (device, amount, reason) => {
      const intent = { clientId: `${Date.now()}:${randomUUID()}`, action: 'credit', amount, reason }
      const response = await send(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      const answer = object(await response.json())
      assert.equal(response.status, 200, JSON.stringify(answer))
      assert.equal(answer.code, 'credited', JSON.stringify(answer))
      const repeated = await send(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      assert.equal(repeated.status, 200)
      const replay = object(await repeated.json())
      assert.equal(replay.duplicate, true, 'fixture funding reuses its original admin receipt')
      assert.equal(replay.after, answer.after)
    },
    debit: async (device, amount, reason) => {
      const intent: Record<string, unknown> = { clientId: `${Date.now()}:${randomUUID()}`, action: 'debit', amount, reason }
      let response = await send(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      let answer = object(await response.json())
      if (answer.code === 'confirmation_required') {
        assert.equal(typeof answer.token, 'string')
        intent.confirm = answer.token
        response = await send(`/api/admin/players/${device.id}/act`, intent, founderCookie)
        answer = object(await response.json())
      }
      assert.equal(response.status, 200, JSON.stringify(answer))
      assert.equal(answer.code, 'debited', JSON.stringify(answer))
      const repeated = await send(`/api/admin/players/${device.id}/act`, intent, founderCookie)
      assert.equal(repeated.status, 200)
      const replay = object(await repeated.json())
      assert.equal(replay.duplicate, true, 'fixture spending reuses its original admin receipt')
      assert.equal(replay.after, answer.after)
    },
  }
  await africaJourney(host)
  await homewardJourney(host)
  assert.ok(outbound.includes(TOKEN_KEYS_URL.split('?')[0] ?? ''), 'the test provider served the configured signing key')
})
