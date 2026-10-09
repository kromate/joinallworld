// Real Worker/SQLite restart checks for two bounded learning exercises.
// The education fixture seeds only campus starting position and level-one eligibility;
// admission, registration, lab operations, completion, and mark settlement use production APIs.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { AssessmentResponse } from '../src/types/living-world-assessment.ts'
import type { JusticePracticeResponse } from '../src/types/living-world-justice.ts'
import { PROGRAMMES, UNILAG_BETA_RULES } from '../src/campus/unilag/curriculum.ts'

interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>
  unsafeGetDurableObjectStorage(script: string, className: string, id: { name: string }): Promise<ObjectStorage>
}
interface ObjectStorage {
  exec(query: string, ...bindings: (string | number | null)[]): Promise<Array<{ value?: string }>>
}
interface WorkerTools {
  Miniflare: new (options: Record<string, unknown>) => WorkerHost
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
}
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as WorkerTools
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }
const origin = 'https://joinallworld.test'
const operatorToken = 'learning-edge-fixture-token-0123456789' // Synthetic local operator binding, never a provider credential.
const justicePath = '/api/living-world/justice-practice'
const assessmentPath = '/api/living-world/assessment'
const newId = () => `${Date.now()}:${crypto.randomUUID()}`
const look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }

interface Device { id: string; name: string; cookie: string }
interface JsonResponse { status: number; headers: Headers; json: Record<string, unknown> }

async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-learning-'))
  let worker: WorkerHost | null = null, address = 0
  const outbound: string[] = []
  t.after(async () => {
    try { await worker?.dispose() }
    finally { await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
  })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  async function start(layout = 'legacy'): Promise<void> {
    await worker?.dispose()
    worker = new Miniflare({ ...convertV4MiniflareOptions({ name: 'joinallworld-learning', script, modules: true,
      compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'learning-fixture', STORE_LAYOUT: layout,
        MODERATOR_TOKEN: operatorToken, FOUNDER_EMAIL_SHA256: '' },
      outboundService: (request: Request) => { outbound.push(new URL(request.url).origin); return new Response('fixture outbound disabled', { status: 503 }) },
      serviceBindings: { ASSETS: () => new Response('asset') } }), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} })
    await worker.ready
  }
  async function request(path: string, cookie = '', body?: object, operator = false): Promise<JsonResponse> {
    assert.ok(worker)
    const response = await worker.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
      origin, 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`,
      ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      ...(operator ? { authorization: `Bearer ${operatorToken}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) })
    try { return { status: response.status, headers: response.headers, json: await response.json() as Record<string, unknown> } }
    catch (error) { await response.body?.cancel().catch(() => {}); throw error }
    finally { if (!response.bodyUsed) await response.body?.cancel().catch(() => {}) }
  }
  const post = (path: string, body: object, who: Device) => request(path, who.cookie, body)
  const get = (path: string, who: Device) => request(path, who.cookie)
  const operator = (path: string, body?: object) => request(path, '', body, true)
  async function player(name: string): Promise<Device> {
    const created = await request('/api/session', '', { name, onboarding: true })
    assert.equal(created.status, 200)
    const session = created.json['session'] as { id?: string; name?: string } | undefined
    const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    assert.ok(cookie && session?.id)
    const device = { id: session.id, name: session.name ?? name, cookie }
    await get('/api/life?city=lagos', device)
    const confirmed = await post('/api/action', { actionId: newId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look } }, device)
    assert.equal(confirmed.status, 200)
    assert.equal(confirmed.json['code'], 'playing')
    return device
  }
  async function action(who: Device, type: string, payload: object = {}): Promise<JsonResponse> {
    return post('/api/action', { actionId: newId(), cityId: 'lagos', type, payload }, who)
  }
  async function seedCampusEligibility(who: Device): Promise<void> {
    const storage = await worker!.unsafeGetDurableObjectStorage('joinallworld-learning', 'JoinAllworldState', { name: 'joinallworld-v1' })
    const secret = who.cookie.slice(who.cookie.indexOf('=') + 1)
    const rows = await storage.exec('SELECT value FROM sessions WHERE secret = ?', secret)
    assert.equal(rows.length, 1)
    assert.equal(typeof rows[0]?.value, 'string')
    const session = JSON.parse(rows[0]!.value!) as {
      cities?: Record<string, { state?: { location?: string; spot?: string; skills?: Record<string, number>; activeAction?: unknown } }>
    }
    const life = session.cities?.['lagos']?.state
    assert.ok(life?.skills)
    // Fixture-only starting point: level one needs 100 XP. Do not seed enrollment, attempts, practice, or marks.
    life.location = 'unilag'
    life.spot = 'senate'
    life.skills.coding = Math.max(life.skills.coding ?? 0, 100)
    life.activeAction = null
    await storage.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret)
  }
  return { start, request, post, get, operator, player, action, seedCampusEligibility, outbound }
}

