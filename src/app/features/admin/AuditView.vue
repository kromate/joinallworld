<script setup lang="ts">
// The audit log: every admin action, newest first, with filters, and an export to CSV made in this browser.
import { onMounted, reactive, ref } from 'vue'
import { useAdmin } from './useAdmin.ts'
import { absolute, auditCsv, naira, relative } from './adminModel.ts'
import type { AuditView as Line } from '../../../types/admin.ts'

const emit = defineEmits<{ player: [id: string] }>()
const api = useAdmin()
const f = reactive({ action: '', q: '', admin: '' })
const lines = ref<Line[]>([]), next = ref<number | null>(null), total = ref(0), error = ref(''), busy = ref(false)
async function load(more = false): Promise<void> {
  busy.value = true
  const r = await api.get<{ lines: Line[]; total: number; next: number | null }>('/api/admin/audit', { action: f.action, q: f.q, admin: f.admin, limit: 100, before: more ? next.value ?? undefined : undefined })
  busy.value = false
  if (!r.ok) { error.value = r.error.reason; return }
  lines.value = more ? [...lines.value, ...r.data.lines] : r.data.lines; next.value = r.data.next; total.value = r.data.total; error.value = ''
}
async function exportCsv(): Promise<void> {
  const all: Line[] = []; let before: number | undefined
  for (let i = 0; i < 12; i++) {
    const r = await api.get<{ lines: Line[]; next: number | null }>('/api/admin/audit', { action: f.action, q: f.q, admin: f.admin, limit: 500, before })
    if (!r.ok) { error.value = r.error.reason; return }
    all.push(...r.data.lines); if (r.data.next === null) break; before = r.data.next
  }
  const url = URL.createObjectURL(new Blob([auditCsv(all)], { type: 'text/csv' }))
  const link = document.createElement('a'); link.href = url; link.download = 'allworld-audit.csv'; link.click(); URL.revokeObjectURL(url)
}
onMounted(() => { void load() })
</script>

<template>
  <section>
    <h2>Audit log</h2>
    <form class="adm-row" @submit.prevent="load()">
      <label>Action<input v-model="f.action" placeholder="credit, ban, announce…"></label><label style="flex:1;min-width:180px">Search<input v-model="f.q" placeholder="player, reason, text"></label><label>Admin ref<input v-model="f.admin" style="width:90px"></label>
      <button class="adm-btn primary">Filter</button><button type="button" class="adm-btn" @click="exportCsv">Export CSV</button>
    </form>
    <p v-if="error" class="adm-error" role="alert">{{ error }}</p>
    <div class="adm-card adm-scroll">
      <table class="adm-table"><thead><tr><th>#</th><th>When</th><th>Admin</th><th>Action</th><th>Player</th><th>What changed</th><th>Reason</th></tr></thead><tbody>
        <tr v-for="line in lines" :key="line.n"><td>{{ line.n }}</td><td :title="absolute(line.at)">{{ absolute(line.at) }}<div class="adm-sub">{{ relative(line.at, api.now()) }}</div></td><td>{{ line.adminName }}<div class="adm-sub">{{ line.admin }}</div></td><td><span class="adm-chip">{{ line.action }}</span></td>
          <td><a v-if="/^[0-9a-f-]{36}$/.test(line.target)" href="#" @click.prevent="emit('player', line.target)">{{ line.targetName }}</a><template v-else>{{ line.targetName }}</template></td>
          <td>{{ line.summary }}<span v-if="line.amount !== undefined" class="adm-sub"> ({{ line.amount < 0 ? '−' : '+' }}{{ naira(Math.abs(line.amount)) }})</span></td><td>{{ line.reason }}</td></tr>
        <tr v-if="!lines.length"><td colspan="7" class="adm-muted">{{ busy ? 'Loading…' : 'No entries.' }}</td></tr></tbody></table>
      <div class="adm-row" style="margin:8px 0 0"><span class="adm-muted" style="flex:1">{{ total }} entries match (the last 5,000 are kept)</span><button v-if="next !== null" class="adm-btn" :disabled="busy" @click="load(true)">Older</button></div>
    </div>
  </section>
</template>
