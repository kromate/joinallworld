import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createRenderer, nextTick, ssrContextKey } from 'vue'
import type { Component } from 'vue'
import type { Api, ApiOptions } from '../../../client.ts'
import type { ApiEnvelope, CityId, OwnSession } from '../../../types/protocol.ts'
import type { DrivingSessionView } from '../../../types/living-world.ts'
import type { App } from '../../state/app.ts'
import type { DrivingInput, DrivingRoute, DrivingState } from '../../../game/living-world/driving.ts'
import { createDriving, stepDriving } from '../../../game/living-world/driving.ts'
import { barberLesson } from '../../../game/living-world/barber-catalogue.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

type HostNode = { type: string; props: Record<string, unknown>; children: HostNode[]; parent: HostNode | null; text: string }
function insertNode(node: HostNode, parent: HostNode, anchor: HostNode | null): void {
  if (node.parent) { const previous = node.parent.children.indexOf(node); if (previous >= 0) node.parent.children.splice(previous, 1) }
  const index = anchor ? parent.children.indexOf(anchor) : -1
  parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent
}
const renderer = createRenderer<HostNode, HostNode>({
  patchProp(node, key, _old, value) { node.props[key] = value }, insert: insertNode,
  remove(node) { if (!node.parent) return; const index = node.parent.children.indexOf(node); if (index >= 0) node.parent.children.splice(index, 1); node.parent = null },
  createElement(type) { return { type, props: {}, children: [], parent: null, text: '' } },
  createText(text) { return { type: '#text', props: {}, children: [], parent: null, text } },
  createComment(text) { return { type: '#comment', props: {}, children: [], parent: null, text } },
  setText(node, text) { node.text = text }, setElementText(node, text) { node.children = []; node.text = text },
  parentNode(node) { return node.parent },
  nextSibling(node) { const siblings = node.parent?.children ?? []; return siblings[siblings.indexOf(node) + 1] ?? null },
  insertStaticContent(content, parent, anchor) { const node = { type: '#static', props: {}, children: [], parent: null, text: content }; insertNode(node, parent, anchor); return [node, node] },
})
type Pending = { path: string; resolve(body: Record<string, unknown>): void }
const server = createFakeServer()
const pending = new Map<string, Pending[]>()
const intervalCallbacks = new Map<number, () => void>()
let nextIntervalId = 1
const endpoints = ['/api/living-world/driving', '/api/living-world/qualification', '/api/living-world/rental', '/api/living-world/barber']
for (const endpoint of endpoints) server.route(`GET ${endpoint}`, request => new Promise<{ status: number; body: unknown }>(resolve => {
  const queue = pending.get(endpoint) ?? []
  queue.push({ path: request.path, resolve: body => resolve({ status: 200, body }) })
  pending.set(endpoint, queue)
}))
for (const endpoint of ['/api/living-world/driving/start', '/api/living-world/driving/input']) server.route(`POST ${endpoint}`, request => new Promise<{ status: number; body: unknown }>(resolve => {
  const queue = pending.get(endpoint) ?? []
  queue.push({ path: request.path, resolve: body => resolve({ status: 200, body }) })
  pending.set(endpoint, queue)
}))

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const realFetch = globalThis.fetch
let vite: ViteDevServer
let app: App
let originalWindow: unknown, originalDocument: unknown
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !predicate(); i += 1) await Promise.resolve()
  assert.ok(predicate(), 'deferred practice request/setup did not reach the expected boundary')
}
const root = (): HostNode => ({ type: '#root', props: {}, children: [], parent: null, text: '' })
const setupValue = (setup: Record<string, unknown>, key: string): unknown => Reflect.get(setup, key)

function mount(component: Component) {
  // Exercise the real compiled SFC setup/watch/lifecycle code. The inert renderer intentionally
  // makes no claim about template rendering or browser layout.
  const setupOnly = Object.assign({}, component, { render: () => null }) as Component
  const instance = renderer.createApp(setupOnly)
  instance.provide(ssrContextKey, { modules: new Set<string>() })
  const target = root()
  instance.mount(target)
  const internals = (instance as unknown as { _instance: { setupState: Record<string, unknown> } })._instance
  assert.ok(internals?.setupState)
  return { setup: internals.setupState, unmount: () => instance.unmount() }
}

