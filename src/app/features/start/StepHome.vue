<script setup lang="ts">
// Step 4, "Where do you live?": state → city → local government, from data (placesModel.ts). Only
// the places that are open can be chosen; the others are listed as coming, never as controls. The
// area can be found on this device or picked from the list; the free starter house you get there
// is shown. Nothing is sent from here: the choice goes into the draft and rides with the move-in.
//
// LOCATION PRIVACY. "Find my area" works the local government out on this device
// (world/lgaCardModel.ts findLga): the position is never stored, logged or sent, only the local
// government the player confirms.
import '../../../ui/panels/world.css'
import { computed, nextTick, ref, watch } from 'vue'
import { DEFAULT_STYLE } from '../../../game/content/world.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { useApp } from '../../state/app.ts'
import HouseArt from '../world/HouseArt.vue'
import { findLga, lgaCardUi as ui } from '../world/lgaCardModel.ts'
import type { AreaChoice } from './onboardingModel.ts'
import { PLACES, cityOpen, firstOpen, groupLgas, stateOpen, unitOf } from './placesModel.ts'

const area = defineModel<AreaChoice | undefined>({ required: true })
const { game } = useApp()
const estate = computed(() => game.view.value.estate)

const start = firstOpen()
const stateId = ref(start?.state.id ?? '')
const cityId = ref(start?.city.id ?? '')
const country = PLACES[0]
const states = computed(() => country?.states ?? [])
const openStates = computed(() => states.value.filter(stateOpen))
const stateNow = computed(() => states.value.find((item) => item.id === stateId.value) ?? null)
const openCities = computed(() => (stateNow.value?.cities ?? []).filter((item) => cityOpen(item.id)))
const soon = computed(() => [...states.value.flatMap((item) => item.cities.filter((city) => !cityOpen(city.id)))])
const cityNow = computed(() => stateNow.value?.cities.find((item) => item.id === cityId.value) ?? null)
const here = computed(() => cityNow.value !== null && cityNow.value.id === estate.value.city)
const unit = computed(() => unitOf(cityId.value))

function pickState(id: string): void {
  stateId.value = id
  const next = states.value.find((item) => item.id === id)?.cities.find((city) => cityOpen(city.id))
  if (next) cityId.value = next.id
}

const query = ref('')
const groups = computed(() => groupLgas(estate.value.city, estate.value.lgas, query.value))
const picked = computed(() => estate.value.lgas.find((item) => item.id === area.value?.lga) ?? null)
// A found answer is asked about only until the player has chosen.
const found = computed(() => (ui.found && !picked.value ? ui.found : null))

// The answer can land below the fold of a short window: bring it into view, so its two buttons are seen.
const foundBox = ref<HTMLElement | null>(null)
watch(found, async (now) => {
  if (!now) return
  await nextTick()
  // Only the step's own scroller moves (scrollIntoView would also shift the clipped page around it).
  const box = foundBox.value, scroller = box?.closest<HTMLElement>('.cr-scroll')
  if (!box || !scroller) return
  const room = box.getBoundingClientRect(), view = scroller.getBoundingClientRect()
  const top = scroller.scrollTop + (room.top - view.top) - (view.height - room.height) / 2
  scroller.scrollTo({ top: Math.max(0, top), behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
})

function choose(id: string): void { area.value = { lga: id, via: 'manual' }; Object.assign(ui, { found: null, note: '' }) }
function yes(): void { if (ui.found) { area.value = { lga: ui.found.id, via: 'device' }; Object.assign(ui, { found: null, note: '' }) } }
function no(): void { Object.assign(ui, { found: null, note: '' }) }
async function find(): Promise<void> { area.value = undefined; await findLga(ui, estate.value.city) }
function surprise(): void {
  const all = estate.value.lgas
  const item = all[Math.floor(Math.random() * all.length)]
  if (item) choose(item.id)
}
</script>

<template>
  <div class="cr-home" data-lga-card>
    <nav class="cr-places" aria-label="Where in the world">
      <ol>
        <li>{{ country?.name }}</li>
        <li v-if="openStates.length <= 1">{{ stateNow?.name }}</li>
        <li v-if="openStates.length <= 1">{{ cityNow?.name }}</li>
      </ol>
      <div v-if="openStates.length > 1" class="cr-chips" role="group" aria-label="State">
        <button v-for="item in openStates" :key="item.id" type="button" class="cr-chip" :aria-pressed="item.id === stateId" @click="pickState(item.id)">{{ item.name }}</button>
      </div>
      <div v-if="openCities.length > 1" class="cr-chips" role="group" aria-label="City">
        <button v-for="item in openCities" :key="item.id" type="button" class="cr-chip" :aria-pressed="item.id === cityId" @click="cityId = item.id">{{ item.name }}</button>
      </div>
      <p v-if="soon.length" class="cr-soon">More places are opening: <span v-for="item in soon" :key="item.id">{{ item.name }}</span></p>
    </nav>

    <div class="cr-house" :class="{ 'is-empty': !picked }" data-cr-house>
      <HouseArt :look="DEFAULT_STYLE" tier="starter" />
      <div>
        <strong>{{ picked ? `Your starter house in ${picked.name}` : 'Your free starter house' }}</strong>
        <p v-if="picked" data-cr-lga-line>{{ picked.line }}</p>
        <p>One good room on a plot of your own, furnished, with food in the kitchen. No rent, ever. Your start cash comes from the birth lottery, rolled when you start.</p>
      </div>
    </div>

    <template v-if="here">
      <div class="cr-find">
        <button type="button" class="cr-btn is-primary" data-key="area:find" :disabled="ui.finding" @click="find"><GameIcon name="pin" inline /> {{ ui.finding ? 'Finding…' : 'Find my area' }}</button>
        <button type="button" class="cr-btn" data-key="area:random" @click="surprise"><GameIcon name="game" inline /> Pick for me</button>
      </div>
      <p class="cr-note">Worked out on this device. Your position is never sent or stored: only the {{ unit }} you confirm.</p>
      <div v-if="found" ref="foundBox" class="cr-found" role="status">
        <p>{{ found.sure ? 'You are in' : 'Nearest to you is' }} <b>{{ found.name }}</b>. Is that right?</p>
        <div class="cr-row"><button type="button" class="cr-btn is-primary" data-key="area:yes" @click="yes">Yes, {{ found.name }}</button><button type="button" class="cr-btn" data-key="area:no" @click="no">No, let me pick</button></div>
      </div>
      <p v-if="ui.note" class="cr-note is-warn" role="status">{{ ui.note }}</p>

      <label class="cr-field">Or choose from the {{ estate.lgas.length }} {{ unit }}s of {{ estate.cityName }}
        <input v-model="query" type="search" name="area-search" placeholder="Search by name" autocomplete="off" data-key="area:search">
      </label>
      <div v-for="group in groups" :key="group.zone" class="cr-lgas">
        <h3 v-if="group.title">{{ group.title }}</h3>
        <div class="cr-cards is-areas" role="group" :aria-label="group.title || estate.cityName">
          <button v-for="item in group.items" :key="item.id" type="button" class="cr-card" :data-lga="item.id" :data-key="`area:${item.id}`" :aria-pressed="area?.lga === item.id" @click="choose(item.id)"><strong>{{ item.name }}</strong><small>{{ item.line }}</small></button>
        </div>
      </div>
      <p v-if="!groups.length" class="cr-note" role="status">No {{ unit }} matches “{{ query }}”.</p>
    </template>
  </div>
</template>
