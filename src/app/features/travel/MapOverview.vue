<script setup lang="ts">
// The Map's overview: a handle (collapsed by default on a phone, so nothing covers the city), the
// filter chips and, when opened, the layer toggles and the list of every place: the keyboard and
// screen-reader alternative to pointing at a building. What a switched-on layer shows stays
// readable with the list closed, where the layer itself is in view.
import { computed } from 'vue'
import { cityRules } from '../../../game/cities/registry.ts'
import type { AdsResponse, GovResponse } from '../../../types/civic.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { adsKey, govKey } from '../civic/civicModel.ts'
import { useCivic } from '../civic/useCivic.ts'
import LayerNotes from './LayerNotes.vue'
import { FILTERS, LAYERS, layerNote, matchesFilter, overviewLine, statusClass } from './travelModel.ts'
import type { LayerData, LayerId, LayerNote } from './travelModel.ts'
import { linkWords } from './travelBoundary.ts'
import { isListOpen, layers, mapUi, tell, wide } from './travelState.ts'
import { useCrowd } from './useCrowd.ts'

const { game, shell } = useApp()
const civic = useCivic()
const view = game.view

// The sea-plot layer is not offered on the map for now.
const availableLayers = computed(() => LAYERS.filter(item => item.id !== 'sea'))
const open = computed(() => isListOpen())
const destinations = computed(() => view.value.travel.destinations)
const places = computed(() => destinations.value.filter((item) => matchesFilter(item, mapUi.filter)))
const weather = computed(() => view.value.health?.weather ?? null)
const trip = computed(() => {
  const active = game.state.value.activeAction
  return active?.kind === 'travel' ? destinations.value.find((item) => item.id === active.id) ?? null : null
})
const line = computed(() => overviewLine(destinations.value, trip.value, weather.value?.label ?? null))
const filterLabel = computed(() => FILTERS.find((item) => item.id === mapUi.filter)?.label || mapUi.filter)
const notes = computed((): LayerNote[] => {
  const why = linkWords(view.value)?.why ?? ''
  return availableLayers.value.filter((item) => layers[item.id]).flatMap((item) => {
    const cached: LayerData = item.key === 'ads' ? civic.entry<AdsResponse>(adsKey(view.value.cityId)) : item.key === 'gov' ? civic.entry<GovResponse>(govKey(view.value.cityId)) : { data: null, error: null }
    const note = layerNote(item, cached, view.value.connected, why)
    return note ? [note] : []
  })
})

// Who is at each place right now: part of the line under the name, so no row changes size.
const crowd = useCrowd()

function toggleList(): void { mapUi.listOpen = !isListOpen() }
function choose(id: string): void { mapUi.filter = id; tell({ filter: id }) }
function toggleLayer(id: LayerId): void {
  layers[id] = !layers[id]
  if (layers[id] && !wide()) mapUi.listOpen = false // on a phone the list makes way, so the layer just switched on can be seen
  tell({ layers: { ...layers } })
}
function pick(id: string): void {
  mapUi.destination = id || null
  mapUi.mode = null
  mapUi.showAll = false
  if (mapUi.destination && !wide()) mapUi.listOpen = false // on a phone the card replaces the list; going back shows the map, not the list
  tell({ selected: mapUi.destination, layout: true })
}
function showWorld(): void {
  mapUi.layer = 'world'
  tell({ layer: 'world' })
  shell.open('map', { layer: 'world' }) // re-opening makes the host swap the backdrop
}
</script>

<template>
  <div class="map-panel map-overview" data-tour="map-card" :class="open ? 'is-open' : 'is-collapsed'">
    <button type="button" class="map-handle" :aria-expanded="open" aria-controls="map-list" @click="toggleList">
      <span class="map-grip" aria-hidden="true" />
      <span class="map-handle-text"><b>{{ view.city?.name || 'City' }} map</b><small><template v-if="!trip && weather"><GameIcon inline kind="weather" :id="weather.id" :emoji="weather.icon" />{{ ' ' }}</template>{{ line }}</small></span>
      <span class="map-handle-cta"><GameIcon bare name="list" /><span>{{ open ? 'Hide list' : 'List' }}</span></span>
    </button>
    <div class="map-filters" role="group" aria-label="Filter places">
      <button v-for="item in FILTERS" :key="item.id" type="button" :aria-pressed="item.id === mapUi.filter" :class="{ 'is-selected': item.id === mapUi.filter }" @click="choose(item.id)">{{ item.label }}</button>
    </div>
    <LayerNotes v-if="!open" :notes="notes" />
    <div id="map-list" class="map-more" :hidden="!open">
      <div class="map-filters map-layers" role="group" aria-label="Map layers">
        <button v-for="item in availableLayers" :key="item.id" type="button" :aria-pressed="layers[item.id]" :class="{ 'is-selected': layers[item.id] }" @click="toggleLayer(item.id)"><GameIcon inline :name="item.icon" /><span>{{ item.label }}</span></button>
      </div>
      <LayerNotes :notes="notes" />
      <ul v-if="places.length" class="map-list" aria-label="Places">
        <li v-for="item in places" :key="item.id">
          <button type="button" :class="[statusClass(item), { 'is-here': item.here }]" @click="pick(item.id)">
            <span aria-hidden="true"><GameIcon inline kind="venue" :id="item.id" :emoji="item.icon" /></span>
            <span class="map-list-text"><b>{{ item.label }}</b><small>{{ item.district }}<span v-if="crowd[item.id]" class="map-list-crowd" :data-crowd="item.id"> · {{ crowd[item.id] }}</span></small></span>
            <em>{{ item.here ? 'You are here' : item.open ? 'Open' : 'Closed' }}</em>
          </button>
        </li>
      </ul>
      <div v-else class="ui-empty">
        <span aria-hidden="true"><GameIcon inline name="search" /></span>
        <h3>Nothing matches “{{ filterLabel }}” right now</h3>
        <p>Closed places open again later in the day.</p>
        <button type="button" class="ui-button is-primary" @click="choose('all')">Show every place</button>
      </div>
      <button type="button" class="map-chip-button map-world" data-tour="map-world" @click="showWorld"><GameIcon inline name="globe" /><span>Nigeria map · more cities soon</span></button>
    </div>
  </div>
</template>
