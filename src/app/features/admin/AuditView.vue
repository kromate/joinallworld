<script setup lang="ts">
// The audit log: every admin action, newest first, filtered by admin, action, player and date, with a detail view of what changed (before and
// after, in words, and what the request asked for) and an export to CSV made in this browser.
import { computed, onMounted, reactive, ref } from 'vue'
import { useAdmin } from './useAdmin.ts'
import { absolute, auditCsv, naira, relative } from './adminModel.ts'
import type { AuditView as Line } from '../../../types/admin.ts'

const emit = defineEmits<{ player: [id: string] }>()
const api = useAdmin()
const f = reactive({ action: '', q: '', admin: '', player: '', from: '', to: '' })
const lines = ref<Line[]>([]), next = ref<number | null>(null), total = ref(0), error = ref(''), busy = ref(false), open = ref<number | null>(null), loaded = ref(false)
const day = (value: string, end: boolean): number | undefined => (value ? new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}Z`).getTime() - 3600000 : undefined)
const query = (limit: number, before?: number) => ({ action: f.action, q: f.q, admin: f.admin, target: f.player.trim().toLowerCase(), from: day(f.from, false), to: day(f.to, true), limit, before })
async function load(more = false): Promise<void> {
  busy.value = true
  const r = await api.get<{ lines: Line[]; total: number; next: number | null }>('/api/admin/audit', query(100, more ? next.value ?? undefined : undefined))
  busy.value = false; loaded.value = true
  if (!r.ok) { error.value = r.error.reason; return }
  lines.value = more ? [...lines.value, ...r.data.lines] : r.data.lines; next.value = r.data.next; total.value = r.data.total; error.value = ''
}
async function exportCsv(): Promise<void> {
  const all: Line[] = []; let before: number | undefined
  for (let i = 0; i < 12; i++) {
    const r = await api.get<{ lines: Line[]; next: number | null }>('/api/admin/audit', query(500, before))
    if (!r.ok) { error.value = r.error.reason; return }
    all.push(...r.data.lines); if (r.data.next === null) break; before = r.data.next
  }
  const url = URL.createObjectURL(new Blob([auditCsv(all)], { type: 'text/csv' }))
  const link = document.createElement('a'); link.href = url; link.download = 'allworld-audit.csv'; link.click(); URL.revokeObjectURL(url)
}
const isPlayer = (id: string): boolean => /^[0-9a-f-]{36}$/.test(id)
const ACTIONS = ['credit', 'debit', 'grant', 'heal', 'need', 'teleport', 'rename', 'mute', 'unmute', 'suspend', 'unsuspend', 'ban', 'unban', 'signout', 'message', 'note', 'announce', 'announce-cancel', 'setting', 'notice', 'report-warn', 'report-mute', 'report-dismiss', 'content-remove']
const detail = computed(() => lines.value.find((line) => line.n === open.value) ?? null)
function clear(): void { Object.assign(f, { action: '', q: '', admin: '', player: '', from: '', to: '' }); void load() }
onMounted(() => { void load() })
</script>

<template>
  <section aria-label="Audit log">
    <form class="adm-row" @submit.prevent="load()">
      <label>Action<input v-model="f.action" list="adm-actions" placeholder="credit, ban, announce…"></label><datalist id="adm-actions"><option v-for="a in ACTIONS" :key="a" :value="a" /></datalist>
      <label class="adm-grow">Search<input v-model="f.q" placeholder="player, reason, text"></label>
      <label>Admin ref<input v-model="f.admin" size="8" placeholder="a1b2c3"></label>
      <label>Player id<input v-model="f.player" size="12" placeholder="public id"></label>
      <label>From<input v-model="f.from" type="date"></label><label>To<input v-model="f.to" type="date"></label>
      <button class="adm-btn primary">Filter</button><button type="button" class="adm-btn" @click="clear">Clear</button><button type="button" class="adm-btn" @click="exportCsv">Export CSV</button>
    </form>
    <p v-if="error" class="adm-error" role="alert">{{ error }} <button class="adm-btn" @click="load()">Try again</button></p>
    <div class="adm-queue">
      <div class="adm-card adm-scroll adm-tablewrap">
        <table class="adm-table adm-sticky"><thead><tr><th>#</th><th>When</th><th>Admin</th><th>Action</th><th>Player</th><th>What changed</th></tr></thead><tbody>
          <template v-if="!loaded"><tr v-for="n in 5" :key="n" class="adm-skel-row"><td colspan="6"><i /></td></tr></template>
          <tr v-for="line in lines" :key="line.n" class="click" :class="{ on: open === line.n }" tabindex="0" @click="open = line.n" @keydown.enter="open = line.n">
            <td>{{ line.n }}</td><td :title="absolute(line.at)">{{ relative(line.at, api.now()) }}</td><td>{{ line.adminName }}</td><td><span class="adm-chip">{{ line.action }}</span></td>
            <td>{{ line.targetName }}</td><td>{{ line.summary }}<span v-if="line.amount !== undefined" class="adm-sub"> ({{ line.amount < 0 ? '−' : '+' }}{{ naira(Math.abs(line.amount)) }})</span></td></tr>
          <tr v-if="loaded && !lines.length"><td colspan="6" class="adm-empty">No entries match. <button class="adm-btn" @click="clear">Clear filters</button></td></tr></tbody></table>
        <div class="adm-row adm-between adm-pager"><span class="adm-muted">{{ total }} entries match (the last 5,000 are kept)</span><button v-if="next !== null" class="adm-btn" :disabled="busy" @click="load(true)">Older</button></div>
      </div>
      <aside v-if="detail" class="adm-card adm-detail" aria-label="Entry detail">
        <h3>#{{ detail.n }} · {{ detail.action }}</h3>
        <p class="adm-line"><span>When</span><b>{{ absolute(detail.at) }}</b></p><p class="adm-line"><span>Admin</span><b>{{ detail.adminName }} ({{ detail.admin }})</b></p>
        <p class="adm-line"><span>Player</span><b><button v-if="isPlayer(detail.target)" class="adm-linkbtn" @click="emit('player', detail.target)">{{ detail.targetName }}</button><template v-else>{{ detail.targetName || '-' }}</template></b></p>
        <h4>Before → after</h4><p>{{ detail.summary }}</p>
        <p v-if="detail.reason" class="adm-line"><span>Reason</span><b>{{ detail.reason }}</b></p>
        <p v-if="detail.amount !== undefined" class="adm-line"><span>Naira moved</span><b>{{ detail.amount < 0 ? '−' : '+' }}{{ naira(Math.abs(detail.amount)) }}</b></p>
        <h4>The request</h4><p v-for="(value, key) in detail.params" :key="key" class="adm-line"><span>{{ key }}</span><b>{{ value }}</b></p><p v-if="!Object.keys(detail.params).length" class="adm-muted">Nothing besides the action.</p>
        <button class="adm-btn" @click="open = null">Close</button>
      </aside>
    </div>
  </section>
</template>
