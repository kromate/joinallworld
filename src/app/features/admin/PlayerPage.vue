<script setup lang="ts">
// One player: what the server knows (read every few seconds, so money and needs show as they change) and the actions an admin may take.
// A destructive action carries a typed word; the page then makes the two requests the server needs (token, then the action) itself.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useAdmin } from './useAdmin.ts'
import { PLAYER_ACTIONS, absolute, actionDef, bodyOf, formWhy, naira, relative } from './adminModel.ts'
import type { ActionDef } from './adminModel.ts'

const props = defineProps<{ id: string }>()
const emit = defineEmits<{ back: [] }>()
const api = useAdmin()
interface Detail {
  profile: { id: string; name: string; kind: string; city: string | null; online: boolean; flags: string[]; admin: boolean }
  account: { ref: string; email: string; provider: string; createdAt: number; devices: number; parked: number } | null
  life: { city: string | null; location: string; spot: string | null; cash: number; needs: Record<string, number>; job: string | null; homeCity: string | null; awayHomes: string[]; activeAction: string | null; cities: string[]; shops: number; earned: number; message: string } | null
  ledger: { at: number; amount: number; reason: string; balance: number }[]
  shops: { id: string; name: string; city: string; status: string }[]
  social: { friends: number; invitedBy: { id: string; name: string } | null; invited: number }
  sanctions: { ban: { until: number; reason: string } | null; pictures: { until: number; reason: string } | null; calls: { until: number; reason: string } | null; mute: { until: number; reason: string } | null }
  reports: { id: string; about: boolean; reason: string; status: string; at: number; other: string }[]
  audit: { n: number; at: number; action: string; byName: string; summary: string; reason: string }[]
  notes: { at: number; text: string }[]
  protected: boolean
}
const d = ref<Detail | null>(null), error = ref('')
async function load(): Promise<void> {
  const reply = await api.get<Detail>(`/api/admin/players/${props.id}`)
  if (reply.ok) { d.value = reply.data; error.value = '' } else error.value = reply.error.reason
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { void load(); timer = setInterval(load, 4000) })
onBeforeUnmount(() => clearInterval(timer))

const chosen = ref<ActionDef | null>(null)
const values = reactive<Record<string, string | number>>({})
const reason = ref(''), typed = ref(''), busy = ref(false)
const result = ref<{ ok: boolean; text: string } | null>(null)
function choose(def: ActionDef): void {
  chosen.value = def; reason.value = ''; typed.value = ''; result.value = null
  for (const key of Object.keys(values)) delete values[key]
  for (const field of def.fields) if (field.initial !== undefined) values[field.key] = field.initial
}
const why = computed(() => (chosen.value ? formWhy(chosen.value, values, reason.value, typed.value) : null))
async function run(): Promise<void> {
  const def = chosen.value
  if (!def || why.value) return
  busy.value = true; result.value = null
  const body = bodyOf(def, values, reason.value), path = `/api/admin/players/${props.id}/act`, intent = `${props.id}:${def.id}:${JSON.stringify(body)}`
  let reply = await api.post<Record<string, unknown>>(path, body, intent)
  if (reply.ok && reply.data.code === 'confirmation_required') reply = await api.post(path, { ...body, confirm: reply.data.token }, intent)
  busy.value = false
  if (reply.ok && reply.data.ok === true) { result.value = { ok: true, text: `${String(reply.data.summary)} · audit line #${String(reply.data.line)}${reply.data.duplicate ? ' (already applied)' : ''}` }; void load() }
  else result.value = { ok: false, text: reply.ok ? String(reply.data.code) : reply.error.reason }
}
const groups = [['money', 'Money'], ['life', 'Life'], ['sanction', 'Sanctions'], ['contact', 'Contact']] as const
const until = (s: { until: number } | null): string => (s ? (s.until ? `until ${absolute(s.until)}` : 'no end date') : '')
</script>

