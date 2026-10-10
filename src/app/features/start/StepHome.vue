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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_STYLE } from '../../../game/content/world.ts'
import { localUnitDescription } from '../../../game/cities/runtime.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { useApp } from '../../state/app.ts'
import HouseArt from '../world/HouseArt.vue'
import { findLga, lgaCardUi as ui } from '../world/lgaCardModel.ts'
import type { AreaChoice } from './onboardingModel.ts'
import { PLACES, placesForCountry, availableCountryDirectory, cityOpen, firstOpen, groupLgas, onCatalogueChanged, prepareCountryPlaces, stateOfCity, stateOpen, unitOf } from './placesModel.ts'
import { cr } from './creatorState.ts'
import { areaForCity, useHomeCity } from './homeCityModel.ts'
import type { LgaCard } from '../../../types/view.ts'

// `choosable`: a life that does not exist yet may start in any open city, so the city chips choose where it will be born
// (the choice is kept in cr.city and rides with Play). A life that already exists settles where it is.
const props = defineProps<{ choosable?: boolean }>()
const emit = defineEmits<{ ready: [ready: boolean] }>()
const area = defineModel<AreaChoice | undefined>({ required: true })
const { game } = useApp()
const estate = computed(() => game.view.value.estate)

const start = firstOpen()
const first = (props.choosable ? cr.city : null) ?? (stateOfCity(estate.value.city) ? estate.value.city : start?.city.id ?? '')
const stateId = ref(stateOfCity(first)?.id ?? start?.state.id ?? '')
let countrySelection = 0
let countrySelectionPending = false
let directoryRequest = 0
let unmounted = false
const city = useHomeCity(first, (ready) => emit('ready', ready && !countrySelectionPending), (id) => { cr.city = id; validateArea() })
const { cityId, readyCityId, loading, error: loadError } = city
const countryId = ref('ng')
const countryNames = ref<readonly {iso2:string; name:string; status:string}[]>([])
const catalogueVersion = ref(0)
const unsubscribeCatalogue = onCatalogueChanged(() => { catalogueVersion.value++ })
const country = computed(() => { catalogueVersion.value; return placesForCountry(countryId.value)[0] })
const states = computed(() => { catalogueVersion.value; return country.value?.states ?? [] })
const countryPickerOpen = ref(false)
const countryError = ref('')
const failedCountry = ref('')
const countryBusy = ref(false)
async function showCountries(): Promise<void> {
  countryPickerOpen.value = true
  countryError.value = ''
  countryNames.value = []
  const request = ++directoryRequest
  try {
    const countries = await availableCountryDirectory()
    if (unmounted || request !== directoryRequest) return
    countryNames.value = countries
  } catch {
    if (unmounted || request !== directoryRequest) return
    countryError.value = 'We could not load the country list. Check your connection and try again.'
  }
}
async function chooseCountry(iso2: string): Promise<void> {
  const countryInfo = countryNames.value.find(item => item.iso2 === iso2)
  const selectable = countryInfo?.status === 'accepted' || (iso2 === 'ng' && countryInfo?.status === 'legacy')
  if (!countryInfo || !selectable) return
  const request = ++countrySelection
  countryBusy.value = true
  countrySelectionPending = true
  countryError.value = ''
  failedCountry.value = ''
  emit('ready', false)
  try {
    await prepareCountryPlaces(iso2)
    if (unmounted || request !== countrySelection) return
    countryId.value = iso2
    catalogueVersion.value++
    stateId.value = states.value[0]?.id ?? ''
    const next = states.value.flatMap(state => state.cities).find(city => cityOpen(city.id))
    if (!next) throw new Error(`No open city is available for ${countryInfo.name}`)
    await pickCity(next.id)
    if (unmounted || request !== countrySelection) return
    countrySelectionPending = false
    emit('ready', readyCityId.value === cityId.value && !loading.value && !loadError.value)
    countryPickerOpen.value = false
  } catch {
    if (unmounted || request !== countrySelection) return
    countrySelectionPending = false
    failedCountry.value = iso2
    countryError.value = `We could not prepare ${countryInfo.name}. Check your connection and try again.`
    emit('ready', readyCityId.value === cityId.value && !loading.value && !loadError.value)
  } finally {
    if (!unmounted && request === countrySelection) countryBusy.value = false
  }
}
const openStates = computed(() => states.value.filter(stateOpen))
const stateNow = computed(() => states.value.find((item) => item.id === stateId.value) ?? null)
const openCities = computed(() => (stateNow.value?.cities ?? []).filter((item) => cityOpen(item.id)))
const soon = computed(() => [...states.value.flatMap((item) => item.cities.filter((city) => !cityOpen(city.id)))])
const cityNow = computed(() => stateNow.value?.cities.find((item) => item.id === cityId.value) ?? null)
const here = computed(() => cityNow.value !== null && (props.choosable ? readyCityId.value === cityId.value && !loading.value && !loadError.value : cityNow.value.id === estate.value.city))
const unit = computed(() => readyCityId.value === cityId.value ? unitOf(cityId.value) : 'area')

