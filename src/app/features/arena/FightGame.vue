<script setup lang="ts">
// Fight: a 1v1 brawler played live against a friend (a private room, joined by a link), against the computer, or watched.
// The server judges everything (src/arena/fight.ts, server/growth/arena.ts); this screen sends what the player is pressing, and
// draws the snapshots it gets back on a 2D canvas, smoothed between ticks (src/arena/interp.ts). It is a lazy chunk of the Games app.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import BaseButton from '../../ui/BaseButton.vue'
import { APPEARANCE } from '../../../game/content/traits.ts'
import { InputPipe } from '../../../arena/client.ts'
import { FightPredictor } from '../../../arena/fight-predict.ts'
import { createFightSound } from '../../../arena/fight-sound.ts'
import { useArenaRoom, aiName } from '../../../arena/room.ts'
import type { ArenaScreenProps } from '../../../arena/catalog.ts'
import ArenaRoomPanels from './ArenaRoomPanels.vue'
import ArenaStage from './ArenaStage.vue'
import { BTN, PHASE, packInput } from '../../../arena/fight.ts'
import type { FighterSnap, FightSnap } from '../../../arena/fight.ts'
import { drawFight, drawFightHud, newFx, spawnHits } from '../../../arena/fight-draw.ts'
import type { FightView, Insets } from '../../../arena/fight-3d.ts'
import type { FighterColors } from '../../../arena/fight-draw.ts'
import { Timeline } from '../../../arena/interp.ts'
import type { ArenaLook, ArenaNative } from '../../../types/arena.ts'
import { FIGHT_PAD } from '../../../arena/input/pad.ts'
import { axisDir, usePad } from '../../../arena/input/usePad.ts'

const props = defineProps<ArenaScreenProps>()
const emit = defineEmits<{ close: [] }>()
const { game } = useApp()

const canvas = ref<HTMLCanvasElement | null>(null)
// The 3D view (src/arena/fight-3d.ts, its own lazy chunk with three.js) draws under the 2D canvas, which then draws only the HUD.
// Until it is ready, and wherever WebGL or the models are missing, the 2D view draws everything.
const gl = ref<HTMLCanvasElement | null>(null)
let view3d: FightView | null = null
const has3d = ref(false)
const box = ref<HTMLElement | null>(null)
const padEl = ref<HTMLElement | null>(null), leftEl = ref<HTMLElement | null>(null), rightEl = ref<HTMLElement | null>(null)

const ownLook = (): ArenaLook | undefined => {
  const look = game.state.value.onboarding?.look as { skin?: string; hairColor?: string; outfitColor?: string; bottomsColor?: string } | undefined
  return look?.skin && look.hairColor && look.outfitColor && look.bottomsColor ? [look.skin, look.hairColor, look.outfitColor, look.bottomsColor] : undefined
}
/** The player's own native character, public part, as the world dresses it. The modules that make it are reached by a dynamic import (startup shares them), so the room opens once it is known. */
let ownNat: ArenaNative | undefined
const ownNative = (): ArenaNative | undefined => ownNat
const hex = (group: 'skin' | 'hairColours' | 'outfitColours', id: string | undefined, fallback: string): string => APPEARANCE[group].find((swatch) => swatch.id === id)?.hex ?? fallback
function colors(seat: number): FighterColors {
  const look = room.state.value?.seats[seat]?.look
  const base: FighterColors = seat ? { skin: '#a8714b', hair: '#1c1c1c', top: '#2f80ed', bottoms: '#27314f' } : { skin: '#8a5a3c', hair: '#1c1c1c', top: '#e8553d', bottoms: '#3b2a2a' }
  if (!look) return base
  return { skin: hex('skin', look[0], base.skin), hair: hex('hairColours', look[1], base.hair), top: hex('outfitColours', look[2], base.top), bottoms: hex('outfitColours', look[3], base.bottoms) }
}
const dist = (a: string, b: string): number => { const n = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0); const x = n(a), y = n(b); return Math.hypot((x[0] ?? 0) - (y[0] ?? 0), (x[1] ?? 0) - (y[1] ?? 0), (x[2] ?? 0) - (y[2] ?? 0)) }

