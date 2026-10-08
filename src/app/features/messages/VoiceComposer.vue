<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { createVoiceRecorder, canRecordVoice } from './voiceRecorder.ts'
import type { VoiceRecorderState } from './voiceRecorder.ts'
const props = defineProps<{ target: { to: string } | { conv: string }; conv: string; meId: string; disabled: boolean; newId: () => string; replyTo?: number }>()
const emit = defineEmits<{ sent: [result: { conv: { id: string } }] }>()
const state = ref<VoiceRecorderState>({ kind: 'idle' }), busy = ref(false), error = ref('')
const supported = canRecordVoice()
let clientId = '', generation = 0, sending: AbortController | null = null
const recorder = createVoiceRecorder(next => { state.value = next; if (next.kind === 'review') clientId = props.newId() })
const seconds = (ms: number): string => { const n = Math.floor(ms / 1000); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` }
function cancel(): void { generation++; sending?.abort(); sending = null; busy.value = false; error.value = ''; recorder.cancel(); clientId = '' }
watch(() => [props.conv, props.meId], cancel)
watch(() => props.disabled, disabled => { if (disabled && (state.value.kind === 'recording' || state.value.kind === 'requesting')) cancel() })
onBeforeUnmount(() => { cancel(); recorder.dispose() })
async function send(): Promise<void> {
  if (state.value.kind !== 'review' || busy.value || props.disabled) return
  const draft = state.value.draft, turn = generation, identity = props.meId, destination = props.conv
  const target = { ...props.target }, replyTo = props.replyTo, id = clientId
  busy.value = true; error.value = ''
  try {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] ?? '') : reject(Error('Recording could not be read.')); reader.onerror = () => reject(Error('Recording could not be read.')); reader.readAsDataURL(draft.blob) })
    if (turn !== generation || identity !== props.meId || destination !== props.conv) return
    sending = new AbortController()
    const response = await fetch('/api/social/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, clientId: id, body: '', data, ...(replyTo ? { replyTo } : {}) }), signal: sending.signal })
    const answer: unknown = await response.json()
    if (turn !== generation || identity !== props.meId || destination !== props.conv) return
    const expected = 'conv' in target ? target.conv : `dm.${[identity, target.to].sort().join('.')}`
    if (response.ok && answer && typeof answer === 'object' && 'ok' in answer && answer.ok === true && 'conv' in answer && answer.conv && typeof answer.conv === 'object' && 'id' in answer.conv && answer.conv.id === expected) {
      emit('sent', { conv: { id: expected } })
      cancel()
    } else error.value = answer && typeof answer === 'object' && 'reason' in answer && typeof answer.reason === 'string' ? answer.reason : 'The voice note was not accepted. Try again.'
  } catch { if (turn === generation) error.value = 'Delivery is not confirmed. Retry this recording to avoid sending it twice.' }
  finally { if (turn === generation) { busy.value = false; sending = null } }
}
</script>
<template>
  <section class="voice-compose" aria-label="Voice note">
    <template v-if="state.kind === 'idle' || state.kind === 'failed'">
      <button type="button" :disabled="disabled || !supported" @click="error = ''; recorder.start()">Record voice note</button>
      <small v-if="!supported">Voice recording needs Opus support in your browser. Text messages still work.</small>
      <small v-else>Up to one minute. Review before sending.</small>
      <p v-if="state.kind === 'failed'" role="alert">{{ state.reason }}</p>
    </template>
    <template v-else-if="state.kind === 'requesting'"><span role="status">Waiting for microphone permission…</span><button type="button" @click="cancel">Cancel</button></template>
    <template v-else-if="state.kind === 'recording'"><span class="voice-time">Recording {{ seconds(state.elapsedMs) }} / 1:00</span><button type="button" @click="recorder.stop">Stop and review</button><button type="button" @click="cancel">Discard</button></template>
    <template v-else>
      <audio :src="state.draft.url" controls preload="metadata" aria-label="Review your voice note" />
      <button type="button" class="voice-send" :disabled="busy || disabled" @click="send">{{ busy ? 'Sending…' : error ? 'Retry voice note' : 'Send voice note' }}</button>
      <button type="button" :disabled="busy" @click="cancel">Discard</button>
    </template>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.voice-compose { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 0; }
.voice-compose button { min-height: 44px; border: 0; border-radius: 8px; padding: 8px 12px; background: #e8f2ec; color: #17452f; font: 600 13px var(--font); cursor: pointer; }
.voice-compose .voice-send { background: #176347; color: #fff; }
.voice-compose button:disabled { opacity: .55; cursor: not-allowed; }
.voice-compose small { font-size: 12px; color: var(--c-muted); }
.voice-compose p { flex: 1 1 100%; margin: 0; font-size: 13px; color: var(--c-red-dark); }
.voice-time { font-variant-numeric: tabular-nums; font-weight: 650; font-size: 13px; }
audio { width: 100%; height: 44px; }
</style>
