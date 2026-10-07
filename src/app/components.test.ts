// Component tests for the Vue shell, with nothing added to the project to run them.
//
// Each single-file component is compiled by the project's own Vite configuration (the same
// plugin and options that build the game) and rendered to a string with Vue's server renderer,
// against the real store connected to a fake server that runs the real rules. So what is asserted
// is the markup the pilots produce for a known life: its words, its roles and labels, its
// disabled controls and their reasons. What a click does is tested where the logic lives, in
// features/models.test.ts and state/game.test.ts. There is no DOM here: a test that needs focus
// or layout belongs in the browser run (docs/MIGRATION-VUE-TS.md, "How each step is verified").
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h, nextTick } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { SocialOverview } from '../types/social.ts'
import type { App } from './state/app.ts'
import type { SocialState as SocialClientState } from './features/social/useSocial.ts'
import { createFakeServer } from './testing/fakeServer.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let social: SocialClientState
const realFetch = globalThis.fetch

/** Load a module through Vite, exactly as the build would compile it. */
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}

before(async () => {
  // The store creates its client from the page's fetch: point it at the fake server before any module loads.
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  social = (await load<{ social: SocialClientState }>('/src/app/features/social/useSocial.ts')).social
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('base components: a disabled button says why; a meter and an empty state are labelled', async () => {
  const button = await render('/src/app/ui/BaseButton.vue', { variant: 'primary', reason: 'You need ₦500 more.' })
  assert.match(button, /<button[^>]*class="base-button is-primary"[^>]*disabled[^>]*title="You need ₦500 more\."/)
  assert.match(await render('/src/app/ui/BaseButton.vue'), /<button[^>]*type="button"(?![^>]*disabled)/)
  const meter = await render('/src/app/ui/BaseMeter.vue', { label: 'Hunger', value: 22.4 })
  assert.match(meter, /class="base-meter is-low"/)
  assert.match(meter, /role="meter" aria-label="Hunger" aria-valuemin="0" aria-valuemax="100" aria-valuenow="22"/)
  assert.match(await render('/src/app/ui/BaseMeter.vue', { label: 'Fun', value: 180 }), /width:100%/)
  const empty = await render('/src/app/ui/EmptyState.vue', { icon: 'statement', title: 'No transactions yet', text: 'Listed here.', compact: true })
  assert.equal(text(empty), 'No transactions yet Listed here.')
  assert.match(empty, /class="empty-state-art"[^>]*aria-hidden="true"[^>]*><span[^>]*><svg/, 'the mark is a glyph of the icon set, hidden from screen readers')
  assert.match(await render('/src/app/ui/GameIcon.vue', { name: 'bank' }), /<span class="game-icon"[^>]*aria-hidden="true"[^>]*><svg/)
  assert.match(await render('/src/app/ui/BaseChip.vue', { tone: 'warn' }), /class="base-chip is-warn"/)
})

test('HUD: the top bar shows the clock, mood, name, saved state and wallet of the connected life', async () => {
  const html = await render('/src/app/features/hud/HudBar.vue')
  const state = app.game.state.value
  assert.match(html, /<section[^>]*aria-label="Player status"/)
  assert.ok(text(html).includes(state.name) && text(html).includes('Saved'))
  assert.match(html, new RegExp(`aria-label="Wallet ₦${state.cash.toLocaleString('en-NG')}\\. Open the bank and your transactions"`))
  assert.match(html, /role="status"[^>]*title="Connected · progress saved"/)
  const needs = await render('/src/app/features/hud/NeedsStrip.vue')
  assert.match(needs, /role="group" aria-label="Your needs"/)
  for (const need of app.game.view.value.needs.order) assert.match(needs, new RegExp(`role="meter" aria-label="${need[0]?.toUpperCase()}${need.slice(1)}"[^>]*aria-valuenow="${Math.round(state.needs[need])}"`))
})

test('Bank: balance, rent, and the ledger with every change explained', async () => {
  await app.command('spot', { id: 'bedroom' })
  const html = await render('/src/app/features/bank/BankApp.vue')
  const state = app.game.state.value, view = app.game.view.value
  const words = text(html)
  assert.ok(words.startsWith(`Balance ₦${state.cash.toLocaleString('en-NG')}`), words.slice(0, 80))
  assert.ok(words.includes('Statement') && words.includes('Invest') && words.includes('Find a job'), 'no job yet: the way to one is offered')
  const rent = view.economy.rent
  assert.ok(rent, 'a life that moved in has rent')
  assert.match(html, /<section[^>]*aria-label="Rent"/)
  assert.ok(words.includes(rent.label) && words.includes('Up to date') && words.includes(rent.nextDueLabel))
  assert.ok(!/Pay ₦[\d,]+ rent now/.test(words), 'nothing is overdue, so there is nothing to pay')
  assert.equal((html.match(/class="list-row"[^>]*>|<li[^>]*class="list-row/g) ?? []).length >= view.wallet.ledger.length, true)
  for (const entry of view.wallet.ledger) assert.ok(words.includes(entry.reason), `the ledger explains "${entry.reason}"`)
  assert.ok(view.wallet.ledger.length > 0 && words.includes(`last ${view.wallet.ledger.length}, newest first`))
})

test('Bank: offline it is read-only and says so on every payment', async () => {
  server.fault.offline = true
  await app.game.refresh()
  try {
    assert.equal(app.game.connected.value, false)
    const html = await render('/src/app/features/bank/BankApp.vue')
    assert.ok(text(html).includes('This device has no internet connection. Read-only until that is resolved.') || text(html).includes('The game server is not answering. Read-only until that is resolved.'), text(html).slice(0, 200))
    assert.ok(!/<button(?![^>]*disabled)[^>]*>\s*Pay /.test(html), 'no payment can be pressed while offline')
    assert.match(await render('/src/app/features/hud/HudBar.vue'), /<button[^>]*class="hud-saved is-off/)
    const notice = text(await render('/src/app/features/hud/ConnectionNotice.vue'))
    assert.ok(notice.includes('Try again'), notice)
  } finally {
    server.fault.offline = false
    assert.equal(await app.game.connect(), true)
    app.game.stop()
  }
})

const player = (id: string, name: string) => ({ id, name })
function overview(): SocialOverview {
  const me = player(server.session()?.id ?? 'me', 'Kunle'), ada = player('ada', 'Ada <b>bold</b>')
  return {
    ok: true, code: 'ok', me: { ...me, since: 1 }, friends: [], bae: null, blocked: [], reports: [], invitePath: '/v/me', visiting: null, door: { who: 'knock', out: false, chosen: true }, invites: [],
    requests: { in: [], out: [] }, baeRequests: [],
    conversations: [{ id: 'dm.ada.me', kind: 'dm', name: ada.name, members: [me, ada], owner: null, with: 'ada', unread: 2, last: { seq: 2, from: ada, body: 'How far? <script>x</script>', at: server.now() } }],
    updates: [], house: { host: me, capacity: 4, guests: [], role: 'host', cityId: null, conv: null, hostStatus: 'home', knocks: [] },
    prefs: { groups: 'friends', mentions: 'on', pictures: 'friends', introductions: 'off', notify: { text: true, groups: 'mentions', pausedUntil: null, quietDm: false, quietGroups: true } },
    limits: { body: 500, groupSize: 8, groupName: 30, guests: 4, reportText: 300, reasons: ['spam'], pins: 3, mentions: 5, pictures: { on: true, bytes: 250000, caption: 200 } },
  }
}

test('Messages: loading, then the chat list with unread counts; a player\'s text is never markup', async () => {
  const messages = '/src/app/features/messages/MessagesApp.vue'
  social.me = null; social.error = null
  assert.equal(text(await render(messages)), 'Loading…')
  social.error = 'Connection lost. Nothing was changed; try again.'
  assert.equal(text(await render(messages)), 'Could not load: Connection lost. Nothing was changed; try again. Retry')
  social.error = null; social.me = overview(); social.socket = 'open'
  app.shell.bump()
  const html = await render(messages)
  assert.match(html, /role="tablist"/)
  assert.match(html, /<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>Chats<span[^>]*class="messages-badge"[^>]*>2<\/span>/)
  assert.ok(html.includes('Ada &lt;b&gt;bold&lt;/b&gt;') && html.includes('How far? &lt;script&gt;x&lt;/script&gt;'), 'names and messages are text')
  assert.ok(!html.includes('<script>') && !html.includes('<b>bold</b>'))
  assert.match(html, /aria-label="2 unread"/)
  social.socket = 'offline'
  app.shell.bump()
  assert.ok(text(await render(messages)).startsWith('Live updates are off. Reconnect'))
  social.socket = 'open'
})

test('Messages: a sent message shows at once as Sending…, then Not sent with the reason and a Retry', async () => {
  const messages = '/src/app/features/messages/MessagesApp.vue'
  const ada = player('ada', 'Ada'), meId = server.session()?.id ?? 'me'
  social.me = overview()
  social.threads.set('dm.ada.me', { loaded: true, error: null, messages: [
    { seq: 1, id: 'dm.ada.me#1', conv: 'dm.ada.me', from: ada, body: 'How far?', at: server.now() },
    { seq: 2, id: 'dm.ada.me#2', conv: 'dm.ada.me', from: player(meId, 'Kunle'), body: 'I dey', at: server.now() },
  ] })
  // The server holds the answer until the test lets it go.
  let answer: (value: { status: number; body: unknown }) => void = () => {}
  let posted: Record<string, unknown> | null = null
  server.route('POST /api/social/messages', (request) => { posted = request.body; return new Promise((resolve) => { answer = resolve }) })
  server.route('GET /api/social/me', () => ({ status: 200, body: social.me }))
  const { send } = await load<{ send: (key: string, target: { conv: string }, body: string) => void }>('/src/app/features/social/useSocial.ts')
  const { ui } = await load<{ ui: { open: string | null; openName: string | null } }>('/src/app/features/messages/messagesState.ts')
  // Under Node there is no page and no WebSocket: the social client is given the api and nothing more.
  const { attach } = await load<{ attach: (api: unknown) => void }>('/src/app/features/social/useSocial.ts')
  attach(app.api)
  ui.open = 'dm.ada.me'
  try {
    let html = await render(messages)
    assert.match(html, /<div class="messages panel-fill"/, 'a conversation takes the whole app area')
    assert.match(html, /<h3[^>]*><button[^>]*>Ada &lt;b&gt;bold&lt;\/b&gt;<\/button><small[^>]*>Direct message<\/small>/)
    assert.match(html, /class="is-head bubble"[^>]*>(?:<!--.*?-->)*<span class="bubble-text"[^>]*>(?:<!--.*?-->)*How far\?/)
    assert.match(html, /class="is-mine is-head bubble"[^>]*>(?:<!--.*?-->)*<span class="bubble-text"[^>]*>(?:<!--.*?-->)*I dey(?:<!--.*?-->)*<\/span><small[^>]*>[^<]*(?:<!--.*?-->)* · Sent/)

    send('dm.ada.me', { conv: 'dm.ada.me' }, 'On my way')
    html = await render(messages)
    assert.match(html, /class="is-pending bubble is-mine"[^>]*><span[^>]*>On my way<\/span><small[^>]*>Sending…/, 'shown before the server has answered')
    await new Promise((resolve) => setImmediate(resolve))
    const key = (posted as Record<string, unknown> | null)?.clientId
    assert.match(String(key), /^\d+:[0-9a-f-]{36}$/)
    answer({ status: 403, body: { error: 'text_blocked', reason: 'That wording is not allowed here.' } })
    await new Promise((resolve) => setImmediate(resolve)); await nextTick()
    html = await render(messages)
    assert.match(html, /class="is-failed bubble is-mine"[^>]*><span[^>]*>On my way<\/span><small[^>]*>Not sent · That wording is not allowed here\./, 'the server\'s own sentence')
    assert.ok(text(html).includes('Retry Delete'))
    assert.ok(!html.includes('is-pending'))
    // A chat with a friend before its first message: the name opens the profile, and Send money and Ping (the friend is away) are there already.
    const bola = player('b01a', 'Bola')
    social.me = { ...overview(), friends: [{ ...bola, status: 'offline', since: 1 }] } as SocialOverview
    ui.open = 'to:b01a'; ui.openName = 'Bola'
    app.shell.bump()
    html = await render(messages)
    assert.match(html, /<h3[^>]*><button[^>]*aria-label="Bola: open profile"[^>]*>Bola<\/button>/)
    assert.match(html, /data-chat="send-money"/)
    assert.match(html, /data-ping="send"/)
    assert.ok(text(html).includes('No messages yet. Say something.'))
  } finally { ui.open = null; ui.openName = null; social.threads.clear(); social.me = null }
})

test('Report a problem: the form, what is sent with it, and the empty list', async () => {
  server.route('GET /api/support/reports', () => ({ status: 200, body: { ok: true, code: 'ok', reports: [], categories: [], limits: { text: 600, open: 5 } } }))
  const html = await render('/src/app/features/support/ReportApp.vue', { params: { category: 'money' } })
  const words = text(html)
  assert.ok(words.startsWith('Report a problem Tell us what went wrong'))
  assert.match(html, /<select[^>]*name="category"/)
  assert.match(html, /<option value="money"[^>]*selected>Money or balance<\/option>/, 'the category handed over by another screen is preselected')
  assert.match(html, /<textarea[^>]*name="text"[^>]*maxlength="600"[^>]*aria-describedby="report-sent-with report-notice"/)
  assert.ok(words.includes('Your device’s secret never is.') && words.includes('What is sent, and what happens next'))
  assert.match(html, /<details[^>]*class="how"(?![^>]*\sopen)[^>]*><summary[^>]*>What is sent, and what happens next<\/summary>/, 'the longer rules are folded away, in a native disclosure')
  assert.match(html, /<button[^>]*type="submit"(?![^>]*disabled)[^>]*>(?:<!--.*?-->)*Send report/)
  assert.match(html, /role="status" aria-label="Loading your reports"/, 'the list is fetched when the app is shown, not before')
})

test('Phone: the home screen lists the Vue panels', async () => {
  const html = await render('/src/app/features/phone/PhoneDevice.vue')
  for (const id of ['bank', 'messages', 'support', 'jobs', 'groceries', 'governor', 'career', 'help', 'community']) assert.match(html, new RegExp(`data-ph-app="${id}"`), `${id} is on the home screen`)
  const kinds = Object.fromEntries(app.panels.map((panel) => [panel.id, 'kind' in panel ? 'vue' : 'existing']))
  assert.deepEqual([kinds.bank, kinds.messages, kinds.support, kinds.jobs, kinds.groceries, kinds.ride], ['vue', 'vue', 'vue', 'vue', 'vue', 'vue'])
  assert.match(html, /role="img" aria-label="Connected to the game server"/)
  assert.match(html, new RegExp(`aria-label="Battery: your character’s Energy is ${Math.round(app.game.state.value.needs.energy)}%"`))
  assert.match(html, /<section class="ph-app"[^>]*inert/, 'no app is open, so the app layer cannot be reached')
})
