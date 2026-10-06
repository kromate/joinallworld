// The visit components rendered to a string against the real social client: what the button says and why it is off, the choice
// of who may come in, the host's Home block (the one-time question, Invite friends over, the link) and the Guests strip.
// Compiled by the project's own Vite configuration, in the manner of the ping and call screens' tests.
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
import type { Friend, HouseView, SocialOverview } from '../../../types/social.ts'
import type { SocialClient } from '../social/socialClient.ts'
import type { VisitHow } from '../../../game/visit.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
const realFetch = globalThis.fetch
let vite: ViteDevServer
let app: App
let client: SocialClient
const ME = { id: '99999999-9999-4999-8999-999999999999', name: 'Me' }
const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada <b>' }
const BOLA = { id: '22222222-2222-4222-8222-222222222222', name: 'Bola' }

const friend = (who: { id: string; name: string }, visit: VisitHow | undefined, where: Partial<Friend> = {}): Friend => ({ ...who, status: 'online', cityId: 'lagos', venue: 'home', since: 1, bae: false, ...(visit ? { visit } : {}), ...where })
const house = (over: Partial<HouseView> = {}): HouseView => ({ host: ME, capacity: 5, guests: [], role: 'host', cityId: null, conv: null, hostStatus: 'home', knocks: [], ...over })
function overview(over: Partial<SocialOverview> = {}): SocialOverview {
  return { ok: true, code: 'ok', me: { ...ME, since: 1 }, friends: [], requests: { in: [], out: [] }, house: house(), visiting: null, invites: [], door: { who: 'walk', out: false, chosen: true }, ...over } as SocialOverview
}
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
async function render(name: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(`/src/app/features/visit/${name}.vue`)).default
  const html = await renderToString(createSSRApp({ render: () => h(component, props) }))
  return html.replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}
const text = (html: string): string => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
const buttons = (html: string): string[] => [...html.matchAll(/<button[^>]*data-visit="([a-z-]+)"[^>]*>/g)].map((match) => `${match[1]}${/\sdisabled/.test(match[0]) ? ':off' : ''}`)

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  await (await load<typeof import('../../../game/cities/registry.ts')>('/src/game/cities/registry.ts')).loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  client = (await load<{ useSocial: () => SocialClient }>('/src/app/features/social/useSocial.ts')).useSocial()
  client.attach(app.api)
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('Visit home: the button on a friend says Visit home, Knock or Come in, and a plain reason when it is off', async () => {
  client.state.me = overview({ friends: [friend(ADA, 'walk'), friend(BOLA, 'knock', { venue: 'park' })], invites: [] })
  let html = await render('VisitButton', { id: ADA.id, name: ADA.name })
  assert.equal(text(html), 'Visit home')
  assert.deepEqual(buttons(html), ['enter'])
  assert.ok(!html.includes('Ada <b>'), 'a name is text')
  // A friend who is online but elsewhere: not home.
  html = await render('VisitButton', { id: BOLA.id, name: BOLA.name })
  assert.equal(text(html), 'Visit home Bola is not home.')
  assert.deepEqual(buttons(html), ['enter:off'])
  // The same friend at home, on knock-first: Knock.
  client.state.me = overview({ friends: [friend(BOLA, 'knock')] })
  assert.equal(text(await render('VisitButton', { id: BOLA.id, name: BOLA.name })), 'Knock')
  // Only invited guests; closed; an invitation turns either into Come in.
  client.state.me = overview({ friends: [friend(BOLA, 'invited')] })
  assert.equal(text(await render('VisitButton', { id: BOLA.id, name: BOLA.name })), 'Visit home Only invited guests.')
  client.state.me = overview({ friends: [friend(BOLA, 'closed')] })
  assert.equal(text(await render('VisitButton', { id: BOLA.id, name: BOLA.name })), 'Visit home Bola is not taking visitors.')
  client.state.me = overview({ friends: [friend(BOLA, 'invited')], invites: [{ from: BOLA, expiresAt: app.game.view.value.now + 60000 }] })
  assert.equal(text(await render('VisitButton', { id: BOLA.id, name: BOLA.name })), 'Come in')
  // The small button of a list row or a chat header shows only when it can be pressed; a stranger gets none.
  client.state.me = overview({ friends: [friend(BOLA, 'invited')] })
  assert.equal(text(await render('VisitButton', { id: BOLA.id, name: BOLA.name, compact: true })), '')
  assert.equal(text(await render('VisitButton', { id: ADA.id, name: ADA.name })), '')
})

