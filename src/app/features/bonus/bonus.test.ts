// The launch bonus on the page: the words, the chip's rules, the moment, and the screens that carry them, rendered to a string against the real
// store connected to a fake server. The money and the places are the server's: server/bonus.test.ts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { offerSentence, sharePreview, shareText } from '../../../game/share-model.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import { runMoment } from './bonusMoment.ts'
import { CHIP_AGAIN_MS, chipDue, chipHiddenUntil, chipText, companionLine, dismissChip, heldLine, momentToast, offerLine } from './bonusModel.ts'

const OFFER = { on: true, amount: 1_000_000, places: 10_000, left: 4_230 }
const memory = (): Pick<Storage, 'getItem' | 'setItem'> => { const data = new Map<string, string>(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) } } }

test('the offer line: honest, in-game naira, the true count, and gone when the offer is over', () => {
  assert.equal(offerLine(OFFER), 'Launch bonus: the first 10,000 players to sign up get ₦1,000,000 in the game. 4,230 left.')
  assert.equal(chipText(OFFER), 'Sign up to claim ₦1,000,000 in the game · 4,230 left')
  for (const gone of [null, undefined, { ...OFFER, on: false }, { ...OFFER, left: 0 }]) assert.equal(offerLine(gone), null)
  assert.equal(chipText({ ...OFFER, left: 0 }), null)
  assert.ok(!/hurry|only|last chance|countdown/i.test(offerLine(OFFER) ?? ''), 'no pressure beyond the true count')
})

test('the guest chip: only to a guest in the quiet moment, dismissed for a day, then back', () => {
  const storage = memory()
  const facts = { offer: OFFER, eligible: true, hiddenUntil: chipHiddenUntil(storage), now: 1000 }
  assert.equal(chipDue(facts), true)
  assert.equal(chipDue({ ...facts, eligible: false }), false, 'a sheet, the tour, a call or a signed-in player: not shown')
  assert.equal(chipDue({ ...facts, offer: { ...OFFER, on: false } }), false)
  const until = dismissChip(storage, 1000)
  assert.equal(until, 1000 + CHIP_AGAIN_MS)
  assert.equal(chipDue({ ...facts, hiddenUntil: chipHiddenUntil(storage), now: 2000 }), false)
  assert.equal(chipDue({ ...facts, hiddenUntil: chipHiddenUntil(storage), now: 1000 + CHIP_AGAIN_MS }), true, 'back after a day, not before')
  assert.equal(chipHiddenUntil(null), 0)
})

test('the moment: the toast names the place, the companion says one line, a held bonus says why it waits', () => {
  assert.equal(momentToast({ amount: 1_000_000, n: 4231, places: 10_000 }), '₦1,000,000 launch bonus — you are player #4,231 of the first 10,000')
  const line = companionLine('Ada', 1_000_000)
  assert.ok(line.startsWith('Ada, ₦1,000,000') && /home|stall|trip/.test(line))
  assert.equal(heldLine('address'), 'Your bonus is reserved and will arrive within a day.')
  assert.match(heldLine('character'), /reserved/)
})

test('share text and the link preview carry the offer only while it is open', () => {
  const facts = { kind: 'invite', name: 'Ada', city: 'Lagos', district: 'Yaba' }
  const open = shareText(facts, 'https://example.test/s/abc12345', OFFER)
  assert.ok(open.includes('The first 10,000 players get ₦1,000,000 in the game'))
  assert.ok(open.endsWith('https://example.test/s/abc12345'), 'the link stays the last line')
  assert.ok(!shareText(facts, 'https://example.test/s/abc12345', { ...OFFER, on: false }).includes('first 10,000'))
  assert.ok(!shareText(facts, 'https://example.test/s/abc12345').includes('first 10,000'))
  assert.ok(sharePreview(facts, OFFER).description.endsWith('The first 10,000 players get ₦1,000,000 in the game.'))
  assert.equal(sharePreview(facts, null).description, sharePreview(facts).description)
  assert.equal(offerSentence({ ...OFFER, on: false }), '')
})

test('the first download carries none of it: the mount is reached from a file that is already fetched late, and the chip hides on a short phone like the guest bar', () => {
  const slot = readFileSync(new URL('../hud/GuestBarSlot.vue', import.meta.url), 'utf8')
  assert.ok(!/bonus/i.test(slot), 'the guest bar slot does not mention the bonus')
  const later = readFileSync(new URL('../hud/olderPointer.ts', import.meta.url), 'utf8')
  assert.match(later, /import\('\.\.\/bonus\/mount\.ts'\)/)
  const mount = readFileSync(new URL('./mount.ts', import.meta.url), 'utf8')
  assert.match(mount, /import\('\.\/BonusHost\.vue'\)/)
  const compact = readFileSync(new URL('../../../ui/compact.css', import.meta.url), 'utf8')
  assert.ok((compact.match(/\.bonus-chip\{display:none\}/g) ?? []).length >= 2)
})

