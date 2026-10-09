import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createRenderer, ssrContextKey } from 'vue'
import type { Component } from 'vue'
import type { Api, ApiOptions } from '../../../client.ts'
import type { ApiEnvelope, CityId, OwnSession } from '../../../types/protocol.ts'
import type { ActiveTerm, CourseId } from '../../../types/campus.ts'
import type { LifeState } from '../../../types/life.ts'
import type { AssessmentOperation, AssessmentResponse } from '../../../types/living-world-assessment.ts'
import { PROGRAMMES, UNILAG_BETA_RULES } from '../../../campus/unilag/curriculum.ts'
import { assessmentPracticeView, startAssessmentPractice, stepAssessmentPractice } from '../../../campus/unilag/assessment-practice.ts'
import type { AssessmentPracticeState } from '../../../campus/unilag/assessment-practice.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

type HostNode = { type: string; props: Record<string, unknown>; children: HostNode[]; parent: HostNode | null; text: string }
function insertNode(node: HostNode, parent: HostNode, anchor: HostNode | null): void {
  if (node.parent) { const old = node.parent.children.indexOf(node); if (old >= 0) node.parent.children.splice(old, 1) }
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
  parentNode(node) { return node.parent }, nextSibling(node) { const list = node.parent?.children ?? []; return list[list.indexOf(node) + 1] ?? null },
  insertStaticContent(content, parent, anchor) { const node = { type: '#static', props: {}, children: [], parent: null, text: content }; insertNode(node, parent, anchor); return [node, node] },
})
type Pending = { resolve(status: number, body: Record<string, unknown>): void }
const endpoint = '/api/living-world/assessment'
const server = createFakeServer()
const requests = new Map<string, Pending[]>()
server.route(`GET ${endpoint}`, () => new Promise(resolve => {
  const queue = requests.get('GET') ?? []
  queue.push({ resolve: (status, body) => resolve({ status, body }) }); requests.set('GET', queue)
}))
for (const path of [`${endpoint}/start`, `${endpoint}/step`]) server.route(`POST ${path}`, () => new Promise(resolve => {
  const queue = requests.get(path) ?? []
  queue.push({ resolve: (status, body) => resolve({ status, body }) }); requests.set(path, queue)
}))

