<script setup lang="ts">
// The account section of Settings. Shown only when accounts are configured on this server — or,
// when they have been switched off since, to a browser that is still signed in, which is told so
// and can sign out.
//
//   a guest      what an account is for, and the two ways into it (save this character / sign in)
//   signed in    who is signed in and on how many devices, the set-aside characters, sign out,
//                sign out everywhere else, the account's data, and deleting the account
//
// Signing this browser out needs nothing more. Everything that reaches further — ending other
// devices' sign-ins, downloading the account's data, bringing a set-aside character into play,
// deleting — first asks the person to prove who they are again (their password, or Google once
// more): the server takes a fresh sign-in for those, never this browser's cookie alone.
//
// Deleting says exactly what goes and what stays.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import PasswordField from './PasswordField.vue'
import { PASSWORD_MAX } from './accountModel.ts'
import type { Reauth } from './accountStore.ts'
import { openLogin, openSignup } from './accountOpen.ts'
import { useAccount } from './useAccount.ts'

/** What is waiting for the person to prove who they are. */
type Pending = { kind: 'everywhere' } | { kind: 'export' } | { kind: 'switch'; id: string; name: string } | { kind: 'delete' }
const { shell } = useApp()
const account = useAccount()
const state = account.state
const pending = ref<Pending | null>(null)
const erase = ref(false)
const password = ref('')
const field = ref<InstanceType<typeof PasswordField> | null>(null)
const googleHost = ref<HTMLElement | null>(null)
const googleFailed = ref(false)
let removeGoogle: (() => void) | null = null

const how = computed(() => (state.account?.provider === 'google' ? 'Google' : 'e-mail and password'))
const withGoogle = computed(() => state.account?.provider === 'google' && Boolean(state.googleClientId))
const devices = computed(() => { const n = state.account?.devices ?? 0; return `${n} ${n === 1 ? 'device' : 'devices'} signed in` })
const name = computed(() => state.character?.name ?? 'your character')
const when = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const heading = computed(() => {
  const waiting = pending.value
  if (!waiting) return ''
  if (waiting.kind === 'delete') return 'Delete your account'
  if (waiting.kind === 'everywhere') return 'Sign out everywhere else'
  if (waiting.kind === 'export') return 'Download my account data'
  return `Play ${waiting.name}`
})
const confirmLabel = computed(() => (pending.value?.kind === 'delete' ? 'Delete my account' : 'Confirm'))

function save(data: object): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = 'allworld-account.json'
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
/** Do what was waiting, now that the person has proved who they are. */
async function run(reauth: Reauth): Promise<void> {
  const waiting = pending.value
  if (!waiting) return
  let done = false
  if (waiting.kind === 'everywhere') done = await account.signOutEverywhere(reauth)
  else if (waiting.kind === 'switch') done = await account.switchTo(waiting.id, reauth)
  else if (waiting.kind === 'delete') done = await account.remove(reauth, erase.value)
  else { const data = await account.exportData(reauth); if (data) { const { serverTime: _serverTime, ...kept } = data; save(kept); done = true } }
  if (done) cancel()
}
async function ask(next: Pending): Promise<void> {
  cancel()
  pending.value = next; erase.value = false; state.error = ''; state.notice = ''
  if (!withGoogle.value) return
  await nextTick()
  const host = googleHost.value
  if (!host) return
  try {
    const { loadGoogleIdentity, renderGoogleButton } = await import('./googleButton.ts')
    const api = await loadGoogleIdentity()
    if (googleHost.value !== host) return
    removeGoogle = renderGoogleButton(api, host, state.googleClientId, (credential) => { void run({ credential }) })
  } catch { googleFailed.value = true }
}
function cancel(): void { removeGoogle?.(); removeGoogle = null; pending.value = null; password.value = ''; state.error = ''; googleFailed.value = false }
async function confirm(): Promise<void> {
  const typed = password.value
  // The field is emptied before anything is sent.
  password.value = ''
  field.value?.hide()
  await run({ password: typed })
}
onMounted(() => { void account.load() })
onBeforeUnmount(() => { removeGoogle?.() })
</script>

