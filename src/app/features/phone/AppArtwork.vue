<script setup lang="ts">
import { computed } from 'vue'
import { PHONE_ART, PHONE_ART_COLUMNS, PHONE_ART_ROWS } from '../../../ui/phone/appArtwork.ts'

const props = defineProps<{ app: string }>()
const atlas = new URL('../../../ui/phone/app-icons.webp', import.meta.url).href
const style = computed(() => {
  const found = PHONE_ART.indexOf(props.app)
  const index = found < 0 ? PHONE_ART.indexOf('settings') : found
  return {
    backgroundImage: `url("${atlas}")`,
    backgroundSize: `${PHONE_ART_COLUMNS * 100}% ${PHONE_ART_ROWS * 100}%`,
    backgroundPosition: `${index % PHONE_ART_COLUMNS / (PHONE_ART_COLUMNS - 1) * 100}% ${Math.floor(index / PHONE_ART_COLUMNS) / (PHONE_ART_ROWS - 1) * 100}%`,
  }
})
</script>

<template>
  <span class="ph-icon ph-artwork" :style="style" aria-hidden="true" />
</template>
