// Component tests for the growth screens, the way src/app/components.test.ts does them: each
// single-file component is compiled by the project's own Vite configuration and rendered to a
// string against the real store and a fake server that runs the real rules. The growth answers
// (the hello, a prepared share) are put into the shared growth store, so what is asserted is the
// markup: words, roles, labels, links, disabled controls and their reasons.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { SocialOverview } from '../../../types/social.ts'
import type { Digest, ReferralView } from '../../../types/growth.ts'
import type { App } from '../../state/app.ts'
import type { SocialState as SocialClientState } from '../social/useSocial.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import type { Growth } from './growthStore.ts'
import type { HelloOk } from './growthModel.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let growth: Growth
let social: SocialClientState
const realFetch = globalThis.fetch

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
async function render(name: string): Promise<string> {
  const component = (await load(`/src/app/features/growth/${name}.vue`)).default
  return (await renderToString(createSSRApp({ render: () => h(component, {}) }))).replace(/<!--.*?-->/g, '')
}

const digest = { subject: 'Your week', greeting: 'Hi Kunle', lines: ['Ada is playing'], more: 2, tasks: [{ text: 'Open Missions', app: 'missions' }], footer: 'Stop any time.', caps: {} } as unknown as Digest
const referral = (over: Partial<ReferralView> = {}): ReferralView => ({
  by: null, invited: [], counted: 0, waiting: 0, owed: 0, title: null, nextTitle: null, paid: null,
  rules: { welcome: 500, reward: 2000, stars: 5, perWeek: 3, lifetime: 20, workDays: 2, linkWithinDays: 7 }, ...over,
})
const hello = (over: Partial<HelloOk> = {}): HelloOk => ({
  ok: true, channel: '', contact: { channel: '', email: null, push: { devices: 0 }, live: { email: false } }, away: { hours: 5, since: 111 },
  referral: referral(), consent: null, events: [], digest, sharesLeft: 3, ...over,
}) as unknown as HelloOk

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  growth = (await load<{ useGrowth: () => Growth }>('/src/app/features/growth/useGrowth.ts')).useGrowth()
  social = (await load<{ social: SocialClientState }>('/src/app/features/social/useSocial.ts')).social
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('Missions: today, the weekly set, progress bars with their labels and the stamp card', async () => {
  const m = app.game.view.value.missions
  const html = await render('MissionsApp')
  const words = text(html)
  if (m.locked) { assert.ok(words.includes('Settle in first') && words.includes(m.locked)); return }
  assert.ok(words.includes(`${m.dailySet.done} of ${m.dailySet.total} missions done`), words.slice(0, 120))
  for (const mission of [...m.daily, ...m.weekly]) assert.ok(words.includes(mission.label), mission.label)
  assert.match(html, /<ul[^>]*aria-label="Today’s missions"/)
  assert.match(html, /<ul[^>]*aria-label="This week’s missions"/)
  assert.ok(words.includes(`${m.stamps.days} of 7 days played`) && words.includes('Share my week'))
  for (const mission of [...m.daily, ...m.weekly].filter((item) => item.count > 1 || item.done)) assert.match(html, new RegExp(`role="progressbar"[^>]*aria-valuemax="${mission.count}"[^>]*aria-valuenow="${mission.n}"[^>]*aria-label="${mission.label}"`))
  assert.ok(words.includes('How it works'))
  assert.ok(!/<button[^>]*disabled[^>]*>\s*Share my week/.test(html), 'nothing is being prepared')
  growth.state.busy = 'week'
  try {
    const busy = await render('MissionsApp')
    assert.match(busy, /<button[^>]*disabled[^>]*>Preparing…<\/button>/, 'the pressed share says so and cannot be pressed twice')
  } finally { growth.state.busy = null }
})

test('Events: what is on or coming up, and the channel link only when it is https', async () => {
  growth.state.hello = hello({ channel: 'https://whatsapp.com/channel/abcdefghij' } as Partial<HelloOk>)
  const html = await render('EventsApp')
  const words = text(html)
  assert.ok(words.includes('Nothing is on right now') || /On now/.test(words))
  assert.match(html, /<a[^>]*class="link-button[^"]*"[^>]*href="https:\/\/whatsapp\.com\/channel\/abcdefghij"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>Follow Allworld on WhatsApp<\/a>/)
  assert.ok(words.includes('The owner posts what is on tonight there'))
  growth.state.hello = hello({ channel: 'javascript:alert(1)' } as Partial<HelloOk>)
  const unsafe = await render('EventsApp')
  assert.ok(!unsafe.includes('javascript:') && !/Follow Allworld on WhatsApp/.test(unsafe), 'a link that is not https is never drawn')
  assert.match(text(unsafe), /\d+ events? attended so far|1 event attended so far/)
  growth.state.hello = null
})

