<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ tier: number; grid: number }>()
const image = new URL('./house-catalogue.webp', import.meta.url).href
const tiers = [0, 1, 2, 4, 5]
const cell = computed(() => tiers[Math.max(0, Math.min(tiers.length - 1, Math.floor(props.tier)))] ?? 0)
const style = computed(() => ({ backgroundImage: `url("${image}")`, backgroundPosition: `${cell.value % 3 * 50}% ${Math.floor(cell.value / 3) * 100}%` }))
</script>
<template><div class="house-art" role="img" :aria-label="`Home illustration. Game room: ${grid} by ${grid}.`" :style="style" /></template>
<style scoped>
.house-art { width: 100%; aspect-ratio: 1; background-size: 300% 200%; background-repeat: no-repeat; }
</style>
