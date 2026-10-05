<script setup lang="ts">
// The bottom nav: Home · Buy · Map · Phone. A tab that cannot be used yet stays tappable and says
// why, instead of being a dead button.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { isTrip } from '../venue/venueModel.ts'

const { game, shell, goTo } = useApp()
const NAV = [['home', 'Home'], ['buy', 'Buy'], ['map', 'Map'], ['phone', 'Phone']] as const
const tabs = computed(() => NAV.map(([id, label]) => {
  const panel = shell.byId.get(id)
  const mode = game.mode.value
  return { id, label, reason: panel?.placement === 'nav' ? shell.gateOf(panel) : null, selected: mode === id || (id === 'home' && mode === 'venue' && game.state.value.location === 'home') }
}))

function navigate(id: string, reason: string | null): void {
  if (reason) { game.toast(reason, 'error'); return }
  shell.ui.clean = false
  if (id === 'phone') shell.open('phone')
  else if (id === 'home') {
    // At home (or already on the way somewhere): show the scene. Elsewhere: the travel card for Home, never a silent trek.
    // A visitor has no home in this city: Home says so, with a guest house, the way home and the ways to a home here.
    if (game.view.value.estate.visiting) { shell.open('visiting'); return }
    shell.closeSheet()
    if (game.state.value.location === 'home' || isTrip(game.state.value.activeAction)) shell.setMode('venue'); else void goTo('home')
  } else if (game.mode.value === id) shell.setMode('venue')
  else shell.open(id)
}
defineExpose({ navigate })
</script>

<template>
  <nav class="life-nav" data-slot="nav" aria-label="Main navigation">
    <button v-for="tab in tabs" :key="tab.id" type="button" :data-nav="tab.id" :data-tour="`nav-${tab.id}`" :class="{ 'is-selected': tab.selected, 'is-off': tab.reason }" :aria-disabled="tab.reason ? 'true' : undefined" :aria-current="tab.selected ? 'page' : undefined" :title="tab.reason ?? undefined" @click="navigate(tab.id, tab.reason)">
      <GameIcon :name="tab.id" /><span>{{ tab.label }}</span>
    </button>
  </nav>
</template>
