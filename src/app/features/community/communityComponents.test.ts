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

test('the panel: place as the title, city under it, connection and head count, the people, the voice control, the movement pad and the chat', async () => {
  const html = await render('CommunityPanel', panel())
  for (const cls of ['community', 'community-header', 'community-connection', 'community-room', 'community-content', 'community-members', 'community-proximity', 'community-movement', 'community-voice', 'community-join-voice', 'community-chat', 'community-messages', 'community-compose', 'community-feedback']) assert.match(html, new RegExp(`class="[^"]*\\b${cls}\\b`), cls)
  assert.match(html, /<h2>The Park<\/h2>/)
  assert.match(html, /<p class="community-room">Lagos<\/p>/)
  assert.doesNotMatch(text(html), /People nearby|Community\b/)
  assert.match(text(html), /Connected 2 here/)
  assert.ok(html.includes('aria-label="Room members"') && html.includes('aria-label="Room messages"'))
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /<button[^>]*class="community-join-voice"[^>]*>.*Join voice<\/button>/)
  assert.doesNotMatch(html, /community-mute|community-leave-voice/, 'Mute and Leave appear only in voice')
  assert.match(html, /placeholder="Say hello…"/)
  assert.match(html, /<h3 class="community-sr-only">In this room<\/h3>/)
  assert.match(text(html), /How voice works/)
  assert.match(html, /<details class="how"><summary>How voice works<\/summary>/, 'the long voice text is behind a disclosure')
})

test('alone: a short empty state with one action, no movement pad; with someone else the pad shows', async () => {
  const state = communityState()
  const lone = await render('CommunityPanel', panel({ members: [state.members[0]!], memberCount: 1 }))
  assert.match(text(lone), /Just you/)
  assert.match(text(lone), /You are the first one here\./)
  assert.match(lone, /class="community-invite"[^>]*>Invite a friend</)
  assert.doesNotMatch(lone, /community-movement/)
  const two = await render('CommunityPanel', panel())
  assert.match(two, /community-movement/)
  assert.doesNotMatch(two, /community-alone|community-invite/)
})

test('the people row: you, someone in voice (live ring, near), someone muted; everyone but you opens a card', async () => {
  const state = communityState()
  const members = [...state.members, { id: 'c', name: 'Cy', you: false, label: 'Cy', state: 'Mic muted · out of range', voice: 'muted' as const, range: 'far' as const }]
  const html = await render('CommunityPanel', panel({ members, memberCount: 3 }))
  assert.match(html, /<li class="is-off is-you">/)
  assert.match(html, /<li class="is-live">/)
  assert.match(html, /<li class="is-muted">/)
  assert.match(text(html), /In voice · near/)
  assert.match(text(html), /Muted · far/)
  assert.match(html, /<button[^>]*class="community-person"[^>]*aria-label="Bea &lt;b&gt;, open card to report or block"/)
  assert.match(html, /<button[^>]*aria-label="Cy, open card to report or block"/)
  assert.doesNotMatch(html, /aria-label="Alex, open card"/, 'you are not a button')
})

test('the movement pad: four named arrow buttons in a labelled group, disabled without a place, hidden when it cannot walk', async () => {
  const html = await render('CommunityPanel', panel())
  assert.match(html, /role="group" aria-label="Walk your character"/)
  for (const [cls, name] of [['north', 'up'], ['west', 'left'], ['south', 'down'], ['east', 'right']]) assert.match(html, new RegExp(`class="community-${cls}" aria-label="Walk ${name}"`))
  assert.match(text(html), /Walk closer to hear someone\./)
  assert.doesNotMatch(await render('CommunityPanel', panel({ walkDisabled: true })), /community-movement/)
})

