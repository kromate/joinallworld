// The ride home on credit on the Worker host: the same run as on the Node server (server/testing/rideJourney.ts) through the
// Durable Object and its SQLite store — one debt however the request is sent, no skip, repaid from the wallet.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOURNEY_TIME, object } from '../server/testing/cityJourney.ts'
import type { JourneyDevice } from '../server/testing/cityJourney.ts'
import { rideJourney } from '../server/testing/rideJourney.ts'
import type { RideHost } from '../server/testing/rideJourney.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'

await Promise.all(['lagos', 'ibadan'].map(loadCityContent))

interface TestWebSocket { accept(): void; close(): void; send(value: string): void; addEventListener(type: 'message', listener: (event: { data: string }) => void): void }
interface StoredObject { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
type WorkerResponse = Response & { webSocket?: TestWebSocket | null }
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

test('Worker: a visitor who cannot pay the way home rides on credit, once, and owes it', { timeout: 60000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ride-credit-worker-'))
  const bundle = join(folder, 'worker.mjs')
  const root = fileURLToPath(new URL('..', import.meta.url))
  // This entry exists only in the test bundle: the Worker's clock stands still, and time passes by ageing the stored life.
  await build({
    stdin: {
      contents: `
        Date.now = () => ${JOURNEY_TIME};
        const host = await import('./deploy/cloudflare-worker.ts');
        export const JoinAllworldState = host.JoinAllworldState;
        export default host.default;
      `,
      resolveDir: root, sourcefile: 'ride-credit-test-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const options = {
    name: 'ride-credit', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, bindings: { BUILD_ID: 'local-ride-credit' },
  }
  const worker = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
  const sockets: TestWebSocket[] = [], responses: WorkerResponse[] = []
  t.after(async () => {
    for (const peer of sockets.splice(0)) try { peer.close() } catch { /* closed */ }
    for (const response of responses.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await deadline(worker.dispose(), 'Worker disposal')
    await rm(folder, { recursive: true, force: true })
  })
  await deadline(worker.ready, 'Worker startup')
  const origin = 'https://ride-credit.test'
  const send = async (path: string, init: RequestInit): Promise<WorkerResponse> => { const response = await worker.dispatchFetch(origin + path, init); responses.push(response); return response }
  // A guest's cookie carries the key its session record is stored under (`__Host-sid=<key>`).
  const keyOf = (device: JourneyDevice): string => device.cookie.slice(device.cookie.indexOf('=') + 1)
  const storage = () => worker.unsafeGetDurableObjectStorage('ride-credit', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const host: RideHost = {
    now: () => JOURNEY_TIME,
    request: (path, body, cookie) => send(path, {
      method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    elapse: async (device, city, ms) => {
      const rows = await (await storage()).exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device))
      assert.equal(rows.length, 1)
      const session = object(JSON.parse(String(object(rows[0]).value)))
      const entry = object(object(session.cities)[city])
      assert.equal(typeof entry.updatedAt, 'number')
      entry.updatedAt = Number(entry.updatedAt) - ms
      await (await storage()).exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
    },
    edit: async (device, city, change) => {
      const rows = await (await storage()).exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device))
      assert.equal(rows.length, 1)
      const session = object(JSON.parse(String(object(rows[0]).value)))
      change(object(object(object(session.cities)[city]).state))
      await (await storage()).exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
    },
  }
  const result = await rideJourney(host)
  assert.deepEqual([result.fare, result.debt, result.cash], [3500, 2000, 0])
})
