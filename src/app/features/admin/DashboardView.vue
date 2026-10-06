<script setup lang="ts">
// The dashboard: each number with the time it was true and, in its footnote, what it cost to get and whether it is exact.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useAdmin } from './useAdmin.ts'
import { absolute, bytes, naira, relative, uptime } from './adminModel.ts'

defineEmits<{ player: [id: string] }>()
const api = useAdmin()
interface Dash {
  asOf: number; online: { value: number; cities: Record<string, number> }
  players: { newToday: number; new7d: number; activeToday: number; active7d: { exact: number; olderVisits: number }; active30d: { exact: number; olderVisits: number }; note: string }
  accounts: { accounts: number; guests: number }; capacity: { sessions: { held: number; most: number }; sockets: { open: number; most: number } }
  businesses: { open: number; total: number }; reports: { open: number; problems: { open: number } }
  mail: { email: { sentToday: number; cap: number; off: boolean }; push: { sentToday: number; cap: number; off: boolean }; byKind: Record<string, number> }
  adminMoney: { creditToday: number; debitToday: number; grantToday: number; creditTotal: number; debitTotal: number; grantTotal: number }
  storage: { collections: Record<string, number> }; build: string; uptimeMs: number; extra: { id: string; label: string; cost: string; value: number | string | null }[]
}
interface Eco { asOf: number; cashInCirculation: number; players: number; sessionsRead: number; truncated: boolean; faucets: { category: string; net: number }[]; sinks: { category: string; net: number }[]; cities: Record<string, { residents: number; visitors: number }>; cost: string }
const dash = ref<Dash | null>(null), eco = ref<Eco | null>(null), error = ref(''), busy = ref(false), tick = ref(0)
async function load(fresh = false): Promise<void> {
  busy.value = true
  const reply = await api.get<Dash>('/api/admin/dashboard', fresh ? { fresh: 1 } : {})
  busy.value = false
  if (reply.ok) { dash.value = reply.data; error.value = '' } else error.value = reply.error.reason
}
async function economy(): Promise<void> { const reply = await api.get<Eco>('/api/admin/economy', { fresh: 1 }); if (reply.ok) eco.value = reply.data; else error.value = reply.error.reason }
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void load(); timer = setInterval(() => { tick.value += 1; if (tick.value % 6 === 0) void load() }, 10000) })
onBeforeUnmount(() => clearInterval(timer))
const cities = computed(() => Object.entries(dash.value?.online.cities ?? {}).sort((a, b) => b[1] - a[1]))
const pct = (n: number, of: number): number => (of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0)
const sizes = computed(() => Object.entries(dash.value?.storage.collections ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 10))
const asOf = (at: number): string => `as of ${absolute(at)} (${relative(at, dash.value?.asOf ?? at)})`
</script>

