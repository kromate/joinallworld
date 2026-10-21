<script setup lang="ts">
// Ayo on screen: an original wooden two-by-six board. The server supplies legal cups and a replay
// record for each accepted move; this component only illustrates that record and sends a cup id.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import BoardClock from './BoardClock.vue'
import { clockBar, nameAt, plain } from './tablesModel.ts'
import type { AyoMove, AyoState } from './tablesBoundary.ts'

const props = defineProps<{ state: AyoState; now: number; pending: boolean; error: string | null }>()
const emit = defineEmits<{ play: [move: AyoMove] }>()

const view = computed(() => props.state.view)
const seats = computed(() => props.state.table.seats)
const me = computed(() => props.state.you)
const over = computed(() => view.value.over !== null || props.state.table.status === 'over')
const clock = computed(() => clockBar(props.state, props.now))
const bottomSeat = computed<0 | 1>(() => (me.value === 1 ? 1 : 0))
const topSeat = computed<0 | 1>(() => (bottomSeat.value === 0 ? 1 : 0))
const top = computed(() => (bottomSeat.value === 0 ? [11, 10, 9, 8, 7, 6] : [5, 4, 3, 2, 1, 0]))
const bottom = computed(() => (bottomSeat.value === 0 ? [0, 1, 2, 3, 4, 5] : [6, 7, 8, 9, 10, 11]))
const renderCups = ref(view.value.cups.slice())
const animating = ref(false)
const sentAt = ref<number | null>(null)
let previousN = props.state.n
let timers: ReturnType<typeof setTimeout>[] = []

const clearTimers = (): void => { for (const timer of timers) clearTimeout(timer); timers = [] }
const later = (run: () => void, delay: number): void => { timers.push(setTimeout(run, delay)) }
const reducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function replayAccepted(): void {
  clearTimers()
  sentAt.value = null
  const last = view.value.last
  if (!last || reducedMotion()) { renderCups.value = view.value.cups.slice(); animating.value = false; return }
  const board = last.before.slice()
  board[last.cup] = 0
  renderCups.value = board.slice()
  animating.value = true
  const stepMs = Math.max(16, Math.min(64, Math.floor(560 / Math.max(1, last.path.length))))
  last.path.forEach((cup, index) => later(() => {
    board[cup] = (board[cup] ?? 0) + 1
    renderCups.value = board.slice()
  }, (index + 1) * stepMs))
  const sowedAt = last.path.length * stepMs
  if (last.capturedCups.length) later(() => {
    for (const cup of last.capturedCups) board[cup] = 0
    renderCups.value = board.slice()
  }, sowedAt + 70)
  later(() => {
    renderCups.value = view.value.cups.slice()
    animating.value = false
  }, sowedAt + (last.capturedCups.length ? 150 : 90))
}

watch(() => props.state, () => {
  if (props.state.n !== previousN) replayAccepted()
  else if (!animating.value) renderCups.value = view.value.cups.slice()
  previousN = props.state.n
})
// The socket client clears `pending` for both a table-state response (including a same-n retry)
// and a refusal; its error field is set for an illegal move. Either answer releases the local tap.
watch(() => [props.pending, props.error] as const, ([pending]) => { if (!pending) sentAt.value = null })
onBeforeUnmount(clearTimers)

const legal = computed(() => new Set(view.value.legal))
const myTurn = computed(() => me.value !== null && view.value.turn === me.value && !over.value)
const canPlay = (cup: number): boolean => myTurn.value && legal.value.has(cup) && !animating.value && !props.pending && sentAt.value === null
const countAt = (cup: number): number => renderCups.value[cup] ?? 0
const localCup = (cup: number): number => cup % 6 + 1
const ownerName = (cup: number): string => nameAt(seats.value, cup < 6 ? 0 : 1, cup < 6 ? 'Side one' : 'Side two')
const cupLabel = (cup: number): string => `${ownerName(cup)}, cup ${localCup(cup)}, ${plain(countAt(cup), 'seed')}${legal.value.has(cup) ? ', legal move' : ''}`

