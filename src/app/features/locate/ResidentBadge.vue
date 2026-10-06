<script setup lang="ts">
// A small "location-confirmed" tag beside a player's name (the pattern of FounderTag): a pin with a tick and the local government
// the player lives in, shown to everyone who sees the player. Drawn only where the server said a confirmation stands. Never a
// distance, a direction or anything that follows the person: it is a fact about one past moment, confirmed by the player's own device.
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { badgeCache } from './badgeFeed.ts'
import { badgeLong, badgeShort } from './badgeWords.ts'
import { useBadges } from './useBadges.ts'

const props = withDefaults(defineProps<{ id: string; /** A whole line instead of the short tag. */ long?: boolean }>(), { long: false })
const { game } = useApp()
const mine = computed(() => game.session.value?.id === props.id)
const badge = computed(() => {
  if (mine.value) {
    const residence = game.view.value.estate.residence
    return residence?.confirmed ? { lga: residence.lga, name: residence.lgaName } : null
  }
  return badgeCache[props.id] ?? null
})
const label = computed(() => (badge.value ? badgeLong(badge.value, mine.value) : ''))
let release: (() => void) | null = null
function watchId(id: string): void { release?.(); release = mine.value ? null : useBadges().want(id) }
onMounted(() => watchId(props.id))
watch(() => props.id, watchId)
onBeforeUnmount(() => release?.())
</script>

<template>
  <span v-if="badge" class="resident-badge" :class="{ 'is-long': long }" role="img" :aria-label="label" :title="label" data-resident-badge>
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /><path d="m8.6 9.2 2.4 2.4 4.2-4.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    <span aria-hidden="true">{{ long ? label : badgeShort(badge) }}</span>
  </span>
</template>

<style scoped>
.resident-badge { display: inline-flex; align-items: center; gap: 3px; margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #e6f4ea; color: #0b5a30; font-size: 10px; font-weight: 700; line-height: 1.5; vertical-align: middle; white-space: nowrap; max-width: 100%; }
.resident-badge.is-long { margin-left: 0; font-size: 12px; font-weight: 600; padding: 2px 8px; white-space: normal; }
</style>
