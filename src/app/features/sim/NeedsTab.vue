<script setup lang="ts">
// The Needs tab of the Sim sheet: the mood, one bar per need and the feelings that move the mood.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { cap } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { feelingsTotal, needLevel, signedFeeling } from './simModel.ts'

defineProps<{ params?: unknown }>()

const { game } = useApp()
const view = game.view
const mood = computed(() => view.value.onboarding.mood)
const feelings = computed(() => view.value.onboarding.feelings)
const total = computed(() => feelingsTotal(feelings.value))
const bars = computed(() => view.value.needs.order.map((need) => {
  const value = Math.round(game.state.value.needs[need])
  return { need, value, level: needLevel(value) }
}))
</script>

<template>
  <div class="sim-needs">
    <p class="sim-mood" :class="`is-${mood.tone}`"><span aria-hidden="true"><GameIcon inline kind="mood" :id="mood.tone" :emoji="mood.icon" /></span> <strong>{{ mood.word }}</strong><small>Mood score {{ mood.score }} of 100</small></p>
    <div v-for="bar in bars" :key="bar.need" class="sim-need-row" :class="`is-${bar.level}`">
      <span><i aria-hidden="true"><GameIcon inline kind="need" :id="bar.need" /></i> {{ cap(bar.need) }}</span>
      <div role="meter" :aria-label="cap(bar.need)" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="bar.value"><i :style="{ width: `${bar.value}%` }" /></div>
      <b>{{ bar.value }}%</b>
    </div>
    <h3>Feelings</h3>
    <template v-if="feelings.length">
      <ul class="sim-feelings">
        <li v-for="feeling in feelings" :key="feeling.id"><span><strong>{{ feeling.label }}</strong><small v-if="feeling.line">{{ feeling.line }}</small></span><b :class="feeling.value < 0 ? 'is-bad' : 'is-good'">{{ signedFeeling(feeling.value) }}</b></li>
      </ul>
      <p class="sim-hint">Feelings add {{ total.text }} to your mood.</p>
    </template>
    <p v-else class="sim-hint">Nothing in particular right now. Low needs and big moments show up here.</p>
    <p class="preview-note">Mood is the average of the six needs plus your feelings. The word thresholds (Very Happy 78, Happy 62, Fine 45, Uneasy 25) are original beta values. Needs fall slowly over real time and never below 10 on their own.</p>
  </div>
</template>

<style scoped src="../../../ui/panels/sim.css"></style>
