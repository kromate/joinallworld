<script setup lang="ts">
// Overview: walk to a landmark, what can be done where you stand, the campus shuttle and the
// visitor discovery trail.
import { computed, ref, watch } from 'vue'
import { money } from '../../ui/format.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import CampusCard from './CampusCard.vue'
import CampusControl from './CampusControl.vue'
import CampusGo from './CampusGo.vue'
import { DISCOVERY_TRAIL, LANDMARKS, SHUTTLE_STOPS } from './campusContent.ts'
import { at, markOf, onCampus, shuttleReason, title } from './campusModel.ts'
import { choices, useCampus } from './useCampus.ts'

const { shell } = useApp()
const { state, view, blocked, act, go } = useCampus()
const here = computed(() => onCampus(state.value))

// The landmark to walk to: where you stand, until another is chosen. Away from the campus nothing is chosen and the picker is not shown
// (the spot is then wherever the player is, which is not a landmark of the campus).
const landmarkOf = (spot: string | null | undefined): string => (spot && LANDMARKS[spot] ? spot : 'main-gate')
const wanted = ref(landmarkOf(state.value.spot))
watch(() => state.value.spot, (spot) => { if (spot && LANDMARKS[spot]) wanted.value = spot })
const walk = (): void => go(wanted.value)

const place = computed(() => (state.value.spot ? LANDMARKS[state.value.spot] ?? null : null))
const activities = computed(() => place.value?.activities ?? [])

const stops = computed(() => (view.value.unilagShuttle?.stops?.length ? view.value.unilagShuttle.stops : SHUTTLE_STOPS))
const usable = computed(() => stops.value.filter((stop) => stop.id !== state.value.spot))
/** The destination shown: the choice while it is still a stop other than this one, else the first. */
const destination = computed(() => (usable.value.some((stop) => stop.id === choices.shuttle) ? choices.shuttle : usable.value[0]?.id ?? ''))
const atStop = computed(() => here.value && stops.value.some((stop) => stop.id === state.value.spot))
const shuttleWhy = computed(() => shuttleReason(blocked.value, atStop.value, destination.value))
const active = computed(() => view.value.unilagShuttle?.active ?? null)
const board = (): void => { const to = destination.value; if (to) void act('campus-shuttle', { destination: to }) }

const found = computed(() => new Set(state.value.unilagCommunity?.trail ?? []))
</script>

<template>
  <div class="campus-grid">
    <CampusCard v-if="here" icon="🚶🏾" heading="Walk around campus">
      <label class="campus-field">Landmark
        <select v-model="wanted">
          <option v-for="landmark in Object.values(LANDMARKS)" :key="landmark.id" :value="landmark.id">{{ landmark.label }}</option>
        </select>
      </label>
      <template #extra><button type="button" class="ui-button is-primary" :disabled="!here" @click="walk">Select and walk</button></template>
    </CampusCard>

    <CampusCard v-if="!here" icon="📍" heading="Things to do here"><p>Travel to UNILAG to see activities at each landmark.</p></CampusCard>
    <CampusCard v-else icon="✨" :heading="`At ${place?.label ?? title(state.spot)}`">
      <div v-for="item in activities" :key="item.id" class="campus-row">
        <div><strong><GameIcon inline :name="markOf(item.icon)" /> {{ item.label }}</strong><small>{{ item.duration }}s{{ item.cost ? ` · ${money(item.cost)}` : ' · Free' }}</small></div>
        <CampusControl primary label="Start" :reason="blocked" @press="act('activity', { id: item.id })" />
      </div>
      <p v-if="!activities.length">Walk to another landmark to find something to do.</p>
    </CampusCard>
  </div>

  <div class="campus-actions">
    <button type="button" class="ui-button" @click="shell.open('bank')"><GameIcon inline name="bank" /> Open Bank</button>
    <button v-if="!here" type="button" class="ui-button is-primary" @click="go('main-gate')"><GameIcon inline :name="markOf('🎓')" /> Travel to campus</button>
  </div>

  <CampusCard icon="🚌" :heading="`Campus shuttle · ${money(view.unilagShuttle?.fare ?? 50)}`">
    <p v-if="active" class="campus-notice">Shuttle in progress: {{ title(active.origin) }} to {{ title(active.destination) }}. The fare is not refundable.</p>
    <label class="campus-field">Destination
      <select :value="destination" @change="choices.shuttle = ($event.target as HTMLSelectElement).value as typeof choices.shuttle">
        <option v-for="stop in usable" :key="stop.id" :value="stop.id">{{ stop.label }}</option>
      </select>
    </label>
    <p class="campus-note">Eight stops, including Main Gate, Senate, Engineering, Sports Centre and Lagoon Front.</p>
    <template #extra>
      <button type="button" class="ui-button is-primary" :disabled="Boolean(shuttleWhy)" :title="shuttleWhy || undefined" @click="board">Board shuttle</button>
      <small v-if="shuttleWhy" class="campus-why">{{ shuttleWhy }}</small>
    </template>
  </CampusCard>

  <CampusCard icon="🗺️" :heading="`Discovery trail · ${found.size}/${DISCOVERY_TRAIL.length}`">
    <ol class="campus-trail">
      <li v-for="(stop, index) in DISCOVERY_TRAIL" :key="stop.id" :class="{ 'is-done': found.has(stop.id) }">
        <span class="campus-step">{{ index + 1 }}</span>
        <div><strong>{{ stop.label }}</strong><small>{{ stop.description }}</small></div>
        <span v-if="found.has(stop.id)" class="campus-done">✓ Visited</span>
        <CampusControl v-else-if="at(state, stop.spot)" primary label="Mark visited" :reason="blocked" @press="act('unilag.trail.visit')" />
        <CampusGo v-else :spot="stop.spot" label="Walk here" />
      </li>
    </ol>
  </CampusCard>
</template>
