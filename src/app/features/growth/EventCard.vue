<script setup lang="ts">
// One occurrence of a calendar event: when and where, a Go button, "Add to my calendar" (a file
// the phone's own calendar opens — nothing is sent anywhere), Share, and spraying at a party.
import { computed } from 'vue'
import type { CalendarOccurrence } from '../../../types/growth.ts'
import type { EventsView } from '../../../types/view.ts'
import { money } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import { presenceNote, sprayReason, whenLine } from './eventsModel.ts'

const props = defineProps<{
  event: CalendarOccurrence
  now: number
  cash: number
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
    <p v-if="spray">
      Spray:
      <BaseButton v-for="amount in spray.amounts" :key="amount" :disabled="spraying !== null" :reason="sprayReason(amount, spray.left, cash, money)" @click="emit('spray', amount)">{{ spraying === amount ? 'Spraying…' : money(amount) }}</BaseButton>
      <br><small>{{ money(spray.left) }} left to spray today. Spraying is for show: it lifts Social and Fun and the money is gone.</small>
    </p>
    <BaseButton v-if="!here" :variant="event.live ? 'primary' : 'default'" @click="emit('go')">Go there</BaseButton>
    <BaseButton @click="emit('calendar')">Add to my calendar</BaseButton>
    <BaseButton :disabled="sharing" @click="emit('share')">Share</BaseButton>
  </article>
</template>

<style scoped>
.gr-card { background: #fff; border-radius: var(--r-md, 16px); box-shadow: var(--e-1), var(--ring); padding: 14px; margin: 0 0 var(--s-3); }
.gr-card h3 { margin: 0 0 4px; font-size: 15px; text-transform: none; letter-spacing: 0; color: var(--c-ink); }
.gr-card p { margin: 0 0 8px; font-size: 13px; line-height: 1.45; color: var(--c-ink-2); }
.gr-card :deep(.base-button) { margin: 4px 6px 0 0; }
.gr-when { font-variant-numeric: tabular-nums; font-size: 12px !important; color: var(--c-muted) !important; }
.gr-live { display: inline-block; background: var(--c-red); color: #fff; border-radius: 99px; font-size: 11px; font-weight: 700; padding: 2px 8px; margin-left: 6px; vertical-align: middle; }
</style>
