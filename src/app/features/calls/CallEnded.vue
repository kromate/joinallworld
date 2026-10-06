<script setup lang="ts">
// What a call came to, for a few seconds: "Call ended · 4:12", or what happened instead (declined, not answered, could not
// connect). Call again and Message are offered where they make sense; a missed call offers Call back.
import { computed } from 'vue'
import type { CallView } from '../../../calls.ts'
import { useApp } from '../../state/app.ts'
import { clockText } from './callFormat.ts'
import { loadedCalls } from './callsLoader.ts'

const props = defineProps<{ view: CallView }>()
const name = computed(() => props.view.peer?.name ?? 'them')
const title = computed(() => (props.view.outcome === 'ended' && props.view.duration !== null ? `Call ended · ${clockText(props.view.duration)}` : props.view.notice ?? ''))
const again = computed(() => (props.view.outcome === 'missed' ? 'Call back' : 'Call again'))
const retry = computed(() => props.view.outcome === 'mic')
const canCall = computed(() => props.view.peer !== null && props.view.outcome !== 'limited' && props.view.outcome !== 'busy')
function callAgain(): void { const peer = props.view.peer; if (peer) loadedCalls()?.call({ ...peer }) }
function message(): void { const peer = props.view.peer; if (peer) { loadedCalls()?.dismiss(); useApp().shell.open('messages', { to: peer.id, name: peer.name }) } }
</script>

<template>
  <section class="call-ended" role="status" aria-live="polite" data-call="ended" :data-outcome="view.outcome">
    <h2 class="call-name" data-call="ended-title">{{ title }}</h2>
    <p v-if="view.outcome === 'ended' && view.duration !== null" class="call-note">with {{ name }}</p>
    <p v-else-if="view.duration !== null" class="call-note">Talked for {{ clockText(view.duration) }}</p>
    <div class="call-ended-actions">
      <button v-if="canCall" type="button" class="call-btn is-primary" data-call="again" @click="callAgain">{{ retry ? 'Try again' : again }}</button>
      <button v-if="view.peer" type="button" class="call-btn" data-call="message" @click="message">Message</button>
      <button type="button" class="call-btn" data-call="dismiss" @click="loadedCalls()?.dismiss()">OK</button>
    </div>
  </section>
</template>
