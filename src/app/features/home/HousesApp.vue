<script setup lang="ts">
// Houses app: the five house tiers, their weekly rent and move-in cost, and moving.
// Moving pays the landlord and the agent (three weeks of rent) with the 'property.house-move'
// action; furniture moves with the player and anything that does not fit goes to storage.
// Every disabled Move button says what is missing (view.property.houses[].blocked).
//
// "Your own house" at the top is still the world panels' section (src/app/legacy/myHouse.ts).
import { computed } from 'vue'
import { MOVE_IN_WEEKS } from '../../../game/content/housing.js'
import { useApp } from '../../state/app.ts'
import LegacyPanel from '../../legacy/LegacyPanel.vue'
import { MY_HOUSE } from '../../legacy/myHouse.ts'
import { linkWords } from '../../legacy/modules.ts'
import { money } from '../../ui/format.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import { useAct } from '../kit/act.ts'
import HouseArt from './HouseArt.vue'
import { housesRules, moveReason, nextHouse, savedPercent } from './homeModel.ts'
import type { HouseId } from '../../../types/life.ts'

defineProps<{ params?: unknown }>()

const { game, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const cash = computed(() => game.state.value.cash)
const property = computed(() => view.value.property)
const next = computed(() => (property.value ? nextHouse(property.value) : undefined))
const progress = computed(() => (next.value ? savedPercent(cash.value, next.value.moveIn) : 100))
const offline = computed(() => (view.value.connected ? '' : `${linkWords(view.value)?.short ?? ''} — moving needs the server`))
const move = (id: HouseId): Promise<boolean> => act(`move:${id}`, () => command('property.house-move', { id }))
</script>

<template>
  <p v-if="!property" class="ui-error">Houses could not be loaded. Close this app and open it again.</p>
  <div v-else class="houses-app">
    <LegacyPanel :panel="MY_HOUSE" />
    <h3 class="ui-section">Homes to rent</h3>
    <section class="ui-hero houses-hero">
      <small>{{ next ? 'Next step up' : 'Top of the ladder' }}</small>
      <strong>{{ next ? `${next.label}, ${next.district}` : 'The grandest house in the city' }}</strong>
      <template v-if="next">
        <div class="houses-progress" role="meter" aria-label="Saved towards the move" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progress"><i :style="{ width: `${progress}%` }" /></div>
        <p>{{ next.affordable ? 'You can afford the move.' : `${money(next.moveIn - cash)} to go · you have ${money(cash)}` }}</p>
      </template>
      <p v-else>You live here already.</p>
    </section>
    <p class="ui-note houses-note">Moving in costs {{ MOVE_IN_WEEKS }} weeks of rent up front. Rent is then due every Saturday.</p>
    <HowItWorks id="houses-rules" page label="How moving works" :rules="housesRules(MOVE_IN_WEEKS)" />
    <div class="houses-list">
      <article v-for="(house, tier) in property.houses" :key="house.id" class="houses-card" :class="{ 'is-current': house.current }">
        <HouseArt :tier="tier" :grid="house.grid" />
        <div class="houses-body">
          <header>
            <h3>{{ house.label }}<small>{{ house.district }}</small></h3>
            <span v-if="house.current" class="ui-chip is-good">You live here</span>
            <span v-else-if="house.tag" class="ui-chip">{{ house.tag }}</span>
          </header>
          <p>{{ house.description }}</p>
          <dl>
            <div><dt>Room</dt><dd>{{ house.grid }} × {{ house.grid }}</dd></div>
            <div><dt>Rent / week</dt><dd>{{ money(house.rent) }}</dd></div>
            <div><dt>Move in</dt><dd :class="house.current ? '' : house.affordable ? 'is-afford' : 'is-short'">{{ money(house.moveIn) }}</dd></div>
          </dl>
          <template v-if="!house.current">
            <button type="button" class="ui-button is-primary is-block" :disabled="Boolean(moveReason(house, offline)) || pending !== null" @click="move(house.id)">Move in · {{ money(house.moveIn) }}</button>
            <p v-if="moveReason(house, offline)" class="ui-why">{{ moveReason(house, offline) }}</p>
          </template>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped src="../../../ui/panels/houses.css"></style>
