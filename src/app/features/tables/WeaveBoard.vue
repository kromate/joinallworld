<script setup lang="ts">
// The Weave table: the scores, the 13 by 13 cloth, your rack and the buttons to play. It draws what
// the server's view holds and sends a move when Play, Swap, Pass or Resign is pressed. The server
// decides whether a play is allowed (the words); this screen only checks the shape and works out the
// score with the same board functions, so you see what a play is worth before you make it.
//
// Laying tiles: tap a rack tile and tap an empty square, or drag a tile there (a ghost follows the
// finger). A tile laid down for now can be tapped to go back, dragged to another square, or dragged
// onto the rack. By keyboard: 1 to 7 pick a tile, the arrow keys move over the cloth, Enter lays it,
// Escape lets go. Every square is a real button; Zoom makes them finger-sized in a scrolling window.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import BaseButton from '../../ui/BaseButton.vue'
import BoardClock from './BoardClock.vue'
import { clockBar, nameAt, plain } from './tablesModel.ts'
import {
  ALPHABET, historyLines, isCentre, moveTile, newDraft, newSquares, nextEvent, placeTile, placedAt, premiumClass, premiumShort, preview, recallAll,
  recallTile, restingRack, results, scoreRows, setBlankLetter, shuffleRack, spokenTurn, squareLabel, squareName, statusLine, swapReason, syncDraft, toPlay, toSwap, toggleSwap,
  unsetBlank,
} from './weaveModel.ts'
import type { Draft, Square } from './weaveModel.ts'
import { SIZE, cellAt, isBlankTile, tileValue } from '../../../tables/weave-board.ts'
import type { WeaveMove, WeaveState } from './tablesBoundary.ts'

const props = defineProps<{
  state: WeaveState
  /** The server time at this draw, for the turn clock. */
  now: number
}>()
const emit = defineEmits<{ play: [move: WeaveMove] }>()

interface Cell {
  r: number; c: number; key: string; ch: string; value: number; blank: boolean; tentative: boolean; last: boolean
  prem: string; short: string; centre: boolean; label: string
}
interface Drag { id: number; rackIndex: number; from: Square | null; ch: string; value: number; blank: boolean; startX: number; startY: number; x: number; y: number; active: boolean }

const view = computed(() => props.state.view)
const seats = computed(() => props.state.table.seats)
const me = computed(() => props.state.you)
const over = computed(() => view.value.over !== null || props.state.table.status === 'over')
const playing = computed(() => me.value !== null && !over.value && view.value.rack !== null && !view.value.out[me.value])
const myTurn = computed(() => playing.value && view.value.turn === me.value)
const rack = computed(() => view.value.rack ?? [])
const clock = computed(() => clockBar(props.state, props.now))

const draft = ref<Draft>(newDraft(view.value.rack))
const selected = ref<number | null>(null)
const focus = ref<Square>({ r: 6, c: 6 })
const zoom = ref(false)
const swapping = ref(false)
const swapPicked = ref<number[]>([])
const armed = ref(false)
const said = ref('')
const lastMove = ref<string[]>([])
const sentAt = ref<number | null>(null)
const drag = ref<Drag | null>(null)
const boardEl = ref<HTMLElement | null>(null)
let previousN: number | null = null
let previousBoard: string[] | null = null
let wasOver = false
let swallowClick = false
let sentTimer: ReturnType<typeof setTimeout> | undefined

const say = (text: string): void => { said.value = said.value === text ? `${text} ` : text }
const announceEvent = (event: string): void => { try { window.dispatchEvent(new CustomEvent('jaw:table', { detail: { game: 'weave', event } })) } catch { /* no listener is fine */ } }

/** A new draw: remember the last move, tell the world about it once, and keep the tentative tiles in step with the board. */
function arrived(): void {
  const now = view.value
  const event = nextEvent(previousN, props.state.n, now, wasOver)
  if (previousN !== null && props.state.n !== previousN) {
    lastMove.value = newSquares(previousBoard, now.board)
    const last = now.history.at(-1)
    if (last && last.seat !== me.value) say(spokenTurn(last, seats.value))
    if (now.over && !wasOver) say(results(now, seats.value)?.text ?? 'Game over.')
    sentAt.value = null
    armed.value = false
    swapping.value = false
    swapPicked.value = []
  }
  const next = syncDraft(draft.value, now)
  if (next.rackKey !== draft.value.rackKey) { selected.value = null; swapPicked.value = []; swapping.value = false }
  draft.value = next
  if (event) announceEvent(event)
  previousN = props.state.n
  previousBoard = now.board
  wasOver = now.over !== null
}
arrived()
watch(() => props.state, arrived)
onBeforeUnmount(() => clearTimeout(sentTimer))

