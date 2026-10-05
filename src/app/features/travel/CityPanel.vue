<script setup lang="ts">
// City card (modal): the city you are in and its places, each a link to its card on the Map. A visitor is told so, with
// the way to its Home tab (a guest house, the way home, a home here); only a life with no home anywhere chooses one here.
import { computed } from 'vue'
import { contentFor } from '../../../game/cities/runtime.ts'
import { useApp } from '../../state/app.ts'
import LgaCard from '../world/LgaCard.vue'
import GameIcon from '../../ui/GameIcon.vue'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const guide = computed(() => contentFor(game.cityId.value).thingsToDo.slice(0, 5))
</script>

<template>
  <div class="city-card">
    <h3>{{ game.view.value.city?.name ?? 'Lagos' }}</h3>
    <p class="city-card-region">{{ game.view.value.city?.region ?? 'Lagos State' }}, Nigeria</p>
    <p class="city-card-lead">You are here. Choose somewhere to go.</p>
    <p v-if="game.view.value.estate.settle" class="ui-note" data-city-visiting>You are visiting. Your home is in {{ game.view.value.estate.home?.name }}. <button type="button" class="ui-link" @click="shell.open('visiting')">Rest, go home or take a home here</button></p>
    <LgaCard v-else-if="game.state.value.onboarding.done && !game.view.value.estate.placed" heading="Choose where to live" compact />
    <h4>Things to do in {{ game.view.value.city.name }}</h4>
    <ul><li v-for="place in guide" :key="place.venueId"><button type="button" @click="shell.open('map', { destination: place.venueId })">{{ place.name }}</button> <span>{{ place.line }}</span></li></ul>
    <h4>Every place</h4>
    <div id="city-places">
      <button v-for="venue in game.view.value.venues" :key="venue.id" type="button" @click="shell.open('map', { destination: venue.id })"><GameIcon inline kind="venue" :id="venue.id" :emoji="venue.icon" /> {{ venue.label }}</button>
    </div>
    <p class="preview-note">More places and activities are coming to {{ game.view.value.city?.name ?? 'Lagos' }}.</p>
  </div>
</template>
