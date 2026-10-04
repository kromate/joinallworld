<script setup lang="ts">
// The drawing at the top of a car card: a silhouette by kind (bike, saloon, SUV, coupé) in a colour of its own, on a road.
import { computed } from 'vue'
import { carArt } from './artModel.ts'

const props = defineProps<{ id: string; label: string; index: number }>()
const art = computed(() => carArt(props.id, props.index))
</script>

<template>
  <svg class="cars-art" viewBox="0 0 320 96" preserveAspectRatio="xMidYMid slice" role="img" :aria-label="`A drawing of the ${label}`">
    <rect width="320" height="96" :fill="`color-mix(in srgb, ${art.paint} 14%, #eef2f5)`" />
    <path d="M0 62h60M250 50h70M20 40h34" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".8" />
    <rect y="78" width="320" height="18" fill="#2b3038" />
    <path d="M0 87h320" stroke="#ffffff" stroke-width="2" stroke-dasharray="18 14" opacity=".5" />
    <template v-for="(part, index) in art.body" :key="index">
      <path v-if="part.stroke" :d="part.d" fill="none" :stroke="part.stroke" :stroke-width="part.strokeWidth" stroke-linecap="round" stroke-linejoin="round" />
      <path v-else :d="part.d" :fill="part.fill" />
    </template>
    <rect v-if="art.seat" x="138" y="40" width="34" height="9" rx="4.5" fill="#15181d" />
    <g v-for="wheel in art.wheels" :key="wheel.x"><circle :cx="wheel.x" cy="74" :r="wheel.r" fill="#15181d" /><circle :cx="wheel.x" cy="74" :r="wheel.r * 0.45" fill="#cfd5db" /></g>
  </svg>
</template>
