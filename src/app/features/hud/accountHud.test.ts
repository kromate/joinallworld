// The sign-up entry points of the first screen: the top bar's buttons and chip, and when the guest bar may show.
// Rendered to a string against the real application connected to a fake server; nothing here reaches a real server or provider.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import { BAR_KEY, DISMISS_MS, barDue, barFacts, dismissBar, hiddenUntil } from '../account/guestBarModel.ts'
import type { BarFacts } from '../account/guestBarModel.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let lite: { state: Record<string, unknown> }
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const render = async (path: string): Promise<string> => { const component = (await load(path)).default; return renderToString(createSSRApp({ render: () => h(component) })) }
const accountsOff = (): void => { Object.assign(lite.state, { loaded: true, enabled: false, account: null, character: null, guest: false }) }
const guestOn = (): void => { Object.assign(lite.state, { loaded: true, enabled: true, account: null, character: null, guest: true }) }

before(async () => {
  server.route('GET /api/account', () => ({ status: 200, body: { enabled: false } }))
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  await (await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')).loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  lite = (await load<{ useAccountLite: () => { state: Record<string, unknown> } }>('/src/app/features/account/useAccountLite.ts')).useAccountLite()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the top bar: Sign up (filled) and Log in for someone not signed in, the account chip for someone who is, nothing without accounts', async () => {
  accountsOff()
  assert.equal(text(await render('/src/app/features/hud/AccountHud.vue')), '', 'accounts not configured: no buttons at all')
  guestOn()
  const guest = await render('/src/app/features/hud/AccountHud.vue')
  assert.match(guest, /<button[^>]*class="acct-signup"[^>]*data-tour="signup"[^>]*>Sign up<\/button>/)
  assert.match(guest, /<button[^>]*class="acct-login"[^>]*>Log in<\/button>/)
  Object.assign(lite.state, { account: { email: 'ada@example.com', provider: 'password', createdAt: 0, devices: 1 }, character: { id: 'p', name: 'Ada' } })
  const chip = await render('/src/app/features/hud/AccountHud.vue')
  assert.match(chip, /<button[^>]*class="acct-chip"[^>]*aria-label="Your account: Ada"/)
  assert.ok(text(chip).includes('A Ada') && !chip.includes('Sign up') && !chip.includes('Log in'))
  accountsOff()
})

test('the whole bar: Sign up comes after the online pill and before the clock; the name button steps aside for the chip', async () => {
  guestOn()
  const bar = await render('/src/app/features/hud/HudBar.vue')
  assert.ok(bar.indexOf('pulse-pill') === -1 || bar.indexOf('pulse-pill') < bar.indexOf('acct-signup'))
  assert.ok(bar.indexOf('acct-signup') < bar.indexOf('hud-clock'))
  assert.ok(!bar.includes('has-chip'))
  Object.assign(lite.state, { account: { email: 'ada@example.com', provider: 'password', createdAt: 0, devices: 1 }, character: { id: 'p', name: 'Ada' } })
  assert.match(await render('/src/app/features/hud/HudBar.vue'), /class="hud-bar has-chip"/)
  accountsOff()
  const plain = await render('/src/app/features/hud/HudBar.vue')
  assert.ok(!plain.includes('acct-') && !plain.includes('Sign up') && !plain.includes('Log in'), 'no accounts: the bar is exactly as it was')
})

test('the guest bar is due only for a guest of a server with accounts, with nothing else in front, and not for a week after it was closed', () => {
  const now = 1_000_000
  const ok: BarFacts = { enabled: true, guest: true, connected: true, creating: false, tour: false, busy: false, venue: true, hiddenUntil: 0, now }
  assert.equal(barDue(ok), true)
  for (const change of [{ enabled: false }, { guest: false }, { connected: false }, { creating: true }, { tour: true }, { busy: true }, { venue: false }, { hiddenUntil: now + 1 }]) assert.equal(barDue({ ...ok, ...change }), false, JSON.stringify(change))
  assert.equal(barDue({ ...ok, hiddenUntil: now }), true, 'the week is over')
  const kept = new Map<string, string>()
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value) } }
  assert.equal(hiddenUntil(storage), 0)
  assert.equal(dismissBar(storage, now), now + DISMISS_MS)
  assert.equal(kept.get(BAR_KEY), String(now + DISMISS_MS))
  assert.equal(hiddenUntil(storage), now + DISMISS_MS)
  assert.equal(DISMISS_MS, 7 * 24 * 3600 * 1000)
  assert.equal(hiddenUntil({ getItem: () => 'junk' }), 0)
  assert.equal(hiddenUntil(null), 0)
})

test('the guest bar: what it says and what it offers, and what it carries as a sheet-free control', async () => {
  const html = await render('/src/app/features/account/GuestBar.vue')
  const words = text(html)
  assert.ok(words.startsWith('You’re playing as a guest · Sign up free to keep'), words)
  assert.match(html, /<button[^>]*data-guest-signup[^>]*>Sign up free<\/button>/)
  assert.match(html, /<button[^>]*data-guest-login[^>]*>Log in<\/button>/)
  assert.match(html, /<button[^>]*data-guest-dismiss[^>]*aria-label="Hide this for a week"/)
  assert.match(html, /role="region" aria-label="Save your character"/)
})

test('the guest bar shows for a connected player with no account even when the first answer said "no session", after a call ended, and with the coach tip up', async () => {
  const { callStore, callVisible, idleView } = await load<typeof import('../calls/callState.ts')>('/src/app/features/calls/callState.ts')
  const inputs = { account: { loaded: true, enabled: true, account: null }, connected: true, creatorOpen: false, tour: false, sheetOpen: false, activityRunning: false, callOnScreen: false, venue: true, hiddenUntil: 0, now: 5 }
  // The account state was fetched before this device had a session (guest: false there): the bar does not depend on it.
  assert.equal(barDue(barFacts({ ...inputs, account: { ...inputs.account, guest: false } as typeof inputs.account })), true)
  callStore.view = { ...idleView(), phase: 'connected' }
  assert.equal(barDue(barFacts({ ...inputs, callOnScreen: callVisible() })), false, 'not over a call')
  callStore.view = { ...idleView(), phase: 'ended', notice: 'Call ended.' }
  assert.equal(barDue(barFacts({ ...inputs, callOnScreen: callVisible() })), false, 'nor over its ended note')
  callStore.view = idleView()
  assert.equal(barDue(barFacts({ ...inputs, callOnScreen: callVisible() })), true, 'once the call has gone and nothing else is open the bar shows')
  assert.equal(barDue(barFacts({ ...inputs, account: { ...inputs.account, account: { email: 'a@b.c' } } })), false, 'never for someone signed in')
})
