<script setup lang="ts">
// One queue across player reports, reported shops and reported pictures: counts, how long each has waited, the player's earlier history beside
// it, canned warnings and keyboard triage (j / k to move, d to dismiss, w to warn, m to mute). Live city content that can be removed is below.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { admin, useAdmin } from './useAdmin.ts'
import { absolute, relative } from './adminModel.ts'
import { recordDone } from './adminUi.ts'
import { CANNED, age, counts, queue, step } from './moderationModel.ts'
import type { Item, Kind, PictureRow, Reports, ShopRow } from './moderationModel.ts'

const emit = defineEmits<{ player: [id: string] }>()
const api = useAdmin()
interface Report extends Reports { voice?: string; evidence: string[]; note?: string }
const reports = ref<Report[]>([]), shops = ref<ShopRow[]>([]), pictures = ref<PictureRow[]>([]), error = ref(''), loaded = ref(false)
const filter = ref<Kind | 'all'>('all'), chosen = ref<string | null>(null), canned = ref(CANNED[0]!.id), note = ref(''), minutes = ref(60), viewing = ref(false), busy = ref(false)
async function load(): Promise<void> {
  const [r, s, p] = await Promise.all([api.get<{ reports: Report[] }>('/api/admin/moderation/reports', { status: 'open' }), api.get<{ reports: ShopRow[] }>('/api/admin/moderation/shops'), api.get<{ pictures: PictureRow[] }>('/api/admin/moderation/pictures')])
  loaded.value = true
  if (r.ok) { reports.value = r.data.reports; error.value = '' } else error.value = r.error.reason
  if (s.ok) shops.value = s.data.reports
  if (p.ok) pictures.value = p.data.pictures
}
async function voiceAction(action: 'remove' | 'restore'): Promise<void> {
  const id = report.value?.voice
  if (!id || busy.value) return
  busy.value = true
  try { const result = await api.post(`/api/admin/moderation/voice/${encodeURIComponent(id)}/act`, { action }, 'voice-moderation'); if (!result.ok) error.value = result.error.reason; else await load() } finally { busy.value = false }
}
const all = computed(() => queue(reports.value, shops.value, pictures.value, Date.now()))
const tally = computed(() => counts(all.value))
const items = computed(() => (filter.value === 'all' ? all.value : all.value.filter((item) => item.kind === filter.value)))
const item = computed<Item | null>(() => items.value.find((entry) => entry.key === chosen.value) ?? null)
const report = computed(() => (item.value?.kind === 'report' ? reports.value.find((entry) => entry.id === item.value?.id) ?? null : null))
watch(items, (list) => { if (!list.some((entry) => entry.key === chosen.value)) chosen.value = list[0]?.key ?? null })

// The player's earlier history, read when an item is chosen.
const history = reactive<{ for: string; reports: number; actions: { n: number; action: string; summary: string; at: number }[]; flags: string[]; name: string } | { for: '' }>({ for: '' })
watch(item, async (now) => {
  viewing.value = false; note.value = ''
  const id = now?.player?.id
  if (!id) { history.for = ''; return }
  const reply = await api.get<{ profile: { name: string; flags: string[] }; reports: { about: boolean }[]; audit: { n: number; action: string; summary: string; at: number }[] }>(`/api/admin/players/${id}`)
  if (item.value?.player?.id !== id) return
  Object.assign(history, reply.ok ? { for: id, name: reply.data.profile.name, reports: reply.data.reports.filter((entry) => entry.about).length, actions: reply.data.audit.slice(0, 5), flags: reply.data.profile.flags } : { for: '' })
}, { immediate: true })
const prior = computed(() => (history.for && item.value?.player?.id === history.for ? history as Exclude<typeof history, { for: '' }> : null))

async function actReport(action: 'dismiss' | 'warn' | 'mute'): Promise<void> {
  const target = report.value
  if (!target || busy.value) return
  const text = action === 'warn' ? (note.value.trim() || CANNED.find((entry) => entry.id === canned.value)?.text || '') : note.value
  busy.value = true
  const r = await api.post<{ summary?: string }>(`/api/admin/moderation/reports/${target.id}/act`, { action, note: text, minutes: minutes.value }, `report:${target.id}:${action}`)
  busy.value = false
  recordDone(r.ok ? `Report ${target.id} ${action === 'dismiss' ? 'dismissed' : action === 'warn' ? 'answered with a warning' : 'answered with a mute'}` : `Report ${target.id}: ${r.error.reason}`, r.ok)
  if (r.ok) void load()
}
async function shop(row: ShopRow, action: 'rename' | 'close'): Promise<void> {
  busy.value = true
  const r = await api.post('/api/admin/moderation/shops/act', { shop: row.shop, action, reason: note.value }, `shop:${row.shop}:${action}`)
  busy.value = false
  recordDone(r.ok ? `Shop ${action === 'rename' ? 'renamed' : 'closed'}` : r.error.reason, r.ok); if (r.ok) void load()
}
async function picture(row: PictureRow, action: 'remove' | 'restore'): Promise<void> {
  busy.value = true
  const r = await api.post(`/api/admin/moderation/pictures/${row.id}/act`, { action }, `picture:${row.id}:${action}`)
  busy.value = false
  recordDone(r.ok ? (action === 'remove' ? 'Picture removed' : 'Picture restored') : r.error.reason, r.ok); if (r.ok) void load()
}
async function pictureSending(row: PictureRow, allowed: boolean): Promise<void> {
  if (!row.from) return
  const r = await api.post('/api/admin/moderation/pictures/player', { player: row.from, allowed }, `picture-player:${row.from}:${allowed}`)
  recordDone(r.ok ? (allowed ? 'Their pictures are allowed again' : 'Their pictures are stopped') : r.error.reason, r.ok)
}
const picked = computed(() => (item.value?.kind === 'shop' ? shops.value.find((row) => row.shop === item.value?.id) ?? null : item.value?.kind === 'picture' ? pictures.value.find((row) => row.id === item.value?.id) ?? null : null))