function traceApi(): { calls: { path: string; actor: string | null; current: () => boolean }[]; restore(): void } {
  const original = app.game.client.api
  const calls: { path: string; actor: string | null; current: () => boolean }[] = []
  const traced: Api = async <T extends object = Record<string, unknown>>(path: string, options?: ApiOptions, current?: () => boolean): Promise<T & ApiEnvelope> => {
    calls.push({ path, actor: app.game.view.value.session?.id ?? null, current: current ?? (() => true) })
    return original<T>(path, options, current)
  }
  app.game.client.api = traced
  return { calls, restore() { app.game.client.api = original } }
}

function resolveAt(endpoint: string, index: number, body: Record<string, unknown>): void {
  const request = pending.get(endpoint)?.[index]
  assert.ok(request, `${endpoint} request ${index}`)
  request.resolve(body)
}
function count(endpoint: string): number { return pending.get(endpoint)?.length ?? 0 }
function session(id: string): OwnSession { return { id, name: id, cities: ['lagos', 'ibadan'] } }
type IdentitySnapshot = { clientSession: OwnSession | null; clientCity: CityId; publishedSession: OwnSession | null; publishedCity: CityId; name: string }
function captureIdentity(): IdentitySnapshot {
  return { clientSession: app.game.client.session, clientCity: app.game.client.cityId,
    publishedSession: app.game.session.value, publishedCity: app.game.cityId.value, name: app.game.client.identity.name }
}
function setIdentity(next: OwnSession | null, city: CityId): void {
  app.game.client.session = next; app.game.client.cityId = city
  if (next) app.game.client.identity.name = next.name
  app.game.session.value = next; app.game.cityId.value = city
}
function restoreIdentity(snapshot: IdentitySnapshot): void {
  app.game.client.session = snapshot.clientSession; app.game.client.cityId = snapshot.clientCity
  app.game.client.identity.name = snapshot.name
  app.game.session.value = snapshot.publishedSession; app.game.cityId.value = snapshot.publishedCity
}
function drivingRoute(): DrivingRoute {
  return { id: 'district-practice', version: 'v1', roads: [[{ x: 0, z: 0 }, { x: 20, z: 0 }]],
    checkpoints: [{ id: 'finish', center: { x: 18, z: 0 }, radius: 2, stopRequired: false }], roadWidth: 8, speedLimit: 8 }
}
const route = drivingRoute()
function runningView(location: string): DrivingSessionView {
  return { journeyId: 'inflight-driving', cityId: 'lagos', location, revision: 1, nextSequence: 1,
    state: { ...createDriving(route), status: 'running', assessment: 'pending' } }
}
function drivingReply(serverTime: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: false, code: 'no_saved_lesson', reason: 'No lesson saved.', session: null, course: route, frameMs: 100, maxFrames: 5, serverTime, ...overrides }
}
function stalePassedDrivingReply(serverTime: number): Record<string, unknown> {
  const state: DrivingState = { ...createDriving(route), status: 'complete', assessment: 'passed', feedback: 'private old result' }
  return drivingReply(serverTime, { ok: true, code: 'loaded', session: { journeyId: 'private-old-journey', cityId: 'lagos', location: 'home', revision: 8, nextSequence: 1, state }, storage: 'failing' })
}
function barberReply(serverTime: number, hasReward = false): Record<string, unknown> {
  const lesson = barberLesson('basic')
  return { ok: true, code: 'loaded', session: null, plan: null,
    results: hasReward && lesson ? [{ lessonId: 'basic', styleId: lesson.resultStyleId, earnedAt: serverTime }] : [],
    starterTool: hasReward, starterToolCost: 120, serverTime }
}
function staleBarberReply(serverTime: number): Record<string, unknown> {
  return barberReply(serverTime, true)
}

