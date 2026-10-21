<script setup lang="ts">
// Walk through a space in 3D (docs/SPACES-3D.md, phase 2): a home, a group room or a world (docs/WORLDS.md), its furniture and
// the models players placed, in the realistic look. The owner (or a group member) can place their own models: choose one, tap a floor to put it there, turn
// it, size it, lift it, and save. Full screen over the game; lazy (three and the engine load only when this opens).
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import '../../../ui/controls.css'
import { useApp } from '../../state/app.ts'
import { modelBytes, modelUpload, scriptSave, worldCoverUpload, worldRead, worldSave, type ModelView, type PlacedModel, type WorldView, type WorldWhere } from './spacesClient.ts'
import { WORLDS, worldLinkPath } from '../../../spaces/worlds.ts'
import { focusMap, track } from '../world/worldModel.ts'
import { neighbourPlots, neighboursFrom, pagesFor } from './streetModel.ts'
import { unpackStyle } from '../../../scene/house-style.ts'
import { PROPS, PROP_IDS, PROP_OWNER, propModel, propOf, propView, type PropDef, type PropId } from '../../../spaces/props.ts'
import { embedUrl, screenPosition, youtubeId, type ScreenState } from '../../../spaces/screen.ts'
// A world's lite game (docs/WORLDS.md phase 3): the arena's own room, fetched only when someone presses Play.
const LiteRoom = defineAsyncComponent(() => import('../arena/LiteRoom.vue'))
import { checkGlb, GLB_LIMITS } from '../../../spaces/glb.ts'
import { scriptNames, SCRIPT, TEMPLATES } from '../../../spaces/script.ts'
import type { Placement } from '../../../spaces/layout.ts'
import type { Engine, View } from '../../../spaces/world/engine.ts'
import type { SpaceHouse } from '../../../spaces/world/space.ts'
import { fillLine } from '../../../spaces/script.ts'
import type { Together } from '../../../spaces/world/together.ts'

/** `place`: a model to put down in front of the player as soon as the space is built (just uploaded, or chosen in My 3D models). */
const props = defineProps<{ where: WorldWhere; place?: ModelView | null }>()
// A premiere in this world (docs/ALLWORLD-HOUSE.md): play the track on the screen, clip the moment. Loaded only in a world.
const PremiereBar = defineAsyncComponent(() => import('../watch/PremiereBar.vue'))
/** `saved`: a world's layout was saved and its cover drawn (the Worlds app refreshes its list). */
const emit = defineEmits<{ close: []; saved: [] }>()
const { game, shell } = useApp()

const canvas = ref<HTMLCanvasElement | null>(null)
// A modal dialog: the phone is one too, and a dialog shown later sits above it in the page's top layer.
const dialog = ref<HTMLDialogElement | null>(null)
/** Full screen: the whole 3D view (the stage inside the dialog: a modal dialog cannot itself be the full-screen element in every browser)
 *  or just the shared screen. iPhones have no full screen for a page element: the button is not shown there (the view already fills the screen). */
const stage = ref<HTMLElement | null>(null)
const tvBox = ref<HTMLElement | null>(null)
type FullDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> }
type FullEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }
const fullDoc = document as FullDoc
const canFull = Boolean(fullDoc.fullscreenEnabled || fullDoc.webkitFullscreenEnabled)
const full = ref<'stage' | 'tv' | null>(null)
function fullChanged(): void {
  const el = fullDoc.fullscreenElement ?? fullDoc.webkitFullscreenElement ?? null
  full.value = el && el === stage.value ? 'stage' : el && el === tvBox.value ? 'tv' : null
}
async function toggleFull(what: 'stage' | 'tv'): Promise<void> {
  try {
    if (full.value === what) { await (fullDoc.exitFullscreen?.() ?? fullDoc.webkitExitFullscreen?.()); return }
    const el = (what === 'stage' ? stage.value : tvBox.value) as FullEl | null
    if (!el) return
    if (what === 'tv') screenHidden.value = false
    await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.())
    // A phone turns to landscape for a video where the browser allows it (Android); elsewhere this is refused quietly.
    if (what === 'tv') void (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape')?.catch(() => {})
    track('world_fullscreen', { what })
  } catch { note.value = 'This browser would not go full screen.' }
}
const world = shallowRef<WorldView['world'] | null>(null)
const loading = ref(true)
const error = ref('')
const note = ref('')
const view = ref<View>('third')
const floor = ref(0)
const floors = ref(1)
const editing = ref(false)
const busy = ref(false)
const dirty = ref(false)
/** The layout being edited: the saved one plus changes. */
const layout = ref<PlacedModel[]>([])
const selected = ref<string | null>(null)
const choosing = ref<ModelView | null>(null)
/** Physics (phase 3): on once Rapier has loaded; whether a model is in the walker's hands. */
const physicsOn = ref(false)
const holding = ref(false)
/** Phase 4: the space's script, the code panel, and what a running script shows. */
const coding = ref(false)
const code = ref('')
const lines = ref('')
const said = ref('')
const score = ref<number | null>(null)
const scriptError = ref('')
const scriptBusy = ref(false)
let saidTimer = 0
/** Phase 5: together. Who is here, who hosts (moves the models and runs the script), and what to tell the others next. */
const here = ref(1)
const hosting = ref(true)
let together: Together | null = null
let tickTimer = 0
let pendingSay: number[] | undefined, pendingScore: number | undefined
const peerNames = new Map<string, string>()
const peerPoses = new Map<string, { name: string; p: number[] }>()
const order = (): string[] => layout.value.map((p) => p.k)
function showSaid(text: string): void { said.value = text; clearTimeout(saidTimer); saidTimer = window.setTimeout(() => { said.value = '' }, 4000) }
const linesOf = (): string[] => lines.value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, SCRIPT.lines)
const namesOf = (): Map<string, string> => scriptNames(layout.value)
function startScript(source: { code: string; lines: string[] } | null): void {
  scriptError.value = ''; score.value = null; said.value = ''
  engine?.runScript(source, namesOf())
}
/** A copied house (docs/HOUSE-FROM-PHOTOS.md) in the shape the engine takes. */
const houseOf = (w: WorldView['world']): SpaceHouse | null => (w.house?.kind === 'spec' ? { kind: 'spec', spec: w.house.spec } : w.house?.kind === 'model' ? { kind: 'model', hash: w.house.model.hash, size: w.house.model.size } : null)
let engine: Engine | null = null
let gone = false
let counter = Date.now() % 100000

