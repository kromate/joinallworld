<script setup lang="ts">
// Services: real people showing real skills and services, from markets across the world. Three screens in one app: browse
// (filters, search, storefront cards), one shop's page, and "My shop" (the editor). Allworld holds no money and no contact
// details here: prices are the seller's own, paid outside, and the chat and pay links are released only by the shop page.
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { ShowcaseCard, ShowcasePage } from '../../../types/showcase.ts'
import EmptyState from '../../ui/EmptyState.vue'
import SkeletonRows from '../../ui/SkeletonRows.vue'
import StorefrontCard from './StorefrontCard.vue'
import ShopPage from './ShopPage.vue'
import ShopEditor from './ShopEditor.vue'
import { categoryList, directoryPath } from './showcaseModel.ts'

const props = defineProps<{ params?: unknown }>()
const { game } = useApp()
const view = game.view
const tab = ref<'browse' | 'mine'>('browse')
const selected = ref<string | null>(null)
const scope = ref<'here' | 'all'>('all')
const venue = ref('')
const category = ref('')
const query = ref('')
const shops = ref<ShowcaseCard[]>([])
const next = ref<string | null>(null)
const loading = ref(false)
const failed = ref('')
let ticket = 0

// Opened from a market's "Services here": that market first, and a way to see them all.
let seen: unknown = null
watch(() => props.params, (params) => {
  if (!params || params === seen) return
  seen = params
  const found = (params as { venue?: unknown }).venue
  if (typeof found === 'string' && found) { venue.value = found; scope.value = 'here'; void load(true) }
}, { immediate: true })

async function load(fresh: boolean): Promise<void> {
  const mine = ++ticket
  loading.value = true; failed.value = ''
  try {
    const page = await game.fetchJson<ShowcasePage>(directoryPath({ ...(scope.value === 'here' ? { city: view.value.cityId } : {}), ...(venue.value ? { venue: venue.value } : {}), category: category.value, q: query.value.trim(), ...(!fresh && next.value ? { after: next.value } : {}) }))
    if (mine !== ticket) return
    shops.value = fresh ? page.shops : [...shops.value, ...page.shops]
    next.value = page.next
  } catch (error) {
    if (mine === ticket) failed.value = error instanceof Error ? error.message : 'The list could not load.'
  } finally { if (mine === ticket) loading.value = false }
}
onMounted(() => { void load(true) })
watch([scope, category], () => { if (scope.value === 'all') venue.value = ''; void load(true) })
/** A search or a kind is set: an empty list then means "nothing matches", not "no shops at all". */
const filtered = computed(() => query.value.trim() !== '' || category.value !== '' || venue.value !== '' || scope.value === 'here')
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
      <ShopEditor v-if="tab === 'mine'" :city="view.cityId" :venue="venue" />
      <template v-else>
        <h2 class="sc-title">{{ heading }}</h2>
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
.sc-app { display: grid; gap: 12px; padding: 12px; align-content: start; }
.sc-tabs { display: flex; gap: 6px; }
.sc-tabs button { flex: 1; min-height: 44px; border: 1px solid rgb(0 0 0 / 16%); border-radius: 10px; background: transparent; font: inherit; }
.sc-tabs button.is-on { background: var(--c-fill, #eef1ef); font-weight: 600; }
.sc-title { margin: 0; font-size: 18px; }
.sc-lead { margin: 0; font-size: 13px; color: var(--c-faint, #6b737c); }
.sc-filters { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); align-items: end; }
.sc-filters label { display: grid; gap: 2px; font-size: 12px; }
.sc-filters input, .sc-filters select { min-height: 40px; font: inherit; }
.sc-chip { margin: 0; font-size: 13px; }
.sc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); }
.sc-hit { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; font: inherit; cursor: pointer; border-radius: 12px; }
.sc-hit:focus-visible, .sc-tabs button:focus-visible { outline: var(--focus); outline-offset: 2px; }
</style>
