// Component tests for the account screens: each component is compiled by the project's Vite
// configuration and rendered to a string against the real application connected to a fake server.
// What is asserted is what the player reads and can press, the semantics of the password fields,
// and that nothing is shown at all on a server without accounts.
import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'
import type { Account } from './accountStore.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
let account: Account
/** The Settings tab, which carries the account section. */
let awaitedSettings: Component
const realFetch = globalThis.fetch
/** What GET /api/account answers in these tests; a test changes it and loads again. */
let answer: Record<string, unknown> = { enabled: false }
const CONFIGURED = { enabled: true, provider: { apiKey: 'test-web-api-key-0000000000000000000000', googleClientId: '1234567890-testclient.apps.googleusercontent.com' }, csrf: 'csrf-token', guest: true, account: null, character: null, parked: [] }

const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
async function render(name: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(`/src/app/features/account/${name}.vue`)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
async function given(next: Record<string, unknown>): Promise<void> { answer = next; await account.load(true); account.begin() }
const input = (html: string, name: string): string => new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? ''

before(async () => {
  server.route('GET /api/account', () => ({ status: 200, body: answer }))
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  await (await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')).loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
  account = (await load<{ useAccount: () => Account }>('/src/app/features/account/useAccount.ts')).useAccount()
  awaitedSettings = (await load('/src/app/features/sim/SettingsTab.vue')).default
})
beforeEach(() => { app.shell.closeSheet() })
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the sign-in panel is registered behind the landing screen, which stays the gate of a new device', async () => {
  const { ACCOUNT_PANELS, ACCOUNT_PANEL } = await load<{ ACCOUNT_PANELS: readonly { id: string; title: string; placement: string; role?: string; live?: boolean; kind: string; order?: number }[]; ACCOUNT_PANEL: string }>('/src/app/features/account/register.ts')
  assert.deepEqual(ACCOUNT_PANELS.map((panel) => [panel.id, panel.title, panel.placement, panel.role, panel.live, panel.kind]), [['account-sign-in', 'Your account', 'modal', 'session-gate', false, 'vue']])
  assert.equal(ACCOUNT_PANEL, 'account-sign-in')
  assert.ok(app.shell.byId.has('account-sign-in'), 'the application lists it')
  assert.equal(app.shell.sessionGate('new')?.id, 'quick-start', 'a new device still lands on the landing screen')
  assert.equal(app.shell.sessionGate('expired')?.id, 'session')
  assert.equal(app.shell.phoneHosts({ kind: 'panel', id: 'account-sign-in', from: 'phone' }), false, 'it is a sheet of its own, never inside the phone')
})

test('on a server without accounts nothing about them is shown, anywhere', async () => {
  await given({ enabled: false })
  assert.equal(text(await render('AccountSettings')), '', 'Settings has no account section')
  const sheet = text(await render('AccountSignIn', { params: { intent: 'save' } }))
  assert.equal(sheet, 'Accounts are not available here Your progress is saved to this device. Close')
  const html = await render('AccountSignIn')
  assert.ok(!/<input|<form|data-account-google/.test(html), 'no form, no field, no Google button')
  const { useAccountEntry } = await load<{ useAccountEntry: () => { available: boolean; signedIn: boolean; openSignIn(): void; openSignUp(): void; openSave(): void } }>('/src/app/features/start/accountEntry.ts')
  assert.equal(useAccountEntry().available, false)
  // And the Settings tab as a whole still explains the device session.
  const settings = text(await renderToString(createSSRApp({ render: () => h(awaitedSettings) })))
  assert.ok(settings.includes('You are playing as a guest') && !settings.includes('Sign in') && !settings.includes('Save your character'))
})

test('the start screens’ entry: available once the server says so, and it opens the two screens', async () => {
  await given(CONFIGURED)
  const { useAccountEntry } = await load<{ useAccountEntry: () => { available: boolean; signedIn: boolean; openSignIn(): void; openSignUp(): void; openSave(): void } }>('/src/app/features/start/accountEntry.ts')
  const entry = useAccountEntry()
  assert.equal(entry.available, true)
  assert.deepEqual(Object.keys(entry).sort(), ['available', 'openSave', 'openSignIn', 'openSignUp', 'signedIn'])
  assert.equal(entry.signedIn, false)
  entry.openSave()
  assert.deepEqual(app.shell.sheet.value, { kind: 'panel', id: 'account-sign-in', params: { intent: 'save', mode: 'create', where: 'ready' }, from: null })
  entry.openSignUp()
  assert.deepEqual(app.shell.sheet.value, { kind: 'panel', id: 'account-sign-in', params: { intent: 'save', mode: 'create', where: 'creator' }, from: null })
  entry.openSignIn()
  assert.deepEqual(app.shell.sheet.value, { kind: 'panel', id: 'account-sign-in', params: { intent: 'sign-in', mode: 'sign-in', where: 'creator' }, from: null })
  await given({ enabled: false })
  assert.equal(entry.available, false, 'the same object follows the server’s answer')
})

