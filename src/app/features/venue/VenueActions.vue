<script setup lang="ts">
// Activity cards are fetched when the venue's activity rail is expanded.
import { computed } from 'vue'
import type { ActivityCard } from '../../../types/view.ts'
import { social } from '../social/useSocial.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { activityFace, effectTags } from './venueModel.ts'

const props = defineProps<{ pending: string | null }>()
const emit = defineEmits<{ start: [card: ActivityCard, choice?: string] }>()
const { game, shell } = useApp()
const state = game.state, view = game.view
const activities = computed(() => view.value.activities)
const visiting = computed(() => social.me?.visiting)
const spot = computed(() => visiting.value ? undefined : activities.value.spots.find(item => item.id === state.value.spot && (state.value.location !== 'home' || item.id !== 'people')))
const gigs = computed(() => view.value.travel?.gigs)
const showGigs = computed(() => !visiting.value && Boolean(gigs.value) && activities.value.cards.some(card => (view.value.travel?.gigsHere ?? []).includes(card.id)))
const cards = computed(() => visiting.value ? [] : activities.value.cards.map(card => ({ card, face: activityFace(card, state.value, view.value.connected), tags: effectTags(card) })))
function start(card: ActivityCard, choice?: string): void { emit('start', card, choice) }
</script>

<template>
      <p v-if="state.activeAction" class="life-actions-note" role="note">Finish or cancel what you are doing to start something else.</p>
      <p v-if="showGigs && gigs" class="life-actions-note life-gigs" :class="{ 'is-out': !gigs.left }" role="note" title="Paid gigs are limited each day. Your job’s shift does not count."><b>Gigs today: {{ gigs.used }}/{{ gigs.limit }}</b> · {{ gigs.left ? `${gigs.left} left` : 'open again at midnight, Nigerian time' }}</p>
      <div class="life-actions">
        <template v-for="{ card, face, tags } in cards" :key="card.id">
          <div v-if="card.choices && face.state !== 'unavailable'" class="life-action has-choices" :class="face.state === 'ready' ? undefined : `is-${face.state}`" role="group" :aria-label="face.label">
            <span class="life-action-head"><span class="life-action-emoji" aria-hidden="true"><GameIcon inline kind="activity" :id="card.id" :emoji="card.icon" /></span><span class="life-action-title">{{ card.label }}</span></span>
            <span class="life-action-meta"><span><GameIcon inline name="clock" /> {{ card.duration }}s</span><strong :class="face.priceTone === 'free' ? undefined : `is-${face.priceTone}`">{{ face.price }}</strong></span>
            <span v-if="face.why" class="life-lock"><GameIcon inline name="lock" /> {{ face.why }}</span>
            <span v-else class="life-tags"><span v-for="tag in tags" :key="tag.text" :class="{ 'is-cost': tag.cost, 'is-beta': tag.beta }">{{ tag.text }}</span></span>
            <span class="life-choices"><button v-for="choice in card.choices" :key="choice.id" type="button" :disabled="face.disabled || props.pending !== null" :title="face.full || undefined" @click="start(card, choice.id)">{{ choice.label }}</button></span>
          </div>
          <button v-else class="life-action" :class="face.state === 'ready' ? undefined : `is-${face.state}`" type="button" :disabled="face.disabled || props.pending !== null" :title="face.full || undefined" :aria-label="face.label" :aria-busy="props.pending === `start:${card.id}`" @click="start(card)">
            <span class="life-action-head"><span class="life-action-emoji" aria-hidden="true"><GameIcon inline kind="activity" :id="card.id" :emoji="card.icon" /></span><span class="life-action-title">{{ card.label }}</span></span>
            <span class="life-action-meta"><span><GameIcon inline name="clock" /> {{ card.duration }}s</span><strong :class="face.priceTone === 'free' ? undefined : `is-${face.priceTone}`">{{ face.price }}</strong></span>
            <span v-if="face.why" class="life-lock"><GameIcon inline name="lock" /> {{ face.why }}</span>
            <span v-else class="life-tags"><span v-for="tag in tags" :key="tag.text" :class="{ 'is-cost': tag.cost, 'is-beta': tag.beta }">{{ tag.text }}</span></span>
          </button>
        </template>
        <div v-if="!cards.length" class="ui-empty is-inline"><template v-if="visiting"><p>You are visiting a home. Open Invite for house chat, guest permissions or Leave.</p><button class="ui-button" type="button" @click="shell.open('invite')">Manage visit</button></template><p v-else>{{ state.location === 'city-street' ? 'Choose a doorway to visit a place, or keep exploring.' : state.location === 'neighbourhood' ? "Walk to a neighbour's door, or explore through the city gate." : spot ? 'Nothing to do at this spot yet.' : 'Pick a spot above to see what you can do there.' }}</p></div>
      </div>
</template>
