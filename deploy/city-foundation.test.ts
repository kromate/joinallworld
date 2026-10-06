import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ibadanJourney } from '../server/testing/ibadanJourney.ts'
import { ogunJourney } from '../server/testing/ogunJourney.ts'
import { cityJourney, legacyJourney, JOURNEY_TIME, object, qualifyState, seedLegacyRecords } from '../server/testing/cityJourney.ts'
import type { JourneyDevice, JourneyHost, JourneySocket } from '../server/testing/cityJourney.ts'
import { layoutBindings } from './test-storage.ts';

interface TestWebSocket {
  accept(): void
  close(): void
  send(value: string): void
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void
}
interface StoredObject { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
type WorkerResponse = Response & { webSocket?: TestWebSocket | null }
interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, options?: RequestInit): Promise<WorkerResponse>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<StoredObject>
}
interface Tooling {
  Miniflare: new (options: Record<string, unknown>) => WorkerHost
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
}
interface Bundler {
  build(options: { stdin: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' }; outfile: string; bundle: true; format: 'esm'; platform: 'neutral'; external: string[] }): Promise<unknown>
}
const tooling = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = tooling('miniflare') as Tooling
const { build } = tooling('esbuild') as Bundler

function deadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 20000) })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

test('Worker city modules: complete city journey and lossless legacy switches survive SQLite restart', { timeout: 60000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'city-foundation-worker-'))
  const bundle = join(folder, 'worker.mjs')
  const root = fileURLToPath(new URL('..', import.meta.url))
  // This entry exists only in the test bundle. Production registers no fictional city or test clock.
  await build({
    stdin: {
      contents: `
        import { registerCityForTest, loadCityContent } from './src/game/cities/registry.ts';
        import { fictionalCity, fictionalNeighbourCity } from './src/game/cities/testing/fictionalCity.test-fixture.ts';
        Date.now = () => ${JOURNEY_TIME};
        registerCityForTest(fictionalCity);
        registerCityForTest(fictionalNeighbourCity);
        await Promise.all([loadCityContent(fictionalCity.id), loadCityContent(fictionalNeighbourCity.id)]);
        const host = await import('./deploy/cloudflare-worker.ts');
        export const JoinAllworldState = host.JoinAllworldState;
        export default host.default;
      `,
      resolveDir: root, sourcefile: 'city-test-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const options = {
    name: 'city-foundation', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
    bindings: { ...layoutBindings(), BUILD_ID: 'local-city-contract' },
    assets: { directory: join(root, 'dist'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
  }
  const create = () => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true })
  let worker = create()
  const sockets: TestWebSocket[] = [], responses: WorkerResponse[] = []
  async function stop(): Promise<void> {
    for (const peer of sockets.splice(0)) peer.close()
    for (const response of responses.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await deadline(worker.dispose(), 'Worker disposal')
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }) })
  await deadline(worker.ready, 'Worker startup')
  const origin = 'https://city-contract.test'
  const send = async (path: string, options: RequestInit): Promise<WorkerResponse> => {
    const response = await worker.dispatchFetch(origin + path, options)
    responses.push(response)
    return response
  }
  // A guest's cookie carries the key its session record is stored under (`__Host-sid=<key>`).
  const keyOf = (device: JourneyDevice): string => device.cookie.slice(device.cookie.indexOf('=') + 1)
  const storage = () => worker.unsafeGetDurableObjectStorage('city-foundation', 'JoinAllworldState', { name: 'joinallworld-v1' })
  async function stored(device: JourneyDevice): Promise<Record<string, unknown>> {
    const rows = await (await storage()).exec('SELECT value FROM sessions WHERE secret = ?', keyOf(device))
    assert.equal(rows.length, 1)
    const value = object(rows[0]).value
    assert.equal(typeof value, 'string')
    return object(JSON.parse(String(value)))
  }
  async function modify(device: JourneyDevice, city: string, change: (entry: Record<string, unknown>) => void): Promise<void> {
    const session = await stored(device)
    change(object(object(session.cities)[city]))
    await (await storage()).exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
  }
  const host: JourneyHost = {
    now: () => JOURNEY_TIME,
    request: (path, body, cookie) => send(path, {
      method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    elapse: (device, city, ms) => modify(device, city, entry => { assert.equal(typeof entry.updatedAt, 'number'); entry.updatedAt = Number(entry.updatedAt) - ms }),
    qualify: (device, city) => modify(device, city, entry => qualifyState(entry.state)),
    edit: (device, city, change) => modify(device, city, entry => change(object(entry.state))),
    session: stored,
    seedLegacy: async device => {
      const session = await stored(device)
      seedLegacyRecords(session, JOURNEY_TIME)
      await (await storage()).exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), keyOf(device))
    },
    restart: async () => { await stop(); worker = create(); await deadline(worker.ready, 'Worker restart') },
    socket: async device => {
      const response = await send('/socket', { headers: { origin, cookie: device.cookie, upgrade: 'websocket' } })
      assert.equal(response.status, 101)
      const socket = response.webSocket
      assert.ok(socket)
      const queue: unknown[] = [], waiting: ((frame: unknown) => void)[] = []
      socket.addEventListener('message', event => {
        const frame: unknown = JSON.parse(event.data)
        if (object(frame).type === 'heartbeat') { socket.send(JSON.stringify({ type: 'heartbeat-ack' })); return }
        // The hint that a character's life changed (docs/DEVICES.md) arrives a moment after its cause; the journeys do not read it (the Node fixture leaves it out too).
        if (object(frame).type === 'life-changed') return
        const resolve = waiting.shift()
        if (resolve) resolve(frame)
        else queue.push(frame)
      })
      socket.accept()
      sockets.push(socket)
      const peer: JourneySocket = {
        send: value => socket.send(JSON.stringify(value)),
        next: () => queue.length ? Promise.resolve(queue.shift()) : deadline(new Promise(resolve => { waiting.push(resolve) }), 'Socket frame'),
      }
      return peer
    },
  }
  const device = await cityJourney(host)
  await ibadanJourney(host)
  await ogunJourney(host)
  await legacyJourney(host, device)
})
