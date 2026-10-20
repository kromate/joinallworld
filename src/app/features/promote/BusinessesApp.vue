<script setup lang="ts">
// Businesses (docs/PROMOTE.md): every business and service of the city, free to list, and cheap weeks of a Sponsored card for those who
// want more customers. Paid to Allworld only, by card, transfer or mobile money through Bachs, or by bank transfer; a refused listing says why.
import '../../../ui/controls.css'
import '../../../ui/panels/social.css'
import '../feed/feed.css'
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { mediaUrl, uploadMedia } from '../feed/feedApi.ts'
import { encodePhoto } from '../feed/feedMedia.ts'
import { CATEGORIES, PROMOTE, TIERS, naira } from '../../../promote/model.ts'
import type { Tier } from '../../../promote/model.ts'
import type { ListingView, PromoteMe } from '../../../types/promote.ts'
import type { StreetView } from '../../../types/neighbourhood.ts'
import ShopFront from './ShopFront.vue'
import { isPlayApp } from '../../playMode.ts'

const props = defineProps<{ params?: { tab?: string; paid?: string; listing?: string } | null }>()
const { game, shell } = useApp()
const playApp = isPlayApp()
const tab = ref<'directory' | 'street' | 'mine'>(props.params?.tab === 'mine' ? 'mine' : props.params?.tab === 'street' || props.params?.listing ? 'street' : 'directory')
// The business street: every live listing of the city as a shop front, by kind (GET /api/promote/street). A billboard's tap opens it with that business first.
const street = ref<StreetView | null>(null)
const opened = computed(() => street.value?.groups.flatMap((g) => g.listings).find((l) => l.id === props.params?.listing) ?? null)
const listings = ref<ListingView[]>([]), category = ref(''), me = ref<PromoteMe | null>(null), busy = ref(false)
const form = ref({ id: '', name: '', category: 'food', area: '', about: '', photo: '' as string })
const boosting = ref<{ listing: string; tier: Tier; weeks: number; email: string; arcon: string } | null>(null), bank = ref<{ text: string; ref: string; amount: number } | null>(null)
const toast = (t: string, tone?: 'error'): void => game.toast(t, tone === 'error' ? 'error' : 'info')
type R<T> = ({ ok: true } & T) | { ok: false; reason: string }
const call = async <T,>(path: string, body?: object): Promise<R<T>> => { try { return await game.fetchJson(path, body ? { method: 'POST', body } : undefined) } catch (e) { return { ok: false, reason: (e as { reason?: string }).reason ?? 'That did not go through.' } } }
async function loadDirectory(): Promise<void> { const r = await call<{ listings: ListingView[] }>(`/api/promote/directory?city=${encodeURIComponent(game.view.value.cityId)}${category.value ? `&category=${category.value}` : ''}`); if (r.ok) listings.value = r.listings }
async function loadMe(): Promise<void> { const r = await call<PromoteMe>('/api/promote/me'); if (r.ok) me.value = r }
async function loadStreet(): Promise<void> { const r = await call<StreetView>(`/api/promote/street?city=${encodeURIComponent(game.view.value.cityId)}`); if (r.ok) street.value = r }
onMounted(() => { void loadDirectory(); void loadMe(); void loadStreet() })
watch(category, () => { void loadDirectory() })
watch(() => game.view.value.connected, (on, was) => { if (on && !was) { void loadDirectory(); void loadMe(); void loadStreet() } })
const prices = computed(() => me.value?.prices ?? { boost: TIERS.boost.price, spotlight: TIERS.spotlight.price })

