<script setup lang="ts">
// What a tap in the 3D place answers. The host decides what a tap does (walk there, open a person, open a table);
// this card says it in words, and only where the host stays silent:
//   a spot        its name, what it is, and (once the avatar is there) what you can do, each with its time and price or the reason it cannot;
//   scenery       a tap that walks nowhere (a wall, a tree, a prop): what it is, that it is just scenery, and the nearest thing to do.
// People and game tables already open their own card. Loaded after the scene is up, so it is not part of the first download.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ActivityCard } from '../../types/view.ts'
import { useApp } from '../state/app.ts'
import GameIcon from '../ui/GameIcon.vue'
import { activityFace } from '../features/venue/venueModel.ts'
import { classifyTap, nearestSpot, placeCard, wentSomewhere } from './tapModel.ts'
import type { TapScene } from './tapModel.ts'

const props = defineProps<{ bottom: () => Element | null }>()
const { game, shell, scene, command } = useApp()
const state = game.state, view = game.view
const root = ref<HTMLElement | null>(null)

interface Near { id: string; label: string; icon: string; px: number; py: number; x: number; z: number }
type Shown = { kind: 'spot'; id: string; at: { x: number; y: number } } | { kind: 'scenery'; at: { x: number; y: number }; near: Near | null; name?: string | undefined }
const shown = ref<Shown | null>(null)
const pos = ref({ x: 0, y: 0, sheet: false, lift: 0 })
const pending = ref<string | null>(null)
let hideTimer = 0, checkTimer = 0
let before = { x: 0, z: 0 }

const spotInfo = computed(() => shown.value?.kind === 'spot' ? view.value.activities.spots.find(spot => spot.id === (shown.value as { id: string }).id) : undefined)
const arrived = computed(() => shown.value?.kind === 'spot' && state.value.spot === shown.value.id)
const actions = computed(() => arrived.value && !state.value.activeAction ? view.value.activities.cards.map(card => ({ card, face: activityFace(card, state.value, view.value.connected) })) : [])
const MAX = 3
const closeBy = computed(() => shown.value?.kind === 'scenery' ? shown.value.near : null)

function hide(): void { clearTimeout(hideTimer); clearTimeout(checkTimer); shown.value = null }
function show(next: Shown, ms = 0): void {
  clearTimeout(hideTimer)
  shown.value = next
  if (ms) hideTimer = window.setTimeout(hide, ms)
  void nextTick(place)
}
/** Beside the tapped place on a wide screen; a sheet above the bottom bar on a phone. */
function place(): void {
  const box = root.value?.parentElement, el = root.value, current = shown.value
  if (!box || !el || !current) return
  const rect = box.getBoundingClientRect()
  const sheet = rect.width <= 640
  if (sheet) {
    const stack = props.bottom()?.getBoundingClientRect()
    pos.value = { x: 0, y: 0, sheet, lift: stack?.height ? Math.max(8, rect.bottom - stack.top + 8) : 96 }
  } else {
    const at = placeCard(current.at, { w: el.offsetWidth, h: el.offsetHeight }, { w: rect.width, h: rect.height }, 64)
    // On a wide screen the needs and goals column stands over the left of the scene: keep clear of it.
    pos.value = { x: rect.width > 900 ? Math.max(at.x, 296) : at.x, y: at.y, sheet, lift: 0 }
  }
}

type Reading = { spots?: TapScene['spots']; things?: TapScene['things']; people?: TapScene['people']; objects?: TapScene['objects']; view?: string; avatar?: { x: number; z: number; moving: boolean } }
const label = (id: string): string => view.value.activities.spots.find(spot => spot.id === id)?.label ?? id
const iconOf = (id: string): string => view.value.activities.spots.find(spot => spot.id === id)?.icon ?? ''
const quiet = (): boolean => game.mode.value !== 'venue' || Boolean(shell.sheet.value) || Boolean(state.value.activeAction) || !view.value.connected

