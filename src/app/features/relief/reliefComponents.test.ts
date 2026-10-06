// "What you can do now" and the ride debt in the wallet: rendered to a string against the real store connected to a fake server.
// What is asserted is what the player reads and can press; the rules are in src/game/relief.test.ts.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LifeState } from '../../../types/life.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import { askFriendText, createDismissals, humanWait, orderedActions, shortReason } from './reliefModel.ts'
import type { ReliefAction } from '../../../types/view.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const render = async (path: string): Promise<string> => { const component = (await load(path)).default; return renderToString(createSSRApp({ render: () => h(component) })) }
/** The life as a visitor in Port Harcourt with `cash`, home in Lagos, for the length of `body`. */
async function visitor(cash: number, body: () => Promise<void>, debt = 0): Promise<void> {
  const before = app.game.state.value, cityBefore = app.game.cityId.value
  const state = structuredCloneState(before)
  state.goals.wishes = []
  Object.assign(state.estate, { city: 'port-harcourt', lga: null, home: 'lagos', plot: null })
  state.cash = cash
  state.needs.hunger = 80
  state.needs.energy = 80
  state.location = 'pleasure-park'
  if (debt) state.travel.rideDebt = debt
  app.game.state.value = state
  app.game.cityId.value = 'port-harcourt'
  try { await body() } finally { app.game.state.value = before; app.game.cityId.value = cityBefore }
}
const structuredCloneState = (state: LifeState): LifeState => JSON.parse(JSON.stringify(state)) as LifeState

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cities = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await Promise.all(['lagos', 'port-harcourt'].map(cities.loadCityContent))
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the card: a small chip in the HUD, the options in a card of their own, the first step first, and nothing for someone who is fine', async () => {
  // Fine, at home: nothing on screen.
  assert.equal(text(await render('/src/app/features/relief/ReliefCard.vue')), '')
  await visitor(2800, async () => {
    const html = await render('/src/app/features/relief/ReliefCard.vue')
    const words = text(html)
    assert.match(html, /<button type="button" class="relief-chip"[^>]*>.*?Short of money — see what you can do/s)
    assert.match(html, /<dialog[^>]*class="relief-sheet"[^>]*aria-label="What you can do now"/)
    assert.ok(words.includes('You have ₦2,800 in Port Harcourt and the cheapest way home to Lagos is ₦12,000'))
    // The odd job first, then the ride on credit, then a friend.
    const order = [...html.matchAll(/data-relief="([a-z-]+)"/g)].map((match) => match[1])
    assert.deepEqual(order, ['odd-job', 'credit-ride', 'friend'])
    assert.ok(words.includes('Paid work, any hour: ₦350 a job.'))
    assert.ok(words.includes('Ride home on credit to Lagos'))
    assert.ok(words.includes('₦12,000 is advanced for the ticket; half of each earning repays it.'), 'the amount and the repayment rule, in one line')
    assert.match(html, /aria-label="Close"/)
    assert.equal((html.match(/class="relief-go"/g) ?? []).length, 3)
  })
  // With the fare in hand and fed, nothing.
  await visitor(20000, async () => { assert.equal(text(await render('/src/app/features/relief/ReliefCard.vue')), '') })
})

test('a sick player who cannot pay the doctor is offered the free clinic, first; one who can pay is not shown the card for it', async () => {
  await visitor(300, async () => {
    app.game.state.value.health.sick = true
    app.game.state.value.health.cause = 'rain'
    const html = await render('/src/app/features/relief/ReliefCard.vue')
    assert.match(text(html), /Sick and short of money — see what you can do/)
    const order = [...html.matchAll(/data-relief="([a-z-]+)"/g)].map((match) => match[1])
    assert.equal(order[0], 'clinic')
    assert.ok(text(html).includes('Queue at the Free Clinic'))
    assert.ok(text(html).includes('Free.'))
  })
  await visitor(30000, async () => {
    app.game.state.value.health.sick = true
    assert.equal(text(await render('/src/app/features/relief/ReliefCard.vue')), '', 'with money for the doctor there is no card')
  })
})

test('time is said the way a person says it, a row that cannot be done has a short reason and no button, and what works now comes first', () => {
  assert.equal(humanWait(20), 'under a minute')
  assert.equal(humanWait(60), '1 min')
  assert.equal(humanWait(61), '2 min')
  assert.equal(humanWait(12 * 60), '12 min')
  assert.equal(humanWait(224 * 60 + 52), '3 h 45 min')
  assert.equal(humanWait(3 * 3600), '3 h')
  assert.equal(humanWait(Number.NaN), 'under a minute')
  assert.equal(shortReason('You did this recently. Odd jobs: carrying and sweeping is available again in 224m 52s.'), 'Again in 3 h 45 min')
  assert.equal(shortReason('You did this recently. Odd jobs is available again in 45s.'), 'Again in under a minute')
  assert.equal(shortReason('You did this recently. Bench is available again in 5m 0s.'), 'Again in 5 min')
  assert.equal(shortReason('Hospital is closed right now. Opens in 2h 3m.'), 'Closed · opens in 2 h 3 min')
  assert.equal(shortReason('Something else entirely.'), 'Something else entirely.')
  const row = (id: ReliefAction['id'], blocked: string | null): ReliefAction => ({ id, label: id, detail: '', blocked, venue: null, here: false, activity: null, spot: null, to: null, mode: null })
  assert.deepEqual(orderedActions([row('odd-job', 'later'), row('credit-ride', null), row('friend', null), row('bench', 'later')]).map((item) => item.id), ['credit-ride', 'friend', 'odd-job', 'bench'])
})

