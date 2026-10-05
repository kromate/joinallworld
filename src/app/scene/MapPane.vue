<script setup lang="ts">
// The two maps behind the Map panel: the city map (the 3D miniature in src/map3d, or the flat one
// where WebGL is missing) and the country map. Both are the existing hosts, fetched the first
// time the Map opens (or a trip starts). What the Map panel says to the city map before it exists
// is kept and replayed, as before.
//
// Like the venue scene, the maps draw on demand: hidden, the city map draws nothing.
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
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
/** What the atlas was asked to show when it comes to the front: a level (0 the world … 2 Nigeria) or a city's card. */
let wanted: { level?: number; city?: string } | null = null
const onLayer = (event: Event): void => {
  const detail = (event as CustomEvent<{ layer?: string; level?: number; city?: string }>).detail
  const layer = detail?.layer
  if (layer !== 'world' && layer !== 'city') return
  worldLayer.value = layer === 'world'
  if (layer === 'world' && (typeof detail?.level === 'number' || typeof detail?.city === 'string')) { wanted = { ...(typeof detail.level === 'number' ? { level: detail.level } : {}), ...(typeof detail.city === 'string' ? { city: detail.city } : {}) }; aim() }
}
/** Point the atlas at what was asked for, once it exists and is in front. */
function aim(): void {
  const world = scene.world.value
  if (!world || !wanted || !mapOpen() || !worldLayer.value) return
  const { level, city } = wanted
  wanted = null
  // After the atlas has its first level and the shell has drawn, so it measures the screen it is shown on.
  void world.ready.then(() => nextTick()).then(() => {
    world.resize()
    if (typeof level === 'number') world.goLevel(level)
    if (city) world.selectCity(city)
  })
}
window.addEventListener('jaw:map-ui', onLayer)
let loading: Promise<void> | null = null

const mapOpen = (): boolean => game.mode.value === 'map'
function show(): void {
  const city = scene.city.value
  // Told after the shell has drawn, so the map measures the panel it shares the screen with.
  city?.setShown(mapOpen() && !worldLayer.value)
  if (mapOpen()) { scene.world.value?.resize(); city?.resize(); aim() }
}
function load(): Promise<void> {
  loading ??= loadMaps().then(({ createCityView, createWorldMap }) => {
    if (!cityBox.value || !worldBox.value) return
    scene.world.value = createWorldMap(worldBox.value, {
      onOpenCity: () => { worldLayer.value = false; showMapLayer('city') },
      onEnterCity: (cityId) => { void switchCity(cityId) },
      onInspectVenue: (cityId, venueId) => {
        if (cityId !== game.cityId.value) return
        worldLayer.value = false
        showMapLayer('city')
        shell.open('map', { destination: venueId })
      },
      // One character travels between cities: an ordinary game action, refused with its reason while the city is not open.
      onTravel: (to, mode) => { void command('estate.relocate', { to: to as WorldCityId, mode: mode as CityLinkMode }) }, // (the Atlas names the ids; the server validates them)
      // Each route also says what arriving at once would add to its fare ('travel.skip'): free for a character that has never skipped.
      routes: () => viewLife(game.state.value, { now: game.state.value.t, cityId: game.cityId.value }).estate?.links?.map((link) => ({ ...link, skipFree: game.state.value.travel.skipped !== true })) ?? null,
      wallet: () => game.state.value.cash,
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
    // The wider levels are fetched while nothing else is going on, so the first look at Africa or the world does not wait.
    const idle = (globalThis as { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback
    if (idle) idle(() => scene.world.value?.warm(), { timeout: 5000 }); else globalThis.setTimeout(() => scene.world.value?.warm(), 2500)
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
