// Component tests for the start and identity panels: each component is compiled by the project's
// Vite configuration and rendered to a string against the real store connected to a fake server.
// What is asserted is what the player reads and can press, and the registered metadata.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LifeState } from '../../../types/life.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(name: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(`/src/app/features/start/${name}.vue`)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
/** Run `check` with the life changed the way `change` says, then put it back. */
async function withState<T>(change: (state: LifeState) => LifeState, check: () => Promise<T>): Promise<T> {
  const before = app.game.state.value
  app.game.state.value = change(before)
  try { return await check() } finally { app.game.state.value = before }
}
const guest = (state: LifeState): LifeState => ({ ...state, onboarding: { ...state.onboarding, stage: 'guest', done: false, required: false, step: 1, lottery: null, traits: [], dream: null } })

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the registered panels carry the metadata of the existing ones', async () => {
  const { START_PANELS } = await load<{ START_PANELS: readonly { id: string; title: string; placement: string; role?: string; live?: boolean; kind: string; required?: (...args: never[]) => unknown }[] }>('/src/app/features/start/register.ts')
  assert.deepEqual(START_PANELS.map((panel) => [panel.id, panel.title, panel.placement, panel.role ?? null, panel.live ?? true]), [
    ['quick-start', 'Welcome to Allworld', 'modal', 'session-gate', false],
    ['onboarding', 'Make this life yours', 'modal', null, false],
    ['session', 'Your city life', 'modal', 'session-gate', false],
    ['account', 'Account', 'modal', null, true],
  ])
  assert.ok(START_PANELS.every((panel) => panel.kind === 'vue'))
  const gate = START_PANELS.find((panel) => panel.id === 'quick-start')
  const view = app.game.view.value
  const required = gate?.required as ((state: LifeState, view: unknown) => string | null | undefined) | undefined
  assert.equal(required?.(app.game.state.value, { ...view, connected: true, onboarding: { ...view.onboarding, required: true } }), 'Choose your look and tap Play to start.')
  assert.equal(required?.(app.game.state.value, { ...view, connected: true, onboarding: { ...view.onboarding, required: false } }), null)
})

test('the landing screen: the lead, the quick characters, the body toggle, the name and one Play', async () => {
  const html = await render('QuickStartApp', { params: { reason: 'new' } })
  const words = text(html)
  assert.ok(words.startsWith('Jump into a Nigerian world with your friends. Start playing in seconds. Build your life as you go.'))
  for (const label of ['Street', 'Owambe', 'Office', 'Sporty', 'Chill']) assert.match(html, new RegExp(`aria-label="${label} character"`))
  assert.match(html, /role="group" aria-label="Body"/)
  assert.ok(words.includes('Shuffle') && words.includes('More options') && words.includes('Your name'))
  assert.match(html, /<input[^>]*name="name"[^>]*minlength="3"[^>]*maxlength="24"[^>]*autocomplete="nickname"/)
  assert.match(html, /<button[^>]*class="ui-button is-primary qs-play"[^>]*>Play<\/button>/)
  assert.ok(words.includes('No password, no e-mail. You can change everything later.'))
  assert.ok(!html.includes('look-editor'), 'the full creator is behind "More options"')
  assert.match(html, /aria-pressed="true"/, 'one preset is chosen')
})

test('the landing screen: a refusal of the name comes back with its sentence, and the refused name is in the field as text', async () => {
  const html = await render('QuickStartApp', { params: { reason: 'new', problem: { reason: 'That name is not allowed.', name: '"><b>x</b>' } } })
  assert.match(html, /<p class="qs-error" role="alert">That name is not allowed\.<\/p>/)
  assert.ok(html.includes('value="&quot;&gt;&lt;b&gt;x&lt;/b&gt;"') && !html.includes('<b>x</b>'))
})