const ownRaw = game.state.value.onboarding?.look as unknown as Record<string, unknown> | undefined
const natReady = import('../../../arena/native-own.ts').then(async (m) => { ownNat = await m.packOwnLook(ownRaw) }).catch(() => undefined)
const pendingHits: { k: number; snap: FightSnap }[] = []
const fx = newFx()
const room = useArenaRoom<FightSnap>({
  game: 'fight', intent: props.intent, hz: 20, look: ownLook, nat: ownNative, ready: natReady, toast: (text, kind) => game.toast(text, kind), close: () => emit('close'),
  onMatch: () => { pendingHits.length = 0; predictor.reset(); fx.ko = 0 },
  onSnap: (k, snap, acks) => {
    if (snap.e.length) pendingHits.push({ k, snap })
    const you = room.state.value?.you
    if (acks && you != null && acks[you]) predictor.acked(acks[you] as number, performance.now())
  },
})
const predictor = new FightPredictor()
const sound = createFightSound()
room.mount()
const state = room.state, note = room.note, conn = room.conn, gone = room.gone, timeline = room.timeline

// ---- input --------------------------------------------------------------------------------------------
let heldBits = 0
let counter = 0
const pipe = new InputPipe({ now: () => performance.now(), send: (held, pressed) => { counter += 1; predictor.sent(counter, performance.now()); room.sendInput(packInput(held, pressed), counter) } })
const seated = room.seated
const down = ref(0)
function hold(bit: number, on: boolean): void { heldBits = on ? heldBits | bit : heldBits & ~bit; down.value = heldBits; pipe.hold(heldBits & (BTN.left | BTN.right | BTN.block)); predictor.hold(heldBits & (BTN.left | BTN.right | BTN.block)); sound.unlock() }
function holdKey(event: KeyboardEvent, bit: number, on: boolean): void {
  if (event.key !== ' ' && event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
  hold(bit, on)
}
function tap(bit: number): void {
  sound.unlock()
  if (!seated.value || state.value?.status !== 'playing' || !playing()) return
  const you = state.value?.you ?? 0, own = room.latest?.f[you] ?? null
  predictor.press(bit, performance.now(), own); pipe.press(bit)
  if (bit === BTN.jump) sound.jump(); else sound.swing()
}
/** The fight itself is on (not the intro count or the pause after a knock-out): presses count. */
const playing = (): boolean => room.latest?.p === PHASE.fight
const KEYS: Record<string, { hold?: number; tap?: number }> = {
  ArrowLeft: { hold: BTN.left }, a: { hold: BTN.left }, ArrowRight: { hold: BTN.right }, d: { hold: BTN.right },
  ArrowUp: { tap: BTN.jump }, w: { tap: BTN.jump }, ' ': { tap: BTN.jump },
  j: { tap: BTN.punch }, z: { tap: BTN.punch }, k: { tap: BTN.kick }, x: { tap: BTN.kick },
  ArrowDown: { hold: BTN.block }, s: { hold: BTN.block }, l: { hold: BTN.block }, Shift: { hold: BTN.block },
}
function key(event: KeyboardEvent, on: boolean): void {
  const target = event.target as HTMLElement | null
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
  if (event.key === ' ' && target?.closest('button')) return
  const map = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key]
  if (!map) return
  event.preventDefault()
  if (map.hold) hold(map.hold, on)
  if (map.tap && on && !event.repeat) tap(map.tap)
}
// A game controller sends exactly what the touch buttons send (src/arena/input/): the stick or d-pad holds left/right.
let stickDir: -1 | 0 | 1 = 0
const pad = usePad(FIGHT_PAD, {
  action(id, on) {
    if (id === 'block') hold(BTN.block, on)
    else if (on) tap(id === 'punch' ? BTN.punch : id === 'kick' ? BTN.kick : BTN.jump)
  },
  stick(x) {
    const dir = axisDir(x, stickDir)
    if (dir === stickDir) return
    if (stickDir) hold(stickDir < 0 ? BTN.left : BTN.right, false)
    if (dir) hold(dir < 0 ? BTN.left : BTN.right, true)
    stickDir = dir
  },
}, (text) => game.toast(text, 'good'))
const onDown = (e: KeyboardEvent): void => key(e, true)
const onUp = (e: KeyboardEvent): void => key(e, false)
const onHide = (): void => { if (document.hidden) { heldBits = 0; down.value = 0; pipe.reset(); pipe.flush() } }

