<script setup lang="ts">
// The Whot table: the other players, the market and the pile, your own hand and the buttons to
// play. It draws exactly what the server's view holds and sends a move when a card or the market
// is tapped; it never decides whether a move is allowed (the cards it enables are the server's own
// list). Every card is a real button, so the table works by keyboard and at 360 px. A Whot asks for
// the shape you need first, unless it is your last card. Player names are text, never markup.
import { computed, ref } from 'vue'
import { play } from '../../../audio/play.ts'
import BaseButton from '../../ui/BaseButton.vue'
import GameIcon from '../../ui/GameIcon.vue'
import BoardClock from './BoardClock.vue'
import BoardTable from './BoardTable.vue'
import WhotCard from './WhotCard.vue'
import { clockBar, nameAt, plain } from './tablesModel.ts'
import { SHAPES, SHAPE_NAMES } from './tablesBoundary.ts'
import type { WhotMove, WhotShape, WhotState } from './tablesBoundary.ts'

const props = defineProps<{
  state: WhotState
  /** The server time at this draw, for the turn clock. */
  now: number
}>()
const emit = defineEmits<{ play: [move: WhotMove] }>()

/** The Whot card waiting for the shape the player names. */
const choosing = ref<number | null>(null)
const view = computed(() => props.state.view)
const seats = computed(() => props.state.table.seats)
const me = computed(() => props.state.you)
const over = computed(() => props.state.table.status === 'over')
const myTurn = computed(() => me.value !== null && props.state.toMove.includes(me.value))
const others = computed(() => seats.value.map((seat, index) => ({ seat, index })).filter(({ index }) => index !== me.value))
const clock = computed(() => clockBar(props.state, props.now))
const picking = computed(() => choosing.value !== null && view.value.hand?.[choosing.value]?.s === 'whot')
const counts = (index: number): number => view.value.counts[index] ?? 0
const backs = (index: number): number => Math.min(counts(index), 6)

function tap(index: number): void {
  const item = view.value.hand?.[index]
  if (!item) return
  // A Whot needs a shape, unless it is the last card.
  if (item.s === 'whot' && (view.value.hand?.length ?? 0) > 1) { choosing.value = index; return }
  choosing.value = null
  play('card'); emit('play', { t: 'play', i: index })
}
function shape(name: WhotShape): void {
  const index = choosing.value
  choosing.value = null
  if (index !== null) { play('card'); emit('play', { t: 'play', i: index, shape: name }) }
}
function draw(): void { choosing.value = null; play('card'); emit('play', { t: 'draw' }) }
</script>