<template>
  <section>
    <div class="adm-row"><h2 style="margin:0;flex:1">Dashboard</h2><button class="adm-btn" :disabled="busy" @click="load(true)">{{ busy ? 'Refreshing…' : 'Refresh' }}</button></div>
    <p v-if="error" class="adm-error" role="alert">{{ error }}</p>
    <p v-if="!dash && !error" class="adm-muted">Loading…</p>
    <template v-if="dash">
      <p class="adm-muted">Cached up to 45 seconds, {{ asOf(dash.asOf) }}. Build {{ dash.build }}, up {{ uptime(dash.uptimeMs) }}.</p>
      <div class="adm-grid">
        <div class="adm-card"><h3>Online now</h3><div class="adm-big">{{ dash.online.value }}</div><div class="adm-sub">exact · live sockets, memory only</div></div>
        <div class="adm-card"><h3>New players</h3><div class="adm-big">{{ dash.players.newToday }}</div><div class="adm-sub">today · {{ dash.players.new7d }} in 7 days</div></div>
        <div class="adm-card"><h3>Active today</h3><div class="adm-big">{{ dash.players.activeToday }}</div><div class="adm-sub">exact</div></div>
        <div class="adm-card"><h3>Active 7 / 30 days</h3><div class="adm-big">{{ dash.players.active7d.exact }} / {{ dash.players.active30d.exact }}</div><div class="adm-sub">lives under 31 days old; plus {{ dash.players.active7d.olderVisits }} / {{ dash.players.active30d.olderVisits }} older-life visits (upper bound)</div></div>
        <div class="adm-card"><h3>Accounts / guests</h3><div class="adm-big">{{ dash.accounts.accounts }} / {{ dash.accounts.guests }}</div><div class="adm-sub">guests approximate · key counts</div></div>
        <div class="adm-card"><h3>Sessions held</h3><div class="adm-big">{{ dash.capacity.sessions.held }}</div><div class="adm-bar"><i :style="{ width: pct(dash.capacity.sessions.held, dash.capacity.sessions.most) + '%' }" /></div><div class="adm-sub">of {{ dash.capacity.sessions.most }}</div></div>
        <div class="adm-card"><h3>Sockets open</h3><div class="adm-big">{{ dash.capacity.sockets.open }}</div><div class="adm-bar"><i :style="{ width: pct(dash.capacity.sockets.open, dash.capacity.sockets.most) + '%' }" /></div><div class="adm-sub">of {{ dash.capacity.sockets.most }}</div></div>
        <div class="adm-card"><h3>Businesses open</h3><div class="adm-big">{{ dash.businesses.open }}</div><div class="adm-sub">{{ dash.businesses.total }} ever opened</div></div>
        <div class="adm-card"><h3>Reports open</h3><div class="adm-big">{{ dash.reports.open }}</div><div class="adm-sub">{{ dash.reports.problems.open }} problem reports open</div></div>
        <div class="adm-card"><h3>Mail today</h3><div class="adm-sub">E-mail {{ dash.mail.email.sentToday }} of {{ dash.mail.email.cap }}{{ dash.mail.email.off ? ' (off)' : '' }} · Push {{ dash.mail.push.sentToday }} of {{ dash.mail.push.cap }}{{ dash.mail.push.off ? ' (off)' : '' }}</div><div class="adm-sub">{{ Object.entries(dash.mail.byKind).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no comeback mail today' }}</div></div>
        <div class="adm-card"><h3>Admin money</h3><div class="adm-sub">Today: +{{ naira(dash.adminMoney.creditToday) }} credits, −{{ naira(dash.adminMoney.debitToday) }} debits, {{ naira(dash.adminMoney.grantToday) }} grants</div><div class="adm-sub">All time: +{{ naira(dash.adminMoney.creditTotal) }} / −{{ naira(dash.adminMoney.debitTotal) }} / {{ naira(dash.adminMoney.grantTotal) }}</div></div>
        <div v-for="item in dash.extra" :key="item.id" class="adm-card"><h3>{{ item.label }}</h3><div class="adm-big">{{ item.value ?? '-' }}</div><div class="adm-sub">{{ item.cost }}</div></div>
      </div>
      <div class="adm-two" style="margin-top:12px">
        <div class="adm-card"><h3>Online by city</h3><table class="adm-table"><tbody><tr v-for="[city, n] in cities" :key="city"><td>{{ city }}</td><td>{{ n }}</td></tr></tbody></table></div>
        <div class="adm-card"><h3>Stored collections</h3><table class="adm-table"><tbody><tr v-for="[name, size] in sizes" :key="name"><td>{{ name }}</td><td>{{ bytes(size) }}</td></tr></tbody></table><div class="adm-sub">counters the store keeps</div></div>
      </div>
      <div class="adm-card" style="margin-top:12px">
        <div class="adm-row"><h3 style="flex:1;margin:0">Economy snapshot</h3><button class="adm-btn" @click="economy">{{ eco ? 'Recompute' : 'Compute now' }}</button></div>
        <p v-if="!eco" class="adm-muted">One pass over the stored sessions, so it is computed only when asked and cached for ten minutes.</p>
        <template v-else>
          <p class="adm-muted">{{ eco.cost }} · {{ asOf(eco.asOf) }}{{ eco.truncated ? ' · stopped at the scan limit' : '' }}</p>
          <div class="adm-grid"><div class="adm-card"><h3>Cash in circulation</h3><div class="adm-big">{{ naira(eco.cashInCirculation) }}</div><div class="adm-sub">{{ eco.players }} players</div></div></div>
          <div class="adm-two" style="margin-top:10px">
            <div><h3>Faucets today (net)</h3><table class="adm-table"><tbody><tr v-for="item in eco.faucets" :key="item.category"><td>{{ item.category }}</td><td>+{{ naira(item.net) }}</td></tr></tbody></table></div>
            <div><h3>Sinks today (net)</h3><table class="adm-table"><tbody><tr v-for="item in eco.sinks" :key="item.category"><td>{{ item.category }}</td><td>−{{ naira(-item.net) }}</td></tr></tbody></table></div>
          </div>
          <h3 style="margin-top:10px">Residents and visitors</h3><table class="adm-table"><thead><tr><th>City</th><th>Residents</th><th>Visitors</th></tr></thead><tbody><tr v-for="(row, city) in eco.cities" :key="city"><td>{{ city }}</td><td>{{ row.residents }}</td><td>{{ row.visitors }}</td></tr></tbody></table>
        </template>
      </div>
    </template>
  </section>
</template>
