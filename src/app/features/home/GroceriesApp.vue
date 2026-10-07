<script setup lang="ts">
// Groceries app: a grid of ingredients. Each card has a one-tap "Buy 1 pack" (the quick case) and a
// quantity stepper that fills a basket with one Order button (the weekly shop). Both ways work.
//
// "Buy 1 pack" sends one 'home.grocery-buy' { id, packs: 1 } per tap. It shows the price the server
// will charge, is disabled while not connected or while the balance does not cover it (the pure
// decision is quickBuy() in groceriesModel.ts), and confirms with the server's own message.
//
// Ordering sends the same 'home.grocery-buy' { id, packs } action, once per line of the basket, in
// the pack sizes the server quotes (3 packs, then single packs). Every price shown is
// view.home.groceries — the amount the server will charge after discounts — so the basket total is
// exactly what leaves the wallet. If the server refuses a line (the kitchen is full, the money ran
// out) ordering stops there, the refusal is shown, and what was not bought stays in the basket.
// Prices and pack sizes are original beta values (content/food.js).
import { computed, nextTick, ref } from 'vue'
import { useApp } from '../../state/app.ts'
import { INGREDIENTS, INGREDIENT_ORDER, RECIPES } from '../../../game/content/food.ts'
import { formatHour, lagosTime } from '../../../game/clock.ts'
import { LITRE_PRICE, TANK_LITRES } from '../../../game/conditions/power.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import { MAX_PACKS, groceriesRules, items, lineTotal, orderReason, orderedLine, quickBuy, quoteOf } from './groceriesModel.ts'
import { basket } from './groceriesState.ts'

defineProps<{ params?: unknown }>()

const { game, command } = useApp()
const view = game.view
const state = game.state
const catalogue = INGREDIENTS
const recipes = RECIPES
const order = INGREDIENT_ORDER
const usedBy = Object.fromEntries(order.map((id) => [id, Object.values(recipes).filter((recipe) => id in recipe.ingredients).map((recipe) => recipe.label)]))

const ordering = ref(false)
/** The ingredient whose one-tap purchase is on its way to the server, or null. */
const buying = ref<string | null>(null)
const offline = computed(() => (view.value.connected ? '' : `${linkWords(view.value)?.short ?? ''} — ordering needs the server`))

const cards = computed(() => order.map((id) => {
  const item = catalogue[id]
  if (!item) return null
  const have = state.value.inventory?.[id] ?? 0
  const packs = Math.min(MAX_PACKS, basket[id] || 0)
  const one = quoteOf(view.value.home?.groceries, item, 1)
  const quick = quickBuy({ quote: one, cash: state.value.cash, connected: view.value.connected, busy: ordering.value || buying.value !== null, label: item.label })
  const uses = usedBy[id]?.length ? `For ${usedBy[id]?.join(', ')}` : 'Kitchen staple'
  return { id, item, have, packs, one, quick, short1: view.value.connected && one.price > state.value.cash, uses, total: lineTotal(view.value.home?.groceries, item, packs) }
}).filter((card): card is NonNullable<typeof card> => card !== null))
const total = computed(() => cards.value.reduce((sum, card) => sum + card.total, 0))
const units = computed(() => cards.value.reduce((sum, card) => sum + card.packs * card.item.pack, 0))
const short = computed(() => (total.value > state.value.cash ? `Need ${money(total.value - state.value.cash)} more` : ''))
const why = computed(() => orderReason({ units: units.value, offline: offline.value, short: short.value, ordering: ordering.value, buying: buying.value !== null }))

/** The grid keeps the keyboard where it was: a button that was disabled while its answer was on the way gets it back, unless the player moved on. */
function keepFocus(selector: string): void {
  void nextTick(() => {
    const active = document.activeElement
    if (!active || active === document.body || active.tagName === 'DIALOG') document.querySelector<HTMLElement>(`${selector}:not(:disabled)`)?.focus({ preventScroll: true })
  })
}

// Petrol for the generator in the room (action 'home.refuel'): shown only to a player who has one placed.
const power = computed(() => view.value.home?.power)
const fuelLine = computed(() => {
  const info = power.value
  if (!info?.generator) return ''
  const light = info.grid ? '' : ` Light is off in ${info.district} until ${formatHour(lagosTime(info.until ?? 0).minuteOfDay / 60)}.`
  return `Generator: ${info.fuel} of ${TANK_LITRES} litres in the tank · ${money(LITRE_PRICE)} a litre.${light}`
})
const fuelling = ref(false)
const fuelRoom = computed(() => Math.max(0, Math.floor(TANK_LITRES - (power.value?.fuel ?? 0))))
async function refuel(litres: number): Promise<void> {
  if (fuelling.value || litres < 1) return
  fuelling.value = true
  try { if ((await command('home.refuel', { litres })).ok) game.toast(state.value.message, 'good') } finally { fuelling.value = false }
}

