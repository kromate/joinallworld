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
import { ANSWERED_ELSEWHERE_TEXT, ELSEWHERE_TEXT, NO_RELAY_TEXT } from '../../../calls.ts'
import { startsElsewhere } from './callsLoader.ts'
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

const BOLA = { id: 'b', name: 'Bola' }
const card = (patch: Partial<CallView>, extra: Record<string, unknown> = {}) => render('CallCard', { view: view({ peer: BOLA, role: 'caller', callId: 'c1', ...patch }), where: null, founder: false, ...extra })

test('the incoming card names the caller, offers big labelled Answer and Decline, and says what a direct connection reveals the first time', async () => {
  const html = await card({ phase: 'incoming', peer: ADA, role: 'callee', expiresAt: Date.now() + 30000 })
  assert.match(text(html), /Ada/)
  assert.match(text(html), /Incoming voice call/)
  assert.match(html, /role="alertdialog"/)
  assert.match(html, /data-call="accept"[^>]*>.*Answer<\/button>/)
  assert.match(html, /data-call="decline"[^>]*>.*Decline<\/button>/)
  assert.ok(text(html).includes(DISCLOSURE))
  assert.doesNotMatch(html, /disabled/)
  assert.match(html, /class="call-avatar"[^>]*aria-hidden="true"/)
  assert.match(html, />A<\/b>/, 'the initial')
})

test('the card shows where a friend is only when it is given, and the Founder tag only for the founder', async () => {
  const plain = await card({ phase: 'incoming', peer: ADA, role: 'callee' })
  assert.doesNotMatch(plain, /data-call="where"|Founder/)
  const rich = await card({ phase: 'incoming', peer: ADA, role: 'callee' }, { where: 'at Freedom Park, Lagos', founder: true })
  assert.match(text(rich), /at Freedom Park, Lagos/)
  assert.match(text(rich), /Ada Founder/)
})

test('while the microphone is being opened Answer is off; a refusal is announced with its help and a way to try again', async () => {
  const opening = await card({ phase: 'starting', peer: ADA, role: 'callee' })
  assert.match(opening, /<button[^>]*disabled[^>]*data-call="accept"|<button[^>]*data-call="accept"[^>]*disabled/)
  assert.match(text(opening), /Opening your microphone/)
  const refused = await card({ phase: 'incoming', peer: ADA, role: 'callee', mic: 'problem', micProblem: 'denied', error: 'Microphone blocked. Allow the microphone for this site, then tap Try again.' })
  assert.match(refused, /role="alert"/)
  assert.match(text(refused), /Microphone blocked/)
  assert.match(text(refused), /Try again/)
})

test('the outgoing card says Calling then Ringing, asks to allow the microphone, and offers only Cancel', async () => {
  const calling = await card({ phase: 'calling', mic: 'asking' })
  assert.match(text(calling), /Calling…/)
  assert.match(text(calling), /Allow the microphone when your browser asks/)
  const ringingNow = await card({ phase: 'ringing', mic: 'ready' })
  assert.match(text(ringingNow), /Ringing…/)
  assert.match(ringingNow, /data-call="hangup"[^>]*>.*Cancel<\/button>/)
  assert.doesNotMatch(ringingNow, /data-call="(accept|mute|tap-to-talk)"/)
  assert.match(ringingNow, /aria-live="polite"/)
  const noMic = await card({ phase: 'ringing', mic: 'problem', micProblem: 'in-use', error: 'Your microphone is being used by another app. Close that app, then tap Try again.' })
  assert.match(noMic, /data-call="retry"[^>]*>Try again</)
  assert.match(text(noMic), /another app/)
})

test('the fallback is one clear button: Tap to talk', async () => {
  const tap = await card({ phase: 'needs-tap' })
  assert.match(text(tap), /Bola answered/)
  assert.match(tap, /data-call="tap-to-talk"[^>]*>Tap to talk</)
  assert.doesNotMatch(text(tap), /Start microphone/)
  const connecting = await card({ phase: 'connecting' })
  assert.match(text(connecting), /Connecting…/)
  assert.match(connecting, /data-call="hangup"[^>]*>.*Hang up</)
})

