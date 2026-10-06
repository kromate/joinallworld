<script setup lang="ts">
// Compose an announcement, see who it would reach by e-mail or push before sending, and see past ones with their reach.
import { computed, onMounted, reactive, ref } from 'vue'
import { admin, useAdmin } from './useAdmin.ts'
import { absolute, relative } from './adminModel.ts'
import { TEMPLATES, timeline } from './announceModel.ts'
import { recordDone } from './adminUi.ts'

const api = useAdmin()
interface Row { id: string; title: string; body: string; audience: string; city: string | null; at: number; sentAt: number; expiresAt: number; status: string; reach: { sockets: number }; mail: { wanted: boolean; state: string; total: number; sent: number; failed: number } }
const rows = ref<Row[]>([]), error = ref(''), busy = ref(false), result = ref<{ ok: boolean; text: string } | null>(null)
const form = reactive({ title: '', body: '', audience: 'everyone', city: 'lagos', action: '', when: '', hours: 168, push: false, email: false })
const counts = ref<{ email: number; push: number; confirmAbove: number } | null>(null), typed = ref('')
async function load(): Promise<void> { const r = await api.get<{ announcements: Row[] }>('/api/admin/announcements'); if (r.ok) rows.value = r.data.announcements; else error.value = r.error.reason }
onMounted(load)
const bodyOf = (): Record<string, unknown> => {
  const at = form.when ? new Date(form.when).getTime() : undefined
  return { title: form.title, body: form.body, audience: form.audience, ...(form.audience === 'city' ? { city: form.city } : {}), action: form.action || null, push: form.push, email: form.email,
    ...(at ? { at, expiresAt: at + form.hours * 3600000 } : { expiresAt: api.now() + form.hours * 3600000 }) }
}
async function preview(): Promise<void> {
  const r = await api.post<{ email: number; push: number; confirmAbove: number }>('/api/admin/announcements', { ...bodyOf(), preview: true }, 'announce-preview')
  if (r.ok) counts.value = r.data; else error.value = r.error.reason
}
const total = (): number => (counts.value ? (form.email ? counts.value.email : 0) + (form.push ? counts.value.push : 0) : 0)
const needsTyped = (): boolean => (form.email || form.push) && total() > (counts.value?.confirmAbove ?? 0)
async function send(): Promise<void> {
  busy.value = true; result.value = null
  if ((form.email || form.push) && !counts.value) await preview()
  const r = await api.post<{ code: string; recipients: number }>('/api/admin/announcements', { ...bodyOf(), ...(needsTyped() ? { confirmCount: Number(typed.value) } : {}) }, `announce:${form.title}:${form.body}`)
  busy.value = false
  if (r.ok) { result.value = { ok: true, text: r.data.code === 'sent' ? 'Sent.' : 'Scheduled.' }; recordDone(`Announcement “${form.title}” ${r.data.code === 'sent' ? 'sent' : 'scheduled'}`, true); form.title = ''; form.body = ''; counts.value = null; typed.value = ''; void load() }
  else result.value = { ok: false, text: r.error.reason }
}
async function cancel(id: string): Promise<void> { const r = await api.post(`/api/admin/announcements/${id}/cancel`, {}, `cancel:${id}`); if (!r.ok) error.value = r.error.reason; recordDone(r.ok ? 'Announcement ended' : r.error.reason, r.ok); void load() }
function useTemplate(id: string): void { const t = TEMPLATES.find((item) => item.id === id); if (t) Object.assign(form, { title: t.title, body: t.body, action: t.action, hours: t.hours }) }
const ACTION_LABEL: Record<string, string> = { map: 'Open the Map', missions: 'See Missions', business: 'Open Business', invite: 'Invite a friend' }
const upcoming = computed(() => timeline(rows.value, Date.now()))
const failed = computed(() => (!form.title.trim() ? 'Write a title.' : !form.body.trim() ? 'Write the text.' : needsTyped() && Number(typed.value) !== total() ? `Type ${total()} to confirm.` : null))
</script>