// ---- drawing ---------------------------------------------------------------------------------------------
let watcher: ResizeObserver | null = null
let raf = 0, lastFrame = 0, width = 0, height = 0
const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const PREVIEW: FightSnap = { p: PHASE.fight, c: 0, r: 1, w: [0, 0], t: 60, q: -1, f: [[390, 0, 1, 0, 0, 100, 0], [610, 0, 0, 0, 0, 100, 0]], e: [] }
let seenPhase = -1
function size(): void {
  const el = canvas.value, holder = box.value
  if (!el || !holder) return
  // The holder fills the free height (ArenaStage); the arena takes all of it in landscape and a tall-enough slice in portrait.
  width = Math.max(200, holder.clientWidth)
  height = Math.max(120, holder.clientHeight)
  // The HUD canvas only draws bars and text over the 3D view: a lower ratio there saves a cheap phone a big canvas to composite.
  const ratio = Math.min(window.devicePixelRatio || 1, view3d ? 1.5 : 1.75)
  el.width = Math.round(width * ratio); el.height = Math.round(height * ratio)
  el.style.width = width + 'px'; el.style.height = height + 'px'
  el.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)
  if (gl.value) { gl.value.style.width = width + 'px'; gl.value.style.height = height + 'px' }
  view3d?.resize(width, height, insets())
}
/**
 * What covers the arena, for the 3D camera: the HUD bars on top; in portrait the thumb pad along the bottom, in landscape the two
 * thumb clusters over the bottom corners (the fighters are fitted between them, where nothing is).
 */
