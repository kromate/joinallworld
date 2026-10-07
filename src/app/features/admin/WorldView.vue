<script setup lang="ts">
// World tools: a small grant to everyone online or in a city, runtime settings, and the "update is coming" notice. A time-boxed event flag is
// not offered: the rules engine has no such notion yet.
import { onMounted, reactive, ref } from 'vue'
import { admin, useAdmin } from './useAdmin.ts'
import { naira } from './adminModel.ts'
import { recordDone } from './adminUi.ts'

const api = useAdmin()
const grant = reactive({ audience: 'online', city: 'lagos', amount: 500, reason: 'launch bonus', unrestricted: false })
const preview = ref<{ count: number; total: number; leftToday: number; needsConfirmation: boolean } | null>(null), typed = ref('')
const out = ref<{ ok: boolean; text: string } | null>(null), busy = ref(false)
const body = (): Record<string, unknown> => ({ audience: grant.audience, ...(grant.audience === 'city' ? { city: grant.city } : {}), amount: Number(grant.amount), reason: grant.reason, ...(grant.unrestricted ? { unrestricted: true } : {}) })
async function look(): Promise<void> {
  const r = await api.post<{ count: number; total: number; leftToday: number; needsConfirmation: boolean }>('/api/admin/world/grant', { ...body(), preview: true }, 'grant-preview')
  if (r.ok) { preview.value = r.data; out.value = null } else out.value = { ok: false, text: r.error.reason }
}
async function give(): Promise<void> {
  busy.value = true
  const intent = `grant:${JSON.stringify(body())}`
  let r = await api.post<Record<string, unknown>>('/api/admin/world/grant', body(), intent)
  if (r.ok && r.data.code === 'confirmation_required') r = await api.post('/api/admin/world/grant', { ...body(), confirm: r.data.token }, intent)
  busy.value = false
  out.value = r.ok ? { ok: r.data.ok === true, text: r.data.ok === true ? String(r.data.summary) : String(r.data.code) } : { ok: false, text: r.error.reason }
  recordDone(out.value.text, out.value.ok)
  preview.value = null; typed.value = ''
}
interface Setting { key: string; label: string; help: string; kind: 'boolean' | 'number'; confirmOn?: boolean; min: number | null; max: number | null; default: boolean | number; value: boolean | number; changed: { at: number } | null }
const settings = ref<Setting[]>([]), switches = ref({ email: false, push: false }), drafts = reactive<Record<string, string>>({}), note = ref('')
async function loadSettings(): Promise<void> { const r = await api.get<{ settings: Setting[]; switches: { email: boolean; push: boolean } }>('/api/admin/settings'); if (r.ok) { settings.value = r.data.settings; switches.value = r.data.switches } }
onMounted(loadSettings)
const asking = ref<{ key: string; label: string; token: string } | null>(null), word = ref('')
async function set(key: string, value: boolean | number | null, confirm?: string): Promise<void> {
  const r = await api.post<Record<string, unknown>>('/api/admin/settings', { key, value, ...(confirm ? { confirm } : {}) }, `setting:${key}:${String(value)}`)
  if (r.ok && r.data.code === 'confirmation_required') { asking.value = { key, label: String(r.data.summary), token: String(r.data.token) }; word.value = ''; return }
  asking.value = null
  note.value = r.ok ? 'Saved.' : r.error.reason; recordDone(r.ok ? `Setting ${key} saved` : r.error.reason, r.ok); void loadSettings()
}
// Government: what is held, who is jailed and who serves, and the three things an operator can undo. Every action needs a reason, which the public record shows.
interface GovSeat { scope: string; tier: string; title: string; name: string; holder: { id: string; name: string; votes: number; termEndsAt: number } | null; treasury: number; officers: number; judges: number; petition: { signed: number; needed: number } | null; flags: string[] }
interface Official { id: string; name: string; scope: string; tier: string; by: string }
interface GovView { seats: GovSeat[]; jailed: { id: string; name: string; until: number; minutes: number; by: string; tier: string }[]; police: Official[]; judges: Official[]; openOffences: number; records: { count: number; head: string } }
const gov = ref<GovView | null>(null), govReason = ref(''), govTyped = ref(''), govNote = ref<{ ok: boolean; text: string } | null>(null)
async function loadGov(): Promise<void> { const r = await api.get<GovView>('/api/admin/politics'); if (r.ok) gov.value = r.data }
async function undo(body: Record<string, unknown>): Promise<void> {
  const r = await api.post<Record<string, unknown>>('/api/admin/politics/act', { ...body, reason: govReason.value, typed: govTyped.value }, `politics:${JSON.stringify(body)}:${govReason.value}`)
  const ok = r.ok && r.data.ok === true
  govNote.value = { ok, text: r.ok ? (ok ? String(r.data.summary) : String(r.data.reason ?? r.data.code)) : r.error.reason }
  recordDone(govNote.value.text, ok)
  if (ok) { govReason.value = ''; govTyped.value = ''; await loadGov() }
}
onMounted(loadGov)
const minutes = ref(5)
async function notice(m: number): Promise<void> { const r = await api.post('/api/admin/notice', { minutes: m }, `notice:${m}:${Date.now()}`); note.value = r.ok ? (m ? `The notice is showing for ${m} minutes.` : 'The notice ended.') : r.error.reason; recordDone(note.value, r.ok) }
</script>

