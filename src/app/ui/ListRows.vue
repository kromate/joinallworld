<script setup lang="ts">
// The card a list's rows share.
withDefaults(defineProps<{ as?: 'div' | 'ul'; label?: string }>(), { as: 'div', label: undefined })
</script>

<template>
  <component :is="as" class="list-rows" :aria-label="label"><slot /></component>
</template>

<style scoped>
.list-rows { list-style: none; margin: 0 0 var(--s-2); padding: 0; border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); overflow: hidden; }
</style>
