// The location-confirmed badge on the Worker host: the same run as on the Node server (server/testing/residenceJourney.ts) through
// the Durable Object and its SQLite store — the one action a device sends, exactly once, the badge seen by another player, the
// daily limit as a stored long-window row, and switching off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JOURNEY_TIME } from '../server/testing/cityJourney.ts'
import { residenceJourney } from '../server/testing/residenceJourney.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'
import { layoutBindings } from '../server/testing/sqliteStorage.ts';

await loadCityContent('lagos')

type WorkerResponse = Response
interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, options?: RequestInit): Promise<WorkerResponse>
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

test('Worker: a confirmation is recorded once, seen by another player, limited per day and switched off', { timeout: 60000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'residence-worker-'))
  const bundle = join(folder, 'worker.mjs')
  const root = fileURLToPath(new URL('..', import.meta.url))
  await build({
    stdin: {
      contents: `
        Date.now = () => ${JOURNEY_TIME};
        const host = await import('./deploy/cloudflare-worker.ts');
        export const JoinAllworldState = host.JoinAllworldState;
        export default host.default;
      `,
      resolveDir: root, sourcefile: 'residence-test-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const options = {
    name: 'residence', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, bindings: { ...layoutBindings(), BUILD_ID: 'local-residence' },
  }
  const worker = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} })
  const responses: WorkerResponse[] = []
  t.after(async () => {
    for (const response of responses.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    await deadline(worker.dispose(), 'Worker disposal')
    await rm(folder, { recursive: true, force: true })
  })
  await deadline(worker.ready, 'Worker startup')
  const origin = 'https://residence.test'
  const result = await residenceJourney({
    now: () => JOURNEY_TIME,
    request: async (path, body, cookie) => {
      const response = await worker.dispatchFetch(origin + path, {
        method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      responses.push(response)
      return response
    },
    elapse: async () => {},
  })
  assert.deepEqual(result.sent, { lga: 'ikeja', ok: true })
  assert.equal(result.limitedAfter, 5)
})
