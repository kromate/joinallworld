<script setup lang="ts">
// The bar at the top of the city map: World › Africa › Nigeria › the city the player is in. One tap on a wider level
// swaps the backdrop to the atlas at that level (on the atlas the same bar is the atlas's own, with the level in view
// marked). It is always on screen while the city map is, so the world is never further than one tap from the Map.
import { computed } from 'vue'
import { playableCityIds } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { mapCrumbText, mapLevels } from './travelModel.ts'
import type { MapLevel } from './travelModel.ts'

const { game, showMapLayer } = useApp()
const cityName = computed(() => game.view.value.city?.name ?? 'City')
const levels = computed(() => mapLevels(cityName.value, 'city'))
const openCities = playableCityIds().length

function go(level: MapLevel): void {
  if (level.atlas !== null) showMapLayer('world', { level: level.atlas })
}
</script>

<template>
  <nav class="map-levels" :aria-label="`Map level. You are in ${mapCrumbText(cityName)}`">
    <ol>
      <li v-for="level in levels" :key="level.id" :data-level="level.id">
        <button
          type="button" :data-map-level="level.id" :data-tour="level.id === 'world' ? 'map-world' : undefined" :aria-current="level.current ? 'true' : undefined"
          :title="level.atlas === null ? 'You are here' : level.id === 'world' ? `World map · ${openCities} cities open` : `Map of ${level.label}`" @click="go(level)"
        ><GameIcon v-if="level.id === 'world'" inline name="globe" /><span>{{ level.label }}</span></button>
      </li>
    </ol>
  </nav>
</template>