function insets(): Insets {
  const holder = box.value
  const top = Math.round(Math.min(108, height * 0.32))
  if (!holder) return { top, bottom: 0, left: 0, right: 0 }
  const at = holder.getBoundingClientRect(), pad = padEl.value?.getBoundingClientRect()
  if (!pad || !pad.height) return { top, bottom: 10, left: 0, right: 0 }
  if (window.innerHeight > window.innerWidth) return { top, bottom: Math.max(10, Math.round(at.bottom - pad.top) + 8), left: 0, right: 0 }
  const left = leftEl.value?.getBoundingClientRect(), right = rightEl.value?.getBoundingClientRect()
  return { top, bottom: 10, left: left ? Math.max(0, Math.round(left.right - at.left) + 10) : 0, right: right ? Math.max(0, Math.round(at.right - right.left) + 10) : 0 }
}
/** A turn of the phone: the layout settles a moment after the event on some browsers, so measure now and again after it. */
function turned(): void { size(); setTimeout(size, 250) }
/** Who is in the ring, for the 3D view: one list per roster change (the view compares it by identity). */
let looksOf: unknown = null, looks: { name: string; nat?: ArenaNative | undefined; mine: boolean }[] = []
function seatLooks(): typeof looks {
  const st = room.state.value
  if (st !== looksOf) { looksOf = st; looks = st ? st.seats.map((seat, i) => ({ name: seat.name, nat: seat.nat, mine: i === st.you })) : [] }
  return looks
}
async function start3d(): Promise<void> {
  if (!gl.value) return
  try {
    const { createFightView } = await import('../../../arena/fight-3d.ts')
    const made = await createFightView(gl.value, { reduced, seats: seatLooks })
    if (!made) return
    if (!gl.value) { made.dispose(); return }
    view3d = made; has3d.value = made.ready(); size()
    // For measurement on a throttled phone profile (STATUS.md): frame times, draw calls and triangles.
    ;(globalThis as { allworldFightStats?: () => unknown }).allworldFightStats = () => made.stats()
  } catch { /* the 2D view goes on */ }
}
/** The ground line: in portrait while playing the thumbs float over the bottom of the screen, so the fighters stand above them. */
function groundPx(): number | undefined {
  const portrait = window.innerHeight > window.innerWidth
  return portrait && room.status.value === 'playing' && seated.value ? Math.max(height * 0.5, height - 224) : undefined
}
function frame(now: number): void {
  raf = requestAnimationFrame(frame)
  pipe.flush()
  const el = canvas.value, st = state.value
  if (!el || document.hidden) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  const dt = lastFrame ? Math.min(4, (now - lastFrame) / 16.7) : 1
  lastFrame = now
  const pick = st ? timeline.pick(now) : null
  const live = pick?.a ?? room.latest
  const a = live ?? PREVIEW, b = pick?.b ?? live ?? PREVIEW
  while (pendingHits.length && pick && (pendingHits[0] as { k: number }).k <= pick.tick) {
    const hit = pendingHits.shift() as { snap: FightSnap }
    spawnHits(fx, hit.snap, reduced)
    view3d?.hits(hit.snap.e)
    for (const e of hit.snap.e) { sound.hit(e[2] === 1, e[1] === 1); if (seated.value) pad.rumble(e[2] === 1 ? 0.25 : 0.6, e[2] === 1 ? 60 : 140) }
  }
  if (b.p !== seenPhase) {
    if (b.p === PHASE.ko) { sound.ko(); if (seated.value) pad.rumble(1, 320) }
    if (b.p === PHASE.intro || (b.p === PHASE.fight && seenPhase === PHASE.intro)) sound.bell()
    seenPhase = b.p
  }
  const c0 = colors(0); let c1 = colors(1)
  if (dist(c0.top, c1.top) < 70) c1 = { ...c1, top: '#2f80ed' }
  const you = st?.you ?? null
  // Your own fighter is drawn from what you pressed (see src/arena/fight-predict.ts), the other from the delayed snapshots.
  const latest = room.latest
  let own: FighterSnap | null = null
  if (live && latest && you != null && latest.p === PHASE.fight && st?.status === 'playing') {
    const mine: 0 | 1 = you === 1 ? 1 : 0, other: 0 | 1 = mine === 1 ? 0 : 1 // a fight has exactly two seats
    const foe = pick ? (pick.a.f[other][0] + (pick.b.f[other][0] - pick.a.f[other][0]) * pick.t) : latest.f[other][0]
    own = predictor.frame(now, latest.f[mine], foe)
  }
  const result = st?.result
  const winner = st?.status === 'over' && result ? (result.draw ? 2 : (result.winners[0] ?? -1)) : -1
  const names: [string, string] = [aiName(st?.seats[0]) ?? 'You', aiName(st?.seats[1]) ?? 'Waiting…']
  if (view3d) {
    if (!has3d.value && view3d.ready()) { has3d.value = true; size() }
    view3d.draw(a, b, pick?.t ?? 0, { own, you, winner, now })
    // Until both fighters are in the ring the 2D view draws everything.
    if (has3d.value) {
      ctx.clearRect(0, 0, width, height)
      drawFightHud(ctx, width, height, b, { names, rounds: Number(st?.options.rounds ?? 3), winner, hudTop: 52 })
      return
    }
  }
  drawFight(ctx, width, height, a, b, pick?.t ?? 0, {
    names, colors: [c0, c1], you, rounds: Number(st?.options.rounds ?? 3), reduced, time: now, winner, own,
    hudTop: 52, ground: groundPx(),
  }, fx, dt)
}

