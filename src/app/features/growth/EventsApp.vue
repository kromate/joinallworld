<script setup lang="ts">
// Events: the Phone app. What is on now and this week, where, a Go button, "add to my calendar"
// (a file the phone's own calendar opens — nothing is sent anywhere) and spraying at a party.
// The list is computed from the server's clock (src/game/calendar.ts), with no request.
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { isDeparting } from '../../../life.ts'
import EmptyState from '../../ui/EmptyState.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import type { CalendarOccurrence } from '../../../types/growth.ts'
import EventCard from './EventCard.vue'
import LinkButton from './LinkButton.vue'
import { eventIcs, upcomingEvents } from './rulesBoundary.ts'
import { attendedLine, nothingOn } from './eventsModel.ts'
import { useGrowth } from './useGrowth.ts'

defineProps<{ params?: unknown }>()
const { game, shell, goTo } = useApp()
const growth = useGrowth()
const view = game.view
const state = game.state
const events = computed(() => upcomingEvents(view.value.now, 7, view.value.cityId))
const live = computed(() => events.value.filter((event) => event.live))
const later = computed(() => events.value.filter((event) => !event.live))
const rules = ['Events happen at a place and a time, on Nigerian time. Be there and finish any activity to count as attending.', 'An event changes no price and no pay. Being there counts for missions.',
  'Events come round again: weekly ones every week, yearly ones every year. Nothing is gone for ever.', '“Add to my calendar” makes a calendar file on your phone. The game sends no reminder by itself.']

onMounted(() => { void growth.load() })

const hereAt = (event: CalendarOccurrence): boolean => state.value.location === event.venue && !isDeparting(state.value)
const attended = (event: CalendarOccurrence): boolean => Boolean(view.value.events?.live?.find((item) => item.key === event.key)?.attended)
const sprayOf = (event: CalendarOccurrence) => (event.live && hereAt(event) && event.spray ? view.value.events.spray : null)

function go(event: CalendarOccurrence): void { shell.close(); void goTo(event.venue) }
function share(event: CalendarOccurrence): void { void growth.share('event', { event: event.id }) }
const spraying = ref<number | null>(null)
async function spray(amount: number): Promise<void> {
  if (spraying.value !== null) return
  spraying.value = amount
  try {
    const result = await game.command('events.spray', { amount })
    if (result.ok) game.toast(game.state.value.message, 'spend')
  } finally { spraying.value = null }
}
/** A calendar file the phone's own calendar opens. The blob URL is revoked ten seconds later. */
function addToCalendar(event: CalendarOccurrence): void {
  const found = events.value.find((item) => item.key === event.key)
  if (!found) return
  const url = URL.createObjectURL(new Blob([eventIcs(found, location.origin)], { type: 'text/calendar' }))
  const link = Object.assign(document.createElement('a'), { href: url, download: `${found.id}.ics` })
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  game.toast('Calendar file made. Open it to add the event to your calendar.', 'info')
}
</script>

<template>
  <div class="events">
    <template v-if="live.length">
      <EventCard v-for="event in live" :key="event.key" :event="event" :now="view.now" :cash="state.cash" :here="hereAt(event)" :attended="attended(event)" :spray="sprayOf(event)" :sharing="growth.state.busy !== null" :spraying="spraying" @go="go(event)" @calendar="addToCalendar(event)" @share="share(event)" @spray="spray" />
    </template>
    <EmptyState v-else compact icon="calendar" title="Nothing is on right now" :text="nothingOn(later)" />
    <template v-if="later.length">
      <SectionTitle note="next 7 days">Coming up</SectionTitle>
      <EventCard v-for="event in later" :key="event.key" :event="event" :now="view.now" :cash="state.cash" :here="hereAt(event)" :attended="attended(event)" :spray="sprayOf(event)" :sharing="growth.state.busy !== null" :spraying="spraying" @go="go(event)" @calendar="addToCalendar(event)" @share="share(event)" @spray="spray" />
    </template>
    <template v-if="growth.state.hello?.channel">
      <LinkButton v-if="growth.channel.value" block :href="growth.channel.value">Follow Allworld on WhatsApp</LinkButton>
      <p class="gr-note">The owner posts what is on tonight there. It opens WhatsApp; the game sends you nothing.</p>
    </template>
    <HowItWorks id="events-rules" :rules="rules" />
    <p class="gr-note">{{ attendedLine(view.events?.count ?? 0) }}</p>
  </div>
</template>

<style scoped>
.gr-note { font-size: 12px; line-height: 1.45; color: var(--c-muted); margin: var(--s-2) 2px; }
</style>
