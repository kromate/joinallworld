// Report a problem, held to the existing panel (src/ui/panels/support.js) feature by feature: the
// rules block, the list with its statuses and moderator notes, a list that failed to load, the
// disabled send while offline, and the receipt the toast names.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from '../../state/app.ts'
import { createGame } from '../../state/game.ts'
import { createFakeServer, memoryStorage } from '../../testing/fakeServer.ts'
import { CATEGORY_LABELS, SENT_WITH_RULES, STATUS_LABELS, createSupport } from './supportModel.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const PATH = '/src/app/features/support/ReportApp.vue'

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(PATH)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.js`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the rules block carries all four rules of the existing panel, the last one about the badge', async () => {
  assert.equal(SENT_WITH_RULES.length, 4)
  server.route('GET /api/support/reports', () => ({ status: 200, body: { ok: true, code: 'ok', reports: [], categories: [], limits: { text: 600, open: 5 } } }))
  const words = text(await render())
  assert.ok(words.includes('The report is filed on this server and you get a receipt number at once — no e-mail or other account is needed.'))
  assert.ok(words.includes('Its status and any reply from a moderator appear under “Your reports”, and as a red badge on this app.'))
})

test('the list: receipt, status in words, the text as text, the category, when, and the moderator\'s note', async () => {
  const at = Date.UTC(2026, 0, 5, 9)
  server.route('GET /api/support/reports', () => ({ status: 200, body: { ok: true, code: 'ok', categories: [], limits: { text: 600, open: 5 }, reports: [
    { id: 'P-2', at, cityId: 'lagos', category: 'money', text: '<img src=x> my balance is wrong', status: 'resolved', note: 'Fixed, sorry.', updatedAt: at + 3600_000 },
    { id: 'P-1', at, cityId: 'lagos', category: 'bug', text: 'It froze', status: 'received', note: '', updatedAt: at },
  ] } }))
  const { useSupport } = await load<typeof import('./useSupport.ts')>('/src/app/features/support/useSupport.ts')
  await useSupport().load()
  const draw = await render()
  const words = text(draw)
  assert.ok(words.includes('Your reports') && words.includes('P-2') && words.includes('P-1'))
  assert.ok(words.includes(STATUS_LABELS.resolved) && words.includes(STATUS_LABELS.received))
  assert.ok(draw.includes('&lt;img src=x&gt; my balance is wrong') && !draw.includes('<img src=x>'), 'a report is text')
  assert.ok(words.includes(`${CATEGORY_LABELS.money} · filed`) && words.includes('· updated'))
  assert.ok(words.includes('Moderator: Fixed, sorry.'))
  assert.ok(!words.includes('Nothing reported yet'))
})

test('a list that did not load keeps what it had, says so, and offers a retry', async () => {
  const support = createSupport({ fetchJson: app.game.fetchJson, newId: app.game.newId, cityId: () => app.game.cityId.value })
  server.route('GET /api/support/reports', () => ({ status: 200, body: { ok: true, code: 'ok', categories: [], limits: { text: 600, open: 5 }, reports: [{ id: 'P-1', at: 1, cityId: 'lagos', category: 'bug', text: 'It froze', status: 'received', note: '', updatedAt: 1 }] } }))
  await support.load()
  server.route('GET /api/support/reports', () => ({ status: 500, body: { ok: false, code: 'internal_error' } }))
  await support.load()
  assert.deepEqual([support.list.value?.failed, support.list.value?.reports.length], [true, 1])
})

test('offline: the form is disabled, the send says why and that the text is kept', async () => {
  server.fault.offline = true
  await app.game.refresh()
  try {
    const html = await render()
    const words = text(html)
    assert.ok(words.includes('A report cannot be sent right now. What you typed is kept.'))
    assert.match(html, /<select[^>]*name="category"[^>]*disabled/)
    assert.match(html, /<textarea[^>]*name="text"[^>]*disabled/)
    assert.match(html, /<button[^>]*type="submit"[^>]*disabled/)
  } finally {
    server.fault.offline = false
    assert.equal(await app.game.connect(), true)
    app.game.stop()
  }
})

test('filing: the receipt id is kept for the toast, and a retry reuses the same key', async () => {
  const local = createFakeServer()
  const game = createGame({ fetch: local.fetch, storage: memoryStorage(), now: () => local.now(), setTimeout: () => 0, clearTimeout: () => {}, toast: () => {} })
  await game.connect()
  const keys: string[] = []
  let refuse = true
  local.route('GET /api/support/reports', () => ({ status: 200, body: { ok: true, code: 'ok', reports: [], categories: [], limits: { text: 600, open: 5 } } }))
  local.route('POST /api/support/reports', (request) => {
    keys.push(String(request.body?.clientId))
    return refuse ? { status: 500, body: { ok: false, code: 'internal_error' } } : { status: 200, body: { ok: true, code: 'filed', receipt: { id: 'P-7' } } }
  })
  const support = createSupport({ fetchJson: game.fetchJson, newId: game.newId, cityId: () => game.cityId.value })
  support.draft.text = 'The shop took my money twice'
  assert.equal(await support.submit(), false)
  refuse = false
  assert.equal(await support.submit(), true)
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1], 'one id for one report')
  assert.equal(support.lastReceipt.value, 'P-7')
})