const rootPath = fileURLToPath(new URL('../../../..', import.meta.url))
const realFetch = globalThis.fetch
let originalWindow: unknown, originalDocument: unknown
let vite: ViteDevServer
let app: App
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !predicate(); i += 1) await Promise.resolve()
  assert.ok(predicate(), 'assessment component did not reach expected request/state boundary')
}
const setupValue = (setup: Record<string, unknown>, key: string): unknown => Reflect.get(setup, key)
function mount(component: Component) {
  // Run the actual compiled SFC setup/watch/lifecycle with an inert renderer; this makes no layout claim.
  const instance = renderer.createApp(Object.assign({}, component, { render: () => null }) as Component)
  instance.provide(ssrContextKey, { modules: new Set<string>() })
  const host: HostNode = { type: '#root', props: {}, children: [], parent: null, text: '' }
  instance.mount(host)
  const internal = (instance as unknown as { _instance: { setupState: Record<string, unknown> } })._instance
  assert.ok(internal?.setupState)
  return { setup: internal.setupState, unmount: () => instance.unmount() }
}
function traceApi(): { calls: { path: string; current: () => boolean; settled: boolean }[]; restore(): void } {
  const original = app.game.client.api
  const calls: { path: string; current: () => boolean; settled: boolean }[] = []
  const traced: Api = async <T extends object = Record<string, unknown>>(path: string, options?: ApiOptions, current?: () => boolean): Promise<T & ApiEnvelope> => {
    const call = { path, current: current ?? (() => true), settled: false }
    calls.push(call)
    try { return await original<T>(path, options, current) }
    finally { call.settled = true }
  }
  app.game.client.api = traced
  return { calls, restore() { app.game.client.api = original } }
}
function count(key: string): number { return requests.get(key)?.length ?? 0 }
function resolveAt(key: string, index: number, status: number, body: Record<string, unknown>): void {
  const pending = requests.get(key)?.[index]
  assert.ok(pending, `expected pending ${key} request ${index}`)
  pending.resolve(status, body)
}
function session(id: string): OwnSession { return { id, name: id, cities: ['lagos', 'ibadan'] } }
type Identity = { client: OwnSession | null; clientCity: CityId; published: OwnSession | null; publishedCity: CityId; name: string }
function captureIdentity(): Identity {
  return { client: app.game.client.session, clientCity: app.game.client.cityId, published: app.game.session.value,
    publishedCity: app.game.cityId.value, name: app.game.client.identity.name }
}
function setIdentity(next: OwnSession | null, city: CityId): void {
  app.game.client.session = next; app.game.client.cityId = city
  if (next) app.game.client.identity.name = next.name
  app.game.session.value = next; app.game.cityId.value = city
}
function restoreIdentity(value: Identity): void {
  app.game.client.session = value.client; app.game.client.cityId = value.clientCity; app.game.client.identity.name = value.name
  app.game.session.value = value.published; app.game.cityId.value = value.publishedCity
}
function registeredLife(base: LifeState): LifeState {
  const state = structuredClone(base)
  const student = state.unilagStudent, courses = PROGRAMMES.computer.semesters[0]!.courses
  const attendance = {} as ActiveTerm['attendance'], study = {} as ActiveTerm['study'], assessments = {} as ActiveTerm['assessments']
  for (const course of courses) {
    attendance[course.id] = []; study[course.id] = 0; assessments[course.id] = { assignment: null, test: null }
  }
  student.status = 'studying'; student.programme = 'computer'
  student.term = { semester: 1, attempt: 1, startDay: 123, deferredDays: 0, deadlineDay: 200,
    registeredCourses: courses.map(course => course.id as CourseId), attendance, study, assessments, deferredAtDay: null }
  state.location = 'unilag'; state.spot = 'engineering'; state.activeAction = null
  return state
}
function setRegisteredLife(): { game: LifeState; client: LifeState } {
  const old = { game: app.game.state.value, client: app.game.client.state }
  const state = registeredLife(old.game)
  app.game.state.value = state; app.game.client.state = state
  return old
}
function restoreLife(old: { game: LifeState; client: LifeState }): void {
  app.game.state.value = old.game; app.game.client.state = old.client
}
const currentTerm = { semester: 1 as const, startDay: 123, courseId: 'cpe-101' as const }
function response(practice: AssessmentPracticeState | null, mark: number | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ok: true, code: practice?.phase === 'complete' ? 'completed' : practice ? 'practice_loaded' : 'assessment_ready',
    term: currentTerm, practice: practice ? assessmentPracticeView(practice) : null,
    revision: practice?.revision ?? null, assignmentMark: mark, ...overrides }
}
function completePractice(actorId: string): AssessmentPracticeState {
  let state = startAssessmentPractice(actorId), id = 0
  const apply = (operation: AssessmentOperation) => {
    const result = stepAssessmentPractice(state, actorId, { ...operation, requestId: `assessment-${++id}`, expectedRevision: state.revision })
    assert.equal(result.ok, true, result.code); state = result.state
  }
  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) apply({ kind: 'probe', a, b })
  apply({ kind: 'inspect', a: false, b: true }); apply({ kind: 'repair', gate: 'and' })
  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) apply({ kind: 'probe', a, b })
  apply({ kind: 'submit' })
  return state
}

