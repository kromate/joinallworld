<script setup lang="ts">
import { civicOffice } from '../../../game/cities/terminology.ts'
// The venue card on the Map: hours, mode tiles, the trip line, Go, a copy-link share and "About"
// (description and things to do) folded away. Whatever stops the trip is said ON the card, with the
// one-tap way out (Reconnect, Cancel, Trek instead). Go sends the 'travel' action; the shell then
// shows the trip on the map, and the card makes way for the trip bar.
import { computed } from 'vue'
import type { TravelDestination } from '../../../types/view.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import GoFix from './GoFix.vue'
import { CHIP_LIMIT, chosenMode, fareText, goBlock, statusClass, tripLine, venueLink } from './travelModel.ts'
import { mapUi, tell } from './travelState.ts'
import { useTravelActions } from './useTravelActions.ts'
import { useCrowd } from './useCrowd.ts'
import { copyText } from '../../../ui/share.ts'

const props = defineProps<{ item: TravelDestination }>()
const { game, shell } = useApp()
const { travel, pending } = useTravelActions()

const chosen = computed(() => chosenMode(props.item, mapUi.mode, game.view.value.travel.defaultMode))
const block = computed(() => goBlock(game.state.value, game.view.value, props.item, chosen.value))
const chips = computed(() => (mapUi.showAll ? props.item.preview : props.item.preview.slice(0, CHIP_LIMIT)))
const more = computed(() => props.item.preview.length - chips.value.length)
const crowd = useCrowd()

function back(): void {
  mapUi.destination = null
  mapUi.mode = null
  mapUi.showAll = false
  tell({ selected: null, layout: true })
}
function go(): void {
  const mode = chosen.value
  if (block.value || !mode) return
  // Leaving on a trip clears the selection: the card makes way for the trip bar and the map shows the trip.
  // (If the server refuses it, its reason is a toast and the place is one tap away.)
  mapUi.destination = null
  tell({ selected: null })
  void travel(props.item.id, mode.id)
}
async function share(): Promise<void> {
  const link = venueLink(window.location.origin, window.location.pathname, props.item.id)
  if (await copyText(link)) game.toast('Link copied. Anyone who opens it lands on this place.', 'good')
  else game.toast(`Copy this link: ${link}`)
}
const onAbout = (event: Event): void => { mapUi.aboutOpen = (event.currentTarget as HTMLDetailsElement).open }
</script>

<template>
  <div class="map-panel map-card" role="region" :aria-label="item.label">
    <header class="map-card-head">
      <button type="button" class="life-icon-button" aria-label="Back to the map and the list of places" @click="back"><GameIcon bare name="back" /></button>
      <span class="map-card-icon" aria-hidden="true"><GameIcon inline kind="venue" :id="item.id" :emoji="item.icon" /></span>
      <div><h1>{{ item.label }}</h1><p>{{ item.district }}{{ item.band ? ` · ${item.band}` : '' }}</p></div>
      <button type="button" class="life-icon-button" :aria-label="`Copy a link to ${item.label}`" :title="`Copy a link to ${item.label}`" @click="share"><GameIcon bare name="link" /></button>
    </header>
    <p class="map-status" :class="statusClass(item)"><b>{{ item.status }}</b><template v-if="item.open && item.hours !== item.status">{{ ' ' }}<span>{{ item.hours }}</span></template><span v-if="crowd[item.id]" class="map-list-crowd" :data-crowd="item.id"> · {{ crowd[item.id] }}</span></p>
    <div v-if="item.modes.length" class="map-modes" role="group" aria-label="How to travel">
      <!-- A tile is dead only when no mode can go there (closed, already here). Being busy or offline is said once, on the card. -->
      <button
        v-for="option in item.modes" :key="option.id" type="button" :aria-pressed="option === chosen"
        :class="{ 'is-selected': option === chosen, 'is-short': option.blocked && !item.blocked }"
        :disabled="Boolean(item.blocked)" :title="item.blocked ? item.blocked.reason : option.blurb || ''"
        :aria-label="`${option.label}, ${fareText(option)}, ${option.seconds} seconds`" @click="mapUi.mode = option.id"
      >
        <span aria-hidden="true"><GameIcon inline kind="mode" :id="option.id" :emoji="option.icon" /></span><b>{{ option.label }}</b><small>{{ fareText(option) }}</small><small class="map-mode-time">{{ option.seconds }}s</small>
      </button>
    </div>
    <p v-if="chosen && !item.blocked" class="map-trip">{{ tripLine(chosen) }}</p>
    <div v-if="block" class="map-why" :class="`is-${block.code}`" role="note">
      <p>{{ block.reason }}</p>
      <GoFix v-if="block.fix" :fix="block.fix" look="map-fix" @mode="mapUi.mode = $event" />
    </div>
    <button v-if="block || !chosen" type="button" class="map-go" disabled :aria-label="`Cannot go: ${block?.label || 'unavailable'}`">{{ block ? block.label : '' }}</button>
    <button v-else type="button" class="map-go" :disabled="pending !== null" @click="go">Go · {{ fareText(chosen) }} <span aria-hidden="true">→</span></button>
    <button v-if="item.id === 'state-house'" type="button" class="map-chip-button" @click="shell.open('state-house')"><GameIcon inline name="governor" /><span>Who governs? Open the {{ civicOffice(game.view.value.cityId) }}</span></button>
    <button v-else-if="item.id === 'polling-unit'" type="button" class="map-chip-button" @click="shell.open('governor')"><GameIcon inline name="ballot" /><span>Election: candidates, voting and results</span></button>
    <details v-if="item.description || chips.length" class="ui-details map-about" :open="mapUi.aboutOpen" @toggle="onAbout">
      <summary>About{{ item.preview.length ? ` · ${item.preview.length} things to do` : '' }}</summary>
      <p class="map-desc">{{ item.description || '' }}</p>
      <p v-if="item.ambient" class="map-ambient">{{ item.ambient }}</p>
      <div v-if="chips.length" class="map-chips" aria-label="Things to do here">
        <span v-for="label in chips" :key="label">{{ label }}</span>
        <button v-if="more > 0" type="button" @click="mapUi.showAll = true">+{{ more }} more</button>
      </div>
    </details>
  </div>
</template>
