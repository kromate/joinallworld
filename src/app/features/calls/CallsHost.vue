<script setup lang="ts">
// Mounted once in App.vue. It is tiny on purpose: the call screens (and the controller behind them) are
// fetched only when a call is placed or arrives. Like the toast stack, the screens live inside the open
// dialog (`host`) when there is one, so a modal sheet can never cover an incoming call.
import { defineAsyncComponent } from 'vue'
import { callStore, callVisible } from './callState.ts'
import { startCalls } from './callsLoader.ts'

withDefaults(defineProps<{ host?: string }>(), { host: 'body' })
startCalls()
const CallsUi = defineAsyncComponent(() => import('./CallsUi.vue'))
</script>

<template>
  <Teleport :to="host">
    <CallsUi v-if="callVisible() || callStore.view.phase !== 'idle'" :in-dialog="host !== 'body'" />
  </Teleport>
</template>
