import { loadCityContent as preloadCityContent } from '../../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// Component tests for the Community panel and its host, in the manner of src/app/components.test.ts:
// compiled by the project's own Vite configuration and rendered to a string, against a store whose
// state is set by hand. What is asserted is the words, labels, roles and disabled controls the player
// gets; what a press does is tested at the controller (src/community.test.ts) and the store.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h, ref, shallowRef } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { CommunityDeps, CommunityStore } from './communityStore.ts'
import { communityState, fakeController } from './communityFixtures.ts'
import type { CommunityState } from '../../../types/community.ts'
import type { LifeState } from '../../../types/life.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
let makeStore: (deps: CommunityDeps) => CommunityStore

before(async () => {
  vite = await createServer({ root, configFile: `${root}vite.config.js`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  makeStore = ((await vite.ssrLoadModule('/src/app/features/community/communityStore.ts')) as { createCommunityStore: typeof makeStore }).createCommunityStore
})
after(async () => { await vite?.close() })

const deps = (): CommunityDeps => ({
  game: { state: shallowRef({ location: 'park', activeAction: null } as unknown as LifeState), cityId: ref('lagos'), connected: ref(true), link: ref('online'), on: () => () => {} } as unknown as CommunityDeps['game'],
  venueLabel: (venueId) => venueId, status: () => {}, toast: () => {}, onMembers: () => {}, walkBy: () => true,
  loadModule: async () => ({ createCommunity: async (options) => fakeController(options) }),
})
async function render(name: string, store: CommunityStore): Promise<string> {
  const component = ((await vite.ssrLoadModule(`/src/app/features/community/${name}.vue`)) as { default: Component }).default
  const html = await renderToString(createSSRApp({ render: () => h(component, { store }) }))
  return html.replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
const panel = (patch: Partial<CommunityState> = {}) => { const store = makeStore(deps()); store.state.value = communityState(patch); return store }

test('the panel keeps the old markup: classes, labels, the four Walk buttons and the voice controls', async () => {
  const html = await render('CommunityPanel', panel())
  for (const cls of ['community', 'community-header', 'community-connection', 'community-room', 'community-content', 'community-members', 'community-proximity', 'community-movement', 'community-voice', 'community-join-voice', 'community-chat', 'community-messages', 'community-compose', 'community-feedback']) assert.match(html, new RegExp(`class="[^"]*\\b${cls}\\b`), cls)
  for (const label of ['Walk your character', 'Walk two steps away from the entrance', 'Walk two steps left', 'Walk two steps towards the entrance', 'Walk two steps right', 'Room members', 'Room messages']) assert.ok(html.includes(`aria-label="${label}"`), label)
  assert.match(html, /aria-live="polite"/)
  assert.match(text(html), /Lagos · The Park/)
  assert.match(text(html), /Your microphone is off\. Join voice to request access\./)
  assert.match(html, /<button[^>]*class="community-join-voice"[^>]*>Join voice<\/button>/)
  assert.doesNotMatch(html, /community-mute|community-leave-voice/, 'Mute and Leave appear only in voice')
  assert.match(html, /Say hello to this room…/)
  assert.match(html, /<h3>In this room <span class="community-count">2<\/span><\/h3>/)
})

test('everything typed by a player is text, never markup', async () => {
  const html = await render('CommunityPanel', panel({ chat: [{ key: 'k', author: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>', delivery: 'Sent', canRetry: false }] }))
  assert.doesNotMatch(html, /<script|<img/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /Bea &lt;b&gt;/)
})

test('in voice: Mute and Leave are shown, Join is not, and the mute state is exposed', async () => {
  const state = communityState()
  const html = await render('CommunityPanel', panel({ voice: { ...state.voice, on: true, muted: true, muteLabel: 'Unmute mic', status: 'Microphone muted. No one in voice is within 12 steps. Walk closer to someone in the venue.' } }))
  assert.match(html, /class="community-mute"[^>]*aria-pressed="true"[^>]*>Unmute mic</)
  assert.match(html, />Leave voice</)
  assert.doesNotMatch(html, /community-join-voice/)
})

test('a joining button is disabled and says what it waits for; Walk is disabled without a place', async () => {
  const state = communityState()
  const html = await render('CommunityPanel', panel({ walkDisabled: true, voice: { ...state.voice, joining: true, canJoin: false, joinLabel: 'Requesting microphone…', status: 'Waiting for microphone permission…' } }))
  assert.match(html, /community-join-voice[^>]*disabled[^>]*>Requesting microphone…</)
  assert.match(html, /community-north[^>]*disabled/)
})

test('home is private: only the note, no voice, no chat', async () => {
  const html = await render('CommunityPanel', panel({ privateHome: true, roomText: 'Lagos · Your home (private)' }))
  assert.match(text(html), /Your home is private to this device session\./)
  assert.doesNotMatch(html, /community-voice|community-chat|community-proximity/)
})

test('a device without a nickname is asked for one; a refused line offers Retry', async () => {
  const first = await render('CommunityPanel', panel({ hasSession: false, session: null, connection: 'Choose a nickname' }))
  assert.match(first, /Choose a device nickname/)
  assert.match(first, /minlength="3" maxlength="24"/)
  assert.doesNotMatch(first, /community-content/)
  const refused = await render('CommunityPanel', panel({ chat: [{ key: 'k', author: 'Alex', body: 'hi', delivery: 'Not sent', canRetry: true }], feedback: 'That wording is not allowed here.' }))
  assert.match(refused, /Retry message/)
  assert.match(text(refused), /That wording is not allowed here\./)
})

test('the microphone list, a blocked playback, the playback note and Reconnect are shown when the state has them', async () => {
  const state = communityState()
  const html = await render('CommunityPanel', panel({ canReconnect: true, voice: { ...state.voice, on: true, playbackNote: 'Spatial playback is unavailable.', devices: [{ id: '', label: 'System default' }, { id: 'm', label: 'Test microphone' }], blocked: [{ id: 'b', name: 'Bea' }] } }))
  assert.match(html, /id="community-microphone"[^>]*aria-label="Microphone device"/)
  assert.match(html, /Test microphone/)
  assert.match(html, /Play audio from Bea/)
  assert.match(html, /Spatial playback is unavailable\./)
  assert.match(html, />Reconnect</)
})

test('the host: closed renders nothing; open shows a labelled aside with a close button and the panel', async () => {
  const closed = makeStore(deps())
  assert.doesNotMatch(await render('CommunityHost', closed), /community-panel/)
  const store = makeStore(deps())
  await store.start()
  store.toggle(true)
  assert.equal(store.open.value, true)
  const html = await render('CommunityHost', store)
  assert.match(html, /<aside id="community-panel" aria-label="Community"/)
  assert.match(html, /id="community-close"[^>]*aria-label="Close community"/)
  assert.match(html, /class="community"/)
})

test('the host says what went wrong while the code is not here, with both ways out', async () => {
  const store = makeStore(deps())
  store.recovery.value = { heading: 'Community could not load', lead: 'Your saved city life is still available. Check your connection, then try community again.', next: 'Trying again by itself in 2 s (attempt 3 of 6).', waiting: false }
  store.toggle(true)
  const html = await render('CommunityHost', store)
  assert.match(html, /data-community-recovery[^>]*aria-label="Community unavailable"/)
  assert.match(html, /<h2>Community could not load<\/h2>/)
  assert.match(html, /Reload and retry/)
  assert.match(html, /data-community-retry[^>]*>Try again</)
  assert.doesNotMatch(html, /data-community-retry[^>]*disabled/)
  store.recovery.value = { ...store.recovery.value, waiting: true, next: 'Trying again now…' }
  assert.match(await render('CommunityHost', store), /data-community-retry[^>]*disabled/)
})
