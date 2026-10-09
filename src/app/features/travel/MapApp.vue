<script setup lang="ts">
// The Map panel (nav): the sheet beside the city map. The map itself (src/app/scene/MapPane.vue:
// the 3D miniature, or the flat one, and the country map) is the screen; this panel is told about
// and tells it through the window event 'jaw:map-ui' { layer?, filter?, selected?, layers?, ads?,
// gov?, layout? }.
//
//   overview   a handle, the filter chips and, opened, the layer toggles and the list of places
//   card       a place picked on the map or in the list: hours, modes, Go, About (VenueCard)
//   trip bar   WHILE A TRIP IS RUNNING the panel is a slim bar: from → to, how, time left, Cancel
//   levels     the bar at the top (MapLevels): World › Africa › Nigeria › the city; a wider level swaps the backdrop
//              to the atlas, which draws the same bar itself. A trip between cities keeps its trip bar there
//
// Open with a destination: shell.open('map', { destination: venueId }); with the atlas:
// shell.open('map', { layer: 'world', level?, city? }) (app.showMapLayer). Esc with a card open goes back to the map; a second Esc
// leaves the Map. Everything shown comes from view.travel (src/game/systems/travel.ts).
//
// MAP LAYERS (Moving · Billboards · Sea · Neighbours · Gov): each toggle draws one civic overlay
// on the city map from its own server response (GET /api/civic/ads and /gov, cached by the civic
// client, never from a timer). The panel only passes the data on; the map draws it.
import '../../../ui/panels/map.css'
import { computed, onBeforeUnmount, watch } from 'vue'
import type { AdsResponse, GovResponse } from '../../../types/civic.ts'
import { useApp } from '../../state/app.ts'
import { adsKey, adsPath, govKey, govPath } from '../civic/civicModel.ts'
import { useCivic } from '../civic/useCivic.ts'
import { cityName } from '../../../game/cities/registry.ts'
import MapLevels from './MapLevels.vue'
import MapOverview from './MapOverview.vue'
import TripBar from './TripBar.vue'
import VenueCard from './VenueCard.vue'
import { DATA_LAYERS, asMapParams, layoutKey, LAYERS, tripInfo } from './travelModel.ts'
import type { MapUiDetail } from './travelModel.ts'
import { isListOpen, layers, mapUi, seen, tell, trackWide } from './travelState.ts'

const props = defineProps<{ params?: unknown }>()
const { game } = useApp()
const civic = useCivic()
const view = game.view

// The city changed, or the Map was opened with a place or a layer: take it in once per params object.
function reconcile(): void {
  const cityId = game.cityId.value
  if (cityId !== seen.city) { seen.city = cityId; mapUi.layer = 'city'; mapUi.destination = null }
  const params = asMapParams(props.params)
  if (params && props.params !== seen.params) {
    seen.params = props.params
    if ('destination' in params) { mapUi.destination = params.destination ?? null; mapUi.mode = null; mapUi.showAll = false; mapUi.layer = 'city' }
    if (params.layer === 'world' || params.layer === 'city') mapUi.layer = params.layer
  }
}
watch([() => game.cityId.value, () => props.params], reconcile, { immediate: true, flush: 'sync' })

const item = computed(() => view.value.travel.destinations.find((entry) => entry.id === mapUi.destination) ?? null)
const trip = computed(() => tripInfo(game.state.value, view.value, (id) => cityName(id) ?? id))

// ---- telling the city map ----------------------------------------------------------------------
const adsEntry = computed(() => civic.entry<AdsResponse>(adsKey(game.cityId.value)))
const govEntry = computed(() => civic.entry<GovResponse>(govKey(game.cityId.value)))
/** Changes when the map should be told again: a layer, a place, the layout, a layer's data arriving, the connection. */
const stamp = computed(() => [
  mapUi.layer, mapUi.destination ?? '', isListOpen(), Boolean(trip.value), game.connected.value, game.cityId.value,
  LAYERS.map((layer) => `${layer.id}:${layers[layer.id]}`).join(','), adsEntry.value.at, govEntry.value.at,
].join('|'))

function syncMap(): void {
  // Layers: load what is switched on (cached; never from a timer) and hand the map what there is.
  const cityId = game.cityId.value
  const detail: MapUiDetail = { layers: { ...layers }, layer: mapUi.layer }
  for (const layer of DATA_LAYERS.filter((option) => layers[option.id])) {
    if (layer.key === 'gov') { void civic.load<GovResponse>(govKey(cityId), govPath(cityId), { maxAge: 30000 }); detail.gov = govEntry.value.data }
    else { void civic.load<AdsResponse>(adsKey(cityId), adsPath(cityId), { maxAge: 30000 }); detail.ads = adsEntry.value.data }
  }
  // Opened for a place (the Home tab, a goal chip, "Go to work", a pin): highlight it on the city map too.
  const wanted = asMapParams(props.params)?.destination
  if (wanted && wanted === mapUi.destination) detail.selected = mapUi.destination
  else if (wanted === null && mapUi.destination === null) detail.selected = null
  // The panel changed shape (list opened or closed, a card came or went): the map re-fits around it.
  const layout = layoutKey({ layer: mapUi.layer, destination: mapUi.destination, listOpen: isListOpen(), layersOn: LAYERS.filter((layer) => layers[layer.id]).length, tripping: Boolean(trip.value) })
  if (layout !== seen.layout) { seen.layout = layout; detail.layout = true }
  tell(detail)
}
watch([stamp, () => props.params], syncMap, { immediate: true, flush: 'post' })
const stopWide = trackWide()
onBeforeUnmount(stopWide)

/** Esc with a venue card open goes back to the map; a second Esc leaves the Map. */
function keys(action: string): boolean {
  // On the world map Esc belongs to the atlas first: it closes its sheet, then goes up one level.
  if (action === 'cancel' && mapUi.layer === 'world') {
    const offer = new CustomEvent('jaw:atlas-escape', { cancelable: true })
    window.dispatchEvent(offer)
    return offer.defaultPrevented
  }
  if (action !== 'cancel' || !mapUi.destination || mapUi.layer !== 'city') return false
  mapUi.destination = null
  tell({ selected: null, layout: true })
  return true
}
defineExpose({ keys })
</script>

<template>
  <template v-if="mapUi.layer === 'world'">
    <h1 class="ui-sr">World map. Explore cities and travel routes.</h1>
    <TripBar v-if="trip?.locked" :trip="trip" />
  </template>
  <template v-else>
    <!-- One column: the level bar above, the docked panel below it, so no state of the panel can slide under the bar. A trip bar is not docked. -->
    <div class="map-dock">
      <MapLevels />
      <p class="map-data-credit" aria-label="Map data sources">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
        <a href="https://github.com/kromate/joinallworld/tree/a4c14a1e225404cd2cfe1d8d74ee5c2a2b516b4e/src/game/cities" target="_blank" rel="noopener noreferrer">Source data</a>
      </p>
      <template v-if="!trip?.locked">
        <VenueCard v-if="item" :item="item" />
        <MapOverview v-else-if="!trip" />
      </template>
    </div>
    <TripBar v-if="trip && (trip.locked || !item)" :trip="trip" />
  </template>
</template>