// ---- what is drawn ------------------------------------------------------------------------------
const rows = computed<Cell[][]>(() => Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c): Cell => {
  const tent = placedAt(draft.value, r, c)
  const onBoard = cellAt(view.value.board, r, c)
  const ch = tent ? tent.letter : onBoard === '.' ? '' : onBoard.toLowerCase()
  const blank = tent ? Boolean(tent.blank) : isBlankTile(onBoard)
  const key = `${r},${c}`
  return {
    r, c, key, ch, blank, value: !ch || blank ? 0 : tileValue(ch), tentative: Boolean(tent), last: lastMove.value.includes(key) && !tent,
    prem: premiumClass(r, c), short: premiumShort(r, c), centre: isCentre(r, c), label: squareLabel(view.value.board, draft.value, r, c),
  }
})))
const pv = computed(() => preview(view.value, draft.value))
const status = computed(() => statusLine(view.value, seats.value, me.value))
const score = computed(() => scoreRows(view.value, seats.value, me.value))
const history = computed(() => historyLines(view.value, seats.value))
const done = computed(() => results(view.value, seats.value))
const resting = computed(() => restingRack(draft.value).map((index) => {
  const letter = rack.value[index] ?? '?'
  return { index, letter, blank: letter === '?', value: letter === '?' ? 0 : tileValue(letter) }
}))
const blankWaiting = computed(() => unsetBlank(draft.value))
const sent = computed(() => sentAt.value === props.state.n)
const turnWhy = computed(() => (!playing.value ? 'You are watching.' : !myTurn.value ? 'Wait for your turn.' : sent.value ? 'Sent. Waiting for the table.' : null))
const playWhy = computed(() => turnWhy.value ?? (pv.value.ok ? null : pv.value.text))
const swapWhy = computed(() => (!playing.value ? 'You are watching.' : sent.value ? 'Sent. Waiting for the table.' : swapReason(view.value, myTurn.value)))
const passWhy = computed(() => turnWhy.value)
const tileName = (letter: string): string => (letter === '?' ? 'Blank, 0 points' : `${letter.toUpperCase()}, ${plain(tileValue(letter), 'point')}`)

// ---- laying tiles -------------------------------------------------------------------------------
function show(square: Square): void {
  focus.value = square
  void nextTick(() => {
    const el = boardEl.value?.querySelector<HTMLElement>(`[data-sq="${square.r},${square.c}"]`)
    if (!el) return
    el.focus({ preventScroll: true })
    if (zoom.value) { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }) } catch { /* a browser without it keeps the scroll */ } }
  })
}
function pick(index: number): void {
  if (!playing.value || swapping.value) return
  if (selected.value === index) { selected.value = null; return }
  selected.value = index
  say(`${tileName(rack.value[index] ?? '?')} selected. Move to a square and press Enter.`)
}
function lay(index: number, r: number, c: number): void {
  const next = placeTile(draft.value, view.value.board, rack.value, index, r, c)
  if (next === draft.value) { say(`${squareName(r, c)} is not free.`); return }
  draft.value = next
  selected.value = null
  show({ r, c })
}
function onRack(index: number): void {
  if (swallowClick) return
  if (swapping.value) { swapPicked.value = toggleSwap(swapPicked.value, index); return }
  pick(index)
}
function onSquare(r: number, c: number): void {
  focus.value = { r, c }
  if (swallowClick) return
  if (placedAt(draft.value, r, c)) { draft.value = recallTile(draft.value, r, c); say(`${squareName(r, c)} back in your rack.`); return }
  if (!playing.value || swapping.value) return
  if (selected.value === null) { say('Pick a tile from your rack first.'); return }
  lay(selected.value, r, c)
}
function letterFor(letter: string): void {
  const tile = blankWaiting.value
  if (!tile) return
  draft.value = setBlankLetter(draft.value, tile.r, tile.c, letter)
  say(`Blank is ${letter.toUpperCase()}.`)
  show({ r: tile.r, c: tile.c })
}
const shuffle = (): void => { draft.value = shuffleRack(draft.value, Math.random) }
const recall = (): void => { draft.value = recallAll(draft.value); selected.value = null }

