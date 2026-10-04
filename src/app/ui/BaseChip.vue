<script setup lang="ts">
// A small status label: "Up to date", "At risk", "Overdue".
withDefaults(defineProps<{ tone?: 'neutral' | 'good' | 'warn' | 'bad' }>(), { tone: 'neutral' })
</script>

<template>
  <span class="base-chip" :class="`is-${tone}`"><slot /></span>
</template>

<style scoped>
.base-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: var(--r-pill); background: var(--c-fill); font-size: 11px; font-weight: 700; line-height: 1.4; white-space: nowrap; color: var(--c-ink-2); }
.base-chip.is-good { background: var(--c-green-soft); color: var(--c-green-dark); }
.base-chip.is-warn { background: var(--c-amber-soft); color: var(--c-amber-dark); }
.base-chip.is-bad { background: var(--c-red-soft); color: var(--c-red-dark); }
</style>
