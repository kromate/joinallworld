<script setup lang="ts">
import { computed } from 'vue'
import { PHONE_ART, PHONE_ART_COLUMNS, PHONE_ART_X, PHONE_ART_Y } from '../../../ui/phone/appArtwork.ts'

const props = defineProps<{ app: string }>()
const atlas = new URL('../../../ui/phone/app-icons.webp', import.meta.url).href
const style = computed(() => {
  const found = PHONE_ART.indexOf(props.app === 'person' ? 'contacts' : props.app)
  const index = found < 0 ? PHONE_ART.indexOf('settings') : found
  const column = index % PHONE_ART_COLUMNS
  const row = Math.floor(index / PHONE_ART_COLUMNS)
  const x = PHONE_ART_X[column]! + 2
  const y = PHONE_ART_Y[row]! + 2
  const width = PHONE_ART_X[column + 1]! - x - 2
  const height = PHONE_ART_Y[row + 1]! - y - 2
  return {
    backgroundImage: `url("${atlas}")`,
    backgroundSize: `${1355 / width * 100}% ${1161 / height * 100}%`,
    backgroundPosition: `${x / (1355 - width) * 100}% ${y / (1161 - height) * 100}%`,
  }
})
</script>

<template>
  <span class="ph-icon ph-artwork" :style="style" aria-hidden="true" />
</template>
