<script setup lang="ts">
// The venue panel: where you are, the spots you can stand at and, when opened, what you can do at
// the current spot. Selecting a spot is the server's `spot` action; starting something is the
// `activity` action. Every card says its time and price, and when it cannot be started, the one
// reason why. A card that is waiting for the server says so and cannot be pressed twice.
//
// The layout still comes from the existing stylesheet (src/ui/shell.css, .life-venue-panel and
// below), so this panel is the same size as the one the scene's camera is framed around.
import { computed, nextTick, ref, watch } from 'vue'
import type { ActivityCard } from '../../../types/view.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { linkWording } from '../hud/hudModel.ts'
import { activityFace, effectTags } from './venueModel.ts'

const { game, shell, command, toggleCommunity } = useApp()
const ui = shell.ui
const state = game.state
const view = game.view
const privateHome = computed(() => state.value.location === 'home')
const venue = computed(() => view.value.venues.find((item) => item.id === state.value.location) ?? { id: state.value.location, label: state.value.location, district: '', icon: '' })
const activities = computed(() => view.value.activities)
const spots = computed(() => activities.value.spots.filter((spot) => !privateHome.value || spot.id !== 'people'))
const spot = computed(() => spots.value.find((item) => item.id === state.value.spot))
// Home shows the player's own house.
const house = computed(() => (privateHome.value ? view.value.property?.house : null))
// A life living in its own house is told so, with the local government it chose (the same rule as src/ui/shell.js).
const own = computed(() => (privateHome.value && state.value.estate?.living === 'own' && view.value.estate?.lgaConfirmed && view.value.estate.tier && view.value.estate.lga ? view.value.estate : null))
const title = computed(() => own.value?.tier.label || house.value?.label || venue.value.label)
const district = computed(() => own.value?.lga?.name || house.value?.district || venue.value.district)
const line = computed(() => {
  if (!view.value.connected) return linkWording(view.value)?.menu ?? 'Not connected · read-only'
  const ambient = view.value.travel?.destinations?.find((item) => item.id === state.value.location)?.ambient
  return `${privateHome.value ? ' Private · ' : ''}${ambient || spot.value?.caption || 'Explore at your own pace'}`
})
// Where this spot lists paid gigs, the day's counter sits above them (the limit is the server's).
const gigs = computed(() => view.value.travel?.gigs)
const showGigs = computed(() => Boolean(gigs.value) && activities.value.cards.some((card) => (view.value.travel?.gigsHere ?? []).includes(card.id)))
const cards = computed(() => activities.value.cards.map((card) => ({ card, face: activityFace(card, state.value, view.value.connected), tags: effectTags(card) })))

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
  <section class="life-venue-panel" aria-label="Current venue">
    <header class="life-venue-header">
      <button class="life-avatar" type="button" aria-label="Open your Sim: profile, needs, goals and skills" @click="shell.open('sim')"><GameIcon inline name="person" /></button>
      <div class="life-venue-heading"><h1><GameIcon inline kind="venue" :id="venue.id" :emoji="venue.icon" /> {{ title }} <span>· {{ district }}</span></h1><p><GameIcon v-if="privateHome && view.connected" inline name="lock" />{{ line }}</p></div>
      <button v-if="!privateHome && view.connected" class="life-icon-button" type="button" aria-label="Open community chat" title="Community chat" @click="toggleCommunity()"><GameIcon name="chat" /></button>
      <button class="life-icon-button" type="button" aria-label="Open map" title="Map (M)" @click="shell.open('map')"><GameIcon name="map" /></button>
    </header>
    <div ref="rail" class="life-spots">
      <button class="life-expand" :class="{ 'is-expanded': ui.expanded }" type="button" :aria-expanded="ui.expanded" :aria-label="`${ui.expanded ? 'Hide' : 'Show'} activities`" title="Activities (T)" @click="ui.expanded = !ui.expanded"><GameIcon name="chevron-down" /></button>
      <button v-for="(item, index) in spots" :key="item.id" type="button" :data-spot="item.id" :class="{ 'is-selected': item.id === state.spot }" :aria-pressed="item.id === state.spot" :aria-busy="pending === `spot:${item.id}`" :title="`Shortcut ${index + 1}`" @click="selectSpot(item.id)"><GameIcon inline kind="spot" :id="item.id" :emoji="item.icon" /><span>{{ item.label }}</span></button>
      <button v-if="!privateHome && !spots.some((item) => item.id === 'people')" type="button" @click="toggleCommunity()"><GameIcon inline name="people" /><span>People</span></button>
    </div>
    <template v-if="ui.expanded">
      <p v-if="state.activeAction" class="life-actions-note" role="note">Finish or cancel what you are doing to start something else.</p>
      <p v-if="showGigs && gigs" class="life-actions-note life-gigs" :class="{ 'is-out': !gigs.left }" role="note" title="Paid gigs are limited each Lagos day. Your job’s shift does not count."><b>Gigs today: {{ gigs.used }}/{{ gigs.limit }}</b> · {{ gigs.left ? `${gigs.left} left` : 'open again at midnight, Lagos time' }}</p>
      <div class="life-actions">
        <template v-for="{ card, face, tags } in cards" :key="card.id">
          <div v-if="card.choices && face.state !== 'unavailable'" class="life-action has-choices" :class="face.state === 'ready' ? undefined : `is-${face.state}`" role="group" :aria-label="face.label">
            <span class="life-action-head"><span class="life-action-emoji" aria-hidden="true"><GameIcon inline kind="activity" :id="card.id" :emoji="card.icon" /></span><span class="life-action-title">{{ card.label }}</span></span>
            <span class="life-action-meta"><span><GameIcon inline name="clock" /> {{ card.duration }}s</span><strong :class="face.priceTone === 'free' ? undefined : `is-${face.priceTone}`">{{ face.price }}</strong></span>
            <span v-if="face.why" class="life-lock"><GameIcon inline name="lock" /> {{ face.why }}</span>
            <span v-else class="life-tags"><span v-for="tag in tags" :key="tag.text" :class="{ 'is-cost': tag.cost, 'is-beta': tag.beta }">{{ tag.text }}</span></span>
            <span class="life-choices"><button v-for="choice in card.choices" :key="choice.id" type="button" :disabled="face.disabled || pending !== null" :title="face.full || undefined" @click="start(card, choice.id)">{{ choice.label }}</button></span>
          </div>
          <button v-else class="life-action" :class="face.state === 'ready' ? undefined : `is-${face.state}`" type="button" :disabled="face.disabled || pending !== null" :title="face.full || undefined" :aria-label="face.label" :aria-busy="pending === `start:${card.id}`" @click="start(card)">
            <span class="life-action-head"><span class="life-action-emoji" aria-hidden="true"><GameIcon inline kind="activity" :id="card.id" :emoji="card.icon" /></span><span class="life-action-title">{{ card.label }}</span></span>
            <span class="life-action-meta"><span><GameIcon inline name="clock" /> {{ card.duration }}s</span><strong :class="face.priceTone === 'free' ? undefined : `is-${face.priceTone}`">{{ face.price }}</strong></span>
            <span v-if="face.why" class="life-lock"><GameIcon inline name="lock" /> {{ face.why }}</span>
            <span v-else class="life-tags"><span v-for="tag in tags" :key="tag.text" :class="{ 'is-cost': tag.cost, 'is-beta': tag.beta }">{{ tag.text }}</span></span>
          </button>
        </template>
        <div v-if="!cards.length" class="ui-empty is-inline"><p>{{ spot ? 'Nothing to do at this spot yet.' : 'Pick a spot above to see what you can do there.' }}</p></div>
      </div>
    </template>
  </section>
</template>
