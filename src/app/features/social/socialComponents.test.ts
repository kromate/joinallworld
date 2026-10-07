// The social screens rendered to a string against the real store and the fake server: what a
// player reads and can press on People, the person card, Contacts, Family and Invite, and the
// metadata the registry gives them. What a click does is tested where the logic lives
// (socialClient.test.ts, socialModel.test.ts).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import type { HouseView, PersonCard, SocialOverview } from '../../../types/social.ts'
import type { SocialClient } from './socialClient.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let client: SocialClient
const realFetch = globalThis.fetch

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<span class="ui-avatar"[\s\S]*?<\/span>/g, '').replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
const ref = (id: string, name: string) => ({ id, name })
function overview(extra: Partial<SocialOverview> = {}): SocialOverview {
  const me = ref(server.session()?.id ?? 'me', 'Kunle')
  return {
    ok: true, code: 'ok', me: { ...me, since: 1 }, friends: [], bae: null, blocked: [], reports: [], invitePath: '/v/me', visiting: null, door: { who: 'knock', out: false, chosen: true }, invites: [],
    requests: { in: [], out: [] }, baeRequests: [], conversations: [], updates: [],
    house: { host: me, capacity: 4, guests: [], role: 'host', cityId: null, conv: null, hostStatus: 'home', knocks: [] },
    prefs: { groups: 'friends', mentions: 'on', pictures: 'friends', introductions: 'off', notify: { text: true, groups: 'mentions', pausedUntil: null, quietDm: false, quietGroups: true } },
    limits: { body: 500, groupSize: 8, groupName: 30, guests: 4, reportText: 300, reasons: ['spam', 'offensive-name'], pins: 3, mentions: 5, pictures: { on: true, bytes: 250000, caption: 200 } }, ...extra,
  }
}
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)) }
const disabledButton = (html: string, label: string): boolean => new RegExp(`<button[^>]*disabled[^>]*>(?:<!--.*?-->)*${label}`).test(html)

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  client = (await load<{ useSocial: () => SocialClient }>('/src/app/features/social/useSocial.ts')).useSocial()
  // Under Node there is no page and no WebSocket: the client is given the api and nothing more.
  client.attach(app.api)
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the gate: a screen with no overview says so, with Retry on a failed read; nothing is rendered as markup', async () => {
  client.state.me = null; client.state.error = null
  assert.equal(text(await render('/src/app/features/social/InviteApp.vue')), 'Loading…')
  client.state.error = 'Connection lost <b>x</b>'
  const html = await render('/src/app/features/social/InviteApp.vue')
  assert.equal(text(html), 'Could not load: Connection lost <b>x</b> Retry')
  assert.ok(!html.includes('<b>x</b>'))
  client.state.error = null
})

