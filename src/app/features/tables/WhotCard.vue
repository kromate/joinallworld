<script setup lang="ts">
// One Whot card: a real button when it can be played (so the table works by keyboard), a labelled
// image otherwise, or the back of a card. The shape is the icon set's own mark; the number and the
// special's name are text.
import { computed } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import { SPECIAL, cardName } from './tablesBoundary.ts'
import type { WhotCardData } from './tablesBoundary.ts'

const props = withDefaults(defineProps<{
  item?: WhotCardData
  /** The back of a card (the market). */
  back?: boolean
  /** Make it a button; `playable` then decides whether it is enabled. */
  button?: boolean
  playable?: boolean
  small?: boolean
  dim?: boolean
}>(), { item: undefined, back: false, button: false, playable: false, small: false, dim: false })
defineEmits<{ pick: [] }>()

const whot = computed(() => props.item?.s === 'whot')
const special = computed(() => (props.item && !whot.value ? SPECIAL[props.item.n] ?? '' : ''))
const label = computed(() => (props.item ? `${cardName(props.item)}${special.value ? `, ${special.value}` : ''}` : ''))
const classes = computed(() => [`is-${props.item?.s}`, { 'is-small': props.small, 'is-dim': props.dim }])
</script>

<template>
  <span v-if="back" class="wh-card is-back" aria-hidden="true" />
  <button v-else-if="item && button" class="wh-card" :class="classes" type="button" :disabled="!playable" :aria-label="label" @click="$emit('pick')">
    <span class="wh-n">{{ whot ? '20' : item.n }}</span><span class="wh-s" aria-hidden="true"><b v-if="whot">WHOT</b><GameIcon v-else :name="item.s" inline /></span><small v-if="special">{{ special }}</small>
  </button>
  <span v-else-if="item" class="wh-card" :class="classes" role="img" :aria-label="label">
    <span class="wh-n">{{ whot ? '20' : item.n }}</span><span class="wh-s" aria-hidden="true"><b v-if="whot">WHOT</b><GameIcon v-else :name="item.s" inline /></span><small v-if="special">{{ special }}</small>
  </span>
</template>

<style scoped>
.wh-card { width: 58px; height: 82px; border-radius: 9px; background: #fff; color: #8f1d1d; border: 0; position: relative; display: grid; place-items: center; font: inherit; padding: 0; box-shadow: 0 2px 6px rgba(0, 0, 0, .28); flex: none; cursor: pointer; transition: transform .12s var(--ease, ease); }
.wh-card .wh-n { position: absolute; top: 4px; left: 6px; font-size: 15px; font-weight: 800; line-height: 1; }
.wh-card .wh-s :deep(svg) { width: 30px; height: 30px; }
.wh-card .wh-s b { font-size: 12px; letter-spacing: .5px; font-weight: 900; }
.wh-card small { position: absolute; bottom: 3px; left: 0; right: 0; text-align: center; font-size: 8px; line-height: 1; font-weight: 700; color: #5b6472; }
.wh-card.is-whot { background: #8f1d1d; color: #fff; }
.wh-card.is-back { background: repeating-linear-gradient(45deg, #b23a2e 0 6px, #8f1d1d 6px 12px); border: 2px solid #fff; cursor: default; }
.wh-card.is-small { width: 26px; height: 36px; border-radius: 5px; box-shadow: none; cursor: default; }
.wh-card.is-small .wh-n { font-size: 10px; top: 2px; left: 3px; }
.wh-card.is-small .wh-s :deep(svg) { width: 13px; height: 13px; }
.wh-card.is-small .wh-s b { font-size: 6px; }
.wh-card.is-small small { display: none; }
button.wh-card:not(:disabled) { outline: 3px solid #e8a643; transform: translateY(-6px); }
button.wh-card:disabled { cursor: default; }
.wh-card.is-dim { opacity: .55; }
button.wh-card:focus-visible { outline: 3px solid #fff; }
@media (prefers-reduced-motion: reduce) { button.wh-card:not(:disabled) { transform: none; } }
.ph.is-wide .wh-card { width: 68px; height: 96px; }
</style>
