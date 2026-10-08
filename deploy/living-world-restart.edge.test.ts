// Real Worker/SQLite restart authority. No completed assessment or qualification is seeded.
import test from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import type { DrivingResponse, QualificationResponse } from '../src/types/living-world.ts'

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
const token = 'restart-edge-fixture-token-0123456789' // Disposable test binding, never a provider credential.
const path = '/api/living-world/driving'
const newId = () => `${Date.now()}:${crypto.randomUUID()}`
const look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-restart-'))
  let worker: WorkerHost | null = null, address = 0
  t.after(async () => { try { await worker?.dispose() } finally { await rm(folder, { recursive: true, force: true }) } })
  const bundle = join(folder, 'worker.mjs')
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true,
    format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] })
  const script = await readFile(bundle, 'utf8')
  async function start(layout = 'legacy') {
    await worker?.dispose()
    worker = new Miniflare({ ...convertV4MiniflareOptions({ name: 'joinallworld-restart', script, modules: true,
      compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } },
      durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'restart-fixture', STORE_LAYOUT: layout,
        MODERATOR_TOKEN: token, FOUNDER_EMAIL_SHA256: '' }, serviceBindings: { ASSETS: () => new Response('asset') } }),
      resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} })
    await worker.ready
  }
  async function request(url: string, cookie = '', body?: object, operator = false): Promise<Response> {
    assert.ok(worker)
    return worker.dispatchFetch(origin + url, { method: body ? 'POST' : 'GET', headers: {
      origin, 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`,
      ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}),
      ...(operator ? { authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}) })
  }
  async function player(name: string) {
    const created = await request('/api/session', '', { name, onboarding: true })
    assert.equal(created.status, 200)
    const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    assert.ok(cookie)
    await (await request('/api/life?city=lagos', cookie)).arrayBuffer()
    const confirmed = await request('/api/action', cookie, { actionId: newId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look } })
    assert.equal((await confirmed.json() as { code: string }).code, 'playing')
    return cookie
  }
  const driving = async (action: string, cookie: string, body?: object): Promise<DrivingResponse> => {
    const response = await request(path + action, cookie, body)
    assert.equal(response.status, 200)
    return await response.json() as DrivingResponse
  }
  return { start, request, player, driving }
}

test('Worker restart has one CAS winner and retains replacement/replay across SQLite layouts and host restart', async t => {
  const h = await fixture(t)
  await h.start()
  const ada = await h.player('Ada'), bola = await h.player('Bola')
  const initial = await h.driving('/start', ada, { cityId: 'lagos', requestId: newId() })
  assert.ok(initial.ok && initial.session)
  const original = initial.session!
  await delay(250) // Real server frame credit, not a supplied position or a synthetic completion.
  const moved = await h.driving('/input', ada, { cityId: 'lagos', journeyId: original.journeyId, sequence: original.nextSequence,
    frames: [{ throttle: 1, brake: 0, steer: 0 }, { throttle: 1, brake: 0, steer: 0 }] })
  assert.ok(moved.ok && moved.session)
  assert.ok(moved.session!.state.position.z > original.state.position.z)
  assert.equal(moved.session!.nextSequence, 2)
  const paused = await h.driving('/pause', ada, { cityId: 'lagos', requestId: newId(), journeyId: original.journeyId, revision: moved.session!.revision })
  assert.ok(paused.ok && paused.session?.state.status === 'paused')
  const prior = paused.session!
  const beforeLife = await (await h.request('/api/life?city=lagos', ada)).json() as { state: { cash: number; ledger: unknown } }
  const makeRequest = () => ({ cityId: 'lagos', requestId: newId(), journeyId: prior.journeyId, revision: prior.revision })
  const requests = [makeRequest(), makeRequest()]
  const results = await Promise.all(requests.map(body => h.driving('/restart', ada, body)))
  assert.equal(results.filter(result => result.ok).length, 1, 'two different request IDs cannot both replace the same attempt')
  const winnerIndex = results.findIndex(result => result.ok), winner = results[winnerIndex]!
  const fresh = winner.session!
  assert.equal(winner.code, 'restarted')
  assert.notEqual(fresh.journeyId, prior.journeyId)
  assert.deepEqual(fresh.state.position, original.state.position, 'explicit restart resets control-derived progress to the authored start')
  assert.deepEqual([fresh.revision, fresh.nextSequence, fresh.state.status, fresh.state.assessment, fresh.state.speed,
    fresh.state.checkpointIndex, fresh.state.stopDwellMs], [prior.revision + 1, 1, 'running', 'pending', 0, 0, 0])
  assert.equal(results[1 - winnerIndex]!.code, 'journey_mismatch')
  const retry = await h.driving('/restart', ada, requests[winnerIndex]!)
  assert.deepEqual([retry.ok, retry.code, retry.duplicate, retry.session?.journeyId], [true, 'restarted', true, fresh.journeyId])
  const foreign = await h.driving('/restart', bola, requests[winnerIndex]!)
  assert.deepEqual([foreign.ok, foreign.code, foreign.session], [false, 'no_journey', null])
  const oldInput = await h.driving('/input', ada, { cityId: 'lagos', journeyId: prior.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] })
  assert.deepEqual([oldInput.ok, oldInput.code, oldInput.session?.journeyId], [false, 'journey_mismatch', fresh.journeyId])
  const pausedFresh = await h.driving('/pause', ada, { cityId: 'lagos', requestId: newId(), journeyId: fresh.journeyId, revision: fresh.revision })
  assert.ok(pausedFresh.ok)
  const retained = pausedFresh.session!
  await h.start('shadow')
  assert.deepEqual((await h.driving('?city=lagos', ada)).session, retained)
  const compared = await h.request('/api/mod/store/compare', '', undefined, true)
  assert.equal(compared.status, 200)
  assert.equal(((await compared.json() as { collections: Record<string, { equal: boolean }> }).collections.livingWorld)?.equal, true)
  const switchLayout = await h.request('/api/mod/store/layout', '', { layout: 'entries' }, true)
  assert.equal(switchLayout.status, 200)
  await h.start()
  assert.deepEqual((await h.driving('?city=lagos', ada)).session, retained)
  const replay = await h.driving('/restart', ada, requests[winnerIndex]!)
  assert.deepEqual([replay.ok, replay.duplicate, replay.session?.journeyId, replay.session?.state.status], [true, true, retained.journeyId, 'paused'])
  const qualification = await h.request('/api/living-world/qualification?city=lagos', ada)
  assert.equal(qualification.status, 200)
  assert.deepEqual([(await qualification.json() as QualificationResponse).qualification], [null], 'restart does not award a qualification')
  const afterLife = await (await h.request('/api/life?city=lagos', ada)).json() as typeof beforeLife
  assert.deepEqual([afterLife.state.cash, afterLife.state.ledger], [beforeLife.state.cash, beforeLife.state.ledger])
})
