// Component test of the Weave board, in the manner of tablesComponents.test.ts: the component is
// compiled by the project's own Vite configuration and rendered to a string with Vue's server
// renderer, given a handmade view. What is asserted is what the player gets: squares, tiles, names,
// roles and disabled buttons with their reasons.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { emptyBoard, placeTiles } from '../../../tables/weave-board.ts'
import type { WeaveView } from '../../../tables/weave-core.ts'
import type { TableStateFrame, TableSummary } from './tablesBoundary.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
before(async () => {
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
})
after(async () => { await vite.close() })

const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim()
async function render(props: Record<string, unknown>): Promise<string> {
  const component = (await vite.ssrLoadModule('/src/app/features/tables/WeaveBoard.vue') as { default: Component }).default
  return (await renderToString(createSSRApp({ render: () => h(component, props) }))).replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--\[-->|<!--\]-->/g, '')
}

const seats = [{ name: 'Ada', bot: false }, { name: 'Mama Put', bot: true }]
const summary = (): TableSummary => ({ id: 't', venue: 'park', venueLabel: 'The Park', game: 'weave', gameLabel: 'Weave', label: 'Cloth', status: 'playing', max: 4, min: 2, options: {}, seats, watching: 0 })
const view = (patch: Partial<WeaveView> = {}): WeaveView => ({
  game: 'weave', options: { speed: 'relaxed' }, board: placeTiles(emptyBoard(), [{ r: 6, c: 5, l: 's' }, { r: 6, c: 6, l: 'o', blank: true }]), scores: [12, 30], bagCount: 40,
  history: [{ seat: 1, kind: 'play', words: [{ w: 'so', p: 30 }], points: 30, tiles: 2 }, { seat: 0, kind: 'pass', words: [], points: 0, tiles: 0 }],
  rack: ['q', 'e', 'a', '?', 'r', 'i', 'z'], counts: [7, 6], turn: 0, out: [false, false], scoreless: 0, over: null, racks: null, ...patch,
})
const frame = (patch: Partial<TableStateFrame> = {}, v: WeaveView = view()): TableStateFrame => ({
  type: 'table-state', cityId: 'lagos', table: summary(), you: 0, host: true, n: 4, view: v as unknown as Record<string, unknown>, log: [], toMove: [0], clock: null, result: null, optionList: [], ...patch,
})
const buttonOf = (html: string, label: RegExp): string => html.match(new RegExp(`<button[^>]*>\\s*${label.source}\\s*</button>`))?.[0] ?? ''

test('your turn: 169 squares as a grid, the rack with its values, the bot marked, Play waiting for tiles', async () => {
  const html = await render({ state: frame(), now: Date.now() })
  assert.equal((html.match(/role="gridcell"/g) ?? []).length, 169)
  assert.match(html, /role="grid"/)
  assert.equal((html.match(/role="row"/g) ?? []).length, 13)
  assert.equal((html.match(/<button[^>]*role="gridcell"[^>]*tabindex="0"/g) ?? []).length, 1, 'one square in the tab order')
  assert.match(html, /aria-label="G7, O as a blank, 0 points"/)
  assert.match(html, /aria-label="F7, S, 1 point"/)
  assert.match(html, /aria-label="D4, empty, triple word"/)
  assert.match(html, /aria-label="H7, empty"/)
  assert.equal((html.match(/class="[^"]*\bwv-tile\b/g) ?? []).length, 7)
  assert.match(html, /aria-label="1: Q, 10 points"/)
  assert.match(html, /aria-label="4: Blank, 0 points"/)
  const words = text(html)
  assert.ok(words.includes('Mama Put (bot)'), 'a computer player is marked')
  assert.ok(!words.includes('Ada (bot)'))
  assert.ok(words.includes('Your turn'))
  assert.ok(words.includes('Bag: 40 tiles'))
  assert.ok(words.includes('Make a line of connected tiles'))
  assert.ok(words.includes('Mama Put played SO for 30') && words.includes('Ada passed'))
  assert.match(html, /<button[^>]*disabled[^>]*title="Make a line of connected tiles"[^>]*>\s*Play\s*<\/button>/)
  assert.match(html, /<button[^>]*>\s*Swap\s*<\/button>/, 'a swap is possible with 40 in the bag')
  assert.match(html, /<button[^>]*>\s*Resign\s*<\/button>/)
})

test('the scoreboard lists the highest score first and marks whose turn it is', async () => {
  const html = await render({ state: frame({ toMove: [1] }, view({ turn: 1 })), now: Date.now() })
  const score = html.slice(html.indexOf('class="wv-score"'), html.indexOf('</ul>'))
  assert.ok(score.indexOf('Mama Put') < score.indexOf('Ada'), '30 points above 12')
  assert.match(score, /class="is-turn"[^>]*>(?:(?!<\/li>).)*Mama Put/s)
  assert.ok(text(html).includes('Mama Put is thinking'))
  assert.match(buttonOf(html, /Play/), /disabled[^>]*title="Wait for your turn\."/)
  assert.match(html, /It is not your turn: you can lay tiles out/)
})

test('a low bag: the swap button is disabled and says why', async () => {
  const html = await render({ state: frame({}, view({ bagCount: 3 })), now: Date.now() })
  assert.match(buttonOf(html, /Swap/), /disabled/)
  assert.match(buttonOf(html, /Swap/), /title="A swap needs 7 tiles in the bag; 3 left\."/)
  assert.ok(text(html).includes('Bag: 3 tiles'))
})

test('a watcher: no rack, no controls, and a line that says so', async () => {
  const html = await render({ state: frame({ you: null, toMove: [0] }, view({ rack: null })), now: Date.now() })
  const words = text(html)
  assert.ok(words.includes('You are watching'))
  assert.ok(!html.includes('wv-rack'), 'no rack')
  assert.ok(!/>\s*(Play|Swap|Pass|Resign|Shuffle)\s*</.test(html), 'no controls')
  assert.equal((html.match(/role="gridcell"/g) ?? []).length, 169)
  assert.ok(words.includes('Ada to play'))
})

test('a finished game: the result, the winner and the tiles left; the clock and the controls are gone', async () => {
  const over = { winners: [1], draw: false, reason: 'empty-rack', text: '{1} used every tile and wins.', scores: [12, 30] }
  const html = await render({ state: frame({ toMove: [], clock: { deadline: Date.now() + 9000, now: Date.now(), seconds: 120 } }, view({ turn: null, over, racks: [['q', '?'], []] })), now: Date.now() })
  const words = text(html)
  assert.ok(words.includes('Game over') && words.includes('Mama Put used every tile and wins.'))
  assert.ok(words.includes('Mama Put 30 points · winner'))
  assert.ok(words.includes('left holding Q blank (10 points)'))
  assert.ok(!html.includes('wh-clock'))
  assert.ok(!/>\s*Resign\s*</.test(html))
})

test('the turn clock runs while a game is on, and a name is text, never markup', async () => {
  const name = '<b>Ada</b>'
  const html = await render({ state: frame({ clock: { deadline: Date.now() + 60000, now: Date.now(), seconds: 120 } }, view()), now: Date.now() })
  assert.match(html, /class="wh-clock"/)
  const odd = await render({ state: frame({ table: { ...summary(), seats: [{ name, bot: false }, seats[1] as TableSummary['seats'][number]] } }), now: Date.now() })
  assert.ok(odd.includes('&lt;b&gt;Ada&lt;/b&gt;') && !odd.includes(name))
})
