<script setup lang="ts">
// A storefront card drawn from a template's parameters (colours, icon, layout): no art. The sign across the top, the logo,
// the name, the category and the stall, and the first public photo when there is one. Used by the directory, the shop page
// and the editor's live preview, so what a seller sees is what a buyer sees.
import { computed } from 'vue'
import type { ShowcaseCategory, ShowcaseIcon, ShowcaseTemplate } from '../../../types/showcase.ts'
import { CATEGORY_LABELS, ICON_GLYPHS, PRICE_NOTE, TEMPLATES, inkFor, photoUrl, sellerPrice } from './showcaseModel.ts'

const props = defineProps<{ shop: { name: string; sign: string; template: ShowcaseTemplate; colours: readonly [string, string]; logo: ShowcaseIcon; category: ShowcaseCategory; slot?: number | null; cover?: string | null; from?: number | null } }>()
const layout = computed(() => TEMPLATES[props.shop.template].layout)
const style = computed(() => ({ '--sf-bg': props.shop.colours[0], '--sf-ink': inkFor(props.shop.colours[0]), '--sf-alt': props.shop.colours[1], '--sf-alt-ink': inkFor(props.shop.colours[1]) }))
</script>

<template>
  <article class="sf" :class="`is-${layout}`" :style="style" data-storefront>
    <div class="sf-sign"><span class="sf-logo" aria-hidden="true">{{ ICON_GLYPHS[shop.logo].glyph }}</span><b>{{ shop.sign || 'Your sign' }}</b></div>
    <div class="sf-body">
      <img v-if="shop.cover" class="sf-cover" :src="photoUrl(shop.cover)" alt="" loading="lazy" width="96" height="96">
      <div class="sf-text">
        <h3>{{ shop.name || 'Your shop' }}</h3>
        <p>{{ CATEGORY_LABELS[shop.category] }}<template v-if="shop.slot"> · Stall {{ shop.slot }}</template></p>
        <p v-if="shop.from" class="sf-from">From {{ sellerPrice(shop.from) }} <span>({{ PRICE_NOTE }})</span></p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.sf { border-radius: 12px; overflow: hidden; background: var(--sf-alt); color: var(--sf-alt-ink); border: 1px solid rgb(0 0 0 / 14%); text-align: left; }
.sf-sign { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--sf-bg); color: var(--sf-ink); font-size: 15px; overflow-wrap: anywhere; }
.sf-logo { font-size: 20px; line-height: 1; }
.sf-body { display: flex; gap: 10px; padding: 10px 12px; align-items: center; }
.sf-cover { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; flex: none; background: rgb(0 0 0 / 8%); }
.sf-text { min-width: 0; display: grid; gap: 2px; }
.sf-text h3 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.sf-text p { margin: 0; font-size: 13px; opacity: 0.9; }
.sf-from span { display: block; font-size: 11px; opacity: 0.8; }
.is-stacked .sf-body { flex-direction: column; align-items: flex-start; }
.is-stacked .sf-cover { width: 100%; height: 96px; }
.is-split { display: grid; grid-template-columns: minmax(0, 1fr); }
.is-split .sf-sign { justify-content: flex-end; flex-direction: row-reverse; }
.is-banner .sf-sign { justify-content: center; font-size: 16px; }
</style>