const picked = computed(() => layout.value.find((p) => p.k === selected.value) ?? null)
const triangles = computed(() => layout.value.reduce((sum, p) => sum + p.triangles, 0))
const bytes = new Map<string, Promise<ArrayBuffer | null>>()
const bytesOf = (hash: string): Promise<ArrayBuffer | null> => { let found = bytes.get(hash); if (!found) { found = modelBytes(hash); bytes.set(hash, found) } return found }

onMounted(async () => {
  dialog.value?.showModal?.()
  const answer = await worldRead(game, props.where)
  if (gone) return
  if (!answer.ok) { loading.value = false; error.value = answer.reason; return }
  world.value = answer.world
  layout.value = answer.world.models.map((p) => ({ ...p }))
  const { startEngine } = await import('../../../spaces/world/engine.ts')
  if (gone || !canvas.value) return
  engine = startEngine(canvas.value, { grid: answer.world.grid, owned: answer.world.owned, style: answer.world.style as Record<string, number> | null, items: answer.world.items, models: layout.value, terrain: answer.world.terrain ? { ground: answer.world.terrain.ground, sky: answer.world.terrain.sky } : null, house: houseOf(answer.world) }, bytesOf, {
    status(s) { floor.value = s.floor; floors.value = s.floors; view.value = s.view },
    picked(key) { selected.value = key; engine?.highlight(key) },
    tapped(at) { if (choosing.value) add(choosing.value, at); else if (picked.value) move(at) },
    physics(state) { physicsOn.value = state === 'on' },
    said(text, line, values) { showSaid(text); if (hosting.value) pendingSay = [line, ...values] },
    scored(value) { score.value = value; if (hosting.value) pendingScore = value },
    scriptProblem(message, stopped) { scriptError.value = stopped ? message : `Your code: ${message}` },
  })
  loading.value = false
  // The player's own character in place of the stand-in (the look they made in the game).
  engine.setSelfLook(game.state.value.onboarding?.look, game.session.value?.id ?? 'you')
  startTogether()
  if (answer.world.kind === 'home' && !props.where.host) void loadStreet(answer.world)
  // The first world a player walks into says how: once per device.
  try {
    if (answer.world.kind === 'world' && !localStorage.getItem('aw-world-tip')) {
      localStorage.setItem('aw-world-tip', '1')
      note.value = 'Walk with the stick, drag to look round. Invite brings your friends here.'
      const tip = note.value
      window.setTimeout(() => { if (note.value === tip) note.value = '' }, 7000)
    }
  } catch { /* no storage: no tip */ }
  if (props.place && answer.world.canEdit) {
    // Straight from an upload: the model is put down in front of the player, chosen, ready to drag.
    if (!editing.value) toggleEdit()
    choosing.value = props.place
    placeInFront()
    note.value = `${props.place.name} is in front of you. Drag it where you want it, then Save.`
  }
  if (answer.world.script) {
    code.value = answer.world.script.code
    lines.value = answer.world.script.lines.join('\n')
    startScript(answer.world.script)
  }
})
document.addEventListener('fullscreenchange', fullChanged)
document.addEventListener('webkitfullscreenchange', fullChanged)
onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', fullChanged); document.removeEventListener('webkitfullscreenchange', fullChanged)
  if (full.value) void (fullDoc.exitFullscreen?.() ?? fullDoc.webkitExitFullscreen?.())?.catch?.(() => {})
})
onBeforeUnmount(() => { gone = true; clearInterval(tickTimer); together?.leave(); together = null; engine?.dispose(); engine = null })

