// LazyList rendered to a string: the rows the caller draws, the grey rows while a page is on its way, the failure line with its retry, the
// empty state, the announcement for a screen reader, and — for a long list of one row height — only the rows near the top, in a box
// as tall as the whole list (the browser behaviour of scrolling and asking for more is tried in a real browser).
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'

const root = fileURLToPath(new URL('../../..', import.meta.url))
let vite: ViteDevServer
before(async () => { vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } }) })
after(async () => { await vite?.close() })
async function render(props: Record<string, unknown>): Promise<string> {
  const component = ((await vite.ssrLoadModule('/src/app/ui/LazyList.vue')) as { default: Component }).default
  const app = createSSRApp({ render: () => h(component, props, { row: ({ item, index }: { item: { id: string }; index: number }) => h('b', `${item.id}/${index}`), empty: () => h('p', 'Nothing here') }) })
  return (await renderToString(app)).replace(/<!--.*?-->/g, '').replace(/ data-v-[0-9a-f]+/g, '')
}
const items = (count: number): { id: string }[] => Array.from({ length: count }, (_, index) => ({ id: `r${index}` }))
const base = { itemKey: (row: { id: string }) => row.id, hasMore: false, loading: false }

test('rows are the caller\'s own markup, in order, as a list a screen reader can count', async () => {
  const html = await render({ ...base, items: items(3), label: 'players' })
  assert.match(html, /role="list" aria-label="players" aria-busy="false"/)
  assert.deepEqual([...html.matchAll(/<b>([^<]+)<\/b>/g)].map((match) => match[1]), ['r0/0', 'r1/1', 'r2/2'])
  assert.equal((html.match(/role="listitem"/g) ?? []).length, 3)
})

test('while a page is on its way grey rows stand in for it, and a screen reader hears it say what was added', async () => {
  const html = await render({ ...base, items: items(2), loading: true, hasMore: true, skeletonRows: 4, announcement: 'Loaded 40 more players' })
  assert.equal((html.match(/<i aria-hidden="true"/g) ?? []).length, 4)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /<div class="ll-live" aria-live="polite" role="status">Loaded 40 more players<\/div>/)
})

test('a failure reads "Couldn\'t load more" with Try again, and an empty list shows the caller\'s own words', async () => {
  const failed = await render({ ...base, items: items(2), error: 'No signal.', hasMore: true })
  assert.match(failed, /role="alert">Couldn’t load more · <button type="button">Try again<\/button>/)
  assert.match(await render({ ...base, items: [] }), /<p>Nothing here<\/p>/)
  assert.doesNotMatch(await render({ ...base, items: [], loading: true, hasMore: true }), /Nothing here/, 'not empty while the first page is on its way')
})

test('a long list of one row height draws a window of it, as tall as the whole list, each row placed and numbered', async () => {
  const html = await render({ ...base, items: items(5000), rowHeight: 60, label: 'players' })
  const drawn = (html.match(/role="listitem"/g) ?? []).length
  assert.ok(drawn > 5 && drawn < 40, `${drawn} rows of 5000`)
  assert.match(html, /class="is-windowed ll-rows" style="height:300000px;"/)
  assert.match(html, /data-index="0" aria-posinset="1" aria-setsize="5000" style="top:0px;height:60px;"/)
  const short = await render({ ...base, items: items(250), rowHeight: 60 })
  assert.equal((short.match(/role="listitem"/g) ?? []).length, 250, 'a short list is drawn whole')
  assert.doesNotMatch(short, /is-windowed/)
})
