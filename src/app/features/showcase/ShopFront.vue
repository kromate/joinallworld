<script setup lang="ts">
// What a buyer sees of a shop, top to bottom: the sign, the photos, About, the price list, the opening hours, who runs it. The
// shop page draws it around its Chat and Pay buttons; the editor's preview draws exactly the same thing from the draft, so what
// a seller sees is what a buyer will see. Prices are the seller's own, paid outside Allworld; the explanation is shown once.
import { computed } from 'vue'
import type { TrustBadge } from '../../../game/trust/index.ts'
import PhotoGallery from './PhotoGallery.vue'
import StorefrontCard from './StorefrontCard.vue'
import { PRICE_NOTE, openStatus, sellerPrice, weekLines, zoneOf } from './showcaseModel.ts'
import type { ShopFace } from './showcaseModel.ts'

const props = defineProps<{ shop: ShopFace; reportable?: boolean; now?: Date; badgeNote?: string }>()
const emit = defineEmits<{ report: [photo: string] }>()
const clock = computed(() => props.now ?? new Date())
const open = computed(() => openStatus(props.shop.hours, clock.value, zoneOf(props.shop.city)))
const week = computed(() => weekLines(props.shop.hours, open.value.today))
const face = computed(() => ({ ...props.shop, cover: null, from: null }))
const badge = computed<TrustBadge | null>(() => props.shop.badge)
</script>

<template>
  <div class="shf" data-shop-front>
    <StorefrontCard :shop="face" size="header" :now="clock" />
    <PhotoGallery :name="shop.name || 'Your shop'" :photos="shop.photos" :reportable="reportable" @report="emit('report', $event)" />
    <section class="shf-card" aria-labelledby="shf-about">
      <h3 id="shf-about">About</h3>
      <p class="shf-about">{{ shop.about || 'Your words about the shop show here.' }}</p>
    </section>
    <section class="shf-card" aria-labelledby="shf-services">
      <h3 id="shf-services">Services and prices</h3>
      <ul class="shf-list">
        <li v-for="item in shop.serviceList" :key="item.label">
          <div class="shf-what"><b>{{ item.label }}</b><span v-if="item.note" class="shf-note">{{ item.note }}</span></div>
          <span class="shf-price" :class="{ 'is-ask': !item.priceNaira }">{{ sellerPrice(item.priceNaira) }}</span>
        </li>
        <li v-if="!shop.serviceList.length" class="shf-empty">Your services show here.</li>
      </ul>
      <p class="shf-fine">{{ PRICE_NOTE }}. Allworld does not hold your money or take part in the deal.</p>
    </section>
    <section class="shf-card" aria-labelledby="shf-hours">
      <h3 id="shf-hours">Opening hours</h3>
      <p class="shf-now" :class="open.open ? 'is-open' : 'is-shut'">{{ open.text }}</p>
      <ul class="shf-week">
        <li v-for="line in week" :key="line.day" :class="{ 'is-today': line.today, 'is-closed': line.closed }" :aria-current="line.today ? 'date' : undefined"><span>{{ line.day }}</span><span>{{ line.text }}</span></li>
      </ul>
    </section>
    <p v-if="badge" class="shf-who"><span class="shf-tier" :class="`is-${badge.tier}`">{{ badge.label }}</span> {{ badge.name }}<template v-if="badge.complaints"> · {{ badge.complaints }} upheld {{ badge.complaints === 1 ? 'complaint' : 'complaints' }} in 90 days</template></p>
    <p v-else-if="badgeNote" class="shf-who">{{ badgeNote }}</p>
  </div>
</template>

<style scoped>
.shf { display: grid; gap: var(--s-3); }
.shf-card { display: grid; gap: var(--s-2); padding: var(--s-3) var(--s-4); background: #fff; border: 1px solid var(--c-line); border-radius: var(--r-md); }
.shf h3 { margin: 0; font-size: var(--t-lead); color: var(--c-ink); text-transform: none; letter-spacing: 0; }
.shf-about { margin: 0; white-space: pre-line; overflow-wrap: anywhere; font-size: 15px; line-height: 1.6; color: var(--c-ink-2); max-width: 62ch; }
.shf-list { list-style: none; margin: 0; padding: 0; display: grid; }
.shf-list li { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-3); padding: 10px 0; border-top: 1px solid var(--c-line); }
.shf-list li:first-child { border-top: 0; }
.shf-what { min-width: 0; display: grid; gap: 2px; }
.shf-what b { font-size: var(--t-body); overflow-wrap: anywhere; }
.shf-note { display: block; font-size: var(--t-small); line-height: 1.4; color: var(--c-muted); overflow-wrap: anywhere; }
.shf-price { flex: none; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.shf-price.is-ask { font-weight: 500; color: var(--c-muted); }
.shf-empty { color: var(--c-muted); font-size: var(--t-body); }
.shf-fine { margin: 0; padding-top: var(--s-2); border-top: 1px dashed var(--c-line); font-size: var(--t-small); color: var(--c-muted); }
.shf-now { margin: 0; font-weight: 700; font-size: var(--t-body); }
.shf-now.is-open { color: var(--c-green-dark); }
.shf-now.is-shut { color: var(--c-ink-2); }
.shf-week { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.shf-week li { display: flex; justify-content: space-between; gap: var(--s-3); padding: 4px 8px; border-radius: var(--r-xs); font-size: var(--t-body); font-variant-numeric: tabular-nums; }
.shf-week li.is-closed { color: var(--c-muted); }
.shf-week li.is-today { background: var(--c-green-soft); font-weight: 700; color: var(--c-green-dark); }
.shf-who { margin: 0; font-size: var(--t-body); }
.shf-tier { display: inline-block; padding: 1px 8px; border-radius: var(--r-pill); font-size: var(--t-small); font-weight: 600; background: var(--c-fill); }
.shf-tier.is-phone, .shf-tier.is-id, .shf-tier.is-business { background: var(--c-green-soft); color: var(--c-green-dark); }
</style>
