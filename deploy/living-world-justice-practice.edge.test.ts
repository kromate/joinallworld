// Justice practice save integrity on the production Worker bundle in workerd with Durable Object SQLite (Miniflare):
// a practice written through the service, and one saved in the earlier non-canonical shape, survive host reopens.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { readValidatedJusticePracticeRecord } from '../server/living-world/justice-practice-service.ts'
import { journey, legacyStates } from '../server/living-world/justice-practice-legacy-rows.ts'
import type { InitialEvidenceId } from '../server/living-world/justice-practice-legacy-rows.ts'
import type { JusticePracticeAction } from '../src/game/living-world/justice-practice.ts'

interface SqliteStore { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<SqliteStore>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }
const ORIGIN = 'https://joinallworld.test'
const TOKEN = 'justice-practice-offline-fixture-token-0123456789'
const PATH = '/api/living-world/justice-practice'
const SCRIPT = 'joinallworld-justice-offline'
const AUTHORED = ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount']
const requestId = () => `${Date.now()}:${crypto.randomUUID()}`
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Reply = { ok?: boolean; code?: string; duplicate?: true; revision?: number | null; practice?: { phase: string; revision: number; reviewedEvidenceIds: string[]; trainingComplete: boolean } | null }
type Player = { cookie: string; id: string }
type Rows = Record<string, { practice: { inspectedEvidenceIds: string[]; receipts: unknown[] } } & Record<string, unknown>>

