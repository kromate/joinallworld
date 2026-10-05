<script setup lang="ts">
// The note a social screen shows instead of its content until the overview has loaded: the look is
// not chosen yet, the game is not connected (with the one tap that resolves it), the overview
// could not be read (Retry), or it is still loading.
import '../../../ui/panels/social.css'
import type { Gate } from './socialWords.ts'

defineProps<{
  gate: Gate
  /** The label of the connection state's action ("Try again"), or null. */
  action: string | null
}>()
const emit = defineEmits<{ action: []; retry: [] }>()
</script>

<template>
  <p class="social-note" :class="{ 'is-warn': gate.warn }" role="status">
    {{ gate.text }}
    <button v-if="gate.link && action" type="button" class="social-link" @click="emit('action')">{{ action }}</button>
    <button v-if="gate.retry" type="button" class="social-link" @click="emit('retry')">Retry</button>
  </p>
</template>
