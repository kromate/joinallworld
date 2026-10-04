<script setup lang="ts">
// City card (modal): the city you are in and its places, each a link to its card on the Map. One
// city is open (Lagos); the others on the Nigeria map are "coming soon" and have no card, so there
// is nothing to enter from here.
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
</script>

<template>
  <div>
    <h3>{{ game.view.value.city?.name ?? 'Lagos' }}</h3>
    <p>{{ game.view.value.city?.region ?? 'Lagos State' }}, Nigeria</p>
    <p>You are here. Choose somewhere to go.</p>
    <div id="city-places">
      <button v-for="venue in game.view.value.venues" :key="venue.id" type="button" @click="shell.open('map', { destination: venue.id })"><GameIcon inline kind="venue" :id="venue.id" :emoji="venue.icon" /> {{ venue.label }}</button>
    </div>
    <p class="preview-note">More places and activities are coming to {{ game.view.value.city?.name ?? 'Lagos' }}.</p>
  </div>
</template>
