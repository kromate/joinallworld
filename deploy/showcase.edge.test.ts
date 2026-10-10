// OWNER: showcase — showcase shops on the Worker host: the same journey as the Node tests (server/showcase.test.ts) through the
// Durable Object and its SQLite store, run in Miniflare (the real Worker code and a real SQLite, not a stand-in): a seller from
// signing in to an approved shop with photos, a buyer's contact release, the photo table apart from chat pictures, a full
// store that refuses instead of deleting, a restart that keeps everything, and an account delete that leaves nothing.
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
import { JOURNEY_TIME } from '../server/testing/cityJourney.ts'
import { jpeg, shopBody, toBase64 } from '../server/testing/showcasePictures.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'
import { layoutBindings } from '../server/testing/sqliteStorage.ts'
import { SHOWCASE } from '../src/types/showcase.ts'

await loadCityContent('lagos')

type Json = Record<string, any>
interface StoredObject { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, options?: RequestInit): Promise<Response>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<StoredObject>
}
interface Tooling { Miniflare: new (options: Record<string, unknown>) => WorkerHost; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface Bundler { build(options: { stdin: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' }; outfile: string; bundle: true; format: 'esm'; platform: 'neutral'; external: string[] }): Promise<unknown> }
const tooling = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = tooling('miniflare') as Tooling
const { build } = tooling('esbuild') as Bundler

const DAY = 86400000
function deadline<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 30000) })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

test('Worker: a showcase shop from sign-in to approval, the contact release, a full store, a restart and an account delete', { timeout: 180000 }, async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'showcase-worker-'))
  const bundle = join(folder, 'worker.mjs')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const project = 'allworld-showcase-worker-test', founder = 'showcase-founder@example.test', origin = 'https://showcase.test', operator = 'operator-token-for-edge-tests-0123456789'
  const key = await makeKey('showcase-worker')
  const seed = '__SHOWCASE_TEST_CLOCK_SEED__'
  // This entry exists only in the generated test bundle: the clock is the test's, and a test-only route moves it forward.
  await build({
    stdin: {
      contents: `
        let showcaseNow = Number('${seed}');
        Date.now = () => showcaseNow;
        const host = await import('./deploy/cloudflare-worker.ts');
        export const JoinAllworldState = host.JoinAllworldState;
        export default {
          async fetch(request, env, context) {
            const path = new URL(request.url).pathname;
            if (path === '/__showcase-test/clock') {
              if (request.method === 'POST') showcaseNow += Number((await request.json()).ms);
              return Response.json({ now: showcaseNow });
            }
            return host.default.fetch(request, env, context);
          },
        };
      `,
      resolveDir: root, sourcefile: 'showcase-test-worker.ts', loader: 'ts',
    },
    outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'],
  })
  const template = await readFile(bundle, 'utf8')
  const options = {
    name: 'showcase', modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
    bindings: { ...layoutBindings(), BUILD_ID: 'local-showcase', ACCOUNTS_FIREBASE_PROJECT_ID: project, MODERATOR_TOKEN: operator, SHOWCASE_IMAGES_MAX_MB: '0.2',
      ACCOUNTS_FIREBASE_API_KEY: 'showcase-edge-key-0000000000000000000000000', FOUNDER_EMAIL_SHA256: createHash('sha256').update(founder).digest('hex') },
    outboundService: async (request: Request): Promise<Response> => {
      if (request.url.split('?')[0] === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } })
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }
  let now = JOURNEY_TIME
  const create = (): WorkerHost => new Miniflare({ ...convertV4MiniflareOptions({ ...options, script: template.replace(seed, String(now)) }), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
  let worker = create()
  t.after(async () => { await deadline(worker.dispose(), 'Worker disposal').catch(() => {}); await rm(folder, { recursive: true, force: true }) })
  await deadline(worker.ready, 'Worker startup')
  const storage = () => worker.unsafeGetDurableObjectStorage('showcase', 'JoinAllworldState', { name: 'joinallworld-v1' })
  const count = async (table: string): Promise<number> => Number((await (await storage()).exec(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n)
  const advance = async (ms: number): Promise<void> => {
    const answer = await worker.dispatchFetch(origin + '/__showcase-test/clock', { method: 'POST', body: JSON.stringify({ ms }) })
    now = ((await answer.json()) as Json).now
  }
  const call = async (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Json> => {
    const response = await worker.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const type = response.headers.get('content-type') ?? ''
    return type.includes('json') ? { status: response.status, ...(await response.json() as object) } : { status: response.status, type, bytes: new Uint8Array(await response.arrayBuffer()) }
  }
  let minted = 0, counter = 0
  const id = (): string => `${now}:00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
  interface Person { cookie: string; id: string }
  async function person(name: string, address: string): Promise<Person> {
    const made = await worker.dispatchFetch(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) })
    let cookie = made.headers.get('set-cookie')?.split(';')[0] ?? ''
    assert.ok(cookie, 'a session cookie')
    await call('/api/life?city=lagos', undefined, cookie)
    const { csrf } = await call('/api/account', undefined, cookie)
    const idToken = await signToken(key, claimsFor(project, now, { subject: `Uid${address.replace(/\W/g, '')}`, email: address, n: ++minted }))
    const signedIn = await worker.dispatchFetch(origin + '/api/account/sign-in', { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie }, body: JSON.stringify({ csrf, idToken }) })
    assert.equal(signedIn.status, 200)
    cookie = signedIn.headers.get('set-cookie')?.split(';')[0] ?? cookie
    const session = (await call('/api/session', undefined, cookie)).session
    return { cookie, id: String(session.id) }
  }
  const adult = async (p: Person): Promise<void> => { assert.equal((await call('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, p.cookie)).ok, true) }
  const boss = await person('Founder', founder)
  const op = (path: string, body?: unknown) => call(`/api/mod/showcase${path}`, body, undefined, { authorization: `Bearer ${operator}` })
  const post = (p: Person, path: string, body: Json = {}) => call(path, { clientId: id(), ...body }, p.cookie)
  const save = (p: Person, over: Json = {}, revision = 0) => call('/api/showcase/mine', { clientId: id(), expectedRevision: revision, ...shopBody(over) }, p.cookie)
  const upload = (p: Person, bytes: Uint8Array) => call('/api/showcase/mine/photos', { clientId: id(), type: 'image/jpeg', data: toBase64(bytes) }, p.cookie)

  // The seller: an account, an adult, phone checked, a day old.
  const ada = await person('Adaeze', 'ada@example.test'), bola = await person('Bolanle', 'bola@example.test'), guest = await worker.dispatchFetch(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Visitor' }) })
  await adult(ada); await adult(bola)
  assert.equal((await save(ada)).error, 'verification_required')
  assert.equal((await call(`/api/admin/trust/players/${ada.id}/act`, { clientId: id(), action: 'verify', tier: 'phone', reason: 'met in person' }, boss.cookie)).ok, true)
  assert.equal((await save(ada)).error, 'account_too_new')
  await advance(DAY + 1000)
  const made = await save(ada)
  assert.deepEqual([made.ok, made.code], [true, 'created'])
  const shop = made.id as string
  assert.equal((await save(ada, { chat: { url: 'https://evil.example/x' } }, 1)).error, 'chat_link_not_allowed')
  assert.equal((await save(ada, { about: 'call me on 08012345678' }, 1)).error, 'contact_not_allowed')

  // Photos: three small ones, a rewritten copy with no metadata, kept in the table of their own.
  const first = await upload(ada, jpeg(2000, { exif: true })); assert.equal(first.ok, true)
  assert.ok(!Buffer.from((await call(`/api/showcase/photo/${first.photo}`, undefined, ada.cookie)).bytes).includes(Buffer.from('Exif')))
  for (let i = 0; i < 2; i += 1) assert.equal((await upload(ada, jpeg(2100 + i))).ok, true)
  assert.equal(await count('showcase_images'), 3); assert.equal(await count('chat_images'), 0, 'chat pictures are in another table')
  assert.equal((await call(`/api/social/images/${first.photo}`, undefined, ada.cookie)).status, 404, 'the chat route does not serve them')
  assert.equal((await call(`/api/showcase/photo/${first.photo}`, undefined, bola.cookie)).status, 404, 'not public before approval')
  // A full store refuses a new photo and keeps the old ones (the ceiling here is 0.2 MB).
  const big = await upload(ada, jpeg(145000)); assert.equal(big.ok, true)
  const refused = await upload(ada, jpeg(145000))
  assert.deepEqual([refused.status, refused.error], [503, 'picture_store_full'])
  assert.equal(await count('showcase_images'), 4)
  assert.equal((await post(ada, '/api/showcase/mine/photos/remove', { photo: big.photo })).code, 'photo_removed')
  assert.equal(await count('showcase_images'), 3)

  // Review and approval by an operator.
  assert.equal((await post(ada, '/api/showcase/mine/submit')).status, 'review')
  assert.equal((await call(`/api/showcase/${shop}`)).error, 'shop_unavailable')
  assert.equal((await call('/api/mod/showcase')).status, 401)
  assert.deepEqual((await op('')).queue.map((item: Json) => item.id), [shop])
  assert.equal((await op('', { action: 'approve', shop })).status, 'live')

  // Browsing: no link anywhere; the buyer gets one only by going.
  const directory = await call('/api/showcase/directory?city=lagos&q=braids')
  assert.equal(directory.shops.length, 1)
  const page = await call(`/api/showcase/${shop}`)
  assert.ok(!/wa\.me|paystack|https?:/i.test(JSON.stringify([directory, page])))
  assert.equal((await call(`/api/showcase/photo/${page.shop.photos[0].id}`)).status, 200, 'public after approval')
  const visitor = guest.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.equal((await post({ cookie: visitor, id: '' }, `/api/showcase/${shop}/go`, { kind: 'chat' })).error, 'account_required')
  const clientId = id()
  const go = await call(`/api/showcase/${shop}/go`, { clientId, kind: 'chat' }, bola.cookie)
  assert.deepEqual([go.status, go.link.url, go.requiresWarning], [200, 'https://wa.me/2348012345678', true])
  assert.equal((await call(`/api/showcase/${shop}/go`, { clientId, kind: 'chat' }, bola.cookie)).duplicate, true)
  assert.equal(await count('once_receipts') > 0, true)
  for (let i = 0; i < SHOWCASE.goPerDay - 1; i += 1) assert.equal((await post(bola, `/api/showcase/${shop}/go`, { kind: 'pay' })).status, 200)
  assert.equal((await post(bola, `/api/showcase/${shop}/go`, { kind: 'pay' })).error, 'go_limit')

  // Two distinct reports hide one photo.
  const cara = await person('Chiamaka', 'cara@example.test')
  const photo = page.shop.photos[1].id as string
  assert.equal((await post(bola, `/api/showcase/${shop}/report`, { reason: 'scam', photo })).ok, true)
  assert.equal((await post(cara, `/api/showcase/${shop}/report`, { reason: 'scam', photo })).hidden, true)
  assert.equal((await call(`/api/showcase/photo/${photo}`)).status, 404)

  // A restart keeps the shop, the photos and the contact events.
  await deadline(worker.dispose(), 'Worker disposal')
  worker = create()
  await deadline(worker.ready, 'Worker restart')
  const again = await call(`/api/showcase/${shop}`)
  assert.equal(again.shop.name, 'Ada Braids'); assert.equal(again.shop.photos.length, 2, 'the hidden photo stays hidden')
  assert.equal((await call(`/api/showcase/photo/${page.shop.photos[0].id}`)).status, 200)
  assert.equal((await call('/api/showcase/directory')).shops.length, 1)
  assert.equal(await count('showcase_images'), 3)
  assert.equal((await post(bola, `/api/showcase/${shop}/go`, { kind: 'pay' })).error, 'go_limit', 'the day\'s count survived the restart')

  // Deleting the seller's account removes the shop and every photo row.
  const csrf = (await call('/api/account', undefined, ada.cookie)).csrf
  const idToken = await signToken(key, claimsFor(project, now, { subject: 'Uidadaexampletest', email: 'ada@example.test', n: ++minted }))
  const exported = await call('/api/account/export', { idToken, csrf }, ada.cookie)
  assert.equal(exported.showcase.shops.length, 1)
  const deleteToken = await signToken(key, claimsFor(project, now, { subject: 'Uidadaexampletest', email: 'ada@example.test', n: ++minted }))
  assert.equal((await call('/api/account/delete', { idToken: deleteToken, csrf, confirm: 'delete', erase: true }, ada.cookie)).status, 200)
  assert.equal(await count('showcase_images'), 0, 'the photo rows are gone')
  assert.equal((await call('/api/showcase/directory')).shops.length, 0)
  assert.equal((await call(`/api/showcase/${shop}`)).error, 'shop_unavailable')
})
