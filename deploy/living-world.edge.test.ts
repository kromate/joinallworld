// Real Worker practice API: identity, retries and persisted cursor continuity across supported layouts.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import type { DrivingResponse, QualificationResponse } from '../src/types/living-world.ts';
import type { DrivingPoint } from '../src/game/living-world/driving.ts';
import { PRACTICE_COURSE } from '../src/game/living-world/course.ts';

interface MiniflareInstance { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<Response> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> };

interface Device { id: string; name: string; cookie: string }
const TOKEN = 'storage-edge-test-token-0123456789';
const origin = 'https://joinallworld.test';

/** A Worker over a folder that outlives it: `start` again with other settings to restart it on the same storage. */
async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-driving-'));
  let mf: MiniflareInstance | null = null, address = 0;
  t.after(async () => {
    try { await mf?.dispose(); }
    finally { await rm(folder, { recursive: true, force: true }); }
  });
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const script = await readFile(bundle, 'utf8');
  async function start(bindings: Record<string, string> = {}): Promise<void> {
    if (mf) await mf.dispose();
    const options = { name: 'joinallworld-driving', script, modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'),
      bindings: { BUILD_ID: 'driving-fixture', MODERATOR_TOKEN: TOKEN, FOUNDER_EMAIL_SHA256: '', ...bindings }, serviceBindings: { ASSETS: () => new Response('asset') } };
    mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} });
    await mf.ready;
  }
  const send = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> => (mf as MiniflareInstance).dispatchFetch(origin + path, init);
  const post = (path: string, body: object, who?: Device) => send(path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`, ...(who ? { cookie: who.cookie } : {}) }, body: JSON.stringify(body) });
  const get = (path: string, who: Device) => send(path, { headers: { origin, cookie: who.cookie, 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}` } });
  const operator = async (path: string, body?: object): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await send(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, 'cf-connecting-ip': '203.0.113.9', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  async function player(name: string): Promise<Device> {
    const response = await post('/api/session', { name, onboarding: true });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await (await get('/api/life?city=lagos', who)).arrayBuffer();
    return who;
  }
  const rows = async (): Promise<Record<string, number>> => (((await operator('/api/mod/overview')).json['store'] as { rows: { tables: Record<string, number> } }).rows.tables);
  return { start, post, get, operator, player, rows };
}

const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const requestId = () => `${Date.now()}:${crypto.randomUUID()}`
const path = '/api/living-world/driving'
const qualificationPath = '/api/living-world/qualification'
const road = PRACTICE_COURSE.roads[0]!
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
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