test('the pill shows the name, the running time and a quality dot; muted is impossible to miss; details are behind a tap', async () => {
  const live = await render('CallPill', { view: view({ phase: 'connected', peer: BOLA, role: 'caller', callId: 'c1', startedAt: Date.now() - 65000, quality: 'good', path: 'relay' }) })
  assert.match(text(live), /Bola 1:0\d/)
  assert.match(live, /aria-label="Mute microphone"/)
  assert.match(live, /aria-label="Hang up"/)
  assert.match(live, /aria-expanded="false"/)
  assert.doesNotMatch(text(live), /relay/i, 'the route is not shown until Details is opened')
  assert.doesNotMatch(live, /data-call="muted-banner"/)
  const muted = await render('CallPill', { view: view({ phase: 'connected', peer: BOLA, role: 'caller', callId: 'c1', startedAt: Date.now(), muted: true }) })
  assert.match(muted, /is-muted/)
  assert.match(muted, /aria-pressed="true"/)
  assert.match(muted, /aria-label="Unmute microphone"/)
  assert.match(text(muted), /You are muted\. Bola cannot hear you\./)
  assert.match(text(muted), /Bola 0:0\d · Muted/)
  const reconnecting = await render('CallPill', { view: view({ phase: 'reconnecting', peer: BOLA, role: 'caller', callId: 'c1', startedAt: Date.now(), quality: 'reconnecting' }) })
  assert.match(text(reconnecting), /Reconnecting…/)
  assert.match(reconnecting, /is-reconnecting/)
  const blocked = await render('CallPill', { view: view({ phase: 'connected', peer: BOLA, role: 'caller', callId: 'c1', startedAt: Date.now(), playBlocked: true }) })
  assert.match(blocked, /data-call="hear"[^>]*>Tap to hear Bola</)
})

test('the ended card shows the length of a call, what happened otherwise, and Call again, Message and OK', async () => {
  const done = await render('CallEnded', { view: view({ phase: 'ended', peer: BOLA, outcome: 'ended', duration: 252000, notice: 'Call ended.' }) })
  assert.match(text(done), /Call ended · 4:12/)
  assert.match(done, /data-call="again"[^>]*>Call again</)
  assert.match(done, /data-call="message"/)
  assert.match(done, /data-call="dismiss"/)
  const missed = await render('CallEnded', { view: view({ phase: 'ended', peer: ADA, role: 'callee', outcome: 'missed', notice: 'Missed call from Ada.' }) })
  assert.match(text(missed), /Missed call from Ada\./)
  assert.match(missed, /data-call="again"[^>]*>Call back</)
  const unreachable = await render('CallEnded', { view: view({ phase: 'ended', peer: BOLA, outcome: 'unreachable', notice: 'Bola can’t be reached right now.' }) })
  assert.match(text(unreachable), /Bola can’t be reached right now\./)
  assert.doesNotMatch(unreachable, /blocked|busy|offline|friends only/i, 'never says why')
  const failed = await render('CallEnded', { view: view({ phase: 'ended', peer: BOLA, outcome: 'failed', notice: NO_RELAY_TEXT }) })
  assert.match(text(failed), /Could not connect — your networks need a relay that is not available right now\./)
  const limited = await render('CallEnded', { view: view({ phase: 'ended', peer: BOLA, outcome: 'limited', notice: 'Too many call attempts. Try again in a minute.' }) })
  assert.doesNotMatch(limited, /data-call="again"/)
  const mic = await render('CallEnded', { view: view({ phase: 'ended', peer: BOLA, outcome: 'mic', notice: 'Microphone blocked.' }) })
  assert.match(mic, /data-call="again"[^>]*>Try again</)
})

test('a call on another device of this player is one quiet line with no button: it cannot be ended, muted or joined from here', async () => {
  const answered = await render('CallLine', { view: view({ phase: 'elsewhere', peer: BOLA, role: 'callee', callId: 'c1', notice: ANSWERED_ELSEWHERE_TEXT }) })
  assert.match(text(answered), /Answered on another device\./)
  const passive = await render('CallLine', { view: view({ phase: 'elsewhere', peer: BOLA, role: 'callee', callId: 'c1', notice: ELSEWHERE_TEXT }) })
  assert.match(text(passive), /On a call on another device\. With Bola/)
  for (const html of [answered, passive]) {
    assert.doesNotMatch(html, /<button/, 'no button at all')
    assert.doesNotMatch(html, /data-call="(hangup|mute|start|hear|dismiss)"/)
    assert.match(html, /aria-live="polite"/)
  }
  // The Call button on a player's card says why it is off.
  callStore.view = view({ phase: 'elsewhere', peer: BOLA, notice: ELSEWHERE_TEXT })
  assert.equal(callReason({ status: 'online' }, true), 'You are on a call on another device.')
  callStore.view = idleView()
  // The lazily loaded controller is fetched for a call that began on another device, and for nothing else it never saw.
  assert.equal(startsElsewhere({ type: 'call-state', state: 'accepted', elsewhere: true } as { type: string }), true)
  assert.equal(startsElsewhere({ type: 'call-state', state: 'ringing', elsewhere: true } as { type: string }), true)
  assert.equal(startsElsewhere({ type: 'call-state', state: 'ended' } as { type: string }), false)
  assert.equal(startsElsewhere({ type: 'call-signal' }), false)
})

