<script setup lang="ts">
// The closeness bar: points towards the next tier. A meter for assistive technology.
import '../../../ui/panels/social.css'
import { computed } from 'vue'
import { meterPercent } from './socialModel.ts'

const props = defineProps<{ points: number; max: number; label: string }>()
const width = computed(() => `${meterPercent(props.points, props.max)}%`)
</script>

<template>
  <div class="social-meter" role="meter" :aria-label="label" aria-valuemin="0" :aria-valuemax="max" :aria-valuenow="Math.floor(points)"><i :style="{ width }" /></div>
</template>
