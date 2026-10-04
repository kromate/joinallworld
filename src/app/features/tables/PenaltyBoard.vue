<script setup lang="ts">
// The penalty shoot-out: the score as a row of kicks for each side, the goal with three places to
// aim (or to dive), and what the last kick was. It draws what the server's view holds and sends a
// choice when a side is tapped; a choice stays secret on the server until both are in. Three real
// buttons: it works by keyboard and at 360 px, and needs no reflexes or fast network.
import { computed } from 'vue'
import GameIcon from '../../ui/GameIcon.vue'
import BoardClock from './BoardClock.vue'
import BoardTable from './BoardTable.vue'
import { clockBar, nameAt } from './tablesModel.ts'
import { ZONES } from './tablesBoundary.ts'
import type { PenaltyMove, PenaltyState } from './tablesBoundary.ts'

const props = defineProps<{
  state: PenaltyState
  /** The server time at this draw, for the turn clock. */
  now: number
}>()
defineEmits<{ play: [move: PenaltyMove] }>()

const view = computed(() => props.state.view)
const seats = computed(() => props.state.table.seats)
const me = computed(() => props.state.you)
const over = computed(() => props.state.table.status === 'over')
const shooting = computed(() => me.value !== null && view.value.kicker === me.value)
const playing = computed(() => me.value !== null && !over.value)
const waiting = computed(() => playing.value && view.value.mine !== null)
const last = computed(() => view.value.history.at(-1))
const clock = computed(() => clockBar(props.state, props.now))
const zone = (index: number | null): string => (index === null ? '' : (ZONES[index] ?? '').toLowerCase())
const other = computed(() => (me.value === null ? '' : nameAt(seats.value, 1 - me.value)))
const prompt = computed(() => {
  if (over.value) return ''
  if (!playing.value) return `${nameAt(seats.value, view.value.kicker)} is shooting`
  if (waiting.value) return `You chose ${zone(view.value.mine)}. Waiting for ${other.value}…`
  return shooting.value ? 'You are shooting. Pick your side.' : `You are in goal. Which way will ${other.value} shoot?`
})
/** One dot per kick of a side: scored, missed, or still to come. */
function dots(seat: number): { goal: boolean | null }[] {
  const mine = view.value.history.filter((kick) => kick.kicker === seat)
  return Array.from({ length: Math.max(view.value.options.kicks, mine.length) }, (_, index) => ({ goal: mine[index] ? mine[index].goal : null }))
}
const zoneWhy = computed(() => (!playing.value ? 'You are watching.' : waiting.value ? 'Your side is chosen. Waiting for the other player.' : undefined))
</script>

<template>
  <BoardTable>
    <ul class="pn-score">
      <li v-for="(seat, index) in seats" :key="index" :class="{ 'is-turn': view.kicker === index }">
        <b>{{ seat.name }}</b><span class="pn-goals">{{ view.goals[index] }}</span>
        <span class="pn-dots" :aria-label="`${view.goals[index]} scored of ${view.taken[index]}`"><i v-for="(dot, at) in dots(index)" :key="at" :class="dot.goal === null ? undefined : dot.goal ? 'is-goal' : 'is-miss'" /></span>
      </li>
    </ul>
    <div class="pn-goal" role="group" aria-label="The goal">
      <span class="pn-net" aria-hidden="true"><GameIcon name="goal" bare /></span>
      <div class="pn-zones">
        <button v-for="(name, index) in ZONES" :key="name" class="pn-zone" :class="{ 'is-mine': view.mine === index }" type="button" :disabled="!playing || waiting" :title="zoneWhy" :aria-label="`${shooting ? 'Shoot' : 'Dive'} ${name.toLowerCase()}`" @click="$emit('play', { z: index })">{{ name }}</button>
      </div>
    </div>
    <p v-if="view.sudden && !over" class="wh-need is-warn">Sudden death</p>
    <p class="wh-turn" role="status">{{ prompt }}</p>
    <BoardClock v-if="clock" :seconds="clock.seconds" :from="clock.from" :n="state.n" :restart="clock.key" />
    <p v-if="last" class="pn-last" :class="last.goal ? 'is-goal' : 'is-save'">{{ last.goal ? 'Goal' : 'Saved' }} · {{ nameAt(seats, last.kicker) }} shot {{ zone(last.shot) }}, {{ nameAt(seats, 1 - last.kicker) }} went {{ zone(last.dive) }}</p>
    <p v-else class="pn-last">Best of the kicks. Same side as the keeper is a save.</p>
    <p v-if="!playing && !over" class="wh-note">You are watching.</p>
  </BoardTable>
</template>

<style scoped>
.pn-score { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.pn-score li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; background: rgba(255, 255, 255, .1); border-radius: 12px; padding: 8px 10px; border: 2px solid transparent; }
.pn-score li.is-turn { border-color: #e8a643; }
.pn-score b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.pn-goals { font-size: 22px; font-weight: 800; grid-row: span 2; }
.pn-dots { display: flex; gap: 5px; }
.pn-dots i { width: 12px; height: 12px; border-radius: 50%; background: rgba(255, 255, 255, .25); display: block; }
.pn-dots i.is-goal { background: #7ee2a1; }
.pn-dots i.is-miss { background: #ff8f7a; }
.pn-goal { position: relative; border: 4px solid #fff; border-bottom: 0; border-radius: 10px 10px 0 0; padding: 26px 8px 10px; background: repeating-linear-gradient(90deg, rgba(255, 255, 255, .08) 0 2px, transparent 2px 16px), repeating-linear-gradient(0deg, rgba(255, 255, 255, .08) 0 2px, transparent 2px 16px); }
.pn-net { position: absolute; top: 2px; left: 8px; opacity: .6; }
.pn-net :deep(svg) { width: 20px; height: 20px; }
.pn-zones { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.pn-zone { min-height: 72px; border-radius: 12px; border: 2px dashed rgba(255, 255, 255, .7); background: rgba(255, 255, 255, .12); color: #fff; font: inherit; font-weight: 800; font-size: 15px; cursor: pointer; }
.pn-zone:not(:disabled):hover, .pn-zone:focus-visible { background: #e8a643; color: #20232c; border-style: solid; outline: none; }
.pn-zone:disabled { opacity: .55; cursor: default; }
.pn-zone.is-mine { background: #e8a643; color: #20232c; border-style: solid; opacity: 1; }
.pn-last { margin: 0; text-align: center; font-size: 13px; }
.pn-last.is-goal { color: #7ee2a1; font-weight: 700; }
.pn-last.is-save { color: #ffb4a4; font-weight: 700; }
</style>
