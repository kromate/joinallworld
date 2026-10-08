<script setup lang="ts">
import '../../../ui/controls.css'
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { COMMERCE_CATEGORIES } from '../../../types/commerce.ts'
import type { CommerceCategory, CommerceDirectory, CommerceListing, CommerceResponse } from '../../../types/commerce.ts'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import GameIcon from '../../ui/GameIcon.vue'
import { addressLabel } from '../world/worldContent.ts'
import { clearStoreReturn } from './connectionReturn.ts'

const props = defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const result = ref<CommerceResponse | null>(null), loading = ref(true), busy = ref(false), error = ref(''), notice = ref('')
const tab = ref<'mine' | 'explore'>('mine'), editing = ref(false)
const name = ref(''), description = ref(''), category = ref<CommerceCategory>('food'), serviceArea = ref(''), adultAndTerms = ref(false)
const shops = ref<CommerceListing[]>([]), next = ref<string | null>(null), browseLoading = ref(false), browseError = ref('')
const shop = computed(() => result.value?.commerce)
const offline = computed(() => !game.view.value.connected)
const details = computed(() => shop.value?.overview)
const connected = computed(() => shop.value?.connection === 'connected')
const address = computed(() => result.value?.address)
const locationText = computed(() => address.value ? addressLabel(address.value.city, address.value.lga, address.value.estate, address.value.plot) : '')
const filter = computed(() => {
  const params = props.params
  if (!params || typeof params !== 'object') return {}
  return { ...('lga' in params && typeof params.lga === 'string' ? { lga: params.lga } : {}), ...('owner' in params && typeof params.owner === 'string' ? { owner: params.owner } : {}) }
})
const failure = (value: unknown): string => value instanceof Error ? ('reason' in value && typeof value.reason === 'string' ? value.reason : value.message) : 'Something went wrong. Try again.'
const money = (amount: number, currency = 'NGN'): string => new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount / 100)
const categoryName = (id: CommerceCategory): string => COMMERCE_CATEGORIES.find(item => item.id === id)?.name ?? 'Shop'
const checkedAt = computed(() => shop.value?.observedAt ? new Date(shop.value.observedAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '')

function apply(answer: CommerceResponse): void {
  result.value = answer
  if (answer.commerce && !editing.value) { name.value = answer.commerce.name; description.value = answer.commerce.description; category.value = answer.commerce.category; serviceArea.value = answer.commerce.serviceArea }
}
async function load(refresh = false): Promise<void> {
  error.value = ''; loading.value = true
  try { apply(await game.fetchJson<CommerceResponse>(refresh ? '/api/commerce/refresh' : '/api/commerce', refresh ? { method: 'POST', body: { csrf: result.value?.csrf } } : {})) } catch (value) { error.value = failure(value) } finally { loading.value = false }
}
async function mutate(path: string, body: Record<string, unknown>): Promise<CommerceResponse | null> {
  if (busy.value || offline.value) return null
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const answer = await game.fetchJson<CommerceResponse>(path, { method: 'POST', body: { ...body, csrf: result.value?.csrf } })
    apply(answer)
    return answer
  } catch (value) { error.value = failure(value); return null } finally { busy.value = false }
}
async function save(): Promise<void> {
  const created = !shop.value
  if (await mutate(created ? '/api/commerce/start' : '/api/commerce/profile', { name: name.value, category: category.value, description: description.value, serviceArea: serviceArea.value, adultAndTerms: adultAndTerms.value })) {
    editing.value = false; notice.value = created ? 'Your starter store is saved. Connect Goalmatic to add products and start selling.' : 'Your store details are saved.'
  }
}
async function connect(): Promise<void> {
  if (busy.value || offline.value) return
  busy.value = true; error.value = ''
  try {
    const answer = await game.fetchJson<{ authorizationUrl: string }>('/api/commerce/connect', { method: 'POST', body: { csrf: result.value?.csrf } })
    const url = new URL(answer.authorizationUrl)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The store connection link is invalid.')
    globalThis.location.assign(url.href)
  } catch (value) { error.value = failure(value); busy.value = false }
}
async function disconnect(): Promise<void> {
  if (await mutate('/api/commerce/disconnect', {})) notice.value = 'Your store is disconnected and no longer listed. Your Goalmatic products and orders are kept.'
}
async function browse(more = false): Promise<void> {
  if (browseLoading.value) return
  browseLoading.value = true; browseError.value = ''
  const query = new URLSearchParams({ city: game.cityId.value, ...filter.value })
  if (more && next.value) query.set('after', next.value)
  try {
    const answer = await game.fetchJson<CommerceDirectory>(`/api/commerce/directory?${query}`)
    shops.value = more ? [...shops.value, ...answer.items] : answer.items; next.value = answer.next
  } catch (value) { browseError.value = failure(value) } finally { browseLoading.value = false }
}
watch(tab, value => { if (value === 'explore') void browse() })
watch(() => game.cityId.value, () => { shops.value = []; next.value = null; if (tab.value === 'explore') void browse() })
onMounted(async () => {
  await load()
  const params = props.params
  if (params && typeof params === 'object' && 'code' in params && 'state' in params && typeof params.code === 'string' && typeof params.state === 'string') {
    if (result.value?.signedIn) {
      if (await mutate('/api/commerce/connect/complete', { code: params.code, state: params.state })) notice.value = 'Store connected. Review your details, then open it to other players.'
      clearStoreReturn()
    }
  } else if (filter.value.lga || filter.value.owner) tab.value = 'explore'
})
</script>