async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-justice-reopen-'))
  let worker: MiniflareInstance | null = null, address = 0
  t.after(async () => { try { await worker?.dispose() } finally { await rm(folder, { recursive: true, force: true }) } })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  async function start(): Promise<void> {
    await worker?.dispose()
    worker = new Miniflare({ ...convertV4MiniflareOptions({ name: SCRIPT, script, modules: true,
      compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'justice-offline-fixture', MODERATOR_TOKEN: TOKEN, FOUNDER_EMAIL_SHA256: '' },
      unsafeInspectDurableObjects: true, serviceBindings: { ASSETS: () => new Response('asset') } }),
      resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} })
    await worker.ready
  }
  const send = (path: string, init: RequestInit = {}) => {
    assert.ok(worker)
    const headers = new Headers(init.headers)
    headers.set('origin', ORIGIN)
    headers.set('cf-connecting-ip', `198.51.100.${1 + (address++ % 200)}`)
    return worker.dispatchFetch(ORIGIN + path, { ...init, headers })
  }
  const post = (path: string, body: object, cookie?: string) => send(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  async function player(name: string): Promise<Player> {
    const created = await post('/api/session', { name, onboarding: true })
    assert.equal(created.status, 200)
    const id = ((await created.json()) as { session: { id: string } }).session.id
    const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    assert.ok(cookie && id)
    const confirmed = await post('/api/action', { actionId: requestId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, cookie)
    assert.equal((await confirmed.json() as { code: string }).code, 'playing')
    return { cookie, id }
  }
  const get = async (who: Player): Promise<Reply> => await (await send(`${PATH}?city=lagos`, { headers: { cookie: who.cookie } })).json() as Reply
  const begin = async (who: Player): Promise<Reply> => await (await post(PATH + '/start', { cityId: 'lagos', requestId: requestId() }, who.cookie)).json() as Reply
  const step = async (who: Player, expectedRevision: number, action: JusticePracticeAction, id = requestId()): Promise<Reply> =>
    await (await post(PATH + '/step', { cityId: 'lagos', requestId: id, expectedRevision, action }, who.cookie)).json() as Reply
  async function storage(): Promise<SqliteStore> {
    assert.ok(worker)
    return await worker.unsafeGetDurableObjectStorage(SCRIPT, 'JoinAllworldState', { name: 'joinallworld-v1' })
  }
  async function rows(): Promise<Rows> {
    const found = await (await storage()).exec('SELECT value FROM collections WHERE name = ?', 'livingWorld')
    assert.equal(found.length, 1, 'the Worker persists the livingWorld collection in Durable Object SQLite')
    return (JSON.parse(String(found[0]!['value'])) as { justicePractice: Rows }).justicePractice
  }
  /** Install a practice in the earlier stored shape: a fixture of old data, applied while the host is up and then reopened. */
  async function seedEarlierShape(who: Player, practice: unknown): Promise<void> {
    const db = await storage()
    const found = await db.exec('SELECT value FROM collections WHERE name = ?', 'livingWorld')
    const collection = JSON.parse(String(found[0]!['value'])) as { justicePractice: Rows }
    collection.justicePractice[who.id]!.practice = practice as Rows[string]['practice']
    await db.exec('UPDATE collections SET value = ? WHERE name = ?', JSON.stringify(collection), 'livingWorld')
  }
  return { start, player, get, begin, step, rows, seedEarlierShape }
}

test('Worker SQLite: a practice written in a non-authored opening order and one saved in the earlier shape survive reopen', { timeout: 180_000 }, async t => {
  const h = await host(t)
  const order: InitialEvidenceId[] = ['seal-log', 'arrival-receipt', 'dispatch-copy']
  const earlierOrder: InitialEvidenceId[] = ['arrival-receipt', 'dispatch-copy', 'seal-log']
  const earlier = legacyStates(earlierOrder).at(-1)!
  assert.deepEqual(earlier.inspectedEvidenceIds, ['arrival-receipt', 'dispatch-copy'], 'the earlier shape is out of authored order')

  await h.start()
  const fresh = await h.player('Justice fresh'), old = await h.player('Justice earlier')
  assert.equal((await h.begin(fresh)).code, 'practice_started')
  assert.equal((await h.begin(old)).code, 'practice_started')
  let revision = 0
  const firstId = requestId()
  for (const [index, action] of journey(order).slice(0, 4).entries()) {
    const reply = await h.step(fresh, revision, action, index === 0 ? firstId : requestId())
    assert.equal(reply.ok, true, action.kind)
    revision = reply.revision!
  }
  await h.seedEarlierShape(old, earlier)

  await h.start()
  const afterFirst = await h.rows()
  const freshRow = afterFirst[fresh.id]!, earlierRow = afterFirst[old.id]!
  assert.deepEqual(freshRow.practice.inspectedEvidenceIds, ['dispatch-copy', 'arrival-receipt', 'seal-log'], 'written in authored order')
  assert.deepEqual(earlierRow.practice.inspectedEvidenceIds, earlier.inspectedEvidenceIds, 'the earlier shape is exactly as saved')
  assert.ok(readValidatedJusticePracticeRecord(freshRow, fresh.id))
  assert.ok(readValidatedJusticePracticeRecord(earlierRow, old.id), 'the strict reader accepts the earlier shape after the reopen')

  const freshRead = await h.get(fresh), earlierRead = await h.get(old)
  assert.deepEqual([freshRead.ok, freshRead.practice?.phase, freshRead.practice?.revision], [true, 'serve-notice', 4])
  assert.deepEqual([earlierRead.ok, earlierRead.practice?.phase, earlierRead.practice?.revision], [true, 'inspect-initial', 2])
  const replay = await h.step(fresh, 0, journey(order)[0]!, firstId)
  assert.deepEqual([replay.ok, replay.duplicate], [true, true], 'a request from before the reopen is answered from its saved receipt')
  assert.deepEqual(await h.rows(), afterFirst, 'reads and the replay after reopen do not rewrite either practice row')

  for (const [who, steps, from] of [[fresh, journey(order).slice(4), 4], [old, journey(earlierOrder).slice(2), earlier.revision]] as const) {
    let at: number = from
    for (const action of steps) {
      const reply = await h.step(who, at, action)
      assert.equal(reply.ok, true, `${who.id} ${action.kind}`)
      at = reply.revision!
    }
  }
  await h.start()
  const finished = await h.rows()
  for (const who of [fresh, old]) {
    const done = await h.get(who)
    assert.deepEqual([done.ok, done.code, done.practice?.trainingComplete, done.practice?.reviewedEvidenceIds], [true, 'practice_complete', true, AUTHORED])
    const row = finished[who.id]!
    assert.ok(readValidatedJusticePracticeRecord(row, who.id), 'the completed row is strictly readable after reopen')
    assert.deepEqual(row.practice.inspectedEvidenceIds, AUTHORED)
    assert.equal(row.practice.receipts.length, 7)
  }
  assert.deepEqual(await h.rows(), finished, 'reading the completed practice does not rewrite it')
})
