<script setup lang="ts">
// The needs strip: the six needs as slim bars, each with its icon. A gain, or a sharp drop, is
// highlighted once; the slow decay is not. The values are the server's (state.needs); the order
// is the view's.
import { computed, ref, watch } from 'vue'
import type { NeedId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import BaseMeter from '../../ui/BaseMeter.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { cap } from '../../ui/format.ts'
import { needFlash } from './hudModel.ts'

const { game } = useApp()
const needs = computed(() => game.view.value.needs.order.map((id) => ({ id, label: cap(id), value: Math.round(game.state.value.needs[id]) })))
/** Per need: which way it last jumped, and a counter that restarts the highlight. */
const flashes = ref<Partial<Record<NeedId, { way: 'up' | 'down'; run: number }>>>({})
let last: Partial<Record<NeedId, number>> | null = null
let lastLife = ''
watch(needs, (now) => {
  const life = `${game.session.value?.id ?? ''}:${game.cityId.value}`
  if (life !== lastLife) { lastLife = life; last = null }
  const next: Partial<Record<NeedId, number>> = {}
  for (const need of now) {
    next[need.id] = need.value
    const way = needFlash(last?.[need.id], need.value)
    if (way) flashes.value = { ...flashes.value, [need.id]: { way, run: (flashes.value[need.id]?.run ?? 0) + 1 } }
  }
  last = next
}, { immediate: true })
</script>

<template>
  <div class="needs-strip" role="group" aria-label="Your needs">
    <div v-for="need in needs" :key="`${need.id}:${flashes[need.id]?.run ?? 0}`" class="need" :class="[flashes[need.id] ? `is-${flashes[need.id]?.way}` : undefined, { 'is-low': need.value < 35 }]" :title="need.label">
      <GameIcon :name="need.id" :size="15" />
      <BaseMeter compact :label="need.label" :value="need.value" />
    </div>
  </div>
</template>

<style scoped>
.needs-strip { flex: 1; min-width: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px 10px; padding: 10px 12px; background: var(--c-surface); border: 1px solid #fff; border-radius: var(--r-lg); box-shadow: var(--e-2); pointer-events: auto; }
.need { display: flex; align-items: center; gap: 5px; min-width: 0; border-radius: 8px; color: var(--c-ink-2); }
.need.is-low { color: #b5601a; }
.need.is-up { animation: need-up 1.2s ease-out; }
.need.is-down { animation: need-down 1.2s ease-out; }
@keyframes need-up { 0%, 35% { box-shadow: 0 0 0 3px #bfe5cd; background: #bfe5cd; } 100% { box-shadow: 0 0 0 0 transparent; background: transparent; } }
@keyframes need-down { 0%, 35% { box-shadow: 0 0 0 3px #f6d9b8; background: #f6d9b8; } 100% { box-shadow: 0 0 0 0 transparent; background: transparent; } }
@media (max-width: 720px) {
  .needs-strip { grid-template-columns: repeat(6, 1fr); gap: 6px; height: 38px; align-items: center; padding: 0 12px; border-radius: var(--r-pill); }
}
@media (prefers-reduced-motion: reduce) { .need.is-up, .need.is-down { animation: none; } }
</style>
