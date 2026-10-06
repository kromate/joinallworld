<script setup lang="ts">
// The HUD's health warning: an alert shown only when there is something to act on (sick or run
// down). Sick, it takes the player to the nearest clinic on the Map (the free one when they cannot pay the doctor); run down, it opens the
// Health app. The weather chip is WeatherChip.vue; both read view.health.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { alertOf, warningLabel } from './healthChips.ts'

const { game, shell, goTo } = useApp()
const warning = computed(() => alertOf(game.view.value.health))
/** The nearest place that cures an illness, found when it is wanted (the rules for it are fetched with the relief card). */
async function press(): Promise<void> {
  if (warning.value?.level === 'sick') {
    const { cureNear } = await import('../relief/reliefHelp.ts')
    const state = game.state.value, cure = cureNear(state, game.cityId.value)
    const way = cure && (state.cash >= cure.paidCost ? cure.paid ?? cure.free : cure.free ?? cure.paid)
    if (cure && way) { await goTo(cure.venue, way.spot); return }
  }
  shell.open('health')
}
</script>

<template>
  <button v-if="warning" type="button" class="health-chip" :class="`is-${warning.level}`" :aria-label="warningLabel(warning)" @click="press"><span aria-hidden="true"><GameIcon inline kind="health" :id="warning.level" :emoji="warning.icon" /></span><b>{{ warning.text }}</b></button>
</template>

<style scoped src="../../../ui/panels/health.css"></style>
