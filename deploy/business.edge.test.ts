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
import { layoutBindings } from './test-storage.ts';

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
  const worker = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
  const responses: WorkerResponse[] = []
  t.after(async () => {
    for (const response of responses.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await deadline(worker.dispose(), 'Worker disposal')
    await rm(folder, { recursive: true, force: true })
  })
  await deadline(worker.ready, 'Worker startup')
  const origin = 'https://business.test'
  const send = async (path: string, init: RequestInit): Promise<WorkerResponse> => { const response = await worker.dispatchFetch(origin + path, init); responses.push(response); return response }
  const keyOf = (device: JourneyDevice): string => device.cookie.slice(device.cookie.indexOf('=') + 1)
  const storage = () => worker.unsafeGetDurableObjectStorage('business', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const stored = async (): Promise<Record<string, unknown> | null> => {
    const rows = await (await storage()).exec("SELECT value FROM collections WHERE name = 'business'")
    return rows.length ? object(JSON.parse(String(object(rows[0]).value))) : null
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
      await (await storage()).exec("UPDATE collections SET value = ? WHERE name = 'business'", JSON.stringify(business))
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
  const opened = object(await (await host.request('/api/business/open', { cityId: 'lagos', venue: 'market', type: 'provisions', name: 'Dele Stores', colour: 'blue', icon: '🧺', requestId: `${JOURNEY_TIME}:11111111-2222-4333-8444-555555555555` }, dele.cookie)).json())
  assert.equal(opened.code, 'opened')
  assert.equal(object(await (await host.request('/api/business/stock', { cityId: 'lagos', items: { bread: 10, zobo: 10 }, requestId: `${JOURNEY_TIME}:11111111-2222-4333-8444-666666666666` }, dele.cookie)).json()).code, 'stocked')
  await host.age(3 * 3600000)
  const before = JSON.stringify(await stored())
  const written = async (): Promise<number> => Number(object((await (await storage()).exec('SELECT total_changes() AS n'))[0]).n)
  const rows = await written()
  for (let index = 0; index < 4; index++) {
    const market = object(await (await host.request('/api/business/venue?city=lagos&venue=market', undefined, dele.cookie)).json())
    assert.equal((market.shops as unknown[]).length, 1)
    const mine = object(object(await (await host.request('/api/business/mine?city=lagos', undefined, dele.cookie)).json()).mine)
    assert.ok(Number(mine.till) > 0, 'the shop a player sees has been selling')
  }
  assert.equal(JSON.stringify(await stored()), before, 'and the stored shop did not move')
  assert.ok(await written() - rows <= 1, 'eight reads of a shop wrote no shop row')
})
