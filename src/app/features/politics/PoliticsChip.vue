<script setup lang="ts">
// The Politics card on the home screen, beside the gem hunt: where this week's election is and what the player can do about it. It exists so the
// player can see that Allworld has a government at all: the app itself sits on the second page of the Phone. Tapping it opens Politics.
// One read of the overview when the page loads and then at most once a minute while the state changes; no timer of its own.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import type { PoliticsResponse } from '../../../types/politics.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { useLoaded } from '../civic/useCivic.ts'
import { chipLines, overviewKey, overviewPath } from './politicsModel.ts'

const { game, shell } = useApp()
const view = game.view
const { item } = useLoaded<PoliticsResponse>({ key: () => overviewKey(view.value.cityId), path: () => overviewPath(view.value.cityId), maxAge: 60000, live: true })
const lines = computed(() => (item.value.data ? chipLines(item.value.data, view.value.now) : null))
const holding = computed(() => item.value.data?.seats.some((seat) => seat.you?.isOfficeholder) === true)
</script>

<template>
  <button v-if="lines" class="life-job civic-chip politics-chip" :class="{ 'is-active': holding }" type="button" aria-label="Politics: this week's election" @click="shell.open('politics')">
    <span aria-hidden="true"><GameIcon inline name="governor" /></span>
    <div><strong>Politics</strong><small>{{ lines.first }}</small><small>{{ lines.second }}</small></div>
  </button>
</template>

<style scoped>
:global(.life-ui) .politics-chip { width: 100%; max-width: 100%; }
.politics-chip > div { min-width: 0; }
.politics-chip strong, .politics-chip small { white-space: normal; overflow-wrap: anywhere; }
</style>
