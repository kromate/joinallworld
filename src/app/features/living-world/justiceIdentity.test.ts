import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createRenderer, nextTick, ssrContextKey } from 'vue'
import type { Component } from 'vue'
import type { Api, ApiOptions } from '../../../client.ts'
import type { ApiEnvelope, CityId, OwnSession } from '../../../types/protocol.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

type HostNode = { type: string; props: Record<string, unknown>; children: HostNode[]; parent: HostNode | null; text: string }
function insertNode(node: HostNode, parent: HostNode, anchor: HostNode | null): void {
  if (node.parent) { const prior = node.parent.children.indexOf(node); if (prior >= 0) node.parent.children.splice(prior, 1) }
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
type Pending = { resolve(status: number, body: unknown): void }
const server = createFakeServer()
const requests = new Map<string, Pending[]>()
for (const endpoint of ['/api/living-world/justice-practice']) {
  server.route(`GET ${endpoint}`, () => new Promise(resolve => {
    const queue = requests.get(endpoint) ?? []
    queue.push({ resolve: (status, body) => resolve({ status, body }) }); requests.set(endpoint, queue)
  }))
}
for (const endpoint of ['/api/living-world/justice-practice/start', '/api/living-world/justice-practice/step']) {
  server.route(`POST ${endpoint}`, () => new Promise(resolve => {
    const queue = requests.get(endpoint) ?? []
    queue.push({ resolve: (status, body) => resolve({ status, body }) }); requests.set(endpoint, queue)
  }))
}
const rootPath = fileURLToPath(new URL('../../../..', import.meta.url))
const originalFetch = globalThis.fetch
let originalWindow: unknown, originalDocument: unknown
let vite: ViteDevServer
let app: App
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !predicate(); i += 1) await Promise.resolve()
  assert.ok(predicate(), 'justice component did not reach expected request/state boundary')
}
const setupValue = (setup: Record<string, unknown>, key: string): unknown => Reflect.get(setup, key)
function mount(component: Component) {
  // Executes the compiled SFC setup/watch/lifecycle code; this inert host makes no layout claim.
  const appInstance = renderer.createApp(Object.assign({}, component, { render: () => null }) as Component)
  appInstance.provide(ssrContextKey, { modules: new Set<string>() })
  const instanceRoot: HostNode = { type: '#root', props: {}, children: [], parent: null, text: '' }
  appInstance.mount(instanceRoot)
  const internal = (appInstance as unknown as { _instance: { setupState: Record<string, unknown> } })._instance
  assert.ok(internal?.setupState)
  return { setup: internal.setupState, unmount: () => appInstance.unmount() }
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
function resolve(index: number, status: number, body: unknown): void {
  const request = requests.get('/api/living-world/justice-practice')?.[index]
  assert.ok(request, `justice GET ${index}`); request.resolve(status, body)
}
function resolveStart(index: number, status: number, body: unknown): void {
  const request = requests.get('/api/living-world/justice-practice/start')?.[index]
  assert.ok(request, `justice start ${index}`); request.resolve(status, body)
}
function resolveStep(index: number, status: number, body: unknown): void {
  const request = requests.get('/api/living-world/justice-practice/step')?.[index]
  assert.ok(request, `justice step ${index}`); request.resolve(status, body)
}
function count(path: string): number { return requests.get(path)?.length ?? 0 }
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
const initialView = (revision = 0, reviewedEvidenceIds: string[] = []) => ({
  caseId: 'fictional-shipment-review-01', title: 'The duplicate tally', disclaimer: 'Fictional process-training exercise.',
  summary: 'Compare the fictional sample records.', phase: 'inspect-initial', revision, prompt: 'Inspect each record.',
  evidence: [
    { id: 'dispatch-copy', label: 'Dispatch copy', text: 'Ten parcels were dispatched.' },
    { id: 'arrival-receipt', label: 'Arrival receipt', text: 'Twelve parcels were received.' },
    { id: 'seal-log', label: 'Seal log', text: 'The seal was intact.' },
  ], reviewedEvidenceIds, initialChoices: [], reviewChoices: [], serviceNotice: null, npcReviewRequest: null, trainingComplete: false,
})
function reply(serverTime: number, practice: unknown = null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { serverTime, ok: true, code: practice ? 'practice_loaded' : 'practice_ready', practice,
    revision: practice ? (practice as { revision: number }).revision : null, ...overrides }
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
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})

