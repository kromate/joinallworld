<script setup lang="ts">
// The call card: who, what is happening, and big labelled buttons. It is shown while the call rings (outgoing or
// incoming) and while it connects. Answer is green, Decline and Hang up are red. Enter answers and Esc declines or cancels
// (CallsUi handles the keys, unless the player is typing). The incoming card takes focus only when nothing is being typed.
import { computed, nextTick, onMounted, ref } from 'vue'
import type { CallView } from '../../../calls.ts'
import FounderTag from '../social/FounderTag.vue'
import { toneState } from './callTones.ts'
import { initialOf, hueOf, statusText } from './callFormat.ts'
import { acknowledgeDisclosure, DISCLOSURE, disclosureAcknowledged } from './callState.ts'
import { loadedCalls } from './callsLoader.ts'
import CallIcons from './CallIcons.vue'

const props = defineProps<{ view: CallView; where: string | null; founder: boolean }>()
const name = computed(() => props.view.peer?.name ?? 'Someone')
const incoming = computed(() => props.view.role === 'callee' && (props.view.phase === 'incoming' || props.view.phase === 'starting'))
const opening = computed(() => props.view.phase === 'starting' && props.view.role === 'callee')
const line = computed(() => statusText(props.view.phase, props.view.role, name.value, props.view.mic))
const hint = computed(() => {
  if (props.view.error) return null
  if (props.view.role === 'caller' && props.view.mic === 'asking' && (props.view.phase === 'calling' || props.view.phase === 'ringing')) return 'Allow the microphone when your browser asks.'
  return null
})
const shownNote = disclosureAcknowledged() ? null : DISCLOSURE
const answer = ref<HTMLButtonElement | null>(null)
onMounted(async () => {
  await nextTick()
  const typing = document.activeElement instanceof HTMLElement && (document.activeElement.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName))
  if (incoming.value && !typing) answer.value?.focus()
})
const controller = () => loadedCalls()
function accept(): void { acknowledgeDisclosure(); void controller()?.accept() }
</script>

<template>
  <section class="call-card" :class="{ 'is-incoming': incoming }" :role="incoming ? 'alertdialog' : 'region'" :aria-label="incoming ? 'Incoming call' : 'Call'" aria-live="off" data-call="card" :data-phase="view.phase">
    <div class="call-avatar" aria-hidden="true">
      <span class="call-ring" /><span class="call-ring" /><span class="call-ring" />
      <b :style="{ background: `hsl(${hueOf(name)} 45% 38%)` }">{{ initialOf(name) }}</b>
    </div>
    <h2 class="call-name">{{ name }}<FounderTag v-if="founder" /></h2>
    <p class="call-status" role="status" aria-live="polite" data-call="status">{{ line }}</p>
    <p v-if="where" class="call-where" data-call="where">{{ where }}</p>
    <p v-if="incoming && toneState.locked" class="call-hint" data-call="silent">Tap anywhere on the page to hear the ring.</p>
    <p v-if="hint" class="call-note" data-call="mic-hint">{{ hint }}</p>
    <p v-if="incoming && shownNote" class="call-note">{{ shownNote }}</p>
    <p v-if="view.error" class="call-error" role="alert" data-call="error">{{ view.error }}</p>
    <button v-if="view.error && view.mic === 'problem' && view.phase !== 'incoming'" type="button" class="call-btn" data-call="retry" @click="controller()?.startMicrophone()">Try again</button>
    <button v-if="view.phase === 'needs-tap'" type="button" class="call-btn is-primary is-big" data-call="tap-to-talk" @click="controller()?.startMicrophone()">Tap to talk</button>
    <div class="call-choices">
      <button v-if="incoming" type="button" class="call-choice" data-call="decline" @click="controller()?.hangup()"><span class="call-round"><CallIcons name="hangup" /></span>Decline</button>
      <button v-if="incoming" ref="answer" type="button" class="call-choice is-answer" :disabled="opening" data-call="accept" @click="accept"><span class="call-round"><CallIcons name="phone" /></span>{{ view.error ? 'Try again' : 'Answer' }}</button>
      <button v-else type="button" class="call-choice" data-call="hangup" @click="controller()?.hangup()"><span class="call-round"><CallIcons name="hangup" /></span>{{ view.phase === 'connecting' ? 'Hang up' : 'Cancel' }}</button>
    </div>
  </section>
</template>
