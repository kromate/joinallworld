<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { VoiceNoteView } from '../../../types/voice-note.ts'
const props = defineProps<{ voice: VoiceNoteView; off?: boolean }>()
const player = ref<HTMLAudioElement | null>(null), active = ref(false), failed = ref(false)
const words = { expired: 'This voice note has expired.', hidden: 'This voice note is hidden for review.', reported: 'You reported this voice note.', off: 'Voice notes are switched off.' }
const duration = (ms: number): string => { const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }
function clear(): void { player.value?.pause(); player.value?.removeAttribute('src'); player.value?.load(); active.value = false; failed.value = false }
function play(): void {
  if (props.voice.state || props.off || !player.value) return
  active.value = true; failed.value = false
  player.value.src = `/api/social/voice/${encodeURIComponent(props.voice.id)}`
  void player.value.play().catch(() => { if (player.value?.error) failed.value = true })
}
watch([() => props.voice.id, () => props.voice.state, () => props.off], clear)
function exclusive(): void { for (const other of document.querySelectorAll<HTMLAudioElement>('audio[data-voice-playback]')) if (other !== player.value) other.pause() }
onBeforeUnmount(clear)
</script>
<template>
  <div class="voice-note">
    <span v-if="voice.state || off" class="voice-unavailable">{{ off ? words.off : voice.state ? words[voice.state] : '' }}</span>
    <template v-else>
      <button v-if="!active" type="button" class="voice-play" :aria-label="`Play voice note, ${duration(voice.durationMs)}`" @click="play">Play recording <b>{{ duration(voice.durationMs) }}</b></button>
      <audio v-show="active && !failed" ref="player" data-voice-playback @play="exclusive" controls preload="none" aria-label="Voice note playback" @error="failed = true" />
      <span v-if="failed" class="voice-unavailable" role="status">Recording unavailable. <button type="button" @click="clear">Try again</button></span>
    </template>
  </div>
</template>
<style scoped>
.voice-note { width: 240px; max-width: 100%; margin: 4px 0; }
.voice-play { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 8px 12px; border: 0; border-radius: 10px; background: #e8f2ec; color: #17452f; font: 600 14px var(--font); cursor: pointer; }
.voice-play b { font-variant-numeric: tabular-nums; }
audio { display: block; width: 240px; max-width: 100%; height: 44px; }
.voice-unavailable { display: block; font-size: 13px; line-height: 1.4; }
.voice-unavailable button { background: none; border: 0; color: inherit; text-decoration: underline; min-height: 44px; cursor: pointer; }
</style>
