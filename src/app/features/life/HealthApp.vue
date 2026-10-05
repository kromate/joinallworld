<script setup lang="ts">
// Health app. The HUD's health warning and weather chips are the two HUD panels (healthChips).
//
// Phone app: how you are, the weather, how close you are to falling sick, what to do about it, and
// every cure with its price and where to get it. Everything shown comes from view.health
// (src/game/systems/health.ts) and view.travel.
import { computed } from 'vue'
import { contentFor } from '../../../game/cities/runtime.ts'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { cureLine, resistanceOf, statusIcon, summaryOf, toneOf } from './healthModel.ts'

defineProps<{ params?: unknown }>()

const { game, shell } = useApp()
const view = game.view
const health = computed(() => view.value.health)
const venueSpots = computed(() => Object.fromEntries(contentFor(view.value.cityId).venues.map((venue) => [venue.id, venue.definition])))
const cures = computed(() => health.value.cures.map((cure) => cureLine(cure, game.state.value.cash, venueSpots.value)))
const resistance = computed(() => resistanceOf(health.value.strain))
const place = (id: string | null) => (id ? view.value.travel.destinations.find((item) => item.id === id) ?? null : null)
</script>

<template>
  <div class="health-app">
    <section class="health-status" :class="toneOf(health)">
      <span aria-hidden="true"><GameIcon inline kind="health" :id="statusIcon(health)" /></span>
      <div><h3>{{ health.status }}</h3><p>{{ summaryOf(health) }}</p></div>
    </section>
    <ul v-if="health.feelings.length" class="ui-chips health-feelings">
      <li v-for="feeling in health.feelings" :key="feeling.id" class="ui-chip" :class="feeling.value > 0 ? 'is-good' : 'is-bad'">{{ feeling.label }} {{ feeling.value > 0 ? '+' : '−' }}{{ Math.abs(feeling.value) }} mood</li>
    </ul>
    <div class="ui-rows">
      <div class="ui-row">
        <span class="ui-row-icon" aria-hidden="true"><GameIcon inline kind="weather" :id="health.weather.id" :emoji="health.weather.icon" /></span>
        <span class="ui-row-body"><b>{{ health.weather.label }} · about {{ health.weather.minutesLeft }} more min</b><small>{{ health.weather.text }}</small></span>
      </div>
      <div class="ui-row health-risk">
        <span class="ui-row-icon" aria-hidden="true"><GameIcon inline name="shield" /></span>
        <span class="ui-row-body">
          <b>{{ health.sick ? 'Already sick' : 'Resistance' }} <span class="ui-chip" :class="resistance < 50 ? 'is-warn' : 'is-good'">{{ resistance }}%</span></b>
          <span class="ui-bar" :class="{ 'is-low': resistance < 50 }" role="meter" :aria-label="health.sick ? 'Already sick' : 'Resistance'" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="resistance"><i :style="{ width: `${Math.max(0, Math.min(100, resistance))}%` }" /></span>
          <small>Drops while Hunger or Hygiene is under 15 and you keep playing. Time away does not count. At zero you fall sick.</small>
        </span>
      </div>
    </div>
    <h3 class="ui-section">What to do</h3>
    <ul class="health-advice"><li v-for="line in health.advice" :key="line">{{ line }}</li></ul>
    <h3 class="ui-section">{{ health.sick ? 'Ways to get well' : 'If you ever fall sick' }}</h3>
    <ul class="ui-rows health-cures">
      <li v-for="cure in cures" :key="cure.id" class="ui-row">
        <span class="ui-row-body">
          <b>{{ cure.label }} <span class="ui-chip" :class="{ 'is-bad': cure.short }">{{ cure.price }}{{ cure.time }}</span></b>
          <small>{{ cure.text }}<template v-if="cure.short"> You have {{ money(game.state.value.cash) }}, so this one is out of reach for now.</template></small>
          <template v-if="place(cure.place)">
            <span v-if="place(cure.place)?.here" class="health-here">You are here — pick it in the venue panel.</span>
            <button v-else type="button" class="ui-button is-small" @click="shell.open('map', { destination: cure.place })">Go to {{ place(cure.place)?.label }}</button>
          </template>
        </span>
      </li>
    </ul>
  </div>
</template>

<style scoped src="../../../ui/panels/health.css"></style>
