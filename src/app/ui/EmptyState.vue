<script setup lang="ts">
// The one empty state every screen uses: what is missing, and the next step (the default slot
// takes the button). `compact` is the small, left-aligned form for an empty list inside a longer screen.
withDefaults(defineProps<{ emoji: string; title: string; text?: string; compact?: boolean }>(), { text: '', compact: false })
</script>

<template>
  <div class="empty-state" :class="{ 'is-compact': compact }">
    <span class="empty-state-art" aria-hidden="true">{{ emoji }}</span>
    <h3>{{ title }}</h3>
    <div v-if="text" class="empty-state-text">{{ text }}</div>
    <slot />
  </div>
</template>

<style scoped>
.empty-state { display: grid; justify-items: center; gap: 6px; padding: 28px 16px; text-align: center; color: var(--c-muted); }
.empty-state-art { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%; background: var(--c-fill); font-size: 26px; }
.empty-state h3 { margin: 4px 0 0; font-size: var(--t-lead); color: var(--c-ink); letter-spacing: -.1px; text-transform: none; }
.empty-state-text { max-width: 300px; font-size: 13px; line-height: 1.45; }
.empty-state.is-compact { grid-template-columns: auto minmax(0, 1fr); justify-items: start; column-gap: 12px; row-gap: 1px; padding: 12px 14px; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); text-align: left; }
.empty-state.is-compact .empty-state-art { grid-row: 1 / span 2; width: 38px; height: 38px; font-size: 19px; }
.empty-state.is-compact h3 { margin: 0; font-size: 14px; }
.empty-state.is-compact .empty-state-text { max-width: none; font-size: 12px; }
</style>
