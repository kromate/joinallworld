<script setup lang="ts">
// The admin app inside the game: a full-screen sheet reached from the Phone (or Alt+Shift+A) only after the server has said this session is an
// admin. It is the same frame as the admin address's page (AdminShell.vue); only how it reaches the server and how it closes differ.
import { onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { setAdminTransport } from './transport.ts'
import { admin, useAdmin } from './useAdmin.ts'
import AdminShell from './AdminShell.vue'

defineProps<{ params?: unknown }>()
const { shell, game } = useApp()
setAdminTransport({ fetchJson: game.fetchJson, newId: game.newId, now: () => game.view.value.now })
const api = useAdmin()
const failed = ref('')
onMounted(async () => {
  const reply = await api.get<NonNullable<typeof admin.me>>('/api/admin/me')
  if (reply.ok) admin.me = reply.data; else failed.value = reply.error.reason
})
</script>

<template>
  <Teleport to="#life-dialog">
    <p v-if="failed" class="adm-error adm-fixed" role="alert">{{ failed }}</p>
    <AdminShell v-else-if="admin.me" mode="game" @close="shell.close()" />
    <p v-else class="adm-muted adm-fixed">Loading…</p>
  </Teleport>
</template>
