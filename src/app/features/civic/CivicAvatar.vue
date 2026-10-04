<script setup lang="ts">
// A round avatar with the first letter of a name, on a colour derived from `seed` (a player id) so
// one person keeps one colour. The slot is for a presence dot.
import { computed } from 'vue'
import { hueOf, initialOf } from '../../ui/format.ts'

const props = defineProps<{ name: string; seed?: string }>()
const hue = computed(() => hueOf(props.seed ?? props.name))
</script>

<template>
  <span class="ui-avatar" aria-hidden="true" :style="{ '--hue': hue }">{{ initialOf(name) }}<slot /></span>
</template>
