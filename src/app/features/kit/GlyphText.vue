<script setup lang="ts">
// A line of text in which every emoji is drawn as the game's own glyph (the existing withGlyphs):
// content such as "+₦500 +1✨" carries an emoji as plain text, and nothing on screen shows the
// emoji itself. Text marks (→ · − ₦) and emoji without a glyph are left as they are.
import { computed } from 'vue'
import { glyphNameFor } from '../../legacy/modules.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { glyphParts } from './glyphText.ts'

const props = defineProps<{ text: string | null | undefined }>()
const parts = computed(() => glyphParts(props.text, (emoji) => glyphNameFor('', null, emoji) !== 'info'))
</script>

<template>
  <template v-for="(part, index) in parts" :key="index"><GameIcon v-if="part.emoji" inline kind="" :emoji="part.emoji" /><template v-else>{{ part.text }}</template></template>
</template>