before(async () => {
  globalThis.fetch = server.fetch
  originalWindow = Reflect.get(globalThis, 'window'); originalDocument = Reflect.get(globalThis, 'document')
  Reflect.set(globalThis, 'window', { addEventListener() {}, removeEventListener() {} })
  Reflect.set(globalThis, 'document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  vite = await createServer({ root: rootPath, configFile: `${rootPath}vite.config.ts`, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cities = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cities.loadCityContent('lagos'); await cities.loadCityContent('ibadan')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true); app.game.stop()
})

after(async () => {
  app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else Reflect.set(globalThis, 'window', originalWindow)
  if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document'); else Reflect.set(globalThis, 'document', originalDocument)
})

test('Assessment identity A to B to C and unmounted terminal replies are fenced before effects', async () => {
  requests.clear()
  const component = (await load('/src/app/features/campus/CampusAssignment.vue')).default
  const oldIdentity = captureIdentity(), oldLife = setRegisteredLife()
  const oldOffset = app.game.client.serverTimeOffset, oldClientStorage = app.game.client.storage, oldGameStorage = app.game.storage.value
  const oldRefresh = app.game.refresh
  let refreshCalls = 0
  app.game.refresh = async () => { refreshCalls += 1; return true }
  setIdentity(session('assessment-owner-a'), 'lagos')
  const trace = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('GET') === 1)
    setIdentity(session('assessment-owner-b'), 'lagos')
    await waitFor(() => count('GET') === 2)
    setIdentity(session('assessment-owner-c'), 'lagos')
    await waitFor(() => count('GET') === 3)
    const reads = trace.calls.filter(call => call.path.startsWith(`${endpoint}?city=`))
    assert.deepEqual(reads.map(call => call.current()), [false, false, true])

    const doneA = completePractice('assessment-owner-a'), doneB = completePractice('assessment-owner-b')
    resolveAt('GET', 0, 200, response(doneA, UNILAG_BETA_RULES.assignmentWeight, { serverTime: server.now() + 90_000, storage: 'failing' }))
    resolveAt('GET', 1, 200, response(doneB, UNILAG_BETA_RULES.assignmentWeight, { serverTime: server.now() + 80_000, storage: 'failing' }))
    await waitFor(() => reads[0]?.settled === true && reads[1]?.settled === true)
    assert.equal(app.game.client.serverTimeOffset, oldOffset)
    assert.equal(app.game.client.storage, oldClientStorage)
    assert.equal(app.game.storage.value, oldGameStorage)
    assert.equal(setupValue(mounted.setup, 'reply'), null)
    assert.equal(refreshCalls, 0, 'stale completion does not refresh a course record')

    resolveAt('GET', 2, 200, response(completePractice('assessment-owner-c'), UNILAG_BETA_RULES.assignmentWeight,
      { serverTime: server.now() + 10_000 }))
    await waitFor(() => setupValue(mounted.setup, 'reply') !== null && refreshCalls === 1)
    assert.equal(reads[2]?.current(), true)
    assert.equal((setupValue(mounted.setup, 'reply') as AssessmentResponse).assignmentMark, UNILAG_BETA_RULES.assignmentWeight)
    assert.equal(refreshCalls, 1, 'the current terminal mark refreshes the course record once')

    const load = setupValue(mounted.setup, 'load') as () => Promise<void>
    const lateLoad = load()
    await waitFor(() => count('GET') === 4)
    const lateRead = trace.calls.filter(call => call.path.startsWith(`${endpoint}?city=`))[3]
    const acceptedReply = setupValue(mounted.setup, 'reply')
    const acceptedOffset = app.game.client.serverTimeOffset, acceptedStorage = app.game.client.storage
    mounted.unmount()
    resolveAt('GET', 3, 200, response(completePractice('assessment-owner-c'), UNILAG_BETA_RULES.assignmentWeight,
      { serverTime: server.now() + 150_000, storage: 'failing' }))
    await lateLoad
    assert.equal(lateRead?.current(), false)
    assert.equal(setupValue(mounted.setup, 'reply'), acceptedReply)
    assert.equal(app.game.client.serverTimeOffset, acceptedOffset)
    assert.equal(app.game.client.storage, acceptedStorage)
    assert.equal(refreshCalls, 1, 'unmounted terminal reply causes no second refresh')
  } finally {
    mounted.unmount(); trace.restore(); app.game.refresh = oldRefresh
    restoreIdentity(oldIdentity); restoreLife(oldLife)
    app.game.client.serverTimeOffset = oldOffset; app.game.client.storage = oldClientStorage; app.game.storage.value = oldGameStorage
  }
})