function onDown(): void { clearTimeout(checkTimer); const at = scene.venue.value?.position(); if (at) before = { x: at.x, z: at.z } }
function onClick(event: MouseEvent): void {
  const canvas = event.target
  const host = root.value?.parentElement, venue = scene.venue.value
  if (!(canvas instanceof HTMLCanvasElement) || !host || !venue || event.detail === 0) return
  if (quiet()) { hide(); return }
  const reading = venue.diagnostics() as unknown as Reading
  if (reading.view === 'first') return
  const rect = host.getBoundingClientRect()
  const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  const hit = classifyTap(reading, at)
  clearTimeout(checkTimer)
  if (hit.kind === 'spot') { show({ kind: 'spot', id: hit.id, at: { x: hit.px, y: hit.py } }); return }
  if (hit.kind !== 'none') { hide(); return }
  // Bare ground the avatar walks to needs no words. A tap the avatar cannot reach (a wall, water, a prop in the way) leaves it standing short of the spot: that is scenery.
  watchWalk(event, at)
}
let polls = 0
function nearOf(spot: { id: string; label: string } | null): Near | null {
  if (!spot) return null
  const reading = scene.venue.value?.diagnostics() as unknown as Reading | undefined
  const seen = reading?.spots?.find((item) => item.id === spot.id) as unknown as { px?: number; py?: number; x?: number; z?: number } | undefined
  return { id: spot.id, label: label(spot.id) || spot.label, icon: iconOf(spot.id), px: seen?.px ?? 0, py: seen?.py ?? 0, x: seen?.x ?? 0, z: seen?.z ?? 0 }
}
function watchWalk(event: MouseEvent, at: { x: number; y: number }): void {
  // The host says, read only, what the tap landed on: a named prop is answered at once; bare floor is watched to see whether the avatar gets there.
  const what = scene.venue.value?.describeAt?.(event.clientX, event.clientY) ?? null
  if (what?.kind === 'prop') { show({ kind: 'scenery', at, near: nearOf(what.near), name: what.name }, 6000); return }
  const goal = what?.kind === 'floor' ? what.at : null
  const reach = 1.6
  polls = 0
  const check = (): void => {
    const venue = scene.venue.value
    if (!venue || quiet()) return
    const now = venue.diagnostics() as unknown as Reading
    if (!now.avatar) return
    if (now.avatar.moving && ++polls < 48) { checkTimer = window.setTimeout(check, 250); return }
    if (now.avatar.moving) return
    // Standing short of where the tap pointed (or, with no floor point, not having moved at all).
    const short = goal ? Math.hypot(now.avatar.x - goal.x, now.avatar.z - goal.z) > reach : !wentSomewhere(before, now.avatar)
    if (!short || (now as { avatar: { near?: string | null } }).avatar.near) return
    const spot = nearestSpot(now.spots, at)
    const near = spot ? { id: spot.id, label: label(spot.id), icon: iconOf(spot.id), px: spot.px, py: spot.py, x: (spot as unknown as { x: number }).x, z: (spot as unknown as { z: number }).z } : null
    show({ kind: 'scenery', at, near }, 6000)
  }
  clearTimeout(checkTimer)
  checkTimer = window.setTimeout(check, 250)
}
function onKey(event: KeyboardEvent): void { if (event.key === 'Escape' && shown.value) hide(); clearTimeout(checkTimer) }

async function start(card: ActivityCard): Promise<void> {
  if (pending.value) return
  if (card.choices) { shell.ui.expanded = true; hide(); return }
  pending.value = card.id
  hide(); shell.ui.expanded = false
  try { await command('activity', { id: card.id }) } finally { pending.value = null }
}
function more(): void { shell.ui.expanded = true; hide() }
function goNear(): void {
  const near = closeBy.value
  if (!near) return
  hide()
  scene.venue.value?.walkTo(near.x, near.z)
}

// One surface for a spot: the card lists what to do, so the activity rail folds away (it stays one tap off).
watch(arrived, now => { if (now) { shell.ui.expanded = false; void nextTick(place) } })
watch(() => actions.value.length, () => { void nextTick(place) })
watch(() => `${state.value.location}|${state.value.activeAction ? 1 : 0}|${game.mode.value}|${shell.sheet.value ? 1 : 0}`, hide)
let host: HTMLElement | null = null
onMounted(() => {
  host = root.value?.parentElement ?? null
  host?.addEventListener('pointerdown', onDown, { passive: true })
  host?.addEventListener('click', onClick)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  host?.removeEventListener('pointerdown', onDown); host?.removeEventListener('click', onClick)
  window.removeEventListener('keydown', onKey); window.removeEventListener('resize', place)
  hide()
})
</script>

