<script setup lang="ts">
// The dashboard: it answers "how is the game doing today?" first (six tiles with a 14-day trend and the change against yesterday), then
// growth and activity over 30 days, the new-player funnel, each city, the economy, the social side, the AI guide and the system. Every
// panel says what it cost to get and whether it is exact. It refreshes itself every minute and says when its numbers are from.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAdmin } from './useAdmin.ts'
import { absolute, bytes, naira, relative, uptime } from './adminModel.ts'
import { accountsPerDay, field, fillTone, lastDays, percent, returning, series, shortDate, sizeTone, tileChange } from './dashboardModel.ts'
import type { DayRow } from './dashboardModel.ts'
import Spark from './charts/Spark.vue'
import Trend from './charts/Trend.vue'
import Funnel from './charts/Funnel.vue'
import type { FunnelRow } from './charts/Funnel.vue'
import { recordDone } from './adminUi.ts'

const emit = defineEmits<{ player: [id: string] }>()
const api = useAdmin()
interface Dash {
  asOf: number; online: { value: number; cities: Record<string, number> }; cities: Record<string, { new: number; seen: number }>; yesterday: { new: number; active: number; sessions: number }; today: { sessions: number }
  players: { newToday: number; new7d: number; activeToday: number; active7d: { exact: number; olderVisits: number }; active30d: { exact: number; olderVisits: number }; note: string }
  accounts: { accounts: number; guests: number }; capacity: { sessions: { held: number; most: number }; sockets: { open: number; most: number; perAddress: number } }
  businesses: { open: number; total: number }; reports: { open: number; problems: { open: number } }
  mail: { email: { sentToday: number; cap: number; off: boolean }; push: { sentToday: number; cap: number; off: boolean } }
  adminMoney: { creditToday: number; debitToday: number; grantToday: number }
  storage: { collections: Record<string, number>; rows: unknown; writes: number | null }; build: string; uptimeMs: number
  extra: { id: string; label: string; group?: string; cost: string; value: number | string | null }[]
}
interface Hist { asOf: number; startedOn: string | null; kept: number; days: DayRow[]; funnel: { today: { steps: FunnelRow[]; returned: { size: number; back: number; rate: number | null } }; week: { steps: FunnelRow[]; returned: { size: number; back: number; rate: number | null } } } }
interface Eco {
  asOf: number; cashInCirculation: number; players: number; median: number; richest: { id: string; name: string; cash: number }[]; sessionsRead: number; truncated: boolean; cost: string
  faucets: { category: string; net: number }[]; sinks: { category: string; net: number }[]; adminMoney: { category: string; net: number }[]
  cities: Record<string, { residents: number; visitors: number }>; social: { messagesToday: number; groups: number; conversations: number; pings: number }
}
const dash = ref<Dash | null>(null), hist = ref<Hist | null>(null), eco = ref<Eco | null>(null), error = ref(''), busy = ref(false)
const span = ref<'today' | 'week'>('week'), now = ref(Date.now())
async function load(fresh = false): Promise<void> {
  busy.value = true
  const [d, h] = await Promise.all([api.get<Dash>('/api/admin/dashboard', fresh ? { fresh: 1 } : {}), api.get<Hist>('/api/admin/history', { days: 30 })])
  busy.value = false
  if (d.ok) { dash.value = d.data; error.value = '' } else error.value = d.error.reason
  if (h.ok) hist.value = h.data
}
async function economy(fresh = false): Promise<void> {
  const reply = await api.get<Eco>('/api/admin/economy', fresh ? { fresh: 1 } : {})
  if (reply.ok) eco.value = reply.data; else error.value = reply.error.reason
}
let timer: ReturnType<typeof setInterval> | undefined, ticks = 0
onMounted(() => { void load(); void economy(); timer = setInterval(() => { now.value = Date.now(); ticks += 1; if (ticks % 6 === 0) void load(); if (ticks % 60 === 0) void economy() }, 10000) })
onBeforeUnmount(() => clearInterval(timer))

