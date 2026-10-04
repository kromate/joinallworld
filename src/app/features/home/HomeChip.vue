<script setup lang="ts">
// The home chip (HUD). Shown at home: which house this is, the room's loading / empty / error
// state, the object the player tapped, and the shared kitchen inventory with a shortcut to
// Groceries. On the way home it says so; anywhere else, and in Buy mode, it shows nothing.
//
// Buy mode itself — the catalogue, the placement panel and the selected-object panel — is BuyMode.vue,
// fetched the first time Buy is opened. What the two share is homeState.ts; the conversation with
// the scene is homeScene.ts, which this chip starts because it is in the HUD from the first paint.
import { computed } from 'vue'
import { isDeparting } from '../../legacy/engine.ts'
import { KINDS, houseOf } from '../../legacy/content.ts'
import { linkWords } from '../../legacy/modules.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import StarRating from './StarRating.vue'
import { defOf, isBuying, objectOf, roomStatus } from './buyModel.ts'
import { retryRoom, startHome } from './homeScene.ts'
import { H, kitchenOpen, scene } from './homeState.ts'

const { game, shell, command } = useApp()
const state = game.state
const view = game.view
startHome()

const house = computed(() => houseOf(state.value))
const headingHome = computed(() => isDeparting(state.value) && state.value.activeAction?.id === 'home')
const atHome = computed(() => state.value.location === 'home')
const status = computed(() => roomStatus({ sceneStatus: scene.status, connected: view.value.connected, short: linkWords(view.value)?.short, placed: state.value.home?.items?.length ?? 0, grid: house.value.grid }))
const object = computed(() => {
  const def = defOf(H.selected ? objectOf(state.value, H.selected)?.itemId : undefined)
  return def ? { def, here: Boolean(KINDS[def.kind]?.spot) && KINDS[def.kind]?.spot === state.value.spot } : null
})
const kitchen = computed(() => view.value.home?.kitchen ?? [])
const words = computed(() => linkWords(view.value))
const canUnpack = computed(() => view.value.connected && !state.value.activeAction)
const unpackWhy = computed(() => (canUnpack.value ? undefined : words.value ? words.value.cannot('unpack') : 'Finish your current action first'))
</script>

<template>
  <div v-if="!atHome && headingHome" class="home-chip"><strong><GameIcon inline name="home" /> Heading home…</strong><small>{{ house.label }} · {{ house.district }}</small></div>
  <div v-else-if="atHome && !isBuying(view)" class="home-chip">
    <strong><GameIcon inline name="home" /> {{ house.label }} · {{ house.district }}</strong>
    <small role="status">{{ status.text }}</small>
    <button v-if="status.retry" type="button" class="home-chip-button" @click="retryRoom()">Try again</button>
    <span v-if="object" class="home-chip-object"><GameIcon inline kind="furniture" :id="object.def.id" :emoji="object.def.icon" /> {{ object.def.label }} <StarRating :count="object.def.stars" /><template v-if="object.here"> · actions are below</template></span>
    <div v-if="state.spot === 'kitchen'" class="home-kitchen">
      <button type="button" class="home-kitchen-toggle" :aria-expanded="kitchenOpen" @click="kitchenOpen = !kitchenOpen"><GameIcon inline name="groceries" /> In your kitchen ({{ kitchen.length }}) <i class="home-kitchen-caret" :class="{ 'is-open': kitchenOpen }" aria-hidden="true"><GameIcon inline name="chevron" /></i></button>
      <div v-if="kitchenOpen" class="home-kitchen-list">
        <span v-for="item in kitchen" :key="item.id"><GameIcon inline kind="food" :id="item.id" :emoji="item.icon" /> {{ item.label }} ×{{ item.count }}</span>
        <span v-if="!kitchen.length">Nothing yet</span>
      </div>
      <button v-if="view.home?.stocked === false" type="button" class="home-chip-button" :disabled="!canUnpack" :title="unpackWhy" @click="command('home.kitchen-unpack')">Unpack starter food</button>
      <button type="button" class="home-chip-button" @click="shell.open('groceries')"><GameIcon inline name="groceries" /> Order groceries</button>
    </div>
  </div>
</template>

<style src="../../../ui/panels/buy.css"></style>
