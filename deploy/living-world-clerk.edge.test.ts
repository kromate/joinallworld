// Real Worker/SQLite acceptance for the fictional NPC clerk case and storage-layout continuity.
// It proves this authored exercise only; it does not exercise real justice workflows or credentials.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import type { ClerkResponse } from '../src/types/living-world-clerk.ts'

interface WorkerHost {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit): Promise<Response>
}
interface WorkerTools {
  Miniflare: new (options: Record<string, unknown>) => WorkerHost
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
}
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as WorkerTools
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }
const origin = 'https://joinallworld.test'
const operatorToken = 'clerk-edge-fixture-token-0123456789' // Synthetic operator binding, never a provider credential.
const clerkPath = '/api/living-world/clerk'
const newId = () => `${Date.now()}:${crypto.randomUUID()}`
const look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }

interface Device { id: string; name: string; cookie: string }
interface JsonResponse { status: number; json: Record<string, unknown> }

async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-clerk-'))
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
  async function start(bindings: Record<string, string> = {}): Promise<void> {
    await worker?.dispose()
    worker = new Miniflare({ ...convertV4MiniflareOptions({ name: 'joinallworld-clerk', script, modules: true,
      compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'clerk-fixture', STORE_LAYOUT: 'legacy',
        MODERATOR_TOKEN: operatorToken, FOUNDER_EMAIL_SHA256: '', ...bindings },
      outboundService: (request: Request) => { outbound.push(new URL(request.url).origin); return new Response('fixture outbound disabled', { status: 503 }) },
      serviceBindings: { ASSETS: () => new Response('asset') } }), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} })
    await worker.ready
  }
  async function request(path: string, cookie = '', body?: object, operator = false): Promise<JsonResponse> {
    assert.ok(worker)
    const response = await worker.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
      origin, 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`,
      ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      ...(operator ? { authorization: `Bearer ${operatorToken}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) })
    try {
      return { status: response.status, json: await response.json() as Record<string, unknown> }
    } catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    } finally {
      if (!response.bodyUsed) await response.body?.cancel().catch(() => {})
    }
  }
  const post = (path: string, body: object, who?: Device) => request(path, who?.cookie ?? '', body)
  const get = (path: string, who: Device) => request(path, who.cookie)
  const operator = (path: string, body?: object) => request(path, '', body, true)
  async function player(name: string): Promise<Device> {
    assert.ok(worker)
    const raw = await worker!.dispatchFetch(origin + '/api/session', { method: 'POST', headers: {
      origin, 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`,
    }, body: JSON.stringify({ name, onboarding: true }) })
    try {
      assert.equal(raw.status, 200)
      const body = await raw.json() as { session?: { id: string; name: string } }
      const cookie = (raw.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
      assert.ok(cookie)
      const device = { ...body.session!, cookie }
      await get('/api/life?city=lagos', device)
      const confirmed = await post('/api/action', { actionId: newId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look } }, device)
      assert.equal(confirmed.status, 200)
      assert.equal(confirmed.json['code'], 'playing')
      return device
    } catch (error) {
      await raw.body?.cancel().catch(() => {})
      throw error
    } finally {
      if (!raw.bodyUsed) await raw.body?.cancel().catch(() => {})
    }
  }
  return { start, request, post, get, operator, player, outbound }
}

async function clerkGet(h: Awaited<ReturnType<typeof host>>, who: Device): Promise<ClerkResponse> {
  return (await h.get(`${clerkPath}?city=lagos`, who)).json as unknown as ClerkResponse
}
async function clerkPost(h: Awaited<ReturnType<typeof host>>, suffix: string, body: object, who: Device): Promise<ClerkResponse> {
  return (await h.post(clerkPath + suffix, body, who)).json as unknown as ClerkResponse
}
async function wallet(h: Awaited<ReturnType<typeof host>>, who: Device): Promise<{ cash: number; ledger: unknown[] }> {
  const response = await h.get('/api/life?city=lagos', who)
  const state = response.json['state'] as { cash: number; ledger: unknown[] }
  return { cash: state.cash, ledger: state.ledger }
}

test('the real Worker retains the same pending clerk case through SQLite restart and legacy/shadow/entries reversal', { timeout: 90_000 }, async t => {
  const h = await host(t)
  await h.start()
  const ada = await h.player('Ada clerk trainee'), bola = await h.player('Bola clerk trainee')
  const untouched = await wallet(h, bola)
  const forged = await h.post('/api/action', { actionId: newId(), cityId: 'lagos', type: 'living-world.server', payload: { op: 'clerk-reward' } }, ada)
  assert.equal(forged.json['code'], 'server_only', 'the Worker does not expose internal reward authority to player actions')

  const startRequest = { cityId: 'lagos', requestId: newId() }
  const started = await clerkPost(h, '/start', startRequest, ada)
  assert.deepEqual([started.ok, started.revision, started.practice?.step], [true, 0, 'inspect_receipt'])
  const receiptRequest = { cityId: 'lagos', requestId: newId(), revision: 0, stepId: 'inspect_receipt', evidenceId: 'receipt' }
  const receipt = await clerkPost(h, '/step', receiptRequest, ada)
  assert.deepEqual([receipt.ok, receipt.revision, receipt.practice?.step], [true, 1, 'inspect_dispatch'])
  const receiptRetry = await clerkPost(h, '/step', receiptRequest, ada)
  assert.deepEqual([receiptRetry.ok, receiptRetry.duplicate, receiptRetry.practice], [true, true, receipt.practice])

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'shadow' })).status, 200)
  await h.start({ STORE_LAYOUT: 'shadow' })
  let pending = await clerkGet(h, ada)
  assert.deepEqual([pending.ok, pending.revision, pending.practice?.step], [true, 1, 'inspect_dispatch'],
    'a Worker restart preserves the exact pending step and revision')
  const recoveredReceipt = await clerkPost(h, '/step', receiptRequest, ada)
  assert.deepEqual([recoveredReceipt.ok, recoveredReceipt.duplicate, recoveredReceipt.practice], [true, true, pending.practice],
    'the original control receipt survives Worker restart')
  const foreignStep = await clerkPost(h, '/step', { cityId: 'lagos', requestId: newId(), revision: 1, stepId: 'inspect_dispatch', evidenceId: 'dispatch' }, bola)
  assert.deepEqual([foreignStep.ok, foreignStep.code, foreignStep.practice], [false, 'practice_not_started', null])
  const beforeEarned = await wallet(h, ada)
  const early = await clerkPost(h, '/claim', { cityId: 'lagos', requestId: newId(), revision: 4 }, ada)
  assert.deepEqual([early.ok, early.code, early.claimed], [false, 'practice_incomplete', false])
  assert.deepEqual(await wallet(h, ada), beforeEarned)

  const answers = [
    { revision: 1, stepId: 'inspect_dispatch', evidenceId: 'dispatch' },
    { revision: 2, stepId: 'compare_discrepancy', evidenceId: 'compare-b' },
    { revision: 3, stepId: 'choose_outcome', evidenceId: 'outcome-a' },
  ] as const
  let completed = pending
  for (const answer of answers) {
    completed = await clerkPost(h, '/step', { cityId: 'lagos', requestId: newId(), ...answer }, ada)
    assert.equal(completed.ok, true, completed.code)
  }
  assert.deepEqual([completed.revision, completed.practice?.step], [4, 'complete'])
  assert.deepEqual(await wallet(h, ada), beforeEarned, 'authored evidence completion alone does not award money')

  const claimStart = await wallet(h, ada)
  const claimA = { cityId: 'lagos', requestId: newId(), revision: 4 }
  const claimB = { cityId: 'lagos', requestId: newId(), revision: 4 }
  const [a, b] = await Promise.all([clerkPost(h, '/claim', claimA, ada), clerkPost(h, '/claim', claimB, ada)])
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, 'different request IDs still share one persisted domain claim')
  assert.deepEqual([a.claimed, b.claimed], [true, true])
  const winner = a.ok ? claimA : claimB
  const paid = await wallet(h, ada)
  assert.equal(paid.cash, claimStart.cash + 75)
  assert.equal(paid.ledger.length, claimStart.ledger.length + 1)
  assert.deepEqual(await wallet(h, bola), untouched)

  const compare = await h.operator('/api/mod/store/compare')
  assert.equal(compare.status, 200)
  const livingWorld = (compare.json['collections'] as Record<string, { equal: boolean }>).livingWorld
  assert.equal(livingWorld?.equal, true, `clerk state is copied consistently in shadow: ${JSON.stringify(livingWorld)}`)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start({ STORE_LAYOUT: 'legacy' })
  pending = await clerkGet(h, ada)
  assert.deepEqual([pending.claimed, pending.revision, pending.practice?.step], [true, 4, 'complete'])
  assert.deepEqual(await wallet(h, ada), paid)
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'entries')

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start()
  pending = await clerkGet(h, ada)
  assert.deepEqual([pending.claimed, pending.practice?.step], [true, 'complete'])
  assert.deepEqual(await wallet(h, ada), paid)
  const replay = await clerkPost(h, '/claim', winner, ada)
  assert.deepEqual([replay.ok, replay.duplicate, replay.claimed, replay.revision], [true, true, true, 4],
    'the successful claim receipt and paid terminal row survive layout reversal and restart')
  assert.deepEqual(await wallet(h, ada), paid, 'replaying the original successful request cannot repay')
  assert.deepEqual(h.outbound, [], 'this fictional exercise performs no external provider I/O')
})
