<script setup lang="ts">
// The chess board: both players' bars (name, captured pieces, clock), the 8 x 8 board, the status
// line, the move list and the controls. A move is made by tapping a piece and then a dot, or by
// dragging the piece; the keyboard does the same with the arrow keys, Enter and Escape. It draws
// what the server's view holds and sends a ChessMove when one is chosen.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import BaseChip from '../../ui/BaseChip.vue'
import { PROMOTIONS, canMove, capturedWords, destinationsFrom, displayOrder, homeSquare, isCapture, isLight, materialLead, nextEvent, orientation, overBanner, pairMoves, pieceAt, remainingFor, clockText, sanWords, seenOf, sidesOf, sortCaptured, squareLabel, squareName, statusText, stepSquare, turnLeft } from './chessModel.ts'
import type { Colour, Promo, Seen } from './chessModel.ts'
import { pieceSvg } from './chessPieces.ts'
import type { ChessMove, ChessState } from './tablesBoundary.ts'

const props = defineProps<{
  state: ChessState
  /** The server time at this draw. */
  now: number
}>()
const emit = defineEmits<{ play: [move: ChessMove] }>()

const view = computed(() => props.state.view)
const seats = computed(() => props.state.table.seats)
const sides = computed(() => sidesOf(view.value, seats.value))
const over = computed(() => view.value.over !== null || props.state.table.status === 'over')
const myTurn = computed(() => canMove(view.value) && props.state.table.status !== 'over')
const seated = computed(() => view.value.you !== null)
const flipped = ref(false)
const bottom = computed<Colour>(() => orientation(view.value.you, flipped.value))
const top = computed<Colour>(() => (bottom.value === 'w' ? 'b' : 'w'))
const order = computed(() => displayOrder(bottom.value))
const seatOfColour = (colour: Colour): number => (colour === 'w' ? view.value.white : 1 - view.value.white)
const opponentSeat = computed(() => (view.value.you === null ? null : seats.value[seatOfColour(view.value.you === 'w' ? 'b' : 'w')] ?? null))
const againstBot = computed(() => opponentSeat.value?.bot === true)
const level = computed(() => {
  const value = props.state.table.options.level
  return typeof value === 'string' && value ? value.charAt(0).toUpperCase() + value.slice(1) : ''
})

// ---- the board -----------------------------------------------------------------------------------
const selected = ref<string | null>(null)
const promotion = ref<{ from: string; to: string } | null>(null)
const focusSquare = ref(homeSquare(bottom.value))
const boardEl = ref<HTMLElement | null>(null)
const promoEl = ref<HTMLElement | null>(null)
const destinations = computed(() => (selected.value && myTurn.value ? destinationsFrom(view.value, selected.value) : []))
const lastSquares = computed(() => new Set(view.value.last ? [view.value.last.from, view.value.last.to] : []))
const mine = (square: string): boolean => pieceAt(view.value, square)?.[0] === view.value.you

interface Cell { square: string; code: string | null; light: boolean; label: string; selected: boolean; dest: boolean; capture: boolean; last: boolean; check: boolean; own: boolean; rank: string; file: string }
const rows = computed<Cell[][]>(() => {
  const cells = order.value.map((index, at): Cell => {
    const square = squareName(index), code = view.value.board[index] ?? null
    const isSelected = selected.value === square, dest = destinations.value.includes(square)
    const last = lastSquares.value.has(square), check = view.value.check === square
    return {
      square, code, light: isLight(index), selected: isSelected, dest, last, check, own: myTurn.value && mine(square), capture: dest && selected.value !== null && isCapture(view.value, selected.value, square),
      label: squareLabel(square, code, { selected: isSelected, legal: dest, last, check }),
      rank: (at & 7) === 0 ? square.slice(1) : '', file: at >> 3 === 7 ? square.slice(0, 1) : '',
    }
  })
  return Array.from({ length: 8 }, (_, row) => cells.slice(row * 8, row * 8 + 8))
})

