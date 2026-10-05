<script setup lang="ts">
// What is happening right now: the running activity (or trip) with its bar, the time left, and
// Cancel with the real cancel rule. The time is the server's: it moves when a state arrives
// (about once a second while something runs), never on a timer of its own.
import { computed, ref } from 'vue'
import { cityName } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { money } from '../../ui/format.ts'
import { isTrip } from './venueModel.ts'

const { game, command } = useApp()
const state = game.state
const view = game.view
const active = computed(() => state.value.activeAction)
const activity = computed(() => view.value.activities.active)
const placeOf = (id: string): string => { const venue = view.value.venues.find((item) => item.id === id); return venue ? (id === 'home' ? 'Home' : venue.label) : 'your destination' }
const name = computed(() => {
  const now = active.value
  if (!now) return ''
  if (now.kind === 'intercity') return `Travelling to ${cityName(now.id)}`
  if (activity.value?.label) return activity.value.label
  return now.kind === 'travel' ? `Travelling to ${placeOf(now.id)}` : now.kind === 'commute' ? `Commuting to work · ${placeOf(now.id)}` : 'Action in progress'
})
const paid = computed(() => (activity.value?.reward ?? 0) > 0)
const sleeping = computed(() => Boolean(activity.value?.tags?.includes('sleep')))
const fixed = computed(() => active.value?.kind === 'intercity' || (Boolean(activity.value) && !activity.value?.cancellable))
const progress = computed(() => { const now = active.value; return now ? Math.max(0, Math.min(1, 1 - now.remaining / (now.duration || 1))) : 0 })
const cancelLabel = computed(() => (fixed.value ? 'This cannot be cancelled once started' : paid.value ? 'Cancel shift. Cancelling earns nothing' : sleeping.value ? 'Wake up. The rest you got is kept' : 'Cancel current activity'))

const cancelling = ref(false)
async function cancel(): Promise<void> {
  if (cancelling.value) return
  cancelling.value = true
  try { await command('cancel') } finally { cancelling.value = false }
}
</script>

<template>
  <section v-if="active" class="life-progress" aria-label="Current activity">
    <span class="life-progress-icon" aria-hidden="true"><GameIcon inline kind="activity" :id="activity?.id" :emoji="activity?.icon || (isTrip(active) ? '🧭' : '⏳')" /></span>
    <div><strong>{{ name }}</strong><small>{{ Math.ceil(active.remaining) }}s left</small></div>
    <button type="button" :disabled="fixed || cancelling" :title="fixed ? 'This cannot be cancelled once started' : undefined" :aria-label="cancelLabel" @click="cancel">{{ cancelling ? 'Cancelling…' : sleeping ? 'Wake up' : 'Cancel' }}</button>
    <progress max="1" :value="progress" aria-label="Activity progress" />
    <p v-if="paid && activity" class="life-progress-note">Pays {{ money(activity.reward) }} when finished. Cancelling earns nothing.</p>
    <p v-else-if="fixed" class="life-progress-note">This cannot be cancelled once started.</p>
  </section>
</template>