test('Family: the household, the streak, a Call button for each and the beta labels', async () => {
  const html = await render('/src/app/features/social/FamilyApp.vue')
  const social = app.game.view.value.social
  const words = text(html)
  assert.ok(words.includes(`Your people back home Beta ${social.family.filter((member) => member.calledToday).length} of ${social.family.length} checked in today`))
  assert.ok(words.includes(`Streak: ${social.streak} day${social.streak === 1 ? '' : 's'} · each first call of the day gives +${social.familyCall.social} Social and +${social.familyCall.mood} mood for a few hours`))
  assert.equal((html.match(/aria-label="Call /g) ?? []).length, social.family.length)
  for (const member of social.family) assert.ok(words.includes(member.name) && words.includes(`${member.relation} · ${member.line}`))
  assert.ok(words.includes(`A call takes ${social.familyCall.duration} seconds and works anywhere.`))
  assert.ok(words.endsWith('Original beta feature and values. The family here is the same for every player for now.'))
  assert.match(html, /<button[^>]*class="social-btn is-primary"[^>]*>(?:<!--.*?-->)*Call<\/button>/)
})

test('Family: every Call button says why it is off while an action is running', async () => {
  const before = app.game.state.value
  app.game.state.value = { ...before, activeAction: { id: 'x', type: 'rest' } as never }
  try {
    const html = await render('/src/app/features/social/FamilyApp.vue')
    assert.match(html, /disabled[^>]*title="Finish or cancel your current action first\."[^>]*aria-label="Call [^"]*\. Finish or cancel your current action first\."/)
    assert.ok(text(html).includes('Finish or cancel your current action to call.'))
  } finally { app.game.state.value = before }
})

test('Contacts: Mummy first with a Call, the search, friends with their presence and Chat, and the empty state', async () => {
  client.state.me = overview()
  let html = await render('/src/app/features/social/ContactsApp.vue')
  let words = text(html)
  const mummy = app.game.view.value.social.family.find((member) => member.contact)
  assert.ok(mummy && words.startsWith(mummy.name), words.slice(0, 120))
  assert.ok(words.includes('Find a player') && words.includes('Saved contacts'))
  assert.match(html, /<input[^>]*name="q"[^>]*maxlength="36"[^>]*placeholder="Player name"[^>]*aria-label="Find a player by name"/)
  if (!app.game.view.value.social.relationships.some((rel) => rel.npc)) assert.ok(words.includes('No saved contacts yet Meet people around town to save their numbers. Open the map'))
  assert.ok(words.endsWith('Names are not unique: check the short code after # when two players share a name.'))

  client.state.me = overview({ friends: [{ id: 'f1', name: 'Femi <i>x</i>', since: 1, bae: false, status: 'online', venue: 'market', cityId: 'lagos' }] })
  html = await render('/src/app/features/social/ContactsApp.vue')
  words = text(html)
  assert.ok(words.includes('Femi <i>x</i> Friend · Online'), words)
  assert.ok(!html.includes('<i>x</i>'), 'a name is text')
  assert.match(html, /<i class="is-on social-dot"/)
  assert.ok(words.includes('Chat') && !words.includes('No saved contacts yet'))
  client.state.me = null
})

test('Contacts: a life whose family list has no contact leaves the family card out instead of failing', async () => {
  const { FAMILY } = await load<{ FAMILY: Record<string, { contact?: boolean }> }>('/src/game/content/npcs.ts')
  const before = app.game.state.value, contact = FAMILY.mummy!.contact
  client.state.me = overview()
  try {
    delete FAMILY.mummy!.contact
    app.game.state.value = { ...before } // the view is recomputed from the state
    assert.equal(app.game.view.value.social.family.some((member) => member.contact), false)
    const html = await render('/src/app/features/social/ContactsApp.vue')
    const words = text(html)
    assert.ok(words.startsWith('Find a player'), words.slice(0, 80))
    assert.ok(!words.includes('Mummy') && !words.includes('checked in today'), words.slice(0, 200))
    assert.ok(words.includes('Saved contacts'))
  } finally { if (contact) FAMILY.mummy!.contact = contact; app.game.state.value = { ...before }; client.state.me = null }
})

test('Contacts: found players are listed with their short code and a View button', async () => {
  const { contactsUi } = await load<{ contactsUi: { find: string; results: unknown; finding: boolean } }>('/src/app/features/social/socialState.ts')
  client.state.me = overview()
  contactsUi.results = [{ id: 'abcdef123456', name: 'Ada', friend: true }]
  try {
    const words = text(await render('/src/app/features/social/ContactsApp.vue'))
    assert.ok(words.includes('Ada Real player · Friend · #abcdef View'), words)
    contactsUi.results = { error: 'Type at least two letters of their name.' }
    assert.ok(text(await render('/src/app/features/social/ContactsApp.vue')).includes('Type at least two letters of their name.'))
    contactsUi.results = []
    assert.ok(text(await render('/src/app/features/social/ContactsApp.vue')).includes('Nobody found with that name.'))
  } finally { contactsUi.results = null; client.state.me = null }
})

test('People: the place, who is here, friends with their presence and requests with Accept and Decline, blocked with Unblock', async () => {
  const { peopleUi } = await load<{ peopleUi: { loadedFor: string | null } }>('/src/app/features/social/socialState.ts')
  const view = app.game.view.value
  const place = app.game.state.value.location
  // The listing is current: nothing is read while rendering.
  peopleUi.loadedFor = `${view.cityId}:${place}:${Boolean(app.game.state.value.activeAction)}`
  client.state.peopleAt = view.now
  client.state.people = { ok: true, code: 'ok', cityId: view.cityId, venue: place, self: 'joined', count: 1, players: [{ id: 'p1', name: 'Zainab <b>', friend: true, requested: false, incoming: false, look: null, here: true }] }
  client.state.me = overview({
    friends: [{ id: 'f1', name: 'Femi', since: 1, bae: true, status: 'reconnecting' }],
    requests: { in: [{ id: 'r1', name: 'Rita', at: 1 }], out: [{ id: 'o1', name: 'Obi', at: 1 }] },
    blocked: [{ id: 'b1', name: 'Bad Actor', at: 1 }],
  })
  const html = await render('/src/app/features/social/PeopleApp.vue')
  const words = text(html)
  assert.ok(words.startsWith(`Here at ${view.venues.find((venue) => venue.id === place)?.label ?? place} Refresh`), words.slice(0, 80))
  assert.ok(words.includes('1 guest in your home'), words.slice(0, 200))
  assert.ok(words.includes('Zainab <b> Real player · Friend'))
  assert.ok(!html.includes('<b> Real'), 'a name is text')
  assert.ok(words.includes('Rita wants to be friends Accept Decline'))
  assert.ok(words.includes('Femi your Bae Reconnecting…') || words.includes('Femi your Bae'), words)
  assert.match(html, /class="is-reconnecting social-presence"/)
  assert.ok(words.includes('Waiting for an answer from: Obi'))
  assert.ok(words.includes('Blocked Bad Actor Cannot message, invite or see you Unblock'))
  assert.ok(words.includes('Relationships') && words.includes('Closeness tiers (Acquaintance 5, Friend 20, Paddy Mi 40)'))
  assert.equal(client.state.peopleLoading, false, 'rendering a current listing reads nothing')
  client.state.me = null; client.state.people = null
})

test('People: with no friends the empty state offers the map; the gate shows in place of Friends', async () => {
  const { peopleUi } = await load<{ peopleUi: { loadedFor: string | null } }>('/src/app/features/social/socialState.ts')
  const view = app.game.view.value
  peopleUi.loadedFor = `${view.cityId}:${app.game.state.value.location}:${Boolean(app.game.state.value.activeAction)}`
  client.state.peopleAt = view.now
  client.state.me = overview()
  let words = text(await render('/src/app/features/social/PeopleApp.vue'))
  assert.ok(words.includes('No friends yet Go to places around town, greet people, and add the players you meet. Find somewhere to go'))
  client.state.me = null
  words = text(await render('/src/app/features/social/PeopleApp.vue'))
  assert.ok(words.includes('Friends Loading…'), words)
})

test('Person: nobody selected, an NPC that is not around, and a player that has not loaded', async () => {
  assert.equal(text(await render('/src/app/features/social/PersonApp.vue', { params: {} })), 'Nobody selected.')
  assert.equal(text(await render('/src/app/features/social/PersonApp.vue', { params: { npc: 'nobody-here' } })), 'That person is not around.')
  client.state.me = overview()
  client.state.profiles.clear()
  const { personUi } = await load<{ personUi: { player: string | null } }>('/src/app/features/social/socialState.ts')
  personUi.player = 'ada'
  assert.equal(text(await render('/src/app/features/social/PersonApp.vue', { params: { player: 'ada' } })), 'Loading player…')
  await settle() // the card was asked for, as the existing panel does: the fake server has no such route
  client.state.profiles.set('ada', { error: 'No such player.' })
  assert.equal(text(await render('/src/app/features/social/PersonApp.vue', { params: { player: 'ada' } })), 'No such player. Retry')
  client.state.profiles.clear(); client.state.me = null
})

test('Person: a player\'s card says why each control is off, and a stranger reads Stranger · 0/5', async () => {
  const { personUi } = await load<{ personUi: { player: string | null; form: string | null } }>('/src/app/features/social/socialState.ts')
  const card: PersonCard = { id: 'ada', name: 'Ada <b>', self: false, friend: false, requested: false, incoming: false, blocked: false, bae: false, baeAsked: false, status: 'offline' }
  client.state.me = overview()
  client.state.people = null
  personUi.player = 'ada'; personUi.form = null
  client.state.profiles.set('ada', card)
  try {
    let html = await render('/src/app/features/social/PersonApp.vue', { params: { player: 'ada', name: 'Ada' } })
    let words = text(html)
    assert.ok(words.startsWith('Ada <b> Real player · Offline'), words.slice(0, 60))
    assert.ok(!html.includes('Ada <b>'), 'a name is text')
    // Not in the game: Ping stands where Call would, and for a stranger it says what is missing.
    assert.ok(words.includes('Chat Ping Ada <b> Add Ada <b> as a friend to ping them.'), words)
    assert.match(html, /<button[^>]*disabled[^>]*data-ping="send"|<button[^>]*data-ping="send"[^>]*disabled/)
    client.state.profiles.set('ada', { ...card, status: 'online' })
    assert.ok(text(await render('/src/app/features/social/PersonApp.vue', { params: { player: 'ada' } })).includes('Chat Call'), 'in the game: Call, as before')
    client.state.profiles.set('ada', card)
    assert.ok(words.includes('Stranger · 0/5 to Acquaintance'), words)
    assert.ok(words.includes('Ada <b> is not in this venue with you right now.'))
    assert.ok(words.includes('Ask to be my Bae Become friends first.'))
    assert.ok(words.includes('Send money You can only send money to friends.'))
    assert.match(html, /<button[^>]*class="social-btn"[^>]*>(?:<!--.*?-->)*Add friend<\/button>/)
    assert.match(html, /<button[^>]*class="social-btn is-danger"[^>]*>(?:<!--.*?-->)*Block<\/button>/)
    assert.ok(words.includes('Report') && words.includes('Blocking removes you from each other’s lists'))
    assert.ok(disabledButton(html, 'Chat') === false)

    client.state.profiles.set('ada', { ...card, blocked: true })
    html = await render('/src/app/features/social/PersonApp.vue', { params: { player: 'ada' } })
    words = text(html)
    assert.ok(words.includes('Unblock this player to chat.') && words.includes('You blocked this player.'))
    assert.ok(disabledButton(html, 'Chat') && words.includes('Unblock'))

    client.state.profiles.set('ada', { ...card, self: true })
    assert.equal(text(await render('/src/app/features/social/PersonApp.vue', { params: { player: 'ada' } })), 'This is you, Ada <b>.')

    personUi.form = 'report'
    client.state.profiles.set('ada', card)
    html = await render('/src/app/features/social/PersonApp.vue', { params: { player: 'ada' } })
    assert.match(html, /<select[^>]*name="reason"/)
    assert.ok(text(html).includes('Spam Offensive name') && text(html).includes('A moderator reviews reports. You get a receipt in Messages → Updates.'))
  } finally { personUi.form = null; client.state.profiles.clear(); client.state.me = null }
})

test('Invite: the link, guests, knocks that can be answered, and the house that is full', async () => {
  const { inviteUi } = await load<{ inviteUi: { house: unknown; paste: string; loading: boolean } }>('/src/app/features/social/socialState.ts')
  const view = app.game.view.value
  const guest = { ...ref('g1', 'Guest <b>'), since: 1, expiresAt: 2 }
  client.state.me = overview({ house: { ...overview().house, guests: [guest], capacity: 1, conv: 'h.me', knocks: [{ from: ref('k1', 'Knocker'), at: view.now, expiresAt: view.now + 60000 }] } })
  inviteUi.house = null
  try {
    const html = await render('/src/app/features/social/InviteApp.vue')
    const words = text(html)
    assert.ok(words.includes(`${app.game.state.value.name}’s place`))
    assert.match(html, /<output class="social-code">[^<]*\/v\/me<\/output>/)
    assert.ok(words.includes('1 of 1 guests inside'))
    assert.ok(words.includes('At your door Knocker is knocking Let them in Not now Your house is full (1 guests). Ask someone to leave first.'), words.slice(0, 600))
    assert.ok(disabledButton(html, 'Let them in'), 'a full house cannot let anyone else in')
    assert.ok(words.includes('Guests 1/1 Guest <b> Inside · the visit ends after 30 minutes, or when you go out Ask to leave'))
    assert.ok(!html.includes('Guest <b>'))
    assert.ok(words.includes('Open house chat') && words.includes('Visit a house'))
    assert.match(html, /<input[^>]*name="link"[^>]*maxlength="200"[^>]*placeholder="Paste a house link"/)
    assert.ok(words.includes('How visits work'))
  } finally { client.state.me = null }
})

test('Invite: a looked-up house — Knock says why it is off; being inside offers the house chat and Leave', async () => {
  const { inviteUi } = await load<{ inviteUi: { house: unknown; loading: boolean } }>('/src/app/features/social/socialState.ts')
  const host = ref('h1', 'Tolu')
  const theirs: HouseView = { host, capacity: 3, guests: [], role: 'none', cityId: 'lagos', conv: null, hostStatus: 'out', knocks: [] }
  client.state.me = overview()
  try {
    inviteUi.house = { house: theirs, knock: null }
    let html = await render('/src/app/features/social/InviteApp.vue')
    let words = text(html)
    assert.ok(words.includes('Tolu’s house Online, but not at home · 0/3 guests Knock Tolu must be at home to answer (Online, but not at home). Check again'), words)
    assert.ok(disabledButton(html, 'Knock'))

    inviteUi.house = { house: { ...theirs, hostStatus: 'home' }, knock: null }
    html = await render('/src/app/features/social/InviteApp.vue')
    assert.ok(!disabledButton(html, 'Knock'))

    client.state.me = overview({ visiting: { ...theirs, hostStatus: 'home', role: 'guest' } })
    html = await render('/src/app/features/social/InviteApp.vue')
    words = text(html)
    assert.ok(words.includes('You are inside. Open house chat Leave'))
    assert.ok(words.includes('You are visiting Tolu’s house At home · 0/3 guests · joining the room… House chat Leave'), words)

    inviteUi.house = { error: 'That does not look like a house link. Paste the whole link.' }
    assert.ok(text(await render('/src/app/features/social/InviteApp.vue')).includes('That does not look like a house link. Paste the whole link.'))

    client.state.me = overview()
    inviteUi.house = { house: { ...theirs, host: client.state.me.me, role: 'host' }, knock: null }
    assert.ok(text(await render('/src/app/features/social/InviteApp.vue')).includes('That is your own house. Share the link with someone else.'))
  } finally { inviteUi.house = null; client.state.me = null }
})

test('the registry: the same ids, placements, order, groups and badges as the lazy group, and each opens a component', async () => {
  const { SOCIAL_PANELS } = await load<{ SOCIAL_PANELS: readonly Record<string, unknown>[] }>('/src/app/features/social/register.ts')
  const meta = (panel: Record<string, unknown> | undefined) => ({ id: panel?.id, title: panel?.title, placement: panel?.placement, order: panel?.order, group: panel?.group, phone: panel?.phone, kind: panel?.kind })
  assert.deepEqual(SOCIAL_PANELS.map(meta), [
    { id: 'people', title: 'People', placement: 'sim-tab', order: 50, group: 'people', phone: true, kind: 'vue' },
    { id: 'person', title: 'Person', placement: 'modal', order: undefined, group: undefined, phone: undefined, kind: 'vue' },
    { id: 'contacts', title: 'Contacts', placement: 'phone', order: 20, group: 'people', phone: undefined, kind: 'vue' },
    { id: 'family', title: 'Family', placement: 'phone', order: 36, group: 'people', phone: undefined, kind: 'vue' },
    { id: 'invite', title: 'Invite', placement: 'phone', order: 38, group: 'people', phone: undefined, kind: 'vue' },
  ])
  const badge = (id: string) => SOCIAL_PANELS.find((panel) => panel.id === id)?.badge as undefined | (() => number)
  assert.equal(SOCIAL_PANELS.find((panel) => panel.id === 'contacts')?.badge, undefined)
  const { social } = await load<{ social: { me: SocialOverview | null } }>('/src/app/features/social/useSocial.ts')
  const before = social.me
  try {
    social.me = overview({ requests: { in: [ref('a', 'A')].map((r) => ({ ...r, at: 1 })), out: [] }, baeRequests: [{ ...ref('b', 'B'), at: 1 }] })
    assert.equal(badge('people')?.(), 2)
    social.me = overview({ house: { ...overview().house, knocks: [{ from: ref('k', 'K'), at: 1, expiresAt: 2 }] } })
    assert.equal(badge('invite')?.(), 1)
    social.me = null
    assert.equal(badge('people')?.(), 0)
  } finally { social.me = before }
})

test('the person card brings a form that opens below the screen edge into view, whoever opened it', async () => {
  const card = await readFile(`${root}/src/app/features/social/PlayerCard.vue`, 'utf8')
  const chat = await readFile(`${root}/src/app/features/messages/MessagesApp.vue`, 'utf8')
  // The chat header sets the form directly (it does not go through the card's own button), so the scroll follows the form, not the button.
  assert.match(chat, /personUi\.form = 'money'/)
  assert.match(card, /watch\(\(\) => \[personUi\.form, formEl\.value\] as const[\s\S]*scrollIntoView\?\.\(\{ block: 'nearest' \}\)/)
  assert.doesNotMatch(card.match(/function openForm[\s\S]*?\n\}/)![0], /scrollIntoView/, 'one place scrolls, not two')
})

test('People: the founder\'s Players view is there (search, sorts, a way to pick), and nobody else gets it', async () => {
  client.state.error = null
  client.state.me = overview({ friendsMore: { total: 3, next: null } })
  const founder = await render('/src/app/features/social/PeopleApp.vue')
  assert.ok(text(founder).includes('Players'), 'the section is there')
  client.state.me = overview()
  assert.ok(!text(await render('/src/app/features/social/PeopleApp.vue')).includes('Players'), 'a player without the founder\'s overview has no such section')
  const html = await render('/src/app/features/social/PlayersList.vue')
  assert.match(html, /<input[^>]*type="search"[^>]*aria-label="Search players by name"/)
  assert.match(html, /<select[^>]*aria-label="Sort players"/)
  for (const option of ['Newest first', 'Online first', 'Name A to Z', 'Online in a city']) assert.ok(html.includes(option), option)
  assert.ok(!html.includes('Message selected'), 'nobody is picked yet')
  client.state.me = null
})

// The NPC mark: every surface that shows a game character carries the one badge (and its spoken text); a real player never does.
const badges = (html: string): number => (html.match(/data-npc-badge/g) ?? []).length
const SPOKEN = 'NPC, a game character, not a real player'
/** Stand at a venue that has regulars (and put the life back after). */
async function atRegulars<T>(run: () => Promise<T>): Promise<T> {
  const { regularsFor } = await load<{ regularsFor: (city: string) => readonly { venue: string }[] }>('/src/game/cities/runtime.ts')
  const venue = regularsFor(app.game.cityId.value).find((npc) => npc.venue !== 'home')?.venue
  assert.ok(venue, 'the city has regulars')
  const before = app.game.state.value
  app.game.state.value = { ...before, location: venue }
  try { return await run() } finally { app.game.state.value = before }
}

test('NPC mark: People marks each local with the badge and a real player with none', () => atRegulars(async () => {
  const { peopleUi } = await load<{ peopleUi: { loadedFor: string | null } }>('/src/app/features/social/socialState.ts')
  const view = app.game.view.value
  const place = app.game.state.value.location
  peopleUi.loadedFor = `${view.cityId}:${place}:${Boolean(app.game.state.value.activeAction)}`
  client.state.peopleAt = view.now
  client.state.people = { ok: true, code: 'ok', cityId: view.cityId, venue: place, self: 'joined', count: 1, players: [{ id: 'p1', name: 'Zainab', friend: true, requested: false, incoming: false, look: null, here: true }] }
  client.state.me = overview({ friends: [{ id: 'f1', name: 'Femi', since: 1, bae: false, status: 'online' }] })
  try {
    const html = await render('/src/app/features/social/PeopleApp.vue')
    const locals = view.social.here.length
    assert.ok(locals > 0, 'the test venue has regulars')
    assert.equal(badges(html), locals + view.social.relationships.filter((rel) => rel.npc).length, 'one badge for each local and each saved NPC, none for the player or the friend')
    assert.ok(text(html).includes(SPOKEN))
    assert.match(html, /<span[^>]*class="npc-badge-sr"[^>]*>NPC, a game character, not a real player<\/span>/)
    assert.ok(text(html).includes('Zainab Real player'), 'the player row is unchanged')
    for (const row of html.match(/<button[^>]*class="social-card"[\s\S]*?<\/button>|<div class="social-row"[\s\S]*?<\/span><\/div>/g) ?? []) {
      if (/<strong[^>]*>(Zainab|Femi)/.test(row)) assert.ok(!row.includes('data-npc-badge'), `no badge on ${row.match(/<strong[^>]*>(\w+)/)?.[1]}`)
    }
    assert.ok(text(html).includes(`${locals} NPC`) && text(html).includes('game character'), 'the summary names them NPCs')
  } finally { client.state.me = null; client.state.people = null }
}))

test('NPC mark: the NPC card, Contacts (Mummy and saved NPCs) and Family carry the badge; found players do not', () => atRegulars(async () => {
  const view = app.game.view.value
  const npc = view.social.here[0]
  assert.ok(npc, 'a local to open')
  const card = await render('/src/app/features/social/NpcCard.vue', { id: npc.id })
  assert.equal(badges(card), 1)
  assert.ok(text(card).includes(SPOKEN) && text(card).includes(npc.name))
  assert.ok(!text(card).includes('· NPC'), 'the word is the badge, not text in the role line')

  const family = await render('/src/app/features/social/FamilyApp.vue')
  assert.equal(badges(family), view.social.family.length, 'every family member')

  client.state.me = overview()
  const { contactsUi } = await load<{ contactsUi: { results: unknown } }>('/src/app/features/social/socialState.ts')
  try {
    const contacts = await render('/src/app/features/social/ContactsApp.vue')
    assert.equal(badges(contacts), view.social.family.filter((member) => member.contact).length + view.social.relationships.filter((rel) => rel.npc).length, 'Mummy and each saved NPC')
    contactsUi.results = [{ id: 'abcdef123456', name: 'Ada', friend: true }]
    const found = await render('/src/app/features/social/ContactsApp.vue')
    assert.ok(text(found).includes('Ada Real player'))
    assert.equal(badges(found), badges(contacts), 'the found player adds no badge')
  } finally { contactsUi.results = null; client.state.me = null }
}))

test('NPC mark: a person reference to an NPC always opens the NPC card, never Block or Report', () => atRegulars(async () => {
  const view = app.game.view.value
  const npc = view.social.here[0]
  assert.ok(npc)
  client.state.me = overview()
  try {
    for (const params of [{ npc: npc.id }, { player: `npc:${npc.id}` }, { player: npc.id }]) {
      const html = await render('/src/app/features/social/PersonApp.vue', { params })
      assert.equal(badges(html), 1, JSON.stringify(params))
      assert.ok(!/Block|Report/.test(text(html)), `${JSON.stringify(params)} offers no Block or Report`)
    }
  } finally { client.state.me = null }
}))