after(async () => {
  app?.game.stop(); await vite?.close(); globalThis.fetch = originalFetch
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else Reflect.set(globalThis, 'window', originalWindow)
  if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document'); else Reflect.set(globalThis, 'document', originalDocument)
})

test('Justice rejects actor A to B to A and unmounted replies before API envelope side effects', async () => {
  requests.clear()
  const component = (await load('/src/app/features/living-world/JusticeApp.vue')).default
  const priorIdentity = captureIdentity(), priorStorage = app.game.client.storage, priorLifeStorage = app.game.storage.value
  const priorOffset = app.game.client.serverTimeOffset
  setIdentity(session('justice-owner-a'), 'lagos')
  const traced = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('/api/living-world/justice-practice') === 1)
    setIdentity(session('justice-owner-b'), 'lagos'); setIdentity(session('justice-owner-a'), 'lagos')
    await waitFor(() => count('/api/living-world/justice-practice') === 3)
    const gets = traced.calls.filter(call => call.path.startsWith('/api/living-world/justice-practice?'))
    assert.deepEqual(gets.map(call => call.current()), [false, false, true])
    resolve(0, 200, reply(server.now() + 90_000, initialView(9, ['dispatch-copy']), { storage: 'failing' }))
    resolve(1, 200, reply(server.now() + 90_000, initialView(8), { storage: 'failing' }))
    await Promise.resolve(); await nextTick()
    assert.equal(app.game.client.serverTimeOffset, priorOffset)
    assert.equal(app.game.client.storage, priorStorage)
    assert.equal(app.game.storage.value, priorLifeStorage)
    assert.equal(setupValue(mounted.setup, 'reply'), null)

    const freshTime = server.now() + 100_000
    resolve(2, 200, reply(freshTime, initialView()))
    await waitFor(() => setupValue(mounted.setup, 'reply') !== null)
    const acceptedOffset = app.game.client.serverTimeOffset, acceptedStorage = app.game.client.storage
    const loadSaved = setupValue(mounted.setup, 'load') as () => Promise<void>
    const lateLoad = loadSaved()
    await waitFor(() => count('/api/living-world/justice-practice') === 4)
    const lateCall = traced.calls.filter(call => call.path.startsWith('/api/living-world/justice-practice?'))[3]
    mounted.unmount()
    resolve(3, 200, reply(server.now() + 150_000, initialView(1, ['dispatch-copy']), { storage: 'failing' }))
    await lateLoad
    assert.equal(lateCall?.current(), false)
    assert.equal((setupValue(mounted.setup, 'reply') as { practice: { revision: number } }).practice.revision, 0)
    assert.equal(app.game.client.serverTimeOffset, acceptedOffset)
    assert.equal(app.game.client.storage, acceptedStorage)
  } finally { mounted.unmount(); traced.restore(); restoreIdentity(priorIdentity); app.game.storage.value = priorLifeStorage; app.game.client.storage = priorStorage; app.game.client.serverTimeOffset = priorOffset }
})

