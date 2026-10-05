// Skipping a trip for game money ('travel.skip') on the Worker host: the same run as on the Node server
// (server/testing/skipJourney.ts) through the Durable Object and its SQLite store — one charge, the life filed under
// the city it arrived in, the other device told, and a watching friend shown the arrival.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOURNEY_TIME, object } from '../server/testing/cityJourney.ts'
import type { JourneyDevice } from '../server/testing/cityJourney.ts'
import { skipJourney } from '../server/testing/skipJourney.ts'
import type { SkipHost, SkipSocket } from '../server/testing/skipJourney.ts'
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

test('Worker: a trip between cities is skipped once, for the price shown', { timeout: 60000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'trip-skip-worker-'))
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
      resolveDir: root, sourcefile: 'trip-skip-test-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const options = {
    name: 'trip-skip', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, bindings: { BUILD_ID: 'local-trip-skip' },
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
  const origin = 'https://trip-skip.test'
  const send = async (path: string, init: RequestInit): Promise<WorkerResponse> => { const response = await worker.dispatchFetch(origin + path, init); responses.push(response); return response }
  // A guest's cookie carries the key its session record is stored under (`__Host-sid=<key>`).
  const keyOf = (device: JourneyDevice): string => device.cookie.slice(device.cookie.indexOf('=') + 1)
  const storage = () => worker.unsafeGetDurableObjectStorage('trip-skip', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const host: SkipHost = {
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
    socket: async (device): Promise<SkipSocket> => {
      const response = await send('/socket', { headers: { origin, cookie: device.cookie, upgrade: 'websocket' } })
      assert.equal(response.status, 101)
      const socket = response.webSocket
      assert.ok(socket)
      const frames: Record<string, unknown>[] = []
      socket.addEventListener('message', event => {
        const frame = object(JSON.parse(event.data))
        if (frame.type === 'heartbeat') { socket.send(JSON.stringify({ type: 'heartbeat-ack' })); return }
        frames.push(frame)
      })
      socket.accept()
      sockets.push(socket)
      return { send: value => socket.send(JSON.stringify(value)), frames }
    },
  }
  const result = await skipJourney(host)
  assert.deepEqual([result.fare, result.free, result.charged], [3500, 0, 1000])
})
