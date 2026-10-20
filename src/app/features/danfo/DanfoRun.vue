<script setup lang="ts">
// A danfo run, full screen over the game (docs/DANFO.md). The road is played here at a fixed 50 ms step (src/danfo/drive.ts) and drawn in
// the 3D road view or the 2D lanes; every stop served or passed is told to the server, which times it, and the end of the line is settled
// there. The game's conductor calls the stops; a player conductor's calls arrive by polling the run. At the end: the card, a clip, again.
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'
import '../../../ui/controls.css'
import { useApp } from '../../state/app.ts'
import { money } from '../../ui/format.ts'
import { routeById, VEHICLE_WORDS } from '../../../danfo/routes.ts'
import { manifest, progress } from '../../../danfo/run.ts'
import type { StopCall } from '../../../danfo/run.ts'
import { STEP_MS, startDrive, stepDrive } from '../../../danfo/drive.ts'
import type { DriveEvent } from '../../../danfo/drive.ts'
import { glossFor } from '../../../danfo/conductor.ts'
import type { DanfoResult, DanfoRunView } from '../../../types/danfo.ts'
import { danfoApi } from './danfoApi.ts'
import { drawLanes } from './laneView.ts'
import type { LaneLook } from './laneView.ts'
import type { RoadView3D } from './roadView3d.ts'
import { KEEP_LEFT, KEYS, NO_KEYS, PAINT, VIEW_KEY, cardWords, chooseView, conductorSays, controlsFrom, keepFrame, parkCall, thisDeviceTier, voidWords } from './runModel.ts'
import type { Held, RoadSnapshot, RoadView } from './runModel.ts'
import { track } from '../world/worldModel.ts'

const props = defineProps<{ run: DanfoRunView; view3d: boolean }>()
const emit = defineEmits<{ close: []; again: [routeId: string] }>()
const { game, shell } = useApp()
const api = danfoApi(game.fetchJson)

const line = routeById(props.run.routeId)!
const city = line.city, keepLeft = KEEP_LEFT.has(city), paint = PAINT[line.vehicle], vehicle = VEHICLE_WORDS[line.vehicle]
const people = manifest(props.run.seed, line, props.run.traffic)
const state = startDrive(line, props.run.seed, props.run.traffic)
const waiting = people.waiting.map((list) => list.length)
const frames: RoadSnapshot[] = []
const look: LaneLook = { keepLeft, body: paint.body, stripe: paint.stripe, stopNames: line.stops.map((stop) => stop.name), waiting, braking: false }

const dialog = ref<HTMLDialogElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const phase = ref<'ready' | 'driving' | 'paused' | 'finishing' | 'done' | 'void' | 'error'>('ready')
const hud = reactive({ fares: 0, aboard: 0, next: line.stops[1]?.name ?? '', metres: Math.round(state.stops[1] ?? 0), seconds: 0, kmh: 0, stop: 1 })
const bubble = reactive({ text: parkCall(city, line, props.run.seed), by: 'Conductor · AI', gloss: [] as string[], at: Date.now() })
const flash = ref('')
const crew = shallowRef(props.run.crew)
const result = shallowRef<DanfoResult | null>(null)
const message = ref('')
const clipBusy = ref(false)
const tier = thisDeviceTier()
const view = ref<RoadView>('lanes')
const has3d = ref(false)
let three: RoadView3D | null = null
let ctx2d: CanvasRenderingContext2D | null = null
let frame = 0, last = 0, acc = 0, brakeSince = 0, slowFrames = 0, gone = false, conductorN = 1, lastShout = 0
let held: Held = { ...NO_KEYS }
let reports: Promise<boolean> = Promise.resolve(true)
let poll: ReturnType<typeof setInterval> | undefined

const meter = (): void => { const now = progress(line, people, state.calls); hud.fares = now.fares; hud.aboard = now.aboard }
meter()
const playerConductor = computed(() => crew.value.find((member) => member.role === 'conductor') ?? null)
const riders = computed(() => crew.value.filter((member) => member.role === 'passenger').length)

