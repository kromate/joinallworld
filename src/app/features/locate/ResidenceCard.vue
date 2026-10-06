<script setup lang="ts">
// "Confirm where I live with my device's location": the optional control for the location-confirmed badge (docs/LOCATION.md), shown
// in Profile, in Settings and on the Home tab. Nothing is asked of the browser until the player has read what will happen and pressed
// "Check now". The check runs on this device against the boundary of the main-home local government; if it matches, the one action
// `estate.confirm-residence { lga, ok: true }` is sent, and nothing else. A mismatch sends nothing.
import '../../../ui/controls.css'
import '../../../ui/panels/world.css'
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import ResidentBadge from './ResidentBadge.vue'
import { BADGE_NOTE } from './badgeWords.ts'
import { allowHelp, checkResidence, locateUi, outcomeText } from './locateModel.ts'

const { game } = useApp()
const residence = computed(() => game.view.value.estate.residence)
const me = computed(() => game.session.value?.id ?? '')
const offline = computed(() => !game.connected.value)
const sendNote = ref('')
const switching = ref(false)
const until = computed(() => (residence.value?.confirmed ? new Date(residence.value.confirmed.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''))
const note = computed(() => {
  const r = residence.value
  if (!r || !locateUi.outcome || locateUi.outcome === 'confirmed') return ''
  return outcomeText(locateUi.outcome, r.lgaName, r.unit)
})
const help = computed(() => (locateUi.outcome === 'denied' ? allowHelp(globalThis.navigator?.userAgent ?? '') : ''))
/** One id per attempt, kept until it ends, so a retry of a lost answer is the same action to the server. */
let actionId = ''

function explain(): void { locateUi.step = 'explain'; locateUi.outcome = null; sendNote.value = '' }
function cancel(): void { locateUi.step = 'rest'; locateUi.outcome = null }
async function check(): Promise<void> {
  const r = residence.value
  if (!r || locateUi.step === 'checking') return
  locateUi.step = 'checking'; locateUi.outcome = null; sendNote.value = ''
  try {
    const outcome = await checkResidence({ city: r.city, lga: r.lga })
    locateUi.outcome = outcome
    if (outcome !== 'confirmed') return
    actionId ||= game.newId()
    const result = await game.resend(actionId, 'estate.confirm-residence', { lga: r.lga, ok: true })
    if (result.ok) actionId = ''
    else sendNote.value = result.reason ?? 'The badge could not be saved just now. Try again later.'
  } finally { locateUi.step = 'rest' }
}
async function off(): Promise<void> {
  if (switching.value) return
  switching.value = true
  try { await game.command('estate.unconfirm-residence') } finally { switching.value = false }
}
</script>

<template>
  <section v-if="residence" class="world-card" data-residence-card aria-label="Location-confirmed badge">
    <h3>Location-confirmed badge</h3>
    <p class="ui-note">{{ BADGE_NOTE }}</p>
    <template v-if="residence.confirmed">
      <p><ResidentBadge :id="me" long /></p>
      <p class="ui-note">Other players see the name of your {{ residence.unit }} (they can already see it in the directory) and that your own device confirmed it; if you are hidden from the directory they see only "Location-confirmed". Nobody sees where you are. It lasts until {{ until }} ({{ residence.days }} days) or until you move your main home.</p>
      <label class="residence-switch"><input type="checkbox" role="switch" checked :disabled="offline || switching" data-residence-switch @change="off"> Show my location-confirmed badge</label>
      <button v-if="locateUi.step === 'rest'" type="button" class="ui-button is-block" :disabled="offline" data-residence-again @click="explain">Check again</button>
    </template>
    <template v-else>
      <p class="ui-note">Add a small tag to your card that says you live in {{ residence.lgaName }}, confirmed by your device. It is not an identity check, and nothing about where you are goes to the game.</p>
      <label v-if="locateUi.step === 'rest'" class="residence-switch"><input type="checkbox" role="switch" :checked="false" :disabled="offline" data-residence-switch @change="explain"> Show my location-confirmed badge</label>
      <button v-if="locateUi.step === 'rest'" type="button" class="ui-button is-block" :disabled="offline" data-residence-start @click="explain">Confirm where I live with my device's location</button>
    </template>
    <div v-if="locateUi.step !== 'rest'" class="residence-explain" role="group" aria-label="What will happen" data-residence-explain>
      <p>Your device checks, on your device, whether you are in {{ residence.lgaName }}.</p>
      <p>Your position is never sent or stored — only whether it matched.</p>
      <button type="button" class="ui-button is-primary is-block" :disabled="locateUi.step === 'checking'" data-residence-check @click="check">{{ locateUi.step === 'checking' ? 'Checking…' : 'Check now' }}</button>
      <button type="button" class="ui-button is-block" :disabled="locateUi.step === 'checking'" @click="cancel">Not now</button>
    </div>
    <p v-if="note" class="ui-why" role="status" data-residence-note>{{ note }}</p>
    <p v-if="help" class="ui-note" data-residence-help>{{ help }}</p>
    <p v-if="sendNote" class="ui-why" role="status">{{ sendNote }}</p>
    <p v-if="locateUi.outcome === 'confirmed' && !sendNote && residence.confirmed" class="ui-note" role="status">Your device places you in {{ residence.lgaName }}. Your badge is on.</p>
  </section>
</template>

<style scoped>
.residence-switch { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-weight: 600; }
.residence-explain { margin: 8px 0; padding: 10px; border-radius: 10px; background: rgba(0, 0, 0, .04); }
.residence-explain p { margin: 0 0 6px; }
</style>
