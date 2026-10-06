<script setup lang="ts">
// The admin address's sign-in: Google, or an e-mail address and password, through the same account store the game uses (one provider, one
// server route). A sign-in here binds a session to THIS host only (the cookie is host-only), so it never signs anyone in on the game.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Account } from '../app/features/account/accountStore.ts'

const props = defineProps<{ account: Account }>()
const state = props.account.state
const email = ref(''), password = ref(''), show = ref(false), mode = ref<'in' | 'reset'>('in')
const googleHost = ref<HTMLElement | null>(null), googleFailed = ref(false)
let removeGoogle: (() => void) | null = null

async function showGoogle(): Promise<void> {
  removeGoogle?.(); removeGoogle = null
  const host = googleHost.value, clientId = state.googleClientId
  if (!host || !clientId || state.step !== 'form') return
  try {
    const { loadGoogleIdentity, renderGoogleButton } = await import('../app/features/account/googleButton.ts')
    const api = await loadGoogleIdentity()
    if (googleHost.value !== host || state.step !== 'form') return
    removeGoogle = renderGoogleButton(api, host, clientId, (credential) => { void props.account.withGoogle(credential) })
    googleFailed.value = false
  } catch { googleFailed.value = true }
}
async function submit(): Promise<void> {
  const typed = password.value
  password.value = ''; show.value = false
  if (mode.value === 'reset') { if (await props.account.resetPassword(email.value)) mode.value = 'in'; return }
  await props.account.withPassword(email.value, typed, false)
}
onMounted(async () => { props.account.begin(); await nextTick(); void showGoogle() })
watch(() => [state.step, state.googleClientId, mode.value], () => { void nextTick(showGoogle) })
onBeforeUnmount(() => removeGoogle?.())
</script>

<template>
  <main class="ah-center">
    <section class="ah-card" aria-labelledby="ah-title">
      <h1 id="ah-title">Allworld staff</h1>
      <p class="ah-lead">{{ mode === 'reset' ? 'Enter the address of your account and we will send a link to choose a new password.' : 'Sign in with the account that has admin rights.' }}</p>
      <template v-if="state.step === 'verify'">
        <p role="status">We sent a confirmation link to <b>{{ state.pendingEmail }}</b>. Open it, then continue.</p>
        <p v-if="state.error" class="ah-error" role="alert">{{ state.error }}</p>
        <button type="button" class="ah-primary" :disabled="state.busy" @click="account.confirmed()">I have confirmed, continue</button>
        <button type="button" class="ah-link" :disabled="state.busy" @click="account.resendVerification()">Send the e-mail again</button>
      </template>
      <template v-else>
        <p v-if="state.error && !state.errorField" class="ah-error" role="alert">{{ state.error }}</p>
        <p v-if="state.notice" class="ah-note" role="status">{{ state.notice }}</p>
        <template v-if="state.googleClientId && mode === 'in'">
          <div ref="googleHost" class="ah-google" />
          <p v-if="googleFailed" class="ah-note">Google sign-in could not be loaded here. Use your e-mail address below.</p>
          <p class="ah-or" aria-hidden="true"><span>or with your e-mail</span></p>
        </template>
        <form novalidate @submit.prevent="submit">
          <label for="ah-email">E-mail address</label>
          <input id="ah-email" v-model="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="254" required :aria-invalid="state.errorField === 'email' ? 'true' : undefined">
          <p v-if="state.errorField === 'email'" class="ah-error" role="alert">{{ state.error }}</p>
          <template v-if="mode === 'in'">
            <label for="ah-password">Password</label>
            <div class="ah-pw"><input id="ah-password" v-model="password" :type="show ? 'text' : 'password'" autocomplete="current-password" maxlength="128" required :aria-invalid="state.errorField === 'password' ? 'true' : undefined"><button type="button" :aria-pressed="show" @click="show = !show">{{ show ? 'Hide' : 'Show' }}</button></div>
            <p v-if="state.errorField === 'password'" class="ah-error" role="alert">{{ state.error }}</p>
          </template>
          <button class="ah-primary" :disabled="state.busy">{{ state.busy ? 'One moment…' : mode === 'reset' ? 'Send reset link' : 'Sign in' }}</button>
        </form>
        <button type="button" class="ah-link" @click="mode = mode === 'in' ? 'reset' : 'in'">{{ mode === 'in' ? 'Forgot your password?' : 'Back to sign in' }}</button>
      </template>
    </section>
  </main>
</template>
