<script setup lang="ts">
// The goal chip in the HUD: the current starter goal (title + how-to hint) and, once the chain is
// done, a rolling next step. It also toasts each new entry of view.goals.feed once ("Goal
// complete: Freshen up · +₦500 +1 star"). To a guest of the quick start it offers settling in
// ("Make this life yours") at natural moments — after the first reward, after the third activity,
// on a later day — at most NUDGE_CAP times, never over another sheet or in the middle of an
// activity (the policy is src/quick-start/model.ts nextNudge). A life that never was a guest and
// has no character yet is offered character creation once, as before.
//
// The Goals tab of the Sim sheet is GoalsTab.vue. All rules live in src/game/systems/goals.ts.
import { computed, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { helpStep } from '../relief/reliefHelp.ts'
import { makeContext } from '../../../game/util.ts'
import { keepNudges, nudgesOf } from '../../../quick-start/entry.ts'
import { NUDGE_QUIET_MS, nextNudge, nudged } from '../../../quick-start/model.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { tour } from '../tour/tourState.ts'
import GlyphText from '../kit/GlyphText.vue'
import { chipAction, chipLabel, lagosDay, newFeed, rememberSeq } from './goalChipModel.ts'

const { game, shell, goTo, community } = useApp()
const view = game.view
// The moments a player could be stuck in: the one line points at the first step of the "What you can do now" card.
const step = computed(() => {
  const help = helpStep(game.state.value, makeContext({ cityId: game.cityId.value, now: game.state.value.t }))
  return help ? { kind: 'guide' as const, ...help } : view.value.goals.chip
})

/** How long the reward toast is left alone before the offer comes up. */
const NUDGE_DELAY_MS = 1400
let lastSeq: number | null = null
let offeredTo: string | null = null
let nudging = false

function press(): void {
  const action = chipAction(step.value)
  if (action.kind === 'open') shell.open(action.id, action.params)
  else if (action.kind === 'go') void goTo(action.venue, action.spot)
  else { shell.closeSheet(); shell.ui.trayOpen = false; community.toggle(true) }
}

/** What the chip's own markup depends on: the old chip did its bookkeeping when this changed, not on every state. */
const signature = computed(() => JSON.stringify([step.value, view.value.goals.seq, view.value.connected]))

function bookkeeping(): void {
  const now = view.value, state = game.state.value
  if (!now.connected || tour.active) return
  const { seq, feed } = now.goals
  lastSeq = rememberSeq(seq, lastSeq)
  for (const item of newFeed(feed, lastSeq)) game.toast(item.text, 'good')
  lastSeq = seq
  // Offer character creation once per device session; closing it leaves the chip as the way back.
  const who = `${now.session?.id ?? ''}:${now.cityId}`
  const o = now.onboarding
  if (o.guest) {
    if (o.required || nudging) return
    const day = lagosDay(now.now), memory = nudgesOf(who)
    const reason = nextNudge({ guest: true, activities: o.activities, firstAt: o.timing.firstAt, busy: Boolean(state.activeAction), day, at: now.now }, memory)
    if (!reason) return
    nudging = true
    // One timer, once: the reward toast is read first, and the offer never lands on top of another sheet.
    setTimeout(() => {
      nudging = false
      // …nor on top of any other sheet (the analytics question is its own dialog).
      const latest = game.view.value
      const still = latest.onboarding?.guest && !game.state.value.activeAction && !document.querySelector('dialog[open]') && !tour.active
      if (!still) return // asked again at the next change
      keepNudges(who, nudged(nudgesOf(who), reason, day, game.view.value.now))
      shell.open('onboarding', { nudge: reason })
    }, NUDGE_DELAY_MS)
  } else if (!state.onboarding.done && offeredTo !== who) {
    // Offered once per visit, and not again on a reload while the last offer is still quiet.
    offeredTo = who
    const memory = nudgesOf(who)
    if (memory.until !== null && now.now < memory.until && memory.until - now.now <= NUDGE_QUIET_MS) return
    keepNudges(who, nudged(memory, 'create', lagosDay(now.now), now.now))
    queueMicrotask(() => { shell.open('onboarding') })
  }
}
watch(signature, bookkeeping, { immediate: true, flush: 'post' })
// The walkthrough is over: whatever waited for it (the offer to settle in) is looked at again.
watch(() => tour.active, (on) => { if (!on) bookkeeping() }, { flush: 'post' })
</script>

<template>
  <button type="button" class="life-job goal-chip" data-tour="goal" :class="`is-${step.kind}`" :data-seq="view.goals.seq" :data-live="view.connected ? 1 : 0" :aria-label="chipLabel(step)" @click="press()">
    <span aria-hidden="true"><GameIcon inline kind="goal" :id="step.kind === 'goal' ? step.id : undefined" :emoji="step.icon" /></span>
    <div>
      <strong>{{ step.title }}</strong>
      <small><GlyphText :text="step.hint" /></small>
      <em v-if="step.kind === 'goal'">Goal {{ step.step }}/{{ step.of }} · <GlyphText :text="step.reward" /></em>
    </div>
  </button>
</template>

<style scoped src="../../../ui/panels/goals.css"></style>