async function buyOne(id: string): Promise<void> {
  const item = catalogue[id]
  if (!item || buying.value || ordering.value) return
  buying.value = id
  let ok = false
  try { ok = (await command('home.grocery-buy', { id, packs: 1 })).ok } finally { buying.value = null }
  // A refusal was already shown with the server's reason; a purchase confirms itself.
  if (ok) game.toast(state.value.message || `${item.pack} × ${item.label} delivered to your kitchen.`, 'good')
  keepFocus(`[data-groceries-buy="${CSS.escape(id)}"]`)
}
function step(id: string, by: number): void { basket[id] = Math.max(0, Math.min(MAX_PACKS, (basket[id] || 0) + by)) }
function clear(): void { for (const id of Object.keys(basket)) delete basket[id] }
async function orderAll(): Promise<void> {
  if (ordering.value || buying.value) return
  ordering.value = true
  let bought = 0, refused = false
  try {
    for (const id of order) {
      const item = catalogue[id]
      while ((basket[id] || 0) > 0 && !refused && item) {
        const packs = (basket[id] ?? 0) >= 3 ? 3 : 1
        const result = await command('home.grocery-buy', { id, packs })
        if (result.ok) { basket[id] = (basket[id] ?? 0) - packs; bought += packs * item.pack } else refused = true
      }
      if (refused) break
    }
  } finally { ordering.value = false }
  // A refusal was already shown with the server's reason; say what did go through.
  const line = orderedLine(bought, refused)
  if (line) game.toast(line, 'good')
}
</script>

<template>
  <div class="groceries-app">
    <p class="groceries-intro">Balance <b>{{ money(state.cash) }}</b> · delivered to your kitchen at once.</p>
    <p v-if="offline" class="ui-why groceries-offline">{{ offline }}</p>
    <p v-if="fuelLine" class="groceries-intro groceries-fuel" :data-groceries-fuel="power?.source">{{ fuelLine }}
      <button type="button" class="ui-button is-small" :disabled="!view.connected || fuelling || fuelRoom < 1 || state.cash < LITRE_PRICE" @click="refuel(Math.min(5, fuelRoom))">{{ fuelling ? 'Buying…' : fuelRoom < 1 ? 'Tank full' : `Buy ${Math.min(5, fuelRoom)} ${Math.min(5, fuelRoom) === 1 ? 'litre' : 'litres'} · ${money(Math.min(5, fuelRoom) * LITRE_PRICE)}` }}</button>
    </p>
    <HowItWorks id="groceries-rules" page label="How ordering works" :rules="groceriesRules" />
    <ul class="groceries-grid">
      <li v-for="card in cards" :key="card.id" class="groceries-card" :class="{ 'is-picked': card.packs }">
        <span class="groceries-icon" aria-hidden="true"><GameIcon inline kind="food" :id="card.item.id" :emoji="card.item.icon" /></span>
        <strong>{{ card.item.label }}</strong>
        <small :title="card.uses">{{ card.uses }}</small>
        <p><b><template v-if="card.one.price < card.one.list"><s>{{ money(card.one.list) }}</s> </template>{{ money(card.one.price) }}</b> for {{ card.item.pack }} · have {{ card.have }}</p>
        <button type="button" class="groceries-buy" :data-groceries-buy="card.id" :aria-label="`Buy one pack of ${card.item.label} (${card.item.pack}) now for ${money(card.quick.price)}`" :disabled="Boolean(card.quick.blocked)" :title="card.quick.blocked || undefined" @click="buyOne(card.id)">{{ buying === card.id ? 'Buying…' : `Buy 1 pack · ${money(card.quick.price)}` }}</button>
        <span v-if="card.short1" class="groceries-why">{{ card.quick.blocked }}</span>
        <div class="groceries-step" role="group" :aria-label="`${card.item.label}: packs in the basket`">
          <button type="button" :aria-label="`One pack less of ${card.item.label}`" :disabled="!card.packs" @click="step(card.id, -1)">−</button>
          <output aria-live="polite">{{ card.packs * card.item.pack }}</output>
          <button type="button" :aria-label="`One pack more of ${card.item.label}`" :disabled="card.packs >= MAX_PACKS" @click="step(card.id, 1)">+</button>
        </div>
      </li>
    </ul>
    <div class="ui-sticky groceries-basket">
      <div>
        <small>{{ units ? `Basket · ${items(units)}` : 'Basket is empty' }}</small>
        <b>{{ money(total) }}</b>
        <span v-if="units && (offline || short)" class="ui-why">{{ offline || short }}</span>
      </div>
      <button v-if="units" type="button" class="ui-button is-small" @click="clear()">Clear</button>
      <button type="button" class="ui-button is-primary" :disabled="Boolean(why)" :title="why" @click="orderAll()">{{ ordering ? 'Ordering…' : 'Order' }}</button>
    </div>
  </div>
</template>

<style scoped src="../../../ui/panels/groceries.css"></style>
