// Real Worker rental-permission persistence: actual course controls, qualification evidence, and no allocated car.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import type { DrivingResponse, QualificationResponse, StarterRentalResponse } from '../src/types/living-world.ts'
import type { DrivingPoint } from '../src/game/living-world/driving.ts'
import { PRACTICE_COURSE } from '../src/game/living-world/course.ts'

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

interface Player { id: string; name: string; cookie: string }
interface Wallet { cash: number; ledger: unknown }
const ORIGIN = 'https://joinallworld.test'
const TOKEN = 'rental-worker-test-token-0123456789'
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const DRIVE = '/api/living-world/driving', QUALIFICATION = '/api/living-world/qualification', RENTAL = '/api/living-world/rental'
const requestId = () => `${Date.now()}:${crypto.randomUUID()}`
const road = PRACTICE_COURSE.roads[0]!
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

/** A Worker host backed by one temporary SQLite folder; every response is tracked for cleanup. */
async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-rental-'))
  let worker: MiniflareInstance | null = null, address = 0
  const responses: Response[] = []
  const outbound: string[] = []
  t.after(async () => {
    for (const response of responses.splice(0)) {
      if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {})
    }
    try { await worker?.dispose() } finally { await rm(folder, { recursive: true, force: true }) }
  })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle,
    bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  const send = (path: string, init: RequestInit): Promise<Response> => {
    assert.ok(worker)
    const pending = worker.dispatchFetch(ORIGIN + path, init)
    return pending.then(response => { responses.push(response); return response })
  }
  async function start(bindings: Record<string, string> = {}): Promise<void> {
    await worker?.dispose()
    worker = new Miniflare({ ...convertV4MiniflareOptions({ name: 'joinallworld-rental', script, modules: true,
      compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'rental-fixture', STORE_LAYOUT: 'legacy',
        MODERATOR_TOKEN: TOKEN, FOUNDER_EMAIL_SHA256: '', ...bindings },
      outboundService: (request: Request) => { outbound.push(new URL(request.url).origin); return new Response('fixture outbound disabled', { status: 503 }) }, serviceBindings: { ASSETS: () => new Response('asset') } }),
      resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
    await worker.ready
  }
  const post = (path: string, body: object, player?: Player) => send(path, { method: 'POST', headers: {
    origin: ORIGIN, 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${1 + address++ % 200}`,
    ...(player ? { cookie: player.cookie } : {}) }, body: JSON.stringify(body) })
  const get = (path: string, player: Player) => send(path, { headers: { origin: ORIGIN, cookie: player.cookie,
    'cf-connecting-ip': `198.51.100.${1 + address++ % 200}` } })
  const operator = async (path: string, body?: object): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await send(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`,
      'cf-connecting-ip': '203.0.113.19', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, json: await response.json() as Record<string, unknown> }
  }
  async function createPlayer(name: string): Promise<Player> {
    const created = await post('/api/session', { name, onboarding: true })
    assert.equal(created.status, 200)
    const saved = await created.json() as { session: { id: string; name: string } }
    const player = { ...saved.session, cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '' }
    assert.ok(player.id && player.cookie)
    const confirmed = await post('/api/action', { actionId: requestId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, player)
    assert.equal((await confirmed.json() as { code: string }).code, 'playing')
    await (await get('/api/life?city=lagos', player)).arrayBuffer()
    return player
  }
  const storage = () => {
    assert.ok(worker)
    return worker.unsafeGetDurableObjectStorage('joinallworld-rental', 'JoinAllworldState', { name: 'joinallworld-v1' })
  }
  async function setZeroCashFixture(player: Player): Promise<void> {
    // Isolated SQLite fixture setup only: the real Worker course and permission endpoints remain authoritative.
    const db = await storage(), secret = player.cookie.slice(player.cookie.indexOf('=') + 1)
    const rows = await db.exec('SELECT value FROM sessions WHERE secret = ?', secret)
    assert.equal(rows.length, 1)
    const session = JSON.parse(String(rows[0]!.value)) as { cities: Record<string, { state: { cash: number } }> }
    session.cities['lagos']!.state.cash = 0
    await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret)
  }
  const wallet = async (player: Player): Promise<Wallet> => {
    const response = await get('/api/life?city=lagos', player)
    assert.equal(response.status, 200)
    const body = await response.json() as { state: { cash: number; ledger: unknown } }
    return { cash: body.state.cash, ledger: body.state.ledger }
  }
  return { start, post, get, operator, createPlayer, storage, setZeroCashFixture, wallet, outbound }
}

function projection(point: DrivingPoint): number {
  let distance = Infinity, progress = 0, total = 0
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
    const fraction = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length), 0, 1)
    const separation = Math.hypot(point.x - a.x - dx * fraction, point.z - a.z - dz * fraction)
    if (separation < distance) { distance = separation; progress = total + length * fraction }
    total += length
  }
  return progress
}
function pointAt(progress: number): DrivingPoint {
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, length = Math.hypot(b.x - a.x, b.z - a.z)
    if (progress <= length) return { x: a.x + (b.x - a.x) * progress / length, z: a.z + (b.z - a.z) * progress / length }
    progress -= length
  }
  return road[road.length - 1]!
}