<template>
  <div class="commerce-app" data-commerce-app>
    <div class="commerce-tabs" aria-label="Store views">
      <button type="button" :aria-pressed="tab === 'mine'" @click="tab = 'mine'">My Store</button>
      <button type="button" :aria-pressed="tab === 'explore'" @click="tab = 'explore'">Explore shops</button>
    </div>
    <p v-if="offline" class="ui-note" role="status">You are offline. Reconnect to update your store or check real earnings.</p>
    <template v-if="tab === 'mine'">
      <p v-if="error" class="ui-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="commerce-notice" role="status">{{ notice }}</p>
      <SkeletonRows v-if="loading && !result" :rows="3" label="Loading your store" />
      <button v-else-if="!result" class="ui-button" type="button" @click="load()">Try again</button>
      <section v-else-if="!result.signedIn" class="commerce-start">
        <GameIcon name="groceries" :size="32" />
        <h2>A little shop of your own</h2>
        <p>Sell real products from your place in Allworld. Your customers pay at checkout, and your game money stays yours to play with.</p>
        <button v-if="result.accountEnabled" type="button" class="ui-button is-primary" @click="shell.open('account', { intent: 'sign-in', mode: 'sign-in' })">Sign in to open a store</button>
        <p v-else class="ui-note">Store ownership needs a saved account. Sign-in is not available on this server yet.</p>
      </section>
      <section v-else-if="!address" class="commerce-start">
        <h2>Give your shop an address</h2>
        <p>Your starter store shares your home plot. Choose a place to live, then come back here.</p>
        <button type="button" class="ui-button is-primary" @click="shell.open('houses')">Choose my home</button>
      </section>
      <template v-else>
        <header class="commerce-heading">
          <h2>{{ shop?.name ?? 'Open your starter store' }}</h2>
          <p>{{ locationText }}</p>
          <span v-if="shop" class="commerce-status">{{ shop.published ? 'Open in Allworld' : 'Not listed yet' }}</span>
        </header>
        <form v-if="!shop || editing" class="commerce-form" @submit.prevent="save">
          <label>Store name<input v-model="name" required maxlength="60" autocomplete="organization" placeholder="What will your customers call it?"></label>
          <label>What do you sell?<select v-model="category"><option v-for="item in COMMERCE_CATEGORIES" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label>About your store<textarea v-model="description" maxlength="300" rows="3" placeholder="Tell visitors what they can find here." /></label>
          <label>Real delivery or pickup area<input v-model="serviceArea" required maxlength="160" placeholder="For example, Yaba pickup and Lagos delivery"></label>
          <p class="ui-note">Your virtual address and your real delivery area can be different. You handle products, delivery, returns and customer support.</p>
          <label v-if="!shop" class="commerce-check"><input v-model="adultAndTerms" type="checkbox" required><span>I am at least 18 and will fulfill the products I offer.</span></label>
          <div class="ui-cluster"><button class="ui-button is-primary" type="submit" :disabled="busy || offline">{{ busy ? 'Saving…' : shop ? 'Save details' : 'Create starter store' }}</button><button v-if="shop" class="ui-button" type="button" @click="editing = false">Cancel</button></div>
          <p v-if="!shop" class="ui-note">Free during the pilot. Opening a store does not spend your game money.</p>
        </form>
        <template v-else>
          <p>{{ shop.description || categoryName(shop.category) }}</p>
          <p class="ui-note">Delivery or pickup: {{ shop.serviceArea }}</p>
          <button class="ui-button is-small" type="button" @click="editing = true">Edit store details</button>
          <section v-if="!connected" class="commerce-connection">
            <h3>{{ shop.connection === 'expired' ? 'Reconnect your store' : 'Bring your products to Allworld' }}</h3>
            <p>Continue to Goalmatic to create or select your store, add products, and connect Paystack or BACH. Your existing account and products stay together.</p>
            <button class="ui-button is-primary" type="button" :disabled="!result.enabled || busy || offline" @click="connect">{{ busy ? 'Connecting…' : 'Continue with Goalmatic' }}</button>
            <p v-if="!result.enabled" class="ui-note">Commerce connections are not available on this server yet. Your store draft is saved.</p>
          </section>
          <template v-else>
            <section class="commerce-earnings" aria-labelledby="earnings-heading">
              <div class="commerce-section-title"><h3 id="earnings-heading">Real store earnings</h3><button class="ui-button is-small" type="button" :disabled="loading || offline" @click="load(true)">{{ loading ? 'Checking…' : 'Refresh' }}</button></div>
              <p v-if="result.connectionError" class="ui-error" role="status">{{ result.connectionError }}</p>
              <dl v-if="details" class="commerce-totals"><div><dt>Net sales collected</dt><dd>{{ money(details.summary.collectedMinor, details.summary.currency) }}</dd></div><div><dt>Refunded</dt><dd>{{ money(details.summary.refundedMinor, details.summary.currency) }}</dd></div><div><dt>Orders awaiting payment</dt><dd>{{ details.summary.pendingOrderCount }}</dd></div></dl>
              <p v-else class="ui-note">Refresh to check the latest figures from your store.</p>
              <p v-if="details?.environment === 'test'" class="ui-note">Private test store. These figures are test payments, not real earnings. Test stores cannot open to other players.</p>
              <p v-if="checkedAt" class="commerce-caption">Last checked {{ checkedAt }}.</p>
              <p class="ui-note">Sales are not a withdrawable balance. Your payment provider confirms settled funds and pays your own bank account. Game cash and Goalmatic credits are separate.</p>
              <a v-if="details?.payout.url || details?.payout.providerUrl" class="ui-button is-primary" :href="details.payout.url || details.payout.providerUrl || undefined" target="_blank" rel="noopener noreferrer">{{ details.paymentProvider === 'BACHS' ? 'Open BACH for withdrawals' : 'Open Paystack for settlements' }} <span class="commerce-external">↗</span></a>
              <p v-else class="ui-note">Manage withdrawals in your connected payment provider. No payout link is available for this connection yet.</p>
              <p class="commerce-caption">No deposits, player transfers, staking or betting.</p>
            </section>
            <div class="commerce-actions"><a v-if="details?.managementUrl" class="ui-button" :href="details.managementUrl" target="_blank" rel="noopener noreferrer">Manage products and orders ↗</a><a v-if="shop.storefrontUrl" class="ui-button" :href="shop.storefrontUrl" target="_blank" rel="noopener noreferrer">Visit storefront ↗</a></div>
            <button class="ui-button is-block" type="button" :disabled="busy || offline" @click="mutate('/api/commerce/publish', { published: !shop.published })">{{ busy ? 'Saving…' : shop.published ? 'Pause my Allworld listing' : 'Open to other players' }}</button>
            <details class="commerce-disconnect"><summary>Disconnect store</summary><p>This removes your Allworld listing and its access to earnings. Your Goalmatic store, products and orders remain.</p><button class="ui-button" type="button" :disabled="busy || offline" @click="disconnect">Disconnect and hide listing</button></details>
          </template>
        </template>
      </template>
    </template>
    <section v-else aria-label="Shops in this city">
      <div class="commerce-section-title"><h2>{{ filter.owner ? 'Shops at this home' : 'Shops around you' }}</h2><button class="ui-button is-small" type="button" :disabled="browseLoading" @click="browse()">Refresh</button></div>
      <p class="ui-note">Real products from player-owned stores. Check the seller’s delivery area before paying.</p>
      <p v-if="browseError" class="ui-error" role="alert">{{ browseError }}</p>
      <SkeletonRows v-if="browseLoading && !shops.length" :rows="3" label="Loading shops" />
      <p v-else-if="!shops.length" class="commerce-empty">No shops are open here yet. Your starter store could be the first.</p>
      <ul v-else class="commerce-list"><li v-for="item in shops" :key="item.id"><h3>{{ item.name }}</h3><p>{{ item.description || categoryName(item.category) }}</p><small>{{ addressLabel(item.address.city, item.address.lga, item.address.estate, item.address.plot) }}</small><small>Delivery or pickup: {{ item.serviceArea }}</small><a :href="item.storefrontUrl" target="_blank" rel="noopener noreferrer" class="ui-button">Shop real products ↗</a></li></ul>
      <button v-if="next" type="button" class="ui-button is-block" :disabled="browseLoading" @click="browse(true)">{{ browseLoading ? 'Loading…' : 'More shops' }}</button>
    </section>
  </div>
