<script setup lang="ts">
// One player, in tabs: Overview, Money (the ledger with a running balance), Social, Places, Sessions, Sanctions, Notes, History, and "As the player
// sees it" (a read-only summary of their HUD: never their messages, never a way to act as them). The quick actions stay pinned above the tabs.
// A destructive action carries a typed word; the page then makes the two requests the server needs (token, then the action) itself.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { admin, useAdmin } from './useAdmin.ts'
import { PLAYER_ACTIONS, absolute, bodyOf, formWhy, naira, relative } from './adminModel.ts'
import type { ActionDef } from './adminModel.ts'
import { perform } from './playerActions.ts'
import { toast, ui } from './adminUi.ts'

const props = defineProps<{ id: string; tab: string | null }>()
const emit = defineEmits<{ back: []; tab: [tab: string]; open: [id: string] }>()
const api = useAdmin()
interface Detail {
  profile: { id: string; name: string; kind: string; city: string | null; online: boolean; flags: string[]; admin: boolean }
  account: { ref: string; email: string; provider: string; createdAt: number; lastSeenAt?: number; devices: number; parked: number } | null
  life: { city: string | null; location: string; spot: string | null; cash: number; needs: Record<string, number>; job: string | null; homeCity: string | null; awayHomes: string[]; activeAction: string | null; cities: string[]; shops: number; earned: number; message: string } | null
  ledger: { at: number; amount: number; reason: string; balance: number }[]
  shops: { id: string; name: string; city: string; status: string }[]
  social: { friends: number; invitedBy: { id: string; name: string } | null; invited: number }
  sanctions: { ban: { until: number; reason: string } | null; pictures: { until: number; reason: string } | null; calls: { until: number; reason: string } | null; mute: { until: number; reason: string } | null }
  reports: { id: string; about: boolean; reason: string; status: string; at: number; other: string; otherId?: string }[]
  audit: { n: number; at: number; action: string; byName: string; summary: string; reason: string }[]
  notes: { at: number; text: string }[]
  protected: boolean
}
const TABS = [['overview', 'Overview'], ['money', 'Money'], ['social', 'Social'], ['places', 'Places'], ['sessions', 'Sessions'], ['sanctions', 'Sanctions'], ['notes', 'Notes'], ['history', 'History'], ['view', 'As the player sees it']] as const
const tab = computed(() => TABS.find((item) => item[0] === props.tab)?.[0] ?? 'overview')
const d = ref<Detail | null>(null), error = ref(''), loading = ref(true)
async function load(): Promise<void> {
  const reply = await api.get<Detail>(`/api/admin/players/${props.id}`)
  loading.value = false
  if (reply.ok) { d.value = reply.data; error.value = ''; ui.crumb = reply.data.profile.name } else error.value = reply.error.reason
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void load(); timer = setInterval(load, 5000) })
onBeforeUnmount(() => clearInterval(timer))
watch(() => props.id, () => { d.value = null; loading.value = true; chosen.value = null; void load() })

const locked = computed(() => Boolean(d.value?.protected) && admin.me?.level !== 'root')
const chosen = ref<ActionDef | null>(null)
const values = reactive<Record<string, string | number>>({})
const reason = ref(''), typed = ref(''), busy = ref(false)
const result = ref<{ ok: boolean; text: string } | null>(null)
function choose(def: ActionDef): void {
  chosen.value = def; reason.value = ''; typed.value = ''; result.value = null
  for (const key of Object.keys(values)) delete values[key]
  for (const field of def.fields) if (field.initial !== undefined) values[field.key] = field.initial
}
const quick = (id: string): void => { const def = PLAYER_ACTIONS.find((item) => item.id === id); if (def) choose(def) }
const why = computed(() => (chosen.value ? formWhy(chosen.value, values, reason.value, typed.value) : null))
async function run(): Promise<void> {
  const def = chosen.value, name = d.value?.profile.name ?? 'Player'
  if (!def || why.value || locked.value) return
  busy.value = true; result.value = null
  const out = await perform(api, props.id, name, bodyOf(def, values, reason.value))
  busy.value = false
  result.value = { ok: out.ok, text: out.text }
  if (out.ok) { chosen.value = null; void load() }
}
async function copy(text: string, what: string): Promise<void> { try { await navigator.clipboard.writeText(text); toast(`${what} copied`) } catch { toast(`Select and copy: ${text}`, 'info') } }
const groups = [['money', 'Money'], ['life', 'Life'], ['sanction', 'Sanctions'], ['contact', 'Contact']] as const
const until = (s: { until: number } | null): string => (s ? (s.until ? `until ${absolute(s.until)}` : 'no end date') : '')

