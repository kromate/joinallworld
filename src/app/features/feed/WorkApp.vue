<script setup lang="ts">
// Work (docs/FEED.md): the LinkedIn layer, built from what the world already knows. A gig board per city where people and AI characters
// post small jobs for game money, apply, choose, finish and review each other. Reviews, finished gigs and friends' vouches make the work
// part of a profile. The reward is game money paid as a gift between friends (the gift rules hold); nothing here moves money by itself.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import './feed.css'
import { onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { feedApi } from './feedApi.ts'
import { FEED, agoText } from '../../../feed/model.ts'
import type { GigView } from '../../../types/feed.ts'
import { isPlayApp } from '../../playMode.ts'

const { game, shell } = useApp()
const playApp = isPlayApp()
const api = feedApi((path, options) => game.fetchJson(path, options))
const gigs = ref<GigView[]>([]), mine = ref<GigView[]>([]), busy = ref(false), making = ref(false), now = ref(Date.now())
const form = ref({ title: '', about: '', reward: 1000 })
const review = ref<Record<string, { stars: number; text: string }>>({})
const toast = (t: string, tone?: 'error'): void => game.toast(t, tone === 'error' ? 'error' : 'info')
const naira = (n: number): string => `₦${n.toLocaleString('en-NG')}`
async function load(): Promise<void> {
  const r = await api.gigs(game.view.value.cityId)
  if (r.ok) { gigs.value = r.gigs; mine.value = r.mine; now.value = Date.now() } else toast(r.reason, 'error')
}
onMounted(load)
async function create(): Promise<void> {
  busy.value = true; const r = await api.createGig(form.value); busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  making.value = false; form.value = { title: '', about: '', reward: 1000 }; toast('Your gig is on the board.'); await load()
}
async function act(g: GigView, op: string, extra: Record<string, unknown> = {}): Promise<void> {
  busy.value = true; const r = await api.gigAct(g.id, op, extra); busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  if (op === 'choose') toast(`Chosen. Add ${r.gig.worker?.name ?? 'them'} as a friend to pay the reward as a gift.`)
  if (op === 'done') toast('Done. Leave a review, and send the reward from Messages.')
  await load()
}
// Paying the worker in real money (docs/EARN.md): straight to their Bachs payout account, Allworld's fee taken by Bachs.
const paying = ref<{ id: string; amount: number; email: string } | null>(null)
async function payReal(): Promise<void> {
  const p = paying.value; if (!p) return
  busy.value = true
  let r: { ok: true; pay: string } | { ok: false; reason: string }
  try { r = await game.fetchJson('/api/earn/pay', { method: 'POST', body: { kind: 'gig', id: p.id, amount: p.amount, email: p.email } }) } catch (e) { r = { ok: false, reason: (e as { reason?: string }).reason ?? 'That did not go through.' } }
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  location.assign(r.pay)
}
const stateWord: Record<GigView['state'], string> = { open: 'Open', taken: 'Taken', done: 'Done', closed: 'Closed' }
const reviewFor = (g: GigView): { stars: number; text: string } => (review.value[g.id] ??= { stars: 5, text: '' })
const canReview = (g: GigView): boolean => g.state === 'done' && Boolean(g.reviewed) && ((g.mine && !g.reviewed!.poster) || (!g.mine && !g.reviewed!.worker))
</script>

<template>
  <section class="feed" aria-label="Work" data-feed="work">
    <p class="social-note">Small jobs in your city, posted by people and AI characters, paid in game money. Reviews build your work profile.</p>
    <button v-if="!making" type="button" class="social-btn is-primary" @click="making = true">Post a gig</button>
    <form v-if="making" class="feed-card feed-form" @submit.prevent="create">
      <label>What needs doing<input v-model="form.title" :maxlength="FEED.gig.title" placeholder="Paint my shop sign"></label>
      <label>Details<textarea v-model="form.about" :maxlength="FEED.gig.about" placeholder="When, where, how long" /></label>
      <label>Reward in game money (₦)<input v-model.number="form.reward" type="number" min="0" :max="FEED.gig.rewardMax" step="100"></label>
      <div class="feed-row"><button type="submit" class="social-btn is-primary" :disabled="busy || form.title.trim().length < 3">Post it</button><button type="button" class="feed-pill" @click="making = false">Cancel</button></div>
    </form>

    <template v-if="mine.length">
      <b>Yours</b>
      <div v-for="g in mine" :key="g.id" class="feed-card feed-form">
        <div class="feed-head"><div class="feed-who"><b>{{ g.title }}</b><small>{{ stateWord[g.state] }} · {{ naira(g.reward) }} · {{ g.mine ? `${g.applicants} applied` : `by ${g.by.name}` }}</small></div></div>
        <p v-if="g.about" class="feed-body">{{ g.about }}</p>
        <template v-if="g.mine && g.state === 'open'">
          <p v-if="!g.people?.length" class="feed-note">No one has applied yet.</p>
          <div v-for="p in g.people ?? []" :key="p.id" class="feed-row"><button type="button" class="feed-name" @click="shell.open('person', { player: p.id, name: p.name })"><b>{{ p.name }}</b></button><span v-if="p.ai" class="ai-tag">AI-played</span><button type="button" class="feed-pill" :disabled="busy" @click="act(g, 'choose', { worker: p.id })">Choose</button></div>
          <button type="button" class="feed-pill" @click="act(g, 'close')">Close</button>
        </template>
        <div v-if="g.mine && g.state === 'taken'" class="feed-row"><span class="feed-note">{{ g.worker?.name }} is on it.</span><button type="button" class="social-btn is-primary" :disabled="busy" @click="act(g, 'done')">Mark done</button></div>
        <p v-if="!playApp && g.paid" class="feed-note" data-earn="gig-paid">Paid ₦{{ g.paid.toLocaleString('en-NG') }} in real money.</p>
        <template v-else-if="!playApp && g.mine && (g.state === 'taken' || g.state === 'done')">
          <form v-if="paying?.id === g.id" class="feed-form" @submit.prevent="payReal">
            <label>Amount in real naira<input v-model.number="paying.amount" type="number" min="500" step="100"></label>
            <label>E-mail for the receipt<input v-model="paying.email" type="email" autocomplete="email"></label>
            <div class="feed-row"><button type="submit" class="social-btn is-primary" :disabled="busy || !paying.email.includes('@')">Pay {{ g.worker?.name }} ₦{{ (paying.amount || 0).toLocaleString('en-NG') }}</button><button type="button" class="feed-pill" @click="paying = null">Cancel</button></div>
            <p class="feed-note">Paid through Bachs straight to their payout account. Allworld never holds it.</p>
          </form>
          <button v-else type="button" class="feed-pill" @click="paying = { id: g.id, amount: 5000, email: '' }">Pay in real money</button>
        </template>
        <div v-if="!g.mine && g.state === 'open'" class="feed-row"><span class="feed-note">You applied.</span><button type="button" class="feed-pill" @click="act(g, 'withdraw')">Withdraw</button></div>
        <div v-if="canReview(g)" class="feed-form">
          <span class="feed-stars" role="radiogroup" aria-label="Stars"><button v-for="n in 5" :key="n" type="button" :aria-label="`${n} stars`" @click="reviewFor(g).stars = n">{{ n <= reviewFor(g).stars ? '★' : '☆' }}</button></span>
          <input v-model="reviewFor(g).text" :maxlength="FEED.gig.review" placeholder="A few words (optional)">
          <button type="button" class="social-btn" :disabled="busy" @click="act(g, 'review', reviewFor(g))">Leave the review</button>
        </div>
      </div>
    </template>

    <b>Open in your city</b>
    <p v-if="!gigs.length" class="feed-note">No open gigs right now.</p>
    <div v-for="g in gigs" :key="g.id" class="feed-card">
      <div class="feed-head"><div class="feed-who"><b>{{ g.title }}</b><small>{{ naira(g.reward) }} · {{ g.by.name }}<template v-if="g.by.ai"> · AI-played</template> · {{ agoText(g.at, now) }}</small></div>
        <button v-if="!g.mine && !g.applied" type="button" class="social-btn is-primary" :disabled="busy" @click="act(g, 'apply')">Apply</button><span v-else-if="g.applied" class="feed-note">Applied</span></div>
      <p v-if="g.about" class="feed-body">{{ g.about }}</p>
    </div>
  </section>
</template>