test('chat: own lines are marked and named You with a time, a delivery state shows only when it is not Sent, the empty state is one line', async () => {
  const empty = await render('CommunityPanel', panel())
  assert.match(text(empty), /No messages yet\. Say hello\./)
  const at = new Date(2026, 9, 10, 9, 5).getTime()
  const html = await render('CommunityPanel', panel({ chat: [
    { key: '1', author: 'Alex', authorId: 'a', body: 'hi', delivery: 'Sent', canRetry: false, at },
    { key: '2', author: 'Bea', authorId: 'b', body: 'hello', delivery: 'Sent', canRetry: false, at },
    { key: '3', author: 'Alex', authorId: 'a', body: 'again', delivery: 'Sending…', canRetry: false, at },
  ] }))
  assert.equal((html.match(/class="is-mine"/g) ?? []).length, 2)
  assert.match(html, /<strong>You<\/strong><time>/)
  assert.match(html, /<strong>Bea<\/strong>/)
  assert.match(html, /data-community-report-message[^>]*aria-label="Report Bea(?:&#39;|')s room message"[^>]*>Report message<\/button>/)
  assert.doesNotMatch(html, /<small>Sent<\/small>/)
  assert.match(html, /<small>Sending…<\/small>/)
  assert.doesNotMatch(text(html), /No messages yet/)
})

test('the composer: a multi-line field, Send is disabled while empty, and a refusal shows beside it and not at the top', async () => {
  const html = await render('CommunityPanel', panel())
  assert.match(html, /<textarea id="community-message"[^>]*maxlength="500"/)
  assert.match(html, /class="community-send"[^>]*aria-label="Send"[^>]*disabled/)
  const refused = await render('CommunityPanel', panel({ feedback: 'That wording is not allowed here.', refusal: { seq: 1, text: 'That wording is not allowed here.' } }))
  assert.match(refused, /<p class="community-refusal" role="alert">That wording is not allowed here\.<\/p>/)
  assert.match(refused, /<p class="community-feedback" role="status"><\/p>/, 'the top notice stays empty for a chat refusal')
  const other = await render('CommunityPanel', panel({ feedback: 'Microphone permission was denied. You can still use room chat.' }))
  assert.match(other, /<p class="community-feedback" role="status">Microphone permission was denied\./)
  assert.doesNotMatch(other, /community-refusal/)
  const off = await render('CommunityPanel', panel({ composeDisabled: true }))
  assert.match(off, /<textarea[^>]*disabled/)
})

test('connection: the status carries a tone, and Reconnect is a notice at the top', async () => {
  assert.match(await render('CommunityPanel', panel()), /is-good community-connection/)
  assert.match(await render('CommunityPanel', panel({ connection: 'Connecting…' })), /is-warn community-connection/)
  const off = await render('CommunityPanel', panel({ connection: 'Disconnected', canReconnect: true, feedback: 'The room is offline. Reconnect when the server is available.' }))
  assert.match(off, /is-bad community-connection/)
  assert.match(off, /class="community-notice"/)
  assert.match(off, /class="community-retry"[^>]*>Reconnect</)
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
  assert.match(html, /class="community-mute"[^>]*aria-pressed="true"[^>]*>.*Unmute mic</)
  assert.match(html, />Leave</)
  assert.doesNotMatch(html, /community-join-voice/)
})

test('a joining button is disabled and says what it waits for; Walk is disabled without a place', async () => {
  const state = communityState()
  const html = await render('CommunityPanel', panel({ walkDisabled: true, voice: { ...state.voice, joining: true, canJoin: false, joinLabel: 'Requesting microphone…', status: 'Waiting for microphone permission…' } }))
  assert.match(html, /community-join-voice[^>]*disabled[^>]*>.*Requesting microphone…</)
  assert.doesNotMatch(html, /community-movement/, 'no pad while Walk has no place to start from')
})

test('a private room with nobody else in it: only the note, no voice, no chat', async () => {
  const state = communityState(), alone = state.members.filter((member) => member.you)
  const html = await render('CommunityPanel', panel({ privateHome: true, roomText: 'Lagos · Your home (private)', members: alone, memberCount: alone.length }))
  assert.match(text(html), /Only you are here\. This room is private/)
  assert.doesNotMatch(html, /community-voice|community-chat|community-proximity/)
})

