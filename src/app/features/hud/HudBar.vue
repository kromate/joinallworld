<script setup lang="ts">
// The top bar: Lagos clock · mood · name · saved state · wallet. The scene is the hero, so this is
// one small pill. The name opens the Sim sheet and the wallet opens the Bank. A change of the
// balance is flashed and written out with its reason from the ledger; the flash is one CSS
// animation that ends by itself, so nothing runs while the game is idle.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { money } from '../../ui/format.ts'
import { cashDelta, moodOf, noteExpiry, savedPill } from './hudModel.ts'
import InviteButton from '../growth/InviteButton.vue'
import OnlinePill from './OnlinePill.vue'
import AccountHud from './AccountHud.vue'
import { useAccountLite } from '../account/useAccountLite.ts'

const { game, shell, menu } = useApp()
const view = game.view
const state = game.state
const mood = computed(() => moodOf(view.value))
const saved = computed(() => savedPill(view.value, game.saving.value))
const cash = computed(() => money(state.value.cash))
/** Signed in: the account chip carries the name, so the plain name button steps aside (its sheet is one tap further, from the account sheet). */
const account = useAccountLite()
const chip = computed(() => game.connected.value && account.state.loaded && account.state.enabled && account.state.account !== null)

/** The last change of the balance, and a counter that restarts its animation. */
const delta = ref<{ text: string; up: boolean; run: number } | null>(null)
/** The wallet's own highlight. Cleared and set again so a second change restarts it; removed when it ends. */
const cashFlash = ref<'is-up' | 'is-down' | null>(null)
let lastCash: number | null = null
let lastLife = ''
/** The note leaves the page when its animation has ended, so it does not linger in the page text. */
const expiry = noteExpiry(() => { delta.value = null })
const clearDelta = expiry.cancel
onBeforeUnmount(clearDelta)
watch([state, view], () => {
  // A different life (another city, a new session): compare nothing against the old one.
  const life = `${view.value.session?.id ?? ''}:${view.value.cityId}`
  if (life !== lastLife) { lastLife = life; lastCash = null; clearDelta(); delta.value = null }
  const now = state.value.cash
  if (lastCash !== null && view.value.connected && now !== lastCash) {
    const change = now - lastCash
    delta.value = { text: cashDelta(change, view.value.wallet?.ledger[0], money), up: change > 0, run: (delta.value?.run ?? 0) + 1 }
    clearDelta()
    expiry.arm()
    cashFlash.value = null
    void nextTick(() => { cashFlash.value = change > 0 ? 'is-up' : 'is-down' })
  }
  if (view.value.connected) lastCash = now
}, { immediate: true })

function onSaved(): void {
  const pill = saved.value
  if (pill.kind !== 'button') return
  const gate = pill.gate ? shell.sessionGate(pill.gate) : null
  if (gate) shell.open(gate.id, { reason: pill.gate }); else menu('reconnect')
}
</script>

<template>
  <section class="hud-bar" :class="{ 'has-chip': chip }" data-tour="hud" aria-label="Player status">
    <i class="hud-mark" aria-hidden="true"><GameIcon name="globe" :size="19" /></i>
    <OnlinePill />
    <AccountHud />
    <span class="hud-clock">{{ view.clock }}</span>
    <span class="hud-mood" :class="`is-${mood.tone}`"><GameIcon inline kind="mood" :id="mood.tone" :emoji="mood.icon" /> {{ mood.word }}</span>
    <button class="hud-name" type="button" @click="shell.open('sim')"><GameIcon name="person" :size="17" /><span>{{ state.name }}</span></button>
    <span class="hud-saved-slot">
      <button v-if="saved.kind === 'button'" class="hud-saved is-off" :class="{ 'is-wait': saved.wait }" type="button" :title="saved.title" @click="onSaved">
        <i aria-hidden="true"><GameIcon :name="saved.icon" :size="14" /></i><span>{{ saved.text }}</span>
      </button>
      <span v-else class="hud-saved" :class="`is-${saved.tone}`" role="status" :title="saved.title">
        <i aria-hidden="true"><GameIcon :name="saved.icon" :size="14" /></i><span>{{ saved.text }}</span>
      </span>
    </span>
    <InviteButton />
    <button class="hud-cash" :class="cashFlash" type="button" @animationend="cashFlash = null" :aria-label="`Wallet ${cash}. Open the bank and your transactions`" @click="shell.open('bank')">{{ cash }}</button>
    <span v-if="delta" :key="delta.run" class="hud-delta" :class="delta.up ? 'is-up' : 'is-down'" aria-hidden="true">{{ delta.text }}</span>
  </section>
</template>

