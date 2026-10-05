<script setup lang="ts">
// "MAKE THIS LIFE YOURS" — settling in, in the full-screen character creator (CreatorApp.vue). It is
// OFFERED, never forced: a guest of the quick start is already playing, and this opens after their
// first reward, from the "Settle in" goal, and when they tap Home or Buy (the shell opens it with
// params.why). "Not now" closes it and play goes on. Nothing earned before settling in is lost;
// moving in is what creates the home, the rent-free starter house and the start cash.
// params: { nudge?: 'first-reward' | 'third-activity' | 'next-day', why?: 'home' | 'buy' }.
// A life that predates character creation never sees it.
import CreatorApp from './CreatorApp.vue'

defineProps<{ params?: unknown }>()
</script>

<template>
  <CreatorApp mode="settle" :params="params" />
</template>