before(async () => {
  globalThis.fetch = server.fetch
  originalWindow = Reflect.get(globalThis, 'window')
  originalDocument = Reflect.get(globalThis, 'document')
  Reflect.set(globalThis, 'window', {
    addEventListener() {}, removeEventListener() {},
    setInterval(callback: () => void) { const id = nextIntervalId++; intervalCallbacks.set(id, callback); return id },
    clearInterval(id: number) { intervalCallbacks.delete(id) },
  })
  Reflect.set(globalThis, 'document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  vite = await createServer({ root: repoRoot, configFile: `${repoRoot}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cities = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cities.loadCityContent('lagos'); await cities.loadCityContent('ibadan')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})

after(async () => {
  app?.game.stop()
  intervalCallbacks.clear()
  await vite?.close()
  globalThis.fetch = realFetch
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else Reflect.set(globalThis, 'window', originalWindow)
  if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document'); else Reflect.set(globalThis, 'document', originalDocument)
})

test('Driving rejects stale account/city A to B to A replies before clock or storage effects', async () => {
  pending.clear()
  const component = (await load('/src/app/features/living-world/DrivingApp.vue')).default
  const oldIdentity = captureIdentity()
  const oldStorage = app.game.storage.value, oldClientStorage = app.game.client.storage, oldOffset = app.game.client.serverTimeOffset
  setIdentity(session('practice-owner-a'), 'lagos')
  const traced = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('/api/living-world/driving') === 1)
    setIdentity(app.game.client.session, 'ibadan'); setIdentity(app.game.client.session, 'lagos')
    setIdentity(session('practice-owner-b'), 'lagos'); setIdentity(session('practice-owner-a'), 'lagos')
    await waitFor(() => count('/api/living-world/driving') === 5)
    const drivingCalls = traced.calls.filter(call => call.path.startsWith('/api/living-world/driving?city='))
    assert.equal(drivingCalls.length, 5)
    assert.deepEqual(drivingCalls.slice(0, 4).map(call => call.current()), [false, false, false, false])
    assert.equal(drivingCalls[4]?.current(), true, 'the current same-context request remains admissible')

    const staleTime = server.now() + 90_000
    for (let index = 0; index < 4; index += 1) resolveAt('/api/living-world/driving', index, stalePassedDrivingReply(staleTime))
    await Promise.resolve(); await nextTick()
    assert.equal(app.game.client.serverTimeOffset, oldOffset)
    assert.equal(app.game.client.storage, oldClientStorage)
    assert.equal(app.game.storage.value, oldStorage)
    assert.equal(setupValue(mounted.setup, 'session'), null, 'a stale passed lesson is not restored')
    assert.equal(setupValue(mounted.setup, 'retainedPass'), false)

    const currentTime = server.now() + 120_000
    resolveAt('/api/living-world/driving', 4, drivingReply(currentTime, { storage: 'failing', reason: 'current storage status' }))
    await waitFor(() => app.game.storage.value?.reason === 'current storage status')
    assert.equal(drivingCalls[4]?.current(), true)
    assert.notEqual(app.game.client.serverTimeOffset, oldOffset, 'the current response updates the trusted client clock')
    assert.equal(setupValue(mounted.setup, 'session'), null)
  } finally {
    mounted.unmount(); traced.restore()
    restoreIdentity(oldIdentity)
    app.game.storage.value = oldStorage; app.game.client.storage = oldClientStorage; app.game.client.serverTimeOffset = oldOffset
  }
})

test('Driving qualification and rental replies are fenced by synchronous context changes', async () => {
  pending.clear()
  const component = (await load('/src/app/features/living-world/DrivingApp.vue')).default
  const oldIdentity = captureIdentity()
  setIdentity(session('credential-owner-a'), 'lagos')
  const traced = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('/api/living-world/driving') === 1)
    resolveAt('/api/living-world/driving', 0, drivingReply(server.now()))
    await waitFor(() => setupValue(mounted.setup, 'busy') === false)

    const lookupQualification = Reflect.get(mounted.setup, 'lookupQualification')
    assert.equal(typeof lookupQualification, 'function')
    const beforeQualificationOffset = app.game.client.serverTimeOffset, beforeQualificationStorage = app.game.client.storage
    void (lookupQualification as () => Promise<void>)()
    await waitFor(() => count('/api/living-world/qualification') === 1)
    setIdentity(app.game.client.session, 'ibadan'); setIdentity(app.game.client.session, 'lagos')
    await waitFor(() => count('/api/living-world/driving') === 3)
    const oldQualification = traced.calls.find(call => call.path.includes('/api/living-world/qualification?'))
    assert.equal(oldQualification?.current(), false)
    const staleQualificationTime = server.now() + 80_000
    resolveAt('/api/living-world/qualification', 0, { ok: true, code: 'qualified', valid: true,
      qualification: { id: 'district-driving', version: 1, evidenceJourneyId: 'private-old-journey', earnedAt: server.now(), status: 'active' },
      serverTime: staleQualificationTime, storage: 'failing' })
    await Promise.resolve(); await nextTick()
    assert.equal(setupValue(mounted.setup, 'qualificationReply'), null)
    assert.equal(app.game.client.serverTimeOffset, beforeQualificationOffset)
    assert.equal(app.game.client.storage, beforeQualificationStorage)

    resolveAt('/api/living-world/driving', 1, drivingReply(server.now()))
    resolveAt('/api/living-world/driving', 2, drivingReply(server.now()))
    await waitFor(() => setupValue(mounted.setup, 'busy') === false)
    void (lookupQualification as () => Promise<void>)()
    await waitFor(() => count('/api/living-world/qualification') === 2)
    resolveAt('/api/living-world/qualification', 1, { ok: true, code: 'not_qualified', valid: false, qualification: null, serverTime: server.now() })
    await waitFor(() => setupValue(mounted.setup, 'qualificationReply') !== null)
    assert.equal((setupValue(mounted.setup, 'qualificationReply') as { code?: string }).code, 'not_qualified')

    const lookupRental = Reflect.get(mounted.setup, 'lookupStarterPermission')
    assert.equal(typeof lookupRental, 'function')
    const beforeRentalOffset = app.game.client.serverTimeOffset, beforeRentalStorage = app.game.client.storage
    void (lookupRental as () => Promise<void>)()
    await waitFor(() => count('/api/living-world/rental') === 1)
    setIdentity(session('credential-owner-b'), 'lagos'); setIdentity(session('credential-owner-a'), 'lagos')
    await waitFor(() => count('/api/living-world/driving') === 5)
    const oldRental = traced.calls.find(call => call.path.includes('/api/living-world/rental?'))
    assert.equal(oldRental?.current(), false)
    const staleRentalTime = server.now() + 90_000
    resolveAt('/api/living-world/rental', 0, { ok: true, code: 'permission_issued', permission: {
      actor: 'credential-owner-a', resourceId: 'marina-starter-sedan', scope: 'district-driving',
      qualificationId: 'district-driving', qualificationVersion: 1, issuedAt: server.now(), status: 'active',
    }, revision: 1, eligible: false, valid: true, tripAvailable: false, allocation: 'none', serverTime: staleRentalTime })
    await Promise.resolve(); await nextTick()
    assert.equal(setupValue(mounted.setup, 'rentalReply'), null)
    assert.equal(app.game.client.serverTimeOffset, beforeRentalOffset)
    assert.equal(app.game.client.storage, beforeRentalStorage)

    resolveAt('/api/living-world/driving', 3, drivingReply(server.now()))
    resolveAt('/api/living-world/driving', 4, drivingReply(server.now()))
    await waitFor(() => setupValue(mounted.setup, 'busy') === false)
    void (lookupRental as () => Promise<void>)()
    await waitFor(() => count('/api/living-world/rental') === 2)
    resolveAt('/api/living-world/rental', 1, { ok: true, code: 'eligible', permission: null, revision: null, eligible: true, valid: false, tripAvailable: false, allocation: 'none', serverTime: server.now() })
    await waitFor(() => setupValue(mounted.setup, 'rentalReply') !== null)
    assert.equal((setupValue(mounted.setup, 'rentalReply') as { code?: string }).code, 'eligible')
  } finally {
    mounted.unmount(); traced.restore(); restoreIdentity(oldIdentity)
  }
})

