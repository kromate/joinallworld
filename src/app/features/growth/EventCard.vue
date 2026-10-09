<script setup lang="ts">
// One occurrence of a calendar event: when and where, a Go button, "Add to my calendar" (a file
// the phone's own calendar opens — nothing is sent anywhere), Share, and spraying at a party.
import { computed } from 'vue'
import type { CalendarOccurrence } from '../../../types/growth.ts'
import type { EventsView } from '../../../types/view.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import { presenceNote, sprayReason, whenLine } from './eventsLines.ts'

const props = defineProps<{
  event: CalendarOccurrence
  now: number
  cash: number
  offline?: string | null
  /** The player stands at this event's venue. */
  here: boolean
  attended: boolean
  /** Spray figures, or null when spraying is not offered here. */
  spray: EventsView['spray'] | null
  /** A share is being prepared. */
  sharing: boolean
  /** The amount being sprayed, or null. */
  spraying: number | null
}>()
const emit = defineEmits<{ go: []; calendar: []; share: []; spray: [amount: number] }>()
const note = computed(() => presenceNote(props.attended, props.event.live, props.here))
</script>

<template>
  <article class="gr-card">
    <h3>{{ event.title }}<span v-if="event.live" class="gr-live">On now</span></h3>
    <p class="gr-when">{{ whenLine(event, now) }}</p>
    <p>{{ event.blurb }}<template v-if="note"> <b>{{ note }}</b></template></p>
    <div v-if="spray" class="gr-spray" role="group" aria-label="Spray at this event">
      Spray:
      <BaseButton v-for="amount in spray.amounts" :key="amount" :disabled="spraying !== null" :reason="offline || sprayReason(amount, spray.left, cash, money)" @click="emit('spray', amount)">{{ spraying === amount ? 'Spraying…' : money(amount) }}</BaseButton>
      <small>{{ money(spray.left) }} left to spray today. Spraying is for show: it lifts Social and Fun and the money is gone.</small>
    </div>
    <div class="gr-actions">
    <BaseButton v-if="!here" :variant="event.live ? 'primary' : 'default'" :reason="offline" @click="emit('go')">Go there</BaseButton>
    <BaseButton @click="emit('calendar')">Add to my calendar</BaseButton>
    <BaseButton :disabled="sharing" :reason="offline" @click="emit('share')">Share</BaseButton>
    </div>
  </article>
</template>

<style scoped>
.gr-card { background: #fff; border-radius: var(--r-md, 16px); border: 1px solid var(--c-line); min-width: 0; overflow-wrap: anywhere; padding: 14px; margin: 0 0 var(--s-3); }
.gr-card h3 { margin: 0 0 4px; font-size: 18px; line-height: 1.25; text-transform: none; letter-spacing: 0; color: var(--c-ink); }
.gr-card p { margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: var(--c-ink-2); }
.gr-actions,.gr-spray { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.gr-actions :deep(.base-button) { flex: 1 1 130px; max-width: 100%; }
.gr-spray small { flex-basis: 100%; font-size: 12px; line-height: 1.5; color: var(--c-muted); }
.gr-when { font-variant-numeric: tabular-nums; font-size: 12px !important; color: var(--c-muted) !important; }
.gr-live { display: inline-block; background: var(--c-red); color: #fff; border-radius: 99px; font-size: 11px; font-weight: 700; padding: 2px 8px; margin-left: 6px; vertical-align: middle; }
</style>