test('on the Worker: a free guest practice cursor survives shadow, entries restart and layout reversal; retries step once', async t => {
  const h = await host(t)
  await h.start()
  const ada = await h.player('Ada'), bola = await h.player('Bola')
  for (const who of [ada, bola]) {
    const confirm = await h.post('/api/action', { actionId: requestId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, who)
    assert.equal((await confirm.json() as { code: string }).code, 'playing')
  }
  const startedResponse = await h.post(path + '/start', { cityId: 'lagos', requestId: requestId() }, ada)
  assert.equal(startedResponse.status, 200)
  const started = await startedResponse.json() as DrivingResponse
  assert.equal(started.ok, true)
  assert.ok(started.session)
  const session = started.session!
  const premature = await (await h.post(qualificationPath + '/claim', { cityId: 'lagos', requestId: requestId(), journeyId: session.journeyId }, ada)).json() as QualificationResponse
  assert.deepEqual([premature.ok, premature.code, premature.qualification], [false, 'assessment_required', null], 'Worker authority rejects qualification before control-derived evidence exists')
  await delay(250)
  const packet = { cityId: 'lagos', journeyId: session.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const [a, b] = await Promise.all([h.post(path + '/input', packet, ada), h.post(path + '/input', packet, ada)])
  const results = await Promise.all([a.json(), b.json()]) as DrivingResponse[]
  assert.ok(results.every(result => result.ok))
  assert.equal(results.filter(result => result.duplicate).length, 1)
  assert.ok(results.every(result => result.session?.revision === 2 && result.session.nextSequence === 2))
  const paused = await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse
  assert.equal(paused.session?.state.status, 'paused')
  assert.equal(paused.session?.state.speed, 0)
  assert.ok(paused.session!.state.position.z > 0)
  const expected = paused.session
  const foreign = await h.post(path + '/resume', { cityId: 'lagos', journeyId: session.journeyId, revision: expected!.revision, requestId: requestId() }, bola)
  assert.equal(foreign.status, 200)
  assert.equal((await foreign.json() as DrivingResponse).code, 'no_journey', 'another actor cannot resume Ada’s lesson')

  await h.start({ STORE_LAYOUT: 'shadow' })
  const shadow = await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse
  assert.deepEqual(shadow.session, expected)
  const compared = (await h.operator('/api/mod/store/compare')).json['collections'] as Record<string, { equal: boolean }>
  assert.equal(compared['livingWorld']?.equal, true)
  assert.equal(((await h.operator('/api/mod/store')).json['shadow'] as { mismatches: number }).mismatches, 0)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start({ STORE_LAYOUT: 'legacy' })
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'entries')
  assert.deepEqual((await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse).session, expected)

  const before = await h.rows()
  const resumed = await (await h.post(path + '/resume', { cityId: 'lagos', journeyId: session.journeyId, revision: expected!.revision, requestId: requestId() }, ada)).json() as DrivingResponse
  assert.equal(resumed.ok, true)
  const after = await h.rows()
  const changedEntries = (after['entries'] ?? 0) - (before['entries'] ?? 0)
  assert.ok(changedEntries >= 1 && changedEntries <= 5, `one actor transition writes a bounded positive number of entry rows: ${changedEntries}`)
  const stop = await (await h.post(path + '/pause', { cityId: 'lagos', journeyId: session.journeyId, revision: resumed.session!.revision, requestId: requestId() }, ada)).json() as DrivingResponse
  assert.equal(stop.ok, true)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start()
  assert.deepEqual((await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse).session, stop.session)
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'legacy')

  const lifeBefore = await (await h.get('/api/life?city=lagos', ada)).json() as { state: { cash: number; ledger: unknown[] } }
  const courseResumed = await (await h.post(path + '/resume', { cityId: 'lagos', journeyId: session.journeyId, revision: stop.session!.revision, requestId: requestId() }, ada)).json() as DrivingResponse
  assert.ok(courseResumed.ok && courseResumed.session?.state.status === 'running')
  let answer = courseResumed
  let packets = 0
  while (answer.session!.state.status === 'running' && packets < 500) {
    const state = answer.session!.state
    const progress = projection(state.position)
    const target = pointAt(progress + 3.5)
    const targetHeading = Math.atan2(target.x - state.position.x, target.z - state.position.z)
    const headingError = Math.atan2(Math.sin(targetHeading - state.heading), Math.cos(targetHeading - state.heading))
    const steer = clamp(Math.atan2(2 * 2.6 * Math.sin(headingError), 3.5) / 0.62, -1, 1)
    const checkpoint = PRACTICE_COURSE.checkpoints[state.checkpointIndex]!
    const stopping = checkpoint.stopRequired && Math.hypot(state.position.x - checkpoint.center.x, state.position.z - checkpoint.center.z) <= checkpoint.radius - 0.2 + state.speed * state.speed / 16
    const control = { throttle: stopping ? 0 : state.speed < 3 ? 1 : 0, brake: stopping || state.speed > 3.3 ? 1 : 0, steer }
    // Wait for real server-side 100 ms frame credit. No clock is injected; each request
    // advances only from this client control through the real HTTP endpoint.
    await delay(125)
    answer = await (await h.post(path + '/input', {
      cityId: 'lagos', journeyId: answer.session!.journeyId, sequence: answer.session!.nextSequence,
      frames: [control],
    }, ada)).json() as DrivingResponse
    assert.equal(answer.ok, true, `Worker control packet ${packets}: ${answer.code}`)
    packets++
  }
  assert.equal(answer.session?.state.status, 'complete', `actual Worker controls must pass within the bounded ${packets}-packet loop`)
  assert.equal(answer.session?.state.assessment, 'passed')
  assert.ok(packets <= 500)

  const claimBody = { cityId: 'lagos', requestId: requestId(), journeyId: answer.session!.journeyId }
  const claim = async (body: object) => await (await h.post(qualificationPath + '/claim', body, ada)).json() as QualificationResponse
  const [claimed, duplicate] = await Promise.all([claim(claimBody), claim(claimBody)])
  assert.ok(claimed.ok && claimed.valid && duplicate.ok && duplicate.valid)
  assert.equal([claimed.duplicate, duplicate.duplicate].filter(Boolean).length, 1)
  assert.equal(claimed.qualification?.evidenceJourneyId, answer.session!.journeyId)
  const retained = await claim({ ...claimBody, requestId: requestId() })
  assert.deepEqual([retained.code, retained.qualification], ['qualification_retained', claimed.qualification])
  const qualified = async () => await (await h.get(qualificationPath + '?city=lagos', ada)).json() as QualificationResponse
  let qualification = await qualified()
  assert.deepEqual([qualification.code, qualification.valid], ['qualified', true])
  const lifeAfter = await (await h.get('/api/life?city=lagos', ada)).json() as typeof lifeBefore
  assert.deepEqual([lifeAfter.state.cash, lifeAfter.state.ledger], [lifeBefore.state.cash, lifeBefore.state.ledger], 'practice and qualification leave the guest wallet and ledger unchanged')

  await h.start({ STORE_LAYOUT: 'shadow' })
  const persistedLayout = await h.operator('/api/mod/store')
  assert.equal(persistedLayout.status, 200)
  assert.equal(persistedLayout.json['requested'], 'legacy', 'Worker restart respects the previously persisted legacy layout')
  const enabledShadow = await h.operator('/api/mod/store/layout', { layout: 'shadow' })
  assert.equal(enabledShadow.status, 200, `enable shadow layout: ${JSON.stringify(enabledShadow.json)}`)
  const shadowLayout = await h.operator('/api/mod/store')
  assert.equal(shadowLayout.status, 200)
  assert.equal(shadowLayout.json['requested'], 'shadow')
  qualification = await qualified()
  assert.deepEqual([qualification.code, qualification.valid, qualification.qualification], ['qualified', true, claimed.qualification])
  const postQualificationCompare = await h.operator('/api/mod/store/compare')
  assert.equal(postQualificationCompare.status, 200, `store compare HTTP status: ${JSON.stringify(postQualificationCompare.json)}`)
  const livingWorldComparison = (postQualificationCompare.json['collections'] as Record<string, { equal: boolean; synced?: boolean; legacy?: boolean; differences?: unknown[]; legacyChars?: number; entryChars?: number }>).livingWorld
  assert.equal(livingWorldComparison?.equal, true,
    `livingWorld shadow comparison after qualification: ${JSON.stringify(livingWorldComparison)}`)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start({ STORE_LAYOUT: 'legacy' })
  qualification = await qualified()
  assert.deepEqual([qualification.code, qualification.valid, qualification.qualification], ['qualified', true, claimed.qualification])
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'entries')
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start()
  qualification = await qualified()
  assert.deepEqual([qualification.code, qualification.valid, qualification.qualification], ['qualified', true, claimed.qualification])
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'legacy')
  const recoveredReceipt = await claim(claimBody)
  assert.deepEqual([recoveredReceipt.ok, recoveredReceipt.valid, recoveredReceipt.duplicate, recoveredReceipt.qualification], [true, true, true, claimed.qualification], 'the original claim receipt and retained record survive Worker restart and layout reversal')
})
