// Real production Worker bundle + Durable Object SQLite: trusted issuance then an OFF host reopen.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import type { DrivingResponse } from '../src/types/living-world.ts'

interface SqliteStore { exec(sql: string, ...values: (string | number)[]): Promise<Record<string, unknown>[]> }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>
  unsafeGetDurableObjectStorage(script: string, name: string, id: { name: string }): Promise<SqliteStore>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
const require = createRequire(resolve('deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }
const ORIGIN = 'https://joinallworld.test'
const TOKEN = 'driving-v2-offline-fixture-token-0123456789'
const DRIVE = '/api/living-world/driving'
const requestId = () => `${Date.now()}:${crypto.randomUUID()}`
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }

async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-driving-v2-reopen-'))
  let worker: MiniflareInstance | null = null, address = 0
  t.after(async () => { try { await worker?.dispose() } finally { await rm(folder, { recursive: true, force: true }) } })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname,], outfile: bundle, bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  async function start(reverseGearIssuance?: string): Promise<void> {
    await worker?.dispose()
    const bindings: Record<string, string> = { BUILD_ID: 'driving-v2-offline-fixture', MODERATOR_TOKEN: TOKEN, FOUNDER_EMAIL_SHA256: '' }
    if (reverseGearIssuance !== undefined) bindings['REVERSE_GEAR_ISSUANCE'] = reverseGearIssuance
    worker = new Miniflare({ ...convertV4MiniflareOptions({ name: 'joinallworld-driving-v2-offline', script, modules: true,
      compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), bindings, unsafeInspectDurableObjects: true, serviceBindings: { ASSETS: () => new Response('asset') } }),
      resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} })
    await worker.ready
  }
  const send = (path: string, init: RequestInit = {}) => {
    assert.ok(worker)
    const headers = new Headers(init.headers)
    if (!headers.has('origin')) headers.set('origin', ORIGIN)
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', `198.51.100.${1 + (address++ % 200)}`)
    return worker.dispatchFetch(ORIGIN + path, { ...init, headers })
  }
  const post = (path: string, body: object, cookie?: string) => send(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
  const get = (path: string, cookie: string) => send(path, { headers: { cookie } })
  async function player(name: string) {
    const created = await post('/api/session', { name, onboarding: true })
    assert.equal(created.status, 200)
    const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    assert.ok(cookie)
    const confirmed = await post('/api/action', { actionId: requestId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, cookie)
    assert.equal((await confirmed.json() as { code: string }).code, 'playing')
    return cookie
  }
  async function collection(): Promise<Record<string, unknown>> {
    assert.ok(worker)
    const db = await worker.unsafeGetDurableObjectStorage('joinallworld-driving-v2-offline', 'JoinAllworldState', { name: 'joinallworld-v1' })
    const rows = await db.exec('SELECT value FROM collections WHERE name = ?', 'livingWorld')
    assert.equal(rows.length, 1, 'production Worker persists the livingWorld collection in Durable Object SQLite')
    return JSON.parse(String(rows[0]!['value'])) as Record<string, unknown>
  }
  async function receipts(cookie: string): Promise<Record<string, unknown>[]> {
    assert.ok(worker)
    const db = await worker.unsafeGetDurableObjectStorage('joinallworld-driving-v2-offline', 'JoinAllworldState', { name: 'joinallworld-v1' })
    const secret = cookie.slice(cookie.indexOf('=') + 1)
    const sessions = await db.exec('SELECT public_id FROM sessions WHERE secret = ?', secret)
    assert.equal(sessions.length, 1)
    return await db.exec('SELECT id, at, kind, value FROM once_receipts WHERE sender = ? ORDER BY id', String(sessions[0]!['public_id']))
  }
  return { start, post, get, player, collection, receipts }
}

function savedRow(collection: Record<string, unknown>, journeyId: string): Record<string, unknown> {
  const driving = (collection['driving'] ?? {}) as Record<string, unknown>
  const row = Object.values(driving).find(value => typeof value === 'object' && value !== null && (value as { journeyId?: unknown }).journeyId === journeyId)
  assert.ok(row)
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>
}

test('actual Worker constructor enables only exact 1 and OFF SQLite reopen can retain, replay, read and write v2', async t => {
  const h = await host(t)
  for (const [name, binding] of [['Worker omitted', undefined], ['Worker zero', '0'], ['Worker string true', 'true'], ['Worker whitespace', ' ']] as const) {
    await h.start(binding)
    const oldClient = await h.player(name)
    const oldStart = await (await h.post(DRIVE + '/start', { cityId: 'lagos', requestId: requestId() }, oldClient)).json() as DrivingResponse
    assert.ok(oldStart.ok && oldStart.session)
    assert.equal(oldStart.reverseGearControls, undefined, `${JSON.stringify(binding)} must leave trusted issuance OFF`)
    const rejected = await (await h.post(DRIVE + '/input', { cityId: 'lagos', journeyId: oldStart.session!.journeyId, sequence: 1,
      frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'reverse' }] }, oldClient)).json() as DrivingResponse
    assert.deepEqual([rejected.code, rejected.session?.revision, rejected.session?.nextSequence, rejected.reverseGearControls], ['reverse_gear_disabled', 1, 1, undefined])
    assert.equal(savedRow(await h.collection(), oldStart.session!.journeyId)['v'], 1, 'a nonliteral binding cannot create a v2 row')
  }

  await h.start('1')
  const ada = await h.player('Worker v2 Ada')
  const started = await (await h.post(DRIVE + '/start', { cityId: 'lagos', requestId: requestId() }, ada)).json() as DrivingResponse
  assert.ok(started.ok && started.session)
  assert.equal(started.reverseGearControls, true)
  await delay(250)
  const packet = { cityId: 'lagos', journeyId: started.session!.journeyId, sequence: started.session!.nextSequence,
    frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'reverse' }] }
  const accepted = await (await h.post(DRIVE + '/input', packet, ada)).json() as DrivingResponse
  assert.ok(accepted.ok && accepted.session)
  assert.equal(accepted.session!.state.gear, 'reverse')
  const issuedRow = savedRow(await h.collection(), accepted.session!.journeyId)
  assert.equal(issuedRow['v'], 2)
  assert.equal((issuedRow['lastPacket'] as { sequence: number }).sequence, 1)
  const issuedReceipts = await h.receipts(ada)

  // The first driving request after the actual OFF SQLite reopen is the retained exact packet.
  await delay(1_600)
  await h.start(undefined)
  const coldReplay = await (await h.post(DRIVE + '/input', packet, ada)).json() as DrivingResponse
  assert.deepEqual([coldReplay.ok, coldReplay.code, coldReplay.duplicate, coldReplay.reverseGearControls], [true, 'controls_accepted', true, undefined])
  assert.deepEqual(savedRow(await h.collection(), accepted.session!.journeyId), issuedRow, 'the first POST after OFF reopen replays before timeout writes and preserves the entire SQLite driving row')
  assert.deepEqual(await h.receipts(ada), issuedReceipts, 'the exact packet replay preserves the original SQLite receipt set')
  const current = await (await h.get(DRIVE + '?city=lagos', ada)).json() as DrivingResponse
  assert.ok(current.ok && current.session)
  assert.equal(current.session!.state.status, 'paused')
  assert.equal(current.reverseGearControls, undefined)
  const afterRead = savedRow(await h.collection(), accepted.session!.journeyId)
  assert.equal(afterRead['v'], 2)
  assert.equal((afterRead['state'] as { gear?: string }).gear, 'forward')

  const resumeRequest = { cityId: 'lagos', journeyId: accepted.session!.journeyId, revision: current.session!.revision, requestId: requestId() }
  const resumed = await (await h.post(DRIVE + '/resume', resumeRequest, ada)).json() as DrivingResponse
  assert.ok(resumed.ok && resumed.session?.state.status === 'running')
  assert.equal(resumed.reverseGearControls, undefined)
  const resumeRow = savedRow(await h.collection(), resumed.session!.journeyId)
  const resumeReceipts = await h.receipts(ada)
  const resumeRetry = await (await h.post(DRIVE + '/resume', resumeRequest, ada)).json() as DrivingResponse
  assert.deepEqual([resumeRetry.ok, resumeRetry.duplicate, resumeRetry.session?.revision, resumeRetry.reverseGearControls], [true, true, resumed.session!.revision, undefined])
  assert.deepEqual(savedRow(await h.collection(), resumed.session!.journeyId), resumeRow)
  assert.deepEqual(await h.receipts(ada), resumeReceipts, 'the SQLite once receipt remains unique and canonical on an OFF lifecycle retry')
  await delay(250)
  const legacyPacket = { cityId: 'lagos', journeyId: resumed.session!.journeyId, sequence: resumed.session!.nextSequence, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const legacyWrite = await (await h.post(DRIVE + '/input', legacyPacket, ada)).json() as DrivingResponse
  assert.ok(legacyWrite.ok && legacyWrite.session)
  assert.equal(legacyWrite.reverseGearControls, undefined)
  const afterLegacy = savedRow(await h.collection(), legacyWrite.session!.journeyId)
  assert.equal(afterLegacy['v'], 2, 'an OFF old-client three-field frame writes without downgrading the validated v2 row')
  assert.equal(afterLegacy['nextSequence'], 3)
  const explicitPacket = { cityId: 'lagos', journeyId: legacyWrite.session!.journeyId, sequence: 3, frames: [{ throttle: 0, brake: 0, steer: 0, gear: 'reverse' }] }
  const refusedBefore = afterLegacy
  const explicitRefusal = await (await h.post(DRIVE + '/input', explicitPacket, ada)).json() as DrivingResponse
  assert.deepEqual([explicitRefusal.code, explicitRefusal.session?.revision, explicitRefusal.session?.nextSequence, explicitRefusal.reverseGearControls],
    ['reverse_gear_disabled', legacyWrite.session!.revision, 3, undefined])
  assert.deepEqual(savedRow(await h.collection(), legacyWrite.session!.journeyId), refusedBefore, 'OFF explicit gear refusal preserves every persisted driving field')

  const beforeSecondReopen = savedRow(await h.collection(), legacyWrite.session!.journeyId)
  const receiptsBeforeSecondReopen = await h.receipts(ada)
  await h.start(undefined)
  const lifecycleReplay = await (await h.post(DRIVE + '/resume', resumeRequest, ada)).json() as DrivingResponse
  assert.deepEqual([lifecycleReplay.ok, lifecycleReplay.duplicate, lifecycleReplay.reverseGearControls], [true, true, undefined], 'the exact previously accepted resume is the first driving request after the second OFF SQLite reopen')
  assert.deepEqual(savedRow(await h.collection(), legacyWrite.session!.journeyId), beforeSecondReopen, 'cold OFF lifecycle replay preserves the entire current SQLite driving row')
  assert.deepEqual(await h.receipts(ada), receiptsBeforeSecondReopen, 'cold OFF lifecycle replay adds or rewrites no SQLite once receipts')
})