test('the settle-in sheet of a guest: the reason it opened, the step, the progress and the card\'s one action', async () => {
  await withState(guest, async () => {
    const html = await render('OnboardingApp', { params: { nudge: 'first-reward' } })
    const words = text(html)
    assert.match(html, /<div class="ob-root" data-step="1">/)
    assert.ok(words.includes('Nice start,') && words.includes('Save this character'))
    assert.ok(words.includes('Step 1 of 4 · Personality'))
    assert.match(html, /<ol class="ob-steps" aria-label="Progress">/)
    assert.equal((html.match(/<li class="[^"]*"/g) ?? []).length, 4, 'a guest\'s look is already chosen: four numbered steps')
    assert.ok(words.includes('Pick 2 traits — each one is a boost.'))
    assert.equal((html.match(/data-trait="/g) ?? []).length, 10)
    assert.match(html, /<button[^>]*class="ui-button is-primary ob-primary"[^>]*disabled[^>]*>Choose 2 more<\/button>/)
    assert.ok(words.includes('0 of 2 traits chosen.'))
    assert.match(html, /<button[^>]*class="ui-button ob-later"[^>]*>Not now — keep playing<\/button>/)
    assert.ok(!html.includes('class="sheet-back"'), 'no way back from the first card of a guest')
  })
})

test('the settle-in sheet of a life that finished: its Sim is ready, with a way to edit the look', async () => {
  await withState((state) => ({ ...state, name: 'Ada', onboarding: { ...state.onboarding, done: true, legacy: false, stage: 'settled' } }), async () => {
    const html = await render('OnboardingApp')
    const words = text(html)
    assert.match(html, /<div class="ob-root ob-done">/)
    assert.ok(words.includes('Ada is ready') && words.includes('Your Sim has moved in.') && words.includes('You can change your look any time in Sim → Profile.'))
    assert.ok(words.includes('Edit look') && words.includes('Close'))
  })
})

test('the look editor: tabs, the open tab\'s options, locked styles say where they are sold, colours are free', async () => {
  const { starterWardrobe } = await load<{ starterWardrobe: () => unknown }>('/src/app/features/start/lookModel.ts')
  const look = app.game.state.value.onboarding.look
  const html = await render('LookEditor', { look, owned: starterWardrobe() })
  const words = text(html)
  assert.match(html, /role="tablist" aria-label="What to change"/)
  for (const tab of ['Body', 'Hair', 'Outfit', 'Colours', 'Extras']) assert.ok(words.includes(tab))
  assert.ok(words.includes('Body type') && words.includes('Skin tone') && words.includes('Face shape') && words.includes('Expression'))
  assert.equal((html.match(/data-look="skin"/g) ?? []).length, 7)
  assert.match(html, /aria-label="Skin tone: Light brown"/)
  assert.match(html, /<button[^>]*role="tab"[^>]*aria-selected="true"/)
})

test('the flat figure is drawn from shapes with a text alternative, and the stage says it is loading', async () => {
  const look = app.game.state.value.onboarding.look
  const figure = await render('AvatarFigure', { look, size: 30, label: 'Ada' })
  assert.match(figure, /<svg class="look-avatar" role="img" aria-label="Ada" viewBox="0 0 120 190" width="30" height="48">/i)
  assert.ok((figure.match(/<(?:path|circle|rect|ellipse)\b/g) ?? []).length > 10)
  const stage = await render('LookStage', { look, variant: 'hero', name: 'Ada' })
  assert.match(stage, /class="look-stage" data-look-stage data-mode="loading"/)
  assert.ok(text(stage).includes('Drag to spin') && text(stage).includes('Face'))
  const mini = await render('LookStage', { look, variant: 'mini' })
  assert.ok(!mini.includes('look-bar') && !mini.includes('Drag to spin'))
})

test('the session sheet: a nickname form for a new device, the reason in words when the saved life is gone', async () => {
  const form = await render('SessionApp', { params: { reason: 'new', problem: { reason: 'Pick another name.', name: 'Bad' } } })
  const words = text(form)
  assert.ok(words.includes('Start your city life') && words.includes('There is no password and no e-mail'))
  assert.match(form, /<p class="ui-error" role="alert">Pick another name\.<\/p>/)
  assert.match(form, /<input[^>]*value="Bad"[^>]*name="name"[^>]*minlength="3"[^>]*maxlength="24"[^>]*required/)
  const gone = await render('SessionApp', { params: { reason: 'expired' } })
  const sentence = text(gone)
  assert.ok(sentence.includes('This device’s saved life is no longer on this server'))
  assert.ok(sentence.includes('Start a new life') && sentence.includes('Try again') && sentence.includes('nothing can change'))
  assert.ok(!sentence.includes('offline'), 'it never says offline')
})

test('the account placeholder says accounts are not available', async () => {
  const words = text(await render('AccountApp'))
  assert.equal(words, 'Account Accounts are not available yet. Your progress is saved to this device session.')
})

test('the Look card of a life that was never a guest: the creator with Shuffle and Undo, and the first action', async () => {
  const { ob } = await load<{ ob: { draft: unknown; shown: number } }>('/src/app/features/start/onboardingState.ts')
  ob.draft = null
  await withState((state) => ({ ...state, onboarding: { ...state.onboarding, stage: 'settled', done: false, required: false, step: 0, traits: [], dream: null, lottery: null } }), async () => {
    const html = await render('OnboardingApp')
    const words = text(html)
    assert.match(html, /<div class="ob-root" data-step="0">/)
    assert.ok(words.includes('Step 1 of 5 · Look') && words.includes('Shuffle') && words.includes('Undo'))
    assert.match(html, /<button[^>]*data-key="undo"[^>]*disabled[^>]*aria-label="Undo the last shuffle"/)
    assert.ok(words.includes('Looks good — next: personality') && words.includes('Still to choose: 2 traits, a dream, the birth lottery and a home.'))
    assert.ok(html.includes('look-editor') && !html.includes('Not now'), 'no "Not now" for a life that was not a guest')
  })
  ob.draft = null
})

test('the Home card: the free starter house, the local government choice that rides with the move-in, and what is missing', async () => {
  const { ob } = await load<{ ob: { draft: unknown; shown: number } }>('/src/app/features/start/onboardingState.ts')
  ob.draft = null
  await withState(guest, async () => {
    await render('OnboardingApp')
    ob.shown = 4
    const html = await render('OnboardingApp')
    const words = text(html)
    assert.ok(words.includes('Step 4 of 4 · Home') && words.includes('Your own house — free, furnished, with your start cash.'))
    assert.ok(words.includes('Starter house') && words.includes('no rent') && words.includes('Prefer to rent?'))
    assert.match(html, /data-extra-root="area"/)
    const estate = app.game.view.value.estate
    if (estate.lgas.length) assert.ok(words.includes(`Or choose from the ${estate.lgas.length} local governments of ${estate.cityName}`) && words.includes('Find my local government'))
    assert.match(html, /<button[^>]*class="ui-button is-primary ob-primary"[^>]*disabled[^>]*>Choose your local government<\/button>/)
    assert.ok(words.includes('Choose your local government to continue.'))
    assert.match(html, /aria-label="Back to Birth lottery"/)
  })
  ob.draft = null
})