async function justiceGet(h: Awaited<ReturnType<typeof host>>, who: Device): Promise<JusticePracticeResponse> {
  return (await h.get(`${justicePath}?city=lagos`, who)).json as unknown as JusticePracticeResponse
}
async function justicePost(h: Awaited<ReturnType<typeof host>>, suffix: string, body: object, who: Device): Promise<JusticePracticeResponse> {
  return (await h.post(justicePath + suffix, body, who)).json as unknown as JusticePracticeResponse
}
async function assessmentGet(h: Awaited<ReturnType<typeof host>>, who: Device): Promise<AssessmentResponse> {
  return (await h.get(`${assessmentPath}?city=lagos`, who)).json as unknown as AssessmentResponse
}
async function assessmentPost(h: Awaited<ReturnType<typeof host>>, suffix: string, body: object, who: Device): Promise<AssessmentResponse> {
  return (await h.post(assessmentPath + suffix, body, who)).json as unknown as AssessmentResponse
}
async function wallet(h: Awaited<ReturnType<typeof host>>, who: Device): Promise<{ cash: number; ledger: unknown[] }> {
  const state = (await h.get('/api/life?city=lagos', who)).json['state'] as { cash: number; ledger: unknown[] }
  return { cash: state.cash, ledger: state.ledger }
}

test('fictional justice case preserves ordered evidence, CAS and duplicate receipt through Worker SQLite restart', { timeout: 90_000 }, async t => {
  const h = await host(t)
  await h.start()
  const learner = await h.player('Justice trainee'), beforeWallet = await wallet(h, learner)
  const started = await justicePost(h, '/start', { cityId: 'lagos', requestId: newId() }, learner)
  assert.deepEqual([started.ok, started.practice?.phase, started.revision], [true, 'inspect-initial', 0])
  const dispatchRequest = { cityId: 'lagos', requestId: newId(), expectedRevision: 0,
    action: { kind: 'inspect', evidenceId: 'dispatch-copy' } }
  const dispatch = await justicePost(h, '/step', dispatchRequest, learner)
  assert.deepEqual([dispatch.ok, dispatch.revision, dispatch.practice?.reviewedEvidenceIds], [true, 1, ['dispatch-copy']])

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'shadow' })).status, 200)
  await h.start('shadow')
  const recovered = await justiceGet(h, learner)
  assert.deepEqual([recovered.practice?.phase, recovered.revision, recovered.practice?.reviewedEvidenceIds],
    ['inspect-initial', 1, ['dispatch-copy']])
  const duplicate = await justicePost(h, '/step', dispatchRequest, learner)
  assert.deepEqual([duplicate.ok, duplicate.duplicate, duplicate.practice?.reviewedEvidenceIds], [true, true, ['dispatch-copy']])

  const raceRevision = recovered.revision!
  const [arrival, seal] = await Promise.all([
    justicePost(h, '/step', { cityId: 'lagos', requestId: newId(), expectedRevision: raceRevision,
      action: { kind: 'inspect', evidenceId: 'arrival-receipt' } }, learner),
    justicePost(h, '/step', { cityId: 'lagos', requestId: newId(), expectedRevision: raceRevision,
      action: { kind: 'inspect', evidenceId: 'seal-log' } }, learner),
  ])
  assert.equal([arrival.ok, seal.ok].filter(Boolean).length, 1, 'only one request wins the same revision')
  let current = await justiceGet(h, learner)
  const seen = new Set(current.practice!.reviewedEvidenceIds)
  if (!seen.has('arrival-receipt')) {
    current = await justicePost(h, '/step', {
    cityId: 'lagos', requestId: newId(), expectedRevision: current.revision!, action: { kind: 'inspect', evidenceId: 'arrival-receipt' },
    }, learner)
    assert.equal(current.ok, true, current.code)
    seen.add('arrival-receipt')
  }
  if (!seen.has('seal-log')) {
    current = await justicePost(h, '/step', {
    cityId: 'lagos', requestId: newId(), expectedRevision: current.revision!, action: { kind: 'inspect', evidenceId: 'seal-log' },
    }, learner)
    assert.equal(current.ok, true, current.code)
    seen.add('seal-log')
  }
  assert.equal(current.practice?.phase, 'initial-decision')
  const advance = async (action: object) => {
    current = await justicePost(h, '/step', { cityId: 'lagos', requestId: newId(), expectedRevision: current.revision!, action }, learner)
    assert.equal(current.ok, true, current.code)
  }
  await advance({ kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] })
  await advance({ kind: 'send-service-notice' })
  await advance({ kind: 'inspect-review' })
  await advance({ kind: 'review-decision', choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] })
  assert.deepEqual([current.practice?.phase, current.practice?.trainingComplete], ['complete', true])
  assert.deepEqual(await wallet(h, learner), beforeWallet, 'fictional practice changes neither cash nor the wallet ledger')
  const shadowCompare = await h.operator('/api/mod/store/compare')
  assert.equal(shadowCompare.status, 200)
  assert.equal(((shadowCompare.json['collections'] as Record<string, { equal: boolean }>).livingWorld)?.equal, true)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start('entries')
  current = await justiceGet(h, learner)
  assert.deepEqual([current.practice?.phase, current.practice?.trainingComplete], ['complete', true])
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start('legacy')
  current = await justiceGet(h, learner)
  assert.deepEqual([current.practice?.phase, current.practice?.trainingComplete], ['complete', true])
  assert.deepEqual(h.outbound, [], 'the fictional case performs no provider I/O')
})