function onKeys(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'Escape') { selected.value = null; swapping.value = false; armed.value = false; return }
  if (/^[1-7]$/.test(event.key) && !(event.target instanceof HTMLInputElement)) {
    const tile = resting.value[Number(event.key) - 1]
    if (tile) { event.preventDefault(); if (swapping.value) swapPicked.value = toggleSwap(swapPicked.value, tile.index); else pick(tile.index) }
  }
}
function onGridKeys(event: KeyboardEvent): void {
  const step: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
  const at = focus.value
  let next: Square | null = null
  const move = step[event.key]
  if (move) next = { r: Math.min(SIZE - 1, Math.max(0, at.r + move[0])), c: Math.min(SIZE - 1, Math.max(0, at.c + move[1])) }
  else if (event.key === 'Home') next = { r: at.r, c: 0 }
  else if (event.key === 'End') next = { r: at.r, c: SIZE - 1 }
  else if (event.key === 'PageUp') next = { r: 0, c: at.c }
  else if (event.key === 'PageDown') next = { r: SIZE - 1, c: at.c }
  if (!next) return
  event.preventDefault()
  show(next)
}

// ---- dragging -----------------------------------------------------------------------------------
function down(event: PointerEvent, rackIndex: number, from: Square | null, ch: string, value: number, blank: boolean): void {
  if (!playing.value || swapping.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) } catch { /* a drag without capture still ends on release */ }
  drag.value = { id: event.pointerId, rackIndex, from, ch, value, blank, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false }
}
const downRack = (event: PointerEvent, index: number): void => {
  const letter = rack.value[index] ?? '?'
  down(event, index, null, letter === '?' ? '' : letter, letter === '?' ? 0 : tileValue(letter), letter === '?')
}
function downCell(event: PointerEvent, cell: Cell): void {
  const tile = placedAt(draft.value, cell.r, cell.c)
  if (tile) down(event, tile.rackIndex, { r: cell.r, c: cell.c }, cell.ch, cell.value, cell.blank)
}
function moveDrag(event: PointerEvent): void {
  const d = drag.value
  if (!d || d.id !== event.pointerId) return
  const far = Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 6
  drag.value = { ...d, x: event.clientX, y: event.clientY, active: d.active || far }
}
function endDrag(event: PointerEvent): void {
  const d = drag.value
  drag.value = null
  if (!d || d.id !== event.pointerId || !d.active) return
  swallowClick = true
  setTimeout(() => { swallowClick = false }, 0)
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  const square = hit?.closest<HTMLElement>('[data-sq]')
  if (square?.dataset.sq) {
    const [r, c] = square.dataset.sq.split(',').map(Number)
    if (r === undefined || c === undefined) return
    if (d.from) { draft.value = moveTile(draft.value, view.value.board, d.from, { r, c }); show({ r, c }) } else lay(d.rackIndex, r, c)
  } else if (hit?.closest('[data-rack]') && d.from) draft.value = recallTile(draft.value, d.from.r, d.from.c)
}
const cancelDrag = (): void => { drag.value = null }

// ---- the moves ----------------------------------------------------------------------------------
function send(move: WeaveMove): void {
  emit('play', move)
  sentAt.value = props.state.n
  clearTimeout(sentTimer)
  sentTimer = setTimeout(() => { sentAt.value = null }, 4000)
}
const play = (): void => { if (!playWhy.value) send(toPlay(draft.value)) }
const pass = (): void => { if (!passWhy.value) send({ t: 'pass' }) }
function openSwap(): void {
  if (swapWhy.value) return
  draft.value = recallAll(draft.value)
  selected.value = null
  swapPicked.value = []
  swapping.value = !swapping.value
}
function swap(): void {
  if (swapWhy.value || !swapPicked.value.length) return
  send(toSwap(rack.value, swapPicked.value))
  swapping.value = false
}
function resign(): void {
  if (!armed.value) { armed.value = true; return }
  armed.value = false
  emit('play', { t: 'resign' })
}
</script>

