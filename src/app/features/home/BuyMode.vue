<script setup lang="ts">
// Buy mode.
//
// 'buy' (nav panel) — the furniture catalogue with nine category tabs plus Storage, the placement
// panel (ghost, arrows, rotate, Place, Cancel) and the selected-object panel (Move, Store, Sell).
// It renders inline above the bottom nav while the home scene stays visible. Shortcuts arrive
// through keys(action): move-up/down/left/right, rotate, place, sell, catalogue. Esc arrives as
// keys('cancel'): it cancels a placement first; with nothing being placed the shell handles it and
// leaves Buy mode.
//
// What Buy mode shares with the home chip — the tapped object, the ghost — is homeState.ts, and the
// conversation with the scene is homeScene.ts (the chip is in the first download, this is fetched
// the first time Buy is opened). The server validates every placement again; the ghost's
// green/red state uses the same pure rules (src/game/home-layout.ts) so the player sees the answer
// before pressing Place.
import { computed } from 'vue'
import { CATEGORIES, FURNITURE, SELL_REFUND_RATE, STAR_MULTIPLIER } from '../../../game/content/furniture.ts'
import { useApp } from '../../state/app.ts'
import { linkWords } from '../../../ui/link.ts'
import { money } from '../../ui/format.ts'
import GameIcon from '../../ui/GameIcon.vue'
import StarRating from './StarRating.vue'
import { HINT, blockedReason, defOf, objectOf, placementReason, refund, selectedReason, size, starsNote, storageOf, storedReason, whyNot } from './buyModel.ts'
import { buyKey, cancelGhost, deselect, moveGhost, pickItem, placeGhost, sellSelected, storeSelected } from './homeScene.ts'
import { H, tab } from './homeState.ts'

defineProps<{ params?: unknown }>()

const { game, shell, command } = useApp()
const state = game.state
const view = game.view
const short = computed(() => linkWords(view.value)?.short)
const busy = computed(() => Boolean(state.value.activeAction))
const connected = computed(() => view.value.connected)

const ghostDef = computed(() => (H.ghost ? defOf(H.ghost.itemId) : undefined))
const placed = computed(() => (H.selected ? objectOf(state.value, H.selected) : undefined))
const selectedDef = computed(() => defOf(placed.value?.itemId))
const storage = computed(() => storageOf(state.value))
// The Storage tab goes when the last stored piece does.
const current = computed(() => (tab.value === 'storage' && !storage.value.stored ? CATEGORIES[0]?.id ?? '' : tab.value))
const tabs = computed(() => [...CATEGORIES.map((category) => ({ id: category.id, icon: category.id, emoji: category.icon, label: category.label })), ...(storage.value.stored ? [{ id: 'storage', icon: 'storage', emoji: undefined, label: `Storage (${storage.value.stored})` }] : [])])
const cards = computed(() => Object.values(FURNITURE).filter((def): def is NonNullable<typeof def> => Boolean(def) && def?.category === current.value).sort((a, b) => a.price - b.price).map((def) => {
  const price = view.value.home?.prices?.[def.id] ?? def.price
  return { def, price, reason: blockedReason({ connected: connected.value, short: short.value, busy: busy.value, cash: state.value.cash, price }, money) }
}))
const stored = computed(() => storage.value.entries.flatMap(([id, count]) => { const def = defOf(id); return def ? [{ def, count }] : [] }))
const storedWhy = computed(() => storedReason(connected.value, short.value, busy.value))
const multiplier = starsNote(STAR_MULTIPLIER)

const price = computed(() => (ghostDef.value ? view.value.home?.prices?.[ghostDef.value.id] ?? ghostDef.value.price : 0))
const paying = computed(() => H.ghost?.source === 'buy')
const placeWhy = computed(() => placementReason({ refusal: H.ghost ? whyNot(state.value, H.ghost) : null, connected: connected.value, short: short.value, busy: busy.value, paying: paying.value, price: price.value, cash: state.value.cash }, money))
const pad = [['move-left', '↖', 'Move left'], ['move-up', '↗', 'Move back'], ['rotate', '', 'Rotate'], ['move-down', '↙', 'Move forward'], ['move-right', '↘', 'Move right']] as const
const selectedWhy = computed(() => selectedReason(connected.value, short.value, busy.value))

// A ghost whose piece is gone is dropped.
const ghostValid = computed(() => !H.ghost || (ghostDef.value && !(H.ghost.objectId && !objectOf(state.value, H.ghost.objectId))))
async function storeIt(): Promise<void> { await storeSelected() }

defineExpose({ keys: (action: string): boolean => buyKey(action) })
</script>

