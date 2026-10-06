<script setup lang="ts">
// The speaker: one tap mutes or unmutes every sound of the game on this device. On a phone it sits in the status popover
// (the top row is crowded); on a wide screen it is in the bar. The preference is kept in src/audio/settings.ts.
import { onBeforeUnmount, ref } from 'vue'
import { getSound, onSoundChange, toggleMute } from '../../../audio/settings.ts'

const on = ref(getSound().on)
const stop = onSoundChange(() => { on.value = getSound().on })
onBeforeUnmount(stop)
</script>

<template>
  <button class="hud-sound" type="button" :aria-pressed="!on" :aria-label="on ? 'Sound is on. Mute' : 'Sound is muted. Unmute'" :title="on ? 'Mute sound' : 'Unmute sound'" @click="toggleMute">
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" /><path :d="on ? 'M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11' : 'M16 9.5l5 5M21 9.5l-5 5'" />
    </svg>
    <span class="hud-sound-word">{{ on ? 'Sound on' : 'Muted' }}</span>
  </button>
</template>

<style scoped>
.hud-sound { display: inline-flex; align-items: center; gap: 6px; min-height: var(--tap); padding: 0 6px; border: 0; background: none; color: var(--c-ink-2); font: inherit; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.hud-sound[aria-pressed='true'] { color: var(--c-muted); }
.hud-sound:focus-visible { outline: var(--focus); outline-offset: 2px; }
.hud-sound-word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 720px) { .hud-sound { width: 100%; padding: 0 10px; } .hud-sound-word { position: static; width: auto; height: auto; clip-path: none; } }
</style>
