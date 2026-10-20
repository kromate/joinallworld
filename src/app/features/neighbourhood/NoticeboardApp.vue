<script setup lang="ts">
// The neighbourhood noticeboard and "Meet your neighbours" (docs/NEIGHBOURHOOD.md): for people whose location badge names the area. Notices
// about power, water, lost and found and roadworks, kept current by "still true?" votes; and the area's monthly meetup, free or ticketed.
// It is the "Neighbours" side of the Plans app (feed/PlansApp.vue), fetched only when that side is opened, so the phone's list of apps and the
// first download do not grow. It draws inside Plans' own `.feed` section.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import '../feed/feed.css'
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { NOTICE } from '../../../neighbourhood/model.ts'
import type { BoardView, MeetupsView, MeetupView, NoticeView } from '../../../types/neighbourhood.ts'
import { isPlayApp } from '../../playMode.ts'

const { game, shell } = useApp()
const playApp = isPlayApp()
const tab = ref<'board' | 'meet'>('board')
type R<T> = ({ ok: true } & T) | { ok: false; code?: string; reason: string }
const call = async <T,>(path: string, body?: object): Promise<R<T>> => { try { return await game.fetchJson(path, body ? { method: 'POST', body } : undefined) } catch (e) { return { ok: false, reason: (e as { reason?: string }).reason ?? 'That did not go through.' } } }
const toast = (t: string, tone?: 'error'): void => game.toast(t, tone === 'error' ? 'error' : 'info')
const board = ref<BoardView | null>(null), needBadge = ref(''), meetups = ref<MeetupsView | null>(null), busy = ref(false)
const draft = ref({ kind: 'power', body: '' })
const plan = ref({ crew: '', price: 0 }), planNote = ref('')
async function loadBoard(): Promise<void> {
  const r = await call<BoardView>('/api/neighbourhood/board')
  if (r.ok) { board.value = r; needBadge.value = '' } else if (r.code === 'badge_needed') { board.value = null; needBadge.value = r.reason }
}
async function loadMeetups(): Promise<void> { const r = await call<MeetupsView>('/api/neighbourhood/meetups'); if (r.ok) { meetups.value = r; if (!plan.value.crew && r.plannable[0]) plan.value.crew = r.plannable[0].crew } }
onMounted(() => { void loadBoard(); void loadMeetups() })
watch(() => game.view.value.connected, (on, was) => { if (on && !was) { void loadBoard(); void loadMeetups() } })

async function post(): Promise<void> {
  busy.value = true
  const r = await call<{ notice: NoticeView }>('/api/neighbourhood/notices', { kind: draft.value.kind, body: draft.value.body })
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  draft.value.body = ''
  toast('Thanks. A reviewer reads every notice first; it goes up in a moment.')
  await loadBoard()
}
async function vote(n: NoticeView, v: 'up' | 'down'): Promise<void> {
  const r = await call<{ notice: NoticeView }>('/api/neighbourhood/notices/vote', { id: n.id, vote: n.vote === v ? null : v })
  if (!r.ok) { toast(r.reason, 'error'); return }
  await loadBoard()
}
async function report(n: NoticeView): Promise<void> { const r = await call('/api/neighbourhood/notices/report', { id: n.id }); toast(r.ok ? 'Thanks. We will look at it.' : r.reason, r.ok ? undefined : 'error') }
async function remove(n: NoticeView): Promise<void> { const r = await call('/api/neighbourhood/notices/remove', { id: n.id }); if (r.ok) await loadBoard(); else toast(r.reason, 'error') }

const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
async function go(m: MeetupView): Promise<void> {
  const r = await call<object>('/api/feed/events/rsvp', { id: m.event.id, answer: 'going' })
  if (!r.ok) { toast(r.reason, 'error'); return }
  toast('You are on the list.'); await loadMeetups()
}
async function planIt(): Promise<void> {
  busy.value = true; planNote.value = ''
  const r = await call<{ meetup: MeetupView; priceNote?: string }>('/api/neighbourhood/meetups/plan', { crew: plan.value.crew, ...(!playApp && plan.value.price > 0 ? { price: plan.value.price } : {}) })
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  planNote.value = r.priceNote ?? ''
  toast('Your meetup is planned.'); await loadMeetups()
}
const kinds = computed(() => board.value?.kinds ?? [])
const hint = computed(() => kinds.value.find((k) => k.id === draft.value.kind)?.hint ?? '')
</script>