<template>
  <div v-if="H.ghost && ghostValid && ghostDef" class="buy-place is-placing">
    <div class="buy-pad" role="group" aria-label="Move the ghost">
      <button v-for="[action, glyph, name] in pad" :key="action" type="button" :class="`buy-pad-${action}`" :aria-label="name" @click="moveGhost(action)"><GameIcon v-if="action === 'rotate'" inline name="refresh" /><template v-else>{{ glyph }}</template></button>
    </div>
    <div class="buy-place-main">
      <header>
        <strong><GameIcon inline kind="furniture" :id="ghostDef.id" :emoji="ghostDef.icon" /> {{ ghostDef.label }}</strong>
        <span>{{ paying ? money(price) : H.ghost.source === 'move' ? 'Moving · free' : 'From storage · free' }}</span>
      </header>
      <p class="buy-why" :class="placeWhy ? 'is-bad' : 'is-good'" role="status">{{ placeWhy || (ghostDef.wall ? 'Fits on this wall.' : 'Fits here. Tap a tile to move it there.') }}</p>
      <div class="buy-row">
        <button type="button" class="ui-button is-primary" :disabled="Boolean(placeWhy)" @click="placeGhost()">{{ paying ? `Place · ${money(price)}` : 'Place' }}</button>
        <button type="button" class="ui-button" @click="cancelGhost()">Cancel</button>
      </div>
      <p class="buy-hint buy-keys">{{ HINT }}</p>
    </div>
  </div>
  <div v-else-if="placed && selectedDef" class="buy-place">
    <header><strong><GameIcon inline kind="furniture" :id="selectedDef.id" :emoji="selectedDef.icon" /> {{ selectedDef.label }} <em class="buy-stars"><StarRating :count="selectedDef.stars" /></em></strong><span>{{ size(selectedDef) }}</span></header>
    <p class="buy-hint">{{ selectedDef.blurb }}</p>
    <p v-if="selectedWhy" class="buy-why is-bad" role="status">{{ selectedWhy }}</p>
    <div class="buy-row">
      <button type="button" class="ui-button is-primary" :disabled="Boolean(selectedWhy)" @click="pickItem('move', placed.itemId, placed.id)">Move</button>
      <button type="button" class="ui-button" :disabled="Boolean(selectedWhy)" @click="storeIt()">Store</button>
      <button type="button" class="ui-button" :disabled="Boolean(selectedWhy)" @click="sellSelected()">Sell · +{{ money(refund(selectedDef)) }}</button>
      <button type="button" class="ui-button" @click="deselect()">Done</button>
    </div>
    <p class="buy-hint">Selling returns {{ Math.round(SELL_REFUND_RATE * 100) }}% of the list price (Del). Storing is free.</p>
  </div>
  <div v-else class="buy-catalogue" :class="{ 'is-hidden': H.hidden }">
    <header>
      <span class="buy-chip"><GameIcon inline name="buy" /> Buy mode</span>
      <span class="buy-wallet">{{ money(state.cash) }}</span>
      <button type="button" :aria-expanded="!H.hidden" @click="H.hidden = !H.hidden">{{ H.hidden ? 'Show catalogue' : 'Hide' }}</button>
      <button type="button" class="buy-x" aria-label="Close Buy mode" @click="shell.close()"><GameIcon inline name="close" /></button>
    </header>
    <p v-if="H.hidden" class="buy-hint">Tap an object in your room to move, store or sell it. C shows the catalogue.</p>
    <template v-else>
      <div class="buy-tabs" role="tablist">
        <button v-for="item in tabs" :key="item.id" type="button" role="tab" :aria-selected="item.id === current" :class="{ 'is-selected': item.id === current }" @click="tab = item.id"><GameIcon inline kind="category" :id="item.icon" :emoji="item.emoji" /><span>{{ item.label }}</span></button>
      </div>
      <div class="buy-grid">
        <template v-if="current === 'storage'">
          <div v-for="item in stored" :key="item.def.id" class="buy-card is-stored">
            <span class="buy-card-top"><em>{{ size(item.def) }}</em><em>×{{ item.count }}</em></span>
            <span class="buy-emoji" aria-hidden="true"><GameIcon inline kind="furniture" :id="item.def.id" :emoji="item.def.icon" /></span>
            <strong>{{ item.def.label }}</strong>
            <span class="buy-stored-actions">
              <button type="button" :disabled="Boolean(storedWhy)" @click="pickItem('storage', item.def.id)">Place</button>
              <button type="button" :disabled="Boolean(storedWhy)" @click="command('home.furniture-sell', { item: item.def.id })">Sell +{{ money(refund(item.def)) }}</button>
            </span>
            <small v-if="storedWhy" class="buy-need">{{ storedWhy }}</small>
          </div>
        </template>
        <template v-else>
          <button v-for="card in cards" :key="card.def.id" type="button" class="buy-card" :disabled="Boolean(card.reason)" :aria-label="`${card.def.label}, ${size(card.def)}, ${card.def.stars} stars, ${money(card.price)}${card.reason ? `, ${card.reason}` : ''}`" @click="pickItem('buy', card.def.id)">
            <span class="buy-card-top"><em>{{ size(card.def) }}</em><em class="buy-stars"><StarRating :count="card.def.stars" /></em></span>
            <span class="buy-emoji" aria-hidden="true"><GameIcon inline kind="furniture" :id="card.def.id" :emoji="card.def.icon" /></span>
            <strong>{{ card.def.label }}</strong>
            <b :class="card.price <= state.cash ? 'is-afford' : ''"><template v-if="card.price < card.def.price"><s>{{ money(card.def.price) }}</s> </template>{{ money(card.price) }}</b>
            <small v-if="card.reason" class="buy-need">{{ card.reason }}</small>
          </button>
          <div v-if="!cards.length" class="ui-empty is-inline"><p>Nothing in this category yet.</p></div>
        </template>
      </div>
      <p class="buy-hint">Tap an item to place it, or an object in your room to move, store or sell it. <span class="buy-stars-note">Stars improve what an object gives: {{ multiplier }}.</span></p>
    </template>
  </div>
</template>

<style src="../../../ui/panels/buy.css"></style>
