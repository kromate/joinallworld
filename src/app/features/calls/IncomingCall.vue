<script setup lang="ts">
// The incoming-call banner: who is calling (their public name), Accept and Decline. Accept is the tap that asks for
// the microphone (src/calls.ts accept). The banner dismisses itself when the ring ends, because the controller does.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CallView } from '../../../calls.ts'
import { acknowledgeDisclosure, DISCLOSURE, disclosureAcknowledged } from './callState.ts'
import { loadedCalls } from './callsLoader.ts'

const props = defineProps<{ view: CallView }>()
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 500) })
onBeforeUnmount(() => { if (tick !== null) clearInterval(tick) })
/** The ring's end is on the server's clock; only whole seconds are shown, and never a negative number. */
const left = computed(() => (props.view.expiresAt ? Math.max(0, Math.ceil((props.view.expiresAt - now.value) / 1000)) : null))
const opening = computed(() => props.view.phase === 'starting')
const shownNote = disclosureAcknowledged() ? null : DISCLOSURE

function accept(): void { acknowledgeDisclosure(); void loadedCalls()?.accept() }
function decline(): void { loadedCalls()?.hangup() }
</script>

<template>
  <section class="call-card is-incoming" role="alertdialog" aria-label="Incoming call" aria-live="assertive" data-call="incoming">
    <div class="call-who">
      <span class="call-pulse" aria-hidden="true" />
      <div>
        <p class="call-title">{{ view.peer?.name ?? 'Someone' }} is calling</p>
        <p class="call-sub"><template v-if="opening">Opening your microphone…</template><template v-else-if="left !== null">Ringing · {{ left }} s</template></p>
      </div>
    </div>
    <p v-if="shownNote" class="call-note">{{ shownNote }}</p>
    <p v-if="view.error" class="call-error" role="alert">{{ view.error }}</p>
    <div class="call-actions">
      <button type="button" class="call-btn is-primary" :disabled="opening" data-call="accept" @click="accept">Accept</button>
      <button type="button" class="call-btn is-danger" data-call="decline" @click="decline">Decline</button>
    </div>
  </section>
</template>
