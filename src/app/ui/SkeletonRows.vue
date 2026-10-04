<script setup lang="ts">
// What a screen shows while its code or its data is on the way: grey bars in the shape of the
// content, never a spinner page. Nothing here animates.
withDefaults(defineProps<{ rows?: number; label?: string }>(), { rows: 3, label: 'Loading' })
</script>

<template>
  <div class="skeleton-rows" role="status" :aria-label="label"><i class="is-hero" /><i v-for="row in rows" :key="row" /></div>
</template>

<style scoped>
.skeleton-rows { display: grid; gap: 10px; padding: 4px 0; }
.skeleton-rows i { display: block; height: 52px; border-radius: var(--r-md); background: var(--c-fill); }
.skeleton-rows i.is-hero { height: 92px; border-radius: var(--r-lg); background: var(--c-fill-2); }
</style>
