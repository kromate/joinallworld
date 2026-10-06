<script setup lang="ts">
// Find a player, or read one. A search walks the stored sessions once on the server (limited to the admin read budget).
import { onMounted, ref, watch } from 'vue'
import { useAdmin, admin } from './useAdmin.ts'
import { naira, relative } from './adminModel.ts'
import PlayerPage from './PlayerPage.vue'
import type { PlayersPage } from '../../../types/admin.ts'

const props = defineProps<{ player: string | null }>()
const emit = defineEmits<{ open: [id: string]; back: [] }>()
const api = useAdmin()
const q = ref(''), filter = ref('all'), city = ref(''), page = ref(0)
const data = ref<PlayersPage | null>(null), error = ref(''), busy = ref(false)
async function search(): Promise<void> {
  busy.value = true
  const reply = await api.get<PlayersPage>('/api/admin/players', { q: q.value, filter: filter.value, city: city.value, page: page.value })
  busy.value = false
  if (reply.ok) { data.value = reply.data; error.value = '' } else error.value = reply.error.reason
}
function submit(): void { page.value = 0; void search() }
watch([filter, city], submit)
onMounted(search)
</script>

<template>
  <PlayerPage v-if="props.player" :id="props.player" @back="emit('back')" />
  <section v-else>
    <h2>Players</h2>
    <form class="adm-row" @submit.prevent="submit">
      <label style="flex:1;min-width:200px">Name, public id, or address hash<input v-model="q" type="search" placeholder="Ada, 3f9a1c2e…, or a 64-character hash" autocomplete="off"></label>
      <label>Show<select v-model="filter"><option value="all">Everyone</option><option value="online">Online now</option><option value="accounts">Accounts</option><option value="guests">Guests</option><option value="new">New (2 days)</option><option value="flagged">Flagged</option></select></label>
      <label>City<select v-model="city"><option value="">Any</option><option v-for="id in admin.me?.cities ?? []" :key="id" :value="id">{{ id }}</option></select></label>
      <button class="adm-btn primary" :disabled="busy">Search</button>
    </form>
    <p v-if="error" class="adm-error" role="alert">{{ error }}</p>
    <div v-if="data" class="adm-card adm-scroll">
      <table class="adm-table">
        <thead><tr><th>Name</th><th>Kind</th><th>City</th><th>Cash</th><th>Seen</th><th>Flags</th></tr></thead>
        <tbody>
          <tr v-for="row in data.rows" :key="row.id" class="click" tabindex="0" @click="emit('open', row.id)" @keydown.enter="emit('open', row.id)">
            <td><span v-if="row.online" class="adm-chip green">online</span> {{ row.name }} <span v-if="row.admin" class="adm-chip">admin</span></td>
            <td>{{ row.kind }}</td><td>{{ row.city ?? '-' }}</td><td>{{ naira(row.cash) }}</td><td>{{ relative(row.lastSeen, api.now()) }}</td>
            <td><span v-for="flag in row.flags" :key="flag" class="adm-chip red">{{ flag }}</span></td>
          </tr>
          <tr v-if="!data.rows.length"><td colspan="6" class="adm-muted">No players match.</td></tr>
        </tbody>
      </table>
      <div class="adm-row" style="margin:8px 0 0"><span class="adm-muted" style="flex:1">{{ data.total }} found · page {{ data.page + 1 }} of {{ Math.max(1, Math.ceil(data.total / data.pageSize)) }} · {{ data.scanned }} sessions read</span>
        <button class="adm-btn" :disabled="data.page === 0" @click="page -= 1; search()">Previous</button><button class="adm-btn" :disabled="(data.page + 1) * data.pageSize >= data.total" @click="page += 1; search()">Next</button></div>
    </div>
    <p v-else-if="!error" class="adm-muted">Loading…</p>
  </section>
</template>
