<script setup lang="ts">
// Sign up, log in, or save this device's character to an account.
//   params.intent   'save' | 'sign-in' | 'account'   which the caller offered ('account': the signed-in chip — who, devices, sign out)
//   params.mode     'sign-in' | 'create' | 'reset'   the form to start on (default 'sign-in')
//   params.where    where it was opened from (a word, for the funnel)
//
// An account is optional: "Not now" is always there and a guest keeps playing as before. There are
// two ways in — the Google button, drawn by Google's own script, and an e-mail address with a
// password. The password goes from this form to the sign-in provider and nowhere else; the game
// server is handed a signed token and checks it itself (docs/ACCOUNTS.md).
//
// Every string below is rendered as text. The password field is cleared after every attempt, goes
// back to hidden when the form is sent, and nothing typed here is logged or sent to telemetry.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { NEW_PASSWORD_MIN, PASSWORD_MAX, VERIFY_SENT, devicesText, outcomeText } from './accountModel.ts'
import { useAccount } from './useAccount.ts'
import AccountChoice from './AccountChoice.vue'
import AccountSettings from './AccountSettings.vue'
import PasswordField from './PasswordField.vue'
import BonusLine from '../bonus/BonusLine.vue'

type Mode = 'sign-in' | 'create' | 'reset'
const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const account = useAccount()
const state = account.state

const param = (name: string): unknown => (props.params && typeof props.params === 'object' ? (props.params as Record<string, unknown>)[name] : null)
const asked = param('mode')
const mode = ref<Mode>(asked === 'create' || asked === 'reset' ? asked : 'sign-in')
const viewing = param('intent') === 'account'
const saving = computed(() => param('intent') === 'save' && state.guest)
const email = ref('')
const password = ref('')
const field = ref<InstanceType<typeof PasswordField> | null>(null)
const googleHost = ref<HTMLElement | null>(null)
const googleFailed = ref(false)
let removeGoogle: (() => void) | null = null

const characterName = computed(() => game.state.value.name || 'your character')
const heading = computed(() => (mode.value === 'reset' ? 'Reset your password' : mode.value === 'create' ? 'Create your free account' : 'Log in'))
const lead = computed(() => {
  if (mode.value === 'reset') return 'Enter the e-mail address of your account and we will send a link to choose a new password.'
  if (mode.value === 'create') return saving.value ? `${characterName.value} is kept with your account, so you can play on from any device.` : 'Free. It keeps your character safe, and you can play on from any device.'
  return 'Log in to play your saved character on this device.'
})
const submitLabel = computed(() => (mode.value === 'reset' ? 'Send reset link' : mode.value === 'create' ? 'Create account' : 'Log in'))
const done = computed(() => (state.result ? outcomeText(state.result) : ''))
const devices = computed(() => (state.result ? devicesText(state.result) : ''))
const emailError = computed(() => (state.errorField === 'email' ? state.error : ''))
const passwordError = computed(() => (state.errorField === 'password' ? state.error : ''))
/** An error that is about the whole form rather than one field. */
const formError = computed(() => (state.errorField === '' ? state.error : ''))

