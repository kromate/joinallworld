<script setup lang="ts">
// Billboards and Sea plots: rent a slot for in-game naira and put a short text line, a colour and
// an icon on it. No uploaded pictures and no links in this wave — the app says so.
//
// Data: GET /api/civic/ads (one request for every ad). The text, colour, icon, tab and picked
// plot are a module-level draft (civicDrafts.ts), so they survive closing the sheet and a state
// update never touches what is being typed. A rent keeps its request id until it is applied:
// pressing again after a lost answer repeats the SAME request, so the rent is taken once.
import { computed, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import type { AdKind, AdsResponse } from '../../../types/civic.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import HowItWorks from '../../ui/HowItWorks.vue'
import SectionTitle from '../../ui/SectionTitle.vue'
import AdBoard from './AdBoard.vue'
import CivicAction from './CivicAction.vue'
import CivicStale from './CivicStale.vue'
import CivicStatus from './CivicStatus.vue'
import { AD_COLOURS, AD_ICONS, AD_TEXT, SEA_PLOTS } from './civicContent.ts'
import { contentFor } from '../../../game/cities/runtime.ts'
import { adsRentRequest, adsUi as ui } from './civicDrafts.ts'
import { adTooShort, adsKey, colourOf, adsPath, dateTime, ownedAds, previewText, rentWhy, roadside, seaPrice, seaSlot } from './civicModel.ts'
import { useCivic, useLinkWhy, useLoaded, useOffline } from './useCivic.ts'

const props = defineProps<{ params?: unknown }>()
const { game } = useApp()
const civic = useCivic()
const offline = useOffline()
const linkWhy = useLinkWhy()
const view = game.view
const state = game.state
const cityId = computed(() => view.value.cityId)
const billboardCount = computed(() => contentFor(cityId.value).billboardRoads.length)
const { item, reload } = useLoaded<AdsResponse>({ key: () => adsKey(cityId.value), path: () => adsPath(cityId.value), maxAge: 30000 })
const data = computed(() => item.value.data)
const textField = ref<HTMLInputElement | null>(null)

// Opened from the map with { tab: 'billboard' | 'sea' }: applied once per opening.
watch(() => props.params, (params) => {
  if (!params || params === ui.seenParams) return
  ui.seenParams = params
  const tab = (params as { tab?: unknown }).tab
  if (tab === 'sea' || tab === 'billboard') ui.tab = tab
}, { immediate: true })

const taken = computed(() => new Map((data.value?.sea.plots ?? []).map((plot) => [plot.slot, plot] as const)))
const slot = computed(() => seaSlot(ui.row, ui.col))
const picked = computed(() => taken.value.get(slot.value) ?? null)
const billboardsOwned = computed(() => ownedAds(data.value?.billboards.slots ?? []))
const seaOwned = computed(() => ownedAds(data.value?.sea.plots ?? []))
const cells = computed(() => {
  const sea = data.value?.sea
  if (!sea) return []
  return Array.from({ length: sea.rows * sea.cols }, (_, index) => ({ row: Math.floor(index / sea.cols), col: index % sea.cols }))
})
const icons = computed(() => new Map(AD_ICONS.map((icon) => [icon.id, icon.icon])))

async function rent(kind: AdKind, target: string): Promise<void> {
  if (adTooShort(ui.text, AD_TEXT.min)) { game.toast(`Write your ad text first (at least ${AD_TEXT.min} characters). Nothing was charged.`, 'error'); textField.value?.focus(); return }
  const order = { kind, slot: target, text: ui.text, colour: ui.colour, icon: ui.icon }
  const result = await civic.send(`rent:${target}`, '/api/civic/ads/rent', { ...order, requestId: civic.requestId(adsRentRequest, [cityId.value, order]) }, { success: 'Your ad is up.' })
  civic.requestDone(adsRentRequest, result)
  if (result.ads) civic.put(adsKey(cityId.value), result.ads as AdsResponse)
  if (result.ok) ui.text = ''
  // The city map behind the sheet draws the same listing.
  if (result.ads || result.ok) civic.changed()
}
async function remove(kind: AdKind, target: string): Promise<void> {
  const result = await civic.send(`remove:${target}`, '/api/civic/ads/remove', { kind, slot: target }, { success: 'Ad taken down. Rent is not refunded.' })
  if (result.ads) { civic.put(adsKey(cityId.value), result.ads as AdsResponse); civic.changed() }
}
const plotLabel = (row: number, col: number): string => {
  const ad = taken.value.get(seaSlot(row, col))
  return `Plot row ${row + 1}, column ${col + 1}${ad ? `, rented by ${ad.by.name}` : ', free'}`
}
const nearLabel = (near: string): string => { const place = view.value.venues.find((venue) => venue.id === near); return place ? `Near ${place.label}` : 'Roadside' }
const plotAd = (row: number, col: number) => taken.value.get(seaSlot(row, col)) ?? null
const plotStyle = (row: number, col: number): { background: string } | undefined => { const ad = plotAd(row, col); return ad ? { background: colourOf(AD_COLOURS, ad.colour).bg } : undefined }
const pick = (row: number, col: number): void => { ui.row = row; ui.col = col }
</script>

<template>
  <div class="ads">
    <div class="ui-seg" role="group" aria-label="Ad type">
      <button type="button" :aria-pressed="ui.tab === 'billboard'" @click="ui.tab = 'billboard'">Billboards</button>
      <button type="button" :aria-pressed="ui.tab === 'sea'" @click="ui.tab = 'sea'">Sea plots</button>
    </div>
    <p class="civic-note">Balance <b>{{ money(state.cash) }}</b></p>
    <CivicStatus :item="item" @retry="reload" />
    <template v-if="data">
      <CivicStale :item="item" />
      <div class="civic-form is-card">
        <label>Ad text ({{ AD_TEXT.min }}–{{ AD_TEXT.max }} characters, no links)<input ref="textField" v-model="ui.text" :maxlength="AD_TEXT.max" autocomplete="off" placeholder="Mama Put — best jollof on the island"></label>
        <div>
          <span class="civic-note">Colour</span>
          <div class="ads-swatches" role="group" aria-label="Ad colour">
            <button v-for="colour in AD_COLOURS" :key="colour.id" type="button" :aria-pressed="colour.id === ui.colour" :aria-label="colour.label" :title="colour.label" :style="{ background: colour.bg }" @click="ui.colour = colour.id" />
          </div>
        </div>
        <div>
          <span class="civic-note">Icon</span>
          <div class="ads-swatches" role="group" aria-label="Ad icon">
            <button v-for="icon in AD_ICONS" :key="icon.id" type="button" :aria-pressed="icon.id === ui.icon" :aria-label="icon.id" @click="ui.icon = icon.id"><GameIcon kind="ad" :id="icon.id" :emoji="icons.get(icon.id)" :size="22" /></button>
          </div>
        </div>
        <div><span class="civic-note">Preview</span><AdBoard :colour="ui.colour" :icon="ui.icon" :text="previewText(ui.text)" /></div>
      </div>

      <template v-if="ui.tab === 'billboard'">
        <p class="civic-note">A billboard costs {{ money(data.billboards.price) }} for {{ data.billboards.days }} days. You can hold {{ data.billboards.maxPerPlayer }} at a time; taking one down early is not refunded.</p>
        <ul class="civic-list is-card">
          <li v-for="board in data.billboards.slots" :key="board.slot" class="ads-slot" :class="{ 'is-taken': board.ad }">
            <span>
              <strong>{{ roadside(cityId, board.road, board.slot) }}</strong>
              <small>{{ nearLabel(board.near) }}</small>
              <template v-if="board.ad">
                <AdBoard :colour="board.ad.colour" :icon="board.ad.icon" :text="board.ad.text" />
                <small>{{ board.ad.mine ? 'Yours' : `Rented by ${board.ad.by.name}` }} until {{ dateTime(board.ad.expiresAt) }}</small>
              </template>
            </span>
            <CivicAction v-if="!board.ad" primary :working="civic.busy(`rent:${board.slot}`)" :reason="rentWhy(offline('rent'), state.cash, board.price, billboardsOwned, data.billboards.maxPerPlayer, 'billboards')" @click="rent('billboard', board.slot)">Rent · {{ money(board.price) }}</CivicAction>
            <CivicAction v-else-if="board.ad.mine" :working="civic.busy(`remove:${board.slot}`)" :reason="linkWhy()" @click="remove('billboard', board.slot)">Take down</CivicAction>
          </li>
        </ul>
      </template>
      <template v-else>
        <p class="civic-note">Rent a patch of sea from {{ money(data.sea.price) }} a plot: your ad floats there for {{ data.sea.days }} days. The {{ data.sea.shoreRows }} rows nearest the shore cost {{ money(data.sea.shorePrice) }}. {{ data.sea.plots.length }} of {{ data.sea.rows * data.sea.cols }} plots are rented; you hold {{ seaOwned }} of {{ data.sea.maxPerPlayer }}.</p>
        <div class="ads-sea" role="group" aria-label="Sea plots" :style="{ gridTemplateColumns: `repeat(${data.sea.cols}, 1fr)` }">
          <button v-for="cell in cells" :key="`${cell.row}-${cell.col}`" type="button" :class="{ 'is-shore': cell.row < data.sea.shoreRows }" :aria-pressed="ui.row === cell.row && ui.col === cell.col" :aria-label="plotLabel(cell.row, cell.col)" :style="plotStyle(cell.row, cell.col)" @click="pick(cell.row, cell.col)">
            <GameIcon v-if="plotAd(cell.row, cell.col)" kind="ad" :id="plotAd(cell.row, cell.col)?.icon" :emoji="icons.get(plotAd(cell.row, cell.col)?.icon ?? '')" :size="14" />
          </button>
        </div>
        <div class="civic-form ads-pick">
          <label>Row<select v-model.number="ui.row"><option v-for="index in SEA_PLOTS.rows" :key="index" :value="index - 1">{{ index }}</option></select></label>
          <label>Column<select v-model.number="ui.col"><option v-for="index in SEA_PLOTS.cols" :key="index" :value="index - 1">{{ index }}</option></select></label>
        </div>
        <SectionTitle>Plot {{ ui.row + 1 }}·{{ ui.col + 1 }}</SectionTitle>
        <div class="civic-actions is-stack">
          <template v-if="picked">
            <AdBoard :colour="picked.colour" :icon="picked.icon" :text="picked.text" />
            <p class="civic-note">{{ picked.mine ? 'Yours' : `Rented by ${picked.by.name}` }} until {{ dateTime(picked.expiresAt) }}.</p>
            <CivicAction v-if="picked.mine" :working="civic.busy(`remove:${slot}`)" :reason="linkWhy()" @click="remove('sea', slot)">Take down</CivicAction>
            <CivicAction v-else :reason="'This plot is taken. Pick a free one.'">Rent · {{ money(seaPrice(data.sea, ui.row)) }}</CivicAction>
          </template>
          <CivicAction v-else primary :working="civic.busy(`rent:${slot}`)" :reason="rentWhy(offline('rent'), state.cash, seaPrice(data.sea, ui.row), seaOwned, data.sea.maxPerPlayer, 'sea plots')" @click="rent('sea', slot)">Rent this plot · {{ money(seaPrice(data.sea, ui.row)) }}</CivicAction>
        </div>
      </template>
      <div class="civic-actions"><CivicAction :working="item.loading" @click="reload">Refresh</CivicAction></div>
    </template>
    <HowItWorks id="ads-rules" page label="How ads work" :rules="['An ad is one line of text, a colour and an icon. Picture uploads and links are switched off until moderation exists, and ad text is never clickable.', 'Rent is paid in in-game naira only, and taking an ad down early is not refunded.', 'Ads are drawn on the city map behind its Billboards and Sea layers; they are never links.', `Billboard pricing and the sea grid are original beta values (${billboardCount} billboard slots).`]" />
  </div>
</template>

<style scoped>
.civic-note { font-size: 12px !important; line-height: 1.45 !important; color: var(--c-muted); margin: var(--s-2) 2px !important; }
.civic-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0 0; }
.civic-actions .civic-action { flex: 1 1 140px; display: grid; margin: 0; }
.civic-actions.is-stack { display: grid; }
:global(.ph.is-wide) .civic-actions.is-stack { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
.civic-form { display: grid; gap: var(--s-3); margin: var(--s-2) 0; }
.civic-form.is-card { padding: var(--s-3) var(--s-4) var(--s-4); border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); }
.civic-form label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; margin: 0 !important; }
.civic-form .civic-note { display: block; margin: 0 0 5px !important; font-weight: 600; color: var(--c-ink); }
:global(.ph.is-wide) .civic-form input, :global(.ph.is-wide) .civic-form select { max-width: 460px; }
:global(.ph.is-wide) .ads-swatches { max-width: 520px; }
.civic-list { list-style: none; padding: 0; margin: 0; }
.civic-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); padding: 10px 0; border-bottom: 1px solid var(--c-line); font-size: 13px; min-height: var(--tap); }
.civic-list.is-card { border-radius: var(--r-md); background: #fff; box-shadow: var(--e-1), var(--ring); padding: 0 14px; }
.civic-list.is-card li:last-child { border-bottom: 0; }
.civic-list li > span { min-width: 0; overflow-wrap: anywhere; }
.civic-list small { display: block; color: var(--c-muted); font-size: 11px; }
.civic-list .civic-action { flex: none; margin: 0; max-width: 150px; }
.ads-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.ads-swatches button { width: var(--tap); height: var(--tap); border-radius: var(--r-sm); border: 2px solid transparent; cursor: pointer; font-size: 18px; background: var(--c-fill); box-shadow: inset 0 0 0 1px #0000001a; }
.ads-swatches button[aria-pressed=true] { border-color: var(--c-ink); box-shadow: 0 0 0 2px #fff inset; }
.ads-slot > span { display: grid; gap: 3px; flex: 1; }
.ads-slot strong { font-size: 14px; }
.ads-slot :deep(.ads-preview) { margin: 4px 0; }
.ads-sea { display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px; background: linear-gradient(180deg, #d9c48f 0 6%, #8fd0e4 10%, #3f9cc4); padding: 10px 8px 8px; border-radius: var(--r-md); margin: var(--s-2) 0; box-shadow: var(--e-1); }
.ads-sea button { aspect-ratio: 1; border: 0; border-radius: 3px; background: #ffffff55; padding: 0; font-size: 11px; line-height: 1; cursor: pointer; min-width: 0; overflow: hidden; }
.ads-sea button.is-shore { background: #ffffff99; }
.ads-sea button[aria-pressed=true] { outline: 2px solid var(--c-ink); outline-offset: 0; }
.ads-pick { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); }
</style>
