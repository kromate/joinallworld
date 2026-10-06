<script setup lang="ts">
// The walkthrough: a dimmed screen with a cut-out around the thing being explained, and a small card beside it.
// Native, no library. Nothing here keeps time: the cut-out is moved by a ResizeObserver and by one animation
// frame requested after a resize, a scroll or a change of layout, and then it stops. The 3D scene behind is not
// touched: the tour is plain page elements, so a scene that is idle stays idle.
//
// The page is found by `data-tour="<id>"` attributes on the controls the steps explain. A step whose target is
// not on screen is skipped. The card is a dialog named by its title and described by its text; focus stays in
// it (Tab also reaches the lit control, which stays usable), Esc skips, ← and → move, and focus goes back to
// where it was when the tour ends.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { tour, track } from './tourState.ts'
import { signupShown } from '../account/shownOnce.ts'
import { closes, isDone, playlist, seek, showable, tourPaused, wordsOf } from './tourModel.ts'
import { tourSteps } from '../companion/tours.ts'
import { createMemory } from '../companion/memory.ts'
import { COMPANION_NAME } from '../companion/identity.ts'
import CompanionFace from '../companion/CompanionFace.vue'
import type { TourId } from '../companion/types.ts'
import { openWorld } from './tourWorld.ts'
import { callStore } from '../calls/callState.ts'
import { input, startInputMode } from '../../state/inputMode.ts'
import type { StepContext, TourStep } from './tourModel.ts'
import { placeCard, spotlightOf } from './placement.ts'
import type { Placement, Rect } from './placement.ts'

const props = withDefaults(defineProps<{ replay?: boolean; tour?: TourId }>(), { replay: false, tour: 'basics' })
const emit = defineEmits<{ end: [] }>()
const { game, shell } = useApp()

const memory = createMemory(globalThis.localStorage ?? null, game.view.value.session?.id ?? '')
const layer = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const list = shallowRef<TourStep[]>([])
const index = ref(0)
const done = ref(false)
const hole = ref<(Rect & { radius: number }) | null>(null)
const spot = ref<Placement | null>(null)
const cardWidth = ref(360)
const announced = ref(false)

const step = computed(() => list.value[index.value] ?? null)
const last = computed(() => index.value >= list.value.length - 1)
const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
const sheetKind = computed(() => shell.sheet.value?.kind ?? null)
/** A sheet that is not the tour's own (a settle-in offer, a call, anything): the tour waits behind it. */
const callUp = computed(() => callStore.view.phase !== 'idle' || callStore.confirm !== null)
const paused = computed(() => tourPaused({ sheet: sheetKind.value, allows: step.value?.allows, call: callUp.value }))
/** The phone is a modal dialog in the top layer, so the card lives inside it while the step is about the phone. */
const host = computed(() => (sheetKind.value === 'phone' && step.value?.allows === 'phone' ? '#life-dialog' : 'body'))

function visible(node: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement)) return false
  const box = node.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && node.getClientRects().length > 0
}
function find(id: string): HTMLElement | null {
  for (const node of document.querySelectorAll(`[data-tour="${CSS.escape(id)}"]`)) if (visible(node)) return node
  return null
}
const context = (): StepContext => ({ home: game.state.value.location === 'home', touch: input.touch, keys: input.keys, has: (id) => find(id) !== null, world: openWorld(game.cityId.value) })
startInputMode()
const ctx = computed(() => { void index.value; void done.value; void input.touch; void input.keys; return context() })
const words = computed(() => (step.value ? wordsOf(step.value, ctx.value, done.value) : { title: '', text: '', task: null }))
/** The spoken text is derived from the words on the card, so it follows the input mode (keys or touch) exactly as the visible text does. */
const announce = computed(() => (!announced.value || !step.value ? '' : done.value && step.value.wait ? words.value.text : `Step ${index.value + 1} of ${list.value.length}: ${words.value.title}. ${words.value.text}`))
const keyRows = computed(() => (step.value?.keys ? step.value.keys(ctx.value) : []))
const action = computed(() => step.value?.action ?? null)

