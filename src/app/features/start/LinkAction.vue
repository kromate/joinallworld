<script setup lang="ts">
// The one-tap way out of a connection state, as a button: "Try again" reconnects, "Choose a
// nickname" and "Start a new life" open the session sheet. Nothing when connected or still
// connecting. The words are linkWords' own (src/ui/link.js); the actions are the ones the existing
// buttons carry as data-menu and data-open-gate.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'

defineProps<{ className?: string }>()
const { game, shell, menu } = useApp()
const action = computed(() => linkWords(game.view.value)?.action ?? null)

function run(): void {
  const current = action.value
  if (!current) return
  if (current.menu) { shell.ui.trayOpen = false; menu(current.menu); return }
  if (current.gate) { const gate = shell.sessionGate(current.gate); if (gate) shell.open(gate.id, { reason: current.gate }) }
}
</script>

<template>
  <button v-if="action" type="button" :class="className ?? 'ui-button'" @click="run">{{ action.label }}</button>
</template>
