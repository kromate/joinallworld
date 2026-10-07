<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useAccount } from '../account/useAccount.ts'
import type { Reauth } from '../account/accountStore.ts'
const emit = defineEmits<{ done: []; cancel: [] }>()
const account = useAccount(), state = account.state
const number = ref(''), password = ref(''), code = ref(''), consent = ref(false), started = ref(false), sent = ref(false), captcha = ref(''), note = ref('')
const challenge = ref<HTMLElement | null>(null), googleHost = ref<HTMLElement | null>(null)
const google = computed(() => state.account?.provider === 'google')
let removeChallenge: (() => void) | null = null, removeGoogle: (() => void) | null = null, gone = false
async function prepare(): Promise<void> {
  if (!consent.value) return
  started.value = true; note.value = ''
  await nextTick()
  try {
    if (challenge.value) removeChallenge = await account.phoneChallenge(challenge.value, value => { captcha.value = value })
    if (google.value && googleHost.value) {
      const { loadGoogleIdentity, renderGoogleButton } = await import('../account/googleButton.ts'), api = await loadGoogleIdentity()
      if (!gone && googleHost.value) removeGoogle = renderGoogleButton(api, googleHost.value, state.googleClientId, credential => { void send({ credential }) })
    }
  } catch { note.value = 'The verification challenge could not load. Close this check and try again.' }
}
async function send(proof?: Reauth): Promise<void> {
  if (!captcha.value || !consent.value || state.busy) { note.value = 'Complete the challenge before sending a code.'; return }
  const reauth = proof ?? { password: password.value }; password.value = ''
  sent.value = await account.beginPhone(reauth, number.value, captcha.value)
  if (!gone && sent.value) { number.value = ''; removeChallenge?.(); removeChallenge = null; removeGoogle?.(); removeGoogle = null }
}
async function confirm(): Promise<void> {
  const typed = code.value; code.value = ''
  if (await account.confirmPhone(typed) && !gone) emit('done')
}
onBeforeUnmount(() => { gone = true; account.cancelPhone(); removeChallenge?.(); removeGoogle?.(); number.value = ''; password.value = ''; code.value = ''; captcha.value = '' })
</script>

<template>
  <section class="ui-card ph-no-capture" data-private aria-label="Verify your phone">
    <h3>Verify your phone</h3>
    <template v-if="!started">
      <p>Google sends an SMS and links the number to your existing account. Google processes and stores it for security. Allworld keeps only the check result.</p>
      <label><input v-model="consent" type="checkbox"> I agree to Google processing my number for this check.</label>
      <button type="button" class="ui-button" :disabled="!consent" @click="prepare">Start phone check</button>
    </template>
    <template v-else-if="!sent">
      <label class="world-field">Phone number, including country code<input v-model="number" type="tel" autocomplete="tel" maxlength="16" placeholder="+234…"></label>
      <p class="ui-note">Confirm your existing sign-in to link this number. Finish within five minutes.</p>
      <div ref="challenge" aria-label="Security challenge" />
      <div v-if="google" ref="googleHost" />
      <form v-else @submit.prevent="send()">
        <label class="world-field">Account password<input v-model="password" type="password" autocomplete="current-password" maxlength="128"></label>
        <button type="submit" class="ui-button" :disabled="state.busy || !captcha || !number || !password">Send SMS code</button>
      </form>
    </template>
    <form v-else @submit.prevent="confirm">
      <label class="world-field">Six-digit SMS code<input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label>
      <button type="submit" class="ui-button" :disabled="state.busy || code.length !== 6">Verify code</button>
    </form>
    <p v-if="note || state.error" class="ui-error" role="alert">{{ note || state.error }}</p>
    <button type="button" class="ui-button" :disabled="state.busy" @click="emit('cancel')">Cancel phone check</button>
  </section>
</template>
