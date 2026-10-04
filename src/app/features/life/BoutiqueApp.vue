<script setup lang="ts">
// Boutique (Phone app): buy hairstyles, outfits and fabrics with cash and wear them.
// Rules and prices: src/game/systems/onboarding.js ('onboarding.boutique-buy', 'onboarding.set-look')
// and content/traits.js (BOUTIQUE_PRICES — original beta prices). Draws view.onboarding.boutique.
//
// The 3D preview at the top shows your Sim. "Try on" puts an item on the preview only — nothing is
// bought or changed until Buy or Wear is pressed. The preview is the look stage of the character
// panels (src/ui/panels/look-ui.js).
import { computed } from 'vue'
import type { AccessoryId, Look } from '../../../types/life.ts'
import type { BoutiqueItem } from '../../../types/view.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import LookStage from '../start/LookStage.vue'
import { lookSummary, withAccessory, withoutAccessory } from '../start/lookModel.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { useAct } from '../kit/act.ts'
import { SECTIONS, itemControl, itemNote, nextTrying, triedItem, wearing } from './boutiqueModel.ts'
import { trying } from './boutiqueState.ts'

defineProps<{ params?: unknown }>()

const { game, command } = useApp()
const { act, pending } = useAct()
const view = game.view
const onboarding = computed(() => view.value.onboarding)
const offline = computed(() => { const words = view.value.connected ? null : linkWords(view.value); return words ? `${words.short} — you cannot shop right now` : '' })
const tried = computed(() => triedItem(onboarding.value.boutique, trying.value))
const shown = computed<Look>(() => (tried.value ? wearing(onboarding.value.look, tried.value, withAccessory) : onboarding.value.look))
const caption = computed(() => (tried.value ? `Trying on: ${tried.value.label}${tried.value.owned ? '' : ` · ${money(tried.value.price)}`}` : lookSummary(onboarding.value.look)))
const sections = computed(() => SECTIONS.map(([kind, title]) => ({ kind, title, items: onboarding.value.boutique.filter((item) => item.kind === kind) })))

function tryOn(item: BoutiqueItem): void { trying.value = nextTrying(trying.value, { kind: item.kind, id: item.id }) }
const wear = (item: BoutiqueItem): Promise<boolean> => act(`wear:${item.kind}:${item.id}`, () => command('onboarding.set-look', { look: wearing(onboarding.value.look, item, withAccessory) }))
const takeOff = (item: BoutiqueItem): Promise<boolean> => act(`off:${item.id}`, () => command('onboarding.set-look', { look: { ...onboarding.value.look, accessories: withoutAccessory(onboarding.value.look, item.id as AccessoryId) } }))
const buy = (item: BoutiqueItem): Promise<boolean> => act(`buy:${item.kind}:${item.id}`, () => command('onboarding.boutique-buy', { kind: item.kind, id: item.id }))
const isTrying = (item: BoutiqueItem): boolean => tried.value === item
</script>

<template>
  <div class="boutique-root">
    <div class="boutique-top">
      <LookStage :look="shown" variant="wide" :name="view.name" :caption="caption">
        <template v-if="tried" #tools><button type="button" class="look-tool" data-try="null" data-key="try:none" @click="trying = null">↶ Back to my look</button></template>
      </LookStage>
      <p>Wallet <strong>{{ money(game.state.value.cash) }}</strong><small>Try anything on first. Buying puts it on straight away and keeps it in your wardrobe. Styles shown fit your current body; colours are free in Sim → Profile.</small></p>
    </div>
    <template v-for="section in sections" :key="section.kind">
      <h3>{{ section.title }}</h3>
      <div class="boutique-grid">
        <article v-for="item in section.items" :key="`${item.kind}:${item.id}`" class="boutique-item" :class="{ 'is-wearing': item.wearing, 'is-trying': isTrying(item) }">
          <strong>{{ item.label }}</strong>
          <small>{{ itemNote(item, money) }}</small>
          <button v-if="!item.wearing" type="button" class="ui-button boutique-try" :data-key="`try:${item.kind}:${item.id}`" :aria-pressed="isTrying(item)" @click="tryOn(item)"><template v-if="isTrying(item)"><GameIcon inline name="check" /> Trying on</template><template v-else>Try on</template></button>
          <template v-for="control in [itemControl(item, { offline, done: onboarding.done })]" :key="control.kind">
            <template v-if="control.kind === 'take-off'">
              <button type="button" class="ui-button" :disabled="Boolean(control.why) || pending !== null" @click="takeOff(item)"><GameIcon inline name="check" /> Wearing · take off</button>
              <small v-if="control.why" class="boutique-why">{{ control.why }}</small>
            </template>
            <em v-else-if="control.kind === 'worn'" class="boutique-state"><GameIcon inline name="check" /> Wearing</em>
            <template v-else-if="control.kind === 'wear'">
              <button type="button" class="ui-button" :class="{ 'is-primary': !control.why }" :disabled="Boolean(control.why) || pending !== null" @click="wear(item)">Wear</button>
              <small v-if="control.why" class="boutique-why">{{ control.why }}</small>
            </template>
            <template v-else>
              <button type="button" class="ui-button" :class="{ 'is-primary': !control.why }" :disabled="Boolean(control.why) || pending !== null" @click="buy(item)">Buy · {{ money(item.price) }}</button>
              <small v-if="control.why" class="boutique-why">{{ control.why }}</small>
            </template>
          </template>
        </article>
      </div>
    </template>
    <p class="preview-note">Boutique prices are original beta values.</p>
  </div>
</template>

<style scoped src="../../../ui/panels/boutique.css"></style>
