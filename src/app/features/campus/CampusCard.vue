<script setup lang="ts">
// A card of the Campus app: a drawn mark, a heading, the body and, below it, the controls.
import GameIcon from '../../ui/GameIcon.vue'
import { markOf } from './campusModel.ts'

defineProps<{ icon: string; heading: string }>()
</script>

<template>
  <article class="campus-card">
    <div class="campus-card-head"><span aria-hidden="true"><GameIcon inline :name="markOf(icon)" /></span><h3>{{ heading }}</h3></div>
    <slot />
    <slot name="extra" />
  </article>
</template>
