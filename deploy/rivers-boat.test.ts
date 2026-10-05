import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boatJourney } from '../server/testing/boatJourney.ts'
import { object, JOURNEY_TIME } from '../server/testing/cityJourney.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'
import { contentFor } from '../src/game/cities/runtime.ts'

interface StoredObject { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, options?: RequestInit): Promise<Response>
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
const CITY = 'port-harcourt'

function deadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 20000) })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

test('Worker Rivers boat receipts charge once and resume through durable SQLite restart', { timeout: 60000 }, async t => {
  await loadCityContent(CITY)
  const route = contentFor(CITY).localRoutes?.[0]
  assert.ok(route)
  const folder = await mkdtemp(join(tmpdir(), 'rivers-boat-worker-'))
  const bundle = join(folder, 'worker.mjs'), root = fileURLToPath(new URL('..', import.meta.url))
  await build({
    stdin: {
      contents: `Date.now = () => ${JOURNEY_TIME};
        const host = await import('./deploy/cloudflare-worker.ts');
        export const JoinAllworldState = host.JoinAllworldState;
        export default host.default;`,
      resolveDir: root, sourcefile: 'rivers-boat-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const options = {
    name: 'rivers-boat', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
    bindings: { BUILD_ID: 'local-boat-contract' },
    assets: { directory: join(root, 'dist'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
  }
  const create = () => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true })
  let worker = create(), cookie = ''
  const stop = () => deadline(worker.dispose(), 'Worker disposal')
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }) })
  await deadline(worker.ready, 'Worker startup')
  async function modify(change: (entry: Record<string, unknown>) => void): Promise<void> {
    const storage = await worker.unsafeGetDurableObjectStorage('rivers-boat', 'JoinAllworldState', { name: 'joinallworld-v1' })
    const rows = await storage.exec('SELECT value FROM sessions WHERE secret = ?', cookie.slice(4))
    assert.equal(rows.length, 1)
    const session = object(JSON.parse(String(object(rows[0]).value)))
    change(object(object(session.cities)[CITY]))
    await storage.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), cookie.slice(4))
  }
  const origin = 'https://rivers-boat.test'
  await boatJourney({
    now: () => JOURNEY_TIME,
    request: async (path, body) => {
      const response = await worker.dispatchFetch(origin + path, {
        method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const answer = object(await response.json())
      assert.equal(response.status, 200, JSON.stringify(answer))
      cookie ||= response.headers.get('set-cookie')?.split(';')[0] ?? ''
      return answer
    },
    seed: (location, cash) => modify(entry => { Object.assign(object(entry.state), { location, cash, activeAction: null }) }),
    elapse: ms => modify(entry => { entry.updatedAt = Number(entry.updatedAt) - ms }),
    restart: async () => { await stop(); worker = create(); await deadline(worker.ready, 'Worker restart') },
  }, route)
})
