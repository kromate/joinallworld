<script setup lang="ts">
// The coloured card at the top of an app: a small label, one big figure, a line of context.
// It takes the app's tint from --app-tint (set by the Phone for the app in front).
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
.hero-card { --hero: var(--app-tint, var(--c-green-dark)); display: grid; gap: 2px; margin: 0 0 var(--s-3); padding: 16px 18px; border-radius: var(--r-lg); background: linear-gradient(150deg, color-mix(in srgb, var(--hero) 86%, #fff), var(--hero) 55%, color-mix(in srgb, var(--hero) 78%, #000)); color: #fff; box-shadow: var(--e-1); }
.hero-card > small { font-size: 12px; font-weight: 600; opacity: .88; }
.hero-card > strong { font-size: var(--t-display); font-weight: 700; line-height: 1.15; letter-spacing: -.2px; font-variant-numeric: tabular-nums; }
.hero-card-note { margin-top: 4px; font-size: 12.5px; line-height: 1.4; opacity: .92; }
</style>
