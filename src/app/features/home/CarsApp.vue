<script setup lang="ts">
// Cars app: the dealer list, buying, choosing which owned car to drive, and selling back.
// Actions: 'property.car-buy', 'property.car-use', 'property.car-sell'. An owned car adds a
// "Drive" travel mode that costs fuel only (systems/property.js contributes it to the travel
// system). Every disabled button says what is missing.
import { computed, ref } from 'vue'
import type { CarId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import { CAR_RESALE_RATE } from '../../../game/content/cars.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import { useAct } from '../kit/act.ts'
import CarArt from './CarArt.vue'
import CatalogueCard from '../../ui/CatalogueCard.vue'
import BaseButton from '../../ui/BaseButton.vue'
import { buyReason, carsRules, ownedReason, quicker } from './homeModel.ts'

defineProps<{ params?: unknown }>()

const { game, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const property = computed(() => view.value.property)
const offline = computed(() => (view.value.connected ? '' : `${linkWords(view.value)?.short ?? ''} — trading needs the server`))
const owned = computed(() => ownedReason(offline.value, game.state.value.activeAction))
const garageOnly = ref(false)
const listedCars = computed(() => property.value?.cars.filter(car => !garageOnly.value || car.owned) ?? [])
const driving = computed(() => (property.value?.car ? `Choose Own car on the map and pay ${money(property.value.car.fuel)} of fuel per trip.` : 'Own a car and every trip costs fuel only — no fares.'))
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
    <div class="cars-tabs" role="group" aria-label="Vehicle catalogue"><BaseButton :variant="garageOnly ? 'default' : 'selected'" :aria-pressed="!garageOnly" @click="garageOnly = false">Showroom</BaseButton><BaseButton :variant="garageOnly ? 'selected' : 'default'" :aria-pressed="garageOnly" @click="garageOnly = true">Your garage</BaseButton></div>
    <p v-if="!listedCars.length" class="ui-note">Your garage is empty. Open the showroom to compare vehicles.</p>
    <div class="cars-list">
      <CatalogueCard v-for="(car, index) in listedCars" :key="car.id" :title="car.label" :subtitle="car.nickname" :selected="car.driving">
        <template #media><CarArt :id="car.id" :label="car.label" :index="index" /></template>
        <template #status><span v-if="car.owned" class="ui-chip is-good">{{ car.driving ? 'Driving' : 'Owned' }}</span></template>
        <dl class="cars-specs"><div><dt>Purchase price</dt><dd><s v-if="car.price < car.listPrice">{{ money(car.listPrice) }}</s> {{ money(car.price) }}</dd></div><div><dt>Fuel per trip</dt><dd>{{ money(car.fuel) }}</dd></div><div><dt>Travel time</dt><dd>{{ quicker(car.speed) }}% quicker</dd></div></dl>
        <template #actions>
          <template v-if="car.owned"><BaseButton v-if="!car.driving" variant="primary" :reason="owned" :disabled="pending !== null" @click="use(car.id)">{{ pending === `use:${car.id}` ? 'Selecting…' : 'Drive this' }}</BaseButton><BaseButton :reason="owned" :disabled="pending !== null" @click="sell(car.id)">{{ pending === `sell:${car.id}` ? 'Selling…' : `Sell for ${money(car.resale)}` }}</BaseButton></template>
          <BaseButton v-else variant="primary" :reason="buyReason(car, offline)" :disabled="pending !== null" @click="buy(car.id)">{{ pending === `buy:${car.id}` ? 'Buying…' : `Buy for ${money(car.price)}` }}</BaseButton>
        </template>
        <template v-if="car.owned ? owned : buyReason(car, offline)" #note><p class="ui-why">{{ car.owned ? owned : buyReason(car, offline) }}</p></template>
      </CatalogueCard>
    </div>
  </div>
</template>

<style scoped src="../../../ui/panels/cars.css"></style>
