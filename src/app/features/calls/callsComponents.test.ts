// Component tests for the call screens, in the manner of communityComponents.test.ts: compiled by the project's own
// Vite configuration and rendered to a string. What is asserted is the words, roles and disabled controls the player
// gets; what a press does is tested at the controller (src/calls.test.ts).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { CallView } from '../../../calls.ts'
import { NO_CONNECTION_TEXT } from '../../../calls.ts'
import { callStore, DISCLOSURE, idleView } from './callState.ts'
import { callReason } from './useCall.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
let vite: ViteDevServer
before(async () => {
  vite = await createServer({ root, configFile: `${root}vite.config.js`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
})
after(async () => { await vite?.close() })

async function render(name: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = ((await vite.ssrLoadModule(`/src/app/features/calls/${name}.vue`)) as { default: Component }).default
  const html = await renderToString(createSSRApp({ render: () => h(component, props) }))
  return html.replace(/ data-v-[0-9a-f]+/g, '').replace(/<!--\[-->|<!--\]-->|<!---->/g, '')
}
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
const view = (patch: Partial<CallView>): CallView => ({ ...idleView(), ...patch })
const ADA = { id: 'ada-id', name: 'Ada' }

test('the incoming banner names the caller, offers Accept and Decline, and says what a direct connection reveals the first time', async () => {
  const html = await render('IncomingCall', { view: view({ phase: 'incoming', peer: ADA, role: 'callee', callId: 'c1', expiresAt: Date.now() + 30000 }) })
  assert.match(text(html), /Ada is calling/)
  assert.match(text(html), /Ringing · \d+ s/)
  assert.match(html, /role="alertdialog"/)
  assert.match(html, /<button[^>]*data-call="accept"[^>]*>Accept<\/button>/)
  assert.match(html, /<button[^>]*data-call="decline"[^>]*>Decline<\/button>/)
  assert.ok(text(html).includes(DISCLOSURE))
  assert.doesNotMatch(html, /disabled/)
})

test('while the microphone is being opened Accept is off, and a refusal is announced', async () => {
  const opening = await render('IncomingCall', { view: view({ phase: 'starting', peer: ADA, role: 'callee', callId: 'c1' }) })
  assert.match(opening, /<button[^>]*disabled[^>]*data-call="accept"|<button[^>]*data-call="accept"[^>]*disabled/)
  assert.match(text(opening), /Opening your microphone/)
  const refused = await render('IncomingCall', { view: view({ phase: 'incoming', peer: ADA, role: 'callee', callId: 'c1', error: 'Microphone permission was denied. Allow the microphone for this site and try again.' }) })
  assert.match(refused, /role="alert"/)
  assert.match(text(refused), /Allow the microphone/)
})

test('the call bar says what is happening at each step and offers only what makes sense', async () => {
  const calling = await render('CallBar', { view: view({ phase: 'ringing', peer: { id: 'b', name: 'Bola' }, role: 'caller', callId: 'c1' }) })
  assert.match(text(calling), /Calling Bola…/)
  assert.match(calling, /data-call="hangup"[^>]*>Cancel</)
  assert.doesNotMatch(calling, /data-call="mute"/)
  const tap = await render('CallBar', { view: view({ phase: 'needs-tap', peer: { id: 'b', name: 'Bola' }, role: 'caller', callId: 'c1' }) })
  assert.match(text(tap), /Bola answered\. Tap to start your microphone\./)
  assert.match(tap, /data-call="start"[^>]*>Start microphone</)
  const live = await render('CallBar', { view: view({ phase: 'connected', peer: { id: 'b', name: 'Bola' }, role: 'caller', callId: 'c1', startedAt: Date.now() - 65000, muted: true }) })
  assert.match(text(live), /Bola 1:0\d · Muted/)
  assert.match(live, /aria-pressed="true"[^>]*data-call="mute"[^>]*>Unmute</)
  assert.match(live, /data-call="hangup"[^>]*>Hang up</)
  assert.match(live, /aria-live="polite"/)
  const choices = await render('CallBar', { view: view({ phase: 'connected', peer: { id: 'b', name: 'Bola' }, role: 'caller', callId: 'c1', startedAt: Date.now(), devices: [{ id: '', label: 'System default' }, { id: 'u', label: 'USB' }, { id: 'v', label: 'Headset' }] }) })
  assert.match(choices, /aria-label="Microphone"/)
  assert.match(text(choices), /Headset/)
  const reconnecting = await render('CallBar', { view: view({ phase: 'reconnecting', peer: { id: 'b', name: 'Bola' }, role: 'caller', callId: 'c1', startedAt: Date.now() }) })
  assert.match(text(reconnecting), /Reconnecting…/)
})

test('an ended call says why, and a call that could not connect explains the network limit', async () => {
  const ended = await render('CallBar', { view: view({ phase: 'ended', peer: { id: 'b', name: 'Bola' }, notice: 'Bola can’t be reached right now.' }) })
  assert.match(text(ended), /Bola can’t be reached right now\./)
  assert.doesNotMatch(ended, /blocked|busy|offline|friends only/i, 'never says why')
  assert.match(ended, /data-call="dismiss"/)
  const failed = await render('CallBar', { view: view({ phase: 'ended', peer: { id: 'b', name: 'Bola' }, notice: NO_CONNECTION_TEXT }) })
  assert.match(text(failed), /direct path between two devices/)
  assert.match(text(failed), /Try another network/)
})

test('the first-call note shows the disclosure line and a Call button', async () => {
  const html = await render('DisclosureConfirm', { peer: { id: 'b', name: 'Bola' } })
  assert.match(text(html), /Call Bola\?/)
  assert.ok(text(html).includes('Calls connect your device directly to theirs, which can reveal your network address to them.'))
  assert.match(html, /<button[^>]*>Call<\/button>/)
})

test('Calls from: three choices, friends only unless the server said otherwise', async () => {
  // The page's own module instance (the one the rendered component reads), not this file's copy.
  const { callStore: page } = (await vite.ssrLoadModule('/src/app/features/calls/callState.ts')) as { callStore: typeof callStore }
  page.accepting = null
  const html = await render('CallSettings')
  for (const label of ['Everyone', 'Friends only', 'Nobody']) assert.ok(text(html).includes(label), label)
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /value="friends"[^>]*checked|checked[^>]*value="friends"/)
  assert.doesNotMatch(html, /value="nobody"[^>]*checked/)
  page.accepting = 'nobody'
  assert.match(await render('CallSettings'), /value="nobody"[^>]*checked|checked[^>]*value="nobody"/)
  page.accepting = null
})

test('Call cannot be pressed when it makes no sense, and says why', () => {
  assert.equal(callReason({ status: 'online' }, true), null)
  assert.equal(callReason({ status: 'away' }, true), null)
  assert.equal(callReason({ self: true }, true), 'This is you.')
  assert.equal(callReason({ status: 'online' }, false), 'Not connected.')
  assert.equal(callReason({ blocked: true }, true), 'Unblock this player to call.')
  assert.equal(callReason({ status: 'offline' }, true), 'They are offline.')
  assert.match(callReason({ status: 'online' }, true, false) ?? '', /supported browser/)
  callStore.view = view({ phase: 'connected' })
  assert.equal(callReason({ status: 'online' }, true), 'You are already in a call.')
  callStore.view = idleView()
})

test('the call screens respect reduced motion and stay out of the entry bundle: the host loads them on demand', async () => {
  const css = await readFile(new URL('./calls.css', import.meta.url), 'utf8')
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.call-pulse \{ animation: none/)
  const host = await readFile(new URL('./CallsHost.vue', import.meta.url), 'utf8')
  assert.match(host, /defineAsyncComponent\(\(\) => import\('\.\/CallsUi\.vue'\)\)/)
  const loader = await readFile(new URL('./callsLoader.ts', import.meta.url), 'utf8')
  assert.match(loader, /import\('\.\.\/\.\.\/\.\.\/calls\.ts'\)/)
  assert.doesNotMatch(loader, /^import [^t].*calls\.ts'/m, 'only a type import of the controller')
})
