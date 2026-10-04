<script setup lang="ts">
// One button of the Campus app and, under it, the one reason it cannot be pressed.
defineProps<{ label: string; reason?: string; primary?: boolean }>()
const emit = defineEmits<{ press: [] }>()
</script>

<template>
  <span class="campus-control">
    <button type="button" class="ui-button" :class="{ 'is-primary': primary }" :disabled="Boolean(reason)" :title="reason || undefined" @click="emit('press')">{{ label }}</button>
    <small v-if="reason">{{ reason }}</small>
  </span>
</template>
