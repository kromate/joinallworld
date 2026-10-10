<script setup lang="ts">
// A shopfront drawn from a template's parameters (colours, logo, layout): no art. An awning in the shop's colour, the sign across
// the front with the logo, the name, the kind of shop and where it is, whether it is open now, the trust badge and, in a card,
// the cover photo. `size="card"` is the directory card; `size="header"` is the top of the shop page and the editor's preview.
import { computed } from 'vue'
import type { ShowcaseCategory, ShowcaseHours, ShowcaseIcon, ShowcaseTemplate } from '../../../types/showcase.ts'
import type { TrustBadge } from '../../../game/trust/index.ts'
import { CATEGORY_LABELS, ICON_GLYPHS, PRICE_NOTE, TEMPLATES, inkFor, openStatus, photoUrl, placeWords, sellerPrice, zoneOf } from './showcaseModel.ts'

const props = withDefaults(defineProps<{
  shop: {
    name: string; sign: string; template: ShowcaseTemplate; colours: readonly [string, string]; logo: ShowcaseIcon; category: ShowcaseCategory
    city?: string; venue?: string; slot?: number | null; cover?: string | null; from?: number | null; hours?: readonly (ShowcaseHours | null)[]; badge?: TrustBadge | null
  }
  size?: 'card' | 'header'
  /** The device clock; a test passes its own. */
  now?: Date
}>(), { size: 'card', now: undefined })
const layout = computed(() => TEMPLATES[props.shop.template].layout)
const style = computed(() => ({ '--sf-bg': props.shop.colours[0], '--sf-ink': inkFor(props.shop.colours[0]), '--sf-alt': props.shop.colours[1], '--sf-alt-ink': inkFor(props.shop.colours[1]) }))
const place = computed(() => (props.shop.city ? placeWords(props.shop.city, props.shop.venue ?? '') : ''))
const status = computed(() => (props.shop.hours ? openStatus(props.shop.hours, props.now ?? new Date(), props.shop.city ? zoneOf(props.shop.city) : undefined) : null))
</script>

<template>
  <article class="sf" :class="[`is-${layout}`, `is-${size}`]" :style="style" data-storefront>
    <div class="sf-awning" aria-hidden="true" />
    <div class="sf-sign"><span class="sf-logo" aria-hidden="true">{{ ICON_GLYPHS[shop.logo].glyph }}</span><b>{{ shop.sign || 'Your sign' }}</b></div>
    <div class="sf-body">
      <img v-if="shop.cover" class="sf-cover" :src="photoUrl(shop.cover)" alt="" loading="lazy" width="96" height="96">
      <div class="sf-text">
        <component :is="size === 'header' ? 'h2' : 'h3'" class="sf-name">{{ shop.name || 'Your shop' }}</component>
        <p class="sf-line">{{ CATEGORY_LABELS[shop.category] }}<template v-if="place"> · {{ place }}</template><template v-if="shop.slot"> · Stall {{ shop.slot }}</template></p>
        <p v-if="status || shop.badge" class="sf-tags">
          <span v-if="status" class="sf-pill" :class="status.open ? 'is-open' : 'is-shut'" data-open-status>{{ status.text }}</span>
          <span v-if="shop.badge" class="sf-pill is-badge" :class="`is-${shop.badge.tier}`">{{ shop.badge.label }}</span>
        </p>
        <p v-if="shop.from && size === 'card'" class="sf-from">From <b>{{ sellerPrice(shop.from) }}</b> <span>{{ PRICE_NOTE }}</span></p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.sf { border-radius: var(--r-lg); overflow: hidden; background: var(--sf-alt); color: var(--sf-alt-ink); box-shadow: var(--e-2); border: 1px solid rgb(0 0 0 / 12%); text-align: left; }
.sf-awning { height: 10px; background: repeating-linear-gradient(90deg, var(--sf-bg) 0 16px, color-mix(in srgb, var(--sf-bg) 55%, #fff) 16px 32px); }
.sf-sign { display: flex; align-items: center; gap: var(--s-2); padding: 10px var(--s-3); background: var(--sf-bg); color: var(--sf-ink); font-size: var(--t-lead); letter-spacing: .2px; overflow-wrap: anywhere; }
.sf-logo { font-size: 22px; line-height: 1; flex: none; }
.sf-body { display: flex; gap: var(--s-3); padding: var(--s-3); align-items: flex-start; }
.sf-cover { width: 72px; height: 72px; object-fit: cover; border-radius: var(--r-sm); flex: none; background: rgb(0 0 0 / 8%); }
.sf-text { min-width: 0; display: grid; gap: 4px; }
.sf-name { margin: 0; font-size: var(--t-title); line-height: 1.2; overflow-wrap: anywhere; color: inherit; text-transform: none; letter-spacing: 0; }
.sf-line { margin: 0; font-size: var(--t-body); opacity: .88; overflow-wrap: anywhere; }
.sf-tags { margin: 2px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.sf-pill { display: inline-block; padding: 2px 10px; border-radius: var(--r-pill); font-size: var(--t-small); font-weight: 600; line-height: 1.5; background: #fff; color: var(--c-ink-2); border: 1px solid rgb(0 0 0 / 10%); }
.sf-pill.is-open { background: var(--c-green-soft); color: var(--c-green-dark); border-color: transparent; }
.sf-pill.is-shut { background: var(--c-fill); color: var(--c-ink-2); }
.sf-pill.is-badge.is-phone, .sf-pill.is-badge.is-id, .sf-pill.is-badge.is-business { background: var(--c-blue-soft); color: #1d3f9a; border-color: transparent; }
.sf-from { margin: 2px 0 0; font-size: var(--t-body); }
.sf-from span { display: block; font-size: var(--t-micro); opacity: .8; }
.is-stacked .sf-body { flex-direction: column; }
.is-stacked.is-card .sf-cover { width: 100%; height: 120px; order: -1; }
.is-split .sf-sign { justify-content: flex-end; flex-direction: row-reverse; }
.is-banner .sf-sign { justify-content: center; }
.is-header .sf-sign { padding: 14px var(--s-4); font-size: 20px; }
.is-header .sf-logo { font-size: 28px; }
.is-header .sf-body { padding: var(--s-4); }
.is-header .sf-name { font-size: var(--t-heading); }
@media (max-width: 340px) { .sf-cover { width: 56px; height: 56px; } }
</style>