<template>
  <!-- Accounts were switched off on this server after this browser signed in: it keeps playing, and it can still sign out. -->
  <div v-if="state.loaded && !state.enabled && state.account" class="account-settings" data-account-settings>
    <h3 class="ui-section">Account</h3>
    <div class="ui-rows">
      <div class="ui-row"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Signed in as {{ state.account.email }}</b><small>Sign-in is switched off on this server for now. You can keep playing, and you can sign out.</small></span></div>
      <button type="button" class="ui-row" data-account-sign-out :disabled="state.busy" @click="account.signOut()"><span class="ui-row-body"><b>Sign out</b><small>On this device. You will not be able to sign back in until sign-in is switched on again</small></span></button>
    </div>
    <p v-if="state.error" class="ui-error" role="alert">{{ state.error }}</p>
  </div>

  <div v-else-if="state.loaded && state.enabled" class="account-settings" data-account-settings>
    <h3 class="ui-section">Account</h3>

    <template v-if="!state.account">
      <p class="settings-note">An account is optional. It keeps your character somewhere you can reach from another device; without one, your character lives on this device only.</p>
      <div class="ui-rows">
        <button v-if="state.guest" type="button" class="ui-row" data-account-save @click="openSignup(shell, 'settings')"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Save your character</b><small>Sign in or create an account to keep it</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
        <button type="button" class="ui-row" data-account-open @click="openLogin(shell, 'settings')"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Log in</b><small>Play a character you saved before</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
      </div>
    </template>

    <template v-else>
      <div class="ui-rows">
        <div class="ui-row"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Signed in as {{ state.account.email }}</b><small data-account-devices>With {{ how }} · {{ devices }} · since {{ when(state.account.createdAt) }}</small></span></div>
      </div>
      <p v-if="state.error && !pending" class="ui-error" role="alert">{{ state.error }}</p>
      <p v-if="state.notice" class="settings-note" role="status">{{ state.notice }}</p>

      <template v-if="!pending">
        <template v-if="state.parked.length">
          <h3 class="ui-section">Set-aside characters</h3>
          <div class="ui-rows">
            <div v-for="item in state.parked" :key="item.id" class="ui-row"><span class="ui-row-body"><b>{{ item.name }}</b><small>Set aside {{ when(item.at) }}</small></span><button type="button" class="ui-button" data-account-play :disabled="state.busy" @click="ask({ kind: 'switch', id: item.id, name: item.name })">Play</button></div>
          </div>
          <p class="settings-note">Playing one sets {{ name }} aside in its place. Nothing is deleted.</p>
        </template>
        <div class="ui-rows">
          <button type="button" class="ui-row" data-account-sign-out :disabled="state.busy" @click="account.signOut()"><span class="ui-row-body"><b>Sign out</b><small>On this device only. Your character stays with your account</small></span></button>
          <button type="button" class="ui-row" data-account-everywhere :disabled="state.busy" @click="ask({ kind: 'everywhere' })"><span class="ui-row-body"><b>Sign out everywhere else</b><small>End every other device’s sign-in ({{ devices }}); this one stays</small></span></button>
          <button type="button" class="ui-row" data-account-export :disabled="state.busy" @click="ask({ kind: 'export' })"><span class="ui-row-body"><b>Download my account data</b><small>What this server stores about your account</small></span></button>
          <button type="button" class="ui-row" data-account-delete :disabled="state.busy" @click="ask({ kind: 'delete' })"><span class="ui-row-body"><b>Delete account…</b><small>Says what goes and what stays, then asks you to confirm</small></span></button>
        </div>
      </template>

      <form v-else class="account-confirm" data-account-confirm-form @submit.prevent="confirm">
        <h3 class="ui-section">{{ heading }}</h3>
        <template v-if="pending.kind === 'delete'">
          <p class="settings-note"><strong>Removed:</strong> the account itself (its e-mail address and sign-in), its sign-in on every device<template v-if="state.parked.length">, and its {{ state.parked.length }} set-aside {{ state.parked.length === 1 ? 'character' : 'characters' }}</template>. This cannot be undone.</p>
          <label class="account-check"><input v-model="erase" type="checkbox" name="erase"> <span>Also remove <b>{{ name }}</b>’s saved life from this server. If this is not ticked, {{ name }} stays on this device as a guest life.</span></label>
          <p class="settings-note" data-account-remains><strong>Not removed</strong>, even when that box is ticked: messages {{ name }} already sent to other players, {{ name }}’s place in neighbourhood and other public listings, and one anonymous line in this server’s account history (what happened and when — no address). To have those removed too, use Report a problem.</p>
        </template>
        <p v-else-if="pending.kind === 'switch'" class="settings-note">{{ pending.name }} comes into play and {{ name }} is set aside in its place. Nothing is deleted.</p>
        <p v-else-if="pending.kind === 'everywhere'" class="settings-note">Every other device signed in to this account is signed out. This one stays signed in.</p>
        <p v-else class="settings-note">A file with what this server stores about your account: its address, when you signed in and from how many devices, your characters’ names, and the account history.</p>
        <p v-if="state.error" class="ui-error" role="alert">{{ state.error }}</p>
        <template v-if="withGoogle">
          <p class="settings-note">Confirm it is you with Google:</p>
          <div ref="googleHost" class="account-google" data-account-google />
          <p v-if="googleFailed" class="ui-error" role="alert">Google sign-in could not be loaded. Try again later.</p>
        </template>
        <template v-else>
          <PasswordField id="account-confirm-password" ref="field" v-model="password" label="Confirm it is you: your password" autocomplete="current-password" :maxlength="PASSWORD_MAX" />
          <button class="ui-button is-block" :class="pending.kind === 'delete' ? 'is-danger' : 'is-primary'" data-account-confirm :disabled="state.busy">{{ state.busy ? 'One moment…' : confirmLabel }}</button>
        </template>
        <button type="button" class="ui-button is-block" :disabled="state.busy" @click="cancel">Cancel</button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.account-confirm { display: grid; gap: var(--s-2); }
.account-check { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45; }
.account-check input { margin-top: 3px; }
.account-field { display: grid; gap: 4px; font-size: 13px; }
.account-google { display: flex; justify-content: center; min-height: 44px; }
</style>
<style scoped src="../../../ui/panels/settings.css"></style>
