<script setup lang="ts">
// Career tab of the Sim sheet: track, level, role, pay, the one schedule sentence, performance,
// the next promotion and what it still needs, weekday chips, today's status and the next step.
//
// Everything shown comes from view.career (systems/career.js), so this file holds no rules.
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { cap, money } from '../../ui/format.ts'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { readOnlyReason } from '../kit/act.ts'
import { chipWords } from './jobsModel.ts'
import { percent, promotionLine, stepLine } from './careerModel.ts'

defineProps<{ params?: unknown }>()

const { game, shell, goTo } = useApp()
const view = game.view
const career = computed(() => view.value.career)
const promotion = computed(() => promotionLine(career.value, cap))
const offline = computed(() => readOnlyReason(view.value.connected ? null : linkWords(view.value)?.why))
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