test('the moment runs in order, once: the wallet, the toast, the companion, then the server is told; nothing when there is nothing new', async () => {
  const steps: string[] = []
  const answer = { state: 'paid' as const, amount: 1_000_000, n: 4231, places: 10_000, show: true }
  const deps = (reply: typeof answer | null) => ({
    ask: async (seen?: boolean) => { steps.push(seen ? 'told' : 'asked'); return reply }, refresh: async () => { steps.push('wallet') }, toast: (words: string) => { steps.push(`toast:${words}`) },
    say: (line: { id: string; text: string }) => { steps.push(`say:${line.id}`) }, firstName: () => 'Ada',
  })
  assert.equal(await runMoment(deps(answer)), 'shown')
  assert.deepEqual(steps, ['asked', 'wallet', 'toast:₦1,000,000 launch bonus — you are player #4,231 of the first 10,000', 'say:launch-bonus', 'told'])
  for (const reply of [null, { ...answer, show: false }, { ...answer, state: 'held' as never }]) { steps.length = 0; assert.equal(await runMoment(deps(reply)), 'none'); assert.deepEqual(steps, ['asked']) }
})

// ---- the screens ------------------------------------------------------------------------------------------------------------
const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const render = async (path: string, props: Record<string, unknown> = {}): Promise<string> => { const component = (await load(path)).default; return renderToString(createSSRApp({ render: () => h(component, props) })) }
before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cities = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cities.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the landing line and the guest chip render from the offer, and nothing renders without one', async () => {
  const store = await load<typeof import('./bonusStore.ts')>('/src/app/features/bonus/bonusStore.ts')
  store.bonus.offer = null
  assert.equal(text(await render('/src/app/features/bonus/BonusLine.vue')), '')
  assert.equal(text(await render('/src/app/features/bonus/BonusHost.vue')), '')
  store.bonus.offer = OFFER
  const line = await render('/src/app/features/bonus/BonusLine.vue')
  assert.match(line, /data-bonus-line/)
  assert.equal(text(line), 'Launch bonus: the first 10,000 players to sign up get ₦1,000,000 in the game. 4,230 left.')
  // A guest on a server with accounts, connected, in the venue view, nothing in front.
  const lite = (await load<typeof import('../account/useAccountLite.ts')>('/src/app/features/account/useAccountLite.ts')).useAccountLite()
  Object.assign(lite.state, { loaded: true, enabled: true, account: null })
  const chip = await render('/src/app/features/bonus/BonusHost.vue')
  assert.match(chip, /data-bonus-chip/)
  assert.ok(text(chip).startsWith('Sign up to claim ₦1,000,000 in the game · 4,230 left'))
  assert.match(chip, /data-bonus-signup/); assert.match(chip, /data-bonus-dismiss/)
  Object.assign(lite.state, { account: { email: 'ada@example.com', provider: 'password', createdAt: 1, devices: 1 } })
  assert.equal(text(await render('/src/app/features/bonus/BonusHost.vue')), '', 'not for a signed-in player')
  Object.assign(lite.state, { account: null, enabled: false })
  assert.equal(text(await render('/src/app/features/bonus/BonusHost.vue')), '', 'not on a server without accounts')
  store.bonus.offer = { ...OFFER, left: 0, on: false }
  assert.equal(text(await render('/src/app/features/bonus/BonusLine.vue')), '', 'the line disappears when the offer ends')
  store.bonus.offer = null
})

test('the offer is fetched once a minute, and the claim sends the anti-forgery token and `seen`', async () => {
  const store = await load<typeof import('./bonusStore.ts')>('/src/app/features/bonus/bonusStore.ts')
  const calls: [string, unknown][] = []
  const fetchJson = (async (path: string, init?: { body?: unknown }) => { calls.push([path, init?.body]); return path.endsWith('/world/bonus') ? { on: true, amount: 5, places: 9, left: 9 } : { state: 'paid', amount: 5, n: 1, places: 9, show: true } }) as never
  store.bonus.offer = null; store.bonus.at = 0
  await store.loadOffer(fetchJson, 1000); await store.loadOffer(fetchJson, 1000 + 30000)
  assert.equal(calls.length, 1, 'cached for a minute')
  await store.loadOffer(fetchJson, 1000 + store.OFFER_FRESH_MS + 1)
  assert.equal(calls.length, 2)
  assert.deepEqual(store.bonus.offer, { on: true, amount: 5, places: 9, left: 9 })
  assert.equal((await store.askBonus(fetchJson, 'tok', true))?.state, 'paid')
  assert.deepEqual(calls.at(-1), ['/api/account/bonus', { csrf: 'tok', seen: true }])
  assert.equal(await store.askBonus((async () => { throw new Error('offline') }) as never, 'tok'), null)
  store.bonus.offer = null
})
