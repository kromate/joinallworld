<script setup lang="ts">
// "Your own house": the section the Houses app shows first. The look (free and priced options),
// upgrades (paid, built on server time) and moving in. A life without a place is sent to Profile to
// choose where it lives. Rules and prices: src/game/systems/estate.ts, src/game/content/world.ts.
//
// Actions: 'estate.style' { style: { field: index } }, 'estate.upgrade' { to } and 'estate.move-in'.
import '../../../ui/panels/world.css'
import { computed } from 'vue'
import type { HouseStyleField } from '../../../types/life.ts'
import type { HouseTierId } from '../../../types/life.ts'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'
import { useAct } from '../kit/act.ts'
import HouseArt from '../world/HouseArt.vue'
import { STYLE_FIELDS } from '../world/worldContent.ts'
import { focusMap, track, worldChanged } from '../world/worldModel.ts'
import { FIELD_NAMES, afterStyle, minutesToGo, offeredTiers, offlineWhy, swatchLabel, swatchOff, swatchTitle, tierWhy } from './myHouseModel.ts'
import { linkWords } from './travelBoundary.ts'

const { game, shell, command } = useApp()
const { act, pending } = useAct()
const estate = computed(() => game.view.value.estate)
const cash = computed(() => game.state.value.cash)
const offline = computed(() => offlineWhy(game.view.value.connected, linkWords(game.view.value)?.short))
const tiers = computed(() => offeredTiers(estate.value.tiers))

async function style(field: HouseStyleField, index: number): Promise<void> {
  const accepted = await act(`style:${field}:${index}`, () => command('estate.style', { style: { [field]: index } }))
  // Only an accepted change is announced: the maps redraw and the event is recorded after the server said yes.
  afterStyle(accepted, () => { track('house_styled'); worldChanged() })
}
const upgrade = (to: HouseTierId): Promise<boolean> => act(`upgrade:${to}`, () => command('estate.upgrade', { to }))
const moveIn = (): Promise<boolean> => act('move-in', () => command('estate.move-in'))
function showOnMap(): void {
  const plot = estate.value.plot
  if (!plot) return
  shell.open('map')
  focusMap({ plot })
}
</script>

<template>
  <section v-if="estate && !estate.placed" class="world-card">
    <h3>Your own house</h3>
    <p class="ui-note">Everyone gets a starter house on their own plot, free — in the local government they choose.</p>
    <button type="button" class="ui-button is-primary is-block" @click="shell.open('profile')">Choose where you live</button>
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
    <span v-if="estate.living === 'own'" class="ui-chip is-good">You live here · no weekly rent</span>
    <template v-else>
      <button type="button" class="ui-button is-primary is-block" :disabled="Boolean(offline) || pending !== null" @click="moveIn">Move into your own house · free</button>
      <p class="ui-note">Weekly rent stops. Your furniture comes with you; what does not fit goes to storage.</p>
    </template>
    <button v-if="estate.plot" type="button" class="ui-button is-block" @click="showOnMap">Show it on the map</button>
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
    <h3>Bigger houses</h3>
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
  </section>
</template>