function leave(): void { room.leave() }
const status = room.status
// The pad appears when the match starts and goes when it ends: the camera frames the fighters in what is left over.
watch([status, seated], () => { void nextTick(size) })

onMounted(() => {
  size()
  window.addEventListener('resize', size); window.addEventListener('orientationchange', turned)
  if (typeof ResizeObserver === 'function' && box.value) { watcher = new ResizeObserver(size); watcher.observe(box.value) }
  window.addEventListener('keydown', onDown); window.addEventListener('keyup', onUp)
  document.addEventListener('visibilitychange', onHide)
  raf = requestAnimationFrame(frame)
  void start3d()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  view3d?.dispose(); view3d = null
  window.removeEventListener('resize', size); window.removeEventListener('orientationchange', turned); watcher?.disconnect()
  window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp)
  document.removeEventListener('visibilitychange', onHide)
  sound.close()
})
</script>

<template>
  <ArenaStage title="Fight" :pad="pad" :play="status === 'playing'" :chip="conn === 'open' ? (state?.practice ? 'Practice' : status === 'playing' ? (seated ? 'Live' : 'Watching') : status) : 'Connecting…'" :off="conn !== 'open'" @leave="leave">
    <div class="fg" data-testid="fight">
    <div v-if="gone" class="fg-card"><p>{{ note || 'That game is not on any more.' }}</p><BaseButton variant="primary" @click="leave">Back to games</BaseButton></div>
    <template v-else>
      <div class="fg-play arena-fill">
        <div ref="box" class="fg-stage"><canvas ref="gl" class="fg-gl" :class="{ on: has3d }" aria-hidden="true" /><canvas ref="canvas" class="fg-hud" aria-label="Fight arena" role="img" /></div>
        <p v-if="note" class="fg-note" role="status">{{ note }}</p>
        <section v-if="status === 'playing' && seated" ref="padEl" class="fg-pad" aria-label="Controls" data-testid="fight-pad">
          <div ref="leftEl" class="fg-left">
            <button type="button" class="fg-btn mv" aria-label="Move left" :class="{ on: down & BTN.left }" @pointerdown.prevent="hold(BTN.left, true)" @pointerup.prevent="hold(BTN.left, false)" @pointercancel="hold(BTN.left, false)" @pointerleave="hold(BTN.left, false)" @keydown="holdKey($event, BTN.left, true)" @keyup="holdKey($event, BTN.left, false)" @blur="hold(BTN.left, false)">&#9664;</button>
            <button type="button" class="fg-btn mv" aria-label="Move right" :class="{ on: down & BTN.right }" @pointerdown.prevent="hold(BTN.right, true)" @pointerup.prevent="hold(BTN.right, false)" @pointercancel="hold(BTN.right, false)" @pointerleave="hold(BTN.right, false)" @keydown="holdKey($event, BTN.right, true)" @keyup="holdKey($event, BTN.right, false)" @blur="hold(BTN.right, false)">&#9654;</button>
          </div>
          <div ref="rightEl" class="fg-right">
            <button type="button" class="fg-btn act punch" aria-label="Punch" @pointerdown.prevent="tap(BTN.punch)" @click="$event.detail === 0 && tap(BTN.punch)">Punch</button>
            <button type="button" class="fg-btn act kick" aria-label="Kick" @pointerdown.prevent="tap(BTN.kick)" @click="$event.detail === 0 && tap(BTN.kick)">Kick</button>
            <button type="button" class="fg-btn act block" aria-label="Block" :class="{ on: down & BTN.block }" @pointerdown.prevent="hold(BTN.block, true)" @pointerup.prevent="hold(BTN.block, false)" @pointercancel="hold(BTN.block, false)" @pointerleave="hold(BTN.block, false)" @keydown="holdKey($event, BTN.block, true)" @keyup="holdKey($event, BTN.block, false)" @blur="hold(BTN.block, false)">Block</button>
            <button type="button" class="fg-btn act jump" aria-label="Jump" @pointerdown.prevent="tap(BTN.jump)" @click="$event.detail === 0 && tap(BTN.jump)">Jump</button>
          </div>
          <p class="fg-small keys">Keys: A D move · W jump · J punch · K kick · S block</p>
        </section>
      </div>
      <ArenaRoomPanels v-if="status !== 'playing' || !seated" :room="room" />
    </template>
    </div>
  </ArenaStage>
