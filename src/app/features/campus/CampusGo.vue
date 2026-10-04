<script setup lang="ts">
// "Walk here": closes the Phone and goes to a landmark of the campus.
import { title } from './campusModel.ts'
import { useCampus } from './useCampus.ts'

const props = defineProps<{ spot: string; label?: string }>()
const { go } = useCampus()
</script>

<template>
  <button type="button" class="ui-button campus-go" @click="go(props.spot)">{{ label ?? `Go to ${title(spot)}` }}</button>
</template>