function attempt(from: string, to: string): void {
  selected.value = null
  if (needsPick(from, to)) promotion.value = { from, to }
  else emit('play', { t: 'move', from, to })
}
const needsPick = (from: string, to: string): boolean => view.value.legal.some((move) => move.from === from && move.to === to && move.promo !== undefined)
function choosePromotion(promo: Promo): void {
  const pending = promotion.value
  promotion.value = null
  if (pending) emit('play', { t: 'move', from: pending.from, to: pending.to, promo })
}
function cancel(): void {
  promotion.value = null
  selected.value = null
}
/** A tap on a square: select, change the selection, deselect or move. */
function tap(square: string): void {
  focusSquare.value = square
  if (!myTurn.value || promotion.value) return
  if (selected.value === square) selected.value = null
  else if (selected.value && destinations.value.includes(square)) attempt(selected.value, square)
  else selected.value = mine(square) ? square : null
}

// Dragging: the pointer is captured by the board; a move of a few pixels turns a press into a drag.
interface Press { id: number; square: string; x: number; y: number; moved: boolean }
const press = ref<Press | null>(null)
const ghost = ref<{ x: number; y: number; code: string } | null>(null)
const hover = ref<string | null>(null)
const DRAG_AFTER = 6
const squareAt = (event: PointerEvent): string | null => {
  const rect = boardEl.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return null
  const column = Math.floor(((event.clientX - rect.left) / rect.width) * 8), row = Math.floor(((event.clientY - rect.top) / rect.height) * 8)
  if (column < 0 || column > 7 || row < 0 || row > 7) return null
  return squareName(order.value[row * 8 + column] as number)
}
function pressDown(event: PointerEvent): void {
  if (!myTurn.value || promotion.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  const square = squareAt(event)
  if (!square) return
  press.value = { id: event.pointerId, square, x: event.clientX, y: event.clientY, moved: false }
  boardEl.value?.setPointerCapture(event.pointerId)
}
function pressMove(event: PointerEvent): void {
  const current = press.value, rect = boardEl.value?.getBoundingClientRect()
  if (!current || current.id !== event.pointerId || !rect) return
  const code = pieceAt(view.value, current.square)
  if (!current.moved) {
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_AFTER || !code || !mine(current.square)) return
    current.moved = true
    selected.value = current.square
    focusSquare.value = current.square
  }
  if (code) ghost.value = { x: event.clientX - rect.left, y: event.clientY - rect.top, code }
  hover.value = squareAt(event)
}
function pressUp(event: PointerEvent): void {
  const current = press.value
  if (!current || current.id !== event.pointerId) return
  const target = squareAt(event)
  press.value = null; ghost.value = null; hover.value = null
  if (boardEl.value?.hasPointerCapture(event.pointerId)) boardEl.value.releasePointerCapture(event.pointerId)
  if (!current.moved) { if (target === current.square) tap(target); return }
  if (target && target !== current.square && destinationsFrom(view.value, current.square).includes(target)) attempt(current.square, target)
  else selected.value = null
}
function pressCancel(): void {
  press.value = null; ghost.value = null; hover.value = null
}

// Keyboard: arrows move the focus, Enter and Space act as a tap, Escape lets go.
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
async function onKey(event: KeyboardEvent): Promise<void> {
  const step = ARROWS[event.key]
  if (step) {
    event.preventDefault()
    const next = stepSquare(focusSquare.value, bottom.value, step[0], step[1])
    if (!next) return
    focusSquare.value = next
    await nextTick()
    boardEl.value?.querySelector<HTMLElement>(`[data-sq="${next}"]`)?.focus()
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    tap(focusSquare.value)
  } else if (event.key === 'Escape') cancel()
}
watch(promotion, async (value) => {
  if (!value) return
  await nextTick()
  promoEl.value?.querySelector<HTMLElement>('button')?.focus()
})
// A new position drops what was half done (a selection, a picker) when it is no longer your move.
watch(() => props.state.n, () => { if (!myTurn.value) cancel(); else if (selected.value && destinationsFrom(view.value, selected.value).length === 0) selected.value = null })
watch(bottom, (colour) => { focusSquare.value = homeSquare(colour) })

