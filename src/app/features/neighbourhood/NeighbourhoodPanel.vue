<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { social } from '../social/useSocial.ts'
import { leaveCityVenue, leaveNeighbour, loadStreet, neighbourhood, startNeighbourhood, walkToNeighbour } from './neighbourhoodStore.ts'
import type { StreetJourney } from '../../../street/types.ts'
const { game, shell, command, goTo, scene } = useApp()
startNeighbourhood()
const doors = computed(() => neighbourhood.street?.houses.filter((house) => house.owner && !house.you) ?? [])
const visiting = computed(() => social.me?.visiting)
const outside = computed(() => game.state.value.location === 'neighbourhood')
const cityJourney = ref<StreetJourney | null>(null)
onMounted(async () => { try { const result = await game.fetchJson<{ journey: StreetJourney }>('/api/street/me'); cityJourney.value = result.journey } catch { cityJourney.value = null } })
const unavailable = computed(() => !game.connected.value || Boolean(game.state.value.activeAction) || Boolean(neighbourhood.pending))
function walk(id: string): void { shell.close(); walkToNeighbour(id) }
function explore(): void { shell.close(); if (!scene.venue.value?.walkStreetGate()) game.toast('Walk towards the city gate at the end of your street.', 'info') }
function stepOutside(): void {
  if (unavailable.value || game.saving.value) return
  shell.close()
  if (!scene.venue.value?.walkHomeDoor()) void command('home.door', { direction: 'outside' })
}
</script>

<template>
  <section class="neighbourhood-panel">
    <template v-if="visiting">
      <h2>{{ visiting.host.name }}'s home</h2>
      <p>You are a guest. Furniture and possessions belong to your host.</p>
      <p v-if="neighbourhood.homeError" class="ui-error" role="alert">{{ neighbourhood.homeError }}</p>
      <button class="ui-button" type="button" :disabled="unavailable" @click="leaveNeighbour()">Leave through the front door</button>
    </template>
    <template v-else-if="game.state.value.location === 'city-street'">
      <h2>Explore the city on foot</h2>
      <p>Tap the ground to walk, or use the movement control. Tap a venue's entrance to walk up and go inside.</p>
      <p>For longer journeys, you can still use the map and timed trips.</p>
      <button type="button" class="ui-button" @click="shell.close()">Continue walking</button>
      <button type="button" class="ui-button" @click="shell.open('map')">Open map</button>
    </template>
    <template v-else-if="cityJourney?.kind === 'venue' && cityJourney.venue === game.state.value.location">
      <h2>Return to the city street</h2>
      <p>You walked into this venue. Leave beside the same entrance and continue exploring.</p>
      <button type="button" class="ui-button" :disabled="unavailable" @click="leaveCityVenue()">Leave to the street</button>
      <p v-if="game.state.value.activeAction" class="ui-why">Finish or cancel your activity before leaving.</p>
    </template>
    <template v-else-if="outside">
      <button type="button" class="ui-button" :disabled="unavailable" @click="explore">Walk to the city gate</button>
      <p v-if="neighbourhood.street">Estate {{ neighbourhood.street.anchor.estate + 1 }} · Street {{ neighbourhood.street.street.row + 1 }} · Your plot {{ neighbourhood.street.anchor.plot % 14 + 1 }}</p>
      <p v-if="neighbourhood.loading" role="status">Finding your neighbours…</p>
      <p v-else-if="neighbourhood.error" class="ui-error" role="alert">{{ neighbourhood.error }}</p>
      <p v-else-if="!doors.length">No listed neighbours on this street yet. Private homes are not named.</p>
      <ul v-if="doors.length" class="neighbourhood-doors">
        <li v-for="house in doors" :key="house.plot">
          <span><strong>{{ house.owner?.name }}</strong><small>Plot {{ house.plot % 14 + 1 }}{{ house.owner?.friend ? ' · Friend' : '' }} · {{ house.owner?.online ? 'Online' : 'Offline' }}</small></span>
          <button type="button" class="ui-button" :disabled="unavailable" @click="house.owner && walk(house.owner.id)">Walk to door</button>
        </li>
      </ul>
      <button type="button" class="ui-button" :disabled="neighbourhood.loading" @click="loadStreet()">Refresh street</button>
    </template>
    <template v-else>
      <p>Step outside your home, then choose a neighbour and walk to their door.</p>
      <button v-if="game.state.value.location === 'home'" class="ui-button is-primary" type="button" :disabled="unavailable || Boolean(game.saving.value)" @click="stepOutside()">Step outside</button>
      <button v-else class="ui-button is-primary" type="button" @click="goTo('home')">Go home first</button>
      <p v-if="game.state.value.activeAction" class="ui-why">Finish or cancel your current activity first.</p>
      <p v-else-if="!game.connected.value" class="ui-why">Reconnect to walk outside.</p>
    </template>
  </section>
</template>

<style scoped>
.neighbourhood-panel { padding: 8px 0; }
.neighbourhood-doors { list-style: none; padding: 0; margin: 16px 0; }
.neighbourhood-doors li { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--c-line); }
.neighbourhood-doors small { display: block; margin-top: 4px; }
</style>