function setMode(next: Mode): void { mode.value = next; password.value = ''; field.value?.hide(); state.error = ''; state.errorField = ''; state.notice = '' }
async function submit(): Promise<void> {
  const typed = password.value
  // The field is emptied and hidden before anything is sent: whatever happens next, the password is not left on screen or in this component.
  password.value = ''
  field.value?.hide()
  if (mode.value === 'reset') { if (await account.resetPassword(email.value)) mode.value = 'sign-in'; return }
  await account.withPassword(email.value, typed, mode.value === 'create')
}
/** Back to the form with another address: the sign-in that was waiting is dropped. */
function startOver(): void { account.begin(); setMode(mode.value === 'create' ? 'create' : 'sign-in') }
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

    <template v-else-if="viewing && state.account">
      <div class="account-who" data-account-who>
        <i aria-hidden="true">{{ Array.from(state.character?.name || state.account.email)[0]?.toUpperCase() }}</i>
        <span><b>{{ state.character?.name || 'Your character' }}</b><small>{{ state.account.email }}</small></span>
      </div>
      <AccountSettings />
      <button type="button" class="ui-button is-block" data-account-profile @click="shell.open('sim')">Open my profile</button>
    </template>

    <template v-else-if="state.step === 'form' && state.account">
      <div class="session-card"><h3>You are signed in</h3><p>Signed in as <b>{{ state.account.email }}</b>. Your character is kept with your account.</p></div>
      <button type="button" class="ui-button is-primary is-block" @click="leave">Back to the game</button>
    </template>

    <template v-else-if="state.step === 'form'">
      <div class="session-card"><h3>{{ heading }}</h3><p>{{ lead }}</p></div>
      <BonusLine v-if="mode === 'create'" />
      <p v-if="formError" class="ui-error" role="alert">{{ formError }}</p>
      <p v-if="state.notice" class="account-notice" role="status">{{ state.notice }}</p>
      <template v-if="state.googleClientId && mode !== 'reset'">
        <!-- Google's own script draws its button in here. -->
        <div ref="googleHost" class="account-google" data-account-google />
        <p v-if="googleFailed" class="session-note">Google sign-in could not be loaded. Use your e-mail address below, or try again later.</p>
        <p v-if="mode === 'sign-in'" class="session-note account-lone" data-account-google-note>New here? Google makes your account, and we’ll e-mail you a few times a week at most about your character. You can turn this off any time.</p>
        <p class="account-or" aria-hidden="true"><span>or with your e-mail</span></p>
      </template>
      <form class="session-form" data-account-form novalidate @submit.prevent="submit">
        <div class="account-field" :class="{ 'has-error': Boolean(emailError) }">
          <label for="account-email">E-mail address</label>
          <input id="account-email" v-model="email" type="email" name="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required :aria-invalid="emailError ? 'true' : undefined" :aria-describedby="emailError ? 'account-email-error' : undefined">
          <p v-if="emailError" id="account-email-error" class="account-error" role="alert">{{ emailError }}</p>
        </div>
        <PasswordField v-if="mode !== 'reset'" id="account-password" ref="field" v-model="password" label="Password" :autocomplete="mode === 'create' ? 'new-password' : 'current-password'" :minlength="mode === 'create' ? NEW_PASSWORD_MIN : 1" :maxlength="PASSWORD_MAX" :error="passwordError" :hint="mode === 'create' ? `At least ${NEW_PASSWORD_MIN} characters.` : ''" />
        <button class="ui-button is-primary is-block" data-account-submit :disabled="state.busy">{{ state.busy ? 'One moment…' : submitLabel }}</button>
      </form>
      <p v-if="mode === 'create'" class="session-note account-lone" data-account-mail-note>We'll e-mail you a few times a week at most about your character. You can turn this off any time.</p>
      <p v-if="mode === 'create'" class="session-note account-lone">We will e-mail you a link to confirm the address before anything is saved to it.</p>
      <div class="account-links">
        <button v-if="mode !== 'create'" type="button" class="account-link" data-account-create @click="setMode('create')">Create an account</button>
        <button v-if="mode !== 'sign-in'" type="button" class="account-link" data-account-have @click="setMode('sign-in')">I already have an account</button>
        <button v-if="mode === 'sign-in'" type="button" class="account-link" data-account-forgot @click="setMode('reset')">Forgot your password?</button>
      </div>
      <button type="button" class="ui-button is-block" data-account-later @click="leave">Not now</button>
      <p class="session-note">An account is optional. Without one, your character stays on this device: clearing its cookies, or 30 days without playing, ends it.</p>
    </template>

    <template v-else-if="state.step === 'verify'">
      <div class="account-inbox" data-account-inbox role="status">
        <i aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg></i>
        <h3>Check your inbox</h3>
        <p v-if="state.pendingEmail">We sent a confirmation link to <b class="account-address">{{ state.pendingEmail }}</b>. Open it, then come back here.</p>
        <p v-else>We sent a confirmation link to the address you gave. Open it, then come back here.</p>
        <p class="session-note">Nothing is saved to the account until the address is confirmed. Look in your spam folder if it does not arrive.</p>
      </div>
      <p v-if="state.error" class="ui-error" role="alert">{{ state.error }}</p>
      <p v-if="state.notice && state.notice !== VERIFY_SENT" class="account-notice" role="status">{{ state.notice }}</p>
      <div class="session-actions">
        <button type="button" class="ui-button is-primary is-block" data-account-confirmed :disabled="state.busy" @click="account.confirmed()">I’ve confirmed — continue</button>
        <button type="button" class="ui-button is-block" data-account-resend :disabled="state.busy" @click="account.resendVerification()">Resend e-mail</button>
      </div>
      <div class="account-links">
        <button type="button" class="account-link" data-account-other :disabled="state.busy" @click="startOver">Use a different address</button>
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
.account { display: grid; gap: var(--s-2); width: 100%; max-width: 440px; margin: 0 auto; }
.account-google { display: flex; justify-content: center; min-height: 44px; }
.account-or { display: flex; align-items: center; gap: 10px; margin: 2px 0 !important; font-size: 12px !important; color: var(--c-muted); }
.account-or::before, .account-or::after { content: ''; flex: 1; height: 1px; background: var(--c-line); }
.account-notice { margin: 0 !important; padding: 10px 12px; border-radius: var(--r-sm); background: var(--c-fill); font-size: 13px !important; color: var(--c-ink-2); }
.account-field { display: grid; gap: 4px; }
.account-field label { font-size: 13px; font-weight: 600; color: var(--c-ink-2); }
.account-field.has-error input { border-color: var(--c-red-dark) !important; }
.account-error { margin: 0; font-size: 12px; line-height: 1.4; font-weight: 600; color: var(--c-red-dark); }
.account-lone { margin: 0 !important; }
.account-links { display: flex; flex-wrap: wrap; gap: 4px 16px; justify-content: center; }
.account-link { min-height: var(--tap); padding: 0 4px; border: 0; background: none; font: inherit; font-size: 13px; color: var(--c-green-dark); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.account-link:focus-visible { outline: var(--focus); outline-offset: 2px; }
.account-inbox { display: grid; justify-items: center; gap: 6px; padding: 18px 16px; border-radius: var(--r-md); background: var(--c-green-soft); text-align: center; }
.account-inbox i { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: #fff; color: var(--c-green-dark); box-shadow: var(--e-1); }
.account-inbox h3 { margin: 4px 0 0; font-size: var(--t-title); }
.account-inbox p { margin: 0; font-size: 14px; line-height: 1.45; color: var(--c-ink-2); }
.account-inbox .session-note { margin-top: 4px !important; }
.account-address { overflow-wrap: anywhere; color: var(--c-ink); }
.account-who { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--r-md); background: var(--c-fill); }
.account-who i { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--c-green-dark); color: #fff; font-style: normal; font-weight: 700; font-size: 18px; }
.account-who span { display: grid; min-width: 0; }
.account-who b { font-size: var(--t-lead); }
.account-who small { overflow: hidden; text-overflow: ellipsis; color: var(--c-muted); font-size: 12px; }
</style>
