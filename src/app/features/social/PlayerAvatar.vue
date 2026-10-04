<script setup lang="ts">
// A player's lettered avatar on a colour derived from their id, with an optional presence dot.
// The same markup as the existing `avatar()` helper, so the existing social styles apply.
import '../../../ui/panels/social.css'
import { computed } from 'vue'
import { hueOf, initialOf } from '../../ui/format.ts'
import { dotHint, dotOf } from './socialModel.ts'

const props = defineProps<{
  name: string
  /** What the colour comes from; defaults to the name. */
  seed?: string
  /** A presence word ('online', 'away' …): draws its dot. Absent = no dot. */
  status?: string
}>()
const hue = computed(() => hueOf(props.seed ?? props.name))
</script>

<template>
  <span class="ui-avatar" aria-hidden="true" :style="{ '--hue': hue }">{{ initialOf(name) }}<i v-if="status" class="social-dot" :class="`is-${dotOf(status)}`" :title="dotHint(status)" /></span>
</template>
