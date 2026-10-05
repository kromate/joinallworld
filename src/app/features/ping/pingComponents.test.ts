// The Ping components rendered to a string against the real store: what a player reads and can press on the button, the
// strip under it and the notices. Compiled by the project's own Vite configuration, in the manner of the call screens'
// tests. What a press does is tested at the store (ping.test.ts).
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
import type { PingNotice, PingPlace } from '../../../types/ping.ts'
import type { SocialClient } from '../social/socialClient.ts'
import type { pingState as PingState } from './pingStore.ts'
import type { pingUi as PingUi } from './pingLoader.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
const realFetch = globalThis.fetch
let vite: ViteDevServer
let app: App
let state: typeof PingState
let ui: typeof PingUi
const TOKEN = 'Ab1_-'.repeat(19)
const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada <b>' }
const PARK: PingPlace = { cityId: 'lagos', cityName: 'Lagos', venue: 'park', home: false, label: 'at Freedom Park, Lagos' }
const notice = (over: Partial<PingNotice> = {}): PingNotice => ({ from: ADA, at: 1, expiresAt: 2, place: PARK, ...over })

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
async function render(name: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(`/src/app/features/ping/${name}.vue`)).default
  const html = await renderToString(createSSRApp({ render: () => h(component, props) }))
  return html.replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}
const text = (html: string): string => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
const buttons = (html: string): string[] => [...html.matchAll(/<button[^>]*data-ping="([a-z]+)"[^>]*>/g)].map((match) => `${match[1]}${/\sdisabled/.test(match[0]) ? ':off' : ''}`)

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  await (await load<typeof import('../../../game/cities/registry.ts')>('/src/game/cities/registry.ts')).loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop();
  (await load<{ useSocial: () => SocialClient }>('/src/app/features/social/useSocial.ts')).useSocial().attach(app.api)
  state = (await load<{ pingState: typeof PingState }>('/src/app/features/ping/pingStore.ts')).pingState
  ui = (await load<{ pingUi: typeof PingUi }>('/src/app/features/ping/pingLoader.ts')).pingUi
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })
const reset = (): void => { state.controls.clear(); state.sent.clear(); state.busy.clear(); state.banner = null; ui.frames.length = 0 }

test('the button: its name, one line of what it does, an aria label that says both — and the reason when it is off', async () => {
  reset()
  let html = await render('PingButton', { id: ADA.id, name: ADA.name })
  assert.equal(text(html), 'Ping Ada <b> Tell them you are here. If they come, they land right where you are.')
  assert.ok(!html.includes('Ada <b>'), 'a name is text')
  assert.deepEqual(buttons(html), ['send'])
  assert.match(html, /<button type="button" class="[^"]*\bis-primary is-block\b[^"]*"[^>]*aria-label="Ping Ada &lt;b&gt;\. Tell them you are here\. If they come, they land right where you are\."/)
  html = await render('PingButton', { id: ADA.id, name: ADA.name, stranger: true })
  assert.equal(text(html), 'Ping Ada <b> Add Ada <b> as a friend to ping them.')
  assert.deepEqual(buttons(html), ['send:off'])
  assert.match(html, /class="[^"]*\bis-why\b[^"]*" data-ping="hint"/)
  html = await render('PingButton', { id: ADA.id, name: ADA.name, blocked: true })
  assert.equal(text(html), 'Ping Ada <b> Unblock this player to ping them.')
  state.controls.set(ADA.id, { can: false, code: 'cooldown', reason: 'x', again: app.game.view.value.now + 12 * 60000 - 1000, live: null })
  html = await render('PingButton', { id: ADA.id, name: ADA.name })
  assert.equal(text(html), 'Ping Ada <b> You pinged Ada <b>. You can ping again in 12 minutes.')
  assert.deepEqual(buttons(html), ['send:off'])
  assert.doesNotMatch(html, /is-why/, 'a wait after your own ping is not shown as something wrong')
  state.busy.add(ADA.id); state.controls.clear()
  assert.match(text(await render('PingButton', { id: ADA.id, name: ADA.name })), /^Pinging…/)
})