const days = computed(() => hist.value?.days ?? [])
const labels = computed(() => days.value.map((row) => shortDate(row.date)))
const two = computed(() => lastDays(days.value, 14)), twoLabels = computed(() => two.value.map((row) => shortDate(row.date)))
const newSeries = computed(() => series(two.value, (row) => row.new)), seenSeries = computed(() => series(two.value, (row) => row.seen))
const peakSeries = computed(() => series(two.value, field('peakOnline'))), accSeries = computed(() => series(two.value, field('accounts')))
const returningNow = computed(() => (dash.value ? returning(dash.value.players.active7d.exact, dash.value.players.new7d) : 0))
const extra = (id: string): number | string | null => dash.value?.extra.find((item) => item.id === id)?.value ?? null
const group = (name: string): { label: string; value: number | string | null }[] => (dash.value?.extra ?? []).filter((item) => item.group === name).map((item) => ({ label: item.label, value: item.value }))
const cityRows = computed(() => {
  const ids = new Set([...Object.keys(dash.value?.online.cities ?? {}), ...Object.keys(dash.value?.cities ?? {}), ...Object.keys(eco.value?.cities ?? {})])
  return [...ids].map((id) => ({ id, online: dash.value?.online.cities[id] ?? 0, new: dash.value?.cities[id]?.new ?? 0, seen: dash.value?.cities[id]?.seen ?? 0, residents: eco.value?.cities[id]?.residents ?? null, visitors: eco.value?.cities[id]?.visitors ?? null }))
    .sort((a, b) => b.online - a.online || b.seen - a.seen || a.id.localeCompare(b.id))
})
const collections = computed(() => Object.entries(dash.value?.storage.collections ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12))
const funnel = computed(() => hist.value?.funnel[span.value])
const tileNote = (text: string | null): string => text ?? 'no earlier day to compare with'

const guideTest = ref('')
async function testGuide(): Promise<void> {
  guideTest.value = 'Asking…'
  const reply = await api.post<{ ok: boolean; model?: string; ms?: number; error?: string }>('/api/admin/companion/test', {}, `guide-test:${Date.now()}`)
  guideTest.value = !reply.ok ? reply.error.reason : reply.data.ok ? `The guide answered in ${reply.data.ms} ms (${reply.data.model}).` : `The guide did not answer: ${reply.data.error} (${reply.data.ms} ms).`
  recordDone(guideTest.value, reply.ok && reply.data.ok === true)
}
const asOf = computed(() => (dash.value ? `as of ${absolute(dash.value.asOf)}, ${relative(dash.value.asOf, now.value)}` : ''))
</script>