test('Who can come into my home: the four choices, the switch for while I am out, and nothing before the overview is here', async () => {
  client.state.me = null
  assert.equal(text(await render('VisitDoor')), '')
  client.state.me = overview({ door: { who: 'knock', out: false, chosen: true } })
  const html = await render('VisitDoor')
  assert.match(text(html), /Who can come into my home Friends walk in .* Friends knock first .* Only people I invite .* Nobody .* Friends can visit while I am out .*home\. Off/)
  assert.match(html, /<input[^>]*value="knock"[^>]*checked/)
  assert.ok(!/<input[^>]*value="walk"[^>]*checked/.test(html))
  assert.match(html, /data-door="out"[^>]*disabled/, 'the switch needs "Friends walk in"')
  client.state.me = overview({ door: { who: 'walk', out: true, chosen: true } })
  const on = await render('VisitDoor')
  assert.match(text(on), /Friends can visit while I am out .*home\. On/)
  assert.ok(!/data-door="out"[^>]*disabled/.test(on))
})

test('the Home block: a player who has not chosen is asked once; the big button, the link and the door controls are there', async () => {
  client.state.me = overview({ door: { who: 'knock', out: false, chosen: false } })
  let html = await render('VisitHome')
  assert.match(text(html), /Let friends walk in\? .* Yes, let them walk in Keep knocking/)
  assert.deepEqual(buttons(html).filter((name) => name.startsWith('ask')), ['ask-yes', 'ask-no'])
  assert.match(text(html), /Invite friends over/)
  assert.match(text(html), /Share a link to my home/)
  assert.match(text(html), /Let anyone with the link in/)
  assert.deepEqual(buttons(html).filter((name) => /^(close|end)/.test(name)), ['close'], 'End visit only when somebody is inside')
  client.state.me = overview({ door: { who: 'walk', out: false, chosen: true }, house: house({ guests: [{ ...BOLA, since: 1, expiresAt: 2 }] }) })
  html = await render('VisitHome')
  assert.ok(!text(html).includes('Let friends walk in?'))
  assert.deepEqual(buttons(html).filter((name) => /^(close|end)/.test(name)), ['close', 'end'])
  client.state.me = overview({ house: house({ closed: true }) })
  assert.match(text(await render('VisitHome')), /Open the door again The door is closed: nobody new comes in\. Your guests stay\./)
})

test('the Guests strip: the host can call, chat and ask to leave; a guest sees who is inside, can add the host, and leave', async () => {
  const guests = [{ ...BOLA, since: 1, expiresAt: 2 }, { ...ADA, since: 1, expiresAt: 2 }]
  client.state.me = overview({ friends: [friend(ADA, 'walk')] })
  let html = await render('GuestsStrip', { house: house({ guests }) })
  assert.match(text(html), /Guests 2\/5 .*Bola Inside Call Chat Add friend Ask to leave/)
  assert.equal(buttons(html).filter((name) => name === 'ask-to-leave').length, 2)
  assert.equal(buttons(html).filter((name) => name === 'add-friend').length, 1, 'only the guest who is not a friend can be added')
  html = await render('GuestsStrip', { house: house({ guests: [], role: 'host' }) })
  assert.match(text(html), /Nobody is inside/)
  // The guest's view: the host's home, the others inside, Leave.
  client.state.me = overview({ me: { ...ME, since: 1 }, friends: [] })
  html = await render('GuestsStrip', { house: house({ host: BOLA, role: 'guest', guests: [{ ...ME, since: 1, expiresAt: 2 }, { ...ADA, since: 1, expiresAt: 2 }] }) })
  assert.match(text(html), /You are visiting Bola’s home\./)
  assert.ok(buttons(html).includes('leave'))
  assert.ok(buttons(html).includes('add-host'), 'a guest who came through a link can add the host as a friend')
  assert.ok(!buttons(html).includes('ask-to-leave'))
  assert.ok(!text(html).includes('Me Inside'), 'the guest is not listed to themselves')
})