<template>
  <div ref="root" class="tap-root">
    <aside v-if="shown" class="tap-card" :class="{ 'is-sheet': pos.sheet, 'is-scenery': shown.kind === 'scenery' }" role="status" aria-live="polite"
      :style="pos.sheet ? { bottom: `${pos.lift}px` } : { left: `${pos.x}px`, top: `${pos.y}px` }" :data-tap="shown.kind" :data-tap-id="shown.kind === 'spot' ? shown.id : undefined">
      <template v-if="shown.kind === 'spot'">
        <header class="tap-head">
          <span class="tap-icon" aria-hidden="true"><GameIcon inline kind="spot" :id="shown.id" :emoji="spotInfo?.icon" /></span>
          <span class="tap-title"><strong>{{ spotInfo?.label ?? shown.id }}</strong><small v-if="spotInfo?.caption">{{ spotInfo.caption }}</small></span>
          <button class="tap-close" type="button" aria-label="Close" @click="hide">×</button>
        </header>
        <p v-if="!arrived" class="tap-note">On your way{{ spotInfo?.count ? ` · ${spotInfo.count} ${spotInfo.count === 1 ? 'thing' : 'things'} to do here` : '' }}</p>
        <p v-else-if="state.activeAction" class="tap-note">Finish what you are doing first.</p>
        <p v-else-if="!actions.length" class="tap-note">Nothing to do here yet.</p>
        <ul v-else class="tap-actions">
          <li v-for="{ card, face } in actions.slice(0, MAX)" :key="card.id">
            <button type="button" :class="face.state === 'ready' ? undefined : `is-${face.state}`" :disabled="face.disabled || pending !== null" :aria-label="face.label" :aria-busy="pending === card.id" @click="start(card)">
              <span class="tap-act-name"><GameIcon inline kind="activity" :id="card.id" :emoji="card.icon" /> {{ card.label }}</span>
              <span class="tap-act-meta"><span>{{ card.careerTrack === 'teaching' ? 'Teach a learner' : `${card.duration}s` }}</span><strong :class="face.priceTone === 'free' ? undefined : `is-${face.priceTone}`">{{ face.price }}</strong></span>
              <span v-if="face.why" class="tap-act-why"><GameIcon inline name="lock" /> {{ face.why }}</span>
            </button>
          </li>
          <li v-if="actions.length > MAX"><button type="button" class="tap-more" @click="more">See all {{ actions.length }}</button></li>
        </ul>
      </template>
      <template v-else>
        <header class="tap-head">
          <span class="tap-title"><strong>{{ shown.name ?? 'Just scenery' }}</strong><small>{{ shown.name ? 'Just scenery: nothing to do with it.' : 'You cannot go there, and there is nothing to do with it.' }}</small></span>
          <button class="tap-close" type="button" aria-label="Close" @click="hide">×</button>
        </header>
        <p v-if="shown.near" class="tap-note">The nearest thing to do:</p>
        <button v-if="shown.near" type="button" class="tap-go" @click="goNear"><GameIcon inline kind="spot" :id="shown.near.id" :emoji="shown.near.icon" /> Go to {{ shown.near.label }}</button>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.tap-root { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
.tap-card { position: absolute; pointer-events: auto; width: min(300px, calc(100% - 16px)); box-sizing: border-box; padding: var(--s-3); border-radius: var(--r-lg); background: var(--c-surface); color: var(--c-ink); box-shadow: var(--e-3); display: grid; gap: var(--s-2); font: var(--t-body)/1.4 var(--font); animation: tap-in var(--m-fast) ease-out; }
.tap-card.is-sheet { left: var(--s-3); right: var(--s-3); width: auto; border-radius: var(--r-xl); max-height: 55%; overflow: auto; }
.tap-card.is-scenery { width: min(260px, calc(100% - 16px)); }
.tap-card.is-scenery.is-sheet { width: auto; }
.tap-head { display: flex; align-items: flex-start; gap: var(--s-2); }
.tap-icon { font-size: 22px; line-height: 1; padding-top: 2px; }
.tap-title { display: grid; flex: 1; min-width: 0; gap: 2px; }
.tap-title strong { font-size: var(--t-lead); line-height: 1.25; }
.tap-title small { color: var(--c-muted); font-size: var(--t-caption); line-height: 1.35; }
.tap-close { flex: none; width: var(--tap); height: var(--tap); margin: calc(var(--s-3) * -1) calc(var(--s-3) * -1) calc(var(--s-2) * -1) 0; border: 0; background: none; color: var(--c-muted); font-size: 24px; border-radius: var(--r-pill); cursor: pointer; }
.tap-note { margin: 0; color: var(--c-muted); font-size: var(--t-caption); }
.tap-actions { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.tap-actions button, .tap-go { width: 100%; min-height: var(--tap); box-sizing: border-box; display: grid; gap: 2px; text-align: left; padding: var(--s-2) var(--s-3); border: 1px solid var(--c-line); border-radius: var(--r-md); background: var(--c-green-soft); color: var(--c-ink); font: inherit; cursor: pointer; }
.tap-actions button:hover:not(:disabled), .tap-go:hover { border-color: var(--c-green); }
.tap-actions button:focus-visible, .tap-go:focus-visible, .tap-close:focus-visible { outline: 2px solid var(--c-blue); outline-offset: 2px; }
.tap-actions button:disabled { background: var(--c-fill); color: var(--c-muted); cursor: default; }
.tap-go { background: var(--c-green-dark); border-color: var(--c-green-dark); color: #fff; font-weight: 600; text-align: center; align-items: center; }
.tap-more { background: var(--c-surface) !important; text-align: center !important; color: var(--c-ink-2) !important; font-weight: 600; }
.tap-act-name { font-weight: 600; }
.tap-act-meta { display: flex; justify-content: space-between; gap: var(--s-2); font-size: var(--t-caption); color: var(--c-muted); }
.tap-act-meta strong { color: var(--c-ink-2); }
.tap-act-meta strong.is-earn { color: var(--c-green-dark); }
.tap-act-meta strong.is-cost { color: var(--c-amber-dark); }
.tap-act-why { font-size: var(--t-caption); color: var(--c-red-dark); }
@keyframes tap-in { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .tap-card { animation: none; } }
</style>
