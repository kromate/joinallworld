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
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
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

async function resetCreator(): Promise<void> {
  const { cr } = await load<{ cr: { draft: unknown; owner: string | null; step: string } }>('/src/app/features/start/creatorState.ts')
  cr.draft = null
  cr.owner = null
}

test('the first screen: full-screen creator with the welcome, the quick characters, the body, the name, Play now and Next', async () => {
  await resetCreator()
  const html = await render('QuickStartApp', { params: { reason: 'new' } })
  const words = text(html)
  assert.match(html, /<div class="cr-root" data-step="who" data-mode="new" data-cr-root>/)
  assert.ok(words.includes('Welcome to Allworld') && words.includes('A digital world you can live in'))
  assert.ok(words.includes('Step 1 of 5 · You'))
  for (const label of ['Street', 'Owambe', 'Office', 'Sporty', 'Chill']) assert.match(html, new RegExp(`aria-label="${label} character"`))
  assert.match(html, /role="group" aria-label="Body"/)
  assert.ok(words.includes('Surprise me') && words.includes('Your name'))
  assert.match(html, /<input[^>]*name="name"[^>]*minlength="3"[^>]*maxlength="24"[^>]*autocomplete="nickname"/)
  assert.match(html, /<button[^>]*data-key="play-now"[^>]*>Play now<\/button>/)
  assert.match(html, /<button[^>]*data-key="primary"[^>]*>Next: Look<\/button>/)
  assert.ok(words.includes('No password, no e-mail.'))
  assert.ok(!html.includes('look-editor'), 'the editor is on the next step')
  assert.ok(!html.includes('sign-in') && !html.includes('I already have'), 'no sign-in button while accounts are not configured')
  for (const control of ['Turn left', 'Turn right', 'Turn around']) assert.ok(html.includes(`aria-label="${control}"`))
  for (const view of ['Body', 'Face', 'Outfit']) assert.ok(words.includes(view))
})

test('the first screen offers play now, sign up and log in only on a server with accounts, and nothing otherwise', async () => {
  await resetCreator()
  const { useAccountLite } = await load<{ useAccountLite: () => { state: { loaded: boolean; enabled: boolean; account: unknown } } }>('/src/app/features/account/useAccountLite.ts')
  const lite = useAccountLite()
  Object.assign(lite.state, { loaded: true, enabled: true, account: null })
  try {
    const html = await render('QuickStartApp', { params: { reason: 'new' } })
    assert.match(html, /<div class="cr-choices" data-cr-choices>/)
    assert.match(html, /<button[^>]*data-key="play-now"[^>]*>Play now<\/button>/)
    assert.match(html, /<button[^>]*data-key="sign-up"[^>]*>Sign up free<span> — keep your character<\/span><\/button>/)
    assert.match(html, /<button[^>]*data-key="sign-in"[^>]*>I already have an account · Log in<\/button>/)
    assert.ok(text(html).includes('Play now needs no password or e-mail.'))
    // Signed in already: the choices step aside.
    Object.assign(lite.state, { account: { email: 'ada@example.com', provider: 'password', createdAt: 0, devices: 1 } })
    assert.ok(!(await render('QuickStartApp', { params: { reason: 'new' } })).includes('data-cr-choices'))
  } finally { Object.assign(lite.state, { loaded: false, enabled: false, account: null }) }
  await resetCreator()
  const plain = await render('QuickStartApp', { params: { reason: 'new' } })
  assert.ok(!plain.includes('data-cr-choices') && !plain.includes('Sign up') && !plain.includes('Log in') && !plain.includes('data-key="sign-in"'), 'no accounts: exactly the guest start')
})

test('the first screen: a refusal of the name comes back with its sentence, and the refused name is in the field as text', async () => {
  await resetCreator()
  const html = await render('QuickStartApp', { params: { reason: 'new', problem: { reason: 'That name is not allowed.', name: '"><b>x</b>' } } })
  assert.match(html, /<p class="cr-banner is-error" role="alert" data-cr-error>That name is not allowed\.<\/p>/)
  assert.ok(html.includes('value="&quot;&gt;&lt;b&gt;x&lt;/b&gt;"') && !html.includes('<b>x</b>'))
})