<template>
  <section>
    <div class="adm-row"><button class="adm-btn" @click="emit('back')">‹ Players</button></div>
    <p v-if="error" class="adm-error" role="alert">{{ error }}</p>
    <p v-else-if="!d" class="adm-muted">Loading…</p>
    <template v-else>
      <h2>{{ d.profile.name }} <span v-if="d.profile.online" class="adm-chip green">online</span> <span v-if="d.profile.admin" class="adm-chip">admin</span> <span v-for="flag in d.profile.flags" :key="flag" class="adm-chip red">{{ flag }}</span></h2>
      <p v-if="d.protected" class="adm-muted">This player is an admin: only the founder can act on them.</p>
      <div class="adm-two">
        <div class="adm-card">
          <h3>Profile</h3>
          <table class="adm-table"><tbody>
            <tr><td>Public id</td><td><code>{{ d.profile.id }}</code></td></tr>
            <tr><td>Kind</td><td>{{ d.profile.kind }}<template v-if="d.account"> · {{ d.account.provider }} · {{ d.account.email }} · {{ d.account.devices }} device(s) · account {{ d.account.ref }}</template></td></tr>
            <tr v-if="d.life"><td>City / place</td><td>{{ d.life.city }} · {{ d.life.location }}{{ d.life.spot ? ' / ' + d.life.spot : '' }}{{ d.life.activeAction ? ' · ' + d.life.activeAction : '' }}</td></tr>
            <tr v-if="d.life"><td>Homes</td><td>{{ d.life.homeCity ?? 'none' }}{{ d.life.awayHomes.length ? ' + ' + d.life.awayHomes.join(', ') : '' }}</td></tr>
            <tr v-if="d.life"><td>Job</td><td>{{ d.life.job ?? 'none' }}</td></tr>
            <tr><td>Friends / invited</td><td>{{ d.social.friends }} / {{ d.social.invited }}{{ d.social.invitedBy ? ' · invited by ' + d.social.invitedBy.name : '' }}</td></tr>
            <tr><td>Business</td><td>{{ d.shops.length ? d.shops.map((s) => `${s.name} (${s.city}, ${s.status})`).join('; ') : 'none' }}</td></tr>
            <tr v-if="d.sanctions.ban || d.sanctions.mute || d.sanctions.pictures || d.sanctions.calls"><td>Sanctions</td><td>
              <div v-if="d.sanctions.ban">Banned {{ until(d.sanctions.ban) }}: {{ d.sanctions.ban.reason }}</div><div v-if="d.sanctions.mute">Muted {{ until(d.sanctions.mute) }}: {{ d.sanctions.mute.reason }}</div>
              <div v-if="d.sanctions.pictures">Pictures off {{ until(d.sanctions.pictures) }}</div><div v-if="d.sanctions.calls">Calls off {{ until(d.sanctions.calls) }}</div></td></tr>
          </tbody></table>
        </div>
        <div v-if="d.life" class="adm-card">
          <h3>Cash and needs</h3>
          <div class="adm-big" aria-live="polite">{{ naira(d.life.cash) }}</div><div class="adm-sub">earned from work {{ naira(d.life.earned) }}</div>
          <div v-for="(value, need) in d.life.needs" :key="need" style="margin-top:6px"><span class="adm-sub">{{ need }} {{ Math.round(value) }}</span><div class="adm-bar"><i :style="{ width: value + '%' }" /></div></div>
        </div>
      </div>
      <div class="adm-card" style="margin-top:12px">
        <h3>Actions</h3>
        <div v-for="[group, label] in groups" :key="group" class="adm-row" style="align-items:center"><b style="width:90px;font-size:12px">{{ label }}</b>
          <button v-for="def in PLAYER_ACTIONS.filter((a) => a.group === group)" :key="def.id" class="adm-btn" :class="{ danger: def.danger, primary: chosen?.id === def.id }" :disabled="d.protected && false" @click="choose(def)">{{ def.label }}</button></div>
        <form v-if="chosen" :class="{ 'adm-danger-zone': chosen.danger }" style="margin-top:8px" @submit.prevent="run">
          <p class="adm-muted" style="margin-top:0">{{ chosen.help }}</p>
          <div class="adm-row">
            <label v-for="field in chosen.fields" :key="field.key" :style="field.kind === 'long' ? 'flex:1;min-width:240px' : ''">{{ field.label }}
              <select v-if="field.kind === 'select'" v-model="values[field.key]"><option v-for="[v, l] in field.options" :key="v" :value="v">{{ l }}</option></select>
              <textarea v-else-if="field.kind === 'long'" v-model="values[field.key]" maxlength="500" />
              <input v-else v-model="values[field.key]" :type="field.kind === 'number' ? 'number' : 'text'" :min="field.min" :max="field.max" :placeholder="field.placeholder"></label>
            <label v-if="chosen.reason !== 'none'" style="flex:1;min-width:200px">Reason{{ chosen.reason === 'required' ? ' (required)' : '' }}<input v-model="reason" maxlength="200"></label>
            <label v-if="chosen.typed">Type {{ chosen.typed }} to confirm<input v-model="typed" autocomplete="off"></label>
            <button class="adm-btn" :class="chosen.danger ? 'danger' : 'primary'" :disabled="busy || Boolean(why)" :title="why ?? undefined">{{ busy ? 'Working…' : chosen.label }}</button>
          </div>
          <p v-if="why" class="adm-sub">{{ why }}</p>
        </form>
        <p v-if="result" :class="result.ok ? 'adm-ok' : 'adm-error'" role="status">{{ result.text }}</p>
      </div>
      <div class="adm-two" style="margin-top:12px">
        <div class="adm-card adm-scroll"><h3>Last 50 ledger lines</h3>
          <table class="adm-table"><thead><tr><th>When</th><th>Amount</th><th>Reason</th><th>Balance</th></tr></thead><tbody>
            <tr v-for="line in d.ledger" :key="line.at + line.reason + line.balance"><td>{{ absolute(line.at) }}</td><td :style="{ color: line.amount < 0 ? '#b42318' : '#1a6b3c' }">{{ line.amount < 0 ? '−' : '+' }}{{ naira(Math.abs(line.amount)) }}</td><td>{{ line.reason }}</td><td>{{ naira(line.balance) }}</td></tr>
            <tr v-if="!d.ledger.length"><td colspan="4" class="adm-muted">No ledger lines.</td></tr></tbody></table></div>
        <div class="adm-card"><h3>Admin actions on this player</h3>
          <p v-if="!d.audit.length" class="adm-muted">None yet.</p>
          <div v-for="line in d.audit" :key="line.n" style="margin-bottom:6px"><b>{{ line.action }}</b> · {{ line.summary }}<div class="adm-sub">{{ line.byName }} · {{ relative(line.at, api.now()) }}{{ line.reason ? ' · ' + line.reason : '' }}</div></div>
          <h3 style="margin-top:12px">Reports</h3><p v-if="!d.reports.length" class="adm-muted">None.</p>
          <div v-for="report in d.reports" :key="report.id" class="adm-sub">{{ report.id }} · {{ report.about ? 'about them, by ' : 'by them, about ' }}{{ report.other }} · {{ report.reason }} · {{ report.status }}</div>
          <h3 style="margin-top:12px">Private notes</h3><p v-if="!d.notes.length" class="adm-muted">None.</p>
          <div v-for="note in d.notes" :key="note.at" class="adm-sub">{{ absolute(note.at) }} · {{ note.text }}</div></div>
      </div>
    </template>
  </section>
</template>
