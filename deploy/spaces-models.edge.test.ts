// OWNER: spaces — players' 3D models on the Worker host (server/spaces/models.ts, deploy/r2-models.ts): the real Worker bundle and
// its SQLite Durable Object in Miniflare, with an R2 bucket bound as MODELS. An upload's raw bytes reach the route, are checked,
// land in R2 under their hash, come back byte for byte to another player, and a bad file or a JSON body is refused. Without the
// binding the same Worker says uploads are not ready.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claimsFor, makeKey, signToken } from '../server/accounts/test-tokens.ts'
import { TOKEN_KEYS_URL } from '../server/accounts/token.ts'
import { layoutBindings } from '../server/testing/sqliteStorage.ts'
import { SHARING_TERMS_VERSION } from '../src/types/sharing.ts'

type Json = Record<string, any>
interface Bucket { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> }
interface WorkerHost { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string, options?: RequestInit): Promise<Response>; getR2Bucket(name: string): Promise<Bucket> }
interface Tooling { Miniflare: new (options: Record<string, unknown>) => WorkerHost; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
const tooling = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = tooling('miniflare') as Tooling
const { build } = tooling('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }

const CHAIR = new Uint8Array(await readFile(new URL('../src/housing-studio/assets/dining-chair-near.glb', import.meta.url)))

test('Worker: a model upload goes to R2 by its hash and comes back byte for byte; without the bucket uploads are not ready', { timeout: 180000 }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'spaces-models-worker-'))
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [join(fileURLToPath(new URL('..', import.meta.url)), 'deploy/cloudflare-worker.ts')], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'], logLevel: 'error' })
  const script = await readFile(bundle, 'utf8')
  const project = 'allworld-models-worker-test', origin = 'https://models.test', operator = 'operator-token-for-edge-tests-0123456789'
  const key = await makeKey('models-worker')
  const options = (withBucket: boolean) => ({
    name: 'models', modules: true, compatibilityDate: '2026-10-01', script,
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
    ...(withBucket ? { r2Buckets: ['MODELS'] } : {}),
    bindings: { ...layoutBindings(), BUILD_ID: 'local-models', ACCOUNTS_FIREBASE_PROJECT_ID: project, MODERATOR_TOKEN: operator,
      ACCOUNTS_FIREBASE_API_KEY: 'models-edge-key-00000000000000000000000000', FOUNDER_EMAIL_SHA256: createHash('sha256').update('founder@example.test').digest('hex') },
    outboundService: async (request: Request): Promise<Response> => {
      if (request.url.split('?')[0] === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
    assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
  })
  const workers: WorkerHost[] = []
  t.after(async () => { for (const w of workers) await w.dispose().catch(() => {}); await rm(folder, { recursive: true, force: true }) })
  const start = async (withBucket: boolean): Promise<WorkerHost> => {
    const w = new Miniflare({ ...convertV4MiniflareOptions(options(withBucket)), resourcePersistencePath: join(folder, withBucket ? 'with' : 'without'), handleStructuredLogs: () => {} })
    workers.push(w); await w.ready; return w
  }
  let minted = 0
  const kit = (worker: WorkerHost) => {
    const call = async (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Json> => {
      const raw = body instanceof Uint8Array
      const response = await worker.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': raw ? 'model/gltf-binary' : 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: raw ? body as Uint8Array<ArrayBuffer> : JSON.stringify(body) } : {}) })
      const type = response.headers.get('content-type') ?? ''
      return type.includes('json') ? { status: response.status, ...(await response.json() as object) } : { status: response.status, type, cache: response.headers.get('cache-control'), bytes: new Uint8Array(await response.arrayBuffer()) }
    }
    const session = async (name: string): Promise<string> => {
      const made = await worker.dispatchFetch(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
      const cookie = made.headers.get('set-cookie')?.split(';')[0] ?? ''
      assert.ok(cookie, 'a session cookie')
      await call('/api/life?city=lagos', undefined, cookie)
      return cookie
    }
    const account = async (name: string, address: string): Promise<string> => {
      const cookie = await session(name)
      const { csrf } = await call('/api/account', undefined, cookie)
      const idToken = await signToken(key, claimsFor(project, Date.now(), { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted }))
      const signedIn = await worker.dispatchFetch(origin + '/api/account/sign-in', { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body: JSON.stringify({ csrf, idToken }) })
      assert.equal(signedIn.status, 200)
      const accountCookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? cookie
      assert.equal((await call('/api/sharing/terms', { version: SHARING_TERMS_VERSION, over13: true }, accountCookie)).status, 200)
      return accountCookie
    }
    const op = (path: string, body: unknown) => call(path, body, undefined, { authorization: `Bearer ${operator}` })
    return { call, session, account, op }
  }

  const worker = await start(true)
  const { call, session, account, op } = kit(worker)
  const ada = await account('Adaeze', 'ada@example.test'), visitor = await session('Visitor')
  assert.equal((await call('/api/spaces/models?name=Chair', CHAIR, ada)).code, 'models_off')
  assert.equal((await op('/api/mod/spaces/switch', { models: true })).models, true)
  const mine = await call('/api/spaces/models', undefined, ada)
  assert.equal(mine.ready, true); assert.equal(mine.canUpload, true)

  const done = await call('/api/spaces/models?name=Chair', CHAIR, ada)
  assert.equal(done.code, 'uploaded', JSON.stringify(done))
  const hash = createHash('sha256').update(CHAIR).digest('hex')
  assert.equal(done.model.hash, hash)
  const stored = await (await worker.getR2Bucket('MODELS')).get(`glb/${hash}`)
  assert.ok(stored, 'the bytes are in R2 under their hash')
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), CHAIR)
  const file = await call(`/api/spaces/model-file/${hash}`, undefined, visitor)
  assert.equal(file.status, 200); assert.equal(file.type, 'model/gltf-binary'); assert.match(file.cache, /immutable/)
  assert.deepEqual(file.bytes, CHAIR)
  assert.equal((await call('/api/spaces/models?name=Bad', new TextEncoder().encode('not a model'), ada)).code, 'not_glb')
  assert.equal((await call('/api/spaces/models?name=Json', { a: 1 }, ada)).status, 415)

  // The script sandbox (phase 4) is served by the Worker with its own policy, under the name the page asks for.
  for (const path of ['/sandbox/space.html', '/sandbox/space.js']) {
    const answer = await worker.dispatchFetch(origin + path)
    assert.equal(answer.status, 200, path)
    assert.match(answer.headers.get('content-security-policy') ?? '', /connect-src 'none'/)
    assert.equal(answer.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.match(await answer.text(), path.endsWith('.js') ? /allow-scripts/ : /sandbox\/space\.js/)
  }

  const bare = kit(await start(false))
  const bob = await bare.account('Bob', 'bob@example.test')
  await bare.op('/api/mod/spaces/switch', { models: true })
  const none = await bare.call('/api/spaces/models', undefined, bob)
  assert.equal(none.ready, false); assert.equal(none.canUpload, false)
  assert.equal((await bare.call('/api/spaces/models?name=Chair', CHAIR, bob)).code, 'not_ready')
})
