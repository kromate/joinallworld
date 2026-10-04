<script setup lang="ts">
// A 0–100 meter. With a label it is a full row (label · bar · number); `compact` is the slim bar
// of the needs strip, where the icon beside it is the label. Below `low` it turns amber.
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  label: string
  value: number
  low?: number
  compact?: boolean
}>(), { low: 35, compact: false })
const shown = computed(() => Math.round(props.value))
const width = computed(() => `${Math.max(0, Math.min(100, props.value))}%`)
</script>

<template>
  <div class="base-meter" :class="{ 'is-low': value < low, 'is-compact': compact }">
    <span v-if="!compact" class="base-meter-label">{{ label }}</span>
    <div class="base-meter-track" role="meter" :aria-label="label" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="shown"><i :style="{ width }" /></div>
    <b v-if="!compact">{{ shown }}</b>
  </div>
</template>

<style scoped>
.base-meter { display: flex; align-items: center; gap: 12px; margin: 12px 0; font-size: 13px; }
.base-meter-label { min-width: 110px; }
.base-meter-track { flex: 1; height: 8px; border-radius: 8px; background: var(--c-fill-2); overflow: hidden; }
.base-meter-track i { display: block; height: 100%; border-radius: 8px; background: var(--c-green); transition: width var(--ease); }
.base-meter.is-low .base-meter-track i { background: #d9822b; }
.base-meter b { width: 28px; text-align: right; }
.base-meter.is-compact { flex: 1; min-width: 10px; margin: 0; gap: 0; }
.base-meter.is-compact .base-meter-track { height: 6px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) { .base-meter-track i { transition: none; } }
</style>