/** Join the space live: others are drawn where they are, and the host's models, score and lines reach everyone. */
async function startTogether(): Promise<void> {
  const [{ joinTogether, SPACE_HZ }] = await Promise.all([import('../../../spaces/world/together.ts')])
  if (gone) return
  together = joinTogether(props.where, {
    room(frame) {
      // Someone new: the host tells them where everything is and the score.
      if (frame.host === frame.you && frame.members.length > here.value) { engine?.resendModels(); if (score.value !== null) pendingScore = score.value }
      here.value = frame.members.length
      peerNames.clear()
      for (const m of frame.members) if (m.id !== frame.you) peerNames.set(m.id, m.name)
      for (const id of [...peerPoses.keys()]) if (!peerNames.has(id)) peerPoses.delete(id)
      engine?.setPeers(peerPoses)
      const host = frame.host === frame.you
      if (host !== hosting.value) {
        hosting.value = host
        engine?.setAuthority(host)
        // The host runs the space's script for everyone; the others see what it does.
        if (host) startScript(world.value?.script ?? null)
        else engine?.runScript(null, namesOf())
      }
    },
    peer(frame) {
      const name = peerNames.get(frame.id)
      if (name) { peerPoses.set(frame.id, { name, p: frame.p }); engine?.setPeers(peerPoses) }
      if (hosting.value) return
      if (frame.o) engine?.followModels(order(), frame.o)
      if (typeof frame.s === 'number') score.value = frame.s
      const lines = world.value?.script?.lines ?? []
      if (frame.say && lines[frame.say[0] ?? -1] !== undefined) showSaid(fillLine(lines[frame.say[0]!]!, frame.say.slice(1)))
    },
    problem(reason) { note.value = reason },
    screen(frame) { applyScreen(frame.v ? { v: frame.v, play: frame.play, pos: frame.pos, at: Date.now() } : null) },
  })
  tickTimer = window.setInterval(() => {
    if (!engine || !together) return
    const tick: { p: number[]; o?: number[][]; s?: number; say?: number[] } = { p: engine.pose() }
    if (hosting.value) {
      const moved = engine.movedModels(order())
      if (moved.length) tick.o = moved
      if (pendingScore !== undefined) tick.s = pendingScore
      if (pendingSay) tick.say = pendingSay
      pendingScore = undefined; pendingSay = undefined
    }
    together.send(tick)
  }, 1000 / SPACE_HZ)
}

function leave(): void {
  if (dirty.value && !globalThis.confirm?.('Leave without saving where your models stand?')) return
  emit('close')
}
// ---- The screen (docs/WORLDS.md phase 2): the host puts on a YouTube video or song, everyone here watches or listens in time.
const screenOpen = ref(false)
const screenLink = ref('')
const screenState = ref<ScreenState | null>(null)
const screenSrc = ref('')
const screenHidden = ref(false)
const tv = ref<HTMLIFrameElement | null>(null)
let screenV = '', pauseOnLoad = false
const screenCommand = (func: string, args: unknown[] = []): void => { tv.value?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), 'https://www.youtube-nocookie.com') }
/** Follow what the host says: a new video loads at the right second; the same one is moved and played or paused. */
function applyScreen(state: ScreenState | null): void {
  screenState.value = state
  if (!state) { screenSrc.value = ''; screenV = ''; return }
  const pos = screenPosition(state, Date.now())
  if (state.v !== screenV) { screenV = state.v; pauseOnLoad = !state.play; screenSrc.value = embedUrl(state.v, pos, location.origin); screenHidden.value = false; return }
  screenCommand('seekTo', [pos, true])
  screenCommand(state.play ? 'playVideo' : 'pauseVideo')
}
function tvLoaded(): void { if (pauseOnLoad) { pauseOnLoad = false; window.setTimeout(() => screenCommand('pauseVideo'), 800) } }
const screenNow = (): number => (screenState.value ? screenPosition(screenState.value, Date.now()) : 0)
function putOnScreen(): void {
  const v = youtubeId(screenLink.value)
  if (!v) { note.value = 'Paste a YouTube or YouTube Music link.'; return }
  together?.screen({ v, play: true, pos: 0 })
  screenLink.value = ''
  track('world_screen', { action: 'on' })
}
/** The artist's premiere track on the screen, from the start (watch/PremiereBar.vue). */
function playPremiere(v: string): void { together?.screen({ v, play: true, pos: 0 }); track('world_screen', { action: 'on' }) }
function screenPlay(play: boolean): void { together?.screen({ play, pos: screenNow() }) }
function screenRestart(): void { together?.screen({ play: true, pos: 0 }) }
function screenOff(): void { together?.screen({ off: true }) }

// ---- Built-in shapes (src/spaces/props.ts): placed like a player's model, without uploading anything.
function shapeModel(id: PropId): ModelView {
  const v = propView(id)
  return { id: propModel(id), by: PROP_OWNER, name: v.name, hash: '', bytes: 0, triangles: v.triangles, textures: 0, size: v.size, min: [-v.size[0] / 2, 0, -v.size[2] / 2], animations: 0, skinned: false, hidden: false, at: 0 }
}
function placeShape(id: PropId): void { choosing.value = shapeModel(id); placeInFront() }
// ---- The world's lite game.
const gameOpen = ref(false)

