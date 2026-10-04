<script setup lang="ts">
// Ride app: quick travel booking. Pick how to travel once, then tap Go beside any place. It is the
// same engine as the Map card: every fare, trip time and refusal comes from view.travel
// (src/game/systems/travel.js), and Go sends the same 'travel' action. The trip itself is then
// shown on the city map, like every other trip (the shell switches to it). While something stops
// every trip at once (offline, already travelling, busy) that is said once at the top, with its
// one-tap way out, instead of on every row.
import '../../../ui/panels/ride.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import GoFix from './GoFix.vue'
import { fareText, pickedMode, rideRows, rideRules, ridePlaces, statusClass, tripLine } from './travelModel.ts'
import { ride } from './travelState.ts'
import { useTravelActions } from './useTravelActions.ts'

defineProps<{ params?: unknown }>()
const { game } = useApp()
const { travel, pending } = useTravelActions()
const view = game.view

const here = computed(() => view.value.travel.destinations.find((item) => item.here))
const places = computed(() => ridePlaces(view.value.travel.destinations))
const modes = computed(() => places.value[0]?.modes ?? [])
const picked = computed(() => pickedMode(places.value, ride.wanted, view.value.travel.defaultMode))
const listing = computed(() => rideRows(game.state.value, view.value, places.value, picked.value))
const raining = computed(() => Boolean(view.value.health?.weather?.raining))
</script>

<template>
  <div class="ride-app">
    <div v-if="listing.notice" class="ride-notice" role="note">
      <p>{{ listing.notice.reason }}</p>
      <GoFix v-if="listing.notice.fix" :fix="listing.notice.fix" look="ride-fix" />
    </div>
    <p class="ride-intro">You are at <b>{{ here?.label ?? 'an unknown place' }}</b>. Fares are charged when you set off — no refund if you cancel.<template v-if="raining">{{ ' ' }}<GameIcon inline name="rain" /> It is raining: a trek or an okada will soak you.</template></p>
    <div class="ride-modes" role="group" aria-label="How to travel">
      <button v-for="mode in modes" :key="mode.id" type="button" :aria-pressed="mode.id === picked?.id" :class="{ 'is-selected': mode.id === picked?.id }" :title="mode.blurb || ''" @click="ride.wanted = mode.id">
        <span aria-hidden="true"><GameIcon inline kind="mode" :id="mode.id" :emoji="mode.icon" /></span>{{ mode.label }}
      </button>
    </div>
    <p v-if="picked?.blurb" class="ride-blurb">{{ picked.blurb }}</p>
    <HowItWorks id="ride-rules" page label="How rides work" :rules="rideRules(modes)" />
    <ul class="ride-list">
      <li v-for="row in listing.rows" :key="row.place.id" class="ride-row" :class="statusClass(row.place)">
        <span class="ride-icon" aria-hidden="true"><GameIcon inline kind="venue" :id="row.place.id" :emoji="row.place.icon" /></span>
        <div class="ride-place">
          <b>{{ row.place.label }}</b><small>{{ row.place.district }} · {{ row.place.status }}</small>
          <template v-if="row.own">
            <small class="ride-why">{{ row.own.reason }}</small>
            <button v-if="row.own.fix?.kind === 'mode'" type="button" class="ride-fix is-small" @click="ride.wanted = row.own.fix.mode">{{ row.own.fix.label }}</button>
          </template>
          <small v-else-if="!row.block && row.mode">{{ tripLine(row.mode) }}</small>
        </div>
        <button
          v-if="row.block || !row.mode" type="button" class="ride-go" disabled
          :aria-label="`${row.place.label}: ${row.block?.label ?? 'Unavailable'}`"
        >{{ row.block?.label ?? 'Unavailable' }}</button>
        <button
          v-else type="button" class="ride-go" :disabled="pending !== null"
          :aria-label="`Go to ${row.place.label} by ${row.mode.label} for ${fareText(row.mode)}`" @click="travel(row.place.id, row.mode.id, { close: true })"
        >Go · {{ fareText(row.mode) }}</button>
      </li>
    </ul>
  </div>
</template>
