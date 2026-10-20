<script setup lang="ts">
// ArenaStage: the immersive frame every live game uses. It is teleported to <body> and fills the whole viewport above the phone
// shell (no fake status bar, Games header or Close pill), with a slim top bar: Leave, the game's title and chip, a slot for the
// score or clock, a sound toggle and a Full screen button. Safe-area insets keep it clear of notches and rounded corners.
//
// FULL SCREEN. The button asks for the Fullscreen API and then locks the orientation to landscape; both are feature-detected
// and the button is hidden where there is no Fullscreen API (iPhone Safari). Where the orientation cannot be locked, a hint
// says to rotate the phone. Leaving the screen exits full screen.
//
//   <ArenaStage title="Fight" :chip="chipText" :off="conn !== 'open'" @leave="room.leave">
//     <template #bar>…score or clock…</template>   (optional, shown in the middle of the top bar)
//     …the screen: canvas, controls, <ArenaRoomPanels />…     (a column that scrolls when it is taller than the screen)
//   </ArenaStage>
//
// Inside, a `.arena-fill` element grows to the free height (use it for the canvas holder).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getSound, setSound } from '../../../audio/settings.ts'
import type { ScreenPad } from '../../../arena/input/usePad.ts'
import { lazyComponent } from '../../state/lazy.ts'

const ArenaPadPanel = lazyComponent(() => import('./ArenaPadPanel.vue'))
const props = defineProps<{ title: string; chip?: string; off?: boolean; /** The game is on and the player is in it: the arena fills the whole screen and the bar fades. */ play?: boolean; /** The screen's controller (usePad): the Controller button and panel. */ pad?: ScreenPad }>()
const emit = defineEmits<{ leave: [] }>()

const canFull = typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function'
const dialog = ref<HTMLDialogElement | null>(null)
const padTrigger = ref<HTMLButtonElement | null>(null)
const padPanel = ref<{ escape: () => void } | null>(null)
function closePad(): void { if (props.pad) props.pad.panel.value = false }
function padEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !props.pad?.panel.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (padPanel.value) padPanel.value.escape()
  else closePad()
}
watch(() => props.pad?.panel.value, (open, wasOpen) => {
  if (!open && wasOpen) void nextTick(() => padTrigger.value?.focus())
})
const full = ref(false)
const portrait = ref(false)
const lockFailed = ref(false)
const soundOn = ref(true)
const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

const hint = computed(() => touch && portrait.value && (lockFailed.value || !canFull))
function sync(): void { full.value = !!document.fullscreenElement; portrait.value = window.innerHeight > window.innerWidth }
async function toggleFull(): Promise<void> {
  try {
    if (document.fullscreenElement) { await document.exitFullscreen(); return }
    await document.documentElement.requestFullscreen()
    const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined
    if (orientation?.lock) await orientation.lock('landscape').catch(() => { lockFailed.value = true })
    else lockFailed.value = true
  } catch { lockFailed.value = true }
  sync()
}
function toggleSound(): void { soundOn.value = !soundOn.value; setSound({ on: soundOn.value }) }
onMounted(() => {
  window.addEventListener('keydown', padEscape, true)
  soundOn.value = getSound().on
  // The Games app is itself a modal <dialog> in the browser's top layer, which no z-index can rise above, and it makes everything
  // outside it inert. A modal dialog opened later goes on top of it and takes over, so the stage is one.
  try { if (dialog.value && !dialog.value.open) dialog.value.showModal(); dialog.value?.focus() } catch { dialog.value?.setAttribute('open', '') }
  sync()
  window.addEventListener('resize', sync); document.addEventListener('fullscreenchange', sync)
  document.documentElement.classList.add('arena-open')
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', padEscape, true)
  window.removeEventListener('resize', sync); document.removeEventListener('fullscreenchange', sync)
  document.documentElement.classList.remove('arena-open')
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  try { (screen.orientation as ScreenOrientation | undefined)?.unlock?.() } catch { /* not locked */ }
})
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="as" :aria-label="title" data-testid="arena-stage" tabindex="-1" @cancel.prevent>
      <header class="as-bar" :class="{ dim: play }">
        <button type="button" class="as-btn" @click="emit('leave')">&lsaquo; Leave</button>
        <span v-if="chip" class="as-chip" :class="{ off }">{{ chip }}</span>
        <span class="as-mid"><slot name="bar" /></span>
        <button type="button" class="as-ico" :aria-label="soundOn ? 'Mute sound' : 'Turn sound on'" @click="toggleSound"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" /><template v-if="soundOn"><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></template><template v-else><path d="M16 9l5 6M21 9l-5 6" /></template></svg></button>
        <button v-if="props.pad?.supported" ref="padTrigger" type="button" class="as-ico" :class="{ on: !!props.pad.connected.value }" :aria-label="props.pad.connected.value ? `Controller: ${props.pad.connected.value}` : 'Controller'" data-testid="arena-pad" @click="props.pad.panel.value = !props.pad.panel.value"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 13H9l-1.6 1.8A3 3 0 0 1 2 13v-1a4 4 0 0 1 4-4z" /><path d="M7 11v2M6 12h2" /><circle cx="16" cy="11" r=".6" fill="currentColor" /><circle cx="18" cy="13" r=".6" fill="currentColor" /></svg></button>
        <button v-if="canFull" type="button" class="as-ico" :aria-label="full ? 'Exit full screen' : 'Full screen'" data-testid="arena-full" @click="toggleFull"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-if="!full" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><path v-else d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg></button>
      </header>
      <p v-if="hint" class="as-hint" role="status">Rotate your phone sideways for a bigger arena.</p>
      <div class="as-body" :class="{ 'is-play': play }"><slot /></div>
      <div v-if="props.pad?.panel.value" class="as-pad"><ArenaPadPanel ref="padPanel" :controls="props.pad.controls" @close="closePad" @changed="props.pad.reload()" /></div>
    </dialog>
  </Teleport>
