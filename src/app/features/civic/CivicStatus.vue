<script setup lang="ts">
// What a civic screen shows until its data is here: the standard loading, offline and error
// states of a cached response. Renders nothing once there is data (a failed refresh of stale
// data is the one line under it, see `stale`).
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import type { CivicEntry } from './civicCore.ts'

const props = defineProps<{ item: CivicEntry }>()
const emit = defineEmits<{ retry: [] }>()
const { game, shell, menu } = useApp()
const words = computed(() => (game.connected.value ? null : linkWords(game.view.value)))
/** The one-tap way out of a connection state (reconnect, or the session sheet). */
function run(): void {
  const action = words.value?.action
  if (!action) return
  if (action.menu) menu(action.menu)
  else if (action.gate) { const gate = shell.sessionGate(action.gate); if (gate) shell.open(gate.id, { reason: action.gate }) }
}
const waiting = computed(() => !props.item.data)
</script>

<template>
  <template v-if="waiting">
    <EmptyState v-if="words" compact icon="cloud-off" :title="words.short" :text="`${words.why} This screen is loaded from the server, so it cannot be shown right now.`">
      <BaseButton v-if="words.action" small @click="run">{{ words.action.label }}</BaseButton>
    </EmptyState>
    <EmptyState v-else-if="item.error" role="alert" compact icon="cloud-off" title="This did not load" :text="item.error">
      <BaseButton small @click="emit('retry')">Try again</BaseButton>
    </EmptyState>
    <SkeletonRows v-else :rows="4" />
  </template>
</template>
