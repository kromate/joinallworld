<script setup lang="ts">
// The HUD's health warning: an alert shown only when there is something to act on (sick or run
// down). It opens the Health app. The weather chip is WeatherChip.vue; both read view.health.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { alertOf, warningLabel } from './healthChips.ts'

const { game, shell } = useApp()
const warning = computed(() => alertOf(game.view.value.health))
</script>

<template>
  <button v-if="warning" type="button" class="health-chip" :class="`is-${warning.level}`" :aria-label="warningLabel(warning)" @click="shell.open('health')"><span aria-hidden="true"><GameIcon inline kind="health" :id="warning.level" :emoji="warning.icon" /></span><b>{{ warning.text }}</b></button>
</template>

<style scoped src="../../../ui/panels/health.css"></style>
