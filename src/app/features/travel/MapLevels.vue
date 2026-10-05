<script setup lang="ts">
// The bar at the top of the city map: World › Africa › Nigeria › the city the player is in. One tap on a wider level
// swaps the backdrop to the atlas at that level (on the atlas the same bar is the atlas's own, with the level in view
// marked). It is always on screen while the city map is, so the world is never further than one tap from the Map.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { playableCityIds } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { mapCrumbText, mapLevels } from './travelModel.ts'
import type { MapLevel } from './travelModel.ts'

const { game, showMapLayer } = useApp()
const cityName = computed(() => game.view.value.city?.name ?? 'City')
const levels = computed(() => mapLevels(cityName.value, 'city'))
const openCities = playableCityIds().length

/** On a phone only the current level shows, as one chip; it opens the whole trail (World › Africa › Nigeria › the city) as a small list. */
const open = ref(false)
const root = ref<HTMLElement | null>(null)
function go(level: MapLevel): void {
  open.value = false
  if (level.atlas !== null) showMapLayer('world', { level: level.atlas })
}
const away = (event: Event): void => { if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) open.value = false }
const escape = (event: KeyboardEvent): void => { if (open.value && event.key === 'Escape') { open.value = false; event.stopPropagation() } }
onMounted(() => { document.addEventListener('pointerdown', away); document.addEventListener('keydown', escape, true) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape, true) })
</script>

<template>
  <nav ref="root" class="map-levels" :aria-label="`Map level. You are in ${mapCrumbText(cityName)}`" :data-open="open || undefined">
    <button type="button" class="map-levels-cur" data-tour="map-world" :aria-expanded="open" aria-controls="map-levels-list" :aria-label="`Map level: ${cityName}. Show World, Africa and Nigeria`" @click="open = !open"><GameIcon inline name="globe" /><span>{{ cityName }}</span><GameIcon inline name="chevron-down" /></button>
    <ol id="map-levels-list">
      <li v-for="level in levels" :key="level.id" :data-level="level.id">
        <button
          type="button" :data-map-level="level.id" :data-tour="level.id === 'world' ? 'map-world' : undefined" :aria-current="level.current ? 'true' : undefined"
          :title="level.atlas === null ? 'You are here' : level.id === 'world' ? `World map · ${openCities} cities open` : `Map of ${level.label}`" @click="go(level)"
        ><GameIcon v-if="level.id === 'world'" inline name="globe" /><span>{{ level.label }}</span></button>
      </li>
    </ol>
  </nav>
</template>