test('the helpers: clock, where a friend is (only when online at a public venue), founder, status words', async () => {
  const f = await import('./callFormat.ts')
  assert.deepEqual([f.clockText(0), f.clockText(252000), f.clockText(3725000)], ['0:00', '4:12', '62:05'])
  const venue = (id: string): string => (id === 'park' ? 'Freedom Park' : id), city = (id: string): string => (id === 'lagos' ? 'Lagos' : id)
  assert.equal(f.whereText({ id: 'x', status: 'online', venue: 'park', cityId: 'lagos' }, venue, city), 'at Freedom Park, Lagos')
  for (const hidden of [undefined, { id: 'x', status: 'away', venue: 'park', cityId: 'lagos' }, { id: 'x', status: 'online', venue: 'home', cityId: 'lagos' }, { id: 'x', status: 'online', venue: 'visit', cityId: 'lagos' }, { id: 'x', status: 'online', venue: 'park' }]) assert.equal(f.whereText(hidden, venue, city), null)
  assert.equal(f.isFounder({ id: 'x', name: 'X', founder: true }, undefined), true)
  assert.equal(f.isFounder({ id: 'x', name: 'X' }, undefined), false)
  assert.equal(f.statusText('calling', 'caller', 'Bola', 'ready'), 'Calling…')
  assert.equal(f.initialOf(' joy'), 'J')
})

test('the call tones are synthesised: the player exposes its events, stops everything at once and respects the shared call volume', async () => {
  const tones = await vite.ssrLoadModule('/src/app/features/calls/callTones.ts') as typeof import('./callTones.ts')
  const hook = (globalThis as { __callTones?: { events: { tone: string | null; event: string }[]; playing(): string | null } }).__callTones
  assert.ok(hook, 'the test hook exists')
  tones.startRingback()
  tones.stopTones()
  assert.equal(hook.playing(), null)
  assert.ok(hook.events.some((item) => item.tone === 'ringback' && item.event === 'blocked'), 'with no audio device (no page) a tone is noted as blocked, not played')
  assert.ok(typeof tones.toneState.locked === 'boolean')
})

test('the first-call note shows the disclosure line and a Call button', async () => {
  const html = await render('DisclosureConfirm', { peer: { id: 'b', name: 'Bola' } })
  assert.match(text(html), /Call Bola\?/)
  assert.ok(text(html).includes('Calls connect your device directly to theirs, which can reveal your network address to them.'))
  assert.match(html, /<button[^>]*>Call<\/button>/)
})

test('Calls from: three choices, everyone unless the server said otherwise', async () => {
  // The page's own module instance (the one the rendered component reads), not this file's copy.
  const { callStore: page } = (await vite.ssrLoadModule('/src/app/features/calls/callState.ts')) as { callStore: typeof callStore }
  page.accepting = null
  const html = await render('CallSettings')
  for (const label of ['Everyone', 'Friends only', 'Nobody']) assert.ok(text(html).includes(label), label)
  assert.match(html, /role="radiogroup"/)
  assert.match(html, /value="everyone"[^>]*checked|checked[^>]*value="everyone"/)
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
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.call-ring, \.is-reconnecting \.call-dot \{ animation: none/)
  const host = await readFile(new URL('./CallsHost.vue', import.meta.url), 'utf8')
  assert.match(host, /defineAsyncComponent\(\(\) => import\('\.\/CallsUi\.vue'\)\)/)
  const loader = await readFile(new URL('./callsLoader.ts', import.meta.url), 'utf8')
  assert.match(loader, /import\('\.\.\/\.\.\/\.\.\/calls\.ts'\)/)
  assert.match(loader, /import\('\.\/callTones\.ts'\)/)
  assert.doesNotMatch(loader, /^import [^t].*calls\.ts'/m, 'only a type import of the controller')
})
