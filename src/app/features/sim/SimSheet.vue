<script setup lang="ts">
// The Sim sheet: who you are (name, mood, the strongest feeling) and one tab per 'sim-tab' panel —
// Profile, Needs, Skills, People, Career, Settings. Tabs are panels of either kind.
import { computed, nextTick, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import PanelHost from '../phone/PanelHost.vue'
import { moodOf } from '../hud/hudModel.ts'

const props = defineProps<{ tab: string; params?: unknown }>()
const { game, shell } = useApp()
const tabs = shell.placed('sim-tab')
const current = computed(() => tabs.find((panel) => panel.id === props.tab) ?? tabs[0])
const mood = computed(() => moodOf(game.view.value))
const feeling = computed(() => game.view.value.needs?.feelings?.[0])

const row = ref<HTMLElement | null>(null)
// The selected tab is always in view, even the last one of the row.
watch(() => current.value?.id, () => {
  void nextTick(() => {
    const box = row.value, chosen = box?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (box && chosen) box.scrollLeft = Math.max(0, chosen.offsetLeft - (box.clientWidth - chosen.offsetWidth) / 2)
  })
}, { immediate: true })
/** Left and right move between tabs, as a tab list should. */
function onArrow(event: KeyboardEvent, index: number): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  const next = tabs[(index + step + tabs.length) % tabs.length]
  if (!step || !next) return
  event.preventDefault(); event.stopPropagation()
  shell.open('sim', { tab: next.id })
  void nextTick(() => row.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}
</script>

<template>
  <header class="sheet-head sim-head">
    <span class="sim-avatar" aria-hidden="true"><GameIcon inline name="person" /></span>
    <div><h2>{{ game.state.value.name }}</h2><p>{{ mood.word }}<template v-if="feeling"> · {{ feeling.label }}</template></p></div>
  </header>
  <div ref="row" class="sim-tabs" role="tablist" aria-label="Your character">
    <button v-for="(panel, index) in tabs" :id="`sim-tab-${panel.id}`" :key="panel.id" role="tab" type="button" :aria-selected="panel === current" :tabindex="panel === current ? 0 : -1" :class="{ 'is-selected': panel === current }" @click="shell.open('sim', { tab: panel.id })" @keydown="onArrow($event, index)">{{ panel.title }}</button>
  </div>
  <PanelHost v-if="current" :key="current.id" class="sheet-body" role="tabpanel" :aria-labelledby="`sim-tab-${current.id}`" :panel="current" :params="params" />
</template>