<template>
  <section>
    <div class="adm-chips" role="group" aria-label="Start from a template"><span class="adm-muted">Start from:</span><button v-for="item in TEMPLATES" :key="item.id" type="button" @click="useTemplate(item.id)">{{ item.label }}</button></div>
    <div class="adm-two">
      <form class="adm-card" @submit.prevent="send">
        <h3>Compose</h3>
        <label>Title ({{ form.title.length }}/60)<input v-model="form.title" maxlength="60" required></label>
        <label style="margin-top:8px">Text ({{ form.body.length }}/240)<textarea v-model="form.body" maxlength="240" required /></label>
        <div class="adm-row" style="margin-top:8px">
          <label>Audience<select v-model="form.audience"><option value="everyone">Everyone</option><option value="city">One city</option><option value="online">Online now only</option></select></label>
          <label v-if="form.audience === 'city'">City<select v-model="form.city"><option v-for="id in admin.me?.cities ?? []" :key="id" :value="id">{{ id }}</option></select></label>
          <label>Button<select v-model="form.action"><option value="">None</option><option value="map">Open the Map</option><option value="missions">See Missions</option><option value="business">Open Business</option><option value="invite">Invite a friend</option></select></label>
        </div>
        <div class="adm-row"><label>Send at (empty = now)<input v-model="form.when" type="datetime-local"></label><label>Show for (hours)<input v-model.number="form.hours" type="number" min="1" max="720"></label></div>
        <div class="adm-row"><label style="display:flex;gap:6px;align-items:center"><input v-model="form.push" type="checkbox" style="min-height:0"> Also push</label><label style="display:flex;gap:6px;align-items:center"><input v-model="form.email" type="checkbox" style="min-height:0"> Also e-mail</label>
          <button v-if="form.push || form.email" type="button" class="adm-btn" @click="preview">Count recipients</button></div>
        <p v-if="counts && (form.push || form.email)" class="adm-sub">Would reach {{ counts.email }} by e-mail and {{ counts.push }} by push (those who opted in, under the daily caps and quiet hours).</p>
        <label v-if="counts && needsTyped()">Type {{ total() }} to confirm<input v-model="typed" inputmode="numeric"></label>
        <p class="adm-sub">The in-game banner and Messages → Updates entry reach everyone; text goes through the same filter as chat, with no links.</p>
        <button class="adm-btn primary" :disabled="busy || Boolean(failed)" :title="failed ?? undefined">{{ form.when ? 'Schedule' : 'Send now' }}</button>
        <p v-if="failed" class="adm-sub">{{ failed }}</p>
        <p v-if="result" :class="result.ok ? 'adm-ok' : 'adm-error'" role="status">{{ result.text }}</p>
      </form>
      <div class="adm-col">
      <div class="adm-card"><h3>Preview</h3>
        <div class="adm-previews">
          <div class="adm-phone" aria-label="On a phone"><small>Phone</small><div class="adm-banner"><b>{{ form.title || 'Your title' }}</b><span>{{ form.body || 'Your text appears here.' }}</span><button v-if="form.action" type="button" tabindex="-1">{{ ACTION_LABEL[form.action] }}</button></div></div>
          <div class="adm-desk" aria-label="On a computer"><small>Computer</small><div class="adm-banner"><b>{{ form.title || 'Your title' }}</b><span>{{ form.body || 'Your text appears here.' }}</span><button v-if="form.action" type="button" tabindex="-1">{{ ACTION_LABEL[form.action] }}</button></div></div>
        </div>
        <p class="adm-sub">In Messages, under Updates, it reads: <i>{{ form.title || 'Your title' }}: {{ form.body || 'your text' }}</i></p></div>
      <div class="adm-card"><h3>Timeline</h3><p v-if="!upcoming.length" class="adm-muted">Nothing yet.</p>
        <ol class="adm-timeline"><li v-for="slot in upcoming" :key="slot.id" :class="slot.phase"><span class="adm-chip" :class="slot.phase === 'showing' ? 'green' : ''">{{ slot.phase }}</span> <b>{{ slot.title }}</b><small>{{ slot.phase === 'upcoming' ? 'goes out ' : slot.phase === 'showing' ? 'since ' : 'was ' }}{{ absolute(slot.at) }} · {{ relative(slot.at, api.now()) }}</small></li></ol></div>
      <div class="adm-card adm-scroll">
        <h3>Past announcements</h3>
        <p v-if="error" class="adm-error" role="alert">{{ error }}</p>
        <table class="adm-table"><thead><tr><th>Announcement</th><th>Status</th><th>Reach</th><th /></tr></thead><tbody>
          <tr v-for="row in rows" :key="row.id"><td><b>{{ row.title }}</b><div class="adm-sub">{{ row.body }}</div><div class="adm-sub">{{ row.audience === 'city' ? row.city : row.audience }} · {{ row.sentAt ? 'sent ' + relative(row.sentAt, api.now()) : 'at ' + absolute(row.at) }}</div></td>
            <td><span class="adm-chip" :class="row.status === 'running' ? 'green' : ''">{{ row.status }}</span></td>
            <td>{{ row.reach.sockets }} online<div v-if="row.mail.wanted" class="adm-sub">mail {{ row.mail.sent }}/{{ row.mail.total }} ({{ row.mail.state }})</div></td>
            <td><button v-if="row.status === 'running' || row.status === 'scheduled'" class="adm-btn" @click="cancel(row.id)">End</button></td></tr>
          <tr v-if="!rows.length"><td colspan="4" class="adm-muted">Nothing yet.</td></tr></tbody></table>
      </div>
      </div>
    </div>
  </section>
</template>
