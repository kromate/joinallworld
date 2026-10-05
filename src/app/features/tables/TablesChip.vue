<script setup lang="ts">
// The "table here" chip in the HUD: shown in a venue that has a game table, it opens the Tables
// app on that table. It knows only where tables stand (tablesPlaces.ts, data), so it brings no
// game code. It renders nothing (a comment node, no element) when the life is not connected, a
// new life must still choose its look, the Sim is travelling, or there is no table in this venue.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { isDeparting } from '../../../life.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { chipGames } from './tablesChipModel.ts'
import { tablesAt } from './tablesPlaces.ts'

defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const here = computed(() => {
  const view = game.view.value, state = game.state.value
  if (!view.connected || view.onboarding?.required || isDeparting(state)) return []
  return tablesAt(view.cityId, state.location)
})
const games = computed(() => chipGames(here.value))
const open = (): void => { const first = here.value[0]; if (first) shell.open('tables', { table: first.id }) }
</script>

<template>
  <div v-if="here.length" data-panel="tables-chip">
    <button class="life-job" type="button" @click="open"><span aria-hidden="true"><GameIcon name="tables" inline /></span><div><strong>{{ games }} table here</strong><small>Sit down, or invite a friend to play</small></div></button>
  </div>
</template>
