<script setup lang="ts">
// Sign in, or save this device's character to an account.
//   params.intent   'save' | 'sign-in'            which of the two the caller offered (the wording differs)
//   params.mode     'sign-in' | 'create' | 'reset' the form to start on (default 'sign-in')
//
// An account is optional: "Not now" is always there and a guest keeps playing as before. There are
// two ways in — the Google button, drawn by Google's own script, and an e-mail address with a
// password. The password goes from this form to the sign-in provider and nowhere else; the game
// server is handed a signed token and checks it itself (docs/ACCOUNTS.md).
//
// Every string below is rendered as text. The password field is cleared after every attempt, and
// nothing typed here is logged or sent to telemetry.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { NEW_PASSWORD_MIN, PASSWORD_MAX, devicesText, outcomeText } from './accountModel.ts'
import { useAccount } from './useAccount.ts'
import AccountChoice from './AccountChoice.vue'

type Mode = 'sign-in' | 'create' | 'reset'
const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const account = useAccount()
const state = account.state

const param = (name: string): unknown => (props.params && typeof props.params === 'object' ? (props.params as Record<string, unknown>)[name] : null)
const asked = param('mode')
const mode = ref<Mode>(asked === 'create' || asked === 'reset' ? asked : 'sign-in')
const saving = computed(() => param('intent') === 'save' && state.guest)
const email = ref('')
const password = ref('')
const googleHost = ref<HTMLElement | null>(null)
const googleFailed = ref(false)
let removeGoogle: (() => void) | null = null

const heading = computed(() => (mode.value === 'reset' ? 'Reset your password' : mode.value === 'create' ? 'Create your account' : saving.value ? 'Save your character' : 'Sign in'))
const lead = computed(() => {
  if (mode.value === 'reset') return 'Enter the e-mail address of your account and we will send a link to choose a new password.'
  if (saving.value) return `Sign in or create an account, and ${game.state.value.name || 'your character'} is kept with it: lose this device and you can still play on.`
  return 'Sign in to play your saved character on this device.'
})
const submitLabel = computed(() => (mode.value === 'reset' ? 'Send reset link' : mode.value === 'create' ? 'Create account' : 'Sign in'))
const done = computed(() => (state.result ? outcomeText(state.result) : ''))
const devices = computed(() => (state.result ? devicesText(state.result) : ''))

function setMode(next: Mode): void { mode.value = next; password.value = ''; state.error = ''; state.notice = '' }
async function submit(): Promise<void> {
  const typed = password.value
  // The field is emptied before anything is sent: whatever happens next, the password is not left on screen or in this component.
  password.value = ''
  if (mode.value === 'reset') { if (await account.resetPassword(email.value)) mode.value = 'sign-in'; return }
  await account.withPassword(email.value, typed, mode.value === 'create')
}
/** Back to the form with another address: the sign-in that was waiting is dropped. */
function startOver(): void { account.begin(); setMode('sign-in') }
/** "Not now": back to wherever the player was — the landing screen of a new device, or the game. */
function leave(): void {
  shell.close()
  if (game.link.value === 'new') { const gate = shell.sessionGate('new'); if (gate) shell.open(gate.id, { reason: 'new' }) }
  shell.enforceRequired()
}

/** Draw the Google button once there is somewhere to put it. Its script is fetched here, never before. */
async function showGoogle(): Promise<void> {
  removeGoogle?.(); removeGoogle = null
  const host = googleHost.value, clientId = state.googleClientId
  if (!host || !clientId || state.step !== 'form') return
  try {
    const { loadGoogleIdentity, renderGoogleButton } = await import('./googleButton.ts')
    const api = await loadGoogleIdentity()
    if (googleHost.value !== host || state.step !== 'form') return
    removeGoogle = renderGoogleButton(api, host, clientId, (credential) => { void account.withGoogle(credential) })
    googleFailed.value = false
  } catch { googleFailed.value = true }
}
onMounted(async () => { account.begin(); await account.load(); await nextTick(); void showGoogle() })
watch(() => [state.step, state.googleClientId, mode.value], () => { void nextTick(showGoogle) })
onBeforeUnmount(() => {
  removeGoogle?.()
  // Once a sign-in went through, this browser's cookie is a new one: however the sheet is left, the page starts again with it.
  if (state.step === 'done' || state.step === 'choice') account.continueToGame()
})
</script>

