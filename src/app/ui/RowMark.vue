<script setup lang="ts">
// The leading mark of a row: an icon on a soft square or circle, or a letter avatar on a colour
// derived from an id (so one person keeps one colour).
import { computed } from 'vue'
import { hueOf, initialOf } from './format.ts'

const props = withDefaults(defineProps<{
  /** A name: draws its first letter as an avatar. Without it the slot is shown. */
  name?: string
  /** What the avatar colour is derived from (a player id). Defaults to the name. */
  seed?: string
  round?: boolean
  tone?: 'neutral' | 'in' | 'out'
}>(), { name: undefined, seed: undefined, round: false, tone: 'neutral' })
const hue = computed(() => hueOf(props.seed ?? props.name))
</script>

<template>
  <span v-if="name !== undefined" class="row-mark is-avatar" aria-hidden="true" :style="{ '--hue': hue }">{{ initialOf(name) }}</span>
  <span v-else class="row-mark" :class="[`is-${tone}`, { 'is-round': round }]" aria-hidden="true"><slot /></span>
</template>

<style scoped>
.row-mark { flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: var(--c-fill); font-size: 19px; line-height: 1; }
.row-mark.is-round { border-radius: 50%; }
.row-mark.is-in { background: var(--c-green-soft); color: var(--c-green-dark); }
.row-mark.is-out { background: var(--c-red-soft); color: var(--c-red); }
.row-mark.is-avatar { border-radius: 50%; background: hsl(var(--hue) 46% 86%); color: hsl(var(--hue) 48% 26%); font-size: 16px; font-weight: 700; }
</style>
