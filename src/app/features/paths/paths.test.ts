// Short addresses in the browser, without a browser: the address bar and History behaviour (address.ts), where each kind of visitor
// is taken (routing.ts), what is kept for a new visitor until they have a life (intent.ts), and the landing's lines.
import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePath } from '../../../paths.ts'
import type { PathIntent } from '../../../paths.ts'
import { createViews } from './address.ts'
import type { Address } from './address.ts'
import { INTENT_KEEP_MS, forgetIntent, keepIntent, markLanding, readIntent, waiting } from './intent.ts'
import { arrive } from './routing.ts'
import type { Env } from './routing.ts'
import { introFor, offersFind } from '../start/pathIntroModel.ts'

const intent = (path: string): PathIntent => { const found = parsePath(path); assert.ok(found, path); return found }

/** A browser history in memory: a list of entries and where we are in it. */
function fakeAddress(start = '/', search = ''): Address & { entries: { path: string; state: string | null }[]; at(): number; go(delta: number): void } {
  const entries: { path: string; state: string | null }[] = [{ path: start, state: null }]
  let at = 0
  return {
    entries, at: () => at,
    go(delta) { at = Math.max(0, Math.min(entries.length - 1, at + delta)) },
    path: () => entries[at]?.path ?? '/', search: () => search, hash: () => '',
    pushed: () => entries[at]?.state === 'pushed',
    push(path) { entries.splice(at + 1); entries.push({ path, state: 'pushed' }); at += 1 },
    replace(url, state) { entries[at] = { path: url.split(/[?#]/)[0] ?? '/', state } },
    back() { at = Math.max(0, at - 1) },
  }
}

interface Calls { opened: [string, unknown][]; layers: [string, unknown][]; accounts: string[] }
function fakeEnv(address: Address, over: { city?: string; games?: () => boolean; map?: () => boolean; venues?: string[] } = {}): { env: Env; calls: Calls } {
  const calls: Calls = { opened: [], layers: [], accounts: [] }
  const views = createViews(address, () => 0)
  const env: Env = {
    views, cityId: () => over.city ?? 'lagos',
    open: (id, params) => { calls.opened.push([id, params]) },
    showMapLayer: (layer, at) => { calls.layers.push([layer, at]) },
    gamesOpen: over.games ?? (() => true), mapOpen: over.map ?? (() => true),
    hasVenue: (_city, venue) => (over.venues ?? []).includes(venue),
    openAccount: async (which) => { calls.accounts.push(which) },
  }
  return { env, calls }
}
const waitFor = (path: string, via: 'landing' | null = null) => ({ intent: intent(path), via, at: Date.now() })

// ---- where a player who has a life is taken -------------------------------------------------------------------------

test('a returning player: /games opens the Games app over wherever they are; /games/oro opens today’s word', async () => {
  const address = fakeAddress('/games')
  const { env, calls } = fakeEnv(address)
  await arrive(env, waitFor('/games'))
  assert.deepEqual(calls.opened, [['games', undefined]])
  const second = fakeEnv(fakeAddress('/games/oro'))
  await arrive(second.env, waitFor('/games/oro'))
  assert.deepEqual(second.calls.opened, [['games', { play: 'oro' }]])
  assert.equal(second.env.views.held(), '/games/oro', 'the address stays while it is open')
})

test('a board game opens a private game against the computer (a Phone table)', async () => {
  for (const [path, table] of [['/games/chess', 'phone-chess'], ['/chess', 'phone-chess'], ['/games/weave', 'phone-weave'], ['/games/whot', 'phone-whot'], ['/games/penalties', 'phone-penalty']] as const) {
    const { env, calls } = fakeEnv(fakeAddress(path))
    await arrive(env, waitFor(path))
    assert.deepEqual(calls.opened, [['tables', { table }]], path)
  }
})

test('a returning player in the city: /kano is the city map', async () => {
  const { env, calls } = fakeEnv(fakeAddress('/kano'), { city: 'kano' })
  await arrive(env, waitFor('/kano'))
  assert.deepEqual(calls.layers, [['city', undefined]])
  assert.deepEqual(calls.opened, [])
  assert.equal(env.views.held(), '/kano')
})

test('a returning player elsewhere: /abuja is the atlas on Abuja’s travel card, and nothing is started', async () => {
  const address = fakeAddress('/abuja')
  const { env, calls } = fakeEnv(address, { city: 'lagos' })
  await arrive(env, waitFor('/abuja'))
  assert.deepEqual(calls.layers, [['world', { level: 2, city: 'abuja' }]])
  assert.deepEqual(calls.opened, [], 'no panel is opened and no trip is started: the card waits for a tap')
  assert.equal(env.views.held(), '/abuja')
  // The alias and the state with one open city land on the same card.
  for (const path of ['/ph', '/fct']) { const next = fakeEnv(fakeAddress(path)); await arrive(next.env, waitFor(path)); assert.equal((next.calls.layers[0]?.[1] as { city: string }).city, path === '/ph' ? 'port-harcourt' : 'abuja') }
})

test('/<city>/games: the Games app in that city, the travel card elsewhere; /<city>/<venue>: that venue when it exists', async () => {
  const here = fakeEnv(fakeAddress('/lagos/games'), { city: 'lagos' })
  await arrive(here.env, waitFor('/lagos/games'))
  assert.deepEqual(here.calls.opened, [['games', undefined]])
  const away = fakeEnv(fakeAddress('/kano/games'), { city: 'lagos' })
  await arrive(away.env, waitFor('/kano/games'))
  assert.deepEqual([away.calls.opened, away.calls.layers], [[], [['world', { level: 2, city: 'kano' }]]])
  const venue = fakeEnv(fakeAddress('/lagos/market'), { city: 'lagos', venues: ['market'] })
  await arrive(venue.env, waitFor('/lagos/market'))
  assert.deepEqual(venue.calls.opened, [['map', { destination: 'market' }]])
  const none = fakeEnv(fakeAddress('/lagos/no-such'), { city: 'lagos', venues: ['market'] })
  await arrive(none.env, waitFor('/lagos/no-such'))
  assert.deepEqual([none.calls.opened, none.calls.layers], [[], [['city', undefined]]], 'a venue that is not there is the city')
})

test('a state and the atlas levels', async () => {
  const state = fakeEnv(fakeAddress('/ogun'))
  await arrive(state.env, waitFor('/ogun'))
  assert.deepEqual(state.calls.layers, [['world', { level: 2, state: 'ogun' }]])
  const soon = fakeEnv(fakeAddress('/kaduna'))
  await arrive(soon.env, waitFor('/kaduna'))
  assert.deepEqual(soon.calls.layers, [['world', { level: 2, state: 'kaduna' }]])
  const levels: [string, number][] = [['/nigeria', 2], ['/world', 0], ['/map', 0]]
  for (const [path, level] of levels) { const next = fakeEnv(fakeAddress(path)); await arrive(next.env, waitFor(path)); assert.deepEqual(next.calls.layers, [['world', { level }]], path) }
})

test('the panels open the panels that exist', async () => {
  const wanted: [string, string][] = [['/messages', 'messages'], ['/friends', 'people'], ['/invite', 'invite'], ['/business', 'business'], ['/jobs', 'jobs'], ['/help', 'help'], ['/sound', 'settings']]
  for (const [path, panel] of wanted) { const { env, calls } = fakeEnv(fakeAddress('/')); await arrive(env, waitFor(path)); assert.deepEqual(calls.opened, [[panel, undefined]], path); assert.equal(env.views.held(), null, 'an action keeps no address') }
  const { env, calls } = fakeEnv(fakeAddress('/'))
  await arrive(env, waitFor('/signup')); await arrive(env, waitFor('/login'))
  assert.deepEqual(calls.accounts, ['signup', 'login'])
})

test('a life the landing started in the city is shown the scene, not a map; the intent is spent', async () => {
  const address = fakeAddress('/abuja')
  const { env, calls } = fakeEnv(address, { city: 'abuja' })
  keepIntent(intent('/abuja'), 'landing')
  const found = readIntent()
  assert.equal(found?.via, 'landing')
  await arrive(env, found)
  assert.deepEqual([calls.opened, calls.layers], [[], []])
  assert.equal(address.path(), '/', 'the address is tidied')
  assert.equal(readIntent(), null, 'carried out: nothing is left waiting')
})

// ---- the address bar ------------------------------------------------------------------------------------------------

test('a view the page was loaded on replaces the entry; leaving it puts / back without leaving the site', async () => {
  const address = fakeAddress('/games')
  const { env } = fakeEnv(address)
  let open = true
  env.views.hold('/games', () => open, 'replace')
  env.views.watch(true)
  assert.equal(address.entries.length, 1, 'no new entry')
  open = false
  env.views.watch(false)
  assert.deepEqual([address.path(), address.entries.length, env.views.held()], ['/', 1, null])
})

test('a view opened inside the game pushes an entry; closing it pops it; Back closes the view instead of leaving the site', () => {
  const address = fakeAddress('/')
  const views = createViews(address, () => 0)
  let open = true
  views.hold('/games', () => open, 'push')
  assert.deepEqual([address.path(), address.entries.length, address.at()], ['/games', 2, 1])
  // The player closes it in the app: the entry is popped, not stacked.
  open = false
  views.watch(true); views.watch(false)
  assert.deepEqual([address.path(), address.at()], ['/', 0])
  // Opened again, then the browser's Back button: the view is dropped (the host closes the app) and the address is already /.
  views.hold('/games', () => true, 'push')
  address.go(-1)
  assert.equal(views.drop(), true)
  assert.deepEqual([address.path(), views.held()], ['/', null])
  assert.equal(views.drop(), false)
  // Forward lands on /games again.
  address.go(1)
  assert.equal(address.path(), '/games')
})

test('the view never leaves an address it is no longer on, and a view that never opened does not keep its address', () => {
  const address = fakeAddress('/')
  const scheduled: (() => void)[] = []
  const views = createViews(address, (run) => { scheduled.push(run) })
  views.hold('/abuja', () => false, 'replace')
  assert.equal(address.path(), '/abuja')
  for (const run of scheduled) run()
  assert.equal(address.path(), '/', 'a gated panel never opened: the address goes back')
  const other = fakeAddress('/')
  const second = createViews(other, () => 0)
  second.hold('/games', () => true, 'replace')
  other.replace('/elsewhere', null)
  second.watch(true); second.watch(false)
  assert.equal(other.path(), '/elsewhere', 'an address that is not the view’s own is left alone')
})

test('the search of the address survives being shown under its canonical path', () => {
  const entries: string[] = []
  const address: Address = { path: () => '/Abuja', search: () => '?venue=park', hash: () => '', pushed: () => false, push: () => {}, replace: (url) => { entries.push(url) }, back: () => {} }
  createViews(address, () => 0).show('/abuja', 'replace')
  assert.deepEqual(entries, ['/abuja?venue=park'])
})

// ---- what a new visitor keeps until they have a life ------------------------------------------------------------------

test('the intent is kept for 30 minutes and survives everything in between', () => {
  forgetIntent()
  assert.equal(readIntent(), null)
  const t0 = 1_000_000
  keepIntent(intent('/games/oro'), null, t0)
  assert.equal(waiting.value?.kind, 'games')
  // Choosing a look, signing up, a reload: nothing touches it.
  assert.equal(readIntent(t0 + 29 * 60 * 1000)?.intent.kind, 'games')
  // The landing's own start marks it; the clock is not extended.
  markLanding(t0 + 60 * 1000)
  assert.equal(readIntent(t0 + 2 * 60 * 1000)?.via, 'landing')
  assert.equal(readIntent(t0 + INTENT_KEEP_MS - 1)?.via, 'landing')
  assert.equal(readIntent(t0 + INTENT_KEEP_MS), null, 'after 30 minutes it is gone')
  assert.equal(readIntent(t0 + 1), null, 'and stays gone')
  // A newer address replaces an older one.
  keepIntent(intent('/abuja'))
  keepIntent(intent('/kano'))
  assert.deepEqual(readIntent()?.intent, intent('/kano'))
  forgetIntent()
  assert.equal(waiting.value, null)
})

test('what is kept is a path from the table: anything else is dropped', () => {
  forgetIntent()
  const store = new Map<string, string>()
  Object.assign(globalThis, { sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } } })
  try {
    keepIntent(intent('/abuja'))
    assert.deepEqual(JSON.parse(store.get('allworld-path') ?? '{}').path, '/abuja')
    assert.deepEqual(Object.keys(JSON.parse(store.get('allworld-path') ?? '{}')).sort(), ['at', 'path'], 'a path and a time: no position, no name')
    forgetIntent()
    store.set('allworld-path', JSON.stringify({ path: '/api/anything', at: Date.now() }))
    assert.equal(readIntent(), null)
    store.set('allworld-path', 'not json')
    assert.equal(readIntent(), null)
  } finally { Reflect.deleteProperty(globalThis, 'sessionStorage'); forgetIntent() }
})

// ---- the landing's lines -----------------------------------------------------------------------------------------------

test('the landing says the right thing for each address, and offers "Find my city" only at / and /games', () => {
  assert.equal(introFor(null), null)
  const hub = introFor(intent('/games'))
  assert.deepEqual([hub?.strong, hub?.button, hub?.action, hub?.city], ['Play chess, today’s word and more — free in your browser.', 'Play now', 'start', null])
  assert.equal(introFor(intent('/games/oro'))?.button, 'Play today’s word')
  const abuja = introFor(intent('/abuja'))
  assert.deepEqual([abuja?.strong, abuja?.button, abuja?.city], ['Live in Abuja.', 'Start in Abuja', 'abuja'])
  assert.ok((abuja?.text ?? '').length > 20, 'a line from the city')
  assert.equal(introFor(intent('/fct'))?.city, 'abuja')
  assert.equal(introFor(intent('/ogun')), null, 'a state has no one place to start in')
  assert.equal(introFor(intent('/signup'))?.action, 'signup')
  assert.equal(introFor(intent('/login'))?.action, 'login')
  assert.equal(offersFind(null), true)
  assert.equal(offersFind(intent('/games')), true)
  assert.equal(offersFind(intent('/games/chess')), false)
  assert.equal(offersFind(intent('/abuja')), false)
})
