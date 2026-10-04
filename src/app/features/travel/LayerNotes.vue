<script setup lang="ts">
// One line under the layer toggles for each switched-on layer: what it shows, or why it cannot be
// loaded (with the way out), and the button that opens the panel that manages it.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GoFix from './GoFix.vue'
import type { Fix, LayerNote } from './travelModel.ts'
import { linkWords } from './travelBoundary.ts'

defineProps<{ notes: readonly LayerNote[] }>()
const { game, shell } = useApp()
/** The one-tap way out of the connection problem, when there is one (not while still connecting). */
const reconnect = computed((): Fix | null => {
  const action = linkWords(game.view.value)?.action
  return action ? { kind: 'reconnect', label: action.label, action } : null
})
</script>

<template>
  <div v-for="(note, index) in notes" :key="index" class="map-layer-note">
    <span>{{ note.text }}</span>
    <GoFix v-if="note.reconnect && reconnect" :fix="reconnect" look="map-chip-button" />
    <button v-if="note.action" type="button" class="map-chip-button" @click="shell.open(note.action.open, note.action.params ?? undefined)">{{ note.action.label }}</button>
  </div>
</template>