interface SeedDot { x: number; y: number; r: number }
const SEED_POSITIONS: readonly SeedDot[] = [
  { x: 50, y: 36, r: 5 }, { x: 37, y: 35, r: 4.6 }, { x: 62, y: 35, r: 4.4 }, { x: 45, y: 48, r: 4.5 },
  { x: 57, y: 47, r: 4.2 }, { x: 48, y: 24, r: 4.1 }, { x: 31, y: 46, r: 3.8 }, { x: 68, y: 46, r: 3.9 },
  { x: 35, y: 24, r: 3.8 }, { x: 64, y: 23, r: 3.7 }, { x: 51, y: 57, r: 3.7 }, { x: 24, y: 35, r: 3.5 },
  { x: 75, y: 34, r: 3.5 }, { x: 26, y: 52, r: 3.3 }, { x: 73, y: 51, r: 3.3 }, { x: 50, y: 14, r: 3.2 },
]
const dots = (cup: number): readonly SeedDot[] => SEED_POSITIONS.slice(0, Math.min(countAt(cup), SEED_POSITIONS.length))

const status = computed(() => {
  if (over.value) return 'Game over.'
  if (animating.value) {
    const last = view.value.last
    return last?.captured ? `${nameAt(seats.value, last.seat)} captured ${plain(last.captured, 'seed')}.` : `${nameAt(seats.value, last?.seat ?? null)} is sowing.`
  }
  if (me.value === null) return `${nameAt(seats.value, view.value.turn)} to sow.`
  if (myTurn.value) return 'Your turn. Choose a glowing cup on your row.'
  return `Waiting for ${nameAt(seats.value, view.value.turn)}.`
})

function play(cup: number): void {
  if (!canPlay(cup)) return
  sentAt.value = props.state.n
  emit('play', { cup })
  // A disconnected send never enters the client's pending state, so release on the next render.
  void nextTick(() => { if (!props.pending) sentAt.value = null })
}
</script>

<template>
  <section class="ay" aria-label="Ayo board">
    <header class="ay-head">
      <div v-for="(seat, index) in seats" :key="index" class="ay-player" :class="{ 'is-turn': view.turn === index, 'is-you': me === index }">
        <span><b>{{ seat.bot ? seat.name.replace(/\s*\(bot\)$/i, '') : seat.name }}</b><small v-if="seat.bot">house</small><small v-else-if="me === index">you</small></span>
        <strong>{{ view.captured[index] ?? 0 }}<small> captured</small></strong>
      </div>
    </header>

    <div class="ay-variant"><b>{{ view.variant }}</b><span>Ayo house styles vary</span></div>
    <div class="ay-scroll">
      <div class="ay-board">
        <span class="ay-direction" aria-hidden="true">↺</span>
        <div class="ay-row is-top" :aria-label="`${nameAt(seats, topSeat)}'s row`">
          <button
            v-for="cup in top" :key="cup" type="button" class="ay-cup" :class="{ 'is-legal': canPlay(cup), 'is-last': view.last?.path.at(-1) === cup }"
            :aria-label="cupLabel(cup)" :aria-disabled="!canPlay(cup)" :tabindex="canPlay(cup) ? 0 : -1" @click="play(cup)"
          >
            <svg viewBox="0 0 100 72" aria-hidden="true"><ellipse class="ay-well" cx="50" cy="37" rx="43" ry="29" /><circle v-for="(dot, dotIndex) in dots(cup)" :key="dotIndex" class="ay-seed" :cx="dot.x" :cy="dot.y" :r="dot.r" /></svg>
            <span class="ay-count" aria-hidden="true">{{ countAt(cup) }}</span>
          </button>
        </div>
        <div class="ay-ridge" aria-hidden="true" />
        <div class="ay-row is-bottom" :aria-label="`${nameAt(seats, bottomSeat)}'s row`">
          <button
            v-for="cup in bottom" :key="cup" type="button" class="ay-cup" :class="{ 'is-legal': canPlay(cup), 'is-last': view.last?.path.at(-1) === cup }"
            :aria-label="cupLabel(cup)" :aria-disabled="!canPlay(cup)" :tabindex="canPlay(cup) ? 0 : -1" @click="play(cup)"
          >
            <svg viewBox="0 0 100 72" aria-hidden="true"><ellipse class="ay-well" cx="50" cy="37" rx="43" ry="29" /><circle v-for="(dot, dotIndex) in dots(cup)" :key="dotIndex" class="ay-seed" :cx="dot.x" :cy="dot.y" :r="dot.r" /></svg>
            <span class="ay-count" aria-hidden="true">{{ countAt(cup) }}</span>
          </button>
        </div>
      </div>
    </div>
    <p class="ay-status" role="status" aria-live="polite">{{ status }}</p>
    <BoardClock v-if="clock && !over" :seconds="clock.seconds" :from="clock.from" :n="state.n" :restart="clock.key" />
    <p class="ay-note">Sow anticlockwise. Capture backwards on the other row when cups finish with 2 or 3 seeds.</p>
  </section>
