<script setup lang="ts">
// A small line under stale data when the last refresh failed.
import type { CivicEntry } from './civicCore.ts'

defineProps<{ item: CivicEntry }>()
</script>

<template>
  <p v-if="item.data && item.error" class="civic-stale" role="alert">Could not refresh: {{ item.error }} Showing the last loaded copy.</p>
</template>

<style scoped>
.civic-stale { margin: var(--s-2) 2px; font-size: 12px; line-height: 1.45; color: var(--c-red); }
</style>
