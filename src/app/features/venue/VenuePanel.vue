<script setup lang="ts">
// The venue panel: where you are, the spots you can stand at and, when opened, what you can do at
// the current spot. Selecting a spot is the server's `spot` action; starting something is the
// `activity` action. Every card says its time and price, and when it cannot be started, the one
// reason why. A card that is waiting for the server says so and cannot be pressed twice.
//
// The layout still comes from the existing stylesheet (src/ui/shell.css, .life-venue-panel and
// below), so this panel is the same size as the one the scene's camera is framed around.
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { Component, ShallowRef } from 'vue'
import type { ActivityCard } from '../../../types/view.ts'
import { cachedCityContent } from '../../../game/cities/registry.ts'
import { venueDistrict, venueLabel } from '../../../game/content/venues.ts'
import { social } from '../social/useSocial.ts'
import { cityWalk } from '../neighbourhood/cityWalkState.ts'
import { useApp } from '../../state/app.ts'
import { momentText, noticeText } from '../../state/momentText.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { linkWording } from '../hud/hudModel.ts'

const { game, shell, command, community } = useApp()
const ui = shell.ui
const state = game.state
const cityStreet = computed(() => state.value.location === 'city-street')
const streetExit = computed(() => !social.me?.visiting && cityWalk.value?.kind === 'venue' && cityWalk.value.venue === state.value.location)
function leaveStreetVenue(): void { void import('../neighbourhood/neighbourhoodStore.ts').then(module => module.leaveCityVenue()) }
const view = game.view
const privateHome = computed(() => state.value.location === 'home')
const outside = computed(() => state.value.location === 'neighbourhood')
const visiting = computed(() => social.me?.visiting)
const venue = computed(() => view.value.venues.find((item) => item.id === state.value.location) ?? { id: state.value.location, label: venueLabel(state.value.location, view.value.cityId), district: venueDistrict(state.value.location, view.value.cityId), icon: '' })
const activities = computed(() => view.value.activities)
// A market rents stalls to players: its shops, and opening one, are in the Business app (fetched when opened).
const market = computed(() => cachedCityContent(view.value.cityId)?.venues.find((item) => item.id === state.value.location)?.kind === 'market')
const spots = computed(() => visiting.value ? [] : activities.value.spots.filter((spot) => !privateHome.value || spot.id !== 'people'))
const spot = computed(() => spots.value.find((item) => item.id === state.value.spot))
// Home shows the player's own house.
const house = computed(() => (privateHome.value ? view.value.property?.house : null))
// A life living in its own house is told so, with the local government it chose (the same rule as src/ui/shell.js).
const own = computed(() => (privateHome.value && state.value.estate?.living === 'own' && view.value.estate?.lgaConfirmed && view.value.estate.tier && view.value.estate.lga ? view.value.estate : null))
const title = computed(() => visiting.value ? `${visiting.value.host.name}'s home` : own.value?.tier.label || house.value?.label || venue.value.label)
const district = computed(() => visiting.value ? 'Visiting' : own.value?.lga?.name || (outside.value ? view.value.estate?.lga?.name : null) || house.value?.district || venue.value.district)
const line = computed(() => {
  if (!view.value.connected) return linkWording(view.value)?.menu ?? 'Not connected · read-only'
  const ambient = view.value.travel?.destinations?.find((item) => item.id === state.value.location)?.ambient
  return `${privateHome.value ? ' Private · ' : ''}${momentText.value || noticeText.value || ambient || spot.value?.caption || 'Explore at your own pace'}`
})
// The closed rail has no activity-card download. A remembered expanded rail loads itself.
const activityPanel: ShallowRef<Component | null> = shallowRef(null)
const activityError = ref(false)
let activityLoad: Promise<void> | null = null
function loadActivities(): Promise<void> {
  if (activityPanel.value) return Promise.resolve()
  if (activityLoad) return activityLoad
  activityError.value = false
  activityLoad = import('./VenueActions.vue').then(module => { activityPanel.value = module.default }, () => { activityError.value = true }).finally(() => { activityLoad = null })
  return activityLoad
}
watch(() => ui.expanded, expanded => { if (expanded) void loadActivities() }, { immediate: true })

