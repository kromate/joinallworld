<script setup lang="ts">
// One mark from the game's icon set (src/ui/phone/icons.js): original inline SVG, 24×24, drawn in
// currentColor. The markup is the icon set's own static string, never anything a player typed.
import { computed } from 'vue'
import { glyphNameFor, iconSvg } from '../legacy/modules.ts'
import { glyphTick } from './glyphs.ts'

const props = withDefaults(defineProps<{
  /** A mark's name ('bank', 'back', 'close', 'hunger', 'menu', 'chevron-down' …). An unknown name draws the "info" mark. */
  name?: string
  /** Instead of a name: the kind of game content ('venue', 'spot', 'activity', 'mood' …), with its id and the emoji its content carries. */
  kind?: string
  id?: string | null
  emoji?: string | null
  /** Width and height in CSS pixels. */
  size?: number
  /** Leave the size to the surrounding styles (the Phone's chrome sizes its own marks). */
  bare?: boolean
  /** A mark inside a line of text: sized to the text around it (1.2em), like the existing `ui-glyph`. */
  inline?: boolean
}>(), { name: undefined, kind: undefined, id: undefined, emoji: undefined, size: 20, bare: false, inline: false })
const svg = computed(() => {
  // More of the icon set arrives with the Phone's code: a mark drawn as "info" until then is drawn again.
  void glyphTick.value
  return iconSvg(props.name ?? glyphNameFor(props.kind ?? '', props.id, props.emoji), props.inline ? 'ui-glyph' : undefined)
})
</script>

<template>
  <span class="game-icon" :class="{ 'is-bare': bare || inline }" aria-hidden="true" :style="bare || inline ? undefined : { '--icon': `${size}px` }" v-html="svg" />
</template>

<style scoped>
.game-icon { display: inline-grid; place-items: center; flex: none; width: var(--icon); height: var(--icon); }
.game-icon:not(.is-bare) :deep(svg) { display: block; width: var(--icon); height: var(--icon); }
.game-icon.is-bare { display: contents; }
</style>
