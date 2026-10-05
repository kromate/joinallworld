<script setup lang="ts">
// Business: the Phone app. Two screens: "My business" (the cash box, stock, prices, rent, upgrades, closing; from any
// city) and "This market" (the stalls of the market the player stands in: buy, rate, chat with the owner, and rent a
// stall). Every rule and number is the server's (docs/BUSINESS.md): this screen shows what /api/business/ answers and
// sends the player's choices back. A paid request keeps its id until it is applied, so pressing again after a lost
// answer repeats the SAME request.
import { computed, reactive, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { BusinessTypeId, BusinessUpgradeId, MyBusinessResponse, MyShop, ShopCard, ShopItem, VenueShopsResponse } from '../../../types/business.ts'
import { money, plural } from '../../ui/format.ts'
import BaseButton from '../../ui/BaseButton.vue'
import EmptyState from '../../ui/EmptyState.vue'
import GameIcon from '../../ui/GameIcon.vue'
import HeroCard from '../../ui/HeroCard.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import CivicAction from '../civic/CivicAction.vue'
import CivicStatus from '../civic/CivicStatus.vue'
import { requestSlot } from '../civic/civicCore.ts'
import type { SendResult } from '../civic/civicCore.ts'
import { useCivic, useLoaded, useOffline } from '../civic/useCivic.ts'
import { buyWhy, changedPrices, collectWhy, mineKey, minePath, openWhy, orderOf, orderWhy, priceWords, pricesWhy, starMarks, starsLabel, untilWords, venueKey, venuePath } from './businessModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const server = useCivic()
const offline = useOffline()
const view = game.view
const state = game.state
const cityId = computed(() => view.value.cityId)
const here = computed(() => state.value.location)
const life = computed(() => view.value.business)

const market = useLoaded<VenueShopsResponse>({ key: () => venueKey(cityId.value, here.value), path: () => venuePath(cityId.value, here.value), maxAge: 15000 })
const own = useLoaded<MyBusinessResponse>({ key: () => mineKey(cityId.value), path: () => minePath(cityId.value), maxAge: 15000 })
const stalls = computed(() => market.item.value.data)
const mine = computed<MyShop | null>(() => own.item.value.data?.mine ?? null)
const bag = computed(() => own.item.value.data?.bag ?? [])
const atMarket = computed(() => stalls.value?.hosts === true)

// Opened from a market's "Shops here": that screen first. Otherwise the player's own business.
const tab = ref<'mine' | 'market'>('mine')
let seen: unknown = null
watch(() => props.params, (params) => { if (params && params !== seen) { seen = params; if ((params as { venue?: unknown }).venue) tab.value = 'market' } }, { immediate: true })

// What is being chosen, kept while the app is open: an order from the supplier, prices, a new stall.
const order = reactive<Record<string, number>>({})
const prices = reactive<Record<string, number>>({})
const draft = reactive<{ type: BusinessTypeId; name: string; colour: string; icon: string }>({ type: 'food', name: '', colour: 'gold', icon: '' })
const closing = ref(false)
const slots = { open: requestSlot(), stock: requestSlot(), collect: requestSlot(), rent: requestSlot(), upgrade: requestSlot(), close: requestSlot(), bag: requestSlot(), buy: requestSlot() }
watch(mine, (shop) => { for (const product of shop?.products ?? []) if (prices[product.id] === undefined) prices[product.id] = product.price }, { immediate: true })
const picked = computed(() => stalls.value?.types.find((type) => type.id === draft.type))
watch(picked, (type) => { if (type && !type.icons.includes(draft.icon)) draft.icon = type.icons[0] ?? '' }, { immediate: true })

/** Take what a write answered into the two caches, so both screens show it at once. */
function taken(result: SendResult): void {
  if ('mine' in result) server.put(mineKey(cityId.value), { city: cityId.value, mine: result.mine, bag: result.bag, limits: result.limits } as MyBusinessResponse)
  if (result.market) server.put(venueKey(cityId.value, here.value), result.market as VenueShopsResponse)
  if ('mine' in result && atMarket.value) market.reload()
  if (result.market) own.reload()
}
/** One paid request: the same id until it is applied. */
async function paid(slot: keyof typeof slots, tag: string, path: string, body: Record<string, unknown>, success: string): Promise<SendResult> {
  const result = await server.send(tag, path, { ...body, requestId: server.requestId(slots[slot], [cityId.value, path, body]) }, { success })
  server.requestDone(slots[slot], result)
  taken(result)
  return result
}
const step = (id: string, by: number): void => { order[id] = Math.max(0, (order[id] ?? 0) + by) }
async function buyStock(): Promise<void> {
  const items = Object.fromEntries(Object.entries(order).filter(([, units]) => units > 0))
  const result = await paid('stock', 'stock', '/api/business/stock', { items }, 'Stock is on the shelves.')
  if (result.ok) for (const id of Object.keys(order)) order[id] = 0
}
async function savePrices(): Promise<void> {
  if (!mine.value) return
  taken(await server.send('price', '/api/business/price', { prices: changedPrices(mine.value, prices) }, { success: 'Prices changed.' }))
}
const collect = (): Promise<SendResult> => paid('collect', 'collect', '/api/business/collect', {}, 'Collected.')
const payRent = (): Promise<SendResult> => paid('rent', 'rent', '/api/business/rent', {}, 'Rent paid.')
const upgrade = (id: BusinessUpgradeId): Promise<SendResult> => paid('upgrade', `upgrade:${id}`, '/api/business/upgrade', { upgrade: id }, 'Upgrade fitted.')
async function close(): Promise<void> { const result = await paid('close', 'close', '/api/business/close', {}, 'Your stall is closed.'); if (result.ok) closing.value = false }
const unpack = (): Promise<SendResult> => paid('bag', 'unpack', '/api/business/bag/stock', {}, 'Unpacked onto your stall.')
const sellBag = (): Promise<SendResult> => paid('bag', 'bag-return', '/api/business/bag/return', {}, 'The supplier took the goods back.')
const pack = (product: string, units: number): Promise<SendResult> => paid('bag', `pack:${product}`, '/api/business/bag', { venue: here.value, product, units }, 'Packed for the road.')
async function open(): Promise<void> {
  // No toast of its own: the game answers an opening with its own line ("<name> is open. Stock it and set your prices."), shown once.
  const result = await paid('open', 'open', '/api/business/open', { venue: here.value, type: draft.type, name: draft.name.trim(), colour: draft.colour, icon: draft.icon }, '')
  if (result.ok) { draft.name = ''; tab.value = 'mine' }
}
const buy = (card: ShopCard, item: ShopItem): Promise<SendResult> => paid('buy', `buy:${card.id}:${item.id}`, '/api/business/buy', { shop: card.id, product: item.id, units: 1 }, `${item.label} from ${card.name}.`)
async function rate(card: ShopCard, stars: number): Promise<void> { taken(await server.send(`rate:${card.id}`, '/api/business/rate', { shop: card.id, stars }, { success: 'Thanks for rating.' })) }
async function report(card: ShopCard): Promise<void> { await server.send(`report:${card.id}`, '/api/business/report', { shop: card.id, reason: 'name' }, { success: 'Reported. A moderator will look at it.' }) }

const chosen = computed(() => (mine.value ? orderOf(mine.value, order) : { units: 0, cost: 0 }))
const wallet = computed(() => ({ cash: state.value.cash, canSpend: life.value?.canSpend ?? 0, buyWhy: life.value?.buyWhy ?? '', offline: offline('buy') }))
const colourOf = (id: string): { bg: string; ink: string } => stalls.value?.colours.find((colour) => colour.id === id) ?? { bg: '#256b45', ink: '#ffffff' }
const others = computed(() => (stalls.value?.shops ?? []).filter((card) => !card.mine))
const rules = [
  'Rent a stall at any market. Buy stock from the supplier, set a price inside the fair range, and passers-by buy during market hours whether you are there or not.',
  'Takings wait in the cash box. Collect them from anywhere; restocking and pricing need you at your stall.',
  'Rent is taken from the cash box each week. If the box cannot cover it, takings go to it first, and after three days unpaid the market closes the stall and keeps what you owe.',
  'A stall that serves its customers gains stars; an empty or overpriced one loses them. More stars bring more customers.',
  'Other players can buy from you and rate you. Buying from a player uses money you earned from work, the same allowance as gifts.',
  'Everything is in-game naira. Nothing here can be bought with real money.',
]
</script>

<template>
  <div class="biz">
    <div class="ui-seg" role="group" aria-label="Business screens">
      <button type="button" :aria-pressed="tab === 'mine'" @click="tab = 'mine'">My business</button>
      <button type="button" :aria-pressed="tab === 'market'" @click="tab = 'market'">This market</button>
    </div>

    <!-- ---- my business ---- -->
    <template v-if="tab === 'mine'">
      <CivicStatus :item="own.item.value" @retry="own.reload" />
      <template v-if="own.item.value.data">
        <EmptyState v-if="!mine" icon="buy" title="You do not run a business yet" text="Rent a stall at any market, stock it and sell to the city and to other players. One stall per player for now.">
          <BaseButton v-if="atMarket" small variant="primary" @click="tab = 'market'">Rent a stall here</BaseButton>
          <BaseButton v-else small @click="shell.open('map')">Find a market on the Map</BaseButton>
        </EmptyState>
        <template v-else>
          <HeroCard :label="`${mine.typeLabel} · ${mine.venueName}, ${mine.cityName}`" :figure="mine.name" class="biz-hero">
            <p :aria-label="starsLabel(mine.stars, mine.ratings)"><span aria-hidden="true">{{ starMarks(mine.stars) }}</span> {{ mine.stars.toFixed(1) }} · about {{ plural(mine.customers, 'customer') }} a day</p>
          </HeroCard>
          <p v-if="mine.alert" class="biz-alert" role="alert">{{ mine.alert }}</p>

          <div class="biz-card biz-box">
            <div><small>Cash box</small><strong>{{ money(mine.till) }}</strong><small>Today {{ money(mine.today.takings) }} · {{ mine.today.sold }} sold · {{ mine.today.came }} came</small></div>
            <CivicAction primary :working="server.busy('collect')" :reason="collectWhy(mine, offline('collect'))" @click="collect">{{ mine.status !== 'closed' ? 'Collect' : mine.till > 0 ? 'Take what is left' : 'Clear it' }}</CivicAction>
          </div>

          <template v-if="mine.status === 'open'">
            <SectionTitle :note="`${mine.units} of ${mine.capacity} on the shelves`">Stock and prices</SectionTitle>
            <p v-if="!mine.here" class="biz-note">You are away from your stall. It keeps selling what is on the shelves; go to {{ mine.venueName }} in {{ mine.cityName }} to restock or change prices.</p>
            <ul class="biz-list biz-card">
              <li v-for="product in mine.products" :key="product.id" class="biz-product">
                <div class="biz-what"><strong>{{ product.label }}</strong><small>{{ product.stock }} in stock · costs {{ money(product.cost) }}{{ product.local ? ' here, where it comes from' : '' }}</small></div>
                <label class="biz-price">Price<input v-model.number="prices[product.id]" type="number" inputmode="numeric" :min="product.min" :max="product.max" step="10" :disabled="!mine.here" :aria-label="`Price of ${product.label}, ${money(product.min)} to ${money(product.max)}`"><small>{{ priceWords(prices[product.id] ?? product.price, product.base) }}</small></label>
                <div class="biz-step" role="group" :aria-label="`Units of ${product.label} to buy`">
                  <button type="button" :disabled="!mine.here || !(order[product.id] ?? 0)" :aria-label="`Fewer ${product.label}`" @click="step(product.id, -5)">−</button>
                  <output>{{ order[product.id] ?? 0 }}</output>
                  <button type="button" :disabled="!mine.here" :aria-label="`More ${product.label}`" @click="step(product.id, 5)">+</button>
                </div>
              </li>
            </ul>
            <div class="biz-actions">
              <CivicAction primary :working="server.busy('stock')" :reason="orderWhy(mine, order, state.cash, offline('restock'))" @click="buyStock">Buy stock · {{ money(chosen.cost) }}</CivicAction>
              <CivicAction :working="server.busy('price')" :reason="pricesWhy(mine, prices, offline('change prices'))" @click="savePrices">Save prices</CivicAction>
            </div>

            <template v-if="bag.length">
              <SectionTitle>Goods you carry</SectionTitle>
              <ul class="biz-list biz-card"><li v-for="line in bag" :key="line.id"><span>{{ line.label }}</span><b>{{ line.n }}</b></li></ul>
              <div class="biz-actions">
                <CivicAction primary :working="server.busy('unpack')" :reason="mine.here ? '' : `Go to ${mine.venueName} to unpack.`" @click="unpack">Unpack onto the stall</CivicAction>
                <CivicAction :working="server.busy('bag-return')" :reason="atMarket ? '' : 'A supplier at any market buys goods back.'" @click="sellBag">Sell back at half price</CivicAction>
              </div>
            </template>

            <SectionTitle>Rent</SectionTitle>
            <div class="biz-card biz-box">
              <div><small>{{ money(mine.rent) }} a week</small><strong>{{ mine.owed > 0 ? `${money(mine.owed)} overdue` : `Paid for ${untilWords(mine.paidUntil, view.now)}` }}</strong><small>{{ mine.owed > 0 && mine.closesAt ? `The market closes the stall in ${untilWords(mine.closesAt, view.now)} if it is still unpaid.` : 'The next week is taken from the cash box.' }}</small></div>
              <CivicAction :working="server.busy('rent')" :reason="offline('pay rent') ?? (state.cash < (mine.owed || mine.rent) ? `You need ${money(mine.owed || mine.rent)}.` : '')" @click="payRent">{{ mine.owed > 0 ? 'Pay it now' : 'Pay a week ahead' }}</CivicAction>
            </div>

            <SectionTitle>Upgrades</SectionTitle>
            <ul class="biz-list biz-card">
              <li v-for="item in mine.upgrades" :key="item.id">
                <div class="biz-what"><strong>{{ item.label }}</strong><small>{{ item.effect }}</small></div>
                <span v-if="item.owned" class="biz-owned">Fitted</span>
                <CivicAction v-else :working="server.busy(`upgrade:${item.id}`)" :reason="offline('upgrade') ?? (!mine.here ? 'Go to your stall.' : state.cash < item.cost ? `You need ${money(item.cost)}.` : '')" @click="upgrade(item.id)">{{ money(item.cost) }}</CivicAction>
              </li>
            </ul>

            <SectionTitle>Close the stall</SectionTitle>
            <div class="biz-card biz-box">
              <div><small>Closing returns half of what the stall and its upgrades cost, a part of the stock’s cost and the cash box.</small><strong>{{ money(mine.closeRefund) }} back</strong></div>
              <BaseButton v-if="!closing" small variant="danger" @click="closing = true">Close…</BaseButton>
              <span v-else class="biz-confirm"><CivicAction :working="server.busy('close')" :reason="offline('close') ?? ''" @click="close">Yes, close it</CivicAction><BaseButton small @click="closing = false">Keep it</BaseButton></span>
            </div>
          </template>
        </template>
      </template>
    </template>

    <!-- ---- this market ---- -->
    <template v-else>
      <CivicStatus :item="market.item.value" @retry="market.reload" />
      <template v-if="stalls">
        <EmptyState v-if="!stalls.hosts" icon="buy" title="No stalls here" :text="`${stalls.venueName} rents no stalls. Every city has a market that does.`">
          <BaseButton small @click="shell.open('map')">Find a market on the Map</BaseButton>
        </EmptyState>
        <template v-else>
          <p class="biz-note"><b>{{ stalls.venueName }}</b> · {{ stalls.stalls.taken }} of {{ stalls.stalls.total }} stalls taken · trading {{ stalls.hours.open }}:00–{{ stalls.hours.close }}:00<template v-if="stalls.known.length"> · known for {{ stalls.types.filter((type) => type.known).map((type) => type.label.toLowerCase().replace(/ (stall|kiosk)$/, '')).join(', ') }}</template></p>

          <SectionTitle :note="others.length ? plural(others.length, 'stall') : ''">Shops here</SectionTitle>
          <EmptyState v-if="!others.length" compact icon="buy" title="No other player trades here yet" :text="stalls.mine && stalls.shops.some((card) => card.mine) ? 'Yours is the only stall. Tell your friends where to find you.' : 'Be the first: rent a stall below.'" />
          <ul v-else class="biz-shops">
            <li v-for="card in others" :key="card.id" class="biz-card biz-shop">
              <header>
                <span class="biz-sign" :style="{ background: colourOf(card.colour).bg, color: colourOf(card.colour).ink }" aria-hidden="true"><GameIcon kind="ad" :emoji="card.icon" :size="24" /></span>
                <div class="biz-what"><strong>{{ card.name }}</strong><small>{{ card.typeLabel }} · <button type="button" class="biz-link" @click="shell.open('person', { player: card.owner.id, name: card.owner.name })">{{ card.owner.name }}</button></small>
                  <small :aria-label="starsLabel(card.stars, card.ratings)"><span aria-hidden="true">{{ starMarks(card.stars) }}</span> {{ card.stars.toFixed(1) }}{{ card.ratings ? ` · ${plural(card.ratings, 'rating')}` : '' }}</small></div>
                <BaseButton v-if="!card.blocked" small @click="shell.open('messages', { to: card.owner.id, name: card.owner.name })">Chat</BaseButton>
              </header>
              <ul class="biz-list">
                <li v-for="item in card.items" :key="item.id">
                  <div class="biz-what"><strong>{{ item.label }}</strong><small>{{ item.does }} · {{ item.stock > 0 ? `${item.stock} left` : 'sold out' }}</small></div>
                  <CivicAction primary :working="server.busy(`buy:${card.id}:${item.id}`)" :reason="buyWhy(card, item, wallet)" @click="buy(card, item)">Buy · {{ money(item.price) }}</CivicAction>
                </li>
              </ul>
              <div v-if="card.canRate" class="biz-rate" role="group" :aria-label="`Rate ${card.name}`"><span>Rate your purchase</span><button v-for="stars in 5" :key="stars" type="button" :aria-label="plural(stars, 'star')" @click="rate(card, stars)">★</button></div>
              <button type="button" class="biz-link biz-report" @click="report(card)">Report this stall</button>
            </li>
          </ul>

          <template v-if="!stalls.mine">
            <SectionTitle>Open a stall here</SectionTitle>
            <div class="biz-card biz-form">
              <div class="biz-types" role="group" aria-label="What to sell">
                <button v-for="type in stalls.types" :key="type.id" type="button" :aria-pressed="draft.type === type.id" @click="draft.type = type.id">{{ type.label }}</button>
              </div>
              <template v-if="picked">
                <p class="biz-note">{{ money(picked.setup) }} to open, with the first week’s rent paid. Then {{ money(picked.rent) }} a week. About {{ plural(picked.customers, 'customer') }} a day{{ picked.known ? ' (this market is known for it)' : '' }}; the stall holds {{ picked.capacity }}.</p>
                <ul class="biz-list"><li v-for="product in picked.products" :key="product.id"><div class="biz-what"><strong>{{ product.label }}</strong><small>{{ product.does }}</small></div><span class="biz-figures">costs {{ money(product.cost) }}<br>sells {{ money(product.min) }}–{{ money(product.max) }}</span></li></ul>
                <label>Name of your stall<input v-model="draft.name" :maxlength="stalls.limits.name.max" autocomplete="off" placeholder="Mama Put"></label>
                <div><span class="biz-label">Sign colour</span><div class="biz-swatches" role="group" aria-label="Sign colour"><button v-for="colour in stalls.colours" :key="colour.id" type="button" :aria-pressed="colour.id === draft.colour" :aria-label="colour.label" :title="colour.label" :style="{ background: colour.bg }" @click="draft.colour = colour.id" /></div></div>
                <div><span class="biz-label">Sign</span><div class="biz-swatches" role="group" aria-label="Sign"><button v-for="(icon, index) in picked.icons" :key="icon" type="button" :aria-pressed="icon === draft.icon" :aria-label="`Sign ${index + 1}`" @click="draft.icon = icon"><GameIcon kind="ad" :emoji="icon" :size="22" /></button></div></div>
                <CivicAction primary block :working="server.busy('open')" :reason="openWhy(stalls, picked, draft.name, state.cash, offline('open a stall'))" @click="open">Open a stall here · {{ money(picked.setup) }}</CivicAction>
              </template>
            </div>
          </template>
          <template v-else-if="stalls.wholesale.some((product) => stalls?.mine?.products.some((own) => own.id === product.id))">
            <SectionTitle :note="`bag: ${stalls.limits.bag - (life?.bagRoom ?? stalls.limits.bag)} of ${stalls.limits.bag}`">For the road</SectionTitle>
            <p class="biz-note">These come from {{ view.city.name }}, so they cost less here. Carry them to your stall in another city.</p>
            <ul class="biz-list biz-card">
              <li v-for="product in stalls.wholesale.filter((item) => stalls?.mine?.products.some((own) => own.id === item.id))" :key="product.id">
                <div class="biz-what"><strong>{{ product.label }}</strong><small>{{ money(product.cost) }} each here</small></div>
                <CivicAction :working="server.busy(`pack:${product.id}`)" :reason="offline('buy') ?? ((life?.bagRoom ?? 0) < 4 ? 'Your bag is full.' : state.cash < product.cost * 4 ? `You need ${money(product.cost * 4)}.` : '')" @click="pack(product.id, 4)">Pack 4 · {{ money(product.cost * 4) }}</CivicAction>
              </li>
            </ul>
          </template>
        </template>
      </template>
    </template>
    <HowItWorks id="business-rules" page label="How businesses work" :rules="rules" />
  </div>
</template>

<style scoped>
.biz { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
.biz-types { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.biz-types button { min-height: var(--tap); border: 0; border-radius: var(--r-sm); background: var(--c-fill); font: 600 13px var(--font); cursor: pointer; }
.biz-types button[aria-pressed=true] { background: var(--c-ink); color: #fff; }
.biz-types button:focus-visible { outline: var(--focus); outline-offset: 2px; }
:global(.ph.is-wide) .biz-types { grid-template-columns: repeat(4, minmax(0, 1fr)); max-width: 620px; }
.biz-note { font-size: 12.5px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-1) 2px !important; }
.biz-alert { margin: 0 !important; padding: 10px 14px; border-radius: var(--r-md); background: var(--c-red-soft); color: var(--c-red-dark); font-size: 13px !important; line-height: 1.4 !important; font-weight: 600; }
.biz-card { border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); padding: 12px 14px; }
.biz-box { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.biz-box > div { display: grid; gap: 2px; min-width: 0; }
.biz-box strong { font-size: var(--t-lead); font-variant-numeric: tabular-nums; }
.biz-box small, .biz-what small { color: var(--c-muted); font-size: 12px; line-height: 1.35; }
.biz-box :deep(.civic-action), .biz-list :deep(.civic-action) { flex: none; margin: 0; max-width: 160px; }
.biz-list { list-style: none; margin: 0; padding: 0; }
.biz-list.biz-card { padding: 0 14px; }
.biz-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); padding: 10px 0; border-bottom: 1px solid var(--c-line); font-size: 13px; min-height: var(--tap); }
.biz-list li:last-child { border-bottom: 0; }
.biz-what { display: grid; gap: 2px; min-width: 0; flex: 1; overflow-wrap: anywhere; }
.biz-what strong { font-size: 14px; }
.biz-product { flex-wrap: wrap; }
.biz-price { display: grid; gap: 2px; font-size: 11px; font-weight: 600; color: var(--c-muted); margin: 0 !important; }
.biz-price input { width: 84px; min-height: var(--tap); font-variant-numeric: tabular-nums; }
.biz-price small { font-weight: 500; }
.biz-step { display: flex; align-items: center; gap: 4px; }
.biz-step button { width: var(--tap); height: var(--tap); border: 0; border-radius: 50%; background: var(--c-fill); font: 700 18px var(--font); cursor: pointer; }
.biz-step button:disabled { opacity: .4; cursor: not-allowed; }
.biz-step button:focus-visible, .biz-rate button:focus-visible, .biz-swatches button:focus-visible, .biz-link:focus-visible { outline: var(--focus); outline-offset: 2px; }
.biz-step output { min-width: 28px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.biz-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.biz-actions :deep(.civic-action) { flex: 1 1 140px; display: grid; margin: 0; }
.biz-owned { font-size: 12px; font-weight: 700; color: var(--c-green-dark); }
.biz-confirm { display: flex; gap: 6px; align-items: start; }
.biz-shops { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); }
.biz-shop > header { display: flex; align-items: center; gap: var(--s-3); padding-bottom: 8px; border-bottom: 1px solid var(--c-line); }
.biz-sign { flex: none; display: grid; place-items: center; width: 44px; height: 44px; border-radius: var(--r-sm); font-size: 22px; box-shadow: inset 0 0 0 1px #0000001a; }
.biz-link { border: 0; background: none; padding: 0; font: inherit; color: var(--c-green-dark); text-decoration: underline; cursor: pointer; }
.biz-report { display: block; margin: 6px 0 0 auto; font-size: 11px; color: var(--c-muted); min-height: 24px; }
.biz-rate { display: flex; align-items: center; gap: 2px; padding-top: 8px; border-top: 1px solid var(--c-line); font-size: 12.5px; font-weight: 600; }
.biz-rate span { margin-right: auto; }
.biz-rate button { width: 36px; height: var(--tap); border: 0; background: none; font-size: 22px; color: var(--c-amber, #e8a643); cursor: pointer; }
.biz-form { display: grid; gap: var(--s-3); }
.biz-form label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; margin: 0 !important; }
.biz-label { display: block; margin: 0 0 5px; font-size: 13px; font-weight: 600; }
.biz-figures { flex: none; text-align: right; font-size: 11.5px; line-height: 1.4; color: var(--c-muted); font-variant-numeric: tabular-nums; }
.biz-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.biz-swatches button { width: var(--tap); height: var(--tap); border-radius: var(--r-sm); border: 2px solid transparent; cursor: pointer; font-size: 20px; background: var(--c-fill); box-shadow: inset 0 0 0 1px #0000001a; }
.biz-swatches button[aria-pressed=true] { border-color: var(--c-ink); box-shadow: 0 0 0 2px #fff inset; }
:global(.ph.is-wide) .biz-shops { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); align-items: start; }
:global(.ph.is-wide) .biz-form input { max-width: 460px; }
</style>