function target(): HTMLElement | null {
  const now = step.value
  if (!now) return null
  const ids = done.value && now.doneTargets ? now.doneTargets : now.targets
  for (const id of ids ?? []) { const node = find(id); if (node) return node }
  return null
}

// ---- where things are -------------------------------------------------------------------
/** How many page pixels one pixel of the layer is (the interface is zoomed on very wide screens). */
function zoom(): number {
  const box = probe.value?.getBoundingClientRect()
  return box && box.width > 0 ? box.width / 100 : 1
}
let observer: ResizeObserver | null = null
let watched: HTMLElement | null = null
let frame = 0
function measure(): void {
  frame = 0
  const root = layer.value
  if (!root || !step.value) return
  const z = zoom()
  const view = { width: window.innerWidth / z, height: window.innerHeight / z }
  const node = target()
  if (node !== watched) { observer?.disconnect(); watched = node; if (node) observer?.observe(node) }
  cardWidth.value = Math.round(Math.min(360, view.width - 24))
  let box: (Rect & { radius: number }) | null = null
  if (node) {
    const raw = node.getBoundingClientRect()
    const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 10
    box = spotlightOf({ left: raw.left / z, top: raw.top / z, width: raw.width / z, height: raw.height / z }, view, { radius })
  }
  hole.value = box
  const shown = card.value?.getBoundingClientRect()
  pointAt(node)
  const size = { width: cardWidth.value, height: shown && shown.height > 0 ? shown.height / z : 220 }
  spot.value = placeCard(box, size, view, { prefer: step.value.prefer })
}
/** Tell the companion where the lit thing and the card are (page pixels), so its character can stand by it and point. */
function pointAt(node: HTMLElement | null): void {
  const lit = node?.getBoundingClientRect(), shown = card.value?.getBoundingClientRect()
  const rect = (box: DOMRect | undefined): { left: number; top: number; width: number; height: number } | null => (box && box.width > 0 ? { left: box.left, top: box.top, width: box.width, height: box.height } : null)
  window.dispatchEvent(new CustomEvent('jaw:companion-point', { detail: { active: true, target: rect(lit), card: rect(shown) } }))
}
/** One measurement on the next frame, however many things asked for it. */
function schedule(): void { if (!frame) frame = requestAnimationFrame(measure) }
let settling: number[] = []
/** The page rearranges for a moment after a step (a panel opens, a sheet fetches its code): look again a few times, once each. */
function settle(): void {
  for (const timer of settling) clearTimeout(timer)
  schedule()
  settling = [120, 400, 900].map((ms) => window.setTimeout(schedule, ms))
}

// ---- moving between steps -----------------------------------------------------------------
let before: Element | null = null
let wasExpanded = false
let advancing = 0
/** Leave the step; `next` is the one being entered, which may carry on with what this one has open. */
function leave(next: TourStep | null = null): void {
  clearTimeout(advancing)
  const now = step.value
  if (!now) return
  if (now.expand) shell.ui.expanded = wasExpanded
  const shut = closes(now, next)
  if (shut === 'map' && game.mode.value === 'map') shell.close()
  if (shut === 'phone' && shell.sheet.value?.kind === 'phone') shell.close()
}
function enter(): void {
  const now = step.value
  if (!now) return
  done.value = isDone(now.wait, { activeAction: Boolean(game.state.value.activeAction), mode: game.mode.value, sheet: sheetKind.value })
  if (now.expand) { wasExpanded = shell.ui.expanded; shell.ui.expanded = true }
  track('tour_step', { index: index.value })
  if (now.id === 'signup') signupShown('tour')
  announced.value = true
  void nextTick(() => {
    target()?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    settle()
    const on = document.activeElement
    if (!on || on === document.body || index.value === 0) (card.value?.querySelector<HTMLElement>('[data-primary]') ?? card.value)?.focus({ preventScroll: true })
  })
}
function go(way: 1 | -1): void {
  const next = seek(list.value, index.value, way, context())
  if (next < 0) { if (way === 1) finish(); return }
  leave(list.value[next] ?? null)
  index.value = next
  enter()
}
let ended = false
function close(): void {
  if (ended) return
  ended = true
  leave()
  tour.active = false
  window.dispatchEvent(new CustomEvent('jaw:companion-point', { detail: { active: false } }))
  const back = before
  if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true })
  emit('end')
}
function finish(): void { track('tour_finished', { steps: list.value.length }); memory.tour(props.tour, 'done'); close() }
function skip(): void { track('tour_skipped', { at: index.value }); memory.tour(props.tour, 'skipped'); const at = step.value?.id; if (at && props.tour !== 'basics') memory.resume(props.tour, at); close() }
function shortcuts(): void { finish(); window.dispatchEvent(new CustomEvent('jaw:shortcuts', { detail: { from: 'tour' } })) }

