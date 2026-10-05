<script setup lang="ts">
// Mounted once in App.vue, and tiny on purpose: the notices of a ping (an incoming one, the landing of a join link, "they
// joined you") are fetched only when there is one. Like the toast stack they live inside the open dialog (`host`) when
// there is one, so a sheet can never cover them.
import { defineAsyncComponent } from 'vue'
import { pingUi, startPing } from './pingLoader.ts'

withDefaults(defineProps<{ host?: string }>(), { host: 'body' })
startPing()
const PingNotices = defineAsyncComponent(() => import('./PingNotices.vue'))
</script>

<template>
  <Teleport :to="host">
    <PingNotices v-if="pingUi.wanted" :in-dialog="host !== 'body'" />
  </Teleport>
</template>
