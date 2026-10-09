import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createRenderer, nextTick, ssrContextKey } from 'vue'
import type { Component } from 'vue'
import type { ApiOptions } from '../../client.ts'
import type { ApiEnvelope, OwnSession } from '../../types/protocol.ts'
import type { CommerceResponse } from '../../types/commerce.ts'
import type { App } from '../state/app.ts'
import { statementOf } from '../../game/wallet-statement.ts'
import { createFakeServer } from '../testing/fakeServer.ts'

type HostNode = { type: string; props: Record<string, unknown>; children: HostNode[]; parent: HostNode | null; text: string }
function insertNode(node: HostNode, parent: HostNode, anchor: HostNode | null): void {
  if (node.parent) { const previous = node.parent.children.indexOf(node); if (previous >= 0) node.parent.children.splice(previous, 1) }
  const index = anchor ? parent.children.indexOf(anchor) : -1
  parent.children.splice(index < 0 ? parent.children.length : index, 0, node); node.parent = parent
}
const renderer = createRenderer<HostNode, HostNode>({
  patchProp(node, key, _old, value) { node.props[key] = value },
  insert: insertNode,
  remove(node) { if (!node.parent) return; const index = node.parent.children.indexOf(node); if (index >= 0) node.parent.children.splice(index, 1); node.parent = null },
  createElement(type) { return { type, props: {}, children: [], parent: null, text: '' } },
  createText(text) { return { type: '#text', props: {}, children: [], parent: null, text } },
  createComment(text) { return { type: '#comment', props: {}, children: [], parent: null, text } },
  setText(node, text) { node.text = text },
  setElementText(node, text) { node.children = []; node.text = text },
  parentNode(node) { return node.parent },
  nextSibling(node) { const siblings = node.parent?.children ?? []; return siblings[siblings.indexOf(node) + 1] ?? null },
  insertStaticContent(content, parent, anchor) {
    const node = { type: '#static', props: {}, children: [], parent: null, text: content }
    insertNode(node, parent, anchor)
    return [node, node]
  },
})
const root = (): HostNode => ({ type: '#root', props: {}, children: [], parent: null, text: '' })
const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 30 && !predicate(); i += 1) await Promise.resolve()
  assert.ok(predicate(), 'expected request/setup did not start')
}
const server = createFakeServer()
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const realFetch = globalThis.fetch
let vite: ViteDevServer
let app: App
let checked: typeof import('./money/statementState.ts').checked
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const savedApis: { api: App['game']['client']['api']; clientFetchJson: App['game']['client']['fetchJson'] }[] = []
const readChecked = () => checked.value
const setupValue = (setup: Record<string, unknown>, key: string): unknown => Reflect.get(setup, key)
const commerceCsrf = (setup: Record<string, unknown>): string | null => {
  const result = setupValue(setup, 'result')
  if (typeof result !== 'object' || result === null || !('csrf' in result)) return null
  return typeof result.csrf === 'string' ? result.csrf : null
}

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root: repoRoot, configFile: `${repoRoot}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cities = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../game/cities/registry.ts')
  await cities.loadCityContent('lagos'); await cities.loadCityContent('ibadan')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  checked = (await load<typeof import('./money/statementState.ts')>('/src/app/features/money/statementState.ts')).checked
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => {
  for (const old of savedApis.splice(0).reverse()) { app.game.client.api = old.api; app.game.client.fetchJson = old.clientFetchJson }
  app?.game.stop(); checked.value = null; await vite?.close(); globalThis.fetch = realFetch
})

function fakeApi(handler: (path: string, options: ApiOptions | undefined, current: () => boolean) => Promise<object>): void {
  const old = { api: app.game.client.api, clientFetchJson: app.game.client.fetchJson }
  savedApis.push(old)
  const api: App['game']['client']['api'] = async <T extends object = Record<string, unknown>>(path: string, options?: ApiOptions, responseCurrent?: () => boolean): Promise<T & ApiEnvelope> => {
    const response = await handler(path, options, responseCurrent ?? (() => true))
    if (!(responseCurrent ?? (() => true))()) throw Object.assign(new Error('stale response'), { code: 'stale_identity_response' })
    return response as T & ApiEnvelope
  }
  app.game.client.api = api
}

function mount(component: Component, props: Record<string, unknown> = {}) {
  const target = root()
  // Vite's SSR-loaded SFC setup calls useSSRContext() to register its module. This harness runs
  // the real setup/lifecycle/watchers without claiming to render the SSR-only template output.
  const setupOnly = Object.assign({}, component, { render: () => null }) as Component
  const instance = renderer.createApp(setupOnly, props)
  instance.provide(ssrContextKey, { modules: new Set<string>() })
  instance.mount(target)
  const internals = (instance as unknown as { _instance: { setupState: Record<string, unknown> } })._instance
  assert.ok(internals?.setupState, 'the actual component setup state is mounted')
  return { target, setup: internals.setupState, unmount: () => instance.unmount() }
}
const callSetup = async (setup: Record<string, unknown>, key: string): Promise<void> => {
  const method = setup[key]
  assert.equal(typeof method, 'function', `actual setup exposes ${key}`)
  await (method as () => unknown)()
  await nextTick()
}
const commerceAnswer = (name: string, signedIn = false): CommerceResponse & ApiEnvelope => ({
  serverTime: 1, enabled: false, signedIn, accountEnabled: true,
  csrf: `csrf-${name}`, commerce: null, address: null,
})
const session = (id: string): OwnSession => ({ id, name: id, cities: ['lagos'] })

test('Commerce discards an old account load and does not continue its OAuth callback for the new account', async () => {
  const component = (await load('/src/app/features/commerce/CommerceApp.vue')).default
  const original = app.game.session.value
  app.game.session.value = session('commerce-old')
  let resolveOld: (answer: CommerceResponse & ApiEnvelope) => void = () => {}
  let resolveNew: (answer: CommerceResponse & ApiEnvelope) => void = () => {}
  const calls: string[] = [], accepted: string[] = []
  fakeApi((path, _options, current) => {
    calls.push(path)
    const promise = path === '/api/commerce' && calls.filter(item => item === path).length === 1
      ? new Promise<CommerceResponse & ApiEnvelope>(done => { resolveOld = done })
      : path === '/api/commerce'
        ? new Promise<CommerceResponse & ApiEnvelope>(done => { resolveNew = done })
        : Promise.resolve(commerceAnswer('other'))
    return promise.then(answer => { if (current()) accepted.push(path); return answer })
  })
  const mounted = mount(component, { params: { code: 'one-time-code', state: 'one-time-state' } })
  await waitFor(() => calls.length === 1)
  app.game.session.value = session('commerce-new')
  await waitFor(() => calls.length === 2)
  resolveOld(commerceAnswer('old-owner', true))
  await Promise.resolve(); await nextTick()
  resolveNew(commerceAnswer('new-owner', false))
  await waitFor(() => accepted.includes('/api/commerce'))
  await Promise.resolve(); await nextTick()
  assert.equal(calls.filter(path => path === '/api/commerce/connect/complete').length, 0, 'stale mount continuation never redeems the callback')
  assert.deepEqual(calls, ['/api/commerce', '/api/commerce'])
  assert.equal(typeof setupValue(mounted.setup, 'result'), 'object')
  assert.equal(commerceCsrf(mounted.setup), 'csrf-new-owner')
  mounted.unmount(); app.game.session.value = original
})

test('Commerce invalidates its response predicate when the panel unmounts', async () => {
  const component = (await load('/src/app/features/commerce/CommerceApp.vue')).default
  const original = app.game.session.value
  app.game.session.value = session('commerce-unmount')
  let resolve: (answer: CommerceResponse & ApiEnvelope) => void = () => {}
  const observed = { current: null as (() => boolean) | null }
  fakeApi((path, _options, isCurrent) => {
    assert.equal(path, '/api/commerce')
    observed.current = isCurrent
    return new Promise<CommerceResponse & ApiEnvelope>(done => { resolve = done })
  })
  const mounted = mount(component)
  await waitFor(() => observed.current !== null)
  mounted.unmount()
  resolve(commerceAnswer('unmounted', true))
  await Promise.resolve(); await nextTick()
  assert.equal(observed.current?.(), false, 'the client responseCurrent predicate fails closed after unmount')
  app.game.session.value = original
})

test('Statement verdict expires across city and wallet changes, including an A to B to A return', async () => {
  const component = (await load('/src/app/features/money/StatementApp.vue')).default
  const originalSession = app.game.session.value, originalCity = app.game.cityId.value, originalState = app.game.state.value
  app.game.session.value = session('statement-owner')
  app.game.cityId.value = 'lagos'
  app.game.state.value = { ...originalState, cash: originalState.cash, ledger: originalState.ledger.map(line => ({ ...line })), ledgerDays: originalState.ledgerDays.map(day => ({ ...day, by: { ...day.by } })) }
  checked.value = null
  let calls = 0
  fakeApi(async (path) => {
    assert.match(path, /^\/api\/support\/statement\?city=lagos$/)
    calls += 1
    return { serverTime: 1, statement: statementOf(app.game.state.value) }
  })
  const mounted = mount(component)
  await callSetup(mounted.setup, 'check')
  assert.equal(calls, 1)
  assert.equal(readChecked()?.cityId, 'lagos')

  app.game.cityId.value = 'ibadan'
  await nextTick()
  assert.equal(readChecked(), null, 'changing city clears the prior verdict')
  app.game.state.value = { ...app.game.state.value, cash: app.game.state.value.cash + 1 }
  app.game.cityId.value = 'lagos'
  await nextTick()
  assert.equal(readChecked(), null, 'returning to the original city does not revive a verdict over a changed wallet')

  app.game.state.value = originalState; app.game.cityId.value = originalCity; app.game.session.value = originalSession
  mounted.unmount(); checked.value = null
})

test('Statement keeps a matching in-memory verdict across panel close/reopen, but clears it after a wallet change', async () => {
  const component = (await load('/src/app/features/money/StatementApp.vue')).default
  const originalSession = app.game.session.value, originalState = app.game.state.value
  app.game.session.value = session('statement-reopen')
  app.game.state.value = { ...originalState, ledger: originalState.ledger.map(line => ({ ...line })), ledgerDays: originalState.ledgerDays.map(day => ({ ...day, by: { ...day.by } })) }
  checked.value = null
  fakeApi(async () => ({ serverTime: 1, statement: statementOf(app.game.state.value) }))
  const first = mount(component)
  await callSetup(first.setup, 'check')
  first.unmount()
  const reopened = mount(component)
  await nextTick()
  assert.ok(readChecked()?.walletFingerprint)
  reopened.unmount()

  app.game.state.value = { ...app.game.state.value, cash: app.game.state.value.cash + 1 }
  const afterChange = mount(component)
  await nextTick()
  assert.equal(readChecked(), null)
  afterChange.unmount(); app.game.state.value = originalState; app.game.session.value = originalSession; checked.value = null
})

test('Commerce invalidates deferred loads across same-tick city A to B to A and clears draft and consent', async () => {
  const component = (await load('/src/app/features/commerce/CommerceApp.vue')).default
  const originalSession = app.game.session.value, originalCity = app.game.cityId.value
  app.game.session.value = session('commerce-city-owner'); app.game.cityId.value = 'lagos'
  const pending: { current: () => boolean; resolve: (answer: CommerceResponse & ApiEnvelope) => void }[] = []
  fakeApi((path, _options, current) => {
    assert.equal(path, '/api/commerce')
    return new Promise<CommerceResponse & ApiEnvelope>(resolve => { pending.push({ current, resolve }) })
  })
  const mounted = mount((await load('/src/app/features/commerce/CommerceApp.vue')).default)
  try {
    await waitFor(() => pending.length === 1)
    pending[0]!.resolve({ ...commerceAnswer('old-city', true), address: { city: 'lagos', lga: 'Ikeja', estate: 1, plot: 1 } })
    await waitFor(() => setupValue(mounted.setup, 'result') !== null)
    mounted.setup.name = 'Private draft from Lagos'
    mounted.setup.adultAndTerms = true

    app.game.cityId.value = 'ibadan'
    assert.equal(setupValue(mounted.setup, 'result'), null)
    assert.equal(mounted.setup.name, '')
    assert.equal(mounted.setup.adultAndTerms, false)
    app.game.cityId.value = 'lagos'
    await waitFor(() => pending.length === 3)

    pending[0]!.resolve({ ...commerceAnswer('stale-city', true), address: { city: 'lagos', lga: 'Ikeja', estate: 1, plot: 1 } })
    pending[1]!.resolve({ ...commerceAnswer('middle-city', true), address: { city: 'ibadan', lga: 'Ibadan North', estate: 1, plot: 1 } })
    pending[2]!.resolve(commerceAnswer('current-city', false))
    await waitFor(() => commerceCsrf(mounted.setup) === 'csrf-current-city')
    await nextTick()
    assert.deepEqual(pending.map(item => item.current()), [false, false, true])
    assert.equal(commerceCsrf(mounted.setup), 'csrf-current-city')
    assert.equal(mounted.setup.name, '')
    assert.equal(mounted.setup.adultAndTerms, false)
  } finally {
    for (const item of pending) item.resolve(commerceAnswer('cleanup'))
    mounted.unmount(); app.game.session.value = originalSession; app.game.cityId.value = originalCity
  }
})

test('Statement ignores a deferred check after same-tick city A to B to A', async () => {
  const component = (await load('/src/app/features/money/StatementApp.vue')).default
  const originalSession = app.game.session.value, originalCity = app.game.cityId.value, originalState = app.game.state.value
  const originalToast = app.game.toast
  app.game.session.value = session('statement-city-owner'); app.game.cityId.value = 'lagos'
  app.game.state.value = { ...originalState, ledger: originalState.ledger.map(line => ({ ...line })), ledgerDays: originalState.ledgerDays.map(day => ({ ...day, by: { ...day.by } })) }
  checked.value = null
  const observed = { responseCurrent: null as (() => boolean) | null }
  let resolve: (response: object) => void = () => {}
  const toasts: string[] = []
  app.game.toast = (message) => { toasts.push(String(message)) }
  fakeApi((path, _options, current) => {
    assert.equal(path, '/api/support/statement?city=lagos')
    observed.responseCurrent = current
    return new Promise<object>(done => { resolve = done })
  })
  const mounted = mount((await load('/src/app/features/money/StatementApp.vue')).default)
  let pendingCheck: Promise<void> | null = null
  try {
    pendingCheck = callSetup(mounted.setup, 'check')
    await waitFor(() => observed.responseCurrent !== null)
    app.game.cityId.value = 'ibadan'
    app.game.cityId.value = 'lagos'
    assert.equal(observed.responseCurrent?.(), false, 'synchronous invalidation remembers the intermediate city change')
    resolve({ serverTime: 1, statement: statementOf(app.game.state.value) })
    await pendingCheck
    assert.equal(readChecked(), null)
    assert.deepEqual(toasts, [], 'the stale check does not toast a verdict')
  } finally {
    resolve({ serverTime: 1, statement: statementOf(app.game.state.value) })
    if (pendingCheck) await pendingCheck.catch(() => {})
    mounted.unmount(); app.game.toast = originalToast
    app.game.state.value = originalState; app.game.cityId.value = originalCity
    app.game.session.value = originalSession; checked.value = null
  }
})