// ---- the player does the thing ---------------------------------------------------------------
watch(() => step.value ? isDone(step.value.wait, { activeAction: Boolean(game.state.value.activeAction), mode: game.mode.value, sheet: sheetKind.value }) : false, (now) => {
  const was = done.value
  done.value = now
  if (now === was || !step.value) return
  if (now) {
    settle()
    const at = index.value
    if (step.value.advance) advancing = window.setTimeout(() => { if (index.value === at && !ended) go(1) }, 1100)
  } else settle()
})
watch([() => shell.ui.expanded, () => shell.ui.clean, () => shell.ui.trayOpen, () => game.mode.value, sheetKind, () => game.state.value.location, paused], () => { void nextTick(settle) })

// ---- keys ---------------------------------------------------------------------------------
function focusable(root: Element | null): HTMLElement[] {
  if (!root) return []
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0)
}
function onKey(event: KeyboardEvent): void {
  if (paused.value || ended) return
  const inField = event.target instanceof Element && event.target.matches('input, textarea, select, [contenteditable]')
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); skip(); return }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '?') { event.stopPropagation(); return }
  if (inField) return
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); go(event.key === 'ArrowRight' ? 1 : -1); return }
  if (event.key === 'Enter') {
    const on = document.activeElement
    // On a button (the card's, or the lit control) Enter does what the button does; elsewhere it is Next.
    if (on instanceof HTMLElement && on.matches('button, a, summary, [role="button"]')) return
    event.preventDefault(); event.stopPropagation(); go(1); return
  }
  if (event.key === 'Tab') {
    const lit = target()
    const litStops = lit ? (focusable(lit).length ? focusable(lit) : lit.matches('button, a, [tabindex]') ? [lit] : []) : []
    const stops = [...focusable(card.value), ...litStops.slice(0, 1)]
    if (!stops.length) { event.preventDefault(); return }
    const at = stops.indexOf(document.activeElement as HTMLElement)
    const next = at < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length
    event.preventDefault()
    stops[next]?.focus()
  }
}

// ---- life of the tour ---------------------------------------------------------------------
onMounted(() => {
  before = document.activeElement
  if (props.replay) { shell.ui.clean = false; shell.ui.trayOpen = false }
  list.value = playlist(tourSteps(props.tour), context()).filter((item, at, all) => at === 0 || at === all.length - 1 || showable(item, context()))
  if (list.value.length < 2) { tour.active = false; emit('end'); return }
  tour.active = true
  const resumeAt = props.tour === 'basics' ? undefined : memory.data.resume[props.tour]
  const resumed = resumeAt ? list.value.findIndex((item) => item.id === resumeAt) : -1
  if (resumed > 0) index.value = resumed
  memory.tour(props.tour, 'started')
  observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', schedule)
  window.addEventListener('scroll', schedule, { capture: true, passive: true })
  track('tour_started', { replay: props.replay, steps: list.value.length, tour: props.tour })
  enter()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', schedule)
  window.removeEventListener('scroll', schedule, true)
  observer?.disconnect()
  cancelAnimationFrame(frame)
  clearTimeout(advancing)
  for (const timer of settling) clearTimeout(timer)
  if (!ended) { ended = true; tour.active = false }
})