<template>
  <div class="wv" @keydown="onKeys">
  <div class="wv-in">
    <section class="wv-head" aria-label="Scores">
      <ul v-if="seats.length" class="wv-score">
        <li v-for="row in score" :key="row.seat" :class="{ 'is-turn': row.active, 'is-you': row.you }">
          <span class="wv-marker" aria-hidden="true">{{ row.active ? '▶' : '' }}</span>
          <b class="wv-name">{{ row.name }}<span v-if="row.bot" class="wv-bot"> (bot)</span><span v-if="row.you" class="wv-you"> · you</span></b>
          <span class="wv-points">{{ row.score }}<span class="wv-sr"> points</span></span>
          <span class="wv-count">{{ row.out ? 'left the game' : plain(row.tiles, 'tile') }}<span v-if="row.active" class="wv-sr"> · to play</span></span>
        </li>
      </ul>
      <p v-if="me === null" class="wv-watch">You are watching</p>
      <p class="wv-status" role="status">{{ status }}</p>
      <BoardClock v-if="clock && !over" :seconds="clock.seconds" :from="clock.from" :n="state.n" :restart="clock.key" />
    </section>

    <section class="wv-cloth" aria-label="The board">
      <div class="wv-view" :class="{ 'is-zoom': zoom }">
        <div ref="boardEl" class="wv-grid" role="grid" aria-label="Weave board, 13 by 13 squares" @keydown="onGridKeys">
          <div v-for="(row, r) in rows" :key="r" class="wv-row" role="row">
            <button
              v-for="cell in row" :key="cell.key" type="button" role="gridcell" class="wv-cell" :data-sq="cell.key" :aria-label="cell.label"
              :tabindex="focus.r === cell.r && focus.c === cell.c ? 0 : -1"
              :class="[cell.prem, { 'has-tile': cell.ch, 'is-tentative': cell.tentative, 'is-last': cell.last, 'is-blank': cell.blank && cell.ch, 'is-centre': cell.centre && !cell.ch }]"
              @click="onSquare(cell.r, cell.c)" @pointerdown="downCell($event, cell)" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag"
            >
              <template v-if="cell.ch">
                <span class="wv-letter" aria-hidden="true">{{ cell.ch.toUpperCase() }}</span><span class="wv-value" aria-hidden="true">{{ cell.value }}</span>
              </template>
              <span v-else-if="cell.centre" class="wv-star" aria-hidden="true">★</span>
              <span v-else-if="cell.short" class="wv-prem" aria-hidden="true">{{ cell.short }}</span>
            </button>
          </div>
        </div>
      </div>
      <div class="wv-tools">
        <button class="wv-chip" type="button" :aria-pressed="zoom" @click="zoom = !zoom">{{ zoom ? 'Fit the board' : 'Zoom' }}</button>
        <span class="wv-bag">Bag: {{ plain(view.bagCount, 'tile') }}</span>
      </div>
      <p class="wv-preview" :class="{ 'is-ok': pv.ok, 'is-bad': !pv.ok && draft.placed.length > 0 }">{{ pv.text }}</p>
    </section>

    <section class="wv-dock" aria-label="Your tiles">
      <template v-if="playing">
        <div v-if="blankWaiting" class="wv-picker" role="group" aria-label="Choose a letter for the blank">
          <p>Choose the letter this blank stands for</p>
          <div class="wv-letters">
            <button v-for="letter in ALPHABET" :key="letter" type="button" class="wv-pick" :aria-label="letter.toUpperCase()" @click="letterFor(letter)">{{ letter.toUpperCase() }}</button>
          </div>
        </div>
        <div class="wv-rack" data-rack role="group" aria-label="Your rack. Press 1 to 7 to pick a tile.">
          <button
            v-for="(tile, position) in resting" :key="tile.index" type="button" class="wv-tile"
            :class="{ 'is-selected': selected === tile.index, 'is-ticked': swapPicked.includes(tile.index), 'is-blank': tile.blank }"
            :aria-pressed="swapping ? swapPicked.includes(tile.index) : selected === tile.index" :aria-label="`${position + 1}: ${tileName(tile.letter)}`"
            @click="onRack(tile.index)" @pointerdown="downRack($event, tile.index)" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="cancelDrag"
          >
            <span class="wv-letter" aria-hidden="true">{{ tile.blank ? '' : tile.letter.toUpperCase() }}</span><span class="wv-value" aria-hidden="true">{{ tile.value }}</span>
          </button>
          <span v-if="!resting.length" class="wv-empty">All your tiles are on the board.</span>
        </div>
        <div class="wv-small">
          <button class="wv-chip" type="button" :disabled="resting.length < 2" @click="shuffle">Shuffle</button>
          <button class="wv-chip" type="button" :disabled="!draft.placed.length" @click="recall">Recall</button>
        </div>
        <div v-if="swapping" class="wv-swap" role="group" aria-label="Swap tiles">
          <p>Tick the tiles to swap for new ones. Your turn ends.</p>
          <div class="wv-acts">
            <BaseButton variant="primary" small :reason="swapPicked.length ? null : 'Tick at least one tile.'" @click="swap">Swap {{ plain(swapPicked.length, 'tile') }}</BaseButton>
            <BaseButton small @click="swapping = false">Cancel</BaseButton>
          </div>
        </div>
        <div class="wv-acts">
          <BaseButton variant="primary" :reason="playWhy" @click="play">{{ pv.ok ? `Play · ${pv.points}` : 'Play' }}</BaseButton>
          <BaseButton :reason="swapWhy" @click="openSwap">Swap</BaseButton>
          <BaseButton :reason="passWhy" @click="pass">Pass</BaseButton>
          <template v-if="!over">
            <BaseButton v-if="!armed" variant="danger" @click="resign">Resign</BaseButton>
            <template v-else>
              <BaseButton variant="danger" @click="resign">Yes, resign</BaseButton>
              <BaseButton @click="armed = false">Keep playing</BaseButton>
            </template>
          </template>
        </div>
        <p v-if="swapWhy && swapWhy !== 'Wait for your turn.'" class="wv-hint">{{ swapWhy }}</p>
        <p v-if="!myTurn" class="wv-hint">It is not your turn: you can lay tiles out, but Play opens on your turn.</p>
      </template>
      <p v-else-if="me !== null && !over" class="wv-hint">You have left this game.</p>

      <div v-if="done" class="wv-done">
        <h3>Game over</h3>
        <p>{{ done.text }}</p>
        <ul>
          <li v-for="row in done.rows" :key="row.seat" :class="{ 'is-winner': row.winner }">
            <b>{{ row.name }}</b> {{ row.score }} points<span v-if="row.winner"> · winner</span>
            <span v-if="row.left.length" class="wv-left"> · left holding {{ row.left.join(' ') }} ({{ plain(row.leftPoints, 'point') }})</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="wv-log" aria-label="Moves so far">
      <h3>Moves</h3>
      <ol v-if="history.length"><li v-for="(line, at) in history" :key="at">{{ line }}</li></ol>
      <p v-else class="wv-hint">No moves yet. The first word covers the star.</p>
    </section>

    <p class="wv-sr" aria-live="polite" role="log">{{ said }}</p>
    <div v-if="drag && drag.active" class="wv-ghost" aria-hidden="true" :style="{ left: `${drag.x}px`, top: `${drag.y}px` }" :class="{ 'is-blank': drag.blank }">
      <span class="wv-letter">{{ drag.ch.toUpperCase() }}</span><span class="wv-value">{{ drag.value }}</span>
    </div>
  </div>
  </div>