test('Justice retries an interrupted step with the same ID and adopts saved evidence after refresh', async () => {
  requests.clear()
  const component = (await load('/src/app/features/living-world/JusticeApp.vue')).default
  const priorIdentity = captureIdentity(); setIdentity(session('justice-retry-owner'), 'lagos')
  const traced = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('/api/living-world/justice-practice') === 1)
    resolve(0, 200, reply(server.now(), initialView()))
    await waitFor(() => setupValue(mounted.setup, 'busy') === false)
    const submit = setupValue(mounted.setup, 'submit') as (action: { kind: 'inspect'; evidenceId: 'dispatch-copy' }) => Promise<void>
    const failed = submit({ kind: 'inspect', evidenceId: 'dispatch-copy' })
    await waitFor(() => count('/api/living-world/justice-practice/step') === 1)
    const firstRequest = server.requests.filter(item => item.method === 'POST' && item.path.endsWith('/step'))[0]
    assert.ok(firstRequest?.body)
    const actionRequestId = firstRequest.body.requestId
    resolveStep(0, 503, { error: 'storage_unavailable' })
    await failed
    assert.equal(setupValue(mounted.setup, 'online'), false)
    assert.ok(setupValue(mounted.setup, 'pending'))

    const loadSaved = setupValue(mounted.setup, 'load') as () => Promise<void>
    const refresh = loadSaved()
    await waitFor(() => count('/api/living-world/justice-practice') === 2)
    resolve(1, 200, reply(server.now(), initialView()))
    await refresh
    assert.ok(setupValue(mounted.setup, 'pending'), 'unchanged canonical revision preserves the exact uncertain attempt')
    assert.equal(setupValue(mounted.setup, 'needsRefresh'), false)

    const retry = setupValue(mounted.setup, 'retryPending') as () => void
    retry()
    await waitFor(() => count('/api/living-world/justice-practice/step') === 2)
    const retryRequest = server.requests.filter(item => item.method === 'POST' && item.path.endsWith('/step'))[1]
    assert.equal(retryRequest?.body?.requestId, actionRequestId)
    assert.deepEqual(retryRequest?.body?.action, { kind: 'inspect', evidenceId: 'dispatch-copy' })
    resolveStep(1, 200, reply(server.now(), initialView(1, ['dispatch-copy']), { code: 'advanced', feedback: 'Record inspected.' }))
    await waitFor(() => (setupValue(mounted.setup, 'reply') as { revision: number }).revision === 1)
    assert.equal(setupValue(mounted.setup, 'pending'), null)
    assert.deepEqual((setupValue(mounted.setup, 'reply') as { practice: { reviewedEvidenceIds: string[] } }).practice.reviewedEvidenceIds, ['dispatch-copy'])
  } finally { mounted.unmount(); traced.restore(); restoreIdentity(priorIdentity) }
})

test('a newer context load cannot be replaced by a late response from the prior generation', async () => {
  requests.clear()
  const component = (await load('/src/app/features/living-world/JusticeApp.vue')).default
  const priorIdentity = captureIdentity(); setIdentity(session('justice-generation-a'), 'lagos')
  const traced = traceApi(), mounted = mount(component)
  try {
    await waitFor(() => count('/api/living-world/justice-practice') === 1)
    setIdentity(session('justice-generation-b'), 'lagos')
    await waitFor(() => count('/api/living-world/justice-practice') === 2)
    const calls = traced.calls.filter(call => call.path.startsWith('/api/living-world/justice-practice?'))
    assert.deepEqual(calls.map(call => call.current()), [false, true])
    resolve(1, 200, reply(server.now(), initialView(2, ['arrival-receipt'])))
    await waitFor(() => (setupValue(mounted.setup, 'reply') as { revision: number } | null)?.revision === 2)
    resolve(0, 200, reply(server.now() + 80_000, initialView(1, ['dispatch-copy']), { storage: 'failing' }))
    await Promise.resolve(); await nextTick()
    assert.equal((setupValue(mounted.setup, 'reply') as { revision: number }).revision, 2)
    assert.deepEqual((setupValue(mounted.setup, 'reply') as { practice: { reviewedEvidenceIds: string[] } }).practice.reviewedEvidenceIds, ['arrival-receipt'])
  } finally { mounted.unmount(); traced.restore(); restoreIdentity(priorIdentity) }
})
