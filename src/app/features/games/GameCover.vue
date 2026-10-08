<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ game: 'oro' | 'chess' | 'weave' | 'whot' | 'penalty' | 'ayo' }>()
const atlas = new URL('./game-covers.webp', import.meta.url).href
const slots = { oro: 0, chess: 1, weave: 2, whot: 3, penalty: 4, ayo: 5 }
const style = computed(() => ({ backgroundImage: `url("${atlas}")`, backgroundPosition: `${slots[props.game] % 3 * 50}% ${Math.floor(slots[props.game] / 3) * 100}%` }))
</script>
<template><span class="game-cover" :style="style" aria-hidden="true" /></template>
<style scoped>
.game-cover { display: block; width: 100%; aspect-ratio: 1; background-size: 300% 200%; background-repeat: no-repeat; border-radius: 14px; }
</style>