// ---- The street round my home (docs/WORLDS.md phase 4): the road, the neighbours' houses as the map has them, the address.
const streetPlot = computed(() => (world.value?.kind === 'home' && !props.where.host ? game.view.value.estate?.plot ?? null : null))
async function loadStreet(w: WorldView['world']): Promise<void> {
  const plot = game.view.value.estate?.plot
  if (!plot) return
  const pages = pagesFor(neighbourPlots(plot.plot))
  const answers = await Promise.all(pages.map((page) => game.fetchJson<{ houses?: { p: number; s: number }[] }>(`/api/world/lga/${encodeURIComponent(plot.lga)}/estate/${plot.estate}/houses?city=${encodeURIComponent(game.cityId.value)}&page=${page}`).catch(() => null)))
  if (gone) return
  const houses = answers.flatMap((a) => a?.houses ?? [])
  engine?.setStreet({ address: plot.address ?? '', front: w.house ? 'near' : 'left', neighbours: neighboursFrom(houses, plot.plot, (bits) => unpackStyle(bits)) })
}
function goStreet(): void {
  const plot = streetPlot.value
  if (!plot) return
  leave()
  shell.open('map', { destination: null, layer: 'city' })
  focusMap({ plot })
}

/** A world's link, sent with the device's share sheet or copied. */
async function invite(): Promise<void> {
  if (props.where.target !== 'world' || !props.where.id) return
  const url = `${location.origin}${worldLinkPath(props.where.id)}`, title = `${world.value?.title ?? 'My world'} on Allworld`
  try {
    if (typeof navigator.share === 'function') { await navigator.share({ title, url }); track('world_shared', { channel: 'native' }); return }
  } catch (error) { if ((error as { name?: string }).name === 'AbortError') return }
  try { await navigator.clipboard.writeText(url); note.value = 'Link copied. Send it to a friend.'; track('world_shared', { channel: 'copy' }) } catch { note.value = url }
}
/** A world's cover: what its maker sees now, drawn by the engine and kept on the server beside the world. */
async function cover(): Promise<void> {
  if (!engine || props.where.target !== 'world' || !props.where.id) return
  const picture = await engine.snapshot(WORLDS.coverWidth, WORLDS.coverHeight)
  if (!picture || picture.size > WORLDS.coverBytes || gone) return
  await worldCoverUpload(props.where.id, picture)
}
function jump(): void { engine?.jump() }
function useTemplate(id: string): void {
  const found = TEMPLATES.find((t) => t.id === id)
  if (!found) return
  if (code.value.trim() && !globalThis.confirm?.('Replace your code with this starter?')) return
  code.value = found.code
  lines.value = found.lines.join('\n')
}
function runNow(): void { startScript({ code: code.value, lines: linesOf() }) }
function stopNow(): void { engine?.runScript(null, namesOf()); score.value = null; said.value = '' }
async function saveCode(): Promise<void> {
  if (scriptBusy.value) return
  scriptBusy.value = true; scriptError.value = ''; note.value = ''
  const answer = await scriptSave(game, props.where, code.value, linesOf())
  scriptBusy.value = false
  if (gone) return
  if (!answer.ok) { scriptError.value = answer.reason; return }
  note.value = answer.code === 'removed' ? 'Script removed.' : 'Script saved. Everyone who walks in runs it.'
  startScript(code.value.trim() ? { code: code.value, lines: linesOf() } : null)
}
function grab(): void { holding.value = engine?.grab() ?? false; if (!holding.value) note.value = '' }
function throwIt(): void { engine?.throwHeld(); holding.value = false }
function setLoose(on: boolean): void { const p = picked.value; if (!p) return; if (on) p.loose = true; else delete p.loose; changed(p) }
function toggleView(): void { engine?.setView(view.value === 'first' ? 'third' : 'first') }
function toggleEdit(): void {
  editing.value = !editing.value
  engine?.setEditing(editing.value)
  if (!editing.value) { selected.value = null; choosing.value = null; engine?.highlight(null) }
}

// The stick: a thumb on the left walks.
const stick = ref<{ x: number; y: number } | null>(null)
let stickId = -1, stickOrigin = { x: 0, y: 0 }
function stickDown(event: PointerEvent): void { stickId = event.pointerId; stickOrigin = { x: event.clientX, y: event.clientY }; (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId); stick.value = { x: 0, y: 0 } }
function stickMove(event: PointerEvent): void {
  if (event.pointerId !== stickId) return
  const dx = event.clientX - stickOrigin.x, dy = event.clientY - stickOrigin.y, len = Math.hypot(dx, dy), max = 46
  const k = len > max ? max / len : 1
  stick.value = { x: dx * k, y: dy * k }
  engine?.setStick(-(dy * k) / max, (dx * k) / max)
}
function stickUp(event: PointerEvent): void { if (event.pointerId !== stickId) return; stickId = -1; stick.value = null; engine?.setStick(0, 0) }