test('save your character: the Google button’s place, an e-mail and password form with the right field semantics, and a way out', async () => {
  await given(CONFIGURED)
  const html = await render('AccountSignIn', { params: { intent: 'save' } })
  const words = text(html)
  assert.ok(words.startsWith('Log in Log in to play your saved character on this device.'), words.slice(0, 160))
  assert.match(html, /<div[^>]*class="account-google"[^>]*data-account-google[^>]*><\/div>/, 'an empty host for Google to draw its own button in')
  assert.ok(!/<button[^>]*>[^<]*Google/i.test(html), 'the page draws no Google-styled button of its own')
  const email = input(html, 'email'), password = input(html, 'password')
  // The eye: a real button, named for what it does, not pressed, and the field keeps the autocomplete a password manager reads.
  assert.match(html, /<button[^>]*type="button"[^>]*data-account-eye[^>]*aria-pressed="false"[^>]*aria-label="Show password"/)
  for (const attribute of ['type="email"', 'autocomplete="username"', 'inputmode="email"', 'autocapitalize="none"', 'spellcheck="false"', 'maxlength="254"', 'required']) assert.ok(email.includes(attribute), `e-mail field: ${attribute}`)
  for (const attribute of ['type="password"', 'autocomplete="current-password"', 'maxlength="128"', 'required']) assert.ok(password.includes(attribute), `password field: ${attribute}`)
  assert.ok(!/value="[^"]/.test(password), 'the password field is never pre-filled')
  assert.match(html, /<button[^>]*data-account-submit[^>]*>Log in<\/button>/)
  for (const control of ['Create an account', 'Forgot your password?', 'Not now']) assert.ok(words.includes(control), control)
  assert.ok(words.includes('An account is optional.'))
  // Sign-in for someone who has no character here: other words, same form.
  await given({ ...CONFIGURED, guest: false })
  assert.ok(text(await render('AccountSignIn', { params: { intent: 'save' } })).startsWith('Log in Log in to play your saved character on this device.'))
  // Creating the account of a guest says what is kept.
  assert.ok(text(await (async () => { await given(CONFIGURED); return render('AccountSignIn', { params: { intent: 'save', mode: 'create' } }) })()).startsWith(`Create your free account ${app.game.state.value.name} is kept with your account, so you can play on from any device.`))
  // Without a Google client id only the e-mail form is offered.
  await given({ ...CONFIGURED, provider: { ...CONFIGURED.provider, googleClientId: '' } })
  assert.ok(!(await render('AccountSignIn')).includes('data-account-google'))
})

test('create account and reset: a new password is announced as one, and a reset asks for the address only', async () => {
  await given(CONFIGURED)
  const create = await render('AccountSignIn', { params: { intent: 'save', mode: 'create' } })
  const password = input(create, 'password')
  for (const attribute of ['type="password"', 'autocomplete="new-password"', 'minlength="6"', 'maxlength="128"']) assert.ok(password.includes(attribute), `new password field: ${attribute}`)
  assert.ok(text(create).includes('Create your free account') && text(create).includes('At least 6 characters.') && text(create).includes('We will e-mail you a link to confirm the address before anything is saved to it.'))
  assert.match(create, /<button[^>]*data-account-submit[^>]*>Create account<\/button>/)
  assert.ok(text(create).includes('I already have an account'))
  const reset = await render('AccountSignIn', { params: { mode: 'reset' } })
  assert.equal(input(reset, 'password'), '', 'no password field on the reset form')
  assert.ok(input(reset, 'email').includes('type="email"'))
  assert.ok(text(reset).startsWith('Reset your password Enter the e-mail address of your account and we will send a link to choose a new password.'))
  assert.match(reset, /<button[^>]*data-account-submit[^>]*>Send reset link<\/button>/)
  assert.ok(!reset.includes('data-account-google'), 'the Google button is not part of a password reset')
})

