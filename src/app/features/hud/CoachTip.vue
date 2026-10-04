<script setup lang="ts">
// The first-session coach: one line above the venue panel that names the next control, and a ring
// on that control. It stops by itself after the first goals and can be switched off for good on
// this device.
//
// The ring is the class `is-coach` on a control another component owns (a nav tab, a spot, an
// activity card, a Phone icon), so it is set from here after each render, as the existing shell
// does. It moves into those components as a prop when they are converted.
import { computed, nextTick, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { COACH_KEY, coachStep } from './coachModel.ts'

const { game, shell } = useApp()
function readOff(): boolean { try { return globalThis.localStorage?.getItem(COACH_KEY) === '1' } catch { return false } }
const off = ref(readOff())
const goal = computed(() => { const chip = game.view.value.goals?.chip; return chip?.kind === 'goal' ? chip : null })
const step = computed(() => coachStep(game.state.value, game.view.value, { off: off.value, clean: shell.ui.clean, mode: game.mode.value, expanded: shell.ui.expanded, panelOf: (id) => shell.byId.get(id) }))

function ring(): void {
  for (const node of document.querySelectorAll('.is-coach')) node.classList.remove('is-coach')
  const now = step.value
  if (now?.target) document.querySelector(`#life-overlay ${now.target}`)?.classList.add('is-coach')
  if (now?.app && shell.sheet.value?.kind === 'phone') document.querySelector(`#life-dialog [data-ph-app="${CSS.escape(now.app)}"]`)?.classList.add('is-coach')
}
// After the DOM the ring points into has been drawn (the venue panel, or the phone once it is open).
watch([step, shell.sheet, game.state], () => { void nextTick(ring) }, { immediate: true, flush: 'post' })
function dismiss(): void {
  off.value = true
  try { globalThis.localStorage?.setItem(COACH_KEY, '1') } catch { /* still off for this visit */ }
}
</script>

<template>
  <div v-if="step && goal" class="life-coach" role="note">
    <span aria-hidden="true"><GameIcon inline name="pointer" /></span>
    <p><b>Goal {{ goal.step }} of {{ goal.of }} · {{ goal.title }}</b>{{ step.text }}</p>
    <button type="button" aria-label="Hide these tips" @click="dismiss"><GameIcon name="close" /></button>
  </div>
</template>
