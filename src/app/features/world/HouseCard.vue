<script setup lang="ts">
// The card of a house tapped on the map: its address, its look, and its owner, unless the owner
// is hidden from the directory, in which case it is a neighbour's house and nothing more. Opened
// as a modal with { house } as the map hands it over.
import '../../../ui/controls.css'
import { computed } from 'vue'
import { useApp } from '../../state/app.ts'
import HouseArt from './HouseArt.vue'
import { HOUSE_TIERS, addressLabel, lgaOf, unpackStyle } from './worldContent.ts'
import { asMapHouse, track } from './worldModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()

const house = computed(() => asMapHouse((props.params as { house?: unknown } | null | undefined)?.house))
const city = computed(() => game.cityId.value)
const unit = computed(() => (house.value ? lgaOf(city.value, house.value.lga) : null))
const look = computed(() => (house.value ? unpackStyle(house.value.style) : null))
const address = computed(() => (house.value ? addressLabel(city.value, house.value.lga, house.value.estate, house.value.plot) : ''))

function openOwner(): void {
  const owner = house.value
  if (!owner?.id) return
  track('neighbour_card_opened', { from: 'map' })
  shell.open('person', { player: owner.id, name: owner.name })
}
</script>

<template>
  <p v-if="!house || !unit || !look" class="ui-error">That house is not on this map.</p>
  <div v-else data-house-card>
    <HouseArt :look="look.style" :tier="look.tier" :scaffold="house.upgrading" />
    <p class="ui-note">{{ HOUSE_TIERS[look.tier].label }} · {{ address }}{{ house.upgrading ? ' · being upgraded' : '' }}</p>
    <template v-if="house.you">
      <p class="world-now"><b>Your house</b><small>This is where you live.</small></p>
      <button class="ui-button is-primary is-block" type="button" @click="shell.open('houses')">Style or upgrade it</button>
    </template>
    <template v-else-if="house.id">
      <p class="world-now"><b><i class="world-dot" :class="{ 'is-on': house.online }" />{{ house.name }}</b><small>{{ house.online ? 'Online now' : 'Not online' }}</small></p>
      <button class="ui-button is-primary is-block" type="button" @click="openOwner">Open their card · chat, add friend, knock</button>
    </template>
    <template v-else>
      <p class="world-now"><b>A neighbour</b><small>This player is not listed in the directory, so their name is not shown.</small></p>
    </template>
    <button class="ui-button is-block" type="button" @click="shell.open('lga', { lga: house.lga })">About {{ unit.name }}</button>
  </div>
</template>

<style scoped>
.world-now { display: grid; gap: 2px; margin: 0; }
.world-now b { font-size: 17px; }
.world-now small { color: #59616b; font-size: 12px; }
.world-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #c2c8cc; margin-right: 6px; }
.world-dot.is-on { background: #33d17a; }
</style>