function edit(l: ListingView | null): void { form.value = l ? { id: l.id, name: l.name, category: l.category, area: l.area, about: l.about, photo: l.photo ?? '' } : { id: '', name: '', category: 'food', area: '', about: '', photo: '' }; tab.value = 'mine' }
async function photo(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]; (event.target as HTMLInputElement).value = ''
  if (!file) return
  const blob = await encodePhoto(file); if (!blob) { toast('That photo could not be used.', 'error'); return }
  busy.value = true; const r = await uploadMedia(blob, 'post'); busy.value = false
  if (r.ok) form.value.photo = r.media.hash; else toast(r.reason, 'error')
}
async function save(): Promise<void> {
  busy.value = true
  const r = await call<{ listing: ListingView }>('/api/promote/listings', { ...(form.value.id ? { id: form.value.id } : {}), name: form.value.name, category: form.value.category, area: form.value.area, about: form.value.about, ...(form.value.photo ? { photo: form.value.photo } : {}) })
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  toast('Thanks. We check every listing first; it is usually live within minutes.')
  form.value = { id: '', name: '', category: 'food', area: '', about: '', photo: '' }
  await loadMe()
}
async function remove(l: ListingView): Promise<void> { if (!confirm(`Take ${l.name} out of the directory?`)) return; const r = await call('/api/promote/listings/remove', { id: l.id }); if (r.ok) await loadMe(); else toast(r.reason, 'error') }
async function order(): Promise<void> {
  const b = boosting.value; if (!b) return
  busy.value = true
  const r = await call<{ order: { ref: string; amount: number }; pay?: string; bank?: string }>('/api/promote/order', { listing: b.listing, tier: b.tier, weeks: b.weeks, ...(b.email ? { email: b.email } : {}), ...(b.arcon ? { arcon: b.arcon } : {}) })
  busy.value = false
  if (!r.ok) { toast(r.reason, 'error'); return }
  boosting.value = null
  if (r.pay) { location.assign(r.pay); return }
  bank.value = { text: r.bank ?? '', ref: r.order.ref, amount: r.order.amount }
  await loadMe()
}
const open = (l: ListingView): void => { void call('/api/promote/contact', { listing: l.id }); shell.open('person', { player: l.owner.id, name: l.owner.name }) }
const shop = (l: ListingView): void => { void call('/api/promote/contact', { listing: l.id }); shell.open('showcase', { shop: l.shop }) }
const status: Record<string, string> = { review: 'Being checked', live: 'Live', refused: 'Not accepted', removed: 'Removed' }
const orderWord: Record<string, string> = { pending: 'Waiting for payment', paid: 'Running', ended: 'Ended', cancelled: 'Cancelled' }
const when = (ms?: number): string => (ms ? new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '')
</script>

