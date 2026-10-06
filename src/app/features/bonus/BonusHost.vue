<script setup lang="ts">
// The launch bonus on the game screen, fetched after the first frame. A GUEST sees one calm chip beside the sign-up bar ("Sign up to claim
// ₦1,000,000 in the game · N left"): not a modal, not over the HUD, dismissible, back at most once a day. A signed-in player opens the game and
// it asks the server what became of their bonus: when it has just been paid (or was held and is now) the moment is shown once — the cash counts up
// in the top bar, a toast says which place it was, the companion says one line and the sound system plays its coins — and the server is told it was seen.
// The server pays; nothing here decides who gets what.
import { computed, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { openSignup } from '../account/accountOpen.ts'
import { barDue, barFacts } from '../account/guestBarModel.ts'
import { useAccountLite } from '../account/useAccountLite.ts'
import { callVisible } from '../calls/callState.ts'
import { sayLine } from '../companion/say.ts'
import { tour } from '../tour/tourState.ts'
import { chipDue, chipHiddenUntil, chipText, dismissChip } from './bonusModel.ts'
import { runMoment } from './bonusMoment.ts'
import { askBonus, bonus, loadOffer } from './bonusStore.ts'

const { game, shell } = useApp()
const lite = useAccountLite()
const storage = (): Storage | null => { try { return globalThis.localStorage } catch { return null } }
const hidden = ref(chipHiddenUntil(storage()))
const text = computed(() => chipText(bonus.offer))
// The guest bar's own conditions (a guest on a server with accounts, connected, in the venue view, nothing in front), without its week-long dismissal.
const eligible = computed(() => {
  const view = game.view.value
  return barDue(barFacts({
    account: lite.state, connected: view.connected, creatorOpen: view.onboarding?.required === true, tour: tour.active || tour.pending,
    sheetOpen: Boolean(shell.sheet.value), activityRunning: Boolean(game.state.value.activeAction), callOnScreen: callVisible(),
    venue: game.mode.value === 'venue', hiddenUntil: 0, now: Date.now(),
  }))
})
const show = computed(() => chipDue({ offer: bonus.offer, eligible: eligible.value, hiddenUntil: hidden.value, now: Date.now() }))
function dismiss(): void { hidden.value = dismissChip(storage(), Date.now()) }

onMounted(() => { void loadOffer(game.fetchJson) })

// A signed-in player: ask once the page is connected and past character creation; again when the creator finishes (a bonus held for a character).
let asking = false
async function settle(): Promise<void> {
  if (asking) return
  asking = true
  try {
    await lite.load()
    if (!lite.state.account) return
    await runMoment({
      ask: (seen) => askBonus(game.fetchJson, lite.token(), seen === true), refresh: () => game.refresh(), toast: (words) => game.toast(words, 'good'), say: sayLine,
      firstName: () => game.state.value.name.split(/\s+/)[0] ?? '',
    })
  } finally { asking = false }
}
watch(() => [game.view.value.connected, game.view.value.onboarding?.required, lite.state.account !== null], ([connected, creating, signedIn]) => { if (connected && !creating && signedIn) void settle() }, { immediate: true })
</script>

<template>
  <section v-if="show && text" class="bonus-chip" aria-label="Launch bonus" data-bonus-chip>
    <p><GameIcon name="coin" :size="16" /><span>{{ text }}</span></p>
    <button type="button" class="bonus-go" data-bonus-signup @click="openSignup(shell, 'guestbar')">Sign up</button>
    <button type="button" class="bonus-x" data-bonus-dismiss aria-label="Hide this for today" title="Hide this for today" @click="dismiss"><GameIcon name="close" :size="14" /></button>
  </section>
</template>

<style scoped>
.bonus-chip { display: flex; align-items: center; gap: 6px; width: 100%; padding: 2px 4px 2px 12px; border-radius: 18px; background: var(--c-green-soft, #e8f5ec); border: 1px solid #fff; box-shadow: var(--e-1, 0 1px 4px #0002); pointer-events: auto; color: var(--c-green-dark, #1d6b43); font-size: var(--t-small, 13px); animation: bonus-in .28s ease-out both; }
.bonus-chip p { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; margin: 0; line-height: 1.3; font-weight: 600; }
.bonus-chip p span { overflow-wrap: anywhere; }
.bonus-chip button { flex: none; border: 0; font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.bonus-chip button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.bonus-go { min-height: 32px; padding: 0 12px; border-radius: var(--r-pill, 999px); background: var(--c-green-dark, #1d6b43); color: #fff; font-weight: 700; font-size: var(--t-small, 13px); }
.bonus-x { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: none; color: var(--c-muted, #6b7280); }
.bonus-x:hover { background: #ffffff99; color: var(--c-ink, #111); }
@keyframes bonus-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .bonus-chip { animation: none; } }
</style>
