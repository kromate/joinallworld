<script setup lang="ts">
// The companion, alive: its small 3D stage floating over the game, the speech bubble, the chat sheet and the director that decides when
// it speaks up. Fetched after the first frame (CompanionHook.vue). The 3D model has its own tiny canvas and loop (stage.ts) so the venue
// scene can stay idle; if WebGL is missing the flat twin is shown instead. It never covers a control for long: it can be dragged, it steps
// aside for calls and tours, and it can be turned off (Companion: lively / quiet / off, on this device).
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useApp } from '../../state/app.ts'
import { callStore } from '../calls/callState.ts'
import { tour } from '../tour/tourState.ts'
import { social } from '../social/useSocial.ts'
import { hintsOn } from '../sim/settingsModel.ts'
import CompanionFace from './CompanionFace.vue'
import { COMPANION_NAME } from './identity.ts'
import { createMemory, readPrefs, writePrefs } from './memory.ts'
import type { CompanionMode, LogLine } from './memory.ts'
import { createStage } from './stage.ts'
import type { Stage } from './stage.ts'
import { actionEnv } from './actionEnv.ts'
import { runAction } from './actions.ts'
import { askCompanion } from './brain.ts'
import type { Hosted } from './brain.ts'
import { contextFromGame, dayOf } from './contextFromGame.ts'
import { afterEngaged, afterIgnored, afterShown, decide, detectEvents } from './director.ts'
import type { GameEvent, Nudge } from './director.ts'
import { TOUR_LABELS, TOUR_IDS } from './tours.ts'
import { companionUi, signal } from './companionState.ts'
import type { CompanionAction, CompanionContext } from './types.ts'

const CompanionSheet = defineAsyncComponent(() => import('./CompanionSheet.vue'))

const app = useApp()
const { game, shell } = app
const ls = ((): Storage | null => { try { return globalThis.localStorage ?? null } catch { return null } })()
const prefs = reactive(readPrefs(ls))
const who = computed(() => game.view.value.session?.id ?? '')
let memory = createMemory(ls, who.value)
const lines = shallowRef<LogLine[]>([...memory.data.log])
const reducedQuery = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
const reduced = ref(reducedQuery?.matches === true)

// ---- whether and where it shows ----------------------------------------------------------------------------------------
const settled = computed(() => game.connected.value && game.view.value.onboarding?.required !== true)
const callUp = computed(() => callStore.view.phase !== 'idle' || callStore.confirm !== null)
const effective = computed<CompanionMode>(() => (prefs.mode === 'off' ? 'off' : hintsOn(ls) ? prefs.mode : 'quiet'))
const shown = computed(() => settled.value && prefs.mode !== 'off' && !callUp.value)
const size = ref(window.innerWidth <= 480 ? 92 : 124)
const pos = reactive({ x: 8, y: 400 })
const override = ref<{ x: number; y: number } | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const root = ref<HTMLElement | null>(null)
const webgl = ref(true)
const mood = ref<'idle' | 'happy' | 'think' | 'sleepy' | 'talk' | 'wave'>('idle')
let stage: Stage | null = null
let dragged = false

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, hi < lo ? lo : v))
function rest(): { x: number; y: number } {
  if (prefs.x !== undefined && prefs.y !== undefined) return { x: clamp(prefs.x * window.innerWidth, 4, window.innerWidth - size.value - 4), y: clamp(prefs.y * window.innerHeight, 56, window.innerHeight - size.value - 4) }
  // Out of the way of the bars, the venue card and the map's own buttons: the right edge, a little above the middle of the screen.
  const narrow = window.innerWidth <= 720
  const x = window.innerWidth - size.value - (narrow ? 6 : 18)
  const y = narrow ? window.innerHeight * 0.4 : window.innerHeight * 0.52
  return { x, y: clamp(y, 100, window.innerHeight - size.value - 8) }
}
function place(): void { const at = override.value ?? rest(); pos.x = at.x; pos.y = at.y }
const style = computed(() => ({ left: `${pos.x}px`, top: `${pos.y}px`, width: `${size.value}px`, height: `${size.value}px` }))