<template>
  <section class="feed" aria-label="Businesses" data-promote="app">
    <nav class="feed-tabs"><button type="button" :class="{ 'is-on': tab === 'directory' }" @click="tab = 'directory'">Near you</button><button type="button" :class="{ 'is-on': tab === 'street' }" @click="tab = 'street'">Business street</button><button type="button" :class="{ 'is-on': tab === 'mine' }" @click="tab = 'mine'">My business</button></nav>

    <template v-if="tab === 'street'">
      <p class="social-note">The business street of {{ street?.cityName ?? 'your city' }}: every business open to customers, kind by kind.<template v-if="!playApp"> Those with a running boost come first, and also stand on the city's billboards.</template></p>
      <ShopFront v-if="opened" :listing="opened" opened />
      <p v-if="street && !street.total" class="feed-note">No businesses on the street yet. Be the first: it is free.</p>
      <template v-for="g in street?.groups ?? []" :key="g.category">
        <h3 class="street-group">{{ g.label }}</h3>
        <ShopFront v-for="l in g.listings.filter((x) => x.id !== opened?.id)" :key="l.id" :listing="l" />
      </template>
      <button type="button" class="social-btn is-primary" @click="edit(null)">List my business, free</button>
    </template>

    <template v-else-if="tab === 'directory'">
      <p class="social-note">Real businesses and services in your city. Message them in the game, visit their shop, meet them in the world.</p>
      <select v-model="category" aria-label="Kind of business"><option value="">Everything</option><option v-for="[id, label] in CATEGORIES" :key="id" :value="id">{{ label }}</option></select>
      <p v-if="!listings.length" class="feed-note">No businesses listed here yet. Be the first: it is free.</p>
      <article v-for="l in listings" :key="l.id" class="feed-card" :data-listing="l.id">
        <div class="feed-head"><div class="feed-who"><b>{{ l.name }}</b><small>{{ l.categoryLabel }}<template v-if="l.area"> · {{ l.area }}</template> · {{ l.cityName }}<template v-if="!playApp && l.boosted"> · Sponsored</template></small></div></div>
        <img v-if="l.photo" class="feed-media" :src="mediaUrl(l.photo)" alt="" loading="lazy">
        <p v-if="l.about" class="feed-body">{{ l.about }}</p>
        <div class="feed-bar"><button type="button" @click="open(l)">Message {{ l.owner.name }}</button><button v-if="l.shop" type="button" @click="shop(l)">Visit shop</button></div>
      </article>
      <button type="button" class="social-btn is-primary" @click="edit(null)">List my business, free</button>
    </template>

    <template v-else>
      <p v-if="me && !me.account" class="feed-note">Sign in first (Settings → Account), so your business stays yours.</p>
      <p v-else-if="me && !me.adult" class="feed-note">Listing a business is for people confirmed as 18 or older.</p>
      <div v-for="l in me?.listings ?? []" :key="l.id" class="feed-card feed-form">
        <div class="feed-head"><div class="feed-who"><b>{{ l.name }}</b><small>{{ status[l.status] }}<template v-if="!playApp && l.boosted"> · Sponsored now</template></small></div><button type="button" class="feed-pill" @click="edit(l)">Edit</button><button type="button" class="feed-pill" @click="remove(l)">Remove</button></div>
        <p v-if="l.reason" class="feed-error">{{ l.reason }}</p>
        <div v-if="!playApp && l.status === 'live'" class="feed-row">
          <button v-for="tier in (['boost', 'spotlight'] as const)" :key="tier" type="button" class="social-btn" :disabled="me?.payment === 'closed'" @click="boosting = { listing: l.id, tier, weeks: 1, email: '', arcon: '' }">{{ TIERS[tier].label }} · {{ naira(prices[tier]) }}/week</button>
        </div>
        <p v-if="!playApp && l.status === 'live' && me?.payment === 'closed'" class="feed-note">Boosts open soon. Your free listing is live.</p>
      </div>

      <form v-if="!playApp && boosting" class="feed-card feed-form" @submit.prevent="order">
        <b>{{ TIERS[boosting.tier].label }}</b><p class="feed-note">{{ TIERS[boosting.tier].what }}.</p>
        <label>Weeks<input v-model.number="boosting.weeks" type="number" min="1" :max="PROMOTE.weeksMax"></label>
        <p class="feed-note">Total {{ naira(prices[boosting.tier] * Math.max(1, Math.min(PROMOTE.weeksMax, boosting.weeks || 1))) }}, paid to Allworld.</p>
        <label v-if="me?.payment === 'bachs'">E-mail for the receipt<input v-model="boosting.email" type="email" autocomplete="email"></label>
        <label>Advertising approval number (optional)<input v-model="boosting.arcon" maxlength="60" placeholder="If you have one"></label>
        <div class="feed-row"><button type="submit" class="social-btn is-primary" :disabled="busy">{{ me?.payment === 'bachs' ? 'Pay with card or transfer' : 'Get bank details' }}</button><button type="button" class="feed-pill" @click="boosting = null">Cancel</button></div>
      </form>
      <div v-if="!playApp && bank" class="feed-card feed-form"><b>Pay {{ naira(bank.amount) }} by bank transfer</b><p class="feed-body">{{ bank.text }}</p><p class="feed-note">Use the reference <b>{{ bank.ref }}</b>. Your boost starts once we see the payment.</p><button type="button" class="feed-pill" @click="bank = null">Done</button></div>

      <form v-if="me?.account && me?.adult" class="feed-card feed-form" @submit.prevent="save">
        <b>{{ form.id ? 'Edit your business' : 'List your business, free' }}</b>
        <label>Name<input v-model="form.name" :maxlength="PROMOTE.name" placeholder="Iya Basira Foods"></label>
        <label>Kind<select v-model="form.category"><option v-for="[id, label] in CATEGORIES" :key="id" :value="id">{{ label }}</option></select></label>
        <label>Area<input v-model="form.area" :maxlength="PROMOTE.area" placeholder="Yaba, Lagos"></label>
        <label>What you offer<textarea v-model="form.about" :maxlength="PROMOTE.about" placeholder="Amala and ewedu, delivery around Yaba" /></label>
        <label class="feed-pill">{{ form.photo ? 'Change the photo' : 'Add a photo' }}<input type="file" accept="image/*" hidden @change="photo"></label>
        <img v-if="form.photo" class="feed-media" :src="mediaUrl(form.photo)" alt="">
        <p class="feed-note">No phone numbers or links here: people message you in the game, and your Services shop holds your outside links.</p>
        <button type="submit" class="social-btn is-primary" :disabled="busy || form.name.trim().length < 2">{{ form.id ? 'Save' : 'List it' }}</button>
      </form>

      <template v-if="!playApp && me?.orders.length"><b>Boosts</b>
        <ul class="social-list"><li v-for="o in me.orders" :key="o.id" class="social-row"><div><strong>{{ o.listingName }} · {{ TIERS[o.tier].label }} · {{ o.weeks }} week{{ o.weeks === 1 ? '' : 's' }}</strong><small>{{ orderWord[o.status] }} · {{ naira(o.amount) }}<template v-if="o.endsAt"> · until {{ when(o.endsAt) }}</template> · {{ o.ref }}</small></div></li></ul>
      </template>
    </template>
  </section>
</template>
