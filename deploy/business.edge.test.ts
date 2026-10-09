// Player-owned shops on the Worker host: the same run as on the Node server (server/testing/businessJourney.ts) through
// the Durable Object and its SQLite store — one charge for one request, a sale between two players, two buyers and one
// item, the cash box collected once, rent and winding up — and what it costs in rows: looking at a shop writes none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOURNEY_TIME, object } from '../server/testing/cityJourney.ts'
import type { JourneyDevice } from '../server/testing/cityJourney.ts'
import { businessJourney } from '../server/testing/businessJourney.ts'
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
  // This entry exists only in the test bundle: the Worker's clock stands still, and time passes by moving the stored shops back.
  await build({
    stdin: {
      contents: `
        Date.now = () => ${JOURNEY_TIME};
        const host = await import('./deploy/cloudflare-worker.ts');
        export const JoinAllworldState = host.JoinAllworldState;
        export default host.default;
      `,
      resolveDir: root, sourcefile: 'business-test-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const options = {
    name: 'business', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, bindings: { ...layoutBindings(), BUILD_ID: 'local-business' },
  }
  const create = () => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
  let worker = create()
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
  const origin = 'https://business.test'
  const send = async (path: string, init: RequestInit): Promise<WorkerResponse> => { const response = await worker.dispatchFetch(origin + path, init); responses.push(response); return response }
  const keyOf = (device: JourneyDevice): string => device.cookie.slice(device.cookie.indexOf('=') + 1)
  const execOf = (db: { exec(query: string, ...bindings: (string | number | null)[]): Promise<unknown[]> }): AsyncExec => (query, ...bindings) => db.exec(query, ...bindings) as Promise<Record<string, unknown>[]>
  const storage = () => worker.unsafeGetDurableObjectStorage('business', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const stored = async (): Promise<Record<string, unknown> | null> => {
    const text = await readStoredCollection(execOf(await storage()), 'business')
    return text === undefined ? null : object(JSON.parse(text))
  }
  const host: BusinessHost = {
    now: () => JOURNEY_TIME,
    request: (path, body, cookie) => send(path, {
      method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    elapse: async () => { /* nothing in this run waits for a timed action */ },
    edit: async (device, city, change) => {
      const rows = await (await storage()).exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device))
      assert.equal(rows.length, 1)
      const session = object(JSON.parse(String(object(rows[0]).value)))
      change(object(object(object(session.cities)[city]).state))
      await (await storage()).exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
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
    restart: async () => { await stop(); worker = create(); await deadline(worker.ready, 'Worker restart') },
    hasReceipt: async (device, requestId) => {
      const rows = await (await storage()).exec('SELECT COUNT(*) AS n FROM once_receipts WHERE sender = (SELECT public_id FROM sessions WHERE secret = ?) AND id = ?', keyOf(device), requestId)
      return Number(object(rows[0]).n) > 0
    },
  }
  const result = await businessJourney(host)
  assert.deepEqual([result.setup, result.bought, result.raced, result.closed], [15000, 1400, ['bought', 'sold_out'], true])

  // ---- rows: a new shop is one collection row; looking at it, as owner or as passer-by, is none --------------------------
  const cookieOf = async (name: string): Promise<JourneyDevice> => {
    const response = await host.request('/api/session', { name })
    const answer = object(await response.json())
    return { id: String(object(answer.session).id), cookie: String(response.headers.get('set-cookie')).split(';')[0] ?? '' }
  }
  const dele = await cookieOf('Dele')
  assert.equal((await host.request('/api/life?city=lagos', undefined, dele.cookie)).status, 200)
  await host.edit(dele, 'lagos', (state) => { state.cash = 50000; state.ledger = []; state.ledgerDays = []; state.location = 'market' })
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