test('whatever a name or an address contains is rendered as text', async () => {
  const hostile = '<img src=x onerror=alert(1)>'
  await given({ ...CONFIGURED, account: { email: `${hostile}@example.com`, provider: 'password', createdAt: 0, devices: 1 }, character: { id: 'p', name: hostile }, parked: [{ id: 'q', name: hostile, at: 0 }] })
  for (const html of [await render('AccountSettings'), await render('AccountSignIn')]) {
    assert.ok(!html.includes('<img'), 'no element was made from a name or an address')
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  }
  account.state.step = 'choice'; account.state.result = { outcome: 'parked', character: { id: 'p', name: hostile }, parked: { id: 'q', name: hostile, at: 0 }, devices: 1, ended: 0 }
  const choice = await render('AccountSignIn')
  assert.ok(!choice.includes('<img') && choice.includes('&lt;img'))
  account.state.error = hostile; account.state.step = 'form'; account.state.account = null
  assert.ok(!(await render('AccountSignIn')).includes('<img'), 'an error sentence is text too')
})

test('the confirm-your-address notice, the merge choice and the final screen', async () => {
  await given(CONFIGURED)
  account.state.step = 'verify'; account.state.notice = 'We sent a link to your e-mail address. Open it to confirm the address, then come back here.'
  const verify = await render('AccountSignIn', { params: { intent: 'save' } })
  assert.ok(text(verify).startsWith('Check your inbox We sent a confirmation link to the address you gave.'))
  account.state.pendingEmail = 'ada@example.com'
  const named = text(await render('AccountSignIn', { params: { intent: 'save' } }))
  assert.ok(named.includes('Check your inbox We sent a confirmation link to ada@example.com . Open it, then come back here.'), named.slice(0, 200))
  account.state.pendingEmail = ''
  for (const marker of ['data-account-inbox', 'data-account-confirmed', 'data-account-resend', 'data-account-other']) assert.ok(verify.includes(marker), marker)
  for (const label of ['I’ve confirmed — continue', 'Resend e-mail', 'Use a different address', 'Not now']) assert.ok(text(verify).includes(label), label)
  assert.match(verify, /role="status"/)
  assert.ok(!/<input/.test(verify), 'no field on the notice: nothing typed is kept on screen')

  account.state.notice = ''; account.state.step = 'choice'
  account.state.result = { outcome: 'parked', character: { id: 'pub-ada', name: 'Ada' }, parked: { id: 'pub-bola', name: 'Bola', at: 5 }, devices: 2, ended: 0 }
  const choice = await render('AccountSignIn')
  const words = text(choice)
  assert.ok(words.startsWith('Two characters, one to play This account already has a character, and this device had one of its own. Both are kept.'))
  assert.match(choice, /<button[^>]*data-account-keep[^>]*>Keep playing Ada<\/button>/)
  assert.match(choice, /<button[^>]*data-account-switch[^>]*>Play Bola instead<\/button>/)
  assert.ok(words.includes('From your account · in play now') && words.includes('From this device · set aside'))
  assert.ok(words.includes('Nothing is deleted.'))
  assert.match(choice, /role="group" aria-label="Which character to play"/)

  account.state.step = 'done'; account.state.result = { outcome: 'linked', character: { id: 'pub-ada', name: 'Ada' }, parked: null, devices: 1, ended: 0 }
  const done = await render('AccountSignIn')
  assert.equal(text(done), 'Your character is saved Saved. Ada is now kept with your account: sign in on any device to play on. Continue')
  account.state.result = { outcome: 'restored', character: { id: 'pub-ada', name: 'Ada' }, parked: null, devices: 1, ended: 0 }
  assert.equal(text(await render('AccountSignIn')), 'You are signed in Welcome back. This device now plays Ada. Continue')
  // Other devices signed in, and devices this sign-in signed out, are said on the same screen.
  account.state.result = { outcome: 'linked', character: { id: 'pub-ada', name: 'Ada' }, parked: null, devices: 3, ended: 1 }
  const counted = await render('AccountSignIn')
  assert.match(counted, /data-account-devices/)
  assert.ok(text(counted).includes('One other device that was signed in to this account before has been signed out. 3 devices are signed in to this account. If one of them is not yours, use “Sign out everywhere else” in Settings.'))
})

test('Settings, as a guest: what an account is for and the two ways in', async () => {
  await given(CONFIGURED)
  const html = await render('AccountSettings'), words = text(html)
  assert.ok(words.startsWith('Account An account is optional.'))
  assert.match(html, /<button[^>]*data-account-save[^>]*>/); assert.match(html, /<button[^>]*data-account-open[^>]*>/)
  assert.ok(words.includes('Save your character') && words.includes('Log in Play a character you saved before'))
  assert.ok(!words.includes('Sign out') && !words.includes('Delete account'))
  // A browser with no character at all is only offered sign-in.
  await given({ ...CONFIGURED, guest: false })
  assert.ok(!(await render('AccountSettings')).includes('data-account-save'))
  // The Settings tab carries the section, and still explains the device session to a guest.
  await given(CONFIGURED)
  const settings = text(await renderToString(createSSRApp({ render: () => h(awaitedSettings) })))
  assert.ok(settings.includes('You are playing as a guest') && settings.includes('Save your character'))
  assert.ok(!settings.includes('are not part of this build'))
})