// ---- clocks --------------------------------------------------------------------------------------
const receivedAt = ref(Date.now())
const localNow = ref(receivedAt.value)
const mounted = ref(false)
watch(() => [props.state.n, props.state.clock?.deadline, props.state.clock?.now], () => { receivedAt.value = Date.now(); localNow.value = receivedAt.value })
const timed = computed(() => view.value.clocks !== null)
const ticking = computed(() => props.state.clock !== null && !over.value)
onMounted(() => { mounted.value = true })
watchEffect((onCleanup) => {
  if (!mounted.value || !ticking.value) return
  const id = setInterval(() => { localNow.value = Date.now() }, 250)
  onCleanup(() => clearInterval(id))
})
interface ClockFace { text: string; low: boolean; live: boolean; note: string }
function clockFace(colour: Colour): ClockFace | null {
  const clock = props.state.clock
  const mover = view.value.turn === colour && !over.value
  if (timed.value) {
    const ms = remainingFor(colour, view.value, clock, localNow.value, receivedAt.value)
    return ms === null ? null : { text: clockText(ms), low: ms < 10000, live: mover && ticking.value, note: '' }
  }
  if (!mover || !clock) return null
  const ms = turnLeft(clock, localNow.value, receivedAt.value)
  return { text: clockText(ms), low: ms < 10000, live: ticking.value, note: '3 min a move' }
}

// ---- the bars, the list and the words --------------------------------------------------------------
interface Bar { colour: Colour; name: string; bot: boolean; you: boolean; pieces: string[]; lead: number; words: string; clock: ClockFace | null; turn: boolean }
const bar = (colour: Colour): Bar => {
  const seat = seats.value[seatOfColour(colour)]
  const pieces = sortCaptured(view.value.captured[colour])
  return { colour, name: sides.value[colour], bot: seat?.bot === true, you: view.value.you === colour, pieces, lead: materialLead(view.value, colour), words: capturedWords(pieces), clock: clockFace(colour), turn: view.value.turn === colour && !over.value }
}
const topBar = computed(() => bar(top.value))
const bottomBar = computed(() => bar(bottom.value))
const pairs = computed(() => pairMoves(view.value.history))
const lastPly = computed(() => view.value.history.length - 1)
const status = computed(() => props.state.result?.calledOff ? 'Game called off' : statusText(view.value, sides.value))
const banner = computed(() => props.state.result?.calledOff ? 'Game called off' : view.value.over ? overBanner(view.value.over) : '')
const listEl = ref<HTMLElement | null>(null)
watch(() => view.value.history.length, async () => {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}, { flush: 'post' })
onMounted(() => { if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight })

// What a screen reader hears of the other side's move, and the event the sound layer listens for.
const heard = ref('')
let seen: Seen | null = null
watch(() => [props.state.n, view.value.history.length, view.value.over], () => {
  const event = nextEvent(seen, view.value)
  const before = seen
  seen = seenOf(view.value)
  if (!event || !before) return
  const added = view.value.history.length > before.moves
  const mover: Colour = view.value.history.length % 2 === 1 ? 'w' : 'b'
  if (added && mover !== view.value.you) heard.value = `${sides.value[mover]} played ${sanWords(view.value.history[view.value.history.length - 1] as string)}.`
  else if (!added) heard.value = banner.value
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('jaw:table', { detail: { game: 'chess', event } }))
}, { flush: 'post' })
seen = seenOf(view.value)

// ---- the controls ----------------------------------------------------------------------------------
const playing = computed(() => seated.value && !over.value)
const offerFromThem = computed(() => view.value.drawOffer !== null && view.value.drawOffer !== view.value.you)
const offerFromMe = computed(() => view.value.drawOffer !== null && view.value.drawOffer === view.value.you)
const armed = ref(false)
let disarm: ReturnType<typeof setTimeout> | undefined
function resign(): void {
  if (!armed.value) {
    armed.value = true
    disarm = setTimeout(() => { armed.value = false }, 3000)
    return
  }
  clearTimeout(disarm)
  armed.value = false
  emit('play', { t: 'resign' })
}
onBeforeUnmount(() => clearTimeout(disarm))
</script>