// ---- the stage ------------------------------------------------------------------------------------------------------------
async function start(): Promise<void> {
  if (stage || !canvas.value) return
  try {
    stage = await createStage(canvas.value, size.value, reduced.value)
    if (!shown.value) { stage.run(false); return }
    stage.run(!document.hidden)
    stage.play('wave')
    applyBase()
  } catch (error) { webgl.value = false; console.warn('The companion is shown flat on this device:', error) }
}
const night = (ctx: CompanionContext): boolean => ctx.hour >= 23 || ctx.hour < 5
function applyBase(): void { if (!stage) return; stage.base(night(contextFromGame(app)) ? 'sleepy' : 'idle') }
function dispose(): void { stage?.dispose(); stage = null }
watch(shown, (on) => { if (on) void nextTick(() => { place(); if (stage) stage.run(!document.hidden); else void start() }); else stage?.run(false) })
function onVisibility(): void { stage?.run(shown.value && !document.hidden) }
watch(reduced, (on) => stage?.reduced(on))
function say(mode: 'happy' | 'think' | 'wave' | 'nod' | 'celebrate' | 'point' | undefined, text: string): void {
  const pose = mode === 'happy' || !mode ? 'nod' : mode
  stage?.play(pose === 'think' ? 'think' : pose)
  mood.value = pose === 'wave' ? 'wave' : pose === 'celebrate' || pose === 'nod' ? 'happy' : pose === 'think' ? 'think' : 'talk'
  stage?.talk(true)
  const ms = reduced.value ? 900 : Math.min(3600, 500 + text.length * 40)
  setTimeout(() => { stage?.talk(false); mood.value = 'idle'; if (pose === 'think') stage?.base('idle') }, ms)
  signal('speak', { mood: pose })
}
function look(event: PointerEvent): void {
  if (!stage || !shown.value) return
  const cx = pos.x + size.value / 2, cy = pos.y + size.value / 2
  stage.look(clamp((event.clientX - cx) / 300, -1, 1), clamp(-(event.clientY - cy) / 300, -1, 1))
}
let lastLook = 0
function onPointerMove(event: PointerEvent): void { const now = event.timeStamp; if (now - lastLook < 80) return; lastLook = now; look(event) }

// ---- drag, tap -------------------------------------------------------------------------------------------------------------
let drag: { id: number; sx: number; sy: number; ox: number; oy: number } | null = null
function down(event: PointerEvent): void {
  drag = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: pos.x, oy: pos.y }; dragged = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent): void {
  if (!drag || drag.id !== event.pointerId) return
  const dx = event.clientX - drag.sx, dy = event.clientY - drag.sy
  if (!dragged && Math.hypot(dx, dy) < 8) return
  dragged = true
  pos.x = clamp(drag.ox + dx, 4, window.innerWidth - size.value - 4); pos.y = clamp(drag.oy + dy, 56, window.innerHeight - size.value - 4)
}
function up(event: PointerEvent): void {
  if (!drag || drag.id !== event.pointerId) return
  drag = null
  if (dragged) { prefs.x = pos.x / window.innerWidth; prefs.y = pos.y / window.innerHeight; writePrefs(ls, { mode: prefs.mode, x: prefs.x, y: prefs.y }) } else openChat()
}
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowDown' || !event.shiftKey) return
  event.preventDefault()
  const step = 24
  pos.x = clamp(pos.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), 4, window.innerWidth - size.value - 4)
  pos.y = clamp(pos.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0), 56, window.innerHeight - size.value - 4)
  prefs.x = pos.x / window.innerWidth; prefs.y = pos.y / window.innerHeight; writePrefs(ls, { mode: prefs.mode, x: prefs.x, y: prefs.y })
}

