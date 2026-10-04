<script setup lang="ts">
// A small drawing of a house from its style: the same few numbers the maps draw from. With
// `scaffold` the poles of an upgrade in progress stand around it.
import { computed } from 'vue'
import type { HouseStyle, HouseTierId } from '../../../types/life.ts'
import { houseArtShape } from './worldModel.ts'

const props = withDefaults(defineProps<{ look: HouseStyle; tier?: HouseTierId; scaffold?: boolean }>(), { tier: 'starter', scaffold: false })
const shape = computed(() => houseArtShape(props.look, props.tier, props.scaffold))
</script>

<template>
  <svg class="world-house" viewBox="0 0 220 120" role="img" :aria-label="shape.label">
    <rect width="220" height="120" rx="14" fill="#dff0d6" />
    <rect y="108" width="220" height="12" fill="#bcd596" />
    <template v-if="shape.yard.kind === 'plant'">
      <circle cx="186" :cy="shape.yard.cy" :r="shape.yard.r" :fill="shape.yard.fill" />
      <rect x="184" y="92" width="4" height="20" fill="#6b4a2b" />
    </template>
    <rect v-else-if="shape.yard.kind === 'block'" x="174" y="90" width="24" height="22" rx="3" :fill="shape.yard.fill" />
    <rect :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" :fill="shape.wall" />
    <rect v-if="shape.top.kind === 'rect'" :x="shape.top.x" :y="shape.top.y" :width="shape.top.width" :height="shape.top.height" rx="2" :fill="shape.roof" />
    <path v-else :d="shape.top.d" :fill="shape.roof" />
    <rect v-for="wx in shape.windowXs" :key="wx" :x="wx" :y="shape.y + 12" width="16" height="14" rx="2" :fill="shape.windows" />
    <rect x="102" y="86" width="16" height="26" rx="2" :fill="shape.door" />
    <rect v-if="shape.fence" x="14" y="98" width="192" height="14" rx="2" :fill="shape.fence" fill-opacity=".9" />
    <g v-if="shape.poles" stroke="#c9a35a" stroke-width="3" fill="none">
      <path v-for="px in shape.poles.xs" :key="px" :d="`M${px} 112V${shape.poles.top}`" />
      <path :d="shape.poles.rails" />
    </g>
  </svg>
</template>

<style scoped>
.world-house { display: block; width: 100%; max-width: 220px; height: auto; margin: 0 auto; }
</style>
