<script setup lang="ts">
// The Invite button in the HUD bar: always there once a player has pressed Play, icon and label on a
// wide screen, icon only on a phone. It opens the share sheet with the player's own link made. It
// also hosts the invitation chip: at a few natural moments (the first goal done, settled into a
// home, a quiet room, a table won) the chip offers the same thing, once each, never during an
// activity and never to a guest who has not pressed Play. When to prompt is inviteNudgeModel.ts;
// what is remembered is kept on this device (INVITE_KEY). Nothing here runs on a timer except the
// short waits noted below, each a single timeout that is cleared when it no longer applies.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import { useApp } from '../../state/app.ts'
import { useCommunity } from '../community/communityStore.ts'
import { EMPTY_ROOM_MS, INVITE_KEY, PROMPT_MS, decideInvite, freshMemory, inviteMemory, promptActed, promptDismissed, promptShown } from './inviteNudgeModel.ts'
import type { InviteMemory, InviteMoment } from './inviteNudgeModel.ts'
import { useGrowth } from './useGrowth.ts'

// The chip is loaded the first time a prompt is shown, so the button stays small.
const InviteChip = defineAsyncComponent(() => import('./InviteChip.vue'))
defineProps<{ params?: unknown }>()
const { game, shell } = useApp()
const growth = useGrowth()
const community = useCommunity()
const view = game.view

/** A moment is said a moment after it happens, so it does not land on top of the reward that caused it. */
const SETTLE_MS = 2500
/** A moment that came during an activity is kept this long, to be offered when the activity ends. */
const KEEP_MS = 2 * 60000

const memory = ref<InviteMemory>(freshMemory())
const prompt = ref<InviteMoment | null>(null)
const shown = computed(() => view.value.onboarding?.required !== true)
const sending = computed(() => growth.state.busy !== null)

function load(): InviteMemory {
  try { return inviteMemory(JSON.parse(globalThis.localStorage?.getItem(INVITE_KEY) ?? 'null')) } catch { return freshMemory() }
}
function save(next: InviteMemory): void {
  memory.value = next
  try { globalThis.localStorage?.setItem(INVITE_KEY, JSON.stringify(next)) } catch { /* kept for this visit only */ }
}

// ---- what counts as busy ---------------------------------------------------------------------
/** A table game in progress (told by the Tables client's own events, so its code is not loaded for this). */
const tablePlaying = ref(false)
function onTrack(event: Event): void {
  const detail = (event as CustomEvent<{ name?: string; props?: Record<string, unknown> }>).detail
  if (detail?.name === 'match_started') tablePlaying.value = true
  else if (detail?.name === 'match_finished') {
    tablePlaying.value = false
    if (detail.props?.result === 'won') schedule('table-win')
  }
}
const busy = computed(() => Boolean(game.state.value.activeAction) || tablePlaying.value || shell.sheet.value !== null || game.mode.value !== 'venue')
const guestNotPlaying = computed(() => !view.value.connected || view.value.onboarding?.required === true)

// ---- deciding --------------------------------------------------------------------------------
let settle: ReturnType<typeof setTimeout> | null = null
let leave: ReturnType<typeof setTimeout> | null = null
let empty: ReturnType<typeof setTimeout> | null = null
let pending: { moment: InviteMoment; at: number } | null = null

const roomEmpty = computed(() => {
  const room = community.state.value
  return Boolean(room && room.connection === 'Connected' && !room.privateHome && room.memberCount === 1 && game.state.value.location !== 'home')
})
const stillApplies = (moment: InviteMoment): boolean => moment !== 'empty-venue' || roomEmpty.value

function propose(moment: InviteMoment): void {
  if (prompt.value) return
  const now = Date.now()
  const decision = decideInvite({ moment, memory: memory.value, now, activity: busy.value, guestNotPlaying: guestNotPlaying.value })
  if (decision.show && decision.which) { show(decision.which, now); return }
  if (decision.why === 'busy') pending = { moment, at: now }
}
function schedule(moment: InviteMoment): void {
  if (settle !== null) clearTimeout(settle)
  settle = setTimeout(() => { settle = null; propose(moment) }, SETTLE_MS)
}
function show(moment: InviteMoment, now: number): void {
  save(promptShown(memory.value, moment, now))
  prompt.value = moment
  growth.track('invite_prompt_shown', { moment })
  if (leave !== null) clearTimeout(leave)
  leave = setTimeout(() => { leave = null; prompt.value = null }, PROMPT_MS)
}
function hide(): void { if (leave !== null) clearTimeout(leave); leave = null; prompt.value = null }

function accept(): void {
  hide()
  save(promptActed(memory.value))
  void growth.share('invite', { surface: 'prompt' })
}
function dismiss(): void {
  const moment = prompt.value
  hide()
  save(promptDismissed(memory.value, Date.now()))
  if (moment) growth.track('invite_prompt_dismissed', { moment })
}
function press(): void { hide(); void growth.share('invite', { surface: 'hud' }) }

// The activity ended: a moment that had to wait is offered if it still applies.
watch(busy, (now) => {
  if (now || !pending) return
  const kept = pending
  pending = null
  if (Date.now() - kept.at < KEEP_MS && stillApplies(kept.moment)) propose(kept.moment)
})

// The first starter goal done, and a guest who has settled into a home: changes of the life, compared to the last look at it.
let life = ''
let lastGoals: number | null = null
let lastDone: boolean | null = null
watch(view, (now) => {
  if (!now.connected) return
  const id = `${now.session?.id ?? ''}:${now.cityId}`
  const goals = now.goals?.chain?.index ?? 0
  const done = now.onboarding?.done === true
  if (id !== life) { life = id; lastGoals = goals; lastDone = done; hide(); return }
  if (lastGoals !== null && lastGoals < 1 && goals >= 1) schedule('first-goal')
  else if (lastDone === false && done) schedule('home')
  lastGoals = goals; lastDone = done
}, { immediate: true })

// A venue room that has held only the player for a while.
watch(roomEmpty, (now) => {
  if (empty !== null) clearTimeout(empty)
  empty = null
  if (now) empty = setTimeout(() => { empty = null; if (roomEmpty.value) propose('empty-venue') }, EMPTY_ROOM_MS)
}, { immediate: true })

onMounted(() => {
  memory.value = load()
  globalThis.window?.addEventListener('jaw:track', onTrack)
})
onBeforeUnmount(() => {
  globalThis.window?.removeEventListener('jaw:track', onTrack)
  for (const timer of [settle, leave, empty]) if (timer !== null) clearTimeout(timer)
})
</script>

<template>
  <span v-if="shown" class="inv-slot">
    <button type="button" class="inv-button" aria-label="Invite your friends" title="Invite your friends" :disabled="sending" data-invite-button @click="press">
      <GameIcon name="people" :size="17" /><span class="inv-label">Invite</span>
    </button>
    <InviteChip v-if="prompt" :moment="prompt" @accept="accept" @dismiss="dismiss" />
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
