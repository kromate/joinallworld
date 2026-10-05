// Render tests for the invitation surfaces: the HUD button, the prompt chip, the share sheet for an
// invitation (with its QR code), the landing banner and the first screen's "invited you" note. Each
// single-file component is compiled by the project's own Vite configuration and rendered to a
// string against the real store and a fake server, so what is asserted is the markup a player gets.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LifeState } from '../../../types/life.ts'
import type { ReferralView } from '../../../types/growth.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import type { Growth } from './growthStore.ts'
import type { HelloOk } from './growthModel.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let growth: Growth
const realFetch = globalThis.fetch

// The device already holds the share code a link carried (the quick start reads it when it loads).
const kept = new Map<string, string>([['allworld-ref', JSON.stringify({ code: 'abcd1234ef', at: Date.now() })]])
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value) }, removeItem: (key: string) => { kept.delete(key) } } })

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return (await renderToString(createSSRApp({ render: () => h(component, props) }))).replace(/<!--.*?-->/g, '')
}
const growthPart = (name: string, props: Record<string, unknown> = {}): Promise<string> => render(`/src/app/features/growth/${name}.vue`, props)

const referral = (over: Partial<ReferralView> = {}): ReferralView => ({
  by: null, invited: [], counted: 0, waiting: 0, owed: 0, title: null, nextTitle: null, paid: null,
  rules: { welcome: 1000, reward: 1500, stars: 2, perWeek: 5, lifetime: 20, workDays: 2, linkWithinDays: 3 }, ...over,
})
const hello = (over: Partial<ReferralView> = {}): HelloOk => ({ ok: true, referral: referral(over), channel: '', consent: null, events: [], sharesLeft: 3 }) as unknown as HelloOk
const LINK = 'https://play.example/s/abc123defg'
const sharing = (text = `I live in Yaba now, in Allworld.\n${LINK}`) => ({ facts: { kind: 'invite' } as never, prepared: { text, link: LINK, file: null, url: null, whatsapp: '', x: '' }, surface: 'hud' as const })

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  growth = (await load<{ useGrowth: () => Growth }>('/src/app/features/growth/useGrowth.ts')).useGrowth()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

/** Render with the life changed, then put it back. */
async function withState<T>(change: (state: LifeState) => LifeState, check: () => Promise<T>): Promise<T> {
  const before = app.game.state.value
  app.game.state.value = change(before)
  try { return await check() } finally { app.game.state.value = before }
}

test('Invite button: an icon with the label, named for a screen reader, and no chip until a moment comes', async () => {
  const html = await growthPart('InviteButton')
  assert.match(html, /<button[^>]*class="inv-button"[^>]*aria-label="Invite your friends"[^>]*data-invite-button/)
  assert.match(html, /<span class="inv-label"[^>]*>Invite<\/span>/)
  assert.match(html, /<svg/, 'the icon')
  assert.ok(!html.includes('inv-chip'), 'nothing prompts on load')
})

test('Invite button: not shown to a guest who has not pressed Play', async () => {
  await withState((state) => ({ ...state, onboarding: { ...state.onboarding, stage: 'guest', done: false, required: true } }), async () => {
    assert.ok(!(await growthPart('InviteButton')).includes('inv-button'))
  })
})

test('Invitation chip: each moment says its own thing, with one action and a close that is labelled', async () => {
  const expected: [string, string][] = [['first-goal', 'Playing is better with friends'], ['home', 'Show a friend your house'], ['empty-venue', 'Nobody here yet'], ['table-win', 'Nice win']]
  for (const [moment, title] of expected) {
    const html = await growthPart('InviteChip', { moment })
    assert.match(html, new RegExp(`<aside[^>]*class="inv-chip"[^>]*role="status"[^>]*data-moment="${moment}"`))
    assert.ok(text(html).includes(title), moment)
    assert.match(html, /<button[^>]*class="inv-chip-go"[^>]*>Invite (a friend|someone)<\/button>/)
    assert.match(html, /<button[^>]*class="inv-chip-x"[^>]*aria-label="Not now"/)
  }
})

