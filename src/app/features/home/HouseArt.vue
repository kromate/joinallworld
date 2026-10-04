<script setup lang="ts">
// The drawing at the top of a house card: a building that grows with its tier, under a later sky.
import { computed } from 'vue'
import { houseArt, palmPaths } from './artModel.ts'

const props = defineProps<{ tier: number; grid: number }>()
const art = computed(() => houseArt(props.tier))
const palms = computed(() => art.value.palms.map((x) => ({ x, ...palmPaths(x) })))
</script>

<template>
  <svg class="houses-art" viewBox="0 0 320 104" preserveAspectRatio="xMidYMid slice" role="img" :aria-label="`A drawing of a ${grid} by ${grid} home`">
    <defs><linearGradient :id="`houses-sky-${tier}`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" :stop-color="art.sky[0]" /><stop offset="1" :stop-color="art.sky[1]" /></linearGradient></defs>
    <rect width="320" height="104" :fill="`url(#houses-sky-${tier})`" />
    <circle cx="262" cy="26" r="13" :fill="art.sun" fill-opacity=".9" />
    <rect y="92" width="320" height="12" fill="#00000026" />
    <g v-for="palm in palms" :key="palm.x"><path :d="palm.trunk" stroke="#6b4a2b" stroke-width="3" stroke-linecap="round" /><path :d="palm.leaves" fill="#2f8f55" /></g>
    <rect v-bind="art.wall" rx="3" />
    <path v-if="art.roof.kind === 'pitched'" :d="art.roof.d" fill="#b5533a" />
    <rect v-else :x="art.roof.x" :y="art.roof.y" :width="art.roof.width" height="6" rx="2" fill="#e9eef2" />
    <rect v-for="(pane, index) in art.panes" :key="index" :x="pane.x" :y="pane.y" :width="pane.width" :height="pane.height" :rx="pane.door ? 1.5 : 1.5" :fill="pane.fill" :fill-opacity="pane.opacity" />
  </svg>
</template>
