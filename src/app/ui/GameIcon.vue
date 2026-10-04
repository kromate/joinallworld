<script setup lang="ts">
// One mark from the game's icon set (src/ui/phone/icons.js): original inline SVG, 24×24, drawn in
// currentColor. The markup is the icon set's own static string, never anything a player typed.
import { computed } from 'vue'
import { iconSvg } from '../legacy/modules.ts'

const props = withDefaults(defineProps<{
  /** A mark's name ('bank', 'back', 'close', 'hunger', 'menu', 'chevron-down' …). An unknown name draws the "info" mark. */
  name: string
  /** Width and height in CSS pixels. */
  size?: number
  /** Leave the size to the surrounding styles (the Phone's chrome sizes its own marks). */
  bare?: boolean
}>(), { size: 20, bare: false })
const svg = computed(() => iconSvg(props.name))
</script>

<template>
  <span class="game-icon" :class="{ 'is-bare': bare }" aria-hidden="true" :style="bare ? undefined : { '--icon': `${size}px` }" v-html="svg" />
</template>

<style scoped>
.game-icon { display: inline-grid; place-items: center; flex: none; width: var(--icon); height: var(--icon); }
.game-icon:not(.is-bare) :deep(svg) { display: block; width: var(--icon); height: var(--icon); }
.game-icon.is-bare { display: contents; }
</style>
