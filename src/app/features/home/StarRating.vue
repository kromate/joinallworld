<script setup lang="ts">
// A star rating drawn with the star glyph: `count` filled stars, or nothing for none.
import GameIcon from '../../ui/GameIcon.vue'
import { starsLabel } from './buyModel.ts'

defineProps<{ count: number }>()
</script>

<template>
  <span v-if="count" class="buy-star" role="img" :aria-label="starsLabel(count)"><GameIcon v-for="n in count" :key="n" inline name="star" /></span>
</template>
