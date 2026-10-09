// Real Worker barber practice: controls, claim receipts, wallet, and storage-layout recovery.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import type { BarberResponse, BarberSessionView } from '../src/types/living-world-barber.ts'
import type { Look } from '../src/types/life.ts'

interface MiniflareInstance { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<Response> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'))
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> }

interface Device { id: string; name: string; cookie: string }
interface WalletView { cash: number; ledger: unknown[] }
const TOKEN = 'barber-worker-storage-test-token-012345'
const ORIGIN = 'https://joinallworld.test'
const BARBER_PATH = '/api/living-world/barber'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const requestId = () => `${Date.now()}:${crypto.randomUUID()}`

/** A real Worker over one persistent directory; restarts keep the guest session and store. */
async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-barber-'))
  let mf: MiniflareInstance | null = null
  t.after(async () => {
    try { await mf?.dispose() } finally { await rm(folder, { recursive: true, force: true }) }
  })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  let address = 0
  async function start(bindings: Record<string, string> = {}): Promise<void> {
    if (mf) await mf.dispose()
    const options = { name: 'joinallworld-barber', script, modules: true, compatibilityDate: '2026-10-01',
      durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'),
      bindings: { BUILD_ID: 'barber-fixture', MODERATOR_TOKEN: TOKEN, FOUNDER_EMAIL_SHA256: '', ...bindings },
      serviceBindings: { ASSETS: () => new Response('asset') } }
    mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} })
    await mf.ready
  }
  const send = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => (mf as MiniflareInstance).dispatchFetch(ORIGIN + path, init)
  const post = (path: string, body: object, who?: Device) => send(path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json',
    'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`, ...(who ? { cookie: who.cookie } : {}) }, body: JSON.stringify(body) })
  const get = (path: string, who: Device) => send(path, { headers: { origin: ORIGIN, cookie: who.cookie, 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}` } })
  const operator = async (path: string, body?: object): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await send(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, 'cf-connecting-ip': '203.0.113.9',
      ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, json: await response.json() as Record<string, unknown> }
  }
  async function player(name: string): Promise<Device> {
    const response = await post('/api/session', { name, onboarding: true })
    assert.equal(response.status, 200)
    const saved = await response.json() as { session: { id: string; name: string } }
    const who: Device = { ...saved.session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' }
    assert.ok(who.id && who.cookie)
    const confirmed = await post('/api/action', { actionId: requestId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, who)
    assert.equal((await confirmed.json() as { code: string }).code, 'playing')
    return who
  }
  const wallet = async (who: Device): Promise<WalletView> => {
    const response = await get('/api/life?city=lagos', who)
    assert.equal(response.status, 200)
    const body = await response.json() as { state: { cash: number; ledger: unknown[] } }
    return { cash: body.state.cash, ledger: body.state.ledger }
  }
  const appearance = async (who: Device): Promise<unknown> => {
    const response = await get('/api/life?city=lagos', who)
    assert.equal(response.status, 200)
    const body = await response.json() as { state: { onboarding: { look: unknown; wardrobe: unknown } } }
    return { look: body.state.onboarding.look, wardrobe: body.state.onboarding.wardrobe }
  }
  return { start, post, get, operator, player, wallet, appearance }
}

async function barberPost(h: Awaited<ReturnType<typeof host>>, suffix: string, body: object, who: Device): Promise<BarberResponse> {
  const response = await h.post(BARBER_PATH + suffix, body, who)
  assert.equal(response.status, 200)
  return await response.json() as BarberResponse
}
async function current(h: Awaited<ReturnType<typeof host>>, who: Device): Promise<BarberResponse> {
  const response = await h.get(`${BARBER_PATH}?city=lagos`, who)
  assert.equal(response.status, 200)
  return await response.json() as BarberResponse
}

async function stroke(h: Awaited<ReturnType<typeof host>>, who: Device, session: BarberSessionView,
  tool: 'comb' | 'clippers' | 'brush', y: number): Promise<BarberSessionView> {
  const frames = [0.25, 0.4, 0.55].map(x => ({ tool, x, y, pressed: true }))
  // Real Worker time is authoritative: only the submitted controls consume frame credit.
  await delay(340)
  const answer = await barberPost(h, '/input', { cityId: 'lagos', sessionId: session.sessionId,
    revision: session.revision, sequence: session.nextSequence, frames }, who)
  assert.equal(answer.ok, true, answer.code)
  assert.ok(answer.session)
  return answer.session
}

test('the persisted Worker barber lesson, claim, tool purchase, and receipts survive store layouts', { timeout: 90_000 }, async t => {
  const h = await host(t)
  await h.start()
  const ada = await h.player('Barber Worker Guest'), bola = await h.player('Another Barber Guest')
  const walletBefore = await h.wallet(ada)
  const otherWalletBefore = await h.wallet(bola)
  assert.equal(walletBefore.cash, 5_000, 'the real Worker guest has the published starting balance')
  const appearanceBefore = await h.appearance(ada)

  const started = await barberPost(h, '/start', { cityId: 'lagos', lessonId: 'basic', requestId: requestId() }, ada)
  assert.ok(started.ok && started.session && started.plan)
  const begun = started.session
  const firstPacket = { cityId: 'lagos', sessionId: begun.sessionId, revision: begun.revision, sequence: begun.nextSequence,
    frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: true }] }
  await delay(125)
  const firstRequests = await Promise.all([h.post(BARBER_PATH + '/input', firstPacket, ada), h.post(BARBER_PATH + '/input', firstPacket, ada)])
  const firstReplies = await Promise.all(firstRequests.map(async response => {
    assert.equal(response.status, 200)
    return await response.json() as BarberResponse
  }))
  assert.deepEqual([firstReplies.filter(reply => reply.ok).length, firstReplies.filter(reply => reply.duplicate).length], [2, 1])
  const firstStroke = firstReplies.find(reply => !reply.duplicate)!
  assert.ok(firstStroke.session)
  assert.deepEqual([firstStroke.session.practice.objectiveIndex, firstStroke.session.practice.pointerDown], [0, true])
  assert.deepEqual(firstReplies.map(reply => [reply.session?.revision, reply.session?.nextSequence]), [[2, 2], [2, 2]])

  const foreign = await barberPost(h, '/input', { ...firstPacket, revision: firstStroke.session.revision, sequence: firstStroke.session.nextSequence }, bola)
  assert.deepEqual([foreign.ok, foreign.code, foreign.session], [false, 'no_practice', null])
  assert.deepEqual(await h.wallet(bola), otherWalletBefore)
  assert.deepEqual(await h.wallet(ada), walletBefore)

  // A real bootstrap read pauses the saved cursor and requires an explicit resume.
  const loaded = await current(h, ada)
  assert.deepEqual([loaded.session?.status, loaded.session?.practice.objectiveIndex, loaded.session?.practice.pointerDown, loaded.session?.practice.cursor], ['paused', 0, false, null])
  const resumed = await barberPost(h, '/resume', { cityId: 'lagos', requestId: requestId(), sessionId: loaded.session!.sessionId,
    revision: loaded.session!.revision }, ada)
  assert.ok(resumed.ok && resumed.session?.status === 'running')
  let completed = await stroke(h, ada, resumed.session!, 'comb', 0.4)
  completed = await stroke(h, ada, completed, 'clippers', 0.69)
  completed = await stroke(h, ada, completed, 'brush', 0.47)
  assert.deepEqual([completed.status, completed.practice.objectiveIndex], ['complete', 3])
  const completedUnpaid = await current(h, ada)
  assert.deepEqual([completedUnpaid.session?.status, completedUnpaid.results], ['complete', []])
  assert.deepEqual(await h.wallet(ada), walletBefore, 'finishing the NPC lesson is unpaid until an explicit claim')

  // Restart while completed and unpaid, retaining the same durable guest identity.
  await h.start({ STORE_LAYOUT: 'shadow' })
  const shadowUnpaid = await current(h, ada)
  assert.deepEqual(shadowUnpaid.session, completedUnpaid.session)
  assert.deepEqual(shadowUnpaid.results, [])
  const comparison = await h.operator('/api/mod/store/compare')
  assert.equal(comparison.status, 200)
  assert.equal((comparison.json['collections'] as Record<string, { equal: boolean }>).livingWorld?.equal, true)
  const shadowStatus = await h.operator('/api/mod/store')
  assert.equal(shadowStatus.status, 200)
  assert.equal((shadowStatus.json['shadow'] as { mismatches: number }).mismatches, 0)

  const claimBody = { cityId: 'lagos', lessonId: 'basic', sessionId: completed.sessionId, requestId: requestId() }
  const claim = () => barberPost(h, '/claim', claimBody, ada)
  const [paid, duplicate] = await Promise.all([claim(), claim()])
  assert.deepEqual([paid.ok, duplicate.ok, [paid.duplicate, duplicate.duplicate].filter(Boolean).length], [true, true, 1])
  assert.equal(paid.results.length, 1)
  assert.deepEqual([paid.results[0]?.lessonId, paid.results[0]?.styleId], ['basic', 'man-low-cut-v1'])
  assert.ok(Number.isSafeInteger(paid.results[0]?.earnedAt))
  assert.deepEqual(duplicate.results, paid.results)
  const paidWallet = await h.wallet(ada)
  assert.equal(paidWallet.cash, walletBefore.cash + 80)
  assert.equal(paidWallet.ledger.length, walletBefore.ledger.length + 1)
  assert.deepEqual((await current(h, ada)).results, paid.results)
  assert.deepEqual(await h.appearance(ada), appearanceBefore, 'the NPC style never changes the guest look or wardrobe')

  const retained = await barberPost(h, '/claim', { ...claimBody, requestId: requestId() }, ada)
  assert.deepEqual([retained.code, retained.results], ['lesson_retained', paid.results])
  assert.deepEqual(await h.wallet(ada), paidWallet, 'a new request id cannot pay the retained mannequin result again')

  const upgradeBody = { cityId: 'lagos', requestId: requestId() }
  const [upgraded, upgradeDuplicate] = await Promise.all([
    barberPost(h, '/upgrade', upgradeBody, ada), barberPost(h, '/upgrade', upgradeBody, ada),
  ])
  assert.deepEqual([upgraded.ok, upgradeDuplicate.ok, [upgraded.duplicate, upgradeDuplicate.duplicate].filter(Boolean).length,
    upgraded.starterTool, upgradeDuplicate.starterTool], [true, true, 1, true, true])
  const upgradedWallet = await h.wallet(ada)
  assert.equal(upgradedWallet.cash, walletBefore.cash + 80 - 120)
  assert.equal(upgradedWallet.ledger.length, walletBefore.ledger.length + 2)
  assert.deepEqual(await h.appearance(ada), appearanceBefore)
  const noSecondDebit = await barberPost(h, '/upgrade', { cityId: 'lagos', requestId: requestId() }, ada)
  assert.deepEqual([noSecondDebit.code, noSecondDebit.starterTool], ['barber_tool_retained', true])
  assert.deepEqual(await h.wallet(ada), upgradedWallet)

  async function assertRecovered(): Promise<void> {
    const saved = await current(h, ada)
    assert.deepEqual(saved.results, paid.results)
    assert.equal(saved.session, null, 'claim clears the current lesson pointer while retaining its completed row')
    assert.equal(saved.starterTool, true)
    assert.deepEqual(await h.wallet(ada), upgradedWallet)
    assert.deepEqual(await h.appearance(ada), appearanceBefore)
    const retry = await barberPost(h, '/claim', claimBody, ada)
    assert.deepEqual([retry.ok, retry.duplicate, retry.results], [true, true, paid.results], 'the original claim receipt replays after Worker restart')
    const upgradeRetry = await barberPost(h, '/upgrade', upgradeBody, ada)
    assert.deepEqual([upgradeRetry.ok, upgradeRetry.duplicate, upgradeRetry.starterTool], [true, true, true], 'the original upgrade receipt replays after Worker restart')
    assert.deepEqual(await h.wallet(ada), upgradedWallet)
  }

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start({ STORE_LAYOUT: 'legacy' })
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'entries')
  await assertRecovered()

  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start()
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'legacy')
  await assertRecovered()
})