test('registered cpe-101 active probes, pause/reload and fixed mark survive Worker SQLite restart once', { timeout: 120_000 }, async t => {
  const h = await host(t)
  await h.start()
  const learner = await h.player('CPE learner')
  for (const [type, payload] of [
    ['onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }],
    ['onboarding.dream', { dream: 'everybodys-padi' }],
    ['onboarding.lottery', {}],
    ['onboarding.home', { lga: 'ikeja', stay: true }],
  ] as const) {
    const result = await h.action(learner, type, payload)
    assert.equal(result.status, 200)
    const expected = type === 'onboarding.traits' ? 'traits_saved' : type === 'onboarding.dream' ? 'dream_saved'
      : type === 'onboarding.lottery' ? 'rolled' : 'life_started'
    assert.equal(result.json['code'], expected, type)
  }
  await h.seedCampusEligibility(learner)
  assert.equal((await h.action(learner, 'unilag.apply', { programme: 'computer' })).json['code'], 'admitted')
  assert.equal((await h.action(learner, 'unilag.matriculate')).json['code'], 'matriculated')
  const courses = PROGRAMMES.computer.semesters[0]!.courses.map(course => course.id)
  assert.equal((await h.action(learner, 'unilag.register-semester', { courses })).json['code'], 'registered')
  assert.equal((await h.action(learner, 'spot', { id: PROGRAMMES.computer.spot })).json['code'], 'selected')
  const startingWallet = await wallet(h, learner)
  const ready = await assessmentGet(h, learner)
  assert.deepEqual([ready.ok, ready.code, ready.term?.courseId, ready.assignmentMark], [true, 'assessment_ready', 'cpe-101', null])
  const started = await assessmentPost(h, '/start', { cityId: 'lagos', requestId: newId() }, learner)
  assert.deepEqual([started.ok, started.practice?.phase, started.revision], [true, 'inspect', 1])

  const pausedReceipt = { cityId: 'lagos', requestId: newId(), expectedRevision: 1, operation: { kind: 'probe', a: false, b: false } }
  const firstProbe = await assessmentPost(h, '/step', pausedReceipt, learner)
  assert.deepEqual([firstProbe.ok, firstProbe.revision, firstProbe.practice?.initialProbes],
    [true, 2, [{ a: false, b: false, output: false }]])
  const idleLife = (await h.get('/api/life?city=lagos', learner)).json['state'] as { activeAction: unknown }
  assert.equal(idleLife.activeAction, null, 'the lab has no active timer; a current read is its nonmutating pause/reload point')
  const unchangedGet = await assessmentGet(h, learner)
  assert.deepEqual([unchangedGet.revision, unchangedGet.practice], [2, firstProbe.practice])

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'shadow' })).status, 200)
  await h.start('shadow')
  let current = await assessmentGet(h, learner)
  assert.deepEqual([current.practice?.phase, current.revision, current.practice?.initialProbes], ['inspect', 2, firstProbe.practice?.initialProbes])
  const shadowCompare = await h.operator('/api/mod/store/compare')
  assert.equal(shadowCompare.status, 200)
  assert.equal(((shadowCompare.json['collections'] as Record<string, { equal: boolean }>).livingWorld)?.equal, true)
  const retryAfterRestart = await assessmentPost(h, '/step', pausedReceipt, learner)
  assert.deepEqual([retryAfterRestart.ok, retryAfterRestart.duplicate, retryAfterRestart.practice], [true, true, current.practice],
    'SQLite retains the original probe receipt and does not count a retry as another probe')

  const pair = (a: boolean, b: boolean) => ({ a, b })
  const initialPairs = [pair(false, false), pair(false, true), pair(true, false), pair(true, true)]
  const already = new Set(current.practice!.initialProbes.map(row => `${Number(row.a)}${Number(row.b)}`))
  const pending = initialPairs.filter(row => !already.has(`${Number(row.a)}${Number(row.b)}`))
  const firstPending = pending.shift()!
  const secondPending = pending.shift()!
  const raceRevision = current.revision!
  const race = await Promise.all([firstPending, secondPending].map(input => assessmentPost(h, '/step', {
    cityId: 'lagos', requestId: newId(), expectedRevision: raceRevision, operation: { kind: 'probe', ...input },
  }, learner)))
  assert.equal(race.filter(reply => reply.ok).length, 1, 'only one active input pair wins the same revision')
  current = await assessmentGet(h, learner)
  const recorded = new Set(current.practice!.initialProbes.map(row => `${Number(row.a)}${Number(row.b)}`))
  for (const input of initialPairs) {
    const key = `${Number(input.a)}${Number(input.b)}`
    if (recorded.has(key)) continue
    current = await assessmentPost(h, '/step', { cityId: 'lagos', requestId: newId(), expectedRevision: current.revision!,
      operation: { kind: 'probe', ...input } }, learner)
    assert.equal(current.ok, true, current.code)
    recorded.add(key)
  }
  assert.equal(current.practice?.phase, 'inspect')
  current = await assessmentPost(h, '/step', { cityId: 'lagos', requestId: newId(), expectedRevision: current.revision!,
    operation: { kind: 'inspect', a: false, b: true } }, learner)
  assert.deepEqual([current.ok, current.practice?.phase, current.practice?.counterexample], [true, 'repair', { a: false, b: true, output: true }])
  current = await assessmentPost(h, '/step', { cityId: 'lagos', requestId: newId(), expectedRevision: current.revision!,
    operation: { kind: 'repair', gate: 'and' } }, learner)
  assert.deepEqual([current.ok, current.practice?.phase], [true, 'verify'])
  for (const input of initialPairs) {
    current = await assessmentPost(h, '/step', { cityId: 'lagos', requestId: newId(), expectedRevision: current.revision!,
      operation: { kind: 'probe', ...input } }, learner)
    assert.equal(current.ok, true, current.code)
  }
  const submitId = newId()
  const submission = { cityId: 'lagos', requestId: submitId, expectedRevision: current.revision!, operation: { kind: 'submit' } }
  current = await assessmentPost(h, '/step', submission, learner)
  assert.deepEqual([current.ok, current.code, current.practice?.phase, current.assignmentMark], [true, 'completed', 'complete', UNILAG_BETA_RULES.assignmentWeight])
  assert.deepEqual(await wallet(h, learner), startingWallet, 'the assignment mark is not cash and creates no wallet ledger entry')

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start('entries')
  current = await assessmentGet(h, learner)
  assert.deepEqual([current.assignmentMark, current.practice?.phase], [UNILAG_BETA_RULES.assignmentWeight, 'complete'])
  const terminalRetry = await assessmentPost(h, '/step', submission, learner)
  assert.deepEqual([terminalRetry.ok, terminalRetry.duplicate, terminalRetry.assignmentMark], [true, true, UNILAG_BETA_RULES.assignmentWeight])
  assert.deepEqual(await wallet(h, learner), startingWallet, 'terminal retry after restart does not add or duplicate any wallet effect')
  const entriesCompare = await h.operator('/api/mod/store/compare')
  assert.equal(entriesCompare.status, 200)
  assert.equal(((entriesCompare.json['collections'] as Record<string, { equal: boolean }>).livingWorld)?.equal, true)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start('legacy')
  current = await assessmentGet(h, learner)
  assert.deepEqual([current.assignmentMark, current.practice?.phase], [UNILAG_BETA_RULES.assignmentWeight, 'complete'])
  const legacyRetry = await assessmentPost(h, '/step', submission, learner)
  assert.deepEqual([legacyRetry.ok, legacyRetry.duplicate, legacyRetry.assignmentMark], [true, true, UNILAG_BETA_RULES.assignmentWeight])
  assert.deepEqual(await wallet(h, learner), startingWallet)
  assert.deepEqual(h.outbound, [], 'both learning exercises are local fictional scenarios')
})