/** The city whose local governments are offered: the life's own, or (for a life not yet started) the one chosen here. */
async function pickCity(id: string): Promise<void> {
  if (id === cityId.value && !props.choosable) return
  const changed = id !== cityId.value
  cityId.value = id
  if (!props.choosable) return
  if (changed) { area.value = undefined; Object.assign(ui, { found: null, note: '' }) }
  await city.select(id)
}
function pickState(id: string): void {
  stateId.value = id
  const next = states.value.find((item) => item.id === id)?.cities.find((city) => cityOpen(city.id))
  if (next) void pickCity(next.id)
}
const cityLabel = computed(() => cityNow.value?.name ?? estate.value.cityName)
const lgas = computed<readonly LgaCard[]>(() => cityId.value === estate.value.city ? estate.value.lgas : city.units.value.map((item) => ({ id: item.id, name: item.name, line: localUnitDescription(cityId.value, item.id), land: item.land, levy: 0 })))
function validateArea(): void {
  const valid = areaForCity(area.value, lgas.value)
  if (valid !== area.value) area.value = valid
}

const query = ref('')
const groups = computed(() => groupLgas(cityId.value, lgas.value, query.value))
const picked = computed(() => lgas.value.find((item) => item.id === area.value?.lga) ?? null)
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
async function find(): Promise<void> { area.value = undefined; await findLga(ui, cityId.value) }
function surprise(): void {
  const all = lgas.value
  const item = all[Math.floor(Math.random() * all.length)]
  if (item) choose(item.id)
}
onMounted(() => {
  if (!props.choosable || readyCityId.value === cityId.value) { validateArea(); emit('ready', true) }
  else void city.select(cityId.value)
})
onBeforeUnmount(() => { unmounted = true; countrySelection++; directoryRequest++; city.cancel(); unsubscribeCatalogue() })
</script>

<template>
  <div class="cr-home" data-lga-card>
    <nav class="cr-places" aria-label="Where in the world">
      <ol>
        <li>{{ country?.name ?? 'Nigeria' }}</li>
        <li v-if="openStates.length <= 1 || !choosable">{{ stateNow?.name }}</li>
        <li v-if="openStates.length <= 1 || !choosable">{{ cityNow?.name }}</li>
      </ol>
      <button v-if="choosable" type="button" class="cr-chip" data-key="country:choose" @click="showCountries">Choose another country</button>
      <div v-if="countryPickerOpen" class="cr-chips" role="group" aria-label="Country" :aria-busy="countryBusy">
        <button v-for="item in countryNames.filter(item => item.status === 'accepted' || (item.iso2 === 'ng' && item.status === 'legacy'))" :key="item.iso2" type="button" class="cr-chip" :aria-pressed="item.iso2 === countryId" @click="chooseCountry(item.iso2)">{{ item.name }}</button>
        <p v-if="countryError" class="cr-note is-warn" role="alert">{{ countryError }}</p>
        <button v-if="countryError" type="button" class="cr-btn" data-key="country:retry" @click="failedCountry ? chooseCountry(failedCountry) : showCountries()">Try again</button>
      </div>
      <div v-if="openStates.length > 1 && choosable" class="cr-chips" role="group" aria-label="State">
        <button v-for="item in openStates" :key="item.id" type="button" class="cr-chip" :aria-pressed="item.id === stateId" @click="pickState(item.id)">{{ item.name }}</button>
      </div>
      <div v-if="openCities.length > 1 && choosable" class="cr-chips" role="group" aria-label="City">
        <button v-for="item in openCities" :key="item.id" type="button" class="cr-chip" :aria-pressed="item.id === cityId" @click="pickCity(item.id)">{{ item.name }}</button>
      </div>
      <p v-if="soon.length" class="cr-soon">More places are opening: <span v-for="item in soon" :key="item.id">{{ item.name }}</span></p>
    </nav>

    <p v-if="loading" class="cr-note" role="status">Loading {{ cityLabel }}…</p>
    <div v-else-if="loadError" class="cr-load-error" role="alert">
      <p class="cr-note is-warn">{{ loadError }}</p>
      <button type="button" class="cr-btn" data-key="area:retry" @click="pickCity(cityId)">Try again</button>
    </div>

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

      <label class="cr-field">Or choose from the {{ lgas.length }} {{ unit }}s of {{ cityLabel }}
        <input v-model="query" type="search" name="area-search" placeholder="Search by name" autocomplete="off" data-key="area:search">
      </label>
      <div v-for="group in groups" :key="group.zone" class="cr-lgas">
        <h3 v-if="group.title">{{ group.title }}</h3>
        <div class="cr-cards is-areas" role="group" :aria-label="group.title || cityLabel">
          <button v-for="item in group.items" :key="item.id" type="button" class="cr-card" :data-lga="item.id" :data-key="`area:${item.id}`" :aria-pressed="area?.lga === item.id" @click="choose(item.id)"><strong>{{ item.name }}</strong><small>{{ item.line }}</small></button>
        </div>
      </div>
      <p v-if="!groups.length" class="cr-note" role="status">No {{ unit }} matches “{{ query }}”.</p>
    </template>
  </div>
</template>
