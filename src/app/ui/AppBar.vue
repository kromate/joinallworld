<script setup lang="ts">
// The bar at the top of a sheet: an optional back button, the title, and room at the end for the
// sheet's own controls. It stays in view while the sheet scrolls.
import GameIcon from './GameIcon.vue'

withDefaults(defineProps<{
  title: string
  sub?: string
  /** Show the back button, with this label for screen readers. */
  back?: string | null
}>(), { sub: '', back: null })
defineEmits<{ back: [] }>()
</script>

<template>
  <header class="app-bar">
    <button v-if="back" class="app-bar-back" type="button" :aria-label="back" @click="$emit('back')"><GameIcon name="back" /></button>
    <slot name="start" />
    <div class="app-bar-title"><h2>{{ title }}</h2><span v-if="sub">{{ sub }}</span></div>
    <slot />
  </header>
</template>

<style scoped>
.app-bar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: var(--s-2); min-height: 62px; margin: 0 calc(-1 * var(--sheet-pad, 20px)) var(--s-3); padding: 9px 62px 9px var(--sheet-pad, 20px); background: #fffffff2; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border-bottom: 1px solid var(--c-line); }
.app-bar-title { min-width: 0; }
.app-bar-title h2 { margin: 0; font-size: var(--t-title); font-weight: 700; line-height: 1.2; letter-spacing: -.2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-bar-title span { display: block; margin-top: 1px; font-size: 12px; line-height: 1.3; color: var(--c-muted); }
.app-bar-back { flex: none; display: grid; place-items: center; width: var(--tap); height: var(--tap); margin-left: -8px; border: 0; border-radius: var(--r-round); background: var(--c-fill); color: var(--c-ink); cursor: pointer; }
.app-bar-back:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
