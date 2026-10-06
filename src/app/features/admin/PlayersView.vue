<script setup lang="ts">
// Find a player, or read one. Saved filters for the questions asked every day, a search that waits for the typing to stop and remembers what was
// searched, a table that sorts and pages, and a bulk bar (a message, or a small credit) that goes through the same limits as one player at a time.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { admin, useAdmin } from './useAdmin.ts'
import { naira, relative } from './adminModel.ts'
import { recordDone, rememberSearch, ui } from './adminUi.ts'
import PlayerPage from './PlayerPage.vue'
import type { PlayersPage } from '../../../types/admin.ts'

const props = defineProps<{ player: string | null; tab: string | null }>()
const emit = defineEmits<{ open: [id: string]; back: []; tab: [tab: string] }>()
const api = useAdmin()
const FILTERS = [['all', 'Everyone'], ['today', 'New today'], ['online', 'Online'], ['accounts', 'Signed up'], ['guests', 'Guests'], ['broke', 'Broke'], ['banned', 'Banned'], ['flagged', 'Reported']] as const
const q = ref(''), filter = ref<string>('all'), city = ref(''), page = ref(0), size = ref(15), sort = ref('seen'), dir = ref<'asc' | 'desc'>('desc')
const data = ref<PlayersPage | null>(null), error = ref(''), busy = ref(false)
let wait: ReturnType<typeof setTimeout> | undefined, seq = 0
async function search(): Promise<void> {
  const mine = ++seq
  busy.value = true
  const reply = await api.get<PlayersPage>('/api/admin/players', { q: q.value, filter: filter.value, city: city.value, page: page.value, size: size.value, sort: sort.value, dir: dir.value })
  if (mine !== seq) return
  busy.value = false
  if (reply.ok) { data.value = reply.data; error.value = '' } else error.value = reply.error.reason
}
function again(): void { page.value = 0; selected.clear(); void search() }
watch([filter, city, size, sort, dir], again)
watch(q, () => { clearTimeout(wait); wait = setTimeout(() => { rememberSearch(q.value); again() }, 350) })
onMounted(search)
onBeforeUnmount(() => clearTimeout(wait))
const sorter = (key: string): void => { if (sort.value === key) dir.value = dir.value === 'desc' ? 'asc' : 'desc'; else { sort.value = key; dir.value = key === 'name' ? 'asc' : 'desc' } }
const aria = (key: string): 'ascending' | 'descending' | 'none' => (sort.value === key ? (dir.value === 'asc' ? 'ascending' : 'descending') : 'none')
const pages = computed(() => (data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1))

// ---- bulk ---------------------------------------------------------------------------------------------------------
const selected = reactive(new Set<string>()), BULK_MAX = 20
const bulk = reactive({ action: '' as '' | 'message' | 'credit', text: '', amount: 500, reason: '', typed: '', token: '', summary: '', busy: false, error: '' })
const all = computed(() => Boolean(data.value?.rows.length) && data.value!.rows.every((row) => selected.has(row.id)))
function toggleAll(): void { if (all.value) for (const row of data.value?.rows ?? []) selected.delete(row.id); else for (const row of data.value?.rows ?? []) if (selected.size < BULK_MAX) selected.add(row.id) }
function toggle(id: string): void { if (selected.has(id)) selected.delete(id); else if (selected.size < BULK_MAX) selected.add(id) }
function startBulk(action: 'message' | 'credit'): void { Object.assign(bulk, { action, token: '', summary: '', typed: '', error: '' }) }
const bulkWhy = computed(() => {
  if (!bulk.action) return 'Choose what to do.'
  if (bulk.action === 'message' && !bulk.text.trim()) return 'Write the message.'
  if (bulk.action === 'credit' && !(Number.isInteger(bulk.amount) && bulk.amount > 0)) return 'The amount must be a whole number of naira.'
  if (bulk.action === 'credit' && bulk.reason.trim().length < 3) return 'A reason is needed (at least 3 characters).'
  if (bulk.token && bulk.typed.trim() !== String(selected.size)) return `Type ${selected.size} to confirm.`
  return null
})
async function sendBulk(): Promise<void> {
  if (bulkWhy.value || bulk.busy) return
  bulk.busy = true; bulk.error = ''
  const body = { ids: [...selected], action: bulk.action, ...(bulk.action === 'message' ? { text: bulk.text.trim() } : { amount: bulk.amount, reason: bulk.reason.trim() }), ...(bulk.token ? { confirm: bulk.token } : {}) }
  const reply = await api.post<Record<string, unknown>>('/api/admin/players/bulk', body, `bulk:${bulk.action}:${[...selected].sort().join(',')}:${bulk.text}:${bulk.amount}`)
  bulk.busy = false
  if (!reply.ok) { bulk.error = reply.error.reason; return }
  if (reply.data.code === 'confirmation_required') { bulk.token = String(reply.data.token); bulk.summary = String(reply.data.summary); return }
  if (reply.data.ok === true) { recordDone(String(reply.data.summary), true); bulk.action = ''; selected.clear(); void search() } else bulk.error = String(reply.data.reason ?? reply.data.code)
}
</script>