test('Worker derives a non-allocating starter permission from a retained pass across SQLite restarts and layouts', { timeout: 90_000 }, async t => {
  const h = await host(t)
  await h.start()
  const ada = await h.createPlayer('Rental Ada'), bola = await h.createPlayer('Rental Bola')
  await h.setZeroCashFixture(ada)
  const walletBefore = await h.wallet(ada)
  assert.equal(walletBefore.cash, 0, 'zero balance is a fixture; the production endpoints do not fund or debit it')

  const startResponse = await h.post(DRIVE + '/start', { cityId: 'lagos', requestId: requestId() }, ada)
  assert.equal(startResponse.status, 200)
  let answer = await startResponse.json() as DrivingResponse
  assert.ok(answer.ok && answer.session)
  const earlyRental = await (await h.post(RENTAL + '/claim', { cityId: 'lagos', requestId: requestId(),
    qualificationJourneyId: answer.session.journeyId, qualificationVersion: 1 }, ada)).json() as StarterRentalResponse
  assert.deepEqual([earlyRental.ok, earlyRental.code, earlyRental.permission], [false, 'qualification_required', null])

  let packets = 0
  while (answer.session!.state.status === 'running' && packets < 500) {
    const state = answer.session!.state
    const target = pointAt(projection(state.position) + 3.5)
    const targetHeading = Math.atan2(target.x - state.position.x, target.z - state.position.z)
    const headingError = Math.atan2(Math.sin(targetHeading - state.heading), Math.cos(targetHeading - state.heading))
    const steer = clamp(Math.atan2(2 * 2.6 * Math.sin(headingError), 3.5) / 0.62, -1, 1)
    const checkpoint = PRACTICE_COURSE.checkpoints[state.checkpointIndex]!
    const stopping = checkpoint.stopRequired && Math.hypot(state.position.x - checkpoint.center.x, state.position.z - checkpoint.center.z) <= checkpoint.radius - 0.2 + state.speed * state.speed / 16
    const control = { throttle: stopping ? 0 : state.speed < 3 ? 1 : 0, brake: stopping || state.speed > 3.3 ? 1 : 0, steer }
    await delay(125) // Real Worker elapsed time is credited only to this actual bounded control packet.
    const response = await h.post(DRIVE + '/input', { cityId: 'lagos', journeyId: answer.session!.journeyId,
      sequence: answer.session!.nextSequence, frames: [control] }, ada)
    assert.equal(response.status, 200)
    answer = await response.json() as DrivingResponse
    assert.equal(answer.ok, true, `Worker driving packet ${packets}: ${answer.code}`)
    packets++
  }
  assert.deepEqual([answer.session?.state.status, answer.session?.state.assessment], ['complete', 'passed'], 'pass evidence came from real public HTTP controls')
  assert.ok(packets > 0 && packets <= 500)
  const journeyId = answer.session!.journeyId
  const qualificationClaim = await (await h.post(QUALIFICATION + '/claim', { cityId: 'lagos', requestId: requestId(), journeyId }, ada)).json() as QualificationResponse
  assert.ok(qualificationClaim.ok && qualificationClaim.valid && qualificationClaim.qualification)

  const foreign = await (await h.post(RENTAL + '/claim', { cityId: 'lagos', requestId: requestId(),
    qualificationJourneyId: journeyId, qualificationVersion: qualificationClaim.qualification.version }, bola)).json() as StarterRentalResponse
  assert.deepEqual([foreign.ok, foreign.code, foreign.permission], [false, 'qualification_required', null], 'a second guest cannot borrow from Ada’s pass')

  const requestA = { cityId: 'lagos', requestId: requestId(), qualificationJourneyId: journeyId, qualificationVersion: qualificationClaim.qualification.version }
  const requestB = { ...requestA, requestId: requestId() }
  const replies = await Promise.all([requestA, requestB].map(async body => {
    const response = await h.post(RENTAL + '/claim', body, ada)
    assert.equal(response.status, 200)
    return await response.json() as StarterRentalResponse
  }))
  assert.equal(replies.filter(reply => reply.code === 'permission_issued').length, 1, 'distinct concurrent IDs create one immutable permission')
  assert.ok(replies.every(reply => reply.ok && reply.valid && reply.permission?.resourceId === 'marina-starter-sedan'))
  assert.ok(replies.every(reply => reply.tripAvailable === false && reply.allocation === 'none'))
  assert.equal(replies[0]!.permission!.issuedAt, replies[1]!.permission!.issuedAt)
  const winner = replies[0]!.code === 'permission_issued' ? requestA : requestB
  const retried = await (await h.post(RENTAL + '/claim', winner, ada)).json() as StarterRentalResponse
  assert.deepEqual([retried.ok, retried.valid, retried.duplicate, retried.permission], [true, true, true, replies[0]!.permission])
  const newId = await (await h.post(RENTAL + '/claim', { ...winner, requestId: requestId() }, ada)).json() as StarterRentalResponse
  assert.deepEqual([newId.ok, newId.code, newId.valid, newId.permission], [true, 'permission_retained', true, replies[0]!.permission])
  const walletAfter = await h.wallet(ada)
  assert.deepEqual(walletAfter, walletBefore, 'neither the pass, qualification nor permission changes zero cash or its ledger')

  const savedPermission = replies[0]!.permission
  const current = async () => {
    const response = await h.get(RENTAL + '?city=lagos', ada)
    assert.equal(response.status, 200)
    return await response.json() as StarterRentalResponse
  }
  assert.deepEqual(await current().then(reply => [reply.ok, reply.valid, reply.permission, reply.tripAvailable, reply.allocation]),
    [true, true, savedPermission, false, 'none'])
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'shadow' })).status, 200)
  await h.start({ STORE_LAYOUT: 'legacy' })
  const shadowStatus = await h.operator('/api/mod/store')
  assert.equal(shadowStatus.status, 200)
  assert.equal(shadowStatus.json['requested'], 'shadow')
  const compared = await h.operator('/api/mod/store/compare')
  assert.equal(compared.status, 200)
  assert.equal((compared.json['collections'] as Record<string, { equal: boolean }>).livingWorld?.equal, true)
  assert.deepEqual(await current().then(reply => [reply.ok, reply.valid, reply.permission]), [true, true, savedPermission])

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start({ STORE_LAYOUT: 'legacy' })
  const entriesStatus = await h.operator('/api/mod/store')
  assert.equal(entriesStatus.status, 200)
  assert.equal(entriesStatus.json['requested'], 'entries')
  assert.deepEqual(await current().then(reply => [reply.ok, reply.valid, reply.permission]), [true, true, savedPermission])

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start()
  assert.deepEqual(await current().then(reply => [reply.ok, reply.valid, reply.permission]), [true, true, savedPermission])
  const receiptRetry = await (await h.post(RENTAL + '/claim', winner, ada)).json() as StarterRentalResponse
  assert.deepEqual([receiptRetry.ok, receiptRetry.valid, receiptRetry.duplicate, receiptRetry.permission], [true, true, true, savedPermission], 'the same claim receipt remains canonical after restart and layout reversal')
  assert.deepEqual(await h.wallet(ada), walletBefore)
  assert.deepEqual(h.outbound, [], 'the fixture never contacts real providers')
})
