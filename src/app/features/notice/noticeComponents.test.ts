// The banner rendered to a string against the real store, in each state.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { noticeUi as NoticeUi } from './noticeStore.ts'
import type { callStore as CallStore } from '../calls/callState.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
let ui: typeof NoticeUi
let calls: typeof CallStore
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
async function render(): Promise<string> {
  const component = (await load('/src/app/features/notice/NoticeBanner.vue')).default
  return (await renderToString(createSSRApp({ render: () => h(component) }))).replace(/ data-v-[0-9a-f]+/g, '')
}
const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada <b>' }
const running = (over: Partial<typeof NoticeUi> = {}): void => {
  ui.now = 1000; ui.notice = { id: 'n-1', build: 'one', minutes: 3, endsAt: 1000 + 150_000 }; ui.dismissedId = ''; ui.updated = null
  Object.assign(ui, over)
}

before(async () => {
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  ui = (await load<{ noticeUi: typeof NoticeUi }>('/src/app/features/notice/noticeStore.ts')).noticeUi
  calls = (await load<{ callStore: typeof CallStore }>('/src/app/features/calls/callState.ts')).callStore
})
after(async () => { await vite?.close() })

test('plain: one polite status line with the countdown, a dismiss button, and no call line', async () => {
  running()
  const html = await render()
  assert.match(html, /<aside class="notice-line" role="status" aria-live="polite"/)
  assert.ok(text(html).includes('Allworld is updating in about 3 minutes. You will stay signed in and reconnect on your own.'))
  assert.ok(!text(html).includes('Calls end'))
  assert.match(html, /aria-label="Dismiss"/)
  assert.match(html, /<div class="notice-line-text" aria-hidden="true">/, 'the ticking countdown is not read out')
})

test('in a call: the extra line', async () => {
  running()
  calls.view = { ...calls.view, phase: 'connected', peer: ADA }
  try { assert.ok(text(await render()).includes('Calls end when it updates — you can call again right after.')) }
  finally { calls.view = { ...calls.view, phase: 'idle', peer: null } }
})

test('dismissed and expired: nothing is drawn', async () => {
  running({ dismissedId: 'n-1' })
  assert.ok(!(await render()).includes('notice-line'))
  running({ now: 1000 + 151_000 })
  assert.ok(!(await render()).includes('notice-line'))
})

test('updated: said once, with a button naming the person to call again (as text)', async () => {
  running({ notice: null, updated: { at: 1000, cut: ADA } })
  const html = await render()
  assert.ok(text(html).includes('Allworld has been updated.'))
  assert.ok(text(html).includes('Call Ada <b> again'.replace('<', '&lt;').replace('>', '&gt;')))
  assert.ok(!html.includes('Ada <b>'), 'a name is text')
  running({ notice: null, updated: { at: 1000, cut: null } })
  assert.ok(!text(await render()).includes(' again'))
})