</template>

<style scoped>
.commerce-app { display: grid; gap: 18px; color: var(--c-ink, #202b36); }
.commerce-tabs { display: flex; border-bottom: 1px solid var(--c-line, #d9dfe3); gap: 8px; }
.commerce-tabs button { min-height: 44px; flex: 1; border: 0; background: none; color: inherit; font: inherit; padding: 10px; border-bottom: 3px solid transparent; }
.commerce-tabs button[aria-pressed="true"] { border-bottom-color: #85411e; font-weight: 700; }
.commerce-app h2 { margin: 0 0 6px; font-size: 21px; line-height: 1.25; }
.commerce-app h3 { margin: 0; font-size: 16px; }
.commerce-app p { line-height: 1.55; margin: 0; }
.commerce-start { display: grid; gap: 16px; padding: 14px 0; }
.commerce-heading p, .commerce-caption { color: #52606c; font-size: 12px; }
.commerce-status { display: inline-block; margin-top: 10px; font-size: 12px; font-weight: 700; }
.commerce-form, .commerce-connection { display: grid; gap: 16px; }
.commerce-form label { display: grid; gap: 6px; font-weight: 600; font-size: 13px; }
.commerce-form input:not([type="checkbox"]), .commerce-form select, .commerce-form textarea { width: 100%; box-sizing: border-box; border: 1px solid #9ca8b2; border-radius: 8px; padding: 11px 12px; min-height: 44px; font: inherit; background: #fff; color: #202b36; }
.commerce-form input::placeholder, .commerce-form textarea::placeholder { color: #606c76; }
.commerce-form .commerce-check { display: flex; align-items: flex-start; gap: 10px; font-weight: 400; }
.commerce-check input { width: 20px; height: 20px; accent-color: #85411e; flex-shrink: 0; }
.commerce-connection, .commerce-earnings { border-top: 1px solid #d9dfe3; padding-top: 22px; margin-top: 6px; }
.commerce-earnings { display: grid; gap: 14px; }
.commerce-section-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.commerce-section-title h2 { font-size: 18px; }
.commerce-totals { margin: 0; display: grid; gap: 12px; }
.commerce-totals div { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; }
.commerce-totals dt { font-size: 13px; }
.commerce-totals dd { margin: 0; font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.commerce-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.commerce-app a.ui-button { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; text-decoration: none; box-sizing: border-box; }
.commerce-notice { color: #195a3b; background: #edf8f1; padding: 12px; border-radius: 8px; }
.commerce-disconnect { padding-top: 12px; color: #52606c; font-size: 13px; }
.commerce-disconnect summary { cursor: pointer; padding: 12px 0; }
.commerce-disconnect p { margin-bottom: 12px; }
.commerce-list { list-style: none; margin: 18px 0; padding: 0; display: grid; gap: 24px; }
.commerce-list li { display: grid; gap: 8px; padding-bottom: 20px; border-bottom: 1px solid #d9dfe3; }
.commerce-list small { color: #52606c; line-height: 1.4; }
.commerce-empty { padding: 28px 0; }
.commerce-app :focus-visible { outline: 3px solid #85411e; outline-offset: 3px; }
.commerce-app button:disabled { opacity: .55; cursor: not-allowed; }
</style>