<style scoped>
.hud-bar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 12px; height: 48px; max-width: calc(100% - 24px); padding: 0 6px 0 18px; background: var(--c-surface); border: 1px solid #fff; border-radius: var(--r-pill); box-shadow: var(--e-2); white-space: nowrap; pointer-events: auto; color: var(--c-ink); font: 13px/1.35 var(--font); }
.hud-bar button { border: 0; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.hud-bar button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.hud-mark { display: none; flex: none; place-items: center; width: 26px; height: 26px; margin-left: -6px; border-radius: 9px; background: linear-gradient(150deg, #39c07a, #1d6b43); color: #fff; box-shadow: inset 0 1px 0 #ffffff59; }
.hud-clock { font-size: var(--t-body); font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.1px; }
.hud-mood { padding-left: 12px; border-left: 1px solid var(--c-line); color: var(--c-green-dark); font-weight: 600; }
.hud-mood.is-warn { color: #8a5a12; }
.hud-mood.is-bad { color: var(--c-red-dark); }
.hud-mood.is-neutral { color: var(--c-muted); }
.hud-name { display: flex; align-items: center; gap: 5px; min-height: var(--tap); max-width: 170px; padding: 0 4px 0 12px; border-left: 1px solid var(--c-line) !important; border-radius: 0; background: none; color: var(--c-ink-2); font-weight: 600 !important; }
@media (min-width: 721px) { .hud-bar.has-chip .hud-name { display: none; } }
.hud-name span { overflow: hidden; text-overflow: ellipsis; }
.hud-name :deep(.game-icon) { color: var(--c-green-dark); }
.hud-saved { display: inline-flex; align-items: center; gap: 5px; padding: 0; background: none; color: var(--c-muted); font-size: var(--t-small) !important; font-weight: 700 !important; }
.hud-saved i { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--c-green-soft); color: var(--c-green-dark); font-style: normal; }
.hud-saved.is-saving i { background: var(--c-amber-soft); color: var(--c-amber-dark); }
.hud-saved.is-off, .hud-saved.is-unsaved { min-height: 34px; padding: 0 12px 0 6px; border-radius: var(--r-pill); background: var(--c-red-soft); color: var(--c-red-dark); box-shadow: inset 0 0 0 1px #e9b9a8; }
.hud-saved.is-off i, .hud-saved.is-unsaved i { background: var(--c-red-dark); color: #fff; }
.hud-saved.is-wait { background: var(--c-amber-soft); color: var(--c-amber-dark); box-shadow: inset 0 0 0 1px #ead38f; }
.hud-saved.is-wait i { background: var(--c-amber-dark); }
.hud-cash { position: relative; min-height: 36px; padding: 0 15px; border-radius: var(--r-pill); background: var(--c-ink); color: #fff; font-size: var(--t-body) !important; font-weight: 700 !important; font-variant-numeric: tabular-nums; letter-spacing: .1px; }
.hud-cash::after { content: ''; position: absolute; inset: -4px -2px; }
.hud-cash.is-up { animation: hud-flash-up 1.1s ease-out; }
.hud-cash.is-down { animation: hud-flash-down 1.1s ease-out; }
.hud-delta { position: absolute; right: 8px; top: calc(100% - 6px); max-width: min(270px, 80vw); padding: 3px 10px; border-radius: var(--r-pill); font-size: var(--t-small); font-weight: 700; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; opacity: 0; visibility: hidden; pointer-events: none; box-shadow: var(--e-1); }
.hud-delta.is-up { background: var(--c-green-dark); color: #fff; animation: hud-delta 3.4s ease-out; }
.hud-delta.is-down { background: #fff; color: #8a3f1d; border: 1px solid #e8c9b6; animation: hud-delta 3.4s ease-out; }
@keyframes hud-delta { 0% { opacity: 0; visibility: visible; transform: translateY(-6px); } 8%, 82% { opacity: 1; visibility: visible; transform: none; } 100% { opacity: 0; visibility: hidden; } }
@keyframes hud-flash-up { 0%, 40% { background: #2f8a57; box-shadow: 0 0 0 4px #2f8a5740; } 100% { background: var(--c-ink); box-shadow: 0 0 0 0 transparent; } }
@keyframes hud-flash-down { 0%, 40% { background: #a2542a; box-shadow: 0 0 0 4px #a2542a40; } 100% { background: var(--c-ink); box-shadow: 0 0 0 0 transparent; } }
/* Narrower than a laptop the bar gives up words before it gives up width: the wordmark beside it, then "Saved", then the name (it is in the Sim). */
@media (max-width: 1140px) { .hud-mark { display: grid; } }
@media (max-width: 900px) { .hud-saved > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } }
@media (max-width: 880px) { .hud-name { display: none; } }
@media (max-width: 720px) {
  .hud-bar { top: 8px; left: 8px; right: 8px; transform: none; max-width: none; justify-content: space-between; gap: 8px; height: 44px; padding: 0 4px 0 12px; }
  .hud-clock { font-size: 12px; }
  .hud-mood { padding-left: 8px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .hud-saved.is-off, .hud-saved.is-unsaved { padding: 0 6px; }
  .hud-saved-slot { margin-left: auto; }
  .hud-cash { padding: 0 12px; font-size: 13px !important; }
  /* A long change note ("+₦195,000 · Start cash · Starter house, …") wraps to two lines and hangs below the top row, clear of the cash pill. */
  .hud-delta { top: calc(100% + 4px); right: 4px; z-index: 1; max-width: min(300px, calc(100vw - 24px)); padding: 4px 12px; border-radius: 16px; white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
}
@media (max-width: 420px) { .hud-bar { gap: 5px; padding-left: 10px; } .hud-mark { display: none; } .hud-clock { font-size: 11px; } .hud-cash { padding: 0 9px; font-size: 12px !important; } }
@media (max-width: 360px) { .hud-mood { display: none; } }
@media (prefers-reduced-motion: reduce) {
  .hud-cash.is-up, .hud-cash.is-down { animation: none; }
  .hud-delta.is-up, .hud-delta.is-down { animation: hud-delta-still 3.4s steps(1, end); }
  @keyframes hud-delta-still { 0% { opacity: 1; visibility: visible; } 100% { opacity: 0; visibility: hidden; } }
}
</style>
