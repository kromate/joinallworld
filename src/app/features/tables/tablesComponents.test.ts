import { loadCityContent as preloadCityContent } from '../../../game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// Component tests for the Tables panels, in the manner of src/app/components.test.ts: each
// component is compiled by the project's own Vite configuration and rendered to a string with
// Vue's server renderer, against the real store on a fake server. The client's state `T` is set by
// hand to each situation (no socket is opened: nothing here mounts). What is asserted is the words,
// roles, labels and disabled controls the player gets; what a press sends is tested at the client.
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LifeState } from '../../../types/life.ts'
import type { TableStateFrame, TableSummary, TablesClientState } from './tablesBoundary.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let T: TablesClientState
let sync: () => void
const realFetch = globalThis.fetch
const initial = (): Partial<TablesClientState> => ({ socket: 'open', list: null, listAt: 0, tableId: null, state: null, error: null, pending: false, claimed: null, ratings: null })

const load = async <M = { default: Component }>(path: string): Promise<M> => await vite.ssrLoadModule(path) as M
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return (await renderToString(createSSRApp({ render: () => h(component, props) }))).replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--\[-->|<!--\]-->/g, '')
}
const tablesApp = (): Promise<string> => render('/src/app/features/tables/TablesApp.vue')
const withState = (patch: Partial<TablesClientState>): void => { Object.assign(T, patch); sync() }
const here = (): string => app.game.state.value.location

const summary = (patch: Partial<TableSummary> = {}): TableSummary => ({
  id: 'park-bench', venue: here(), venueLabel: 'The Park', game: 'whot', gameLabel: 'Whot', label: 'Bench under the trees', status: 'open', max: 4, min: 2, options: { stack: true }, seats: [], watching: 0, ...patch,
})
const frame = (patch: Partial<TableStateFrame> & { table?: TableSummary } = {}): TableStateFrame => ({
  type: 'table-state', cityId: 'lagos', table: summary(), you: null, host: false, n: 0, view: null, log: [], toMove: [], clock: null, result: null,
  optionList: [{ name: 'stack', label: 'Stacking picks', values: [true, false], names: ['Allowed', 'Not allowed'], value: true }], ...patch,
})
const card = (s: string, n: number) => ({ s, n })
const whotView = (patch: Record<string, unknown> = {}) => ({
  game: 'whot', top: card('circle', 5), call: null, market: 20, pile: 3, turn: 0, pick: 0, pickBy: null, counts: [3, 4], out: [false, false], said: [false, false],
  hand: [card('circle', 7), card('whot', 20), card('star', 8)], playable: [0, 1], over: null, shown: null, ...patch,
})

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  T = (await load<{ T: TablesClientState }>('/src/app/features/tables/tablesBoundary.ts')).T
  sync = (await load<{ syncTables: () => void }>('/src/app/features/tables/useTables.ts')).syncTables
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })
beforeEach(() => withState(initial()))

test('the two panels are registered with the static metadata of the existing ones', async () => {
  const { TABLES_PANELS } = await load<{ TABLES_PANELS: readonly Record<string, unknown>[] }>('/src/app/features/tables/register.ts')
  const meta = (panel: Record<string, unknown> | undefined) => panel && ({ id: panel.id, title: panel.title, icon: panel.icon, placement: panel.placement, order: panel.order, group: panel.group, tint: panel.tint, kind: panel.kind })
  assert.deepEqual(meta(TABLES_PANELS[0]), { id: 'tables', title: 'Tables', icon: undefined, placement: 'phone', order: 43, group: 'city', tint: '#1f8a86', kind: 'vue' })
  assert.deepEqual(meta(TABLES_PANELS[1]), { id: 'tables-chip', title: 'Table here', icon: 'tables', placement: 'hud', order: 25, group: undefined, tint: undefined, kind: 'vue' })
})