<template>
  <section class="cb" aria-label="Chess">
    <div class="cb-main">
      <div class="cb-bar" :class="{ 'is-turn': topBar.turn }">
        <span class="cb-who"><b>{{ topBar.name }}</b><small v-if="topBar.you"> (you)</small></span>
        <BaseChip v-if="topBar.bot">Computer{{ level ? `, ${level}` : '' }}</BaseChip>
        <span class="cb-taken" :aria-label="`Captured: ${topBar.words}`"><i v-for="(piece, at) in topBar.pieces" :key="at" v-html="pieceSvg(piece)" /><em v-if="topBar.lead > 0">+{{ topBar.lead }}</em></span>
        <span v-if="topBar.clock" class="cb-clock" :class="{ 'is-low': topBar.clock.low, 'is-live': topBar.clock.live }"><small v-if="topBar.clock.note">{{ topBar.clock.note }}</small>{{ topBar.clock.text }}</span>
      </div>

      <div class="cb-boardwrap">
        <div
          ref="boardEl" class="cb-board" role="grid" aria-label="Chess board" :class="{ 'is-live': myTurn }"
          @pointerdown="pressDown" @pointermove="pressMove" @pointerup="pressUp" @pointercancel="pressCancel" @keydown="onKey"
        >
          <div v-for="(row, at) in rows" :key="at" class="cb-row" role="row">
            <div
              v-for="cell in row" :key="cell.square" class="cb-sq" role="gridcell" :data-sq="cell.square" :aria-label="cell.label" :aria-selected="cell.selected"
              :tabindex="cell.square === focusSquare ? 0 : -1"
              :class="{ 'is-light': cell.light, 'is-dark': !cell.light, 'is-selected': cell.selected, 'is-dest': cell.dest && !cell.capture, 'is-capture': cell.capture, 'is-last': cell.last, 'is-check': cell.check, 'is-own': cell.own, 'is-drop': hover === cell.square && cell.dest, 'is-lifted': ghost !== null && press?.square === cell.square }"
              @focus="focusSquare = cell.square"
            >
              <span v-if="cell.rank" class="cb-rank" aria-hidden="true">{{ cell.rank }}</span>
              <span v-if="cell.file" class="cb-file" aria-hidden="true">{{ cell.file }}</span>
              <span v-if="cell.code" class="cb-piece" aria-hidden="true" v-html="pieceSvg(cell.code)" />
            </div>
          </div>
          <span v-if="ghost" class="cb-ghost" aria-hidden="true" :style="{ left: `${ghost.x}px`, top: `${ghost.y}px` }" v-html="pieceSvg(ghost.code)" />
        </div>
        <p v-if="banner" class="cb-banner" role="status">{{ banner }}</p>
        <div v-if="promotion" class="cb-scrim" @click.self="cancel" @keydown.esc.stop="cancel">
          <div ref="promoEl" class="cb-promo" role="group" aria-label="Promote the pawn to">
            <button v-for="choice in PROMOTIONS" :key="choice.promo" type="button" class="cb-pick" :aria-label="choice.name" @click="choosePromotion(choice.promo)">
              <span aria-hidden="true" v-html="pieceSvg(`${bottom === 'w' ? 'w' : 'b'}${choice.kind}`)" />
              <small>{{ choice.name }}</small>
            </button>
          </div>
        </div>
      </div>

      <div class="cb-bar" :class="{ 'is-turn': bottomBar.turn }">
        <span class="cb-who"><b>{{ bottomBar.name }}</b><small v-if="bottomBar.you"> (you)</small></span>
        <BaseChip v-if="bottomBar.bot">Computer{{ level ? `, ${level}` : '' }}</BaseChip>
        <span class="cb-taken" :aria-label="`Captured: ${bottomBar.words}`"><i v-for="(piece, at) in bottomBar.pieces" :key="at" v-html="pieceSvg(piece)" /><em v-if="bottomBar.lead > 0">+{{ bottomBar.lead }}</em></span>
        <span v-if="bottomBar.clock" class="cb-clock" :class="{ 'is-low': bottomBar.clock.low, 'is-live': bottomBar.clock.live }"><small v-if="bottomBar.clock.note">{{ bottomBar.clock.note }}</small>{{ bottomBar.clock.text }}</span>
      </div>
    </div>

    <div class="cb-side">
      <p class="cb-status">{{ status }}</p>
      <p class="cb-hear" aria-live="polite">{{ heard }}</p>
      <ol ref="listEl" class="cb-moves" aria-label="Moves">
        <li v-for="pair in pairs" :key="pair.number">
          <span class="cb-no">{{ pair.number }}.</span>
          <span :class="{ 'is-last': pair.whiteAt === lastPly }">{{ pair.white }}</span>
          <span v-if="pair.black !== null" :class="{ 'is-last': pair.blackAt === lastPly }">{{ pair.black }}</span>
        </li>
        <li v-if="pairs.length === 0" class="cb-none">No moves yet</li>
      </ol>
      <div class="cb-controls">
        <BaseButton @click="flipped = !flipped">Flip board</BaseButton>
        <template v-if="playing">
          <template v-if="offerFromThem">
            <BaseButton variant="primary" @click="emit('play', { t: 'accept-draw' })">Accept draw</BaseButton>
            <BaseButton @click="emit('play', { t: 'decline-draw' })">Decline</BaseButton>
          </template>
          <BaseButton v-else-if="!againstBot" :disabled="offerFromMe" @click="emit('play', { t: 'offer-draw' })">{{ offerFromMe ? 'Draw offered' : 'Offer draw' }}</BaseButton>
          <BaseButton variant="danger" @click="resign">{{ armed ? 'Tap again to resign' : 'Resign' }}</BaseButton>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cb { container-type: inline-size; display: grid; gap: var(--s-3); margin: 0 0 var(--s-3); min-width: 0; }