const holeStyle = computed(() => (hole.value ? { left: `${hole.value.left}px`, top: `${hole.value.top}px`, width: `${hole.value.width}px`, height: `${hole.value.height}px`, borderRadius: `${hole.value.radius}px` } : undefined))
/** Four clear panes around the cut-out take the taps that are not on the lit control. */
const panes = computed(() => {
  const area = hole.value
  if (!area) return []
  const right = area.left + area.width, bottom = area.top + area.height
  return [
    { left: '0', top: '0', width: '100%', height: `${area.top}px` },
    { left: '0', top: `${bottom}px`, width: '100%', bottom: '0' },
    { left: '0', top: `${area.top}px`, width: `${area.left}px`, height: `${area.height}px` },
    { left: `${right}px`, top: `${area.top}px`, right: '0', height: `${area.height}px` },
  ]
})
const cardStyle = computed(() => ({ width: `${cardWidth.value}px`, left: `${spot.value?.left ?? 0}px`, top: `${spot.value?.top ?? 0}px`, visibility: spot.value ? 'visible' as const : 'hidden' as const, '--arrow': `${spot.value?.arrow ?? 0}px` }))
const waiting = computed(() => Boolean(step.value?.wait) && !done.value)
</script>

<template>
  <Teleport :to="host">
    <div v-show="!paused" ref="layer" class="tour" :class="{ 'is-still': reduced, 'in-dialog': host !== 'body' }" data-tour-layer>
      <i ref="probe" class="tour-probe" aria-hidden="true" />
      <template v-if="hole">
        <i v-for="(pane, at) in panes" :key="at" class="tour-pane" :style="pane" aria-hidden="true" />
        <i class="tour-hole" :style="holeStyle" aria-hidden="true" />
        <i v-if="!waiting" class="tour-cap" :style="holeStyle" aria-hidden="true" />
      </template>
      <i v-else class="tour-dim" aria-hidden="true" />
      <section ref="card" class="tour-card" :class="spot?.side ? `is-${spot.side}` : undefined" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-text" tabindex="-1" :style="cardStyle">
        <i v-if="spot && spot.side !== 'center' && spot.arrow !== null" class="tour-arrow" aria-hidden="true" />
        <p class="tour-guide"><CompanionFace :size="34" :mood="done && step?.wait ? 'happy' : 'talk'" /><b>{{ COMPANION_NAME }}</b><small>AI guide</small></p>
        <p class="tour-count"><span>{{ index + 1 }} of {{ list.length }}</span><span class="tour-dots" aria-hidden="true"><i v-for="(_, at) in list" :key="at" :class="{ 'is-on': at === index, 'is-past': at < index }" /></span></p>
        <h2 id="tour-title">{{ words.title }}</h2>
        <p id="tour-text">{{ words.text }}</p>
        <ul v-if="keyRows.length" class="tour-keys"><li v-for="row in keyRows" :key="row.text"><span><kbd v-for="cap in row.caps" :key="cap">{{ cap }}</kbd></span>{{ row.text }}</li></ul>
        <p v-if="words.task" class="tour-task"><span aria-hidden="true">👉</span> {{ words.task }}</p>
        <p v-else-if="done && step?.wait" class="tour-task is-done"><span aria-hidden="true">✓</span> Nice.</p>
        <div class="tour-actions">
          <button class="tour-skip" type="button" @click="skip">{{ props.tour === 'basics' ? 'Skip tour' : 'Not now' }}</button>
          <button v-if="index > 0" class="tour-back" type="button" @click="go(-1)">Back</button>
          <button v-if="action" class="tour-back" type="button" @click="shortcuts">{{ action.label }}</button>
          <button class="tour-next" type="button" data-primary @click="go(1)">{{ last ? 'Done' : step?.wait && !done ? 'Skip this' : 'Next' }}</button>
        </div>
        <p class="ui-sr" role="status" aria-live="polite">{{ announce }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.tour { position: fixed; inset: 0; z-index: 60; pointer-events: none; font: 14px/1.4 var(--font); color: var(--c-ink); }
.tour:not(.in-dialog) { zoom: var(--ui-zoom); --ui-vh: calc(1dvh / var(--ui-zoom)); }
.tour-probe { position: absolute; left: 0; top: 0; width: 100px; height: 1px; visibility: hidden; pointer-events: none; }
.tour-dim { position: absolute; inset: 0; pointer-events: auto; background: rgba(10, 18, 15, .72); }
.tour-pane { position: absolute; background: transparent; pointer-events: auto; }
.tour-hole { position: absolute; pointer-events: none; box-shadow: 0 0 0 3px #fff, 0 0 0 200vmax rgba(10, 18, 15, .72); transition: left .22s var(--ease-out), top .22s var(--ease-out), width .22s var(--ease-out), height .22s var(--ease-out); }
/* A step that is only looking: the lit control is not pressed by accident. */
.tour-cap { position: absolute; background: transparent; pointer-events: auto; }
.tour-card { position: absolute; pointer-events: auto; box-sizing: border-box; padding: 16px 16px 12px; background: #fff; border-radius: var(--r-md); box-shadow: var(--e-3); outline: none; transition: left .22s var(--ease-out), top .22s var(--ease-out); }
.tour-card:focus-visible { outline: var(--focus); outline-offset: 2px; }
.tour-arrow { position: absolute; width: 14px; height: 14px; background: #fff; transform: rotate(45deg); }
.is-bottom .tour-arrow { top: -7px; left: calc(var(--arrow) - 7px); }
.is-top .tour-arrow { bottom: -7px; left: calc(var(--arrow) - 7px); }
.is-left .tour-arrow { right: -7px; top: calc(var(--arrow) - 7px); }
.is-right .tour-arrow { left: -7px; top: calc(var(--arrow) - 7px); }
.tour-guide { display: flex; align-items: center; gap: 8px; margin: -6px 0 6px; font-size: var(--t-body); }
.tour-guide small { padding: 1px 7px; border-radius: var(--r-pill); background: var(--c-green-soft); color: var(--c-green-dark); font-weight: 700; font-size: var(--t-micro); }
.tour-count { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 6px; color: var(--c-muted); font-size: var(--t-small); font-weight: 700; letter-spacing: .02em; }
.tour-dots { display: inline-flex; gap: 4px; }
.tour-dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--c-fill-2); }
.tour-dots i.is-past { background: var(--c-green); opacity: .55; }
.tour-dots i.is-on { width: 16px; border-radius: 3px; background: var(--c-green-dark); }
h2 { margin: 0 0 4px; font-size: var(--t-title); line-height: 1.25; }
#tour-text { margin: 0; color: var(--c-ink-2); font-size: 14px; }
.tour-keys { display: grid; gap: 6px; margin: 10px 0 0; padding: 0; list-style: none; font-size: 13px; color: var(--c-ink-2); }
.tour-keys li { display: flex; align-items: center; gap: 10px; }
.tour-keys li > span { display: inline-flex; gap: 3px; min-width: 150px; }
kbd { display: inline-grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border: 1px solid #c9cfcb; border-bottom-width: 2px; border-radius: 6px; background: #f6f8f7; color: var(--c-ink); font: 700 12px var(--font); }
.tour-task { margin: 10px 0 0; padding: 8px 10px; border-radius: var(--r-xs); background: var(--c-amber-soft); color: var(--c-amber-dark); font-size: 13px; font-weight: 700; }
.tour-task.is-done { background: var(--c-green-soft); color: var(--c-green-dark); }
.tour-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.tour-actions button { min-height: var(--tap); padding: 0 16px; border: 0; border-radius: var(--r-pill); background: var(--c-fill); color: var(--c-ink); font: 700 13px var(--font); cursor: pointer; }
.tour-actions button:focus-visible { outline: var(--focus); outline-offset: 2px; }
.tour-actions .tour-next { background: var(--c-green-dark); color: #fff; }
.tour-actions .tour-skip { margin-right: auto; padding: 0 6px; background: none; color: var(--c-ink-2); text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 420px) { .tour-actions button { padding: 0 12px; } }
@media (prefers-reduced-motion: reduce) { .tour-hole, .tour-card { transition: none; } }
.is-still .tour-hole, .is-still .tour-card { transition: none; }
</style>