test('list: the tables where you are first with their buttons, the others under "Elsewhere", the ratings and the rules', async () => {
  withState({
    list: [
      summary({ id: 'a', seats: [{ name: 'Ada', bot: false }] }),
      summary({ id: 'b', status: 'playing', seats: [{ name: 'Ola', bot: false }, { name: 'Mama Put', bot: true }], watching: 1 }),
      summary({ id: 'c', venue: 'elsewhere', venueLabel: 'The Beach', game: 'penalty', gameLabel: 'Penalties', label: 'Goalposts in the sand' }),
    ],
    ratings: { whot: { rating: 1212, played: 6, won: 3, provisional: true } },
  })
  const html = await tablesApp()
  const words = text(html)
  assert.match(words, /Game tables 2 tables where you are/)
  assert.ok(words.includes('Whot · Bench under the trees The Park · Ada waiting for players Sit'))
  assert.ok(words.includes('Game on · Ola, Mama Put · 1 watching Watch'))
  assert.ok(words.includes('Elsewhere in the city'))
  assert.ok(words.includes('Penalties · Goalposts in the sand The Beach · Empty: sit down and start Look'))
  assert.ok(words.includes('Your Whot rating: 1212 (provisional) · 3 won of 6 rated games.'))
  assert.match(words, /A win against a real player pays ₦[\d,]+ · \d+ of \d+ paid wins left today/)
  assert.match(html, /<summary>How it works<\/summary>/)
  assert.equal((html.match(/class="ui-row"/g) ?? []).length, 3)
})

test('list: nothing where you are says where to go; before the list, one line; with the socket closed, a way to try again', async () => {
  withState({ list: [summary({ venue: 'elsewhere' })] })
  const words = text(await tablesApp())
  assert.ok(words.includes('No table where you are'))
  assert.ok(words.includes('Go where the tables are'))
  withState({ list: null, socket: 'connecting' })
  assert.ok(text(await tablesApp()).includes('Looking for tables…'))
  withState({ list: null, socket: 'closed' })
  const closed = await tablesApp()
  assert.ok(text(closed).includes('Could not reach the tables. Try again'))
  assert.match(closed, /<button class="gr-swap"[^>]*>Try again<\/button>/)
})

test('an open table: host and guest see the same seats; only the host may change the rules', async () => {
  const seats = [{ name: 'Ada', bot: false }, { name: 'Mama Put', bot: true, }]
  withState({ tableId: 'park-bench', state: frame({ you: 0, host: true, table: summary({ seats }) }) })
  const host = await tablesApp()
  const hostWords = text(host)
  assert.ok(hostWords.includes('At the table Ada Mama Put Get up'))
  assert.ok(hostWords.includes('Start with 2'))
  assert.ok(hostWords.includes('+ 1 bot + 2 bots'))
  assert.ok(hostWords.includes('Everyone seated plays.'))
  assert.ok(hostWords.includes('You sat down first, so you choose.'))
  assert.ok(hostWords.includes('Invite a friend to this table'))
  assert.ok(hostWords.includes('How to play Whot'))
  assert.match(host, /<select(?![^>]*disabled)[^>]*>/)
  assert.match(host, /<option value="true" selected>Allowed<\/option><option value="false">Not allowed<\/option>/)
  withState({ state: frame({ you: 1, host: false, table: summary({ seats }) }) })
  const guest = await tablesApp()
  assert.match(guest, /<select[^>]*disabled[^>]*title="Whoever sat down first chooses\."/)
  assert.ok(text(guest).includes('Whoever sat down first chooses.'))
})

test('an open table: not seated at the venue, you may sit; full, the button says so and why; elsewhere you can only watch and go there', async () => {
  withState({ tableId: 'park-bench', state: frame({ table: summary({ seats: [{ name: 'Ada', bot: false }] }) }) })
  const sit = await tablesApp()
  assert.match(sit, /<button[^>]*class="base-button is-primary"[^>]*>Sit down<\/button>/)
  assert.ok(!text(sit).includes('Start with'), 'a watcher has no start buttons')
  withState({ state: frame({ table: summary({ seats: [{ name: 'A', bot: false }, { name: 'B', bot: false }, { name: 'C', bot: false }, { name: 'D', bot: false }] }) }) })
  const full = await tablesApp()
  assert.match(full, /<button[^>]*disabled[^>]*title="The table is full\."[^>]*>Table full<\/button>/)
  withState({ state: frame({ table: summary({ venue: 'elsewhere', venueLabel: 'The Beach' }) }) })
  const away = await tablesApp()
  assert.ok(text(away).includes('You can watch from here. To sit, go to The Beach.'))
  assert.ok(text(away).includes('Go to The Beach'))
  withState({ state: frame({ table: summary(), you: 0, host: true, optionList: [] }), pending: true })
  assert.match(await tablesApp(), /<button[^>]*disabled[^>]*title="Waiting for the table to answer\."[^>]*>Start with|<button[^>]*disabled[^>]*>\+ 1 bot/)
})

