<script setup lang="ts">
// The trip bar: all there is of the Map panel while a trip runs, so the map, where the trip is
// happening, stays in view. Cancel is the shell's own; the rule beside it is the server's (the fare
// was charged at departure and is not refunded). The bar fills from the server's own numbers each
// time it reports: from the fraction done, to full, over the seconds left (one CSS animation).
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { paidText } from './travelModel.ts'
import type { TripInfo } from './travelModel.ts'
import SkipTrip from './SkipTrip.vue'

defineProps<{ trip: TripInfo }>()
const { command } = useApp()
</script>

<template>
  <div class="map-panel map-trip" role="group" :aria-label="`Travelling to ${trip.to.label}`">
    <div class="map-trip-row">
      <span class="map-trip-mode" aria-hidden="true"><GameIcon inline kind="mode" :id="trip.mode.id" :emoji="trip.mode.icon" /></span>
      <div class="map-trip-text">
        <b>{{ trip.from.label }} <span aria-hidden="true">→</span><span class="ui-sr"> to </span> {{ trip.to.label }}</b>
        <small>{{ trip.mode.label }}{{ paidText(trip) }} · <strong>{{ Math.ceil(trip.remaining) }}s left</strong></small>
      </div>
      <button type="button" class="map-trip-cancel" :aria-label="`Cancel the trip and stay at ${trip.from.label}`" @click="command('cancel')">Cancel</button>
    </div>
    <div class="map-trip-track" role="progressbar" aria-label="Trip progress" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(trip.fraction * 100)">
      <!-- Drawn again at each report so the animation restarts from the server's number. -->
      <i :key="`${trip.fraction}|${trip.remaining}`" :style="{ '--from': `${(trip.fraction * 100).toFixed(1)}%`, animationDuration: `${Math.max(0.05, trip.remaining).toFixed(2)}s` }" />
    </div>
    <p class="map-trip-rule">{{ trip.rule }}</p>
    <SkipTrip />
  </div>
</template>
