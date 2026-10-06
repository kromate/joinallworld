<script setup lang="ts">
// A call that is on another device of this player: one quiet line, no button. Only the device that carries a call can end it.
import type { CallView } from '../../../calls.ts'

defineProps<{ view: CallView }>()
</script>

<template>
  <p class="call-line" role="status" aria-live="polite" data-call="elsewhere">{{ view.notice }}<template v-if="view.peer"> With {{ view.peer.name }}.</template></p>
</template>