test('Settings, signed in: who is signed in, sign out, sign out everywhere, the data, delete, and set-aside characters', async () => {
  await given({ ...CONFIGURED, account: { email: 'ada@example.com', provider: 'password', createdAt: Date.UTC(2026, 0, 5), devices: 2 }, character: { id: 'pub-ada', name: 'Ada' }, parked: [{ id: 'pub-bola', name: 'Bola', at: Date.UTC(2026, 1, 1) }] })
  const html = await render('AccountSettings'), words = text(html)
  assert.ok(words.includes('Signed in as ada@example.com') && words.includes('With e-mail and password · 2 devices signed in'))
  for (const marker of ['data-account-sign-out', 'data-account-everywhere', 'data-account-export', 'data-account-delete', 'data-account-play']) assert.ok(html.includes(marker), marker)
  for (const label of ['Sign out On this device only. Your character stays with your account', 'Sign out everywhere else End every other device’s sign-in (2 devices signed in); this one stays', 'Download my account data', 'Delete account…', 'Set-aside characters', 'Bola', 'Playing one sets Ada aside in its place. Nothing is deleted.']) assert.ok(words.includes(label), label)
  assert.match(html, /data-account-devices/)
  assert.ok(!html.includes('data-account-confirm-form') && !/<input/.test(html), 'what reaches past this device is a second step: no form, no password field, until it is asked for')
  assert.ok(!words.includes('Save your character'))
  const google = text(await (async () => { await given({ ...CONFIGURED, account: { email: 'ada@example.com', provider: 'google', createdAt: 0, devices: 1 }, character: { id: 'pub-ada', name: 'Ada' }, parked: [] }); return render('AccountSettings') })())
  assert.ok(google.includes('With Google · 1 device signed in') && !google.includes('Set-aside characters'))
  // Signed in, the Settings tab no longer calls this a device session with no sign-in.
  const settings = text(await renderToString(createSSRApp({ render: () => h(awaitedSettings) })))
  assert.ok(settings.includes('Signed in as ada@example.com') && !settings.includes('playing as a guest'))
  // The sign-in sheet, opened while signed in, says so instead of offering a form.
  const sheet = await render('AccountSignIn')
  assert.equal(text(sheet), 'You are signed in Signed in as ada@example.com . Your character is kept with your account. Back to the game')
})

test('accounts switched off after this browser signed in: Settings still says who is signed in and offers sign-out, and nothing else', async () => {
  await given({ enabled: false, csrf: 'csrf-token', account: { email: 'ada@example.com', provider: 'password', createdAt: 0, devices: 1 }, character: { id: 'pub-ada', name: 'Ada' } })
  const html = await render('AccountSettings'), words = text(html)
  assert.equal(words, 'Account Signed in as ada@example.com Sign-in is switched off on this server for now. You can keep playing, and you can sign out. Sign out On this device. You will not be able to sign back in until sign-in is switched on again')
  assert.match(html, /<button[^>]*data-account-sign-out/)
  for (const marker of ['data-account-everywhere', 'data-account-export', 'data-account-delete', 'data-account-save', 'data-account-open']) assert.ok(!html.includes(marker), marker)
  const { useAccountEntry } = await load<{ useAccountEntry: () => { available: boolean } }>('/src/app/features/start/accountEntry.ts')
  assert.equal(useAccountEntry().available, false, 'the start screens offer no sign-in')
})

test('the delete step says exactly what is removed and what is not, and claims nothing more', async () => {
  // The step is opened by a tap; its words are checked in the component's own template (a string render cannot tap).
  const { readFile } = await import('node:fs/promises')
  const source = (await readFile(new URL('./AccountSettings.vue', import.meta.url), 'utf8')).replace(/\s+/g, ' ')
  for (const said of ['<strong>Removed:</strong> the account itself (its e-mail address and sign-in), its sign-in on every device', 'This cannot be undone.',
    'Also remove <b>{{ name }}</b>’s saved life from this server. If this is not ticked, {{ name }} stays on this device as a guest life.',
    '<strong>Not removed</strong>, even when that box is ticked: messages {{ name }} already sent to other players, {{ name }}’s place in neighbourhood and other public listings, and one anonymous line in this server’s account history']) assert.ok(source.includes(said), said)
  assert.ok(!/\berase[sd]?\b/i.test(source.replace(/<script[\s\S]*?<\/script>/, '').replace(/name="erase"|v-model="erase"/g, '')), 'the screen does not say "erased" of what partly remains')
  assert.match(source, /autocomplete="current-password"/)
})
