<script setup lang="ts">
// Houses app: the five house tiers, their weekly rent and move-in cost, and moving.
// Moving pays the landlord and the agent (three weeks of rent) with the 'property.house-move'
// action; furniture moves with the player and anything that does not fit goes to storage.
// Every disabled Move button says what is missing (view.property.houses[].blocked).
//
// "Your own house" at the top is MyHouse.vue (src/app/features/travel/).
import { computed, defineAsyncComponent } from 'vue'
import { useApp } from '../../state/app.ts'
import { MOVE_IN_WEEKS } from '../../../game/content/housing.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import HowItWorks from '../../ui/HowItWorks.vue'
import { useAct } from '../kit/act.ts'
import MyHouse from '../travel/MyHouse.vue'
// Who can come in, invitations and the house link: fetched with the Home tab, not with the first download.
const VisitHome = defineAsyncComponent(() => import('../visit/VisitHome.vue'))
import HouseArt from './HouseArt.vue'
import CatalogueCard from '../../ui/CatalogueCard.vue'
import BaseButton from '../../ui/BaseButton.vue'
import { housesRules, moveReason, nextHouse, savedPercent } from './homeModel.ts'
import type { HouseId } from '../../../types/life.ts'

defineProps<{ params?: unknown }>()

const { game, shell, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const cash = computed(() => game.state.value.cash)
const property = computed(() => view.value.property)
const guest = computed(() => view.value.onboarding.guest)
/** A city with no rental flats offers none: the rent section is left out instead of showing an empty ladder. */
const rentals = computed(() => Object.keys(property.value?.houses ?? {}).length > 0)
const next = computed(() => (property.value ? nextHouse(property.value) : undefined))
const progress = computed(() => (next.value ? savedPercent(cash.value, next.value.moveIn) : 100))
const moveBlocked = computed(() => (!view.value.connected ? `${linkWords(view.value)?.short ?? ''} — moving needs the server` : guest.value ? 'Settle in before renting a home.' : ''))
/** Where a city is not Lagos, the first room of its own ladder is the one named. */
const smallest = computed(() => (game.state.value.estate.city === 'lagos' ? undefined : property.value?.houses[0]?.label.toLowerCase()))
const move = (id: HouseId): Promise<boolean> => act(`move:${id}`, () => command('property.house-move', { id }))
</script>

<template>
  <p v-if="!property" class="ui-error">Houses could not be loaded. Close this app and open it again.</p>
  <div v-else class="houses-app">
    <details class="ui-card">
      <summary>Furniture, land, stories &amp; neighbours</summary>
      <button type="button" class="ui-button is-block" @click="shell.open('buy')">Arrange furniture</button>
      <button type="button" class="ui-button is-block" @click="shell.open('land')">Expand my land</button>
      <button type="button" class="ui-button is-block" @click="shell.open('stories')">Create a story scene</button>
      <button type="button" class="ui-button is-block" @click="shell.open('neighbourhood')">Visit my neighbours</button>
    </details>
    <MyHouse />
    <VisitHome />
    <template v-if="rentals">
    <h3 class="ui-section">Homes to rent</h3>
    <section class="ui-hero houses-hero">
      <small>{{ guest ? 'Browse homes' : next ? 'Next step up' : 'Top of the ladder' }}</small>
      <strong>{{ guest ? 'A place of your own' : next ? `${next.label}, ${next.district}` : 'The grandest house in the city' }}</strong>
      <p v-if="guest">Settle in for your free starter house. You can move to a rental afterwards.</p>
      <template v-else-if="next">
        <div class="houses-progress" role="meter" aria-label="Saved towards the move" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="progress"><i :style="{ width: `${progress}%` }" /></div>
        <p>{{ next.affordable ? 'You can afford the move.' : `${money(next.moveIn - cash)} to go · you have ${money(cash)}` }}</p>
      </template>
      <p v-else>You live here already.</p>
    </section>
    <p class="ui-note houses-note">Moving in costs {{ MOVE_IN_WEEKS }} weeks of rent up front. Rent is then due every Saturday.</p>
    <HowItWorks id="houses-rules" page label="How moving works" :rules="housesRules(MOVE_IN_WEEKS, smallest)" />
    <div class="houses-list">
      <CatalogueCard v-for="(house, tier) in property.houses" :key="house.id" :title="house.label" :subtitle="house.district" :selected="house.current && !guest">
        <template #media><HouseArt :tier="tier" :grid="house.grid" /></template>
        <template #status><span v-if="house.current && !guest" class="ui-chip is-good">Your home</span><span v-else-if="house.tag" class="ui-chip">{{ house.tag }}</span></template>
        <p class="houses-description">{{ house.description }}</p>
        <dl class="houses-specs"><div><dt>Move-in cost</dt><dd>{{ money(house.moveIn) }}</dd></div><div><dt>Weekly rent</dt><dd>{{ money(house.rent) }}</dd></div><div><dt>Room size</dt><dd>{{ house.grid }} × {{ house.grid }}</dd></div></dl>
        <template v-if="!house.current || guest" #actions><BaseButton variant="primary" :reason="moveBlocked || moveReason(house, '')" :disabled="pending !== null" @click="move(house.id)">{{ pending === `move:${house.id}` ? 'Moving…' : `Move in for ${money(house.moveIn)}` }}</BaseButton></template>
        <template v-if="(!house.current || guest) && (moveBlocked || moveReason(house, ''))" #note><p class="ui-why">{{ moveBlocked || moveReason(house, '') }}</p></template>
      </CatalogueCard>
    </div>
    </template>
  </div>
</template>

<style scoped src="../../../ui/panels/houses.css"></style>