function say(text: string | null, by = 'Conductor · AI'): void {
  if (!text) return
  bubble.text = text; bubble.by = by; bubble.gloss = glossFor(city, text); bubble.at = Date.now()
}
// The city's news on the radio between stops (src/news/radio.ts, fetched at the first quiet stretch): when the conductor has said nothing for 20 s.
let radioAt = Date.now(), radioN = 0
function radio(): void {
  if (phase.value !== 'driving' || Date.now() - bubble.at < 20000 || Date.now() - radioAt < 25000) return
  radioAt = Date.now()
  void import('../../../news/radio.ts').then((module) => { if (!gone && phase.value === 'driving') say(module.radioLine(city, Date.now(), radioN++), 'Radio') }).catch(() => { /* no radio today */ })
}
function flashOf(text: string): void { flash.value = text; setTimeout(() => { if (flash.value === text) flash.value = '' }, 1400) }

/** Tells the server about a stop, in order. A lost connection is retried; a refusal ends the run. */
function report(stop: number, call: StopCall): void {
  reports = reports.then(async (fine) => {
    if (!fine) return false
    for (let attempt = 0; attempt < 6; attempt++) {
      const answer = await api.stop(props.run.id, stop, call)
      if (answer.ok) return true
      if (answer.code !== 'offline' && answer.code !== 'rate_limited') {
        phase.value = answer.code === 'too_fast' ? 'void' : 'error'
        message.value = answer.code === 'too_fast' ? voidWords('too_fast') : answer.reason
        stopLoop()
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
    }
    phase.value = 'error'; message.value = 'The connection was lost. This run could not be saved.'; stopLoop()
    return false
  })
}

function handle(event: DriveEvent): void {
  if (event.kind === 'served' || event.kind === 'passed') {
    waiting[event.stop] = 0
    report(event.stop, event.kind)
    meter()
    if (event.kind === 'passed') flashOf(`Passed ${line.stops[event.stop]?.name ?? 'a stop'}`)
  }
  if (event.kind === 'hard-brake') flashOf(`Hard brake −${money(50)}`)
  if (event.kind === 'crash') flashOf(`Crash −${money(200)}`)
  if (event.kind === 'cut-in') flashOf('Okada!')
  // The player conductor, when there is one, does the calling; the game's conductor still reacts to the driving.
  if (playerConductor.value && (event.kind === 'approach' || event.kind === 'served')) return
  say(conductorSays(city, line, event, props.run.seed, conductorN++))
  if (event.kind === 'done') void finish()
}

async function finish(): Promise<void> {
  phase.value = 'finishing'
  if (!(await reports)) return
  const answer = await api.finish(props.run.id, game.newId(), state.hardBrakes, state.crashes)
  if (!answer.ok) { phase.value = answer.code === 'run_over' ? 'void' : 'error'; message.value = answer.reason; return }
  result.value = answer.run.result
  phase.value = 'done'
  track('danfo_run', { action: 'end', route: line.id, earned: answer.run.result?.earned ?? 0 })
  void game.refresh()
}

function tick(now: number): void {
  if (gone) return
  frame = requestAnimationFrame(tick)
  const gap = last ? Math.min(250, now - last) : STEP_MS
  last = now
  if (phase.value === 'driving') {
    acc += gap
    while (acc >= STEP_MS && phase.value === 'driving') {
      acc -= STEP_MS
      const input = controlsFrom(held, held.brake ? now - brakeSince : 0, !keepLeft)
      look.braking = input.brake > 0
      for (const event of stepDrive(state, input)) handle(event)
      keepFrame(frames, state)
    }
    hud.seconds = Math.floor(state.t / 1000); hud.kmh = Math.round(state.speed * 3.6); hud.stop = state.next
    hud.next = line.stops[Math.min(state.next, line.stops.length - 1)]?.name ?? ''
    hud.metres = Math.max(0, Math.round((state.stops[state.next] ?? state.end) - state.d))
    // A device that cannot keep up with the 3D road is moved to the lanes.
    if (view.value === '3d') { slowFrames = gap > 45 ? slowFrames + 1 : Math.max(0, slowFrames - 1); if (slowFrames > 90) { setView('lanes'); message.value = 'Switched to the lanes to keep the road smooth.' } }
  }
  render()
}
function render(): void {
  const el = canvas.value
  if (!el) return
  const steer = controlsFrom(held, 0, !keepLeft).steer
  if (view.value === '3d' && three) three.draw(state, look, steer)
  else if (ctx2d) drawLanes(ctx2d, el.width, el.height, state, look)
}
function resize(): void {
  const el = canvas.value
  if (!el) return
  const dpr = Math.min(globalThis.devicePixelRatio || 1, view.value === '3d' ? 1.5 : 2), w = el.clientWidth || innerWidth, h = el.clientHeight || innerHeight
  if (view.value === '3d' && three) three.resize(w, h)
  else { el.width = Math.round(w * dpr); el.height = Math.round(h * dpr) }
}
function stopLoop(): void { held = { ...NO_KEYS } }

/** Switching between the 3D road and the lanes needs a fresh canvas (a canvas keeps the first kind of context it gave). */
const canvasKey = ref(0)
async function setView(next: RoadView): Promise<void> {
  three?.dispose(); three = null; ctx2d = null
  view.value = next
  try { localStorage.setItem(VIEW_KEY, next) } catch { /* private mode: the choice lasts this run */ }
  canvasKey.value++
  await new Promise((resolve) => requestAnimationFrame(resolve))
  await mountView()
}
async function mountView(): Promise<void> {
  const el = canvas.value
  if (!el) return
  if (view.value === '3d') {
    try {
      const { createRoadView3D } = await import('./roadView3d.ts')
      if (gone || el !== canvas.value) return
      three = await createRoadView3D(el, { keepLeft, stops: state.stops, end: state.end, potholes: state.potholes.map((hole) => ({ ...hole })), body: paint.body, stripe: paint.stripe, sign: line.stops.at(-1)?.name ?? '' })
    } catch { view.value = 'lanes'; canvasKey.value++; await new Promise((resolve) => requestAnimationFrame(resolve)); return mountView() }
  } else ctx2d = canvas.value?.getContext('2d') ?? null
  resize(); render()
}

function go(): void { if (phase.value === 'ready' || phase.value === 'paused') { phase.value = 'driving'; last = 0 } }
function pause(): void { if (phase.value === 'driving') { phase.value = 'paused'; stopLoop() } }
async function leave(): Promise<void> {
  if (phase.value === 'driving' || phase.value === 'paused' || phase.value === 'ready') {
    if (!globalThis.confirm?.('Leave this run? Nothing is paid for a run you leave.')) return
    void api.abandon(props.run.id)
  }
  emit('close')
}

// Keys and touch.
function key(event: KeyboardEvent, down: boolean): void {
  const control = KEYS[event.key]
  if (!control) return
  event.preventDefault()
  if (control === 'brake' && down && !held.brake) brakeSince = performance.now()
  held = { ...held, [control]: down }
  if (down) go()
}
const onDown = (event: KeyboardEvent): void => key(event, true), onUp = (event: KeyboardEvent): void => key(event, false)
function press(control: keyof Held, down: boolean, event?: PointerEvent): void {
  if (event && down) (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
  if (control === 'brake' && down && !held.brake) brakeSince = performance.now()
  held = { ...held, [control]: down }
  if (down) go()
}
const hidden = (): void => { if (document.hidden) pause() }

async function pollRun(): Promise<void> {
  const answer = await api.run(props.run.id)
  if (!answer.ok || gone) return
  crew.value = answer.run.crew
  const latest = answer.run.shouts.at(-1)
  if (latest && latest.at > lastShout) { lastShout = latest.at; say(latest.line, `Conductor · ${latest.by}`) }
}

// The end: the card, a clip of the last seconds, again.
const card = computed(() => result.value ? cardWords(result.value, line, vehicle, money) : null)
const cardInput = () => ({ title: card.value!.title, sub: card.value!.sub, brag: card.value!.brag, earned: money(result.value!.earned), rows: card.value!.rows, city: game.view.value.city?.name ?? line.city })
async function clip(kind: 'clip' | 'card'): Promise<void> {
  if (!result.value || clipBusy.value) return
  clipBusy.value = true; message.value = kind === 'clip' ? 'Making your clip…' : ''
  try {
    const { cardPhoto, makeClip } = await import('./clip.ts')
    const { adoptCapture } = await import('../capture/captureSession.ts')
    const photo = await cardPhoto(frames.at(-1) ?? null, look, cardInput())
    let video: Blob | null = null, ms = 0
    if (kind === 'clip') { try { const made = await makeClip(frames, look, cardInput()); video = made.blob; ms = made.ms } catch { message.value = 'This browser cannot record a clip; your card is ready to share.' } }
    if (!adoptCapture({ photo, video, videoMs: ms })) { message.value = 'Capture is busy. Try again in a moment.'; return }
    track('danfo_clip', { what: video ? 'clip' : 'card' })
    emit('close')
    shell.open('capture')
  } catch { message.value = 'The card could not be made on this device.' } finally { clipBusy.value = false }
}

onMounted(async () => {
  dialog.value?.showModal?.()
  let stored: string | null = null
  try { stored = localStorage.getItem(VIEW_KEY) } catch { stored = null }
  const webgl = (() => { try { return Boolean(document.createElement('canvas').getContext('webgl2')) } catch { return false } })()
  has3d.value = webgl && props.view3d
  view.value = chooseView({ tier, webgl, setting: props.view3d, stored })
  await mountView()
  addEventListener('keydown', onDown); addEventListener('keyup', onUp); addEventListener('resize', resize)
  document.addEventListener('visibilitychange', hidden)
  poll = setInterval(() => { if (phase.value === 'driving' || phase.value === 'paused' || phase.value === 'ready') void pollRun(); radio() }, 4000)
  frame = requestAnimationFrame(tick)
  track('danfo_run', { action: 'start', route: line.id, earned: 0 })
})
onBeforeUnmount(() => {
  gone = true
  cancelAnimationFrame(frame)
  if (poll !== undefined) clearInterval(poll)
  removeEventListener('keydown', onDown); removeEventListener('keyup', onUp); removeEventListener('resize', resize)
  document.removeEventListener('visibilitychange', hidden)
  three?.dispose(); three = null
})
const progressPct = computed(() => Math.round(((hud.stop - 1) / Math.max(1, line.stops.length - 1)) * 100))
</script>

<template>
  <dialog ref="dialog" class="dr" :aria-label="`Driving the ${line.name} ${vehicle}`" @cancel.prevent="leave">
    <canvas :key="canvasKey" ref="canvas" class="dr-canvas" aria-hidden="true" />
    <header class="dr-top">
      <button type="button" class="dr-pill" @click="leave">{{ phase === 'done' ? 'Close' : 'Leave' }}</button>
      <div class="dr-route"><strong>{{ line.name }}</strong><span>{{ line.road }}</span></div>
      <button v-if="has3d && phase !== 'done'" type="button" class="dr-pill" :aria-label="view === '3d' ? 'Switch to the 2D lanes' : 'Switch to the 3D road'" @click="setView(view === '3d' ? 'lanes' : '3d')">{{ view === '3d' ? '2D' : '3D' }}</button>
      <button v-if="phase === 'driving'" type="button" class="dr-pill" @click="pause">Pause</button>
    </header>
    <div class="dr-hud" role="status" aria-live="off">
      <div class="dr-meter"><small>Fares</small><b data-danfo="fares">{{ money(hud.fares) }}</b></div>
      <div><small>Aboard</small><b>{{ hud.aboard }}/14</b></div>
      <div><small>Next</small><b>{{ hud.next }}</b><small>{{ hud.metres }} m</small></div>
      <div><small>Time</small><b>{{ Math.floor(hud.seconds / 60) }}:{{ String(hud.seconds % 60).padStart(2, '0') }}</b><small>{{ hud.kmh }} km/h</small></div>
    </div>
    <div class="dr-progress" aria-hidden="true"><span :style="{ width: `${progressPct}%` }" /></div>
    <p v-if="riders || playerConductor" class="dr-crew">{{ playerConductor ? `Conductor: ${playerConductor.name}` : '' }}{{ playerConductor && riders ? ' · ' : '' }}{{ riders ? `${riders} riding along` : '' }}</p>
    <div class="dr-bubble" aria-live="polite">
      <small>{{ bubble.by }}</small>
      <p>{{ bubble.text }}</p>
      <small v-for="item in bubble.gloss" :key="item" class="dr-gloss">{{ item }}</small>
    </div>
    <p v-if="flash" class="dr-flash" role="status">{{ flash }}</p>

    <div v-if="phase === 'driving' || phase === 'ready' || phase === 'paused'" class="dr-controls">
      <div class="dr-steer">
        <button type="button" class="dr-key" aria-label="Steer left" @pointerdown="press('left', true, $event)" @pointerup="press('left', false)" @pointercancel="press('left', false)" @contextmenu.prevent>◀</button>
        <button type="button" class="dr-key" aria-label="Steer right" @pointerdown="press('right', true, $event)" @pointerup="press('right', false)" @pointercancel="press('right', false)" @contextmenu.prevent>▶</button>
      </div>
      <div class="dr-pedals">
        <button type="button" class="dr-key is-brake" aria-label="Brake" @pointerdown="press('brake', true, $event)" @pointerup="press('brake', false)" @pointercancel="press('brake', false)" @contextmenu.prevent>Brake</button>
        <button type="button" class="dr-key is-gas" aria-label="Go" @pointerdown="press('gas', true, $event)" @pointerup="press('gas', false)" @pointercancel="press('gas', false)" @contextmenu.prevent>Go</button>
      </div>
    </div>

    <div v-if="phase === 'ready' || phase === 'paused'" class="dr-card dr-start">
      <h2>{{ phase === 'paused' ? 'Paused' : `${line.stops[0]?.name} to ${line.stops.at(-1)?.name}` }}</h2>
      <p v-if="phase === 'ready'">Stop in the kerb lane at every stop (the yellow bay) and stand still until people are on and off. Brake early: a hard brake or a crash costs you. Passing a stop with people for it costs you too.</p>
      <p class="dr-keys">Phone: ◀ ▶ to change lane, Go and Brake. Keyboard: arrows or WASD, space to brake.</p>
      <button type="button" class="ui-button is-primary is-block" @click="go">{{ phase === 'paused' ? 'Drive on' : 'Start driving' }}</button>
    </div>
    <div v-else-if="phase === 'finishing'" class="dr-card"><p>Counting the fares…</p></div>
    <div v-else-if="phase === 'void' || phase === 'error'" class="dr-card">
      <h2>{{ phase === 'void' ? 'This run does not count' : 'Something went wrong' }}</h2>
      <p>{{ message }}</p>
      <button type="button" class="ui-button is-block" @click="emit('close')">Back to the motor park</button>
    </div>
    <div v-else-if="phase === 'done' && result && card" class="dr-card dr-end" data-danfo="card">
      <h2>{{ card.title }}</h2>
      <p class="dr-sub">{{ card.sub }}</p>
      <p class="dr-earned">{{ money(result.earned) }}</p>
      <p v-if="card.brag" class="dr-brag">{{ card.brag }}</p>
      <dl>
        <template v-for="[label, value] in card.rows" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></template>
      </dl>
      <p v-if="result.capped" class="dr-note">{{ result.paid ? `Paid ${money(result.paid)}: you reached today's limit for danfo runs.` : 'Not paid: you reached today\'s limit for danfo runs. The run still counts on the board.' }}</p>
      <p class="dr-note">Game naira, paid into your wallet. Never real money.</p>
      <p v-if="message" class="dr-note" role="status">{{ message }}</p>
      <div class="dr-actions">
        <button type="button" class="ui-button is-primary" :disabled="clipBusy" data-danfo="clip" @click="clip('clip')">{{ clipBusy ? 'Making…' : 'Clip it' }}</button>
        <button type="button" class="ui-button" :disabled="clipBusy" @click="clip('card')">Share card</button>
        <button type="button" class="ui-button" @click="emit('again', line.id)">Drive again</button>
      </div>
    </div>
    <p v-else-if="message" class="dr-flash" role="status">{{ message }}</p>
  </dialog>
</template>

<style scoped>
.dr { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: #2b3036; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; font-family: var(--font); color: #fff; }
.dr::backdrop { background: #000; }
.dr-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.dr-top { position: absolute; top: max(8px, env(safe-area-inset-top)); left: 8px; right: 8px; display: flex; gap: 8px; align-items: center; }
.dr-route { flex: 1; min-width: 0; display: flex; flex-direction: column; text-shadow: 0 1px 3px rgba(0,0,0,.6); }
.dr-route strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dr-route span { font-size: 12px; opacity: .85; }
.dr-pill { border: 0; border-radius: 999px; padding: 8px 14px; background: rgba(12,16,20,.72); color: #fff; font: inherit; font-size: 14px; font-weight: 600; }
.dr-hud { position: absolute; top: calc(max(8px, env(safe-area-inset-top)) + 46px); left: 8px; right: 8px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.dr-hud > div { background: rgba(12,16,20,.7); border-radius: 12px; padding: 6px 8px; display: flex; flex-direction: column; min-width: 0; }
.dr-hud small { font-size: 11px; opacity: .8; }
.dr-hud b { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dr-meter b { color: #ffd84a; }
.dr-progress { position: absolute; top: calc(max(8px, env(safe-area-inset-top)) + 106px); left: 8px; right: 8px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.25); }
.dr-progress span { display: block; height: 100%; border-radius: 3px; background: #f4c20d; transition: width .4s; }
.dr-crew { position: absolute; top: calc(max(8px, env(safe-area-inset-top)) + 116px); left: 8px; margin: 0; padding: 4px 10px; border-radius: 999px; background: rgba(46,125,50,.85); font-size: 12px; }
.dr-bubble { position: absolute; left: 8px; top: calc(max(8px, env(safe-area-inset-top)) + 144px); max-width: min(78%, 420px); background: #fff; color: #1b1f23; border-radius: 16px 16px 16px 4px; padding: 8px 12px; box-shadow: 0 4px 14px rgba(0,0,0,.3); }
.dr-bubble p { margin: 2px 0; font-size: 15px; font-weight: 700; }
.dr-bubble small { display: block; font-size: 11px; color: #5b6670; }
.dr-gloss { font-style: italic; }
.dr-flash { position: absolute; left: 50%; top: 42%; transform: translateX(-50%); margin: 0; padding: 8px 16px; border-radius: 999px; background: rgba(198,40,40,.9); font-weight: 700; font-size: 16px; white-space: nowrap; }
.dr-controls { position: absolute; left: 0; right: 0; bottom: max(10px, env(safe-area-inset-bottom)); display: flex; justify-content: space-between; padding: 0 10px; pointer-events: none; }
.dr-steer, .dr-pedals { display: flex; gap: 10px; pointer-events: auto; }
.dr-key { width: 74px; height: 74px; border-radius: 18px; border: 2px solid rgba(255,255,255,.5); background: rgba(12,16,20,.55); color: #fff; font: inherit; font-size: 22px; font-weight: 800; touch-action: none; }
.dr-key:active { background: rgba(255,255,255,.3); }
.dr-key.is-brake { background: rgba(198,40,40,.6); font-size: 15px; }
.dr-key.is-gas { background: rgba(46,125,50,.65); font-size: 17px; height: 96px; }
.dr-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(92vw, 420px); max-height: 84vh; overflow: auto; background: rgba(12,16,20,.9); border-radius: 20px; padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
.dr-card h2 { margin: 0 0 6px; font-size: 20px; }
.dr-card p { margin: 6px 0; line-height: 1.4; font-size: 14px; }
.dr-keys { opacity: .75; font-size: 12px !important; }
.dr-end { border-top: 8px solid #f4c20d; text-align: center; }
.dr-sub { opacity: .8; }
.dr-earned { font-size: 40px !important; font-weight: 800; color: #ffd84a; margin: 6px 0 !important; }
.dr-brag { color: #7ee2a8; font-weight: 700; }
.dr-end dl { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; text-align: left; margin: 10px 0; font-size: 14px; }
.dr-end dt { opacity: .8; }
.dr-end dd { margin: 0; font-weight: 700; text-align: right; }
.dr-note { font-size: 12px !important; opacity: .8; }
.dr-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 10px; }
@media (min-width: 900px) { .dr-hud { left: auto; width: 520px; } .dr-key { width: 84px; height: 84px; } }
</style>