test('the first screen: "the world is full" is a calm notice, not the red error', async () => {
  await resetCreator()
  const html = await render('QuickStartApp', { params: { reason: 'new', problem: { reason: 'The world is full right now: every place is taken.', name: 'Kunle', calm: true } } })
  assert.match(html, /<p class="cr-banner is-info" role="status" data-cr-error>The world is full right now: every place is taken\.<\/p>/)
  assert.ok(!html.includes('cr-banner is-error'))
})

test('the first screen opened again after a Play that was turned away (the world was full): the sentence is there, and so is Play now', async () => {
  await resetCreator()
  const full = 'The world is full right now: every place is taken. Nothing is lost — your name and character are kept on this device. Trying again in about 10 seconds; tap Play now to try at once.'
  const first = await render('QuickStartApp', { params: { reason: 'new' } })
  assert.match(first, /data-qs="play"/)
  // Play was tapped: the screen closed with the start on its way, and what it remembered of that tap is still there when it is opened again.
  const { cr } = await load<{ cr: { played: boolean; pending: string; settling: boolean; step: string } }>('/src/app/features/start/creatorState.ts')
  Object.assign(cr, { played: true, pending: '', settling: false, step: 'look' })
  const again = await render('QuickStartApp', { params: { reason: 'new', problem: { reason: full } } })
  assert.match(again, /<div class="cr-root" data-step="who" data-mode="new" data-cr-root>/)
  assert.ok(text(again).includes(full))
  assert.match(again, /<button[^>]*data-qs="play"[^>]*>Play now<\/button>/, 'the visitor can tap Play at once, as the sentence says')
  assert.equal(cr.played, false)
})

