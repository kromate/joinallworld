<script setup lang="ts">
import { computed } from 'vue'
import { CAR_ORDER } from '../../../game/content/cars.ts'
const props = defineProps<{ id: string; label: string; index: number }>()
const ids: readonly string[] = CAR_ORDER
const image = new URL('./car-catalogue.webp', import.meta.url).href
const cell = computed(() => Math.max(0, Math.min(8, ids.indexOf(props.id))))
const style = computed(() => ({ backgroundImage: `url("${image}")`, backgroundPosition: `${cell.value % 3 * 50}% ${Math.floor(cell.value / 3) * 50}%` }))
</script>
<template><div class="car-art" role="img" :aria-label="`A drawing of the ${label}, rendered in 3D`"><span :style="style" /></div></template>
<style scoped>
.car-art { position: relative; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; }
.car-art span { position: absolute; width: 100%; aspect-ratio: 1; top: 50%; left: 0; transform: translateY(-50%); background-size: 300% 300%; background-repeat: no-repeat; }
</style>