<template>
  <PlayerPage v-if="props.player" :id="props.player" :tab="props.tab" @back="emit('back')" @tab="emit('tab', $event)" @open="emit('open', $event)" />
  <section v-else aria-label="Players">
    <div class="adm-chips" role="group" aria-label="Saved filters"><button v-for="[id, label] in FILTERS" :key="id" type="button" :aria-pressed="filter === id" @click="filter = id">{{ label }}</button></div>
    <form class="adm-row" @submit.prevent="again">
      <label class="adm-grow">Name, public id, or address hash<input v-model="q" type="search" placeholder="Ada, 3f9a1c2e…, or a 64-character hash" autocomplete="off" list="adm-recent"></label>
      <datalist id="adm-recent"><option v-for="item in ui.recent" :key="item" :value="item" /></datalist>
      <label>City<select v-model="city"><option value="">Any</option><option v-for="id in admin.me?.cities ?? []" :key="id" :value="id">{{ id }}</option></select></label>
      <label>Rows<select v-model.number="size"><option :value="15">15</option><option :value="40">40</option><option :value="100">100</option></select></label>
    </form>
    <div v-if="ui.recent.length && !q" class="adm-chips adm-small" aria-label="Recent searches"><span class="adm-muted">Recent:</span><button v-for="item in ui.recent" :key="item" type="button" @click="q = item">{{ item }}</button></div>
    <p v-if="error" class="adm-error" role="alert">{{ error }} <button class="adm-btn" @click="search">Try again</button></p>

    <div v-if="selected.size" class="adm-bulkbar" role="region" aria-label="Chosen players">
      <b>{{ selected.size }} chosen</b> <span class="adm-muted">(at most {{ BULK_MAX }})</span>
      <button class="adm-btn" @click="startBulk('message')">Message…</button><button class="adm-btn" @click="startBulk('credit')">Give a little…</button><button class="adm-btn" @click="selected.clear(); bulk.action = ''">Clear</button>
    </div>
    <form v-if="bulk.action && selected.size" class="adm-card adm-form" @submit.prevent="sendBulk">
      <h3>{{ bulk.action === 'message' ? `Message ${selected.size} players as the founder` : `Give ${selected.size} players the same amount` }}</h3>
      <label v-if="bulk.action === 'message'">Message<textarea v-model="bulk.text" maxlength="500" /></label>
      <template v-else><label>Amount (₦ each)<input v-model.number="bulk.amount" type="number" min="1" inputmode="numeric"></label><label>Reason (they see it)<input v-model="bulk.reason" maxlength="200"></label></template>
      <p v-if="bulk.summary" class="adm-note" role="status">{{ bulk.summary }}. <label class="adm-inline">Type {{ selected.size }} to confirm<input v-model="bulk.typed" inputmode="numeric" autocomplete="off"></label></p>
      <p v-if="bulk.error" class="adm-error" role="alert">{{ bulk.error }}</p>
      <div class="adm-row"><button class="adm-btn primary" :disabled="bulk.busy || Boolean(bulkWhy)" :title="bulkWhy ?? undefined">{{ bulk.busy ? 'Working…' : bulk.token ? 'Confirm and send' : 'Check and continue' }}</button><button type="button" class="adm-btn" @click="bulk.action = ''">Cancel</button></div>
      <p v-if="bulkWhy" class="adm-sub">{{ bulkWhy }}</p>
      <p class="adm-sub">The limits for one player at a time apply to each, and nothing is sent unless every player can be reached.</p>
    </form>

    <div class="adm-card adm-scroll adm-tablewrap" :aria-busy="busy">
      <table class="adm-table adm-sticky">
        <thead><tr>
          <th class="adm-check"><input type="checkbox" :checked="all" aria-label="Choose every player on this page" @change="toggleAll"></th>
          <th :aria-sort="aria('name')"><button type="button" @click="sorter('name')">Name</button></th><th>Kind</th><th>City</th>
          <th :aria-sort="aria('cash')"><button type="button" @click="sorter('cash')">Cash</button></th>
          <th :aria-sort="aria('seen')"><button type="button" @click="sorter('seen')">Seen</button></th>
          <th :aria-sort="aria('since')"><button type="button" @click="sorter('since')">Joined</button></th><th>Flags</th></tr></thead>
        <tbody>
          <template v-if="!data && !error"><tr v-for="n in 6" :key="n" class="adm-skel-row"><td colspan="8"><i /></td></tr></template>
          <tr v-for="row in data?.rows ?? []" :key="row.id" class="click" tabindex="0" @click="emit('open', row.id)" @keydown.enter="emit('open', row.id)">
            <td class="adm-check" @click.stop><input type="checkbox" :checked="selected.has(row.id)" :aria-label="`Choose ${row.name}`" @change="toggle(row.id)"></td>
            <td><span v-if="row.online" class="adm-chip green">online</span> {{ row.name }} <span v-if="row.admin" class="adm-chip">admin</span></td>
            <td>{{ row.kind }}</td><td>{{ row.city ?? '-' }}</td><td>{{ naira(row.cash) }}</td><td>{{ relative(row.lastSeen, api.now()) }}</td><td>{{ row.since ? relative(row.since, api.now()) : '-' }}</td>
            <td><span v-for="flag in row.flags" :key="flag" class="adm-chip red">{{ flag }}</span></td>
          </tr>
          <tr v-if="data && !data.rows.length"><td colspan="8" class="adm-empty">No players match{{ q || filter !== 'all' ? ' these filters' : '' }}. <button v-if="q || filter !== 'all'" class="adm-btn" @click="q = ''; filter = 'all'">Clear filters</button></td></tr>
        </tbody>
      </table>
      <div v-if="data" class="adm-row adm-between adm-pager"><span class="adm-muted">{{ data.total }} found · page {{ data.page + 1 }} of {{ pages }} · {{ data.scanned }} sessions read</span>
        <span><button class="adm-btn" :disabled="data.page === 0" @click="page -= 1; search()">Previous</button> <button class="adm-btn" :disabled="data.page + 1 >= pages" @click="page += 1; search()">Next</button></span></div>
    </div>
  </section>
</template>
