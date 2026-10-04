<script setup lang="ts">
// Cars app: the dealer list, buying, choosing which owned car to drive, and selling back.
// Actions: 'property.car-buy', 'property.car-use', 'property.car-sell'. An owned car adds a
// "Drive" travel mode that costs fuel only (systems/property.js contributes it to the travel
// system). Every disabled button says what is missing.
import { computed } from 'vue'
import type { CarId } from '../../../types/life.ts'
import { CAR_RESALE_RATE } from '../../../game/content/cars.js'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../legacy/modules.ts'
import { money } from '../../ui/format.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import { useAct } from '../kit/act.ts'
import CarArt from './CarArt.vue'
import { buyReason, carsRules, ownedReason, quicker } from './homeModel.ts'

defineProps<{ params?: unknown }>()

const { game, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const property = computed(() => view.value.property)
const offline = computed(() => (view.value.connected ? '' : `${linkWords(view.value)?.short ?? ''} — trading needs the server`))
const owned = computed(() => ownedReason(offline.value, game.state.value.activeAction))
const driving = computed(() => (property.value?.car ? `Choose Drive on the map and pay ${money(property.value.car.fuel)} of fuel per trip.` : 'Own a car and every trip costs fuel only — no fares.'))
const buy = (id: CarId): Promise<boolean> => act(`buy:${id}`, () => command('property.car-buy', { id }))
const use = (id: CarId): Promise<boolean> => act(`use:${id}`, () => command('property.car-use', { id }))
const sell = (id: CarId): Promise<boolean> => act(`sell:${id}`, () => command('property.car-sell', { id }))
</script>

<template>
  <p v-if="!property" class="ui-error">The dealer list could not be loaded. Close this app and open it again.</p>
  <div v-else class="cars-app">
    <section class="ui-hero cars-hero">
      <small>{{ property.car ? 'Your car' : 'No car yet' }}</small>
      <strong>{{ property.car ? property.car.label : 'Public transport' }}</strong>
      <p>{{ driving }}</p>
    </section>
    <HowItWorks id="cars-rules" page label="How cars work" :rules="carsRules(CAR_RESALE_RATE)" />
    <div class="cars-list">
      <article v-for="(car, index) in property.cars" :key="car.id" class="cars-card" :class="{ 'is-owned': car.owned }">
        <CarArt :id="car.id" :label="car.label" :index="index" />
        <div class="cars-body">
          <header>
            <div><h3>{{ car.label }}</h3><p>“{{ car.nickname }}”</p></div>
            <b :class="car.owned ? '' : car.affordable ? 'is-afford' : 'is-short'"><template v-if="car.price < car.listPrice"><s>{{ money(car.listPrice) }}</s> </template>{{ money(car.price) }}</b>
          </header>
          <ul class="ui-chips cars-facts"><li class="ui-chip">Fuel {{ money(car.fuel) }} / trip</li><li class="ui-chip">{{ quicker(car.speed) }}% quicker</li><li v-if="car.owned" class="ui-chip is-good">Owned</li></ul>
          <template v-if="car.owned">
            <div class="cars-row">
              <span v-if="car.driving" class="ui-chip is-good cars-driving">Driving this</span>
              <button v-else type="button" class="ui-button is-primary" :disabled="Boolean(owned) || pending !== null" @click="use(car.id)">Drive this</button>
              <button type="button" class="ui-button" :disabled="Boolean(owned) || pending !== null" @click="sell(car.id)">Sell · +{{ money(car.resale) }}</button>
            </div>
            <p v-if="owned" class="ui-why">{{ owned }}</p>
          </template>
          <template v-else>
            <button type="button" class="ui-button is-primary is-block" :disabled="Boolean(buyReason(car, offline)) || pending !== null" @click="buy(car.id)">Buy · {{ money(car.price) }}</button>
            <p v-if="buyReason(car, offline)" class="ui-why">{{ buyReason(car, offline) }}</p>
          </template>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped src="../../../ui/panels/cars.css"></style>
