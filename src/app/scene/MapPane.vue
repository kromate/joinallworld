<script setup lang="ts">
// Map rendering is a feature download. The closed venue keeps only its event intent buffer.
import { onBeforeUnmount, shallowRef, ref, watch } from 'vue'
import type { Component, ShallowRef } from 'vue'
import { useApp } from '../state/app.ts'
import { createMapIntent, mapWanted } from './mapIntent.ts'

const { game, scene } = useApp()
const runtime: ShallowRef<Component | null> = shallowRef(null)
const error = ref(false)
const intent = createMapIntent()
let pending: Promise<void> | null = null, listening = true, disposed = false
function capture(event: Event): void { if (event instanceof CustomEvent) intent.take(event.detail) }
window.addEventListener('jaw:map-ui', capture)
function ready(): void { if (!listening) return; listening = false; window.removeEventListener('jaw:map-ui', capture) }
function load(): Promise<void> {
  if (runtime.value || disposed) return Promise.resolve()
  if (pending) return pending
  error.value = false
  pending = import('./MapWorld.vue').then(module => { if (!disposed) runtime.value = module.default }, () => { if (!disposed) error.value = true }).finally(() => { pending = null })
  return pending
}
watch(() => mapWanted(scene.mapsWanted.value, game.mode.value), wanted => { if (wanted) void load() }, { immediate: true })
onBeforeUnmount(() => { disposed = true; ready() })
</script>

<template>
  <component :is="runtime" v-if="runtime" :initial-ui="intent.snapshot().ui" :initial-world="intent.snapshot().world" @ready="ready" />
  <div v-else id="city-scene" class="life-scene" :hidden="game.mode.value !== 'map'" aria-label="Map">
    <p class="ui-note" :role="error ? 'alert' : 'status'" style="position:absolute;top:30%;left:20%;right:20%;pointer-events:auto">{{ error ? 'The map could not load.' : 'Loading map…' }} <button v-if="error" type="button" class="ui-button" @click="load">Try again</button></p>
  </div>
</template>