// ---- the bubble -----------------------------------------------------------------------------------------------------------
const bubble = ref<Nudge | null>(null)
let bubbleTimer = 0, bubbleAt = 0
const side = computed(() => (pos.x + size.value / 2 > window.innerWidth / 2 ? 'is-left' : 'is-right'))
const above = computed(() => pos.y > 190)
const dot = computed(() => companionUi.unread > 0 && !bubble.value)
function sync(): void { lines.value = [...memory.data.log]; companionUi.tick++; companionUi.unread = memory.unread() }
function log(from: 'lumo' | 'you', text: string, actions?: CompanionAction[], read = true): void {
  memory.append({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, from, text, at: Date.now(), ...(actions?.length ? { actions } : {}), ...(from === 'lumo' ? { read } : {}) })
  sync()
}
function closeBubble(): void { clearTimeout(bubbleTimer); bubble.value = null }
function show(nudge: Nudge): void {
  const now = Date.now()
  memory.setNudge(afterShown(memory.data, nudge, now, dayOf(now)))
  const key = milestoneKey(nudge.id)
  if (key) memory.markMilestone(key)
  if (nudge.kind === 'daily') memory.set({ dailyDay: dayOf(now) })
  log('lumo', nudge.text, nudge.actions, nudge.dot === true || companionUi.open)
  if (nudge.dot || companionUi.open) return
  bubble.value = nudge; bubbleAt = now
  say(nudge.mood, nudge.text)
  clearTimeout(bubbleTimer)
  bubbleTimer = window.setTimeout(() => { if (bubble.value === nudge) { memory.setNudge(afterIgnored(memory.data)); bubble.value = null } }, 16_000)
}
function milestoneKey(id: string): string | null {
  if (id.startsWith('moment:promoted') || id.startsWith('social:') || id.startsWith('idle:') || id === 'daily' || id.startsWith('warn:')) return null
  if (id.startsWith('offer:new-city:')) return `city:${id.slice('offer:new-city:'.length)}`
  return id.replace(/^(moment|offer):/, (_m, kind: string) => (kind === 'offer' && id === 'offer:travel' ? 'offer:' : ''))
}
function notNow(): void { memory.setNudge(afterIgnored(memory.data)); closeBubble() }
function act(action: CompanionAction): void {
  if (action.kind !== 'dismiss') memory.setNudge(afterEngaged(memory.data))
  closeBubble()
  runAction(action, env)
  signal('act', { action: action.kind })
}

// ---- the chat ------------------------------------------------------------------------------------------------------------
const thinking = ref(false)
let hostedOffUntil = 0
async function hosted(message: string, history: { role: 'user' | 'assistant'; text: string }[]): Promise<Hosted | null> {
  if (Date.now() < hostedOffUntil) return null
  try {
    const answer = await game.fetchJson<{ ok?: boolean; via?: string; text?: string | null; suggest?: string[]; topic?: string }>('/api/companion/ask', { method: 'POST', body: { message, clientId: game.newId(), history } })
    if (!answer || answer.ok === false || !answer.text || (answer.via !== 'primary' && answer.via !== 'fallback')) return null
    return { text: answer.text, suggest: Array.isArray(answer.suggest) ? answer.suggest : [], via: answer.via, ...(answer.topic ? { topic: answer.topic } : {}) }
  } catch { hostedOffUntil = Date.now() + 5 * 60_000; return null }
}
async function send(message: string): Promise<void> {
  const clean = message.trim().slice(0, 400)
  if (!clean || thinking.value) return
  log('you', clean)
  thinking.value = true
  stage?.base('idle'); stage?.play('think', 1400)
  mood.value = 'think'
  const started = Date.now()
  const history = memory.data.log.slice(-7, -1).map((line) => ({ role: line.from === 'you' ? 'user' as const : 'assistant' as const, text: line.text }))
  try {
    const answer = await askCompanion({ context: contextFromGame(app), message: clean, memory: { explained: memory.data.explained, asked: memory.data.asked } }, hosted, history)
    const wait = reduced.value ? 0 : Math.max(0, 450 - (Date.now() - started))
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    memory.explained(answer.topic); memory.asked()
    log('lumo', answer.text, answer.actions)
    say(answer.mood, answer.text)
  } finally { thinking.value = false }
}
function openChat(): void {
  closeBubble()
  companionUi.open = true
}
watch(() => companionUi.open, (open) => {
  if (open) { closeBubble(); memory.markRead(); sync(); stage?.play('wave'); if (!lines.value.length) log('lumo', `Hi ${first()}! I am ${COMPANION_NAME}, the world’s guide. Ask me anything about Allworld, or tap one of these.`) }
})
const first = (): string => (game.view.value.name || 'friend').trim().split(/\s+/)[0] ?? 'friend'
function setMode(next: CompanionMode): void {
  prefs.mode = next; writePrefs(ls, { mode: next, ...(prefs.x !== undefined && prefs.y !== undefined ? { x: prefs.x, y: prefs.y } : {}) })
  if (next === 'off') closeBubble()
}
const env = actionEnv(app, {
  ask: (text) => { companionUi.open = true; void send(text) },
  setMode: (next) => { setMode(next); log('lumo', next === 'quiet' ? 'Okay, I will stay quiet and only speak when you ask.' : next === 'off' ? 'Turned off. You can switch me back on from the chat in Messages.' : 'Back to lively. I will only speak up now and then.') },
  dismiss: closeBubble,
  close: () => { companionUi.open = false },
})
const tourRows = computed(() => TOUR_IDS.map((id) => ({ id, label: TOUR_LABELS[id].label, done: memory.data.tours[id] === 'done' })))