<template>
  <section class="adm-dash" aria-label="Dashboard">
    <div class="adm-row adm-between">
      <p class="adm-muted" role="status">{{ asOf || 'Loading…' }}<template v-if="dash"> · refreshes every minute · build {{ dash.build }}, up {{ uptime(dash.uptimeMs) }}</template></p>
      <button class="adm-btn" :disabled="busy" @click="load(true); economy(true)">{{ busy ? 'Refreshing…' : 'Refresh now' }}</button>
    </div>
    <p v-if="error" class="adm-error" role="alert">{{ error }}</p>
    <div v-if="!dash && !error" class="adm-grid" aria-busy="true"><div v-for="n in 6" :key="n" class="adm-card adm-skeleton" /></div>
    <template v-if="dash">
      <div class="adm-tiles">
        <div class="adm-card adm-tile"><h3>Online now</h3><div class="adm-big">{{ dash.online.value }}</div><Spark :values="peakSeries" :labels="twoLabels" name="Busiest moment of each day" /><div class="adm-sub">exact, live · trend is the busiest moment of each day</div></div>
        <div class="adm-card adm-tile"><h3>Players today</h3><div class="adm-big">{{ dash.players.activeToday }}</div><Spark :values="seenSeries" :labels="twoLabels" name="Players seen each day" /><div class="adm-sub">{{ tileNote(tileChange([dash.yesterday.active, dash.players.activeToday])) }}</div></div>
        <div class="adm-card adm-tile"><h3>New today</h3><div class="adm-big">{{ dash.players.newToday }}</div><Spark :values="newSeries" :labels="twoLabels" name="New players each day" color="#2563eb" /><div class="adm-sub">{{ tileNote(tileChange([dash.yesterday.new, dash.players.newToday])) }}</div></div>
        <div class="adm-card adm-tile"><h3>Signed up / guests</h3><div class="adm-big">{{ dash.accounts.accounts }} <small>/ {{ dash.accounts.guests }}</small></div><Spark :values="accSeries" :labels="twoLabels" name="Accounts" color="#7c3aed" /><div class="adm-sub">{{ percent(dash.accounts.accounts, dash.accounts.accounts + dash.accounts.guests) }}% have an account · guests approximate</div></div>
        <div class="adm-card adm-tile"><h3>Back in 7 days</h3><div class="adm-big">{{ returningNow }}</div><Spark :values="seenSeries" :labels="twoLabels" name="Players seen each day" color="#b45309" /><div class="adm-sub">seen this week, not new this week · approximate</div></div>
        <div class="adm-card adm-tile"><h3>Open reports</h3><div class="adm-big">{{ dash.reports.open }}</div><div class="adm-sub">{{ dash.reports.problems.open }} problem reports open · {{ dash.businesses.open }} stalls open</div></div>
      </div>

      <div class="adm-two">
        <div class="adm-card"><Trend title="Growth: new players and new accounts a day" :labels="labels" :series="[{ name: 'New players', color: '#2563eb', values: series(days, (row) => row.new) }, { name: 'New accounts', color: '#7c3aed', values: accountsPerDay(days) }]" /><p class="adm-sub">New players: exact (counted as they arrive). New accounts: the growth of the count between measured days, so a gap is a day not measured. History: {{ hist?.startedOn ? `daily samples start ${hist.startedOn}` : 'daily samples start now' }}.</p></div>
        <div class="adm-card"><Trend title="Activity: distinct players a day" :labels="labels" :series="[{ name: 'Players seen', color: '#1f6f43', values: series(days, (row) => row.seen) }, { name: 'Busiest moment online', color: '#b45309', values: series(days, field('peakOnline')) }]" /><p class="adm-sub">Players seen: exact. Busiest moment: the highest of the samples (every 15 minutes), so a floor.</p></div>
      </div>

      <div class="adm-card">
        <div class="adm-row adm-between"><h3>New-player funnel</h3><div class="adm-seg" role="group" aria-label="Funnel period"><button type="button" :aria-pressed="span === 'today'" @click="span = 'today'">Today</button><button type="button" :aria-pressed="span === 'week'" @click="span = 'week'">7 days</button></div></div>
        <Funnel v-if="funnel" :title="`New players, ${span === 'today' ? 'today' : 'last 7 days'}`" :rows="funnel.steps" />
        <p v-if="funnel" class="adm-sub">Came back the next day: <b>{{ funnel.returned.rate === null ? 'too early to say' : `${funnel.returned.back} of ${funnel.returned.size} (${funnel.returned.rate}%)` }}</b>. Steps are counted by the day they happen, so they are not strictly the same people. Hover a step for what it counts.</p>
      </div>

      <div class="adm-two">
        <div class="adm-card adm-scroll"><h3>Cities</h3>
          <table class="adm-table"><thead><tr><th>City</th><th>Online</th><th>Seen today</th><th>New today</th><th>Residents</th><th>Visitors</th></tr></thead><tbody>
            <tr v-for="row in cityRows" :key="row.id"><td>{{ row.id }}</td><td>{{ row.online }}</td><td>{{ row.seen }}</td><td>{{ row.new }}</td><td>{{ row.residents ?? '-' }}</td><td>{{ row.visitors ?? '-' }}</td></tr>
            <tr v-if="!cityRows.length"><td colspan="6" class="adm-muted">Nobody yet.</td></tr></tbody></table>
          <p class="adm-sub">Online: memory, exact. Seen and new: the growth counters, exact. Residents and visitors: the economy snapshot (below), at most ten minutes old.</p></div>
        <div class="adm-card"><h3>Economy</h3>
          <template v-if="eco">
            <div class="adm-kv"><div><div class="adm-big">{{ naira(eco.cashInCirculation) }}</div><div class="adm-sub">cash in circulation · {{ eco.players }} players</div></div><div><div class="adm-big">{{ naira(eco.median) }}</div><div class="adm-sub">median balance</div></div></div>
            <div class="adm-two adm-tight"><div><h4>Faucets today</h4><p v-for="item in eco.faucets" :key="item.category" class="adm-line"><span>{{ item.category }}</span><b>+{{ naira(item.net) }}</b></p><p v-if="!eco.faucets.length" class="adm-muted">None yet.</p></div>
              <div><h4>Sinks today</h4><p v-for="item in eco.sinks" :key="item.category" class="adm-line"><span>{{ item.category }}</span><b>−{{ naira(-item.net) }}</b></p><p v-if="!eco.sinks.length" class="adm-muted">None yet.</p></div></div>
            <h4>Admin credits and bonuses (not earnings)</h4>
            <p v-for="item in eco.adminMoney" :key="item.category" class="adm-line"><span>{{ item.category }}</span><b>{{ item.net < 0 ? '−' : '+' }}{{ naira(Math.abs(item.net)) }}</b></p>
            <p class="adm-line"><span>Admin moves today (log)</span><b>+{{ naira(dash.adminMoney.creditToday) }} / −{{ naira(dash.adminMoney.debitToday) }} · grants {{ naira(dash.adminMoney.grantToday) }}</b></p>
            <h4>Richest ten</h4><ol class="adm-rank"><li v-for="one in eco.richest" :key="one.id"><button type="button" class="adm-linkbtn" @click="emit('player', one.id)">{{ one.name }}</button><b>{{ naira(one.cash) }}</b></li></ol>
            <p class="adm-sub">{{ eco.cost }} · {{ relative(eco.asOf, now) }}{{ eco.truncated ? ' · stopped at the scan limit' : '' }}</p>
            <button class="adm-btn" @click="economy(true)">Recompute now</button>
          </template>
          <p v-else class="adm-muted">Computing from the stored players…</p></div>
      </div>

      <div class="adm-two">
        <div class="adm-card"><h3>Social</h3>
          <p class="adm-line"><span>Messages today</span><b>{{ eco?.social.messagesToday ?? '-' }}</b></p>
          <p class="adm-line"><span>Groups / conversations</span><b>{{ eco ? `${eco.social.groups} / ${eco.social.conversations}` : '-' }}</b></p>
          <p class="adm-line"><span>Pings waiting</span><b>{{ eco?.social.pings ?? '-' }}</b></p>
          <p v-for="row in group('Calls today')" :key="row.label" class="adm-line"><span>{{ row.label }}</span><b>{{ row.value ?? '-' }}</b></p>
          <p class="adm-sub">Messages, groups and pings: one pass over the conversations with the economy snapshot (ten-minute cache). Calls: the host's counters for today (UTC), memory only.</p></div>
        <div class="adm-card"><h3>AI guide</h3>
          <p v-for="row in group('AI guide today')" :key="row.label" class="adm-line"><span>{{ row.label }}</span><b>{{ row.value ?? '-' }}</b></p>
          <p class="adm-sub">Model replies are counted here; answers the guide works out in the player's own browser never reach the server, so they are not counted. Cost is an estimate from the configured prices.</p>
          <button class="adm-btn" @click="testGuide">Test the AI guide</button><p v-if="guideTest" class="adm-sub" role="status">{{ guideTest }}</p></div>
      </div>

      <div class="adm-card"><h3>System</h3>
        <div class="adm-two adm-tight">
          <div>
            <p class="adm-line"><span>Device sessions held</span><b>{{ dash.capacity.sessions.held }} of {{ dash.capacity.sessions.most }}</b></p>
            <div class="adm-bar" :class="fillTone(dash.capacity.sessions.held, dash.capacity.sessions.most)"><i :style="{ width: Math.min(100, percent(dash.capacity.sessions.held, dash.capacity.sessions.most)) + '%' }" /></div>
            <p class="adm-line"><span>Sockets open</span><b>{{ dash.capacity.sockets.open }} of {{ dash.capacity.sockets.most }}</b></p>
            <div class="adm-bar" :class="fillTone(dash.capacity.sockets.open, dash.capacity.sockets.most)"><i :style="{ width: Math.min(100, percent(dash.capacity.sockets.open, dash.capacity.sockets.most)) + '%' }" /></div>
            <p class="adm-line"><span>E-mail sent today</span><b>{{ dash.mail.email.sentToday }} of {{ dash.mail.email.cap }}{{ dash.mail.email.off ? ' (off)' : '' }}</b></p>
            <p class="adm-line"><span>Push sent today</span><b>{{ dash.mail.push.sentToday }} of {{ dash.mail.push.cap }}{{ dash.mail.push.off ? ' (off)' : '' }}</b></p>
            <p class="adm-line"><span>Call relay configured</span><b>{{ extra('calls-relay-set') ?? '-' }}</b></p>
            <p class="adm-line"><span>AI guide configured</span><b>{{ extra('guide-on') ?? '-' }}</b></p>
            <p class="adm-line"><span>Rows written today</span><b>{{ dash.storage.writes ?? 'not metered on this host' }}</b></p>
          </div>
          <div><h4>Stored collections</h4>
            <p v-for="[name, size] in collections" :key="name" class="adm-line"><span>{{ name }}</span><b :class="`tone-${sizeTone(size)}`">{{ bytes(size) }}<template v-if="sizeTone(size) !== 'ok'"> ·&nbsp;{{ sizeTone(size) === 'bad' ? 'near the limit' : 'growing' }}</template></b></p>
            <p class="adm-sub">Amber from 2 MB, red from 8 MB: docs/CAPACITY.md puts the practical limit of one stored collection near 10 MB.</p></div>
        </div>
        <p class="adm-sub">Cost: the fast numbers are memory and the counters the host keeps; the walk over followed lives (up to 50,000) is repeated at most every five minutes; nothing here writes.</p>
      </div>
    </template>
  </section>
</template>
