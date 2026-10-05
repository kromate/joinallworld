<script setup lang="ts">
// The account section of Settings. Shown only when accounts are configured on this server.
//
//   a guest      what an account is for, and the two ways into it (save this character / sign in)
//   signed in    who is signed in, the set-aside characters, sign out, sign out everywhere, the
//                account's data, and deleting the account
//
// Deleting asks the person to prove who they are again (their password, or Google once more) and
// says exactly what goes: the account, its set-aside characters, and — only if ticked — the
// character in play, which otherwise stays on this device as a guest life.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { PASSWORD_MAX } from './accountModel.ts'
import { ACCOUNT_PANEL } from './register.ts'
import { useAccount } from './useAccount.ts'

const { shell } = useApp()
const account = useAccount()
const state = account.state
const deleting = ref(false)
const erase = ref(false)
const password = ref('')
const googleHost = ref<HTMLElement | null>(null)
const googleFailed = ref(false)
let removeGoogle: (() => void) | null = null

const how = computed(() => (state.account?.provider === 'google' ? 'Google' : 'e-mail and password'))
const devices = computed(() => { const n = state.account?.devices ?? 0; return `${n} ${n === 1 ? 'device' : 'devices'} signed in` })
const when = (at: number): string => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

async function download(): Promise<void> {
  const data = await account.exportData()
  if (!data) return
  const { serverTime: _serverTime, ...kept } = data
  const url = URL.createObjectURL(new Blob([JSON.stringify(kept, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = 'allworld-account.json'
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function askDelete(): Promise<void> {
  deleting.value = true; erase.value = false; password.value = ''; state.error = ''; state.notice = ''
  if (state.account?.provider !== 'google' || !state.googleClientId) return
  await nextTick()
  const host = googleHost.value
  if (!host) return
  try {
    const { loadGoogleIdentity, renderGoogleButton } = await import('./googleButton.ts')
    const api = await loadGoogleIdentity()
    if (googleHost.value !== host) return
    removeGoogle = renderGoogleButton(api, host, state.googleClientId, (credential) => { void account.remove({ credential }, erase.value) })
  } catch { googleFailed.value = true }
}
function cancelDelete(): void { removeGoogle?.(); removeGoogle = null; deleting.value = false; password.value = ''; state.error = '' }
async function confirmDelete(): Promise<void> {
  const typed = password.value
  password.value = ''
  await account.remove({ password: typed }, erase.value)
}
onMounted(() => { void account.load() })
onBeforeUnmount(() => { removeGoogle?.() })
</script>

<template>
  <div v-if="state.loaded && state.enabled" class="account-settings" data-account-settings>
    <h3 class="ui-section">Account</h3>

    <template v-if="!state.account">
      <p class="settings-note">An account is optional. It keeps your character somewhere you can reach from another device; without one, your character lives on this device only.</p>
      <div class="ui-rows">
        <button v-if="state.guest" type="button" class="ui-row" data-account-save @click="shell.open(ACCOUNT_PANEL, { intent: 'save' })"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Save your character</b><small>Sign in or create an account to keep it</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
        <button type="button" class="ui-row" data-account-open @click="shell.open(ACCOUNT_PANEL, { intent: 'sign-in' })"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Sign in</b><small>Play a character you saved before</small></span><span class="ui-row-end"><GameIcon inline name="chevron" /></span></button>
      </div>
    </template>

    <template v-else>
      <div class="ui-rows">
        <div class="ui-row"><span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="id" /></span><span class="ui-row-body"><b>Signed in as {{ state.account.email }}</b><small>With {{ how }} · {{ devices }} · since {{ when(state.account.createdAt) }}</small></span></div>
      </div>
      <p v-if="state.error && !deleting" class="ui-error" role="alert">{{ state.error }}</p>
      <p v-if="state.notice" class="settings-note" role="status">{{ state.notice }}</p>

      <template v-if="state.parked.length">
        <h3 class="ui-section">Set-aside characters</h3>
        <div class="ui-rows">
          <div v-for="item in state.parked" :key="item.id" class="ui-row"><span class="ui-row-body"><b>{{ item.name }}</b><small>Set aside {{ when(item.at) }}</small></span><button type="button" class="ui-button" data-account-play :disabled="state.busy" @click="account.switchTo(item.id)">Play</button></div>
        </div>
        <p class="settings-note">Playing one sets <template v-if="state.character">{{ state.character.name }}</template><template v-else>the character in play</template> aside in its place. Nothing is deleted.</p>
      </template>

      <template v-if="!deleting">
        <div class="ui-rows">
          <button type="button" class="ui-row" data-account-sign-out :disabled="state.busy" @click="account.signOut()"><span class="ui-row-body"><b>Sign out</b><small>On this device only. Your character stays with your account</small></span></button>
          <button type="button" class="ui-row" data-account-everywhere :disabled="state.busy" @click="account.signOutEverywhere()"><span class="ui-row-body"><b>Sign out everywhere else</b><small>End every other device’s sign-in; this one stays</small></span></button>
          <button type="button" class="ui-row" data-account-export :disabled="state.busy" @click="download()"><span class="ui-row-body"><b>Download my account data</b><small>What this server stores about your account</small></span></button>
          <button type="button" class="ui-row" data-account-delete :disabled="state.busy" @click="askDelete()"><span class="ui-row-body"><b>Delete account…</b><small>Asks you to confirm first</small></span></button>
        </div>
      </template>

      <form v-else class="account-delete" data-account-delete-form @submit.prevent="confirmDelete">
        <h3 class="ui-section">Delete your account</h3>
        <p class="settings-note">This removes the account, its sign-in on every device<template v-if="state.parked.length"> and its {{ state.parked.length }} set-aside {{ state.parked.length === 1 ? 'character' : 'characters' }}</template>. It cannot be undone.</p>
        <label class="account-check"><input v-model="erase" type="checkbox" name="erase"> <span>Also erase <b>{{ state.character?.name ?? 'my character' }}</b>. If this is not ticked, the character stays on this device as a guest life.</span></label>
        <p v-if="state.error" class="ui-error" role="alert">{{ state.error }}</p>
        <template v-if="state.account.provider === 'google' && state.googleClientId">
          <p class="settings-note">Confirm with Google to delete the account:</p>
          <div ref="googleHost" class="account-google" data-account-google />
          <p v-if="googleFailed" class="ui-error" role="alert">Google sign-in could not be loaded. Try again later.</p>
        </template>
        <template v-else>
          <label class="account-field">Your password <input v-model="password" type="password" name="password" autocomplete="current-password" :maxlength="PASSWORD_MAX" required></label>
          <button class="ui-button is-danger is-block" data-account-delete-confirm :disabled="state.busy">{{ state.busy ? 'One moment…' : 'Delete my account' }}</button>
        </template>
        <button type="button" class="ui-button is-block" :disabled="state.busy" @click="cancelDelete">Cancel</button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.account-delete { display: grid; gap: var(--s-2); }
.account-check { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.45; }
.account-check input { margin-top: 3px; }
.account-field { display: grid; gap: 4px; font-size: 13px; }
.account-google { display: flex; justify-content: center; min-height: 44px; }
</style>
<style scoped src="../../../ui/panels/settings.css"></style>