// ---- the director ------------------------------------------------------------------------------------------------------
let previous: CompanionContext | null = null
let pending: { event: GameEvent; at: number }[] = []
let lastInput = Date.now()
const openedAt = Date.now()
let introDone = false
const noteInput = (): void => { lastInput = Date.now() }
function quiet(): { typing: boolean; inCall: boolean; modal: boolean; confirming: boolean; tour: boolean; hidden: boolean } {
  const field = document.activeElement
  return {
    typing: Boolean(field?.matches('input, textarea, select, [contenteditable]')), inCall: callUp.value,
    modal: Boolean(shell.sheet.value) || companionUi.open || Boolean(document.querySelector('dialog[open]')),
    confirming: Boolean(document.querySelector('.ui-confirm')), tour: tour.active || tour.pending, hidden: document.hidden,
  }
}
function tick(): void {
  if (!shown.value) return
  const ctx = contextFromGame(app)
  const novel = previous !== null && previous.cityId !== ctx.cityId && !memory.data.cities.includes(ctx.cityId)
  for (const event of detectEvents(previous, ctx, novel)) pending.push({ event, at: Date.now() })
  if (!memory.data.cities.includes(ctx.cityId)) memory.visitCity(ctx.cityId)
  previous = ctx
  const now = Date.now()
  pending = pending.filter((item) => now - item.at < 120_000)
  if (!introDone && intro(ctx)) return
  const nudge = decide({ now, day: dayOf(now), mode: effective.value, ctx, quiet: quiet(), idleMs: now - lastInput, events: pending.map((item) => item.event), memory: memory.data, showing: bubble.value !== null, openMs: now - openedAt })
  if (nudge) { pending = []; show(nudge) }
}
/** The first words, once per player on this device: the guide appears, waves and says where the founder's note is. */
function intro(ctx: CompanionContext): boolean {
  if (memory.data.introDone) { introDone = true; return false }
  if (tour.active || tour.pending || quiet().modal || Date.now() - openedAt < 2500) return true
  if (!ctx.friends.length && Date.now() - openedAt < 7000) return true // the friends list is still on its way
  introDone = true
  memory.set({ introDone: true })
  const note = ctx.friends.some((friend) => friend.founder)
  const text = `Hi ${first()}! I am ${COMPANION_NAME}, the world’s guide. ${note ? 'The founder left you a welcome note in Messages, and I am here whenever you need a hand.' : 'I am here whenever you need a hand.'}`
  const actions: CompanionAction[] = [...(note ? [{ kind: 'open', id: 'messages', label: 'Read the note' } as CompanionAction] : []), { kind: 'tour', tour: 'basics', label: 'Show me around' }]
  if (effective.value === 'lively') show({ id: 'intro', kind: 'moment', text, actions, mood: 'wave' }); else log('lumo', text, actions, false)
  return true
}
/** The founder is away and the player wrote to them: one gentle line here, in this thread, never in theirs. */
let founderBaseline: string | null = null
const founderKey = (): string => {
  const mine = social.me?.me.id, conv = social.me?.conversations.find((item) => item.kind === 'dm' && item.members.some((member) => member.founder === true))
  return conv?.last && mine && conv.last.from?.id === mine ? `${conv.id}:${conv.last.seq}` : ''
}
watch(founderKey, (key) => {
  if (founderBaseline === null) { founderBaseline = key; return }
  if (!key || key === founderBaseline) return
  founderBaseline = key
  const founder = social.me?.friends.find((friend) => friend.founder === true)
  const now = Date.now()
  if (!founder || founder.status === 'online' || now - (memory.data.nudge.seen['founder-away'] ?? 0) < 6 * 3_600_000 || effective.value === 'off') return
  memory.setNudge({ seen: { ...memory.data.nudge.seen, 'founder-away': now } })
  const actions: CompanionAction[] = [{ kind: 'ask', text: 'What should I do now?', label: 'Something fun to do' }, { kind: 'ask', text: 'Who is online?', label: 'Who is online?' }]
  const text = 'The founder will see your message when they are back. Meanwhile, want something fun to do?'
  log('lumo', text, actions, companionUi.open)
  if (effective.value === 'lively' && !companionUi.open) { bubble.value = { id: 'founder-away', kind: 'social', text, actions, mood: 'wave' }; say('wave', text); clearTimeout(bubbleTimer); bubbleTimer = window.setTimeout(() => { bubble.value = null }, 16_000) }
}, { immediate: true })
const stop = game.on('accepted', () => { window.setTimeout(tick, 500) })
let timer = 0
onMounted(() => {
  place()
  void start()
  timer = window.setInterval(tick, 4000)
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(type, noteInput, { passive: true })
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('jaw:companion-point', onPoint as EventListener)
  reducedQuery?.addEventListener('change', onReduced)
})
onBeforeUnmount(() => {
  clearInterval(timer); clearTimeout(bubbleTimer); stop(); dispose()
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.removeEventListener(type, noteInput)
  window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('jaw:companion-point', onPoint as EventListener); reducedQuery?.removeEventListener('change', onReduced)
})
function onReduced(): void { reduced.value = reducedQuery?.matches === true }
function onResize(): void { size.value = window.innerWidth <= 480 ? 92 : 124; stage?.resize(size.value); place() }
watch(() => [game.mode.value, shell.sheet.value], () => { void nextTick(place) })
watch(who, () => { memory = createMemory(ls, who.value); introDone = false; previous = null; sync() })

