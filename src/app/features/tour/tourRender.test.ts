// The shortcuts sheet, compiled by the project's Vite configuration and rendered to a string.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
before(async () => { vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } }) })
after(async () => { await vite?.close() })

test('the shortcuts sheet lists the keys in groups as key-caps, as text', async () => {
  const sheet = (await vite.ssrLoadModule('/src/app/features/tour/ShortcutsSheet.vue') as { default: Component }).default
  const html = await renderToString(createSSRApp({ render: () => h(sheet) }))
  for (const title of ['Move', 'Camera', 'Map', 'Phone and panels', 'Chat and voice', 'General']) assert.ok(html.includes(`>${title}</h3>`), title)
  assert.match(html, /<kbd[^>]*>W<\/kbd>/); assert.match(html, /<kbd[^>]*>\?<\/kbd>/); assert.match(html, /Keyboard shortcuts/)
  assert.ok(!/<script/i.test(html) && !/ on\w+=/.test(html))
})
