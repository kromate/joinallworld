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
let rendererTransforms = 0
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const html = (): Promise<string> => renderToString(createSSRApp({ render: () => h(bar) }))

before(async () => {
  globalThis.fetch = fake.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{ name: 'observe-progress-boundary', transform(_code, id) { if (id.endsWith('/RunningActionProgress.vue')) rendererTransforms++ } }] })
  await (await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')).loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  bar = (await load('/src/app/features/venue/ActionProgress.vue')).default
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

const run = (action: Record<string, unknown>): void => { app.game.state.value = { ...app.game.state.value, activeAction: { duration: 20, remaining: 10, ...action } } as typeof app.game.state.value }

test('an idle player renders no controls and does not load the running renderer', async () => {
  app.game.state.value = { ...app.game.state.value, activeAction: null }
  const out = await html()
  assert.ok(!/Current activity|Loading current activity|Try loading activity|<button|<progress/.test(out))
  assert.equal(rendererTransforms, 0, 'idle SSR never requests the running SFC')
})

test('a trip between cities shows the rule and no Cancel button', async () => {
  run({ kind: 'intercity', id: 'ibadan' })
  const out = await html()
  assert.ok(rendererTransforms > 0, 'an active action loads the real running renderer')
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

test('an interactive teaching shift shows choices and no countdown or timed progress bar', async () => {
  run({ kind: 'activity', id: 'teaching-shift', duration: 40, remaining: 40, teachingGeneration: 3,
    teaching: { version: 1, lessonId: 'fractions-v1', revision: 1, stage: 'diagnose', feedback: null } })
  const out = await html()
  assert.match(out, /Fictional NPC teaching practice/)
  assert.match(out, /What misunderstanding should you address/)
  assert.match(out, /Cancel practice/)
  assert.ok(!/40s left|<progress/.test(out), 'player decisions replace the countdown')
  assert.equal((out.match(/class="teaching-shift__choice"/g) ?? []).length, 3)
})