// ---- standing by a tour step and pointing at it ----------------------------------------------------------------------------
interface Box { left: number; top: number; width: number; height: number }
const hit = (a: Box, b: Box): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
let pointKey = ''
function onPoint(event: CustomEvent<{ active: boolean; target?: Box | null; card?: Box | null }>): void {
  const detail = event.detail
  if (!detail?.active) { override.value = null; pointKey = ''; place(); stage?.play('celebrate', 1400); return }
  const target = detail.target ?? null, card = detail.card ?? null
  const anchor = target ?? card
  if (!anchor) return
  const s = size.value, gap = 10, w = window.innerWidth, h = window.innerHeight
  const spots = [
    { x: anchor.left + anchor.width + gap, y: anchor.top + anchor.height / 2 - s / 2 }, { x: anchor.left - s - gap, y: anchor.top + anchor.height / 2 - s / 2 },
    { x: anchor.left + anchor.width / 2 - s / 2, y: anchor.top - s - gap }, { x: anchor.left + anchor.width / 2 - s / 2, y: anchor.top + anchor.height + gap },
    ...(card ? [
      { x: card.left + card.width - s, y: card.top + card.height + gap }, { x: card.left, y: card.top + card.height + gap }, { x: card.left, y: card.top - s - gap },
      { x: card.left + card.width + gap, y: card.top }, { x: card.left - s - gap, y: card.top },
    ] : []),
    { x: 8, y: h - s - 8 }, { x: w - s - 8, y: h - s - 8 },
  ]
  const free = (at: { x: number; y: number }): boolean => at.x >= 4 && at.y >= 56 && at.x + s <= w - 4 && at.y + s <= h - 4 && !(target && hit({ left: at.x, top: at.y, width: s, height: s }, target)) && !(card && hit({ left: at.x, top: at.y, width: s, height: s }, card))
  const at = spots.find(free) ?? spots[spots.length - 1]!
  override.value = { x: clamp(at.x, 4, w - s - 4), y: clamp(at.y, 56, h - s - 4) }
  place()
  if (target) {
    const dx = target.left + target.width / 2 - (override.value.x + s / 2), dy = target.top + target.height / 2 - (override.value.y + s / 2), len = Math.hypot(dx, dy) || 1
    const key = `${Math.round(target.left)}:${Math.round(target.top)}`
    stage?.point(dx / len, -dy / len)
    if (key !== pointKey) { pointKey = key; stage?.play('point', 2400) }
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="shown" ref="root" class="lumo-root" :class="{ 'is-still': reduced, 'is-moving': override !== null }" :style="style">
      <div v-if="bubble && !companionUi.open && !tour.active" class="lumo-bubble" :class="[side, above ? 'is-above' : 'is-below']" role="status">
        <p>{{ bubble.text }}</p>
        <div class="lumo-bubble-actions">
          <button v-for="(action, at) in bubble.actions.slice(0, 2)" :key="at" type="button" :class="{ 'is-primary': at === 0 }" @click="act(action)">{{ action.label }}</button>
          <button type="button" class="is-quiet" @click="notNow">Not now</button>
        </div>
      </div>
      <button class="lumo-stage" type="button" :aria-label="`${COMPANION_NAME}, your guide. Open chat`" :title="`${COMPANION_NAME} · AI guide`" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown.enter.prevent="openChat" @keydown.space.prevent="openChat" @keydown="onKey">
        <canvas v-show="webgl" ref="canvas" :width="size" :height="size" aria-hidden="true" />
        <CompanionFace v-if="!webgl" :size="size - 12" :mood="mood" :still="reduced" />
        <span v-if="dot" class="lumo-dot" aria-hidden="true" />
      </button>
    </div>
    <CompanionSheet v-if="companionUi.open" :lines="lines" :thinking="thinking" :mode="prefs.mode" :mood="mood" :tours="tourRows" @close="companionUi.open = false" @send="send" @action="act" @mode="setMode" @clear="memory.clear(); sync()" />
  </Teleport>
</template>

<style scoped>
.lumo-root { position: fixed; z-index: 30; pointer-events: none; font-family: var(--font); transition: left .45s var(--ease-out), top .45s var(--ease-out); }
.is-still, .lumo-root.is-still { transition: none; }
.lumo-stage { position: absolute; inset: 0; padding: 0; border: 0; background: none; cursor: grab; pointer-events: auto; touch-action: none; border-radius: 50%; -webkit-tap-highlight-color: transparent; }
.lumo-stage:focus-visible { outline: var(--focus); outline-offset: 2px; }
.lumo-stage:active { cursor: grabbing; }
.lumo-stage canvas { display: block; width: 100%; height: 100%; filter: drop-shadow(0 6px 8px rgba(16, 24, 20, .22)); pointer-events: none; }
.lumo-dot { position: absolute; top: 8px; right: 10px; width: 14px; height: 14px; border-radius: 50%; background: var(--c-badge); border: 2px solid #fff; }
.lumo-bubble { position: absolute; width: max-content; max-width: min(260px, calc(100vw - 24px)); padding: 10px 12px; border-radius: 16px; background: #fff; color: var(--c-ink); box-shadow: var(--e-2); pointer-events: auto; animation: lumo-pop var(--m-pop) var(--ease-pop); }
.lumo-bubble.is-above { bottom: calc(100% + 4px); } .lumo-bubble.is-below { top: calc(100% + 4px); }
.lumo-bubble.is-left { right: 0; } .lumo-bubble.is-right { left: 0; }
.lumo-bubble p { margin: 0; font-size: 14px; line-height: 1.35; }
.lumo-bubble-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.lumo-bubble-actions button { min-height: 36px; padding: 0 12px; border: 1.5px solid var(--c-line); border-radius: var(--r-pill); background: #fff; color: var(--c-ink); font: 700 13px var(--font); cursor: pointer; position: relative; }
.lumo-bubble-actions button::after { content: ''; position: absolute; inset: -4px -2px; }
.lumo-bubble-actions .is-primary { border-color: var(--c-green-dark); background: var(--c-green-dark); color: #fff; }
.lumo-bubble-actions .is-quiet { border-color: transparent; background: none; color: var(--c-muted); text-decoration: underline; text-underline-offset: 3px; }
@keyframes lumo-pop { from { opacity: 0; transform: scale(.9) translateY(6px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .lumo-bubble { animation: lumo-fade .2s ease-out } .lumo-root { transition: none } @keyframes lumo-fade { from { opacity: 0 } to { opacity: 1 } } }
</style>
