<script setup lang="ts">
// What is happening right now: the running activity (or trip) with its bar, the time left, and
// Cancel with the real cancel rule. The time is the server's: it moves when a state arrives
// (about once a second while something runs), never on a timer of its own.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cityName } from '../../../game/cities/registry.ts'
import { useApp } from '../../state/app.ts'
import GameIcon from '../../ui/GameIcon.vue'
import { money } from '../../ui/format.ts'
import { isTrip } from './tripModel.ts'
import type { ActionPayload } from '../../../types/actions.ts'

// Paying to arrive now ('travel.skip') is fetched when a trip that offers it is running, not with the first screen.
const SkipTrip = defineAsyncComponent(() => import('../travel/SkipTrip.vue'))
const TeachingShift = defineAsyncComponent(() => import('../jobs/TeachingShift.vue'))
const { game, command } = useApp()
const state = game.state
const view = game.view
const active = computed(() => state.value.activeAction)
const activity = computed(() => view.value.activities.active)
const teaching = computed(() => view.value.career.teaching)
const card = ref<HTMLElement | null>(null)
let sizing: ResizeObserver | undefined
let sizingFrame = 0
function measureLesson(): void {
  sizingFrame = 0
  const progressCard = card.value
  if (!progressCard) return
  const slot = progressCard.closest<HTMLElement>('[data-slot="progress"]')
  const stack = slot?.parentElement
  const overlay = stack?.closest<HTMLElement>('.life-ui')
  if (!slot || !stack || !overlay) return
  if (!teaching.value) { slot.style.removeProperty('--teaching-progress-height'); return }
  const bounds = overlay.getBoundingClientRect(), bottom = stack.getBoundingClientRect()
  const scale = bounds.width / overlay.clientWidth || 1
  let top = bounds.top
  const progressBounds = progressCard.getBoundingClientRect()
  for (const element of overlay.querySelectorAll<HTMLElement>('.hud-bar,.notice,.life-quick,.life-goal,.life-alerts')) {
    if (stack.contains(element) || !element.getClientRects().length) continue
    const area = element.getBoundingClientRect()
    if (area.right > progressBounds.left && area.left < progressBounds.right) top = Math.max(top, area.bottom)
  }
  const otherRows = bottom.height - slot.getBoundingClientRect().height
  const height = Math.max(0, (Math.min(bottom.bottom, bounds.bottom) - top - otherRows) / scale - 12)
  slot.style.setProperty('--teaching-progress-height', `${height}px`)
}
function sizeLesson(): void {
  if (!sizingFrame) sizingFrame = requestAnimationFrame(measureLesson)
}
onMounted(() => {
  const stack = card.value?.closest<HTMLElement>('.life-bottom')
  const overlay = stack?.closest<HTMLElement>('.life-ui')
  if (overlay) {
    sizing = new ResizeObserver(sizeLesson)
    sizing.observe(overlay)
    if (stack) sizing.observe(stack)
    const sidebar = overlay.querySelector('.life-sidebar')
    if (sidebar) sizing.observe(sidebar)
    for (const element of overlay.querySelectorAll('.hud-bar,.notice,.life-quick,.life-goal,.life-alerts')) {
      if (!stack?.contains(element)) sizing.observe(element)
    }
  }
  window.addEventListener('resize', sizeLesson)
  sizeLesson()
})
watch(view, sizeLesson, { flush: 'post' })
onBeforeUnmount(() => {
  sizing?.disconnect()
  window.removeEventListener('resize', sizeLesson)
  cancelAnimationFrame(sizingFrame)
  card.value?.closest<HTMLElement>('[data-slot="progress"]')?.style.removeProperty('--teaching-progress-height')
})
const placeOf = (id: string): string => { const venue = view.value.venues.find((item) => item.id === id); return venue ? (id === 'home' ? 'Home' : venue.label) : 'your destination' }
const name = computed(() => {
  const now = active.value
  if (!now) return ''
  if (now.kind === 'homeward') return `Returning to your home in ${cityName(now.ticket.to)}`
  if (now.kind === 'intercity') return `Travelling to ${cityName(now.id)}`
  if (activity.value?.label) return activity.value.label
  return now.kind === 'travel' ? `Travelling to ${placeOf(now.id)}` : now.kind === 'commute' ? `Commuting to work · ${placeOf(now.id)}` : 'Action in progress'
})
const paid = computed(() => (activity.value?.reward ?? 0) > 0)
const sleeping = computed(() => Boolean(activity.value?.tags?.includes('sleep')))
const fixed = computed(() => active.value?.kind === 'intercity' || active.value?.kind === 'homeward' || (Boolean(activity.value) && !activity.value?.cancellable))
const connection = computed(() => {
  const now = active.value
  if (now?.kind !== 'homeward') return ''
  const leg = now.ticket.legs[now.legIndex]
  return leg ? `Connection ${now.legIndex + 1} of ${now.ticket.legs.length}: ${cityName(leg.from)} → ${cityName(leg.to)} · ${{ air: 'Flight', road: 'Road', rail: 'Train' }[leg.mode]}` : ''
})
const progress = computed(() => { const now = active.value; return now ? Math.max(0, Math.min(1, 1 - now.remaining / (now.duration || 1))) : 0 })
const cancelLabel = computed(() => (fixed.value ? 'This cannot be cancelled once started' : paid.value ? 'Cancel shift. Cancelling earns nothing' : sleeping.value ? 'Wake up. The rest you got is kept' : 'Cancel current activity'))

