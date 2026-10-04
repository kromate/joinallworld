<script setup lang="ts">
// The one-tap way out of a refusal, as a button: Reconnect, Cancel that trip, Go inside, Trek
// instead. What it does is the shell's own handling of the same buttons (useTravelActions.ts); the
// free way (`mode`) is the venue card's to choose, so it is handed up.
import type { Fix } from './travelModel.ts'
import { useTravelActions } from './useTravelActions.ts'

const props = defineProps<{ fix: Fix; /** The look: 'map-fix' on the venue card, 'ride-fix' in the Ride app, 'map-chip-button' beside a map layer. */ look: string }>()
const emit = defineEmits<{ mode: [mode: string] }>()
const { runFix } = useTravelActions()
const press = (): void => { if (props.fix.kind === 'mode') emit('mode', props.fix.mode); else runFix(props.fix) }
</script>

<template>
  <button type="button" :class="look" @click="press">{{ fix.label }}</button>
</template>