/** The control that was pressed, until the server answers. */
const pending = ref<string | null>(null)
async function selectSpot(id: string): Promise<void> {
  if (pending.value) return
  ui.expanded = true
  pending.value = `spot:${id}`
  try { await command('spot', { id }) } finally { pending.value = null }
}
async function start(card: ActivityCard, choice?: string): Promise<void> {
  if (pending.value) return
  pending.value = `start:${card.id}`
  ui.expanded = false
  try { await command('activity', choice ? { id: card.id, choice } : { id: card.id }) } finally { pending.value = null }
}

// A newly selected spot is brought into view in the rail.
const rail = ref<HTMLElement | null>(null)
watch(() => `${state.value.location}:${state.value.spot}`, () => {
  void nextTick(() => {
    const row = rail.value, selected = row?.querySelector<HTMLElement>('.is-selected[data-spot]')
    if (!row || !selected) return
    const bounds = row.getBoundingClientRect(), box = selected.getBoundingClientRect()
    if (bounds.width <= 0) return
    if (box.left < bounds.left + 52) row.scrollLeft += box.left - bounds.left - 52
    else if (box.right > bounds.right - 8) row.scrollLeft += box.right - bounds.right + 8
  })
})
</script>

<template>
  <section class="life-venue-panel" data-tour="place" aria-label="Current venue">
    <header class="life-venue-header">
      <button class="life-avatar" type="button" aria-label="Open your character: profile, needs, goals and skills" @click="shell.open('sim')"><GameIcon inline name="person" /></button>
      <div class="life-venue-heading"><h1><GameIcon inline kind="venue" :id="venue.id" :emoji="venue.icon" /> {{ title }} <span>· {{ district }}</span></h1><p :title="line"><GameIcon v-if="privateHome && view.connected" inline name="lock" />{{ line }}</p></div>
      <button v-if="!privateHome && !visiting && !cityStreet && view.connected" class="life-icon-button" data-tour="community" type="button" aria-label="Open community chat" title="Community chat" @click="community.toggle(true)"><GameIcon name="chat" /></button>
      <button class="life-icon-button" type="button" aria-label="Open map" title="Map (M)" @click="shell.open('map')"><GameIcon name="map" /></button>
    </header>
    <div ref="rail" class="life-spots">
      <button class="life-expand" :class="{ 'is-expanded': ui.expanded }" type="button" :aria-expanded="ui.expanded" :aria-label="`${ui.expanded ? 'Hide' : 'Show'} activities`" title="Activities (T)" @click="ui.expanded = !ui.expanded"><GameIcon name="chevron-down" /></button>
      <button v-if="market" type="button" data-shops title="Players’ stalls at this market, and renting one" @click="shell.open('business', { venue: venue.id })"><GameIcon inline name="buy" /><span>Shops here</span></button>
      <button v-for="(item, index) in spots" :key="item.id" type="button" :data-spot="item.id" :class="{ 'is-selected': item.id === state.spot }" :aria-pressed="item.id === state.spot" :aria-busy="pending === `spot:${item.id}`" :title="`Shortcut ${index + 1}`" @click="selectSpot(item.id)"><GameIcon inline kind="spot" :id="item.id" :emoji="item.icon" /><span>{{ item.label }}</span></button>
      <button v-if="streetExit" type="button" :disabled="!view.connected || Boolean(state.activeAction)" @click="leaveStreetVenue">Leave to street</button>
      <button v-if="cityStreet" type="button" @click="shell.open('neighbourhood')">Walking help</button>
      <button v-if="!privateHome && !visiting && !cityStreet && !spots.some((item) => item.id === 'people')" type="button" @click="community.toggle(true)"><GameIcon inline name="people" /><span>People</span></button>
    </div>
    <template v-if="ui.expanded">
      <component :is="activityPanel" v-if="activityPanel" :pending="pending" @start="start" />
      <p v-else-if="activityError" class="life-actions-note" role="alert">Activities could not load. <button type="button" @click="loadActivities">Try again</button></p>
      <p v-else class="life-actions-note" role="status">Loading activities…</p>
    </template>
  </section>
</template>
