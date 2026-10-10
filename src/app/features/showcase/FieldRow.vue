<script setup lang="ts">
// One labelled field of the editor: the label, optional help text, the input (given in the slot with the attributes it must carry),
// and the refusal for this field right beside it. The input is tied to both by aria-describedby and marked invalid.
import { computed } from 'vue'

const props = defineProps<{ field: string; label: string; hint?: string; error?: string }>()
const id = computed(() => `se-f-${props.field}`)
const described = computed(() => [props.hint ? `se-h-${props.field}` : '', props.error ? `se-e-${props.field}` : ''].filter(Boolean).join(' ') || undefined)
</script>

<template>
  <div class="fr" :class="{ 'has-error': error }">
    <label :for="id">{{ label }}</label>
    <slot :id="id" :aria-invalid="error ? 'true' : undefined" :aria-describedby="described" />
    <p v-if="hint" :id="`se-h-${field}`" class="fr-hint">{{ hint }}</p>
    <p v-if="error" :id="`se-e-${field}`" class="fr-error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.fr { display: grid; gap: 4px; min-width: 0; }
.fr label { font-size: var(--t-body); font-weight: 600; color: var(--c-ink); }
.fr-hint { margin: 0; font-size: var(--t-small); line-height: 1.4; color: var(--c-muted); }
.fr-error { margin: 0; font-size: var(--t-body); font-weight: 600; color: var(--c-red-dark); }
.fr.has-error :slotted(input), .fr.has-error :slotted(select), .fr.has-error :slotted(textarea) { border-color: var(--c-red); box-shadow: 0 0 0 1px var(--c-red); }
</style>
