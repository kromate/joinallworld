<script setup lang="ts">
// "Your own house": the section the Houses app shows first. The look (free and priced options),
// upgrades (paid, built on server time) and moving in. A visitor (no local government chosen in this
// city yet) is shown that state with one primary button that opens the picker: the local-government
// card for a settled life, the settling-in screen for a guest. Rules and prices: src/game/systems/estate.ts, src/game/content/world.ts.
//
// Actions: 'estate.style' { style: { field: index } }, 'estate.upgrade' { to } and 'estate.move-in'.
import '../../../ui/panels/world.css'
import { computed, ref } from 'vue'
import type { HouseStyleField } from '../../../types/life.ts'
import type { HouseTierId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'
import { useAct } from '../kit/act.ts'
import HouseArt from '../world/HouseArt.vue'
import LgaCard from '../world/LgaCard.vue'
import DebtPay from '../relief/DebtPay.vue'
import VisitorHome from './VisitorHome.vue'
import ResidenceCard from '../locate/ResidenceCard.vue'
import { STYLE_FIELDS } from '../world/worldContent.ts'
import { focusMap, track, worldChanged } from '../world/worldModel.ts'
import { FIELD_NAMES, afterStyle, minutesToGo, offeredTiers, offlineWhy, swatchLabel, swatchOff, swatchTitle, tierWhy } from './myHouseModel.ts'
import { linkWords } from './travelBoundary.ts'

const { game, shell, command } = useApp()
const { act, pending } = useAct()
const estate = computed(() => game.view.value.estate)
const cash = computed(() => game.state.value.cash)
const offline = computed(() => offlineWhy(game.view.value.connected, linkWords(game.view.value)?.short))
const choosing = ref(false)
/** A settled life picks from the card right here; a guest is taken to the settling-in screen, which ends at the same choice. */
function chooseLga(): void {
  if (game.state.value.onboarding.done) choosing.value = true
  else shell.open('onboarding', { why: 'home' })
}
const tiers = computed(() => offeredTiers(estate.value.tiers))

async function style(field: HouseStyleField, index: number): Promise<void> {
  const accepted = await act(`style:${field}:${index}`, () => command('estate.style', { style: { [field]: index } }))
  // Only an accepted change is announced: the maps redraw and the event is recorded after the server said yes.
  afterStyle(accepted, () => { track('house_styled'); worldChanged() })
}
const upgrade = (to: HouseTierId): Promise<boolean> => act(`upgrade:${to}`, () => command('estate.upgrade', { to }))
const moveIn = (): Promise<boolean> => act('move-in', () => command('estate.move-in'))
const makeMain = (): Promise<boolean> => act('make-main', () => command('estate.make-home'))
function showOnMap(): void {
  const plot = estate.value.plot
  if (!plot) return
  shell.open('map')
  focusMap({ plot })
}
</script>

<template>
  <VisitorHome v-if="estate && estate.settle" />
  <section v-else-if="estate && !estate.placed" class="world-card">
    <h3>Your own house</h3>
    <p class="ui-note">You are visiting {{ estate.cityName }}: you have no home here yet. Everyone gets a starter house on their own plot, free — in the {{ estate.unit }} they choose.</p>
    <button v-if="!choosing" type="button" class="ui-button is-primary is-block" data-choose-lga @click="chooseLga">Choose your {{ estate.unit }}</button>
    <LgaCard v-else :heading="`Choose your ${estate.unit}`" compact />
  </section>
  <section v-else-if="estate" class="world-card" data-my-house>
    <h3>Your own house</h3>
    <HouseArt :look="estate.style" :tier="estate.tier.id" :scaffold="Boolean(estate.upgrade)" />
    <p class="world-now"><b>{{ estate.tier.label }}</b><small>{{ estate.plot ? estate.plot.address : 'Your plot is being set aside…' }}</small></p>
    <div v-if="estate.upgrade" role="status">
      <p class="ui-note">Builders at work on your {{ estate.upgrade.label }}: about {{ minutesToGo(estate.upgrade.remaining) }} to go. It finishes even while you are away.</p>
      <div class="world-bar"><i :style="{ width: `${Math.round(estate.upgrade.progress * 100)}%` }" /></div>
    </div>
    <p v-if="estate.arrears" class="ui-why">Ground rent owed: {{ money(estate.arrears) }}. It is collected on a Saturday when your balance covers it.</p>
    <template v-if="estate.makeMain">
      <p class="ui-note">This is a home you keep in {{ estate.cityName }}. Your main home is in {{ estate.home?.name }}: that is where you vote.</p>
      <button type="button" class="ui-button is-block" data-make-main :disabled="Boolean(offline) || Boolean(estate.makeMain.blocked) || pending !== null" @click="makeMain">Make {{ estate.cityName }} my main home</button>
      <DebtPay v-if="estate.ride.debt" />
      <p v-else-if="estate.makeMain.blocked" class="ui-why">{{ estate.makeMain.blocked }}</p>
    </template>
    <p v-else-if="estate.away.length" class="ui-note">This is your main home. You also keep {{ estate.away.map((item) => `a ${item.tier.toLowerCase()} in ${item.name}`).join(', ') }}.</p>
    <span v-if="estate.living === 'own'" class="ui-chip is-good">You live here · no weekly rent</span>
    <template v-else>
      <button type="button" class="ui-button is-primary is-block" :disabled="Boolean(offline) || pending !== null" @click="moveIn">Move into your own house · free</button>
      <p class="ui-note">Weekly rent stops. Your furniture comes with you; what does not fit goes to storage.</p>
    </template>
    <button v-if="estate.plot" type="button" class="ui-button is-block" @click="showOnMap">Show it on the map</button>
    <h3>Upgrade your house</h3>
    <p class="ui-note">Choose a bigger home. Pay once with in-game cash; the builders finish even while you are away. Your furniture stays yours.</p>
    <div class="world-tiers">
      <article v-for="tier in tiers" :key="tier.id" class="world-tier">
        <header>
          <h4>{{ tier.label }} <small>{{ tier.grid }}×{{ tier.grid }} room</small></h4>
          <span v-if="tier.current" class="ui-chip is-good">Yours</span>
          <b v-else>{{ money(tier.cost) }}</b>
        </header>
        <p>{{ tier.blurb }}{{ tier.groundRent ? ` Ground rent ${money(tier.groundRent)} a week.` : ' No ground rent.' }}{{ tier.current ? '' : ` Takes about ${tier.minutes} minutes to build.` }}</p>
        <template v-if="!tier.current">
          <button type="button" class="ui-button is-primary is-block" :disabled="Boolean(tierWhy(tier, offline)) || pending !== null" @click="upgrade(tier.id)">Upgrade · {{ money(tier.cost) }}</button>
          <p v-if="tierWhy(tier, offline)" class="ui-why">{{ tierWhy(tier, offline) }}</p>
        </template>
      </article>
    </div>
    <h3>Look</h3>
    <div v-for="field in STYLE_FIELDS" :key="field" class="world-style">
      <b>{{ FIELD_NAMES[field] }}</b>
      <div class="world-swatches">
        <button
          v-for="option in estate.styles[field]" :key="option.index" type="button" class="world-swatch" :class="{ 'is-chosen': option.chosen }" :aria-pressed="option.chosen"
          :disabled="swatchOff(option, cash, offline) || pending !== null" :title="swatchTitle(option, cash)" @click="style(field, option.index)"
        ><i v-if="option.hex" :style="{ background: option.hex }" />{{ swatchLabel(option) }}</button>
      </div>
    </div>
    <ResidenceCard />

  </section>
</template>
