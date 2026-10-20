<script setup lang="ts">
// Events: the Phone app. What is on now and this week, where, a Go button, "add to my calendar"
// (a file the phone's own calendar opens — nothing is sent anywhere) and spraying at a party.
// The list is computed from the server's clock (src/game/calendar.ts), with no request.
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useApp } from '../../state/app.ts'
import { isDeparting } from '../../../life.ts'
import EmptyState from '../../ui/EmptyState.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import type { CalendarOccurrence } from '../../../types/growth.ts'
import EventCard from './EventCard.vue'
import { syncHomePin } from '../gist/homePinStore.ts'
import LinkButton from './LinkButton.vue'
import { upcomingEvents } from './rulesBoundary.ts'
import { eventIcs } from '../../../game/calendar-export.ts'
import { attendedLine, nothingOn } from './eventsLines.ts'
import { useGrowth } from './useGrowth.ts'
import { festivalNotices, festivalRows } from './festivalEvents.ts'
import { loadFeed } from '../../../festivals/client.ts'
import type { Feed } from '../../../festivals/client.ts'
// Detty December (docs/DETTY-DECEMBER.md): the season's nights, drop, Returnee badge and card in Lagos, Accra and Abuja, 1 to 31 December.
// Everything of it is fetched when the app opens (a dynamic import), so the app's own download does not grow.
import type { DettyFeed } from '../../../festivals/detty-client.ts'
import { lazyComponent } from '../../state/lazy.ts'
type DettyLib = typeof import('../detty/dettyEvents.ts')
const DettyPanel = lazyComponent(() => import('../detty/DettyPanel.vue'))

defineProps<{ params?: unknown }>()
const { game, shell, goTo } = useApp()
const growth = useGrowth()
const view = game.view
const state = game.state
const offline = computed(() => view.value.connected ? null : 'Reconnect to travel, share an event or spray. Calendar downloads still work.')
// Festivals and match nights (src/festivals): the city's feed is fetched once; until it arrives only the city's own events show.
const feed = ref<Feed | null>(null)
const own = computed(() => upcomingEvents(view.value.now, 7, view.value.cityId))
const detty = ref<DettyFeed | null>(null), dettyLib = shallowRef<DettyLib | null>(null)
const keep = (row: { id: string }): boolean => dettyLib.value?.keepFestivalRow(row, detty.value, view.value.now, view.value.cityId) ?? true
const events = computed(() => [...own.value, ...festivalRows(feed.value, view.value.now, 7, view.value.cityId).filter(keep), ...(dettyLib.value?.dettyRows(detty.value, view.value.now, 7, view.value.cityId) ?? [])].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)))
const notices = computed(() => festivalNotices(feed.value, view.value.now).filter(keep))
const live = computed(() => events.value.filter((event) => event.live))
const later = computed(() => events.value.filter((event) => !event.live))
const rules = ['Events happen at a place and a time, on Nigerian time. Be there and finish any activity to count as attending.', 'An event changes no price and no pay. Being there counts for missions.',
  'Events come round again: weekly ones every week, yearly ones every year. Nothing is gone for ever.', '“Add to my calendar” makes a calendar file on your phone. The game sends no reminder by itself.']

// The home-city pin is kept with the character: read it once, so a pin made on another device shows on the event times.
onMounted(() => { void syncHomePin(game.fetchJson); void growth.load(); void loadFeed(view.value.cityId).then((found) => { feed.value = found }); void import('../detty/dettyEvents.ts').then(async (lib) => { dettyLib.value = lib; detty.value = await lib.loadDetty() }).catch(() => { /* no season shown */ }) })

const hereAt = (event: CalendarOccurrence): boolean => state.value.location === event.venue && !isDeparting(state.value)
const attended = (event: CalendarOccurrence): boolean => Boolean(view.value.events?.live?.find((item) => item.key === event.key)?.attended)
const sprayOf = (event: CalendarOccurrence) => (event.live && hereAt(event) && event.spray ? view.value.events.spray : null)

function go(event: CalendarOccurrence): void { shell.close(); void goTo(event.venue) }
/** Sharing is for the city's own events: a festival or match night has no share card yet. */
function share(event: CalendarOccurrence): void {
  if (!own.value.some((item) => item.key === event.key)) { game.toast('Tell your friends about this one yourself for now.', 'info'); return }
  void growth.share('event', { event: event.id })
}
const spraying = ref<number | null>(null)
async function spray(amount: number): Promise<void> {
  if (spraying.value !== null || offline.value) return
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
    <p v-if="offline" class="gr-note" role="status">{{ offline }}</p>
    <DettyPanel v-if="detty && (detty.on || detty.card)" :feed="detty" />
    <p v-for="item in notices" :key="item.id" class="gr-fest" :style="{ borderColor: item.colours[0], background: `linear-gradient(90deg, ${item.colours[0]}33, ${item.colours[1]}33)` }" data-festival="notice"><strong>{{ item.line }}</strong> {{ item.blurb }}</p>
    <template v-if="live.length">
      <EventCard v-for="event in live" :key="event.key" :event="event" :now="view.now" :cash="state.cash" :here="hereAt(event)" :attended="attended(event)" :spray="sprayOf(event)" :offline="offline" :sharing="growth.state.busy !== null" :spraying="spraying" @go="go(event)" @calendar="addToCalendar(event)" @share="share(event)" @spray="spray" />
    </template>
    <EmptyState v-else compact icon="calendar" title="Nothing is on right now" :text="nothingOn(later)" />
    <template v-if="later.length">
      <SectionTitle note="next 7 days">Coming up</SectionTitle>
      <EventCard v-for="event in later" :key="event.key" :event="event" :now="view.now" :cash="state.cash" :here="hereAt(event)" :attended="attended(event)" :spray="sprayOf(event)" :offline="offline" :sharing="growth.state.busy !== null" :spraying="spraying" @go="go(event)" @calendar="addToCalendar(event)" @share="share(event)" @spray="spray" />
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
.gr-fest { margin: var(--s-2) 0; padding: var(--s-2) var(--s-3); border: 2px solid; border-radius: var(--r-sm); font-size: 14px; line-height: 1.4; color: var(--c-ink); }
.gr-note { font-size: 13px; line-height: 1.5; color: var(--c-muted); margin: var(--s-2) 2px; }
/* The phone expanded wide: two columns of event cards, with notes and headings across both. */
.ph.is-wide .events { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: var(--s-3); align-items: start; }
.ph.is-wide .events > :not(.gr-card) { grid-column: 1 / -1; }
</style>