// Editing.
function changed(p: PlacedModel): void { dirty.value = true; engine?.placeModel(p) }
async function add(model: ModelView, at: { x: number; y: number; z: number; floor: number }): Promise<void> {
  if (!world.value) return
  if (layout.value.length >= world.value.limits.placements) { error.value = `A space holds at most ${world.value.limits.placements} of your models.`; return }
  const p: PlacedModel = { k: `p${(counter++).toString(36)}`, m: model.id, by: model.by, hash: model.hash, x: round(at.x), y: 0, z: round(at.z), ry: 0, s: 1, floor: at.floor, name: model.name, size: model.size, triangles: model.triangles }
  const shape = propOf(model.id)
  if (shape && (PROPS[shape] as PropDef).loose) p.loose = true
  layout.value = [...layout.value, p]
  choosing.value = null
  dirty.value = true
  await engine?.setModels(layout.value)
  selected.value = p.k
  engine?.highlight(p.k)
}
function choose(model: ModelView): void {
  choosing.value = model
  note.value = `Tap a floor to put ${model.name} there.`
}
function placeInFront(): void {
  const model = choosing.value
  if (!model || !engine) return
  const at = engine.inFront()
  void add(model, { x: at.x, y: 0, z: at.z, floor: at.floor })
  note.value = ''
}
/** Upload a .glb without leaving the space: checked here first (the server checks again), then put down in front of the player. */
async function uploadHere(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !world.value || busy.value) return
  error.value = ''
  if (file.size > GLB_LIMITS.bytes) { error.value = `This file is ${(file.size / 1e6).toFixed(1)} MB. A model may be at most ${GLB_LIMITS.bytes / 1e6} MB.`; return }
  const checked = checkGlb(new Uint8Array(await file.arrayBuffer()))
  if (!checked.ok) { error.value = checked.reason; return }
  busy.value = true
  note.value = 'Uploading…'
  const answer = await modelUpload(file, file.name.replace(/\.glb$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 40) || 'Model')
  busy.value = false
  if (gone) return
  if (!answer.ok) { note.value = ''; error.value = answer.reason; return }
  if (!world.value.mine.some((m) => m.id === answer.model.id)) world.value = { ...world.value, mine: [...world.value.mine, answer.model] }
  choosing.value = answer.model
  placeInFront()
  note.value = `${answer.model.name} is in front of you. Drag it where you want it, then Save.`
}
function move(at: { x: number; z: number; floor: number }): void { const p = picked.value; if (!p) return; p.x = round(at.x); p.z = round(at.z); p.floor = at.floor; changed(p) }
function turn(degrees: number): void { const p = picked.value; if (!p) return; p.ry = (((p.ry + degrees) % 360) + 360) % 360; changed(p) }
function size(factor: number): void { const p = picked.value; if (!p) return; p.s = Math.min(20, Math.max(0.05, round(p.s * factor))); changed(p) }
function lift(metres: number): void { const p = picked.value; if (!p) return; p.y = Math.min(12, Math.max(-1, round(p.y + metres))); changed(p) }
async function remove(): Promise<void> {
  const p = picked.value
  if (!p) return
  layout.value = layout.value.filter((q) => q.k !== p.k)
  selected.value = null
  dirty.value = true
  await engine?.setModels(layout.value)
}
async function save(): Promise<void> {
  if (busy.value) return
  busy.value = true; error.value = ''; note.value = ''
  const models: Placement[] = layout.value.map(({ k, m, by, hash, x, y, z, ry, s, floor, loose }) => ({ k, m, by, hash, x, y, z, ry, s, floor, ...(loose ? { loose } : {}) }))
  const answer = await worldSave(game, props.where, models)
  busy.value = false
  if (gone) return
  if (!answer.ok) { error.value = answer.reason; return }
  dirty.value = false
  note.value = answer.placed ? `Saved. ${answer.placed} model${answer.placed === 1 ? '' : 's'} in this space.` : 'Saved.'
  if (world.value?.kind === 'world') { await cover(); if (!gone) emit('saved') }
}
const round = (v: number): number => Math.round(v * 100) / 100
</script>