test('a private room with company (a home with guests, a group’s room): voice and chat, and nobody walks', async () => {
  const html = await render('CommunityPanel', panel({ privateHome: true, roomText: 'Night shift', walkDisabled: true }))
  assert.doesNotMatch(text(html), /Only you are here/)
  assert.match(html, /community-voice/)
  assert.match(html, /community-chat/)
  assert.doesNotMatch(html, /community-proximity/, 'there is no near or far in a private room')
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

test('room groups: the header says who is with you and how many are in the place; other groups are listed with friends named and a full one cannot be joined', async () => {
  const group = { here: 13, total: 128, groups: 11, cap: 16, header: '12 here with you · 128 in this place' }
  const html = await render('CommunityPanel', panel({ group, groupNote: 'You are now with 12 others.', apart: { id: 'd', name: 'Dara', waiting: false } }))
  assert.match(text(html), /12 here with you · 128 in this place/)
  assert.match(text(html), /You are now with 12 others\./)
  assert.match(text(html), /Dara is in another part of the venue\. Join Dara's group/)
  assert.match(html, /data-groups-open[^>]*>See other groups</)
  const open = await render('CommunityPanel', panel({ group, groupList: { total: 128, more: 3, groups: [
    { id: 'g1', no: 1, size: 13, open: true, mine: true, friends: [] },
    { id: 'g2', no: 2, size: 16, open: false, mine: false, friends: ['Dara'] },
    { id: 'g3', no: 3, size: 8, open: true, mine: false, friends: [] }] } }))
  assert.match(text(open), /Group 1 \(yours\) · 13 people/)
  assert.match(text(open), /Group 2 · 16 people · Dara Full/)
  assert.match(open, /data-group-join="g3"[^>]*>Join</)
  assert.match(open, /disabled[^>]*data-group-join="g2"|data-group-join="g2"[^>]*disabled/)
  assert.match(text(open), /and 3 more groups/)
  assert.doesNotMatch(html, /data-group-list/)
  const home = await render('CommunityPanel', panel({ group: null }))
  assert.doesNotMatch(home, /data-group-header|data-groups-open/)
})

test('an NPC line in the room is badged and tinted so it cannot pass for a player; a player line has neither', async () => {
  const html = await render('CommunityPanel', panel({ chat: [
    { key: 'p', author: 'Bea', body: 'Hello', delivery: 'Sent', canRetry: false },
    { key: 'n', author: 'Amaka', body: 'Welcome in', delivery: '', canRetry: false, npc: true },
  ] }))
  const lines = html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*<\/li>/g)?.filter((li) => /Hello|Welcome in/.test(li)) ?? []
  assert.equal(lines.length, 2)
  const [player, npc] = lines
  assert.ok(player && !player.includes('data-npc') && !player.includes('is-npc'), 'a real player\'s line carries no mark')
  assert.ok(npc?.includes('data-npc-line') && npc.includes('is-npc') && npc.includes('data-npc-badge'), 'an NPC line is marked')
  assert.ok(text(npc ?? '').includes('NPC, a game character, not a real player') && text(npc ?? '').includes('Amaka'), 'a screen reader hears what it is')
  assert.equal((html.match(/data-npc-badge/g) ?? []).length, 1)
})

test('chat: a flagged line from someone else shows the scam warning with Report; your own flagged line and an ordinary line show none', async () => {
  const at = new Date(2026, 9, 10, 9, 5).getTime()
  const html = await render('CommunityPanel', panel({ chat: [
    { key: '1', author: 'Bea', authorId: 'b', body: 'send me 5k make I help you withdraw', delivery: '', canRetry: false, at, scam: true },
    { key: '2', author: 'Cy', authorId: 'c', body: 'hello', delivery: '', canRetry: false, at },
    { key: '3', author: 'Alex', authorId: 'a', body: 'send me 5k', delivery: 'Sent', canRetry: false, at, scam: true },
  ] }))
  assert.equal((html.match(/data-scam-notice/g) ?? []).length, 1)
  assert.match(text(html), /Game naira is never real money\. Nobody can withdraw it for you\./)
  assert.match(html, /data-scam-report[^>]*>Report<\/button>/)
})