test('Assessment uncertain step keeps its receipt on unchanged revision and clears it after canonical progress', async () => {
  requests.clear()
  const component = (await load('/src/app/features/campus/CampusAssignment.vue')).default
  const oldIdentity = captureIdentity(), oldLife = setRegisteredLife()
  setIdentity(session('assessment-retry-owner'), 'lagos')
  const trace = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('GET') === 1)
    resolveAt('GET', 0, 200, response(null, null))
    await waitFor(() => setupValue(mounted.setup, 'busy') === false)
    const start = setupValue(mounted.setup, 'start') as () => Promise<void>
    const starting = start()
    await waitFor(() => count(`${endpoint}/start`) === 1)
    const startRequest = server.requests.filter(request => request.method === 'POST' && request.path === `${endpoint}/start`)[0]
    assert.equal(startRequest?.body?.cityId, 'lagos')
    const actor = 'assessment-retry-owner'
    resolveAt(`${endpoint}/start`, 0, 200, response(startAssessmentPractice(actor), null, { code: 'started' }))
    await starting
    await waitFor(() => setupValue(mounted.setup, 'reply') !== null)

    const operation: AssessmentOperation = { kind: 'probe', a: false, b: false }
    const step = setupValue(mounted.setup, 'step') as (operation: AssessmentOperation) => Promise<void>
    const uncertain = step(operation)
    await waitFor(() => count(`${endpoint}/step`) === 1)
    const firstRequest = server.requests.filter(request => request.method === 'POST' && request.path === `${endpoint}/step`)[0]
    assert.deepEqual(firstRequest?.body?.operation, operation)
    const requestId = firstRequest?.body?.requestId
    assert.equal(typeof requestId, 'string')
    resolveAt(`${endpoint}/step`, 0, 503, { error: 'storage_unavailable', code: 'storage_unavailable', serverTime: server.now() })
    await uncertain
    assert.equal(setupValue(mounted.setup, 'online'), false)
    assert.equal((setupValue(mounted.setup, 'attempt') as { requestId: string }).requestId, requestId)

    const load = setupValue(mounted.setup, 'load') as () => Promise<void>
    const unchanged = load()
    await waitFor(() => count('GET') === 2)
    resolveAt('GET', 1, 200, response(startAssessmentPractice(actor), null))
    await unchanged
    assert.equal((setupValue(mounted.setup, 'attempt') as { requestId: string }).requestId, requestId,
      'same canonical revision retains the uncertain request identity')
    assert.equal(setupValue(mounted.setup, 'needsRefresh'), false)

    const retry = setupValue(mounted.setup, 'retryPending') as () => void
    retry()
    await waitFor(() => count(`${endpoint}/step`) === 2)
    const retryRequest = server.requests.filter(request => request.method === 'POST' && request.path === `${endpoint}/step`)[1]
    assert.equal(retryRequest?.body?.requestId, requestId)
    assert.deepEqual(retryRequest?.body?.operation, operation)
    resolveAt(`${endpoint}/step`, 1, 503, { error: 'storage_unavailable', code: 'storage_unavailable', serverTime: server.now() })
    await waitFor(() => setupValue(mounted.setup, 'busy') === false)

    const committed = stepAssessmentPractice(startAssessmentPractice(actor), actor, {
      kind: 'probe', requestId: String(requestId), expectedRevision: 1, a: false, b: false,
    })
    assert.equal(committed.ok, true)
    const reconcile = load()
    await waitFor(() => count('GET') === 3)
    resolveAt('GET', 2, 200, response(committed.state, null))
    await reconcile
    assert.equal((setupValue(mounted.setup, 'reply') as AssessmentResponse).revision, 2)
    assert.equal(setupValue(mounted.setup, 'attempt'), null, 'newer canonical progress retires the uncertain receipt')
    retry()
    assert.equal(count(`${endpoint}/step`), 2, 'a reconciled operation cannot be submitted again')
    assert.ok(trace.calls.every(call => call.current()), 'all same-context reads and writes remain admissible')
  } finally { mounted.unmount(); trace.restore(); restoreIdentity(oldIdentity); restoreLife(oldLife) }
})

test('Assessment failed saved-record reads fail closed without enabling start or refreshing a mark', async () => {
  requests.clear()
  const component = (await load('/src/app/features/campus/CampusAssignment.vue')).default
  const oldIdentity = captureIdentity(), oldLife = setRegisteredLife()
  setIdentity(session('assessment-quarantine-owner'), 'lagos')
  const trace = traceApi(), mounted = mount(component)
  let refreshCalls = 0
  const oldRefresh = app.game.refresh
  app.game.refresh = async () => { refreshCalls += 1; return true }
  try {
    await waitFor(() => count('GET') === 1)
    resolveAt('GET', 0, 200, response(null, null, { ok: false, code: 'invalid_saved_assessment' }))
    await waitFor(() => setupValue(mounted.setup, 'needsRefresh') === true)
    assert.equal(setupValue(mounted.setup, 'reply'), null)
    assert.equal(setupValue(mounted.setup, 'canStart'), false)
    assert.equal(refreshCalls, 0)

    const load = setupValue(mounted.setup, 'load') as () => Promise<void>
    const mismatch = load()
    await waitFor(() => count('GET') === 2)
    resolveAt('GET', 1, 200, response(null, UNILAG_BETA_RULES.assignmentWeight,
      { ok: false, code: 'assessment_record_mismatch' }))
    await mismatch
    assert.equal(setupValue(mounted.setup, 'reply'), null)
    assert.equal(setupValue(mounted.setup, 'canStart'), false)
    assert.equal(refreshCalls, 0)
    assert.ok(trace.calls.every(call => call.current()))
  } finally {
    mounted.unmount(); trace.restore(); app.game.refresh = oldRefresh
    restoreIdentity(oldIdentity); restoreLife(oldLife)
  }
})
