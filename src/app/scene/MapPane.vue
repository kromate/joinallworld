<script setup lang="ts">
// The two maps behind the Map panel: the city map (the 3D miniature in src/map3d, or the flat one
// where WebGL is missing) and the country map. Both are the existing hosts, fetched the first
// time the Map opens (or a trip starts). What the Map panel says to the city map before it exists
// is kept and replayed, as before.
//
// Like the venue scene, the maps draw on demand: hidden, the city map draws nothing.
import { onBeforeUnmount, ref, watch } from 'vue'
import { useApp } from '../state/app.ts'
import { loadMaps } from './loaders.ts'
import { viewLife } from '../../life.ts'
import { telemetry } from '../../telemetry/index.ts'
import { noteChunkFailure } from '../state/updateNotice.ts'
import type { CityLinkMode, WorldCityId } from '../../types/life.ts'

const { game, shell, scene, switchCity, playerLook, heldCities, command, showMapLayer, showFriends, showLive } = useApp()
const cityBox = ref<HTMLElement | null>(null)
const worldBox = ref<HTMLElement | null>(null)
/** Which layer is in front: the country map while the city map says it is not ready. */
const worldLayer = ref(false)
const mapUi: Record<string, unknown> = {}
const keepMapUi = (event: Event): void => { Object.assign(mapUi, (event as CustomEvent<Record<string, unknown>>).detail ?? {}) }
window.addEventListener('jaw:map-ui', keepMapUi)
const onLayer = (event: Event): void => { const layer = (event as CustomEvent<{ layer?: string }>).detail?.layer; if (layer === 'world' || layer === 'city') worldLayer.value = layer === 'world' }
window.addEventListener('jaw:map-ui', onLayer)
let loading: Promise<void> | null = null

const mapOpen = (): boolean => game.mode.value === 'map'
function show(): void {
  const city = scene.city.value
  // Told after the shell has drawn, so the map measures the panel it shares the screen with.
  city?.setShown(mapOpen() && !worldLayer.value)
  if (mapOpen()) { scene.world.value?.resize(); city?.resize() }
}
function load(): Promise<void> {
  loading ??= loadMaps().then(({ createCityView, createWorldMap }) => {
    if (!cityBox.value || !worldBox.value) return
    scene.world.value = createWorldMap(worldBox.value, {
      onOpenCity: () => { worldLayer.value = false; showMapLayer('city') },
      onEnterCity: (cityId) => { void switchCity(cityId) },
      // One character travels between cities: an ordinary game action, refused with its reason while the city is not open.
      onTravel: (to, mode) => { void command('estate.relocate', { to: to as WorldCityId, mode: mode as CityLinkMode }) }, // (the Atlas names the ids; the server validates them)
      routes: () => viewLife(game.state.value, { now: game.state.value.t, cityId: game.cityId.value }).estate?.links ?? null,
      held: heldCities,
    })
    const city = createCityView(cityBox.value, {
      cityId: game.cityId.value,
      onSelectVenue: (venueId) => { shell.open('map', { destination: venueId }) },
      onSelectGov: () => { shell.open('state-house') },
      onSelectNeighbour: (player) => { shell.open('person', { player: player.id, name: player.name }) },
      // The world layer: a local government opens its page, a house its owner's card; the maps fetch only what is in view.
      onSelectLga: (lga) => { shell.open('lga', { lga }) },
      onSelectHouse: (house) => { shell.open('house-card', { house }) },
      // A friend's pin opens their card (Chat, Call); a pin that stands for several opens the people list.
      onSelectPeople: (ids) => { if (ids.length === 1) shell.open('person', { player: ids[0] }); else shell.open('people') },
      fetchJson: game.fetchJson,
      // The avatar reached the door: ask the server for the arrival now rather than at its next poll.
      onTripDue: () => { void game.refresh() },
      onNotice: (text) => game.toast(text),
    })
    scene.city.value = city
    window.removeEventListener('jaw:map-ui', keepMapUi)
    scene.world.value.setCity(game.cityId.value)
    city.setPlayer(playerLook())
    showFriends()
    city.setState(game.state.value)
    showLive()
    if (Object.keys(mapUi).length) window.dispatchEvent(new CustomEvent('jaw:map-ui', { detail: mapUi }))
    show()
  }).catch((error: unknown) => { loading = null; telemetry.chunkFailed('map', error); void noteChunkFailure(); console.error('The map could not be loaded:', error); game.toast('The map could not be loaded. Check your connection and open it again.', 'error') })
  return loading
}
watch(scene.mapsWanted, (wanted) => { if (wanted) void load() }, { immediate: true, flush: 'post' })
watch([game.mode, worldLayer], show, { flush: 'post' })
// The country map shows which cities this player holds: drawn again when that list changes.
watch(() => heldCities().join(), () => scene.world.value?.refresh?.())
const onResize = (): void => { if (mapOpen()) { scene.world.value?.resize(); scene.city.value?.resize() } }
window.addEventListener('resize', onResize)
onBeforeUnmount(() => {
  window.removeEventListener('jaw:map-ui', keepMapUi); window.removeEventListener('jaw:map-ui', onLayer); window.removeEventListener('resize', onResize)
  scene.city.value?.destroy(); scene.city.value = null; scene.world.value = null
})
</script>

<template>
  <div id="map-scene" ref="worldBox" class="life-scene" :hidden="game.mode.value !== 'map' || !worldLayer" />
  <div id="city-scene" ref="cityBox" class="life-scene" :hidden="game.mode.value !== 'map' || worldLayer" />
</template>