test('a row that cannot be done now shows the reason in minutes and hours and has no button', async () => {
  await visitor(300, async () => {
    const { default: Actions } = await load('/src/app/features/relief/ReliefActions.vue')
    const help = { key: 'k', title: 't', chip: 'c', line: 'l', actions: [
      { id: 'odd-job', label: 'Odd jobs', detail: 'Paid work', blocked: 'You did this recently. Odd jobs is available again in 224m 52s.', venue: 'pleasure-park', here: true, activity: 'relief-odd-jobs', spot: 'x', to: null, mode: null },
      { id: 'friend', label: 'Ask a friend', detail: 'A message is ready for you to send.', blocked: null, venue: null, here: false, activity: null, spot: null, to: null, mode: null },
    ] satisfies ReliefAction[] }
    const html = await renderToString(createSSRApp({ render: () => h(Actions as Component, { help }) }))
    const words = text(html)
    assert.ok(words.includes('Again in 3 h 45 min') && !words.includes('224m'))
    assert.deepEqual([...html.matchAll(/data-relief="([a-z-]+)"/g)].map((match) => match[1]), ['friend', 'odd-job'], 'what works comes first')
    assert.equal((html.match(/class="relief-go"/g) ?? []).length, 1, 'only the row that works has a button')
    assert.match(html, /class="relief-off">Not now</)
  })
})

test('the wallet: what is owed in plain words, a way to pay, and the card opened in place while money is short', async () => {
  await visitor(500, async () => {
    const html = await render('/src/app/features/relief/ReliefLink.vue')
    const words = text(html)
    assert.ok(words.includes('Money is short. There is a way through.'))
    assert.match(html, /aria-expanded="false"[^>]*>What you can do now</)
    assert.ok(!words.includes('You owe'))
  })
  await visitor(500, async () => {
    const words = text(await render('/src/app/features/relief/ReliefLink.vue'))
    assert.ok(words.includes('You owe ₦12,000 for your ride home.'))
    assert.ok(words.includes('Pay what I can'))
  }, 12000)
  // Nothing owed and nothing short: the wallet shows nothing extra.
  await visitor(30000, async () => { assert.equal(text(await render('/src/app/features/relief/ReliefLink.vue')), '') })
})

test('the visitor sheet offers the ride on credit, labelled, below the way home', async () => {
  await visitor(2800, async () => {
    const html = await render('/src/app/features/travel/VisitorHome.vue')
    assert.match(html, /data-visitor="credit".*?<span[^>]*>Ride home on credit · ₦12,000 owed<\/span>/)
    assert.ok(html.indexOf('data-visitor="home"') < html.indexOf('data-visitor="credit"'), 'below the way home')
    assert.ok(text(html).includes('It is advanced and you repay it from your earnings'))
  })
  await visitor(30000, async () => { assert.ok(!text(await render('/src/app/features/travel/VisitorHome.vue')).includes('on credit')) })
})

test('the memory of the card: a dismissed situation stays dismissed on this device, a different one is new', () => {
  const store = new Map<string, string>()
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } }
  const first = createDismissals(storage)
  assert.equal(first.has('home@port-harcourt'), false)
  first.add('home@port-harcourt')
  assert.equal(createDismissals(storage).has('home@port-harcourt'), true, 'remembered by a new page')
  assert.equal(createDismissals(storage).has('home+hunger@port-harcourt'), false, 'another situation is shown')
  first.clear('home@port-harcourt')
  assert.equal(createDismissals(storage).has('home@port-harcourt'), false)
  // A storage that holds rubbish, or none at all, shows the card.
  assert.equal(createDismissals({ getItem: () => '{not json', setItem: () => {} }).has('x'), false)
  assert.equal(createDismissals(null).has('x'), false)
  for (let i = 0; i < 40; i++) first.add(`k${i}`)
  assert.ok(JSON.parse(store.get('jaw-relief-dismissed') ?? '[]').length <= 20, 'a short list')
})

test('ask a friend: a plain sentence with the place, the money and the way home, ready in the message box', () => {
  assert.equal(askFriendText('Port Harcourt', 2800, 'Lagos'), 'Hi! I am stuck in Port Harcourt with ₦2,800. Could you send me a little so I can get home to Lagos? Thank you!')
  assert.ok(!askFriendText('Ibadan', 0, null).includes('get home'))
})

test('the nearest cure: the hospital of the city, its free way always, and the doctor when the cash covers him', async () => {
  const { cureNear } = await load<typeof import('./reliefHelp.ts')>('/src/app/features/relief/reliefHelp.ts')
  await visitor(300, async () => {
    const cure = cureNear(app.game.state.value, 'port-harcourt')
    assert.equal(cure?.venue, 'ph-clinic')
    assert.deepEqual([cure?.free?.def.id, cure?.free?.spot, cure?.paid?.def.id, cure?.paidCost], ['hospital-free', 'ward', 'hospital-doctor', 1500])
  })
})
