<script setup lang="ts">
// A tiny trend line for a tile: the last days of one number, drawn in plain SVG. A day that was not measured is a gap, never a zero.
import { computed } from 'vue'
import { describe, linePath, niceMax, yAt, xAt } from './chartModel.ts'

const props = withDefaults(defineProps<{ values: readonly (number | null)[]; labels?: readonly string[]; name: string; color?: string }>(), { labels: () => [], color: '#1f6f43' })
const box = { width: 120, height: 34, left: 3, right: 4, top: 4, bottom: 4 }
const top = computed(() => niceMax(Math.max(0, ...props.values.map((value) => value ?? 0))))
const path = computed(() => linePath(box, props.values, top.value))
const last = computed(() => { for (let i = props.values.length - 1; i >= 0; i--) { const value = props.values[i]; if (value !== null && value !== undefined) return { x: xAt(box, i, props.values.length), y: yAt(box, value, top.value) } } return null })
const label = computed(() => describe(props.name, props.labels.length ? props.labels : props.values.map((_, i) => `day ${i + 1}`), props.values))
</script>

<template>
  <svg class="adm-spark" :viewBox="`0 0 ${box.width} ${box.height}`" role="img" :aria-label="label" preserveAspectRatio="none">
    <title>{{ label }}</title>
    <path v-if="path" :d="path" fill="none" :stroke="color" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
    <path v-if="last" :d="`M${last.x.toFixed(1)} ${last.y.toFixed(1)}h0`" :stroke="color" stroke-width="7" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
</template>