test('Share sheet for an invitation: the link as text, Copy link, the channels, QR on request, the reward and the progress', async () => {
  growth.state.sharing = sharing('I live in Yaba now <script>x</script>\nhttps://play.example/s/abc123defg')
  growth.state.hello = hello({ invited: [{ id: 'a', name: 'Tunde', state: 'joined', at: 1 }] })
  try {
    const html = await growthPart('ShareSheet')
    assert.ok(!html.includes('<script>'))
    assert.match(html, /data-invite-link[^>]*>https:\/\/play\.example\/s\/abc123defg</)
    const words = text(html)
    assert.ok(words.includes('Copy link') && words.includes('Show QR code') && words.includes('WhatsApp') && words.includes('Telegram'))
    assert.match(html, /<a[^>]*href="https:\/\/wa\.me\/\?text=[^"]*abc123defg[^"]*"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>WhatsApp<\/a>/)
    assert.match(html, /<a[^>]*href="https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Fplay\.example%2Fs%2Fabc123defg&amp;text=[^"]*"[^>]*>Telegram<\/a>/)
    assert.match(html, /<a[^>]*href="https:\/\/twitter\.com\/intent\/tweet\?text=[^"]*"[^>]*>X<\/a>/)
    assert.ok(!html.includes('<svg role="img"'), 'the code is not drawn until it is asked for')
    assert.match(html, /data-invite-progress[^>]*>1 friend joined</)
    assert.ok(words.includes('When a friend you invite has been paid for work on 2 different days, you get ₦1,500 and 2 stars in the game.'))
    assert.ok(words.includes('At most 5 rewards a week and 20 for life. Nothing is paid for sharing the link, or for a friend who never plays.'))
    growth.state.hello = null
    const bare = text(await growthPart('ShareSheet'))
    assert.ok(bare.includes('Your link is ready.') && bare.includes('you get ₦1,500 and 2 stars'), 'before the hello, the rules are the game’s own')
  } finally { growth.state.sharing = null; growth.state.hello = null }
})

test('QR code: drawn locally as an SVG, labelled, with a fallback for a link that is too long', async () => {
  const html = await growthPart('ShareQr', { link: LINK })
  assert.match(html, /<svg[^>]*viewBox="-4 -4 37 37"[^>]*role="img"[^>]*aria-label="QR code for your invite link"/, 'version 3 is 29 modules plus the quiet zone')
  assert.match(html, /<path d="M[^"]+"[^>]*fill="#111"/)
  assert.ok(!/https?:\/\/(?!www\.w3)/.test(html.replace(LINK, '')), 'nothing is fetched from anywhere')
  assert.ok(text(await growthPart('ShareQr', { link: `https://play.example/${'a'.repeat(400)}` })).includes('too long'))
})

test('Landing banner: the inviter’s name is text, never markup; Knock only when there is a door', async () => {
  const component = (await load('/src/app/features/landing/LinkBanner.vue')).default
  const draw = async (banner: unknown): Promise<string> => {
    const context: { teleports?: Record<string, string> } = {}
    await renderToString(createSSRApp({ render: () => h(component, { banner, host: 'body' }) }), context)
    return (context.teleports?.body ?? '').replace(/<!--.*?-->/g, '')
  }
  const banner = { id: 1, tone: 'good', title: 'You’re joining <img src=x onerror=alert(1)>', text: 'Ada is at home. Knock, and they can let you in.', knock: true, knockHost: 'h1' }
  const html = await draw(banner)
  assert.match(html, /<aside[^>]*class="is-good qs-banner"[^>]*role="status"/)
  assert.ok(html.includes('You’re joining &lt;img src=x onerror=alert(1)&gt;') && !html.includes('<img'), 'escaped')
  assert.match(html, /<button[^>]*class="ui-button is-primary is-small"[^>]*>Knock<\/button>/)
  assert.match(html, /<button[^>]*class="qs-banner-close"[^>]*aria-label="Dismiss"/)
  assert.ok(!(await draw({ ...banner, knock: false })).includes('>Knock<'))
  assert.equal(await draw(null), '', 'no banner, nothing drawn')
})

test('First screen: a link with a share code says an invitation is waiting', async () => {
  const html = await render('/src/app/features/start/QuickStartApp.vue', { params: { reason: 'new' } })
  assert.match(html, /<p[^>]*class="qs-join"[^>]*role="status"/)
  assert.ok(text(html).includes('A friend invited you. Tap Play and you land where they are.'))
})
