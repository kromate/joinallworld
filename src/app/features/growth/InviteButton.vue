<script setup lang="ts">
// The Invite button in the HUD bar: always there once a player has pressed Play, icon and label on a
// wide screen, icon only on a phone. It opens the share sheet with the player's own link made. The
// invitation prompts that sit under it (InviteNudge.vue, with when to prompt in inviteNudgeModel.ts) are
// fetched once the game is idle, so only the button is in the first download.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import { useApp } from '../../state/app.ts'
import { inviteBusy, shareInvite } from './shareInvite.ts'

const InviteNudge = defineAsyncComponent(() => import('./InviteNudge.vue'))
defineProps<{ params?: unknown }>()
const { game } = useApp()
const shown = computed(() => game.view.value.onboarding?.required !== true)

/** The prompts are fetched when the browser is idle (or after a short wait where it has no idle callback). */
const nudge = ref(false)
let cancel = (): void => {}
function press(): void {
  globalThis.window?.dispatchEvent(new CustomEvent('jaw:invite-press'))
  shareInvite('hud', () => game.toast('That could not be shared.', 'error'))
}
onMounted(() => {
  const w = window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  const show = (): void => { nudge.value = true }
  if (w.requestIdleCallback) { const id = w.requestIdleCallback(show, { timeout: 3000 }); cancel = () => w.cancelIdleCallback?.(id) }
  else { const id = setTimeout(show, 1500); cancel = () => clearTimeout(id) }
})
onBeforeUnmount(() => cancel())
</script>

<template>
  <span v-if="shown" class="inv-slot">
    <button type="button" class="inv-button" aria-label="Invite your friends" title="Invite your friends" :disabled="inviteBusy" data-invite-button data-tour="invite" @click="press">
      <GameIcon name="people" :size="17" /><span class="inv-label">Invite</span>
    </button>
    <InviteNudge v-if="nudge" />
  </span>
</template>

<style scoped>
.inv-slot { position: relative; display: inline-flex; align-items: center; flex: none; }
.inv-button { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 13px 0 10px; border: 0; border-radius: var(--r-pill); background: var(--c-green-soft); color: var(--c-green-dark); font: 700 var(--t-small) var(--font); cursor: pointer; -webkit-tap-highlight-color: transparent; }
.inv-button:hover:not(:disabled) { filter: brightness(.97); }
.inv-button:disabled { opacity: .6; cursor: default; }
.inv-button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.inv-slot > :deep(.inv-chip) { position: absolute; right: -6px; top: calc(100% + 24px); z-index: 5; }
@media (max-width: 720px) {
  .inv-button { min-width: 36px; justify-content: center; padding: 0 9px; }
  .inv-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .inv-slot { position: static; }
  .inv-slot > :deep(.inv-chip) { position: fixed; left: 8px; right: 8px; top: 60px; width: auto; }
}
</style>