</template>

<style scoped>
.ay { display: grid; gap: 10px; min-width: 0; margin: 0 0 var(--s-3); padding: 8px; border-radius: 20px; color: #fff8e8; background: #203c2f; }
.ay-head { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ay-player { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; min-width: 0; gap: 2px 8px; padding: 8px 10px; border: 2px solid transparent; border-radius: 12px; background: rgba(255, 255, 255, .1); }
.ay-player.is-turn { border-color: #f7c85a; }
.ay-player.is-you { background: rgba(255, 255, 255, .16); }
.ay-player > span { min-width: 0; grid-column: 1 / -1; display: flex; align-items: baseline; gap: 6px; }
.ay-player b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.ay-player small { color: rgba(255, 248, 232, .85); font-size: 12px; font-weight: 650; }
.ay-player strong { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 6px; font-size: 20px; }
.ay-player strong small { font-size: 12px; }
.ay-variant { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: rgba(255, 248, 232, .78); }
.ay-variant b { color: #ffe3a0; }
.ay-scroll { min-width: 0; }
.ay-board { position: relative; display: grid; gap: 2px; min-width: 0; width: 100%; padding: 2px; border: 2px solid #6d3c20; border-radius: 20px; background: linear-gradient(145deg, #c48143, #92522b 58%, #7b4023); box-shadow: inset 0 2px 0 rgba(255, 238, 194, .32), inset 0 -6px 12px rgba(65, 27, 8, .35), 0 6px 16px rgba(0, 0, 0, .26); box-sizing: border-box; }
.ay-row { display: grid; grid-template-columns: repeat(6, minmax(44px, 1fr)); gap: 0; min-width: 264px; }
.ay-cup { position: relative; width: 100%; min-width: 44px; min-height: 54px; padding: 0; border: 0; border-radius: 46%; color: #fff6dc; background: transparent; cursor: default; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.ay-cup svg { display: block; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 2px 2px rgba(42, 18, 7, .5)); }
.ay-well { fill: #4b2919; stroke: #d3914d; stroke-width: 4; }
.ay-seed { fill: #f1d08a; stroke: #7c4c22; stroke-width: 1.2; }
.ay-count { position: absolute; right: 3px; bottom: 0; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 3px; border-radius: 999px; color: #2f1a0e; background: #fff0bf; box-shadow: 0 1px 3px rgba(0, 0, 0, .3); font-size: 11px; font-weight: 850; box-sizing: border-box; }
.ay-cup.is-legal { cursor: pointer; filter: brightness(1.1) drop-shadow(0 0 5px rgba(255, 231, 110, .45)); }
.ay-cup.is-legal .ay-well { stroke: #ffe76e; stroke-width: 7; }
.ay-cup.is-legal:hover, .ay-cup.is-legal:focus-visible { outline: 3px solid #fff; outline-offset: -2px; transform: translateY(-2px); }
.ay-cup.is-last:not(.is-legal) .ay-well { stroke: #f2bb63; }
.ay-ridge { height: 3px; margin: 0 5%; border-radius: 99px; background: rgba(73, 32, 12, .46); box-shadow: 0 1px rgba(255, 227, 171, .2); }
.ay-direction { position: absolute; top: 50%; left: 4px; transform: translateY(-50%); color: #ffe3a0; font-size: 18px; font-weight: 900; z-index: 2; pointer-events: none; }
.ay-status { min-height: 21px; margin: 0; text-align: center; font-size: 14px; font-weight: 800; }
.ay-note { margin: 0 2px; color: rgba(255, 248, 232, .85); font-size: 12px; line-height: 1.45; text-align: center; }
@media (max-width: 420px) {
  .ay { padding-inline: 6px; }
  .ay-count { right: 0; }
}
</style>
