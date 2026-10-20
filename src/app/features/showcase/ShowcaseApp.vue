<script setup lang="ts">
// Services: real people showing real skills and services, from markets across the world. Three screens in one app: browse
// (filters, search, storefront cards), one shop's page, and "My shop" (the editor). Allworld holds no money and no contact
// details here: prices are the seller's own, paid outside, and the chat and pay links are released only by the shop page.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { ShowcaseCard, ShowcasePage } from '../../../types/showcase.ts'
import EmptyState from '../../ui/EmptyState.vue'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import StorefrontCard from './StorefrontCard.vue'
import ShopPage from './ShopPage.vue'
import ShopEditor from './ShopEditor.vue'
import { closeTopOverlay } from './overlays.ts'
import { categoryList, directoryPath } from './showcaseModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game } = useApp()
const view = game.view
const tab = ref<'browse' | 'mine'>('browse')
const selected = ref<string | null>(null)
/** Opened from /shops or /services: My shop, with this kind of shop chosen for a new shop. */
const setup = ref('')
const scope = ref<'here' | 'all'>('all')
const venue = ref('')
const category = ref('')
const query = ref('')
const shops = ref<ShowcaseCard[]>([])
const next = ref<string | null>(null)
const loading = ref(false)
const failed = ref('')
let ticket = 0
let loadedAt = 0

// Opened from a market's "Services here": that market first, and a way to see them all.
let seen: unknown = null
watch(() => props.params, (params) => {
  if (!params || params === seen) return
  seen = params
  const wanted = (params as { setup?: unknown }).setup
  if (typeof wanted === 'string') { setup.value = wanted; tab.value = 'mine'; return }
  if ((params as { mine?: unknown }).mine === true) { tab.value = 'mine'; return }
  const shop = (params as { shop?: unknown }).shop
  // Opened from a shop's public link: that shop's page first.
  if (typeof shop === 'string' && /^SC-\d{1,16}$/.test(shop)) { selected.value = shop; return }
  const found = (params as { venue?: unknown }).venue
  if (typeof found === 'string' && found) { venue.value = found; scope.value = 'here'; void load(true) }
}, { immediate: true })

async function load(fresh: boolean): Promise<void> {
  const mine = ++ticket
  loading.value = true; failed.value = ''; loadedAt = Date.now()
  try {
    const page = await game.fetchJson<ShowcasePage>(directoryPath({ ...(scope.value === 'here' ? { city: view.value.cityId } : {}), ...(venue.value ? { venue: venue.value } : {}), category: category.value, q: query.value.trim(), ...(!fresh && next.value ? { after: next.value } : {}) }))
    if (mine !== ticket) return
    shops.value = fresh ? page.shops : [...shops.value, ...page.shops]
    next.value = page.next
  } catch (error) {
    if (mine === ticket) failed.value = error instanceof Error ? error.message : 'The list could not load.'
  } finally { if (mine === ticket) loading.value = false }
}
// The list stays current while the app is open: it is read again when the app or the window comes back into view, when the
// Browse tab or the list is shown again, every minute while it is on screen (a shop approved meanwhile appears), and on request.
const FRESH_MS = 15000, POLL_MS = 60000
const stale = (): boolean => tab.value === 'browse' && selected.value === null && !loading.value && document.visibilityState !== 'hidden'
function refreshSoon(): void { if (stale() && Date.now() - loadedAt > FRESH_MS) void load(true) }
let poll: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  void load(true)
  window.addEventListener('focus', refreshSoon); document.addEventListener('visibilitychange', refreshSoon)
  poll = setInterval(refreshSoon, POLL_MS)
})
onBeforeUnmount(() => { window.removeEventListener('focus', refreshSoon); document.removeEventListener('visibilitychange', refreshSoon); if (poll) clearInterval(poll) })
watch([tab, selected], () => { if (tab.value === 'browse' && selected.value === null && loadedAt > 0) void load(true) })
watch([scope, category], () => { if (scope.value === 'all') venue.value = ''; void load(true) })
/** A search or a kind is set: an empty list then means "nothing matches", not "no shops at all". */
const filtered = computed(() => query.value.trim() !== '' || category.value !== '' || venue.value !== '' || scope.value === 'here')
/** Escape: the photo viewer first, then the shop page back to the list; nothing left, the shell closes the app. */
defineExpose({ keys: (action: string): boolean => {
  if (action !== 'cancel') return false
  if (closeTopOverlay()) return true
  if (selected.value) { selected.value = null; return true }
  return false
} })
const heading = computed(() => (venue.value ? 'Services at this market' : scope.value === 'here' ? 'Services in this city' : 'Services from around the world'))
</script>

