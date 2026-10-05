<script setup lang="ts">
// THE LANDING SCREEN — the session gate of a new device ('quick-start', role 'session-gate'): the
// full-screen character creator (CreatorApp.vue) in its first-time mode. Play now sends
// 'jaw:quick-start' { name, look } (App.vue), which opens the session and confirms the look with the
// 'onboarding.quick-start' action — exactly once: the action id is kept on the device until the
// server has answered (src/quick-start/entry.ts). The name and character are kept on the device as
// they are edited (startBoundary.ts), so a reload in the middle loses nothing.
// params: { reason: 'new', problem?: { reason, name } } — or none, when the shell opened it because
// the life is still held for its look.
import CreatorApp from './CreatorApp.vue'

defineProps<{ params?: unknown }>()
</script>

<template>
  <CreatorApp mode="new" :params="params" />
</template>