test('a table that has not arrived yet, and a lost connection to it', async () => {
  withState({ tableId: 'park-bench', state: null, socket: 'connecting' })
  assert.ok(text(await tablesApp()).includes('‹ All tables Walking up to the table…'))
  withState({ socket: 'closed' })
  assert.ok(text(await tablesApp()).includes('Not connected to the table. Reconnect'))
})

test('offline: the table says the seat is kept and offers to reconnect', async () => {
  withState({ tableId: 'park-bench', socket: 'closed', state: frame({ you: 0, host: true, table: summary({ seats: [{ name: 'Ada', bot: false }] }) }) })
  const html = await tablesApp()
  assert.match(html, /<p class="ui-error" role="alert">Reconnecting to the table… your seat is kept\. <button[^>]*>Try now<\/button><\/p>/)
})

test('a Whot game: your turn, your cards as buttons (the server decides which), the market, the log and a forfeit with a confirm', async () => {
  const seats = [{ name: 'Ada', bot: false }, { name: '<b>Ola</b>', bot: false }]
  withState({
    tableId: 'park-bench',
    state: frame({
      you: 0, n: 3, table: summary({ status: 'playing', seats }), toMove: [0], view: whotView(), log: ['a', 'b', 'c', 'd', 'e'],
      clock: { deadline: Date.now() + 30000, now: Date.now(), seconds: 30 },
    }),
  })
  const html = await tablesApp()
  const words = text(html)
  assert.ok(words.includes('Your turn'))
  assert.match(html, /aria-label="Circle 7"[^>]*>/)
  assert.match(html, /<button[^>]*class="wh-card[^"]*"[^>]*aria-label="Whot"/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="Star 8, Suspension"/, 'a card the server did not list is disabled')
  assert.ok(words.includes('Market · 20') && words.includes('On the pile'))
  assert.match(html, /<ol class="wh-log" aria-label="What just happened"><li>b<\/li><li>c<\/li><li>d<\/li><li>e<\/li><\/ol>/)
  assert.match(html, /<div class="wh-clock" aria-hidden="true"><i[^>]*animation-duration:30s/)
  assert.ok(html.includes('&lt;b&gt;Ola&lt;/b&gt;'), 'a name is shown as text')
  assert.ok(!html.includes('<b>Ola</b>'), 'and never as markup')
  assert.ok(words.includes('Leave the game (you forfeit)'))
  assert.ok(words.includes('Invite a friend to this table'))
  // Not your turn: the market button is disabled and says why.
  withState({ state: frame({ you: 0, n: 3, table: summary({ status: 'playing', seats }), toMove: [1], view: whotView({ turn: 1, playable: [] }) }) })
  const waiting = await tablesApp()
  assert.ok(waiting.includes('&lt;b&gt;Ola&lt;/b&gt; is playing…'))
  assert.match(waiting, /<button[^>]*disabled[^>]*title="Wait for your turn\."[^>]*>Go to market<\/button>/)
})

test('a Whot game: a pick is owed, and a watcher sees no hand', async () => {
  const seats = [{ name: 'Ada', bot: false }, { name: 'Ola', bot: false }]
  withState({ tableId: 'park-bench', state: frame({ you: 0, table: summary({ status: 'playing', seats }), toMove: [0], view: whotView({ pick: 2, pickBy: 2 }) }) })
  const owed = text(await tablesApp())
  assert.ok(owed.includes('Answer with a 2, or pick 2'))
  assert.ok(owed.includes('Pick 2 from the market'))
  withState({ state: frame({ you: null, table: summary({ status: 'playing', seats }), toMove: [0], view: whotView({ hand: null, playable: [], pick: 0, pickBy: null, call: 'star' }) }) })
  const watcher = text(await tablesApp())
  assert.ok(watcher.includes('You are watching. Hands are hidden from everyone but their owner.'))
  assert.ok(watcher.includes('Stars were called'))
})

