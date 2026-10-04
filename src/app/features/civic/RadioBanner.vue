<script setup lang="ts">
// Club radio banner: the HUD chip shown while you stand in a club; it opens the Radio app.
// It follows the server's schedule whenever the screen is redrawn (each state poll); it runs no
// timer of its own, so a new shout-out can take up to a poll interval to appear. Renders nothing
// outside a club.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import type { RadioView } from '../../../types/civic.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { RADIO } from './civicContent.ts'
import { inClub, radioKey, radioPath, schedule, song } from './civicModel.ts'
import { useLoaded } from './useCivic.ts'

const { game, shell } = useApp()
const view = game.view
const state = game.state
const inside = computed(() => inClub(state.value))
const { item } = useLoaded<RadioView>({
  key: () => radioKey(view.value.cityId, state.value.location), path: () => radioPath(view.value.cityId, state.value.location), maxAge: 12000, live: true, when: () => inside.value,
})
const playing = computed(() => schedule(item.value.data, view.value.now).playing)
</script>

<template>
  <button v-if="inside" class="life-job civic-chip" :class="{ 'is-active': playing }" type="button" aria-label="Club radio" @click="shell.open('radio')">
    <span aria-hidden="true"><GameIcon inline name="radio" /></span>
    <div><strong>{{ playing ? `THE DJ — shout-out from @${playing.by.name}` : RADIO.label }}</strong><small>{{ playing ? song(playing) : RADIO.cta }}</small></div>
  </button>
</template>

<style scoped>
:global(.life-ui) .civic-chip { width: 100%; max-width: 100%; }
.civic-chip > div { min-width: 0; }
.civic-chip strong, .civic-chip small { white-space: normal; overflow-wrap: anywhere; }
</style>