test('Driving fences an unmounted in-flight control and reconciles only while its actor still owns the request', async () => {
  pending.clear(); intervalCallbacks.clear()
  const component = (await load('/src/app/features/living-world/DrivingApp.vue')).default
  const oldIdentity = captureIdentity()
  const oldStorage = app.game.storage.value, oldClientStorage = app.game.client.storage, oldOffset = app.game.client.serverTimeOffset
  let mounted: ReturnType<typeof mount> | null = null
  let traced: ReturnType<typeof traceApi> | null = null
  const mountedForCleanup = (): ReturnType<typeof mount> | null => mounted
  const tracedForCleanup = (): ReturnType<typeof traceApi> | null => traced

  async function beginPendingControl(actor: string): Promise<{ input: Promise<void> }> {
    pending.clear(); intervalCallbacks.clear()
    setIdentity(session(actor), 'lagos')
    traced = traceApi(); mounted = mount(component)
    await waitFor(() => count('/api/living-world/driving') === 1)
    resolveAt('/api/living-world/driving', 0, drivingReply(server.now(), { ok: true, code: 'no_journey' }))
    await waitFor(() => setupValue(mounted!.setup, 'busy') === false)
    await waitFor(() => count('/api/living-world/qualification') === 1)
    resolveAt('/api/living-world/qualification', 0, { ok: true, code: 'not_qualified', valid: false, qualification: null, serverTime: server.now() })
    await waitFor(() => count('/api/living-world/rental') === 1)
    resolveAt('/api/living-world/rental', 0, { ok: true, code: 'eligible', permission: null, revision: null, eligible: true, valid: false, tripAvailable: false, allocation: 'none', serverTime: server.now() })

    const scene = { present() {}, setInput() {}, setReducedMotion() {}, begin(ready?: () => void) { ready?.() }, exit() {}, setVisible() {}, resize() {}, dispose() {} }
    Reflect.set(mounted!.setup, 'scene', scene)
    assert.equal(setupValue(mounted!.setup, 'canStart'), true)
    const location = app.game.state.value.location
    const start = setupValue(mounted!.setup, 'startLesson') as () => Promise<void>
    const starting = start()
    await waitFor(() => count('/api/living-world/driving/start') === 1)
    const started = runningView(location)
    resolveAt('/api/living-world/driving/start', 0, drivingReply(server.now(), { ok: true, code: 'started', session: started }))
    await starting
    assert.equal(setupValue(mounted!.setup, 'active'), true)

    const touchDown = setupValue(mounted!.setup, 'touchDown') as (control: 'throttle', event: PointerEvent) => void
    touchDown('throttle', { currentTarget: { setPointerCapture() {} }, pointerId: 41 } as unknown as PointerEvent)
    const sample = [...intervalCallbacks.values()][0]
    assert.ok(sample, 'the mounted SFC starts its real bounded control sampling timer')
    sample()
    const frames = setupValue(mounted!.setup, 'pendingFrames') as DrivingInput[]
    assert.equal(frames.length, 1)
    assert.equal(frames[0]?.throttle, 1, 'the real touch handler contributes the held throttle input')

    const sendFrames = setupValue(mounted!.setup, 'sendFrames') as () => Promise<void>
    const input = sendFrames()
    await waitFor(() => count('/api/living-world/driving/input') === 1)
    const sent = server.requests.find(request => request.method === 'POST' && request.path === '/api/living-world/driving/input')
    assert.ok(sent?.body)
    assert.equal(sent.body.journeyId, started.journeyId)
    assert.equal(sent.body.sequence, started.nextSequence)
    assert.deepEqual(sent.body.frames, [{ throttle: 1, brake: 0, steer: 0 }])
    const controlCall = traced!.calls.find(call => call.path === '/api/living-world/driving/input')
    assert.equal(controlCall?.actor, actor)
    assert.equal(controlCall?.current(), true)
    return { input }
  }

  try {
    // When the same account closes the view during a pending input, wait for that input to settle,
    // then issue one fresh read. The disposed view must not adopt that read or its envelope.
    const sameActor = 'driving-close-owner'
    const first = await beginPendingControl(sameActor)
    const sessionBeforeClose = setupValue(mounted!.setup, 'session')
    const offsetBeforeClose = app.game.client.serverTimeOffset, storageBeforeClose = app.game.client.storage
    const lifeStorageBeforeClose = app.game.storage.value
    mounted!.unmount()
    const firstControl = server.requests.find(request => request.method === 'POST' && request.path === '/api/living-world/driving/input')!.body!
    const firstFrame: DrivingInput = { throttle: 1, brake: 0, steer: 0 }
    assert.deepEqual(firstControl.frames, [firstFrame])
    const updatedState = stepDriving((sessionBeforeClose as DrivingSessionView).state, firstFrame, route).state
    const updated = { ...(sessionBeforeClose as DrivingSessionView), revision: 2, nextSequence: 2, state: updatedState }
    resolveAt('/api/living-world/driving/input', 0, drivingReply(server.now() + 120_000, { ok: true, code: 'updated', session: updated, storage: 'failing' }))
    await waitFor(() => count('/api/living-world/driving') === 2)
    const reads = traced!.calls.filter(call => call.path.startsWith('/api/living-world/driving?city='))
    assert.equal(reads.length, 2, 'one post-settlement reconciliation read follows the original load')
    assert.equal(reads[1]?.actor, sameActor)
    assert.equal(reads[1]?.current(), false, 'the reconciliation reply belongs to an unmounted view')
    const paused = { ...updated, state: { ...updated.state, status: 'paused' as const } }
    resolveAt('/api/living-world/driving', 1, drivingReply(server.now() + 180_000, { ok: true, code: 'loaded', session: paused, storage: 'failing' }))
    await first.input
    await Promise.resolve(); await nextTick()
    assert.equal(traced!.calls.find(call => call.path === '/api/living-world/driving/input' && call.actor === sameActor)?.current(), false)
    assert.equal(setupValue(mounted!.setup, 'session'), sessionBeforeClose, 'late control and reconciliation replies do not replace the last accepted view state')
    assert.equal(setupValue(mounted!.setup, 'retainedPass'), false)
    assert.equal(app.game.client.serverTimeOffset, offsetBeforeClose)
    assert.equal(app.game.client.storage, storageBeforeClose)
    assert.equal(app.game.storage.value, lifeStorageBeforeClose)
    traced!.restore(); traced = null; mounted = null

    // If account ownership changes before the pending control settles, no follow-up request may
    // be sent on behalf of the old actor. The new actor's ordinary load is separate and fenced.
    const oldActor = 'driving-replaced-owner'
    const second = await beginPendingControl(oldActor)
    const secondOffset = app.game.client.serverTimeOffset, secondStorage = app.game.client.storage
    const secondLifeStorage = app.game.storage.value
    const secondPrior = setupValue(mounted!.setup, 'session') as DrivingSessionView
    setIdentity(session('driving-new-owner'), 'lagos')
    await waitFor(() => count('/api/living-world/driving') === 2)
    const callsBeforeSettle = traced!.calls.length
    mounted!.unmount()
    const secondRequest = server.requests.filter(request => request.method === 'POST' && request.path === '/api/living-world/driving/input')[1]!.body!
    const secondFrame: DrivingInput = { throttle: 1, brake: 0, steer: 0 }
    assert.deepEqual(secondRequest.frames, [secondFrame])
    const secondState = stepDriving(secondPrior.state, secondFrame, route).state
    const secondUpdated = { ...secondPrior, revision: secondPrior.revision + 1, nextSequence: secondPrior.nextSequence + 1, state: secondState }
    resolveAt('/api/living-world/driving/input', 0, drivingReply(server.now() + 220_000, { ok: true, code: 'updated', session: secondUpdated, storage: 'failing' }))
    await second.input
    await Promise.resolve(); await nextTick()
    assert.deepEqual(traced!.calls.slice(callsBeforeSettle).filter(call => call.actor === oldActor), [], 'settling an old actor control starts no cleanup or reconciliation request for that actor')
    assert.equal(setupValue(mounted!.setup, 'session'), null, 'the replacement context is not repopulated by the old control')
    assert.equal(app.game.client.serverTimeOffset, secondOffset)
    assert.equal(app.game.client.storage, secondStorage)
    assert.equal(app.game.storage.value, secondLifeStorage)
    assert.equal(traced!.calls.find(call => call.path === '/api/living-world/driving/input' && call.actor === oldActor)?.current(), false)
    resolveAt('/api/living-world/driving', 1, drivingReply(server.now() + 260_000))
  } finally {
    const mountedAtCleanup = mountedForCleanup(), tracedAtCleanup = tracedForCleanup()
    if (mountedAtCleanup) mountedAtCleanup.unmount()
    if (tracedAtCleanup) tracedAtCleanup.restore()
    intervalCallbacks.clear()
    restoreIdentity(oldIdentity)
    app.game.storage.value = oldStorage; app.game.client.storage = oldClientStorage; app.game.client.serverTimeOffset = oldOffset
  }
})

