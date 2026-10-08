<script setup lang="ts">
// Club radio: the Radio app. A shout-out is a song title and an artist as plain text, bought with
// in-game naira. No audio is played and no link is accepted or rendered. Data: GET /api/civic/radio.
//
// The banner follows the server's schedule whenever the screen is redrawn (each state poll); no
// timer runs here, so a new shout-out can take up to a poll interval to appear. The title and
// artist are bound to a draft that outlives the sheet. A shout-out keeps its request id until it
// is applied: pressing again after a lost answer repeats the SAME request, so it is charged once.
import { computed, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { isDeparting } from '../../../life.ts'
import type { RadioView } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAction from './CivicAction.vue'
import CivicStale from './CivicStale.vue'
import CivicStatus from './CivicStatus.vue'
import { RADIO } from './civicContent.ts'
import { radioDraft as draft } from './civicDrafts.ts'
import { inClub, radioKey, radioPath, radioRules, radioWhy, schedule, shoutoutMissing, song, until } from './civicModel.ts'
import { useCivic, useLinkWhy, useLoaded, useOffline } from './useCivic.ts'
import { contentFor } from '../../../game/cities/runtime.ts'

defineProps<{ params?: unknown }>()
const { game, shell, goTo } = useApp()
const civic = useCivic()
const offline = useOffline()
const linkWhy = useLinkWhy()
const view = game.view
const state = game.state
const cityId = computed(() => view.value.cityId)
const radioVenueIds = computed(() => contentFor(cityId.value).radioVenueIds)
const inside = computed(() => inClub(state.value, radioVenueIds.value))
const { item, reload } = useLoaded<RadioView>({
  key: () => radioKey(cityId.value, state.value.location), path: () => radioPath(cityId.value, state.value.location), maxAge: 12000, when: () => inside.value,
})
const data = computed(() => item.value.data)
const clubs = computed(() => view.value.venues.filter((venue) => radioVenueIds.value.includes(venue.id)))
const here = computed(() => view.value.venues.find((venue) => venue.id === state.value.location)?.label ?? 'here')
const onAir = computed(() => schedule(data.value, view.value.now))
const why = computed(() => (data.value ? radioWhy(offline('buy a shout-out'), data.value, onAir.value.queue.length, Boolean(onAir.value.playing), state.value.cash) : ''))
const titleField = ref<HTMLInputElement | null>(null)
const artistField = ref<HTMLInputElement | null>(null)
const goWhy = (): string => linkWhy() || (state.value.activeAction ? 'Finish your current action first.' : '')

async function buy(): Promise<void> {
  const missing = shoutoutMissing(draft)
  if (missing) { game.toast('Enter a song title and an artist first. Nothing was charged.', 'error'); (missing === 'title' ? titleField : artistField).value?.focus(); return }
  // The same request id is reused if this attempt has to be retried, so it cannot be charged twice.
  draft.requestId ||= game.newId() // one id per shout-out, kept for a retry
  const result = await civic.send('shoutout', '/api/civic/radio/shoutout', { title: draft.title, artist: draft.artist, requestId: draft.requestId }, { success: 'Your shout-out is in the queue.' })
  const radio = result.radio as RadioView | undefined
  if (radio) civic.put(radioKey(cityId.value, radio.venue), radio)
  if (result.ok) { draft.title = ''; draft.artist = ''; draft.requestId = null }
  // The club banner behind the sheet shows the same queue.
  if (radio) civic.changed()
}
function go(venue: string): void { shell.close(); void goTo(venue) }
</script>

<template>
  <div class="radio">
    <template v-if="!inside">
      <section class="radio-now is-off">
        <small>{{ RADIO.label }}</small><strong>Off air here</strong>
        <small>You are {{ isDeparting(state) ? 'on the road' : `at ${here}` }}. Club radio plays inside clubs: walk in to see what is on and buy a shout-out for your song.</small>
        <span class="radio-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      </section>
      <div class="civic-actions is-stack">
        <CivicAction v-for="venue in clubs" :key="venue.id" :reason="goWhy()" @click="go(venue.id)">Go to {{ venue.label }}</CivicAction>
        <p v-if="!clubs.length" class="civic-note">No club is open in this city yet.</p>
      </div>
    </template>
    <template v-else>
      <CivicStatus :item="item" @retry="reload" />
      <template v-if="data">
        <section class="radio-now" :class="{ 'is-on': onAir.playing }">
          <small>{{ RADIO.label }} · {{ view.venues.find((venue) => venue.id === state.location)?.label ?? '' }}</small>
          <strong>{{ onAir.playing ? song(onAir.playing) : 'Nothing is playing' }}</strong>
          <small>{{ onAir.playing ? `Shout-out from @${onAir.playing.by.name} · about ${until(onAir.playing.endsAt, view.now)} left` : 'Be the first: play your song here.' }}</small>
          <span class="radio-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        </section>
        <CivicStale :item="item" />
        <SectionTitle :note="`${onAir.queue.length} in the queue`">Up next</SectionTitle>
        <ol v-if="onAir.queue.length" class="ui-rows">
          <li v-for="(queued, index) in onAir.queue" :key="queued.id" class="ui-row" :class="{ 'is-you': queued.mine }">
            <span class="ui-row-icon is-round" aria-hidden="true">{{ index + 1 }}</span>
            <span class="ui-row-body"><b>{{ song(queued) }}</b><small>@{{ queued.by.name }}{{ queued.mine ? ' (you)' : '' }} · in about {{ until(queued.startsAt, view.now) }}</small></span>
          </li>
        </ol>
        <p v-else class="civic-note">The queue is empty.</p>
        <SectionTitle>{{ RADIO.cta }}</SectionTitle>
        <div class="civic-form is-card">
          <label>Song title<input ref="titleField" v-model="draft.title" :maxlength="RADIO.titleMax" autocomplete="off" @input="draft.requestId = null"></label>
          <label>Artist<input ref="artistField" v-model="draft.artist" :maxlength="RADIO.artistMax" autocomplete="off" @input="draft.requestId = null"></label>
        </div>
        <div class="civic-actions">
          <CivicAction primary :working="civic.busy('shoutout')" :reason="why" @click="buy">Buy shout-out · {{ money(data.price) }}</CivicAction>
          <CivicAction :working="item.loading" @click="reload">Refresh</CivicAction>
        </div>
        <p class="civic-note">Balance {{ money(state.cash) }} · {{ data.usedToday }} of {{ data.perDay }} shout-outs used today.</p>
      </template>
    </template>
    <p class="civic-note">A shout-out costs {{ money(RADIO.price) }} · {{ RADIO.perPlayerPerDay }} a day each.</p>
    <HowItWorks id="radio-rules" page label="How shout-outs work" :rules="radioRules()" />
  </div>
</template>

<style scoped>
.civic-note { font-size: 12px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-2) 2px !important; }
.civic-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0 0; }
.civic-actions .civic-action { flex: 1 1 140px; display: grid; margin: 0; }
.civic-actions.is-stack { display: grid; }
:global(.ph.is-wide) .civic-actions.is-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
.civic-form { display: grid; gap: var(--s-3); margin: var(--s-2) 0; }
.civic-form.is-card { padding: var(--s-3) var(--s-4) var(--s-4); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.civic-form label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; margin: 0 !important; }
:global(.ph.is-wide) .civic-form input { max-width: 460px; }
.ui-row.is-you { background: color-mix(in srgb, var(--app-tint, var(--c-green)) 8%, #fff); }
.ui-row.is-you b { font-weight: 800; }
.radio-now { position: relative; display: grid; gap: 3px; margin-bottom: var(--s-2); padding: 18px 18px 44px; border-radius: var(--r-lg); background: #18283e; color: #fff; overflow: hidden; overflow-wrap: anywhere; box-shadow: var(--e-1); }
.radio-now.is-on { background: #442278; }
.radio-now strong { display: block; font-size: 20px; letter-spacing: -.3px; }
.radio-now small { font-size: 12px; line-height: 1.4; opacity: .85; }
.radio-bars { position: absolute; left: 18px; bottom: 14px; display: flex; align-items: flex-end; gap: 4px; height: 20px; }
.radio-bars i { width: 5px; border-radius: 3px; background: #ffffff80; }
.radio-bars i:nth-child(1) { height: 8px; }
.radio-bars i:nth-child(2) { height: 16px; }
.radio-bars i:nth-child(3) { height: 11px; }
.radio-bars i:nth-child(4) { height: 20px; }
.radio-bars i:nth-child(5) { height: 6px; }
.radio-now.is-off .radio-bars i { height: 4px; }
</style>