.cb-main { display: grid; gap: var(--s-2); width: 100%; max-width: 520px; min-width: 0; }
.cb-side { display: grid; gap: var(--s-2); min-width: 0; align-content: start; }
@container (min-width: 760px) {
  .cb { grid-template-columns: minmax(0, 520px) minmax(220px, 1fr); align-items: start; }
  .cb-moves { max-height: 320px; }
}
.cb-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px var(--s-2); padding: 6px 10px; min-height: 44px; border-radius: var(--r-sm); background: var(--c-fill); border: 2px solid transparent; }
.cb-bar.is-turn { border-color: var(--c-amber); background: var(--c-amber-soft); }
.cb-who { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-who small { color: var(--c-muted); font-weight: 600; }
.cb-taken { display: inline-flex; align-items: center; flex: 1 1 auto; min-width: 0; flex-wrap: wrap; }
.cb-taken i { display: block; width: 18px; height: 18px; margin-right: -6px; }
.cb-taken i :deep(svg) { width: 100%; height: 100%; display: block; }
.cb-taken em { margin-left: 10px; font-style: normal; font-size: 12px; font-weight: 800; color: var(--c-ink-2); }
.cb-clock { margin-left: auto; font: 800 18px var(--font); font-variant-numeric: tabular-nums; padding: 2px 10px; border-radius: var(--r-xs); background: var(--c-surface-solid); color: var(--c-ink); display: inline-flex; align-items: baseline; gap: 6px; }
.cb-clock small { font-size: 11px; font-weight: 700; color: var(--c-muted); }
.cb-clock.is-live { background: var(--c-night); color: #fff; }
.cb-clock.is-low { background: var(--c-red); color: #fff; }
.cb-boardwrap { position: relative; }
.cb-board { position: relative; display: grid; grid-template-rows: repeat(8, 1fr); width: 100%; border-radius: var(--r-xs); overflow: hidden; box-shadow: 0 0 0 3px #3f5d49; user-select: none; -webkit-user-select: none; touch-action: manipulation; }
.cb-row { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); }
.cb-sq { position: relative; aspect-ratio: 1; min-width: 0; display: grid; place-items: stretch; }
.cb-sq.is-light { background: #f0e8cc; color: #5b7f5e; }
.cb-sq.is-dark { background: #6e9a6c; color: #f0e8cc; }
.cb-sq.is-own { touch-action: none; cursor: grab; }
.cb-sq.is-last::before { content: ''; position: absolute; inset: 0; background: rgba(245, 196, 66, .5); }
.cb-sq.is-check::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at center, rgba(220, 38, 38, .95) 0, rgba(220, 38, 38, .6) 40%, rgba(220, 38, 38, 0) 75%); }
.cb-sq.is-selected { box-shadow: inset 0 0 0 3px var(--c-green-dark); }
.cb-sq.is-selected::before { content: ''; position: absolute; inset: 0; background: rgba(47, 168, 102, .35); }
.cb-sq.is-dest::after { content: ''; position: absolute; left: 36%; top: 36%; width: 28%; height: 28%; border-radius: 50%; background: rgba(27, 43, 33, .38); }
.cb-sq.is-capture::after { content: ''; position: absolute; inset: 4%; border-radius: 50%; border: 5px solid rgba(27, 43, 33, .38); box-sizing: border-box; }
.cb-sq.is-drop { box-shadow: inset 0 0 0 3px var(--c-blue); }
.cb-sq:focus-visible { outline: 3px solid var(--c-blue); outline-offset: -3px; z-index: 2; }
.cb-rank, .cb-file { position: absolute; font-size: 10px; font-weight: 800; line-height: 1; pointer-events: none; z-index: 1; }
.cb-rank { top: 3px; left: 3px; }
.cb-file { bottom: 2px; right: 3px; }
.cb-piece { position: relative; display: block; width: 100%; height: 100%; padding: 4%; box-sizing: border-box; pointer-events: none; }
.cb-piece :deep(svg), .cb-ghost :deep(svg), .cb-pick :deep(svg) { width: 100%; height: 100%; display: block; }
.cb-sq.is-lifted .cb-piece { opacity: .35; }
.cb-ghost { position: absolute; width: 12.5%; aspect-ratio: 1; transform: translate(-50%, -62%) scale(1.2); pointer-events: none; z-index: 5; filter: drop-shadow(0 4px 5px rgba(0, 0, 0, .35)); }
.cb-banner { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); margin: 0; padding: 4px 14px; border-radius: var(--r-pill); background: var(--c-night); color: #fff; font-size: 13px; font-weight: 800; white-space: nowrap; pointer-events: none; z-index: 6; }
.cb-scrim { position: absolute; inset: 0; background: rgba(20, 30, 24, .55); display: grid; place-items: center; z-index: 7; border-radius: var(--r-xs); }
.cb-promo { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 8px; width: min(92%, 380px); background: var(--c-surface-solid); border-radius: var(--r-md); box-shadow: var(--e-3); }
.cb-pick { display: grid; justify-items: center; gap: 2px; min-height: 64px; padding: 4px; border: 2px solid var(--c-line); border-radius: var(--r-sm); background: #f0e8cc; font: 700 11px var(--font); color: var(--c-ink); cursor: pointer; }
.cb-pick:hover, .cb-pick:focus-visible { border-color: var(--c-green-dark); outline: none; background: var(--c-green-soft); }
.cb-pick span { display: block; width: 44px; height: 44px; }
.cb-status { margin: 0; font-size: 15px; font-weight: 800; min-height: 22px; }
.cb-hear { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.cb-moves { list-style: none; margin: 0; padding: 6px 8px; display: flex; flex-wrap: wrap; gap: 2px 14px; max-height: 96px; overflow-y: auto; overscroll-behavior: contain; border-radius: var(--r-sm); background: var(--c-fill); font-size: 13px; font-variant-numeric: tabular-nums; }
.cb-moves li { display: inline-flex; gap: 6px; }
.cb-moves li span { padding: 1px 4px; border-radius: 6px; }
.cb-moves .cb-no { color: var(--c-muted); padding-right: 0; }
.cb-moves .is-last { background: var(--c-amber); color: var(--c-ink); font-weight: 800; }
.cb-none { color: var(--c-muted); }
.cb-controls { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.cb-controls > * { flex: 1 1 120px; min-height: 44px; }
@media (prefers-reduced-motion: no-preference) {
  .cb-sq { transition: background-color .15s; }
  .cb-bar { transition: background-color .2s, border-color .2s; }
}
@media (prefers-reduced-motion: reduce) {
  .cb-ghost { transform: translate(-50%, -62%); }
}
</style>
