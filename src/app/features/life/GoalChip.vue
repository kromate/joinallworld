<script setup lang="ts">
// The goal chip in the HUD: the current starter goal (title + how-to hint) and, once the chain is
// done, a rolling next step. It also toasts each new entry of view.goals.feed once ("Goal
// complete: Freshen up · +₦500 +1 star"). To a guest of the quick start it offers settling in
// ("Make this life yours") at natural moments — after the first reward, after the third activity,
// on a later day — at most NUDGE_CAP times, never over another sheet or in the middle of an
// activity (the policy is src/quick-start/model.js nextNudge). A life that never was a guest and
// has no character yet is offered character creation once, as before.
//
// The Goals tab of the Sim sheet is GoalsTab.vue. All rules live in src/game/systems/goals.js.
import { computed, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { keepNudges, nextNudge, nudged, nudgesOf } from '../../legacy/parts.ts'
import GameIcon from '../../ui/GameIcon.vue'
import GlyphText from '../kit/GlyphText.vue'
import { chipAction, chipLabel, lagosDay, newFeed, rememberSeq } from './goalChipModel.ts'

const { game, shell, goTo, toggleCommunity } = useApp()
const view = game.view
const step = computed(() => view.value.goals.chip)

/** How long the reward toast is left alone before the offer comes up. */
const NUDGE_DELAY_MS = 1400
let lastSeq: number | null = null
let offeredTo: string | null = null
let nudging = false

function press(): void {
  const action = chipAction(step.value)
  if (action.kind === 'open') shell.open(action.id, action.params)
  else if (action.kind === 'go') void goTo(action.venue, action.spot)
  else { shell.closeSheet(); shell.ui.trayOpen = false; toggleCommunity() }
}

/** What the chip's own markup depends on: the old chip did its bookkeeping when this changed, not on every state. */
const signature = computed(() => JSON.stringify([step.value, view.value.goals.seq, view.value.connected]))

function bookkeeping(): void {
  const now = view.value, state = game.state.value
  if (!now.connected) return
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
    const reason = nextNudge({ guest: true, activities: o.activities, firstAt: o.timing.firstAt, busy: Boolean(state.activeAction), day }, memory)
    if (!reason) return
    nudging = true
    // One timer, once: the reward toast is read first, and the offer never lands on top of another sheet.
    setTimeout(() => {
      nudging = false
      // …nor on top of any other sheet (the analytics question is its own dialog).
      const latest = game.view.value
      const still = latest.onboarding?.guest && !game.state.value.activeAction && !document.querySelector('dialog[open]')
      if (!still) return // asked again at the next change
      keepNudges(who, nudged(nudgesOf(who), reason, day))
      shell.open('onboarding', { nudge: reason })
    }, NUDGE_DELAY_MS)
  } else if (!state.onboarding.done && offeredTo !== who) { offeredTo = who; queueMicrotask(() => { shell.open('onboarding') }) }
}
watch(signature, bookkeeping, { immediate: true, flush: 'post' })
</script>

<template>
  <button type="button" class="life-job goal-chip" :class="`is-${step.kind}`" :data-seq="view.goals.seq" :data-live="view.connected ? 1 : 0" :aria-label="chipLabel(step)" @click="press()">
    <span aria-hidden="true"><GameIcon inline kind="goal" :id="step.kind === 'goal' ? step.id : undefined" :emoji="step.icon" /></span>
    <div>
      <strong>{{ step.title }}</strong>
      <small><GlyphText :text="step.hint" /></small>
      <em v-if="step.kind === 'goal'">Goal {{ step.step }}/{{ step.of }} · <GlyphText :text="step.reward" /></em>
    </div>
  </button>
</template>

<style scoped src="../../../ui/panels/goals.css"></style>