</template>

<style scoped>
.wv {
  --cloth: #272b57; --cream: #f4ecd8; --thread: rgba(70, 60, 110, .35);
  container-type: inline-size; background: var(--cloth); color: #fff; border-radius: 20px; padding: 12px; margin: 0 0 var(--s-3);
}
.wv-in { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
.wv-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.wv-head { display: grid; gap: 8px; }
.wv-score { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.wv-score li { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 8px; align-items: center; background: rgba(255, 255, 255, .1); border-radius: 12px; padding: 7px 10px; border: 2px solid transparent; }
.wv-score li.is-turn { border-color: #e8a643; }
.wv-marker { grid-row: span 2; color: #e8a643; font-size: 11px; }
.wv-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.wv-bot { font-weight: 600; color: #cfd2ff; }
.wv-you { font-weight: 600; color: #ffd27a; }
.wv-points { grid-row: span 2; grid-column: 3; font-size: 22px; font-weight: 800; }
.wv-count { font-size: 12px; color: rgba(255, 255, 255, .8); grid-column: 2; }
.wv-watch { margin: 0; font-size: 13px; font-weight: 700; color: #ffd27a; text-align: center; }
.wv-status { margin: 0; text-align: center; font-size: 15px; font-weight: 800; min-height: 22px; }

.wv-cloth { display: grid; gap: 8px; align-content: start; }
.wv-view { container-type: inline-size; background: var(--cream); border-radius: 10px; padding: 4px; box-shadow: 0 0 0 3px #e8a643 inset, 0 2px 8px rgba(0, 0, 0, .35); max-width: 560px; width: 100%; margin: 0 auto; box-sizing: border-box; }
.wv-view.is-zoom { overflow: auto; max-height: min(72vh, 600px); overscroll-behavior: contain; }
.wv-grid { display: grid; width: 100%; background-image: repeating-linear-gradient(45deg, transparent 0 5px, rgba(80, 60, 120, .05) 5px 6px); }
.wv-view.is-zoom .wv-grid { width: calc(13 * 44px); }
.wv-row { display: grid; grid-template-columns: repeat(13, minmax(0, 1fr)); }
.wv-cell {
  position: relative; aspect-ratio: 1; min-width: 0; padding: 0; margin: 0; border: 0; border-right: 1px dashed var(--thread); border-bottom: 1px dashed var(--thread); border-radius: 0;
  background: transparent; color: #4a3318; font: 800 4.2cqw/1 var(--font); cursor: pointer; display: grid; place-items: center; touch-action: manipulation;
}
.wv-view.is-zoom .wv-cell { font-size: 22px; }
.wv-cell:focus-visible { outline: 3px solid #1d6fd6; outline-offset: -3px; z-index: 2; }
.wv-cell.is-dl { background: #d4ecd9; color: #1f5a35; }
.wv-cell.is-tl { background: #2f8f86; color: #fff; }
.wv-cell.is-dw { background: #f1d58a; color: #6b4a08; }
.wv-cell.is-tw { background: #7a3d8f; color: #fff; }
.wv-prem { font-size: .5em; font-weight: 800; letter-spacing: -.02em; opacity: .9; }
.wv-star { font-size: 1.1em; color: #6b4a08; }
.wv-cell.has-tile, .wv-tile, .wv-ghost {
  background: linear-gradient(145deg, #efcb8a, #d3a05a); color: #4a3318;
}
.wv-cell.has-tile { margin: 1px; border: 0; border-radius: 4px; box-shadow: 0 1px 0 #a67a3a, inset 0 1px 0 rgba(255, 255, 255, .5); }
.wv-cell.is-tentative { background: linear-gradient(145deg, #fff3c4, #f6dc8a); box-shadow: 0 0 0 2px #e8a643, 0 2px 4px rgba(0, 0, 0, .3); touch-action: none; z-index: 1; }
.wv-cell.is-last { box-shadow: 0 0 0 2px #1f9d73, 0 1px 0 #a67a3a; }
.wv-cell.is-blank, .wv-tile.is-blank, .wv-ghost.is-blank { background: linear-gradient(145deg, #dcdcf6, #b9b9e3); color: #34377a; font-style: italic; }
.wv-letter { line-height: 1; }
.wv-value { position: absolute; right: 8%; bottom: 6%; font-size: .42em; font-weight: 700; font-style: normal; }
.wv-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.wv-bag { font-size: 13px; color: rgba(255, 255, 255, .85); }
.wv-chip { min-height: var(--tap, 44px); padding: 0 16px; border-radius: 99px; border: 1px solid rgba(255, 255, 255, .45); background: rgba(255, 255, 255, .12); color: #fff; font: 700 13px var(--font); cursor: pointer; }
.wv-chip:hover:enabled { background: rgba(255, 255, 255, .22); }
.wv-chip:focus-visible { outline: 3px solid #ffd27a; outline-offset: 2px; }
.wv-chip:disabled { opacity: .5; cursor: not-allowed; }
.wv-preview { margin: 0; min-height: 22px; text-align: center; font-size: 14px; font-weight: 700; color: rgba(255, 255, 255, .85); }
.wv-preview.is-ok { color: #8fe7b6; }
.wv-preview.is-bad { color: #ffc2b4; }

.wv-dock { display: grid; gap: 10px; align-content: start; }
.wv-rack { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; min-height: 56px; padding: 6px; border-radius: 12px; background: rgba(0, 0, 0, .22); align-items: center; }
.wv-tile {
  position: relative; width: 48px; height: 48px; padding: 0; border: 0; border-radius: 7px; font: 800 24px/1 var(--font); cursor: grab; display: grid; place-items: center;
  box-shadow: 0 2px 0 #a67a3a, inset 0 1px 0 rgba(255, 255, 255, .5); touch-action: none; user-select: none;
}
.wv-tile .wv-value { font-size: 11px; }
.wv-tile.is-selected { transform: translateY(-4px); box-shadow: 0 0 0 3px #e8a643, 0 4px 6px rgba(0, 0, 0, .4); }
.wv-tile.is-ticked { box-shadow: 0 0 0 3px #7ee2a1; }
.wv-tile:focus-visible { outline: 3px solid #ffd27a; outline-offset: 2px; }
.wv-empty { font-size: 13px; color: rgba(255, 255, 255, .75); }
.wv-small { display: flex; gap: 8px; justify-content: center; }
.wv-acts { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.wv-hint { margin: 0; font-size: 12px; line-height: 1.45; color: rgba(255, 255, 255, .8); text-align: center; }
.wv-swap, .wv-picker { background: rgba(255, 255, 255, .1); border-radius: 12px; padding: 10px; display: grid; gap: 8px; }
.wv-swap p, .wv-picker p { margin: 0; font-size: 13px; font-weight: 700; text-align: center; }
.wv-letters { display: grid; grid-template-columns: repeat(9, minmax(0, 1fr)); gap: 4px; }
.wv-pick { min-height: 40px; border: 0; border-radius: 6px; background: var(--cream); color: #34377a; font: 800 15px var(--font); cursor: pointer; }
.wv-pick:hover { background: #fff; }
.wv-pick:focus-visible { outline: 3px solid #ffd27a; outline-offset: 1px; }
.wv-done { background: rgba(255, 255, 255, .12); border-radius: 12px; padding: 10px 12px; display: grid; gap: 6px; }
.wv-done h3, .wv-log h3 { margin: 0; font-size: 14px; }
.wv-done p { margin: 0; font-size: 14px; }
.wv-done ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 13px; }
.wv-done li.is-winner { color: #8fe7b6; }
.wv-left { color: rgba(255, 255, 255, .8); }

.wv-log { display: grid; gap: 6px; align-content: start; }
.wv-log ol { margin: 0; padding: 0 4px 0 0; list-style: none; display: grid; gap: 2px; max-height: 180px; overflow-y: auto; font-size: 13px; }
.wv-log li { padding: 4px 8px; border-radius: 8px; background: rgba(255, 255, 255, .07); }
.wv-log li:first-child { background: rgba(255, 255, 255, .16); }

.wv-ghost { position: fixed; z-index: 50; width: 52px; height: 52px; transform: translate(-50%, -70%); border-radius: 8px; display: grid; place-items: center; font: 800 26px/1 var(--font); pointer-events: none; box-shadow: 0 8px 14px rgba(0, 0, 0, .45); opacity: .95; }
.wv-ghost .wv-value { font-size: 12px; }

@container (min-width: 860px) {
  .wv-in { grid-template-columns: minmax(0, 560px) minmax(280px, 1fr); grid-template-areas: 'cloth head' 'cloth dock' 'cloth log'; align-items: start; column-gap: 20px; }
  .wv-head { grid-area: head; }
  .wv-cloth { grid-area: cloth; }
  .wv-dock { grid-area: dock; }
  .wv-log { grid-area: log; }
}
@media (prefers-reduced-motion: reduce) { .wv-tile.is-selected { transform: none; } .wv * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
</style>
