<script setup lang="ts">
// The level control at the top of the city map: one chip with the level the player is in (World › Africa › Nigeria › the city), opening
// a small list of the whole trail. One tap on a wider level swaps the backdrop to the atlas at that level (the atlas has the same control, with
// the level in view marked). It is always on screen while the city map is, so the world is never further than one tap from the Map.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { playableCityIds } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import '../../../ui/levelMenu.css'
import GameIcon from '../../ui/GameIcon.vue'
import { mapCrumbText, mapLevels } from './travelModel.ts'
import type { MapLevel } from './travelModel.ts'

const { game, showMapLayer } = useApp()
const cityName = computed(() => game.view.value.city?.name ?? 'City')
const cityId = computed(() => game.cityId.value)
const levels = computed(() => mapLevels(cityName.value, 'city', 2, cityId.value))
const levelLabels = computed(() => levels.value.map(level => level.label).join(', '))
const openCities = playableCityIds().length

/** Only the current level shows, as one chip; it opens the whole trail as a small list. */
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const chip = ref<HTMLButtonElement | null>(null)
function go(level: MapLevel): void {
  open.value = false
  if (level.atlas !== null) {
    if (level.id === 'country') showMapLayer('world', { level: 1, city: cityId.value })
    else showMapLayer('world', { level: level.atlas })
  }
}
const away = (event: Event): void => { if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) open.value = false }
const escape = (event: KeyboardEvent): void => { if (open.value && event.key === 'Escape') { open.value = false; event.stopPropagation(); chip.value?.focus() } }
/** Arrow keys move through the list (from the chip too); Home and End jump to the ends. */
function arrows(event: KeyboardEvent): void {
  const down = event.key === 'ArrowDown', up = event.key === 'ArrowUp'
  if (!down && !up && event.key !== 'Home' && event.key !== 'End') return
  const items = [...(root.value?.querySelectorAll<HTMLElement>('ol button') ?? [])], at = items.indexOf(event.target as HTMLElement)
  if (!open.value && (down || up)) open.value = true
  else if (!open.value) return
  event.preventDefault()
  void nextTick(() => items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : down ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1)]?.focus())
}
onMounted(() => { document.addEventListener('pointerdown', away); document.addEventListener('keydown', escape, true) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape, true) })
</script>

<template>
  <nav ref="root" class="map-levels level-menu" :aria-label="`Map level. You are in ${mapCrumbText(cityName, cityId)}`" :data-open="open || undefined" @keydown="arrows">
    <button ref="chip" type="button" class="map-levels-cur level-menu-cur" data-tour="map-world" :aria-expanded="open" aria-controls="map-levels-list" :aria-label="`Map level: ${cityName}. Show ${levelLabels}`" @click="open = !open"><GameIcon inline name="globe" /><span>{{ cityName }}</span><GameIcon inline name="chevron-down" /></button>
    <ol id="map-levels-list">
      <li v-for="level in levels" :key="level.id" :data-level="level.id">
        <button
          type="button" :data-map-level="level.id" :aria-current="level.current ? 'true' : undefined"
          :title="level.atlas === null ? 'You are here' : level.id === 'world' ? `World map · ${openCities} cities open` : `Map of ${level.label}`" @click="go(level)"
        ><GameIcon v-if="level.id === 'world'" inline name="globe" /><span>{{ level.label }}</span></button>
      </li>
    </ol>
  </nav>
</template>