test('Bring a friend: loading, then the link, the friends and what each is owed; names are text', async () => {
  growth.state.hello = null; growth.state.error = null
  assert.equal(text(await render('ReferApp')), 'Loading your invites…')
  growth.state.error = 'Not ready yet.'
  assert.equal(text(await render('ReferApp')), 'Not ready yet.')
  growth.state.error = null
  growth.state.hello = hello({ referral: referral({ counted: 1, title: 'Connector', invited: [{ id: 'f1', name: 'Ada <b>bold</b>', state: 'counted', at: 1 }, { id: 'f2', name: 'Tunde', state: 'joined', at: 2 }], by: { id: 'p1', name: 'Bola', welcomed: false, counted: false } }) })
  const html = await render('ReferApp')
  const words = text(html)
  assert.ok(words.startsWith('Bring a friend 1 friend playing because of you Your title: Connector.'), words.slice(0, 120))
  assert.ok(html.includes('Ada &lt;b&gt;bold&lt;/b&gt;') && !html.includes('<b>bold</b>'))
  assert.ok(words.includes('Playing · counted') && words.includes('Made a Sim · has not worked two days yet') && words.includes('Counted'))
  assert.ok(words.includes('You came through Bola’s link') && words.includes('Go to their door'))
  assert.ok(words.includes('Share my invite link') && words.includes('Invite someone to my house'))
  assert.match(html, /<ul[^>]*aria-label="Friends who came through your link"/)
  growth.state.busy = 'invite'
  try {
    const busy = await render('ReferApp')
    assert.match(busy, /<button[^>]*disabled[^>]*>Preparing…<\/button>/)
    assert.match(busy, /<button[^>]*disabled[^>]*>Invite someone to my house<\/button>/, 'one share at a time')
  } finally { growth.state.busy = null; growth.state.hello = null }
})

test('Stay in touch: the age question first; under 18 is offered nothing; adults get the e-mail form with the reason it is not ready', async () => {
  growth.state.hello = hello({ consent: null })
  let html = await render('TouchApp')
  assert.ok(text(html).includes('First, how old are you?') && text(html).includes('I am 18 or older') && text(html).includes('I am under 18'))
  assert.ok(!html.includes('type="email"'), 'no channel before the age is known')
  growth.state.hello = hello({ consent: { age: 'minor', push: false, email: false, at: 1 } })
  html = await render('TouchApp')
  assert.ok(text(html).includes('You are all set') && !html.includes('type="email"') && !text(html).includes('Tell me more'))
  growth.state.hello = hello({ consent: { age: 'adult', push: false, email: false, at: 1 } })
  html = await render('TouchApp')
  assert.ok(text(html).includes('Notifications on this phone') && text(html).includes('Tell me more'))
  assert.match(html, /<label[^>]*class="gr-field[^"]*"[^>]*>Your e-mail address\s*<input[^>]*type="email"[^>]*inputmode="email"[^>]*autocomplete="email"[^>]*maxlength="254"/)
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled[^>]*title="Enter your e-mail address first\."/, 'the disabled button says why')
  assert.ok(text(html).includes('Enter your e-mail address first.'), 'and so does the text beside it')
  assert.ok(text(html).includes('Send me Allworld e-mails at this address'), 'the consent words are shown in full')
  assert.ok(text(html).includes('What a weekly message says') && text(html).includes('Your week') && text(html).includes('Ada is playing') && text(html).includes('and 2 more') && text(html).includes('Open Missions'))
  growth.state.hello = null
})

test('Stay in touch: a confirmed address is shown masked, a message preview is text, and WhatsApp is an ordinary link', async () => {
  growth.state.hello = hello({
    consent: { age: 'adult', push: true, email: true, at: 1 }, channel: 'https://whatsapp.com/channel/abcdefghij',
    contact: { channel: '', email: { address: 'k***@example.com', confirmed: true, preview: { kind: 'digest', subject: 'Hello <i>there</i>', text: 'Line one\nLine two' } }, push: { devices: 2 }, live: { email: true } },
  } as Partial<HelloOk>)
  const html = await render('TouchApp')
  const words = text(html)
  assert.ok(words.includes('Notifications are on') && words.includes('2 phones or browsers.') && words.includes('Switch off'))
  assert.ok(words.includes('E-mail is on') && words.includes('k***@example.com · confirmed') && words.includes('Delete my address'))
  assert.ok(html.includes('Hello &lt;i&gt;there&lt;/i&gt;') && !html.includes('<i>there</i>'))
  assert.match(html, /<a[^>]*href="https:\/\/whatsapp\.com\/channel\/abcdefghij"[^>]*rel="noopener noreferrer"[^>]*>Follow Allworld on WhatsApp<\/a>/)
  growth.state.hello = null
})

