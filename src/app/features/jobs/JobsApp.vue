<script setup lang="ts">
// Jobs app. It leads with your job (role, pay, days, workplace hours, next step, Go automatically,
// Quit) or — with no job yet — the next step towards one, then "How work works" (the rules, folded
// away), then one scannable card per job: role, pay, days, workplace hours and whether it is open
// now, key skill, and Apply / Switch.
//
// Everything shown comes from view.career (systems/career.js), so this file holds no rules.
// Actions: 'apply-job' { id }, 'career.switch' { id }, 'career.quit' and 'career.auto' { on }.
// Switching and quitting ask first, in place. A control that sent an action is disabled until the
// server has answered.
import { computed } from 'vue'
import type { ActivityId, JobId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { cap, money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import { readOnlyReason, useAct } from '../kit/act.ts'
import { asking } from './jobsState.ts'
import { autoWords, jobControl, jobsRules, openNow, otherJobs, validAsk } from './jobsModel.ts'

defineProps<{ params?: unknown }>()

const { game, shell, command, goTo } = useApp()
const { act, pending } = useAct()
const view = game.view
const career = computed(() => view.value.career)
const offline = computed(() => readOnlyReason(view.value.connected ? null : linkWords(view.value)?.why))
const ask = computed(() => validAsk(asking.value, career.value))
const jobs = computed(() => otherJobs(career.value.jobs))
const rules = computed(() => jobsRules(career.value.rules))
const wait = computed(() => pending.value !== null)

function go(venue: string, spot?: string): void { shell.close(); void goTo(venue, spot) }
const apply = (id: JobId): Promise<boolean> => act(`apply:${id}`, () => command('apply-job', { id }))
const switchTo = (id: JobId): Promise<boolean> => act(`switch:${id}`, () => command('career.switch', { id }))
const quit = (): Promise<boolean> => act('quit', () => command('career.quit'))
const setAuto = (on: boolean): Promise<boolean> => act('auto', () => command('career.auto', { on }))
const startShift = (id: ActivityId): Promise<boolean> => act('shift', () => command('activity', { id }), { close: true })
</script>

<template>
  <div class="jobs-app">
    <template v-if="career.employed">
      <section class="jobs-mine" aria-label="Your job">
        <p class="jobs-eyebrow">Your job</p>
        <header class="jobs-head">
          <span class="jobs-icon" aria-hidden="true"><GameIcon inline kind="track" :id="career.id" :emoji="career.icon" /></span>
          <div><h3>{{ career.role }}</h3><p>{{ career.isTrack ? `${career.label} · level ${career.level} of ${career.levels}` : 'Starter job' }}</p></div>
          <b class="jobs-pay">{{ money(career.pay) }}<small>per shift</small></b>
        </header>
        <ul class="jobs-facts">
          <li><span aria-hidden="true"><GameIcon inline name="calendar" /></span>{{ career.schedule }}</li>
          <li :class="career.workplace?.open ? 'is-open' : 'is-closed'"><span aria-hidden="true"><GameIcon inline name="clock" /></span>{{ career.hours }}</li>
          <li v-if="career.isTrack"><span aria-hidden="true"><GameIcon inline name="invest" /></span>Performance {{ career.performance }}%</li>
        </ul>
        <p class="jobs-step">{{ career.step.text }}</p>
        <button v-if="career.step.kind === 'go'" type="button" class="ui-button is-primary" @click="go(career.step.venue, career.step.spot)">Go to work</button>
        <button v-else-if="career.step.kind === 'home'" type="button" class="ui-button is-primary" @click="go('home')">Go home to eat and rest</button>
        <button v-else-if="career.step.kind === 'start' && career.shift" type="button" class="ui-button is-primary" :disabled="!view.connected || wait" :title="view.connected ? undefined : offline ?? undefined" @click="startShift(career.shift.id)">Start shift</button>
        <p v-if="!view.connected" class="ui-why">{{ offline }}</p>
      </section>
      <div class="ui-rows">
        <button type="button" class="ui-row" @click="shell.open('career')">
          <span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="career" /></span>
          <span class="ui-row-body"><b>Career progress</b><small>{{ career.isTrack ? `Performance ${career.performance}% · work days and promotion` : 'Work days and today’s shift' }}</small></span>
          <span class="ui-row-end"><GameIcon inline name="chevron" /></span>
        </button>
        <div v-if="career.isTrack" class="ui-row jobs-auto-row">
          <button type="button" class="jobs-auto" role="switch" :aria-checked="career.auto" :disabled="!view.connected || wait" :title="view.connected ? undefined : offline ?? undefined" @click="setAuto(!career.auto)">
            <i class="ui-switch" aria-hidden="true" /><span>Go automatically<small>{{ autoWords(career.auto) }}</small></span>
          </button>
        </div>
      </div>
      <div v-if="ask === 'quit'" class="ui-confirm">
        <p>Quit {{ career.label }}? You lose your level and performance in it. You can apply again later and start from the first role.</p>
        <div>
          <button type="button" class="ui-button is-danger" :disabled="career.busy || !view.connected || wait" @click="quit()">Yes, quit</button>
          <button type="button" class="ui-button" @click="asking = null">Keep my job</button>
        </div>
        <p v-if="career.busy" class="ui-why">Finish or cancel your current action before quitting.</p>
      </div>
      <button v-else type="button" class="jobs-link" @click="asking = 'quit'">Quit this job</button>
    </template>
    <section v-else class="ui-hero" aria-label="Your next step"><small>No job yet</small><strong>Find work today</strong><p>{{ career.step.text }}</p></section>

    <HowItWorks id="jobs-rules" page label="How work works" :rules="rules" />
    <h3 class="ui-section">{{ career.employed ? 'Other jobs' : 'Pick a job' }}</h3>
    <div class="jobs-list">
      <article v-for="job in jobs" :key="job.id" class="jobs-track">
        <header class="jobs-head">
          <span class="jobs-icon" aria-hidden="true"><GameIcon inline kind="track" :id="job.id" :emoji="job.icon" /></span>
          <div>
            <h3>{{ job.label }}<template v-if="!job.track"> <span class="jobs-badge">Starter</span></template></h3>
            <p>{{ job.track ? `Start as ${job.entryRole}` : 'No ladder · work any day' }}</p>
          </div>
          <b class="jobs-pay">{{ money(job.pay) }}<small>per shift</small></b>
        </header>
        <ul class="jobs-facts">
          <li><span aria-hidden="true"><GameIcon inline name="calendar" /></span>{{ job.schedule }}</li>
          <li :class="openNow(job) === null ? '' : openNow(job) ? 'is-open' : 'is-closed'"><span aria-hidden="true"><GameIcon inline name="clock" /></span>{{ job.hours }}</li>
          <li v-if="openNow(job) !== null" :class="openNow(job) ? 'is-open' : 'is-closed'"><span aria-hidden="true"><GameIcon inline :name="openNow(job) ? 'good' : 'moon'" /></span>{{ openNow(job) ? 'Open now' : 'Closed now' }}</li>
          <li v-if="job.track && job.skill"><span aria-hidden="true"><GameIcon inline name="book" /></span>Skill: {{ cap(job.skill) }}</li>
          <li><span aria-hidden="true"><GameIcon inline name="clock" /></span>{{ job.duration }}s shift</li>
        </ul>
        <p class="jobs-summary">{{ job.summary }}<template v-if="job.track"> Top role: {{ job.topRole }}.</template></p>
        <template v-for="control in [jobControl(job, career, offline, ask)]" :key="control.kind">
          <template v-if="control.kind === 'blocked'">
            <button type="button" class="ui-button" disabled :title="control.why">{{ control.label }}</button>
            <p class="ui-why">{{ control.why }}</p>
          </template>
          <button v-else-if="control.kind === 'apply'" type="button" class="ui-button is-primary" :disabled="wait" @click="apply(job.id)">Apply — free, hired at once</button>
          <div v-else-if="control.kind === 'confirm'" class="ui-confirm">
            <p>{{ control.warning }}</p>
            <div>
              <button type="button" class="ui-button is-primary" :disabled="wait" @click="switchTo(job.id)">Confirm switch</button>
              <button type="button" class="ui-button" @click="asking = null">Keep current job</button>
            </div>
          </div>
          <button v-else-if="control.kind === 'transfer'" type="button" class="ui-button is-primary" :disabled="wait" @click="apply(job.id)">{{ control.label }} — free, keeps your level</button>
          <button v-else-if="control.kind === 'switch'" type="button" class="ui-button" @click="asking = job.id">Switch to this job</button>
        </template>
      </article>
    </div>
  </div>
</template>

<style scoped src="../../../ui/panels/jobs.css"></style>