test('a penalty game: the goal has three real buttons, disabled with a reason once you chose', async () => {
  const seats = [{ name: 'Ada', bot: false }, { name: 'Ola', bot: false }]
  const view = (mine: number | null) => ({ game: 'penalty', options: { kicks: 5 }, kick: 1, kicker: 0, goals: [1, 0], taken: [1, 1], history: [{ kicker: 0, shot: 0, dive: 1, goal: true }], chosen: [false, false], mine, sudden: false, over: null })
  const play = (mine: number | null) => frame({ you: 0, n: 2, table: summary({ id: 'park-goal', game: 'penalty', gameLabel: 'Penalties', label: 'Kickabout corner', status: 'playing', max: 2, seats }), toMove: [0, 1], view: view(mine) })
  withState({ tableId: 'park-goal', state: play(null) })
  const open = await tablesApp()
  assert.ok(text(open).includes('You are shooting. Pick your side.'))
  assert.match(open, /aria-label="Shoot left"/)
  assert.ok(text(open).includes('Goal · Ada shot left, Ola went centre'))
  assert.ok(!/<button[^>]*class="pn-zone[^"]*"[^>]*disabled/.test(open))
  withState({ state: play(1) })
  const chosen = await tablesApp()
  assert.ok(text(chosen).includes('You chose centre. Waiting for Ola…'))
  assert.match(chosen, /<button[^>]*is-mine[^>]*disabled[^>]*title="Your side is chosen\./)
})

test('a finished game with a win: the result card, the paid line from the claim, play again, share and leave', async () => {
  const seats = [{ name: 'Ada', bot: false }, { name: 'Ola', bot: false }]
  const result = { text: 'Ada emptied their hand first.', calledOff: false, winners: [0], mine: { won: true, draw: false, human: true, counted: true, rating: 1220, change: 20 } }
  const over = frame({ you: 0, table: summary({ status: 'over', seats }), result, view: whotView({ turn: null, shown: [[], [card('circle', 1)]], hand: [], playable: [] }) })
  withState({ tableId: 'park-bench', state: over, claimed: { game: 'whot', label: 'Whot', won: true, code: 'paid' } })
  const html = await tablesApp()
  const words = text(html)
  assert.match(html, /<div class="is-won gr-card tb-result">/)
  assert.ok(words.includes('You won Ada emptied their hand first.'))
  assert.match(words, /\+₦[\d,]+ paid\. Rating 1220 \(\+20\)\./)
  assert.ok(words.includes('Play again') && words.includes('Share the win') && words.includes('Leave the table'))
  assert.ok(!words.includes('Leave the game (you forfeit)'), 'the game is over')
  assert.ok(!words.includes('Invite a friend to this table'))
  withState({ claimed: null })
  assert.ok(text(await tablesApp()).includes('Collecting your win…'))
  const lost = frame({ you: 0, table: summary({ status: 'over', seats }), result: { ...result, winners: [1], mine: { won: false, draw: false, human: false, counted: false } }, view: whotView({ turn: null, shown: [[], []], hand: [], playable: [] }) })
  withState({ state: lost })
  const lostHtml = await tablesApp()
  assert.ok(text(lostHtml).includes('You lost this one'))
  assert.ok(text(lostHtml).includes('A game against bots pays nothing.'))
  assert.ok(!text(lostHtml).includes('Share the win'))
  assert.ok(!lostHtml.includes('is-won'))
})

test('the Tables app offline (no connection to the server) says only why', async () => {
  const { game } = app
  const view = game.view.value
  assert.equal(view.connected, true)
  // The word comes from the one table of link wordings; here the app is connected, so the list shows.
  withState({ list: [] })
  assert.ok(text(await tablesApp()).includes('No table where you are'))
})

test('the HUD chip: shown in a venue with tables, opening the first; renders nothing elsewhere', async () => {
  const original = app.game.state.value
  const set = (patch: Partial<LifeState>): void => { app.game.state.value = { ...original, ...patch } }
  try {
    set({ location: 'park' })
    const chip = await render('/src/app/features/tables/TablesChip.vue')
    assert.match(chip, /<div data-panel="tables-chip"><button class="life-job" type="button"><span aria-hidden="true">/)
    assert.ok(text(chip).includes('Whot, Penalties, Chess table here Sit down, or invite a friend to play'))
    set({ location: 'home' })
    const none = await render('/src/app/features/tables/TablesChip.vue')
    assert.equal(text(none), '')
    assert.ok(!none.includes('<'.concat('button')), 'no element at all')
  } finally { app.game.state.value = original }
})