const cancelling = ref(false)
const answering = ref(false)
async function answer(payload: ActionPayload<'career.teach'>): Promise<void> {
  if (answering.value || cancelling.value || !view.value.connected) return
  answering.value = true
  try { await command('career.teach', payload) } finally { answering.value = false }
}
async function cancel(): Promise<void> {
  if (cancelling.value || answering.value || !view.value.connected) return
  cancelling.value = true
  try { await command('cancel') } finally { cancelling.value = false }
}
</script>

<template>
  <section v-if="active" ref="card" class="life-progress" :class="{ 'is-homeward': active.kind === 'homeward' }" aria-label="Current activity">
    <span class="life-progress-icon" aria-hidden="true"><GameIcon inline kind="activity" :id="activity?.id" :emoji="activity?.icon || (isTrip(active) ? '🧭' : '⏳')" /></span>
    <div><strong>{{ name }}</strong><small v-if="connection">{{ connection }}</small><small v-if="teaching">Your teaching choices complete the shift</small><small v-else>{{ Math.ceil(active.remaining) }}s left</small></div>
    <button v-if="!fixed && !teaching" type="button" :disabled="cancelling" :aria-label="cancelLabel" @click="cancel">{{ cancelling ? 'Cancelling…' : sleeping ? 'Wake up' : 'Cancel' }}</button>
    <progress v-if="!teaching" max="1" :value="progress" aria-label="Activity progress" />
    <TeachingShift v-if="teaching" class="life-progress-lesson" :generation="teaching.generation" :practice="teaching.practice" :disabled="answering || cancelling || !view.connected" @answer="answer" @cancel="cancel" />
    <p v-if="paid && activity" class="life-progress-note">Pays {{ money(activity.reward) }} when finished. Cancelling earns nothing.</p>
    <p v-else-if="fixed" class="life-progress-note">This cannot be cancelled once started.</p>
    <SkipTrip v-if="view.travel.skip" />
  </section>
</template>

<style scoped>
.life-progress.is-homeward>div>strong,.life-progress.is-homeward>div>small{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;line-height:1.45}
.life-progress.is-homeward>div>small{font-size:12px}
.life-progress-lesson{grid-column:1/-1;width:100%;min-width:0}
</style>