test('settling in as a guest opens the creator on the personality step, with the reason, the progress and Not now', async () => {
  await resetCreator()
  await withState(guest, async () => {
    const html = await render('OnboardingApp', { params: { nudge: 'first-reward' } })
    const words = text(html)
    assert.match(html, /<div class="cr-root" data-step="spirit" data-mode="settle" data-cr-root>/)
    assert.ok(words.includes('Nice start,') && words.includes('Save this character'))
    assert.ok(words.includes('Step 2 of 4 · Spirit'), 'a guest has a name already: four steps')
    assert.match(html, /<ol class="cr-progress" aria-label="Progress">/)
    assert.equal((html.match(/data-trait="/g) ?? []).length, 10)
    assert.ok(words.includes('2 of 2 chosen.'), 'two traits are chosen for a player who skips the step')
    assert.match(html, /<button[^>]*data-key="later"[^>]*>Not now<\/button>/)
    assert.ok(!html.includes('data-key="play-now"'), 'a guest is already playing')
  })
  await resetCreator()
})

test('a life that finished: its Sim is ready, with a way to edit the look', async () => {
  await resetCreator()
  await withState((state) => ({ ...state, name: 'Ada', onboarding: { ...state.onboarding, done: true, legacy: false, stage: 'settled' } }), async () => {
    const html = await render('OnboardingApp')
    const words = text(html)
    assert.ok(words.includes('Ada is ready') && words.includes('Your Sim has moved in.') && words.includes('You can change your look any time in Sim → Profile.'))
    assert.ok(words.includes('Edit look') && words.includes('Close'))
  })
  await resetCreator()
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
  assert.match(form, /<p class="ui-error" role="alert"[^>]*>Pick another name\.<\/p>/)
  assert.match(form, /<input[^>]*value="Bad"[^>]*name="name"[^>]*minlength="3"[^>]*maxlength="24"[^>]*required/)
  const gone = await render('SessionApp', { params: { reason: 'expired' } })
  const sentence = text(gone)
  assert.ok(sentence.includes('This device’s saved life is no longer on this server'))
  assert.ok(sentence.includes('Start a new life') && sentence.includes('Try again') && sentence.includes('nothing can change'))
  assert.ok(!sentence.includes('offline'), 'it never says offline')
})

// Port of src/ui/panels/session.test.js.
test('fresh and expired entry offer ordinary navigation to the old-character bridge', async () => {
  for (const reason of ['new', 'expired']) {
    const html = await render('SessionApp', { params: { reason } })
    assert.match(html, /href="https:\/\/joinallworld\.com\/old-character\.html"/)
    assert.match(text(html), /separate saves/)
  }
})

test('the account placeholder says accounts are not available', async () => {
  const words = text(await render('AccountApp'))
  assert.equal(words, 'Account Accounts are not available on this server. Your character is saved on this device.')
})


test('a life that never had a character starts the creator on the look, with undo, reset and the whole editor', async () => {
  await resetCreator()
  await withState((state) => ({ ...state, onboarding: { ...state.onboarding, stage: 'settled', done: false, required: false, step: 0, traits: [], dream: null, lottery: null } }), async () => {
    const html = await render('OnboardingApp')
    const words = text(html)
    assert.match(html, /data-step="look" data-mode="settle"/)
    assert.ok(words.includes('Step 1 of 4 · Look') && words.includes('Undo') && words.includes('Reset') && words.includes('Surprise me'))
    assert.match(html, /<button[^>]*data-key="undo"[^>]*disabled/)
    assert.ok(html.includes('look-editor') && !html.includes('data-key="later"'), 'no "Not now" for a life that was not a guest')
  })
  await resetCreator()
})

test('the home step of a life not yet started offers every open state, and the chosen city brings its own local governments', async () => {
  await resetCreator()
  const { cr } = await load<{ cr: { step: string; city: string | null } }>('/src/app/features/start/creatorState.ts')
  const cities = await load<{ loadCityContent(id: string): Promise<unknown> }>('/src/game/cities/registry.ts')
  await cities.loadCityContent('ibadan')
  try {
    await render('QuickStartApp', { params: { reason: 'new' } })
    cr.step = 'home'
    const lagos = await render('QuickStartApp', { params: { reason: 'new' } })
    assert.ok(text(lagos).includes('Lagos State') && text(lagos).includes('Oyo State'), 'both open states are chips')
    assert.ok(text(lagos).includes('local governments of Lagos'))
    cr.city = 'ibadan'
    const ibadan = await render('QuickStartApp', { params: { reason: 'new' } })
    const words = text(ibadan)
    assert.ok(words.includes('11 local governments of Ibadan'), 'the list is the chosen city’s own')
    for (const id of ['akinyele', 'egbeda', 'ibadan-north', 'ibadan-north-east', 'ibadan-north-west', 'ibadan-south-east', 'ibadan-south-west', 'ido', 'lagelu', 'oluyole', 'ona-ara']) assert.ok(ibadan.includes(`data-lga="${id}"`), id)
    assert.ok(!ibadan.includes('data-lga="ikeja"'), 'nothing of Lagos is listed')
    assert.ok(!words.includes('The mainland'), 'an inland city is not split into island and mainland')
  } finally { cr.city = null; cr.step = 'who' }
  await resetCreator()
})

test('the home step: state, city, the starter house, find my area, and the local governments by zone', async () => {
  await resetCreator()
  await withState(guest, async () => {
    const { cr } = await load<{ cr: { step: string } }>('/src/app/features/start/creatorState.ts')
    await render('OnboardingApp')
    cr.step = 'home'
    const html = await render('OnboardingApp')
    const words = text(html)
    assert.ok(words.includes('Step 3 of 4 · Home') && words.includes('Where do you live?'))
    assert.ok(words.includes('Nigeria') && words.includes('Lagos State') && words.includes('More places are opening: Kaduna'))
    assert.ok(words.includes('Your free starter house') && words.includes('No rent'))
    const estate = app.game.view.value.estate
    if (estate.lgas.length) {
      assert.ok(words.includes('Find my area') && words.includes(`Or choose from the ${estate.lgas.length} local governments of ${estate.cityName}`))
      assert.equal((html.match(/data-lga="/g) ?? []).length, estate.lgas.length)
    }
    assert.match(html, /<button[^>]*data-key="primary"[^>]*disabled[^>]*>Next: Ready<\/button>/)
    assert.ok(words.includes('Choose where you live'))
    assert.match(html, /aria-label="Back to Spirit"/)
    assert.ok(!html.includes('Coming soon</button>'), 'places that are not open are text, not controls')
  })
  await resetCreator()
})
