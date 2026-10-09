<script setup lang="ts">
// Career tab of the Sim sheet: track, level, role, pay, the one schedule sentence, performance,
// the next promotion and what it still needs, weekday chips, today's status and the next step.
//
// Everything shown comes from view.career (systems/career.js), so this file holds no rules.
// The work-dilemma card is drawn only while the life has one waiting
// (view.career.dilemma is its id; the words are a lazy chunk fetched here, src/game/content/dilemmas.ts); a choice sends 'career.dilemma' { choice }.
import { computed, ref, shallowRef, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { cap, money } from '../../ui/format.ts'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { readOnlyReason, useAct } from '../kit/act.ts'
import type { DilemmaDefinition } from '../../../types/content.ts'
import { chipWords } from './jobsModel.ts'
import { percent, promotionLine, stepLine } from './careerModel.ts'

defineProps<{ params?: unknown }>()

const { game, shell, goTo, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const career = computed(() => view.value.career)
const promotion = computed(() => promotionLine(career.value, cap))
const offline = computed(() => readOnlyReason(view.value.connected ? null : linkWords(view.value)?.why))
const waiting = computed(() => career.value.dilemma?.id ?? null)
const dilemma = shallowRef<DilemmaDefinition | null>(null)
const wordsFailed = ref(false)
const retryWords = ref(0)
watch([waiting, () => game.session.value?.id, retryWords], async ([id], _previous, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  dilemma.value = null
  wordsFailed.value = false
  if (!id) return
  const words = (await import('../../../game/content/dilemmas.ts').catch(() => null))?.dilemmaById(id) ?? null
  if (!current) return
  dilemma.value = words
  wordsFailed.value = words === null
}, { immediate: true, flush: 'sync' })
const choose = (choice: string): Promise<boolean> => act(`dilemma:${choice}`, () => command('career.dilemma', { choice }))
function go(venue: string, spot?: string): void { shell.close(); void goTo(venue, spot) }
</script>

<template>
  <EmptyState v-if="!career.employed" icon="jobs" title="No job yet" text="Find one in the Jobs app — applying is free and you can work the same day.">
    <button type="button" class="ui-button is-primary" @click="shell.open('jobs')">Open Jobs</button>
  </EmptyState>
  <div v-else class="career-app">
    <section class="ui-hero career-hero">
      <small><GameIcon inline kind="track" :id="career.id" :emoji="career.icon" /> {{ career.label }}<template v-if="career.isTrack"> · Level {{ career.level }}</template></small>
      <strong>{{ career.isTrack ? career.role : 'Starter job' }}</strong>
      <p><b>{{ money(career.pay) }} per shift</b> at {{ career.workplace?.label }}</p>
    </section>
    <p class="career-status" :class="{ 'is-open': career.today.canWork }">{{ career.today.text }}</p>
    <p class="career-step">{{ stepLine(career) }}</p>
    <div class="career-actions">
      <button v-if="career.step.kind === 'go'" type="button" class="ui-button is-primary" @click="go(career.step.venue, career.step.spot)">Go to work</button>
      <button v-else-if="career.step.kind === 'home'" type="button" class="ui-button is-primary" @click="go('home')">Go home to eat and rest</button>
      <button v-else-if="career.step.kind === 'start'" type="button" class="ui-button is-primary" @click="shell.close()">Close and start shift</button>
      <button type="button" class="ui-button" @click="shell.open('jobs')">Jobs: switch or quit</button>
    </div>
    <p v-if="!view.connected" class="ui-why">{{ offline }}</p>

    <section v-if="waiting && !dilemma" class="ui-card career-card" role="status">
      <p>{{ wordsFailed ? 'The work situation could not be loaded. Try again to see your choices.' : 'Loading your work situation…' }}</p>
      <button v-if="wordsFailed" type="button" class="ui-button" @click="retryWords++">Try again</button>
    </section>
    <section v-else-if="dilemma" class="ui-card career-card career-dilemma" aria-live="polite">
      <h3>Something came up</h3>
      <p>{{ dilemma.prompt.en }}</p>
      <p v-if="dilemma.prompt.pcm" class="career-legend">{{ dilemma.prompt.pcm }}<template v-if="dilemma.beta"> (Pidgin wording not yet reviewed)</template></p>
      <div class="career-actions">
        <button v-for="choice in dilemma.choices" :key="choice.id" type="button" class="ui-button" :disabled="pending !== null || !view.connected" @click="choose(choice.id)">
          {{ choice.label.en }}<template v-if="choice.risk"> (risky)</template>
        </button>
      </div>
    </section>

    <section v-if="career.isTrack" class="ui-card career-card">
      <h3>Performance <b>{{ career.performance }}%</b></h3>
      <div class="ui-bar" role="meter" aria-label="Performance" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(career.performance ?? 0)"><i :style="{ width: `${percent(career.performance)}%` }" /></div>
      <p v-if="promotion.kind === 'next'" class="career-next">{{ promotion.text }}<br><span v-for="check in promotion.checks" :key="check.text" :class="check.met ? 'is-met' : 'is-unmet'"><GameIcon inline :name="check.met ? 'check' : 'close'" /><span class="ui-sr">{{ check.met ? 'Met:' : 'Not met:' }}</span> {{ check.text }}</span></p>
      <p v-else-if="promotion.kind === 'top'" class="career-next">Top of the ladder: there is no higher role in this track.</p>
    </section>
    <p v-else class="career-next">The starter job has no promotions. Pick a career track in Jobs to climb a ladder.</p>

    <section class="ui-card career-card">
      <h3>Work days</h3>
      <p class="career-schedule">{{ career.schedule }}</p>
      <ul class="career-chips" aria-label="Work days">
        <li v-for="chip in career.chips" :key="chip.name" :class="{ 'is-work': chip.work, 'is-today': chip.today }" :title="`${chip.name}: ${chip.work ? 'work day' : 'day off'}${chip.today ? ' (today)' : ''}`" :aria-label="chipWords(chip)">{{ chip.letter }}</li>
      </ul>
      <p class="career-legend">Filled = work day · ring = today ({{ career.today.weekday }}, Nigerian time)</p>
      <p class="career-hours">{{ career.hours }}</p>
    </section>
    <details class="ui-details"><summary>How work works</summary><ul class="career-rules"><li v-for="rule in career.rules" :key="rule">{{ rule }}</li></ul></details>
  </div>
</template>

<style scoped src="../../../ui/panels/career.css"></style>
