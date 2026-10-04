<script setup lang="ts">
// "Where you live" as a section of the Home card of settling in. Nothing is sent here: the choice
// is kept in the draft (draft.extra.area = { lga, via }) and rides in the 'onboarding.home' payload,
// so settling in and taking a house are one step — and a guest who closes the sheet has taken
// nothing. (The standing card that sends 'estate.set-lga' is world/LgaCard.vue.)
//
// LOCATION PRIVACY. "Find my local government" works the local government out on this device
// (world/lgaCardModel.ts findLga): the position is never stored, logged or sent, only the local
// government the player confirms.
import '../../../ui/panels/world.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import { findLga, lgaCardUi as ui } from '../world/lgaCardModel.ts'
import type { AreaChoice } from './onboardingModel.ts'

const area = defineModel<AreaChoice | undefined>({ required: true })
const { game } = useApp()
const estate = computed(() => game.view.value.estate)
const picked = computed(() => estate.value.lgas.find((item) => item.id === area.value?.lga) ?? null)
// A found answer is asked about only until the player has chosen.
const found = computed(() => (ui.found && !picked.value ? ui.found : null))

function yes(): void { if (ui.found) { area.value = { lga: ui.found.id, via: 'device' }; Object.assign(ui, { found: null, note: '' }) } }
function no(): void { Object.assign(ui, { found: null, note: '' }) }
async function find(): Promise<void> { area.value = undefined; await findLga(ui, estate.value.city) }
function pick(event: Event): void {
  const lga = (event.target as HTMLSelectElement).value
  area.value = lga ? { lga, via: 'manual' } : undefined
  Object.assign(ui, { found: null, note: '' })
}
</script>

<template>
  <section v-if="estate.lgas.length" class="world-card is-compact" data-lga-card>
    <h3>Your local government</h3>
    <p class="ui-note">Your house stands on a plot in the local government you choose. You can move to another one later (once every {{ estate.change.cooldownDays }} days).</p>
    <p v-if="picked" class="world-now" role="status"><b>{{ picked.name }}</b><small>{{ picked.line }}</small></p>
    <div v-if="found" class="world-found" role="status">
      <p>{{ found.sure ? 'You are in' : 'Nearest to you is' }} <b>{{ found.name }}</b>. Is that right?</p>
      <div class="world-row"><button type="button" class="ui-button is-primary" data-key="area:yes" @click="yes">Yes, {{ found.name }}</button><button type="button" class="ui-button" data-key="area:no" @click="no">No, let me pick</button></div>
    </div>
    <button type="button" class="ui-button is-block" data-key="area:find" :disabled="ui.finding" @click="find">{{ ui.finding ? 'Finding…' : 'Find my local government' }}</button>
    <p class="ui-note">Worked out on this device. Your position is never sent or stored — only the local government you confirm.</p>
    <label class="world-field">Or choose from the {{ estate.lgas.length }} local governments of {{ estate.cityName }}
      <select data-lga-pick data-key="area:pick" :value="picked?.id ?? ''" @change="pick"><option value="">Choose…</option><option v-for="item in estate.lgas" :key="item.id" :value="item.id" :selected="item.id === picked?.id">{{ item.name }}</option></select></label>
    <p v-if="ui.note" class="ui-why" role="status">{{ ui.note }}</p>
  </section>
</template>
