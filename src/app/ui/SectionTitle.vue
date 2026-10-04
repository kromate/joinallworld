<script setup lang="ts">
// A section title inside an app: small, quiet, above a card or a list. `note` sits at the far end.
withDefaults(defineProps<{ note?: string }>(), { note: '' })
</script>

<template>
  <h3 class="section-title"><span><slot /></span><small v-if="note">{{ note }}</small><slot name="end" /></h3>
</template>

<style scoped>
/* !important because the sheet's own heading rule (#life-dialog .sheet-body h3) outranks a scoped class until that sheet is converted. */
.section-title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: var(--s-4) 4px var(--s-2) !important; font-size: 12px !important; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--c-muted); }
.section-title small { font-size: 11px; font-weight: 600; letter-spacing: 0; text-transform: none; }
</style>