test('Barber does not revive a stale claimed result and rejects a late unmount reply', async () => {
  pending.clear()
  const component = (await load('/src/app/features/living-world/BarberApp.vue')).default
  const oldIdentity = captureIdentity()
  const oldStorage = app.game.storage.value, oldClientStorage = app.game.client.storage, oldOffset = app.game.client.serverTimeOffset
  setIdentity(session('barber-owner-a'), 'lagos')
  const traced = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('/api/living-world/barber') === 1)
    setIdentity(session('barber-owner-b'), 'lagos'); setIdentity(session('barber-owner-a'), 'lagos')
    await waitFor(() => count('/api/living-world/barber') === 3)
    const barberCalls = traced.calls.filter(call => call.path.startsWith('/api/living-world/barber?city='))
    assert.deepEqual(barberCalls.map(call => call.current()), [false, false, true])
    resolveAt('/api/living-world/barber', 0, staleBarberReply(server.now() + 100_000))
    resolveAt('/api/living-world/barber', 1, staleBarberReply(server.now() + 100_000))
    await Promise.resolve(); await nextTick()
    assert.equal(app.game.client.serverTimeOffset, oldOffset)
    assert.equal(app.game.client.storage, oldClientStorage)
    assert.equal(app.game.storage.value, oldStorage)
    assert.equal(setupValue(mounted.setup, 'reply'), null, 'stale claimed mannequin earnings are not restored')

    resolveAt('/api/living-world/barber', 2, barberReply(server.now()))
    await waitFor(() => setupValue(mounted.setup, 'reply') !== null)
    const acceptedOffset = app.game.client.serverTimeOffset
    const acceptedStorage = app.game.client.storage
    const load = Reflect.get(mounted.setup, 'load')
    assert.equal(typeof load, 'function')
    const pendingLoad = (load as () => Promise<void>)()
    await waitFor(() => count('/api/living-world/barber') === 4)
    const lateCall = traced.calls.filter(call => call.path.startsWith('/api/living-world/barber?city='))[3]
    mounted.unmount()
    resolveAt('/api/living-world/barber', 3, staleBarberReply(server.now() + 110_000))
    await pendingLoad
    assert.equal(lateCall?.current(), false)
    assert.deepEqual((setupValue(mounted.setup, 'reply') as { results: unknown[] }).results, [], 'an unmounted view retains only its already accepted empty reply')
    assert.equal(app.game.client.serverTimeOffset, acceptedOffset)
    assert.equal(app.game.client.storage, acceptedStorage)
  } finally {
    mounted.unmount(); traced.restore(); restoreIdentity(oldIdentity)
    app.game.storage.value = oldStorage; app.game.client.storage = oldClientStorage; app.game.client.serverTimeOffset = oldOffset
  }
})
