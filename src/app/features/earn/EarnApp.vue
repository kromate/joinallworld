<script setup lang="ts">
// Earn (docs/EARN.md): real money, through Bachs, never held by Allworld and never game money. A payout account opened on Bachs's own
// page; what people paid you (tickets, gigs) and what you paid; and the creator pool: points from real people engaging with your public
// posts, this month's estimate, and each month's share.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import '../feed/feed.css'
import { onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { naira } from '../../../earn/model.ts'
import type { EarnMe, PoolMonthStatus } from '../../../types/earn.ts'
import { isPlayApp } from '../../playMode.ts'

const props = defineProps<{ params?: { tab?: string } | null }>()
const { game, shell } = useApp()
const playApp = isPlayApp()
const tab = ref<'money' | 'pool'>(props.params?.tab === 'pool' ? 'pool' : 'money')
const me = ref<EarnMe | null>(null), busy = ref(false), email = ref('')
const toast = (t: string, tone?: 'error'): void => game.toast(t, tone === 'error' ? 'error' : 'info')
type R<T> = ({ ok: true } & T) | { ok: false; reason: string }
const call = async <T,>(path: string, body?: object): Promise<R<T>> => { try { return await game.fetchJson(path, body ? { method: 'POST', body } : undefined) } catch (e) { return { ok: false, reason: (e as { reason?: string }).reason ?? 'That did not go through.' } } }
async function load(): Promise<void> { const r = await call<EarnMe>('/api/earn/me'); if (r.ok) me.value = r }
onMounted(() => { if (!playApp) void load().then(() => { if (me.value && me.value.status !== 'none' && me.value.status !== 'ready') void refresh(true) }) })
watch(() => game.view.value.connected, (on, was) => { if (!playApp && on && !was) void load() })

async function openAccount(): Promise<void> {
  busy.value = true
  const r = await call<{ url: string }>('/api/earn/account', me.value?.status === 'none' ? { email: email.value } : {})
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  location.assign(r.url)
}
async function refresh(quiet = false): Promise<void> {
  const r = await call<{ status: EarnMe['status'] }>('/api/earn/account/refresh', {})
  if (r.ok) { if (!quiet) toast(r.status === 'ready' ? 'Your payout account is ready.' : 'Bachs is still checking your details.'); await load() } else if (!quiet) toast(r.reason, 'error')
}
const statusWord: Record<EarnMe['status'], string> = { none: 'Not set up', setup: 'Bachs needs a few more details', review: 'Bachs is checking your details', ready: 'Ready to be paid' }
const saleWord = { pending: 'Waiting for payment', paid: 'Paid', cancelled: 'Cancelled' } as const
const monthWord: Record<PoolMonthStatus, string> = { counting: 'Counting', held: 'Held 30 days', payable: 'Being sent', paid: 'Sent to your account', carried: 'Carried to next month', none: '' }
const when = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const monthName = (m: string): string => new Date(`${m}-15T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
</script>

<template>
  <section v-if="!playApp" class="feed" aria-label="Earn" data-earn="app">
    <nav class="feed-tabs"><button type="button" :class="{ 'is-on': tab === 'money' }" @click="tab = 'money'">Get paid</button><button type="button" :class="{ 'is-on': tab === 'pool' }" @click="tab = 'pool'">Creator pool</button></nav>
    <p v-if="me && !me.open" class="feed-note">Earning real money opens soon.</p>
    <p v-else-if="me && !me.account" class="feed-note">Sign in first (Settings → Account), so your earnings stay yours on every device.</p>
    <p v-else-if="me && !me.adult" class="feed-note">Earning real money is for people confirmed as 18 or older.</p>

    <template v-if="tab === 'money'">
      <p class="social-note">Sell tickets to your events, get paid for gigs. People pay you directly through Bachs: the money goes to your own Bachs account and on to your bank. Allworld takes {{ me?.fees.ticket ?? 5 }}% of a ticket and {{ me?.fees.gig ?? 10 }}% of a gig, and never holds your money.</p>
      <div v-if="me?.open && me.account && me.adult" class="feed-card feed-form" data-earn="account">
        <b>Payout account</b>
        <p class="feed-note">{{ statusWord[me.status] }}<template v-if="me.email"> · {{ me.email }}</template><template v-if="me.sandbox"> · test mode</template></p>
        <template v-if="me.status === 'none'">
          <label>E-mail for your payout account<input v-model="email" type="email" autocomplete="email"></label>
          <p class="feed-note">Bachs, the payment company, checks who you are and takes your bank details on its own page. Allworld never sees your ID or bank number.</p>
          <button type="button" class="social-btn is-primary" :disabled="busy || !email.includes('@')" @click="openAccount">Set up with Bachs</button>
        </template>
        <div v-else class="feed-row">
          <button v-if="me.status !== 'ready'" type="button" class="social-btn is-primary" :disabled="busy" @click="openAccount">Continue on Bachs</button>
          <button v-else type="button" class="social-btn" :disabled="busy" @click="openAccount">Change bank details</button>
          <button type="button" class="feed-pill" @click="refresh()">Check again</button>
        </div>
      </div>
      <div class="feed-row"><button type="button" class="feed-pill" @click="shell.open('plans')">Sell tickets in Plans</button><button type="button" class="feed-pill" @click="shell.open('work')">Gigs in Work</button></div>
      <b v-if="me?.sales.length">Payments</b>
      <ul v-if="me?.sales.length" class="social-list"><li v-for="s in me.sales" :key="s.id" class="social-row" :data-sale="s.status"><div><strong>{{ s.title }}</strong><small>{{ s.side === 'seller' ? `From ${s.other}` : `To ${s.other}` }} · {{ naira(s.amount) }}<template v-if="s.side === 'seller' && s.status === 'paid'"> · you get {{ naira(s.amount - s.fee) }}</template> · {{ saleWord[s.status] }} · {{ when(s.at) }}</small></div></li></ul>
      <p v-else class="feed-note">No payments yet.</p>
    </template>

    <template v-else>
      <p class="social-note">Each month Allworld shares {{ me?.pool.share ?? 30 }}% of what it really earned (from business boosts) with the people whose public posts others enjoy. You get a point when a signed-in adult reacts to or replies to your public post: one a day from each person. With {{ me?.pool.minPoints ?? 20 }} points or more you share in the month; payouts start at {{ naira(me?.pool.threshold ?? 10000) }} (less is carried over), 30 days after the month ends.</p>
      <div v-if="me" class="feed-card feed-form" data-earn="pool">
        <b>This month</b>
        <p class="feed-body">{{ me.pool.points }} point{{ me.pool.points === 1 ? '' : 's' }} · estimate {{ naira(me.pool.estimate) }}</p>
        <p class="feed-note">The pool so far: {{ naira(Math.floor(me.pool.revenue * me.pool.share / 100)) }}. The estimate changes as the month goes on.<template v-if="me.pool.carried"> Carried from before: {{ naira(me.pool.carried) }}.</template></p>
        <p v-if="me.status !== 'ready'" class="feed-note">Set up your payout account in Get paid to receive your share.</p>
      </div>
      <ul v-if="me?.pool.months.length" class="social-list"><li v-for="m in me.pool.months" :key="m.month" class="social-row"><div><strong>{{ monthName(m.month) }}</strong><small>{{ m.points }} points<template v-if="m.amount"> · {{ naira(m.amount) }}</template><template v-if="monthWord[m.status]"> · {{ monthWord[m.status] }}</template><template v-if="m.payableAt && m.status === 'held'"> until {{ when(m.payableAt) }}</template></small></div></li></ul>
      <p class="feed-note">Points from many different people count; bought or swapped reactions do not, and an account that games them is left out.</p>
    </template>
  </section>
  <p v-else class="feed-note" data-earn="play-hidden">This feature is not available in this app.</p>
</template>
