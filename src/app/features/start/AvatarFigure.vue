<script setup lang="ts">
// The flat standing figure of a look: what the preview stage shows until the 3D canvas has
// arrived, and instead of it when WebGL is not available. Drawn from shapes (lookModel.ts), never
// from markup.
import { computed } from 'vue'
import type { Look } from '../../../types/life.ts'
import { avatarShapes } from './lookModel.ts'

const props = withDefaults(defineProps<{
  look: Look
  /** Width in CSS pixels. */
  size?: number
  /** The text alternative; '' draws the figure as decoration. */
  label?: string
}>(), { size: 150, label: 'Preview of your Sim' })
const shapes = computed(() => avatarShapes(props.look))
</script>

<template>
  <svg class="look-avatar" role="img" :aria-label="label" viewBox="0 0 120 190" :width="size" :height="Math.round(size * 190 / 120)">
    <component :is="shape.tag" v-for="(shape, index) in shapes" :key="index" v-bind="shape.attrs" />
  </svg>
</template>
