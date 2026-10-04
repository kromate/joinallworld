<script setup lang="ts">
// A button that always says why it is disabled, and "Working…" while its request is on its way.
import BaseButton from '../../ui/BaseButton.vue'

withDefaults(defineProps<{
  primary?: boolean
  working?: boolean
  /** Why the button is off ('' = on). Shown under it. */
  reason?: string
  block?: boolean
  /** The prize is ready to take: the amber button. */
  highlight?: boolean
}>(), { primary: false, working: false, reason: '', block: false, highlight: false })
const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <span class="civic-action">
    <BaseButton :variant="primary ? 'primary' : 'default'" :block="block" :class="{ 'is-highlight': highlight }" :disabled="working" :reason="working ? null : reason || null" :aria-busy="working || undefined" @click="emit('click')"><template v-if="working">Working…</template><slot v-else /></BaseButton>
    <small v-if="reason && !working" class="civic-why">{{ reason }}</small>
  </span>
</template>

<style scoped>
.civic-action { display: inline-grid; gap: 3px; justify-items: stretch; vertical-align: top; margin: 2px 6px 2px 0; }
.civic-action .is-highlight { background: var(--c-amber) !important; color: #3a2a00 !important; box-shadow: none !important; }
.civic-why { font-size: 12px; line-height: 1.35; color: var(--c-red); }
</style>
