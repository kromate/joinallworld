// The activity bar: a trip between cities cannot be cancelled, so it shows the rule and no Cancel button (only the
// way to arrive now); a local trip still can be cancelled.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createFakeServer } from '../../testing/fakeServer.ts'
import type { App } from '../../state/app.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const fake = createFakeServer()
let vite: ViteDevServer
let app: App
let bar: Component
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const html = (): Promise<string> => renderToString(createSSRApp({ render: () => h(bar) }))

before(async () => {
  globalThis.fetch = fake.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  await (await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')).loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  bar = (await load('/src/app/features/venue/ActionProgress.vue')).default
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

const run = (action: Record<string, unknown>): void => { app.game.state.value = { ...app.game.state.value, activeAction: { duration: 20, remaining: 10, ...action } } as typeof app.game.state.value }

test('a trip between cities shows the rule and no Cancel button', async () => {
  run({ kind: 'intercity', id: 'ibadan' })
  const out = await html()
  assert.match(out, /This cannot be cancelled once started\./)
  assert.ok(!/Cancel<\/button>/.test(out), 'no Cancel to press')
  // The one thing to press is the way to arrive now.
  assert.deepEqual(out.match(/<button[^>]*>[^<]*<\/button>/g)?.map((button) => button.replace(/<[^>]+>/g, '')), ['Skip the trip · Free'])
})
test('a local trip can still be cancelled', async () => {
  run({ kind: 'travel', id: 'park', mode: 'walk' })
  const out = await html()
  assert.match(out, /<button[^>]*>Cancel<\/button>/)
  assert.ok(!/cannot be cancelled/.test(out))
})