<template>
  <BoardTable>
    <ul class="wh-players">
      <li v-for="{ seat, index } in others" :key="index" class="wh-player" :class="{ 'is-turn': view.turn === index, 'is-out': seat.left || view.out[index] }">
        <b>{{ seat.name }}</b>
        <span v-if="over && view.shown" class="wh-shown">
          <WhotCard v-for="(item, at) in view.shown[index] ?? []" :key="at" :item="item" small />
          <small v-if="!(view.shown[index] ?? []).length">no cards</small>
        </span>
        <template v-else>
          <span class="wh-backs" aria-hidden="true"><i v-for="at in backs(index)" :key="at" /></span>
          <small>{{ plain(counts(index), 'card') }}<template v-if="view.said[index]"> · <em>Last card!</em></template>{{ seat.away ? ' · away' : '' }}{{ seat.left ? ' · left' : '' }}</small>
        </template>
      </li>
    </ul>
    <div class="wh-centre">
      <div class="wh-market" :aria-label="`Market: ${view.market} cards`"><WhotCard back /><small>Market · {{ view.market }}</small></div>
      <div class="wh-top"><WhotCard :item="view.top" /><small>On the pile</small></div>
    </div>
    <p v-if="view.pick" class="wh-need is-warn">{{ myTurn ? `Answer with a ${view.pickBy}, or pick ${view.pick}` : `${nameAt(seats, view.turn, 'Next')} must answer or pick ${view.pick}` }}</p>
    <p v-else-if="view.call" class="wh-need">{{ SHAPE_NAMES[view.call] }}s were called <GameIcon :name="view.call" inline /></p>
    <p v-if="!over" class="wh-turn" role="status">{{ myTurn ? 'Your turn' : view.turn === null ? '' : `${nameAt(seats, view.turn)} is playing…` }}</p>
    <BoardClock v-if="clock" :seconds="clock.seconds" :from="clock.from" :n="state.n" :restart="clock.key" />
    <div v-if="view.hand" class="wh-mine">
      <div class="wh-hand" role="group" aria-label="Your cards">
        <WhotCard v-for="(item, index) in view.hand" :key="index" :item="item" button :playable="myTurn && view.playable.includes(index)" :dim="myTurn && !view.playable.includes(index)" @pick="tap(index)" />
      </div>
      <div v-if="picking" class="wh-picker" role="group" aria-label="Name the shape you need">
        <b>I need…</b>
        <BaseButton v-for="name in SHAPES" :key="name" @click="shape(name)"><GameIcon :name="name" inline /> {{ SHAPE_NAMES[name] }}</BaseButton>
        <button class="wh-swap" type="button" @click="choosing = null">Cancel</button>
      </div>
      <BaseButton v-if="!over" block :variant="myTurn && !view.playable.length ? 'primary' : 'default'" :reason="myTurn ? null : 'Wait for your turn.'" @click="draw">{{ view.pick && myTurn ? `Pick ${view.pick} from the market` : 'Go to market' }}</BaseButton>
    </div>
    <p v-else-if="!over" class="wh-note">You are watching. Hands are hidden from everyone but their owner.</p>
    <ol class="wh-log" aria-label="What just happened"><li v-for="(line, index) in state.log.slice(-4)" :key="index">{{ line }}</li></ol>
  </BoardTable>
</template>

<style scoped>
.wh-players { list-style: none; margin: 0; padding: 0; display: flex; gap: 8px; flex-wrap: wrap; }
.wh-player { flex: 1 1 30%; min-width: 0; background: rgba(255, 255, 255, .1); border-radius: 12px; padding: 8px; font-size: 12px; display: grid; gap: 4px; border: 2px solid transparent; }
.wh-player b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.wh-player.is-turn { border-color: #e8a643; background: rgba(232, 166, 67, .18); }
.wh-player.is-out { opacity: .5; }
.wh-player em { color: #ffd27a; font-style: normal; font-weight: 700; }
.wh-backs { display: flex; }
.wh-backs i { width: 14px; height: 20px; border-radius: 3px; background: #b23a2e; border: 1px solid rgba(255, 255, 255, .7); margin-right: -6px; display: block; }
.wh-shown { display: flex; flex-wrap: wrap; gap: 3px; }
.wh-centre { display: flex; justify-content: center; gap: 22px; align-items: flex-end; padding: 6px 0; }
.wh-centre small { display: block; text-align: center; font-size: 11px; opacity: .85; margin-top: 4px; }
.wh-centre :deep(.wh-card small) { opacity: .85; }
.wh-mine { background: rgba(255, 255, 255, .1); border-radius: 14px; padding: 12px 8px 8px; display: grid; gap: 10px; }
.wh-hand { display: flex; gap: 6px; overflow-x: auto; padding: 8px 4px 4px; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
.wh-hand > :deep(.wh-card) { scroll-snap-align: center; }
.wh-picker { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; background: #fff; color: var(--c-ink); border-radius: 12px; padding: 8px; }
.wh-picker .base-button { min-height: var(--tap, 44px); }
.wh-picker :deep(.ui-glyph) { width: 18px; height: 18px; vertical-align: -4px; color: #8f1d1d; }
.wh-swap { background: none; border: 0; color: var(--c-muted); font: inherit; font-size: 12px; text-decoration: underline; padding: 4px; min-height: var(--tap, 44px); cursor: pointer; }
.wh-log { list-style: none; margin: 0; padding: 0; font-size: 12px; line-height: 1.5; opacity: .9; }
.wh-log li:last-child { font-weight: 700; opacity: 1; }
</style>
