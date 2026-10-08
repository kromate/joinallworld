<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { call, newClientId, refreshLife } from '../social/useSocial.ts'
import { loadStreet, readWorld } from './neighbourhoodStore.ts'
import type { LandBuyRequest, LandView } from '../../../types/land.ts'
const { game, shell } = useApp()
const land = ref<LandView | null>(null), busy = ref(false), message = ref(''), selected = ref<number | null>(null)
let retry: LandBuyRequest | null = null
const price = computed(() => land.value?.candidates.find((candidate) => candidate.plot === selected.value)?.price ?? null)
const money = (value: number) => `₦${value.toLocaleString('en-NG')}`
async function load(): Promise<void> {
  busy.value = true; message.value = ''
  try {
    const result = await readWorld<LandView>(`/api/world/land?city=${encodeURIComponent(game.cityId.value)}`)
    if (!result.ok) { message.value = result.reason; return }
    land.value = result
    if (!result.candidates.some((candidate) => candidate.plot === selected.value)) selected.value = null
  } finally { busy.value = false }
}
async function buy(): Promise<void> {
  if (busy.value || !game.connected.value || !land.value?.anchor) return
  if (!retry) {
    if (selected.value === null || price.value === null) return
    retry = { cityId: game.cityId.value, anchor: { ...land.value.anchor }, plot: selected.value, price: price.value, clientId: newClientId() }
  }
  busy.value = true; message.value = ''
  try {
    const result = await call<{ code: string; owned?: boolean; pending?: true }>('/api/world/land/buy', retry)
    if (!result.ok) {
      message.value = result.code === 'land_unavailable' ? 'That plot is no longer available. Refresh to see the remaining space.' : result.reason
      if (!result.transport) retry = null
      return
    }
    retry = null
    await refreshLife()
    await load()
    await loadStreet()
    message.value = result.pending ? 'Payment recorded. Refresh to finish confirming the land.' : 'Your compound now includes the adjoining plot.'
  } finally { busy.value = false }
}
function choose(plot: number): void { selected.value = plot; retry = null; message.value = '' }
onMounted(load)
</script>

<template>
  <section class="land-panel">
    <h2>Expand your lot</h2>
    <p>Buy free land beside your owned home. Your existing house and furniture stay in place.</p>
    <p v-if="!land && busy" role="status">Checking the plots beside your home…</p>
    <template v-if="land?.anchor">
      <p>Estate {{ land.anchor.estate + 1 }} · Street {{ Math.floor(land.anchor.plot / 14) + 1 }} · {{ land.extras.length }}/{{ land.maxExtras }} extra plots</p>
      <div class="plot-preview" aria-label="Your compound and adjoining plots">
        <template v-for="plot in [...land.extras, land.anchor.plot, ...land.candidates.map((candidate) => candidate.plot)].sort((a, b) => a - b)" :key="plot">
          <button v-if="land.candidates.some((candidate) => candidate.plot === plot)" type="button" class="plot-slot" :class="{ selected: selected === plot }" :disabled="busy" :aria-pressed="selected === plot" @click="choose(plot)">Plot {{ plot % 14 + 1 }}<small>Available</small></button>
          <span v-else class="plot-slot owned">Plot {{ plot % 14 + 1 }}<small>{{ plot === land.anchor.plot ? 'Your home' : 'Your yard' }}</small></span>
        </template>
      </div>
      <p v-if="land.pending" role="status">A purchase is awaiting confirmation. Refresh to recover its recorded outcome before making another purchase.</p>
      <p v-else-if="!land.candidates.length">{{ land.extras.length >= land.maxExtras ? 'Your compound is at its current expansion limit.' : 'There is no free adjoining plot on this street.' }}</p>
      <div v-if="selected !== null && price !== null" class="land-confirm">
        <p>Add plot {{ selected % 14 + 1 }} for <strong>{{ money(price) }}</strong>. This uses your in-game balance of {{ money(game.state.value.cash) }}.</p>
        <button class="ui-button" type="button" :disabled="busy || !game.connected.value || Boolean(land.pending) || game.state.value.cash < price" @click="buy()">{{ busy ? 'Confirming…' : `Buy adjoining plot · ${money(price)}` }}</button>
        <p v-if="game.state.value.cash < price" class="ui-why">Save {{ money(price - game.state.value.cash) }} more to buy this plot.</p>
        <p v-else-if="!game.connected.value" class="ui-why">Reconnect to buy this plot.</p>
      </div>
      <p class="ui-note">Land prices and the three-plot limit are provisional game rules. House upgrades and upstairs rooms are managed in Houses.</p>
    </template>
    <p v-else-if="!busy && !message">Settle into an owned home to expand its lot.</p>
    <button type="button" class="ui-button" @click="shell.open('houses')">House upgrades &amp; rooms</button>
    <p v-if="message" role="status">{{ message }}</p>
    <button v-if="retry" type="button" class="ui-button" :disabled="busy" @click="buy()">Retry the same purchase</button>
    <button type="button" class="ui-button" :disabled="busy" @click="load()">Refresh land</button>
  </section>
</template>

<style scoped>
.land-panel { padding: 8px 0; }
.plot-preview { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0; }
.plot-slot { min-width: 88px; min-height: 82px; padding: 12px; border: 2px solid var(--c-line); border-radius: var(--r-sm); background: var(--c-surface); color: var(--c-ink); font: inherit; text-align: center; }
button.plot-slot { cursor: pointer; }
.plot-slot small { display: block; margin-top: 8px; }
.plot-slot.owned { background: var(--c-green-pale); }
.plot-slot.selected { border-color: var(--c-green-dark); }
.land-confirm { padding: 12px 0; }
</style>
