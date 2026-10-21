<script setup lang="ts">
// Mounted once in App.vue. It is tiny on purpose: the call screens (and the controller behind them) are
// fetched only when a call is placed or arrives. Like the toast stack, the screens live inside the open
// dialog (`host`) when there is one, so a modal sheet can never cover an incoming call.
import { defineAsyncComponent } from 'vue'
import { callStore, callVisible } from './callState.ts'
import { startCalls } from './callsLoader.ts'
import { agentCallStore } from './agentCallState.ts'

withDefaults(defineProps<{ host?: string }>(), { host: 'body' })
startCalls()
const CallsUi = defineAsyncComponent(() => import('./CallsUi.vue'))
// A call with an AI character (Phase 15): its screen, recognition and voice code load only when one is started.
const AgentCallScreen = defineAsyncComponent(() => import('./AgentCallScreen.vue'))
</script>

<template>
  <Teleport :to="host">
    <div v-if="agentCallStore.open" class="calls-layer-agent"><AgentCallScreen :key="`${agentCallStore.open.agent}:${agentCallStore.open.turn}`" :agent="agentCallStore.open.agent" :name="agentCallStore.open.name" /></div>
    <CallsUi v-if="callVisible() || callStore.view.phase !== 'idle'" :in-dialog="host !== 'body'" />
  </Teleport>
</template>

<style scoped>
.calls-layer-agent { position: fixed; top: calc(60px + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); width: min(380px, calc(100% - 20px)); z-index: 71; font-family: var(--font); zoom: var(--ui-zoom, 1); }
</style>
