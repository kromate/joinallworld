<script setup lang="ts">
// Plans (docs/FEED.md): events people make at a place and a time, with RSVP, a page that previews in WhatsApp (/ev/<code>) and a reminder
// in the inbox half an hour before. Guests can become hosts in one tap ("Plan the next one"). Festivals of the calendar stay in Events.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import './feed.css'
import { defineAsyncComponent, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { feedApi } from './feedApi.ts'
import { shareLink, whatsappUrl } from './feedShare.ts'
import { FEED } from '../../../feed/model.ts'
import type { EventView } from '../../../types/feed.ts'
import { isPlayApp } from '../../playMode.ts'

// The area's noticeboard and its monthly meetup (docs/NEIGHBOURHOOD.md) are the Neighbours side of this app, fetched only when it is opened.
const NoticeboardApp = defineAsyncComponent(() => import('../neighbourhood/NoticeboardApp.vue'))
// Hosted talks on a stage (docs/SOCIAL-GLUE.md "Stage rooms"): the Talks side, fetched only when it is opened.
const GluePart = defineAsyncComponent(() => import('../glue/GluePart.vue'))
const props = defineProps<{ params?: { event?: string; code?: string; tab?: string } | null }>()
const side = ref<'plans' | 'hood' | 'talks'>(props.params?.tab === 'neighbours' ? 'hood' : props.params?.tab === 'talks' ? 'talks' : 'plans')
const { game, shell } = useApp()
const playApp = isPlayApp()
const api = feedApi((path, options) => game.fetchJson(path, options))
const events = ref<EventView[]>([]), mine = ref<EventView[]>([]), open = ref<EventView | null>(null), busy = ref(false), making = ref(false)
const toast = (t: string, tone?: 'error'): void => game.toast(t, tone === 'error' ? 'error' : 'info')
const pad = (n: number): string => String(n).padStart(2, '0')
const local = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
const form = ref({ title: '', about: '', start: local(Date.now() + 3 * 3600000), hours: 2, place: 'The Square', cap: 50 })
const when = (e: EventView): string => (e.phase === 'live' ? 'Happening now' : new Date(e.start).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
async function load(): Promise<void> {
  const r = await api.events(game.view.value.cityId)
  if (r.ok) { events.value = r.events; mine.value = r.mine }
  const wanted = props.params?.event ?? props.params?.code
  if (wanted && !open.value) { const e = await api.event(wanted); if (e.ok) open.value = e.event; else toast(e.reason, 'error') }
}
onMounted(load)
async function create(): Promise<void> {
  busy.value = true
  const r = await api.createEvent({ title: form.value.title, about: form.value.about, start: new Date(form.value.start).getTime(), hours: form.value.hours, place: form.value.place, cap: form.value.cap })
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  making.value = false; open.value = r.event; toast('Your event is up. Share the invitation.'); await load()
}
async function answer(e: EventView, a: 'going' | 'maybe' | null): Promise<void> {
  const r = await api.rsvp(e.id, a)
  if (!r.ok) { toast(r.reason, 'error'); return }
  open.value = r.event; await load()
}
async function cancel(e: EventView): Promise<void> {
  if (!confirm('Call this event off? Everyone who answered is told.')) return
  const r = await api.cancelEvent(e.id)
  if (r.ok) { open.value = null; await load() } else toast(r.reason, 'error')
}
async function share(e: EventView): Promise<void> { if ((await shareLink(`/ev/${e.code}`, `Come to ${e.title} on Allworld`)) === 'copied') toast('Link copied.') }
function again(e: EventView): void { form.value = { ...form.value, title: e.title, about: e.about, place: e.place.label ?? 'The Square' }; open.value = null; making.value = true }
// Tickets in real money (docs/EARN.md): the host sets a price once their payout account is ready; a guest pays through Bachs.
const ticket = ref({ price: 2000, email: '' }), buying = ref(false), pricing = ref(false)
type R<T> = ({ ok: true } & T) | { ok: false; reason: string }
const earnCall = async <T,>(path: string, body: object): Promise<R<T>> => { try { return await game.fetchJson(path, { method: 'POST', body }) } catch (e) { return { ok: false, reason: (e as { reason?: string }).reason ?? 'That did not go through.' } } }
async function setPrice(e: EventView, price: number): Promise<void> {
  busy.value = true; const r = await earnCall<{ price: number }>('/api/earn/price', { event: e.id, price }); busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  pricing.value = false; toast(r.price ? `Tickets are ₦${r.price.toLocaleString('en-NG')}.` : 'The event is free again.')
  const fresh = await api.event(e.id); if (fresh.ok) open.value = fresh.event
}
async function buy(e: EventView): Promise<void> {
  busy.value = true; const r = await earnCall<{ pay: string }>('/api/earn/pay', { kind: 'ticket', id: e.id, email: ticket.value.email }); busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  location.assign(r.pay)
}
const go = (e: EventView): void => { if (/square/i.test(e.place.label ?? '')) shell.open('places'); else shell.open('places') }
</script>

<template>
  <section class="feed" aria-label="Plans" data-feed="plans">
    <nav v-if="!open" class="feed-tabs"><button type="button" :class="{ 'is-on': side === 'plans' }" @click="side = 'plans'">Plans</button><button type="button" :class="{ 'is-on': side === 'hood' }" @click="side = 'hood'">Neighbours</button><button type="button" :class="{ 'is-on': side === 'talks' }" data-glue="talks-tab" @click="side = 'talks'">Talks</button></nav>
    <NoticeboardApp v-if="!open && side === 'hood'" />
    <GluePart v-else-if="!open && side === 'talks'" part="talks" />
    <template v-else-if="open">
      <button type="button" class="feed-pill" @click="open = null">← All plans</button>
      <div class="feed-card feed-form">
        <small class="feed-note">{{ when(open) }} · {{ open.place.label }} · {{ open.place.cityName }}</small>
        <b style="font-size:20px">{{ open.title }}</b>
        <p v-if="open.about" class="feed-body">{{ open.about }}</p>
        <p class="feed-note">Hosted by {{ open.by.name }}<template v-if="open.cohosts.length"> with {{ open.cohosts.map((c) => c.name).join(', ') }}</template> · {{ open.going }} going · {{ open.maybe }} maybe · room for {{ open.cap }}</p>
        <p v-if="open.friendsGoing.length" class="feed-note">Friends going: {{ open.friendsGoing.map((f) => f.name).join(', ') }}</p>
        <p v-if="!playApp && open.price" class="feed-note" data-earn="ticket">Ticket ₦{{ open.price.toLocaleString('en-NG') }}<template v-if="open.ticket"> · you have one</template></p>
        <form v-if="!playApp && open.price && !open.ticket && !open.mine && open.phase !== 'over'" class="feed-row" @submit.prevent="buy(open)">
          <template v-if="buying"><input v-model="ticket.email" type="email" autocomplete="email" placeholder="E-mail for the receipt" aria-label="E-mail for the receipt"><button type="submit" class="social-btn is-primary" :disabled="busy || !ticket.email.includes('@')">Pay ₦{{ open.price.toLocaleString('en-NG') }}</button></template>
          <button v-else type="button" class="social-btn is-primary" @click="buying = true">Buy a ticket</button>
        </form>
        <div v-if="!playApp && open.mine && open.phase !== 'over'" class="feed-row">
          <template v-if="pricing"><input v-model.number="ticket.price" type="number" min="200" step="100" aria-label="Ticket price in naira"><button type="button" class="social-btn" :disabled="busy" @click="setPrice(open, ticket.price)">Set price</button><button v-if="open.price" type="button" class="feed-pill" @click="setPrice(open, 0)">Make it free</button></template>
          <button v-else type="button" class="feed-pill" @click="pricing = true">{{ open.price ? 'Change the ticket price' : 'Sell tickets (real money)' }}</button>
        </div>
        <div v-if="open.phase !== 'over'" class="feed-row">
          <button v-if="!open.price || open.ticket || open.mine" type="button" class="social-btn" :class="{ 'is-primary': open.me === 'going' }" @click="answer(open, 'going')">Going</button>
          <button type="button" class="social-btn" :class="{ 'is-primary': open.me === 'maybe' }" @click="answer(open, 'maybe')">Maybe</button>
          <button v-if="open.me && !open.mine" type="button" class="feed-pill" @click="answer(open, null)">Can't come</button>
        </div>
        <div class="feed-row">
          <button type="button" class="social-btn is-primary" @click="share(open)">Invite people</button>
          <a class="feed-pill" :href="whatsappUrl(`/ev/${open.code}`, `Come to ${open.title} on Allworld`)" target="_blank" rel="noopener">WhatsApp</a>
          <button v-if="open.phase === 'live'" type="button" class="feed-pill" @click="go(open)">Go there</button>
          <button type="button" class="feed-pill" @click="again(open)">Plan the next one</button>
          <button v-if="open.mine" type="button" class="feed-pill" @click="cancel(open)">Call it off</button>
        </div>
      </div>
    </template>

    <template v-else>
      <p class="social-note">Plan a hangout, a watch party or an owambe. People RSVP, and the link previews in WhatsApp.</p>
      <button v-if="!making" type="button" class="social-btn is-primary" @click="making = true">Plan something</button>
      <form v-if="making" class="feed-card feed-form" @submit.prevent="create">
        <label>What<input v-model="form.title" :maxlength="FEED.event.title" placeholder="Match night: Super Eagles"></label>
        <label>When<input v-model="form.start" type="datetime-local"></label>
        <label>How long (hours)<input v-model.number="form.hours" type="number" min="0.5" max="12" step="0.5"></label>
        <label>Where<input v-model="form.place" :maxlength="FEED.place" placeholder="The Square, my home, a venue"></label>
        <label>How many can come<input v-model.number="form.cap" type="number" min="2" :max="FEED.event.cap"></label>
        <label>Details<textarea v-model="form.about" :maxlength="FEED.event.about" placeholder="Dress code, what to bring" /></label>
        <div class="feed-row"><button type="submit" class="social-btn is-primary" :disabled="busy || form.title.trim().length < 3">Post the plan</button><button type="button" class="feed-pill" @click="making = false">Cancel</button></div>
      </form>
      <template v-if="mine.length"><b>You're in</b>
        <ul class="social-list"><li v-for="e in mine" :key="e.id" class="social-row"><div><strong>{{ e.title }}</strong><small>{{ when(e) }} · {{ e.place.label }} · {{ e.going }} going</small></div><span class="social-actions"><button type="button" class="social-btn" @click="open = e">Open</button></span></li></ul>
      </template>
      <b>Coming up in {{ events[0]?.place.cityName ?? 'your city' }}</b>
      <p v-if="!events.length" class="feed-note">Nothing planned yet. Be the first.</p>
      <ul v-else class="social-list"><li v-for="e in events" :key="e.id" class="social-row"><div><strong>{{ e.title }}</strong><small>{{ when(e) }} · {{ e.place.label }} · {{ e.going }} going<template v-if="e.friendsGoing.length"> · {{ e.friendsGoing.length }} friend{{ e.friendsGoing.length === 1 ? '' : 's' }}</template></small></div><span class="social-actions"><button type="button" class="social-btn" @click="open = e">Open</button></span></li></ul>
    </template>
  </section>
</template>
