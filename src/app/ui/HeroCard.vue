<script setup lang="ts">
// A readable app summary: context, a headline or amount, and supporting information.
defineProps<{ label: string; figure: string }>()
</script>

<template>
  <section class="hero-card" :aria-label="label">
    <small>{{ label }}</small>
    <strong>{{ figure }}</strong>
    <div v-if="$slots.default" class="hero-card-note"><slot /></div>
  </section>
</template>

<style scoped>
.hero-card { display: grid; gap: 6px; margin: 0 0 20px; padding: 8px 2px 16px; background: none; color: var(--c-ink); border-bottom: 1px solid var(--c-line); }
.hero-card > small { font-size: 14px; font-weight: 600; color: var(--c-muted); }
.hero-card > strong { font-size: 30px; font-weight: 750; line-height: 1.15; letter-spacing: -.025em; font-variant-numeric: tabular-nums; }
.hero-card-note { margin-top: 2px; font-size: 14px; line-height: 1.5; color: var(--c-ink-2); }
</style>
