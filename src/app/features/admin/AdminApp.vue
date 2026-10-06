<script setup lang="ts">
// The admin app: a full-screen, lazily loaded screen reached from the Phone (or Alt+Shift+A) only after the server has said this session is an
// admin. Left nav on a wide screen, a top bar on a phone. Every number and action is the server's (docs/ADMIN.md); this only asks and shows.
import { onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { admin, useAdmin } from './useAdmin.ts'
import DashboardView from './DashboardView.vue'
import PlayersView from './PlayersView.vue'
import AnnounceView from './AnnounceView.vue'
import WorldView from './WorldView.vue'
import ModerationView from './ModerationView.vue'
import AuditView from './AuditView.vue'
import './admin.css'

defineProps<{ params?: unknown }>()
const { shell } = useApp()
const api = useAdmin()
const NAV = [['dashboard', 'Dashboard'], ['players', 'Players'], ['announce', 'Announcements'], ['world', 'World'], ['moderation', 'Moderation'], ['audit', 'Audit']] as const
type View = (typeof NAV)[number][0]
const view = ref<View>('dashboard')
const player = ref<string | null>(null)
const failed = ref('')
function openPlayer(id: string): void { player.value = id; view.value = 'players' }
function go(next: View): void { view.value = next; if (next !== 'players') player.value = null }
onMounted(async () => {
  const reply = await api.get<NonNullable<typeof admin.me>>('/api/admin/me')
  if (reply.ok) admin.me = reply.data; else failed.value = reply.error.reason
})
</script>

<template>
  <div class="adm" role="application" aria-label="Admin">
    <header class="adm-top">
      <b class="adm-brand">Admin</b>
      <nav class="adm-nav" aria-label="Admin sections">
        <button v-for="[id, label] in NAV" :key="id" type="button" :class="{ on: view === id }" :aria-current="view === id ? 'page' : undefined" @click="go(id)">{{ label }}</button>
      </nav>
      <span class="adm-who">{{ admin.me ? `${admin.me.name} · ${admin.me.level}` : '' }}</span>
      <button type="button" class="adm-close" aria-label="Close admin" @click="shell.close()">Close</button>
    </header>
    <main class="adm-main">
      <p v-if="failed" class="adm-error" role="alert">{{ failed }}</p>
      <template v-else-if="admin.me">
        <DashboardView v-if="view === 'dashboard'" @player="openPlayer" />
        <PlayersView v-else-if="view === 'players'" :player="player" @open="player = $event" @back="player = null" />
        <AnnounceView v-else-if="view === 'announce'" />
        <WorldView v-else-if="view === 'world'" />
        <ModerationView v-else-if="view === 'moderation'" @player="openPlayer" />
        <AuditView v-else-if="view === 'audit'" @player="openPlayer" />
      </template>
      <p v-else class="adm-muted">Loading…</p>
    </main>
  </div>
</template>
