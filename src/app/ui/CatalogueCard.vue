<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; selected?: boolean }>()
</script>
<template>
  <article class="catalogue-card" :class="{ 'is-selected': selected }">
    <div v-if="$slots.media" class="catalogue-media"><slot name="media" /></div>
    <div class="catalogue-body">
      <header class="catalogue-heading"><div><h3>{{ title }}</h3><p v-if="subtitle">{{ subtitle }}</p></div><slot name="status" /></header>
      <slot />
      <div v-if="$slots.actions" class="catalogue-actions"><slot name="actions" /></div>
      <div v-if="$slots.note" class="catalogue-note"><slot name="note" /></div>
    </div>
  </article>
</template>
<style scoped>
.catalogue-card { min-width: 0; overflow: hidden; border: 1px solid var(--c-line); border-radius: 16px; background: #fff; }
.catalogue-card.is-selected { border-color: #176347; }
.catalogue-media { overflow: hidden; background: #edf1f5; }
.catalogue-body { display: grid; gap: 16px; padding: 18px; }
.catalogue-heading { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px; overflow-wrap: anywhere; }
.catalogue-heading > div { flex: 1 1 160px; min-width: 0; }
.catalogue-heading h3 { margin: 0; font-size: 20px; font-weight: 750; line-height: 1.25; letter-spacing: -.02em; color: var(--c-ink); }
.catalogue-heading p { margin: 5px 0 0; font-size: 14px; line-height: 1.45; color: var(--c-muted); }
.catalogue-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.catalogue-actions > :deep(*) { flex: 1 1 140px; }
.catalogue-note { font-size: 13px; line-height: 1.45; color: var(--c-muted); }
.catalogue-note :deep(p) { margin: 0; }
</style>