test('in a chat header it is one small button — the reason is its tooltip and its aria label, with no second line', async () => {
  reset()
  let html = await render('PingButton', { id: ADA.id, name: 'Ada', compact: true })
  assert.equal(text(html), 'Ping')
  assert.match(html, /<button type="button" class="[^"]*\bis-small\b[^"]*"[^>]*data-ping="send"[^>]*title="Tell them you are here\. If they come, they land right where you are\."[^>]*aria-label="Ping Ada\. Tell them/)
  assert.ok(!html.includes('ping-hint'))
  state.controls.set(ADA.id, { can: false, code: 'founder', reason: 'Ada is everyone’s first friend, so they cannot be pinged. Send them a message instead.', again: null, live: null })
  html = await render('PingButton', { id: ADA.id, name: 'Ada', compact: true })
  assert.deepEqual(buttons(html), ['send:off'])
  assert.match(html, /title="Ada is everyone’s first friend, so they cannot be pinged\. Send them a message instead\."/)
})

test('the strip: what the server answered, then the other ways to reach the friend — a share, WhatsApp’s own share address, and taking it back', async () => {
  reset()
  assert.equal(await render('PingStrip', { id: ADA.id, name: 'Ada' }), '', 'nothing until a ping is out')
  state.sent.set(ADA.id, { name: 'Ada', words: 'Pinged. Ada will see it when they are back.', note: 'later', link: `/j/${TOKEN}`, place: PARK, expiresAt: app.game.view.value.now + 3600000 })
  const html = await render('PingStrip', { id: ADA.id, name: 'Ada <b>' })
  const words = text(html)
  assert.ok(words.startsWith('Pinged. Ada will see it when they are back. Other ways to reach Ada <b>. The link works for Ada <b> only.'), words)
  assert.ok(!html.includes('Ada <b>'))
  assert.match(html, /<p class="ping-strip-said" role="status">/)
  // Under Node there is no share sheet: the first button copies. The WhatsApp link is the standard share address and nothing else.
  assert.deepEqual(buttons(html), ['share', 'cancel'])
  assert.ok(words.includes('Copy join link WhatsApp Take back'), words)
  const link = /<a class="link-button is-default"[^>]*href="([^"]+)"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>WhatsApp<\/a>/.exec(html)?.[1]?.replace(/&amp;/g, '&') ?? ''
  const address = new URL(link)
  assert.deepEqual([address.origin, address.pathname, [...address.searchParams.keys()]], ['https://wa.me', '/', ['text']])
  assert.ok((address.searchParams.get('text') ?? '').endsWith(`/j/${TOKEN}`) && (address.searchParams.get('text') ?? '').startsWith('Ada <b>, I am in Allworld right now, at Freedom Park, Lagos.'))
  // A ping that has run out is not offered any more.
  state.sent.set(ADA.id, { name: 'Ada', words: 'x', note: 'later', link: `/j/${TOKEN}`, place: PARK, expiresAt: app.game.view.value.now - 1 })
  assert.equal(await render('PingStrip', { id: ADA.id, name: 'Ada' }), '')
})

test('the notices: an incoming ping offers Join first, then Call and Chat; each later state offers only what makes sense', async () => {
  reset()
  assert.equal(await render('PingNotices'), '', 'nothing to show, nothing drawn')
  state.banner = { kind: 'incoming', notice: notice(), busy: false, error: null }
  let html = await render('PingNotices')
  assert.equal(text(html), 'Ada <b> is at Freedom Park, Lagos They pinged you to come. Join them and you land right there. Join Call Chat ×')
  assert.ok(!html.includes('Ada <b>'))
  assert.match(html, /<aside class="ping-notice is-good" role="status" aria-live="polite" data-ping="notice">/)
  assert.deepEqual(buttons(html), ['join', 'call', 'chat', 'close'])
  assert.match(html, /<button type="button" class="[^"]*\bis-primary\b[^"]*" data-ping="join" aria-label="Join Ada &lt;b&gt;">Join<\/button>/)
  assert.match(html, /data-ping="chat" aria-label="Chat with Ada &lt;b&gt;">Chat</)
  assert.equal((html.match(/is-primary/g) ?? []).length, 1, 'one primary action')
  assert.match(html, /<button type="button" class="ping-notice-close" aria-label="Dismiss" data-ping="close">/)
  state.banner = { kind: 'incoming', notice: notice(), busy: true, error: null }
  html = await render('PingNotices')
  assert.deepEqual(buttons(html), ['join:off', 'call:off', 'chat:off', 'close'])
  assert.ok(text(html).includes('Taking you to Ada <b>… Joining…'))
  state.banner = { kind: 'incoming', notice: notice({ invite: true }), busy: false, error: null }
  assert.ok(text(await render('PingNotices')).startsWith('Ada <b> joined through your link They are at Freedom Park, Lagos right now.'))
  state.banner = { kind: 'joined', from: ADA, words: 'You joined Ada <b> at Freedom Park, Lagos.', knock: false, present: true }
  html = await render('PingNotices', { inDialog: true })
  assert.equal(text(html), 'You joined Ada <b> at Freedom Park, Lagos. Say hello: chat, or call them. Chat Call ×')
  assert.match(html, /class="ping-notice is-good is-in-dialog"/)
  state.banner = { kind: 'joined', from: ADA, words: 'Ada <b> is at home in Lagos. Knock to come in.', knock: true, present: true }
  assert.deepEqual(buttons(await render('PingNotices')), ['knock', 'chat', 'close'])
  state.banner = { kind: 'came', by: ADA, place: 'at Freedom Park, Lagos', present: false }
  html = await render('PingNotices')
  assert.equal(text(html), 'Ada <b> joined you at Freedom Park, Lagos Say hello in a message. Chat ×')
  state.banner = { kind: 'left', from: ADA, words: 'Ada <b> has left. You can message them.' }
  html = await render('PingNotices')
  assert.equal(text(html), 'Ada <b> has left. You can message them. Nothing was changed: you are where you were. Chat ×')
  assert.match(html, /class="ping-notice is-info"/)
  state.banner = { kind: 'other' }
  html = await render('PingNotices')
  assert.equal(text(html), 'That invitation was for another player Nothing was changed. Log in as the player it was sent to, and open the link again. ×')
  assert.deepEqual(buttons(html), ['close'])
  reset()
})

test('the host is nothing until there is something to show', async () => {
  reset()
  ui.wanted = false
  assert.equal((await render('PingHost')).replace(/<!--.*?-->/g, ''), '')
})