// ---- money tab -----------------------------------------------------------------------------------------------------
const kind = ref<'all' | 'in' | 'out' | 'admin'>('all'), find = ref('')
const ledger = computed(() => (d.value?.ledger ?? []).filter((line) => (kind.value === 'all' || (kind.value === 'in' && line.amount > 0) || (kind.value === 'out' && line.amount < 0) || (kind.value === 'admin' && /^admin /i.test(line.reason)))
  && (!find.value || line.reason.toLowerCase().includes(find.value.toLowerCase()))))
</script>

<template>
  <section class="adm-player" aria-label="Player">
    <p v-if="error" class="adm-error" role="alert">{{ error }} <button class="adm-btn" @click="load">Try again</button> <button class="adm-btn" @click="emit('back')">Back to players</button></p>
    <div v-else-if="loading || !d" class="adm-card adm-skeleton" aria-busy="true" />
    <template v-else>
      <header class="adm-phead">
        <div>
          <h2>{{ d.profile.name }} <span v-if="d.profile.online" class="adm-chip green">online</span> <span v-if="d.profile.admin" class="adm-chip">admin</span> <span v-for="flag in d.profile.flags" :key="flag" class="adm-chip red">{{ flag }}</span></h2>
          <p class="adm-muted"><code>{{ d.profile.id }}</code> <button class="adm-linkbtn" @click="copy(d.profile.id, 'Player id')">Copy id</button> · {{ d.profile.kind }} · {{ d.profile.city ?? 'no city' }}<template v-if="d.life"> · {{ naira(d.life.cash) }}</template></p>
          <p v-if="d.protected" class="adm-muted">This player is an admin: only the founder can act on them.</p>
        </div>
        <div class="adm-quick" role="group" aria-label="Quick actions">
          <button class="adm-btn" :disabled="locked" :title="locked ? 'Only the founder can act on an admin.' : undefined" @click="quick('credit')">Credit ₦</button>
          <button class="adm-btn" :disabled="locked" @click="quick('message')">Message</button>
          <button class="adm-btn" :disabled="locked" @click="quick('mute')">Mute</button>
          <button class="adm-btn danger" :disabled="locked" @click="quick('ban')">Ban</button>
        </div>
      </header>

      <form v-if="chosen" class="adm-card adm-form" :class="{ 'adm-danger-zone': chosen.danger }" @submit.prevent="run">
        <h3>{{ chosen.label }}</h3>
        <p class="adm-muted">{{ chosen.help }}</p>
        <div class="adm-row">
          <label v-for="field in chosen.fields" :key="field.key" :class="{ 'adm-grow': field.kind === 'long' }">{{ field.label }}
            <select v-if="field.kind === 'select'" v-model="values[field.key]"><option v-for="[v, l] in field.options" :key="v" :value="v">{{ l }}</option></select>
            <textarea v-else-if="field.kind === 'long'" v-model="values[field.key]" maxlength="500" />
            <input v-else v-model="values[field.key]" :type="field.kind === 'number' ? 'number' : 'text'" :min="field.min" :max="field.max" :placeholder="field.placeholder"></label>
          <label v-if="chosen.reason !== 'none'" class="adm-grow">Reason{{ chosen.reason === 'required' ? ' (required)' : '' }}<input v-model="reason" maxlength="200"></label>
          <label v-if="chosen.typed">Type {{ chosen.typed }} to confirm<input v-model="typed" autocomplete="off"></label>
        </div>
        <div class="adm-row"><button class="adm-btn" :class="chosen.danger ? 'danger' : 'primary'" :disabled="busy || Boolean(why) || locked" :title="why ?? undefined">{{ busy ? 'Working…' : chosen.label }}</button><button type="button" class="adm-btn" @click="chosen = null">Cancel</button></div>
        <p v-if="why" class="adm-sub">{{ why }}</p>
      </form>
      <p v-if="result && !result.ok" class="adm-error" role="alert">{{ result.text }}</p>

      <div class="adm-tablist" role="tablist" aria-label="Player sections">
        <button v-for="[id, label] in TABS" :id="`adm-tab-${id}`" :key="id" type="button" role="tab" :aria-selected="tab === id" :tabindex="tab === id ? 0 : -1" @click="emit('tab', id)">{{ label }}</button>
      </div>

      <div role="tabpanel" :aria-labelledby="`adm-tab-${tab}`">
        <div v-if="tab === 'overview'" class="adm-two">
          <div class="adm-card"><h3>Profile</h3>
            <p class="adm-line"><span>Kind</span><b>{{ d.profile.kind }}</b></p>
            <p v-if="d.life" class="adm-line"><span>City / place</span><b>{{ d.life.city }} · {{ d.life.location }}{{ d.life.spot ? ' / ' + d.life.spot : '' }}</b></p>
            <p v-if="d.life" class="adm-line"><span>Job</span><b>{{ d.life.job ?? 'none' }}</b></p>
            <p class="adm-line"><span>Friends / invited</span><b>{{ d.social.friends }} / {{ d.social.invited }}</b></p>
            <p class="adm-line"><span>Stalls</span><b>{{ d.shops.length ? d.shops.map((s) => `${s.name} (${s.city}, ${s.status})`).join('; ') : 'none' }}</b></p>
            <p class="adm-line"><span>Open reports</span><b>{{ d.reports.filter((r) => r.status === 'received').length }}</b></p></div>
          <div v-if="d.life" class="adm-card"><h3>Cash and needs</h3>
            <div class="adm-big" aria-live="polite">{{ naira(d.life.cash) }}</div><div class="adm-sub">earned from work {{ naira(d.life.earned) }}</div>
            <div v-for="(value, need) in d.life.needs" :key="need" class="adm-need"><span class="adm-sub">{{ need }} {{ Math.round(value) }}</span><div class="adm-bar"><i :style="{ width: value + '%' }" /></div></div></div>
        </div>

        <div v-else-if="tab === 'money'" class="adm-card adm-scroll">
          <div class="adm-row"><label>Show<select v-model="kind"><option value="all">Everything</option><option value="in">Money in</option><option value="out">Money out</option><option value="admin">Admin moves</option></select></label>
            <label class="adm-grow">Reason contains<input v-model="find" type="search" placeholder="wage, rent, admin…"></label>
            <button class="adm-btn" :disabled="locked" @click="quick('credit')">Credit ₦</button><button class="adm-btn danger" :disabled="locked" @click="quick('debit')">Debit ₦</button></div>
          <table class="adm-table adm-sticky"><thead><tr><th>When</th><th>Amount</th><th>Reason</th><th>Balance after</th></tr></thead><tbody>
            <tr v-for="line in ledger" :key="line.at + line.reason + line.balance"><td>{{ absolute(line.at) }}</td><td :class="line.amount < 0 ? 'tone-bad' : 'tone-ok'">{{ line.amount < 0 ? '−' : '+' }}{{ naira(Math.abs(line.amount)) }}</td><td>{{ line.reason }}</td><td>{{ naira(line.balance) }}</td></tr>
            <tr v-if="!ledger.length"><td colspan="4" class="adm-empty">No ledger lines{{ kind !== 'all' || find ? ' match' : '' }}.</td></tr></tbody></table>
          <p class="adm-sub">The last 50 lines the life kept, newest first. The balance column is the running balance after each line.</p></div>

        <div v-else-if="tab === 'social'" class="adm-two">
          <div class="adm-card"><h3>Friends and invites</h3><p class="adm-line"><span>Friends</span><b>{{ d.social.friends }}</b></p><p class="adm-line"><span>Invited</span><b>{{ d.social.invited }}</b></p>
            <p class="adm-line"><span>Invited by</span><b><button v-if="d.social.invitedBy" class="adm-linkbtn" @click="emit('open', d.social.invitedBy.id)">{{ d.social.invitedBy.name }}</button><template v-else>nobody</template></b></p>
            <p class="adm-sub">Private messages are never shown here.</p></div>
          <div class="adm-card"><h3>Reports</h3><p v-if="!d.reports.length" class="adm-muted">None.</p>
            <p v-for="report in d.reports" :key="report.id" class="adm-sub">{{ report.id }} · {{ report.about ? 'about them, by ' : 'by them, about ' }}<button v-if="report.otherId" class="adm-linkbtn" @click="emit('open', report.otherId)">{{ report.other }}</button><template v-else>{{ report.other }}</template> · {{ report.reason }} · {{ report.status }} · {{ relative(report.at, api.now()) }}</p></div>
        </div>

        <div v-else-if="tab === 'places'" class="adm-two">
          <div v-if="d.life" class="adm-card"><h3>Where they are</h3><p class="adm-line"><span>City / place</span><b>{{ d.life.city }} · {{ d.life.location }}</b></p><p class="adm-line"><span>Doing</span><b>{{ d.life.activeAction ?? 'nothing' }}</b></p>
            <p class="adm-line"><span>Home city</span><b>{{ d.life.homeCity ?? 'none' }}</b></p><p class="adm-line"><span>Homes elsewhere</span><b>{{ d.life.awayHomes.join(', ') || 'none' }}</b></p><p class="adm-line"><span>Cities lived in</span><b>{{ d.life.cities.join(', ') }}</b></p></div>
          <div class="adm-card"><h3>Business</h3><p v-if="!d.shops.length" class="adm-muted">No stalls.</p><p v-for="shop in d.shops" :key="shop.id" class="adm-line"><span>{{ shop.name }}</span><b>{{ shop.city }} · {{ shop.status }}</b></p></div>
        </div>

        <div v-else-if="tab === 'sessions'" class="adm-two">
          <div class="adm-card"><h3>Account and devices</h3>
            <template v-if="d.account"><p class="adm-line"><span>Account</span><b>{{ d.account.ref }}</b></p><p class="adm-line"><span>Address</span><b>{{ d.account.email }}</b></p><p class="adm-line"><span>Provider</span><b>{{ d.account.provider }}</b></p>
              <p class="adm-line"><span>Signed-in devices</span><b>{{ d.account.devices }}</b></p><p class="adm-line"><span>Characters set aside</span><b>{{ d.account.parked }}</b></p>
              <p class="adm-line"><span>Account made</span><b>{{ absolute(d.account.createdAt) }}</b></p><p v-if="d.account.lastSeenAt" class="adm-line"><span>Account last used</span><b>{{ absolute(d.account.lastSeenAt) }}</b></p></template>
            <p v-else class="adm-muted">A guest: one device, no account.</p>
            <button class="adm-btn danger" :disabled="locked" @click="quick('signout')">Sign out everywhere…</button></div>
        </div>

        <div v-else-if="tab === 'sanctions'" class="adm-card"><h3>Now</h3>
          <p v-if="!(d.sanctions.ban || d.sanctions.mute || d.sanctions.pictures || d.sanctions.calls)" class="adm-muted">No sanctions in force.</p>
          <p v-if="d.sanctions.ban" class="adm-line"><span>Banned {{ until(d.sanctions.ban) }}</span><b>{{ d.sanctions.ban.reason }}</b></p><p v-if="d.sanctions.mute" class="adm-line"><span>Muted {{ until(d.sanctions.mute) }}</span><b>{{ d.sanctions.mute.reason }}</b></p>
          <p v-if="d.sanctions.pictures" class="adm-line"><span>Pictures off {{ until(d.sanctions.pictures) }}</span><b>{{ d.sanctions.pictures.reason }}</b></p><p v-if="d.sanctions.calls" class="adm-line"><span>Calls off {{ until(d.sanctions.calls) }}</span><b>{{ d.sanctions.calls.reason }}</b></p>
          <div v-for="[group, label] in groups.filter((g) => g[0] === 'sanction')" :key="group" class="adm-row"><span class="adm-grouplabel">{{ label }}</span>
            <button v-for="def in PLAYER_ACTIONS.filter((a) => a.group === group)" :key="def.id" class="adm-btn" :class="{ danger: def.danger }" :disabled="locked" @click="choose(def)">{{ def.label }}</button></div></div>

        <div v-else-if="tab === 'notes'" class="adm-card"><h3>Private notes</h3><p class="adm-sub">Only admins see these.</p>
          <p v-if="!d.notes.length" class="adm-muted">None yet.</p><p v-for="note in d.notes" :key="note.at" class="adm-sub">{{ absolute(note.at) }} · {{ note.text }}</p>
          <button class="adm-btn" :disabled="locked" @click="quick('note')">Add a note</button></div>

        <div v-else-if="tab === 'history'" class="adm-card"><h3>What admins did to this player</h3>
          <p v-if="!d.audit.length" class="adm-muted">Nothing yet.</p>
          <div v-for="line in d.audit" :key="line.n" class="adm-hist"><b>{{ line.action }}</b> · {{ line.summary }}<div class="adm-sub">#{{ line.n }} · {{ line.byName }} · {{ relative(line.at, api.now()) }}{{ line.reason ? ' · ' + line.reason : '' }}</div></div></div>

        <div v-else class="adm-card"><h3>As the player sees it</h3><p class="adm-sub">What their top bar and needs show right now. Read only: this is not a way to play as them, and it never shows their messages.</p>
          <template v-if="d.life"><p class="adm-line"><span>Name</span><b>{{ d.profile.name }}</b></p><p class="adm-line"><span>Cash</span><b>{{ naira(d.life.cash) }}</b></p><p class="adm-line"><span>Place</span><b>{{ d.life.city }} · {{ d.life.location }}</b></p>
            <p class="adm-line"><span>Doing</span><b>{{ d.life.activeAction ?? 'nothing' }}</b></p><p class="adm-line"><span>Job</span><b>{{ d.life.job ?? 'none' }}</b></p>
            <div v-for="(value, need) in d.life.needs" :key="need" class="adm-need"><span class="adm-sub">{{ need }} {{ Math.round(value) }}</span><div class="adm-bar" :class="value < 25 ? 'bad' : value < 50 ? 'warn' : 'ok'"><i :style="{ width: value + '%' }" /></div></div>
            <p v-if="d.life.message" class="adm-sub">Their last notice: {{ d.life.message }}</p></template>
          <p v-else class="adm-muted">No life is played yet.</p></div>
      </div>
    </template>
  </section>
</template>