<template>
  <section>
    <div class="adm-two">
      <div class="adm-card">
        <h3>Grant to many players</h3>
        <div class="adm-row">
          <label>Who<select v-model="grant.audience"><option value="online">Everyone online</option><option value="city">Everyone in a city</option></select></label>
          <label v-if="grant.audience === 'city'">City<select v-model="grant.city"><option v-for="id in admin.me?.cities ?? []" :key="id" :value="id">{{ id }}</option></select></label>
          <label>₦ each (most {{ naira(admin.me?.limits.grantEach) }})<input v-model.number="grant.amount" type="number" min="1" :max="admin.me?.limits.grantEach"></label>
          <label style="flex:1">Reason<input v-model="grant.reason" maxlength="60"></label>
          <label><input v-model="grant.unrestricted" type="checkbox"> unrestricted (can be gifted freely; default: restricted, because a grant reaches many players)</label>
        </div>
        <button class="adm-btn" @click="look">Count who would get it</button>
        <p v-if="preview" class="adm-sub">{{ preview.count }} players · {{ naira(preview.total) }} in all · {{ naira(preview.leftToday) }} left of today’s grant allowance.</p>
        <label v-if="preview?.needsConfirmation" style="margin-top:8px">Type {{ preview.count }} to confirm<input v-model="typed" inputmode="numeric"></label>
        <p><button class="adm-btn danger" :disabled="busy || !preview || !preview.count || (preview.needsConfirmation && Number(typed) !== preview.count)" @click="give">Give {{ naira(grant.amount) }} each</button></p>
        <p v-if="out" :class="out.ok ? 'adm-ok' : 'adm-error'" role="status">{{ out.text }}</p>
      </div>
      <div class="adm-card">
        <h3>"Update is coming" notice</h3>
        <div class="adm-row"><label>Minutes<input v-model.number="minutes" type="number" min="1" max="15"></label><button class="adm-btn primary" @click="notice(minutes)">Show notice</button><button class="adm-btn" @click="notice(0)">End notice</button></div>
        <p class="adm-sub">The same banner the release announcer starts, shown to everyone connected.</p>
        <h3 style="margin-top:14px">Event flags</h3><p class="adm-muted">Not available yet: the rules engine has no time-boxed event setting (for example double wages).</p>
      </div>
    </div>
    <div class="adm-card" style="margin-top:12px">
      <h3>Government</h3>
      <p class="adm-sub">What an operator does here is written to the audit log and to the public record, with the reason below. Give a reason of at least 10 characters; to remove an officeholder, type their name too.</p>
      <div class="adm-row"><label style="flex:1">Reason (public)<input v-model="govReason" maxlength="160"></label><label>Officeholder’s name (to remove)<input v-model="govTyped" autocomplete="off"></label></div>
      <p v-if="govNote" :class="govNote.ok ? 'adm-ok' : 'adm-error'" role="status">{{ govNote.text }}</p>
      <template v-if="gov">
        <p class="adm-sub">{{ gov.records.count }} public record entries · {{ gov.openOffences }} open offences · {{ gov.jailed.length }} in jail</p>
        <table class="adm-table"><thead><tr><th>Seat</th><th>Holder</th><th>Treasury</th><th>Officers / judges</th><th>Petition</th><th></th></tr></thead><tbody>
          <tr v-for="seat in gov.seats" :key="seat.scope"><td><b>{{ seat.title }}</b> of {{ seat.name }}</td><td>{{ seat.holder ? `${seat.holder.name} (${seat.holder.votes} votes)` : 'empty' }}</td><td>{{ naira(seat.treasury) }}</td><td>{{ seat.officers }} / {{ seat.judges }}</td>
            <td>{{ seat.petition ? `${seat.petition.signed} of ${seat.petition.needed}` : '' }}<template v-if="seat.flags.length"> · audit: {{ seat.flags.join(', ') }}</template></td>
            <td><button v-if="seat.holder" class="adm-btn danger" @click="undo({ action: 'remove-officeholder', scope: seat.scope })">Remove</button></td></tr>
        </tbody></table>
        <h3 style="margin-top:14px">In jail</h3>
        <p v-if="!gov.jailed.length" class="adm-muted">Nobody.</p>
        <table v-else class="adm-table"><tbody><tr v-for="item in gov.jailed" :key="item.id"><td><b>{{ item.name }}</b></td><td>{{ item.minutes }} minutes, arrested by {{ item.by }}</td><td><button class="adm-btn" @click="undo({ action: 'release', player: item.id })">Release</button></td></tr></tbody></table>
        <h3 style="margin-top:14px">Officers and judges</h3>
        <p v-if="!gov.police.length && !gov.judges.length" class="adm-muted">None enrolled.</p>
        <table v-else class="adm-table"><tbody>
          <tr v-for="item in gov.police" :key="`p${item.id}`"><td><b>{{ item.name }}</b></td><td>police · {{ item.scope }} · enrolled by {{ item.by }}</td><td><button class="adm-btn" @click="undo({ action: 'dismiss', role: 'police', player: item.id })">Dismiss</button></td></tr>
          <tr v-for="item in gov.judges" :key="`j${item.id}`"><td><b>{{ item.name }}</b></td><td>judge · {{ item.scope }} · enrolled by {{ item.by }}</td><td><button class="adm-btn" @click="undo({ action: 'dismiss', role: 'judge', player: item.id })">Dismiss</button></td></tr>
        </tbody></table>
      </template>
    </div>
    <div class="adm-card" style="margin-top:12px">
      <h3>Settings</h3>
      <p v-if="note" class="adm-ok" role="status">{{ note }}</p>
      <div v-if="asking" class="adm-card" role="alertdialog" aria-label="Confirm"><p><b>{{ asking.label }}</b></p><label>Type ON to confirm<input v-model="word" autocomplete="off"></label>
        <p><button class="adm-btn danger" :disabled="word.trim().toUpperCase() !== 'ON'" @click="set(asking.key, true, asking.token)">Turn on</button> <button class="adm-btn" @click="asking = null">Cancel</button></p></div>
      <table class="adm-table"><tbody>
        <tr v-for="s in settings" :key="s.key"><td><b>{{ s.label }}</b><div class="adm-sub">{{ s.help }}</div></td>
          <td v-if="s.kind === 'boolean'"><button class="adm-btn" :class="{ primary: s.value }" @click="set(s.key, !s.value)">{{ s.value ? 'On' : 'Off' }}</button></td>
          <td v-else><input v-model="drafts[s.key]" type="number" :min="s.min ?? undefined" :max="s.max ?? undefined" :placeholder="String(s.value)" style="width:110px"> <button class="adm-btn" @click="set(s.key, Number(drafts[s.key]))">Set</button></td>
          <td class="adm-sub">default {{ String(s.default) }}<template v-if="s.changed"> · <a href="#" @click.prevent="set(s.key, null)">reset</a></template></td></tr>
        <tr><td><b>E-mail sending</b><div class="adm-sub">The operator kill switch for all e-mail.</div></td><td><button class="adm-btn" :class="{ danger: switches.email }" @click="set('emailOff', !switches.email)">{{ switches.email ? 'Off' : 'On' }}</button></td><td /></tr>
        <tr><td><b>Push sending</b><div class="adm-sub">The operator kill switch for all push.</div></td><td><button class="adm-btn" :class="{ danger: switches.push }" @click="set('pushOff', !switches.push)">{{ switches.push ? 'Off' : 'On' }}</button></td><td /></tr>
      </tbody></table>
    </div>
  </section>
</template>
