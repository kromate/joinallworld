// Player-owned shops on the Worker host: the same run as on the Node server (server/testing/businessJourney.ts) through
// the Durable Object and its SQLite store — one charge for one request, a sale between two players, two buyers and one
// item, the cash box collected once, rent and winding up — and what it costs in rows: looking at a shop writes none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { claimsFor, makeKey, signToken } from '../server/accounts/test-tokens.ts'
import { TOKEN_KEYS_URL } from '../server/accounts/token.ts'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOURNEY_TIME, object } from '../server/testing/cityJourney.ts'
import type { JourneyDevice } from '../server/testing/cityJourney.ts'
import { businessFunding, businessJourney } from '../server/testing/businessJourney.ts'
import type { BusinessHost } from '../server/testing/businessJourney.ts'
import { lagosTime } from '../src/game/clock.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'
import { layoutBindings, readStoredCollection, writeStoredCollection } from '../server/testing/sqliteStorage.ts';
import type { AsyncExec } from '../server/testing/sqliteStorage.ts';

await loadCityContent('lagos')

interface StoredObject { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
type WorkerResponse = Response
interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, options?: RequestInit): Promise<WorkerResponse>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<StoredObject>
}
interface Tooling { Miniflare: new (options: Record<string, unknown>) => WorkerHost; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface Bundler { build(options: { stdin: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' }; outfile: string; bundle: true; format: 'esm'; platform: 'neutral'; external: string[] }): Promise<unknown> }
const tooling = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = tooling('miniflare') as Tooling
const { build } = tooling('esbuild') as Bundler

function deadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 20000) })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

test('Worker: a shop from opening to winding up, and a look at it writes no row', { timeout: 120000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'business-worker-'))
  const bundle = join(folder, 'worker.mjs')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const project = 'allworld-business-worker-test', founder = 'business-founder@example.test'
  const key = await makeKey('business-worker-founder')
  const clockSeed = '__BUSINESS_TEST_CLOCK_SEED__', clockPath = '/__business-test/clock', origin = 'https://business.test'
  // This entry exists only in the generated test bundle. create() injects the current monotonic seed before a runtime exists.
  await build({
    stdin: {
      contents: `
        let businessRuntimeNow = Number('${clockSeed}');
        let businessClockAdvanced = businessRuntimeNow !== ${JOURNEY_TIME};
        Date.now = () => businessRuntimeNow;
        const host = await import('./deploy/cloudflare-worker.ts');
        export const JoinAllworldState = host.JoinAllworldState;
        export default {
          async fetch(request, env, context) {
            const path = new URL(request.url).pathname;
            if (path === '${clockPath}') {
              if (request.method === 'GET') return request.body === null ? Response.json({ now: businessRuntimeNow }) : new Response(null, { status: 400 });
              if (request.method !== 'POST') return new Response(null, { status: 405 });
              if (businessClockAdvanced) return new Response(null, { status: 409 });
              const expected = JSON.stringify({ from: businessRuntimeNow, to: businessRuntimeNow + 60001 });
              if (await request.text() !== expected) return new Response(null, { status: 400 });
              businessRuntimeNow += 60001;
              businessClockAdvanced = true;
              return Response.json({ now: businessRuntimeNow });
            }
            if (path.startsWith('/__business-test/')) return new Response(null, { status: 404 });
            return host.default.fetch(request, env, context);
          },
        };
      `,
      resolveDir: root, sourcefile: 'business-test-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const template = await readFile(bundle, 'utf8')
  assert.equal(template.split(clockSeed).length, 2, 'the generated bundle has exactly one clock seed')
  const options = {
    name: 'business', modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
    bindings: { ...layoutBindings(), BUILD_ID: 'local-business', ACCOUNTS_FIREBASE_PROJECT_ID: project,
      ACCOUNTS_FIREBASE_API_KEY: 'business-edge-key-000000000000000000000000', FOUNDER_EMAIL_SHA256: createHash('sha256').update(founder).digest('hex') },
    outboundService: async (request: Request): Promise<Response> => {
      if (request.url.split('?')[0] === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }
  const acknowledged = async (target: { dispatchFetch(url: string, init?: RequestInit): Promise<WorkerResponse> }, expected: number): Promise<void> => {
    const response = await target.dispatchFetch(origin + clockPath, { method: 'GET' })
    assert.equal(response.status, 200)
    assert.deepEqual(object(await response.json()), { now: expected })
  }
  const create = (seed: number): WorkerHost => {
    const script = template.replace(clockSeed, String(seed))
    assert.equal(script.includes(clockSeed), false)
    return new Miniflare({ ...convertV4MiniflareOptions({ ...options, script }), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
  }
  let fixtureNow = JOURNEY_TIME
  let worker = create(fixtureNow)
  const restartAcks: number[] = []
  const responses: WorkerResponse[] = []
  let businessWriteProbe = false
  const stop = async (): Promise<void> => {
    for (const response of responses.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    if (businessWriteProbe) {
      const db = await worker.unsafeGetDurableObjectStorage('business', 'JoinAllworldState', { name: 'joinallworld-v1' }).catch(() => null)
      if (db) {
        for (const trigger of ['business_collections_insert', 'business_collections_update', 'business_collections_delete', 'business_parts_insert', 'business_parts_update', 'business_parts_delete', 'business_entries_insert', 'business_entries_update', 'business_entries_delete']) await db.exec(`DROP TRIGGER IF EXISTS test_${trigger}`).catch(() => {})
        await db.exec('DROP TABLE IF EXISTS test_business_write_probe').catch(() => {})
      }
    }
    await deadline(worker.dispose(), 'Worker disposal')
  }
  t.after(async () => {
    await stop()
    await rm(folder, { recursive: true, force: true })
  })
  await deadline(worker.ready, 'Worker startup')
  await acknowledged(worker, fixtureNow)
  const send = async (path: string, init: RequestInit): Promise<WorkerResponse> => { const response = await worker.dispatchFetch(origin + path, init); responses.push(response); return response }
  const keyOf = (device: JourneyDevice): string => device.cookie.slice(device.cookie.indexOf('=') + 1)
  const execOf = (db: { exec(query: string, ...bindings: (string | number | null)[]): Promise<unknown[]> }): AsyncExec => (query, ...bindings) => db.exec(query, ...bindings) as Promise<Record<string, unknown>[]>
  const storage = () => worker.unsafeGetDurableObjectStorage('business', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const stored = async (): Promise<Record<string, unknown> | null> => {
    const text = await readStoredCollection(execOf(await storage()), 'business')
    return text === undefined ? null : object(JSON.parse(text))
  }
  const request: BusinessHost['request'] = (path, body, cookie) => send(path, {
    method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const guest = await request('/api/session', { name: 'Business fixture founder' })
  assert.equal(guest.status, 200)
  const guestCookie = guest.headers.get('set-cookie')?.split(';')[0]
  assert.ok(guestCookie)
  assert.equal((await request('/api/life?city=lagos', undefined, guestCookie)).status, 200)
  const account = object(await (await request('/api/account', undefined, guestCookie)).json())
  assert.ok(typeof account.csrf === 'string')
  const token = await signToken(key, claimsFor(project, JOURNEY_TIME, { subject: 'BusinessFixtureFounder', email: founder, n: 1 }))
  const signedIn = await request('/api/account/sign-in', { csrf: account.csrf, idToken: token }, guestCookie)
  assert.equal(signedIn.status, 200)
  const founderCookie = signedIn.headers.get('set-cookie')?.split(';')[0]
  assert.ok(founderCookie)
  assert.equal(object(await (await request('/api/admin/me', undefined, founderCookie)).json()).level, 'root')
  const founderId = object(object(await (await request('/api/session', undefined, founderCookie)).json()).session).id
  assert.ok(typeof founderId === 'string')
  const funding = businessFunding(request, founderCookie, async clientId => {
    const rows = await (await storage()).exec('SELECT value FROM once_receipts WHERE sender = ? AND id = ?', founderId, clientId)
    const receipt = rows[0]?.value
    assert.ok(receipt === undefined || typeof receipt === 'string')
    return receipt ?? null
  })
  // Legacy collection-write probes below retain their separate raw setup; the shared journey cannot call this helper.
  const edit = async (device: JourneyDevice, city: string, change: (state: Record<string, unknown>) => void): Promise<void> => {
    const rows = await (await storage()).exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device))
    assert.equal(rows.length, 1)
    const session = object(JSON.parse(String(object(rows[0]).value)))
    change(object(object(object(session.cities)[city]).state))
    await (await storage()).exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
  }
  const host: BusinessHost = {
    now: () => fixtureNow,
    request,
    funding,
    elapse: async (device, city, ms) => {
      const db = await storage()
      const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device))
      assert.equal(rows.length, 1)
      const session = object(JSON.parse(String(object(rows[0]).value)))
      const entry = object(object(session.cities)[city])
      assert.ok(typeof entry.updatedAt === 'number')
      entry.updatedAt -= ms
      await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
    },
    // The clock stands still, so the shops are moved back instead: everything a shop dates itself by.
    age: async (ms) => {
      const business = await stored()
      assert.ok(business)
      for (const shop of Object.values(object(business.shops)).map(object)) {
        for (const key of ['at', 'openedAt', 'paidUntil']) shop[key] = Number(shop[key]) - ms
        shop.day = lagosTime(Number(shop.at)).day
      }
      await writeStoredCollection(execOf(await storage()), 'business', JSON.stringify(business))
    },
    failPersistence: async (requestId) => {
      await (await storage()).exec(`CREATE TRIGGER fail_business_receipt BEFORE INSERT ON once_receipts WHEN NEW.id = '${requestId}' BEGIN SELECT RAISE(ABORT, 'injected business receipt failure'); END`)
    },
    recoverPersistence: async () => { await (await storage()).exec('DROP TRIGGER fail_business_receipt') },
    restart: async () => {
      await stop()
      worker = create(fixtureNow)
      await deadline(worker.ready, 'Worker restart')
      await acknowledged(worker, fixtureNow)
      restartAcks.push(fixtureNow)
    },
    advanceAdminWindow: async () => {
      assert.equal(fixtureNow, JOURNEY_TIME, 'the fixture clock advances once')
      const next = JOURNEY_TIME + 60001
      assert.equal((await worker.dispatchFetch(origin + clockPath, { method: 'PUT' })).status, 405)
      assert.equal((await worker.dispatchFetch(origin + '/__business-test/unexpected', { method: 'GET' })).status, 404)
      assert.equal((await worker.dispatchFetch(origin + clockPath, { method: 'POST', body: '{}' })).status, 400)
      await acknowledged(worker, fixtureNow)
      const body = JSON.stringify({ from: fixtureNow, to: next })
      const response = await worker.dispatchFetch(origin + clockPath, { method: 'POST', body })
      assert.equal(response.status, 200)
      assert.deepEqual(object(await response.json()), { now: next })
      await acknowledged(worker, next)
      assert.equal((await worker.dispatchFetch(origin + clockPath, { method: 'POST', body })).status, 409, 'a second clock advance is refused')
      fixtureNow = next
    },
    hasReceipt: async (device, requestId) => {
      const rows = await (await storage()).exec('SELECT COUNT(*) AS n FROM once_receipts WHERE sender = (SELECT public_id FROM sessions WHERE secret = ?) AND id = ?', keyOf(device), requestId)
      return Number(object(rows[0]).n) > 0
    },
  }
  const result = await businessJourney(host)
  assert.deepEqual(restartAcks, [JOURNEY_TIME, JOURNEY_TIME + 60001], 'both actual restarts preserve the authoritative fixture clock')
  assert.equal(host.now(), JOURNEY_TIME + 60001)
  await acknowledged(worker, host.now())
  assert.deepEqual([result.setup, result.bought, result.raced, result.closed], [15000, 1400, ['bought', 'sold_out'], true])

  // ---- rows: a new shop is one collection row; looking at it, as owner or as passer-by, is none --------------------------
  const cookieOf = async (name: string): Promise<JourneyDevice> => {
    const response = await host.request('/api/session', { name })
    const answer = object(await response.json())
    return { id: String(object(answer.session).id), cookie: String(response.headers.get('set-cookie')).split(';')[0] ?? '' }
  }
  const dele = await cookieOf('Dele')
  assert.equal((await host.request('/api/life?city=lagos', undefined, dele.cookie)).status, 200)
  await edit(dele, 'lagos', (state) => { state.cash = 50000; state.ledger = []; state.ledgerDays = []; state.location = 'market' })
  const businessDb = await storage()
  await businessDb.exec('CREATE TABLE test_business_write_probe (writes INTEGER NOT NULL)')
  await businessDb.exec('INSERT INTO test_business_write_probe(writes) VALUES(0)')
  businessWriteProbe = true
  const collectionNames = "NEW.name IN ('business','root:business')"
  // Match the same NUL-delimited entry namespace as sqlite-store.ts, excluding other collection names.
  const partNames = "NEW.name IN ('business','root:business') OR (NEW.name >= ('entry:business' || char(0)) AND NEW.name < ('entry:business' || char(1)))"
  const entryCollection = "NEW.coll = 'business'"
  for (const [table, condition, label] of [['collections', collectionNames, 'collections'], ['collection_parts', partNames, 'parts'], ['entries', entryCollection, 'entries']] as const) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const scoped = operation === 'DELETE' ? condition.replaceAll('NEW.', 'OLD.')
        : operation === 'UPDATE' ? `(${condition}) OR (${condition.replaceAll('NEW.', 'OLD.')})` : condition
      await businessDb.exec(`CREATE TRIGGER test_business_${label}_${operation.toLowerCase()} AFTER ${operation} ON ${table} WHEN ${scoped} BEGIN UPDATE test_business_write_probe SET writes = writes + 1; END`)
    }
  }
  const businessWrites = async (): Promise<number> => Number(object((await (await storage()).exec('SELECT writes FROM test_business_write_probe'))[0]).writes)
  const beforeOpenWrites = await businessWrites()
  const opened = object(await (await host.request('/api/business/open', { cityId: 'lagos', venue: 'market', type: 'provisions', name: 'Dele Stores', colour: 'blue', icon: '🧺', requestId: `${JOURNEY_TIME}:11111111-2222-4333-8444-555555555555` }, dele.cookie)).json())
  assert.equal(opened.code, 'opened')
  assert.ok(await businessWrites() > beforeOpenWrites, 'opening a shop increments the business-row probe')
  const beforeStockWrites = await businessWrites()
  assert.equal(object(await (await host.request('/api/business/stock', { cityId: 'lagos', items: { bread: 10, zobo: 10 }, requestId: `${JOURNEY_TIME}:11111111-2222-4333-8444-666666666666` }, dele.cookie)).json()).code, 'stocked')
  assert.ok(await businessWrites() > beforeStockWrites, 'stocking a shop increments the business-row probe')
  await host.age(3 * 3600000)
  const before = JSON.stringify(await stored())
  const rows = await businessWrites()
  for (let index = 0; index < 4; index++) {
    const market = object(await (await host.request('/api/business/venue?city=lagos&venue=market', undefined, dele.cookie)).json())
    assert.equal((market.shops as unknown[]).length, 1)
    const mine = object(object(await (await host.request('/api/business/mine?city=lagos', undefined, dele.cookie)).json()).mine)
    assert.ok(Number(mine.till) > 0, 'the shop a player sees has been selling')
  }
  assert.equal(JSON.stringify(await stored()), before, 'and the stored shop did not move')
  assert.equal(await businessWrites() - rows, 0, 'eight reads of a shop wrote no business collection row')
})
