<script setup lang="ts">
// The HUD tray's weather chip: the weather now, or the rain warning in its place. It opens the Health app.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { trayOf, warningLabel, weatherLabel } from './healthChips.ts'

const { game, shell } = useApp()
const chip = computed(() => trayOf(game.view.value.health))
</script>

<template>
  <button v-if="chip?.kind === 'warning'" type="button" class="health-chip" :class="`is-${chip.warning.level}`" :aria-label="warningLabel(chip.warning)" @click="shell.open('health')"><span aria-hidden="true"><GameIcon inline kind="health" :id="chip.warning.level" :emoji="chip.warning.icon" /></span><b>{{ chip.warning.text }}</b></button>
  <button v-else-if="chip" type="button" class="health-chip" :aria-label="weatherLabel(chip.label)" @click="shell.open('health')"><span aria-hidden="true"><GameIcon inline kind="weather" :id="chip.id" :emoji="chip.icon" /></span><b>{{ chip.label }}</b></button>
</template>

<style scoped src="../../../ui/panels/health.css"></style>