test('Share sheet: nothing yet, then the picture, the text as text, and the links that leave the game', async () => {
  growth.state.sharing = null
  assert.equal(text(await render('ShareSheet')), 'Nothing to share yet.')
  growth.state.sharing = { facts: {} as never, prepared: { text: 'Join me <script>x</script>\nhttps://allworld.example/s/abc', link: 'https://allworld.example/s/abc', file: null, url: 'blob:http://x/1', whatsapp: 'https://wa.me/?text=Join', x: 'https://x.com/intent/post?text=Join' } }
  try {
    const html = await render('ShareSheet')
    assert.match(html, /<img[^>]*src="blob:http:\/\/x\/1"[^>]*alt="Your Allworld card"[^>]*width="320"[^>]*height="320"/)
    assert.ok(html.includes('Join me &lt;script&gt;x&lt;/script&gt;') && !html.includes('<script>'))
    assert.match(html, /<a[^>]*href="https:\/\/wa\.me\/\?text=Join"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>WhatsApp<\/a>/)
    assert.match(html, /<a[^>]*href="https:\/\/x\.com\/intent\/post\?text=Join"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>X<\/a>/)
    assert.match(html, /<a[^>]*href="blob:http:\/\/x\/1"[^>]*download="allworld\.jpg"[^>]*>Save picture<\/a>/)
    const words = text(html)
    assert.ok(words.includes('Share…') && words.includes('Copy text') && words.includes('Sharing pays nothing'))
    growth.state.sharing = { ...growth.state.sharing, prepared: { ...growth.state.sharing.prepared, url: null } }
    const bare = await render('ShareSheet')
    assert.ok(!bare.includes('<img') && !bare.includes('Save picture'), 'without a picture there is no image and no download')
  } finally { growth.state.sharing = null }
})

test('Away card: shown for a returning player, each line opens its app, the X is labelled; nothing when dismissed', async () => {
  const me = server.session()?.id ?? 'me'
  const ada = { id: 'ada', name: 'Ada <b>x</b>' }
  social.me = {
    ok: true, code: 'ok', me: { id: me, name: 'Kunle', since: 1 }, friends: [], bae: null, blocked: [], reports: [], invitePath: '/v/me', visiting: null,
    requests: { in: [], out: [] }, baeRequests: [],
    conversations: [{ id: 'dm.ada.me', kind: 'dm', name: ada.name, members: [{ id: me, name: 'Kunle' }, ada], owner: null, with: 'ada', unread: 1, last: { seq: 1, from: ada, body: 'Come', at: server.now() } }],
    updates: [], house: { host: { id: me, name: 'Kunle' }, capacity: 4, guests: [], role: 'host', cityId: null, conv: null, hostStatus: 'home', knocks: [] },
    limits: { body: 500, groupSize: 8, groupName: 30, guests: 4, reportText: 300, reasons: ['spam'] },
  } as unknown as SocialOverview
  app.shell.bump()
  growth.state.hello = hello({ away: { hours: 5, since: Date.now() } })
  try {
    const html = await render('AwayChip')
    assert.match(html, /<section[^>]*class="gr-away is-active"[^>]*aria-label="While you were away"/)
    assert.match(html, /<button[^>]*class="gr-x"[^>]*aria-label="Dismiss"[^>]*>×<\/button>/)
    assert.ok(html.includes('Ada &lt;b&gt;x&lt;/b&gt;: Come') && !html.includes('<b>x</b>'))
    assert.ok(text(html).includes('Nothing was taken from you.'))
    growth.state.hello = null
    assert.match(await render('AwayChip'), /<span data-away-idle hidden/)
  } finally { growth.state.hello = null; social.me = null }
})

test('Inbox chip: Messages with what is waiting, and a knock at the door as its own line', async () => {
  const me = server.session()?.id ?? 'me'
  const overview = (knocks: { from: { id: string; name: string } }[]) => ({
    me: { id: me, name: 'Kunle', since: 1 }, requests: { in: [], out: [] }, baeRequests: [], updates: [],
    conversations: [{ id: 'c', kind: 'dm', name: 'Ada', members: [], owner: null, with: 'ada', unread: 2, last: null }],
    house: { host: { id: me, name: 'Kunle' }, capacity: 4, guests: [], role: 'host', cityId: null, conv: null, hostStatus: 'home', knocks },
  }) as unknown as SocialOverview
  try {
    social.me = overview([])
    app.shell.bump()
    let html = await render('InboxChip')
    assert.match(html, /<button[^>]*class="life-job is-active"[^>]*>.*<strong>Messages<\/strong><small>2 unread<\/small>/)
    social.me = overview([{ from: { id: 'ada', name: 'Ada' } }])
    app.shell.bump()
    html = await render('InboxChip')
    assert.ok(text(html).includes('Ada is knocking') && text(html).includes('Let them in or not now'))
  } finally { social.me = null }
})
