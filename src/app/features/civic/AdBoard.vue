<script setup lang="ts">
// One ad as it is drawn on a billboard: its colour, its icon and its text. The text is a player's,
// so it is only ever interpolated, never markup.
import { computed } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import { AD_COLOURS, AD_ICONS } from './civicContent.ts'
import { colourOf } from './civicModel.ts'

const props = defineProps<{ colour: string; icon: string; text: string }>()
const palette = computed(() => colourOf(AD_COLOURS, props.colour))
/** An ad's icon is one of AD_ICONS, chosen by id; the content's emoji is only the fallback key of the icon set. */
const emoji = computed(() => AD_ICONS.find((item) => item.id === props.icon)?.icon)
</script>

<template>
  <div class="ads-preview" :style="{ background: palette.bg, color: palette.ink }"><span aria-hidden="true"><GameIcon kind="ad" :id="icon" :emoji="emoji" :size="22" /></span><span>{{ text }}</span></div>
</template>

<style scoped>
.ads-preview { display: flex; align-items: center; gap: 10px; border-radius: var(--r-sm); padding: 12px 14px; font-weight: 700; font-size: 14px; min-height: 48px; overflow-wrap: anywhere; box-shadow: inset 0 0 0 1px #0000001a; }
.ads-preview span:first-child { font-size: 22px; }
</style>