<template>
  <div class="account" data-account-sign-in>
    <p v-if="!state.loaded" class="session-note">Checking this server…</p>
    <template v-else-if="!state.enabled">
      <div class="session-card"><h3>Accounts are not available here</h3><p>Your progress is saved to this device.</p></div>
      <button type="button" class="ui-button is-block" @click="leave">Close</button>
    </template>

    <template v-else-if="state.step === 'form' && state.account">
      <div class="session-card"><h3>You are signed in</h3><p>Signed in as <b>{{ state.account.email }}</b>. Your character is kept with your account.</p></div>
      <button type="button" class="ui-button is-primary is-block" @click="leave">Back to the game</button>
    </template>

    <template v-else-if="state.step === 'form'">
      <div class="session-card"><h3>{{ heading }}</h3><p>{{ lead }}</p></div>
      <p v-if="state.error" class="ui-error" role="alert">{{ state.error }}</p>
      <p v-if="state.notice" class="account-notice" role="status">{{ state.notice }}</p>
      <template v-if="state.googleClientId && mode !== 'reset'">
        <!-- Google's own script draws its button in here. -->
        <div ref="googleHost" class="account-google" data-account-google />
        <p v-if="googleFailed" class="session-note">Google sign-in could not be loaded. Use your e-mail address below, or try again later.</p>
        <p class="account-or" aria-hidden="true">or</p>
      </template>
      <form class="session-form" data-account-form @submit.prevent="submit">
        <label>E-mail address <input v-model="email" type="email" name="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required></label>
        <label v-if="mode !== 'reset'">Password <input v-model="password" type="password" name="password" :autocomplete="mode === 'create' ? 'new-password' : 'current-password'" :minlength="mode === 'create' ? NEW_PASSWORD_MIN : 1" :maxlength="PASSWORD_MAX" required></label>
        <p v-if="mode === 'create'" class="session-note">At least {{ NEW_PASSWORD_MIN }} characters. We will e-mail you a link to confirm the address before anything is saved to it.</p>
        <button class="ui-button is-primary is-block" data-account-submit :disabled="state.busy">{{ state.busy ? 'One moment…' : submitLabel }}</button>
      </form>
      <div class="account-links">
        <button v-if="mode !== 'create'" type="button" class="account-link" data-account-create @click="setMode('create')">Create an account</button>
        <button v-if="mode !== 'sign-in'" type="button" class="account-link" data-account-have @click="setMode('sign-in')">I already have an account</button>
        <button v-if="mode !== 'reset'" type="button" class="account-link" data-account-forgot @click="setMode('reset')">Forgot your password?</button>
      </div>
      <button type="button" class="ui-button is-block" data-account-later @click="leave">Not now</button>
      <p class="session-note">An account is optional. Without one, your character stays on this device: clearing its cookies, or 30 days without playing, ends it.</p>
    </template>

    <template v-else-if="state.step === 'verify'">
      <div class="session-card"><h3>Confirm your e-mail address</h3><p>We sent a link to the address you gave. Open it, then come back here. Nothing is saved to the account until the address is confirmed.</p></div>
      <p v-if="state.error" class="ui-error" role="alert">{{ state.error }}</p>
      <p v-if="state.notice" class="account-notice" role="status">{{ state.notice }}</p>
      <div class="session-actions">
        <button type="button" class="ui-button is-primary is-block" data-account-confirmed :disabled="state.busy" @click="account.confirmed()">I have confirmed it</button>
        <button type="button" class="ui-button is-block" data-account-resend :disabled="state.busy" @click="account.resendVerification()">Send the link again</button>
        <button type="button" class="ui-button is-block" :disabled="state.busy" @click="startOver">Use a different address</button>
      </div>
      <p class="session-note">You can keep playing meanwhile: close this and come back from Settings when the address is confirmed.</p>
      <button type="button" class="ui-button is-block" @click="leave">Not now</button>
    </template>

    <AccountChoice v-else-if="state.step === 'choice'" />

    <template v-else>
      <div class="session-card"><h3>{{ state.result?.outcome === 'linked' ? 'Your character is saved' : 'You are signed in' }}</h3><p>{{ done }}</p><p v-if="devices" data-account-devices>{{ devices }}</p></div>
      <button type="button" class="ui-button is-primary is-block" data-account-continue @click="account.continueToGame()">Continue</button>
    </template>
  </div>
</template>

<style scoped>
.account { display: grid; gap: var(--s-2); }
.account-google { display: flex; justify-content: center; min-height: 44px; }
.account-or { margin: 0 !important; text-align: center; font-size: 12px !important; color: var(--c-muted); }
.account-notice { margin: 0 !important; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-fill); font-size: 13px !important; color: var(--c-ink-2); }
.account-links { display: flex; flex-wrap: wrap; gap: 4px 16px; justify-content: center; }
.account-link { min-height: var(--tap); padding: 0 4px; border: 0; background: none; font: inherit; font-size: 13px; color: var(--c-green-dark); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.account-link:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