<template>
  <section class="sc-app" aria-label="Services">
    <ShopPage v-if="selected" :id="selected" @back="selected = null" />
    <template v-else>
      <div class="sc-tabs" role="tablist" aria-label="Services sections">
        <button type="button" role="tab" :aria-selected="tab === 'browse'" :class="{ 'is-on': tab === 'browse' }" @click="tab = 'browse'">Browse</button>
        <button type="button" role="tab" :aria-selected="tab === 'mine'" :class="{ 'is-on': tab === 'mine' }" @click="tab = 'mine'">My shop</button>
      </div>
      <ShopEditor v-if="tab === 'mine'" :city="view.cityId" :venue="venue" :setup="setup" />
      <template v-else>
        <div class="sc-head"><h2 class="sc-title">{{ heading }}</h2><button type="button" class="ui-button is-quiet is-small" :disabled="loading" aria-label="Refresh the list" @click="load(true)">{{ loading ? 'Refreshing…' : 'Refresh' }}</button></div>
        <p class="sc-lead">Real people show real skills and services here. You chat and pay them outside Allworld, with their own links. Allworld never holds your money.</p>
        <form class="sc-filters" role="search" @submit.prevent="load(true)">
          <label>Search<input v-model="query" type="search" maxlength="40" placeholder="Name, sign or service" enterkeyhint="search"></label>
          <label>Where<select v-model="scope"><option value="all">Everywhere</option><option value="here">This city</option></select></label>
          <label>Kind<select v-model="category"><option value="">All kinds</option><option v-for="item in categoryList" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <button class="ui-button" type="submit">Search</button>
        </form>
        <p v-if="venue" class="sc-chip">Showing this market only. <button type="button" class="ui-button is-quiet" @click="venue = ''; scope = 'here'; load(true)">Show the whole city</button></p>
        <p v-if="failed" class="ui-error" role="alert">{{ failed }} <button type="button" class="ui-button is-quiet" @click="load(true)">Try again</button></p>
        <ul v-if="shops.length" class="sc-list">
          <li v-for="shop in shops" :key="shop.id">
            <button type="button" class="sc-hit" @click="selected = shop.id"><StorefrontCard :shop="shop" /></button>
          </li>
        </ul>
        <SkeletonRows v-else-if="loading" :rows="2" label="Loading shops" />
        <EmptyState v-else-if="!failed && filtered" icon="buy" title="No shops match" text="Try another search, or look at every kind of shop in the world.">
          <button type="button" class="ui-button" @click="query = ''; category = ''; scope = 'all'; load(true)">Clear the search</button>
        </EmptyState>
        <EmptyState v-else-if="!failed" icon="buy" title="No shops here yet" text="Be the first to open one. Show what you do, with your own prices, and people can find you.">
          <button type="button" class="ui-button is-primary" @click="tab = 'mine'">Open My shop</button>
        </EmptyState>
        <button v-if="next" class="ui-button is-block" type="button" :disabled="loading" @click="load(false)">{{ loading ? 'Loading…' : 'Show more' }}</button>
      </template>
    </template>
  </section>
</template>

<style scoped>
.sc-app { display: grid; gap: 12px; padding: 0; align-content: start; min-width: 0; }
.sc-tabs { display: flex; gap: 6px; }
.sc-tabs button { flex: 1; min-height: 44px; border: 1px solid rgb(0 0 0 / 16%); border-radius: 10px; background: transparent; font: inherit; }
.sc-tabs button.is-on { background: var(--c-ink, #1b2230); border-color: var(--c-ink, #1b2230); color: #fff; font-weight: 600; }
.sc-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.sc-title { margin: 0; font-size: 18px; }
.sc-lead { margin: 0; font-size: 14px; color: var(--c-faint, #6b737c); }
.sc-filters { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: end; min-width: 0; }
.sc-filters label { display: grid; gap: 2px; min-width: 0; font-size: 12px; }
.sc-filters label:first-child, .sc-filters > button { grid-column: 1 / -1; }
.sc-filters input, .sc-filters select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 40px; font: inherit; }
.sc-filters > button { min-height: 44px; }
.sc-chip { margin: 0; font-size: 13px; }
.sc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
.sc-hit { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; font: inherit; cursor: pointer; border-radius: 12px; }
.sc-hit:focus-visible, .sc-tabs button:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
