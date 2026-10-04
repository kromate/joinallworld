<script setup lang="ts">
// A local government's page: how many live there, who is online, the directory (search by name,
// 25 a page, never the whole list) and a way onto the map. Opened as a modal from the map with
// { lga }. A player who does not yet live here (or lives elsewhere) also gets the card to choose
// or move.
//
// The counts and the first page of residents are read when the page opens (and again after a new
// search, the online filter or a retry); "Show more" reads the page after the last one. Names are
// text: nothing a player typed is ever markup. Players who hide themselves from the directory are
// not listed; their houses stay on the map without a name.
import '../../../ui/controls.css'
import { computed, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import { hueOf, initialOf } from '../../ui/format.ts'
import LgaCard from './LgaCard.vue'
import { addressLabel, lgaOf } from './worldContent.ts'
import { count, createLgaDirectory, emptyPeopleText, focusMap, lgaParam, track } from './worldModel.ts'
import type { LgaDirectory } from './worldModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const directory = useDirectory()

const id = computed(() => lgaParam(props.params))
const city = computed(() => game.cityId.value)
const unit = computed(() => (id.value ? lgaOf(city.value, id.value) : null))
const page = computed(() => (id.value ? directory.pageOf(id.value) : null))
const estate = computed(() => game.view.value.estate)
const yours = computed(() => Boolean(estate.value.placed && estate.value.lga?.id === id.value))
const needsLoad = computed(() => Boolean(unit.value && page.value && page.value.items === null && !page.value.loading && !page.value.error))
// Opened (or the card chose a house and cleared the list): read the first page, once.
watch(needsLoad, (needed) => { if (needed && id.value) { track('estate_viewed', { lga: id.value }); void directory.load(id.value) } }, { immediate: true })

function submitSearch(event: Event): void {
  if (!id.value || !(event.target instanceof HTMLFormElement)) return
  void directory.search(id.value, new FormData(event.target).get('q')?.toString() ?? '')
}
function showOnMap(): void {
  if (!id.value) return
  shell.open('map')
  focusMap({ lga: id.value })
}
function showMyHouse(): void {
  const plot = estate.value.plot
  if (!plot) return
  shell.open('map')
  focusMap({ plot: { lga: plot.lga, estate: plot.estate, plot: plot.plot } })
}
function sayHi(playerId: string, name: string): void {
  track('neighbour_card_opened', { from: 'directory' })
  shell.open('person', { player: playerId, name })
}
const addressOf = (estateNumber: number | undefined, plot: number): string => (id.value ? addressLabel(city.value, id.value, estateNumber ?? 0, plot) : '')
</script>

<script lang="ts">
// One directory per page: a search and a filter are still there when the sheet is opened again.
let shared: LgaDirectory | null = null
function useDirectory(): LgaDirectory {
  const { game } = useApp()
  shared ??= createLgaDirectory({ fetchJson: game.fetchJson, cityId: () => game.cityId.value })
  return shared
}
</script>

<template>
  <p v-if="!unit || !id || !page" class="ui-error">That local government is not on this map.</p>
  <div v-else class="ui-stack" style="--gap: 16px" :data-lga-page="id">
    <section class="ui-hero"><small>{{ game.view.value.city?.name ?? '' }} · local government{{ yours ? ' · yours' : '' }}</small><strong>{{ unit.name }}</strong><p>{{ unit.line }}</p></section>
    <ul v-if="page.info" class="ui-tiles">
      <li><b>{{ count(page.info.residents) }}</b><small>residents</small></li>
      <li><b>{{ count(page.info.houses) }}</b><small>houses</small></li>
      <li><b>{{ count(page.info.online) }}</b><small>online now</small></li>
    </ul>
    <SkeletonRows v-else :rows="1" label="Loading the counts" />
    <div class="ui-cluster">
      <button class="ui-button is-quiet" type="button" @click="showOnMap"><GameIcon name="map" inline /><span>Show on the map</span></button>
      <button v-if="yours && estate.plot" class="ui-button is-quiet" type="button" @click="showMyHouse"><GameIcon name="home" inline /><span>Show my house</span></button>
    </div>
    <LgaCard v-if="!yours" :heading="estate.placed ? 'Move here?' : 'Live here?'" compact @chosen="page.items = null" />
    <SectionTitle>Residents</SectionTitle>
    <form class="ui-stack is-tight" @submit.prevent="submitSearch">
      <div class="ui-search">
        <input name="q" type="search" maxlength="24" :value="page.q" autocomplete="off" aria-label="Search residents by name" placeholder="Search by name">
        <button type="submit"><GameIcon name="search" inline /><span>Search</span></button>
      </div>
      <div class="ui-cluster"><button type="button" class="ui-button is-small" :aria-pressed="page.online" @click="directory.toggleOnline(id)">{{ page.online ? 'Showing online now' : 'Online now only' }}</button></div>
    </form>
    <template v-if="page.error">
      <p class="ui-error">{{ page.error }}</p>
      <button class="ui-button" type="button" @click="directory.restart(id)">Try again</button>
    </template>
    <SkeletonRows v-else-if="page.items === null" :rows="4" label="Loading residents" />
    <p v-else-if="page.short" class="ui-note">Type at least two letters to search.</p>
    <template v-else-if="page.items.length">
      <ul class="world-people">
        <li v-for="item in page.items" :key="item.id" class="ui-row">
          <span class="ui-avatar" aria-hidden="true" :style="{ '--hue': hueOf(item.id) }">{{ initialOf(item.name) }}</span>
          <span class="ui-row-body"><b><i class="world-dot" :class="{ 'is-on': item.online }" />{{ item.name }}{{ item.you ? ' (you)' : '' }}</b><small>{{ item.plot !== undefined ? addressOf(item.estate, item.plot) : 'Moving in' }}</small></span>
          <button v-if="!item.you" class="ui-button is-small" type="button" :aria-label="`Say hi to ${item.name}`" @click="sayHi(item.id, item.name)">Say hi</button>
        </li>
      </ul>
      <button v-if="page.next !== null" class="ui-button is-block" type="button" :disabled="page.loading" @click="directory.load(id, true)">{{ page.loading ? 'Loading…' : 'Show more' }}</button>
    </template>
    <p v-else class="ui-note">{{ emptyPeopleText(page) }}</p>
    <p class="ui-note">Players who hide themselves from the directory are not listed here; their houses stay on the map without a name.</p>
  </div>
</template>

<style scoped>
.world-people { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.world-people .ui-row { align-items: center; }
.world-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #c2c8cc; margin-right: 6px; }
.world-dot.is-on { background: #33d17a; }
</style>