<template>
  <dialog ref="dialog" class="ws" :aria-label="world ? `${world.title} in 3D` : 'Space in 3D'" @cancel.prevent="leave">
    <div ref="stage" class="ws-stage">
      <canvas ref="canvas" class="ws-canvas" aria-label="The space in 3D. Drag to look around." />
      <header class="ws-top">
        <button type="button" class="ws-pill" @click="leave">Leave</button>
        <h2 class="ws-title">{{ world?.title ?? 'Loading…' }}</h2>
        <button v-if="world?.kind === 'world'" type="button" class="ws-pill" data-world="invite" @click="invite">Invite</button>
        <button v-if="world" type="button" class="ws-pill" :aria-label="view === 'first' ? 'Switch to third person' : 'Switch to first person'" @click="toggleView">{{ view === 'first' ? '1st' : '3rd' }}</button>
        <button v-if="world && canFull" type="button" class="ws-pill" :class="{ 'is-on': full === 'stage' }" :aria-pressed="full === 'stage'" :aria-label="full === 'stage' ? 'Leave full screen' : 'Full screen'" data-world="full" @click="toggleFull('stage')">{{ full === 'stage' ? 'Exit full' : 'Full screen' }}</button>
      </header>
      <p v-if="floors > 1" class="ws-floor" role="status">{{ floor === 0 ? 'Ground floor' : `Floor ${floor}` }}</p>
      <p v-if="loading" class="ws-centre" role="status">Building the space…</p>
      <div v-else-if="!world" class="ws-centre ws-card">
        <p>{{ error }}</p>
        <button type="button" class="ui-button is-block" @click="emit('close')">Close</button>
      </div>
      <template v-else>
        <div class="ws-stick" aria-label="Walk: drag the stick" @pointerdown="stickDown" @pointermove="stickMove" @pointerup="stickUp" @pointercancel="stickUp">
          <span class="ws-knob" :style="stick ? { transform: `translate(${stick.x}px, ${stick.y}px)` } : undefined" />
        </div>
        <div v-if="physicsOn && !editing" class="ws-acts" role="group" aria-label="Actions">
          <button type="button" class="ws-pill" @click="jump">Jump</button>
          <button v-if="hosting" type="button" class="ws-pill" :class="{ 'is-on': holding }" :aria-pressed="holding" @click="grab">{{ holding ? 'Put down' : 'Pick up' }}</button>
          <button v-if="holding" type="button" class="ws-pill" @click="throwIt">Throw</button>
        </div>
        <p v-if="score !== null" class="ws-score" role="status">Score {{ score }}</p>
        <p v-if="here > 1" class="ws-here" role="status">{{ here }} here</p>
        <div v-if="screenSrc" ref="tvBox" class="ws-tv" :class="{ 'is-hidden': screenHidden }">
          <iframe ref="tv" :src="screenSrc" title="The screen" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" @load="tvLoaded" />
          <button v-if="canFull" type="button" class="ws-tv-full" :aria-label="full === 'tv' ? 'Leave full screen' : 'Watch full screen'" data-world="tv-full" @click="toggleFull('tv')">{{ full === 'tv' ? '✕' : '⛶' }}</button>
        </div>
        <div class="ws-left" role="group" aria-label="Screen and game">
          <button v-if="world.screen" type="button" class="ws-pill" :class="{ 'is-on': screenOpen }" :aria-pressed="screenOpen" data-world="screen" @click="screenOpen = !screenOpen">Screen</button>
          <button v-if="world.terrain?.game" type="button" class="ws-pill" data-world="game" @click="gameOpen = true">Play {{ world.terrain.game.title }}</button>
          <button v-if="streetPlot" type="button" class="ws-pill" data-world="street" @click="goStreet">Go to the street</button>
          <PremiereBar v-if="world.kind === 'world' && where.id && world.screen" :world="where.id" :hosting="hosting" :stage="stage" :playing="screenState?.v ?? null" @play="playPremiere" />
        </div>
        <section v-if="screenOpen" class="ws-panel ws-screen" aria-label="The screen">
          <template v-if="hosting">
            <label class="ws-hint" for="ws-screen-link">Watch or listen together: paste a YouTube or YouTube Music link.</label>
            <input id="ws-screen-link" v-model="screenLink" class="ws-text" type="url" inputmode="url" placeholder="https://youtu.be/…" autocomplete="off" @keydown.enter.prevent="putOnScreen" />
            <button type="button" class="ws-wide is-primary" :disabled="!screenLink.trim()" data-world="screen-on" @click="putOnScreen">Put it on</button>
            <div v-if="screenState" class="ws-row ws-row-3">
              <button type="button" @click="screenPlay(!screenState.play)">{{ screenState.play ? 'Pause' : 'Play' }}</button>
              <button type="button" @click="screenRestart">Restart</button>
              <button type="button" @click="screenOff">Off</button>
            </div>
          </template>
          <p v-else class="ws-hint">{{ screenState ? 'The host controls the screen. Everyone here sees the same moment.' : 'The host has nothing on the screen yet.' }}</p>
          <button v-if="screenSrc && canFull" type="button" class="ws-wide" data-world="screen-full" @click="toggleFull('tv')">Watch full screen</button>
          <button v-if="screenSrc" type="button" class="ws-wide" @click="screenHidden = !screenHidden">{{ screenHidden ? 'Show the screen' : 'Hide the screen (keep the sound)' }}</button>
        </section>
        <div v-if="gameOpen && world.terrain?.game" class="ws-game">
          <LiteRoom :intent="{ kind: 'create' }" :game="world.terrain.game.id" @close="gameOpen = false" />
        </div>
        <p v-if="said" class="ws-said" role="status">{{ said }}</p>
        <button v-if="world.canEdit && world.scripts && !editing" type="button" class="ws-pill ws-code" :class="{ 'is-on': coding }" :aria-pressed="coding" @click="coding = !coding">Code</button>
        <section v-if="coding" class="ws-panel ws-coder" aria-label="This space's code">
          <label class="ws-hint" for="ws-template">Start from</label>
          <select id="ws-template" class="ws-select" @change="useTemplate(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
            <option value="">Choose a starter…</option>
            <option v-for="t in TEMPLATES" :key="t.id" :value="t.id">{{ t.title }}</option>
          </select>
          <label class="ws-hint" for="ws-code">JavaScript. <code>space.find('Chair')</code>, <code>space.on('tick', (dt) => …)</code>, <code>space.say(0)</code>.</label>
          <textarea id="ws-code" v-model="code" class="ws-text ws-mono" rows="9" spellcheck="false" autocapitalize="off" autocomplete="off" :maxlength="SCRIPT.code" />
          <label class="ws-hint" for="ws-lines">Words it may show, one a line ({1} for a number). Line 0 is the first.</label>
          <textarea id="ws-lines" v-model="lines" class="ws-text" rows="3" />
          <div class="ws-row ws-row-3">
            <button type="button" @click="runNow">Run</button>
            <button type="button" @click="stopNow">Stop</button>
            <button type="button" :disabled="scriptBusy" @click="saveCode">{{ scriptBusy ? '…' : 'Save' }}</button>
          </div>
          <p v-if="scriptError" class="ws-hint ws-bad" role="alert">{{ scriptError }}</p>
          <p class="ws-hint">Your code runs only in a sandbox on each visitor's phone: it can move your models and show your lines, nothing else.</p>
        </section>
        <button v-if="world.canEdit" type="button" class="ws-pill ws-edit" :class="{ 'is-on': editing }" :aria-pressed="editing" @click="toggleEdit">{{ editing ? 'Done' : 'Place models' }}</button>
        <section v-if="editing" class="ws-panel" aria-label="Place your models">
          <template v-if="picked">
            <p class="ws-name">{{ picked.name }}</p>
            <div class="ws-row">
              <button type="button" aria-label="Turn left" @click="turn(-15)">⟲</button>
              <button type="button" aria-label="Turn right" @click="turn(15)">⟳</button>
              <button type="button" aria-label="Smaller" @click="size(1 / 1.15)">−</button>
              <button type="button" aria-label="Bigger" @click="size(1.15)">+</button>
              <button type="button" aria-label="Lower" @click="lift(-0.1)">↓</button>
              <button type="button" aria-label="Higher" @click="lift(0.1)">↑</button>
              <button type="button" aria-label="Remove from the space" @click="remove">✕</button>
            </div>
            <label class="ws-check"><input type="checkbox" :checked="picked.loose === true" @change="setLoose(($event.target as HTMLInputElement).checked)" /> Loose: falls, rolls and can be picked up</label>
            <p class="ws-hint">Drag it to move it, or tap a floor.</p>
          </template>
          <template v-else>
            <label class="ws-wide ws-file" :class="{ 'is-primary': !world.mine.length }" data-world="upload">
              {{ busy ? 'Uploading…' : 'Upload a .glb' }}
              <input type="file" accept=".glb,model/gltf-binary" :disabled="busy" @change="uploadHere" />
            </label>
            <p class="ws-hint">Shapes: no upload needed.</p>
            <div class="ws-shapes" role="group" aria-label="Shapes">
              <button v-for="id in PROP_IDS" :key="id" type="button" :data-shape="id" @click="placeShape(id)">{{ PROPS[id].label }}</button>
            </div>
            <div v-if="world.mine.length" class="ws-models" role="group" aria-label="My models">
              <button v-for="m in world.mine" :key="m.id" type="button" :class="{ 'is-on': choosing?.id === m.id }" @click="choose(m)">{{ m.name }}</button>
            </div>
            <button v-if="choosing" type="button" class="ws-wide" @click="placeInFront">Put it in front of me</button>
            <p class="ws-hint">{{ choosing ? `Or tap a floor.` : world.mine.length ? 'Choose a model, or tap one in the space.' : 'A .glb from Blender, SketchUp and others. It lands in front of you.' }}</p>
          </template>
          <p class="ws-hint">{{ layout.length }} of {{ world.limits.placements }} placed · {{ triangles.toLocaleString('en') }} of {{ world.limits.triangles.toLocaleString('en') }} triangles</p>
          <button type="button" class="ws-wide is-primary" :disabled="busy || !dirty" @click="save">{{ busy ? 'Saving…' : dirty ? 'Save' : 'Saved' }}</button>
        </section>
        <p v-if="note && !error" class="ws-note" role="status">{{ note }}</p>
        <p v-if="error" class="ws-note ws-error" role="alert">{{ error }}</p>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.ws-left { position: absolute; left: 12px; top: calc(max(8px, env(safe-area-inset-top)) + 96px); display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.ws-panel.ws-screen { left: 8px; right: auto; top: calc(max(8px, env(safe-area-inset-top)) + 232px); bottom: auto; max-height: calc(100vh - 360px); }
.ws-tv { position: absolute; top: calc(max(8px, env(safe-area-inset-top)) + 58px); left: 50%; transform: translateX(-50%); width: min(440px, 64vw); aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45); }
.ws-tv.is-hidden { width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.ws-tv iframe { width: 100%; height: 100%; border: 0; display: block; }
.ws-game { position: absolute; inset: 0; z-index: 6; overflow: auto; background: #0e1217; }
.ws-shapes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; }
.ws-shapes button { min-height: 34px; padding: 0 4px; border: 0; border-radius: 9px; background: #eef1f4; color: #14181c; font: 600 12px var(--font); }

.ws::backdrop { background: #000; }
.ws { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: #a9c7de; overflow: hidden; touch-action: none; user-select: none; font-family: var(--font); }
.ws-stage { position: absolute; inset: 0; overflow: hidden; }
.ws-stage:fullscreen { width: 100%; height: 100%; background: #a9c7de; }
.ws-tv-full { position: absolute; right: 6px; bottom: 6px; min-width: 36px; min-height: 36px; border: 0; border-radius: 999px; background: rgba(0, 0, 0, 0.55); color: #fff; font: 600 16px/1 var(--font); cursor: pointer; }
.ws-tv:fullscreen { top: 0; left: 0; transform: none; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 0; }
.ws-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.ws-top { position: absolute; top: max(8px, env(safe-area-inset-top)); left: 8px; right: 8px; display: flex; align-items: center; gap: 8px; pointer-events: none; }
.ws-top > * { pointer-events: auto; }
.ws-title { flex: 1; min-width: 0; margin: 0; font-size: 16px; color: #fff; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.ws-pill { min-height: 44px; min-width: 44px; padding: 0 14px; border: 0; border-radius: 22px; background: rgba(20, 24, 28, 0.62); color: #fff; font: 600 14px var(--font); backdrop-filter: blur(6px); cursor: pointer; }
.ws-pill.is-on { background: #fff; color: #14181c; }
.ws-floor { position: absolute; top: calc(max(8px, env(safe-area-inset-top)) + 52px); left: 50%; transform: translateX(-50%); margin: 0; padding: 4px 12px; border-radius: 12px; background: rgba(20, 24, 28, 0.55); color: #fff; font-size: 13px; }
.ws-centre { position: absolute; top: 45%; left: 50%; transform: translate(-50%, -50%); margin: 0; color: #fff; font-weight: 600; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6); }
.ws-card { width: min(320px, 86vw); padding: 16px; border-radius: 16px; background: #fff; color: var(--c-ink); text-shadow: none; display: flex; flex-direction: column; gap: 12px; }
.ws-card p { margin: 0; font-weight: 400; }
.ws-stick { position: absolute; left: 18px; bottom: max(18px, env(safe-area-inset-bottom)); width: 112px; height: 112px; border-radius: 50%; background: rgba(255, 255, 255, 0.22); border: 2px solid rgba(255, 255, 255, 0.5); display: flex; align-items: center; justify-content: center; touch-action: none; }
.ws-knob { width: 48px; height: 48px; border-radius: 50%; background: rgba(255, 255, 255, 0.85); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3); pointer-events: none; }
.ws-edit { position: absolute; right: 12px; bottom: max(18px, env(safe-area-inset-bottom)); }
.ws-panel { position: absolute; right: 8px; bottom: calc(max(18px, env(safe-area-inset-bottom)) + 54px); width: min(300px, calc(100vw - 150px)); max-height: 55vh; overflow-y: auto; padding: 10px; border-radius: 16px; background: rgba(255, 255, 255, 0.94); display: flex; flex-direction: column; gap: 8px; }
.ws-name { margin: 0; font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.ws-row button, .ws-models button { min-height: 44px; border: 0; border-radius: 10px; background: var(--c-fill, #eef0f2); color: var(--c-ink, #14181c); font: 600 16px var(--font); cursor: pointer; }
.ws-models { display: flex; flex-direction: column; gap: 6px; }
.ws-models button { font-size: 13px; text-align: left; padding: 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-models button.is-on { background: #14181c; color: #fff; }
.ws-wide { min-height: 44px; border: 0; border-radius: 12px; background: var(--c-fill, #eef0f2); color: var(--c-ink, #14181c); font: 600 14px var(--font); cursor: pointer; }
.ws-wide.is-primary { background: #14181c; color: #fff; }
.ws-wide:disabled { opacity: 0.5; }
.ws-file { position: relative; display: grid; place-items: center; overflow: hidden; }
.ws-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.ws-hint { margin: 0; font-size: 12px; color: #4a5560; }
.ws-score { position: absolute; top: calc(max(8px, env(safe-area-inset-top)) + 52px); right: 12px; margin: 0; padding: 6px 12px; border-radius: 14px; background: rgba(20, 24, 28, 0.7); color: #fff; font: 700 15px var(--font); }
.ws-here { position: absolute; top: calc(max(8px, env(safe-area-inset-top)) + 52px); left: 12px; margin: 0; padding: 6px 12px; border-radius: 14px; background: rgba(20, 24, 28, 0.7); color: #fff; font: 600 14px var(--font); }
.ws-said { position: absolute; left: 50%; top: 32%; transform: translateX(-50%); max-width: 80vw; margin: 0; padding: 10px 16px; border-radius: 16px; background: rgba(255, 255, 255, 0.92); color: #14181c; font: 600 16px var(--font); text-align: center; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25); }
.ws-code { position: absolute; right: 12px; top: calc(max(8px, env(safe-area-inset-top)) + 96px); }
.ws-coder { top: calc(max(8px, env(safe-area-inset-top)) + 148px); bottom: auto; max-height: calc(100vh - 340px); width: min(340px, calc(100vw - 24px)); }
.ws-select, .ws-text { width: 100%; box-sizing: border-box; border: 1px solid #c9d0d6; border-radius: 10px; padding: 8px; font: 14px var(--font); color: #14181c; background: #fff; }
.ws-select { min-height: 44px; }
.ws-mono { font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre; overflow-x: auto; }
.ws-row-3 { grid-template-columns: repeat(3, 1fr); }
.ws-bad { color: #a1281d; font-weight: 600; }
.ws-check { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 13px; }
.ws-check input { width: 20px; height: 20px; flex-shrink: 0; }
.ws-acts { position: absolute; right: 12px; bottom: calc(max(18px, env(safe-area-inset-bottom)) + 54px); display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.ws-note { position: absolute; left: 50%; top: calc(max(8px, env(safe-area-inset-top)) + 92px); transform: translateX(-50%); width: max-content; max-width: 86vw; margin: 0; padding: 8px 12px; border-radius: 12px; background: rgba(20, 24, 28, 0.72); color: #fff; font-size: 13px; }
.ws-error { background: #a1281d; }
</style>