<template>
  <div aria-label="Noticeboard" role="region" data-hood="app">
    <nav class="feed-tabs"><button type="button" :class="{ 'is-on': tab === 'board' }" @click="tab = 'board'">Noticeboard</button><button type="button" :class="{ 'is-on': tab === 'meet' }" @click="tab = 'meet'">Meet your neighbours</button></nav>

    <template v-if="tab === 'board'">
      <template v-if="board">
        <p class="social-note">{{ board.area.name }}. Notices from people who are really here. Say whether a notice is still true, so the board stays current.</p>
        <form v-if="board.canPost" class="feed-card feed-form" @submit.prevent="post">
          <label>What is it about<select v-model="draft.kind"><option v-for="k in kinds" :key="k.id" :value="k.id">{{ k.label }}</option></select></label>
          <label>{{ hint }}<textarea v-model="draft.body" :maxlength="NOTICE.max" placeholder="Light came back on Adeola Street at 7pm" /></label>
          <p class="feed-note">No names of people, phone numbers or links. Every notice is read by a reviewer before it goes up.</p>
          <button type="submit" class="social-btn is-primary" :disabled="busy || draft.body.trim().length < NOTICE.min">Post to the board</button>
        </form>
        <p v-else class="feed-note">Posting is for people confirmed as 18 or older. You can still say whether a notice is true.</p>
        <article v-for="n in board.mine" :key="n.id" class="feed-card">
          <div class="feed-head"><div class="feed-who"><b>{{ n.kindLabel }}</b><small>{{ n.status === 'review' ? 'Being checked' : 'Not accepted' }}</small></div></div>
          <p class="feed-body">{{ n.body }}</p><p v-if="n.reason" class="feed-error">{{ n.reason }}</p>
        </article>
        <p v-if="!board.notices.length" class="feed-note">Nothing on the board right now. If the light is on and the water runs, that is good news.</p>
        <article v-for="n in board.notices" :key="n.id" class="feed-card" :data-notice="n.id">
          <div class="feed-head"><div class="feed-who"><b>{{ n.kindLabel }}</b><small>{{ n.by }} · {{ n.left }}</small></div></div>
          <p class="feed-body">{{ n.body }}</p>
          <div class="feed-bar">
            <template v-if="!n.mine"><button type="button" :class="{ 'is-on': n.vote === 'up' }" @click="vote(n, 'up')">Still true · {{ n.up }}</button><button type="button" :class="{ 'is-on': n.vote === 'down' }" @click="vote(n, 'down')">Not true · {{ n.down }}</button><button type="button" @click="report(n)">Report</button></template>
            <template v-else><span class="feed-note">{{ n.up }} say still true · {{ n.down }} say not</span><button type="button" @click="remove(n)">Remove</button></template>
          </div>
        </article>
      </template>
      <template v-else-if="needBadge">
        <p class="feed-note">{{ needBadge }}</p>
        <button type="button" class="social-btn is-primary" @click="shell.open('me')">Confirm where I am</button>
      </template>
    </template>

    <template v-else>
      <p class="social-note">Once a month, on the first Saturday, people confirmed in the same area meet.<template v-if="!playApp"> Free, or with a ticket the host sets.</template></p>
      <p v-if="meetups && !meetups.area" class="feed-note">Confirm where you are in My profile to see your area's meetup.</p>
      <p v-else-if="meetups && !meetups.meetups.length" class="feed-note">No meetup planned yet for {{ meetups.area?.cityName }}. Next one: {{ when(meetups.next) }}.</p>
      <article v-for="m in meetups?.meetups ?? []" :key="m.event.id" class="feed-card" :data-meetup="m.event.id">
        <div class="feed-head"><div class="feed-who"><b>{{ m.event.title }}</b><small>{{ m.area.name }} · {{ when(m.event.start) }} · {{ m.event.going }} going</small></div></div>
        <p v-if="m.event.about" class="feed-body">{{ m.event.about }}</p>
        <div class="feed-bar">
          <span v-if="m.event.me === 'going'" class="feed-note">You are going</span>
          <button v-else-if="m.canGo && !m.event.price" type="button" @click="go(m)">I'm coming</button>
          <button v-else-if="!playApp && m.canGo && m.event.price" type="button" @click="shell.open('plans')">Get a ticket · ₦{{ m.event.price.toLocaleString('en-NG') }}</button>
          <span v-else class="feed-note">For people confirmed in {{ m.area.name }}</span>
        </div>
      </article>
      <form v-if="meetups?.plannable.length" class="feed-card feed-form" @submit.prevent="planIt">
        <b>Host the next meetup</b>
        <label>Community<select v-model="plan.crew"><option v-for="p in meetups.plannable" :key="p.crew" :value="p.crew">{{ p.name }} · {{ p.area.name }}</option></select></label>
        <label v-if="!playApp">Ticket price in naira (0 is free; needs your Earn account)<input v-model.number="plan.price" type="number" min="0"></label>
        <p v-if="planNote" class="feed-error">{{ planNote }}</p>
        <button type="submit" class="social-btn is-primary" :disabled="busy">Plan for {{ when(meetups.next) }}</button>
      </form>
    </template>
  </div>
</template>
