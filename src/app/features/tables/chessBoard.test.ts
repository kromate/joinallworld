// The chess board rendered to a string with the project's own Vite configuration, against a
// handmade view. Only the first draw is asserted: the squares, the pieces' words, the bars, the
// move list, the orientation and the controls (what a tap or a drag sends is in the model's tests).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ChessState } from './tablesBoundary.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
before(async () => {
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
})
after(async () => { await vite?.close() })

const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<svg.*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const labels = (html: string): string[] => [...html.matchAll(/role="gridcell"[^>]*?aria-label="([^"]*)"/g)].map((match) => match[1] as string)
async function render(state: ChessState): Promise<string> {
  const component = (await vite.ssrLoadModule('/src/app/features/tables/ChessBoard.vue') as { default: Component }).default
  return (await renderToString(createSSRApp({ render: () => h(component, { state, now: 1000 }) }))).replace(/ data-v-[0-9a-f]+/g, '')
}

const BACK = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
const start = (): (string | null)[] => [
  ...BACK.map((kind) => `b${kind}`), ...Array<string>(8).fill('bP'), ...Array<null>(32).fill(null), ...Array<string>(8).fill('wP'), ...BACK.map((kind) => `w${kind}`),
]
const state = (you: 'w' | 'b' | null, patch: { bot?: boolean; history?: string[] } = {}): ChessState => ({
  type: 'table-state', cityId: 'lagos', n: 2, you: you === null ? null : you === 'w' ? 0 : 1, host: false, log: [], toMove: [], result: null, optionList: [],
  clock: { deadline: 301000, now: 1000, seconds: 300 },
  table: {
    id: 't', venue: 'v', venueLabel: 'V', game: 'chess', gameLabel: 'Chess', label: 'Chess', status: 'playing', max: 2, min: 2, options: { clock: '5+3', level: 'medium' }, watching: 0,
    seats: [{ name: 'Ada', bot: false }, { name: 'Bola', bot: patch.bot ?? false }],
  },
  view: {
    game: 'chess', options: { clock: '5+3', colour: 'white', level: 'medium' }, white: 0, you, turn: 'w', board: start(),
    legal: you === 'w' ? [{ from: 'e2', to: 'e4' }] : [], history: patch.history ?? ['e4', 'e5', 'Nf3'], last: { from: 'g1', to: 'f3' }, check: null,
    captured: { w: ['bP'], b: [] }, clocks: { w: 300000, b: 290000 }, drawOffer: null, over: null, halfmove: 0,
  },
} as unknown as ChessState)

test('the board has 64 squares in a grid, with the pieces named', async () => {
  const html = await render(state('w'))
  assert.match(html, /role="grid"/)
  const names = labels(html)
  assert.equal(names.length, 64)
  assert.equal(names[0], 'a8, black rook')
  assert.equal(names[63], 'h1, white rook')
  assert.ok(names.includes('e4, empty'))
  assert.ok(names.includes('e1, white king'))
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1)
})

test('Black sees the board from the other side', async () => {
  const names = labels(await render(state('b')))
  assert.equal(names[0], 'h1, white rook')
  assert.equal(names[63], 'a8, black rook')
})

test('the move list, the bars and the status', async () => {
  const words = text(await render(state('w')))
  assert.match(words, /1\. e4 e5 2\. Nf3/)
  assert.match(words, /Ada \(you\)/)
  assert.match(words, /Bola/)
  assert.match(words, /\+1/)
  assert.match(words, /5:00/)
  assert.match(words, /4:50/)
})

test('a computer opponent is labelled and gets no draw offer', async () => {
  const words = text(await render(state('w', { bot: true })))
  assert.match(words, /Bola \(bot\)/)
  assert.match(words, /Computer, Medium/)
  assert.doesNotMatch(words, /Offer draw/)
  assert.match(words, /Resign/)
  assert.match(text(await render(state('w'))), /Offer draw/)
})

test('a watcher gets Flip and nothing else, and no dots are drawn before a selection', async () => {
  const html = await render(state(null))
  const words = text(html)
  assert.match(words, /Flip board/)
  assert.doesNotMatch(words, /Resign|Offer draw|Accept draw/)
  assert.doesNotMatch(html, /is-dest|is-capture/)
  assert.doesNotMatch(await render(state('w')), /is-dest|is-capture/)
})
