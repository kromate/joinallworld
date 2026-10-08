<script setup lang="ts">
import '../../../ui/controls.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { captureSession, discardCapture, stopSceneRecording } from './captureSession.ts'

const { game } = useApp()
const visible = computed(() => captureSession.recording && game.mode.value === 'venue')

function stop(): void { stopSceneRecording() }
</script>

<template>
  <section v-if="visible" class="capture-chip" aria-label="Scene video recording" data-capture-recording>
    <span class="capture-chip-dot" aria-hidden="true"></span>
    <span class="capture-chip-status" role="status" aria-live="polite">Recording · {{ captureSession.secondsLeft }}s</span>
    <button class="ui-button capture-chip-stop" type="button" aria-label="Stop scene recording" @click="stop">Stop</button>
    <button class="capture-chip-discard" type="button" aria-label="Discard scene recording" @click="discardCapture">Discard</button>
  </section>
</template>

<style scoped>
.capture-chip { display: flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; padding: 7px 9px; border: 1px solid var(--c-line); border-radius: var(--r-sm); background: var(--c-surface); color: var(--c-ink); box-shadow: var(--e-1); }
.capture-chip-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--c-red); box-shadow: 0 0 0 4px var(--c-red-soft); }
.capture-chip-status { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.capture-chip-stop { min-height: 36px; padding: 5px 10px; }
.capture-chip-discard { min-height: 36px; padding: 5px 7px; border: 0; background: none; color: var(--c-red-dark); font: inherit; font-size: 12px; cursor: pointer; }
.capture-chip button:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
