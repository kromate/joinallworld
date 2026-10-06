<script setup lang="ts">
// The small part of the companion that is in the first download: it waits until the game is on screen and settled, and then fetches the
// companion (its 3D model, brain and chat) in the background. Nothing of the companion is in the first download but this and its state.
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { companionUi } from './companionState.ts'

const CompanionHost = defineAsyncComponent(() => import('./CompanionHost.vue'))
const { game, scene } = useApp()
const wanted = ref(false)
let timer = 0
/** The scene is up and the browser has a quiet moment: fetch the companion. Asked for out loud (the chat), at once. */
function consider(): void {
  if (wanted.value || !game.connected.value || game.view.value.onboarding?.required === true) return
  if (!scene.venue.value && !companionUi.open) return
  clearTimeout(timer)
  timer = window.setTimeout(() => { wanted.value = true }, companionUi.open ? 0 : 2500)
}
watch([() => game.connected.value, () => game.view.value.onboarding?.required, scene.venue, () => companionUi.open], consider)
onMounted(consider)
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <CompanionHost v-if="wanted" />
</template>