</template>

<style scoped>
.fg { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.fg-play { position: relative; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 6px; }
.fg-stage { position: relative; flex: 1 1 auto; min-height: 150px; background: #1b2559; border-radius: 12px; overflow: hidden; }
.fg-stage canvas { position: absolute; left: 0; top: 0; display: block; touch-action: none; }
.fg-gl { visibility: hidden; } .fg-gl.on { visibility: visible; }

.fg-card { display: grid; gap: 10px; padding: 14px; background: #f3efe8; border-radius: 14px; }
.fg-card p { margin: 0; font-size: 14px; line-height: 1.45; }
.fg-small { font-size: 12px; color: var(--c-muted); } .fg-note { margin: 0; color: #a33; font-size: 13px; }
.fg-pad { position: relative; flex: none; height: 184px; touch-action: none; }
.fg-left { position: absolute; left: 2px; bottom: 6px; display: flex; gap: 10px; }
.fg-right { position: absolute; right: 2px; bottom: 6px; width: 172px; height: 176px; }
.fg-btn { border: 2px solid #2b2233; background: #fff; font: 800 15px system-ui; color: #2b2233; touch-action: none; -webkit-tap-highlight-color: transparent; cursor: pointer; user-select: none; box-shadow: 0 3px 0 rgba(0,0,0,.25); }
.fg-btn.on, .fg-btn:active { background: #ffd34d; transform: translateY(2px); box-shadow: none; }
.fg-btn.mv { width: 72px; height: 80px; border-radius: 22px; font-size: 26px; }
.fg-btn.act { position: absolute; border-radius: 50%; }
.fg-btn.punch { right: 0; bottom: 0; width: 88px; height: 88px; background: #ffd2c9; font-size: 17px; }
.fg-btn.kick { right: 94px; bottom: 4px; width: 72px; height: 72px; background: #cfe3ff; }
.fg-btn.block { right: 4px; bottom: 96px; width: 68px; height: 68px; background: #d8f0dc; }
.fg-btn.jump { right: 80px; bottom: 82px; width: 64px; height: 64px; background: #fff3c4; }
.keys { display: none; position: absolute; bottom: -2px; left: 0; right: 0; text-align: center; }
@media (hover: hover) { .keys { display: block; } .fg-pad { height: 206px; } }
/* Landscape: the arena takes the whole screen and the thumbs sit on top of its lower corners. */
@media (orientation: landscape) {
  .fg-pad { position: absolute; left: 0; right: 0; bottom: 0; max-width: 1400px; margin-inline: auto; height: 176px; pointer-events: none; }
  .fg-pad .fg-btn { pointer-events: auto; opacity: .7; } .keys { display: none; }
}
@media (orientation: landscape) and (max-height: 500px) { .fg-pad { height: 150px; } .fg-btn.mv { width: 64px; height: 64px; } .fg-btn.punch { width: 76px; height: 76px; } .fg-btn.kick { right: 82px; width: 62px; height: 62px; } .fg-btn.block { bottom: 78px; width: 58px; height: 58px; } .fg-btn.jump { right: 70px; bottom: 68px; width: 56px; height: 56px; } .fg-right { height: 146px; width: 150px; } }
</style>