</template>

<style>
html.arena-open, html.arena-open body { overflow: hidden; }
</style>
<style scoped>
/* Full-bleed: the arena is the screen. The bar is a row of small translucent buttons floating over its top corners. */
.as { position: fixed; inset: 0; z-index: 2147483647; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; display: none; background: #0b1020; color: #fff; overflow: hidden; user-select: none; -webkit-user-select: none; }
.as[open] { display: block; }
.as::backdrop { background: transparent; }
.as-bar { position: absolute; z-index: 6; left: env(safe-area-inset-left); right: env(safe-area-inset-right); top: env(safe-area-inset-top); height: 52px; display: flex; align-items: center; gap: 6px; padding: 4px 8px; pointer-events: none; transition: opacity .5s ease; }
.as-bar.dim { opacity: .4; }
.as-bar.dim:focus-within, .as-bar.dim:active { opacity: 1; transition-duration: .1s; }
.as-bar > * { pointer-events: auto; }
.as-btn, .as-ico, .as-chip { background: rgba(8, 12, 28, .55); color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); box-shadow: 0 0 0 1px rgba(255, 255, 255, .12); }
.as-btn, .as-ico { border: 0; font: inherit; height: 44px; min-width: 44px; padding: 0 12px; border-radius: 22px; cursor: pointer; }
.as-btn { font-size: 14px; font-weight: 650; }
.as-ico { display: grid; place-items: center; width: 44px; padding: 0; }
.as-chip { font-size: 12px; padding: 5px 10px; border-radius: 99px; font-weight: 650; white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.as-chip::first-letter { text-transform: uppercase; }
.as-chip.off { background: rgba(138, 75, 10, .8); }
.as-ico.on { box-shadow: 0 0 0 2px #7ee2a8; }
.as-pad { position: absolute; z-index: 7; inset: auto 8px calc(env(safe-area-inset-bottom) + 8px) 8px; max-height: calc(100% - 70px); overflow-y: auto; color: var(--c-ink, #1a1d24); max-width: 520px; margin: 0 auto; }
.as-mid { flex: 1 1 auto; min-width: 0; display: flex; justify-content: center; pointer-events: none; }
.as-mid > :deep(*) { pointer-events: auto; background: rgba(8, 12, 28, .55); border-radius: 16px; padding: 2px 12px; }
.as-mid :deep(*) { color: #fff !important; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
/* A phone: Leave, the status chip, the score and three round buttons share one row, so the chip gives way first and the gaps close up. */
@media (max-width: 430px) {
  .as-bar { gap: 4px; padding: 4px 6px; }
  .as-btn { padding: 0 10px; }
  .as-chip { flex: 0 1 auto; font-size: 11px; padding: 4px 8px; }
  .as-mid > :deep(*) { padding: 2px 6px; }
}
.as-hint { position: absolute; z-index: 5; left: 12px; right: 12px; bottom: calc(env(safe-area-inset-bottom) + 8px); margin: 0; padding: 6px 10px; font-size: 12px; text-align: center; background: rgba(255, 240, 209, .92); color: #8a4b0a; border-radius: 10px; pointer-events: none; }
.as-body { position: absolute; inset: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 0 0 12px; color: var(--c-ink, #1a1d24); background: #f6f7f9; -webkit-overflow-scrolling: touch; }
.as-body.is-play { overflow: hidden; padding: 0; background: #0b1020; }
/* Not playing (lobby, result): the arena is the top part and the cards sit below, scrolling. */
.as-body :deep(.arena-fill) { flex: none; height: min(46vh, 100vw); min-height: 0; }
.as-body > :deep(*) { box-sizing: border-box; }
/* A wide window: the lobby and the result are one centred column, not a strip across the screen with the cards lost under it; the bar's buttons stay with it. */
@media (min-width: 900px) { .as-body:not(.is-play) > :deep(*) { width: 100%; max-width: 1200px; align-self: center; } .as-bar { max-width: 1700px; margin-inline: auto; } }
.as-body :deep(.rp), .as-body :deep([class$="-card"]) { margin: 0 10px; }
/* Playing: the arena's holder (a game's `*-stage`) takes all of it, whatever height cap the game's own styles put on it in the lobby. */
.as-body.is-play :deep(.arena-fill > [class$="-stage"]) { flex: 1 1 auto; height: 100%; max-height: none !important; min-height: 0 !important; border-radius: 0; }
/* Playing: the arena fills the screen, and the controls float over its bottom. */
.as-body.is-play :deep(.arena-fill) { position: absolute; inset: 0; height: auto; }
.as-body.is-play :deep(.arena-fill > [data-testid$="-pad"]) { position: absolute; left: env(safe-area-inset-left); right: env(safe-area-inset-right); bottom: env(safe-area-inset-bottom); pointer-events: none; }
.as-body.is-play :deep(.arena-fill > [data-testid$="-pad"] button), .as-body.is-play :deep(.arena-fill > [data-testid$="-pad"] [data-testid$="joy"]) { pointer-events: auto; opacity: .78; }
</style>
