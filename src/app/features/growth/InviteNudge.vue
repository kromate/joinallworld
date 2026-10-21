<script setup lang="ts">
// The invitation prompts, mounted beside the Invite button (InviteButton.vue) once the game is idle, so none of this is in the
// first download: at a few natural moments (the first goal done, settled into a
// home, a quiet room, a table won) the chip offers the same thing, once each, never during an
// activity and never to a guest who has not pressed Play. When to prompt is inviteNudgeModel.ts;
// what is remembered is kept on this device (INVITE_KEY). Nothing here runs on a timer except the
// short waits noted below, each a single timeout that is cleared when it no longer applies.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { useCommunity } from '../community/communityStore.ts'
import { EMPTY_ROOM_MS, INVITE_KEY, PROMPT_MS, decideInvite, freshMemory, inviteMemory, promptActed, promptDismissed, promptShown } from './inviteNudgeModel.ts'
import type { InviteMemory, InviteMoment } from './inviteNudgeModel.ts'
import { useGrowth } from './useGrowth.ts'
import { hold } from '../../state/landingHold.ts'
import { settleWanted, tour } from '../tour/tourState.ts'

// The chip is loaded the first time a prompt is shown, so the button stays small.
const InviteChip = defineAsyncComponent(() => import('./InviteChip.vue'))
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
/** One ask at a time (tourState.ts): while the settle-in offer is up, the invitation waits behind it. */
const waitsForSettle = computed(() => settleWanted(view.value, tour.settleAway))
const stillApplies = (moment: InviteMoment): boolean => moment !== 'empty-venue' || roomEmpty.value

function propose(moment: InviteMoment): void {
  if (prompt.value) return
  // The first landing: the walkthrough goes first, then the offer to settle in. The moment is kept and offered once they have gone.
  if (hold.invite || waitsForSettle.value) { pending = { moment, at: Date.now() }; return }
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
/** The Invite button was pressed: a chip that is up goes away (InviteButton.vue). */
const onPress = (): void => hide()

// The landing's hold ended: a moment that waited is offered if it still applies.
watch([() => hold.invite, waitsForSettle], ([held, settling]) => {
  if (held || settling || !pending || busy.value) return
  const kept = pending
  pending = null
  if (Date.now() - kept.at < KEEP_MS && stillApplies(kept.moment)) propose(kept.moment)
})

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
  globalThis.window?.addEventListener('jaw:invite-press', onPress)
})
onBeforeUnmount(() => {
  globalThis.window?.removeEventListener('jaw:track', onTrack)
  globalThis.window?.removeEventListener('jaw:invite-press', onPress)
  for (const timer of [settle, leave, empty]) if (timer !== null) clearTimeout(timer)
})
</script>

<template>
  <InviteChip v-if="prompt && game.mode.value === 'venue'" :moment="prompt" @accept="accept" @dismiss="dismiss" />
</template>