function keys(event: KeyboardEvent): void {
  const t = event.target as HTMLElement | null
  if (event.ctrlKey || event.metaKey || event.altKey || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'))) return
  if (event.key === 'j') chosen.value = step(items.value, chosen.value, 1)
  else if (event.key === 'k') chosen.value = step(items.value, chosen.value, -1)
  else if (report.value && event.key === 'd') void actReport('dismiss')
  else if (report.value && event.key === 'w') void actReport('warn')
  else if (report.value && event.key === 'm') void actReport('mute')
  else return
  event.preventDefault()
}
onMounted(() => { void load(); void loadContent(); window.addEventListener('keydown', keys) })
onBeforeUnmount(() => window.removeEventListener('keydown', keys))

// ---- live city content ---------------------------------------------------------------------------------------------
const city = ref('lagos'), content = ref<{ ads: { text: string; kind?: string; slot?: string; by: { name: string } }[]; radio: { id: string; title: string; venue?: string; by: { name: string } }[]; announcements: { id: string; text: string; by: { name: string } }[] } | null>(null)
async function loadContent(): Promise<void> { const r = await api.get<NonNullable<typeof content.value>>('/api/admin/moderation/content', { city: city.value }); if (r.ok) content.value = r.data; else error.value = r.error.reason }
async function remove(body: Record<string, unknown>): Promise<void> { const r = await api.post('/api/admin/moderation/content/remove', { cityId: city.value, ...body }, `content:${JSON.stringify(body)}`); recordDone(r.ok ? 'Content removed' : r.error.reason, r.ok); void loadContent() }
const KINDS = [['all', 'All'], ['report', 'Reports'], ['shop', 'Shops'], ['picture', 'Pictures']] as const
</script>

<template>
  <section aria-label="Moderation queue">
    <p v-if="error" class="adm-error" role="alert">{{ error }} <button class="adm-btn" @click="load">Try again</button></p>
    <div class="adm-chips" role="group" aria-label="Queue filter"><button v-for="[id, label] in KINDS" :key="id" type="button" :aria-pressed="filter === id" @click="filter = id">{{ label }} <b>{{ tally[id] }}</b></button></div>
    <div class="adm-queue">
      <div class="adm-card adm-list" role="listbox" aria-label="Items waiting, oldest first">
        <div v-if="!loaded" class="adm-skeleton" aria-busy="true" />
        <p v-else-if="!items.length" class="adm-empty">Nothing is waiting. Reports, reported shops and reported pictures appear here, oldest first.</p>
        <button v-for="entry in items" :key="entry.key" type="button" role="option" :aria-selected="entry.key === chosen" :class="{ on: entry.key === chosen }" @click="chosen = entry.key">
          <span class="adm-chip">{{ entry.kind }}</span> <b>{{ entry.title }}</b><small>waiting {{ age(entry.at, Date.now()) }}{{ entry.summary ? ` · ${entry.summary.slice(0, 60)}` : '' }}</small></button>
        <p class="adm-sub">Keys: j and k move, d dismiss, w warn, m mute.</p>
      </div>
      <div class="adm-card adm-detail" aria-live="polite">
        <template v-if="item">
          <h3>{{ item.title }}</h3>
          <p class="adm-sub">{{ item.kind }} {{ item.id }} · waiting {{ age(item.at, Date.now()) }}<template v-if="item.kind === 'report'"> · {{ absolute(item.at) }}</template></p>
          <template v-if="report"><p v-if="report.text">“{{ report.text }}”</p><p class="adm-sub">Reported by {{ report.byName }}</p>
            <div v-if="report.voice" class="adm-sub"><audio :key="report.voice" controls preload="none" :src="`/api/admin/moderation/voice/${encodeURIComponent(report.voice)}`" aria-label="Reported voice note" /><div><button type="button" :disabled="busy" @click="voiceAction('remove')">Remove recording</button><button type="button" :disabled="busy" @click="voiceAction('restore')">Restore hidden recording</button></div></div>
            <ul v-if="report.evidence.length" class="adm-sub"><li v-for="line in report.evidence" :key="line">{{ line }}</li></ul></template>
          <p v-else-if="item.summary">{{ item.summary }}</p>
          <div v-if="item.player" class="adm-prior"><h4>About {{ item.player.name }}</h4>
            <p v-if="prior" class="adm-sub">{{ prior.reports }} {{ prior.reports === 1 ? 'report' : 'reports' }} in all · <span v-if="prior.flags.length">now: <span v-for="flag in prior.flags" :key="flag" class="adm-chip red">{{ flag }}</span></span><span v-else>no sanctions now</span></p>
            <p v-for="line in prior?.actions ?? []" :key="line.n" class="adm-sub">#{{ line.n }} {{ line.action }}: {{ line.summary }} · {{ relative(line.at, Date.now()) }}</p>
            <p v-if="prior && !prior.actions.length" class="adm-sub">No admin has acted on them before.</p>
            <button class="adm-linkbtn" @click="emit('player', item.player.id)">Open their page</button></div>
          <template v-if="report">
            <label>A warning to send<select v-model="canned"><option v-for="entry in CANNED" :key="entry.id" :value="entry.id">{{ entry.label }}</option></select></label>
            <p class="adm-sub">“{{ CANNED.find((entry) => entry.id === canned)?.text }}”</p>
            <label>Or write your own, or a reason for a mute<input v-model="note" maxlength="200"></label><label>Mute minutes<input v-model.number="minutes" type="number" min="1" max="43200"></label>
            <div class="adm-row"><button class="adm-btn" :disabled="busy" @click="actReport('dismiss')">Dismiss (d)</button><button class="adm-btn" :disabled="busy" @click="actReport('warn')">Warn (w)</button><button class="adm-btn danger" :disabled="busy || (note.trim().length < 3)" :title="note.trim().length < 3 ? 'A mute needs a reason of at least 3 characters.' : undefined" @click="actReport('mute')">Mute (m)</button></div>
          </template>
          <template v-else-if="item.kind === 'shop' && picked"><label>Reason (the owner is told)<input v-model="note" maxlength="200"></label>
            <div class="adm-row"><button class="adm-btn" :disabled="busy" @click="shop(picked as ShopRow, 'rename')">Give it a plain name</button><button class="adm-btn danger" :disabled="busy" @click="shop(picked as ShopRow, 'close')">Close it</button></div></template>
          <template v-else-if="item.kind === 'picture' && picked">
            <button class="adm-btn" @click="viewing = !viewing">{{ viewing ? 'Hide the picture' : 'View the picture' }}</button>
            <img v-if="viewing" :src="`/api/admin/moderation/pictures/${item.id}`" alt="The reported picture" class="adm-picture">
            <div class="adm-row"><button class="adm-btn danger" :disabled="busy" @click="picture(picked as PictureRow, 'remove')">Remove</button><button v-if="(picked as PictureRow).hidden" class="adm-btn" :disabled="busy" @click="picture(picked as PictureRow, 'restore')">Restore</button>
              <button v-if="(picked as PictureRow).from" class="adm-btn" @click="pictureSending(picked as PictureRow, false)">Stop their pictures</button><button v-if="(picked as PictureRow).from" class="adm-btn" @click="pictureSending(picked as PictureRow, true)">Allow their pictures</button></div></template>
          <p class="adm-sub">To suspend or ban, open the player's page.</p>
        </template>
        <p v-else class="adm-empty">Choose something from the list.</p>
      </div>
    </div>
    <div class="adm-card"><div class="adm-row adm-between"><h3>Live city content</h3><label>City<select v-model="city" @change="loadContent"><option v-for="id in admin.me?.cities ?? []" :key="id" :value="id">{{ id }}</option></select></label></div>
      <template v-if="content"><p v-for="ad in content.ads" :key="(ad.kind ?? '') + ad.slot" class="adm-line"><span>Ad “{{ ad.text }}” by {{ ad.by.name }}</span><button class="adm-btn" @click="remove({ kind: ad.kind, slot: ad.slot })">Remove</button></p>
        <p v-for="a in content.announcements" :key="a.id" class="adm-line"><span>Notice “{{ a.text }}” by {{ a.by.name }}</span><button class="adm-btn" @click="remove({ kind: 'announcement', id: a.id })">Remove</button></p>
        <p v-for="r in content.radio" :key="r.id" class="adm-line"><span>Shout-out “{{ r.title }}” by {{ r.by.name }}</span><button class="adm-btn" @click="remove({ kind: 'radio', id: r.id, venue: r.venue })">Remove</button></p>
        <p v-if="!content.ads.length && !content.announcements.length && !content.radio.length" class="adm-muted">Nothing live in {{ city }}.</p></template></div>
    <div v-if="admin.me?.tools.length" class="adm-card"><h3>Tools from other features</h3><p v-for="tool in admin.me.tools" :key="tool.id" class="adm-sub">{{ tool.title }} ({{ tool.kind }})</p></div>
  </section>
</template>
